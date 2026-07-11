# Audit technique — Module « Tournées, véhicules & application mobile chauffeur »

**Date** : 11 juillet 2026
**Périmètre** : `backend/src/routes/tours/` (18 fichiers), `backend/src/routes/{vehicles.js, vehicle-contracts.js}`, `backend/src/services/{TourService.js, dispatch-optimizer.js}`, PWA `mobile/src/`, pages web (Tours, PlanningTournees, LiveVehicles, Vehicles, VehicleMaintenance), schéma `init-db.js`.
**Note globale** : **6.5 / 10** — ingénierie globalement soignée, mais dette d'intégrité (transactions, divergences de flux) et couverture de tests quasi nulle sur les chemins critiques.

---

## 1. Points forts

- **Découpage modulaire maîtrisé.** `tours/index.js` monte 18 sous-routeurs dans un ordre délibéré (routes spécifiques avant le catch-all `/:id`), avec des commentaires explicitant ce choix. Le service `TourService.js` (V6.2) a bien dé-dupliqué le haversine et `loadTourCAVs` auparavant recopiés dans plusieurs fichiers.
- **Couche de synchronisation offline exemplaire.** `mobile/src/services/sync.js` + `authedFetch.js` + `driverAuth.js` : back-off par catégorie, distinction fine `isClientError` (4xx purge) vs `retryable` (auth/réseau conservé → zéro perte de collecte), ré-authentification dédupliquée via `vehicle_token`. C'est le meilleur morceau du module, et il est testé (`mobile/tests/sync.test.js`, `db.test.js`).
- **Sécurité durcie.** `qr_token` systématiquement retiré des réponses `GET /vehicles` et `/:id` (`vehicles.js:181,342,1128`), exposé seulement via `/:id/access-info` (ADMIN) ; `driver-start` utilise un token 128 bits non énumérable (`auth.js:50`) ; Socket.IO est authentifié par JWT (`index.js:278`) ; les endpoints mobile « -public » exigent désormais le JWT chauffeur (middleware `MOBILE_DRIVER_PATH`, `index.js:59`). Toutes les requêtes SQL lues sont **paramétrées** ($1/$2) — aucune injection détectée.
- **Dégradation gracieuse OSRM.** `geo.js` encapsule `fetch` dans un `AbortController` (4 s) avec repli Haversine + TSP (nearest-neighbor + 2-opt). Le `claim` de tournée est atomique (`UPDATE ... WHERE status='planned'` → 409 sur conflit, `execution.js:142`), bonne gestion de la concurrence.
- **Perf temps réel.** Le hot-path GPS Socket.IO throttle la détection de proximité (5 s) et met en cache les CAV de la tournée (TTL 60 s) — `index.js:317-320`. Aucun marqueur `TODO/FIXME` ; le mismatch historique du nom d'événement GPS est résolu (`gps-update` des deux côtés).

## 2. Constats critiques

### C1 — Divergence de complétion mobile ↔ web : stock & tonnage non alimentés (P1, proche P0)
Les effets de bord de fin de tournée (INSERT `stock_movements`, `stock_original_movements`, `tonnage_history`, `collection_learning_feedback`) n'existent **que** dans le handler authentifié `execution.js` `PUT /:id/status` (lignes 195-250). Or le **chemin réel du mobile** finalise via `index.js` `PUT /:id/status-public` (`sync.js:147`, `ReturnCentre.jsx:16`), qui ne fait **aucun** de ces INSERT (`index.js:442-515`). Conséquence : une tournée clôturée depuis le terminal chauffeur — le cas nominal — ne génère probablement **ni entrée de stock, ni historique de tonnage, ni feedback d'apprentissage ML**. À vérifier en priorité ; impact direct sur la fiabilité stock/Refashion et sur l'auto-apprentissage prédictif.

### C2 — Complétion non idempotente → double stock (P1)
`execution.js` `PUT /:id/status` fait `UPDATE tours SET status=... WHERE id=$N` **sans garde** `AND status <> 'completed'` (ligne 187), puis ré-exécute les INSERT stock/tonnage si `status='completed'`. Re-clôturer une tournée (re-clic, rejeu) **duplique** `stock_movements` et `tonnage_history`. Aucune contrainte d'unicité ne protège.

### C3 — Écritures multi-tables sans transaction (P1)
Un seul `BEGIN/COMMIT` dans tout le périmètre (`index.js:277`, gps-batch). Tous les autres chemins multi-tables enchaînent des `pool.query()` isolés : création de tournée (tours + N `tour_cav`, `crud.js:182-196`), complétion (tours + 3 tables stock + feedback), application de ré-optim (N `UPDATE position`, `reoptimize-service.js:208`), horaires prévisionnels, et le plan IA (`DELETE items` puis ré-`INSERT`, `vehicles.js:1301-1322`). Un échec en cours laisse un état partiel : tournée orpheline, séquence de passage à moitié réordonnée, profil d'entretien sans items.

### C4 — N+1 massif dans la génération de tournée intelligente (P1)
`generateIntelligentTour` (`smart-tour.js:50`) appelle `predictFillRate` pour **chaque** CAV actif (≈209 d'après l'historique projet). Chaque `predictFillRate` exécute ~7 requêtes séquentielles (`predictions.js` : historique, cav, 3× feedback, contexte, événements) + `getContextForDate` répété 209× pour la même date. Puis la boucle de routage (`smart-tour.js:133-191`) émet **2 appels HTTP OSRM séquentiels par CAV sélectionné** (~30), chacun avec timeout 4 s, alors que `osrmOptimizedTrip` a déjà renvoyé distance/durée totales. Exécuté **en synchrone** dans `POST /tours/intelligent` (le manager attend) et 4× chaque nuit dans `dispatch-optimizer`. Latence potentielle : plusieurs dizaines de secondes à la minute, risque de timeout HTTP.

### C5 — Migrations NOT NULL fragiles & divergences schéma ↔ code (P1)
`tours.driver_employee_id SET NOT NULL` est **conditionnel** à l'absence de lignes NULL (`init-db.js:2049-2058`). Mais `dispatch-optimizer.js:58` et `crud.js` (`/intelligent`, `/standard`, `/manual`) insèrent des tournées **sans chauffeur** (`did = null`) : soit la contrainte ne s'applique jamais (durcissement silencieusement inopérant), soit, là où elle s'est appliquée, ces INSERT échouent. Par ailleurs `tours.mode` est `NOT NULL` sans valeur par défaut (`init-db.js:466`), or `execution.js:112` (`claim-vehicle`) insère **sans** `mode` → violation probable sur schéma strict. Comportement non déterministe selon l'état des données de chaque base.

### C6 — Configuration prédictive en mémoire volatile (P1)
`predictions.js` stocke `SEASONAL_FACTORS`, `DAY_OF_WEEK_FACTORS`, `FRENCH_HOLIDAYS_2026`, `SCHOOL_VACATIONS`, `SCORING_CONFIG` comme `let` de module (lignes 11-95). `PUT /tours/predictive-config` (`crud.js:70`) mute ces variables **en mémoire process**. Toute calibration admin est **perdue à chaque redémarrage / redéploiement** (`deploy.sh update` reconstruit l'image) et n'est pas partagée entre workers. L'admin croit paramétrer le moteur ; la config revient aux valeurs codées en dur.

## 3. Autres constats (P2)

- **OSRM sans timeout dans 2 services.** `reoptimize-service.js:26` (`osrmRouteTotal`) et `planned-passage.js:29` (`osrmRouteLegs`) utilisent `fetch` **brut**, sans l'`AbortController` de `geo.js`. Un OSRM public lent bloque indéfiniment ces traitements « non bloquants ».
- **Serveur OSRM de démo public par défaut.** `OSRM_BASE_URL` défaute sur `router.project-osrm.org` (`geo.js:7`) — le commentaire du code recommande lui-même un self-host en prod (coordonnées CAV envoyées à un tiers, rate-limit, pas de SLA).
- **Données calendaires codées en dur, horizon 2027.** Jours fériés et vacances scolaires (`predictions.js:20-64`) s'arrêtent en 2027 ; les prédictions se dégradent silencieusement au-delà.
- **Modèle Claude déprécié en dur.** `vehicles.js:1260` défaute sur `claude-sonnet-4-20250514` (déprécié selon le changelog ; le reste du code cible `claude-sonnet-5`).
- **Autorisation horizontale : aucune liaison tournée ↔ chauffeur.** Les endpoints mobile (`-public` + `execution.js`) n'ont que `authenticate`, sans vérifier que la tournée appartient au véhicule du chauffeur. Un JWT chauffeur (`COLLABORATEUR`) peut agir sur **n'importe quel** `:id` (collecter, peser, incident, statut, accepter/refuser une ré-optim) ; `crud.js` `GET /:id` (ligne 105) n'a **aucun** `authorize`. Atténué par le modèle de confiance (travailleurs de terrain, token non énumérable), mais sans défense en profondeur.
- **Identité chauffeur partagée + repli sur user id 1.** `driver-start` émet un JWT sur l'utilisateur générique `chauffeur` pour les véhicules sans chauffeur/compte assigné (`auth.js:86-97`), avec repli `|| 1` (l'id admin). L'attribution `created_by` / `recorded_by` devient peu fiable par travailleur — enjeu pour une structure d'insertion — et le repli sur l'id 1 est hasardeux.
- **Double implémentation des opérations mobile.** `-public` (index.js) vs authentifié (execution.js) pour statut, pesée, collecte, checklist, incident : logiques **divergentes** (machine à états seulement côté public ; effets stock seulement côté execution ; filtre `is_intermediate` du total seulement côté public). C'est la racine de C1. À consolider en un seul flux.
- **Fichiers volumineux.** `events-auto.js` 798 l., `index.js` 661, `stats.js` 506, `predictions.js` 457 ; web `Vehicles.jsx` 42 Ko, `VehicleMaintenance.jsx` 37 Ko, `Tours.jsx` 36 Ko. Surfaces difficiles à tester (Tours.jsx exploite toutefois `useAsyncData`/`ErrorState`, bon réflexe).

## 4. Testabilité

Les 25 fichiers de tests couvrent le **mobile** (sync, db, usageMode) mais **aucun** ne couvre le backend tournées/véhicules : transitions d'état, effets de bord de complétion et leur idempotence (C1/C2), `predictFillRate`/scoring, calcul de gain de ré-optim, contraintes capacité/durée de `smart-tour`. Ce sont précisément les chemins les plus risqués. Priorité : tests unitaires sur ces fonctions pures et sur la machine à états.

## 5. Recommandations priorisées

| # | Recommandation | Prio | Effort |
|---|----------------|------|--------|
| R1 | Consolider les jumeaux `-public` / authentifiés en un seul flux ; garantir stock/tonnage/feedback sur le chemin mobile (corrige C1) | P1 | M |
| R2 | Garde d'idempotence sur la complétion (`WHERE status<>'completed'`) + contrainte anti-doublon `tonnage_history`/`stock_movements` (C2) | P1 | S |
| R3 | Encapsuler les écritures multi-tables dans des transactions (`pool.connect`+BEGIN/COMMIT) — création, complétion, ré-optim, plan IA (C3) | P1 | M |
| R4 | Optimiser `generateIntelligentTour` : mémoïser le contexte par date, requêtes de prédiction groupées, réutiliser les totaux OSRM ; sortir du chemin HTTP synchrone (C4) | P1 | L |
| R5 | Persister la config prédictive (table/`settings`) et la recharger au boot ; réconcilier les migrations NOT NULL et `tours.mode` avec les INSERT sans chauffeur (C5/C6) | P1 | M |
| R6 | Ajouter timeout OSRM dans `reoptimize-service.js` et `planned-passage.js` ; documenter/forcer un OSRM self-host en prod | P2 | S |
| R7 | Lier les actions chauffeur à la tournée de son véhicule (ownership) ; `authorize` sur `crud GET /:id` | P2 | M |
| R8 | Tests unitaires prioritaires : transitions d'état, idempotence complétion, `predictFillRate`, gain ré-optim, contraintes smart-tour | P1 | M |

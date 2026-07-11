# Audit fonctionnel — Module « Tournées, véhicules & application mobile chauffeur »

**Périmètre analysé** : `backend/src/routes/tours/*` (18 fichiers), `backend/src/routes/{vehicles,vehicle-contracts}.js`, `backend/src/services/{TourService,dispatch-optimizer}.js`, `mobile/src/**` (App, 12 pages, contexts, services offline/sync), pages web `Tours`, `PlanningTournees`, `LiveVehicles`, `Vehicles`, `VehicleMaintenance`.
**Méthode** : lecture exhaustive des routes, services et pages listées, vérification croisée des champs front/back, du schéma (`init-db.js`) et de la couverture de tests (`backend` Jest, `mobile` Vitest).

---

## 1. Couverture fonctionnelle réelle

Le module couvre un périmètre large. Côté **planification** : 4 modes de création de tournée (`crud.js` — intelligente IA, standard sur route prédéfinie, manuelle, association), un dispatch automatique J-1 (`dispatch-optimizer.js`, brouillons générés pour tous les véhicules disponibles), un planning drag-and-drop chauffeur/véhicule avec détection de conflits (`planning.js` — jour off, double affectation, véhicule indisponible). Côté **optimisation** : un moteur prédictif de remplissage très étoffé (`predictions.js`, ~460 lignes) combinant historique 180 jours, saisonnalité, jour de semaine, jours fériés, vacances scolaires (zone B), météo Open-Meteo, événements locaux, et un apprentissage continu à trois niveaux (correction par CAV, par période, par zone géographique) ; un algorithme de tournée (`smart-tour.js`) qui optimise via OSRM Trip (repli TSP plus proche voisin + 2-opt en Haversine si OSRM est indisponible), gère la capacité véhicule, les retours intermédiaires au centre au-delà de 2 t et une pause déjeuner automatique. Côté **exécution** : statuts, checklist véhicule, pesées, incidents (avec photo), scan QR, GPS temps réel (Socket.IO + tampon offline), et une **ré-optimisation en cours de tournée** (`reoptimize-service.js`) proposée automatiquement sur incident bloquant ou à la demande, avec accept/reject chauffeur ou manager. Côté **supervision** : `live-summary` (détail d'une tournée), `active-summary`/`LiveVehicles.jsx` (carte multi-tournées temps réel, KPIs, alertes de dépassement), `dashboard.js` (vue consolidée du jour, santé flotte). Côté **véhicules** : CRUD, auth chauffeur « 1 URL = 1 véhicule » sans mot de passe (`qr_token`), maintenance préventive (profils constructeur hardcodés + génération IA Claude), documents, contrats d'entretien avec alerte d'expiration.

L'application mobile (12 pages) couvre l'intégralité du parcours chauffeur : connexion par token véhicule → sélection/claim de véhicule → checklist → carte de tournée → identification CAV (QR + repli liste/code manuel) → niveau de remplissage → pesée → retour centre → récapitulatif (avec CO2 évité, écarts prévu/réalisé) → historique. L'architecture est **offline-first** de bout en bout : IndexedDB (`services/db.js`), file d'attente par type d'action (scans, pesées, GPS, incidents, collectes), synchronisation avec backoff progressif et ré-authentification transparente du JWT chauffeur (`driverAuth.js`, `authedFetch.js`) — un soin d'ingénierie nettement au-dessus de la moyenne pour ce type de projet.

## 2. Adéquation aux besoins et parties prenantes

**Chauffeurs (public éloigné du numérique)** : le point fort du module. Authentification sans identifiant/mot de passe, gros pictogrammes, un geste par écran, retours haptiques, français exclusif, et surtout des **modes d'usage adaptatifs** (`UsageModeContext` — conduite/arrêt court/arrêt opérationnel) qui réduisent dynamiquement le nombre d'actions affichées selon que le chauffeur roule ou est arrêté (`TourMap.jsx`). L'incident se déclare en un tap, le détail restant optionnel. C'est un travail UX mûr et cohérent avec le contexte SIAE.

**Responsable logistique** : `Tours.jsx` (wizard), `PlanningTournees.jsx` (drag-drop avec modale de conflit) et `LiveVehicles.jsx` (carte + tableau + alerte de dérive) donnent un niveau de pilotage correct pour une flotte de 4 véhicules. En revanche, aucun canal de messagerie **manager → chauffeur** n'existe : les notifications push (`push-notifications.js`) circulent uniquement du terrain vers la direction (incident, tournée terminée, proposition de ré-optimisation) ; côté mobile, seule l'API `Notification` navigateur au premier plan est utilisée (`TourMap.jsx`) — aucun abonnement Web Push n'est câblé sur la PWA chauffeur. Un chauffeur avec l'application en arrière-plan ne recevra donc ni message du manager, ni alerte de ré-optimisation.

**Refashion / Métropole / DREETS** : la boucle est fermée en sortie de tournée — clôture d'une tournée = écriture automatique dans `stock_movements`, `stock_original_movements` et `tonnage_history`, qui alimentent ensuite les déclarations Refashion. C'est une bonne intégration, mais elle repose sur un point de fragilité identifié en §5 (idempotence).

**Direction** : `dashboard.js` et `stats.js` (KPIs, taux de ponctualité, détection d'anomalies, précision du moteur prédictif MAE/RMSE) offrent une vue de pilotage correcte, bien que ce ne soit pas leur vocation de reporting mensuel consolidé (traité ailleurs dans l'ERP).

## 3. Benchmark marché

Face aux TMS spécialisés (Antsroute, PTV Route Optimiser, AMCS Platform), SOLIDATA tient une comparaison honorable sur le cœur algorithmique : optimisation OSRM + TSP/2-opt, ré-optimisation dynamique en tournée avec alertes d'écart — un pattern qu'on retrouve dans l'offre enterprise (AMCS *Transport Live View* et ses alertes d'exception), en version plus légère et manuelle, ce qui est un compromis raisonnable pour 4 véhicules. Le **moteur de prédiction de remplissage par CAV** (saisonnalité + météo + événements locaux + apprentissage continu, avec mesure de sa propre précision) est un vrai différenciateur : peu d'outils génériques du marché le proposent nativement sans capteur IoT payant, alors que SOLIDATA le combine déjà avec ses propres capteurs LoRaWAN. À l'inverse, deux écarts nets avec le marché : (1) l'absence de **preuve de passage systématique** (photo/signature à chaque arrêt, standard chez Antsroute) — SOLIDATA ne capture une photo qu'en cas d'incident déclaré ; (2) la maintenance véhicule reste déclarative (seuils km/date + génération IA du plan constructeur) alors qu'AMCS pousse une maintenance prédictive à partir de données télématiques réelles — écart logique à cette échelle de flotte. Sur le terrain mobile, l'architecture offline-first de SOLIDATA est comparable à celle de Kizeo Forms ou Antsroute ; Kizeo va plus loin avec la saisie vocale assistée par IA, absente ici et potentiellement pertinente pour un public en difficulté avec l'écrit. L'atout non technique de SOLIDATA est structurel : intégration native à un ERP couvrant insertion, stock, Refashion et finance — aucun TMS du marché ne l'offre pour une SIAE — et l'absence de licence récurrente par véhicule/mois, un facteur de coût réel pour une structure d'insertion à budget contraint.

## 4. Forces

- Moteur prédictif de remplissage multi-facteurs avec apprentissage continu et endpoints de mesure de sa propre précision (`stats.js` `/predictive/accuracy`) — rare à ce niveau de maturité.
- Architecture mobile offline-first sans perte de données (file par type, backoff, ré-authentification transparente).
- Modes d'usage adaptatifs réduisant les clics et la charge cognitive au volant (`UsageModeContext`, `TourMap.jsx`).
- Ré-optimisation dynamique en cours de tournée avec workflow propose/accept/reject, cohérent avec les standards du secteur.
- Boucle fermée collecte → stock → Refashion (mouvement de stock automatique à la clôture).
- Auth chauffeur « 1 URL = 1 véhicule » bien pensée pour un public peu à l'aise avec identifiants/mots de passe.

## 5. Faiblesses, manques et irritants UX

- **Idempotence manquante sur la clôture web d'une tournée** : `PUT /tours/:id/status` (`execution.js`, utilisé par `Tours.jsx`) ne vérifie pas le statut courant avant d'insérer dans `tonnage_history`, `stock_movements`, `stock_original_movements` et `collection_learning_feedback` ; aucun des trois n'a de contrainte d'unicité en base. Un double clic sur « Terminer » (aucun `disabled` pendant l'appel) duplique le tonnage et fausse le stock et les données d'apprentissage. Le chemin mobile équivalent (`status-public`) est, lui, protégé par une table de transitions autorisées — l'incohérence est révélatrice.
- **Double-réservation de véhicule possible à la création** : aucune des routes `/tours/{intelligent,standard,manual,association}` ne vérifie qu'un véhicule n'a pas déjà une tournée le même jour (seule l'exclusivité PAV/association est vérifiée) ; `PlanningTournees` fait pourtant cette vérification à l'affectation. De plus, le paramètre `?available=true` envoyé par le wizard (`Tours.jsx`) n'est pas supporté par `GET /vehicles` — tous les véhicules non archivés apparaissent, y compris en maintenance ou déjà en tournée.
- **Configuration prédictive non persistée** : facteurs saisonniers, jour de semaine, jours fériés, vacances et scoring vivent en variables `let` du process (`predictions.js`) ; modifiables via `PUT /predictive-config` mais perdus à chaque redémarrage du conteneur — fréquent vu le rythme de déploiement du projet.
- **Aucun canal manager → chauffeur** et pas de Web Push réel côté mobile (voir §2) — un irritant pour la réactivité terrain et un point de vigilance sécurité/organisation du travail.
- **Message trompeur** : `WeighIn.jsx` affiche « 🔗 Bascule connectée · auto-lecture » alors que la saisie du poids brut/tare est entièrement manuelle — aucune intégration bascule/IoT n'existe dans le code.
- **Historique de tournée mobile partiel**, assumé dans le code lui-même (`TourHistory.jsx`) : aucun endpoint public ne liste les incidents/pesées déjà synchronisés, l'écran ne reconstitue que ce qui reste en file locale.
- Bug cosmétique récurrent : `Tours.jsx` (étape 2 du wizard) affiche `v.capacity_kg` (champ inexistant) au lieu de `max_capacity_kg` → « Capacité : undefined kg » à chaque création manuelle de tournée.
- Absence totale de tests automatisés sur `routes/tours/*`, `vehicles.js`, `TourService.js` et `dispatch-optimizer.js` malgré la complexité algorithmique du module (aucun fichier Jest trouvé) ; côté mobile, les 39 tests Vitest couvrent la couche service (sync/db/usageMode) mais aucun écran.
- Pas de saisie vocale ni de preuve de passage (photo/signature) systématique sur la collecte standard.

## 6. Recommandations priorisées

| # | Recommandation | Priorité | Effort |
|---|---|---|---|
| 1 | Rendre `PUT /tours/:id/status` idempotent (garde sur le statut courant, à l'image de `status-public`) + désactiver le bouton pendant l'appel côté `Tours.jsx` | P0 | S |
| 2 | Vérifier la non-double-affectation d'un véhicule (même logique que `planning.js`) dans les 4 routes de création de tournée + faire respecter `?available=true` dans `GET /vehicles` | P1 | S |
| 3 | Persister la configuration du moteur prédictif en base plutôt qu'en mémoire process | P1 | M |
| 4 | Retirer ou implémenter réellement le message « bascule connectée » dans `WeighIn.jsx` | P1 | S |
| 5 | Étudier un canal de notification manager → chauffeur (message libre + Web Push effectif sur la PWA mobile) | P1 | M |
| 6 | Ajouter une suite de tests Jest sur le moteur prédictif, `smart-tour.js` et `reoptimize-service.js` (haute valeur algorithmique, zéro filet actuel) | P1 | M |
| 7 | Corriger `v.capacity_kg` → `max_capacity_kg` dans le wizard `Tours.jsx` | P2 | S |
| 8 | Exposer les endpoints publics manquants (incidents/pesées d'une tournée) pour fiabiliser `TourHistory.jsx` | P2 | M |

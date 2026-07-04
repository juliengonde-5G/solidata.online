# Audit exhaustif — 03. Collecte : tournées, véhicules, GPS, capteurs, mobile chauffeur

> **Périmètre** : backend collecte (routes/cav.js, vehicles.js, vehicle-contracts.js, routes/tours/* — 18 fichiers, association-points.js, ml.js, alert-thresholds.js), services (predictive-ai, ml-model, dispatch-optimizer, event-discovery, liveobjects-*, scheduler, TourService), utils (milesight-em400mud, lora-crypto, weather), handler Socket.IO GPS (backend/src/index.js:277-406), schéma init-db.js, et **mobile chauffeur complet** (mobile/src/).
> **Complémente** : `03a-annexe-frontend-collecte.md` (frontend web collecte) et `03b-annexe-frontend-admin-collecte.md` (frontend admin) — leurs synthèses sont citées, non re-auditées. Le bug LiveVehicles `token`/`accessToken` (03a §1) est corrigé (commit 8bcb7fc).
> **Date** : 3-4 juillet 2026 · **Version auditée** : main (2.1.1)

---

## 0. Verdict d'ensemble

Le module collecte est **le plus riche de l'ERP** (18 sous-routeurs tours/, IA prédictive multi-facteurs, ré-optimisation temps réel, capteurs LoRaWAN bout-en-bout, mobile offline-first) mais aussi **le plus fragile** : 3 anomalies critiques (dont un endpoint de supervision 500 systématique et une divergence de complétion de tournée qui court-circuite le flux stock), une dizaine de colonnes SQL inexistantes référencées dans du code masqué par des `catch` silencieux, et une « IA prédictive » dont la formule centrale sature à 120 % pour quasi tous les CAV. L'auth chauffeur « 1 URL = 1 véhicule » est bien implémentée, mais elle coexiste avec **12 endpoints `-public` sans aucune authentification** qui la vident de son sens côté intégrité.

**Note domaine : 5/10** — architecture ambitieuse et souvent bien pensée (offline queue, dedup fcnt, diagnostic capteur 4 couches, advisory lock scheduler), exécution minée par l'absence de tests d'intégration SQL.

---

## 1. Promesse vs réalité

| Promesse (CLAUDE.md / doc) | Réalité | Verdict |
|---|---|---|
| **3 modes tournée** (intelligent/standard/manual) | `tours.mode CHECK` (init-db.js:423), POST `/intelligent` + `/standard` + `/manual` + `/association` (crud.js:168-315) | ✅ Tenu (4 modes même) |
| **GPS 10 s Socket.IO** | Mobile émet `gps-update` toutes les 10 s (TourMap.jsx:156-166), backend INSERT + broadcast `vehicle-position` (index.js:321-330), auth JWT socket (index.js:277-289) | ✅ Tenu **mais** `speed` toujours 0 (TourMap.jsx:163) et **aucun buffering offline** (§5) |
| **IA prédictive météo/événements/vacances/feedback** | Tous les facteurs existent (predictions.js:167-229, context.js:39-82 Open-Meteo, events locaux + auto-discovery OpenAgenda/vide-greniers.fr) | ⚠️ Architecture réelle, **formule centrale buggée** (A5) : le fill sature à 120 %, les facteurs deviennent cosmétiques |
| **OSRM + pause déjeuner** | OSRM Trip TSP + fallback NN+2-opt (geo.js:77-175), pause déjeuner après 4 h + retours centre toutes les 2 t (smart-tour.js:137-166), horaires prévisionnels par CAV (planned-passage.js) | ✅ Tenu — mais serveur OSRM **démo public** par défaut (geo.js:7) et coût N+1 énorme (§6) |
| **Alertes maintenance véhicules** | Job scheduler 3×/j (scheduler.js:300-352) → `vehicle_maintenance_alerts` JSONB ; dashboard flotte (tours/dashboard.js:118-150) | ⚠️ Partiel — la requête de live-summary.js:257-263 lit des **colonnes inexistantes** (`due_at`, `status`) → alertes jamais montrées au superviseur live (A9) |
| **Capteurs Milesight via Live Objects (API+MQTT+webhook)** | Webhook signé timing-safe (webhooks.js), worker MQTT FIFO (liveobjects-mqtt.js), décodeur TLV testable (milesight-em400mud.js), dedup fcnt (index unique partiel init-db.js:2748), diagnostic 4 couches (cav.js:1051) | ✅ Chaîne complète et robuste — **mono-modèle** (§4B) et feedback ML capteur contre-productif (A6) |
| **Auth chauffeur qr_token « 1 URL = 1 véhicule »** | auth.js:43-123 conforme à la doc (hex 32, 401 neutre, is_archived filtré), VehicleLogin.jsx nettoie l'URL | ✅ Tenu **mais** contourné par les endpoints `-public` sans auth (A2) |
| **PWA offline-first** | Files IndexedDB + retry backoff (sync.js) pour **pesées, collectes, incidents** | ⚠️ Partiel — scans QR et GPS **jamais bufferisés**, 2 endpoints de sync **inexistants** (A3), transitions de statut non-offline |

---

## 2. Anomalies (sévérité · fichier:ligne · preuve · impact · correctif)

### 🔴 CRITIQUE

**A1 — `GET /api/tours/active-summary` : 500 systématique (4 colonnes inexistantes)**
- `routes/tours/active-summary.js:16-17` : `SELECT … t.estimated_duration_min, t.distance_km, t.osrm_geometry …` — la table `tours` n'a **ni** `distance_km` (seulement `estimated_distance_km`, init-db.js:428) **ni** `osrm_geometry` (aucune occurrence dans tout init-db.js/migrations — vérifié par grep global).
- `active-summary.js:50` : `tc.weight_kg` — `tour_cav` n'a pas de colonne `weight_kg` (init-db.js:455-470 + migrations :1019,:1026,:1623).
- `active-summary.js:89` : `SUM(net_weight_kg)` — `tour_weights` a `weight_kg`/`tare_kg` (init-db.js:473-480 + :1231-1233), pas `net_weight_kg`.
- **Impact** : la page « Collecte en direct » (LiveVehicles, refonte v1.8.0, poll 30 s) reçoit un 500 à chaque appel → écran vide en silence (le front n'affiche que `console.error`, cf. 03a §4). Le smoke test T-COL-05 (scripts/tests/api-smoke.js:204) ne le voit pas en mode dégradé : sans credentials, le 401 renvoyé avant l'exécution SQL compte comme OK.
- **Correctif** : `t.estimated_distance_km AS distance_km`, supprimer `t.osrm_geometry` et `tc.weight_kg`, `SUM(weight_kg) FILTER (WHERE COALESCE(is_intermediate,false)=false)`. Ajouter le smoke en mode authentifié en CI.

**A2 — 12 endpoints mobiles `-public` sans authentification ni preuve de possession**
- `routes/tours/index.js:45-570` : `GET /vehicle/:vehicleId/today`, `GET /:id/public`, `POST /:id/checklist-public`, `PUT /:id/start-public`, `PUT /:id/cav/:cavId/collect-public`, `POST /:id/scan-public`, `POST /:id/weigh-public`, `POST /:id/incident-public`, `POST /:id/reoptimize-public` (+accept/reject/pending), `PUT /:id/status-public`, `GET /:id/summary-public` — tous montés **avant** `router.use(authenticate)` (:573).
- **Preuve** : IDs de tournée séquentiels (SERIAL) ; n'importe quel client Internet peut `PUT /api/tours/1234/status-public {status:'completed'}` ou injecter des pesées (`weigh-public` recalcule `tours.total_weight_kg`).
- **Impact** : intégrité du tonnage (base des déclarations Refashion et des mouvements de stock) modifiable anonymement ; DoS métier possible (terminer les tournées d'autrui). Paradoxe : le flux qr_token (v2.0.1) délivre un JWT que le mobile possède déjà (`driverStart`, AuthContext.jsx:39-45) mais que ces endpoints n'exigent pas — le mobile les appelle en `fetch` nu (sync.js:117,217,266 ; Checklist.jsx:47,58 ; ReturnCentre.jsx:15).
- **Correctif** : exiger le JWT chauffeur (l'infra est déjà là : intercepteur axios + refresh) et vérifier que `tour.vehicle_id` = véhicule du token ; à défaut, exiger le `vehicle_token` en header sur chaque `-public` + rate limiting dédié.

**A3 — Deux chemins de complétion divergents : les tournées finalisées par le mobile ne créent NI mouvement de stock NI feedback ML NI tonnage par CAV**
- Chemin web/authentifié `PUT /:id/status` (execution.js:195-243) sur `completed` : répartit le poids dans `tonnage_history` par CAV collecté (:200-210), crée `stock_movements` entrée collecte (:213-218) + `stock_original_movements` (:221-227), alimente `collection_learning_feedback` prédit-vs-observé (:231-243), passe le véhicule `in_use` sur in_progress (:246).
- Chemin mobile `PUT /:id/status-public` (tours/index.js:388-461) : change le statut, persiste km/notes, push managers — **aucun des 5 effets ci-dessus**.
- **Preuve d'usage** : la finalisation mobile passe par `sendWeight → status-public completed` (sync.js:133-151) et ReturnCentre.jsx:15-23.
- **Impact** : pour toute tournée pilotée depuis le téléphone (le cas nominal), la chaîne stock (entrée matière collecte → tri) démarre à vide, `tonnage_history` ne reçoit rien (donc l'« IA » n'a plus d'historique frais par CAV), la boucle d'apprentissage prédit/observé est morte. Leur propre détecteur (« Tours sans mouvement de stock », stats.js:118-128) l'aurait signalé… mais `/reporting/anomalies` est lui-même en 500 (A8).
- **Correctif** : extraire un `completeTour(tourId, userId)` unique (service) appelé par les deux routes.

**A4 — Dispatch automatique J-1 (Niveau 3.1) : 100 % d'échec silencieux**
- `services/dispatch-optimizer.js:57-69` : `INSERT INTO tours (date, vehicle_id, mode, status, ai_explanation, …)` — **sans `driver_employee_id`**, colonne `NOT NULL` depuis l'origine (init-db.js:421, re-forcée :1987-1988).
- **Impact** : chaque soir 18 h (scheduler.js:608-615) et via `POST /dashboard/dispatch-next-day`, chaque véhicule part en `results.errors++` avec un simple `console.warn` (:87-91). La fonctionnalité est morte depuis sa livraison. Même bug latent sur `POST /tours/intelligent` sans `driver_employee_id` fourni (crud.js:176,183-186 : `did = null` → 500) et sur la désaffectation planning (`PATCH /:id/assign` avec `driver_employee_id: null`, planning.js:115,142-147 — le commentaire promet « Passer null pour déaffecter », la contrainte NOT NULL le refuse).
- **Correctif** : utiliser `vehicles.assigned_driver_id` comme chauffeur par défaut, sinon sauter le véhicule avec un statut explicite ; décider si `tours.driver_employee_id` doit être nullable (tournée « à affecter ») — c'est le modèle qu'attendent planning.js et dispatch-optimizer.

### 🟠 MAJEUR

**A5 — Formule de remplissage sans normalisation par capacité : l'IA prédictive sature à 120 %**
- `routes/tours/predictions.js:162-165` : `dailyAccumulation = avgWeight/7` (kg/j) puis `rawFill = (daysSince × dailyAccumulation / nb_containers) × 100` — on multiplie des **kg** par 100 comme si c'était une fraction. Ex. réel : 70 kg/collecte hebdo, 1 conteneur, 7 j → `(7×10/1)×100 = 7000` → cap 120 (:308). Il suffit de ~0,85 kg accumulé pour saturer.
- **Preuve interne** : `GET /api/cav/fill-rate` fait le même calcul **correctement** avec `capacityKg = nb_containers × 150` puis `(accumulatedKg/capacityKg)×100` (cav.js:158-164). `GET /api/cav/map` a la même formule cassée que predictions.js (cav.js:87).
- **Impact** : quasi tous les CAV avec historique prédisent 100-120 % → le scoring de tournée (smart-tour.js:56-77) ne discrimine plus que par `daysSince`/`nb_containers`/confiance ; les facteurs météo/vacances/événements soigneusement construits sont écrasés par le cap ; FillRateMap et la génération de tournée affichent des chiffres incompatibles pour le même CAV. Même bug côté associations (predictions.js:390, sans même le diviseur conteneurs).
- **Correctif** : introduire une capacité kg par CAV (colonne, défaut `nb_containers×150` aligné sur cav.js:158) et diviser. Recalibrer le scoring ensuite.

**A6 — Le feedback capteur empoisonne la correction ML des CAV équipés de sondes**
- `services/liveobjects-processor.js:229-241` insère à **chaque uplink** une ligne `collection_learning_feedback (predicted_fill_rate=cav.estimated_fill_rate, observed_fill_rate=…, source='sensor')` avec `observed_fill_level` (0-5) **NULL**.
- `predictions.js:233-254` relit les 60 dernières lignes **sans filtre** et calcule `observedPct = (row.observed_fill_level ?? 0) × 20` → chaque ligne capteur vaut « observé 0 % » → `cavCorrection` plonge au plancher 0.5 (:254).
- **Impact** : plus un CAV a de sondes actives (8 uplinks/j à 180 min), plus sa prédiction de tournée est **divisée par 2** — l'investissement capteur dégrade la planification. En prime : `cav.estimated_fill_rate` n'est **jamais mis à jour nulle part** (grep global : aucun `UPDATE cav SET estimated_fill_rate`) donc le « prédit » comparé est un reliquat d'import figé ; et sur une base fraîchement initialisée, les colonnes `observed_fill_rate`/`source` n'existent qu'après le 2ᵉ boot (migrate-cav-sensors.js:85-95 appelé seulement dans la branche « tables existantes », index.js:451-456) — l'INSERT échoue alors **dans la transaction** et Postgres avorte tout `processUplink` (25P02) → lectures capteur perdues jusqu'au restart suivant.
- **Correctif** : filtrer `WHERE observed_fill_level IS NOT NULL` (ou `source='manual'`) dans predictions.js:233 ; sortir le feedback de la TX principale ; déplacer la migration dans init-db.js.

**A7 — Mobile offline : scans QR et GPS jamais synchronisés, deux endpoints de sync inexistants**
- `mobile/src/services/sync.js:89` poste `/tours/${tourId}/scan` — **n'existe pas** (seul `/:id/scan-public`, tours/index.js:227) → 404 → politique « 4xx = suppression » (:97-100) purge la file.
- `sync.js:187` poste `/tours/gps-batch` — **n'existe nulle part** dans le backend (grep global) → 404 → batch supprimé (:200-202).
- Aggravant : **aucun producteur** — `addPendingScan` (db.js:151) n'est appelé par personne ; IdentifyCav.jsx:85-91 stocke le scan en localStorage sans jamais POSTer (ni online ni offline) ; rien n'écrit dans `gpsBuffer`. Ironie : le « bon » endpoint existe même en double — `POST /api/cav/scan-qr` (authentifié, cav.js:275-321) fait tout correctement (résolution par `qr_code_data`, insert `cav_qr_scans` avec GPS, marquage `tour_cav.qr_scanned`) et le mobile possède le JWT pour l'appeler.
- **Impact** : la table `cav_qr_scans` n'est jamais alimentée par le flux chauffeur (traçabilité scan morte, l'historique de scans d'AdminCAV reste vide) ; le GPS n'existe qu'en temps réel socket — toute zone blanche = trou définitif dans `gps_positions` (temps de collecte appris `cav_collection_times` amputés).
- **Correctif** : créer `POST /api/tours/:id/scan-public` batch + `POST /api/tours/gps-batch-public` ; appeler `addPendingScan`/buffer GPS dans IdentifyCav/TourMap ; en attendant, corriger les URLs de sync.js.

**A8 — Types d'incidents mobiles hors CHECK : signalements sécurité perdus en boucle infinie**
- `mobile/src/pages/Incident.jsx:15,17` propose `cav_overflow` et `security` ; la contrainte est `CHECK (type IN ('cav_problem','environment','vehicle_breakdown','accident','other'))` (init-db.js:489).
- **Impact** : `POST /:id/incident-public` → violation 23514 → 500 → sync.js:12-13 traite le 5xx comme erreur réseau → l'incident reste en file **pour toujours** (retry 5 min), le chauffeur a pourtant vu l'écran de confirmation (UI optimiste, Incident.jsx:89-90) et les managers ne reçoivent jamais le push « agression/menace ». Bug de la même famille que le « CHECK constraint mobile » récurrent des audits d'avril.
- **Correctif** : élargir le CHECK (`cav_overflow`,`security`) — 1 ligne idempotente — ou mapper côté mobile.

**A9 — Colonnes fantômes silencieusement absorbées par des catch**
- `routes/tours/stats.js:84` : `c.nom as cav_nom` — la table `cav` a `name` (init-db.js:357) → **`GET /reporting/anomalies` = 500** (le propre outil de détection d'anomalies est cassé).
- `routes/tours/stats.js:144,154-155` : `c.nom`, `c.type`, `c.is_active` — aucune de ces 3 colonnes n'existe sur `cav` (c'est `name` et `status`) → **`GET /reporting/cav-analytics` = 500** également.
- `services/predictive-ai.js:59-61` : `t.type`, `t.start_time`, `t.end_time` — inexistants sur `tours` (c'est `mode`, `started_at`, `completed_at`) → `GET /predictive/ia/synthese` et `/predictive/ia/ajustements` (stats.js:461-489, page AdminPredictive) = 500.
- `routes/tours/live-summary.js:257-263` : `SELECT type, description, due_at, due_km FROM vehicle_maintenance_alerts WHERE status='pending'` — la table réelle a `alert_date, alerts JSONB, is_resolved` (init-db.js:2657-2667) → erreur avalée par `catch(_){}` (:272) → **les alertes maintenance ne remontent jamais** dans la supervision live.
- **Correctif** : corriger les 3 requêtes ; règle de revue : interdire `catch(_) {}` sur les requêtes SQL (logger au minimum).

**A10 — `vehicles.status='in_use'` : aller simple**
- `execution.js:246` passe le véhicule `in_use` au démarrage (chemin authentifié uniquement) ; **aucun code ne le repasse `available`** (grep global : seule écriture inverse inexistante).
- **Impact** : après sa première tournée démarrée côté web, le véhicule disparaît de `GET /tours/my` « véhicules libres » (execution.js:63 filtre `status='available'`) et du claim mobile ; proposals.js:22 contourne en incluant `in_use`. Incohérence supplémentaire : le chemin mobile `status-public` ne touche jamais ce statut.
- **Correctif** : reset à `available` sur completed/cancelled dans le service de complétion unique (A3).

**A11 — Config du moteur prédictif volatile et éclatée**
- Les facteurs saisonniers/jours/fériés/vacances/scoring sont des `let` module (predictions.js:11-95) mutés par `PUT /predictive-config` (crud.js:70-102) — **perdus à chaque redéploiement/restart** (aucune persistance settings/DB).
- Jours fériés et vacances scolaires **hardcodés jusqu'à l'été 2027** (predictions.js:20-64) : bombe à retardement silencieuse. Le job annuel `syncAllHolidays` (scheduler.js:663-672) alimente bien les tables `jours_feries`/`vacances_scolaires` depuis api.gouv.fr (holidays.js:27-45) — **mais le moteur ne les lit jamais** : leur seul consommateur est un compteur d'affichage (events-auto.js:783-789). `isHoliday()` et `getSchoolVacationStatus()` continuent de lire les tableaux en dur.
- Le recalcul mensuel `recalcSeasonalFactors` (predictive-ai.js:408-472, cron 1ᵉʳ du mois) écrit `predictive_seasonal_factors`… **que le moteur ne lit jamais** (seul un `MAX(computed_at)` d'affichage, events-auto.js:785).
- `/cav/map` et `/cav/fill-rate` utilisent un **troisième** jeu de facteurs saisonniers hardcodé différent (cav.js:78,141 : `[0.8…1.2]` vs predictions.js:11 `[0.88…0.75]`) — le réglage AdminPredictive n'a aucun effet sur les cartes. S'ajoute au bug front « Appliquer sans effet » (annexe 03b §1) : la boucle de calibration est cassée à 3 étages.
- **Correctif** : persister la config dans `settings` (pattern déjà utilisé pour SumUp), charger au boot, faire lire `predictive_seasonal_factors` par predictions.js, factoriser les facteurs dans un module unique.

### 🟡 MODÉRÉ

- **A12** `checklist-public` : `ON CONFLICT DO NOTHING` sans contrainte UNIQUE sur `vehicle_checklists(tour_id)` (tours/index.js:148-153 vs init-db.js:525-537) → doublons de checklists à chaque re-soumission ; et `GET /:id (crud.js:149-152)` prend `rows[0]` arbitraire.
- **A13** Checklist mobile : `fuel_level:'1/2'` **codé en dur** (Checklist.jsx:53 — la donnée carburant est fictive), `notes` envoyées mais **ignorées** par le backend (tours/index.js:147 ne destructure pas `notes`), et le bouton n'est actif que si les 11 cases sont cochées (:75) → impossible de déclarer un point KO : le chauffeur coche « tout va bien » pour pouvoir partir (donnée QHSE faussée).
- **A14** Pesées intermédiaires ambivalentes : total public = `SUM … WHERE is_intermediate=false` (tours/index.js:262-267) vs total authentifié = `SUM` de tout (execution.js:327-329). Si le chauffeur décharge au retour intermédiaire (c'est le scénario nominal du seuil 2 t, smart-tour.js:156-166), le total public **sous-compte** le tonnage de la tournée → impact Refashion/stock.
- **A15** TourSummary mobile : CO₂ = `poids × 1.493` (TourSummary.jsx:65) vs web `× 1.567` (ReportingCollecte.jsx:53, cf. 03a) — deux facteurs magiques différents ; distance = `checklist.km_end - km_start` (:66-68) alors que ReturnCentre écrit `km_end` sur **tours** (status-public), jamais sur la checklist → distance quasi toujours absente du récap chauffeur.
- **A16** `PUT /:id/status` authentifié (execution.js:165-167) : n'inclut pas `returning` dans le validator (le web ne peut pas suivre le cycle complet) et **aucune table de transitions** (n'importe quel état → n'importe quel état), contrairement au `-public` (tours/index.js:395-408). Ni l'un ni l'autre ne passent par `services/state-machine` (pattern V6.1 pourtant validé).
- **A17** Socket.IO GPS : aucune validation de `latitude/longitude` (index.js:321-330) — un payload malformé insère NaN/null et jette (log errer seulement) ; `cavProximity` n'est pas purgé au `disconnect` (:374-377, fuite bénigne par socket) ; si le chauffeur se déconnecte dans le rayon 100 m, le temps de collecte en cours est perdu (`cav_collection_times` — table bien créée, init-db.js:3110-3122, la question est levée).
- **A18** `evenements_locaux` créée deux fois à l'identique (init-db.js:999 et :2168) — dead code trompeur ; `alert_thresholds` (init-db.js:3839) ne couvre pas les seuils capteurs, qui restent hardcodés (processor.js:16-22 : 80/95/20 %/60°/-10°) — cf. annexe 03b §4 (absents du formulaire).
- **A19** OSRM : `planned-passage.js:29` et `reoptimize-service.js:26` font `fetch(url)` **sans timeout** (geo.js a pourtant `fetchWithTimeout`) → un OSRM public lent gèle les calculs d'horaires en arrière-plan.
- **A20** Créations multi-INSERT sans transaction : tournées (crud.js:182-196, :222-239, :260-272, :294-308), `applyReoptimization` (reoptimize-service.js:208-213) → tournées orphelines/positions incohérentes possibles en cas d'échec partiel.
- **A21** `GET /:id/live-summary` charge **toutes** les positions GPS de la tournée sans LIMIT (live-summary.js:109-114 — le commentaire dit « 200 dernières ») : ~2 900 lignes/8 h re-parcourues à chaque poll du détail tournée.
- **A22** `getContextForDate` (context.js:43) appelle Open-Meteo `forecast` pour toute date absente du cache : pour une date passée >7 j l'API renvoie vide → facteurs neutres silencieux (les analyses rétrospectives croient à une météo neutre).
- **A23** Échéancier maintenance : le rapprochement opération↔événement se fait par `description.toLowerCase().includes(premier_mot_du_label)` (vehicles.js:1018-1019, :1046-1047) — « Filtre à air » et « Filtre habitacle » se confondent sur « filtre » → statuts `ok/dépassé` potentiellement faux. Prévoir un `item_code` sur `vehicle_events`. (Les profils constructeur hardcodés subsistent en fallback :399, `profile_source` le signale honnêtement :974.)

---

## 3. Logique des routeurs tours/ (montage, ordre, conflits)

**Cartographie** (`routes/tours/index.js`) : 12 endpoints `-public` inline (:45-570) → `authenticate` (:573) → montage dans l'ordre : `live-summary`, `active-summary`, `reoptimize`, `planning`, `dashboard`, `execution(upload)`, `events`, `events-auto`, `stats`, `proposals`, **`crud` en dernier** (:576-605) — le commentaire « must be after more specific routes » est respecté : le `GET /:id` de crud.js:105 ne masque aucune route à segment unique déclarée avant.

Points relevés :
- **Pas de conflit de path détecté** entre sous-routeurs (préfixes distincts : `/events*`, `/reporting/*`, `/predictive/*`, `/proposals/*`, `/planning/*`, `/dashboard/*`, `/:id/<action>`). `GET /predictive-config` est bien déclaré avant `GET /:id` dans crud.js (:53 vs :105).
- `GET /:id` (crud.js:105) ne valide pas que l'id est numérique → `GET /api/tours/xyz` = 500 pg 22P02 au lieu de 404 (live-summary.js:31-34 fait le contrôle proprement — pattern à généraliser).
- **Doublons fonctionnels** : le couple `-public`/authentifié duplique 8 logiques avec des side effects divergents (A3, A14) ; `GET /vehicle/:vehicleId/today` (public) recouvre `GET /my` (authentifié) ; deux écritures de checklist (`/checklist-public` vs `/:id/checklist`) avec champs différents.
- Le routeur `events.js` est ADMIN/MANAGER en lecture mais la config prédictive dans **crud.js** (au lieu d'un fichier dédié) et `PUT /context` dans **proposals.js** (:198) — organisation surprenante mais fonctionnelle.
- `cav.js` gère correctement l'ordre (`/sensors`, `/liveobjects-devices`, `/communes`, `/map`, `/fill-rate` déclarés avant `GET /:id` :830 — commentaire explicite :620). `vehicles.js` aussi (`/available` :133 avant `authenticate` :154 — **donc public par design**, il expose la flotte + tournées du jour sans auth : ancien vecteur d'énumération partiellement réintroduit, à re-protéger).

---

## 4. Extensibilité — nouveau véhicule & nouvelles sondes

### 4A. Ajouter un véhicule (parcours réel, testé sur le code)

1. **Créer** : `POST /api/vehicles {registration}` (vehicles.js:286-320) — seul champ obligatoire ; `qr_token` auto-généré par DEFAULT SQL (init-db.js:4210-4218) et jamais exposé dans la réponse (:313).
2. **Configurer** (optionnel) : `tare_weight_kg`, `max_capacity_kg` (défaut 3 500), `vehicle_type`, team ; affecter un chauffeur (`PUT /:id/assign-driver`, vehicles.js:348 — unicité chauffeur↔véhicule vérifiée :353-363).
3. **Maintenance** : `PUT /:id/maintenance` (upsert `vehicle_maintenance`) ; plan constructeur généré par IA (`POST /maintenance/generate-plan`, vehicles.js:1209 — les profils préchargés ont été retirés :122-130, dépendance à `ANTHROPIC_API_KEY`) ; contrat prestataire via `/api/vehicle-contracts`.
4. **Pairing chauffeur** : `GET /:id/access-info` (ADMIN) → URL `/v/<qr_token>` → raccourci écran d'accueil (D3). Révocation : `POST /:id/regenerate-token`.

**Verdict véhicule : BON (≈15 min, sans code).** Frictions réelles :
- **`tare_weight_kg` saisi mais jamais servi** : WeighIn.jsx:11 fait ressaisir la tare à la main à chaque pesée (chauffeur en insertion, à froid, de tête) et `weigh-public` ne la préremplit pas — risque d'erreur maximal là où la donnée existe déjà en base.
- Bug A10 (`in_use` défini permanent) peut faire « disparaître » le véhicule des libres.
- La capacité alimente le moteur intelligent (smart-tour.js:83) mais aucun écran ne prévient si `max_capacity_kg` reste au défaut 3 500 pour un petit utilitaire.
- `GET /available` public (vehicles.js:133) : penser à l'exclure du nouveau véhicule tant qu'il n'est pas en service (`out_of_service` seul filtre).

### 4B. Ajouter une sonde de remplissage

**Cas 1 — un EM400-MUD de plus : SIMPLE (sans code).**
1. Déclarer le device côté **console Orange Live Objects** (l'app **liste** les devices — `GET /api/cav/liveobjects-devices`, cav.js:654 — mais ne les **crée pas** : liveobjects-api.js n'a pas d'appel de provisioning ; étape manuelle Orange obligatoire).
2. `POST /api/cav/:id/sensor/provision {dev_eui, sensor_height_cm(30-500), sensor_reporting_interval_min}` (cav.js:706-757) — unicité DevEUI (:719-725), AppKey chiffrée AES-256-CBC (lora-crypto.js), `sensor_height_cm` = calibration du % (computeFillPercent, milesight-em400mud.js:122-126).
3. Les uplinks arrivent par webhook signé (`X-Webhook-Secret`, timing-safe) **et/ou** MQTT FIFO — dédupliqués par `(cav_id, fcnt)` (init-db.js:2748). Diagnostic 4 couches intégré (`GET /:id/sensor-diagnostic`, cav.js:1051) : excellent outil d'installation terrain.

**Cas 2 — un AUTRE modèle de sonde : CODE REQUIS.**
- Le décodeur est **unique et câblé en dur** : liveobjects-processor.js:3 importe `milesight-em400mud` et :62 l'applique à tout payload LoRa, quel que soit `cav.sensor_type` (colonne VARCHAR libre, défaut 'ultrasonic', **jamais consultée au décodage**). Un capteur d'un autre constructeur produira des canaux TLV inconnus → champs null → `fill_not_computable` (ou pire : décodage faux silencieux si collision d'octets).
- Le fallback « payload aplati » (`POST /api/cav/sensor-reading` avec `fill_level_percent` précalculé, processor.js:31-51) permet d'intégrer n'importe quoi **si** un middleware externe décode — échappatoire réaliste à court terme.
- **Seuils d'alerte non configurables** : 80/95 % remplissage, 20 % batterie, 60/-10 °C figés (processor.js:16-22) — ni par CAV, ni via la table `alert_thresholds`, ni dans le formulaire (annexe 03b §4). Une benne enterrée ou un textile dense qui « tasse » ne peut pas avoir son propre seuil.
- Divergence de fraîcheur : défaut 8 h sur `/map` (cav.js:79) vs 48 h sur `/fill-rate` (cav.js:146) pour le même `SENSOR_FRESHNESS_HOURS` non défini → la carte peut dire « heuristique » quand FillRateMap dit « capteur ».
- **Angle mort majeur** : les lectures capteur ne nourrissent **pas** le moteur de tournée (predictions.js les ignore ; pire, elles le dégradent — A6). Une sonde à 95 % ne rend pas son CAV prioritaire dans la tournée intelligente.

**Recommandations extensibilité** : (1) registre de décodeurs `{sensor_type|fport → decoder}` + choix du modèle au provisioning ; (2) seuils par CAV (colonnes ou JSONB) avec défauts globaux dans `settings` ; (3) court-circuit sonde dans `predictFillRate` (si lecture < 48 h : l'utiliser comme base et n'appliquer que la projection d'accumulation) ; (4) préremplissage tare véhicule dans WeighIn.

---

## 5. Simplicité du parcours mobile chauffeur

**Points forts (réels et soignés)** : gros boutons ≥72 px, une action principale par écran (PrimaryActionBar), vibrations haptiques systématiques, mode d'usage conduite/arrêt qui simplifie l'UI (UsageModeContext), écrans de confirmation avec « Corriger » tant que non envoyé (StepConfirmScreen + drafts IndexedDB, FillLevel.jsx:59-69), fallback caméra→liste→code manuel pour le scan (IdentifyCav.jsx), presets d'incidents évitant le clavier (Incident.jsx:24-32), 6 niveaux de remplissage visuels dont « au-delà » qui pose l'anomalie débordement automatiquement (FillLevel.jsx:16-23), offline-first **véritable** pour pesée/collecte/incident (écriture locale avant envoi, FillLevel.jsx:114-144, WeighIn.jsx:50-77), bannière de sync avec bouton manuel, re-auth automatique par raccourci.

**Trous dans la raquette** :
1. **Erreurs réseau muettes sur les transitions** : Checklist.submit (:44-62) et ReturnCentre.submit (:12-27) → `console.error` seul ; hors réseau le chauffeur reste bloqué sans message ni file d'attente (start/returning/completed ne sont pas offline-capable) — alors que la pesée qui suit, elle, l'est.
2. **Données perdues** : scans QR (jamais transmis, A7), notes de checklist (ignorées backend, A13), incidents sécurité (CHECK, A8), GPS hors couverture (pas de buffer, A7), niveau carburant (fictif, A13).
3. `TourMap.currentCavIndex = nombre de collectés` (TourMap.jsx:99-100) : si un CAV est sauté, l'index pointe sur un point potentiellement déjà traité — le « prochain point » peut mentir après un skip. D'ailleurs **aucun bouton « passer ce CAV »** n'existe côté chauffeur (le `skip_reason` soigné du backend, execution.js:281-284, n'est alimenté que par le web) : le chauffeur coincé devant une CAV inaccessible doit passer par Incident, qui ne marque pas le point `skipped`.
4. Icônes Leaflet par défaut chargées depuis cdnjs (TourMap.jsx:14-16) — inutile (DivIcons partout) mais dépendance réseau externe dans une PWA.
5. `predicted_fill_rate || estimated_fill_rate` affiché « 0 % remplissage » pour toute tournée standard/manuelle (TourMap.jsx:434) — information fausse plutôt qu'absente.

---

## 6. Optimisations (requêtes GPS, index, N+1)

1. **Génération de tournée intelligente = N+1 massif** : `generateIntelligentTour` appelle `predictFillRate` séquentiellement pour **tous les CAV actifs** (~209) (smart-tour.js:50-53), chaque prédiction = 5-6 requêtes SQL (historique, cav, contexte, 3 feedbacks) ≈ **1 200 requêtes**, puis 2 appels OSRM HTTP **par CAV sélectionné** (:169 + :182, le check de durée refait un aller-retour centre à chaque itération) ≈ 60+ appels séquentiels à 4 s de timeout. `proposals/daily` ×5 véhicules (proposals.js:37-53), `weekly` ×7 jours. → Batcher les prédictions (une requête agrégée par table), mémoïser le contexte/événements du jour (déjà fait implicitement via cache SQL, pas en mémoire), utiliser `osrmDistanceMatrix` (déjà écrit, geo.js:56, **jamais utilisé**) au lieu de segments unitaires.
2. **GPS** : INSERT unitaire par position toutes les 10 s/véhicule — acceptable (≤3 véhicules), mais `live-summary` relit tout l'historique sans LIMIT à chaque poll (A21) → `ORDER BY recorded_at DESC LIMIT 500` + somme incrémentale, et purge 90 j déjà en place (scheduler.js:493-511 ✅). Index existants sains : `idx_gps_tour`, `idx_gps_time`, `(vehicle_id, recorded_at)` (V1.5.0).
3. **Sous-requêtes corrélées** dans les listes (`GET /tours` crud.js:19-26 : 2 sous-requêtes/ligne ; dashboard.js:28-37 idem) sans pagination — passer en LEFT JOIN LATERAL/GROUP BY + `LIMIT/OFFSET` (`utils/pagination.js` existe déjà). `dashboard.js:127-138` : 1 requête contrat/véhicule (petite flotte, tolérable).
4. Cache mémoire tourCavsCache/throttle 5 s du handler GPS (index.js:315-346) : bon travail (V1.5.0) ; le `disconnect` qui `clear()` les Maps par-connexion est inutile mais inoffensif.

---

## 7. Évolutions proposées

1. **Service `TourLifecycle` unique** (complétion/démarrage) partagé public/authentifié, branché sur `services/state-machine` (V6.1) — corrige A3/A10/A16 d'un coup et prépare le multi-site.
2. **Planification « sensor-aware »** : injecter `sensor_last_reading` frais dans `predictFillRate` + seuil de déclenchement de tournée sur alerte 80/95 % (les alertes existent déjà, il manque le pont vers `proposals`). C'est LA valeur ajoutée des sondes achetées.
3. **Registre de décodeurs multi-modèles + seuils par CAV** (cf. §4B) avant l'arrivée des nouvelles sondes.
4. **Offline complet** : endpoints batch publics (GPS, scans, statuts), file unique événementielle avec `client_id` idempotent (le champ est déjà envoyé partout et « ignoré par le backend actuel », sync.js:125,225,274 — il suffit d'une colonne UNIQUE pour déduper les retries).
5. **OSRM self-hosted** (conteneur ~1 Go Normandie) — supprime la dépendance au serveur démo public (geo.js:5-7 le recommande lui-même) et divise la latence de génération.
6. Persister la config prédictive dans `settings` + UI de calibration réparée (A11 + annexe 03b §1) ; boucler `recalcSeasonalFactors` sur le moteur.
7. Bouton « CAV inaccessible » chauffeur → `status='skipped'` + `skip_reason` + re-optimisation auto (le backend est prêt : trigger `skipped` existe, tour_reoptimizations CHECK :1038).

---

## 8. Quick wins sûrs (faible risque, gain immédiat)

| # | Fix | Fichier | Effort |
|---|-----|---------|--------|
| 1 | `estimated_distance_km AS distance_km`, retirer `osrm_geometry`/`tc.weight_kg`, `SUM(weight_kg) FILTER (…)` | active-summary.js:16-17,50,89 | 15 min |
| 2 | `c.nom` → `c.name` | stats.js:84 | 1 min |
| 3 | `t.type, t.start_time, t.end_time` → `t.mode, t.started_at, t.completed_at` | predictive-ai.js:58-61 | 5 min |
| 4 | Élargir CHECK incidents (`cav_overflow`, `security`) | init-db.js:489 (migration idempotente) | 10 min |
| 5 | `WHERE observed_fill_level IS NOT NULL` dans la lecture feedback | predictions.js:233-237 | 5 min |
| 6 | Dispatch J-1 : `driver_employee_id = vehicles.assigned_driver_id` sinon skip explicite | dispatch-optimizer.js:57-69 | 20 min |
| 7 | sync.js : `/scan` → `/scan-public` ; désactiver le sync GPS tant que l'endpoint n'existe pas (au lieu de purger) | mobile/sync.js:89,187 | 15 min |
| 8 | Préremplir la tare depuis `vehicles.tare_weight_kg` | WeighIn.jsx + summary-public ou /vehicle/today | 30 min |
| 9 | `UPDATE vehicles SET status='available'` sur completed/cancelled | execution.js + tours/index.js (status-public) | 15 min |
| 10 | UNIQUE `vehicle_checklists(tour_id)` + dédup préalable | init-db.js | 15 min |
| 11 | Persister `fuel_level` réel (4 gros boutons ¼/½/¾/plein) + transmettre `notes` | Checklist.jsx:53 + tours/index.js:147 | 45 min |
| 12 | Timeout sur les fetch OSRM de planned-passage/reoptimize (réutiliser `fetchWithTimeout`) | planned-passage.js:29, reoptimize-service.js:26 | 10 min |

---

## Annexe — réponses aux questions posées

- **`cav_collection_times` est-elle créée ?** OUI — init-db.js:3110-3122 (+ index cav_id). L'INSERT du handler GPS (index.js:360) fonctionne ; le `catch` « table pas encore créée » est un vestige. Elle alimente réellement `getLearnedTimePerCav` (smart-tour.js:11-24, moyenne si ≥3 échantillons) et le temps de service planned-passage (commentaire :18).
- **Payloads Socket.IO front/back** : mobile émet `gps-update {tourId, vehicleId, latitude, longitude, speed}` (TourMap.jsx:158-164) = attendu backend (index.js:321-322) ✅ ; rooms `join-tour`/`tour-${id}` alignées ✅ ; events descendants `vehicle-position`, `cav-status-update`, `tour-status-update`, `reoptimization-*` cohérents avec le web (cf. 03a). Le bug historique de mismatch est résolu ; restent `speed:0` (A17) et l'absence d'émission `cav-collected` par le mobile (le backend enrichit cet event, index.js:385-400, mais seul le web l'émet — la supervision live est mise à jour par les events `cav-status-update` émis par `PUT /:tourId/cav/:cavId` web, pas par le flux mobile `collect-public` qui n'émet **rien**) → **le manager ne voit pas les collectes mobiles en temps réel**, seulement au refetch 30 s (et encore, via active-summary… qui est en 500, A1).

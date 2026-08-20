# Logique de fonctionnement des tournées — SOLIDATA

> Ce document décrit la logique métier et technique complète du module de collecte / tournées.
> Dernière mise à jour : 11 avril 2026

---

## 1. Vue d'ensemble

Le module **tournées** (`/api/tours`) gère le cycle complet des collectes textiles :

```
Planification IA  →  Affectation chauffeur  →  Exécution terrain (mobile)  →  Complétion  →  Reporting
```

Il couvre deux types de collecte distincts :
- **Collecte PAV** (Points d'Apport Volontaire / CAV) : conteneurs de rue géolocalisés
- **Collecte association** : points fixes partenaires (associations caritatives)

---

## 2. Architecture des fichiers

```
backend/src/routes/tours/
├── index.js          # Montage des sous-routes + endpoints mobiles publics
├── crud.js           # CRUD tournées, 4 modes de création, config prédictive
├── execution.js      # Exécution temps réel (authentifié)
├── geo.js            # Algorithmes géographiques (OSRM, TSP, Haversine)
├── predictions.js    # Moteur prédictif IA remplissage CAV (V2)
├── smart-tour.js     # Génération tournée intelligente
├── stats.js          # Reporting, KPIs, précision prédictive
├── context.js        # Météo (Open-Meteo), cache contexte
├── events.js         # Gestion manuelle événements locaux
├── events-auto.js    # Découverte automatique événements (4 sources API)
└── proposals.js      # Propositions quotidiennes / hebdomadaires
```

---

## 3. Tables de base de données

| Table | Rôle |
|-------|------|
| `tours` | En-tête tournée (date, vehicle_id, driver_id, status, mode, collection_type, nb_cav, total_weight_kg) |
| `tour_cav` | Points CAV d'une tournée (position, status, fill_level, predicted_fill_rate, qr_scanned, collected_at) |
| `tour_association_point` | Points association d'une tournée |
| `cav` | Référentiel CAV (name, commune, lat, lng, nb_containers, is_active) |
| `association_points` | Points association (name, address, lat, lng) |
| `vehicles` | Véhicules (max_capacity_kg, status, current_km) |
| `employees` | Chauffeurs (lien via user_id) |
| `standard_routes` | Routes standard pré-définies (PAV ou association) |
| `standard_route_cav` | CAV d'une route standard |
| `standard_route_association` | Points d'une route association standard |
| `vehicle_checklists` | Checklist départ/arrivée (km, carburant, état) |
| `tour_weights` | Pesées intermédiaires (poids_kg, recorded_at) |
| `incidents` | Incidents terrain (type, description, photo) |
| `gps_positions` | Positions GPS temps réel (lat, lng, recorded_at) |
| `cav_qr_scans` | Scans QR codes (cav_id, tour_id, scanned_at) |
| `tonnage_history` | Historique poids par CAV (base d'apprentissage IA) |
| `tonnage_history_association` | Historique poids par point association |
| `collection_context` | Cache météo/contexte (date → weather_factor, temp_max, precip_mm) |
| `collection_learning_feedback` | Feedback ML (predicted_fill_rate vs observed_fill_level) |
| `association_learning_feedback` | Feedback ML points association |
| `evenements_locaux` | Événements (brocante, braderie…) avec coordonnées et bonus_factor |
| `cav_collection_times` | Temps de collecte appris par CAV (duration_seconds) |

---

## 4. Statuts d'une tournée

```
planned → in_progress → returning → completed
                                  ↘ cancelled
```

| Statut | Description |
|--------|-------------|
| `planned` | Tournée créée, non démarrée |
| `in_progress` | Chauffeur en cours de collecte |
| `returning` | Retour au centre en cours |
| `completed` | Tournée terminée, stock mis à jour |
| `cancelled` | Annulée |

La transition `planned → in_progress` est **atomique** (ON CONFLICT / lock applicatif) : un seul chauffeur peut "claim" une tournée donnée.

---

## 5. Modes de création d'une tournée

### 5.0 Contraintes de temps communes — moteur `services/tour-time-engine.js`

Depuis la refonte « planification » (août 2026), **tous les modes** partagent le même
moteur de temps PUR (aucune I/O, trajets injectés) :

- **Budget de travail : 6 h/jour** (`maxDailyHours`, défaut 6) = conduite + collecte
  + déchargements. La **pause déjeuner n'est PAS du temps de travail** mais les
  trajets pour revenir au centre la prendre en font partie.
- **Pause déjeuner obligatoire au centre de tri**, déclenchée soit après
  `lunchAfterHours` (4 h) de travail cumulé, soit dès que l'horloge atteint
  `lunchStartHour` (12 h) — départ estimé à `workdayStartHour` (8 h). Durée
  `lunchBreakMinutes` (30). Une tournée courte finissant avant midi n'en insère pas.
- **Retours de vidage** : dès que la charge atteindrait
  `min(returnEveryKg, vehicleFillReturnPct % × max_capacity_kg du véhicule)`,
  insertion d'un retour centre (trajet compté) + déchargement `unloadMinutes` (15).
  Un vidage dû au moment de la pause est mutualisé avec elle (un seul trajet).
- Deux entrées : `buildTimeline(points)` (liste FIXE — peut être infaisable →
  `faisable:false` + `depassement_min`) et `planWithBudget(candidats)` (sélection
  gloutonne qui garantit que le budget, retour final compris, n'est jamais violé).
- Sortie = objet `estimation` normalisé : `duree_travail_min`, `duree_totale_min`,
  `budget_travail_min`, `depassement_min`, `distance_km`, `poids_estime_kg`,
  `taux_remplissage_vehicule_pct`, `nb_retours_vidage`, `pause_dejeuner_incluse`,
  `heure_depart`/`heure_fin_estimee`, `timeline[]`
  (`depart|point|retour_vidage|pause_dejeuner|retour_final`), `avertissements[]`.

`POST /api/tours/estimate` (ADMIN/MANAGER) expose ce calcul en simulation pure
(`cav_ids` | `standard_route_id` | `association_point_ids`, option `optimize:true`
→ `ordre_optimise`). Le frontend (wizard de Tours.jsx, page Modèles) l'appelle
avant toute création.

### 5.1 Tournée intelligente (IA)
`POST /api/tours/intelligent`

1. Récupère tous les CAV actifs (hors association)
2. Prédit le taux de remplissage de chaque CAV (moteur prédictif V2)
3. **Garde de saturation** : les CAV dont la prédiction du jour ≥
   `saturationThresholdPct` (90 %) sont OBLIGATOIRES — placés en tête de la
   sélection avant tout scoring ; ceux que capacité ou budget ne permettent pas de
   servir remontent dans `saturation_non_couverte[]` (réponse + avertissement)
4. Score de priorité pour les autres CAV :
   - Fill-based : 50 pts (≥100%), 35 pts (80%), 20 pts (60%), 10 pts (40%), 2 pts (<40%)
   - Jours depuis dernière collecte × 1.5, nb conteneurs × 3, bonus confiance IA
5. Sélection sous contraintes via `planWithBudget` : capacité véhicule (95 %),
   **budget 6 h**, retours de vidage vehicle-aware (cf. 5.0). Poids estimé par CAV =
   remplissage prédit × capacité (nb_containers × 150 kg)
6. Optimise la route (OSRM Trip API ou Nearest Neighbor + 2-opt en fallback), la
   ré-optimisation n'est retenue que si elle tient dans le budget
7. Réponse : champs historiques (stats, explication) + `estimation` + `saturation_non_couverte`.
   Si AUCUN CAV ne tient dans le budget → erreur explicite, pas de tournée vide

### 5.2 Tournée modèle (« standard »)
`POST /api/tours/standard` — exige `standard_route_id`

Crée une tournée à partir d'un **modèle de tournée** (`standard_routes` +
`standard_route_cav`, ordre du modèle). CRUD complet des modèles :
`GET /tours/routes/list` (`?include_inactive=1`), `GET/PUT/DELETE /tours/routes/:id`
(PUT = remplacement ordonné de la composition, DELETE → 409 `ROUTE_UTILISEE` si des
tournées y réfèrent — désactiver via `is_active` dans ce cas), `POST /tours/routes`.
Les estimations (`estimated_duration_minutes`/`estimated_distance_km`) sont
calculées et stockées sur le modèle. UI dédiée : page « Modèles de tournées »
(`/route-templates`). L'estimation est calculée à la création de la tournée et la
création est **refusée en 409 `DUREE_MAX_DEPASSEE`** (corps : `{error, code,
estimation}`) si le travail estimé dépasse 6 h, sauf `force:true` (tracé dans
`ai_explanation`).

### 5.3 Tournée manuelle
`POST /api/tours/manual` — exige `cav_ids[]` ordonnés

Liste libre de CAV, ordre soumis conservé (le wizard propose « Optimiser l'ordre »
via `/estimate?optimize`). Même calcul d'estimation stockée et même refus 409
`DUREE_MAX_DEPASSEE` sans `force:true` que le mode modèle.

### 5.4 Tournée association
`POST /api/tours/association`

Crée une tournée pour des `association_points` (collection_type = `'association'`).
Modèles gérés par `POST/PUT/DELETE /tours/association-routes[/:id]`
(`standard_route_association`). Mêmes contraintes de temps (poids non estimé —
avertissement explicite, « jamais de valeur inventée »). Contrainte conservée : pas
de mélange PAV/association pour un même véhicule le même jour.

### 5.5 Garde de saturation transverse
`GET /api/tours/saturation-risks?days=7` (ADMIN/MANAGER) : pour chaque CAV dont les
données permettent une projection (prédictions `ml_fill_predictions`, sinon capteur),
date prévue de franchissement du seuil `saturationThresholdPct` et **statut de
couverture** (existe-t-il une tournée planifiée/en cours qui le visite avant cette
date ?). Consommé par CollectionProposals (bandeau) et DashboardCollecte (widget).
L'alerte « CAV pleins » du dashboard général lit désormais les mêmes sources réelles
(l'ancienne requête sur `avg_fill_rate`, colonne jamais alimentée, renvoyait
toujours 0).

---

## 6. Moteur prédictif de remplissage (V2)

### 6.1 Fonction principale
`predictFillRate(cavId, targetDate)` → `{ fill: 0-120, confidence: 0-1, method, factors }`

### 6.2 Pipeline de calcul

```
Historique 180j
    ↓
Accumulation (jours × taux quotidien)
    ↓
Facteurs multiplicatifs :
    ├── Saisonnier (par mois, Jan=0.88 → Août=1.27)
    ├── Jour de semaine (Lun=1.25, Jeu=0.49...)
    ├── Jour férié (+10%)
    ├── Vacances scolaires zone B (pre/during/post)
    ├── Tendance (30j vs 90j)
    ├── Densité (≥3 conteneurs → +10%)
    ├── Météo (Open-Meteo: pluie -5%, neige -10%, beau +8%)
    ├── Weekend ensoleillé ≥18°C → +15%
    └── Événements locaux à proximité → bonus 1.1 à 1.4
    ↓
Corrections ML V2 (3 niveaux pondérés) :
    ├── CAV individuel   60% : feedback récent (décroissance exponentielle)
    ├── Saisonnier       25% : même mois passés
    └── Zone géo         15% : CAV proches (±0.05° lat, ±0.1° lng, 30j)
    ↓
Cap min(0, max(120, résultat))
    ↓
Confiance Bayésienne (dataScore + feedbackScore + coherenceScore + freshnessScore)
```

### 6.3 Facteurs saisonniers (configurables en runtime)

```
Jan   Fév   Mar   Avr   Mai   Juin  Juil  Août  Sep   Oct   Nov   Déc
0.88  0.82  0.94  1.05  1.12  0.99  1.19  1.27  1.13  1.02  0.84  0.75
```

### 6.4 Facteurs jour de semaine

```
Lun   Mar   Mer   Jeu   Ven   Sam   Dim
1.25  1.09  1.05  0.49  1.11  1.15  1.10
```

Le **lundi** est élevé (accumulation weekend). Le **jeudi** est bas (anomalie calibrée sur données historiques).

### 6.5 Météo (Open-Meteo API)
Source gratuite, sans clé API. Cache en BDD table `collection_context`.

| Condition | Facteur |
|-----------|---------|
| Pluie légère | ×0.95 |
| Averse | ×0.92 |
| Neige | ×0.90 |
| Beau temps ≥18°C | ×1.08 |
| Weekend ensoleillé ≥18°C | ×1.15 supplémentaire |

### 6.6 Apprentissage continu
- Table `collection_learning_feedback` : enregistrée à chaque complétion de tournée
- Contient : `cav_id`, `tour_id`, `predicted_fill_rate`, `observed_fill_level` (0-5)
- Correction individuelle : ratio moyen observé/prédit, pondéré par récence (décroissance exponentielle)
- Correction saisonnière : ratio moyen pour le même mois
- Correction de zone : ratio moyen des CAV géographiquement proches

---

## 7. Algorithmes géographiques (geo.js)

### Fonctions disponibles

| Fonction | Description |
|----------|-------------|
| `haversineDistance(lat1, lon1, lat2, lon2)` | Distance vol d'oiseau (km) — fallback rapide |
| `osrmRouteSegment(lat1, lon1, lat2, lon2)` | Distance + durée réelle par route (OSRM) |
| `osrmDistanceMatrix(points)` | Matrice N×N distances/durées (OSRM) |
| `osrmOptimizedTrip(points, centreLat, centreLng)` | TSP optimisé via OSRM Trip API |
| `nearestNeighborTSP(points, startLat, startLng)` | Algorithme du plus proche voisin (fallback) |
| `twoOptImprove(route, startLat, startLng)` | Amélioration 2-opt itérative |
| `calculateTotalDistance(route, startLat, startLng)` | Distance totale d'une route calculée |

### Stratégie de routage
```
OSRM Trip API (distances réelles, TSP)
    ↓ (si timeout ou indisponible)
Nearest Neighbor + amélioration 2-opt (Haversine × 1.3)
```

**OSRM base URL** : `https://router.project-osrm.org` (paramétrable via `OSRM_BASE_URL`)

---

## 8. Exécution mobile (JWT chauffeur « 1 URL = 1 véhicule »)

Les endpoints suffixés `-public` sont accessibles sans JWT pour permettre l'usage depuis la PWA chauffeur.

### Flux type sur mobile

```
1. GET /api/tours/vehicle/:vehicleId/today      → Récupère la tournée du jour
2. POST /api/tours/:id/checklist-public          → Checklist départ (km, carburant, état)
3. PUT /api/tours/:id/start-public               → Démarre (planned → in_progress)
4. PUT /api/tours/:id/cav/:cavId/collect-public  → Marque chaque CAV collecté
5. POST /api/tours/:id/weigh-public              → Pesée (peut être répété si retour centre)
6. POST /api/tours/:id/incident-public           → Signale incident
7. PUT /api/tours/:id/status-public              → Retour / Complétion
8. GET /api/tours/:id/summary-public             → Résumé final
```

### GPS temps réel
- Mobile émet position via Socket.IO toutes les 10 secondes
- Stocké dans `gps_positions`
- Visible en temps réel dans `LiveVehicles` (frontend web)

### Photo du CAV au passage (août 2026)
- Chaque CAV porte une **photo de référence** (`cav.photo_path`) + sa **date de
  prise de vue** (`cav.photo_taken_at`) et son origine (`cav.photo_source` :
  `admin`/`chauffeur`/`import` — backfill des photos préexistantes sur `updated_at`,
  approximation assumée).
- Règle de fraîcheur (calculée SERVEUR, `utils/cav-photo.js`) : photo absente OU
  sans date OU plus vieille que `collecte.photo_fraicheur_mois` (settings, défaut
  **6 mois calendaires**) → `photo_requise = true` dans les payloads chauffeur
  (`GET /tours/:id/public` et `/tours/vehicle/:id/today`, champs aliasés
  `cav_photo_path`/`cav_photo_taken_at` pour ne pas écraser la photo d'audit
  `tour_cav.photo_path`).
- Mobile (`FillLevel.jsx`) : bloc photo à 3 états — **obligatoire** (validation
  bloquée tant qu'aucune photo, en ligne uniquement) si `photo_requise` ou point
  d'audit tiré au sort, **facultatif** sinon (bouton toujours disponible),
  **hors ligne** jamais bloquant (doctrine offline existante — la photo sera
  redemandée au prochain passage). Badge « 📷 Photo à prendre » sur TourMap.
- Envoi : `POST /api/tours/:id/cav/:cavId/photo-public` (multipart, JWT chauffeur,
  garde de périmètre véhicule, tournée `planned|in_progress`) → met à jour la photo
  de référence (`photo_source='chauffeur'`), supprime l'ancien fichier. Best effort :
  un échec n'empêche jamais la collecte.
- Web : upload admin (`POST /cav/:id/photo`, ADMIN/MANAGER) horodate désormais la
  prise ; AdminCAV affiche date, origine et badges « Photo à renouveler / Aucune photo ».

---

## 9. Side effects à la complétion

À `status = completed`, le backend déclenche automatiquement :

1. **Enregistrement `tonnage_history`** : poids par CAV collecté (base d'apprentissage future)
2. **Création `stock_movements`** : entrée matière première (type=entree, origine=collecte_pav ou collecte_association)
3. **Création `stock_original_movements`** : entrée stock brut (source=collecte_pav ou collecte_association)
4. **Feedback ML** : enregistrement `collection_learning_feedback` pour chaque CAV (predicted vs observed)
5. **Notification Socket.IO** : événement `tour-status-update` pour le dashboard temps réel

---

## 10. Événements locaux

### Gestion manuelle
`POST/PUT/DELETE /api/tours/events` (ADMIN)

Champs : nom, type (brocante/braderie/foire/fête...), date_debut, date_fin, lat, lng, rayon_km, bonus_factor (1.1–1.4), is_active.

### Découverte automatique
`POST /api/tours/events-auto/discover`

Scrape en parallèle 4 sources :
- **OpenAgenda** (API payante, optionnelle) — brocantes, vide-greniers, braderies dans un rayon de 30 km de Rouen
- **OpenDataSoft / data.gouv.fr** (gratuit)
- **Métropole Rouen Open Data** (gratuit)
- **Seine-Maritime Open Data** (département 76, gratuit)

+ Analyse saisonnière interne : soldes hiver/été, déménagements (juin–sept), rentrée.

Déduplique par nom+date, filtre par distance, importe avec source tracking.

---

## 11. Propositions et plan hebdomadaire

### Propositions quotidiennes
`GET /api/tours/proposals/daily?date=YYYY-MM-DD`

Génère une tournée intelligente pour chacun des 5 premiers véhicules disponibles. Inclut météo, vacances, jours fériés.

### Plan hebdomadaire
`GET /api/tours/proposals/weekly?start=YYYY-MM-DD`

Pour chaque jour de la semaine :
- Tournées existantes
- Meilleure proposition (1 véhicule)
- Contexte (météo, vacances, événements)

---

## 12. Reporting et précision prédictive

### KPIs (stats.js)
- Nombre total de tournées / complétées
- Poids total et moyen collecté
- Durée moyenne
- Stats par CAV (collectes, kg, avg fill_level)
- Stats par chauffeur

### Métriques précision prédictive
| Métrique | Description |
|----------|-------------|
| **MAE** | Mean Absolute Error — écart moyen prédit vs observé (≤5 = excellent) |
| **RMSE** | Root Mean Square Error |
| **Bias** | Sous/sur-estimation systématique |
| **Corrélation Pearson** | Cohérence de la tendance |

### Export données d'entraînement
`GET /api/tours/predictive/export-training` (JSON ou CSV)

~30 features pour XGBoost/scikit-learn : temporelles, météo, géo, feedback.

---

## 13. Configuration prédictive (runtime)

`GET/PUT /api/tours/predictive-config` (ADMIN)

Permet de modifier sans redéploiement :
- Facteurs saisonniers (12 valeurs, une par mois)
- Facteurs jour de semaine (7 valeurs)
- Calendrier jours fériés
- Calendrier vacances scolaires zone B
- Seuils de scoring (capacité, durée max, retour centre, pause déjeuner)
- **Contraintes de temps de travail** (exposées dans AdminPredictive, carte
  « Temps de travail & contraintes de tournée ») : `maxDailyHours` (défaut **6**),
  `workdayStartHour` (8), `lunchStartHour` (12), `lunchAfterHours` (4),
  `lunchBreakMinutes` (30), `unloadMinutes` (15), `vehicleFillReturnPct` (90),
  `returnEveryKg` (2000, 0 = piloté par le seul % capacité), `saturationThresholdPct`
  (90). `avgSpeed` est désormais réellement la vitesse de repli unique
  (geo.js / planned-passage.js / reoptimize-service.js).

---

## 14. Dépendances entre fichiers

```
crud.js
├── predictions.js   (predictFillRate)
├── smart-tour.js    (generateIntelligentTour)
└── context.js       (coordonnées centre de tri)

smart-tour.js
├── context.js       (getContextForDate, getLocalEventsForDate)
├── geo.js           (OSRM, TSP, 2-opt)
└── predictions.js   (predictFillRate, getScoringConfig)

predictions.js
├── context.js       (getContextForDate, isEventNearCav)
└── geo.js           (haversineDistance)

proposals.js
├── smart-tour.js    (generateIntelligentTour)
├── context.js       (getContextForDate)
└── predictions.js   (isHoliday, getSchoolVacationStatus)

stats.js
└── predictive-ai.js (service IA Claude pour synthèses)

events-auto.js
└── geo.js           (haversineDistance — filtrage proximité)
```

---

## 15. Flux complet synthétique

```
MANAGER (web)
    ├─ Crée tournée intelligente  →  IA sélectionne CAV + optimise route
    ├─ Crée tournée standard      →  Route pré-définie
    ├─ Crée tournée manuelle      →  CAV libres
    └─ Crée tournée association   →  Points association

CHAUFFEUR (mobile PWA)
    1. Voit ses tournées du jour
    2. Claim une tournée → status in_progress
    3. Remplit checklist départ (km, carburant)
    4. Pour chaque CAV :
       ├── Scan QR code (optionnel)
       ├── Saisit fill_level (0-5)
       └── Collecte
    5. Pesée(s) intermédiaire(s)
    6. Incidents si nécessaire
    7. Retour centre → status returning → completed

BACKEND (à la completion)
    ├── tonnage_history  ← poids par CAV
    ├── stock_movements  ← entrée stock principal
    ├── stock_original_movements  ← entrée stock brut
    ├── collection_learning_feedback  ← feedback ML
    └── Socket.IO ← notification dashboard

REPORTING (web)
    ├── KPIs collecte
    ├── Précision prédictive (MAE, RMSE)
    ├── Analytics par CAV
    └── Synthèse IA (Claude API)
```

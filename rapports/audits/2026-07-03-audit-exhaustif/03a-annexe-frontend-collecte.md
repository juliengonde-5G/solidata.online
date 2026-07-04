# Annexe 03a — Audit détaillé des pages React « Collecte » (opérationnel)

> Annexe du rapport `03-collecte-vehicules-capteurs.md`. Audit page par page des écrans
> opérationnels de collecte : endpoints appelés, contrats de données lus, gestion
> d'erreur, performance, UX manager, logique métier.

Note transversale : la clé canonique du token JWT dans l'app est `accessToken` (voir `frontend/src/services/api.js:11`, `frontend/src/contexts/AuthContext.jsx:11,29`). À garder en tête pour LiveVehicles ci-dessous.

---

## 1. Tours.jsx (`/frontend/src/pages/Tours.jsx`)

### Endpoints API
- `Tours.jsx:32` — `api.get('/tours')` (via `fetchTours`/`useAsyncData`, lit `r.data`) — charge TOUTES les tournées, pas de filtre/pagination.
- `Tours.jsx:40` — `api.get('/vehicles?available=true')`
- `Tours.jsx:41` — `api.get('/employees')`
- `Tours.jsx:42` — `api.get('/tours/association-routes/list')` (`.catch(()=>({data:[]}))`)
- `Tours.jsx:43` — `api.get('/association-points?status=active')` (`.catch(()=>({data:[]}))`)
- `Tours.jsx:64` — `api.post('/tours/association', { ...wizForm, association_point_ids, standard_route_id })`
- `Tours.jsx:72` — `api.post('/tours/${mode}')` avec mode ∈ {intelligent, standard, manual} → `/tours/intelligent` | `/tours/standard` | `/tours/manual`
- `Tours.jsx:86` — `api.put('/tours/${id}/status', { status })`
- `Tours.jsx:94` — `api.get('/tours/${id}')`
- `Tours.jsx:96` — `api.get('/tours/${id}/live-summary')` (`.catch(()=>({data:null}))`)
- `Tours.jsx:342` — `api.get('/tours/association-routes/${routeId}/points')` — **aucun `.catch`** (rejet non géré possible).
- Aucun Socket.IO.

### Champs de réponse (mismatches probables back/front)
- Liste tournée `t` : `t.id`, `t.date`, `t.status` ('planned'|'in_progress'|'completed'), `t.mode`, `t.collection_type` ('association'), `t.nb_cav`, `t.total_weight_kg`.
- **Fallbacks révélateurs d'un contrat instable** :
  - Véhicule : `t.registration || t.vehicle_registration` (`:112`, `:244`, `:524` ajoute `|| t.vehicle_name`).
  - Chauffeur : `t.driver_name || [t.driver_first_name, t.driver_last_name]` (`:113`, `:247`, `:523`).
- `vehicles` : `v.id`, `v.registration`, `v.brand`, `v.model`, `v.capacity_kg`, `v.type` (`:384-385`).
- `employees` : `e.id`, `e.first_name`, `e.last_name` (`:406`).
- `assoRoutes` : `r.id`, `r.name`, `r.point_count` (`:350`).
- `assoPoints` : `ap.id`, `ap.name`, `ap.ville` (`:362-363`).
- `generatedTour` (`:423-426`) : triples fallbacks `generatedTour.tour?.id || generatedTour.id`, `stats?.totalCavs || tour?.nb_cav`, `stats?.totalDistance || tour?.estimated_distance_km`, `stats?.estimatedDuration || tour?.estimated_duration_min`, `.explanation`, `.cavs || .cavList` → `c.position`, `c.name || c.nom || c.cav_name`, `c.predicted_fill`.
- Detail/summary (`:490-497`) : `summary.points`, `summary.incidents`, `summary.weights`, `summary.distance_actual_km ?? summary.distance_km ?? tour.estimated_distance_km`, `summary.elapsed_minutes ?? summary.duration_min`, `summary.total_weight_kg`, `summary.avg_fill_percent`, `summary.nb_collected`.
- Point `p` (`:565-586`) : `p.position`, `p.cav_name || p.name || p.nom`, `p.commune`, `p.planned_passage_at || p.planned_passage_time`, `p.collected_at`, `p.status` ('skipped'|'collected'), `p.skip_reason`, `p.fill_level` (/5), `p.weight_kg || p.collected_weight_kg`, `p.has_incident`.
- Pesées `w` (`:605-609`) : `w.id`, `w.recorded_at`, `w.weight_kg`, `w.is_intermediate`, `w.notes`.
- Incidents `inc` (`:624-630`) : `inc.id`, `inc.type`, `inc.created_at`, `inc.description`, `inc.status`.

### Gestion erreur / chargement
- Chargement principal : `LoadingSpinner` (`:102`). Erreur principale : `ErrorState` avec bouton réessayer `onRetry={loadTours}` (`:103`) — **bon**, mais uniquement pour `/tours`.
- `openWizard` (`:49`), `updateStatus` (`:88`), `loadTourDetail` (`:99`) : `console.error` seul, **aucun retour utilisateur** — changement de statut peut échouer silencieusement.
- `generateTour` (`:79`) : `alert()` natif (visible mais UX brutale).

### Performance
- `/tours` sans pagination ni filtre date (`:32`) sur une page intitulée « Historique / archives » → payload croissant sans borne. KPIs calculés côté client sur toute la liste (`:106-108`).
- Pas de polling (bon). `openWizard` : 4 requêtes en parallèle (`Promise.all`, bon).

### UX manager
- Bon : KPIs, wizard 4 étapes, cartes mobile + table desktop, bandeau IA suggestions.
- **Actions sans confirmation** : « Démarrer » (`:143`,`:256`) et « Terminer » (`:146`,`:259`) changent le statut en 1 clic, transition irréversible sans undo.
- **Incohérence wizard** : le bouton « Générer la tournée » existe à l'étape 2 (`:393`) ET à l'étape 3 (`:410`), alors que la barre de progression affiche 4 étapes (`:280-285`). L'étape 3 (chauffeur) est de fait court-circuitée par l'étape 2 → parcours confus, chauffeur potentiellement jamais saisi.

### Logique métier douteuse
- `MODE_LABELS`/`STATUS_LABELS` (`:8-9`) déclarés mais **jamais utilisés** (StatusBadge utilisé à la place) — code mort. `useEffect` importé (`:1`) non utilisé.
- KPI « Poids collecté » (`:108`) somme `total_weight_kg` sur toutes tournées y compris planifiées (poids 0) — label potentiellement trompeur.
- Tournée association : si aucun point coché, envoie **tous** les points actifs (`:63`) — tournée massive non intentionnelle possible.

---

## 2. PlanningTournees.jsx (`/frontend/src/pages/PlanningTournees.jsx`)

### Endpoints API
- `PlanningTournees.jsx:127` — `api.get('/tours/planning/resources', { params: { date } })`
- `PlanningTournees.jsx:152` — `api.patch('/tours/${tourId}/assign', body)` — `body` = `{driver_employee_id}` ou `{vehicle_id}` ou `{field:null}`, + `force:true` optionnel.
- Aucun Socket.IO.

### Champs de réponse
- `data.tours`, `data.drivers`, `data.vehicles` (`:183-185`).
- `driver d` : `d.id`, `d.first_name`, `d.last_name`, `d.is_day_off`, `d.team_name || d.position`, `d.assigned_tour_id` (`:28-51`, `:249`).
- `vehicle v` : `v.id`, `v.registration`, `v.name`, `v.max_capacity_kg`, `v.assigned_tour_id` (`:63-78`, `:273`).
- `tour` : `tour.id`, `tour.route_name`, `tour.collection_type`, `tour.status` ('in_progress'|'completed'|'cancelled'), `tour.nb_cav`, `tour.estimated_duration_min`, `tour.driver_name`, `tour.registration` (`:303-338`).
- Réponse assign : `res.data.conflicts[]` (`:153`) — `c.reason` ∈ {driver_already_assigned, vehicle_already_assigned, driver_day_off, vehicle_unavailable}, `c.tour_id`, `c.day_off`, `c.status` (`:358-361`). Aussi lu depuis `err.response.data.conflicts` (`:161`) et `err.response.data.error` (`:165`).

### Gestion erreur / chargement
- `LoadingSpinner` uniquement si `loading && !data` (`:181`) — rechargements suivants silencieux.
- **`load` erreur (`:129`) : `console.error` seul — pas d'état d'erreur visible, pas de bouton réessayer.** Si le planning échoue à charger, l'écran affiche des pools vides sans explication.
- `doAssign` : toast d'erreur visible (`:165`) — **bon**, feedback + auto-dismiss 3,5 s (`:145`).

### Performance
- Pas de polling. **Refetch complet** des ressources après chaque affectation (`await load()` `:159`) et à chaque changement de date. Acceptable, mais coûteux si beaucoup de tournées. Aucune pagination des pools.

### UX manager
- Bon : drag & drop, modale de conflit avec « Forcer l'affectation » (`:372`) derrière confirmation, indicateur « déjà affecté », navigation date (préc/suiv/aujourd'hui).
- « Forcer l'affectation » outrepasse jour off / double affectation — puissant mais protégé par modale (bon).
- `clearSlot` (`:177`) retire une affectation en 1 clic sur X sans confirmation (`:107`) — mineur.

### Logique métier douteuse
- Libellés de conflit codés en dur (`:358-361`) : si le back ajoute un nouveau `reason`, le `<p>` s'affiche **vide** (aucun message).
- `d.assigned_tour_id !== null` (`:249`,`:273`) : si le back renvoie `undefined`/champ absent, `undefined !== null` = true → badge « déjà affecté » affiché à tort.

---

## 3. LiveVehicles.jsx (`/frontend/src/pages/LiveVehicles.jsx`, composant `CollectionsLive`)

### Endpoints API + Socket.IO
- `LiveVehicles.jsx:56` — `api.get('/tours/active-summary')`
- **Socket.IO** `io(window.location.origin, { auth: { token } })` (`:83`).
  - **BUG CRITIQUE `:82`** : `const token = localStorage.getItem('token')` — mauvaise clé. L'app stocke le JWT sous `accessToken` (api.js:11, AuthContext.jsx:29 ; la page live sœur VakLive.jsx:95 utilise bien `accessToken`). Ici `token = null` → socket connecté sans auth. Si le back exige l'auth socket, **les events temps réel n'arrivent jamais** → suivi GPS live cassé silencieusement (seul le polling 30 s rafraîchit les positions via `last_position`).
  - `:86` — `socket.on('vehicle-position', d => …)` — lit `d.latitude`, `d.longitude`, `d.vehicle_id || d.vehicleId`, `d.speed`, `d.timestamp`.
  - `:96` — `socket.on('cav-status-update', loadActive)` → refetch complet.
  - `:97` — `socket.on('tour-status-update', loadActive)` → refetch complet.

### Champs de réponse
- `data.tours`, `data.kpis`, `data.date` (`:105-106`,`:132`).
- `kpis` : `vehicules_actifs`, `cav_a_vider`, `avancement_pct`, `distance_restante_km` (`:106`).
- `tour` : `t.last_position` → `.latitude`, `.longitude`, `.speed`, `.recorded_at` (`:62-67`) ; `t.vehicle_id`, `tour.points[]`, `tour.id`, `tour.driver_name`, `tour.vehicle_registration || tour.vehicle_name` (`:248`,`:321`), `tour.collection_type`, `tour.status`, `tour.progress_pct`, `tour.nb_collected`, `tour.nb_points`, `tour.distance_remaining_km`, `tour.distance_km`, `tour.elapsed_min`, `tour.estimated_duration_min`, `tour.alert_overrun`, `tour.nb_incidents`, `tour.weight_collected_kg`.
- `point p` : `p.latitude`, `p.longitude`, `p.status` ('pending'|'in_progress'|'collected'|'incident'|'skipped'), `p.id`, `p.position`, `p.name`, `p.address`, `p.collected_at`, `p.weight_kg`, `p.fill_level` (/5), `p.planned_passage_time`, `p.commune`.
- **Mismatches inter-pages** : ici `vehicle_registration`/`nb_collected`/`nb_points` alors que Tours/Dashboard utilisent `registration`/`collected_count`/`nb_cav`. Socket `d.timestamp` vs REST `recorded_at` = même concept, noms différents ; fallback `d.vehicle_id || d.vehicleId` (snake vs camel).

### Gestion erreur / chargement
- `LoadingSpinner` initial (`:125`). `loadActive` erreur (`:72`) : `console.error` seul → **pas d'erreur visible**, KPIs retombent à 0 (`:106`), dégradation silencieuse. Bouton « Actualiser » manuel (`:135`, bon).

### Performance
- **Double mécanisme** : polling 30 s (`:80`) + Socket.IO.
- Les events `cav-status-update` et `tour-status-update` déclenchent **chacun un `loadActive` complet** (`:96-97`), sans debounce → sur plusieurs véhicules en collecte simultanée, refetchs très fréquents (chatty).
- `/tours/active-summary` renvoie toutes les tournées **avec tous leurs points GPS** (`t.points`, `:113`), payload potentiellement volumineux, rechargé toutes les 30 s + à chaque event socket.

### UX manager
- Bon : carte multi-tournées couleurs distinctes, marqueurs camion live, légende, table synthèse dépliable, KPIs, barres de progression, icônes d'alerte. Lecture read-only, aucune action destructive.
- `mapCenter` recalculé via `useMemo` (`:109`) mais la prop `center` de `MapContainer` n'agit qu'au montage (Leaflet ignore les changements ultérieurs) → **le recentrage live ne se produit pas** ; le useMemo est quasi inutile après le 1er rendu.

### Logique métier douteuse
- Seuils avancement codés en dur (`:159`) : ≥80 emerald, ≥50 amber, sinon slate.
- Couleurs points (`:216`) : incident `#dc2626`, collecté `#94A3B8`, sinon couleur tournée. Palette 12 couleurs max, modulo au-delà (`:23`,`:188`).
- Itinéraire tracé seulement pour points pending/in_progress (`:190-192`, cohérent).

---

## 4. FillRateMap.jsx (`/frontend/src/pages/FillRateMap.jsx`)

### Endpoints API + Socket.IO
- `FillRateMap.jsx:95` — `api.get('/cav/${selectedCav.id}/activity')` (histogramme au clic sur un CAV).
- `FillRateMap.jsx:105` — `api.get('/cav/fill-rate')`
- `FillRateMap.jsx:106` — `api.get('/association-points/map')`
- **Socket.IO** via `useCavSensorSocket(handleSensorReading)` (`:88`) → hook `useCavSensorSocket.js:23` : `socket.on('cav:sensor-reading', …)`, token `accessToken` (**correct** ici). Payload lu (`:69-86`) : `reading.cav_id`, `reading.fill_level`, `reading.timestamp`, `reading.battery`, `reading.rssi` (hook documente aussi `fill_source`, `temperature`, `tilt`, `alarms`).

### Champs de réponse
- `data.cavs[]` (`:118`).
- `cav c` : `c.id`, `c.name`, `c.commune`, `c.address`, `c.fill_rate`, `c.fill_source` ('sensor'), `c.days_to_full`, `c.lora_deveui || c.sensor_reference`, `c.latitude`, `c.longitude`, `c.sensor_battery_level`, `c.sensor_last_rssi`, `c.sensor_last_reading_at`, `c.sensor_last_reading`, `c.nb_containers`, `c.last_collection`, `c.next_passage` (date | chaîne `'en retard'`), `c.tournee`, `c.jours_collecte`, `c.days_since_collection`, `c.avg_weight_90d`, `c.nb_collectes_90d`, `c.daily_accumulation_kg`, `c.predicted_full_date` (`:241-374`).
- `assoPoints ap` : `ap.latitude`, `ap.longitude`, `ap.id`, `ap.name`, `ap.address`, `ap.ville`, `ap.contact_phone`, `ap.last_collection` (`:217-234`).
- `activityData` : `.jours[]` → `j.date`, `j.fill_pct`, `j.collecte_kg`, `j.type` ('prevision'), `j.source` ('sensor') ; `.has_sensor`, `.sensor_days_with_data` (`:385-434`).
- Update socket (`:74-83`) : écrit `fill_rate = Math.round(reading.fill_level)`, `fill_source:'sensor'`, `sensor_last_reading`, `sensor_last_reading_at`, `sensor_battery_level=reading.battery`, `sensor_last_rssi=reading.rssi`.

### Gestion erreur / chargement
- `LoadingSpinner` (`:114`). Si `!data` → texte rouge statique « Erreur de chargement » (`:115`) — **visible mais sans bouton réessayer**.
- `loadData` erreur (`:110`) : `console.error` seul ; en poll silencieux garde l'ancien état (ok).
- Fetch activity erreur (`:97`) : `activityData=null` → « Données non disponibles » (`:441`, gracieux).

### Performance
- **Polling 60 s** silencieux (`:64`) + push socket capteur. Interval raisonnable.
- `/cav/fill-rate` + `/association-points/map` rechargés **ensemble** toutes les 60 s (`Promise.all` `:104-107`) — payload de tous les CAV (lat/lng + champs capteur/prévision).
- **`filtered` (`:118-129`) et `liveStats` (`:133-143`) recalculés à chaque rendu, non mémoïsés** → recalcul sur tous les CAV à chaque frappe dans la recherche ville et à chaque event socket. `useMemo` est **importé (`:1`) mais jamais utilisé**.

### UX manager
- Bon : carte colorée par remplissage, cartes KPI cliquables (filtres), recherche commune/adresse, tri (remplissage/urgence/A-Z), badges capteur frais/stale, histogramme historique+prévision, légende, toggle associations, surlignage « en retard ».
- Read-only, pas d'action destructive.
- « Actualiser » (`:156`) passe l'event React comme options — fonctionne par accident (`silent` reste false). `loadData` ne met jamais `loading=true` → aucun indicateur pendant le refresh manuel (mineur).

### Logique métier douteuse (seuils remplissage — POINT CLÉ)
- **Incohérence de buckets** : la carte/légende utilise **4 seuils** — `getFillColor`/`getFillLabel`/`getFillBg` (`:25-44`) : ≥80 rouge/Critique, ≥60 orange/Élevé, ≥40 jaune/Moyen, sinon vert/Faible. Mais les KPIs et filtres utilisent **3 buckets** — `filter` (`:121-124`) et `liveStats` (`:139-142`) : critical ≥80, warning 40–80, ok <40. La carte « Attention » regroupe donc orange(60-80)+jaune(40-60).
- **Libellé vs code au seuil 80** : carte KPI affiche « Critique (>80%) » (`:192`) mais code `>= 80` (`:139`) — 80,0 % est classé critique alors que le label dit strictement `>80`.
- `Math.round(reading.fill_level)` (`:78`) : suppose que le capteur envoie déjà un **pourcentage 0-100**. Si le back envoie une échelle 0-5 ou 0-1, valeur fausse (hypothèse de contrat).
- Rayon marqueur `Math.max(8, Math.min(16, cav.fill_rate/8))` (`:251`) : pour 0-100 %, donne 8→12,5 px ; le cap `Math.min(16,...)` **jamais atteint** (borne morte).
- « Prévision plein (80%) » (`:374`) : 80 % codé en dur comme définition de « plein ».
- Chaîne sentinelle `'en retard'` comparée en dur (`:283`,`:363`,`:472`) — magique, casse si le back change le libellé.

---

## 5. CollectionProposals.jsx (`/frontend/src/pages/CollectionProposals.jsx`)

### Endpoints API
- `CollectionProposals.jsx:27` — `api.get('/tours/proposals/daily', { params: { date } })`
- `CollectionProposals.jsx:39` — `api.get('/tours/proposals/weekly', { params: { week_start: weekStart } })`
- `CollectionProposals.jsx:57` — `api.put('/tours/context', { date, weather_factor, traffic_factor, duration_factor, notes })`
- `CollectionProposals.jsx:73` — `api.post('/tours/intelligent', { vehicle_id, date, driver_employee_id })`
- Aucun Socket.IO.

### Champs de réponse
- `daily.context` : `weatherFactor`, `trafficFactor`, `durationFactor`, `weatherLabel`, `tempMax`, `precipMm`, `notes` (`:144-181`).
- `daily.vacationStatus` : `status` ('during'|'pre'|'post'), `name`, `bonus` (`:189-202`). `daily.holiday.bonus` (`:208-212`).
- `daily.referenceCalendar` : `seasonalFactor`, `dayOfWeekFactor`, `upcomingVacations[]` (`v.name`,`v.start`,`v.end`), `nearbyHolidays[]` (`:216-249`).
- `daily.proposals[]` : `p.vehicle_id`, `p.vehicle_name`, `p.proposal.stats` (`totalCavs`,`totalDistance`,`estimatedDuration`), `p.proposal.explanation` (`:259-268`). `daily.drivers[0].id` (`:271`).
- `daily.diagnostics` : `totalVehicles`, `usedVehicles`, `candidateVehicles`, `attemptedVehicles`, `skippedCount` (`:285-302`). `daily.skipped[]` : `s.vehicle_name`, `s.reason` (`:296-297`).
- `weekly` : `weekStart`, `weekEnd`, `upcomingVacations[]`, `days[]` → `day.date`, `day.dayName`, `day.suggestedTour` (`cavCount`, `stats.totalDistance`), `day.context` (`weatherLabel`,`tempMax`,`weatherFactor`), `day.vacationStatus`, `day.holiday`, `day.existingTours[]`, `day.availableVehicles` (`:316-368`).

### Gestion erreur / chargement
- Spinner inline (`:130-134`, garde le header — bon).
- `loadDaily`/`loadWeekly` erreur (`:29`,`:41`) : `console.error` + set null → le bloc ne rend rien (`&& daily` `:136`), **zone blanche sans message d'erreur ni retry**. Silencieux et trompeur.
- `saveContext` erreur (`:67`) : `console.error` seul, la modale reste ouverte sans feedback (le `setContextEdit(null)` n'a lieu qu'en succès `:64`).
- `createTourFromProposal` erreur (`:79`) : `console.error` seul — clic « Créer cette tournée » sans effet visible en cas d'échec.

### Performance
- `useEffect` (`:48-51`) refetch sur `view`/`date`/`weekStart`. Pas de polling. Pas de pagination (listes courtes par nature). Refetch redondant mineur quand `weekStart` change en vue daily (deps incluent les deux).

### UX manager
- Bon : bascule jour/semaine, date pickers, modale contexte, panneau référence météo/vacances/férié, **diagnostics quand aucune proposition** (`:283-307`, excellent — explique pourquoi), détail des échecs.
- **`createTourFromProposal` auto-assigne le PREMIER chauffeur** `daily.drivers?.[0]?.id` (`:271`) sans laisser le manager choisir — décision métier silencieuse.
- Création de tournée (action significative) **sans confirmation ni toast de succès** — juste un reload.

### Logique métier douteuse
- Facteurs bornés 0,8–1,2 en dur dans le formulaire (`:386`,`:390`,`:394`) ; `parseFloat(...) || 1` → champ vide = 1.
- Sémantique météo (`:170`) : facteur <1 = orange (défavorable), >1 = vert. `bonus` vacances/férié affichés en multiplicateurs `x{bonus}`.

---

## 6. DashboardCollecte.jsx (`/frontend/src/pages/DashboardCollecte.jsx`)

### Endpoints API
- `DashboardCollecte.jsx:171` — `api.get('/tours/dashboard/summary', { params: { date } })`
- Aucun Socket.IO.

### Champs de réponse
- `data.kpis`, `data.orders`, `data.fleet`, `data.status_breakdown` (`:189-192`).
- `kpis` : `active_tours`, `total_tours`, `total_weight_kg`, `on_time_rate` (nullable), `open_incidents` (`:220-226`).
- `order o` : `o.id`, `o.registration`, `o.vehicle_name`, `o.driver_name`, `o.route_name`, `o.collection_type`, `o.collected_count`, `o.nb_cav`, `o.total_weight_kg`, `o.status`, `o.completed_at`, `o.eta`, `o.delay_minutes` (`:278-302`).
- `fleet v` : `v.id`, `v.registration`, `v.pending_alerts`, `v.health` ('maintenance'|'alerts'|'contract_expiring'|'healthy'), `v.contract_days_left` (`:132-158`).
- `status_breakdown` : objet `{statut: count}` (`:66`,`:192`).
- **Mismatch inter-pages** : `collected_count`/`nb_cav` ici vs `nb_collected`/`nb_points` dans LiveVehicles pour le même concept.

### Gestion erreur / chargement
- `LoadingSpinner` si `loading && !data` (`:185`).
- **`load` erreur (`:173`) : `console.error` seul — aucune erreur visible, aucun retry.** En échec, affiche des zéros/anciennes données.

### Performance
- **Auto-refresh 30 s** (`:181`, `setInterval(load, 30000)`), refetch summary complet. Pas de socket. Raisonnable. Pas de pagination (borné au jour).

### UX manager
- Bon : ligne KPI à couleurs conditionnelles, donut statuts (SVG custom), barres santé flotte, table tournées, lien vers suivi live, navigation date. Read-only, pas d'action destructive. `on_time_rate` null → '—' géré (`:223`).

### Logique métier douteuse
- Seuils on-time en dur (`:224`) : ≥85 emerald, ≥70 amber, sinon red.
- **`FleetHealthBar` : largeurs de barre arbitraires codées en dur** (`:151`) : healthy 100 %, contract_expiring 60 %, sinon 35 % — **non reliées à une métrique réelle** (pur visuel).
- STATUS_META (`:28-35`) mappe 6 statuts → label/couleur/bg.

---

## 7. ReportingCollecte.jsx (`/frontend/src/pages/ReportingCollecte.jsx`)

### Endpoints API
- `ReportingCollecte.jsx:39` — `api.get('/reporting/dashboard?period=${periodDays}')`
- `ReportingCollecte.jsx:40` — `api.get('/reporting/collecte?group_by=${groupBy}&date_from=${range.from}&date_to=${range.to}')`
- Aucun Socket.IO.

### Champs de réponse
- `dashboard.tours` : `nb_tours`, `completed` (`:54`,`:66-67`,`:92`). `dashboard.cav.actifs` (`:94`).
- `collecteData[]` (row `r`) : `r.total_kg`, `r.nb_tours`, `r.periode`, `r.avg_kg` (`:50-62`,`:177-180`). Valeurs parsées via `parseFloat`/`parseInt` → **le back renvoie des nombres sous forme de chaînes** (numeric Postgres).

### Gestion erreur / chargement
- `LoadingSpinner` (`:48`). **`loadData` erreur (`:44`) : `console.error` seul — aucune erreur visible, aucun retry.** En échec : `dashboard=null` + `collecteData=[]` → affiche « Aucune donnée » partout, **trompeur** (ressemble à une absence de données, pas à une panne).

### Performance
- Refetch sur changement de range (`:30`). Pas de polling.
- **Bon** : agrégation auto par mois si période >100 jours (`:37`) pour ne pas exploser le graphique.

### UX manager
- Bon : date range picker, KPIs, bar/line/pie charts, table détail avec footer totaux, états vides gérés. Read-only.

### Logique métier douteuse (POINTS CLÉS)
- **`co2Evite = Math.round(totalKg * 1.567 / 1000)` (`:53`)** : constante **1.567 non documentée** (facteur kg CO₂/kg). Le calcul divise par 1000 (→ tonnes) mais l'unité affichée est **`kg`** (`:91`) → **incohérence d'unité** (calcule des tonnes, étiquette kg).
- **`:67` — « En cours » = `nb_tours - completed`** : classe **toutes** les tournées non terminées (planifiées, annulées, en cours) comme « En cours » dans le donut → annulées/planifiées comptées à tort.
- **`:58` — ternaire mort/bug** : `r.periode.length > 10 ? r.periode.slice(5) : r.periode.slice(5)` — **les deux branches sont identiques**. Intention probable : slicing différent mois vs jour, jamais implémenté.
- `tauxCompletion` = completed/nb_tours×100 (`:54`). Deux sources de tonnage : KPI « Tonnage collecté » depuis `collecteData` (`:90`) vs donut/complétion depuis `dashboard` (`:66`) — risque de divergence des chiffres affichés.

---

## Synthèse des points les plus graves (priorité audit)
1. **LiveVehicles.jsx:82** — mauvaise clé token (`'token'` au lieu de `'accessToken'`) → auth Socket.IO cassée, suivi GPS temps réel silencieusement inopérant.
2. **ReportingCollecte.jsx:53** — CO₂ : constante magique 1.567 + incohérence unité (tonnes calculées, affichées « kg »). Et **:67** statut « En cours » incluant annulées/planifiées. Et **:58** ternaire identique dans les deux branches.
3. **FillRateMap** — buckets de seuils incohérents entre carte (4 niveaux) et KPIs/filtres (3 niveaux), + label « >80% » vs code `>=80`.
4. **Gestion d'erreur absente côté utilisateur** sur PlanningTournees (`:129`), LiveVehicles (`:72`), CollectionProposals (`:29`,`:41`,`:67`,`:79`), DashboardCollecte (`:173`), ReportingCollecte (`:44`) : uniquement `console.error`, aucun état d'erreur ni bouton réessayer (seul Tours.jsx:103 propose un vrai ErrorState avec retry).
5. **Multiples fallbacks de champs** (`registration||vehicle_registration||vehicle_name`, `cav_name||name||nom`, `nb_collected` vs `collected_count`) → contrat back/front instable et incohérent entre endpoints.
6. **Actions sans confirmation** : Tours « Démarrer/Terminer » ; CollectionProposals « Créer cette tournée » (auto-choix du 1er chauffeur, sans confirmation ni feedback succès).
7. **Payloads volumineux rechargés fréquemment** : LiveVehicles `active-summary` (tous points GPS) toutes les 30 s + à chaque event socket sans debounce ; Tours `/tours` sans pagination.

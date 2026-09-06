# 07 — Cartographie du côté récepteur SOLIDATA

> Chantier open data Métropole — agent de reconnaissance du code, 6 septembre 2026. Tous les faits sont vérifiés dans le dépôt (`fichier:ligne`). Ce document sert de base aux propositions d'agrégation ; il ne propose rien lui-même.


Tous les faits ci-dessous sont vérifiés dans le code (`fichier:ligne`, chemins relatifs au dépôt).

## 1. Référentiel communes

### 1.1 Table `referentiel_communes`

`backend/src/scripts/init-db.js:1888-1899`

| Colonne | Type | Note |
|---|---|---|
| `code_insee` | `VARCHAR(5)` | PRIMARY KEY |
| `nom` | `VARCHAR(150)` | NOT NULL |
| `code_postal` | `VARCHAR(5)` | 1er code postal renvoyé par l'API |
| `epci_code` | `VARCHAR(20)` | SIREN 9 chiffres (élargi lot 10, `:1909`, `:1916`) |
| `epci_nom` | `TEXT` | élargi lot 10 (`:1910`, `:1921`) |
| `population_insee` | `INTEGER` | **seule donnée « open data » déjà présente par commune** |
| `is_metropole_rouen` | `BOOLEAN DEFAULT false` | posé `true` uniquement pour l'EPCI `200023414` |
| `created_at` | `TIMESTAMP` | |

Index : `idx_ref_communes_epci` (partiel, `WHERE is_metropole_rouen = true`, `:1898`), `idx_ref_communes_cp` (`:1899`), `idx_ref_communes_epci_all` (`:1927`).

**Il n'existe aucune autre colonne territoriale** : ni déchets, ni emploi, ni QPV, ni surface, ni densité. C'est le point d'accroche naturel d'un enrichissement open data (une table fille `commune_indicateurs(code_insee, millesime, indicateur, valeur, source)` évite d'élargir cette table de référence).

### 1.2 Seed JSON

`backend/src/data/communes-metropole-rouen.json` — **fichier vide : `[]`**. Il est lu par `init-db.js:1931-1948` seulement si la table est vide ; le seed est donc aujourd'hui un no-op silencieux. **Le peuplement réel passe par l'API** (§1.4).

### 1.3 `cav.code_insee_commune`

`init-db.js:1928` : `ALTER TABLE cav ADD COLUMN code_insee_commune VARCHAR(5) REFERENCES referentiel_communes(code_insee) ON DELETE SET NULL`, index `idx_cav_code_insee` (`:1929`).
Rattachement manuel : `PATCH /api/communes/cav/:cavId` (`backend/src/routes/communes.js:389-403`, ADMIN/MANAGER, valide l'existence du code INSEE).
Colonnes commune historiques sur `cav` (texte libre, jamais normalisées) : `commune VARCHAR(100)` (`init-db.js:526`), et `population_commune INTEGER`, `communaute_communes`, `surface`, `ref_refashion`, `entite_detentrice`, `code_postal` (`init-db.js:4780-4786`).

### 1.4 Routes `backend/src/routes/communes.js` (414 l.)

| Route | Rôles | Ce qu'elle fait |
|---|---|---|
| `GET /` | authentifié | liste + filtres `metropole=true`, `epci=<code>` ou `epci=none`, `q` (`:134-152`) |
| `GET /epcis` | ADMIN, MANAGER | EPCI suivis + `metropole_code` (`:159-164`) |
| `POST /epcis` | ADMIN | ajoute `{code, nom}`, SIREN 9 chiffres validé (`:167-183`) |
| `DELETE /epcis/:code` | ADMIN | retrait ; **409 si `200023414`** (`:188-205`) |
| `GET /epci-search?q=&dep=` | ADMIN, MANAGER | proxy serveur vers `geo.api.gouv.fr/epcis` (`:213-246`) |
| `POST /refresh-metropole` et `POST /refresh-epcis` | ADMIN, MANAGER | refresh multi-EPCI (`:256-326`) |
| `POST /` | ADMIN, MANAGER | upsert manuel d'une commune (`:332-353`) |
| `POST /import` | ADMIN | import `rows[]` transactionnel (`:355-387`) |
| `PATCH /cav/:cavId` | ADMIN, MANAGER | rattache un CAV à un code INSEE (`:389-403`) |

**Appel HTTP vers geo.api.gouv.fr — le pattern à réutiliser** (`communes.js:114-127`) :

```js
async function fetchGeoApi(url) {
  return fetch(url, {                       // fetch NATIF Node (pas d'axios)
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(GEO_API_TIMEOUT_MS),
  });
}
```
- Base : `GEO_API_BASE = process.env.GEO_API_BASE || 'https://geo.api.gouv.fr'` (`:25`)
- Timeout : `GEO_API_TIMEOUT_MS || 8000` (`:26`)
- Erreurs typées : `TimeoutError`/`AbortError` → **504** ; autre → **502** (`:122-127`). Aucune valeur inventée en cas d'échec.
- URL du refresh : `/epcis/{code}/communes?fields=nom,code,codesPostaux,population&format=json` (`:265`)
- Transaction **par EPCI** (`:271-298`) : un EPCI en échec ne casse pas les autres ; récap par EPCI + compteurs `inserted`/`updated` (`:311-319`).
- Filtre reporting conservé : `is_metropole_rouen = (epci.code === '200023414')` (`:263`, `:290`).

Helpers purs exportés pour les tests (`:406-412`) : `parseEpciSetting`, `isValidEpciCode`, `mapApiCommune`, `filterEpcisByDep`.

### 1.5 Setting `communes.epci_codes`

`communes.js:24` (`EPCI_SETTING_KEY`), lu par `getConfiguredEpcis()` (`:96-103`), écrit par `saveConfiguredEpcis()` (`:105-112`, `category = 'communes'`). Format : JSON array de `{ code, nom }`. Parsing **résilient** (`parseEpciSetting`, `:45-62`) ; liste vide → défaut `[{code:'200023414', nom:'Métropole Rouen Normandie'}]` (`:23`).

### 1.6 Page `frontend/src/pages/AdminCommunes.jsx` (311 l.)

Route `/admin/communes`, `ProtectedRoute roles={['ADMIN','MANAGER']}` (`frontend/src/App.jsx:241`) ; entrée sidebar « Communes (INSEE) » (`frontend/src/components/Layout.jsx:73`). Liste filtrable, gestion des EPCI suivis, recherche EPCI, bouton « Actualiser depuis l'API » → `POST /communes/refresh-epcis`. Le navigateur ne parle **jamais** directement à geo.api.gouv.fr.

---

## 2. Reporting Métropole

### 2.1 Routes `backend/src/routes/metropole.js` (623 l.)

Garde globale : `authenticate` + `authorize('ADMIN','MANAGER','RH','AUTORITE')` (`:6-7`).

| Route | Ligne | Calcul | Tables lues | Granularité |
|---|---|---|---|---|
| `GET /dashboard?year&month` | `:14-181` | volume collecté, CO₂ évité, effectifs, parc CAV, historique 12 mois, taux de captation | `tours`, `colisages`+`categories_sortantes`, `employees`, `cav`, `historique_mensuel` (repli) | **mois** ; aucune ventilation commune |
| `GET /cav` | `:184-203` | liste CAV pour la carte + dernière collecte, nb collectes 12 m, kg 12 m | `cav`, `tonnage_history` | par borne |
| `GET /cav/:id/details` | `:206-272` | historique tonnages, niveaux, événements, scans QR | `cav`, `tonnage_history`, `tour_cav`+`tours`, `cav_qr_scans` | par borne / 12 mois |
| `GET /evolution?months` | `:275-298` | tonnage, nb tournées, nb CAV distincts | `tours`, `tour_cav` | **mois** |
| `GET /sortie-dynamique?annee` | `:303-343` | taux de sortie dynamique + ventilation | `insertion_milestones` | **année**, global |
| `GET /service-cav?months` | `:346-369` | % CAV collectés vs planifiés | `tours`, `tour_cav` | **mois** |
| `GET /captation-par-commune?annee` | `:388-439` | tonnage réparti + **kg/hab/an par commune** | `tours`, `tour_cav`, `cav`, `tour_weights`, `referentiel_communes` | **commune × année** |
| `GET /delai-intervention-incidents?months` | `:450-492` | délai moyen création→résolution | `incidents` | **mois × type** |
| `GET /kpi-insertion?annee` | `:499-588` | ETP (base 1607 h), par équipe, formation, absentéisme, en parcours | `employees`, `teams`, `work_hours` | **année × équipe**, non nominatif |

**`captation-par-commune` est la seule route à granularité communale** — point de jonction évident avec l'open data (population, déchets/hab, QPV…). Mécanique (`:391-433`) : CTE `poids_tour` + CTE `cav_par_tour`, répartition au prorata agrégée par commune ; oracle `distributeTonnageProrata()` (`:606-619`). Population : `COALESCE(rc.population_insee, c.population_commune)` (`:404`). Filtre de périmètre `rc.epci_code = '200023414'` (`:429`).

### 2.2 Facteurs CO₂ (constantes du dashboard)

`metropole.js:40` : `reutilisation` **3.169**, `recyclage` **0.500**, `chiffons` **0.750**, `csr` **0.121** t CO₂ évité / t textile. Mix observé sur colisages scellés (`:44-65`, seuil `total_kg > 100`) sinon **fallback 40/35/15/10** (`mix_source: 'fallback'`). Objectif Refashion en dur `objectif_refashion_kg: 3.6` (`:143`). Le taux de captation global (`:128-146`) utilise `SUM(cav.population_commune)` — **pas `referentiel_communes.population_insee`** : incohérence vs `/captation-par-commune`.

### 2.3 Page `frontend/src/pages/ReportingMetropole.jsx` (678 l.)

Sections : filtres mois/année/commune (`:209-221`), 6 cartes KPI (`:249-263`), KPI P0-E (`:266-314`), contrepartie sociale (`:318-355`), histogramme mensuel (`:358-375`), **captation par commune** (`:378-450`), carte Leaflet avec détail borne (`:453-636`). Exports : **CSV** `exportCaptationCsv()` (`:85-94`) ; **PDF** « Revue de convention » `printReview()` (`:99-142`).

### 2.4 Rôle AUTORITE (élus / auditeurs)

Rôle intégré `backend/src/utils/roles.js:16` ; landing `/reporting-metropole` (`App.jsx:145`) ; section sidebar « Audit & conformité » (`Layout.jsx:244-260`) : Reporting Métropole, Reporting Collecte, Carte des CAV, Refashion (DPAV), Exports d'audit DPAV. **AUTORITE ne voit ni `/admin/communes` ni aucune page nominative.**

---

## 3. Données de collecte par borne

| Table | Définition | Colonnes utiles |
|---|---|---|
| `cav` | `init-db.js:523-541` | `commune`, `latitude`/`longitude`, `geom` + GiST, `nb_containers`, `status`, `avg_fill_rate` ; `code_insee_commune` (`:1928`) ; `population_commune`, `communaute_communes`, `surface`, `code_postal` (`:4780-4786`) ; `tournee`, `jours_collecte`, `freq_passage`, `estimated_fill_rate`, `daily_fill_rate` (`:2775-2782`) ; capteurs `lora_deveui`… (`:4680-4685`) |
| `tonnage_history` | `:687-696` | `date`, `cav_id`, `route_name`, `weight_kg`, `source` |
| `tour_cav` | `:628-643` | `status`, `fill_level 0-5`, `collected_at`, `predicted_fill_rate`, `planned_passage_time`, `skip_reason` |
| `ml_fill_predictions` | `:1182-1193` | `predicted_fill_rate`, `confidence`, **`features JSONB`**, `UNIQUE(cav_id, predicted_date)` |
| `collection_context` | `:1220-1235` | `date UNIQUE`, météo, **`weather_factor`**, **`traffic_factor`**, `duration_factor` ; `traffic_source`, `traffic_measured_at` (`:1241-1244`) |
| `evenements_locaux` | `:1246-1262` | `type` (défaut `brocante`), dates, lat/lng, `commune`, `rayon_km` 2, `bonus_factor` 1.2 |
| `predictive_weather_factors` | `:1420-1428` | segment × facteur appris |
| `cav_sensor_readings` | `:4688-4707` | `fill_level_percent`, `distance_cm`, batterie, `reading_at` |

### 3.1 Facteurs externes déjà consommés par le moteur (`backend/src/routes/tours/predictions.js`, `predictFillRate` `:278-570`)

| Facteur | Source | Où |
|---|---|---|
| Météo directe | `collection_context.weather_factor` | `:391-392` |
| Beau temps × week-end appris | `predictive_weather_factors`, repli 1.15 | `:401-413` |
| Événements locaux | `evenements_locaux` + haversine | `:415-423` ; `context.js:85-103` |
| Saisonnalité / jour de semaine | `utils/fill-factors.js` (appris > manuel > défaut) | `:280-288` |
| Jours fériés / vacances zone B | listes en dur | `:29-73`, `:351-367` |
| **Densité (proxy)** | `nb_containers >= 3 → ×1.1` — proxy grossier de la densité de population | `:386-388` |
| Corrections apprises | CAV 60 % / période 25 % / **zone 15 %** | `:432-511` |
| Trafic | stocké, **non appliqué au remplissage** (sert au temps de tournée) | `context.js:30` |

`getContextForDate` (`backend/src/routes/tours/context.js:21-82`) : Open-Meteo avec `AbortController` 3 s, persistance `ON CONFLICT (date) DO UPDATE`. `services/predictive-ai.js` (Claude) consomme aussi feedback, météo, événements, capteurs ; `recalcSeasonalFactors()` (`:440-504`).

### 3.2 `evenements_locaux` — alimentation manuelle ET automatique par open data

1. Manuelle : `backend/src/routes/tours/events.js` + `AdminPredictive.jsx:377`.
2. **Automatique** : `backend/src/routes/tours/events-auto.js` — `POST /events-auto/discover` (`:443`), sources `['openagenda','opendatasoft','metropole_rouen','seine_maritime','saisonnier']` (`:461`).

| Source | Endpoint | Ligne |
|---|---|---|
| OpenAgenda | `api.openagenda.com/v2/events` | `:159` |
| OpenDataSoft public | `public.opendatasoft.com/api/explore/v2.1/…` | `:204` |
| **Métropole Rouen Open Data** | `data.metropole-rouen-normandie.fr/api/explore/v2.1/catalog/datasets/{ds}/records`, cascade `evenements-publics-openagenda`, `agenda-des-manifestations-702588`, `evenements`, `agenda` | `:241-291` |
| Seine-Maritime Open Data | `opendata.seinemaritime.fr/api/explore/v2.1/…` | `:308` |

**Il existe donc déjà un client Explore API v2.1 fonctionnel contre `data.metropole-rouen-normandie.fr`** (`httpGet` avec suivi de 3 redirections et timeout, `events-auto.js:84-95`) : socle à réutiliser.
3. `backend/src/services/event-discovery.js` (OpenAgenda + vide-greniers.fr + brocabrac.fr), job `discoverEvents` mensuel.

---

## 4. Refashion

| Objet | Définition | Contenu communal |
|---|---|---|
| `refashion_dpav` | `init-db.js:1120-1138` | aucun (trimestriel global) |
| `refashion_communes` | `:1140-1149` | `commune VARCHAR(100)` **texte libre**, `code_postal`, `poids_kg` — ni INSEE, ni population, ni nb PAV |
| `vw_dpav_communes` | `:2181-2203` | `code_insee` via `referentiel_communes`, même prorata que `/captation-par-commune` ; pas de population ni nb PAV |
| `refashion_subventions` | `:1151-1174` | €/t réemploi 80 / recyclage 295 / CSR 210 / énergie 20 / entrée 193 |

`GET /api/refashion/communes` (`refashion.js:399-424`) joint `nb_cav` par **`cav.commune ILIKE rc.commune`** (textuel). Exports `EXPORT_VIEWS` (`:355-361`).

---

## 5. Énergie & GES

`ges_facteurs` (`init-db.js:7185-7198`), seed 2024 (`:7204-7212`) : électricité 0.052, gaz 0.227, eau 0.132, gazole 2.51, essence 2.28, GNV 2.96 kgCO2e. Routes `energie.js` `/facteurs`, `/dashboard` (intensité tCO2e/k€), `/vsme-b3b6`. **Deux mondes CO₂** : `ges_facteurs` = émissions propres, paramétrables ; `FACTEURS_CO2` de `metropole.js:40` = CO₂ évité, **codé en dur** — candidat à migration.

---

## 6. Insertion / emploi — KPI non nominatifs

| Endpoint | Fichier:ligne | Nature |
|---|---|---|
| `GET /api/metropole/kpi-insertion?annee` | `metropole.js:499-588` | ETP base 1607 h par équipe, formation, absentéisme, en parcours ; chaque bloc dégrade en `null` |
| `GET /api/metropole/sortie-dynamique?annee` | `metropole.js:303-343` | taux + ventilation |
| `GET /api/insertion/audit?year` | `backend/src/routes/insertion/routes.js:2979-2989` | `gatherAuditKpis(year)` |
| Effectifs ETP | `backend/src/routes/effectifs.js` | convention `settings effectifs.convention_<annee>` (`:100-129`), ASP |

**Commune de résidence** : `employees.city VARCHAR(120)`, `employees.postal_code VARCHAR(20)` (`init-db.js:3158-3159`), **libres, sans FK ni code INSEE**. **QPV : aucune implémentation** ; manque signalé dans `rapports/insertion-2026-07-22/01-cadrage-conformite.md:218`, `02-etude-recrutement.md:78,133-135`, `07-revue-auditeur.md:151`. Seuil d'anonymat existant : module Enquêtes `n ≥ 5`.

---

## 7. Patterns d'intégration externe à réutiliser

| Brique | Fichier | Pattern |
|---|---|---|
| Open-Meteo + cache mémoire | `backend/src/utils/weather.js` | `Map` TTL 1 h (`:5-6`), clé arrondie 0.01° ; `fetchOpenMeteoDailyRange` avec `AbortController` 10 s ; échec → `null` |
| BAN géocodage | `backend/src/services/geocodage.js` | timeout 5 s, parseur pur `parseBan` (`:35-56`) qui renvoie déjà **`code_insee`** (`:48`), échec → `{disponible:false}` |
| TomTom | `backend/src/services/routing-tomtom.js` | fonctions pures `buildRouteUrl`/`parseRouteResponse`, échec → `null` + repli assumé |
| Scheduler | `backend/src/services/scheduler.js` | `runInstrumented(jobName, fn, timeoutMs)` (`:72`) → `job_runs` ; tick top d'heure + verrou (`:1856-1857`) ; `runAllJobs` 3×/j (`:2010-2063`) |
| Registre de supervision | `backend/src/routes/monitoring.js` | **`JOB_SCHEDULE`** (`:91-177`) `{ label, cadence, maxAgeHours }` ; constantes `DAILY 26`, `WEEKLY 192`, `MONTHLY 768`, `YEARLY 8880` ; **un job = 1 ligne + 1 `runInstrumented`** |
| Cache Redis | `backend/src/middleware/cache.js` | `cacheMiddleware(keyBuilder, ttlSeconds)` (`:45-67`), `X-Cache`, dégradation silencieuse sans Redis ; usages `cav.js:112` (60 s), `dashboard.js:502` (300 s) |
| Settings | `init-db.js:118-125` | `settings(key UNIQUE, value TEXT, category)` ; pas de helper global ; patterns `communes.js:96-112`, `effectifs.js:100-129` |
| API publique partenaires | `backend/src/routes/public-api.js` | `X-API-Key`, scopes `cav:read`, `stats:read`, `refashion:read` ; `/cav`, `/stats/daily`, `/stats/monthly`, `/refashion/dpav` |
| Middleware clé API | `backend/src/middleware/api-key.js` | SHA-256 + temps constant, `active`/`expires_at`, scopes, identité service lecture seule |

⚠️ **Bug vérifié** : `GET /api/public/refashion/dpav` filtre sur `year`/`trimester` (`public-api.js:105-106`) alors que la table a `annee`/`trimestre` (`init-db.js:1122-1123`) → 500 garanti (`42703` non rattrapé). À corriger avant d'ouvrir cette API à la Métropole.

---

## 8. Documents

### 8.1 `rapports/audits/2026-05-10-audit-metropole-rouen.md` — attentes des élus

Deux axes conventionnés (environnemental : tonnages, captation 3,6 kg/hab/an, valorisation, CO₂ ; social : CDDI, durée, sortie dynamique, freins), périmètre 71 communes / ~700 000 hab. Deux blocages initiaux (référentiel INSEE — fait ; sortie dynamique — fait). Griefs : mix CO₂ en dur, bilan détourné par déduction, pas de décomposition par filière ; 6 documents exigibles en revue annuelle (`:269-277`) : bilan collecte par commune, bilan insertion, bilan emploi, liste géolocalisée des CAV, historique 24 mois, audit RGPD. Couverture 88 % après sprints.

### 8.2 Mentions « open data » / « Métropole » dans `docs/`

`docs/LOGIQUE_TOURNEES.md:490-508` (événements auto, 4 sources dont Métropole Rouen Open Data) ; `docs/VARIABLES_APPLICATION.md:114-127` ; `docs/DOCUMENTATION_APPLICATIVE.md:438` ; `docs/DIAGNOSTIC_UX_SOLIDATA.md:75` (propose une page « Synthèse impact » unifiée) ; `docs/GUIDE_UTILISATEUR.md:135,533`.

---

## 9. Points d'accroche recommandés

| Besoin | Ce qui existe | Ce qui manque |
|---|---|---|
| Clé de jointure territoriale | `referentiel_communes.code_insee` + `cav.code_insee_commune` | rien |
| Population | `population_insee` (geo.api.gouv.fr) | millésime non tracé |
| Tonnage par commune | `/metropole/captation-par-commune`, `vw_dpav_communes` | granularité mensuelle |
| Déchets / environnement Métropole | — | tout |
| Emploi / QPV | `employees.city`, `postal_code` | normalisation INSEE, référentiel QPV, seuil d'anonymat |
| Client open data Métropole | `events-auto.js:241-291` | généralisation hors « événements » |
| Job supervisé | `runInstrumented` + `JOB_SCHEDULE` | déclaration |
| Exposition à la Métropole | `public-api.js` + scopes + cache | scope territorial ; bug `year`/`annee` |

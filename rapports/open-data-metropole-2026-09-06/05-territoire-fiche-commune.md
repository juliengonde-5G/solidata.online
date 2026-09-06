# Territoire, population & tableau de bord des élus — la « fiche commune »

> Agent thématique « Territoire, population & tableau de bord des élus » — chantier de cadrage open data MRN, 6 septembre 2026.
> Lecture préalable : `rapports/open-data-metropole-2026-09-06/01-inventaire-catalogue.md` (inventaire du catalogue, portail bloqué en fetch depuis cette session) et `rapports/open-data-metropole-2026-09-06/07-cartographie-solidata.md` (côté récepteur SOLIDATA).
> Toutes les références `fichier:ligne` renvoient au dépôt `/home/user/solidata.online`.

---

## 1. Périmètre et enjeu métier

SOLIDATA sait déjà répartir le tonnage collecté par commune au prorata des CAV rattachés (`GET /metropole/captation-par-commune`, `backend/src/routes/metropole.js:388-439`) et le rapporter à `referentiel_communes.population_insee` (`backend/src/scripts/init-db.js:1888-1899`), alimenté depuis `geo.api.gouv.fr` (`backend/src/routes/communes.js:114-127`). C'est la seule route à granularité communale de l'ERP ; tout le reste du reporting Métropole (`metropole.js:14-181, 303-343, 346-369, 499-588`) est agrégé à l'échelle des 71 communes ou de la structure.

L'enjeu de ce chantier n'est pas de créer une nouvelle donnée de collecte : c'est de **transformer une ligne de tableau en argument politique lisible par un élu** — sa commune, sa population, ce que SOLIDATA y fait, ce que ça lui rapporte (kg/hab, CO2, coût évité), comment elle se situe par rapport à la moyenne Métropole. Cela suppose (a) de croiser le peu de données déjà présentes avec des attributs de population/logement/équipements normalement absents de l'ERP, (b) de tracer le millésime d'une population qui ne l'est pas aujourd'hui, (c) de border le prorata (CAV non rattaché, EPCI limitrophes) pour ne jamais présenter un chiffre halluciné à un élu, et (d) de donner un canal de restitution (écran, PDF, API) au rôle AUTORITE qui n'a aujourd'hui accès qu'à des vues globales.

Le chantier reste **majoritairement réalisable dès aujourd'hui avec les seules données SOLIDATA** (P-TER-01, -02, -03, -05, -06, -07 partiellement) ; l'open data Métropole/INSEE apporte surtout le **contexte de comparaison** (superficie officielle, contours pour la carte, résidences/équipements pour qualifier le territoire) et la **traçabilité de millésime** qui manque structurellement.

---

## 2. Jeux de données retenus

| Identifiant/source | Certitude | Granularité | Fraîcheur | Clé de jointure | Usage |
|---|---|---|---|---|---|
| `referentiel_communes` (SOLIDATA interne) | **Vérifié** (code) — `init-db.js:1888-1899` | commune | mise à jour manuelle (bouton « Actualiser depuis l'API », `AdminCommunes.jsx`) ; **aucun horodatage de rafraîchissement stocké** (pas de colonne `updated_at`) | `code_insee` (PK) | pivot de toute la fiche commune ; seule table qui porte déjà `population_insee` |
| `geo.api.gouv.fr /epcis/{code}/communes` puis `/communes/{code}?geometry=contour` | **Vérifié en production** (déjà consommé par `communes.js:114-127, 265`) ; `format=geojson&geometry=contour` confirmé par la doc officielle de l'API Découpage administratif (recherche web du 06/09/2026) | commune | population « en vigueur » au moment de l'appel — **le millésime exact (année RP de référence) n'est pas un champ renvoyé par l'appel `fields=nom,code,codesPostaux,population` actuellement utilisé** | `code` = `code_insee` | population de référence + **contour GeoJSON pour la carte choroplèthe** (non exploité aujourd'hui : aucun composant `GeoJSON` Leaflet dans `frontend/src`, vérifié par recherche) |
| INSEE — Dossier complet par commune/EPCI (`insee.fr/fr/statistiques/2011101`, API Données locales `api.insee.fr`) | **Signalé** (accessible en production, bloqué depuis cet environnement ; nécessite une clé `api.insee.fr`) | commune / EPCI 200023414 | annuelle, publiée en janvier ; le millésime « recensement » a ~3 ans de retard sur l'année de publication (ex. millésime 2026 = RP légal en vigueur au 1ᵉʳ janvier 2026, basé sur les enquêtes de recensement 2021-2025) | `code_insee` / code EPCI | **source officielle** de population légale millésimée, logements (total, résidences principales/secondaires, vacants), densité, superficie — aucun de ces attributs n'existe dans SOLIDATA aujourd'hui |
| `donmetdec_pav` — Points d'apport volontaire déchets MRN (portail MRN, tous flux dont **textile**) | **Vérifié** (URL vue, aussi sur data.gouv.fr, LO 2.0) | point géolocalisé | MAJ 14/06/2026 (data.gouv.fr) | à rapprocher par distance/commune des `cav` SOLIDATA (aucune clé commune garantie) | détecter les PAV textile de la Métropole absents du parc SOLIDATA et réciproquement — **hors périmètre direct de la fiche commune, mais alimente le bloc « capacité » en phase 2** |
| `cadastre-communes-metropole-rouen-normandie-sage-cailly-aubette-robec` (portail MRN) | **Vérifié** (URL vue) | polygone commune | n.d. | nom de commune (à rapprocher, pas de code INSEE confirmé dans le schéma non lu) | alternative aux contours `geo.api.gouv.fr` pour la carte choroplèthe — source cadastre DGFiP, licence probable LO 2.0 (non confirmée par lecture directe) |
| `residences-sociales-…`, `residences-seniors-…`, `residences-jeunes-…`, `residences-etudiants-metropole-rouen-normandie` (portail MRN) | **Vérifié** (URL vues) | point | n.d. | commune (texte, à normaliser en `code_insee` — pas de champ confirmé) | bloc « population et caractéristiques » de la fiche : typologie de logement social/spécifique par commune |
| `salles-et-equipements-culturels` (portail MRN) | **Vérifié** (URL vue) | point | n.d. | commune | bloc « caractéristiques » : nombre d'équipements culturels, indicateur de vie locale à mettre en regard de la collecte |
| `agenda-metropole-rouen-normandie` (portail MRN) | **Vérifié** ; **déjà interrogé en production** par `backend/src/routes/tours/events-auto.js:241-291` (cascade de datasets `evenements-publics-openagenda`, `agenda-des-manifestations-702588`, `evenements`, `agenda`) | événement | continue | commune (champ à confirmer par lecture du schéma) | pas directement un indicateur de fiche commune, mais le **socle technique Explore API v2.1 existe déjà et fonctionne** — c'est le point d'appui pour tout nouvel appel au portail MRN |
| `filaire-de-voies-metropolitain-par-troncons` (portail MRN) | **Vérifié** (URL vue) | linéaire | n.d. | nom de voie | rattachement fin adresse ↔ commune pour les CAV non rattachés (`code_insee_commune IS NULL`) — utilité secondaire pour fiabiliser le prorata |
| `cav` + `tour_cav` + `tonnage_history` + `tour_weights` (SOLIDATA interne) | **Vérifié** (`init-db.js:523-541, 628-643, 687-696`) | CAV / tournée / jour | temps réel | `cav.code_insee_commune` (`init-db.js:1928`) | bloc « capacité » et « bénéfices » — déjà exploité par `captation-par-commune` |
| `insertion_milestones` + `metropole.js /kpi-insertion` (SOLIDATA interne) | **Vérifié** (`metropole.js:303-343, 499-588`) | structure entière (non communal) | mensuelle/annuelle | aucune (pas de granularité géographique) | bloc « bénéfices sociaux » de la fiche **au niveau Métropole uniquement** — cf. P-TER-06 pour la réserve méthodologique sur une déclinaison par commune |

---

## 3. Propositions d'agrégations

### P-TER-01 — Fiche commune consolidée (capacité + population + bénéfices)

- **Indicateur** : pour une commune donnée — nb de CAV actifs, nb de conteneurs, nb de tournées/an, kg collectés/an, kg/hab/an, rang parmi les communes rattachées.
- **Formule / méthode** : extension directe de `distributeTonnageProrata()` (spécification exécutable référencée `metropole.js:380-386`, requête `metropole.js:388-439`) — ajouter `COUNT(DISTINCT c.id) FILTER (WHERE c.status='active')` et `COUNT(*) FILTER (WHERE tc.status='collected')` par commune sur la même fenêtre temporelle, plus une CTE de fréquence moyenne = `AVG(intervalle entre deux tour_cav.collected_at consécutifs)` par CAV puis moyenne par commune.
- **Sources croisées** : `tours`, `tour_cav`, `tour_weights`, `cav`, `referentiel_communes` — **aucune source externe requise**.
- **Granularité** : commune × année (extensible au mois, comme `captation-par-commune?annee=`).
- **Consommateur et écran cible** : `ReportingMetropole.jsx` — nouveau sélecteur de commune (voir §4) + export PDF « fiche commune » dédié (pattern `printReview`, `ReportingMetropole.jsx:99-142`).
- **Prérequis phase 2** : aucun pour la version SOLIDATA-only ; le millésime de population (P-TER-04) conditionne la fiabilité du kg/hab affiché.
- **Effort** : S.
- **Valeur** : 5.
- **Risques / donnée absente** : commune sans aucun CAV rattaché → fiche affichée avec bloc capacité à zéro et mention explicite (pas de silence) ; CAV avec `code_insee_commune IS NULL` déjà traité comme « non rattaché » côté écran (`ReportingMetropole.jsx:395-400`), à répliquer dans la fiche individuelle.

### P-TER-02 — Taux de maillage territorial (CAV rapportés à la superficie et à la population)

- **Indicateur** : CAV/km² et habitants par CAV, comparés à la moyenne Métropole.
- **Formule / méthode** : `nb_cav_actifs / superficie_km²` et `population_insee / nb_cav_actifs`. La superficie n'existe dans aucune table SOLIDATA (`cav.surface` est un champ texte libre par CAV, `init-db.js:4782`, pas une superficie communale) — elle vient soit du champ `surface` renvoyé par `geo.api.gouv.fr` (en hectares, à convertir), soit du « Dossier complet » INSEE (km²).
- **Sources croisées** : `referentiel_communes` (population) + `cav` (comptage) + geo.api.gouv.fr ou INSEE (superficie, **absente aujourd'hui**).
- **Granularité** : commune.
- **Consommateur et écran cible** : bloc « capacité » de la fiche commune ; entre dans le calcul de la segmentation (P-TER-07).
- **Prérequis phase 2** : ajouter une colonne `referentiel_communes.surface_km2` et la peupler via `geo.api.gouv.fr` (à vérifier : `fields=surface` — cf. §6, requête curl).
- **Effort** : S.
- **Valeur** : 4.
- **Risques / donnée absente** : `surface_km2 NULL` → afficher « superficie non renseignée », jamais un ratio calculé sur une valeur manquante convertie en 0.

### P-TER-03 — Rang et écart à la moyenne Métropole

- **Indicateur** : rang de la commune sur kg/hab/an, taux de service CAV, et écart en % à la moyenne (et à la médiane) des communes rattachées.
- **Formule / méthode** : `RANK() OVER (ORDER BY kg_par_hab DESC)` et `AVG(kg_par_hab) OVER ()` ajoutés à la requête de `captation-par-commune` (`metropole.js:388-439`) ; écart = `(valeur_commune - moyenne) / moyenne`.
- **Sources croisées** : aucune, 100 % SOLIDATA.
- **Granularité** : commune × année.
- **Consommateur et écran cible** : bandeau « Comparaison avec la Métropole » de la fiche commune (§4) et sélecteur de commune sur `ReportingMetropole.jsx`.
- **Prérequis phase 2** : aucun.
- **Effort** : S.
- **Valeur** : 5 — c'est l'argument que l'élu vient chercher (« où en est ma commune par rapport aux autres »).
- **Risques / donnée absente** : sur une commune à 1 seul CAV, un rang est statistiquement peu robuste (un seul incident fait chuter le classement) — appliquer un **seuil paramétrable** (`nb_cav >= 3`, sur le même principe que le seuil `n ≥ 5` du module Enquêtes) en dessous duquel le rang est masqué au profit d'une mention « échantillon trop réduit pour être classé ».

### P-TER-04 — Millésime de population tracé

- **Indicateur** : année de référence de la population affichée (ex. « population municipale 2023, en vigueur au 1ᵉʳ janvier 2026 »), date du dernier rafraîchissement.
- **Formule / méthode** : ajouter deux colonnes à `referentiel_communes` — `population_annee_reference INTEGER` et `population_maj_le TIMESTAMP` — renseignées à chaque `POST /communes/refresh-metropole` / `refresh-epcis` (`communes.js:256-326`). Aujourd'hui, ni l'upsert manuel (`communes.js:332-353`) ni le refresh automatique ne posent le moindre horodatage : `referentiel_communes` n'a **aucune colonne `updated_at`** (`init-db.js:1888-1896`), donc une population vieille de deux ans et une population fraîche sont indiscernables à l'écran.
- **Sources croisées** : `geo.api.gouv.fr` (si l'API expose l'année de référence — à vérifier, §6) ou, à défaut, l'année de publication INSEE en vigueur au moment du refresh (connue par convention : chaque appel effectué en 2026 récupère la population « millésime 2026 »).
- **Granularité** : commune.
- **Consommateur et écran cible** : toutes les fiches commune, tous les KPI kg/hab (dashboard MRN, captation par commune) — un simple libellé « (population 2023, actualisée le 12/08/2026) » sous chaque chiffre.
- **Prérequis phase 2** : vérifier si `geo.api.gouv.fr` restitue le millésime dans un champ dédié, sinon le figer par convention à la date d'appel (§6, requête curl n°2).
- **Effort** : S.
- **Valeur** : 4 — condition de crédibilité, pas un indicateur en soi.
- **Risques / donnée absente** : sur les communes jamais rafraîchies depuis leur import initial (seed JSON vide, `init-db.js:1931-1948`, donc peuplées uniquement par API), `population_maj_le` sera `NULL` — l'afficher comme tel plutôt que de laisser croire à une fraîcheur inconnue.

### P-TER-05 — Coût évité de traitement des ordures ménagères

- **Indicateur** : coût de traitement des ordures ménagères évité par le textile détourné = tonnes détournées × coût de traitement OM (€/t), par commune et pour la Métropole.
- **Formule / méthode** : `cout_evite_eur = poids_kg / 1000 * cout_traitement_eur_t`, où `cout_traitement_eur_t` est lu par une **cascade honnête**, sur le modèle exact de `resolveCA()` (`backend/src/routes/energie.js:616-625`) : (1) setting épinglé par année si la Métropole communique un chiffre officiel de son RPQS — `metropole.cout_traitement_om_eur_t_<annee>` ; (2) setting générique `metropole.cout_traitement_om_eur_t` (valeur de référence documentée, éditable) ; (3) `null` avec `source: 'absent'`, **jamais une valeur inventée codée en dur**. Aucune valeur officielle propre à la Métropole Rouen Normandie n'a pu être trouvée par recherche web (le RPQS de la MRN n'a pas été atteint depuis cet environnement) ; l'ordre de grandeur régional trouvé — **coût complet moyen ~353 €/tonne (~223 €/hab) en Normandie, RPQS 2023 compilés, ORD Normandie** — peut servir de **valeur de démarrage documentée et modifiable**, jamais présentée comme le chiffre de la Métropole.
- **Sources croisées** : SOLIDATA (`poids_kg` de `captation-par-commune`) + `settings` (nouveau réglage, pattern `settings(key UNIQUE, value TEXT, category)`, `init-db.js:118-125`).
- **Granularité** : commune × année et total Métropole.
- **Consommateur et écran cible** : bloc « avantages » de la fiche commune, revue de convention PDF (`printReview`, `ReportingMetropole.jsx:99-142`).
- **Prérequis phase 2** : obtenir le coût réel de traitement OM de la Métropole (RPQS annuel, document PDF non API) pour remplacer l'estimation régionale par une valeur épinglée et sourcée.
- **Effort** : S.
- **Valeur** : 5 — c'est l'argument budgétaire le plus direct pour un élu.
- **Risques / donnée absente** : `source: 'absent'` doit bloquer l'affichage d'un chiffre (jamais 0 €, qui se lirait comme « aucun coût évité ») ; toujours accompagné d'un libellé « estimation » et de la source affichée à l'écran, jamais en dur dans le code (exigence explicite du cadrage).

### P-TER-06 — Emplois d'insertion imputés au territoire (réserve méthodologique forte)

- **Indicateur** : « équivalent ETP imputable à la commune » = ETP réalisés de la structure (`GET /metropole/kpi-insertion`, `metropole.js:499-588`) × (kg collectés dans la commune / kg collectés total).
- **Formule / méthode** : simple règle de trois sur les poids déjà calculés par `captation-par-commune`, appliquée à `total_etp` de `kpi-insertion`.
- **Sources croisées** : `metropole.js:499-588` (non nominatif, agrégats ETP/formation/absentéisme) + `captation-par-commune`.
- **Granularité** : commune × année (dérivée d'un agrégat structure entière, pas mesurée par commune).
- **Consommateur et écran cible** : bloc « avantages » de la fiche commune — **avec avertissement de méthode explicite et visible** (« ETP conventionnel, réparti au prorata du tonnage — pas un emploi physiquement affecté à la commune »).
- **Prérequis phase 2** : validation politique/méthodologique côté client avant diffusion à un élu — ce n'est pas une donnée mesurée, c'est une clé de répartition conventionnelle, et une commune pourrait légitimement contester le principe.
- **Effort** : S (calcul) / M (validation + pédagogie de l'affichage).
- **Valeur** : 3 — utile en discours politique, fragile si présenté sans la réserve.
- **Risques / donnée absente** : à ne publier qu'accompagné de la note de méthode ; en cas de doute, **ne pas décliner par commune** et se limiter à l'indicateur Métropole (déjà affiché aujourd'hui via `kpiInsertion` sur `ReportingMetropole.jsx`).

### P-TER-07 — Segmentation des communes (typologie de maillage/captation)

- **Indicateur** : classe qualitative par commune — ex. « bien maillée », « sous-équipée », « à fort potentiel », « hors périmètre suivi ».
- **Formule / méthode** : voir règles détaillées au §4. Combine densité de maillage (P-TER-02), taux de captation vs objectif (P-TER-01/03) et taux de service CAV (aujourd'hui **global**, `metropole.js:346-369` — non ventilé par commune, à étendre en joignant `cav.code_insee_commune`).
- **Sources croisées** : P-TER-01, P-TER-02, P-TER-03 + extension de `service-cav` par commune.
- **Granularité** : commune × année.
- **Consommateur et écran cible** : bloc « segmentation » de la fiche commune, code couleur sur la carte choroplèthe (P-TER-08), tri des communes en liste sur `ReportingMetropole.jsx`.
- **Prérequis phase 2** : superficie communale (P-TER-02) pour la densité de maillage ; contour géographique utile mais non bloquant (la segmentation peut fonctionner en tableau seul).
- **Effort** : M.
- **Valeur** : 5 — demande explicite du cadrage (b).
- **Risques / donnée absente** : communes à faible nombre de CAV → biais des petits nombres (cf. P-TER-03) ; seuils de segmentation à calibrer avec le client sur les 71 communes réelles avant mise en production, jamais figés en dur sans revue.

### P-TER-08 — Carte choroplèthe de la Métropole

- **Indicateur** : carte des 71 communes coloriées par kg/hab/an, taux de service, ou segment (P-TER-07).
- **Formule / méthode** : couche Leaflet `GeoJSON` (composant **absent aujourd'hui** — vérifié par recherche `grep -rn "GeoJSON\b" frontend/src` : la carte de `ReportingMetropole.jsx:453-500` n'affiche que des `CircleMarker` ponctuels) alimentée par les contours communaux, coloriée via un `style` fonction de l'indicateur choisi ; jointure sur `code_insee`.
- **Sources croisées** : `geo.api.gouv.fr` (`?format=geojson&geometry=contour`, confirmé par la documentation officielle de l'API Découpage administratif) **ou** le jeu portail MRN `cadastre-communes-metropole-rouen-normandie-sage-cailly-aubette-robec` + P-TER-01/03/07 pour la valeur affichée.
- **Granularité** : commune.
- **Consommateur et écran cible** : nouvelle section carte de `ReportingMetropole.jsx`, alternative/complément à la carte de bornes existante.
- **Prérequis phase 2** : choisir la source de contour (geo.api.gouv.fr, déjà maîtrisé côté intégration, vs portail MRN, schéma non lu) ; décider du stockage (table `commune_contour geometry` PostGIS — l'extension PostGIS est déjà active, `docker-compose*.yml` — vs fichier GeoJSON statique régénéré périodiquement) ; la documentation prévient que le paramètre `geometry=contour` **alourdit sensiblement** la réponse, prévoir un cache ou une simplification de tracé.
- **Effort** : M.
- **Valeur** : 4.
- **Risques / donnée absente** : commune du référentiel élargi (EPCI limitrophe 27/76, lot 10) sans contour récupéré → l'omettre de la carte plutôt que de laisser un trou visuel non expliqué ; licence des contours à confirmer avant publication externe (cf. §5).

### P-TER-09 — Export et API territoriale par commune, correction du bug `public-api.js`

- **Indicateur** : accès à la fiche commune via 3 canaux — écran (`/reporting-metropole` avec sélecteur), export PDF A4, export CSV, et API publique scopée à une commune ou à l'EPCI Métropole.
- **Formule / méthode** : réutiliser le pattern `apiKeyAuth(['scope'])` (`backend/src/middleware/api-key.js`) avec un nouveau scope `commune:read` — mais **`api_keys.scopes` est un simple `TEXT[]` sans métadonnée** (`init-db.js:1362-1373`), donc pas de restriction native à UNE commune. Solution additive proposée : convention de scope paramétré `commune:<code_insee>` (ex. `commune:76540`), parsé par la route `GET /api/public/communes/:code_insee/fiche` — aucune migration de schéma nécessaire. **Corriger au passage le bug déjà identifié** : `GET /api/public/refashion/dpav` filtre sur `req.query.year`/`req.query.trimester` (`public-api.js:105-106`) mappés tels quels en noms de colonnes SQL, alors que la table `refashion_dpav` a pour colonnes `annee`/`trimestre` (`init-db.js:1121-1122`) → **500 garanti** (`42703` non rattrapé) au premier appel filtré ; la route ne doit pas être ouverte à la Métropole en l'état.
- **Sources croisées** : toutes les P-TER précédentes (la fiche consolidée est le contenu de l'export).
- **Granularité** : commune (export unitaire) ou liste complète (export CSV global, déjà en partie fait via `exportCaptationCsv`, `ReportingMetropole.jsx:85-94`).
- **Consommateur et écran cible** : rôle AUTORITE, section « Audit & conformité » (`Layout.jsx:245-258`) ; API publique pour un futur usage direct par le SI de la Métropole.
- **Prérequis phase 2** : trancher le périmètre exact du scope territorial (une commune par clé vs tout l'EPCI) et si l'export CSV doit couvrir une commune ou les 71 en une fois (les deux sont utiles, à des audiences différentes).
- **Effort** : M.
- **Valeur** : 4.
- **Risques / donnée absente** : sans le correctif year/annee, toute ouverture de `public-api.js` à un tiers casse au premier filtre temporel — **bloquant avant toute publication externe**.

---

## 4. La fiche commune — maquette textuelle

### 4.1 En-tête

```
[Nom de la commune]  ·  Code INSEE [xxxxx]  ·  EPCI : Métropole Rouen Normandie
Population : XX XXX habitants (recensement millésime 20XX, actualisé le JJ/MM/AAAA)
Rang parmi les 71 communes de la Métropole (sur kg/hab/an) : N / 71
Segment : [Bien maillée | Sous-équipée | À fort potentiel | Échantillon insuffisant]
```
Note de méthode affichée sous l'en-tête : « Les données de cette fiche concernent uniquement le périmètre géré par SOLIDATA/Solidarité Textiles pour la collecte textile. Elles ne couvrent ni les ordures ménagères ni les autres flux de déchets de la Métropole. »

### 4.2 Bloc « Capacité de collecte »

| Indicateur | Valeur | Comparaison Métropole | Source |
|---|---|---|---|
| Nombre de bornes (CAV) actives | N | moyenne : X | SOLIDATA (`cav`, `code_insee_commune`) |
| Nombre de conteneurs | N | — | SOLIDATA (`cav.nb_containers`) |
| Nombre de tournées / an | N | moyenne : X | SOLIDATA (`tour_cav`) |
| Fréquence moyenne de passage observée | X jours | moyenne : X j | SOLIDATA (intervalle réel entre collectes, P-TER-01) |
| Densité de maillage | X CAV/km² · 1 CAV pour X hab | rang N/71 | P-TER-02 (superficie open data) |
| Taux de service (collecté vs planifié) | X % | moyenne : X % | extension `service-cav` par commune (P-TER-07) |

Note de méthode : « La fréquence de passage est mesurée sur les collectes réellement effectuées au cours des 12 derniers mois, pas sur un planning théorique. »

### 4.3 Bloc « Population et caractéristiques »

| Indicateur | Valeur | Source | Millésime |
|---|---|---|---|
| Population municipale | XX XXX hab | geo.api.gouv.fr / INSEE | à tracer (P-TER-04) |
| Superficie | X km² | geo.api.gouv.fr / INSEE Dossier complet | phase 2 |
| Densité de population | X hab/km² | dérivé | phase 2 |
| Logements (total / résidences principales) | N / N | INSEE Dossier complet | phase 2 |
| Résidences sociales / séniors / jeunes / étudiantes | N / N / N / N | portail MRN | phase 2 |
| Équipements culturels recensés | N | portail MRN | phase 2 |

Note de méthode : « Ces indicateurs proviennent de l'open data de l'INSEE et de la Métropole Rouen Normandie, pas de SOLIDATA — ils qualifient le territoire, ils ne mesurent pas notre activité. »

### 4.4 Bloc « Avantages de la collecte textile »

| Indicateur | Valeur | Comparaison | Source |
|---|---|---|---|
| Tonnage collecté (12 derniers mois) | X t | — | SOLIDATA |
| Captation (kg/hab/an) | X kg/hab | objectif référence : X kg (national 2024 : 4,2 kg/hab — Refashion, cf. §5) | SOLIDATA + P-TER-04 |
| CO2 évité (mix observé ou forfaitaire, à préciser) | X t CO2e | — | `metropole.js:40-67` (mix + facteurs ADEME) |
| Coût de traitement des ordures ménagères évité (**estimation**) | X € | — | P-TER-05, `settings`, jamais en dur |
| Équivalent ETP d'insertion imputé (**estimation conventionnelle**) | X ETP | — | P-TER-06, avec réserve de méthode obligatoire |

Note de méthode affichée en gras : « Le coût évité et l'équivalent ETP sont des ESTIMATIONS construites à partir d'hypothèses paramétrables (coût de traitement au tonnage, répartition au prorata du tonnage collecté) — ce ne sont pas des montants ou des emplois directement mesurés sur la commune. »

### 4.5 Bloc « Comparaison avec la Métropole »

Petit graphique en barres (ou jauge) : la commune vs la moyenne Métropole vs la médiane, sur 2-3 indicateurs clés (kg/hab/an, taux de service, densité de maillage). Rang affiché seulement si `nb_cav >= seuil paramétrable` (P-TER-03), sinon mention « échantillon trop réduit pour être classé ».

### 4.6 Règles de segmentation (paramétrables, settings `metropole.segmentation_seuils`)

Proposition de règles explicites, à valider et calibrer avec le client sur les 71 communes réelles avant mise en production (aucun seuil ne doit rester arbitraire sans revue) :

| Segment | Condition (exemple de calibrage initial) |
|---|---|
| **Échantillon insuffisant** | `nb_cav < seuil_min_cav` (défaut proposé : 3) — prioritaire sur tous les autres tests |
| **Bien maillée** | `kg_par_hab >= objectif_captation` **et** `taux_service >= seuil_service_haut` (défaut proposé : 90 %) |
| **Sous-équipée** | `densite_maillage < moyenne_metropole * ratio_sous_equipe` (défaut proposé : 0,7) **et** `kg_par_hab < objectif_captation` |
| **À fort potentiel** | `densite_maillage >= moyenne_metropole` **et** `kg_par_hab < objectif_captation` (le maillage existe, la captation n'y répond pas encore) |
| **Standard** | tout le reste (aucune des conditions ci-dessus) |

Chaque seuil est un setting nommé, jamais une constante en dur dans le code (même doctrine que `metropole.cout_traitement_om_eur_t`, §3 P-TER-05).

### 4.7 Canaux de restitution

- **Écran** : `ReportingMetropole.jsx` enrichi d'un sélecteur de commune (le `communeFilter` existe déjà pour filtrer la carte des CAV, `ReportingMetropole.jsx:17, 173-176` — il ne pilote aujourd'hui qu'un filtrage de liste, pas l'affichage d'une fiche dédiée) ; la fiche s'affiche en panneau ou en page dédiée `/reporting-metropole/commune/:code_insee`.
- **Export PDF A4** : nouvelle fonction `printFicheCommune(codeInsee)`, calquée sur `printReview()` (`ReportingMetropole.jsx:99-142`, même charte teal `#0D9488`, même mécanisme fenêtre d'impression).
- **Export CSV** : soit une commune, soit les 71 en une fois — extension du pattern `exportCaptationCsv()` (`ReportingMetropole.jsx:85-94`).
- **API publique** : `GET /api/public/communes/:code_insee/fiche`, scope `commune:<code_insee>` ou `commune:all` pour un usage Métropole complet — P-TER-09.
- **Rôle AUTORITE** : accès à l'écran et aux exports depuis la section « Audit & conformité » (`Layout.jsx:245-258`), pas de nouvelle page à ajouter au menu si la fiche est intégrée à `/reporting-metropole` existant.

---

## 5. Points de vigilance

1. **Écart de population non expliqué dans le cadrage du chantier.** Le brief de cette mission mentionne « 71 communes, ~700 000 hab » ; une recherche web du 06/09/2026 (INSEE Flash Normandie n°127, Dossier complet EPCI 200023414) donne **494 299 habitants** pour la Métropole Rouen Normandie au millésime 2026. L'écart (~200 000 hab) est trop important pour être une simple imprécision de millésime — à vérifier en phase 2 avant tout calcul de kg/hab affiché à un élu : soit le chiffre de 700 000 provient d'un périmètre plus large (aire urbaine, bassin de vie), soit il est simplement obsolète dans la documentation projet. **Ne pas publier de kg/hab tant que ce point n'est pas tranché.**
2. **Millésime jamais tracé aujourd'hui** (P-TER-04) — c'est le point de vigilance le plus structurel : sans lui, un kg/hab affiché à un élu ne peut pas être défendu si sa commune conteste le chiffre de population.
3. **Périmètre EPCI 200023414 vs communes hors Métropole.** Depuis le lot 10 (2026-08), `referentiel_communes` couvre aussi des EPCI limitrophes (Eure 27 / Seine-Maritime 76) — `communes.js:10-21`. Toute nouvelle agrégation territoriale doit répéter le filtre déjà posé dans `captation-par-commune` (`metropole.js:429` : `rc.code_insee IS NULL OR rc.epci_code IS NULL OR rc.epci_code = '200023414'`), sous peine de faire apparaître une commune hors Métropole dans une fiche présentée comme « Métropole Rouen Normandie ».
4. **Prorata CAV, pas mesure directe.** Le tonnage par commune reste une répartition au prorata des CAV collectés dans chaque tournée (`distributeTonnageProrata`, `metropole.js:380-439`) — juste et documenté, mais ce n'est pas une pesée par commune. La fiche doit le dire explicitement (§4.2 note de méthode), en particulier si une commune conteste un chiffre voisin d'une commune limitrophe desservie par la même tournée.
5. **Comparabilité dans le temps.** L'objectif de captation Refashion est codé en dur à `3.6` kg/hab/an (`metropole.js:143`) alors que la moyenne nationale réelle est de **3,9 kg/hab en 2023 et 4,2 kg/hab en 2024** (Refashion, recherche web du 06/09/2026) — la valeur affichée est donc **en retard sur la référence nationale actuelle**. À rendre paramétrable (`settings`) avant de l'utiliser comme seuil de segmentation (P-TER-07), sous peine de classer « bien maillées » des communes qui seraient en réalité sous la moyenne nationale actuelle.
6. **Licence des jeux du portail MRN.** La licence Ouverte / Etalab v2.0 est confirmée pour 2 jeux seulement (`donmetdec_pav`, `reseau-de-decheteries-…`) par lecture indirecte de data.gouv.fr ; elle est supposée (non vérifiée par lecture directe) pour le reste du catalogue, dont `cadastre-communes-…`. À confirmer via `metas.default.license` avant toute republication externe des contours ou des données croisées (§6, requête curl catalogue).
7. **`refashion_dpav` — bug bloquant pour toute ouverture externe.** `public-api.js:105-106` interroge `year`/`trimester`, la table a `annee`/`trimestre` (`init-db.js:1121-1122`) → 500 systématique dès qu'un appelant filtre. Ce point est cité au §3 (P-TER-09) et rappelé ici parce qu'il **bloque toute promesse d'API territoriale tant qu'il n'est pas corrigé**, indépendamment du reste du chantier fiche commune.
8. **RGPD / non-nominatif.** Le bloc « avantages » (ETP, insertion) doit rester agrégé — aucune fiche commune ne doit permettre de remonter à un salarié ou un candidat, même par recoupement (une commune à très faible effectif combinée à un ETP décimal pourrait, en théorie, être un indice — appliquer le même principe de seuil que le module Enquêtes, `n ≥ 5`, si jamais une déclinaison par commune de données RH plus fines était envisagée).
9. **Poids des contours GeoJSON.** La documentation de l'API Découpage administratif prévient explicitement que `geometry=contour` produit des réponses nettement plus lourdes — prévoir un cache serveur ou une simplification de tracé avant d'afficher les 71 polygones sur une carte Leaflet consultée en direct par plusieurs élus.

---

## 6. Questions à trancher et vérifications API de phase 2

### Questions à trancher (avec le client / la Métropole)

1. Le chiffre « ~700 000 hab » du cadrage correspond-il à un périmètre différent de l'EPCI 200023414 (aire urbaine, bassin de vie) ? À clarifier avant toute publication de kg/hab.
2. Quel coût de traitement OM la Métropole peut-elle communiquer officiellement (RPQS) pour remplacer l'estimation régionale de démarrage (~353 €/t) ?
3. L'indicateur « équivalent ETP imputé par commune » (P-TER-06) est-il acceptable politiquement, ou faut-il le retirer de la fiche commune et le laisser au seul niveau Métropole ?
4. Quels seuils de segmentation (P-TER-07, §4.6) le client valide-t-il après un premier calcul sur les 71 communes réelles ?
5. Le scope territorial de l'API publique (P-TER-09) doit-il être limité à une commune par clé, ou une clé unique pour l'ensemble de l'EPCI suffit-elle pour l'usage envisagé par la Métropole ?
6. Faut-il stocker les contours communaux en base (table PostGIS `commune_contour`) ou les requêter à la volée avec cache applicatif ?

### Vérifications API de phase 2 (à exécuter depuis un hôte non filtré, ex. serveur de production)

```bash
# 1. Millésime et champs population — l'appel actuel de communes.js ne demande que
#    nom,code,codesPostaux,population : vérifier si un champ de millésime existe.
curl -s "https://geo.api.gouv.fr/communes/76540?fields=nom,code,population,surface,codesPostaux" | jq .

# 2. Contour GeoJSON d'une commune — poids de la réponse et présence du code INSEE
curl -s "https://geo.api.gouv.fr/communes/76540?format=geojson&geometry=contour" -o /tmp/rouen-contour.geojson
wc -c /tmp/rouen-contour.geojson

# 3. Toutes les communes de l'EPCI avec surface (vérifier le nom exact du champ)
curl -s "https://geo.api.gouv.fr/epcis/200023414/communes?fields=nom,code,population,surface,codesPostaux&format=json" | jq 'length, .[0]'

# 4. Contours de toutes les communes de l'EPCI en une fois (poids total, faisabilité du stockage)
curl -s "https://geo.api.gouv.fr/epcis/200023414/communes?format=geojson&geometry=contour" -o /tmp/mrn-contours.geojson
wc -c /tmp/mrn-contours.geojson

# 5. Licence et fraîcheur du jeu cadastre-communes du portail MRN (alternative aux contours geo.api.gouv.fr)
BASE=https://data.metropole-rouen-normandie.fr/api/explore/v2.1
curl -s "$BASE/catalog/datasets/cadastre-communes-metropole-rouen-normandie-sage-cailly-aubette-robec" \
  | jq '{fields:[.fields[]|{name,type,label}], metas:.metas.default}'

# 6. Résidences (sociales/séniors/jeunes/étudiantes) — schéma exact (champ commune, code INSEE présent ?)
for ds in residences-sociales-metropole-rouen-normandie residences-seniors-metropole-rouen-normandie \
          residences-jeunes-metropole-rouen-normandie residences-etudiants-metropole-rouen-normandie \
          salles-et-equipements-culturels; do
  echo "== $ds"; curl -s "$BASE/catalog/datasets/$ds" | jq '.fields[] | {name,type,label}'
done

# 7. INSEE — Dossier complet commune (nécessite une clé api.insee.fr en production)
curl -s -H "Authorization: Bearer $INSEE_TOKEN" \
  "https://api.insee.fr/donnees-locales/V0.1/donnees/geo-2026@GEO2026/COM-76540" | jq .

# 8. Reproduire le bug year/annee (à faire tomber AVANT toute ouverture externe de public-api.js)
curl -s "https://solidata.online/api/public/refashion/dpav?year=2026&trimester=2" -H "X-API-Key: <clé test>" | jq .
```

---

## Résumé (10 lignes)

La seule route SOLIDATA déjà à granularité communale est `GET /metropole/captation-par-commune` (`metropole.js:388-439`), adossée à `referentiel_communes` (`init-db.js:1888-1899`) alimenté depuis `geo.api.gouv.fr` (`communes.js:114-127`). La « fiche commune » proposée (9 agrégations, P-TER-01 à P-TER-09) est réalisable à 100 % SOLIDATA pour son cœur (capacité, rang, comparaison Métropole, coût évité paramétré) ; l'open data (INSEE, geo.api.gouv.fr avec `geometry=contour`, portail MRN résidences/équipements) apporte le contexte territorial et les contours pour une carte choroplèthe, absente aujourd'hui (aucun composant `GeoJSON` Leaflet). Deux manques structurels sont identifiés : `referentiel_communes` n'a **aucun horodatage** de rafraîchissement ni de millésime de population (P-TER-04), et le « coût de traitement OM » n'existe nulle part dans l'ERP — il est proposé en `settings` paramétrable avec cascade honnête (pattern `resolveCA()` d'`energie.js:616-625`), jamais en dur, faute d'avoir trouvé le chiffre officiel de la Métropole (repli régional ~353 €/t, à confirmer). Un vrai bug bloquant est confirmé : `public-api.js:105-106` filtre `year`/`trimester` sur une table qui a `annee`/`trimestre` (`init-db.js:1121-1122`) → 500 garanti, à corriger avant toute ouverture d'API à la Métropole. Point de vigilance majeur non résolu : l'écart entre le « ~700 000 hab » du cadrage et les 494 299 hab trouvés par recherche web (INSEE, millésime 2026) — à trancher avant de publier le moindre kg/hab à un élu. Les seuils de segmentation (bien maillée / sous-équipée / à fort potentiel) sont proposés en `settings`, calibrables, jamais figés en dur. Livrable complet : `rapports/open-data-metropole-2026-09-06/05-territoire-fiche-commune.md`.

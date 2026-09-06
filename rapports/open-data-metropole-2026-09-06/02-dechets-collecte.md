# Open data Métropole Rouen Normandie — Volet Déchets & Collecte textile

> Agent thématique « DÉCHETS & COLLECTE TEXTILE » — chantier de cadrage SOLIDATA, 6 septembre 2026.
> Sources : `inventaire-catalogue.md` (indexation web, portail bloqué par le proxy réseau de cette session — voir légende de certitude ci-dessous), `cartographie-solidata.md` (lecture de code), lecture directe du dépôt `/home/user/solidata.online`, 3 recherches web complémentaires (SINOE, Refashion, cartographie textile Lyon).
> Légende de certitude reprise de l'inventaire : **V** = vérifié (URL du portail ou de data.gouv.fr vue dans un résultat indexé), **S** = signalé (mention indirecte), **?** = supposé/non vu. Tout ce qui porte sur le code SOLIDATA a été lu directement (fichier:ligne cité) et n'est pas requalifié.

---

## 1. Périmètre et enjeu métier

Solidarité Textiles exploite 209 bornes CAV sur (une partie du) territoire de la Métropole Rouen Normandie (71 communes, ~700 000 hab.) et rend compte chaque année à la collectivité et à Refashion d'un tonnage textile collecté, d'un taux de captation (objectif national 3,6 kg/hab/an, codé en dur dans `metropole.js:143`) et d'un CO2 évité. Deux angles morts structurels aujourd'hui : (1) le taux de captation par commune (`GET /metropole/captation-par-commune`, vérifié) ne rapporte le tonnage SOLIDATA qu'à la **population** de la commune — il ignore le nombre réel de PAV textile disponibles sur cette commune (SOLIDATA + concurrents/partenaires ESS) et ne peut donc pas dire si un mauvais chiffre vient d'un maillage insuffisant, d'une borne mal placée, ou d'un opérateur tiers plus présent ; (2) le rattachement borne→commune reste soit manuel (`PATCH /communes/cav/:cavId`), soit un texte libre fragile côté Refashion (`refashion.js:406`, `cav.commune ILIKE rc.commune`) — sans jointure géographique fiable avec un référentiel externe. L'open data de la Métropole (jeu PAV `donmetdec_pav`, tonnages `quantite-de-dechets`, contours `cadastre-communes`) et les sources nationales (SINOE/ADEME, Refashion) permettent de fiabiliser ce rattachement, de mesurer la part de marché réelle de SOLIDATA par commune plutôt qu'un ratio brut kg/hab, et de construire pour chaque élu une fiche commune qui distingue explicitement ce qui est mesuré, ce qui est déclaratif, et ce qui reste inconnu.

---

## 2. Jeux de données retenus

| Identifiant | Certitude | Granularité | Fraîcheur connue | Clé de jointure vers SOLIDATA | Usage |
|---|---|---|---|---|---|
| `donmetdec_pav` (MRN) | **V** (jeu vu sur le portail ET sur data.gouv.fr, LO 2.0, CSV 670 Ko/JSON 1,2 Mo) | Point géolocalisé, champ de flux incluant **textile** (nom de champ exact **non lu**, cf. §6) | data.gouv.fr : MAJ **14/06/2026** | Coordonnées (lat/lon) → rapprochement spatial avec `cav.latitude/longitude` ; commune du point → `referentiel_communes.code_insee` (via reverse-géocodage ou jointure spatiale avec `cadastre-communes`) | P-DEC-01, 02, 03, 04, 05, 09 |
| `reseau-de-decheteries-metropole-rouen-normandie` | **V** (data.gouv.fr, LO 2.0, CSV 3,4 Ko ≈ 15-20 lignes) | Point géolocalisé | MAJ **07/03/2023** (donnée figée depuis 3 ans, à surveiller) | Coordonnées → distance à chaque `cav` | P-DEC-06, 08 |
| `quantite-de-dechets` (MRN) | **V** (jeu vu, description confirmant tonnages par année et par type de déchet et par mode de collecte : PAP/AV/déchèterie) | Année × type de déchet, périmètre **EPCI entier** (pas de granularité commune confirmée) | Fraîcheur inconnue (champ non lu) | Année (jointure temporelle avec `tonnage_history`/`tours`) ; **pas de code INSEE confirmé** dans ce jeu — granularité commune à vérifier en phase 2 | P-DEC-06, 09 |
| `cadastre-communes-metropole-rouen-normandie-sage-cailly-aubette-robec` | **V** | Polygone par commune | Inconnue | `code_insee` (à confirmer, nom de champ non lu) → jointure directe avec `referentiel_communes.code_insee` | P-DEC-03, 05, 07 |
| SINOE® — « Tonnage DMA par type de déchet » (ADEME, data.ademe.fr) | **S** (jeu confirmé par recherche web ciblée, hors inventaire initial) | **Département**, années impaires depuis 2009 (enquête Collecte biennale) | Millésime pair suivant probablement absent (enquête impaire) | Département (Seine-Maritime 76) — **pas de granularité commune ni EPCI** : sert de borne de cohérence macro, pas de croisement fin | P-DEC-09 |
| Refashion — « Textiles collectés par la filière REP » (data.gouv.fr) | **S** (jeu confirmé, granularité territoriale non lue — a minima régionale d'après un extrait indexé Hauts-de-France) | Territoire non confirmé (région ? EPCI ?) | Inconnue | À déterminer selon le niveau réel (région/EPCI/point de collecte) | P-DEC-09 |
| Cartographie « points de collecte textile » type Métropole de Lyon (data.gouv.fr) | **?** (un jeu homonyme existe pour Lyon ; **aucun équivalent MRN vu** dans l'inventaire — Rouen semble utiliser `donmetdec_pav` multi-flux plutôt qu'un jeu textile dédié) | Point | — | — | Sert de référence de faisabilité : un jeu « points de collecte textile » dédié existe ailleurs, donc le champ « flux = textile » de `donmetdec_pav` est un pattern plausible et déjà éprouvé sur d'autres métropoles |
| `referentiel_communes` + `cav` (SOLIDATA, déjà en base) | **V** (code lu, `init-db.js:1888-1899`, `:523-541`) | Commune / borne | Population : millésime non tracé (`cartographie-solidata.md` §9) | Table pivot de tout le chantier | Toutes les propositions |
| `vw_dpav_communes` / `refashion_communes` (SOLIDATA, déjà en base) | **V** (`init-db.js:2181-2203`, `:1140-1149`) | Commune × trimestre | — | `code_insee` (vue) ou texte libre `commune` (table historique) | P-DEC-04, 09 |

---

## 3. Propositions d'agrégations

### P-DEC-01 — Rapprochement géographique du parc de bornes SOLIDATA avec le référentiel PAV textile de la Métropole
**Indicateur produit** : liste des écarts entre les deux parcs — bornes du jeu `donmetdec_pav` (flux textile) **absentes** de la table `cav` à moins de N mètres, et bornes `cav` **absentes** du jeu MRN à moins de N mètres.
**Formule / méthode** : export GeoJSON de `donmetdec_pav` filtré sur le champ de flux = textile ; pour chaque point, calcul de la distance Haversine au `cav` actif le plus proche (réutiliser `TourService.haversineDistance`, déjà écrit et testé, `services/TourService.js`) ; seuil de rapprochement à calibrer (proposition initiale 30 m, cohérent avec le rayon de rattachement GPS déjà utilisé pour les arrêts, `collecte.arret_rayon_m` 40 m) ; script one-shot en dry-run par défaut (doctrine du projet), jamais d'écriture automatique dans `cav`.
**Sources croisées** : `donmetdec_pav` (flux textile) × table `cav` (`latitude`, `longitude`, `status`).
**Granularité** : borne.
**Consommateur et écran cible** : exploitation (équipe collecte) — nouvel onglet ou export dans `AdminCAV.jsx` (« Écart avec le référentiel Métropole ») ; direction pour argumenter une extension de parc auprès des élus.
**Prérequis de vérification en phase 2** : nom exact du champ de flux et de ses valeurs possibles (`curl` §6-3) ; présence ou non d'un champ gestionnaire/exploitant sur ce jeu (condition de P-DEC-02) ; volumétrie réelle du jeu filtré textile (le CSV global fait 670 Ko tous flux confondus — la part textile n'est pas connue).
**Effort** : M (script de rapprochement + export/UI de revue, pas d'automatisation d'écriture).
**Valeur** : 4.
**Risques et cas « donnée absente »** : si le champ flux ne distingue pas le textile de façon exploitable (valeur libre, incohérente), le rapprochement doit être **abandonné et dit comme tel** plutôt que de deviner un flux à partir du nom du point ; si le jeu MRN ne géolocalise que le PAV « historique de la régie » (OM/recyclables/verre) et que le textile y est incomplet par construction (opérateurs privés/ESS non tenus de déclarer à la Métropole), le résultat doit afficher un bandeau explicite « couverture du jeu Métropole inconnue pour le textile » — ne jamais présenter les CAV « en trop » comme un signal de doublon sans cette réserve.

### P-DEC-02 — Cartographie des autres opérateurs de collecte textile sur le territoire
**Indicateur produit** : carte de couverture territoriale multi-opérateurs (nombre de PAV textile par commune, ventilé SOLIDATA / autres, si un champ gestionnaire existe).
**Formule / méthode** : agrégation par commune du jeu `donmetdec_pav` (flux textile) groupé par un éventuel champ `gestionnaire`/`exploitant`/`operateur`, comparé au nombre de `cav` SOLIDATA rattachées à la même commune (`cav.code_insee_commune`).
**Sources croisées** : `donmetdec_pav` (champ gestionnaire, existence à confirmer) × `cav` (comptage par `code_insee_commune`).
**Granularité** : commune.
**Consommateur et écran cible** : direction / élus — section « Réseau territorial » de `ReportingMetropole.jsx`, ou nouvelle fiche commune (§4).
**Prérequis de vérification en phase 2** : existence et remplissage réel d'un champ gestionnaire dans le schéma (`curl` §6-3) ; sans ce champ, cette proposition **tombe** (aucune donnée à agréger) et doit être retirée de la roadmap plutôt que contournée par une hypothèse.
**Effort** : S si le champ existe et est propre (simple GROUP BY), sinon **non faisable** en l'état.
**Valeur** : 5 (c'est l'angle mort le plus souvent reproché par les auditeurs — cf. audit Métropole 2026-05-10 : « pas de décomposition par filière ») si le champ existe ; 0 sinon.
**Risques et cas « donnée absente »** : le champ gestionnaire, s'il existe, ne couvre presque certainement que les PAV que la Métropole recense — les bornes d'associations en local privé ou en magasin (boîtes à dons, ressourceries) ne sont probablement pas dans ce jeu SIG. Le KPI doit systématiquement s'afficher avec une mention « réseau recensé par la Métropole (voirie publique), hors points en local privé » — jamais présenté comme le réseau textile complet du territoire.

### P-DEC-03 — Rattachement automatique et fiable des bornes à leur commune
**Indicateur produit** : taux de rattachement `cav.code_insee_commune` renseigné automatiquement (vs le rattachement manuel actuel, `PATCH /communes/cav/:cavId`, `communes.js:389-403`).
**Formule / méthode** : jointure spatiale point-dans-polygone entre `cav.geom` (déjà en `GEOMETRY(Point, 4326)`, index GiST existant, `init-db.js:530,543`) et les polygones communaux de `cadastre-communes-metropole-rouen-normandie-sage-cailly-aubette-robec` importés dans une table `communes_geom(code_insee, geom)` ; PostGIS déjà utilisé par le projet (`ST_Within`/`ST_Contains`). Remplace aussi le join texte fragile `refashion.js:406` (`cav.commune ILIKE rc.commune`, sensible aux accents/casse/variantes).
**Sources croisées** : `cadastre-communes-…` (polygones) × `cav.geom`.
**Granularité** : borne.
**Consommateur et écran cible** : fondation technique invisible pour l'utilisateur, mais condition de fiabilité de `GET /metropole/captation-par-commune` et de `vw_dpav_communes` ; à exposer comme un bouton « Recalculer les rattachements » dans `AdminCommunes.jsx`.
**Prérequis de vérification en phase 2** : nom du champ code INSEE dans le GeoJSON du cadastre (`curl` §6-5) ; qualité de la géométrie (multi-polygones valides) ; vérifier que la projection est bien WGS84 (EPSG:4326) comme `cav.geom`, sinon reprojection nécessaire.
**Effort** : M (import GeoJSON + table + requête spatiale + bouton admin ; pas de nouveau routeur).
**Valeur** : 4 (fiabilise silencieusement 3 KPI existants : captation par commune, DPAV par commune, densité de bornes).
**Risques et cas « donnée absente »** : un CAV hors du polygone de toute commune importée (erreur de géolocalisation historique, ou hors du périmètre couvert par le fichier cadastre) doit rester `code_insee_commune = NULL` — jamais rattaché « au plus proche » sans le dire ; le rattachement manuel existant (`PATCH`) reste la voie de correction, jamais écrasé silencieusement par le recalcul automatique (un recalcul ne doit pas écraser un rattachement posé à la main sans confirmation explicite).

### P-DEC-04 — Taux de captation par commune enrichi de la part de marché SOLIDATA
**Indicateur produit** : à côté du kg/hab déjà calculé (`captation-par-commune`), un second indicateur « part du réseau PAV textile de la commune exploitée par SOLIDATA » (nb `cav` SOLIDATA / nb PAV textile total de la commune selon `donmetdec_pav`).
**Formule / méthode** : `part_reseau_pct = nb_cav_solidata_commune / NULLIF(nb_pav_textile_total_commune, 0) * 100`, calculée en aval de P-DEC-01/02/03 (dépend du rapprochement et, pour le détail par opérateur, du champ gestionnaire).
**Sources croisées** : `GET /metropole/captation-par-commune` (existant, `metropole.js:388-439`) × comptage `donmetdec_pav` par commune.
**Granularité** : commune × année.
**Consommateur et écran cible** : élus / direction — colonne supplémentaire dans le tableau « Captation par commune » de `ReportingMetropole.jsx:378-450`, et dans l'export CSV existant (`exportCaptationCsv`).
**Prérequis de vérification en phase 2** : dépend entièrement de P-DEC-01 (rapprochement) et idéalement de P-DEC-02 (répartition par opérateur) ; sans eux, l'indicateur se réduit à « nb PAV textile total commune » (déjà utile en soi, sans comparaison SOLIDATA/autres).
**Effort** : S une fois P-DEC-01 livré (simple jointure supplémentaire dans la requête existante).
**Valeur** : 5 (répond directement au grief de l'audit Métropole : « pas de décomposition par filière », en distinguant enfin le mérite propre de SOLIDATA du potentiel du territoire).
**Risques et cas « donnée absente »** : commune sans aucun PAV recensé dans `donmetdec_pav` → `part_reseau_pct = NULL` affiché comme « réseau Métropole non recensé pour cette commune », jamais 0 % ni 100 % par défaut.

### P-DEC-05 — Densité de bornes par habitant et par km²
**Indicateur produit** : nb de PAV textile (SOLIDATA + réseau Métropole si disponible) pour 1 000 habitants et par km², par commune.
**Formule / méthode** : `densite_hab = nb_pav_textile_commune / (population_insee / 1000)` ; `densite_km2 = nb_pav_textile_commune / surface_commune_km2` (surface tirée du polygone `cadastre-communes` via `ST_Area` reprojeté en Lambert-93, ou d'un champ surface déjà présent dans le GeoJSON si disponible).
**Sources croisées** : `referentiel_communes.population_insee` × comptage PAV (P-DEC-01) × `cadastre-communes` (surface).
**Granularité** : commune.
**Consommateur et écran cible** : direction — argumentaire d'implantation, section « Maillage territorial » à créer dans `ReportingMetropole.jsx` ou la future fiche commune (§4).
**Prérequis de vérification en phase 2** : présence d'un champ surface exploitable dans le cadastre, ou calcul `ST_Area` à valider sur un échantillon (`curl` §6-5) ; dépend de P-DEC-01 pour le comptage PAV.
**Effort** : M.
**Valeur** : 3 (utile en argumentaire d'extension de parc, mais n'explique pas à lui seul le volume collecté sans P-DEC-06/07).
**Risques et cas « donnée absente »** : communes à très faible population (extension rurale de l'EPCI) où un seul PAV fausse fortement le ratio pour 1 000 hab — afficher la valeur brute (nb PAV, population) à côté du ratio pour que le lecteur juge lui-même, jamais le seul ratio isolé.

### P-DEC-06 — Part du textile dans les déchets ménagers et assimilés (DMA) par commune/EPCI
**Indicateur produit** : tonnage textile SOLIDATA rapporté au tonnage total de DMA de l'EPCI, et comparaison à la moyenne départementale SINOE (Seine-Maritime) comme borne de cohérence.
**Formule / méthode** : `part_textile_pct = tonnage_textile_solidata_annee / tonnage_dma_total_epci_annee * 100`, avec `tonnage_dma_total_epci_annee` lu dans `quantite-de-dechets` (si la ventilation par type de déchet inclut un poste textile ou assimilé « encombrants/textiles ») ; à défaut, comparaison indirecte au ratio national/départemental SINOE (`data.ademe.fr` — « Tonnage DMA par type de déchet », granularité **département**, années impaires) comme repère macro, jamais comme chiffre territorial fin.
**Sources croisées** : `tonnage_history`/`tours` (SOLIDATA) × `quantite-de-dechets` (MRN, EPCI) × SINOE (département, repère).
**Granularité** : EPCI × année (le jeu MRN ne descend a priori pas à la commune, cf. §2) ; SINOE au département.
**Consommateur et écran cible** : direction / Refashion — nouveau bloc « Part du textile dans les DMA » dans `metropole.js:GET /dashboard` et `ReportingMetropole.jsx`.
**Prérequis de vérification en phase 2** : le jeu `quantite-de-dechets` distingue-t-il un poste textile (probable qu'il soit noyé dans « encombrants » ou absent, la collecte textile relevant très majoritairement d'opérateurs hors régie) — question centrale identifiée dans l'inventaire (§4.1) ; nom exact des champs type/année (`curl` §6-4).
**Effort** : M (si le champ existe) à **non faisable proprement** (si le textile est absent du jeu, auquel cas se limiter au repère SINOE départemental, explicitement qualifié de macro).
**Valeur** : 3 (utile pour resituer l'activité SOLIDATA dans le paysage déchets global de la Métropole, mais fragile si le jeu MRN ne isole pas le textile).
**Risques et cas « donnée absente »** : si le poste textile n'existe pas séparément dans `quantite-de-dechets`, ne **jamais** l'estimer par déduction (ex. soustraction d'un total) — afficher « non disponible dans les données Métropole publiées » et se limiter au repère SINOE département, marqué comme tel.

### P-DEC-07 — Maillage : distance moyenne habitant → borne la plus proche
**Indicateur produit** : distance moyenne (et médiane) entre le bâti résidentiel d'une commune et la borne CAV textile la plus proche (SOLIDATA + réseau Métropole si P-DEC-01/02 disponibles).
**Formule / méthode** : pour chaque bâtiment du jeu `cadastre-batiments-metropole-rouen-normandie-sage-cailly-aubette-robec` (centroïde), distance Haversine (ou `ST_Distance` en Lambert-93) au CAV le plus proche ; moyenne/médiane par commune. Alternative moins coûteuse si le jeu bâtiments s'avère trop volumineux pour un calcul en base : grille régulière de points (ex. 100 m) sur le polygone communal plutôt que chaque bâtiment.
**Sources croisées** : `cadastre-batiments-…` (bâti) × `cav.geom` (+ `donmetdec_pav` si P-DEC-01 livré).
**Granularité** : commune.
**Consommateur et écran cible** : direction — argumentaire d'implantation, même écran que P-DEC-05.
**Prérequis de vérification en phase 2** : volumétrie du jeu `cadastre-batiments` (peut être très lourd à l'échelle de 71 communes) — à tester avant de committer l'effort ; présence d'un attribut distinguant bâti résidentiel des autres usages (le champ « constructions en dur » du cadastre DGFiP ne filtre a priori pas par usage).
**Effort** : L (calcul géospatial lourd, à faire hors ligne / en job planifié plutôt qu'à la demande).
**Valeur** : 3 (argumentaire fort pour les élus mais coût de mise en œuvre élevé pour un ROI incertain — à ne lancer qu'après P-DEC-01/03).
**Risques et cas « donnée absente »** : si le jeu bâtiments est trop imprécis ou absent en pratique (comme signalé « non trouvé » pour les orthophotos dans l'inventaire, le cadastre bâti peut être partiel), dégrader vers un calcul au centroïde de commune (moins précis mais toujours honnête, à qualifier « approximation au centroïde communal, pas une moyenne pondérée par la population réelle »).

### P-DEC-08 — Facteurs contextuels du moteur prédictif de remplissage
**Indicateur produit** : nouveaux facteurs de contexte pour `predictFillRate` (`backend/src/routes/tours/predictions.js:278-570`) — proximité d'une déchèterie, densité de logements collectifs à proximité — en remplacement/complément du proxy actuel `nb_containers >= 3 → ×1.1` (`:386-388`, seul proxy de densité aujourd'hui).
**Formule / méthode** : (a) distance de chaque CAV à la déchèterie la plus proche (`reseau-de-decheteries-…`, Haversine) — hypothèse à tester : un CAV proche d'une déchèterie capte moins (les habitants y déposent le textile en même temps que d'autres apports) ; (b) proximité de résidences sociales/seniors/étudiantes (jeux `residences-sociales-…`, `residences-seniors-…`, vus au §2.6 de l'inventaire) comme proxy de densité de logements collectifs, alternative plus fine que `nb_containers`. Alimentation d'un nouveau facteur dans `ml_fill_predictions.features` (JSONB déjà prévu pour ça, `init-db.js:1182-1193`) avant d'envisager une pondération apprise (même logique que `predictive_weather_factors`).
**Sources croisées** : `cav` × `reseau-de-decheteries-…` × jeux résidences (MRN) × `ml_fill_predictions`.
**Granularité** : borne.
**Consommateur et écran cible** : exploitation — moteur prédictif (`AdminPredictive.jsx`), aucun nouvel écran nécessaire dans un premier temps (facteur silencieux en `features`, exposition à l'écran seulement après validation statistique).
**Prérequis de vérification en phase 2** : volumétrie et fraîcheur du jeu déchèteries (figé depuis 2023, à ne pas traiter comme temps réel) ; les jeux résidences sont-ils rattachables à une commune ou seulement à une adresse libre (besoin de géocodage BAN, déjà disponible via `services/geocodage.js`).
**Effort** : L (nouveau facteur + recueil de données suffisant avant tout apprentissage — même prudence que `predictive_weather_factors`, qui exige 60 intervalles et 30 j/segment avant d'écrire quoi que ce soit).
**Valeur** : 3 (amélioration incrémentale du moteur existant, pas un nouveau KPI visible immédiatement — valeur réelle mais différée).
**Risques et cas « donnée absente »** : ne jamais ajouter un facteur non validé statistiquement au calcul de remplissage en production — le placer d'abord en observation (`features` JSONB) sans impact sur `predicted_fill_rate`, exactement le schéma déjà suivi pour l'apprentissage météo (`recalcWeatherFactors`, seuils minimaux avant écriture).

### P-DEC-09 — Réconciliation officielle SOLIDATA / Métropole / SINOE / Refashion
**Indicateur produit** : tableau de rapprochement trimestriel des quatre sources de tonnage textile disponibles (SOLIDATA `tonnage_history`/DPAV, `quantite-de-dechets` MRN si le textile y figure, SINOE département, Refashion national/régional) avec écart chiffré et motif quand les périmètres diffèrent.
**Formule / méthode** : présentation côte à côte, sans recalcul ni lissage — l'objectif est la **transparence de l'écart**, pas sa disparition (périmètres différents : SOLIDATA ne couvre qu'une partie du réseau PAV du territoire, cf. P-DEC-02 ; Refashion agrège potentiellement au-delà de l'EPCI ; SINOE est au département).
**Sources croisées** : `vw_dpav_communes`/`refashion_dpav` (SOLIDATA) × `quantite-de-dechets` (MRN) × SINOE (ADEME, département) × Refashion « textiles collectés par la filière REP » (data.gouv.fr).
**Granularité** : la plus grossière des quatre impose le niveau de comparaison réel (probablement EPCI ou département, pas la commune).
**Consommateur et écran cible** : Refashion / direction — nouvel onglet « Réconciliation des sources » dans `AdminPredictive.jsx` ou un export dédié dans `/admin/refashion-exports` (page déjà existante pour les exports d'audit DPAV, module 23bis/Refashion).
**Prérequis de vérification en phase 2** : granularité réelle du jeu Refashion (`curl` §6-6) et de `quantite-de-dechets` ; à défaut de granularité comparable, ce tableau reste à l'échelle du département/région et sert de garde-fou de cohérence macro, pas de preuve fine.
**Effort** : M (assemblage de 4 sources déjà pour la plupart identifiées, aucune n'exige de nouvelle collecte).
**Valeur** : 4 (répond à la demande implicite de tout auditeur externe : « vos chiffres sont-ils cohérents avec les statistiques publiques » — actuellement aucune confrontation n'existe).
**Risques et cas « donnée absente »** : ne jamais calculer un « taux d'écart » unique si les périmètres ne sont pas rigoureusement identiques (couverture géographique, année, mode de collecte inclus/exclus) — chaque ligne du tableau doit porter son périmètre exact en clair, et une case sans source disponible reste vide avec la mention de la source manquante, jamais interpolée.

---

## 4. Contribution à la « fiche commune » des élus

Attributs que ce thème peut apporter à une future fiche commune consolidée (nouvelle page, déjà évoquée comme piste dans `docs/DIAGNOSTIC_UX_SOLIDATA.md:75` — « Synthèse impact » unifiée) :

| Attribut | Définition | Source | Fréquence |
|---|---|---|---|
| Nb de bornes CAV textile SOLIDATA | Bornes actives rattachées à la commune | `cav` (SOLIDATA, déjà en base) | temps réel |
| Nb de PAV textile total (réseau Métropole) | Tous opérateurs recensés par la Métropole | `donmetdec_pav` (filtré flux textile) — **sous réserve P-DEC-01** | fraîcheur du jeu MRN (dernière MAJ connue 14/06/2026 sur le jeu global) |
| Part du réseau exploitée par SOLIDATA | Ratio SOLIDATA / total commune | calcul P-DEC-04 | recalcul à chaque rafraîchissement du jeu MRN |
| Tonnage textile collecté (kg) | Poids réparti par commune, prorata CAV collectés | `GET /metropole/captation-par-commune` (existant, vérifié) | mensuelle/annuelle |
| Kg/hab/an | Tonnage / population | existant (`captation-par-commune`) | idem |
| Population | Population INSEE de la commune | `referentiel_communes.population_insee` (déjà en base, source geo.api.gouv.fr) | **millésime non tracé aujourd'hui** — à corriger en même temps (horodater le champ) |
| Densité de PAV textile /1000 hab et /km² | Maillage | calcul P-DEC-05 | idem que PAV total |
| Distance moyenne habitant→borne | Accessibilité | calcul P-DEC-07 (si livré) | ponctuelle (recalcul coûteux, pas temps réel) |
| Part du textile dans les DMA de l'EPCI | Contexte déchets global | `quantite-de-dechets` (MRN) — **sous réserve** que le textile y figure | annuelle (supposé) |
| CO2 évité attribuable à la commune | Prorata du tonnage × facteurs `metropole.js:40` | calcul existant, à décliner par commune | mensuelle/annuelle |
| Repère national SINOE/Refashion | Contexte de comparaison (jamais un chiffre communal) | SINOE (département), Refashion (national/régional) | biennale (SINOE, années impaires) |

---

## 5. Points de vigilance

- **Qualité/nommage du champ flux de `donmetdec_pav`** : c'est la clé de voûte de 6 des 9 propositions (P-DEC-01/02/03/04/05/09). Tant que le nom exact du champ et ses valeurs ne sont pas lus (portail bloqué depuis cette session), tout le chantier repose sur une hypothèse — à confirmer en priorité absolue avant tout développement (§6-3).
- **Fraîcheur hétérogène** : `donmetdec_pav` global mis à jour le 14/06/2026 (récent) mais les déchèteries datent de 2023 (figées) ; SINOE ne publie que les années impaires (biennal) ; aucune des sources externes ne garantit une mise à jour automatique détectable — tout job d'import doit journaliser sa date de traitement (`job_runs`, pattern déjà en place) et **jamais** présenter une donnée de 2023 comme un chiffre courant sans la dater à l'écran.
- **Licence** : Licence Ouverte / Open Licence v2.0 (Etalab) confirmée pour les 2 jeux déchets déjà vus sur data.gouv.fr — compatible avec un usage interne et une republication agrégée aux élus ; à confirmer pour `cadastre-communes` et `cadastre-batiments` (portails cadastre DGFiP ont parfois des conditions spécifiques, même sous Licence Ouverte).
- **RGPD** : aucun des jeux retenus dans ce thème n'est nominatif (PAV, tonnages, déchèteries, cadastre communal). Le seul risque de contact avec des données personnelles serait un croisement futur avec les jeux résidences (P-DEC-08) ou une future fiche commune mêlant insertion et déchets — dans ce cas, respecter le seuil d'anonymat déjà en usage dans le module Enquêtes (n ≥ 5) et ne jamais publier un chiffre communal en dessous.
- **Doubles comptes** : le tonnage textile réel d'une commune peut être capté par SOLIDATA **et** par un ou plusieurs autres opérateurs (Le Relais, associations locales, autres réseaux) sans qu'aucun total consolidé n'existe. Le tableau de réconciliation (P-DEC-09) et la carte multi-opérateurs (P-DEC-02) doivent explicitement s'abstenir d'additionner un tonnage SOLIDATA à un tonnage « réseau » externe sans preuve qu'ils ne se recouvrent pas partiellement (un même PAV pourrait apparaître dans deux déclarations si la donnée de gestionnaire est imprécise).
- **Périmètre régie vs opérateurs privés pour le textile** : contrairement aux OM/recyclables/verre qui relèvent typiquement de la régie ou d'un prestataire unique mandaté par la Métropole, la collecte textile est structurellement éclatée entre plusieurs opérateurs conventionnés Refashion, très majoritairement issus de l'ESS. Le jeu `donmetdec_pav`, alimenté par les services de la Métropole, **peut ne recenser que les emplacements sur le domaine public** et ignorer les points en local privé, en magasin ou en association — un « écart » détecté par P-DEC-01 ne doit jamais être interprété comme un doublon ou une anomalie sans cette réserve explicite à l'écran.
- **`quantite-de-dechets` et le textile** : le doute noté dans l'inventaire (§4.1, « pour SOLIDATA c'est LA question clé ») doit être tranché avant de construire quoi que ce soit sur P-DEC-06 — le textile, largement hors régie, est probablement absent ou très partiel dans un jeu alimenté par les circuits classiques de collecte des déchets ménagers.
- **Bug à corriger avant toute ouverture d'API à la Métropole** : `GET /api/public/refashion/dpav` (`public-api.js:100-107`) interroge les colonnes `year`/`trimester`, qui n'existent pas sur `refashion_dpav` (colonnes réelles `annee`/`trimestre`, vérifié `init-db.js:1120-1136`) — provoque un 42703 non rattrapé dès qu'un filtre est passé. À corriger avant tout usage de cette API dans le cadre du présent chantier (elle serait un canal naturel pour republier vers la Métropole ou Refashion).

---

## 6. Questions à trancher et vérifications API de phase 2

**Questions à trancher (arbitrage métier avant développement)** :
1. Le champ flux de `donmetdec_pav` permet-il d'isoler fiablement le textile, et existe-t-il un champ gestionnaire/exploitant exploitable pour P-DEC-02/04 ? (bloquant pour 6 des 9 propositions)
2. `quantite-de-dechets` inclut-il un poste textile identifiable, à quelle granularité (EPCI seul, ou commune) ? (conditionne P-DEC-06 et la « fiche commune » partie DMA)
3. Faut-il vraiment investir dans le maillage fin (P-DEC-07, effort L) avant d'avoir validé P-DEC-01/03, ou le repousser en phase 3 ?
4. Le rattachement automatique spatial (P-DEC-03) doit-il **écraser** les rattachements manuels existants ou seulement combler les CAV encore `NULL` ? (doctrine à fixer avant d'écrire le script)
5. Quel est le porteur métier de la validation « ce qui est publiable aux élus » pour la fiche commune (§4) — direction seule, ou revue conjointe avec la Métropole avant diffusion ?

**Commandes curl de phase 2** (à exécuter depuis un hôte non filtré, ex. le serveur de production — le proxy de cette session bloque `data.metropole-rouen-normandie.fr`) :

```bash
BASE=https://data.metropole-rouen-normandie.fr/api/explore/v2.1

# 6-1. Confirmer l'existence et la fraîcheur exacte du jeu PAV
curl -s "$BASE/catalog/datasets/donmetdec_pav" | jq '{fields:[.fields[]|{name,type,label}], metas:.metas.default}'

# 6-2. Lister les valeurs distinctes du champ de flux une fois son nom connu (remplacer <champ_flux>)
curl -s "$BASE/catalog/datasets/donmetdec_pav/records?select=<champ_flux>,count(*)&group_by=<champ_flux>&limit=20"

# 6-3. Isoler le sous-ensemble textile + vérifier la présence d'un champ gestionnaire
curl -s "$BASE/catalog/datasets/donmetdec_pav/records?where=search(%22textile%22)&limit=50" | jq '.results[0]'

# 6-4. Schéma de quantite-de-dechets : le textile y figure-t-il, à quelle granularité ?
curl -s "$BASE/catalog/datasets/quantite-de-dechets" | jq '{fields:[.fields[]|{name,type,label}], metas:.metas.default}'
curl -s "$BASE/catalog/datasets/quantite-de-dechets/records?limit=100" | jq '.results[] | keys'

# 6-5. Schéma des polygones communaux (nom du champ code INSEE, projection)
curl -s "$BASE/catalog/datasets/cadastre-communes-metropole-rouen-normandie-sage-cailly-aubette-robec" | jq '.fields'
curl -s "$BASE/catalog/datasets/cadastre-communes-metropole-rouen-normandie-sage-cailly-aubette-robec/exports/geojson" -o /tmp/communes-mrn.geojson

# 6-6. Granularité territoriale réelle du jeu Refashion national
curl -s "https://www.data.gouv.fr/api/1/datasets/?q=textiles%20collect%C3%A9s%20fili%C3%A8re%20REP" | jq '.data[0] | {title, resources:[.resources[].url]}'

# 6-7. Export complet PAV pour rapprochement offline avec la table cav (script P-DEC-01)
curl -s "$BASE/catalog/datasets/donmetdec_pav/exports/geojson" -o /tmp/pav-mrn.geojson

# 6-8. Déchèteries — confirmer que le jeu n'a pas été mis à jour depuis 2023
curl -s "$BASE/catalog/datasets/reseau-de-decheteries-metropole-rouen-normandie" | jq '.metas.default.modified, .metas.default.data_processed'

# 6-9. Volumétrie du cadastre bâtiments avant de committer l'effort L de P-DEC-07
curl -s "$BASE/catalog/datasets/cadastre-batiments-metropole-rouen-normandie-sage-cailly-aubette-robec" | jq '.metas.default.records_count'

# 6-10. SINOE : confirmer la granularité département et les millésimes disponibles pour la Seine-Maritime
curl -s "https://data.ademe.fr/data-fair/api/v1/datasets/sinoe-tonnage-dma-par-type-de-dechet/lines?q=Seine-Maritime&size=20"
```

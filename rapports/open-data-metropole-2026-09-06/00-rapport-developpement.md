# Open data de la Métropole Rouen Normandie × SOLIDATA — rapport de développement (phase 1 : cadrage)

> **Date** : 6 septembre 2026 · **Statut** : cadrage soumis à validation — **aucun code modifié** dans ce chantier.
> **Demande** : recenser les données ouvertes de la Métropole (https://data.metropole-rouen-normandie.fr) utiles à l'activité, aux outils de reporting à destination des élus (tableau de bord), aux études de remplissage des bornes et à la segmentation des apports ; proposer des agrégations sur l'outil actuel ; coordonner des agents par sujet (déchets, environnement et impacts, emploi et insertion, territoire, mobilité) ; livrer un plan de développement pour une phase 2 de déploiement après validation.
> **Dossier** : `rapports/open-data-metropole-2026-09-06/` — ce document est la synthèse ; les sept autres fichiers sont ses pièces.

---

## 0. Ce qu'il faut retenir en une page

1. **Le portail existe, il est riche et il est en licence ouverte** : plateforme Opendatasoft (rebaptisée Huwise en 2025), API Explore v2.1, **70 jeux de données identifiés** (identifiant vu sur le portail), 3 signalés indirectement, 8 besoins pour lesquels aucun jeu n'a été trouvé (jours de collecte, population/IRIS/QPV, budget, SIAE…). Détail : `01-inventaire-catalogue.md`.
2. **SOLIDATA est prêt à recevoir** : la clé de jointure territoriale est en place (`referentiel_communes.code_insee` + `cav.code_insee_commune`), PostGIS est actif, un client Explore API vers ce même portail existe déjà (`routes/tours/events-auto.js`), les jobs supervisés, le cache Redis, les settings et l'API publique à clés fournissent tous les patterns nécessaires. Détail : `07-cartographie-solidata.md`.
3. **42 propositions d'agrégation** ont été instruites par cinq agents thématiques, chacune avec formule, sources, écran cible, effort, valeur et comportement en cas de donnée absente. Elles sont consolidées, dédoublonnées et priorisées ici en **six lots** (§3).
4. **La « fiche commune » pour les élus est réalisable à 80 % avec les données déjà en base** (bornes, conteneurs, tournées, tonnage, kg/hab, CO2 évité, taux de service) ; l'open data apporte le contexte (population millésimée, superficie, densité, logements, résidences, réseau PAV de la Métropole, ZFE) et les contours pour une carte choroplèthe. Maquette complète : `05-territoire-fiche-commune.md` §4.
5. **Trois défauts existants sont à corriger avant toute ouverture aux élus**, indépendamment du chantier : l'API publique `GET /api/public/refashion/dpav` renvoie 500 dès qu'on la filtre (`public-api.js:105-106`, colonnes `year`/`trimester` inexistantes) ; le taux de captation global lit `cav.population_commune` et non le référentiel INSEE (`metropole.js:130`) ; le **millésime de la population n'est tracé nulle part**, alors que tout kg/hab en dépend.
6. **Deux chiffres de référence sont à trancher avant de publier le moindre kg/hab** : la population de la Métropole (le cadrage interne dit « ~700 000 hab », l'INSEE donne **494 299 hab** au millésime 2026 pour l'EPCI 200023414) et l'objectif de captation (3,6 kg/hab/an codé en dur, alors que la moyenne nationale Refashion est de 4,2 kg/hab en 2024).
7. **Limite de ce cadrage, dite franchement** : le portail, data.gouv.fr, l'INSEE et l'ADEME étaient **bloqués par la politique réseau de la session**. L'inventaire vient de l'indexation web, **aucun schéma de champs n'a été lu**. La phase 2 commence donc par un **lot 0 de vérification** (2 à 3 jours) dont les commandes exactes sont écrites ; six propositions dépendent d'un champ dont l'existence est à confirmer (le « flux » et le « gestionnaire » du jeu PAV, le « textile » du jeu tonnages).
8. **Estimation globale** : 40 à 55 jours de développement pour l'ensemble ; **la première vague proposée (lots 0, 1, 2) tient en 15 à 20 jours** et livre la fiche commune, la segmentation des communes, le rapprochement avec le réseau PAV de la Métropole et la réconciliation avec les chiffres officiels.

---

## 1. Méthode et périmètre

### 1.1 Organisation du chantier

| Rôle | Agent | Livrable |
|---|---|---|
| Découverte du catalogue | 1 agent (recherche web ciblée, ~50 requêtes) | `01-inventaire-catalogue.md` |
| Reconnaissance du code SOLIDATA | 1 agent (lecture du dépôt, `fichier:ligne`) | `07-cartographie-solidata.md` |
| Déchets & collecte textile | 1 agent thématique | `02-dechets-collecte.md` — 9 propositions P-DEC |
| Environnement & impacts | 1 agent thématique | `03-environnement-impacts.md` — 7 propositions P-ENV |
| Emploi, insertion & ESS | 1 agent thématique | `04-emploi-insertion-ess.md` — 9 propositions P-EMP |
| Territoire, population, tableau de bord des élus | 1 agent thématique | `05-territoire-fiche-commune.md` — 9 propositions P-TER + maquette de la fiche commune |
| Mobilité, tournées, remplissage | 1 agent thématique | `06-mobilite-tournees-remplissage.md` — 8 propositions P-MOB |
| Coordination, architecture, priorisation, plan | orchestrateur | ce document |

Chaque mémo thématique suit la même structure (enjeu, jeux retenus, propositions, contribution à la fiche commune, vigilances, vérifications de phase 2). Les propositions portent toutes : indicateur, formule, sources croisées, granularité, consommateur et écran cible, prérequis de vérification, effort (S < 1 j, M 1-3 j, L 3-6 j), valeur (1-5), risques et comportement « donnée absente ».

### 1.2 Contrainte réseau et conséquence sur la fiabilité

Les domaines `data.metropole-rouen-normandie.fr`, `data.opendatasoft.com`, `data.gouv.fr`, `insee.fr`, `geo.api.gouv.fr`, `ademe.fr`, `sig.ville.gouv.fr` et le site institutionnel de la Métropole ont tous répondu « accès refusé » à la sortie de l'environnement de travail. Conséquences :

- Un jeu marqué **Vérifié** signifie qu'une URL du portail portant son identifiant a été vue dans un résultat de recherche indexé ; **pas** que son contenu a été lu.
- Les **schémas de champs, volumétries et fréquences de mise à jour** sont inconnus, sauf pour deux jeux relayés par data.gouv.fr (PAV : mis à jour le 14/06/2026, 670 Ko ; déchèteries : 07/03/2023).
- La **licence** (Licence Ouverte 2.0) est confirmée pour ces deux jeux, supposée pour les autres.
- Le plan de phase 2 commence par rejouer, depuis le serveur de production (non filtré), les **dix requêtes** listées en `01-inventaire-catalogue.md` §4.2 et les vérifications spécifiques de chaque mémo (§6 de chacun).

### 1.3 Doctrines du projet appliquées à ce chantier

- **Jamais de valeur inventée** : un indicateur absent chez la source est `NULL`, affiché « non disponible (source : …) », jamais 0.
- **Provenance et millésime affichés** sur chaque chiffre ouvert (Licence Ouverte 2.0 : mention de la source et de la date obligatoire).
- **Estimation dite comme telle** : tout prorata (tonnage par commune, CO2 par commune, coût évité) porte la mention « estimation » et sa méthode.
- **Aucune donnée personnelle ne sort de SOLIDATA** ; les agrégats issus de données de salariés respectent un seuil d'anonymat n ≥ 5 (celui du module Enquêtes), sinon regroupement dans « autres communes ».
- **Réutiliser avant de créer** : aucune nouvelle « fonction » de la sidebar ; l'open data enrichit les écrans existants (Reporting Métropole, fiche CAV, moteur prédictif, Pilotage RSE, Communes INSEE).

---

## 2. État des lieux

### 2.1 Ce que le portail offre (synthèse de `01-inventaire-catalogue.md`)

| Thème | Jeux vérifiés les plus utiles | Ce qui manque au portail |
|---|---|---|
| Déchets | `donmetdec_pav` (PAV par flux **dont textile**, MAJ 06/2026), `quantite-de-dechets` (tonnages annuels par type et mode), `reseau-de-decheteries` | jours de collecte, compostage ; **le textile figure-t-il dans les tonnages ? inconnu** |
| Environnement | `emissions-de-gaz-a-effet-de-serre-annuelles` (ORECAN, **maille EPCI**, dernier millésime vu 2019), `zfe-m-metropole-rouen-normandie` (13 communes), `renouvellement_flotte_mrn` (PCAET), `mode-doccupation-des-sols-mos` | qualité de l'air (chez Atmo Normandie), bruit, PCAET détaillé |
| Mobilité / voirie | `travaux-json` (chantiers perturbants, source trafic-metropole-rouen.fr, **qualifié d'expérimental**), `zones-pietonnes-rouen`, `zones-apaisees`, `filaire-de-voies-metropolitain-par-troncons`, comptages routiers, `eco-counter-*` (vélo), `rouen_flux-pietons_vd`, arrêts et lignes Astuce, parkings | limitations de vitesse, sens de circulation |
| Territoire | `cadastre-communes-…` (**contours communaux**), cadastre parcelles/bâtiments, PLU (zonage, prescriptions), cavités souterraines, cartes adresses/IRIS/cantons (Département 76, signalé) | **population, IRIS, QPV, logements, revenus : absents du portail** → INSEE, geo.api.gouv.fr, sig.ville |
| Emploi / ESS | `spaser-12012024` (marchés à clauses sociales de la Métropole), `lieux-d-inclusion-numerique` (DORA), `repertoire-national-des-associations` | SIAE, chômage, ESS, ressourceries → INSEE, France Travail, ADEME « Longue vie aux objets » |
| Habitat / équipements | résidences sociales, séniors, jeunes, étudiantes ; équipements culturels ; `boites-a-lire-et-boites-a-dons-rouen` | — |
| Citoyenneté | `agenda-metropole-rouen-normandie` (**le seul identifiant d'agenda vérifié — et il n'est pas dans la cascade essayée par `events-auto.js`**), indemnités des élus, registre RGPD | budget, subventions, délibérations |

Sources complémentaires accessibles depuis la production : geo.api.gouv.fr (déjà utilisé, population + **contours** via `geometry=contour`), BAN (déjà utilisé, renvoie le code INSEE), INSEE Données locales (clé API), SINOE/ADEME (tonnages DMA par collectivité, années impaires), Refashion (« Textiles collectés par la filière REP », bilan environnemental), Open Data 76 (IRIS, QPV), Atmo Normandie.

### 2.2 Ce que SOLIDATA sait déjà faire (synthèse de `07-cartographie-solidata.md`)

| Capacité | Preuve | Limite constatée |
|---|---|---|
| Référentiel communes INSEE + EPCI, rafraîchi depuis geo.api.gouv.fr avec population | `init-db.js:1888-1899`, `communes.js:256-326` | **millésime de population non tracé** ; seed JSON vide (peuplement uniquement par l'API) ; pas de contour, pas de superficie |
| Rattachement borne → commune par code INSEE | `cav.code_insee_commune` (`init-db.js:1928`), `PATCH /communes/cav/:id` | rattachement **manuel** ; Refashion joint encore en texte libre `ILIKE` (`refashion.js:406`) |
| Tonnage et kg/hab par commune (prorata des CAV collectés) | `GET /metropole/captation-par-commune` (`metropole.js:388-439`) | **seule route communale** ; annuelle ; population lue en `COALESCE(rc.population_insee, c.population_commune)` |
| Taux de captation global | `metropole.js:128-146` | lit `cav.population_commune`, pas le référentiel → incohérent avec la route communale |
| CO2 évité par la valorisation | `metropole.js:40-67` (mix observé sur colisages, sinon 40/35/15/10) | facteurs **codés en dur**, non millésimés, non sourcés (contrairement à `ges_facteurs`) |
| Émissions propres (énergie, carburant) | module Énergie & GES, `ges_facteurs` millésimés | non territorialisées |
| KPI insertion non nominatifs | `metropole.js:499-588`, `insertion/routes.js` `gatherAuditKpis` | jamais par commune ; `employees.city/postal_code` libres, sans code INSEE ; **QPV : rien** |
| Moteur prédictif de remplissage | `tours/predictions.js:278-570` : météo, événements, saisonnalité, fériés, vacances, corrections par zone | densité = proxy « `nb_containers ≥ 3` » ; trafic stocké mais non appliqué |
| Client Explore API v2.1 vers le portail de la Métropole | `tours/events-auto.js:84-95, 241-291` | limité aux événements ; cascade de 4 identifiants **dont aucun n'est vérifié** |
| Page élus / auditeurs | `ReportingMetropole.jsx` (6 KPI, captation par commune, carte, CSV, PDF « revue de convention »), rôle AUTORITE | pas de fiche par commune, pas de choroplèthe (aucun composant GeoJSON Leaflet) |
| API publique partenaires | `public-api.js` (clés, scopes `cav:read`, `stats:read`, `refashion:read`) | **bug 500** sur `/refashion/dpav` filtré (`year`/`trimester` vs `annee`/`trimestre`) |

---

## 3. Les propositions, consolidées et priorisées

Les 42 propositions des mémos ont été relues ensemble. Cinq doublons ont été fusionnés (P-ENV-05 ≡ P-DEC-04 ; P-MOB-02 et P-ENV-04 sur la ZFE ; P-ENV-07, P-DEC-08 et P-MOB-05 sur les facteurs contextuels du moteur ; P-DEC-05 et P-TER-02 sur la densité de maillage ; P-DEC-03 et P-MOB-03 sur le rattachement des bornes). Quatre sont écartées ou mises en réserve (§3.7). Le reste est réparti en six lots ordonnés par dépendance et par rapport valeur/effort.

Légende : **V** valeur 1-5 · **E** effort S/M/L · « ⚠ champ » = dépend d'un champ du jeu à confirmer au lot 0.

### 3.1 Lot 0 — Vérifier, corriger, fonder (prérequis, 2 à 3 jours)

| Réf. | Contenu | V | E |
|---|---|---|---|
| L0-1 | Rejouer depuis la production les 10 requêtes du catalogue (`01` §4.2) : `total_count`, licences, `data_processed`, **schémas** de `donmetdec_pav`, `quantite-de-dechets`, `cadastre-communes`, `travaux-json`, `zfe-m`, `agenda-metropole-rouen-normandie`. Enregistrer les réponses comme **fixtures de test**. | 5 | S |
| L0-2 | Trancher les deux chiffres de référence : population EPCI (INSEE, millésime) et objectif de captation (paramétrable `metropole.objectif_captation_kg_hab`, plus jamais en dur). | 5 | S |
| L0-3 | Corriger `public-api.js:105-106` (`annee`/`trimestre`) ; aligner le taux de captation global sur `referentiel_communes.population_insee` (`metropole.js:130`) ; ajouter `population_millesime` et `refreshed_at` à `referentiel_communes` (**P-TER-04**). | 4 | S |
| L0-4 | **P-MOB-08** — extraire le client HTTP d'`events-auto.js` dans `services/open-data-mrn.js` (pagination, exports CSV/GeoJSON, timeout, cache, compteur d'appels) ; ajouter `agenda-metropole-rouen-normandie` en tête de la cascade d'événements. | 4 | S |
| L0-5 | Schéma de base : `opendata_sources`, `commune_indicateurs`, `opendata_geo_features` (§5.2) + job supervisé `syncOpenDataMetropole` + onglet « Sources open data » dans Administration → Communes. | 4 | M |

### 3.2 Lot 1 — Fiche commune et segmentation des communes (8 à 12 jours)

| Réf. | Contenu | V | E |
|---|---|---|---|
| **P-TER-01** | Endpoint `GET /metropole/commune/:code_insee` : capacité (bornes, conteneurs, tournées/an, fréquence réelle de passage, taux de service par commune), population, bénéfices (tonnage, kg/hab, CO2), chaque bloc avec `{valeur, unite, millesime, source, qualite}`. | 5 | S |
| **P-TER-03** | Rang parmi les 71 communes, écart à la moyenne et à la médiane ; rang masqué sous `seuil_min_cav`. | 5 | S |
| **P-TER-05** | Coût de traitement des OM évité = tonnes détournées × `settings opendata.cout_traitement_om_eur_t` (**aucun défaut** ; source à saisir : RPQS de la Métropole) — affiché « estimation ». | 5 | S |
| **P-TER-02 / P-DEC-05** | Densité de maillage : bornes / km² et bornes / 1 000 hab (superficie et contours via geo.api.gouv.fr `geometry=contour` ou `cadastre-communes`). | 4 | S |
| **P-DEC-03 / P-MOB-03** | Rattachement **spatial** des bornes à leur commune (`ST_Contains` sur les contours) proposé puis confirmé en un clic dans AdminCAV ; remplacement de l'`ILIKE` de `refashion.js:406` ; contrôle d'adresse via le filaire de voies. | 4 | M |
| **P-TER-07** | Segmentation paramétrable (`metropole.segmentation_seuils`) : échantillon insuffisant / bien maillée / sous-équipée / à fort potentiel / standard — règles explicites (`05` §4.6), calibrées sur les 71 communes réelles avant mise en service. | 5 | M |
| **P-TER-08** | Carte choroplèthe Leaflet (contours simplifiés, cache serveur) sur kg/hab, taux de service, maillage, segment. | 4 | M |
| **P-TER-09** | Export CSV (une ligne par commune, en-têtes millésimés), PDF « Fiche commune » A4 sur le pattern `printReview()`, API publique scope `territoire:read`. | 4 | M |

Consommateurs : élus (rôle AUTORITE), direction, Refashion. Écran : `ReportingMetropole.jsx` avec sélecteur de commune (le filtre existe déjà côté client, `:168-171`).

### 3.3 Lot 2 — Réseau PAV de la Métropole et réconciliation avec les chiffres officiels (6 à 8 jours)

| Réf. | Contenu | V | E |
|---|---|---|---|
| **P-DEC-01** | Import de `donmetdec_pav` (flux textile) dans `pav_metropole` ; rapprochement géographique avec `cav` (rayon paramétrable, 60 m par défaut) ; revue humaine des propositions (bornes de la Métropole absentes de SOLIDATA, bornes SOLIDATA inconnues de la Métropole) — décision tracée dans `cav_pav_rapprochement`. ⚠ champ flux | 4 | M |
| **P-DEC-02** | Cartographie des autres opérateurs textiles par commune. ⚠ **champ gestionnaire** : si absent, proposition caduque, dite telle quelle. | 5 / 0 | S |
| **P-DEC-04 / P-ENV-05** | Taux de captation enrichi : part du réseau PAV textile exploitée par SOLIDATA par commune (répond au grief d'audit « pas de décomposition par filière »). | 5 | S |
| **P-DEC-09** | Réconciliation SOLIDATA / Métropole (`quantite-de-dechets`) / SINOE / Refashion : tableau des écarts **sans lissage**, avec périmètres explicites. | 4 | M |
| **P-DEC-06** | Part du textile dans les DMA de l'EPCI. ⚠ le jeu isole-t-il le textile ? Sinon repli sur le repère SINOE départemental, qualifié de macro. | 3 | M |

### 3.4 Lot 3 — Environnement et impacts (8 à 10 jours)

| Réf. | Contenu | V | E |
|---|---|---|---|
| **P-ENV-02** | Migrer `FACTEURS_CO2` (`metropole.js:40`) vers `ges_facteurs` millésimés et sourcés (ADEME Base Empreinte ; bilan Refashion 2023 comme borne de comparaison). Prérequis de crédibilité RSEi/AFNOR. | 3 | S |
| **P-ENV-01** | CO2 évité SOLIDATA en regard des émissions du secteur Déchets de l'EPCI (ORECAN). **Maille EPCI seulement**, affiché en en-tête de toutes les fiches, jamais ventilé par commune. Millésime ORECAN ancien, dit. | 4 | M |
| **P-ENV-03** | Bilan net par commune : émissions propres de la collecte (km au prorata des points collectés × conso mesurée `computeVehicleConso`) vs CO2 évité (prorata `distributeTonnageProrata`). Nécessite `vehicles.fuel_type`. | 5 | L |
| **P-MOB-02 / P-ENV-04** | ZFE-m et zones piétonnes : import des polygones ; colonne Crit'Air / motorisation sur `vehicles` ; conformité du parc (interdiction **permanente** des VUL Crit'Air 4/5 en ZFE-m ; calendrier à ne jamais coder en dur) ; contrainte de tournée via le mécanisme `windows/anchor` du moteur de temps ; km parcourus en zone réglementée. | 4 | L |
| P-ENV-06 | Miroir de l'indicateur PCAET « renouvellement de flotte ». Dénominateur trop petit pour être robuste — communication seulement. | 2 | S |

### 3.5 Lot 4 — Insertion territorialisée, non nominative (5 à 7 jours, **conditionné à l'arbitrage DPO**)

| Réf. | Contenu | V | E |
|---|---|---|---|
| **P-EMP-03** | Nombre d'habitants de chaque commune accompagnés en parcours (et sorties dynamiques) : normalisation `employees.postal_code/city` → code INSEE via BAN (**code postal + commune, jamais le numéro de rue**), agrégat annuel, **seuil n ≥ 5** sinon « autres communes ». | 5 | S |
| **P-EMP-01** | Part des salariés en parcours résidant en QPV (16 quartiers, 14 communes ; référentiel sig.ville / Open Data 76) — indicateur attendu par la DREETS et le contrat de ville ; **au niveau structure**, jamais par QPV isolé. | 5 | M |
| **P-EMP-04** | Sorties dynamiques SOLIDATA en regard du taux de chômage communal (INSEE) — juxtaposition, jamais fusion. | 3 | S |
| **P-EMP-02** | Contexte communal (chômage, niveau de vie Filosofi) en regard des freins déclarés. | 4 | M |
| **P-TER-06** | ETP d'insertion imputés au territoire au prorata du tonnage — **estimation conventionnelle**, réserve de méthode obligatoire à l'écran ; à ne retenir que si la direction l'assume. | 3 | S/M |
| **P-EMP-07** | Lieux d'inclusion numérique (DORA) proposés à la CIP quand un frein numérique est évalué — outil opérationnel, pas un indicateur. | 3 | S |

Registre art. 30 : nouvelle finalité « agrégats territoriaux d'insertion », base légale mission d'intérêt public / reporting conventionnel, minimisation, journalisation de chaque restitution, rôle AUTORITE limité aux agrégats seuillés. Détail : `04-emploi-insertion-ess.md` §5.

### 3.6 Lot 5 — Tournées et remplissage des bornes (10 à 15 jours, en deux temps)

**5a — contraintes opérationnelles (après lot 0)**

| Réf. | Contenu | V | E |
|---|---|---|---|
| **P-MOB-01** | Chantiers `travaux-json` (job quotidien) affichés sur la collecte en direct et la carte chauffeur, fusionnés avec les incidents TomTom ; facteur de durée sur les tronçons touchés. Jeu qualifié d'expérimental : alerte, jamais blocage. | 3 | M |
| **P-MOB-06** | Typologie des bornes (centre-ville piéton / résidentiel dense / périurbain / zone commerciale / proche déchèterie) construite par PostGIS à partir de MOS, ZFE, zones piétonnes, déchèteries, résidences étudiantes ; exposée dans AdminCAV et la carte ; usage : fréquence de passage, taille de conteneur, communication élus. | 4 | L |

**5b — prédicteurs de remplissage (après backtest, jamais sans preuve mesurée)**

| Réf. | Contenu | V | E |
|---|---|---|---|
| **P-MOB-05 / P-DEC-08 / P-ENV-07** | Densité réelle (bâti, occupation du sol, logements) en remplacement du proxy `nb_containers ≥ 3` ; déchèterie proche ; protocole de backtest sur `tonnage_history` / `tour_cav.fill_level` avec split entraînement/validation, garde « échantillon insuffisant → aucune écriture » (pattern `weather-learning.js`). | 4 | L |
| P-MOB-04 | Flux piétons/vélo comme prédicteur — conditionné à une couverture géographique suffisante des compteurs (à quantifier au lot 0). | 3 | L |
| P-MOB-07 | Saisonnalité liée aux résidences étudiantes (rentrée, fin d'année universitaire). | 3 | M |
| P-DEC-07 | Maillage fin : distance moyenne habitant → borne (calcul lourd en job, jamais à la demande). | 3 | L |

### 3.7 Écartées ou en réserve, avec le motif

| Réf. | Motif |
|---|---|
| Qualité de l'air (Atmo Normandie) | Aucune causalité mesurable entre l'activité et un indice ATMO local ; ce serait un chiffre décoratif. |
| `conso_eau`, réseaux de chaleur | Hors sujet pour l'activité. |
| P-EMP-09 (résidences sociales à proximité des salariés) | Risque de stigmatisation par inférence ; aucun besoin métier exprimé. Déconseillée. |
| P-EMP-05, P-EMP-06, P-EMP-08 | Valeur faible ou non vérifiable (SPASER : contenu réel inconnu) ; à réévaluer après le lot 0. |

---

## 4. La fiche commune — ce que verra un élu

Maquette complète, libellés et notes de méthode : `05-territoire-fiche-commune.md` §4. Résumé des blocs :

1. **En-tête** : commune, code INSEE, EPCI, population (millésime et date d'actualisation), rang sur 71, segment.
2. **Capacité de collecte** : bornes actives, conteneurs, tournées par an, fréquence réelle de passage, densité de maillage, taux de service — chacun avec la moyenne Métropole.
3. **Population et caractéristiques** : population, superficie, densité, logements, résidences (sociales, séniors, jeunes, étudiantes), équipements — « ces indicateurs qualifient le territoire, ils ne mesurent pas notre activité ».
4. **Avantages de la collecte textile** : tonnage 12 mois, kg/hab/an vs objectif paramétré, CO2 évité (mix observé ou forfaitaire, dit), coût de traitement des OM évité (**estimation**), habitants accompagnés en insertion (n ≥ 5, lot 4), part du réseau PAV exploitée par SOLIDATA (lot 2).
5. **Comparaison Métropole** : jauge commune / moyenne / médiane sur 2-3 indicateurs.
6. **Notes de méthode toujours affichées** : prorata des CAV (pas de pesée par commune), estimations, sources et millésimes, périmètre « collecte textile SOLIDATA uniquement ».

Canaux : sélecteur de commune dans `/reporting-metropole` (rôle AUTORITE inclus), PDF A4 par commune, CSV des 71 communes, API publique à clé pour les services de la Métropole.

**Arbitrage d'accès à trancher** : aujourd'hui le rôle AUTORITE voit toute la Métropole (auditeur). Si chaque élu doit ne voir que sa commune, il faudra un rôle ou une clé API **bornés à un code INSEE** — prévu dans le modèle (scope `commune:<code_insee>`), à décider.

---

## 5. Architecture technique cible — le connecteur « Open data territorial »

Principe : **un seul connecteur, un seul job, une seule table d'indicateurs**, consommés par les écrans existants. Pas de nouveau module au sens de la sidebar : l'open data n'est pas une fonctionnalité, c'est une source qui enrichit le Reporting Métropole, la fiche CAV, le moteur prédictif et le Pilotage RSE.

### 5.1 Ce qui existe déjà et qu'on réutilise tel quel

| Brique | Où | Réemploi |
|---|---|---|
| Client Explore API v2.1 vers `data.metropole-rouen-normandie.fr` | `backend/src/routes/tours/events-auto.js:84-95, 241-291` | À **extraire** dans un service partagé (`services/open-data-mrn.js`) : `httpGet` avec redirections et timeout, pagination `limit/offset`, exports CSV/GeoJSON |
| Clé de jointure territoriale | `referentiel_communes.code_insee` + `cav.code_insee_commune` (`init-db.js:1888, 1928`) | Aucune nouvelle clé ; toute donnée communale s'accroche au code INSEE |
| Refresh communes (fetch natif, `AbortSignal.timeout`, transaction par EPCI, 504/502 typés) | `routes/communes.js:114-127, 256-326` | Modèle de robustesse du job d'import |
| Cache mémoire TTL + « échec → null » | `utils/weather.js` | Même doctrine pour les appels open data |
| Géocodage BAN renvoyant `citycode` | `services/geocodage.js:35-56` | Normalisation `employees.postal_code/city` → INSEE (lot 4) et contrôle des adresses de bornes |
| Jobs supervisés | `services/scheduler.js:72` + `routes/monitoring.js:91-177` (`JOB_SCHEDULE`) | Un job `syncOpenDataMetropole` déclaré en 2 lignes |
| Settings en cascade honnête | `routes/communes.js:96-112`, `routes/effectifs.js:100-129` | Paramètres du connecteur (`opendata.*`) |
| Cache Redis d'endpoint | `middleware/cache.js` | Fiche commune et API publique |
| API publique à clés et scopes | `routes/public-api.js`, `middleware/api-key.js` | Restitution à la Métropole (scope `territoire:read`) |
| PostGIS (`cav.geom` + GiST) | `init-db.js:530, 543` | Rapprochement PAV ↔ CAV, contours communaux, typologie des bornes |
| Moteur de temps de tournée, fenêtres et ancrages | `services/tour-time-engine.js:32-45, 283-317` | Contraintes ZFE / zones piétonnes |
| Apprentissage par moindres carrés avec garde d'échantillon | `services/weather-learning.js` | Backtest des prédicteurs de remplissage |

### 5.2 Schéma proposé (idempotent, `init-db.js`)

```sql
-- Registre des jeux consommés : quoi, d'où, quand, sous quelle licence
CREATE TABLE IF NOT EXISTS opendata_sources (
  id SERIAL PRIMARY KEY,
  code VARCHAR(80) UNIQUE NOT NULL,          -- ex. 'mrn.donmetdec_pav'
  portail VARCHAR(40) NOT NULL,              -- 'mrn' | 'geo_api_gouv' | 'insee' | 'ademe_sinoe' | 'refashion'
  dataset_id VARCHAR(160) NOT NULL,
  titre TEXT, licence VARCHAR(80),           -- lu dans metas.default.license, jamais supposé
  cadence VARCHAR(20) NOT NULL DEFAULT 'monthly',
  actif BOOLEAN NOT NULL DEFAULT true,
  derniere_sync_at TIMESTAMPTZ, derniere_modification_source TIMESTAMPTZ,
  derniere_erreur TEXT, nb_lignes INTEGER
);

-- Indicateurs communaux millésimés (format long : une ligne = commune × indicateur × millésime)
CREATE TABLE IF NOT EXISTS commune_indicateurs (
  code_insee VARCHAR(5) NOT NULL REFERENCES referentiel_communes(code_insee) ON DELETE CASCADE,
  indicateur VARCHAR(80) NOT NULL,           -- 'population_legale', 'superficie_km2', 'om_kg_hab', 'nb_pav_textile_mrn', ...
  millesime SMALLINT NOT NULL,
  valeur NUMERIC(18,4),                      -- NULL = absent chez la source (jamais 0 par défaut)
  unite VARCHAR(20),
  source_code VARCHAR(80) NOT NULL REFERENCES opendata_sources(code),
  qualite VARCHAR(20) NOT NULL DEFAULT 'source',  -- 'source' | 'derive' (calculé par nous) | 'estime' (prorata, dit à l'écran)
  calcule_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (code_insee, indicateur, millesime)
);

-- Référentiel PAV de la Métropole (copie locale, flux textile filtré à l'import)
CREATE TABLE IF NOT EXISTS pav_metropole (
  id_source VARCHAR(120) PRIMARY KEY,        -- identifiant du jeu (à confirmer au lot 0)
  flux VARCHAR(40), commune VARCHAR(120), code_insee VARCHAR(5), adresse TEXT,
  gestionnaire TEXT,                         -- NULL si le champ n'existe pas
  geom GEOMETRY(Point, 4326),
  raw JSONB NOT NULL, importe_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pav_metropole_geom ON pav_metropole USING GIST(geom);

-- Rapprochement PAV ↔ CAV : proposition automatique, décision humaine tracée
CREATE TABLE IF NOT EXISTS cav_pav_rapprochement (
  cav_id INTEGER REFERENCES cav(id) ON DELETE CASCADE,
  pav_id_source VARCHAR(120) REFERENCES pav_metropole(id_source) ON DELETE CASCADE,
  distance_m NUMERIC(8,1), statut VARCHAR(20) NOT NULL DEFAULT 'propose',  -- propose | confirme | rejete
  decide_par INTEGER REFERENCES users(id), decide_at TIMESTAMPTZ,
  PRIMARY KEY (cav_id, pav_id_source)
);

-- Contours et millésime (dette : millésime non tracé aujourd'hui)
ALTER TABLE referentiel_communes ADD COLUMN IF NOT EXISTS geom GEOMETRY(MultiPolygon, 4326);
ALTER TABLE referentiel_communes ADD COLUMN IF NOT EXISTS population_millesime SMALLINT;
ALTER TABLE referentiel_communes ADD COLUMN IF NOT EXISTS superficie_km2 NUMERIC(10,3);
ALTER TABLE referentiel_communes ADD COLUMN IF NOT EXISTS refreshed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_ref_communes_geom ON referentiel_communes USING GIST(geom);

-- Couches de contexte (tournées, typologie des bornes) : une table générique
CREATE TABLE IF NOT EXISTS opendata_geo_features (
  id SERIAL PRIMARY KEY,
  source_code VARCHAR(80) NOT NULL REFERENCES opendata_sources(code),
  id_source VARCHAR(160), categorie VARCHAR(40) NOT NULL,   -- 'zfe' | 'zone_pietonne' | 'zone_apaisee' | 'chantier' | 'decheterie' | 'arret_astuce' | 'residence'
  libelle TEXT, valide_du DATE, valide_au DATE,
  geom GEOMETRY(Geometry, 4326) NOT NULL, raw JSONB,
  importe_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_code, id_source)
);
CREATE INDEX IF NOT EXISTS idx_opendata_geo_features_geom ON opendata_geo_features USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_opendata_geo_features_cat ON opendata_geo_features(categorie);

-- Véhicules : lot 3 (ZFE)
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS critair VARCHAR(10);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuel_type VARCHAR(20);
```

Règles :
- **`valeur NULL` signifie « absent chez la source »**. Aucun indicateur n'est initialisé à 0. Un écran qui ne trouve pas la ligne affiche « non disponible (source : …) ».
- **`qualite`** est affichée : `source` (donnée officielle), `derive` (calculée par SOLIDATA à partir de sources officielles, formule documentée), `estime` (prorata ou hypothèse, marquée « ≈ »).
- **Millésime toujours porté** : un kg/hab 2026 sur une population 2022 est dit tel quel.
- Les copies locales (`pav_metropole`, `opendata_geo_features`) sont **remplacées par lot** à chaque synchronisation réussie (transaction par source) ; en cas d'échec l'ancienne copie reste et `derniere_erreur` est renseignée. Les décisions humaines (`cav_pav_rapprochement`) survivent parce qu'elles pointent sur l'identifiant de la source, pas sur un identifiant technique.

### 5.3 Service et jobs

`backend/src/services/open-data-mrn.js` (pur autant que possible, E/S injectées pour les tests) :
- `fetchCatalog()`, `fetchDatasetMeta(id)` (schéma, licence, `data_processed`), `fetchRecords(id, {select, where, limit, offset})` paginé, `fetchExport(id, 'geojson'|'csv')`.
- Parseurs purs par jeu (`parsePav`, `parseQuantiteDechets`, `parseGeoLayer`) testés sur les **fixtures enregistrées au lot 0**.
- Timeout 15 s, 3 redirections max, `User-Agent: SOLIDATA/<version> (solidata.online)`, refus d'une licence non reconnue (source désactivée + alerte).
- Aucune valeur inventée : un champ manquant produit `NULL` et une ligne dans le rapport de synchronisation.

Jobs (`services/scheduler.js`, `runInstrumented`, déclarés dans `JOB_SCHEDULE`) :
- `syncOpenDataMetropole` — mensuel, le 2 à 04 h Europe/Paris, `maxAgeHours: MONTHLY` ; une transaction par source, un échec n'en bloque pas une autre.
- `syncOpenDataChantiers` — quotidien 05 h, jeu `travaux-json` uniquement (fraîcheur utile : la journée).
- `refreshCommunesContours` — trimestriel, geo.api.gouv.fr `geometry=contour`, avec simplification de tracé et cache.

Déclenchement manuel : `POST /api/opendata/sync/:code` (ADMIN/MANAGER) et onglet « Sources open data » dans la page existante **Administration → Communes (INSEE)** (`AdminCommunes.jsx`) : liste des sources, dernière synchro, dernière erreur, nombre de lignes, bouton « Synchroniser », lien vers la fiche du jeu sur le portail.

### 5.4 Paramètres (`settings`, catégorie `opendata` / `metropole`)

| Clé | Défaut en code | Rôle |
|---|---|---|
| `opendata.mrn_base_url` | `https://data.metropole-rouen-normandie.fr` | Un changement de domaine (Huwise) ne casse rien |
| `opendata.sources_actives` | JSON liste des codes | Activer/désactiver une source sans déploiement |
| `opendata.pav_rayon_rapprochement_m` | `60` | Rayon de proposition PAV ↔ CAV |
| `opendata.cout_traitement_om_eur_t` | **`null`** | Coût de traitement des OM (source : RPQS de la Métropole) — sans valeur, l'indicateur affiche « non paramétré » |
| `opendata.seuil_anonymat` | `5` | Seuil n ≥ 5 de tout agrégat par commune issu de données personnelles |
| `metropole.objectif_captation_kg_hab` | `3.6` (valeur actuelle, à revoir : 4,2 national 2024) | Remplace la constante `metropole.js:143` |
| `metropole.segmentation_seuils` | JSON (`05` §4.6) | `seuil_min_cav` 3, `seuil_service_haut` 0,90, `ratio_sous_equipe` 0,7 |
| `opendata.population_millesime_min` | `2020` | Alerte si le millésime de population est plus ancien |

### 5.5 Restitution

1. **`GET /api/metropole/commune/:code_insee?annee=`** — fiche commune (rôles ADMIN/MANAGER/RH/AUTORITE comme le reste de `metropole.js`), cache Redis 300 s ; chaque bloc `{ valeur, unite, millesime, source, qualite }` ou `{ valeur: null, motif }`.
2. **`ReportingMetropole.jsx`** — sélecteur de commune, panneau « fiche commune », choroplèthe quand `referentiel_communes.geom` est renseigné (cercles sinon), bouton « Fiche commune (PDF) » sur le pattern `printReview()`.
3. **CSV** des 71 communes (BOM UTF-8, `;`, en-têtes millésimés) comme `exportCaptationCsv()`.
4. **API publique** : scope `territoire:read`, `GET /api/public/territoire/communes[/:code_insee]`, agrégats seulement, journalisé. **Prérequis : corriger `public-api.js:105-106`.**

### 5.6 Sécurité, RGPD, licence, réseau

- **Sens unique** : SOLIDATA lit l'open data, n'écrit rien sur le portail ; la restitution à la Métropole passe par l'API publique à clés ou les exports.
- **Aucune donnée personnelle vers un service externe**, sauf la normalisation d'adresse de résidence par la BAN (lot 4) : code postal + commune uniquement, finalité inscrite au registre art. 30, seuil n ≥ 5 sur toute restitution. Sans arbitrage DPO, le lot 4 ne démarre pas.
- **Licence Ouverte 2.0** : mention « Source : Métropole Rouen Normandie, open data, jeu X, millésime Y » sur chaque indicateur ; licence lue dans `metas.default.license` ; un jeu sous une autre licence est refusé.
- **Réseau** : appels depuis le backend (`solidata-api`) uniquement ; les quotas du portail (`X-RateLimit-*`) sont à lire au lot 0 ; seul `travaux-json` est appelé quotidiennement.
- **Tests** : parseurs purs sur fixtures réelles, contrats d'endpoints (`tests/contract/`), preuve sur PostgreSQL réel pour les requêtes PostGIS, contre-épreuves par mutation sur les gardes « donnée absente » et « seuil d'anonymat » — comme pour tous les chantiers précédents du projet.

---

## 6. Plan de phase 2 — déploiement

### 6.1 Vagues proposées

| Vague | Lots | Durée estimée | Livrable visible |
|---|---|---|---|
| **A — socle et fiche commune** | 0, 1, 2 | 15 à 20 j | Fiche commune (écran, PDF, CSV, API), segmentation des 71 communes, rapprochement avec le réseau PAV de la Métropole, réconciliation avec les chiffres officiels, correctifs des trois défauts existants |
| **B — environnement et tournées** | 3, 5a | 12 à 16 j | Facteurs CO2 sourcés, bilan net par commune, ZFE dans le parc et les tournées, chantiers sur la carte, typologie des bornes |
| **C — insertion territorialisée** | 4 | 5 à 7 j, **après arbitrage DPO** | Habitants accompagnés par commune (n ≥ 5), part QPV, contexte INSEE |
| **D — prédicteurs de remplissage** | 5b | 8 à 12 j, **après backtest concluant** | Densité réelle dans le moteur, facteurs contextuels ; ou constat mesuré d'absence d'effet (résultat aussi valable) |

Chaque vague est livrable et déployable seule (`deploy.sh update`, migrations idempotentes, aucun paramétrage obligatoire hors les deux valeurs à trancher au lot 0).

### 6.2 Critères d'acceptation de la vague A

- Les 10 requêtes du lot 0 sont archivées avec leurs réponses ; les schémas réels remplacent les hypothèses dans les mémos concernés.
- Sur PostgreSQL réel : chaque commune de l'EPCI 200023414 obtient une fiche ; une commune sans borne obtient une fiche **sans rang** et sans kg/hab inventé ; une commune hors EPCI n'apparaît jamais.
- Somme des tonnages par commune = tonnage total (conservation du prorata, oracle `distributeTonnageProrata`).
- Rapprochement PAV ↔ CAV : aucune écriture automatique sur `cav` ; chaque décision porte un utilisateur et une date.
- API publique : `GET /api/public/refashion/dpav?annee=2026&trimestre=2` répond 200 ; le scope `territoire:read` ne renvoie aucun champ nominatif (test de contrat).
- Rendu réel (Chromium) de la fiche commune PDF sur une commune dense, une commune rurale et une commune sans borne.
- Jest, Vitest, build Vite verts ; nouveaux tests de contrat sur chaque endpoint ; contre-épreuves par mutation sur « valeur NULL jamais 0 » et sur le seuil d'anonymat.

### 6.3 Arbitrages demandés au client avant la phase 2

| # | Question | Proposition par défaut |
|---|---|---|
| 1 | **Population de référence** : le « ~700 000 hab » de la documentation interne ne correspond pas à l'EPCI (INSEE 2026 : 494 299). Quel périmètre publie-t-on ? | EPCI 200023414, population légale INSEE, millésime affiché |
| 2 | **Objectif de captation** : garder 3,6 kg/hab/an (Refashion historique) ou aligner sur la moyenne nationale 2024 (4,2) ? | Paramètre ; valeur conventionnelle de la Métropole si elle en a une |
| 3 | **Coût de traitement des OM** (€/t) et sa source (RPQS) pour le « coût évité » | Aucune valeur tant que non fournie ; libellé « estimation » |
| 4 | **Accès des élus** : AUTORITE voit toute la Métropole, ou un accès borné à une commune ? | AUTORITE inchangé + clés API `commune:<code_insee>` à la demande |
| 5 | **Insertion par commune** (lot 4) : validation DPO de la finalité, de la base légale et du seuil n ≥ 5 | Attendre l'arbitrage ; rien n'est développé avant |
| 6 | **ETP imputés par commune** (P-TER-06) : l'assume-t-on à l'écran avec sa réserve de méthode ? | Non par défaut ; option |
| 7 | **ZFE** : saisir la vignette Crit'Air et la motorisation de chaque véhicule (lot 3) | Oui, saisie initiale par le gestionnaire |
| 8 | **Ouverture d'une clé API à la Métropole** (scope `territoire:read`) | Oui, après correction du bug et revue du contenu |
| 9 | Confirmer les propositions écartées (§3.7) | Écartées |
| 10 | Seuils de segmentation (§3.2, P-TER-07) : calibrage sur les 71 communes réelles avec la direction | Atelier de 2 h sur données réelles avant mise en service |

### 6.4 Risques

| Risque | Effet | Parade |
|---|---|---|
| Le jeu PAV n'isole pas le flux textile ou n'a pas de gestionnaire | Lot 2 réduit (P-DEC-02 caduque, P-DEC-01 dégradé) | Dit au lot 0 avant tout développement ; repli sur ADEME « Longue vie aux objets » |
| Le jeu tonnages n'isole pas le textile | P-DEC-06 remplacé par le repère SINOE départemental | Libellé « macro, département » |
| Licence différente de LO 2.0 sur un jeu | Jeu exclu | Lecture systématique de `metas.default.license` |
| Contours GeoJSON lourds | Carte lente pour les élus | Simplification de tracé + cache serveur + repli cercles |
| Sur-interprétation des estimations par un lecteur non averti | Contestation d'un chiffre par une commune | Notes de méthode inamovibles, « ≈ », millésimes ; prorata expliqué |
| Ré-identification sur petite commune (lot 4) | Manquement RGPD | Seuil n ≥ 5 structurel, journalisation, agrégat « autres communes » |
| Portail changé (Huwise) | Synchronisations en échec | Base URL en setting, échec nommé dans l'onglet Sources, ancienne copie conservée |

---

## 7. Pièces du dossier

| Fichier | Contenu |
|---|---|
| `00-rapport-developpement.md` | Ce document : synthèse, priorisation, architecture, plan de phase 2, arbitrages |
| `01-inventaire-catalogue.md` | Inventaire du portail (81 lignes : 70 vérifiées, 3 signalées, 8 besoins sans jeu), sources complémentaires, limites, 10 requêtes API de phase 2 |
| `02-dechets-collecte.md` | P-DEC-01 à 09 : réseau PAV, captation enrichie, densité, DMA, maillage, réconciliation SINOE/Refashion |
| `03-environnement-impacts.md` | P-ENV-01 à 07 : ORECAN, facteurs CO2 sourcés, bilan net par commune, ZFE, PCAET |
| `04-emploi-insertion-ess.md` | P-EMP-01 à 09 : QPV, habitants accompagnés, contexte INSEE, SPASER, DORA, RNA ; analyse RGPD complète |
| `05-territoire-fiche-commune.md` | P-TER-01 à 09 : maquette de la fiche commune, règles de segmentation, canaux de restitution, coût évité |
| `06-mobilite-tournees-remplissage.md` | P-MOB-01 à 08 : chantiers, ZFE/zones piétonnes, filaire de voies, protocole de backtest, typologie des bornes, client open data |
| `07-cartographie-solidata.md` | Ce que le code sait déjà faire (`fichier:ligne`) et les points d'accroche |

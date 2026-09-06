# 01 — Inventaire du catalogue open data de la Métropole Rouen Normandie

> Chantier open data Métropole — agent de découverte, 6 septembre 2026. Ce document est l'inventaire brut ; la synthèse et les propositions sont dans `00-rapport-developpement.md`.


> Agent de découverte SOLIDATA — 6 septembre 2026.
> Méthode : ~50 recherches web ciblées (moteur de recherche uniquement). **Aucun accès direct** au portail ni aux miroirs n'a été possible : `data.metropole-rouen-normandie.fr`, `data.gouv.fr`, `data.europa.eu`, `files.opendatarchives.fr`, `dateno.io`, `geo.api.gouv.fr`, `insee.fr`, `opendata.normandie.fr`, `transport.data.gouv.fr`, `sig.ville.gouv.fr` et `www.metropole-rouen-normandie.fr` sont tous bloqués par le proxy de sortie (EGRESS_BLOCKED, testé une fois chacun).
> Conséquence : tout ce qui est marqué **Vérifié** signifie « une URL du portail (ou de data.gouv.fr) contenant l'identifiant du jeu a été vue dans un résultat de recherche indexé » — pas « le contenu a été lu ». Les schémas de champs, volumétries et fraîcheurs restent à confirmer en phase 2 (section 4).

---

## 1. Description du portail

| Élément | Constat | Statut |
|---|---|---|
| URL | `https://data.metropole-rouen-normandie.fr` (accueil : `/pages/accueil/`, catalogue : `/explore/`) | Vérifié (URL vues) |
| Plateforme | **Opendatasoft**, rebaptisée **Huwise** le 30 septembre 2025 (les titres de pages indexées portent tantôt « — Opendatasoft », tantôt « — Huwise » ; les adresses `.opendatasoft.com` restent valides). Le catalogue géographique interne est géré avec **Isogeo** (projet « Mets ta donnée »), couplé à la plateforme ODS pour la publication. | Vérifié |
| Historique | Stratégie open data votée par la Métropole en **février 2021** ; portail ouvert au public en **2022** ; alimentation progressive par les directions et les communes volontaires. | Vérifié (concertation « Je participe », blog Opendatasoft) |
| Modèle de publication | Le portail héberge aussi des jeux de **communes membres** (Ville de Rouen, Déville-lès-Rouen, Elbeuf, Saint-Aubin-lès-Elbeuf, Grand-Quevilly). Les identifiants internes SIG suivent le motif `donmet<dir>_<objet>` (ex. `donmetdec_pav` = direction déchets, `donmeturb_cav_indice_pct` = urbanisme/cavités) ; la majorité des autres jeux ont des slugs « lisibles » générés par ODS. | Vérifié (2 identifiants `donmet…` vus) |
| API attendue | Explore API v2.1 standard ODS/Huwise : `GET /api/explore/v2.1/catalog/datasets` (catalogue), `GET /api/explore/v2.1/catalog/datasets/{id}/records?limit=…&where=…&select=…` (enregistrements), `GET /api/explore/v2.1/catalog/datasets/{id}/exports/{csv|json|geojson|xlsx|parquet}` (exports complets). Deux URL d'API du portail ont été **vues dans les résultats** : `/api/explore/v2.1/catalog/datasets/renouvellement_flotte_mrn/exports/csv?use_labels=false` et `/api/explore/v2.1/catalog/datasets/ris-elbeuf/files/<hash>` (pièces jointes). | **Vérifié** pour la forme `exports/csv` et `files/` ; **Supposé** (mais standard) pour `records`, `geojson`, paramètres ODSQL, `limit` max 100 par page, `offset` ≤ 10 000. |
| Licence | **Licence Ouverte / Open Licence v2.0 (Etalab)** confirmée sur data.gouv.fr pour `donmetdec_pav` et `reseau-de-decheteries-…`. | **Vérifié** pour ces deux jeux ; **Supposé** (très probable) pour l'ensemble du portail — à confirmer via le champ `metas.default.license` du catalogue. |
| Thèmes / pages éditoriales vus | Accueil, Démarche (`/pages/demarche/`), **OMMER – Mobilité** (`/pages/mobilite/`), Comptages des modes doux (`/pages/comptages-modes-doux/`), Comptages et enquêtes sur le réseau viaire (`/pages/comptages-et-enquetes-sur-le-reseau-viaire/`), Datavisualisations (`/pages/datavisualisations/`). Thèmes de données observés : déchets, environnement/énergie/climat, mobilité & voirie, urbanisme & cadastre, risques (cavités), habitat, équipements, citoyenneté/transparence, culture/patrimoine/tourisme. | Vérifié (URL vues) |
| Volumétrie du catalogue | **Non déterminée** (la page catalogue n'a pas pu être lue). Cet inventaire recense **70 identifiants distincts vus** sur le portail ; l'organisation « Métropole Rouen Normandie » sur data.gouv.fr expose **29 jeux** (moissonnage partiel). Le miroir `files.opendatarchives.fr/data.metropole-rouen-normandie.fr/` (dernière archive datée 26/08/2026 d'après l'extrait indexé) contiendrait la liste complète. | Signalé / Supposé |
| Points d'attention | Certains jeux existent en doublon d'identifiant (`eco-counter-data-day` et `eco-counter-data_day`) ; certaines pages sont des « assets » (`/explore/assets/…`) et non des datasets — il s'agit du nouveau vocabulaire Huwise pour les objets du catalogue (jeux, cartes, pages), l'API `datasets` reste le point d'entrée. | Vérifié (URL vues) / Supposé (interprétation) |

---

## 2. Tableau des jeux de données identifiés

Légende certitude : **V** = Vérifié (URL du portail ou de data.gouv.fr vue dans un résultat indexé) · **S** = Signalé (mentionné indirectement : data.gouv.fr, transport.data.gouv.fr, description d'un autre jeu) · **?** = Supposé (probable mais non vu — raison indiquée).
Granularité, période et fréquence proviennent uniquement des descriptions indexées ; « n.d. » = non déterminé.

### 2.1 Déchets (cœur de métier SOLIDATA)

| # | Identifiant | Titre | Description courte | Granularité | Période | MAJ | URL | Cert. |
|---|---|---|---|---|---|---|---|---|
| 1 | `donmetdec_pav` | Points d'apport volontaire (PAV) déchets – MRN | Localisation des PAV **par flux : ordures ménagères, recyclables, verre, textile**. Publié aussi sur data.gouv.fr (LO 2.0, CSV 669,9 Ko + JSON 1,2 Mo, dernière MAJ **14/06/2026** ; couverture temporelle/spatiale non renseignée dans les métadonnées). | Point géolocalisé | n.d. (état courant) | irrégulière, récente | https://data.metropole-rouen-normandie.fr/explore/dataset/donmetdec_pav/ | **V** |
| 2 | `quantite-de-dechets` | Quantité de déchets collectés par la MRN | Tonnages **par année et par type de déchet**, selon le mode : porte-à-porte, apport volontaire, déchèteries. Le rapport annuel 2023 cite 129 660 t d'OM (257,38 kg/hab, −2,9 % vs 2022) — ces chiffres viennent du rapport PDF, pas d'une lecture du jeu. | Année × type × mode (EPCI entier) | n.d. (probablement ≥ 2018) | annuelle (supposé) | https://data.metropole-rouen-normandie.fr/explore/dataset/quantite-de-dechets/ | **V** |
| 3 | `reseau-de-decheteries-metropole-rouen-normandie` | Réseau de déchèteries – MRN | Localisation des déchèteries. data.gouv.fr : LO 2.0, CSV 3,4 Ko / JSON 6,1 Ko, dernière MAJ **07/03/2023**, fréquence non documentée. | Point géolocalisé | état 2023 | rare | https://data.metropole-rouen-normandie.fr/explore/assets/reseau-de-decheteries-metropole-rouen-normandie/ | **V** |
| 4 | — | Jours / calendrier de collecte OM par commune | **Non trouvé** sur le portail. L'information existe sous forme de « Guide des déchets 2026 » PDF par commune sur www.metropole-rouen-normandie.fr (collecte OM 1 à 2×/sem, jusqu'à 7× dans certains quartiers de Rouen, Grand-Quevilly, Elbeuf). | commune / secteur | 2026 | annuelle | https://www.metropole-rouen-normandie.fr/jeter-mes-dechets/ramassage-des-poubelles | **?** (aucun dataset vu — probablement absent en open data) |
| 5 | — | Composteurs partagés / déchets alimentaires / encombrants | **Non trouvé** en dataset ; page éditoriale « déchets alimentaires » sur le site institutionnel. | — | — | — | https://www.metropole-rouen-normandie.fr/les-dechets-alimentaires | **?** (aucun dataset vu) |

### 2.2 Environnement, énergie, climat

| # | Identifiant | Titre | Description courte | Granularité | Période | MAJ | URL | Cert. |
|---|---|---|---|---|---|---|---|---|
| 6 | `emissions-de-gaz-a-effet-de-serre-annuelles` | Émissions de GES annuelles | Évolution des GES de la MRN par secteur d'activité, source **ORECAN**, périmètre EPCI au 1/1/2021. | EPCI × année × secteur | **2005, 2008, 2010, 2012, 2014, 2015, 2018, 2019** | pluriannuelle | https://data.metropole-rouen-normandie.fr/explore/dataset/emissions-de-gaz-a-effet-de-serre-annuelles/ | **V** |
| 7 | `renouvellement_flotte_mrn` | Part des véhicules à faibles émissions dans le renouvellement de la flotte MRN | Suivi annuel d'un objectif du **PCAET** (adopté déc. 2019). Export CSV v2.1 vu. | Année | n.d. | annuelle | https://data.metropole-rouen-normandie.fr/explore/dataset/renouvellement_flotte_mrn/ | **V** |
| 8 | `conso_eau` | Production et distribution d'eau potable | **Consommation d'énergie mensuelle** par type d'usage du service eau (production, bureaux, réservoirs, stations de pompage). | Mois × usage | n.d. | mensuelle | https://data.metropole-rouen-normandie.fr/explore/dataset/conso_eau/ | **V** |
| 9 | `zfe-m-metropole-rouen-normandie` | ZFE-m Métropole Rouen Normandie | Périmètre de la Zone à Faibles Émissions mobilité (en vigueur 1/9/2022, 13 communes : Amfreville-la-Mi-Voie, Bihorel, Bois-Guillaume, Bonsecours, Darnétal, Déville, Grand-Quevilly, Le Mesnil-Esnard, Notre-Dame-de-Bondeville, Petit-Quevilly, Rouen, Saint-Léger-du-Bourg-Denis, Sotteville). **Utile SOLIDATA : contraintes de circulation des utilitaires.** | Polygone | 2022– | à chaque évolution | https://data.metropole-rouen-normandie.fr/explore/dataset/zfe-m-metropole-rouen-normandie/ | **V** |
| 10 | `canalisation-des-reseaux-de-chaleur-metropole-rouen-normandie-2022` | Canalisations des réseaux de chaleur – 2022 | Tracé des réseaux de chaleur. | Linéaire | 2022 | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/canalisation-des-reseaux-de-chaleur-metropole-rouen-normandie-2022/ | **V** |
| 11 | `perimetre-de-classement-et-de-dsp-des-reseaux-de-chaleur-metropole-rouen-normand` | Périmètre de classement et de DSP des réseaux de chaleur | Zones de classement / délégation. | Polygone | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/perimetre-de-classement-et-de-dsp-des-reseaux-de-chaleur-metropole-rouen-normand/ | **V** |
| 12 | `arbres-remarquables-metropole-rouen-normandie-2019` | Arbres remarquables – 2019 | Inventaire des arbres remarquables des forêts domaniales. | Point | 2019 | ponctuelle | https://data.metropole-rouen-normandie.fr/explore/dataset/arbres-remarquables-metropole-rouen-normandie-2019/ | **V** |
| 13 | `mode-doccupation-des-sols-mos-metropole-rouen-normandie` | Mode d'Occupation des Sols (MOS) | Occupation du sol du territoire. | Polygone | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/mode-doccupation-des-sols-mos-metropole-rouen-normandie/ | **V** |
| 14 | — | Qualité de l'air (mesures), bruit, PCAET détaillé | **Aucun dataset de mesures** trouvé sur le portail ; les données air sont chez **Atmo Normandie** (cf. §3) et, agrégées par EPCI, sur datanormandie.fr (DREAL). | — | — | — | — | **?** (absent, sources externes) |

### 2.3 Mobilité, voirie, transports

| # | Identifiant | Titre | Description courte | Granularité | Période | MAJ | URL | Cert. |
|---|---|---|---|---|---|---|---|---|
| 15 | `travaux-json` | Informations travaux | Chantiers causant des **perturbations majeures sur les axes structurants** (source trafic-metropole-rouen.fr). **Utile SOLIDATA : contraintes de tournées.** | Point/linéaire, événement | courant | continue (supposé) | https://data.metropole-rouen-normandie.fr/explore/assets/travaux-json/ | **V** |
| 16 | `comptages-et-enquetes-sur-le-reseau-routier` | Comptages et enquêtes sur le réseau routier | Campagnes de comptages et enquêtes par tronçon (véhicules, dont comptages vélo permanents). | Tronçon × campagne | n.d. | par campagne | https://data.metropole-rouen-normandie.fr/explore/dataset/comptages-et-enquetes-sur-le-reseau-routier/ | **V** |
| 17 | `filaire-de-voies-metropolitain-par-troncons` | Filaire de voies métropolitain par tronçons | Référentiel des voies (tronçons). **Utile SOLIDATA : nommage/rattachement des CAV à une voie.** | Linéaire | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/assets/filaire-de-voies-metropolitain-par-troncons/api/ | **V** |
| 18 | `zones-apaisees-metropole-rouen-normandie` | Zones apaisées | Zones 30 / de rencontre (interprétation). | Polygone | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/zones-apaisees-metropole-rouen-normandie/ | **V** |
| 19 | `zones-pietonnes-rouen` | Zones piétonnes – Rouen | Zones piétonnes de la ville de Rouen. **Utile : accès camion restreint.** | Polygone | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/assets/zones-pietonnes-rouen/ | **V** |
| 20 | `amenagements-cyclables-metropole-rouen-normandie` | Aménagements cyclables | Liste des aménagements cyclables existants (aussi sur data.gouv.fr). | Linéaire | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/amenagements-cyclables-metropole-rouen-normandie/ | **V** |
| 21 | `eco-counter-sites` | Comptage vélo : localisation des sites de comptage | Sites des compteurs permanents. | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/eco-counter-sites/ | **V** |
| 22 | `eco-counter-data` | Comptage vélo : données horaires | Comptages horaires par capteur. | Heure × capteur | n.d. | continue | https://data.metropole-rouen-normandie.fr/explore/dataset/eco-counter-data/ | **V** |
| 23 | `eco-counter-data-day` (et variante `eco-counter-data_day`) | Comptage vélo : données journalières | Comptages journaliers par capteur. Piétons/trottinettes « à venir ». | Jour × capteur | n.d. | quotidienne | https://data.metropole-rouen-normandie.fr/explore/dataset/eco-counter-data-day/ | **V** |
| 24 | `rouen_flux-pietons_vd` | Flux piétons de la Ville de Rouen | Données **mensuelles** de circulation piétonne du centre historique. | Mois × site | n.d. | mensuelle | https://data.metropole-rouen-normandie.fr/explore/dataset/rouen_flux-pietons_vd/ | **V** |
| 25 | `liste-des-arrets-du-reseau-astuce-metropole-rouen-normandie` | Liste des arrêts du réseau Astuce | Arrêts du réseau urbain. | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/liste-des-arrets-du-reseau-astuce-metropole-rouen-normandie/ | **V** |
| 26 | `trace-des-lignes-regulieres-du-reseau-astuce-metropole-rouen-normandie` | Tracé des lignes régulières Astuce | Tracés des lignes. | Linéaire | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/trace-des-lignes-regulieres-du-reseau-astuce-metropole-rouen-normandie/ | **V** |
| 27 | `trace-des-lignes-scolaires-du-reseau-astuce-metropole-rouen-normandie` | Tracé des lignes scolaires Astuce | Tracés des lignes scolaires. | Linéaire | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/trace-des-lignes-scolaires-du-reseau-astuce-metropole-rouen-normandie/ | **V** |
| 28 | `zones-de-transport-a-la-demande-du-reseau-astuce-metropole-rouen-normandie` | Zones de transport à la demande Astuce | Zones TAD (aussi data.gouv.fr). | Polygone | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/assets/zones-de-transport-a-la-demande-du-reseau-astuce-metropole-rouen-normandie/ | **V** |
| 29 | `donnees-statiques-et-temps-reel-du-service-de-vls-lovelo-metropole-rouen-normand` | Ensemble des données GBFS du service Lovélo | Stations et disponibilité temps réel (GBFS JSON) ; relayé sur transport.data.gouv.fr. | Point, temps réel | courant | temps réel | https://data.metropole-rouen-normandie.fr/explore/dataset/donnees-statiques-et-temps-reel-du-service-de-vls-lovelo-metropole-rouen-normand/ | **V** |
| 30 | `lovelo-stations-formation-ods` | Informations sur les stations vélos Lovélo | Id, nom, capacité, position, disponibilité (jeu de formation ODS). | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/assets/lovelo-stations-formation-ods/ | **V** |
| 31 | `aires-de-covoiturage-metropole-rouen-normandie` | Aires de covoiturage | Aires gérées par la MRN (aussi data.gouv.fr). | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/aires-de-covoiturage-metropole-rouen-normandie/ | **V** |
| 32 | `stations-de-taxis-metropole-rouen-normandie` | Stations de taxis | Localisation des stations. | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/assets/stations-de-taxis-metropole-rouen-normandie/ | **V** |
| 33 | `parkings-en-ouvrage-metropole-rouen-normandie` | Parkings en ouvrage | Parkings gérés par la MRN. | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/assets/parkings-en-ouvrage-metropole-rouen-normandie/ | **V** |
| 34 | `parkings-relais-metropole-rouen-normandie` | Parkings relais | P+R du territoire. | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/parkings-relais-metropole-rouen-normandie/ | **V** |
| 35 | `liste-des-stationnements-pmr-metropole-rouen-normandie` | Stationnements PMR | Places PMR du territoire métropolitain. | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/liste-des-stationnements-pmr-metropole-rouen-normandie/ | **V** |
| 36 | `bornes-irve-metropole-rouen-normandie` | Bornes IRVE | Bornes de recharge gérées par la MRN (identification + géoloc). | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/bornes-irve-metropole-rouen-normandie/ | **V** |
| 37 | (data.gouv / transport.data.gouv) | Données statiques et temps réel du réseau Astuce (GTFS + GTFS-RT) | Flux GTFS/GTFS-RT du réseau urbain ; variante « lignes 26 et 530 temps réel » ; variante GTFS seul. Non vus sur le portail ODS lui-même. | Réseau | courant | continue | https://transport.data.gouv.fr/datasets/donnees-statiques-et-temps-reel-du-reseau-astuce-metropole-rouen-normandie | **S** |
| 38 | (data.gouv) `comptage-des-mobilites-metropole-rouen-normandie` | Comptage des mobilités – fichier « site » du schéma national | Localisation des compteurs de mobilités douces (schéma national). Probablement dérivé de `eco-counter-sites`. | Point | n.d. | n.d. | https://www.data.gouv.fr/datasets/comptage-des-mobilites-metropole-rouen-normandie | **S** |
| 39 | — | Limitations de vitesse, sens de circulation, feux | **Non trouvés** sur le portail. | — | — | — | — | **?** (absent) |

### 2.4 Urbanisme, cadastre, risques, territoire

| # | Identifiant | Titre | Description courte | Granularité | Période | MAJ | URL | Cert. |
|---|---|---|---|---|---|---|---|---|
| 40 | `cadastre-communes-metropole-rouen-normandie-sage-cailly-aubette-robec` | Cadastre – Communes (MRN / SAGE Cailly-Aubette-Robec) | **Limites communales** (source cadastre DGFiP) — réponse au besoin « limites communales / EPCI ». | Polygone commune | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/cadastre-communes-metropole-rouen-normandie-sage-cailly-aubette-robec/ | **V** |
| 41 | `cadastre-parcelles-cadastrales-metropole-rouen-normandie-sage-cailly-aubette-rob` | Cadastre – Parcelles | Parcelles cadastrales. | Polygone | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/assets/cadastre-parcelles-cadastrales-metropole-rouen-normandie-sage-cailly-aubette-rob/ | **V** |
| 42 | `cadastre-batiments-metropole-rouen-normandie-sage-cailly-aubette-robec` | Cadastre – Bâtiments | Constructions en dur (définition DGFiP). | Polygone | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/cadastre-batiments-metropole-rouen-normandie-sage-cailly-aubette-robec/ | **V** |
| 43 | `cadastre-lieux-dits-metropole-rouen-normandie-sage-cailly-aubette-robec` | Cadastre – Lieux-dits | Toponymes cadastraux. | Polygone/point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/cadastre-lieux-dits-metropole-rouen-normandie-sage-cailly-aubette-robec/ | **V** |
| 44 | `cadastre-hydrographie-metropole-rouen-normandie-sage-cailly-aubette-robec` | Cadastre – Hydrographie | Cours d'eau et surfaces en eau. | Polygone | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/cadastre-hydrographie-metropole-rouen-normandie-sage-cailly-aubette-robec/ | **V** |
| 45 | `cadastreplu-table-graphique-des-zonages-metropole-rouen-normandie` | PLU – Zonage | Zonage du PLU métropolitain en vigueur. | Polygone | courant | à chaque modification PLU | https://data.metropole-rouen-normandie.fr/explore/dataset/cadastreplu-table-graphique-des-zonages-metropole-rouen-normandie/ | **V** |
| 46 | `cadastreplu-table-graphique-des-prescriptions-lineaires-metropole-rouen-normandi` | PLU – Prescriptions linéaires | Prescriptions linéaires du PLU. | Linéaire | courant | idem | https://data.metropole-rouen-normandie.fr/explore/dataset/cadastreplu-table-graphique-des-prescriptions-lineaires-metropole-rouen-normandi/ | **V** |
| 47 | `cadastreplu-table-graphique-des-prescriptions-surfaciques-metropole-rouen-norman` | PLU – Prescriptions surfaciques | Prescriptions surfaciques du PLU. | Polygone | courant | idem | https://data.metropole-rouen-normandie.fr/explore/dataset/cadastreplu-table-graphique-des-prescriptions-surfaciques-metropole-rouen-norman/ | **V** |
| 48 | `plan-local-d-urbanisme-tableau-d-assemblage-des-plans-par-commune` | PLU – Tableau d'assemblage des plans par commune | Index des planches par commune. | Commune | courant | idem | https://data.metropole-rouen-normandie.fr/explore/assets/plan-local-d-urbanisme-tableau-d-assemblage-des-plans-par-commune/ | **V** |
| 49 | `donnees-complementaires-au-plu` | Cités jardins – MRN | Cités-jardins du territoire (données complémentaires au PLU). | Polygone | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/donnees-complementaires-au-plu/ | **V** |
| 50 | `donmeturb_cav_indice_pct` | Cavités souterraines – Indices ponctuels | Indices de cavités (risque). | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/donmeturb_cav_indice_pct/ | **V** |
| 51 | `cavites-souterraines-indices-lineaires-metropole-rouen-normandie` | Cavités – Indices linéaires | idem, linéaires. | Linéaire | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/cavites-souterraines-indices-lineaires-metropole-rouen-normandie/ | **V** |
| 52 | `cavites-souterraines-indices-surfaciques-metropole-rouen-normandie` | Cavités – Indices surfaciques | idem, surfaciques. | Polygone | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/cavites-souterraines-indices-surfaciques-metropole-rouen-normandie/ | **V** |
| 53 | `cavites-souterraines-zones-de-risques-metropole-rouen-normandie` | Cavités – Zones de risques | Zones de risque cavités. | Polygone | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/cavites-souterraines-zones-de-risques-metropole-rouen-normandie/ | **V** |
| 54 | `rouen-perimetre-preemption-commerciale` | Rouen – Périmètre de préemption commerciale | Périmètre de sauvegarde du commerce (Ville de Rouen). | Polygone | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/rouen-perimetre-preemption-commerciale/ | **V** |
| 55 | (data.gouv, éditeur probable **Département 76**) `tblint-carte-rouen-normandie-metropole-avec-adresses-limites-iris-cms-cantons-2022-2024`, `adresses-rouen-metropole-fev2024`, `carte-rouen-normandie-metropole-avec-adresses-et-perimetres-socio-politiques-2022-2024-v2` | Cartes interactives adresses + IRIS + communes + EPCI + cantons + CMS | Adresses (BAN) et périmètres administratifs/sociaux 2022-2024 sur le périmètre MRN. Construits avec INSEE, IGN, BAN, CD76 ; publiés via opendata76 (ArcGIS Hub). **Utile SOLIDATA : rattachement CAV → IRIS/QPV.** | Adresse / IRIS | 2022-2024 | annuelle | https://www.data.gouv.fr/datasets/tblint-carte-rouen-normandie-metropole-avec-adresses-limites-iris-cms-cantons-2022-2024 | **S** (éditeur à confirmer) |
| 56 | — | Population INSEE, IRIS, QPV, logements, revenus sur le portail MRN | **Non trouvés** sur le portail. QPV : 16 quartiers dans 14 communes, 47 800 hab (10 %) — source INSEE Dossier Normandie n°14 (2019) et sig.ville.gouv.fr (contrat de ville CVN284, liste 2024). | — | — | — | — | **?** (absent ; sources externes §3) |
| 57 | — | Orthophotos | **Non trouvées** en dataset ODS (les rasters passent rarement par ODS ; à chercher côté flux WMS/WMTS Isogeo ou IGN). | — | — | — | — | **?** |

### 2.5 Économie, emploi, insertion, ESS, achats

| # | Identifiant | Titre | Description courte | Granularité | Période | MAJ | URL | Cert. |
|---|---|---|---|---|---|---|---|---|
| 58 | `spaser-12012024` | Données du SPASER de la MRN | Indicateurs du **Schéma de promotion des achats publics socialement et écologiquement responsables** (adopté juil. 2021) : marchés notifiés > 90 k€ HT, clauses sociales/insertion, accès PME locales. **Utile : la MRN comme donneur d'ordre pour l'IAE.** | Marché / année | 2021– (extrait 12/01/2024) | annuelle (supposé) | https://data.metropole-rouen-normandie.fr/explore/assets/spaser-12012024/ | **V** |
| 59 | `lieux-d-inclusion-numerique` | Lieux d'inclusion numérique de la MRN | Lieux d'accompagnement numérique, articulé avec **DORA** (référentiel national des services d'insertion). | Point | courant | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/lieux-d-inclusion-numerique/ | **V** |
| 60 | `repertoire-national-des-associations-metropole-rouen-normandie` | Répertoire National des Associations – MRN | Extrait du RNA (associations loi 1901 dont le siège est sur le territoire ; mention de l'EPCI). **Utile : recensement des associations partenaires de collecte.** | Association | courant | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/repertoire-national-des-associations-metropole-rouen-normandie/ | **V** |
| 61 | — | SIAE, chômage, zones d'activité, entreprises, ESS, ressourceries/recycleries | **Aucun dataset dédié trouvé** sur le portail (le RNA et le SPASER sont les seuls proxys). Sources externes : ADEME « Longue vie aux objets », INSEE, France Travail. | — | — | — | — | **?** (absent) |

### 2.6 Habitat, équipements, éducation, santé

| # | Identifiant | Titre | Description courte | Granularité | Période | MAJ | URL | Cert. |
|---|---|---|---|---|---|---|---|---|
| 62 | `residences-sociales-metropole-rouen-normandie` | Résidences sociales – MRN | Recensement des résidences sociales. | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/assets/residences-sociales-metropole-rouen-normandie/ | **V** |
| 63 | `residences-seniors-metropole-rouen-normandie` | Résidences séniors | Recensement des logements en résidence sénior. | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/residences-seniors-metropole-rouen-normandie/ | **V** |
| 64 | `residences-jeunes-metropole-rouen-normandie` | Résidences jeunes | Recensement des logements en résidence jeunes. | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/residences-jeunes-metropole-rouen-normandie/ | **V** |
| 65 | `residences-etudiants-metropole-rouen-normandie` | Logements en résidence étudiante | Recensement des logements étudiants. | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/residences-etudiants-metropole-rouen-normandie/ | **V** |
| 66 | `salles-et-equipements-culturels` | Salles et équipements culturels | Équipements culturels des communes. | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/salles-et-equipements-culturels/ | **V** |
| 67 | `effectifs-scolaires-par-etablissement-maternel-et-elementaire` | Effectifs scolaires maternel/élémentaire (Saint-Aubin-lès-Elbeuf) | Effectifs par établissement — jeu communal. | Établissement × année | n.d. | annuelle | https://data.metropole-rouen-normandie.fr/explore/dataset/effectifs-scolaires-par-etablissement-maternel-et-elementaire/ | **V** |
| 68 | `ecoles-publiques-dlr` | Écoles publiques – Déville-lès-Rouen | Écoles publiques de la commune. | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/ecoles-publiques-dlr/ | **V** |
| 69 | `dae-grand-quevilly-export-geo-dae` | Défibrillateurs (DAE) – Grand-Quevilly | DAE accessibles au public et en bâtiments municipaux (export Géo'DAE). | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/dae-grand-quevilly-export-geo-dae/ | **V** |
| 70 | `boites-a-lire-et-boites-a-dons-rouen` | Boîtes à lire et boîtes à dons – Rouen | **Boîtes à dons** (réemploi de proximité) et boîtes à lire de la Ville de Rouen. **Intérêt réemploi/ESS.** | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/boites-a-lire-et-boites-a-dons-rouen/ | **V** |

### 2.7 Citoyenneté, transparence, agenda, patrimoine

| # | Identifiant | Titre | Description courte | Granularité | Période | MAJ | URL | Cert. |
|---|---|---|---|---|---|---|---|---|
| 71 | `indemnites-des-elus` | Indemnités des élus de la MRN | Indemnités perçues (état 2021 vu). | Élu × année | 2021 (au moins) | annuelle | https://data.metropole-rouen-normandie.fr/explore/dataset/indemnites-des-elus/ | **V** |
| 72 | `dix-plus-hautes-remunerations` | Dix plus hautes rémunérations de la MRN | Publication légale annuelle. | Année | n.d. | annuelle | https://data.metropole-rouen-normandie.fr/explore/dataset/dix-plus-hautes-remunerations/ | **V** |
| 73 | `elus-conseil-municipal-dlr` | Liste des élus du conseil municipal – Déville-lès-Rouen | Jeu communal. | Élu | mandat 2020-2026 (supposé) | par mandat | https://data.metropole-rouen-normandie.fr/explore/dataset/elus-conseil-municipal-dlr/ | **V** |
| 74 | `agenda-metropole-rouen-normandie` | Agenda de la MRN | Événements publics du territoire. | Événement | courant | continue | https://data.metropole-rouen-normandie.fr/explore/dataset/agenda-metropole-rouen-normandie/ | **V** |
| 75 | `registre-des-traitements-rgpd` | Registre des traitements RGPD – Ville de Rouen, CCAS, MRN | Liste des traitements de données personnelles. | Traitement | courant | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/registre-des-traitements-rgpd/ | **V** |
| 76 | `ris-rouen-pour-opendata` | Panneaux d'information sur le patrimoine de Rouen | Panneaux RIS « Cœur de Métropole » (2018–), avec pièces jointes via `/files/`. | Point | 2018– | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/ris-rouen-pour-opendata/ | **V** |
| 77 | `ris-elbeuf` | Panneaux d'information sur le patrimoine d'Elbeuf | Idem Elbeuf (PDF joints). | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/ris-elbeuf/ | **V** |
| 78 | `parcours-de-randonnee-metropole-rouen-normandie` | Parcours de randonnée | Saisie par le service Tourisme, aussi diffusée sur Cirkwi. | Linéaire | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/assets/parcours-de-randonnee-metropole-rouen-normandie/ | **V** |
| 79 | `stationnements-gratuits-publics-dlr` | Stationnements gratuits publics – Déville-lès-Rouen | Jeu communal. | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/stationnements-gratuits-publics-dlr/ | **V** |
| 80 | `places-pmr-dlr` | Places de parking PMR – Déville-lès-Rouen | Jeu communal. | Point | n.d. | n.d. | https://data.metropole-rouen-normandie.fr/explore/dataset/places-pmr-dlr/ | **V** |
| 81 | — | Budget, compte administratif, subventions aux associations, délibérations, données essentielles des marchés | **Non trouvés** sur le portail (seuls SPASER, indemnités et rémunérations sont visibles). Les données essentielles de la commande publique sont en principe sur data.gouv.fr (DECP) ; à vérifier en phase 2. | — | — | — | — | **?** (absent) |

**Bilan du tableau** : 70 lignes Vérifiées (identifiants distincts vus, en comptant chaque jeu cadastre/PLU/cavités/résidences séparément), 3 Signalées (GTFS Astuce, comptage des mobilités, cartes adresses/IRIS du CD76), 8 « Supposé/absent » documentant des besoins sans dataset trouvé.

---

## 3. Sources complémentaires hors portail

| Source | Contenu utile pour Solidarité Textiles | URL | Accessibilité depuis cet environnement |
|---|---|---|---|
| **INSEE – API Données locales** | Population, logements, revenus (Filosofi), emploi/chômage par commune, IRIS, EPCI (cubes prédéfinis : RP, état civil, SIRENE, FLORES…). Nécessite une clé api.insee.fr. | https://api.insee.fr (catalogue : https://www.insee.fr/fr/information/8184146 ; données locales : https://www.insee.fr/fr/information/3544265) | **Bloqué** (insee.fr testé) — à faire depuis le serveur de production |
| **INSEE – Dossier complet par territoire** | Fiches communes / EPCI 200023414 téléchargeables (CSV/XLS). | https://www.insee.fr/fr/statistiques/zones/2011101 | Bloqué (non testé directement, même hôte) |
| **INSEE – Diagnostic social infra-urbain et QPV de la MRN** (Dossier Normandie n°14, 2019) | 16 QPV, 47 800 hab, indicateurs pauvreté/jeunesse/emploi par quartier. | https://www.insee.fr/fr/statistiques/4178620 | Bloqué |
| **INSEE Analyses Normandie n°142** | « La moitié des 2 Mt de DMA valorisée en Normandie » — cadrage régional déchets. | https://www.insee.fr/fr/statistiques/8570042 | Bloqué |
| **SIG Ville – Contrat de ville MRN (CVN284)** | Liste et périmètres des 16 QPV 2024. | https://sig.ville.gouv.fr/territoire/CVN284 | **Bloqué** (testé) |
| **geo.data.gouv.fr – QPV Normandie 2017** / **data.normandie.education.gouv.fr – QPV** | Contours QPV (GeoJSON). | https://geo.data.gouv.fr/en/datasets/3880c4359754b3d8b2928e4b15e78902aca411c3 ; https://data.normandie.education.gouv.fr/explore/dataset/quartiers-prioritaires-de-la-politique-de-la-ville-qpv/ | Non testé (data.gouv bloqué ; portail ODS académique non testé) |
| **geo.api.gouv.fr** | Communes de l'EPCI 200023414 (nom, code INSEE, population, centre, contour) — **déjà utilisé par SOLIDATA** (`/communes/refresh-metropole`). | https://geo.api.gouv.fr/epcis/200023414/communes | **Bloqué ici** (testé) ; fonctionne en production |
| **BAN – adresse.data.gouv.fr** | Géocodage / reverse, export par commune (`api-adresse.data.gouv.fr/search`), déjà utilisé par `services/geocodage.js`. | https://adresse.data.gouv.fr/api-doc/adresse | Non testé ici ; fonctionne en production |
| **SINOE® (ADEME)** | Tonnages DMA par collectivité et type de déchet (dont **TLC**), performances de collecte, destinations de traitement ; années impaires depuis 2009 (enquête Collecte). Nouveau portail dédié depuis 2025. | https://data.sinoe-dechets.ademe.fr/ ; https://data.ademe.fr/datasets/sinoe-(r)-tonnage-dma-par-type-de-dechet ; https://www.sinoe.org/toutsavoir | Non testé (API Data Fair `data.ademe.fr/data-fair/api/v1/datasets/<id>/lines`) |
| **Refashion – « Textiles collectés par la filière REP »** (data.gouv.fr) | Kilos de TLC collectés par la filière, déclinés par territoire (extrait indexé : région Hauts-de-France ; granularité nationale à vérifier). Refashion gère 42 370 points de collecte ; FAQ « tonnage collecté sur mon territoire ». | https://www.data.gouv.fr/datasets/textiles-collectes-par-la-filiere-rep ; https://faq.refashion.fr/hc/fr/articles/7840485312285 | data.gouv bloqué ; refashion.fr non testé |
| **Refashion – cartographies** (pro) | Carte des points de collecte, des centres de tri et exutoires (pas d'API publique identifiée). | https://pro.refashion.fr/collectivites/les-cartographies-du-recyclage | Non testé |
| **ADEME – « Longue vie aux objets » (acteurs de l'économie circulaire)** | Base ouverte (LO 2.0) des lieux de réemploi/réparation/tri par catégorie d'objet (dont vêtements) : ressourceries, recycleries, associations, **points de collecte des éco-organismes** centralisés depuis 2023. **Meilleure source nationale pour recycleries/bornes textiles hors MRN.** | https://data.ademe.fr/datasets/longue-vie-aux-objets-acteurs-de-leconomie-circulaire ; https://longuevieauxobjets.ademe.fr/base-de-donnees-ouvertes/ | Non testé |
| **Atmo Normandie – open data** | Mesures qualité de l'air (PM10, PM2.5, NO2, O3…) stations Rouen, indices ATMO, épisodes de pollution ; API dédiée. Plateforme nationale **Atmo Data** en relais. | https://api.atmonormandie.fr/ ; https://www.atmonormandie.fr/service/opendata | Non testé |
| **datanormandie.fr (DREAL)** | Indicateurs qualité de l'air agrégés par EPCI. | https://www.datanormandie.fr/visualisation?id=5a88b5e2-ebb5-4989-823b-48ccd964ed78 | Non testé |
| **Open Data 76 (Département Seine-Maritime, ArcGIS Hub, LO)** | Cartes adresses/IRIS/cantons/CMS (cf. ligne 55), cavités, sites inscrits, données sociales départementales. | https://www.opendata76.fr/ ; https://open-data-seine-maritime.hub.arcgis.com/ | Non testé |
| **transport.data.gouv.fr – EPCI 200023414** | GTFS/GTFS-RT Astuce, GBFS Lovélo, ZFE. | https://transport.data.gouv.fr/datasets/epci/200023414 | **Bloqué** (testé) |
| **trafic-metropole-rouen.fr** | Carte des chantiers en cours (source du jeu `travaux-json`). | https://www.trafic-metropole-rouen.fr/ | Non testé |
| **Rapports annuels déchets MRN (PDF)** | Chiffres clés annuels (2023 : 554/549/608/562 kg/hab par secteur, 129 660 t OM), RPQS. | https://www.metropole-rouen-normandie.fr/sites/default/files/2024-09/Synthese-du-rapport-annuel-Dechets-2023.pdf | **Bloqué** (hôte testé) |
| **files.opendatarchives.fr** (miroir communautaire) | Archive complète des exports CSV/GeoJSON du portail MRN, dernière archive 26/08/2026 — permet de lister **tous** les identifiants sans passer par l'API. | http://files.opendatarchives.fr/data.metropole-rouen-normandie.fr/ | **Bloqué** (testé) |
| **data.europa.eu** | Fiches DCAT des jeux MRN moissonnés (licence, formats, dates). | https://data.europa.eu/data/datasets?query=m%C3%A9tropole%20rouen%20normandie | **Bloqué** (testé) |
| **Open-Meteo** | Météo/prévisions — **déjà intégré** (`utils/weather.js`). | https://open-meteo.com | Utilisé en production |

---

## 4. Limites de cet inventaire et plan de phase 2

### 4.1 Ce que le blocage réseau n'a pas permis de vérifier
- **Aucun schéma de champs** n'a été lu : pour `donmetdec_pav`, on sait seulement qu'un champ distingue les flux (OM / recyclables / verre / **textile**) — le nom exact du champ, la présence d'un identifiant de borne, de l'adresse, de la commune, du gestionnaire (Le Relais ? Solidarité Textiles ?) ou du nombre de colonnes est **inconnu**.
- **Aucune volumétrie** (nombre d'enregistrements) ; seule la taille des fichiers data.gouv est connue pour 2 jeux (PAV : CSV 670 Ko ≈ plusieurs milliers de points tous flux confondus ; déchèteries : 3,4 Ko ≈ 15-20 lignes).
- **Fraîcheur** : connue pour 2 jeux via data.gouv (PAV 14/06/2026, déchèteries 07/03/2023) ; inconnue ailleurs. Les champs `data_processed`, `metadata_processed` et `modified` du catalogue diront tout.
- **Nombre total de jeux** du portail et **licence par jeu** : à lire dans `/api/explore/v2.1/catalog/datasets`.
- **Existence réelle des jeux non trouvés** (jours de collecte, compostage, orthophotos, budget, subventions, SIAE, population) : une recherche indexée négative n'est pas une preuve d'absence ; la requête catalogue avec `where` textuel tranchera.
- Les jeux `assets/…` vs `dataset/…` : hypothèse que le même `dataset_id` est servi par l'API dans les deux cas.
- Le **périmètre du jeu `quantite-de-dechets`** (le textile y figure-t-il comme type ? les PAV textiles étant pour la plupart exploités par des opérateurs privés/ESS et non par la régie, le tonnage textile peut être absent ou partiel) — c'est LA question clé pour SOLIDATA.

### 4.2 Requêtes API exactes à exécuter en phase 2 (depuis un hôte non filtré, ex. le serveur de production)

```bash
BASE=https://data.metropole-rouen-normandie.fr/api/explore/v2.1

# 1. Catalogue complet (paginer par 100 ; noter total_count, dataset_id, metas.default.{title,license,modified,records_count,theme,keyword})
curl -s "$BASE/catalog/datasets?limit=100&offset=0&select=dataset_id,metas" | jq '.total_count, [.results[] | {id:.dataset_id, t:.metas.default.title, n:.metas.default.records_count, lic:.metas.default.license, mod:.metas.default.modified}]'
curl -s "$BASE/catalog/datasets?limit=100&offset=100"

# 2. Export catalogue en CSV (une ligne par jeu, tous les métas)
curl -s "$BASE/catalog/exports/csv" -o catalogue-mrn.csv

# 3. Recherche plein texte dans le catalogue pour lever les doutes de §2
for q in textile collecte compost calendrier population orthophoto budget subvention insertion association recyclerie; do
  echo "== $q"; curl -s "$BASE/catalog/datasets?where=%22$q%22&limit=50&select=dataset_id" | jq -r '.results[].dataset_id'
done

# 4. Schéma + métadonnées d'un jeu (champs, types, licence, fréquence)
curl -s "$BASE/catalog/datasets/donmetdec_pav" | jq '{fields:[.fields[]|{name,type,label}], metas:.metas.default}'
curl -s "$BASE/catalog/datasets/quantite-de-dechets" | jq '{fields:[.fields[]|{name,type,label}], metas:.metas.default}'
curl -s "$BASE/catalog/datasets/reseau-de-decheteries-metropole-rouen-normandie" | jq '.fields'

# 5. Distribution des valeurs du champ « flux » des PAV (remplacer <champ_flux> après lecture du schéma), pour isoler le textile
curl -s "$BASE/catalog/datasets/donmetdec_pav/records?select=<champ_flux>,count(*)&group_by=<champ_flux>"
curl -s "$BASE/catalog/datasets/donmetdec_pav/records?where=search(%22textile%22)&limit=100"

# 6. Export GeoJSON complet des PAV (pour rapprochement avec la table cav de SOLIDATA par distance)
curl -s "$BASE/catalog/datasets/donmetdec_pav/exports/geojson" -o pav-mrn.geojson
curl -s "$BASE/catalog/datasets/donmetdec_pav/exports/csv?use_labels=false&delimiter=%3B" -o pav-mrn.csv

# 7. Tonnages : années et types disponibles
curl -s "$BASE/catalog/datasets/quantite-de-dechets/records?limit=100&order_by=-annee"   # ajuster le nom du champ année après lecture du schéma
curl -s "$BASE/catalog/datasets/quantite-de-dechets/exports/csv?use_labels=true" -o tonnages-mrn.csv

# 8. Jeux de contexte pour les tournées
curl -s "$BASE/catalog/datasets/travaux-json/records?limit=100"
curl -s "$BASE/catalog/datasets/zfe-m-metropole-rouen-normandie/exports/geojson" -o zfe.geojson
curl -s "$BASE/catalog/datasets/zones-pietonnes-rouen/exports/geojson" -o zones-pietonnes.geojson
curl -s "$BASE/catalog/datasets/cadastre-communes-metropole-rouen-normandie-sage-cailly-aubette-robec/exports/geojson" -o communes-mrn.geojson
curl -s "$BASE/catalog/datasets/filaire-de-voies-metropolitain-par-troncons/exports/geojson" -o filaire-voies.geojson

# 9. Fraîcheur : dates de traitement de tous les jeux
curl -s "$BASE/catalog/datasets?limit=100&select=dataset_id,metas.default.data_processed,metas.default.modified"

# 10. Sources externes à sonder dans la foulée
curl -s "https://geo.api.gouv.fr/epcis/200023414/communes?fields=nom,code,population&format=json" | jq length
curl -s "https://www.data.gouv.fr/api/1/organizations/metropole-rouen-normandie/datasets/?page_size=50" | jq '.total, [.data[].title]'
curl -s "https://www.data.gouv.fr/api/1/datasets/?q=textiles%20collect%C3%A9s%20fili%C3%A8re%20REP" | jq '.data[0] | {title, resources:[.resources[].url]}'
curl -s "https://data.ademe.fr/data-fair/api/v1/datasets/longue-vie-aux-objets-acteurs-de-leconomie-circulaire/lines?q=Rouen&size=50"
curl -s "https://api.atmonormandie.fr/" -I
```

### 4.3 Recommandations d'intégration pour SOLIDATA (à instruire après phase 2)
1. **`donmetdec_pav` (flux textile)** → rapprochement géographique avec la table `cav` (209 bornes) : détecter les bornes de la Métropole absentes de SOLIDATA et inversement, alimenter `cav.code_insee_commune` et le reporting Métropole (`/metropole/service-cav`).
2. **`quantite-de-dechets`** → série de référence pour le module Reporting Métropole (part du textile dans les DMA, comparaison avec `tonnage_history`).
3. **`travaux-json` + `zfe-m` + `zones-pietonnes-rouen` + `zones-apaisees`** → contraintes du moteur de tournées (déjà TomTom trafic ; les chantiers de la Métropole sont une source gratuite et locale).
4. **`cadastre-communes`** → contours communaux pour la captation par commune (aujourd'hui prorata des CAV) ; **cartes IRIS/QPV du CD76** → indicateurs d'insertion territorialisés pour le module RSE / rapport Métropole.
5. **`repertoire-national-des-associations`** → pré-remplissage du référentiel `association_points` (tournées associations).
6. **`spaser`** → veille sur les marchés à clauses d'insertion de la Métropole (débouchés pour la SIAE).

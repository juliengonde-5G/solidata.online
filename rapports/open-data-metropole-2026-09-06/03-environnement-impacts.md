# Environnement & impacts — agrégations SOLIDATA × open data Métropole Rouen Normandie

> Agent thématique « ENVIRONNEMENT & IMPACTS » — chantier de cadrage open data, 6 septembre 2026.
> Sources : `scratchpad/inventaire-catalogue.md` (inventaire du portail, méthode et niveaux de certitude V/S/? détaillés en tête de ce fichier — **le portail est resté bloqué pour cette session**, tout ce qui suit hérite de cette limite), `scratchpad/cartographie-solidata.md`, lecture directe du dépôt (citations `fichier:ligne`), et 3 recherches web complémentaires (ORECAN/DREAL, ZFE-m, bilan environnemental Refashion 2023).

---

## 1. Périmètre et enjeu métier

Solidarité Textiles collecte et valorise le textile sur la Métropole Rouen Normandie et produit déjà deux chiffres environnementaux : le CO2 évité par la valorisation (`backend/src/routes/metropole.js:38-107`, facteurs codés en dur) et les émissions propres de sa propre activité (module Énergie & GES, `ges_facteurs`). Ces deux chiffres restent **globaux et non territorialisés** (un seul total mensuel/annuel), alors que le rapport annuel de collectivité est jugé par les élus par commune et par comparaison avec le reste du territoire (grief documenté : « bilan détourné par déduction, pas de décomposition par filière », `rapports/audits/2026-05-10-audit-metropole-rouen.md`, cité dans `cartographie-solidata.md §8.1`).

L'enjeu de ce chantier est de mettre ce bénéfice environnemental **en regard** de données territoriales publiques (émissions du secteur Déchets de la Métropole, zone à faibles émissions, occupation du sol) sans jamais prétendre à une soustraction ou une causalité que les données ne permettent pas d'établir — et de fiabiliser au passage la source des facteurs CO2 déjà utilisés en interne, qui ne sont aujourd'hui ni millésimés ni tracés comme le sont ceux du module Énergie & GES.

Contrainte structurante à retenir dès maintenant : le seul jeu de GES territorial identifié (`emissions-de-gaz-a-effet-de-serre-annuelles`, ORECAN) est **à la maille EPCI, pas à la maille commune** (colonne « Granularité » de l'inventaire, ligne 6) — une partie des propositions qui suivent ne peuvent donc pas être déclinées par commune malgré la demande, et le dit explicitement plutôt que d'inventer une ventilation.

---

## 2. Jeux de données retenus

| Identifiant | Certitude | Granularité | Fraîcheur connue | Clé de jointure vers SOLIDATA | Usage |
|---|---|---|---|---|---|
| `emissions-de-gaz-a-effet-de-serre-annuelles` (ORECAN) | **V** (URL vue, portail non lu) | EPCI × année × secteur d'activité | Millésimes vus : 2005, 2008, 2010, 2012, 2014, 2015, 2018, **2019** (pluriannuel, pas annuel systématique) | Aucune clé commune — comparaison au niveau EPCI `200023414` uniquement | Mise en regard du CO2 évité SOLIDATA avec le secteur « Déchets » du territoire (P-ENV-01) |
| `renouvellement_flotte_mrn` (PCAET) | **V** (export CSV v2.1 vu) | Année, parc de la Métropole (pas SOLIDATA) | Inconnue | Aucune — sert de **méthode de référence**, pas de source à joindre | Miroir de présentation pour le parc SOLIDATA (P-ENV-06) |
| `zfe-m-metropole-rouen-normandie` | **V** | Polygone, 13 communes | Périmètre en vigueur depuis le 1/9/2022, évolutions par paliers Crit'Air | `cav.geom` (PostGIS, GiST) par intersection géométrique | Conformité du parc + km en zone réglementée (P-ENV-04) |
| `mode-doccupation-des-sols-mos-metropole-rouen-normandie` | **V** | Polygone (occupation du sol) | Inconnue (« n.d. ») | `cav.geom` par intersection | Facteur contextuel pour le moteur prédictif de remplissage (P-ENV-07) |
| `donmetdec_pav` | **V** (aussi sur data.gouv.fr, LO 2.0) | Point géolocalisé, flux OM/recyclables/verre/**textile** | data.gouv.fr : MAJ 14/06/2026 | `referentiel_communes.code_insee` (via rapprochement géographique du point) | Taux de couverture territoriale textile SOLIDATA vs Métropole (P-ENV-05) |
| `quantite-de-dechets` | **V** | Année × type de déchet × mode de collecte, EPCI entier | Inconnue | Aucune clé directe — contexte tonnage global du territoire | Contexte narratif (part du textile dans les DMA), non repris en proposition dédiée faute de granularité |
| `conso_eau` | **V** | Mois × usage (service public de l'eau) | Inconnue | Aucune | **Écarté** — aucun rapport avec l'activité de collecte textile (cf. §5) ; cité pour mémoire, non retenu en proposition |
| Atmo Normandie (mesures qualité de l'air) | Source externe non listée au catalogue MRN | Station × polluant × heure | Continue (API dédiée) | Aucune clé fiable au niveau de l'activité SOLIDATA | **Écarté** — voir note dédiée en fin de section 3 |
| Bilan environnemental Refashion 2023 (national) | Source externe (pro.refashion.fr, secondaire — non lue en primaire) | National, par catégorie de produit | 2023 | Aucune — sert à **sourcer** les facteurs déjà utilisés | Fiabilisation méthode (P-ENV-02) |

---

## 3. Propositions d'agrégations

### P-ENV-01 — CO2 évité SOLIDATA en regard des émissions du secteur Déchets du territoire (ORECAN)

- **Indicateur produit** : valeur absolue du CO2 évité par Solidarité Textiles (tCO2e/an) affichée **à côté** (jamais soustraite) des émissions du secteur « Déchets » de l'ORECAN pour la Métropole, avec les deux années clairement datées.
- **Formule / méthode** : `co2_evite_solidata_tonnes(annee)` = somme annuelle du calcul déjà fait mensuellement par `GET /metropole/dashboard` (`metropole.js:14-107`, aujourd'hui borné à un seul mois `dateFrom/dateTo` — à sommer sur 12 appels ou à ré-écrire en agrégat annuel direct) ; `emissions_orecan_secteur_dechets_tonnes` = valeur du dernier millésime disponible du jeu ORECAN pour le secteur « Déchets » (nom de secteur à confirmer, §6). Présentation en **deux nombres côte à côte avec leurs deux années respectives**, jamais un ratio unique implicite si les millésimes diffèrent de plus d'un an.
- **Sources croisées** : `emissions-de-gaz-a-effet-de-serre-annuelles` (ORECAN) + `metropole.js:38-107` (à faire évoluer avec P-ENV-02).
- **Granularité** : EPCI (le jeu ORECAN ne descend pas à la commune — pas de déclinaison communale possible pour cette proposition, contrairement à ce que demanderait idéalement une fiche commune).
- **Consommateur** : élus (rapport annuel, `ReportingMetropole.jsx`), direction et RSE-AFNOR (bilan 3 volets, `rse.js:139-230 gather3Volets`, volet environnement déjà présent mais sans ce contexte territorial).
- **Prérequis de vérification en phase 2** : lire le schéma exact du jeu (nom du champ secteur, libellé exact « Déchets » ou équivalent, unité tCO2e vs kteqCO2, dernier millésime réellement disponible — probablement 2019, donc décalage de plusieurs années avec l'année SOLIDATA courante).
- **Effort** : M (agrégation annuelle CO2 évité à créer + import/cache du jeu ORECAN + écran).
- **Valeur** : 4.
- **Risques et cas « donnée absente »** : le secteur « Déchets » de l'ORECAN comptabilise probablement la collecte/le traitement de TOUS les déchets du territoire (pas seulement le textile) — le ratio, s'il est calculé, **sous-estime structurellement** la part réelle de l'activité textile et doit être présenté comme tel. Millésime ORECAN absent ou trop ancien → afficher « dernière donnée disponible : 2019 » explicitement, jamais comparer à l'année courante sans le dire. Le jeu peut ne pas exposer de secteur « Déchets » isolé (nomenclature nationale à vérifier) → dégrader en « non disponible », jamais 0.

### P-ENV-02 — Facteurs CO2 évité migrés vers `ges_facteurs`, millésimés et sourcés

- **Indicateur produit** : les 4 facteurs de CO2 évité par filière de valorisation (réutilisation, recyclage, chiffons, CSR) deviennent des lignes de la table `ges_facteurs` au même titre que les facteurs d'émission propre (électricité, gazole…), avec source et année affichées à l'écran.
- **Formule / méthode** : insérer 4 lignes `poste IN ('co2_evite_reutilisation','co2_evite_recyclage','co2_evite_chiffons','co2_evite_csr')`, `unite = 'tCO2e/t'`, dans le schéma déjà idempotent `UNIQUE(poste, annee)` (`backend/src/scripts/init-db.js:7185-7196`) ; `metropole.js` lit ces lignes via un helper de type `pickFacteur` (déjà utilisé par `energie.js:computeAnnualGes`) **à la place** de la constante `FACTEURS_CO2` codée en dur (`metropole.js:38-39`) ; le calcul du mix observé/fallback (`metropole.js:41-65`) est inchangé.
- **Sources croisées** : aucune source Métropole directe pour cette proposition — c'est une remise en cohérence interne. Point de sourçage externe identifié par recherche web : le **bilan environnemental Refashion 2023** (pro.refashion.fr, cité dans la revue de presse professionnelle du secteur) avance 3,6 kg CO2e évités / kg collecté pour vêtements et linge de maison (pour 1,3 kg émis), et 2,3 kg évités / 1,7 kg émis pour les chaussures — des chiffres **nationaux, mixés toutes filières confondues**, donc non directement substituables aux 4 facteurs par filière actuels (3,169 / 0,500 / 0,750 / 0,121) mais utiles comme **borne de comparaison** de l'ordre de grandeur.
- **Granularité** : structure (un jeu de facteurs par année, comme `ges_facteurs`).
- **Consommateur** : RSE-AFNOR (traçabilité méthodologique exigée par un audit), direction ; écran cible : `EnergieGES.jsx` onglet Réglages, qui regrouperait alors TOUS les facteurs GES (propres et évités) au même endroit.
- **Prérequis de vérification en phase 2** : retrouver la source précise des 4 valeurs actuelles (le commentaire du code dit seulement « facteurs ADEME », `metropole.js:38-39`, sans citation) ; obtenir/lire en primaire le rapport Refashion (pro.refashion.fr/actualite/filiere/bilan-environnemental-filiere-rep-textiles-chaussures) pour vérifier si une méthode par filière de sortie (réemploi/recyclage/CSR) y est publiée et pourrait remplacer les valeurs actuelles avec une source citable.
- **Effort** : S (une migration + un point de lecture qui remplace une constante).
- **Valeur** : 3 (pas un nouvel indicateur, mais condition préalable de crédibilité de P-ENV-01 et P-ENV-03 devant un auditeur RSEi/AFNOR).
- **Risques et cas « donnée absente »** : aucune absence possible en production (le seed garde les valeurs actuelles comme défaut) — le risque est inverse : présenter des facteurs vieux de plusieurs années comme actuels sans le dire ; répliquer explicitement la mention « indicatif, à ajuster » déjà posée sur `ges_facteurs` (`init-db.js:7200-7202`) aux 4 nouvelles lignes.

### P-ENV-03 — Bilan net « empreinte propre de la collecte vs CO2 évité », par commune

- **Indicateur produit** : pour chaque commune desservie, tCO2e émis par les tournées de collecte (carburant) mis en regard des tCO2e évités par la valorisation collectée sur cette commune, avec le solde net affiché comme bénéfice territorial.
- **Formule / méthode** : `emissions_propres_commune = Σ_tournées [ (distance_km_tournée × conso_l_100km_véhicule / 100) × facteur_ges_carburant_véhicule ] × (nb_cav_commune_collectés_dans_la_tournée / nb_cav_total_collectés_dans_la_tournée)` — **même clé de répartition au prorata des CAV collectés** que celle déjà verrouillée par l'oracle `distributeTonnageProrata()` (`metropole.js:590-619`) et la CTE `poids_tour`/`cav_par_tour` de `GET /captation-par-commune` (`metropole.js:388-434`), pour que les deux agrégats commune restent construits sur le même dénominateur. `conso_l_100km_véhicule` provient de `computeVehicleConso` (`backend/src/routes/energie.js`, fonction citée dans le fichier autour de « async function computeVehicleConso »), calculée plein-à-plein sur `carburant_pleins` — **c'est une estimation à partir de la conso moyenne du véhicule, jamais une mesure directe par tournée** (aucun compteur de litres par tournée n'existe dans le schéma), à dire à l'écran. `co2_evite_commune` = extension de `/captation-par-commune`, qui connaît déjà `poids_kg` par commune (`metropole.js:407`), multiplié par le mix et les facteurs de P-ENV-02.
- **Sources croisées** : SOLIDATA uniquement (`tours`, `tour_cav`, `carburant_pleins`, `ges_facteurs`, `referentiel_communes`) — pas d'open data Métropole au sens strict pour cette proposition, mais elle alimente directement la « fiche commune » demandée par le brief.
- **Granularité** : commune × année (déclinable au mois).
- **Consommateur** : élus (fiche commune, `ReportingMetropole.jsx`), RSE-AFNOR (le volet environnement du bilan 3 volets, `rse.js:139-230`, n'a aujourd'hui qu'un total global, pas de déclinaison commune), exploitation (arbitrage des tournées).
- **Prérequis de vérification en phase 2** : la `distance_km` fiable par tournée close est aujourd'hui `estimated_distance_km` (`tours.crud.js`, plusieurs lignes) — une **estimation**, pas systématiquement une mesure GPS (le tracé réel n'est recalculé qu'en cours de tournée, cache 3 min, `active-summary.js:133-134`/`geo.js:95`) ; vérifier la couverture de `carburant_pleins` par véhicule (au moins 2 pleins requis, doctrine déjà appliquée par `computeVehicleConso`) ; aucune colonne `fuel_type` n'existe sur `vehicles` (vérifié — seules `brand`, `model`, `type`, `tare_weight_kg`, `next_maintenance`, `insurance_expiry`, `assigned_driver_id`, `vehicle_type` ont été migrées, `init-db.js:4984-4992`) : le type de carburant ne peut être dérivé que du dernier `carburant_pleins.type_carburant` connu, jamais inventé.
- **Effort** : L.
- **Valeur** : 5 — répond très directement à la demande « donner aux élus une donnée de qualité dédiée à leur commune […] notamment les bénéfices environnementaux » et referme le grief documenté d'un « bilan détourné par déduction » (`rapports/audits/2026-05-10-audit-metropole-rouen.md`).
- **Risques et cas « donnée absente »** : distance estimée non mesurée → biais possible sur les tournées anciennes, à signaler comme « estimation » et non « mesure » ; véhicule sans plein renseigné → `emissions_propres` `null` nommé pour ce véhicule (jamais 0, jamais exclu silencieusement du dénominateur) ; **risque de double compte avec P-ENV-01** si les deux chiffres sont additionnés dans un même document sans préciser que l'un est un ratio global (EPCI, vs ORECAN) et l'autre un bilan net local (commune, interne) — à traiter en §5.

### P-ENV-04 — Conformité ZFE-m du parc utilitaire et kilométrage en zone réglementée

- **Indicateur produit** : (a) part du parc utilitaire SOLIDATA conforme à la vignette Crit'Air actuellement exigée dans la ZFE-m ; (b) nombre de CAV/points de collecte situés à l'intérieur du polygone ZFE-m (13 communes) et part du kilométrage de tournée qui s'y déroule.
- **Formule / méthode** : (a) nécessite un **prérequis de schéma manquant** — aucune colonne de norme Euro/vignette Crit'Air n'existe sur `vehicles` (colonnes vérifiées : `brand`, `model`, `type`, `tare_weight_kg`, `next_maintenance`, `insurance_expiry`, `assigned_driver_id`, `vehicle_type`, `init-db.js:4984-4992` — rien sur la motorisation/l'année d'immatriculation) ; sans cette donnée l'indicateur reste `null` nommé « Crit'Air non renseigné », jamais une conformité supposée. (b) `ST_Within(cav.geom, zfe_polygon)` après import du GeoJSON `zfe-m-metropole-rouen-normandie` dans une table PostGIS dédiée, en s'appuyant sur `cav.geom` déjà indexé GiST ; kilométrage en zone = approximation par points (CAV + centre de tri, pas par tracé complet, faute de tracé systématiquement stocké hors tournée en cours).
- **Sources croisées** : `zfe-m-metropole-rouen-normandie` (polygone) + `cav.geom` + `tours`/`tour_cav`.
- **Granularité** : véhicule (a) ; commune/tournée (b).
- **Consommateur** : exploitation (`Vehicles.jsx`, alerte de conformité avant une future extension de la ZFE-m), direction, élus (preuve d'une contrainte assumée, argument institutionnel pour une SIAE).
- **Prérequis de vérification en phase 2** : lire le schéma du jeu ZFE-m (dates d'entrée en vigueur par palier Crit'Air) ; **confirmé par recherche web** (sources secondaires non primaires, à re-vérifier sur l'arrêté préfectoral officiel) : la ZFE-m Rouen applique aux **véhicules utilitaires et poids lourds une interdiction PERMANENTE** (pas de plage horaire, contrairement aux véhicules particuliers limités 7h-19h en semaine) pour les Crit'Air 4/5/non classés ; les Crit'Air 3 restent autorisés en 2026, sans nouveau palier annoncé à court terme. Ce point change la nature du sujet : ce n'est pas une contrainte future hypothétique, c'est déjà une contrainte permanente et structurante pour le parc utilitaire actuel — à confirmer via l'arrêté officiel avant toute communication aux élus.
- **Effort** : L (colonne véhicule + saisie initiale + import polygone PostGIS + calcul point-in-polygon + écran).
- **Valeur** : 4 (relevé à la hausse après confirmation du caractère permanent de la restriction VUL).
- **Risques et cas « donnée absente »** : Crit'Air non renseigné pour un véhicule → « non renseigné », jamais « conforme » par défaut ; le polygone ZFE-m peut évoluer (nouvelles communes, nouveaux paliers Crit'Air) → horodater l'import et re-vérifier `metas.default.modified` en phase 2 avant chaque publication d'indicateur.

### P-ENV-05 — Taux de couverture territoriale textile : CAV SOLIDATA vs PAV toutes filières de la Métropole

- **Indicateur produit** : par commune, nombre de points d'apport volontaire textile recensés par la Métropole (`donmetdec_pav`, flux textile) comparé au nombre de CAV SOLIDATA rattachés à cette commune, avec les écarts nommés (borne Métropole non exploitée par SOLIDATA / borne SOLIDATA absente du recensement Métropole).
- **Formule / méthode** : `nb_pav_textile_commune = COUNT(*) FROM donmetdec_pav WHERE flux = 'textile' AND code_insee = <commune>` (nom exact du champ « flux » à confirmer, §6) ; `nb_cav_solidata_commune = COUNT(*) FROM cav WHERE code_insee_commune = <commune>` ; `ecart = nb_pav_textile_commune − nb_cav_solidata_commune`. Rapprochement géographique complémentaire par distance minimale (Haversine — fonction déjà partagée `TourService.haversineDistance`, citée dans `cartographie-solidata.md §7`, lot V6.2) entre chaque PAV textile Métropole et le CAV SOLIDATA le plus proche, pour distinguer un doublon de recensement (< ~30 m) d'une vraie absence.
- **Sources croisées** : `donmetdec_pav` + `cav` + `referentiel_communes`.
- **Granularité** : commune, avec un rapprochement point à point pour l'exploitation.
- **Consommateur** : élus (preuve de couverture réelle du service — un des 6 documents exigés en revue de convention, « liste géolocalisée des CAV », cité en `cartographie-solidata.md §8.1`), direction (négociation d'implantations), exploitation (`AdminCAV`).
- **Prérequis de vérification en phase 2** : lire le schéma exact de `donmetdec_pav` (nom du champ flux, présence ou non d'un champ « gestionnaire/opérateur » — **question clé déjà identifiée par l'inventaire**, §4.1 : si tous les PAV textile de la Métropole sont d'ores et déjà exploités par Solidarité Textiles, cet indicateur devient un contrôle qualité du référentiel `cav` interne plutôt qu'une mesure de couverture manquante).
- **Effort** : M.
- **Valeur** : 4.
- **Risques et cas « donnée absente »** : absence de champ gestionnaire sur le PAV Métropole → impossible de distinguer sans rapprochement géographique « notre borne » d'une borne d'un autre opérateur, et le rapprochement géographique lui-même peut produire un faux positif sur deux bornes voisines d'opérateurs différents — ne jamais fusionner automatiquement, seulement proposer un rapprochement à valider humainement. Licence LO 2.0 confirmée pour ce jeu spécifique (data.gouv.fr) — pas de blocage juridique identifié.

### P-ENV-06 — Miroir de l'indicateur PCAET « renouvellement de flotte à faibles émissions »

- **Indicateur produit** : part du parc utilitaire SOLIDATA à faibles émissions dans le renouvellement annuel, présentée dans le **même format** que l'indicateur PCAET `renouvellement_flotte_mrn` de la Métropole, pour permettre une lecture comparative directe par les élus.
- **Formule / méthode** : `nb_véhicules_faibles_émissions_acquis_annee / nb_véhicules_acquis_annee`, avec la **même définition de « faible émission »** que celle utilisée par la Métropole pour son propre indicateur PCAET (à confirmer en phase 2 — Crit'Air 0/1 seulement, ou électrique/hybride/GNV). Nécessite le même prérequis de schéma que P-ENV-04 (motorisation par véhicule) ainsi qu'une date d'acquisition, absente aujourd'hui de `vehicles`.
- **Sources croisées** : `renouvellement_flotte_mrn` (méthode/format de référence uniquement, pas de valeur numérique à sommer — ce n'est pas la flotte de la Métropole) + `vehicles`.
- **Granularité** : année, sur un parc SOLIDATA de l'ordre de 10-20 véhicules utilitaires.
- **Consommateur** : élus (alignement volontaire sur les objectifs PCAET, rapport annuel), direction (arbitrage achats véhicules).
- **Prérequis de vérification en phase 2** : lire la définition exacte de « faible émission » retenue par le jeu `renouvellement_flotte_mrn` ; vérifier qu'aucune colonne date d'acquisition n'existe déjà ailleurs (module Maintenance).
- **Effort** : S une fois la définition connue et une colonne créée ; M si la colonne et sa rétro-saisie sont à faire en amont.
- **Valeur** : 2 — intérêt de communication institutionnelle, mais dénominateur trop petit (un seul véhicule renouvelé fait varier le pourcentage de plusieurs dizaines de points) pour prétendre à un indicateur statistiquement robuste année par année.
- **Risques et cas « donnée absente »** : afficher systématiquement le dénominateur brut à côté du pourcentage, jamais le pourcentage seul ; définition « faible émission » mal recopiée par rapport au PCAET → comparaison trompeuse, à documenter explicitement à chaque publication.

### P-ENV-07 — Occupation du sol (MOS) en appui du moteur de remplissage prédictif

- **Indicateur produit** : catégorie d'occupation du sol dominante autour de chaque CAV (habitat dense / pavillonnaire / zone d'activité / espace vert), en remplacement du proxy actuel de densité `nb_containers >= 3 → ×1.1` (`backend/src/routes/tours/predictions.js:386-388`, cité dans `cartographie-solidata.md §3.1`).
- **Formule / méthode** : rattachement `ST_Intersects(cav.geom, mos_polygon)` → nouvelle colonne contextuelle sur `cav` ; intégration comme facteur additionnel de `predictFillRate` (`predictions.js`) **uniquement après une preuve de gain mesurée** via le script déjà existant `scripts/backtest-predictions.js` — le moteur applique une hiérarchie stricte de facteurs (corrections apprises CAV 60 % / période 25 % / zone 15 %, `predictions.js:432-511`) qu'un nouveau facteur non prouvé ne doit pas perturber.
- **Sources croisées** : `mode-doccupation-des-sols-mos-metropole-rouen-normandie` + `cav.geom`.
- **Granularité** : point (CAV) / polygone.
- **Consommateur** : exploitation (`AdminPredictive.jsx`) — pas un livrable élus direct.
- **Prérequis de vérification en phase 2** : lire la nomenclature MOS (catégories, échelle, millésime — inconnu à ce stade) ; lancer un backtest comparatif avant/après.
- **Effort** : L.
- **Valeur** : 2 (gain opérationnel interne incertain tant que non mesuré, effort élevé, hors périmètre direct des élus).
- **Risques et cas « donnée absente »** : risque de complexifier le moteur sans gain démontré (doctrine du projet déjà stricte sur ce point, cf. historique 2.34.0 « hiérarchie structurelle » des facteurs) ; un MOS souvent millésimé à plusieurs années peut être désynchronisé de l'urbanisation réelle récente — à dire si retenu.

#### Ce que la qualité de l'air et la météo n'apportent PAS

Aucune proposition n'a été retenue à partir des mesures de qualité de l'air (Atmo Normandie : PM10, PM2.5, NO2, indices ATMO). Les concentrations mesurées à une station dépendent de la totalité du trafic urbain, du chauffage résidentiel, de l'industrie et de la météo (dispersion) — la part attribuable à quelques utilitaires légers de collecte y est structurellement indiscernable du bruit de fond. **Aucune agrégation ne peut donc affirmer que l'activité de Solidarité Textiles a fait varier un indice de qualité de l'air**, et présenter un tel lien aux élus serait une causalité non établie. Seule la contribution en tonnage/CO2 (P-ENV-01, P-ENV-03) est mesurable et défendable. De même, la météo (déjà intégrée via `utils/weather.js` pour la fréquentation VAK/boutiques et le remplissage des CAV) reste un facteur **comportemental** (dépôt, fréquentation), jamais un facteur d'émission — les deux usages ne doivent pas être confondus dans une même restitution.

---

## 4. Contribution à la « fiche commune » des élus

| Attribut | Définition | Source | Fréquence |
|---|---|---|---|
| `nom`, `code_insee`, `epci_code`, `epci_nom` | Identité et rattachement administratif de la commune | `referentiel_communes` (déjà en base, alimenté par geo.api.gouv.fr) | À chaque refresh EPCI (manuel, `POST /communes/refresh-epcis`) |
| `population_insee` | Population municipale | `referentiel_communes.population_insee` (déjà en base) | **Millésime non tracé aujourd'hui** — à ajouter (aucune colonne de date de référence de la population) |
| `poids_kg`, `kg_par_hab_an` | Tonnage collecté et rapporté à l'habitant | `GET /captation-par-commune` (existant, `metropole.js:388-434`) | Annuelle (paramètre `annee`) |
| `nb_cav_solidata`, `nb_pav_textile_metropole`, `taux_couverture` | Comparaison du réseau SOLIDATA au recensement Métropole | P-ENV-05 (`cav` + `donmetdec_pav`) | À définir (au moins annuelle, au rythme des rapprochements) |
| `co2_evite_tonnes`, `emissions_propres_tonnes`, `bilan_net_tonnes` | Bénéfice environnemental net de l'activité sur la commune | P-ENV-03 (interne SOLIDATA) | Annuelle |
| `zfe_m` (booléen) | La commune fait-elle partie des 13 communes du périmètre ZFE-m | `zfe-m-metropole-rouen-normandie` (statique depuis l'import du polygone) | À chaque évolution du périmètre (rare) |
| Contexte territorial GES (note, pas une colonne par commune) | Émissions du secteur Déchets de l'EPCI (ORECAN), affichées en en-tête de toutes les fiches, pas par commune | P-ENV-01 | Au rythme des publications ORECAN (pluriannuel, dernier millésime vu : 2019) |

---

## 5. Points de vigilance

1. **Millésimes disparates** : le seul jeu GES territorial disponible (ORECAN) a pour dernier millésime vu 2019, quand les données SOLIDATA sont produites en continu — toute comparaison doit dater explicitement les deux termes, jamais une mise à jour implicite de l'un vers l'autre.
2. **Méthodes non comparables, pas soustractibles** : le CO2 « évité » de SOLIDATA (bénéfice d'une valorisation qui évite une production/incinération vierge, calcul par facteur de filière) et les émissions « émises » comptabilisées par l'ORECAN pour le secteur Déchets (bilan territorial classique, inventaire d'émissions réelles) sont deux natures de grandeur différentes. Le brief demande de les **mettre en regard** — jamais de les soustraire l'une de l'autre dans un même total, ce qui produirait un chiffre sans signification physique.
3. **Risque de double compte Refashion / SOLIDATA** : le CO2 évité national déclaré par Refashion (filière REP, chiffres 2023 identifiés par recherche web) peut déjà inclure, de façon agrégée et anonymisée, la part collectée par Solidarité Textiles via ses déclarations DPAV. Si un indicateur territorial PCAET venait un jour à ventiler le CO2 évité national par EPCI à partir des données Refashion, il faudrait vérifier qu'il n'est pas additionné au CO2 évité propre de SOLIDATA (P-ENV-01/03) dans un même document sans le signaler.
4. **Deux « 3,6 » à ne pas confondre** : `metropole.js:143` fixe un `objectif_refashion_kg: 3.6` (objectif de captation en kg/habitant/an) ; le bilan Refashion 2023 cite par ailleurs « 3,6 kg CO2e évités par kg collecté » pour les vêtements/linge — deux grandeurs Refashion homonymes en valeur mais de nature totalement différente (kg de textile vs kg de CO2). À nommer explicitement dans toute documentation ou écran qui les citerait côte à côte.
5. **Licence** : LO 2.0/Etalab confirmée uniquement pour 2 jeux via data.gouv.fr (`donmetdec_pav`, réseau de déchèteries) parmi ceux retenus ici. À vérifier pour `emissions-de-gaz-a-effet-de-serre-annuelles`, `zfe-m-metropole-rouen-normandie`, `mode-doccupation-des-sols-mos` via `metas.default.license` (phase 2) avant toute republication.
6. **Fiabilité de l'inventaire source** : tous les jeux cités ici sont au mieux « Vérifiés » au sens de l'inventaire, c'est-à-dire qu'une URL a été vue dans un résultat indexé, **jamais qu'un schéma a été lu**. Le nom exact des champs (notamment le champ « flux » de `donmetdec_pav` et le nom du secteur « Déchets » dans le jeu ORECAN) reste à confirmer avant tout développement.
7. **Périmètre EPCI** : `referentiel_communes` couvre désormais des EPCI limitrophes (lot 10, Eure/Seine-Maritime) — tout indicateur « Métropole » doit filtrer `epci_code = '200023414'` comme le fait déjà `GET /captation-par-commune` (`metropole.js:429`), à répliquer systématiquement dans toute nouvelle route de ce chantier.
8. **Doctrine « jamais de valeur inventée »** déjà appliquée dans `energie.js` (`facteur_manquant`, `ca_source`) et à répliquer strictement pour chaque proposition ci-dessus : une donnée absente est nommée à l'écran (« non renseigné », « non disponible »), jamais remplacée par 0 ou par une valeur par défaut silencieuse.

---

## 6. Questions à trancher et vérifications API de phase 2

**Questions à trancher (décision métier/produit, pas seulement technique) :**
- Le champ « flux » de `donmetdec_pav` isole-t-il vraiment le textile d'un gestionnaire identifiable, ou mélange-t-il plusieurs opérateurs sans distinction ? Conditionne entièrement P-ENV-05.
- Doit-on présenter aux élus un ratio « CO2 évité / émissions ORECAN secteur Déchets » sachant que les millésimes ne coïncideront presque jamais, ou seulement deux valeurs datées côte à côte sans ratio calculé ? (P-ENV-01)
- Qui décide de la définition « faible émission » à reprendre pour comparer la flotte SOLIDATA à l'indicateur PCAET de la Métropole ? (P-ENV-06)
- Faut-il créer une colonne Crit'Air/motorisation/date d'acquisition sur `vehicles` dans le cadre de ce chantier, ou est-ce un chantier séparé du module Maintenance/Véhicules ? (prérequis commun à P-ENV-04 et P-ENV-06)
- Le risque de double compte Refashion national / SOLIDATA local (point 3 de la section 5) doit-il être documenté dans le bilan RSE (`rse.js`) ou seulement dans le rapport Métropole ?

**Commandes curl à exécuter depuis un hôte non filtré (phase 2) :**

```bash
BASE=https://data.metropole-rouen-normandie.fr/api/explore/v2.1

# 1. ORECAN — schéma des champs (nom exact du secteur, unité) + derniers millésimes
curl -s "$BASE/catalog/datasets/emissions-de-gaz-a-effet-de-serre-annuelles" \
  | jq '{fields:[.fields[]|{name,type,label}], metas:.metas.default}'
curl -s "$BASE/catalog/datasets/emissions-de-gaz-a-effet-de-serre-annuelles/records?limit=100&order_by=-annee"

# 2. PCAET — renouvellement de flotte : définition de "faible émission" + méthode
curl -s "$BASE/catalog/datasets/renouvellement_flotte_mrn" \
  | jq '{fields:[.fields[]|{name,type,label}], metas:.metas.default}'
curl -s "$BASE/catalog/datasets/renouvellement_flotte_mrn/records?limit=100&order_by=-annee"

# 3. ZFE-m — géométrie + métadonnées de version (paliers Crit'Air, date d'entrée en vigueur)
curl -s "$BASE/catalog/datasets/zfe-m-metropole-rouen-normandie" \
  | jq '{fields:[.fields[]|{name,type,label}], metas:.metas.default}'
curl -s "$BASE/catalog/datasets/zfe-m-metropole-rouen-normandie/exports/geojson" -o zfe.geojson

# 4. MOS — nomenclature et millésime
curl -s "$BASE/catalog/datasets/mode-doccupation-des-sols-mos-metropole-rouen-normandie" \
  | jq '{fields:[.fields[]|{name,type,label}], metas:.metas.default}'

# 5. conso_eau — à confirmer comme écarté (hors périmètre SOLIDATA) après lecture du schéma
curl -s "$BASE/catalog/datasets/conso_eau" | jq '{fields:[.fields[]|{name,type,label}], metas:.metas.default}'

# 6. donmetdec_pav — champ flux + présence d'un champ gestionnaire/opérateur
curl -s "$BASE/catalog/datasets/donmetdec_pav" | jq '.fields'
curl -s "$BASE/catalog/datasets/donmetdec_pav/records?where=search(%22textile%22)&limit=50"

# 7. Licences des jeux retenus dans ce document
curl -s "$BASE/catalog/datasets?limit=100&select=dataset_id,metas.default.license,metas.default.modified" \
  | jq '[.results[] | select(.dataset_id | IN("emissions-de-gaz-a-effet-de-serre-annuelles","renouvellement_flotte_mrn","zfe-m-metropole-rouen-normandie","mode-doccupation-des-sols-mos-metropole-rouen-normandie","conso_eau","donmetdec_pav"))]'

# 8. Atmo Normandie — confirmer l'absence d'API exploitable simplement (pour clore le sujet, §3)
curl -sI "https://api.atmonormandie.fr/"

# 9. Refashion — retrouver en primaire le bilan environnemental 2023 cité en P-ENV-02
curl -s "https://www.data.gouv.fr/api/1/datasets/?q=textiles%20collect%C3%A9s%20fili%C3%A8re%20REP" \
  | jq '.data[0] | {title, resources:[.resources[].url]}'
```

---

*Rapport rédigé sans accès direct au portail (proxy bloqué pour cette session) — toute mise en œuvre doit repasser par les vérifications de la section 6 avant tout développement.*

# Mobilité, tournées & remplissage des bornes — agrégations open data Métropole Rouen Normandie

> Agent thématique « Mobilité, tournées & remplissage des bornes » — chantier de cadrage SOLIDATA × open data MRN, 6 septembre 2026.
> Sources lues intégralement : `inventaire-catalogue.md` (01-inventaire-catalogue.md dans ce dossier) et `cartographie-solidata.md` (07-cartographie-solidata.md dans ce dossier). Le portail `data.metropole-rouen-normandie.fr` est bloqué par le proxy de cette session : tout ce qui concerne le catalogue open data hérite du niveau de certitude de l'inventaire (**V**érifié = URL vue dans un résultat indexé, **S**ignalé, **?** = supposé) — aucun schéma de champs n'a pu être lu directement. Deux recherches web complémentaires ont permis de préciser la ZFE-m (calendrier Crit'Air 2026) et la nature du jeu `travaux-json` (données expérimentales, citées en section 5).

---

## 1. Périmètre et enjeu métier

SOLIDATA planifie chaque jour des tournées d'utilitaires légers sur 209 CAV géolocalisés de la Métropole Rouen Normandie, à partir d'un moteur prédictif de remplissage (`predictFillRate`, `backend/src/routes/tours/predictions.js:278-567`) et d'un moteur de temps de tournée (`backend/src/services/tour-time-engine.js`) optimisé par TomTom/OSRM. Deux familles de besoins motivent ce rapport :

1. **Tournées** — le moteur ignore aujourd'hui toute contrainte de voirie propre à la Métropole (chantiers, ZFE, zones piétonnes) : seul le trafic TomTom (généraliste, temps réel, payant au-delà d'un quota) est consommé (`backend/src/services/traffic.js`, `routing-tomtom.js`). L'open data local peut apporter une couche de contraintes gratuite, complémentaire et parfois plus en amont (chantiers annoncés avant qu'ils ne génèrent un bouchon mesurable).
2. **Remplissage** — le moteur utilise un seul proxy de densité (`nb_containers >= 3` → bonus ×1,1, `predictions.js:386-388`) et un correcteur de zone grossier (boîte lat/lng 0,05°×0,1°, `predictions.js:483-507`). L'open data MRN (flux piétons, comptages vélo, occupation du sol, résidences étudiantes) peut fournir des signaux plus fins — **à condition de les tester honnêtement** avant de les intégrer, sur le modèle déjà établi par `weather-learning.js` (apprentissage par moindres carrés, garde « échantillon insuffisant → aucune écriture ») et `scripts/backtest-predictions.js` (MAE contre vérité terrain capteur/chauffeur).
3. **Segmentation** — aucune typologie de borne n'existe aujourd'hui dans SOLIDATA (`cav` ne porte ni catégorie de zone ni indicateur d'accessibilité) ; l'open data urbanistique (MOS, ZFE, zones piétonnes, résidences) permet d'en construire une, utile à la fois pour le dimensionnement des bornes et pour affiner le moteur par groupe homogène plutôt que par CAV isolé.

---

## 2. Jeux de données retenus

| Identifiant | Certitude | Granularité | Fraîcheur | Clé de jointure | Usage |
|---|---|---|---|---|---|
| `travaux-json` | **V** (URL vue) | point/linéaire, événement, « chantiers perturbants sur axes structurants » — **données déclarées expérimentales et évolutives** par l'éditeur (cf. §5) | continue (supposé), à vérifier via `metas.default.modified` | `ST_DWithin` géométrie chantier ↔ `cav.geom` / tracé itinéraire | P-MOB-01 |
| `zfe-m-metropole-rouen-normandie` | **V** | polygone unique, 13 communes | rare (évolution réglementaire) | `ST_Contains(zfe.geom, cav.geom)` | P-MOB-02 |
| `zones-pietonnes-rouen` | **V** | polygone(s), Ville de Rouen | n.d. | `ST_Contains` | P-MOB-02 |
| `zones-apaisees-metropole-rouen-normandie` | **V** | polygone (zones 30 / rencontre, interprétation) | n.d. | `ST_Contains` | P-MOB-02 (secondaire) |
| `filaire-de-voies-metropolitain-par-troncons` | **V** | linéaire, tronçon de voie | n.d. | plus proche tronçon (`ST_DWithin` + `ST_ClosestPoint`) de `cav.geom` | P-MOB-03 |
| `comptages-et-enquetes-sur-le-reseau-routier` | **V** | tronçon × campagne (véhicules, vélo) | par campagne (ponctuel, pas continu) | proximité tronçon | contexte P-MOB-04 (faible densité de points, à confirmer) |
| `eco-counter-sites` + `eco-counter-data` / `eco-counter-data-day` | **V** | point (site) ; heure ou jour × capteur | continue | distance `cav.geom` ↔ site (rayon à calibrer, ex. 300 m) | P-MOB-04 |
| `rouen_flux-pietons_vd` | **V** | mois × site, centre historique de Rouen uniquement | mensuelle | distance `cav.geom` ↔ site | P-MOB-04 |
| `mode-doccupation-des-sols-mos-metropole-rouen-normandie` | **V** | polygone, occupation du sol | n.d. | `ST_Contains(mos.geom, cav.geom)` | P-MOB-05, P-MOB-06 |
| `cadastre-batiments-metropole-rouen-normandie-sage-cailly-aubette-robec` | **V** | polygone, bâtiment | n.d. | `ST_DWithin` (comptage dans un rayon) | P-MOB-05 |
| `residences-etudiants-metropole-rouen-normandie` | **V** | point | n.d. | `ST_DWithin` (rayon 300-500 m) | P-MOB-07 |
| `reseau-de-decheteries-metropole-rouen-normandie` | **V** | point (≈15-20 déchèteries) | rare (dernière MAJ connue 07/03/2023) | distance `cav.geom` ↔ déchèterie la plus proche | P-MOB-06 (typologie « proche déchèterie ») |
| `liste-des-arrets-du-reseau-astuce-metropole-rouen-normandie` | **V** | point (arrêt de bus/métro) | n.d. | `ST_DWithin` | P-MOB-06 (typologie), P-MOB-04 (secondaire) |
| `donmetdec_pav` | **V**, LO 2.0, MAJ 14/06/2026 (data.gouv) | point, PAV tous flux dont **textile** — schéma de champs NON lu | irrégulière, récente | rapprochement géographique avec `cav` (doublons / bornes tierces) | contexte P-MOB-06 (concurrence de collecte), hors calcul direct du remplissage |
| `agenda-metropole-rouen-normandie` | **V** | événement | continue | déjà consommé (voir §2.4) | P-MOB-08 |
| `renouvellement_flotte_mrn` | **V** | année, indicateur agrégé MRN | annuelle | aucune (pas de jointure géographique) | benchmark ZFE informatif, hors moteur (mentionné §4 seulement) |

Les jeux « Non trouvés » de l'inventaire (limitations de vitesse, sens de circulation détaillé hors filaire, jours de collecte par commune) ne concernent pas ce périmètre.

---

## 3. Propositions d'agrégations

### P-MOB-01 — Alerte chantiers Métropole sur la carte tournées + facteur de durée

- **Indicateur / fonction produite** : couche « chantiers MRN » fusionnée avec les incidents TomTom déjà affichés (le type `travaux` existe déjà dans `LiveVehicles.jsx:130` et `traffic.js:91`), avec une source distincte (`source: 'metropole_opendata'`) pour ne jamais confondre un incident temps réel TomTom et un chantier annoncé par la Métropole.
- **Méthode** :
  1. Nouveau module `services/travaux-metropole.js`, calqué sur `traffic.js:1-235` (même doctrine « jamais de valeur inventée », même cache par emprise arrondie `snapBbox` pour ménager le quota de requêtes). Récupère `travaux-json` via l'Explore API v2.1 (`GET .../catalog/datasets/travaux-json/records?limit=100`), normalise en `{id, type:'travaux', label, description, latitude, longitude, geometry, debut, fin, source:'metropole_opendata'}`.
  2. Persistance dans une table `travaux_metropole(id, source_id, titre, description, geom, date_debut, date_fin, maj_le)` avec upsert par `source_id`, rafraîchie par un job planifié (`runInstrumented`, pattern `backend/src/services/scheduler.js:72` + entrée `JOB_SCHEDULE`, `backend/src/routes/monitoring.js:91-177`) — pas d'appel à la demande sur chaque ouverture d'écran, contrairement à TomTom qui est temps réel par nature.
  3. Rapprochement `ST_DWithin(travaux.geom, cav.geom, <rayon>)` pour taguer les CAV concernés, et `ST_DWithin` contre la géométrie de l'itinéraire du jour (déjà disponible via `GET /tours/:id/itineraire-public`, cf. `docs/LOGIQUE_TOURNEES.md`) pour les tronçons traversés.
  4. Exposition : `GET /tours/trafic-public` (déjà consommé par la carte chauffeur mobile) enrichi d'un tableau `travaux[]` à côté de `incidents[]` ; `LiveVehicles.jsx` réutilise son icône `travaux` existante (`:130`) sans nouveau composant.
  5. Effet sur la durée : dans un premier temps, **alerte seulement** (aucun facteur automatique dans `tour-time-engine.js`) — un opérateur ou un chauffeur avisé peut décider d'un détour manuel. L'automatisation (majoration de `serviceMinutes` ou exclusion du point) est reportée en phase 2, une fois la fraîcheur du jeu vérifiée (voir §5).
- **Sources croisées** : `travaux-json` × `cav.geom` × itinéraire OSRM/TomTom du jour.
- **Granularité** : événement × jour, rafraîchi 1 à 3 fois/jour (aligné sur la cadence `traffic.js:429-452` du relevé trafic).
- **Consommateur et écran cible** : `LiveVehicles.jsx` (carte gestionnaire), carte chauffeur mobile (`TourMap`), panneau « Collecte en direct ».
- **Prérequis phase 2** : lire le schéma réel (`curl .../datasets/travaux-json` — §6) pour confirmer la présence d'une géométrie exploitable (point ou linéaire) et des dates de validité ; sans elles, la géolocalisation resterait approximative.
- **Effort** : M. **Valeur** : 3.
- **Risques / donnée absente** : le jeu est déclaré **expérimental et sujet à changement** par son éditeur (cf. §5) — ne jamais l'utiliser pour un refus automatique de point, seulement pour une alerte informative datée ; si l'API ne répond pas ou le dataset est vide, la couche `travaux[]` est simplement absente (jamais un tableau vide interprété comme « aucun chantier », le message reprend la doctrine de `traffic.js:167-176` : « non configuré » ≠ « rien à signaler »).

### P-MOB-02 — ZFE-m et zones piétonnes comme contrainte réglementaire ET opérationnelle

- **Indicateur / fonction produite** : `cav.dans_zfe` (booléen), `cav.dans_zone_pietonne` (booléen) + fenêtre d'accès horaire pour les CAV en zone piétonne ; `vehicles.critair_classe` (nouveau champ, absent aujourd'hui — vérifié par grep sur `init-db.js:549-558`, la table `vehicles` ne porte aucune classe Crit'Air) comparée à l'interdiction ZFE en vigueur.
- **Méthode** :
  1. Import ponctuel (pas de job récurrent : géométrie stable) des polygones `zfe-m-metropole-rouen-normandie` et `zones-pietonnes-rouen` en GeoJSON dans une table `zones_reglementaires(type, commune, geom, source, importe_le)`.
  2. Calcul (job nocturne ou déclenché à la création/MAJ d'un CAV) : `UPDATE cav SET dans_zfe = ST_Contains(zfe.geom, cav.geom)`, idem zone piétonne.
  3. **Réutilisation du mécanisme déjà construit pour les associations** (2.38.0) : `association_points.horaires_accessibilite` JSONB + le couple `windows`/`anchor` du moteur de temps (`tour-time-engine.js:32-45`, implémenté `:283-317` et `:465-515`) traite déjà « plages horaires connues/inconnues/fermé » et distingue une violation `hors_horaires` d'une attente `rdv_manque`. Pour un CAV en zone piétonne avec restriction de livraison, on lui pose la même colonne `horaires_accessibilite` (aujourd'hui réservée à `association_points`, `init-db.js:5307-5317`) plutôt que d'inventer un second mécanisme.
  4. Le champ `vehicles.critair_classe` (VARCHAR, saisie manuelle ADMIN, carte grise) est comparé à la classe interdite en vigueur dans `zfe-m-metropole-rouen-normandie` (aujourd'hui Crit'Air 5 et non classés, cf. §5) ; alerte sur la fiche véhicule si un point du programme est `dans_zfe = true` et que le véhicule affecté est non conforme.
- **Sources croisées** : ZFE × zones piétonnes × `cav.geom` × `vehicles`.
- **Granularité** : CAV (statique, recalculé seulement au changement de polygone ou d'adresse du CAV).
- **Consommateur et écran cible** : fiche CAV (`AdminCAV.jsx`), fiche véhicule (`Vehicles.jsx`), moteur de temps (fenêtres horaires), wizard de création de tournée (avertissement si un CAV piéton est planifié hors créneau).
- **Prérequis phase 2** : confirmer que le polygone ZFE et les horaires de livraison en zone piétonne (souvent définis par arrêté municipal, pas nécessairement dans le jeu `zones-pietonnes-rouen` lui-même) sont bien dans les métadonnées ou sur `rouen.fr/zfe` ; sinon les horaires resteront à saisie manuelle (comme `association_points.horaires_notes`).
- **Effort** : M. **Valeur** : 4 (risque réglementaire réel — une amende Crit'Air sur un utilitaire, ou un refus d'accès non anticipé, coûte plus cher que l'intégration).
- **Risques / donnée absente** : le calendrier ZFE **évolue** (Crit'Air 4 pourrait être exclu à une date encore incertaine d'après les sources consultées, cf. §5) — le champ `critair_classe` doit être confronté à une règle **paramétrable** (`settings zfe.critair_min_autorise`), jamais codée en dur, pour ne pas se retrouver silencieusement obsolète à la prochaine étape du calendrier métropolitain. Sans polygone à jour, `dans_zfe` reste `null` (jamais `false` par défaut).

### P-MOB-03 — Rattachement des CAV au filaire de voies (qualité du référentiel adresse/commune)

- **Indicateur / fonction produite** : `cav.troncon_filaire_id`, nom de voie normalisé, et un rapport d'écart entre `cav.commune` (texte libre saisi manuellement) et la commune portée par le tronçon le plus proche.
- **Méthode** :
  1. Import du jeu `filaire-de-voies-metropolitain-par-troncons` (GeoJSON linéaire) dans une table `filaire_voies(id, nom_voie, commune, geom)`.
  2. Pour chaque CAV : `SELECT id, nom_voie, commune FROM filaire_voies ORDER BY geom <-> cav.geom LIMIT 1` (index GiST déjà en place sur `cav.geom`, `idx_cav_geom`, `init-db.js:543`) avec un seuil de distance (ex. 30 m) au-delà duquel aucun rattachement n'est proposé.
  3. Comparaison automatique entre `filaire.commune` et `cav.commune` / `cav.code_insee_commune` (déjà réconcilié avec `referentiel_communes` via `PATCH /communes/cav/:cavId`, `backend/src/routes/communes.js:389-403`) ; les écarts sont listés dans un panneau de qualité de données, jamais corrigés automatiquement (un CAV proche d'une limite communale peut légitimement diverger).
- **Sources croisées** : filaire × `cav.geom` × `referentiel_communes`.
- **Granularité** : CAV, recalculé au changement d'adresse ou une fois à l'import initial.
- **Consommateur et écran cible** : `AdminCAV.jsx` (fiche, panneau qualité), `AdminCommunes.jsx` (audit du rattachement communal), en amont de `/metropole/captation-par-commune` (`backend/src/routes/metropole.js:388-439`) dont la fiabilité dépend aujourd'hui d'un `code_insee_commune` renseigné à la main.
- **Prérequis phase 2** : lire le schéma du filaire (nom du champ commune, sens de circulation éventuel) — utile aussi, à terme, pour signaler une rue à sens unique dans les consignes chauffeur.
- **Effort** : S. **Valeur** : 3 (qualité de données, pas de gain opérationnel immédiat).
- **Risques / donnée absente** : un CAV très excentré (zone rurale du périmètre EPCI élargi, cf. `communes.epci_codes`) peut n'avoir aucun tronçon à moins de 30 m — `troncon_filaire_id` reste alors `null`, jamais un rattachement forcé au tronçon le plus proche quelle que soit la distance.

### P-MOB-04 — Fréquentation piétonne/vélo comme candidat prédicteur de remplissage — PROTOCOLE DE BACKTEST avant intégration

- **Indicateur / fonction produite** : un facteur candidat `frequentationProxy` par CAV, testé statistiquement avant toute utilisation en production. **Aucune intégration au moteur tant que l'effet n'est pas mesuré** (doctrine explicite du projet, déjà appliquée à l'apprentissage météo : `weather-learning.js:24-26` — « échantillon insuffisant… → AUCUNE écriture »).
- **Méthode (protocole complet, calqué sur `weather-learning.js` et `scripts/backtest-predictions.js`)** :
  1. **Construction du signal candidat** : pour chaque CAV, distance au site `eco-counter-sites` ou au site `rouen_flux-pietons_vd` le plus proche, et — si ≤ un rayon à calibrer (ex. 300 m) — la valeur de fréquentation (moyenne horaire/journalière/mensuelle du site). Au-delà du rayon, le signal est `null` (absence, pas zéro).
  2. **Reconstruction des intervalles d'accumulation** : réutiliser tel quel `buildIntervals(rows)` de `weather-learning.js:81-103` — il est déjà générique (`{cav_id, date, kg}` → intervalles `{cavId, start, end, days, kg}`), aucune duplication nécessaire.
  3. **Débit normalisé par CAV** : comme `weather-learning.js:166-176` (`perCav` : kg/jour propre à chaque CAV), pour neutraliser la taille du site avant de chercher l'effet du signal candidat.
  4. **Test statistique** : régression (ou corrélation partielle) du débit normalisé sur le signal candidat, **en contrôlant** `nb_containers` et la commune (effets fixes) pour ne pas confondre densité de flux et densité de conteneurs. Split temporel entraînement/validation (comme `backtest-predictions.js` compare deux formules sur des points « as-of D » reconstruits depuis `tonnage_history`) : le facteur n'est retenu que s'il réduit la MAE sur la période de validation, pas seulement sur l'échantillon d'apprentissage.
  5. **Garde de mise en production**, à l'identique de `weather-learning.js:181-186` : nombre minimal de CAV couverts par le signal (ex. ≥ 30, sachant que les sites eco-counter et flux piétons sont peu nombreux — cf. risques), et amélioration de MAE statistiquement distinguable du bruit (bootstrap ou intervalle de confiance ne contenant pas 0).
  6. Si validé : nouvelle table `predictive_density_factors` (miroir de `predictive_weather_factors`, `init-db.js:1420-1428`) lue par `predictions.js` avec cache, **en complément** — jamais en remplacement — du correcteur de zone existant (`predictions.js:483-507`).
- **Sources croisées** : `eco-counter-*`, `rouen_flux-pietons_vd` × `cav.geom` × `tonnage_history`.
- **Granularité** : CAV (signal statique ou mensuel selon la source), intervalle de collecte (pour le test).
- **Consommateur et écran cible** : `AdminPredictive.jsx` (nouvel encart « Fréquentation piétonne — apprentissage », sur le modèle de l'encart météo existant, `AdminPredictive.jsx` section « Moteur prédictif », `:292`), moteur `predictFillRate`.
- **Prérequis phase 2** : compter le nombre de sites `eco-counter-sites` et de sites `rouen_flux-pietons_vd` réellement disponibles et leur répartition géographique (le second est **limité au centre historique de Rouen** d'après sa description — sur 209 CAV répartis sur toute la Métropole, la couverture risque d'être trop faible pour un test significatif hors centre-ville).
- **Effort** : L. **Valeur** : 3 (potentiel réel, mais conditionné à une couverture géographique suffisante — à vérifier avant d'investir).
- **Risques / donnée absente** : (a) **corrélation ≠ causalité** — un flux piéton élevé peut simplement co-varier avec la densité commerciale ou résidentielle (déjà visée par P-MOB-05/06), sans lien causal direct avec le dépôt textile ; (b) **sur-apprentissage** — tester plusieurs signaux candidats (piétons, vélos, MOS, résidences) sur les mêmes ~209 CAV multiplie le risque de faux positifs : les hypothèses doivent être posées avant le test, pas choisies après coup parmi celles qui « marchent » ; (c) **CAV hors couverture** → `frequentationProxy = null`, le moteur retombe sur le proxy actuel (`nb_containers >= 3`) sans jamais halluciner une valeur.

### P-MOB-05 — Densité réelle (bâti/occupation du sol) en remplacement du proxy `nb_containers`

- **Indicateur / fonction produite** : `cav.densite_batie_300m` (nombre de bâtiments dans un rayon de 300 m, ou surface bâtie cumulée) et/ou `cav.mos_categorie` (catégorie d'occupation du sol du point), candidats pour remplacer le bonus actuel `if (cav.nb_containers >= 3) rawFill *= 1.1` (`predictions.js:386-388`, config `densityThreshold`/`densityBonus` à `predictions.js:102-103`), qui n'est qu'un proxy grossier (le nombre de conteneurs posés sur un site reflète une décision opérationnelle passée, pas la densité de population réelle autour).
- **Méthode** :
  1. Import de `cadastre-batiments-…` et/ou `mode-doccupation-des-sols-mos-…` en tables PostGIS (`cadastre_batiments(geom)`, `mos_occupation(categorie, geom)`).
  2. Calcul par CAV : `SELECT COUNT(*) FROM cadastre_batiments WHERE ST_DWithin(geom::geography, cav.geom::geography, 300)` (comptage de bâtiments à 300 m) et/ou `SELECT categorie FROM mos_occupation WHERE ST_Contains(geom, cav.geom)` (catégorie du point).
  3. **Même protocole de backtest que P-MOB-04** (réutilisation de `buildIntervals`/débit normalisé/split validation) : le nouveau signal continu remplace le seuil binaire `nb_containers >= 3` **seulement si** il réduit mesurablement la MAE de `predictFillRate` sur la période de validation. Sinon, le proxy actuel reste en place — jamais de changement de moteur sans preuve.
- **Sources croisées** : cadastre bâtiments et/ou MOS × `cav.geom` × `tonnage_history`.
- **Granularité** : CAV (statique).
- **Consommateur et écran cible** : `predictFillRate` (remplace `densityThreshold`/`densityBonus`), `AdminPredictive.jsx:765-766` (les deux `ParamInput` existants deviennent soit obsolètes soit recalibrés sur le nouveau signal), fiche CAV (affichage informatif de la densité mesurée).
- **Prérequis phase 2** : lire le schéma MOS pour connaître les catégories exactes disponibles (résidentiel collectif/individuel, commerce, équipement…) — sans cette lecture, impossible de savoir si la granularité est assez fine pour distinguer un CAV de centre-ville d'un CAV pavillonnaire.
- **Effort** : L. **Valeur** : 4 (corrige un proxy explicitement documenté comme grossier dans le code lui-même, `predictions.js:386-387` « basé sur le nombre de conteneurs »).
- **Risques / donnée absente** : cadastre/MOS peuvent avoir des trous (bâtiments non recensés dans une commune périphérique de l'EPCI élargi) → `densite_batie_300m = null`, jamais 0 par convention (0 bâtiment mesuré ≠ donnée absente, distinction à coder explicitement comme le fait déjà `analyse-gps.js:59-64` pour ses propres mesures — `num()` ne convertit jamais l'absence en 0). Le remplacement du proxy doit être un **interrupteur** (config admin), pas une bascule irréversible, pour pouvoir revenir en arrière si le nouveau signal se révèle moins stable en production que prévu par le backtest.

### P-MOB-06 — Typologie de bornes (segmentation des apports)

- **Indicateur / fonction produite** : `cav.typologie_zone` (catégorielle : `centre_ville_pieton` / `residentiel_dense` / `periurbain` / `zone_commerciale` / `proche_dechetterie`), calculée par une règle documentée combinant les signaux déjà construits par P-MOB-02 (zone piétonne), P-MOB-05 (densité bâtie/MOS), et les distances aux déchèteries (`reseau-de-decheteries-…`) et arrêts Astuce.
- **Méthode** :
  1. Règle de classification **explicite et non apprise** (arbre de décision documenté, pas de ML boîte noire) : ex. `dans_zone_pietonne = true` → `centre_ville_pieton` ; sinon `mos_categorie` résidentiel collectif dense → `residentiel_dense` ; sinon MOS commerce/activité à proximité → `zone_commerciale` ; sinon distance déchèterie < 500 m → `proche_dechetterie` (catégorie prioritaire sur `periurbain` car le comportement de dépôt y diffère probablement, à vérifier) ; défaut → `periurbain`.
  2. Champ éditable manuellement par un ADMIN (comme le rattachement communal, `communes.js:389-403`) : une bascule automatique lors d'un rafraîchissement des couches ne doit **jamais écraser silencieusement** une correction humaine — même doctrine que le seed communes (`communes-metropole-rouen.json`, `cartographie-solidata.md §1.2`, jamais réécrit une fois peuplé) ou le seed V7 du configurateur de chaîne (2.40.0, « un plan supprimé ne revient jamais »).
  3. Usage en amont du moteur : une fois suffisamment de tonnage accumulé par typologie, le correcteur de zone actuel (boîte lat/lng ad hoc, `predictions.js:483-507`) peut être complété par un correcteur **par typologie** — regroupement plus interprétable qu'une boîte géographique arbitraire, avec la même garde de taille d'échantillon (`count >= 5`, `predictions.js:503`).
- **Sources croisées** : MOS/cadastre × zones piétonnes × déchèteries × arrêts Astuce × `cav.geom`.
- **Granularité** : CAV (statique, revue périodique).
- **Consommateur et écran cible** : `AdminCAV.jsx` (nouveau champ + filtre), carte des CAV (légende couleur par typologie), aide à la décision **fréquence de passage / taille de conteneur** (décision humaine du planificateur, jamais automatisée par ce champ seul), `route-templates` (modèles de tournées).
- **Prérequis phase 2** : arbitrer les seuils de distance avec le client (déchèterie, arrêt Astuce) — ce sont des choix métier, pas des faits techniques.
- **Effort** : L. **Valeur** : 4 (bénéfices croisés : planification, communication élus, et amorce d'un correcteur de moteur plus robuste que la boîte lat/lng actuelle).
- **Risques / donnée absente** : un CAV sans aucune couche disponible (hors MOS, hors filaire) reste `typologie_zone = null` (« non classé »), jamais forcé dans `periurbain` par défaut — la catégorie par défaut doit rester une classification positive, pas un fourre-tout silencieux.

### P-MOB-07 — Saisonnalité des dépôts liée aux résidences étudiantes

- **Indicateur / fonction produite** : `cav.proche_residence_etudiante` (booléen) et un facteur candidat de sur-collecte en fin d'année universitaire (juin-septembre), testé et intégré selon le même protocole que la météo apprise, en vérifiant d'abord qu'il n'est pas déjà capté par les facteurs existants.
- **Méthode** :
  1. `ST_DWithin(cav.geom, residence.geom, 300-500m)` sur `residences-etudiants-metropole-rouen-normandie`.
  2. Comparaison **avant tout nouveau facteur** avec les réglages déjà en place : `schoolVacationFactor` (0,90), `postVacationBonus` (1,05), `summerVacationFactor` (1,0) (`predictions.js:114-117`, appliqués `:357-366`) — l'objectif est de vérifier si les CAV proches de résidences étudiantes montrent un **écart résiduel** par rapport à ces facteurs généraux sur juin-septembre, et non de dupliquer un effet déjà couvert (même discipline que `weather-learning.js:19-23` : « l'effet week-end de base reste porté par les facteurs jour-de-semaine appris — pas de double compte »).
  3. Si écart résiduel mesuré et statistiquement significatif (même protocole de backtest que P-MOB-04) : nouveau facteur `residenceEtudianteBonus`, appliqué uniquement aux CAV taggés, avec la garde de taille d'échantillon standard.
- **Sources croisées** : résidences étudiantes × `cav.geom` × `tonnage_history` (fenêtre juin-septembre) × facteurs vacances existants.
- **Granularité** : CAV × période (juin-septembre).
- **Consommateur et écran cible** : `predictFillRate` (facteur additionnel conditionnel), `AdminPredictive.jsx` (encart dédié si validé).
- **Prérequis phase 2** : nombre de résidences étudiantes recensées dans le jeu et leur répartition (le phénomène est connu nationalement — pics de dons textiles aux départs de campus — mais son ampleur locale reste à mesurer).
- **Effort** : M. **Valeur** : 3.
- **Risques / donnée absente** : risque élevé de **double compte** avec `postVacationBonus`/`summerVacationFactor` déjà en place si le test n'isole pas correctement l'effet résiduel — à traiter comme un raffinement du modèle vacances existant, pas comme un facteur indépendant, sous peine de sur-corriger les CAV concernés.

### P-MOB-08 — Fiabilisation et généralisation du client open data MRN

- **Indicateur / fonction produite** : un client HTTP partagé et fiable pour interroger `data.metropole-rouen-normandie.fr`, remplaçant la cascade de noms de datasets non vérifiés d'`events-auto.js` et servant de fondation aux propositions P-MOB-01 à P-MOB-07.
- **Méthode** :
  1. **Correctif immédiat** : `fetchMetropoleRouen` (`backend/src/routes/tours/events-auto.js:244-291`) teste aujourd'hui la cascade `['evenements-publics-openagenda', 'agenda-des-manifestations-702588', 'evenements', 'agenda']` (`:248-253`) — **aucun de ces quatre identifiants n'apparaît dans l'inventaire vérifié**, alors que `agenda-metropole-rouen-normandie` y est explicitement listé comme **Vérifié** (§2.7 de l'inventaire, ligne 74 du tableau : « Agenda de la MRN — Événements publics du territoire »). Ajouter `agenda-metropole-rouen-normandie` **en tête** de la cascade `:249` (les autres noms restent en repli, coût nul).
  2. **Factorisation** : extraire `httpGet` (`events-auto.js:84-101`, avec suivi de redirection et timeout) et le motif de pagination Explore API v2.1 dans un module partagé `services/opendata-mrn-client.js` exposant `fetchDataset(datasetId, {where, limit, orderBy, select})`, avec cache TTL et compteur d'appels (même esprit que `traffic.js:41-74`). Ce module devient la dépendance commune de P-MOB-01 (travaux), P-MOB-02/03 (imports ponctuels ZFE/filaire), P-MOB-04/05/07 (imports ponctuels flux/MOS/résidences) — au lieu de six implémentations HTTP divergentes.
- **Sources croisées** : n/a (infrastructure).
- **Granularité** : n/a.
- **Consommateur et écran cible** : `events-auto.js` (correction immédiate), tous les jobs des propositions ci-dessus.
- **Prérequis phase 2** : vérifier via `curl` (commande §6) que `agenda-metropole-rouen-normandie` répond bien et porte des champs de géolocalisation exploitables par `isEventNearCav` (`context.js:99-103`).
- **Effort** : S. **Valeur** : 4 (débloque tout le reste à faible risque).
- **Risques / donnée absente** : si aucun des noms de la cascade ne répond (portail changé, dataset retiré), `fetchMetropoleRouen` continue de renvoyer un tableau vide sans erreur bloquante — comportement déjà correct (`events-auto.js:283`, `catch { /* dataset non trouvé, essayer le suivant */ }`), à conserver.

---

## 4. Contribution à la « fiche commune » des élus et à la fiche borne

**Fiche commune** (en complément des indicateurs déjà produits par `/metropole/captation-par-commune`, `metropole.js:388-439`) :
- Nombre de CAV dans la commune, part en ZFE (P-MOB-02), part en zone piétonne (P-MOB-02).
- Typologie dominante des bornes de la commune (P-MOB-06) — utile pour expliquer un écart de captation kg/hab/an par un contexte urbain plutôt que par une insuffisance de service.
- Chantiers actifs à proximité des CAV de la commune sur la période du rapport (P-MOB-01), à titre contextuel (« la baisse de collecte de septembre coïncide avec la fermeture de la rue X »).
- CAV proches d'une résidence étudiante (P-MOB-07), pertinent pour les communes universitaires.
- Repère informatif : part des véhicules à faibles émissions dans le renouvellement de flotte **de la Métropole** (`renouvellement_flotte_mrn`) comme élément de contexte pour la propre trajectoire de renouvellement de flotte de Solidarité Textiles (comparaison, pas une jointure).

**Fiche borne (AdminCAV.jsx)** — attributs à ajouter, tous avec repli explicite « non déterminé » plutôt qu'une valeur inventée :
- `dans_zfe`, `dans_zone_pietonne` (+ horaires si applicables) — P-MOB-02.
- `troncon_filaire_id` / nom de voie normalisé, écart éventuel avec `commune` saisie — P-MOB-03.
- `frequentation_proxy` (si validé par le backtest P-MOB-04), `densite_batie_300m` / `mos_categorie` (si validé par P-MOB-05) — affichés comme **signaux mesurés**, distincts des facteurs qui influencent réellement le moteur (doctrine de transparence déjà appliquée à `contextUsed`/`factors`/`learning` dans la réponse de `predictFillRate`, `predictions.js:532-565`).
- `typologie_zone` — P-MOB-06.
- `proche_residence_etudiante` — P-MOB-07.
- `chantier_actif` (dynamique, calculé à l'affichage, jamais persisté comme attribut statique du CAV) — P-MOB-01.
- Un horodatage de dernière synchronisation par couche (`zfe_maj_le`, `filaire_maj_le`, etc.) — pour que l'admin sache si l'information affichée date d'hier ou de plusieurs mois, dans le même esprit que `traffic_measured_at` (`traffic.js:394-402`) qui distingue explicitement une mesure fraîche d'une valeur héritée.

---

## 5. Points de vigilance

- **Quota API partagé** : TomTom (incidents + routage + Flow Segment) fonctionne déjà sous contrainte de quota documentée (`traffic.js:24-40`, `routing-tomtom.js:17-24`). Toute nouvelle intégration open data MRN doit suivre la **même discipline de cache par job planifié** plutôt que d'appeler l'Explore API à chaque ouverture d'écran — l'API Opendatasoft/Huwise n'a pas de limite connue documentée dans l'inventaire, ce qui est un risque en soi (pas de garde-fou visible côté fournisseur).
- **Fraîcheur du jeu `travaux-json`** : confirmé par recherche web (6/09/2026) — l'éditeur qualifie lui-même ce partage d'information de « expérimental », et précise que « tous les projets présentés sont susceptibles d'évoluer dans leur période de réalisation, la nature de leurs intervenants ou leurs nuisances ». **Ce jeu ne doit donc jamais servir de base à un refus automatique de collecte** — seulement à une alerte datée et vérifiable (P-MOB-01), avec la date de dernière mise à jour toujours affichée à côté.
- **Sur-apprentissage / corrélation ≠ causalité** : la base d'apprentissage est petite (209 CAV). Tester plusieurs signaux candidats (P-MOB-04, P-MOB-05, P-MOB-07) sur le même échantillon augmente le risque de faux positifs (comparaisons multiples). Discipline à suivre : poser l'hypothèse et le seuil de validation **avant** de lancer le test (comme documenté dans `weather-learning.js:1-30`), et valider par un découpage temporel entraînement/validation (comme `scripts/backtest-predictions.js`) plutôt que par un simple ajustement sur l'ensemble des données disponibles.
- **ZFE réglementaire vs opérationnel** : recherche web du 6/09/2026 — le calendrier ZFE-m de Rouen Métropole n'exclut aujourd'hui (2026) que les véhicules Crit'Air 5 et non classés (une source mentionne une possible extension au Crit'Air 4, sans date confirmée). Le périmètre géographique concerne 13 communes. Deux conséquences pour SOLIDATA : (a) l'essentiel du parc d'utilitaires (généralement Crit'Air 1-3) n'est **pas concerné aujourd'hui** — l'urgence opérationnelle de P-MOB-02 est donc modérée à court terme, mais (b) le calendrier étant **révisable par la Métropole sans préavis long**, le seuil Crit'Air interdit doit être un réglage (`settings`), jamais une valeur codée en dur, pour ne pas se retrouver silencieusement caduc à la prochaine étape.
- **Redondance TomTom / MRN** : le type d'incident `travaux` existe déjà côté TomTom (catégorie 9, `traffic.js:91`) — il capte déjà une partie des chantiers générant un ralentissement mesurable. `travaux-json` apporte une information **différente et complémentaire** (chantiers annoncés en amont, avant tout impact trafic mesurable), pas un remplacement ; les deux sources doivent rester visuellement distinctes (label de provenance) pour que l'utilisateur ne les confonde pas.
- **Couverture géographique inégale** : `rouen_flux-pietons_vd` est limité au centre historique de Rouen ; `eco-counter-sites` est vraisemblablement peu nombreux (quelques dizaines de points tout au plus) au regard des 209 CAV répartis sur ~71 communes. Un signal open data avec une couverture trop faible produirait plus de `null` que de valeurs exploitables — à quantifier en phase 2 avant tout investissement de développement.
- **Doctrine « jamais de valeur inventée »** : chaque proposition ci-dessus prévoit un repli `null` explicite en cas de donnée absente (aucun 0 ni valeur par défaut silencieuse), conformément au principe déjà appliqué dans tout le module Collecte (`analyse-gps.js:59-64`, `traffic.js:167-176`, `weather-learning.js` intégralement). Ce principe doit être repris à l'identique pour toute nouvelle colonne `cav.*` issue de l'open data.

---

## 6. Questions à trancher et vérifications API de phase 2

**Questions à trancher (client / direction)** :
1. Le seuil Crit'Air interdisant l'accès ZFE aux utilitaires SOLIDATA doit-il être suivi manuellement (veille rouen.fr/zfe) ou une automatisation de la lecture du calendrier ZFE est-elle souhaitée malgré l'absence d'API officielle dédiée détectée à ce jour ?
2. Les seuils de distance de la typologie de bornes (P-MOB-06 : 300 m résidence étudiante, 500 m déchèterie, etc.) sont des choix métier — à valider avec le planificateur collecte, pas à figer techniquement.
3. Faut-il conditionner l'automatisation d'un détour/alerte chantier (P-MOB-01) à une validation humaine systématique (cohérent avec le caractère « expérimental » du jeu), ou seulement au-delà d'un seuil de gravité déclaré ?

**Vérifications API à exécuter en phase 2** (depuis un hôte non filtré) :

```bash
BASE=https://data.metropole-rouen-normandie.fr/api/explore/v2.1

# 1. Schéma et fraîcheur du jeu travaux (géométrie exploitable ? dates de validité ?)
curl -s "$BASE/catalog/datasets/travaux-json" | jq '{fields:[.fields[]|{name,type,label}], metas:.metas.default}'
curl -s "$BASE/catalog/datasets/travaux-json/records?limit=20" | jq '.results[0]'

# 2. ZFE et zones piétonnes — géométrie + attributs (commune, dates d'entrée en vigueur)
curl -s "$BASE/catalog/datasets/zfe-m-metropole-rouen-normandie/exports/geojson" -o zfe.geojson
curl -s "$BASE/catalog/datasets/zones-pietonnes-rouen/exports/geojson" -o zones-pietonnes.geojson
curl -s "$BASE/catalog/datasets/zones-pietonnes-rouen" | jq '.fields'

# 3. Filaire de voies — nom de voie, sens de circulation, commune
curl -s "$BASE/catalog/datasets/filaire-de-voies-metropolitain-par-troncons" | jq '.fields'
curl -s "$BASE/catalog/datasets/filaire-de-voies-metropolitain-par-troncons/exports/geojson" -o filaire-voies.geojson

# 4. Comptages piétons/vélo — couverture géographique réelle (nb de sites, répartition)
curl -s "$BASE/catalog/datasets/eco-counter-sites/exports/geojson" -o eco-counter-sites.geojson
curl -s "$BASE/catalog/datasets/eco-counter-sites/records?limit=100" | jq '.total_count, [.results[] | {id, lat:.geo_point_2d}]'
curl -s "$BASE/catalog/datasets/rouen_flux-pietons_vd" | jq '.fields'
curl -s "$BASE/catalog/datasets/rouen_flux-pietons_vd/records?limit=20" | jq '.results'

# 5. MOS et cadastre bâtiments — catégories disponibles, volumétrie
curl -s "$BASE/catalog/datasets/mode-doccupation-des-sols-mos-metropole-rouen-normandie" | jq '.fields'
curl -s "$BASE/catalog/datasets/cadastre-batiments-metropole-rouen-normandie-sage-cailly-aubette-robec" | jq '.fields, .metas.default.records_count'

# 6. Résidences étudiantes et déchèteries — volumétrie
curl -s "$BASE/catalog/datasets/residences-etudiants-metropole-rouen-normandie/records?limit=100" | jq '.total_count'
curl -s "$BASE/catalog/datasets/reseau-de-decheteries-metropole-rouen-normandie/exports/geojson" -o decheteries.geojson

# 7. Correction de la cascade events-auto.js : confirmer l'identifiant réel de l'agenda
curl -s "$BASE/catalog/datasets/agenda-metropole-rouen-normandie" | jq '.fields, .metas.default.records_count'
curl -s "$BASE/catalog/datasets/agenda-metropole-rouen-normandie/records?limit=5" | jq '.results'

# 8. donmetdec_pav — présence effective de bornes textiles gérées par un tiers (rapprochement/doublons)
curl -s "$BASE/catalog/datasets/donmetdec_pav" | jq '.fields'
curl -s "$BASE/catalog/datasets/donmetdec_pav/records?where=search(%22textile%22)&limit=100" | jq '.total_count'

# 9. Fraîcheur de TOUS les jeux ci-dessus en une passe
curl -s "$BASE/catalog/datasets?limit=100&select=dataset_id,metas.default.modified,metas.default.records_count" \
  | jq '[.results[] | select(.dataset_id | IN("travaux-json","zfe-m-metropole-rouen-normandie","zones-pietonnes-rouen","filaire-de-voies-metropolitain-par-troncons","eco-counter-sites","rouen_flux-pietons_vd","agenda-metropole-rouen-normandie"))]'
```

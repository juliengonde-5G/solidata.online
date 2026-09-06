# Emploi, insertion & ESS — agrégations open data Métropole × SOLIDATA

> Agent thématique « EMPLOI, INSERTION & ESS » — chantier de cadrage open data, 6 septembre 2026.
> Périmètre reçu : `spaser-12012024`, `lieux-d-inclusion-numerique` (DORA), `repertoire-national-des-associations`, résidences sociales/jeunes, + sources externes QPV/INSEE/data.inclusion.
> Sources : inventaire catalogue (§2.5 et §3), cartographie SOLIDATA (§1, §2, §6, §7), lecture directe du dépôt (fichier:ligne cités), 4 recherches web (sur 6 autorisées).

---

## 1. Périmètre et enjeu métier

SOLIDATA connaît aujourd'hui la commune de résidence de chaque salarié (`employees.city`/`postal_code`, texte libre, sans code INSEE) mais ne peut ni la vérifier, ni la croiser à un contexte territorial (chômage, pauvreté, QPV), ni la restituer à un élu sans risque de désanonymisation sur une petite commune. Le module Insertion produit déjà des agrégats non nominatifs solides (`gatherAuditKpis`, `kpi-insertion`, `sortie-dynamique`) mais **uniquement à l'échelle de la structure entière** — jamais par commune de résidence. Le reporting Métropole territorialise la **collecte** (`/captation-par-commune`) mais pas l'**emploi**.

L'enjeu est double : (1) objectiver l'« avantage » de l'activité pour chaque commune membre — combien d'habitants sont en parcours d'insertion chez Solidarité Textiles, quelle part vient de QPV (critère d'éligibilité IAE et indicateur attendu par la DREETS/contrat de ville) — sans jamais nommer une personne ; (2) situer nos propres taux de sortie et freins dans le contexte socio-économique réel de la commune (taux de chômage INSEE) pour que l'avantage produit se lise en creux d'une difficulté objectivée, pas comme un chiffre isolé. Le SPASER et le RNA servent des usages plus périphériques : veille de débouchés (marchés à clauses sociales de la Métropole) et qualification des associations partenaires de collecte — ils ne portent aucune donnée nominative et n'appellent pas de traitement RGPD particulier.

Toute agrégation touchant la commune de résidence d'un salarié est un traitement de données personnelles indirectement identifiantes (une commune de 300 habitants avec 3 salariés en parcours = ré-identification triviale) : chaque proposition ci-dessous porte donc un seuil d'anonymat, une base légale et un « cas donnée absente » explicites.

---

## 2. Jeux de données retenus

| Identifiant / source | Certitude | Granularité | Fraîcheur connue | Clé de jointure vers SOLIDATA | Usage |
|---|---|---|---|---|---|
| `spaser-12012024` (portail MRN) | **V** — vu, `inventaire-catalogue.md:111` | Marché × année (extrait 12/01/2024) | inconnue (annuelle supposée) | aucune jointure automatique — veille documentaire (objet du marché, clause sociale, entreprise attributaire) | P-EMP-06 |
| `lieux-d-inclusion-numerique` (portail MRN, articulé DORA) | **V** — vu, `inventaire-catalogue.md:112` | Point (lieu) | inconnue | rapprochement géographique (distance) avec `association_points`/`cav` | P-EMP-07 |
| `repertoire-national-des-associations-metropole-rouen-normandie` (extrait RNA sur le portail MRN) | **V** — vu, `inventaire-catalogue.md:113` | Association (raison sociale, adresse, objet) | inconnue | rapprochement par nom normalisé avec `association_points.nom` | P-EMP-08 |
| `residences-sociales-metropole-rouen-normandie`, `residences-jeunes-…`, `residences-etudiants-…` | **V** — vus, `inventaire-catalogue.md:120-123` | Point | inconnue | rapprochement géographique avec le domicile déclaré (agrégé) des salariés — usage à cadrer (§5) | P-EMP-09 |
| **QPV Métropole Rouen Normandie 2024** (16 quartiers / 14 communes) | **S** — confirmé par recherche web (SIG Ville, INSEE Dossier Normandie n°14), portail MRN lui-même ne l'expose pas (`inventaire-catalogue.md:104,156-159`) | Quartier (IRIS agrégés) | 2024 (contrat de ville CVN284) | commune ou IRIS de résidence → liste de communes/IRIS QPV | P-EMP-01, P-EMP-02 |
| **INSEE — API Données locales** (chômage, Filosofi, population, RP) | **?** — API existe et documentée (data.gouv.fr, insee.fr), clé api.insee.fr non testée depuis cet environnement | Commune / IRIS / EPCI | millésimes multiples (RP annuel, Filosofi souvent N-2) | code INSEE commune | P-EMP-03, P-EMP-04, P-EMP-05 |
| **INSEE — Dossier social infra-urbain et QPV MRN n°14 (2019)** | **V** — trouvé (`insee.fr/fr/statistiques/4178620`) | Quartier | 2019 (millésime figé, pas de flux API identifié) | nom de quartier / commune | P-EMP-01 (repère qualitatif, pas une API à interroger en boucle) |
| **data.inclusion / DORA — Référentiel de l'offre d'insertion** | **S** — jeu confirmé sur data.gouv.fr (structures + services, CSV/GeoJSON/JSON/Parquet), API disponible | Structure d'insertion | continue (mises à jour par les structures elles-mêmes) | rapprochement par nom/SIRET avec `insertion_partenaires` | P-EMP-07 (complément à `lieux-d-inclusion-numerique`) |
| **France Travail / Plateforme de l'inclusion — emplois francs / critères IAE** | **?** — page FAQ confirmée, pas d'API publique de correspondance adresse→QPV identifiée pour un tiers hors PASS IAE | — | — | aucune jointure directe ; sert de référence documentaire pour les critères d'éligibilité déjà en partie couverts par `candidates`/`employees` (RQTH, etc.) | contexte de P-EMP-01 |
| Enquêtes internes SOLIDATA (`enquete_reponses`) | interne, déjà en base | anonyme structurel | continue | aucune — sert de modèle de seuil (§3) | référence méthodologique pour P-EMP-01 à P-EMP-05 |

---

## 3. Propositions d'agrégations

### P-EMP-01 — Part des salariés en parcours résidant en QPV

- **Indicateur produit** : nombre et part (%) de salariés `insertion_status = 'en_parcours'` dont la commune de résidence normalisée figure dans la liste des 14 communes QPV de la Métropole (indicateur communal, pas de détection à l'IRIS faute de code IRIS fiable côté SOLIDATA).
- **Formule / méthode** : (1) normaliser `employees.city`/`postal_code` en code INSEE via la BAN (`services/geocodage.js:32-56`, `chercherAdresse` renvoie déjà `code_insee`) ou, mieux, ajouter un champ dédié `employees.code_insee_residence` alimenté à la saisie RH (le champ de commune est aujourd'hui du texte libre non validé, `init-db.js:3158-3159`) ; (2) rapprocher ce code INSEE de la liste des communes QPV (14 communes — un simple drapeau commune, pas un contour IRIS précis, car SOLIDATA n'a pas l'IRIS du domicile) ; (3) compter, agréger.
- **Sources croisées** : `employees.city/postal_code` (ou nouveau champ code INSEE) × liste des communes QPV 2024 (SIG Ville / INSEE Dossier Normandie n°14) — jeu à charger en table de référence statique côté SOLIDATA (mise à jour manuelle au rythme des révisions du contrat de ville, ~tous les 6-8 ans).
- **Granularité** : structure entière + éventuellement par équipe (proxy filière), jamais par commune isolée si l'effectif de la commune est < seuil.
- **Consommateur et écran cible** : `AuditInsertion` (nouvel indicateur dans la section « typologies des publics », à côté de RQTH — cf. `insertion/routes.js:2814-2833`) ; export DREETS/Convergence si demandé (le CDC mentionne déjà QPV/ZRR en typologie attendue, `rapports/insertion-2026-07-22/01-cadrage-conformite.md:302`).
- **Prérequis phase 2** : (a) fiabiliser `employees.city` en code INSEE (champ structuré ou géocodage à la saisie) ; (b) charger et maintenir la liste des 14 communes QPV en base (`referentiel_communes` ou table dédiée `qpv_communes`) ; (c) trancher la granularité IRIS vs commune (l'IRIS est plus précis mais nécessite l'adresse complète géocodée, que SOLIDATA n'a pas pour les salariés — seulement ville/CP).
- **Effort** : M (normalisation de données existante + une table de référence statique, pas de nouveau flux temps réel).
- **Valeur** : 5 — c'est un indicateur explicitement demandé par le CDC (QPV/ZRR) et un argument fort en revue de convention.
- **Risques, RGPD et cas « donnée absente »** : donnée de résidence = donnée à risque de ré-identification sur petite commune → **seuil d'anonymat n ≥ 5** avant toute restitution par commune (aligné sur le seuil déjà en place dans le module Enquêtes, `enquetes.js:7,27-30,121`) ; en dessous, restitution uniquement du total structure (jamais de détail par commune). Base légale : exécution de la convention ACI / obligation de reporting DREETS (pas de consentement à recueillir, c'est une obligation légale de l'employeur SIAE). Journalisation : consultation de l'indicateur QPV à tracer comme les autres lectures sensibles du module (`autoLogActivity`, pattern déjà utilisé pour le PCM). Donnée absente (commune non géocodable, code INSEE introuvable) → exclue du dénominateur et **comptée à part** (« adresses non résolues : N »), jamais assimilée à « hors QPV ».

### P-EMP-02 — Taux de chômage et niveau de vie de la commune de résidence, en regard des freins déclarés

- **Indicateur produit** : pour chaque commune (agrégée, seuil n ≥ 5), taux de chômage INSEE (RP) et revenu médian Filosofi, affichés **à côté** (jamais fusionnés) du nombre de salariés en parcours et de la moyenne des freins déclarés (`freins_moyennes`, `insertion/routes.js:2764-2772`).
- **Formule / méthode** : jointure code INSEE commune ↔ cube INSEE Données locales (taux de chômage localisé, revenu médian Filosofi) ; pas de calcul dérivé, affichage côte à côte pour objectiver le contexte sans laisser croire à une causalité mesurée.
- **Sources croisées** : `employees` (commune de résidence normalisée) × API INSEE Données locales (chômage, Filosofi) × `freins_moyennes` déjà calculé par `gatherAuditKpis`.
- **Granularité** : commune agrégée (n ≥ 5 salariés en parcours par commune pour afficher un détail ; sinon regroupement « autres communes »).
- **Consommateur et écran cible** : `AuditInsertion`, section pilotage direction/CIP ; support à la « fiche commune » des élus (§4).
- **Prérequis phase 2** : obtenir une clé api.insee.fr (le portail précise l'inscription, pas testée depuis cet environnement) ; choisir le millésime Filosofi et RP à figer (les deux ont des rythmes de publication différents, cf. §5) ; construire le même référentiel « code INSEE de résidence » que P-EMP-01.
- **Effort** : M.
- **Valeur** : 4 — utile en revue de convention mais secondaire par rapport à P-EMP-01/P-EMP-03.
- **Risques, RGPD et cas « donnée absente »** : le taux de chômage communal n'est PAS une donnée personnelle (statistique publique agrégée), mais son croisement avec un effectif SOLIDATA petit redevient sensible → même seuil n ≥ 5 que P-EMP-01. Millésime INSEE à afficher explicitement (« chômage T4 2025, source INSEE ») pour ne jamais laisser croire à une donnée temps réel. Absence de donnée INSEE pour une commune (petites communes rurales parfois masquées par le secret statistique INSEE lui-même) → « non disponible (secret statistique) », jamais une valeur interpolée.

### P-EMP-03 — Nombre d'habitants de chaque commune accompagnés par Solidarité Textiles (fiche commune)

- **Indicateur produit** : nombre de salariés en parcours ET nombre de salariés sortis dans l'année (toutes catégories), résidant dans la commune, rapportés à la population INSEE de la commune (déjà disponible : `referentiel_communes.population_insee`, `cartographie-solidata.md:18`) — un ratio « habitants accompagnés / 1000 habitants » symétrique du `kg_par_hab` déjà calculé pour la collecte (`metropole.js:405-411`).
- **Formule / méthode** : `nb_salaries_commune / population_insee_commune × 1000`, sur le même modèle que le calcul déjà en place pour la captation textile — réutilise le même référentiel `referentiel_communes` déjà lié à `cav.code_insee_commune`, à répliquer côté `employees`.
- **Sources croisées** : `employees` (résidence normalisée) × `referentiel_communes.population_insee` (déjà en base, alimenté par `geo.api.gouv.fr`, `communes.js:265`).
- **Granularité** : commune (n ≥ 5), agrégée sur toute commune sous le seuil.
- **Consommateur et écran cible** : nouvelle « fiche commune » (§4) ; `ReportingMetropole.jsx` pourrait porter un second onglet symétrique de « captation par commune » (`ReportingMetropole.jsx:378-450`).
- **Prérequis phase 2** : champ code INSEE de résidence (même prérequis que P-EMP-01) ; décision sur le périmètre (salariés actuels seulement, ou historique cumulé sur N années — un cumul valorise mieux l'impact mais complique l'anonymat au fil des ans).
- **Effort** : S — la mécanique de calcul et le référentiel existent déjà pour la collecte, il s'agit de la répliquer côté RH une fois la commune normalisée.
- **Valeur** : 5 — c'est littéralement l'indicateur demandé par le chantier (« avantages de notre activité pour leur commune »).
- **Risques, RGPD et cas « donnée absente »** : le risque de ré-identification est ici le PLUS ÉLEVÉ de toutes les propositions (une commune avec 1 seul salarié = identification immédiate par les élus locaux eux-mêmes, qui connaissent souvent leurs administrés en insertion) → seuil n ≥ 5 **strict et non contournable**, avec **regroupement automatique** des communes sous le seuil dans une ligne « autres communes de la Métropole » plutôt qu'un simple masquage (pour ne pas laisser deviner un rang). Base légale : intérêt légitime de la structure à valoriser son utilité sociale auprès du financeur/actionnaire public, dans le respect strict de la minimisation (jamais de liste nominative transmise). Donnée absente (résidence non renseignée ou non normalisable) → exclue et comptée à part.

### P-EMP-04 — Comparaison sorties dynamiques SOLIDATA vs contexte de chômage territorial

- **Indicateur produit** : taux de sortie dynamique de l'année (`tauxDynamiques`, déjà calculé, `insertion/routes.js:2812`) affiché en regard du taux de chômage de la Métropole (et, si le volume le permet, des communes principales de résidence des salariés).
- **Formule / méthode** : pas de fusion de calcul — juxtaposition à l'écran de deux séries déjà produites séparément (`gatherAuditKpis` d'un côté, cube INSEE de l'autre).
- **Sources croisées** : `insertion_milestones` (`sortie_classification`, déjà agrégé) × INSEE Données locales (taux de chômage EPCI/commune, par trimestre ou année selon le cube retenu).
- **Granularité** : EPCI (Métropole entière) en première étape — la déclinaison communale suppose un volume de sorties par commune que SOLIDATA n'a probablement pas (effectif trop petit).
- **Consommateur et écran cible** : `AuditInsertion`, bloc « conventionnel » déjà présent (`insertion/routes.js:2892-2913`) — ajout d'une ligne de contexte, pas un nouveau bloc.
- **Prérequis phase 2** : millésime du chômage EPCI à choisir (trimestriel Insee/DARES vs annuel RP) ; clé api.insee.fr.
- **Effort** : S (aucune nouvelle donnée personnelle, juste un appel API et un affichage côte à côte).
- **Valeur** : 3 — utile pour le narratif de la revue de convention, non structurant.
- **Risques, RGPD et cas « donnée absente »** : aucun risque RGPD spécifique (indicateur EPCI global, aucune commune isolée). Cas absent : taux de chômage EPCI non publié pour la période demandée → afficher le dernier millésime disponible avec sa date, jamais d'extrapolation.

### P-EMP-05 — Part de femmes / niveaux de formation des salariés en parcours vs moyenne communale/EPCI

- **Indicateur produit** : comparaison de la répartition F/H et des niveaux de formation des salariés en parcours (déjà calculés de façon non nominative dans `rse.js:159-160` pour F/H et `insertion/routes.js` pour `niveaux_formation`) avec les moyennes INSEE (RP, diplômes/formation) de la Métropole.
- **Formule / méthode** : juxtaposition de deux agrégats déjà produits séparément ; aucune fusion de ligne individuelle.
- **Sources croisées** : `employees.gender`/`civility` (agrégé, `rse.js:159-160`) et `insertion_diagnostics.niveau_formation` (agrégé, `insertion/routes.js` typologies) × INSEE RP (diplômes, structure par sexe de la population active).
- **Granularité** : EPCI global (pas de déclinaison communale ici — le RSEi/RH n'ont pas vocation à ventiler par commune de résidence des salariés).
- **Consommateur et écran cible** : `ReportingRH.jsx` (section « Égalité femmes/hommes » déjà existante) et bilan RSE (`rse.js:1332` consolidation 3 volets).
- **Prérequis phase 2** : clé api.insee.fr ; choix du cube RP pertinent (diplômes, taux d'activité par sexe).
- **Effort** : S.
- **Valeur** : 2 — utile mais périphérique par rapport aux indicateurs QPV/territorialisation qui sont le cœur du chantier.
- **Risques, RGPD et cas « donnée absente »** : aucun (agrégats déjà non nominatifs des deux côtés). Cas absent : cube RP manquant pour l'EPCI → « non disponible », jamais de valeur par défaut.

### P-EMP-06 — Veille des marchés SPASER à clause d'insertion comme débouché

- **Indicateur produit** : liste de veille (non un indicateur chiffré consolidé) des marchés notifiés par la Métropole avec clause sociale/insertion, filtrés par secteur pertinent pour Solidarité Textiles (nettoyage, logistique, espaces verts, réemploi) — usage de prospection commerciale/partenariale, pas de KPI RH.
- **Formule / méthode** : import périodique (manuel ou scripté) du jeu `spaser-12012024`, filtre texte sur l'objet du marché et le secteur, présentation en tableau de veille ; pas de jointure avec les données SOLIDATA.
- **Sources croisées** : aucune jointure interne — jeu externe seul.
- **Granularité** : marché × année.
- **Consommateur et écran cible** : nouvel onglet ou export dans `AdminInsertion`/`PilotageRSE` (« Débouchés & clauses sociales »), ou simplement un rapport ponctuel hors ERP dans un premier temps — pas nécessairement un écran applicatif.
- **Prérequis phase 2** : lire le schéma réel du jeu (colonnes objet/montant/clause/attributaire) via l'API Explore v2.1 (aucun accès direct possible depuis cet environnement, cf. inventaire §4.2) ; vérifier la fraîcheur réelle (l'identifiant `-12012024` suggère un simple export figé, pas un flux vivant).
- **Effort** : S — mais valeur d'usage incertaine tant que le contenu réel du jeu (montants, granularité, fraîcheur) n'est pas vérifié.
- **Valeur** : 2 (à confirmer en phase 2 — pourrait monter si le jeu est vraiment tenu à jour et actionnable).
- **Risques, RGPD et cas « donnée absente »** : aucun risque RGPD (marchés publics, aucune personne physique). Cas absent : jeu non mis à jour depuis 2024 (le nom du dataset le suggère) → à signaler comme tel avant toute exploitation, ne pas présenter comme « les marchés en cours ».

### P-EMP-07 — Rapprochement avec les lieux d'inclusion numérique (DORA) pour orienter un frein numérique

- **Indicateur produit** : liste des lieux d'inclusion numérique (MRN + data.inclusion) à proximité du domicile ou du centre de tri, utilisable par les CIP pour orienter un salarié dont le frein numérique est identifié (le module Insertion gère déjà des freins mais pas de suggestion d'orientation externe).
- **Formule / méthode** : import du jeu `lieux-d-inclusion-numerique` (portail MRN) et, en complément national, du référentiel data.inclusion/DORA (structures + services, filtré thème « numérique ») ; rapprochement géographique simple (rayon autour du centre de tri, coordonnées déjà connues 49.4231°N/1.0993°E) — pas de rapprochement nominatif avec les salariés.
- **Sources croisées** : jeu externe seul, croisé à la géolocalisation du centre de tri (déjà en base) — pas de donnée personnelle en entrée.
- **Granularité** : lieu (point).
- **Consommateur et écran cible** : fiche CIP (`InsertionParcours.jsx` onglet Freins ou Actions CIP), en lecture seule, comme un annuaire de ressources — pas un nouvel indicateur chiffré.
- **Prérequis phase 2** : vérifier le contenu réel du jeu MRN (adresse, horaires, public visé) ; évaluer si `lieux-d-inclusion-numerique` suffit seul ou si l'appel à data.inclusion apporte une réelle valeur ajoutée (couverture nationale, mais l'essentiel de l'activité étant locale, le jeu MRN peut suffire).
- **Effort** : S.
- **Valeur** : 3 — utile opérationnellement aux CIP, mais n'est pas un indicateur de pilotage/reporting.
- **Risques, RGPD et cas « donnée absente »** : aucun (aucune donnée personnelle transmise à l'extérieur, la CIP consulte un annuaire). Cas absent : aucun lieu dans un rayon donné → le dire, ne jamais suggérer un lieu hors rayon sans le signaler comme tel.

### P-EMP-08 — Qualification des associations partenaires via le RNA

- **Indicateur produit** : pré-remplissage et vérification du référentiel `association_points` (tournées associations) avec les données officielles du RNA (numéro RNA/SIRET, objet social déclaré, date de création) — fiabilisation de données de gestion, pas un indicateur d'impact.
- **Formule / méthode** : rapprochement par nom normalisé entre `association_points.nom` et le RNA extrait MRN ; en cas de correspondance, compléter `association_points` avec le numéro RNA (nouveau champ) et signaler les incohérences (association du référentiel SOLIDATA introuvable dans le RNA — à vérifier manuellement, pas forcément une erreur, le RNA n'est pas exhaustif à 100 %).
- **Sources croisées** : `association_points.nom` × `repertoire-national-des-associations-metropole-rouen-normandie`.
- **Granularité** : association.
- **Consommateur et écran cible** : `Referentiels`/écran d'administration des associations (référentiel `association_points`) — action ponctuelle de fiabilisation, pas un tableau de bord récurrent.
- **Prérequis phase 2** : lire le schéma réel du jeu RNA MRN (nom exact du champ objet/adresse) ; script de rapprochement du même type que `services/collaborator-import.js` (upsert idempotent).
- **Effort** : S.
- **Valeur** : 2 — utile en fiabilisation de données de référence, sans impact direct sur le reporting élus.
- **Risques, RGPD et cas « donnée absente »** : aucun (associations = personnes morales, hors RGPD). Cas absent : association non trouvée dans le RNA → conservée telle quelle dans SOLIDATA, jamais supprimée ni marquée invalide sur la seule foi d'une absence de correspondance.

### P-EMP-09 — Repérage des résidences sociales/jeunes à proximité pour contextualiser le logement (frein périphérique)

- **Indicateur produit** : cartographie (interne, outil CIP) des résidences sociales/jeunes/étudiantes de la Métropole, à croiser visuellement (jamais nominativement) avec la répartition des freins « logement » déclarés en agrégat par secteur.
- **Formule / méthode** : import des 3 jeux résidences (points géolocalisés) affichés sur une carte de contexte, à côté (jamais superposés à l'identité) de la moyenne du frein logement (`freins_moyennes.frein_logement`, déjà calculée non nominativement) par grand secteur géographique (pas par commune fine, pour ne jamais suggérer un rapprochement individuel).
- **Sources croisées** : jeux résidences (externes, aucune donnée personnelle) × `freins_moyennes` agrégé structure entière.
- **Granularité** : structure entière uniquement — **explicitement pas de déclinaison communale fine**, le risque de laisser deviner qu'« un salarié du secteur X vit probablement en résidence sociale » est disproportionné par rapport à la valeur ajoutée.
- **Consommateur et écran cible** : à évaluer — usage qualitatif de contexte pour la direction, pas un écran de pilotage individuel.
- **Prérequis phase 2** : évaluer plus précisément l'intérêt métier avant tout développement — cette proposition est la plus fragile du lot et pourrait être abandonnée si le bénéfice ne dépasse pas clairement le risque.
- **Effort** : S (si retenue), mais **valeur/risque à trancher avant tout développement**.
- **Valeur** : 1 — proposition incluse pour complétude du périmètre reçu (« résidences sociales/jeunes »), mais son utilité concrète reste à démontrer et le risque de sur-interprétation par un lecteur non averti est réel.
- **Risques, RGPD et cas « donnée absente »** : risque de **stigmatisation par inférence** (associer un secteur à un type de logement précaire) sans aucune base factuelle individuelle — recommandation : **ne pas la développer en phase 2** sans un besoin métier explicitement formulé par la direction ou les CIP, et si elle l'est, la limiter à un usage interne qualitatif sans indicateur chiffré exporté.

---

## 4. Contribution à la « fiche commune » des élus

| Attribut | Définition | Source | Fréquence | Seuil d'anonymat |
|---|---|---|---|---|
| Nom de la commune | Nom officiel | `referentiel_communes.nom` (déjà alimenté par geo.api.gouv.fr) | à chaque refresh EPCI | — (donnée publique) |
| Population INSEE | Population municipale légale | `referentiel_communes.population_insee` | annuelle (RP, millésime à tracer) | — (donnée publique) |
| Tonnage textile collecté / hab. | `kg_par_hab` déjà produit | `metropole.js` `/captation-par-commune` (`:405-411`) | annuelle | — (données de collecte, non personnelles) |
| **Nombre d'habitants accompagnés en parcours d'insertion** | Salariés `en_parcours` résidant dans la commune (P-EMP-03) | `employees` (résidence normalisée) | annuelle | **n ≥ 5**, sinon regroupé dans « autres communes » |
| **Nombre de sorties dynamiques de la commune** | Salariés sortis en emploi durable/transition/positif dans l'année, résidant dans la commune | `insertion_milestones` (résidence normalisée, P-EMP-03 étendu) | annuelle | **n ≥ 5** |
| **Part de résidents en QPV parmi les salariés en parcours** | P-EMP-01 | `employees` × liste QPV 2024 | à la révision du contrat de ville (~2024, ~2030) | **n ≥ 5** au niveau structure ; **jamais** de détail par commune QPV isolée |
| Contexte : taux de chômage communal | Repère de contexte, jamais un chiffre SOLIDATA | INSEE Données locales | selon cube (trimestriel/annuel) | — (statistique publique) |
| Tonnage / heures d'insertion générées par les marchés SPASER (si le jeu le permet) | P-EMP-06, à confirmer en phase 2 | `spaser-12012024` | annuelle (à vérifier) | — (marchés publics) |

La fiche commune ne doit **jamais** exposer un chiffre individuel de parcours ou de sortie en dessous du seuil : sous 5, la ligne « habitants accompagnés » et « sorties dynamiques » de cette commune doivent basculer dans une ligne agrégée « autres communes de la Métropole », exactement comme le module Enquêtes le fait déjà pour ses campagnes (`enquetes.js:121`, `:158`).

---

## 5. Points de vigilance

**RGPD — données de résidence et QPV**
- La commune de résidence d'un salarié en parcours d'insertion, croisée à un statut d'insertion, est une donnée à risque de ré-identification élevé dès que l'effectif communal est faible — c'est le point de vigilance n°1 de tout ce chantier. Le seuil n ≥ 5 retenu partout ci-dessus reprend celui déjà validé et documenté pour le module Enquêtes (`enquetes.js:7,27-30`) ; il doit être appliqué **à la restitution**, jamais au calcul (le calcul interne peut connaître le détail, seule la sortie — écran, export, PDF remis à un élu — est bridée).
- Le rattachement d'un salarié à un QPV n'est pas en soi une donnée « article 9 » (santé, opinions…), mais combiné à d'autres critères d'éligibilité IAE (RQTH — déjà art. 9, situation judiciaire — déjà chiffrée art. 10, `rgpd.js`/`freins-registry.js`), il concourt à un profil socio-économique sensible. La minimisation impose de ne jamais construire un croisement à trois facteurs ou plus (commune × QPV × frein spécifique) qui isolerait de fait un individu, même sous couvert d'agrégat.
- **Base légale** : pour les indicateurs de pilotage interne et de reporting DREETS/Convergence, l'exécution d'une obligation légale/conventionnelle (convention ACI, reporting IAE) couvre la finalité — pas besoin de consentement individuel. Pour la « fiche commune » remise aux élus, la base légale est l'intérêt légitime de la structure (valorisation de l'utilité sociale auprès de son financeur public), à condition stricte que rien de nominatif ni d'indirectement identifiant n'y figure : c'est un argument de plus pour ne jamais descendre sous le seuil.
- **Registre art. 30** : aucune des propositions ci-dessus ne crée un nouveau traitement de données personnelles distinct — elles enrichissent le traitement « accompagnement socio-professionnel » déjà couvert (mention dans `insertion_notes_profil`, cf. `init-db.js:4285` pour le PCM comme modèle de fiche registre). Une **entrée dédiée** « Territorialisation des indicateurs d'insertion (agrégats communaux, seuil n≥5) » devrait néanmoins être ajoutée au registre (`rgpd_registre`, `rgpd.js:26-58`) dès que le champ de résidence normalisé sera introduit, pour documenter précisément la nouvelle finalité (reporting élus) et la durée de conservation des agrégats.
- **Journalisation** : toute génération de la « fiche commune » (§4) et tout export incluant un détail par commune doit être journalisée dans `rgpd_audit_log`, sur le modèle de `logExportFreins` (`insertion/routes.js:767-776`) — la fiche commune contient potentiellement un détail plus fin (résidence) que l'export freins actuel.
- **Qui voit quoi** : le rôle AUTORITE (élus/auditeurs) ne doit voir QUE les agrégats seuillés — jamais un accès à `employees.city` brut ni à un export sous le seuil. Les routes `metropole.js` sont déjà gardées `authorize('ADMIN','MANAGER','RH','AUTORITE')` (`metropole.js:7`) : toute nouvelle route territorialisée doit répliquer cette garde et, en plus, appliquer le seuil n≥5 **avant** que la réponse n'atteigne AUTORITE (le filtrage doit être serveur, jamais laissé au frontend).

**Données art. 9 (santé, handicap) et art. 10 (judiciaire) — non concernées directement ici**, mais rappel : aucune des agrégations proposées ne doit permettre de reconstituer, même indirectement, un croisement commune × frein santé/judiciaire à un niveau inférieur au seuil. Le frein judiciaire reste exclu par défaut de tout export non explicitement `sensibles=1` (`insertion/routes.js:670,703`) — cette doctrine doit s'étendre strictement à toute agrégation territoriale.

**Seuils, licence, millésimes**
- Licence supposée Licence Ouverte / Open Licence v2.0 (Etalab) pour l'ensemble du portail MRN, **vérifiée** pour 2 jeux seulement (`donmetdec_pav`, déchèteries — hors périmètre de cet agent) ; à confirmer pour `spaser-12012024`, `lieux-d-inclusion-numerique` et le RNA MRN via `metas.default.license` en phase 2.
- Millésimes INSEE hétérogènes par nature : le RP (population, structure par âge) est annuel avec ~2 ans de décalage, Filosofi (revenus) publié avec un décalage similaire, les indicateurs de chômage localisé peuvent être trimestriels (source différente, souvent DARES/France Travail plutôt que RP). **Chaque indicateur affiché doit porter son millésime en toutes lettres** — jamais une date de consultation présentée comme une date de mesure.
- La liste des QPV n'est pas un flux mais une révision périodique (2015, révision 2024, prochaine échéance liée au prochain contrat de ville) — à charger comme donnée de référence statique versionnée, pas comme un appel API récurrent.
- **Clé api.insee.fr** : nécessaire pour l'ensemble des propositions P-EMP-02, P-EMP-04, P-EMP-05 — inscription à faire sur `api.insee.fr` (bloqué depuis cet environnement de cadrage, à faire depuis le serveur de production ou un poste non filtré). Sans cette clé, ces trois propositions ne peuvent pas être vérifiées en phase 2.

---

## 6. Questions à trancher et vérifications API de phase 2

**Questions à trancher (direction / DPO / CIP)**
1. Le champ `employees.city` doit-il être remplacé/complété par un champ structuré `code_insee_residence` saisi ou géocodé à l'embauche, ou le géocodage doit-il rester un traitement de fond (batch) sur le texte libre existant ? (Impact qualité très différent : la BAN peut échouer sur une ville mal orthographiée.)
2. Le rattachement QPV doit-il se faire à la **commune** (grossier — une commune QPV peut compter des salariés hors du quartier lui-même) ou à l'**IRIS** (précis, mais suppose une adresse complète du domicile, que SOLIDATA ne demande pas aujourd'hui) ? Recommandation de cet agent : commencer par la commune (moins précis, mais réalisable sans collecter une donnée nouvelle), et n'envisager l'IRIS que si la DREETS l'exige explicitement.
3. La « fiche commune » doit-elle être un écran applicatif pérenne (nouvel onglet `ReportingMetropole.jsx`) ou un export ponctuel généré en revue de convention annuelle ? Impacte directement le niveau d'effort et la nécessité (ou non) d'une nouvelle route API dédiée avec son propre contrôle d'accès.
4. P-EMP-09 (résidences sociales/logement) doit-elle être développée du tout, au vu du risque de stigmatisation par inférence identifié en §3 ?
5. Faut-il ajouter une entrée dédiée au registre art. 30 pour « territorialisation des indicateurs d'insertion », ou l'englober dans l'entrée existante « accompagnement socio-professionnel » avec une mention complémentaire ? (À trancher avec le DPO.)

**Vérifications API de phase 2 (depuis un hôte non filtré)**

```bash
# 1. Schéma et fraîcheur réelle des 3 jeux du périmètre reçu
BASE=https://data.metropole-rouen-normandie.fr/api/explore/v2.1
curl -s "$BASE/catalog/datasets/spaser-12012024" | jq '{fields:[.fields[]|{name,type,label}], metas:.metas.default}'
curl -s "$BASE/catalog/datasets/lieux-d-inclusion-numerique" | jq '{fields:[.fields[]|{name,type,label}], metas:.metas.default}'
curl -s "$BASE/catalog/datasets/repertoire-national-des-associations-metropole-rouen-normandie" | jq '{fields:[.fields[]|{name,type,label}], metas:.metas.default}'
curl -s "$BASE/catalog/datasets/residences-sociales-metropole-rouen-normandie" | jq '.fields'

# 2. Contenu réel du SPASER — objet, montant, présence effective d'une clause d'insertion identifiable
curl -s "$BASE/catalog/datasets/spaser-12012024/records?limit=20" | jq '.results'

# 3. QPV — confirmer l'absence sur le portail MRN et récupérer les contours ailleurs
for q in qpv "quartier prioritaire" politique_ville; do
  echo "== $q"; curl -s "$BASE/catalog/datasets?where=%22$q%22&limit=20&select=dataset_id" | jq -r '.results[].dataset_id'
done
curl -s "https://data.normandie.education.gouv.fr/api/explore/v2.1/catalog/datasets/quartiers-prioritaires-de-la-politique-de-la-ville-qpv/records?where=nom_com%20like%20%22Rouen%22&limit=50"

# 4. INSEE — API Données locales (nécessite une clé api.insee.fr, s'inscrire au préalable)
curl -s -H "Authorization: Bearer <TOKEN>" \
  "https://api.insee.fr/donnees-locales/V0.1/donnees/geo-COM-200023414@GEO2024RP2021/COM-76540" | jq .
# Chômage localisé (à confirmer le cube exact disponible pour l'EPCI 200023414)
curl -s -H "Authorization: Bearer <TOKEN>" \
  "https://api.insee.fr/donnees-locales/V0.1/geo/liste/COM?epci=200023414" | jq .

# 5. data.inclusion — référentiel structures/services (thème numérique, filtré Métropole Rouen)
curl -s "https://api.data.inclusion.beta.gouv.fr/api/v0/structures?code_insee=76540" | jq '.items | length'
curl -s "https://www.data.gouv.fr/api/1/datasets/referentiel-de-loffre-dinsertion-liste-des-structures-et-services-dinsertion/" \
  | jq '.resources[] | {title, format, url}'

# 6. Vérifier la licence effective des 3 jeux du périmètre
curl -s "$BASE/catalog/datasets?limit=5&where=%22spaser%22%20OR%20%22inclusion%22%20OR%20%22associations%22&select=dataset_id,metas.default.license"

# 7. Test de faisabilité du géocodage BAN → code INSEE sur un échantillon réel de villes SOLIDATA
curl -s "https://api-adresse.data.gouv.fr/search/?q=Sotteville-l%C3%A8s-Rouen&limit=1" | jq '.features[0].properties.citycode'
```

---

## Résumé (10 lignes)

SOLIDATA connaît la commune de résidence des salariés en texte libre non normalisé (`employees.city/postal_code`), sans code INSEE ni QPV — c'est le verrou technique n°1 qui bloque toute territorialisation de l'insertion. Neuf propositions sont formulées : la plus structurante (P-EMP-03) réplique côté RH le calcul déjà éprouvé de « captation par commune » de la collecte (`metropole.js`) pour produire un « nombre d'habitants accompagnés par commune », brique centrale de la future fiche commune des élus. P-EMP-01 ajoute la part de résidents QPV (16 quartiers/14 communes, confirmés par recherche web, absents du portail open data MRN lui-même — sources SIG Ville/INSEE) comme indicateur explicitement attendu par le CDC insertion. P-EMP-02/04/05 juxtaposent nos indicateurs (freins, sorties, F/H) au contexte INSEE (chômage, Filosofi, RP) sans jamais les fusionner. SPASER, DORA/lieux d'inclusion numérique et RNA (P-EMP-06/07/08) servent des usages périphériques (veille de marchés, orientation CIP, fiabilisation du référentiel associations) sans risque RGPD propre. P-EMP-09 (résidences sociales) est signalée comme fragile — risque de stigmatisation par inférence — et déconseillée sans besoin métier explicite. Le garde-fou transversal est le **seuil d'anonymat n≥5**, calqué sur celui déjà en production dans le module Enquêtes, à appliquer à la restitution de toute donnée croisant résidence et statut d'insertion, avec journalisation RGPD systématique et rôle AUTORITE strictement limité aux agrégats seuillés. Les vérifications API bloquantes (schéma SPASER/DORA/RNA, clé api.insee.fr, géocodage BAN sur un échantillon réel) sont listées en fin de rapport pour la phase 2.

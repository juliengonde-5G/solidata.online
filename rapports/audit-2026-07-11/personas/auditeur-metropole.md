# Test persona — Auditeur Métropole Rouen Normandie

**Date du contrôle** : 11 juillet 2026
**Rôle applicatif utilisé** : AUTORITE
**Méthode** : lecture du code réel (routes backend, pages React, schéma DB) — aucune donnée modifiée, aucun accès production

---

## 1. Ma promesse

En tant que représentant de la Métropole Rouen Normandie chargé du suivi de la convention de collecte textile, j'attends de SOLIDATA qu'il me permette, **sans support informatique et sans requête SQL**, de vérifier que le réseau de collecte couvre bien le territoire conventionné, que la captation est mesurée de façon fiable commune par commune rapportée à la population (objectif Refashion 3,6 kg/hab/an), que la qualité de service du parc de bornes (remplissage, débordements, incidents, délais d'intervention) est surveillée, et que la contrepartie sociale de la convention — les sorties dynamiques des personnes en parcours d'insertion — est démontrée par des chiffres agrégés et non nominatifs. J'attends aussi de pouvoir extraire ces éléments pour les joindre à mon dossier de revue annuelle.

---

## 2. Mon parcours

### 2.0 Ce que mon rôle me donne réellement à voir

Avant toute chose, j'ai vérifié le périmètre réel du rôle AUTORITE dans le code, pas seulement dans la documentation. Le résultat est net : en croisant `frontend/src/App.jsx` (liste des `<Route>` avec `ProtectedRoute roles=[...]`) et `frontend/src/components/Layout.jsx` (arbre de navigation `NAV_TREE`), je n'ai que **quatre pages** accessibles : l'accueil (`/`), le fil d'actualité (`/news`), « Analyse > Collecte » (`/reporting-collecte`) et « Analyse > Reporting > Métropole Rouen » (`/reporting-metropole`). Tout le reste (Tours, FillRateMap, LiveVehicles, Insertion, Employees, Refashion, exports DPAV, ReportingRH…) m'est fermé côté route. J'ai vérifié que le backend est cohérent avec cette restriction : `backend/src/routes/metropole.js` (`router.use(authenticate, authorize('ADMIN','MANAGER','AUTORITE'))`, ligne 7) et `backend/src/routes/reporting.js` (ligne 6) m'ouvrent bien exactement ce que le frontend me montre — c'est un point positif, il n'y a pas de page qui s'affiche puis se heurte à un 403.

### 2.1 Reporting territorial

`ReportingMetropole.jsx` centralise correctement plusieurs appels (`/metropole/dashboard`, `/metropole/cav`, `/metropole/sortie-dynamique`, `/metropole/service-cav`, `/metropole/captation-par-commune`) en une seule page lisible, avec cartes KPI, carte Leaflet des CAV et histogramme 12 mois. Pour un non-initié, la mise en page est claire et le vocabulaire est compréhensible.

### 2.2 Captation par commune (kg/habitant)

C'est ici que j'ai trouvé mon constat le plus sérieux. La route `GET /api/metropole/captation-par-commune` (`backend/src/routes/metropole.js`, lignes 360-391) joint `tours` → `tour_weights` → `tour_cav` → `cav`. Or `tour_weights` n'a **aucune colonne reliant une pesée à un CAV précis** (schéma `backend/src/scripts/init-db.js` lignes 516-522 : seulement `tour_id`, `weight_kg`, `recorded_at`) et une tournée peut légitimement compter plusieurs pesées intermédiaires (`is_intermediate`, `backend/src/routes/tours/index.js` ligne 306 ; `tours.total_weight_kg` est explicitement défini comme la somme de toutes les pesées de la tournée, `backend/src/routes/tours/execution.js` ligne 328). En joignant sans clé commune une pesée à *chaque* CAV collecté de la tournée, la requête compte le poids de la tournée une fois par CAV collecté dans chaque commune — pour une tournée normale qui dessert quinze CAV, le poids réel est donc mécaniquement démultiplié dans le total par commune. Le tonnage global du tableau de bord (`collecte.total_kg`, basé sur `tours.total_weight_kg`) et la somme des lignes « captation par commune » ne peuvent structurellement pas coïncider. C'est précisément l'indicateur que je suis venu chercher en premier, et je ne peux pas m'y fier tel quel.

Deuxième problème, indépendant : la jointure se fait sur `cav.code_insee_commune`, colonne ajoutée par `backend/src/scripts/init-db.js` ligne 1572. Mais aucune page ne permet de la renseigner : le formulaire CAV (`frontend/src/pages/AdminCAV.jsx`) ne propose pas ce champ, et ni `POST /api/cav` ni `PUT /api/cav/:id` (`backend/src/routes/cav.js` lignes 862-863 et 897-898) ne l'acceptent. Le seul endpoint qui l'écrit, `PATCH /api/communes/cav/:cavId` (`backend/src/routes/communes.js` lignes 125-139), n'est appelé par aucune page du frontend (recherche vérifiée). Sans intervention SQL directe, chaque CAV restera « (non rattaché) », et sa population de rattachement (`population_commune` sur `cav`) est elle aussi une colonne jamais exposée dans un formulaire — donc jamais alimentée. Autrement dit : la fonctionnalité existe en base et dans la requête, mais personne dans l'organisation ne peut la faire fonctionner via l'application.

### 2.3 Taux de service des CAV (remplissage, débordements, incidents, délais)

`GET /api/metropole/service-cav` (mêmes lignes 334-357) calcule un taux collecté/sauté par mois — c'est utile mais partiel : cela ne couvre que le fait qu'un CAV planifié ait été collecté ou non. Je n'ai trouvé **aucune trace d'incidents, de débordements ou de délai d'intervention** dans mon périmètre. La table `incidents` existe pourtant (`backend/src/scripts/init-db.js` lignes 526-539, avec `type`, `status`, `created_at`, `resolved_at`) et contiendrait exactement de quoi calculer un délai moyen d'intervention — mais `resolved_at` n'est lu par **aucune requête** dans tout le backend (vérifié par recherche globale), et les seules pages qui affichent des incidents (`Tours.jsx`, `LiveVehicles.jsx`, `DashboardCollecte.jsx`) sont réservées à ADMIN/MANAGER. Ce n'est donc pas seulement une restriction de rôle : le KPI « délai d'intervention » n'existe nulle part dans l'application, pour personne. De même, la carte de remplissage flotte entière (`FillRateMap.jsx`, alimentée par `GET /api/cav/fill-rate`) m'est fermée — je n'obtiens un niveau de remplissage qu'au clic sur un CAV individuel dans ma propre page.

### 2.4 Sorties dynamiques insertion

`GET /api/metropole/sortie-dynamique` (lignes 303-331) me donne un pourcentage agrégé, sans aucun nom — c'est exactement le niveau de confidentialité que j'attends d'un indicateur transmis à un tiers. Mais la requête classe tout `sortie_type = 'CDD'` comme « dynamique », sans distinguer CDD court et CDD long, alors que la grille IAE/DREETS n'valide qu'un CDD d'au moins 6 mois. La colonne `sortie_duree_contrat_mois` existe pourtant depuis peu (`init-db.js` lignes 1804-1805, saisie dans `InsertionParcours.jsx` lignes 471-472) mais n'est jamais lue par cette requête. Le chiffre que je verrais peut donc surestimer le taux réel de sorties dynamiques au sens strict de la convention.

### 2.5 Prévisions 15 jours

En cliquant sur un CAV dans la carte, `GET /api/cav/:id/activity` (`backend/src/routes/cav.js` lignes 457-616) m'affiche bien un historique J-15 et une projection J+15, avec une légende distinguant sonde 📡, estimation et prévision IA 🤖 — un vrai bon point de traçabilité, container par container. Il n'existe en revanche aucune vue agrégée de prévision à l'échelle du parc pour mon rôle (`AdminPredictive.jsx` est réservé à l'ADMIN).

### 2.6 Fraîcheur et traçabilité des données

Les requêtes de `metropole.js` ne passent par aucun cache (contrairement à `/dashboard/kpis`, mis en cache 120 s) : la donnée est fraîche à chaque ouverture, c'est un bon point. En revanche, le calcul du CO2 évité distingue en backend un mix de valorisation « observé » ou « fallback » forfaitaire (`mix.source`, `metropole.js` lignes 41-66) — cette information, essentielle pour juger la fiabilité du chiffre, n'est **jamais affichée** : `ReportingMetropole.jsx` ne lit `mix_source` nulle part. Je vois un nombre, jamais son degré de confiance.

### 2.7 Exports

Aucune des deux pages qui me sont ouvertes ne propose de bouton d'export (recherche « export/pdf/csv/xlsx » : aucune occurrence dans `ReportingMetropole.jsx` ni `ReportingCollecte.jsx`). Les seuls exports de l'application (`/admin/refashion-exports`, `GET /api/exports/insertion`) sont réservés à ADMIN/MANAGER ou ADMIN/RH. Je ne peux extraire aucun document pour mon dossier de convention — au mieux une capture d'écran.

---

## 3. Ce que je retiens

**Points forts** : contrôle d'accès cohérent entre backend et frontend sur tout mon périmètre ; KPIs qui me sont destinés entièrement agrégés et non nominatifs (bon réflexe RGPD) ; légende sonde/estimé/IA exemplaire sur le graphique CAV ; progrès réels et rapides depuis l'audit du 10 mai (`rapports/audits/2026-05-10-audit-metropole-rouen.md`) qui avait justement demandé le référentiel communes et ces trois KPI — livrés en deux mois ; données non mises en cache donc toujours à jour ; le rôle AUTORITE est un citoyen de première classe du système (assignable, socle de rôle personnalisé possible).

**Faiblesses (irritants)** : page d'accueil vide pour mon rôle (0 module, 0 action rapide, KPIs génériques non filtrés type « factures impayées ») ; deux pages Reporting distinctes pour un même tonnage avec des sélecteurs de période différents ; objectif Refashion 3,6 kg/hab/an codé en dur ; référentiel communes vide par défaut (fichier de seed `backend/src/data/communes-metropole-rouen.json` = `[]`), dépendant d'un clic ADMIN sur un appel externe.

**Défaillances vérifiées dans le code** : surcomptage structurel du tonnage par commune (jointure `tour_weights`×`tour_cav` sans clé) ; champ `code_insee_commune` sans aucune interface pour le renseigner ; absence totale d'export ; méthode de calcul du taux de sortie dynamique qui ignore la durée du CDD ; absence de toute donnée incidents/débordements/délai d'intervention ; indicateur de fiabilité du CO2 (mesuré/forfaitaire) calculé mais jamais affiché.

**Manques fonctionnels** : aucun indicateur ETP conventionnés/réalisés ni formation/absentéisme accessible à mon rôle (ils existent pour ADMIN/RH/MANAGER via `employees.js` lignes 976-1019 mais pas pour moi) ; pas de vue flotte du taux de remplissage ; pas de suivi de délai d'intervention (fonctionnalité absente de l'app entière, pas seulement de mon rôle) ; pas de document exportable pour la revue de convention.

---

## 4. Verdict

**Promesse partiellement tenue — note 5,5/10.**

SOLIDATA me donne un point d'entrée clair, un vocabulaire compréhensible et des indicateurs agrégés respectueux de la confidentialité — un vrai progrès mesurable depuis l'audit de mai. Mais l'indicateur le plus important pour ma mission, la captation par commune rapportée à la population, repose sur une requête dont la logique de jointure gonfle mécaniquement les chiffres, et sur un champ de rattachement CAV↔commune qu'aucune interface ne permet de renseigner : en l'état, je ne peux pas transmettre ce chiffre en toute confiance à ma hiérarchie. L'absence totale d'export et l'absence de toute mesure du service (débordements, délais d'intervention) achèvent de me convaincre que je peux surveiller la tendance générale de la convention, mais pas encore l'auditer formellement sans redescendre vers l'équipe technique de Solidarité Textiles.

# Test persona — Responsable logistique collecte

**Rôle applicatif testé** : MANAGER (web)
**Date** : 11 juillet 2026
**Périmètre** : module Collecte (CAV, tournées, véhicules, maintenance, reporting)

---

## 1. La promesse

Pour piloter 4 véhicules et environ 200 CAV sur la métropole de Rouen, j'ai besoin que l'application me dise **où c'est urgent** (remplissage réel des bornes, pas une estimation vague), me permette de **transformer cette urgence en tournées assignées** (véhicule + chauffeur) en quelques clics, me donne un **suivi en direct** de ce qui se passe sur la route pendant la journée, et me permette de **réagir immédiatement** quand un incident ou une panne survient. Enfin, je dois pouvoir **rendre compte** (tonnages, ponctualité) et **anticiper l'entretien de la flotte** sans attendre la panne. C'est mon référentiel d'évaluation.

## 2. Mon parcours du lundi matin

**Consulter le remplissage.** Je démarre sur `/fill-rate` (FillRateMap, `frontend/src/pages/FillRateMap.jsx`), accessible en `ADMIN`/`MANAGER` (`App.jsx` L159, menu « Collecte > Réglages > Carte des CAV »). La carte est solide : couleur par taux de remplissage, distinction visuelle capteur LoRaWAN (frais/désynchronisé) vs estimation statistique, panneau de détail avec historique 10 jours + prévision de date de plein, mise à jour Socket.IO en direct (`useCavSensorSocket`) doublée d'un polling de sécurité toutes les 60 s. Les capteurs CAV (`/admin-sensors`) sont bien ouverts au rôle MANAGER (`Layout.jsx` L248, `App.jsx` L225) — cohérent avec mon besoin de diagnostiquer une sonde en panne avant de faire confiance à sa donnée.

**Propositions de collecte.** Sur `/collection-proposals` (`CollectionProposals.jsx`), je vois les propositions IA journalières/hebdomadaires avec le détail des facteurs (météo, trafic, vacances scolaires, jours fériés) — c'est exactement le niveau d'explicabilité qu'il me faut pour faire confiance à l'algorithme. Mais dès que je veux **corriger** ce contexte (ex. noter une grève ou des travaux qui perturbent une tournée), le bouton « Modifier le contexte » m'ouvre une modale... dont l'enregistrement échoue silencieusement pour mon rôle. Voir Défaillance D1.

**Planifier la semaine.** La création de tournées (3 modes : IA intelligente / standard / manuel, plus le mode association) se fait via le bouton « Nouvelle tournée » sur la page `/tours` — page que le menu latéral étiquette « Historique des tournées » (`Layout.jsx` L60). J'ai mis un instant à comprendre que c'était là qu'il fallait créer une tournée : le libellé évoque une consultation d'archives, pas un outil de création. La page `/planning-tournees` (« Programmation > Planning Tournée »), qui sonne pourtant comme l'endroit naturel pour planifier, ne fait que l'**affectation** chauffeur/véhicule sur des tournées déjà créées ailleurs — elle l'indique elle-même (« Créez des tournées via la page Tournées ») quand rien n'existe pour la date. Une fois ce détour compris, l'outil de planning est bon : glisser-déposer, détection de conflits (chauffeur déjà affecté, jour off, véhicule indisponible) avec possibilité de forcer (`backend/src/routes/tours/planning.js` L31, L117, `authorize('ADMIN','MANAGER')`).

**Assigner véhicules et chauffeurs.** Couvert par le point précédent — fonctionne bien, y compris la gestion des conflits.

**Suivre l'exécution en direct.** `/collections-live` (`LiveVehicles.jsx`) est la page la plus aboutie du parcours : carte multi-tournées avec une couleur par tournée, position GPS temps réel des véhicules via Socket.IO, KPIs (véhicules actifs, CAV à vider, avancement, distance restante), tableau de synthèse dépliable par tournée avec alerte de dépassement de durée. C'est un vrai outil de pilotage, pas un gadget.

**Traiter les incidents.** C'est ici que j'ai buté le plus fort. Voir Défaillance D2 ci-dessous — j'y reviens en détail car c'est une étape explicitement attendue de mon métier.

**Analyser les tonnages.** `/dashboard-collecte` (vue du jour, KPIs + santé flotte + liste des tournées) et `/reporting-collecte` (tendances, CO2 évité, taux de complétion, export par période, ouvert aussi à `AUTORITE` pour la Métropole) répondent bien au besoin. Le calcul de CO2 évité et le regroupement par période sont un vrai plus pour mes échanges avec la Métropole et Refashion.

**Gérer la maintenance des véhicules.** Fonctionnellement, le back-end est bon (alertes km + date + contrôle technique combinées dans `/vehicles/maintenance/overview`, `backend/src/routes/vehicles.js` L780-829, autorisé `ADMIN`/`MANAGER`). Le problème n'est pas fonctionnel, il est de **navigation** — voir Défaillance D3.

## 3. Ce que je remonte

### Forces
- **FillRateMap** (`frontend/src/pages/FillRateMap.jsx`) : carte + liste + historique + prévision, distinction capteur/estimation, temps réel — un vrai outil de priorisation.
- **Wizard de création de tournée à 3 modes** (`Tours.jsx`, `backend/src/routes/tours/crud.js` routes `/intelligent`, `/standard`, `/manual`, `/association`) : explication IA fournie (position, remplissage prédit par CAV), correctement autorisé pour MANAGER.
- **Planning drag & drop avec détection de conflits** (`PlanningTournees.jsx`, `tours/planning.js`) : jour off, double affectation, véhicule indisponible — avec option de forcer en connaissance de cause.
- **Suivi en direct multi-tournées** (`LiveVehicles.jsx`, `tours/active-summary.js`) : le meilleur écran du module, GPS temps réel, alertes de dépassement.
- **Capteurs CAV et leurs alertes** (`cav.js`, alertes acquittables via `POST /sensors/alerts/:alertId/ack` L688) et **alertes de maintenance véhicule** (`vehicles.js` L891-913, `resolve-alert` avec `resolved_by`/`resolved_at`) : ces deux systèmes d'alerte, eux, ont un vrai cycle de vie acquittement/résolution — ce qui rend d'autant plus visible l'absence du même mécanisme sur les incidents de tournée (D2).
- **Reporting** (`ReportingCollecte.jsx`) : tendances, CO2 évité, export par période — utile pour mes redditions Métropole/Refashion.

### Faiblesses
- Le libellé « Historique des tournées » pour la page où l'on **crée** les tournées (`Layout.jsx` L60) est trompeur ; la page qui porte le nom attendu, « Planning Tournée », ne fait qu'assigner des ressources.
- `createTourFromProposal` (`CollectionProposals.jsx` L71-80) assigne automatiquement `daily.drivers?.[0]?.id` — le premier chauffeur renvoyé par la requête (`backend/src/routes/tours/proposals.js` L24-27, tous les collaborateurs actifs de l'équipe collecte, **sans filtre de disponibilité du jour**) — pas nécessairement celui qui travaille ou qui est libre. Je dois systématiquement repasser par le Planning pour corriger.
- Le paramétrage IA fin (moteur prédictif, calendrier d'événements locaux) est réservé à `ADMIN` (`tours/stats.js` L171-476, `tours/events.js` L26-69) : je consomme les prédictions mais je ne peux quasiment rien recalibrer moi-même en dehors du contexte météo/trafic — et ce dernier m'est de toute façon fermé (D1).

### Défaillances (vérifiées dans le code)

**D1 — Correction de contexte de collecte silencieusement bloquée pour mon rôle.**
Sur `/collection-proposals`, le bouton « Modifier le contexte » est visible sans restriction de rôle dans `CollectionProposals.jsx` (la page elle-même est ouverte à `ADMIN`/`MANAGER`, `App.jsx` L157). Mais l'enregistrement appelle `PUT /api/tours/context` (`CollectionProposals.jsx` L57-63), route protégée par `authorize('ADMIN')` seul (`backend/src/routes/tours/proposals.js` L198). En tant que MANAGER, ma requête reçoit un 403, mais `saveContext` ne fait que `console.error(err)` (`CollectionProposals.jsx` L67) : aucun message d'erreur ne s'affiche, la modale reste simplement ouverte. Je crois avoir enregistré une note (« grève », « travaux ») qui, en réalité, n'a jamais été prise en compte par le moteur de proposition.

**D2 — Les incidents de tournée n'ont pas de cycle de traitement.**
La table `incidents` est bien conçue pour un vrai suivi : `status` avec les valeurs `open`/`in_progress`/`resolved`/`closed`, plus `resolved_at` et `resolved_by` (`backend/src/scripts/init-db.js` L526-539). Les incidents sont créés via `POST /tours/:id/incidents` (`backend/src/routes/tours/execution.js` L382-399) ou leur variante mobile `incident-public` (`backend/src/routes/tours/index.js` L332-372), et un incident bloquant déclenche même une proposition de ré-optimisation automatique et une notification push aux rôles `ADMIN`/`MANAGER` (`tours/index.js` L344-365). Mais **aucune route du back-end ne modifie jamais `incidents.status`** (recherche exhaustive du motif `UPDATE incidents` dans `backend/src/routes` : aucune occurrence). Côté écran, `LiveVehicles.jsx` et `Tours.jsx` n'affichent qu'un compteur ou le statut brut de l'incident (`inc.status`, `Tours.jsx` L630) — aucun bouton « prendre en charge » ou « résoudre » nulle part dans `frontend/src/pages`. Je peux donc être notifié qu'un chauffeur a un problème, voir sa description et sa photo, mais je ne peux techniquement jamais clore l'incident dans l'outil : il reste `open` indéfiniment. C'est d'autant plus visible que les deux systèmes d'alerte voisins — capteurs CAV et maintenance véhicule — ont, eux, un vrai bouton d'acquittement/résolution (voir Forces). Impact concret : pour du reporting QHSE ou un simple suivi de charge de travail, je ne peux pas distinguer un incident traité d'un incident oublié.

**D3 — Véhicules et Maintenance invisibles dans mon menu.**
Dans `frontend/src/components/Layout.jsx`, la section « Administration > Collecte » restreint « Véhicules » (L244) et « Maintenance » (L245) à `roles: ['ADMIN']` uniquement. Or les routes correspondantes dans `App.jsx` (L160-161) autorisent bien `['ADMIN', 'MANAGER']`, et la quasi-totalité des routes API utiles (lecture flotte, `/vehicles/maintenance/overview`, `PUT /:id/maintenance`, `resolve-alert`) sont ouvertes `authorize('ADMIN', 'MANAGER')` côté back-end. Autrement dit, techniquement j'ai le droit d'y aller — mais rien dans mon menu n'y mène : je dois connaître et taper l'URL `/vehicles` ou `/vehicle-maintenance` à la main. Le tableau de bord `DashboardCollecte.jsx` aggrave la chose : son panneau « Santé flotte » (`FleetHealthBar`, L132-161) affiche noms de véhicules, alertes et échéances de contrat sans le moindre lien cliquable vers la fiche véhicule ou la page maintenance. Pour un responsable dont le cœur de métier est justement la gestion des 4 véhicules, c'est la défaillance la plus pénalisante du parcours : la fonctionnalité existe et fonctionne, mais elle est effectivement invisible au quotidien.

### Insuffisances fonctionnelles
- Pas de vue « incidents » transverse (liste, filtre par statut/type/tournée, historique) — seulement des incidents éclatés par tournée.
- Pas de notification de fin d'incident vers le chauffeur (cohérent avec D2 : il n'y a rien à clôturer).
- Le lien de la notification push d'incident pointe vers `/collections-live` avec un `tourId` en donnée (`tours/index.js` L364), mais `LiveVehicles.jsx` ne lit aucun paramètre d'URL pour ouvrir automatiquement la bonne tournée : je dois la retrouver moi-même dans le tableau.
- Aucun classement de productivité par chauffeur/tournée (kg/heure, écarts régulier vs collecté) dans le reporting collecte — utile pour objectiver mes arbitrages hebdomadaires.
- Le mode « Standard » de génération de tournée (tri par distance) n'expose pas de contrainte de capacité visible dans le wizard avant validation (poids max déjà atteint en cours de route) — je le découvre a posteriori sur le récapitulatif.

## 4. Verdict

La promesse est **tenue pour la moitié la plus visible du métier** — priorisation par remplissage, planification, suivi en direct, reporting — et ces briques sont d'une qualité au-dessus de la moyenne du reste de l'ERP (temps réel Socket.IO, explicabilité IA, détection de conflits). Elle est en revanche **rompue sur deux points opérationnels concrets et vérifiés dans le code** : je ne peux pas corriger le contexte de collecte (D1, silencieusement), et je ne peux pas clôturer un incident (D2, jamais). Ces deux défaillances touchent directement des étapes que l'énoncé même de mon métier attend de moi. À cela s'ajoute une défaillance de navigation bien réelle mais moins grave dans l'absolu (D3, contournable en tapant l'URL) qui, sur le terrain, ferait probablement croire à un responsable non technique que la gestion de flotte a été retirée de son périmètre.

**Verdict : promesse partiellement tenue.**
**Note : 6,5/10.**

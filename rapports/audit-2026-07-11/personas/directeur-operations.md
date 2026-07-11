# Test persona — Directeur des opérations

**Rôle applicatif** : ADMIN (web)
**Date du test** : 11 juillet 2026
**Méthode** : parcours réel dans le code (routes API, pages React, navigation), pas seulement la documentation

---

## 1. Ma promesse

Je pilote l'ensemble de la structure — collecte, tri, ventes, insertion, budget — et je rends compte chaque mois au CA et aux financeurs (Refashion, Métropole, DREETS/ASP). Ce que SOLIDATA doit m'apporter : **une vision consolidée et fiable de l'activité de la veille et du mois en cours, en 10 minutes, chaque matin**, avec des alertes qui me signalent ce qui sort de la norme (véhicule, jalon d'insertion, stock), un suivi de mes objectifs périodiques sans ressaisie, et de quoi arbitrer dans la journée (réaffecter un véhicule, prioriser un exutoire) sans changer d'outil.

## 2. Mon parcours

### Revue matinale — Dashboard puis Dashboard exécutif
Le `/` (`frontend/src/pages/Dashboard.jsx`) m'affiche bien un tableau consolidé : collecte du mois, trié du mois, collaborateurs actifs, alertes, activité récente, objectifs vs réalisé, et une grille de modules avec mini-KPI — c'est un bon point d'entrée, alimenté par `GET /api/dashboard/kpis` (`backend/src/routes/dashboard.js`), une seule requête à 20 sous-requêtes parallèles (`Promise.all`), avec des commentaires de code qui documentent d'anciens bugs corrigés (colonnes erronées) — signe d'une base qui a appris de ses erreurs.

En cherchant plus loin, j'ai trouvé exactement l'outil que mon rôle appelle de ses vœux : `/dashboard-executif` (`frontend/src/pages/DashboardExecutif.jsx`), qui affiche **8 KPI de pilotage** (tonnage collecté, taux de valorisation, productivité tri, CA boutiques, sorties positives insertion 12 mois, CO2 évité, subvention Refashion du trimestre, trésorerie) avec comparaison N-1 et seuils d'alerte configurables. C'est précisément le "1 page, 10 minutes" que je demande, et le backend (`GET /api/dashboard/executive`) est solide (calculs N-1 sur période glissante, gestion des seuils via la table `alert_thresholds`).

**Problème** : cette page n'apparaît nulle part dans le menu. J'ai vérifié dans `frontend/src/components/Layout.jsx` (l'arbre `NAV_TREE` complet, section « Analyse » comprise) : aucune entrée ne pointe vers `/dashboard-executif`. Une recherche sur l'ensemble de `frontend/src` confirme que la seule occurrence du chemin est sa déclaration dans `App.jsx` et le fichier de la page elle-même — aucun lien, aucun bouton nulle part. Concrètement, l'écran conçu pour mon usage exact est invisible sauf à en connaître l'URL. Je ne l'aurais jamais trouvé sans lire le code.

### KPIs de la veille
Les chiffres du jour existent (`DashboardCollecte.jsx` interroge `/tours/dashboard/summary` avec un sélecteur de date, la feuille de production interroge `/production/feuille/:date`), mais le sélecteur par défaut est toujours « aujourd'hui » — il faut reculer la date d'un jour à chaque écran pour lire « la veille ». Pas un blocage, mais un geste répété à chaque module au lieu d'un recueil automatique.

### Objectifs périodiques (avancement)
Sur `/settings` (`frontend/src/pages/Settings.jsx`), je peux définir des objectifs dans **6 domaines** : collecte, production, tri, rh, commercial, logistique. Sur le Dashboard, la jauge « Objectifs vs Réalisé » (réservée à l'ADMIN) recalcule le réalisé via `GET /api/dashboard/objectifs`. En lisant `backend/src/routes/dashboard.js`, le calcul du `realise` ne couvre que le domaine `collecte` (tonnage) et les domaines `tri`/`production` (avec des mots-clés de poste) — pour un objectif que je crée en `rh`, `commercial` ou `logistique`, la variable `realise` reste à sa valeur par défaut `0`, donc la jauge affichera **toujours 0 %**, quelle que soit la performance réelle. Ce n'est pas un plantage — l'écran ne l'affiche jamais en erreur — c'est une jauge silencieusement fausse pour la moitié des domaines que l'interface elle-même me propose de piloter.

### Alertes (véhicules, jalons insertion, stock)
Les alertes véhicules (maintenance non résolue) et RH (fins de contrat à 30 jours) remontent bien dans `alertes` du Dashboard. Les jalons d'insertion en retard sont bien suivis, mais sur un autre écran : le panneau CIP de `/insertion` (`CohortePanel` dans `InsertionParcours.jsx`) les liste clairement (« Jalons en retard », « À venir 7 j »). C'est cohérent avec l'usage (le CIP suit le détail, moi la synthèse via l'Audit Insertion — voir plus bas). En revanche, je n'ai trouvé **aucune alerte de stock** : ni seuil dans `backend/src/routes/stock.js`, ni logique correspondante dans `frontend/src/pages/Stock.jsx`, alors que la table `alert_thresholds` est conçue de façon générique (`domaine` libre) et pourrait porter un seuil stock. Pour un centre de tri où le risque réel est l'engorgement de l'entrepôt, l'absence de signal est un manque.

### Reporting mensuel (production, RH, métropole)
Les trois écrans existent et sont correctement câblés : `ReportingProduction.jsx` (`/production/dashboard`), `ReportingRH.jsx` (`/employees/kpi/formation`, `/kpi/etp`, `/kpi/absenteisme` — tous en `authorize('ADMIN','RH','MANAGER')`), `ReportingMetropole.jsx` (`backend/src/routes/metropole.js`, KPI sortie dynamique / service CAV / captation par commune). Rien à redire ici : le rôle ADMIN y a accès partout, la navigation y mène (section « Analyse » de `Layout.jsx`).

### Audit Insertion
`/insertion/audit` fonctionne vraiment bien : indicateurs chiffrés (`GET /api/insertion/audit`, sans dépendance IA, donc jamais bloquant) puis un rapport IA de situation globale sur demande (`GET /api/insertion/audit/ia`, réservé ADMIN/RH). J'ai vérifié le montage des rôles : `backend/src/routes/insertion/index.js` applique `authorize('ADMIN','RH','MANAGER')` à tout le sous-routeur avant d'exposer `/audit`, donc mon accès ADMIN est garanti même si la route elle-même ne redéclare pas de contrôle. Radar des 7 freins, taux de réalisation des jalons par échéance, export PDF — c'est un des modules les plus aboutis que j'ai testés.

### Synthèse finance
Le module Finance est riche : `FinancePL`, `FinanceBilan`, `FinanceTresorerie` (`backend/src/routes/finance.js`, endpoint `/gl/:year/tresorerie` — un vrai calcul de position de trésorerie mensuelle à partir des écritures du compte 512, pas un stub), `FinanceRentabilite`, `FinanceControles`. Or sur le Dashboard exécutif, la case « Trésorerie » reste figée à `null` avec la mention « nécessite la sync Pennylane » (`dashboard.js`, commentaire `tresorerie = null`). C'est trompeur : la trésorerie est déjà calculable dès qu'un grand livre est importé (manuellement ou via Pennylane) puisque `/finance/tresorerie` l'utilise déjà. Les deux tableaux de bord ne sont pas raccordés entre eux.

### Arbitrages
Réaffecter un véhicule est possible et simple : `PUT /api/vehicles/:id` accepte un nouveau `team_id`, et `PUT /:id/assign-driver` change le chauffeur (`backend/src/routes/vehicles.js`). En revanche, « prioriser un exutoire » n'a pas de levier dédié : aucune notion de priorité/urgence dans `commandes-exutoires.js`, `preparations.js` ni dans les pages Exutoires correspondantes — l'arbitrage ne peut se faire qu'implicitement, en repositionnant des dates dans le Gantt de chargement.

### Questions au SolidataBot
Le chatbot (`backend/src/routes/chat.js`) fonctionne, avec de vrais outils Claude (`query_stock`, `query_planning`, `query_collecte`, `query_heures`, `query_cav`), filtrage RGPD par rôle, rate limiting, historique. Mais son périmètre d'outils est taillé pour un collaborateur/chauffeur (son planning, ses heures) — aucun outil ne couvre le CA boutiques/VAK, la finance ou les indicateurs d'insertion. À une question de pilotage (« quel est mon taux de sorties positives ? »), le bot n'a pas d'outil pour y répondre et suit sa consigne : décliner poliment. Par ailleurs, `chat.js` (comme `vehicles.js` et `predictive-ai.js`) garde en dur l'ancien identifiant de modèle déprécié `claude-sonnet-4-20250514` en repli, alors que `insertion-ai.js` a été corrigé vers `claude-sonnet-5` ; en production le défaut posé dans `docker-compose.prod.yml` (`${CLAUDE_MODEL:-claude-sonnet-5}`) masque le problème, mais `.env.example` à la racine documente toujours l'ancien identifiant et `chat.js` n'a pas reçu le traitement d'erreur diagnostique (`hint`) ajouté aux routes IA de l'insertion.

## 3. Ce que je retiens

**Points forts** : Dashboard d'accueil consolidé et bien pensé ; le Dashboard exécutif (une fois trouvé) répond exactement à mon besoin de synthèse 1 page ; Audit Insertion très abouti (radar, jalons, export PDF, résilience du backend) ; module Finance complet et réel (pas de stub) ; réaffectation véhicule immédiate ; SolidataBot fonctionnel et RGPD-conscient sur son périmètre.

**Points faibles / défaillances vérifiées dans le code** :
- `/dashboard-executif` construit mais absent de `Layout.jsx` — page orpheline (P0 pour ma routine matinale).
- `dashboard.js › /objectifs` : jauges à 0 % systématique pour les domaines rh/commercial/logistique alors que `Settings.jsx` les propose (P1).
- Aucune alerte stock (P1, absente de `stock.js`/`Stock.jsx`).
- Trésorerie figée à `null` côté exécutif alors que `/finance/tresorerie` la calcule déjà (P2, incohérence entre écrans).
- Aucun mécanisme de priorité sur les exutoires (P2, manque fonctionnel).
- Modèle IA déprécié encore en repli dans `chat.js`/`vehicles.js`/`.env.example` (P2, latent, masqué en prod actuelle mais pas nettoyé).

**Manques fonctionnels** (attentes métier non couvertes) : recueil automatique « hier » sans re-sélection de date ; alerte de saturation d'entrepôt ; outils SolidataBot orientés pilotage (finance, insertion, ventes) ; priorisation formalisée des exutoires.

## 4. Verdict

**Promesse partielle**. Les briques existent, sont souvent de bonne facture et testées (l'Audit Insertion et le module Finance en particulier), mais l'assemblage pour mon usage précis — une synthèse fiable en 10 minutes chaque matin — est cassé à l'endroit clé : l'écran fait pour moi n'est pas accessible depuis le menu, et deux des fonctions que je manipule le plus (objectifs, trésorerie) donnent des signaux silencieusement incomplets plutôt que de vraies pannes visibles. Je peux faire mon travail, mais je dois compenser par une connaissance fine de l'outil que je ne devrais pas avoir à avoir.

**Note : 6,5/10**

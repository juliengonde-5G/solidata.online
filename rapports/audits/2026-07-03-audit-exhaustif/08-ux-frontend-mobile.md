# Audit exhaustif SOLIDATA — 08. UX/UI transverse, architecture frontend, accessibilité (web + mobile)

**Date** : 3-4 juillet 2026 — HEAD audité : `74b0faa` (inclut le correctif `8bcb7fc`)
**Périmètre** : `frontend/src/` (83 pages, 28 composants, 4 hooks, 35 933 lignes), `mobile/src/` (12 pages, 9 composants, 5 093 lignes), `index.css`, `tailwind.config.js`, `vite.config.js`, `index.html`
**Méthode** : lecture directe du code, chaque affirmation référencée `fichier:ligne`, comptages `grep`/`wc` reproductibles. Aucun fichier de code modifié.
**Référentiel** : exigence n°1 du commanditaire — « simple d'usage dans le comportement et dans les visuels » pour des salariés en insertion et encadrants à faible compétence informatique.
**Annexes liées** : l'audit UX détaillé page-par-page des écrans collecte existe déjà — `03a-annexe-frontend-collecte.md` (Tours, LiveVehicles, FillRateMap, PlanningTournees, DashboardCollecte, CollectionProposals…) et `03b-annexe-frontend-admin-collecte.md` (AdminCAV, Vehicles, AdminSensors, AdminPredictive, VehicleMaintenance). Ce rapport ne les refait pas ; il couvre le transverse et tout le reste.

---

## Synthèse

Le frontend SOLIDATA est **à deux vitesses**.

Le **mobile chauffeur est exemplaire** pour le public cible : cibles tactiles ≥ 60 px (`mobile/src/index.css:24-25`, commentaire explicite « gants / profil PCM insertion »), langage simple et tutoyé (« Hors ligne — rien n'est perdu », `SyncStatusBanner.jsx:47` ; « Demande à ton responsable », `Login.jsx:35`), offline-first réel (files IndexedDB + backoff + bandeau d'état), écran de confirmation plein écran avec gros check vert et fenêtre « Corriger » (`StepConfirmScreen.jsx`), checklist illustrée d'émojis (`Checklist.jsx:7-17`), retour haptique. C'est le niveau de soin que mérite tout le produit.

Le **web a un bon socle de composants** (Modal avec focus trap complet, FormField accessible, ErrorState avec Réessayer, DataTable avec skeleton/empty state, hook `useConfirm`) **mais l'adoption est très inégale** : `FormField` est importé par **2 pages sur 83**, `ErrorState` par 5, `useAsyncData` par 3 — pendant que **62 `alert()` natifs** subsistent dans 15 fichiers et que **40 des 79 pages qui appellent l'API n'affichent jamais aucune erreur** (catch → `console.error`, 190 occurrences dans 65 pages) : écran figé sur « 0 » ou liste vide, sans explication ni bouton Réessayer. Ce pattern n'est pas théorique : c'est lui qui a masqué pendant des semaines le bug « RESP_BTQ non créable » — `Users.jsx:32` avale le 400 du backend, l'admin voyait la modale rester ouverte sans message (bug corrigé pendant l'audit, 8bcb7fc).

Trois autres problèmes transverses : (1) la **barre de recherche de la TopBar ne fait rien** (state jamais lu) et le bouton **Aide ouvre une URL qui n'existe pas** ; (2) la couleur primaire réelle (teal `#0D9488` — le vert `#2D8C4E` documenté dans CLAUDE.md n'est plus utilisé, cf. `tailwind.config.js:46`) **échoue au contraste WCAG AA** pour le texte blanc des boutons (3,74:1), et l'item de menu actif descend à **2,49:1** en fin de dégradé ; (3) des incohérences menu/route produisent des entrées de menu qui renvoient silencieusement au tableau de bord (`/candidates` pour MANAGER) ou cachent des pages autorisées (`/work-hours`, `/skills` pour MANAGER).

Acquis d'audit intégrés (établis par les rapports 01/03) : **corrigés pendant l'audit** au commit `8bcb7fc` — rôle AUTORITE sans aucune page (→ `/reporting-collecte` + `/reporting-metropole`), RESP_BTQ absent des whitelists users.js/Users.jsx/StatusBadge, LiveVehicles qui lisait `localStorage 'token'` au lieu d'`accessToken`. **Toujours ouverts à HEAD** (revérifiés) : pages routées absentes du menu (`/billing`, `/dashboard-executif`, `/admin-alert-thresholds`) et mismatch menu(ADMIN)/route(ADMIN+MANAGER) sur `/vehicles` et `/vehicle-maintenance` (`Layout.jsx:243-244` vs `App.jsx:156-157`). `/balance` est volontairement public (kiosque balance).

---

## 1. Cohérence & navigation

### 1.1 Inventaire routes × menu

| Mesure | Valeur | Source |
|---|---|---|
| Pages React | 83 fichiers | `ls pages/*.jsx | wc -l` |
| Routes `App.jsx` | 85 `<Route>` dont 5 redirects legacy (`/cav-map`, `/live-vehicles`, `/reporting`, `/referentiels`, `*`) et 3 publiques (`/login`, `/balance`, `/pcm-test/:token`) | `App.jsx:117-226` |
| Entrées terminales du menu `NAV_TREE` | 74 chemins | `Layout.jsx:23-281` |
| Pages protégées routées **hors menu** | 4 (détail ci-dessous) | comparaison exhaustive |
| Profondeur max du menu | 4 niveaux | `Layout.jsx:86-95` |

Pages routées absentes du menu, avec leur accessibilité réelle (grep des liens in-app) :

| Page | Rôles route | Liens internes | État |
|---|---|---|---|
| `/billing` (App.jsx:196) | ADMIN, MANAGER | **aucun** | Orpheline totale (acquis, ouvert) |
| `/dashboard-executif` (App.jsx:187) | ADMIN, MANAGER | **aucun** | Orpheline totale (acquis, ouvert) |
| `/admin-alert-thresholds` (App.jsx:215) | ADMIN, MANAGER | 1 seul lien… depuis `/dashboard-executif` (DashboardExecutif.jsx:157), elle-même orpheline | Chaîne d'orphelines |
| `/admin/pennylane-config` (App.jsx:198) | ADMIN | **aucun** (grep `pennylane-config` : 0 hit dans pages/ et components/) | **Nouvelle orpheline** — la « scission Pennylane » (v1.8.0) a créé la page config sans jamais la lier |

### 1.2 Incohérences rôle menu ≠ rôle route (nouvelles, au-delà des acquis)

| Chemin | Menu (`Layout.jsx`) | Route (`App.jsx`) | Effet vécu |
|---|---|---|---|
| `/candidates` | `['ADMIN','RH','MANAGER']` (L157) | `['ADMIN','RH']` (L139) | **Un MANAGER voit « Gestion candidatures », le clic le renvoie silencieusement au tableau de bord** (`ProtectedRoute` → `<Navigate to="/" />`, App.jsx:106), sans message. Pour un encadrant peu à l'aise : « l'application est cassée ». |
| `/work-hours` | `['ADMIN','RH']` (L183) | `['ADMIN','RH','MANAGER']` (L145) | Heures de travail accessibles aux MANAGER mais entrée cachée. Fonction perdue. |
| `/skills` | `['ADMIN','RH']` (L167) | `['ADMIN','RH','MANAGER']` (L146) | Idem : compétences invisibles pour MANAGER. |
| `/vehicles`, `/vehicle-maintenance` | `['ADMIN']` (L243-244) | `['ADMIN','MANAGER']` (L156-157) | Acquis (audit transverse), toujours ouvert à HEAD. |

Pattern de fond : **`ProtectedRoute` et le fallback `*` redirigent sans expliquer** (App.jsx:106,226). Aucune page « Accès refusé » ni « Page introuvable ». Correctif : page 403/404 en français simple (« Tu n'as pas accès à cette page — demande à ton responsable ») + **source unique** des rôles (une constante partagée consommée par App.jsx ET NAV_TREE, pour rendre la divergence impossible).

### 1.3 Ce que voit chaque rôle à la connexion

Exécution de `filterByRole` (`Layout.jsx:284-296`) et de la grille `MODULE_CARDS` du Dashboard (`Dashboard.jsx:19-98`) :

| Rôle | Menu visible | Dashboard `/` (landing commune à tous) |
|---|---|---|
| ADMIN | ~74 entrées | 4 KPI + objectifs + 7 cartes modules |
| MANAGER | ~55 | 4 KPI + 5 cartes |
| RH | 11 (Accueil 2, RH & Insertion 6, Équipe 2, Analyse 1) | 4 KPI + 3 cartes |
| COLLABORATEUR | **4** : Tableau de bord, Fil d'actualité, Tri→Étiquettes, et « Sortie cartons » enfouie à **4 niveaux** (Opérations→Logistique→Inventaire→Sortie cartons, Layout.jsx:86-95) | 4 KPI globaux entreprise + **« Modules — 0 modules disponibles »** (grille vide, Dashboard.jsx:280) |
| RESP_BTQ | 5 : Accueil 2 + Boutiques 3 | 4 KPI globaux (tonnage collecte/tri — **rien sur sa boutique**) + **0 cartes** : aucune carte Boutiques/VAK dans `MODULE_CARDS` |
| AUTORITE | 4 : Accueil 2 + Analyse Collecte + Métropole (**corrigé pendant l'audit**, 8bcb7fc) | 4 KPI + 0 cartes |

Constats :
- **La grille modules du Dashboard n'a jamais intégré les modules 26 (Boutiques) et 27 (VAK)** — elle s'arrête aux 6 modules historiques + admin (`Dashboard.jsx:19-98`). Un RESP_BTQ atterrit sur une page qui ne parle pas de son métier et annonce « 0 modules disponibles ».
- Un COLLABORATEUR (opérateur de tri, cœur du public faible littératie) atterrit sur des KPI de direction et doit traverser 4 niveaux de menu pour son écran de travail. Ses 2 pages (bien conçues, cf. §2.1) devraient être au niveau 1, voire être sa landing.
- `/api/dashboard/kpis` est servi à tout rôle authentifié (`backend/src/routes/dashboard.js:7,16` — `authenticate` sans `authorize`) : pas d'erreur à l'écran, mais un COLLABORATEUR reçoit les alertes/KPI de direction (gouvernance de données à trancher).

### 1.4 Points positifs navigation

- Arbre récursif avec auto-expansion du chemin actif, persistance de l'état ouvert/fermé et du scroll (`Sidebar.jsx:70-101`).
- `aria-expanded` sur les groupes (`Sidebar.jsx:197`).
- Redirects legacy conservés — les favoris ne cassent pas (App.jsx:154,161,191,213).

---

## 2. Simplicité par persona (frictions concrètes, priorisées)

### 2.1 Opérateur de tri (COLLABORATEUR — public cible n°1)
1. **Landing inadaptée** : Dashboard direction, grille « 0 modules disponibles » (Dashboard.jsx:280). Devrait atterrir sur ses outils.
2. **« Sortie cartons » à 4 clics de profondeur** dans un menu dont 3 niveaux ne le concernent pas (Layout.jsx:86-95).
3. Ses 2 pages de travail sont **bien pensées** : `EtiquetteGenerer.jsx` en workflow à étapes avec fil d'Ariane cliquable (L18,126-141) et gros boutons tactiles ; `SortieCartons.jsx` avec scan douchette + bips sonores distincts succès/erreur/déjà-sorti (L5 `beepSuccess/beepError/beepAlreadyOut`) — exactement le bon registre.
4. Libellés sans accents partout où StatusBadge/DataTable apparaissent : « Recu », « Recrute », « Preparee », « Cloturee », « Entree », « Conge », « Autorite » (`StatusBadge.jsx:3-84`), « Aucune donnee » (`EmptyState.jsx:10`, `DataTable.jsx:58`) — français dégradé = charge de décodage supplémentaire pour lectorat fragile + image « pas fini ».

### 2.2 Chauffeur-collecteur (mobile) — la meilleure expérience du produit
Points forts vérifiés : cibles ≥ 60 px partout (`mobile/src/index.css:59-99`) ; niveaux de remplissage en mots simples + icônes de conteneur (« vide / un peu / à moitié / presque plein / plein / au-delà », `FillLevel.jsx:16-23`) ; anomalies illustrées (`FillLevel.jsx:25-30`) ; pesée avec gros steppers +/- et calcul du net affiché (`WeighIn.jsx:31-40`) ; barre d'étapes « 3/8 — Suivant : Identifier » (`MobileShell.jsx:70-104`) ; bandeau usage Conduite/Arrêt/Collecte qui adapte la CTA unique (`UsageModeBanner.jsx`, `TourMap.jsx:230+`) ; messages d'erreur humains (« Connexion impossible. Vérifie le réseau et réessaie. », `VehicleLogin.jsx:79`).

Frictions restantes :
1. **Badge « À renvoyer » mensonger (perte de données invisible)** : sur rejet 4xx, `FillLevel.jsx:136-139` et `WeighIn.jsx:70-72` **suppriment** l'élément de la file (`deleteItem(STORES.pending*)`) puis affichent le statut `retry` = « À renvoyer » (`OfflineActionBadge.jsx:33`). Rien ne sera renvoyé : si le chauffeur ne tape pas « Corriger » immédiatement, la collecte/pesée est perdue en croyant le contraire. Même purge 4xx silencieuse dans la sync de fond (`sync.js:97-99,166-168,247-249,296-298` — `console.warn` seulement). Les pesées alimentent tonnage Refashion et facturation.
2. **Expiration de session = perte de scans** : les scans passent par `api.post` authentifié (`sync.js:89`) ; un 401 après échec de refresh est un 4xx → élément **supprimé** (`sync.js:97-100`) au lieu de conservé. (Pesées/collectes/incidents passent par des endpoints `*-public` en `fetch`, non concernés.)
3. **Redémarrage hors réseau en cours de tournée** : `TourMap.loadTour()` (`TourMap.jsx:93-101`) fait un `fetch` sans fallback IndexedDB (seuls les CAV de référence sont cachés, `sync.js:345-368`) — échec silencieux `console.error`, carte sans données.
4. Thème PWA incohérent : `theme_color: '#8BC540'` (ancien vert) dans `mobile/vite.config.js:14` vs app entièrement teal `#0D9488` (et `mobile/index.html:6` déclare `#0D9488`) — barre système Android d'une couleur qui n'existe plus.
5. `user-scalable=no, maximum-scale=1.0` (`mobile/index.html:5`) : **zoom pinch bloqué** — pénalise les basse-vision (WCAG 1.4.4), discutable même pour un écran carte.

### 2.3 Responsable boutique (RESP_BTQ)
1. Compte créable depuis 8bcb7fc (**corrigé pendant l'audit**) — le bug était resté invisible précisément à cause du catch silencieux d'`Users.jsx:32`.
2. **Landing sans rapport avec son métier** : KPI entreprise + 0 cartes (cf. §1.3). Devrait atterrir sur `/boutiques`.
3. Son périmètre menu (3 entrées Boutiques) est simple et propre. `BoutiquesDashboard` : 8 appels API parallèles par vue (BoutiquesDashboard.jsx:96-103) et **aucun feedback si l'un échoue** (L115 catch console.error) — un jour de CSV manquant ressemble à « pas de ventes ».

### 2.4 CIP / RH
1. Périmètre menu cohérent (11 entrées) ; Candidates offre kanban drag & drop + upload CV avec **vrai feedback** succès/erreur (`Candidates.jsx:181-186` setUploadMsg) — la page la plus aboutie du web.
2. Mais dans la même page : `moveCandidate` (drag kanban) et `createCandidate` avalent l'erreur (`Candidates.jsx:152,163` catch console.error) — un déplacement de carte refusé par le serveur ne revient pas en arrière visuellement.
3. `/candidates` visible mais interdite aux MANAGER (§1.2) — l'encadrant invité à consulter une candidature tombe sur une redirection muette.
4. `WorkHours.jsx:44-47` : la **saisie d'heures** (paie !) échoue en silence — modale fermée seulement si succès, aucun message sinon ; aucun état `saving` (double-clic possible).

### 2.5 Direction / AUTORITE
1. AUTORITE utilisable depuis 8bcb7fc (**corrigé pendant l'audit**).
2. `/dashboard-executif` et `/billing` inaccessibles sans taper l'URL (§1.1).
3. La recherche globale TopBar ne fait rien (A1) et le bouton Aide ouvre un 2ᵉ Dashboard (A7) — les deux affordances « découvrabilité » de la barre haute sont factices.

---

## 3. Anomalies UX transverses (sévérité + preuve + impact + correctif)

### CRITIQUE

**A1 — Barre de recherche factice dans la TopBar (toutes pages web)**
`TopBar.jsx:10` : `const [search, setSearch] = useState('')` — valeur **jamais lue** ensuite : aucun submit, aucun filtrage, aucune navigation. Le raccourci ⌘K (L17-27) focalise un champ mort. Placeholder trompeur « Rechercher candidat, tournée, stock… » (L46).
*Impact* : l'élément le plus visible de l'UI est un piège ; l'utilisateur peu autonome tape, appuie Entrée, conclut « ça ne marche pas » et généralise à l'app.
*Correctif* : palette de commandes minimale (navigation par nom de page + 2 endpoints candidats/tournées) **ou retrait du champ** tant que non câblé.

**A2 — 40 pages sur 79 (51 %) n'affichent jamais une erreur serveur**
Comptage (critère large : ErrorState, toast, alert, `set*Error/Msg/Message`, useAsyncData) : 39 pages ont au moins un feedback, **40 n'en ont aucun** — uniquement `console.error` (190 occurrences dans 65 pages). Liste complète en annexe A. Pages critiques concernées : `Dashboard.jsx:133-141` (KPIs restent « - »/0), `Users.jsx:21,32,39` (création de compte silencieuse — a masqué le bug RESP_BTQ), `WorkHours.jsx:47` (saisie d'heures), `Stock.jsx:61,100` (mouvement de stock et **validation d'inventaire Refashion**), `ExutoiresCommandes.jsx:247,260` (création de commande et **transitions du workflow logistique** : un refus de la state machine backend est invisible), toutes les pages Finance* et Reporting*.
*Impact* : serveur en erreur ⇒ zéros présentés comme des données vraies (danger pour le reporting réglementaire) ; action échouée ⇒ l'utilisateur croit avoir enregistré.
*Correctif* : généraliser `useAsyncData`+`ErrorState` (déjà écrits) pour les chargements — mécanique sur les ~14 pages de consultation pure (Reporting*/Finance*/VAK) ; toast d'erreur systématique dans les catch d'action.

**A3 — Session expirée / serveur down : déconnexion brutale et perte de saisie**
`AuthContext.jsx:13-18` : au chargement, **toute** erreur de `/auth/me` — y compris une erreur *réseau* (redéploiement, wifi) — purge les tokens → déconnexion alors que la session était valide. `api.js:59-65` : échec du refresh ⇒ `window.location.href='/login'` immédiat, sans message, en jetant la saisie en cours.
*Impact* : chaque restart backend (deploy.sh) éjecte les utilisateurs ; perte possible de 20 min de saisie de formulaire.
*Correctif* : distinguer `!err.response` (réseau → garder les tokens + bandeau « Connexion au serveur impossible — Réessayer ») du 401 réel ; mémoriser l'URL pour y revenir après re-login ; message « Ta session a expiré, reconnecte-toi ».

### MAJEUR

**A4 — 62 `alert()` natifs (15 fichiers) et 16 `confirm()` natifs (11 fichiers) résiduels**
`alert(` : 62 occurrences (PlanningHebdo, VehicleMaintenance, Tours, NewsFeed, AdminDB, Vehicles, RGPD, Candidates, PersonalityMatrix, Settings, ExutoiresCommandes, InsertionParcours, Production, Pennylane, SensorSection). `window.confirm`/`confirm(` natifs : 16 occurrences dans 11 fichiers (Production×3, Settings×3, Vehicles×2, VakSumupConfig, ExutoiresControleFacturation, VehicleAccessPanel, PlanningHebdo, NewsFeed, Pointage, ActivityLog, AdminPredictive). En face, l'adoption des équivalents maison est réelle mais partielle : `ConfirmDialog` 13 fichiers + hook `useConfirm` 14 fichiers, `useToast` 9.
*Impact* : boîtes système bloquantes, non stylées, libellé du chrome parfois en anglais (« OK/Cancel ») ; certaines exposent l'erreur backend brute (`alert(err.response?.data?.error)`, ex. Production.jsx:212,241,252 ; InsertionParcours.jsx:189 « Erreur: … »).
*Correctif* : chantier mécanique de substitution, fichier par fichier (le grep ci-dessus en est la liste de travail) ; formuler les messages en langage utilisateur.

**A5 — Design system quasi inutilisé dans les pages**
`FormField` (a11y complète — `FormField.jsx:41-61`) : **2 pages**. `ErrorState` : 5. `EmptyState` : 2. `useAsyncData` : 3 (Tours, Employees, Stock). Les formulaires des autres pages recodent label+input à la main, souvent **placeholder en guise de label** (ex. `Users.jsx:119-124` : « Prénom », « Mot de passe * » disparaissent à la frappe — mémoire de travail sollicitée, échec WCAG 3.3.2).
*Impact* : l'investissement V1.5.0 est resté un pilote ; chaque nouvelle page copie l'ancien pattern.
*Correctif* : règle de revue « tout nouveau formulaire = FormField », migration opportuniste.

**A6 — Libellés français sans accents dans le socle UI**
`StatusBadge.jsx:3-84` (≈25 libellés), `EmptyState.jsx:10`, `DataTable.jsx:58`, `Dashboard.jsx:15,33,45,51,62` (« Gestion Equipe », « Tournees », « kg tries »).
*Correctif* : passe d'accentuation sur les const maps — zéro risque logique.

**A7 — Bouton « Aide » vers une documentation inexistante**
`TopBar.jsx:75` : `window.open('https://solidata.online/docs')`. Aucune `location /docs` dans `deploy/nginx/conf.d/solidata.conf` (locations : `/`, `/api/`, `/socket.io/`, `/uploads/`) ⇒ la SPA se charge et `* → /` : **le bouton Aide ouvre un deuxième Dashboard**.
*Correctif* : servir une page d'aide réelle (les guides existent : `docs/GUIDE_UTILISATEUR.md`, 4 supports de formation par profil) ou retirer le bouton.

**A8 — Mobile : purge silencieuse des rejets 4xx + badge « À renvoyer » faux**
Détail §2.2-1/2. `sync.js:97-99,166-168,247-249,296-298` ; `FillLevel.jsx:136-139` ; `WeighIn.jsx:70-72` ; libellé `OfflineActionBadge.jsx:33`.
*Correctif* : store `rejected` + écran « X actions n'ont pas pu être envoyées — montre ça à ton responsable » ; renommer le badge ; traiter 401 comme erreur réseau (conserver et retenter après re-auth), pas comme 4xx définitif.

### MINEUR

**A9 — Redirections muettes** : `ProtectedRoute` (App.jsx:106) et fallback `*` (App.jsx:226) — cf. §1.2.
**A10 — Toasts auto-fermés en 4 s, erreurs comprises** (`Toast.jsx:5`) : un message d'erreur disparaît avant d'être lu par un lecteur lent ; les toasts `error` devraient persister jusqu'au clic. Pas de plafond de pile non plus.
**A11 — `LoadingSpinner` muet pour lecteurs d'écran** (`LoadingSpinner.jsx` : aucun `role="status"`/sr-only — contrairement au bon exemple `PageFallback`, App.jsx:95-97).
**A12 — Skip-link défini mais jamais posé** : `.skip-link` dans `index.css:53-67`, **0 usage** dans index.html/JSX (grep) ; le `<main>` (Layout.jsx:369) n'a pas d'`id` cible.
**A13 — Double-submit possible sur la plupart des formulaires modaux** : hors ConfirmDialog (protégé, `ConfirmDialog.jsx:38,45`) et Login (`disabled={loading}`, Login.jsx:76-80), les POST de création n'ont pas d'état `saving` : `Users.jsx:131` (« Créer »), `ExutoiresCommandes.jsx:236-247`, `WorkHours.jsx:41-48`, `Stock.jsx:49-61` — un double-clic crée potentiellement 2 enregistrements.
**A14 — Tri DataTable inaccessible clavier** : `<th onClick>` sans bouton/`tabIndex`/`aria-sort` (`DataTable.jsx:126-146`).
**A15 — `EmptyState`/`TableEmptyState` sans `role="status"`** : un lecteur d'écran ne distingue pas « vide » de « pas encore chargé ».

---

## 4. Accessibilité

### 4.1 Contrastes (calculés WCAG 2.1 — script annexe B)

La couleur documentée dans CLAUDE.md (`#2D8C4E`) n'est plus utilisée : `tailwind.config.js:46` mappe `solidata-green → #0D9488` (teal-600), repris par `--color-primary` (`index.css:12`).

| Usage | Couleurs | Ratio | Verdict |
|---|---|---|---|
| Texte blanc sur `.btn-primary` (`index.css:109-113`) | `#FFF`/`#0D9488` | **3,74:1** | **Échec AA texte normal** (seuil 4,5) |
| Item de menu actif, fin de dégradé (`index.css:255` : `linear-gradient(90deg,#0D9488,#14B8A6)`) | `#FFF`/`#14B8A6` | **2,49:1** | **Échec AA/AAA — le libellé de la page courante est le moins lisible du menu** |
| Liens teal sur blanc | `#0D9488`/`#FFF` | 3,74:1 | Échec AA texte normal |
| `text-slate-400` (placeholders, messages vides, « @username » Users.jsx:56) | `#94A3B8`/`#FFF` | **2,56:1** (2,45:1 sur slate-50) | Échec |
| `text-slate-500` (labels KPI) | `#64748B`/`#FFF` | 4,76:1 | OK AA |
| Header mobile (fin de dégradé `#0F766E`) | `#FFF`/`#0F766E` | 5,47:1 | OK |
| Référence : ancien vert CLAUDE.md | `#FFF`/`#2D8C4E` | 4,22:1 | (échouait déjà de peu) |

*Correctif faible risque* : baser boutons et état actif sur `teal-700 #0F766E` (5,47:1 ✔), faire finir le dégradé actif au plus clair sur `#0D9488` ; bannir `text-slate-400` pour le texte porteur de sens.

### 4.2 Sémantique, clavier, lecteurs d'écran

- **Bons points** : `Modal.jsx` complet (focus trap Tab/Shift+Tab L51-73, restauration L44-47, Escape, `aria-modal`, `aria-labelledby` via `useId`) ; `:focus-visible` global (`index.css:46-50`) ; `FormField` exemplaire ; Toast `role="alert"` ; SolidataBot avec `role="dialog"` + zone messages `role="log" aria-live="polite"` (SolidataBot.jsx:167,202) ; mobile `SyncStatusBanner` avec `role`/`aria-live` justes ; `aria-expanded` sidebar.
- **Couverture pages faible** : 28 attributs `aria-*` dans les 83 pages (9 fichiers) contre 40 dans les 28 composants — l'a11y vit dans le socle, pas dans les écrans.
- **KanbanBoard : drag & drop souris uniquement** (`KanbanBoard.jsx:178-180` `draggable`), aucune alternative clavier — le changement de statut candidat est impossible sans souris (Candidates propose toutefois des actions dans le détail).
- NotificationBell : bouton cloche sans `aria-label` ni `aria-expanded` (`NotificationBell.jsx:56-67`), dropdown sans rôle.
- Sidebar : texte 13/12,5 px (`Sidebar.jsx:204`) et items ~34 px de haut (`py-1.5`) — petit pour le public visé, surtout sur tablette.
- Mobile : `user-scalable=no` (`mobile/index.html:5`) bloque le zoom (WCAG 1.4.4).
- `index.html` web correct par ailleurs : `lang="fr"`, `theme-color` cohérent, title parlant.

### 4.3 Tailles et cibles

Mobile : `--space-touch: 60px` appliqué partout (`mobile/src/index.css:59-99`) — au-dessus des 44 px recommandés. Web : `.btn-primary` ~40 px OK ; liens de menu ~34 px et liens-texte d'action dans les tableaux (« Valider », « Désactiver » en `text-xs`, ex. WorkHours.jsx:73, Users.jsx:84) — cibles trop petites pour le public cible.

---

## 5. Optimisations frontend

### 5.1 `<Layout>` remonté à chaque navigation (79 pages)

Chaque page enveloppe son propre `<Layout>` (79 occurrences — grep `components/Layout` dans pages/) au lieu d'un layout route parent. Conséquences mesurables : sidebar+topbar démontées/remontées à chaque navigation (le code le compense déjà par un module-scope `persistedState` et la persistance du scroll — `Layout.jsx:298-303`, `Sidebar.jsx:70-80` — preuve que le problème est connu), et **1 requête `GET /dashboard/kpis` par navigation** (`Layout.jsx:322-333`), y compris pour les rôles sans compteurs. Passer à une `<Route element={<Layout/>}>` avec `<Outlet/>` supprime le refetch et les re-renders.

### 5.2 Pages > 500 lignes (19 sur 83)

`wc -l` : Candidates **1 272** ; Production **1 033** ; AdminPredictive **1 009** ; InsertionParcours **992** ; Vehicles 778 ; ExutoiresCommandes 720 ; Settings 711 ; AdminCAV 705 ; VehicleMaintenance 674 ; ExutoiresGantt 660 ; Tours 656 ; BoutiquesDashboard 627 ; ExutoiresPreparation 623 ; Employees 608 ; AdminStockOriginal 599 ; AdminSensors 595 ; Dashboard 577 ; PCMTest 527 ; ExutoiresCalendrier 516 ; PlanningHebdo 500 (+ `SensorSection.jsx` 468 côté composants).

### 5.3 Mémoïsation quasi absente des grosses pages

`useMemo/useCallback` : Candidates 2/2, Production 0/3, AdminPredictive **0/0**, InsertionParcours 0/2, Vehicles 0/4, ExutoiresCommandes 2/0, Dashboard 0/0, BoutiquesDashboard 3/0. Les kanbans/listes re-render à chaque frappe de filtre. Priorité : Candidates (kanban 4 colonnes), Production, PlanningHebdo.

### 5.4 Bundle & réseau

- **Bon** : 83 pages en `React.lazy` (App.jsx:8-91) + `manualChunks` vendor (V1.5.0) ; fallback de chargement accessible.
- `@import` Google Fonts **bloquant en tête de CSS** (`index.css:1` et `mobile/src/index.css:1`) : dépendance externe au premier rendu, flash de police sur réseau lent d'atelier. Auto-héberger le WOFF2 (2 poids).
- `BoutiquesDashboard` : 8 requêtes par changement de vue (L96-103) sans agrégat serveur.
- PWA mobile : `registerType:'autoUpdate'` ✔ ; manifest minimal (pas de `screenshots`/`shortcuts`) ; pas de runtime-caching des tuiles carte ; **la donnée tournée n'est pas persistée** (cf. §2.2-3).
- GPS : buffer envoyé par lots de 50 (`sync.js:183-207`) ✔, backoff 30 s→5 min ✔.

---

## Quick wins sûrs (0 risque de régression)

1. Aligner les 5 tableaux de rôles menu/route (§1.2) — 5 lignes.
2. Ajouter cartes Boutiques (RESP_BTQ) et VAK dans `MODULE_CARDS` + entrées menu pour `/billing`, `/dashboard-executif`, `/admin-alert-thresholds`, `/admin/pennylane-config` (ou supprimer ces routes si mortes).
3. Passe d'accents sur `StatusBadge.jsx`/`EmptyState.jsx`/`DataTable.jsx`/`Dashboard.jsx`.
4. Retirer (ou câbler) la recherche TopBar ; corriger l'URL du bouton Aide.
5. `mobile/vite.config.js` : `theme_color → '#0D9488'` ; retirer `user-scalable=no`.
6. `Toast` : durée ∞ pour `type==='error'` (dismiss manuel).
7. `disabled={saving}` sur les submits de Users/WorkHours/Stock/ExutoiresCommandes.
8. Renommer le badge mobile `retry` (« Non envoyé — corrige ou préviens ton responsable »).

---

## Annexe A — Les 40 pages sans aucun feedback d'erreur

Critère : page important `services/api` sans aucun de `ErrorState | toast | alert( | setError | set*Error/Msg/Message | useAsyncData` :
ActivityLog, AdminCAV, AdminStockOriginal, Billing, BoutiquesDashboard, BoutiquesVentes, ChaineTri, CollectionProposals, Dashboard, DashboardCollecte, ExutoiresCalendrier, ExutoiresClients, ExutoiresGantt, ExutoiresPreparation, ExutoiresTarifs, FillRateMap, Finance, FinanceBilan, FinanceControles, FinanceOperations, FinancePL, FinanceRentabilite, FinanceTresorerie, InventaireOriginal, LiveVehicles, PerformanceDashboard, RecruitmentPlan, Refashion, Reporting, ReportingCollecte, ReportingMetropole, ReportingProduction, ReportingRH, Skills, Users, VakAnnuel, VakJournee, VakLive, VakPerformance, WorkHours.
Nuance : d'autres pages (Candidates, Production, Stock, ExutoiresCommandes, Pointage…) ont un feedback sur *certaines* actions mais des catch silencieux sur d'autres (références exactes au §3-A2). FillRateMap/LiveVehicles : détail dans l'annexe 03a.

## Annexe B — Script de contraste (reproductible)

```js
// node contrast.js — luminance relative WCAG 2.1
function lum(hex){const c=hex.replace('#','');const[r,g,b]=[0,2,4].map(i=>parseInt(c.substr(i,2),16)/255)
  .map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4));return 0.2126*r+0.7152*g+0.0722*b}
function ratio(a,b){const[l1,l2]=[lum(a),lum(b)].sort((x,y)=>y-x);return (l1+0.05)/(l2+0.05)}
```

## Annexe C — Échantillon de pages examinées (hors collecte, cf. 03a/03b pour la collecte)

| Page (lignes) | Chargement | Erreur action | Feedback succès | Double-submit | Notes |
|---|---|---|---|---|---|
| Dashboard (577) | spinner implicite | ✗ silencieux (L133-141) | n/a | n/a | Grille modules obsolète (pas Boutiques/VAK) |
| Users (138) | LoadingSpinner | ✗ (L21,32,39) | ✗ (fermeture modale) | **oui** | Placeholders sans labels ; a masqué bug RESP_BTQ |
| WorkHours (173) | ✗ | ✗ (L47) | ✗ | **oui** | Saisie d'heures (paie) silencieuse |
| Stock (331) | ✔ useAsyncData+ErrorState | ✗ (L61,100) | ✗ | **oui** | Validation inventaire Refashion silencieuse |
| ChaineTri (322) | ✗ (L41) | ✗ | n/a | n/a | Consultation, zéros trompeurs |
| ExutoiresCommandes (720) | LoadingSpinner | ✗ (L247,260) | ✗ | **oui** | Refus state-machine invisibles ; bon useConfirm |
| Production (1 033) | ✔ | mixte : alert(err brut) L212,241,252 ; saveDaily silencieux | alert natif | protégé (`saving`) | window.confirm×3 |
| Candidates (1 272) | ✔ | mixte : upload CV ✔ (L181-186) ; move/create ✗ (L152,163) | ✔ upload, alert conversion | partiel | Kanban drag sans clavier |
| BoutiquesDashboard (627) | ✗ (L115) | n/a | n/a | n/a | 8 requêtes/vue |
| Settings (711) | ✔ | alert natif (L94) | alert | protégé partiel | 3 confirm natifs ; teste conn. Pennylane ✔ |
| InsertionParcours (992) | ✔ setLoadError (L531) | alert « Erreur: » + err brut (L189,205) | alert | ✔ (4 disabled) | Vocabulaire métier CIP adapté (jalons/freins) |
| Refashion (161) | ✗ | ✗ | n/a | n/a | Reporting réglementaire sans état d'erreur |
| Pointage (465) | ✗ loads (L61-73) | ✔ setManualMsg/setBadgeMsg (L86-105) | ✔ messages inline | non protégé | Bon pattern messages, à étendre aux loads |
| Login (—) | n/a | ✔ bandeau `role="alert"` | n/a | protégé | Labels non liés aux inputs (pas de htmlFor) |
| EtiquetteGenerer / SortieCartons | ✔ | ✔ (bips + états) | ✔ | ✔ | Registre tactile adapté COLLABORATEUR |

---

*Fin du rapport 08. Chaque constat est reproductible via les références fichier:ligne et les commandes grep citées.*

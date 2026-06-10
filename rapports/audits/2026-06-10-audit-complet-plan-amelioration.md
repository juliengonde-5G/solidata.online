# SOLIDATA — Audit complet du dépôt & plan d'amélioration

> **Date** : 10 juin 2026
> **Périmètre** : dépôt `juliengonde-5G/solidata.online` complet (backend, frontend, mobile, ai-agent, deploy, docs)
> **Méthode** : audit en 4 phases (cartographie → audit par dimension → stratégie → plan de tâches). Chaque constat est cité `fichier:ligne` et a été **vérifié dans le code** — les constats non vérifiables sont signalés comme tels. Aucun code n'a été modifié.

---

## 1. Executive Summary

**Note globale : C (≈ 6/10).** SOLIDATA est un ERP de production réel, fonctionnellement très riche (27 modules, 89 fichiers de routes, 83 pages web), avec de bons fondamentaux de sécurité applicative (requêtes 100 % paramétrées, JWT fail-fast, HMAC webhooks, rate limiting, CSP) et une automatisation de déploiement sérieuse. Mais le dépôt porte trois risques majeurs. **Risque n°1 — RGPD/juridique** : des données personnelles de salariés (état civil de 45+ personnes dans `collaborators_import.csv`) et un document psychologique nominatif (`CHEDEVILLE-Remi-Psye.pdf`) sont versionnés dans git et son historique — pour une SIAE, c'est une exposition directe. **Risque n°2 — robustesse opérationnelle** : aucun handler `unhandledRejection`/`uncaughtException`, 67 catch silencieux, 49 fuites de `err.message` au client, aucun outil de remontée d'erreurs — les incidents prod récurrents documentés dans le CHANGELOG en sont le symptôme. **Risque n°3 — filet de sécurité quasi absent sur les chemins critiques** : 0 test frontend sur 83 pages, modules argent/conformité (SumUp, Refashion/DPAV, TourService) sans tests, lint CI neutralisé par `|| true`, smoke test aveugle derrière l'authentification. **Opportunité n°1** : une CI existe déjà — la durcir coûte peu et rapporte beaucoup. **Opportunité n°2** : tous les patterns cibles existent déjà dans le code (useAsyncData/ErrorState, Repository, state-machine, BullMQ) — il faut généraliser, pas inventer. **Opportunité n°3** : nettoyage git + migrations versionnées = gains de vélocité durables. Le plan ci-dessous est séquencé en 4 jalons, avec 7 quick wins exécutables immédiatement.

---

## 2. Repo Map

**Objet** : ERP métier pour Solidarité Textiles (SIAE, collecte/tri/valorisation textile, Rouen). Utilisateurs internes (~6 rôles), production réelle sur un serveur unique Scaleway DEV1-S (~2 GB RAM). Maturité : **service de production interne**, croissance très rapide (v1.0 → v2.1 en 3 mois).

**Stack** : Node 20 / Express 4.21 / PostgreSQL 15 + PostGIS / Redis 7 / Socket.IO / BullMQ (partiel) — React 18 + Vite (web + PWA mobile) — Flask + Claude API (ai-agent) — Docker Compose + Nginx + Let's Encrypt.

| Répertoire | Description | Volume |
|---|---|---|
| `backend/src/routes/` | 89 fichiers de routes Express (63 racine + sous-dossiers `tours/`, `insertion/`) | cœur du système |
| `backend/src/services/` | 20 services (sumup, scheduler, state-machine, TourService, BillingService, IA…) | |
| `backend/src/scripts/init-db.js` | Schéma + migrations + seeds en un seul fichier | **4 395 lignes** |
| `backend/src/index.js` | Entry point : Express + Socket.IO inline + handler uploads + init DB | 630 lignes |
| `frontend/src/pages/` | 83 pages React (lazy-loadées) | la plus grosse : 1 272 lignes |
| `mobile/src/` | PWA chauffeur (sync offline IndexedDB, GPS, scan) | |
| `ai-agent/` | SolidataBot Flask (DB read-only) | |
| `deploy/` | deploy.sh, backup.sh/backup-s3.sh, restore.sh, nginx | |
| `.github/workflows/ci.yml` | CI : lint (non bloquant), Jest backend, pytest ai-agent, builds | |
| *racine du dépôt* | **34 fichiers binaires métier versionnés** (PDF, XLSX/XLSM, KML, ZIP du dépôt lui-même) | `.git` = 33 MB (≈ 49 % du dépôt) |

**Surprises de la cartographie** :
- Des données personnelles et documents confidentiels committés à la racine (voir §3.3, constat S1).
- `Solidata.online.zip` : un snapshot complet du dépôt… versionné dans le dépôt.
- `CLAUDE.md` annonce « 69 fichiers de routes / 75 pages » ; réalité : **89 routes / 83 pages** (doc désynchronisée d'un mois).
- Deux affirmations courantes des audits précédents sont aujourd'hui fausses dans le bon sens : la purge GPS 90 jours **existe** (`backend/src/services/scheduler.js:497`) et l'intercepteur de refresh token web est **correct** (`frontend/src/services/api.js:36-46` : flag `isRefreshing` posé de façon synchrone, pas de race condition — contrairement à ce qu'un premier passage d'analyse suggérait).

---

## 3. Audit Report

Légende : **[F]** = fait vérifié dans le code · **[J]** = jugement/appréciation. Sévérités : Critical / High / Medium / Low.

### 3.1 Conformité & données (le plus urgent)

| ID | Sév. | Constat |
|---|---|---|
| **S1** | **Critical** | **[F] Données personnelles versionnées dans git.** `collaborators_import.csv` (racine, suivi par git) contient nom, sexe, **date de naissance**, nationalité, contrat de 45+ salariés. `CHEDEVILLE-Remi-Psye.pdf` (2,6 MB) est un document psychologique nominatif. S'y ajoutent `demande-subvention-202504865 (1).pdf`, livrets d'accueil, trames d'entretien. **Conséquence** : toute personne ayant eu accès au dépôt (clones, CI, backups, intégrations) détient ces données ; pour une SIAE soumise au RGPD (le projet a même un module RGPD !), c'est une violation caractérisée, et la suppression simple ne suffit pas — **l'historique git les conserve**. |
| **S2** | **High** | **[F] 34 fichiers binaires métier suivis par git** (`git ls-files` : PDF/XLSX/XLSM/KML/ZIP), dont des exports de données opérationnelles (CAV, tonnages, ventes). `.git` pèse 33 MB. Conséquence : clones lents, données métier figées dans l'historique, et `docker-compose.prod.yml` monte certains de ces fichiers en volumes — le cycle de mise à jour d'une donnée passe par git push + redeploy. |

### 3.2 Sécurité

| ID | Sév. | Constat |
|---|---|---|
| **S3** | **Critical** | **[F] Fallback de mot de passe DB en dur dans l'ai-agent.** `ai-agent/app.py:54` : `pw=os.environ.get("DB_PASSWORD", "solidata_pass")`. Si la variable manque au déploiement, l'agent se connecte avec un mot de passe désormais public (il est dans git). Incohérent avec le helper `_require_secret()` introduit en v2.0.2 pour `JWT_SECRET`/`SECRET_KEY` dans le même fichier. |
| **S4** | **High** | **[F] Multer sans `fileFilter` sur `/api/finance`.** `backend/src/routes/finance.js:8` : `multer({ storage: memoryStorage(), limits: { fileSize: 50MB } })` sans filtre, alors que le module mutualisé `utils/upload-filters.js` existe (T1.1 du 11/05) et est appliqué partout ailleurs. |
| **S5** | **High** | **[F] 49 occurrences de `res.json({ error: err.message })`** (ex. `backend/src/routes/boutique-commandes.js:328`, `communes.js:19`, `employees.js:582`) : fuite de noms de tables/contraintes/chemins au client. |
| **S6** | **Medium** | **[F] Handlers Socket.IO sans contrôle de rôle.** `backend/src/index.js:277-313` : le JWT est vérifié à la connexion, mais `gps-update`/`cav-collected` sont émettables par n'importe quel rôle authentifié (un COLLABORATEUR peut injecter des positions GPS). |
| **S7** | **Medium** | **[F] Refresh token web aussi renvoyé dans le body JSON** (`backend/src/routes/auth.js:189-191`) en plus du cookie HttpOnly — nécessaire pour le mobile, mais le client web n'en a pas besoin (risque de log/cache). |
| **S8** | **Medium** | **[F] Refresh token mobile en `localStorage`.** `mobile/src/contexts/AuthContext.jsx:32,42` stocke `mobile_refresh_token` en localStorage, alors que le web est passé au modèle « cookie HttpOnly exclusivement » (commentaire `frontend/src/services/api.js:49-50`). Une XSS sur la PWA exfiltre le refresh token 7 jours. |
| **S9** | **Medium** | **[F] CSP backend contient `'unsafe-eval'`** (`backend/src/index.js:57`) tandis que la CSP Nginx ne l'a pas — incohérence ; le navigateur applique la plus stricte, mais à aligner. |
| **S10** | **Medium** | **[F] Vulnérabilités npm runtime** : backend 1 high (`tmp` via exceljs) + 11 moderate (chaîne `ws`/socket.io) ; frontend 3 high (**axios SSRF**, **react-router** turbo-stream, react-router-dom) ; mobile 6 high + 1 critical (vitest, **dev-only**). La plupart se corrigent par `npm audit fix` sans breaking change. |

**Sain / points forts sécurité** : requêtes SQL 100 % paramétrées (les 2 cas dynamiques — `insertion/index.js:57`, `pennylane.js:233` — sont whitelistés et sûrs) ; `admin-db.js` utilise `execFileSync` sans shell ; fail-fast `JWT_SECRET` en prod (`index.js:272-274`) ; handler `/uploads` durci (path-traversal, nosniff, CSP sandbox, `index.js:127-152`) ; cookies HttpOnly+Secure+SameSite ; TLS/HSTS corrects ; auth chauffeur par token 2¹²⁸ non énumérable ; webhook SumUp signé HMAC ; DB read-only pour l'ai-agent.

### 3.3 Architecture & qualité de code (backend)

| ID | Sév. | Constat |
|---|---|---|
| **A1** | **Critical** | **[F] Aucun handler process-level.** Pas de `process.on('unhandledRejection')` ni `uncaughtException` dans `backend/src/index.js` (vérifié par grep sur tout `src/`). Une promesse rejetée non rattrapée fait crasher le process sans trace exploitable ni arrêt propre du pool/Socket.IO. Pas non plus de handler SIGTERM (arrêt non gracieux à chaque deploy). |
| **A2** | **High** | **[F] `init-db.js` = 4 395 lignes mêlant schéma, migrations et seeds**, sans table de versions ni rollback. Les migrations idempotentes `DO $$ ... EXCEPTION WHEN duplicate_column $$` fonctionnent mais sont inauditables — l'historique du CHANGELOG (colonnes manquantes en prod les 02/05 et 11/05) montre que ce mécanisme laisse passer des dérives de schéma. |
| **A3** | **High** | **[F] 67 catch silencieux** (`catch (_) {}`, `.catch(() => {})`) — ex. `cav.js:1132`, `dashboard.js:320`, `chat.js:592`. Combiné au cache Redis, c'est la recette documentée de l'incident du 11/05 (« 3 bugs SQL invisibles tant que le cache tenait »). |
| **A4** | **High** | **[F] Scheduler in-process à `setInterval`** (`services/scheduler.js:596-601`, heures 7/12/18 en dur) avec lock PostgreSQL approximatif sans TTL (`scheduler.js:794-822`). Mono-instance aujourd'hui : acceptable ; mais tout scaling à 2+ containers dupliquerait les SMS/emails/syncs. BullMQ est installé et initialisé (`job-queue.js`) mais sous-utilisé, avec un fallback synchrone silencieux si Redis tombe. |
| **A5** | **Medium** | **[F] Adoption inachevée des patterns** : 1 seul repository (`InvoiceRepository`) — `finance.js` (54 requêtes inline), `cav.js` (49), `vehicles.js` (40) ; duplication `parseCSVDate`/parsing CSV entre `boutique-ventes.js:48-80` et `vak.js` ; deux haversine (`TourService.js:24` en km, `event-discovery.js:45` en mètres). |
| **A6** | **Medium** | **[F] Forme de réponse API non uniforme** (`{error}` vs `{error, code}` vs `{success, message}` vs rows nus) — le front doit deviner. **[J]** Un wrapper de réponse standard rendrait l'ErrorState générique trivial à brancher. |
| **A7** | **Low** | **[F]** ~32 `console.log` dans `services/` (scheduler, import-excel…) contournent winston — y compris dans la purge GPS (`scheduler.js:500`) ; logs non structurés, non corrélés au `x-request-id`. |

**Points forts** : middleware `error-handler.js` correct (mapping codes PG) ; state machine centralisée + audit ; services `BillingService`/`TourService` propres et testés ; transactions avec `FOR UPDATE` sur les workflows concurrents ; `/health` `/live` `/ready` complets ; resync automatique des séquences SERIAL au boot.

### 3.4 Frontend & mobile

| ID | Sév. | Constat |
|---|---|---|
| **F1** | **High** | **[F] Aucun ErrorBoundary** dans `frontend/src/App.jsx` (grep `ErrorBoundary|componentDidCatch` : 0 résultat sur 83 pages). Une exception de rendu dans n'importe quelle page = écran blanc total. |
| **F2** | **High** | **[F] ~94 % des pages gèrent les erreurs à la main et en silence** : `useAsyncData` (hook maison) n'est utilisé que par ~3 pages, `ErrorState` par ~5 ; 190+ `console.error(err)` sans message utilisateur ni bouton Réessayer. Conséquence : sur un 500 API, l'utilisateur voit une page vide ou un loader infini (les 8 plus grosses pages sont toutes dans ce cas). |
| **F3** | **Medium** | **[F] God-pages** : `Candidates.jsx` = 1 272 lignes / 23 `useState` (kanban + détail + 6 onglets + upload + PCM dans un fichier) ; `AdminPredictive.jsx` ≈ 1 009 lignes. |
| **F4** | **Medium** | **[F] Offline mobile incomplet sur le scénario de bout en bout.** `mobile/src/services/sync.js` et `db.js` existent et la file de sync est testée unitairement (`mobile/tests/sync.test.js`) — c'est mieux que ce que les audits passés affirmaient — mais aucun test ne couvre le scénario réel offline→file→reconnexion→drain, et l'intercepteur mobile (`mobile/src/services/api.js:15-40`) supprime le token sur échec de refresh hors-ligne → re-login forcé au retour réseau. Le callback d'erreur GPS est vide (`mobile/src/pages/TourMap.jsx:113`) : refus de géolocalisation silencieux. |
| **F5** | **Low** | **[F]** Pas d'ESLint/Prettier dans frontend ni mobile (aucun config, aucun script). Accessibilité partielle (les composants partagés de la V1.5.0 sont corrects, mais boutons-icônes sans `aria-label`, menus sans `aria-expanded`). i18n inexistante — acceptable pour un outil interne mono-langue. **[J]** |

**Points forts** : lazy loading des 83 pages + `manualChunks` vendor ; intercepteur refresh web correct avec file d'attente ; `ProtectedRoute` par rôles ; composants partagés (KpiCard, Modal a11y, FormField) réellement réutilisés ; cleanup Socket.IO présent sur les pages live.

### 3.5 Tests, CI/CD, DevEx

| ID | Sév. | Constat |
|---|---|---|
| **T1** | **Critical** | **[F] Le lint CI n'échoue jamais** : `.github/workflows/ci.yml:51` → `npx eslint src/ ... || true`, et **aucun `.eslintrc` n'existe** dans le dépôt — la commande tourne donc à vide et tout passe. Effet : la CI donne une fausse assurance qualité. |
| **T2** | **Critical** | **[F] Zéro test frontend** (aucun runner ni lib de test dans `frontend/package.json`) pour 83 pages, et **aucun test sur les chemins argent/conformité** : pas de `sumup.test.js` (sync de CA réel), pas de `TourService.test.js`, rien sur la génération DPAV Refashion. Les 180 tests backend existants (BillingService, state-machine, error-handler…) mockent tous `pg` — aucune migration n'est jamais exécutée en CI contre un vrai PostgreSQL, ce qui est exactement la classe de bug qui a frappé la prod 3 fois (CHANGELOG 02/05, 11/05). |
| **T3** | **High** | **[F] Le smoke test est aveugle derrière l'auth** : `scripts/tests/api-smoke.js:91` considère 401/403 = OK ; sans `API_USER`/`API_PASSWORD` (vides dans `.env.example`), ~60 % des endpoints critiques ne sont vérifiés qu'en mode « la route existe ». |
| **T4** | **High** | **[F] Backups jamais validés** : `deploy/scripts/backup.sh` et `backup-s3.sh` produisent des dumps, `restore.sh` existe, mais aucun test de restauration automatisé ni alerte si le backup ne tourne plus. **[J]** Pour un ERP avec données de paie/insertion, un backup non testé n'est pas un backup. |
| **T5** | **High** | **[F] Aucune remontée d'erreurs** (pas de Sentry/équivalent dans `package.json` ni `index.js`) : les erreurs prod ne sont vues que si quelqu'un lit les logs du container. |
| **T6** | **Medium** | **[F] Docs désynchronisées** : `CLAUDE.md` (69 routes/75 pages vs 89/83 réels) ; `DOCUMENTATION_TECHNIQUE.md` datée v1.3.3 (11 avril) — 5 versions de retard. |

**Points forts** : une CI multi-jobs existe (tests backend + pytest ai-agent + builds Docker) ; `deploy.sh` mature (backup auto, init-db gate, health check, smoke hooké) ; smoke test bien conçu dans son principe ; 39 tests mobile réels ; documentation fonctionnelle exceptionnellement riche pour un projet de cette taille.

### 3.6 Performance & base de données

| ID | Sév. | Constat |
|---|---|---|
| **P1** | **High** | **[F] Imports CSV synchrones dans le chemin de requête** : `boutique-ventes.js:309` et `vak.js:711` font `fs.readFileSync` (limite 20 MB) puis parsent en boucle dans le handler → l'event loop bloque, gelant GPS temps réel et toutes les requêtes concurrentes pendant le parse. BullMQ est disponible et inutilisé pour ça. |
| **P2** | **High** | **[F] 102 `SELECT *` dans les routes** (ex. `vak.js:693`, `dashboard.js:380`) et endpoints de liste avec `LIMIT 500` en dur sans `offset` exposé (`boutique-ventes.js:798`) — colonnes JSONB/TEXT inutiles transférées, et l'utilisateur croit voir « tout ». |
| **P3** | **Medium** | **[F] Tables d'audit sans rétention** : la purge existe pour `gps_positions` (90 j, `scheduler.js:490-510`) ✔, mais **rien** pour `state_transitions_audit`, `rgpd_audit_log`, `pennylane_sync_log`, `vak_sumup_sync_log` — croissance non bornée sur un serveur 2 GB. |
| **P4** | **Medium** | **[F] Cache quasi inutilisé** : `cacheMiddleware` n'est branché que sur ~3 endpoints dashboard alors que les agrégats reporting/production sont recalculés à chaque hit. **[F] Redis `noeviction`** (`docker-compose.prod.yml:32`) est un **choix documenté et correct** (exigence BullMQ, cf. CHANGELOG 02/05 — les clés `cache:*` expirent par TTL) ; le vrai risque résiduel est l'absence d'alerte quand Redis approche de 256 MB : les écritures échoueraient alors silencieusement. À monitorer, pas à « corriger ». |
| **P5** | **Medium** | **[F] `/dashboard/kpis` : ~17 requêtes dans un seul `Promise.all` sans isolement** (`dashboard.js:46-160`) — une seule requête cassée = endpoint entier en 500, masqué 120 s par le cache (pattern exact des incidents passés). |
| **P6** | **Low** | **[F]** PostgreSQL non tuné (defaults dans un container 512 MB — `work_mem` 4 MB) ; pool pg `max:20` sans métriques exportées (`config/database.js:11-19`). |

**Points forts perf** : throttle GPS + cache tour_cav (−98 % de requêtes, vérifié présent) ; 16+ index FK ajoutés en V1.5/2.0 ; code splitting + lazy ; verrous pessimistes sur les workflows ; purge GPS RGPD opérationnelle.

### 3.7 Dépendances
Lockfiles présents et cohérents partout ✔. Vulnérabilités listées en S10. `xlsx` (vuln. sans fix) a déjà été remplacé par exceljs — bon réflexe. **Non vérifié** : audit de licences (rien d'alarmant repéré dans les manifests, mais pas d'analyse exhaustive).

---

## 4. Improvement Strategy

### Thème 1 — « Le dépôt n'est pas un coffre-fort » (conformité données)
La racine du dépôt sert de dossier partagé : données salariés, documents médicaux, exports métier, ZIP du dépôt. **État cible** : le dépôt ne contient que du code, de la config et de la doc ; les documents vivent dans un stockage dédié (Scaleway Object Storage existe déjà via `backup-s3.sh`) ; l'historique git est purgé. **Principe** : tout ce qui entre dans git est public pour toujours vis-à-vis de quiconque a un clone.

### Thème 2 — « Les erreurs doivent faire du bruit » (observabilité des défaillances)
Catch silencieux + cache masquant + pas de handler process + pas de Sentry = les pannes sont découvertes par les utilisateurs. **État cible** : tout échec est loggé avec contexte, les rejets non gérés tuent le process proprement (et Docker le redémarre), une alerte part quand le taux d'erreurs monte. **Principe** : un système qui échoue bruyamment se répare en heures ; un système qui échoue en silence se répare en audits mensuels — c'est littéralement l'histoire de ce projet (8 bugs bloquants récurrents ≥ 3 jours en avril).

### Thème 3 — « Un filet avant l'acrobatie » (tests sur les chemins critiques + CI qui mord)
La CI existe mais ne bloque rien d'important ; les chemins argent (SumUp), conformité (DPAV) et schéma (migrations) ne sont couverts par rien. **État cible** : lint bloquant, tests d'intégration PostgreSQL réels en CI (init-db from scratch + smoke authentifié), tests unitaires sur sumup/TourService/DPAV. **Principe** : tester en priorité ce qui coûte cher quand ça casse, pas ce qui est facile à tester.

### Thème 4 — « Généraliser les patterns déjà gagnés » (dette d'adoption, pas de conception)
Le projet a déjà conçu ses bonnes solutions (useAsyncData/ErrorState, Repository, state-machine, BullMQ, upload-filters) mais s'arrête à 5-10 % d'adoption à chaque vague. **État cible** : chaque pattern pilote validé est généralisé jusqu'à son domaine complet avant d'en lancer un nouveau. **Principe** : la valeur d'un pattern vient de son uniformité, pas de son existence.

### Ce qu'on recommande de **ne pas** faire maintenant (trade-offs assumés)
- **Pas de réécriture des 89 routes en repositories** : ROI insuffisant ; réserver le pattern aux domaines à forte churn (finance, cav) au fil de l'eau.
- **Pas de multi-instance / Kubernetes / réplication PG** : mono-serveur assumé à cette échelle ; corriger le scheduler suffit à dérisquer un futur scaling.
- **Pas d'i18n ni de couverture de test frontend exhaustive** : outil interne mono-langue ; viser 5-10 pages critiques testées, pas 83.
- **Pas de remplacement de Redis `noeviction`** : c'est l'exigence BullMQ documentée ; ajouter du monitoring à la place.
- **Pas de refonte du mix français/anglais** : coût de renommage massif pour un gain cosmétique.

### Définition de « terminé » (signaux mesurables)
1. `git ls-files | grep -E '\.(pdf|xlsx|xlsm|zip|kml|docx|csv)$'` ne retourne plus aucune donnée personnelle ; historique purgé ; `.gitignore` bloque la récidive.
2. La CI **échoue** sur : erreur ESLint, test rouge, échec d'init-db sur PostgreSQL 15 vierge, smoke authentifié avec un 5xx.
3. `grep -c "process.on('unhandledRejection'" backend/src/index.js` = 1 ; zéro `{ error: err.message }` brut en prod ; Sentry (ou équivalent) reçoit les erreurs.
4. `sumup.js`, `TourService.js` et la génération DPAV ont des tests ; couverture backend ≥ 25 % (13 % aujourd'hui).
5. Une restauration de backup est exécutée et vérifiée automatiquement chaque semaine.
6. Zéro finding Critical ouvert.

---

## 5. Task Plan

### Quick wins (à faire immédiatement, tous S)

| # | Tâche | Fichiers | Effort |
|---|---|---|---|
| QW1 | Handlers `unhandledRejection`/`uncaughtException`/`SIGTERM` | `backend/src/index.js` | S |
| QW2 | Supprimer le fallback `"solidata_pass"` → `_require_secret("DB_PASSWORD")` | `ai-agent/app.py:54` | S |
| QW3 | `fileFilter: documentFilter` sur le multer finance | `backend/src/routes/finance.js:8` | S |
| QW4 | Retirer `\|\| true` du lint CI (après QW5) | `.github/workflows/ci.yml:51` | S |
| QW5 | Ajouter `API_USER`/`API_PASSWORD` aux secrets CI/serveur → smoke authentifié | `.env` serveur, secrets GitHub | S |
| QW6 | ErrorBoundary global avec fallback + bouton recharger | `frontend/src/App.jsx` + nouveau composant | S |
| QW7 | `npm audit fix` backend/frontend/mobile (axios, react-router, ws, tmp) + re-test | 3 `package-lock.json` | S |

### Milestone 0 — Filet de sécurité (≈ 1 semaine)

| ID | Tâche | Acceptation | Effort | Risque | Dép. |
|---|---|---|---|---|---|
| M0.1 | QW1 + QW6 (robustesse process & UI) | Crash test : une route qui `throw` en async ne tue plus le process sans log ; une page qui crashe affiche le fallback | S | Faible | — |
| M0.2 | Config ESLint backend+frontend+mobile (`eslint:recommended` + `react-hooks`), corriger ou désactiver finement les violations existantes, puis QW4 | CI rouge sur erreur lint | M | Faible (changements mécaniques) | — |
| M0.3 | Job CI « intégration PG » : service postgres:15-postgis, exécuter `init-db.js` from scratch, démarrer l'API, lancer le smoke **authentifié** (QW5) | CI rouge si une migration ou un endpoint critique casse | M | Faible | QW5 |
| M0.4 | Test de restauration backup hebdo : script qui restaure le dernier dump dans un container jetable + `SELECT count(*)` sur 5 tables sentinelles + alerte webhook si échec | Preuve de restauration datée < 7 j | M | Faible | — |

### Milestone 1 — Critiques sécurité & conformité (≈ 1 semaine)

| ID | Tâche | Acceptation | Effort | Risque | Dép. |
|---|---|---|---|---|---|
| M1.1 | **Purge RGPD du dépôt** : sortir les 34 fichiers binaires vers Object Storage privé, `git filter-repo` sur l'historique, `.gitignore` étendu, rotation des secrets par précaution, information des détenteurs de clones | §4 signal 1 ; le repo clone < 5 MB | M | **Élevé** (réécriture d'historique : tous les clones/branches doivent être re-clonés ; coordonner) | — |
| M1.2 | QW2 + QW3 + QW7 | Audits npm sans high runtime ; agent fail-fast | S | Faible | — |
| M1.3 | Assainir les erreurs : remplacer les 49 `err.message` exposés par message générique en prod (helper unique), logger les 67 catch silencieux en `logger.warn` avec contexte | `grep -rn "error: err.message" routes/` = 0 ; zéro `catch (_) {}` muet | M | Faible | M0.2 |
| M1.4 | Contrôle de rôle sur les handlers Socket.IO (`gps-update`, `cav-collected` réservés au flux chauffeur/ADMIN) | Test : un token COLLABORATEUR émettant `gps-update` est rejeté | S | Moyen (vérifier le rôle réel émis par driver-start) | — |
| M1.5 | Aligner le mobile sur le modèle refresh-cookie HttpOnly (ou a minima ne plus renvoyer le refresh token au web dans le body) | Plus de refresh token en localStorage mobile | M | Moyen (re-login chauffeurs) | — |

### Milestone 2 — Améliorations à fort levier (2-3 semaines)

| ID | Tâche | Acceptation | Effort | Risque | Dép. |
|---|---|---|---|---|---|
| M2.1 | **Migrations versionnées** : introduire `node-pg-migrate` (ou runner maison + table `_migrations`), geler `init-db.js` comme baseline v2.1, toute évolution future = fichier de migration numéroté joué par la CI (M0.3) | Nouvelle colonne livrée via migration, CI la valide sur base vierge **et** sur dump prod | XL → découper : (a) runner+baseline, (b) hook deploy.sh, (c) doc | Moyen | M0.3 |
| M2.2 | Tests des chemins critiques : `sumup.test.js` (parser CSV 17 col., mapping segments, HMAC, refresh OAuth), `TourService.test.js`, tests DPAV/vues Refashion sur PG réel | Couverture backend ≥ 25 % ; chaque bug SumUp/DPAV futur reproduit d'abord en test | L | Faible | M0.3 |
| M2.3 | Imports CSV (boutiques, VAK) → jobs BullMQ : réponse immédiate `{job_id}`, parsing en worker, statut consultable | Un import de 20 MB ne dégrade plus la latence des autres requêtes | M | Moyen (UX import à adapter) | — |
| M2.4 | Scheduler → BullMQ repeatable jobs (lock Redis TTL natif), suppression du `setInterval` et des heures en dur | Deux backends lancés en local n'exécutent chaque job qu'une fois | L | Moyen | M2.3 |
| M2.5 | Remontée d'erreurs : Sentry SaaS (ou GlitchTip self-hosted sur le serveur) branché backend (`error-handler`, handlers process) + frontend (ErrorBoundary) | Une exception prod = un événement visible avec stack + requestId | M | Faible | M0.1 |
| M2.6 | Généraliser `useAsyncData` + `ErrorState` sur les 20 pages les plus utilisées (Dashboard, Production, Tours, Stock, Boutiques, VAK…) | Sur un 500 simulé, chaque page affiche erreur + Réessayer | L | Faible | QW6 |
| M2.7 | Isoler les requêtes de `/dashboard/kpis` (helper `safeQuery` avec fallback + log) et étendre `cacheMiddleware` aux 8 endpoints d'agrégats les plus chers | Une requête cassée dégrade un KPI, pas la page ; X-Cache HIT sur reporting | M | Faible | M1.3 |

### Milestone 3 — Qualité & finitions (fil de l'eau)

| ID | Tâche | Effort |
|---|---|---|
| M3.1 | Rétention sur `state_transitions_audit`, `rgpd_audit_log`, `*_sync_log` (job purge + config en settings) | S |
| M3.2 | Remplacer `SELECT *` par des listes de colonnes + pagination `limit/offset` sur les 20 endpoints de liste les plus gros | M |
| M3.3 | Découper `Candidates.jsx` (kanban / détail / onglets) et `AdminPredictive.jsx` | L |
| M3.4 | Wrapper de réponse API standard `{ok, data, error, code}` (nouvelles routes d'abord, rétrofit progressif) | M |
| M3.5 | Resynchroniser `CLAUDE.md`/`DOCUMENTATION_TECHNIQUE.md` (compteurs, modules) + ajouter une étape de vérif dans la checklist commit | S |
| M3.6 | `console.log` services → winston ; propagation `x-request-id` dans les jobs | S |
| M3.7 | Tuning PG container (`work_mem`, `effective_cache_size`) + alerte mémoire Redis > 200 MB dans health-check | S |
| M3.8 | Tests E2E offline mobile (file → reconnexion → drain) + callback d'erreur géoloc visible | M |
| M3.9 | Monitoring pool pg (log périodique `totalCount/idleCount/waitingCount`) | S |
| M3.10 | Scénario E2E frontend léger (Playwright : login → dashboard → 3 parcours critiques) | L |

### Esquisses d'implémentation — top 3

**1. M1.1 Purge RGPD (la plus urgente, la plus délicate)**
- Étape 1 : inventorier `git ls-files | grep -iE '\.(pdf|xlsx|xlsm|zip|kml|docx|csv)$'` + tout CSV contenant des personnes ; copier vers un bucket S3 privé (réutiliser les credentials de `backup-s3.sh`).
- Étape 2 : sur un clone frais : `git filter-repo --invert-paths --path collaborators_import.csv --path 'CHEDEVILLE-Remi-Psye.pdf' ...` (liste complète), vérifier `git log --all --stat`, push force vers `main` **après accord explicite** et gel des merges.
- Étape 3 : `.gitignore` : `*.pdf`, `*.xlsx`, `*.xlsm`, `*.zip`, `*.kml`, `*.docx` racine (avec exceptions `docs/` si besoin) ; adapter les volumes de `docker-compose.prod.yml` qui montent ces fichiers (les servir depuis `/opt/solidata.online/data/` hors git).
- **Pièges** : tous les clones existants (serveur prod inclus !) doivent être re-clonés ou `git fetch && git reset --hard` ; les sessions Claude Code/CI en cours casseront ; GitHub garde les objets quelque temps (contacter le support pour un GC si exposition avérée) ; documenter l'incident au registre RGPD du module 14.

**2. M0.1/QW1 Handlers process + arrêt gracieux**
- Dans `index.js`, après l'init du logger : `process.on('unhandledRejection', ...)` (log + compteur ; crash après log si non-opérationnel), `process.on('uncaughtException', ...)` (log + `process.exit(1)` — Docker `restart: always` relance), `SIGTERM` → `server.close()`, `io.close()`, `stopScheduler()`, `pool.end()` avec timeout 10 s.
- **Pièges** : ne pas `exit` sur chaque unhandledRejection sans triage (certains catch `.catch(()=>{})` actuels masquent des rejets bénins — M1.3 d'abord ou en parallèle) ; tester avec `docker compose stop` que l'arrêt prend < 10 s.

**3. M0.3 CI intégration PostgreSQL + smoke authentifié**
- Nouveau job dans `ci.yml` : `services: postgres: image: postgis/postgis:15-3.4` + redis ; steps : `npm ci` → `node src/scripts/init-db.js` (échec = CI rouge) → `node src/index.js &` → attendre `/api/health` → créer un user ADMIN par script seed → `API_URL=http://localhost:3001 API_USER=... SMOKE_STRICT=true node scripts/tests/api-smoke.js`.
- **Pièges** : `init-db.js` suppose parfois des données seed (vérifier les seeds minimaux requis) ; fixer `JWT_SECRET`/`PCM_ENCRYPTION_KEY` de test en env CI ; le smoke en mode strict révélera probablement 2-3 endpoints cassés dès le premier run — c'est le but, prévoir une demi-journée de stabilisation.

---

## 6. Open Questions (décisions humaines requises)

1. **Purge d'historique git (M1.1)** : accord pour un `git filter-repo` + push force sur `main` ? Qui détient des clones à re-synchroniser (postes, serveur prod, intégrations) ? Faut-il notifier les salariés concernés / le DPO au titre du RGPD (l'exposition dépend de qui a eu accès au dépôt — privé ou non) ?
2. **Budget monitoring** : Sentry SaaS (~0-26 €/mois) ou GlitchTip self-hosted sur le DEV1-S (RAM déjà serrée) ?
3. **Fichiers métier montés en volumes** (`Liste PAV.xlsx`, dashboards XLSM) : sont-ils encore lus par le code ou résidus d'imports passés ? (Détermine s'ils partent en S3 ou à la poubelle.)
4. **Cible de couverture** : 25 % backend proposé comme jalon — la priorité métier est-elle plutôt SumUp/VAK (argent) ou Refashion/DPAV (conformité) pour ordonner M2.2 ?
5. **Mobile refresh token (M1.5)** : un re-login forcé de tous les chauffeurs (re-pairing D3 au dépôt) est-il acceptable, et quand ?
6. **Zones moins auditées** (revue plus légère, à approfondir si critiques pour vous) : `ai-agent` au-delà de la sécurité, scripts `deploy/` secondaires, contenu détaillé des 27 modules fonctionnels, licences des dépendances.

---

*Rapport produit le 10 juin 2026. Constats vérifiés sur le commit `6e53c27`. Deux faux positifs d'analyse intermédiaire ont été écartés après contre-vérification (purge GPS existante : `scheduler.js:497` ; intercepteur refresh web correct : `frontend/src/services/api.js:35-68`).*

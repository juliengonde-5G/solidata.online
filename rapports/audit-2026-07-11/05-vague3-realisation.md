# Vague 3 — Rapport de réalisation : consolider le socle

**Date** : 13 juillet 2026 · Clôt le [plan d'action](01-plan-action.md) (section Vague 3). Fait suite aux vagues [0](02-vague0-realisation.md), [1](03-vague1-realisation.md), [2](04-vague2-realisation.md).
**Méthode** : 8 agents d'implémentation en parallèle sur lots à fichiers quasi disjoints (lancés via le tool Agent, le tool Workflow ayant une panne transitoire), commits de sécurisation par checkpoints, puis agent debug final.
**Résultat** : **8/8 lots livrés**. Verdict debug : **prêt à committer** — une seule correction inter-lots nécessaire.
**Vérifications** : Jest backend **650/650** (55 suites, ~169 tests ajoutés depuis la vague 2) · build Vite OK · mobile Vitest **40/40** · séquence « base neuve » **re-prouvée sur PostgreSQL 16 réel** (init-db → migrate-exutoires → migrate-finance → init-db → init-db idempotent, + 8 vérifications de schéma).

## Ce qui a été livré

### Sécurité des sessions & des comptes
- **Révocation de session effective** (sans Redis) : colonne `users.token_version` embarquée dans le JWT (login, refresh, driver mobile) ; `authenticate` (désormais async) rejette en 401 `TOKEN_REVOKED` tout jeton dont la version diverge, capté par `api.js` → redirect login. Bump du compteur sur logout, reset-password, désactivation de compte et « forcer la déconnexion » — qui devient enfin réelle (l'audit l'avait qualifiée de cosmétique). Dégradation propre si la base est indisponible ; jetons hérités sans `tv` tolérés le temps de leur expiration (≤ 8 h).
- **Politique de mot de passe unifiée** : helper `validatePassword` (min 10) sur les 3 points d'écriture ; `POST /users` et reset-password posent `must_change_password` (l'écran bloquant de vague 0 prend le relais).
- **Échecs de login journalisés + verrouillage léger** : `login_failed` (email + IP, jamais le mot de passe) alimente enfin le filtre existant ; ~8 échecs / 15 min → 429 temporaire, jamais définitif (pas de DoS sur un compte).
- **refresh_tokens** : index (token, user_id) + job quotidien de purge des jetons expirés.

### RGPD & sous-traitance IA
- **Pseudonymisation avant l'API Anthropic** : `utils/pii-pseudonymize.js` (jetons « Salarié A/B » stables par requête, scrub des textes libres, date de naissance → tranche d'âge, ré-hydratation en sortie pour le CIP). Appliquée à `insertion-ai.js` (le patronyme réel ne part plus au modèle) et à `chat.js` (sanitizer des sorties d'outils — no-op aujourd'hui car les outils ne renvoient que de l'agrégé, mais barrière posée).
- **Registre RGPD** : entrée « sous-traitance IA Anthropic » (finalité, données pseudonymisées, base légale, durée) — seed idempotent (un bug de longueur > VARCHAR(100) qui aurait cassé init-db a été attrapé par l'agent).
- **Journalisation** des changements de permissions/rôles et des créations/révocations de clés API (jamais le secret en clair).

### Intégrité transactionnelle
Écritures multi-tables rendues atomiques (BEGIN/COMMIT/ROLLBACK sur client dédié) : **PCM** (`/submit` + contrainte `UNIQUE(session_id, question_number)` avec dédup), **planning** `/affecter` (TOCTOU retiré), **imports CSV boutiques et VAK** (hash committé au succès → fichier ré-importable après échec ; asymétrie FK `vak_ventes.batch_id` corrigée en `SET NULL`), **recrutement** (candidat + historique + compétences ; interview/mise-en-situation), **tri** (batches, colisages, items avec `FOR UPDATE` sur les totaux).

### Observabilité des chaînes & jobs
- **Journal `job_runs`** : wrapper `runInstrumented` sur les 22 jobs (début/fin/statut/erreur/durée), endpoint `GET /monitoring/jobs` (ADMIN) avec drapeau « en retard ».
- **Timeouts** par job (5 min) + **verrou advisory sur connexion dédiée** (un job bloqué ne garde plus le verrou).
- **Dérive du scheduler corrigée** : `setInterval` posé au boot (dont la minute figée empêchait les jobs à fenêtre < 30 min de tourner) remplacé par un `setTimeout` réaligné sur le top d'heure ; gardes de minute retirées.
- **Fraîcheur temps réel** : `GET /monitoring/realtime` (dernière position GPS, dernière lecture capteur, dernier webhook SumUp, statut MQTT, files BullMQ), résilient.

### Hygiène : schéma & code mort
- **Schéma insertion unifié** : `init-db.js` devient la source unique (l'IIFE de migration divergente de `insertion/index.js` est supprimée, ses 44+11 colonnes rapatriées en migrations idempotentes).
- **Code mort purgé** (après Grep exhaustif) : `cv-processor.js`, `ml.js` (+ son montage), `Reporting.jsx`. **Conservés à dessein** : `historique.js` (alimente le smoke test qui gate le déploiement) et les state machines non branchées (échafaudage documenté). Modèle Claude déjà `claude-sonnet-5` partout.

### Performance
- **`/cav/fill-rate` et `/cav/map`** réécrits en agrégats groupés (CTE `GROUP BY` + fenêtre `LAG`) : ~800 sous-requêtes corrélées → 2 passes, **équivalence de l'écart moyen prouvée** (LAG ASC == ROW_NUMBER DESC sur 2007 cas + test) ; cache court 60 s.
- **`generateIntelligentTour`** : contexte météo pré-chauffé (Open-Meteo 1 appel au lieu de ~200), boucle de prédiction parallélisée à concurrence bornée (ordre préservé → tournée identique), temps appris batchés (~30 → 1 requête). TSP/OSRM inchangés.
- Cache court sur les lectures capteur pures.

### Tests de contrat (le correctif systémique de T3) & mobile
- **Suite `backend/tests/contract/`** verrouillant la forme des réponses des endpoints réparés aux vagues 0-1 (FinanceOperations, trésorerie, rapprochement CA, stats exutoires, alertes dashboard, sortie dynamique, dpav-source) — chaque test documente son écran consommateur : un futur refactor cassera un test au lieu d'un écran en silence. Bannières d'erreur ajoutées sur 8 chargeurs encore muets.
- **Durcissement des routes mobiles `-public`** : garde JWT↔véhicule (un token du véhicule A ne peut plus agir sur le véhicule B), sans régression du flux chauffeur. + résiduels vague 2 (menu Seuils ADMIN/MANAGER, annulation de brouillon par RESP_BTQ, planning en lecture filtrée pour RESP_BTQ).

## Correction de la passe debug

- `monitoring.js` : le job `purgeExpiredRefreshTokens` (ajouté par le lot sécurité) manquait dans la table `JOB_SCHEDULE` du lot observabilité → il apparaissait « non enregistré » sans détection de retard. Entrée ajoutée (les 22 jobs instrumentés == 22 entrées de supervision).

## Points résiduels documentés (backlog)

1. **`candidates/conversion.js` `/link-employee` : double `client.release()`** sur les chemins d'erreur/validation → `unhandledRejection` après envoi de la réponse. **Bug réel mais pré-existant (vague 2), bénin** (n'affecte pas les réponses). À corriger dans une petite passe dédiée.
2. `employees.js` `PUT /availability` reste non-transactionnel (hors périmètre du lot transactions).
3. `production.js` `POST /chariots` conserve l'antipattern DELETE-puis-réinsertion.
4. Socket.IO (`index.js`) ne vérifie pas `token_version` (les JWT socket expirent en ≤ 8 h).
5. N+1 profond de `predictFillRate` (~5-6 requêtes/CAV dans `predictions.js`/`context.js`) non résolu — nécessite un lot dédié.
6. `ml-model.js` désormais orphelin (laissé en place, inoffensif).
7. Datation de la clé ticket boutique (`minute_key`) volontairement non traitée (risque sur l'idempotence prouvée des imports — mérite un lot isolé).

## Actions au déploiement

1. `deploy.sh update` (migrations idempotentes ; la reconstruction from scratch suit l'ordre RECONSTRUCTION.md, re-prouvé).
2. Après déploiement, tous les nouveaux jetons portent `token_version` ; les sessions en cours restent valides ≤ 8 h puis re-login (aucune rotation de secret requise).
3. Le journal `job_runs` et les endpoints `/monitoring/*` sont disponibles pour surveiller les chaînes — calibrer les seuils « stale » (`MONITOR_*_STALE_HOURS`) après observation terrain.
4. Vérifier que le compte de smoke test n'est pas bloqué par `must_change_password` (rattrapage `admin123` en place).

# Audit technique — Module « Authentification, rôles & administration »

**Date :** 11 juillet 2026
**Périmètre :** `backend/src/routes/{auth,users,permissions,settings,admin-db,admin-api-keys,rgpd,activity-log,public-api,push,webhooks}.js`, `backend/src/middleware/{auth,cache,request-logger,activity-logger,api-key,validate,error-handler}.js`, `backend/src/utils/upload-filters.js`, pages `Login/Users/AdminPermissions/Settings/AdminDB/RGPD/ActivityLog`, schéma `scripts/init-db.js` (module 1).
**Note globale : 7/10** — socle sain et nettement durci par les audits précédents ; la dette résiduelle se concentre sur la gestion du cycle de vie des sessions/jetons et sur quelques fragilités de schéma.

---

## 1. Qualité & cohérence

Le module respecte fidèlement les patterns du projet. Chaque route est un `express.Router` monté dans `index.js`, protégé par `authenticate` puis `authorize(...)`. Le placement est correct : `users.js`, `settings.js`, `admin-api-keys.js` appliquent `router.use(authenticate, authorize('ADMIN'))` en tête ; `rgpd.js` et `activity-log.js` font `router.use(authenticate)` puis un `authorize` fin par route (ADMIN, ou ADMIN/RH pour l'export art. 15) — bonne granularité. **Toutes les requêtes SQL du périmètre sont paramétrées** (`$1/$2`), y compris la construction dynamique de filtres (`activity-log.js`, `rgpd.js:audit`) qui pousse valeurs dans un tableau `params`. Aucune concaténation de valeur utilisateur dans du SQL n'a été trouvée. La gestion d'erreurs suit le canon `res.status(code).json({ error })` avec log `console.error` préfixé par module.

Points de friction :
- **Duplication.** Le double bloc `WHERE 1=1` (requête + requête `COUNT`) est recopié dans `activity-log.js` (l. 12-36 puis 88-92). `rgpd.js:purge-expired` (l. 256-289) réécrit la logique d'anonymisation candidat déjà présente dans `anonymize` (l. 113-131) au lieu de la factoriser. Les blocs CRUD `COALESCE(...)` de `settings.js` (templates, triggers, objectives) sont structurellement identiques.
- **Middleware `autoLogActivity` par monkey-patch de `res.json`** (`activity-logger.js:29`) : fonctionne mais `entityId = parseInt(data?.id || req.params?.id)` produit `NaN` pour une clé non numérique (ex. `role_key` custom `CR_...`), inséré dans une colonne `INTEGER` → INSERT rejeté (silencieusement avalé). `admin-api-keys.js` et `admin-db.js` n'utilisent pas ce middleware : la création/suppression de **clés API partenaires** n'est donc pas tracée dans `user_activity_log` (admin-db trace en revanche manuellement dans `rgpd_audit_log`).
- **Taille maîtrisée.** Aucun fichier n'est démesuré (le plus gros, `settings.js`, fait 360 lignes) — bon découpage.

## 2. Dette technique & schéma

- **Migrations fragiles / effets de bord au chargement.** `settings.js` exécute deux `pool.query('CREATE TABLE IF NOT EXISTS ...').catch(() => {})` **au niveau module** (l. 186 `periodic_objectives`, l. 268 `notification_triggers`), hors de `init-db.js` et avec l'erreur totalement avalée. `activity-logger.js:4` fait de même via une IIFE `ALTER TABLE ... ADD COLUMN IF NOT EXISTS username`. Ces migrations « sauvages » sont non ordonnancées, non observables et divergent de la règle projet (« nouvelles tables via `init-db.js` »).
- **`users.role` : `CHECK` supprimé à chaque démarrage.** `init-db.js:84-97` crée la table avec un `CHECK (role IN (...6 rôles))` puis un bloc `DO` scanne `pg_constraint` et **DROP** cette contrainte pour autoriser les rôles custom. La validation repose entièrement sur l'applicatif (`isValidRole`). Cohérent avec la feature « rôles personnalisés » mais fragile : toute route écrivant `users.role` sans passer par `isValidRole` peut insérer un rôle inexistant.
- **`refresh_tokens` : aucun index.** La table (`init-db.js:37`) n'a **aucun index** — ni sur `token` (pourtant lu par `WHERE rt.token = $1` à chaque `/refresh`, `auth.js:219`), ni sur `user_id` (utilisé par les `DELETE` de logout/reset). Chaque rafraîchissement fait un *seq scan*. La purge des jetons expirés n'existe qu'au boot (`init-db.js:2530`), donc la table grossit entre deux redémarrages.
- **Valeurs magiques.** `bcrypt.hash(pwd, 10)` (rounds en dur, répété dans `auth.js` et `users.js`), `LIMIT 200` en dur (`activity-log.js:111`), fallback `8h` dans `parseExpiry`, `userId ... || 1` (voir §3).

## 3. Sécurité

Le socle est bon : `helmet`, `cors` restreint (`ALLOWED_ORIGINS`, `credentials:true`), rate-limit global (1000/15 min) + strict sur `/api/auth` (30/15 min), `express.json({limit:'10mb'})`, `error-handler` qui masque la stack en production. `admin-db.js` est **exemplaire** : `execFileSync` (pas de shell), credentials passés par `env` (`buildPgEnv`), `restore/delete` bornés par `path.basename` + regex `SAFE_BACKUP_NAME`, et `purge` limité à une **whitelist table→colonne** avec jeton de confirmation. `admin-api-keys.js` construit son `UPDATE` dynamique sur une **whitelist de champs** (pas d'injection). `webhooks.js` compare le secret avec `crypto.timingSafeEqual` + garde de longueur. `upload-filters.js` applique une double whitelist extension+MIME. Aucune injection SQL ni path-traversal exploitable trouvée.

Faiblesses réelles :
- **[P1] Révocation de session cosmétique.** `authenticate` (`auth.js:14`) ne fait qu'un `jwt.verify` ; il ne consulte **jamais** `user_sessions`. Conséquence : `logout`, la « fermeture forcée » (`activity-log.js:129 DELETE /sessions/:id`) et le `reset-password` ne coupent pas la session vivante — l'access token JWT reste valable jusqu'à 8 h. Le mécanisme `user_sessions` (et son endpoint « Forcer la déconnexion ») donne une **fausse impression** de contrôle.
- **[P1] Utilisateur désactivé toujours capable de se rafraîchir.** `/refresh` (`auth.js:218`) ne re-vérifie pas `users.is_active`. La désactivation via `PUT /users/:id` (`users.js:76`) ne purge pas les `refresh_tokens` (seuls `DELETE /:id` et `reset-password` le font). Un compte désactivé par édition garde donc jusqu'à 7 j d'accès renouvelable.
- **[P1] Échecs de connexion non journalisés.** `auth.js:login` renvoie 401 sans `logActivity` sur mot de passe erroné. Or `activity-log.js:75,89` filtre sur `'login_failed'` — filtre **mort** (rien ne l'écrit). Aucune visibilité brute-force, aucun verrouillage de compte.
- **[P2] `refresh_tokens` en clair.** La colonne `token` stocke le secret en clair (contrairement à l'access token haché en session et aux clés API hachées SHA-256). Une fuite base = jetons rejouables 7 j.
- **[P2] Fallback `userId = genericUser.rows[0]?.id || 1` (`auth.js:87`).** Aucun utilisateur `username='chauffeur'` n'est *seedé* (vérifié dans `scripts/`). Le chemin « chauffeur assigné sans `user_id` » émet donc un JWT avec `id:1` — typiquement le premier ADMIN. Le rôle reste `COLLABORATEUR` (pas d'escalade de rôle), mais toute action est **attribuée à l'utilisateur 1** dans les logs. Latent, à corriger.
- **[P2] Matrice d'habilitations = masquage sidebar uniquement.** `role_module_access` (`permissions.js`) n'est **pas** appliquée côté serveur (aucune route ne consulte `my-modules` pour bloquer). C'est un filtre front documenté comme tel, mais il ne doit pas être présenté comme un contrôle d'accès : l'API reste joignable directement.
- **[P2] Politique de mot de passe faible** : minimum 6 caractères, aucune complexité (`auth.js`, `users.js`). Le changement de mot de passe self-service n'invalide pas les autres sessions/jetons.
- **Mineurs :** `api-key.js:46` compare le hash avec `!==` (préférer `timingSafeEqual`) ; CSP `helmet` autorise `unsafe-inline`/`unsafe-eval` (`index.js:57`) ; `login` renvoie encore `refreshToken` dans le corps malgré le durcissement cookie HttpOnly ; `public-api.js:refashion/dpav` fait `SELECT *` (expose des colonnes internes) ; `GET /settings` renvoie `SELECT *` (inclut les secrets SumUp chiffrés — ADMIN only, risque faible).

## 4. Robustesse

Bons points : écritures multi-tables sous transaction dans `permissions.js` (création/suppression de rôle, avec `ROLLBACK`/`release`) et `rgpd.js:anonymize` ; rotation du refresh token à chaque usage ; `cache.js` et `push.js` dégradent proprement.

Fragilités :
- **[P1] `backup`/`restore` synchrones.** `execFileSync` (`admin-db.js:102,161`) **bloque l'event-loop** jusqu'à 120 s / 300 s : pendant une sauvegarde, toute l'API (mono-thread) est gelée. À basculer en asynchrone (`execFile`/spawn). De plus `restore` (destructif) n'exige pas de jeton de confirmation, contrairement à `purge`.
- **[P2] `rgpd.js:purge-expired` non transactionnel** : boucle N+1 (SELECT puis 4 requêtes par candidat) hors transaction — un échec en cours laisse une anonymisation partielle.
- **[P2] `cache.invalidate` utilise `KEYS`** (`cache.js:34`), commande Redis bloquante O(N) déconseillée en production (préférer `SCAN`). `cacheMiddleware` ne scope pas la clé par utilisateur : risque de fuite inter-utilisateur en cas de réemploi sur un endpoint personnalisé.
- **Intercepteur front** (`services/api.js:35`) : le refresh ne se déclenche que sur `code:'TOKEN_EXPIRED'`. Un `401 Token invalide` (ex. après rotation `JWT_SECRET`) n'est ni rafraîchi ni redirigé → utilisateur potentiellement bloqué sans message clair.

## 5. Testabilité

Couverture correcte sur le cœur : `auth.test.js` (login/refresh/logout/me/password, cas 400/401/404/succès), `auth` middleware (`authenticate`/`authorize`), plus `users.test.js`, `cache`, `validate`, `request-logger`, `error-handler`. **Manques prioritaires** : `permissions.js` (duplication de rôle, upsert matrice, résolution `resolveBaseRole`→base — la logique la plus riche, **non testée**) ; `admin-db.js` (whitelist purge, sécurité `restore`/`delete` — sécurité-critique, **non testée**) ; `api-key.js` (parse, scopes, expiration) ; `rgpd.js:anonymize` (transaction). Aucun test ne couvre l'`authorize` avec un rôle personnalisé résolu vers son rôle de base.

## 6. Recommandations priorisées

| # | Priorité | Effort | Action |
|---|----------|--------|--------|
| 1 | **P0** | M | Rendre la révocation effective : faire consulter à `authenticate` l'état de session/jeton (table `user_sessions.is_active` ou liste de révocation Redis avec le `jti`), afin que logout / force-logout / reset coupent réellement l'access token. |
| 2 | **P1** | S | Re-vérifier `users.is_active` dans `/refresh` **et** purger `refresh_tokens` sur `PUT /users/:id` quand `is_active` passe à false. |
| 3 | **P1** | S | Journaliser les échecs de login (`action:'login_failed'`, IP) et ajouter un verrouillage/temporisation par compte au-delà de N échecs. |
| 4 | **P1** | S | Créer les index `refresh_tokens(token)` et `refresh_tokens(user_id)` ; planifier la purge des jetons expirés dans le scheduler (pas seulement au boot). |
| 5 | **P1** | M | Passer `backup`/`restore` en exécution asynchrone (non bloquante) ; ajouter un jeton de confirmation à `restore`. |
| 6 | **P2** | S | Corriger le fallback `driver-start` : seeder un vrai compte `chauffeur` ou refuser explicitement (400) au lieu de `|| 1`. |
| 7 | **P2** | M | Consolider les migrations de `settings.js`/`activity-logger.js` dans `init-db.js` (supprimer les `CREATE TABLE ... .catch(()=>{})` au chargement de module). |
| 8 | **P2** | M | Ajouter des tests sur `permissions.js`, `admin-db.js` (whitelist/path) et `api-key.js`. |
| 9 | **P2** | S | Hacher les `refresh_tokens` en base ; `timingSafeEqual` pour la comparaison de hash clé API ; factoriser `purge-expired` sur la fonction d'anonymisation (transactionnelle). |

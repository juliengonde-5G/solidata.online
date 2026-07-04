# Audit exhaustif SOLIDATA — 01. Transverse : sécurité, logique des routeurs, socle backend

**Date** : 3 juillet 2026
**Périmètre** : `backend/src/index.js`, `backend/src/middleware/*`, les 63 fichiers de `backend/src/routes/`, `ai-agent/app.py`
**Méthode** : lecture directe du code, chaque affirmation référencée `fichier:ligne`. Aucun fichier de code modifié.

---

## Synthèse

Le socle backend est globalement **solide et cohérent** : montage des routes propre (63 routers montés, 0 orphelin, 0 mount fantôme), middleware d'auth centralisé (`authenticate` + `authorize`), requêtes SQL quasi-systématiquement paramétrées, remédiations sécurité passées bien présentes (webhooks HMAC/timingSafeEqual, `execFileSync` anti-injection shell dans admin-db, whitelists d'identifiants sur les `ALTER TABLE` de migration, hardening `/uploads`). L'agent IA (`ai-agent/app.py`) est exemplaire (DB read-only, secrets fail-fast, contrôle RGPD par rôle, rate-limit, `/dev/token` opt-in).

**Mais** trois angles morts sérieux subsistent :

1. **Le module RGPD est cassé pour les candidats** — il interroge une table `pcm_profiles` qui n'existe pas → l'anonymisation d'un candidat (droit à l'effacement, Art. 17) échoue silencieusement par ROLLBACK, l'export (Art. 15) et la purge automatique aussi. Non-conformité légale pour une SIAE.
2. **Toute la couche « mobile chauffeur » est non authentifiée** — 14 endpoints `/api/tours/:id/*-public` (dont écriture : démarrer/terminer une tournée, saisir des poids, créer des incidents) sont montés **avant** `authenticate` et prennent un `:id` entier énumérable. `GET /api/vehicles/available` est également public et fuit les noms des chauffeurs (PII).
3. **Socket.IO n'autorise pas les salles ni les événements** — n'importe quel utilisateur authentifié peut rejoindre `tour-<id>` / `vak:live:<id>` et injecter des positions GPS pour n'importe quel véhicule.

Enfin, un anti-pattern transverse : **90 handlers renvoient `err.message` brut au client**, contournant la redaction en production du gestionnaire d'erreurs global.

### Décompte des findings

| Sévérité | Nombre |
|----------|--------|
| BLOQUANT | 3 |
| MAJEUR | 6 |
| MINEUR | 8 |
| **Total** | **17** |

---

## Tableau de couverture des routeurs

Légende : **Monté** = référencé dans `index.js` ; **Auth glob.** = `router.use(authenticate)` global (ligne) ; **Rôles** = ensemble des rôles cités dans les `authorize(...)` du fichier.

| Fichier | Monté (chemin) | Auth glob. | Rôles | Remarques |
|---------|----------------|:---------:|-------|-----------|
| auth.js | ✅ /api/auth | — (par route) | — | `/login`,`/refresh`,`/driver-start` publics (normal) ; `/logout`,`/me`,`/password` inline `authenticate`. OK |
| users.js | ✅ /api/users | L11 | ADMIN | `router.use(authenticate, authorize('ADMIN'))` global. OK |
| settings.js | ✅ /api/settings | L9 | ADMIN | global ADMIN. Contient `CREATE TABLE` IIFE (voir Optim.) |
| rgpd.js | ✅ /api/rgpd | L8 | ADMIN, RH | **BUG pcm_profiles** (F1). Auth OK |
| admin-db.js | ✅ /api/admin-db | L9 | ADMIN | `execFileSync` + whitelist backup. OK |
| admin-api-keys.js | ✅ /api/admin/api-keys | L11 | ADMIN | global ADMIN. OK |
| notifications.js | ✅ /api/notifications | L8 | ADMIN, RH | fuite `detail: apiErr.message` (Brevo) L53/L75 |
| push.js | ✅ /api/push | L27 | ADMIN, MANAGER | `/vapid-public-key` public **avant** auth (normal). OK |
| newsfeed.js | ✅ /api/news | L34 | ADMIN, RH | POST/PUT/DELETE = ADMIN/RH, GET = authentifié. OK. `CREATE TABLE` IIFE |
| chat.js | ✅ /api/chat | — (inline) | ADMIN, MANAGER | 7 routes toutes en inline `authenticate`. OK |
| webhooks.js | ✅ /api/webhooks | — (secret) | — | Public, `X-Webhook-Secret` timingSafeEqual. Monté 1er (correct). OK |
| public-api.js | ✅ /api/public | — (API-Key) | — | `apiKeyAuth([scopes])` par route. OK |
| health.js | ✅ /api/health | — (public) | — | Public volontaire, pas de leak. OK |
| activity-log.js | ✅ /api/activity-log | L6 | ADMIN | `authorize('ADMIN')` par route. OK |
| state-machines.js | ✅ /api/state-machines | L8 | — | Aucun `authorize` → **tout authentifié** peut lire défs + audit (F12) |
| dashboard.js | ✅ /api/dashboard | L7 | — | Aucun `authorize` → tout authentifié (dont driver). Mineur (F11) |
| candidates/ (index) | ✅ /api/candidates | L61 | ADMIN, RH, MANAGER | Sub-routers montés **après** auth. Chaque route a son `authorize`. OK |
| insertion/ (index) | ✅ /api/insertion | L187 | ADMIN, RH, MANAGER | `authorize` global appliqué à tous les sous-routes. OK |
| tours/ (index) | ✅ /api/tours | L573 | ADMIN, MANAGER | **14 routes `-public` AVANT L573 = non authentifiées** (F2). Sub-routers après = OK |
| vehicles.js | ✅ /api/vehicles | L154 | ADMIN, MANAGER | `GET /available` **avant** auth = fuite PII (F3) |
| pointage.js | ✅ /api/pointage | L172 | ADMIN, RH, MANAGER | `POST /badge` avant auth mais `terminal_key` M2M. OK |
| vak.js | ✅ /api/vak | L153 | ADMIN, MANAGER | `/sumup/webhook` (HMAC) + `/sumup/callback` (state) publics. OK |
| ml.js | ✅ /api/ml | — (inline) | ADMIN, MANAGER | 4 routes inline `authenticate` ; `/train` = ADMIN/MANAGER. OK |
| pcm.js | ✅ /api/pcm | — (inline) | ADMIN, RH, MANAGER | routes inline auth ; `/sessions/:token` public candidat (à confirmer volontaire) |
| employees.js | ✅ /api/employees | L32 | ADMIN, RH, MANAGER, COLLABORATEUR | `authorize` par route. Fuite `err.message` L582/939/963/990 |
| cav.js | ✅ /api/cav | L35 | ADMIN, MANAGER | 30 routes, 17 authorize. OK |
| production.js | ✅ /api/production | L9 | ADMIN, MANAGER | OK |
| tri.js | ✅ /api/tri | L9 | ADMIN, MANAGER | OK |
| stock.js | ✅ /api/stock | L9 | ADMIN, MANAGER | OK |
| stock-original.js | ✅ /api/stock-original | L31 | ADMIN, MANAGER | OK |
| finance.js | ✅ /api/finance | L11 | ADMIN, MANAGER | `router.use(authenticate, authorize(...))` global. Fuite err.message |
| pennylane.js | ✅ /api/pennylane | L316 | ADMIN, MANAGER | `authorize` par route. Fuite err.message (L379…996) |
| billing.js | ✅ /api/billing | L11 | ADMIN, MANAGER | global. OK |
| refashion.js | ✅ /api/refashion | L8 | ADMIN, MANAGER | vues whitelistées. Fuite err.message |
| metropole.js | ✅ /api/metropole | L6 | ADMIN, MANAGER, RH, AUTORITE | `authorize` global L7. Fuite err.message |
| reporting.js | ✅ /api/reporting | L6 | ADMIN, MANAGER, AUTORITE | grouping hardcodé (pas d'injection). OK |
| historique.js | ✅ /api/historique | L6 | ADMIN, MANAGER, AUTORITE | global. OK |
| exports.js | ✅ /api/exports | L8 | ADMIN, MANAGER, RH | OK |
| boutiques.js | ✅ /api/boutiques | L9 | ADMIN, MANAGER | OK |
| boutique-ventes.js | ✅ /api/boutique-ventes | L26 | ADMIN, MANAGER | `csvFilter` upload. OK |
| boutique-commandes.js | ✅ /api/boutique-commandes | L10 | ADMIN, MANAGER, RESP_BTQ | state-machine. Fuite err.message (400) |
| boutique-objectifs.js | ✅ /api/boutique-objectifs | L8 | ADMIN, MANAGER | OK |
| boutique-meteo.js | ✅ /api/boutique-meteo | L7 | ADMIN | OK |
| clients-exutoires.js | ✅ /api/clients-exutoires | L9 | ADMIN, MANAGER | global. OK |
| tarifs-exutoires.js | ✅ /api/tarifs-exutoires | L8 | ADMIN, MANAGER | global. OK |
| commandes-exutoires.js | ✅ /api/commandes-exutoires | L10 | ADMIN, MANAGER | global. OK |
| factures-exutoires.js | ✅ /api/factures-exutoires | L6 | ADMIN, MANAGER | global. OK |
| preparations.js | ✅ /api/preparations | L8 | ADMIN, MANAGER | global. OK |
| controles-pesee.js | ✅ /api/controles-pesee | L25 | ADMIN, MANAGER | global. OK |
| calendrier-logistique.js | ✅ /api/calendrier-logistique | L6 | ADMIN, MANAGER | global. OK |
| planning-hebdo.js | ✅ /api/planning-hebdo | L8 | ADMIN, MANAGER | global. OK |
| partners.js | ✅ /api/partners | L6 | ADMIN, MANAGER | OK |
| prescripteurs.js | ✅ /api/prescripteurs | L6 | ADMIN, RH | OK |
| teams.js | ✅ /api/teams | L9 | ADMIN, MANAGER | OK |
| communes.js | ✅ /api/communes | L6 | ADMIN, MANAGER | OK |
| referentiels.js | ✅ /api/referentiels | L9 | ADMIN | OK |
| etiquettes.js | ✅ /api/etiquettes | L7 | ADMIN, MANAGER, COLLABORATEUR | OK |
| produits-finis.js | ✅ /api/produits-finis | L8 | ADMIN, MANAGER | global. OK |
| expeditions.js | ✅ /api/expeditions | L7 | ADMIN, MANAGER | global. OK |
| association-points.js | ✅ /api/association-points | L10 | ADMIN, MANAGER | OK |
| alert-thresholds.js | ✅ /api/alert-thresholds | L6 | ADMIN, MANAGER | OK |
| performance.js | ✅ /api/performance | L6 | ADMIN, MANAGER | global. OK |
| vehicle-contracts.js | ✅ /api/vehicle-contracts | L38 | ADMIN, MANAGER | OK |

**Sous-routers `tours/`** (montés après `authenticate` L573 dans `tours/index.js`, donc tous authentifiés) : `crud`, `execution` (0 authorize → tout authentifié, volontaire pour le flux driver JWT), `stats`, `events`, `events-auto`, `proposals`, `reoptimize`, `planning`, `dashboard`, `live-summary`, `active-summary`. **Aucun n'est monté avant `authenticate`** → OK. Les fichiers `context.js`, `geo.js`, `planned-passage.js`, `predictions.js`, `reoptimize-service.js`, `smart-tour.js` sont des modules utilitaires (0 route).

**Résultat du sweep de montage** : 63 entrées de routes, **63 montées, 0 orpheline, 0 mount sans fichier**.

---

## Sécurité

### SQL — paramétrage
Sweep complet des template-literals dans les `pool.query()`. **Aucune injection SQL exploitable.** Les seuls `${...}` en position SQL sont :
- `reporting.js:151/160` `grouping` → valeur **hardcodée** (`"TO_CHAR(date,'YYYY-MM')"` / `'date'`), jamais d'input.
- `refashion.js:237` `${view}` → **whitelist** `EXPORT_VIEWS[slug]`, 404 sinon.
- `pennylane.js:233` `${updates.join()}` → noms de colonnes **codés en dur** ; `:303` `ALTER … ${colName} ${colType}` → whitelist + regex `SAFE_IDENT_PL`.
- `insertion/index.js:57/122` `ALTER … ${col} ${type}` → regex `SAFE_IDENT` + `SAFE_TYPE`.
- `vehicle-contracts.js:158`, `refashion.js:198`, `preparations.js:377`, `admin-api-keys.js:79` → `${fields.join()}` avec noms de champs **codés en dur**, valeurs en `$N`.
- `exports.js:248` `= ${parseInt(year)}` → forcé entier.
- `stock-original.js:264/319`, `employees.js:984` → n'ajoutent que des placeholders `$N`.

L'agent IA (`ai-agent/app.py`) utilise SQLAlchemy `text()` + bind params partout ; `_query_cav` construit `{where}` à partir de conditions codées en dur (bind params). Sûr.

### Rate limiting
- Global : 1000 req / 15 min / IP (`index.js:82`).
- `/api/auth` : 30 req / 15 min / IP (`index.js:84`) — **partagé** entre `login`, `driver-start`, `refresh`, etc. Correct mais **pas de verrouillage par compte** après N échecs (F9, mineur).
- **Angle mort** : les endpoints `-public` de tournée et `/vehicles/available` ne sont couverts que par le rate-limit global (1000/15 min) — très permissif pour du tamper.

### JWT / refresh / révocation
- `authenticate` (`middleware/auth.js:14`) vérifie Bearer, gère `TokenExpiredError`. Fail-fast si `JWT_SECRET` manquant en prod (auth.js:5, index.js:272). Bien.
- Refresh : rotation avec suppression de l'ancien token (`auth.js:230`), cookie HttpOnly + Secure + SameSite=Strict. Bien. Pas de détection de réutilisation de refresh token (mineur).
- Révocation logout / reset-password : `DELETE FROM refresh_tokens` (auth.js:276, users.js:116). Bien.

### CORS / Headers
- CORS whitelist explicite + `credentials:true` (index.js:19-24,68). Bien.
- Helmet CSP présent mais `scriptSrc: ['self','unsafe-inline','unsafe-eval']` (index.js:57) — permissif (F13, mineur ; impact limité car l'API sert du JSON, l'app est servie par nginx).
- `/uploads/*` : handler durci (whitelist MIME, `nosniff`, CSP sandbox, anti path-traversal). Excellent (index.js:127-152).

### Uploads
Filtres MIME présents (`upload-filters.js`, `csvFilter`/`imageFilter` appliqués sur vak, boutique-ventes, employees, tours, candidates). Bien.

### Socket.IO
- Handshake authentifié par JWT (index.js:277-289). Bien.
- **Mais `join-tour` / `vak:join` n'autorisent pas** (index.js:298,304) : tout socket authentifié rejoint n'importe quelle salle → réception des positions GPS / ventes live d'autrui (F5).
- **`gps-update` (index.js:321)** insère dans `gps_positions` avec `tourId`/`vehicleId` **fournis par le client, sans vérifier la propriété** ni le type de lat/lng (le garde `latitude==null` est **après** l'INSERT L333). Injection de fausses positions possible (F6).

### RGPD — le module tient-il ses promesses ?
Registre (Art. 30) ✅, Export/accès (Art. 15) ⚠️, Anonymisation (Art. 17) ⚠️, Consentement ✅, Journal d'audit ✅, Purge conservation ⚠️. Les 3 ⚠️ viennent tous du **même bug `pcm_profiles`** (F1) sur les parcours *candidat*. Les parcours *employé* fonctionnent.

### Secrets
Aucun secret en dur trouvé (remédiations Tier 0 en place). `ai-agent` fail-fast (`_require_secret`). Fallback `JWT_SECRET='change-this-in-production'` présent (auth.js:4) mais **neutralisé par un exit(1) en prod** (auth.js:5, index.js:272). OK.

---

## Anomalies

### F1 — BLOQUANT — RGPD : table `pcm_profiles` inexistante casse l'anonymisation candidat
`routes/rgpd.js:72,127,271` interrogent/suppriment `pcm_profiles`. Cette table **n'est créée nulle part** (init-db crée `pcm_sessions`, `pcm_answers`, `pcm_reports` — init-db.js:148-172 ; seule `rgpd.js` mentionne `pcm_profiles`).
**Preuve / impact** :
- `POST /api/rgpd/anonymize/candidate/:id` → `DELETE FROM pcm_profiles` (L127) lève `42P01` **dans la transaction** → `ROLLBACK` (L161) → **aucune donnée anonymisée**, réponse 500. Le droit à l'effacement échoue silencieusement : les données personnelles du candidat **restent en base** alors que l'UI signale une erreur générique.
- `GET /api/rgpd/export/candidate/:id` (L72) → 500. Droit d'accès Art. 15 cassé pour les candidats.
- `POST /api/rgpd/purge-expired` (L271) → 500 dès le 1er candidat. Purge légale des candidats > 24 mois non fonctionnelle.
**Correctif** : remplacer les 3 références par les vraies tables PCM liées au candidat (`DELETE FROM pcm_sessions WHERE candidate_id=$1`, idem `pcm_reports`/`pcm_answers` via jointure), ou a minima les envelopper d'un `try/catch` tolérant `42P01`. Vérifier au passage le lien `candidate_id` dans le schéma PCM.

### F2 — BLOQUANT — 14 endpoints de tournée non authentifiés (écriture incluse)
`routes/tours/index.js:50-570` : toutes les routes `*-public` sont déclarées **avant** `router.use(authenticate)` (L573) → **aucune auth**. Elles prennent un `:id` entier séquentiel (énumérable). Le mobile les utilise activement (`mobile/src/services/sync.js:117,134,217,266`, `Checklist.jsx`, `TourMap.jsx`, `ReturnCentre.jsx`, `TourSummary.jsx`) **alors qu'il détient déjà un JWT driver** (`AuthContext.jsx:40`).
**Preuve / impact** : un tiers non authentifié peut, pour n'importe quel `tourId` :
- Lire les détails d'une tournée (`GET /:id/public`, `/summary-public`) → adresses CAV, GPS, poids.
- **Muter des données de production** : `PUT /:id/start-public`, `PUT /:id/status-public` (terminer une tournée), `PUT /:id/cav/:cavId/collect-public`, `POST /:id/weigh-public` (faux poids), `POST /:id/incident-public` (faux incidents + **push aux managers**, index tours L306), déclencher des ré-optimisations.
**Correctif** : exiger le JWT driver (déjà émis par `driver-start`) sur ces routes et faire porter au mobile l'`Authorization: Bearer`. À défaut immédiat : signer chaque tournée d'un token opaque (comme `vehicles.qr_token`) et le vérifier, plutôt qu'un `:id` énumérable. Réduire l'exposition via un scoping `tour ↔ véhicule` du JWT.

### F3 — MAJEUR — `GET /api/vehicles/available` public : fuite de PII chauffeurs
`routes/vehicles.js:133` déclaré **avant** `router.use(authenticate)` (L154). Renvoie `registration`, `name`, `status`, **`driver_name` (prénom + nom de l'employé)**, `tour_id`, `tour_status` — sans auth.
**Preuve / impact** : énumération publique du parc + **noms des chauffeurs** (donnée personnelle, RGPD) et état opérationnel. Contredit le durcissement « 1 URL = 1 véhicule » de la v2.0.1 (qui visait justement à supprimer l'énumération de véhicules de l'ancienne `Login.jsx`). Le front web n'utilise pas cette route (`grep` = 0).
**Correctif** : déplacer la route **après** `router.use(authenticate)` + `authorize('ADMIN','MANAGER')`, ou la supprimer si le mobile ne l'utilise plus (le flux actuel passe par `driver-start`).

### F4 — MAJEUR — 90 handlers renvoient `err.message` brut au client
Sweep : **90 occurrences** de `res.status(...).json({ error: err.message })` / `detail: *.message` (ex. `employees.js:582,939,963,990`, `pennylane.js:379,667,839,948,996`, `metropole.js:329,355,389`, `refashion.js:125…`, `notifications.js:53,75`, `boutique-commandes.js:328…`).
**Preuve / impact** : le gestionnaire global `error-handler.js:44` masque bien les messages en prod, **mais ces handlers court-circuitent ce filet** en renvoyant directement le message d'erreur PostgreSQL (noms de colonnes/contraintes, structure SQL) → aide à la cartographie du schéma pour un attaquant, et messages incompréhensibles pour des utilisateurs à faible littératie numérique.
**Correctif** : renvoyer un message générique + `requestId` (déjà propagé par `request-logger`), logger le détail côté serveur. Idéalement, supprimer les try/catch locaux au profit d'un `asyncHandler` qui délègue à `error-handler.js`.

### F5 — MAJEUR — Salles Socket.IO sans autorisation
`index.js:298` (`join-tour`) et `:304` (`vak:join`) : aucun contrôle que `socket.user` a le droit de rejoindre ce `tourId`/`vakId`.
**Impact** : tout utilisateur authentifié (dont un JWT driver COLLABORATEUR) peut s'abonner à `tour-<id>` et recevoir en direct les positions GPS de n'importe quel véhicule, ou à `vak:live:<id>` pour les ventes live.
**Correctif** : à la réception de `join-tour`, vérifier que l'utilisateur est ADMIN/MANAGER ou le chauffeur assigné à la tournée avant `socket.join`.

### F6 — MAJEUR — `gps-update` : injection de positions sans contrôle de propriété ni de type
`index.js:321-327` : INSERT dans `gps_positions` avec `tourId`/`vehicleId`/`latitude`/`longitude` **issus du payload client**, sans vérifier que le socket possède ce véhicule/tournée. Le garde `if (!tourId || latitude == null …)` est **après** l'INSERT (L333) → des valeurs nulles/aberrantes peuvent être insérées, puis diffusées à la salle.
**Impact** : falsification de l'historique GPS, pollution des données de proximité CAV, diffusion de fausses positions.
**Correctif** : valider `tourId`/`vehicleId` appartiennent à l'utilisateur (jointure `tours.driver_employee_id` / assignation véhicule) et que lat/lng sont des nombres finis **avant** l'INSERT.

### F7 — MINEUR — Deux handlers `disconnect` enregistrés sur le même socket
`index.js:374` et `:406` déclarent chacun `socket.on('disconnect', …)`. Les deux s'exécutent (le 1er nettoie les Map, le 2nd log). Pas de bug fonctionnel mais code trompeur.
**Correctif** : fusionner en un seul handler.

### F8 — MINEUR — `notifications.js` fuit les erreurs Brevo au client
`routes/notifications.js:53,75` : `detail: apiErr.message`. Peut exposer des détails d'API tierce.
**Correctif** : logger, renvoyer un message générique.

### F9 — MINEUR — Pas de verrouillage de compte après échecs de login
`/api/auth` limité à 30/15 min/IP mais **par IP**, sans compteur par `username`. Un botnet distribué contourne. `bcrypt.compare` correct par ailleurs.
**Correctif** : compteur d'échecs par compte + backoff, ou captcha après N échecs.

### F10 — MINEUR — `refresh` : collision de `token_hash` sur sessions multiples
`auth.js:251-255` met à jour `user_sessions … WHERE user_id=$2 AND is_active=true` sans cibler la session courante → si l'utilisateur a plusieurs sessions actives, toutes reçoivent le même `token_hash`. Suivi de session imprécis.
**Correctif** : cibler la session par un identifiant de session dédié.

### F11 — MINEUR — `dashboard.js` sans `authorize`
`routes/dashboard.js:7` : `router.use(authenticate)` seul → tout authentifié (y compris JWT driver) lit les KPIs consolidés. Acceptable mais à confirmer volontaire.

### F12 — MINEUR — `state-machines.js` sans `authorize`
`routes/state-machines.js:8` : lecture des définitions et de l'audit des transitions ouverte à tout authentifié.

### F13 — MINEUR — CSP Helmet permissive (`unsafe-inline`/`unsafe-eval`)
`index.js:57`. Impact faible (API JSON, app servie par nginx qui a sa propre CSP durcie en T1.2) mais à resserrer si l'API venait à servir du HTML.

### F14 — MINEUR — `ai-agent` : debug Flask activé par défaut si lancé en direct
`ai-agent/app.py:715` : `debug = FLASK_ENV != 'production'`. Si le conteneur était lancé via `python app.py` sans `FLASK_ENV=production`, le débogueur Werkzeug (RCE) serait actif. En prod le lancement passe normalement par un WSGI (bloc `__main__` non exécuté), mais dépendance fragile.
**Correctif** : forcer `debug=False` sauf opt-in explicite `ENABLE_FLASK_DEBUG`.

### F15 — MINEUR — `pcm.js` : `/sessions/:token` accessible sans `authenticate`
`routes/pcm.js:800` : route sans `authenticate` inline (contrairement aux autres routes du fichier). Probablement volontaire (passation du test par un candidat via lien/token), mais à confirmer que le `:token` est bien un secret non énumérable et que la portée est limitée.

### F16 — MINEUR — Migrations/`CREATE TABLE` dispersées dans les routes (IIFE au require)
`settings.js:186,268`, `newsfeed.js:12`, `insertion/index.js`, `pennylane.js`, `activity-logger.js:4` exécutent du DDL au chargement du module. Idempotent mais rend le schéma difficile à auditer et multiplie les requêtes au démarrage.

### F17 — MINEUR — `driver-start` : attribution d'activité floue via compte générique
`auth.js:86-97` : plusieurs chauffeurs sans compte partagent le même `users.username='chauffeur'` → JWT avec le même `id`. Les logs d'activité et attributions deviennent ambigus.

---

## Optimisations

1. **`asyncHandler` transverse** — introduire un wrapper `(fn) => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next)` et déléguer au `error-handler.js` global. Élimine ~90 blocs try/catch répétitifs **et** corrige F4/F8 d'un coup (la redaction prod devient effective partout). ROI élevé, risque faible (migration progressive route par route).
2. **Consolider le DDL** — déplacer les `CREATE TABLE`/`ALTER` des IIFE de routes (F16) vers `init-db.js` (déjà idempotent). Démarrage plus rapide, schéma auditable en un seul endroit.
3. **Étendre `cacheMiddleware`** — le middleware Redis (`middleware/cache.js`, `X-Cache: HIT/MISS`) n'est câblé que sur `/dashboard`. L'appliquer aux GET coûteux read-mostly (`/reporting/*`, `/metropole/*`, `/public/*`, `/refashion/exports/*`) réduirait la charge DB.
4. **Factoriser le pattern « update dynamique »** — `admin-api-keys.js`, `vehicle-contracts.js`, `refashion.js`, `preparations.js` réimplémentent le même builder `fields→$N`. Un helper `buildUpdate(table, allowedFields, body)` mutualiserait et garantirait la whitelist.
5. **Un seul handler `disconnect`** (F7) et validation centralisée des payloads Socket.IO.

---

## Évolutions

1. **API partenaires (`public-api.js`) — la base est réelle et fonctionnelle.** `apiKeyAuth` avec scopes (`cav:read`, `stats:read`, `refashion:read`), hash SHA-256, `last_used_at`, expiration, gestion admin des clés (`admin-api-keys.js`). Manque pour l'ouvrir vraiment : pagination sur `/public/cav`, rate-limit **par clé** (aujourd'hui seul le global s'applique), documentation OpenAPI/Swagger, et un scope `write` si un jour des partenaires poussent des données. C'est le meilleur candidat « quick évolution » : socle déjà propre.
2. **State machines centralisées** — `services/state-machine` + `routes/state-machines.js` exposent déjà définitions/transitions/audit. Généraliser à toutes les routes statutaires (commandes-exutoires est fait ; preparations, controles-pesee, factures-exutoires restent à migrer) donnerait un workflow homogène et auditable.
3. **RGPD self-service & purge automatisée** — une fois F1 corrigé, brancher `purge-expired` sur le `scheduler` (aujourd'hui déclenché manuellement par `POST`) pour une conformité « conservation limitée » réellement automatique, et exposer un export CSV/JSON standardisé pour les demandes d'accès.

---

## Quick wins sûrs (à appliquer immédiatement, sans risque de régression)

Ces correctifs sont petits, localisés et sans effet de bord fonctionnel :

- **QW1 (corrige F3)** — Déplacer `GET /api/vehicles/available` (vehicles.js:133) **après** `router.use(authenticate)` (L154) et ajouter `authorize('ADMIN','MANAGER')`. Le front web ne l'utilise pas ; vérifier juste que le mobile ne l'appelle plus (il passe par `driver-start`). Supprime une fuite de PII.
- **QW2 (corrige F1, partiel mais sûr)** — Envelopper les 3 requêtes `pcm_profiles` de `rgpd.js` (L72, L127, L271) dans un `try/catch` tolérant `42P01`, pour que l'anonymisation/purge candidat **cesse d'échouer par ROLLBACK**. (Le correctif complet = pointer vers `pcm_sessions/pcm_reports`, à faire dans la foulée.)
- **QW3 (corrige F8)** — Retirer `detail: apiErr.message` de `notifications.js:53,75` → message générique. 2 lignes.
- **QW4 (corrige F6, volet validation)** — Dans `gps-update` (index.js:321), déplacer le garde `if (!tourId || latitude==null || longitude==null || !Number.isFinite(latitude) …) return;` **avant** l'INSERT. Empêche l'insertion de lignes GPS aberrantes. Aucune régression (le mobile envoie toujours des valeurs valides).
- **QW5 (corrige F7)** — Fusionner les deux `socket.on('disconnect')` (index.js:374 & 406) en un seul. Nettoyage pur.
- **QW6 (durcit F5, faible risque)** — Ajouter au handler `join-tour` un contrôle `if (!['ADMIN','MANAGER'].includes(socket.user.role) && !estChauffeurDeLaTournee) return;`. À tester avec le mobile, mais borne l'écoute GPS.

Les correctifs de fond (F2 authentifier les routes `-public` ; F4 wrapper `asyncHandler` ; F1 complet) nécessitent une coordination front/mobile et méritent un mini-sprint dédié plutôt qu'un patch à chaud.

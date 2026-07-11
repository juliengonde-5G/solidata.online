# Audit technique — Socle transverse (dashboards, notifications, chatbot, référentiels)

**Date** : 2026-07-11
**Périmètre** : `backend/src/index.js`, routes `dashboard.js`, `health.js`, `performance.js`, `newsfeed.js`, `notifications.js`, `chat.js`, `referentiels.js`, `alert-thresholds.js` ; services `scheduler.js`, `job-queue.js`, `notification.js`, `push-notifications.js` ; `ai-agent/app.py` ; front `App.jsx`, `Layout.jsx`, `AuthContext.jsx`, `services/api.js` + pages associées.
**Note globale** : 6,5/10 — socle solide et bien sécurisé sur l'infrastructure, mais plusieurs divergences schéma↔code et un doublon d'implémentation du chatbot pénalisent la fiabilité fonctionnelle.

---

## 1. Points forts

- **Bootstrap sécurisé (`index.js`)** : Helmet + CSP, rate-limiting global (1000/15 min) et strict sur `/api/auth` (30/15 min), CORS sur allowlist, `trust proxy`, fail-fast si `JWT_SECRET` par défaut en production (l.273). Le handler `/uploads/*` (l.127-152) est exemplaire : garde anti path-traversal, MIME forcé par whitelist d'extension, `nosniff` + CSP `sandbox`. Socket.IO est authentifié par JWT (l.278-290) et dispose d'un adaptateur Redis pour le multi-instance.
- **Health checks (`health.js`)** : séparation propre `/` (complet, 200/503), `/live`, `/ready`, avec `withTimeout` sur DB (5 s) et Redis (1,5 s) — adapté à l'orchestration.
- **`dashboard.js /kpis`** : ~20 requêtes parallélisées (`Promise.all`), cache 120 s par tranche de minute, bornage du taux de valorisation à 100 %, commentaires documentant les colonnes réelles.
- **`scheduler.js`** : verrou applicatif distribué (`pg_try_advisory_lock`), purges RGPD (candidats 24 mois, GPS 90 j) avec journalisation `rgpd_audit_log`, mode DRY-RUN si `BREVO_API_KEY` absente, correctif de la fenêtre de dédup 21 j de `autoFeedNews`.
- **`push-notifications.js`** : désactivation silencieuse si VAPID absent, purge auto des abonnements sur 404/410 — code robuste et concis.
- **Front** : lazy-loading de toutes les pages (code splitting), `ProtectedRoute`/`Layout` filtrent sur `base_role` + habilitations module (overlay DENY), `AuthContext` en fail-open. `DashboardExecutif.jsx` soigne l'accessibilité (aria-label, sr-only) et gère `ErrorState`/retry.
- **SQL paramétré partout** dans le périmètre, y compris les `WHERE` dynamiques (`chat.js queryCav`, `newsfeed.js`) qui construisent proprement la liste de paramètres.

---

## 2. Qualité & cohérence

**Doublon d'implémentation du SolidataBot.** Il existe deux chatbots : `backend/src/routes/chat.js` (Node, monté sur `/api/chat`, widget web) et `ai-agent/app.py` (Flask, conteneur séparé). Les deux dupliquent le `SYSTEM_PROMPT`, les 5 définitions d'outils, la logique d'exécution des tools, la gestion de session et le rate-limiting. Ils ont **divergé** : `chat.js queryStock` interroge `categories_sortantes` (colonnes `nom`/`famille`) tandis que `app.py _query_stock` interroge `matieres` (colonnes `categorie`/`sous_categorie`). Deux surfaces à maintenir, réponses potentiellement incohérentes.

**Triplement de `sendNotification`.** La logique d'envoi Brevo (email/SMS) est copiée à l'identique dans `services/notification.js` (l.6-44), inline dans `scheduler.js` (l.17-55), et re-réimplémentée dans `routes/notifications.js` (l.33-77). Toute évolution (ex. gestion d'erreur Brevo) doit être répliquée 3 fois.

**Divergence de convention `req.user`.** Le payload JWT (`auth.js` l.151-157) contient `id` (pas `userId`). `chat.js` est le **seul** fichier de `routes/` à lire `req.user.userId` (l.410) — un grep confirme l'unicité. Conséquence : voir §5.

**Incohérences mineures** : défaut `CLAUDE_MODEL = 'claude-sonnet-4-20250514'` (déprécié) dans `chat.js` l.16 et `app.py` l.62, alors que le reste du code est passé à `claude-sonnet-5` (cf. changelog). Double validation dans `newsfeed.js` POST (express-validator l.66-67 **puis** contrôle manuel l.71-73). `Layout.jsx` (l.334-337) alimente les compteurs sidebar depuis des clés plates (`k.candidates_actifs`, `k.tours_today`) absentes de la réponse imbriquée de `/kpis` → compteurs toujours nuls (code mort).

---

## 3. Dette technique & divergences schéma↔code

**[P1] `dashboard.js /objectifs` — colonne inexistante `kg_entree`.** La requête `productionRows` (l.406-415) fait `COALESCE(SUM(kg_entree), 0)` sur `production_daily`, or cette colonne n'existe pas : le schéma réel (`init-db.js` l.680) est `entree_ligne_kg` / `total_jour_t` — le même fichier le documente explicitement en commentaire pour `/kpis` (l.69-73) mais réintroduit l'erreur dans `/objectifs`. Cette requête, contrairement à `postesRows` (l.427), **n'a pas de `.catch`** : le `Promise.all` rejette et l'endpoint renvoie 500 dès qu'un objectif existe pour la période courante. Les jauges objectifs vs réalisé sont donc cassées en présence de données.

**[P1] Outil `query_planning` cassé (les deux bots).** `chat.js` (l.226) et `app.py` (l.324) sélectionnent `p.name AS poste_name` en joignant `positions p`, mais la table `positions` a une colonne `title`, pas `name` (`init-db.js` l.270 ; `referentiels.js` l.90 le documente déjà). La requête lève une erreur, capturée en message générique « Erreur lors de la requête en base de données » : l'affichage du planning par le chatbot est non fonctionnel.

**[P2] Jointure stock douteuse dans `chat.js queryStock`.** `LEFT JOIN stock_movements sm ON sm.matiere_id = m.id` avec `m = categories_sortantes`, alors que `sm.matiere_id` référence a priori `matieres` (espace d'ID distinct — c'est ce que suppose `app.py`). À vérifier : la version Node peut agréger des poids sur de mauvais rapprochements d'ID.

**[P2] Sessions/rate-limit chatbot en mémoire (Node).** `chat.js` conserve sessions et compteurs de rate-limit dans des `Map` in-process (l.22, l.45) : non partagés en multi-instance (que l'app supporte via l'adaptateur Redis Socket.IO). `app.py` utilise correctement Redis — asymétrie supplémentaire entre les deux bots.

**[P2] Pages orphelines.** `DashboardExecutif` (`/dashboard-executif`) et `AdminAlertThresholds` (`/admin-alert-thresholds`) sont routées (`App.jsx` l.191, l.220) mais absentes du `NAV_TREE` de `Layout.jsx` : fonctionnalités livrées (dashboard direction, configuration des seuils) non atteignables depuis le menu (seul un lien enfoui dans le pied de page exécutif y mène).

**Migrations fragiles / patterns.** `newsfeed.js` crée sa table via une IIFE au chargement du module (l.10-32) plutôt que dans `init-db.js` — pattern d'auto-migration dispersé. Le commentaire `/ Schedule…` (`init-db.js` l.2349) utilise un `/` isolé mais est bien situé hors chaîne (non bloquant, à corriger par hygiène).

---

## 4. Sécurité

Globalement bon niveau (authorize systématique sur les mutations, référentiels en lecture pour tout authentifié — acceptable). Points à traiter :

- **[P1] Rate-limiting chatbot inopérant + self-service RGPD.** `checkRateLimit(userId)` avec `userId = req.user.userId` (undefined pour tout compte web) → tous les utilisateurs web partagent le bucket `undefined` : le quota de 20 msg/min est global, pas par utilisateur (potentiel déni de service croisé et coût LLM non maîtrisé). Les outils `query_planning`/`query_heures` ne peuvent plus résoudre l'employé connecté (le garde `if (!empId && userCtx.userId)` échoue), et la vérification RGPD COLLABORATEUR compare à `undefined`. Le même risque latent existe dans `app.py` (l.505 lit `userId`/`user_id`, jamais `id`).
- **[P2] Fuite d'information sur endpoints publics.** `/api/health` n'est pas authentifié (`index.js` l.262) et renvoie `err.message` (`health.js` l.42, l.87) plus la version complète PostgreSQL/PostGIS — l'équivalent avait été corrigé côté `ai-agent` (T1.7). `notifications.js` renvoie `apiErr.message` de Brevo dans la réponse (l.53, l.75) — périmètre ADMIN/RH, risque faible.
- **[P2] Jobs scheduler hors verrou.** Les jobs inline (Pennylane 2h, dispatch 18h, scan CSV 20h, VAK 3h, mensuel/annuel) s'exécutent **hors** de l'`advisory lock` de `runAllJobs` : en multi-instance ils tourneraient en parallèle sur chaque nœud (double envoi/double import). Non actif en mono-instance mais incohérent avec la protection de `runAllJobs`.

---

## 5. Robustesse

- **[P2] Ordonnancement fragile (`scheduler.js`).** `setInterval` horaire (l.610) avec gardes `now.getHours() === X` et `now.getMinutes() < 30`. Le tick tombe à la minute de démarrage du process : si l'API démarre à HH:45, `minutes < 30` n'est jamais vrai → les jobs 18h (dispatch), 20h (CSV), 3h (VAK), 1er du mois 4h et 1er janvier 2h **ne s'exécutent jamais**. Un vrai cron (node-cron) ou une comparaison « dernière exécution » supprimerait cette dépendance à l'instant de boot et rattraperait les fenêtres manquées après redémarrage.
- **Catchs muets / erreurs non remontées** : `referentiels.js` renvoie `500 { error: 'Erreur serveur' }` sans `console.error` sur la plupart des routes (l.24, 37, 52, 61, 74, 83) → diagnostic difficile. `NewsFeed.jsx` avale les erreurs (`catch { console.error }` l.57) sans `ErrorState`, et utilise `alert()` à la création (l.68) — incohérent avec `DashboardExecutif.jsx` qui gère proprement `ErrorState`/retry.
- **Bonnes pratiques présentes** : `job-queue.js` dégrade sans Redis, `performance.js`/`chat.js insights` protègent les requêtes optionnelles par `.catch(() => ({ rows: [] }))`, l'insert `chatbot_history` est non bloquant (`.catch`).

---

## 6. Testabilité

Couverture quasi nulle sur ce périmètre. Il existe `tests/unit/services/scheduler.test.js` (2 cas : uniquement le verrou) et `notification.test.js`, mais **aucun test** pour `dashboard.js`, `performance.js`, `chat.js`, `newsfeed.js`, `referentiels.js`, `health.js`. Or ce sont précisément les endpoints où se logent les divergences schéma↔code (les bugs `kg_entree` et `positions.name` auraient été captés par un test d'intégration sur base réelle). Le smoke test `api-smoke.js` (hooké au déploiement) considère 401/403 comme OK ; il faudrait qu'il exerce `/dashboard/objectifs` **avec** un objectif seedé et vérifie un 200.

**Priorités de test** : (1) `dashboard.js /objectifs` et `/executive` sur schéma réel ; (2) outils SolidataBot (`query_planning`, `query_stock`) sur base seedée ; (3) résolution `req.user.id` dans `chat.js`.

---

## 7. Recommandations priorisées

| # | Priorité | Effort | Action |
|---|----------|--------|--------|
| 1 | **P1** | S | `dashboard.js /objectifs` : remplacer `SUM(kg_entree)` par `SUM(entree_ligne_kg)` (ou `total_jour_t`) et ajouter un `.catch` de repli comme sur `postesRows`. |
| 2 | **P1** | S | `chat.js` : remplacer `req.user.userId` par `req.user.id` (l.410) — restaure rate-limit par utilisateur et outils self-service. Aligner `app.py` (accepter aussi `id`). |
| 3 | **P1** | S | Corriger `p.name` → `p.title` dans `query_planning` (`chat.js` l.226 et `app.py` l.324). |
| 4 | **P1** | M | Ajouter des tests d'intégration sur `/dashboard/objectifs`, `/dashboard/executive` et les outils du chatbot (base seedée), et durcir `api-smoke.js`. |
| 5 | **P2** | M | Factoriser l'envoi Brevo dans le seul `services/notification.js` et le consommer depuis `scheduler.js` et `routes/notifications.js`. |
| 6 | **P2** | L | Unifier les deux SolidataBot : prompt/outils/exécution partagés, décider d'une seule implémentation servie au widget ; sinon documenter clairement le rôle de `ai-agent`. |
| 7 | **P2** | M | Remplacer le `setInterval` + gardes horaires par `node-cron` (ou un suivi « dernière exécution » persisté) et placer tous les jobs sous l'advisory lock. |
| 8 | **P2** | S | Ajouter au `NAV_TREE` les entrées `DashboardExecutif` et `AdminAlertThresholds` (ou les retirer si obsolètes). |
| 9 | **P2** | S | `health.js` : ne plus exposer `err.message`/version en public. Ajouter `console.error` aux catchs de `referentiels.js`. Migrer `NewsFeed.jsx` vers `ErrorState`. |
| 10 | **P2** | S | Aligner le défaut `CLAUDE_MODEL` sur `claude-sonnet-5` (`chat.js`, `app.py`) et vérifier la jointure stock de `chat.js queryStock`. |

---

*Constat d'ensemble : l'infrastructure transverse (sécurité, health, cache, code splitting, RGPD) est de bonne facture ; la dette se concentre sur quelques divergences schéma↔code non testées et un doublon d'implémentation du chatbot. Les correctifs P1 sont tous de faible effort et à fort impact fiabilité.*

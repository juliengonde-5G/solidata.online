# Variables de l'application — SOLIDATA

> Ce document recense toutes les variables d'environnement et de configuration de SOLIDATA.
> Dernière mise à jour : 11 avril 2026

---

## 1. Fichier de configuration

Copier `.env.example` en `.env` à la racine de `backend/` :
```bash
cp backend/.env.example backend/.env
```

En production Docker, les variables sont injectées dans le conteneur `solidata-api` via `docker-compose.prod.yml`.

---

## 2. Variables d'environnement

### 2.1 Base de données PostgreSQL

| Variable | Valeur dev par défaut | Obligatoire | Description |
|----------|-----------------------|-------------|-------------|
| `DB_HOST` | `localhost` | Oui | Hôte PostgreSQL. En Docker : nom du service (`solidata-db`) |
| `DB_PORT` | `5432` | Oui | Port PostgreSQL |
| `DB_NAME` | `solidata` | Oui | Nom de la base de données |
| `DB_USER` | `solidata_user` | Oui | Utilisateur PostgreSQL |
| `DB_PASSWORD` | `solidata_secure_password_2026` | Oui | **Changer en production** |

Utilisées dans : `backend/src/config/database.js` (pool `pg`)

---

### 2.2 Authentification JWT

| Variable | Valeur dev par défaut | Obligatoire | Description |
|----------|-----------------------|-------------|-------------|
| `JWT_SECRET` | `solidata-jwt-secret-change-in-production` | Oui | Clé secrète signature JWT. **Changer impérativement en production** |
| `JWT_EXPIRES_IN` | `8h` | Non | Durée de validité du token d'accès |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Non | Durée de validité du refresh token |

Utilisées dans : `backend/src/middleware/auth.js`, `backend/src/routes/auth.js`

> **Sécurité** : le `JWT_SECRET` doit être une chaîne aléatoire de 64+ caractères en production (`openssl rand -hex 32`).

---

### 2.3 Serveur Node.js

| Variable | Valeur dev par défaut | Obligatoire | Description |
|----------|-----------------------|-------------|-------------|
| `PORT` | `3001` | Non | Port d'écoute du serveur Express |
| `NODE_ENV` | `development` | Non | Environnement : `development` ou `production` |
| `CORS_ORIGINS` | *(non défini)* | Non | Origines CORS autorisées, séparées par des virgules. Si absent, défaut = `['http://localhost:5173', 'http://localhost:3000']` |

Utilisées dans : `backend/src/index.js`

---

### 2.4 Redis

| Variable | Valeur dev par défaut | Obligatoire | Description |
|----------|-----------------------|-------------|-------------|
| `REDIS_HOST` | `localhost` | Non | Hôte Redis. En Docker : `solidata-redis` |
| `REDIS_PORT` | `6379` | Non | Port Redis |
| `REDIS_URL` | *(non défini)* | Non | URL complète Redis (prioritaire sur HOST/PORT). Format : `redis://host:port` |

Utilisées dans : `backend/src/config/redis.js`

> La politique `maxmemory-policy` Redis doit être `noeviction` pour BullMQ (voir `docker-compose.yml`).

---

### 2.5 Intelligence artificielle (Claude API)

| Variable | Valeur dev par défaut | Obligatoire | Description |
|----------|-----------------------|-------------|-------------|
| `ANTHROPIC_API_KEY` | *(vide)* | Non* | Clé API Anthropic pour les fonctionnalités IA |
| `CLAUDE_MODEL` | `claude-sonnet-4-20250514` | Non | Modèle Claude à utiliser |

*Sans clé, les fonctionnalités IA sont désactivées silencieusement (pas d'erreur fatale).

**Fonctionnalités impactées :**
- SolidataBot (chat IA) → `backend/src/routes/chat.js`
- Plan d'entretien véhicules IA → `backend/src/routes/vehicles.js`
- Synthèse hebdomadaire prédictive → `backend/src/routes/tours/stats.js`
- Recommandations ajustement facteurs → `backend/src/routes/tours/stats.js`
- Prédiction enrichie par CAV → `backend/src/routes/tours/stats.js`
- Moteur insertion IA (parcours) → `backend/src/services/insertion-ai.js`
- Analyse prédictive collecte → `backend/src/services/predictive-ai.js`

---

### 2.6 Notifications (Brevo / ex-Sendinblue)

| Variable | Valeur dev par défaut | Obligatoire | Description |
|----------|-----------------------|-------------|-------------|
| `BREVO_API_KEY` | *(vide)* | Non | Clé API Brevo pour envoi SMS et email |

Sans clé, les notifications SMS/email sont désactivées silencieusement.

Utilisée dans : `backend/src/routes/notifications.js`

---

### 2.7 Géolocalisation et routage

| Variable | Valeur dev par défaut | Obligatoire | Description |
|----------|-----------------------|-------------|-------------|
| `CENTRE_TRI_LAT` | `49.4231` | Non | Latitude du centre de tri (Rouen) |
| `CENTRE_TRI_LNG` | `1.0993` | Non | Longitude du centre de tri (Rouen) |
| `OSRM_BASE_URL` | `https://router.project-osrm.org` | Non | URL de l'instance OSRM pour le routage |

Utilisées dans : `backend/src/routes/tours/geo.js`, `backend/src/routes/tours/context.js`

> En production, il est recommandé d'héberger sa propre instance OSRM pour des raisons de performance et de fiabilité (l'instance démo est publique et non garantie).

---

### 2.8 Événements locaux (optionnel)

| Variable | Valeur dev par défaut | Obligatoire | Description |
|----------|-----------------------|-------------|-------------|
| `OPENAGENDA_API_KEY` | *(vide)* | Non | Clé API OpenAgenda pour la découverte auto d'événements |

Sans clé, seules les sources gratuites (OpenDataSoft, Métropole Rouen, Seine-Maritime) sont utilisées pour la découverte automatique d'événements.

Utilisée dans : `backend/src/routes/tours/events-auto.js`

---

### 2.9 Double authentification (MFA) & smoke test

| Variable | Valeur dev par défaut | Obligatoire | Description |
|----------|-----------------------|-------------|-------------|
| `MFA_ENCRYPTION_KEY` | *(vide)* | Non | Clé DÉDIÉE de chiffrement du secret TOTP (`users.mfa_secret`, AES-256-GCM). **Recommandée en production** : sans elle, la cascade retombe sur `PCM_ENCRYPTION_KEY` puis `JWT_SECRET` — ça fonctionne, mais mélange deux registres de compromission. |
| `SMOKE_API_KEY` | *(vide)* | Non* | **Clé d'API de SERVICE, en lecture seule**, présentée par le smoke test post-déploiement (`scripts/tests/api-smoke.js`) dans l'en-tête `X-API-Key`. Format `sol_<prefix>_<secret>`. |

*Sans `SMOKE_API_KEY`, le smoke test ne couvre que les endpoints publics : il l'annonce explicitement en sortie et **le déploiement se poursuit** — une couverture réduite n'est pas une régression applicative.

> **2.45.0 — fin du compte ADMIN de service.** `API_USER`, `API_PASSWORD` et `API_TOTP_SECRET` **ne sont plus lus**. Le smoke test ne se connecte plus : il rangeait dans le même `.env` le mot de passe **et** le secret TOTP d'un compte ADMIN réel, c'est-à-dire les deux facteurs au même endroit — ce qui annulait le bénéfice de la double authentification. Une clé d'API est un secret unique, à portée limitée, révocable et expirable, qui n'ouvre aucune session humaine.
>
> **Ce qu'une clé de service peut / ne peut pas** : elle lit ce que lit le rôle qu'elle porte (`api_keys.service_role`) ; elle ne peut **rien écrire** — la garde de lecture seule est posée dans `authenticate` (`backend/src/middleware/auth.js`), donc sur toute route de l'application, y compris celles écrites demain. Elle n'a pas non plus accès au trousseau de clés (`/api/admin/api-keys`).
>
> **Création (dans le conteneur backend)** :
> ```bash
> docker compose -f docker-compose.prod.yml exec backend node src/scripts/creer-cle-api.js --apply
> ```
> La clé n'est affichée **qu'une seule fois** (la base n'en garde que le hash SHA-256) — la reporter dans `SMOKE_API_KEY` du `.env` serveur. Le script est **idempotent** : relancé, il refuse de semer une seconde clé du même nom et dit quoi faire. Options : `--nom=`, `--role=` (défaut ADMIN), `--expire=AAAA-MM-JJ`, `--revoquer=<préfixe>` (effet immédiat), `--force`.
>
> **Migration d'un serveur existant** : créer la clé, poser `SMOKE_API_KEY`, puis **retirer `API_USER` / `API_PASSWORD` / `API_TOTP_SECRET` du `.env` et désactiver le compte ADMIN de service** (un secret devenu inutile reste un secret exposé). `deploy.sh` avertit tant qu'ils traînent.

Utilisées dans : `backend/src/utils/mfa-crypto.js` (cascade de clé), `backend/src/middleware/api-key.js` + `backend/src/middleware/auth.js` (identité de service), `scripts/tests/api-smoke.js`.

---

## 3. Résumé `.env.example`

```dotenv
# ─────────────────────────────────────────────
# BASE DE DONNÉES
# ─────────────────────────────────────────────
DB_HOST=localhost
DB_PORT=5432
DB_NAME=solidata
DB_USER=solidata_user
DB_PASSWORD=solidata_secure_password_2026   # CHANGER EN PRODUCTION

# ─────────────────────────────────────────────
# AUTHENTIFICATION JWT
# ─────────────────────────────────────────────
JWT_SECRET=solidata-jwt-secret-change-in-production   # CHANGER EN PRODUCTION (openssl rand -hex 32)
JWT_EXPIRES_IN=8h
JWT_REFRESH_EXPIRES_IN=7d

# ─────────────────────────────────────────────
# SERVEUR
# ─────────────────────────────────────────────
PORT=3001
NODE_ENV=development
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# ─────────────────────────────────────────────
# REDIS (BullMQ + cache)
# ─────────────────────────────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_URL=redis://localhost:6379   # Prioritaire sur HOST/PORT

# ─────────────────────────────────────────────
# INTELLIGENCE ARTIFICIELLE (Claude / Anthropic)
# ─────────────────────────────────────────────
ANTHROPIC_API_KEY=           # Obtenir sur console.anthropic.com
CLAUDE_MODEL=claude-sonnet-4-20250514

# ─────────────────────────────────────────────
# NOTIFICATIONS (Brevo)
# ─────────────────────────────────────────────
BREVO_API_KEY=               # Obtenir sur app.brevo.com

# ─────────────────────────────────────────────
# GÉOLOCALISATION / ROUTAGE
# ─────────────────────────────────────────────
CENTRE_TRI_LAT=49.4231
CENTRE_TRI_LNG=1.0993
OSRM_BASE_URL=https://router.project-osrm.org   # Remplacer par instance propre en prod

# ─────────────────────────────────────────────
# ÉVÉNEMENTS LOCAUX (optionnel)
# ─────────────────────────────────────────────
OPENAGENDA_API_KEY=          # Optionnel — sources gratuites disponibles sans clé

# ─────────────────────────────────────────────
# DOUBLE AUTHENTIFICATION (MFA) & SMOKE TEST
# ─────────────────────────────────────────────
MFA_ENCRYPTION_KEY=          # Recommandée en prod — sinon repli sur PCM_ENCRYPTION_KEY puis JWT_SECRET
SMOKE_API_KEY=               # Clé d'API de service (lecture seule) du smoke test post-déploiement
```

---

## 4. Variables par module (référence croisée)

| Module | Variables utilisées |
|--------|---------------------|
| Base de données | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| Auth / JWT | `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` |
| Serveur HTTP | `PORT`, `NODE_ENV`, `CORS_ORIGINS` |
| Redis / BullMQ | `REDIS_HOST`, `REDIS_PORT`, `REDIS_URL` |
| SolidataBot (chat) | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` |
| Plan entretien véhicules | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` |
| Synthèses prédictives | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` |
| Insertion IA | `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` |
| Notifications SMS/email | `BREVO_API_KEY` |
| Routage OSRM | `OSRM_BASE_URL` |
| Météo / géolocalisation | `CENTRE_TRI_LAT`, `CENTRE_TRI_LNG` |
| Événements locaux | `OPENAGENDA_API_KEY` |
| Double authentification (MFA) | `MFA_ENCRYPTION_KEY` |
| Smoke test post-déploiement | `SMOKE_API_KEY` |

---

## 5. Configuration production (Docker)

En production (`docker-compose.prod.yml`), les variables sont injectées via `env_file: ./backend/.env` ou directement dans la section `environment:` du service `solidata-api`.

**Variables à changer obligatoirement avant mise en production :**
- `DB_PASSWORD` → mot de passe fort
- `JWT_SECRET` → chaîne aléatoire 64+ chars (`openssl rand -hex 32`)
- `NODE_ENV` → `production`
- `CORS_ORIGINS` → domaines réels (`https://solidata.online,https://m.solidata.online`)
- `REDIS_HOST` → `solidata-redis` (nom du service Docker)
- `DB_HOST` → `solidata-db` (nom du service Docker)

---

## 6. Variables de configuration interne (non-env)

Ces valeurs sont codées dans le code source mais modifiables via l'API pour certaines.

### Facteurs prédictifs (modifiables via `PUT /api/tours/predictive-config`)

| Paramètre | Emplacement | Valeur par défaut |
|-----------|-------------|-------------------|
| Facteurs saisonniers | `backend/src/routes/tours/predictions.js` | `[0.88, 0.82, 0.94, 1.05, 1.12, 0.99, 1.19, 1.27, 1.13, 1.02, 0.84, 0.75]` |
| Facteurs jour de semaine | `backend/src/routes/tours/predictions.js` | `[1.25, 1.09, 1.05, 0.49, 1.11, 1.15, 1.10]` |
| Calendrier jours fériés | `backend/src/routes/tours/predictions.js` | Jours fériés français 2025-2026 |
| Calendrier vacances scolaires | `backend/src/routes/tours/predictions.js` | Zone B (Normandie) 2025-2027 |

### Configuration scoring tournée intelligente (modifiable via `PUT /api/tours/predictive-config`)

| Paramètre | Valeur par défaut | Description |
|-----------|-------------------|-------------|
| `vehicleCapacityPercent` | `0.95` | Utilisation max capacité véhicule |
| `maxCollectionHours` | `7` | Heures max de collecte |
| `lunchBreakMinutes` | `30` | Durée pause déjeuner |
| `returnThresholdKg` | `2000` | Poids déclenchant retour intermédiaire au centre |
| `minutesPerCav` | `10` | Temps de collecte par défaut par CAV (si non appris) |
| `lunchBreakAfterHours` | `4` | Déclenchement pause après N heures de collecte |

### Double authentification — rôles soumis (2.43.0)

Lue par `backend/src/middleware/mfa.js` (cache 60 s), **aucun seed en base** — comme partout dans le projet, le défaut vit dans le code, `settings` ne sert qu'à le surcharger.

| Clé `settings` | Emplacement | Valeur par défaut |
|-----------------|-------------|--------------------|
| `securite.mfa_roles` | `backend/src/middleware/mfa.js` | `["ADMIN","RH","DPO"]` (tableau JSON de rôles de BASE — un rôle personnalisé est soumis si son rôle de base l'est ; le rôle `PCM` a été retiré du périmètre par arbitrage client en 2.43.0) |
| `securite.mfa_duree_heures` | `backend/src/middleware/mfa.js` | `24` — durée de validité d'un second facteur. Au-delà, la session est renvoyée au code TOTP (403 `MFA_EXPIREE`), même si son jeton de renouvellement court encore. Bornée à [1 ; 168] h : une valeur hors bornes, illisible ou absente retombe sur le défaut en code. Le renouvellement de jeton NE repousse PAS l'horodatage — sans quoi une session simplement restée active ne se périmerait jamais. |
| `vak.caisses_exclues` | `backend/src/services/sumup.js` | `Caisse Vintiz` — caisses EXCLUES de **toutes** les VAK, sans saisie par événement (alias séparés par des virgules, comme `vaks.compte_caisse`). Se combine à la liste blanche facultative `compte_caisse` : un ticket est compté s'il n'est pas exclu ET s'il passe le périmètre de sa VAK. Un compte **inconnu** n'est jamais exclu (sinon l'écran TV, alimenté par des webhooks sans identifiant de caisse, se viderait). Réglage **vidé** = plus aucune exclusion (décision respectée) ; réglage **absent** = défaut en code. |

### Purges de rétention RGPD (2.44.0, étendues en 2.45.0, 2.50.0)

Les neuf purges (2.50.0 : bordereaux de collecte en déchèterie) sont décrites dans le registre `PURGES_RGPD` de
`backend/src/services/rgpd-purges.js` — source unique du job planifié **et** du bouton
« Lancer maintenant » de l'écran RGPD. Chaque seuil se règle sans redéploiement ; l'écran
indique s'il vient d'un réglage ou du défaut en code.

| Clé `settings` | Purge concernée | Valeur par défaut |
|-----------------|-----------------|--------------------|
| `rgpd.pcm_non_recrute_retention_jours` | Tests PCM des candidats non recrutés — délai compté depuis la **passation** du test (repli : création de la session si le test n'a jamais été passé) | `90` (jours) |
| `rgpd.pcm_reponses_retention_jours` | **Réponses détaillées** au questionnaire PCM (`pcm_answers`) — même comptage depuis la **passation**, mais périmètre plus large : **toutes les personnes, recrutées comprises**. Une fois le profil calculé, les réponses item par item n'ont plus d'usage opérationnel (minimisation, art. 5-1-c). La synthèse (types de base et de phase, rapport chiffré) est conservée au-delà, selon la ligne précédente. | `30` (jours) |

> **Conséquence à connaître avant de raccourcir ce délai.** Le script
> `backend/src/scripts/reparer-rapports-pcm.js` reconstruit un rapport devenu illisible
> (rotation de clé de chiffrement) **à partir des réponses**. Passé ce délai, il ne le peut
> plus : il le dit et ne répare pas. Les types de base et de phase, eux, sont stockés en clair
> et subsistent — ce n'est pas le profil qui se perd, c'est le rapport rédigé autour de lui.

Les autres purges (candidatures 24 mois, dossiers d'insertion clos, positions GPS, arrêts de
tournée, messagerie, jetons de rafraîchissement) conservent les clés de réglage qui leur étaient
déjà propres — le lot 2.44.0 les a déplacées dans le service partagé **sans changer leur
comportement**.

| Clé `settings` | Purge concernée | Valeur par défaut |
|-----------------|-----------------|--------------------|
| `rgpd.bordereaux_decheterie_retention_jours` | **Bordereaux de collecte en déchèterie** (`tour_decheterie_bordereaux`) — PDF et les deux signatures manuscrites qu'il porte (dont celle d'un agent de déchèterie, tiers). Le délai court depuis `created_at`, c'est-à-dire depuis le passage du camion — une validation par le gestionnaire est un événement de gestion interne, elle ne prolonge pas la durée de vie de la signature d'un tiers. Suppression (`DELETE`), pas anonymisation : ce qui resterait après retrait des signatures et du PDF n'aurait plus aucun usage. | `1095` (jours, soit 3 ans — arbitrage client 06/09/2026) |

### Bordereau de collecte en déchèterie — seed du référentiel Métropole (2.50.0)

| Clé `settings` | Emplacement | Rôle |
|-----------------|-------------|------|
| `collecte.decheteries_metropole_seed` | `backend/src/scripts/init-db.js` | **Verrou** (pas un réglage à éditer) posé une seule fois, la première fois qu'au moins un CAV est marqué déchèterie depuis `backend/src/data/decheteries-metropole.json` (14 déchèteries avec identifiant SOLIDATA, sur 15 — Saint-Étienne-du-Rouvray n'a pas encore de CAV). Un CAV n'est marqué par son identifiant QUE si sa commune correspond (garde anti-erreur d'identifiant) ; repli par nom (« déchetterie ») + commune sinon. Une fois posé, un démarquage manuel dans Gestion des CAV n'est **jamais** annulé par un redémarrage (doctrine 2.26.4). Aucune valeur n'est posée si rien n'a pu être marqué (base neuve sans référentiel CAV) : une nouvelle tentative a lieu au démarrage suivant. |

**Asset optionnel** : `backend/assets/logo-metropole-rouen.png` — logo officiel de la Métropole
Rouen Normandie pour l'en-tête du bordereau PDF. Non fourni par le dépôt (le scan remis par le
client est inexploitable) ; en son absence, `utils/bordereau-decheterie-pdf.js` affiche un
repli texte (« MÉTROPOLE ROUEN NORMANDIE »). À déposer manuellement sur le serveur, aucune
variable d'environnement associée.

### Note de profil initial CIP — génération automatique (2.43.0)

| Clé `settings` | Emplacement | Valeur par défaut |
|-----------------|-------------|--------------------|
| `insertion.note_profil_auto` | `backend/src/utils/insertion-settings.js` | `true` — génération systématique à la liaison candidat→collaborateur (désactivable) |

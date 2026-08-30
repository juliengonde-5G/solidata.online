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
| `API_TOTP_SECRET` | *(vide)* | Non* | Secret TOTP (Base32) du compte de service utilisé par le smoke test post-déploiement (`scripts/tests/api-smoke.js`), **si la double authentification est activée sur ce compte**. |

*Sans `API_TOTP_SECRET`, si le compte API est soumis à la double authentification, le login du smoke test répond `mfa_required` et le script se dégrade explicitement (avertissement en sortie) plutôt que d'échouer le déploiement — mais il ne couvre alors plus aucun des endpoints protégés par `requireMfa`.

Utilisées dans : `backend/src/utils/mfa-crypto.js` (cascade de clé), `scripts/tests/api-smoke.js` (calcul du code TOTP du compte de service via `backend/src/utils/totp.js`).

> **Mise en service (2.43.0)** : renseigner `MFA_ENCRYPTION_KEY` est recommandé mais pas bloquant. En revanche, **une action manuelle est requise après le premier déploiement** : enrôler le compte de service utilisé par `API_USER`/`API_PASSWORD` (se connecter avec ce compte, suivre l'écran d'enrôlement) puis renseigner son secret dans `API_TOTP_SECRET` sur le serveur — sans quoi le smoke test de `deploy.sh update` ne couvre plus les endpoints sensibles (`/api/insertion`, `/api/pcm`, `/api/employees`…), bien qu'il reste vert (401/403 comptent comme « endpoint protégé, OK »).

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
API_TOTP_SECRET=             # Secret TOTP (Base32) du compte API, si ce compte est soumis à la double authentification
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
| Smoke test post-déploiement | `API_USER`, `API_PASSWORD`, `API_TOTP_SECRET` |

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

### Purges de rétention RGPD (2.44.0)

Les sept purges sont décrites dans le registre `PURGES_RGPD` de
`backend/src/services/rgpd-purges.js` — source unique du job planifié **et** du bouton
« Lancer maintenant » de l'écran RGPD. Chaque seuil se règle sans redéploiement ; l'écran
indique s'il vient d'un réglage ou du défaut en code.

| Clé `settings` | Purge concernée | Valeur par défaut |
|-----------------|-----------------|--------------------|
| `rgpd.pcm_non_recrute_retention_jours` | Tests PCM des candidats non recrutés — délai compté depuis la **passation** du test (repli : création de la session si le test n'a jamais été passé) | `90` (jours) |

Les autres purges (candidatures 24 mois, dossiers d'insertion clos, positions GPS, arrêts de
tournée, messagerie, jetons de rafraîchissement) conservent les clés de réglage qui leur étaient
déjà propres — le lot 2.44.0 les a déplacées dans le service partagé **sans changer leur
comportement**.

### Note de profil initial CIP — génération automatique (2.43.0)

| Clé `settings` | Emplacement | Valeur par défaut |
|-----------------|-------------|--------------------|
| `insertion.note_profil_auto` | `backend/src/utils/insertion-settings.js` | `true` — génération systématique à la liaison candidat→collaborateur (désactivable) |

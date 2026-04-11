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

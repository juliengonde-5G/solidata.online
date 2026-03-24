# SOLIDATA — Présentation Technique

> **Version** : 1.2.1 | **Date** : 24 mars 2026
> **Public** : Équipe technique, DSI, prestataires, auditeurs

---

## 1. Architecture Globale

### 1.1 Infrastructure

```
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║                           Scaleway DEV1-S                                             ║
║                     2 vCPU · 2 Go RAM · 20 Go SSD                                    ║
║                     IP: 51.159.144.100                                                ║
║                     Répertoire: /opt/solidata.online                                  ║
║                                                                                       ║
║  Internet ──▶ UFW Firewall (22/80/443)                                                ║
║                  │                                                                    ║
║                  ▼                                                                    ║
║              Fail2ban (protection brute force)                                        ║
║                  │                                                                    ║
║                  ▼                                                                    ║
║  ┌─────────────────────────────────────────────────────────────────────────────────┐  ║
║  │                     Nginx Reverse Proxy (:443 SSL)                               │  ║
║  │                     Let's Encrypt (auto-renewal)                                 │  ║
║  │                     TLS 1.2/1.3, HSTS 2 ans, HTTP/2                              │  ║
║  │                                                                                   │  ║
║  │  solidata.online ──────────▶ solidata-web (:80, React build)                     │  ║
║  │  m.solidata.online ────────▶ solidata-mobile (:80, PWA build)                    │  ║
║  │  /api/* ───────────────────▶ solidata-api (:3001, Node.js)                       │  ║
║  │  /socket.io/* ─────────────▶ solidata-api (WebSocket upgrade)                    │  ║
║  │  /uploads/* ───────────────▶ solidata-api (fichiers statiques)                   │  ║
║  └─────────────────────────────────────────────────────────────────────────────────┘  ║
║                                       │                                               ║
║                              ┌────────┴────────┐                                      ║
║                              │                 │                                      ║
║                    ┌─────────┴──────┐  ┌──────┴──────────┐                            ║
║                    │  solidata-db   │  │  solidata-redis  │                            ║
║                    │  PostgreSQL 15 │  │  Redis 7         │                            ║
║                    │  + PostGIS 3.4 │  │  Cache + Sessions│                            ║
║                    │  :5432         │  │  :6379           │                            ║
║                    └────────────────┘  └─────────────────┘                            ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝
```

### 1.2 Conteneurs Docker (7 services)

| Service | Image | Port | Mémoire (prod) | Rôle |
|---------|-------|------|-----------------|------|
| solidata-web | Node/React (build Vite) | 3000 → 80 | 256 Mo | Frontend web |
| solidata-mobile | Node/React (build Vite PWA) | 3002 → 80 | 256 Mo | Mobile PWA |
| solidata-api | Node.js 20 LTS | 3001 | 512 Mo | Backend API + Socket.IO |
| solidata-db | PostgreSQL 15 + PostGIS 3.4 | 5432 | 512 Mo | Base de données |
| solidata-redis | Redis 7 Alpine | 6379 | 128 Mo | Cache + sessions |
| solidata-nginx | Nginx 1.25 | 80, 443 | 128 Mo | Reverse proxy SSL |
| solidata-certbot | Certbot | — | 64 Mo | Renouvellement SSL |

---

## 2. Stack Technologique

### 2.1 Backend

| Composant | Technologie | Version | Usage |
|-----------|-------------|---------|-------|
| Runtime | Node.js | 20 LTS | Serveur API |
| Framework | Express | 4.21 | Routing, middleware |
| Base de données | pg (node-postgres) | 8.x | Driver PostgreSQL |
| Géospatial | PostGIS | 3.4 | Coordonnées CAV, GPS |
| Cache | ioredis | 5.x | Sessions, cache API |
| Temps réel | Socket.IO | 4.8 | GPS, notifications |
| Files d'attente | BullMQ | 5.x | Jobs asynchrones |
| Auth | jsonwebtoken | 9.x | JWT access/refresh |
| Chiffrement | bcrypt | 5.x | Mots de passe |
| Chiffrement données | crypto-js | 4.x | AES-256 (PCM) |
| Upload | Multer | 1.4 | Fichiers (CV, photos) |
| OCR | Tesseract.js | 5.x | Lecture factures PDF |
| PDF | pdf-parse | 1.x | Extraction texte PDF |
| Email/SMS | Brevo API | v3 | Notifications |

### 2.2 Frontend Web

| Composant | Technologie | Version | Usage |
|-----------|-------------|---------|-------|
| UI | React | 18.3 | Interface web |
| Build | Vite | 6.x | Bundler, HMR |
| CSS | Tailwind CSS | 3.4 | Styles utilitaires |
| Routing | React Router | 7.x | Navigation SPA |
| Graphiques | Recharts | 2.x | Charts, KPI |
| Cartes | Leaflet | 1.9 | Cartographie CAV |
| HTTP | Axios | 1.x | Appels API |
| État | React Context + Hooks | — | AuthContext, état local |

### 2.3 Mobile PWA

| Composant | Technologie | Version | Usage |
|-----------|-------------|---------|-------|
| UI | React | 18.3 | Interface mobile |
| PWA | vite-plugin-pwa | 0.x | Service Worker, manifest |
| QR Code | html5-qrcode | 2.x | Scanner codes CAV |
| Haptic | Vibration API | — | Feedback tactile |
| GPS | Geolocation API | — | Position temps réel |
| Temps réel | Socket.IO Client | 4.x | Envoi positions GPS |

---

## 3. Base de Données

### 3.1 Vue d'ensemble

- **Moteur** : PostgreSQL 15 + PostGIS 3.4
- **Tables** : 85+
- **Création** : `backend/src/scripts/init-db.js` (idempotent, IF NOT EXISTS)
- **Requêtes** : 100% paramétrisées ($1, $2, $3...)
- **Timestamps** : created_at, updated_at sur toutes les tables
- **Soft delete** : deleted_at sur les tables principales

### 3.2 Tables par Domaine

| Domaine | Tables | Clé |
|---------|--------|-----|
| **Auth** | users, refresh_tokens, settings, message_templates | users.id |
| **Recrutement** | candidates, candidate_history, candidate_skills, skill_keywords, recruitment_interviews, mise_en_situation, recruitment_documents, recruitment_plan | candidates.id |
| **PCM** | pcm_sessions, pcm_answers, pcm_reports | pcm_sessions.id |
| **RH** | teams, employees, positions, employee_contracts, employee_availability, schedule, work_hours | employees.id |
| **Insertion** | insertion_diagnostics, insertion_milestones, cip_action_plans, insertion_interview_alerts | insertion_diagnostics.id |
| **Collecte** | cav, vehicles, standard_routes, standard_route_cav, tours, tour_cav, tour_weights, incidents, gps_positions, tonnage_history, vehicle_checklists, cav_qr_scans | tours.id, cav.id |
| **Stock** | matieres, stock_movements, flux_sortants | stock_movements.id |
| **Tri** | chaines_tri, operations_tri, postes_operation, sorties_operation, categories_sortantes, types_conteneurs, produits_catalogue, produits_finis | chaines_tri.id |
| **Exécution Tri** | batch_tracking, operation_executions, operation_outputs, colisages, colisage_items, colisage_history | batch_tracking.id |
| **Expéditions** | expeditions, associations, exutoires | expeditions.id |
| **Logistique** | clients_exutoires, tarifs_exutoires, commandes_exutoires, preparations_expedition | commandes_exutoires.id |
| **Facturation** | invoices, invoice_lines | invoices.id |
| **Refashion** | refashion_dpav, refashion_communes, refashion_subventions | refashion_dpav.id |
| **ML/IA** | ml_fill_predictions, ml_model_metadata, collection_context, evenements_locaux, collection_learning_feedback | ml_fill_predictions.id |
| **RGPD** | rgpd_registre, rgpd_consents, rgpd_audit_log | rgpd_registre.id |
| **Maintenance** | vehicle_maintenance, vehicle_maintenance_alerts | vehicle_maintenance.id |

---

## 4. API REST

### 4.1 Structure

- **33 fichiers de routes** dans `backend/src/routes/`
- **Middleware auth** : `authenticate` (vérifie JWT) + `authorize('ROLE1', 'ROLE2')`
- **Réponse erreur** : `{ error: 'message' }` avec status HTTP approprié
- **Rate limiting** : 1000 req/15min global, 30 req/15min auth

### 4.2 Endpoints Principaux

```
POST   /api/auth/login           # Connexion (JWT)
POST   /api/auth/refresh          # Rafraîchir token
POST   /api/auth/logout           # Déconnexion

GET    /api/users                 # Liste utilisateurs (ADMIN)
GET    /api/candidates            # Liste candidats (RH, ADMIN)
GET    /api/employees             # Liste collaborateurs
GET    /api/teams                 # Équipes

GET    /api/tours                 # Tournées de collecte
POST   /api/tours/intelligent     # Tournée IA
GET    /api/cav                   # Conteneurs d'apport
GET    /api/vehicles              # Véhicules

GET    /api/tri/chaines           # Chaînes de tri
POST   /api/tri/batches           # Créer un lot
GET    /api/production            # Production quotidienne
GET    /api/stock                 # Mouvements stock

GET    /api/commandes-exutoires   # Commandes logistique
GET    /api/preparations/gantt    # Planning Gantt
GET    /api/controles-pesee       # Contrôles pesée
GET    /api/factures-exutoires    # Factures

GET    /api/reporting/*           # Rapports (collecte, production, RH)
GET    /api/refashion             # Déclarations Refashion
```

---

## 5. Sécurité

### 5.1 Authentification & Autorisation

| Couche | Mécanisme | Détail |
|--------|-----------|--------|
| **Authentification** | JWT | Access token 8h, Refresh token 7j |
| **Mot de passe** | bcrypt | 10 rounds de salage |
| **Autorisation** | RBAC | 5 rôles (ADMIN, MANAGER, RH, COLLABORATEUR, AUTORITE) |
| **Chiffrement sensible** | AES-256 | Données PCM (crypto-js) |
| **Tokens** | crypto.randomBytes(64) | Tokens de rafraîchissement |

### 5.2 Protection Infrastructure

| Couche | Mesure |
|--------|--------|
| **Transport** | TLS 1.2/1.3, HSTS 2 ans, HTTP/2 |
| **Headers** | Helmet (X-Frame-Options, X-Content-Type, HSTS) |
| **CORS** | Whitelist (solidata.online uniquement) |
| **Rate Limiting** | 1000 req/15min global, 30 req/15min auth |
| **SQL** | Requêtes 100% paramétrisées ($1, $2, $3) |
| **Firewall** | UFW (22/80/443 uniquement) |
| **Anti brute-force** | Fail2ban |
| **RGPD** | Module dédié (registre, audit, anonymisation) |

---

## 6. Temps Réel (Socket.IO)

```
Chauffeur (mobile) ──── Socket.IO ────▶ Backend (solidata-api)
                                             │
                              ┌──────────────┼──────────────┐
                              ▼              ▼              ▼
                        GPS positions   Tour status    Notifications
                        (toutes 10s)    (changements)  (alertes)
                              │              │              │
                              ▼              ▼              ▼
                        LiveVehicles    Tours.jsx      Managers
                        (carte web)     (mise à jour)  (alertes)
```

**Événements** :
- `gps:update` — Position GPS du chauffeur (lat, lng, speed)
- `tour:status` — Changement de statut de tournée
- `cav:collected` — CAV collecté (niveau, poids)
- `incident:new` — Nouvel incident signalé
- `notification:push` — Notification pour manager

---

## 7. Intelligence Artificielle

### 7.1 Prédiction de Remplissage CAV

```
Données historiques (tonnage_history)
    + Facteurs saisonniers (ml_model_metadata)
    + Météo locale (collection_context)
    + Événements locaux (evenements_locaux)
    ──────────────────────────────────────────▶ Prédiction remplissage
                                                 par CAV + date

Feedback : observé vs prédit (collection_learning_feedback)
    ──────────────────────────────────────────▶ Amélioration modèle
```

### 7.2 Optimisation des Tournées

- **Mode intelligent** : Sélection des CAV les plus remplis + optimisation distance
- **Contraintes** : Capacité véhicule, horaires, zones, priorités
- **3 modes** : Intelligent (IA) / Standard (prédéfini) / Manuel (libre)

---

## 8. DevOps & Déploiement

### 8.1 Workflow

```
Développeur → git push origin main → SSH serveur → bash deploy/scripts/deploy.sh update
```

### 8.2 Script deploy.sh

```
1. Sauvegarde automatique (pg_dump)
2. git pull origin main
3. docker compose build --no-cache
4. docker compose up -d
5. docker image prune -f
6. Vérification santé (health check)
```

### 8.3 Sauvegarde

- **Automatique** : pg_dump avant chaque déploiement
- **Manuelle** : Page AdminDB → Backup
- **Restauration** : Page AdminDB → Restore
- **Maintenance** : VACUUM, purge, statistiques

---

## 9. Métriques du Projet

| Métrique | Valeur |
|----------|--------|
| Tables PostgreSQL | 85+ |
| Fichiers de routes API | 33 |
| Pages web React | 44 + 7 Hubs |
| Pages mobile React | 11 |
| Modules fonctionnels | 21 |
| Produits finis référencés | 114 |
| Exutoires configurés | 37 |
| CAV géolocalisés | ~30 |
| Rôles utilisateur | 5 |
| Postes de tri | 9 |

---

## 10. Roadmap Technique

### Q2 2026
- Capteurs IoT LoRaWAN (table `cav_sensor_readings` prête)
- Maintenance prédictive véhicules (tables `vehicle_maintenance*` prêtes)
- OCR factures fournisseurs (tesseract.js en dépendance)

### Q3-Q4 2026
- Modèle ML avancé (tables ML prêtes, feedback loop en place)
- PWA offline-first (IndexedDB + Service Worker)
- Dashboard temps réel (Socket.IO + KPIs live)
- Notifications push mobile (Service Worker)

### 2027+
- Multi-site (consolidation reporting)
- API partenaires (exutoires, associations, collectivités)
- Computer vision classification tri
- Blockchain traçabilité fibre
- Export FEC comptable

---

## 11. Fichiers Clés

| Fichier | Rôle |
|---------|------|
| `backend/src/index.js` | Entry point Express + Socket.IO + auto-init DB |
| `backend/src/config/database.js` | Pool PostgreSQL |
| `backend/src/middleware/auth.js` | authenticate() + authorize() |
| `backend/src/scripts/init-db.js` | Création 85+ tables (idempotent) |
| `frontend/src/App.jsx` | Routeur (44 pages, ProtectedRoute) |
| `frontend/src/contexts/AuthContext.jsx` | Auth state + token refresh |
| `frontend/src/services/api.js` | Axios instance + interceptors |
| `frontend/src/components/Layout.jsx` | Sidebar + navigation role-based |
| `docker-compose.yml` | Dev |
| `docker-compose.prod.yml` | Production (7 services + limites) |
| `deploy/scripts/deploy.sh` | Script de déploiement |

---

*Document technique de référence — SOLIDATA ERP v1.2.1*
*Dernière mise à jour : 24 mars 2026*

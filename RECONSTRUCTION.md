# SOLIDATA ERP - Pack Technique de Reconstruction

> **Référentiel principal du projet :** [DOCUMENTATION_TECHNIQUE.md](./DOCUMENTATION_TECHNIQUE.md) — document de référence officiel (architecture, stack, déploiement, API).
>
> Ce fichier (RECONSTRUCTION.md) est un **pack de reconstruction** généré le 2026-03-07 : il détaille le schéma BDD, les routes et la logique métier pour reconstruire l’application depuis zéro. À utiliser en complément de la documentation technique.

---

## TABLE DES MATIERES

1. [Vue d'ensemble](#1-vue-densemble)
2. [Stack technique](#2-stack-technique)
3. [Architecture fichiers](#3-architecture-fichiers)
4. [Infrastructure & deploiement](#4-infrastructure--deploiement)
5. [Base de donnees - Schema complet](#5-base-de-donnees---schema-complet)
6. [Backend - API REST](#6-backend---api-rest)
7. [Frontend - Application web](#7-frontend---application-web)
8. [Application mobile (PWA)](#8-application-mobile-pwa)
9. [Logique metier](#9-logique-metier)
10. [Donnees de reference (seeds)](#10-donnees-de-reference-seeds)
11. [Variables d'environnement](#11-variables-denvironnement)
12. [Procedure de reconstruction](#12-procedure-de-reconstruction)

---

## 1. VUE D'ENSEMBLE

**SOLIDATA ERP** est un ERP complet pour **Solidarite Textiles**, association de collecte,
tri et valorisation de textiles usages (economie circulaire, agree Refashion).

### Modules fonctionnels

| Module | Description |
|--------|-------------|
| **Recrutement** | Kanban candidats, upload CV avec extraction IA, test PCM, gestion competences |
| **Equipe RH** | Employes, heures de travail, planification, contrats |
| **Collecte** | Points de collecte (CAV/PAV), tournees intelligentes (TSP), suivi GPS temps reel |
| **Production/Tri** | Chaines de tri (Qualite + Recyclage Exclusif), KPI production journaliere |
| **Stock** | Matiere premiere (Collecte + Dons - Passage chaine - Vente originaux) |
| **Produits finis** | Scan code-barres, inventaire, gammes (1er choix, 2nd choix, etc.) |
| **Expeditions** | Sorties vers exutoires, consolidation mensuelle |
| **Facturation** | Factures avec lignes, TVA 20%, export PDF |
| **Reporting** | Dashboard KPI, cartes, graphiques, exports Excel/PDF |
| **Refashion** | DPAV trimestriel, communes, subventions, coherence entrees/sorties |
| **Referentiels** | Associations, exutoires, catalogue produits, categories sortantes, conteneurs |
| **Administration** | Utilisateurs, roles, parametres, templates SMS/email, logs, RGPD |

### Roles utilisateurs

| Role | Acces |
|------|-------|
| `ADMIN` | Acces complet |
| `MANAGER` | Production, collecte, stock, expeditions |
| `RH` | Recrutement, employes, heures |
| `COLLABORATEUR` | Acces limite (lecture) |
| `AUTORITE` | Reporting uniquement |

---

## 2. STACK TECHNIQUE

### Backend
- **Runtime** : Node.js 20
- **Framework** : Express.js 4.21
- **Base de donnees** : PostgreSQL 15 + PostGIS 3.4
- **Auth** : JWT (jsonwebtoken) + bcryptjs
- **Temps reel** : Socket.io 4.8
- **Upload fichiers** : Multer
- **Export Excel** : ExcelJS
- **Export PDF** : PDFKit
- **QR Codes** : qrcode
- **Parse CV** : pdf-parse
- **Parse Excel** : xlsx
- **Parse KML** : xml2js

### Frontend (Web)
- **Framework** : React 18.3 + React Router 7.1
- **Build** : Vite 6.0
- **CSS** : Tailwind CSS 3.4
- **HTTP** : Axios
- **Graphiques** : Recharts
- **Cartes** : Leaflet + React-Leaflet
- **Temps reel** : socket.io-client

### Mobile (PWA)
- **Framework** : React 18 + React Router
- **Build** : Vite
- **CSS** : Tailwind CSS
- Pages : Login, Checklist, TourMap, VehicleSelect, QRScanner, FillLevel, Incident, QRUnavailable, ReturnCentre, WeighIn, TourSummary

### Infrastructure
- **Conteneurs** : Docker Compose
- **Reverse proxy** : Nginx (frontend + mobile)
- **BDD** : postgis/postgis:15-3.4

---

## 3. ARCHITECTURE FICHIERS

```
solidata.online/
├── docker-compose.yml
├── .env
│
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── .env.example
│   ├── src/
│   │   ├── index.js                    # Serveur Express + Socket.io
│   │   ├── config/
│   │   │   └── database.js             # Pool PostgreSQL (pg)
│   │   ├── middleware/
│   │   │   └── auth.js                 # JWT authenticate + authorize(roles)
│   │   └── routes/
│   │       ├── auth.js                 # Login, refresh, logout, me, password
│   │       ├── users.js                # CRUD utilisateurs
│   │       ├── settings.js             # Parametres + templates SMS/email
│   │       ├── candidates.js           # Kanban recrutement + CV extraction
│   │       ├── employees.js            # Employes + heures
│   │       ├── teams.js                # Equipes
│   │       ├── cav.js                  # Points de collecte + QR codes
│   │       ├── vehicles.js             # Vehicules
│   │       ├── tours.js                # Tournees intelligentes (TSP)
│   │       ├── stock.js                # Mouvements stock MP
│   │       ├── production.js           # KPI production journaliere
│   │       ├── tri.js                  # Chaines de tri, operations, postes, flux
│   │       ├── produits-finis.js       # Produits finis + scan code-barres
│   │       ├── expeditions.js          # Expeditions + consolidation
│   │       ├── billing.js              # Factures
│   │       ├── exports.js              # Export Excel/PDF
│   │       ├── reporting.js            # Dashboard + KPI + cartes
│   │       ├── refashion.js            # DPAV + communes + subventions
│   │       ├── referentiels.js         # Donnees de reference
│   │       ├── pcm.js                  # Test personnalite PCM
│   │       └── notifications.js        # Envoi SMS/email
│   ├── scripts/
│   │   ├── init-db.js                  # Creation schema BDD v1
│   │   ├── migrate-v2.js              # Migration v2 (tri, referentiels, etc.)
│   │   ├── seed-cav.js                # Import CAV depuis KML
│   │   ├── seed-data.js               # Import tournees/tonnages depuis Excel
│   │   └── seed-production.js         # Import KPI production depuis Excel
│   └── uploads/                        # Fichiers uploades (CV, QR, photos)
│
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf                      # SPA routing + proxy /api
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx                    # Point d'entree React
│       ├── App.jsx                     # Routes (30+ routes)
│       ├── index.css                   # Tailwind directives
│       ├── contexts/
│       │   └── AuthContext.jsx         # Auth provider + JWT refresh
│       ├── services/
│       │   └── api.js                  # Axios instance + interceptors
│       ├── components/
│       │   └── Layout.jsx              # Sidebar + navigation
│       └── pages/
│           ├── Login.jsx
│           ├── Dashboard.jsx
│           ├── Candidates.jsx          # Kanban recrutement
│           ├── Campaigns.jsx
│           ├── PersonalityMatrix.jsx   # PCM
│           ├── Employees.jsx
│           ├── WorkHours.jsx
│           ├── Skills.jsx
│           ├── CollectionPlanning.jsx
│           ├── Vehicles.jsx
│           ├── Tours.jsx               # Preparation tournees (wizard 4 etapes)
│           ├── LiveVehicles.jsx
│           ├── CAVMap.jsx              # Carte interactive Leaflet
│           ├── CAVList.jsx
│           ├── Production.jsx          # KPI production
│           ├── SortingPlanning.jsx
│           ├── ChaineTri.jsx           # Schema visuel chaines de tri
│           ├── Stock.jsx               # Stock MP (formule visuelle)
│           ├── ProduitsFinis.jsx
│           ├── Expeditions.jsx
│           ├── Reporting.jsx           # Dashboard principal
│           ├── Refashion.jsx           # Reporting Refashion
│           ├── Billing.jsx
│           ├── Users.jsx
│           ├── Settings.jsx
│           ├── Referentiels.jsx
│           ├── DatabaseStatus.jsx
│           ├── ActivityLogs.jsx
│           ├── Messaging.jsx
│           └── EnvironmentData.jsx
│
└── mobile/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── contexts/
        │   ├── AuthContext.jsx
        │   └── TourContext.jsx
        ├── services/
        │   └── api.js
        ├── components/
        │   └── SideMenu.jsx
        ├── utils/
        │   └── feedback.js
        └── pages/
            ├── Login.jsx
            ├── VehicleSelect.jsx
            ├── Checklist.jsx
            ├── TourMap.jsx
            ├── QRScanner.jsx
            ├── FillLevel.jsx
            ├── QRUnavailable.jsx
            ├── Incident.jsx
            ├── ReturnCentre.jsx
            ├── WeighIn.jsx
            └── TourSummary.jsx
```

---

## 4. INFRASTRUCTURE & DEPLOIEMENT

### Docker Compose (docker-compose.yml)

```yaml
version: '3.8'
services:
  db:
    image: postgis/postgis:15-3.4
    container_name: solidata-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: solidata
      POSTGRES_USER: solidata_user
      POSTGRES_PASSWORD: ${DB_PASSWORD:-changeme_in_production}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U solidata_user -d solidata"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend
    container_name: solidata-api
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DB_HOST: db
      DB_PORT: 5432
      DB_NAME: solidata
      DB_USER: solidata_user
      DB_PASSWORD: ${DB_PASSWORD:-changeme_in_production}
      JWT_SECRET: ${JWT_SECRET:-change-this-in-production}
      JWT_EXPIRES_IN: 8h
      JWT_REFRESH_EXPIRES_IN: 7d
      PORT: 3001
      NODE_ENV: production
      BREVO_API_KEY: ${BREVO_API_KEY:-}
    ports:
      - "3001:3001"
    volumes:
      - uploads:/app/uploads

  frontend:
    build: ./frontend
    container_name: solidata-web
    restart: unless-stopped
    depends_on: [backend]
    ports:
      - "3000:80"

  mobile:
    build: ./mobile
    container_name: solidata-mobile
    restart: unless-stopped
    depends_on: [backend]
    ports:
      - "3002:80"

volumes:
  pgdata:
  uploads:
```

### Dockerfile Backend

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3001
CMD ["node", "src/index.js"]
```

### Dockerfile Frontend / Mobile

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Nginx (frontend)

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://backend:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /uploads/ {
        proxy_pass http://backend:3001;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### Vite Config (frontend)

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
      '/assets': 'http://localhost:3001',
    },
  },
});
```

---

## 5. BASE DE DONNEES - SCHEMA COMPLET

### Extension requise
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

### Tables (ordre de creation)

#### Module 1 : Authentification

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'MANAGER', 'RH', 'COLLABORATEUR', 'AUTORITE')),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone VARCHAR(20),
  team_id INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(500) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT,
  category VARCHAR(50),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE message_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('sms', 'email')),
  category VARCHAR(50) NOT NULL,
  subject VARCHAR(255),
  body TEXT NOT NULL,
  variables TEXT[],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### Module 2 : Recrutement

```sql
CREATE TABLE candidates (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  email VARCHAR(255),
  phone VARCHAR(20),
  gender VARCHAR(20),
  has_permis_b BOOLEAN DEFAULT false,
  has_caces BOOLEAN DEFAULT false,
  cv_raw_text TEXT,
  cv_file_path VARCHAR(500),
  source_email VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'to_contact', 'not_retained', 'summoned', 'recruited')),
  appointment_date TIMESTAMP,
  appointment_location VARCHAR(255),
  sms_response VARCHAR(20),
  interviewer_name VARCHAR(100),
  interview_comment TEXT,
  practical_test_done BOOLEAN DEFAULT false,
  practical_test_result VARCHAR(20) CHECK (practical_test_result IN ('conforme', 'faible', 'recale')),
  practical_test_comment TEXT,
  assigned_team_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE candidate_history (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  comment TEXT,
  changed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE candidate_skills (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
  skill_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'not_mentioned'
    CHECK (status IN ('not_mentioned', 'detected', 'confirmed')),
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(candidate_id, skill_name)
);
```

#### Module 3 : PCM (Test personnalite)

```sql
CREATE TABLE pcm_sessions (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
  mode VARCHAR(20) NOT NULL CHECK (mode IN ('autonomous', 'accompanied')),
  access_token VARCHAR(255) UNIQUE,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE pcm_answers (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES pcm_sessions(id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL,
  answer_value TEXT NOT NULL,
  answer_voice_text TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE pcm_reports (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES pcm_sessions(id) ON DELETE CASCADE,
  candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
  base_type VARCHAR(20),
  phase_type VARCHAR(20),
  encrypted_report TEXT NOT NULL,
  risk_alert BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### Module 4 : Equipes & Planification

```sql
CREATE TABLE teams (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(30) CHECK (type IN ('collecte', 'tri', 'magasin', 'administration')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE employees (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(255),
  photo_path VARCHAR(500),
  team_id INTEGER REFERENCES teams(id),
  position VARCHAR(100),
  contract_type VARCHAR(50),
  contract_start DATE,
  contract_end DATE,
  has_permis_b BOOLEAN DEFAULT false,
  has_caces BOOLEAN DEFAULT false,
  weekly_hours DOUBLE PRECISION DEFAULT 35,
  skills TEXT[],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE positions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  required_skills TEXT[],
  team_type VARCHAR(30),
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE schedule (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('work', 'training', 'rest', 'leave', 'vak')),
  position_id INTEGER REFERENCES positions(id),
  is_provisional BOOLEAN DEFAULT true,
  confirmed_by INTEGER REFERENCES users(id),
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(employee_id, date)
);

CREATE TABLE work_hours (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  hours_worked DOUBLE PRECISION NOT NULL,
  overtime_hours DOUBLE PRECISION DEFAULT 0,
  type VARCHAR(20) DEFAULT 'normal' CHECK (type IN ('normal', 'training', 'absence', 'sick', 'holiday')),
  notes TEXT,
  validated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(employee_id, date)
);
```

#### Module 5 : Collecte

```sql
CREATE TABLE cav (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address VARCHAR(500),
  commune VARCHAR(100),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  geom GEOMETRY(Point, 4326),
  nb_containers INTEGER DEFAULT 1,
  qr_code_data VARCHAR(255) UNIQUE,
  qr_code_image_path VARCHAR(500),
  avg_fill_rate DOUBLE PRECISION DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'unavailable')),
  unavailable_reason TEXT,
  unavailable_since DATE,
  route_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_cav_geom ON cav USING GIST(geom);
CREATE INDEX idx_cav_status ON cav(status);

CREATE TABLE vehicles (
  id SERIAL PRIMARY KEY,
  registration VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100),
  max_capacity_kg DOUBLE PRECISION NOT NULL DEFAULT 3500,
  team_id INTEGER REFERENCES teams(id),
  status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'maintenance', 'out_of_service')),
  current_km INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE standard_routes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  estimated_duration_minutes INTEGER,
  estimated_distance_km DOUBLE PRECISION,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE standard_route_cav (
  id SERIAL PRIMARY KEY,
  route_id INTEGER REFERENCES standard_routes(id) ON DELETE CASCADE,
  cav_id INTEGER REFERENCES cav(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  UNIQUE(route_id, cav_id)
);

CREATE TABLE tours (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  vehicle_id INTEGER REFERENCES vehicles(id),
  driver_employee_id INTEGER REFERENCES employees(id),
  standard_route_id INTEGER REFERENCES standard_routes(id),
  mode VARCHAR(20) NOT NULL CHECK (mode IN ('intelligent', 'standard', 'manual')),
  status VARCHAR(20) DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'paused', 'completed', 'cancelled')),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  total_weight_kg DOUBLE PRECISION DEFAULT 0,
  ai_explanation TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE tour_cav (
  id SERIAL PRIMARY KEY,
  tour_id INTEGER REFERENCES tours(id) ON DELETE CASCADE,
  cav_id INTEGER REFERENCES cav(id),
  position INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'collected', 'skipped', 'incident')),
  fill_level INTEGER CHECK (fill_level BETWEEN 0 AND 5),
  qr_scanned BOOLEAN DEFAULT false,
  qr_unavailable BOOLEAN DEFAULT false,
  qr_unavailable_reason VARCHAR(100),
  photo_path VARCHAR(500),
  collected_at TIMESTAMP,
  notes TEXT
);

CREATE TABLE tour_weights (
  id SERIAL PRIMARY KEY,
  tour_id INTEGER REFERENCES tours(id) ON DELETE CASCADE,
  weight_kg DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMP DEFAULT NOW(),
  recorded_by INTEGER REFERENCES employees(id)
);

CREATE TABLE incidents (
  id SERIAL PRIMARY KEY,
  tour_id INTEGER REFERENCES tours(id),
  cav_id INTEGER REFERENCES cav(id),
  employee_id INTEGER REFERENCES employees(id),
  vehicle_id INTEGER REFERENCES vehicles(id),
  type VARCHAR(50) NOT NULL CHECK (type IN ('cav_problem', 'environment', 'vehicle_breakdown', 'accident', 'other')),
  description TEXT,
  photo_path VARCHAR(500),
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  resolved_at TIMESTAMP,
  resolved_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE gps_positions (
  id SERIAL PRIMARY KEY,
  tour_id INTEGER REFERENCES tours(id) ON DELETE CASCADE,
  vehicle_id INTEGER REFERENCES vehicles(id),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION,
  recorded_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE tonnage_history (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  cav_id INTEGER REFERENCES cav(id),
  weight_kg DOUBLE PRECISION NOT NULL,
  source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'mobile')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE vehicle_checklists (
  id SERIAL PRIMARY KEY,
  tour_id INTEGER REFERENCES tours(id),
  vehicle_id INTEGER REFERENCES vehicles(id),
  employee_id INTEGER REFERENCES employees(id),
  exterior_ok BOOLEAN NOT NULL,
  fuel_level VARCHAR(10) NOT NULL CHECK (fuel_level IN ('1/4', '1/2', '3/4', 'full')),
  km_start INTEGER NOT NULL,
  km_end INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### Module 6 : Stock & Materiaux

```sql
CREATE TABLE matieres (
  id SERIAL PRIMARY KEY,
  categorie VARCHAR(100) NOT NULL,
  sous_categorie VARCHAR(100),
  qualite VARCHAR(50),
  destination_possible TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE stock_movements (
  id SERIAL PRIMARY KEY,
  type VARCHAR(10) NOT NULL CHECK (type IN ('entree', 'sortie')),
  date DATE NOT NULL,
  poids_kg DOUBLE PRECISION NOT NULL,
  matiere_id INTEGER REFERENCES matieres(id),
  destination VARCHAR(255),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  -- Colonnes V2
  code_barre VARCHAR(20),
  origine VARCHAR(100),
  categorie_collecte VARCHAR(100),
  poids_brut_kg DOUBLE PRECISION,
  tare_kg DOUBLE PRECISION,
  vehicle_id INTEGER REFERENCES vehicles(id),
  tour_id INTEGER REFERENCES tours(id),
  scan_sortie_at TIMESTAMP,
  scan_inventaire_at TIMESTAMP
);

CREATE TABLE flux_sortants (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  type VARCHAR(30) NOT NULL CHECK (type IN ('vente', 'recyclage', 'upcycling', 'vak')),
  matiere_id INTEGER REFERENCES matieres(id),
  poids_kg DOUBLE PRECISION NOT NULL,
  valeur_euros DOUBLE PRECISION,
  destination VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### Module 7 : Facturation

```sql
CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  client_name VARCHAR(255) NOT NULL,
  client_address TEXT,
  client_email VARCHAR(255),
  date DATE NOT NULL,
  due_date DATE,
  total_ht DOUBLE PRECISION DEFAULT 0,
  total_tva DOUBLE PRECISION DEFAULT 0,
  total_ttc DOUBLE PRECISION DEFAULT 0,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  paid_at TIMESTAMP,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE invoice_lines (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  quantity DOUBLE PRECISION DEFAULT 1,
  unit_price DOUBLE PRECISION DEFAULT 0,
  total DOUBLE PRECISION DEFAULT 0
);
```

#### Module 8 : Production

```sql
CREATE TABLE production_daily (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  effectif_theorique INTEGER,
  effectif_reel INTEGER,
  entree_ligne_kg DOUBLE PRECISION DEFAULT 0,
  objectif_entree_ligne_kg DOUBLE PRECISION DEFAULT 1300,
  entree_recyclage_r3_kg DOUBLE PRECISION DEFAULT 0,
  objectif_entree_r3_kg DOUBLE PRECISION DEFAULT 1300,
  total_jour_t DOUBLE PRECISION DEFAULT 0,
  productivite_kg_per DOUBLE PRECISION DEFAULT 0,
  encadrant VARCHAR(100),
  commentaire TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE postes_tri (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  competences_requises TEXT[],
  zone_tri VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE reporting_refashion (
  id SERIAL PRIMARY KEY,
  periode VARCHAR(20) NOT NULL,
  tonnage_collecte DOUBLE PRECISION DEFAULT 0,
  tonnage_trie DOUBLE PRECISION DEFAULT 0,
  tonnage_valorise DOUBLE PRECISION DEFAULT 0,
  tonnage_recycle DOUBLE PRECISION DEFAULT 0,
  conformite_cdc BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### Module V2 : Referentiels & Tri

```sql
CREATE TABLE associations (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(255) NOT NULL,
  type VARCHAR(100),
  adresse TEXT,
  commune VARCHAR(100),
  contact_nom VARCHAR(100),
  contact_tel VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE exutoires (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(255) NOT NULL UNIQUE,
  type VARCHAR(50),
  adresse TEXT,
  contact_nom VARCHAR(100),
  contact_email VARCHAR(255),
  contact_tel VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE produits_catalogue (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(255) NOT NULL,
  categorie_eco_org VARCHAR(100) NOT NULL,
  genre VARCHAR(50),
  saison VARCHAR(20) DEFAULT 'Sans Saison',
  gamme VARCHAR(20) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(nom, categorie_eco_org, genre, saison, gamme)
);

CREATE TABLE categories_sortantes (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(100) NOT NULL UNIQUE,
  famille VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE types_conteneurs (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE chaines_tri (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE operations_tri (
  id SERIAL PRIMARY KEY,
  chaine_id INTEGER REFERENCES chaines_tri(id) NOT NULL,
  numero INTEGER NOT NULL,
  nom VARCHAR(100) NOT NULL,
  code VARCHAR(20) NOT NULL UNIQUE,
  est_obligatoire BOOLEAN DEFAULT true,
  description TEXT,
  UNIQUE(chaine_id, numero)
);

CREATE TABLE postes_operation (
  id SERIAL PRIMARY KEY,
  operation_id INTEGER REFERENCES operations_tri(id) NOT NULL,
  nom VARCHAR(100) NOT NULL,
  code VARCHAR(20) NOT NULL UNIQUE,
  est_obligatoire BOOLEAN DEFAULT true,
  permet_doublure BOOLEAN DEFAULT false,
  competences_requises TEXT[],
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE sorties_operation (
  id SERIAL PRIMARY KEY,
  operation_id INTEGER REFERENCES operations_tri(id) NOT NULL,
  nom VARCHAR(100) NOT NULL,
  type_sortie VARCHAR(20) NOT NULL
    CHECK (type_sortie IN ('produit_fini', 'recyclage', 'csr', 'vers_operation', 'exutoire_direct')),
  operation_destination_id INTEGER REFERENCES operations_tri(id),
  categorie_sortante_id INTEGER REFERENCES categories_sortantes(id),
  UNIQUE(operation_id, nom)
);

CREATE TABLE produits_finis (
  id SERIAL PRIMARY KEY,
  code_barre VARCHAR(20) NOT NULL UNIQUE,
  catalogue_id INTEGER REFERENCES produits_catalogue(id),
  produit VARCHAR(255),
  categorie_eco_org VARCHAR(100),
  genre VARCHAR(50),
  saison VARCHAR(20),
  gamme VARCHAR(20),
  poids_kg DOUBLE PRECISION NOT NULL,
  date_fabrication TIMESTAMP NOT NULL,
  poste_id INTEGER REFERENCES postes_operation(id),
  date_sortie TIMESTAMP,
  date_inventaire TIMESTAMP,
  exutoire_id INTEGER REFERENCES exutoires(id),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE expeditions (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  exutoire_id INTEGER REFERENCES exutoires(id) NOT NULL,
  categorie_sortante_id INTEGER REFERENCES categories_sortantes(id) NOT NULL,
  type_conteneur_id INTEGER REFERENCES types_conteneurs(id),
  nb_conteneurs INTEGER DEFAULT 1,
  poids_kg DOUBLE PRECISION NOT NULL,
  valeur_euros DOUBLE PRECISION,
  bon_livraison VARCHAR(100),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### Module V2 : Refashion

```sql
CREATE TABLE refashion_dpav (
  id SERIAL PRIMARY KEY,
  annee INTEGER NOT NULL,
  trimestre INTEGER NOT NULL CHECK (trimestre BETWEEN 1 AND 4),
  stock_debut_t DOUBLE PRECISION DEFAULT 0,
  stock_fin_t DOUBLE PRECISION DEFAULT 0,
  achats_t DOUBLE PRECISION DEFAULT 0,
  ventes_reemploi_t DOUBLE PRECISION DEFAULT 0,
  ventes_recyclage_t DOUBLE PRECISION DEFAULT 0,
  csr_t DOUBLE PRECISION DEFAULT 0,
  energie_t DOUBLE PRECISION DEFAULT 0,
  tri_t DOUBLE PRECISION DEFAULT 0,
  conformite_cdc BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(annee, trimestre)
);

CREATE TABLE refashion_communes (
  id SERIAL PRIMARY KEY,
  annee INTEGER NOT NULL,
  trimestre INTEGER NOT NULL CHECK (trimestre BETWEEN 1 AND 4),
  commune VARCHAR(100) NOT NULL,
  code_postal VARCHAR(10),
  poids_kg DOUBLE PRECISION DEFAULT 0,
  UNIQUE(annee, trimestre, commune)
);

CREATE TABLE refashion_subventions (
  id SERIAL PRIMARY KEY,
  annee INTEGER NOT NULL,
  trimestre INTEGER NOT NULL CHECK (trimestre BETWEEN 1 AND 4),
  taux_reemploi_euro_t DOUBLE PRECISION DEFAULT 80,
  taux_recyclage_euro_t DOUBLE PRECISION DEFAULT 295,
  taux_csr_euro_t DOUBLE PRECISION DEFAULT 210,
  taux_energie_euro_t DOUBLE PRECISION DEFAULT 20,
  taux_entree_euro_t DOUBLE PRECISION DEFAULT 193,
  tonnage_reemploi DOUBLE PRECISION DEFAULT 0,
  tonnage_recyclage DOUBLE PRECISION DEFAULT 0,
  tonnage_csr DOUBLE PRECISION DEFAULT 0,
  tonnage_energie DOUBLE PRECISION DEFAULT 0,
  tonnage_entree DOUBLE PRECISION DEFAULT 0,
  part_non_tlc DOUBLE PRECISION DEFAULT 0,
  montant_reemploi DOUBLE PRECISION DEFAULT 0,
  montant_recyclage DOUBLE PRECISION DEFAULT 0,
  montant_csr DOUBLE PRECISION DEFAULT 0,
  montant_energie DOUBLE PRECISION DEFAULT 0,
  montant_entree DOUBLE PRECISION DEFAULT 0,
  montant_total DOUBLE PRECISION DEFAULT 0,
  UNIQUE(annee, trimestre)
);
```

---

## 6. BACKEND - API REST

### Configuration serveur (index.js)

- Express sur port 3001
- Socket.io pour GPS temps reel + mises a jour tournees
- CORS ouvert (`*`)
- Body JSON limite 10 MB
- 20 modules de routes montes sur `/api/*`
- Sert `/uploads` (fichiers) et `/assets` (logo)

### Authentification (auth.js)

- `POST /api/auth/login` : username/password -> accessToken + refreshToken
- `POST /api/auth/refresh` : refresh token -> nouvel accessToken
- `POST /api/auth/logout` : revoque refresh tokens
- `GET /api/auth/me` : profil utilisateur courant
- `PUT /api/auth/password` : changement mot de passe

### Middleware auth (middleware/auth.js)

- `authenticate()` : verifie Bearer JWT, ajoute `req.user`
- `authorize(...roles)` : verifie role dans la liste

### Database config (config/database.js)

- Pool pg : 20 connexions max, idle 30s, connect timeout 2s

### Tous les endpoints API

#### Utilisateurs (`/api/users`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | ADMIN | Liste utilisateurs |
| POST | `/` | ADMIN | Creer utilisateur |
| PUT | `/:id` | ADMIN | Modifier utilisateur |
| PUT | `/:id/reset-password` | ADMIN | Reset mot de passe |
| DELETE | `/:id` | ADMIN | Desactiver utilisateur |

#### Parametres (`/api/settings`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | ADMIN | Liste parametres |
| PUT | `/:key` | ADMIN | Modifier parametre |
| GET | `/templates` | ADMIN | Templates SMS/email |
| POST | `/templates` | ADMIN | Creer template |
| PUT | `/templates/:id` | ADMIN | Modifier template |

#### Candidats (`/api/candidates`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | ADMIN, RH, MANAGER | Liste candidats |
| POST | `/` | ADMIN, RH | Creer candidat |
| GET | `/:id` | ADMIN, RH, MANAGER | Detail candidat |
| PUT | `/:id` | ADMIN, RH | Modifier candidat |
| PUT | `/:id/status` | ADMIN, RH | Deplacer dans Kanban |
| POST | `/:id/upload-cv` | ADMIN, RH | Upload CV + extraction |
| POST | `/upload-cv-new` | ADMIN, RH | Upload CV nouveau candidat |
| GET | `/:id/download-cv` | ADMIN, RH, MANAGER | Telecharger CV |
| GET | `/:id/skills` | ADMIN, RH, MANAGER | Competences candidat |
| PUT | `/:id/skills/:skillName` | ADMIN, RH | Modifier statut competence |
| GET | `/:id/history` | ADMIN, RH | Historique statuts |

**Extraction CV (logique)** :
- Parse PDF (pdf-parse), TXT, DOC/DOCX
- Regex pour email, telephone (formats FR : 06/07, +33, 0033)
- Detection de 15+ competences par mots-cles :
  - Conduite PL, CACES, Permis B, Tri textile, Controle qualite
  - Gestion equipe, SST, Habilitation electrique, Logistique, Manutention
  - Collecte, Environnement, Couture, Vente, Informatique

#### Employes (`/api/employees`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | ADMIN, MANAGER, RH | Liste employes |
| GET | `/hours/summary` | ADMIN, MANAGER, RH | Resume heures mensuel |
| GET | `/:id` | ADMIN, MANAGER, RH | Detail employe |
| POST | `/` | ADMIN, RH | Creer employe |
| PUT | `/:id` | ADMIN, RH, MANAGER | Modifier employe |
| GET | `/:id/schedule` | ADMIN, MANAGER, RH | Planning mensuel |
| GET | `/:id/hours` | ADMIN, MANAGER, RH | Heures travaillees |
| POST | `/:id/hours` | ADMIN, RH, MANAGER | Saisir heures |

#### Equipes (`/api/teams`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | Authentifie | Liste equipes |
| POST | `/` | ADMIN | Creer equipe |
| PUT | `/:id` | ADMIN | Modifier equipe |
| GET | `/:id/members` | Authentifie | Membres equipe |

#### CAV - Points de collecte (`/api/cav`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | Authentifie | Liste CAV (filtres : status, commune) |
| GET | `/stats/communes` | Authentifie | Communes distinctes |
| GET | `/:id` | Authentifie | Detail CAV |
| POST | `/` | ADMIN, MANAGER | Creer CAV + QR auto |
| PUT | `/:id` | ADMIN, MANAGER | Modifier CAV |
| POST | `/generate-all-qrcodes` | ADMIN | Generer QR manquants |
| GET | `/:id/qrcode` | Authentifie | Telecharger QR |
| GET | `/:id/history` | Authentifie | Historique collectes |
| POST | `/:id/generate-qrcode` | ADMIN, MANAGER | Regenerer QR |

#### Vehicules (`/api/vehicles`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | Authentifie | Liste vehicules |
| POST | `/` | ADMIN, MANAGER | Creer vehicule |
| PUT | `/:id` | ADMIN, MANAGER | Modifier vehicule |
| GET | `/:id/km-history` | Authentifie | Historique km |

#### Tournees (`/api/tours`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | Authentifie | Liste tournees (filtres : date, status, vehicule) |
| GET | `/standard-routes` | Authentifie | Tournees types |
| GET | `/available-resources` | Authentifie | Vehicules/chauffeurs dispo |
| GET | `/prepare/intelligent` | ADMIN, MANAGER | **Tournee IA** (TSP + scoring) |
| GET | `/:id` | Authentifie | Detail tournee |
| POST | `/` | ADMIN, MANAGER | Creer tournee |
| PUT | `/:id/status` | ADMIN, MANAGER | Changer statut |
| PUT | `/:tourId/cav/:tourCavId` | Authentifie | Collecter CAV (mobile) |
| POST | `/:id/weight` | Authentifie | Enregistrer pesee |
| POST | `/:id/checklist` | Authentifie | Checklist vehicule |
| POST | `/:id/incident` | Authentifie | Signaler incident |
| POST | `/:id/gps` | Authentifie | Position GPS |

**Algorithme tournee intelligente** :
- Distance Haversine entre coordonnees GPS
- Heuristique nearest-neighbor (TSP)
- Scoring : taux remplissage historique (90j), facteur saison, jours depuis derniere collecte, urgence CAV (>80% = critique), capacite vehicule
- Retourne explication IA textuelle

#### Stock (`/api/stock`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | Authentifie | Mouvements + totaux |
| POST | `/` | ADMIN, MANAGER | Creer mouvement |
| GET | `/summary` | Authentifie | Resume par categorie |
| GET | `/matieres` | Authentifie | Liste matieres |

**Formule stock MP** : `Collecte + Dons - Passage chaine - Vente originaux = Stock MP`

#### Production (`/api/production`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | ADMIN, MANAGER | Donnees production (mois/annee) |
| GET | `/dashboard` | ADMIN, MANAGER | KPI + graphique mensuel |
| GET | `/:id` | ADMIN, MANAGER | Detail journee |
| POST | `/` | ADMIN, MANAGER | Saisie journaliere |
| PUT | `/:id` | ADMIN, MANAGER | Modifier |
| DELETE | `/:id` | ADMIN | Supprimer |

**KPI Production** :
- Objectif mensuel : 46.8t (mois normal) ou 41.6t (mois court)
- Entree = ligne + R3 recyclage
- Productivite = kg/personne

#### Tri (`/api/tri`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/chaines` | Authentifie | Chaines avec operations + postes |
| GET | `/operations` | Authentifie | Operations |
| GET | `/postes` | Authentifie | Postes de travail |
| GET | `/sorties-operation` | Authentifie | Sorties possibles |
| GET | `/flux` | Authentifie | Vue flux consolidee |

#### Produits finis (`/api/produits-finis`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | Authentifie | Liste (filtres : gamme, categorie, date, in_stock) |
| GET | `/summary` | Authentifie | Resume par gamme |
| POST | `/` | ADMIN, MANAGER | Creer produit fini |
| POST | `/bulk` | ADMIN | Import en masse |
| POST | `/scan` | Authentifie | Scan code-barres (sortie/inventaire) |

#### Expeditions (`/api/expeditions`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/` | Authentifie | Liste expeditions |
| GET | `/consolidation` | Authentifie | Consolidation mensuelle |
| GET | `/totaux` | Authentifie | Totaux par famille |
| POST | `/` | ADMIN, MANAGER | Creer expedition |
| POST | `/bulk` | ADMIN | Import masse |
| PUT | `/:id` | Authentifie | Modifier |
| DELETE | `/:id` | ADMIN | Supprimer |

#### Facturation (`/api/billing`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/invoices` | ADMIN, MANAGER | Liste factures |
| POST | `/invoices` | ADMIN, MANAGER | Creer facture (TVA 20% auto) |
| GET | `/invoices/:id` | ADMIN, MANAGER | Detail facture |
| PUT | `/invoices/:id/status` | ADMIN, MANAGER | Changer statut |

#### Exports (`/api/exports`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/tonnages` | Authentifie | Export tonnages Excel/CSV |
| GET | `/cav` | Authentifie | Export CAV Excel |
| GET | `/invoices/:id/pdf` | ADMIN, MANAGER | Export facture PDF |
| GET | `/report` | ADMIN, MANAGER | Rapport mensuel PDF |

#### Reporting (`/api/reporting`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/dashboard` | Authentifie | KPI principaux |
| GET | `/cav-map` | Authentifie | Donnees carte |
| GET | `/cav/:id/details` | Authentifie | Detail CAV + prediction 60j |
| GET | `/monthly-chart` | Authentifie | Graphique mensuel |
| GET | `/top-cav` | Authentifie | Top CAV |
| GET | `/route-stats` | Authentifie | Stats par tournee type |

#### Refashion (`/api/refashion`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/dpav` | ADMIN, MANAGER | Declarations DPAV |
| POST | `/dpav` | ADMIN | Creer/calculer DPAV |
| GET | `/communes` | ADMIN, MANAGER | Communes de collecte |
| GET | `/subventions` | ADMIN, MANAGER | Calcul subventions |
| GET | `/coherence` | ADMIN, MANAGER | Coherence entrees/sorties |

#### Referentiels (`/api/referentiels`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET/POST/PUT | `/associations` | ADMIN | CRUD associations |
| GET/POST/PUT | `/exutoires` | ADMIN | CRUD exutoires |
| GET/POST/PUT | `/catalogue` | ADMIN | CRUD catalogue produits |
| POST | `/catalogue/bulk` | ADMIN | Import masse catalogue |
| GET | `/categories-sortantes` | Authentifie | Categories sortantes |
| GET | `/types-conteneurs` | Authentifie | Types conteneurs |

#### PCM (`/api/pcm`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/questions` | Authentifie | Questionnaire (8 questions, 6 types T/H/P/I/R/E) |
| POST | `/sessions` | ADMIN, RH | Creer session |
| GET | `/sessions/candidate/:id` | ADMIN, RH | Sessions candidat |
| PUT | `/sessions/:id/start` | Authentifie | Demarrer session |
| POST | `/sessions/:id/answers` | Authentifie | Soumettre reponses + generer rapport |
| GET | `/sessions/:id/report` | ADMIN, RH | Rapport PCM |

#### Notifications (`/api/notifications`)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/templates` | Authentifie | Templates disponibles |
| POST | `/send-sms` | ADMIN, RH | Envoyer SMS (Brevo API) |
| POST | `/send-email` | ADMIN, RH | Envoyer email |

---

## 7. FRONTEND - APPLICATION WEB

### Couleurs Tailwind personnalisees

```js
colors: {
  solidata: {
    green: '#8BC540',
    'green-dark': '#6B9F2D',
    yellow: '#F5A623',
    'yellow-dark': '#D4891A',
    gray: '#4A4A4A',
    'gray-light': '#F5F5F5',
  },
},
```

### Routes frontend (App.jsx)

```
/                              -> Dashboard (accueil)
/login                         -> Connexion

-- Recrutement --
/recruitment/campaigns         -> Campagnes
/recruitment/candidates        -> Kanban candidats
/recruitment/personality       -> Matrice PCM

-- Equipe --
/team/employees               -> Employes
/team/hours                   -> Heures de travail
/team/skills                  -> Competences

-- Collecte --
/collection/planning          -> Planning hebdo collecte
/collection/vehicles          -> Vehicules
/collection/tours             -> Preparation tournees (wizard 4 etapes)
/collection/live              -> Suivi vehicules temps reel
/collection/cav-map           -> Carte interactive CAV

-- Tri --
/sorting/planning             -> Planning tri hebdo
/sorting/production           -> KPI production journaliere
/sorting/stock                -> Stock matiere premiere
/sorting/chaine-tri           -> Schema visuel chaines de tri
/sorting/produits-finis       -> Produits finis + scan
/sorting/expeditions          -> Expeditions sortantes

-- Reporting --
/reporting                    -> Dashboard principal KPI
/reporting/refashion          -> Reporting Refashion (DPAV, communes, subventions)

-- Facturation --
/billing                     -> Factures

-- Parametres (ADMIN) --
/settings/referentiels        -> Referentiels metier
/settings/vehicles            -> Vehicules
/settings/cav                 -> Points de collecte
/settings/messaging           -> Templates SMS/email + config Brevo
/settings/environment         -> Donnees environnementales
/settings/skills              -> Catalogue competences
/settings/database            -> Etat BDD + RGPD
/settings/logs                -> Logs activite
/settings/users               -> Gestion utilisateurs
/settings/general             -> Parametres generaux
```

### Pages principales - Fonctionnalites cles

#### Dashboard
- 4 KPI : CAV actifs, tonnage mois, CO2 evite, trend
- Graphique mensuel tonnages (Recharts BarChart)
- Top 5 CAV par collectes

#### Candidates (Kanban)
- 5 colonnes : Recu -> A convoquer -> Non retenu -> Convoque -> Recrute
- Drag & drop entre colonnes
- Modal creation avec upload CV (drag & drop)
- Modal detail : infos, CV, competences (3 statuts visuels), historique, test PCM
- Tags : Permis B, CACES, CV

#### Tours (Wizard 4 etapes)
1. Selection vehicule + chauffeur
2. Mode (intelligent IA / tournee type / manuel)
3. Selection CAV + carte
4. Resume + confirmation

#### ChaineTri (3 vues)
- **Visuel** : diagramme horizontal interactif, cliquer sur operation pour voir sorties
- **Flux detail** : liste detaillee par operation
- **Postes** : grille des postes de travail par operation

#### Stock MP
- Formule visuelle : Collecte + Dons - Passage chaine - Vente originaux = Stock MP
- 4 types de mouvement dans le formulaire
- KPI + tableaux categories et mouvements

#### CAVMap
- Carte Leaflet avec marqueurs colores par taux remplissage
- Modal detail avec historique + prediction 60 jours

### Navigation (Layout.jsx)

Sidebar avec sections :
1. Tableau de bord
2. Recrutement (Campagnes, Candidats, Personnalite)
3. Equipe (Employes, Heures, Competences)
4. Collecte (Planning, Vehicules, Tournees, Suivi live, Carte CAV)
5. Tri (Planning, Production, Stock, Chaine, Produits finis, Expeditions)
6. Reporting (Dashboard, Refashion)
7. Facturation
8. Referentiels
9. Parametres (Vehicules, PAV/CAV, Messagerie, Environnement, Competences, BDD, Logs, Utilisateurs, General)

### Auth Context (AuthContext.jsx)
- Login : POST /api/auth/login -> stocke token localStorage
- Interceptor Axios : ajoute Bearer token, auto-refresh sur 401
- Logout : supprime token + redirect /login

### API Service (api.js)
- Axios instance baseURL `/api`
- Timeout 15s
- Interceptor request : ajoute Authorization header
- Interceptor response : refresh token sur 401

---

## 8. APPLICATION MOBILE (PWA)

### Pages mobiles

| Page | Description |
|------|-------------|
| Login | Connexion chauffeur |
| VehicleSelect | Selection vehicule du jour |
| Checklist | Controle vehicule (exterieur, carburant, km) |
| TourMap | Carte Leaflet avec itineraire des CAV |
| QRScanner | Scan QR code du CAV |
| FillLevel | Saisie niveau remplissage (0-5) |
| QRUnavailable | Signaler QR indisponible |
| Incident | Formulaire incident (5 types) |
| ReturnCentre | Retour au centre de tri |
| WeighIn | Saisie pesee |
| TourSummary | Resume de la tournee |

### Contextes mobiles
- `AuthContext` : authentification JWT (similaire web)
- `TourContext` : etat de la tournee en cours

---

## 9. LOGIQUE METIER

### Chaines de tri

**Chaine "Qualite"** (5 etapes) :
```
Matiere brute
  -> Crackage 1 (obligatoire)
       Sorties: CSR Textiles, CSR Chaussures, -> Recyclage, -> Crackage 2
  -> Crackage 2 (optionnel)
  -> Recyclage (obligatoire)
       Sorties: Chiffons blanc/couleur, Effilochage (Coton/Jean/Merinos/Tricot), -> Reutilisation
  -> Reutilisation (obligatoire)
       Sorties: Pre-classe (Textiles/Chaussures/Linge/Maroquinerie), Original, Jouets, Chaussures paires, -> Triage fin
  -> Triage fin (obligatoire)
       Sorties: 2nd choix VAK, Destockage
```

**Chaine "Recyclage Exclusif"** (1 etape) :
```
Matiere non reutilisable -> Recyclage Exclusif
```

### Categories sortantes (17)

| Categorie | Famille |
|-----------|---------|
| Chiffons blanc | chiffons |
| Chiffons couleur | chiffons |
| CSR Textiles | csr |
| CSR Chaussures | csr |
| Original | original |
| Pre-classe Textiles | pre_classe |
| Pre-classe Chaussures | pre_classe |
| Pre-classe Linge | pre_classe |
| Pre-classe Maroquinerie | pre_classe |
| Effilochage Coton | effilochage |
| Effilochage Jean | effilochage |
| Effilochage Merinos | effilochage |
| Effilochage Tricot | effilochage |
| Destockage | destockage |
| 2nd choix VAK | vak |
| Jouets | original |
| Chaussures paires | original |

### Postes de travail (11)

| Code | Nom | Operation | Obligatoire | Doublure |
|------|-----|-----------|-------------|----------|
| P_CRACK1 | Crackage 1 | CRACK1 | Oui | Oui |
| P_CRACK2 | Crackage 2 | CRACK2 | Non | Non |
| P_R1 | Recyclage R1 | RECYCL | Oui | Non |
| P_R2 | Recyclage R2 | RECYCL | Oui | Non |
| P_R3 | Recyclage R3 | RECYCL | Non | Non |
| P_R4 | Recyclage R4 | RECYCL | Non | Non |
| P_REU | Reutilisation | REUTIL | Oui | Oui |
| P_CHIF | Chiffons | REUTIL | Oui | Non |
| P_TF1 | Triage Fin 1 | TRIFIN | Oui | Non |
| P_TF2 | Triage Fin 2 | TRIFIN | Non | Non |
| P_REXCL | Recyclage Exclusif | RECYCL_EXCL | Oui | Non |

### Exutoires (21 principaux)

Types : interne (boutiques), repreneur, recycleur, association
- Boutiques : Rouen, Elbeuf, Barentin
- Repreneurs : VAK Export, Le Relais, Gebetex, Texaid, Soltex, Pre-classe Export Afrique/Europe Est
- Recycleurs : Renaissance Textile, Minot Recyclage, Suez CSR, Veolia Energie, Effilochage Laroche
- Associations : Secours Populaire, Restos du Coeur, Emmaus, Croix Rouge, CCAS Rouen/Elbeuf

### Subventions Refashion (taux par defaut)

| Categorie | Taux (EUR/t) |
|-----------|-------------|
| Reemploi | 80 |
| Recyclage | 295 |
| CSR | 210 |
| Energie | 20 |
| Entree tri | 193 |

### Facteurs environnementaux

- CO2 evite : 3.6 kg CO2 / kg textile collecte (parametre `co2_factor_per_kg`)

### Parametres RGPD

- Retention candidats : 730 jours (2 ans)
- Retention PCM : 365 jours (1 an)

### Production - Objectifs

- Objectif mensuel : 46.8 tonnes (mois 22+ jours) ou 41.6 tonnes (mois court)
- Objectif journalier : 1300 kg/ligne + 1300 kg/R3

---

## 10. DONNEES DE REFERENCE (SEEDS)

### Utilisateur admin par defaut
- Username : `admin`
- Password : `admin123` (hash bcrypt pre-calcule)
- Role : ADMIN

### Equipes par defaut
1. Collecte Equipe 1 (collecte)
2. Collecte Equipe 2 (collecte)
3. Tri (tri)
4. Magasin Rouen (magasin)
5. Administration (administration)

### Postes par defaut
1. Chauffeur collecte (permis_b, collecte)
2. Aide collecteur (collecte)
3. Cariste (caces, tri)
4. Agent de tri (tri)
5. Vendeur magasin (magasin)
6. Responsable magasin (magasin)

### Templates SMS/email par defaut
1. Convocation entretien (SMS) - variables : prenom, date, heure, lieu
2. Rappel veille (SMS) - variables : prenom, heure, lieu
3. Refus candidature (email) - variables : prenom
4. Documents integration (email) - variables : prenom, date_debut

### Conteneurs
Balles, Curons, Remorque, Sacs, Cartons

### Parametres par defaut
- retention_days_candidates: 730
- retention_days_pcm: 365
- cav_collection_threshold_days: 7
- max_drive_hours_per_day: 6
- co2_factor_per_kg: 3.6
- centre_tri_address: Centre de Tri, Rouen
- brevo_sender_name: Solidarite Textiles

### Scripts d'import de donnees
- `seed-cav.js` : Import CAV depuis fichier KML (Google Earth)
- `seed-data.js` : Import PAV + tonnages depuis fichiers Excel (.xlsx)
- `seed-production.js` : Import KPI production depuis Excel mensuel

---

## 11. VARIABLES D'ENVIRONNEMENT

### Fichier `.env` (racine)

```env
DB_PASSWORD=<mot_de_passe_postgres>
JWT_SECRET=<cle_jwt_longue_aleatoire>
BREVO_API_KEY=<cle_api_brevo_sms>
```

### Backend `.env.example`

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=solidata
DB_USER=solidata_user
DB_PASSWORD=CHANGE_ME

JWT_SECRET=CHANGE_ME_LONG_RANDOM_STRING
JWT_EXPIRES_IN=8h
JWT_REFRESH_EXPIRES_IN=7d

PORT=3001
NODE_ENV=development

BREVO_API_KEY=CHANGE_ME

CENTRE_TRI_LAT=49.4231
CENTRE_TRI_LNG=1.0993
```

---

## 12. PROCEDURE DE RECONSTRUCTION

### Etape 1 : Prerequis
- Docker + Docker Compose installes
- Node.js 20+ (pour dev local)
- Git

### Etape 2 : Structure
```bash
mkdir solidata.online && cd solidata.online
mkdir -p backend/src/{routes,config,middleware} backend/scripts backend/uploads
mkdir -p frontend/src/{pages,components,services,contexts}
mkdir -p mobile/src/{pages,components,services,contexts,utils}
```

### Etape 3 : Configuration
1. Creer les `package.json` (backend + frontend + mobile)
2. Creer les fichiers de config (vite, tailwind, postcss, nginx)
3. Creer `.env` avec secrets
4. Creer `docker-compose.yml`
5. Creer les `Dockerfile`

### Etape 4 : Backend
1. `config/database.js` - Pool PostgreSQL
2. `middleware/auth.js` - JWT + roles
3. `index.js` - Serveur Express + Socket.io
4. Creer les 20 fichiers de routes dans l'ordre :
   - auth, users, settings, teams, employees, candidates
   - cav, vehicles, tours
   - stock, production, tri, produits-finis, expeditions
   - billing, exports, reporting, refashion, referentiels
   - pcm, notifications

### Etape 5 : Base de donnees
```bash
npm run db:init          # Schema v1
node scripts/migrate-v2.js  # Schema v2
npm run db:seed-cav      # Import CAV (necessite KML)
npm run db:seed-data     # Import tonnages (necessite Excel)
npm run db:seed-production # Import production (necessite Excel)
```

### Etape 6 : Frontend
1. `main.jsx` + `App.jsx` (routes)
2. `AuthContext.jsx` + `api.js`
3. `Layout.jsx` (navigation)
4. Creer les 31 pages dans `pages/`

### Etape 7 : Mobile
1. `main.jsx` + `App.jsx`
2. Contextes (Auth + Tour)
3. Creer les 11 pages

### Etape 8 : Demarrage
```bash
# Dev local
cd backend && npm install && npm start
cd frontend && npm install && npm run dev
cd mobile && npm install && npm run dev

# Production Docker
docker compose up -d --build
docker compose exec backend node scripts/init-db.js
docker compose exec backend node scripts/migrate-v2.js
```

### Etape 9 : Verification
- Acceder a http://localhost:3000 (web)
- Acceder a http://localhost:3002 (mobile)
- Se connecter : admin / admin123
- Verifier : Dashboard, Candidats, CAV, Production, Chaine de tri

---

## DEPENDANCES EXACTES

### Backend (package.json)
```json
{
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "exceljs": "^4.4.0",
    "express": "^4.21.2",
    "express-validator": "^7.2.1",
    "jsonwebtoken": "^9.0.2",
    "multer": "^1.4.5-lts.1",
    "pdf-parse": "^2.4.5",
    "pdfkit": "^0.15.0",
    "pg": "^8.13.1",
    "qrcode": "^1.5.4",
    "socket.io": "^4.8.1",
    "xlsx": "^0.18.5",
    "xml2js": "^0.6.2"
  },
  "devDependencies": {
    "nodemon": "^3.1.9"
  }
}
```

### Frontend (package.json)
```json
{
  "dependencies": {
    "axios": "^1.7.9",
    "leaflet": "^1.9.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-leaflet": "^4.2.1",
    "react-router-dom": "^7.1.1",
    "recharts": "^2.15.0",
    "socket.io-client": "^4.8.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.18",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.5.1",
    "tailwindcss": "^3.4.17",
    "vite": "^6.0.7"
  }
}
```

---

> Ce document constitue le pack technique complet de SOLIDATA ERP.
> Avec ce fichier + le code source Git, l'application peut etre integralement
> reconstruite sur n'importe quelle plateforme.

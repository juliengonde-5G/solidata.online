# SOLIDATA ERP

**Plateforme de gestion integree pour Solidarite Textiles**
Collecte, tri, recyclage & insertion sociale

[![Stack](https://img.shields.io/badge/Stack-React_18_+_Node.js_+_PostgreSQL-blue)]()
[![Deploy](https://img.shields.io/badge/Deploy-Docker_Compose-green)]()
[![License](https://img.shields.io/badge/License-Proprietary-red)]()

---

## Presentation

SOLIDATA est un ERP concu pour **Solidarite Textiles**, structure d'insertion par l'activite economique (IAE) specialisee dans la collecte, le tri et la valorisation de textiles usages en Normandie (Metropole de Rouen).

**Domaine :** https://solidata.online
**Presentation des modules :** [/presentation-solidata.html](https://solidata.online/presentation-solidata.html)

---

## Modules

| # | Module | Description |
|---|--------|-------------|
| 1 | **Recrutement** | Kanban candidatures, parsing CV, test PCM (6 profils), Explorama, workflow embauche |
| 2 | **Parcours Insertion** | Diagnostic CIP, jalons ASP (M+1 → Sortie), freins peripheriques, moteur IA continu |
| 3 | **Collecte & Logistique IA** | Prediction remplissage (meteo, saisonnalite, evenements), optimisation tournees TSP+2-opt |
| 4 | **CAV & Stock** | Carte PostGIS des conteneurs, QR codes, stock temps reel, inventaire physique |
| 5 | **Flotte Vehicules** | Maintenance preventive (Ducato/Master eTech), alertes km/date, controle technique |
| 6 | **Reporting Metropole** | Tonnages, impact CO2, taux captation kg/hab/an, conformite Refashion/ASP |
| 7 | **RH & Notifications** | Fiches employes, contrats, objectifs, alertes SMS/email (Brevo) |
| 8 | **Fil d'actualite** | Veille sectorielle automatisee, fil LinkedIn recyclage textile |

---

## Stack technique

```
Frontend     React 18 + Vite + TailwindCSS + Recharts
Backend      Node.js + Express
BDD          PostgreSQL + PostGIS
Infra        Docker Compose + Nginx + Certbot SSL
Mobile       PWA (Progressive Web App)
Notifications  Brevo API (SMS + email)
Securite     JWT + AES-256 (PCM) + Helmet + RBAC (5 roles)
```

---

## Structure du projet

```
solidata.online/
├── frontend/          # Application React (Vite)
│   ├── src/
│   │   ├── pages/     # 35 pages (Dashboard, Candidates, Tours, Insertion...)
│   │   ├── components/
│   │   ├── contexts/
│   │   └── services/
│   └── public/        # Assets statiques + presentation
├── backend/
│   ├── src/
│   │   ├── routes/    # 27 modules API REST
│   │   ├── services/  # Moteur predictif, scheduler, IA insertion
│   │   └── middleware/ # Auth JWT, RBAC, rate limiting
│   └── scripts/       # Seeds, import donnees, migrations
├── mobile/            # PWA chauffeur terrain
├── deploy/            # Scripts deploiement, nginx, backups
├── docker-compose.yml
└── docker-compose.prod.yml
```

---

## Demarrage rapide

### Prerequis
- Docker & Docker Compose
- Node.js 20+ (dev local)

### Developpement local

```bash
# Cloner le depot
git clone https://github.com/juliengonde-5G/solidata.online.git
cd solidata.online

# Copier la config
cp .env.example .env

# Lancer avec Docker
docker compose up -d

# Ou en local sans Docker
cd backend && npm install && npm run dev
cd ../frontend && npm install && npm run dev
```

L'application est accessible sur `http://localhost:5173` (frontend) et `http://localhost:3000` (API).

### Production

```bash
# Deploiement complet sur serveur
bash deploy/scripts/init-server.sh
docker compose -f docker-compose.prod.yml up -d
```

Voir [deploy/DEPLOIEMENT.md](deploy/DEPLOIEMENT.md) pour le guide complet.

---

## Roles utilisateur

| Role | Acces |
|------|-------|
| **ADMIN** | Acces complet, parametrage, BDD |
| **MANAGER** | Gestion equipes, reporting |
| **RH** | Recrutement, insertion, employes |
| **COLLABORATEUR** | Acces limite a son perimetre |
| **AUTORITE** | Consultation reporting uniquement |

---

## Documentation

| Document | Description |
|----------|-------------|
| [DOCUMENTATION_TECHNIQUE.md](DOCUMENTATION_TECHNIQUE.md) | Reference technique complete (architecture, API, BDD, deploiement) |
| [RECONSTRUCTION.md](RECONSTRUCTION.md) | Pack de reconstruction depuis zero |
| [CHANGELOG.md](CHANGELOG.md) | Historique des versions |
| [deploy/DEPLOIEMENT.md](deploy/DEPLOIEMENT.md) | Guide de deploiement production |

---

## Historique des versions

Voir [CHANGELOG.md](CHANGELOG.md) pour le detail complet.

**Version actuelle : 1.2.0** (13 mars 2026)

---

## Licence

Projet proprietaire — Solidarite Textiles / juliengonde-5G

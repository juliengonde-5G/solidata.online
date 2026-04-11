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
**Mobile :** https://m.solidata.online

---

## Modules (25)

| # | Module | Description |
|---|--------|-------------|
| 1 | **Auth & Admin** | JWT, 5 roles (ADMIN/MANAGER/RH/COLLABORATEUR/AUTORITE), parametrage |
| 2 | **Recrutement** | Kanban candidatures, parsing CV, test PCM (6 profils), workflow embauche |
| 3 | **Parcours Insertion** | Diagnostic CIP, jalons M1/M6/M12, 7 freins peripheriques, moteur IA |
| 4 | **Collecte IA** | Prediction remplissage (meteo, saisonnalite, evenements), optimisation tournees OSRM+2-opt |
| 5 | **CAV & GPS** | Carte PostGIS, QR codes, GPS temps reel, 209 conteneurs |
| 6 | **Stock moderne** | Mouvements entree/sortie par categorie, inventaire physique, reconciliation tournees |
| 7 | **Stock original** | Suivi brut collecte, grand livre, regularisation, verrouillage trimestriel Refashion |
| 8 | **Tri & Production** | 2 chaines, batch tracking, code-barres, KPI productivite |
| 9 | **Expeditions** | Flux vers exutoires, bons de livraison, conteneurs |
| 10 | **Facturation** | Factures HT/TVA/TTC, statuts brouillon→payee |
| 11 | **Logistique Exutoires** | Workflow commande 8 statuts, preparation, pesee, Gantt, calendrier |
| 12 | **Reporting** | Collecte, Production, RH, Metropole, Refashion |
| 13 | **RH** | Employes, contrats, heures, competences, planning hebdo 4 filieres |
| 14 | **Finance** | P&L analytique, bilan, tresorerie, controle de gestion, Pennylane |
| 15 | **Flotte Vehicules** | Maintenance preventive, alertes km/date, controle technique |
| 16 | **IA Predictive** | Facteurs saisonniers, meteo, apprentissage ML V2, export training data |
| 17 | **Insertion IA** | Analyse parcours, recommandations CIP (Claude API) |
| 18 | **SolidataBot** | Chat IA conversationnel (Claude API), contexte ERP complet |
| 19 | **RGPD** | Registre traitements, audit log, consentements, anonymisation |
| 20 | **Notifications** | SMS/email via Brevo, triggers automatiques |
| 21 | **Pointage** | Gestion pointages employes |
| 22 | **NewsFeed** | Articles categorises, epinglage |
| 23 | **Referentiels** | Associations, exutoires, catalogue produits, conteneurs |
| 24 | **Admin DB** | Backup/restore, VACUUM, purge, statistiques |
| 25 | **PCM** | Test personnalite 20 questions, 6 types, scoring pondere, export PDF |

---

## Stack technique

```
Frontend      React 18.3 + Vite 6 + TailwindCSS + Recharts + Leaflet — 66 pages
Backend       Node.js 20 + Express 4.21 — 63 fichiers de routes
BDD           PostgreSQL 15 + PostGIS 3.4 — 70+ tables
Cache/Queue   Redis 7 + BullMQ
Infra         Docker Compose (8 services) + Nginx SSL + Let's Encrypt
Mobile        PWA React — 11 pages chauffeur
IA            Claude API (Anthropic) — chat, insertion, predictif, vehicules
Notifications Brevo API (SMS + email)
Securite      JWT + AES-256 (PCM) + Helmet + RBAC (5 roles) + rate limiting
```

---

## Structure du projet

```
solidata.online/
├── frontend/          # Application React (Vite) — 66 pages
│   └── src/
│       ├── pages/     # Pages React (Dashboard, Tours, Stock, Finance...)
│       ├── components/
│       ├── contexts/  # AuthContext (JWT + refresh)
│       └── services/  # api.js (Axios)
├── backend/
│   └── src/
│       ├── routes/    # 63 modules API REST (dont tours/, candidates/, insertion/)
│       ├── services/  # predictive-ai.js, insertion-ai.js, ml-model.js
│       └── middleware/ # auth.js (JWT/RBAC), activity-logger.js
├── mobile/            # PWA chauffeur terrain (11 pages)
├── ai-agent/          # SolidataBot Flask (optionnel)
├── deploy/            # Scripts deploiement, nginx, backups
├── docs/              # Documentation technique et fonctionnelle
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

# Configurer l'environnement
cp backend/.env.example backend/.env
# Editer backend/.env (DB_PASSWORD, JWT_SECRET, ANTHROPIC_API_KEY...)

# Lancer avec Docker
docker compose up -d

# Ou en local sans Docker
cd backend && npm install && npm run dev
cd ../frontend && npm install && npm run dev
```

- Frontend : `http://localhost:5173`
- API : `http://localhost:3001`

### Production

```bash
bash deploy/scripts/init-server.sh
docker compose -f docker-compose.prod.yml up -d
```

Voir [deploy/DEPLOIEMENT.md](deploy/DEPLOIEMENT.md) pour le guide complet.

---

## Roles utilisateur

| Role | Acces |
|------|-------|
| **ADMIN** | Acces complet, parametrage, BDD |
| **MANAGER** | Gestion equipes, reporting, tournees |
| **RH** | Recrutement, insertion, employes |
| **COLLABORATEUR** | Acces limite a son perimetre |
| **AUTORITE** | Consultation reporting uniquement |

---

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](CLAUDE.md) | Instructions pour agents IA — contexte complet du projet |
| [DOCUMENTATION_TECHNIQUE.md](DOCUMENTATION_TECHNIQUE.md) | Architecture complete, BDD, API, deploiement |
| [docs/VARIABLES_APPLICATION.md](docs/VARIABLES_APPLICATION.md) | Toutes les variables d'environnement |
| [docs/LOGIQUE_TOURNEES.md](docs/LOGIQUE_TOURNEES.md) | Logique complete du module collecte/tournees |
| [docs/LOGIQUE_STOCK_INVENTAIRES.md](docs/LOGIQUE_STOCK_INVENTAIRES.md) | Logique complete des modules de stock |
| [RECONSTRUCTION.md](RECONSTRUCTION.md) | Procedure de reconstruction depuis zero |
| [deploy/DEPLOIEMENT.md](deploy/DEPLOIEMENT.md) | Guide de deploiement production |

---

## Version actuelle : 1.3.3 (11 avril 2026)

- Module Stock Original (grand livre, regularisation, verrouillage Refashion)
- 2 nouvelles pages : AdminStockOriginal, InventaireOriginal
- Fix mobile : navigation incidents, checklist, erreurs silencieuses
- Documentation : logique tournees, stock, variables

---

## Licence

Projet proprietaire — Solidarite Textiles / juliengonde-5G

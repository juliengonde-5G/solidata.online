# SOLIDATA ERP — Documentation Technique Complète

> **Fichier de référence officiel du projet.** Toute évolution technique, déploiement et maintenance doit s’appuyer sur ce document.

**Application :** SOLIDATA ERP — Logiciel de gestion pour Solidarité Textiles  
**Version :** 1.0.0  
**Date :** 8 mars 2026  
**Domaine :** https://solidata.online  
**Dépôt GitHub :** https://github.com/juliengonde-5G/solidata.online  

---

## TABLE DES MATIÈRES

1. [Présentation générale](#1-présentation-générale)
2. [Architecture technique](#2-architecture-technique)
3. [Stack technologique](#3-stack-technologique)
4. [Infrastructure serveur](#4-infrastructure-serveur)
5. [Structure du projet](#5-structure-du-projet)
6. [Modules fonctionnels](#6-modules-fonctionnels)
7. [Base de données](#7-base-de-données)
8. [API Backend — Routes](#8-api-backend--routes)
9. [Application Web (Frontend)](#9-application-web-frontend)
10. [Application Mobile (PWA)](#10-application-mobile-pwa)
11. [Configuration Nginx & SSL](#11-configuration-nginx--ssl)
12. [Sécurité](#12-sécurité)
13. [Variables d'environnement](#13-variables-denvironnement)
14. [Déploiement — Guide pas à pas](#14-déploiement--guide-pas-à-pas)
15. [Opérations courantes](#15-opérations-courantes)
16. [Sauvegarde et restauration](#16-sauvegarde-et-restauration)
17. [Monitoring et santé](#17-monitoring-et-santé)
18. [Tâches planifiées (Cron)](#18-tâches-planifiées-cron)
19. [Accès et rôles utilisateur](#19-accès-et-rôles-utilisateur)
20. [Données métier pré-chargées](#20-données-métier-pré-chargées)
21. [Annexes](#21-annexes)

---

## 1. Présentation générale

SOLIDATA est un **ERP (Enterprise Resource Planning)** conçu pour **Solidarité Textiles**, une structure d'insertion par l'activité économique spécialisée dans la collecte, le tri et la valorisation de textiles usagés en Normandie (Rouen).

L'application couvre l'ensemble de la chaîne d'activité :
- **Recrutement** et évaluation des candidats (Kanban, tests de personnalité PCM)
- **Gestion RH** des salariés en insertion (contrats, compétences, parcours d'insertion)
- **Collecte** de textiles via des Conteneurs d'Apport Volontaire (CAV) avec optimisation IA des tournées
- **Suivi GPS temps réel** des véhicules de collecte (WebSocket)
- **Tri et Production** avec chaînes de tri configurables
- **Stock** et traçabilité code-barres des produits finis
- **Expéditions** vers des exutoires (recyclage, réemploi, VAK export)
- **Reporting** multi-axes (collecte, production, RH) et conformité **Refashion** (éco-organisme)
- **Facturation**

L'application se compose de **deux interfaces** :
- **Interface Web** (desktop) : pour les managers, RH et administrateurs
- **Interface Mobile** (PWA) : pour les chauffeurs-collecteurs sur le terrain

---

## 2. Architecture technique

```
Internet (utilisateurs)
       │
       ├── :80  → Nginx (redirection automatique vers HTTPS)
       └── :443 → Nginx SSL (certificat Let's Encrypt)
                    │
                    ├── solidata.online        → Frontend React (conteneur Nginx)
                    ├── www.solidata.online     → Frontend React (idem)
                    ├── m.solidata.online       → Mobile PWA React (conteneur Nginx)
                    │
                    ├── /api/*                 → Backend Node.js Express (:3001)
                    ├── /socket.io/*           → WebSocket temps réel (:3001)
                    └── /uploads/*             → Fichiers uploadés (:3001)
                                                    │
                                                    └── PostgreSQL 15 + PostGIS 3.4
```

**6 conteneurs Docker** en production :

| Conteneur | Image | Rôle | Port interne | Mémoire max |
|-----------|-------|------|-------------|-------------|
| `solidata-db` | `postgis/postgis:15-3.4` | Base de données PostgreSQL + extensions spatiales | 5432 | 512 Mo |
| `solidata-api` | Build `./backend` | API REST Node.js + WebSocket | 3001 | 512 Mo |
| `solidata-web` | Build `./frontend` | Interface web React (servi par Nginx) | 80 | 128 Mo |
| `solidata-mobile` | Build `./mobile` | PWA mobile React (servi par Nginx) | 80 | 128 Mo |
| `solidata-proxy` | `nginx:alpine` | Reverse proxy SSL, routing, rate limiting | 80, 443 | 64 Mo |
| `solidata-certbot` | `certbot/certbot` | Renouvellement automatique certificat SSL | - | - |

**Réseau Docker :** `solidata-network` (bridge interne)

**Volumes Docker persistants :**

| Volume | Contenu |
|--------|---------|
| `solidata-pgdata` | Données PostgreSQL |
| `solidata-uploads` | Fichiers uploadés (CV, photos, etc.) |
| `solidata-certbot-etc` | Certificats SSL Let's Encrypt |
| `solidata-certbot-var` | Données Certbot |
| `solidata-certbot-webroot` | Challenge ACME (validation SSL) |

---

## 3. Stack technologique

### Backend
| Technologie | Version | Usage |
|------------|---------|-------|
| **Node.js** | 20 (Alpine) | Runtime serveur |
| **Express** | 4.21 | Framework API REST |
| **PostgreSQL** | 15 | Base de données relationnelle |
| **PostGIS** | 3.4 | Extension géospatiale (calcul distances, itinéraires) |
| **Socket.io** | 4.8 | WebSocket temps réel (GPS, notifications) |
| **JSON Web Token** | 9.0 | Authentification (access + refresh tokens) |
| **bcryptjs** | 2.4 | Hachage des mots de passe |
| **multer** | 1.4 | Upload de fichiers |
| **exceljs / xlsx** | - | Import/export Excel |
| **pdfkit** | 0.15 | Génération PDF |
| **pdf-parse** | 2.4 | Extraction texte des CV PDF |
| **tesseract.js** | 7.0 | OCR (reconnaissance de texte dans images) |
| **qrcode** | 1.5 | Génération QR codes (CAV) |
| **xml2js** | 0.6 | Parsing fichiers KML (cartographie) |
| **crypto-js** | 4.2 | Chiffrement AES-256 (rapports PCM) |

### Frontend Web
| Technologie | Version | Usage |
|------------|---------|-------|
| **React** | 18.3 | Framework UI |
| **Vite** | 6.0 | Build tool & dev server |
| **React Router** | 7.1 | Navigation SPA |
| **Tailwind CSS** | 3.4 | Framework CSS utilitaire |
| **Axios** | 1.7 | Client HTTP |
| **Leaflet / React-Leaflet** | 1.9 / 4.2 | Cartographie interactive |
| **Recharts** | 2.15 | Graphiques et visualisations |
| **Socket.io Client** | 4.8 | WebSocket côté client |

### Frontend Mobile (PWA)
| Technologie | Version | Usage |
|------------|---------|-------|
| **React** | 18.3 | Framework UI |
| **Vite** | 6.0 | Build tool |
| **vite-plugin-pwa** | 0.21 | Progressive Web App (installation, offline) |
| **Tailwind CSS** | 3.4 | Framework CSS |
| **Leaflet / React-Leaflet** | 1.9 / 4.2 | Carte de tournée |
| **html5-qrcode** | 2.3 | Scan QR codes via caméra |
| **Socket.io Client** | 4.8 | GPS temps réel |

### Infrastructure
| Technologie | Usage |
|------------|-------|
| **Docker** + **Docker Compose** | Conteneurisation et orchestration |
| **Nginx** (Alpine) | Reverse proxy, SSL termination, cache statique |
| **Let's Encrypt** (Certbot) | Certificats SSL gratuits, renouvellement auto |
| **Scaleway DEV1-S** | Hébergement VPS (2 vCPU, 2 Go RAM, 20 Go SSD) |
| **Ubuntu 22.04 LTS** | Système d'exploitation serveur |
| **UFW** | Pare-feu (ports 22, 80, 443) |
| **Fail2ban** | Protection brute-force SSH |

---

## 4. Infrastructure serveur

### Serveur de production

| Paramètre | Valeur |
|-----------|--------|
| **Hébergeur** | Scaleway |
| **Type** | DEV1-S (minimum) |
| **IP** | 51.159.144.100 |
| **OS** | Ubuntu 22.04 LTS |
| **CPU** | 2 vCPU |
| **RAM** | 2 Go |
| **Disque** | 20 Go SSD |
| **Répertoire application** | `/opt/solidata.online` |
| **Répertoire backups** | `/opt/solidata.online-backups` |
| **Utilisateur système** | `solidata` (groupe `docker`) |

### Configuration DNS

3 enregistrements A chez Scaleway DNS :

```
A    solidata.online      → 51.159.144.100
A    www.solidata.online   → 51.159.144.100
A    m.solidata.online     → 51.159.144.100
```

### Ports ouverts (UFW)

| Port | Service |
|------|---------|
| 22 | SSH |
| 80 | HTTP (redirigé vers 443) |
| 443 | HTTPS |

---

## 5. Structure du projet

```
solidata.online/
├── .env.example                   # Template variables d'environnement
├── .env.production                # Variables production (template)
├── .env                           # Variables actives (NON versionné)
├── .gitignore
├── docker-compose.yml             # Configuration développement
├── docker-compose.prod.yml        # Configuration production
│
├── backend/                       # API Node.js Express
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js               # Point d'entrée, routes, Socket.io
│       ├── config/
│       │   └── database.js        # Pool de connexion PostgreSQL
│       ├── middleware/
│       │   └── auth.js            # Vérification JWT
│       ├── routes/                # 22 fichiers de routes API
│       │   ├── auth.js            # Authentification (login, register, refresh)
│       │   ├── users.js           # Gestion utilisateurs
│       │   ├── settings.js        # Paramètres application
│       │   ├── candidates.js      # Recrutement Kanban
│       │   ├── pcm.js             # Test personnalité Process Com
│       │   ├── teams.js           # Équipes
│       │   ├── employees.js       # Salariés
│       │   ├── cav.js             # Conteneurs d'Apport Volontaire
│       │   ├── vehicles.js        # Véhicules
│       │   ├── tours.js           # Tournées de collecte
│       │   ├── stock.js           # Mouvements de stock
│       │   ├── production.js      # Production quotidienne
│       │   ├── billing.js         # Facturation
│       │   ├── reporting.js       # Reporting
│       │   ├── exports.js         # Export Excel/PDF
│       │   ├── tri.js             # Chaîne de tri
│       │   ├── produits-finis.js   # Produits finis (code-barres)
│       │   ├── expeditions.js     # Expéditions vers exutoires
│       │   ├── refashion.js       # Reporting éco-organisme Refashion
│       │   ├── referentiels.js    # Référentiels métier
│       │   ├── insertion.js       # Parcours d'insertion IA
│       │   └── notifications.js   # SMS/Email via Brevo
│       └── scripts/               # Scripts d'initialisation
│           ├── init-db.js         # Création tables + données initiales
│           ├── seed-cav.js        # Import CAV depuis fichier Excel
│           ├── seed-data.js       # Données de démonstration
│           └── seed-production.js # Données production exemple
│
├── frontend/                      # Application web React
│   ├── Dockerfile                 # Build multi-stage (Node → Nginx)
│   ├── nginx.conf                 # Config Nginx interne au conteneur
│   ├── package.json
│   └── src/
│       ├── main.jsx               # Point d'entrée React
│       ├── App.jsx                # Routeur + routes protégées
│       ├── index.css              # Styles globaux + Tailwind
│       ├── contexts/
│       │   └── AuthContext.jsx    # Contexte authentification
│       ├── services/
│       │   └── api.js             # Client Axios configuré
│       ├── components/
│       │   └── Layout.jsx         # Sidebar + header + navigation
│       └── pages/                 # 28 pages
│           ├── Login.jsx
│           ├── Dashboard.jsx
│           ├── Candidates.jsx     # Kanban recrutement
│           ├── PersonalityMatrix.jsx
│           ├── PCMTest.jsx        # Test PCM autonome (token)
│           ├── Employees.jsx
│           ├── WorkHours.jsx
│           ├── Skills.jsx
│           ├── InsertionParcours.jsx  # Parcours d'insertion IA
│           ├── Tours.jsx
│           ├── CAVMap.jsx         # Carte des CAV (Leaflet)
│           ├── Vehicles.jsx
│           ├── LiveVehicles.jsx   # Suivi GPS temps réel
│           ├── Production.jsx
│           ├── ChaineTri.jsx
│           ├── Stock.jsx
│           ├── ProduitsFinis.jsx
│           ├── Expeditions.jsx
│           ├── ReportingCollecte.jsx
│           ├── ReportingProduction.jsx
│           ├── ReportingRH.jsx
│           ├── Refashion.jsx
│           ├── Billing.jsx
│           ├── Users.jsx
│           ├── Settings.jsx
│           ├── Referentiels.jsx
│           └── AdminPredictive.jsx  # Administration moteur prédictif
│
├── mobile/                        # Application mobile PWA
│   ├── Dockerfile                 # Build multi-stage (Node → Nginx)
│   ├── nginx.conf
│   ├── package.json
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                # Routeur mobile
│       ├── index.css
│       ├── contexts/
│       │   └── AuthContext.jsx
│       ├── services/
│       ├── components/
│       ├── utils/
│       └── pages/                 # 11 pages (parcours chauffeur)
│           ├── Login.jsx
│           ├── VehicleSelect.jsx  # Sélection véhicule
│           ├── Checklist.jsx      # Checklist véhicule avant départ
│           ├── TourMap.jsx        # Carte de tournée avec GPS
│           ├── QRScanner.jsx      # Scan QR code du CAV
│           ├── FillLevel.jsx      # Saisie niveau de remplissage
│           ├── QRUnavailable.jsx  # CAV indisponible
│           ├── Incident.jsx       # Déclaration d'incident
│           ├── ReturnCentre.jsx   # Retour au centre de tri
│           ├── WeighIn.jsx        # Pesée à l'arrivée
│           └── TourSummary.jsx    # Résumé de tournée
│
└── deploy/                        # Configuration déploiement
    ├── DEPLOIEMENT.md             # Guide de déploiement
    ├── solidata.service           # Service systemd
    ├── crontab.txt                # Tâches planifiées
    ├── backups/                   # Répertoire backups local
    ├── nginx/
    │   ├── nginx.conf             # Config Nginx principale
    │   └── conf.d/
    │       ├── solidata.conf      # Vhosts solidata.online + m.solidata.online
    │       └── solidata-initial.conf.disabled  # Config HTTP temporaire (1er deploy)
    └── scripts/
        ├── init-server.sh         # Initialisation serveur (purge + install Docker)
        ├── deploy.sh              # Déploiement (first|update|restart|stop|logs|status)
        ├── backup.sh              # Sauvegarde BDD + uploads
        ├── restore.sh             # Restauration BDD
        └── health-check.sh        # Vérification santé (cron 5 min)
```

---

## 6. Modules fonctionnels

### Module 1 — Authentification & Administration
- Connexion JWT (access token 8h + refresh token 7j)
- 5 rôles : `ADMIN`, `MANAGER`, `RH`, `COLLABORATEUR`, `AUTORITE`
- Gestion des utilisateurs
- Paramètres de l'application (nom, adresse, SIRET, objectifs production)
- Templates de messages SMS/Email

### Module 2 — Recrutement
- **Kanban visuel** à 5 colonnes : Reçu → Présélectionné → Entretien → Test → Embauché
- Upload et parsing automatique de CV (PDF → texte)
- Détection de compétences par mots-clés
- Historique des mouvements candidat
- Association aux postes ouverts (avec slots disponibles/pourvus)

### Module 3 — Tests de personnalité (PCM - Process Communication Model)
- Sessions de test autonomes (lien avec token unique) ou accompagnées
- Questionnaire multi-étapes
- Rapports chiffrés AES-256 (données sensibles)
- Identification base/phase de personnalité
- Alertes risques

### Module 4 — Gestion RH
- Fiches employés (coordonnées, photo, compétences)
- Contrats (CDI, CDD, intérim, stage, apprentissage) avec durée et renouvellement
- 6 équipes : Tri, Collecte, Logistique, Btq St Sever, Btq L'Hôpital, Administration
- Planning hebdomadaire (travail, formation, repos, congé, VAK)
- Saisie et validation des heures travaillées
- Matrice de compétences
- **Parcours d'insertion IA** : moteur prédictif d'accompagnement personnalisé

### Module 5 — Collecte
- **CAV** (Conteneurs d'Apport Volontaire) géolocalisés avec QR codes uniques
- Import des CAV depuis fichier Excel et KML (cartographie)
- Carte interactive Leaflet avec tous les points de collecte
- **Véhicules** : immatriculation, capacité (3,5 t par défaut), statut, kilométrage
- **Tournées** en 3 modes :
  - `intelligent` : optimisation IA basée sur les niveaux de remplissage prédits
  - `standard` : itinéraire prédéfini
  - `manual` : sélection manuelle des CAV
- **Suivi GPS temps réel** via WebSocket (positions enregistrées en base)
- Checklist véhicule avant départ
- Scan QR code à chaque CAV + saisie niveau de remplissage (0-5)
- Déclaration d'incidents (panne, accident, problème CAV, environnement)
- Pesée au retour au centre de tri
- Historique des tonnages collectés

### Module 6 — Tri & Production
- **Chaînes de tri** configurables (Qualité + Recyclage Exclusif)
- Opérations séquencées : Crackage 1 → Crackage 2 → Recyclage → Réemploi → Tri Fin
- Postes par opération avec compétences requises
- Sorties par opération (produit fini, recyclage, CSR, vers autre opération, exutoire direct)
- **Production quotidienne** : effectifs, entrées ligne, recyclage R3, productivité kg/personne
- **Produits finis** : code-barres unique, catalogue produit, poids, genre, saison, gamme

### Module 7 — Stock & Expéditions
- Mouvements de stock (entrée/sortie) avec code-barres
- Catégories de matières et destinations
- 17 catégories sortantes (chiffons, CSR, originaux, pré-classé, effilochage, VAK)
- **Expéditions** vers exutoires avec bon de livraison, types de conteneurs (balles, cartons, bobines, sacs, remorques)

### Module 8 — Reporting & Refashion
- **Reporting Collecte** : tonnages par période, par CAV, par commune
- **Reporting Production** : KPI journaliers, productivité, objectifs
- **Reporting RH** : heures travaillées, types de contrats, formation
- **Refashion (éco-organisme)** :
  - Déclaration DPAV trimestrielle (stock, achats, ventes réemploi/recyclage, CSR, énergie)
  - Ventilation par commune
  - Calcul automatique des subventions (taux : réemploi 80€/t, recyclage 295€/t, CSR 210€/t, énergie 20€/t, entrée 193€/t)
  - Vérification conformité cahier des charges

### Module 9 — Facturation
- Création de factures (brouillon, envoyée, payée, en retard, annulée)
- Lignes de facture avec prix unitaire et quantité
- Calcul automatique HT / TVA / TTC

### Module 10 — Intelligence Artificielle
- **Moteur prédictif de remplissage** des CAV (ML)
- Optimisation des tournées basée sur les prédictions
- Historique des prédictions et métadonnées du modèle
- **Moteur d'insertion** : parcours d'accompagnement personnalisé par salarié

---

## 7. Base de données

### Moteur
- **PostgreSQL 15** avec extension **PostGIS 3.4** (données géospatiales)
- Base : `solidata`
- Utilisateur : `solidata_user`
- Mot de passe : défini dans `.env` (`DB_PASSWORD`)

### Tables (37 tables)

#### Authentification (4 tables)
| Table | Description |
|-------|-------------|
| `users` | Utilisateurs (username, email, rôle, équipe) |
| `refresh_tokens` | Tokens de rafraîchissement JWT |
| `settings` | Paramètres clé/valeur par catégorie |
| `message_templates` | Templates SMS/email (recrutement, etc.) |

#### Recrutement (3 tables)
| Table | Description |
|-------|-------------|
| `candidates` | Candidats (statut Kanban, CV, permis, CACES) |
| `candidate_history` | Historique des changements de statut |
| `candidate_skills` | Compétences détectées/confirmées par candidat |
| `skill_keywords` | Mots-clés pour détection automatique de compétences |

#### PCM (3 tables)
| Table | Description |
|-------|-------------|
| `pcm_sessions` | Sessions de test (autonome/accompagné, token) |
| `pcm_answers` | Réponses aux questions PCM |
| `pcm_reports` | Rapports chiffrés AES-256 (base/phase) |

#### Équipes & Planning (6 tables)
| Table | Description |
|-------|-------------|
| `teams` | 6 équipes (tri, collecte, logistique, btq×2, admin) |
| `employees` | Salariés (photo, contrat, compétences, heures) |
| `positions` | Postes à pourvoir (slots ouverts/pourvus) |
| `employee_contracts` | Contrats (CDI/CDD/intérim/stage/apprentissage, 26h ou 35h) |
| `employee_availability` | Jours d'indisponibilité hebdomadaire |
| `schedule` | Planning journalier (travail/formation/repos/congé/VAK) |
| `work_hours` | Heures travaillées + heures sup |

#### Collecte (10 tables)
| Table | Description |
|-------|-------------|
| `cav` | Conteneurs d'Apport Volontaire (géoloc PostGIS, QR code, statut) |
| `vehicles` | Véhicules (immatriculation, capacité, kilométrage) |
| `standard_routes` | Routes-types prédéfinies |
| `standard_route_cav` | CAV associés à chaque route-type (avec position) |
| `tours` | Tournées de collecte (date, mode, statut, poids total) |
| `tour_cav` | CAV visités par tournée (statut, niveau, QR, photo) |
| `tour_weights` | Pesées au retour |
| `incidents` | Incidents (panne, accident, problème CAV) |
| `gps_positions` | Positions GPS temps réel (indexé par tournée et date) |
| `tonnage_history` | Historique tonnages par date/CAV/route |
| `vehicle_checklists` | Checklists véhicule (extérieur, carburant, km) |

#### Stock (3 tables)
| Table | Description |
|-------|-------------|
| `matieres` | Catalogue matières (catégorie, qualité, destinations) |
| `stock_movements` | Entrées/sorties stock avec code-barres |
| `flux_sortants` | Flux sortants (vente, recyclage, upcycling, VAK) |

#### Facturation (2 tables)
| Table | Description |
|-------|-------------|
| `invoices` | Factures (numéro, client, montants HT/TVA/TTC, statut) |
| `invoice_lines` | Lignes de facture |

#### Production & Reporting (2 tables)
| Table | Description |
|-------|-------------|
| `production_daily` | Production journalière (effectifs, entrées, productivité) |
| `reporting_refashion` | Reporting trimestriel Refashion |

#### Référentiels Tri (7 tables)
| Table | Description |
|-------|-------------|
| `associations` | Associations partenaires |
| `exutoires` | Destinataires des expéditions (recycleurs, etc.) |
| `produits_catalogue` | Catalogue produits finis (éco-org, genre, saison, gamme) |
| `categories_sortantes` | 17 catégories de sortie (chiffons, CSR, originaux, VAK...) |
| `types_conteneurs` | Types de conteneurs (balles, cartons, bobines, sacs, remorques) |
| `chaines_tri` | Chaînes de tri (Qualité, Recyclage Exclusif) |
| `operations_tri` | Opérations de tri séquencées |
| `postes_operation` | Postes par opération (compétences requises) |
| `sorties_operation` | Sorties possibles par opération |
| `produits_finis` | Produits finis avec code-barres et traçabilité |
| `expeditions` | Expéditions vers exutoires |

#### Refashion (3 tables)
| Table | Description |
|-------|-------------|
| `refashion_dpav` | Déclaration trimestrielle (stocks, achats, ventes, CSR) |
| `refashion_communes` | Ventilation par commune |
| `refashion_subventions` | Calcul subventions par taux |

#### IA / ML (2 tables)
| Table | Description |
|-------|-------------|
| `ml_fill_predictions` | Prédictions de remplissage CAV |
| `ml_model_metadata` | Métadonnées des modèles IA |

### Index spatiaux et de performance
- `idx_cav_geom` — Index GIST sur la géométrie des CAV
- `idx_cav_status` — Index sur le statut des CAV
- `idx_gps_tour` — Index sur les positions GPS par tournée
- `idx_gps_time` — Index sur les positions GPS par date

### Initialisation automatique
Au démarrage, le backend vérifie le nombre de tables. Si moins de 5 tables existent, le script `init-db.js` crée automatiquement toutes les tables et insère les données initiales.

---

## 8. API Backend — Routes

Base URL : `https://solidata.online/api`

| Préfixe | Fichier | Description |
|---------|---------|-------------|
| `/api/auth` | `auth.js` | Login, register, refresh token, profil |
| `/api/users` | `users.js` | CRUD utilisateurs |
| `/api/settings` | `settings.js` | Paramètres application |
| `/api/candidates` | `candidates.js` | Kanban recrutement, upload CV, parsing |
| `/api/pcm` | `pcm.js` | Sessions de test PCM, questionnaire, rapports |
| `/api/teams` | `teams.js` | Gestion des équipes |
| `/api/employees` | `employees.js` | Fiches salariés, contrats, disponibilités |
| `/api/cav` | `cav.js` | CRUD CAV, import Excel/KML, QR codes |
| `/api/vehicles` | `vehicles.js` | CRUD véhicules |
| `/api/tours` | `tours.js` | Tournées (création, démarrage, clôture, IA) |
| `/api/stock` | `stock.js` | Mouvements de stock, code-barres |
| `/api/production` | `production.js` | Saisie production quotidienne |
| `/api/billing` | `billing.js` | Factures et lignes |
| `/api/reporting` | `reporting.js` | KPI et statistiques |
| `/api/exports` | `exports.js` | Export Excel/PDF |
| `/api/tri` | `tri.js` | Chaînes de tri, opérations, postes |
| `/api/produits-finis` | `produits-finis.js` | Produits finis, scan code-barres |
| `/api/expeditions` | `expeditions.js` | Expéditions vers exutoires |
| `/api/refashion` | `refashion.js` | Reporting Refashion (DPAV, communes, subventions) |
| `/api/referentiels` | `referentiels.js` | Exutoires, associations, catégories, catalogue |
| `/api/insertion` | `insertion.js` | Parcours d'insertion IA |
| `/api/notifications` | `notifications.js` | Envoi SMS/email via Brevo |

### Health check
`GET /api/health` — Retourne l'état de la base, la version PostgreSQL/PostGIS et les modules actifs.

### WebSocket (Socket.io)

| Événement | Direction | Description |
|-----------|-----------|-------------|
| `join-tour` | Client → Serveur | Rejoindre la room d'une tournée |
| `gps-update` | Client → Serveur | Position GPS du chauffeur (enregistrée en base) |
| `vehicle-position` | Serveur → Clients | Broadcast position véhicule |
| `cav-collected` | Client → Serveur | CAV collecté |
| `cav-status-update` | Serveur → Clients | Mise à jour statut CAV |
| `tour-status` | Client → Serveur | Changement statut tournée |
| `tour-status-update` | Serveur → Clients | Broadcast statut tournée |

---

## 9. Application Web (Frontend)

URL : `https://solidata.online`

### Pages et accès par rôle

| Page | Route | Rôles autorisés | Description |
|------|-------|-----------------|-------------|
| Connexion | `/login` | Tous | Page de login |
| Dashboard | `/` | Tous | Tableau de bord principal |
| Candidats | `/candidates` | ADMIN, RH | Kanban recrutement |
| PCM | `/pcm` | ADMIN, RH | Sessions test personnalité |
| Test PCM | `/pcm-test/:token` | Public (token) | Passage du test PCM |
| Employés | `/employees` | ADMIN, RH, MANAGER | Fiches salariés |
| Heures | `/work-hours` | ADMIN, RH, MANAGER | Saisie heures travaillées |
| Compétences | `/skills` | ADMIN, RH, MANAGER | Matrice compétences |
| Insertion | `/insertion` | ADMIN, RH, MANAGER | Parcours d'insertion IA |
| Tournées | `/tours` | ADMIN, MANAGER | Planification tournées |
| Carte CAV | `/cav-map` | ADMIN, MANAGER | Carte interactive des CAV |
| Véhicules | `/vehicles` | ADMIN, MANAGER | Gestion flotte |
| GPS Live | `/live-vehicles` | ADMIN, MANAGER | Suivi GPS temps réel |
| Production | `/production` | ADMIN, MANAGER | Production quotidienne |
| Chaîne de tri | `/chaine-tri` | ADMIN, MANAGER | Configuration chaînes |
| Stock | `/stock` | ADMIN, MANAGER | Mouvements stock |
| Produits finis | `/produits-finis` | ADMIN, MANAGER | Traçabilité code-barres |
| Expéditions | `/expeditions` | ADMIN, MANAGER | Expéditions vers exutoires |
| Reporting Collecte | `/reporting-collecte` | ADMIN, MANAGER | KPI collecte |
| Reporting RH | `/reporting-rh` | ADMIN, RH | KPI ressources humaines |
| Reporting Production | `/reporting-production` | ADMIN, MANAGER | KPI production |
| Refashion | `/refashion` | ADMIN, MANAGER | Reporting éco-organisme |
| Utilisateurs | `/users` | ADMIN | Gestion comptes |
| Paramètres | `/settings` | ADMIN | Configuration système |
| Référentiels | `/referentiels` | ADMIN | Exutoires, catalogue, catégories |
| Moteur prédictif | `/admin-predictive` | ADMIN | Administration IA |

---

## 10. Application Mobile (PWA)

URL : `https://m.solidata.online`

Application **Progressive Web App** installable sur téléphone, conçue pour les **chauffeurs-collecteurs** sur le terrain.

### Parcours utilisateur mobile

```
1. Login
   ↓
2. Sélection véhicule
   ↓
3. Checklist véhicule (extérieur OK, niveau carburant, km départ)
   ↓
4. Carte de tournée (GPS temps réel, itinéraire, CAV à visiter)
   ↓
   Pour chaque CAV :
   ├── 5a. Scan QR code du CAV
   │   ↓
   │   6. Saisie niveau de remplissage (0 à 5)
   │
   ├── 5b. QR indisponible → Saisie manuelle + motif
   │
   └── 5c. Incident → Déclaration (type, description, photo)
   ↓
7. Retour au centre de tri
   ↓
8. Pesée du chargement
   ↓
9. Résumé de tournée (CAV visités, poids total, incidents)
```

### Fonctionnalités clés
- **Installation sur écran d'accueil** (PWA, fonctionne hors-ligne partiellement)
- **Scan QR code** via caméra du téléphone
- **GPS en temps réel** avec envoi de positions au backend via WebSocket
- **Interface tactile** optimisée pour utilisation en extérieur

---

## 11. Configuration Nginx & SSL

### Architecture reverse proxy

Le conteneur `solidata-proxy` (Nginx Alpine) écoute sur les ports 80 et 443 et route le trafic :

```
solidata.online / www.solidata.online → conteneur frontend (port 80)
m.solidata.online                     → conteneur mobile (port 80)
*/api/*                               → conteneur backend (port 3001)
*/socket.io/*                         → conteneur backend (WebSocket)
*/uploads/*                           → conteneur backend (fichiers)
```

### Certificat SSL

- **Fournisseur** : Let's Encrypt (gratuit)
- **Outil** : Certbot (conteneur dédié)
- **Certificat** : couvre `solidata.online`, `www.solidata.online`, `m.solidata.online`
- **Emplacement** : `/etc/letsencrypt/live/solidata.online-0001/` (voir note ci-dessous)
- **Renouvellement** : automatique 2 fois/jour via cron
- **HSTS** : activé (max-age 2 ans)

> **Note importante — Chemin des certificats :**
> Certbot incrémente le nom du dossier (`solidata.online-0001`, `-0002`, etc.) si le dossier
> `live/solidata.online/` existe déjà lors de la génération. Le chemin réel est celui configuré
> dans `nginx/default.conf` et `nginx/entrypoint.sh`. En cas de régénération, vérifier et mettre
> à jour ces deux fichiers. Voir la section « Dépannage SSL » ci-dessous.

### Dépannage SSL — Certificats et Nginx

**Symptôme** : Nginx crash en boucle avec `cannot load certificate ... No such file or directory`.

**Causes possibles et résolution :**

1. **Dossier `live/` vide (symlinks cassés)** — Le dossier `live/solidata.online/` existe mais
   `archive/solidata.online/` est absent (les fichiers cert sont des symlinks vers `archive/`).
   ```bash
   # Diagnostic
   ls -la /etc/letsencrypt/live/solidata.online*/
   ls -la /etc/letsencrypt/archive/solidata.online*/ 2>/dev/null || echo "PAS D'ARCHIVE"

   # Correction : supprimer le dossier vide et régénérer
   rm -rf /etc/letsencrypt/live/solidata.online
   docker compose stop nginx
   docker run --rm -p 80:80 \
     -v /etc/letsencrypt:/etc/letsencrypt \
     certbot/certbot certonly --standalone \
     -d solidata.online -d www.solidata.online -d m.solidata.online \
     --email VOTRE_EMAIL --agree-tos --no-eff-email
   ```

2. **Chemin décalé (`-0001`, `-0002`, etc.)** — Certbot a créé les certs dans un dossier suffixé.
   ```bash
   # Vérifier le vrai chemin
   ls /etc/letsencrypt/live/

   # Mettre à jour nginx/default.conf et nginx/entrypoint.sh avec le bon chemin
   # Puis redémarrer : docker compose restart nginx
   ```

3. **Certificats expirés** — Renouveler manuellement :
   ```bash
   docker compose stop nginx
   docker run --rm -p 80:80 \
     -v /etc/letsencrypt:/etc/letsencrypt \
     certbot/certbot renew --standalone
   docker compose up -d nginx
   ```

**Sécurité** : L'entrypoint nginx (`nginx/entrypoint.sh`) génère des certificats auto-signés
temporaires si les vrais sont illisibles, pour que nginx puisse démarrer et servir le site en
HTTPS (avec avertissement navigateur) le temps de corriger.

### Rate limiting

| Zone | Limite | Usage |
|------|--------|-------|
| `api` | 30 requêtes/seconde (burst 50) | Toutes les API |
| `login` | 5 requêtes/minute (burst 3) | Endpoint de connexion uniquement |

### Headers de sécurité
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`

### Performance
- Gzip activé (niveau 6) sur : text, CSS, JSON, JavaScript, XML, SVG
- Cache statique : assets immutables cachés 1 an
- Cache uploads : 7 jours
- Upload max : 50 Mo
- Timeout WebSocket : 86 400 s (24h)
- Timeout API : 300 s (5 min)

---

## 12. Sécurité

| Mesure | Détail |
|--------|--------|
| **HTTPS obligatoire** | Redirection HTTP → HTTPS, HSTS activé |
| **Authentification JWT** | Access token (8h) + refresh token (7j) |
| **Hachage mots de passe** | bcrypt (10 rounds) |
| **Chiffrement PCM** | AES-256 via crypto-js (rapports personnalité) |
| **Rate limiting** | 30 req/s API, 5 req/min login |
| **Pare-feu UFW** | Ports 22, 80, 443 uniquement |
| **Fail2ban** | Protection brute-force SSH |
| **Headers sécurité** | X-Frame, X-Content-Type, XSS, HSTS, Referrer |
| **CORS** | Configuré (origins autorisées) |
| **Validation** | express-validator sur les entrées API |
| **Réseau Docker isolé** | Les conteneurs communiquent sur un réseau bridge interne |
| **Secrets externalisés** | Mots de passe et clés dans `.env` (non versionné) |

---

## 13. Variables d'environnement

Fichier `.env` à la racine du projet (copié depuis `.env.production`).

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DB_PASSWORD` | Mot de passe PostgreSQL | *(générer avec `openssl rand -base64 32`)* |
| `JWT_SECRET` | Secret de signature JWT | *(générer avec `openssl rand -hex 64`)* |
| `BREVO_API_KEY` | Clé API Brevo (ex-Sendinblue) pour SMS/email | *(optionnel)* |

Variables injectées automatiquement dans le conteneur backend :

| Variable | Valeur | Source |
|----------|--------|--------|
| `DB_HOST` | `db` | docker-compose |
| `DB_PORT` | `5432` | docker-compose |
| `DB_NAME` | `solidata` | docker-compose |
| `DB_USER` | `solidata_user` | docker-compose |
| `PORT` | `3001` | docker-compose |
| `NODE_ENV` | `production` | docker-compose |
| `JWT_EXPIRES_IN` | `8h` | docker-compose |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | docker-compose |
| `CENTRE_TRI_LAT` | `49.4231` | Latitude centre de tri (Rouen) |
| `CENTRE_TRI_LNG` | `1.0993` | Longitude centre de tri (Rouen) |

---

## 14. Déploiement — Guide pas à pas

### Prérequis
- Serveur **Scaleway DEV1-S** minimum (2 vCPU, 2 Go RAM, 20 Go SSD)
- **Ubuntu 22.04 LTS**
- Domaine `solidata.online` avec **3 enregistrements DNS A** pointant vers l'IP du serveur
- Accès SSH root

### Étape 1 — Initialisation du serveur

```bash
ssh root@<IP_SERVEUR>

# Script automatique (purge + install Docker + clone repo)
curl -sL https://raw.githubusercontent.com/juliengonde-5G/solidata.online/claude/solidata-erp-app-KYMZZ/deploy/scripts/init-server.sh | sudo bash
```

Le script effectue :
1. Purge complète de toute installation précédente (Docker, Nginx, PostgreSQL, Node.js)
2. Installation de Docker et Docker Compose
3. Configuration UFW + Fail2ban + Swap
4. Clone du dépôt dans `/opt/solidata.online`

### Étape 2 — Configuration des secrets

```bash
cd /opt/solidata.online

# Créer le fichier de configuration
cp .env.production .env

# Éditer les variables
nano .env
```

Modifier impérativement :
- `DB_PASSWORD` → mot de passe fort : `openssl rand -base64 32`
- `JWT_SECRET` → secret JWT : `openssl rand -hex 64`
- `BREVO_API_KEY` → si notifications SMS/email activées

### Étape 3 — Premier déploiement

```bash
bash deploy/scripts/deploy.sh first
```

Ce script automatise :
1. Build des 5 conteneurs Docker (sans cache)
2. Démarrage en HTTP temporaire
3. Obtention du certificat SSL Let's Encrypt (validation HTTP)
4. Bascule vers configuration HTTPS complète
5. Redémarrage Nginx avec SSL

### Étape 4 — Vérification

```bash
# Statut des services
bash deploy/scripts/deploy.sh status

# Health check complet
bash deploy/scripts/health-check.sh

# Logs
bash deploy/scripts/deploy.sh logs
bash deploy/scripts/deploy.sh logs backend
```

### Étape 5 — Service systemd + cron

```bash
# Démarrage automatique au boot du serveur
sudo cp deploy/solidata.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable solidata

# Tâches planifiées
crontab deploy/crontab.txt
```

### Étape 6 — Première connexion

1. Aller sur `https://solidata.online/login`
2. Se connecter avec `admin` / `admin123`
3. **CHANGER IMMÉDIATEMENT le mot de passe admin**

---

## 15. Opérations courantes

| Commande | Description |
|----------|-------------|
| `bash deploy/scripts/deploy.sh update` | Mise à jour (backup auto + git pull + rebuild) |
| `bash deploy/scripts/deploy.sh restart` | Redémarrage sans rebuild |
| `bash deploy/scripts/deploy.sh stop` | Arrêt complet |
| `bash deploy/scripts/deploy.sh status` | Statut des services + disque + volumes |
| `bash deploy/scripts/deploy.sh logs` | Logs en temps réel (tous services) |
| `bash deploy/scripts/deploy.sh logs backend` | Logs backend uniquement |
| `docker compose -f docker-compose.prod.yml exec backend npm run seed-cav` | Import CAV depuis Excel |
| `docker compose -f docker-compose.prod.yml exec backend npm run seed-data` | Données de démonstration |

---

## 16. Sauvegarde et restauration

### Sauvegarde

```bash
# Sauvegarde manuelle
bash deploy/scripts/backup.sh manual

# Sauvegarde automatique (cron quotidien à 2h)
bash deploy/scripts/backup.sh daily
```

Contenu sauvegardé :
- **Base de données** : dump PostgreSQL compressé (`.dump.gz`)
- **Fichiers uploadés** : archive tar.gz du volume `solidata-uploads`

Rétention :
- Sauvegardes `daily` : **30 jours**
- Sauvegardes `manual` : **90 jours**

Emplacement : `/opt/solidata.online-backups/`

### Restauration

```bash
# Lister les sauvegardes disponibles
bash deploy/scripts/restore.sh

# Restaurer une sauvegarde
bash deploy/scripts/restore.sh /opt/solidata.online-backups/db_manual_20260307.dump.gz

# Redémarrer le backend après restauration
docker restart solidata-api
```

---

## 17. Monitoring et santé

Le script `health-check.sh` vérifie toutes les **5 minutes** (cron) :

1. **Conteneurs Docker** : vérifie que les 5 conteneurs sont `running`, redémarre automatiquement ceux qui sont `exited`
2. **Endpoints HTTP** :
   - Frontend : `https://solidata.online` → HTTP 200
   - API : `https://solidata.online/api/auth/me` → HTTP 401 (non authentifié = normal)
   - Mobile : `https://m.solidata.online` → HTTP 200
3. **Espace disque** : alerte si > 80%, critique si > 90%
4. **Mémoire RAM** : information d'utilisation

Logs dans `/opt/solidata.online/logs/health-check.log`

### Health check API

`GET https://solidata.online/api/health` retourne :
```json
{
  "status": "ok",
  "timestamp": "2026-03-08T10:00:00Z",
  "database": {
    "connected": true,
    "version": "PostgreSQL 15.x",
    "postgis": "3.4"
  },
  "modules": {
    "auth": true, "users": true, "candidates": true,
    "pcm": true, "teams": true, "employees": true,
    "cav": true, "vehicles": true, "tours": true,
    "stock": true, "production": true, "billing": true,
    "reporting": true, "tri": true, "refashion": true
  }
}
```

---

## 18. Tâches planifiées (Cron)

| Fréquence | Commande | Description |
|-----------|----------|-------------|
| Tous les jours à 2h | `backup.sh daily` | Sauvegarde BDD + uploads |
| Toutes les 5 min | `health-check.sh` | Vérification santé + auto-restart |
| 2 fois/jour (3h, 15h) | `certbot renew` | Renouvellement certificat SSL |
| Dimanche à 4h | `docker image prune -f` | Nettoyage images Docker orphelines |
| 1er du mois à 5h | `find ... -mtime +30 -delete` | Nettoyage logs > 30 jours |

---

## 19. Accès et rôles utilisateur

### Rôles

| Rôle | Description | Accès |
|------|-------------|-------|
| `ADMIN` | Administrateur | Tout (y compris utilisateurs, paramètres, référentiels, IA) |
| `MANAGER` | Responsable de site | Collecte, production, tri, stock, expéditions, reporting |
| `RH` | Ressources Humaines | Recrutement, salariés, PCM, heures, reporting RH |
| `COLLABORATEUR` | Salarié / Chauffeur | Dashboard, application mobile |
| `AUTORITE` | Autorité de tutelle | Dashboard (lecture seule) |

### Compte par défaut
- **Identifiant** : `admin`
- **Mot de passe** : `admin123`
- **Action obligatoire** : changer le mot de passe dès la première connexion

---

## 20. Données métier pré-chargées

L'initialisation de la base crée automatiquement :

| Donnée | Quantité | Détail |
|--------|----------|--------|
| Utilisateur admin | 1 | admin / admin123 |
| Équipes | 6 | Tri, Collecte, Logistique, Btq St Sever, Btq L'Hôpital, Administration |
| Postes | 4 | Opérateur de tri, Opérateur Logistique, Chauffeur, Suiveur |
| Types de conteneurs | 5 | Balles, Cartons, Bobines, Sacs, Remorques |
| Catégories sortantes | 17 | Chiffons (3), CSR (2), Originaux (3), Pré-classé (2), Effilochage (3), Déstockage (1), VAK (3) |
| Chaînes de tri | 2 | Qualité (5 opérations), Recyclage Exclusif (1 opération) |
| Templates messages | 4 | Convocation, confirmation, refus, rappel |
| Paramètres | 11 | Nom société, adresse, coordonnées centre tri, objectifs, TVA, facteur CO2 |

### Fichiers de données fournis
- `tournee.xlsx` — Données de tournées
- `tonnages.xlsx` — Historique des tonnages collectés
- `KPI_Production 2026.xlsx` — Objectifs de production 2026
- `Carte des PAV au 28-02-2026.kml` — Localisation géographique des CAV

---

## 21. Annexes

### Commandes Docker utiles

```bash
# Voir les conteneurs
docker ps

# Logs d'un conteneur spécifique
docker logs solidata-api --tail 100 -f

# Accéder au shell d'un conteneur
docker exec -it solidata-api sh
docker exec -it solidata-db psql -U solidata_user -d solidata

# Reconstruire un seul service
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d backend

# Taille des volumes
docker system df -v
```

### Connexion directe à la base de données

```bash
docker exec -it solidata-db psql -U solidata_user -d solidata

# Exemples de requêtes
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM cav;
SELECT COUNT(*) FROM tours WHERE status = 'completed';
SELECT * FROM settings ORDER BY category, key;
\dt  -- Lister toutes les tables
\d+  -- Détails des tables avec taille
```

### Coordonnées géographiques

- **Centre de tri** : 49.4231°N, 1.0993°E (zone industrielle, Rouen)
- **Système de coordonnées** : EPSG:4326 (WGS84)

### Fichiers de configuration clés

| Fichier | Rôle |
|---------|------|
| `docker-compose.prod.yml` | Orchestration production (6 services) |
| `docker-compose.yml` | Orchestration développement (ports exposés) |
| `.env` | Secrets (NON versionné) |
| `deploy/nginx/nginx.conf` | Config Nginx principale (gzip, headers, rate limit) |
| `deploy/nginx/conf.d/solidata.conf` | Vhosts SSL (solidata.online + m.solidata.online) |
| `frontend/nginx.conf` | Nginx interne au conteneur frontend |
| `mobile/nginx.conf` | Nginx interne au conteneur mobile |
| `backend/src/scripts/init-db.js` | Création complète du schéma BDD |
| `deploy/solidata.service` | Service systemd pour démarrage auto |
| `deploy/crontab.txt` | Tâches planifiées |

### Différences développement vs production

| Aspect | Développement (`docker-compose.yml`) | Production (`docker-compose.prod.yml`) |
|--------|--------------------------------------|---------------------------------------|
| Ports exposés | Oui (3000, 3001, 3002, 5432) | Non (tout passe par Nginx) |
| SSL | Non | Oui (Let's Encrypt) |
| Reverse proxy | Non | Oui (Nginx) |
| Certbot | Non | Oui (renouvellement auto) |
| Volumes | Local (`./backend/uploads`) | Docker nommés (`solidata-uploads`) |
| Restart policy | `unless-stopped` | `always` |
| Limites mémoire | Non | Oui (64-512 Mo par service) |
| Logging | Par défaut | JSON file avec rotation (10 Mo × 5) |
| Backups | Non | Volume monté `/backups` |

---

*Document généré le 8 mars 2026 — SOLIDATA ERP v1.0.0*
*Pour toute question technique : consulter le dépôt GitHub ou contacter l'équipe de développement.*

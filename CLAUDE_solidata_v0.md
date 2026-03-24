# CLAUDE.md — My SolTex / Solidata ERP

> Fichier de référence pour Claude Code. Contient l'architecture complète, les conventions, le schéma BDD, les API, et les règles du projet.

## 1. CONTEXTE MÉTIER

**Association Solidarité Textiles** — Collecte de Textiles, Linges, Chaussures (TLC) sur la métropole de Rouen Normandie.

- **4 camions** de collecte
- **2 tournées/jour** (matin + après-midi) par véhicule
- **5 jours/semaine** (lundi-vendredi)
- **209 points de collecte** (CAV — Conteneur d'Apport Volontaire) répartis en 19 tournées standard
- **Centre de tri** au Houlme (76770) — GPS: 49.5008, 1.0506
- **~30 collaborateurs** (CDI, CDDI insertion, intérimaires)

### 3 univers applicatifs

| Univers | Description | Modules |
|---------|-------------|---------|
| 🚛 **Collecte** | Organisation des tournées, suivi terrain, pesées | CAV, Véhicules, Tournées, Carte, Mobile, Live, Pesée, Matériel, QR, Planification, Reporting |
| ♻️ **Tri & Production** | Plan d'Occupation Journalier (POJ) | POJ, Postes, Affectations, VAK |
| 👥 **Personnel** | Recrutement, test de personnalité | Kanban, PCM, Positions, Comptes |

---

## 2. STACK TECHNIQUE

### Infrastructure
- **Serveur** : VPS Scaleway (anciennement Synology DS 220+)
- **IP publique** : 82.65.155.79:8083
- **GitHub** : juliengonde-5G/solidata

### Stack
| Composant | Technologie | Port |
|-----------|-------------|------|
| Base de données | PostgreSQL 15 + PostGIS 3.4 (Alpine) | 5003 (interne 5432) |
| Backend API | Python 3.11 + FastAPI 0.109 + SQLAlchemy 2.0 (async) | 8000 (interne) |
| Frontend | React 18 + Leaflet 1.9 (SPA monolithique) | 8083 (nginx → 80) |
| Conteneurisation | Docker Compose v3.8 | — |

### Déploiement
```bash
# Depuis le répertoire solidata/
docker compose down
docker compose up -d --build
```

### URLs
- Desktop : `http://82.65.155.79:8083`
- Mobile (PWA) : `http://82.65.155.79:8083/?mobile=1`
- API docs : `http://82.65.155.79:8083/api/docs`
- Health check : `http://82.65.155.79:8083/api/health`

---

## 3. ARBORESCENCE DU PROJET

```
solidata/
├── docker-compose.yml
├── CLAUDE.md                          ← CE FICHIER
├── README.md
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── pcm_data.json                  ← Copie racine (référence)
│   └── app/
│       ├── __init__.py
│       ├── main.py                    ← Point d'entrée FastAPI + montage routers
│       ├── config.py                  ← Settings (DB, JWT, CORS, dépôt GPS)
│       ├── database.py                ← Engine async + init_db + migrations auto
│       │
│       ├── models/
│       │   ├── __init__.py            ← Imports centralisés de tous les modèles
│       │   ├── user.py                ← User, UserRole (ADMIN/MANAGER/OPERATOR/VIEWER)
│       │   ├── recruitment.py         ← PositionType, Position, Candidate, KanbanHistory, PCMTest, PCMProfile
│       │   ├── collecte.py            ← CAV, Vehicle, RouteTemplate, RouteTemplatePoint, DailyRoute, Collection, Weight, WeightHistory, VehicleChecklist, Incident, GPSTrack
│       │   └── poj.py                 ← POJCollaborateur, POJPoste, POJAffectation, POJVakEvent, POJVakPoste, POJVakAffectation
│       │
│       ├── routers/
│       │   ├── auth.py                ← POST /login, GET /me, CRUD /users (JWT)
│       │   ├── admin.py               ← CRUD /cav, /vehicles, /routes, /routes/{id}/points, /dashboard, /tonnage
│       │   ├── collect.py             ← POST /scan, /start, /finish, /gps, GET /live
│       │   ├── equipe.py              ← CRUD /collaborateurs, /planning, /disponibilite
│       │   ├── mobile.py              ← GET /mes-tournees, /tournee/{id}
│       │   ├── pesee.py               ← CRUD pesées, GET /history, /stats
│       │   ├── materiel.py            ← POST /checklist, /incident, GET /incidents
│       │   ├── reporting.py           ← GET /synthese, /export-pdf (facteurs ADEME)
│       │   ├── planification.py       ← GET /prediction, /saisonnalite, /semaine, POST /generate, /slot
│       │   ├── qrcode_router.py       ← POST /generate, GET /list, /image/{id}, /resolve/{code}, /export-pdf
│       │   ├── users.py               ← CRUD utilisateurs (admin), changement MDP
│       │   └── legacy.py              ← API Recrutement (candidates, positions, PCM, POJ) — hérité de l'ancienne app
│       │
│       ├── schemas/
│       │   └── auth.py                ← Pydantic: TokenResponse, UserResponse, LoginRequest
│       │
│       ├── services/
│       │   ├── auth.py                ← JWT encode/decode, password hashing
│       │   ├── seed.py                ← Seed admin + données initiales au démarrage
│       │   ├── import_data.py         ← Import Excel (CAV, tournées, pesées historiques)
│       │   ├── pcm_engine.py          ← Calcul profil PCM (scores, types, stress, RPS)
│       │   ├── pcm_data.json          ← 20 questions PCM enrichies (emoji, short, color) — EMPLACEMENT RÉEL
│       │   └── predictive.py          ← Modèle prédictif saisonnier (coefficients, recommandations)
│       │
│       └── utils/
│           └── __init__.py
│
└── frontend/
    ├── Dockerfile
    ├── nginx.conf                     ← Reverse proxy → backend:8000/api
    ├── package.json                   ← React 18, Leaflet, react-leaflet
    ├── public/
    │   ├── index.html                 ← Charge Poppins + Leaflet CSS depuis CDN
    │   ├── manifest.json              ← PWA manifest
    │   └── sw.js                      ← Service Worker (cache offline)
    │
    └── src/
        ├── index.js                   ← Point d'entrée React
        ├── AppWrapper.js              ← Auth wrapper (login, stockage token)
        ├── App.js                     ← App principale : routing pages, Kanban, PCM, composants partagés (1880 lignes)
        ├── HomePage.js                ← Accueil 3 univers (Collecte, Tri, Personnel)
        ├── CollecteModule.js          ← Onglets collecte : Dashboard, CAV, Véhicules, Tournées, Planification, Import
        ├── CAVPageV2.js               ← CRUD CAV, QR intégré, suspension avec motif, édition inline
        ├── RoutesPageV2.js            ← Tournées standard : vue split, ajout/suppression CAV
        ├── MapModule.js               ← Carte Leaflet : tous les CAV, tournées, itinéraires
        ├── MobileModule.js            ← PWA mobile : liste tournées, carte nav, scan QR caméra, saisie collecte
        ├── LiveDashboard.js           ← Dashboard temps réel : tournées en cours, progression, GPS
        ├── PeseeModule.js             ← Saisie pesée, historique, stats
        ├── MaterielModule.js          ← Checklist véhicule, incidents, photos
        ├── PlanificationModule.js     ← 3 modes (standard/prédictif/manuel), grille hebdo, bandeau saisonnier
        ├── QRModule.js                ← Ancien module QR (remplacé par CAVPageV2, conservé pour référence)
        ├── EquipeModule.js            ← Collaborateurs, planning hebdo, compétences
        ├── POJModule.js               ← Plan d'Occupation Journalier, drag-and-drop postes
        ├── ReportingModule.js         ← Synthèse, impacts environnementaux, export PDF
        ├── UsersModule.js             ← Gestion comptes utilisateurs, rôles, liaison collaborateur
        ├── DashboardGlobal.js         ← Dashboard consolidé (conservé, remplacé par HomePage à l'accueil)
        └── utils/
            └── api.js                 ← Helper fetch avec token JWT
```

---

## 4. SCHÉMA BASE DE DONNÉES

### Module Collecte

```
CAV (209 points de collecte)
├── id, nom, adresse, complement_adresse, code_postal, ville
├── latitude, longitude (Float, NULLABLE — certains CAV n'ont pas de GPS)
├── nb_cav (nombre de conteneurs sur le point)
├── frequence_passage (x fois/semaine)
├── communaute_communes, entite_detentrice, reference_eco_tlc
├── qr_code (String unique, format "ST-{id:04d}-{uuid[:6]}")
├── is_active (Boolean)
├── suspension_motif (String, nullable — "Travaux", "Dégradation", etc.)
└── created_at, updated_at

Vehicle (4 camions)
├── id, immatriculation, nom, marque, modele
├── ptc, charge_utile, volume_m3, puissance_ch, type_energie, tare
└── is_active, created_at, updated_at

RouteTemplate (19 tournées standard)
├── id, nom, description, secteur
└── is_active, created_at

RouteTemplatePoint (association tournée ↔ CAV avec ordre)
├── id, route_template_id → RouteTemplate, cav_id → CAV, ordre
└── UNIQUE(route_template_id, cav_id)

DailyRoute (instances de tournées planifiées/exécutées)
├── id, date, periode ("matin"/"apres_midi")
├── template_id → RouteTemplate, vehicle_id → Vehicle
├── chauffeur_id, suiveur_id (→ collaborateurs)
├── source ("standard"/"prediction"/"manual")
└── status ("planifiee"/"en_cours"/"terminee"), created_at

Collection (scan de collecte par CAV)
├── id, daily_route_id → DailyRoute, cav_id → CAV
├── scanned_at, fill_level ("Vide"/"Faible"/"Mi-Hauteur"/"Presque-Plein"/"Plein"/"Deborde")
├── gps_lat, gps_lon, ordre_reel
└── note

Weight (pesée camion retour)
├── id, daily_route_id → DailyRoute, vehicle_id → Vehicle
├── poids_brut, tare, poids_net (Integer, en kg)
└── weighed_at, note

WeightHistory (1606 pesées importées Excel)
├── id, external_id, origine, categorie
├── poids_net, tare, poids_brut, date_pesee
└── mois, trimestre, annee

VehicleChecklist (check quotidien véhicule)
├── id, vehicle_id → Vehicle, driver_id, date
├── kilometrage, niveau_carburant, etat_pneus
├── eclairage_ok, freins_ok, retros_ok, proprete_ok, hayons_ok
└── commentaire, validation, created_at

Incident (signalement terrain)
├── id, daily_route_id, cav_id, vehicle_id, reporter_id
├── type, description, photo_path, severity, status
├── gps_lat, gps_lon
└── reported_at, resolved_at

GPSTrack (tracking position collecteur)
├── id, daily_route_id → DailyRoute
├── latitude, longitude, accuracy, speed
└── recorded_at
```

### Module Utilisateurs / Auth

```
User
├── id, username (unique), email, hashed_password, full_name
├── role: ADMIN / MANAGER / OPERATOR / VIEWER
├── is_active, staff_id (→ collaborateur lié)
└── created_at, updated_at, last_login
```

### Module Recrutement

```
PositionType: id, code, label, description
Position: id, title, type, month, slots_open, slots_filled
Candidate: id, first_name, last_name, email, gender, phone, application_date, cv_file_path, cv_raw_text, kanban_status, position_id, comment, cr_interview, cr_test, pcm_test_id
KanbanHistory: id, candidate_id, from_status, to_status, moved_by, moved_at, note
PCMTest: id, candidate_id, started_at, completed_at, status, input_mode
PCMProfile: id, test_id, candidate_id, base_type, phase_type, score_{6 types}, perception_dominante, canal_communication, besoin_psychologique, driver_principal, masque_stress, scenario_stress, rps_risk_level, rps_indicators, tp_correlation, communication_tips, environment_tips, incompatibility_notes
```

### Module POJ (Plan d'Occupation Journalier)

```
POJCollaborateur: id, nom, prenom, contrat, caces, permis, indispo, equipe, telephone
POJPoste: id, nom, groupe, obligatoire, req_caces, req_permis
POJAffectation: id, date_planning, poste_id, collab_id
POJVakEvent: id, nom, date_start, date_end
POJVakPoste: id, nom, obligatoire
POJVakAffectation: id, vak_id, date_planning, vak_poste_id, collab_id
```

---

## 5. API — RÉFÉRENCE COMPLÈTE

Tous les endpoints sont montés sous le préfixe `/api`. L'authentification se fait par JWT Bearer token.

### Auth (`/api` — auth.py)
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/login` | Connexion → token JWT (expire 8h) |
| GET | `/me` | Profil utilisateur connecté |
| PUT | `/me/password` | Changer son mot de passe |
| GET | `/users` | Liste utilisateurs (admin) |
| POST | `/users` | Créer utilisateur |
| PUT | `/users/{id}` | Modifier utilisateur |
| DELETE | `/users/{id}` | Supprimer utilisateur |

### CAV & Administration (`/api` — admin.py)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/cav` | Liste tous les CAV |
| GET | `/cav/stats` | Stats CAV par ville |
| GET | `/cav/{id}` | Détail CAV + tournées associées |
| POST | `/cav` | Créer un CAV |
| PUT | `/cav/{id}` | Modifier un CAV (dont is_active, suspension_motif) |
| DELETE | `/cav/{id}` | Supprimer un CAV |
| GET | `/vehicles` | Liste véhicules |
| POST | `/vehicles` | Créer véhicule |
| PUT | `/vehicles/{id}` | Modifier véhicule |
| DELETE | `/vehicles/{id}` | Supprimer véhicule |
| GET | `/routes` | Liste tournées standard (avec nb_cav) |
| GET | `/routes/{id}` | Détail tournée + points ordonnés |
| PUT | `/routes/{id}` | Modifier tournée |
| POST | `/routes/{id}/points` | Ajouter un CAV à une tournée |
| DELETE | `/routes/{id}/points/{cav_id}` | Retirer un CAV d'une tournée |
| GET | `/dashboard` | Dashboard consolidé (counts + tonnage) |
| GET | `/tonnage/stats` | Stats tonnage mensuel |
| GET | `/tonnage/history` | Historique pesées |
| POST | `/admin/upload/{filetype}` | Upload fichier Excel |
| POST | `/admin/import` | Lancer import Excel |

### Collecte temps réel (`/api/collect` — collect.py)
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/scan` | Scanner un CAV (fill_level, GPS) |
| PUT | `/scan/{id}` | Modifier une collecte |
| GET | `/scans/{daily_route_id}` | Collectes d'une tournée |
| POST | `/start` | Démarrer une tournée |
| POST | `/finish/{daily_route_id}` | Terminer une tournée |
| POST | `/gps` | Envoi position GPS |
| POST | `/gps/batch` | Envoi batch positions GPS |
| GET | `/live` | Dashboard live (tournées en cours) |
| GET | `/live/history/{daily_route_id}` | Historique GPS d'une tournée |

### Mobile (`/api/mobile` — mobile.py)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/mes-tournees?date_str=YYYY-MM-DD` | Tournées du jour pour l'utilisateur |
| GET | `/tournee/{daily_route_id}` | Détail complet tournée + points + collectes |

### Équipe (`/api/equipe` — equipe.py)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/collaborateurs` | Liste collaborateurs |
| GET | `/collaborateurs/stats` | Stats équipe |
| POST | `/collaborateurs` | Créer collaborateur |
| PUT | `/collaborateurs/{id}` | Modifier collaborateur |
| DELETE | `/collaborateurs/{id}` | Supprimer collaborateur |
| GET | `/planning?semaine=YYYY-MM-DD` | Planning hebdo |
| POST | `/planning` | Créer affectation |
| PUT | `/planning/{id}` | Modifier affectation |
| DELETE | `/planning/{id}` | Supprimer affectation |
| GET | `/disponibilite?date=YYYY-MM-DD` | Disponibilité chauffeurs/suiveurs |

### Pesée (`/api/pesee` — pesee.py)
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/` | Enregistrer pesée |
| PUT | `/{id}` | Modifier pesée |
| GET | `/tournee/{daily_route_id}` | Pesée d'une tournée |
| GET | `/history` | Historique pesées |
| GET | `/stats` | Stats tonnage |

### Matériel (`/api/materiel` — materiel.py)
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/checklist` | Enregistrer checklist véhicule |
| GET | `/checklist/today` | Checklists du jour |
| GET | `/checklist/vehicle/{id}` | Historique checklist véhicule |
| GET | `/checklist/stats` | Stats checklists |
| POST | `/incident` | Signaler incident |
| PUT | `/incident/{id}` | Modifier incident |
| GET | `/incidents` | Liste incidents |
| GET | `/incidents/stats` | Stats incidents |
| POST | `/incident/{id}/photo` | Ajouter photo à incident |

### Planification (`/api/planification` — planification.py)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/prediction?start_date=YYYY-MM-DD` | Recommandations prédictives semaine |
| GET | `/saisonnalite` | Coefficients saisonniers 12 mois |
| POST | `/generate` | Générer planning semaine (mode: standard/prediction/manual) |
| GET | `/semaine?start_date=YYYY-MM-DD` | Planning complet semaine |
| POST | `/slot` | Ajouter créneau |
| PUT | `/slot/{id}` | Modifier créneau |
| DELETE | `/slot/{id}` | Supprimer créneau |

### QR Codes (`/api/qr` — qrcode_router.py)
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/generate` | Générer QR pour tous les CAV sans code |
| GET | `/list?route_id=X` | Liste CAV avec QR |
| GET | `/image/{cav_id}` | Image PNG du QR code |
| GET | `/resolve/{qr_code}` | Résoudre QR → infos CAV |
| GET | `/export-pdf?route_id=X` | PDF étiquettes QR (6/page) |

### Reporting (`/api/reporting` — reporting.py)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/synthese?annee=YYYY` | Synthèse annuelle (tonnage, CO2, emplois) |
| GET | `/export-pdf?annee=YYYY` | Export rapport PDF |

### Recrutement & PCM (`/api` — legacy.py)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET/POST/PUT/DELETE | `/candidates[/{id}]` | CRUD candidats |
| POST | `/candidates/{id}/move` | Déplacer dans le Kanban |
| GET | `/candidates/{id}/history` | Historique Kanban |
| GET/POST/PUT/DELETE | `/positions[/{id}]` | CRUD postes |
| GET/POST/DELETE | `/position-types[/{id}]` | Types de postes |
| GET | `/pcm/questionnaire` | 20 questions PCM (avec emoji/short/color) |
| POST | `/pcm/submit` | Soumettre réponses → calcul profil |
| GET | `/pcm/profiles[/{candidate_id}]` | Profils PCM |
| GET | `/pcm/types[/{type_key}]` | Données types PCM |
| GET | `/stats` | Stats recrutement |
| POST | `/upload/cv` | Upload CV |

### POJ (`/api/poj` — legacy.py)
| Méthode | Route | Description |
|---------|-------|-------------|
| CRUD | `/poj/collaborateurs[/{id}]` | Collaborateurs POJ |
| CRUD | `/poj/postes[/{id}]` | Postes de tri |
| GET/POST/DELETE | `/poj/planning/{date_str}` | Planning journalier |
| GET | `/poj/planning/range/{start}/{end}` | Planning sur période |
| GET | `/poj/stats/{date_str}` | Stats couverture |
| GET | `/poj/export/planning` | Export planning |
| CRUD | `/poj/vak/*` | Événements VAK |

### Gestion utilisateurs (`/api/users` — users.py)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Liste utilisateurs avec rôles |
| GET | `/me` | Mon profil |
| GET | `/{id}` | Détail utilisateur |
| POST | `/` | Créer utilisateur |
| PUT | `/{id}` | Modifier utilisateur |
| DELETE | `/{id}` | Supprimer utilisateur |
| POST | `/change-password` | Changer son MDP |
| POST | `/{id}/reset-password` | Reset MDP (admin) |

---

## 6. CONVENTIONS DE CODE

### Backend (Python/FastAPI)

- **ORM** : SQLAlchemy 2.0 async (`AsyncSession`, `select()`, pas de `query()`)
- **Conversion** : `row_to_dict(obj)` — utilitaire générique via `__table__.columns`
- **Auth** : `Depends(get_current_user)` ou `Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER))`
- **Préfixes routers** : `/api` (admin, auth, legacy), `/api/collect`, `/api/mobile`, etc.
- **Migrations** : pas d'Alembic — migrations automatiques dans `database.py` via `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- **Création tables** : `Base.metadata.create_all()` au démarrage dans `init_db()`
- **pip install** : toujours `--break-system-packages` dans le Dockerfile

### Frontend (React)

- **Monolithique** : pas de react-router, navigation via `currentPage` state dans `App.js`
- **Pas de TypeScript** — JavaScript ES6+ uniquement
- **Style** : inline styles, pas de CSS externe (sauf Leaflet CDN)
- **Police** : Poppins (Google Fonts, chargé dans index.html)
- **Thème couleurs** :
  ```javascript
  const T = {
    primary: "#008678",    // Vert Solidarité Textiles
    dark: "#253036",       // Texte principal
    bg: "#FFFAF6",         // Fond crème
    card: "#FFFFFF",       // Fond cartes
    text: "#253036",       // Texte
    sub: "#5a6872",        // Texte secondaire
    light: "#8a959e",      // Texte léger
    border: "#e8e0d8",     // Bordures
    success: "#2ecc71",    // Vert succès
    warning: "#f39c12",    // Orange
    danger: "#e74c3c",     // Rouge
  };
  ```
- **Composants réutilisables** : `Card`, `Badge`, `Btn`, `StatCard`, `Toast`
- **API helper** : `api(path, opts)` dans chaque module (fetch + JWT + error handling)
- **Token JWT** : stocké dans `localStorage("solidata_token")` ET `window.__solidata_token`

### Règles Leaflet (IMPORTANT)

- **Toujours filtrer** les points avant de passer à Leaflet : `points.filter(p => p.latitude && p.longitude)`
- **FitBounds** : vérifier que les bounds ne contiennent pas de `NaN`
- **Markers** : ne jamais passer `position={[null, null]}`
- Certains CAV importés n'ont pas de coordonnées GPS

### Règles React hooks (IMPORTANT)

- **Jamais** de `useState`/`useRef`/`useEffect` après un `return` conditionnel
- Tous les hooks doivent être déclarés au début du composant, avant tout `if (...) return`

---

## 7. FONCTIONNALITÉS PAR MODULE

### 7.1 Page d'accueil (`HomePage.js`)
- 3 cartes cliquables : Collecte, Tri, Personnel
- Accès rapides en bas (Mobile, Live, Kanban, Comptes)
- Salutation contextuelle (Bonjour/Bon après-midi/Bonsoir)

### 7.2 Collecte (`CollecteModule.js`)
- Onglets : Dashboard | CAV | Véhicules | Tournées | Planification | Import
- Dashboard : stats CAV, véhicules, tournées, tonnage annuel
- CAV → délégué à `CAVPageV2.js`
- Tournées → délégué à `RoutesPageV2.js`

### 7.3 CAV (`CAVPageV2.js`)
- Filtres par statut (Actif/Suspendu/Tous)
- Recherche par nom, ville, QR code
- Création CAV avec QR auto-généré
- Panneau latéral détail : QR code affiché, édition inline, suspension avec motif (Travaux, Dégradation, Vandalisme, Accès bloqué, Autre), réactivation
- Tournées associées affichées

### 7.4 Tournées (`RoutesPageV2.js`)
- Vue split : liste à gauche, détail à droite
- Ajout de CAV à une tournée (recherche + clic)
- Suppression de CAV (avec réordonnancement automatique)
- Badge nombre de CAV par tournée

### 7.5 Carte (`MapModule.js`)
- Leaflet avec OpenStreetMap
- 2 modes : tous les CAV / par tournée
- Marqueurs numérotés, itinéraire en pointillé, dépôt
- Protection contre les CAV sans GPS

### 7.6 Mobile (`MobileModule.js`)
- Détection `?mobile=1` dans l'URL → interface mobile plein écran
- Liste tournées du jour (filtrable par date)
- Carte avec marqueurs numérotés
- Navigation multi-étapes Google Maps (jusqu'à 9 waypoints)
- Scanner QR caméra (BarcodeDetector API)
- Saisie collecte : 6 niveaux avec jauge visuelle conteneur
- Détection `?scan={code}` au démarrage (scan depuis étiquette)
- GPS tracking continu (envoi toutes les 30s)

### 7.7 Planification (`PlanificationModule.js`)
- 3 modes de génération :
  - **Standard** : chaque véhicule actif planifié matin + après-midi, rotation des tournées
  - **Prédictif** : adapté aux coefficients saisonniers (Nov-Mars basse, Juin-Sept haute)
  - **Manuel** : ajout créneau par créneau
- Bandeau saisonnier avec coefficient et mini-barres 12 mois
- Grille hebdomadaire 5 jours × 2 périodes
- Recommandations par jour (nb tournées, tonnage prévu)

### 7.8 QR Codes
- Intégré dans `CAVPageV2.js` (QR visible dans le panneau détail)
- Génération batch : `POST /api/qr/generate`
- Format code : `ST-{cav_id:04d}-{uuid[:6].upper()}`
- Export PDF étiquettes : 6/page (ReportLab), QR image 35×35mm + nom + ville

### 7.9 PCM (`App.js` — PCMQuestionnaire, PCMProfileReport)
- 20 questions, 6 options chacune
- **2 versions au choix** :
  - 🖼️ **Images** : grille 3×2 de cartes colorées avec emoji + libellé court (pour personnes en difficulté linguistique)
  - 📝 **Texte** : liste verticale avec texte complet et boutons radio
- Scoring : 6 types (Analyseur, Persévérant, Promoteur, Empathique, Énergiseur, Imagineur)
- Profil généré : base type, phase type, perception, canal communication, besoin psychologique, driver, stress, RPS
- Rapport détaillé avec immeuble de personnalité, guide manager, vigilance RPS

### 7.10 Kanban (`App.js` — KanbanBoard)
- 5 colonnes : Candidature reçue → Rejetée → Qualifiée → Entretien confirmé → Recruté
- Drag-and-drop entre colonnes
- Panneau détail éditable : prénom, nom, email, téléphone, genre, commentaire, poste, CR entretien, CR test
- Historique des mouvements

### 7.11 Reporting (`ReportingModule.js`)
- Synthèse annuelle : tonnage, nb collectes, nb pesées
- Impacts environnementaux (facteurs ADEME : CO2 évité, eau économisée)
- Export PDF

### 7.12 Autres modules
- **Pesée** (`PeseeModule.js`) : saisie poids brut/tare, historique, stats
- **Matériel** (`MaterielModule.js`) : checklist quotidienne véhicule, incidents avec photos
- **Équipe** (`EquipeModule.js`) : collaborateurs, compétences (CACES, permis), planning hebdo
- **Utilisateurs** (`UsersModule.js`) : CRUD comptes, 4 rôles, liaison collaborateur
- **Live** (`LiveDashboard.js`) : tournées en cours, progression temps réel, carte GPS
- **POJ** (`POJModule.js`) : postes de tri, affectation jour par jour, stats couverture

---

## 8. AUTHENTIFICATION

### Rôles
| Rôle | Accès |
|------|-------|
| `ADMIN` | Tout |
| `MANAGER` | Tout sauf gestion comptes admin |
| `OPERATOR` | Collecte terrain, saisie, mobile |
| `VIEWER` | Lecture seule |

### Comptes par défaut (seed)
| Username | Mot de passe | Rôle |
|----------|-------------|------|
| admin | admin2026 | ADMIN |

### Flow auth
1. `POST /api/login` → `{access_token, token_type, role, full_name}`
2. Token stocké dans `localStorage("solidata_token")` + `window.__solidata_token`
3. Chaque requête API : header `Authorization: Bearer {token}`
4. Expiration : 8h (480 minutes)

---

## 9. DONNÉES IMPORTÉES

### Excel d'origine (import via admin)
- **209 CAV** avec adresses, coordonnées GPS (certains sans GPS), nb conteneurs, fréquence
- **19 tournées standard** avec ordre de passage
- **1606 pesées historiques** (WeightHistory) avec poids, dates, catégories

### Modèle prédictif saisonnier
```
Coefficients par défaut (base 1.0 = moyenne annuelle) :
- Janvier: 0.75, Février: 0.70, Mars: 0.80
- Avril: 0.95, Mai: 1.00
- Juin: 1.20, Juillet: 1.30, Août: 1.25, Septembre: 1.20
- Octobre: 1.05, Novembre: 0.85, Décembre: 0.80
```
Capacité camion : 800 kg

---

## 10. BUGS CONNUS & POINTS D'ATTENTION

1. **CAV sans GPS** : ~10% des CAV n'ont pas de latitude/longitude. Toujours filtrer avant Leaflet.
2. **Immatriculations temporaires** : les véhicules ont des plaques fictives (XX-001-AA) — à remplacer.
3. **Comptes utilisateurs** : seul le compte admin existe par défaut — créer les comptes réels.
4. **BarcodeDetector API** : uniquement Chrome/Edge mobile. Fallback saisie manuelle dans le scanner.
5. **manifest.json 403** : erreur bénigne, le PWA fonctionne quand même.
6. **Google Maps waypoints** : limité à 9 étapes intermédiaires (limite gratuite).

---

## 11. COMMANDES UTILES

```bash
# Déployer
docker compose down && docker compose up -d --build

# Logs backend
docker compose logs -f backend

# Logs frontend
docker compose logs -f frontend

# Accéder au conteneur backend
docker compose exec backend bash

# Accéder à PostgreSQL
docker compose exec db psql -U solidata -d solidata

# Reconstruire un seul service
docker compose up -d --build backend
docker compose up -d --build frontend

# Vérifier la santé
curl http://82.65.155.79:8083/api/health
```

---

## 12. POUR CONTRIBUER

### Ajouter un endpoint backend
1. Créer ou modifier le router dans `app/routers/`
2. Si nouveau router : l'importer et le monter dans `app/main.py`
3. Si nouveau modèle : l'ajouter dans `app/models/` et l'importer dans `app/models/__init__.py`
4. Si nouvelle colonne : ajouter `ALTER TABLE ADD COLUMN IF NOT EXISTS` dans `app/database.py`

### Ajouter un module frontend
1. Créer le composant dans `frontend/src/NouveauModule.js`
2. L'importer dans `App.js` ou `CollecteModule.js`
3. Ajouter l'onglet/page dans la navigation
4. Utiliser le thème `T` et les composants `Card`, `Badge`, `Btn`

### Pattern API frontend
```javascript
const API = "/api";
function getToken() { return window.__solidata_token || localStorage.getItem("solidata_token"); }
async function api(path, opts = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Erreur"); }
  return res.json();
}
```

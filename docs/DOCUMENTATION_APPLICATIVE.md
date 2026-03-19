# Documentation Applicative — SOLIDATA ERP v1.2.0

> **Version** : 1.2.0 | **Date** : 2026-03-19
> **Éditeur** : Solidarité Textile — Rouen, Normandie
> **URL** : https://solidata.online | **Mobile** : https://m.solidata.online

---

## 1. Présentation Générale

### 1.1 Qu'est-ce que SOLIDATA ?

SOLIDATA est un ERP (Enterprise Resource Planning) web conçu spécifiquement pour **Solidarité Textile**, structure d'insertion par l'activité économique (SIAE) spécialisée dans la collecte, le tri, le réemploi et le recyclage de textiles en Normandie.

L'application couvre l'ensemble de la chaîne de valeur :

```
Collecte → Tri → Production → Stock → Exutoires → Facturation
    ↕           ↕                           ↕
Recrutement   Insertion CDDI         Reporting / Subventions
```

### 1.2 Architecture Technique

| Composant | Technologie | Version |
|-----------|-------------|---------|
| Frontend Web | React 18 + Vite + TailwindCSS | 18.3.x |
| Frontend Mobile | React PWA + Vite + html5-qrcode | 18.3.x |
| Backend API | Node.js + Express | 20.x LTS |
| Base de données | PostgreSQL + PostGIS | 15.x |
| Cache | Redis | 7.x |
| Reverse Proxy | Nginx + Let's Encrypt | 1.25.x |
| Conteneurisation | Docker Compose | 2.x |
| Cartographie | Leaflet.js | 1.9.x |
| Graphiques | Recharts | 2.x |
| Temps réel | Socket.IO | 4.x |
| SMS/Email | Brevo API | v3 |
| OCR | Tesseract.js | 5.x |
| PDF parsing | pdf-parse | 1.x |

### 1.3 Infrastructure

```
┌─────────────────────────────────────────────────────────┐
│                    Scaleway DEV1-S                       │
│              2 vCPU · 2 Go RAM · 20 Go SSD              │
│                                                         │
│  ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────┐ │
│  │  Nginx  │──▶│ Frontend │   │  Mobile  │   │Certbot│ │
│  │  :443   │   │  :3000   │   │  :3002   │   │ SSL   │ │
│  └────┬────┘   └──────────┘   └──────────┘   └──────┘ │
│       │                                                 │
│       ▼                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐            │
│  │ Backend  │──▶│PostgreSQL│   │  Redis   │            │
│  │  :3001   │   │  :5432   │   │  :6379   │            │
│  └──────────┘   └──────────┘   └──────────┘            │
└─────────────────────────────────────────────────────────┘

Domaines :
  solidata.online      → Frontend web
  www.solidata.online   → Frontend web (redirect)
  m.solidata.online     → PWA mobile
  solidata.online/api   → Backend API
```

### 1.4 Sécurité

| Couche | Mesure |
|--------|--------|
| Transport | TLS 1.2/1.3, HSTS 2 ans, HTTP/2 |
| Authentification | JWT (8h) + Refresh Token (7j) |
| Mots de passe | bcrypt 10 rounds |
| Autorisation | RBAC 5 rôles (ADMIN, MANAGER, RH, COLLABORATEUR, AUTORITE) |
| API | Rate limiting (1000 req/15 min global, 30 req/15 min auth) |
| SQL | Requêtes paramétrées 100 % ($1, $2, $3) |
| Headers | Helmet (X-Frame-Options, X-Content-Type-Options, HSTS) |
| CORS | Whitelist domaines (solidata.online uniquement) |
| Firewall | UFW + Fail2ban |
| Chiffrement tokens | crypto.randomBytes(64) |

---

## 2. Modules Fonctionnels

### 2.1 Tableau de Bord (Dashboard)

**Route** : `/` | **Rôles** : Tous
**Fichier** : `frontend/src/pages/Dashboard.jsx`

Le dashboard centralise les indicateurs clés :
- Tonnage collecté (jour/semaine/mois)
- Nombre de tournées actives
- État des stocks par catégorie
- Alertes (stocks bas, retards livraisons, maintenances)
- Fil d'actualité interne (`/news`)

### 2.2 Recrutement

#### 2.2.1 Candidats (Kanban)
**Route** : `/candidates` | **Rôles** : ADMIN, RH, MANAGER
**Fichier** : `frontend/src/pages/Candidates.jsx` (67 Ko)
**API** : `backend/src/routes/candidates.js` (55 Ko)

**Fonctionnalités** :
- **Kanban Board** : 4 colonnes (Reçus → Entretien → Recrutés → Refusés) avec drag & drop
- **Upload CV** : PDF/DOC/DOCX, 10 Mo max, extraction texte automatique
- **Parsing compétences** : Détection automatique des compétences depuis le CV (skill_keywords)
- **Historique** : Traçabilité de chaque changement de statut avec date et utilisateur
- **Conversion employé** : Bouton "Créer un employé" disponible sur les candidats recrutés (statut hired)
- **Onglets conditionnels par statut** :
  - Reçu : Fiche, Historique
  - Entretien : + Entretien structuré, Mise en situation, PCM, Documents
  - Recruté : + Entretien structuré, Mise en situation, PCM, Documents
  - Refusé : Fiche, Historique uniquement
- **Recherche/filtre** : Par statut, compétences, date, poste

#### 2.2.2 Plan de Recrutement
**Route** : `/candidates` (onglet "Plan de recrutement")
**API** : `GET/POST /api/candidates/recruitment-plan`

**Fonctionnalités** :
- Tableau croisé Postes × Mois (6 mois glissants)
- Définition des besoins par poste et par mois
- Compteur automatique : recrutés vs objectif
- Taux de remplissage visuel

#### 2.2.3 Matrice PCM (Process Communication Model)
**Route** : `/pcm` | **Rôles** : ADMIN, RH
**Fichier** : `frontend/src/pages/PersonalityMatrix.jsx`
**Test** : `frontend/src/pages/PCMTest.jsx`
**API** : `backend/src/routes/pcm.js` (40 Ko)

**Fonctionnalités** :
- Test interactif de personnalité (**20 questions**, 4 choix par question)
- **6 types** : Analyseur, Persévérant, Empathique, Imagineur, Énergiseur, Promoteur
- **Scoring pondéré** sur 5 catégories : perception, style de management, canal de communication, motivation, stress
- **Base** (type fondamental, stable) et **Phase** (type actif, peut évoluer) identifiés automatiquement
  - Base = type dominant dans les catégories perception + style management + canal communication (poids total 17.5)
  - Phase = type dominant dans les catégories motivation + stress (poids total 25)
- **Immeuble PCM** : visualisation en bâtiment (barres horizontales), Base toujours à l'étage 1 (fondation)
- **Profil graphique radar** : 6 axes avec scores normalisés 0-100 %
- **Alertes RPS** : détection automatique de risques psychosociaux si le score stress de la Phase dépasse 75 %
- **Guide Manager** : comportements recommandés (DO) et à éviter (DON'T) par type de base
- **Accessibilité FALC** : descriptions en Facile à Lire et à Comprendre pour chaque type
- **Export PDF A4** : deux exports disponibles depuis la page profil :
  - *Export résultats* : page de synthèse avec immeuble, base/phase, comportements, guide manager, niveaux de stress
  - *Fiche technique* : tableau des scores bruts + détail des 20 réponses groupées par catégorie
- **Chiffrement** : données sensibles chiffrées AES-256 en base (profils PCM)
- Rapports chiffrés stockés en base (table `pcm_reports`)

**API PCM** :
| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/pcm/questionnaire` | Retourne les 20 questions |
| GET | `/api/pcm/types` | Référentiel des 6 types PCM |
| GET | `/api/pcm/types/:typeKey` | Détail d'un type |
| POST | `/api/pcm/evaluate` | Évaluer les réponses et générer le profil |
| GET | `/api/pcm/profiles/:candidateId` | Profil PCM d'un candidat |
| GET | `/api/pcm/profiles/:candidateId/answers` | Réponses brutes enrichies (texte question, catégorie, libellé réponse) |
| DELETE | `/api/pcm/:candidateId` | Supprimer le profil PCM |

### 2.3 Gestion d'Équipe

#### 2.3.1 Collaborateurs
**Route** : `/employees` | **Rôles** : ADMIN, RH, MANAGER
**API** : `backend/src/routes/employees.js`

- Fiche collaborateur complète (photo, infos, contrat, compétences)
- Types de contrat : CDI, CDD, CDDI (insertion), Stage, Alternance
- Upload photo (5 Mo max)
- Historique des modifications

#### 2.3.2 Heures de Travail
**Route** : `/work-hours` | **Rôles** : ADMIN, RH
**API** : `backend/src/routes/work-hours.js`

- Saisie hebdomadaire par collaborateur
- Calcul automatique total et heures supplémentaires
- Export Excel

#### 2.3.3 Compétences
**Route** : `/skills` | **Rôles** : ADMIN, RH
**API** : `backend/src/routes/skills.js`

- Référentiel de compétences (tri, collecte, mécanique, bureautique, etc.)
- Affectation niveaux par collaborateur
- Matrice compétences × collaborateurs

#### 2.3.4 Parcours Insertion
**Route** : `/insertion` | **Rôles** : ADMIN, RH, MANAGER
**API** : `backend/src/routes/insertion.js` (98 Ko)

- Création de parcours CDDI avec diagnostic initial
- **3 jalons obligatoires** : M1 (1 mois), M6 (6 mois), M12 (12 mois) — évaluations planifiées automatiquement
- **Radar 7 freins périphériques** : logement, mobilité, santé, administratif, financier, familial, justice — notation 1 à 5 par frein, visualisation radar
- **Plans d'action CIP** : le Conseiller en Insertion Professionnelle définit des actions correctives par frein identifié
- **Alertes entretien** : rappels automatiques avant chaque jalon
- Suivi de progression (graphiques d'évolution)
- Clôture de parcours avec bilan exportable

#### 2.3.5 Planning Hebdomadaire
**Route** : `/planning-hebdo` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/planning-hebdo.js`

- Affectation collaborateurs par jour/poste
- Détection de conflits horaires
- Vue calendrier hebdomadaire

### 2.4 Collecte

#### 2.4.1 Tournées
**Route** : `/tours` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/tours.js`

- Planification de tournées (chauffeur + véhicule + liste CAVs)
- Suivi temps réel (statut : planifiée → en cours → terminée)
- Historique complet avec poids collecté

#### 2.4.2 Propositions IA
**Route** : `/collection-proposals` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/collection-proposals.js`

- Suggestions automatiques de tournées basées sur :
  - Taux de remplissage des CAVs
  - Historique de collecte
  - Proximité géographique (PostGIS)

#### 2.4.3 Carte CAV
**Route** : `/cav-map` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/cav.js`

- Carte Leaflet interactive avec tous les points de collecte
- Marqueurs colorés selon le taux de remplissage
- Clic sur marqueur = détails du CAV + historique

#### 2.4.4 Remplissage CAV
**Route** : `/fill-rate` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/cav.js` (intégré aux routes CAV)

- Tableau de bord taux de remplissage par CAV
- Historique graphique (Recharts)
- Alertes seuils (plein, quasi-plein)

#### 2.4.5 Suivi GPS
**Route** : `/live-vehicles` | **Rôles** : ADMIN, MANAGER
**API** : Socket.IO `/gps-update`

- Position en temps réel des véhicules en tournée
- Mise à jour toutes les 10 secondes via WebSocket
- Vitesse, direction, dernière position connue

### 2.5 Tri & Production

#### 2.5.1 Production
**Route** : `/production` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/production.js`

- Sessions de tri quotidiennes
- Saisie par catégorie textile et poids
- Bilan de production journalier/hebdo/mensuel
- Rendement par chaîne de tri

#### 2.5.2 Chaînes de Tri
**Route** : `/chaine-tri` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/tri.js`

- Configuration des chaînes de tri
- Affectation collaborateurs par chaîne
- Suivi performance par chaîne

#### 2.5.3 Stocks
**Route** : `/stock` (matières premières), `/produits-finis` (produits finis)
**API** : `backend/src/routes/stock.js`, `backend/src/routes/produits-finis.js`

- Mouvements de stock (entrée/sortie) avec traçabilité
- Stock par catégorie et qualité
- Alertes stock bas
- Historique mouvements

#### 2.5.4 Expéditions
**Route** : `/expeditions` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/expeditions.js`

- Suivi des expéditions vers exutoires
- Traçabilité par lot

### 2.6 Exutoires (Logistique)

#### 2.6.1 Commandes
**Route** : `/exutoires-commandes` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/commandes-exutoires.js`

**Workflow complet** :
```
en_attente → confirmée → en_préparation → chargée → expédiée → pesée_reçue → facturée → clôturée
                                                                                    ↘ annulée
```

- Référence automatique CMD-YYYY-NNNN
- 7 types de produits textiles
- Tarification par tonne et par client
- Commandes récurrentes (unique, hebdomadaire, bi-mensuelle, mensuelle)
- Calcul CO₂ par type d'exutoire (ACV Refashion/ADEME)

#### 2.6.2 Préparation
**Route** : `/exutoires-preparation` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/preparations.js`

- Localisation : quai de chargement, garage remorque, cours
- Statut : planifiée → remorque livrée → en chargement → prête → expédiée
- Timeline : heure réception → début chargement → fin → départ
- Affectation d'équipe (collaborateurs)
- Pesée interne

#### 2.6.3 Gantt Chargement
**Route** : `/exutoires-gantt` | **Rôles** : ADMIN, MANAGER
**Fichier** : `frontend/src/pages/ExutoiresGantt.jsx`

- Planning visuel Gantt des chargements
- Vue hebdomadaire
- Détection de conflits quai

#### 2.6.4 Facturation Exutoires
**Route** : `/exutoires-facturation` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/factures-exutoires.js`

- Upload facture PDF
- Extraction OCR automatique (Tesseract.js)
- Rapprochement pesée interne / facture client
- Suivi état : reçue → validée → payée

#### 2.6.5 Calendrier Logistique
**Route** : `/exutoires-calendrier` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/calendrier-logistique.js` (15 Ko)

- Vue prévisionnelle des commandes/expéditions
- Alertes : surcharge, préparation manquante, stock insuffisant
- Planification capacitaire

#### 2.6.6 Clients Exutoires
**Route** : `/exutoires-clients` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/clients-exutoires.js`

- Fiche client (recycleur, négociant, industriel, autre)
- Historique commandes
- Contacts et adresses

#### 2.6.7 Grille Tarifaire
**Route** : `/exutoires-tarifs` | **Rôles** : ADMIN, MANAGER
**API** : `backend/src/routes/tarifs-exutoires.js`

- Prix par tonne, par produit, par client
- Historique des tarifs
- Application automatique sur commandes

### 2.7 Reporting

5 tableaux de bord analytiques (Recharts) :

| Dashboard | Route | Données |
|-----------|-------|---------|
| Collecte | `/reporting-collecte` | Tonnages, nb tournées, rendement/tournée |
| RH | `/reporting-rh` | Effectif, turnover, heures, % insertion |
| Production | `/reporting-production` | Rendement tri, catégories, productivité |
| Refashion | `/reporting-refashion` | Données réglementaires éco-organisme |
| Métropole Rouen | `/reporting-metropole` | Reporting collectivité territoire |

Tous les reportings supportent :
- Filtres par période (jour/semaine/mois/année)
- Export Excel (ExcelJS)
- Graphiques interactifs (barres, lignes, camemberts)

### 2.8 Administration

| Module | Route | Description |
|--------|-------|-------------|
| Utilisateurs | `/users` | CRUD comptes, reset mot de passe |
| Véhicules | `/vehicles` | Flotte, maintenance, disponibilité |
| Configuration | `/settings` | Paramètres système |
| Référentiels | `/referentiels` | Données de base (postes, catégories, etc.) |
| Moteur Prédictif | `/predictive` | Configuration IA collecte |
| RGPD | `/rgpd` | Registre, export, anonymisation, audit |
| Gestion CAV | `/cav-management` | Administration containers |
| Base de données | `/database` | Outils maintenance DB |

---

## 3. Application Mobile (PWA)

### 3.1 Vue d'ensemble

L'application mobile est une **Progressive Web App** accessible à https://m.solidata.online, conçue pour les chauffeurs-collecteurs en intervention terrain.

**Installation** : Ajouter à l'écran d'accueil depuis Chrome/Safari → l'app s'installe comme une app native.

### 3.2 Workflow de Collecte

```
Login → Sélection Véhicule/Tournée → Checklist Sécurité → Carte GPS
  → Pour chaque CAV :
      Scan QR (ou saisie manuelle) → Remplissage (0-100%) → [Incident éventuel]
  → Retour Centre → Pesée → Résumé Tournée (poids, distance, CO₂)
```

### 3.3 Écrans

| Écran | Fonction | Fichier |
|-------|----------|---------|
| Login | Authentification chauffeur | `mobile/src/pages/Login.jsx` |
| VehicleSelect | Choix véhicule + tournée du jour | `mobile/src/pages/VehicleSelect.jsx` |
| Checklist | 10 items sécurité pré-départ (papiers, gilet, pneus, etc.) | `mobile/src/pages/Checklist.jsx` |
| TourMap | Carte Leaflet + GPS temps réel + marqueurs CAV | `mobile/src/pages/TourMap.jsx` |
| QRScanner | Scan QR container (caméra arrière, 10 fps) | `mobile/src/pages/QRScanner.jsx` |
| QRUnavailable | Fallback : saisie code manuelle ou sélection dropdown | `mobile/src/pages/QRUnavailable.jsx` |
| FillLevel | Taux de remplissage (0-100 % avec emojis) + anomalies | `mobile/src/pages/FillLevel.jsx` |
| Incident | Documentation incident (5 types : panne, accident, container, environnement, autre) | `mobile/src/pages/Incident.jsx` |
| ReturnCentre | Confirmation retour + kilométrage | `mobile/src/pages/ReturnCentre.jsx` |
| WeighIn | Pesée : tare, brut, net (auto-calculé) | `mobile/src/pages/WeighIn.jsx` |
| TourSummary | Bilan : poids, distance, durée, CO₂ économisé | `mobile/src/pages/TourSummary.jsx` |

### 3.4 Fonctionnalités Techniques

- **GPS** : `navigator.geolocation.watchPosition()` avec envoi Socket.IO toutes les 10 s
- **QR Code** : html5-qrcode, caméra arrière, 250×250 px scan box
- **Offline** : localStorage pour session et données en cours de tournée
- **PWA** : Service worker auto-update, mode standalone, portrait lock
- **Touch** : Touch targets ≥ 48 px, feedback visuel au tap
- **Safe area** : Support des encoches iPhone X+ via CSS `env(safe-area-inset-*)`

---

## 4. API Reference

### 4.1 Authentification

Toutes les requêtes API nécessitent un header `Authorization: Bearer <JWT>`.

```
POST /api/auth/login         → { token, refreshToken, user }
POST /api/auth/refresh       → { token }
POST /api/auth/logout        → { message }
```

### 4.2 Endpoints Principaux

| Module | Méthode | Endpoint | Description |
|--------|---------|----------|-------------|
| Candidats | GET | `/api/candidates` | Liste paginée + filtres |
| | POST | `/api/candidates` | Créer candidat |
| | PUT | `/api/candidates/:id` | Modifier candidat |
| | DELETE | `/api/candidates/:id` | Supprimer candidat |
| | POST | `/api/candidates/cv/upload` | Upload CV (PDF/DOC) |
| | GET | `/api/candidates/cv/download/:id` | Télécharger CV |
| | GET | `/api/candidates/recruitment-plan` | Plan recrutement |
| PCM | POST | `/api/pcm/sessions` | Nouvelle session test |
| | POST | `/api/pcm/sessions/:id/answers` | Soumettre réponses |
| | GET | `/api/pcm/sessions/:id/report` | Rapport profil |
| Employés | GET/POST/PUT/DELETE | `/api/employees` | CRUD collaborateurs |
| Insertion | GET/POST/PUT | `/api/insertion` | Parcours CDDI |
| Tournées | GET/POST/PUT | `/api/tours` | Gestion tournées |
| CAV | GET/POST/PUT | `/api/cav` | Containers |
| Stock | GET/POST | `/api/stock` | Mouvements stock |
| Production | GET/POST | `/api/production` | Sessions tri |
| Clients | GET/POST/PUT | `/api/clients-exutoires` | Clients exutoires |
| Commandes | GET/POST/PUT | `/api/commandes-exutoires` | Commandes |
| Préparations | GET/POST/PUT | `/api/preparations` | Expéditions |
| Pesées | GET/POST | `/api/controles-pesee` | Contrôles pesée |
| Factures | GET/POST/PUT | `/api/factures-exutoires` | Facturation |
| Tarifs | GET/POST/PUT | `/api/tarifs-exutoires` | Grille tarifaire |
| Calendrier | GET | `/api/calendrier-logistique` | Prévisions logistique |
| Reporting | GET | `/api/reporting/:type` | Données analytiques |
| RGPD | GET/POST | `/api/rgpd/*` | Registre/export/anonymisation |
| Utilisateurs | GET/POST/PUT | `/api/users` | Gestion comptes |
| Véhicules | GET/POST/PUT | `/api/vehicles` | Flotte |

### 4.3 Codes de Réponse

| Code | Signification |
|------|-------------|
| 200 | Succès |
| 201 | Créé |
| 400 | Requête invalide (champ manquant, référence invalide) |
| 401 | Non authentifié (token absent/expiré) |
| 403 | Non autorisé (rôle insuffisant) |
| 404 | Ressource non trouvée |
| 409 | Conflit (doublon) |
| 413 | Fichier trop volumineux |
| 429 | Trop de requêtes (rate limit) |
| 500 | Erreur serveur interne |

### 4.4 Pagination

Tous les endpoints de liste supportent :
```
?page=1&limit=20&sort=created_at&order=desc
```

---

## 5. Base de Données

### 5.1 Tables Principales

| Table | Description | Relations |
|-------|-------------|-----------|
| `users` | Comptes utilisateurs (5 rôles) | → employees |
| `candidates` | Candidats recrutement + CV | → candidate_skills, candidate_history |
| `candidate_skills` | Compétences détectées/confirmées | → candidates, skill_keywords |
| `candidate_history` | Historique statuts | → candidates, users |
| `pcm_sessions` | Sessions test PCM | → candidates |
| `pcm_answers` | Réponses questionnaire | → pcm_sessions |
| `pcm_reports` | Rapports profil | → pcm_sessions |
| `employees` | Collaborateurs | → users, positions |
| `positions` | Postes de travail | → recruitment_plan |
| `recruitment_plan` | Plan mensuel recrutement | → positions |
| `recruitment_interviews` | Entretiens structurés | → candidates |
| `recruitment_practical_tests` | Mises en situation | → candidates |
| `recruitment_documents` | Documents onboarding | → candidates |
| `work_hours` | Heures travail | → employees |
| `skills` | Référentiel compétences | → employee_skills |
| `insertion_parcours` | Parcours insertion CDDI | → employees |
| `tours` | Tournées collecte | → vehicles, employees |
| `tour_stops` | Arrêts par tournée | → tours, cav |
| `cav` | Containers (points collecte) | PostGIS geom |
| `vehicles` | Flotte véhicules | → tours |
| `stock_movements` | Mouvements stock | — |
| `production_sessions` | Sessions tri | → employees |
| `clients_exutoires` | Clients exutoires | → commandes, tarifs |
| `commandes_exutoires` | Commandes | → clients, preparations |
| `preparations_expedition` | Préparation expéditions | → commandes |
| `preparation_collaborateurs` | Équipe préparation | → preparations, employees |
| `controles_pesee` | Contrôles pesée | → commandes |
| `factures_exutoires` | Factures | → commandes |
| `tarifs_exutoires` | Grille tarifaire | → clients |
| `rgpd_registre` | Registre traitements RGPD | — |
| `rgpd_consent` | Consentements | — |
| `rgpd_audit` | Journal audit | → users |
| `refresh_tokens` | Tokens de refresh | → users |
| `news` | Fil d'actualité | → users |
| `settings` | Configuration système | — |
| `notifications` | Notifications internes | → users |

### 5.2 Extensions PostgreSQL

- **PostGIS** : Requêtes géospatiales (proximité CAV, rayon de recherche)
- **pgcrypto** : Fonctions cryptographiques (si chiffrement au repos activé)

---

## 6. Déploiement

### 6.1 Prérequis Serveur

- Ubuntu 22.04 LTS ou Debian 12
- Docker Engine 24+ et Docker Compose v2
- 2 vCPU, 2 Go RAM minimum (4 Go recommandé)
- 20 Go SSD minimum
- Ports : 80/TCP, 443/TCP ouverts
- Domaine DNS configuré (solidata.online, m.solidata.online)

### 6.2 Premier Déploiement

```bash
# 1. Initialiser le serveur
bash deploy/scripts/init-server.sh

# 2. Configurer les variables d'environnement
cp .env.example .env
nano .env  # Définir DB_PASSWORD, JWT_SECRET, BREVO_API_KEY

# 3. Premier déploiement (HTTP → HTTPS)
bash deploy/scripts/deploy.sh first

# 4. Vérifier
bash deploy/scripts/health-check.sh
```

### 6.3 Mise à Jour

```bash
bash deploy/scripts/deploy.sh update
# Séquence : backup → git pull → rebuild → restart → health check
```

### 6.4 Sauvegarde / Restauration

```bash
# Backup manuel
bash deploy/scripts/backup.sh

# Restauration
bash deploy/scripts/restore.sh /backups/daily/solidata_20260315_020000.dump.gz
```

### 6.5 Tâches Planifiées (Cron)

| Horaire | Tâche |
|---------|-------|
| `0 2 * * *` | Backup quotidien base de données |
| `*/5 * * * *` | Health check (containers + endpoints + disque) |
| `0 3,15 * * *` | Renouvellement certificat SSL |
| `0 4 * * 0` | Nettoyage images Docker orphelines |
| `0 5 1 * *` | Purge logs applicatifs > 30 jours |

### 6.6 Monitoring

**health-check.sh** vérifie toutes les 5 minutes :
- Statut des 7 containers (db, backend, frontend, mobile, nginx, redis, certbot)
- Réponses HTTP (frontend 200, API 401, mobile 200)
- Espace disque (alerte 80 %, critique 90 %)
- Mémoire utilisée
- Auto-restart des containers tombés

---

## 7. RGPD & Conformité

### 7.1 Traitements de Données

L'application traite des données personnelles de :
- **Candidats** : nom, email, téléphone, CV, compétences, profil PCM
- **Salariés CDDI** : données d'insertion (parcours social, évaluations, objectifs)
- **Collaborateurs** : informations contractuelles, heures, compétences

### 7.2 Fonctionnalités RGPD Implémentées

| Article | Droit | Endpoint | Implémenté |
|---------|-------|----------|-----------|
| Art. 15 | Droit d'accès | `GET /api/rgpd/export/:type/:id` | Oui |
| Art. 17 | Droit à l'effacement | `POST /api/rgpd/anonymize/:type/:id` | Oui |
| Art. 30 | Registre des traitements | `GET/POST /api/rgpd/registre` | Oui |
| — | Consentement | `GET/POST /api/rgpd/consent` | Oui |
| — | Purge automatique | `POST /api/rgpd/purge-expired` | Oui (24 mois) |
| — | Journal d'audit | `GET /api/rgpd/audit` | Oui |

### 7.3 Anonymisation

Le processus d'anonymisation (Art. 17) :
1. Noms → "ANONYME" + "CANDIDAT-{id}" ou "EMPLOYE-{id}"
2. Email, téléphone → NULL
3. CV fichier supprimé, texte brut → NULL
4. Commentaires entretien → NULL
5. Compétences détectées → supprimées
6. Profils PCM → supprimés
7. Photo employé → supprimée
8. Compte utilisateur associé → désactivé

Toutes les opérations sont effectuées dans une **transaction ACID** avec rollback en cas d'erreur.

---

## 8. Variables d'Environnement

| Variable | Description | Défaut | Obligatoire |
|----------|-------------|--------|------------|
| `DB_HOST` | Hôte PostgreSQL | localhost | Oui |
| `DB_PORT` | Port PostgreSQL | 5432 | Non |
| `DB_NAME` | Nom base | solidata | Oui |
| `DB_USER` | Utilisateur DB | solidata_user | Oui |
| `DB_PASSWORD` | Mot de passe DB | — | **Oui (prod)** |
| `JWT_SECRET` | Secret JWT | — | **Oui (prod)** |
| `JWT_EXPIRES_IN` | Durée token | 8h | Non |
| `JWT_REFRESH_EXPIRES_IN` | Durée refresh | 7d | Non |
| `PORT` | Port backend | 3001 | Non |
| `NODE_ENV` | Environnement | development | Oui |
| `BREVO_API_KEY` | Clé API Brevo | — | Oui (SMS/email) |
| `REDIS_HOST` | Hôte Redis | localhost | Non |
| `REDIS_PORT` | Port Redis | 6379 | Non |
| `ROUEN_LAT` | Latitude centre | 49.4432 | Non |
| `ROUEN_LNG` | Longitude centre | 1.0999 | Non |

---

*Documentation applicative SOLIDATA ERP v1.2.0 — Solidarité Textile, Rouen — 19 mars 2026.*

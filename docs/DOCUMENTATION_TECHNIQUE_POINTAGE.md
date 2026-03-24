# Documentation technique — Module Pointage / Badgeage

## Vue d'ensemble

Le module de pointage permet le suivi automatique des heures de travail des collaborateurs du centre de tri et de la logistique via un système de badge NFC. Il s'intègre dans l'application Solidata existante (Node.js/Express + React + PostgreSQL).

### Architecture

```
┌──────────────┐     POST /api/pointage/badge     ┌──────────────────┐
│  Raspberry Pi │ ─────────────────────────────────→│  VPS Scaleway    │
│  + Lecteur    │     (Ethernet, TLS)              │  Solidata API    │
│  ACR122U      │ ←─────────────────────────────────│  (Express.js)    │
└──────────────┘     JSON response                 └────────┬─────────┘
                                                            │
                                                   ┌────────▼─────────┐
                                                   │   PostgreSQL 15  │
                                                   │   + PostGIS      │
                                                   └──────────────────┘
```

---

## Base de données

### Nouvelles tables

#### `pointage_terminals`
Terminaux de lecture de badge autorisés.

| Colonne | Type | Description |
|---|---|---|
| id | SERIAL PK | Identifiant |
| name | VARCHAR(100) | Nom du terminal |
| location | VARCHAR(200) | Emplacement physique |
| api_key | VARCHAR(255) UNIQUE | Clé d'authentification API |
| is_active | BOOLEAN | Terminal actif |
| last_ping | TIMESTAMP | Dernier signe de vie |
| created_at | TIMESTAMP | Date de création |

#### `badges`
Badges NFC assignés aux collaborateurs.

| Colonne | Type | Description |
|---|---|---|
| id | SERIAL PK | Identifiant |
| badge_uid | VARCHAR(50) UNIQUE | UID MIFARE du badge |
| employee_id | INTEGER FK → employees | Collaborateur assigné |
| label | VARCHAR(100) | Libellé optionnel |
| is_active | BOOLEAN | Badge actif |
| assigned_at | TIMESTAMP | Date d'assignation |
| unassigned_at | TIMESTAMP | Date de désactivation |
| created_at | TIMESTAMP | Date d'enregistrement |

#### `pointage_events`
Registre de tous les événements de badgeage.

| Colonne | Type | Description |
|---|---|---|
| id | SERIAL PK | Identifiant |
| employee_id | INTEGER FK → employees | Collaborateur |
| badge_uid | VARCHAR(50) | UID du badge scanné |
| terminal_id | INTEGER FK → pointage_terminals | Terminal source |
| date | DATE | Jour de l'événement |
| event_time | TIMESTAMP | Horodatage précis |
| event_type | VARCHAR(20) | `entry`, `exit`, `unknown`, `excess` |
| status | VARCHAR(20) | `accepted`, `rejected`, `duplicate` |
| source | VARCHAR(20) | `badge` ou `manual` |
| notes | TEXT | Notes (motif saisie manuelle, etc.) |
| created_by | INTEGER FK → users | Utilisateur (saisie manuelle) |
| created_at | TIMESTAMP | Date de création |

### Index de performance
```sql
idx_pointage_events_date      ON pointage_events(date)
idx_pointage_events_employee  ON pointage_events(employee_id, date)
idx_badges_uid                ON badges(badge_uid)
idx_badges_employee           ON badges(employee_id)
```

### Relation avec les tables existantes
- `pointage_events.employee_id` → `employees.id` (FK)
- Les heures calculées sont insérées/mises à jour dans `work_hours` (table existante)
- Les alertes utilisent `schedule` (table existante) pour identifier les absences

---

## API Backend

### Fichier : `backend/src/routes/pointage.js`

### Endpoint borne (sans authentification utilisateur)

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/pointage/badge` | Clé API terminal | Réception d'un badgeage |

**Requête :**
```json
{
  "badge_uid": "A1B2C3D4",
  "terminal_key": "sk_terminal_xxxxx"
}
```

**Réponses possibles :**
```json
// Accepté
{ "status": "accepted", "event_type": "entry", "event_number": 1, "employee_name": "Jean Dupont", "message": "Bonjour Jean !" }

// Doublon (< 60s)
{ "status": "duplicate", "message": "Doublon ignoré (12s)" }

// Badge inconnu
{ "error": "Badge non reconnu", "badge_uid": "A1B2C3D4" }

// Maximum atteint
{ "status": "rejected", "message": "Maximum 4 badgeages par jour atteint" }
```

### Endpoints protégés (JWT)

| Méthode | Route | Rôles | Description |
|---|---|---|---|
| GET | `/api/pointage/events` | ADMIN, RH, MANAGER | Liste des événements |
| GET | `/api/pointage/daily-summary` | ADMIN, RH, MANAGER | Résumé journalier |
| GET | `/api/pointage/monthly-summary` | ADMIN, RH, MANAGER | Résumé mensuel |
| POST | `/api/pointage/manual` | ADMIN, RH, MANAGER | Saisie manuelle |
| GET | `/api/pointage/badges` | ADMIN, RH | Liste des badges |
| POST | `/api/pointage/badges` | ADMIN, RH | Enregistrer un badge |
| PUT | `/api/pointage/badges/:id/assign` | ADMIN, RH | Affecter un badge |
| PUT | `/api/pointage/badges/:id/deactivate` | ADMIN, RH | Désactiver un badge |
| GET | `/api/pointage/terminals` | ADMIN | Liste des terminaux |
| POST | `/api/pointage/terminals` | ADMIN | Ajouter un terminal |
| GET | `/api/pointage/alerts` | ADMIN, RH, MANAGER | Alertes non-badgeage |
| GET | `/api/pointage/movement-log` | ADMIN, RH, MANAGER | Registre des mouvements |

---

## Logique métier

### Flux de badgeage

```
Badge présenté
    │
    ▼
Vérifier clé terminal ──→ 403 si invalide
    │
    ▼
Trouver badge + employé ──→ 404 + log "unknown" si inconnu
    │
    ▼
Anti-doublon (60s) ──→ Retour "duplicate" si < 60s
    │
    ▼
Vérifier max 4/jour ──→ "rejected" si max atteint
    │
    ▼
Déterminer type (entry/exit) ──→ pair = entry, impair = exit
    │
    ▼
Enregistrer événement
    │
    ▼
Si 4e badgeage → calculer heures → upsert work_hours
```

### Calcul automatique des heures
Quand un collaborateur a ses 4 badgeages :
1. Récupérer les 4 événements triés par heure
2. Calculer : `(sortie_matin - entrée_matin) + (sortie_PM - entrée_PM)`
3. Convertir en heures décimales
4. Heures sup = max(0, total - 7h)
5. Upsert dans `work_hours` avec note "Calculé automatiquement par badgeage"

### Système d'alertes
L'endpoint `/api/pointage/alerts` compare :
- Les collaborateurs avec `schedule.status = 'work'` pour la date donnée
- Vs les `pointage_events` enregistrés
- Retourne ceux qui ont 0 badgeage ("absent") ou < 4 ("incomplet")

---

## Frontend

### Fichier : `frontend/src/pages/Pointage.jsx`

### Onglets

| Onglet | Fonctionnalité | Rôle requis |
|---|---|---|
| **Journée** | Vue du jour : tous les collaborateurs, leurs 4 pointages, heures calculées | ADMIN, RH, MANAGER |
| **Badges** | CRUD badges, affectation aux collaborateurs | ADMIN, RH |
| **Saisie manuelle** | Formulaire pour saisir/corriger les horaires | MANAGER |
| **Alertes** | Liste des collaborateurs planifiés non badgés | ADMIN, RH, MANAGER |
| **Registre** | Log complet des mouvements (badges + manuels) | ADMIN, RH, MANAGER |
| **Mensuel** | Résumé mensuel par collaborateur (heures, jours, HS) | ADMIN, RH, MANAGER |

### Navigation
- Menu latéral : section "Gestion Équipe" → "Pointage" (icône badge)
- Route : `/pointage`
- Accessible aux rôles ADMIN, RH et MANAGER

---

## Logiciel embarqué (Raspberry Pi)

### Prérequis
- Raspberry Pi 4 sous Raspberry Pi OS Lite (64-bit)
- Node.js 20 LTS
- Package `nfc-pcsc` pour la lecture NFC
- Lecteur ACR122U connecté en USB

### Script de lecture (`badge-reader.js`)

Le script fonctionne en boucle :
1. Attente d'un badge sur le lecteur
2. Lecture de l'UID
3. `POST` vers `https://solidata.online/api/pointage/badge`
4. Affichage du résultat (LED/buzzer/écran)
5. Retour en attente

### Mode offline
En cas de perte réseau :
1. Les événements sont stockés localement dans un fichier SQLite
2. Un job cron tente de renvoyer les événements en attente toutes les 30 secondes
3. Une fois l'API accessible, les événements sont envoyés et marqués comme synchronisés

### Installation

```bash
# Sur le Raspberry Pi
sudo apt update && sudo apt install -y libnfc-dev libpcsclite-dev pcscd
npm install nfc-pcsc

# Service systemd pour démarrage automatique
sudo systemctl enable badge-reader.service
```

---

## Déploiement

### Backend
1. Le fichier `pointage.js` est automatiquement chargé via `index.js`
2. Les tables sont créées par `init-db.js` au démarrage
3. Aucune migration manuelle nécessaire

### Frontend
1. La page `Pointage.jsx` est importée dans `App.jsx`
2. La route `/pointage` est protégée par rôle
3. Le menu latéral inclut l'entrée "Pointage"

### Premier lancement
1. Créer un terminal : `POST /api/pointage/terminals` avec une clé API
2. Enregistrer les badges : `POST /api/pointage/badges` avec les UID
3. Affecter les badges aux collaborateurs
4. Configurer le Raspberry Pi avec la clé API du terminal
5. Tester avec un badge

---

## Paramètres configurables

| Paramètre | Valeur par défaut | Description |
|---|---|---|
| `ANTI_DOUBLON_SECONDS` | 60 | Délai anti-doublon en secondes |
| `MAX_BADGEAGES_PAR_JOUR` | 4 | Nombre maximum de badgeages par jour |
| Seuil heures sup | 7h/jour | Au-delà = heures supplémentaires |

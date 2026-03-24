# SolTex — Solidarité Textiles

## Project Overview
Application de gestion des candidatures et d'analyse de personnalité PCM pour l'insertion professionnelle dans le secteur textile.

## Stack technique
- **Frontend** : React 18 (single file App.js) + Nginx
- **Backend** : FastAPI (Python 3.11) + SQLite
- **Conteneurisation** : Docker Compose
- **OCR** : Tesseract (fra + eng) pour parsing CV
- **Déploiement** : VPS Scaleway (anciennement Synology NAS DSM 7)
- **Ports** : Frontend 8082, Backend API 8001

## Architecture des fichiers

```
solidarite-textiles/
├── docker-compose.yml              # Orchestration Docker
├── backend/
│   ├── Dockerfile                  # Python 3.11 + Tesseract OCR
│   ├── requirements.txt            # FastAPI, pdfplumber, PyMuPDF, python-docx, pytesseract, Pillow
│   ├── main.py                     # API FastAPI (~820 lignes) — toutes les routes
│   ├── pcm_engine.py               # Moteur d'analyse PCM — scoring Base/Phase
│   └── pcm_data.json               # Données référence 6 profils + 20 questions
├── frontend/
│   ├── Dockerfile                  # Node 18 + Nginx
│   ├── nginx.conf                  # Proxy /api/ → backend:8000
│   ├── package.json
│   ├── public/index.html
│   └── src/
│       ├── index.js
│       └── App.js                  # Interface React complète (~1800 lignes, single file)
└── data/                           # NON versionné — données runtime
    ├── soltext.db                  # Base SQLite
    └── cvs/                        # CVs uploadés
```

## Base de données SQLite

### Tables principales
- **candidates** : id, first_name, last_name, email, gender, position_id, comment, kanban_status, cv_raw_text, cv_file_path, pcm_test_id, created_at
- **positions** : id, title, type, month, slots_open, slots_filled, created_at
- **position_types** : id, code, label, description
- **kanban_history** : id, candidate_id, from_status, to_status, moved_at
- **pcm_tests** : id, candidate_id, status, completed_at
- **pcm_profiles** : id, test_id, candidate_id, base_type, phase_type, score_analyseur/perseverant/promoteur/empathique/energiseur/imagineur, perception_dominante, canal_communication, besoin_psychologique, driver_principal, masque_stress, scenario_stress, rps_risk_level, rps_indicators, tp_correlation, communication_tips, environment_tips, created_at

### Kanban statuses
`received` → `preselected` → `interview` → `test` → `hired`

## Routes API (backend/main.py)

### Candidats
- `GET /api/candidates` — liste tous les candidats
- `POST /api/candidates` — créer (avec cv_raw_text, cv_file_path optionnels)
- `PUT /api/candidates/{id}` — modifier
- `DELETE /api/candidates/{id}` — supprimer (cascade history + pcm)
- `POST /api/candidates/{id}/move` — déplacer dans le Kanban
- `GET /api/candidates/{id}/history` — historique mouvements

### Postes
- `GET /api/positions` — liste
- `POST /api/positions` — créer
- `PUT /api/positions/{id}` — modifier
- `DELETE /api/positions/{id}` — supprimer (désaffecte candidats)
- `GET /api/position-types` / `POST /api/position-types` / `DELETE /api/position-types/{id}`

### CV Upload
- `POST /api/upload/cv` — upload fichier (multipart), retourne extracted_text + stored_path
- `GET /api/cv/{filename}` — télécharger un CV stocké

### PCM
- `GET /api/pcm/questionnaire` — 20 questions du questionnaire
- `POST /api/pcm/submit` — soumettre réponses, calcul + stockage profil
- `GET /api/pcm/types` — référence 6 types PCM
- `GET /api/pcm/types/{type_key}` — détail d'un type
- `GET /api/pcm/profiles` — tous les profils générés
- `GET /api/pcm/profiles/{candidate_id}` — profil d'un candidat

### Autres
- `GET /api/stats` — KPIs dashboard
- `GET /api/health` — health check

## Frontend (frontend/src/App.js)

Single-file React avec composants inline :
- **Dashboard** : KPIs temps réel (candidatures, entretiens, recrutements)
- **KanbanBoard** : 5 colonnes, drag & drop, panneau détail candidat
- **AddCandidateModal** : formulaire + zone drag & drop CV (PDF/Word/Image) + auto-détection nom/email
- **CandidateDetailPanel** : fiche candidat, modification, historique mouvements
- **PCMPage** : 3 vues (liste candidats, questionnaire interactif, rapport profil)
- **PCMQuestionnaire** : 20 questions une par une, barre progression, navigation
- **PCMProfileReport** : rapport enrichi (Base, Phase, Immeuble, Stress 3 niveaux, Guide manager DO/DON'T, RPS, correspondances TP)
- **PositionsPage** : CRUD postes, types, regroupement par mois

## Modèle PCM

6 types de personnalité (nomenclature 2024) :
- **Analyseur** (ex-Travaillomane) : Pensées factuelles, Canal Interrogatif
- **Persévérant** : Opinions, Canal Interrogatif
- **Empathique** : Émotions, Canal Nourricier
- **Imagineur** (ex-Rêveur) : Imagination, Canal Directif
- **Énergiseur** (ex-Rebelle) : Réactions, Canal Ludique
- **Promoteur** : Actions, Canal Directif

Scoring : Base déterminée par questions perception/points_forts/relation. Phase par motivation/stress.

## Charte graphique
- Vert principal : #008678
- Jaune accent : #FFDC80
- Dark : #253036
- Background : #f0f2f5
- Police : système (-apple-system, Segoe UI, Roboto)

## Étapes complétées
1. ✅ Architecture technique
2. ✅ Interface UI + Déploiement Docker
3. ✅ Gestion postes CRUD
4. ✅ Upload CV drag & drop + parsing PDF/Word/OCR
5. ✅ Kanban 5 colonnes persistant API
6. ✅ Questionnaire PCM 20 questions + moteur scoring
7. ✅ Rapport PCM enrichi (stress, guide manager, RPS, TP)

## Prochaine étape
8. ⏳ Export fiche SIRH (PDF) — génération PDF avec données candidat + profil PCM

## Commandes utiles

```bash
# Déploiement
cd /volume1/docker/soltext-app
docker-compose up -d --build

# Git
git add . && git commit -m "description" && git push

# Logs
docker logs soltext-backend -f
docker logs soltext-frontend -f

# Base de données
docker exec -it soltext-backend sqlite3 /app/data/soltext.db ".tables"
```

## Sources PCM
- Kahler T. (1982) — Process Communication Model
- Chedeville R. — Thèse PCM / Troubles de personnalité
- Coaching Kit Kahler Communications 2024
- Documents disponibles dans le projet Claude

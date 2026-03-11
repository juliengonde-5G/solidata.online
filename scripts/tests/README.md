# Tests techniques — SOLIDATA ERP

Ce dossier contient les scripts de tests techniques utilisés en phase de déploiement (recette, smoke tests post-déploiement).

## api-smoke.js

Script Node.js (sans dépendance externe) qui enchaîne :

1. **Health check** : `GET /api/health` (disponibilité + base de données)
2. **Login** (si `API_USER` et `API_PASSWORD` fournis) : `POST /api/auth/login`
3. **Endpoints protégés** (si token obtenu) :
   - `GET /api/auth/me`
   - `GET /api/historique/kpi`
   - `GET /api/candidates/kanban`
   - `GET /api/tours`
   - `GET /api/vehicles`
   - `GET /api/employees`

### Usage

```bash
# Depuis la racine du projet
cd "c:\Users\julie\...\solidata.online"

# Backend local (défaut http://localhost:5000)
node scripts/tests/api-smoke.js

# Préproduction / production
set BASE_URL=https://recette.solidata.online
node scripts/tests/api-smoke.js

# Avec authentification (pour tester les routes protégées)
set BASE_URL=https://recette.solidata.online
set API_USER=admin
set API_PASSWORD=votre_mot_de_passe
node scripts/tests/api-smoke.js
```

Sous Linux/macOS : `export BASE_URL=...` puis `node scripts/tests/api-smoke.js`.

### Sortie

- Chaque ligne affiche `[OK]` ou `[FAIL]` pour une étape.
- En cas d’échec, le script quitte avec le code 1 (utile en CI/CD).

### Référence

Plan complet des tests (techniques + comportementaux par persona) : **`docs/PLAN_TESTS_DEPLOIEMENT.md`**.

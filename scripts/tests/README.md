# Tests techniques — SOLIDATA ERP

Ce dossier contient les scripts de tests techniques utilisés en phase de déploiement (recette, smoke tests post-déploiement).

## api-smoke.js

Script Node.js (sans dépendance externe) qui enchaîne :

1. **Health check** : `GET /api/health` (disponibilité + base de données)
2. **Identité de service** (si `SMOKE_API_KEY` fournie) : `GET /api/auth/me` avec l'en-tête `X-API-Key`.
   Le script **ne se connecte plus** : il présente une clé d'API de service en lecture seule.
   Création : dans le conteneur backend, `node src/scripts/creer-cle-api.js --apply`.
3. **Endpoints protégés** (si la clé est acceptée) :
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

# Avec la clé d'API de service (pour tester les routes protégées)
set BASE_URL=https://recette.solidata.online
set SMOKE_API_KEY=sol_xxxxxxxx_yyyyyyyy
node scripts/tests/api-smoke.js
```

Sous Linux/macOS : `export BASE_URL=...` puis `node scripts/tests/api-smoke.js`.

> **Deux échecs de connexion volontaires au journal.** La section « Autocontrôles de sécurité » du script tente une connexion avec l'identifiant **réservé** `smoke-test-identifiant-invalide` (qui n'existe dans aucun compte), puis avec une chaîne d'injection SQL. Les deux DOIVENT être refusées : c'est ce qui est vérifié. Quand ces deux échecs apparaissent au journal depuis l'adresse du serveur juste après un déploiement, c'est l'autocontrôle — pas une intrusion.

### Sortie

- Chaque ligne affiche `[OK]` ou `[FAIL]` pour une étape.
- En cas d’échec, le script quitte avec le code 1 (utile en CI/CD).

### Référence

Plan complet des tests (techniques + comportementaux par persona) : **`docs/PLAN_TESTS_DEPLOIEMENT.md`**.

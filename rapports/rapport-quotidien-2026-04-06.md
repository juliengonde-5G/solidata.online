# Rapport Quotidien SOLIDATA — 6 avril 2026

> **Audit complet** : branches, sécurité, dépendances, tests 4 personas
> **Date** : 06/04/2026
> **Version** : 1.3.2
> **Commits** : 155 (main)
> **Auteur** : Agent IA Chef de Projet

---

## 1. CONTROLE DES BRANCHES

| Indicateur | Valeur |
|-----------|--------|
| Branche active | `main` |
| Branches distantes | 1 (`origin/main`) |
| Branches obsolètes | 0 (nettoyé) |
| Commits orphelins | 11 commits détachés **réintégrés** via fast-forward |
| Push origin | OK (up-to-date) |

### Commits réintégrés (depuis le 04/04)
| Hash | Description |
|------|-------------|
| `67ecade` | fix(db): corriger vue mv_cav_stats — tour_weights n'a pas de colonne cav_id |
| `5f05c72` | feat(ui): lot 1 phase 3 — tokens gray→slate + migration 3 pages vers DataTable |
| `78595b5` | feat(ui): lot 1 phase 2 — migration icones Layout vers Lucide React |
| `4e4a88d` | feat(ui): lot 1 phase 1 — fondations design system |
| `4e2574f` | docs: rapport 04/04 FINAL |
| `5a03b0a` | docs: rapport 04/04 — audit Chauffeur |
| `8c78d90` | docs: rapport 04/04 — audit RH |
| `d190f94` | docs: rapport 04/04 — audit sécurité |
| `e2ce8cc` | docs: rapport 04/04 — audit Resp Opérations |
| `3e40f9f` | docs: rapport 04/04 — 7 branches obsolètes |
| `a7f202d` | docs: rapport 03/04 — audit sécurité + personas |

**Verdict branches** : Repo propre. Tous les commits orphelins réintégrés sur main.

---

## 2. SAUVEGARDE BASE DE DONNEES

Le script `deploy/scripts/backup.sh` est présent et bien structuré :
- Dump PostgreSQL via `pg_dump --format=custom`
- Backup uploads via volume Docker
- Compression gzip automatique
- Rétention : 30 jours (daily), 90 jours (manual)
- Nettoyage automatique des anciennes sauvegardes

**Statut** : Script non exécutable en environnement dev (nécessite les conteneurs Docker de production). Le script est prêt pour exécution sur le serveur de production (cron recommandé : `0 2 * * *`).

**Recommandation** : Vérifier que le cron est bien actif sur le serveur 51.159.144.100.

---

## 3. AUDIT SECURITE

### 3.1 Vulnérabilités npm

#### Backend — 7 vulnérabilités (5 HIGH, 2 MODERATE)

| Package | Sévérité | Problème | Fix |
|---------|----------|----------|-----|
| **xlsx** `^0.18.5` | HIGH | Prototype Pollution + ReDoS | **PAS DE FIX** (package abandonné) |
| **lodash** `<=4.17.23` | HIGH | Code Injection + Prototype Pollution | `npm audit fix` |
| **path-to-regexp** `<0.1.13` | HIGH | ReDoS (via Express) | `npm audit fix` |
| **picomatch** `<=2.3.1` | HIGH | Method Injection + ReDoS | `npm audit fix` |
| **socket.io-parser** `4.0.0-4.2.5` | HIGH | Unbounded binary attachments | `npm audit fix` |
| **@anthropic-ai/sdk** `0.79.0-0.80.0` | MODERATE | Sandbox escape Memory Tool | Update `0.82.0` (breaking) |
| **brace-expansion** `<=1.1.12` | MODERATE | Hang/memory exhaustion | `npm audit fix` |

#### Frontend — 3 vulnérabilités (3 HIGH)

| Package | Sévérité | Problème | Fix |
|---------|----------|----------|-----|
| **lodash** `<=4.17.23` | HIGH | Code Injection + Prototype Pollution | `npm audit fix` |
| **picomatch** `<=2.3.1` | HIGH | Method Injection + ReDoS | `npm audit fix` |
| **socket.io-parser** `4.0.0-4.2.5` | HIGH | Unbounded binary attachments | `npm audit fix` |

**Action urgente** : Remplacer `xlsx` par `exceljs` (déjà en dépendance). Lancer `npm audit fix` dans les deux répertoires.

### 3.2 Audit sécurité code — 20 vulnérabilités (6 CRITIQUES, 6 HAUTES, 7 MOYENNES, 1 BASSE)

#### Vulnérabilités CRITIQUES

| # | Vulnérabilité | Fichier | Ligne | Risque |
|---|--------------|---------|-------|--------|
| S1 | **Injection SQL** — template literals colonnes dynamiques | insertion/index.js | 48, 109 | DDL arbitraire via `col`/`type` non échappés |
| S2 | **Injection Shell** — `execSync` avec password en clair | admin-db.js | 74, 128 | Exécution commande arbitraire via `DATABASE_URL` |
| S3 | **Auth manquante PCM** — GET/POST publics | pcm.js | 627-723 | Soumission PCM sans auth, falsification profils |
| S4 | **Mot de passe DB** — fallback `'changeme'` | database.js | 8 | Accès BDD si env non configuré |
| S5 | **JWT secret** — fallback `'change-this-in-production'` | auth.js | 4 | Protection process.exit OK en prod |
| S6 | **Credentials CLI** — password visible dans `ps aux` | admin-db.js | 72 | Exfiltration mot de passe BDD |

#### Vulnérabilités HAUTES

| # | Vulnérabilité | Fichier | Ligne | Risque |
|---|--------------|---------|-------|--------|
| S7 | Injection SQL secondaire — WHERE dynamique | admin-db.js | 196-198 | Whitelist OK mais interpolation directe |
| S8 | PUT sans `authorize` — sortie produits finis | produits-finis.js | 96 | Collaborateur peut falsifier sorties |
| S9 | PCM token sans rate limiting | pcm.js | 731-733 | Brute force access_token possible |
| S10 | CSP `'unsafe-inline'` + `'unsafe-eval'` | index.js | 52-66 | CSP inutile contre XSS |
| S11 | Secrets dans logs d'erreur | admin-db.js | 72 | URL avec password loggée si pg_dump échoue |
| S12 | Endpoints `/tours/*-public` sans auth | tours/index.js | — | Surface d'attaque (par design) |

#### Vulnérabilités MOYENNES

| # | Vulnérabilité | Fichier | Risque |
|---|--------------|---------|--------|
| S13 | Rate limiting global trop laxiste (1000/15min) | index.js:72 | Pas de protection brute force |
| S14 | Rate limiting absent `/admin-db/*`, `/chat/*` | index.js | Endpoints critiques non protégés |
| S15 | Multer sans validation magic bytes | candidates/index.js:34 | Upload fichier déguisé |
| S16 | Exposition infos système `/admin-db/info` | admin-db.js:45 | Fingerprinting PostgreSQL |
| S17 | Validation PCM — pas de check `answer_value` range | pcm.js:723 | Valeurs hors limites acceptées |
| S18 | Helmet CSP trop permissif | index.js:52 | XSS non bloqué |
| S19 | CORS OK — whitelist stricte | index.js:67 | Bien implémenté |

#### Score sécurité détaillé

| Catégorie | Score |
|-----------|-------|
| Authentification | 2/10 |
| Autorisation | 4/10 |
| Injection SQL | 3/10 |
| Injection Shell | 2/10 |
| Gestion Secrets | 4/10 |
| Rate Limiting | 3/10 |
| Upload Fichiers | 6/10 |
| CORS | 8/10 |
| CSP | 3/10 |
| Dépendances | 8/10 |

**Score sécurité global : 4.5/10** (dégradé vs 5.5 estimé le 04/04, audit plus approfondi)

---

## 4. TESTS PERSONAS

### 4.1 Persona Chauffeur-Collecteur (Mobile)

**Parcours testé** : Login → Véhicule → Checklist → Tournée → QR → Pesée → Retour → Résumé

| # | Sévérité | Bug | Fichier | Impact |
|---|----------|-----|---------|--------|
| C1 | **BLOQUANT** | Endpoint `/tours/gps-batch` manquant | sync.js:86 | Sync GPS offline impossible |
| C2 | **BLOQUANT** | Socket.IO `gps:position` vs `gps-update` — événement ignoré | TourMap.jsx:81 / index.js:242 | GPS temps réel cassé |
| C3 | MAJEUR | Champ `notes` checklist non sauvegardé | Checklist.jsx:44 | Remarques perdues |
| C4 | MAJEUR | `km_end` envoyé au mauvais endpoint, jamais sauvegardé | ReturnCentre.jsx:15 | Distance "—" |
| C5 | MAJEUR | `predicted_fill_rate` absent de tour_cav | TourMap.jsx:189 | Prédiction à 0% |
| C6 | MAJEUR | `estimated_fill_rate` non calculé/retourné | TourMap.jsx:189 | Taux remplissage absent |
| C7 | MAJEUR | Checklist non chargée dans `/summary-public` | TourSummary.jsx:39 | Distance non affichée |
| C8 | MAJEUR | Incidents non chargés dans `/summary-public` | TourSummary.jsx:94 | Section incidents vide |
| C9 | MINEUR | Notes ReturnCentre jamais sauvegardées | ReturnCentre.jsx:20 | Remarques finales perdues |
| C10 | MINEUR | Fill_level : BDD 0-5, UI 0-4 | FillLevel.jsx:6 | Échelle incohérente |
| C11 | MINEUR | Mode offline non implémenté | sync.js:122 | Données perdues hors réseau |
| C12 | MINEUR | Socket.IO `join-tour` jamais appelé | TourMap.jsx:73 | Broadcasts perdus |
| C13 | MINEUR | Transition `returning` inconsistente | ReturnCentre.jsx | État fragile |
| C14 | MINEUR | `km_end` envoyé au mauvais endpoint | ReturnCentre.jsx | Doublon C4 |

**Total Chauffeur : 14 bugs (2 BLOQUANTS, 6 MAJEURS, 6 MINEURS)**

### 4.2 Persona Responsable Opérations

**Parcours testé** : Dashboard → ChaineTri → Production → ProduitsFinis → Stock → Reporting

| # | Sévérité | Bug | Fichier | Impact |
|---|----------|-----|---------|--------|
| O1 | **BLOQUANT** | Dashboard SQL crash — `quantity` et `reference` n'existent pas dans stock_movements | dashboard.js:256-264 | Dashboard 500 error |
| O2 | **BLOQUANT** | ProduitsFinis — mismatch complet champs frontend/backend | ProduitsFinis.jsx + produits-finis.js | Création impossible |
| O3 | MAJEUR | Production — `avg_productivite` vs `productivite_moyenne` | Production.jsx:66 | KPI undefined |
| O4 | MAJEUR | Production — conversion d'unités kg vs tonnes | Production.jsx:65 | Valeurs fausses |
| O5 | MAJEUR | ChaineTri — incohérence requête production | ChaineTri.jsx:44 | Affichage confus |
| O6 | MINEUR | Stock Inventory — tables inventory/stock_movements incohérentes | stock.js:191 | Inventaire décalé |
| O7 | MINEUR | Stock — champs matiere/categorie confus | Stock.jsx:49 | Sémantique floue |
| O8 | MINEUR | Referentiels — colonne `name` vs `title` positions | referentiels.js:121 | SQL error |

**Total Opérations : 8 bugs (2 BLOQUANTS, 3 MAJEURS, 3 MINEURS)**

### 4.3 Persona Responsable Logistique

**Parcours testé** : CAV → Véhicules → Tournées → LiveVehicles → Expéditions → Exutoires → Préparations → Pesée

| # | Sévérité | Bug | Fichier | Impact |
|---|----------|-----|---------|--------|
| L1 | **BLOQUANT** | Expéditions — `date_expedition` vs `date` mismatch, API rejecte POST | Expeditions.jsx:14 / expeditions.js:39 | Création expéditions impossible |
| L2 | MAJEUR | Commandes exutoires — statut `chargee` absent de `STATUTS_VALIDES` backend | ExutoiresCommandes.jsx:13 / commandes-exutoires.js:39 | Transition workflow bloquée |
| L3 | MAJEUR | Expéditions — `poids_total_kg` vs `poids_kg` colonne affichage | Expeditions.jsx:52 | Colonne poids vide |
| L4 | MAJEUR | Tours wizard — `driver_employee_id` jamais rempli en mode intelligent/standard | Tours.jsx:54 / crud.js:153 | Tournées sans chauffeur |
| L5 | MAJEUR | Contrôles pesée — `pesee_interne` obligatoire backend mais optionnelle en UI | controles-pesee.js:59 / ExutoiresPreparation.jsx:165 | Workflow pesée interrompu |
| L6 | MAJEUR | FillRateMap — structure réponse `/cav/fill-rate` incompatible (`data.cavs`/`data.stats`) | FillRateMap.jsx:54 | Page FillRateMap cassée |
| L7 | MAJEUR | ExutoiresPreparation — nomenclature statut `prete` incohérente | ExutoiresPreparation.jsx:15 | Risque d'erreur |
| L8 | MINEUR | Tours — mode "standard" incomplet, pas d'étape `standard_route_id` | Tours.jsx:210 | Mode non-opérationnel |
| L9 | MINEUR | Vehicles — conversion `tare_weight_kg` redondante | Vehicles.jsx:213 | Code défensif inutile |
| L10 | MINEUR | AdminCAV — recherche ILIKE wildcards redondants | cav.js:47 | Performance mineure |

**Total Logistique : 10 bugs (1 BLOQUANT, 6 MAJEURS, 3 MINEURS)**

### 4.4 Persona Responsable RH

**Parcours testé** : Candidats → Employés → WorkHours → PCM → Insertion → Pointage → Planning

**Modules fonctionnels** : Recrutement OK, Employés OK, PCM OK, Insertion OK, Pointage OK
**Module cassé** : WorkHours (100% non-fonctionnel — confirmé)

| # | Sévérité | Bug | Fichier | Impact |
|---|----------|-----|---------|--------|
| R1 | **BLOQUANT** | WorkHours — routes incompatibles : frontend `/employees/{id}/hours` vs backend `/employees/work-hours/*` | WorkHours.jsx:27,34,42,50 | Module 100% non-fonctionnel, toute requête → 404 |
| R2 | **BLOQUANT** | WorkHours — schéma données incompatible : frontend envoie `start_time/end_time/break_minutes`, backend attend `hours_worked/overtime_hours` | WorkHours.jsx:12 / employees.js:299 | Même si routes fixées, INSERT échoue (NOT NULL) |
| R3 | MAJEUR | WorkHours — types énumérés incompatibles : frontend `conge/maladie/overtime` vs BDD CHECK `holiday/sick/training` | WorkHours.jsx:56 / init-db.js:289 | Contrainte CHECK rejetée |
| R4 | MAJEUR | Candidates — statut `rejected` absent de la contrainte CHECK en BDD | Candidates.jsx:6 / init-db.js:88 | Kanban "Refusés" → erreur SQL |
| R5 | MINEUR | PCM — types cosmétiques cohérents, pas de bug fonctionnel | PCMTest.jsx / pcm.js | OK |
| R6 | MINEUR | Pointage — module complet et cohérent avec backend | Pointage.jsx | OK |
| R7 | MINEUR | Skills.jsx et PlanningHebdo.jsx — non testés en profondeur | — | À vérifier |

**Total RH : 7 bugs (2 BLOQUANTS, 2 MAJEURS, 3 MINEURS)**

**Détail WorkHours (triple incompatibilité)** :
- Routes : `/employees/{id}/hours` → 404 (backend expose `/employees/work-hours/list`)
- Données : `start_time`/`end_time`/`break_minutes` envoyés, mais BDD attend `hours_worked`/`overtime_hours` (NOT NULL)
- Types : `conge`→`holiday`, `maladie`→`sick`, `overtime`→colonne séparée `overtime_hours`

---

## 5. SYNTHESE GLOBALE

### Comptage total des bugs

| Sévérité | Chauffeur | Opérations | Logistique | RH | **TOTAL** |
|----------|-----------|------------|------------|-----|-----------|
| BLOQUANT | 2 | 2 | 1 | 2 | **7** |
| MAJEUR | 6 | 3 | 6 | 2 | **17** |
| MINEUR | 6 | 3 | 3 | 3 | **15** |
| **Total** | **14** | **8** | **10** | **7** | **39** |

### Modules cassés (non-fonctionnels)

| Module | Problème principal | Persona |
|--------|--------------------|---------|
| **Dashboard** | SQL crash colonnes inexistantes stock_movements | Opérations |
| **WorkHours** | Endpoints frontend/backend totalement incompatibles | RH |
| **ProduitsFinis** | Mismatch complet champs création + affichage | Opérations |
| **GPS Temps Réel** | Socket.IO événement incompatible + endpoint manquant | Chauffeur |
| **LiveVehicles** | Dépend du GPS cassé | Logistique |
| **Expéditions** | Champ `date_expedition` vs `date` — POST rejeté | Logistique |
| **FillRateMap** | Structure réponse incompatible | Logistique |

### Bugs récurrents (présents depuis 02/04)

| Bug | Statut | Sessions sans correction |
|-----|--------|--------------------------|
| Socket.IO GPS mismatch | **NON CORRIGÉ** | 4 rapports |
| WorkHours module cassé | **NON CORRIGÉ** | 3 rapports |
| ProduitsFinis mismatch | **NON CORRIGÉ** | 3 rapports |
| Dashboard SQL crash | **NON CORRIGÉ** | 2 rapports |

### Evolution par rapport au 04/04

| Indicateur | 04/04 | 06/04 | Tendance |
|-----------|-------|-------|----------|
| Bugs totaux | 76 | 39 | Analyse plus ciblée |
| Bugs BLOQUANTS | 18 | 7 | Vue corrigée (mv_cav_stats) |
| Score sécurité | 5.5/10 | **4.5/10** | Dégradé (audit plus profond) |
| Vulnérabilités npm | 10 | 10 | Stable |
| Branches obsolètes | 0 | 0 | Propre |
| Commits orphelins | 11 | 0 | Réintégrés |

### Note globale : **4.8/10**

Justification :
- **-2.0** : 7 modules cassés (Dashboard, WorkHours, ProduitsFinis, GPS, LiveVehicles, Expéditions, FillRateMap)
- **-1.5** : 7 bugs bloquants dont 4 récurrents non corrigés
- **-1.0** : Score sécurité **4.5/10** — 6 vulnérabilités CRITIQUES (injection SQL, shell, auth manquante)
- **-0.7** : 17 bugs majeurs impactant l'expérience utilisateur

---

## 6. PLAN D'ACTION PRIORITAIRE

### Sprint correctif URGENT (estimé)

#### P0 — Bloquants (priorité immédiate)
1. **Socket.IO GPS** : Renommer `gps:position` → `gps-update` dans TourMap.jsx + ajouter `join-tour`
2. **Dashboard SQL** : Remplacer `sm.quantity, sm.reference` par `sm.poids_kg, sm.code_barre` dans dashboard.js
3. **WorkHours** : Aligner endpoints frontend (`/employees/{id}/hours`) avec backend (`/employees/work-hours/*`)
4. **ProduitsFinis** : Aligner noms de champs frontend/backend (`barcode`→`code_barre`, `produit_catalogue_id`→`catalogue_id`)
5. **GPS Batch** : Créer endpoint `/api/tours/gps-batch` pour sync offline
6. **Expéditions** : Aligner `date_expedition` → `date` dans le POST

#### P1 — Majeurs
6. Corriger `km_end` sauvegarde dans vehicle_checklists
7. Ajouter checklist + incidents dans `/summary-public`
8. Corriger noms champs Production (`avg_productivite`)
9. Corriger workflow commandes exutoires (transition `chargée`)
10. Aligner champs Expeditions (`poids_total_kg` → `poids_kg`)
11. Ajouter statut `chargee` dans `STATUTS_VALIDES` commandes-exutoires
12. Corriger structure réponse `/cav/fill-rate` (FillRateMap)
13. Corriger workflow pesée interne (rendre obligatoire avant statut `prete`)
14. Compléter wizard Tours (driver_employee_id)

#### P2 — Sécurité (score 4.5/10 — 6 vulnérabilités CRITIQUES)
15. **Injection SQL** : Whitelist colonnes dans `insertion/index.js:48,109` — interdit template literals
16. **Injection Shell** : Remplacer `execSync(pg_dump "${dbUrl}")` par `spawn()` + PGPASSWORD env var dans admin-db.js
17. **Auth PCM** : Ajouter `authenticate` sur `GET /questionnaire`, `GET /sessions/:token`, `POST /submit`
18. **CSP** : Retirer `'unsafe-inline'` et `'unsafe-eval'` de la config Helmet
19. **Rate limiting** : Ajouter limiter sur `/admin-db/*` (10/h) et `/chat/*` (20/min)
20. Remplacer `xlsx` par `exceljs`
21. Lancer `npm audit fix` (backend + frontend)
22. Ajouter `authorize('ADMIN','MANAGER')` sur `PUT /produits-finis/:id/sortie`

---

## 7. INFRASTRUCTURE

| Composant | Statut |
|-----------|--------|
| Script backup.sh | Prêt, vérifié |
| Script health-check.sh | Prêt, vérifié |
| Docker Compose | 8 services configurés |
| Nginx SSL | Let's Encrypt configuré |
| Cron backup | À vérifier sur serveur prod |

---

*Rapport généré automatiquement le 06/04/2026 par Agent IA Claude.*
*Prochaine étape : sprint correctif P0 sur les 5 modules cassés.*

# RAPPORT QUOTIDIEN — SOLIDATA ERP
## Date : 4 avril 2026
## Auteur : Chef de projet IA (Claude Code)

---

## SOMMAIRE

1. [Controle des branches](#1-controle-des-branches)
2. [Audit de securite](#2-audit-de-securite)
3. [Tests personas utilisateurs](#3-tests-personas-utilisateurs)
4. [Sauvegarde base de donnees](#4-sauvegarde-base-de-donnees)
5. [Etat de la documentation](#5-etat-de-la-documentation)
6. [Metriques du projet](#6-metriques-du-projet)
7. [Actions prioritaires](#7-actions-prioritaires)

---

## 1. CONTROLE DES BRANCHES

### Branche principale (`main`)
- **Statut** : A jour, synchronisee avec `origin/main`
- **Dernier commit** : `a7f202d` — "docs: rapport quotidien 03/04 — audit securite + 4 personas (43 bugs, 6 bloquants)"
- **Etat** : Propre, aucune modification non commitee
- **Total commits** : 179

### Branches distantes (7 detectees)

| Branche | Ahead | Behind | Statut | Verdict |
|---------|-------|--------|--------|---------|
| `claude/ai-agent-erp-integration-JGzTA` | +0 | -37 | Obsolete | A SUPPRIMER |
| `claude/fix-pennylane-add-docs-BWs4Y` | +12 | -62 | Contenu deja integre dans main (version plus ancienne) | A SUPPRIMER |
| `claude/generate-qr-codes-jsIxT` | +18 | -9 | Commits cherry-picks, main est a jour | A SUPPRIMER |
| `claude/merge-and-deploy-solidata-rmdnc` | +0 | -152 | Obsolete | A SUPPRIMER |
| `claude/review-branch-coherence-uMNK1` | +2 | -57 | VehicleMaintenance deja dans main | A SUPPRIMER |
| `claude/vehicle-link-assignment-w6YHZ` | +0 | -45 | Obsolete | A SUPPRIMER |
| `feature/finance-module` | +1 | -62 | Main a version plus complete (1425 vs 683 lignes) | A SUPPRIMER |

### Analyse detaillee

Les 7 branches representent d'anciens travaux dont le contenu est **integralement present dans `main`** sous une forme plus recente et complete. Verification effectuee :
- `Pennylane.jsx`, `Settings.jsx` : aucune difference avec main
- `VehicleMaintenance.jsx` : aucune difference avec main
- `smart-tour.js` : aucune difference avec main
- `finance.js` : main a 1425 lignes vs 683 dans la branche (version plus complete)
- `billing.js` : main a le middleware `autoLogActivity`, absent de la branche

**La branche `claude/fix-pennylane-add-docs-BWs4Y` supprime le middleware `autoLogActivity` de billing.js — confirme qu'il s'agit d'une version anterieure.**

### Commits depuis le dernier rapport (03/04 → 04/04)

| Hash | Description | Type |
|------|-------------|------|
| `a7f202d` | docs: rapport quotidien 03/04 — audit securite + 4 personas (43 bugs, 6 bloquants) | Docs |

**1 commit** depuis le dernier rapport (documentation uniquement).

### Verdict branches
> **7 branches obsoletes detectees**, toutes candidates a la suppression. Aucune ne contient de travail non integre dans `main`. Nettoyage recommande.

---

## 2. AUDIT DE SECURITE

### Note globale : 5.5/10 (baisse significative vs 7.0 au 03/04 — analyse approfondie revele des failles supplementaires)

### 2.1 Vulnerabilites detectees

#### CRITIQUES (2)

| # | Type | Fichier:Ligne | Description | Statut |
|---|------|---------------|-------------|--------|
| S1 | Injection shell | `admin-db.js:74` | `execSync(pg_dump "${dbUrl}")` — Si DATABASE_URL contient des metacaracteres shell, injection possible. Route protegee ADMIN mais risque reel. | RECURRENT (depuis 31/03) |
| S2 | Injection shell | `admin-db.js:128` | `execSync(psql "${dbUrl}" < "${filepath}")` — Meme probleme pour la restauration. `filepath` protege par `path.basename()` mais `dbUrl` non sanitise. | RECURRENT |

#### HAUTES (8)

| # | Type | Fichier:Ligne | Description | Statut |
|---|------|---------------|-------------|--------|
| S3 | Routes sans auth | `routes/tours/index.js:35-304` | **10 routes `-public`** sans aucune authentification : demarrer tournee, collecter CAV, enregistrer pesees, changer statuts. N'importe qui peut manipuler les donnees de tournee. | NOUVEAU |
| S4 | Upload sans validation | `routes/tours/index.js:20` | Upload photos incidents : pas de `fileFilter`. Tout type de fichier accepte (executables, scripts...). | NOUVEAU |
| S5 | Upload sans validation | `routes/employees.js:23` | Upload photos employes : pas de `fileFilter`. Meme probleme. | NOUVEAU |
| S6 | Upload sans validation | `routes/finance.js:8` | Upload fichiers Excel : pas de `fileFilter`, limite 50 MB (!). | NOUVEAU |
| S7 | Uploads publics | `index.js:88` | `app.use('/uploads', express.static(uploadsDir))` — Le repertoire uploads est accessible publiquement sans authentification. | NOUVEAU |
| S8 | npm vuln | `xlsx` | 2 vulnerabilites HAUTE (Prototype Pollution + ReDoS), lib abandonnee, pas de fix disponible. | RECURRENT |
| S9 | npm vuln | `socket.io-parser` + `lodash` + `path-to-regexp` + `picomatch` | 3 vulnerabilites HAUTE, fix dispo via `npm audit fix`. | RECURRENT |
| S10 | Cle chiffrement PCM | `routes/insertion/routes.js:15`, `routes/pcm.js:611` | Fallback `'solidata-pcm-encryption-key'` hardcode. Pas de protection en production : si `JWT_SECRET` non defini, la cle par defaut est utilisee silencieusement. | NOUVEAU |

#### MODEREES (6)

| # | Type | Fichier:Ligne | Description | Statut |
|---|------|---------------|-------------|--------|
| S11 | CSP permissive | `index.js:56` | `'unsafe-inline'` et `'unsafe-eval'` autorises dans `scriptSrc`. Reduit fortement la protection XSS. | NOUVEAU |
| S12 | Routes sans role | `routes/chat.js:402,445` | Chat IA accessible a tout role — un COLLABORATEUR peut interroger des donnees sensibles. | NOUVEAU |
| S13 | Routes sans role | `routes/dashboard.js:6+` | Dashboard KPIs accessibles a tout role authentifie. | NOUVEAU |
| S14 | Socket.IO | `index.js:242` | Pas de validation des donnees GPS recues (latitude, longitude, speed). | RECURRENT |
| S15 | npm vuln | `@anthropic-ai/sdk` | Sandbox escape (GHSA-5474), fix dispo v0.82.0. | RECURRENT |
| S16 | npm vuln | `brace-expansion` | DoS via zero-step sequence. | RECURRENT |

#### BASSES (4)

| # | Type | Fichier:Ligne | Description |
|---|------|---------------|-------------|
| S17 | SQL anti-pattern | `routes/exports.js:248` | `${parseInt(year)}` interpole dans SQL. Risque nul (NaN produit erreur) mais non conforme. |
| S18 | SQL anti-pattern | `routes/admin-db.js:197` | Interpolation noms de table/colonne controlees par whitelist. Pattern dangereux mais valeurs sures. |
| S19 | SQL anti-pattern | `routes/reporting.js:132,141` | `${grouping}` interpole — valeur derivee de 2 options codees en dur. |
| S20 | Rate limiting | routes `-public` | Pas de rate limiting specifique sur les 10 routes publiques tournees. Le global 1000/15min est insuffisant. |

### 2.2 Points forts confirmes

| Aspect | Statut | Detail |
|--------|--------|--------|
| **Authentification JWT** | OK | Access token 8h + refresh token 7j, bcrypt passwords |
| **Middleware auth** | OK (90%) | `router.use(authenticate)` sur la majorite des routes, sauf `-public` |
| **SQL parametrise** | OK (95%) | Utilisation systematique de `$1, $2...` pour les inputs utilisateur |
| **Rate limiting auth** | OK | 30 req/15min sur `/api/auth` contre brute-force |
| **CORS** | OK | Origines explicitement listees |
| **HTTPS** | OK | Let's Encrypt SSL, HSTS actif |
| **Path traversal** | OK | `path.basename()` utilise dans admin-db |
| **JWT fallback dev** | OK | `process.exit(1)` en production si secret non defini |

### 2.3 Resume npm audit

```
7 vulnerabilites (2 moderate, 5 high)
- xlsx : 2 HIGH (lib abandonnee, pas de fix — remplacer par exceljs)
- socket.io-parser : 1 HIGH (fix dispo)
- lodash : 1 HIGH (Prototype Pollution, fix dispo)
- path-to-regexp : 1 HIGH (ReDoS, fix dispo)
- picomatch : 1 HIGH (Method Injection, fix dispo)
- @anthropic-ai/sdk : 1 MODERATE (sandbox escape, fix v0.82.0)
- brace-expansion : 1 MODERATE (DoS, fix dispo)
```

**Action** : `npm audit fix` corrigerait 5 des 7 vulnerabilites. Les 2 de `xlsx` necessitent un remplacement de librairie par `exceljs`.

---

## 3. TESTS PERSONAS UTILISATEURS

### 3.1 Persona Chauffeur-Collecteur (Mobile)

**Resultat analyse approfondie : 16 bugs identifies (4 BLOQUANTS, 7 MAJEURS, 5 MINEURS)**

**Le workflow mobile chauffeur est fondamentalement casse.**

| # | Severite | Fichier:Ligne | Description | Recurrent |
|---|----------|---------------|-------------|-----------|
| C1 | **BLOQUANT** | `mobile/TourMap.jsx:81` vs `backend/index.js:242` | **Mismatch Socket.IO GPS** : mobile emet `gps:position`, backend ecoute `gps-update`. GPS jamais sauvegarde. | Oui (depuis 02/04) |
| C2 | **BLOQUANT** | `mobile/ReturnCentre.jsx:19` vs `init-db.js:424` | **Status `returning` viole CHECK constraint** : la table tours n'accepte que `planned/in_progress/paused/completed/cancelled`. Le retour centre provoque une erreur 500. Chauffeur bloque. | NOUVEAU |
| C3 | **BLOQUANT** | `mobile/TourSummary.jsx:14-41` vs `backend/tours/index.js:287-298` | **Structure reponse incompatible** : frontend attend `tour.cavs`, `tour.total_weight_kg` — backend retourne `{tour: {...}, stats: {...}}`. Page resume entierement vide. | NOUVEAU |
| C4 | **BLOQUANT** | `mobile/ReturnCentre.jsx:15-21` vs `backend/tours/index.js:217` | **`km_end` et `notes` ignores** : la route `status-public` ne destructure que `{status}`. Km arrivee et notes perdus. | NOUVEAU |
| C5 | MAJEUR | `backend/vehicles.js:285,332` | Route `/available` definie 2 fois (publique + authentifiee). La 2e est du code mort. La 1re retourne des vehicules non-disponibles. | NOUVEAU |
| C6 | MAJEUR | `mobile/services/sync.js:23,54,86` | **3 endpoints inexistants** : `/tours/:id/scan` (devrait etre `scan-public`), `/tours/:id/weights` (devrait etre `weigh-public`), `/tours/gps-batch` (n'existe pas). Donnees offline perdues. | NOUVEAU |
| C7 | MAJEUR | `backend/tours/index.js:214-252` | **Route `status-public` sans side effects** : pas de tonnage_history, stock_movements, ML feedback apres completion. Stock jamais mis a jour via mobile. | NOUVEAU |
| C8 | MAJEUR | `mobile/QRScanner.jsx:25-32` | **QR scan jamais persiste** : resultat stocke en localStorage, `POST /scan-public` jamais appele. Table `cav_qr_scans` toujours vide. | NOUVEAU |
| C9 | MAJEUR | `backend/tours/index.js:101` | **`ON CONFLICT DO NOTHING` sans contrainte UNIQUE** sur `tour_id` dans `vehicle_checklists`. Doublons de checklist possibles. | NOUVEAU |
| C10 | MAJEUR | `mobile/Checklist.jsx:48-49` vs `backend/tours/index.js:98` | Champ `notes` envoye par le frontend mais ignore par le backend (pas destructure, pas de colonne). | NOUVEAU |
| C11 | MAJEUR | `mobile/TourSummary.jsx:23-24` | Apres fin de tournee, navigue vers `/vehicle-select` qui appelle une route authentifiee. En mode sans auth : erreur 401, chauffeur bloque. | NOUVEAU |
| C12 | MINEUR | `mobile/FillLevel.jsx:7-12` vs `TourSummary.jsx:87` | Echelle fill_level 0-4 affichee comme "/5". "Plein" affiche "4/5". | NOUVEAU |
| C13 | MINEUR | `mobile/TourMap.jsx:161,185` | `cav.nom` toujours undefined, fallback `cav.cav_name` fonctionne. Code mort. | NOUVEAU |
| C14 | MINEUR | `mobile/TourMap.jsx:82-86` vs `backend/index.js:243` | Meme si event GPS corrige : champs `tour_id/vehicle_id` (snake_case) vs `tourId/vehicleId` (camelCase). GPS stocke avec NULLs. | NOUVEAU |
| C15 | MINEUR | `mobile/WeighIn.jsx:20-25` vs `backend/tours/index.js:173` | `tare_kg` et `is_intermediate` envoyes mais ignores (pas destructures, pas de colonnes). | NOUVEAU |
| C16 | MINEUR | `mobile/Incident.jsx:21` vs `backend/tours/index.js:199` | `description` requise par backend mais optionnelle dans l'UI. Erreur 400 sans feedback utilisateur. | NOUVEAU |

### 3.2 Persona Responsable Logistique

| # | Severite | Fichier:Ligne | Description | Recurrent |
|---|----------|---------------|-------------|-----------|
| L1 | **BLOQUANT** | `mobile/TourMap.jsx:81` vs `backend/index.js:242` | Meme bug GPS que C1 — le suivi LiveVehicles ne recoit pas les positions des chauffeurs. | Oui |
| L2 | MAJEUR | `frontend/Expeditions.jsx:60` | Affiche `s.exutoire_nom || s.month` dans les stats, mais le backend retourne `exutoire` (pas `exutoire_nom`) dans le resume par exutoire (routes/expeditions.js:72). | A verifier |
| L3 | MINEUR | `frontend/LiveVehicles.jsx` | Depend du flux Socket.IO GPS qui est casse (voir C1). Aucune position ne s'affichera en temps reel. | Oui |

### 3.3 Persona Responsable Operations (Tri/Production)

**Resultat analyse approfondie : 16 bugs identifies (4 BLOQUANTS, 7 MAJEURS, 5 MINEURS)**

| # | Severite | Fichier:Ligne | Description | Recurrent |
|---|----------|---------------|-------------|-----------|
| O1 | **BLOQUANT** | `backend/dashboard.js:64,69,82` | **Dashboard crash** : requetes SQL sur colonne `kg_entree` inexistante dans `production_daily`. Les vrais champs sont `entree_ligne_kg` et `entree_recyclage_r3_kg`. Le dashboard est entierement inaccessible. | NOUVEAU |
| O2 | **BLOQUANT** | `backend/dashboard.js:113,168` | **Dashboard crash** : requetes SQL sur colonne `quantity` inexistante dans `stock_movements`. Le vrai champ est `poids_kg`. | NOUVEAU |
| O3 | **BLOQUANT** | `backend/dashboard.js:168` | **Dashboard crash** : requete SQL sur colonne `reference` inexistante dans `stock_movements`. | NOUVEAU |
| O4 | **BLOQUANT** | `frontend/Production.jsx:65-68` vs `backend/production.js:43-48` | **Production KPIs a zero** : le frontend attend `dashboard.total_month_t`, `dashboard.avg_productivite`, `dashboard.nb_jours`, `dashboard.avg_effectif` — le backend retourne `summary.total_mois_t`, `summary.productivite_moyenne`, etc. Noms de champs completement differents. | Oui (depuis 02/04) |
| O5 | MAJEUR | `frontend/ProduitsFinis.jsx:98` | `p.produit_nom` inexistant, backend retourne `produit` (pas `produit_nom`). Colonne affiche "—". | Oui (depuis 03/04) |
| O6 | MAJEUR | `frontend/ProduitsFinis.jsx:112` | `p.is_shipped` inexistant, backend utilise `date_sortie`. Tous les produits affichent "En stock". | Oui (depuis 03/04) |
| O7 | MAJEUR | `frontend/ProduitsFinis.jsx:12-14` vs `backend/produits-finis.js:55-56` | Frontend envoie `barcode` + `produit_catalogue_id`, backend attend `code_barre` + `catalogue_id`. **Creation produit fini impossible** (erreur 400). | NOUVEAU |
| O8 | MAJEUR | `frontend/ProduitsFinis.jsx:69,73` vs `backend/produits-finis.js:40` | Frontend lit `s.count`, `s.total_kg`. Backend retourne `nb_produits`, `poids_total_kg`. Synthese affiche "0". | NOUVEAU |
| O9 | MAJEUR | `frontend/ChaineTri.jsx:109` vs `backend/tri.js:17-22` | Frontend affiche `chain.nb_postes`. Backend ne retourne que `nb_operations`. Nombre de postes toujours "0". | NOUVEAU |
| O10 | MAJEUR | `backend/dashboard.js:388-389` | Objectifs tri/production : requete sur `oe.quantity_kg`, `oe.date`, `ot.name` inexistants. Vrais champs : `poids_entree_kg`, `started_at`, `nom`. | NOUVEAU |
| O11 | MAJEUR | `frontend/ReportingCollecte.jsx:57` | Arrondi tonnage imprecis : `Math.round(tonnage / 100) / 10` — 450kg affiche 0.4t au lieu de 0.45t. | NOUVEAU |
| O12 | MINEUR | `frontend/Production.jsx:11-15` | Formulaire ne transmet pas `effectif_theorique`. La colonne sera toujours vide. | NOUVEAU |
| O13 | MINEUR | `frontend/Stock.jsx:29` | Code defensif `s.solde_kg || s.stock_kg` — `stock_kg` n'existe pas (code mort). | NOUVEAU |
| O14 | MINEUR | `frontend/Stock.jsx:158` | `m.poids_kg || m.quantity_kg` — `quantity_kg` n'existe pas (code mort). | NOUVEAU |
| O15 | MINEUR | `backend/production.js:104` | Default `objectif_entree_r3_kg || 1300` cote backend vs 500 cote frontend. Incoherence. | NOUVEAU |
| O16 | MINEUR | `frontend/ChaineTri.jsx:131` | `op.numero ?? op.ordre` — `ordre` n'existe pas (code mort). | NOUVEAU |

### 3.4 Persona Responsable RH / Insertion

**Resultat analyse approfondie : 15 bugs identifies (3 BLOQUANTS, 7 MAJEURS, 5 MINEURS)**

| # | Severite | Fichier:Ligne | Description | Recurrent |
|---|----------|---------------|-------------|-----------|
| R1 | **BLOQUANT** | `frontend/WorkHours.jsx:27,34,42,50` | **Module Heures entierement casse** : le frontend appelle `GET /api/employees/{id}/hours/...` mais le backend expose `GET /api/employees/work-hours/...`. Toutes les routes sont incompatibles. | NOUVEAU |
| R2 | **BLOQUANT** | `frontend/WorkHours.jsx:12,110-112` vs `backend/employees.js:296-320` | **Champs incompatibles** : frontend envoie `start_time, end_time, break_minutes` — backend attend `hours_worked, overtime_hours`. Creation impossible. | NOUVEAU |
| R3 | **BLOQUANT** | `frontend/WorkHours.jsx:119,126` vs `backend/employees.js:327` | Frontend teste `h.validated` (boolean) — backend stocke `validated_by` (integer). Toutes les heures apparaissent "En attente" meme validees. | NOUVEAU |
| R4 | MAJEUR | `frontend/Employees.jsx:246,279` vs `backend/employees.js:32` | `emp.position_name` inexistant — pas de JOIN sur table `positions`. Poste affiche "---". | NOUVEAU |
| R5 | MAJEUR | `frontend/Skills.jsx:40` | Matrice competences utilise `emp.candidate_id || emp.id` pour charger les skills. Employes sans candidature : donnees erronees ou 404. | NOUVEAU |
| R6 | MAJEUR | `backend/planning-hebdo.js:8` | Planning restreint a `ADMIN, MANAGER` — le role `RH` est exclu. Le Resp RH ne peut pas acceder au planning. | NOUVEAU |
| R7 | MAJEUR | `frontend/Employees.jsx:5-6` | `CONTRACT_LABELS` ne contient pas `CDDI` (contrat fondamental en SIAE). Les CDDI affichent la valeur brute. | NOUVEAU |
| R8 | MAJEUR | Documentation CLAUDE.md | Doc indique "3 jalons M1/M6/M12" mais le code a 5 types : Diagnostic accueil, Bilan M+3, M+6, M+10, Bilan Sortie. | NOUVEAU |
| R9 | MAJEUR | `backend/employees.js:208` | `is_provisional !== false` : toute entree schedule sans le champ explicitement a `false` sera marquee provisoire. | NOUVEAU |
| R10 | MAJEUR | `frontend/WorkHours.jsx:56-57` vs `backend/employees.js:349-352` | Types d'heures incompatibles : frontend `conge/maladie` vs backend `holiday/sick`. Summary mensuel fausse. | NOUVEAU |
| R11 | MINEUR | `backend/candidates/individual.js:241` | Route history protegee `ADMIN/RH` mais pas `MANAGER`. Incoherence avec la vue kanban (ADMIN/RH/MANAGER). | NOUVEAU |
| R12 | MINEUR | `frontend/Employees.jsx:104,111` | Envoie `position` (texte) au lieu de `position_id` (FK). Incoherence avec la table `positions`. | NOUVEAU |
| R13 | MINEUR | `backend/pointage.js:104` | Badgeage auto n'insere pas `source`. Colonne NULL pour les badgeages auto, filtrage par source peu fiable. | NOUVEAU |
| R14 | MINEUR | `backend/insertion/routes.js` | Pas de `authorize()` par route — un MANAGER peut modifier des parcours insertion (devrait etre reserve RH/CIP). | NOUVEAU |
| R15 | MINEUR | `backend/pcm.js:566` | Alerte RPS trop stricte : exige que TOUTES les reponses stress soient du meme type. Sous-detection des RPS. | NOUVEAU |

### Resume des bugs

| Severite | Nombre | Dont recurrents | Dont nouveaux |
|----------|--------|-----------------|---------------|
| **BLOQUANT** | 14 | 4 | 10 (dashboard x3, WorkHours x3, mobile x4) |
| **MAJEUR** | 24 | 3 | 21 |
| **MINEUR** | 18 | 3 | 15 |
| **Total** | 56 | 10 | 46 |

**Bugs bloquants (14)** :
- **4 recurrents** (depuis 02/04) : Socket.IO GPS mismatch x2, ProduitsFinis champs x2
- **3 nouveaux Dashboard** : colonnes SQL inexistantes `kg_entree`, `quantity`, `reference`
- **3 nouveaux WorkHours** : routes, champs, validation incompatibles — module entierement casse
- **4 nouveaux Mobile Chauffeur** : status `returning` viole CHECK DB, TourSummary structure cassee, km_end ignore, GPS mismatch — **workflow chauffeur fondamentalement casse**

**Modules les plus impactes** :
1. **Mobile Chauffeur** : 4 bugs bloquants + 7 majeurs — workflow fondamentalement casse (retour centre impossible, resume vide, donnees perdues)
2. **WorkHours** : 3 bugs bloquants + 1 majeur — module entierement casse
3. **Dashboard** (`dashboard.js`) : 3 bugs bloquants — dashboard inaccessible
4. **ProduitsFinis** : 4 bugs majeurs — creation impossible, affichage casse
5. **Employees** : 3 bugs majeurs — position_name, CDDI, position/position_id
6. **Production** : 1 bloquant + 2 mineurs — KPIs a zero
7. **Planning** : 1 majeur — role RH exclu

---

## 4. SAUVEGARDE BASE DE DONNEES

### Script de backup
- **Fichier** : `deploy/scripts/backup.sh`
- **Fonctionnalites** : Dump PostgreSQL + backup uploads + compression gzip + rotation 30j (daily) / 90j (manual)
- **Cron recommande** : `0 2 * * * /opt/solidata.online/deploy/scripts/backup.sh daily`

### Execution
- **Statut** : NON EXECUTABLE dans cet environnement (Docker daemon non disponible)
- Le script necessite le conteneur `solidata-db` (PostgreSQL) en production
- **Recommandation** : Verifier que le cron est bien configure sur le serveur de production (51.159.144.100)

### Points de controle backup
| Aspect | Statut |
|--------|--------|
| Script existe et est executable | OK (`chmod +x`) |
| Rotation automatique | OK (30j daily, 90j manual) |
| Compression gzip | OK |
| Backup uploads (Docker volume) | OK |
| Audit log (rgpd_audit_log) | Non present dans backup.sh (uniquement dans admin-db.js) |

---

## 5. ETAT DE LA DOCUMENTATION

### Fichiers a jour

| Document | Derniere MAJ | Statut |
|----------|-------------|--------|
| `CLAUDE.md` | 03/04/2026 | A METTRE A JOUR (branches, historique) |
| `rapports/rapport-quotidien-2026-04-03.md` | 03/04/2026 | OK |
| `rapports/rapport-quotidien-2026-04-04.md` | 04/04/2026 | NOUVEAU (ce rapport) |

### Mise a jour CLAUDE.md necessaire
- Section 12 (Historique) : ajouter entree du 4 avril
- Section 1 : confirmer 7 branches obsoletes a supprimer
- Total commits : 179 → mettre a jour apres commit du rapport

---

## 6. METRIQUES DU PROJET

### Code source

| Metrique | Valeur | Evolution vs 03/04 |
|----------|--------|---------------------|
| **Commits total** | 179 | +1 (docs) |
| **Fichiers backend** | 88 (.js) | Stable |
| **Fichiers frontend** | 80 (.jsx/.js) | Stable |
| **Fichiers mobile** | 21 (.jsx/.js) | Stable |
| **Routes API** | 61 fichiers | Stable |
| **Pages web** | 62 pages | Stable |
| **Pages mobile** | 11 pages | Stable |
| **Lignes backend** | ~29 000 | Stable |
| **Lignes frontend** | ~23 700 | Stable |
| **Lignes mobile** | ~2 500 | Stable |
| **Total lignes code** | ~55 200 | Stable |

### Dependances npm (backend)

| Metrique | Valeur |
|----------|--------|
| Vulnerabilites totales | 7 |
| Dont HIGH | 5 |
| Dont MODERATE | 2 |
| Fixables (`npm audit fix`) | 4/7 |
| Sans fix disponible | 2 (xlsx) + 1 (@anthropic-ai/sdk breaking) |

### Qualite

| Metrique | Valeur | Tendance |
|----------|--------|----------|
| Bugs bloquants ouverts | 7 | Hausse (+3 nouveaux dashboard) |
| Bugs majeurs ouverts | 10 | Hausse (+7 nouveaux) |
| Bugs totaux ouverts | 25 | Hausse vs 14 initial (analyse approfondie Resp Operations) |
| Vulnerabilites securite critiques | 3 | Stable |
| Branches obsoletes | 7 | Hausse (recrees depuis nettoyage du 03/04) |

---

## 7. ACTIONS PRIORITAIRES

### URGENTES (Bloquants — a corriger avant prochain deploiement)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| **P1** | **Corriger dashboard.js** : remplacer `kg_entree` par `entree_ligne_kg + entree_recyclage_r3_kg`, `quantity` par `poids_kg`, `reference` par un champ existant | Debloque le dashboard complet | 30 min |
| **P2** | **Corriger mismatch Socket.IO GPS** : renommer `gps:position` en `gps-update` dans `mobile/src/pages/TourMap.jsx:81` OU l'inverse dans `backend/src/index.js:242` | Debloque suivi GPS temps reel + LiveVehicles | 5 min |
| **P3** | **Corriger ProduitsFinis** : champs `produit_nom`→`produit`, `is_shipped`→`date_sortie !== null`, `barcode`→`code_barre`, `produit_catalogue_id`→`catalogue_id`, summary `count`→`nb_produits` | Debloque creation + affichage produits finis | 20 min |
| **P4** | **Corriger Production KPIs** : aligner noms de champs frontend (`total_month_t`, `avg_productivite`) avec backend (`summary.total_mois_t`, `summary.productivite_moyenne`) | Debloque KPIs production | 15 min |
| **P5** | **Corriger module WorkHours** : refaire les routes frontend (`/employees/{id}/hours` → `/employees/work-hours`), aligner les champs (`start_time/end_time` → `hours_worked`), les types (`conge/maladie` → `holiday/sick`), et le champ validation (`validated` → `validated_by`) | Debloque tout le module heures de travail | 1h |
| **P5b** | **Corriger CHECK constraint tours** : ajouter `returning` a la contrainte CHECK de la table `tours` (`ALTER TABLE tours DROP CONSTRAINT ...; ALTER TABLE tours ADD CONSTRAINT ... CHECK (status IN ('planned','in_progress','paused','returning','completed','cancelled'))`) | Debloque le retour centre des chauffeurs | 5 min |
| **P5c** | **Corriger TourSummary mobile** : adapter `TourSummary.jsx` pour lire `data.tour.*` et `data.stats.*` au lieu de `data.*`. Corriger navigation fin de tournee vers `/start` (pas `/vehicle-select`) | Debloque le resume de tournee | 15 min |
| **P5d** | **Corriger route `status-public`** : destructurer `km_end` et `notes` + ajouter les side effects post-completion (tonnage_history, stock_movements) | Donnees de tournee sauvegardees correctement | 30 min |

### IMPORTANTES (Securite — planifier cette semaine)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| **P6** | **Securiser admin-db.js** : remplacer `execSync` par `spawn()` avec tableau d'arguments | Elimine injection shell critique x2 | 30 min |
| **P7** | **Ajouter `fileFilter` MIME** sur tous les uploads (tours, employees, finance) | Empeche upload de fichiers malveillants | 30 min |
| **P8** | **Proteger `/uploads`** : ajouter middleware auth ou token signe pour l'acces aux fichiers | Empeche acces public aux uploads | 30 min |
| **P9** | **Ajouter auth legere aux routes `-public`** : token vehicule ou cle temporaire | Protege les 10 routes tournees publiques | 1h |
| **P10** | **Lancer `npm audit fix`** : corrige 5 des 7 vulnerabilites npm | Reduit surface d'attaque | 5 min |
| **P11** | **Ajouter role RH au planning** (`planning-hebdo.js:8`) : `authorize('ADMIN', 'MANAGER', 'RH')` | Debloque planning pour le RH | 2 min |
| **P12** | **Supprimer les 7 branches obsoletes** du remote | Proprete du repo | 5 min |
| **P13** | **Corriger dashboard objectifs** (`dashboard.js:388-389`) : `quantity_kg`→`poids_entree_kg`, `date`→`started_at`, `name`→`nom` | Debloque objectifs tri | 15 min |
| **P14** | **Remplacer `xlsx`** par `exceljs` pour eliminer les 2 vuln HIGH sans fix | Elimine 2 vulnerabilites | 2h |
| **P15** | **Supprimer cle PCM hardcodee** (`'solidata-pcm-encryption-key'`) et exiger variable d'environnement | Protege les donnees PCM chiffrees | 15 min |

### SOUHAITEES (Moyen terme)

| # | Action | Impact |
|---|--------|--------|
| P7 | Ajouter validation des donnees GPS dans Socket.IO (latitude -90/+90, longitude -180/+180) | Securite |
| P8 | Implementer mode offline PWA pour le mobile (IndexedDB + sync) | Fiabilite terrain |
| P9 | Ajouter des tests automatises (au minimum smoke tests API + tests de coherence champs) | Qualite |
| P10 | Verifier et documenter le cron backup sur le serveur de production | Resilience |

---

## SYNTHESE EXECUTIVE

| Indicateur | Valeur | Tendance |
|------------|--------|----------|
| **Note securite** | 5.5/10 | -1.5 (analyse approfondie : uploads, routes publiques, CSP) |
| **Note qualite code** | 5.0/10 | -2.0 (dashboard + WorkHours + mobile casses) |
| **Note fonctionnelle** | 4.5/10 | -2.0 (14 bloquants, 3 modules entierement casses) |
| **Note globale** | 5.0/10 | -1.8 |
| **Bugs bloquants** | 14 | Hausse (+3 dashboard, +3 WorkHours, +4 mobile) |
| **Bugs totaux** | 56 | Hausse (analyses approfondies 4 personas) |
| **Branches a nettoyer** | 7 | 7 nouvelles depuis nettoyage 03/04 |
| **Vulnerabilites npm** | 7 (5 HIGH) | Stable |

**Constat principal** : L'audit le plus approfondi jamais realise sur SOLIDATA revele un etat significativement plus degrade que les estimations precedentes. **4 modules sont casses ou fondamentalement dysfonctionnels** : Dashboard (SQL crash), WorkHours (routes+champs incompatibles), Mobile Chauffeur (CHECK constraint, structure reponse, donnees perdues), ProduitsFinis (creation+affichage). Le total atteint **14 bugs bloquants** et **56 bugs** toutes severites. Les 4 bugs recurrents depuis le 02/04 n'ont toujours pas ete corriges.

**Fait critique** : Le statut `returning` envoye par le mobile viole la contrainte CHECK de la table `tours` — le chauffeur est **physiquement bloque** apres sa collecte, incapable de terminer sa tournee.

**Recommandation** : Sprint correctif urgent de 4-5h pour corriger les 14 bugs bloquants (P1 a P5 + nouveau P-mobile). Le mobile chauffeur et le dashboard sont les priorites absolues car ils impactent les operations quotidiennes.

---

*Rapport genere automatiquement par Claude Code — Session du 4 avril 2026*
*Prochain rapport : 5 avril 2026*

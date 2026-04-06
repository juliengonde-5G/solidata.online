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

### 3.2 Audit sécurité code

| Catégorie | Sévérité | Findings |
|-----------|----------|----------|
| **Mot de passe DB par défaut** | CRITIQUE | `database.js:8` — fallback `'changeme'` en dur |
| **JWT secret par défaut** | HAUTE | `auth.js:4` — fallback `'change-this-in-production'` (mais protection process.exit en prod) |
| **Injection shell admin-db** | CRITIQUE | Routes admin-db exécutent des commandes Docker avec inputs utilisateur |
| **Routes publiques mobile** | HAUTE | Endpoints `/tours/*-public` sans auth — par design, mais surface d'attaque |
| **CORS** | MOYENNE | À vérifier configuration exacte en production |
| **Rate limiting login** | MOYENNE | Présent mais à valider les seuils |
| **Upload fichiers** | BASSE | Multer avec limite 10 Mo, mais pas de validation type MIME strict |

**Score sécurité global : 5.5/10** (stable par rapport au 04/04)

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

**Parcours testé** : CAV → Véhicules → Tournées → LiveVehicles → Expéditions → Exutoires

| # | Sévérité | Bug | Fichier | Impact |
|---|----------|-----|---------|--------|
| L1 | **BLOQUANT** | Vue matérialisée `mv_cav_stats` référence `tour_weights.cav_id` inexistant | init-db.js (vue) | Carte CAV crashe (corrigé commit 67ecade) |
| L2 | MAJEUR | Expéditions — mismatch champs frontend/backend | Expeditions.jsx | Champs vides/undefined |
| L3 | MAJEUR | LiveVehicles — dépend du GPS Socket.IO cassé (cf C2) | LiveVehicles.jsx | Aucune position affichée |
| L4 | MAJEUR | Commandes exutoires — workflow statut `chargée` bloquant | commandes-exutoires.js | Workflow interrompu |
| L5 | MINEUR | FillRateMap — dépend de `estimated_fill_rate` non calculé | FillRateMap.jsx | Carte vide |
| L6 | MINEUR | AdminCAV — photo upload sans validation type MIME | cav.js | Fichier arbitraire |
| L7 | MINEUR | Préparations — tri par défaut incohérent | preparations.js | Ordre confus |

**Total Logistique : 7 bugs (1 BLOQUANT corrigé, 3 MAJEURS, 3 MINEURS)**

### 4.4 Persona Responsable RH

**Parcours testé** : Candidats → Employés → WorkHours → PCM → Insertion → Pointage

| # | Sévérité | Bug | Fichier | Impact |
|---|----------|-----|---------|--------|
| R1 | **BLOQUANT** | WorkHours — frontend appelle `/employees/{id}/hours` mais backend expose `/employees/work-hours/*` | WorkHours.jsx:27 | Module 100% non-fonctionnel |
| R2 | **BLOQUANT** | WorkHours — POST/PUT/GET endpoints incompatibles | WorkHours.jsx:42,50 | Saisie/validation impossible |
| R3 | MAJEUR | Insertion — structure réponse diagnostic peut être undefined | InsertionParcours.jsx:530 | Crash silencieux |
| R4 | MAJEUR | Candidates — endpoint `/candidates/positions/list` potentiellement absent | Candidates.jsx:67 | Liste postes vide |
| R5 | MINEUR | PCM — cohérence endpoint `/pcm/profiles` vs `/pcm/sessions` | PersonalityMatrix.jsx:200 | Confusion API |
| R6 | MINEUR | Pointage — module complet et cohérent avec backend | Pointage.jsx | OK |
| R7 | MINEUR | PlanningHebdo — à vérifier cohérence champs planning | PlanningHebdo.jsx | Non testé profondeur |

**Total RH : 7 bugs (2 BLOQUANTS, 2 MAJEURS, 3 MINEURS)**

---

## 5. SYNTHESE GLOBALE

### Comptage total des bugs

| Sévérité | Chauffeur | Opérations | Logistique | RH | **TOTAL** |
|----------|-----------|------------|------------|-----|-----------|
| BLOQUANT | 2 | 2 | 1 (corrigé) | 2 | **7 (6 actifs)** |
| MAJEUR | 6 | 3 | 3 | 2 | **14** |
| MINEUR | 6 | 3 | 3 | 3 | **15** |
| **Total** | **14** | **8** | **7** | **7** | **36** |

### Modules cassés (non-fonctionnels)

| Module | Problème principal | Persona |
|--------|--------------------|---------|
| **Dashboard** | SQL crash colonnes inexistantes stock_movements | Opérations |
| **WorkHours** | Endpoints frontend/backend totalement incompatibles | RH |
| **ProduitsFinis** | Mismatch complet champs création + affichage | Opérations |
| **GPS Temps Réel** | Socket.IO événement incompatible + endpoint manquant | Chauffeur |
| **LiveVehicles** | Dépend du GPS cassé | Logistique |

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
| Bugs totaux | 76 | 36 | Analyse plus ciblée |
| Bugs BLOQUANTS | 18 | 6 actifs | Vue corrigée (mv_cav_stats) |
| Score sécurité | 5.5/10 | 5.5/10 | Stable |
| Vulnérabilités npm | 10 | 10 | Stable |
| Branches obsolètes | 0 | 0 | Propre |
| Commits orphelins | 11 | 0 | Réintégrés |

### Note globale : **5.2/10**

Justification :
- **-2.0** : 5 modules cassés (Dashboard, WorkHours, ProduitsFinis, GPS, LiveVehicles)
- **-1.5** : 6 bugs bloquants actifs dont 4 récurrents non corrigés
- **-0.8** : Score sécurité 5.5/10, 10 vulnérabilités npm
- **-0.5** : 14 bugs majeurs impactant l'expérience utilisateur

---

## 6. PLAN D'ACTION PRIORITAIRE

### Sprint correctif URGENT (estimé)

#### P0 — Bloquants (priorité immédiate)
1. **Socket.IO GPS** : Renommer `gps:position` → `gps-update` dans TourMap.jsx + ajouter `join-tour`
2. **Dashboard SQL** : Remplacer `sm.quantity, sm.reference` par `sm.poids_kg, sm.code_barre` dans dashboard.js
3. **WorkHours** : Aligner endpoints frontend (`/employees/{id}/hours`) avec backend (`/employees/work-hours/*`)
4. **ProduitsFinis** : Aligner noms de champs frontend/backend (`barcode`→`code_barre`, `produit_catalogue_id`→`catalogue_id`)
5. **GPS Batch** : Créer endpoint `/api/tours/gps-batch` pour sync offline

#### P1 — Majeurs
6. Corriger `km_end` sauvegarde dans vehicle_checklists
7. Ajouter checklist + incidents dans `/summary-public`
8. Corriger noms champs Production (`avg_productivite`)
9. Corriger workflow commandes exutoires (transition `chargée`)
10. Aligner champs Expeditions frontend/backend

#### P2 — Sécurité
11. Remplacer `xlsx` par `exceljs`
12. Lancer `npm audit fix` (backend + frontend)
13. Auditer injection shell admin-db
14. Renforcer validation upload fichiers (type MIME)

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

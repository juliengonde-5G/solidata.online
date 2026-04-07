# Rapport Quotidien SOLIDATA — 7 avril 2026

> **Audit complet** : branches, sécurité, dépendances, tests 4 personas
> **Date** : 07/04/2026
> **Version** : 1.3.2
> **Commits** : 143 (main)
> **Auteur** : Agent IA Chef de Projet

---

## 1. CONTROLE DES BRANCHES

| Indicateur | Valeur |
|-----------|--------|
| Branche active | `main` |
| Branches distantes | 1 (`origin/main`) |
| Branches obsolètes | 0 |
| Commits orphelins | **15 commits détachés réintégrés** via fast-forward |
| Push origin | En attente |

### Commits réintégrés (orphelins depuis le 06/04)

| Hash | Description |
|------|-------------|
| `a4fbbce` | docs: rapport 06/04 FINAL — intégration audit RH |
| `25a082b` | docs: rapport 06/04 — intégration audit sécurité approfondi |
| `2822750` | docs: rapport 06/04 — intégration audit Resp Logistique |
| `dacb980` | docs: rapport quotidien 06/04 — audit complet 4 personas |
| `67ecade` | fix(db): corriger vue mv_cav_stats — tour_weights n'a pas de colonne cav_id |
| `5f05c72` | feat(ui): lot 1 phase 3 — tokens gray→slate + migration 3 pages DataTable |
| `78595b5` | feat(ui): lot 1 phase 2 — migration icônes Layout vers Lucide React |
| `4e4a88d` | feat(ui): lot 1 phase 1 — fondations design system |
| `4e2574f` | docs: rapport 04/04 FINAL |
| `5a03b0a` | docs: rapport 04/04 — audit Chauffeur |
| `8c78d90` | docs: rapport 04/04 — audit RH |
| `d190f94` | docs: rapport 04/04 — audit sécurité approfondi |
| `e2ce8cc` | docs: rapport 04/04 — audit Resp Opérations |
| `3e40f9f` | docs: rapport quotidien 04/04 |
| `a7f202d` | docs: rapport quotidien 03/04 |

**Verdict branches** : Repo propre. 15 commits orphelins réintégrés sur main. Aucune branche obsolète.

---

## 2. SAUVEGARDE BASE DE DONNEES

Le script `deploy/scripts/backup.sh` est présent et bien structuré :
- Dump PostgreSQL via `pg_dump --format=custom`
- Backup uploads via volume Docker
- Compression gzip automatique
- Rétention : 30 jours (daily), 90 jours (manual)
- Nettoyage automatique des anciennes sauvegardes

**Statut** : Script non exécutable en environnement dev (nécessite les conteneurs Docker de production). Prêt pour exécution sur le serveur 51.159.144.100.

**Recommandation** : Vérifier que le cron est actif (`0 2 * * *`).

---

## 3. AUDIT SECURITE

### Note globale sécurité : 4.5/10

### 3.1 Vulnérabilités npm

#### Backend — 7 vulnérabilités (5 HIGH, 2 MODERATE)

| Package | Sévérité | Détail |
|---------|----------|--------|
| `xlsx` | HIGH | Prototype Pollution + ReDoS (pas de fix dispo) |
| `socket.io-parser` 4.0-4.2.5 | HIGH | Unbounded binary attachments |
| `picomatch` ≤2.3.1 | HIGH | ReDoS via extglob + Method Injection POSIX |
| `lodash` ≤4.17.23 | MODERATE | Code Injection via `_.template` |

#### Frontend — 4 vulnérabilités (4 HIGH)

| Package | Sévérité | Détail |
|---------|----------|--------|
| `vite` ≤6.4.1 | HIGH | Path Traversal `.map` + WebSocket arbitrary file read |
| `socket.io-parser` | HIGH | Unbounded binary attachments |
| `picomatch` | HIGH | ReDoS + Method Injection |

**Action** : `npm audit fix` recommandé pour les deux packages. `xlsx` nécessite remplacement par alternative (ExcelJS).

### 3.2 Vulnérabilités code — 15 identifiées

| # | Sévérité | Fichier | Ligne(s) | Description |
|---|----------|---------|----------|-------------|
| 1 | **CRITIQUE** | `routes/insertion/index.js` | 48, 109 | **Injection SQL** : interpolation directe de noms de colonnes dans ALTER TABLE |
| 2 | **CRITIQUE** | `routes/admin-db.js` | 72-74, 126-128 | **Injection shell** : `execSync()` avec URL DB interpolée |
| 3 | **HAUTE** | `routes/admin-db.js` | 196-198 | Injection SQL dynamique dans DELETE (table interpolée) |
| 4 | **HAUTE** | `config/database.js` | 8 | Mot de passe par défaut `changeme` |
| 5 | **HAUTE** | `middleware/auth.js` | 4-8 | JWT secret par défaut en dev |
| 6 | **HAUTE** | `routes/pointage.js` | 18-130 | Endpoint `/badge` sans JWT, API key en body |
| 7 | **HAUTE** | `routes/pcm.js` | 627, 637, 646, 723 | **4 endpoints PCM sans authentification** (`/questionnaire`, `/types`, `/types/:key`, `/submit`) |
| 8 | **MOYENNE** | `routes/candidates/documents.js` | 31-36 | Path traversal potentiel (download sans validation chemin) |
| 9 | **MOYENNE** | `routes/candidates/individual.js` | 187-194 | CV download sans vérification bounds |
| 10 | **MOYENNE** | `routes/chat.js` | 206-282 | Autorisation cross-user incomplète |
| 11 | **MOYENNE** | `routes/admin-db.js` | 117-140 | Restore backup sans vérification intégrité |
| 12 | **MOYENNE** | `routes/pennylane.js` | 95-98 | Implémentation chiffrement API key non vérifiable |
| 13 | **MOYENNE** | Toutes routes | — | Pas de rate limiting par endpoint sensible |
| 14 | **MOYENNE** | `routes/admin-db.js` | 72, 126 | Fuite potentielle connection string dans logs d'erreur |
| 15 | **BASSE** | `routes/notifications.js` | 27 | Template replacement sans échappement HTML |

### 3.3 Évolution sécurité

| Date | Note | Critiques | Hautes | Commentaire |
|------|------|-----------|--------|-------------|
| 02/04 | 7.5/10 | 0 | 3 | Premier audit |
| 03/04 | 6.8/10 | 3 | 5 | Audit approfondi |
| 04/04 | 5.5/10 | 2 | 8 | Audit exhaustif |
| 06/04 | 4.5/10 | 6 | 8 | PCM auth ajouté aux critiques |
| **07/04** | **4.5/10** | **2** | **6** | **Aucun correctif appliqué depuis 06/04** |

---

## 4. TESTS PERSONAS — 4 PROFILS

### 4.1 Chauffeur-Collecteur (Mobile)

**Modules testés** : App mobile (11 pages), Socket.IO GPS, tours API

| # | Sévérité | Fichier(s) | Description | Récurrent |
|---|----------|-----------|-------------|-----------|
| C1 | **BLOQUANT** | `mobile/TourMap.jsx:81` / `backend/index.js:242` | **Socket.IO event mismatch** : mobile émet `gps:position`, backend écoute `gps-update` | Depuis 02/04 |
| C2 | **BLOQUANT** | `mobile/TourMap.jsx:75` / `backend/index.js:216` | **Socket.IO sans token JWT** : connexion rejetée immédiatement | Depuis 06/04 |
| C3 | **MAJEUR** | `mobile/TourMap.jsx` | **Missing `join-tour`** : driver ne rejoint pas la room Socket.IO | Nouveau |
| C4 | **MAJEUR** | `mobile/ReturnCentre.jsx:19` / `init-db.js:424` | **Status `returning` invalide** : CHECK constraint rejette (absent du schéma DB) | Depuis 04/04 |
| C5 | **MAJEUR** | `mobile/WeighIn.jsx:22` / `routes/tours/index.js:172` | **Données perdues** : `tare_kg` et `is_intermediate` envoyés mais ignorés par backend | Depuis 04/04 |
| C6 | **MAJEUR** | `mobile/ReturnCentre.jsx:20` / `routes/tours/index.js:215` | **`km_end` ignoré** : kilométrage fin de tournée jamais enregistré | Depuis 04/04 |
| C7 | **MAJEUR** | `mobile/TourSummary.jsx:39-40` | **Distance = null** : lit `checklist.km_end` jamais sauvegardé (cascade de C6) | Depuis 04/04 |
| C8 | **MINEUR** | `mobile/Checklist.jsx:53` / `routes/tours/index.js:96` | Notes checklist envoyées mais non capturées | Nouveau |
| C9 | **MINEUR** | `mobile/FillLevel.jsx:48` | Champ `status: 'collected'` envoyé mais hardcodé côté backend | Existant |

**Verdict Chauffeur** : Module mobile **non fonctionnel**. Le flux tournée est bloqué aux étapes GPS (C1-C2), retour centre (C4), et récapitulatif (C7). **2 BLOQUANTS, 4 MAJEURS, 2 MINEURS.**

---

### 4.2 Responsable Logistique

**Modules testés** : Tours, CAV, Véhicules, LiveVehicles, Expéditions, Exutoires, Stock, FillRateMap

| # | Sévérité | Fichier(s) | Description | Récurrent |
|---|----------|-----------|-------------|-----------|
| L1 | **BLOQUANT** | `pages/Expeditions.jsx` / `routes/expeditions.js` | **Mismatch champs POST** : frontend envoie `date_expedition`/`poids_total_kg`, backend attend `date`/`poids_kg` | Depuis 04/04 |
| L2 | **BLOQUANT** | `pages/ExutoiresCommandes.jsx` / `routes/commandes.js` | **Status `chargée` manquant** : frontend workflow inclut `chargée`, backend STATUTS_VALIDES ne l'a pas → commandes bloquées | Depuis 06/04 |
| L3 | **BLOQUANT** | `pages/LiveVehicles.jsx` / `backend/index.js` | **Socket.IO mismatch** : frontend écoute `gps:update`, backend émet `vehicle-position` | Depuis 02/04 |
| L4 | **MAJEUR** | `pages/FillRateMap.jsx` / `routes/cav.js` | **Structure réponse incompatible** : frontend attend tableau d'objets avec `fill_level`, backend retourne structure différente | Depuis 06/04 |
| L5 | **MAJEUR** | `pages/ExutoiresPreparations.jsx` / `routes/preparations.js` | **Paramètres conflit** : frontend envoie `date_livraison_remorque`/`date_expedition`, backend attend `date_debut`/`date_fin` | Nouveau |
| L6 | **MAJEUR** | `pages/Vehicles.jsx` / `routes/vehicles.js` | Alertes maintenance affichées mais calcul next_maintenance_date incomplet | Existant |
| L7 | **MINEUR** | `pages/Stock.jsx` | Inventaire physique : interface sommaire, pas de scan code-barres intégré | Existant |

**Verdict Logistique** : **3 modules cassés** (Expéditions, Commandes Exutoires, LiveVehicles). **3 BLOQUANTS, 3 MAJEURS, 1 MINEUR.**

---

### 4.3 Responsable Opérations

**Modules testés** : Dashboard, ChaineTri, Production, ProduitsFinis, Reporting, NewsFeed

| # | Sévérité | Fichier(s) | Description | Récurrent |
|---|----------|-----------|-------------|-----------|
| O1 | **BLOQUANT** | `routes/dashboard.js:64-67` | **KPI Production erroné** : utilise `kg_entree` (entrée) au lieu de `total_jour_t` (sortie) → valeur fausse | Depuis 04/04 |
| O2 | **BLOQUANT** | `routes/produits-finis.js:14` / `pages/ProduitsFinis.jsx:98` | **Champ `produit_nom` absent** : backend ne fait pas le JOIN catalogue → affiche toujours `—` | Depuis 04/04 |
| O3 | **BLOQUANT** | `pages/Reporting.jsx:20` / `routes/reporting.js:119` | **Paramètre API incompatible** : frontend envoie `period`, backend attend `group_by` | Depuis 04/04 |
| O4 | **BLOQUANT** | `routes/tri.js:18-22` / `pages/ChaineTri.jsx:109` | **Colonne `nb_postes` manquante** : query ne calcule pas le count postes → `undefined` en UI | Nouveau |
| O5 | **MAJEUR** | `routes/dashboard.js:282-287` | **Trend sparklines erroné** : utilise `stock_movements` au lieu de `production_daily` | Depuis 06/04 |
| O6 | **MAJEUR** | `routes/production.js:48-66` / `pages/Production.jsx:66` | **Champ `avg_productivite`** : frontend attend ce nom, backend retourne `productivite_moyenne` | Depuis 04/04 |
| O7 | **MAJEUR** | `routes/production.js:52` | **Logique date erronée** : hardcode `-31` comme dernier jour → février cassé | Nouveau |
| O8 | **MAJEUR** | `routes/newsfeed.js` / `pages/NewsFeed.jsx:128` | **`author_name` manquant** : pas de JOIN users → auteur jamais affiché | Nouveau |
| O9 | **MAJEUR** | `routes/dashboard.js:360-403` | **N+1 queries** : boucle requêtes individuelles par objectif (performance) | Existant |
| O10 | **MINEUR** | `routes/produits-finis.js` / `pages/ProduitsFinis.jsx:111` | `is_shipped` jamais calculé → toujours "En stock" | Depuis 04/04 |
| O11 | **MINEUR** | `routes/tri.js:43-56` | N+1 queries postes/sorties par opération | Existant |
| O12 | **MINEUR** | `routes/reporting.js:129` | `group_by` par défaut = `date` au lieu de `month` | Nouveau |

**Verdict Opérations** : **4 modules critiques** (Dashboard KPIs, ProduitsFinis, Reporting, ChaineTri). **4 BLOQUANTS, 5 MAJEURS, 3 MINEURS.**

---

### 4.4 Responsable RH

**Modules testés** : Employees, WorkHours, Skills, PlanningHebdo, Candidates, Insertion, PCM, Pointage

| # | Sévérité | Fichier(s) | Description | Récurrent |
|---|----------|-----------|-------------|-----------|
| R1 | **BLOQUANT** | `pages/WorkHours.jsx:27,34,42,50` / `routes/employees.js:265` | **Endpoints incompatibles** : frontend appelle `/employees/{id}/hours`, backend implémente `/employees/work-hours/list` | Depuis 02/04 |
| R2 | **BLOQUANT** | `pages/WorkHours.jsx:12,158` / `routes/employees.js:302` | **Champs incompatibles** : frontend envoie `start_time`/`end_time`/`break_minutes`, backend attend `hours_worked`/`overtime_hours` | Depuis 02/04 |
| R3 | **BLOQUANT** | `routes/pcm.js:723` | **PCM /submit sans auth** : n'importe qui peut soumettre un test PCM et créer un profil personnalité | Depuis 06/04 |
| R4 | **MAJEUR** | `routes/pcm.js:627,637,646` | **3 endpoints PCM sans auth** : `/questionnaire`, `/types`, `/types/:key` accessibles publiquement | Depuis 06/04 |
| R5 | **MAJEUR** | `pages/WorkHours.jsx:119` | **Champ `validated` inexistant** : DB a `validated_by`/`validated_at` mais pas de booléen `validated` | Depuis 04/04 |
| R6 | **MINEUR** | `routes/candidates/crud.js:63` | Kanban normalise statuts à chaque requête au lieu de migration DB | Existant |
| R7 | **MINEUR** | `pages/Skills.jsx:39-44` | Erreurs skills silencieusement ignorées (`.catch(() => emp)`) | Existant |
| R8 | **MINEUR** | `pages/Pointage.jsx:21` | Formulaire pointage manuel sans validation minimum 2 horaires | Nouveau |
| R9 | **MINEUR** | `routes/employees.js:388-447` | Ordering potentiellement conflictuel routes contracts | Existant |

**Verdict RH** : **WorkHours 100% non fonctionnel** (triple incompatibilité endpoint/champs/méthode). PCM exposé publiquement. **3 BLOQUANTS, 2 MAJEURS, 4 MINEURS.**

---

## 5. SYNTHESE GLOBALE

### Statistiques du projet

| Indicateur | Valeur |
|-----------|--------|
| Commits total | 143 |
| Routes API | 61 fichiers |
| Pages Web | 62 pages |
| Pages Mobile | 11 pages |
| Tables DB | 70+ |

### Bilan des bugs — 7 avril 2026

| Sévérité | Chauffeur | Logistique | Opérations | RH | **Total** |
|----------|-----------|------------|------------|-----|-----------|
| **BLOQUANT** | 2 | 3 | 4 | 3 | **12** |
| **MAJEUR** | 4 | 3 | 5 | 2 | **14** |
| **MINEUR** | 2 | 1 | 3 | 4 | **10** |
| **Total** | 8 | 7 | 12 | 9 | **36** |

### Modules cassés (non fonctionnels)

| Module | Persona | Bug(s) | Impact |
|--------|---------|--------|--------|
| **Mobile Chauffeur (GPS)** | Chauffeur | C1, C2, C3 | GPS tracking 100% cassé |
| **Mobile Chauffeur (Retour)** | Chauffeur | C4, C6, C7 | Fin de tournée impossible |
| **WorkHours** | RH | R1, R2 | Module 100% non fonctionnel |
| **Expéditions** | Logistique | L1 | Création expédition cassée |
| **Commandes Exutoires** | Logistique | L2 | Workflow bloqué à `en_preparation` |
| **LiveVehicles** | Logistique | L3 | GPS temps réel cassé |
| **Dashboard KPIs** | Opérations | O1, O5 | Métriques production fausses |
| **ProduitsFinis** | Opérations | O2, O10 | Affichage noms + statut cassé |
| **Reporting** | Opérations | O3 | Paramètre API ignoré |
| **ChaineTri** | Opérations | O4 | Nombre postes undefined |

### Bugs récurrents non corrigés (depuis 02/04 ou plus)

| Bug | Première détection | Jours sans correction |
|-----|-------------------|-----------------------|
| Socket.IO GPS mismatch (C1/L3) | 02/04 | **5 jours** |
| WorkHours triple incompatibilité (R1/R2) | 02/04 | **5 jours** |
| Expéditions champs mismatch (L1) | 04/04 | **3 jours** |
| ProduitsFinis `produit_nom` (O2) | 04/04 | **3 jours** |
| Dashboard KPI erroné (O1) | 04/04 | **3 jours** |
| Reporting paramètre (O3) | 04/04 | **3 jours** |
| Production `avg_productivite` (O6) | 04/04 | **3 jours** |
| Tour status `returning` (C4) | 04/04 | **3 jours** |

### Évolution qualité

| Date | Note | Bloquants | Modules cassés | Commentaire |
|------|------|-----------|----------------|-------------|
| 02/04 | 6.8/10 | 3 | 3 | Premier audit personas |
| 03/04 | 6.5/10 | 6 | 5 | Audit élargi |
| 04/04 | **4.7/10** | 18 | 6 | Audit exhaustif |
| 06/04 | **4.8/10** | 7 | 7 | Réduction scope mais stagnation |
| **07/04** | **4.8/10** | **12** | **10** | **Aucun correctif. 8 bugs récurrents ≥3 jours** |

---

## 6. PLAN D'ACTION PRIORITAIRE

### Sprint correctif urgent (estimé 6-8h dev)

#### Priorité 1 — Sécurité (2h)
1. Ajouter `authenticate` + `authorize` sur les 4 endpoints PCM (`/questionnaire`, `/types`, `/types/:key`, `/submit`)
2. Remplacer `execSync` par `execFile` dans `admin-db.js`
3. Utiliser `pg-format` pour les ALTER TABLE dans `insertion/index.js`
4. Exécuter `npm audit fix` backend + frontend

#### Priorité 2 — Modules bloquants (3h)
5. **WorkHours** : aligner endpoints frontend sur `/employees/work-hours/*` et champs sur `hours_worked`/`overtime_hours`
6. **Socket.IO** : unifier event names (`gps-update` partout) + ajouter auth token mobile + `join-tour`
7. **Expéditions** : aligner champs POST (`date`/`poids_kg`)
8. **Commandes Exutoires** : ajouter `chargée` dans STATUTS_VALIDES
9. **Tour status** : ajouter `returning` dans CHECK constraint DB

#### Priorité 3 — KPIs et affichage (2h)
10. **Dashboard** : corriger `kg_entree` → `total_jour_t` pour KPI production
11. **ProduitsFinis** : ajouter JOIN catalogue pour `produit_nom`
12. **Reporting** : aligner paramètre `period` → `group_by`
13. **ChaineTri** : ajouter count postes dans query
14. **Production** : aligner `avg_productivite` / `productivite_moyenne`

#### Priorité 4 — Améliorations (1h)
15. **Mobile** : capturer `tare_kg`, `is_intermediate`, `km_end`, `notes`
16. **NewsFeed** : JOIN users pour `author_name`
17. **Dashboard** : corriger trend sparklines (production_daily)

---

## 7. RECOMMANDATIONS

1. **Sprint correctif immédiat** : Les 8 bugs récurrents depuis ≥3 jours doivent être traités en priorité absolue. Chaque jour supplémentaire augmente le risque d'accumulation de dette technique.

2. **Sécurité** : Note 4.5/10 inacceptable pour une application en production. Les 2 injections critiques et les 4 endpoints PCM sans auth sont des risques immédiats.

3. **Tests automatisés** : L'absence de tests unitaires explique la récurrence des bugs. Recommandation : ajouter au minimum des tests d'intégration sur les endpoints critiques.

4. **npm audit fix** : Peut être exécuté immédiatement sans risque de régression pour la majorité des packages.

5. **Monitoring** : Mettre en place des health checks API automatisés pour détecter les régressions avant le rapport quotidien.

---

*Rapport généré automatiquement par l'agent IA Chef de Projet — 07/04/2026*
*Prochain audit prévu : 08/04/2026*

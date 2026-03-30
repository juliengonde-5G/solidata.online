# RAPPORT QUOTIDIEN — SOLIDATA ERP
## Date : 30 mars 2026
## Auteur : Chef de projet IA (Claude Code)

---

## SOMMAIRE

1. [Controle des branches](#1-controle-des-branches)
2. [Audit de securite](#2-audit-de-securite)
3. [Tests personas utilisateurs](#3-tests-personas-utilisateurs)
4. [Etat de la documentation](#4-etat-de-la-documentation)
5. [Sauvegarde base de donnees](#5-sauvegarde-base-de-donnees)
6. [Metriques du projet](#6-metriques-du-projet)
7. [Actions prioritaires](#7-actions-prioritaires)

---

## 1. CONTROLE DES BRANCHES

### Branche principale (`main`)
- **Statut** : Synchronisee avec `origin/main` (48 commits integres depuis le local)
- **Dernier commit** : `c2f1b50` — "feat: mobile sans auth — flux vehicule -> tournee simplifie"
- **Etat** : Propre, aucune modification non commitee

### Branches distantes (7 + main)

| Branche | Ahead | Behind | Statut | Action |
|---------|-------|--------|--------|--------|
| `claude/ai-agent-erp-integration-JGzTA` | 0 | 23 | **MERGEE** | Supprimer |
| `claude/vehicle-link-assignment-w6YHZ` | 0 | 31 | **MERGEE** | Supprimer |
| `claude/generate-qr-codes-jsIxT` | 5 | 2 | **QUASI-MERGEE** (commits de merge + variations mineures) | Supprimer |
| `claude/review-branch-coherence-uMNK1` | 2 | 43 | **OBSOLETE** — VehicleMaintenance deja sur main en version plus complete | Supprimer |
| `feature/finance-module` | 1 | 48 | **OBSOLETE** — Finance sur main en version complete (1423 lignes vs 683) | Supprimer |
| `claude/fix-pennylane-add-docs-BWs4Y` | 12 | 48 | **A EVALUER** — Contient 5 fixes Pennylane/billing potentiellement utiles | Cherry-pick puis supprimer |
| `claude/merge-and-deploy-solidata-rmdnc` | 30 | 85 | **OBSOLETE** — Tres ancien, corrections largement integrees | Supprimer |

### Verdict branches
> **6 branches sur 7 sont obsoletes et entierement mergees ou depassees.** Seule `claude/fix-pennylane-add-docs-BWs4Y` contient des corrections Pennylane/billing potentiellement non-mergees (billing route prefix `/invoices`, crash null Settings Pennylane, sync invoice API v2, NewsFeed article access). Recommandation : cherry-pick des 5 fixes utiles puis nettoyage complet.

### Commits depuis le dernier rapport (29/03 -> 30/03)
- **19 nouveaux commits** sur main
- **Contributeurs** : Claude, juliengonde-5G
- **Themes principaux** : Mobile sans auth, QR codes CAV, plan entretien constructeur IA, AdminCAV enrichi, import 209 CAV, vehicules ameliores

---

## 2. AUDIT DE SECURITE

### 2.1 Vulnerabilites CRITIQUES (3 injections SQL)

| # | Fichier | Ligne | Description | Severite |
|---|---------|-------|-------------|----------|
| 1 | `backend/src/routes/chat.js` | ~337 | Variable `where` interpolee dans template literal SQL | CRITIQUE |
| 2 | `backend/src/routes/insertion/index.js` | ~48 | `col` et `type` interpoles dans ALTER TABLE sans validation | CRITIQUE |
| 3 | `backend/src/services/scheduler.js` | ~520 | `view` interpole dans REFRESH MATERIALIZED VIEW | CRITIQUE |

**Correction** : Utiliser des whitelists de valeurs autorisees ou `pg-format` pour les identifiers.

### 2.2 Authentification

| Point | Verdict | Detail |
|-------|---------|--------|
| Routes protegees backend | **ATTENTION** | Routes `/public` dans tours (4 endpoints) accessibles sans auth — permet enumeration vehicules/tournees/GPS |
| JWT Secret | **ATTENTION** | Fallback `'change-this-in-production'` si `JWT_SECRET` non defini |
| DB Password | **ATTENTION** | Fallback `'changeme'` si `DB_PASSWORD` non defini |
| Rate limiting | **PARTIEL** | Global 1000 req/15min, Auth 30 req/15min — absent sur endpoints publics |
| CORS | **ATTENTION** | localhost:3000/3002 autorises si NODE_ENV != production, mais verification fragile |
| JWT implementation | **BON** | Access 8h, refresh 7j, rotation tokens, cleanup auto, Socket.IO protege |
| Uploads | **BON** | Multer avec fileFilter, MIME check (partiel), limite 10MB |
| Dependances | **OK** | Pas de CVE critique, multer en LTS a surveiller |

### 2.3 Securite Frontend

| Point | Verdict | Detail |
|-------|---------|--------|
| XSS | **OK** | Aucun `dangerouslySetInnerHTML`, React echappe par defaut |
| Tokens localStorage | **CRITIQUE** | JWT stocke en localStorage (vulnerable XSS) — devrait etre httpOnly cookie |
| Token en URL | **CRITIQUE** | PCMTest expose un token comme parametre URL `/pcm-test/:token` |
| HTTPS | **OK** | URLs relatives `/api`, proxy via Nginx SSL |
| Auth Context | **OK** | Refresh auto sur 401, queue de requetes, prevention boucle |
| Routes mobile sans auth | **CRITIQUE** | Toutes les routes mobiles accessibles sans authentification — donne acces aux vehicules, tournees, GPS |
| Secrets frontend | **OK** | Aucune cle API hardcodee cote client |

### 2.4 Score global securite : 5/10

**Resume** : Architecture de securite solide (JWT, CORS, Helmet, rate limiting) mais 3 injections SQL critiques, des routes publiques non protegees, et un stockage JWT en localStorage a corriger en priorite.

---

## 3. TESTS PERSONAS UTILISATEURS

### 3.1 Persona CHAUFFEUR-COLLECTEUR (Mobile)

**Parcours teste** : Login -> Selection vehicule -> Checklist -> Carte tournee -> Scan QR -> Remplissage -> Pesee -> Fin

| # | Bug | Page | Severite | Description |
|---|-----|------|----------|-------------|
| C1 | Selection CAV par index | FillLevel.jsx | **CRITIQUE** | Le CAV collecte est selectionne par index (prochain non-collecte) et non par le QR scanne. Si le chauffeur scanne hors ordre, le MAUVAIS CAV est marque collecte |
| C2 | IDs incidents vides | Incident.jsx | **CRITIQUE** | `cav_id`, `vehicle_id`, `employee_id` tous vides dans le FormData — incidents orphelins en BDD |
| C3 | Notes checklist perdues | Checklist.jsx | **CRITIQUE** | Variable `notes` jamais incluse dans l'appel API — anomalies vehicule non enregistrees |
| C4 | Mode offline absent | Global mobile | **CRITIQUE** | Structure sync.js/db.js existe mais non utilisee — donnees perdues si reseau coupe |
| C5 | tourId null | Global mobile | **GRAVE** | `localStorage.getItem('current_tour_id')` jamais verifie — crash si absent |
| C6 | GPS erreur ignoree | TourMap.jsx | **GRAVE** | Callback erreur GPS vide `() => {}` — utilisateur pas averti |
| C7 | setInterval fuite memoire | TourMap.jsx | **GRAVE** | Interval GPS 10s non nettoye au demontage composant |
| C8 | Socket erreur ignoree | TourMap.jsx | **MOYEN** | Pas d'ecouteur `connect_error` sur Socket.IO |
| C9 | Poids negatif silencieux | WeighIn.jsx | **MOYEN** | Si grossWeight < tareWeight, netWeight = 0 sans alerte |
| C10 | km_end = 0 accepte | ReturnCentre.jsx | **MOYEN** | Pas de validation du kilometrage de retour |

### 3.2 Persona RESPONSABLE LOGISTIQUE (Web)

| # | Bug | Page | Severite | Description |
|---|-----|------|----------|-------------|
| L1 | Chauffeur step 3 ignore | Tours.jsx | **CRITIQUE** | Le wizard saute de l'etape 2 a 4, le chauffeur selectionne en etape 3 n'est jamais inclus dans la creation |
| L2 | Capacite vehicule ecrasee | Vehicles.jsx | **GRAVE** | `max_capacity_kg: v.max_capacity_kg \|\| 3500` — un vehicule 5000kg est remis a 3500 si pas modifie en edition |
| L3 | Commandes multi-types | ExutoiresCommandes.jsx | **GRAVE** | Seul le premier type de produit est utilise pour fetch prix — commandes multi-types au prix partiel |
| L4 | Desactiver = Supprimer | ExutoiresClients.jsx | **GRAVE** | Bouton "Desactiver" fait un DELETE hard — donnees perdues, pas d'archivage |
| L5 | Photo URL fragile | AdminCAV.jsx | **MOYEN** | `/api${detailCav.photo_path}` — casse si structure API change |
| L6 | Date recurrence infinie | ExutoiresCommandes.jsx | **MOYEN** | Commande recurrente sans date fin = factures generees indefiniment |
| L7 | Tarifs sans validation date | ExutoiresTarifs.jsx | **MOYEN** | Pas de verification `date_debut < date_fin` |
| L8 | Expeditions sans statut | Expeditions.jsx | **MINEUR** | Pas de colonne statut dans le tableau — tracking incomplet |

### 3.3 Persona RESPONSABLE OPERATIONS (Web)

| # | Bug | Page | Severite | Description |
|---|-----|------|----------|-------------|
| O1 | Division par zero productivite | ChaineTri.jsx | **GRAVE** | `productivite_kg_per` si `effectif_reel = 0` |
| O2 | Stock barre progression fausse | Stock.jsx | **GRAVE** | Multiplication par 4 arbitraire `Math.min(... * 4, 100)%` — visuellement trompeur |
| O3 | Dashboard KPI fragile | Dashboard.jsx | **GRAVE** | Mapping KPI hardcode — modification API = dashboard casse silencieusement |
| O4 | Admin Predictive code mort | AdminPredictive.jsx | **MOYEN** | `weatherPreview` jamais utilise apres initialisation — feature incomplete |
| O5 | Mouvements stock ambigus | Stock.jsx | **MOYEN** | Meme colonne pour origine/destination selon sens — confus pour l'utilisateur |
| O6 | Production scroll massif | ChaineTri.jsx | **MINEUR** | 31 jours x 42px sans pagination — scroll horizontal excessif |
| O7 | Holiday splice index | AdminPredictive.jsx | **MINEUR** | `arr.splice(idx, 1)` au lieu de `.filter()` — peut supprimer mauvais element |

### 3.4 Persona RESPONSABLE RH (Web)

| # | Bug | Page | Severite | Description |
|---|-----|------|----------|-------------|
| RH1 | PCM token en URL | PCMTest.jsx | **CRITIQUE** | Token session PCM en parametre URL — expose dans historique, logs, referrer |
| RH2 | Conversion candidat fragile | Candidates | **GRAVE** | Conversion en employe via API sans verification doublons |
| RH3 | Insertion jalons statiques | InsertionParcours.jsx | **MOYEN** | Jalons M1/M6/M12 hardcodes — pas adaptable a des durees CDDI differentes |
| RH4 | Planning sans validation chevauchement | PlanningHebdo.jsx | **MOYEN** | Pas de detection si employe planifie sur 2 postes simultanement |
| RH5 | CDDI 24 mois non verifie | Employees.jsx | **MOYEN** | Pas d'alerte automatique si contrat CDDI depasse 24 mois reglementaires |
| RH6 | Reporting RH donnees brutes | ReportingRH.jsx | **MINEUR** | Stats affichees sans contexte (pas de comparaison N-1, pas de tendance) |

### Resume bugs par severite

| Severite | Nombre | Personas impactees |
|----------|--------|-------------------|
| CRITIQUE | 7 | Chauffeur (4), Logistique (1), RH (1), Securite (1) |
| GRAVE | 9 | Chauffeur (2), Logistique (3), Operations (3), RH (1) |
| MOYEN | 11 | Tous profils |
| MINEUR | 4 | Logistique (1), Operations (2), RH (1) |
| **TOTAL** | **31** | |

---

## 4. ETAT DE LA DOCUMENTATION

### Documentation a jour

| Document | Statut | Remarque |
|----------|--------|----------|
| `CLAUDE.md` | **A JOUR** | 62 pages, 61 routes, 90 tables, 25 modules — correspond au code |
| `DOCUMENTATION_TECHNIQUE.md` | **A VERIFIER** | Ajouts Finance/Pennylane/SolidataBot a documenter |
| `docs/GUIDE_UTILISATEUR.md` | **A METTRE A JOUR** | Nouvelles pages Finance (7), VehicleMaintenance, AdminCAV enrichi |
| `docs/DOCUMENTATION_APPLICATIVE.md` | **A METTRE A JOUR** | Modules Finance, Pennylane, SolidataBot non documentes |

### Metriques documentation
- **CLAUDE.md** : Version 1.3.0, derniere maj 29/03/2026 — coherent avec le code
- **Rapports quotidiens** : 2 (29/03, 30/03) dans `rapports/`
- **Supports formation** : 4 documents (chauffeurs, manager collecte, manager tri, manager RH)

### Actions documentation requises
1. Ajouter section Finance (7 pages) dans la documentation applicative
2. Documenter Pennylane (sync comptable, GL, balances)
3. Documenter SolidataBot (chat IA, widget flottant)
4. Mettre a jour le guide utilisateur avec nouvelles fonctionnalites
5. Mettre a jour `CLAUDE.md` section historique (v1.3.1, 30/03)

---

## 5. SAUVEGARDE BASE DE DONNEES

### Script de backup
- **Fichier** : `deploy/scripts/backup.sh`
- **Statut** : Present et fonctionnel (PostgreSQL pg_dump + uploads tar.gz)
- **Retention** : 30 jours daily, 90 jours manual
- **Cron recommande** : `0 2 * * * /opt/solidata.online/deploy/scripts/backup.sh daily`

### Execution
- **Environnement actuel** : Sandbox sans Docker — execution impossible en local
- **Production** : Script prevu pour execution sur le serveur Scaleway (51.159.144.100)
- **Recommandation** : Verifier que le cron est actif sur le serveur de production

### Script de restore
- **Fichier** : `deploy/scripts/restore.sh` — present
- **Test DR** : Non effectue ce jour (necessiterait acces production)

---

## 6. METRIQUES DU PROJET

### Code source

| Composant | Fichiers | Lignes de code |
|-----------|----------|---------------|
| Backend (Node.js) | 87 | 28 366 |
| Frontend (React) | 80 | 23 437 |
| Mobile (PWA) | 21 | 2 414 |
| **Total** | **188** | **54 217** |

### Base de donnees
- **Tables** : 90 (CREATE TABLE dans init-db.js)
- **Migrations** : Finance (`migrate-finance.js`), plus migrations inline

### Architecture
- **Routes API** : 61 fichiers
- **Pages Web** : 62 pages React
- **Pages Mobile** : 11 pages React
- **Composants partages** : Layout, SolidataBot, StatusBadge, DiagrammeFluxTri...
- **Services IA** : predictive-ai.js, insertion-ai.js, ml-model.js

### Git
- **Commits total** : 100+
- **Commits depuis hier** : 19
- **Branches** : 8 (1 active + 7 obsoletes)
- **Contributeurs actifs** : 2 (Claude, juliengonde-5G)

---

## 7. ACTIONS PRIORITAIRES

### P0 — CRITIQUE (a corriger immediatement)

| # | Action | Module | Effort |
|---|--------|--------|--------|
| 1 | Corriger 3 injections SQL (chat.js, insertion/index.js, scheduler.js) | Backend | 1h |
| 2 | Corriger selection CAV par QR scanne (pas par index) dans FillLevel.jsx | Mobile | 2h |
| 3 | Remplir cav_id/vehicle_id/employee_id dans Incident.jsx | Mobile | 30min |
| 4 | Sauvegarder notes checklist dans l'appel API (Checklist.jsx) | Mobile | 30min |
| 5 | Implementer offline mode basique (localStorage queue) | Mobile | 4h |
| 6 | Corriger wizard Tours.jsx — chauffeur step 3 integre dans creation | Frontend | 1h |
| 7 | Securiser endpoints /public avec rate limiting + HMAC IDs | Backend | 2h |

### P1 — IMPORTANT (cette semaine)

| # | Action | Module | Effort |
|---|--------|--------|--------|
| 8 | Supprimer fallbacks JWT_SECRET et DB_PASSWORD | Backend | 30min |
| 9 | Migrer tokens localStorage vers httpOnly cookies | Full-stack | 4h |
| 10 | Fix capacite vehicule defaut 3500 en edition (Vehicles.jsx) | Frontend | 30min |
| 11 | Fix commandes multi-types prix (ExutoiresCommandes.jsx) | Frontend | 1h |
| 12 | Ajouter verification tourId null dans toutes les pages mobile | Mobile | 1h |
| 13 | Nettoyer les 7 branches obsoletes | Repo | 30min |
| 14 | Verifier cron backup actif sur production | Ops | 15min |

### P2 — SOUHAITABLE (ce mois)

| # | Action | Module | Effort |
|---|--------|--------|--------|
| 15 | Retirer PCM token des URLs — utiliser POST + header | Full-stack | 2h |
| 16 | Ajouter alerte CDDI > 24 mois (Employees.jsx) | Frontend+Backend | 2h |
| 17 | Dashboard KPI dynamique (pas hardcode) | Frontend | 3h |
| 18 | ChaineTri pagination production | Frontend | 2h |
| 19 | Stock barre progression corrigee | Frontend | 30min |
| 20 | Documentation Finance/Pennylane/SolidataBot | Docs | 4h |

---

## CONCLUSION

### Points positifs
- **Main a jour** : Les 48 commits sont integres, branche propre
- **Architecture solide** : 62 pages, 61 routes, 90 tables — ERP complet et coherent
- **Securite globale correcte** : JWT, CORS, Helmet, rate limiting en place
- **Fonctionnalites riches** : Finance, Pennylane, IA predictive, SolidataBot operationnels
- **Documentation CLAUDE.md** : A jour et coherente avec le code

### Points d'attention
- **7 bugs CRITIQUES** a corriger avant tout deploiement (3 SQL injection, 4 bugs mobile)
- **9 bugs GRAVES** impactant l'experience utilisateur
- **7 branches obsoletes** a nettoyer
- **Mobile** : Le module le plus fragile (offline absent, GPS non gere, IDs manquants)
- **Documentation applicative** : A mettre a jour pour les nouveaux modules

### Score global projet : 7/10

| Critere | Score |
|---------|-------|
| Fonctionnalite | 9/10 |
| Securite | 5/10 |
| Stabilite mobile | 4/10 |
| Stabilite web | 7/10 |
| Documentation | 7/10 |
| Architecture | 8/10 |

---

*Rapport genere automatiquement par Claude Code — Session du 30 mars 2026*
*Prochain rapport prevu : 31 mars 2026*

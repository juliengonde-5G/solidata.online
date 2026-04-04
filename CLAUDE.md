# SOLIDATA ERP — Instructions pour Agents IA

> **Ce fichier est le contexte de référence pour tout agent IA (Claude, Copilot, etc.) travaillant sur le projet SOLIDATA.**
> Il est lu automatiquement par Claude Code au démarrage de chaque session.
> Dernière mise à jour : 31 mars 2026

---

## 1. IDENTITE DU PROJET

**SOLIDATA** est un ERP (Enterprise Resource Planning) conçu pour **Solidarité Textiles**, une structure d'insertion par l'activité économique (SIAE/IAE) spécialisée dans la collecte, le tri et la valorisation de textiles usagés en Normandie (Rouen).

- **Domaine** : https://solidata.online
- **Mobile** : https://m.solidata.online
- **Dépôt** : https://github.com/juliengonde-5G/solidata.online
- **Branche principale** : `main`
- **Serveur production** : Scaleway DEV1-S, IP 51.159.144.100
- **Répertoire serveur** : `/opt/solidata.online`

---

## 2. STACK TECHNIQUE

| Couche | Technologies |
|--------|-------------|
| **Backend** | Node.js 20, Express 4.21, PostgreSQL 15 + PostGIS 3.4, Redis 7, Socket.IO 4.8, BullMQ |
| **Frontend Web** | React 18.3, Vite 6, Tailwind CSS 3.4, React Router 7, Recharts, Leaflet |
| **Mobile PWA** | React 18.3, Vite + vite-plugin-pwa, Tailwind, html5-qrcode, Socket.IO |
| **Infrastructure** | Docker Compose (7 conteneurs), Nginx reverse proxy, Let's Encrypt SSL, UFW, Fail2ban |
| **Sécurité** | JWT (access 8h + refresh 7j), bcrypt, AES-256 (PCM), rate limiting, HSTS |
| **IA/ML** | Moteur prédictif remplissage CAV, optimisation tournées, insertion IA |

---

## 3. ARCHITECTURE DES CONTENEURS

```
Internet → Nginx SSL (:443)
              ├── solidata.online     → solidata-web (React, :80)
              ├── m.solidata.online   → solidata-mobile (PWA, :80)
              ├── /api/*              → solidata-api (Node.js, :3001)
              ├── /socket.io/*        → solidata-api (WebSocket)
              └── /uploads/*          → solidata-api (fichiers)
                                           ├── solidata-db (PostgreSQL+PostGIS, :5432)
                                           └── solidata-redis (Redis 7, :6379)
```

---

## 4. STRUCTURE DU CODE

```
solidata.online/
├── backend/src/
│   ├── index.js              # Entry point Express + Socket.IO + auto-init DB
│   ├── config/database.js    # Pool PostgreSQL
│   ├── middleware/auth.js     # authenticate() + authorize(...roles)
│   ├── routes/               # 61 fichiers de routes API
│   ├── services/             # predictive-ai.js, insertion-ai.js, ml-model.js
│   └── scripts/              # init-db.js, seed-*.js, migrate-*.js
├── frontend/src/
│   ├── App.jsx               # Routeur (62 pages, ProtectedRoute)
│   ├── contexts/AuthContext.jsx  # Auth state + token refresh
│   ├── services/api.js       # Axios instance + interceptors
│   ├── components/Layout.jsx # Sidebar + navigation role-based
│   └── pages/                # 62 pages React
├── mobile/src/
│   ├── App.jsx               # Routeur mobile (11 pages)
│   ├── services/haptic.js    # Vibration feedback
│   └── pages/                # Parcours chauffeur-collecteur
├── ai-agent/
│   ├── app.py                # SolidataBot — agent IA conversationnel (Flask + Claude API)
│   ├── Dockerfile            # Conteneur Python pour l'agent IA
│   └── static/               # Interface chat (HTML/CSS/JS)
├── deploy/
│   ├── scripts/              # deploy.sh, init-server.sh, backup.sh, health-check.sh
│   └── nginx/                # Config reverse proxy SSL
├── rapports/                 # Rapports quotidiens automatisés
├── docker-compose.yml        # Dev
├── docker-compose.prod.yml   # Production (8 services + limits mémoire)
└── docs/                     # Documentation complète
```

---

## 5. MODULES FONCTIONNELS (25 modules)

### Modules core
| # | Module | Routes API | Pages Web | Description |
|---|--------|-----------|-----------|-------------|
| 1 | Auth & Admin | auth, users, settings | Login, Users, Settings | JWT, 5 rôles (ADMIN/MANAGER/RH/COLLABORATEUR/AUTORITE) |
| 2 | Recrutement | candidates | Candidates | Kanban 4 colonnes (Reçus/Entretien/Recrutés/Refusés), CV parsing, entretiens structurés, mise en situation |
| 3 | PCM | pcm | PersonalityMatrix, PCMTest | Test personnalité 20 questions, 6 types, scoring pondéré, export PDF A4 |
| 4 | Gestion RH | employees, teams | Employees, WorkHours, Skills, PlanningHebdo | Contrats, heures, compétences, planning hebdo 4 filières |
| 5 | Insertion | insertion | InsertionParcours | Parcours insertion IA, 3 jalons (M1/M6/M12), radar 7 freins, plans d'action |
| 6 | Collecte | cav, vehicles, tours | Tours, CAVMap, Vehicles, LiveVehicles, FillRateMap, CollectionProposals | CAV géolocalisés, 3 modes tournée, GPS temps réel, IA prédictive |
| 7 | Tri & Production | tri, production, produits-finis | ChaineTri, Production, ProduitsFinis | 2 chaînes, batch tracking, code-barres, KPI productivité |
| 8 | Stock | stock | Stock | Mouvements entrée/sortie, inventaire physique, code-barres |
| 9 | Expéditions | expeditions | Expeditions | Expéditions vers exutoires, bons de livraison, conteneurs |
| 10 | Facturation | billing | — | Factures HT/TVA/TTC, statuts brouillon→payée |

### Modules avancés
| # | Module | Routes API | Pages Web | Description |
|---|--------|-----------|-----------|-------------|
| 11 | Logistique Exutoires | clients/tarifs/commandes/factures-exutoires, preparations, controles-pesee, calendrier-logistique | 7 pages Exutoires* | Workflow commande 8 statuts, préparation, pesée, Gantt, calendrier |
| 12 | Reporting | reporting, historique, exports | 4 pages Reporting* | Collecte, Production, RH, Métropole |
| 13 | Refashion | refashion | Refashion | DPAV trimestriel, subventions éco-organisme REP textile |
| 14 | RGPD | rgpd | RGPD | Registre traitements, audit log, consentements, anonymisation |
| 15 | IA Prédictive | — (intégré tours) | AdminPredictive | Facteurs saisonniers, météo, événements locaux, feedback loop |
| 16 | Maintenance | — (intégré vehicles) | Vehicles | Alertes maintenance, contrôle technique, vidange, pneus, freins |
| 17 | Capteurs LoRaWAN | — (intégré cav) | — | Données capteurs IoT remplissage CAV |
| 18 | Notifications | notifications | — | SMS/email via Brevo, triggers automatiques |
| 19 | Admin DB | admin-db | AdminDB | Backup/restore, VACUUM, purge, statistiques |
| 20 | Fil d'actualités | newsfeed | NewsFeed | Articles catégorisés, épinglage |
| 21 | Référentiels | referentiels | Referentiels | Associations, exutoires, catalogue produits, conteneurs |
| 22 | Finance | finance | Finance*, FinancePL, FinanceBilan, FinanceTresorerie, FinanceControles, FinanceRentabilite, FinanceOperations | P&L analytique, bilan, trésorerie, contrôle de gestion, rentabilité matière |
| 23 | Pennylane | pennylane | Pennylane | Synchronisation comptable, Grand Livre, balances, factures |
| 24 | SolidataBot | chat | — (widget flottant) | Chat IA conversationnel Claude, contexte ERP, analyse insertion/prédictif |
| 25 | Pointage | pointage | Pointage | Gestion des pointages employés |

---

## 6. BASE DE DONNÉES (70+ tables)

### Tables principales par domaine

**Auth** : users, refresh_tokens, settings, message_templates
**Recrutement** : candidates, candidate_history, candidate_skills, skill_keywords, recruitment_interviews, mise_en_situation, recruitment_documents, recruitment_plan
**PCM** : pcm_sessions, pcm_answers, pcm_reports
**RH** : teams, employees, positions, employee_contracts, employee_availability, schedule, work_hours
**Insertion** : insertion_diagnostics, insertion_milestones, cip_action_plans, insertion_interview_alerts
**Collecte** : cav, vehicles, standard_routes, standard_route_cav, tours, tour_cav, tour_weights, incidents, gps_positions, tonnage_history, vehicle_checklists, cav_qr_scans
**Stock** : matieres, stock_movements, flux_sortants
**Tri** : chaines_tri, operations_tri, postes_operation, sorties_operation, categories_sortantes, types_conteneurs, produits_catalogue, produits_finis
**Exécution tri** : batch_tracking, operation_executions, operation_outputs, colisages, colisage_items, colisage_history
**Expéditions** : expeditions, associations, exutoires
**Logistique exutoires** : clients_exutoires, tarifs_exutoires, commandes_exutoires, preparations_expedition
**Facturation** : invoices, invoice_lines
**Production** : production_daily, reporting_refashion
**Refashion** : refashion_dpav, refashion_communes, refashion_subventions
**Inventaire** : inventory_batches, inventory_items
**Maintenance** : vehicle_maintenance, vehicle_maintenance_alerts
**Capteurs** : cav_sensor_readings
**IA/ML** : ml_fill_predictions, ml_model_metadata, collection_context, evenements_locaux, collection_learning_feedback
**Grille tarifaire** : grille_tarifaire
**RGPD** : rgpd_registre, rgpd_consents, rgpd_audit_log
**Objectifs** : periodic_objectives
**Finance** : financial_exercises, financial_periods, financial_entries, pennylane_config, pennylane_sync_log
**Notifications** : notification_triggers
**Historique** : historique_mensuel

---

## 7. CONVENTIONS DE CODE

### Backend
- **Routes** : Express Router, un fichier par domaine dans `backend/src/routes/`
- **Auth** : `authenticate` middleware vérifie JWT, `authorize('ADMIN', 'RH')` vérifie le rôle
- **Base** : requêtes via `pool.query()` (pg), paramétrisées ($1, $2...)
- **Erreurs** : `res.status(code).json({ error: 'message' })`
- **Fichiers** : upload via Multer, stockés dans `/app/uploads`
- **Chiffrement** : AES-256 via crypto-js pour données sensibles (PCM)

### Frontend
- **Pages** : un fichier par page dans `frontend/src/pages/`, composant fonctionnel React
- **State** : React hooks (useState, useEffect, useCallback, useMemo, useRef)
- **Auth** : `useAuth()` hook depuis AuthContext
- **API** : `import api from '../services/api'` → `api.get()`, `api.post()`
- **Routing** : `<ProtectedRoute roles={['ADMIN', 'RH']}>`
- **Style** : Tailwind CSS, couleurs via CSS variables (--color-bg, --primary, etc.)
- **Couleur marque** : vert `#2D8C4E` (solidata-green), vert clair `#8BC540`

### Mobile
- **Navigation** : même pattern que le web (React Router)
- **Token** : stocké dans `mobile_token` / `mobile_refresh_token` (localStorage)
- **Haptic** : `vibrateSuccess()`, `vibrateError()`, `vibrateTap()` depuis services/haptic.js
- **GPS** : navigator.geolocation.watchPosition → Socket.IO emit toutes les 10s

---

## 8. REGLES DE DEVELOPPEMENT

### Principes
1. **Pas de régression** — Toujours vérifier que les modules existants fonctionnent après modification
2. **Cohérence** — Suivre les patterns existants (même structure de route, même pattern de page React)
3. **Sécurité** — Toute route sensible doit utiliser `authenticate` + `authorize`. Jamais de requête SQL non paramétrisée
4. **Base de données** — Nouvelles tables via `init-db.js` (création idempotente avec `IF NOT EXISTS`). Migrations dans la section migrations de init-db.js
5. **Pas de librairie externe sauf nécessité** — Le projet est léger par design. Vérifier les dépendances existantes avant d'en ajouter
6. **Docker** — Tout changement doit fonctionner dans les conteneurs Docker. Tester le build avant de pousser
7. **Français** — L'interface est en français. Les noms de variables backend peuvent être en anglais, les labels UI sont en français

### Workflow de déploiement
```
Développeur → git push origin main → SSH serveur → bash deploy/scripts/deploy.sh update
```
Le script `deploy.sh update` fait : backup auto → git pull → docker build --no-cache → restart → prune images.

### Tests
- Smoke tests API : `node scripts/tests/api-smoke.js` (vérifie health, login, endpoints protégés)
- Pas de framework de test unitaire en place — les tests sont manuels et smoke

---

## 9. CONTEXTE METIER (Solidarité Textiles)

### Activité
- **Structure d'insertion** : emploie des personnes éloignées de l'emploi (CDD d'insertion, CDDI)
- **Filière textile** : collecte → tri → valorisation (réemploi, recyclage, CSR, effilochage, VAK)
- **Territoire** : Normandie, métropole de Rouen
- **Éco-organisme** : Refashion (filière REP textile, reporting DPAV trimestriel obligatoire)
- **Centre de tri** : coordonnées 49.4231°N, 1.0993°E

### Vocabulaire métier
| Terme | Définition |
|-------|-----------|
| **CAV** | Conteneur d'Apport Volontaire — point de collecte textile dans la rue |
| **PAV** | Point d'Apport Volontaire (synonyme de CAV) |
| **Exutoire** | Destinataire des produits triés (recycleur, fripier, export VAK...) |
| **CSR** | Combustible Solide de Récupération (valorisation énergétique) |
| **VAK** | Vêtements, Articles, Kilogrammes — catégorie export |
| **Crackage** | Première opération de tri (ouverture des sacs, pré-tri grossier) |
| **Refashion** | Éco-organisme de la filière REP textile (déclarations obligatoires) |
| **DPAV** | Déclaration de Points d'Apport Volontaire (reporting Refashion) |
| **PCM** | Process Communication Model — test de personnalité à 6 types |
| **CDDI** | Contrat à Durée Déterminée d'Insertion (max 24 mois) |
| **SIAE** | Structure d'Insertion par l'Activité Économique |
| **CIP** | Conseiller en Insertion Professionnelle |
| **Parcours d'insertion** | Suivi individuel avec jalons M1/M6/M12, 7 freins périphériques |
| **Filière** | Secteur d'activité interne : tri, collecte, logistique, boutique |
| **Balles** | Unité de conditionnement textile pressé (~400kg) |
| **Tare** | Poids du véhicule vide (pour calcul poids net collecté) |

### Parties prenantes externes
- **Refashion** : éco-organisme, subventions trimestrielles
- **Métropole Rouen** : reporting territorial
- **Brevo** (ex-Sendinblue) : envoi SMS/email
- **Scaleway** : hébergement serveur
- **Let's Encrypt** : certificats SSL

---

## 10. PISTES DE DEVELOPPEMENT ET INNOVATION

### Court terme (déjà amorcé)
- [ ] Capteurs IoT LoRaWAN sur les CAV (table `cav_sensor_readings` prête)
- [ ] Maintenance prédictive véhicules (tables `vehicle_maintenance*` prêtes)
- [ ] Contrôle pesée double (table prête, UI à enrichir)
- [ ] OCR factures fournisseurs (tesseract.js déjà en dépendance)

### Moyen terme (architecture prête)
- [ ] Modèle ML de prédiction remplissage CAV (tables ML prêtes, feedback loop en place)
- [ ] Optimisation IA des tournées avec contraintes temps réel (météo, trafic, événements)
- [ ] Application mobile offline-first complète (PWA + IndexedDB)
- [ ] Dashboard temps réel avec Socket.IO (KPIs live, alertes push)
- [ ] Notifications push mobile (Service Worker)
- [ ] Intégration ERP comptable (export FEC, lien avec logiciel compta)

### Long terme (vision)
- [ ] API ouverte pour partenaires (exutoires, associations, collectivités)
- [ ] Marketplace textile inter-SIAE
- [ ] Traçabilité blockchain de la fibre textile
- [ ] Computer vision pour classification automatique au tri
- [ ] Chatbot IA d'accompagnement insertion (basé sur données PCM + parcours)
- [ ] Multi-site (plusieurs centres de tri, consolidation reporting)
- [ ] Module RSE / bilan carbone complet
- [ ] Connexion Refashion API (quand disponible, actuellement déclaratif)

### Points d'extension technique
| Point d'entrée | Fichier | Usage potentiel |
|----------------|---------|-----------------|
| Nouvelles routes API | `backend/src/routes/` + `backend/src/index.js` (app.use) | Tout nouveau module |
| Nouvelles tables | `backend/src/scripts/init-db.js` (section CREATE TABLE) | Nouvelles entités |
| Nouvelles pages | `frontend/src/pages/` + `frontend/src/App.jsx` (Route) | Nouveaux écrans |
| Navigation | `frontend/src/components/Layout.jsx` (menuSections) | Nouveau menu |
| Socket.IO | `backend/src/index.js` (io.on) | Événements temps réel |
| Jobs asynchrones | BullMQ (déjà configuré) | Tâches longues, emails, ML |
| Imports données | `backend/src/scripts/` | Seeds, migrations, imports Excel/KML |

---

## 11. FICHIERS DOCUMENTATION

| Fichier | Contenu | Public |
|---------|---------|--------|
| `CLAUDE.md` | Ce fichier — instructions IA | Développeurs + IA |
| `DOCUMENTATION_TECHNIQUE.md` | Architecture complète, BDD, API, déploiement | Technique |
| `docs/DOCUMENTATION_APPLICATIVE.md` | Comportement fonctionnel de chaque module | Fonctionnel |
| `docs/GUIDE_UTILISATEUR.md` | Guide pas-à-pas pour les utilisateurs | Utilisateurs |
| `deploy/DEPLOIEMENT.md` | Guide déploiement production | Ops |
| `RECONSTRUCTION.md` | Procédure de reconstruction complète | Disaster recovery |
| `docs/CDC_MODULE_LOGISTIQUE_EXUTOIRES.md` | Cahier des charges logistique | Spécification |
| `docs/PLAN_TESTS_COMPLET.md` | Plan de test (133 cas) | QA |
| `docs/DIAGRAMME_CHAINE_TRI.md` | Flux chaîne de tri | Métier |
| `docs/DIAGRAMME_FLUX_COMPLET.md` | Flux complet collecte→expédition | Métier |
| `docs/SCHEMA_CHAINE_TRI.md` | Schéma visuel détaillé chaîne de tri | Métier |
| `docs/SCHEMA_FLUX_MATIERES.md` | Schéma visuel flux matières entrant→sortant | Métier |
| `docs/PRESENTATION_COMPLETE_SOLIDATA.md` | Présentation complète de l'application | Direction |
| `docs/PRESENTATION_TECHNIQUE_SOLIDATA.md` | Présentation technique détaillée | Technique |
| `docs/PRESENTATION_CONSEIL_ADMINISTRATION.md` | Présentation pour le CA | Direction |
| `docs/FORMATION_CHAUFFEURS.md` | Formation chauffeurs-collecteurs (langage simplifié) | Formation |
| `docs/FORMATION_MANAGER_COLLECTE_LOGISTIQUE.md` | Formation manager collecte & logistique | Formation |
| `docs/FORMATION_MANAGER_CHAINE_TRI.md` | Formation manager chaîne de tri (pas-à-pas) | Formation |
| `docs/FORMATION_MANAGER_RH_INSERTION.md` | Formation manager RH & insertion | Formation |
| `docs/PROPOSITIONS_AMELIORATION.md` | Propositions d'amélioration UX/accessibilité | Évolution |
| `rapports/rapport-quotidien-*.md` | Rapports quotidiens automatisés (branches, sécurité, tests personas) | Ops/QA |

---

## 12. HISTORIQUE DE CONSTRUCTION

| Date | Version | Changements |
|------|---------|-------------|
| 8 mars 2026 | 1.0.0 | Version initiale — 15 modules, 37 tables, 22 routes, 28 pages web, 11 pages mobile |
| 10-15 mars 2026 | 1.1.0 | Module logistique exutoires complet (7 pages, 6 routes API, 4 tables) |
| 16-18 mars 2026 | 1.1.x | Corrections UX, Tailwind mobile, dépannage SSL, tests déploiement |
| 19 mars 2026 | 1.2.0 | Fix moteur PCM (immeuble base fondation, Q7→stress, exports PDF A4), documentation exhaustive |
| 24 mars 2026 | 1.2.1 | Documentation complète : schémas visuels, 3 présentations, 4 supports de formation par profil, propositions d'amélioration |
| 25-29 mars 2026 | 1.3.0 | Module Finance (7 pages, Pennylane sync), SolidataBot IA (chat Claude), maintenance véhicules avancée, IA prédictive collecte + insertion, dashboard amélioré, pointage, auth mobile simplifiée, 29 commits, +12 497 lignes |
| 30 mars 2026 | 1.3.1 | AdminCAV enrichi (fiche détaillée, photo, carte GPS, planches QR), QR codes CAV (génération, planches PDF, import 209 CAV), plan entretien constructeur IA, mobile sans auth (flux véhicule→tournée simplifié), 19 commits. Audit sécurité : 3 injections SQL identifiées, 31 bugs recensés (7 critiques). 7 branches obsolètes identifiées pour nettoyage |
| 31 mars 2026 | 1.3.2 | Algorithme tournée v2 (OSRM + pause déjeuner + GPS), système suivi logs admin, script QR codes manquants, fix driver_id→driver_employee_id, 5 commits. Audit complet : 19 vulnérabilités sécurité (5 critiques), 25 bugs personas (4 critiques). Note globale 6.7/10 |
| 2 avril 2026 | 1.3.2 | Revue de projet : 7 branches obsolètes (toutes intégrées dans main), audit sécurité (7.5/10), audit npm (7 vuln dont 4 HAUTE), tests 4 personas (18 bugs dont 3 BLOQUANTS : mismatch Socket.IO GPS, Production KPI noms champs, ProduitsFinis noms champs). Note globale 6.8/10. 184 commits |
| 3 avril 2026 | 1.3.2 | Audit quotidien : repo propre (1 branche, 7 obsolètes nettoyées), audit sécurité (18 vuln dont 3 critiques : injection shell admin-db, mots de passe par défaut), tests 4 personas élargi (43 bugs dont 6 BLOQUANTS : Socket.IO GPS, ProduitsFinis champs, Production KPI, TourSummary structure, Expeditions champs). 4 bugs bloquants récurrents non corrigés. Note globale 6.5/10. 180 commits |
| 4 avril 2026 | 1.3.2 | Audit quotidien : 7 branches obsolètes re-détectées (toutes anciennes versions de main, à supprimer). Audit sécurité (6.8/10) : 3 critiques (injection shell admin-db, 2 injections SQL), 7 vuln npm (5 HIGH). Tests 4 personas : 14 bugs dont 4 BLOQUANTS récurrents (Socket.IO GPS mismatch, ProduitsFinis champs x2). Aucune correction depuis 02/04. 179 commits |

---

## 13. CHECKLIST AVANT COMMIT

Avant de pousser du code :
1. Le code respecte les patterns existants (routes, pages, middleware)
2. Les nouvelles tables utilisent `CREATE TABLE IF NOT EXISTS`
3. Les routes sensibles ont `authenticate` + `authorize`
4. Les requêtes SQL sont paramétrisées ($1, $2...)
5. L'interface est en français
6. Le build Docker fonctionne (`docker compose build`)
7. Pas de secrets dans le code (utiliser .env)
8. La documentation est mise à jour si nouveau module

---

*Ce fichier est maintenu à jour à chaque évolution majeure du projet.*
*Pour contribuer : consulter DOCUMENTATION_TECHNIQUE.md pour le détail complet.*

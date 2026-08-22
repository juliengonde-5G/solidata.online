# SOLIDATA ERP — Instructions pour Agents IA

> **Ce fichier est le contexte de référence pour tout agent IA (Claude, Copilot, etc.) travaillant sur le projet SOLIDATA.**
> Il est lu automatiquement par Claude Code au démarrage de chaque session — il reste donc volontairement court.
> Dernière mise à jour : 22 août 2026

**Où trouver le reste :**

| Besoin | Où |
|--------|-----|
| Les 33 modules (routes API ↔ pages ↔ périmètre) | skill `modules-solidata` (chargé à la demande) |
| Arborescence du dépôt | `ls` / `find` |
| Liste des documents | `ls docs/` |
| Historique des versions | `git log --oneline` |
| Feuille de route produit | `docs/ROADMAP.md` |
| Détail fonctionnel d'un module | `docs/DOCUMENTATION_APPLICATIVE.md` |
| Architecture technique complète | `DOCUMENTATION_TECHNIQUE.md` |

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

## 4. BASE DE DONNÉES (80+ tables)

### Tables principales par domaine

**Auth** : users, refresh_tokens, settings, message_templates
**Recrutement** : candidates, candidate_history, candidate_skills, skill_keywords, recruitment_interviews, mise_en_situation, recruitment_documents, recruitment_plan
**PCM** : pcm_sessions, pcm_answers, pcm_reports
**RH** : teams, employees, positions, employee_contracts (2.20.0 : historique complet des avenants Malibou — `malibou_contract_id`+`avenant_date` clé d'upsert, périodes effectives chaînées, `origin` avenant, `position_title`, `weekly_schedule` JSONB), employee_availability, schedule, work_hours, **employee_week_hours** (2.20.0 : heures HEBDO ISO de l'export paie — granularité source, jamais réparties sur des jours), **employee_leaves** (2.20.0 : congés/absences paie par période, catégorisés holiday/sick/absence), **formation_actions** (RSEI-12 : plan de formation besoins→planifié→réalisé, non nominatif — que des compteurs de participants)
**Insertion** : insertion_diagnostics, insertion_milestones, insertion_milestones_history, cip_action_plans, insertion_interview_alerts, insertion_objectifs, insertion_partenaires, insertion_pmsmp, insertion_satisfaction_sortie, insertion_alert_acks, insertion_competence_referentiels, insertion_competence_evaluations, insertion_competence_scores, insertion_checklist_embauche
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
**QHSE** : qhse_events (+ colonnes REX `analyse_causes`/`action_corrective`/`efficacite_verifiee_le`/`efficacite_constat` — RSEI-07), qhse_habilitations, qhse_epi_dotations, **qhse_documents** (RSEI-06 : registre DUERP/plan de prévention/RPS, pièce jointe pattern Refashion, trace consultation IRP/CSE, échéance de révision ; setting `qhse.revision_alerte_jours` défaut 60 j)
**IA/ML** : ml_fill_predictions, ml_model_metadata, collection_context, evenements_locaux, collection_learning_feedback
**Grille tarifaire** : grille_tarifaire
**RGPD** : rgpd_registre, rgpd_consents, rgpd_audit_log
**Objectifs** : periodic_objectives
**Finance** : financial_exercises, financial_periods, financial_entries, pennylane_config, pennylane_sync_log
**Notifications** : notification_triggers
**Historique** : historique_mensuel
**Boutiques** : boutiques, boutique_import_batches, boutique_ventes, boutique_tickets, boutique_commandes, boutique_commande_lignes, boutique_commande_historique, boutique_objectifs, boutique_meteo_quotidien
**Vente au Kilo (VAK)** : vaks (2.21.3 : `compte_caisse` — filtre de périmètre par caisse, liste d'alias), vak_import_batches, vak_tickets (2.21.3 : `compte` — colonne « Compte » du rapport CSV ou `username` API), vak_ventes, vak_meteo_quotidien, vak_sumup_sync_log (clés SumUp OAuth/refresh stockées chiffrées dans `settings` : `sumup.client_id`, `sumup.client_secret`, `sumup.access_token`, `sumup.refresh_token`, `sumup.token_expires_at`, `sumup.merchant_code`, `sumup.webhook_secret`, `sumup.connected_at`)
**RSE (label RSEi)** : rsei_criteres, rsei_actions, rsei_preuves, rsei_evaluations, rsei_evaluation_items, rsei_parties_prenantes, rsei_interactions (27 critères RSEi-2026 seedés avec niveaux NULL = non coté ; agrégats non nominatifs ; setting `rse.alerte_fraicheur_jours` défaut 90 j)
**Énergie & GES (RSEI-11)** : energie_sites, energie_compteurs, energie_releves, carburant_pleins, ges_facteurs (6 facteurs ADEME indicatifs seedés, paramétrables ; settings `energie.ca_reference_*`, `energie.derive_seuil_pct` défaut 20 %)
**Enquêtes (RSEI-13)** : enquete_modeles, enquete_questions, enquete_campagnes (token public), enquete_reponses (anonymes, aucune FK identité ; restitution seuil n≥5)
**Achats responsables (RSEI-17)** : achats_fournisseurs (4 statuts local/inclusif/rse/labellisé), achats_criteres (par famille, seed 8), achats_fds (registre FDS, upload ; setting `achats.fds_fraicheur_jours` défaut 365 j)
**Badgeuse (Temps & Présence)** : badgeuse_sites, badgeuse_devices (clé API stockée en hash SHA-256, heartbeat_info JSONB), badgeuse_badges (`uid_hmac` HMAC-SHA256 UNIQUE — jamais d'UID en clair, index partiel un seul badge actif/salarié), badgeuse_badge_historique, badgeuse_pointages (uuid idempotent UNIQUE, chaîne d'intégrité hash_precedent/hash_courant par device, statut brut/traite/orphelin, JAMAIS modifiés ni supprimés hors purge RGPD), badgeuse_corrections (additives, motif liste fermée), badgeuse_feuilles_temps (`UNIQUE(employee_id, periode)`, circuit brouillon→validee_encadrant→validee_rh), badgeuse_contenus (playlist d'affichage, aucune FK employé) ; règles de gestion et rétentions dans `settings` clés `badgeuse.*` (défauts = recommandations RH, ADR-0002) ; clés HMAC de site chiffrées AES-256-GCM dans `settings`
**Effectifs ETP** : etp_asp_mensuel (validation ASP mensuelle, `UNIQUE(annee, mois)`, NUMERIC(6,2), horodatée `valide_le` + `saisi_par`, journalisée `rgpd_audit_log` — aucun seed) ; paramètres de convention en `settings` clé `effectifs.convention_<annee>` (JSON { etp_conventionnes, etp_cdi_inclusion, heures_annuelles_etp, date_debut, date_fin }, repli lecture `insertion.cible_etp_conventionnes`)

---

## 5. CONVENTIONS DE CODE

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
- **Auth chauffeur (« 1 URL = 1 véhicule »)** :
  - Chaque véhicule a un `qr_token` unique (hex 32 char, espace 2¹²⁸) stocké dans `vehicles.qr_token`
  - URL d'accès = `https://m.solidata.online/v/<qr_token>` (env `MOBILE_BASE_URL`)
  - Le manager paramètre l'URL **une fois** sur le téléphone du chauffeur au dépôt (pairing D3, en personne) → chauffeur ajoute le raccourci à l'écran d'accueil → toute ouverture re-authentifie automatiquement
  - Route mobile : `/v/:token` (`VehicleLogin.jsx`) → POST `/api/auth/driver-start { vehicle_token }` → JWT + redirect `/checklist`
  - Cleanup : `history.replaceState(null, '', '/')` immédiatement après auth pour retirer le token de la barre d'adresse
  - Révocation : ADMIN appelle `POST /api/vehicles/:id/regenerate-token` → ancien raccourci renvoie 401 dès le prochain tap
  - Le `qr_token` est strippé des routes GET `/api/vehicles` et `/api/vehicles/:id` ; exposé uniquement via `GET /api/vehicles/:id/access-info` (ADMIN)
  - Nginx redact `/v/<hex32>` → `/v/REDACTED` dans les access logs (`deploy/nginx/nginx.conf`)
  - Plus de page de sélection véhicule publique (l'ancienne `Login.jsx` est devenue une landing « pas d'accès » sans énumération)
  - **Le jeton chauffeur EST l'identité de la session** : il porte `vehicle_id` + `employee_id` (chauffeur affecté, souvent null) en plus de `username = driver_<vehicleId>` ; le véhicule se lit via `routes/tours/driver-session.js` (`driverVehicleIdFromToken`)
  - **Périmètre véhicule sur tout le parcours** : `GET /tours/my` ne renvoie que le véhicule du lien (l'écran `/vehicle-select` est une confirmation de départ, jamais une liste du parc) ; `POST /tours/claim-vehicle` et `PUT /tours/:id/claim` refusent (403) un autre véhicule
  - **Aucune fiche employé n'est requise pour partir en tournée** : le chauffeur est résolu en cascade (jeton → compte utilisateur → `vehicles.assigned_driver_id`) et reste `null` s'il est inconnu — `tours.driver_employee_id` est nullable par conception

---

## 6. REGLES DE DEVELOPPEMENT

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
- **Smoke tests API** : `node scripts/tests/api-smoke.js` — couvre ~40 endpoints critiques (dashboard, production, reporting, RH, finance, boutiques, référentiels) + auth + sécurité. **Hooké automatiquement dans `deploy.sh update` étape 7/7** : un 5xx sur un endpoint critique fait `error` et arrête le déploiement (recommande `git reset --hard HEAD~1 && bash deploy/scripts/deploy.sh update` pour rollback). Variables requises dans `.env` serveur : `API_USER` + `API_PASSWORD` (compte ADMIN existant).
- Backend Jest : `cd backend && npx jest` (180 tests, ~13% coverage)
- Mobile Vitest : `cd mobile && npm test` (39 tests)
- AI agent pytest : `cd ai-agent && pytest tests/` (13 tests)
- Pas de tests frontend (75 pages React sans coverage — chantier T1.5 de l'audit)

---

## 7. CONTEXTE METIER (Solidarité Textiles)

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
| **LogicS** | Logiciel de caisse des boutiques — export CSV quotidien des ventes |
| **RESP_BTQ** | Responsable Boutique — 6ème rôle, gère les ventes et commandes de sa boutique |
| **Panier moyen** | CA TTC / nombre de tickets — indicateur clé retail |
| **IPT** | Indice Panier Ticket — articles vendus / nombre de tickets (items per transaction) |
| **Num_Ticket** | Vrai numéro de ticket LogicS (nouveau format CSV, 11 colonnes, depuis 21/04/2026) |
| **Minute key** | Clé de reconstitution ticket (YYYY-MM-DD HH:MM) — fallback pour l'ancien format CSV à 10 colonnes |

### Parties prenantes externes
- **Refashion** : éco-organisme, subventions trimestrielles
- **Métropole Rouen** : reporting territorial
- **Brevo** (ex-Sendinblue) : envoi SMS/email
- **Scaleway** : hébergement serveur
- **Let's Encrypt** : certificats SSL

---

## 8. HISTORIQUE DE CONSTRUCTION

L'historique des versions vit dans git, pas ici :

```bash
git log --oneline          # les commits de version portent le titre « vX.Y.Z — … »
git show <tag|sha>         # détail d'une version
```

Les rapports de chantier détaillés sont dans `rapports/`.

---

## 9. CHECKLIST AVANT COMMIT

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

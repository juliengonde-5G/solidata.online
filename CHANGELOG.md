# SOLIDATA — Historique des versions

---

## v1.3.3 — 11 avril 2026

### Stock Original
- Module AdminStockOriginal : journal grand livre, régularisations, modifications avec audit trail, verrouillage trimestriel Refashion
- Module InventaireOriginal : historique mouvements, pesée manuelle (mode net ou brut-tare), inventaire permanent graphique
- Route API `/api/stock-original` (11 endpoints)
- Tables : stock_original_movements, stock_period_locks, stock_original_audit

### Mobile — Corrections
- Navigation incidents : retour vers la carte après signalement
- Erreurs API silencieuses : affichage des messages d'erreur à l'utilisateur
- Checklist : ajout champ observations libres

### Documentation
- docs/LOGIQUE_TOURNEES.md : logique complète du module collecte/tournées
- docs/LOGIQUE_STOCK_INVENTAIRES.md : logique des deux modules de stock
- docs/VARIABLES_APPLICATION.md : toutes les variables d'environnement

---

## v1.3.2 — 30-31 mars 2026 → 6-7 avril 2026

### Algorithme tournée v2
- Intégration OSRM (distances réelles par route, TSP optimisé)
- Pause déjeuner automatique (après 4h de travail)
- Apprentissage des temps de collecte par CAV (table cav_collection_times)
- Retours intermédiaires au centre (toutes les 2t)

### Suivi logs admin
- Système complet de suivi : activité, connexions, sessions, SolidataBot
- Page AdminDB enrichie

### QR codes CAV
- Script generate-qr-sheets.js : planches A7 (74×105mm) ou A8 (52×74mm) sur A4
- Script generate-missing-qr.js : génération des QR manquants
- Import 209 CAV depuis Liste PAV.xlsx avec métadonnées complètes
- Fix driver_id → driver_employee_id (cohérence schéma)

---

## v1.3.1 — 30 mars 2026

### AdminCAV enrichi
- Fiche détaillée par CAV : photo, carte GPS, historique collectes
- Planches QR codes PDF (A7/A8) téléchargeables depuis l'interface
- Association multi-CAV par PAV, gestion PAV inactives

### Import CAV
- Import KML enrichi (gestion encodage, doublons, multi-CAV par PAV)
- Actualisation depuis Liste PAV.xlsx avec métadonnées

---

## v1.3.0 — 25-29 mars 2026

### Finance (7 pages)
- P&L analytique avec catégories Pennylane
- Bilan, trésorerie, contrôle de gestion, rentabilité matière
- Synchronisation Pennylane (Grand Livre, balances, factures)

### SolidataBot IA
- Agent conversationnel basé sur Claude API (Anthropic)
- Contexte ERP complet, analyse insertion et prédictif
- Conteneur Python Flask (ai-agent/)

### IA Prédictive collecte v2
- Corrections ML : individu CAV (60%), saisonnier (25%), zone (15%)
- Confiance bayésienne, export training data (XGBoost/scikit)
- Synthèse et recommandations via Claude API

### IA Insertion
- Moteur continu : alertes freins périphériques, recommandations PCM
- Jalons M1/M6/M12 automatiques

### Maintenance véhicules avancée
- Plan entretien constructeur généré par IA
- Alertes km/date, contrôle technique, vidange, pneus, freins

### Pointage
- Module de gestion des pointages employés
- Route API et page dédiées

### Mobile
- Auth silencieuse (sans redirection bloquante)
- Navigation simplifiée flux véhicule→tournée

---

## v1.2.1 — 19-24 mars 2026

### PCM — Corrections moteur
- Fix type Immeuble (base/fondation)
- Question 7 → indicateur de stress
- Exports PDF A4 (résultats + rapport complet)

### Documentation exhaustive
- Schémas visuels chaîne de tri et flux matières
- 3 présentations (complète, technique, CA)
- 4 supports de formation par profil (chauffeurs, managers, RH)
- Propositions d'amélioration UX/accessibilité

---

## v1.2.0 — 13 mars 2026

### Fil d'actualite & Veille enrichi
- 3 fils d'actualite avec 2 articles par fil (Filiere & Reglementation, ESS & Insertion, Innovation & Recyclage)
- Lien "Lire l'article complet" sur chaque actualite
- Fil LinkedIn recyclage textile (8 profils/pages : Refashion, Le Relais, Emmaus, ADEME, Renaissance Textile...)

### Parcours Insertion renforce
- Correction routes insertion (prefix /api, ordre des routes)
- Debug logging pour le listing employes insertion
- Detection dynamique des tables insertion

### Corrections logistique & collecte
- Auto-creation des tables manquantes au demarrage
- Trust proxy active pour les headers X-Forwarded

### Presentation
- Page `/presentation-solidata.html` avec les 8 modules detailles (12 slides)

---

## v1.1.0 — 9 mars 2026

### Modules majeurs
- Scheduler automatique (CRON 7h/12h/18h) : veille, RH, insertion, vehicules
- Jalons ASP insertion (M+1, M+3, M+6, M+10, Sortie) avec conformite DIRECCTE
- Capteurs IoT CAV (preparation sondes ultrasons LoRaWAN)
- Maintenance preventive vehicules (Ducato / Master eTech)
- Inventaire physique (batch partiel/complet, ecarts)
- Moteur IA insertion continu (alertes freins, recommandations PCM)

### Securite & audit
- Audit complet pre-production : corrections critiques
- AES-256 pour rapports PCM, rate limiting, Helmet, RBAC 5 roles
- Conformite RGPD (page dediee)

### Reporting & donnees
- Reporting Metropole de Rouen (tonnages, CO2, captation)
- Import donnees historiques Dashboard 2025/2026
- Import CAV 2025/2026 depuis KML + Excel
- Calibration moteur predictif sur donnees reelles

---

## v1.0.0 — 8 mars 2026

### Fondation complete
- **Infrastructure** : Docker Compose + Nginx reverse proxy + Certbot SSL
- **Backend** : Node.js + Express, 27 modules API REST, PostgreSQL + PostGIS
- **Frontend** : React 18 + Vite + TailwindCSS, 35 pages
- **Mobile** : PWA chauffeur terrain (11 pages)

### Modules fonctionnels
- Recrutement : Kanban drag-and-drop, parsing CV, test PCM 6 types, Explorama
- Employes & RH : fiches, contrats, equipes, postes, objectifs periodiques
- Collecte & Logistique IA : prediction remplissage, optimisation TSP+2-opt, meteo
- CAV & Stock : carte PostGIS, QR codes, stock temps reel
- Flotte vehicules : profils Ducato/Master eTech, alertes maintenance
- Reporting : tonnages, CO2, taux captation, conformite Refashion/ASP
- Notifications : SMS + email via Brevo API
- Fil d'actualite : veille sectorielle automatisee

### Deploiement
- Scripts deploiement Scaleway (init-server.sh, deploy.sh)
- Gestion SSL automatique (Let's Encrypt)
- Seeds donnees metier (CAV, production, tonnages)

---

## v0.1.0 — Prototype initial (archive)

- Stack initiale : FastAPI (Python) + SQLite + React single-file
- Module candidatures + analyse PCM basique
- Deploiement Synology NAS (migré depuis vers VPS Scaleway)
- *Cette version a ete entierement remplacee par la v1.0.0*

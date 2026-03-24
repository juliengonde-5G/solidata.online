# SOLIDATA — Historique des versions

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

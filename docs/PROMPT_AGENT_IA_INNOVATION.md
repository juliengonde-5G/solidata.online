# Prompts Agent IA — Innovation & Développement SOLIDATA

> Ce document contient les instructions prêtes à copier-coller dans Perplexity, Claude ou tout autre agent IA pour alimenter la réflexion sur l'évolution de SOLIDATA.

---

## 1. PROMPT PERPLEXITY — Agent de veille innovation

**À coller dans les instructions personnalisées de Perplexity (Settings → Profile → AI Profile) :**

```
Je travaille sur SOLIDATA, un ERP open-source pour une structure d'insertion par l'activité économique (SIAE) spécialisée dans la collecte, le tri et la valorisation de textiles usagés en Normandie (Rouen, France).

CONTEXTE TECHNIQUE :
- Stack : Node.js 20, Express, PostgreSQL 15 + PostGIS, Redis, React 18, Docker, Nginx
- Mobile : PWA React avec scan QR, GPS temps réel (Socket.IO), retour haptique
- IA : moteur prédictif de remplissage de conteneurs (ML), optimisation de tournées de collecte
- 70+ tables PostgreSQL, 36 API REST, 44 pages web, 11 écrans mobile
- Modules : recrutement (Kanban, test PCM personnalité), RH (contrats insertion CDDI, parcours avec jalons M1/M6/M12), collecte (CAV géolocalisés, QR codes, GPS), tri (2 chaînes, batch tracking, code-barres), stock, expéditions vers exutoires, facturation, reporting Refashion (éco-organisme REP textile), RGPD

CONTEXTE MÉTIER :
- Solidarité Textiles est une SIAE : elle emploie des personnes éloignées de l'emploi pour collecter, trier et valoriser des textiles usagés
- Filière REP textile : réglementation via l'éco-organisme Refashion (reporting DPAV trimestriel obligatoire)
- Chaîne de valeur : collecte → réception → tri qualité → produits finis (réemploi, recyclage, CSR, effilochage, VAK export) → expédition vers exutoires
- 37 exutoires (recycleurs, fripiers, export)
- Centre de tri à Rouen, zone industrielle

MES BESOINS DE RECHERCHE :
Quand je te pose une question, recherche les innovations, tendances, technologies et bonnes pratiques applicables à ce contexte spécifique. Priorise :
1. Les solutions open-source et abordables (budget SIAE limité)
2. Les innovations dans la filière textile circulaire et l'économie sociale et solidaire (ESS)
3. Les technologies IoT, IA et data pour la gestion de déchets/collecte
4. Les évolutions réglementaires REP textile en France et en Europe
5. Les retours d'expérience d'autres SIAE ou structures similaires
6. Les subventions et financements disponibles (Refashion, ADEME, France 2030, FSE)

Donne-moi toujours des sources vérifiables et des liens.
```

---

## 2. PROMPT PERPLEXITY — Recherches thématiques suggérées

Voici des requêtes prêtes à lancer dans Perplexity pour alimenter l'innovation :

### IoT & Capteurs
```
Quels capteurs IoT LoRaWAN sont utilisés en 2025-2026 pour mesurer le taux de remplissage de conteneurs de collecte textile en France ? Quels fabricants, quel coût, quelle intégration API possible ?
```

### IA & Optimisation
```
Quelles sont les meilleures approches open-source pour l'optimisation de tournées de collecte de déchets avec contraintes temps réel (météo, trafic, remplissage prédictif) ? Comparer VROOM, OR-Tools, OptaPlanner.
```

### Computer Vision
```
Quels modèles de computer vision open-source peuvent classifier automatiquement des textiles usagés sur un tapis de tri ? YOLO, CLIP, modèles spécialisés textile ? Quel matériel caméra nécessaire ?
```

### Réglementation REP
```
Quelles sont les évolutions réglementaires REP textile en France pour 2025-2027 ? Nouveaux objectifs Refashion, évolution des taux de subvention, obligations de traçabilité, impacts pour les opérateurs de tri ?
```

### Insertion & IA sociale
```
Quels outils IA existent pour accompagner les parcours d'insertion professionnelle en SIAE ? Prédiction de freins périphériques, recommandation d'actions, matching emploi-compétences ?
```

### Économie circulaire textile
```
Quelles innovations technologiques émergent dans le recyclage textile en 2025-2026 ? Recyclage fibre à fibre, recyclage chimique, upcycling industriel, traçabilité blockchain textile ?
```

### Financement
```
Quels financements sont disponibles en 2026 pour la digitalisation d'une SIAE du textile en France ? France 2030, FSE+, ADEME, Refashion, BPI, appels à projets économie circulaire ?
```

---

## 3. PROMPT CLAUDE — Agent de développement produit

**À utiliser dans une conversation Claude dédiée à la roadmap produit :**

```
Tu es un chef de produit senior spécialisé dans les ERP métier pour l'économie sociale et solidaire. Tu m'aides à définir la roadmap de SOLIDATA, un ERP pour une SIAE textile.

SOLIDATA aujourd'hui couvre :
- Recrutement (Kanban + test personnalité PCM 6 types)
- RH (contrats insertion, parcours M1/M6/M12, radar 7 freins, planification)
- Collecte textile (CAV géolocalisés, tournées optimisées IA, GPS temps réel, QR codes)
- Tri & Production (2 chaînes, batch tracking, code-barres, KPIs productivité)
- Stock & Expéditions (17 catégories, 37 exutoires)
- Logistique exutoires (commandes, préparation, pesée, facturation, Gantt)
- Reporting (collecte, production, RH, Refashion DPAV)
- RGPD, maintenance véhicules, capteurs IoT (préparé)

Stack : Node.js, React, PostgreSQL+PostGIS, Redis, Docker, PWA mobile

Pour chaque idée que je propose ou que tu suggères, structure ta réponse ainsi :
1. **Valeur métier** : quel problème ça résout pour Solidarité Textiles
2. **Effort technique** : complexité d'implémentation (S/M/L/XL)
3. **Dépendances** : quels modules existants sont impactés
4. **Architecture** : comment l'intégrer dans le code existant (tables, routes, pages)
5. **Risques** : ce qui peut mal tourner
6. **Priorisation** : suggestion de priorité (P1 critique, P2 important, P3 nice-to-have)
```

---

## 4. PROMPT CLAUDE — Agent technique architecture

**Pour les sessions Claude Code de développement :**

```
Tu travailles sur SOLIDATA, un ERP Node.js/React/PostgreSQL pour une SIAE textile. Consulte CLAUDE.md à la racine du projet pour le contexte complet.

Règles :
1. Suis les patterns existants (routes Express dans backend/src/routes/, pages React dans frontend/src/pages/)
2. Nouvelles tables dans init-db.js avec CREATE TABLE IF NOT EXISTS
3. Routes protégées avec authenticate + authorize
4. SQL paramétrisé ($1, $2...), jamais de concaténation
5. Interface en français
6. Pas de nouvelle dépendance npm sauf nécessité absolue
7. Documente les changements dans DOCUMENTATION_TECHNIQUE.md

Avant toute modification :
- Lis les fichiers concernés
- Comprends le code existant
- Propose un plan avant d'implémenter
```

---

## 5. IDÉES À EXPLORER (backlog innovation)

### Priorité haute (P1)
- [ ] Capteurs IoT LoRaWAN réels sur les CAV → feed `cav_sensor_readings` → améliorer prédictions ML
- [ ] Export Refashion automatisé (PDF/Excel conformes au format officiel)
- [ ] Notifications push mobile (alertes maintenance, tournée assignée)
- [ ] Offline-first mobile (IndexedDB pour les zones sans réseau)

### Priorité moyenne (P2)
- [ ] Dashboard temps réel (KPIs live via Socket.IO)
- [ ] Optimisation tournées avec OR-Tools ou VROOM (VRP solver)
- [ ] OCR factures fournisseurs (tesseract.js déjà disponible)
- [ ] Module formation (suivi heures de formation par salarié en insertion)
- [ ] Intégration comptable (export FEC pour logiciel compta)
- [ ] QR code dynamique CAV (mise à jour statut en scannant)

### Priorité basse (P3) — Vision
- [ ] Computer vision tri textile (classification automatique)
- [ ] Chatbot accompagnement insertion (basé sur profil PCM + parcours)
- [ ] Marketplace inter-SIAE (échange de lots textiles)
- [ ] Traçabilité blockchain fibre textile
- [ ] Multi-site (plusieurs centres, reporting consolidé)
- [ ] API publique partenaires (exutoires, collectivités)
- [ ] Module RSE / bilan carbone automatisé
- [ ] Connexion directe API Refashion (quand disponible)

---

*Document maintenu à jour avec chaque évolution du projet. Dernière mise à jour : 19 mars 2026.*

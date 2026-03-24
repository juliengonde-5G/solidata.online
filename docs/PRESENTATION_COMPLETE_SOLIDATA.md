# SOLIDATA — Présentation Complète

> **L'ERP de l'Économie Circulaire Textile**
> Solidarité Textiles — Structure d'Insertion par l'Activité Économique
> Rouen, Normandie — Mars 2026

---

## Slide 1 — Page de Titre

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║                        SOLIDATA                               ║
║                                                               ║
║           L'ERP de l'Économie Circulaire Textile              ║
║                                                               ║
║        ─────────────────────────────────────                  ║
║                                                               ║
║           Solidarité Textiles                                 ║
║           Structure d'Insertion par l'Activité Économique     ║
║           Rouen, Normandie                                    ║
║                                                               ║
║           https://solidata.online                             ║
║           https://m.solidata.online                           ║
║                                                               ║
║                        Mars 2026                              ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## Slide 2 — Sommaire

1. Qui sommes-nous ?
2. Le défi
3. La solution SOLIDATA
4. Les 21 modules fonctionnels
5. Architecture technique
6. Application mobile
7. Intelligence artificielle
8. La chaîne de tri
9. Le flux complet
10. Bénéfices
11. Feuille de route
12. Contact

---

## Slide 3 — Qui Sommes-Nous ?

### Solidarité Textiles

- **Structure d'Insertion par l'Activité Économique (SIAE)**
- Spécialisée dans la **collecte, le tri et la valorisation de textiles usagés**
- Basée à **Rouen, Normandie** — Centre de tri : 49.4231°N, 1.0993°E
- **Double mission** :
  - Insertion professionnelle de personnes éloignées de l'emploi
  - Économie circulaire textile (réemploi, recyclage, valorisation)

### Chiffres clés

| Indicateur | Valeur |
|-----------|--------|
| Conteneurs de collecte (CAV) | ~30 en Normandie |
| Chaînes de tri | 2 parallèles (Qualité + Recyclage) |
| Postes de travail | 9 |
| Produits finis référencés | 114 |
| Clients exutoires | 37 destinations |
| Collaborateurs en insertion | CDDI (max 24 mois) |

> *Notes présentateur : Insister sur la double mission sociale et environnementale. Solidarité Textiles est agréée SIAE et participe à la filière REP textile via l'éco-organisme Refashion.*

---

## Slide 4 — Le Défi

### Pourquoi un ERP sur mesure ?

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│   VOLUME          │   │   TRAÇABILITÉ     │   │   INSERTION       │
│   CROISSANT       │   │   EXIGÉE          │   │   COMPLEXE        │
│                   │   │                   │   │                   │
│  Tonnages en      │   │  Refashion, RGPD, │   │  Parcours indiv., │
│  augmentation     │   │  collectivités    │   │  7 freins, jalons  │
│  30 CAV à gérer   │   │  traçabilité kg   │   │  M1/M6/M12        │
└──────────────────┘   └──────────────────┘   └──────────────────┘

┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│   LOGISTIQUE      │   │   REPORTING       │   │   MULTI-PROFILS   │
│   COMPLEXE        │   │   OBLIGATOIRE     │   │                   │
│                   │   │                   │   │                   │
│  37 exutoires,    │   │  DPAV trimestriel │   │  Chauffeurs,      │
│  8 statuts commde │   │  Métropole Rouen  │   │  trieurs, RH,     │
│  3 quais          │   │  KPI production   │   │  managers, admin   │
└──────────────────┘   └──────────────────┘   └──────────────────┘
```

**Aucun ERP du marché ne couvre cette combinaison unique de besoins.**

> *Notes présentateur : Aucun ERP généraliste ne gère à la fois l'insertion CDDI, le tri textile, la prédiction IA de remplissage, et la logistique exutoires. D'où le choix d'un développement sur mesure.*

---

## Slide 5 — La Solution SOLIDATA

### Un ERP web + mobile couvrant 100% de l'activité

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║   Collecte → Tri → Production → Stock → Exutoires → Facturation          ║
║       ↕           ↕                           ↕                           ║
║   Recrutement   Insertion CDDI         Reporting / Subventions            ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

- **21 modules fonctionnels** intégrés
- **Application web** : https://solidata.online (44 pages)
- **Application mobile** : https://m.solidata.online (11 pages, PWA)
- **Intelligence artificielle** : prédiction remplissage, optimisation tournées
- **Temps réel** : GPS, WebSocket, alertes instantanées
- **Sécurité** : JWT, RBAC 5 rôles, RGPD intégré

> *Notes présentateur : Démontrer que tout est intégré — de la candidature d'un salarié en insertion jusqu'à la facture envoyée au client exutoire. Zéro saisie en double.*

---

## Slide 6 — Les 21 Modules — Pilier Social

### Recrutement, RH & Insertion

| Module | Fonctionnalités clés |
|--------|---------------------|
| **Recrutement** | Kanban 4 colonnes, CV parsing, entretiens structurés, mise en situation |
| **PCM** | Test personnalité 20 questions, 6 types, profil stress, export PDF |
| **Gestion RH** | Collaborateurs, contrats (CDI/CDD/CDDI), équipes |
| **Heures & Planning** | Saisie heures, planning hebdo 4 filières |
| **Compétences** | Matrice employés × compétences, niveaux |
| **Insertion** | Parcours CDDI avec jalons M1/M6/M12, radar 7 freins, plans CIP |

### Le Parcours d'Insertion

```
Recrutement → Diagnostic → Jalon M1 → Jalon M6 → Jalon M12 → Sortie
   (Kanban)     (7 freins)   (1 mois)   (6 mois)   (12 mois)   dynamique
```

**7 freins périphériques suivis** : Logement, Mobilité, Santé, Administratif, Financier, Famille, Justice

> *Notes présentateur : Le PCM permet d'adapter la communication avec chaque salarié en insertion. Le radar des 7 freins est un outil unique qui va bien au-delà du suivi emploi classique.*

---

## Slide 7 — Les 21 Modules — Pilier Opérationnel

### Collecte, Tri, Production, Stock

| Module | Fonctionnalités clés |
|--------|---------------------|
| **Collecte** | ~30 CAV géolocalisés, 3 modes de tournée (IA/standard/manuel), GPS temps réel |
| **Tri** | 2 chaînes parallèles, 9 postes, suivi lot par opération |
| **Production** | KPI quotidiens (effectif, tonnage, productivité/personne) |
| **Stock** | Mouvements entrée/sortie, traçabilité code-barres |
| **Produits Finis** | 114 références × catégorie × genre × saison × gamme |
| **Expéditions** | Envois vers 37 exutoires, bons de livraison |

### La Chaîne de Valeur

```
CAV → Pesée → Stock MP → Chaîne Qualité (5 ops) → 114 Produits Finis → Exutoires
                         → Chaîne Recyclage (1 op) → CSR / Effilochage / Chiffons
```

> *Notes présentateur : Chaque kg est tracé de la collecte à la facturation finale. Le suivi par lot (LOT-xxxxx) permet de remonter à la tournée d'origine.*

---

## Slide 8 — Les 21 Modules — Pilier Logistique Avancé

### Logistique Exutoires (7 écrans dédiés)

```
Commande → Confirmée → Préparation → Prête → Chargement → Expédiée → Pesée → Facturée → Clôturée
```

| Écran | Fonction |
|-------|----------|
| **Commandes** | Cycle de vie 8 statuts, filtrage, suivi |
| **Clients** | 37 clients (recycleurs, négociants, industriels) |
| **Grille Tarifaire** | Prix/tonne par produit, trimestre, année |
| **Préparation** | Planning chargement, affectation collaborateurs |
| **Gantt** | Vue visuelle 3 emplacements (Quai, Garage, Cours) |
| **Facturation** | OCR PDF, rapprochement auto, HT/TVA/TTC |
| **Calendrier** | Vue mensuelle de toutes les expéditions |

**Contrôle pesée** : écart ≤2% = OK, 2-5% = warning, >5% = alerte

> *Notes présentateur : Le module exutoires est le plus complexe — il couvre tout le cycle de vie d'une vente de produits triés, du devis à la facture en passant par la logistique physique.*

---

## Slide 9 — Les 21 Modules — Pilier Pilotage

### Reporting, Conformité & Administration

| Module | Fonctionnalités clés |
|--------|---------------------|
| **Reporting Collecte** | Tonnage, tours, taux remplissage CAV |
| **Reporting Production** | Productivité, tonnage trié, taux CSR |
| **Reporting RH** | Effectif, heures, compétences |
| **Refashion** | DPAV trimestriel automatisé (éco-organisme REP textile) |
| **Reporting Métropole** | Export données pour Métropole de Rouen |
| **RGPD** | Registre traitements, consentements, audit log, anonymisation |
| **Administration** | Utilisateurs, véhicules, configuration, référentiels, BDD |
| **IA Prédictive** | Facteurs saisonniers, météo, événements, feedback loop |
| **Fil d'actualités** | Communication interne, articles catégorisés |

> *Notes présentateur : Le reporting Refashion automatise les déclarations DPAV trimestrielles qui sont obligatoires dans la filière REP textile.*

---

## Slide 10 — Architecture Technique

```
╔═══════════════════════════════════════════════════════════════╗
║                    Scaleway DEV1-S                             ║
║              2 vCPU · 2 Go RAM · 20 Go SSD                    ║
║                                                               ║
║  Internet ──▶ Nginx SSL (:443)                                ║
║                  ├── solidata.online → React (Frontend Web)   ║
║                  ├── m.solidata.online → React (Mobile PWA)   ║
║                  ├── /api/* → Node.js/Express (Backend API)   ║
║                  ├── /socket.io/* → Socket.IO (Temps réel)    ║
║                  └── /uploads/* → Fichiers                    ║
║                         │                                     ║
║                    ┌────┴────┐                                ║
║                    │         │                                ║
║              PostgreSQL    Redis                              ║
║              + PostGIS      Cache                             ║
╚═══════════════════════════════════════════════════════════════╝
```

| Composant | Technologie |
|-----------|-------------|
| Frontend | React 18, Vite, Tailwind CSS |
| Mobile | PWA React, html5-qrcode |
| Backend | Node.js 20, Express 4.21 |
| Base de données | PostgreSQL 15 + PostGIS (85+ tables) |
| Cache | Redis 7 |
| Temps réel | Socket.IO 4.8 |
| Conteneurisation | Docker Compose (7 services) |
| Sécurité | JWT, bcrypt, AES-256, RBAC 5 rôles |

> *Notes présentateur : L'infrastructure est légère (~15€/mois) mais robuste. 7 conteneurs Docker avec limites mémoire. Déploiement automatisé en une commande.*

---

## Slide 11 — Application Mobile (PWA Chauffeurs)

### Parcours Chauffeur-Collecteur

```
Connexion → Véhicule → Checklist → Carte/GPS → QR Scan → Niveau → Pesée → Incidents → Retour
```

| Étape | Description |
|-------|-------------|
| **Véhicule** | Sélectionner le véhicule du jour |
| **Checklist** | Inspection véhicule (pneus, freins, phares...) |
| **Carte GPS** | Itinéraire avec CAV à collecter, navigation |
| **QR Scan** | Scanner le QR code sur chaque CAV |
| **Niveau** | Indiquer le remplissage (0 à 5) |
| **Pesée** | Enregistrer le poids collecté |
| **Incidents** | Signaler un problème (CAV cassé, panne...) |
| **Retour** | Résumé de la journée, validation |

**Caractéristiques** :
- PWA installable (pas de store)
- Feedback haptique (vibrations)
- GPS temps réel toutes les 10s
- Fonctionne sur tous les smartphones

> *Notes présentateur : L'app mobile est conçue pour les chauffeurs avec une interface simplifiée. Gros boutons, codes couleur, feedback vibration.*

---

## Slide 12 — Intelligence Artificielle

### IA au Service de l'Efficacité

```
┌──────────────────────────────────────────────────┐
│              MOTEUR PRÉDICTIF IA                  │
│                                                    │
│  Entrées :                    Sorties :            │
│  ┌─────────────────┐         ┌─────────────────┐  │
│  │ Historique       │         │ Prédiction       │  │
│  │ tonnage CAV      │ ──────▶│ remplissage      │  │
│  │                  │         │ par CAV           │  │
│  │ Facteurs         │         │                   │  │
│  │ saisonniers      │ ──────▶│ Tournées          │  │
│  │                  │         │ optimisées        │  │
│  │ Météo locale     │         │                   │  │
│  │                  │ ──────▶│ Date prochaine    │  │
│  │ Événements       │         │ collecte          │  │
│  │ locaux           │         │                   │  │
│  └─────────────────┘         └─────────────────┘  │
│                                                    │
│         ┌──── Feedback Loop ────┐                  │
│         │ Prévu vs Observé      │                  │
│         │ → Amélioration        │                  │
│         │   continue            │                  │
│         └───────────────────────┘                  │
└──────────────────────────────────────────────────┘
```

**3 modes de création de tournée** :
1. **Intelligent (IA)** : Le système propose les CAV à collecter en priorité
2. **Standard** : Itinéraires prédéfinis optimisés
3. **Manuel** : Sélection libre sur la carte

> *Notes présentateur : L'IA apprend en continu grâce au feedback des chauffeurs. Les prédictions s'améliorent avec le temps.*

---

## Slide 13 — La Chaîne de Tri

```
         CHAÎNE QUALITÉ (5 opérations)
         ═══════════════════════════════

Stock MP ──▶ Crackage 1 ──▶ Crackage 2 ──▶ Recyclage ──▶ Réutilisation ──▶ Triage Fin
              [Crack 1]      [Crack 2]      [R1 + R2]      [Reu]            [×2 postes]
                 │               │              │              │                 │
                 ▼               ▼              ▼              ▼                 ▼
              Chaussures     Produits     Balles CSR      Hommes          114 PRODUITS
              Jouets         finis        Effilochage     Femmes          FINIS
              Accessoires    CSR          Chiffons        Layette
              CSR


         CHAÎNE RECYCLAGE EXCLUSIF (1 opération)
         ═════════════════════════════════════════

Stock MP ──▶ Recyclage [R3 + R4] ──▶ CSR / Effilochage / Chiffons
```

**9 postes de travail** | **17 catégories de sortie** | **114 produits finis**

> *Notes présentateur : Les 2 chaînes opèrent en parallèle. La Qualité produit des articles réutilisables (boutique, export). Le Recyclage Exclusif produit uniquement des matières recyclables.*

---

## Slide 14 — Le Flux Complet

```
Collecte → Pesée → Stock → TRI → Produits Finis → Colisage → Préparation → Chargement
   30 CAV    entrée   MP    2 chaînes  114 PF       Balles     Planning       Gantt
   GPS/QR                                            Sacs       3 quais

→ Expédition → Pesée Client → Facturation → Clôture
   37 clients   ≤2%: OK        OCR PDF       Archivage
                2-5%: Warning   HT/TVA/TTC    Reporting
                >5%: Alerte                    Refashion
```

**Traçabilité kg par kg** de la collecte à la facturation

> *Notes présentateur : Démontrer la traçabilité complète. Chaque kg collecté peut être retracé jusqu'au produit fini expédié au client.*

---

## Slide 15 — Bénéfices

| Domaine | Avant SOLIDATA | Avec SOLIDATA |
|---------|---------------|---------------|
| **Tournées** | Planification manuelle | IA optimise les parcours |
| **Traçabilité** | Fichiers Excel dispersés | Suivi lot bout-en-bout |
| **Reporting** | Saisie manuelle, retards | Automatisé, temps réel |
| **Insertion** | Suivi papier | Radar 7 freins, alertes |
| **Logistique** | Planning sur tableau blanc | Gantt numérique, conflits détectés |
| **Facturation** | Rapprochement manuel | OCR + concordance auto |
| **Communication** | Téléphone, papier | GPS temps réel, notifications |
| **Conformité** | Fichiers à reconstituer | DPAV Refashion automatisé |

---

## Slide 16 — Feuille de Route 2026-2027

### Court terme (Q2 2026)
- Capteurs IoT LoRaWAN sur les CAV (mesure de remplissage automatique)
- Maintenance prédictive véhicules
- OCR factures fournisseurs automatisé
- Contrôle pesée double (entrée + sortie)

### Moyen terme (Q3-Q4 2026)
- Modèle ML avancé de prédiction remplissage
- PWA offline-first complète (IndexedDB)
- Dashboard temps réel (Socket.IO)
- Notifications push mobile

### Long terme (2027+)
- Multi-site (plusieurs centres de tri)
- API ouverte pour partenaires
- Computer vision pour tri automatique
- Blockchain traçabilité textile
- Chatbot IA d'accompagnement insertion

---

## Slide 17 — Contact

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║                        SOLIDATA                               ║
║                                                               ║
║           Web : https://solidata.online                       ║
║           Mobile : https://m.solidata.online                  ║
║                                                               ║
║           Solidarité Textiles                                 ║
║           Rouen, Normandie                                    ║
║                                                               ║
║           Code source : github.com/juliengonde-5G/            ║
║                         solidata.online                       ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

---

*Présentation générée le 24 mars 2026 — SOLIDATA ERP v1.2.1*

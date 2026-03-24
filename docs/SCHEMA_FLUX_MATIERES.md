# Schéma Visuel — Flux Matières Entrant → Sortant

> **Version** : 1.2.1 | **Date** : 24 mars 2026
> **Organisation** : Solidarité Textiles — Rouen, Normandie

---

## 1. Vue Simplifiée (Vue d'oiseau)

```
╔═══════════════════════════════════════════════════════════════════════════════════════════╗
║                    SOLIDARITÉ TEXTILES — FLUX MATIÈRES SIMPLIFIÉ                         ║
╠═══════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                           ║
║    🏠 COLLECTE        ⚖️ PESÉE         📦 STOCK         ✂️ TRI          📋 PRODUITS      ║
║                                                                                           ║
║   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐           ║
║   │  30 CAV  │───▶│  Pesée   │───▶│ Matières │───▶│ 2 chaînes│───▶│   114    │           ║
║   │ conteneurs│    │  entrée  │    │premières │    │ de tri   │    │ produits │           ║
║   │ Normandie│    │  camion  │    │ textiles │    │ qualité  │    │  finis   │           ║
║   └──────────┘    └──────────┘    └──────────┘    │ recyclage│    └────┬─────┘           ║
║                                                    └──────────┘         │                  ║
║                                                                         ▼                  ║
║    📊 FACTURATION    ⚖️ PESÉE CLIENT  🚛 EXPÉDITION   📦 COLISAGE   📋 PRÉPARATION     ║
║                                                                                           ║
║   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐           ║
║   │ Facture  │◀───│ Contrôle │◀───│  Départ  │◀───│ Balles / │◀───│ Planning │           ║
║   │ HT/TVA   │    │  pesée   │    │  camion  │    │ Sacs /   │    │  Gantt   │           ║
║   │ TTC      │    │ ≤2%: OK  │    │ exutoire │    │ Cartons  │    │ 3 quais  │           ║
║   └──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘           ║
║                                                                                           ║
║                         ▼                                                                  ║
║                  ┌──────────────┐                                                          ║
║                  │   CLÔTURE    │  Archivage complet avec traçabilité                      ║
║                  │   37 clients │  Reporting Refashion / Métropole                         ║
║                  └──────────────┘                                                          ║
╚═══════════════════════════════════════════════════════════════════════════════════════════╝
```

---

## 2. Flux Détaillé — 12 Étapes

```
╔═══════════════════════════════════════════════════════════════════════════════════════════════╗
║                            FLUX COMPLET — 12 ÉTAPES DÉTAILLÉES                                ║
╠═══════════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                               ║
║  ÉTAPE 1 ─── COLLECTE                                                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  ║
║  │  📍 ~30 CAV (Conteneurs d'Apport Volontaire) en Normandie                               │  ║
║  │  🚛 Tournées optimisées par IA (intelligent / standard / manuel)                         │  ║
║  │  📱 Application mobile PWA pour chauffeurs                                               │  ║
║  │  📡 GPS temps réel (Socket.IO, mise à jour toutes les 10s)                               │  ║
║  │  📷 Scan QR code sur chaque CAV                                                          │  ║
║  │  📊 Niveau de remplissage : 0 (vide) → 5 (plein)                                        │  ║
║  │                                                                                           │  ║
║  │  Données capturées : QR code CAV, niveau remplissage, photo, GPS, heure                  │  ║
║  │  Code traçabilité : scan QR (cav_qr_scans)                                               │  ║
║  └─────────────────────────────────────────────────────────────────────────────────────────┘  ║
║                                           │                                                   ║
║                                           ▼                                                   ║
║  ÉTAPE 2 ─── RÉCEPTION & PESÉE ENTRÉE                                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  ║
║  │  ⚖️  Pesée du camion à l'arrivée au centre de tri                                       │  ║
║  │  📝 Enregistrement : stock_movements (type: ENTREE)                                     │  ║
║  │  🏷️  Ticket code-barres généré (SaisiesT = Saisies Tonnage)                              │  ║
║  │  📊 Calcul poids net = poids brut - tare véhicule                                       │  ║
║  │                                                                                           │  ║
║  │  Données capturées : poids brut, tare, poids net, tournée source, date/heure             │  ║
║  │  Code traçabilité : ticket code-barres (stock_movements.id)                              │  ║
║  │  Point de contrôle poids : ⚖️ PESÉE #1 (entrée)                                         │  ║
║  └─────────────────────────────────────────────────────────────────────────────────────────┘  ║
║                                           │                                                   ║
║                                           ▼                                                   ║
║  ÉTAPE 3 ─── STOCK MATIÈRES PREMIÈRES                                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  ║
║  │  📦 Stockage par catégorie de matière (matieres)                                         │  ║
║  │  🏷️  Création de lot : LOT-xxxxx (batch_tracking)                                        │  ║
║  │  📊 Suivi quantité disponible par catégorie                                              │  ║
║  │  🔗 Lien avec la tournée d'origine                                                       │  ║
║  │                                                                                           │  ║
║  │  Données capturées : catégorie, poids, lot, provenance (tournée), date stockage          │  ║
║  │  Code traçabilité : LOT-xxxxx (batch_tracking)                                           │  ║
║  └─────────────────────────────────────────────────────────────────────────────────────────┘  ║
║                                           │                                                   ║
║                              ┌────────────┴────────────┐                                      ║
║                              ▼                         ▼                                      ║
║  ÉTAPE 4 ─── TRANSFORMATION (TRI)                                                             ║
║  ┌──────────────────────────────┐  ┌──────────────────────────────┐                           ║
║  │    CHAÎNE QUALITÉ            │  │    CHAÎNE RECYCLAGE          │                           ║
║  │    5 opérations              │  │    1 opération                │                           ║
║  │                              │  │                              │                           ║
║  │  OP.1 Crackage 1 [Crack 1]  │  │  Recyclage [R3 + R4]        │                           ║
║  │        ↓                     │  │                              │                           ║
║  │  OP.2 Crackage 2 [Crack 2]  │  │  Sorties :                  │                           ║
║  │        ↓                     │  │  ▶ Balles CSR               │                           ║
║  │  OP.3 Recyclage  [R1 + R2]  │  │  ▶ Effilochage Jean         │                           ║
║  │        ↓                     │  │  ▶ Effilochage Blanc/Couleur│                           ║
║  │  OP.4 Réutilisation [Reu]   │  │  ▶ Chiffons Blanc/Couleur   │                           ║
║  │        ↓                     │  │                              │                           ║
║  │  OP.5 Triage fin  [×2]      │  │                              │                           ║
║  │        ↓                     │  │                              │                           ║
║  │  ══▶ 114 produits finis      │  │                              │                           ║
║  └──────────────────────────────┘  └──────────────────────────────┘                           ║
║                                                                                               ║
║  Données capturées par opération : lot, poids entrant, poids sortant, perte, opérateur       ║
║  Code traçabilité : operation_executions (lot_id + operation_id)                              ║
║  Point de contrôle poids : ⚖️ PESÉE par opération (poids_initial → poids_sortie)             ║
║                              ┌────────────┬────────────┐                                      ║
║                              ▼                         ▼                                      ║
║  ÉTAPE 5 ─── PRODUITS FINIS                                                                   ║
║  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  ║
║  │  📋 Stock PF (SaisiesP) : 114 produits × variantes                                      │  ║
║  │  🏷️  Code-barres par article (produits_finis)                                             │  ║
║  │  📊 Classement : catégorie éco-org × genre × saison × gamme (BTQ/VAK/CHIF/Pvak)         │  ║
║  │                                                                                           │  ║
║  │  Données capturées : produit, poids, catégorie, lot source, date production              │  ║
║  │  Code traçabilité : produit_fini.code                                                    │  ║
║  └─────────────────────────────────────────────────────────────────────────────────────────┘  ║
║                                           │                                                   ║
║                                           ▼                                                   ║
║  ÉTAPE 6 ─── COLISAGE                                                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  ║
║  │  📦 Regroupement en unités d'expédition (balles, sacs, cartons)                          │  ║
║  │  🏷️  Code par colis : COL-xxxxx (colisages)                                               │  ║
║  │  ⚖️  Pesée par unité de colisage                                                         │  ║
║  │  📊 Statut : ouvert → scellé → expédié → livré                                          │  ║
║  │                                                                                           │  ║
║  │  Données capturées : code colis, contenu (items), poids total, destination              │  ║
║  │  Code traçabilité : COL-xxxxx (colisages + colisage_items)                               │  ║
║  │  Point de contrôle poids : ⚖️ PESÉE #2 (colisage)                                       │  ║
║  └─────────────────────────────────────────────────────────────────────────────────────────┘  ║
║                                           │                                                   ║
║                                           ▼                                                   ║
║  ÉTAPE 7 ─── PRÉPARATION EXPÉDITION                                                          ║
║  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  ║
║  │  📅 Planification de la date de chargement                                               │  ║
║  │  👥 Affectation des collaborateurs au chargement                                         │  ║
║  │  🏗️  Choix du lieu : Quai | Garage Remorque | Cours                                      │  ║
║  │  ⚠️  Détection automatique des conflits d'occupation                                     │  ║
║  │                                                                                           │  ║
║  │  Données capturées : commande, transporteur, lieu, date, heure, collaborateurs           │  ║
║  │  Code traçabilité : preparations_expedition.id                                           │  ║
║  └─────────────────────────────────────────────────────────────────────────────────────────┘  ║
║                                           │                                                   ║
║                                           ▼                                                   ║
║  ÉTAPE 8 ─── CHARGEMENT                                                                      ║
║  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  ║
║  │  🏗️  3 emplacements physiques :                                                          │  ║
║  │      ┌──────────┐  ┌──────────────────┐  ┌──────────┐                                   │  ║
║  │      │   QUAI   │  │ GARAGE REMORQUE  │  │  COURS   │                                   │  ║
║  │      └──────────┘  └──────────────────┘  └──────────┘                                   │  ║
║  │  📊 Planning Gantt visuel pour gestion de l'occupation                                   │  ║
║  │  ⚖️  Pesée de contrôle au chargement                                                     │  ║
║  │                                                                                           │  ║
║  │  Données capturées : heure début/fin, poids chargé, lieu, statut                        │  ║
║  │  Point de contrôle poids : ⚖️ PESÉE #3 (chargement départ)                              │  ║
║  └─────────────────────────────────────────────────────────────────────────────────────────┘  ║
║                                           │                                                   ║
║                                           ▼                                                   ║
║  ÉTAPE 9 ─── EXPÉDITION                                                                      ║
║  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  ║
║  │  🚛 Départ du camion vers l'exutoire (client destinataire)                               │  ║
║  │  📝 Bon de livraison / Ordre de transport                                                │  ║
║  │  📊 Statut commande : en_cours → expédiée                                                │  ║
║  │                                                                                           │  ║
║  │  Données capturées : date départ, transporteur, destination, tonnage déclaré             │  ║
║  │  Code traçabilité : expeditions.id + commandes_exutoires.id                              │  ║
║  └─────────────────────────────────────────────────────────────────────────────────────────┘  ║
║                                           │                                                   ║
║                                           ▼                                                   ║
║  ÉTAPE 10 ─── PESÉE CLIENT (Contrôle)                                                        ║
║  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  ║
║  │  ⚖️  Le client pèse la marchandise à réception                                           │  ║
║  │  📊 Comparaison poids départ vs poids arrivée :                                          │  ║
║  │                                                                                           │  ║
║  │      ┌──────────────────────────────────────────────────┐                                │  ║
║  │      │  Écart ≤ 2%     →  ✅ Validé automatiquement     │                                │  ║
║  │      │  Écart 2% - 5%  →  ⚠️  Avertissement             │                                │  ║
║  │      │  Écart > 5%     →  🔴 Alerte, investigation      │                                │  ║
║  │      └──────────────────────────────────────────────────┘                                │  ║
║  │                                                                                           │  ║
║  │  Données capturées : poids client, écart %, ticket pesée, observations                  │  ║
║  │  Code traçabilité : controles_pesee.id                                                   │  ║
║  │  Point de contrôle poids : ⚖️ PESÉE #4 (arrivée client)                                 │  ║
║  └─────────────────────────────────────────────────────────────────────────────────────────┘  ║
║                                           │                                                   ║
║                                           ▼                                                   ║
║  ÉTAPE 11 ─── FACTURATION                                                                     ║
║  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  ║
║  │  📄 OCR : lecture automatique des factures PDF du client (Tesseract.js)                  │  ║
║  │  🔗 Rapprochement automatique facture ↔ commande                                         │  ║
║  │  💰 Génération facture : HT + TVA → TTC                                                  │  ║
║  │  📊 Vérification montant attendu vs montant facturé                                      │  ║
║  │                                                                                           │  ║
║  │  Données capturées : montant HT/TVA/TTC, numéro facture, statut concordance             │  ║
║  │  Code traçabilité : factures_exutoires.id → commandes_exutoires.id                       │  ║
║  └─────────────────────────────────────────────────────────────────────────────────────────┘  ║
║                                           │                                                   ║
║                                           ▼                                                   ║
║  ÉTAPE 12 ─── CLÔTURE & ARCHIVAGE                                                            ║
║  ┌─────────────────────────────────────────────────────────────────────────────────────────┐  ║
║  │  ✅ Archivage complet de la commande avec traçabilité bout-en-bout                       │  ║
║  │  📊 Contribution au reporting :                                                           │  ║
║  │      ▶ Refashion (DPAV trimestriel — éco-organisme REP textile)                         │  ║
║  │      ▶ Métropole de Rouen (reporting territorial)                                        │  ║
║  │      ▶ KPI internes (tonnage, CA, productivité)                                          │  ║
║  │  📊 Statut commande : facturée → clôturée                                                │  ║
║  └─────────────────────────────────────────────────────────────────────────────────────────┘  ║
╚═══════════════════════════════════════════════════════════════════════════════════════════════╝
```

---

## 3. Points de Contrôle Poids (4 pesées)

```
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║                     CHAÎNE DE PESÉE — 4 POINTS DE CONTRÔLE                           ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║  ⚖️ #1               ⚖️ #2              ⚖️ #3              ⚖️ #4                     ║
║  PESÉE ENTRÉE        PESÉE COLISAGE     PESÉE CHARGEMENT   PESÉE CLIENT              ║
║                                                                                       ║
║  ┌──────────┐       ┌──────────┐       ┌──────────┐       ┌──────────┐              ║
║  │ Camion   │  ───▶ │ Balle /  │  ───▶ │ Camion   │  ───▶ │ Client   │              ║
║  │ arrivée  │       │ Colis    │       │ départ   │       │ arrivée  │              ║
║  │ centre   │       │ scellé   │       │ exutoire │       │ exutoire │              ║
║  └──────────┘       └──────────┘       └──────────┘       └──────────┘              ║
║                                                                                       ║
║  Poids net =        Poids unitaire     Poids total        Poids réception            ║
║  brut - tare        par colis          chargement         chez le client              ║
║                                                                                       ║
║  ────────────────── RÉCONCILIATION ──────────────────                                 ║
║                                                                                       ║
║  #1 vs #2 : Vérification perte tri (tolérance : 5% max)                              ║
║  #3 vs #4 : Vérification transport (tolérance : ≤2% OK, 2-5% warning, >5% alerte)   ║
║  #1 vs #4 : Traçabilité complète entrée → sortie                                     ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝
```

---

## 4. Codes de Traçabilité

| Étape | Type de code | Format | Exemple | Table BDD |
|-------|-------------|--------|---------|-----------|
| Collecte | QR code CAV | QR physique | CAV-ROUEN-017 | cav_qr_scans |
| Réception | Ticket pesée | Auto-incrémenté | SM-2026-0154 | stock_movements |
| Stock MP | Code lot | LOT-xxxxx | LOT-00312 | batch_tracking |
| Tri | Exécution opération | Auto-incrémenté | OE-2026-0891 | operation_executions |
| Produits finis | Code produit | Catégorie-ref | PF-VAK-H-ETE-042 | produits_finis |
| Colisage | Code colis | COL-xxxxx | COL-00156 | colisages |
| Préparation | ID préparation | Auto-incrémenté | PREP-2026-0078 | preparations_expedition |
| Expédition | ID expédition | Auto-incrémenté | EXP-2026-0045 | expeditions |
| Pesée client | ID contrôle | Auto-incrémenté | CP-2026-0032 | controles_pesee |
| Facture | Numéro facture | FE-AAAA-XXXX | FE-2026-0019 | factures_exutoires |
| Commande | ID commande | CMD-xxxxx | CMD-00089 | commandes_exutoires |

---

## 5. Les 37 Exutoires (Destinations)

| Type | Exemples | Produits acceptés |
|------|----------|-------------------|
| **Recycleurs** | Gebetex, Ecotri | Balles recyclage, effilochage, chiffons |
| **Négociants export** | Alunited, Eurofrip, Limbotex | VAK (Vêtements Articles Kilogrammes) |
| **Boutiques solidaires** | Boutiques internes | BTQ (réemploi local) |
| **Industriels** | So TOWT | CSR (valorisation énergétique) |
| **Effilocheurs** | Spécialisés | Balles effilochage (jean, blanc, couleur) |

---

## 6. Flux de Données Parallèle

```
╔═══════════════════════════════════════════════════════════════════════════╗
║              FLUX DE DONNÉES À CHAQUE ÉTAPE                              ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                           ║
║  Matière ──▶  Collecte  ──▶  Stock  ──▶  Tri  ──▶  PF  ──▶  Expédition ║
║               │              │           │         │         │            ║
║  Données ──▶  GPS, QR,      Poids,      Lot,      Code,     Bon de      ║
║               niveau,        catégorie,  opé.,     poids,    livraison,  ║
║               photo,         lot         perte,    catég.    facture     ║
║               heure                      KPI                             ║
║               │              │           │         │         │            ║
║  Reporting ▶  Tournées      Stock       Prod.     Refashion  CA          ║
║               Collecte      réconcil.   KPI       DPAV       Exutoires  ║
║               IA prédictif               Tri                  Métropole  ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

---

## 7. Cycle de Vie d'une Commande Exutoire (8 statuts)

```
┌──────────┐    ┌───────────┐    ┌─────────────┐    ┌──────────┐
│ EN ATTENTE│───▶│ CONFIRMÉE │───▶│EN PRÉPARATION│───▶│  PRÊTE   │
└──────────┘    └───────────┘    └─────────────┘    └──────────┘
                                                         │
    ┌──────────┐    ┌───────────┐    ┌──────────┐       │
    │ CLÔTURÉE │◀───│ FACTURÉE  │◀───│ EXPÉDIÉE │◀──────┘
    └──────────┘    └───────────┘    └──────────┘
                                          │
                                    ┌──────────┐
                                    │  PESÉE   │
                                    │  CLIENT  │
                                    └──────────┘
```

---

## 8. Correspondance SOLIDATA (Écrans par étape)

| Étape | Page SOLIDATA | Menu |
|-------|--------------|------|
| 1. Collecte | Tours.jsx, TourMap.jsx (mobile) | Collecte → Tournées |
| 2. Réception | Stock.jsx | Tri & Production → Stock MP |
| 3. Stock MP | Stock.jsx | Tri & Production → Stock MP |
| 4. Tri | ChaineTri.jsx, Production.jsx | Tri & Production → Chaînes / Production |
| 5. Produits finis | ProduitsFinis.jsx | Tri & Production → Produits finis |
| 6. Colisage | ProduitsFinis.jsx | Tri & Production → Produits finis |
| 7. Préparation | ExutoiresPreparation.jsx | Exutoires → Préparation |
| 8. Chargement | ExutoiresGantt.jsx | Exutoires → Gantt Chargement |
| 9. Expédition | Expeditions.jsx | Tri & Production → Expéditions |
| 10. Pesée client | ExutoiresCommandes.jsx | Exutoires → Commandes |
| 11. Facturation | ExutoiresFacturation.jsx | Exutoires → Facturation |
| 12. Clôture | ExutoiresCommandes.jsx | Exutoires → Commandes |
| Reporting | ReportingCollecte/Production.jsx | Reporting |
| Refashion | Refashion.jsx | Reporting → Refashion |

---

*Document de référence pour la compréhension du flux matières chez Solidarité Textiles.*
*Conforme à l'architecture SOLIDATA ERP v1.2.1.*

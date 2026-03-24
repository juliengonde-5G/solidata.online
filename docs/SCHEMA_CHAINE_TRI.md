# Schéma Visuel — Chaîne de Tri SOLIDATA

> **Version** : 1.2.1 | **Date** : 24 mars 2026
> **Organisation** : Solidarité Textiles — Rouen, Normandie

---

## 1. Vue d'Ensemble Simplifiée

```
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║                        CHAÎNE DE TRI — VUE SIMPLIFIÉE                                ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║   ┌──────────────┐         ┌─────────────────────────────────────────────────────┐    ║
║   │              │         │              CHAÎNE QUALITÉ                         │    ║
║   │   STOCK      │         │                                                     │    ║
║   │   MATIÈRES   │────────▶│  Crackage 1 → Crackage 2 → Recyclage               │    ║
║   │   PREMIÈRES  │         │       ↓            ↓           ↓                    │    ║
║   │              │         │  Chaussures    Produits     Balles CSR               │    ║
║   │  (Textiles   │         │  Jouets        finis        Effilochage              │    ║
║   │   collectés) │         │  Accessoires                Chiffons                │    ║
║   │              │         │                                 ↓                    │    ║
║   │              │         │                          Réutilisation               │    ║
║   │              │         │                                 ↓                    │    ║
║   │              │         │                          Triage Fin                  │    ║
║   │              │         │                                 ↓                    │    ║
║   │              │         │                    ══► 114 PRODUITS FINIS            │    ║
║   │              │         └─────────────────────────────────────────────────────┘    ║
║   │              │                                                                    ║
║   │              │         ┌─────────────────────────────────────────────────────┐    ║
║   │              │────────▶│         CHAÎNE RECYCLAGE EXCLUSIF                   │    ║
║   │              │         │  Recyclage direct → Balles CSR / Effilochage /      │    ║
║   └──────────────┘         │                     Chiffons                        │    ║
║                            └─────────────────────────────────────────────────────┘    ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝
```

---

## 2. Chaîne Qualité — Schéma Détaillé (5 Opérations)

```
╔═══════════════════════════════════════════════════════════════════════════════════════════════════════╗
║                                   CHAÎNE QUALITÉ — FLUX DÉTAILLÉ                                     ║
╠═══════════════════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                                       ║
║  ┌─────────────┐                                                                                      ║
║  │             │     ╔══════════════════════╗                                                          ║
║  │  STOCK MP   │     ║  OP.1 — CRACKAGE 1  ║                                                          ║
║  │  (SaisiesT) │     ║  [Poste: Crack 1]   ║                                                          ║
║  │             │────▶║                      ║                                                          ║
║  │  Pesée      │     ║  Ouverture des sacs  ║──────┬──────▶ Chaussures ──────▶ Stock PF               ║
║  │  entrée     │     ║  Pré-tri grossier    ║      │                                                   ║
║  │             │     ╚══════════════════════╝      ├──────▶ Jouets ──────────▶ Exutoire spécifique     ║
║  └─────────────┘              │                    │                                                   ║
║                               │ Overflow           ├──────▶ Balles CSR ─────▶ Exutoire CSR            ║
║                               ▼                    │                                                   ║
║                      ╔══════════════════════╗      ├──────▶ Accessoires ────▶ OP.5 (Triage fin)       ║
║                      ║  OP.2 — CRACKAGE 2  ║      │                                                   ║
║                      ║  [Poste: Crack 2]   ║      └──────▶ Linge maison ───▶ OP.5 (Triage fin)       ║
║                      ║                      ║                                                          ║
║                      ║  2ème tri textile    ║──────┬──────▶ Produits finis ──▶ Stock PF               ║
║                      ║                      ║      │                                                   ║
║                      ╚══════════════════════╝      └──────▶ Balles CSR ─────▶ Exutoire CSR            ║
║                               │                                                                       ║
║                               │ Textiles restants                                                     ║
║                               ▼                                                                       ║
║  ┌────────────────────────────────────────────────────────────────────────────────────────────────┐   ║
║  │                          OP.3 — RECYCLAGE  [Postes: R1 + R2]                                   │   ║
║  │                                                                                                │   ║
║  │  Tri des textiles non réutilisables directement                                                │   ║
║  │                                                                                                │   ║
║  │  ──▶ Balles CSR (rebut, curons)                    ──▶ Exutoire CSR                            │   ║
║  │  ──▶ Balles Effilochage Jean                       ──▶ Exutoire effilochage                    │   ║
║  │  ──▶ Balles Effilochage (Effilo)                   ──▶ Exutoire effilochage                    │   ║
║  │  ──▶ Chiffons Coton Blanc                          ──▶ Exutoire chiffons                      │   ║
║  │  ──▶ Chiffons Coton Couleur                        ──▶ Exutoire chiffons                      │   ║
║  │  ──▶ Textiles réutilisables                        ──▶ OP.4                                    │   ║
║  └────────────────────────────────────────────────────────────────────────────────────────────────┘   ║
║                               │                                                                       ║
║                               │ Textiles réutilisables                                                ║
║                               ▼                                                                       ║
║  ┌────────────────────────────────────────────────────────────────────────────────────────────────┐   ║
║  │                        OP.4 — RÉUTILISATION  [Poste: Reu]                                      │   ║
║  │                                                                                                │   ║
║  │  Tri par genre et destination                                                                  │   ║
║  │                                                                                                │   ║
║  │  ──▶ Balles CSR (rebut)                            ──▶ Exutoire CSR                            │   ║
║  │  ──▶ Hommes (VAK / Boutique)                       ──▶ OP.5                                    │   ║
║  │  ──▶ Femmes (VAK / Boutique)                       ──▶ OP.5                                    │   ║
║  │  ──▶ Layette / Enfant (VAK / Boutique)             ──▶ OP.5                                    │   ║
║  └────────────────────────────────────────────────────────────────────────────────────────────────┘   ║
║                               │                                                                       ║
║                               │ Par genre + Accessoires + Linge (de OP.2)                             ║
║                               ▼                                                                       ║
║  ┌────────────────────────────────────────────────────────────────────────────────────────────────┐   ║
║  │                    OP.5 — TRIAGE FIN  [2 postes par type]                                      │   ║
║  │                                                                                                │   ║
║  │  Tri final très précis par catégorie, genre, saison, gamme                                     │   ║
║  │                                                                                                │   ║
║  │  Entrées : Hommes + Femmes + Layette (OP.4) + Accessoires + Linge maison (OP.2)               │   ║
║  │                                                                                                │   ║
║  │  ══▶ STOCK PRODUITS FINIS (SaisiesP)                                                           │   ║
║  │      114 produits × Catégorie éco-org × Genre × Saison × Gamme                                │   ║
║  │                                                                                                │   ║
║  │      Gammes :  BTQ (Boutique)  │  VAK (Export)  │  CHIF (Chiffons)  │  Pvak (Vrac export)     │   ║
║  └────────────────────────────────────────────────────────────────────────────────────────────────┘   ║
╚═══════════════════════════════════════════════════════════════════════════════════════════════════════╝
```

---

## 3. Chaîne Recyclage Exclusif — Schéma Détaillé

```
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║                        CHAÎNE RECYCLAGE EXCLUSIF — FLUX DÉTAILLÉ                     ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                       ║
║  ┌─────────────┐      ╔══════════════════════════════╗      ┌──────────────────────┐ ║
║  │             │      ║  OPÉRATION UNIQUE            ║      │  SORTIES :           │ ║
║  │  STOCK MP   │      ║                              ║      │                      │ ║
║  │  (SaisiesT) │─────▶║  Recyclage                   ║─────▶│  ▶ Balle CSR         │ ║
║  │             │      ║  [Postes: R3 + R4]           ║      │  ▶ Effilo. Jean      │ ║
║  │  Textiles   │      ║                              ║      │  ▶ Effilo. Blanc     │ ║
║  │  non triés  │      ║  Tri recyclage direct        ║      │  ▶ Effilo. Couleur   │ ║
║  │  en qualité │      ║  (pas de réutilisation)      ║      │  ▶ Chiffons Blanc    │ ║
║  │             │      ║                              ║      │  ▶ Chiffons Couleur  │ ║
║  └─────────────┘      ╚══════════════════════════════╝      └──────────────────────┘ ║
║                                                                     │                 ║
║                                                                     ▼                 ║
║                                                              ┌──────────────┐         ║
║                                                              │  EXUTOIRES   │         ║
║                                                              │  Recyclage   │         ║
║                                                              └──────────────┘         ║
╚═══════════════════════════════════════════════════════════════════════════════════════╝
```

---

## 4. Les 9 Postes de Travail

| # | Poste | Chaîne | Opération | Description | Sorties principales |
|---|-------|--------|-----------|-------------|-------------------|
| 1 | **Crack 1** | Qualité | OP.1 Crackage 1 | Ouverture des sacs, pré-tri grossier | Chaussures, Jouets, Accessoires, CSR |
| 2 | **Crack 2** | Qualité | OP.2 Crackage 2 | 2ème tri textile, extraction PF | Produits finis, CSR |
| 3 | **R1** | Qualité | OP.3 Recyclage | Tri recyclage (1er poste) | CSR, Effilochage, Chiffons |
| 4 | **R2** | Qualité | OP.3 Recyclage | Tri recyclage (2ème poste) | CSR, Effilochage, Chiffons |
| 5 | **Reu** | Qualité | OP.4 Réutilisation | Tri par genre pour réemploi | Hommes, Femmes, Layette |
| 6 | **Triage Fin 1** | Qualité | OP.5 Triage Fin | Tri final précis (type 1) | 114 produits finis |
| 7 | **Triage Fin 2** | Qualité | OP.5 Triage Fin | Tri final précis (type 2) | 114 produits finis |
| 8 | **R3** | Recyclage Excl. | Op. unique | Recyclage exclusif (1er poste) | CSR, Effilochage, Chiffons |
| 9 | **R4** | Recyclage Excl. | Op. unique | Recyclage exclusif (2ème poste) | CSR, Effilochage, Chiffons |

---

## 5. Catégories de Sorties (17 types)

| # | Catégorie de sortie | Opération(s) source | Destination |
|---|-------------------|-------------------|-------------|
| 1 | Chaussures | OP.1 | Stock PF → Exutoire |
| 2 | Jouets | OP.1 | Exutoire spécifique |
| 3 | Accessoires | OP.1 → OP.5 | Stock PF (après triage fin) |
| 4 | Linge maison | OP.1 → OP.5 | Stock PF (après triage fin) |
| 5 | Balles CSR | OP.1, OP.2, OP.3, OP.4, Recyclage | Exutoire CSR (valorisation énergétique) |
| 6 | Balle Effilochage Jean | OP.3, Recyclage | Exutoire effilochage |
| 7 | Balle Effilochage Blanc | OP.3, Recyclage | Exutoire effilochage |
| 8 | Balle Effilochage Couleur | OP.3, Recyclage | Exutoire effilochage |
| 9 | Chiffons Coton Blanc | OP.3, Recyclage | Exutoire chiffons |
| 10 | Chiffons Coton Couleur | OP.3, Recyclage | Exutoire chiffons |
| 11 | Hommes BTQ | OP.5 | Boutique solidaire |
| 12 | Hommes VAK | OP.5 | Export VAK |
| 13 | Femmes BTQ | OP.5 | Boutique solidaire |
| 14 | Femmes VAK | OP.5 | Export VAK |
| 15 | Layette BTQ | OP.5 | Boutique solidaire |
| 16 | Layette VAK | OP.5 | Export VAK |
| 17 | Produits finis mixtes | OP.2, OP.5 | Selon gamme (BTQ/VAK/CHIF/Pvak) |

---

## 6. Suivi des Lots (Traçabilité)

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                     CYCLE DE VIE D'UN LOT DE TRI                         ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                           ║
║  ┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐    ║
║  │  CRÉATION  │───▶│  EN COURS  │───▶│  TERMINÉ   │───▶│  EXPÉDIÉ   │    ║
║  │  LOT-xxxxx │    │            │    │            │    │            │    ║
║  └────────────┘    └────────────┘    └────────────┘    └────────────┘    ║
║                                                                           ║
║  Code lot : LOT-xxxxx (généré automatiquement)                            ║
║  Lié à : stock_movements (entrée), tour d'origine                         ║
║                                                                           ║
║  À chaque opération :                                                     ║
║  ┌─────────────────────────────────────────────────────┐                  ║
║  │  operation_executions                                │                  ║
║  │  ├── lot_id : LOT-xxxxx                              │                  ║
║  │  ├── operation_id : OP.1 / OP.2 / OP.3 / OP.4 / OP.5│                 ║
║  │  ├── poids_initial : XX kg                           │                  ║
║  │  ├── poids_sortie : YY kg (par catégorie)            │                  ║
║  │  ├── perte : ZZ kg                                   │                  ║
║  │  └── statut : en_attente → en_cours → termine        │                  ║
║  └─────────────────────────────────────────────────────┘                  ║
║                                                                           ║
║  Colisage (conditionnement final) :                                       ║
║  ┌─────────────────────────────────────────────────────┐                  ║
║  │  colisages                                           │                  ║
║  │  ├── code : COL-xxxxx                                │                  ║
║  │  ├── type_contenant : balle / sac / carton           │                  ║
║  │  ├── poids_total : XX kg                             │                  ║
║  │  ├── statut : ouvert → scellé → expédié → livré      │                  ║
║  │  └── colisage_items[] : produit, quantité, poids     │                  ║
║  └─────────────────────────────────────────────────────┘                  ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

---

## 7. KPI par Opération

| KPI | Mesure | Objectif type |
|-----|--------|---------------|
| **Tonnage entrant** | kg/jour entrant dans l'opération | Variable selon stock |
| **Tonnage sortant** | kg/jour sortant (toutes catégories) | ≥ 95% du tonnage entrant |
| **Perte** | kg perdus (entrant - sortant) | ≤ 5% |
| **Productivité/personne** | kg triés / personne / jour | 150-200 kg selon opération |
| **Taux CSR** | % du tonnage en CSR (rebut) | ≤ 30% (objectif qualité) |
| **Effectif** | Nombre de personnes par poste | Selon planning hebdo |

---

## 8. Légende

| Symbole | Signification |
|---------|---------------|
| `[Poste]` | Poste de travail (collaborateur assigné) |
| `Stock MP (SaisiesT)` | Stock matières premières (pesée entrée) |
| `Stock PF (SaisiesP)` | Stock produits finis (pesée sortie) |
| `OP.X` | Opération numéro X de la chaîne |
| `──▶` | Flux de matière |
| `LOT-xxxxx` | Code de lot de traçabilité |
| `COL-xxxxx` | Code de colisage |
| `BTQ` | Gamme Boutique (réemploi local) |
| `VAK` | Gamme export (Vêtements, Articles, Kilogrammes) |
| `CHIF` | Gamme Chiffons (usage industriel) |
| `Pvak` | Gamme Vrac export |
| `CSR` | Combustible Solide de Récupération (valorisation énergétique) |
| `Effilochage` | Recyclage par déchiquetage des fibres |

---

## 9. Correspondance SOLIDATA (Écrans)

| Opération | Page SOLIDATA | Menu |
|-----------|--------------|------|
| Vue chaînes | ChaineTri.jsx | Tri & Production → Chaînes de tri |
| Saisie production | Production.jsx | Tri & Production → Production |
| Stock MP | Stock.jsx | Tri & Production → Stock MP |
| Produits finis | ProduitsFinis.jsx | Tri & Production → Produits finis |
| Expéditions | Expeditions.jsx | Tri & Production → Expéditions |
| Reporting | ReportingProduction.jsx | Reporting → Production |

---

*Document de référence pour la compréhension du processus de tri chez Solidarité Textiles.*
*Schéma conforme à la configuration des chaînes dans SOLIDATA ERP v1.2.1.*

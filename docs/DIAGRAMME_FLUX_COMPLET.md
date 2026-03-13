# Diagramme du Flux Complet — Parcours au sein de la structure

**Projet :** SOLIDATA.online
**Date :** 2026-03-13
**Organisation :** Solidarite Textiles (Structure d'Insertion par l'Activite Economique)

---

## Vue complete : de la collecte a la valorisation

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                        SOLIDARITE TEXTILES — Flux complet                                        │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

 ┌─────────────┐     ┌───────────────┐     ┌──────────────┐     ┌───────────────────────────────────────────────────┐
 │  COLLECTE   │     │  RECEPTION    │     │   STOCK MP   │     │               TRANSFORMATION                     │
 │             │     │  & PESEE      │     │              │     │                                                   │
 │  CAV        │────>│  Pesee        │────>│  Matieres    │────>│  ┌──────────────────────────────────────────────┐ │
 │  (conteneurs│     │  entree       │     │  premieres   │     │  │         CHAINE QUALITE                      │ │
 │  d'apport   │     │  (SaisiesT)   │     │  textiles    │     │  │  OP.1 → OP.2 → OP.3 → OP.4 → OP.5         │ │
 │  volontaire)│     │               │     │              │     │  │  Crackage  Crackage  Recyclage  Reutili-    │ │
 │             │     │  Ticket       │     │  Stockage    │     │  │  1         2         [R1+R2]    sation      │ │
 │  ~30 CAV    │     │  code-barres  │     │  par lots    │     │  │                                Triage fin   │ │
 │  Normandie  │     │               │     │              │     │  └───────────────────────────────┬──────────────┘ │
 │             │     └───────────────┘     │              │     │                                  │               │
 │  Tournees   │                           │  Traçabilite │     │  ┌──────────────────────────────┐│               │
 │  optimisees │                           │  code-barres │     │  │  CHAINE RECYCLAGE EXCLUSIF   ││               │
 │  (IA)       │                           │              │     │  │  [R3 + R4]                   ││               │
 │             │                           │              │     │  └──────────────────────────────┘│               │
 │  GPS temps  │                           │              │     │                                  │               │
 │  reel       │                           │              │────>│  VENTE ORIGINAL (brut, sans tri) │               │
 └─────────────┘                           └──────────────┘     └──────────────────────────────────┼───────────────┘
                                                                                                   │
                           ┌───────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                          SORTIES / PRODUITS                                                    │
 ├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │                                                                                                                │
 │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
 │  │  STOCK PF       │  │  BALLES CSR     │  │  BALLES         │  │  BALLES         │  │  ORIGINAL       │      │
 │  │  (SaisiesP)     │  │  (rebut)        │  │  EFFILOCHAGE    │  │  CHIFFONS       │  │  (brut)         │      │
 │  │                 │  │                 │  │                 │  │                 │  │                 │      │
 │  │  114 produits   │  │  Curons         │  │  Jean           │  │  Coton Blanc    │  │  Vrac ou        │      │
 │  │  finis          │  │                 │  │  Effilo Blanc   │  │  Coton Couleur  │  │  balles         │      │
 │  │  (reutilisation)│  │                 │  │  Effilo Couleur │  │                 │  │                 │      │
 │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘      │
 │           │                    │                    │                    │                    │               │
 └───────────┼────────────────────┼────────────────────┼────────────────────┼────────────────────┼───────────────┘
             │                    │                    │                    │                    │
             ▼                    ▼                    ▼                    ▼                    ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                   PESEE SORTIE (Sortants)                                                      │
 │                          Pesee systematique avant expedition                                                    │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
             │
             ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                              LOGISTIQUE EXUTOIRES (37 destinations)                                            │
 ├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │                                                                                                                │
 │  ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
 │  │  CYCLE DE VIE D'UNE COMMANDE EXUTOIRE                                                                  │   │
 │  │                                                                                                          │   │
 │  │  Commande ──> Preparation ──> Chargement ──> Expedition ──> Pesee client ──> Facturation ──> Cloture    │   │
 │  │  (client,      (transporteur,  (lieu:          (depart       (ticket pesee,   (OCR PDF,       (archivage)│   │
 │  │   types[],      lieu,           quai/garage/    remorque)      ecart ≤2%/      concordance,              │   │
 │  │   prix/t,       collaborateurs, cours)                        5%/>5%)         montant attendu)           │   │
 │  │   tonnage)      date)                                                                                    │   │
 │  └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
 │                                                                                                                │
 │  CLIENTS EXUTOIRES :                                                                                           │
 │  Recycleurs · Negociants · Industriels                                                                         │
 │  (Alunited, Eurofrip, Gebetex, Ecotri, Limbotex, So TOWT...)                                                  │
 │                                                                                                                │
 │  LIEUX DE CHARGEMENT : Quai (x1) · Garage remorque (x1) · Cours (x1)                                         │
 │  Planning Gantt pour gestion de l'occupation                                                                    │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
             │
             ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                        SUIVI & REPORTING                                                       │
 ├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │                                                                                                                │
 │  KPI Production           KPI Logistique             KPI RH                    KPI Collecte                    │
 │  ─────────────            ──────────────             ──────                    ────────────                     │
 │  Tonnage trie/jour        Tonnage sorti/mois         Effectif present          Tonnage collecte               │
 │  Productivite/pers        CA exutoires               Postes couverts           Taux remplissage CAV          │
 │  Taux CSR                 Taux ecart pesee           Heures travaillees        Tournees realisees             │
 │  Sorties par exutoire     Delai moyen commande       Competences               Optimisation IA                │
 │                                                                                                                │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Flux de donnees transversaux

| Flux | Source | Destination | Donnee |
|------|--------|-------------|--------|
| Pesee entree | Collecte | Stock MP | Poids kg, code-barres, lot |
| Affectation tri | Planning RH | Chaine de tri | Collaborateurs, postes |
| Production | Chaine de tri | Stock PF | Produits finis, quantites |
| Destock provisoire | Expedition | Stock | Pesee interne (provisoire) |
| Destock definitif | Pesee client | Stock | Pesee client (definitif) |
| Facturation | OCR facture | Comptabilite | Montant, concordance |

---

## Modules ERP impliques

| Module | Role dans le flux |
|--------|-------------------|
| **Collecte** | Alimentation du stock MP via tournees CAV |
| **Stock** | Tracabilite code-barres, pesees entree/sortie |
| **Production** | Saisie quotidienne, effectifs, chaines de tri |
| **Planning** | Affectation collaborateurs (tri + chargement) |
| **Exutoires** | Gestion commandes, preparation, facturation |
| **RH** | Gestion salaries insertion, competences |
| **Reporting** | Tableaux de bord, KPI, alertes |

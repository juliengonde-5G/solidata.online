# Diagramme de la Chaine de Tri — Vue Horizontale

**Projet :** SOLIDATA.online
**Date :** 2026-03-13

---

## Vue d'ensemble

La chaine de tri transforme la matiere premiere textile collectee en produits finis valorisables.
Deux chaines operent en parallele a partir du stock de matieres premieres.

---

## Chaine Qualite (5 operations)

```
                                                    ┌──────────────┐
                                                ┌──>│  Balle CSR   │
                                                │   └──────────────┘
┌──────────────┐    ┌──────────────────┐        │   ┌──────────────┐
│              │    │   OP.1           │        ├──>│  Jouets      │──> Exutoire specifique
│  STOCK MP    │───>│   Crackage 1     │────────┤   └──────────────┘
│  (SaisiesT)  │    │   [Crack 1]      │        │
│              │    └──────────────────┘        │
└──────────────┘                                └──────────────────────────────────────────────────────────────────────────┐
                                                                                                                          │
                                                    ┌──────────────┐                                                      ▼
                                                ┌──>│ Chaussures   │──> Stock PF (SaisiesP)                  ┌──────────────────┐
                                                │   └──────────────┘                                         │   OP.2           │
                                                │   ┌──────────────┐                                         │   Crackage 2     │
                                                ├──>│  Balle CSR   │                                         │   [Crack 2]      │
                                                │   └──────────────┘                                         └──────────────────┘
                                                │   ┌──────────────┐                                                  │
                                                ├──>│ Accessoires  │──> OP.5                                          │
                                                │   └──────────────┘                                                  │
                                                │   ┌──────────────┐                                                  │
                                                ├──>│Linge maison  │──> OP.5                                          │
                                                │   └──────────────┘                                                  │
                                                └──────────────────────────────────────────────────────────────────────┘
                                                                                                                      │
                                                                                                                      ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                           OP.3 Recyclage  [R1 + R2]                                                    │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                                        │
│  ──> Balle CSR            ──> Balle Effilochage (Jean)           ──> Balle Effilochage (Effilo)                        │
│  ──> Poste Chiffons (Coton Blanc / Coton Couleur)                ──> OP.4 (Textiles reutilisables)                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                      │
                                                      ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                          OP.4 Reutilisation  [Reu]                                                     │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                                        │
│  ──> Balle CSR         ──> OP.5 Hommes (VAK/Btq)        ──> OP.5 Femmes (VAK/Btq)        ──> OP.5 Layette (VAK/Btq)  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                      │
                                                      ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     OP.5 Triage fin  [2 postes par type]                                               │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  Entrees : Hommes + Femmes + Layette (OP.4) + Accessoires + Linge (OP.2)                                              │
│                                                                                                                        │
│  ──> Stock PF (SaisiesP) : 114 produits x Categorie Eco-org x Genre x Saison x Gamme (BTQ/VAK/CHIF/Pvak)              │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

```

---

## Chaine Recyclage Exclusif (1 operation)

```
┌──────────────┐    ┌──────────────────────────┐    ┌───────────────────────────────────┐
│              │    │  Operation unique :       │    │  Sorties :                        │
│  STOCK MP    │───>│  Recyclage                │───>│  ──> Balle CSR                    │
│  (SaisiesT)  │    │  [R3 + R4]               │    │  ──> Balle Effilochage (Jean)     │
│              │    │                          │    │  ──> Balle Effilochage (Effilo)   │
└──────────────┘    └──────────────────────────┘    │  ──> Balle Chiffons Blanc         │
                                                    │  ──> Balle Chiffons Couleur       │
                                                    └───────────────────────────────────┘
```

---

## Poste supplementaire

```
Poste Chiffons : Coton Blanc / Coton Couleur ──> Balles Chiffons ──> Exutoires recyclage
```

---

## Legende

| Symbole | Signification |
|---------|---------------|
| `[Poste]` | Poste de travail (collaborateur assigne) |
| `Stock MP` | Stock matieres premieres (peesee entree = SaisiesT) |
| `Stock PF` | Stock produits finis (pesee sortie = SaisiesP) |
| `Balle CSR` | Combustible Solide de Recuperation (rebut) |
| `OP.N` | Operation numero N de la chaine Qualite |
| `R1-R4` | Postes de recyclage |

---

## Volumes types

| Indicateur | Valeur indicative |
|------------|-------------------|
| Entree ligne (Qualite) | ~2 000 - 4 000 kg/jour |
| Entree R3 (Recyclage) | ~1 000 - 2 000 kg/jour |
| Effectif Qualite | 6-10 operateurs |
| Effectif Recyclage | 2-4 operateurs |
| Produits finis | 114 references |
| Exutoires | 37 destinations |

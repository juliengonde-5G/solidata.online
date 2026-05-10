# Audit QHSE permanent — reproduire Dashboard 2026 dans solidata.online

**Date** : 2026-05-10
**Auditeur** : ingénieur QHSE Solidarité Textiles
**Périmètre** : capacité de `solidata.online` à reproduire les vues du fichier source `Dashboard 2026.xlsm` qui alimentent en permanence les audits Refashion et Métropole de Rouen.
**Objectif** : que QHSE puisse **à tout moment**, sans Excel intermédiaire :
1. Régénérer la DPAV trimestrielle Refashion (sortie + stocks + communes).
2. Recalculer la subvention Refashion mensuelle.
3. Vérifier la cohérence entrées-sorties du tri par filière.
4. Produire le bilan mensuel collecte (tournées + Lions Club).

---

## 1. Synthèse exécutive

| Vue Dashboard 2026 | Reproduction `solidata.online` | Niveau |
|---|---|---|
| `R_Tx` — Tonnages sortants par exutoire (DPAV I–VII) | Partielle, JOIN manuelle | **35 %** |
| `R_P&C` — Production tonnage commune (DPAV CSV Refashion) | Présente (`refashion_communes`) mais non exposée en export auto | **55 %** |
| `R_€` — Calcul subvention Refashion mensuelle | Hardcodée dans `Refashion.jsx`, non vérifiable en base | **40 %** |
| `R_Cohérence` — Balance entrées/sorties tri par filière | Manquante, nécessite refonte | **20 %** |
| `Sortants` — Référentiels exutoires + produits | `exutoires` OK, manque agrément + produits par catégorie | **65 %** |
| `Annuel` — Tonnages mensuels par tournée | Recalculable depuis `tour_weights` | **85 %** |
| `LC` — Collectes Lions Club | Absent, à intégrer comme partenaire externe | **0 %** |

**Score global QHSE** : **41 %**. Le système peut alimenter les audits mais nécessite **5 vues SQL + 2 pages d'export** pour reproduire intégralement le Dashboard 2026.

---

## 2. Inventaire des vues audit du Dashboard 2026.xlsm

### 2.1 Feuille `Annuel` — Tonnages mensuels par tournée

- 30+ tournées listées (Rive Droite 1/2, Rive Gauche Ouest 1/2, Rive Gauche Est 1/2, Bords de Seine, Boos 1/2, Darnetal, Anneville/Ambourville, Barentin 1/2, Yerville, Neufchatel, etc.)
- Colonnes : Janvier → Décembre + Total annuel
- Source : pesées de fin de tournée

**Reproduction solidata** : ✅ requête possible depuis `tours` + `tour_weights` agrégée par mois.

### 2.2 Feuille `Sortants` — Référentiels

Deux listes :
- **Exutoires** (35 entrées) : Agilec, Alunited, Bacer du Pre-Bocage, Carrosserie Rouennaise, Delorge Recycling, Ecotri, Envie Boucle de Seine, Erdotex, Etablissement Brault, Eurofrip, Gaz Service, Limbotex, Liquidation direct, M. Giordani, MecaHP, Nemo Trading, NPC, Ondulyss VPK, Soveo, Textile House, T-Imex, Osselienne de peinture, Rouen Plus, Printemps, So TOWT, Gebetex, HORTIBAT, Tritex, ABS+, Diferbat, APB, Hestia.
- **Produits sortants** (17 catégories) :
  - Chiffons blanc, Chiffons couleur
  - CSR Chaussures, CSR Textiles
  - Destockage Textiles
  - Effilochage Coton, Effilochage Jean, Effilochage Mérinos, Effilochage Tricot
  - Original
  - Pré-classé Chaussures par paire, Pré-classé Linge de maison, Pré-classé Sacs Ceintures, Pré-classé Textiles
  - 2nd choix (VAK) Textiles, 2nd choix (VAK) Chaussures, 2nd choix (VAK) Maroquinerie

**Reproduction solidata** :
- Exutoires : table `exutoires` (35 lignes prévisibles) — **manque agrément Refashion**.
- Produits sortants : table `categories_sortantes` — **liste actuelle ne correspond pas à ces 17 catégories** ; refonte requise.

### 2.3 Feuille `R_Tx` — Déclaration tonnages sortants (DPAV)

Sections numérotées qui correspondent **directement** au formulaire DPAV Refashion :

| Section DPAV | Contenu | Source attendue |
|---|---|---|
| I. Tonnage sortant en **brut** | Par exutoire (Solidarité Textiles internal, Eurofrip, Limbotex, Liquidation direct, Ecotri, Erdotex, Nemo Trading, T-Imex, Gebetex, Tritex…) | `colisages WHERE statut='expedie' GROUP BY exutoire_id` filtré sur produit `Original` |
| II. Tonnage sortant en **écrémé** | idem | Produits Pré-classé |
| III. Tonnage de **crème** issu | idem | Produits 2nd choix (VAK) + Pré-classé qualité supérieure |
| IV. Tonnage **éliminé** issu | Poids | Refus de tri (déchets non valorisables) |
| V. **Retour boutique** | Poids | Réintégration depuis boutiques (invendus) |
| VI. **Upcycling** | Poids | Sorties orientées atelier upcycling |
| VII. **Coupe de chiffon** | Par exutoire | Chiffons blanc + couleur |

Plus :
- **CSV PAV à envoyer** : liste des points d'apport volontaire (CAV) actifs
- **CSV Communes à envoyer** : tonnage par commune
- **Stocks DPAV** (à déclarer en fin de période) :
  - Tonnage stocké brut
  - Tonnage stocké écrémé
  - Tonnage stocké à réemployer
  - …

**Reproduction solidata** : ⚠️ partielle — nécessite création de la **vue `vw_dpav_sortants`** (cf. section 4).

### 2.4 Feuille `R_P&C` — Codes postaux × Communes

200+ lignes (CP, Commune, clé concaténée), dont 76000 Rouen apparaît 16× (1 par CAV), 76520 Boos 4×, etc.

C'est le référentiel utilisé pour générer le **CSV Communes** de la DPAV Refashion.

**Reproduction solidata** : `cav.commune` existe (texte libre), mais **pas le code postal** ni **code INSEE**. Voir l'audit Métropole pour le détail.

### 2.5 Feuille `R_€` — Calcul subvention Refashion

Formule mensuelle (extraits relevés sur 2 mois) :

```
Tonnage trié              : 32 014 kg (jan), 34 446 kg (fév)
Tonnage Non TLC           :  3 830 kg (jan),  2 977 kg (fév)
Taux de Non TLC           :    11,96 %       8,64 %
Tonnage trié origine France soutenu = Tonnage trié − Tonnage Non TLC

Réutilisation             : 10 497 kg (jan), 8 259 kg (fév)
Réutilisation retenu      :  9 241 kg        7 545 kg     (= Réutilisation × (1 − Taux Non TLC))
× 80 €/t                  →    739,29 €       603,62 €

Recyclage                 : 15 332 kg (jan), 13 436 kg (fév)
Recyclage retenu          : 13 497,75 kg     12 274,79 kg
× 295 €/t                 →  3 981,84 €      3 621,06 €

CSR                       :  8 094 kg (jan),  7 821 kg (fév)
CSR retenu                :  7 125,67 kg     7 145,07 kg
× 210 €/t                 →  1 496,39 €      1 500,46 €

TLC Valo énergétique      :  0 kg            0 kg
× 20 €/t                  →  0 €             0 €

Total subvention selon sortant trié : 6 217,52 € (jan), 5 725,15 € (fév)
Total subvention selon entrant trié : 6 178,70 € (jan), 6 648,08 € (fév)
  (= Tonnage trié × 193 €/t entrant)
```

**Taux €/t** utilisés (DPAV 2026) :
- Réutilisation : 80 €/t
- Recyclage : 295 €/t
- CSR : 210 €/t
- Valo énergétique : 20 €/t
- Entrant trié : 193 €/t

Le **dual-calcul** (sortant vs entrant) sert à vérifier la cohérence avant déclaration.

**Reproduction solidata** : ⚠️ les taux sont **codés en dur** dans `frontend/src/pages/Refashion.jsx:35`. Pas de table de paramétrage `refashion_taux_valorisation(annee, categorie, taux_euro_t, valid_from, valid_to)`. Pas non plus de calcul automatique du tonnage trié non TLC.

### 2.6 Feuille `R_Cohérence` — Balance entrées/sorties

Vérification que la somme des sorties par filière ≈ entrées (perte tolérée 2-3 %).

**Entrées** : Atelier de tri, Couettes / Oreillers, Totaux.

**Sorties par filière** (20 lignes) :
- Recyclage : Coton couleur, Jeans / Velours, Mérinos, Tricot
- Essuyage : Coton blanc, Coton couleur
- CSR : Textiles, Chaussures, Maroquinerie
- Rideaux / Déco Textiles
- Peluches / Jouets
- DEEE
- Poubelle jaune
- Pré-classé : Textile, Chaussures Paires, Maroquinerie, Linge de maison
- Dons : Textile, Chaussures, Maroquinerie, Linge de maison, Couettes/Oreillers, Peluches/Jouets
- Déchets : Non TLC, Ultimes TLC

**Reproduction solidata** : ⚠️ refonte nécessaire — `categories_sortantes` actuelle n'a pas cette granularité.

### 2.7 Feuille `LC` — Collectes Lions Club

Apport mensuel de partenaires externes (Lions Club Louviers 3 033 kg en jan, Lions Club Elbeuf 10 474 kg en jan, Total 13 507 kg).

**Reproduction solidata** : ❌ aucune table de tonnages externes. À ajouter (table `apports_externes` ou enrichissement de `tonnage_history.source`).

---

## 3. Cartographie des correspondances Dashboard ↔ solidata.online

| Donnée Dashboard | Table solidata | Vue à construire |
|---|---|---|
| Annuel — tournée × mois | `tours`, `tour_weights` | `vw_tonnage_annuel_tournee` |
| Sortants — Exutoires | `exutoires` | aucune (table directe) — enrichir avec agrément |
| Sortants — Produits | `categories_sortantes` | refonte du contenu — voir 17 catégories ci-dessus |
| R_Tx I–VII | `colisages` + `categories_sortantes` + `exutoires` | `vw_dpav_sortants` |
| R_Tx stocks | `colisages WHERE statut='scelle' OR 'ouvert'` | `vw_dpav_stocks` |
| R_P&C | `cav.commune`, à enrichir avec INSEE | `vw_dpav_communes` |
| R_€ subvention | `refashion_dpav` + taux | `vw_subvention_refashion_mensuelle` |
| R_Cohérence | Sommes ventilées | `vw_coherence_tri_filiere` |
| LC | À créer | nouvelle table `apports_externes` |

---

## 4. Plan d'action QHSE — vues SQL prêtes à créer

### Vue 1 — Tonnage annuel par tournée
```sql
CREATE OR REPLACE VIEW vw_tonnage_annuel_tournee AS
SELECT EXTRACT(YEAR FROM t.date)::int AS annee,
       EXTRACT(MONTH FROM t.date)::int AS mois,
       sr.name AS tournee,
       SUM(tw.weight_kg)::int AS poids_kg
FROM tours t
JOIN tour_weights tw ON tw.tour_id = t.id
LEFT JOIN standard_routes sr ON t.standard_route_id = sr.id
GROUP BY annee, mois, sr.name
ORDER BY annee, mois, sr.name;
```

### Vue 2 — DPAV sortants par exutoire (R_Tx)
```sql
CREATE OR REPLACE VIEW vw_dpav_sortants AS
SELECT EXTRACT(YEAR FROM c.scelle_at)::int AS annee,
       EXTRACT(QUARTER FROM c.scelle_at)::int AS trimestre,
       cs.famille AS section_dpav,  -- I.brut / II.écrémé / III.crème / IV.éliminé / V.retour / VI.upcycling / VII.chiffon
       e.nom AS exutoire,
       SUM(c.poids_kg)/1000.0 AS tonnage_t,
       COUNT(*) AS nb_colisages
FROM colisages c
JOIN categories_sortantes cs ON c.categorie_sortante_id = cs.id
LEFT JOIN exutoires e ON c.exutoire_id = e.id
WHERE c.status IN ('scelle','expedie','livre')
GROUP BY annee, trimestre, section_dpav, e.nom
ORDER BY annee, trimestre, section_dpav, exutoire;
```

### Vue 3 — DPAV communes (R_P&C)
```sql
CREATE OR REPLACE VIEW vw_dpav_communes AS
SELECT EXTRACT(YEAR FROM t.date)::int AS annee,
       EXTRACT(QUARTER FROM t.date)::int AS trimestre,
       c.commune,
       c.code_postal,  -- TODO: ajouter colonne
       SUM(tw.weight_kg)::int AS poids_kg
FROM tours t
JOIN tour_weights tw ON tw.tour_id = t.id
JOIN tour_cav tc ON tc.tour_id = t.id AND tc.status='collected'
JOIN cav c ON tc.cav_id = c.id
GROUP BY annee, trimestre, c.commune, c.code_postal
ORDER BY annee, trimestre, c.commune;
```

### Vue 4 — Subvention Refashion mensuelle (R_€)
```sql
CREATE OR REPLACE VIEW vw_subvention_refashion_mensuelle AS
WITH base AS (
  SELECT EXTRACT(YEAR FROM c.scelle_at)::int AS annee,
         EXTRACT(MONTH FROM c.scelle_at)::int AS mois,
         cs.famille,
         SUM(c.poids_kg) AS poids_kg
  FROM colisages c
  JOIN categories_sortantes cs ON c.categorie_sortante_id = cs.id
  WHERE c.status IN ('scelle','expedie','livre')
  GROUP BY annee, mois, cs.famille
), entrant AS (
  SELECT EXTRACT(YEAR FROM date)::int AS annee,
         EXTRACT(MONTH FROM date)::int AS mois,
         SUM(entree_ligne_kg) AS tonnage_trie_kg
  FROM production_daily
  GROUP BY annee, mois
), pivot AS (
  SELECT b.annee, b.mois,
         SUM(b.poids_kg) FILTER (WHERE b.famille='Refus de tri') AS non_tlc_kg,
         SUM(b.poids_kg) FILTER (WHERE b.famille='Réemploi') AS reutil_kg,
         SUM(b.poids_kg) FILTER (WHERE b.famille IN ('Recyclage','Effilochage','Chiffons')) AS recyclage_kg,
         SUM(b.poids_kg) FILTER (WHERE b.famille='CSR') AS csr_kg,
         SUM(b.poids_kg) FILTER (WHERE b.famille='Valo énergétique') AS valo_energie_kg
  FROM base b GROUP BY b.annee, b.mois
)
SELECT e.annee, e.mois, e.tonnage_trie_kg,
       COALESCE(p.non_tlc_kg, 0) AS non_tlc_kg,
       CASE WHEN e.tonnage_trie_kg > 0 THEN COALESCE(p.non_tlc_kg,0)::numeric / e.tonnage_trie_kg ELSE 0 END AS taux_non_tlc,
       (e.tonnage_trie_kg - COALESCE(p.non_tlc_kg,0)) AS soutenable_kg,
       COALESCE(p.reutil_kg, 0) AS reutil_kg,
       COALESCE(p.reutil_kg, 0) * (1 - COALESCE(p.non_tlc_kg,0)::numeric / NULLIF(e.tonnage_trie_kg,0)) AS reutil_retenu_kg,
       COALESCE(p.recyclage_kg, 0) AS recyclage_kg,
       COALESCE(p.csr_kg, 0) AS csr_kg,
       COALESCE(p.valo_energie_kg, 0) AS valo_energie_kg,
       -- Subvention selon sortant (€)
       (COALESCE(p.reutil_kg, 0) * (1 - COALESCE(p.non_tlc_kg,0)::numeric / NULLIF(e.tonnage_trie_kg,0)) * 80.0
        + COALESCE(p.recyclage_kg, 0) * (1 - COALESCE(p.non_tlc_kg,0)::numeric / NULLIF(e.tonnage_trie_kg,0)) * 295.0
        + COALESCE(p.csr_kg, 0) * (1 - COALESCE(p.non_tlc_kg,0)::numeric / NULLIF(e.tonnage_trie_kg,0)) * 210.0
        + COALESCE(p.valo_energie_kg, 0) * 20.0) / 1000.0 AS subvention_sortant_eur,
       -- Subvention selon entrant (€)
       e.tonnage_trie_kg / 1000.0 * 193.0 AS subvention_entrant_eur
FROM entrant e LEFT JOIN pivot p USING (annee, mois)
ORDER BY annee, mois;
```

### Vue 5 — Cohérence entrées/sorties par filière (R_Cohérence)
```sql
CREATE OR REPLACE VIEW vw_coherence_tri_filiere AS
WITH entrant AS (
  SELECT EXTRACT(YEAR FROM date)::int AS annee,
         EXTRACT(MONTH FROM date)::int AS mois,
         SUM(entree_ligne_kg) AS entree_kg
  FROM production_daily GROUP BY annee, mois
), sortant AS (
  SELECT EXTRACT(YEAR FROM c.scelle_at)::int AS annee,
         EXTRACT(MONTH FROM c.scelle_at)::int AS mois,
         cs.nom AS filiere,
         SUM(c.poids_kg) AS sortie_kg
  FROM colisages c
  JOIN categories_sortantes cs ON c.categorie_sortante_id = cs.id
  WHERE c.status IN ('scelle','expedie','livre')
  GROUP BY annee, mois, cs.nom
), totaux AS (
  SELECT annee, mois, SUM(sortie_kg) AS total_sorties_kg
  FROM sortant GROUP BY annee, mois
)
SELECT e.annee, e.mois,
       e.entree_kg,
       t.total_sorties_kg,
       (e.entree_kg - COALESCE(t.total_sorties_kg, 0)) AS ecart_kg,
       ROUND(100.0 * (e.entree_kg - COALESCE(t.total_sorties_kg, 0))::numeric / NULLIF(e.entree_kg, 0), 2) AS ecart_pct
FROM entrant e LEFT JOIN totaux t USING (annee, mois)
ORDER BY annee, mois;
```

---

## 5. Tâches de mise en conformité QHSE

| # | Tâche | Effort | Bénéfice audit |
|---|---|---|---|
| Q1 | Refonte `categories_sortantes` — aligner sur les 17 catégories Dashboard (Coton couleur, Coton blanc, Jeans, Mérinos, Tricot, Textiles CSR/Pré-classé/Don, Chaussures CSR/Pré-classé/Don, etc.) | 0,5 j | Aligne directement DPAV |
| Q2 | Ajouter `code_postal` à `cav` + import depuis fichier INSEE | 0,3 j | Génération CSV communes auto |
| Q3 | Créer les 5 vues SQL ci-dessus dans `init-db.js` | 0,5 j | Vues prêtes pour audit |
| Q4 | Créer page `/admin/audit-refashion` avec exports XLSX/CSV des 5 vues | 1 j | QHSE autonome |
| Q5 | Table `refashion_taux_valorisation(annee, categorie, taux_euro_t, valid_from, valid_to)` + UI admin | 0,4 j | Paramétrage taux |
| Q6 | Table `apports_externes(date, partenaire, poids_kg, source)` + intégration `tonnage_history` | 0,3 j | Suivi Lions Club |
| Q7 | Ajouter dans `categories_sortantes` une « Refus de tri / Déchet non TLC » obligatoire | 0,2 j | Cohérence R_Cohérence |
| Q8 | Export PDF mensuel automatique (subvention + balance entrées/sorties + DPAV draft) envoyé par e-mail | 0,5 j | Pièce permanente |

**Total** : ~3,7 j pour passer QHSE de 41 % à **95 %** de couverture audit-ready.

---

## 6. Procédure QHSE recommandée (mensuelle)

1. **J+1 du mois suivant** : QHSE ouvre `/admin/audit-refashion`.
2. Vérifie `vw_coherence_tri_filiere` : écart entrée-sortie < 3 %. Si > 3 %, alerte aux managers tri.
3. Vérifie `vw_subvention_refashion_mensuelle` : dual-calcul cohérent (écart sortant vs entrant < 5 %).
4. Exporte CSV `vw_dpav_communes` du trimestre courant.
5. Exporte CSV `vw_dpav_sortants` du trimestre courant.
6. **J+15 du trimestre suivant** : remontée DPAV Refashion via le portail Refashion (`refashion_dpav` saisi et verrouillé).
7. **J+30** : verrouillage trimestriel via `stock_period_locks`.
8. **Annuel** : archivage des 12 exports mensuels.

---

## 7. Évidences à conserver pour l'audit permanent

Pour Refashion :
- Export `vw_dpav_sortants` (trimestre)
- Export `vw_dpav_communes` (trimestre)
- Export `vw_dpav_stocks` (fin de trimestre)
- Capture écran `refashion_dpav` saisi + verrouillé
- Bordereau de transport (`expeditions`) par exutoire
- Liste exutoires avec agrément (cf. P0 audit Refashion)

Pour Métropole :
- Tonnage par commune (`vw_dpav_communes`)
- Tonnage par tournée annuel (`vw_tonnage_annuel_tournee`)
- Taux captation kg/hab (existe sur `/reporting-metropole`)
- Taux sortie dynamique (cf. audit Métropole — KPI à créer)
- Liste CDDI en cours avec ancienneté
- Heures de formation année (`work_hours.type='training'`)

Pour QHSE interne :
- Balance entrée/sortie mensuelle (`vw_coherence_tri_filiere`)
- Subvention dual-calcul mensuelle (`vw_subvention_refashion_mensuelle`)
- Apports externes (Lions Club + autres)

---

## 8. Annexe — correspondance directe Dashboard ↔ tables solidata

| Feuille Excel | Cellule type | Table solidata | Champ |
|---|---|---|---|
| Annuel | B2 (Rive Droite 1 / Jan) | `tour_weights` | `weight_kg` filtré tour + mois |
| Sortants ! B4:B35 | "Agilec", "Alunited"… | `exutoires` | `nom` |
| Sortants ! C4:C20 | "Chiffons blanc", "CSR Chaussures"… | `categories_sortantes` | `nom` (à aligner) |
| R_Tx ! I.brut | Solidarité Textiles, Eurofrip… | `colisages` JOIN `exutoires` WHERE famille='Original' | — |
| R_Tx ! VII.chiffon | Coupe de chiffon | `colisages` famille='Chiffons' | — |
| R_P&C ! A:B | 76000 Rouen, 27340 Martot… | `cav` | `code_postal`, `commune` |
| R_€ ! B2 (32014) | Tonnage trié janvier | `production_daily.entree_ligne_kg` SUM month=1 | — |
| R_€ ! B6 (10497) | Réutilisation janvier | `colisages` famille='Réemploi' SUM month=1 | — |
| R_Cohérence ! sortie | Recyclage Coton couleur | `colisages` famille (granularité fine) | — |
| LC ! C5 (3033) | Lions Club Louviers janvier | `apports_externes` (table à créer) | `poids_kg` |

---

**Rapport établi par** : ingénieur QHSE Solidarité Textiles
**Distribué à** : Direction, RAQ, Responsable conformité Refashion, Responsable conventions Métropole

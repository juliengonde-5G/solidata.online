# Audit Refashion — traçabilité chaîne de tri et flux non-original

> 📌 **Mise à jour 2026-05-10 (post-sprints P0/P1/P2)** : couverture passée de 55 % à **92 %**. Tous les blocages critiques de la section 1 (synthèse) sont résolus. Voir le rapport de suivi consolidé `2026-05-10-audit-suivi-sprints.md` pour le détail chantier par chantier.

**Date** : 2026-05-10
**Auditeur** : éco-organisme Refashion
**Périmètre** : Solidarité Textiles — centre de tri Rouen
**Objectif** : vérifier la capacité du système d'information `solidata.online` à documenter, justifier et auditer **tous les flux de matières qui ne sont pas vendus comme "original"** (réemploi, recyclage fibre, CSR, effilochage, chiffons, VAK, etc.), depuis l'entrée matière (pesée à l'arrivée) jusqu'à l'expédition à l'exutoire.

---

## 1. Synthèse exécutive

| Domaine | Couverture | Niveau de risque |
|---|---|---|
| DPAV trimestriel | 60 % — données présentes, audit-trail incomplet | **ÉLEVÉ** |
| Chaîne de tri (batch → execution → output) | 85 % | MOYEN |
| Flux de matières non-original | 40 % | **ÉLEVÉ** |
| Référentiel catégories sortantes ↔ Refashion | 50 % | MOYEN |
| Référentiel exutoires & agréments | 30 % | **CRITIQUE** |
| Grand livre de stock (mouvements) | 95 % | FAIBLE |

**Verdict global** : le système est techniquement capable de répondre aux exigences de traçabilité de base, mais **trois points bloquants** doivent être levés avant un audit Refashion formel :
1. Absence d'**agrément Refashion** dans le référentiel `exutoires`.
2. Absence de **réconciliation poids** entre la sortie d'opération (`operation_outputs.poids_kg`) et l'expédition réelle (`colisages.poids_kg` puis `expeditions.poids_kg`).
3. Table `refashion_dpav` **sans piste d'audit** (pas de `created_by`, `updated_at`, pas d'historique des modifications).

---

## 2. Périmètre du contrôle

Sont concernés tous les flux qui sortent du centre de tri et qui ne sont pas vendus en l'état comme « original » (textile non trié, exporté principalement vers les exutoires VAK pour réemploi international).

Flux audités :

- **Réemploi** : revente directe (boutiques Solidarité Textiles, partenaires Emmaüs, etc.)
- **Recyclage fibre** : effilochage, jean, coton blanc, coton couleur
- **CSR** (Combustible Solide de Récupération) — valorisation énergétique
- **Chiffons** (essuyage industriel)
- **VAK** (Vêtements / Articles / Kilogrammes — export hors Europe)
- **Refus de tri** (vers ordures ménagères, en théorie inexistant)

Pour chaque flux : entrée pesée → tri → conditionnement (carton ou balle) → expédition vers exutoire.

---

## 3. Cartographie des données solidata.online

### 3.1 Pesées à l'arrivée et grand livre matière

- Table **`stock_original_movements`** (`backend/src/scripts/init-db.js`) : grand livre brut avec `type` (entrée/sortie), `date`, `poids_kg`, `origine`, `destination`, FKs `tour_id`, `batch_id`, `expedition_id`, `created_by`, `created_at`.
- Audit trail **`stock_original_audit`** : enregistrement champ par champ (`old_value`/`new_value`/`user_id`/`created_at`) à chaque modification post-création.
- Verrouillage trimestriel **`stock_period_locks`** + helper `isQuarterLocked()` (`backend/src/routes/stock-original.js:163`) qui interdit toute modif d'un trimestre clôturé.
- Vue agrégée **`vw_tonnage_reconciliation_jour`** (init-db.js:703) qui rapproche quotidiennement la collecte (`tours.total_weight_kg`) avec l'entrée chaîne de tri (`production_daily.entree_ligne_kg`).

✅ **Conforme** — le grand livre est complet, horodaté, signé, verrouillable par trimestre, avec historique des modifications. Niveau attendu pour un audit Refashion.

### 3.2 Chaîne de tri — lot → opération → sortie

```
batch_tracking (LOT-XXXX)
   ↓ created_by, created_at, poids_initial_kg
operation_executions (5 ou 1 opération selon chaîne)
   ↓ started_at, completed_at, completed_by, perte_kg
operation_outputs (sorties pesées par catégorie)
   ↓ created_at, categorie_sortante_id, poids_kg
colisages (carton/balle scellé)
   ↓ scelle_at, scelle_by, exutoire_id
colisage_history (transitions de statut ouvert→scellé→expédié→livré)
   ↓ from_status, to_status, changed_by, comment
expeditions (bon de livraison + transporteur)
```

✅ **Conforme à 85 %**. Couvre toute la chaîne de tri.

⚠️ **Gaps repérés** :
- `operation_outputs` **n'a pas de `created_by`** — impossible d'attribuer une sortie à un opérateur.
- `flux_sortants` (table prévue pour le bilan mensuel par filière) **n'est jamais écrite** par aucune route — schéma orphelin. Le bilan filière est aujourd'hui reconstitué à la volée via JOIN.
- `operation_outputs.poids_kg` n'a **pas de réconciliation** avec la somme des `colisages.poids_kg` correspondants. Un opérateur peut déclarer 100 kg en sortie d'opération et ne sceller que 80 kg de cartons sans alerte.

### 3.3 Référentiel des catégories sortantes

- Table **`categories_sortantes`** : `nom`, `famille`, `is_active` — c'est tout.
- **Pas de colonne `categorie_refashion`** : le mapping vers les catégories officielles Refashion (Réutilisation, Recyclage, Élimination) est codé en dur dans `Refashion.jsx:35` pour les taux de subvention.
- **Pas de versionnage** : si Refashion modifie ses catégories, l'historique est perdu.

⚠️ **Action recommandée** : ajouter à `categories_sortantes` les colonnes `categorie_refashion VARCHAR(50)`, `taux_subvention_euro_t NUMERIC`, `valid_from DATE`, `valid_to DATE`.

### 3.4 Référentiel exutoires

- Table **`exutoires`** : `nom`, `type`, `adresse`, `contact_*`, `created_at`.
- Table **`partners`** (V1.4.2) : remontée des exutoires + clients_exutoires.

🚩 **Gaps critiques** :
- **Aucune trace de l'agrément Refashion** : pas de champ `agrement_refashion BOOLEAN`, `agrement_numero VARCHAR`, `agrement_date_debut DATE`, `agrement_date_fin DATE`.
- **Aucune date de dernier audit terrain**.
- **`colisage.destination` est un texte libre** dans `stock_original_movements`, pas une FK vers `exutoires` — destination peut être saisie en dur sans validation.

**Sans agrément en base, un auditeur Refashion ne peut pas valider que les flux sortants vont vers des partenaires conformes.** C'est le point bloquant le plus important du présent rapport.

### 3.5 DPAV trimestriel

- Table **`refashion_dpav`** : `annee`, `trimestre`, `stock_debut_t`, `achats_t`, `ventes_reemploi_t`, `ventes_recyclage_t`, `csr_t`, `energie_t`, `tri_t`, `stock_fin_t`, `conformite_cdc`, `notes`.
- Page **`/refashion`** : saisie + suivi des subventions (`refashion_subventions`) + détail par commune (`refashion_communes`).
- POST `/api/refashion/dpav` : utilise `ON CONFLICT DO UPDATE`, écrase la valeur précédente **sans archivage**.

🚩 **Gaps critiques** :
- Pas de `created_by` ni `updated_by` ni `updated_at` → impossible de savoir **qui a saisi quoi quand**.
- Pas de table d'historique → un auditeur qui veut savoir si le DPAV a été modifié après le 15 du mois suivant (date limite Refashion) **ne peut pas le démontrer**.

**Action recommandée** : créer `refashion_dpav_history` (FK + snapshot + user + timestamp) et utiliser un trigger plutôt qu'`ON CONFLICT`.

### 3.6 Bilan flux non-original par trimestre

Le bilan attendu par Refashion (en tonnes) :

| Catégorie | Source actuelle | Risque |
|---|---|---|
| Réemploi | `SUM(colisages.poids_kg) WHERE categorie_sortante.famille='Réemploi'` | Pas de réconciliation avec `operation_outputs` |
| Recyclage fibre | `colisages` famille `Recyclage` | idem |
| CSR | `colisages` famille `CSR` | idem |
| Chiffons | `colisages` famille `Chiffons` | idem |
| Effilochage | `colisages` famille `Effilochage` | idem |
| VAK | `colisages` famille `VAK` ou `stock_original_movements WHERE destination LIKE '%VAK%'` | Double source — risque double comptage |
| Refus de tri (élimination) | **Aucune source dédiée** | Non tracé |

🚩 **La catégorie « refus de tri / élimination »** (déchets non valorisables) n'a pas de table dédiée. Pour Refashion, un centre de tri qui élimine 0 % est suspect ; il faut un suivi explicite (même à 0 %) avec destination (incinération, ordures ménagères) et facture du prestataire.

---

## 4. Requêtes de contrôle prêtes à exécuter

### Bilan flux non-original — trimestre courant
```sql
SELECT cs.famille AS categorie_refashion,
       SUM(c.poids_kg)/1000.0 AS tonnage_t,
       COUNT(*) AS nb_colisages
FROM colisages c
JOIN categories_sortantes cs ON c.categorie_sortante_id = cs.id
WHERE c.scelle_at BETWEEN '2026-04-01' AND '2026-06-30'
  AND c.status IN ('scelle','expedie','livre')
GROUP BY cs.famille
ORDER BY tonnage_t DESC;
```

### Traçabilité complète d'un lot
```sql
SELECT bt.code AS lot,
       u_lot.username AS lot_par,
       oe.operation_id, oe.poids_entree_kg, oe.poids_sortie_total_kg, oe.perte_kg,
       u_op.username AS operation_par,
       cs.famille AS categorie, oo.poids_kg AS sortie_kg,
       ci.colisage_id, col.code AS carton, col.exutoire_id
FROM batch_tracking bt
LEFT JOIN users u_lot ON bt.created_by = u_lot.id
LEFT JOIN operation_executions oe ON oe.batch_id = bt.id
LEFT JOIN users u_op ON oe.completed_by = u_op.id
LEFT JOIN operation_outputs oo ON oo.execution_id = oe.id
LEFT JOIN categories_sortantes cs ON oo.categorie_sortante_id = cs.id
LEFT JOIN colisage_items ci ON ci.output_id = oo.id
LEFT JOIN colisages col ON ci.colisage_id = col.id
WHERE bt.code = 'LOT-XXXXXX'
ORDER BY oe.started_at, cs.famille;
```

### Réconciliation poids opération ↔ carton
```sql
WITH out_kg AS (
  SELECT oe.batch_id, SUM(oo.poids_kg) AS sortie_op_kg
  FROM operation_executions oe
  JOIN operation_outputs oo ON oo.execution_id = oe.id
  GROUP BY oe.batch_id
), col_kg AS (
  SELECT oe.batch_id, SUM(col.poids_kg) AS sortie_col_kg
  FROM operation_executions oe
  JOIN operation_outputs oo ON oo.execution_id = oe.id
  JOIN colisage_items ci ON ci.output_id = oo.id
  JOIN colisages col ON ci.colisage_id = col.id
  GROUP BY oe.batch_id
)
SELECT bt.code, o.sortie_op_kg, c.sortie_col_kg,
       (o.sortie_op_kg - COALESCE(c.sortie_col_kg, 0)) AS ecart_kg
FROM batch_tracking bt
JOIN out_kg o ON o.batch_id = bt.id
LEFT JOIN col_kg c ON c.batch_id = bt.id
WHERE ABS(o.sortie_op_kg - COALESCE(c.sortie_col_kg, 0)) > 5
ORDER BY ABS(o.sortie_op_kg - COALESCE(c.sortie_col_kg, 0)) DESC;
```

### Liste des destinations sans agrément
```sql
SELECT DISTINCT c.exutoire_id, e.nom, e.type
FROM colisages c
JOIN exutoires e ON c.exutoire_id = e.id
-- TODO: ajouter une JOIN sur agrement_refashion quand le champ existera
ORDER BY e.nom;
```

### DPAV — qui a saisi le trimestre courant ?
```sql
-- ATTENTION : actuellement non répondable, absence de created_by sur refashion_dpav
SELECT annee, trimestre, ventes_reemploi_t, ventes_recyclage_t, csr_t, tri_t, stock_fin_t
FROM refashion_dpav
WHERE annee = 2026 AND trimestre = 2;
```

---

## 5. Plan d'action recommandé

| Priorité | Action | Effort | Impact audit |
|---|---|---|---|
| **P0** | Ajouter `agrement_refashion` (BOOLEAN, numero, date_debut, date_fin) sur `exutoires` + écran admin | 0,5 j | Bloquant pour audit formel |
| **P0** | Ajouter `created_by`, `updated_by`, `updated_at` sur `refashion_dpav` + table `refashion_dpav_history` (trigger) | 0,5 j | Bloquant pour audit formel |
| **P1** | Ajouter `created_by` sur `operation_outputs` | 0,1 j | Couverture audit-trail |
| **P1** | Vue matérialisée `vw_reconciliation_op_colisage` (écarts > 5 kg) | 0,3 j | Détection anomalies |
| **P1** | Catégorie sortante « refus de tri » obligatoire dans `categories_sortantes` (même à 0 kg) | 0,2 j | Cohérence DPAV |
| **P2** | Brancher `flux_sortants` (actuellement orphelin) ou supprimer le schéma | 0,3 j | Nettoyage |
| **P2** | Convertir `stock_original_movements.destination` (texte libre) en FK vers `exutoires` | 0,5 j | Intégrité référentielle |
| **P2** | Ajouter `categorie_refashion` + `taux_subvention` versionnés sur `categories_sortantes` | 0,3 j | Conformité réglementaire |

**Total** : ~2,7 j d'effort technique pour atteindre une couverture de **95 %** audit-ready.

---

## 6. Documents à fournir à l'auditeur

1. Schéma de la chaîne de tri (déjà disponible : `docs/SCHEMA_CHAINE_TRI.md`)
2. Export du grand livre `stock_original_movements` du trimestre concerné (filtrable depuis `/admin-stock-original`)
3. Export `refashion_dpav` du trimestre (depuis `/refashion`)
4. Liste exutoires avec agrément (à produire — voir P0)
5. Liste des lots `batch_tracking` du trimestre avec leurs executions et sorties
6. Procès-verbal de verrouillage du trimestre (depuis `stock_period_locks`)
7. Bilan flux non-original (requête section 4 — bilan par catégorie)

---

## 7. Annexe — références techniques

**Fichiers backend** :
- `backend/src/routes/refashion.js` (DPAV)
- `backend/src/routes/tri.js` (batch / executions / colisages)
- `backend/src/routes/stock-original.js` (grand livre + verrouillage trimestriel)
- `backend/src/scripts/init-db.js` (schéma + vues)

**Fichiers frontend** :
- `frontend/src/pages/Refashion.jsx`
- `frontend/src/pages/ChaineTri.jsx`
- `frontend/src/pages/AdminStockOriginal.jsx`

**Tables à inspecter pendant l'audit** : `refashion_dpav`, `refashion_communes`, `refashion_subventions`, `stock_original_movements`, `stock_original_audit`, `stock_period_locks`, `batch_tracking`, `operation_executions`, `operation_outputs`, `colisages`, `colisage_items`, `colisage_history`, `expeditions`, `categories_sortantes`, `exutoires`, `partners`.

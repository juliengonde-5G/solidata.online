# Chantier P2 — Traçabilité carton/balle bout-en-bout

> Objectif (décision du 4 juillet) : chaîner **carton → lot → tournée → expédition** sans rupture,
> au niveau carton/balle (pas encore le passeport à la pièce).
> Base : le workflow de lots (`batch_tracking → operation_executions → operation_outputs → colisages`)
> est **entièrement implémenté côté backend** (16 endpoints dans `routes/tri.js`) mais n'a **aucune
> interface** et deux liens de traçabilité ne sont jamais écrits. C'est un problème de **câblage + UI**,
> pas de refonte.

## État initial (vérifié dans le code)

| Maillon | Table | Lien amont | État |
|---------|-------|-----------|------|
| Tournée → stock | `stock_movements` / `stock_original_movements` | `tour_id` | ✓ écrit |
| Balance → atelier | `stock_original_movements` (source=balance) | — | ✓ écrit |
| **Lot** | `batch_tracking` | `stock_movement_id` (accepté par `POST /batches`) | ⚠ backend OK, **pas d'UI** |
| Exécution / sortie | `operation_executions` / `operation_outputs` | `batch_id` / `execution_id` | ⚠ backend OK, **pas d'UI** |
| **Carton** | `produits_finis` | `batch_id` (colonne existe) | ✗ **jamais écrit** (R6) |
| Colisage | `colisages` / `colisage_items` | `expedition_id` (colonne existe) | ✗ **jamais écrit** (R7) |
| Stock trié par catégorie | `stock_movements` | `operation_outputs` | ✗ **jamais alimenté** (R2/R5) |
| Exports Refashion | `vw_dpav_sortants`, `vw_coherence_tri_filiere` | colisages | ✗ vides (dépendent de R6/R7) |

## Incréments (chacun livré, testé, commité séparément)

- **I1 — Lien carton → lot (R6)** *(backend)* : `POST /etiquettes/generer` accepte un `batch_id`
  optionnel, validé, écrit dans `produits_finis.batch_id`. Endpoint `GET /tri/batches?status=en_cours`
  déjà disponible pour le sélecteur. Tests Jest.
- **I2 — UI Lots de tri** *(frontend)* : sur `ChaineTri`, un onglet « Lots » (créer un lot depuis une
  sortie balance atelier, démarrer, voir l'avancement). Sélecteur de lot dans `EtiquetteGenerer`.
- **I3 — Lien colisage → expédition (R7)** *(backend + UI)* : endpoint d'association colisages↔expédition
  qui écrit `colisages.expedition_id` + bascule `produits_finis.status`. Vue colisage.
- **I4 — Alimentation stock trié (R2/R5)** *(backend)* : à la complétion d'une exécution, reverser les
  `operation_outputs` en `stock_movements` (entrée par catégorie). Nécessite de résoudre au passage
  le seed `matieres` (bug A1) — à cadrer.
- **I5 — Réparation des vues Refashion** : `vw_dpav_sortants` et `vw_coherence_tri_filiere` deviennent
  fiables une fois les colisages alimentés ; `vw_dpav_communes` (produit cartésien) corrigée.

## Suivi

- [x] I1 — Lien carton → lot (backend + tests)
- [ ] I2 — UI Lots de tri + sélecteur étiquettes
- [ ] I3 — Lien colisage → expédition
- [ ] I4 — Alimentation stock trié
- [ ] I5 — Réparation vues Refashion

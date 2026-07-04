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
- **I3 — Visibilité de la chaîne lot → carton → sortie** *(backend + UI)* — **réorienté** : la couche
  `colisages` (tri.js) est un modèle de conditionnement **inutilisé** ; la vraie sortie carton se fait par
  scan douchette (`/etiquettes/sortie-scan` → `produits_finis.status`/`sortie_commande_type`/`date_sortie`).
  Plutôt que de câbler `colisages.expedition_id` (couche morte), on rend la chaîne réelle **interrogeable** :
  `GET /tri/batches/:id` renvoie les cartons rattachés avec leur sortie, et la vue « Lots de tri » affiche
  une **fiche traçabilité** (lot → cartons → destination/date). Le lien colisage↔expédition reste un
  non-objectif tant que le workflow de colisage n'est pas adopté.
- **I4 — Alimentation stock trié (R2/R5)** *(backend)* : à la complétion d'une exécution, reverser les
  `operation_outputs` en `stock_movements` (entrée par catégorie). Nécessite de résoudre au passage
  le seed `matieres` (bug A1) — à cadrer.
- **I5 — Réparation des vues Refashion** : `vw_dpav_communes` (produit cartésien) **corrigée** — répartition
  uniforme du poids de tournée sur les CAV collectés via CTE séparées, total conservé, plus de gonflement
  ~×nb_cav. `vw_dpav_sortants` et `vw_coherence_tri_filiere` (adossées aux colisages inutilisés) **laissées
  en l'état avec une note** : les rendre fiables suppose d'adopter le workflow de colisage ou de les
  repointer sur `produits_finis` avec mapping `famille_refashion` — décision métier, pas un correctif.

## Suivi

- [x] I1 — Lien carton → lot (backend + tests)
- [x] I2 — UI Lots de tri (ChaineTri onglet « Lots de tri ») + sélecteur de lot dans EtiquetteGenerer + endpoint `GET /etiquettes/lots-actifs` (COLLABORATEUR)
- [x] I3 — Fiche traçabilité lot → cartons → sortie (`GET /tri/batches/:id` enrichi + panneau ChaineTri) ; couche colisage laissée en non-objectif
- [ ] I4 — Alimentation stock trié *(différé — entremêlé avec le seed `matieres`, bug A1 ; à cadrer)*
- [x] I5 — `vw_dpav_communes` corrigée (produit cartésien) ; vues colisages documentées (décision métier)

## Reste à cadrer (hors incréments livrés)

- **I4** : reverser `operation_outputs` en `stock_movements` (entrée par catégorie) à la complétion d'une
  exécution. Bloqué par le bug A1 (rapport 04) : `stock_movements.matiere_id` référence `matieres`, table
  jamais seedée → le stock trié tombe en « Non classé ». Prérequis : seeder/relier `matieres` ↔
  `categories_sortantes`. À traiter comme un chantier stock dédié.
- **Vues Refashion sortants** : repointer `vw_dpav_sortants`/`vw_coherence_tri_filiere` sur `produits_finis`
  (sorties réelles) au lieu des colisages, une fois le mapping vers `famille_refashion` tranché.
- **Sonde matière/couleur (convoyeur)** : dépend de l'activation effective des lots (I1-I3 posent les
  fondations) ; DDL cible dans le rapport 04 §2.3.

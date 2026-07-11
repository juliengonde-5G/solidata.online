# Audit technique — Module « Chaîne de tri & Production »

**Date** : 11 juillet 2026
**Périmètre** : `backend/src/routes/{tri.js, production.js, produits-finis.js, etiquettes.js}`, pages `ChaineTri`, `Production`, `ProduitsFinis`, `EtiquetteGenerer`, `BalancePage`, schéma associé (`init-db.js`), tests unitaires.
**Nature** : qualité de code & dette technique (aucune modification effectuée).

---

## 1. Synthèse

Le module est globalement **sain et bien structuré**. Les deux flux les plus critiques — complétion d'exécution de tri (reversement stock) et génération d'étiquette carton (compteur base24) — sont d'une qualité remarquable : transactionnels, verrouillés (`FOR UPDATE`), idempotents, commentés et testés. Le reste du module est correct mais présente une **dette d'hétérogénéité** : conventions transactionnelles appliquées inégalement, trois chemins divergents de création de `produits_finis`, un état-machine réimplémenté en dur au lieu du service central, un schéma de base désynchronisé du code réel, et un point d'exposition public non authentifié (bascule). Aucune injection SQL n'a été trouvée (requêtes systématiquement paramétrées). **Note globale : 6.5/10.**

---

## 2. Ce qui est bien conçu

- **`PUT /tri/executions/:id/complete`** (`tri.js:320-386`) : exemplaire. `BEGIN/COMMIT/ROLLBACK`, `SELECT … FOR UPDATE`, garde d'idempotence (409 si déjà `termine`, anti double-comptage), calcul de perte, reversement d'une entrée de stock par catégorie sortante. Rationale documentée (I4), couvert par `tri.test.js`.
- **`POST /etiquettes/generer`** (`etiquettes.js:70-162`) : transactionnel, `FOR UPDATE` sur le compteur de poste, génération séquentielle base24 avec gestion de saturation, upsert catalogue, validation du `batch_id` (refus d'un lot clôturé). Concurrence maîtrisée, testé (`etiquettes.test.js`).
- **`POST /etiquettes/sortie-scan`** (`etiquettes.js:252-324`) : transactionnel, `FOR UPDATE` sur le carton, garde de statut (409 « déjà sorti »), vérification que la commande est active.
- **Auth & SQL** : `production.js` et `produits-finis.js` posent `authorize('ADMIN','MANAGER')` au niveau routeur ; requêtes 100 % paramétrées ; upsert propre grâce à `UNIQUE(date)` sur `production_daily`.
- **Migrations idempotentes** (`ADD COLUMN IF NOT EXISTS`, gardes `duplicate_column`) et **tests ciblés** sur les flux à risque (complétion, étiquette, `base24`).
- **Front** : les flux mutants (lots `ChaineTri`, `EtiquetteGenerer`, création `ProduitsFinis`) affichent des erreurs à l'utilisateur ; `EtiquetteGenerer` gère proprement l'annulation asynchrone (drapeau `cancelled`).

---

## 3. Sécurité

**S1 — Bascule publique, écritures non authentifiées (P1).** La route `/balance` n'est **pas** protégée (`App.jsx:121`, sans `ProtectedRoute`) et les 3 endpoints `balance-entree`/`balance-sortie`/`balance-historique` sont définis **avant** `router.use(authenticate)` (`stock-original.js:31-155`, commentaire « bypasser l'auth ») ; `BalancePage.jsx` appelle `axios` brut sans token (`BalancePage.jsx:270,303,306`). Résultat : sur un domaine public, n'importe qui peut écrire dans le grand livre `stock_original_movements` et créer des `produits_finis` (`balance-sortie`). Le choix « kiosk borne de pesée » est légitime, mais l'écriture non authentifiée sur le stock expose à la pollution de données / au DoS. La validation d'entrée (whitelists `origine`/`destination`/`contenant`, poids net > 0) est correcte mais n'empêche pas l'abus. **Recommandation** : appliquer le pattern device-token déjà en place pour les chauffeurs (`vehicles.qr_token`).

**S2 — Fuite de messages d'erreur internes dans `etiquettes.js` (P1).** Presque tous les handlers renvoient `res.status(500).json({ error: err.message })` (`etiquettes.js:20,33,51,65,158,174,189,204,213,230,249,320,343,368,398`). Le projet a explicitement retiré `detail: err.message` ailleurs (audit V1.4.2). Les trois autres fichiers du périmètre renvoient `{ error: 'Erreur serveur' }` : `etiquettes.js` diverge et expose la structure DB/SQL au client.

**S3 — Lecture ouverte large (P2).** Toutes les lectures de `tri.js` (chaînes, batches, colisages, `inventory`, catégories) sont accessibles à tout rôle authentifié (COLLABORATEUR, RESP_BTQ, AUTORITE, RH). Idem `etiquettes.js` `/sortie-session` et `/commandes-actives` qui exposent des commandes boutique/exutoires. En partie intentionnel (opérateur de poste), mais l'absence d'`authorize` ciblé n'est pas justifiée route par route.

---

## 4. Dette technique & cohérence

**D1 — Divergence schéma ↔ code (P1).** Les `CREATE TABLE` de base de `production_daily` (`init-db.js:675`) et `produits_finis` (`init-db.js:871`) sont périmés : ~23 colonnes de `production_daily` (r4, `effectif_*`, `resultat_*`, signatures, `validated_*`) et ~6 de `produits_finis` (`status`, `batch_id`, `poste_etiquetage_id`, `sortie_commande_*`, `scanned_by`) ne vivent que dans la section migrations (`init-db.js:3275-3298`, `1376-1447`). Le schéma réel dépend entièrement des `ALTER` ; un lecteur du `CREATE TABLE` a une vision fausse. Styles de migration mixtes (`ADD COLUMN IF NOT EXISTS` vs blocs `DO … duplicate_column`).

**D2 — État-machine réimplémenté en dur (P1).** Le projet dispose d'un `services/state-machine.js` adopté par `commandes-exutoires` (V6.1) et `boutique-commandes` (V5.3). `tri.js` réécrit `validTransitions` en dur pour les colisages (`tri.js:522-534`) et gère les statuts de batch/produit fini par conditions ad hoc. Duplication + pas d'audit transverse `state_transitions_audit`.

**D3 — Trois chemins divergents de création de `produits_finis` (P1).** (a) `etiquettes/generer` : code-barre base24 `P####`, tous champs + `status` + `batch`. (b) `produits-finis` POST (`produits-finis.js:62`) : code-barre libre, champs dénormalisés (`produit`, `categorie_eco_org`, `genre`, `saison`) laissés NULL, gamme figée `A/B/C` côté UI (`ProduitsFinis.jsx:140-142`). (c) `stock-original/balance-sortie` (`stock-original.js:120-125`) : `PF-<timestamp>`, `produit` = libellé, aucune catégorie. Trois schémas de code-barres, trois niveaux de complétude, deux vocabulaires de gamme **incompatibles** (`A/B/C` vs `EXTRA/STANDARD/VAK/EXPORT`). Risque d'incohérence de données et de reporting Refashion. De plus, `PUT /produits-finis/:id/sortie` (`produits-finis.js:104`) pose `date_sortie` **sans** `status`, tandis que `sortie-scan` pose `status='expedie'` : deux sémantiques de sortie.

**D4 — Antipattern DELETE-puis-réinsertion hors transaction (P1).** `POST /production/chariots` (`production.js:263-272`) supprime tous les chariots du jour puis réinsère en boucle sans transaction. Lecture concurrente → état vide transitoire ; échec en cours de boucle → données perdues. Ce même antipattern a déjà causé des bugs (doublons import RH, historique 2.2.0). À encapsuler en transaction ou upsert (aucune contrainte unique sur `(production_date, ligne, numero)` — `init-db.js:3355`).

**D5 — Écritures multi-tables hors transaction (P1).** `POST /tri/batches` insère le lot puis un `stock_original_movements` en 2 requêtes séparées (`tri.js:192-206`) — 2e échec → lot orphelin sans mouvement. Idem `POST /tri/colisages` (colisage + history) et `POST /tri/colisages/:id/items` (item + maj totaux, avec race sur `nb_articles`). `PUT /tri/colisages/:id/status` fait SELECT-puis-UPDATE sans `FOR UPDATE` (TOCTOU) et update + history hors transaction (`tri.js:528-550`). À comparer à l'excellent `executions/:id/complete`.

**D6 — N+1 sur lectures d'arbres (P2).** `GET /tri/chaines/:id` (`tri.js:48-61`) : 2 requêtes par opération. `GET /tri/batches/:id` (`tri.js:249-257`) : 1 requête par exécution. Volumétrie SIAE faible → impact limité, mais remplaçable par requêtes agrégées.

**D7 — Index FK manquants (P2).** Absents sur `operation_executions.batch_id`, `operation_outputs.execution_id`, `colisage_items.colisage_id`, `colisage_history.colisage_id`, `postes_operation.operation_id`, `sorties_operation.operation_id`, et `produits_finis(sortie_commande_type, sortie_commande_id)`. Postgres n'indexe pas les FK automatiquement. Certains index utiles existent déjà (`idx_produits_finis_batch`, `idx_pf_status_sortie`).

**D8 — Valeurs magiques & défauts incohérents (P2).** Objectifs d'entrée en dur `900` (`production.js:144-146`, `Production.jsx:64`) mais `1300` dans le schéma (`init-db.js:681`) ; objectif mensuel `46.8`/`41.6` t et seuil `22` jours en dur (`production.js:67-68`) ; `objectif_csr_pct` stocké en chaîne `'<10%'` (non calculable). Tares des contenants dupliquées entre `BalancePage.jsx`, `Production.jsx` (`CONTENANT_LABELS`) et le backend (`CONTENANTS_TARES`) — 3 sources à maintenir. `ChaineTri.jsx:240-245` lit `cat.couleur`/`cat.code`/`cat.categorie_refashion` absents de `categories_sortantes` (drift, atténué par des fallbacks).

---

## 5. Robustesse

- **R1 — Catchs silencieux (P2)** : `DELETE /production/objectives/:id`, `/consignes/:id`, `POST /feuille/:date/reopen` (`production.js:401,455,498`) renvoient 500 sans `console.error`.
- **R2 — Chargements front sans état d'erreur (P2)** : `loadData`/`loadProdData`/`loadChainDetail` (`ChaineTri.jsx:48,56,112`) et `loadData` (`ProduitsFinis.jsx:31`) ne font que `console.error` → écran vide silencieux en cas d'échec réseau.
- **R3 — Codes basés sur `Date.now()` (P2)** : `LOT-`/`COL-` (`tri.js:191,416`), `PF-` (`stock-original.js:120`) → collision possible même milliseconde (contrainte UNIQUE → 500 non spécifique). Le base24 séquentiel/verrouillé d'`etiquettes` est bien supérieur.
- **R4 — Validation partielle/redondante (P2)** : doublons express-validator + gardes manuelles (`produits-finis`, `tri` batches/executions) ; `!poids_initial_kg` rejette 0 que `isFloat({min:0})` accepte ; `production.js` POST n'a aucune validation de type sur ses champs numériques (`parseInt`/`parseFloat` silencieux → 0/NaN).

---

## 6. Testabilité

Couverture **ciblée et pertinente** : `tri.test.js` (complétion + traçabilité lot→cartons), `etiquettes.test.js` (generer + lien batch), `base24.test.js`. **Angles morts prioritaires** : `production.js` (0 test — upsert 32 champs, dashboard objectifs, `chariots` delete/reinsert), endpoints publics `balance-entree`/`balance-sortie` (priorité sécurité), transitions & totaux de colisages, `produits-finis.js` (0 test).

---

## 7. Recommandations priorisées

| # | Action | Prio | Effort |
|---|--------|------|--------|
| 1 | Authentifier la bascule via device-token (pattern `qr_token`) ou restreindre l'exposition réseau | P1 | M |
| 2 | `etiquettes.js` : masquer `err.message` (renvoyer `{ error: 'Erreur serveur' }` + log serveur) | P1 | S |
| 3 | Encapsuler en transaction : `production/chariots`, `tri/batches`, `tri/colisages` (+ `FOR UPDATE` sur changement de statut) | P1 | M |
| 4 | Unifier la création de `produits_finis` (un seul service, un seul schéma de code-barre, gamme unique) | P1 | L |
| 5 | Migrer les transitions colisage/batch vers `services/state-machine` | P1 | M |
| 6 | Re-synchroniser les `CREATE TABLE` de base avec les colonnes réelles | P1 | S |
| 7 | Ajouter les index FK manquants ; agréger les lectures N+1 | P2 | S |
| 8 | Centraliser tares/objectifs (constantes/config) ; supprimer `'<10%'` chaîne | P2 | M |
| 9 | Tests : `chariots`, endpoints publics balance, statuts colisage | P2 | M |

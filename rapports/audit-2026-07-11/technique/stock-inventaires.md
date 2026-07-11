# Audit technique — Module « Stock & inventaires » (moderne + original Refashion)

**Date :** 11 juillet 2026
**Périmètre code :** `backend/src/routes/stock.js`, `backend/src/routes/stock-original.js`, schéma `backend/src/scripts/init-db.js`, pages `frontend/src/pages/{Stock,AdminStockOriginal,InventaireOriginal,SortieCartons}.jsx`, tests `backend/tests/unit/routes/stock.test.js`.
**Note globale : 6.5 / 10** — module fonctionnel, conforme aux patterns du projet, avec une bonne intention de conformité (piste d'audit, verrouillage trimestriel), mais quelques failles d'intégrité et de sécurité réelles et une couverture de tests très partielle.

---

## 1. Vue d'ensemble

Le module repose sur **deux systèmes de stock parallèles et indépendants** :

- **Stock moderne** (`stock_movements`, route `stock.js`) : mouvements catégorisés par `categories_sortantes`, alimente `Stock.jsx` et l'inventaire physique (`inventory_batches` / `inventory_items`).
- **Stock original** (`stock_original_movements`, route `stock-original.js`) : matière brute collectée, alimente `InventaireOriginal.jsx` (pesée, historique, évolution) et `AdminStockOriginal.jsx` (grand livre, régularisation, modification, verrouillage trimestriel Refashion).

`SortieCartons.jsx`, bien qu'associée au périmètre, ne consomme **pas** ces routes : elle appelle `/etiquettes/*` (module Étiquettes carton). Cette dualité est documentée mais reste une source de complexité cognitive : deux notions de « stock » coexistent sans réconciliation automatique.

---

## 2. Points forts

- **Respect des patterns du projet.** Express Router, `authenticate` + `authorize('ADMIN','MANAGER')` en tête de routeur (`stock.js:9`, `stock-original.js:160`), SQL systématiquement paramétré (`$1,$2…`), gestion d'erreurs homogène `res.status(500).json({ error })` avec `console.error` préfixé, `express-validator` + middleware `validate` partagé.
- **Transactions correctes là où c'est critique.** La création d'inventaire (`stock.js:183-227`) et la saisie des quantités physiques (`stock.js:248-296`) utilisent `client.connect()` + `BEGIN/COMMIT/ROLLBACK` avec `finally { client.release() }`.
- **Conformité Refashion bien pensée.** Piste d'audit champ par champ (`stock_original_audit`), verrouillage trimestriel (`stock_period_locks`, UNIQUE(year,quarter)) contrôlé sur pesée, régularisation et modification, avec déverrouillage d'urgence ADMIN tracé.
- **Grand livre soigné.** `/ledger` (`stock-original.js:279-342`) calcule un solde cumulé via `SUM(...) OVER (ORDER BY date, id)`, avec export CSV côté front (BOM UTF-8, séparateur `;`).
- **Calcul de tare centralisé.** `CONTENANTS_TARES` (`stock-original.js:12-27`) est une source unique côté serveur, avec validations d'entrée robustes sur les endpoints balance (poids net > 0, contenant whitelisté, tare manuelle numérique).
- **Indexation raisonnable.** Index sur `date`, `type`, `matiere_id`, `tour_id`, `batch_id`, `expedition_id` présents (`init-db.js:2303-2314`, `3503-3536`). Migration A1 (`init-db.js:2316-2337`) défensive et documentée (DO block, `ON DELETE SET NULL`).

---

## 3. Qualité & cohérence

- **Validation redondante.** `POST /stock` (`stock.js:73-84`) déclare des règles `express-validator` **puis** re-teste manuellement `if (!type || !date || !poids_kg)`. Redondant, et le test manuel rejette à tort un `poids_kg = 0` (0 est *falsy*) malgré `isFloat({min:0})`.
- **Duplication front.** `ORIGINES_LABELS` est dupliqué à l'identique dans `AdminStockOriginal.jsx:7-16` et `InventaireOriginal.jsx:8-17`. Le calcul de trimestre `Math.ceil((mois+1)/3)` est réimplémenté côté front (`AdminStockOriginal.jsx:85-88`) et back (`stock-original.js:164-180`).
- **Expression obscure.** La clause LIMIT du ledger `LIMIT $${params.push(parseInt(lim)) && params.length}` (`stock-original.js:321`) exploite la valeur de retour de `push` : correct mais fragile et illisible.
- **Catches muets côté front.** `Stock.jsx` avale la plupart des erreurs (`createMovement`, `createInventory`, `openInventory`, `saveInventoryItems`… lignes 39-101 : `catch (err) { console.error(err); }`). En cas d'échec d'un POST, l'utilisateur n'a **aucun** retour visible. `InventaireOriginal.jsx` et `AdminStockOriginal.jsx` gèrent mieux (bandeau `message`), l'incohérence est notable.
- **Taille des fichiers maîtrisée.** `stock.js` (314 l.) et `stock-original.js` (586 l.) restent lisibles ; aucune fonction excessivement longue.

---

## 4. Dette technique

- **Endpoints morts / divergence schéma↔code (P1).** `GET`/`POST /stock/matieres` (`stock.js:101-127`) lisent et écrivent la table legacy `matieres` (`init-db.js:587`), **vide et jamais référencée** : la migration A1 a repointé `stock_movements.matiere_id` vers `categories_sortantes`. Aucun consommateur front (`grep /stock/matieres` = 0). Un `POST /stock/matieres` crée donc une ligne inexploitable. Code trompeur à supprimer ou rebrancher.
- **Mapping obsolète (P2).** `GAMME_COLORS` dans `SortieCartons.jsx:8-14` référence les anciennes gammes (`BTQ STAND`, `BTQ EXTRA`, `CHIF`, `Pvak`) **supprimées** par la refonte V2.2 (`init-db.js:1595-1600` : seules `EXTRA/STANDARD/VAK/EXPORT` subsistent). Seul `VAK` matche encore ; les autres cartons retombent sur le gris par défaut.
- **Grand livre filtré faux (P2).** Le solde cumulé de `/ledger` est recalculé **uniquement sur la fenêtre filtrée** (`WHERE ... ${dateFilter}`, `stock-original.js:310-322`) : avec `date_from`, le solde d'ouverture n'est pas reporté et la colonne « Solde » démarre à 0, ce qui contredit la sémantique d'un grand livre.
- **Fenêtres temporelles incohérentes.** Dans `/stock/summary` (`stock.js:37-70`), `byCategory` est calculé sur `period` jours alors que `totals.stock_actuel` porte sur **tout** l'historique. Les deux blocs ne sont pas comparables.
- **Ledger non borné par défaut.** Sans `limit`, `/ledger` renvoie toutes les lignes (`stock-original.js:320-321`) : sur plusieurs années cela devient volumineux (pas de pagination par défaut).
- **Valeurs magiques.** Tolérance d'écart de réconciliation `> 1` kg et `LIMIT 100` codés en dur (`stock.js:139-146`) ; tares physiques figées en code (redéploiement requis pour un changement de contenant).

---

## 5. Sécurité

- **Endpoints balance publics et non authentifiés (P1).** `POST /balance-entree`, `POST /balance-sortie`, `GET /balance-historique` sont **volontairement** définis avant `router.use(authenticate)` (`stock-original.js:29-155`). Conséquences :
  - Écriture anonyme dans `stock_original_movements` (et création de `produits_finis` pour `balance-sortie`) accessible depuis Internet. Seul le rate-limit global (1000 req / 15 min / IP, `index.js:82`) s'applique — suffisant pour du bruit, pas pour un abus déterminé.
  - Ces endpoints **ne vérifient pas** `isQuarterLocked` : un trimestre verrouillé pour la déclaration Refashion reste alimentable par la balance, ce qui **contourne la garantie de gel** promise à l'onglet Verrouillage.
  - `created_by` est `NULL` pour ces mouvements (non traçables), et le nom de l'opérateur est stocké dans `notes`, hors piste d'audit.
  Un jeton kiosque + un contrôle de verrou + un rate-limit dédié seraient a minima nécessaires si l'accès public doit rester.
- **Pas d'injection SQL.** Le `PUT /stock-original/:id` (`stock-original.js:456-490`) construit un UPDATE dynamique mais les noms de colonnes proviennent d'une **whitelist codée en dur** (`fields`), les valeurs sont paramétrées. Correct.
- **Autorisations globalement justes.** Régularisation, modification, verrous, audit sont `ADMIN` ; listes/pesée `ADMIN/MANAGER`. `AdminStockOriginal.jsx` est protégée `roles={['ADMIN']}` côté route (`App.jsx:226`).
- **Absence de vérification d'existence des FK** sur `POST /stock` (`matiere_id`, `vehicle_id`, `tour_id` insérés tels quels) : une valeur invalide déclenche une violation FK → 500 générique plutôt qu'un 400 explicite. Impact faible (routes internes).

---

## 6. Robustesse

- **Écritures multi-tables non atomiques (P1).** Dans `stock-original.js`, l'insertion du mouvement et de l'audit se font en **deux `pool.query` séparés** hors transaction : `/pesee` (`372-382`), `/regularisation` (`407-416`) et surtout `PUT /:id` où **chaque champ modifié est audité avant l'UPDATE final** (`471-490`). En cas d'échec partiel : audit orphelin annonçant un changement qui n'a pas eu lieu, ou mouvement sans trace. De même `balance-sortie` insère le mouvement **puis** le `produits_finis` sans transaction (`stock-original.js:110-127`).
- **Audit inexact sur le champ `date` (P2).** `PUT /:id` compare `String(oldVal) !== String(newVal)` (`463-466`). Pour `date`, `oldVal` est un objet `Date` (`String(Date)` = « Fri Jul 11 2026… ») alors que `newVal` est `'2026-07-11'` : la comparaison est **toujours vraie**, si bien que la date est enregistrée comme « modifiée » à chaque édition même inchangée (bruit d'audit + UPDATE inutile).
- **Inventaire modifiable après validation (P2).** `PUT /inventories/:id/items` (`stock.js:248-296`) ne vérifie pas que le batch est `en_cours` : un ADMIN/MANAGER peut réécrire les quantités d'un inventaire `valide` via appel API direct (le front masque seulement les champs). La validation via `WHERE status='en_cours'` (`stock.js:299-307`) est en revanche bien atomique.
- **Timezone latente.** Le calcul de trimestre repose sur `new Date(date).getMonth()` (`stock-original.js:165-178`) : sur une date `'YYYY-01-01'` interprétée UTC, un fuseau négatif basculerait au T4 de l'année précédente. Sans incidence en conteneur UTC, mais fragile.
- **Concurrence inventaire.** La saisie des items recalcule les totaux du batch à partir du **payload** et non de la base ; deux saisies concurrentes pourraient produire un total incohérent (pas de `FOR UPDATE`). Volume faible, risque théorique.

---

## 7. Testabilité

- **Couverture réelle très partielle.** `stock.test.js` couvre `GET /stock` (401/403/200, filtre type), `GET /stock/summary`, `POST /stock` (401/400/201) — soit ~5 % des endpoints du module.
- **`stock-original.js` n'a AUCUN test** alors qu'il concentre les enjeux sensibles : endpoints **publics** balance, verrouillage trimestriel, régularisation ADMIN, grand livre, piste d'audit. Ce sont précisément les surfaces à sécuriser en priorité (conformité Refashion + écriture anonyme).
- **Inventaire physique non testé** (création transactionnelle, saisie/écart, validation).
- Aucun test front (cohérent avec l'absence générale de tests React dans le projet).

---

## 8. Recommandations priorisées

| # | Recommandation | Priorité | Effort |
|---|----------------|----------|--------|
| 1 | Sécuriser les endpoints balance : jeton kiosque (ou allowlist réseau) + rate-limit dédié + contrôle `isQuarterLocked` avant écriture (`stock-original.js:35-134`). | P1 | M |
| 2 | Rendre atomiques mouvement + audit (et `balance-sortie` + `produits_finis`) dans une transaction unique. | P1 | S |
| 3 | Ajouter des tests d'intégration `stock-original` : balance publique, verrou, ledger, régularisation, audit. | P1 | M |
| 4 | Supprimer (ou rebrancher sur `categories_sortantes`) les endpoints `/stock/matieres` et clarifier le sort de la table legacy `matieres`. | P1 | S |
| 5 | Garde de statut `en_cours` sur `PUT /inventories/:id/items` pour figer un inventaire validé. | P2 | S |
| 6 | Normaliser la date en `'YYYY-MM-DD'` avant comparaison dans l'audit du `PUT /:id`. | P2 | S |
| 7 | Reporter le solde d'ouverture dans `/ledger` filtré (solde antérieur à `date_from`). | P2 | M |
| 8 | Mettre à jour `GAMME_COLORS` (`SortieCartons.jsx`) depuis le référentiel gammes vivant ; remonter les erreurs des catches muets de `Stock.jsx`. | P2 | S |

---

*Conclusion : socle solide et cohérent avec le reste du projet, avec une réelle attention portée à la traçabilité et à la conformité Refashion. Les priorités P1 concernent l'intégrité des données (écritures anonymes non gelées, audit non transactionnel) et le nettoyage d'une divergence schéma/code résiduelle — corrections ciblées et peu coûteuses au regard de leur valeur.*

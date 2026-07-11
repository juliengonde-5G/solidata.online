# Audit technique — Module Finance, Facturation & Synchronisation Pennylane

**Date :** 11 juillet 2026
**Périmètre :** `backend/src/routes/{billing.js, finance.js, pennylane.js, factures-exutoires.js}`, `backend/src/services/BillingService.js`, `backend/src/repositories/InvoiceRepository.js`, pages `Finance*`, `Pennylane*`, `Billing`, `ExutoiresControleFacturation`, schéma DB (`migrate-finance.js`, `migrate-exutoires.js`, `init-db.js`).
**Note globale : 6,5 / 10**

---

## 1. Synthèse

Le module se compose de trois blocs de maturité inégale. Le sous-module **facturation interne** (`billing.js` + `BillingService.js` + `InvoiceRepository.js`) est **exemplaire** : c'est le seul du périmètre à suivre proprement le triptyque contrôleur mince / service métier / repository, et le seul couvert par des tests. L'**intégration Pennylane** (`pennylane.js`, 1 282 lignes) est solide sur l'ingénierie réseau (retry 429, pagination curseur, transactions) mais souffre de duplication et de code mort hérité du flux PUSH retiré. Le cœur **analytique** (`finance.js`, 1 570 lignes) est un monolithe non testé qui calcule P&L, bilan, trésorerie et coûts complets en mémoire JS. Le **contrôle de facturation** (`factures-exutoires.js`) est fonctionnel mais porte quelques incohérences de statut et un auto-matching fragile.

Aucune faille de sécurité majeure : SQL systématiquement paramétré, autorisation présente partout, clé API chiffrée sans fallback en clair.

---

## 2. Points forts

- **Architecture facturation interne de référence.** `billing.js` (110 lignes) est un contrôleur mince : `BillingService.calculateTotals`/`generateInvoiceNumber`/`canTransitionStatus` portent le métier, `InvoiceRepository` isole le SQL, la création multi-tables passe par une transaction explicite (`billing.js:49-87`). `generateInvoiceNumber` protège l'interpolation d'identifiants par une whitelist regex stricte (`BillingService.js:41-44`). C'est le seul bloc **testé** (`BillingService.test.js`, `InvoiceRepository.test.js`, `billing.test.js`).
- **SQL paramétré partout.** Aucune concaténation d'entrée utilisateur dans les requêtes des quatre fichiers. Les rares identifiants dynamiques (préfixe/table de `generateInvoiceNumber`, `ALTER` de colonnes GL `pennylane.js:297-305`) sont bornés par des regex de sûreté.
- **Chiffrement Pennylane correct.** `getEncryptionKey()` lève une erreur si aucune clé n'est configurée — pas de clé « default » codée en dur (`pennylane.js:19-23`).
- **Robustesse réseau Pennylane.** Retry automatique sur 429 avec lecture de `Retry-After` (header + corps) et backoff exponentiel plafonné (`pennylane.js:93-123`) ; pagination curseur avec garde à 200 pages et throttle 350 ms (`fetchAllPages`, `pennylane.js:144-174`).
- **Transactions bien posées sur les écritures multi-tables.** Import GL/transactions en `BEGIN/COMMIT/ROLLBACK` ; le PULL des factures clients isole **chaque facture dans sa propre transaction** pour qu'une facture fautive n'avorte pas le lot (`pennylane.js:552-641`). Rapprochement/déliaison encadrés par transaction + audit `historique_commandes_exutoires`.
- **Autorisation systématique.** Chaque routeur applique `authenticate` + `authorize('ADMIN','MANAGER')` ; config Pennylane et déliaison réservées à `ADMIN`.

---

## 3. Faiblesses & dette technique

### 3.1 `finance.js` : monolithe non testé (P1)
1 570 lignes, ~15 endpoints hétérogènes (import Excel, P&L, bilan/SIG/ratios/seuil, trésorerie, KPIs, rentabilité, contrôles, settings, logs). Le P&L (`finance.js:405-554`) et la trésorerie (`:726-834`) **chargent toutes les écritures de classe 6/7 ou 512 et agrègent en JS** — coûteux en mémoire et non indexable. Aucune de ces fonctions de calcul (bilan, SIG, ratios, coût/tonne) n'est testée, alors que ce sont les plus sensibles métier.

### 3.2 Schéma DB fragmenté en 4 emplacements (P1)
Contrairement à la règle CLAUDE.md §4 (« nouvelles tables via `init-db.js` »), le schéma est éclaté :
- `migrate-finance.js` → tables `financial_*` ;
- `migrate-exutoires.js:143-158` → `factures_exutoires` **schéma OCR historique** (`commande_id NOT NULL`, colonnes mortes `facture_pdf/ocr_*`, ancien CHECK) ;
- `init-db.js:4182-4219` → **extension Pennylane** de `factures_exutoires` (ajout colonnes `pennylane_*`, `DROP NOT NULL`, CHECK élargi) ;
- `pennylane.js:252-310` → IIFE au chargement du module créant `pennylane_config/sync_log/mappings`.

L'extension `factures_exutoires` vit dans `initDatabase()`, appelée séparément par `deploy.sh` (`node src/scripts/init-db.js`) **après** le démarrage conteneur : la convergence dépend de cet ordonnancement inter-processus. Un simple `docker restart` (sans `deploy.sh`) ne rejoue pas l'extension via `initOnStartup` (branche `else`, `index.js:426-450`). Fragile, même si le chemin `update` normal converge.

### 3.3 Duplication de code (P2)
- La logique d'insertion GL par batch est **dupliquée** entre `POST /sync/gl` (`pennylane.js:676-843`) et `syncGLAuto` (`:1073-1185`), idem transactions (`:850-952` vs `:1192-1277`) — ~300 lignes redondantes, les deux copies étant vivantes (route HTTP + scheduler, cf. `scheduler.js:561-587`).
- `recomputeFactureEcart` existe en double, quasi identique, dans `pennylane.js:474-518` et `factures-exutoires.js:16-57`.

### 3.4 Code mort / configuration factice (P2)
- **Flags `sync_invoices` / `sync_suppliers` / `sync_journal`** : stockés et éditables dans `PennylaneConfig.jsx:171-182`, mais **jamais lus** dans la logique backend. Toggles trompeurs.
- **`pennylane_mappings`** : table créée et lue (`GET /mappings`, `status.total_mappings`) mais **jamais alimentée** (aucun INSERT) depuis le retrait du PUSH → toujours vide.
- **`webhook_secret`** : colonne présente, aucune route webhook (contrairement à SumUp/VAK).
- **Endpoints Excel `/finance/import/{gl,transactions,budget}`** : ~260 lignes de parsing exceljs, **orphelins côté UI** — `FinanceImport.jsx` redirige exclusivement vers Pennylane.

### 3.5 Incohérences de statut (bugs réels, P1)
- **KPI « Écarts validés » faux.** `factures-exutoires.js:121` compte `statut_facture = 'validee'`, or l'action « Valider l'écart » écrit `'ecart_valide'` (`:330`). Un écart validé **n'incrémente jamais** le KPI. Deux endpoints de validation à finalités qui se recouvrent (`validate-ecart` → `ecart_valide` vs `PATCH /valider` → `validee`).
- **Badge historique Pennylane.** `PennylaneConfig.jsx:218` teste `h.status === 'success'`, valeur **jamais émise** par le backend (`completed`/`partial`/`error`/`in_progress`) → une synchro réussie s'affiche en ambre. La même table est rendue correctement dans `Pennylane.jsx:390` (`'completed'`) : composant dupliqué à logique divergente.

### 3.6 `autoMatchCommande` fragile et semi-destructif (P1)
`pennylane.js:436-471` : le motif `\b\d{4,8}\b` capture **n'importe quel nombre de 4 à 8 chiffres** (date, montant, n° de pièce) → faux positifs ; le repli #2 utilise la référence commande comme motif `ILIKE` (`$1 ILIKE '%'||reference||'%'`), sensible à l'ordre et interprétant les jokers `%`/`_` littéralement. Un rapprochement erroné **bascule la commande en `cloturee`** et écrit l'historique — mutation d'état difficilement repérable, sans seuil de confiance ni journalisation de la décision.

### 3.7 Robustesse / concurrence (P2)
- **Connexion mobilisée pendant le fetch API.** `POST /sync/gl` et `syncGLAuto` acquièrent `pool.connect()` **avant** `fetchAllPages` (plusieurs minutes), immobilisant une connexion du pool durant tout le téléchargement (`pennylane.js:677` vs `697`). Il faudrait fetcher d'abord, acquérir la connexion ensuite.
- **`enrichGLCategories` en N+1.** Un `GET` par ligne sans catégorie, 350 ms chacun → dizaines de minutes pour quelques milliers de lignes ; lancé en fire-and-forget (`:804`), le `catch` (`:236`) avale **toutes** les erreurs (y compris un 401 persistant) sans abandon anticipé, ne journalisant qu'une itération sur 100.
- **Libellés Pennylane codés en dur.** KPIs et rentabilité dépendent de chaînes exactes (`'Centre P&L'`, `'Collecte & Original'`, `'Tri & Recyclage - 2nde main'`, `'Frais Generaux'`, `finance.js:1036,1059-1061`). Un renommage côté Pennylane fait silencieusement retomber les indicateurs à 0. Le seed `centres_pl` de `financial_settings` existe mais n'est pas exploité.

### 3.8 Gestion d'erreurs & validation inégales (P2)
- ~11 des 24 `catch` de `finance.js` renvoient `500` **sans `console.error`** (budget, operations, settings, logs) : diagnostic amoindri.
- Côté front, `Finance.jsx:61` et `ExutoiresControleFacturation`/`Billing` capturent en `console.error` sans `ErrorState` : un échec de chargement rend un tableau de bord vide/à zéro **indiscernable** d'une absence de données.
- **Pas de validation de `:year`** (`parseInt` sans garde `isNaN`) ; les écritures `PUT /budget` et `PUT /operations` n'ont pas de middleware `validate` (les CHECK DB rattrapent le mois). Risque faible mais entrées non contrôlées à la frontière API.
- `Billing.jsx:44` ouvre le PDF via `window.open('/api/exports/invoice/:id')` : ce chemin **ne porte pas le Bearer** de l'intercepteur axios → probable 401 si la route est protégée (transverse, `exports.js` hors périmètre).

### 3.9 Divers
- Ternaire mort `commandeId ? 'recue' : 'recue'` (`pennylane.js:592`).
- Bilan : `TOTAL PASSIF` en N-1 réutilise `totalActifN1` (`finance.js:665`) — incohérence cosmétique.
- Calcul monétaire en flottants JS avec `Math.round(*100)/100` (P&L/bilan) vs agrégation SQL (`/kpis`, `/balances`) : approche non homogène ; le chiffrement Pennylane est en AES-256-**CBC** sans authentification (le module VAK utilise GCM) — intégrité non garantie.

---

## 4. Testabilité

**Couvert :** `BillingService`, `InvoiceRepository`, route `billing` — soit le bloc le plus simple.
**Non couvert (prioritaire) :** toute la logique de calcul de `finance.js` (P&L, bilan, SIG, ratios, seuil de rentabilité, coût/tonne, trésorerie), et les fonctions pures de `pennylane.js` (`autoMatchCommande`, `extractInvoiceQuantity`, `recomputeFactureEcart`, `extractRetryAfterMs`) et `factures-exutoires.js` (calcul d'écart, transitions link/unlink). Ces fonctions sont extractibles et testables unitairement à faible coût — c'est le meilleur ratio valeur/effort du module.

---

## 5. Recommandations priorisées

| # | Priorité | Effort | Action |
|---|----------|--------|--------|
| 1 | **P1** | S | Corriger la taxonomie de statut : aligner le KPI « Écarts validés » sur `ecart_valide` (ou unifier les deux endpoints de validation) et remplacer `'success'` par `'completed'` dans `PennylaneConfig.jsx`. |
| 2 | **P1** | M | Fiabiliser `autoMatchCommande` : supprimer le motif `\d{4,8}` nu, exiger un score de confiance, ne pas auto-clôturer sur match faible, journaliser chaque décision de rapprochement. |
| 3 | **P1** | L | Extraire les calculs de `finance.js` dans un service dédié et ajouter des tests unitaires (P&L, bilan/ratios, écart, matching). |
| 4 | **P1** | M | Consolider le schéma dans `init-db.js` (ou un module de migration unique), supprimer les colonnes OCR mortes de `factures_exutoires`, et retirer/câbler le code mort (`pennylane_mappings`, `webhook_secret`, flags `sync_*`). |
| 5 | **P2** | M | Factoriser l'insertion GL/transactions : faire appeler `syncGLAuto`/`syncTransactionsAuto` par les routes HTTP ; mutualiser `recomputeFactureEcart`. |
| 6 | **P2** | S | Acquérir la connexion DB **après** `fetchAllPages` dans les syncs Pennylane. |
| 7 | **P2** | M | `enrichGLCategories` : abandon anticipé sur erreurs d'auth répétées, plafond, remontée du statut ; sortir les libellés de centres Pennylane vers `financial_settings`. |
| 8 | **P2** | S | Ajouter `ErrorState` aux tableaux de bord finance, journaliser tous les `catch` backend, valider `:year`, supprimer les endpoints d'import Excel orphelins. |

---

*Rapport d'audit technique — périmètre Finance / Facturation / Pennylane. Constats fondés sur lecture du code au 11/07/2026.*

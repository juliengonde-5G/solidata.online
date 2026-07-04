# Audit exhaustif — Finance / Pennylane / Reporting / Historique / Exports / Dashboards

> Périmètre : modules 12 (Reporting), 22 (Finance), 23 (Pennylane) + dashboard principal, performance, historique, exports.
> Date : 2026-07-03. Auditeur : agent IA — **lecture seule, aucun fichier code modifié**.
> Fichiers : `backend/src/routes/{finance,pennylane,reporting,historique,exports,dashboard,performance}.js`, `routes/settings.js` (objectifs), `scripts/{init-db,migrate-finance}.js`, `middleware/cache.js` ; frontend `pages/{Finance*,Pennylane*,Reporting*,Dashboard*,PerformanceDashboard,DashboardExecutif,BalancePage,ActivityLog}.jsx`, `App.jsx`.

## ACQUIS (corrigés pendant l'audit — non recomptés)
- `/balance` sans ProtectedRoute → c'est un **kiosque de pesée** (scale) qui POST vers `/api/stock-original/balance-entree|sortie` (BalancePage.jsx:270-306), pas une page finance. Public volontaire à confirmer (voir M7).
- Rôle AUTORITE sur `/reporting-collecte` + `/reporting-metropole` : **NB, le code front montre encore `roles=['ADMIN','MANAGER','AUTORITE']`** (App.jsx:188, 193) et backend `reporting.js:6` autorise AUTORITE sur tout le routeur — à revérifier (voir M2).
- `month + '-31'` (exports.js:58) → corrigé via `utils/month-range.js` (`monthBounds`).
- KPI « CO2 évité » ReportingCollecte « kg »→« t » corrigé.

---

## 1. FINDINGS PAR SÉVÉRITÉ

### CRITIQUE
**C1 — `dashboard.js:411` colonne inexistante `kg_entree`.** `/api/dashboard/objectifs` agrège `COALESCE(SUM(kg_entree),0)` sur `production_daily`. La colonne n'existe pas (schéma réel `entree_ligne_kg`/`total_jour_t`, init-db.js:637-641) ; le MÊME fichier le documente l.69-73. Requête inconditionnelle dans le `Promise.all`, **sans `.catch`** → 500 dès qu'un objectif existe (objResult non vide). Consommé par `Dashboard.jsx:145` (try/catch → jauges silencieusement vides). Masqué par cache Redis 120 s + table objectifs souvent vide. **Preuve** : grep confirme `production_daily` n'a pas `kg_entree` ; ReportingProduction.jsx utilise correctement `entree_ligne_kg`. **Correctif** : `SUM(entree_ligne_kg)`.

**C2 — `periodic_objectives` : deux schémas concurrents.** Deux `CREATE TABLE IF NOT EXISTS` :
- `init-db.js:2528` (A) : `section,label,target_value,period('daily'..'yearly'),is_active`.
- `settings.js:186` (B) : `domaine,indicateur,unite,periode('mensuel'|'trimestriel'|'annuel'),annee,mois,trimestre,valeur_cible,commentaire`.
Le 1er `CREATE` gagne, le 2nd est un no-op → schéma dépend de l'ordre de boot (race `require(settings)` fire-and-forget vs `initDatabase()`). Consommateurs (`dashboard.js:380`, `settings.js:208/228`) exigent **B**. `performance.js:222` `/scorecard` fait `WHERE is_active=true ORDER BY indicateur` : `is_active` n'existe QUE dans A, `indicateur` QUE dans B → **cassé dans les deux cas** ; lit aussi `obj.realise` (colonne inexistante partout) → réalisé toujours 0. **Impact** : scorecard mort ; `/objectifs` et CRUD objectifs cassés si A gagne. **Correctif** : supprimer la définition A (init-db.js:2528), garder B, ajouter `is_active` à B.

**C3 — `performance.js:282-287` `insertion_diagnostics.status` inexistant.** `/api/performance/industrial-kpis` fait `COUNT(... WHERE status='completed')` / `status='active' OR status IS NULL` sur `insertion_diagnostics` (aucune colonne `status`, init-db.js:2408-2447). C'est le bug corrigé dans dashboard.js (hotfix V1.5.1) **non répercuté** → 500. Consommé par `PerformanceDashboard.jsx:43` et `ReportingRH.jsx:42` (les deux en `.catch`→ bloc KPI silencieusement vide). **Correctif** : baser sur `employees.insertion_status` comme dans dashboard.js:112-115.

### ÉLEVÉ
**H1 — Attribution mensuelle sensible au fuseau serveur.** `finance.js` P&L (l.480-491), trésorerie (l.748), KPIs mensuels : `new Date(e.date).getMonth()` sur une `DATE` PostgreSQL (parsée minuit UTC) évaluée en heure **locale** → si conteneur pas en UTC, le 1er du mois bascule au mois précédent → ventilation mensuelle P&L/trésorerie décalée. **Correctif** : agréger par mois en SQL (`EXTRACT(MONTH …)`) ou forcer UTC.

**H2 — Watermark Pennylane unique partagé → écritures manquées (incrémental).** `/sync/customer-invoices` calcule `since` depuis `pennylane_config.last_sync_at` (l.528-531) puis fait `last_sync_at=NOW()` (l.653). Mais **le même** `last_sync_at` est aussi avancé par `/test` (connexion, l.396, sans import !), `/sync/gl` (l.800), `/sync/transactions` (l.937), et 2 autres (l.1167, 1268). Un test de connexion ou un sync GL fait donc sauter le `since` des factures clients → les factures **antidatées / saisies tardivement** (filtre sur `date` facture, pas `updated_at`) sont ignorées au pull suivant. Outil de rapprochement → commandes jamais clôturées / écarts jamais calculés, silencieusement. **Correctif** : un watermark par flux (colonne dédiée par `sync_type`) et/ou filtrer sur `updated_at`.

**H3 — Endpoints objectifs/scorecard : échec silencieux direction.** C1+C2 remontent en 500 avalés côté front (`.catch`) → la direction voit « aucun objectif » au lieu d'une erreur. Zéro observabilité.

### MOYEN
**M1 — Sur-permission exports.** `exports.js:9` `authorize('ADMIN','MANAGER','RH')` : RH peut exporter les **factures PDF** (`/exports/invoice/:id`) et tous les exports financiers/tonnages. Restreindre RH aux exports RH (FSE+ déjà correctement `authorize('ADMIN','RH')` l.411).

**M2 — AUTORITE large + mismatch rôle Reporting RH.**
- `reporting.js:6` / `historique.js:6` : AUTORITE sur TOUT le routeur (dashboard, collecte, cav-map, tonnages, KPI). À restreindre au périmètre réellement voulu.
- `/reporting-rh` accordé à ADMIN/RH (App.jsx:189, **sans MANAGER**) mais appelle `/performance/industrial-kpis` = `authorize('ADMIN','MANAGER')` (performance.js:6) → **un RH reçoit 403** (avalé, bloc vide). Incohérence front/back.

**M3 — Requêtes mortes.** `performance.js:213-221` `/scorecard` exécute `collecte`+`production` jamais utilisées. `dashboard.js:561-562` `/executive` : deux `SELECT 1 AS placeholder` (round-trips inutiles). `today`/`monthStart` inutilisés (performance.js:16,253).

**M4 — Cache sans invalidation.** `middleware/cache.js` expose `invalidate()` mais **il n'est appelé nulle part** (grep : 0 occurrence). Dashboard `/kpis`,`/objectifs`,`/executive` : clé bucketée à la minute + TTL 120 s → staleness jusqu'à ~60 s après écriture (fin de tournée, saisie prod) ; clés orphelines (TTL 120 s > bucket 60 s).

**M5 — `.catch(()=>0)` masquant des colonnes fausses (dashboard exécutif).** `dashboard.js` : `boutique_ventes.total_ht/date_vente` (l.564-573), `insertion_milestones.sortie_classification` (l.575-582), `refashion_subventions.montant_total` (l.584-589) — chaque requête a un `.catch` → un nom de colonne erroné affiche **0/null silencieusement** sur l'écran direction, sans alerte. Fiabilité douteuse.

**M6 — `performance.js:19-20` / `dashboard.js:513` N-1 par slice de date.** `prevYearToday="${year-1}-${today.slice(5)}"` : le 29/02 bissextile produit un `AAAA-02-29` invalide en N-1 → erreur SQL 1 jour/an.

**M7 — Kiosque `/balance` non authentifié.** `App.jsx:118` `/balance` hors ProtectedRoute → si `/api/stock-original/balance-entree|sortie` (POST) n'exige pas d'auth, surface d'écriture publique sur le stock. À confirmer volontaire + rate-limit.

### FAIBLE
**L1** — CLAUDE.md §6 obsolète : tables Finance listées `financial_periods, financial_entries` inexistantes ; réel (migrate-finance.js) = `financial_exercises, financial_gl_entries, financial_transactions, financial_budgets, financial_operational_data, financial_import_logs, financial_settings`.
**L2** — `exports.js:249` interpole `${parseInt(year)}` (non injectable mais déroge au paramétré).
**L3** — Export `kpi-production` (exports.js:332) : feuille annuelle écrit 4 cellules pour 6 colonnes d'en-tête (Objectif/Diff vides).
**L4** — `pennylane_sync_log.direction` DEFAULT `'push'` (l.273) : legacy trompeur, tous les flux sont `'pull'`.
**L5** — Unités mixtes dashboard exécutif : `tonnage_collecte_mois` en **kg** (dashboard.js:649) sur un écran direction qui attend des tonnes.

---

## 2. PROMESSE vs RÉALITÉ (bout en bout)

| Promesse | Réalité (route + calcul) | Verdict |
|---|---|---|
| P&L analytique | `finance.js:405` groupe cl.6/7 par `category` Pennylane, sous-lignes par `analytical_code`, budget, dédup file>api. | OK (réserve H1) |
| Bilan / SIG / ratios | `finance.js:560` actif/passif par préfixe de compte, ratios marge/liquidité/BFR/autonomie, seuil de rentabilité. | OK |
| Trésorerie | `finance.js:726` comptes 512 mensuels + waterfall + cash-flow par axe. | OK (réserve H1) |
| Contrôle gestion / rentabilité matière | `finance.js:1213` coût complet Collecte→Tri, FG au prorata tonnage, marge/qualité, fallbacks tours/prod. | OK |
| Contrôles cohérence | `finance.js:1396` 7 contrôles (import, comptes, montants, équilibre débit=crédit, analytique). Bien pensé. | OK |
| Pennylane **PULL-only** GL/balances/factures clients, incrémental `last_sync_at`, **pas de push** | `sync/gl` (676), `sync/transactions` (850), `sync/balances` GET calculé du GL local (959), `sync/customer-invoices` incrémental (522). Aucun POST push. 429 retry + backoff (110-123), pagination curseur (144), AES-256-CBC (40). | OK sauf watermark (H2) |
| Reporting Collecte/Production/RH/Métropole | reporting.js (dashboard/collecte/cav-map) + pages RH/Métropole/Production ailleurs ; vues matérialisées utilisées. | OK partiel |
| KPIs RH formation/ETP 1607h/absentéisme | `/employees/kpi/{formation,etp,absenteisme}` consommés par ReportingRH. | OK (hors scope détaillé) |
| Historique mensuel | historique.js OK (tonnages/summary/produits/KPI), seed auto si vide (index.js:574). | OK |
| Exports | Excel collecte/production/CAV/tonnages/KPI/stock + PDF facture + **CSV FSE+**. **Pas d'export FEC.** | Partiel |
| Dashboard KPIs cache + objectifs | KPIs OK (cache) ; **objectifs cassés (C1)**, scorecard mort (C2), industrial-kpis 500 (C3). | KO objectifs/perf |

**Pennylane — points forts confirmés** : gestion 429 robuste (Retry-After header + parse body « retry in N seconds » + backoff exp., 5 essais), pagination curseur `has_more/next_cursor` avec throttle 350 ms, chiffrement clé API AES-256-CBC (IV aléatoire), enrichissement catégories analytiques via `/ledger_entry_lines/{id}/categories`, imports en transaction avec rollback, upsert idempotent factures (skip par `pennylane_invoice_id`), rapprochement auto commandes + bascule `cloturee`. **Faiblesse** : token expiré (401) non distingué du reste (throw générique) — message utilisateur peu clair, non bloquant.

## 3. SIMPLICITÉ D'USAGE (direction non technicienne)
- Jargon comptable brut (BFR, SIG, MCV, classes 6/7) acceptable en pages Finance mais dense.
- Dashboard exécutif : unités mixtes (L5), trésorerie volontairement `null` (« à connecter ») → carte vide non explicite, et 3 KPI en `.catch→0` peuvent afficher 0 sans signaler l'indisponibilité (M5).
- Exercice = année civile fixe (pas d'exercice décalé paramétrable).

## 4. OPTIMISATIONS
1. **Corriger/retirer les requêtes mortes** (M3) et les 2 placeholders `/executive`.
2. **Vues matérialisées** : reporting.js les exploite (`mv_collecte_mensuelle`, `mv_cav_stats`, `mv_rh_stats`) ; **Finance et dashboard exécutif recalculent les agrégats GL à chaque appel** — candidats à une MV annuelle (`mv_finance_pl_annuel`).
3. **Cache** : brancher `invalidate('dashboard:*')` sur les écritures clés (fin tournée, saisie prod) plutôt qu'un TTL aveugle ; ou agréger en SQL et servir depuis MV.

## 5. ÉVOLUTIONS
1. **Export FEC** (obligation fiscale) — absent (seul FSE+ CSV existe) : réutiliser `financial_gl_entries` déjà normalisé.
2. **Budget vs réalisé** : donnée présente (`financial_budgets`, écarts YTD calculés finance.js:1128) mais pas d'écran de pilotage dédié.
3. **Alertes trésorerie** proactives : `alert_thresholds` existe et est évalué (`dashboard.js:633`) mais la trésorerie exécutive n'est pas branchée sur Pennylane (`tresorerie=null`).
4. **RSE/CO2 dashboard exécutif** : facteur ADEME 1.567 déjà utilisé (dashboard.js:621, reporting.js:83) → consolider un axe RSE (CO2 évité, taux de réemploi) durable.

## 6. QUICK WINS SÛRS
- C1 : `kg_entree` → `entree_ligne_kg` (dashboard.js:411). 1 mot.
- C3 : industrial-kpis → `employees.insertion_status` (copier dashboard.js:112-115).
- C2 : supprimer la définition A `periodic_objectives` (init-db.js:2528) + ajouter `is_active BOOLEAN DEFAULT true` au schéma B, corriger `obj.realise` de scorecard.
- M3 : retirer les 2 `SELECT 1 placeholder` + les requêtes collecte/production inutilisées du scorecard.
- M1 : retirer RH de `exports.js:9` (garder ADMIN/MANAGER ; FSE+ reste `ADMIN/RH`).

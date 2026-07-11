# Audit technique — Module « Refashion, Métropole & reporting réglementaire »

**Date** : 11 juillet 2026
**Périmètre** : `backend/src/routes/{refashion.js, metropole.js, communes.js, historique.js, reporting.js, exports.js}`, vues SQL et tables associées dans `backend/src/scripts/init-db.js`, pages `Refashion`, `AdminRefashionExports`, `AdminRefashionConfig`, `AdminCommunes`, `Reporting`, `ReportingCollecte`, `ReportingProduction`, `ReportingRH`, `ReportingMetropole`.
**Nature** : qualité de code, dette technique, sécurité, robustesse, testabilité.

---

## 1. Synthèse

Le socle backend est **globalement bien construit** : requêtes paramétrées partout, transactions correctes sur les écritures multi-tables, audit-trail DPAV, taux de subvention versionnés par convention, gestion RGPD soignée des exports d'insertion, et une whitelist qui protège la génération dynamique de vues. En revanche, la **couche « chiffres réglementaires » n'est pas fiable** : deux KPI destinés à la Métropole/DREETS sont faux ou cassés, deux des cinq exports DPAV sont structurellement vides, et le contrat front/back de la page Refashion a dérivé. Le tout sur une surface **quasi non testée** (seul `reporting.js` a des tests). Le module fait illusion de complétude alors que plusieurs valeurs remontées à Refashion, à la Métropole et au FSE+ ne sont pas vérifiées.

**Note : 6/10.**

---

## 2. Ce qui est bien conçu (forces)

- **Patterns respectés** : `authenticate` + `authorize(...)` au niveau du router sur les 6 fichiers, requêtes `$1/$2` paramétrées, erreurs en `res.status().json()`. Aucune injection SQL classique détectée.
- **Transactions et idempotence** : `refashion.js` POST `/dpav` et POST `/taux` (BEGIN/COMMIT/ROLLBACK + `client.release()` en `finally`), `communes.js` `/refresh-metropole` et `/import` (upserts `ON CONFLICT ... DO UPDATE` avec `COALESCE` non destructif). La clôture automatique du taux précédent (`refashion.js:164-170`) est propre.
- **Audit-trail & versioning** : `refashion_dpav_history` (snapshot JSONB par INSERT/UPDATE, `refashion.js:114-118`) et `refashion_taux_subvention` versionné par validité temporelle (`valid_from`/`valid_to`) sont de bons choix de conformité.
- **Sécurité des vues dynamiques** : `EXPORT_VIEWS` (`refashion.js:224-253`) mappe des slugs vers des noms de vue en dur → pas d'injection possible sur `FROM ${view}` ; `annee` filtré par `parseInt`, `trimestre` par regex `/^[1-4]$/`.
- **RGPD** : `exports.js` `/insertion` (données sensibles freins santé/social) est resserré à ADMIN/RH, ajoute une feuille d'avertissement RGPD, et dégrade requête par requête via le helper `soft()` (`exports.js:527`) sans casser l'export. `/fse-plus` idem restreint ADMIN/RH.
- **Reporting** : `reporting.js` gère les vues matérialisées avec fast-path + fallback (`mvExists`), valide la période (`period` 1-3650), et possède une **vraie couverture de tests** (`backend/tests/unit/routes/reporting.test.js` : 401/403/200, structure imbriquée, période invalide 400).
- **Conscience de la dette** : le correctif documenté du produit cartésien de `vw_dpav_communes` (`init-db.js:1713-1720`) montre que l'équipe sait détecter ce type de bug.

---

## 3. Constats critiques (correctness réglementaire)

### 3.1 `/metropole/sortie-dynamique` interroge des colonnes inexistantes — KPI DREETS cassé (P1)
`metropole.js:308-325` filtre `im.type = 'sortie'`, `im.statut = 'realise'`, `EXTRACT(YEAR FROM im.date_realisation)`. Or la table `insertion_milestones` (`init-db.js:2685`, dupliquée à l'identique dans `routes/insertion/index.js:109`) n'a **ni `type`, ni `statut`, ni `date_realisation`** : les colonnes réelles sont `milestone_type` (valeur `'Bilan Sortie'`), `status` (`'realise'`), `completed_date`. Partout ailleurs le code utilise correctement `status='realise'` (`insertion/routes.js:640`, `exports.js` FSE+). Cet endpoint renvoie donc **systématiquement une 500** (`column im.type does not exist`), masquée côté front par `.catch(() => ({ data: null }))` (`ReportingMetropole.jsx:33`). Le « taux de sortie dynamique » (indicateur ASP/DREETS) est **silencieusement vide**.

### 3.2 `/metropole/captation-par-commune` double-compte le tonnage (P1)
`metropole.js:363-385` joint `tours × tour_weights × tour_cav` puis `SUM(tw.weight_kg)` groupé par commune. Comme `tour_weights` (n pesées) et `tour_cav` (m CAV collectés) sont joints sur le seul `tour_id`, le produit cartésien compte **chaque pesée m fois** et l'attribue à chaque commune → tonnage et `kg_par_hab` gonflés d'un facteur ~nb_cav. C'est **exactement le bug corrigé** dans `vw_dpav_communes` via des CTE séparées (`init-db.js:1721-1744`), mais la correction n'a pas été reportée sur cette route, elle aussi consommée par `ReportingMetropole.jsx`. La donnée présentée à la Métropole est fausse.

### 3.3 Deux exports DPAV structurellement vides (P1)
`vw_dpav_sortants` et `vw_coherence_tri_filiere` dépendent de la table `colisages`, **non adoptée** (la sortie carton réelle passe par `produits_finis` / scan douchette) — commentaire explicite `init-db.js:1689-1695`. Ces deux vues renvoient donc toujours 0 ligne. Or elles sont exposées dans `AdminRefashionExports.jsx` (slugs `dpav-sortants`, `coherence-tri-filiere`) : **2 des 5 exports « DPAV Refashion » affichent en permanence « Aucune ligne »**. Le reporting sortants/filière n'existe pas réellement.

### 3.4 Contrat front/back rompu sur la page Refashion (P2)
`Refashion.jsx` lit des champs que l'API n'émet pas :
- `dpav.total_t` (`:79`) et `dpav.details` (`:86`) → l'endpoint `/refashion/dpav` renvoie `tri_t`, `entree_t`, `raw`, `history` mais **jamais** `total_t` ni `details` → « Tonnage total » toujours à 0, tableau de détail jamais rendu.
- Cartes DPAV avec taux **codés en dur** `80/295/210/20/193 €/t` (`:64-68`) qui contredisent le modèle réellement calculé (taux unique €/t entrant, `refashion.js:50-53`).
- Onglet Communes : affiche `c.population` (jamais envoyé → toujours « — ») et libellé « Code INSEE » sur une valeur qui est en fait le **code postal** (le backend fait `rc.code_postal as code_insee`, `refashion.js:274`).

---

## 4. Dette technique

- **Deux modèles de subvention concurrents.** Le legacy `refashion_subventions` (POST `/subventions`, calcul par filière avec taux en dur `refashion.js:348-352`) coexiste avec le modèle courant à taux unique `refashion_taux_subvention` (utilisé par `/dpav` et `vw_subvention_refashion_mensuelle`). Le premier reste câblé à l'onglet « Subventions » de `Refashion.jsx` : confusion métier et double source de vérité.
- **Page morte `Reporting.jsx`.** La route `/reporting` redirige vers `/reporting-collecte` (`App.jsx:195`) ; `Reporting.jsx` (~150 lignes) lit encore l'ancien contrat plat (`collecte_tonnage`, `co2_saved`, `tours_by_status`, `production_trend`…) que l'endpoint ne renvoie plus (structure désormais imbriquée). Code mort à supprimer — `ReportingCollecte.jsx` l'a remplacé et lit correctement `dashboard.tours?.completed`, `dashboard.cav?.actifs`.
- **Facteur CO2 `1.567` en valeur magique dupliquée** dans `reporting.js:83`, `dashboard.js:621-622` et `ReportingCollecte.jsx:53`, tandis que `metropole.js:40` calcule à partir d'un mix observé (`FACTEURS_CO2` + colisages, sinon fallback 40/35/15/10). Résultat : le « CO2 évité » diffère d'une page à l'autre pour le même indicateur, sans helper partagé.
- **Divergence schéma dupliqué** : `insertion_milestones` est défini deux fois (init-db.js et insertion/index.js) — à l'identique aujourd'hui, mais toute évolution devra être répercutée aux deux endroits (source de bugs comme 3.1).
- **`ReportingProduction`/`ReportingRH` hors périmètre reporting** : ils tapent `/production/*` et `/employees/*` et n'utilisent ni `reporting.js` ni `historique.js` — le nommage « Reporting » est trompeur sur la provenance des données.

---

## 5. Sécurité & robustesse

- **`communes.js` GET `/`** n'a pas d'`authorize` (seulement `authenticate`) : tout utilisateur connecté (y compris COLLABORATEUR/RESP_BTQ) lit le référentiel communes. Faible sensibilité (données INSEE publiques) mais incohérent avec le reste du module (ADMIN/MANAGER).
- **Interpolation SQL non paramétrée** dans `exports.js:249` : `AND EXTRACT(YEAR FROM th.date) = ${parseInt(year)}`. Sûr grâce à `parseInt` (pas d'injection), mais déroge à la règle projet et casse (SQL `= NaN`) si `year` n'est pas numérique.
- **Fuite de message d'erreur** : `refashion.js:125,181,203` et `exports.js:680` renvoient `err.message`/`detail` au client. Portée ADMIN/MANAGER/RH donc impact faible, mais incohérent avec l'effort de « de-leak » mené ailleurs (cf. historique V1.4.2).
- **Export de conformité silencieusement vide** : la requête FSE+ est enveloppée dans `.catch(() => ({ rows: [] }))` (`exports.js:464`). Une colonne manquante produirait un **CSV réglementaire vide sans aucun signal** — risque pour un livrable DGEFP/FSE+.
- **Robustesse générale correcte** : catch systématiques avec log `console.error` + 500 générique ; dégradations gracieuses (`metropole.js` mix observé → fallback, `historique_mensuel` fallback dashboard, `qrScans` optionnel). Quelques `catch (_) {}` muets (`metropole.js:66,124,146`) acceptables ici mais masquent d'éventuelles anomalies.
- **Perf** : `/metropole/cav` et le fallback `/reporting/cav-map` utilisent des sous-requêtes corrélées par CAV sur `tonnage_history` (3+ scans/CAV). Acceptable à ~200 CAV, à surveiller si l'historique grossit ; la vue matérialisée `mv_cav_stats` mitige déjà `cav-map`.

---

## 6. Testabilité

Seul `reporting.js` est testé (`reporting.test.js`, 121 lignes, mocks `pool.query`). **`refashion.js`, `metropole.js`, `communes.js`, `historique.js`, `exports.js` n'ont aucun test** — ce sont pourtant précisément les endpoints qui calculent des chiffres de conformité (DPAV, captation, sortie dynamique, FSE+) et où logent les bugs 3.1–3.3. Le smoke test de déploiement ne couvre visiblement pas `/metropole/sortie-dynamique` (sinon la 500 aurait bloqué un déploiement).

---

## 7. Recommandations priorisées

| # | Priorité | Effort | Action |
|---|----------|--------|--------|
| 1 | **P1** | S | Corriger `/metropole/sortie-dynamique` : `milestone_type='Bilan Sortie'`, `status='realise'`, `completed_date` (aligner le jeu de valeurs `sortie_type`). |
| 2 | **P1** | M | Corriger le double-comptage de `/metropole/captation-par-commune` (CTE séparées poids/nb_cav comme `vw_dpav_communes`, ou requêter directement la vue). |
| 3 | **P1** | M | Trancher `colisages` : soit l'adopter, soit repointer `vw_dpav_sortants` et `vw_coherence_tri_filiere` sur `produits_finis` (mapping `famille_refashion`) pour que les 2 exports DPAV produisent des données. |
| 4 | **P2** | S | Réparer le contrat de `Refashion.jsx` (`total_t`/`details`/`population`, taux en dur) et corriger l'alias `code_postal as code_insee` dans `refashion.js:274`. |
| 5 | **P2** | S | Supprimer la page morte `Reporting.jsx` (ou la re-router et corriger le contrat plat). |
| 6 | **P2** | S | Centraliser facteurs CO2 + mix dans un util partagé consommé par toutes les pages/routes ; supprimer les `1.567` dispersés. |
| 7 | **P2** | M | Consolider les deux modèles de subvention (retirer `refashion_subventions` ou séparer clairement legacy/courant). |
| 8 | **P2** | M | Ajouter des tests sur les endpoints réglementaires (`sortie-dynamique`, `captation-par-commune`, `refashion/dpav`, `exports/fse-plus`), avec assertions sur les chiffres. |
| 9 | **P2** | S | Ne pas avaler silencieusement l'erreur de la requête FSE+ : remonter une 500 ou un en-tête d'avertissement si l'export de conformité est vide sur erreur. |

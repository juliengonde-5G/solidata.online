# Audit technique — Module « Boutiques seconde main »

**Date :** 11 juillet 2026
**Périmètre :** `backend/src/routes/{boutiques,boutique-ventes,boutique-commandes,boutique-objectifs,boutique-meteo}.js`, pages `BoutiquesDashboard/Ventes/Commandes/Planning/Objectifs/Import`, schéma `init-db.js` (tables 1→9), scheduler.
**Score global : 6 / 10** — module riche et globalement conforme aux patterns du projet, mais fragilisé par une confusion HT/TTC systémique, un import cœur de module non transactionnel, un risque d'intégrité sur la clé ticket, l'absence totale de tests et le manque de cloisonnement par boutique.

---

## 1. Qualité & cohérence

Le module respecte bien les conventions SOLIDATA : `express.Router`, `router.use(authenticate)` en tête, `authorize(...)` sur les écritures, **SQL entièrement paramétré** ($1/$2). L'`UPDATE` dynamique de `boutiques.js` (l. 104-126) construit ses fragments à partir d'une **whitelist de colonnes** codée en dur — pas d'injection possible malgré la concaténation. Les pages React suivent le pattern hooks (`useState/useEffect/useMemo`), lazy-loadées dans `App.jsx` (l. 82-86), avec filtres cumulables et deltas N-1 propres.

Points de dette de cohérence :
- **Duplication front** : `SEGMENT_LABELS`, `SEGMENT_COLORS`, `formatEuro`, `weatherIcon` sont redéfinis dans `BoutiquesDashboard.jsx` et `BoutiquesVentes.jsx` (et vraisemblablement les pages VAK). À factoriser en module partagé.
- **`boutique-ventes.js` fait 916 lignes** et mélange parsing CSV, logique d'import, 10 endpoints analytics et le webhook. La logique de parsing (`parseCSVDate`, `getSegment`, `minuteKey`, `extractCSVDateRange`, autodétection de format) mériterait d'être extraite dans `utils/` — actuellement elle n'est ni exportée ni testable.
- **Valeurs magiques** : coordonnées de repli `49.4431 / 1.0993` dupliquées (`boutique-meteo.js` l. 107-108 et `scheduler.js` l. 754-755), plages horaires codées en dur (DayView 8→21h, heatmap 8→20h), `LIMIT` 100/200/500 et `CHUNK 500` non nommés.

## 2. Confusion HT / TTC (défaut de correction — priorité haute)

Défaut le plus impactant car il fausse l'indicateur phare en permanence. Le **réalisé est calculé en TTC** (`SUM(total_ttc)`) mais est **comparé à des objectifs saisis en HT** (`ca_objectif_ht`) et **affiché sous des libellés « HT »** :
- `boutiques.js` GET `/:id/budget` (l. 158-184) : `ca_total_realise` somme du TTC, `ca_total_objectif` somme du HT → % budget faux.
- `boutique-objectifs.js` `/compare` (l. 43-53) : `ventes` en `SUM(total_ttc)` opposées aux objectifs HT.
- Front : `BoutiquesDashboard.jsx` affiche `kpis.ca_ttc` sous « CA HT du jour » (l. 258) et « CA HT réalisé » (l. 377) ; le **% atteinte** (l. 349) et le détail annuel (l. 539-540) divisent du TTC par du HT → attractivité gonflée d'environ le taux de TVA. `BoutiquesVentes.jsx` (l. 138) et `BoutiquesObjectifs.jsx` (l. 147) font de même.

Incohérence interne aggravante : dans `analytics/kpis`, le **panier moyen** utilise `AVG(total_ht)` (l. 630) alors que le CA de la même carte est en TTC. Le endpoint renvoie pourtant `ca_ht` disponible : il suffirait de brancher la bonne base. À trancher globalement (recommandation : tout en HT, cohérent avec les objectifs).

## 3. Dette technique & robustesse

**Import non transactionnel (critique).** `importCSVContent` (`boutique-ventes.js` l. 89-303) exécute toutes ses écritures via `pool.query` **sans transaction** : insertion du batch (avec `file_hash` posé, l. 140-146), upserts tickets, inserts ventes par paquets, puis `UPDATE` final du batch. Un échec en cours de route laisse un **import partiel**, un batch bloqué en `statut='en_cours'`, et surtout le `file_hash` déjà enregistré — ce qui fait **rejeter tout rejeu** du même fichier (l. 92-103, retour `duplicate`). La fonction est appelée par le webhook et le scheduler : une panne réseau DB au milieu d'un import laisse des données incohérentes non ré-importables sans intervention manuelle. À encapsuler dans un `client` + `BEGIN/COMMIT/ROLLBACK`, et à ne considérer le fichier comme importé qu'au succès.

**Clé ticket sans date (risque d'intégrité).** La clé de regroupement est `T${numTicket}` (l. 208) **sans composante date**, stockée dans `minute_key` sous contrainte `UNIQUE(boutique_id, minute_key)`. L'`UPSERT` est **accumulatif** (`total_ttc = boutique_tickets.total_ttc + EXCLUDED.total_ttc`, l. 247-249). Si la caisse LogicS **réinitialise sa numérotation par jour/session** (hypothèse plausible mais non vérifiée), un `T0001` du mardi vient s'**agréger au ticket du lundi** et les ventes du mardi sont rattachées au ticket de lundi → nombre de tickets sous-estimé, panier moyen faussé, CA mal daté. À sécuriser en préfixant la clé par la date (`YYYY-MM-DD-T<num>`).

**N+1 sur l'upsert tickets.** Boucle `for … await pool.query(INSERT…)` (l. 242-254) : un aller-retour par ticket. Les *ventes* sont bien bulk-insérées par paquets de 500 (l. 257-278) mais pas les tickets — un import mensuel peut générer des milliers de requêtes séquentielles. Convertir en `INSERT … VALUES (…) ON CONFLICT` groupé.

**Divergences schéma.** `boutique_objectifs` déclare encore `ca_objectif_ttc DECIMAL NOT NULL` dans le `CREATE TABLE` (init-db.js l. 3742) avant d'être renommé en `ca_objectif_ht` par une migration `DO $$` (l. 3826-3839) : sur base neuve la colonne est créée puis renommée, le schéma canonique reste trompeur. Le `CHECK` de `segment` (l. 3745-3746) n'autorise que `global/ventes_courantes/promotions` — **exclut `consommables`** alors que les ventes le produisent, donc aucun objectif « consommables » possible et un `POST` avec ce segment lèverait une violation de contrainte remontée en `500` générique (aucune validation `isIn` côté `express-validator`).

**Observabilité.** Plusieurs `catch` renvoient `{ error: 'Erreur' }` **sans `console.error`** : `analytics/segments` (l. 519-521), `articles` (l. 548-550), `panier-moyen` (l. 571-573), `boutique-objectifs` DELETE (l. 155-157). Debug prod difficile. Côté front, `loadDay/loadMonth` (Dashboard) utilisent un `Promise.all` non résilient : un seul endpoint en échec vide tout l'onglet, et l'erreur n'est que `console.error` (pas de message utilisateur).

**Concurrence.** `generateReference` (`boutique-commandes.js` l. 23-33) calcule `MAX(reference)+1` sans verrou : deux `POST` concurrents peuvent viser la même référence (échec sur l'unique, remonté en `500`). `/ajuster` (l. 332-362) écrit et **commite** les poids ajustés dans une première transaction *avant* d'appeler `checkAndTransition` (seconde transaction) : le changement de poids et le changement de statut ne sont pas atomiques.

## 4. Sécurité

**Absence de cloisonnement par boutique.** Toutes les routes lecture ne portent qu'`authenticate` (pas d'`authorize`), et **aucune** ne vérifie `boutiques.responsable_id` contre `req.user`. Un `RESP_BTQ` (rôle censé « gérer *sa* boutique ») peut, en changeant `boutique_id`, lire les ventes d'une autre boutique ou créer/annuler une commande pour elle (`boutique-commandes.js` POST autorise `RESP_BTQ` sans filtrer la boutique). Avec 2 boutiques et un rôle interne de confiance l'impact est modéré, mais le modèle affiché n'est pas appliqué.

**Webhook public.** `POST /webhook-email` (l. 830) est monté **avant** `authenticate` (l. 30-33) et protégé par un secret partagé en header, comparé par `provided !== secret` (l. 841) — **non constant-time** (fuite de timing), sans rate-limiting. Contrairement au webhook VAK (HMAC signé), c'est un modèle plus faible ; à durcir via `crypto.timingSafeEqual`. La taille de corps (`express.json limit: '10mb'`) couvre bien les CSV base64.

**Points positifs sécurité :** upload verrouillé (`csvFilter` extension+MIME, limite 20 Mo, nom de fichier assaini l. 18, fichier temporaire supprimé après import y compris en erreur l. 320-324), webhook n'important que les `.csv` (l. 893), SQL paramétré partout.

## 5. Testabilité

**Aucun test** ne couvre le module (aucun `*boutique*.test.js` ; la suite backend teste billing/tri/stock/sumup mais pas les boutiques). C'est le point le plus préoccupant vu les enjeux financiers : le parseur CSV (deux formats, dates FR, décimales virgule, reconstruction de tickets, détection de format sans en-tête) est de la **logique pure, hautement testable**, mais non exportée. Priorité : extraire ces helpers et écrire des tests sur des extraits LogicS réels (10 et 11 colonnes), la déduplication (`file_hash` + overlap `daterange`), et la clé ticket.

## 6. Ce qui est bien conçu

- **Idempotence d'import réfléchie** : SHA-256 du contenu + détection d'overlap de plage via `daterange && daterange` (l. 112-121), statuts de batch explicites, option `force` documentée côté UI (dialogue de confirmation).
- **Transactions correctes** sur les écritures commandes (POST/PUT/`ajuster`/DELETE batch) et objectifs `bulk`, avec `ROLLBACK`.
- **State machine centralisée** (V5.3) + verrou pessimiste `FOR UPDATE` anti-course sur les transitions de commande, double audit métier (`boutique_commande_historique`, dans la TX) et transverse (post-commit best-effort).
- **Indexation soignée** : index composites `(boutique_id, date_vente)` / `(boutique_id, date_ticket)`, index partiels `num_ticket`, FK indexées, `ON DELETE CASCADE` migré proprement.
- **Dégradation gracieuse météo** (200 + `points: []`), webhook tolérant à 4 formes de payload Power Automate.

## 7. Recommandations priorisées

| # | Priorité | Effort | Action |
|---|----------|--------|--------|
| 1 | P0 | M | Unifier la base HT/TTC (choisir HT pour CA, objectifs, panier, budget), corriger les libellés et le calcul de % atteinte. |
| 2 | P1 | M | Encapsuler `importCSVContent` dans une transaction ; ne poser le `file_hash`/statut `termine` qu'au succès, nettoyer le batch en échec. |
| 3 | P1 | S | Préfixer la clé ticket par la date (`<YYYY-MM-DD>-T<num>`) pour éliminer le risque de fusion inter-jours. |
| 4 | P1 | S | Corriger `deleteBatch` (`BoutiquesImport.jsx` l. 98) : `await confirm({...})` au lieu de `confirm('...')` (voir constat). |
| 5 | P1 | M | Cloisonner par boutique : helper vérifiant `responsable_id`/`team_id` pour `RESP_BTQ` en lecture et écriture. |
| 6 | P2 | M | Extraire les helpers de parsing dans `utils/` + suite de tests unitaires sur CSV LogicS réels. |
| 7 | P2 | S | Durcir le webhook (`timingSafeEqual`, rate-limit, log de source) ; logguer les rayons inconnus dans `getSegment` ; borner `limit/offset`. |
| 8 | P2 | M | Dette schéma/DRY : `CREATE TABLE` déclarant `ca_objectif_ht`, `CHECK` segment incluant `consommables`, upsert tickets en bulk, factorisation des constantes front. |

---

### Constat annexe — suppression de batch sans confirmation

`BoutiquesImport.jsx` l. 97-106 : `deleteBatch` fait `if (!confirm('Supprimer ce batch…'))`. Or `confirm` provient de `useConfirm()` (l. 9) : il attend un **objet d'options** et retourne une **Promise**. Appelé avec une chaîne et évalué de façon synchrone, `!Promise` vaut toujours `false` → la garde ne se déclenche jamais et la **suppression en cascade** (ventes + tickets + batch, transactionnelle mais irréversible) part **immédiatement, sans confirmation**. Le chemin d'écrasement d'import (`handleUpload`, l. 66-71) utilise pourtant `await confirm({...})` correctement — l'incohérence confirme l'oubli. Gated ADMIN/MANAGER, mais destructeur.

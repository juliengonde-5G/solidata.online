# Audit technique — Module Vente au Kilo (VAK) & intégration SumUp

**Date :** 11 juillet 2026
**Périmètre :** `backend/src/routes/vak.js` (842 l.), `backend/src/services/sumup.js` (898 l.), schéma DB (`init-db.js` l.3844-3982), pages `VakPerformance` / `VakAnnuel` / `VakSessions` / `VakLive` / `VakJournee` / `VakSumupConfig`, tests (`backend/tests/unit/services/sumup.test.js`).
**Nature :** qualité de code & dette technique. Aucune modification effectuée.

---

## 1. Vue d'ensemble

Module récent (v2.1.0, mai 2026, corrigé en v2.6.0) globalement **bien structuré** : séparation nette entre contrôleurs minces (`vak.js`) et logique métier (`sumup.js`), SQL intégralement paramétré, sécurité SumUp soignée, idempotence pensée (UPSERT + dedup CSV). Il reste au-dessus du niveau historiquement observé sur le projet. Trois zones fragilisent l'ensemble : un **bug de classification de paiement côté front**, l'**absence de transactions** sur les écritures multi-tables, et une **asymétrie de clés étrangères** qui désynchronise silencieusement les données.

---

## 2. Points forts (à préserver)

- **Sécurité de l'intégration SumUp solide** (`sumup.js`) : secrets chiffrés AES-256-GCM au repos (l.45-65), tokens **jamais renvoyés au client** (`getConnectionStatus` n'expose que des métadonnées, l.104-112), validation HMAC en **temps constant** (`crypto.timingSafeEqual`, l.256-266) tolérant le préfixe `sha256=`, `state` CSRF à usage unique avec TTL 10 min (`vak.js` l.66-82).
- **Webhook monté avant `authenticate`** (l.88) puis validé HMAC — le bon pattern pour un endpoint public signé. Le `rawBody` est capturé proprement dans `index.js` (l.74).
- **`authenticate` + `authorize` cohérents** sur 100 % des routes privées : config SumUp en `ADMIN`, analytics en `ADMIN`/`MANAGER`. Aucun `authorize` manquant.
- **SQL 100 % paramétré** ($1,$2…), **aucune injection**. Les helpers de classification paiement (`payIsCb`, `payLabel`, `payCategorie`, l.40-43) interpolent uniquement des **noms de colonnes constants et contrôlés**, avec commentaire explicite — usage acceptable et documenté.
- **Idempotence** : `ON CONFLICT (vak_id, ref_transaction)` (ticket), dedup CSV par SHA-256, schéma `CREATE TABLE IF NOT EXISTS`. Le trick `RETURNING (xmax = 0) AS inserted` (l.771) distingue insert/update pour ne pousser en Socket.IO que les vraies nouveautés — élégant.
- **Index bien placés** sur les chemins chauds : `idx_vak_tickets_vak_date`, `idx_vak_ventes_segment/paiement/ticket` (l.3914-3944).
- **UX homogène** : composants partagés (`Layout`, `PageHeader`, `KpiCard`, `Modal`, `FormField`, `useToast`, `useConfirm`), gestion GMT/UTC cohérente et **testée** (`parseFRDate`).

---

## 3. Constats — Qualité & cohérence

- **Bug de classification paiement côté front (P1).** `getPaymentCategory` dans `VakPerformance.jsx` (l.68-73) ne reconnaît que `visa`/`mastercard`/`carte`. Or, depuis la v2.6.0, le backend **normalise tout paiement carte en `'CB'`** (`normalizePaymentMethod`) et `/analytics/payments` renvoie ce libellé via `payLabel`. `getPaymentCategory('CB')` retombe donc sur `'autre'` : le camembert « Mix moyens de paiement » (l.122-133) affiche **le CA carte en « Autre » et « Carte bancaire » à 0 €**. La même fonction existe dans `VakJournee.jsx` (l.43-48, 127-132) mais y est **code mort** (le rendu utilise `k.ca_cb`/`k.ca_especes` calculés en SQL). `VakAnnuel`, lui, consomme la catégorie calculée par le backend (`payCategorie`) et reste correct — ce qui confirme que la duplication front est la source du défaut.
- **Duplication de helpers front.** `formatEuro`, `formatNumber`, `weatherIcon`, `SEGMENT_LABELS`/`SEGMENT_COLORS` sont recopiés à l'identique dans 4-5 pages VAK. À factoriser dans un module partagé.
- **`SELECT *` fragile** sur `GET /:id/tickets` et `/:id/ventes` (l.694, 706) ; `/:id/tickets` a une `LIMIT 1000` en dur sans pagination (alors que `/ventes` gère `limit/offset`).
- **Taille des fichiers raisonnable** (routes 842 l., service 898 l., pages 290-457 l.) — pas de dette de volume.

---

## 4. Constats — Dette & robustesse

- **Import CSV non transactionnel + hash posé trop tôt (P1).** `importCSVContent` (`sumup.js` l.370-571) insère le `file_hash` (l.392) **avant** de traiter les lignes, puis enchaîne upserts tickets, `DELETE`, inserts ventes et `UPDATE` batch **sans `BEGIN/COMMIT`**. Un échec en cours de boucle laisse des **données partielles** ET, le hash étant déjà enregistré, **bloque tout ré-import du même fichier** (`duplicate: true`) : l'import est irrécupérable sans intervention DB.
- **Écritures multi-tables sans transaction dans `ingestSumUpTransaction` (P2).** Upsert ticket → `DELETE FROM vak_ventes` → N inserts (l.756-789) hors transaction : un échec entre le DELETE et les inserts laisse un ticket **sans lignes**. L'erreur est **avalée** (`catch → return false`, l.805-808) et comptée en « skipped », sans alerte.
- **Asymétrie FK sur suppression de batch (P1/P2).** `vak_tickets.batch_id` est `ON DELETE SET NULL` (l.3908) mais `vak_ventes.batch_id` est `ON DELETE CASCADE` (l.3922). La route `DELETE /csv-batches/:batchId` (`vak.js` l.751) — exposée sans confirmation dans `VakSessions` (l.300-309) — **efface les lignes de vente mais conserve les tickets** : les KPI ticket (`ca_ttc`, poids) restent, mais les analyses par **segment** (issues de `vak_ventes`) tombent à zéro. Désynchronisation silencieuse, aucun avertissement UI ; « supprimer un batch » ne défait pas proprement un import.
- **Concurrence non gérée (P2).** `refreshAccessToken` (l.177-201) n'a **aucun verrou** : deux `syncVakSumUp` simultanés (scheduler + bouton manuel) peuvent rafraîchir en parallèle et invalider mutuellement le `refresh_token`. Le `state` OAuth est stocké dans une `Map` **en mémoire process** (`vak.js` l.66) — perdu au redéploiement et incompatible multi-instance.
- **Troncature silencieuse de sync.** `syncTransactionsFromApi` plafonne à `page < 50` × `limit 250` = **12 500 transactions** (l.629) puis marque `success`. Suffisant pour une VAK (quelques centaines/mois) mais un gros rattrapage serait tronqué sans signalement. Le curseur temporel (`newestTime + 1 ms`, l.659) peut aussi reboucler si plusieurs transactions partagent l'horodatage (borné par le garde-fou, sauvé par l'UPSERT idempotent).
- **N+1 secondaires.** `GET /` (liste) exécute 3 sous-requêtes corrélées par VAK (l.177-179) — négligeable (table `vaks` petite). `ingestSumUpTransaction` fait 1 appel HTTP détail **par transaction** (l.698) : acceptable en webhook unitaire, coûteux en sync massive.
- **Valeurs magiques.** TVA `1.2`/`20` en dur (l.724-728, 737 ; défaut schéma l.3935), coordonnées Rouen `49.4231/1.0993` répétées (route + service + schéma), fenêtre 90 j, marge refresh 60 s, TTL state 10 min.

---

## 5. Constats — Sécurité & validation

- **RAS injection / autorisation** : couverture `authorize` complète, SQL paramétré, upload CSV filtré (`csvFilter`) avec nom de fichier assaini (`vak.js` l.55) et limite 20 Mo.
- **Autorisation Socket.IO trop large (P2).** La connexion socket exige un JWT (`index.js` l.278-290), mais `vak:join` (l.305) **ne vérifie aucun rôle** : tout utilisateur authentifié (ex. `COLLABORATEUR`, `RESP_BTQ`) peut rejoindre `vak:live:<id>` et recevoir les compteurs live, alors que l'équivalent REST est réservé `ADMIN`/`MANAGER`. Données peu sensibles (agrégats de ventes), mais incohérence d'autorisation.
- **Validation d'entrée faible.** Les `:id` ne sont pas validés en entier → un id non numérique produit un **500** (via cast PG + catch) au lieu d'un 400. `POST /sumup/sync { since }` invalide → `new Date('...')` = `Invalid Date` → 500. La contrainte `CHECK (date_fin >= date_debut)` existe (bien) mais remonte en 500 générique plutôt qu'en 400 explicite.
- **Gestion d'erreurs inégale.** ~10 routes renvoient `{ error: 'Erreur' }` **sans log** (l.219, 356, 534, 599, 617, 635, 698, 711, 747, 757), gênant le diagnostic ; d'autres loggent correctement. Plusieurs `catch (_) {}` muets côté service et front (`loadHourly`, `loadBatches`).

---

## 6. Divergences schéma ↔ code (mineures)

- `moyen_paiement`, `segment`, `source` **sans contrainte `CHECK`** en base, alors que `CLAUDE.md` documente des énumérations fermées. Divergence contrat/enforcement (flexibilité choisie, à assumer).
- Colonne `vak_ventes.compte` alimentée uniquement par le chemin CSV, jamais par l'API (`ingestSumUpTransaction`) → toujours NULL sur les ventes SumUp.
- `sumup_transaction_id VARCHAR(64) UNIQUE` (global) coexiste avec la clé de conflit `(vak_id, ref_transaction)` : collision théorique possible → erreur avalée. Probabilité très faible.

---

## 7. Testabilité

Seuls **2 helpers purs** sont testés (`normalizePaymentMethod`, `parseFRDate` — 12 cas, corrects et utiles). **La logique la plus à risque n'a aucun test** : `splitCSVLine`, `getSegment`, `importCSVContent` (reconstruction tickets, agrégation, rejet hors-période), `validateWebhookSignature` (**sécurité**), mapping `ingestSumUpTransaction`, calculs de comparaison N-1/YTD. Ce sont les priorités de couverture.

---

## 8. Recommandations priorisées

| # | Priorité | Effort | Action |
|---|----------|--------|--------|
| 1 | **P1** | S | Corriger/supprimer `getPaymentCategory` front : consommer la catégorie calculée par le backend (`payCategorie`) ou reconnaître `CB`/`POS`/`ECOM`/`bancaire`. Retirer le code mort de `VakJournee`. |
| 2 | **P1** | M | Rendre `importCSVContent` transactionnel (client dédié `BEGIN/COMMIT/ROLLBACK`) et n'enregistrer le `file_hash` **qu'au succès** (ou le purger en cas d'échec) pour autoriser le retry. |
| 3 | **P1** | S | Aligner les FK batch : passer `vak_ventes.batch_id` en `ON DELETE SET NULL` (ou refuser la suppression d'un batch actif) ; ajouter confirmation + message UI expliquant que supprimer un batch ne défait pas l'import. |
| 4 | **P1** | M | Ajouter des tests unitaires : `splitCSVLine`, `getSegment`, `importCSVContent` (agrégation + hors-période), `validateWebhookSignature`, mapping `ingestSumUpTransaction`. |
| 5 | **P2** | M | Encapsuler `ingestSumUpTransaction` dans une transaction ; distinguer un compteur « erreur » du « skipped » et loguer/alerter les échecs d'ingestion. |
| 6 | **P2** | S | Verrou (advisory lock PG ou mutex Redis) autour du refresh token ; persister le `state` OAuth en table/Redis (survie restart / multi-instance). |
| 7 | **P2** | S | Durcir la validation : `parseInt(:id)` → 400, `since` invalide → 400, `date_fin >= date_debut` → 400 explicite ; loguer les `catch` muets. |
| 8 | **P2** | S | Factoriser les helpers front (`formatEuro`/`weatherIcon`/`SEGMENT_*`) ; extraire les constantes (TVA, coords Rouen, fenêtres de sync). Restreindre `vak:join` au rôle ADMIN/MANAGER. |

---

## 9. Conclusion

Module **fonctionnel, lisible et bien sécurisé sur l'intégration SumUp**, avec une idempotence et une couverture d'index de bon niveau. Il est pénalisé par un **bug de camembert paiement visible en production**, des **écritures multi-tables non transactionnelles** (import CSV irrécupérable après échec, ingest partiel), une **asymétrie FK** qui désynchronise tickets et lignes de vente, et des **tests trop minces** sur le code complexe. Aucun de ces points n'est structurellement lourd : les correctifs sont surtout de type S/M et n'exigent pas de refonte.

**Note globale : 6.5/10.**

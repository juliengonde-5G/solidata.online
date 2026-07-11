# Audit technique — Module « Logistique exutoires & expéditions »

**Date** : 11 juillet 2026
**Périmètre** : `backend/src/routes/{clients-exutoires,tarifs-exutoires,commandes-exutoires,preparations,controles-pesee,calendrier-logistique,expeditions,partners,state-machines}.js`, `backend/src/services/state-machine(s).js`, `backend/src/scripts/migrate-exutoires.js`, pages `Exutoires*.jsx`.
**Note globale** : 6.0 / 10

---

## 1. Synthèse

Le module couvre un workflow métier riche (commande → préparation → chargement → expédition → contrôle pesée → facturation) avec des fondations saines : SQL **intégralement paramétré** (aucune injection détectée), `authenticate + authorize('ADMIN','MANAGER')` posé au niveau routeur sur toutes les routes exutoires, un **moteur de machine à états** propre et testé, un jeu d'**index cohérent**, et un upload PDF correctement filtré. La dette se concentre sur trois axes : (a) une **centralisation du workflow appliquée à moitié**, (b) de nombreux **désalignements de contrat front/back** qui rendent des pans d'UI silencieusement inertes, et (c) l'**absence de transactions** sur des écritures multi-tables. Aucune faille de sécurité grave, mais plusieurs bugs fonctionnels latents ou actifs.

## 2. Ce qui est bien conçu

- **Moteur de state machine** (`services/state-machine.js` + `state-machines.js`) : séparation moteur/définitions déclaratives, validation transition + rôle, alias rétrocompat pour les libellés accentués, audit best-effort dans `state_transitions_audit`, et **20 tests unitaires** (`tests/unit/services/state-machine.test.js`). Bien pensé.
- **Concurrence sur le hot path** : `PATCH /commandes-exutoires/:id/statut` (commandes-exutoires.js:326) utilise transaction + `SELECT ... FOR UPDATE` + validation via le moteur, empêchant les sauts d'état illégaux et les races.
- **Upload** (controles-pesee.js:14-23) : `fileFilter` PDF, `limits.fileSize` 10 Mo, nom de fichier assaini (`path.basename` + regex). Exemplaire.
- **Résolution de prix** (tarifs-exutoires.js:15) : cascade client-spécifique → référence par défaut, propre et paramétrée.
- **Index** (migrate-exutoires.js:180-190) : client, statut, date, type, `preparations(lieu, dates)`, controles, factures, tarifs, historique. Bonne couverture pour le volume de ST.
- **Soft-delete** clients (`actif=FALSE`) préservant l'intégrité référentielle.

## 3. Qualité & cohérence

**Machine à états contournée par 3 flux sur 5.** Seuls `commandes-exutoires` (statut) et boutique-commandes consomment le moteur. `preparations.js`, `controles-pesee.js` et `PATCH /commandes-exutoires/:id/annuler` gèrent leurs statuts en dur. Pire, les définitions sont **fausses** : `PREPARATION_EXPEDITION` déclare `planifiee/en_chargement/pesee_interne/en_controle/finalisee` (state-machines.js:59) alors que la table et l'UI utilisent `planifiee/remorque_livree/en_chargement/prete/expediee` (migrate-exutoires.js:92) ; `CONTROLE_PESEE` déclare `ouvert/.../litige_clos` alors que le code écrit `conforme/ecart_acceptable/litige/valide` (controles-pesee.js:130). Ces deux définitions sont donc du **code mort trompeur**.

**`/annuler` diverge de la gouvernance.** commandes-exutoires.js:414 autorise l'annulation depuis `chargee`, que le moteur interdit. Deux chemins d'annulation aux règles incompatibles, et `/annuler` n'a pas de `FOR UPDATE` (contrairement à `/statut`).

**Triple source de vérité des statuts.** `STATUTS_VALIDES` (commandes-exutoires.js:48), le validateur `body('statut').isIn([...])` (ligne 327) et la liste `states` du moteur répètent la même énumération. La carte `TYPES_PRODUIT` est dupliquée dans 3 pages React avec des contenus **divergents** (ExutoiresPreparation.jsx:22 omet essuyage/tricot/merinos).

**Duplication logique** : le calcul d'occupation des lieux est copié-collé entre l'endpoint calendrier et `/alertes` (calendrier-logistique.js:202 et 280). Les blocs de détection de conflit sont dupliqués entre `GET /conflits`, `POST` et `PUT` (preparations.js).

## 4. Dette technique

**Divergence de vocabulaire « fréquence » → projection récurrente morte.** Le CHECK DB autorise `unique/hebdomadaire/bi_mensuel/mensuel` (migrate-exutoires.js:65) et le frontend crée exactement ces valeurs (ExutoiresCommandes.jsx:49). Mais `calendrier-logistique.js:104` projette sur `hebdomadaire/bimensuelle/mensuelle/trimestrielle`. Résultat : une commande stockée `mensuel` ne correspond jamais à `mensuelle` → `intervalDays=null` → `continue`. **La projection des commandes récurrentes dans le calendrier prévisionnel est inopérante** pour toutes les valeurs réellement stockées.

**Divergence des types produit → tarifs impossibles pour les nouvelles gammes.** `TYPES_PRODUIT_VALIDES` (tarifs-exutoires.js:12) et `FACTEURS_CO2` (commandes-exutoires.js:17) listent essuyage/tricot/merinos, mais le validateur POST tarifs (ligne 80) **et** le CHECK DB `tarifs_exutoires.type_produit` (migrate-exutoires.js:41) ne les acceptent pas. Créer un tarif de référence pour ces gammes échoue (400 puis 23514). L'auto-remplissage de prix de la commande ne peut donc pas fonctionner pour elles.

**`partners.js` — endpoint cassé.** `GET /partners/:id/interactions` (partners.js:76) fait `SELECT id, date, weight_kg FROM expeditions` : la colonne est **`poids_kg`**, pas `weight_kg` (init-db.js:899). Requête non protégée par `.catch()` → l'endpoint renvoie systématiquement 500. Le `partners` (« référentiel unifié ») est un chantier à moitié câblé : les FK `partner_id` sont ajoutées (init-db.js:4123) mais le contrat de lecture ne correspond pas au schéma.

**Schéma hors convention.** Contrairement à la règle CLAUDE.md §8.4, les 8 tables du module sont dans `migrate-exutoires.js`, pas `init-db.js` (schéma sur deux fichiers ; la migration est bien appelée au démarrage — index.js:441).

**Valeurs magiques** : seuils de tolérance pesée `2%`/`5%` en dur (controles-pesee.js:76-81) alors qu'un réglage global `facturation_tolerance_pct` existe déjà ; `WEEKLY_CAPACITY_HOURS = 5*8` et seuil surcharge `80%` (calendrier) ; facteurs CO2 (documentés, acceptable).

**Agrégat CO2 potentiellement gonflé** : `GET /commandes-exutoires/co2` (ligne 141) fait des LEFT JOIN sur `controles_pesee` et `preparations_expedition` ; si une commande a plusieurs préparations/contrôles, les lignes se multiplient et `tonnage_reel` est sommé en double.

## 5. Robustesse

**Écritures multi-tables sans transaction** (thème principal) :
- `preparations.js POST /` (ligne 125) : INSERT préparation + N INSERT collaborateurs + N INSERT/UPDATE `schedule` + UPDATE commande, **aucun BEGIN/COMMIT**. Échec partiel = état incohérent.
- `preparations.js PUT /` et `PATCH /:id/statut` (branche `expediee`, ligne 383) : UPDATE préparation + UPDATE commande + INSERT `stock_movements`, sans transaction ni idempotence → réémettre le statut `expediee` crée un **doublon de mouvement de stock**.
- `controles-pesee.js POST /` (ligne 46) : INSERT contrôle + UPDATE commande + UPDATE stock, sans transaction ; pas de garde d'unicité → **doublons de contrôles** possibles pour une même commande.
- `expeditions.js POST /` (ligne 40) : INSERT expédition + INSERT `stock_original_movements`, sans transaction.

**Couplage stock par chaîne de caractères** : ajustement du mouvement de stock via `code_barre = 'EXU-' + reference` (controles-pesee.js:107) au lieu d'une FK — un `UPDATE ... WHERE code_barre = ...` touche toutes les lignes homonymes.

**Double `client.release()`** : dans `PATCH /commandes-exutoires/:id/statut`, les branches de retour anticipé (400/404/409, lignes 334/343/361) appellent `client.release()` **puis** le `finally` (ligne 396) le rappelle → « Release called on client which has already been released » (log d'erreur / rejet non géré).

**Cas limites** : `preparations.js:236` fait `current.date_expedition.toISOString()` — lève si la date est nulle. Beaucoup de routes n'ont pas de `parseInt`/validation sur `:id` → un id non numérique produit un 500 (cast Postgres) plutôt qu'un 400/404.

## 6. Sécurité

Globalement **solide** : SQL paramétré partout (y compris filtres dynamiques via `params.push`/`$n`), autorisation `ADMIN/MANAGER` homogène, upload durci. Points mineurs :
- **`partners.js` GET sans `authorize`** (ligne 6, `router.use(authenticate)` seul) : tout utilisateur des 6 rôles peut lister partenaires/interactions (SIRET, contacts), alors que le reste du module est ADMIN/MANAGER. Écritures correctement restreintes.
- `partners.js DELETE ?hard=true` (ligne 157) : suppression physique sans vérification des dépendances (FK `ON DELETE SET NULL`, donc pas de casse, mais perte de traçabilité).
- Validation redondante mais inoffensive (express-validator + re-check manuel) dans clients/tarifs/commandes.

## 7. Contrat Front/Back (bugs actifs)

- **ExutoiresPreparation.jsx** : lit `prep.collaborateurs_noms` (le back renvoie `collaborateurs`) → avatars jamais affichés ; lit `prep.ts_reception/ts_depart/...` (le back renvoie `heure_reception_remorque/heure_depart/...`) → **timeline toujours « Aucun horodatage »** ; `checkConflits` teste `res.data.length` alors que `/conflits` renvoie `{conflit, preparations_en_conflit}` → **l'alerte de conflit ne s'affiche jamais** ; picker collaborateurs `{emp.prenom} {emp.nom}` alors que `employees` expose `first_name/last_name` → **noms vides**.
- **ExutoiresCommandes.jsx** : le détail lit `showDetail.pesee` (back : `controle_pesee`), `preparation.date/tonnage` (colonnes `date_expedition/pesee_interne`), `facture.numero/montant/date` (inexistantes) → **panneaux préparation/pesée/facture inertes**.
- **Gestion d'erreurs silencieuse** généralisée (`catch (err) { console.error(err); }`) : un 409 (transition illégale), un 409 conflit ou un 400 « annulation impossible » ne remontent **aucun message** ; l'action semble sans effet.

## 8. Testabilité

Seul le moteur d'états est couvert (`state-machine.test.js`). **Aucun test de route** pour commandes, préparations, contrôles, tarifs, calendrier. À prioriser : (1) intégration `PATCH /statut` (enforcement des transitions + rollback), (2) détection de conflit de préparation (TOCTOU), (3) calcul d'écart pesée et seuils, (4) idempotence/duplication de `stock_movements`.

## 9. Recommandations priorisées

| # | Priorité | Effort | Action |
|---|----------|--------|--------|
| 1 | P1 | M | Envelopper toutes les écritures multi-tables dans des transactions (`preparations` POST/PUT/PATCH, `controles-pesee` POST/valider, `expeditions` POST) + garde d'idempotence sur les mouvements de stock. |
| 2 | P1 | S | Aligner le vocabulaire « fréquence » entre DB/front (`bi_mensuel/mensuel`) et `calendrier-logistique.js` — la projection récurrente est actuellement morte. |
| 3 | P1 | S | Corriger les désalignements front/back de `ExutoiresPreparation` (collaborateurs, timeline, conflits, noms) et `ExutoiresCommandes` (détail préparation/pesée/facture). |
| 4 | P1 | S | Faire remonter les erreurs API à l'utilisateur (bandeaux) au lieu de `console.error` muets, notamment sur les transitions/annulations refusées (409/400). |
| 5 | P1 | S | Unifier les types produit : ajouter essuyage/tricot/merinos au validateur **et** au CHECK DB de `tarifs_exutoires` (sinon aucun tarif possible pour les gammes actuelles). |
| 6 | P2 | M | Étendre l'usage du moteur d'états à préparations/contrôles/annulation et corriger (ou retirer) les définitions `PREPARATION_EXPEDITION`/`CONTROLE_PESEE` qui ne reflètent pas la réalité. |
| 7 | P2 | S | Corriger `partners.js` : `weight_kg`→`poids_kg`, ajouter `authorize` sur les GET, ou marquer le référentiel unifié comme non finalisé. |
| 8 | P2 | S | Résoudre le double `client.release()` (retirer les `release()` manuels, laisser le `finally`) et l'agrégat CO2 multiplié par les LEFT JOIN. |
| 9 | P2 | S | Supprimer le N+1 de `GET /preparations` (agrégation JSON des collaborateurs en une requête). |
| 10 | P2 | S | Externaliser les seuils magiques (tolérance pesée → `facturation_tolerance_pct`, capacité hebdo) et factoriser la logique d'occupation dupliquée. |

---
*Fin du rapport — module logistique-exutoires.*

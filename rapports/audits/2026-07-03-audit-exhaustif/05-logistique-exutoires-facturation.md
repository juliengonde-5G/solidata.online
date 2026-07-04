# Audit exhaustif SOLIDATA — 05. Logistique exutoires, Expéditions, Facturation, Contrôle facturation Pennylane, Refashion, Référentiels, Métropole

> Domaine : modules 9 (Expéditions), 10 (Facturation interne), 11 (Logistique exutoires), 13 (Refashion), 21 (Référentiels), + Métropole.
> Date : 2026-07-04. Aucun fichier de code modifié pendant l'audit.
> Convention : chaque affirmation est référencée `fichier:ligne`. Sévérités : **BLOQUANT** (flux métier cassé), **CRITIQUE** (perte/corruption de données ou sécurité), **MAJEUR** (fonction dégradée), **MINEUR** (robustesse/UX), **INFO**.

---

## 0. Résumé exécutif

Le domaine logistique-exutoires est le plus « feature-riche » de l'ERP (state machine centralisée, double audit, réconciliation Pennylane, DPAV versionné). Mais **la promesse dépasse largement la réalité livrée** : le chantier V6.1 (« workflow le plus complexe migré vers le moteur state-machine ») et le chantier V1.8.0 (« contrôle facturation Pennylane ») contiennent chacun **un bug bloquant qui rend le flux principal non-fonctionnel**, et tous deux sont invisibles au smoke-test.

**Deux bugs BLOQUANTS confirmés (preuve SQL) :**

1. **Rapprochement Pennylane 500 systématique** — insertion dans des colonnes `motif` / `modifie_par` **qui n'existent pas** dans `historique_commandes_exutoires`. Touche le rapprochement manuel ET le matching automatique. Le module 23bis (vaisseau amiral de V1.8.0) ne fonctionne sur aucun de ses deux chemins.
2. **Workflow commande bloqué à la 1ʳᵉ étape** — la state machine `commande_exutoire` ignore l'état initial réel `en_attente` (elle connaît `brouillon`), donc `PATCH /statut` renvoie 409 `INVALID_SOURCE` dès qu'on veut confirmer une commande.

Ces deux bugs sont des **régressions de refactor** : le code « propre » (state machine, double audit) a été écrit sans réaligner le vocabulaire d'état ni le schéma de la table d'historique. La state machine, présentée comme la source de vérité, n'est en réalité câblée que sur **un seul** endpoint (et cet endpoint est cassé) ; tous les autres changements de statut se font en `UPDATE` direct, la contournant.

| Sévérité | Nombre |
|----------|--------|
| BLOQUANT | 2 |
| CRITIQUE | 2 |
| MAJEUR   | 6 (+2 locaux Refashion/Métropole) |
| MINEUR   | 10 |

---

## 1. BLOQUANTS

### B1 — Contrôle facturation Pennylane : INSERT dans colonnes inexistantes `motif` / `modifie_par`

**Fichiers :** `routes/factures-exutoires.js:265` et `:309` ; `routes/pennylane.js:609`.
**Preuve schéma :** `scripts/migrate-exutoires.js:165-173` — la table `historique_commandes_exutoires` a exactement : `id, commande_id, ancien_statut, nouveau_statut, utilisateur_id, commentaire, created_at`. Un `grep -rn "modifie_par|ADD COLUMN.*motif|historique_commandes_exutoires"` sur tout `backend/src` ne trouve **aucun** `ALTER TABLE … ADD COLUMN motif/modifie_par`. Les colonnes n'existent nulle part.

**Les 3 INSERT fautifs :**
- `factures-exutoires.js:265` (rapprochement **manuel** `POST /:id/link-commande`) : `INSERT INTO historique_commandes_exutoires (commande_id, ancien_statut, nouveau_statut, motif, modifie_par)`.
- `factures-exutoires.js:309` (`POST /:id/unlink`) : idem.
- `pennylane.js:609` (matching **automatique** pendant `POST /pennylane/sync/customer-invoices`) : `INSERT INTO historique_commandes_exutoires (commande_id, ancien_statut, nouveau_statut, motif)`.

**Impact :**
- **Rapprochement manuel** : `link-commande` fait `BEGIN` (`factures-exutoires.js:237`) → UPDATE facture → `recomputeFactureEcart` → UPDATE commande `cloturee` → INSERT historique (crash `column "motif" does not exist`) → `ROLLBACK` (`:272`) → **HTTP 500**. Le rapprochement manuel est **impossible**.
- **Matching automatique** : dans la boucle `sync` chaque facture est en `BEGIN` propre (`pennylane.js:552`). Quand une facture matche une commande, le flux insère l'historique fautif (`:609`) → l'exception fait `ROLLBACK` (`:637`) qui **annule aussi l'INSERT de la facture** (`:574`) → la facture matchée est **perdue** et comptée dans `results.errors`. Seules les factures **non** rapprochées survivent (elles sautent l'INSERT historique, `:601-613`).

**Conséquence métier :** le module « Contrôle facturation » (23bis) ne fonctionne sur **aucun** de ses deux chemins. Auto-match = données perdues + compteur d'erreurs ; match manuel = 500. Seul l'import de factures orphelines marche — mais elles ne peuvent alors jamais être réconciliées. C'est exactement la classe de bug (`column … does not exist`) que le smoke-test 2.0.4 devait attraper, mais ces endpoints n'y sont pas couverts.

**Correctif :** remplacer `motif` → `commentaire` et `modifie_par` → `utilisateur_id` dans les 3 INSERT (aligner sur le vrai schéma `migrate-exutoires.js:171,170`). Zéro migration nécessaire. Ajouter ces endpoints au smoke-test.

---

### B2 — Workflow commande exutoire bloqué : la state machine ignore l'état initial réel `en_attente`

**Fichiers :** `services/state-machines.js:18-52` (définition `COMMANDE_EXUTOIRE`) vs `routes/commandes-exutoires.js:265` (création) et `:348` (validation transition).
**Preuve :** la commande est créée avec `statut = 'en_attente'` (`commandes-exutoires.js:265`, et DB DEFAULT + CHECK `migrate-exutoires.js:69-70`). Or la state machine déclare `initial: 'brouillon'` et une liste `states` qui contient `brouillon, confirmee, en_preparation, chargee, expediee, pesee_recue, facturee, cloturee, annulee` — **`en_attente` n'y figure pas**, et n'est pas non plus dans `aliases` (`state-machines.js:34-40`, aliases = seulement les variantes accentuées). Un `grep "brouillon"` sur `commandes-exutoires.js` et `ExutoiresCommandes.jsx` ne retourne **rien** : rien ne crée jamais un `brouillon`.

**Chaîne d'échec** (`commandes-exutoires.js:348` → `state-machine.js:57`) : `canTransition({fromState:'en_attente', toState:'confirmee'})` → `normalizeState('en_attente') = 'en_attente'` → `m.states.includes('en_attente')` est **faux** → retour `{ok:false, code:'INVALID_SOURCE'}` → `commandes-exutoires.js:357` renvoie **HTTP 409** « État source 'en_attente' inconnu ».

**Impact — confirmé côté UI :** `ExutoiresCommandes.jsx:102` définit `STATUS_TRANSITIONS = { en_attente: { action:'Confirmer', next:'confirmee' }, … }` ; le bouton du modal détail (`:697-702`) appelle `handleStatusChange(cmd, 'confirmee')` → `PATCH /commandes-exutoires/:id/statut { statut:'confirmee' }` (`:252`) → **409 INVALID_SOURCE**, toast d'erreur. **Le bouton « Confirmer » est mort.** L'état `confirmee` devient **inatteignable** (seule `en_attente→confirmee` y mène). La colonne kanban « Nouveau » (`en_attente`, `:59`) ne peut jamais avancer via l'UI. Les commandes ne peuvent progresser que par **effet de bord** (créer une préparation force `en_preparation` en UPDATE direct `preparations.js:192`, saisir une pesée force `pesee_recue` `controles-pesee.js:97`) — mais l'agent qui suit le flux naturel « Confirmer → Préparer » est bloqué à l'étape 1 avec un message incompréhensible.

**Correctif :** dans `state-machines.js`, remplacer `initial:'brouillon'` par `initial:'en_attente'`, mettre `en_attente` en tête de `states`, et `transitions: { en_attente: { confirmee:{roles}, annulee:{roles} }, … }` (retirer `brouillon`, absent de la DB). Aligner sur le CHECK réel `migrate-exutoires.js:70`.

---

## 2. CRITIQUES

### C1 — La « state machine centralisée » n'est câblée que sur 1 endpoint ; tous les autres changements de statut la contournent

**Preuve :** le seul appel à `stateMachine.canTransition/transition` du domaine commande est `commandes-exutoires.js:348,374`. Tous les autres changements de `commandes_exutoires.statut` sont des `UPDATE` directs sans validation :
- `preparations.js:192` → `en_preparation` ; `preparations.js:386` → `expediee`
- `controles-pesee.js:97` → `pesee_recue` ; `controles-pesee.js:161` → `facturee`
- `factures-exutoires.js:261,355` → `cloturee` ; `factures-exutoires.js:305` (unlink) → `expediee`
- `commandes-exutoires.js:419` (annuler) → `annulee`
- `pennylane.js:605` → `cloturee`

**Impact :** une commande peut sauter de `en_attente` directement à `cloturee` (via link-commande) ou à `expediee` (via préparation) sans passer par les transitions « valides » que la state machine prétend imposer. La garantie d'intégrité vendue par V6.1 est illusoire : le moteur ne protège qu'un chemin (et ce chemin est cassé, cf. B2). De plus, `PREPARATION_EXPEDITION` et `CONTROLE_PESEE` sont définies dans `state-machines.js:54-91` mais **jamais appelées** (les routes `preparations.js` et `controles-pesee.js` n'importent pas le moteur), et leur vocabulaire diverge de la DB (cf. M1). Code mort qui donne une fausse impression de robustesse.

**Correctif :** soit router tous les changements de statut via `stateMachine.transition` (avec `dbClient` dans la transaction), soit assumer et documenter que le moteur n'est qu'un validateur d'un sous-ensemble. En l'état, c'est le pire des deux mondes.

### C2 — Écriture d'audit métier hors transaction sur `link-commande` / incohérence transactionnelle

**Fichier :** `factures-exutoires.js:229-278`. La transaction couvre bien UPDATE facture + UPDATE commande + INSERT historique (tous dans le `client` transactionnel). **Mais** dès que B1 est corrigé, il reste que `validate-ecart` (`:326-341`) et `valider` (`:344-364`) font des `pool.query` **hors** transaction : `valider` fait UPDATE facture puis UPDATE commande `cloturee` en deux requêtes séparées (`:346` puis `:354`) — si la 2ᵉ échoue, la facture est `validee` mais la commande reste non clôturée. **Aucun historique** n'est écrit par `validate-ecart`/`valider` (contrairement à `link-commande`), donc la clôture par validation d'écart n'est pas tracée. Traçabilité partielle sur un module comptable.

---

## 3. MAJEURS

### M1 — Vocabulaire d'états `preparations_expedition` : DB vs state machine totalement disjoints

**Preuve :** DB CHECK `migrate-exutoires.js:91-92` = `planifiee, remorque_livree, en_chargement, prete, expediee`. State machine `PREPARATION_EXPEDITION` `state-machines.js:59` = `planifiee, en_chargement, pesee_interne, en_controle, finalisee, annulee`. Seuls `planifiee` et `en_chargement` sont communs. La route `preparations.js:328` (`PATCH /:id/statut`) écrit `remorque_livree/prete/expediee` en UPDATE direct — ça marche car elle ne consulte pas le moteur, mais si on la câblait (cf. C1), toute transition serait rejetée `INVALID_TARGET`. Idem `CONTROLE_PESEE` (`state-machines.js:79` : `ouvert/conforme/ecart_acceptable/litige/litige_clos`) vs DB `controles_pesee.statut_controle` CHECK `migrate-exutoires.js:130` (`conforme/ecart_acceptable/litige/valide`) — `valide` vs `litige_clos` divergent.

### M2 — `facture_exutoire` state machine vs statuts réellement écrits : divergence

**Preuve :** `FACTURE_EXUTOIRE.states` = `recue, conforme, ecart, validee, rejetee` (`state-machines.js:98`). Or le code écrit `statut_facture = 'rapprochement_manuel'` (`factures-exutoires.js:249`) et `'ecart_valide'` (`:330`) — absents de la machine mais présents dans le CHECK DB élargi (`init-db.js:4067`). La machine `facture_exutoire` n'est d'ailleurs **jamais appelée** (aucun `machine:'facture_exutoire'` dans les routes). 3ᵉ machine morte.

### M3 — Contrôle pesée : seuils codés en dur, incohérents avec la tolérance globale

**Fichier :** `controles-pesee.js:76-82`. Les seuils `conforme ≤2 %`, `ecart_acceptable ≤5 %`, `litige >5 %` sont **codés en dur**, alors que le contrôle facturation lit `facturation_tolerance_pct` (défaut 5 %) depuis `settings` (`factures-exutoires.js:59-65`). Deux notions de tolérance non alignées : un écart pesée de 4 % est « acceptable » côté pesée mais un écart facturation de 4 % est « dans la tolérance » seulement si le setting vaut ≥4. Pas de source unique. De plus le `2 %` (conforme) n'est configurable nulle part.

### M4 — Contrôle pesée : dénominateur d'écart = pesée interne, alors que le métier compare au client

**Fichier :** `controles-pesee.js:71-72`. `ecart_pesee = pesee_interne - pesee_client` puis `ecart_pourcentage = |ecart| / pesee_interne * 100`. Le pourcentage est rapporté à la **pesée interne**. Or côté facturation, `recomputeFactureEcart` (`factures-exutoires.js:37-38`) calcule `ecart = quantite_facturee - pesee_client` et `ecart_pct = ecart / pesee_client * 100` — dénominateur **pesée client**. Les deux « % d'écart » du même dossier n'ont pas la même base → un manager voyant « 3 % » sur l'écran pesée et « 3,1 % » sur l'écran facturation ne comprend pas que ce sont des bases différentes. À harmoniser (la référence contractuelle est en général la pesée client = ce que le client paie).

### M5 — Aucune transaction sur POST préparation, POST contrôle pesée, POST expédition

**Fichiers :** `preparations.js:124-215` (INSERT prep + N INSERT collaborateurs + N INSERT schedule + UPDATE commande, tous en `pool.query` séparés) ; `controles-pesee.js:50-132` (INSERT contrôle + UPDATE commande + UPDATE stock, séparés) ; `expeditions.js:55-76` (INSERT expédition + INSERT stock_original, séparés). Un échec en milieu de séquence laisse un état partiel (commande flippée sans stock, préparation sans collaborateurs, etc.). Le pattern transactionnel existe pourtant (`commandes-exutoires.js`, `billing.js`) — non appliqué ici.

### M6 — Référentiel `type_produit` désynchronisé : facteurs CO2 et tarifs restés sur l'ancien vocabulaire

**Preuve :** la migration V1.8.2 (`init-db.js:4097-4125`) a migré `commandes_exutoires.type_produit` vers la whitelist **`original, csr, essuyage, tricot, merinos, jean, coton_blanc, coton_couleur`** (les `effilo_*` ont été convertis en `essuyage`). Mais :
- `commandes-exutoires.js:17-25` (`FACTEURS_CO2`) a encore les clés **`effilo_blanc, effilo_couleur, jean, coton_blanc, coton_couleur`** — pas de clé `essuyage/tricot/merinos`. Dans `/commandes-exutoires/co2` (`:160`), `FACTEURS_CO2[type] || 0` → une commande `essuyage` (le gros du recyclage fibre) pèse **0 t CO2 évitée**. Le KPI environnemental (repris pour le reporting Métropole) **sous-compte** la catégorie dominante.
- `tarifs-exutoires.js:10,78` (`TYPES_PRODUIT_VALIDES`) et le CHECK DB `migrate-exutoires.js:41` valident encore `effilo_*`. Conséquence : **impossible de créer un tarif** pour `essuyage/tricot/merinos` (rejet CHECK → 500), donc le résolveur de prix (`/tarifs-exutoires/prix`) ne rendra jamais de prix pour ces types. Les nouvelles commandes n'ont pas de tarif de référence.

**Correctif :** aligner `FACTEURS_CO2` (ajouter `essuyage/tricot/merinos`, retirer `effilo_*`), `TYPES_PRODUIT_VALIDES`, et le CHECK `tarifs_exutoires.type_produit` sur la whitelist de `init-db.js:4112`. Une seule constante partagée serait idéale.

---

## 4. MINEURS

- **MI1 — Course sur la numérotation.** `generateReference` (`commandes-exutoires.js:28-38`) et `BillingService.generateInvoiceNumber` (`BillingService.js:37-55`) font `SELECT MAX(...)+1` sans verrou. Deux créations concurrentes → même référence → collision sur l'index UNIQUE (`migrate-exutoires.js:57`) → 500 pour l'un. Probabilité faible (faible volume), mais réel. Correctif : séquence Postgres dédiée, ou `INSERT … ON CONFLICT` avec retry.
- **MI2 — `PATCH /preparations/:id/statut` sans `isIn()`.** `preparations.js:329-331` valide seulement `notEmpty()` ; un statut invalide passe le validateur et casse sur le CHECK DB → 500 au lieu de 400.
- **MI3 — Ajustement stock silencieusement no-op.** `controles-pesee.js:113-123` fait `UPDATE stock_movements WHERE code_barre = 'EXU-'+reference`. Si la préparation n'a jamais atteint `expediee` (donc pas de mouvement créé `preparations.js:395`), l'UPDATE ne touche 0 ligne — logué mais silencieux côté UI. Couplage fragile par `code_barre`. (Le rapport 04 traite la rupture stock plus large ; ici c'est un cas de couplage local.)
- **MI4 — `annuler` sans `FOR UPDATE`.** `commandes-exutoires.js:401` lit le statut sans verrou pessimiste, contrairement à `/statut` (`:335`). Fenêtre de course annuler/avancer.
- **MI5 — Restauration de statut « devinée » à l'unlink.** `factures-exutoires.js:305` remet la commande à `expediee` « (la plus probable) » quand on délie une facture — perd le vrai statut antérieur (qui pouvait être `pesee_recue` ou `facturee`). L'historique existe pourtant pour le retrouver.
- **MI6 — `preparations.js:236` compare une date string à `.toISOString()`.** `datesChanged` compare `date_expedition` (string reçue) à `current.date_expedition.toISOString()` ; formats hétérogènes → faux positifs de « changement » déclenchant des recalculs de conflit inutiles (non bloquant).
- **MI7 — `expeditions.js` POST/summary : page supprimée mais route vivante.** La page `Expeditions.jsx` a été retirée (V1.8.0) ; le POST (`expeditions.js:40`) garde son fix d'alias L1 mais n'a plus d'appelant UI connu. `summary` reste utile au reporting. À clarifier (mort partiel).

---

## 5. Promesse vs réalité (synthèse par brique)

| Brique | Promesse (CLAUDE.md) | Réalité |
|--------|----------------------|---------|
| Workflow commande 9 statuts + state machine + verrou `FOR UPDATE` | V6.1 « migré vers moteur centralisé » | `FOR UPDATE` OK (`:335`) mais **B2 bloque l'étape 1** ; SM contournée partout ailleurs (**C1**) |
| Audit double (métier + `state_transitions_audit`) | V6.1 | Métier OK sur `/statut` ; mais `link/unlink/valider` écrivent un audit incomplet ou cassé (**B1, C2**) |
| Préparation + contrôle pesée double | Module 11 | Fonctionnels en UPDATE direct, mais hors-transaction (**M5**), vocabulaire SM divergent (**M1**) |
| Facturation interne HT/TVA/TTC via InvoiceRepository + BillingService | V5.4/V6.3 | **Propre et correct** : arrondi centime (`BillingService.js:69-75`), garde-fou injection (`:41`), repo transactionnel. Le meilleur code du domaine. |
| Contrôle facturation Pennylane (match auto + manuel, écart pesée/facturé, tolérance, bascule cloturee) | V1.8.0 / 23bis | **Cassé des deux côtés (B1)** ; tolérance et écart calculés mais jamais atteignables en pratique |
| DPAV + taux subvention versionnés + 5 vues SQL CSV | V2.0.0 | À vérifier (section 6) |

---

## 6. Refashion / Référentiels / Métropole

**Refashion (`refashion.js`) — globalement le module le plus sain du domaine.**
- DPAV : POST transactionnel avec audit-trail snapshot JSONB (`:100-118`), `ON CONFLICT` idempotent. Bon.
- Taux subvention versionnés : `refashion_taux_subvention` avec `getTauxAt(date)` (`:12-20`) + clôture auto du taux précédent à l'ajout (`:165-170`). Propre, conforme à P0-C.
- 5 vues SQL exportables CSV via whitelist `EXPORT_VIEWS` (`:224-253`) — le `SELECT * FROM ${view}` est **sûr** car `view` provient de la whitelist, pas de l'input. Filtres `annee/trimestre` paramétrés.
- **MAJEUR local — deux modèles de subvention incohérents :** `/dpav` calcule `total_subvention = tri_t × taux_entree` (tarif **unique** €/t entrant, `:53`, modèle P0-C) tandis que `POST /subventions` (`:337-388`) calcule une somme à **5 taux codés en dur** (`reemploi 80, recyclage 295, csr 210, energie 20, entree 193`, `:348-352`). Deux formules qui ne donnent pas le même montant pour le même trimestre ; `refashion_subventions` (ancien modèle) coexiste avec `refashion_taux_subvention` (nouveau) sans passerelle. À trancher (le nouveau modèle « tarif unique entrant » semble faire foi).
- **MINEUR — CSV formula injection :** `toCsv` (`:213-221`) échappe guillemets/`;`/retours ligne mais ne neutralise pas les cellules débutant par `= + - @` → un nom de commune ou une note `=HYPERLINK(...)` s'exécute à l'ouverture Excel. Données internes, risque faible. Préfixer d'une apostrophe les cellules à risque.
- **MINEUR — communes stale :** `GET /refashion/communes` (`:267-292`) **aliase `code_postal` en `code_insee`** (`:273`) — sémantiquement faux (CP ≠ code INSEE) — et compte `nb_cav` par `cav.commune ILIKE rc.commune` (matching sur nom, fragile) au lieu de joindre sur `code_insee`. Contraste avec Métropole qui fait bien (cf. ci-dessous). Vestige du modèle pré-P0-D.

**Métropole (`metropole.js`) — solide.**
- `captation-par-commune` (`:360-391`) joint correctement `cav.code_insee_commune = referentiel_communes.code_insee` (`:380`) et retombe sur `population_insee`/`population_commune` — c'est le **bon** modèle commune (P0-D), à répliquer dans refashion.js.
- CO2 évité : mix **observé** depuis les colisages scellés (`famille_refashion`, `:44-65`) avec fallback 40/35/15/10 — conforme à P2 (V2.0.0). Attention : `metropole.js` utilise un dict `FACTEURS_CO2` **par famille** (`reutilisation/recyclage/chiffons/csr`, `:40`) tandis que `commandes-exutoires.js` en a un **par type produit** (`:17`) — **deux calculateurs CO2 distincts** dans l'app, sur des périmètres différents (collecte vs ventes exutoire). Non bloquant mais source de chiffres divergents si un jour rapprochés.
- Rôle `AUTORITE` autorisé (`:7`) — approprié pour un tableau de bord collectivité.

**Référentiels (`referentiels.js`) — propre.** CRUD exutoires/catalogue/conteneurs/positions, lecture ouverte à tout authentifié, écriture ADMIN. Le commentaire `:90` (« la colonne s'appelle `title`, pas `name` ») montre qu'un bug type `column does not exist` a déjà été corrigé ici. RAS.

**Partners (`partners.js`) — référentiel unifié, mais vue interactions partiellement câblée.**
- **MINEUR — colonnes masquées par `.catch()` :** `GET /partners/:id/interactions` (`:72-91`) sélectionne `factures_exutoires.numero_facture` (`:78`) — **colonne inexistante** (le schéma a `pennylane_invoice_number`, cf. `init-db.js:4035`) — et `commandes_exutoires WHERE partner_id` (`:77`) alors que le vrai FK est `client_id`. Les deux requêtes ont un `.catch(() => ({rows:[]}))` qui **masque l'erreur** et renvoie une liste vide : la vue « factures » et « commandes » d'un partenaire est **toujours vide**, sans signal d'erreur. Défensif mais trompeur.

---

## 7. Simplicité d'usage (agent logistique)

- Le workflow à 9 statuts est **trop granulaire** pour un agent peu à l'aise : `en_attente → confirmee → en_preparation → chargee → expediee → pesee_recue → facturee → cloturee`. Beaucoup de ces transitions sont des effets de bord d'autres écrans (créer une préparation, saisir une pesée), si bien que l'agent ne sait pas s'il doit changer le statut à la main ou laisser l'app le faire. Le message d'erreur 409 « État source 'en_attente' inconnu » (B2) est **incompréhensible** pour un non-technicien.
- Écrans de rapprochement (ExutoiresControleFacturation) : à évaluer (section enrichie).

## 8. Optimisations

- Remplacer les `SELECT MAX()+1` par des séquences (MI1).
- `preparations.js:32-41` fait un **N+1** (une requête collaborateurs par préparation) — remplaçable par un `LEFT JOIN … json_agg`.
- Envelopper les POST multi-étapes dans des transactions (M5) évite les états partiels et le nettoyage manuel.

## 9. Évolutions

- **E-facturation 2026-2027 (obligatoire) :** la **réception** de factures électroniques au format Factur-X / via PDP devient obligatoire **dès septembre 2026** pour toutes les entreprises. Le module Contrôle facturation importe aujourd'hui les factures *émises* par Solidata via Pennylane, mais **rien ne gère la réception de factures fournisseurs/exutoires au format structuré**. Chantier prioritaire (échéance < 3 mois après cet audit).
- Portail exutoire (dépôt de bons de pesée / factures par le client).
- Signature électronique des bons de livraison (aujourd'hui `bon_livraison` = simple champ texte `expeditions`).

## 10. Quick wins sûrs

1. **B1** — `motif→commentaire`, `modifie_par→utilisateur_id` dans les 3 INSERT (`factures-exutoires.js:265,309` ; `pennylane.js:609`). Débloque tout le module 23bis. Aucune migration.
2. **B2** — aligner `state-machines.js` COMMANDE_EXUTOIRE sur `en_attente` (initial + states + transitions). Débloque le bouton Confirmer.
3. Ajouter les endpoints `factures-exutoires/*` et `commandes-exutoires/:id/statut` au smoke-test (`scripts/tests/api-smoke.js`).

---

## Top 5 anomalies (fichier:ligne)

1. **B1** `factures-exutoires.js:265,309` + `pennylane.js:609` — INSERT `motif/modifie_par` inexistants → rapprochement Pennylane 500 / données perdues.
2. **B2** `state-machines.js:23` vs `commandes-exutoires.js:265` — état initial `brouillon` ≠ `en_attente` → 409 INVALID_SOURCE à la confirmation.
3. **C1** `commandes-exutoires.js:348` seul appelant SM ; `preparations.js:192,386`, `controles-pesee.js:97,161`, `factures-exutoires.js:261` la contournent.
4. **M1** `state-machines.js:59` vs `migrate-exutoires.js:91` — vocabulaire préparation disjoint (code mort trompeur).
5. **M4** `controles-pesee.js:72` vs `factures-exutoires.js:38` — dénominateurs d'écart % différents (pesée interne vs client).

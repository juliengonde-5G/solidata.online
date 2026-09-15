# PR B « Cadre RSA et temps d'accompagnement » — revue de sécurité et de conformité RGPD

> **Agent de sécurité (lecture seule)** — chantier `cip-refonte-2026-09-12`, branche
> `claude/solidata-cip-redesign-9fskwq-pr-b`, périmètre
> `git diff claude/solidata-cip-redesign-9fskwq...HEAD` (lots 3 et 4 + intégration : 40 fichiers,
> +8 972 / −16 lignes).
> **Références opposables** : contrats `15-contrats-techniques-PR-B.md` (§ 0.6 trois règles de fond,
> § 6 listes blanches, § 8 anonymisation), exigences de l'autorité `09-matrice-reporting-autorite.md`
> § 2 (c) et (f) et § 3, rapports de lot `16-realisation-lot3.md` / `16-realisation-lot4.md`.
> Doctrines : `CLAUDE.md` § 7-8, revue PR A `12-revue-securite-PR-A.md` (même grille, mêmes
> catégories), debug PR A `13-debug-postgres-PR-A.md`.
> **Aucun fichier de code modifié, aucune commande git.** Constats reproduits par lecture précise
> (fichier:ligne) et par exécution des suites Jest existantes.
> **Date** : 13 septembre 2026.

---

## 0. Verdict

**CONFORME SOUS RÉSERVE** — **3 constats BLOQUANTS**, **5 MAJEURS**, **11 MINEURS**.

Le travail est du même niveau que celui de la PR A, et sur plusieurs points il fait mieux.
Le moteur `activite-hebdo-engine.js` tient ses trois règles de fond sans une faille : une semaine
sans relevé rend `null` partout et jamais `0` (`nombreOuNull`, l. 66-70), l'alerte ne se lève ni
pendant un arrêt déclaré ni sur une semaine non relevée (`calculerAlerte`, l. 260-276), et
`nb_semaines_sous_seuil` compte les arrêts alors que l'alerte les exclut — exactement la distinction
que demandait l'amendement A4. La liste blanche de `composerFicheReferent` est structurelle : les
axes santé et judiciaire n'ont **aucune clé** parce qu'ils sont filtrés à la source du registre
(`FREINS.filter(f => f.sensible == null)`, l. 62), les actions rattachées à ces deux freins sont
retirées **en SQL** (l. 159) et non à l'affichage, `absence_piece_ref` n'est **pas même lu** hors
variante dossier (l. 134-135), et `employee_leaves.leave_type` ne quitte jamais le module (seule
`type_category` est sélectionnée, l. 418-419). La garde de périmètre de `/temps` est posée avant
tout validateur, en comparaison **numérique** (`gardeProprietaire`, `temps.js` l. 89-99), et la
feuille de temps ne porte le nom d'aucun bénéficiaire — non par masquage mais parce que le moteur
ne l'a jamais reçu (`temps-engine.js` l. 21-23). Les 10 codes du journal RGPD sont traduits, les
migrations sont idempotentes, l'entrée art. 30 de la transmission au référent est complète et porte
elle-même la réserve « base légale à confirmer par le DPO ». Les 179 tests des 5 nouvelles suites
passent.

**Ce qui bloque tient en trois phrases.**

1. **Deux documents qui sortent vers un tiers laissent passer du texte libre.** Le relevé
   d'assiduité transmis au CMS ou à France Travail imprime `insertion_milestones.titre` — un champ
   `VARCHAR(120)` librement saisi par la CIP — en tête de chaque ligne, **avant** de retomber sur le
   libellé de type. La liste blanche est donc percée à l'endroit exact où le contrat § 0.6 la déclare
   « STRUCTURELLE côté serveur ».
2. **La donnée que le lot 4 refuse explicitement au MANAGER lui revient par une route voisine.**
   `heuresAccompagnement` rend `par_salarie: [{ employee_id, nom, minutes }]` ; le test de contrat du
   lot 4 refuse cette route au MANAGER en la nommant « agrégats nominatifs par salarié » — et le même
   objet est versé tel quel dans `gatherAuditKpis`, que `GET /insertion/audit` sert au MANAGER sans
   projection et que `GET /exports/insertion-synthese?format=json` renvoie sous la bannière
   « **Document agrégé non nominatif — comité de pilotage** ». C'est le défaut de la PR A (C-01, C-02)
   au caractère près : la donnée protégée sur une route revient par sa voisine.
3. **La feuille de temps transmise au financeur nomme la catégorie d'absence de l'intervenant.**
   L'anomalie de cohérence imprime « Temps déclaré un jour d'absence de l'intervenant
   (**arrêt de travail**) » dans le CSV et le PDF destinés à la DDETS. La spécification (c) ne demande
   que « le détail des jours en anomalie » ; le code contredit son propre commentaire, qui affirme
   deux lignes plus haut que « le MOTIF n'est jamais repris ».

Aucun des trois ne relève d'une négligence : ce sont trois endroits où une règle juste a été appliquée
un cran trop court. Les correctifs proposés tiennent chacun en quelques lignes.

---

## 1. Constats BLOQUANTS

### B-01 — Le relevé d'assiduité transmis au référent imprime un champ de TEXTE LIBRE

**Fichier** : `backend/src/services/fiche-referent.js:439`
**Impression** : `frontend/src/components/insertion/pdf-referent.js:236`
**Déclencheur** : `frontend/src/pages/InsertionParcours.jsx` › `exporterAssiduite` (appel sans
`variante` → variante `tiers` par défaut, `rsa.js:278`).

```js
// fiche-referent.js:436-444 — variante « tiers »
entretiens: entretiens.map((m) => {
  const ligne = {
    date: dateTenue(m),
    type_libelle: m.titre || libelleType(m.milestone_type),   // ← l. 439
    ...
```

`libelleType` est la table fermée des 8 types (`TYPE_LABELS`, l. 55-59). Mais elle n'est atteinte
qu'**en repli** : `m.titre` prime. Or `insertion_milestones.titre` est un `VARCHAR(120)`
(`init-db.js:3812`) **librement saisi**, listé dans `MILESTONE_EDITABLE_FIELDS`
(`routes/insertion/routes.js:711`) et accepté en création par le seul validateur
`body('titre').optional().isLength({ max: 120 })` (`routes.js:588`) — aucune contrainte de contenu,
aucun chiffrement, aucun masquage.

Une CIP qui intitule un entretien « Bilan après l'hospitalisation », « Point suite convocation au
tribunal » ou « Reprise après l'arrêt de M. » — ce qui est une pratique naturelle dans un dossier
interne — fait sortir ce verbatim vers le CMS ou France Travail, sur un document qui peut fonder une
suspension de droits. Le PDF le reproduit tel quel dans la colonne « Entretien » (`pdf-referent.js:236`).

**Ce que le constat contredit, mot pour mot** :
- contrat § 0.6 règle 2 : *« contenu en liste blanche côté serveur, santé et judiciaire exclus »* ;
- contrat § 6.3 : la clé s'appelle `type_libelle` — le **libellé du type**, pas le titre de la ligne ;
- l'en-tête du fichier lui-même (`fiche-referent.js:12-17`) : *« une liste NOIRE laisserait passer le
  prochain champ ajouté au diagnostic »* — ici c'est un champ **déjà** présent qui passe ;
- matrice autorité § 3.3 : *« Liste fermée de motifs, pièce référencée, **aucune donnée médicale** »*.

**Reproduction** : `backend/tests/unit/services/fiche-referent.test.js:250` exerce le cas
`titre: null` uniquement — le chemin `m.titre` non nul n'est couvert par aucune assertion. Aucun test
ne tomberait si le champ portait un verbatim médical.

**Correctif recommandé** (`fiche-referent.js:436-445`) : la variante tiers ne doit voir que le
vocabulaire fermé ; la variante dossier peut garder le titre saisi, qui est utile à la CIP.

```js
entretiens: entretiens.map((m) => {
  const ligne = {
    date: dateTenue(m),
    // Le titre est un champ LIBRE : il ne sort jamais vers un tiers. Le
    // document destiné au référent ne connaît que les 8 types fermés ; le
    // dossier interne, lui, garde le titre que la CIP a écrit.
    type_libelle: dossier ? (m.titre || libelleType(m.milestone_type)) : libelleType(m.milestone_type),
    presence: m.presence || null,
    absence_motif: m.absence_motif || null,
  };
  if (dossier) ligne.absence_piece_ref = m.absence_piece_ref || null;
  return ligne;
}),
```

et verrouiller par un test : un entretien portant `titre: 'Bilan après hospitalisation'` doit rendre
`type_libelle === 'Bilan intermédiaire'` en variante `tiers`, et le titre en variante `dossier`.

---

### B-02 — Les heures d'accompagnement NOMINATIVES entrent dans `gatherAuditKpis` et sont servies au MANAGER, puis exportées sous une bannière « non nominatif »

**Source** : `backend/src/services/temps-accompagnement.js:333-335`
**Injection** : `backend/src/routes/insertion/routes.js:3587-3598`
**Surface 1** : `backend/src/routes/insertion/routes.js:3649` (`GET /api/insertion/audit`)
**Surface 2** : `backend/src/routes/exports.js:923` (`GET /api/exports/insertion-synthese`, JSON)

`heuresAccompagnement` compose, entre autres :

```js
// temps-accompagnement.js:333-335
par_salarie: [...parSalarie.entries()]
  .map(([id, minutes]) => ({ employee_id: id, nom: nomsSalaries.get(id) || null, minutes }))
  .sort((a, b) => b.minutes - a.minutes),
```

soit, pour l'année entière, **la liste nominative de toutes les personnes accompagnées** (« NOM
Prénom ») avec le volume d'heures consacré à chacune — plus `par_intervenant`, la même chose pour le
personnel. L'intégration verse cet objet tel quel dans les indicateurs d'audit :

```js
// routes.js:3598
heures_accompagnement: heuresAccompagnement,
```

**Le lot 4 sait que cette donnée est réservée** : `GET /temps/synthese` porte
`authorize('ADMIN','RH')` (`temps.js:173`) et son test de contrat s'intitule
*« MANAGER refusé sur la synthèse (**agrégats nominatifs par salarié**) »*
(`tests/contract/insertion-temps-contract.test.js:156-159`). Le contrat § 5.2 le dit également :
`par_salarie: [...] (ADMIN/RH seulement)`.

Or :

| Surface | Habilitation effective | Ce qui sort |
|---|---|---|
| `GET /api/insertion/audit` | **ADMIN / RH / MANAGER** (héritée de `index.js:27`, **aucun `authorize` local** l. 3649) | l'objet complet, `par_salarie` compris |
| `GET /api/exports/insertion-synthese` (JSON) | **ADMIN / MANAGER / RH** (`exports.js:17`, aucun `authorize` local) | `res.json({ mention: SYNTHESE_MENTION, ...k })` — spread intégral |

La seconde est la plus lourde : `SYNTHESE_MENTION` vaut
`'Document agrégé non nominatif — comité de pilotage'` (`exports.js:859`), et la matrice de
l'autorité (§ 2 (e)) qualifie ce livrable de **« strictement non nominatif, agrégats seuls »**. Un
document qui s'annonce non nominatif et transporte une liste de personnes est une non-conformité en
soi, indépendamment de qui le lit.

**Deux bonnes nouvelles, vérifiées** : la variante **CSV** de `/insertion-synthese` construit ses
lignes une à une (`exports.js:872-915`) et ne contient pas `heures_accompagnement` ; et `rse.js`
(bilan RSE / dossier AFNOR) sélectionne ses clés explicitement (`rse.js:165-190`) — aucun des deux
n'est touché. La fuite est bornée aux deux surfaces ci-dessus. Le front `AuditInsertion.jsx` n'est pas
modifié et n'affiche pas le bloc : la donnée part dans la réponse HTTP sans être rendue à l'écran —
c'est exactement la forme du constat C-01 de la PR A.

**Correctif recommandé** — projeter **à la source**, dans `gatherAuditKpis`, plutôt qu'à chaque
frontière (une projection par route se réintroduit à la troisième route) :

```js
// routes.js:3587-3598
let heuresAccompagnement = null;
try {
  const brut = await require('../../services/temps-accompagnement').heuresAccompagnement({ annee: year });
  // Les indicateurs d'audit sont lus par un MANAGER et repris tels quels dans la
  // synthèse de dialogue de gestion, qui s'annonce « strictement non nominative »
  // (09 § 2 (e)). On garde donc les seuls agrégats que l'autorité demande
  // (indicateur n° 14 : volume total et moyenne par personne) ; la ventilation
  // nominative reste sur /temps/synthese, gardée ADMIN/RH.
  heuresAccompagnement = brut && {
    annee: brut.annee,
    global_minutes: brut.global_minutes,
    par_projet: brut.par_projet,
    nb_salaries_concernes: brut.nb_salaries_concernes,
    moyenne_minutes_par_salarie: brut.moyenne_minutes_par_salarie,
  };
} catch (err) { ... }
```

et verrouiller par deux tests : `gatherAuditKpis` ne renvoie ni `par_salarie` ni `par_intervenant` ;
un MANAGER appelant `/insertion/audit` ne reçoit aucun patronyme.

---

### B-03 — La feuille de temps transmise au financeur nomme la catégorie d'absence de l'intervenant (« arrêt de travail »)

**Fichier** : `backend/src/services/temps-engine.js:295-299` et `:328-330`
**Sorties** : `backend/src/routes/insertion/temps.js:549-551` (CSV export (c)) et
`frontend/src/components/insertion/pdf-temps.js:87-89` (PDF).

```js
// temps-engine.js:295-299
anomalies.push({
  date: l.date,
  type: 'jour_absence',
  detail: `Temps déclaré un jour d'absence de l'intervenant (${LIBELLES_ABSENCE[abs.categorie] || 'absence déclarée'}).`,
});
// :328-330
const LIBELLES_ABSENCE = { holiday: 'congés payés', sick: 'arrêt de travail', absence: 'absence' };
```

L'anomalie est figée dans `insertion_feuilles_temps.coherence`, puis imprimée :
- dans le **CSV** transmis à l'autorité (`temps.js:549-551`, ligne du pied sous « Cohérence avec les
  congés ») ;
- dans le **PDF** (`pdf-temps.js:87-89`, `esc(a.detail || a.type)`).

Les deux fichiers portent le **nom de l'intervenant** en en-tête (`temps.js:568`, `pdf-temps.js:112`).
Le financeur reçoit donc, pour une personne identifiée, la date et la nature d'un arrêt de travail —
une donnée de santé au sens de l'article 9.

**Ce n'est demandé nulle part.** La spécification (c) écarte la dépense sur « une journée renseignée
un jour d'absence » : elle a besoin de la **date** et du fait qu'il y a absence, pas de sa nature.
Et le commentaire du code affirme l'inverse de ce qu'il fait, deux lignes plus haut :

```js
// temps-engine.js:281-283
// (a) Jours d'absence. Le MOTIF n'est jamais repris : `type_category` suffit
// à dire « ce jour-là l'intervenant était absent », et un libellé de congé
// peut porter une information de santé.
```

`type_category = 'sick'` **est** l'information de santé ; c'est sa traduction en clair qui la rend
lisible. La même classe de défaut que le registre art. 30 de la PR A qui promettait ce que le code ne
tenait pas.

**Correctif recommandé** (`temps-engine.js:295-299`) — le détail dit le FAIT, la catégorie reste
disponible en machine pour l'écran interne si la RH en a besoin :

```js
anomalies.push({
  date: l.date,
  type: 'jour_absence',
  // Le document part vers le financeur : il dit QU'IL Y A absence, jamais
  // laquelle. `type_category = 'sick'` est une donnée de santé (art. 9) et la
  // spécification (c) ne demande que le jour en anomalie.
  detail: "Temps déclaré un jour d'absence déclarée de l'intervenant.",
});
```

Si la Direction souhaite conserver la distinction pour l'usage **interne**, la porter dans un champ
séparé (`categorie_interne`) que ni `temps.js:549-551` ni `pdf-temps.js:87-89` n'impriment, et le
vérifier par un test qui cherche « arrêt » dans le CSV produit.

---

## 2. Constats MAJEURS

### M-01 — Le libellé libre d'une action est imprimé dans le relevé transmis au référent

**Fichiers** : `backend/src/services/fiche-referent.js:446-450` (composition),
`frontend/src/components/insertion/pdf-referent.js:243-245` (impression).

Le relevé d'assiduité **tiers** imprime `a.action_label`, colonne `TEXT NOT NULL` librement saisie
(`init-db.js:3684`). Les actions rattachées aux freins `sante` et `judiciaire` sont bien écartées en
SQL (l. 411), mais `frein_type` est **facultatif** et sans CHECK : une action saisie sans frein, ou
rattachée à `administratif`, peut parfaitement s'intituler « Accompagnement au rendez-vous CMP » ou
« Dossier MDPH ».

La **fiche** pour le référent, elle, a tranché correctement : elle n'imprime que
`nature (category)` — une liste fermée de 4 valeurs (`init-db.js:3685`) — et jamais le libellé
(`fiche-referent.js:281-291`). Les deux documents partent au même destinataire ; ils devraient tenir
la même règle.

**Nuance honnête** : le contrat § 6.3 prescrit `actions: [{ date, libelle, statut }]`. Le constat est
donc une **divergence entre le contrat et la spécification de l'autorité** (§ 3.3, « aucune donnée
médicale »), pas une transgression du contrat. Il appelle un arbitrage (§ 5).

**Correctif recommandé** : en variante tiers, remplacer `libelle` par la `category` traduite (comme la
fiche) et ne conserver le libellé libre qu'en variante `dossier` ; ou, si la Direction tient au
libellé, exclure aussi les actions dont `category = 'frein'` sans `frein_type` renseigné. La première
option est la seule qui ferme réellement le canal.

---

### M-02 — La journalisation du cadre RSA est non bloquante : une fiche peut sortir sans aucune trace

**Fichier** : `backend/src/routes/insertion/rsa.js:68-78`

```js
async function journaliser(req, action, employeeId, details) {
  try {
    await pool.query('INSERT INTO rgpd_audit_log ...');
  } catch (e) {
    console.error(`[INSERTION][RSA] Journalisation ${action} impossible :`, e.message);
  }
}
```

L'échec est avalé. Si l'insertion au journal échoue (table verrouillée, disque plein, colonne
`details` en erreur), la réponse part quand même : `INSERTION_FICHE_REFERENT_GENERATION` (l. 377),
`_CONSULTATION` (l. 429), `_REMISE` (l. 483) et `_APERCU` (l. 328) sont donc des traces
**optionnelles** sur le document que la matrice de l'autorité appelle « le plus sensible de la liste ».

Le lot 4 fait exactement l'inverse, et le dit : `temps.js:71` — *« Journal RGPD — écrit AVANT l'envoi
d'un document ; son échec fait échouer l'acte »* — sans try/catch interne, si bien qu'un échec remonte
au `catch` de la route et produit un 500 (`temps.js:559-565`). La PR A avait été saluée pour ce même
point (« journal d'export écrit avant envoi et bloquant »).

**Correctif recommandé** : aligner `rsa.js` sur `temps.js` pour les **quatre gestes qui concernent un
document destiné au tiers** (aperçu, génération, consultation d'une fiche transmise, remise) —
retirer le try/catch et laisser le `catch` de chaque route rendre 500. La journalisation de
`INSERTION_ACTIVITE_CONSULTATION` et `INSERTION_ASSIDUITE_CONSULTATION` peut rester tolérante si la
Direction préfère qu'un incident de journal n'empêche pas de consulter un compteur ; le geste qui
FAIT SORTIR un document, lui, doit échouer avec lui. Pour la génération, poser l'écriture du journal
**dans la même transaction** que l'`INSERT INTO insertion_alimentations_referent` (l. 368-376) :
aujourd'hui les deux sont indépendants, un snapshot peut exister sans trace et réciproquement.

---

### M-03 — Une fiche pour le référent peut être imprimée et remise sans qu'aucun snapshot n'en garde la preuve

**Fichiers** : `frontend/src/pages/InsertionParcours.jsx` › `exporterFicheReferent` (raccourci
d'en-tête) et `frontend/src/components/insertion/FicheReferentPanel.jsx:257-259`
(« Imprimer sans enregistrer »).

Les deux chemins appellent `GET /rsa/:id/fiche-referent` (aperçu, aucune écriture) puis
`exportFicheReferentPDF`. Le PDF produit est **rigoureusement identique** à celui d'une fiche
enregistrée : même en-tête, même bloc de signature de la conseillère, même pied
« Exemplaire remis à la personne concernée le : … » (`pdf-referent.js:68-71`). Rien, sur le papier,
ne distingue un document tracé d'un document qui ne l'est pas.

Conséquences, dans l'ordre de gravité :
1. la table `insertion_alimentations_referent` — dont la migration dit qu'elle existe pour répondre à
   « qu'avons-nous transmis le 12 mars ? » (`insertion-rsa.js:25-30`) — peut rester vide pendant que
   des fiches circulent ;
2. l'indicateur de l'autorité **« points d'étape tenus / dus »** (§ 3.2) repose sur
   `remis_referent_le` (`rsa.js:158-159`) : il comptera zéro sur un dossier correctement alimenté, et
   c'est la structure qui paraîtra défaillante ;
3. l'exigence § 2 (f) « **Remise tracée** » n'est pas tenue sur ce chemin.

Le choix est délibéré et documenté (« Raccourci de l'en-tête : les douze derniers mois, sans
enregistrement »), et il est défendable en ergonomie. Ce qui ne l'est pas, c'est que le document
produit ne le dise pas.

**Correctif recommandé**, au choix de la Direction :
- (a) le raccourci de l'en-tête POSTe au lieu de GETter (une fiche imprimée est une fiche transmise) ;
- (b) `exportFicheReferentPDF(contenu, { apercu: true })` imprime un bandeau visible
  « **Aperçu — non enregistré au registre des transmissions** » et **supprime le bloc de signature et
  le pied de remise**, qui sont ce qui donne au document sa valeur probante. Un aperçu ne doit pas
  pouvoir être signé.

---

### M-04 — `pool.connect()` hors du `try` : deux requêtes peuvent rester sans réponse (régression d'un défaut corrigé en PR A)

**Fichier** : `backend/src/routes/insertion/temps.js:325` et `:441`

```js
router.post('/:userId/:annee/:mois/valider', gardeProprietaire, PERIODE, validate, async (req, res) => {
  const client = await pool.connect();   // ← hors du try
  try { ... } finally { client.release(); }
});
```

Si `pool.connect()` rejette (pool saturé, base momentanément injoignable), la promesse du handler est
rejetée **hors de tout try/catch**. Express 4.21 ne capture pas le rejet d'un handler `async` : aucune
réponse n'est envoyée, la requête reste ouverte jusqu'au délai du client, et le rejet remonte en
`unhandledRejection`.

C'est **mot pour mot** le défaut trouvé et corrigé pendant la PR A
(`13-debug-postgres-PR-A.md` : *« `pool.connect()` hors du `try` laissant une requête sans
réponse »*). Le `finally { client.release() }` est correct et couvre bien tous les retours anticipés
(FEUILLE_VIDE l. 347, VALIDATION_RH_RESERVEE l. 382, AUTO_VALIDATION l. 394, TRANSITION_INVALIDE
l. 415) — il n'y a **pas** de fuite de connexion, seulement l'absence de réponse.

**Correctif recommandé**, sur les deux routes :

```js
  let client;
  try {
    client = await pool.connect();
    ...
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('[INSERTION][TEMPS] valider :', err.message, err.code || '');
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  } finally {
    if (client) client.release();
  }
```

---

### M-05 — Le PDF de feuille de temps sort sans aucune journalisation, alors que le CSV est tracé

**Fichiers** : `backend/src/routes/insertion/temps.js:243-269` (`GET /:userId/:annee/:mois`, aucun
appel à `journaliser`) et `frontend/src/components/insertion/pdf-temps.js`.

L'export **CSV** est journalisé `EXPORT_FEUILLE_TEMPS`, avant l'envoi et de façon bloquante
(`temps.js:559-565`) — parfait. Le **PDF**, lui, est composé côté navigateur à partir de la réponse
du `GET`, qui n'écrit rien au journal. Les deux fichiers portent le même contenu, la même mention
« pièce de justification d'une dépense cofinancée » (`pdf-temps.js:139`) et vont au même destinataire.

Le contrat § 5.2 ne demandait la journalisation que pour `valider`, `rouvrir` et `export.csv` : le lot
est conforme à sa commande. Mais la règle de fond du chantier — *« tout document destiné à un tiers est
journalisé »* — n'est pas tenue sur ce chemin, et la question « qui a sorti la feuille de septembre ? »
n'a pas de réponse si elle est sortie en PDF.

**Correctif recommandé** : journaliser `EXPORT_FEUILLE_TEMPS` avec `{ format: 'pdf' }` sur un appel
dédié — soit une route `GET /:userId/:annee/:mois/export.pdf` qui rend le même JSON en le traçant, soit
un `POST /:userId/:annee/:mois/trace-impression` appelé par `FeuilleTemps.jsx` juste avant
`exportFeuilleTempsPDF`. La première option est préférable : elle ne peut pas être contournée en
appelant directement le `GET`.

---

## 3. Constats MINEURS

| # | Fichier:ligne | Constat | Correctif |
|---|---|---|---|
| **m-01** | `fiche-referent.js:262-263` | `raisons_categorisees` est apparié sur le seul `iso_week` ; `activiteSurPeriode` (l. 172-183) concatène **deux années** pour une période à cheval. La raison de la S3 2025 est donc recopiée sur la S3 2026. Sur un document opposable, c'est un motif attribué à la mauvaise semaine. | Ajouter `iso_year` aux objets `raisons` du moteur (`activite-hebdo-engine.js:231`) et apparier sur le couple. |
| **m-02** | `pdf-referent.js:238-239` | Un entretien dont la **présence n'a pas été saisie** (`presence` null) imprime « Motif non renseigné » dans la colonne « Motif d'absence » : le lecteur y lit une absence non justifiée alors que rien n'a été constaté. Contraire à la règle « la structure constate, elle n'accuse pas ». | `e.presence === 'absent' \|\| e.presence === 'excuse' ? MOTIF_LABELS[...] : '—'`. |
| **m-03** | `pdf-referent.js:134` | Les raisons sont imprimées en **codes bruts** sur un document externe : « S12 (temps_partiel) », « S14 (inconnue) ». | Table de libellés : « quotité contractuelle inférieure », « arrêt déclaré », « congés », « non déterminée ». |
| **m-04** | `temps.js:211-218` | `DELETE /saisies/:id` lit la ligne **avant** de vérifier le périmètre : un MANAGER distingue 404 (saisie inexistante) de 403 (saisie d'un autre), ce qui énumère les identifiants. Aucune donnée n'est rendue. | Garder l'ordre (il faut lire pour connaître le propriétaire) mais rendre **404 dans les deux cas** pour un non-ADMIN/RH. |
| **m-05** | `fiche-referent.js:78-86` | `soft()` avale **toute** erreur et rend `[]`. Une fiche peut donc partir au référent amputée de ses actions, objectifs ou freins sans que le document ni l'écran ne le signalent — l'inverse de la doctrine « la dégradation est nommée ». Sur ce document, une rubrique vide se lit « rien n'a été fait ». | Remonter la liste des sources en échec dans `mentions` et l'imprimer (« Rubrique indisponible au moment de l'édition »), ou refuser de composer si une source essentielle manque. |
| **m-06** | `rsa.js:201-214` | `GET /echeances-periodiques` appelle `activiteHebdo` **en boucle séquentielle**, soit ~6 requêtes × nombre de salariés en parcours, à chaque ouverture du tableau de bord CIP. | Paralléliser par lots (`Promise.all` sur des tranches de 10), ou mémoriser 5 min — le bloc est un rappel, pas un temps réel. |
| **m-07** | `temps.js:249` et `rsa.js:89-92` | `new Date().toISOString().slice(0,10)` et `aujourdhui()` mélangent jour UTC et jour civil. `cloture_depassee` et le refus de date future basculent avec deux heures d'écart en été. Piège déjà corrigé deux fois dans le dépôt (2.24.1, 2.47.0). | Jour civil Europe/Paris (`Intl`), comme `heureMuraleParis`. |
| **m-08** | `backend/src/routes/rgpd.js` (onglet « Règles de gestion des données ») | `GET /rgpd/politique` n'énonce ni la fiche pour le référent, ni le relevé d'assiduité, ni la feuille de temps : un DPO qui lit l'écran ne voit pas les deux nouveaux flux sortants ni leur durée de conservation. | Ajouter deux règles, en lisant `insertion.retention_months` comme les autres. |
| **m-09** | `migrations/insertion-temps.js` | **Aucune entrée art. 30** pour la feuille de temps, qui traite pourtant des données du personnel (temps de travail, catégories d'absence) et les **transmet au financeur**. Le lot 3 a écrit la sienne, complète ; le lot 4 n'en avait pas la commande. | Entrée « Justification du temps d'accompagnement cofinancé (feuilles de temps) », destinataire « autorité de gestion FSE+ / DDETS », conservation ≥ 5 ans (piste d'audit), même pattern `ON CONFLICT`. |
| **m-10** | `exports.js:917-920` | *(hérité, hors périmètre PR B — relevé en suivant le flux)* la variante CSV de `/insertion-synthese` utilise un `esc` **local** sans neutralisation de formule, alors que le fichier importe `neutraliserFormule` (l. 6) pour ses autres exports. C'est le constat M-04 de la PR A survivant sur un export destiné à la DDETS. | Remplacer par `escCsv` de `utils/export-csv.js`. |
| **m-11** | `temps.js:354` / `insertion-rsa.js` (colonne `contenu`) | Le **nom** de l'intervenant est figé dans `validation_intervenant` et dans `contenu.identite.conseillere` de chaque fiche, sur des pièces conservées ≥ 5 ans / parcours + 2 ans. L'anonymisation d'un salarié ne les atteint pas (elles sont indexées par `user_id`). | À documenter dans les deux entrées de registre (le nom du signataire est **nécessaire** à la valeur probante de la pièce — c'est un choix légitime, il doit être écrit). |

---

## 4. Ce que j'ai vérifié et jugé conforme

**Périmètre des rôles** — vérifié route par route, lecture et exécution des suites de contrat
(179 tests verts sur les 5 fichiers de la PR, plus `insertion-cadre-contract` 42 tests pour référence) :

- `/rsa` : `router.use(authorize('ADMIN','RH'))` posé **l. 54**, avant tout validateur et toute
  lecture (`rsa.js:54`). Le test `test.each(routes)` (l. 125-136) prouve le 403 sur **toutes** les
  routes du routeur, lecture et écriture, `pool.query` non appelé.
- `/temps` : `gardeProprietaire` (l. 89-99) compare `Number(req.params.userId)` à
  `Number(req.user.id)` — comparaison **numérique**, `'07'` et `7` se reconnaissent, `'7abc'` donne
  `NaN` et refuse ; `resolveBaseRole` couvre les rôles personnalisés dérivés de MANAGER. Tests l. 133-166 :
  403 avant toute requête sur la feuille d'un autre, 403 sur `/intervenants` et `/synthese`.
- Statuts sociaux : **aucun nouveau chemin** ne rend `brsa`, `ft_categorie`, `referent_unique_*` ni
  `actualisation_ft_*` à un MANAGER. `/rsa/echeances-periodiques` est ADMIN/RH, et le bloc
  « Rendez-vous réguliers et rappels » **disparaît** proprement sur 403 au lieu d'afficher une panne
  (`InsertionParcours.jsx` › `EcheancesRsaBloc`, `if (err.response?.status === 403) { setData(null); setError(null); }`).
  Même traitement dans `ActiviteHebdo.jsx:64` et `FicheReferentPanel.jsx:65,359`. Les deux composants
  sont en outre montés sous `{adminRh && ...}` (`DossierAdministratif.jsx:641-642`), et les deux
  boutons PDF de l'en-tête également (`InsertionParcours.jsx`, `{adminRh && ...}`).
- Rôles hors insertion (COMMUNICATION, AUTORITE, DPO, QHSE, COLLABORATEUR, jeton chauffeur) :
  refusés par `index.js:27` (`authorize('ADMIN','RH','MANAGER')` monté avant les sous-routeurs), comme
  en PR A — aucune des nouvelles routes ne contourne ce montage.

**Ce qui sort vers un tiers — liste blanche** :

- `FICHE_CLES` (l. 467-470) énumère exactement les 9 rubriques du contrat § 6.1 ; les axes santé et
  judiciaire sont exclus **par construction** (`FREINS.filter(f => f.sensible == null)`, l. 62) et non
  par une liste de noms qu'on oublierait d'étendre ;
- les actions rattachées à `sante` ou `judiciaire` sont retirées **ligne entière et en SQL**
  (l. 159, l. 411) — ni date, ni partenaire, ni résultat ne subsistent ;
- `cip_action_plans.notes` n'est **jamais sélectionné** (l. 153-155, l. 408) ;
- `absence_piece_ref` n'est même pas lu hors variante `dossier` (l. 134-135) — « ce qu'on ne lit pas
  ne peut pas fuir par une clé oubliée », et le front ne demande jamais cette variante ;
- `employee_leaves.leave_type` ne sort d'aucune requête du module ; seule `type_category` est lue
  (l. 418-419, `activite-hebdo.js:94`) ;
- le bloc `activite` de la fiche ne transmet **ni `sous_seuil`, ni `arret_declare`** (l. 254-260) : le
  tiers reçoit des heures, pas le jugement que la structure porte dessus ;
- `absences_par_motif` retombe sur `sans_motif` pour tout motif hors liste fermée (l. 343), et le PDF
  l'imprime « Motif non renseigné » — le mot « injustifiée » n'existe dans **aucun** fichier de la PR
  (vérifié par recherche sur l'ensemble du diff) ;
- vocabulaire : ni « seuil », ni « obligation », ni « insuffisant » sur les documents ; le PDF titre
  « Activité hebdomadaire » et « Semaines en dessous de 15 h » (`pdf-referent.js:131-136`).

**Feuille de temps** : le nom du bénéficiaire n'existe nulle part — ni dans `composerLignes`
(`temps-engine.js:154-195`, seulement `employee_id`), ni dans les 6 colonnes du CSV
(`temps.js:498, 524-531`), ni dans le PDF (`pdf-temps.js:71-72`). Ce n'est pas un masquage : la donnée
n'est jamais chargée. Refus explicite sur zéro ligne (409 `EXPORT_VIDE`, l. 511-517) plutôt qu'un
fichier vide. Pied complet et conforme à la spécification (c) : total, par projet, quotité, taux
forfaitaire, **ligne de cohérence imprimée même conforme**, signatures horodatées et « MANQUANTE » en
toutes lettres, mention des durées déclaratives.

**Injection et robustesse** : toutes les requêtes des 4 nouveaux fichiers backend sont paramétrées
(aucune concaténation de valeur ; les seules interpolations sont des listes de **constantes** dans les
migrations). `mois` validé `^\d{4}-\d{2}$` (`rsa.js:60,544`), dates `^\d{4}-\d{2}-\d{2}$` (l. 59),
`du > au` refusé (l. 108). `conciliation_motifs` : liste fermée contrôlée **élément par élément**
(`body('conciliation_motifs.*').isIn(...)`, `routes.js:753-754`) et doublée d'un CHECK en base pour
`referent_modalite` et `conciliation_issue`. Le CSV réutilise `escCsv` de `utils/export-csv.js`
(neutralisation `=+-@\t\r` + guillemetage) sur **toutes** les cellules variables, y compris les
anomalies et l'en-tête de traçabilité. `duree_minutes` borné 1-600 côté validateur **et** côté CHECK.
`FOR UPDATE` sur les deux transitions (`temps.js:336, 449`), transitions forward-only, auto-validation
refusée en 409 y compris quand le contre-signataire est le premier signataire (l. 392-399).
Réouverture ADMIN seul, motif obligatoire, validations effacées.

**« Jamais de valeur inventée »** : `nombreOuNull` (`activite-hebdo-engine.js:66-70`) et le
commentaire qui cite nommément les précédents `Number(null) === 0` du dépôt ; `sans_releve` →
`heures_travail`, `total_heures` et `sous_seuil` tous `null` ; une semaine sans relevé **interrompt**
la série d'alerte au lieu de la prolonger (l. 265) ; un entretien sans durée ne produit **aucune**
ligne de feuille de temps (`temps-engine.js:151`) ; quotité et taux forfaitaire inconnus sont
**absents** de l'objet et imprimés « non renseignée » (l. 232-244) ; `moyenne_minutes_par_salarie`
rend `null` et non 0 sans dividende ; `honoree` reste `NULL` tant que rien n'a été constaté, et les
12 mois sont rendus avec `null` partout pour les mois sans ligne (`rsa.js:523-533`) ; la base du
plafond contractuel est **dite** dans l'anomalie quand elle repose sur le repli de 35 h
(`temps-engine.js:319`).

**Migrations** : `run(client)` sans transaction interne, `IF NOT EXISTS` partout, CHECK reconstruits
par DO-scan de `pg_constraint` avec marqueur (`'conciliation'`, l. 93) — rejouable, et la nouvelle
liste des 8 types **contient** les 6 anciennes, donc aucune perte sur base peuplée. Le backfill
`date_realisation` s'exécute une seule fois (`WHERE date_realisation IS NULL`) et son approximation
(`updated_at::date`) est documentée à l'endroit où elle est faite. FK `ON DELETE CASCADE` sur les deux
tables salarié, `ON DELETE SET NULL` sur `projet_id`. `UNIQUE(employee_id, mois)` et
`UNIQUE(user_id, annee, mois)` garantissent l'unicité des pièces.

**Anonymisation** (§ 8, `anonymization.js:302-352`) : `DELETE` intégral de
`insertion_alimentations_referent` et `insertion_actualisations_ft` — ceinture et bretelles par-dessus
la FK CASCADE, avec l'argument juste (l'anonymisation ne supprime pas la ligne, elle la conserve
pseudonymisée : sans DELETE explicite il resterait une coquille disant « quelque chose a été transmis
au Département ce jour-là »). Le JSONB `lignes` des feuilles est traité par `jsonb_agg ... WITH
ORDINALITY` (ordre préservé), `COALESCE(..., '[]')` pour ne pas transformer une feuille vide en
feuille jamais composée, et le prédicat `@>` cible les seules feuilles concernées. La feuille survit
comme pièce de financement, le lien nominatif disparaît — même arbitrage que `insertion_fse_sorties`.
La rétention annoncée au registre (« parcours + 2 ans ») est effectivement portée par la purge
existante `purgeInsertionDossiers` (`rgpd-purges.js:388-480`, `insertion.retention_months` = 24), qui
appelle `anonymizeEmployee`.

**Journal RGPD** : 10 codes, tous traduits en français (`rgpd-libelles.js:110-129`) — la garde
anti-dérive de 2.44.0 aurait fait tomber la suite sinon ; 3 entités ajoutées. Les détails journalisés
disent **qui, quoi, quand, sur quelle période** et jamais le contenu transmis (`rsa.js:62-66`,
`temps.js:367-374`) : un journal qui recopierait le document deviendrait une seconde copie de ce
qu'il protège.

**Registre art. 30** (`insertion-rsa.js:221-241`) : entrée distincte parce que la finalité est une
**transmission à un tiers** ; catégories de données énumérées ligne à ligne avec la mention explicite
de ce qui n'y figure pas ; destinataires nommés ; durée de conservation ; mesures de sécurité qui
décrivent la liste blanche, la journalisation et le refus de générer sans destinataire. Base légale
posée avec sa réserve : « mission d'intérêt public — **à confirmer par le DPO** ». C'est la formulation
correcte : elle n'affirme pas ce qui n'est pas tranché.

**Mentions de droits et information de la personne** : `MENTION_DROITS` (`fiche-referent.js:71-75`)
énonce la finalité, l'absence de données de santé et judiciaires, les cinq droits et le contact du
DPO ; le pied de page du PDF porte le bloc « Exemplaire remis à la personne concernée le … » avec
signature (`pdf-referent.js:68-71`), et la table trace `remis_salarie_le` distinctement de
`remis_referent_le`. Une date de remise **future** est refusée en 400 (« une date future ne peut pas
attester d'une remise », `rsa.js:456`) — bonne règle, rarement écrite.

**Refus structurants, tous vérifiés** : 409 `REFERENT_NON_DETERMINE` posé **avant** la composition
(`rsa.js:317-325, 353-361`) — aucune donnée n'est lue au profit d'une fiche qui ne partira nulle part ;
409 `ACTUALISATION_FT_NON_REQUISE` (l. 581-587) — ne pas fabriquer un « manquement » sur une obligation
qui n'existe pas ; 409 `FEUILLE_FIGEE`, `AUTO_VALIDATION`, `EXPORT_VIDE`, `DATE_HORS_MOIS` ; et
l'absence **délibérée** de tout 409 « cohérence non conforme », conformément au contrat.

---

## 5. Points à faire trancher par la Direction ou le DPO

1. **Base légale de la transmission au référent** (spécification (f), déjà posée en réserve dans le
   registre). Mission d'intérêt public ou accord de la personne : la conduite à tenir en cas de refus
   en dépend entièrement. Tant qu'elle n'est pas tranchée, l'outil produit un document dont le
   fondement n'est pas arrêté. **C'est la décision la plus urgente de cette PR.**
2. **Information préalable de la personne.** La fiche porte les mentions de droits en pied de page,
   ce qui est nécessaire mais postérieur. La note d'information remise au salarié doit être complétée
   (l'autorité le demande explicitement) et, par symétrie avec l'arbitrage PCM de la 2.45.0, on peut
   se demander si une **trace d'information préalable** n'est pas due avant la première transmission.
3. **Catégorie d'absence de paie sur le relevé d'assiduité tiers** (`pdf-referent.js:249` :
   « Arrêt de travail » / « Absence » / « Congés »). Le contrat § 6.3 la prescrit, et l'autorité
   accepte explicitement la catégorie « santé » pour les motifs d'absence à un rendez-vous (§ 2 (f)
   item 4) — je ne l'ai donc **pas** classée en constat. Mais elle reste une donnée de santé
   transmise à un tiers pouvant suspendre des droits, et elle est d'un autre ordre que le motif
   d'un rendez-vous manqué : elle porte sur l'état de santé de la personne, pas sur son assiduité.
   **À confirmer par le DPO**, avec une option de repli simple (n'imprimer que « absence justifiée
   par la paie » et la période).
4. **M-01 — libellé libre des actions sur le relevé tiers** : le contrat le prescrit, la
   spécification § 3.3 dit « aucune donnée médicale ». Les deux ne peuvent pas être tenus ensemble
   tant que `action_label` est un champ libre. Trancher : catégorie seule (comme la fiche), ou
   libellé conservé avec une consigne écrite aux CIP.
5. **M-03 — « Imprimer sans enregistrer »** : la Direction veut-elle qu'une fiche puisse sortir sans
   trace ? Si oui, le document doit le dire et perdre son bloc de signature ; si non, le raccourci
   doit enregistrer. Le statu quo est le seul choix à écarter.
6. **m-11 — nom des intervenants figé** dans des pièces conservées 5 ans : nécessaire à la valeur
   probante, mais à inscrire au registre plutôt qu'à subir.
7. **Cadrage de l'alerte 15 h vis-à-vis de la personne.** Le code tient scrupuleusement la règle (pas
   de vocabulaire de seuil, alerte à deux semaines, jamais pendant un arrêt). Reste une question
   d'usage, hors logiciel : qui regarde ce compteur, et que fait la structure quand il s'allume ?
   L'outil ne décide rien — il faut que la consigne écrite dise la même chose.

---

## 6. Correctifs à appliquer avant merge — liste ordonnée

| Ordre | Constat | Fichier | Nature |
|---|---|---|---|
| 1 | **B-02** | `routes/insertion/routes.js:3587-3598` | Projeter `heures_accompagnement` dans `gatherAuditKpis` (retirer `par_salarie` et `par_intervenant`) + 2 tests |
| 2 | **B-01** | `services/fiche-referent.js:439` | `type_libelle` = libellé de type en variante tiers + test de contre-épreuve |
| 3 | **B-03** | `services/temps-engine.js:295-299` | Détail d'anomalie sans la catégorie de congé + test sur le CSV produit |
| 4 | **M-04** | `routes/insertion/temps.js:325, 441` | `pool.connect()` dans le `try`, `client` déclaré avant |
| 5 | **M-02** | `routes/insertion/rsa.js:68-78` | Journalisation bloquante sur les 4 gestes de document tiers ; génération + journal dans une transaction |
| 6 | **M-03** | `pdf-referent.js` + les 2 appelants | Bandeau « Aperçu — non enregistré » et retrait du bloc de signature, ou POST |
| 7 | **M-01** | `services/fiche-referent.js:446-450` | Selon arbitrage § 5.4 |
| 8 | **M-05** | `routes/insertion/temps.js` | Route d'export PDF journalisée |
| 9 | m-01 → m-11 | — | Dans l'ordre du tableau § 3 ; m-09 (entrée art. 30 feuille de temps) et m-08 (écran politique) sont les plus visibles pour un auditeur |

**Preuves à produire après correctifs** : les 5 suites de la PR reverdies, plus au minimum
4 contre-épreuves par mutation — rétablir `m.titre` fait tomber le test B-01 ; rétablir le spread
complet fait tomber les tests B-02 ; rétablir `LIBELLES_ABSENCE` dans le détail fait tomber le test
B-03 ; retirer la journalisation bloquante fait tomber le test M-02.

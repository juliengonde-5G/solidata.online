# PR C « Section CIP et documents du salarié » — revue de sécurité et de conformité RGPD

> **Agent de sécurité (lecture seule)** — chantier `cip-refonte-2026-09-12`, branche
> `claude/solidata-cip-redesign-9fskwq-pr-c`, périmètre `git diff bd46ee0~1..HEAD`
> (lots 5 et 7 + intégration : 53 fichiers, +10 658 / −2 056 lignes).
> **Références opposables** : contrat `20-contrats-techniques-PR-C.md` (§ 2 doctrines, § 5.1-5.7, § 6-8),
> rapports de lot `21-realisation-lot5.md` / `21-realisation-lot7.md`, revues PR A `12-` et PR B `17-`
> (même grille, mêmes catégories), `CLAUDE.md` § 7-8 et modules 5 / 14.
> **Aucun fichier de code modifié, aucune commande git.** Chaque constat porte un fichier:ligne et,
> quand c'est possible, une REPRODUCTION exécutée (scripts jetables hors dépôt, PostgreSQL 16.13 réel
> pour les deux reproductions en base). Les 7 suites Jest du chantier ont été rejouées :
> **188 tests verts** — les constats ci-dessous sont donc, par construction, ce que ces tests ne couvrent pas.
> **Date** : 13 septembre 2026.

---

## 0. Verdict

**CONFORME SOUS RÉSERVE** — **2 constats BLOQUANTS**, **10 MAJEURS**, **12 MINEURS**.

Le travail est du niveau des deux PR précédentes et, sur le lot 7, il fait mieux qu'elles.
`services/mon-parcours.js` est une liste blanche *structurelle* et non déclarative : le `titre` d'un
entretien n'est **même pas SÉLECTIONNÉ** (l. 412-418), les actions rattachées à un frein sensible sont
retirées **en SQL, ligne entière**, sur une liste lue du registre et non recopiée (`FREINS_EXCLUS`,
l. 71), `sortie_type` — un `VARCHAR(50)` libre — devient `null` hors dictionnaire (l. 515), et les
heures de la semaine sont rendues en **quatre clés sans cible, sans seuil, sans alerte**. Le routeur
`salarie.js` resserre ADMIN/RH **à sa première ligne** (l. 51), avant tout validateur ; la remise est
unique (`FOR UPDATE` + 409), le journal de génération et de remise est **bloquant dans la
transaction**, `pool.connect()` est **dans le `try`** aux trois endroits, et le consentement écrit
`employees` *et* `rgpd_consents` *et* le journal dans une seule transaction. Côté lot 5, les quatre
familles d'obligations adossées à un statut social ne sont pas *filtrées* pour un MANAGER : leurs
requêtes **ne partent pas** (`echeances-cip.js` l. 251-259, `if (!adminRh) continue;` l. 369) — je l'ai
vérifié en exécutant `composerEcheances({ baseRole: 'MANAGER' })`, qui rend `rendez_vous_reguliers:
null` et la seule famille `diagnostic_socle`. Le 404 du jeton ETI est uniforme, `validations` n'est pas
forgeable, les 10 codes du journal ont leur libellé, la 10ᵉ purge est à la forme des neuf autres, et
l'entrée art. 30 des rappels est la plus complète du dépôt.

**Ce qui bloque tient en deux phrases.**

1. **Le jeton ETI — qui autorise une écriture SANS AUCUNE authentification sur une pièce fondant un
   renouvellement de contrat — circule librement dans l'application.** Par accident d'abord : trois
   routes le rendent en clair parce qu'elles font `SELECT im.*` et que `maskInsertionRow` ne le connaît
   pas, dont une qui sert **toute la cohorte** en un appel. Par conception ensuite : `lien_eti` est
   servi à tout rôle du module sans garde d'appartenance. Un MANAGER obtient donc le jeton d'un salarié
   dont il n'est pas l'encadrant, et écrit son avis **sans être identifié** — c'est-à-dire le
   contournement exact de `managerOwnsEmployee`, garde posée en P1 après la revue Codex PR#74 et dont
   le commentaire dit « sinon tout encadrant pourrait écrire le renouvellement d'autrui ».
2. **L'écran public rend le blob `renouvellement_form` ENTIER**, donc le champ libre « Motifs /
   commentaires » de la trame **interne** que la CIP remplit dans la fiche, et son propre avis de
   renouvellement — à qui détient le lien, et le formulaire public le **pré-remplit à l'écran**.

Aucun des deux ne relève d'une négligence : le premier est un champ neuf tombé dans un `SELECT *`
préexistant (la famille du `SELECT e.*` de 2.43.0 et du `resume_rse` de 2.44.0), le second est une
clause du contrat tenue à la lettre sans que sa conséquence ait été mesurée. Les correctifs tiennent
chacun en quelques lignes.

---

## 1. Constats BLOQUANTS

### B-01 — Le jeton ETI, credential d'écriture non authentifiée, est distribué à tout le module

**Vecteur 1 (involontaire) — `SELECT im.*`**
`backend/src/routes/insertion/routes.js:634` (`GET /api/insertion/milestones/:employeeId`),
`:1338` (`GET /api/insertion/milestones-overview` — **toute la cohorte**),
`:4546` (`GET /api/insertion/:employeeId`, la fiche).
Colonne ajoutée par `backend/src/scripts/migrations/insertion-echeances.js:56-58`.
Masquage : `backend/src/routes/insertion/masking.js:32-46` — `MANAGER_HIDDEN_FIELDS` ne contient pas
`eti_token`, et le masquage ne s'applique de toute façon **qu'au MANAGER**.

**Reproduction** (PostgreSQL 16.13 réel, requête et masquage EXACTS de la route) :

```
Clés renvoyées à un MANAGER : id, employee_id, milestone_type, titre, status, due_date,
  interviewer_id, eti_token, eti_token_expires_at, eti_token_generated_by, …
eti_token rendu  = deadbeefdeadbeefdeadbeefdeadbeef
→ lien reconstituable : https://solidata.online/eti/renouvellement/deadbeefdeadbeefdeadbeefdeadbeef
```

**Vecteur 2 (par conception)** — `backend/src/services/echeances-cip.js:648` (bloc « Organisation du
suivi » de `GET /api/insertion/echeances`, servi à ADMIN/RH/**MANAGER**) et
`backend/src/routes/insertion/routes.js:2854` (`GET /api/insertion/renouvellements`, « Lecture module
(A/RH/M) », l. 2800). Aucune des deux requêtes ne porte de filtre d'appartenance. Reproduction, avec
`composerEcheances({ baseRole: 'MANAGER' })` :

```
 • [renouvellement] DUPONT Marie — « Renouvellement — avis de l'encadrant attendu (fin de contrat dans 18 j) »
   lien_eti = https://solidata.online/eti/renouvellement/deadbeefdeadbeefdeadbeefdeadbeef
```

Le bouton « Copier le lien encadrant » de `frontend/src/components/insertion/EcheancesPanel.jsx:326`
utilise `o.lien_eti` **quand il existe** et n'appelle `POST …/lien-eti` (la seule route gardée par
`managerOwnsEmployee`, `routes.js:2899`) que s'il manque : le chemin est donc atteignable depuis
l'interface, sans outil.

**Pourquoi c'est bloquant.** `PUT /api/insertion/renouvellements/:id/formulaire` refuse (403) un
MANAGER qui n'est pas l'encadrant référent (`routes.js:2976`, fail-closed, correctif P1). Avec le
jeton, le même MANAGER écrit les mêmes trois champs par `PUT /api/eti/renouvellement/:token`, et la
validation déposée porte `{ role:'eti', mode:'jeton', token_prefix }` **sans `user_id`**
(`eti-public.js:168`) : non seulement la garde tombe, mais l'écriture devient **non attribuable**. Sur
une pièce qui fonde le renouvellement d'un CDDI, c'est l'attribution qui fait la valeur probante.

**Correctif proposé**
1. Ne jamais laisser sortir la colonne, quel que soit le rôle — le jeton n'a qu'un seul point de
   sortie légitime, `POST …/lien-eti`. Dans `masking.js`, ajouter un retrait **indépendant du rôle** :
   ```js
   const ALWAYS_HIDDEN_FIELDS = ['eti_token'];   // credential : aucun rôle n'en a besoin dans une liste
   function stripSecrets(row) { if (row && typeof row === 'object') for (const k of ALWAYS_HIDDEN_FIELDS) delete row[k]; return row; }
   ```
   appelé par `maskInsertionRow`/`maskInsertionRows` **avant** le test `baseRole !== 'MANAGER'`, et
   appliqué aussi à `routes.js:4546` (déjà masqué par ailleurs). `GET /:employeeId/timeline` (`routes.js:1806`) n’est PAS concerné : `buildTimeline` projette des champs explicites (vérifié, `engine.js:1409-1412`).
2. Borner `lien_eti` : ne le composer que pour ADMIN/RH, ou pour le MANAGER **propriétaire** — la
   requête de `chargerOrganisation` et celle de `/renouvellements` peuvent joindre
   `employees.manager_id`/`cip_referent_user_id` et rendre `lien_eti: null` sinon. Le bouton retombe
   alors sur « Créer le lien encadrant », qui est déjà gardé.
3. Ajouter au test de contrat `insertion-liste-contract` une assertion symétrique de celle qui existe
   pour `brsa` : `expect(JSON.stringify(body)).not.toContain('eti_token')` sur les trois routes.

---

### B-02 — L'écran public rend le champ libre de la CIP et son avis au porteur du lien

**Fichier** : `backend/src/routes/insertion/eti-public.js:102-115` (`formulaire: row.renouvellement_form`
rendu tel quel, `avis: row.renouvellement_avis`).
**Écriture de ce champ libre** : `frontend/src/components/insertion/EntretienForm.jsx:1000` —
textarea « Motifs / commentaires » de la trame « **interne** de renouvellement », dans la fiche
ADMIN/RH/MANAGER, qui écrit dans `renouvellement_form.commentaires`.
**Affichage** : `frontend/src/components/insertion/FormulaireETI.jsx:97` — `commentaires: f.commentaires || ''`
**pré-remplit la zone de saisie** de l'écran public.

**Reproduction** (routeur réel monté sans authentification, `pg` simulé rendant une ligne telle que la
base la porte) :

```
--- GET public, SANS aucune authentification ---
statut 200
clés rendues : prenom, nom, poste, contract_end, formulaire, avis, duree_mois, expire_le, lecture_seule
formulaire.commentaires = "Arrêts maladie répétés depuis janvier ; suivi psy en cours. Ne pas renouveler."
avis (saisi par la CIP)  = "defavorable"
```

Le test de contrat existant (`tests/contract/insertion-eti-public-contract.test.js:101-119`) vérifie
la liste des clés de **premier niveau** et cherche `frein_`, `brsa`, `ft_categorie`… dans le JSON —
mais sa fixture est `renouvellement_form: { assiduite: 'bonne' }` : le blob réel n'est jamais exercé.
La liste blanche s'arrête donc au bord d'un champ qui, lui, n'en a aucune.

**Pourquoi c'est bloquant.** C'est la surface la moins protégée de l'application (aucune session, un
jeton de 60 jours qui voyage par SMS ou par e-mail, et qui reste valide si le message est transféré).
Elle sert du texte libre écrit par la conseillère — la même classe de donnée que le constat B-01 de la
PR B, à ceci près que le destinataire n'est plus un tiers identifié mais un porteur de lien. Et
`renouvellement_avis` est **l'avis de la structure** : le rendre avant que l'encadrant ait donné le
sien fausse aussi le recueil.

**Correctif proposé** — projeter, côté serveur, les seules clés que l'écran public écrit, et ne rendre
l'avis que s'il vient de l'encadrant :

```js
// eti-public.js — le formulaire rendu est celui que CET écran sait écrire, pas le blob stocké.
const CLES_PUBLIQUES = ['assiduite','motivation','autonomie','participation_actions',
                        'competences_acquises','projet_professionnel','motifs','commentaires','rempli_par'];
const projeter = (f) => (f && typeof f === 'object' && f.rempli_par === 'eti')
  ? Object.fromEntries(Object.entries(f).filter(([k]) => CLES_PUBLIQUES.includes(k)))
  : {};                                   // trame interne non commencée par l'encadrant → écran vierge
…
formulaire: projeter(formulaire),
avis: (formulaire && formulaire.rempli_par === 'eti') ? (row.renouvellement_avis || null) : null,
```
et, dans le test de contrat, une fixture qui porte `commentaires` + `rempli_par: 'cip'` avec
`expect(JSON.stringify(r.body)).not.toContain('hospitalisation')`.

---

## 2. Constats MAJEURS

### M-01 — Le titre LIBRE d'un entretien prime sur la liste fermée dans deux surfaces neuves

**Fichiers** : `backend/src/services/echeances-cip.js:616` et `:625` (bloc « Organisation du suivi »),
`backend/src/routes/insertion/routes.js:242` et `:290` (`prochain_rdv.type` de la file active),
rendu par `frontend/src/components/insertion/FileActive.jsx:104` et
`frontend/src/pages/Employees.jsx:1086-1092`.

```js
libelle: `${r.titre || r.milestone_type} en retard de ${r.jours} jour(s)`,   // echeances-cip.js:616
type: e.prochain_rdv_titre || e.prochain_rdv_type || null,                   // routes.js:290
```

`insertion_milestones.titre` est un `VARCHAR(120)` librement saisi (`routes.js:701`, `init-db.js:3812`), sans contrainte
de contenu, sans chiffrement, sans masquage. Reproduction (`composerEcheances({ baseRole:'MANAGER' })`) :

```
 • [bilan_en_retard]  DUPONT Marie — « Bilan après l'hospitalisation en retard de 43 jour(s) »
 • [rdv_non_planifie] DUPONT Marie — « RDV protection des droits — contestation de sanction : aucune date planifiée »
```

Le lot le sait : `echeances-cip.js:655-658` retire délibérément le libellé libre d'une **action** critique,
avec ce commentaire — « c'est un texte libre, et cet écran s'affiche à **tous** les rôles du module ».
La règle juste a été appliquée aux actions et pas aux entretiens, sur le même écran, à quarante lignes
d'intervalle.

**Ce qui atténue** : `maskInsertionRow` ne masque pas `titre`, et `GET /insertion/cohorte/stats`
(`routes.js:3307`) l'expose déjà à un MANAGER pour toute la cohorte — le défaut est donc **préexistant**
et la PR C l'étend plutôt qu'elle ne le crée. C'est ce qui le classe majeur et non bloquant.

**Correctif** : `libelle: \`${MILESTONE_TYPE_LABELS[r.milestone_type] || r.milestone_type} …\`` aux deux
endroits ; `type: e.prochain_rdv_type` (jamais le titre) dans la file active ; et retirer `im.titre` des
deux `SELECT` — ce qu'on ne lit pas ne peut pas revenir par un libellé oublié (doctrine
`fiche-referent.js`). À traiter dans la foulée : le même `titre` dans `cohorte/stats`.

---

### M-02 — Le PUT public n'impose aucune borne au JSON qu'il stocke

**Fichier** : `backend/src/routes/insertion/eti-public.js:131-199`. La liste blanche porte sur les
**noms** des trois champs ; la **valeur** de `renouvellement_form` n'est ni typée, ni bornée en
taille, ni bornée en profondeur, ni contrôlée dans ses clés — elle part directement en
`JSON.stringify(v)` vers une colonne JSONB (l. 189). La limite qui s'applique est celle du parseur
global, `express.json({ limit: '10mb' })` (`backend/src/index.js:73-74`).

**Reproduction** (routeur réel, limite réelle, aucune authentification) :

```
--- PUT public, charge de 2 Mo ---
statut 200 {"ok":true}
UPDATE émis : true | taille écrite dans renouvellement_form : 2.00 Mo

--- PUT public, 20 000 niveaux d'imbrication (≈ 40 Ko) ---
[ETI] Erreur écriture par jeton : Maximum call stack size exceeded → 500
```

Le rate limit du montage (60 requêtes / 15 min / IP, `index.js:214`) borne le débit mais pas la taille :
c'est 600 Mo de JSONB par IP et par quart d'heure sur une seule ligne, avec le gonflement de table que
cela suppose. Le second cas n'est qu'un 500 (le `try/catch` tient), mais il montre que la valeur n'est
jamais regardée avant d'être sérialisée.

**Correctif** — valider la forme **avant** toute lecture en base, comme la liste des noms l'est déjà :

```js
const CLES_FORM = new Set(['assiduite','motivation','autonomie','participation_actions',
                           'competences_acquises','projet_professionnel','motifs','commentaires','rempli_par']);
function formValide(v) {
  if (v == null) return true;
  if (typeof v !== 'object' || Array.isArray(v)) return false;
  const cles = Object.keys(v);
  if (cles.some((k) => !CLES_FORM.has(k))) return false;
  return cles.every((k) => {
    const x = v[k];
    if (x == null) return true;
    if (typeof x === 'string') return x.length <= 2000;
    if (Array.isArray(x)) return x.length <= 20 && x.every((e) => typeof e === 'string' && e.length <= 100);
    return typeof x === 'number' || typeof x === 'boolean';
  });
}
if ('renouvellement_form' in corps && !formValide(corps.renouvellement_form)) {
  return res.status(400).json({ error: 'Formulaire invalide', code: 'FORMULAIRE_INVALIDE' });
}
```
(La même validation manque sur `PUT /renouvellements/:id/formulaire`, `routes.js:2950` — mais là
l'appelant est authentifié et tracé.)

---

### M-03 — Un `try/catch` sans SAVEPOINT fait échouer TOUTE l'anonymisation

**Fichier** : `backend/src/services/anonymization.js:359-364` et `:376-384`.

```js
try {
  await client.query('UPDATE insertion_milestones SET eti_token = NULL WHERE …', [id]);
} catch (err) { if (err.code !== '42703') throw err; }   // « l'anonymisation ne doit pas échouer pour autant »
```

Dans PostgreSQL, une instruction en erreur **avorte la transaction entière** : les suivantes échouent
en `25P02` jusqu'au `ROLLBACK`. Le commentaire promet donc l'inverse de ce que le code fait. C'est
exactement le constat C-07 de la 2.50.0 (« la promesse *n'échoue pas toute l'anonymisation* était
fausse sans SAVEPOINT »), et le même fichier applique déjà le bon patron trois fois (l. 577, 613, 669).

**Reproduction** (PostgreSQL 16.13 réel, bloc copié à l'identique) :

```
42703 attrapé comme le fait le code — « l'anonymisation ne doit pas échouer pour autant »
>>> SUITE IMPOSSIBLE : 25P02 — current transaction is aborted, commands ignored until end of transaction block
>>> état final du dossier après ROLLBACK : Marie        ← le droit à l'effacement n'a pas été exercé
```

Le déclencheur est une base où la migration PR C n'est pas passée (déploiement interrompu — le cas de
la 2.49.1 —, base de recette, restauration partielle). L'erreur rendue à l'exploitant est alors
`25P02`, qui ne nomme pas la colonne manquante : le diagnostic est perdu en même temps que l'effacement.

**Correctif** — utiliser les helpers du fichier, qui interrogent `information_schema` au lieu
d'essayer-pour-voir :

```js
const cols = await existingColumns(client, 'insertion_milestones');
if (cols.has('eti_token')) {
  await client.query('UPDATE insertion_milestones SET eti_token = NULL WHERE employee_id = $1 AND eti_token IS NOT NULL', [id]);
}
// idem pour employees.rappel_rdv_* : nullifyColumns(client, 'employees', 'id', id, ['rappel_rdv_consent', …])
```
ou, à défaut, un `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` par bloc.

---

### M-04 — Un refus Brevo est enregistré « envoyé », et le numéro accepté n'est pas envoyable

**Fichiers** : `backend/src/services/rappels-rdv.js:276-287`, `backend/src/services/notification.js:33-40`,
`backend/src/routes/insertion/salarie.js:62-68`.

Deux défauts qui se renforcent :

1. `sendNotification` rend le JSON de Brevo **sans regarder le statut HTTP** ; `rappels-rdv.js:282`
   conclut `statut = res && res.dryRun ? 'dry_run' : 'envoye'`. Un 400 (numéro invalide), un 401 (clé
   révoquée) ou un 402 (crédits épuisés) sont donc inscrits **« envoyé »** dans `insertion_rappels_rdv`
   — et l'`UNIQUE(milestone_id)` interdit toute nouvelle tentative. La personne n'est pas prévenue, et
   la trace — qui est la preuve RGPD du service rendu — affirme le contraire.
2. `salarie.js:64-68` accepte `06 12 34 56 78` (séparateurs autorisés « pour ne pas faire ressaisir la
   CIP ») en affirmant en commentaire que « `services/notification.js` normalise ensuite en +33 ».
   Il ne normalise pas : `+33${phone.substring(1)}` conserve les espaces.

**Reproduction** :

```
saisie CIP      : "06 12 34 56 78" → acceptée par salarie.js : true
envoyé à Brevo  : "+336 12 34 56 78"   ← séparateurs conservés   (E.164 attendu : "+33612345678")
réponse de sendNotification : {"code":"invalid_parameter","message":"recipient is invalid"}
statut écrit dans insertion_rappels_rdv : envoye   ← alors que Brevo a REFUSÉ (400)
```

Autrement dit : le format que l'écran de consentement encourage est précisément celui qui échoue, et
l'échec est enregistré comme un succès définitif.

**Correctif** — (a) normaliser à l'écriture (`destinataire.replace(/[\s.-]/g, '')` avant l'INSERT, la
regex restant permissive à la saisie) ; (b) dans `rappels-rdv.js`, considérer l'envoi réussi seulement
sur preuve — `const ok = res && (res.messageId || res.reference || (Array.isArray(res.messageIds)));`
sinon `statut: 'echec'` avec `erreur: res.message` ; (c) idéalement, faire remonter le statut HTTP
depuis `notification.js` (`if (!response.ok) return { error: true, status: response.status, …}`), ce
qui profitera aux six autres appelants.

---

### M-05 — Rien ne vérifie que le contact appartient à la personne, et le message la nomme

**Fichiers** : `backend/src/routes/insertion/salarie.js:352-392` (recueil),
`backend/src/scripts/migrations/insertion-salarie.js:69-72` (gabarit).

Le gabarit est « Bonjour **{prenom}**, rappel : vous avez rendez-vous demain {date} à {heure} avec
{cip} à **Solidarité Textiles**. » Un chiffre de trop dans le numéro saisi par la conseillère, et ce
message — prénom + nom de la structure d'insertion + fait d'un rendez-vous — part chez un inconnu, une
fois par rendez-vous, sans que personne ne puisse le savoir (voir M-04 : l'échec n'est pas détecté).
Le lot 7 l'a vu et l'a classé « règle de conduite » (§ 5.5) ; c'en est une, mais il existe une mesure
technique standard pour exactement ce risque.

**Correctif proposé** — **double opt-in** : à l'enregistrement d'un consentement, envoyer un message de
confirmation neutre (« Vous recevrez désormais un rappel la veille de vos rendez-vous à Solidarité
Textiles. Répondez STOP pour arrêter. ») et ne passer `rappel_rdv_consent = true` qu'après une
confirmation, ou au minimum tracer cet envoi de vérification pour que la conseillère puisse demander
« l'avez-vous reçu ? » pendant que la personne est encore devant elle. À défaut, retirer le prénom du
gabarit : c'est lui qui transforme une erreur de saisie en divulgation nominative.

---

### M-06 — Le jeton ETI apparaît en clair dans les journaux nginx

**Fichier** : `deploy/nginx/nginx.conf:20-23`.

```nginx
map $request_uri $redacted_request_uri {
    "~^(?<prefix>/v/)[a-f0-9]{32}(?<rest>.*)$" "${prefix}REDACTED${rest}";
    default                                    $request_uri;
}
```

La rédaction ne couvre que le jeton véhicule. `/eti/renouvellement/<hex32>` (page) et
`/api/eti/renouvellement/<hex32>` (API) sont donc écrits **entiers** dans `access.log` et dans tout
agrégateur qui le lit — un credential vivant pendant 60 jours, dans un fichier que l'exploitation
consulte tous les jours. Le dépôt a déjà identifié et traité cette classe de risque en 2.0.1 pour le
jeton chauffeur, avec le même raisonnement (« c'est une clé d'auth physique »).

**Correctif** (deux lignes) :
```nginx
"~^(?<prefix>/api/eti/renouvellement/)[a-f0-9]{32}(?<rest>.*)$" "${prefix}REDACTED${rest}";
"~^(?<prefix>/eti/renouvellement/)[a-f0-9]{32}(?<rest>.*)$"     "${prefix}REDACTED${rest}";
```
(À signaler à part : `/enquete/<token>` est dans la même situation, hors périmètre PR C.)

*Non constaté* : la fuite par `Referer`. `deploy/nginx/nginx.conf:56` pose
`Referrer-Policy: strict-origin-when-cross-origin` ; la feuille de style Google Fonts importée par
`frontend/src/index.css:1` ne reçoit donc que l'origine, jamais le chemin porteur du jeton.

---

### M-07 — Les parcours TERMINÉS entrent dans la file active de l'encadrant

**Fichier** : `backend/src/services/echeances-cip.js:136-150` (`sqlPerimetreFileActive`), consommé par
`GET /api/insertion` (`routes.js:260`) pour **tous** les rôles du module.

Avant la PR C, la liste filtrait `e.is_active = true` : une personne partie disparaissait. Désormais
elle reste sept mois (`insertion.file_active_terminees_mois`), avec son nom, son poste, son dernier
entretien, son prochain rendez-vous et sa pastille de risque — y compris pour un MANAGER. La raison
invoquée est juste (la sortie FSE+ et le relevé à +6 mois se saisissent **après** la sortie) mais ces
deux gestes sont **ADMIN/RH strict** : l'encadrant n'a rien à y faire. `?inclure=tous`
(`routes.js:174`) va plus loin — il rend **tous** les parcours, sans borne d'ancienneté, et n'est
gardé par aucun rôle (le front ne l'utilise pas, un appel HTTP direct suffit).

**Correctif** : borner la rémanence et le paramètre au rôle —
`sqlPerimetreFileActive({ …, moisTermines: adminRh ? moisTermines : 0, tous: tous && adminRh })`,
ce qui rend le périmètre du MANAGER identique à ce qu'il était (`en_parcours` seul) sans rien retirer
à la CIP. Un test de contrat symétrique de celui de `brsa`.

---

### M-08 — L'heure du prochain rendez-vous est lue en UTC ; la date glisse avant 02 h

**Fichiers** : `backend/src/routes/insertion/routes.js:277-279` et `:288`
(`new Date(...).toISOString().slice(11,16)` puis `isoDate(...)` sur un **horodatage**),
`backend/src/services/mon-parcours.js:369` (même `isoDate` sur `interview_date`, pour le document
remis à la personne).
`utils/date-iso.js:56-60` construit la date à partir de `getFullYear/getMonth/getDate`, c'est-à-dire
du fuseau du processus — **UTC en production**.

**Reproduction** :

```
rendez-vous réel (Paris)      : 15/09/2026 14:00
heure rendue (routes.js GET /): 12:00        ← lue en UTC
rendez-vous 16/09 01:30 Paris → date rendue 2026-09-15 , heure rendue 23:30
rendez-vous 16/09 00:00 Paris → « heure inconnue » ? false   (affiche 22:00)
rendez-vous 16/09 02:00 Paris → « heure inconnue » ? true    (une heure réelle est effacée)
```

Trois conséquences : la CIP lit « RDV 15/09 à 12:00 » pour un rendez-vous de 14 h
(`FileActive.jsx:105`) ; un rendez-vous de début de matinée est affiché la veille ; et la règle
« minuit ⇒ heure inconnue » (`routes.js:288`) se déclenche sur 02 h 00 de Paris tout en laissant passer
minuit. Dans « Mon parcours », la DATE vient d'`isoDate` (UTC) pendant que l'HEURE vient de
`heureParis` (Intl) : les deux peuvent se contredire sur le document remis à la personne.

**Correctif** : lire l'heure et le jour par PostgreSQL — `(rdv.interview_date AT TIME ZONE 'UTC') AT
TIME ZONE 'Europe/Paris'` pour la date, `to_char(…, 'HH24:MI')` pour l'heure — ou réutiliser
`heureParis()` de `mon-parcours.js:213` (déjà écrit, déjà testé) et un `jourParis()` équivalent ;
et distinguer « pas d'heure » par `interview_date IS NULL`, jamais par la valeur `00:00`.

---

### M-09 — La seule trace au registre d'une écriture NON authentifiée est best-effort

**Fichier** : `backend/src/routes/insertion/eti-public.js:174-210`.

L'UPDATE (l. 196) est émis hors transaction ; le snapshot d'historisation (l. 175-183) et le journal
RGPD (l. 204-210) sont chacun dans un `try/catch` qui **avale** l'erreur. Une écriture anonyme sur un
dossier peut donc aboutir sans aucune ligne au registre — et, sur un entretien déjà `realise`, sans
l'état antérieur que `insertion_milestones_history` est censé conserver. À comparer avec la voie
authentifiée, où `snapshotMilestone` est appelé **sans** `try/catch` (`routes.js:2992`) : deux régimes
de preuve pour un même acte, le plus faible étant celui de l'acteur non identifié.

La doctrine § 2.4 du contrat réserve le journal bloquant à ce qui « SORT » ; mais l'écriture anonyme
est précisément le cas où la trace est la seule chose qui reste.

**Correctif** : ouvrir une transaction autour de `snapshot → UPDATE → journal`, avec le journal
bloquant. Le coût d'un échec (l'encadrant doit renvoyer son avis) est sans commune mesure avec celui
d'une écriture anonyme sans trace.

---

### M-10 — « Mon Récap », document fait pour circuler, nomme une conciliation et une entreprise

**Fichier** : `backend/src/services/mon-parcours.js:74-78` (libellés d'entretien) et `:465-473` (étapes).

Deux éléments d'un document explicitement « partageable par la personne à un tiers de SON choix » :

1. `TYPE_ENTRETIEN_LABELS` ajoute `conciliation: 'Entretien de conciliation'`. Le type existe depuis la
   PR B et désigne l'« entretien de conciliation (**protection des droits**) », c'est-à-dire la
   procédure contradictoire qui précède une décision défavorable dans le cadre RSA. Une ligne
   « 12/03/2026 — Entretien de conciliation » sur un récapitulatif remis à un employeur dit qu'il y a
   eu litige, et corrèle avec un statut social que le document promet en pied de page de ne pas
   contenir.
2. `Stage en entreprise chez ${p.entreprise}` reprend un champ **libre** (le lot 7 le signale lui-même,
   § 5.6). Le plus souvent c'est une information valorisante que la personne connaît ; mais le nom d'un
   ESAT, d'une entreprise adaptée ou d'un établissement de soins révèle par ricochet ce que le reste du
   document exclut.

**Correctif proposé** : retirer `conciliation` (et, à l'arbitrage, `point_etape_referent`) de la liste
des étapes du **Récap** — les garder dans « Mon parcours », qui ne circule pas ; et, pour la PMSMP,
soit conserver le nom (décision métier, à assumer explicitement dans la mention de pied), soit rendre
« Stage en entreprise — {objet} » sans raison sociale. Dans les deux cas, `p.entreprise` gagnerait à
être tronqué comme `tronquer()` le fait pour les objectifs.

---

## 3. Constats MINEURS

| # | Où | Constat | Correctif |
|---|---|---|---|
| m-01 | `frontend/src/components/insertion/pdf-insertion.js:21` | `esc()` n'échappe que `& < >`, pas `"` ni `'`. Sans effet aujourd'hui — `pdf-salarie.js` n'interpole qu'en nœud texte, et `frDate` rend « Invalid Date » sur une valeur non datable (vérifié) — mais la première interpolation en **attribut** ouvrira une injection. | Ajouter `"` → `&quot;` et `'` → `&#39;`. |
| m-02 | `backend/src/routes/insertion/routes.js:90-96` + `:980`, `:2967` | `snapshotMilestone` sérialise la ligne ENTIÈRE issue d'un `SELECT *` : le jeton **vivant** est recopié dans `insertion_milestones_history.snapshot`. Aucune route ne l'expose et l'anonymisation purge la table (`anonymization.js:267`) ; il entre néanmoins dans les sauvegardes. | `delete row.eti_token` avant `JSON.stringify` (ou le `stripSecrets` de B-01). |
| m-03 | `backend/src/scripts/migrations/insertion-echeances.js:85-96` | Le DO-scan cherche `conname` **sans** `conrelid` ; la migration jumelle du même lot (`insertion-salarie.js:95-98`) le fait. Un homonyme sur une autre table ferait sauter la pose du CHECK. | Ajouter `AND conrelid = 'insertion_echeance_reports'::regclass`. |
| m-04 | `backend/src/routes/insertion/echeances.js:124-125` | Le report accepte n'importe quel `employee_id` existant — y compris un permanent, ou un salarié qui ne porte pas cette obligation. La ligne est créée, journalisée, et le compteur de reports s'incrémente pour rien. | Vérifier que le salarié est dans le périmètre de la file active, ou que l'obligation existe. |
| m-05 | `backend/src/routes/insertion/salarie.js:236-241` | `remis_le` est borné dans le futur, jamais dans le passé : une remise datée de 1950 est acceptée. | Refuser une date antérieure à `genere_le` du document. |
| m-06 | `backend/src/scripts/migrations/insertion-salarie.js:202` | Le registre art. 30 déclare « Salariés en parcours d'insertion ayant expressément accepté » ; le code ne restreint pas le recueil aux `en_parcours` (un permanent peut consentir). | Aligner l'un sur l'autre — de préférence le code. |
| m-07 | `backend/src/services/echeances-cip.js:275-279` | `Number(x) > 0 ? x : défaut` : un réglage volontairement mis à **0** (« alerter dès le premier jour ») retombe silencieusement sur la valeur par défaut. Même famille que le piège corrigé au lot 7 (`lireHeureEnvoi`), à l'envers. | Tester l'absence (`v == null \|\| v === ''`) avant la conversion, puis borner. |
| m-08 | `frontend/src/components/insertion/pdf-insertion.js:32` | `openPrintWindow` — réutilisé par `pdf-salarie.js` — contient encore un `alert('Popup bloquée…')`. Le § 5.4 du contrat ne liste pas ce fichier, mais la règle « 0 boîte native » perd son sens si le dernier écran du parcours en ouvre une. | Bandeau via `useToast`, ou retour d'une valeur que l'appelant affiche. |
| m-09 | `backend/src/services/rappels-rdv.js:104-107` | `masquerDestinataire('email', 'a@x.fr')` rend `a***@x.fr` : sur un local-part d'une lettre, il est intégralement révélé. | Masquer à longueur fixe (`***@domaine`) sous 3 caractères. |
| m-10 | `backend/src/services/notification.js:27` | `htmlContent: \`<p>${body}</p>\`` — `{prenom}` (donnée de la base) est injecté sans échappement HTML dans l'e-mail. Risque faible (destinataire = la personne elle-même), mais c'est le premier appelant à y verser une donnée de dossier. | Échapper `& < >` avant substitution. |
| m-11 | `backend/src/services/notification.js:15` | En mode dry-run (pas de clé Brevo), le journal serveur écrit le **contact en clair** et les 80 premiers caractères du message — alors que tout le lot 7 s'applique à ne garder qu'un destinataire masqué. C'est l'état des environnements de recette. | Masquer le destinataire dans ce `console.log`. |
| m-12 | `backend/src/routes/insertion/echeances.js:79-91` | `GET /echeances/compteur` n'est pas journalisé (choix assumé et argumenté dans le code) et il déclenche, à chaque montage de page pour un ADMIN, le calcul complet de la cohorte + `activiteHebdoCohorte` (cache 60 s, mémoire du processus). Acceptable ; à surveiller quand la file active grandira. | — (noté) |

---

## 4. Ce qui est bien fait

- **`services/mon-parcours.js` est une liste blanche structurelle**, pas un filtre : `titre` n'est pas
  sélectionné (l. 412-418), les actions sensibles sont retirées **en SQL, ligne entière**, sur une liste
  lue du registre des freins (l. 71), et un `sortie_type` hors dictionnaire devient `null` (l. 515). Les
  deux documents ont leurs clés de premier niveau exportées et vérifiées.
- **Les heures sans seuil** : quatre clés, aucune cible, et un test qui lit le code *dépouillé de ses
  commentaires* pour y interdire les mots « seuil », « 15 h », « plancher », « obligation ».
- **Le référent unique n'est que dans « Mon parcours »**, jamais dans le document partageable : la
  question posée par la revue (« un référent de type CMS révèle-t-il le BRSA à un tiers ? ») a déjà sa
  réponse dans le code.
- **Le refus AVANT toute requête** est réel, et vérifiable : `salarie.js:51` (ADMIN/RH en première ligne
  du routeur), `echeances.js:99` (report ADMIN/RH avant les validateurs), `eti-public.js:59` (regex du
  jeton avant la requête), `eti-public.js:131` (liste blanche des champs avant la lecture). Les quatre
  familles sociales d'obligations ne sont pas calculées pour un MANAGER — exécuté et constaté.
- **`validations` n'est pas forgeable** depuis l'écran public (400 `champs_refuses`, reproduit), et le
  journal du jeton ne porte que six caractères de préfixe, jamais le jeton entier.
- **404 uniforme** sur jeton malformé, inconnu ou d'un autre type d'entretien ; 410 distincts pour
  l'expiration et la clôture ; une échéance absente vaut expiré (`eti-public.js:75`) ; `router.all('*')`
  ferme le reste de `/api/eti`.
- **`pool.connect()` dans le `try`** aux trois transactions du lot 7 et à celle du report ; journal
  **bloquant** pour la génération, la remise et le consentement ; `FOR UPDATE` + 409 sur la remise ;
  `rgpd_consents` et les colonnes `employees` écrits dans la même transaction que la trace.
- **Le consentement est une condition de LECTURE** (`rappels-rdv.js:163`, dans le `WHERE`), « demain »
  est calculé par PostgreSQL en `Europe/Paris`, le type d'entretien n'est pas sélectionné, et
  `lireHeureEnvoi` teste l'absence **avant** la conversion (le défaut « rappels à minuit » trouvé par le
  lot lui-même).
- **L'entrée art. 30 des rappels** est la plus complète du dépôt : base légale nommée, sous-traitant
  nommé, ce que le message ne dit pas, et la durée de la trace distinguée de celle du dossier.
- **Aucune nouvelle dépendance npm**, aucun `dangerouslySetInnerHTML` dans tout le frontend, aucun
  `alert()`/`window.confirm` dans les treize fichiers du § 5.4, aucun secret en dur, CORS restreint et
  `Referrer-Policy` qui empêche la fuite du jeton vers Google Fonts.
- **`FreinsDeltas` n'a rien à masquer** : le serveur retire l'axe judiciaire pour un MANAGER
  (`routes.js:1284-1287`), vérifié.

---

## 5. Points à l'arbitrage de la direction / du DPO

1. **Le lien ETI est un accès sans compte à une pièce nominative.** Même corrigé (B-01), il reste un
   credential de 60 jours transmis par SMS ou e-mail, qui survit au transfert du message et dont la
   révocation suppose d'en produire un nouveau. Trois questions : la durée (60 j est longue pour un
   geste qui se fait en une semaine — 14 j suffiraient), l'extinction **à la première transmission**
   (un avis transmis n'a plus besoin d'un lien ouvert), et l'information de l'encadrant sur ce qu'il
   voit. À inscrire au registre art. 30 comme mode d'accès, ce que le contrat § 3.1 écarte aujourd'hui.
2. **Base légale des rappels.** Le consentement (art. 6-1-a) est le bon fondement et il est bien
   outillé ; reste à décider qui recueille (la conseillère est en position d'autorité vis-à-vis d'un
   salarié en insertion — le consentement doit être manifestement libre), et à acter la mention
   d'information FALC, aujourd'hui affichée à l'écran mais non conservée.
3. **Double opt-in** (M-05) : mesure technique ou règle de conduite ?
4. **Rétention de la trace des rappels : 365 jours.** Le lot 7 le dit lui-même — rien n'exige de garder
   un an la preuve qu'un SMS de rappel est parti. 90 jours suffiraient à traiter une réclamation.
5. **« Mon Récap » et la conciliation** (M-10) : que doit contenir un document que la personne
   remettra à un employeur ? La décision appartient à la direction, pas au code.
6. **« Mon parcours » affiche le référent unique** (« Centre médico-social du Département ») tout en
   portant en pied de page « ne contient aucune information de santé, de justice **ni de situation
   sociale** ». Le document est remis à la personne, donc la mention n'est pas fausse sur le fond ;
   elle l'est sur la lettre, et il peut être remis par courrier ou par e-mail (`remis_mode`). Soit on
   retire le référent, soit on ajuste la mention.
7. **`mes_engagements` reprend le titre d'objectif saisi** (tronqué à 120 caractères). C'est voulu
   — c'est le texte co-construit avec la personne — mais c'est le seul texte libre de « Mon parcours ».
   À rappeler aux CIP : ce champ s'imprime.
8. **`rgpd_consents` n'est purgé que de l'entrée `rappel_rdv`** à l'anonymisation (constat du lot 7).
   Les autres consentements d'un dossier effacé subsistent. Défaut préexistant, à trancher avec le DPO.
9. **Un entretien reprogrammé ne reçoit pas de second rappel** (`UNIQUE(milestone_id)`). Limite assumée
   et documentée ; c'est une décision de la CIP, pas une décision technique.
10. **Périmètre du MANAGER dans tout le module** (rappel de la réserve E1 des revues précédentes) :
    ni `GET /insertion`, ni `GET /insertion/echeances`, ni `GET /insertion/:employeeId` ne sont
    cloisonnés par équipe. M-07 en réduit la portée, il ne la traite pas.

---

## 6. Récapitulatif

| # | Constat | Fichier principal | Reproduit |
|---|---|---|---|
| **B-01** | Le jeton ETI sort par `SELECT im.*` (3 routes dont la cohorte entière) **et** par `lien_eti` sans garde d'appartenance → contournement de `managerOwnsEmployee`, écriture non attribuable | `routes.js:634,1338,4546,2854` · `masking.js:32` · `echeances-cip.js:648` | ✔ PostgreSQL réel + service réel |
| **B-02** | Le GET public rend `renouvellement_form` entier (champ libre « Motifs / commentaires » de la CIP) et son avis ; le formulaire public le pré-remplit | `eti-public.js:102-115` · `FormulaireETI.jsx:97` | ✔ routeur réel |
| **M-01** | Le `titre` libre d'un entretien prime sur la liste fermée (échéances ×2, `prochain_rdv.type`) — servi à MANAGER pour toute la cohorte | `echeances-cip.js:616,625` · `routes.js:290` | ✔ service réel |
| **M-02** | Le PUT public ne borne ni la taille (2 Mo écrits sans authentification), ni la forme, ni la profondeur du JSON stocké | `eti-public.js:131-199` | ✔ routeur réel |
| **M-03** | `try/catch 42703` sans SAVEPOINT → l'anonymisation entière échoue en `25P02` sur une base non migrée | `anonymization.js:359,376` | ✔ PostgreSQL réel |
| **M-04** | Un refus Brevo est inscrit « envoyé » ; le numéro accepté n'est pas normalisé E.164 malgré le commentaire | `rappels-rdv.js:282` · `notification.js:34` · `salarie.js:66` | ✔ |
| **M-05** | Aucune vérification que le contact appartient à la personne ; le message la nomme et nomme la structure | `salarie.js:352` · `insertion-salarie.js:69` | raisonnement |
| **M-06** | Le jeton ETI en clair dans les access logs nginx (rédaction limitée à `/v/<hex32>`) | `deploy/nginx/nginx.conf:20` | lecture |
| **M-07** | Les parcours terminés (7 mois) et `?inclure=tous` entrent dans la file active d'un MANAGER | `echeances-cip.js:136` · `routes.js:174` | lecture |
| **M-08** | Heure du prochain RDV lue en UTC (14:00 → « 12:00 »), date glissée avant 02 h, règle « minuit » décalée | `routes.js:277,288` · `mon-parcours.js:369` | ✔ |
| **M-09** | La seule trace au registre d'une écriture NON authentifiée est best-effort, hors transaction, snapshot avalé | `eti-public.js:174-210` | lecture |
| **M-10** | « Mon Récap », partageable, porte « Entretien de conciliation » et le nom libre de l'entreprise PMSMP | `mon-parcours.js:77,467` | lecture |
| m-01…m-12 | voir § 3 | — | — |

---

## 7. Ce que cette revue n'a pas fait

- **Aucune vérification de bout en bout sur base réelle peuplée** : c'est le rôle de l'agent debug
  (`23-debug-postgres-PR-C.md`). Les deux reproductions en base (B-01, M-03) portent sur des tables
  construites pour l'occasion, avec les requêtes et le code EXACTS du dépôt.
- **Aucun test de charge** du `GET /echeances` ni du compteur (m-12).
- **Le périmètre par équipe du MANAGER** est un sujet de doctrine préexistant, signalé (§ 5 point 10)
  et non instruit.
- **Non reproduits, retenus par lecture seule** : M-05, M-06, M-07, M-09, M-10 et les mineurs m-01 à
  m-12 hors ceux marqués ✔.

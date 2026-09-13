# PR B « Cadre RSA et temps d'accompagnement » — debug sur PostgreSQL réel

> Agent de debug, 13/09/2026. Branche `claude/solidata-cip-redesign-9fskwq-pr-b` (empilée sur la PR A).
> Périmètre d'écriture : `backend/tests/e2e-pr-b/` (nouveau) et ce fichier. **Aucune ligne de code
> source n'a été modifiée** — les mutations de contre-épreuve ont toutes été restaurées, `git status`
> le confirme (§ 8). Aucune commande git.
> Références : contrats `15-contrats-techniques-PR-B.md`, réalisations `16-realisation-lot3.md` et
> `16-realisation-lot4.md`, méthode `13-debug-postgres-PR-A.md`.

---

## 0. En une phrase

**87 vérifications de bout en bout** ont été jouées à travers les vrais handlers Express contre
PostgreSQL 16.13 : **80 vertes, 7 rouges**, qui isolent **six défauts** — dont **un bloquant**
(le registre d'actualisation France Travail n'affiche JAMAIS ce qui y est enregistré) et **trois
majeurs**, tous de la même famille : `String(uneDate).slice(...)` appliqué à une colonne `DATE`
que le pilote rend en objet `Date`, là où le code croit manipuler une chaîne `AAAA-MM-JJ`.

---

## 1. Ce qui a été mis en place

| Fichier | Contenu |
|---|---|
| `backend/tests/e2e-pr-b/_helpers.js` | Socle : jetons MFA frais, jeton **chauffeur** (rôle `COLLABORATEUR` en dur), comptes par rôle, purge de périmètre, salarié minimal, lundi ISO à pivot jeudi, **photographie du pool** (fuites de connexion), et un helper `iso()` dont l'en-tête explique pourquoi il existe (§ 3.1) |
| `backend/tests/e2e-pr-b/pr-b-rsa-e2e.test.js` | Lot 3 — 47 vérifications : types d'entretien, `date_realisation`, compteur hebdomadaire, relevé d'assiduité, fiche pour le référent (liste blanche prouvée **sur le JSONB stocké**), actualisation FT, échéances périodiques, habilitations, journal RGPD, fuites du pool, anonymisation |
| `backend/tests/e2e-pr-b/pr-b-temps-e2e.test.js` | Lot 4 — 40 vérifications : composition de la feuille, rattachement ASI/OCS, totaux et quotités, cohérence, périmètre MANAGER, export CSV, gel / contre-signature / réouverture, agrégat annuel, `gatherAuditKpis`, fuites du pool, anonymisation |

Les deux suites sont **ignorées tant que `PR_B_E2E_DB=1` (ou `PR_A_E2E_DB=1`) n'est pas fourni** :
`npx jest` reste vert sans base (§ 7).

---

## 2. Séquence de migration

### 2.1 Base existante (état PR A) — trois passes

```
node src/scripts/init-db.local.js     # passe 1 : exit 0, les 2 migrations PR B posées
node src/scripts/init-db.local.js     # passe 2 : exit 0
node src/scripts/init-db.local.js     # passe 3 : exit 0
```

`init-db.local.js` a été **régénérée** avant tout (la commande `sed` documentée dans le fichier
d'environnement) : `init-db.js` a changé depuis la PR A, et rejouer une copie périmée aurait éprouvé
un schéma qui n'existe plus.

### 2.2 Base NEUVE — séquence documentée (RECONSTRUCTION.md)

```
dropdb solidata_test ; createdb -O solidata_user solidata_test
node src/scripts/init-db.local.js     # exit 1 — ATTENDU : « relation "clients_exutoires" does not exist »
node src/scripts/migrate-exutoires.js # exit 0
node src/scripts/migrate-finance.js   # exit 0
node src/scripts/init-db.local.js     # exit 0
node src/scripts/init-db.local.js     # exit 0 (idempotence)
```

L'échec de la passe 1 est le **préexistant déjà documenté par la PR A** (13 § 2), sans rapport avec
la PR B.

### 2.3 État du schéma vérifié sur la base neuve

| Vérification | Résultat |
|---|---|
| Les 4 tables du contrat | `insertion_alimentations_referent`, `insertion_actualisations_ft`, `insertion_temps_saisies`, `insertion_feuilles_temps` ✓ |
| CHECK `milestone_type` reconstruit | **UNE seule** contrainte, portant les **8 types** (les 6 historiques + `point_etape_referent` + `conciliation`) — le DO-scan n'en laisse pas deux ✓ |
| `referent_modalite`, `conciliation_issue` | CHECK tolérant NULL, listes fermées ✓ |
| `conciliation_motifs` | JSONB sans CHECK (écart assumé et documenté par le lot 3) ✓ |
| `cip_action_plans.date_realisation` | colonne `date` posée ✓ |
| `insertion_actualisations_ft.honoree` | **nullable, AUCUN défaut** — les trois états sont tenus par la base ✓ |
| Index | `idx_alim_referent_employee`, `idx_actualisations_ft_mois`, `idx_temps_saisies_user_date`, `idx_feuilles_temps_periode`, + les deux UNIQUE ✓ |
| Registre art. 30 | **exactement une** entrée « Transmission d'informations au référent unique (RSA) » après deux passes ✓ |
| Non-régression PR A | les **93 vérifications** de `tests/e2e-pr-a` restent **vertes** ✓ |

---

## 3. Défauts trouvés

> Aucun n'a été corrigé : chacun est décrit avec sa reproduction, sa cause et le correctif proposé.
> Les tests qui les reproduisent sont **rouges dans la suite** et portent le préfixe `DÉFAUT D-xx` :
> ils forment le filet de non-régression du correctif à venir.

### 3.1 La famille commune — `String(uneDate).slice(...)` sur une colonne `DATE`

`node-pg` convertit une colonne `DATE` en objet **`Date`**, pas en chaîne. Or :

```
String(new Date(Date.UTC(2025, 3, 1)))  →  "Tue Apr 01 2025 00:00:00 GMT+0000 (…)"
                       .slice(0, 10)    →  "Tue Apr 01"
                       .slice(5, 7)     →  "pr"   →  Number("pr") = NaN
```

Trois endpoints de `rsa.js` appliquent ce raccourci. Ils sont invisibles des tests de contrat, dont
le `pg` simulé rend des **chaînes** commodes. C'est exactement le piège déjà payé par le projet en
2.49.0 (`vak-agenda` comparait `String(date_debut)` au jour courant) et l'entrée de journal de
version le dit en toutes lettres : « c'est PostgreSQL qui compare désormais les dates ».

---

### D-01 — **BLOQUANT** · le registre d'actualisation France Travail n'affiche jamais rien

**Où** : `backend/src/routes/insertion/rsa.js:523`

```js
const parMois = new Map(lignes.map((l) => [Number(String(l.mois).slice(5, 7)), l]));
```

**Ce qui se passe** : `l.mois` est un `Date`, `String(...).slice(5, 7)` rend `"pr"` / `"ar"` / `"an"`…,
et `Number(...)` vaut **NaN**. La Map est donc indexée par `NaN` et la boucle `for (m = 1..12)` ne
retrouve **aucune** ligne. `GET /rsa/:id/actualisations-ft` rend **douze mois entièrement `null`**,
quel que soit le contenu de la table.

**Effet à l'écran** : `FicheReferentPanel.jsx › ActualisationFtBloc` recharge la liste après chaque
écriture (`ecrire()` → `charger()`). La CIP clique « Faite », la ligne est **réellement écrite en
base**, le bloc se recharge et affiche toujours « non constatée » / « Aucun rappel ». La
fonctionnalité est **inutilisable**, et le symptôme se lit comme un échec d'enregistrement : elle
recliquera.

**Reproduction** : `pr-b-rsa-e2e.test.js › DÉFAUT D-01 — les mois RENSEIGNÉS doivent être rendus`
(le test vérifie d'abord que la base porte bien `honoree = true`, puis que l'API le rend).

**Correctif proposé** : lire le mois côté SQL plutôt que côté JS, ce qui supprime la conversion —
`SELECT EXTRACT(MONTH FROM mois)::int AS mois_num, to_char(mois,'YYYY-MM-DD') AS mois, …` — ou, a
minima, un helper partagé `jourIso(v)` qui traite `Date` **et** chaîne (celui de
`services/temps-engine.js › jourISO` fait déjà exactement cela : il existe, il n'est pas utilisé ici).

---

### D-02 — **MAJEUR** · les dates rendues par l'API sont au format « Sun Mar 02 »

**Où** : `backend/src/routes/insertion/rsa.js:225, 529, 531, 641, 643`

**Ce qui se passe** : `PUT /rsa/:id/actualisations-ft/:mois` et `GET /rsa/echeances-periodiques`
rendent `rappel_le` / `constat_le` sous la forme `"Sun Mar 02"` au lieu de `"2025-03-02"`. La valeur
est **correcte en base** (le test le vérifie) : c'est la restitution qui est fausse.

**Effet à l'écran — et c'est le point grave** : le front applique
`frDate = (d) => new Date(d).toLocaleDateString('fr-FR')`. Or V8 parse `"Sun Mar 02"` **sans erreur**,
en lui prêtant l'année par défaut **2001** :

```
frDate("Sun Mar 02")  →  02/03/2001
frDate("2025-03-02")  →  02/03/2025
```

Le tableau de bord affiche donc « rappelée le **02/03/2001** » : une date plausible, fausse de
vingt-quatre ans, et **qu'aucun message d'erreur ne signale**. Un « Invalid Date » aurait été moins
dangereux.

**Reproduction** : `DÉFAUT D-02 — le PUT doit rendre la date au format AAAA-MM-JJ`,
`DÉFAUT D-02 bis — la date de rappel du tableau de bord`, et l'assertion du test `upsert : rappel
puis constat`.

**Correctif proposé** : même helper partagé que D-01, appliqué aux cinq lignes.

---

### D-03 — **MAJEUR** · « jamais de contact tracé » se lit « il y a null j »

**Où** : `backend/src/routes/insertion/rsa.js:179-181`

```js
const brut = p.dernier_brut ? String(p.dernier_brut).slice(0, 10) : null;
const dernier = brut && brut > '1900-01-01' ? brut : null;
```

**Ce qui se passe** : la requête utilise `COALESCE(MAX(...), '1900-01-01')` comme **sentinelle**
d'absence, et le code la reconnaît en comparant la chaîne à `'1900-01-01'`. Mais
`String(sentinelle).slice(0, 10)` rend `"Mon Jan 01"`, et en ASCII **les lettres passent après les
chiffres** : `"Mon Jan 01" > "1900-01-01"` est **vrai**. La sentinelle est donc prise pour une vraie
date et ressort telle quelle ; `new Date("Mon Jan 01T00:00:00Z")` est invalide, donc
`du_depuis_jours` vaut `NaN`, sérialisé `null` en JSON.

Le commentaire du code, juste au-dessus, promet exactement l'inverse : « Un dossier sans aucun
contact ne rend PAS un nombre de jours géant […] mais `dernier_le: null` ».

**Effet à l'écran** : `InsertionParcours.jsx:538` teste `p.dernier_le ? … : 'jamais de contact tracé'`.
La branche « jamais de contact tracé » est donc **morte**, et le bloc « Point avec le référent à
prévoir » affiche **« dernier contact il y a null j »** — c'est-à-dire, au démarrage, pour la quasi
totalité de la cohorte.

**Reproduction** : `DÉFAUT D-03 — un dossier SANS aucun contact rend dernier_le null`.

**Correctif proposé** : supprimer la sentinelle et laisser `MAX()` rendre `NULL`
(`GREATEST` ignore les NULL en PostgreSQL ≥ 9.4 seulement si on passe par `COALESCE` sur chaque
membre — préférer `GREATEST(MAX(m.completed_date), MAX(a.remis_referent_le))`, qui rend `NULL` quand
les deux sont nuls), puis convertir la date par le helper partagé. Une sentinelle comparée en texte
est de toute façon fragile : elle suppose que la valeur reste une chaîne jusqu'au bout.

---

### D-04 — **MAJEUR** · une feuille signée peut disparaître de l'agrégat annuel

**Où** : `backend/src/services/temps-accompagnement.js:248-250`

```js
const intervenants = new Set();
for (const m of faits.milestones) …   // faits VIVANTS uniquement
for (const a of faits.actions)   …
for (const s of faits.saisies)   …
```

**Ce qui se passe** : `heuresAccompagnement` ne connaît que les intervenants qui ont des faits
**vivants** dans l'année. Les feuilles FIGÉES sont bien relues (l. 252-256) mais **seulement pour les
intervenants déjà présents dans cet ensemble**. Si le dernier fait vivant d'un intervenant disparaît
— un entretien supprimé ou corrigé après la signature, ce que la réouverture ADMIN permet
explicitement —, sa feuille signée **sort entièrement de l'agrégat**.

C'est précisément la promesse que l'en-tête de la fonction pose : « l'agrégat annoncé au dialogue de
gestion et les feuilles signées ne peuvent pas se contredire ».

**Reproduction** : `pr-b-temps-e2e.test.js › SONDE — une feuille SIGNÉE dont le fait d'origine a
disparu reste-t-elle comptée ?` — la feuille signée dit 90 minutes, l'agrégat ne connaît plus
l'intervenant du tout (`par_intervenant` ne le contient pas).

**Correctif proposé** : alimenter `intervenants` aussi depuis `insertion_feuilles_temps`
(`SELECT DISTINCT user_id … WHERE annee = $1 AND statut <> 'brouillon'`) — la requête des feuilles
figées est déjà faite, il suffit de la déplacer avant la constitution de l'ensemble et d'y ajouter
ses `user_id`.

---

### D-05 — **MOYEN (latent)** · toutes les dates de la feuille de temps glissent d'un jour hors UTC

**Où** : `backend/src/services/temps-engine.js:47` (`jourISO`, branche `Date`) et
`backend/src/routes/insertion/temps.js:220-222` (`new Date(saisie.date).getUTCMonth()`).

**Ce qui se passe** : le pilote rend une colonne `DATE` à **minuit LOCAL**. Sous un décalage positif
(Europe/Paris), `toISOString()` et `getUTC*()` renvoient donc **la veille**. Mesuré :

```
TZ=UTC          colonne DATE 2025-07-01 → mois déduit = 7 · jourISO = 2025-07-01
TZ=Europe/Paris colonne DATE 2025-07-01 → mois déduit = 6 · jourISO = 2025-06-30
```

Conséquence : rangement dans le mauvais mois (donc le mauvais bilan d'exécution), mauvais
rattachement ASI/OCS aux bornes de période, mauvaise détection des jours d'absence, et garde de gel
qui interroge la feuille du mois précédent.

**Mesure de l'impact** : la suite du lot 4 rejouée sous `TZ=Europe/Paris` passe de **1 rouge à 6
rouges** (composition, rattachement, saisie hors projet, cohérence, saisie du 1er du mois).

**Ce n'est pas un défaut de production aujourd'hui** : les conteneurs tournent en UTC (c'est la cause
racine documentée de la 2.47.0, « l'horloge venait de `getHours()` — donc du fuseau du conteneur, qui
tourne en UTC »). Mais le module est à une variable `TZ` près de dater faussement chaque ligne d'une
pièce de financement, sans rien signaler.

**Reproduction** :
```
TZ=Europe/Paris PR_B_E2E_DB=1 npx jest tests/e2e-pr-b/pr-b-temps-e2e.test.js --runInBand
```

**Correctif proposé** : dans `jourISO`, composer depuis `getFullYear()/getMonth()/getDate()` (heure
locale, cohérente avec la façon dont le pilote a construit l'objet) au lieu de `toISOString()` ; idem
pour la déduction du mois dans `temps.js`. Ou, plus robuste, demander la date au format texte à
PostgreSQL (`to_char(date, 'YYYY-MM-DD')`) partout où elle sert de clé.

---

### D-06 — **MOYEN** · une fiche part vers le référent sans sa trace, en silence

**Où** : `backend/src/routes/insertion/rsa.js:68-78` — `journaliser()` avale toute erreur d'écriture
(`catch { console.error(...) }`).

**Ce qui se passe** : la fiche pour le référent est un document qui **sort de la structure vers un
tiers qui peut décider d'une suspension de droits**. Sa trace au registre n'est pas un confort
d'exploitation : c'est la preuve de la transmission. Si l'écriture du registre échoue, le POST rend
**201**, la fiche est **écrite et renvoyée**, et rien ne le dit.

Le lot 4 tient la règle **inverse** sur son export (`temps.js:559`, « le journal est écrit AVANT
l'envoi, son échec fait échouer l'acte »). Les deux surfaces de la même PR ne se comportent donc pas
pareil devant le même risque.

**Reproduction** (panne injectée en BASE, pas dans le code — un CHECK temporaire qui refuse cette
seule action) : `pr-b-rsa-e2e.test.js › DÉFAUT D-06`. Mesuré côte à côte :

```
RSA   POST /fiche-referent : statut = 201 | fiche écrite = 1 | trace écrite = 0
TEMPS GET  export.csv      : statut = 500 | fichier envoyé = false | trace écrite = 0
```

**Correctif proposé** : aligner `rsa.js` sur `temps.js` **pour les deux gestes qui produisent un
document destiné à un tiers** (`INSERTION_FICHE_REFERENT_GENERATION` et
`INSERTION_FICHE_REFERENT_REMISE`) : journaliser dans la même transaction que l'écriture, et faire
échouer l'acte si la trace ne s'écrit pas. Les **consultations** peuvent rester tolérantes : perdre
la trace d'une lecture est regrettable, perdre celle d'une transmission est une non-conformité.

---

### D-07 — **MINEUR** · `/rsa/echeances-periodiques` calcule l'activité dossier par dossier

**Où** : `backend/src/routes/insertion/rsa.js:201-214` — boucle `for (const c of cohorte)` appelant
`activiteHebdo` (3 lectures de réglage + 5 requêtes) en **série**.

**Mesure** (base locale, cohorte synthétique) :

| Cohorte « en parcours » | Requêtes | Durée |
|---|---|---|
| 10 dossiers | 85 | 22 ms |
| 40 dossiers | 325 | 70 ms |

Soit **8 requêtes par dossier + 5 fixes**. Sur la cohorte réelle d'une SIAE (50-60 dossiers) et avec
la latence d'un conteneur voisin, cela reste tenable mais c'est le poste le plus coûteux du tableau
de bord CIP, pour un bloc de quatre lignes. À noter pour le jour où la cohorte grandit ou le
tableau de bord se rafraîchit tout seul.

**Correctif proposé** (non urgent) : les trois réglages se lisent **une fois** pour toute la boucle
(ils sont identiques) ; et les cinq sources peuvent être chargées en une passe pour toute la cohorte
(`WHERE employee_id = ANY($1)`) avant d'appeler le moteur pur, qui n'a besoin que de tableaux.

---

## 4. Ce qui est PROUVÉ VERT

### 4.1 Lot 3 — cadre RSA (41 vertes / 47)

| Domaine | Ce qui est établi |
|---|---|
| Types d'entretien | Le CHECK de la base accepte `point_etape_referent` et `conciliation` et **refuse** un type inventé (23514) ; l'API crée les deux et refuse le troisième en 400 ; `conciliation_motifs` est relu **en tableau JSONB** (pas une chaîne) ; un motif hors liste est refusé en 400 **sans écriture** ; une modalité hors liste est refusée par le CHECK |
| `date_realisation` | Posée à `CURRENT_DATE` par PostgreSQL au passage à « réalisé » ; **ne bouge pas** quand on repasse par « réalisé » (l'action ne change pas de semaine) ; une date explicite est écrite telle quelle |
| Compteur hebdomadaire | 52 semaines ISO ; seuils 15/20 lus dans les réglages ; une semaine **sans relevé** rend `heures_travail`, `total_heures` et `sous_seuil` **à `null`, jamais 0/false** ; un **arrêt déclaré** neutralise l'alerte **tout en comptant** dans `nb_semaines_sous_seuil` (3 semaines) avec la raison `arret` ; l'alerte se lève à **deux semaines consécutives** et pointe la première (S2) ; consultation journalisée |
| Relevé d'assiduité | Variante tiers : **aucune** clé `absence_piece_ref`, aucune trace de « affection longue durée » (`leave_type`), aucun « injustifiée » ; les absences de paie ne sortent **que** par `{du, au, categorie}` ; totaux présents/absents/**sans motif** exacts ; variante `dossier` demandée explicitement rend la référence de pièce ; consultation journalisée |
| Fiche pour le référent | 409 `REFERENT_NON_DETERMINE` **à l'aperçu ET à la génération**, sans aucune écriture ; l'aperçu n'écrit rien ; la génération écrit un snapshot dont les **9 clés de premier niveau** sont exactes ; les **7 axes transmissibles** seulement — `sante` et `judiciaire` n'ont **aucune clé**, et le mot « judiciaire » n'apparaît **nulle part** dans le JSONB stocké ; les actions à frein sensible sont retirées **ligne entière** (ni libellé, ni partenaire, ni résultat) tandis que l'action ordinaire passe ; le destinataire est **recopié** à la génération ; la liste ne rend **jamais** `contenu` ; la réimpression est journalisée ; une date de remise **future** est refusée en 400 **sans UPDATE** ; les deux remises (référent / personne) sont indépendantes et ne s'effacent pas |
| Actualisation FT | 409 `ACTUALISATION_FT_NON_REQUISE` sans écriture ; 12 mois rendus avec les absents à `null` **partout** ; `UNIQUE(employee_id, mois)` tenu ; les deux colonnes de synthèse d'`employees` sont **recalculées** (et reposer `honoree` à NULL **retire** le manquement) ; mois mal formé refusé en 400 |
| Échéances périodiques | Les 5 blocs attendus ; le dossier sans référent est nommé ; la personne soumise à l'actualisation est listée ; trimestre DTR au bon format |
| Habilitations | **403 sur les 10 routes** pour MANAGER, pour un jeton **chauffeur** et pour le rôle **COMMUNICATION** ; le refus est posé **avant toute lecture** — aucune trace de consultation n'apparaît au registre après une rafale de refus |
| Journal RGPD | Les **7 codes** du cadre RSA sont réellement écrits ; **aucune** trace ne recopie le contenu du document |
| Pool | 60 refus 4xx (403 / 409 / 400) ne retiennent **aucune** connexion |
| Anonymisation | `insertion_alimentations_referent` et `insertion_actualisations_ft` **vidées** |

### 4.2 Lot 4 — temps d'accompagnement (39 vertes / 40)

| Domaine | Ce qui est établi |
|---|---|
| Composition | 3 lignes depuis 2 entretiens chronométrés + 1 action ; l'entretien **sans durée** et celui à **0 minute** ne produisent **aucune** ligne ; l'entretien d'un **autre** intervenant n'entre pas (et entre bien dans SA feuille) |
| Rattachement | **ASI** par la participation réelle du salarié (`projet_id` exact) ; **OCS** par le poste réel de l'intervenant ; **HORS_PROJET** pour une saisie sans projet |
| Saisies | 201 ; date hors du mois → **400 `DATE_HORS_MOIS` sans écriture** ; activité hors liste refusée par le validateur **et** par le CHECK (23514) ; intervenant inconnu → 404 (et non 500) |
| Totaux | 255 min ventilées 60 / 75 / 120 ; **quotité 60 %** sur l'OCS, **absente** (jamais 0) sur l'ASI ; taux forfaitaires 40 % et 15 %, absent pour « hors projet » |
| Cohérence | Une ligne posée un jour de congé de l'intervenant (lu via `employees.user_id`) lève `jour_absence` ; le détail dit **« congés payés »** et **jamais** le libellé de paie « Congés payés été » ; **rien n'est bloqué** ; date de clôture et `cloture_depassee` corrects |
| Périmètre | MANAGER : **200** sur sa feuille, **403** sur une autre — avec `pool.query` **non appelé** (préchauffage du cache MFA fait explicitement) ; intervenants et synthèse refusés ; jeton chauffeur et rôle COMMUNICATION refusés ; la liste des intervenants retient ceux qui ont réellement travaillé et **exclut** l'ADMIN qui n'a rien mené |
| Export CSV | 409 `EXPORT_VIDE` **sans une ligne de journal** ; BOM, en-tête de traçabilité en 5 lignes, les **6 colonnes** en français, pied complet (total, par projet **avec quotité et taux**, « non renseignée » là où la quotité manque, ligne de cohérence, deux signatures « MANQUANTE », mention des durées déclaratives) ; **aucun nom** de bénéficiaire, seulement l'identifiant interne ; un code de projet piégé `=HYPERLINK(...)` sort **neutralisé** par une apostrophe ; journal écrit avec le total et **sans nom** |
| Gel et signatures | La validation fige `lignes`/`totaux`/`coherence` dans le JSONB (4 lignes, 255 min, anomalie figée avec le reste, **aucun nom**) ; une saisie ajoutée après le gel → **409 `FEUILLE_FIGEE` sans INSERT** ; une suppression → même refus ; **un fait nouveau ne bouge plus le total signé** ; le MANAGER ne contresigne pas (403 `VALIDATION_RH_RESERVEE`) et le **signataire du premier volet** non plus (409 `AUTO_VALIDATION`, sans UPDATE) ; la contre-signature par une autre personne passe et est journalisée ; une troisième validation → 409 ; un mois vide → 409 `FEUILLE_VIDE` **et le ROLLBACK laisse zéro ligne** |
| Réouverture | Motif obligatoire (400 sans lui), **ADMIN seul** (403 pour RH), les **deux** validations tombent, le motif et le total antérieur sont journalisés, la feuille redevient vivante et reprend les faits |
| Agrégat annuel | La synthèse relit les mois **figés** (255 min, les 300 min ajoutées après signature ne comptent pas) ; ventilation projet / salarié cohérente ; une année vide rend 0 minute mais une moyenne **`null`** ; **`gatherAuditKpis` expose `heures_accompagnement`** et le rend cohérent |
| Pool | 100 refus 4xx, **dont des refus transactionnels** (`pool.connect()` + ROLLBACK sur `valider` et `rouvrir`), ne retiennent aucune connexion |
| Anonymisation | L'`employee_id` disparaît du snapshot (`null`), **le nombre de lignes, les durées et le total restent intacts** — la pièce de financement survit, le lien nominatif non |

---

## 5. Contre-épreuves par mutation (6, toutes restaurées)

| # | Mutation temporaire | Effet |
|---|---|---|
| CE-1 | `rsa.js` : `authorize('ADMIN','RH')` → `+ 'MANAGER'` | **+2 rouges** (le refus MANAGER sur les 10 routes, et l'absence de trace de consultation) |
| CE-2 | `activite-hebdo-engine.js` : `sansReleve ? null : …` → `Number(heuresTravail)` (piège `Number(null) === 0`) | **+2 rouges** (semaine sans relevé, comptes d'alerte) |
| CE-3 | `fiche-referent.js` : `FREINS.filter(f => f.sensible == null)` → `FREINS`, `FREINS_EXCLUS` → `[]` | **+1 rouge** : la liste blanche du snapshot (axes, mot « judiciaire », actions sensibles) |
| CE-4 | `temps.js` : `gardeProprietaire` rend toujours `next()` | **+2 rouges** (403 sur une autre feuille, et le « avant toute requête ») |
| CE-5 | `temps-accompagnement.js` : le snapshot figé cesse de primer | **+3 rouges** (gel, fait nouveau ignoré, agrégat) |
| CE-6 | `temps.js` : le refus `EXPORT_VIDE` est neutralisé | **+1 rouge** |

`git diff` vide hors `tests/e2e-pr-b/` après chaque restauration (vérifié à chaque étape).

---

## 6. Deux défauts de mes propres tests, démasqués et corrigés

1. **La même erreur que D-01/D-02, dans le harnais.** Mes premières assertions lisaient les dates de
   la base par `String(ligne.colonne).slice(0, 10)` — exactement le raccourci que je cherchais. Sept
   assertions comparaient donc deux formes fausses et **n'auraient rien vu**. Un helper `iso()`
   dédié a été écrit, avec un commentaire qui dit pourquoi il existe ; les assertions qui portent sur
   la **réponse HTTP** (le vrai défaut) sont restées telles quelles.
2. **Un CHECK éprouvé par la mauvaise contrainte.** Le test « une modalité hors liste est refusée »
   envoyait `'quadripartite'` (13 caractères) dans un `VARCHAR(12)` : PostgreSQL refusait en **22001**
   (troncature), pas en 23514. Le test passait en croyant mesurer le CHECK, alors qu'il mesurait la
   longueur de la colonne. Remplacé par `'bipartite'`.

---

## 7. Commandes exactes pour rejouer

```bash
source /tmp/claude-0/-home-user-solidata-online/<session>/scratchpad/db-test.env

# 0. Régénérer la copie sans PostGIS (init-db.js a changé depuis la PR A)
cd /home/user/solidata.online
sed -e 's/GEOMETRY(Point, 4326)/TEXT/g' -e 's/USING GIST\s*(\(geom[a-z_]*\))/(\1)/Ig' \
    backend/src/scripts/init-db.js > backend/src/scripts/init-db.local.js

# 1. Migrations sur la base existante (idempotence)
cd backend && node src/scripts/init-db.local.js && node src/scripts/init-db.local.js

# 2. Base NEUVE (la passe 1 échoue : préexistant PR A)
su postgres -c "dropdb --if-exists solidata_test; createdb -O solidata_user solidata_test"
node src/scripts/init-db.local.js ; node src/scripts/migrate-exutoires.js \
  && node src/scripts/migrate-finance.js && node src/scripts/init-db.local.js \
  && node src/scripts/init-db.local.js

# 3. Les preuves PR B
PR_B_E2E_DB=1 npx jest tests/e2e-pr-b --runInBand
#   → Tests: 7 failed, 80 passed, 87 total   (les 7 rouges = D-01 à D-04 et D-06)

# 4. Non-régression PR A
PR_A_E2E_DB=1 npx jest tests/e2e-pr-a --runInBand      # → 93 passed

# 5. La suite complète, SANS base (les e2e sont ignorées)
npx jest                                                # → 232 suites, 4 636 tests verts, 8 suites skipped

# 6. Reproduction de D-05 (fuseau)
TZ=Europe/Paris PR_B_E2E_DB=1 npx jest tests/e2e-pr-b/pr-b-temps-e2e.test.js --runInBand
#   → 6 failed (contre 1 sous UTC)
```

---

## 8. État final

```
$ git status --short
?? backend/tests/e2e-pr-b/

$ git diff --stat -- . ':!backend/tests/e2e-pr-b' ':!backend/src/scripts/init-db.local.js'
(vide)
```

Aucun fichier source modifié. `init-db.local.js` est une copie de travail ignorée par git (elle
n'apparaît même pas en non suivie). Les deux contraintes de sonde posées en base
(`probe_ko`, `probe_ko_rsa`) ont été **retirées** — vérifié : `0` restante.

---

## 9. Synthèse pour l'agent de correctifs

| # | Gravité | Fichier:ligne | En une ligne |
|---|---|---|---|
| **D-01** | **BLOQUANT** | `routes/insertion/rsa.js:523` | Le registre d'actualisation FT rend douze mois vides quoi qu'on enregistre (`Number(String(Date).slice(5,7))` = NaN) |
| **D-02** | MAJEUR | `routes/insertion/rsa.js:225,529,531,641,643` | Dates rendues « Sun Mar 02 » → affichées **02/03/2001** à l'écran, sans erreur |
| **D-03** | MAJEUR | `routes/insertion/rsa.js:179-181` | La sentinelle `1900-01-01` n'est plus reconnue → « dernier contact il y a null j » au tableau de bord |
| **D-04** | MAJEUR | `services/temps-accompagnement.js:248` | Une feuille SIGNÉE sort de l'agrégat annuel si son dernier fait vivant disparaît |
| **D-05** | MOYEN (latent) | `services/temps-engine.js:47`, `routes/insertion/temps.js:220` | Hors UTC, toutes les dates de la feuille glissent d'un jour (6 rouges sous Europe/Paris) |
| **D-06** | MOYEN | `routes/insertion/rsa.js:68-78` | Une fiche part vers le référent en 201 alors que sa trace RGPD a échoué, en silence |
| **D-07** | MINEUR | `routes/insertion/rsa.js:201-214` | 8 requêtes par dossier en série sur le tableau de bord (325 requêtes pour 40 dossiers, mesuré) |

D-01, D-02 et D-03 sont **le même correctif** : un helper de conversion `Date | string → 'AAAA-MM-JJ'`
appliqué aux sept lignes de `rsa.js`, ou — préférable — la conversion faite par PostgreSQL
(`to_char`, `EXTRACT`). `services/temps-engine.js › jourISO` fait déjà ce travail, il suffit de
l'extraire dans `utils/` et de l'employer des deux côtés (et de corriger sa branche `Date`, D-05,
au passage).

---

*Agent de debug PostgreSQL — PR B. Fichiers écrits : `backend/tests/e2e-pr-b/_helpers.js`,
`backend/tests/e2e-pr-b/pr-b-rsa-e2e.test.js`, `backend/tests/e2e-pr-b/pr-b-temps-e2e.test.js`,
`rapports/cip-refonte-2026-09-12/18-debug-postgres-PR-B.md`. Aucun autre.*

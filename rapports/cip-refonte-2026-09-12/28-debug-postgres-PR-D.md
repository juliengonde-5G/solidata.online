# PR D « Reporting autorité » — debug sur PostgreSQL réel

> Agent de debug, 14/09/2026. Branche `claude/solidata-cip-redesign-9fskwq-pr-d` (HEAD `07a5ba8`, empilée sur la PR C).
> Périmètre d'écriture : `backend/tests/e2e-pr-d/` (nouveau) et ce fichier. **Aucune ligne de code source
> n'a été modifiée** — les sept mutations de contre-épreuve ont toutes été restaurées, `git status` le
> confirme (§ 7). Aucune commande git d'écriture.
> Références : contrat `25-contrats-techniques-PR-D.md`, réalisation `26-realisation-lot6.md`,
> méthode `23-debug-postgres-PR-C.md` § 1 et `18-debug-postgres-PR-B.md` § 1.

---

## 0. En une phrase

**74 vérifications de bout en bout** ont été jouées à travers les vrais handlers Express contre
PostgreSQL 16.13, sur la base PR C migrée **et** sur une base neuve, sous `TZ=UTC`
(**65 vertes, 9 rouges**) puis sous `TZ=Europe/Paris` (**64 vertes, 10 rouges**) : elles isolent
**sept défauts**, dont **un majeur RGPD** — sur un axe de frein dont le nombre de personnes est
supprimé par k-anonymat, la synthèse transmise à l'autorité publie quand même le nombre d'actions,
l'orientation DORA, le **partenaire** et le **montant d'aide** du même axe — et **deux majeurs** :
un mois sans le moindre contrat CDDI vaut **1,00 ETP** dans le bloc des effectifs, et l'export (d)
écrit **« stable »** là où la synthèse dit **« non évalué »** pour la même personne, la même année.

---

## 1. Ce qui a été mis en place

| Fichier | Contenu |
|---|---|
| `backend/tests/e2e-pr-d/_helpers.js` | Socle : **réutilise celui de la PR C** (jetons MFA, comptes par rôle, salarié minimal, `iso()`, photographie du pool) et y ajoute la purge du périmètre PR D — `etp_asp_mensuel`, `etp_asp_salaries`, `insertion_dialogues_gestion` et le journal RGPD ne sont en CASCADE sur rien : une suite qui compare des totaux doit partir d'un état connu. Plus `toutesLesCles()` (recherche récursive des clés interdites dans la sérialisation complète) |
| `backend/tests/e2e-pr-d/pr-d-reporting-e2e.test.js` | **46 vérifications** : SQL neuf (`generate_series` × `make_date`, `ROW_NUMBER() OVER`, LATERAL de dernière évaluation), dénominateur des sorties et cohérence des **quatre surfaces**, k-anonymat, non-nominativité sur la RÉPONSE et sur le **JSONB stocké**, art. 10, judiciaire, les quatre gestes de la route (aperçu / génération / historique / rejeu), CSV, trimestriel, `EXPORT_VIDE`, habilitations, fuites de pool, dates civiles dans les deux fuseaux |
| `backend/tests/e2e-pr-d/pr-d-exports-e2e.test.js` | **28 vérifications** : tableau des freins enrichi (45 / 48 colonnes, ordre du CDC, `ARRAY_AGG` des deux LATERAL, judiciaire, quotité contractuelle, complétude, journal sous code distinct, 409, XLSX réellement produit), et les trois saisies (DORA https, aide, débouché déduit) |

Les deux suites sont **ignorées tant que `PR_D_E2E_DB=1` (ou `PR_A/B/C_E2E_DB=1`) n'est pas fourni** :
`npx jest` reste vert sans base (§ 5.4).

### 1.1 Jeu d'essai — ce qu'il porte délibérément

La base est **vide de toute autre personne en parcours** (vérifié par `V-00` avant la première
assertion) : sans cela, les agrégats de cohorte mesureraient les restes d'une autre suite.

**Douze dossiers**, construits pour que chaque nombre soit prévisible à l'unité :

- **cinq fins de parcours** dans l'année — trois avec bilan de sortie **classé** (emploi durable /
  transition / positive), **deux sans bilan** (« sortie non documentée »), dont une le **31/12** ;
- **un bilan classé SANS date de fin de parcours** : il compte dans la méthode A et pas dans la B.
  Dénominateur A = 4, dénominateur B = 5 ; taux dynamiques **75 % en A, 60 % en B** — l'écart est
  visible à l'œil nu, ce qui est le but de la double impression 2026 ;
- **six dossiers encore en parcours**, répartis pour croiser le seuil de k-anonymat : référent
  `cms` **5** (rendu), `france_travail` **4** (retiré), `structure` / `autre` / `non_determine` **1**
  chacun ; critère d'éligibilité `brsa` **5**, `rqth` **3**, et **`sortant_detention` (art. 10) sur
  deux personnes** — son absence doit venir du code, pas de l'absence de donnée ;
- **freins** : diagnostic d'entrée pour les douze (judiciaire **renseigné à 4**), puis dernière
  évaluation donnant **5 levés**, 1 aggravé, 4 stables, 2 non évalués sur l'axe mobilité ;
- **six PMSMP** à débouchés variés dont deux embauches chez l'accueillant ; **cinq actions** portant
  DORA (`oriente` / `pris_en_charge` / `refuse` / `sans_suite`), aides mobilisées et partenaire, dont
  une en `job_dating` et une en `formation_fle` ; **six mois d'ETP ASP** avec `nb_brsa` croissant
  (le dernier mois validé doit faire foi) ; **quatre sorties déclarées à l'ASP** pour cinq
  constatées (écart de rapprochement = 1) ; alimentations du référent remises, actualisations
  France Travail, une conciliation, une absence à motif documenté, participants ASI, relevés de
  semaines.

---

## 2. Séquence de migration

### 2.1 Base existante (état PR C) — trois passes

```
node src/scripts/init-db.local.js     # passe 1 : exit 0, la migration PR D posée
node src/scripts/init-db.local.js     # passe 2 : exit 0
node src/scripts/init-db.local.js     # passe 3 : exit 0
```

`init-db.local.js` a été **régénérée** avant tout par la commande `sed` documentée en tête du
rapport 13 (`GEOMETRY(Point, 4326)` → `TEXT`, index GiST → btree : la machine de recette n'a pas
PostGIS). La base passe de **244 à 245 tables**.

### 2.2 Base NEUVE — séquence documentée

```
dropdb solidata_neuve_d ; createdb -O solidata_user solidata_neuve_d
node src/scripts/init-db.local.js     # exit 1 — ATTENDU : « relation "clients_exutoires" does not exist »
node src/scripts/migrate-exutoires.js # exit 0
node src/scripts/migrate-finance.js   # exit 0
node src/scripts/init-db.local.js     # exit 0
node src/scripts/init-db.local.js     # exit 0 (idempotence)
```

L'échec de la passe 1 est le **préexistant documenté par la PR A** (13 § 2), sans rapport avec la
PR D. **Les 74 vérifications ont été rejouées intégralement sur cette base neuve** : résultats
identiques au test près (65/9 sous `TZ=UTC`, 64/10 sous `TZ=Europe/Paris`) — aucun des sept défauts
n'est un artefact de la base migrée.

### 2.3 État du schéma vérifié (base migrée ET base neuve)

| Vérification | Résultat |
|---|---|
| `insertion_pmsmp.debouche` / `debouche_date` / `embauche_accueillant` | posées, **toutes NULLABLES** ✓ (`embauche_accueillant` sans `DEFAULT false` : « on ne sait pas » ≠ « non ») |
| CHECK `insertion_pmsmp_debouche_check` | présent, et **exercé** : `embauche_accueillant` accepté, `hors_liste` refusé en **23514** ✓ |
| `cip_action_plans.dora_service/url/resultat` + `aide_nature/organisme/montant` | posées ✓ |
| CHECK `dora_resultat`, `aide_nature` | exercés : une valeur hors liste refusée en 23514 ✓ |
| CHECK `aide_montant >= 0` | exercé : `-5` refusé, **`0` accepté** ✓ (une aide ramenée à zéro se saisit ; c'est l'absence qui s'écrit NULL) |
| CHECK `cip_action_plans_category_check` | **reconstruit** à 7 valeurs : `job_dating` ET `formation_fle` acceptés, `hors_liste` refusé en 23514 ✓ — et les six valeurs de la PR A sont conservées |
| `insertion_partenaires.categorie` = `cms` | accepté — **mais parce qu'aucun CHECK n'existe sur cette colonne** : `n_importe_quoi` passe aussi. C'est l'**écart E-3 assumé** par le lot (créer un CHECK rejetterait les lignes déjà saisies en catégorie libre) |
| Partenaire CMS | **exactement 1 ligne** après 3 passes sur base migrée et sur base neuve, catégorie normalisée en `cms` ✓ — aucun doublon créé |
| `insertion_dialogues_gestion` (7 colonnes) + index `idx_..._periode` + CHECK `trimestre` | posés, et le CHECK est **exercé** : `trimestre = 5` refusé en 23514, `NULL` accepté ✓ |
| Aucune entrée art. 30 nouvelle | conforme au contrat (le snapshot est agrégé) ✓ |
| Non-régression PR A + PR B + PR C | **316 vérifications vertes**, sous `TZ=UTC` **et** `TZ=Europe/Paris` ✓ |

---

## 3. Défauts trouvés

> Aucun n'a été corrigé. Chacun est décrit avec sa reproduction, sa cause et le correctif proposé.
> Les tests qui les reproduisent sont **rouges dans la suite** et portent le préfixe `DÉFAUT D-xx` :
> ils forment le filet de non-régression du correctif à venir.

---

### D-01 — **MAJEUR** · les dates de l'export (d) reculent d'un jour hors UTC

**Où** : `backend/src/utils/insertion-freins-export.js:139` (`fmtDate`).

```js
const fmtDate = (v) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};
```

**Reproduction** (hors suite, trois fuseaux, colonne `DATE` réelle lue par le pilote) :

```
TZ= UTC              | date_naissance= 1990-06-15 | brsa_date_constat= 2026-01-05
TZ= Europe/Paris     | date_naissance= 1990-06-14 | brsa_date_constat= 2026-01-04
TZ= America/New_York | date_naissance= 1990-06-15 | brsa_date_constat= 2026-01-05
```

Et dans la suite : `V-52` est **verte sous `TZ=UTC`, rouge sous `TZ=Europe/Paris`**.

**Cause racine.** `node-pg` convertit une colonne `DATE` en objet `Date` à **minuit LOCAL**.
`toISOString()` le relit en **UTC** : sous un fuseau à offset positif, il retombe la veille à 22 h ou
23 h, et le `slice(0, 10)` rend le jour précédent. Ce sont **cinq colonnes** de l'export (d) qui sont
concernées : « Date d'entrée ACI », « Fin PASS IAE », « Date de naissance », « Date de constat BRSA »
(ajoutée par la PR D) et la date de dernière PMSMP.

**Ce qui rend le constat sérieux plutôt qu'anecdotique.** C'est **exactement** la famille D-01/D-02
de la PR B, dont le rapport 18 annonçait la clôture : le correctif de fond (`utils/date-iso.js`,
helper PUR indépendant du fuseau) **existe dans le dépôt** et a été appliqué à l'export FSE+ 29
colonnes — parce qu'il **décalait la date de naissance transmise à l'autorité**. Le même helper n'a
pas été porté ici, et la PR D a ajouté une sixième date par le même chemin. En production les
conteneurs tournent en UTC : le défaut est **latent**, à une variable d'environnement près, sur un
fichier qui part à la DDETS avec des dates de naissance servant à apparier des personnes.

**Correctif proposé** : remplacer le corps de `fmtDate` par `isoDate(v)` de
`backend/src/utils/date-iso.js` (qui lit les composantes locales et ne repasse jamais par UTC), en
conservant le repli `String(v)` sur une valeur illisible. Une ligne, aucune autre surface touchée.

---

### D-02 — **MAJEUR** · l'export (d) écrit « stable » là où la synthèse dit « non évalué »

**Où** : `backend/src/routes/exports.js:705` (`COALESCE(lm.${c}, d.${c}) AS ${c}`) et
`backend/src/utils/insertion-freins-export.js:215`
(`cells[...] = evolutionFrein(entree, r[f.column])`).

**Reproduction** (`V-43b`, `V-43c`, rouges dans les deux fuseaux) : un dossier porte un diagnostic
d'accueil (mobilité = 3) et **aucun entretien réalisé**. Rien n'a donc été mesuré une seconde fois.

| Surface | Ce qu'elle dit de cette personne |
|---|---|
| Synthèse de dialogue de gestion, bloc 3 | **« non évalué »** (`bloc3Freins` lit `lm.<axe>`, nul faute d'entretien) |
| Export (d), colonne « Frein mobilité — évolution » | **« stable »** |

**Cause racine.** `fetchFreinsRows` rend la valeur **courante** déjà repliée sur le diagnostic
(`COALESCE(lm, d)`) — c'est la règle de valorisation du CDC, et elle est juste **pour la valeur
courante**. Mais `rowToCells` réutilise cette valeur repliée comme second terme de l'évolution :
`evolutionFrein(d, COALESCE(lm, d))` compare alors le diagnostic **avec lui-même**, ce qui rend
toujours « stable ». `evolutionFrein` est pourtant écrite pour l'inverse, et son propre commentaire
le dit : « jamais “stable” par défaut, qui ferait passer une absence de mesure pour un constat ».
La fonction est correcte ; c'est son alimentation qui ne l'est pas.

**Conséquences.** (1) Deux documents transmis à la même instructrice, sur la même année, se
contredisent sur la même personne. (2) La complétude (`V-49`) affiche **100 % de renseigné** sur les
colonnes d'évolution — donc « rien à compléter » — là où précisément aucune évolution n'est
mesurable : c'est l'écran qui doit repérer les diagnostics à reprendre qui dit qu'il n'y a rien à
reprendre. (3) L'indicateur central de la convention 2026-2027 (exigence S2) sort **surévalué en
« stable »**, catégorie qui se lit « l'accompagnement n'a rien changé » alors que la lecture juste
est « nous ne l'avons pas remesuré ».

**Correctif proposé** : projeter la **dernière évaluation BRUTE** à côté de la valeur repliée
(`lm.${c} AS ${c}_actuel` dans `fetchFreinsRows`) et alimenter
`evolutionFrein(r[`${col}_entree`], r[`${col}_actuel`])`. La valeur courante des colonnes 14-20 reste
inchangée : seule la colonne d'évolution change de source, et elle se met alors à dire la même chose
que le bloc 3.

---

### D-03 — **MAJEUR** · « 0 semaine sous 15 h » pour quelqu'un dont rien n'a été relevé

**Où** : `backend/src/routes/exports.js:799` et `backend/src/services/dialogue-gestion.js:841`.

**Reproduction** (`V-46`, rouge dans les deux fuseaux) : aucun des trois dossiers de la suite ne
porte la moindre ligne `employee_week_hours`. Le moteur d'activité **le sait et le dit** —
`activiteHebdoCohorte` rend `nb_semaines_relevees: 0` à côté de `nb_semaines_sous_seuil: 0` — mais
seul le second est lu. La colonne imprime **`0`**, et le bloc 8 de la synthèse affiche
« 0 personne concernée / 0 semaine ».

**Cause racine.** `nb_semaines_sous_seuil` compte les semaines **relevées** sous le plancher : zéro
relevé donne légitimement zéro. Mais un `0` dans une colonne intitulée « Semaines sous 15 h (année) »
sur un document de contrôle se lit « cette personne n'est jamais passée sous le plancher », c'est-à-dire
l'exact contraire de ce qui est su. C'est la même doctrine que la PR B a posée pour le relevé
d'assiduité — « une semaine sans relevé est `null`, jamais 0 h » — appliquée à l'échelle de la ligne
au lieu de la semaine. Le lot en a d'ailleurs conscience et l'écrit (« échec → colonne vide, jamais
0 ») : la garde couvre l'échec du service, pas l'absence de relevé.

**Correctif proposé** : laisser la cellule **vide** quand `nb_semaines_relevees === 0`
(`exports.js`), et rendre `semaines_sous_15h: null` avec sa ligne de méthode quand aucune semaine
n'est relevée sur toute la cohorte (`dialogue-gestion.js`). L'information est déjà là, il n'y a
qu'à la lire.

---

### D-04 — **MAJEUR** · un mois sans le moindre contrat CDDI vaut 1,00 ETP

**Où** : `backend/src/services/dialogue-gestion.js:301` (`bloc1Effectifs`).

```sql
COALESCE(SUM(COALESCE(ec.weekly_hours, e.weekly_hours, 35)::numeric / 35), 0)::float AS etp
```

**Reproduction minimale sur PostgreSQL réel** — un seul salarié, un contrat CDDI de janvier à juin :

```
 mois |        etp         | nb_contrats
------+--------------------+-------------
    1 | 0.7428571428571429 |           1
   ...
    6 | 0.7428571428571429 |           1
    7 |                  1 |           0     ← 1,00 ETP, sans un seul contrat
   ...
   12 |                  1 |           0
```

Et dans la suite : `V-05b` demande la synthèse **2025**, année où la cohorte n'a aucun contrat, et
reçoit **1,00 ETP pour les douze mois**.

**Cause racine.** Le `LEFT JOIN` de `generate_series` produit, pour un mois sans contrat, **une ligne
avec toutes les colonnes à NULL**. Le `COALESCE(..., 35)` intérieur transforme alors cette absence en
**35 heures**, et `35 / 35 = 1`. Le `COALESCE(SUM(...), 0)` extérieur, posé pour attraper ce cas, ne
se déclenche **jamais** : `SUM` ne rend pas NULL, il rend 1. Le défaut du `COALESCE` par défaut à 35
est de s'appliquer aussi bien à « contrat sans quotité saisie » (où il a un sens) qu'à « pas de
contrat du tout » (où il en invente un).

**Ce que cela produit en production.** L'« effectif pondéré » est la colonne de **contrôle** du bloc
des ETP d'un document de conventionnement. Toute synthèse annuelle générée avant que les contrats de
fin d'année n'existent — c'est-à-dire toute synthèse générée en cours d'exercice — imprimera
**1,00 ETP par mois non couvert**, sorti de rien. Sur un exercice à venir, douze mois à 1,00.
C'est la doctrine « jamais de valeur inventée » rompue à l'endroit exact où elle compte le plus.

**Correctif proposé** : `COALESCE(SUM(...) FILTER (WHERE ec.id IS NOT NULL), 0)` — ou, plus lisible,
`SUM(CASE WHEN ec.id IS NULL THEN 0 ELSE COALESCE(...)/35 END)`. Un mois sans contrat vaut alors 0,
ce qui est le vrai.

**Constat connexe, mineur, relevé au passage** : le même `LEFT JOIN` ne dédoublonne pas les avenants.
Deux lignes `employee_contracts` du même salarié laissées **toutes deux ouvertes** (`end_date` nulle)
sont comptées **deux fois** — reproduit sur base réelle (2 × 26/35 = 1,49 ETP pour une personne).
L'import de paie chaîne normalement les périodes (la ligne précédente s'arrête la veille de la
suivante), donc le cas suppose une reprise manuelle ; il n'en reste pas moins qu'une seule personne
peut peser deux ETP. Un `DISTINCT ON (ec.employee_id)` ordonné par `start_date DESC` le ferme.

---

### D-05 — **MINEUR** · un montant d'aide démesuré tombe en 500 au lieu de 400

**Où** : `backend/src/routes/insertion/routes.js:1477` (`VALIDATEURS_DORA_AIDE`).

**Reproduction** (`V-55b`) : `POST /api/insertion/action-plans` avec `aide_montant: 999999999999`
→ **500 « Erreur serveur »**. La colonne est `NUMERIC(9,2)` : PostgreSQL lève `22003` (dépassement de
capacité), l'erreur n'est pas dans la liste `('23503', '23514')` interceptée par le `catch`, et la
conseillère reçoit un message qui ne dit pas quoi corriger.

**Cause racine.** `isFloat({ min: 0 })` borne le minimum et pas le maximum, alors que la colonne, elle,
est bornée. Même classe que les valeurs hors CHECK déjà couvertes juste à côté.

**Correctif proposé** : `isFloat({ min: 0, max: 9999999.99 })` dans le validateur (la borne est celle
de la colonne), et ajouter `'22003'` à la liste des codes traduits en 400 dans le `catch` du PUT et
du POST — un dépassement de capacité est une saisie invalide, pas une panne.

---

### D-06 — **MINEUR** · le CSV de la synthèse annonce un seuil qu'il n'applique pas

**Où** : `backend/src/services/dialogue-gestion.js:1171` (`aplatirEnLignes`).

**Reproduction** (`V-29b`, `V-29c`) : avec `insertion.k_anonymat_min = 3`, le **même fichier CSV**
contient :

```
9. Méthode;Agrégats non rendus (k-anonymat);Tout agrégat comptant entre 1 et 2 personnes est rendu vide…
9. Méthode;Agrégat non rendu (moins de 5 personnes);blocs.2_publics_entree.par_categorie_ft.non_renseignee
```

Le seuil **est bien appliqué** (`V-29c` : l'en-tête porte `k_anonymat: 3` et l'agrégat à 4 est rendu) :
c'est son **libellé** qui est écrit en dur dans la liste des agrégats retirés, alors que `bloc9Methode`
le compose correctement depuis le réglage.

**Pourquoi ce n'est pas cosmétique.** Le bloc 9 est le bloc que l'instructrice lit en premier quand un
chiffre la surprend — c'est la raison d'être du document. Un fichier qui énonce deux règles
contradictoires sur sa propre méthode de suppression rend cette méthode incontrôlable.

**Correctif proposé** : passer le seuil à `aplatirEnLignes` (il est déjà dans
`synthese.en_tete.k_anonymat`) et composer le libellé, exactement comme le fait `bloc9Methode`.

---

### D-07 — **MAJEUR (RGPD)** · les compteurs d'actions échappent au k-anonymat que les personnes subissent

**Où** : `backend/src/services/dialogue-gestion.js:533-540` (bloc 3) et `:618-623` (bloc 4).

```js
actions_engagees: num(a.n_actions) || 0,          // jamais passé par k()
partenaire_principal: partenaireParAxe.get(f.key) || null,
orientations_dora: num(a.n_dora) || 0,            // jamais passé par k()
dora_resultats: { oriente: … || 0, pris_en_charge: … || 0, … },
…
n: num(r.n) || 0,                                 // aides mobilisées
montant_total: num(r.n_chiffrees) > 0 ? r2(r.montant_total) : null,
```

**Reproduction** (`V-53b`, `V-53c`, rouges dans les deux fuseaux ; et une reproduction isolée sur une
cohorte d'**une seule personne** portant un frein santé) — la synthèse rend :

```json
"3_freins": { "par_axe": [ { "axe": "sante",
    "concernes_entree": null,            ← supprimé par k-anonymat
    "leves": 0, "aggraves": 0, "non_evalues": null,
    "actions_engagees": 1,               ← publié
    "partenaire_principal": "Centre médico-social (CMS) — Département 76",
    "orientations_dora": 1,
    "dora_resultats": { "pris_en_charge": 1 } } ] },
"4_accompagnement": { "aides_mobilisees": [
    { "nature": "sante", "n": 1, "montant_total": 450 } ] },
"2_publics_entree": { "effectif": 1 }
```

Le document, qui s'annonce « strictement non nominatif » et qui **sort de la structure**, dit donc :
*la structure accompagne une personne ; cette personne a été orientée au CMS pour un frein de santé,
prise en charge, et a reçu 450 € d'aide santé*. Le nombre de **personnes** de l'axe est supprimé ;
les compteurs d'**actions** du même axe, qui comptent chacun au moins une personne, ne le sont pas.

**Cause racine.** `faireKAnon` est appliqué avec discipline aux quatre compteurs de personnes de
l'axe (`concernes_entree`, `leves`, `stables`, `aggraves`, `non_evalues`) et **pas** aux cinq
compteurs d'actions posés juste en dessous, ni au partenaire, ni à la ligne d'aide du bloc 4. Le
garde-fou est le bon ; son périmètre s'arrête au milieu de l'objet qu'il protège. L'en-tête du
fichier énonce pourtant la règle exacte que ce chemin contourne : « une personne relevant du critère
“sortant de détention”, catégorie France Travail G, sortie en emploi durable désigne quelqu'un aussi
sûrement qu'un nom ».

**Aggravant** : il s'agit d'un frein de **santé** (art. 9) et d'un montant d'aide individualisé, sur
un document destiné à un tiers financeur.

**Correctif proposé** : passer `actions_engagees`, `orientations_dora` et les quatre
`dora_resultats` par `k()` avec leur chemin, et **supprimer `partenaire_principal` dès que
`actions_engagees` est supprimé** (un partenaire unique sur un axe à une action désigne le même
dossier). Au bloc 4, passer `aides_mobilisees[].n` par `k()` et rendre `montant_total` **null** dès
que `n` l'est. Contrepartie assumée à porter au bloc 9 : sur une petite structure, plusieurs lignes
d'aide disparaîtront — c'est le prix du document, et il est déjà payé par les autres lignes.

**À arbitrer dans la foulée (hors défaut)** : les « effectifs bruts globaux » exemptés du seuil
(`2_publics_entree.effectif`, `3_freins.nb_dossiers`, `5_immersions.conventions`,
`7_resultats.nb_sorties_suivies`, `6_sorties.methode_b.denominateur`) sont ce qui donne le
dénominateur du recoupement. L'exemption est argumentée et l'indicateur n° 15 de l'autorité l'exige
pour les sorties non documentées ; `nb_dossiers` et `nb_sorties_suivies`, eux, ne sont réclamés par
personne et pourraient rentrer dans le droit commun.

---

## 4. Contre-épreuves par mutation

Sept mutations, jouées une par une, **toutes restaurées** (§ 7). Le décompte porte sur les tests
VERTS qui tombent ; les neuf rouges permanents sont exclus.

| # | Mutation | Fichier | Tests verts qui tombent |
|---|---|---|---|
| 1 | k-anonymat neutralisé (`faireKAnon` rend toujours la valeur) | `services/dialogue-gestion.js` | **1** (`V-15`) — et `V-29b`, rouge, devient vert : la mutation se voit **des deux côtés** |
| 2 | Judiciaire réintroduit dans `AXES_BLOC3` | `services/dialogue-gestion.js` | **2** (`V-19` absence du judiciaire, `V-24` absence sur le JSONB **stocké**) |
| 3 | Dénominateur B ramené aux seules sorties documentées | `services/sorties-engine.js` | **5** (`V-07`, `V-11`, `V-17`, `V-26`, `V-36`) |
| 4 | `journaliserDocument` rendu tolérant | `utils/insertion-journal.js` | **3** (`V-24`, `V-25`, `V-28`) |
| 5 | Garde `sensible_art10` retirée des DEUX surfaces | `services/dialogue-gestion.js` + `routes/exports.js` | **3** (`V-18`, `V-24`, `V-42`) |
| 6 | Refus `EXPORT_VIDE` neutralisé (`estVide` rend toujours false) | `routes/insertion/reporting.js` | **2** (`V-30b`, `V-31`) |
| 7 | Une colonne du cadre 2026 intercalée dans les 23 du CDC | `utils/insertion-freins-export.js` | **2** (`V-39`, `V-40`) |

La mutation 1 est la plus instructive : **un seul** test vert tombe. Le k-anonymat n'est donc tenu,
sur les 74 vérifications, que par `V-15` — ce qui est cohérent avec le constat D-07 : ce que le
garde-fou couvre réellement est plus étroit que ce que le document promet.

Deux effets de bord notés et voulus : la mutation 2 fait tomber `V-24`, qui cherche le judiciaire
dans le **JSONB relu en base** et non dans la réponse HTTP — la preuve porte bien sur ce qui dort
dans la table ; la mutation 5 fait tomber `V-24` pour la même raison sur `sortant_detention`.

---

## 5. Ce qui est prouvé sur base réelle

### 5.1 Le SQL neuf s'exécute — et rend le bon résultat

Le service enveloppe chaque requête dans un `soft()` qui **avale l'erreur** et rend `null` : une
requête fautive n'aurait pas fait tomber le document, elle aurait vidé un bloc en silence. Les
assertions portent donc sur les **résultats**, pas sur l'absence d'exception.

| Construction | Vérification |
|---|---|
| `generate_series(1,12)` × `make_date($1, m, 15)` (bloc 1) | `V-01` : les 12 mois rendus dans l'ordre, `2026-01` → `2026-12`, effectif pondéré **8,91** pour 12 contrats à 26 h (12 × 26/35) |
| `LEFT JOIN LATERAL … ORDER BY COALESCE(completed_date, due_date) DESC LIMIT 1` (bloc 3) | `V-04` : **5 levés** sur l'axe mobilité, 12 dossiers lus |
| `ROW_NUMBER() OVER (PARTITION BY a.frein_type ORDER BY COUNT(*) DESC, pa.nom)` (bloc 3) | `V-03` : le partenaire principal remonte, un par axe |
| Deux `LEFT JOIN LATERAL` à `ARRAY_AGG` (`fetchFreinsRows`) | `V-41` : critères d'éligibilité **joints par « ; »**, projet cofinancé `ASI-2026-2027` |
| `conformiteProjet` par projet + `activiteHebdoCohorte` (bloc 8) | `V-05` : 3 points d'étape, 3 fiches remises, 4 actualisations FT, 1 conciliation |
| Tous blocs | `V-06` : **aucun bloc ne porte `indisponible`** — aucune requête n'a été avalée |

### 5.2 Le dénominateur des sorties, et la cohérence des quatre surfaces

| Vérification | Résultat |
|---|---|
| Méthode B : 5 fins de parcours, **3 documentées, 2 non documentées**, taux dynamiques **60 %** | `V-07` ✓ |
| Le bilan sans fin de parcours est **nommé** (`bilans_sans_fin_parcours: 1`) et explique l'écart | `V-08` ✓ |
| Méthode A imprimée en 2026 (dénominateur 4, **75 %**), `null` en 2025 | `V-09` ✓ |
| Un dénominateur nul rend **`null` et jamais 0 %** | `V-09` ✓ |
| Clés historiques de `sorties` **inchangées et toujours en méthode A** (`total` 4, `dynamiques` 3, `taux_dynamiques` 75) | `V-10` ✓ |
| Rapprochement ASP : 5 constatées, 4 déclarées, **écart 1** | `V-11` ✓ |
| Les règles sont imprimées en toutes lettres, **« objectif non paramétré »** compris | `V-12` ✓ |
| **`/insertion/audit`, `/insertion/reporting/dialogue-gestion`, `/exports/insertion-synthese` et `/performance` disent le MÊME chiffre** | `V-13` ✓ |
| `/performance` : aucun pourcentage sans dénominateur, nouvelle nomenclature présente | `V-14` ✓ |

### 5.3 Confidentialité

| Vérification | Résultat |
|---|---|
| Agrégat à **4 → supprimé + chemin listé** ; à **5 → rendu** | `V-15` ✓ |
| **Zéro reste zéro** et n'entre pas dans `sous_seuil` | `V-16` ✓ |
| Effectifs bruts globaux exemptés (12 / 6 / 5 / 2 non documentées) | `V-17` ✓ |
| Critère art. 10 **absent**, et son exclusion **non mentionnée** (`détention` introuvable dans tout le document) | `V-18` ✓ |
| Frein judiciaire absent du bloc 3 **et de toute la sérialisation**, alors qu'il est renseigné à 4 en base | `V-19` ✓ |
| Aucune des 11 clés interdites, aucun patronyme du jeu d'essai, dans la **réponse** | `V-20` ✓ |
| Idem dans le **JSONB stocké** en base (`insertion_dialogues_gestion.contenu`) | `V-24` ✓ |
| `n_asp` du BRSA = **dernier mois validé** (16, soit le 6ᵉ mois) | `V-21` ✓ |
| Base **1 820 h** par défaut, puis `effectifs.convention_<annee>` (1 607) quand l'annexe est saisie, avec `source_convention` exposée | `V-22` ✓ |
| MANAGER : `/audit` rend 200 sans aucune ventilation par salarié ni clé nominative dans les **nouveaux** blocs | `V-35b` ✓ |
| Les nouveaux blocs de `/audit` ne sont **pas** masqués (écran interne : 4 référents FT rendus) | `V-35c` ✓ |

### 5.4 Les quatre gestes, les exports, les habilitations

| Vérification | Résultat |
|---|---|
| GET journalise `…_APERCU`, **aucune ligne créée**, trace sans donnée nominative | `V-23` ✓ |
| POST : snapshot + trace `…_GENERATION` **dans la même transaction** | `V-24` ✓ |
| Journal en échec (CHECK temporaire) → **500 et aucun snapshot** | `V-25` ✓ |
| Historique : prénom + initiale du générateur, jamais le nom ; type `annuelle` | `V-26` ✓ |
| Rejeu : journal `…_CONSULTATION` ; un snapshot forgé à `effectif: 44` **rejoue 44** | `V-26`, `V-27` ✓ |
| CSV : **BOM**, `;`, en-tête de traçabilité avec le **rôle** du générateur, bloc 9 présent, journal `EXPORT_DIALOGUE_GESTION` bloquant | `V-28` ✓ |
| CSV : **formules neutralisées** — une raison sociale `=1+1` et un partenaire `@cmd\|calc` insérés en base ne produisent **aucune** cellule commençant par `=`, `+`, `@` | `V-29` ✓ |
| Trimestriel : **exactement** les blocs 2, 8 et 9 ; bornes `2026-04-01` → `2026-06-30` | `V-30` ✓ |
| `409 EXPORT_VIDE` sur une année vide — CSV, POST (aucun snapshot écrit), synthèse comité, et trimestriel | `V-30b`, `V-31` ✓ |
| Export (d) : **45 colonnes**, les **23 du CDC dans l'ordre exact**, puis les 10 du cadre 2026, puis les 6 couples entrée/évolution | `V-39`, `V-40` ✓ |
| Variante réservée : **48 colonnes**, judiciaire présent 3 fois (valeur + entrée + évolution) | `V-44` ✓ |
| Quotité contractuelle : le **contrat en cours** (28 h) prime sur la fiche (26 h) ; repli fiche sans contrat | `V-45` ✓ |
| Journal sous `EXPORT_INSERTION_FREINS_ENRICHI`, **distinct** de `…_SENSIBLE` | `V-47` ✓ |
| `409 EXPORT_VIDE` sur un périmètre vide, **sans écrire de journal** | `V-48` ✓ |
| XLSX réellement produit par exceljs (archive ZIP, > 5 Ko) | `V-50` ✓ |
| MANAGER **lit** la synthèse (200) et **n'enregistre pas** (403) — refus **avant toute requête** (`pool.query` jamais appelé) | `V-32` ✓ |
| COMMUNICATION, AUTORITE, QHSE et le **jeton chauffeur** : 403 avant toute requête | `V-33` ✓ |
| MANAGER et QHSE refusés sur l'export nominatif | `V-51` ✓ |
| Validation : année/trimestre/identifiant illisibles → **400**, identifiant inconnu → **404**, jamais 500 | `V-35` ✓ |
| **Aucune fuite de connexion** sur 24 refus (403, 409, 400, 404) puis 16 refus de saisie | `V-34`, `V-61` ✓ |
| DORA : `https` accepté et écrit ; `http`, `javascript:`, `data:` refusés en 400 **sans écriture** | `V-53`, `V-54` ✓ |
| Aide : montant négatif refusé, `null` accepté, `0` accepté | `V-55` ✓ |
| Catégories : `job_dating` et `formation_fle` acceptées, hors liste refusée avant la base | `V-56` ✓ |
| PMSMP : débouché hors liste refusé ; `embauche_accueillant` **déduit** — `true`, puis `false`, puis **`null` sur « inconnu »** | `V-58` ✓ |
| `GET /insertion/:id` rend le débouché et l'orientation DORA ; masquage MANAGER inchangé | `V-59`, `V-60` ✓ |

### 5.5 Dates civiles

| Vérification | UTC | Europe/Paris |
|---|---|---|
| Une fin de parcours au **31/12** est comptée dans son année (5 fins), et l'année suivante en compte 0 | ✓ | ✓ |
| Les bornes des quatre trimestres | ✓ | ✓ |
| Une sortie ASP du 15/03 entre dans le rapprochement annuel | ✓ | ✓ |
| Dates de l'export (d) | ✓ | **✗ D-01** |

Les bornes de période sont composées en **chaînes ISO** par `bornes()` et comparées par PostgreSQL :
c'est ce qui les met hors d'atteinte du fuseau du processus. Le seul chemin qui repasse par
`toISOString()` est celui de D-01.

### 5.6 Non-régression et stabilité

| Campagne | Résultat |
|---|---|
| `tests/e2e-pr-a` + `e2e-pr-b` + `e2e-pr-c` sur la base PR D, `TZ=UTC` | **316 vérifications vertes** (9 suites) |
| Les mêmes, `TZ=Europe/Paris` | **316 vertes** |
| Jest complet (sans base) | **248 suites / 5 042 tests verts**, 13 suites ignorées (les e2e opt-in, dont les 2 nouvelles) |
| **L'échec Jest « observé une fois » du lot (§ 5.5 du rapport 26)** | **non reproduit en 6 passages complets** — cinq en parallèle, un en `--runInBand` : 248/5 042 identiques à chaque fois |

Sur la piste de cet échec : le message « A worker process has failed to exit gracefully »
accompagne **toutes** les passes parallèles et **disparaît en `--runInBand`**. Il appartient donc au
démontage du runner parallèle, pas à une assertion — ce qui corrobore l'hypothèse du lot. Une suite
qui laisse un minuteur ou une connexion ouverte peut, en étant tuée au mauvais moment, faire
remonter un « 1 test en échec » sans nom : c'est la seule forme compatible avec l'observation
« 1 suite / 1 test en échec sans nommer lequel ».

### 5.7 Mesure de coût (limite § 6.2.5 du lot)

`GET /insertion/audit` sur la cohorte de recette (12 dossiers) : **29 ms**, **61 requêtes**
(le coût est majoritairement fixe : 61 requêtes déjà sur une cohorte vide). Les appels ajoutés par
la PR D (`conformiteProjet` par projet, `activiteHebdoCohorte` en une passe) sont parallélisés et
chacun `soft`. Rien d'alarmant à cette taille ; la mesure sur la cohorte réelle de production
(~46 dossiers) reste à faire au déploiement, mais l'ordre de grandeur ne laisse pas présager de
problème.

---

## 6. Limites de cette campagne

1. **Le PDF n'est pas éprouvé.** `pdf-dialogue-gestion.js` compose côté navigateur depuis le
   `contenu` ; cette campagne ne couvre que le `contenu`. Le rendu A4 (neuf blocs dans l'ordre, page
   « Méthode », pied « Signataire : la direction ») relève d'un contrôle visuel.
2. **Le front n'est pas exercé.** `DialogueGestionPanel.jsx`, `AuditInsertion.jsx` et l'affichage
   des agrégats sous seuil n'ont pas été ouverts dans un navigateur.
3. **Cohorte de recette de 12 dossiers.** Le seuil de k-anonymat y coupe beaucoup plus souvent qu'en
   production ; à l'inverse, certaines situations de production (plusieurs parcours successifs pour
   une même personne, `parcours_num > 1`) ne sont pas couvertes.
4. **`heures_accompagnement` et `delai_moyen_diagnostic_jours` n'ont pas de jeu d'essai dédié** : ils
   rendent respectivement 0 h / `null` faute de feuilles de temps et de diagnostic d'accueil daté.
   Leur SQL s'exécute (aucun bloc `indisponible`), mais leurs valeurs ne sont pas éprouvées.
5. **PostGIS absent** de la machine de recette : `init-db.local.js` est une copie où `GEOMETRY` devient
   `TEXT`. Sans effet sur le périmètre PR D (aucune colonne géométrique).
6. **Le trimestriel s'appuie sur la seule cohorte** pour son test de vacuité (le bloc 6 n'y est pas
   composé) : c'est la limite § 6.2.9 du lot, constatée ici et non corrigée.
7. **La double impression des méthodes n'a été jouée que pour 2026** (valeur du réglage). Le passage
   à 2027, où la méthode A doit disparaître du document, est couvert par `V-09` sur 2025 mais pas par
   un changement de réglage.

---

## 7. État de l'arbre git

```
$ git status --short
?? backend/tests/e2e-pr-d/

$ git diff --stat -- backend/src frontend/src
(vide)
```

Les sept mutations de contre-épreuve ont été restaurées une par une, chacune vérifiée par
`git diff --stat` sur le fichier muté avant de passer à la suivante. **Aucun fichier source,
aucune documentation, aucun rapport d'un autre agent n'a été modifié.** Le seul ajout est le
répertoire `backend/tests/e2e-pr-d/` (3 fichiers) et le présent rapport.

`backend/src/scripts/init-db.local.js` a été régénéré (il est ignoré par git, cf. `.gitignore:31`).

---

## 8. Rejouer ces preuves

```bash
# 1. Environnement (base de recette)
source <scratchpad>/db-test.env        # DB_NAME=solidata_test, JWT_SECRET, PCM_ENCRYPTION_KEY…

# 2. Régénérer le script d'initialisation local (PostGIS absent)
sed -e 's/GEOMETRY(Point, 4326)/TEXT/g' -e 's/USING GIST\s*(\(geom[a-z_]*\))/(\1)/Ig' \
    backend/src/scripts/init-db.js > backend/src/scripts/init-db.local.js

# 3. Migration : base existante (3 passes) puis base NEUVE
cd backend
node src/scripts/init-db.local.js      # ×3 — idempotente
su postgres -c "dropdb --if-exists solidata_neuve_d; createdb -O solidata_user solidata_neuve_d"
DB_NAME=solidata_neuve_d node src/scripts/init-db.local.js        # échec attendu (préexistant)
DB_NAME=solidata_neuve_d node src/scripts/migrate-exutoires.js
DB_NAME=solidata_neuve_d node src/scripts/migrate-finance.js
DB_NAME=solidata_neuve_d node src/scripts/init-db.local.js        # ×2

# 4. Les 74 vérifications, dans les deux fuseaux
PR_D_E2E_DB=1 TZ=UTC          npx jest tests/e2e-pr-d --runInBand   # 65 vertes / 9 rouges
PR_D_E2E_DB=1 TZ=Europe/Paris npx jest tests/e2e-pr-d --runInBand   # 64 vertes / 10 rouges

# 5. Non-régression PR A + PR B + PR C
PR_A_E2E_DB=1 TZ=UTC          npx jest tests/e2e-pr-a tests/e2e-pr-b tests/e2e-pr-c --runInBand
PR_A_E2E_DB=1 TZ=Europe/Paris npx jest tests/e2e-pr-a tests/e2e-pr-b tests/e2e-pr-c --runInBand

# 6. Jest complet (les suites e2e restent ignorées)
JWT_SECRET=x PCM_ENCRYPTION_KEY=y npx jest --silent
```

---

## 9. Synthèse pour l'agent de correctifs

| # | Gravité | En une ligne | Fichier |
|---|---|---|---|
| **D-07** | **Majeur (RGPD)** | Sur un axe dont les personnes sont masquées, actions / DORA / partenaire / **montant d'aide santé** sortent en clair — le document désigne le dossier | `services/dialogue-gestion.js:533-540`, `:618-623` |
| **D-04** | **Majeur** | Un mois sans le moindre contrat CDDI vaut **1,00 ETP** dans le bloc des effectifs | `services/dialogue-gestion.js:301` |
| **D-02** | **Majeur** | L'export (d) écrit « stable » quand la synthèse dit « non évalué », et la complétude annonce 100 % | `routes/exports.js:705`, `utils/insertion-freins-export.js:215` |
| **D-03** | **Majeur** | « 0 semaine sous 15 h » pour une personne dont aucune semaine n'est relevée | `routes/exports.js:799`, `services/dialogue-gestion.js:841` |
| **D-01** | **Majeur (latent)** | Les cinq dates de l'export (d) reculent d'un jour hors UTC — famille PR B non refermée ici | `utils/insertion-freins-export.js:139` |
| **D-06** | Mineur | Le CSV annonce « moins de 5 personnes » alors que le seuil est paramétrable, dans le fichier qui écrit la règle | `services/dialogue-gestion.js:1171` |
| **D-05** | Mineur | Un montant d'aide hors capacité `NUMERIC(9,2)` rend 500 au lieu de 400 | `routes/insertion/routes.js:1477` |
| — | Mineur, connexe | Deux avenants laissés ouverts comptent **deux ETP** pour une personne | `services/dialogue-gestion.js:301` |
| — | À arbitrer | `nb_dossiers` et `nb_sorties_suivies` exemptés du seuil sans qu'aucune exigence ne les réclame | `services/dialogue-gestion.js` |

---

*Agent de debug, PR D. Aucun code corrigé — c'est le lot de correctifs (`29-correctifs-PR-D.md`) qui
prend la main, avec les neuf tests rouges comme filet.*

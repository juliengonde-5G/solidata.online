# PR E « Suivi Convergence (programme CVG) » — revue de sécurité et de conformité RGPD

> **Agent de sécurité (lecture seule)** — chantier `cip-refonte-2026-09-12`, branche
> `claude/solidata-cip-redesign-9fskwq-pr-e`, HEAD `d1e5acd`, périmètre `git diff 553ce40..d1e5acd`
> (40 fichiers, +5 517 / −47), lot **2.60.0**.
> **Références opposables** : contrat `30-convergence-cvg-cartographie.md` (§ 2.1 doctrine, § 2.2 schéma,
> § 2.3 backend, § 4 arbitrages), `CLAUDE.md` module 5 (refus 403 avant toute requête, liste blanche
> serveur, journal RGPD bloquant, jamais de valeur inventée, k-anonymat structurel de la synthèse de
> dialogue de gestion), revue PR D `27-` (même grille, mêmes catégories), doctrine art. 10 de
> `services/dialogue-gestion.js:51-53`.
> **Aucun fichier de code modifié, aucune commande git.** Chaque constat bloquant ou majeur est
> REPRODUIT par une suite Jest jetable hors dépôt
> (`/tmp/claude-0/-home-user-solidata-online/fe97af1d-dfe7-5fa2-9aa1-70eb45b590ee/scratchpad/revue-pr-e/revue-pr-e.test.js`,
> 17 tests, lancée par
> `cd backend && npx jest --config '{"rootDir":"<scratchpad>/revue-pr-e","testEnvironment":"node","forceExit":true}'`
> — **17/17 verts**, c'est-à-dire que chaque défaut décrit ci-dessous est bien le comportement actuel).
> Les 5 suites du lot ont été rejouées : **100 tests verts** — les constats sont donc, par construction,
> ce que ces tests ne couvrent pas.
> **Date** : 25 septembre 2026.

---

## 0. Verdict

**CONFORME SOUS RÉSERVE** — **2 constats BLOQUANTS**, **3 MAJEURS**, **11 MINEURS**.

La réserve est simple à énoncer : **aucun document Convergence ne doit sortir de la structure avant que
B-01 et B-02 soient corrigés ou que la décision du DPO soit consignée**. Le reste du lot est d'un bon
niveau et tient les doctrines du module :

- **Périmètre** : le routeur parent (`routes/insertion/index.js:26`) pose `authenticate, requireMfa,
  authorize('ADMIN','RH')`, et `convergence.js:48` le redouble. Reproduit : **COLLABORATEUR, AUTORITE, DPO,
  MANAGER et le jeton chauffeur** (`driver_5`, `vehicle_id`) reçoivent **403 avec zéro requête métier**
  (test « 403 AVANT toute requête »). L'onglet n'est monté que pour `base_role ∈ {ADMIN, RH}`
  (`AuditInsertion.jsx:695, 991, 1006`) et la famille d'obligations `sortie_cvg` est déclarée
  `social: true` (`echeances-cip.js:79`), donc jamais calculée hors ADMIN/RH.
- **Journal bloquant** là où un document sort : aperçu (`convergence.js:92`), génération **dans la
  transaction** du snapshot (`:108-118`, `pool.connect()` dans le `try`, ROLLBACK + `release` en
  `finally`), consultation d'instantané (`:172`), comparaison (`:219`), CSV **avant** l'envoi (`:245`),
  écriture de situation de sortie **dans sa transaction** et **sans les valeurs** (`:405-406`).
- **Refus avant lecture** : période validée par `express-validator` puis `erreurPeriode` (bornée à
  **24 mois**, `convergence-cvg.js:143`) avant toute requête ; `409 EXPORT_VIDE` avant `pool.connect()`.
- **Liste blanche** : colonnes dynamiques des deux UPSERT/UPDATE tirées de `CHAMPS_SITUATION` /
  `CHAMPS_RESSOURCE` (aucune injection de nom de colonne), valeurs toutes paramétrées ; critères
  d'éligibilité lus par liste fermée `CRITERES_LUS` (`convergence-cvg.js:67`) — **« sortant de détention »
  n'est jamais lu** ; `completude` du document ne porte que des comptes, jamais de nom.
- **CSV** : toutes les cellules passent par `escCsv` (neutralisation `= + - @ TAB CR` de
  `utils/export-csv.js:23`). Reproduit : un NOM `=HYPERLINK(…)`, une fonction `+cmd`, un employeur `-2`,
  un générateur `=1+1` sortent préfixés d'une apostrophe.
- **PDF** : chaque interpolation passe par `esc` / `v` (`pdf-convergence-cvg.js`), le titre de fenêtre
  aussi (`pdf-insertion.js:48`). **Aucun `dangerouslySetInnerHTML`** dans les 9 fichiers front du lot ;
  `proposition.source` est rendue en texte React (`SituationSortieCvg.jsx:202, 206`).
- **Instantanés** : `type='cvg'` cloisonné dans les deux sens (`convergence.js:140, 163` /
  `reporting.js:150, 202`), purgés par la 11ᵉ purge qui ne filtre pas le type (`rgpd-purges.js:825`),
  entrée art. 30 posée une fois (`insertion-convergence.js:179-194`), règle exposée dans
  `GET /rgpd/politique` (`rgpd.js:358-364`).
- **Anonymisation** : `insertion_sortie_cvg` supprimée intégralement (`anonymization.js:358-359`),
  `pension_invalidite` / `medecin_traitant` du diagnostic remis à NULL (`:236`).

**Ce qui bloque tient en deux phrases, reproduites toutes les deux.**

1. **Les deux tableaux jumeaux « sortis » sont, par construction, des tableaux de 1 à 4 personnes** —
   le scan lui-même en compte 3 et 4 — **et ils croisent la catégorie de sortie avec la santé, la
   justice, le logement et le parcours de soin**. Quand un tableau vaut 1, il n'est plus un agrégat :
   c'est la **fiche santé-justice d'une personne nommable** (tout le monde sait qui est parti), transmise
   à une association tierce sur une base légale « à confirmer par le DPO ». Quand il vaut 3, toute case
   à 0 ou à 100 % est un attribut des trois.
2. **Le frein judiciaire (art. 10) part vers un tiers privé**, alors que la doctrine du module
   l'exclut de tout document transmis (`dialogue-gestion.js:51-53, 74`) et que l'export (d) l'exclut par
   défaut (`exports.js:661, 708`). Le contrat soumet au DPO la question du k-anonymat — **pas** celle de
   l'art. 10, qui n'apparaît pas au § 4.

---

## 1. Constats BLOQUANTS

### B-01 — Tableaux « sortis » sans seuil : la fiche santé / justice / parcours de soin d'une personne transmise à un tiers

**Fichiers** : `backend/src/services/convergence-cvg.js:478-549` (`composerSousPopulation`),
`:42-44` et `:626` (le seuil est écarté en connaissance de cause), `frontend/src/components/insertion/pdf-convergence-cvg.js:123, 219`.
**Règle opposable** : doctrine du module (k-anonymat structurel, plancher 5, de toute pièce transmise —
`appliquerKAnonymat`) ; RGPD art. 4-1 (identification indirecte), art. 9 (santé), art. 5-1-c
(minimisation) ; contrat § 2.1-5 et § 4-1 (« à confirmer par le DPO »).

#### Ce que le document publie

La Partie 1 publie des **marginales** sur l'effectif accueilli (hommes, RSA, RTH, habitat…). Les Sorties
publient autre chose : **deux sous-tableaux croisés** — une sous-population définie par la catégorie de
sortie (qui est **connue** : un départ en retraite, une entrée en formation, une embauche se savent dans
l'atelier, et le réseau les apprend souvent de la personne elle-même), ventilée par freins à l'entrée
et à la sortie (santé, **justice**), habitat entrée/sortie (**rue**, hébergement collectif),
RQTH / AAH / **pension d'invalidité** / **médecin traitant** entrée/sortie, et « **dont sortie en
parcours de soin** ». Aucune cellule n'est jamais supprimée.

#### Reproduction 1 — cohorte de 5, un sortant

`composerCvg` appelée telle quelle, `db` injecté ; un seul sortant, sortie « autre reconnue positive »
avec parcours de soin, frein justice 4 → 2, santé 5, arrivé à la rue, sorti en hébergement collectif,
RQTH et pension d'invalidité à la sortie :

```
B-01 cohorte 5 → { "total": 1,
  "categories_autre_positive": {"nb":1,"pct":100}, "dont_parcours_de_soin": {"nb":1,"pct":100},
  "justice_entree": {"nb":1,"pct":100},  "justice_resolution": {"nb":1,"pct":100},
  "sante_entree": {"nb":1,"pct":100},    "rue_entree": {"nb":1,"pct":100},
  "hebergement_collectif_sortie": {"nb":1,"pct":100},
  "rqth_entree_sortie": {"entree":{"nb":1,"pct":100},"sortie":{"nb":1,"pct":100}},
  "pension_sortie": {"nb":1,"pct":100}, "femmes_partie1": {"nb":1,"pct":20} }

B-01 CSV →
Sorties hors emploi;Dont sortie en parcours de soin;1;100
Sorties hors emploi;Frein « Justice » — difficulté à l'entrée;1;100
Sorties hors emploi;Frein « Justice » — résolution totale ou partielle;1;100
Sorties hors emploi;Santé à la sortie — Pension d'invalidité;1;100
```

Le document transmis dit, de la seule personne sortie hors emploi du semestre : *elle est partie se
soigner, elle avait une difficulté judiciaire bloquante qui s'est atténuée, elle a connu la rue, elle
touche une pension d'invalidité et a une RQTH*. Qu'aucun nom n'y figure ne change rien : la personne est
désignée par l'événement qui définit le tableau.

#### Reproduction 2 — cohorte de 46 (la forme du scan)

46 accueillis, 7 sortis dont **3 en emploi ou formation** (un CDI, une formation, une suite de
parcours en SIAE) :

```
B-01 cohorte 46 → emploi {"total":3,
  "categories":{"emploi":{"nb":1},"suite_parcours_insertion":{"nb":1},"formation":{"nb":1}},
  "sante_entree":{"nb":3,"pct":100}}
 Partie 1 : {"justice":{"nb":1,"pct":2.2},"rth":{"nb":1,"pct":2.2},"aah":{"nb":1,"pct":2.2},"rue":{"nb":1,"pct":2.2}}
```

- **Tableau jumeau** : chacun des trois sortants est désigné par sa catégorie (1/1/1), et la ligne
  « Santé — difficulté à l'entrée : 3 (100 %) » est donc un attribut de santé **de chacune des trois
  personnes nommables**. C'est l'attaque d'homogénéité : sur un effectif de 3 ou 4, une case à 0 % ou à
  100 % est aussi identifiante qu'une case à 1.
- **Partie 1** : des marginales à 1 sur 46 (« Justice », « RTH », « AAH », « Rue ») ne désignent
  personne **isolément** — il n'y a pas de croisement. Le risque y est faible **tant que la base reste
  grande et qu'aucune ligne n'atteint 0 ou la base**. Il devient réel en dessous de ~20 accueillis
  (sur 5 : « Femmes : 1 », la seule femme du chantier est désignée, et avec elle tout ce que les autres
  lignes à 100 % disent de la cohorte).

#### Qualification du risque

| Cohorte | Partie 1 (marginales) | Tableaux « sortis » (croisés) |
|---|---|---|
| **46 accueillis / 9 sortis (scan)** | Faible : pas de croisement, base large ; résiduel sur une case à 0 ou 100 %. | **Élevé** : jumeaux de 3 et 4 personnes, catégorie de sortie connue, santé / justice / parcours de soin croisés — **homogénéité systématique** sur les lignes à 0 ou 100 %. |
| **5 accueillis / 1 sorti** | **Élevé** : chaque case à 1 ou à 5 désigne. | **Maximal** : le tableau est une fiche individuelle d'art. 9 et d'art. 10. |

Le destinataire aggrave plutôt qu'il ne rassure : Convergence France est un **réseau qui connaît ses
structures et, pour partie, leurs publics** (l'orienteur « Premières Heures en Chantier » est un
dispositif du même écosystème ; un réseau qui organise des passerelles apprend qui est parti en
formation). Et le document **circule** : il sera recopié dans un classeur Excel du réseau (contrat § 3).

#### Ce que le document affirme pendant ce temps

- Note de traçabilité du PDF (`pdf-convergence-cvg.js:123`) : « **Document agrégé — aucun nom de
  personne accompagnée** » ; pied de page (`:219`) « Document agrégé ». Littéralement vrai, trompeur pour
  le destinataire, qui lira « anonyme ».
- La seule mise en garde (`convergence-cvg.js:626`, « Aucun seuil de confidentialité n'est appliqué…
  arbitrage à confirmer par le DPO ») est la **17ᵉ phrase de la page Méthode** — adressée au lecteur
  interne, pas une consigne de diffusion. **L'écran** (`ConvergenceCvgPanel.jsx`) n'en dit rien : aucune
  occurrence de « seuil », « DPO » ou « confidentialité » ; le bouton « Générer et enregistrer » ne
  prévient pas qu'une case vaut une personne.

#### Pourquoi c'est bloquant et pas « à l'arbitrage »

Le contrat a eu raison de poser la question au DPO (§ 4-1). Mais tant que la réponse n'est pas rendue,
l'outil produit **déjà** le document au format brut, et rien n'empêche de l'envoyer. La doctrine des
revues précédentes (PR C : « défauts plus sûrs appliqués, réversibles ») commande l'inverse : **le défaut
doit être le plus protecteur, et c'est la décision du DPO qui l'assouplit**, pas l'inverse. Les tests du
lot n'exercent aucun effectif inférieur à 3 dans un jumeau.

#### Correctif proposé (réversible, respecte le format du réseau)

1. **Réglage `insertion.cvg_k_min`**, défaut **5** en code, plancher **1** (= format brut, choix du
   DPO), lu dans `chargerDonnees`. Il s'applique **par couche**, parce que les deux couches n'ont pas le
   même risque :
   - **Tableaux jumeaux** : quand `total < k`, les lignes **santé** (RQTH, AAH, pension, médecin traitant,
     couverture), **freins santé et justice**, **habitat rue / précaire** et **« dont parcours de soin »**
     sont rendues `null` avec `sous_seuil: true` (compte par tableau, pas de chemin — leçon B-01 de la
     PR D). `total`, les catégories de sortie et les autres freins restent publiés : c'est ce que le réseau
     lit en premier.
   - **Partie 1** : marginales publiées brutes quand `base ≥ 20` ; en dessous, même suppression que la
     synthèse (`appliquerKAnonymat` réutilisée, pas recopiée).
   - Coût à dire au DPO : avec le scan (3 et 4 sortants), **les lignes santé/justice des deux jumeaux
     seraient vides chaque semestre** à k = 5 — c'est précisément le prix de la protection, et c'est au
     DPO de l'arbitrer, pas au code.
2. **Mention de diffusion obligatoire**, en en-tête de CHAQUE page du PDF et en ligne `#` du CSV, dès
   qu'une case publiée vaut moins de 5 : « Contient des effectifs inférieurs à 5 : données à diffusion
   restreinte, réservées au dialogue de gestion avec Convergence France — ne pas publier ni rediffuser. »
   Remplacer « aucun nom de personne accompagnée » par « aucun nom — mais des effectifs très faibles peuvent
   désigner une personne ».
3. **Écran** : un encadré au-dessus de « Générer et enregistrer » qui dit la valeur de `k` appliquée et
   sa provenance (« défaut du code » / « décision DPO du … »).
4. Test structurel : jumeau à `total = 1` → aucune ligne santé/justice/parcours de soin non nulle quand
   `k > 1`.

---

### B-02 — Le frein judiciaire (art. 10) est transmis à un tiers privé, contre la doctrine du module, sans avoir été soumis à l'arbitrage

**Fichiers** : `backend/src/utils/convergence-cvg-referentiels.js:92` (`{ cle: 'justice', frein: 'judiciaire' }`),
`backend/src/services/convergence-cvg.js:63` (`AXES` le reprend), `:423` (Partie 1), `:489-498` (jumeaux),
`:921-923` et `:949-951` (CSV).
**Règle opposable** : RGPD art. 10 ; doctrine du module — synthèse de dialogue de gestion
(`dialogue-gestion.js:51-53` « Porter le frein judiciaire (art. 10) : jamais », `:74` retrait **à la
source**), export (d) (`exports.js:661, 708` : le judiciaire n'y figure qu'avec `sensibles=1`,
ADMIN/RH, **usage interne**), fiche pour le référent (santé et judiciaire « absents sans mention »).

**Reproduction** : `AXES_BLOC3 = FREINS.filter((f) => f.key !== 'judiciaire')` est vérifié présent dans
`dialogue-gestion.js`, **et** `svc.AXES` contient `judiciaire` ; le CSV de la reproduction B-01 porte
« Frein « Justice » — difficulté à l'entrée;1;100 » et « … résolution totale ou partielle;1;100 »
(test « la synthèse de dialogue de gestion, elle, n'a PAS d'axe judiciaire »).

**Pourquoi c'est bloquant.** Une association de réseau n'est ni une autorité publique ni une personne
morale habilitée au sens de l'art. 10 RGPD / art. 46 de la loi Informatique et Libertés. Sur une
marginale de 46, un agrégat « Justice : 1 » n'est pas une donnée personnelle ; dans un jumeau de 1
(B-01), c'est une **donnée d'infraction d'une personne identifiable** transmise à un tiers privé. Le
contrat mentionne le judiciaire « en agrégat » (§ 2.1-5) mais **le § 4 ne pose au DPO que le
k-anonymat** : l'art. 10 n'a été instruit par personne, et le lot contredit en silence une règle que les
PR A à D ont fait respecter à trois documents différents.

**Correctif proposé**
1. Réglage `insertion.cvg_transmettre_justice`, **défaut `false`**. À `false`, la ligne « Justice »
   s'imprime « non transmis (donnée relevant de l'article 10 du RGPD) » **dans les trois couches** (Partie 1,
   jumeaux, CSV) — exactement le traitement du frein `numerique`. La mention est **structurelle** (identique
   quel que soit le contenu), elle ne désigne donc personne : la réserve « mentionner une exclusion, c'est
   encore désigner » vise une mention qui dépend des données, pas celle-ci.
2. Ne lire la colonne `frein_judiciaire` en SQL (`colsEntree`, `colsLm`) **que** si le réglage est vrai
   — retrait à la source, comme `AXES_BLOC3`.
3. Ajouter l'art. 10 au § 4 du contrat et au registre art. 30 (`insertion-convergence.js:187`).

---

## 2. Constats MAJEURS

### M-01 — Une source illisible s'imprime « 0 » dans les tableaux « sortis » (famille M-04 de la PR D)

**Fichier** : `backend/src/services/convergence-cvg.js:276-295` (sources `derniere_evaluation`,
`situations_sortie_cvg` en `soft` → `null`), `:492-496` et `:508` (comptages qui traitent `null` comme
« rien »). **Règle** : « jamais de valeur inventée — une source illisible donne `null`, jamais 0 »
(en-tête du fichier `:17-20`, méthode `:629`).

**Reproduction** (les deux sources rendent 42P01) :

```
M source illisible → {"rqth_sortie":{"nb":0,"pct":0},"medecin_sortie":{"nb":0,"pct":0},
  "post":{"nb":0,"pct":0},"resolution_sante":{"nb":0,"pct":0}, …}
```

Le document dit « 0 % des sortants ont un médecin traitant », « 0 accompagnement post-sortie »,
« 0 frein résolu », alors que **personne n'a pu être lu**. La phrase de méthode « Sources illisibles… les
cellules concernées sont vides, jamais à zéro » (`:629`) est imprimée **à côté** de ces zéros : le
document se contredit. Les tests du lot couvrent la cohorte et les sorties illisibles (`convergence-cvg.test.js:342, 351`),
pas ces deux sources-là.

**Correctif** : porter dans `d` deux drapeaux `situationsLisibles = situations != null` et
`evalLisible = derniereEval != null` ; `cellule(null, base)` pour toutes les lignes « à la sortie »,
`post_sortie` et `parcours_de_soin` quand le premier est faux, pour toutes les `resolution` quand le
second est faux. Le comparateur les rendra alors « non comparables », ce qui est vrai.

### M-02 — La RTH est déduite d'un texte libre de paie : « Non concerné » compte comme une reconnaissance de handicap

**Fichier** : `backend/src/services/convergence-cvg.js:70` et `:163-164`
(`rqth = … || (disab !== '' && !PAS_DE_HANDICAP.test(disab))`, avec
`PAS_DE_HANDICAP = /^(non|aucun|aucune|none|false|0|-|nr|n\/a|sans)$/i`), repris dans la proposition de
`GET /situation-sortie` (`convergence.js:330, 344-346`).
**Règle** : « jamais de valeur inventée » ; art. 5-1-d (exactitude) sur une donnée d'art. 9 transmise.

`employees.disability_status` est la colonne « Statut handicap » de l'import Malibou
(`collaborator-import.js:580`) : un **texte libre de 60 caractères**. La règle retient comme RQTH **tout
texte qui n'est pas exactement** l'un des dix mots de la liste. **Reproduction** : `profilPersonne` rend
`rth: true` pour **« Non concerné », « Non reconnu », « Pas de RQTH », « En cours », « Demande en cours »,
« NON RQTH », « Aucun handicap »** (7 cas, test `test.each`). Le chiffre gonfle la ligne « Demandeurs
d'emploi (RTH) » transmise, alimente la ligne « RQTH à l'entrée » des jumeaux, et la CIP se voit
**proposer** « RQTH à la sortie : Oui — RQTH connue à l'entrée » pour une personne dont la paie dit
« Non concerné ». La méthode (« reconnaissance portée par la fiche », `:612`) ne dit pas que n'importe
quel texte vaut reconnaissance.

**Correctif** : inverser la logique — **liste blanche** des valeurs qui valent RQTH (`/^(oui|rqth|travailleur handicap|th|reconnu)/i`
ou mieux, la liste réelle des libellés Malibou relevée en base), toute autre valeur → **inconnu** (ni
compté ni proposé) ; nommer le repli en méthode ; tester sur les valeurs réelles de production.

### M-03 — Le registre des moyens humains n'a ni durée de conservation ni sortie à l'anonymisation

**Fichiers** : `backend/src/scripts/migrations/insertion-convergence.js:137-154` (table),
`:189` (durées du registre art. 30 : instantanés et situation de sortie — **pas le registre**),
`backend/src/services/anonymization.js` (aucune occurrence de `insertion_cvg_ressources` — test
« anonymisation : le registre des moyens humains n'est jamais touché »), `convergence.js:440`
(`employee_id` accepté par l'API).

La Partie 2 nomme des permanents (NOM Prénom, fonction, quotité, employeur pour les mutualisés). Le
registre qui les porte :
- n'a **aucune rétention** : une ressource passée `actif = false` reste indéfiniment ; l'art. 30 annonce
  une durée pour tout le reste du traitement, pas pour cette table ;
- **échappe à l'anonymisation** : si une ligne porte `employee_id` (l'API l'accepte, `:440`), anonymiser
  ce salarié laisse son **nom en clair relié par clé à la fiche anonymisée** — la liaison défait
  l'anonymisation ; sans `employee_id`, le nom reste de toute façon ;
- un utilisateur supprimé (`user_id ON DELETE SET NULL`, `:140`) laisse son nom dans `nom`.

Les instantanés, eux, conservent légitimement la Partie 2 six ans (pièce justificative, purge 11) —
ce constat ne vise que le **registre vivant**.

**Correctif** : dans `anonymizeEmployee`, `DELETE FROM insertion_cvg_ressources WHERE employee_id = $1`
(ou pseudonymiser `nom`) sous `tableExists` ; une 12ᵉ purge « ressources inactives dont `date_fin` est
dépassée de N ans » (ou l'ajout du registre à la purge 11 sur `COALESCE(date_fin, updated_at)`) ;
compléter `duree_conservation` de l'entrée art. 30.

---

## 3. Constats MINEURS

| # | Constat | Fichier:ligne | Correctif |
|---|---|---|---|
| m-01 | **`GET /situation-sortie` n'est pas journalisé** alors qu'il lit, pour une personne nommée, RQTH / AAH / pension / médecin traitant (et les propose). Cohérent avec le diagnostic (non journalisé non plus) — acceptable **à condition** de le dire ; une clé de service ADMIN en lecture le lit sans trace. | `convergence.js:295-371` ; reproduit : `journaux : []` | `journaliser` **tolérant** (doctrine PR C pour les écrans internes), code `INSERTION_SORTIE_CVG_LECTURE`, libellé ajouté. |
| m-02 | **`GET /completude` rend une liste NOMINATIVE** (« DUPONT Jean — situation de sortie non saisie ») **sans trace**, alors que l'art. 30 annonce « chaque aperçu, génération, consultation… journalisé ». | `convergence.js:227-236`, `convergence-cvg.js:679-699` ; reproduit | Même journal tolérant, `INSERTION_CVG_COMPLETUDE`. |
| m-03 | **L'auteur initial d'une situation de sortie est écrasé**, sans historique : `saisi_par = EXCLUDED.saisi_par`, `saisi_at` jamais mis à jour, aucune table `_history`. Le journal garde l'acteur et les champs de chaque écriture, pas les valeurs antérieures — on ne peut pas dire ce que valait la catégorie transmise au semestre précédent si l'instantané n'a pas été enregistré. | `convergence.js:397` ; reproduit (SQL relevé) | Colonnes `modifie_par` / `updated_at` distinctes de `saisi_par` / `saisi_at` ; snapshot de l'état antérieur (modèle `insertion_notes_suivi_history`). |
| m-04 | **« Dont parcours de soin » peut dépasser sa catégorie** : le composeur compte tout sortant hors emploi dont `parcours_de_soin = true`, **quelle que soit sa catégorie** ; l'écran remet le champ à vide quand la catégorie change, mais un PUT partiel `{categorie:'retraite'}` après `{categorie:'autre_positive', parcours_de_soin:true}` le laisse à vrai. | `convergence-cvg.js:486` ; `convergence.js:382, 397` | Compter `s.categorie === 'autre_positive' && parcours_de_soin === true` ; au PUT, forcer `parcours_de_soin = NULL` quand la catégorie résultante n'est pas `autre_positive`. |
| m-05 | **`PUT /situation-sortie` accepte n'importe quel `parcours_num`** transmis dans le corps et n'importe quel salarié, y compris sans parcours (`insertion_status = 'none'`) ou en parcours : des lignes orphelines entrent dans un tableau transmis. | `convergence.js:290-293, 388-390` | Refuser 409 si `insertion_status = 'none'` ; borner `parcours_num ≤ employees.parcours_num`. |
| m-06 | **Registre des moyens humains** : CRUD sans journal RGPD ni journal d'activité (le sous-routeur est monté **avant** `routes.js`, seul porteur d'`autoLogActivity`, `insertion/index.js:46-50`, `routes.js:81`) ; `user_id` inexistant → 500 (23503) au lieu d'un 400 ; `actif: "1"` accepté par `isBoolean()` puis normalisé à `false` (`:455`) ; front ETP ≤ 1,5, serveur et CHECK ≤ 2. | `convergence.js:432-441, 455, 483-533` ; `ConvergenceCvgPanel.jsx:684` | `journaliser` tolérant (acteur, id, champs modifiés) ; vérifier `user_id` ; `isBoolean({ strict: true })` ; aligner la borne. |
| m-07 | **`409 EXPORT_VIDE` affirme « Aucun salarié accueilli ni sorti »** quand la cohorte et les sorties sont **illisibles** (`Number(null) || 0`). Le refus est sûr, le message est faux. | `convergence-cvg.js:702-706` | `cvgEstVide` rend `null` si `accueillis` et `total` sont `null` ; la route répond 503 « source illisible ». |
| m-08 | **La comparaison ne vérifie pas que les deux documents ont la même méthode** : un seuil de frein passé de 3 à 2, ou `cvg_sans_bilan_est_sans_nouvelles` basculé entre deux instantanés, produit des « hausses » rédigées en toutes lettres qui ne sont que l'effet d'un réglage. Le seuil n'est même pas stocké en clair dans le contenu (seulement dans une phrase de méthode). | `convergence-cvg.js:790-877`, `:667-671` | Stocker `parametres: { seuil, sans_bilan_sans_nouvelles, k_min }` dans `en_tete` ; `comparerCvg` ajoute une phrase et marque « non comparable » les blocs touchés quand ils diffèrent. |
| m-09 | **Coût de la comparaison à la volée** (question 7) : 11 requêtes par composition (mesuré), **22 par appel**, sans cache ; périodes bornées à 24 mois, surface ADMIN/RH + MFA, journalisée. **Acceptable** — un ADMIN malveillant a des moyens plus directs. | `convergence.js:210-217` | Facultatif : cache 60 s par couple de périodes, ou limiteur par utilisateur si l'écran relance à chaque frappe. |
| m-10 | **Libellés d'âge incohérents avec la règle** : « 26 et moins de 50 ans » / « Plus de 50 ans » (CSV, écran, PDF) alors que la règle compte « 50 ans et plus » (méthode `:610`) — une personne de 50 ans exactement est comptée dans une ligne dont le libellé l'exclut. | `convergence-cvg.js:884-885`, `convergence-cvg-structure.js:35-36` | Libellé « 50 ans et plus » ou note de bas de tableau. |
| m-11 | **Obligation `sortie_cvg` levée d'un coup pour tous les parcours terminés depuis 30 j à 7 mois** au premier déploiement, y compris ceux dont le semestre est déjà transmis (sans conséquence de sécurité ; bruit dans le compteur rouge). | `echeances-cip.js:514-525` | Borne de mise en service `insertion.cvg_sortie_depuis` (date du déploiement). |

---

## 4. Tableau récapitulatif

| Id | Gravité | Sujet | Reproduit |
|---|---|---|---|
| B-01 | Bloquant | Jumeaux « sortis » sans seuil : fiche santé / justice / parcours de soin d'une personne | Jest, cohortes 5 et 46 |
| B-02 | Bloquant | Frein judiciaire (art. 10) transmis, doctrine du module contredite, hors arbitrage | Jest + lecture `dialogue-gestion.js:74` |
| M-01 | Majeur | Source illisible → 0 (santé à la sortie, post-sortie, résolution) | Jest |
| M-02 | Majeur | RTH déduite d'un texte libre (« Non concerné » → RTH) | Jest, 7 valeurs |
| M-03 | Majeur | Registre moyens humains : pas de rétention, pas d'anonymisation | Jest (lecture statique) |
| m-01 … m-11 | Mineurs | voir § 3 | m-01, m-02, m-03 reproduits par la suite ; autres par lecture |

---

## 5. Réponses aux dix questions posées

1. **Rôles** — ADMIN/RH strict, refus **avant toute requête** pour COLLABORATEUR, AUTORITE, DPO,
   MANAGER et le jeton chauffeur (reproduit) ; onglet et famille d'obligations fermés hors ADMIN/RH ;
   MFA requise. **Conforme.**
2. **Effectifs de 1 et 2** — risque faible sur les marginales de la Partie 1 à 46, **élevé** sur les
   jumeaux (3-4 personnes, croisés, homogénéité), **maximal** à 5 / 1 sortant. Arbitrage proposé : plancher
   réglable **5 par défaut** appliqué aux lignes sensibles des jumeaux et à la Partie 1 sous 20 accueillis,
   **mention de diffusion obligatoire**, le DPO pouvant descendre à 1 (**B-01**).
3. **Snapshot `type='cvg'`** — purgé à 6 ans par la purge 11, consultation journalisée, contenu sans
   liste nominative d'accompagnés ; Partie 2 nominative sur les permanents : proportionnée au format du
   réseau, **base légale et information des permanents à confirmer** (§ 6), entrée art. 30 présente mais
   muette sur le registre vivant (**M-03**).
4. **`insertion_sortie_cvg`** — booléens art. 9 en clair (comme `insertion_diagnostics.rqth` : cohérent,
   aucun texte libre donc pas de field-crypto nécessaire), ADMIN/RH strict, **purgée à l'anonymisation**
   (vérifié) ; lecture non journalisée — acceptable par cohérence avec le diagnostic, à passer en journal
   tolérant (**m-01**).
5. **`insertion_cvg_ressources`** — CRUD non journalisé (**m-06**) ; champs libres bornés à 150 caractères,
   `trim` ; **injection de formule neutralisée** dans le CSV (reproduit), **aucun XSS** dans le PDF (`esc`
   partout) ni à l'écran (texte React).
6. **CSV et aperçu** — `pool.connect()` dans le `try` et `release` en `finally` (génération et situation
   de sortie) ; aperçu et CSV sans transaction mais journal bloquant **avant** l'envoi ; 400 / 409 avant
   lecture ; `EXPORT_VIDE` correct sauf message faux sur source illisible (**m-07**).
7. **Comparaison à la volée** — 22 requêtes, pas de cache, période ≤ 24 mois : **acceptable** (**m-09**).
8. **Transcodages** — la méthode dit `sans_suite → sans nouvelles`, sortie sans bilan → sans nouvelles
   (et le réglage), `heberge → non renseigné`, `autre → non renseigné`, CMS / CCAS, `fin_contrat → sans
   solution`, `niv6plus`, couverture à l'entrée, `numerique`. **Deux choix restent silencieux** : la RTH
   tirée d'un texte libre (**M-02**) et « dont parcours de soin » compté hors de sa catégorie (**m-04**) ;
   la comparaison ne signale pas un changement de réglage (**m-08**).
9. **`PUT /situation-sortie`** — **n'écrase jamais une saisie par une proposition** : la proposition
   n'est jamais écrite côté serveur, l'écran ne la montre que si rien n'est saisi et « Reprendre » ne
   remplit que les champs vides (`SituationSortieCvg.jsx:141-150, 171`). En revanche l'**auteur initial
   est écrasé** et il n'y a pas d'historique (**m-03**).
10. **Front** — `proposition.source` rendue en texte React, pas en HTML ; valeurs issues de listes
    fermées côté écran **et** revalidées au serveur (`isIn`, `isBoolean({strict:true})`) ; **aucun
    `dangerouslySetInnerHTML`** ; la navigation depuis la complétude n'accepte que des chemins internes.

---

## 6. Points à l'arbitrage direction / DPO

1. **Plancher de k-anonymat du document Convergence** (B-01) : valeur (5 par défaut proposé, 1 = format
   brut du réseau), périmètre (lignes sensibles des jumeaux seulement, ou tout le document), et coût
   assumé (lignes santé/justice des jumeaux vides chaque semestre à k = 5 avec 3-4 sortants). Tant que la
   décision n'est pas consignée, **aucune transmission**.
2. **Frein judiciaire** (B-02) : transmettre ou non une donnée d'art. 10 à une association privée ; si
   oui, sur quelle base (art. 46 LIL) et à quel effectif minimal.
3. **Base légale de la transmission** au réseau (« exécution de la convention / intérêt légitime — à
   confirmer », `insertion-convergence.js:185`) et **existence d'une convention** précisant la
   confidentialité côté Convergence (qui recopie le document dans son propre classeur).
4. **Partie 2 nominative** : information des permanents (art. 13-14) que leur nom, leur fonction et leur
   quotité sont transmis au réseau ; conservation six ans dans les instantanés après leur départ.
5. **Transcodage « sorti sans bilan → sans nouvelles »** actif par défaut (arbitrage 2 du contrat, à
   valider par la CIP) : il abaisse le taux d'accès à l'emploi transmis pour toute personne partie en
   CDI sans que le bilan ait été rédigé.
6. **AIPD** : le traitement « reporting Convergence » croise santé, justice, minima sociaux et logement
   sur de petits effectifs vers un tiers — il remplit au moins deux critères de la liste CNIL.

---

## 7. Correctifs à appliquer, dans l'ordre

1. **B-02** — `backend/src/utils/insertion-settings.js` (après `:158`) : `insertion.cvg_transmettre_justice: false` ;
   `backend/src/services/convergence-cvg.js:63, 229, 274-275` : `AXES` et colonnes lues sans `judiciaire`
   quand le réglage est faux ; `:423, :489-498` ligne rendue « non transmis » ; `:614` phrase de méthode ;
   `frontend/src/components/insertion/convergence-cvg-structure.js` (ligne Justice) et
   `pdf-convergence-cvg.js` ; registre `insertion-convergence.js:187`.
2. **B-01** — `insertion-settings.js` : `insertion.cvg_k_min: 5` ; `convergence-cvg.js:478-549` suppression
   des lignes sensibles des jumeaux sous `k`, `:384-443` suppression Partie 1 sous base 20 via
   `appliquerKAnonymat` (`dialogue-gestion.js`), `sous_seuil` en COMPTE ; `:60` MENTION ;
   `pdf-convergence-cvg.js:123, 219` mention de diffusion restreinte ; `cvgVersCsv` `:967-973` ligne `#` ;
   `ConvergenceCvgPanel.jsx` encadré avant « Générer » ; test structurel.
3. **M-01** — `convergence-cvg.js:367-377` drapeaux de lisibilité, `:500-547` cellules `null`.
4. **M-02** — `convergence-cvg.js:70, 163-164` liste blanche des libellés RQTH ; `convergence.js:344-350`
   proposition alignée ; test sur valeurs réelles.
5. **M-03** — `backend/src/services/anonymization.js` (après `:360`) suppression / pseudonymisation des
   lignes du registre ; purge des ressources inactives (`rgpd-purges.js`) ; `insertion-convergence.js:189`.
6. **m-04 / m-05** — `convergence-cvg.js:486` ; `convergence.js:382-403` (cohérence `parcours_de_soin`,
   borne `parcours_num`, refus sans parcours).
7. **m-01 / m-02 / m-06** — journaux tolérants : `convergence.js:304` (lecture situation), `:231`
   (complétude), `:483-533` (ressources) ; libellés dans `frontend/src/utils/rgpd-libelles.js` et le miroir
   backend (la garde anti-dérive le vérifiera).
8. **m-03** — colonnes `modifie_par` + table d'historique de `insertion_sortie_cvg` (migration idempotente).
9. **m-07 / m-08 / m-10 / m-11** — `convergence-cvg.js:702-706`, `:667`, `:884-885` ;
   `echeances-cip.js:514`.

---

## 8. Méthode et limites

- Lecture intégrale de `convergence.js`, `convergence-cvg.js`, `convergence-cvg-referentiels.js`, de la
  migration, des diffs des 9 fichiers backend modifiés et des 9 fichiers frontend du lot ; confrontation
  à `dialogue-gestion.js`, `exports.js`, `anonymization.js`, `rgpd-purges.js`, `echeances-cip.js`,
  `insertion-journal.js`, `export-csv.js`.
- Reproductions : suite Jest jetable hors dépôt (17 tests verts, `pg` simulé par un `db` injecté pour le
  composeur, vrais handlers Express montés par `src/routes/insertion` pour les routes, jetons signés
  avec MFA). **Pas de PostgreSQL réel** : les constats de comptage portent sur le composeur, qui ne
  dépend pas du moteur SQL pour les règles en cause ; le debug sur base réelle reste à faire par l'agent
  dédié.
- Suites du lot rejouées : `insertion-convergence-contract`, `convergence-cvg`, migration, `echeances-cip`,
  `rgpd-audit-libelles` — **5 suites, 100 tests verts**.
- Non instruit : le rendu visuel du PDF (aucune exécution navigateur), la conformité du format au
  classeur Excel du réseau (non fourni).

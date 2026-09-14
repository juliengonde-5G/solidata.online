# Réalisation — PR D, lot 6 « Reporting autorité »

> Agent `reporting`, 14/09/2026. Branche `claude/solidata-cip-redesign-9fskwq-pr-d`, empilée sur la PR C.
> Contrat de référence : `25-contrats-techniques-PR-D.md` (§ 1.2, 2, 3, 4, 5.1-5.7, 6, 7, 8).
> Cahier des charges fonctionnel : `09-matrice-reporting-autorite.md` § 1.3 (S1-S7), § 1.5 (15 indicateurs), § 2 (d) et (e).
> Décisions : `07-plan-action.md` lot 6, décision 9 du § 8, amendements du § 9.

---

## 0. En une page

Le taux de sorties dynamiques se calculait sur les **bilans rédigés**, pas sur les
**personnes parties**. Une personne qui quitte le chantier sans entretien de sortie —
celle qui ne répond plus au téléphone, celle qui part du jour au lendemain — ne figurait
dans **aucun des deux termes** du rapport : elle disparaissait du calcul, et le taux
montait d'autant. C'est le défaut que ce lot corrige, et tout le reste en découle.

Le dénominateur devient **toutes les fins de parcours de la période**, la ligne
« sortie non documentée » apparaît en clair, les **deux méthodes sont imprimées côte à
côte pour l'exercice 2026**, et la règle vit dans **un seul fichier PUR** que les quatre
surfaces publiant ce taux consomment. Autour, la **synthèse de dialogue de gestion** en
neuf blocs imposés — le document que la gestionnaire de l'autorité recevra quinze jours
avant la séance —, le **tableau des freins enrichi du cadre 2026**, et les trois saisies
qui manquaient pour que les indicateurs S1, S7, P2 et C5 aient une source.

**Chiffres** : Jest **244 suites / 4 932 tests** → **248 suites / 5 042 tests**, tous verts
(+4 suites, +110 tests). Build Vite vert. **6 contre-épreuves par mutation**, toutes
restaurées. 17 fichiers, +3 874 / −148 lignes.

---

## 1. Livré, point par point

### 1.1 Le dénominateur des sorties (item 6.1, décision 9)

**`backend/src/services/sorties-engine.js`** (264 lignes, neuf) — module **PUR**, aucune
E/S, entrées injectées. `calculerSorties({ finsParcours, bilansClasses, sortiesAsp,
annee, cibles, annee_double_methode })` rend :

| Clé | Ce qu'elle porte | Ligne |
|---|---|---|
| `methode_b` | dénominateur = fins de parcours · `documentees` · `non_documentees` · `par_classification` (5 lignes dont `non_documentee`) · `par_type` · `taux_pct` · `ecart_cible` | `sorties-engine.js:126-165` |
| `methode_a` | méthode historique — **`null` hors de l'année de double méthode** | `sorties-engine.js:190-193` |
| `methode_a_interne` | la même, toujours calculée pour les écrans internes | `sorties-engine.js:180-189` |
| `rapprochement_asp` | sorties déclarées à l'ASP, écart, note | `sorties-engine.js:200-212` |
| `regles` | les phrases imprimées telles quelles au bloc 9 | `sorties-engine.js:214-230` |

Deux points qui ne se voient pas dans la signature et qui comptent :

- **`bilans_sans_fin_parcours`** (`sorties-engine.js:170-171`). Un bilan classé dont la
  personne n'a pas de date de fin de parcours dans la période compte dans la méthode A
  et pas dans la B. Ce nombre **explique à lui seul l'écart entre les deux
  dénominateurs** ; le taire aurait laissé croire à une erreur de comptage, et la règle
  correspondante est ajoutée à `regles`.
- **Une classification hors nomenclature** (donnée héritée) est comptée comme documentée,
  rangée en « autre », mais **`hors_nomenclature` la NOMME** (`sorties-engine.js:143-151`) :
  ranger une valeur inconnue dans une catégorie de sortie sans le dire, c'est produire un
  chiffre qu'on ne peut plus retrouver.

**Consommé par les quatre surfaces, jamais recopié** (doctrine § 2.6) :
`gatherAuditKpis` (`routes.js:4008`, via `composerBlocsInternes`), `/insertion-synthese`
(`exports.js:968`), `/reporting/dialogue-gestion` (`dialogue-gestion.js:682`),
`performance.js` (`performance.js:47`).

### 1.2 La synthèse de dialogue de gestion (export (e))

**`backend/src/services/dialogue-gestion.js`** (1 227 lignes, neuf) —
`composerDialogueGestion({ annee, trimestre, db, user })` (`:972`) rend exactement la
forme figée au § 5.1 : `{ en_tete, blocs, sous_seuil }`.

| Bloc | Fonction | Sources |
|---|---|---|
| 1. Effectifs et ETP | `bloc1Effectifs` `:273` | `etp_asp_mensuel` (premier) · quotités `employee_contracts` (second) · `effectifs.convention_<annee>` |
| 2. Publics à l'entrée | `bloc2Publics` `:356` | cohorte `employees` · `employee_eligibilite` (hors `sensible_art10`) · `etp_asp_mensuel.nb_brsa` |
| 3. Freins | `bloc3Freins` `:454` | diagnostic → dernière évaluation · `cip_action_plans` (actions, DORA, partenaire principal) |
| 4. Accompagnement | `bloc4Accompagnement` `:553` | `insertion_milestones` · `temps-accompagnement` · aides mobilisées |
| 5. Immersions | `bloc5Immersions` `:639` | `insertion_pmsmp` (+ `debouche`, `embauche_accueillant`) |
| 6. Sorties | `bloc6Sorties` `:682` | `sorties-engine` + `etp_asp_salaries` (rapprochement) |
| 7. Résultats | `bloc7Resultats` `:721` | `insertion_fse_sorties.situation_6mois` · satisfaction |
| 8. Conformité | `bloc8Conformite` `:759` | `fse-participants.conformiteProjet` · `insertion_alimentations_referent` · `insertion_actualisations_ft` · `activiteHebdoCohorte` · conciliations |
| 9. Méthode | `bloc9Methode` `:873` | composé **à partir des blocs réellement produits** |

**Le bloc 9 est composé, pas écrit d'avance** : une règle n'y figure jamais pour un
indicateur absent du document. C'est ce bloc que l'instructrice lit en premier quand un
chiffre la surprend, et un taux sans sa règle n'est pas contrôlable.

### 1.3 La route (§ 5.1, § 5.7)

**`backend/src/routes/insertion/reporting.js`** (298 lignes, neuf) — quatre gestes
volontairement distincts :

| Route | Rôles | Journal | Ligne |
|---|---|---|---|
| `GET /dialogue-gestion` (json) | ADMIN/RH/MANAGER | `…_APERCU`, **tolérant** | `:88` |
| `GET /dialogue-gestion?format=csv` | ADMIN/RH/MANAGER | `EXPORT_DIALOGUE_GESTION`, **bloquant** | `:105-119` |
| `GET /dialogue-gestion/historique` | ADMIN/RH/MANAGER | — | `:134` |
| `GET /dialogue-gestion/:id` | ADMIN/RH/MANAGER | `…_CONSULTATION`, tolérant | `:170` |
| `POST /dialogue-gestion` | **ADMIN/RH** | `…_GENERATION`, **bloquant, DANS la transaction** | `:200` |

Trois décisions de structure :

- **`historique` est déclaré AVANT `/:id`** (`:134` puis `:170`) — Express résout dans
  l'ordre ; inversés, l'historique serait capté comme un identifiant.
- **`pool.connect()` est DANS le `try`** (`:216`) : posé au-dessus, un pool indisponible
  laisse la requête sans réponse et fuit une connexion — le défaut D-04 de la PR A,
  retrouvé à l'identique en PR B.
- **Le MANAGER lit mais n'enregistre pas.** Il lit parce qu'**aucune projection
  nominative n'existe dans ce document** : il n'y a pas de champ à masquer selon le rôle,
  la composition elle-même est une liste blanche d'agrégats. Il n'enregistre pas parce
  que la génération produit **une pièce datée qui engage la structure vis-à-vis de son
  financeur**.

### 1.4 Le schéma (§ 3)

**`backend/src/scripts/migrations/insertion-reporting.js`** (211 lignes, neuf) :
`insertion_pmsmp.debouche` / `debouche_date` / `embauche_accueillant` ·
`cip_action_plans.dora_*` (3) et `aide_*` (3) · CHECK `category` reconstruit avec
`formation_fle` · seed CMS · table `insertion_dialogues_gestion` + index + CHECK de
trimestre.

Deux choix :

- **`embauche_accueillant` est un booléen NULLABLE, pas un `DEFAULT false`**. Trois états :
  oui, non, **on ne sait pas encore**. Une immersion close la semaine dernière n'a pas
  encore de réponse, et un défaut `false` la ferait entrer dans le comptage des
  non-embauches.
- **`aide_montant` est NULLABLE avec un CHECK `>= 0`**, sans défaut. Une aide non chiffrée
  ne vaut pas zéro euro : un total qui additionnerait des zéros inventés dirait au
  Département **moins** que ce qu'il finance réellement.

### 1.5 Le tableau des freins enrichi (export (d), § 5.4)

`utils/insertion-freins-export.js` + `routes/exports.js` : **23 → 45 colonnes**
(48 en variante sensible).

- Les **23 colonnes du CDC restent en tête, dans leur ordre exact** — exigence écrite de
  l'autorité. Les 10 colonnes du cadre 2026 et les 6 couples « entrée / évolution »
  viennent **après**, jamais intercalées : un fichier dont les colonnes se déplacent
  d'une année sur l'autre casse les tableaux croisés de l'instructrice.
- **Colonne 5 renommée** « Heures par semaine **(quotité contractuelle)** » et
  « Semaines sous 15 h (année) » ajoutée en regard — c'est la correction de fond que
  l'autorité a demandée : la quotité contractuelle n'est pas l'activité constatée.
- **Le judiciaire suit exactement le sort de sa valeur courante** : ses colonnes d'entrée
  et d'évolution n'existent que dans la variante réservée, et ne sont pas lues en SQL par
  défaut (`axes` de `fetchFreinsRows`).
- **« non évalué » ne compte pas comme renseigné dans la complétude.** Sans cela, la
  colonne d'évolution aurait affiché 100 % « renseigné » alors que rien n'est mesurable —
  l'écran aurait dit « rien à compléter » là où il faut précisément compléter les
  diagnostics.
- **Refus 409 `EXPORT_VIDE`** sur zéro ligne (`exports.js:841`), en-tête de traçabilité
  complet avec le **périmètre en toutes lettres** (`PERIMETRES_FREINS`, `exports.js:667` —
  l'autorité exige « les filtres appliqués en toutes lettres », pas `statut=all`), et
  **échappement partagé** `escCsv` à la place de la fonction locale qui ne faisait que du
  guillemetage, sur un fichier qui part à la DDETS (même famille que le constat M-04 de
  la PR A).
- Journal sous un **code distinct** `EXPORT_INSERTION_FREINS_ENRICHI` : la variante
  emporte des colonnes que l'export historique ne portait pas (BRSA, catégorie France
  Travail, référent unique, projet cofinancé) ; les confondre ne permettrait plus de
  savoir **ce qui est sorti**.

### 1.6 `/insertion-synthese` délégué (§ 5.1)

`exports.js:968` — le **CSV** est désormais la synthèse de dialogue de gestion, servie
sous son nom, avec les trois règles communes. Le **JSON reste inchangé** (mention + blocs
de `gatherAuditKpis`) : c'est le FICHIER qui change, pas l'API — `rse.js` et les écrans
existants continuent de lire la même forme.

### 1.7 Reporting RH (§ 5.5)

`performance.js:47` (require du moteur), `:328-353` (calcul), `:394-412` (réponse).
`insertion` gagne `en_parcours`, `fins_parcours_annee`, `sorties: { documentees,
non_documentees, dynamiques, taux_dynamiques_pct }`, `methode` — **clés historiques
conservées** (le Dashboard les lit encore). `ReportingRH.jsx` et
`PerformanceDashboard.jsx` affichent « Sorties dynamiques (méthode B) » et « Sorties non
documentées ».

Ce qui disparaît : `parcours_termines / total`, présenté comme un « taux de sorties
positives ». Il n'en était pas un — il rapportait les parcours terminés **depuis
toujours** à l'ensemble des parcours connus, sans classification de sortie ni borne de
temps.

### 1.8 Les trois saisies (§ 5.6)

- **`PmsmpPanel.jsx`** — sélecteur « Débouché » en liste fermée + date, **affiché
  uniquement quand l'immersion est TERMINÉE** (`estTerminee`) : demander sa suite à une
  immersion qui commence n'aurait aucun sens, et une case remplie au hasard vaut moins
  qu'une case vide. `embauche_accueillant` est **déduit côté serveur**
  (`embaucheAccueillantDepuisDebouche`, `routes.js`) — deux champs qui disent la même
  chose finissent par se contredire. `window.confirm` remplacé par `ConfirmDialog`.
- **`ActionsPanel.jsx`** — bloc repliable « Orientation DORA / aide mobilisée », **ouvert
  d'office quand l'action en porte déjà une** (on ne doit pas passer à côté d'une
  orientation saisie). Validation serveur : `dora_url` **https uniquement**
  (`VALIDATEURS_DORA_AIDE`, `routes.js`) — le champ est rendu en lien cliquable, un
  `javascript:` y serait une porte d'entrée.
- **Catégories** `formation_fle` (CHECK + validateur + `freins.js` + `mon-parcours.js`)
  et `cms` / `social` sur `PARTENAIRE_CATEGORIES`.

### 1.9 Front (§ 6)

`AuditInsertion.jsx` : deux onglets — **« Pilotage & indicateurs »** (chiffres complets,
lus par les personnes qui tiennent les dossiers) et **« Dialogue de gestion »** (le
document qui sort de la structure). Quatre blocs réécrits : `BlocSorties`,
`BlocFreinsEvolution`, `BlocImmersions`, `BlocConformite`.

`DialogueGestionPanel.jsx` (377 lignes) : aperçu / générer et enregistrer / CSV /
historique rejouable, **et la liste des agrégats retirés affichée en clair**.

`pdf-dialogue-gestion.js` (336 lignes) : A4, neuf blocs dans l'ordre imposé, page
« Méthode » obligatoire, pied « Signataire : la direction », **rendu exclusivement depuis
`contenu`** — c'est toute la raison du snapshot.

`alert()` / `window.confirm` restants dans le périmètre : **zéro**.

---

## 2. Les deux décisions de méthode qui portent tout le lot

### 2.1 Une seule implémentation pour l'écran et pour le document

`gatherAuditKpis` ne recopie **aucune** des requêtes de la synthèse. Il appelle
`composerBlocsInternes` (`dialogue-gestion.js:1192`), qui exécute **les mêmes fonctions**
avec deux différences, et deux seulement : **aucune suppression k-anonymat** (l'écran est
lu par celles qui tiennent les dossiers, pour qui « 2 freins levés » est une information
de travail) et **pas d'en-tête de traçabilité** (rien ne sort).

Recopier ces requêtes aurait produit deux chiffres pour le même indicateur — celui de
l'écran de pilotage et celui du document signé transmis au financeur.

### 2.2 Le k-anonymat, et pourquoi zéro reste zéro

`faireKAnon(seuil, sousSeuil)` (`dialogue-gestion.js:187`) rend `null` pour tout agrégat
comptant **entre 1 et k−1 personnes** et enregistre son chemin dans `sous_seuil`.

**Zéro reste zéro, délibérément.** « Personne dans cette catégorie » ne désigne personne,
et supprimer les zéros rendrait le document illisible : sur une structure de quarante-six
accompagnements, la moitié des lignes sont à zéro et l'autorité les lit — une catégorie
France Travail F à zéro est une information de gestion. Supprimer 0 protégerait une
personne qui n'existe pas, au prix de la seule chose que le document doit faire.

Les **effectifs bruts globaux d'un bloc** échappent au seuil : effectif de la cohorte,
conventions d'immersion, dénominateur des sorties, sorties non documentées. Ce sont les
têtes de chapitre — elles ne ventilent personne, et sans elles aucun bloc ne se lit.
L'indicateur n° 15 de l'autorité (« sorties non documentées — valeur absolue ») en fait
explicitement partie.

---

## 3. Écarts au contrat, et pourquoi

| # | Contrat § 3 | Ce qui est livré | Raison |
|---|---|---|---|
| **E-1** | CHECK `category` : « + `job_dating`, `formation_fle` » | Seul `formation_fle` est ajouté | `job_dating` et `formation` sont **déjà** dans le CHECK depuis la PR A (`insertion-cadre.js` § 7). Les six valeurs sont reprises telles quelles dans la reconstruction ; les perdre invaliderait toutes les lignes saisies. |
| **E-2** | « seed « CMS (Département 76) » ON CONFLICT (nom) DO NOTHING » | **Aucun nouveau partenaire créé.** Le seed de la PR A (« Centre médico-social (CMS) — Département 76 ») est conservé, sa catégorie normalisée vers `cms` **uniquement si elle porte encore la valeur du seed** (`social`) | Créer une seconde ligne aurait mis **deux CMS** au référentiel de la conseillère et éclaté les statistiques par partenaire entre les deux — exactement ce que l'amendement A5 cherche à éviter. Un partenaire recatégorisé à la main n'est jamais réécrit. |
| **E-3** | « CHECK `insertion_partenaires.categorie` reconstruit : + `cms` » | **Aucun CHECK créé en base.** `cms` et `social` ajoutés à la liste applicative `PARTENAIRE_CATEGORIES` (`routes.js`) | Il n'existe aujourd'hui **aucun** CHECK sur cette colonne (`VARCHAR(30)` nue). En créer un rejetterait les lignes déjà enregistrées avec une catégorie libre. `social` est ajouté au passage : l'écran `/admin/insertion` le proposait **déjà** et le serveur le refusait en 400 — divergence préexistante, corrigée à coût nul puisque je touchais cette constante. |
| **E-4** | § 5.1 : `"version": "2.55.0"` | `process.env.APP_VERSION \|\| package.json.version` | Même source que `exports-fse.js` : une version écrite en dur dérive au premier oubli. **Limite réelle, voir § 6.** |
| **E-5** | § 5.7 : 409 si `finsParcours.length === 0 && bilansClasses.length === 0` | `estVide` exige **aussi** une cohorte vide (`reporting.js:265`) | Une période avec une cohorte mais sans sortie est un document **parfaitement significatif** (une année sans départ existe). Refuser aurait privé la structure de sa synthèse pour une raison qui n'en est pas une. |
| **E-6** | § 5.1 bloc 3 : « judiciaire ABSENT » | Le judiciaire est absent ; **le frein santé y figure en agrégat** | Le contrat § 5.1 ne nomme que le judiciaire, et l'instruction du lot est explicite. La matrice § 2 énonce par ailleurs une exclusion générale du frein santé « dans tout export qui sort de la structure ». **À arbitrer — voir § 6.** |
| **E-7** | § 5.3 : bloc `pmsmp` enrichi | `pmsmp` enrichi **et** un bloc `immersions` complet | Les trois clés historiques de `pmsmp` sont conservées à l'identique (un test de contrat les exigeait en égalité stricte, assoupli en `objectContaining`) ; le bloc `immersions` porte la forme complète du § 5.1, que le front consomme. |

---

## 4. Défauts trouvés en chemin

| # | Où | Ce qui n'allait pas |
|---|---|---|
| **D-1** | `dialogue-gestion.js:296` (avant correctif) | L'« effectif pondéré » filtrait sur `contract_type IN ('CDDI','CDI INCLUSION','CDI_INCLUSION')`. **Les deux dernières valeurs n'existent dans aucune ligne** : l'import de paie range un CDI Inclusion en « CDI », c'est l'intitulé du POSTE qui le distingue (`keepContractForInsertion`, `effectifs.js:190`). Le filtre comptait donc exactement les mêmes contrats qu'un filtre sur 'CDDI' seul, **en donnant l'illusion d'un périmètre complet**. Ramené à 'CDDI', et le périmètre est DIT dans la note du bloc et au bloc 9. |
| **D-2** | `routes.js` `PARTENAIRE_CATEGORIES` | `social` était offert par `AdminInsertion.jsx` et **refusé en 400** par le serveur — et c'est précisément la catégorie que le seed CMS de la PR A porte. Divergence préexistante, corrigée. |
| **D-3** | `exports.js` CSV du tableau des freins | La fonction `esc` locale ne faisait que du guillemetage : une commune de résidence valant `=HYPERLINK(…)` composait une exfiltration en un clic **sur le poste de l'instructrice**. Remplacée par `escCsv`. |
| **D-4** | Aiguillage du faux `pg` (mes propres tests) | La requête des freins et celle de la cohorte partent **toutes deux** de `employees LEFT JOIN insertion_diagnostics`. Reconnue dans le mauvais ordre, la première recevait les lignes de la seconde et le bloc 3 se composait sur les mauvaises colonnes — **sans jamais le dire**. Trouvé parce qu'un compteur rendait 0 au lieu de `null` ; l'ordre est désormais commenté dans le fichier. |
| **D-5** | `ACTION_CATEGORY_LABELS` (`freins.js`) | Il ne portait que 4 catégories sur 6 : une action de job dating ou de formation s'affichait sous son **code brut** dans le journal des actions. Corrigé au passage (les 7 y sont). |

---

## 5. Preuves

### 5.1 Jest

| | Suites | Tests |
|---|---|---|
| Avant (`892679c`) | 244 | 4 932 |
| Après | **248** | **5 042** |

Tous verts. Aucune suite ignorée en plus (11 skipped, inchangé — ce sont les e2e
PostgreSQL opt-in).

Les quatre suites neuves : `sorties-engine.test.js` (21), `dialogue-gestion.test.js` (34),
`insertion-reporting.test.js` (16), `insertion-reporting-contract.test.js` (29).

Trois suites existantes mises à jour, **parce que le contrat qu'elles tenaient a changé** :
`insertion-freins-export.test.js` (23/24 colonnes → 45/48, + règle d'évolution),
`insertion-contract.test.js` (mêmes colonnes, code de journal, CSV de synthèse délégué),
`insertion-audit-non-nominatif-contract.test.js` (le CSV refuse désormais une période vide).

### 5.2 Ce que les tests tiennent

- **Non nominativité prouvée sur la SÉRIALISATION**, pas sur une projection : les neuf
  clés interdites (`nom`, `prenom`, `employee_id`, `first_name`, `last_name`,
  `birth_date`, `email`, `phone`, `matricule`) sont cherchées dans le JSON complet, et
  les services simulés (`temps-accompagnement`, `fse-participants`) rendent délibérément
  leur forme nominative entière. Une projection explicite oublie à la colonne suivante ;
  un test qui lit la réponse, non.
- **k-anonymat** : 4 personnes → `null` + chemin dans `sous_seuil` ; 5 → la valeur ;
  0 → zéro, et pas de chemin.
- **Judiciaire** : absent du bloc 3, **et sa colonne n'est pas lue en SQL** (le test
  inspecte la requête émise).
- **409 `EXPORT_VIDE`** : aucune écriture, ni snapshot ni journal.
- **Journal bloquant** : journal en échec → 500, `ROLLBACK` émis, **aucun `COMMIT`**.
- **Snapshot** : un document rejoué rend `effectif: 44` alors que la base simulée n'a
  qu'une personne.
- **Migration** : rejouée deux fois → SQL identique au caractère près ; aucune
  instruction de contrôle de transaction ; aucun `ADD CONSTRAINT` nu.
- **Rôles** : QHSE et COLLABORATEUR refusés **avant toute requête** (`pool.query` jamais
  appelé) ; MANAGER lit, n'enregistre pas.

### 5.3 Contre-épreuves par mutation (6, toutes restaurées)

| # | Mutation | Tests tombés |
|---|---|---|
| 1 | k-anonymat retiré (`faireKAnon` rend toujours la valeur) | **11** |
| 2 | Judiciaire réintroduit dans `AXES_BLOC3` | **2** |
| 3 | Ligne « non documentée » retirée du dénominateur B | **8** |
| 4 | `journaliserDocument` rendu tolérant (try/catch avalant) | **2** |
| 5 | Refus 409 retiré du tableau des freins | **1** |
| 6 | `evolutionFrein` rendant « stable » au lieu de « non évalué » | **3** |

Arbre git vérifié propre après restauration (`git diff --stat` ne laissait que le
correctif de typographie « 1 820 », légitime).

### 5.4 Build et chargement

- `cd frontend && npm run build` → **vert** (`✓ built in 9.5-10.1 s`), chunk
  `AuditInsertion` 83,98 kB.
- `require` de chaque module avec `JWT_SECRET=x PCM_ENCRYPTION_KEY=y` : **10 sur 10 OK**
  (`sorties-engine`, `dialogue-gestion`, `routes/insertion/reporting`,
  `migrations/insertion-reporting`, `routes/insertion/routes`, `routes/exports`,
  `routes/performance`, `utils/insertion-freins-export`, `services/mon-parcours`,
  `routes/insertion`).

### 5.5 Un échec observé une fois, non reproduit

Un passage complet a rendu **1 suite / 1 test en échec sans nommer lequel** (la sortie
n'a pas capté le détail). **Quinze exécutions complètes ultérieures sont vertes**, sans
qu'aucune ne fasse apparaître de `FAIL`. Le message « A worker process has failed to exit
gracefully » accompagne **aussi la ligne de base** : la piste la plus probable est un
worker tué à la fermeture, pas une assertion. **Je le signale plutôt que de le taire** —
à surveiller lors du passage de debug sur PostgreSQL réel.

---

## 6. Limites et points à arbitrer

### 6.1 À trancher par la direction ou le DPO

1. **Le frein santé dans le bloc 3 (écart E-6).** Le contrat § 5.1 n'exclut que le
   judiciaire ; la matrice § 2 énonce, dans ses règles communes à tous les exports, une
   exclusion du « frein santé et son détail » de « tout export qui sort de la structure ».
   Ce bloc ne porte qu'un **agrégat** (combien de personnes concernées, combien de freins
   levés) et non une donnée de santé individuelle — mais l'arbitrage revient à la
   direction et au DPO. **Le retirer coûte une ligne** (`AXES_BLOC3` filtre déjà un axe).
2. **Le seuil k = 5.** Il vient des enquêtes. Sur une cohorte de quarante-six personnes,
   il masque beaucoup : un axe de frein à 3 « levés » ne sortira pas. C'est l'effet
   recherché, mais l'autorité doit savoir que **la somme des lignes ne fera pas le total**
   (le bloc 9 le dit).
3. **La version de l'outil imprimée (écart E-4).** `APP_VERSION` n'est **renseignée nulle
   part** en production : l'en-tête du document transmis à l'autorité imprimera **1.0.0**
   (la version de `package.json`, non maintenue). Le défaut est **préexistant** et
   partagé avec l'export FSE+ participants. **Correctif hors de mon périmètre**
   (`docker-compose.prod.yml`) : poser `APP_VERSION=2.55.0`.
4. **« Fiches remises au référent »** compte les fiches dont la **remise** est tracée
   (`remis_referent_le`), pas celles générées. C'est la preuve que l'autorité accepte
   (§ 3.2 de la matrice), mais une fiche générée et non tracée n'apparaîtra pas : **à dire
   aux CIP**.

### 6.2 Limites techniques

5. **Coût de `gatherAuditKpis`.** Le § 5.3 impose le bloc `conformite`, qui appelle
   `conformiteProjet` par projet et `activiteHebdoCohorte` sur toute la cohorte. Ces
   appels s'exécutent désormais à **chaque** ouverture de `/insertion/audit`, de
   `/exports/insertion-synthese` (JSON) et du bilan RSE. Ils sont parallélisés
   (`Promise.all`) et chacun est `soft`, mais le temps de réponse de l'écran d'audit
   augmente. **À mesurer sur base réelle.**
6. **L'export du tableau des freins appelle `activiteHebdoCohorte`** pour la colonne
   « Semaines sous 15 h ». Une passe, 8 requêtes quelle que soit la taille de la cohorte —
   mais l'export devient sensible à la disponibilité de ce service (échec → colonne vide,
   jamais 0).
7. **Aucune vérification sur PostgreSQL réel** dans ce lot : `pg` est simulé partout. Le
   SQL neuf (deux `LEFT JOIN LATERAL` avec `ARRAY_AGG` dans `fetchFreinsRows`,
   `generate_series` + `make_date` dans `bloc1Effectifs`, `ROW_NUMBER() OVER (PARTITION
   BY)` dans `bloc3Freins`) **n'a jamais été exécuté**. C'est l'objet de la phase de debug
   § 9 du contrat, et c'est là que ces requêtes doivent être vérifiées en priorité.
8. **`AdminInsertion.jsx` n'offre pas `cms`** dans son sélecteur de catégorie de
   partenaire (le fichier n'est pas dans mon périmètre § 1.2). La catégorie est acceptée
   par le serveur et portée par le seed ; **la rendre sélectionnable à l'écran est une
   ligne**, à poser par le lot de correctifs.
9. **Le trimestriel ne compose que les blocs 2 et 8**, conformément au contrat. Le bloc 6
   n'y figure donc pas, et `estVide` s'y appuie alors sur la seule cohorte.

---

## 7. Au déploiement

`deploy.sh update` — la migration `insertion-reporting.js` est idempotente et vit dans la
transaction d'`init-db`. **Aucun paramétrage requis** : les trois réglages du § 4 ont
leurs défauts en code (`sorties_methode_double_annee` 2026, `k_anonymat_min` 5,
`heures_annuelles_etp` 1820).

**À annoncer au dialogue de gestion** : le taux de sorties dynamiques change de
dénominateur. La méthode historique est imprimée à côté pendant tout l'exercice 2026 ;
en 2027 elle disparaît du document.

**À faire côté direction** : poser `APP_VERSION` dans le compose (§ 6.1 point 3) ;
trancher les points 1 et 4.

---

*Agent `reporting`, lot 6 de la PR D. Quatre commits sur
`claude/solidata-cip-redesign-9fskwq-pr-d`, non poussés.*

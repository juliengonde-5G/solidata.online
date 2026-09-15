# PR B « Cadre RSA et temps d'accompagnement » — correctifs

> **Agent de correctifs**, 13 septembre 2026. Branche `claude/solidata-cip-redesign-9fskwq-pr-b`.
> Entrées opposables : revue de sécurité `17-revue-securite-PR-B.md` (3 bloquants, 5 majeurs,
> 11 mineurs), debug PostgreSQL `18-debug-postgres-PR-B.md` (D-01 à D-07, 7 tests e2e rouges),
> contrats `15-contrats-techniques-PR-B.md` (§ 0.6 règles de fond, § 6 listes blanches),
> doctrine des correctifs PR A `14-correctifs-securite-PR-A.md`.
> **Aucune commande git, aucun `npm install`.**

---

## 0. En une phrase

**Les 19 constats des deux rapports sont traités** — 3 bloquants, 5 majeurs, 11 mineurs —, plus
**5 défauts de la même famille trouvés hors périmètre** en exerçant la contrainte de fuseau, dont un
qui décalait d'un jour **la date de naissance** exportée à l'autorité de gestion. La suite Jest
complète est verte (**234 suites / 4 677 tests**), les **180 vérifications e2e sur PostgreSQL réel**
passent **sous `TZ=UTC` ET sous `TZ=Europe/Paris`**, et **10 contre-épreuves par mutation** — toutes
restaurées — établissent que chaque correctif porte réellement son test.

Deux points laissés « à arbitrer » par la revue ont reçu le **choix le plus sûr** ; la direction peut
revenir sur l'un comme sur l'autre (§ 5).

---

## 1. Ce qui a été corrigé — constat par constat

### 1.1 Bloquants

| # | Constat | Correctif | Fichier:ligne | Test qui le verrouille |
|---|---|---|---|---|
| **B-01** | Le relevé d'assiduité transmis au référent imprimait `insertion_milestones.titre`, VARCHAR(120) **librement saisi** : « Bilan après l'hospitalisation » sortait tel quel vers le CMS. | En variante **tiers**, `type_libelle` est le libellé du **type** (table fermée de 8 valeurs) ; la variante **dossier** garde le titre que la CIP a écrit, qui lui est utile. | `services/fiche-referent.js` (composition du relevé, bloc `entretiens.map`) | `tests/unit/services/fiche-referent.test.js` › « B-01 — le TITRE libre… » (3 tests : tiers, dossier, type inconnu) |
| **B-02** | `heuresAccompagnement` verse `par_salarie` (liste **nominative** de toutes les personnes accompagnées + heures) dans `gatherAuditKpis`, servi au **MANAGER** par `/insertion/audit` et **spreadé** par `/exports/insertion-synthese` sous la bannière « Document agrégé **non nominatif** ». | **Projection à la source**, dans `gatherAuditKpis` : ne survivent que `annee`, `global_minutes`, `par_projet`, `nb_salaries_concernes`, `moyenne_minutes_par_salarie` (indicateur n° 14 de l'autorité). `par_salarie` / `par_intervenant` restent sur `/temps/synthese`, gardée ADMIN/RH. Une projection **par route** se réintroduit à la troisième route. | `routes/insertion/routes.js` (bloc PR B de `gatherAuditKpis`) | **`tests/contract/insertion-audit-non-nominatif-contract.test.js`** (NOUVEAU, 5 tests) : la projection, `/insertion/audit` au MANAGER **et** à l'ADMIN, `/insertion-synthese` JSON **et** CSV |
| **B-03** | Le détail d'anomalie de la feuille de temps nommait la catégorie d'absence (« **arrêt de travail** ») dans le CSV et le PDF transmis à la DDETS, tous deux en-tête au **nom de l'intervenant**. | Le détail dit le FAIT : « Temps déclaré un jour d'absence déclarée de l'intervenant. » La table `LIBELLES_ABSENCE` est **supprimée** (voir § 3). | `services/temps-engine.js` › `verifierCoherence` | `tests/unit/services/temps-engine.test.js` (2 tests, dont « les trois catégories produisent le MÊME détail ») + `tests/e2e-pr-b/pr-b-temps-e2e.test.js` |

### 1.2 Majeurs

| # | Constat | Correctif | Fichier | Test |
|---|---|---|---|---|
| **M-01** | `action_label` (TEXT libre) imprimé sur le relevé tiers ; « Accompagnement au rendez-vous CMP » passait dès que `frein_type` n'était pas renseigné. | **Arbitrage appliqué : le plus sûr.** En variante tiers, `nature` (`category`, liste fermée de 4 valeurs) + `partenaire` ; `libelle` n'apparaît qu'en variante dossier. La requête joint désormais `insertion_partenaires` ; `notes` n'est toujours jamais sélectionné. | `services/fiche-referent.js`, `components/insertion/pdf-referent.js` | `fiche-referent.test.js` › « M-01 » (3 tests) |
| **M-02** | `journaliser()` de `rsa.js` avalait toute erreur : une fiche partait vers le référent **sans sa trace**, en 201, en silence. | Deux fonctions distinctes. `journaliser` reste **tolérante** pour la consultation du compteur d'activité (écran interne). `journaliserDocument` est **bloquante** pour les **cinq gestes qui font sortir un document** : relevé d'assiduité, aperçu de fiche, génération, réimpression, traçage de remise. Et la **génération écrit le snapshot et sa trace dans la MÊME transaction** : plus de preuve sans trace, ni de trace sans preuve. | `routes/insertion/rsa.js` | e2e `pr-b-rsa-e2e` › « DÉFAUT D-06 » (renforcé : 500 **et** zéro snapshot orphelin) |
| **M-03** | « Imprimer sans enregistrer » et le raccourci d'en-tête produisaient un PDF **indiscernable** d'une fiche tracée — même bloc de signature, même pied de remise — pendant que la table des transmissions restait vide et que l'indicateur « points d'étape tenus / dus » comptait zéro. | **Arbitrage appliqué : le plus sûr.** Le bouton « Imprimer sans enregistrer » est **retiré** ; l'aperçu reste un aperçu **à l'écran**, avec la phrase qui dit pourquoi. Le raccourci d'en-tête **POSTe** (moment `demande`) et imprime la fiche enregistrée ; son libellé le dit (« Fiche pour le référent (enregistrée) »). | `components/insertion/FicheReferentPanel.jsx`, `pages/InsertionParcours.jsx`, `pdf-referent.js` (en-tête de fonction) | build Vite ; la traçabilité elle-même est couverte par `pr-b-rsa-e2e` (§ « fiche pour le référent ») |
| **M-04** | `pool.connect()` **hors du `try`** sur `valider` et `rouvrir` : un pool saturé laissait la requête **sans réponse** (Express 4 ne capture pas le rejet d'un handler `async`). Régression d'un défaut corrigé en PR A. | `let client; try { client = await pool.connect(); … } catch { if (client) ROLLBACK } finally { if (client) release() }`. | `routes/insertion/temps.js` (2 routes) | **`insertion-temps-contract.test.js` › « M-04 »** (3 tests NOUVEAUX — aucun test n'exerçait ce chemin, § 4) |
| **M-05** | Le CSV était journalisé, le **PDF** ne l'était pas — même contenu, même destinataire, même mention « pièce de justification d'une dépense cofinancée ». | Route **dédiée** `GET /:userId/:annee/:mois/export.pdf` : même feuille, journal `EXPORT_FEUILLE_TEMPS` `{format:'pdf'}` écrit **avant** la réponse et bloquant, même refus 409 `EXPORT_VIDE`. Une route plutôt qu'un appel de traçage : elle ne peut pas être contournée. | `routes/insertion/temps.js`, `components/insertion/FeuilleTemps.jsx` | build Vite ; route couverte par la garde `source-syntaxe` et exercée au build |

### 1.3 Mineurs — les 11

| # | Correctif | Fichier |
|---|---|---|
| **m-01** | `raisons` porte son `iso_year` ; la fiche apparie sur le **couple** (année, semaine). Une période à cheval recopiait la raison de la S3 2025 sur la S3 2026. | `services/activite-hebdo-engine.js`, `services/fiche-referent.js` — test dédié dans `activite-hebdo-engine.test.js` |
| **m-02** | « Motif non renseigné » n'apparaît plus que lorsqu'une **absence est constatée** (`absent`/`excuse`). Une présence non saisie affichait un manquement que personne n'avait constaté. | `pdf-referent.js` |
| **m-03** | Les raisons s'impriment en français (« quotité contractuelle inférieure », « arrêt déclaré », « congés », « **non déterminée** ») au lieu de codes bruts. | `pdf-referent.js` |
| **m-04** | `DELETE /saisies/:id` : pour qui n'est ni ADMIN ni RH, la saisie d'un autre et une saisie inexistante rendent le **même 404** (anti-énumération, doctrine du parcours chauffeur 2.40.0). | `routes/insertion/temps.js` — tests mis à jour côté contrat **et** e2e |
| **m-05** | `soft()` collecte les sources tombées ; `mentions.sources_indisponibles` les **nomme**, et le PDF imprime un bandeau. Une rubrique vide se lisait « rien n'a été fait ». | `services/fiche-referent.js`, `pdf-referent.js` — 3 tests |
| **m-06** | Couvert par **D-07** (même boucle). | — |
| **m-07** | Jour civil **de Paris** partout dans `rsa.js` : `aujourdhui()`, le mois courant du tableau de bord, le trimestre DTR, et « demain » du refus de remise future (qui, passé 23 h à Paris, valait le jour **même**). | `routes/insertion/rsa.js`, `routes/insertion/temps.js` (`cloture_depassee`) |
| **m-08** | `GET /rgpd/politique` énonce les **trois flux sortants** de la PR B (fiche pour le référent, relevé d'assiduité, feuille de temps) et la règle « document tiers = journal bloquant ». | `routes/rgpd.js` |
| **m-09** | Entrée **art. 30** de la feuille de temps : finalité (service fait), base légale (règlement UE 2021/1060), destinataires nommés, **5 ans de piste d'audit**, et ce qui n'y figure pas (aucun nom de bénéficiaire, aucune catégorie d'absence). Pattern `WHERE NOT EXISTS`. | `scripts/migrations/insertion-temps.js` — 2 tests dans `insertion-temps-migration.test.js` |
| **m-10** | La variante CSV de `/insertion-synthese` utilise `escCsv` partagé : **neutralisation de formule** rétablie sur un export destiné à la DDETS. | `routes/exports.js` |
| **m-11** | **Documenté** (pas de code) : le nom du signataire figé dans la pièce est **nécessaire** à sa valeur probante — une feuille sans signataire ne justifie rien. Écrit dans l'entrée art. 30 de la feuille de temps plutôt que subi. | `scripts/migrations/insertion-temps.js` |

### 1.4 Défauts du debug PostgreSQL

| # | Correctif | Fichier |
|---|---|---|
| **D-01** (bloquant) | Le numéro de mois vient de **PostgreSQL** (`EXTRACT(MONTH …)::int`) et les dates de `to_char`, avec repli sur le helper partagé. `Number(String(Date).slice(5,7))` valait **NaN** : le registre d'actualisation FT rendait douze mois vides quoi qu'on enregistre. | `routes/insertion/rsa.js` |
| **D-02** | Toutes les dates rendues passent par `isoDate` : fin des « Sun Mar 02 » que le navigateur re-datait **de 2001** sans une erreur. | `routes/insertion/rsa.js` (5 points) |
| **D-03** | La sentinelle `'1900-01-01'` **disparaît** : `GREATEST(MAX(a), MAX(b))` de PostgreSQL ignore les NULL et n'en rend un que si les deux le sont. « jamais de contact tracé » était une branche morte, et le tableau de bord affichait « dernier contact il y a **null** j ». | `routes/insertion/rsa.js` |
| **D-04** | `heuresAccompagnement` alimente l'ensemble des intervenants **depuis les feuilles FIGÉES** aussi. Une feuille signée sortait de l'agrégat si son dernier fait vivant disparaissait — ce que la réouverture ADMIN autorise. | `services/temps-accompagnement.js` |
| **D-05** | **Un seul correctif de fond** : le helper partagé `utils/date-iso.js` (§ 2). `jourISO` de `temps-engine` y délègue ; la déduction de mois du `DELETE /saisies/:id` aussi. | `utils/date-iso.js` (NOUVEAU), `services/temps-engine.js`, `routes/insertion/temps.js` |
| **D-06** | Voir **M-02** (même correctif). | `routes/insertion/rsa.js` |
| **D-07** | `activiteHebdoCohorte` : les réglages lus **une fois**, les cinq sources chargées d'un coup (`= ANY($1::int[])`), le moteur pur appelé ensuite. **Mesuré** : voir § 6. | `services/activite-hebdo.js`, `routes/insertion/rsa.js` |

---

## 2. Le correctif de fond : `utils/date-iso.js`

`node-pg` rend une colonne `DATE` sous forme d'objet **`Date`**, construit à **minuit LOCAL**. Deux
raccourcis se partageaient les dégâts de la PR B :

```
String(new Date(2026, 2, 1))            →  « Wed Mar 01 2026 00:00:00 … »
                        .slice(5, 7)    →  « ar »  →  Number('ar') = NaN      (D-01)
                        .slice(0, 10)   →  « Wed Mar 01 »                     (D-02, D-03)
new Date(2025, 6, 1).toISOString()      →  2025-07-01 sous UTC
                                        →  2025-06-30 sous Europe/Paris       (D-05)
```

Le module expose `isoDate`, `moisDe`, `anneeDe`, `aujourdhuiParis`, `jourParis`, `decalerJours`,
`ajouterMois`, `ecartJours`. **Il lit les composantes LOCALES, jamais l'UTC** : elles lisent l'objet
dans le repère où le pilote l'a construit, ce qui rend la conversion juste **quel que soit le fuseau
du processus**. Mesuré avant d'écrire une ligne :

| Fuseau | colonne DATE `2025-07-01` · `toISOString()` | · composantes locales |
|---|---|---|
| UTC | 2025-07-01 ✓ | 2025-07-01 ✓ |
| Europe/Paris | **2025-06-30** ✗ | 2025-07-01 ✓ |
| Pacific/Honolulu | 2025-07-01 ✓ | 2025-07-01 ✓ |

15 tests unitaires (`tests/unit/utils/date-iso.test.js`), dont la lecture d'une colonne DATE sous
quatre fuseaux, le changement d'heure de mars 2026, et la démonstration du NaN d'origine.

**Un mot sur ce qui n'a PAS été fait** : les dates ne sont pas toutes passées à `to_char` côté SQL.
Là où la conversion était sur le chemin d'un défaut (registre FT, dernier contact), elle est faite
**par PostgreSQL** ; ailleurs, le helper suffit et évite de réécrire une dizaine de requêtes pour un
gain nul.

---

## 3. Ce que j'ai décidé, et pourquoi

**B-03 — pas de champ `categorie_interne`.** La revue proposait de conserver la catégorie d'absence
dans un champ voisin que le CSV et le PDF n'impriment pas. Je ne l'ai pas fait : ce champ serait
**FIGÉ dans `coherence`** au moment de la signature, donc conservé pour la durée de vie de la pièce
(≥ 5 ans), sans qu'aucun écran ne le demande. Et la table `LIBELLES_ABSENCE` est **supprimée** plutôt
que laissée en place : garder à portée de main la fonction qui traduit `sick` en « arrêt de travail »,
c'est garder le geste qu'on vient d'interdire.

**M-02 — le périmètre du journal bloquant.** La revue nommait quatre gestes, le debug deux. J'ai
retenu **cinq** : les quatre de la revue **plus le relevé d'assiduité**, qui est un document tiers au
même titre que la fiche et qui n'est appelé que pour être imprimé. Reste **tolérante** la seule
consultation du **compteur d'activité** (`INSERTION_ACTIVITE_CONSULTATION`) : c'est un badge d'écran
interne, et empêcher la CIP d'ouvrir une fiche parce que le journal est indisponible coûterait plus
que la trace perdue. `INSERTION_ACTUALISATION_FT_MAJ` reste tolérante également : c'est une écriture
au registre interne, pas une transmission.

**m-04 — 404 et non 403.** Il faut lire la ligne pour connaître son propriétaire ; la garde ne peut
donc pas être posée avant la requête. Mais le couple 404/403 laissait un MANAGER **énumérer** les
identifiants de saisie de ses collègues, sans qu'aucune donnée ne soit rendue — c'est bien
l'existence, et elle seule, qui fuyait. Un ADMIN, lui, continue de distinguer les deux cas.

---

## 4. Hors périmètre déclaré — ce que la contrainte de fuseau a fait sortir

La consigne exigeait les e2e **PR A comprises** vertes sous `TZ=Europe/Paris`. Cinq défauts s'y sont
révélés, **tous de la famille D-05**, aucun signalé par les deux rapports :

| Où | Ce qui se passait | Gravité |
|---|---|---|
| `routes/exports-fse.js` › `jour()` | **L'export FSE+ 29 colonnes décalait d'un jour CHAQUE date transmise à l'autorité de gestion — date de naissance comprise** (« 1988-04-11 » pour un 12 avril). | La plus lourde des cinq |
| `services/fse-participants.js` › `jour()` | Même conversion, sur le dossier de conformité et le relevé à +6 mois. | Majeure |
| `routes/exports.js` › `fmtCell` | Même conversion sur l'export Insertion 23 colonnes. | Majeure |
| `services/scheduler.js` › `createPostSortieFollowups` | Le jalon de suivi post-sortie était daté **un jour trop tôt** hors UTC. | Moyenne |
| `tests/e2e-pr-a/_helpers.js` + 2 suites | Le **harnais** PR A lisait les colonnes DATE en UTC : trois assertions tombaient sur une faute du harnais, pas du code. | Harnais |

**Trois défauts de harnais corrigés** (§ 6 du rapport 18 en signalait déjà deux du même genre) :

1. **`tests/e2e-pr-b/_helpers.js › iso()`** lisait l'objet en **`getUTC*`** — la fonction écrite pour
   éviter ce piège tombait dans l'autre moitié. Sous `TZ=Europe/Paris` elle rendait la veille, et
   **sept assertions** mesuraient une faute du harnais. Elle délègue désormais au helper de
   production, ce qui a le mérite supplémentaire de l'éprouver.
2. **`jourDecale()`** (PR A et PR B) mélangeait un `setDate` **local** et un `toISOString()` **UTC**.
3. **Le test D-06** ne pouvait pas poser sa contrainte de sonde : `ADD CONSTRAINT` était refusé par
   les lignes que les tests de la section 5 venaient d'écrire — c'est l'`ALTER` qui tombait, pas le
   comportement mesuré. Corrigé par `NOT VALID` (la contrainte s'applique aux écritures à venir sans
   vérifier l'existant), puis **renforcé** : le test exige désormais un 500 **et** zéro snapshot
   orphelin.

**Un trou de couverture démasqué par une contre-épreuve** : **aucun test n'exerçait `pool.connect()`
en échec**. La mutation CE-10 (remettre le `connect()` hors du `try`) laissait la suite verte —
c'est-à-dire que le correctif M-04 n'était **pas** verrouillé. Trois tests ont été ajoutés
(`insertion-temps-contract` › « M-04 ») ; la même mutation fait désormais tomber 2 tests.

---

## 5. Ce qui reste à l'arbitrage

1. **Base légale de la transmission au référent** (déjà en réserve dans le registre art. 30 :
   « mission d'intérêt public — **à confirmer par le DPO** »). Mission d'intérêt public ou accord de
   la personne : la conduite à tenir en cas de refus en dépend entièrement. **C'est la décision la
   plus urgente de cette PR** — le code produit aujourd'hui un document dont le fondement n'est pas
   arrêté.
2. **M-01 — libellé libre des actions sur le relevé tiers.** J'ai appliqué le choix le plus sûr
   (catégorie fermée + partenaire, libellé réservé à la variante dossier). Le contrat § 6.3
   prescrivait `{date, libelle, statut}` : **la direction peut revenir dessus**, au prix d'une
   consigne écrite aux CIP sur ce qu'on peut intituler une action — une consigne ne ferme pas un
   canal, elle demande de ne pas l'emprunter.
3. **M-03 — « Imprimer sans enregistrer ».** J'ai appliqué le choix le plus sûr : toute impression de
   fiche passe par la génération enregistrée, l'aperçu reste un aperçu à l'écran. **La direction peut
   revenir dessus** ; si elle veut qu'une fiche puisse sortir sans trace, le document devra le dire
   et **perdre son bloc de signature** — un aperçu ne doit pas pouvoir être signé. C'est le statu quo
   d'origine (un PDF probant sans trace) qui restait à écarter.
4. **Catégorie d'absence de paie sur le relevé tiers** (« Arrêt de travail » / « Congés » dans le
   bloc « Absences enregistrées par la paie »). Le contrat la prescrit et l'autorité l'accepte
   (§ 2 (f) item 4) ; la revue ne l'a donc pas classée en constat, et je ne l'ai pas retirée. Elle
   reste une donnée de santé transmise à un tiers pouvant suspendre des droits. **À confirmer par le
   DPO**, avec un repli simple : n'imprimer que « absence justifiée par la paie » et la période.
5. **Information préalable de la personne** avant la première transmission (par symétrie avec
   l'arbitrage PCM de la 2.45.0) — hors logiciel.
6. **Cadrage de l'alerte 15 h** : qui regarde ce compteur, et que fait la structure quand il s'allume.
   Le code ne décide rien ; la consigne écrite doit dire la même chose.

---

## 6. Preuves

### 6.1 Les quatre commandes exigées

```
cd backend && npx jest
  → Test Suites: 8 skipped, 234 passed, 234 of 242 total
    Tests: 224 skipped, 4677 passed, 4901 total          ✓ 0 échec
    (gardes incluses : rgpd-audit-libelles + source-syntaxe = 268 tests verts)

source …/db-test.env && cd backend
TZ=UTC          PR_A_E2E_DB=1 npx jest tests/e2e-pr-b tests/e2e-pr-a
  → Test Suites: 6 passed · Tests: 180 passed, 180 total  ✓
TZ=Europe/Paris PR_A_E2E_DB=1 npx jest tests/e2e-pr-b tests/e2e-pr-a
  → Test Suites: 6 passed · Tests: 180 passed, 180 total  ✓

cd frontend && npx vite build                             ✓ built in 10.88s
```

Les **7 tests e2e rouges** du rapport 18 sont verts, et aucun des 173 autres n'a été perdu.

### 6.2 Migrations rejouées sur PostgreSQL 16.13 réel

`init-db.local.js` régénéré depuis `init-db.js` puis joué **deux fois** : `exit 0` aux deux passes,
et l'entrée art. 30 de la feuille de temps est présente **exactement une fois** après les deux.

### 6.3 D-07 — mesure avant / après

| Cohorte « en parcours » | Avant (rapport 18) | Après | Durée mesurée |
|---|---|---|---|
| 10 dossiers | **85 requêtes** | **13** | 55 ms |
| 40 dossiers | **325 requêtes** | **13** | 21 ms |

Le coût devient **constant** : 8 requêtes par dossier + 5 fixes → 13, quelle que soit la taille de la
cohorte (mesuré en instrumentant `pool.query` sur le vrai handler Express, base réelle).

### 6.4 Contre-épreuves par mutation — 10, toutes restaurées

| # | Mutation temporaire | Effet |
|---|---|---|
| CE-1 | `fiche-referent.js` : le titre libre revient en variante tiers (B-01) | **2 rouges** |
| CE-2 | `fiche-referent.js` : le libellé d'action revient en variante tiers (M-01) | **1 rouge** |
| CE-3 | `routes.js` : le spread nominatif complet revient (B-02) | **4 rouges** |
| CE-4 | `temps-engine.js` : la catégorie d'absence revient dans le détail (B-03) | **2 rouges** |
| CE-5 | `rsa.js` : le rangement JS d'origine seul | **0 rouge** → *le correctif SQL suffisait : la redondance est réelle* |
| CE-5 ter | `rsa.js` : **les deux moitiés** du correctif D-01 retirées ensemble | **1 rouge** |
| CE-6 | `rsa.js` : la journalisation de la génération redevient tolérante (M-02/D-06) | **1 rouge** |
| CE-7 | `temps-accompagnement.js` : les feuilles signées cessent d'alimenter l'ensemble des intervenants (D-04) | **1 rouge** |
| CE-8 | `date-iso.js` : `isoDate` relit les colonnes DATE en UTC (D-05) | **18 rouges sous Europe/Paris** |
| CE-9 | `rsa.js` : la sentinelle `'1900-01-01'` rétablie (D-03) | **1 rouge** |
| CE-10 | `temps.js` : `pool.connect()` ressort du `try` (M-04) | **0 rouge d'abord** → trou de couverture, 3 tests ajoutés → **2 rouges** |

Deux de ces mutations n'ont **rien fait tomber au premier essai** et ce sont les plus instructives :
CE-5 a montré que le correctif D-01 est doublement redondant (SQL **et** JS), CE-10 a montré que M-04
n'était **pas verrouillé** — c'est elle qui a fait écrire les trois tests qui manquaient.

---

## 7. Fichiers touchés

**Backend — production (15)** : `src/utils/date-iso.js` *(nouveau)* ·
`src/services/{temps-engine, activite-hebdo, activite-hebdo-engine, fiche-referent,
temps-accompagnement, fse-participants, scheduler}.js` ·
`src/routes/insertion/{rsa, temps, routes}.js` · `src/routes/{exports, exports-fse, rgpd}.js` ·
`src/scripts/migrations/insertion-temps.js`

**Backend — tests (11)** : `tests/contract/insertion-audit-non-nominatif-contract.test.js` *(nouveau)* ·
`tests/unit/utils/date-iso.test.js` *(nouveau)* ·
`tests/contract/{insertion-rsa, insertion-temps}-contract.test.js` ·
`tests/unit/services/{temps-engine, fiche-referent, activite-hebdo-engine}.test.js` ·
`tests/unit/scripts/insertion-temps-migration.test.js` ·
`tests/e2e-pr-b/{_helpers, pr-b-rsa-e2e, pr-b-temps-e2e}.js` ·
`tests/e2e-pr-a/{_helpers, pr-a-fse-e2e, pr-a-cadre-e2e}.js`

**Frontend (4)** : `src/components/insertion/{pdf-referent.js, FicheReferentPanel.jsx,
FeuilleTemps.jsx}` · `src/pages/InsertionParcours.jsx`

**Rapport** : ce fichier.

---

## 8. Au déploiement

`deploy.sh update` — les migrations sont idempotentes et l'entrée art. 30 de la feuille de temps est
posée sous `WHERE NOT EXISTS`. **Aucun paramétrage requis.**

**À annoncer aux CIP** : le bouton « Fiche pour le référent » de l'en-tête **enregistre** désormais la
fiche avant de l'imprimer (elle apparaît aussitôt dans l'historique des transmissions du Dossier
administratif), et l'aperçu « Ce qui serait transmis » ne s'imprime plus. **À annoncer aux
intervenants** : le bouton « Imprimer » d'une feuille de temps trace désormais l'édition, comme le
faisait déjà l'export CSV.

---

*Agent de correctifs — PR B. 19 constats traités, 5 défauts hors périmètre corrigés, 3 défauts de
harnais réparés, 1 trou de couverture comblé.*

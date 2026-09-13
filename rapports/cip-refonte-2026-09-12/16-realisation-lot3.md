# PR B — Lot 3 « Cadre RSA (structure d'accueil) » — rapport de réalisation

> Agent `rsa`, 13/09/2026. Branche `claude/solidata-cip-redesign-9fskwq-pr-b`.
> Contrats de référence : `15-contrats-techniques-PR-B.md` (§ 1 colonne « 3 — Cadre RSA »,
> § 3 lot 3, § 4, § 5.1, § 5.3, § 6.1 à 6.3, § 7, § 8, § 9, § 10).

---

## 0. En une phrase

Solidarité Textiles est **structure d'accueil** et non référent unique : elle n'écrit pas le
contrat d'engagements réciproques, elle **alimente** le professionnel extérieur qui le tient.
Ce lot donne à cette alimentation quatre objets qui n'existaient nulle part — un compteur
d'activité hebdomadaire, un relevé d'assiduité, une fiche pour le référent composée en liste
blanche et tracée, et un registre d'actualisation France Travail — plus les deux types
d'entretien qui manquaient au cadre 2026.

---

## 1. Ce qui est fait

### 1.1 Migration — `backend/src/scripts/migrations/insertion-rsa.js`

| Objet | Ce qui est posé |
|---|---|
| (a) Types d'entretien | CHECK `milestone_type` **reconstruit par DO-scan** sous marqueur `conciliation` (8 types : les 6 historiques + `point_etape_referent` + `conciliation`) ; colonnes `referent_modalite`, `conciliation_motifs` JSONB, `conciliation_issue`, chacune avec son CHECK par DO-scan tolérant NULL |
| (b) Actions CIP | `cip_action_plans.date_realisation DATE` + reprise **une fois par ligne** (`WHERE date_realisation IS NULL AND status = 'realise'`) |
| (c) Fiches transmises | `insertion_alimentations_referent` (snapshot `contenu` **NOT NULL**, destinataire recopié à la génération, double trace de remise référent / personne) + index |
| (d) Actualisation FT | `insertion_actualisations_ft` (`UNIQUE(employee_id, mois)`, `honoree` **NULLABLE SANS DÉFAUT**) + index sur `mois` |
| (e) Registre art. 30 | Entrée « Transmission d'informations au référent unique (RSA) — fiche pour le référent », gardée par `WHERE NOT EXISTS`, textes en **paramètres** |

**Trois décisions à souligner.**

- `honoree BOOLEAN` **sans défaut** : trois états, et c'est tout le point de la table. NULL =
  personne n'a rien constaté ; `false` = constaté non fait. Un défaut `false` transformerait
  chaque mois non vérifié en manquement de la personne — et c'est ce constat qui peut fonder
  une suspension de droits.
- `conciliation_motifs` est un JSONB **sans CHECK en base** : la liste fermée est tenue par le
  routeur (`CONCILIATION_MOTIFS`). Un CHECK portant sur le contenu d'un tableau JSON serait
  illisible et indébogable en production ; la garde applicative rend un 400 en français, et le
  front ne propose que les sept codes.
- La reprise de `date_realisation` depuis `updated_at` est une **approximation assumée**,
  documentée dans le fichier : pour les actions déjà « réalisé », `updated_at` est la date de la
  dernière écriture sur la ligne, pas celle de l'action. Elle vaut mieux que rien (sans elle,
  ces actions seraient définitivement absentes des compteurs), mais elle n'est pas un constat.

### 1.2 Moteur pur — `backend/src/services/activite-hebdo-engine.js`

`calculerSemaines({ annee, weekHours, milestones, actions, pmsmp, leaves, seuilMin, seuilMax, consecutives })`.
Aucune base, aucune E/S. Semaines ISO à **pivot jeudi**, via `isoWeeksOfYear` de
`services/effectifs-engine.js` — source unique du dépôt ; une seconde définition de la semaine
ISO finirait par diverger et deux écrans donneraient deux comptes différents.

Les trois règles de fond, tenues et testées :

1. **Une semaine sans relevé n'est pas une semaine à zéro heure.** `sans_releve: true`,
   `heures_travail: null`, `total_heures: null`, `sous_seuil: **null**` (et non `false` : on ne
   prétend pas davantage que la semaine était au-dessus). C'est le piège `Number(null) === 0`,
   déjà payé trois fois dans ce dépôt ; ici il ferait apparaître, chaque début de mois, des
   « semaines basses » qui ne sont que des mois de paie non encore importés — et ce faux constat
   partirait vers un référent.
2. **L'alerte ne sonne jamais pendant un arrêt déclaré**, et une semaine sans relevé
   **interrompt** la série au lieu de la prolonger.
3. **L'indicateur est un nombre de semaines, pas une moyenne** — et il compte les semaines
   d'arrêt, contrairement à l'alerte : l'autorité demande un volume constaté (amendement A4),
   pas un jugement.

Raisons catégorisées, dans l'ordre de priorité : `arret` > `temps_partiel` (la quotité
contractuelle elle-même est sous le plancher) > `absence` (congés payés) > `inconnue`, **dit tel
quel** — jamais un motif inventé.

`consecutives` aberrant (0, `'deux'`, NaN) retombe sur le **défaut documenté (2)**, jamais sur
« alerte dès la première semaine », qui serait l'inverse de la prudence voulue.

### 1.3 Accès base — `activite-hebdo.js` et `fiche-referent.js`

- `activite-hebdo.js` : cinq sources lues par `soft()` (dégradation **nommée au journal
  serveur** — une dégradation silencieuse ferait passer un compteur faux pour un compteur bas),
  réglages bornés à leurs plages, puis passe la main au moteur.
- `fiche-referent.js` : `composerFicheReferent` (les **9 rubriques** du § 6.1, pas une de plus)
  et `composerReleveAssiduite` (variantes `tiers` / `dossier`).

**La liste blanche est structurelle, pas cosmétique.** Les freins `sante` (art. 9) et
`judiciaire` (art. 10) n'ont **aucune clé** dans l'objet : ni valeur nulle, ni mention
« rubrique retirée » — signaler l'exclusion désignerait la personne comme ayant quelque chose à
cacher. Les colonnes ne sont même pas **lues** en SQL. Les actions rattachées à l'un de ces deux
freins sont écartées **ligne entière**, en SQL (`NOT (frein_type = ANY($4))`) et non après coup :
masquer le seul libellé laisserait la date, le partenaire et le résultat.

Le motif d'absence transmis est une **catégorie grossière** ; `employee_leaves.leave_type` — le
libellé brut de la paie, qui peut porter « arrêt maladie — affection longue durée » — n'est même
pas dans la projection SQL. `absence_piece_ref` n'est lu que pour la variante `dossier`.

Une période à cheval sur deux années civiles (« du 01/11/2025 au 28/02/2026 », cas courant à
l'entrée en parcours) appelle le moteur **une fois par année traversée** : sans cela les
semaines de l'année la plus ancienne manqueraient silencieusement du document.

### 1.4 Routeur — `backend/src/routes/insertion/rsa.js` (§ 5.1, 10 routes)

`router.use(authorize('ADMIN','RH'))` posé **en première ligne**, avant tout validateur : un
MANAGER est refusé en 403 sans qu'une seule requête ne parte (vérifié par test sur les six
routes de lecture et sur l'écriture).

Les dix routes du contrat sont livrées telles que spécifiées. Points notables :

- **409 `REFERENT_NON_DETERMINE`** sur l'aperçu ET sur la génération, posé **avant** toute
  lecture du dossier : un document sans destinataire n'existe pas, et rien ne doit être lu à son
  profit. Le message porte un `hint` qui renvoie à la rubrique où se saisit le référent.
- L'**aperçu n'écrit rien** ; la génération enregistre un **snapshot** et recopie le destinataire
  au moment de la génération (le rattacher au référent *actuel* ferait mentir l'historique le
  jour où il change).
- La **liste** des fiches ne renvoie jamais `contenu` (vérifié par test sur le SQL lui-même).
- Trace de remise : une **date future est refusée en 400** — une intention n'est pas une remise ;
  les deux dates (référent / personne) sont indépendantes.
- Actualisation FT : 12 mois rendus, les mois sans ligne à `null` **partout** ; 409
  `ACTUALISATION_FT_NON_REQUISE` si la personne n'y est pas soumise ; upsert qui laisse intact un
  champ absent du corps (`CASE WHEN` sur des drapeaux, pas `COALESCE` — reposer `honoree` à NULL
  est un geste légitime : « finalement je ne sais pas ») ; les deux colonnes de synthèse
  d'`employees` sont **recalculées** depuis la table, jamais incrémentées.
- `/echeances-periodiques` : l'agrégat du bloc de tableau de bord. Un dossier **sans aucun
  contact** rend `dernier_le: null` et non un nombre de jours géant qui trierait la liste de
  façon absurde.

Journalisation RGPD sur les sept gestes ; la trace porte le **quoi** (période, moment,
destinataire, noms des champs touchés) et **jamais** le contenu du document — vérifié par test.

### 1.5 Retouches de `routes.js` — strictement les quatre du § 5.3

1. Types `point_etape_referent` et `conciliation` acceptés (`MILESTONE_TYPES_ALL`), titre auto en
   français ; `MILESTONE_JSONB_FIELDS` += `conciliation_motifs` ; `MILESTONE_EDITABLE_FIELDS` +=
   `referent_modalite`, `conciliation_issue` ; validateurs `conciliationValidators` avec contrôle
   **par élément** du tableau de motifs (`conciliation_motifs.*`).
2. Durées proposées 60 / 45 ajoutées à `insertion.duree_entretien_defaut`.
3. `PUT /action-plans/:id` accepte `date_realisation` ; le passage à `realise` sans date explicite
   pose `date_realisation = COALESCE(date_realisation, CURRENT_DATE)` — **en SQL** : repasser une
   action déjà réalisée par « réalisé » ne déplace pas sa date vers aujourd'hui, ce qui la ferait
   changer de semaine dans le compteur d'activité.
4. `GET /parametres` sert les 5 clés du § 4.

Rien d'autre n'a été touché dans ce fichier.

### 1.6 Réglages, journal RGPD, anonymisation

- `utils/insertion-settings.js` : les **5 clés du § 4** (lots 3 ET 4), défauts en code, documentées.
- `frontend/src/utils/rgpd-libelles.js` : les **10 codes du § 7** (lots 3 ET 4) + trois
  `entity_type` (`insertion_cadre`, `insertion_rsa`, `insertion_temps`). La garde anti-dérive
  passe.
- `services/anonymization.js` (§ 8) : `DELETE` intégral de `insertion_alimentations_referent` et
  `insertion_actualisations_ft` ; `insertion_feuilles_temps.lignes` voit les `employee_id` du
  salarié **remplacés par `null`** dans le JSONB (la feuille reste une pièce de financement ≥ 5 ans,
  le lien nominatif disparaît ; `COALESCE(..., '[]')` pour qu'une feuille vide ne devienne pas
  `null`, ce qui se lirait « jamais composée »).

### 1.7 Front (§ 9)

| Fichier | Ce qu'il apporte |
|---|---|
| `entretiens-rsa.js` (**nouveau, hors liste** — voir § 4) | Libellés des 8 types, modalités, 7 motifs de conciliation, 4 issues, moments et modes de remise |
| `EntretienForm.jsx` | Deux formulaires **courts** (ni freins, ni questionnaire, ni objectifs) ; pour la conciliation, **les motifs légitimes viennent en premier** — l'ordre des blocs EST la règle (poser d'abord les faits reprochés transformerait un entretien de protection des droits en convocation) |
| `ActiviteHebdo.jsx` (nouveau) | Badge d'en-tête + tableau détaillé : frise de 52/53 cases, quatre indicateurs, raisons catégorisées, légende. **Aucun des mots « seuil », « obligation », « insuffisant »** : « en dessous de 15 h » est un constat |
| `FicheReferentPanel.jsx` (nouveau) | Période + motif, « Voir ce qui serait transmis » (aperçu **sans écriture**, listant les 9 rubriques), « Générer », historique avec double trace de remise, et le bloc « Actualisation France Travail » (12 mois, **trois états** dont « non constatée ») |
| `pdf-referent.js` (nouveau) | `exportFicheReferentPDF` (9 rubriques dans l'ordre) et `exportReleveAssiduitePDF` (2 variantes), pattern `openPrintWindow`, pied « Exemplaire remis à la personne le … » |
| `DossierAdministratif.jsx` | Monte les deux panneaux après la rubrique Orientation, dont ils dépendent |
| `InsertionParcours.jsx` | Badge d'activité dans l'en-tête, deux entrées PDF, sélecteur de type à 8 valeurs, et le bloc **« Rendez-vous réguliers et rappels »** (`EcheancesRsaBloc`) dans `CohortePanel` |
| `AdminInsertion.jsx` / `parametres.js` | Les 5 réglages, éditables et mis en miroir |

Le bloc « Rendez-vous réguliers et rappels » ne s'affiche **pas du tout** sur un 403 : ne rien
montrer vaut mieux qu'annoncer une panne là où il n'y a qu'une habilitation (doctrine m-07 de la PR A).

---

## 2. Preuves

### 2.1 Commandes

```
cd backend && npx jest tests/contract/insertion-rsa-contract.test.js \
  tests/unit/services/activite-hebdo-engine.test.js \
  tests/unit/services/fiche-referent.test.js \
  tests/unit/scripts/insertion-rsa-migration.test.js
  → 4 suites / 122 tests VERTS

cd backend && npx jest
  → 232 suites passées (6 skipped) / 4 635 tests VERTS, 0 échec
    (socle PR A : 225 suites / 4 412 tests)
    dont la garde anti-dérive des libellés RGPD et `source-syntaxe`

cd frontend && npx vite build
  → ✓ built in 10.67 s
```

### 2.2 Ce que les tests tiennent

**Contrat (`insertion-rsa-contract.test.js`, 52 tests)** — MANAGER refusé en 403 **avant toute
requête** (`pool.query` non appelé) sur 6 routes de lecture + l'écriture ; 409
`REFERENT_NON_DETERMINE` à l'aperçu **et** à la génération, sans qu'aucune donnée du dossier ne
soit lue ni écrite ; les 9 clés de premier niveau du snapshot **réellement écrit en base** ; le
snapshot ne contient pas le mot « judiciaire » ; « sans relevé » ≠ « 0 h » **à travers l'API** ;
alerte non levée pendant un arrêt tout en comptant les semaines ; 12 mois d'actualisation avec
les absents à `null` ; 409 `ACTUALISATION_FT_NON_REQUISE` sans écriture ; date de remise future
refusée sans `UPDATE` ; journalisation des 7 gestes, **sans** le contenu ; motif de conciliation
hors liste refusé en 400 ; `COALESCE(date_realisation, CURRENT_DATE)` sur le passage à
« réalisé » ; et la garde § 6.3 (`point_etape_referent` hors des indicateurs d'entretiens).

**Unitaires** — moteur (26 tests) : les trois règles de fond, les raisons catégorisées, les
bornes de `consecutives`. Fiche (25 tests) : liste blanche **exacte** (égalité d'ensemble, pas
inclusion), absence structurelle de santé/judiciaire jusque dans le SQL, actions sensibles
retirées ligne entière, `leave_type` jamais demandé, « sans_motif » et jamais « injustifiée »,
variantes tiers/dossier, période à cheval sur deux années. Migration (19 tests) : idempotence
textuelle (2 CREATE TABLE, 4 ADD COLUMN, 3 ADD CONSTRAINT tous sous DO-scan), `honoree` nullable
sans défaut, registre gardé et paramétré.

### 2.3 Contre-épreuves par mutation (4, toutes restaurées)

| Mutation | Effet |
|---|---|
| `authorize('ADMIN','RH')` → `+ 'MANAGER'` sur le routeur RSA | **7 tests rouges** |
| `sans_releve ? null : …` → `Number(heuresTravail)` (le piège `Number(null) === 0`) | **10 tests rouges** sur deux suites |
| `FREINS.filter(f => f.sensible == null)` → `FREINS` (liste blanche → liste complète) | **4 tests rouges**, dont l'absence du mot « judiciaire » du snapshot |
| `honoree BOOLEAN,` → `honoree BOOLEAN NOT NULL DEFAULT false` | **1 test rouge** |

---

## 3. Vérifications demandées par le contrat, sans correctif nécessaire

**§ 6.3 — `point_etape_referent` hors compteur d'entretiens.** Vérifié : `gatherAuditKpis`
(routes.js) projette sur `MILESTONE_ORDER = MILESTONE_TYPES`, liste **fixe de six types** venue
d'`engine.js`, à laquelle les deux types du cadre RSA n'appartiennent pas ; aucune requête du
dépôt ne compte les entretiens « toutes valeurs ». **Aucune retouche n'a donc été nécessaire**,
et la propriété est désormais verrouillée par un test (§ 8 du contrat de test) : élargir
`MILESTONE_TYPES` sans y penser le fera tomber.

Réserve dite : `cohorte/stats` compte un `point_etape_referent` en retard parmi les
« entretiens en retard » de l'agenda. C'est légitime — un point avec le référent échu **est** une
échéance à traiter — et ce n'est pas un compteur d'accompagnement servi à l'autorité. À
confirmer à l'intégration si la direction voit les choses autrement.

---

## 4. Écarts au contrat

| Écart | Pourquoi | Conséquence |
|---|---|---|
| **Fichier créé hors liste** : `frontend/src/components/insertion/entretiens-rsa.js` | Les libellés des deux nouveaux types devaient vivre dans `ENTRETIEN_TYPE_LABELS` (`components/insertion/freins.js`), qui **n'appartient à aucun lot**. Plutôt que de toucher un fichier hors périmètre (règle 1 du § 0), les libellés sont dans un module neuf qui **étend** `ENTRETIEN_TYPE_LABELS` sans le modifier. | Aucun conflit possible. À l'intégration, on peut soit garder ce module, soit replier ses trois premières constantes dans `freins.js`. |
| **Test existant modifié** : `backend/tests/contract/insertion-contract.test.js` | Le `toEqual` exhaustif de `GET /insertion/parametres` tombe dès qu'une clé est ajoutée — ce qu'exige le § 5.3 item 4. Deux blocs mis à jour (les 5 clés du § 4, et les 2 durées proposées ajoutées à `duree_entretien_defaut`), avec le commentaire qui explique **pourquoi** ces valeurs sont servies par le serveur et non recopiées côté navigateur. | Le test reste exhaustif : une sixième clé ajoutée demain le fera tomber à son tour. |
| **`MILESTONE_TYPES` étendu localement dans `routes.js`** | `engine.js` est hors périmètre. Une constante locale `MILESTONE_TYPES_ALL` **dérive** de celle d'engine.js (elle ne la recopie pas), et la base porte la même liste dans le CHECK. | Les deux ne peuvent pas diverger en silence : un type accepté côté applicatif et refusé en base échouerait bruyamment en 23514. |
| **Pas de CHECK en base sur `conciliation_motifs`** | Un CHECK sur le contenu d'un tableau JSONB est illisible et indébogable en production. | La liste fermée est tenue par le validateur (400 en français) et par le front. Documenté dans la migration. |
| **`orientation_dora` déduit du NOM du partenaire** | Le contrat prévoit `partenaire.source = 'dora'` **ou** un libellé contenant DORA ; la table `insertion_partenaires` n'a **pas** de colonne `source`. | L'indice retenu est le nom seul, et vaut `false` quand on ne sait pas. À reprendre le jour où la colonne existe. |

---

## 5. Ce qui reste / besoins hors périmètre

1. **`frontend/src/components/insertion/freins.js`** (aucun lot) : y replier `TYPE_LABELS_RSA`
   si l'orchestrateur préfère une source unique. Idem `backend/src/routes/insertion/engine.js`
   pour `MILESTONE_TYPES` / `MILESTONE_TYPE_LABELS`. **Purement cosmétique** : rien ne dépend de
   ce repli aujourd'hui, et les deux listes sont dérivées, pas recopiées.
2. **`insertion_partenaires.source`** : colonne à ajouter (valeur `dora`) pour que l'orientation
   DORA soit une donnée et non une déduction sur le nom.
3. **`gatherAuditKpis` × `heuresAccompagnement`** : branchement prévu par le § 5.4 pour
   l'orchestrateur, pas fait ici.
4. **Réserve à arbitrer par la direction et le DPO** : la base légale de l'entrée de registre est
   posée à « mission d'intérêt public (loi n° 2023-1196) — **à confirmer par le DPO** », comme le
   veut le § 3. Le traitement fait sortir des données nominatives vers un tiers qui peut décider
   d'une suspension de droits : l'AIPD de la PR A doit être complétée de ce traitement.
5. **Point de vigilance opérationnel** : `rdv_honores` ne compte que les présences
   **explicitement constatées**. Un entretien réalisé dont la présence n'a pas été saisie n'est
   donc pas compté comme honoré, et le référent lit parfois un total inférieur à la réalité.
   C'est le prix d'un chiffre défendable — mais il faut le dire aux CIP : **saisir la présence à
   la clôture**, sans quoi l'assiduité paraîtra plus mauvaise qu'elle n'est.
6. **Au déploiement** : `deploy.sh update` (migration idempotente appelée par init-db) ;
   **aucun paramétrage requis** — les cinq réglages ont leurs défauts en code et s'éditent dans
   Réglages insertion. Les actions déjà « réalisé » reçoivent une `date_realisation` approchée
   (voir § 1.1) : les compteurs d'activité des semaines passées sont donc indicatifs jusqu'à ce
   que de nouvelles actions soient saisies.

# Lot 2.60.0 « Suivi Convergence (programme CVG) » — debug sur PostgreSQL réel

> Agent de debug, 25/09/2026. Branche `claude/solidata-cip-redesign-9fskwq-pr-e` (HEAD `d1e5acd`).
> Contrat : `30-convergence-cvg-cartographie.md`. Méthode : `28-debug-postgres-PR-D.md`.
> Aucune commande git. `frontend/` et `docs/` non touchés. **Un correctif de code** (`services/convergence-cvg.js`,
> D-01, § 4), prouvé avant/après. Les constats de la revue de sécurité (rapport 32) ne sont **pas** corrigés ici :
> ils reviennent à l'agent de correctifs (§ 7).

---

## 0. En une phrase

Le lot n'avait **aucune** preuve sur base réelle (tout était simulé). **53 vérifications** de bout en bout ont été
jouées à travers les vrais handlers Express et le vrai pool, contre PostgreSQL 16.13, **sur la base migrée ET sur
une base neuve, sous `TZ=UTC` ET sous `TZ=Europe/Paris`**. La cohorte du formulaire scanné, reconstituée en base
(46 accueillis, 9 sortis), ressort **cellule par cellule** — après correction d'**un défaut majeur** : un sortant
dont le bilan de sortie a été rédigé **avant** le début du semestre (cas normal : l'échéancier le pose à
fin − 15 jours) sortait **« sans bilan » donc « sans nouvelles », hors emploi**, alors que son bilan dit « CDI ».
Le taux d'accès à l'emploi du document transmis à Convergence tombait de **33,3 % à 22,2 %**.

La non-régression PR A + B + C + D (**399 vérifications**) est verte dans les deux fuseaux, après conversion de
**25 tests** qui éprouvaient encore une vue MANAGER (rôle retiré en 2.52.0) en **refus à la porte** (§ 5).

---

## 1. Ce qui a été mis en place

| Fichier | Contenu |
|---|---|
| `backend/tests/e2e-pr-e/_helpers.js` | Socle **réutilisé en cascade** (PR D → PR C → PR B) : jetons MFA, comptes par rôle, salarié minimal, journal par action. Ajoute `purgerPrE` (instantanés `type='cvg'`, registre des moyens humains, situations de sortie, reports) et `ins()`. Garde `RUN` : `PR_E_E2E_DB=1` **ou** l'une des variables des PR A-D. |
| `pr-e-migration-e2e.test.js` | **5 vérifications** de schéma, dont une migration rejouée sur la table **ramenée à sa forme d'avant le lot**, dans une transaction annulée. |
| `pr-e-convergence-e2e.test.js` | **42 vérifications** : la cohorte du scan, les bornes de dates, le journal, les refus, la situation de sortie, la complétude, les moyens humains, la comparaison, l'anonymisation. |
| `pr-e-echeances-e2e.test.js` | **6 vérifications** de la 10ᵉ famille d'obligations (`sortie_cvg`). |
| `tests/unit/services/convergence-cvg.test.js` | **+2 unitaires** (D-01, sans base) : le filet reste en place quand `npx jest` tourne sans PostgreSQL. |

Toutes les suites e2e sont **ignorées sans variable** : `npx jest --silent` reste vert sans base (§ 5.3).

### 1.1 Jeu d'essai — la cohorte du scan, en base

**46 personnes** en parcours sur le semestre 01/04 → 30/09/2026, chacune construite pour une ligne précise du
formulaire, plus **trois pièges** qui ne doivent apparaître nulle part (parcours terminé le 31/03, parcours ouvert le
01/10, permanent `insertion_status = 'none'` — tous trois orientés `cap_emploi`, colonne qui doit rester à 0).

- **Sexe 18 H / 28 F** : 16 + 26 par `gender`, **4 par la seule civilité** (M., Monsieur, Mme, Madame) — le repli est exercé.
- **Âge 4 / 31 / 11** au 30/09/2026, avec **les deux bornes exactes** : né le 01/10/2000 (25 ans la veille de ses 26 → moins de 26), né le 30/09/2000 (26 ans le jour même → 26-49), né le 01/10/1976 (49 ans), né le 30/09/1976 (50 ans le jour même → 50 et plus).
- **Formation 5 / 29 / 8 / 2 / 0 / 2 / 0** (`infra3` … `niv7`).
- **Minima sociaux par TOUTES les voies du composeur** : RSA 32 = 20 statut `brsa` + 6 critère + 4 ressource du diagnostic + 2 questionnaire FSE+ ; ASS 3 = critère + ressource `'ASS'` (casse) + FSE+ ; 2 ans et plus 23 = 15 FSE+ `gt_24m` + 8 critère `detld` ; RTH 5 = 1 critère + 2 diagnostic + 2 fiche (« RQTH », « Travailleur handicapé ») — et **deux pièges** « non » / « Aucun » qui ne doivent pas compter ; réfugiés 3 par critère ; **AAH 0**.
- **Habitat 14 / 22 / 2 / 7 / 0 + 1 non renseigné** : 10 saisis en nomenclature CVG + 4 **transcodés** depuis `logement_statut` (locataire social / privé / propriétaire) ; « hébergé » **seul** → non renseigné ; « hébergé » avec saisie CVG → la saisie prime ; `sans_abri` avec saisie « précaire » → la saisie prime (sinon « rue » passerait à 1). **5 parcours de rue**.
- **Difficultés à l'entrée 16 / 20 / 19 / 31 / 7 / 3 / 6 / 23** au seuil 3 — les niveaux sous le seuil valent 1 ou 2, et **`frein_numerique = 5` pour tout le monde** : transmis, il le serait sur 46.
- **Orienteurs 37 FT / 1 ML / 5 PLIE / 2 « autre acteur local d'accompagnement » / 1 candidature spontanée** — l'un des deux « autres » est une **ancienne saisie `ccas`, transcodée**.
- **Contrats** : 30 par `employee_contracts` (dont 2 **chaînés** dont le premier s'arrête le 30/06), **7 par le repli fiche** (`contract_start/end`, aucun historique), les 9 sortants avec un contrat qui s'arrête à leur fin de parcours.
- **9 sortants** entre le 01/04 et le 30/09, fins **au 01/04 (borne basse) et au 29/09**, durées 200 → 345 j dont la moyenne est 283 j = **9,30 mois** ; catégories : 1 CDI (bilan), 2 formation (bilan), 1 fin de contrat → sans solution (bilan), 2 **sorties neutres** et 1 **autre positive** (situation saisie **par l'API**, `PUT /situation-sortie`), 2 non catégorisés (bilan `sortie_type` NULL ou `autre`) — l'un du côté emploi (classification `emploi_transition`), l'autre sans côté (`sortie_positive`, ambiguë).
- **Freins de sortie** posés sur des évaluations intermédiaires (dernière évaluation cotée), dont un cas délibéré : **famille 2 → 1** chez une personne qui n'était **pas** en difficulté à l'entrée (R-02).
- Registre des moyens humains : 2 internes, 1 mutualisée, 1 hors période, 1 inactive.

---

## 2. Séquence de migration

`init-db.local.js` **régénéré** : la commande indiquée pour ce lot (`GEOMETRY → TEXT` seul) ne suffit pas — l'index
`USING GIST(geom)` échoue alors (« data type text has no default operator class for access method gist ») et
`init-db` s'arrête en exit 1 **avant** la migration. La commande complète est celle du rapport 13 § 9 :

```
sed -e 's/GEOMETRY(Point, 4326)/TEXT/g' -e 's/USING GIST\s*(\(geom[a-z_]*\))/(\1)/Ig' -e 's/GEOMETRY([^)]*)/TEXT/g' \
    src/scripts/init-db.js > src/scripts/init-db.local.js
```

### 2.1 Base existante (`solidata_test`, état PR D) — trois passes

Avant la première passe, deux témoins sont posés : une **synthèse de dialogue de gestion antérieure au lot** et un
salarié orienté **`ccas`** (ancienne valeur). Une copie de la base est conservée (`solidata_pre_e`).

```
node src/scripts/init-db.local.js   # passe 1 : exit 0 — « Migration « Suivi Convergence (CVG) » ✓ »
node src/scripts/init-db.local.js   # passe 2 : exit 0
node src/scripts/init-db.local.js   # passe 3 : exit 0
```

245 → 252 tables : **2 du lot** (`insertion_sortie_cvg`, `insertion_cvg_ressources`) + 5 venues de la fusion de
`main` (`etiquettes_*`, `sortie_cartons_journal`) — vérifié par différence avec la copie d'avant. La synthèse antérieure
reçoit **`type = 'dialogue'`**, l'orienteur `ccas` survit au changement de CHECK, l'entrée art. 30 est posée **une** fois.

### 2.2 Base NEUVE (`solidata_neuve_e`)

```
init-db.local   exit 1 — ATTENDU : « relation "clients_exutoires" does not exist » (préexistant, rapport 13 § 2)
migrate-exutoires  exit 0
migrate-finance    exit 0
init-db.local   exit 0   (migration CVG posée)
init-db.local   exit 0   (idempotence)
```

252 tables, entrée art. 30 **une** fois. **Les 53 vérifications ont été rejouées sur cette base neuve**, dans les deux
fuseaux : 53/53 et 53/53.

### 2.3 État du schéma (les deux bases)

| Vérification | Résultat |
|---|---|
| `insertion_diagnostics.habitat_type` VARCHAR / `parcours_rue`, `pension_invalidite`, `medecin_traitant` BOOLEAN | posées, **toutes nullables** ✓ |
| `employees.orienteur_type` | **VARCHAR(40)** ✓ (était 20) |
| CHECK `employees_orienteur_type_check` | **15 valeurs** exactement = `ORIENTEURS_ACCEPTES` ✓ ; `services_sociaux_departement` (28 car.) accepté **et relu non tronqué**, `foo` refusé en 23514, `ccas` toujours accepté |
| 10 CHECK du lot | présents, **tous exercés** : habitat `chateau`, catégorie `demenagement`, habitat de sortie, type de ressource `benevole`, ETP 2,5 et −0,1, dates inversées, type d'instantané `autre` → 23514 |
| `UNIQUE (employee_id, parcours_num)` sur `insertion_sortie_cvg` | présent ; second parcours accepté, doublon refusé en **23505** ✓ |
| `insertion_dialogues_gestion.type` | `NOT NULL DEFAULT 'dialogue'` ✓, index `(type, genere_le DESC)` ✓ |
| Migration rejouée sur la table **ramenée à sa forme d'avant** (colonnes et CHECK retirés, orienteur en VARCHAR(20) à 6 valeurs, ligne antérieure posée) — deux passes, transaction annulée | la ligne antérieure reçoit `type = 'dialogue'`, l'ancienne saisie `ccas` survit, la colonne repasse à 40, **un seul** CHECK orienteur ✓ |

---

## 3. Vérifications (53) — verdicts

Toutes vertes sous `TZ=UTC` **et** `TZ=Europe/Paris`, sur base migrée **et** base neuve, **après** le correctif D-01.
Avant le correctif, **7 rouges** (V-19 à V-24, V-60) dans les deux fuseaux.

### 3.1 Migration (V-01 → V-05) — § 2.3

### 3.2 La cohorte du scan — `GET /convergence/apercu?debut=2026-04-01&fin=2026-09-30`

| # | Cellule(s) du formulaire | Attendu (scan) | Rendu | Verdict |
|---|---|---|---|---|
| V-10 | base vide de tout autre parcours | 0 | 0 | ✓ |
| V-11 | aucune source illisible | aucune | aucune, registre lisible | ✓ |
| V-12 | ETP conventionnés / accueillis / en contrat au 30/09 | 25,17 / 46 / 37 | 25,17 / 46 / 37 | ✓ |
| V-13 | H / F ; < 26 / 26-49 / 50 + | 18 (39,1 %) / 28 (60,9 %) ; 4 / 31 / 11 | identique | ✓ |
| V-14 | formation 1-2 → 8 ; « 6 et plus » | 5/29/8/2/0/2/0 ; absente | identique | ✓ |
| V-15 | 2 ans + / RSA / ASS / RTH / AAH / réfugiés | 23 / 32 / 3 / 5 / 0 / 3 | identique, **AAH `{nb:0, pct:0}` explicite** | ✓ |
| V-16 | habitat 5 types ; parcours de rue | 14/22/2/7/0 (+1 NR) ; 5 | identique, total 45 (97,8 %) | ✓ |
| V-17 | 8 difficultés à l'entrée | 16/20/19/31/7/3/6/23 | identique, **`numerique` absent du JSON entier** | ✓ |
| V-18 | orienteurs | 37 FT / 1 ML / 5 PLIE / 2 autre acteur / 1 spontanée | identique, `ccas` transcodé, pièges `cap_emploi` à 0 | ✓ |
| V-19 | sortis ; sans bilan ; durée moyenne ; non catégorisés | 9 ; 0 ; 9,3 ; 2 | 9 ; 0 ; 9,3 ; 2 | ✓ (**rouge avant D-01** : 1 sans bilan) |
| V-20 | emploi / suite de parcours / formation | 1 / 0 / 2 (total 3) | identique | ✓ (**rouge avant D-01** : total 2) |
| V-21 | retraite / sans solution / sans nouvelles / neutre / autre positive / parcours de soin | 0 / 1 / 0 / 2 / 1 / 0 (total 4) | identique | ✓ (**rouge avant D-01** : total 5, 1 « sans nouvelles » inventé) |
| V-22 | évolution des freins, tableau emploi | entrée 3 partout ; résolution 2/1/1/1/1/0/0/1 | identique | ✓ (**rouge avant D-01**) |
| V-23 | évolution des freins, tableau hors emploi | entrée 4/4/4/4/4/0/3/4 ; résolution 0/1/0/1/1/0/1/1 | identique | ✓ (**rouge avant D-01**) |
| V-24 | logement et santé entrée → sortie ; post-sortie ; situations non saisies | cf. test | identique | ✓ (**rouge avant D-01**) |
| V-25 | aucun nom, matricule ni `employee_id` dans le document | — | aucun | ✓ |

**Ce que le scan ne dit pas et qui a été construit** : les tableaux d'évolution des freins des sortants (le scan ne
les chiffre pas dans la consigne) ont été composés à la main puis **recalculés indépendamment** ; le rendu coïncide
cellule par cellule.

### 3.3 Dates civiles aux bornes (V-26) — les deux fuseaux

Un sortant ajouté le **30/09** et un autre le **01/10** (contrats datés) :

- période 01/04 → 30/09 : **10 sortis** (le 30/09 y est, le 01/10 non), 48 accueillis ;
- période → 29/09 : **9 sortis** (le 30/09 n'y est pas) ;
- période 01/10 → 31/12 : **1 sorti** (le 01/10) ;
- période d'un seul jour, le 30/09 : 1 sorti, durée **289 jours / 30,4375** exactement ;
- aucun glissement sous `TZ=Europe/Paris` : les dates passent par `isoDate` (composantes locales) et les bornes par `::date` côté PostgreSQL.

### 3.4 Journal, gestes du document, refus (V-30 → V-39)

| # | Vérification | Verdict |
|---|---|---|
| V-30 | aperçu : 200, **une** ligne `INSERTION_CVG_APERCU` (`entity_type = insertion_convergence`, `entity_id` NULL, période seule, aucun contenu) | ✓ |
| V-31 | génération : 201, instantané `type='cvg'`, `annee` 2026, `trimestre` NULL, période, `genere_par` ; **une** ligne `INSERTION_CVG_GENERATION` portant le `snapshot_id` | ✓ |
| V-32 | historique CVG (prénom + initiale du générateur) ; consultation `INSERTION_CVG_CONSULTATION` ; rejeu identique | ✓ |
| V-33 | l'instantané CVG n'apparaît **pas** dans l'historique de la synthèse (avec et sans `?annee`) et `GET /reporting/dialogue-gestion/:id` le refuse en **404** | ✓ |
| V-34 | l'inverse : une synthèse générée en `type = 'dialogue'` n'apparaît pas dans l'historique CVG ni par `/snapshot/:id` (404), et reste dans le sien | ✓ |
| V-35 | CSV : 200, `text/csv`, lignes « accueillis ;46 » et « sortis ;9 », **une** ligne `EXPORT_CVG` | ✓ |
| V-36 | **journal indisponible** (`rgpd_audit_log` renommée) : aperçu **500 sans contenu**, génération **500 sans instantané** (nombre d'instantanés inchangé), CSV 500, consultation 500 sans contenu | ✓ |
| V-37 | période sans personne (2019) : génération et CSV **409 `EXPORT_VIDE`**, ni instantané ni trace | ✓ |
| V-38 | fin < début, > 24 mois, **30 février** : 400 `PERIODE_INVALIDE` sur aperçu, CSV, complétude et génération, **aucune requête métier ni `pool.connect()`** (espions) | ✓ |
| V-39 | COLLABORATEUR, DPO et jeton chauffeur : 403 sur aperçu, écriture de situation et registre, **aucune requête métier** | ✓ |

### 3.5 Situation de sortie (V-40 → V-44)

| # | Vérification | Verdict |
|---|---|---|
| V-40 | proposition déduite du bilan (**CDI → emploi**) avec sa source en toutes lettres, habitat, pension et médecin traitant repris du diagnostic ; **rien n'est écrit** ; bilan `sortie_type` NULL → catégorie **null**, jamais devinée | ✓ |
| V-41 | deux PUT (RH puis ADMIN) = **une** ligne, la seconde met à jour (`saisi_par` = ADMIN) ; deux lignes `INSERTION_SORTIE_CVG_ECRITURE` qui portent **les noms des champs, jamais leurs valeurs** | ✓ |
| V-42 | catégorie et habitat hors liste, booléen `'oui'`, corps vide → **400**, rien d'écrit ; salarié inconnu → 404 | ✓ |
| V-43 | `parcours_num` 2 puis 1 → **deux lignes** ; lecture par `?parcours_num=2` ; le document lit le **parcours courant** | ✓ |
| V-44 | complétude : liste **nominative** interne, manques nommés en phrases (situation non saisie, catégorie à préciser, habitat à préciser), un sortant complet n'y figure pas | ✓ — **lecture non journalisée** (O-02) |

### 3.6 Moyens humains (V-50 → V-55)

| # | Vérification | Verdict |
|---|---|---|
| V-50 | registre vide : totaux **null**, jamais 0 | ✓ |
| V-51 | interne 201 ; accompagnement + encadrement > total → **400 `RESSOURCE_INVALIDE`** sans écriture ; mutualisée : quotités d'accompagnement et d'encadrement **remises à NULL** même envoyées | ✓ |
| V-52 | PUT partiel contrôlé **contre l'existant** (1 + 0,5 > 1 → 400 ; total porté à 1,5 → 200) ; mutualisée jamais ventilée ; 404 inconnue | ✓ |
| V-53 | Partie 2 de l'aperçu = ressources **actives sur la période** (hors période et inactive exclues) ; totaux 2,5 / 1,2 / 1,3, mutualisées 0,1, **total CVG 2,6** | ✓ |
| V-54 | table renommée : `registre_lisible` **false**, total null, source `ressources_cvg` **nommée** dans la méthode | ✓ |
| V-55 | suppression 200 puis 404 ; liste triée | ✓ |

### 3.7 Comparaison (V-60 → V-62)

Période A = le scan ; période B = la même, avec **deux sortants de plus en emploi** (CDI, intérim) ; période C = le
trimestre suivant (aucun sortant).

| # | Vérification | Verdict |
|---|---|---|
| V-60 | deux instantanés : accueillis 46 → 48 (+2, neutre), sortis 9 → 11, **accès emploi/formation 3 (33,3 %) → 5 (45,5 %), +12,2 points, `favorable`** ; hors emploi 44,4 % → 36,4 %, −8 points, neutre ; phrase exacte « Le taux d'accès à l'emploi ou à la formation des sortants passe de 33,3 % à 45,5 % (en hausse de 12,2 points). » ; aucune cause (« parce que », « grâce à »…) ; trace `INSERTION_CVG_COMPARAISON` avec les deux ids | ✓ (**rouge avant D-01** : 22,2 % → 36,4 %) |
| V-61 | A vs C : l'accès à l'emploi est **`non_comparable`**, sans écart ni sens ; phrase « … ne peut pas être comparée : donnée non renseignée ou effectif nul sur la période du 01/10/2026 au 31/12/2026. » ; compte des indicateurs non comparables | ✓ |
| V-62 | **à la volée** (4 dates) : deltas **identiques** à ceux des instantanés équivalents ; trace des deux périodes ; période A inversée → 400 `PERIODE_INVALIDE` ; un seul id → 400 `COMPARAISON_INCOMPLETE` | ✓ |

### 3.8 Anonymisation (V-70)

`anonymizeEmployee` sur un sortant (transaction réelle) : la ligne `insertion_sortie_cvg` est **supprimée**,
`pension_invalidite` et `medecin_traitant` **remis à NULL**, `habitat_type` conservé (catégoriel), et l'instantané CVG
généré avant est **identique au bit près** (agrégé, aucune clé `employee_id`). ✓

### 3.9 Obligation `sortie_cvg` — Mes échéances (V-80 → V-85)

| # | Vérification | Verdict |
|---|---|---|
| V-80 | sortant depuis 40 j sans situation : obligation **rouge**, `jours` 40, échéance = fin + 30 j (jour civil de Paris) ; libellé sans aucune donnée de santé ni catégorie | ✓ |
| V-81 | seuil **strict** : 31 j → obligation ; 30 j et 10 j → rien | ✓ |
| V-82 | situation saisie → rien ; situation saisie pour le **parcours 1** d'une personne au **parcours 2** → obligation **maintenue** ; personne en parcours → rien | ✓ |
| V-83 | RH la reçoit aussi ; COLLABORATEUR 403 | ✓ |
| V-84 | report par la route existante : 201, la ligne passe dans `reportees`, le compteur rouge baisse de 1 ; second report sans motif → **409 `MOTIF_REQUIS`** (jamais acquittable) | ✓ |
| V-85 | table renommée : **aucune** obligation `sortie_cvg` (personne n'est réclamé à tort), source `sorties_cvg` nommée dans `sources_indisponibles` | ✓ |

---

## 4. Défaut trouvé et correctif

### D-01 — **MAJEUR** · un sortant dont le bilan a été rédigé avant le semestre sort « sans nouvelles », hors emploi

**Où** : `backend/src/services/convergence-cvg.js`, `chargerDonnees` (appariement des sortants).

**Reproduction** (V-19 à V-24, V-60 — rouges dans les deux fuseaux, sur les deux bases) : sortant n° 1, fin de
parcours le **01/04/2026**, bilan de sortie réalisé le **20/03/2026** (`sortie_type = 'CDI'`,
`sortie_classification = 'emploi_durable'`).

| | Avant | Après |
|---|---|---|
| Sortis sans bilan de sortie | **1** | 0 |
| Tableau emploi ou formation | **2** (emploi 0) | 3 (emploi 1) |
| Tableau hors emploi | **5**, dont **1 « sans nouvelles »** | 4, sans nouvelles 0 |
| Taux d'accès à l'emploi ou à la formation | **22,2 %** | 33,3 % |
| Freins de la personne (8 axes) | comptés côté **hors emploi** | comptés côté emploi |

**Cause racine.** Le composeur reprend `chargerFinsEtBilans` de la synthèse de dialogue de gestion : les **fins** de
parcours de la période (le dénominateur, juste), mais aussi les **bilans rédigés dans la période** — filtre qui sert la
méthode A de la synthèse (qui compte des bilans), pas l'appariement d'une personne à son bilan. Or l'échéancier de
l'outil pose le bilan de sortie à **fin − 15 jours** : pour toute personne partie dans les quinze premiers jours d'un
semestre (et pour toute personne dont le bilan est saisi après la fin de la période), le bilan tombe hors période, n'est
pas apparié, et le réglage `insertion.cvg_sans_bilan_est_sans_nouvelles` (vrai par défaut) la range **« sans
nouvelles »**. Le document transmis à Convergence **inventait** donc une sortie hors emploi. Les tests unitaires ne
pouvaient pas le voir : leur `db` injecté rendait le même tableau de bilans quel que soit le filtre de date.

**Correctif** (le dénominateur ne change pas) : pour les seuls sortants **non appariés**, une requête complémentaire va
chercher le dernier bilan de sortie réalisé et classé **de LEUR parcours**, quelle que soit sa date
(`DISTINCT ON (employee_id, parcours_num)`, source `bilans_sortie_hors_periode` résiliente et nommée si illisible) ;
« sans bilan de sortie » est désormais compté sur cet appariement (et `null` si les bilans sont illisibles, jamais 0).
`calculerSorties` n'est plus appelé par ce composeur. **Preuve** : 7 vérifications rouges → vertes ; 2 unitaires
ajoutés (un sortant au bilan antérieur reste apparié ; sans aucun bilan, il reste « sans bilan ») ; contre-épreuve § 6.

**Même famille, hors périmètre, NON corrigée** : la **méthode B de la synthèse de dialogue de gestion**
(`sorties-engine` via `chargerFinsEtBilans`) apparie de la même façon — une sortie des quinze premiers jours de janvier
dont le bilan est de décembre est comptée « sortie non documentée » dans le document annuel. L'effet y est borné à une
frontière d'année au lieu de deux frontières de semestre, et la règle est partagée par **quatre surfaces** qui ont déjà
publié des taux : la corriger est une décision (§ 7), pas un correctif de debug.

---

## 4 bis. Règles de méthode constatées (ni défauts, ni corrigées — à dire, à la CIP ou au réseau)

| # | Règle | Preuve |
|---|---|---|
| R-01 | Un parcours qui s'achève **le jour de fin** est à la fois « sorti » et « en contrat à la date de fin » (le contrat couvre ce jour) ; le scan (46 = 37 + 9) suppose qu'aucun sortant ne tombe le dernier jour. La phrase de méthode dit « parcours **non terminé** à cette date » alors que le SQL retient `insertion_end_date >= fin`. | V-26 : 37 → 39 avec un sortant au 30/09 et un au 01/10 ; 40 sur la période au 29/09 |
| R-02 | « Résolution totale ou partielle » = niveau de sortie < niveau d'entrée **quel que soit le niveau d'entrée** : une personne qui n'était pas en difficulté (2 → 1) compte une résolution, si bien qu'un axe peut afficher plus de résolutions que de difficultés à l'entrée. C'est écrit en méthode ; Convergence lit sans doute « parmi les personnes en difficulté ». | V-23, axe famille |
| R-03 | L'écart en points se calcule sur les pourcentages **arrondis** affichés (36,4 − 44,4 = −8,0, et non −8,08) — le lecteur retrouve l'écart à la main. | V-60 |
| R-04 | « Accueillis sur la période » = parcours qui **chevauche** la période (c'est ce que dit la méthode et ce que le scan confirme : 46 = 37 + 9) — le contrat 30 § 1.1 annonçait `insertion_start_date ∈ période` + garde `relevantDeLaCip` ; **la garde `relevantDeLaCip` n'est pas appliquée** (même périmètre que la synthèse et le moteur des sorties, pas celui de l'espace CIP). | lecture + V-12 |

## 4 ter. Observations (non corrigées)

| # | Observation |
|---|---|
| O-01 | `GET /situation-sortie/:employeeId` rend une **proposition portant des données de santé** (RQTH, pension, médecin traitant) sans aucune trace au journal ; seule l'écriture est journalisée. Le registre art. 30 promet la journalisation « de chaque saisie », pas de chaque lecture. |
| O-02 | `GET /completude` rend une liste **nominative** (NOM Prénom + manques) sans trace au journal (V-44 le fige). Les manques ne portent pas de valeur sensible. |
| O-03 | La commande de régénération d'`init-db.local.js` donnée pour ce lot est incomplète (§ 2) ; celle du rapport 13 § 9 fait foi. |
| O-04 | Le serveur PostgreSQL de recette s'est arrêté pendant la campagne (redémarré) et la base `solidata_test` est **partagée** avec les autres agents : la synthèse antérieure posée en témoin avant la migration n'y figurait plus au second passage. La preuve « défaut `'dialogue'` sur ligne existante » repose donc sur V-04 (transaction isolée) et sur la relecture faite juste après la passe 1 (ligne 198, `type = dialogue`). |

Croisement avec la revue de sécurité (rapport 32) : la cohorte d'essai **n'a pas rencontré** M-02 (les deux pièges
« non » / « Aucun » ne comptent pas — « Non concerné », lui, n'a pas été posé) ; B-01, B-02, M-01 et M-03 sont
**hors de ce rapport** et laissés à l'agent de correctifs.

---

## 5. Non-régression PR A + B + C + D

### 5.1 État avant tout changement

Sur la base migrée, **avant** et **après** la migration du lot, les mêmes **37 rouges**, identiques dans les deux
fuseaux : PR A 10, PR B 14, PR C 8, PR D 5. **La migration n'en ajoute aucun.** Tous tiennent à une seule cause : la
fusion de `main` a **retiré le rôle MANAGER** (2.52.0) et ces tests éprouvaient encore sa vue masquée (200 attendu,
403 reçu), ou s'en servaient comme acteur.

### 5.2 Conversion — sur le modèle de `tests/contract/insertion-isolation-contract.test.js`

Mêmes scénarios, mêmes jeux de données ; l'attente devient le **refus à la porte**, forme forte de la même garantie
(rien n'est lu). Chaque test converti porte la mention du rôle retiré et renvoie à ce rapport. **25 tests édités** :

| Suite | Tests convertis |
|---|---|
| PR A (9) | sécurité : questionnaire FSE+ lu / écrit, alerte « référent non déterminé », clôture du bilan de sortie → 403 ; cadre : lecture, C-01, M-06 → 403 ; référentiel des critères et projets lus par **RH** + MANAGER 403. Le test « critère inconnu … ROLLBACK » repasse vert **sans modification** (il échouait en cascade du M-06 interrompu avant sa remise en état). |
| PR B (3 + acteur) | L'**intervenant** des feuilles de temps était un MANAGER : il devient une **seconde CIP (rôle RH)**, distincte de `U.RH`, pour que « on ne contresigne pas sa propre feuille » reste exerçable (409 `AUTO_VALIDATION`) ; périmètre (le MANAGER est refusé sur toute feuille, la sienne comprise) ; anti-énumération des saisies (même réponse 403 pour une saisie inconnue et celle d'un autre). Les 11 autres rouges tombaient en cascade de l'acteur. |
| PR C (8) | file active et `?inclure=tous`, `brsa` jamais lu (espion conservé), familles d'échéances (espion conservé), types non sociaux rendus à **RH** ; lien ETI : génération refusée même encadrant, **aucun jeton posé**, jeton et lien jamais servis, référent refusé et lien servi à RH. |
| PR D (5) | historique de la synthèse lu par RH, lecture refusée (l'écriture restant refusée **avant toute requête**), `/audit` et `/exports/insertion-synthese` sans aucun statut social ni ventilation, actions DORA. |

### 5.3 Résultats

| Suite | `TZ=UTC` | `TZ=Europe/Paris` |
|---|---|---|
| PR A | **93/93** | **93/93** |
| PR B | **87/87** | **87/87** |
| PR C | **136/136** | **136/136** |
| PR D | **83/83** | **83/83** |
| **Lot 2.60.0 (e2e-pr-e)** — base migrée | **53/53** | **53/53** |
| **Lot 2.60.0 (e2e-pr-e)** — base neuve | **53/53** | **53/53** |

`npx jest --silent` **sans base** : **277 suites passées / 16 ignorées, 5 604 tests verts / 496 ignorés, 0 échec**.

---

## 6. Contre-épreuves par mutation (6, toutes restaurées)

| # | Mutation | Ce qui tombe |
|---|---|---|
| 1 | retirer le correctif D-01 (fichier d'origine) | **7** e2e (V-19 → V-24, V-60) + **1** unitaire |
| 2 | échéances : ignorer le `parcours_num` de la situation saisie (`${id}#1`) | V-82 |
| 3 | historique de la synthèse : retirer le filtre `type = 'dialogue'` | V-33 |
| 4 | anonymisation : retirer la suppression de `insertion_sortie_cvg` | V-70 |
| 5 | génération : écrire la trace **après** le COMMIT, sur le pool | V-36 (un instantané survit à un journal indisponible) |
| 6 | (unitaire) D-01 retiré, `npx jest` sans base | « le sortant reste apparié » |

Après chaque mutation, le fichier d'origine a été recopié ; `git status` ne montre plus que le correctif D-01 dans
`backend/src/`.

---

## 7. Ce qui reste

1. **Même famille que D-01 dans la synthèse annuelle** (méthode B, frontière de janvier) — à arbitrer : aligner
   l'appariement dans `sorties-engine` changerait des taux déjà publiés par quatre surfaces.
2. **R-01, R-02, R-04** à trancher avec la CIP et, pour R-02, à confirmer auprès de Convergence (lecture attendue de
   « résolution » : parmi les personnes en difficulté à l'entrée, ou toutes).
3. **O-01 / O-02** : journaliser (en mode tolérant) la lecture de la proposition de situation de sortie et de la
   complétude nominative ?
4. **Revue de sécurité (rapport 32)** : B-01, B-02, M-01, M-02, M-03 — à l'agent de correctifs. Les suites
   `e2e-pr-e` sont prêtes à servir de filet : V-15 (RTH), V-24 et V-54 (sources illisibles) sont les plus proches.
5. **Le PDF CVG** (`pdf-convergence-cvg.js`) n'a pas été éprouvé au rendu (hors périmètre backend).

---

## 8. Rejouer ces preuves

```bash
source <scratchpad>/db-test.env
cd backend
sed -e 's/GEOMETRY(Point, 4326)/TEXT/g' -e 's/USING GIST\s*(\(geom[a-z_]*\))/(\1)/Ig' -e 's/GEOMETRY([^)]*)/TEXT/g' \
    src/scripts/init-db.js > src/scripts/init-db.local.js
node src/scripts/init-db.local.js            # ×3 sur la base existante
for tz in UTC Europe/Paris; do
  TZ=$tz PR_E_E2E_DB=1 npx jest tests/e2e-pr-e --runInBand
  for x in a b c d; do TZ=$tz PR_$(echo $x | tr a-z A-Z)_E2E_DB=1 npx jest tests/e2e-pr-$x --runInBand; done
done
DB_NAME=solidata_neuve_e PGDATABASE=solidata_neuve_e PR_E_E2E_DB=1 npx jest tests/e2e-pr-e --runInBand
npx jest --silent                            # sans base : les suites e2e sont ignorées
```

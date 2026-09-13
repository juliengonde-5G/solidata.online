# PR C « Section CIP et documents du salarié » — debug sur PostgreSQL réel

> Agent de debug, 13/09/2026. Branche `claude/solidata-cip-redesign-9fskwq-pr-c` (empilée sur la PR B).
> Périmètre d'écriture : `backend/tests/e2e-pr-c/` (nouveau) et ce fichier. **Aucune ligne de code
> source n'a été modifiée** — les six mutations de contre-épreuve ont toutes été restaurées,
> `git status` le confirme (§ 7). Aucune commande git d'écriture.
> Références : contrats `20-contrats-techniques-PR-C.md`, réalisations `21-realisation-lot5.md` et
> `21-realisation-lot7.md`, méthode `18-debug-postgres-PR-B.md`.

---

## 0. En une phrase

**129 vérifications de bout en bout** ont été jouées à travers les vrais handlers Express contre
PostgreSQL 16.13, sous `TZ=UTC` (**121 vertes, 8 rouges**) puis sous `TZ=Europe/Paris`
(**120 vertes, 9 rouges**) : elles isolent **sept défauts**, dont **un bloquant** — le SMS de rappel
annonce à la personne **16 h pour un rendez-vous saisi à 14 h**, dans la configuration de production
— et **deux majeurs** : le **jeton du lien public ETI est servi en clair** par trois surfaces
authentifiées (dont au MANAGER), et un **rendez-vous de fin de soirée ne reçoit aucun rappel**.

---

## 1. Ce qui a été mis en place

| Fichier | Contenu |
|---|---|
| `backend/tests/e2e-pr-c/_helpers.js` | Socle : **réutilise celui de la PR B** (jetons MFA, comptes par rôle, salarié minimal, `iso()`, photographie du pool) et y ajoute la purge du périmètre PR C — documents, rappels, reports, consentements, **et les fiches ANONYMISÉES, que la purge par matricule ne retrouve plus** (l'anonymisation efface `malibou_id`) |
| `backend/tests/e2e-pr-c/pr-c-echeances-e2e.test.js` | Lot 5 — **51 vérifications** : périmètre de la file active, champs enrichis, `diagnostic_socle_complet`, pastille de risque, projection MANAGER, les neuf types d'obligation, tri, report (48 h, motif au 2ᵉ, expiration), compteur et son cache, deux horloges, source en échec |
| `backend/tests/e2e-pr-c/pr-c-eti-e2e.test.js` | Lot 5 — **25 vérifications** : génération du lien, unicité partielle en base, révocation par régénération, 404/410/409, charge publique réduite aux neuf clés du § 5.3, écriture par jeton, `validations`, historisation, journal à `user_id` NULL, confidentialité du jeton, anonymisation |
| `backend/tests/e2e-pr-c/pr-c-salarie-e2e.test.js` | Lot 7 — **53 vérifications** : habilitations ADMIN/RH sur les dix routes, composition des deux documents, **absence prouvée sur le JSONB STOCKÉ**, journal bloquant, remise tracée, consentement et retrait, job de rappels (jour civil de Paris, `dry_run`, masquage, unicité), purge, anonymisation |

Les trois suites sont **ignorées tant que `PR_C_E2E_DB=1` (ou `PR_A_E2E_DB=1` / `PR_B_E2E_DB=1`)
n'est pas fourni** : `npx jest` reste vert sans base (§ 5).

### 1.1 Jeu d'essai — ce qu'il porte délibérément

Le dossier « riche » du lot 7 (`PRCS_RICHE`) est chargé de **tout ce qui ne doit jamais sortir** :
frein santé 5 et frein judiciaire 4, commentaire de santé, statut BRSA, catégorie France Travail
« G », un entretien intitulé « Bilan après SECRET_HOSPITALISATION », des observations libres, une
note de suivi, des actions rattachées aux freins santé et judiciaire, un bilan de PMSMP, une
synthèse de compétences, un commentaire de sortie. Chaque valeur porte un marqueur `SECRET_…` :
l'absence n'est pas déduite de la forme du code, elle est **cherchée dans le JSONB relu en base**.

Le lot 5 a un dossier par type d'obligation (Pass IAE expiré, suspendu, proche, absent ; cumul CDDI
de 24 mois en deux contrats ; diagnostic absent, incomplet, complet ; référent non déterminé ;
catégorie G depuis 60 j ; questionnaire FSE+ manquant ; sortie FSE+ à J+16 et à J+26 ; **rupture
anticipée** — sortie d'opération à J-26 mais fin de contrat prévue à J-2 ; suivi +6 mois échu ; deux
semaines relevées sous 15 h).

---

## 2. Séquence de migration

### 2.1 Base existante (état PR B) — trois passes

```
node src/scripts/init-db.local.js     # passe 1 : exit 0, les 2 migrations PR C posées
node src/scripts/init-db.local.js     # passe 2 : exit 0
node src/scripts/init-db.local.js     # passe 3 : exit 0 (après toutes les suites)
```

`init-db.local.js` a été **régénérée** avant tout (commande `sed` documentée dans le fichier
d'environnement) : `init-db.js` a changé depuis la PR B.

### 2.2 Base NEUVE — séquence documentée (RECONSTRUCTION.md)

```
dropdb solidata_neuve ; createdb -O solidata_user solidata_neuve
node src/scripts/init-db.local.js     # exit 1 — ATTENDU : « relation "clients_exutoires" does not exist »
node src/scripts/migrate-exutoires.js # exit 0
node src/scripts/migrate-finance.js   # exit 0
node src/scripts/init-db.local.js     # exit 0
node src/scripts/init-db.local.js     # exit 0 (idempotence)
```

L'échec de la passe 1 est le **préexistant déjà documenté par la PR A** (13 § 2), sans rapport avec
la PR C. La base neuve compte 244 tables.

### 2.3 État du schéma vérifié (base migrée ET base neuve)

| Vérification | Résultat |
|---|---|
| `insertion_milestones.eti_token` / `eti_token_expires_at` / `eti_token_generated_by` | posées ✓ |
| Index UNIQUE **partiel** `uq_insertion_milestones_eti_token` | présent, et **prouvé** : deux entretiens sans jeton coexistent, deux entretiens au même jeton lèvent 23505 ✓ |
| `insertion_echeance_reports` + index + CHECK `motif` (5 codes) | ✓ (`motif` reste NULLABLE — le 1ᵉʳ report n'en exige pas) |
| Colonnes `employees.rappel_rdv_*` (5) + CHECK canal | ✓, et le CHECK refuse réellement une valeur hors liste (23514) |
| `insertion_documents_salarie` (CHECK type + mode de remise) | ✓ |
| `insertion_rappels_rdv` + **UNIQUE(milestone_id)** | ✓, et l'unicité est exercée (23505 sur doublon forcé) |
| Gabarits `message_templates` catégorie `insertion_rappel_rdv` | **exactement 2** (sms + email) après 3 passes ✓ |
| Entrée registre art. 30 « Insertion — rappels de rendez-vous » | **exactement 1** après 3 passes ✓ |
| Types du socle (`diagnostic-socle-champs.json`) vs colonnes réelles | les 15 colonnes existent avec le type attendu (date / booléen / texte / ARRAY) ✓ |
| Non-régression PR A + PR B | **180 vérifications vertes**, sous `TZ=UTC` **et** `TZ=Europe/Paris` ✓ |

---

## 3. Défauts trouvés

> Aucun n'a été corrigé. Chacun est décrit avec sa reproduction, sa cause et le correctif proposé.
> Les tests qui les reproduisent sont **rouges dans la suite** et portent le préfixe `DÉFAUT D-xx` :
> ils forment le filet de non-régression du correctif à venir.

### 3.0 La famille commune — un horodatage, trois lectures

`insertion_milestones.interview_date` est une colonne `TIMESTAMP **WITHOUT** TIME ZONE`. Ce qu'elle
contient est établi par le chemin d'écriture, pas par une convention écrite :

1. `frontend/src/components/insertion/EntretienForm.jsx:539` saisit la valeur avec
   `<input type="datetime-local">` — qui produit une chaîne **naïve** « 2026-09-16T14:00 », soit
   l'**heure murale de Paris** telle que la conseillère la lit sur sa montre ;
2. `routes/insertion/routes.js` l'écrit **telle quelle** (aucune conversion) ;
3. le même formulaire la relit par `String(form.interview_date).substring(0, 16)` et retrouve
   « 2026-09-16T14:00 » — le va-et-vient est cohérent **parce que** le conteneur tourne en UTC.

La valeur stockée est donc une **heure murale de Paris**. Or la PR C en fait **trois lectures
différentes**, dont deux la ré-interprètent comme un instant UTC et lui ajoutent l'offset :

| Lecteur | Traitement | Résultat pour 14:00 saisi (conteneur UTC, été) |
|---|---|---|
| `routes/insertion/routes.js:278` | `new Date(v).toISOString().slice(11,16)` | **14:00** ✓ (par coïncidence : le processus est en UTC) |
| `services/mon-parcours.js:213` `heureParis()` | `Intl(Europe/Paris)` sur l'objet | **16:00** ✗ |
| `services/rappels-rdv.js:174` `formaterRdv()` | idem | **16:00** ✗ (c'est le texte du SMS) |
| `services/rappels-rdv.js:161` (sélection) | `AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris'` | **jour décalé** au-delà de 22 h ✗ |

Aucune des trois n'est juste dans tous les fuseaux, et elles ne peuvent pas être justes ensemble.

---

### D-01 — **BLOQUANT** · le rappel annonce à la personne une heure fausse

**Où** : `backend/src/services/rappels-rdv.js:174` (`formaterRdv`) et
`backend/src/services/mon-parcours.js:213` (`heureParis`).

**Reproduction** (suite `pr-c-salarie`, `TZ=UTC`, c'est-à-dire la configuration de production) :
un entretien est planifié demain à **14:00** (valeur saisie par la conseillère, stockée telle
quelle). Le job de rappels part en `dry_run` et compose :

```
[NOTIFICATION] [DRY-RUN] sms → 06 12 34 56 78: Bonjour Rémi, rappel : vous avez
rendez-vous demain 14/09/2026 à 16:00 avec Jest…
```

Et « Mon parcours en une page », le document remis à la personne, porte
`prochain_rdv.heure = "16:00"`.

**Ce qui se passe** : le pilote construit l'objet `Date` d'un `timestamp without time zone` **dans le
fuseau du processus** (UTC en production) ; `Intl(Europe/Paris)` y ajoute ensuite deux heures l'été,
une l'hiver. Le décalage est donc **systématique**, sur **tous** les rendez-vous.

**Effet** : la seule fonctionnalité de la PR C qui parle **directement à la personne** lui donne un
horaire faux, et l'écart (deux heures) est exactement de nature à lui faire manquer le rendez-vous —
c'est-à-dire l'inverse de ce que le rappel sert à éviter. Le document qu'elle garde dans sa poche dit
la même chose. Sous `TZ=Europe/Paris`, le décalage s'inverse et c'est la file active qui ment
(`prochain_rdv.heure = "12:00"`, test rouge sous Paris).

**Correctif proposé** : ne PAS convertir. L'heure est déjà celle de Paris — la lire telle quelle,
côté SQL de préférence (`to_char(m.interview_date, 'HH24:MI') AS heure`), et faire de même dans
`routes.js:278`. Un helper unique `heureMurale(value)` dans `utils/date-iso.js`, consommé par les
trois lecteurs, évite que la question se repose. (Changer la CONVENTION de stockage — écrire un
instant UTC — est l'autre voie possible, mais elle exige de convertir les lignes existantes et de
toucher le formulaire : hors périmètre d'un correctif de PR.)

---

### D-02 — **MAJEUR** · le jeton du lien public ETI est servi en clair

**Où** : `backend/src/routes/insertion/routes.js:634` (`SELECT im.*`), `:4546` (`SELECT *`),
`:945` (`RETURNING *`) — et `routes/insertion/masking.js` qui ne le retire pas.

**Reproduction** (suite `pr-c-eti`, rouge sous les DEUX fuseaux) : on produit un lien ETI puis on
appelle trois surfaces authentifiées. Les trois rendent la ligne d'entretien entière :

```json
"conciliation_issue": null,
"eti_token": "dfd8b3d962e72c68f762b295f1b989ee",
"eti_token_expires_at": "2026-10-13T20:10:41.412Z"
```

- `GET /api/insertion/:employeeId` (bloc `milestones`) ;
- `GET /api/insertion/milestones/:employeeId` — **y compris pour un MANAGER** : `maskInsertionRow`
  lui retire bien le judiciaire, la santé et les questionnaires FSE+, mais pas le jeton ;
- `PUT /api/insertion/milestones/:id` (réponse `RETURNING *`).

**Pourquoi c'est grave** : ce jeton n'est pas une donnée, c'est un **identifiant de connexion**. Il
ouvre, **sans compte et pendant 60 jours**, un formulaire qui engage un renouvellement de contrat.
Le reste de la PR C le traite d'ailleurs comme tel : `POST …/lien-eti` n'inscrit au journal que son
**préfixe** (« un registre lisible par un administrateur deviendrait sinon un trousseau de liens
actifs », migration `insertion-echeances.js`), et `GET /renouvellements` prend soin de n'exposer que
le lien **dérivé**, et de le taire quand il est expiré. Ces précautions sont annulées par trois routes qui
rendent la ligne entière : le jeton traverse le réseau, s'inscrit dans l'historique du navigateur de
tout lecteur de la fiche, et peut être réexpédié par n'importe qui le voit.

**Correctif proposé** : ajouter `eti_token` (et, par prudence, `eti_token_generated_by`) à une liste
de champs retirés **pour tous les rôles** — pas à `MANAGER_HIDDEN_FIELDS`, qui ne vaut que pour le
MANAGER. Le plus sûr est une petite fonction `stripSecrets(row)` appliquée là où une ligne
d'entretien sort (les trois points ci-dessus), ou la substitution des `SELECT *` par une projection
explicite. `eti_token_expires_at` peut rester : c'est une échéance, pas une clé.

---

### D-03 — **MAJEUR** · un rendez-vous de fin de soirée ne reçoit aucun rappel

**Où** : `backend/src/services/rappels-rdv.js:161`.

```sql
AND ((m.interview_date AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date
    = ((NOW() AT TIME ZONE 'Europe/Paris')::date + INTERVAL '1 day')::date
```

**Reproduction** (rouge sous les DEUX fuseaux) : un entretien est planifié **demain à 23:30**
(heure murale de Paris). Le job rend `candidats: 0` — aucun rappel n'est envoyé, ni ce soir ni
jamais (le lendemain, la date est passée).

**Ce qui se passe** : la conversion traite la valeur naïve comme un instant UTC et lui ajoute deux
heures. 23:30 devient **01:30 le surlendemain** : le rendez-vous sort de la fenêtre « demain ».
Symétriquement, un rendez-vous de 23:30 **aujourd'hui** serait rappelé comme s'il avait lieu demain.
Le seuil est 22:00 en été, 23:00 en hiver.

**Correctif proposé** : comparer la date **naïve** telle qu'elle est, sans conversion —
`m.interview_date::date = ((NOW() AT TIME ZONE 'Europe/Paris')::date + 1)`. C'est le même correctif
que D-01 : le champ porte déjà l'heure de Paris.

---

### D-04 — **MOYEN (latent)** · les dates civiles de la file active sont rendues brutes

**Où** : `backend/src/routes/insertion/routes.js:235-239` — `e.insertion_start_date`,
`e.insertion_end_date`, `e.pass_iae_end` (et, préexistants, `e.contract_start`, `e.contract_end`).

**Reproduction** (rouge sous `TZ=Europe/Paris` uniquement) : `pass_iae_end` vaut `2027-07-10` en
base ; la réponse porte `"2027-07-09T22:00:00.000Z"`, et l'écran affiche la veille.

**Ce qui se passe** : le pilote construit une colonne `DATE` à **minuit local** ; `JSON.stringify`
la sérialise en UTC ; sous un décalage positif, la date recule d'un jour. C'est exactement le défaut
D-05 de la PR B, et `utils/date-iso.js` existe pour cela — la route l'emploie d'ailleurs pour
`prochain_rdv.date` et `dernier_entretien`, mais pas pour les trois champs qu'elle vient d'ajouter.

**Correctif proposé** : `isoDate()` sur les trois champs à la composition de la ligne (comme les deux
voisins). Les deux colonnes de contrat sont dans le même cas et méritent le même traitement.

---

### D-05 — **MINEUR (latent)** · « reporté jusqu'au » relu deux heures en arrière

**Où** : `backend/src/routes/insertion/echeances.js:156` (`NOW() + make_interval(hours => $3)`).

**Reproduction** (rouge sous `TZ=Europe/Paris` uniquement) : un report est posé ; la valeur relue
vaut `now + 46 h` au lieu de 48.

**Ce qui se passe** : la colonne est un `TIMESTAMP WITHOUT TIME ZONE` écrit en heure du **serveur**
PostgreSQL (UTC) et relu dans le fuseau du **processus**. La comparaison qui fait sortir la ligne des
obligations (`reporte_jusqu_au > NOW()`) est faite **en SQL** et reste juste : c'est l'**affichage**
de l'échéance qui ment, de deux heures.

**Correctif proposé** : `TIMESTAMPTZ` pour cette colonne (le geste porte sur un instant, pas sur un
jour civil), ou rendre `to_char(reporte_jusqu_au, 'YYYY-MM-DD"T"HH24:MI:SS')` sans conversion.

---

### D-06 — **MOYEN** · l'alerte de fiche et l'écran des échéances ne comptent pas la même sortie FSE+

**Où** : `backend/src/routes/insertion/routes.js:2296` (alerte de fiche, préexistante PR A) contre
`backend/src/services/echeances-cip.js:394` (moteur d'échéances, PR C).

**Reproduction** (rouge sous les DEUX fuseaux), sur **le même dossier** : une rupture anticipée —
sortie de l'opération ASI il y a **26 jours**, fin de contrat prévue il y a **2 jours**.

| Surface | Ce qu'elle dit |
|---|---|
| `GET /insertion/echeances` | « Sortie FSE+ non renseignée — **26 jours** », **rouge** |
| `GET /insertion/alertes/:id` (fiche) | **rien** (2 jours < 15) |

Et dans l'autre sens : un salarié **qui n'est rattaché à aucun projet cofinancé**, dont le contrat est
fini depuis 92 jours, ne reçoit aucune obligation dans l'écran des échéances (à juste titre) mais
**reçoit l'alerte « fse_sortie_a_saisir » sur sa fiche** — l'alerte de fiche ne vérifie pas la
participation.

**Ce qui se passe** : l'alerte de fiche date le délai depuis `employees.contract_end` ; le moteur
d'échéances le date depuis `insertion_projet_participants.date_sortie` (correctif « défaut D » de la
PR A : sur une rupture anticipée, compter depuis la fin de contrat prévue imprimait 12 jours pour 43
réels). Le moteur de la PR C a donc raison, et il laisse en place une seconde règle qui le contredit
à l'écran d'à côté. C'est exactement la famille de défauts que l'en-tête de `echeances-cip.js`
s'engage à ne plus produire (« deux implémentations d'une même règle »).

**Correctif proposé** : faire consommer à l'alerte de fiche la même fonction que l'écran (exporter un
`obligationsDuSalarie(employeeId)` depuis `echeances-cip.js`), ou au minimum aligner la source de la
date et ajouter la condition de participation ASI.

---

### D-07 — **MINEUR** · deux catégories d'action sur six n'ont pas de libellé

**Où** : `backend/src/services/mon-parcours.js:81` (`CATEGORIE_ACTION_LABELS`).

**Reproduction** (rouge sous les DEUX fuseaux) : le CHECK de `cip_action_plans.category` accepte six
valeurs ; le dictionnaire en couvre quatre. Manquent **`job_dating`** et **`formation`**.

**Effet** : dans « Mon parcours en une page », `engagements_structure` filtre les lignes dont le
libellé est nul — une action « formation » ou « job dating » **disparaît silencieusement** de ce que
la structure s'engage à faire, alors que c'est probablement l'engagement le plus concret qu'on puisse
montrer à la personne. Dans « Mon Récap », la même action se rabat sur un générique « Action
d'accompagnement ». Aucune fuite : une omission.

**Correctif proposé** : ajouter les deux entrées (`job_dating: 'Rencontre avec des employeurs'`,
`formation: 'Formation'`) et, pour que la question ne se repose pas, un test qui compare le
dictionnaire au CHECK (celui de cette suite peut être repris tel quel).

---

## 4. Contre-épreuves par mutation

Six mutations, chacune appliquée seule puis **restaurée immédiatement** (`git diff` vide après
chaque, § 7).

| # | Mutation | Effet observé |
|---|---|---|
| **M-1** | `typesPourRole` ne retire plus les familles sociales | **2 rouges** (V-31 périmètre MANAGER, V-41 cache par rôle) |
| **M-2** | le périmètre de la file active oublie les parcours terminés récents | **4 rouges** (V-04, D-04, V-22 sortie FSE+, V-24 suivi +6 mois) |
| **M-3** | la garde qui écarte les actions rattachées à un frein sensible quitte le SQL | **2 rouges** (V-71, V-72 — « SECRET_RDV_PSY » et « SECRET_SPIP » ressortent sur le document de la personne) |
| **M-4** | `rappel_rdv_consent = true` quitte le `WHERE` de la sélection | **4 rouges** (V-103, V-104, V-105, V-110 — le salarié sans accord devient candidat) |
| **M-5** | le journal de génération redevient best-effort (`try/catch`) | **1 rouge** (V-90 — un document est créé alors que sa trace a échoué) |
| **M-6** | la garde `locked_at` quitte le chargement par jeton | **1 rouge** (V-54 — un entretien clôturé redevient modifiable par le lien public) |

---

## 5. Ce qui est prouvé sur base réelle

**Lot 5 — échéances et file active (51 vérifications)**

- Périmètre : un **permanent** (`insertion_status = 'none'`) est absent ; un parcours **terminé
  depuis 3 mois** est présent **bien qu'inactif** ; un terminé depuis 9 mois est absent et revient
  avec `?inclure=tous` ; `?mine=1` borne aux salariés de la conseillère.
- `diagnostic_socle_complet` calculé en SQL colle au fichier partagé : vrai sur un diagnostic dont
  les 15 champs sont remplis, faux sur un diagnostic partiel, faux sans diagnostic.
- `risque` vient des **mêmes** obligations que l'écran (rouge / orange / null vérifiés).
- **`brsa` n'est pas LU pour un MANAGER** : l'espion posé sur le pool montre qu'aucune requête ne
  porte `e.brsa` (et non « la clé a été retirée après lecture »).
- Les **neuf types d'obligation** se déclenchent chacun sur son dossier, au bon niveau : Pass IAE
  expiré/suspendu → rouge, fin proche → orange, absent → orange ; cumul CDDI 24,9 mois → rouge ;
  diagnostic absent et socle incomplet → rouge avec deux libellés distincts ; référent non déterminé
  → rouge ; **catégorie G → orange, et aucune ligne `categorie_g` rouge n'existe** ; questionnaire
  FSE+ → orange ; sortie FSE+ J+16 → orange / J+26 → rouge ; suivi +6 mois → rouge ; **ligne
  agrégée « N salariés sous 15 h »** sans `employee_id`, avec son détail.
- La **rupture anticipée** est datée depuis la sortie de l'opération (26 j) et non depuis la fin de
  contrat (2 j).
- Tri rouge → orange puis échéance croissante ; `compteur_rouges` exact ; forme de ligne figée.
- MANAGER : aucun type social rendu **et aucune requête sociale émise** (ni `insertion_fse_sorties`,
  ni la participation ASI, ni `ft_categorie`) ; `rendez_vous_reguliers` à `null`.
- Report : 403 MANAGER **avant toute requête**, 400 type inconnu, 400 ligne agrégée, 404 salarié
  inconnu, 400 motif hors liste, 201 au premier sans motif (+ ligne en base + journal RGPD),
  409 `MOTIF_REQUIS` au second, 201 avec motif, **la ligne sort des obligations et du compteur**,
  **elle revient quand le report expire** avec `nb_reports = 2`.
- Compteur : égal à celui de l'écran, **cache par (rôle, utilisateur)** (ADMIN ≠ MANAGER, ADMIN =
  RH), **le second appel ne produit AUCUNE requête**, et un report vide le cache immédiatement.
- Une source en échec **vide son bloc et se nomme** dans `sources_indisponibles` sans faire tomber
  l'écran.

**Lot 5 — écran ETI à jeton (25 vérifications)**

- Jeton hex 32, échéance à +60 jours, journal ne portant que le **préfixe** ; régénérer **tue**
  l'ancien lien (404) ; 400 sur un entretien qui n'est pas un renouvellement ; 409 sur un entretien
  verrouillé (aucun jeton posé) ; 403 pour un MANAGER non encadrant, 201 pour l'encadrant.
- Charge publique : **exactement** les neuf clés du § 5.3, jamais `employee_id` ; 404 **uniforme**
  (jeton inconnu et jeton malformé rendent le même corps) ; 410 `LIEN_EXPIRE` ; 410
  `ENTRETIEN_CLOTURE` ; 404 sur toute autre adresse de `/api/eti`.
- Écriture : 400 `champs_refuses` **sans rien écrire**, les trois champs écrits, `validations`
  portant `{role:'eti', mode:'jeton', token_prefix}`, réponse `{ok:true}` et jamais la ligne,
  **snapshot** dans `insertion_milestones_history` avec `changed_by` NULL, journal à `user_id` NULL,
  400 sur avis hors liste et durée hors bornes, **aucune fuite de connexion sur 16 refus**.
- `GET /renouvellements` expose `lien_eti` **dérivé** et le tait quand il est expiré.
- L'anonymisation retire le jeton.

**Lot 7 — documents, consentement, rappels (53 vérifications)**

- Les **dix routes** refusent un MANAGER en 403 **avant toute requête**.
- L'aperçu ne crée rien ; les clés de premier niveau des deux documents sont **exactement** celles
  des § 5.6.1 et § 5.6.2.
- **Absence prouvée sur le JSONB STOCKÉ** : aucun des 12 motifs interdits, aucune des 11 valeurs
  `SECRET_…` semées dans le dossier — y compris le titre « Bilan après SECRET_HOSPITALISATION », les
  actions rattachées aux freins santé et judiciaire (**ligne entière**), la synthèse de compétences
  et le commentaire de sortie.
- Heures : dernière semaine **relevée** (26,5 h), `null` sans relevé, et **aucune occurrence** des
  mots « seuil », « 15 h », « alerte », « plancher », « objectif ».
- Le prochain rendez-vous ne nomme jamais le type d'entretien ; la conseillère est « Prénom N. » ;
  un référent « non déterminé » rend `null`.
- « Mon Récap » : libellés issus de dictionnaires fermés, moyenne de compétences (**N/E exclus**,
  6,0/10) sans les items, objectifs **comptés**, sortie traduite, **`sortie_type` hors dictionnaire
  → `null`**.
- Génération : ligne + journal ; **le journal est bloquant** (sonde en base : 500 et **aucun
  document créé**) ; la liste ne porte pas le contenu ; le document d'un autre salarié rend 404 ;
  remise tracée puis **409** à la seconde ; date future et mode inconnu refusés, le jour même
  accepté ; aucune fuite de connexion sur 12 refus.
- Consentement : état initial `null` (« jamais demandé »), contacts **masqués** (« 06 ** ** ** 78 »,
  « n***@st.fr ») et jamais en clair ; numéro invalide → 400 sans écriture ; accord → colonnes +
  `rgpd_consents` + journal (masqué) dans la même transaction ; **retrait** effaçant le contact ;
  CHECK de base opposable.
- Job : `dry_run` sans clé Brevo, trace au destinataire masqué, journal sans contact ni type
  d'entretien, **aucun doublon** au second passage (et 23505 sur insertion forcée), entretien réalisé
  ou personne sans accord → aucun candidat, réglage d'heure absent → **18 h et non 0**, déclenchement
  à l'heure **murale** de Paris été comme hiver, **gabarits ne nommant aucun type de rendez-vous**.
- Purge : > 365 j supprimée, récente conservée, déclenchement manuel **tracé à zéro ligne**,
  `GET /rgpd/purges` liste bien **10** purges avec la rétention de 365 j.
- Anonymisation d'un dossier complet : documents, rappels, reports, colonnes de consentement,
  entrée `rgpd_consents` et jeton ETI — **tous purgés**.

**Non-régression** : `tests/e2e-pr-a` + `tests/e2e-pr-b` = **180 vérifications vertes** sur la base
PR C, sous les deux fuseaux. Suite complète **sans base** : **243 suites / 4 898 tests verts**,
11 suites ignorées (dont les 3 de la PR C).

---

## 6. Limites et constats

**O-01 — deux horloges cohabitent dans le moteur d'échéances.** Les obligations sont datées en JS
avec `aujourdhuiParis()` ; le périmètre de la cohorte (`CURRENT_DATE - make_interval`), les bilans en
retard et le suivi à +6 mois le sont par `CURRENT_DATE`, c'est-à-dire par le fuseau de la **session
PostgreSQL**. Les deux coïncident tant que le serveur tourne en UTC **et** qu'on est hors de la
tranche 22 h → minuit UTC (minuit → 2 h à Paris) : dans cette tranche, un dossier peut être « à J+15 »
pour l'un et « à J+14 » pour l'autre. Aucune conséquence mesurée en exploitation courante (la CIP ne
travaille pas à 1 h du matin), mais la dépendance est réelle et démontrée par une vérification qui
rejoue le calcul sur une session décalée (V-15bis). Correctif possible : `(NOW() AT TIME ZONE
'Europe/Paris')::date` partout où `CURRENT_DATE` est employé pour un jour civil.

**O-02 — « Entretien de conciliation » est écrit tel quel sur « Mon Récap ».** Le libellé vient bien
d'une liste **fermée**, donc conforme au § 5.6.2 ; mais ce document est fait pour **circuler** (la
personne peut le remettre à un employeur), et « conciliation (protection des droits) » comme « Point
avec le référent » disent quelque chose de sa situation. Le constat est porté ici ; l'arbitrage
appartient à la direction et à la revue de sécurité, pas au debug. Une piste : regrouper ces deux
types sous « Entretien d'accompagnement » dans le seul `TYPE_ENTRETIEN_LABELS` du récapitulatif.

**O-03 — un parcours « terminé » sans `insertion_end_date` sort de tout.** Le périmètre de la file
active exige `insertion_end_date IS NOT NULL` : un dossier clos sans date de fin n'apparaît ni dans
la file, ni dans les échéances — donc sa sortie FSE+ et son relevé à +6 mois ne sont jamais réclamés.
La clôture par bilan de sortie pose bien la date, le cas est donc théorique ; il mérite néanmoins
d'être connu (une correction de statut à la main suffit à le produire).

**O-04 — la trace de remise d'un document ne survit pas à l'anonymisation.** Le commentaire de
`services/anonymization.js` justifie la purge des documents en disant que « la ligne correspondante
du registre RGPD (`INSERTION_DOC_SALARIE_REMISE`) » subsiste. Elle subsiste en effet — mais elle
porte `entity_id = employee_id`, et rien n'indique dans le registre que le dossier a été anonymisé.
Constat, pas défaut : la preuve reste lisible.

**Ce qui n'a pas été éprouvé** : le front (aucune page n'a été montée — c'est le périmètre des lots
et de la revue) ; l'envoi Brevo RÉEL (la clé est absente, le job part en `dry_run` — c'est d'ailleurs
la seule façon honnête de l'éprouver ici) ; la charge (les requêtes de `composerEcheances` sont
groupées par cohorte, mais aucune mesure n'a été faite au-delà d'une vingtaine de dossiers) ;
`GET /insertion/echeances` avec une cohorte réelle de plusieurs centaines de salariés.

---

## 7. État final

```
$ git status --short
?? backend/tests/e2e-pr-c/

$ git diff --stat -- . ':!backend/tests/e2e-pr-c'
(vide)
```

Aucun fichier source modifié : les six mutations de contre-épreuve ont été restaurées une à une.
`init-db.local.js` est une copie de travail ignorée par git. La sonde `probe_ko_docsal` posée en base
a été retirée — vérifié : `0` contrainte `probe_%` restante.

### Commandes exactes pour rejouer

```bash
source <scratchpad>/db-test.env

cd /home/user/solidata.online
sed -e 's/GEOMETRY(Point, 4326)/TEXT/g' -e 's/USING GIST\s*(\(geom[a-z_]*\))/(\1)/Ig' \
    backend/src/scripts/init-db.js > backend/src/scripts/init-db.local.js

cd backend
node src/scripts/init-db.local.js && node src/scripts/init-db.local.js     # idempotence

PR_C_E2E_DB=1 npx jest tests/e2e-pr-c --runInBand                  # 121 vertes / 8 rouges
TZ=Europe/Paris PR_C_E2E_DB=1 npx jest tests/e2e-pr-c --runInBand  # 120 vertes / 9 rouges
PR_A_E2E_DB=1 npx jest tests/e2e-pr-a tests/e2e-pr-b --runInBand   # 180 vertes
npx jest                                                           # 243 suites / 4 898 verts
```

---

## 8. Synthèse pour l'agent de correctifs

| # | Gravité | Fichier:ligne | En une ligne |
|---|---|---|---|
| **D-01** | **BLOQUANT** | `services/rappels-rdv.js:174`, `services/mon-parcours.js:213` | Le SMS et le document remis à la personne annoncent **16 h** pour un rendez-vous saisi à **14 h** |
| **D-02** | **MAJEUR** | `routes/insertion/routes.js:634, 4546, 945` | Le **jeton du lien public ETI** (60 j, sans compte) est servi en clair par trois surfaces, MANAGER compris |
| **D-03** | **MAJEUR** | `services/rappels-rdv.js:161` | Un rendez-vous après 22 h ne reçoit **aucun** rappel (conversion de fuseau sur une heure murale) |
| **D-04** | MOYEN (latent) | `routes/insertion/routes.js:235-239` | Les trois dates civiles ajoutées à la file active reculent d'un jour hors UTC |
| **D-05** | MINEUR (latent) | `routes/insertion/echeances.js:156` | « Reporté jusqu'au » s'affiche deux heures trop tôt hors UTC (le calcul, lui, reste juste) |
| **D-06** | MOYEN | `routes/insertion/routes.js:2296` vs `services/echeances-cip.js:394` | Deux règles pour la sortie FSE+ : la fiche se tait quand l'écran alerte, et alerte sur des non-participants |
| **D-07** | MINEUR | `services/mon-parcours.js:81` | Deux catégories d'action sur six sans libellé → un engagement de la structure disparaît du document de la personne |

**D-01 et D-03 sont le même correctif** : ne pas convertir une heure qui est déjà celle de Paris.
Un helper `heureMurale()` dans `utils/date-iso.js` et la comparaison de date faite sur la valeur
naïve règlent les deux, et D-04/D-05 relèvent de la même discipline de dates que la PR B a déjà
posée (`isoDate` à la sortie, `TIMESTAMPTZ` pour un instant).

---

*Agent de debug PostgreSQL — PR C. Fichiers écrits : `backend/tests/e2e-pr-c/_helpers.js`,
`backend/tests/e2e-pr-c/pr-c-echeances-e2e.test.js`, `backend/tests/e2e-pr-c/pr-c-eti-e2e.test.js`,
`backend/tests/e2e-pr-c/pr-c-salarie-e2e.test.js`, `rapports/cip-refonte-2026-09-12/23-debug-postgres-PR-C.md`.
Aucun autre.*

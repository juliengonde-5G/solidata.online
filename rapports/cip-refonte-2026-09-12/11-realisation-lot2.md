# PR A « Conformité immédiate » — Réalisation du LOT 2 « FSE+ »

> Agent du lot 2, 13/09/2026. Contrats : `10-contrats-techniques-PR-A.md` (§ 1 colonne 2, § 3 DDL lot 2,
> § 6.2 API, § 6.4 les trois retouches de `routes.js`, § 7 frontend, § 8 tests).
> Colonnes de l'export dictées par `09-matrice-reporting-autorite.md` § 2 (a) et (b).
> Maquettes : `Diagnostic_FSE`, `Fiche_Suivi_Cloture`, `Dossiers_FSE`, `Dossier_Complet` / `Dossier_Vide`.

---

## 1. Ce qui est livré

### 1.1 Schéma (`backend/src/scripts/migrations/insertion-fse.js`)
DDL du § 3 reproduite **à l'identique** : `insertion_projets` (+ seed des DEUX projets décidés le 12/09 :
`ASI-2026-2027` et `OCS-CIP-2026-2027`, `ON CONFLICT (code) DO NOTHING`), `insertion_projet_participants`
(+ 2 index), `insertion_projet_postes`, `insertion_fse_sorties`, les 4 colonnes d'entretien
(`duree_minutes`, `presence`, `absence_motif`, `absence_piece_ref`), les 2 colonnes de diagnostic
(`fse_entree_saisie_at`, `fse_entree_complet`), le CHECK `alert_type` reconstruit par DO-scan
`pg_constraint` (les 4 nouveaux types **plus les 6 historiques**), et l'entrée `rgpd_registre`
« Cofinancement FSE+ — suivi des participants » gardée par `NOT EXISTS … ILIKE`.

Deux ajouts au-delà de la DDL littérale, tous deux idempotents et argumentés dans le fichier :
les CHECK de `presence` et d'`absence_motif` sont posés par **DO-scan** plutôt que sur la colonne —
une liste de valeurs métier doit rester élargissable sans toucher à la colonne ; et deux index sur
`insertion_projet_participants` (la vue transversale lit par projet, la fiche par salarié).

### 1.2 Module PUR (`backend/src/utils/fse-schema.js`)
`FSE_ENTREE_ITEMS` (5 obligatoires + commentaire), `FSE_SORTIE_ITEMS`, `valider`, `completude`,
`suggestionsEntree`, `libelleValeur`. Aucune E/S.

Trois décisions à connaître :
- **Une clé inconnue est une ERREUR**, pas un champ ignoré. Un item ajouté à l'écran sans l'être au
  schéma doit se voir tout de suite : sinon la réponse part dans le JSONB et disparaît de l'export
  sans que personne ne le sache — exactement le défaut que cette PR ferme.
- **Les réponses héritées sont converties, pas refusées** (`moins_6_mois` → `lt_6m`, etc.). Les
  diagnostics saisis avant la PR A portent les libellés de l'ancien formulaire libre : les rejeter
  rendrait inenregistrable un dossier déjà rempli.
- **Jamais de suggestion sans source lisible.** Chaque proposition porte la phrase affichée à l'écran
  (« proposé depuis « Logement : hébergé chez un tiers » »). `duree_sans_emploi` n'a **aucune**
  suggestion : le diagnostic ne porte pas de date de dernier emploi, et fabriquer une durée à partir
  de l'âge serait une valeur inventée dans une pièce d'audit.

### 1.3 Service (`backend/src/services/fse-participants.js`)
`enregistrerSortie`, `enregistrerSixMois`, `dossierConformite`, `conformiteProjet`,
`chargerContextes` / `composerPieces` (composition PURE, testable seule), `bornesPeriode`,
`situationDepuisClassification`, `checkFseSortiesNonRenseignees` (signature
`async () => ({ crees, verifies })`, à enregistrer par le lot 0).

Quatre choix structurants :
- **Une seule ligne de sortie par parcours** (`UNIQUE(employee_id, parcours_num)`). La saisie sans
  bilan et la clôture d'un bilan de sortie écrivent la MÊME ligne : jamais deux vérités concurrentes.
- **`saisie_at` ne recule ni n'avance** : l'upsert garde le PLUS ANCIEN horodatage
  (`LEAST(...)`). Si une sortie recueillie à J+10 sans bilan voyait son horodatage repoussé à J+60
  par la clôture tardive du bilan, la structure s'accuserait d'un retard qu'elle n'a pas eu — or le
  « délai de saisie » est la colonne que l'autorité regarde en premier.
- **« sans objet » ≠ « manquant »** : une pièce de sortie n'est pas en retard pour un parcours en
  cours. Peindre ces lignes en rouge noierait les vraies alertes dans du faux positif.
- **Le contexte se charge par ENSEMBLE** (6 requêtes `= ANY($1::int[])` quel que soit le nombre de
  participants) : la vue par projet compose plusieurs dizaines de dossiers, une boucle ferait 6×N
  allers-retours sur un écran ouvert tous les matins.

### 1.4 API
| Route | Rôles | État |
|---|---|---|
| `GET/POST/PUT /insertion/projets` (+ `nb_participants`) | lecture module, écriture ADMIN/RH | livré, 409 `CODE_DUPLIQUE` |
| `GET/POST/PUT/DELETE /insertion/projets/:id/participants[/:pid]` | lecture module, écriture ADMIN/RH | livré, journal `INSERTION_PROJET_PARTICIPANT`, 409 `RATTACHEMENT_DUPLIQUE` |
| `GET/PUT /insertion/projets/:id/postes` | ADMIN/RH | livré, remplacement complet transactionnel |
| `GET /insertion/fse/:employeeId` | **ADMIN/RH** | livré (projets, entrée + complétude + suggestions, sortie + `delai_saisie_jours`, six mois + échéance, `participant_asi`, référentiel) |
| `POST /insertion/fse/:employeeId/sortie` | ADMIN/RH | livré, 400 hors schéma, journal |
| `POST /insertion/fse/:employeeId/six-mois` | ADMIN/RH | livré, 409 `SORTIE_ABSENTE`, journal |
| `GET /insertion/conformite/:employeeId` | ADMIN/RH | livré, 9 pièces dans l'ordre |
| `GET /insertion/conformite?projet=&periode=` | ADMIN/RH | livré, 400 `PROJET_REQUIS` |
| `GET /api/exports/fse-plus` | ADMIN/RH + MFA | livré, **29 colonnes**, 409 `EXPORT_VIDE`, journal avant envoi |
| `GET /api/exports/fse-plus/bilan` | ADMIN/RH + MFA | livré, 8 sections non nominatives |

**`GET /insertion/fse/:id` est ADMIN/RH strict, y compris en lecture** (le contrat le prévoyait) : le
questionnaire d'entrée porte la composition du foyer, la stabilité du logement et la nature des
ressources — des statuts sociaux, rangés par l'organisation (08 § 10) au même niveau que BRSA. Le
MANAGER voit qu'un dossier est incomplet, jamais ce qu'il contient.

### 1.5 Les trois retouches de `routes.js` — et rien d'autre
1. **`PUT /diagnostic/:employeeId`** : `fse_entree` validé (400 `{error, erreurs}` en nommant l'item),
   normalisé, `fse_entree_complet` **recalculé côté serveur** (jamais reçu du client : une complétude
   déclarée par l'écran est invérifiable), `fse_entree_saisie_at` posé la fois où la complétude passe
   à vrai et **jamais repoussé** (`COALESCE(insertion_diagnostics.fse_entree_saisie_at, NOW())`).
   Le PUT **et** le GET renvoient `suggestions_fse` et `fse_completude`.
2. **`PUT /milestones/:id` et `POST /:id/close`** : les 4 champs de durée et d'assiduité acceptés et
   validés ; la clôture les écrit en `COALESCE` (un champ non transmis garde sa valeur) ; à la
   clôture d'un `bilan_sortie` **classé**, `enregistrerSortie` est appelé **dans la transaction de
   clôture**. Un questionnaire FSE+ hors schéma est signalé comme un **problème de clôture**
   (`fse_sortie_invalide`, ancré sur l'étape « Sortie & documents ») et non à l'écriture : découvert
   après le verrouillage, il serait irréparable sans réouverture.
3. **`GET /alertes/:employeeId`** : `fse_entree_manquante`, `fse_sortie_a_saisir`,
   `referent_non_determine`, `suivi_6mois_echu` — toutes en requêtes `soft` (une colonne du lot 1
   absente retire l'alerte, elle ne casse pas l'écran).

### 1.6 Export (`backend/src/routes/exports-fse.js`)
Les **29 colonnes de 09 § 2 (a)**, dans l'ordre, une par item, en français, **jamais de JSON dans une
cellule** ; 5 lignes d'en-tête `#` portant les 7 éléments exigés (export, généré le, généré par,
périmètre, nombre de lignes, version de l'outil, mention « les saisies officielles … font foi`) ;
CSV `;` + BOM ; nom `fse-participants_<code>_<AAAA>_T<n>.csv`. **409 `EXPORT_VIDE`** avant toute
écriture. **Journal `EXPORT_FSE_PLUS` écrit AVANT l'envoi** — prouvé par mutation : si le journal
échoue, l'export échoue et aucun nom ne sort.

`GET /fse-plus/bilan` rend les 8 sections imposées (identification, participants, indicateurs
d'entrée item par item, sorties **avec la ligne « sortie non renseignée »**, +6 mois **avec la ligne
« non relevée »**, complétude **par pièce**, moyens, méthode écrite en toutes lettres).

### 1.7 Frontend
- **`DiagnosticForm.jsx`** — rubrique FSE+ (position inchangée, la réorganisation en socle est PR C) :
  chips de réponse, **5ᵉ item `ressources_principales` ajouté**, ligne « proposé depuis « … » » avec
  **Confirmer / Corriger** quand une suggestion existe et que la réponse est vide, compteur `n/5`,
  avertissement « fausse déclaration », **rail rouge** si la personne est participante ASI et la
  rubrique incomplète (`participant_asi` lu sur `GET /insertion/fse/:id` ; un 403 encadrant est
  silencieux, ce n'est pas une erreur). Les valeurs héritées sont normalisées **à l'affichage** :
  un dossier déjà rempli ne paraît pas vide.
- **`EntretienForm.jsx`** — fenêtre de clôture de la maquette 7 : chips **15/30/45/60/90/autre** avec
  défaut par type, chips **présence**, motif d'absence **facultatif** (liste fermée, jamais la nature
  médicale) et référence de pièce ; étape « Sortie & documents » : bloc **« Sortie FSE+ »**
  (situation, type de contrat, commentaire) écrit dans `fse_sortie`.
- **`DossierConformite.jsx`** — colonne des 9 pièces, 4 états colorés, lien « Compléter » vers le
  champ manquant (`onNaviguer(lien)`), état d'erreur **visible** (un dossier de conformité muet se
  lirait comme un dossier complet).
- **`FseSortieForm.jsx`** — modale « sortie sans bilan » et « relevé +6 mois ».
- **`DossiersFSE.jsx`** — la maquette : sélecteur projet/période, 4 `KPICard`, tableau
  participants × 9 pièces (tri « incomplets d'abord », une case rouge « Sortie » ou « +6 mois »
  **ouvre directement le formulaire**), boutons « Export FSE+ (CSV) » (blob, 409 affiché en toast
  avec son motif) et « Bilan d'exécution (JSON) », bloc OCS (postes, quotités, taux forfaitaire).
  Composants partagés uniquement, aucun `alert()`, icônes lucide-react.

---

## 2. Preuves

| Preuve | Résultat |
|---|---|
| `cd backend && npx jest` | **220 suites / 4 359 tests verts**, 0 échec (2 suites `skipped` préexistantes) |
| `backend/tests/unit/utils/fse-schema.test.js` | 20 tests |
| `backend/tests/unit/services/fse-participants.test.js` | 24 tests (9 pièces × états, upsert, alertes J+15/J+25 anti-doublon) |
| `backend/tests/contract/fse-plus-contract.test.js` | 39 tests (29 colonnes, 409 vide, journal, rôles, diagnostic, clôture, alertes, garde d'idempotence de la migration) |
| Tests existants du module | `insertion-contract` 95/95, `insertion-isolation` + `notes-suivi` + `note-profil` 41/41 — **aucune adaptation nécessaire**, mes retouches n'ont cassé aucun contrat existant |
| `cd frontend && npx vite build` | vert |

**Quatre contre-épreuves par mutation**, toutes restaurées :
1. remplacer `saisie_at = LEAST(...)` par `= EXCLUDED.saisie_at` → 1 test tombe ;
2. neutraliser le refus « zéro ligne » de l'export → 1 test tombe ;
3. retirer `authorize('ADMIN','RH')` de `fse.js` → 1 test tombe (3 assertions de rôle) ;
4. neutraliser la validation du questionnaire au `PUT /diagnostic` → 2 tests tombent.

---

## 3. Écarts assumés, et pourquoi

1. **Pas de colonne d'heures dans l'export (a), et c'est voulu.** La consigne demandait de corriger la
   requête d'heures fautive de l'ancien export (`SUM(EXTRACT(EPOCH FROM (end_time - start_time)))` sur
   `work_hours`, table qui n'a **ni `start_time` ni `end_time`** — l'erreur était avalée par un
   `.catch(() => ({rows:[]}))` et la colonne affichait 0 pour tout le monde). Or les **29 colonnes
   dictées par 09 § 2 (a) ne comportent aucune colonne d'heures** (elles ont migré vers l'export (d)
   « Semaines sous 15 h » et vers la feuille de temps (c)), et la spécification de l'autorité « prime
   sur toute interprétation ultérieure ». Ajouter une 30ᵉ colonne aurait cassé le contrat.
   **Le calcul corrigé est donc livré dans le bilan (b) § 7 « Moyens »** (`heures_activite_participants`) :
   `SUM(work_hours.hours_worked)` sur les types `normal` + `training` (une absence n'est pas du temps
   d'activité), **avec repli sur `employee_week_hours.hours_worked`** pour les périodes sans saisie
   journalière, `null` et **jamais 0** quand rien n'est enregistré, et la **source nommée** dans la
   réponse. La requête fautive disparaît avec l'ancienne route (retirée par le lot 0).
2. **`situation_6mois` n'a pas de valeur « injoignable »** alors que 09 § 2 (a) colonne 27 la nomme.
   La DDL du § 3, à reproduire à l'identique, réutilise l'énumération des situations de sortie qui ne
   la contient pas. L'écran propose donc « Non renseignée » pour ce cas (et le dit : « si la personne
   est injoignable, choisissez « Non renseignée » : le relevé aura été fait »). **À arbitrer** :
   ajouter `injoignable` au CHECK (`insertion_milestones.post_sortie_situation` la porte déjà).
3. **`insertion.duree_entretien_defaut` n'est pas encore servi par `GET /insertion/parametres`.**
   Cette route vit dans `routes.js`, où seules les 3 retouches du § 6.4 sont autorisées, et
   `components/insertion/parametres.js` n'appartient à aucun lot. `EntretienForm` applique donc le
   **défaut du § 4 en dur** (valeurs identiques au réglage serveur) et consommera
   `parametres.duree_entretien_defaut` **dès que la clé sera exposée** (le code la lit déjà et ne
   remplace le défaut local que si le serveur renvoie un objet non vide). **Une ligne à ajouter** dans
   `routes.js` (`readInsertionSetting('insertion.duree_entretien_defaut')`) et une clé dans
   `PARAMETRES_DEFAUTS`.
4. **Colonne 10 « Critères d'éligibilité IAE » : codes du référentiel uniquement.** Le texte libre
   hérité (`employees.eligibilite_criteres`) n'y est pas versé — l'autorité demande « des codes issus
   du référentiel », et mélanger « RSA + QPV selon dossier » à des codes rendrait la colonne
   inimportable. Le texte libre reste visible dans le dossier administratif, et le dossier de
   conformité le compte comme « partiel » tant qu'il n'est pas typé.
5. **Colonne 11 « BRSA » écrit « Non renseigné » en toutes lettres**, seule exception à la règle
   « cellule vide » — elle est **dictée** par 09 § 2 (a) : l'absence de constat y est elle-même une
   information de gestion.
6. **Le paramètre `projet` de l'export est facultatif** : à défaut, l'unique opération ASI active fait
   foi. `InsertionParcours.jsx` (fichier du lot 1) appelle encore `/exports/fse-plus?annee=&trimestre=`
   sans projet ; le refuser en 400 aurait cassé ce bouton. En cas d'ambiguïté (plusieurs opérations
   actives), l'export refuse en **nommant les candidats** plutôt que d'en choisir un.
7. **Dépendance assumée aux colonnes du lot 1** (`brsa`, `ft_categorie`, `referent_unique_type`,
   `pass_iae_statut`, `eligibilite_verifiee_le`, table `employee_eligibilite`). `insertion-cadre` est
   jouée **avant** `insertion-fse` dans la même transaction d'init-db : la dépendance est tenue au
   déploiement. Un défaut de migration se voit alors **loudly** (500 + `hint` « base non à jour »)
   plutôt que de produire un dossier faussement complet ou un export privé de sa colonne 10.

---

## 4. Ce qui reste (hors périmètre du lot 2)

- **Lot 0** : enregistrer `checkFseSortiesNonRenseignees` (exportée par `services/fse-participants.js`)
  dans `runAllJobs` via `runInstrumented` + `JOB_SCHEDULE` (daily) ; retirer l'ancienne route
  `/fse-plus` de `routes/exports.js` ; fournir les libellés RGPD des 4 codes que ce lot emploie
  (`EXPORT_FSE_PLUS`, `INSERTION_FSE_SORTIE_SAISIE`, `INSERTION_FSE_SIX_MOIS_SAISIE`,
  `INSERTION_PROJET_PARTICIPANT`) — **la garde anti-dérive des libellés échouera tant qu'ils manquent**.
- **Lot 1** : importer `DossierConformite` dans `DossierAdministratif.jsx` en lui passant `onNaviguer`
  (conventions de `lien` : `dossier#eligibilite`, `dossier#pass-iae`, `dossier#referent`,
  `dossier#fse-sortie`, `dossier#six-mois`, `diagnostic#fse`, `diagnostic`, `suivi`) ; ajouter la
  section « Projets cofinancés » d'`AdminInsertion.jsx` sur `/insertion/projets` (+ postes/quotités) ;
  **conserver `insertion_fse_sorties` et `insertion_projet_participants` à l'anonymisation**
  (piste d'audit ≥ 5 ans — c'est écrit dans l'entrée de registre posée par ma migration).
- **PR B** : feuille de temps par intervenant (le bilan d'exécution annonce aujourd'hui
  « non comptabilisable », jamais un zéro) ; **PR C** : remontée de la rubrique FSE+ en 7ᵉ position du
  socle à 7 rubriques.

---

## 5. Ce que le format MDFSE+ définitif obligera à ajuster

Les questions exactes de Ma Démarche FSE+ ne sont pas publiées (09 § 1.4 F6 : « items définitifs à
confirmer sur la plateforme »). Le schéma a été conçu pour que cette confirmation coûte peu :

1. **Ajouter un item** = ajouter une entrée à `FSE_ENTREE_ITEMS` (`{cle, libelle, type, obligatoire,
   valeurs, labels}`). La validation, la complétude (`n/5` devient `n/6`), la distribution du bilan
   et l'écran du diagnostic suivent **sans autre modification** : ils itèrent tous sur la liste.
2. **Ce qui ne suit PAS tout seul, et qu'il faudra reprendre à la main** : les **29 colonnes de
   l'export** sont figées dans l'ordre dicté par l'autorité (`COLONNES` de `exports-fse.js`) — un
   nouvel item y appelle une colonne à la position que l'autorité indiquera, et la liste de 29 devra
   être renégociée avec elle. C'est délibéré : cette liste est un contrat, pas une projection
   automatique du schéma.
3. **« Niveau d'instruction » (colonne 18) n'est pas un item du questionnaire** : il est servi par
   `insertion_diagnostics.niveau_formation` (nomenclature infra3 → niv6plus). Si MDFSE+ demande sa
   propre nomenclature, il faudra soit une table de correspondance, soit un item dédié — et dans les
   deux cas **ne pas recopier** la valeur, pour éviter deux vérités qui divergent.
4. **Les valeurs d'énumération** (`lt_6m`, `cdd_6m_plus`…) sont internes et jamais affichées : seuls
   les libellés français partent à l'écran et à l'export. Un changement de découpage de la plateforme
   (par exemple « 12-23 mois » au lieu de « 12-24 mois ») se traite par un **alias** comme ceux déjà
   posés pour les réponses héritées : aucune donnée existante n'est perdue.
5. **Si l'opération OCS est déclarée avec participants** (à confirmer, 09 § 2 (a) *in fine*), les
   colonnes 16 à 29 s'y appliquent à l'identique : rien à changer, le sélecteur de projet de l'écran
   « Dossiers FSE+ » accepte déjà les deux opérations.

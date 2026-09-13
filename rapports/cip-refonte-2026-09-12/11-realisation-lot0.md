# PR A — Lot 0 « Correctifs » : rapport de réalisation

> Agent « correctifs », 13 septembre 2026.
> Contrat : `10-contrats-techniques-PR-A.md` § 1 (colonne 0), § 4 (réglages), § 5 (codes RGPD), § 6.3, § 8.
> Contexte : plan 07 § 3 (lot 0) et § 9 ; reconnaissance 03 § 5 et § 9.

---

## 1. Ce qui est fait

### 1.1 `backend/src/routes/exports.js`

**(a) L'ancienne route `GET /fse-plus` est SUPPRIMÉE.** Elle n'est pas réécrite ici : le lot 2 la reprend
dans `routes/exports-fse.js`, monté sur `/api/exports` **avant** ce routeur. Un bloc de commentaire prend sa
place et dit pourquoi elle partait — elle sommait
`EXTRACT(EPOCH FROM (end_time - start_time))` sur `work_hours`, table qui ne porte pas ces colonnes ; l'erreur
était avalée par un `.catch(() => ({ rows: [] }))`, si bien que **l'export sortait vide sans que rien ne le
dise** — et pourquoi elle ne doit pas être recréée ici (deux routes du même chemin dans deux fichiers = la
version réparée masquée au premier changement d'ordre de montage).

**(b) `GET /insertion` — journal RGPD avant envoi.** Nouvelle fonction `logExportInsertionComplet` (calquée
sur `logExportFreins`, même format d'entrée) : action **`EXPORT_INSERTION_COMPLET`**, `entity_type`
`insertion`, `details = { format, dataset, lignes, requested_by }`. Écrite **avant** l'envoi du fichier sur
les deux voies (Excel et CSV) ; un journal en échec fait échouer l'export — jamais de fichier nominatif non
tracé.

**(c) En-tête de traçabilité.**
- Excel : la feuille `Informations` (première du classeur) porte désormais **Généré le** (horodatage en heure
  de Paris), **Générateur** (nom lisible, jamais l'e-mail), **Périmètre** (phrase explicite), **Lignes
  (total)** puis le détail par feuille, plus une ligne **Traçabilité** qui annonce la journalisation.
- CSV : lignes `#` en tête (export, jeu de données, généré le, générateur, périmètre, lignes,
  confidentialité), suivies d'une ligne vide puis de la ligne de colonnes — le fichier reste importable.

**(d) 0 ligne → 409 `EXPORT_VIDE`.** Deux cas, tous deux motivés en français avec un `hint` :
aucun salarié dans le périmètre (quel que soit le format), et jeu de données CSV demandé mais vide (le
message **nomme** le jeu de données). Le refus intervient **avant** la journalisation : rien n'est sorti,
il n'y a rien à tracer.

**(e) Plus aucun `catch` silencieux.** Le helper `soft()` est remplacé par `lire()`, qui **décore l'erreur du
nom du jeu de données** et la laisse remonter : une erreur SQL rend un **500 explicite** (« Erreur lors de la
génération de l'export (jeu de données « Diagnostics CIP ») »). Le « repli minimal » sur une requête
`salaries-min` disparaît avec lui : il n'existait que pour survivre au `soft`, et il transformait une panne en
liste partielle silencieuse.

### 1.2 `backend/src/routes/employees.js` — `PUT /:id`
Huit champs de conformité IAE ajoutés à la liste `allowed` : `pass_iae_number`, `pass_iae_start`,
`pass_iae_end`, `eligibilite_criteres`, `eligibilite_justificatifs_ref`, `france_travail_id`,
`cddi_derogation_motif`, `cddi_derogation_date`. Les trois dates rejoignent `dateFields` (chaîne vide → NULL).
Le motif de dérogation est validé contre la liste fermée des 4 motifs légaux **avant** la construction du SET :
un motif hors liste rend un **400 en français avec la liste des valeurs acceptées**, au lieu du 500 issu d'une
violation du `CHECK` PostgreSQL, que l'écran ne saurait pas traduire. Une valeur vide vaut « pas de
dérogation » → NULL.
*Les colonnes existaient déjà en base (init-db `(g)`) : c'est bien une surface d'écriture qui manquait, pas un
schéma.*

### 1.3 `backend/src/services/scheduler.js`
- **`createPostSortieFollowups`** : échéance = date du bilan de sortie **+ `insertion.post_sortie_mois`**
  (défaut 6, borné [1 ; 12]) ; titre **« Suivi post-sortie (+N mois) »** — un dossier archivé doit dire à
  quelle échéance le suivi était attendu sans qu'on relise le réglage du jour ; fenêtre de création
  **[N−1 ; N+4] mois** après la sortie, exprimée en **mois calendaires paramétrés**
  (`make_interval(months => $1)`, jamais d'intervalle concaténé) et non plus en « 80 jours → 7 mois » ;
  idempotence inchangée (`NOT EXISTS` + absorption du 23505). Retourne `{ crees, verifies }`.
- **`checkFseSortiesNonRenseignees`** : enveloppe locale avec **`require` paresseux et gardé** de
  `services/fse-participants` (lot 2, écrit en parallèle). Module absent ou fonction non encore exportée →
  `console.warn` et `{ crees: 0, verifies: 0 }`, **jamais une exception** : un module manquant ne doit pas
  arrêter la chaîne entière (alertes d'entretien, purges RGPD, sauvegardes). Enregistrée dans `runAllJobs` via
  `runInstrumented`, juste après le suivi post-sortie, et exportée avec `createPostSortieFollowups`.
  *Vérifié après coup : le lot 2 a livré le module, la fonction est bien résolue.*

### 1.4 `backend/src/routes/monitoring.js`
`JOB_SCHEDULE` : libellé de `createPostSortieFollowups` corrigé en **« Suivis post-sortie (+6 mois) »**, et
ajout de `checkFseSortiesNonRenseignees` (« Sorties FSE+ non renseignées (J+15/J+25) », `3×/jour`, tolérance
`DAILY` — identique aux jobs quotidiens voisins).

### 1.5 `backend/src/utils/insertion-settings.js`
Quatre clés du § 4, documentées en tête avec leur **raison d'être** :
`insertion.post_sortie_mois` (6), `insertion.alerte_sortie_fse_j1` (15), `insertion.alerte_sortie_fse_j2` (25),
`insertion.duree_entretien_defaut` (JSON, 6 types).
Deux ajouts techniques nécessaires :
- `readInsertionSetting` sait désormais lire un **défaut de type objet** (JSON en base, repli sur le défaut si
  le JSON est illisible — jamais un objet vide, qui ferait disparaître toute proposition de durée à l'écran) ;
- `readPostSortieMois()` exporté : lecture **bornée [1 ; 12]**. Le bornage vit à côté du défaut plutôt que chez
  l'appelant — une valeur aberrante en base poserait un **rendez-vous daté** dans le dossier d'un salarié, ce
  n'est pas une statistique qu'on corrige après coup.

### 1.6 `frontend/src/utils/rgpd-libelles.js`
Les **10 codes du § 5** ajoutés avec leurs libellés (exports FSE+ et insertion complet ; dossier administratif
consultation/modification ; pièces dépôt/consultation/suppression ; sortie FSE+, relevé +6 mois, rattachement
à un projet). La garde anti-dérive `tests/unit/rgpd-audit-libelles.test.js` reste verte — elle scanne le code
backend autour de chaque `INSERT INTO rgpd_audit_log` (et les fonctions locales recevant `action` en
paramètre) et exige un libellé pour chaque code trouvé : les lots 1 et 2 disposent donc de leurs libellés
**avant** d'écrire leurs routes.

### 1.7 Documentation
- **`docs/GUIDE_CIP_INSERTION.md`** — **échelle des freins corrigée** (elle était inversée : « 1 très bloquant
  → 5 résolu ») au glossaire, **et surtout au cas 2, là où elle se saisit** (un glossaire en fin de guide ne
  protège pas d'une saisie inversée au moment du diagnostic) : encart « 1 = pas de difficulté, 5 = bloquant »,
  avec la correspondance des couleurs, le sens de la flèche ↗ et la mention que les versions précédentes
  étaient fausses. FAQ n° 5 reformulée sur le même point. Section 19 réécrite : le volet RSE n'est plus « une
  mission séparée » mais un **module livré** (Pilotage RSE), avec la précision qui compte — c'est la structure
  qui est labellisée, jamais le logiciel, et le module ne manipule que des agrégats non nominatifs.
- **`docs/GUIDE_UTILISATEUR.md`** — **§ 4.4 « Parcours Insertion » entièrement réécrite** sur la base de
  `DOCUMENTATION_APPLICATIVE` § 2.3.4 : 9 freins (et non 7), 6 types d'entretiens (et non les jalons fixes
  M1/M6/M12), échéances calées sur le contrat réel, parcours ouvert automatiquement, « enregistrer ≠ clôturer »,
  échelle des freins **dans le bon sens** avec encart dédié, « non évalué » honnête, chiffrement art. 9/10 et
  masquage MANAGER, suivi post-sortie **à 6 mois**, alertes acquittées en base, pilotage et cibles « objectif
  non paramétré », exports et leur traçabilité. **Double numérotation 4.4 corrigée** (Planning hebdo → 4.5,
  note de profil → 4.6). Note de révision ajoutée en tête, qui borne ce qui a été relu.
- **`docs/NOTE_CERTIFICATEURS_INSERTION.md`** — promesses alignées sur le réalisé, **écarts signalés plutôt
  qu'effacés** (encart de révision en tête) :
  - *journalisation des exports* : la note affirmait que « chaque export nominatif est journalisé » alors que
    **deux sur quatre ne l'étaient pas**. Le § 3 le dit, et énonce les trois règles désormais tenues (journal
    avant envoi, en-tête de traçabilité, refus motivé d'un export vide) ; ligne 19 du tableau « jour J » mise
    à jour ;
  - *durée des entretiens et heures d'accompagnement* : la note les donnait pour acquises. Corrigé en état
    exact — durée enregistrée **pour les actions**, en cours de mise en place **pour les entretiens** (lot 2),
    **agrégat non livré et non revendiqué** (PR B) ; ligne 6 du tableau alignée ;
  - *scan de l'exemplaire signé* : présenté comme « une possibilité », c'est le lot 1. La **doctrine de dépôt**
    est écrite : seules les pièces dont la structure est seule dépositaire, **jamais les justificatifs
    d'éligibilité** (ils vivent sur les Emplois de l'inclusion, l'ERP en garde la référence), stockage en base
    servi authentifié, consultation journalisée, purge à l'anonymisation ;
  - *suivi post-sortie* : « +3 mois (fenêtre 3-6) » → **+6 mois**, en § 2, § 6 et ligne 15 du tableau, avec la
    raison (c'est le délai de l'indicateur de résultat) ;
  - *dossier administratif* : § 2 enrichi (critères typés et datés, statut du Pass IAE, orienteur / prescripteur
    / référent unique distingués, statuts sociaux réservés ADMIN/RH, bloc de report structuré sans API) ;
    ligne 3 du tableau alignée ;
  - *FSE+* (§ 7.5) : l'export était **défectueux** (colonnes inexistantes, erreur absorbée, fichier vide) — dit
    tel quel, puis ce que la reprise apporte ; les libellés exacts MDFSE+ restent **à confirmer auprès de
    l'autorité de gestion** ;
  - *RSEi* (§ 6 et § 7.7) : module livré, non « mission séparée » ; calendrier et pied de page mis à jour.

### 1.8 Tests
- **`backend/tests/contract/exports-journalisation-contract.test.js`** (18 tests, `pg` simulé, auth réelle) :
  journal écrit avec les bons paramètres ; **preuve d'ordre** que le journal précède l'envoi (aucune requête
  après lui dans la séquence) ; journal en échec → 500 et aucun contenu envoyé ; format Excel journalisé avec
  le total des 4 feuilles ; 409 `EXPORT_VIDE` (Excel, CSV, jeu de données nommé) **sans journal** ; jeu de
  données inconnu qui retombe sur « Salariés » ; en-tête CSV (`#` + générateur + périmètre + lignes) et en-tête
  Excel **relu depuis le classeur réellement produit** (feuille `Informations` en première position, ordre des
  5 feuilles, comptes justes) ; erreur SQL → 500 **nommant** le jeu de données ; `/fse-plus` absent de ce
  routeur (404) ; MANAGER refusé. S'y ajoute le contrat `PUT /employees/:id` (6 tests) : les 8 champs écrits,
  motif de dérogation hors liste → 400, motif vidé → NULL, date vidée → NULL, MANAGER → 403.
- **`backend/tests/unit/services/scheduler-post-sortie.test.js`** (13 tests) : défaut 6 en code ; échéance
  sortie + 6 mois et titre « (+6 mois) » ; réglage à 9 mois suivi par le délai **et** le titre ; valeurs
  aberrantes (`0`, `240`, `-3`, `six`) → repli sur 6 ; fenêtre `[5 ; 10]` passée en **paramètres** de
  `make_interval` ; fenêtre qui suit le réglage (`3` → `[2 ; 7]`) ; idempotence (aucun candidat, `NOT EXISTS`
  dans le SQL, 23505 absorbé, vraie erreur SQL journalisée sans casser la chaîne) ; enveloppe FSE+ exportée,
  saut annoncé si le module du lot 2 manque, et déclaration dans `JOB_SCHEDULE`.

---

## 2. Preuves

| Preuve | Résultat |
|---|---|
| `cd backend && npx jest --silent` (suite **intégrale**) | **216 suites / 4 233 tests verts, 0 échec** (base avant lot : 212 / 4 159) |
| `cd frontend && npx vite build` | vert (15,1 s) |
| Garde anti-dérive `rgpd-audit-libelles` | verte (les 10 codes du § 5 présents) |
| Contre-épreuve 1 — journal retiré de la voie CSV de `/exports/insertion` | **4 tests tombent** (dont la preuve d'ordre et l'échec de journal) ; restaurée |
| Contre-épreuve 2 — délai post-sortie figé à 3 mois | **4 tests tombent** (défaut, réglage, valeurs aberrantes, fenêtre) ; restaurée |
| Intégration lot 0 ↔ lot 2 | `services/fse-participants.js` livré entre-temps : le `require` paresseux résout bien `checkFseSortiesNonRenseignees` |

Aucun test préexistant n'a été cassé : aucune suite n'asseyait le délai de 3 mois ni n'exerçait
`/exports/insertion` ou `/fse-plus` (vérifié par recherche avant modification). **Rien à adapter.**

---

## 3. Écarts et choix à signaler

1. **`extractItemsProcessed` non modifié.** `createPostSortieFollowups` et le job FSE+ rendent `{ crees,
   verifies }`, clés que l'extracteur de `job_runs` ne reconnaît pas : `items_processed` restera `null` pour
   ces deux jobs dans la supervision. Ajouter `crees` à la liste reconnue changerait aussi la valeur affichée
   pour d'autres jobs (`pennylane` compose un bilan qui porte cette clé) — hors périmètre du lot, et `null`
   reste honnête. **À arbitrer par l'orchestrateur** si la supervision doit afficher ces compteurs.
2. **409 `EXPORT_VIDE` posé AVANT la journalisation.** Choix délibéré : un export refusé n'a rien fait sortir,
   il n'y a donc rien à tracer. Doctrine volontairement différente de l'export des freins, qui journalise même
   à 0 ligne — mais lui ENVOIE le fichier. Si l'orchestrateur préfère tracer aussi les tentatives infructueuses
   (« preuve qu'une vérification a eu lieu », comme les purges RGPD de la 2.44.0), c'est une ligne à déplacer
   et un test à inverser.
3. **Le « repli minimal » de la feuille Salariés a disparu** avec le `soft()`. C'était la contrepartie
   demandée (« une erreur SQL = 500 explicite ») : sur une base non migrée, l'export échouera bruyamment au
   lieu de rendre une liste amputée. C'est le comportement voulu, mais c'est un changement visible en
   production si une base traîne un schéma ancien.
4. **`GUIDE_UTILISATEUR.md` ne mentionne le volet RSE nulle part** (vérifié : zéro occurrence). Il n'y avait
   donc aucune mention « mission séparée » à y retirer ; la correction ne concernait que le guide CIP et la
   note aux certificateurs. Corollaire : **le module 28 « Pilotage RSE » n'est documenté dans aucune section
   du guide utilisateur**, pas plus que plusieurs modules récents (Effectifs ETP, Temps & Présence, Messagerie,
   Enquêtes, Achats responsables, Énergie & GES). Ce guide est globalement en retard d'une dizaine de modules —
   chantier du lot 8, hors périmètre ici ; la note de révision que j'ai ajoutée en tête **borne explicitement**
   ce qui a été relu, pour ne pas laisser croire que le reste l'a été.
5. **`CLAUDE.md` § 9** porte le même vocabulaire obsolète (7 freins, jalons M1/M6/M12) — fichier de
   l'orchestrateur, non touché. Signalé pour son passage d'intégration.
6. **Durée des entretiens** : la note aux certificateurs annonce désormais le champ « en cours de mise en
   place » (lot 2) et l'agrégat « non revendiqué » (PR B). Si le lot 2 ne livrait finalement pas
   `duree_minutes` sur `insertion_milestones`, cette phrase serait à reprendre.

---

## 4. Ce qui reste (hors lot 0)

- Export FSE+ réparé, questionnaires typés, alertes J+15/J+25, dossier de conformité → **lot 2**.
- Dossier administratif (éligibilité, Pass IAE, référent unique, pièces) → **lot 1**.
- Agrégat d'heures d'accompagnement et feuille de temps par projet → **PR B (lot 4)**.
- Mise à jour de `CLAUDE.md` § 9 et de `DOCUMENTATION_APPLICATIVE` → **orchestrateur**.
- Guide utilisateur : les modules livrés depuis mars 2026 n'y figurent pas → **lot 8 (PR D)**.

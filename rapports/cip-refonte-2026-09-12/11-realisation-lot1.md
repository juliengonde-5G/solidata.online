# PR A — Lot 1 « Dossier administratif » — rapport de réalisation

> Agent « cadre », 13/09/2026. Contrats de référence : `10-contrats-techniques-PR-A.md`
> (§ 1 colonne 1, § 3 DDL lot 1, § 5 codes RGPD, § 6.1 API, § 7 frontend, § 8 tests).
> Maquettes suivies : `maquettes/captures/Dossier_Complet.jpg`, `Dossier_Vide.jpg`, `Fiche_Situation.jpg`.
> Aucune commande git, aucun `npm install`. Aucun fichier hors de la colonne du lot n'a été modifié.

---

## 1. Ce qui est fait

### 1.1 Schéma — `backend/src/scripts/migrations/insertion-cadre.js`
`run(client)` idempotent, sans transaction interne (init-db.js l'appelle dans la sienne), reproduisant
le DDL du § 3 **à l'identique** :

| Objet | Détail |
|---|---|
| `insertion_eligibilite_criteres` | référentiel administrable + **seed des 14 critères** en requêtes PARAMÉTRÉES `ON CONFLICT (code) DO NOTHING` (les libellés portent des apostrophes typographiques : les interpoler serait à la fois fragile et une mauvaise habitude) |
| `employee_eligibilite` | `UNIQUE(employee_id, critere_code)`, cascade salarié, index sur `employee_id` |
| `employees` (15 colonnes) | `brsa`, `brsa_date_constat`, `ft_categorie`, `ft_categorie_date`, `orienteur_type/_nom`, `referent_unique_type/_nom/_contact`, `actualisation_ft_requise/_derniere_date/_rappels_non_honores`, `pass_iae_statut`, `eligibilite_verifiee_le`, `eligibilite_source` |
| 5 CHECK | posés par **DO-scan `pg_constraint`** (ft_categorie, orienteur_type, referent_unique_type, pass_iae_statut, eligibilite_source) — chacun tolère NULL |
| `insertion_pass_iae_evenements` | suspension / prolongation / autre, index employé |
| `insertion_pieces` | BYTEA + sha256, CHECK mime (3 valeurs), CHECK taille ≤ 5 Mo, **CHECK type SANS justificatif d'éligibilité** |
| `etp_asp_mensuel.nb_brsa` | INTEGER |
| `cip_action_plans.category` | CHECK **reconstruit** (`pg_get_constraintdef` → DROP + ADD) pour ajouter `job_dating` et `formation` **en gardant les 4 valeurs historiques** ; la reconstruction ne se déclenche que si la contrainte ne couvre pas déjà `job_dating` (rejouer ne verrouille pas la table pour rien) |
| `insertion_partenaires` | seed « Centre médico-social (CMS) — Département 76 » catégorie `social` |
| `rgpd_registre` | entrée art. 30 **distincte** (autres données, autres destinataires, autre base légale), gardée par `WHERE NOT EXISTS … ILIKE 'Dossier administratif d''insertion%'` |

### 1.2 Module pur — `backend/src/utils/pass-iae.js`
`calculerStatutPassIae({numero, debut, fin, evenements, today})` : les 5 règles du § 6.1 **dans leur ordre**
(l'ordre est load-bearing : un Pass expiré dont une suspension traîne reste `expire`, une suspension en
cours prime sur une prolongation passée). Comparaisons sur des **jours civils en chaîne** — indépendantes
du fuseau du conteneur (UTC) alors que la structure vit à Paris, et insensibles à l'heure (un Pass qui
finit « le 14/03 » court tout le 14/03). Une date de fin ABSENTE ne fait jamais expirer ; une fin de
suspension absente vaut « toujours en cours » (l'erreur coûteuse est dans l'autre sens).

### 1.3 API — 3 routeurs
- **`eligibilite.js`** — `GET /` (A/RH/M, actifs ET inactifs : une fiche ancienne peut porter un critère
  depuis désactivé), `POST /` + `PUT /:code` **ADMIN**. Le CODE n'est jamais modifiable (clé étrangère des
  constats déjà enregistrés) ; un critère se désactive, il ne se supprime pas.
- **`cadre.js`** — `GET`/`PUT /:employeeId`, `POST`/`DELETE .../pass-iae/evenements`,
  `POST .../actualisation-ft`. Forme de réponse conforme au § 6.1.
  - **Projection MANAGER** : `statuts`, `pieces` et `bloc_emplois_inclusion` sont **retirés de l'objet**
    (déstructuration), pas nullifiés — une clé à `null` dirait déjà « il y a un statut social ici ».
  - **Statut du Pass recalculé et PERSISTÉ** à chaque lecture et chaque écriture : la colonne
    `pass_iae_statut` n'est qu'un cache pour les listes, les filtres et les alertes, et le jour passe sans
    que personne n'ait rien saisi.
  - **Le client ne peut pas dicter le statut** : `pass_iae.statut` envoyé dans un PUT est ignoré.
  - Journal `INSERTION_CADRE_CONSULTATION` (ADMIN/RH, une ligne par appel) et
    `INSERTION_CADRE_MODIFICATION` (**liste des champs**, jamais leurs valeurs).
  - Validation des listes fermées → **400 avant toute écriture** ; un critère inconnu → 400 + ROLLBACK.
  - `projets` lu depuis `insertion_projet_participants` (lot 2) → `[]` sur 42P01, jamais 500.
  - `rqth` est **en lecture seule** depuis le diagnostic : deux saisies divergeraient.
  - Bloc « Emplois de l'inclusion » : gabarit **exact** du § 6.1, `non renseigné` pour tout champ absent
    (sur un formulaire officiel, un blanc se lit comme un oubli de l'agent).
- **`pieces.js`** — les 4 routes en **ADMIN/RH strict**. Multer mémoire ≤ 5 Mo, **type vérifié par les
  octets d'en-tête** (`%PDF-`, `FFD8FF`, signature PNG) et non par le MIME déclaré, BYTEA + sha256,
  service `Content-Type` stocké + `nosniff` + `no-store` + `Content-Disposition: inline` avec nom de
  fichier **assaini** (un guillemet ou un retour ligne dans `originalname` casserait l'en-tête).
  Dépôt / consultation / suppression journalisés. **Liste fermée de 4 types, sans justificatif
  d'éligibilité** — et l'écran le dit.

### 1.4 RGPD — `services/anonymization.js`
- **SUPPRESSION** de `insertion_pieces`, `insertion_pass_iae_evenements`, `employee_eligibilite`
  (la liste des critères est le portrait social le plus condensé du dossier ; les motifs de suspension
  portent couramment un arrêt maladie ; les pièces sont des IMAGES sur lesquelles aucun masquage par
  champ ne peut rien).
- **NULL** sur `orienteur_nom`, `referent_unique_nom`, `referent_unique_contact` (données de TIERS, même
  doctrine que les contacts d'urgence), `brsa_date_constat`, `ft_categorie_date`.
- **CONSERVÉ** : `brsa`, `ft_categorie`, `orienteur_type`, `referent_unique_type`, `eligibilite_source`,
  `pass_iae_statut` (catégoriels non nominatifs, typologies de cohorte) **et**
  `insertion_fse_sorties` / `insertion_projet_participants` (piste d'audit FSE+ ≥ 5 ans) — documenté
  dans le code.
- Le bloc est sous **SAVEPOINT** (doctrine 2.50.0 C-07) : sur une base où la migration PR A n'est pas
  passée, une table absente avorterait sinon toute la transaction (25P02) et la promesse « on ne fait pas
  échouer toute l'anonymisation » serait fausse.

### 1.5 ASP — `nb_brsa` n'est plus jeté
`services/asp-parser.js` **n'avait rien à corriger** : `parseAspText` lit déjà « Dont BRSA » et l'expose
dans `entetes.nb_brsa` (ligne 144). C'est `routes/effectifs.js` qui le jetait : la valeur est désormais
écrite dans `etp_asp_mensuel.nb_brsa` à l'import confirmé (INSERT + branche ON CONFLICT), et exposée dans
`GET /asp/comparaison` sous `nb_brsa_asp`, **en regard de `nb_brsa_solidata`** (compte `employees.brsa =
true` parmi les personnes couvertes du mois). Requête `soft()` : sur une base non migrée la colonne est
absente et la comparaison affiche « — » plutôt que de casser la page. `brsa = true` STRICT : un statut non
renseigné n'est jamais compté comme « non BRSA » — et si aucun statut n'est renseigné, `nb_brsa_solidata`
vaut `null`, jamais 0.

### 1.6 Frontend
- **`DossierAdministratif.jsx`** — les 6 sections de la maquette + `PiecesPanel`, colonne droite
  `<DossierConformite>` (lot 2) rendue collante, **un bouton « Enregistrer » par section** (corps PARTIEL :
  un formulaire qui n'affiche pas les statuts ne peut pas les effacer par omission). Chips de critères,
  date / source / référence, bloc à copier avec `navigator.clipboard` **et repli visible** (le texte est
  `select-all` et un message dit quoi faire quand le presse-papiers est refusé — jamais un bouton inerte).
  « Référent unique non déterminé » en rouge avec sa consigne. Projets cofinancés en lecture avec lien
  vers `/admin/insertion`. Dérogation CDDI. Aucun `alert()`, aucun `window.confirm`, icônes lucide-react.
- **`PassIaePanel.jsx`** — numéro / début / fin éditables, **statut en lecture seule** avec sa mention
  (« Calculé d'après les dates et les événements »), tableau des événements (une fin absente s'affiche
  « en cours », pas « — »), « + Événement », « Bilan de prolongation (PDF) » (route existante).
- **`PiecesPanel.jsx`** — dépôt (type + fichier), liste, consultation en **blob** (le jeton ne voyage pas
  dans un `src=`, `revokeObjectURL` différé de 60 s), suppression confirmée. Mention explicite : les
  justificatifs d'éligibilité ne se déposent pas ici, et chaque consultation est journalisée.
- **`InsertionParcours.jsx`** — onglet **« Dossier administratif » après « Diagnostic »** (les 7 onglets
  existants restent, la fusion en 4 est PR C) ; en-tête : badge Pass IAE **par statut** (teal actif/prolongé,
  ambre suspendu, rouge expiré, gris inconnu), badges `BRSA` (rendu seulement si le serveur renvoie la clé
  `statuts` — aucune garde de rôle recopiée côté client), `Projet <code>` par rattachement,
  `Référent unique : …` rouge si non déterminé. `GET /insertion/cadre/:id` chargé avec la fiche, **échec
  affiché dans un bandeau** (un en-tête muet ferait croire qu'il n'y a ni Pass, ni BRSA, ni référent).
  Sonde IA **retirée** de l'onglet Assistant IA, avec un renvoi explicite vers les réglages.
  `onNaviguer` câblé : « Compléter » du dossier de conformité ouvre le bon onglet.
- **`AdminInsertion.jsx`** — réécrit : **un seul « Enregistrer »** pour les 10 paramètres (validation de
  TOUTES les valeurs avant la première écriture : un lot à moitié enregistré serait pire qu'un refus),
  dont `post_sortie_mois`, `alerte_sortie_fse_j1`, `alerte_sortie_fse_j2` ; section « Critères
  d'éligibilité IAE » (liste, activer/désactiver, ajouter) ; section « Projets cofinancés » + postes et
  quotités (API du lot 2, **404 → état « indisponible » propre** pendant le développement parallèle) ;
  partenaires (catégorie `social` ajoutée à la liste — sans elle le CMS seedé s'afficherait « aucune
  catégorie ») ; grilles de compétences ; **sonde IA déplacée ici**. `Modal` / `ConfirmDialog` /
  `FormField` / `Section` / `useToast` partout ; plus aucun `alert()` ni `window.confirm`.

---

## 2. Preuves

| Preuve | Résultat |
|---|---|
| `cd backend && npx jest --silent` | **219 suites / 4 320 tests verts**, 0 échec (44 skipped préexistants, 2 suites e2e opt-in) |
| `tests/contract/insertion-cadre-contract.test.js` | **38 tests** — matrice de rôles, projection MANAGER (clés ABSENTES), refus MANAGER sans aucune écriture, statut recalculé + persisté, journalisation, 7 cas de liste fermée en 400, critère inconnu → ROLLBACK, événements, bloc de report (gabarit exact + « non renseigné »), pièces (PDF accepté / HTML déguisé refusé / type hors liste refusé / no-store + nosniff / nom hostile inoffensif / suppression journalisée), résilience 42P01 |
| `tests/unit/utils/pass-iae.test.js` | **18 tests** — 6 cas du contrat, ordre de priorité, bornes de jour, objets `Date` de pg, entrées illisibles |
| `tests/unit/scripts/insertion-cadre-migration.test.js` | **21 tests** — analyse textuelle (IF NOT EXISTS sur chaque CREATE/ALTER/INDEX, DO-scan, seeds gardés, registre gardé, `brsa` nullable sans défaut) **et exécution simulée** de `run(client)` (14 seeds paramétrés dans l'ordre, 5 DO-scan + 1 reconstruction, aucune transaction interne, aucune interpolation de valeur) |
| `tests/unit/services/anonymization.test.js` | **+5 tests** (20 au total) — effacement des noms et dates, conservation des catégoriels, DELETE des 3 tables du lot 1, **non-suppression** des 2 tables FSE+, SAVEPOINT posé et relâché |
| `cd frontend && npx vite build` | **vert** |

**3 contre-épreuves par mutation, toutes restaurées :**

| Mutation | Effet |
|---|---|
| `projeterPourManager` renvoie le dossier entier | 1 test tombe (les 3 clés interdites apparaissent) |
| repli sur `f.mimetype` quand les octets ne reconnaissent rien | 1 test tombe (le HTML déguisé en PDF est accepté) |
| le journal de modification embarque `req.body` | 1 test tombe (l'identifiant France Travail et le nom du référent se retrouvent dans la trace) |

La **garde anti-dérive des libellés RGPD** (`tests/unit/rgpd-audit-libelles.test.js`) est verte : les
5 codes du lot (`INSERTION_CADRE_CONSULTATION/MODIFICATION`, `INSERTION_PIECE_DEPOT/CONSULTATION/
SUPPRESSION`) ont bien leur libellé, fournis par le lot 0.

---

## 3. Écarts et décisions assumées

1. **`pieces` figure dans la réponse de `GET /cadre/:id`** (métadonnées seulement, jamais le contenu).
   Le § 6.1 ne le listait pas dans la forme de la réponse mais exigeait que la clé soit ABSENTE pour un
   MANAGER : sans la clé, l'exigence n'aurait rien à tester. Le front s'en sert comme liste initiale de
   `PiecesPanel`, qui recharge ensuite par `GET /pieces/:employeeId` après chaque mutation.
2. **Bloc « Emplois de l'inclusion »** — le gabarit du § 6.1 (avec `(<type>)` du prescripteur et
   `· Statut : <statut>`) prime sur la maquette, qui en montrait une version plus courte. Séparateur des
   critères : ` ; `, comme la maquette. Les **libellés** des critères sont utilisés, pas les codes.
3. **`nb_brsa_solidata`** n'était pas demandé explicitement (le plan 07 § 1.6 parle de « rapprocher avec
   le compte BRSA de l'outil ») : ajouté, car exposer `nb_brsa_asp` seul n'explique aucun écart.
4. **`services/asp-parser.js` non modifié** — il lisait déjà `nb_brsa` correctement ; le défaut était
   entièrement côté `effectifs.js`.
5. **`components/insertion/freins.js` non modifié** : ce fichier n'appartient à aucune colonne. Les
   libellés propres au dossier administratif (orienteur, référent, catégories FT, dérogation) vivent donc
   dans `DossierAdministratif.jsx`, et les libellés/couleurs de statut du Pass sont exportés par
   `PassIaePanel.jsx` (source unique consommée par l'en-tête de `InsertionParcours.jsx`).
6. **`REFERENT_UNIQUE_LABELS`** est défini localement dans `InsertionParcours.jsx` pour le badge d'en-tête :
   il duplique la liste de `DossierAdministratif.jsx`. À fusionner dans un module partagé quand la PR C
   réorganisera `components/insertion/` (un fichier `dossier.js` serait le bon endroit).

---

## 4. Ce qui reste (hors périmètre du lot)

- **Lot 0** : les 3 nouvelles clés de réglages (`post_sortie_mois`, `alerte_sortie_fse_j1/j2`) ne sont pas
  exposées par `GET /insertion/parametres` ; `AdminInsertion.jsx` les lit par son repli `/settings`, donc
  l'écran fonctionne — mais les ajouter à `/parametres` éviterait un aller-retour.
- **Lot 2** : `GET /insertion/projets`, `/projets/:id/postes` et `/conformite/:employeeId` sont consommés
  par mes écrans. Tant qu'ils répondent 404, la section « Projets cofinancés » affiche un état
  « indisponible » et la colonne de conformité reste vide (constaté vert à l'écriture de ce rapport :
  les trois routes sont déjà livrées).
- **Rattachement d'un salarié à un projet depuis sa fiche** : le contrat place l'écriture dans les
  réglages (§ 7), la fiche est en lecture. Le bouton « Rattacher à un projet » de la maquette renvoie donc
  vers `/admin/insertion` ; si la direction veut le rattachement depuis la fiche, c'est une évolution du
  lot 2 (`POST /projets/:id/participants` existe déjà).
- **Alertes** : `referent_non_determine`, `fse_entree_manquante`, `fse_sortie_a_saisir` sont des retouches
  de `GET /alertes/:employeeId` attribuées au lot 2 (§ 6.4).
- **Recette sur PostgreSQL réel** : la migration a été prouvée par analyse textuelle et exécution simulée
  (aucune base n'était disponible dans cet environnement). L'agent de debug du chantier doit la rejouer
  **deux fois** sur une base neuve puis sur une base existante, et vérifier en particulier la
  reconstruction du CHECK de `cip_action_plans` sur une base portant déjà des lignes des 4 catégories
  historiques.

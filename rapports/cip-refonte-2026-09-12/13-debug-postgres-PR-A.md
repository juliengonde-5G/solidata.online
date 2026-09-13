# PR A « Conformité immédiate » — recette sur PostgreSQL réel, défauts trouvés et corrigés

> **Agent de debug et de preuve sur base réelle** — chantier `cip-refonte-2026-09-12`,
> branche `claude/solidata-cip-redesign-9fskwq`.
> **Mandat** : rejouer les migrations sur base neuve ET sur base peuplée, exercer les
> routeurs RÉELS de la PR A à travers une vraie chaîne Express sur un vrai PostgreSQL,
> corriger à la source tout défaut trouvé, et prouver chaque correctif par contre-épreuve.
> **Références** : contrats `10-contrats-techniques-PR-A.md` (+ amendement « injoignable »),
> règles d'export dictées par l'autorité `09-matrice-reporting-autorite.md` § 2 (a),
> rapports de lot `11-realisation-lot0/1/2.md` (§ « ce qui reste »).
> **Date** : 13 septembre 2026.

---

## 0. Verdict en cinq lignes

La PR A **tient** : le schéma est conforme au § 3 du contrat au champ près, les migrations sont
idempotentes sur base neuve comme sur base peuplée, et les 81 vérifications de bout en bout passent.

**Cinq défauts ont été trouvés, dont un BLOQUANT** : le dossier administratif fuyait une connexion
de pool à chaque refus métier — vingt formulaires mal remplis figeaient **toute l'application**.
Les quatre autres touchent la **fidélité du reporting** (un délai de saisie qui ne correspond pas à la
règle dictée, un seuil d'alerte décalé d'un jour) et la robustesse. Tous sont **reproduits, corrigés,
et re-prouvés par mutation**.

Ce rapport ne traite PAS les trois constats bloquants de la revue de sécurité
(`12-revue-securite-PR-A.md`, C-01 à C-03) : ils relèvent d'un autre lot, leurs tests de reproduction
sont verts sur la branche, et les corriger ici les aurait invalidés sans coordination. § 6.

---

## 1. Environnement de la recette

| Élément | Valeur |
|---|---|
| Moteur | PostgreSQL **16.13** (Ubuntu 16.13-0ubuntu0.24.04.1), **sans PostGIS** |
| Base | `solidata_test`, propriétaire `solidata_user`, recréée à vide pour la recette finale |
| Script d'initialisation | `backend/src/scripts/init-db.local.js` — **copie** d'`init-db.js` où `GEOMETRY(Point, 4326)` devient `TEXT` et l'index GiST un index btree (la machine de recette n'a pas PostGIS). Regénérée par `sed` avant chaque campagne ; le fichier est ignoré par git |
| Node | v22.22.2 · backend `package.json` version 1.0.0 |
| Chaîne exercée | vrais routeurs Express (`routes/insertion`, `routes/exports-fse`, `routes/exports`), vrai `config/database.js`, vrai `middleware/auth` + `middleware/mfa`, JWT signés avec le `JWT_SECRET` de l'environnement, requêtes par `supertest` |
| Tables après initialisation | **230** |

**Ce qui est délibérément simulé, et rien d'autre** : `middleware/activity-logger` (il écrit dans une
table hors périmètre — même convention que les suites de contrat du dépôt). Le journal RGPD,
lui, n'est **jamais** simulé : toutes les assertions de journalisation lisent `rgpd_audit_log` en base.

### Pourquoi ces suites existent

Les suites de `tests/contract/` montent les vrais routeurs mais sur un `pg` **simulé** : le mock rend
des lignes quelle que soit la validité du SQL, et ne connaît ni les CHECK, ni les UNIQUE, ni les
types, ni le pool. **Quatre des cinq défauts de ce rapport étaient structurellement invisibles sous ce
filet** — c'est exactement la leçon de la 2.46.0 (une route incapable d'écrire une ligne, sept
assertions vertes).

---

## 2. Séquence sur base NEUVE

Séquence documentée (`RECONSTRUCTION.md`), **quatre** passes d'`init-db` au lieu de deux pour
éprouver l'idempotence des migrations de la PR A.

| # | Commande | Sortie | Commentaire |
|---|---|---|---|
| P1 | `node src/scripts/init-db.local.js` | **exit 1** — `relation "clients_exutoires" does not exist` | **Échec PRÉEXISTANT et documenté** (CLAUDE.md § 12, v2.7.0) : sur une base vierge, la première passe précède les migrations exutoires. Non imputable à la PR A |
| — | `node src/scripts/migrate-exutoires.js` | exit 0 | |
| — | `node src/scripts/migrate-finance.js` | exit 0 | |
| P2 | `init-db.local.js` | exit 0 | `Migration « Dossier administratif d'insertion » (PR A lot 1) ✓` et `Migration PR A lot 2 (FSE+ …) ✓` |
| P3 | `init-db.local.js` | exit 0 | **aucune erreur, aucun avertissement** |
| P4 | `init-db.local.js` | exit 0 | idem |

### Idempotence des seeds — comptés entre les passes

| Table / entrée | P2 | P3 | P4 | Attendu |
|---|---|---|---|---|
| `insertion_eligibilite_criteres` | 14 | 14 | 14 | 14 (contrat § 3) |
| `insertion_projets` | 2 | 2 | 2 | ASI-2026-2027 (`asi`), OCS-CIP-2026-2027 (`ocs`) |
| `insertion_partenaires` — CMS du Département | 1 | 1 | 1 | 1 |
| `rgpd_registre` (total) | 15 | 15 | 15 | dont les 2 entrées de la PR A |
| `rgpd_registre` — « Dossier administratif d'insertion… » | 1 | 1 | 1 | garde `NOT ILIKE` |
| `rgpd_registre` — « Cofinancement FSE+… » | 1 | 1 | 1 | garde `NOT ILIKE` |

Les 14 codes seedés, dans l'ordre : `brsa, ass, aah, deld, detld, jeune_26, senior_50, rqth, qpv,
zrr, refugie_bpi, sortant_detention, parent_isole, sans_domicile`. **Conformes au contrat § 3.**

### DDL — relevé par `information_schema` et `pg_constraint`

Toutes les lignes du § 3 du contrat sont présentes et conformes. Extraits vérifiés :

- **`employees`** — les 15 colonnes du lot 1, avec leurs types, leurs longueurs et leurs défauts :
  `brsa BOOLEAN` **nullable** (trois états), `pass_iae_statut VARCHAR(12) NOT NULL DEFAULT 'inconnu'`,
  `referent_unique_type VARCHAR(20) NOT NULL DEFAULT 'non_determine'`,
  `actualisation_ft_rappels_non_honores SMALLINT NOT NULL DEFAULT 0`.
- **8 tables créées** : `insertion_eligibilite_criteres`, `employee_eligibilite`,
  `insertion_pass_iae_evenements`, `insertion_pieces`, `insertion_projets`,
  `insertion_projet_participants`, `insertion_projet_postes`, `insertion_fse_sorties`.
- **CHECK** (20 relevés) : `insertion_pieces.mime` limité aux 3 formats,
  `taille > 0 AND taille <= 5242880`, `quotite_pct > 0 AND <= 100`,
  `duree_minutes IS NULL OR (0..600)`, `presence` et `absence_motif` nullables à liste fermée,
  `employees.ft_categorie` A→G, `eligibilite_source` 3 valeurs, `orienteur_type` 6 valeurs.
- **`insertion_fse_sorties.situation_6mois`** porte bien **`injoignable`** en plus des 7 situations de
  sortie — l'amendement d'intégration est en base, pas seulement dans le code.
- **UNIQUE** : `employee_eligibilite(employee_id, critere_code)`,
  `insertion_fse_sorties(employee_id, parcours_num)` (l'unicité de la sortie par parcours),
  `insertion_projet_participants(projet_id, employee_id, date_entree)`,
  `insertion_projet_postes(projet_id, user_id)`, `insertion_projets(code)`.
- **Index** : `idx_insertion_pieces_employee`, `idx_employee_eligibilite_employee`,
  `idx_pass_iae_evenements_employee`, `idx_insertion_fse_sorties_date`,
  `idx_insertion_projet_participants_projet` **et** `_emp` (les deux sens de lecture).
- **Colonnes ajoutées** : `insertion_milestones.{duree_minutes, presence, absence_motif,
  absence_piece_ref}`, `insertion_diagnostics.{fse_entree_saisie_at, fse_entree_complet}`,
  `etp_asp_mensuel.nb_brsa`.

---

## 3. Séquence sur base PEUPLÉE

Scénario : une base **antérieure à la PR A**, portant des données réelles sur les deux CHECK que les
migrations reconstruisent. Reproduit en remettant les deux contraintes dans leur forme d'origine, puis
en insérant des lignes de chaque valeur historique, puis en rejouant les deux migrations dans une
transaction — comme le fait `init-db`.

| Avant rejeu | Après rejeu | Verdict |
|---|---|---|
| 4 actions CIP (`competence`, `insertion`, `socialisation`, `frein`) | **4** | aucune perte |
| 6 alertes (`planification`, `rappel_j7`, `rappel_j1`, `retard`, `pass_iae_7m`, `pass_iae_2m`) | **6** | aucune perte |
| CHECK `cip_action_plans_category_check` à 4 valeurs | **6 valeurs** (+ `job_dating`, `formation`) | reconstruit |
| CHECK `insertion_interview_alerts_alert_type_check` à 6 valeurs | **10 valeurs** (+ les 4 alertes FSE+) | reconstruit |
| 14 critères / 2 projets / 15 entrées de registre | **14 / 2 / 15** | aucun doublon de seed |

Le rejeu affiche les deux lignes `✓` et sort en `REJEU OK`. **Le DO-scan de `pg_constraint` fait bien
son travail** : la contrainte n'est reconstruite que si elle ne porte pas déjà le marqueur
(`job_dating`, `fse_sortie_j15`), donc un second passage ne verrouille pas la table pour rien.

---

## 4. Les cinq défauts trouvés, reproduits et corrigés

### D-01 — BLOQUANT · Fuite de connexion du pool : vingt refus figent l'application

**Fichier** : `backend/src/routes/insertion/cadre.js` — `PUT /api/insertion/cadre/:employeeId`.

Deux sorties anticipées du bloc transactionnel — **salarié introuvable** (404) et **critère
d'éligibilité inconnu** (400) — faisaient `await client.query('ROLLBACK')` puis un `return` **nu**,
sans `client.release()`. Le pool `pg` est configuré à `max: 20` : chaque refus retire définitivement
une connexion.

**Ce n'est pas une fuite de ressource théorique, c'est une panne totale.** Le pool est PARTAGÉ par
toute l'application : passé la vingtième occurrence, plus **aucune** requête — collecte, tri, finance,
badgeuse, messagerie — ne peut obtenir de connexion. Et les deux chemins sont des **erreurs
d'utilisation ordinaires** : un identifiant de salarié périmé dans un onglet resté ouvert, une liste de
critères envoyée par un écran non à jour.

**Reproduction** (script `dbg-leak.js`, handlers réels, base réelle) :

```
appel 5  → 400 | pool total=5  idle=0 attente=0
appel 10 → 400 | pool total=10 idle=0 attente=0
appel 20 → 400 | pool total=20 idle=0 attente=0
appel 21 → Error: timeout exceeded when trying to connect
--- une requête ordinaire après 21 refus --- ÉCHEC : timeout exceeded
```

**Correctif** : une seule voie de libération (`rendre()` idempotent + `finally`), posée sur les deux
refus métier, sur le `catch` (qui appelait `client.release()` trois fois dans trois branches) et sur le
chemin nominal.

**Après correctif**, même script : `appel 21 → 400 | pool total=4 idle=4` et
`une requête ordinaire : OK en 1 ms`.

*Trouvé par accident, et c'est significatif* : ce n'est pas une assertion qui l'a révélé, c'est le
`afterAll` de ma première suite qui ne rendait jamais la main — `pool.end()` attend que toutes les
connexions soient rendues. Aucun test sur `pg` simulé ne pouvait le voir : le mock n'a pas de pool.

**Non-régression** : `pr-a-cadre-e2e.test.js` › « vingt refus consécutifs ne fuient AUCUNE connexion du
pool » — 22 refus sur chacun des deux chemins, puis `pool.idleCount > 0`, `waitingCount === 0` et une
requête ordinaire sous 2 s.

---

### D-02 — Robustesse · un pool saturé laissait la requête SANS RÉPONSE

**Fichier** : `cadre.js`, même route. `const client = await pool.connect();` vivait **hors** du `try`.
Express 4 ne capte pas le rejet d'un gestionnaire asynchrone : si `pool.connect()` lève (saturation,
base indisponible), la promesse est rejetée sans réponse — **l'écran de la CIP tourne indéfiniment**.
Constaté pendant la contre-épreuve de D-01 : le test ne tombait pas, il *pendait*.

**Correctif** : obtention de la connexion dans un `try` dédié → **503 en français** avec un message
d'attente. Vérifié pendant la mutation de D-01 : `appel 21 → 503`, et non plus un blocage.

---

### D-03 — Reporting · « Délai de saisie » : le fichier ne respectait pas la règle DICTÉE

**Fichiers** : `routes/exports-fse.js` (colonne 26 et moyenne du bilan), `routes/insertion/fse.js`
(valeur affichée), `services/fse-participants.js` (pièce « sortie saisie dans le mois »).

La matrice de l'autorité définit la colonne 26 par une **arithmétique vérifiable** :
> « **Délai de saisie (jours)** | Colonne 25 − colonne 23. **C'est la colonne que je regarde en premier** »

où la colonne 23 est « Date de sortie de l'opération » et la 25 « Date de saisie de la sortie ».
Le code calculait `saisie_at − (contract_end || date_sortie)` : **la fin de contrat**, pas la sortie de
l'opération. Le lot 2 l'assume dans son rapport (« c'est l'événement qui déclenche l'obligation ») —
c'est une lecture métier défendable, mais la spécification d'export **prime sur toute interprétation
ultérieure** (09, préambule), et surtout elle est **refaite à la main** par l'instructeur sur le
fichier : toute autre base de calcul lui donne un écart qu'il ne peut pas expliquer.

Les deux dates coïncident dans le cas ordinaire — c'est pourquoi le défaut ne se voyait pas. Elles
divergent sur une **rupture anticipée**, cas courant en ACI.

**Reproduction** — participante sortie de l'opération le 30/04, fin de contrat au 31/05, sortie saisie
le 12/06 :

| | colonne 23 | colonne 25 | colonne 26 |
|---|---|---|---|
| Attendu (règle dictée) | 2026-04-30 | 2026-06-12 | **43** |
| Produit avant correctif | 2026-04-30 | 2026-06-12 | **12** |

**Correctif** : la colonne 26 se compte depuis la **date de sortie de l'opération** — colonne NOT NULL
en base, il n'existe donc aucun cas où la base de calcul manquerait. **Les trois surfaces sont alignées
sur la même définition** (export nominatif, moyenne du bilan agrégé, valeur d'écran et pièce de
conformité) : deux nombres différents sous le nom « délai de saisie » seraient exactement la divergence
que la doctrine du dépôt interdit, et le rapprochement entre (a) et (b) est le premier que fait
l'autorité. La phrase de méthode du bilan (§ 8 imposé) est réécrite en conséquence.

**Effet de bord assumé et vérifié** : la pièce n° 7 du dossier de conformité (« Statut de sortie saisi
dans le mois ») bascule sur la même base et son libellé dit désormais « N jour(s) après **la sortie** »
au lieu de « après la fin de contrat ». C'est aussi la formulation littérale de l'exigence F7
(« sortie saisie dans le mois »).

---

### D-04 — Alertes · le seuil J+15 ne se déclenchait qu'au seizième jour

**Fichier** : `services/fse-participants.js` — `checkFseSortiesNonRenseignees`.

```sql
AND e.contract_end < CURRENT_DATE - ($1 || ' days')::interval
```

`CURRENT_DATE - interval` produit un **timestamp à minuit** ; une `DATE` comparée à lui est elle-même
portée à minuit. À exactement 15 jours révolus, `<` est **faux** : le job ne crée l'alerte qu'au
seizième jour.

Or l'écran de la fiche (`routes.js`, alerte `fse_sortie_a_saisir`) lit `jours >= seuil` et affiche donc
une alerte **critique** dès J+15. **Deux implémentations de la même règle divergeaient d'un jour, et
c'est celle qui laisse une trace en base qui était la plus tardive** — la CIP voit l'alerte, le
registre des alertes ne la porte pas.

**Reproduction** : fin de contrat à J−15 → `0` alerte créée. **Correctif** : soustraction de DATES
(`(CURRENT_DATE - e.contract_end) >= $1::int`), c'est-à-dire **la même expression que la colonne
`jours` déjà présente dans la requête**, et la même comparaison que l'écran.
**Après** : J−14 → 0 alerte, J−15 → `fse_sortie_j15`, J−26 → `fse_sortie_j15` + `fse_sortie_j25`,
rejeu le même jour → aucune alerte de plus.

---

### D-05 — Recette · l'anonymisation efface le matricule, la purge de test ne retrouvait plus la fiche

Sans conséquence en production — c'est un défaut de **mon** harnais, signalé parce qu'il documente un
comportement utile : `anonymizeEmployee` vide `malibou_id`, si bien qu'une purge par matricule laisse
la fiche anonymisée en base. Le harnais purge désormais aussi par identifiant.

---

## 5. Tableau des vérifications de bout en bout

**81 vérifications, 3 suites, 0 rouge.** Toutes exercent les handlers réels contre PostgreSQL 16.13.

### 5.1 `pr-a-cadre-e2e.test.js` — dossier administratif (28)

| Vérification | Résultat |
|---|---|
| MANAGER : `statuts`, `pieces`, `bloc_emplois_inclusion` **absents de l'objet** (clés, pas valeurs nulles) | vert |
| MANAGER : 403 sur `PUT /cadre`, `POST /pass-iae/evenements`, `POST /actualisation-ft`, `GET /pieces` | vert |
| ADMIN : les trois blocs réservés sont servis | vert |
| Consultation ADMIN/RH journalisée `INSERTION_CADRE_CONSULTATION` ; consultation MANAGER **non** journalisée | vert |
| Écriture complète (critères + Pass + orientation + référent + statuts + dérogation) relue à l'identique | vert |
| Bloc « Emplois de l'inclusion » : **libellés** des critères, numéro de Pass, gabarit du § 6.1 | vert |
| Journal de modification : **liste des champs**, jamais les valeurs (ni le n° de Pass, ni le nom du CMS) | vert |
| Valeur hors liste → 400, **et la valeur précédente survit** | vert |
| Critère inconnu → 400 **et ROLLBACK** (les 2 critères précédents intacts) | vert |
| **Vingt refus consécutifs ne fuient aucune connexion** (D-01) | vert |
| `pass_iae.statut` envoyé par le client **ignoré** (recalculé serveur) | vert |
| Actualisation FT : date posée, compteur de rappels remis à 0 | vert |
| Pass — numéro absent → `inconnu` · fin passée → `expire` · fin future → `actif` | vert |
| Pass — suspension couvrant aujourd'hui → `suspendu` ; suppression de l'événement → retour `actif` | vert |
| Pass — prolongation → `prolonge` ; **une suspension en cours PRIME sur une prolongation** | vert |
| Pass — statut **persisté** dans `employees.pass_iae_statut` à la lecture comme à l'écriture | vert |
| Événement dont la fin précède le début → 400 | vert |
| Pièce : vrai PDF accepté, stocké en **BYTEA** (longueur exacte), `sha256` sur 64 caractères, journal `INSERTION_PIECE_DEPOT` | vert |
| Pièce : **HTML annoncé `application/pdf` refusé** (contrôle par octets d'en-tête) | vert |
| Pièce : PNG renommé `.pdf` **accepté mais rangé sous son vrai type** `image/png` (§ 6 ci-dessous) | vert |
| Pièce : > 5 Mo → 400 « 5 Mo maximum » | vert |
| Pièce : la liste ne porte **jamais** `contenu` | vert |
| Pièce : service avec `Content-Type` stocké, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, octets `%PDF-`, journal `INSERTION_PIECE_CONSULTATION` | vert |
| Pièce : nom de fichier hostile (guillemet) → en-tête non cassé, aucun `Set-Cookie` injecté | vert |
| Pièce : suppression journalisée `INSERTION_PIECE_SUPPRESSION` | vert |
| Référentiel : 14 critères triés par `ordre`, écriture réservée à ADMIN (RH → 403) | vert |

### 5.2 `pr-a-fse-e2e.test.js` — conformité FSE+ (34)

| Vérification | Résultat |
|---|---|
| Projets : les 2 opérations seedées présentes, `nb_participants` juste, code dupliqué → 409 `CODE_DUPLIQUE` | vert |
| Projets : MANAGER 403 en création et modification | vert |
| Participants : rattachement créé, journal `INSERTION_PROJET_PARTICIPANT`, doublon → 409 `RATTACHEMENT_DUPLIQUE` | vert |
| Participants : date de sortie posée, retrait effectif | vert |
| Postes : remplacement **complet** (la liste envoyée fait foi), quotité 120 % → 400 **sans détruire la liste** | vert |
| Questionnaire d'entrée hors schéma → 400 nommant **chaque** item, **aucun diagnostic créé** | vert |
| Questionnaire complet : `fse_entree_complet` et `fse_entree_saisie_at` posés **par le serveur** (`fse_entree_complet:false` envoyé par le client ignoré) | vert |
| Valeur héritée `plus_24_mois` **convertie** en `gt_24m`, jamais refusée | vert |
| La date de première saisie **ne bouge pas** à la correction suivante | vert |
| Suggestions cohérentes avec le diagnostic : `sans_domicile_stable` ← « hébergé », `foyer_monoparental` ← famille, `ressources_principales` ← BRSA ; **chacune porte sa source** ; `duree_sans_emploi` n'en a **aucune** | vert |
| Complétude `5/5`, `participant_asi: true` | vert |
| Questionnaire partiel → `fse_entree_complet` reste **false** | vert |
| `GET /fse` refusé au MANAGER (statuts sociaux) | vert |
| Sortie **sans bilan** : une ligne `source='sans_bilan'`, rattachée au projet ASI ouvert, journalisée | vert |
| Questionnaire de sortie hors schéma → 400, **aucune ligne créée** | vert |
| Clôture d'un `bilan_sortie` : `locked_at` posé, `duree_minutes=60`, `presence='present'`, ligne `source='bilan'` liée au jalon | vert |
| **Sortie sans bilan PUIS clôture d'un bilan → toujours UNE seule ligne**, même `id`, et `saisie_at` **inchangée** (pas de retard rétroactif) | vert |
| Relevé +6 mois sans sortie → 409 `SORTIE_ABSENTE`, **aucune ligne fabriquée** | vert |
| Relevé +6 mois **« injoignable »** accepté et distinct de « non relevée », journalisé | vert |
| Situation à six mois hors liste → 400 | vert |
| Conformité : les **9 pièces dans l'ordre du contrat**, 4 états admis | vert |
| Dossier renseigné : `fse_entree`, `diagnostic_socle`, `fse_sortie`, `sortie_delai` à `complet` | vert |
| Dossier vide, parcours **en cours** : pièces de sortie **`sans_objet`** et non « à faire » | vert |
| Contrat terminé sans sortie : `fse_sortie` et `sortie_delai` passent à `a_faire` | vert |
| Vue par projet : 4 participants, taux de complétude numérique, restes à faire nommés, 9 pièces par ligne | vert |
| `GET /conformite` sans projet → 400 `PROJET_REQUIS` (jamais un écran vide) | vert |
| Conformité refusée au MANAGER | vert |
| Alerte `fse_entree_manquante` sur participant ASI incomplet | vert |
| Alerte `fse_sortie_a_saisir` présente sur contrat terminé sans sortie, **absente** quand la sortie existe | vert |
| Alerte `referent_non_determine` pour un BRSA sans référent, **disparaît** dès désignation | vert |
| Alerte `suivi_6mois_echu` quand l'échéance est passée | vert |
| Job `checkFseSortiesNonRenseignees` : J+15 puis J+25, anti-doublon au rejeu | vert |
| Job : **seuil J+15 exact** (J−14 → rien, J−15 → alerte) — D-04 | vert |
| Job `createPostSortieFollowups` : jalon à **sortie + 6 mois** (réglage lu), **idempotent** | vert |
| Anonymisation : `employee_eligibilite`, `insertion_pass_iae_evenements`, `insertion_pieces` **supprimés** | vert |
| Anonymisation : `orienteur_nom`, `referent_unique_nom`, `referent_unique_contact`, `brsa_date_constat`, `ft_categorie_date` **à NULL** | vert |
| Anonymisation : `brsa`, `ft_categorie` **conservés** (catégoriels non nominatifs) | vert |
| Anonymisation : `insertion_fse_sorties` et `insertion_projet_participants` **CONSERVÉS** (piste d'audit ≥ 5 ans) | vert |

### 5.3 `pr-a-exports-e2e.test.js` — exports (19)

| Vérification | Résultat |
|---|---|
| **Les 29 colonnes, comparées une à une** aux intitulés de 09 § 2 (a) | vert |
| En-tête de traçabilité : 5 lignes `#`, BOM, `;`, `Généré le` / `Généré par` / `Périmètre` / `Nombre de lignes;3` / mention « font foi », **une seule ligne de colonnes** | vert |
| Nom de fichier `fse-participants_<code>_2026_T2.csv` | vert |
| Ligne d'une participante sortie : 20 cellules vérifiées une à une (NOM en majuscules, codes d'éligibilité `brsa, detld`, `BRSA=Oui`, `Référent unique=CMS`, 1er CDDI, **libellés français** et non les codes, complétude `100`, `Injoignable`) | vert |
| **Aucune cellule ne contient de JSON** | vert |
| **Colonne 26 = colonne 25 − colonne 23** sur toutes les lignes — D-03 | vert |
| Sortie **anticipée** (sortie ≠ fin de contrat) : 43 jours et non 12 — D-03 | vert |
| Participant en parcours : colonnes 23 à 27 **vides**, jamais un zéro ; `BRSA` = « Non renseigné » (seule exception dictée) | vert |
| 0 ligne → **409 `EXPORT_VIDE`** en JSON, aucun fichier | vert |
| Journal `EXPORT_FSE_PLUS` écrit à chaque export ; **aucun journal sur un export refusé** | vert |
| **Journal rendu impossible en base** (CHECK `NOT VALID` posée sur `rgpd_audit_log`) → l'export **échoue en 500** et **aucune donnée nominative ne sort** ; il refonctionne dès la contrainte levée | vert |
| MANAGER refusé (403) sur l'export nominatif et sur le bilan | vert |
| Aucun vocabulaire de frein / santé / judiciaire dans le fichier ni dans les intitulés | vert |
| Bilan (b) : **strictement non nominatif** (aucun nom, aucun prénom), `identification.nominatif === false`, sections complétude et sortie présentes | vert |
| `GET /exports/insertion` (Excel) : journal `EXPORT_INSERTION_COMPLET`, type `spreadsheetml` | vert |
| `GET /exports/insertion?format=csv` : en-tête `#` de traçabilité, journal portant `format` et `dataset` | vert |
| Périmètre vide → **409 `EXPORT_VIDE`** en Excel **et** en CSV | vert |
| MANAGER refusé | vert |

### 5.4 Suites du dépôt

| Commande | Résultat |
|---|---|
| `cd backend && npx jest --silent` | **224 suites / 4 385 tests verts, 0 échec** (5 suites ignorées : les 3 e2e de ce rapport + 2 e2e préexistantes) |
| `cd frontend && npx vite build` | **vert** (14,9 s) |
| `PR_A_E2E_DB=1 npx jest tests/e2e-pr-a --runInBand` | **81 verts**, **rejoué deux fois de suite sans nettoyage manuel** |

---

## 6. Contre-épreuves par mutation

Cinq mutations, **chacune fait tomber précisément les vérifications qu'elle vise**, toutes restaurées.

| # | Mutation | Effet | Restauré |
|---|---|---|---|
| M1 | `exports-fse.js` — neutraliser le refus `if (rows.length === 0)` | **2 rouges** (409 vide, absence de journal sur refus) | oui, 19 verts |
| M2 | `fse-participants.js` — remplacer `ON CONFLICT (employee_id, parcours_num)` par `ON CONFLICT (id)` | **1 rouge** (unicité de la sortie par parcours) | oui, 34 verts |
| M3 | `cadre.js` — retirer `rendre()` du refus « critère inconnu » et le `finally` | pool saturé à 20, `appel 21 → 503`, **toute requête ultérieure en échec** | oui, `idle=4`, `OK en 1 ms` |
| M4 | `fse-participants.js` — rétablir la comparaison à un intervalle | **1 rouge** (seuil J+15 exact) | oui, 34 verts |
| M5 | `exports-fse.js` — rétablir le délai compté depuis `contract_end` | **2 rouges** (colonne 26, sortie anticipée) | oui, 19 verts |

**M3 mérite un mot** : monté d'abord comme une mutation de suite Jest, il ne « faisait pas tomber » un
test — il **faisait pendre la suite entière**, puis la sortie de secours de Jest. C'est le symptôme
exact du défaut en production, et c'est pourquoi la contre-épreuve finale passe par le script de
reproduction, qui le chiffre (`pool total=20 idle=0` puis `timeout exceeded`) au lieu de le subir.

---

## 7. Écarts assumés et points d'attention

1. **PNG renommé `.pdf`** — le brief attendait un refus ; l'implémentation **accepte** et range la
   pièce sous son type RÉEL (`image/png`), parce que le PNG est l'un des trois formats admis. C'est
   le bon comportement : le type déclaré par le navigateur n'est jamais cru, le type servi est celui
   des octets, et `nosniff` empêche toute réinterprétation. Le cas réellement dangereux — **HTML
   annoncé `application/pdf`** — est bien refusé en 400 (vérifié). Reste un détail cosmétique : le
   `nom_fichier` conserve l'extension d'origine, donc un téléchargement peut s'appeler `.pdf` tout en
   étant servi `image/png`. Sans effet de sécurité (l'en-tête fait foi) ; à corriger si l'usage gêne.

2. **Les trois constats BLOQUANTS de la revue de sécurité ne sont pas traités ici**
   (`12-revue-securite-PR-A.md`, C-01 : la liste des critères d'éligibilité — donc `brsa`, `rqth`,
   `aah`, `sortant_detention` — est servie au MANAGER avec ses libellés). **Ils sont réels** et mes
   propres suites le confirment indirectement : mon test « MANAGER sans statuts » vérifie l'absence des
   trois clés retirées, pas celle de la liste de critères. Les corriger ici aurait invalidé les tests
   de reproduction que l'agent de sécurité vient de commiter, sans coordination. **Quand C-01 sera
   corrigé**, la vérification à ajouter dans `pr-a-cadre-e2e.test.js` tient en deux lignes : pour un
   MANAGER, `eligibilite.criteres` ne doit porter ni code ni libellé, seulement un compte et la date
   de vérification.

3. **Le délai de saisie change de base de calcul** (D-03). Conséquence visible : pour une sortie
   anticipée, l'écran, le dossier de conformité et le fichier affichent désormais un délai **plus
   long** que la veille. Ce n'est pas une régression, c'est la fin d'une sous-estimation — mais il
   faut l'annoncer, car la pièce n° 7 (« saisi dans le mois ») peut basculer de `complet` à `partiel`
   sur des dossiers déjà clos.

4. **`init-db.local.js`** n'est qu'un artefact de recette (absence de PostGIS sur la machine). Il est
   ignoré par git et **doit être regénéré** après toute modification d'`init-db.js` — sans quoi la
   recette suivante éprouverait une version périmée du schéma.

5. **Échec de la passe 1 sur base vierge** : préexistant, documenté, hors périmètre de la PR A — mais
   il reste un piège pour qui reconstruit une base sans lire `RECONSTRUCTION.md`.

6. **Le job `checkFseSortiesNonRenseignees` ne couvre que les participants d'un projet `asi`**
   (jointure sur `pr.type = 'asi'`). C'est conforme au contrat, mais l'alerte d'écran
   `fse_sortie_a_saisir`, elle, ne pose **aucune** condition de projet : un salarié hors opération
   cofinancée verra l'alerte à l'écran sans qu'elle soit tracée en base. Comportement voulu ou non,
   il mérite un arbitrage — non modifié ici.

---

## 8. Ce qui reste à valider en production (hors de portée d'une base de recette)

1. **Le format MDFSE+ définitif.** Les questions exactes de Ma Démarche FSE+ ne sont pas publiées
   (09 § 1.4 F6, « items définitifs à confirmer sur la plateforme »). Ce que j'ai pu prouver : le
   schéma typé accepte, refuse et complète correctement les **5 items retenus**, et l'export en tire
   **une colonne par item**. Ce que je ne peux pas prouver : que ces 5 items sont les bons. Point
   d'attention concret déjà signalé par le lot 2 et confirmé par la recette — **la colonne 18
   « Niveau d'instruction » n'est pas un item du questionnaire** : elle est servie par
   `insertion_diagnostics.niveau_formation` (nomenclature `infra3`→`niv6plus`). Si la plateforme
   impose sa propre nomenclature, il faudra une table de correspondance, **jamais une recopie**.

2. **Le rapprochement colonne par colonne avec l'import réel de MDFSE+.** Les 29 intitulés sont
   conformes à la note de l'autorité ; personne n'a encore chargé le fichier dans la plateforme.

3. **Le volume.** La recette porte sur 4 à 7 participants. `chargerContextes` est ensembliste (6
   requêtes quel que soit le nombre), mais le temps de réponse de `GET /conformite?projet=` sur une
   cohorte réelle (plusieurs dizaines) n'a pas été mesuré.

4. **La charge du pool** après correction de D-01 : la fuite est fermée sur la route où elle a été
   trouvée ; un audit des autres `pool.connect()` du dépôt n'entrait pas dans ce mandat. Les fichiers
   de la PR A ont été scannés — `projets.js` porte bien un `finally { client.release(); }`, les autres
   n'ouvrent pas de transaction.

5. **La double authentification réelle.** Les jetons de recette portent `mfa: true` et un `mfa_at`
   frais ; la chaîne TOTP complète (enrôlement, défi, péremption à 24 h) relève de la recette 2.46.0
   et n'a pas été rejouée ici.

---

## 9. Rejouer ces preuves

```bash
# 1. Environnement (variables de la base de recette)
source <scratchpad>/db-test.env

# 2. Base NEUVE + séquence documentée + 2 passes d'idempotence
sed -e 's/GEOMETRY(Point, 4326)/TEXT/g' -e 's/USING GIST\s*(\(geom[a-z_]*\))/(\1)/Ig' \
    backend/src/scripts/init-db.js > backend/src/scripts/init-db.local.js
su postgres -c "dropdb --if-exists solidata_test; createdb -O solidata_user solidata_test"
cd backend
node src/scripts/init-db.local.js        # échec attendu : clients_exutoires (préexistant)
node src/scripts/migrate-exutoires.js
node src/scripts/migrate-finance.js
node src/scripts/init-db.local.js        # passe 2 — les 2 migrations PR A s'appliquent
node src/scripts/init-db.local.js        # passe 3 — idempotence
node src/scripts/init-db.local.js        # passe 4 — idempotence

# 3. Les 81 vérifications de bout en bout (ignorées sans PR_A_E2E_DB=1)
PR_A_E2E_DB=1 npx jest tests/e2e-pr-a --runInBand

# 4. Non-régression du dépôt (les suites e2e restent ignorées)
npx jest --silent
cd ../frontend && npx vite build
```

Les suites vivent dans `backend/tests/e2e-pr-a/` (`_helpers.js`, `pr-a-cadre-e2e.test.js`,
`pr-a-fse-e2e.test.js`, `pr-a-exports-e2e.test.js` — 1 448 lignes). Elles créent et purgent leur
propre périmètre (comptes préfixés `jest_prA_*`, matricules `PRA*`, projets `JEST-*`) et sont
**rejouables sans nettoyage manuel** ; le seul test destructif — le refus d'export sur périmètre vide —
est placé en dernier et garde deux verrous : le drapeau `PR_A_E2E_DB` **et** un nom de base contenant
« test ».

---

## 10. Fichiers modifiés

| Fichier | Nature |
|---|---|
| `backend/src/routes/insertion/cadre.js` | D-01 libération unique de la connexion (+ `finally`) · D-02 `pool.connect()` sous `try` → 503 |
| `backend/src/routes/exports-fse.js` | D-03 colonne 26 et moyenne du bilan comptées depuis la sortie de l'opération · phrase de méthode réécrite |
| `backend/src/routes/insertion/fse.js` | D-03 `delai_saisie_jours` aligné sur la règle dictée |
| `backend/src/services/fse-participants.js` | D-03 pièce « sortie saisie dans le mois » alignée · D-04 seuil J+15 en jours entiers |
| `backend/tests/e2e-pr-a/` (4 fichiers, nouveaux) | 81 vérifications sur PostgreSQL réel |

# Réalisation — PR C, lot 5 « Section CIP »

> Agent `cip`, 13/09/2026. Branche `claude/solidata-cip-redesign-9fskwq-pr-c`.
> Contrat de référence : `20-contrats-techniques-PR-C.md` § 1.2, 2, 3.1, 4, 5.1 à 5.5, 7, 9.
> Contexte fonctionnel : `08-organisation-section-cip.md` (§ 0-3, 6-8 et amendements § 10), `07-plan-action.md` lot 5.
> Deux commits atomiques : `6702df9` (backend) et `1def18b` (frontend).

---

## 0. En une phrase

L'espace CIP s'organise désormais par ce que la conseillère doit faire **aujourd'hui** :
un écran « Mes échéances » qui distingue les **obligations** (contrôlées par l'autorité,
reportables 48 h, jamais acquittables) de l'**organisation du suivi**, une file active
débarrassée des permanents mais qui garde les sortis sept mois, une fiche à **quatre**
onglets au lieu de huit, un diagnostic en **socle J+30 + approfondissements**, et un écran
ETI que son destinataire peut enfin ouvrir — parce qu'il n'a plus besoin d'un compte.

---

## 1. Ce qui est livré, point par point

### 1.1 Moteur d'échéances — `backend/src/services/echeances-cip.js` (NOUVEAU, 660 lignes)

| Ce qui est posé | Où | Pourquoi ainsi |
|---|---|---|
| `TYPES_OBLIGATIONS` — 9 familles en liste fermée, chacune avec `social`, `agregee`, `onglet`, `champ` | `echeances-cip.js:78-88` | La cible d'onglet vit **dans la liste**, pas dans l'écran : une échéance doit ouvrir la fiche là où le travail se fait, et deux tables de correspondance divergeraient |
| `typesPourRole(baseRole)` | `:92-95` | Le tri par rôle est fait **avant** toute requête. Les quatre familles sociales ne sont pas *filtrées* pour un MANAGER : elles ne sont pas **calculées** |
| `sqlSocleComplet(alias)` + miroir JS `socleComplet(diag)` | `:110-136` | Dérivés du **même fichier** `backend/src/data/diagnostic-socle-champs.json` que le front |
| `sqlPerimetreFileActive({alias, moisTermines, tous})` | `:151-163` | Permanents exclus, terminés < 7 mois conservés, `is_active` retiré des filtres |
| `chargerObligations()` — cohorte + 5 sources en **une passe** | `:183-420` | Jamais une requête par dossier : c'est le défaut D-07 de la PR B (325 requêtes pour 40 dossiers) |
| `niveauRisque()` / `niveauxRisqueCohorte()` | `:430-460` | **La** fonction que consomme `GET /insertion` : la pastille de la liste ne peut pas contredire l'écran |
| `chargerReports()` | `:470-492` | `nb` = **tous** les reports du couple (salarié, type), `jusqu_au` = seulement celui en cours |
| `chargerOrganisation()` | `:498-610` | Bilans en retard, RDV non planifié, renouvellements < 42 j (avec `lien_eti`), actions critiques |
| `composerEcheancesPeriodiques()` — **extrait** de `rsa.js` | `:625-720` | Forme de réponse inchangée au caractère près ; ses 56 tests de la PR B restent verts |
| `chargerKpiFileActive()` | `:726-790` | `completude_fse_asi_pct` **null** sans participant — 0 % se lirait « rien de fait » |
| `composerEcheances()` | `:796-870` | L'écran entier en un appel, chaque source `soft` |
| `compteurRouges()` + cache mémoire 60 s par (rôle, utilisateur, périmètre) | `:880-910` | La barre latérale l'appelle à chaque montage de page |

**Trois choix de conception qui méritent d'être dits :**

1. **`cumulCddiMois` n'a pas été extrait** (écart au § 1.2, assumé). `computeCddiCumulativeMonths`
   vit dans `routes/insertion/engine.js` depuis l'origine et il est déjà consommé par
   `routes/employees.js` et l'import de paie. L'extraire « pour avoir un helper du lot »
   aurait produit exactement ce que le contrat interdit : deux règles pour un seul plafond
   légal. Le service **l'importe** (`echeances-cip.js:48`).

2. **Le délai de la sortie FSE+ court depuis la sortie de l'OPÉRATION** quand elle est datée
   (`insertion_projet_participants.date_sortie`), puis `insertion_end_date`, puis la fin de
   contrat (la règle historique) — `:355-378`. Le contrat le demande explicitement
   (§ 5.1.2) ; la cascade garantit qu'en l'absence de date d'opération le comportement est
   **identique** à celui de l'alerte de fiche existante. Sur une rupture anticipée, compter
   depuis la fin de contrat prévue imprimait 12 jours pour 43 réels (défaut D de la PR A).
   → **Point à vérifier par l'agent debug** : sur base réelle, `routes.js` (alerte de fiche,
   `fse_sortie_a_saisir`) et ce moteur doivent produire le même verdict sur un dossier sans
   `pp.date_sortie`.

3. **`referent_unique` est rouge pour TOUS**, sans adossement au statut BRSA (contrat § 5.1.2,
   ligne « rôles : tous »). C'est cohérent avec `echeances-periodiques` de la PR B, qui liste
   déjà `referents_non_determines` pour toute la cohorte en parcours. Conséquence assumée :
   sur une base où le référent n'est pas encore saisi, la ligne apparaîtra pour beaucoup de
   dossiers. Le libellé ne nomme **aucun** statut social (vérifié par test).

### 1.2 Routeur `/api/insertion/echeances` — `backend/src/routes/insertion/echeances.js` (NOUVEAU)

- `GET /` → payload § 5.1 complet, journal **tolérant** `INSERTION_ECHEANCES_CONSULTATION`
  (la trace dit combien de lignes, jamais qui).
- `GET /compteur` → `{ rouges }`. **Non journalisé** : la barre latérale l'appelle à chaque
  montage de page, et inscrire chaque montage au registre RGPD le noierait sous des lignes
  qui ne disent rien d'un accès à une donnée personnelle (la réponse est un entier). Une
  panne rend `{ rouges: 0, indisponible: true }` en **200** : une pastille absente n'est pas
  une panne d'application.
- `POST /report` → **ADMIN/RH strict posé avant tout validateur**, 400 `TYPE_INCONNU`,
  400 `LIGNE_AGREGEE`, 404 salarié inconnu, 409 `MOTIF_REQUIS` au 2ᵉ report, journal
  **BLOQUANT dans la transaction**, `pool.connect()` **dans le `try`**, `viderCacheCompteur()`
  après commit (sinon la pastille contredirait l'écran pendant une minute, et c'est la
  pastille qu'on croit).

### 1.3 Écran ETI à jeton public — `backend/src/routes/insertion/eti-public.js` (NOUVEAU)

- `GET /api/eti/renouvellement/:token` : **404 uniforme** pour un jeton malformé (contrôlé
  par regex **avant** toute requête), inconnu, ou portant un entretien d'un autre type ;
  **410** distinct `LIEN_EXPIRE` / `ENTRETIEN_CLOTURE` ; réponse à **9 clés exactement**
  (`prenom, nom, poste, contract_end, formulaire, avis, duree_mois, expire_le, lecture_seule`)
  — test qui compare la liste triée des clés. Aucun `employee_id`.
- Une échéance **absente** vaut expiré : jamais « valable pour toujours » (`:96`).
- `PUT` : liste blanche de 3 champs vérifiée **avant toute lecture en base**, validation de
  l'avis et de la durée de même, `{ ok: true }` en réponse (jamais la ligne), validation
  `{ role:'eti', mode:'jeton', at, token_prefix }`, snapshot par `snapshotMilestone`
  **importé de `routes.js`** (exporté pour cela), journal `user_id` NULL avec IP et préfixe.
- `router.all('*')` final : toute autre adresse sous `/api/eti` rend le même 404.

### 1.4 `routes.js` — trois modifications, et pas une de plus

| Route | Ce qui change |
|---|---|
| `GET /` (`routes.js:140-296`) | File active § 5.2 : périmètre, 18 champs ajoutés, `brsa` **non lu** pour un MANAGER, `risque` depuis le moteur, `diagnostic_socle_complet` depuis le fichier partagé, `prochain_rdv` en objet (minuit → `heure: null`, jamais « 00 h 00 »), `?inclure=tous`, `?mine=1` |
| `GET /renouvellements` | `+ entretien.lien_eti` et `entretien.eti_expire_le`, **null si expiré** : afficher une adresse qui répondra 410 vaut moins que ne rien afficher |
| `POST /renouvellements/:id/lien-eti` (NOUVEAU) | 400 hors renouvellement, 403 MANAGER non référent, 409 verrouillé, jeton hex 32, journal **bloquant** avec le seul préfixe |
| Exports | `snapshotMilestone`, `managerOwnsEmployee`, `baseRoleOf` (§ 1.2) |

### 1.5 `rsa.js` — deux extractions, zéro changement de comportement

- Le couple journal tolérant / journal bloquant part dans **`backend/src/utils/insertion-journal.js`**
  (§ 7). `entity_type` reste `insertion_rsa` (une fabrique `journalPour(entityType, prefixe)`
  le porte : le type d'entité est une propriété de la **surface**, pas de l'appel).
- Le calcul de `GET /echeances-periodiques` part dans le service. La route garde sa forme de
  réponse ; **ses 56 tests de contrat PR B sont verts sans une ligne modifiée**.

### 1.6 Migration — `backend/src/scripts/migrations/insertion-echeances.js`

DDL du § 3.1 à la lettre. Index du jeton **partiel** (`WHERE eti_token IS NOT NULL`), CHECK du
motif par DO-scan de `pg_constraint`, `motif` nullable **et sans défaut** (un défaut `'autre'`
rendrait le compteur de motifs muet sur la différence entre « pas demandé » et « pas su »),
**aucun UNIQUE(employee_id, echeance_type)** — c'est le nombre de reports qui dit qu'un dossier
tourne en rond. Aucune entrée au registre art. 30.

### 1.7 Frontend

| Fichier | État | Contenu |
|---|---|---|
| `components/insertion/EcheancesPanel.jsx` | créé (700 l.) | Les 5 blocs dans l'ordre de l'amendement § 10, report 48 h avec `Modal` de motifs au 2ᵉ, « Copier le lien encadrant » qui **crée** le lien s'il manque, barre d'outils (exports, FSE+, IA cohorte, objectif conventionné) |
| `components/insertion/FileActive.jsx` | créé | Recherche sans accents, 10 filtres client (BRSA masqué hors ADMIN/RH), pastille de risque, badge « sorti », repli sous `md` |
| `components/insertion/FreinsDeltas.jsx` | créé | Entrée → dernière évaluation, badges levé / en baisse / stable / aggravé, **« non comparable »** quand un axe manque d'un côté |
| `components/insertion/OngletSituation.jsx` | créé | Freins **avant** la note de profil, frise repliée, check-list, PMSMP, satisfaction, `DocumentsSalariePanel` (lot 7), recommandations algorithmiques, pistes métiers, « Proposition de synthèse (IA) » |
| `components/insertion/OngletSuivi.jsx` | créé | Entretiens, objectifs, actions, notes (ADMIN/RH), compétences en encart repliable |
| `components/insertion/FormulaireETI.jsx` | créé | Trame ETI **partagée** par les deux écrans |
| `pages/EtiRenouvellement.jsx` | rempli | `axios` nu (l'instance partagée redirigerait vers la connexion sur 401), 3 états 404 / 410 / succès |
| `pages/RenouvellementETI.jsx` | réécrit | Voie « pour les comptes » + encart « copiez le lien public » (qui le crée au besoin) |
| `pages/InsertionParcours.jsx` | réécrit | **1 853 → 655 lignes**, 4 onglets, `ConfirmDialog` |
| `pages/Employees.jsx` | réduit | Onglet insertion = résumé + « Ouvrir dans l'espace CIP » ; 2 `alert()` remplacés par un bandeau |
| `components/Layout.jsx` | modifié | Pastille `/insertion` = obligations rouges, best-effort et silencieuse, réservée aux rôles du module |
| `components/insertion/DiagnosticForm.jsx` | modifié | Socle 7 rubriques + 5 approfondissements repliés |
| `components/insertion/diagnostic-socle-champs.json` | créé | Copie à l'identique du fichier serveur |

---

## 2. Écarts au contrat, et pourquoi

### 2.1 Le fichier des champs du socle est COPIÉ, pas importé des deux côtés

**Le contrat (§ 5.5) et la consigne demandaient un fichier « importé des deux côtés ».**
C'est impossible sans casser la production : le contexte de build Docker du frontend est
`./frontend` (`docker-compose.prod.yml:141`), et son `Dockerfile` fait `COPY . .` — le dossier
`backend/` n'y est **pas**. Un `import '../../../../backend/src/data/…'` compilerait en local
et **ferait échouer le build de l'image frontend en production**.

Retenu : la **source unique** vit dans `backend/src/data/diagnostic-socle-champs.json`, la copie
frontend est à l'identique, et **un test Jest compare les deux fichiers**
(`tests/unit/services/echeances-cip.test.js`, « la copie du frontend est IDENTIQUE »). C'est la
formulation du contrat lui-même (« recopiée à l'identique dans le front, test unitaire qui
compare les deux listes »). **Contre-épreuve n° 4** ci-dessous : retirer un champ de la copie
fait tomber le test.

### 2.2 `AlertesBloc` reste au-dessus des onglets, pas dans l'onglet Situation

Le contrat § 5.4 le place en tête de la liste « Situation » ; l'organisation cible § 3 le place
dans l'**en-tête de fiche**. Retenu : l'en-tête — il y est aujourd'hui, et l'y laisser évite que
les trois autres onglets perdent le bandeau de risque. Il est de fait le premier bloc au-dessus
de l'onglet Situation. Réversible en deux lignes si l'orchestrateur tranche autrement.

### 2.3 `cumulCddiMois` non extrait

Voir § 1.1 point 1 : le helper existe et est partagé depuis `engine.js`. Extraire aurait créé
une seconde règle pour le plafond légal.

### 2.4 Le bloc « Aujourd'hui / Cette semaine » vient d'un second appel

`GET /insertion/echeances` ne porte pas d'agenda dans la forme figée du § 5.1 (aucune clé
`agenda`). `EcheancesPanel` charge donc **aussi** `GET /insertion/cohorte/stats`, endpoint
existant qui alimente déjà ce bloc. Deux appels au total, en parallèle.

### 2.5 « Projet de formation / COA » : le COA reste dans « Portefeuille & AFOM »

Le champ `coa_texte` est rendu par `PortefeuilleCompetences.jsx`, **qui n'est pas dans ma liste
de fichiers** (§ 1.2). L'approfondissement s'appelle donc « Projet de formation »
(`projet_formation`, `cpf_accessible`) et une phrase renvoie à la rubrique Portefeuille pour le
COA et l'AFOM.

---

## 3. Manques du pré-câblage (à l'orchestrateur)

1. **Les deux entrées « Mon parcours en une page » / « Mon Récap » dans un menu « Fiche PDF ▾ »
   n'existaient pas** dans `InsertionParcours.jsx` (le contrat § 1.1 les annonce comme posées).
   Le fichier ne portait ni import de `pdf-salarie`, ni menu déroulant — seulement un bouton
   « Fiche PDF ». **Sans conséquence fonctionnelle** : `DocumentsSalariePanel` (lot 7) produit
   lui-même les deux documents (`DocumentsSalariePanel.jsx:93-94`), et je l'ai **déplacé** dans
   l'onglet Situation comme prévu. Si un raccourci d'en-tête est souhaité, il reste à poser.
2. Les **deux autres ancrages du lot 7 étaient bien présents** et ont été **déplacés, jamais
   supprimés** : `<DocumentsSalariePanel employee={emp} />` → `OngletSituation` (bloc 7),
   `extra={<RappelsConsentement …/>}` → onglet « Dossier administratif »
   (`InsertionParcours.jsx:571`).
3. Tout le reste du pré-câblage était en place et n'a pas été touché : montages
   (`insertion/index.js`, `index.js` avec son `rateLimit`), `init-db.js`,
   `insertion-settings.js` (les 4 clés du lot 5), `rgpd-libelles.js` (les 4 codes),
   `App.jsx` (route publique hors `ProtectedRoute`). La prop `extra` de
   `DossierAdministratif` et la sonde IA d'`AdminInsertion` **étaient déjà faites** — ces deux
   fichiers n'ont donc pas eu à être modifiés.

---

## 4. Preuves chiffrées

| Preuve | Avant | Après |
|---|---|---|
| **Jest complet** (`cd backend && npx jest`) | 234 suites / 4 686 tests verts | **243 suites / 4 898 tests verts, 0 échec** |
| dont lot 5 | — | **110 tests** en 5 suites |
| **Build Vite** (`cd frontend && npm run build`) | vert | **vert** (11,1 s) |
| `InsertionParcours.jsx` | 1 853 lignes | **655 lignes** |
| `grep "window.confirm\|alert("` sur les 4 fichiers du § 5.4 | 3 | **0** (et 0 aussi sur les 7 composants créés) |
| `node -e "require(…)"` avec `JWT_SECRET`/`PCM_ENCRYPTION_KEY` factices | — | **8 modules OK** (service, 2 routeurs, migration, journal, `routes.js`, `rsa.js`, `index.js`) |

> Note : le delta de suites (+9) inclut la suite du lot 7, qui a commité en parallèle sur la
> même branche. Les 5 suites du lot 5 sont : `insertion-echeances-contract` (24),
> `insertion-eti-public-contract` (25), `insertion-liste-contract` (20),
> `echeances-cip` (27), `insertion-echeances` migration (14).

### Ce que les contrats exercent

- **Refus AVANT requête prouvé par `expect(mockQuery).not.toHaveBeenCalled()`** : MANAGER sur
  `POST /report` (403), jeton ETI malformé (404), corps hors liste blanche (400), avis ou durée
  invalide (400).
- **`pool.connect()` en échec** → 500 propre, `release()` **non** appelé.
- **Journal bloquant** : une écriture de `rgpd_audit_log` qui échoue → 500 **et ROLLBACK**.
- **Projection MANAGER** : `NULL::boolean AS brsa` dans le SQL, absence de `e.brsa,`.
- **Aucune clé interdite** dans la réponse ETI (liste des clés comparée triée + recherche de
  `frein_`, `brsa`, `ft_categorie`, `referent_unique`, `pass_iae`, `employee_id` dans le JSON).
- **Migration rejouée deux fois** : la seconde passe envoie *exactement* les mêmes instructions.

### Contre-épreuves par mutation (5, toutes restaurées)

| # | Mutation | Effet | Restauré |
|---|---|---|---|
| 1 | Retirer la garde `locked_at` de `chargerParJeton` (ETI) | **2 tests tombent** (410 `ENTRETIEN_CLOTURE` en GET et en PUT) | ✔ |
| 2 | Faire lire `e.brsa` au MANAGER dans `GET /insertion` | **1 test tombe** (la colonne apparaît dans le SQL) | ✔ |
| 3 | Neutraliser la règle « motif obligatoire au 2ᵉ report » | **1 test tombe** (409 `MOTIF_REQUIS` attendu) | ✔ |
| 4 | Retirer un champ de la copie frontend du socle | **1 test tombe** (les deux fichiers diffèrent) | ✔ |
| 5 | Servir toutes les familles d'obligations au MANAGER | **2 tests tombent** (requêtes FSE+/ASI parties, types sociaux rendus) | ✔ |

---

## 5. Décisions prises, et ce qu'elles coûtent

1. **Le compteur de la barre latérale n'est pas journalisé.** Il est appelé à chaque montage de
   page ; l'inscrire au registre RGPD le remplirait de lignes qui ne disent rien d'un accès à une
   donnée personnelle (la réponse est un entier). Les consultations réelles de l'écran, elles,
   sont tracées. *Coût assumé* : on ne peut pas reconstituer « qui a regardé sa pastille ».

2. **Le libellé libre d'une action critique ne sort pas** dans le bloc « Organisation du suivi »
   (`echeances-cip.js:594`). C'est un texte libre, et cet écran s'affiche à **tous** les rôles du
   module. Seul le retard est dit. Même doctrine que le correctif B-01 de la PR B (le titre libre
   d'un entretien primait sur la liste fermée dans un document destiné au CMS).

3. **« Sous 15 h » est une ligne agrégée**, avec son détail nominatif **à côté** et non en tête
   d'affiche. Amendement CIP § 10 : c'est un signal à porter au référent, pas un reproche
   individuel affiché en ouverture d'écran.

4. **Le lien ETI n'est exposé que s'il est vivant.** Un lien expiré rendu à l'écran serait envoyé
   par la CIP, et l'encadrant se heurterait à un 410. `lien_eti: null` ⇒ le bouton propose « Créer
   le lien encadrant ».

5. **La progression du diagnostic porte sur le socle seul.** Compter les approfondissements
   ferait stagner la barre d'un diagnostic pourtant terminé.

6. **Un booléen à `false` compte comme renseigné** dans la complétude du socle : « pas de RQTH »
   est une réponse, pas une absence. Le SQL et le JS appliquent la même règle.

---

## 6. Ce qui reste, et pour qui

### Pour l'agent **debug sur PostgreSQL réel**
- La migration `insertion-echeances` rejouée deux fois sur base neuve **et** sur une base où la
  table `insertion_echeance_reports` préexiste sans son CHECK (chemin DO-scan).
- **Cohérence du délai de sortie FSE+** entre le moteur (§ 1.1 point 2) et l'alerte de fiche de
  `routes.js` sur un dossier sans `pp.date_sortie` — ils doivent dire la même chose.
- Le SQL de complétude du socle sur des données réelles : `array_length` sur `ressources` /
  `moyen_transport` (colonnes `TEXT[]`), `TRIM` sur `cecrl_niveau` (VARCHAR).
- Le tri des obligations sous `TZ=UTC` **et** `TZ=Europe/Paris` (les jours civils passent par
  `utils/date-iso.js`, mais `chargerOrganisation` compare des dates rendues par PostgreSQL).
- Le cache 60 s du compteur : vérifier qu'un report le vide bien (`viderCacheCompteur`).

### Pour l'agent **revue sécurité**
- `GET /api/eti/renouvellement/:token` est **publique et rate-limitée au montage** (60 req /
  15 min par IP, pré-câblé) : vérifier que la limite tient pour un atelier derrière une seule IP.
- `referent_unique` rouge pour tous : confirmer que le libellé ne permet aucune inférence de
  statut social (test présent, mais c'est un sujet de doctrine).
- `PUT /api/eti/…` n'a **aucune** authentification : la seule preuve est le jeton. Le snapshot
  d'historisation écrit `changed_by = NULL`.

### À l'**arbitrage** (direction / DPO / orchestrateur)
1. **Volume de la ligne « référent unique non déterminé »** : rouge pour tous les parcours, comme
   le contrat le demande. Sur une base où le champ n'est pas encore saisi, elle dominera l'écran
   le premier jour. Faut-il une période de grâce (par exemple, seulement après 30 jours de
   parcours) ?
2. **Place d'`AlertesBloc`** (§ 2.2) : en-tête (retenu) ou onglet Situation ?
3. **Raccourci « Mon parcours / Mon Récap » dans l'en-tête** (§ 3 point 1) : souhaité en plus du
   panneau de l'onglet Situation ?

### Hors périmètre du lot 5 (rappel)
Le reporting autorité (lot 6, PR D), la documentation collaborateurs (lot 8), l'espace salarié
en ligne et l'API Emplois de l'inclusion.

---

## 7. Au déploiement

`deploy.sh update` — la migration est idempotente et appelée par `init-db.js` dans sa
transaction. **Aucun paramétrage requis** : les quatre réglages du lot (`eti_token_validite_jours`
60, `report_echeance_heures` 48, `file_active_terminees_mois` 7, `categorie_g_alerte_jours` 30)
ont leurs défauts en code et sont éditables dans les Réglages insertion.

**À dire aux CIP** : l'espace CIP s'ouvre maintenant sur « Mes échéances » ; la liste de gauche
ne contient plus les permanents mais garde les personnes sorties pendant sept mois — c'est
voulu, c'est après la sortie que la donnée FSE+ et le relevé à six mois sont dus. Le bouton
« Copier le lien encadrant » copie désormais un lien que l'encadrant peut ouvrir **sans compte**,
valable 60 jours ; le regénérer tue le précédent.

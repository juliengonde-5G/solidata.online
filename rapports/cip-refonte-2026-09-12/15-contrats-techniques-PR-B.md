# PR B « Cadre RSA et temps d'accompagnement » — Contrats techniques figés

> Orchestrateur, 13/09/2026. **Tout agent de lot lit ce fichier en entier avant d'écrire une ligne.**
> Branche : `claude/solidata-cip-redesign-9fskwq-pr-b`, **empilée sur la PR A** (#166, branche `claude/solidata-cip-redesign-9fskwq`) — tout ce que la PR A a livré (migrations `insertion-cadre.js` / `insertion-fse.js`, routeurs `cadre`/`pieces`/`projets`/`fse`/`conformite`, `utils/fse-schema.js`, `services/fse-participants.js`, onglet Dossier administratif) **existe et se réutilise**.
> Références : plan 07 (§ 3 lots 3-4, § 8 décisions 1/4/5, § 9 amendements A3/A4/F2/« structure d'accueil »), organisation 08 (§ 1 blocs, § 10 amendements CIP — **font foi pour les libellés et les règles d'affichage**), matrice autorité 09 (§ 2 exports **(c)** feuille de temps et **(f)** fiche pour le référent — **font foi pour le contenu**, § 3 conséquences « structure d'accueil »), contrats PR A (10) pour les conventions.
> Doctrines du dépôt (CLAUDE.md § 7-8) : requêtes paramétrées, `authenticate + authorize`, migrations idempotentes (`client.query`, aucune transaction interne, CHECK reconstruits par DO-scan `pg_constraint`), **jamais de valeur inventée** (NULL reste NULL, une semaine sans relevé d'heures n'est pas une semaine à 0 h), journalisation `rgpd_audit_log` des lectures et écritures nominatives sensibles et de tout document destiné à un tiers, tests de contrat avec `pg` simulé (pattern `backend/tests/contract/insertion-cadre-contract.test.js`), refus posés **avant** toute lecture en base.

## 0. Règles de travail des agents de lot
1. **Fichiers disjoints** : chaque lot ne modifie QUE les fichiers de sa colonne (§ 1). Un besoin hors périmètre → le noter dans son rapport final, ne jamais toucher le fichier d'un autre lot.
2. **Aucune commande git** (l'orchestrateur commit). Aucun `npm install`.
3. Les points d'intégration (§ 2) sont **déjà câblés** : les squelettes existent, l'agent les REMPLIT.
4. Chaque lot livre : code + tests Jest + un rapport `rapports/cip-refonte-2026-09-12/16-realisation-lot<N>.md` (fait / preuves / écarts / reste). `cd backend && npx jest <ses fichiers>` vert ; `cd frontend && npx vite build` vert si le lot touche le front.
5. Français à l'écran, libellés de 08 § 10 : « Point avec le référent », « Entretien de conciliation (protection des droits) », « Fiche pour le référent », « Relevé d'assiduité », « Temps d'accompagnement », « Feuille de temps ».
6. **Trois règles de fond, non négociables** :
   - Le compteur 15-20 h n'est **jamais présenté au salarié comme un seuil** (aucun libellé « seuil », « obligation », « insuffisant » sur un document remis à la personne) ; l'alerte ne se déclenche qu'à **2 semaines consécutives** sous le minimum, **jamais pendant un arrêt déclaré** (`employee_leaves.type_category IN ('sick','absence')` couvrant la semaine), jamais sur une semaine **sans relevé** d'heures.
   - La fiche pour le référent et le relevé d'assiduité sont des documents **qui sortent vers un tiers** : contenu en **liste blanche côté serveur** (§ 6), santé et judiciaire **exclus sans mention de l'exclusion**, motif d'absence **catégorisé seulement** (jamais `employee_leaves.leave_type` en clair, seulement `type_category`), une absence sans motif n'est **jamais** imprimée « injustifiée ».
   - Les statuts sociaux (BRSA, catégorie FT, référent unique, actualisation FT) restent **ADMIN/RH strict** ; les heures travaillées et les durées d'accompagnement ne sont pas sensibles mais les routeurs `/rsa` et `/temps` sont **ADMIN/RH**, à l'exception de la feuille de temps qu'un MANAGER lit et signe **pour son propre `user_id`** uniquement.

## 1. Propriété des fichiers

| Lot | Agent | Fichiers (exclusifs) |
|---|---|---|
| **3 — Cadre RSA (structure d'accueil)** | rsa | `backend/src/scripts/migrations/insertion-rsa.js`, `backend/src/services/activite-hebdo-engine.js` (**pur**), `backend/src/services/activite-hebdo.js` (accès base), `backend/src/services/fiche-referent.js` (liste blanche + relevé d'assiduité, accès base), `backend/src/routes/insertion/rsa.js`, `backend/src/routes/insertion/routes.js` (**uniquement** les retouches § 5.3), `backend/src/utils/insertion-settings.js` (TOUTES les clés § 4, lots 3 et 4), `backend/src/services/anonymization.js` (purge des tables des lots 3 ET 4, § 3), `frontend/src/utils/rgpd-libelles.js` (TOUS les codes § 7, lots 3 et 4), `frontend/src/components/insertion/EntretienForm.jsx`, `frontend/src/components/insertion/DossierAdministratif.jsx`, `frontend/src/components/insertion/ActiviteHebdo.jsx` (nouveau), `frontend/src/components/insertion/FicheReferentPanel.jsx` (nouveau), `frontend/src/components/insertion/pdf-referent.js` (nouveau), `frontend/src/components/insertion/parametres.js`, `frontend/src/pages/InsertionParcours.jsx` (en-tête + menu PDF + bloc « Rendez-vous réguliers et rappels » du `CohortePanel`), `frontend/src/pages/AdminInsertion.jsx` (nouveaux réglages), `backend/tests/contract/insertion-rsa-contract.test.js`, `backend/tests/unit/services/activite-hebdo-engine.test.js`, `backend/tests/unit/services/fiche-referent.test.js`, `backend/tests/unit/scripts/insertion-rsa-migration.test.js` |
| **4 — Temps d'accompagnement** | temps | `backend/src/scripts/migrations/insertion-temps.js`, `backend/src/services/temps-engine.js` (**pur**), `backend/src/services/temps-accompagnement.js` (accès base), `backend/src/routes/insertion/temps.js`, `frontend/src/pages/TempsAccompagnement.jsx`, `frontend/src/components/insertion/FeuilleTemps.jsx` (nouveau), `frontend/src/components/insertion/pdf-temps.js` (nouveau), `backend/tests/contract/insertion-temps-contract.test.js`, `backend/tests/unit/services/temps-engine.test.js`, `backend/tests/unit/scripts/insertion-temps-migration.test.js` |
| Orchestrateur | — | `backend/src/routes/insertion/index.js`, `backend/src/scripts/init-db.js` (2 hooks), `frontend/src/App.jsx`, `frontend/src/components/Layout.jsx`, branchement de `heuresAccompagnement` dans `gatherAuditKpis` (§ 5.4), `CLAUDE.md`, docs, intégration, commits |

## 2. Points d'intégration déjà câblés (ne pas modifier)
- `routes/insertion/index.js` monte, avant `routes.js` : `./rsa` (préfixe `/rsa`) et `./temps` (`/temps`). Chaque module exporte un `express.Router()` **sans** `authenticate` (hérité : `authenticate, requireMfa, authorize('ADMIN','RH','MANAGER')`) ; restreindre localement avec `authorize('ADMIN','RH')` **posé avant les validateurs** (refus avant toute lecture).
- `init-db.js` appelle, dans la transaction, après `insertion-fse` : `await require('./migrations/insertion-rsa').run(client)` puis `await require('./migrations/insertion-temps').run(client)`. Signature `module.exports = { run }`, `run(client)` idempotent, `client.query` uniquement, `console.log('[INIT-DB] … ✓')`.
- `App.jsx` : route `/insertion/temps` (ADMIN, RH, MANAGER) → `pages/TempsAccompagnement.jsx` (squelette à remplacer par le lot 4). `Layout.jsx` : entrée « Temps d'accompagnement » (ADMIN, RH, MANAGER) après « Dossiers FSE+ ».
- Squelettes créés : `services/temps-accompagnement.js` exporte `heuresAccompagnement` (rend `null` — le lot 4 le remplit ; l'orchestrateur le branche dans `gatherAuditKpis` à l'intégration).

## 3. Schéma (DDL de référence — les migrations la reproduisent à l'identique)

### Lot 3 — `migrations/insertion-rsa.js`
```sql
-- (a) Types d'entretien : CHECK milestone_type reconstruit par DO-scan (pattern init-db (8a) : ne toucher au CHECK que s'il ne contient pas le marqueur 'conciliation')
--     nouvelle liste : 'diagnostic_accueil','bilan_intermediaire','renouvellement','bilan_sortie','suivi_post_sortie','periode_essai','point_etape_referent','conciliation'
ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS referent_modalite VARCHAR(12);          -- 'tripartite' | 'bilaterale' (point_etape_referent), CHECK par DO-scan
ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS conciliation_motifs JSONB;              -- liste FERMÉE de codes (voir § 6.3), jamais de texte libre médical
ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS conciliation_issue VARCHAR(20);         -- 'maintien' | 'reprise' | 'orientation' | 'sans_suite', CHECK par DO-scan

-- (b) Actions : date de réalisation (feuille de temps et compteur en ont besoin)
ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS date_realisation DATE;
UPDATE cip_action_plans SET date_realisation = updated_at::date WHERE date_realisation IS NULL AND status = 'realise';   -- reprise UNE fois, approximation documentée

-- (c) Fiches pour le référent : trace de ce qui est SORTI vers le tiers
CREATE TABLE IF NOT EXISTS insertion_alimentations_referent (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  parcours_num INTEGER NOT NULL DEFAULT 1,
  moment VARCHAR(15) NOT NULL CHECK (moment IN ('entree','renouvellement','sortie','demande')),
  periode_debut DATE NOT NULL, periode_fin DATE NOT NULL,
  destinataire_type VARCHAR(20) NOT NULL,               -- copie de employees.referent_unique_type au moment de la génération
  destinataire_nom VARCHAR(150),
  contenu JSONB NOT NULL,                                -- SNAPSHOT en liste blanche (§ 6.1) — c'est la preuve de ce qui a été transmis
  genere_par INTEGER REFERENCES users(id), genere_le TIMESTAMP NOT NULL DEFAULT NOW(),
  remis_referent_le DATE, remis_referent_mode VARCHAR(15) CHECK (remis_referent_mode IS NULL OR remis_referent_mode IN ('mail','courrier','main_propre','plateforme')),
  remis_salarie_le DATE,                                 -- « un exemplaire remis à la personne » (09 (f))
  remise_par INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_alim_referent_employee ON insertion_alimentations_referent(employee_id, genere_le DESC);

-- (d) Actualisation mensuelle France Travail : un registre par mois, jamais un booléen seul (amendement A3)
CREATE TABLE IF NOT EXISTS insertion_actualisations_ft (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  mois DATE NOT NULL,                                    -- 1er jour du mois
  rappel_le DATE, rappel_par INTEGER REFERENCES users(id),
  honoree BOOLEAN,                                       -- NULL = inconnu, true/false = constaté ; jamais déduit
  constat_le DATE,
  UNIQUE(employee_id, mois)
);
-- Le service recalcule employees.actualisation_ft_derniere_date (max mois honorée) et
-- employees.actualisation_ft_rappels_non_honores (rappels dont honoree = false) à chaque écriture.
```
Registre art. 30 : entrée « Transmission d'informations au référent unique (RSA) — fiche pour le référent » (`ON CONFLICT DO NOTHING` sur le nom, base légale « mission d'intérêt public — à confirmer par le DPO », destinataires « référent unique CMS / France Travail », durée « durée du parcours + 2 ans ») — même pattern que l'entrée FSE+ de `insertion-fse.js`.

### Lot 4 — `migrations/insertion-temps.js`
```sql
-- (a) Temps hors salarié saisi par l'intervenant (ateliers collectifs, réunions de projet)
CREATE TABLE IF NOT EXISTS insertion_temps_saisies (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  projet_id INTEGER REFERENCES insertion_projets(id) ON DELETE SET NULL,   -- NULL = hors projet
  activite VARCHAR(20) NOT NULL CHECK (activite IN ('atelier_collectif','reunion_projet','autre')),
  duree_minutes SMALLINT NOT NULL CHECK (duree_minutes > 0 AND duree_minutes <= 600),
  libelle VARCHAR(200),
  created_by INTEGER REFERENCES users(id), created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_temps_saisies_user_date ON insertion_temps_saisies(user_id, date);

-- (b) Feuille de temps mensuelle : une par intervenant et par mois, composée à la lecture, FIGÉE à la validation
CREATE TABLE IF NOT EXISTS insertion_feuilles_temps (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  annee SMALLINT NOT NULL, mois SMALLINT NOT NULL CHECK (mois BETWEEN 1 AND 12),
  statut VARCHAR(22) NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','validee_intervenant','validee_rh')),
  lignes JSONB,                                          -- snapshot des lignes AU MOMENT de la validation intervenant (§ 6.4) ; NULL tant que brouillon
  totaux JSONB,                                          -- { total_minutes, par_projet: {code: minutes}, quotites: {code: pct}, taux_forfaitaire: {code: pct} }
  coherence JSONB,                                       -- { conforme: bool, anomalies: [{date, type:'jour_absence'|'depassement_contractuel', detail}] }
  validation_intervenant JSONB,                          -- { user_id, at }
  validation_rh JSONB,                                   -- { user_id, at }
  created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, annee, mois)
);
```
Aucune donnée nominative de salarié dans `lignes` **au-delà de l'identifiant interne** (`employee_id`) : la version transmise (CSV/PDF) n'imprime **jamais le nom** du bénéficiaire (09 (c)).

## 4. Réglages (`utils/insertion-settings.js`, défauts EN CODE — lot 3 les ajoute tous)
| Clé | Défaut | Usage |
|---|---|---|
| `insertion.cer_heures_min` | 15 | plancher hebdo d'activité (travail + accompagnement) |
| `insertion.cer_heures_max` | 20 | plafond informatif (jamais une alerte) |
| `insertion.semaines_sous_seuil_consecutives` | 2 | nombre de semaines consécutives sous le plancher qui déclenche l'alerte |
| `insertion.point_etape_referent_mois` | 3 | périodicité attendue d'un point avec le référent OU d'une fiche pour le référent remise |
| `insertion.feuille_temps_cloture_jour` | 10 | jour du mois suivant à partir duquel une feuille non validée est signalée |
Exposés par `GET /insertion/parametres` (retouche § 5.3) et éditables dans `AdminInsertion.jsx` ; miroir dans `components/insertion/parametres.js`.

## 5. API

### 5.1 Lot 3 — `routes/insertion/rsa.js` (préfixe `/api/insertion/rsa`, **ADMIN/RH** sur tout le routeur)
| Méthode | Route | Réponse / règles |
|---|---|---|
| GET | `/:employeeId/activite?annee=` | `{ employee_id, annee, seuil_min, seuil_max, semaines: [{ iso_year, iso_week, week_start, heures_travail (null si aucun relevé), minutes_accompagnement, jours_pmsmp, total_heures (null si heures_travail null), sous_seuil (bool|null), arret_declare (bool), sans_releve (bool) }], nb_semaines_sous_seuil, nb_semaines_relevees, alerte: { active, depuis_semaine } , raisons: [{ iso_week, categorie: 'arret'|'temps_partiel'|'absence'|'inconnue' }] }`. Calcul par `activite-hebdo.js` → `activite-hebdo-engine.js` (§ 6.2). Journalisé `INSERTION_ACTIVITE_CONSULTATION`. |
| GET | `/:employeeId/assiduite?du=&au=` | relevé § 6.3 (JSON). Journalisé `INSERTION_ASSIDUITE_CONSULTATION`. |
| GET | `/:employeeId/fiche-referent?du=&au=` | **aperçu** de la fiche (JSON liste blanche § 6.1) sans écriture. Journalisé `INSERTION_FICHE_REFERENT_APERCU`. 409 `REFERENT_NON_DETERMINE` si `employees.referent_unique_type = 'non_determine'` (une fiche sans destinataire n'existe pas — 09 § 3.1). |
| POST | `/:employeeId/fiche-referent` `{ moment, du, au }` | génère et **enregistre** le snapshot (`insertion_alimentations_referent`), renvoie `{ id, contenu }`. 201. Journalisé `INSERTION_FICHE_REFERENT_GENERATION`. |
| GET | `/:employeeId/alimentations` | liste (id, moment, période, destinataire, genere_le, remis_referent_le, remis_salarie_le) — jamais `contenu`. |
| GET | `/:employeeId/alimentations/:id` | une fiche enregistrée avec `contenu` (pour la réimpression). Journalisé `INSERTION_FICHE_REFERENT_CONSULTATION`. |
| PUT | `/:employeeId/alimentations/:id/remise` `{ remis_referent_le, remis_referent_mode, remis_salarie_le }` | trace de remise ; champs partiels acceptés ; une date future → 400. Journalisé `INSERTION_FICHE_REFERENT_REMISE`. |
| GET | `/:employeeId/actualisations-ft?annee=` | 12 lignes (mois, rappel_le, honoree, constat_le), mois sans ligne = `null` (jamais inventé). |
| PUT | `/:employeeId/actualisations-ft/:mois` (`mois` = `AAAA-MM`) `{ rappel_le?, honoree?, constat_le? }` | upsert ; 409 `ACTUALISATION_FT_NON_REQUISE` si `employees.referent_unique_type <> 'france_travail'` ET `actualisation_ft_requise = false` ; recalcule les 2 colonnes `employees` ; journalisé `INSERTION_ACTUALISATION_FT_MAJ`. |
| GET | `/echeances-periodiques` | agrégat pour le bloc « Rendez-vous réguliers et rappels » : `{ actualisations_ft_du_mois: [{employee_id, nom, rappel_le|null, honoree|null}], points_referent_dus: [{employee_id, nom, dernier_le|null, du_depuis_jours}], semaines_sous_seuil: { nb_salaries, employes:[{employee_id, nom, nb_semaines}] }, dtr: { trimestre, echeance } , referents_non_determines: [{employee_id, nom}] }`. « Dernier point » = max(`insertion_milestones.completed_date` type `point_etape_referent`, `insertion_alimentations_referent.remis_referent_le`). Périmètre : `insertion_status = 'en_parcours'`. |

Validation : `express-validator` comme les autres routeurs (`param('employeeId').isInt()`, dates `isISO8601`). Toute route lit `parcours_num` courant depuis `employees.parcours_num` (repli 1), comme `cadre.js`.

### 5.2 Lot 4 — `routes/insertion/temps.js` (préfixe `/api/insertion/temps`)
Garde locale : `ADMIN`/`RH` tout ; `MANAGER` uniquement si `req.params.userId == req.user.id` (comparaison numérique), sinon **403 avant toute requête**.
| Méthode | Route | Réponse / règles |
|---|---|---|
| GET | `/intervenants` | ADMIN/RH : utilisateurs actifs de rôle RH/ADMIN/MANAGER ayant ≥ 1 poste projet OU ≥ 1 entretien mené (`interviewer_id`) dans l'année ; `[{ user_id, nom, postes:[{projet_code, quotite_pct}] }]`. |
| GET | `/synthese?annee=&projet=` | ADMIN/RH : `{ annee, global_minutes, par_projet:[{code, nom, minutes, taux_forfaitaire_pct}], par_salarie:[{employee_id, nom, minutes}] (ADMIN/RH seulement), par_intervenant:[{user_id, nom, minutes}] }` via `heuresAccompagnement`. |
| GET | `/:userId/:annee/:mois` | feuille composée (§ 6.4) : si `statut <> 'brouillon'` → renvoie le snapshot figé ; sinon compose à la volée sans écrire. `{ user_id, annee, mois, statut, lignes, totaux, coherence, validation_intervenant, validation_rh, cloture_depassee (bool) }`. |
| POST | `/:userId/:annee/:mois/saisies` `{ date, projet_id|null, activite, duree_minutes, libelle }` | 409 `FEUILLE_FIGEE` si statut ≠ brouillon ; `date` dans le mois sinon 400 ; 201. |
| DELETE | `/saisies/:id` | même garde (propriétaire ou ADMIN/RH), 409 si la feuille du mois est figée. |
| POST | `/:userId/:annee/:mois/valider` | transition **forward-only** : brouillon → `validee_intervenant` (par l'intervenant lui-même ou ADMIN/RH) — **fige `lignes`/`totaux`/`coherence`** ; `validee_intervenant` → `validee_rh` (ADMIN/RH seulement, et **pas le même user_id** que l'intervenant : 409 `AUTO_VALIDATION`). 409 `COHERENCE_NON_CONFORME` **n'existe pas** : une anomalie n'empêche pas la signature, elle est imprimée (« à expliquer »). Journalisé `INSERTION_FEUILLE_TEMPS_VALIDATION`. |
| POST | `/:userId/:annee/:mois/rouvrir` | ADMIN seulement, motif obligatoire, `validee_rh` → `brouillon` (les validations sont effacées, le motif journalisé `INSERTION_FEUILLE_TEMPS_REOUVERTURE`). |
| GET | `/:userId/:annee/:mois/export.csv` | export **(c)** : une ligne par ligne de feuille — `Date;Projet;Activité;Bénéficiaire (identifiant interne);Durée (min);Origine` + pied (total, par projet, quotité, taux forfaitaire, ligne de cohérence) ; en-tête de traçabilité ; **409 `EXPORT_VIDE`** si aucune ligne ; neutralisation des formules (`utils/export-csv.js`) ; journalisé `EXPORT_FEUILLE_TEMPS`. |

### 5.3 Retouches de `routes/insertion/routes.js` (lot 3, limitées à ceci)
1. `MILESTONE_FIELDS`/validateurs du `PUT /milestones/:id` et de la création : accepter `referent_modalite`, `conciliation_motifs` (tableau de codes § 6.3, `isArray` + liste fermée), `conciliation_issue` ; ajouter `conciliation_motifs` à `MILESTONE_JSONB_FIELDS`.
2. Création d'entretien : types `point_etape_referent` et `conciliation` acceptés (liste des types autorisée) ; `duree_minutes` proposé 60 / 45 (déjà lu dans `insertion.duree_entretien_defaut` — ajouter les deux clés à l'objet par défaut de `insertion-settings.js` et à `parametres.js`).
3. `PUT /action-plans/:id` (et la route de changement de statut si distincte) : quand `status` passe à `realise`, `date_realisation = COALESCE(date_realisation, CURRENT_DATE)` ; `date_realisation` acceptée en écriture explicite.
4. `GET /parametres` : renvoyer les 5 clés du § 4.
Rien d'autre dans ce fichier.

### 5.4 Intégration orchestrateur
`gatherAuditKpis(year)` reçoit une entrée `heures_accompagnement` = résultat de `heuresAccompagnement({ annee })` (lot 4) en mode `soft` (null si échec). Ne pas le faire dans les lots.

## 6. Règles métier figées

### 6.1 Fiche pour le référent — liste blanche (09 (f), 08 § 10) — `services/fiche-referent.js`
`composerFicheReferent({ employeeId, du, au, userId })` renvoie EXACTEMENT ces clés, rien d'autre (un test de contrat vérifie l'ensemble des clés de premier niveau) :
1. `identite` : `{ nom, prenom, identifiant_interne (employees.id), matricule (malibou_id), destinataire: { type, nom, contact }, periode: { du, au }, conseillere: { nom, contact } }`
2. `situation_emploi` : `{ type_contrat, date_debut, date_fin_prevue, quotite_hebdo (weekly_hours), parcours_num, pass_iae: { statut, fin } }`
3. `activite` : `{ semaines: [{ iso_week, heures_travail, minutes_accompagnement, jours_pmsmp }], nb_semaines_sous_seuil, raisons_categorisees: [...] }` (issu de `activite-hebdo.js`) — **sans** les mots « seuil », « obligation » dans les libellés du PDF : le PDF titre « Activité hebdomadaire » et « Semaines sous 15 h : N ».
4. `assiduite` : `{ rdv_proposes, rdv_honores, absences_par_motif: { sante, administratif, garde, transport, autre, sans_motif } }` — **jamais** `absence_piece_ref`, jamais un texte.
5. `freins` : uniquement `mobilite, administratif, finances, logement, linguistique, famille, numerique` — `{ axe, niveau_debut, niveau_fin }` (premier et dernier entretien de la période, null si non évalué). **`sante` et `judiciaire` absents de l'objet** (pas de clé, pas de mention).
6. `actions` : `[{ date, nature (category), partenaire (nom), orientation_dora (bool si partenaire.source = 'dora' ou libellé contient DORA — sinon false), resultat }]` — actions dont `frein_type IN ('sante','judiciaire')` **exclues** (ligne entière, comme `masking.js`), `notes` jamais.
7. `objectifs` : `[{ libelle, origine, statut, echeance }]` (en cours seulement).
8. `prochaines_echeances` : `{ prochain_rdv, fin_contrat, prochain_point_referent }`.
9. `mentions` : `{ droits: <texte fixe : droits d'accès/rectification/opposition, DPO>, genere_le }`.
Le PDF (`pdf-referent.js › exportFicheReferentPDF`) imprime ces 9 rubriques dans cet ordre, signature de la conseillère + date, pied « Exemplaire remis à la personne le … », pattern `openPrintWindow` de `pdf-insertion.js`.

### 6.2 Compteur hebdomadaire — `services/activite-hebdo-engine.js` (pur)
`calculerSemaines({ annee, weekHours, milestones, actions, pmsmp, leaves, seuilMin, seuilMax, consecutives })` :
- une semaine ISO par ligne `employee_week_hours` (`hours_worked`) ; les semaines **sans ligne** sont listées `sans_releve: true`, `heures_travail: null`, `total_heures: null`, `sous_seuil: null` (jamais 0) ;
- `minutes_accompagnement` = Σ `duree_minutes` des entretiens réalisés (`completed_date` dans la semaine) + actions (`date_realisation` dans la semaine) ; `jours_pmsmp` = jours ouvrés de la semaine couverts par une PMSMP ;
- `total_heures = heures_travail + minutes_accompagnement/60` (décision 4 : le travail compte) ;
- `arret_declare` = un congé `type_category IN ('sick','absence')` couvre ≥ 1 jour ouvré de la semaine ;
- `sous_seuil = total_heures < seuilMin` quand `total_heures` est connu ; `raison` : `arret` si `arret_declare`, `absence` si `leaves` holiday, `temps_partiel` si `hours_contract < seuilMin`, sinon `inconnue` ;
- `alerte.active` = il existe `consecutives` semaines consécutives **relevées**, `sous_seuil = true`, **aucune** avec `arret_declare` ; `depuis_semaine` = la première de la série la plus récente ;
- `nb_semaines_sous_seuil` compte toutes les semaines `sous_seuil = true` (arrêt compris — c'est l'indicateur de l'autorité A4 ; l'alerte, elle, exclut les arrêts).
Semaines ISO à pivot jeudi (réutiliser `services/effectifs-engine.js` si une fonction ISO y est exportée, sinon fonction locale testée).

### 6.3 Assiduité et conciliation
- Relevé d'assiduité (`services/fiche-referent.js › composerReleveAssiduite`) sur une période : `entretiens: [{ date, type_libelle, presence, absence_motif|null }]` (jamais `absence_piece_ref` dans la version tiers ; la version dossier — `variante: 'dossier'` — l'inclut), `actions: [{ date, libelle, statut }]`, `absences_paie: [{ du, au, categorie }]` (**`type_category` seulement**, jamais `leave_type`), `totaux: { rdv_proposes, rdv_honores, absents, excuses, sans_motif }`. Libellé imprimé pour une absence sans motif : « motif non renseigné » — jamais « injustifiée ».
- Motifs légitimes de conciliation (liste fermée, codes) : `sante`, `garde_enfant`, `transport`, `demarche_administrative`, `formation_emploi`, `deuil_famille`, `autre` — le formulaire **commence** par ces motifs (08 § 10) ; `conciliation_issue` ∈ `maintien | reprise | orientation | sans_suite`.
- `point_etape_referent` est **hors compteur d'entretiens** des indicateurs existants (B1 : ne pas le compter dans « entretiens réalisés » de `cohorte/stats` — le lot 3 vérifie que les requêtes existantes filtrent par types explicites ; si elles comptent tout, ajouter `AND milestone_type <> 'point_etape_referent'` **est une retouche autorisée** de `routes.js`, à lister au rapport).

### 6.4 Feuille de temps — `services/temps-engine.js` (pur)
`composerLignes({ annee, mois, milestones, actions, saisies, postes })` → lignes `{ date, projet_code ('ASI'|'OCS'|'HORS_PROJET' — code réel du projet), activite ('entretien'|'action'|'atelier_collectif'|'reunion_projet'|'autre'), employee_id|null, duree_minutes, origine ('composee'|'saisie'), source_id }` :
- entretiens : `insertion_milestones` réalisés avec `interviewer_id = userId` et `duree_minutes` non nul (`completed_date` dans le mois) — **sans durée = pas de ligne** (jamais inventée) ; projet = projet ASI où le salarié est participant actif à cette date, sinon projet OCS si l'intervenant y a un poste actif, sinon `HORS_PROJET` ;
- actions : `cip_action_plans` avec `created_by = userId`, `status = 'realise'`, `duree_minutes` non nul, `date_realisation` dans le mois ; même règle de projet ;
- saisies : telles quelles.
`calculerTotaux(lignes, postes, projets)` → `{ total_minutes, par_projet, quotites (quotite_pct du poste), taux_forfaitaire (taux_forfaitaire_pct du projet) }`.
`verifierCoherence({ lignes, leaves, weeklyHours })` → `{ conforme, anomalies }` : `jour_absence` si une ligne tombe un jour couvert par un congé de l'intervenant (via `employees.user_id = userId` → `employee_leaves`, toutes catégories) ; `depassement_contractuel` si `total_minutes/60 > weekly_hours × nb_semaines_du_mois × 1,0` (repli 35 h si inconnu, dit dans l'anomalie). Aucune anomalie ne bloque : elle s'imprime.
Durées déclaratives annoncées telles quelles sur le PDF (« durées déclarées par l'intervenant à la clôture des entretiens »).

## 7. Codes du journal RGPD à libeller (`frontend/src/utils/rgpd-libelles.js`, lot 3)
`INSERTION_ACTIVITE_CONSULTATION`, `INSERTION_ASSIDUITE_CONSULTATION`, `INSERTION_FICHE_REFERENT_APERCU`, `INSERTION_FICHE_REFERENT_GENERATION`, `INSERTION_FICHE_REFERENT_CONSULTATION`, `INSERTION_FICHE_REFERENT_REMISE`, `INSERTION_ACTUALISATION_FT_MAJ`, `INSERTION_FEUILLE_TEMPS_VALIDATION`, `INSERTION_FEUILLE_TEMPS_REOUVERTURE`, `EXPORT_FEUILLE_TEMPS`. La garde anti-dérive des libellés fait échouer la suite tant qu'un code n'est pas traduit.

## 8. Anonymisation (`services/anonymization.js`, lot 3)
À l'anonymisation d'un salarié : `DELETE` intégral de `insertion_alimentations_referent` et `insertion_actualisations_ft` (FK CASCADE en plus, ceinture et bretelles, comme les notes de suivi) ; `insertion_feuilles_temps.lignes` : les `employee_id` du salarié anonymisé sont **remplacés par `null`** dans le JSONB (la feuille reste une pièce de financement ≥ 5 ans, le lien nominatif disparaît) ; `insertion_temps_saisies` n'a aucun lien salarié.

## 9. Front
- **Lot 3** : `EntretienForm.jsx` — types « Point avec le référent » (modalité tripartite / bilatérale, hors compteur) et « Entretien de conciliation (protection des droits) » (motifs légitimes **en premier**, issue) ; `ActiviteHebdo.jsx` — badge discret d'en-tête (« Activité : 18 h/sem. » + point orange si alerte ; jamais le mot seuil) et tableau détaillé dans le Dossier administratif ; `FicheReferentPanel.jsx` — section « Fiche pour le référent » du Dossier administratif : aperçu, bouton « Générer la fiche » (moment), liste des fiches avec trace de remise (référent / salarié), bouton « Imprimer », bloc « Actualisation France Travail » (12 mois, cases rappel / honorée) visible si référent = FT ; entrée « Fiche pour le référent » et « Relevé d'assiduité » dans le menu **Fiche PDF ▾** de l'en-tête de `InsertionParcours.jsx` ; bloc **« Rendez-vous réguliers et rappels »** dans `CohortePanel` (4 lignes : actualisations FT du mois, points référent dus, « N salariés sous 15 h » agrégé, référents non déterminés en rouge).
- **Lot 4** : `pages/TempsAccompagnement.jsx` — sélecteur intervenant (ADMIN/RH ; MANAGER : lui-même seulement) + mois ; `FeuilleTemps.jsx` — tableau des lignes (composées grisées, saisies éditables), ajout d'une saisie (date, projet, activité, durée par **rangée de boutons** 15/30/45/60/90/120 + champ libre), totaux par projet avec quotité et taux forfaitaire, **ligne de cohérence** (« conforme » vert / « à expliquer » ambre avec le détail), boutons « Valider (intervenant) » / « Valider (RH) », badge de statut, « Exporter CSV » / « Imprimer » (`pdf-temps.js › exportFeuilleTempsPDF` : signatures horodatées, mention des durées déclaratives, **identifiant interne à la place du nom**). Onglet « Synthèse » (ADMIN/RH) : heures par projet / intervenant / salarié.
- Charte : composants existants (`components/ui`), teal, cartes `bg-white rounded-xl border`, libellés français, aucun `alert()`.

## 10. Preuves attendues de chaque lot
Jest vert sur ses fichiers ; ≥ 1 contre-épreuve par mutation décrite au rapport ; les tests de contrat vérifient : refus 403 **avant** toute requête (`pool.query` non appelé), liste blanche exacte de la fiche (clés de premier niveau et absence de `sante`/`judiciaire`), « sans relevé ≠ 0 h », alerte non levée pendant un arrêt, feuille figée après validation, auto-validation refusée, export vide → 409, nom du bénéficiaire absent du CSV.

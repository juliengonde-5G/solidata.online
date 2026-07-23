# État des lieux technique — Extension du module Insertion

- **Date** : 22 juillet 2026
- **Mission** : inventaire factuel exhaustif de l'existant, base du plan de codage (cf. `00-cahier-des-charges.md`)
- **Méthode** : lecture du code sur la branche de travail ; toutes les références sont au format `fichier:ligne`
- **Périmètre** : schéma de données, API backend, frontend, mécanismes transverses, table des écarts CDC ↔ existant

Convention des références (chemins relatifs à la racine du dépôt) :
- `init-db.js` = `backend/src/scripts/init-db.js`
- `routes.js` = `backend/src/routes/insertion/routes.js`
- `engine.js` = `backend/src/routes/insertion/engine.js`
- `InsertionParcours.jsx` = `frontend/src/pages/InsertionParcours.jsx`

---

## 1. Schéma de données

> **Source unique du schéma** : toutes les tables insertion sont créées et migrées UNIQUEMENT dans `init-db.js` (l'ancienne IIFE d'auto-migration de `backend/src/routes/insertion/index.js` a été retirée en Vague 3 — voir l'avertissement `backend/src/routes/insertion/index.js:7-16`). Toute nouvelle table/colonne devra suivre ce pattern (`CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS` idempotents).

### 1.1 `insertion_diagnostics` — diagnostic d'accueil CIP (`init-db.js:2830-2906`)

**⚠ Cardinalité : `UNIQUE(employee_id)` (`init-db.js:2904`) → UN SEUL diagnostic par salarié, écrasé à chaque édition (upsert `ON CONFLICT (employee_id) DO UPDATE`, `routes.js:175`). Aucun historique de versions.**

| Colonne | Type | Contraintes / remarques |
|---|---|---|
| `id` | SERIAL | PK |
| `employee_id` | INTEGER | NOT NULL, FK `employees(id)` ON DELETE CASCADE, **UNIQUE** |
| `created_by`, `updated_by` | INTEGER | FK `users(id)` |
| `parcours_anterieur` | TEXT | contexte social |
| `contraintes_sante`, `contraintes_mobilite`, `contraintes_familiales`, `autres_contraintes` | TEXT | contexte social (non exposés dans l'UI actuelle) |
| **7 freins (scores)** | INTEGER | `DEFAULT 1 CHECK (BETWEEN 1 AND 5)` dans le CREATE ; le PUT envoie `null` si non évalué (`routes.js:201-207`) |
| **7 freins (détails)** | TEXT | observations libres par frein |
| **7 freins (causes)** | TEXT | causes détaillées par frein (`init-db.js:2889-2896`) — non exposées dans l'UI |
| `pcm_q_travail_ideal`, `pcm_q_reaction_stress`, `pcm_q_relation_equipe`, `pcm_q_motivation`, `pcm_q_apprentissage`, `pcm_q_communication` | TEXT | questionnaire PCM simplifié (`init-db.js:2859-2865`) — **colonnes en base mais JAMAIS écrites** : absentes du PUT (`routes.js:148-165`) et de l'UI |
| `obs_taches_realisees`, `obs_points_forts`, `obs_difficultes`, `obs_comportement_equipe`, `obs_autonomie_ponctualite` | TEXT | observations CIP en situation de travail |
| `pref_aime_faire`, `pref_ne_veut_plus`, `pref_environnement_prefere`, `pref_environnement_eviter`, `pref_objectifs` | TEXT | préférences & motivations |
| `explorama_interets`, `explorama_rejets`, `explorama_gestes_positifs`, `explorama_gestes_negatifs`, `explorama_environnements`, `explorama_rythme` | TEXT | outils d'exploration — non exposés dans l'UI |
| `cip_hypotheses_metiers`, `cip_questions` | TEXT | orientation CIP — non exposés dans l'UI |
| `created_at`, `updated_at` | TIMESTAMP | DEFAULT NOW() |

**Noms EXACTS des 7 colonnes de freins** (identiques dans `insertion_diagnostics` ET `insertion_milestones`) :

| # | Score | Détail (diagnostics seulement) | Causes (diagnostics seulement) |
|---|---|---|---|
| 1 | `frein_mobilite` (`init-db.js:2844`) | `frein_mobilite_detail` (2845) | `frein_mobilite_causes` (2890) |
| 2 | `frein_sante` (2846) | `frein_sante_detail` (2847) | `frein_sante_causes` (2891) |
| 3 | `frein_finances` (2848) | `frein_finances_detail` (2849) | `frein_finances_causes` (2892) |
| 4 | `frein_famille` (2850) | `frein_famille_detail` (2851) | `frein_famille_causes` (2893) |
| 5 | `frein_linguistique` (2852) | `frein_linguistique_detail` (2853) | `frein_linguistique_causes` (2894) |
| 6 | `frein_administratif` (2854) | `frein_administratif_detail` (2855) | `frein_administratif_causes` (2895) |
| 7 | `frein_numerique` (2856) | `frein_numerique_detail` (2857) | `frein_numerique_causes` (2896) |

**⚠ Divergence de référentiel avec le CDC** : le CDC demande dans l'export les freins *linguistique / santé / logement / administratif / financier / judiciaire / mobilité*. Le référentiel existant est *mobilité / santé / finances / famille / linguistique / administratif / numérique*. **Les freins « logement » et « judiciaire » n'existent nulle part** ; « famille » et « numérique » existent mais ne sont pas dans la liste d'export du CDC (voir §5.3).

Migrations rétro-compatibles : toutes les colonnes rétro-ajoutées en `ADD COLUMN IF NOT EXISTS` (`init-db.js:3062-3110`), freins rétro-ajoutés **sans CHECK** (commentaire `init-db.js:3059-3060`).

### 1.2 `insertion_milestones` — jalons / bilans (`init-db.js:2962-3012`)

**⚠ Cardinalité : `UNIQUE(employee_id, milestone_type)` (`init-db.js:3010`, doublée d'un index unique `idx_milestones_emp_type_unique`, `init-db.js:3132`) → un seul jalon de chaque type par salarié, à vie. Impossible d'avoir N bilans intermédiaires à fréquence libre, ou un 2ᵉ parcours (renouvellement CDDI) avec de nouveaux jalons.**

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | SERIAL | PK |
| `employee_id` | INTEGER | NOT NULL, FK CASCADE |
| `milestone_type` | VARCHAR(30) | NOT NULL, **CHECK IN ('Diagnostic accueil', 'Bilan M+3', 'Bilan M+6', 'Bilan M+10', 'Bilan Sortie')** (`init-db.js:2965`) — libellés français figés en dur |
| `due_date` | DATE | NOT NULL (échéance) |
| `completed_date` | DATE | date de réalisation |
| `status` | VARCHAR(30) | NOT NULL DEFAULT `'a_planifier'`, CHECK IN (`a_planifier`, `planifie`, `realise`, `reporte`) |
| `interview_date` | TIMESTAMP | date/heure de l'entretien planifié |
| `interviewer_id` | INTEGER | FK `users(id)` |
| `frein_mobilite` … `frein_numerique` | INTEGER | 7 colonnes CHECK 1-5, **sans défaut** → snapshot des freins au moment du bilan (`init-db.js:2973-2979`) |
| `cip_integration`, `cip_competences`, `cip_projet_pro`, `cip_socialisation` | TEXT | réponses au questionnaire CIP par section (`init-db.js:2981-2984`) |
| `bilan_professionnel`, `bilan_social`, `objectifs_realises`, `objectifs_prochaine_periode`, `observations`, `actions_a_mener` | TEXT | contenu du bilan — **les « objectifs » sont du texte libre, aucune structuration** |
| `avis_global` | VARCHAR(30) | CHECK IN (`tres_positif`, `positif`, `mitige`, `insuffisant`) |
| `sortie_classification` | VARCHAR(20) | CHECK IN (`positive`, `negative`) |
| `sortie_type` | VARCHAR(50) | libre (l'UI propose CDI / CDD / CDD_court / formation / creation_activite / autre_IAE / sans_suite / fin_contrat, `InsertionParcours.jsx:443-451`) |
| `sortie_commentaires`, `sortie_employeur`, `sortie_formation` | TEXT | |
| `sortie_employeur_siret` | VARCHAR(14) | reporting DREETS/FSE+ (`init-db.js:3003`) |
| `sortie_duree_contrat_mois` | SMALLINT | CHECK ≥ 0 |
| `ai_recommendations` | JSONB | snapshot des recommandations IA |
| `created_by`, `created_at`, `updated_at` | | |

Index : `idx_milestones_employee`, `idx_milestones_status` (`init-db.js:3013-3014`).

### 1.3 `cip_action_plans` — plan d'action CIP (`init-db.js:3018-3034`)

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | SERIAL | PK |
| `milestone_id` | INTEGER | **NOT NULL**, FK `insertion_milestones(id)` CASCADE → **toute action est obligatoirement rattachée à un jalon** |
| `employee_id` | INTEGER | NOT NULL, FK CASCADE |
| `action_label` | TEXT | NOT NULL |
| `category` | VARCHAR(30) | NOT NULL, CHECK IN (`competence`, `insertion`, `socialisation`, `frein`) |
| `frein_type` | VARCHAR(30) | libre, non contraint (censé référencer un des 7 freins) |
| `priority` | VARCHAR(20) | DEFAULT `'moyenne'`, CHECK IN (`haute`, `moyenne`, `basse`) — c'est la « criticité » actuelle |
| `status` | VARCHAR(20) | DEFAULT `'a_faire'`, CHECK IN (`a_faire`, `en_cours`, `realise`, `abandonne`) |
| `echeance` | DATE | nullable — existe en base **mais non saisissable dans le formulaire d'ajout rapide de l'UI** (`InsertionParcours.jsx:211`, `504-519`) |
| `notes` | TEXT | idem : pas dans l'UI d'ajout |
| `created_at`, `updated_at` | | |

Index : `idx_action_plans_milestone`, `idx_action_plans_employee` (`init-db.js:3033-3034`).

### 1.4 `insertion_interview_alerts` — alertes de planification (`init-db.js:3038-3048`)

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | SERIAL | PK |
| `employee_id` | INTEGER | NOT NULL, FK CASCADE |
| `milestone_type` | VARCHAR(30) | NOT NULL |
| `alert_type` | VARCHAR(30) | NOT NULL, CHECK IN (`planification`, `rappel_j7`, `rappel_j1`, `retard`) |
| `sent_at` | TIMESTAMP | |
| `is_sent` | BOOLEAN | DEFAULT false |
| `target_date` | DATE | NOT NULL |
| `created_at` | TIMESTAMP | |

Alimentée uniquement par le scheduler (§2.7). Aucune UI ne la consomme aujourd'hui (pas de lecture repérée côté frontend).

### 1.5 Tables recrutement

**`candidates`** (`init-db.js:145-172`) : `id`, `first_name`, `last_name`, `email`, `phone`, `gender`, `has_permis_b`, `has_caces`, `cv_raw_text`, `cv_file_path` VARCHAR(500), `source_email`, `status` VARCHAR(30) NOT NULL DEFAULT `'received'` (⚠ le CHECK d'origine est réécrit par migration en **4 statuts : `received` / `interview` / `hired` / `rejected`**, `init-db.js:2597-2605`), `position_id`, `appointment_date`, `appointment_location`, `sms_response`, `interviewer_name`, `interview_comment`, `practical_test_done`, `practical_test_result` CHECK (`conforme`/`faible`/`recale`), `practical_test_comment`, `assigned_team_id`, `created_at`, `updated_at`.

**`candidate_history`** (`init-db.js:175-184`) : `candidate_id` FK CASCADE, `from_status`, `to_status` NOT NULL, `comment`, `changed_by` FK users, `created_at`. — Journal des transitions kanban ET des liaisons collaborateur (`backend/src/routes/candidates/conversion.js:139-143`).

**`candidate_skills`** (`init-db.js:187-197`) : `candidate_id`, `skill_name`, `status` (`not_mentioned`/`detected`/`confirmed`), `updated_by`, UNIQUE(candidate_id, skill_name). `skill_keywords` (`init-db.js:200-210`).

**`recruitment_interviews`** — entretien d'embauche structuré (`init-db.js:3349-3396`) : `candidate_id` NOT NULL FK CASCADE, `interview_date`, `interviewer_id`, puis 7 sections :
- I. Présentation : `presentation_mots`, `parcours_professionnel`, `experiences_marquantes` ;
- II. Situation actuelle : `situation_actuelle` CHECK (`reconversion`/`retour_emploi`/`autre`), `situation_actuelle_autre`, `duree_sans_emploi` CHECK (`moins_6_mois`/`6_mois_1_an`/`plus_1_an`), `difficultes_recherche` TEXT[], `difficultes_recherche_autre` ;
- III. **Freins à l'emploi (du recrutement)** : `freins_emploi` TEXT[] (liste libre, **référentiel distinct des 7 freins insertion**), `freins_emploi_autre`, `contraintes_horaires` CHECK (`oui`/`certainement`/`non`), `contraintes_horaires_detail`, `structure_accompagnement` TEXT[], `structure_accompagnement_autre` ;
- IV. Motivation : `motivation_integration`, `motivation_reprise`, `attentes` TEXT[], `attentes_autre` ;
- V. Compétences : `experience_activite` TEXT[], `comportement_equipe`, `reaction_consigne`, `travail_physique` CHECK (`oui`/`non`/`ne_sais_pas`) ;
- VI. Organisation : `disponibilite_horaires` CHECK (`oui`/`non`/`autre`), `disponibilite_autre`, `organisation_ponctualite` ;
- VII. Projet pro : `idee_metier` CHECK (`oui`/`non`/`autre`), `idee_metier_detail`, `amelioration_souhaitee`, `question_ouverte` ;
- Évaluation : `evaluation_globale` CHECK (`favorable`/`reserve`/`defavorable`), `commentaire_evaluateur`.
⚠ Sauvegarde par **DELETE + INSERT en transaction** (`conversion.js:207-253`) → un seul entretien conservé par candidat (le dernier).

**`mise_en_situation`** (`init-db.js:3399-3423`) : `candidate_id` NOT NULL FK, `type` CHECK (`collecte_manutention`/`craquage`/`qualite`), `evaluator_id`, `evaluation_date`, 8 critères INTEGER CHECK 1-5 (`respect_consignes`, `capacite_physique`, `endurance`, `comprehension`, `qualite_travail`, `rapidite`, `securite`, `autonomie`), `resultat` CHECK (`conforme`/`a_ameliorer`/`non_conforme`), `points_forts`, `points_amelioration`, `commentaire`, `duree_minutes`. Une évaluation par type (DELETE+INSERT, `conversion.js:295-328`), met à jour `candidates.practical_test_done`.

**`recruitment_documents`** (`init-db.js:3426-3439`) : `candidate_id`, `document_type` CHECK (6 types : livret_accueil, charte_insertion, procedure_recrutement, 3× fiche_mise_en_situation_*), `delivered_at`, `delivered_by`, `delivery_method` CHECK (`telechargement`/`email`/`remise_main`), UNIQUE(candidate_id, document_type).

**`recruitment_plan`** (`init-db.js:2813-2822`) : `position_id` NOT NULL FK, `month` VARCHAR(7), `slots_needed`, `created_by`, UNIQUE(position_id, month).

### 1.6 `employees` — colonnes utiles au parcours

Définition de base (`init-db.js:291-313`) : `id`, `user_id` FK users SET NULL, **`candidate_id` INTEGER UNIQUE FK `candidates(id)` SET NULL** (le pivot recrutement↔RH), `first_name`/`last_name` NOT NULL, `phone`, `email`, `photo_path`, `team_id` FK teams, `position` VARCHAR(100) (texte, jointure par titre), `contract_type` VARCHAR(50), `contract_start` DATE, `contract_end` DATE, `has_permis_b`, `has_caces`, `weekly_hours` DOUBLE PRECISION DEFAULT 35, `skills` TEXT[], `is_active`, `created_at`, `updated_at`.

Colonnes ajoutées par migrations :

| Groupe | Colonnes | Référence |
|---|---|---|
| **Parcours insertion** | `insertion_status` VARCHAR(30) DEFAULT `'none'` CHECK (`none`/`en_parcours`/`termine`/`abandon`) ; `insertion_start_date` DATE ; `insertion_end_date` DATE ; `prescripteur` VARCHAR(100) (texte libre legacy) ; `visite_medicale_date` DATE | `init-db.js:2607-2614` |
| **CIP référent** | `cip_referent_user_id` INTEGER FK users + index partiel | `init-db.js:2618-2619` |
| **Identité (import Malibou)** | `malibou_id` (matricule paie), `birth_name`, `gender`, `birth_date`, `nationality`, `qualification` TEXT, `personal_email` | `init-db.js:2623-2631` |
| **Coordonnées / naissance / IAE** | `address`, `city`, `postal_code`, `country`, `civility`, `birth_city`, `birth_country`, `birth_department`, **`disability_status`** (RQTH, texte), `residence_permit_type`/`number`/`renewal`, `medical_visit_frequency`, `seniority_date`, `manager_malibou_id`, `manager_name`, `work_time_type`, `gross_salary`, `siret`, `establishment` — tous convertis en TEXT | `init-db.js:2639-2688` |
| **Hiérarchie** | `manager_id` FK auto-référente | `init-db.js:2663` |
| **Prescripteur structuré** | `prescripteur_id` FK `prescripteur_orgas` SET NULL ; `date_prescription` DATE | `init-db.js:2712-2722` |
| **Visite médicale** | `visite_medicale_due_date` (backfill J+90), `visite_medicale_resultat` CHECK (`conforme`/`restrictions`/`inapte`/`a_revoir`), `visite_medicale_notes`, `last_medical_visit_date` | `init-db.js:2729-2766` |

Table annexe **`prescripteur_orgas`** (`init-db.js:2692-2706`) : `nom`, `type` CHECK (`PE`/`FT`/`ML`/`CD`/`CCAS`/`CAP_EMPLOI`/`AUTRE_ASSO`/`DIRECT`), contacts, `region`, `siret`, `actif`, `notes`.

Champs éditables via `PUT /api/employees/:id` : liste blanche `allowed` (`backend/src/routes/employees.js:106-117`) — inclut `insertion_status`, `insertion_start_date`, `insertion_end_date`, `prescripteur(_id)`, `date_prescription`, `candidate_id` et tous les champs Malibou.

NB RGPD : NIR / IBAN / BIC **volontairement non importés** (`init-db.js:2635-2637`) — doctrine à reconduire (cf. CDC note C.8).

### 1.7 `employee_contracts` (`init-db.js:333-348`)

`id`, `employee_id` FK CASCADE, `contract_type` VARCHAR(30) NOT NULL CHECK élargi à **(`CDI`, `CDD`, `CDDI`, `interim`, `stage`, `apprentissage`)** (`init-db.js:2774-2776`), `duration_months`, `start_date` NOT NULL, `end_date`, `origin` CHECK (`embauche`/`renouvellement`), `weekly_hours` CHECK (0 < h ≤ 48) (`init-db.js:2785-2787`), `team_id`, `position_id`, `is_current` BOOLEAN DEFAULT true, `created_at`. Index `idx_employee_contracts_end` (`init-db.js:3339`).

### 1.8 PCM

- **`pcm_sessions`** (`init-db.js:217-227`) : `candidate_id` FK CASCADE, `mode` CHECK (`autonomous`/`accompanied`), `access_token` UNIQUE, `status` (`pending`/`in_progress`/`completed`), `started_at`, `completed_at`.
- **`pcm_answers`** (`init-db.js:230-238`) : `session_id`, `question_number`, `answer_value`, `answer_voice_text` + contrainte UNIQUE (session_id, question_number) (`init-db.js:259-274`).
- **`pcm_reports`** (`init-db.js:241-251`) : `session_id`, `candidate_id`, `base_type` VARCHAR(20), `phase_type` VARCHAR(20), **`encrypted_report` TEXT NOT NULL** (AES-256 via `PCM_ENCRYPTION_KEY`, fallback JWT_SECRET — déchiffrement `routes.js:1052-1059` et `insertion-ai.js:120-133`), `risk_alert` BOOLEAN.

Le PCM remonte dans l'insertion **uniquement via la chaîne** `pcm_reports → pcm_sessions → candidates → employees.candidate_id` (`insertion-ai.js:98-106`) — d'où l'importance de la liaison candidat↔collaborateur (§2.3).

### 1.9 Divers utiles

- **`settings`** clé-valeur (`init-db.js:73-79`) : `key` VARCHAR(100) UNIQUE, `value` TEXT, `category` — utilisée par l'objectif conventionné `insertion.objectif_sorties_dynamiques` (`routes.js:729-738`).
- **`work_hours`** (`init-db.js:376+`) : source des heures pour l'export FSE+ (`backend/src/routes/exports.js:369-375`).
- Index insertion : `idx_employees_insertion` partiel sur `insertion_status != 'none'` (`init-db.js:3342`), `idx_candidates_status` (3341).

---

## 2. API backend

### 2.1 Module insertion — montage et endpoints

Montage : `backend/src/index.js:202` → `/api/insertion` ; **tout le routeur exige `authenticate` + `authorize('ADMIN', 'RH', 'MANAGER')`** (`backend/src/routes/insertion/index.js:23`), avec resserrement `ADMIN`/`RH` route par route. Journalisation transverse `autoLogActivity('insertion')` (`routes.js:21`).

| Méthode & chemin | Rôles | Fonction | Réf. |
|---|---|---|---|
| GET `/api/insertion/` | A/RH/M | Liste des salariés actifs + `nb_contracts`, `current_contract_type`, `contract_end_date`, drapeaux `has_pcm` / `has_diagnostic`, `urgency` (fin contrat ≤ 30 j `critique`, ≤ 60 j `attention`) | `routes.js:59-119` |
| GET `/freins-definitions` | A/RH/M | Référentiel des 7 freins (labels, questions indirectes, niveaux, actions de levée) | `routes.js:122-124` |
| GET `/diagnostic/:employeeId` | A/RH/M | Lit le diagnostic (`SELECT *`, 1 ligne ou null) | `routes.js:127-138` |
| PUT `/diagnostic/:employeeId` | A/RH/M | Upsert 46 champs `ON CONFLICT (employee_id) DO UPDATE` ; hint SQLSTATE 42703 | `routes.js:141-230` |
| GET `/milestones/:employeeId` | A/RH/M | Jalons + nom de l'interviewer | `routes.js:238-253` |
| POST `/milestones` | A/RH/M | Crée/écrase un jalon (upsert sur le couple employé+type) | `routes.js:256-278` |
| PUT `/milestones/:id` | A/RH/M | Met à jour 30 champs en **COALESCE** (⚠ impossible de repasser un champ à NULL) ; **effet de bord** : « Bilan Sortie » `realise` → `employees.insertion_status='termine'` + `insertion_end_date` (idempotent, réouverture gérée) | `routes.js:281-366` |
| GET `/milestones/:employeeId/radar` | A/RH/M | Séries radar : diagnostic initial + jalons `realise` avec freins non nuls ; axes `['Mobilite','Sante','Finances','Famille','Langue','Administratif','Numerique']` ; ⚠ valeurs nulles remplacées par 1 (`d[k] \|\| 1`) | `routes.js:369-418` |
| GET `/milestones-overview` | A/RH/M | Tous les jalons des salariés `en_parcours` actifs | `routes.js:421-437` |
| GET `/interview-template/:milestoneType` | A/RH/M | Grille d'entretien du jalon (`CIP_QUESTIONNAIRES`) | `routes.js:440-444` |
| POST `/milestones/:employeeId/initialize` | A/RH/M | Démarre le parcours (`insertion_status='en_parcours'` sauf terminé/abandon, pose `insertion_start_date`) + `generateMilestones` (idempotent, **ne recale pas** les jalons existants) | `routes.js:447-479` |
| GET `/action-plans/:employeeId` | A/RH/M | Actions + type de jalon, tri priorité | `routes.js:486-501` |
| POST `/action-plans` | A/RH/M | Crée une action (milestone_id, employee_id, label, category obligatoires ; frein_type/priority/echeance/notes optionnels) | `routes.js:504-522` |
| PUT `/action-plans/:id` | A/RH/M | Maj label/status/priority/echeance/notes (COALESCE) | `routes.js:525-545` |
| DELETE `/action-plans/:id` | A/RH/M | Suppression sèche | `routes.js:548-556` |
| GET `/timeline/:employeeId` | A/RH/M | Timeline seule (`buildTimeline`) | `routes.js:559-581` |
| GET `/cohorte/stats?year=&mine=1` | A/RH/M | Tableau de bord CIP : actifs, jalons en retard / à venir 7 j / agenda 30 j, salariés à risque (fin contrat ≤ 60 j), freins moyens + dominant (dernier jalon réalisé sinon diagnostic), sorties de l'année (positives/négatives/taux/par type), objectif conventionné ; filtre « mes salariés » sur `cip_referent_user_id` | `routes.js:589-725` |
| GET/PUT `/objectif-sorties` | GET tous / PUT A-RH | Objectif conventionné DREETS (%) dans `settings` clé `insertion.objectif_sorties_dynamiques` | `routes.js:741-764` |
| GET `/cip-referents` | A/RH/M | Users actifs `role IN ('ADMIN','RH')` (⚠ ne résout pas les rôles custom) | `routes.js:768-781` |
| GET `/audit?year=` | A/RH/M | KPIs agrégés non nominatifs (`gatherAuditKpis`, §2.5) | `routes.js:937-945` |
| GET `/audit/ia?year=` | **A/RH** | Rapport IA de situation globale (KPIs + verbatims anonymisés) | `routes.js:949-958` |
| PUT `/:employeeId/cip-referent` | **A/RH** | Affecte/retire le CIP référent (validation user RH/ADMIN actif) | `routes.js:963-994` |
| GET `/:employeeId` | A/RH/M | **Analyse complète** : employé (+prescripteur, +CIP référent), contrats, candidat lié (par `candidate_id` sinon appariement par nom), rapport PCM déchiffré, équipe, position, diagnostic, jalons (**auto-init paresseuse** si `en_parcours` et 0 jalon, `routes.js:1101-1103`), actions, `analyzeInsertion(...)`, timeline. ⚠ DERNIÈRE route GET (capture tout) | `routes.js:1000-1156` |
| GET `/ia/diagnostic` | **A/RH** | Sonde Anthropic isolée (clé/modèle/réseau) | `routes.js:1186-1219` |
| GET `/ia/profil/:employeeId` | **A/RH** | Analyse IA approfondie du profil | `routes.js:1222-1229` |
| GET `/ia/entretien/:employeeId?type=` | **A/RH** | Guide d'entretien IA (défaut `Bilan M+3`) | `routes.js:1232-1240` |
| GET `/ia/cohorte` | **A/RH** | Bilan IA de cohorte | `routes.js:1243-1250` |

Gestion d'erreur IA mutualisée `handleIaError` (hints 404 modèle / 401 clé / 429 quota) : `routes.js:1164-1180`.

### 2.2 Moteur `engine.js`

- **`computeMilestoneSchedule(startDate, endDate)`** (`engine.js:1400-1420`) : échéancier calé sur le contrat réel — `Diagnostic accueil` = début + 1 mois ; `Bilan M+3/M+6/M+10` **uniquement si m < durée en mois** ; `Bilan Sortie` = fin − 15 j (fin par défaut = début + 12 mois si `endDate` null) ; un bilan qui tomberait après la sortie est ramené à sortie − 15 j.
- **`generateMilestones(db, employeeId, userId)`** (`routes.js:25-55`) : source du départ = `insertion_start_date` → `employee_contracts.start_date (is_current)` → `employees.contract_start` → aujourd'hui ; insertion idempotente jalon par jalon (skip si existe).
- **`resyncMilestones(db, employeeId, {userId})`** (`engine.js:1505-1559`) : recale les jalons **non réalisés** sur le nouveau contrat, crée les intermédiaires devenus applicables, ne touche jamais un `realise`, ne réactive pas un parcours terminé, ne peuple pas un parcours vierge. **Déclencheurs actuels : uniquement `PUT /api/employees/:id` (`backend/src/routes/employees.js:159`) et `POST /api/employees/:id/contracts` (`employees.js:792`)** — pas après un bilan, pas d'endpoint dédié.
- **`computeCddiCumulativeMonths(contracts)`** (`engine.js:1438-1482`) : durée cumulée CDDI (fusion des chevauchements), exposée par GET `/api/employees/:id/cddi-duration` (`employees.js:174-209`) — badge « 20/23 mois » (plafond 24 mois).
- **`buildTimeline(employee, contracts, milestones, diagnostic)`** (`engine.js:1302-1372`) : événements = `embauche` (1), les 5 jalons (avec dates théoriques de repli `addMonths`), `fin_contrat` ; renvoie `{events, start_date, end_date, duree_totale_mois, progression}` (progression = % de jalons `realise`). ⚠ Ne considère que le **contrat courant** (`contracts.find(c => c.is_current) || contracts[0]`) ; n'inclut ni actions, ni objectifs, ni contrats successifs, ni entretiens de recrutement.
- **`FREINS_DEFINITIONS`** (`engine.js:230-392`) : pour chacun des 7 freins — `label`, `icon`, 3 `questions_indirectes` (avec `indicateurs`), `niveaux` 1-5 (verbalisés), 5 `actions_levee`. C'est le « référentiel guide d'entretien » servi par `/freins-definitions`.
- **`CIP_QUESTIONNAIRES`** (`engine.js:398-612`) : 5 grilles (une par type de jalon), chacune 4 sections mappées sur les colonnes `cip_integration` / `cip_competences` / `cip_projet_pro` / `cip_socialisation`, avec 3-4 questions par section.
- **`analyzeInsertion(...)`** (`engine.js:618-676`) : moteur algorithmique (sans LLM) → `fiche_synthese`, profil PCM (depuis rapport recrutement déchiffré), `competences`, `pistes_metiers` (référentiel `METIERS_CIBLES`, `engine.js:159`), `parcours_dev`, `recommandations_cip`, `freins_sociaux` (`buildFreinsSociaux`, `engine.js:1128`), `ai_recommendations` algorithmiques (`buildAIRecommendations`, `engine.js:1170` — alertes/propositions/accompagnement, snapshot possible dans `insertion_milestones.ai_recommendations`).

### 2.3 Liaison candidat ↔ collaborateur (`backend/src/routes/candidates/conversion.js`)

Règle métier : **seule la paie (import Malibou) crée un collaborateur** ; le recrutement RATTACHE.

| Endpoint | Rôles | Comportement | Réf. |
|---|---|---|---|
| POST `/api/candidates/:id/convert-to-employee` | A/RH | **410 Gone** (flux de création désactivé) | `conversion.js:30-35` |
| GET `/api/candidates/:id/employee-matches` | A/RH | Collaborateur déjà lié + suggestions non liées classées par score de nom (100 exact, 80/60/40/20) | `conversion.js:40-78` |
| POST `/api/candidates/:id/link-employee` `{employee_id}` | A/RH | Transaction : gardes d'unicité bilatérales (409), `employees.candidate_id = :id`, recopie permis B/CACES (OR logique), **crée un squelette `insertion_diagnostics` (`ON CONFLICT DO NOTHING`)** pour que le PCM remonte, trace `candidate_history`. **⚠ N'initialise NI `insertion_status` NI les jalons** | `conversion.js:81-157` (squelette : 128-133) |
| POST `/api/candidates/:id/unlink-employee` | A/RH | Défait la liaison + trace | `conversion.js:160-175` |
| GET `/api/employees/:id/candidate-matches` | A/RH | Symétrique côté fiche salarié (avec drapeau `has_pcm`) | `employees.js:214-259` |

Autres routes candidat : kanban/CRUD (`backend/src/routes/candidates/crud.js:17-161` — GET `/`, `/kanban`, `/stats`, POST `/`, upload CV), fiche individuelle (`individual.js:15-298` — GET/PUT `/:id`, PUT `/:id/status`, CV, skills, history, documents), entretien structuré (`conversion.js:182-258`), mise en situation (`conversion.js:265-333`), plan de recrutement (`conversion.js:340-393`).

### 2.4 Exports insertion (`backend/src/routes/exports.js`)

- **GET `/api/exports/insertion`** (ADMIN/RH, `exports.js:465-623`) : classeur **exceljs** 5 feuilles — `Informations` (métadonnées + avertissement RGPD), `Salariés` (vue curée : `matricule, nom, prenom, poste, equipe, statut, debut_parcours, fin_prevue, prescripteur, prescripteur_orga, prescripteur_type, visite_medicale_date, les 7 freins du diagnostic, nb_jalons, jalons_realises` — `exports.js:522-542`), `Diagnostics CIP` / `Jalons` / `Plans d'action` en **colonnes dynamiques** (toutes les colonnes de la table, `addDataSheet`, `exports.js:484-501`). Option **CSV** : `?format=csv&dataset=salaries|diagnostics|jalons|actions` (point-virgule + BOM, `toCsv`, `exports.js:505-518`). Résilience `soft()` par requête.
- **GET `/api/exports/fse-plus?annee=&trimestre=`** (ADMIN/RH, `exports.js:343-459`) : CSV trimestriel bénéficiaires CDDI — civilité, genre, identité, contrat, statut/dates parcours, prescripteur (orga+type+date), **heures travaillées du trimestre** (somme `work_hours`), sortie (LATERAL sur `Bilan Sortie` réalisé dans le trimestre : classification, type, SIRET, durée, date).
- Le routeur exports est monté avec `authenticate` + `authorize('ADMIN','MANAGER','RH')`, resserré à ADMIN/RH sur ces deux routes.

### 2.5 Audit insertion (backend)

- **`gatherAuditKpis(year)`** (`routes.js:792-912`) : nb en parcours ; taux de réalisation des jalons **par type et par échéance** (réalisés parmi les échus) + global ; freins consolidés (moyennes + dominant + nb évalués) ; actions en cours (par statut/catégorie/priorité) ; sorties de l'année (par classification et type + taux dynamiques). Chaque requête est en `soft()` (dégradation, pas de crash).
- **`gatherAuditVerbatims()`** (`routes.js:915-933`) : verbatims non nominatifs (60 observations de diagnostics, 80 bilans de jalons réalisés, 60 notes d'actions).
- GET `/audit` (chiffres seuls) et GET `/audit/ia` (ADMIN/RH — croise KPIs + verbatims via `auditGlobalReport`).

### 2.6 Service IA `backend/src/services/insertion-ai.js`

- Client Anthropic paresseux (`getClient`, l.10-17), **modèle `CLAUDE_MODEL || 'claude-sonnet-5'`** (l.21), parsing tolérant (`extractText` l.26, `parseJsonLoose` l.38).
- **Prompt système `SYSTEM_INSERTION`** (l.49-67) : contexte SIAE, 7 freins 1-5, jalons, 6 types PCM.
- **`getEmployeeInsertionData(employeeId)`** (l.73-143) : 6 requêtes parallèles fault-isolées (`soft`) — employé, diagnostic, jalons, actions, PCM (via `employees.candidate_id`), candidat ; déchiffrement PCM avec fallback clé legacy.
- **`analyseProfilComplet(employeeId)`** (l.149-244) : max_tokens 4000 ; JSON attendu `{synthese, pcm_adaptation{communication,management,vigilances[]}, freins_prioritaires[], risque_decrochage{niveau,facteurs,signaux_alerte}, plan_action_propose[], prochaine_etape, score_progression}`.
- **`preparerEntretien(employeeId, milestoneType)`** (l.250-309) : max_tokens 3000 ; JSON `{intro_conseillee, questions_cles[{question,objectif,conseil_pcm}], points_vigilance[], freins_a_aborder[{frein,formulation_adaptee}], conclusion_conseillee, duree_estimee}`. **C'est LA brique « préparation IA d'entretien » réutilisable.**
- **`bilanCohorte()`** (l.315-416) : profils + jalons en retard + actions en retard ; JSON `{synthese, indicateurs, alertes[], tendances[], recommandations_cip[], score_cohorte}`.
- **`auditGlobalReport({kpis, verbatims})`** (l.424-488) : max_tokens 6000 ; JSON rapport direction ; repli `_raw`/`_tronque` jamais silencieux.
- **Garde RGPD** (`backend/src/utils/pii-pseudonymize.js`, 311 l.) : `createPseudonymizer()` → jetons stables « Salarié A/B » par requête, `scrubText()` sur tous les verbatims, `ageBracket()` (naissance → tranche IAE), `redactContactInfo()` (emails/tél/NIR/titres), **`rehydrate()`** re-substitue les noms réels côté serveur avant retour à l'écran. Appliquée dans les 4 fonctions IA (`insertion-ai.js:162-167, 259-265, 359-390, 432-438`). Tests : `backend/tests/unit/services/insertion-ai-pseudonymize.test.js`, `backend/tests/unit/utils/pii-pseudonymize.test.js`.

### 2.7 Jobs scheduler (`backend/src/services/scheduler.js`)

- **`checkInsertionMilestones()`** (l.265-307) : pour chaque salarié `en_parcours` actif avec `insertion_start_date`, recalcule l'échéancier (`computeMilestoneSchedule`) et **crée le jalon le jour J de son échéance** s'il n'existe pas (filet de sécurité, pas un recalage).
- **`checkInsertionInterviewAlerts()`** (l.316-370) : jalons `a_planifier`/`planifie` → alertes `retard` (échéance dépassée), `planification` (J-14), `rappel_j7`, `rappel_j1` (+ **email Brevo au salarié** via `sendNotification`, l.353-363) ; anti-doublon par (employé, type, alerte, date) dans `insertion_interview_alerts` (`createInsertionAlert`, l.372-391).
- Exécution instrumentée dans `runAllJobs` (`scheduler.js:1121-1122`, wrapper `runInstrumented` → table `job_runs`).
- `checkContractEndings` (l.~230) alerte par ailleurs sur les fins de contrat.

### 2.8 Anonymisation RGPD (`backend/src/services/anonymization.js`)

Source unique consommée par `routes/rgpd.js` et la purge planifiée. **`anonymizeEmployee`** (l.124-209) : identité/coordonnées/santé/titres/salaire à NULL, et côté insertion — **conserve les scores de freins et les classifications de sortie (agrégats), nullifie tous les verbatims** : 37 colonnes de `insertion_diagnostics` (l.179-189), 14 colonnes de `insertion_milestones` (l.194-198), `cip_action_plans.action_label → 'ANONYMISÉ'` + notes NULL (l.201-208). **`anonymizeCandidate`** (l.88-114) : purge PCM, entretiens, mises en situation, documents. ⚠ Toute nouvelle table (entretiens, objectifs, snapshots) devra être ajoutée ici.

---

## 3. Frontend

### 3.1 `InsertionParcours.jsx` (1 749 lignes) — page `/insertion`

**Constantes** : `FREIN_KEYS = ['mobilite','sante','finances','famille','linguistique','administratif','numerique']` (l.52), `FREIN_LABELS` (l.53), `ACTION_STATUS`/`ACTION_CATEGORIES` (l.55-56), `MILESTONE_STATUS_*` (l.30-42), `IA_TIMEOUT = 120000` (l.12), `formatIaError` (l.16).

**Structure générale** (composant principal l.1105-1749) : colonne gauche = liste des salariés actifs avec badges `PCM` / `Diag` / urgence (l.1241-1263) + bouton « Tableau de bord CIP » ; colonne droite = `CohortePanel` par défaut, ou la fiche du salarié sélectionné avec **6 onglets** (l.1221-1228) :

| Onglet | id | Contenu | Réf. |
|---|---|---|---|
| Timeline | `timeline` | `TimelineView` (l.144-201) : liste verticale des événements de `analysis.timeline` + barre de progression | l.1349-1354 |
| Diagnostic CIP | `diagnostic` | Formulaire du diagnostic (voir ci-dessous) | l.1357-1428 |
| Bilans & Jalons | `bilans` | Liste des jalons → `BilanPanel` | l.1431-1476 |
| Freins | `freins` | Cartographie barres (depuis `analysis.freins_sociaux`) + actions prioritaires algorithmiques | l.1479-1507 |
| Synthèse & métiers | `analyse` | `fiche_synthese`, sources de données, pistes métiers | l.1510-1548 |
| Assistant IA | `ai` | Recommandations algorithmiques + 3 boutons IA (Analyser le profil / Préparer entretien / Tester la connexion IA) + rendus | l.1550-1741 |

**Formulaire de diagnostic — liste EXACTE des champs saisissables dans l'UI actuelle** (l.1357-1428) :
1. `parcours_anterieur` (textarea, l.1368-1371) ;
2. les **7 freins** : slider 1-5 (⚠ `value={... || 3}` : affiche 3 tant que non touché mais n'enregistre rien, badge « à évaluer ») + questions indirectes affichées depuis `/freins-definitions` + textarea `frein_<k>_detail` (l.1373-1400) ;
3. « Observations professionnelles » : `obs_points_forts`, `obs_difficultes`, `obs_comportement_equipe`, `obs_autonomie_ponctualite`, `pref_aime_faire`, `pref_ne_veut_plus` (l.1402-1416).

**⚠ Le formulaire n'expose PAS** (bien qu'en base et acceptés par le PUT) : `contraintes_*` (5), `frein_*_causes` (7), `pcm_q_*` (6, jamais écrits nulle part), `pref_environnement_prefere/eviter`, `pref_objectifs`, `explorama_*` (6), `cip_hypotheses_metiers`, `cip_questions` — soit **23 colonnes dormantes**.

**`BilanPanel`** (formulaire d'un jalon, l.207-532) : statut / date d'entretien (datetime) / date de réalisation ; **questionnaire CIP** par sections (template chargé via `/interview-template/<type>`, réponses dans `cip_integration|competences|projet_pro|socialisation`, l.331-349) ; **évaluation des 7 freins** (sliders, l.351-367) avec **pré-remplissage automatique depuis le dernier jalon réalisé** (l.226-236) ; **radar d'évolution** (l.369-375) ; bilan & objectifs = 5 textareas (`bilan_professionnel`, `bilan_social`, `objectifs_realises`, `objectifs_prochaine_periode`, `observations`, l.377-406) ; avis global 4 boutons (l.408-419) ; **bloc « Rapport de sortie »** si `Bilan Sortie` (classification radio, type 8 options, employeur, SIRET, durée en mois, commentaires, l.421-483) ; **plan d'action CIP inline** (liste + changement de statut + ajout rapide `action_label` + catégorie + priorité — **sans échéance ni notes ni frein_type dans le formulaire**, l.485-520) ; export PDF du bilan (l.293).

**`RadarChart`** (l.89-138) : SVG autonome 300×340 — 5 polygones concentriques (niveaux 1-5), 7 axes, séries superposées (diagnostic initial + jalons réalisés) avec 6 couleurs (`RADAR_COLORS`, l.58), légende. ⚠ `series.data.map((v,i) => ... v || 1)` : un frein non évalué est tracé à 1.

**`CohortePanel`** (l.759-1103) : GET `/insertion/cohorte/stats` ; cartes KPI (`DashCard`), objectif conventionné éditable (PUT `/objectif-sorties`), listes cliquables (jalons en retard, à planifier 7 j, agenda 30 j, fins de contrat ≤ 60 j) qui ouvrent la fiche, freins moyens en barres + frein dominant, sorties par type + `ObjectifBar`, bilan IA cohorte (GET `/ia/cohorte`), **exports** : sélecteur « Excel — tout » / « CSV — Salariés/Diagnostics/Jalons/Plans d'action » (axios blob, l.799) + export FSE+ avec année/trimestre (l.823), filtre « mes salariés » (`?mine=1`).

**Export PDF** (pattern réutilisable) : `openPrintWindow(title, bodyHtml)` (l.596-618) — fenêtre `window.open` + CSS A4 inline charte teal `#0D9488` + `w.print()` ; `exportFicheParcoursPDF` (l.623-674 : situation, diagnostic, tableau freins, tableau jalons, actions en cours) et `exportBilanJalonPDF` (l.676-701). Même mécanisme que les fiches PCM et l'audit.

**En-tête fiche** (l.1285-1334) : badges PCM/diagnostic/confiance, prescripteur, **CIP référent éditable** (select, PUT `/:employeeId/cip-referent`, l.1306-1319), boutons « Initialiser jalons » et « Exporter la fiche PDF ». Garde-fou « modifications non enregistrées » (`diagDirty`/`bilanDirty`, `confirmLeave`).

### 3.2 `AuditInsertion.jsx` (440 lignes) — page `/insertion/audit`

`FreinsRadar` SVG consolidé (moyennes cohorte /5, l.22-49), `StatCard`/`Bar` (l.51-74) ; GET `/insertion/audit?year=` (l.90), rapport IA GET `/insertion/audit/ia` réservé au front à ADMIN/RH via `user.base_role` (l.78, 98-115), export PDF par fenêtre d'impression (`printReport`, l.117+ — radar SVG reconstruit dans le HTML). Sections : KPIs, taux de réalisation par type de jalon, radar 7 freins, plans d'action, sorties, rapport IA.

### 3.3 `Employees.jsx` (908 lignes) — page `/employees`

Fiche salarié en **4 onglets** (l.383-388) : `info` (identité, équipe, contrat, heures, matricule, permis/CACES, prescripteur, **badge durée CDDI cumulée** via `/employees/:id/cddi-duration` l.145 et 426, CV du candidat lié, photo, formulaire d'édition complet), `contracts` (l.655+ : historique + création → déclenche `resyncMilestones` côté back), `availability` (jours d'indisponibilité), `pcm` (l.747-798 : **liaison recrutement** — si `candidate_id` null : bouton « Lier une fiche de recrutement » → `LinkCandidateModal` (l.843, GET `/employees/:id/candidate-matches`, POST `/candidates/:id/link-employee` l.166) ; sinon profil PCM (type base/phase/scores/alerte) + « Délier »).

**⚠ La fiche salarié n'a AUCUN onglet insertion** (pas de frise, pas de bilans, pas d'actions CIP) — le CDC demande « l'accès à la fiche individualisée de chaque salarié » avec frise/bilans/actions/IA : aujourd'hui tout cela vit uniquement dans `/insertion`.

### 3.4 `Candidates.jsx` (1 386 lignes) — page `/candidates`

Kanban **4 colonnes** `received / interview / hired / rejected` (l.9, GET `/candidates/kanban`, drag & drop l.274+). Onglets de la fiche par statut (`TABS_BY_STATUS`, l.34-38) : `info`, `history` (toujours) + `situation`, `entretien`, `pcm`, `documents` (dès `interview`). Composants : `InterviewFormView` (l.918, POST `/candidates/:id/interview-form`), `MiseEnSituationView` (l.1149), `DocumentsView` (l.1280), `PCMView` (l.825, lance le test PCM), `HistoryView` (l.807), **`LinkEmployeeModal`** (l.646 : GET `employee-matches`, POST `link-employee` ; « Délier » l.135).

### 3.5 Routage et menu

- `frontend/src/App.jsx:177-178` : `/insertion` et `/insertion/audit` → `ProtectedRoute roles={['ADMIN','RH','MANAGER']}` (lazy-load l.42-43).
- `frontend/src/components/Layout.jsx:152-173` : section `rh` « RH et Insertion » → sous-menu « Recrutement » (Besoin au recrutement `/recruitment-plan`, Gestion candidatures `/candidates`, Analyse personnalités `/pcm`) et « Gestion du personnel » (Collaborateurs `/employees`, **Parcours d'insertion `/insertion`**, **Audit insertion `/insertion/audit`**, Compétences `/skills`, Prescripteurs `/prescripteurs`) ; Pointage/Heures (l.188-189) ; Reporting RH `/reporting-rh` (l.229) ; import collaborateurs (l.310).

---

## 4. Mécanismes transverses réutilisables

| Mécanisme | Où | Notes pour l'extension |
|---|---|---|
| **Export Excel (exceljs)** | pattern `exports.js` (workbook, `addWorksheet`, en-tête gras + fond `FF8BC540`, `sheet.columns`), variante colonnes dynamiques `addDataSheet` (`exports.js:484-501`) | à répliquer pour le « tableau d'export des freins » |
| **Export CSV FR** | `toCsv` point-virgule + BOM + échappement (`exports.js:505-518`) ; pattern équivalent FSE+ (`exports.js:433-447`) | |
| **Export PDF** | fenêtre d'impression A4 (`openPrintWindow`, `InsertionParcours.jsx:596-618` ; idem AuditInsertion, PCM) — aucune lib serveur | pattern acté du projet (pas de puppeteer) |
| **State machine** | `backend/src/services/state-machine.js` (transition + rôle + audit `state_transitions_audit`) + catalogues `state-machines.js` | candidate pour les statuts d'entretiens/objectifs si workflow riche |
| **Notifications Brevo** | `backend/src/services/notification.js:6-46` (`sendNotification(template, email, phone, variables)` — email + SMS) ; table `notification_triggers` (`init-db.js:2934-2943`) ; usage insertion existant : rappel J-1 (`scheduler.js:353-363`) | |
| **Habilitations** | `authenticate` + `authorize(...roles)` avec résolution des rôles custom `resolveBaseRole` (`backend/src/middleware/auth.js:105-128`) ; front : `ProtectedRoute` + `user.base_role` (ex. `AuditInsertion.jsx:78`) ; matrice DENY-overlay `role_module_access` | ⚠ `/cip-referents` filtre `role IN ('ADMIN','RH')` en SQL sans résoudre les rôles custom (`routes.js:773`) |
| **Settings clé-valeur** | table `settings` (`init-db.js:73-79`) ; pattern lecture/écriture : `routes.js:729-764` (`insertion.objectif_sorties_dynamiques`) | pour les objectifs conventionnels du tableau de bord |
| **Scheduler instrumenté** | `runInstrumented` + table `job_runs`, jobs horaires (`scheduler.js:1121-1122`) | pour toute automatisation (rappels, recalages) |
| **Journal d'activité** | `autoLogActivity('insertion')` (`routes.js:21`) | |
| **Validation** | `express-validator` + middleware `validate` (`routes.js:9-10`, ex. l.256-259, 504-509) | |
| **Pseudonymisation IA** | `utils/pii-pseudonymize.js` (§2.6) | OBLIGATOIRE pour tout nouveau prompt |
| **Anonymisation RGPD** | `services/anonymization.js` (§2.8) | à étendre à toute nouvelle table |
| **Tests existants** | `backend/tests/unit/routes/insertion-engine.test.js`, `unit/scripts/insertion-schema.test.js`, `unit/services/insertion-ai-pseudonymize.test.js`, `unit/services/anonymization.test.js`, contrats `backend/tests/contract/` | suite Jest 650 tests — à étendre |

---

## 5. TABLE DES ÉCARTS — exigences CDC ↔ existant

### 5.1 Exigences fonctionnelles

| # | Exigence du CDC | Verdict | Détail |
|---|---|---|---|
| 1 | **Entretiens historisés typés** (accueil / intermédiaires à fréquence définie par la CIP / sortie) | **PARTIEL** | Existant : `insertion_milestones` avec **5 types figés** (CHECK `init-db.js:2965`) et **UNIQUE(employee_id, milestone_type)** (`init-db.js:3010`) → un seul bilan par type, pas de bilans intermédiaires multiples ni de fréquence individualisée. Le diagnostic d'accueil est **un enregistrement unique écrasable** (`UNIQUE(employee_id)`, `init-db.js:2904`) — pas d'historique des versions. Aucune table « entretien » générique datée. Manque : entité entretien à occurrences multiples, typée accueil/intermédiaire/sortie, avec planification libre. |
| 2 | **Objectifs individualisés avec sous-objectifs, échéances, dates butoirs** | **ABSENT** (en structuré) | Seuls des champs TEXT : `insertion_milestones.objectifs_realises` / `objectifs_prochaine_periode` (`init-db.js:2988-2989`), `insertion_diagnostics.pref_objectifs` (`init-db.js:2879`). Aucune table objectifs, aucun sous-objectif, aucune échéance/date butoir par objectif, aucun statut d'objectif. |
| 3 | **Actions CIP avec catégorie + criticité + échéance** | **EXISTE (large)** | `cip_action_plans` (`init-db.js:3018-3034`) : `category` (4 valeurs), `priority` (haute/moyenne/basse = criticité actuelle), `echeance` DATE, `status` (4), `frein_type`, `notes`. CRUD complet (`routes.js:486-556`). **Limites** : rattachement à un jalon obligatoire (`milestone_id NOT NULL`) — pas d'action « hors bilan » ; l'UI d'ajout n'expose ni l'échéance ni les notes (`InsertionParcours.jsx:504-519`) ; catégories à confronter au CDC ; pas de champ « criticité » distinct si priorité ≠ criticité. |
| 4 | **Évolution des freins entre bilans** (toile d'araignée, évaluation du bilan précédent) | **PARTIEL** | Snapshots : les 7 scores sont portés par chaque jalon (`init-db.js:2973-2979`) ; endpoint radar multi-séries (`routes.js:369-418`) ; `RadarChart` superpose diagnostic + bilans réalisés (`InsertionParcours.jsx:89-138, 369-375`) ; pré-remplissage du bilan depuis le précédent (`InsertionParcours.jsx:226-236`). **Manque** : deltas/tendances calculés, écran « évaluation du bilan précédent » (analyse OK/Non OK du plan d'action, respect des échéances — rien d'outillé), et le radar force les non-évalués à 1 (biais visuel). |
| 5 | **Planification du prochain entretien à chaque bilan** | **PARTIEL** | `interview_date` + statut `planifie` par jalon (`init-db.js:2970`) et alertes scheduler (§2.7) ; mais le prochain entretien = uniquement le jalon suivant du gabarit — pas de création libre d'un « prochain RDV » par la CIP. `insertion_interview_alerts` n'est affichée nulle part. |
| 6 | **Frise chronologique** (entretiens, jalons, objectifs, début et fin de contrat) dans chaque fiche salarié | **PARTIEL** | `buildTimeline` (`engine.js:1302-1372`) + `TimelineView` (`InsertionParcours.jsx:144-201`) : embauche, 5 jalons, fin de contrat, % progression. **Manque** : contrats successifs (seul le contrat courant est lu), objectifs, actions CIP, entretiens multiples, événements de recrutement ; et la frise vit dans `/insertion`, pas dans la fiche salarié `/employees` (§3.3). |
| 7 | **Tableau de bord avec indicateurs de qualité légaux et de la convention** | **PARTIEL** | Existant : `GET /cohorte/stats` + `CohortePanel` (retards, agenda, à-risque, freins, **taux de sorties dynamiques vs objectif conventionné** `settings`), `GET /audit` + page AuditInsertion (taux de réalisation par échéance, actions, sorties), KPI RH ETP/absentéisme/formation (`backend/src/routes/employees.js` §kpi), `GET /metropole/kpi-insertion` (`backend/src/routes/metropole.js:480+`), export FSE+. **Manque** : indicateurs de l'annexe financière ACI076260005A0M0 (postes/ETP conventionnés, objectifs chiffrés 46 / 82,60 / 54,30 / 17,40 / 10,90 à confirmer — cf. CDC C.7), suivi PASS IAE, taux d'entretiens réglementaires par période, indicateurs qualité Convergence/DDETS. |
| 8 | **Tableau de synthèse des actions CIP** | **PARTIEL** | Agrégats par statut/catégorie/priorité dans `/audit` (`routes.js:868-880`) ; actions en retard listées seulement via l'IA cohorte (`insertion-ai.js:346-354`) ; feuille « Plans d'action » de l'export xlsx (toutes colonnes). **Manque** : vue écran transversale toutes-actions (tous salariés) triable/filtrable par échéance/criticité/CIP. |
| 9 | **Tableau d'export des freins (les 22-23 colonnes nominatives)** | **PARTIEL** | Voir §5.2 colonne par colonne. L'export xlsx/CSV existant (feuille Salariés) couvre identité + 7 freins + dates + prescripteur, mais ~10 colonnes demandées n'existent pas en base. |
| 10 | **Initialisation automatique des jalons au passage candidat→collaborateur** | **PARTIEL** | `link-employee` crée **seulement** le squelette `insertion_diagnostics` (`conversion.js:128-133`) — ni `insertion_status`, ni jalons. Les jalons s'initialisent : (a) à l'import paie si poste « … Cddi » (statut `en_parcours` — `backend/src/services/collaborator-import.js:491-496`, sans création de jalons) ; (b) **paresseusement à la 1ʳᵉ ouverture de la fiche insertion** (`routes.js:1101-1103`) ; (c) via `POST /milestones/:employeeId/initialize` (bouton) ; (d) au fil de l'eau par le scheduler à date d'échéance (`scheduler.js:265-307`). Aucun déclenchement au moment de la liaison. |
| 11 | **Actualisation des jalons après chaque bilan + actualisation manuelle depuis la fiche** | **PARTIEL** | `resyncMilestones` (`engine.js:1505-1559`) recale les non-réalisés, mais n'est appelé que sur `PUT /employees/:id` et création de contrat (`employees.js:159, 792`) — **pas après la réalisation d'un bilan** (le `PUT /milestones/:id` ne recale rien, hors clôture parcours au Bilan Sortie, `routes.js:341-359`). Pas d'endpoint/bouton de recalage manuel : « Initialiser jalons » appelle `/initialize` qui **skippe** les jalons existants sans recaler leurs dates (`routes.js:42-46`). |
| 12 | **Préparation IA de chaque entretien** | **PARTIEL** | `preparerEntretien(employeeId, milestoneType)` (`insertion-ai.js:250-309`) + `GET /ia/entretien/:employeeId?type=` + bouton « Préparer entretien » (prend le premier jalon non réalisé, `InsertionParcours.jsx:1577-1589`). **Manque** : intégration dans le `BilanPanel` de chaque jalon, choix explicite du type, stockage/historisation de la préparation, déclenchement automatique en amont du RDV. |
| 13 | **Questionnaire d'accueil refondu** (trame 9 rubriques de la doc + 7 freins + diagramme de valorisation) | **PARTIEL** | 7 freins + questions indirectes + niveaux verbalisés + actions de levée = `FREINS_DEFINITIONS` (`engine.js:230-392`) et formulaire (§3.1). Mais l'UI ne couvre que ~14 des 46 colonnes du diagnostic ; la trame officielle (Identité, Logement, Accès aux droits, Santé, Budget, Mobilité, Situation pro, Projet pro, Contrat d'insertion) n'a pas d'équivalent rubrique-à-rubrique (logement/droits/budget non structurés) ; pas de « commentaire libre CIP par rubrique ». |
| 14 | **Accès fiche individualisée** (frise + bilans + commentaires/actions + analyse IA) | **PARTIEL** | Tout existe dans la page `/insertion` (6 onglets) ; **rien dans la fiche salarié `/employees`** (4 onglets sans insertion, `Employees.jsx:383-388`). |
| 15 | **Bilan de sortie obligatoire** (synthèse évolution parcours + freins + actions restantes) | **PARTIEL** | Jalon `Bilan Sortie` avec bloc dédié (classification, type, employeur, SIRET, durée — §3.1) + clôture automatique du parcours (`routes.js:341-349`) + radar historique. **Manque** : synthèse générée de l'évolution (deltas de freins), reprise automatique des « actions restant à réaliser », suivi post-sortie 3-6 mois (procédure retour à l'emploi, doc 7 du corpus). |
| 16 | **Renouvellement de contrat comme jalon** (formulaire encadrant, avis, durée, triple signature — doc 10) | **ABSENT** | Aucun type de jalon « renouvellement », aucun formulaire encadrant, aucune signature. Seul `employee_contracts.origin='renouvellement'` (`init-db.js:340`) trace le fait, et `resyncMilestones` recale les échéances. |
| 17 | **Questionnaire satisfaction de sortie** (doc 11) | **ABSENT** | Aucune table/écran. |
| 18 | **Grilles de compétences métier /10 par filière + volet accompagnement noté + journal d'actions avec partenaires** (docs 12-13, suivi R'PUR à remplacer) | **ABSENT** (insertion) | `candidate_skills`/`skill_keywords` et `employees.skills[]` existent côté recrutement/RH mais rien de noté /10 par filière avec observations ETI, ni COA, ni SWOT, ni journal d'actions avec partenaire mobilisé (le `cip_action_plans.notes` est le seul réceptacle). |

### 5.2 Le « tableau d'export des freins » — chaque colonne demandée

Liste du CDC (`00-cahier-des-charges.md:52-53`). Pour chaque colonne : la donnée existe-t-elle, où, sinon « à créer ».

| # | Colonne demandée | Verdict | Source existante (table.colonne) / manque |
|---|---|---|---|
| 1 | NOM Prénom | **EXISTE** | `employees.last_name` / `employees.first_name` (`init-db.js:295-296`) |
| 2 | Nationalité | **EXISTE** | `employees.nationality` (`init-db.js:2627`, alimentée par l'import Malibou) |
| 3 | Date d'entrée ACI | **EXISTE** (à arbitrer) | 4 sources concurrentes : `employees.contract_start` (`init-db.js:303`), `employee_contracts.start_date` du 1er contrat, `employees.insertion_start_date` (`init-db.js:2610`), `employees.seniority_date` (`init-db.js:2652`) — définir la source canonique |
| 4 | Fin PASS IAE | **ABSENT** | Aucune colonne d'agrément/PASS IAE (n°, date de délivrance, date de fin). `contract_end`/`insertion_end_date` ne sont pas le PASS. **À créer** (ex. `employees.pass_iae_end_date` ou table agréments) |
| 5 | Heures par semaine | **EXISTE** | `employees.weekly_hours` (`init-db.js:307`) et/ou `employee_contracts.weekly_hours` (`init-db.js:342`) |
| 6 | Genre | **EXISTE** | `employees.gender` (`init-db.js:2625`) |
| 7 | Date de naissance | **EXISTE** | `employees.birth_date` (`init-db.js:2626`) ⚠ pseudonymisée en tranche d'âge pour l'IA ; l'export nominatif reste possible (ADMIN/RH) |
| 8 | RQTH | **EXISTE** (forme à valider) | `employees.disability_status` (`init-db.js:2647`) — texte libre Malibou, pas un booléen normalisé |
| 9 | Niveau de formation | **PARTIEL** | `employees.qualification` (`init-db.js:2628`) — texte libre import paie ; pas de nomenclature (infra V / V / IV / III…). À structurer ou mapper |
| 10 | Ressources | **ABSENT** | Aucune colonne « ressources / minima sociaux » (RSA, ARE, AAH…). Seul indice indirect : `frein_finances(_detail/_causes)`. **À créer** |
| 11 | Logement | **ABSENT** (structuré) | Aucune colonne « type de logement » (autonome/hébergé/urgence). `employees.address/city` = adresse seulement ; **pas de frein logement** (voir §5.3). **À créer** |
| 12 | Commune de résidence | **EXISTE** | `employees.city` (`init-db.js:2640`) (+ `postal_code`) |
| 13 | Situation familiale | **ABSENT** (structuré) | Aucune colonne état civil/situation familiale ; seulement `frein_famille` + `contraintes_familiales` TEXT (`init-db.js:2840`). **À créer** |
| 14 | Frein linguistique | **EXISTE** | `insertion_diagnostics.frein_linguistique` (`init-db.js:2852`) + snapshot jalon (`init-db.js:2977`) |
| 15 | Frein santé | **EXISTE** | `insertion_diagnostics.frein_sante` (`init-db.js:2846`) |
| 16 | Frein logement | **ABSENT** | N'existe pas dans le référentiel des 7 freins (§5.3). **À créer** (colonne + définition + radar + IA + anonymisation) |
| 17 | Frein administratif | **EXISTE** | `insertion_diagnostics.frein_administratif` (`init-db.js:2854`) |
| 18 | Frein financier | **EXISTE** (libellé ≠) | `insertion_diagnostics.frein_finances` (`init-db.js:2848`) — libellé « Finances » |
| 19 | Frein judiciaire | **ABSENT** | N'existe pas. **À créer** (donnée pénale = catégorie particulière, vigilance RGPD art. 10) |
| 20 | Frein mobilité | **EXISTE** | `insertion_diagnostics.frein_mobilite` (`init-db.js:2844`) |
| 21 | PMSMP | **ABSENT** | Aucune table/colonne PMSMP (périodes d'immersion : dates, entreprise, objectif, bilan). **À créer** |
| 22 | Projet de formation | **PARTIEL** | Texte épars : `insertion_milestones.sortie_formation` (sortie uniquement, `init-db.js:2999`), `cip_projet_pro` (réponses d'entretien), `pref_objectifs`. Pas de champ « projet de formation » structuré. **À structurer** |
| 23 | Emploi visé | **PARTIEL** | `insertion_diagnostics.cip_hypotheses_metiers` (TEXT, non exposé en UI, `init-db.js:2899`) + pistes métiers calculées (`engine.js:850`, non persistées). Pas de champ « emploi visé » structuré. **À structurer** |

> NB : la liste verbatim du CDC compte 23 intitulés (le CDC annonce « 22 colonnes » ; « NOM Prénom » compté comme un seul en fait 23 champs de données). Bilan : **13 EXISTE / 4 PARTIEL / 6 ABSENT**.

### 5.3 Divergence de référentiel des freins (point de conception majeur)

| CDC (export) | Existant (7 freins codés en dur) |
|---|---|
| linguistique ✔ | `frein_linguistique` |
| santé ✔ | `frein_sante` |
| **logement ✘ (absent)** | — |
| administratif ✔ | `frein_administratif` |
| financier ✔ (≈) | `frein_finances` |
| **judiciaire ✘ (absent)** | — |
| mobilité ✔ | `frein_mobilite` |
| — | `frein_famille` (existant, hors liste export CDC) |
| — | `frein_numerique` (existant, hors liste export CDC) |

Le CDC (§A) demande par ailleurs de « reprendre les 7 freins actuels » dans le questionnaire d'accueil : il y a donc une tension interne (7 freins actuels ↔ liste d'export à 7 freins différents) à arbitrer en conception. **Coût d'un ajout de frein** : les 7 freins sont câblés en dur dans ≥ 12 endroits — colonnes×3 de `insertion_diagnostics` + colonnes de `insertion_milestones` (`init-db.js`), `FREINS_DEFINITIONS` (`engine.js:230`), listes d'axes du radar et des stats (`routes.js:390-391, 637, 788`), `insertion-ai.js` (l.186-193, 271-279, 369-377), `FREIN_KEYS` frontend (`InsertionParcours.jsx:52`), `AuditInsertion.jsx:10-14`, export Salariés (`exports.js:530-531`), anonymisation (`anonymization.js:179-188`), pré-remplissage `BilanPanel`, PDF.

---

## 6. Pièges et contraintes identifiés pour le plan de codage

1. **Contraintes d'unicité bloquantes pour l'historisation** : `UNIQUE(employee_id)` sur `insertion_diagnostics` et `UNIQUE(employee_id, milestone_type)` sur `insertion_milestones` (+ index `idx_milestones_emp_type_unique`). Tout modèle « N entretiens » ou « 2ᵉ parcours » impose soit de nouvelles tables, soit une migration de ces contraintes (avec reprise des `ON CONFLICT` qui s'y appuient : `routes.js:175, 267`, `engine.js:1551`).
2. **Ordre des routes** : `GET /:employeeId` est un attrape-tout final (`routes.js:996-1000`) — toute nouvelle route GET du module doit être déclarée AVANT (les commentaires « IMPORTANT: avant /:employeeId » jalonnent le fichier).
3. **`PUT /milestones/:id` en COALESCE intégral** (`routes.js:285-317`) : impossible d'effacer une valeur (remettre un frein ou une date à NULL). À garder en tête pour l'édition des bilans.
4. **Effet de bord en lecture** : l'auto-init des jalons se fait dans un GET (`routes.js:1101-1103`).
5. **Effet de bord de clôture** : « Bilan Sortie » réalisé → bascule `employees.insertion_status` (`routes.js:341-359`) ; à préserver/étendre si le modèle d'entretiens change.
6. **Radar : non-évalué affiché comme 1** (`routes.js:400, 409` ; `InsertionParcours.jsx:119, 125`) — biais à corriger si l'on veut des évolutions honnêtes.
7. **23 colonnes dormantes du diagnostic** (pcm_q_*, explorama_*, causes, contraintes, cip_hypotheses…) : en base et dans le PUT mais pas dans l'UI — décider réutilisation/abandon avant de créer de nouvelles colonnes.
8. **`echeance`/`notes`/`frein_type` absents du formulaire d'ajout d'action** (`InsertionParcours.jsx:211, 504-519`) alors que le CDC exige l'échéance : correctif UI simple.
9. **Schéma = source unique `init-db.js`** (interdiction de recréer des migrations dans les routes — leçon du bug 2.3.2, `backend/src/routes/insertion/index.js:7-16`) ; création idempotente + tests `insertion-schema.test.js`.
10. **RGPD systématique** : toute nouvelle table à verbatims doit être ajoutée à `anonymization.js`, à la pseudonymisation IA, et à l'export (mention diffusion restreinte) ; données judiciaires (frein demandé) = art. 10 RGPD, à cadrer avec le DPO ; doctrine NIR : ne pas stocker (CDC C.8).
11. **Rôles** : lecture module = ADMIN/RH/MANAGER, IA + exports + écritures sensibles = ADMIN/RH ; `GET /cip-referents` ne résout pas les rôles custom (`routes.js:773`) — à corriger si des CIP ont un rôle dupliqué.
12. **Deux « fiches » distinctes** (fiche RH `/employees` sans insertion vs fiche insertion `/insertion`) : le CDC demande une fiche individualisée unifiée — décision d'architecture UI à prendre (onglet insertion dans Employees vs enrichissement d'InsertionParcours).
13. **Timeline mono-contrat** (`engine.js:1304`) alors que les CDDI se renouvellent — la frise CDC exige les débuts/fins de chaque contrat (les données existent dans `employee_contracts`).
14. **`insertion_interview_alerts` sans UI** : le mécanisme d'alertes tourne mais n'est visible nulle part ; le CDC (planification des entretiens) peut s'y adosser.
15. **Recalage des jalons non branché sur les bilans** : `resyncMilestones` n'est pas appelé au PUT milestone ; « l'actualisation après chaque bilan » du CDC est à câbler (et un endpoint de recalage manuel à exposer).
16. **Référentiels de freins multiples** : freins insertion (7 scores), `recruitment_interviews.freins_emploi` TEXT[] (libellés libres du recrutement) — le CDC voulant un continuum embauche→parcours, une correspondance sera nécessaire.

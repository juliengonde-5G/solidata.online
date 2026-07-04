# Audit exhaustif SOLIDATA — 02. Recrutement, PCM, RH, Insertion, Pointage, Prescripteurs

> Domaine : modules 2 (Recrutement), 3 (PCM), 4 (Gestion RH), 5 (Insertion), 25 (Pointage) + Prescripteurs (conformité IAE).
> Date : 2026-07-03 · Auditeur : agent IA · Aucun fichier de code modifié.
> Méthode : lecture route + page + table de bout en bout ; chaque affirmation sourcée `fichier:ligne`.

---

## SYNTHÈSE

Modules globalement riches et alignés sur le métier SIAE (freins périphériques, CDDI, prescripteurs, visite médicale, ETP 1607 h, PCM FALC). Mais **plusieurs anomalies bloquantes/majeures** subsistent, dont les plus graves : (1) **toute l'« insertion IA » (`insertion-ai.js`) est morte** — les 3 endpoints IA plantent sur des colonnes SQL inexistantes (`p.name`, `e.position_id`, `e.hire_date`, `d.mobilite`) ; (2) **bug `month + '-31'` toujours présent dans `pointage.js`** (résumé mensuel plante 5 mois sur 12) ; (3) **incohérence de clé de chiffrement PCM** entre `pcm.js` et le module Insertion (profil PCM illisible dans l'analyse d'insertion) ; (4) **WorkHours** persiste les heures mais perd les horaires saisis (colonnes absentes).

| Sévérité | Nb |
|----------|----|
| BLOQUANT | 4 |
| MAJEUR   | 10 |
| MINEUR   | 12 |

Note domaine estimée : **5.6 / 10** (métier bien pensé, mais 4 crashs/fonctionnalités mortes + fragilité PII + promesses non tenues sur les jalons/IA).

---

## 1. PROMESSE (CLAUDE.md) vs RÉALITÉ

| Promesse §5 | État | Preuve |
|-------------|------|--------|
| Recrutement Kanban 4 colonnes (Reçus/Entretien/Recrutés/Refusés) | OK | `candidates/crud.js:54-67` map statuts `received/interview/hired/rejected` + migration anciens statuts |
| CV parsing | OK (best-effort) | `candidates/cv-engine.js` pdf-parse + fallback OCR tesseract ; extraction nom/email/tel/skills |
| Entretiens structurés | OK | `candidates/conversion.js:151-203` `recruitment_interviews` (34 champs) |
| Mise en situation | OK | `conversion.js:227-266` 3 types `collecte_manutention/craquage/qualite` |
| PCM 20 questions / 6 types / scoring pondéré / export PDF A4 | OK | 20 Q `pcm.js:337-503`, 6 types, scoring pondéré `pcm.js:563-721` ; PDF A4 via fenêtre d'impression `PersonalityMatrix.jsx:45` (`@page{size:A4}`) + export technique |
| Contrats / heures / compétences / planning hebdo 4 filières | Partiel | `employees.js` contrats OK ; heures **round-trip lossy** (voir MAJEUR-9) ; `planning-hebdo.js:14` filières tri/collecte/logistique/btq OK |
| Insertion : **parcours IA** | **NON FONCTIONNEL** | `insertion-ai.js` plante sur colonnes inexistantes → voir BLOQUANT-4 |
| Insertion : 3 jalons **M1/M6/M12** | **NON CONFORME** | Réalité = **Diagnostic accueil / M+3 / M+6 / M+10 (+ Bilan Sortie)** — voir MAJEUR-3 |
| Radar 7 freins | OK (avec bug) | 7 axes `insertion/routes.js:324-325` ; **bug numerique diagnostic** voir MAJEUR-4 |
| Plans d'action CIP | OK | `insertion/routes.js:433-504` `cip_action_plans` |
| Alertes entretiens | OK (émission) | `scheduler.js:220-295` émet retard/planification/J-7/J-1 + email Brevo J-1 ; **pas de liste in-app** (MINEUR-12) |
| Pointage | OK (avec crash mensuel) | `pointage.js` badge RFID + calcul auto heures ; **bug month-31** voir BLOQUANT-2 |
| Prescripteurs (conformité IAE) | OK | `prescripteurs.js` 8 types dont France Travail/ML/Cap Emploi |

---

## 2. ANOMALIES

### BLOQUANT

**BLOQUANT-1 — Incohérence clé de chiffrement PCM entre modules → profil PCM illisible dans l'Insertion**
- Preuve : `pcm.js:724` chiffre avec `const ENCRYPTION_KEY = process.env.JWT_SECRET || 'solidata-pcm-encryption-key';` (utilise **JWT_SECRET**, ignore PCM_ENCRYPTION_KEY). `insertion/routes.js:15` déchiffre avec `const PCM_KEY = process.env.PCM_ENCRYPTION_KEY || process.env.JWT_SECRET;` (utilise **PCM_ENCRYPTION_KEY** en priorité).
- Impact : depuis que `PCM_ENCRYPTION_KEY` a été câblé en prod (changelog 2.0.5, 11/05) avec une valeur ≠ JWT_SECRET, `insertion/routes.js:584` déchiffre le rapport PCM avec la mauvaise clé → `CryptoJS.AES.decrypt` renvoie une chaîne vide/garbage, `pcmReport` devient inexploitable, et comme c'est dans un `try/catch` silencieux (`:587`), **l'analyse d'insertion IA perd le PCM sans aucune alerte**. La promesse « SolidataBot/insertion IA analyse le PCM » est silencieusement dégradée.
- Correctif : `pcm.js` DOIT utiliser la même résolution de clé que `insertion/routes.js` : `process.env.PCM_ENCRYPTION_KEY || process.env.JWT_SECRET`. Attention migration : les rapports déjà chiffrés avec JWT_SECRET devront être re-chiffrés (ou fallback de déchiffrement multi-clés). Supprimer le fallback hardcodé `'solidata-pcm-encryption-key'`.

**BLOQUANT-2 — `pointage.js` : résumé mensuel plante 5 mois sur 12 (`month + '-31'`)**
- Preuve : `pointage.js:252-253` `const startDate = '${month}-01'; const endDate = '${month}-31';` puis `WHERE wh.date BETWEEN $1 AND $2` (`:265-266`).
- Impact : pour février/avril/juin/septembre/novembre, `'2026-02-31'::date` lève `ERROR 22008 date/time field value out of range` → **500 sur `GET /api/pointage/monthly-summary`**. C'est exactement la classe de bug corrigée dans `employees.js` via `utils/month-range.js` (acquis de l'audit) — mais **`pointage.js` n'a pas été corrigé**.
- Correctif : remplacer par `const { monthBounds } = require('../utils/month-range');` et `const [startDate, endDate] = monthBounds(month);`.

**BLOQUANT-3 — Fuite PII médico-sociale : diagnostic d'insertion accessible à MANAGER**
- Preuve : `insertion/index.js:187` `router.use(authenticate, authorize('ADMIN', 'RH', 'MANAGER'))` s'applique à TOUTES les routes insertion, dont `GET /diagnostic/:employeeId` (`routes.js:93`) et `GET /:employeeId` (`routes.js:535`) qui exposent `contraintes_sante`, `frein_sante`, `frein_finances`, `frein_famille`, situation familiale, etc.
- Impact : les MANAGER (encadrants techniques) accèdent aux **données de santé, financières et familiales** de tous les salariés en insertion. Violation du principe de minimisation RGPD — ces données médico-sociales relèvent du CIP (RH) / ADMIN, pas de l'encadrement technique. (Les endpoints `ia/*` sont bien restreints ADMIN/RH `:679,694,710`, mais pas les données brutes.)
- Correctif : restreindre `GET /diagnostic/:employeeId`, `PUT /diagnostic`, `GET /:employeeId`, `GET /milestones*` (champs freins) à `authorize('ADMIN','RH')`. Laisser aux MANAGER une vue allégée sans champs médico-sociaux si nécessaire.

**BLOQUANT-4 — Toute l'« insertion IA » est morte : requêtes SQL sur colonnes inexistantes**
- Preuve (`services/insertion-ai.js`) :
  - `:49` et `:271` `LEFT JOIN positions p ON e.position_id = p.id` → **`employees` n'a pas de colonne `position_id`** (schéma `init-db.js:199-219` : colonne `position VARCHAR(100)`, pas `position_id`). `insertion/routes.js:544` joint d'ailleurs correctement par `p.title = e.position`.
  - `:47,49,263` `p.name as position_name` → **`positions` n'a pas de colonne `name`** (schéma `init-db.js:227` : `title`).
  - `:262` (bilanCohorte) `SELECT … e.hire_date` → **aucune colonne `hire_date`** sur `employees`.
  - `:266-267` (bilanCohorte) `d.mobilite, d.sante … d.numerique` → **`insertion_diagnostics` n'a que `frein_mobilite`…**, pas les colonnes nues (`init-db.js:2408+`).
- Impact : `getEmployeeInsertionData` (`:44`) lève `ERROR 42703 column does not exist` avant même d'appeler Claude → `GET /api/insertion/ia/profil/:id`, `/ia/entretien/:id` et `/ia/cohorte` renvoient **500** systématiquement. Le frontend les appelle (`InsertionParcours.jsx:877,890`) → l'utilisateur clique « Analyse IA » et reçoit une erreur. **La fonctionnalité phare « parcours d'insertion IA » (§5 module 5) et l'analyse insertion de SolidataBot (§5 module 24) sont entièrement non fonctionnelles.** Masqué par le catch générique `insertion/routes.js:684`.
- Correctif : aligner les requêtes sur le schéma réel — `LEFT JOIN positions p ON p.title = e.position`, `p.title as position_name`, retirer `e.hire_date` (utiliser `insertion_start_date`/`contract_start`), retirer les colonnes nues `d.mobilite…` (garder `frein_*`). Ajouter un test d'intégration sur les 3 endpoints IA.

### MAJEUR

**MAJEUR-1 — `teams.js` : aucune restriction de rôle sur GET → fuite de la liste employés**
- Preuve : `teams.js:13` `GET /` et `teams.js:29` `GET /:id` n'ont que `authenticate` (pas d'`authorize`). `GET /:id` renvoie `SELECT * FROM employees WHERE team_id = $1` (`:34-37`).
- Impact : tout utilisateur authentifié (COLLABORATEUR, AUTORITE, RESP_BTQ) peut lister toutes les équipes et **récupérer la fiche complète de chaque employé** (téléphone, email, contrat, statut insertion). Fuite PII.
- Correctif : ajouter `authorize('ADMIN','RH','MANAGER')` sur les deux GET, et restreindre les colonnes employés retournées par `GET /:id`.

**MAJEUR-2 — `pcm.js` ignore PCM_ENCRYPTION_KEY + clé de secours hardcodée**
- Preuve : `pcm.js:724` `process.env.JWT_SECRET || 'solidata-pcm-encryption-key'`.
- Impact : (a) contredit la séparation documentée (changelog 2.0.2/2.0.5) ; (b) si `JWT_SECRET` est **rotée** (opération réalisée en 2.0.2), **tous les rapports PCM existants deviennent définitivement indéchiffrables** au sein même du module PCM (`decryptReport` `:730` utilise la même variable) ; (c) le fallback hardcodé est un secret faible pour des données de personnalité (PII). Lié à BLOQUANT-1.
- Correctif : clé dédiée résolue de façon identique partout, sans fallback en clair ; documenter la procédure de rotation (re-chiffrement).

**MAJEUR-3 — Jalons d'insertion : promesse M1/M6/M12 non tenue + 3 chemins de création divergents (voir aussi MAJEUR-8)**
- Preuve : CLAUDE.md §5 module 5 = « 3 jalons (M1/M6/M12) ». Réalité :
  - Conversion candidat→employé `candidates/conversion.js:91-96` crée **4** jalons : Diagnostic accueil (J+30), Bilan M+3, M+6, M+10 — **pas de Bilan Sortie / M12**.
  - Initialize `insertion/routes.js:393-399` crée **5** jalons : Diagnostic accueil (M1), M+3, M+6, M+10, **Bilan Sortie (M12)**.
- Impact : un salarié converti depuis un candidat n'a PAS de jalon de sortie (obligatoire pour le reporting DREETS des sorties dynamiques), alors qu'un salarié « initialisé » manuellement l'a. Incohérence selon le point d'entrée + non-conformité à la doc. De plus le calcul de dates diffère : conversion utilise `setDate(+N jours)` (`:98-99`), initialize utilise `addMonths` (`:388-391`) → dates non identiques pour un même salarié.
- Correctif : factoriser une seule fonction `createStandardMilestones(empId, startDate)` appelée par les deux chemins, incluant le Bilan Sortie, avec `addMonths`. Aligner la doc (M1/M+3/M+6/M+10/Sortie).

**MAJEUR-4 — Radar 7 freins : l'axe « numérique » du diagnostic initial est toujours affiché à 1**
- Preuve : `insertion/routes.js:308-311` le SELECT du diagnostic récupère 6 freins (`frein_mobilite … frein_administratif`) mais **omet `frein_numerique`**, alors que `axeKeys` (`:325`) contient les 7 clés dont `frein_numerique`. Ligne `:334` `data: axeKeys.map(k => d[k] || 1)` → `d['frein_numerique']` est `undefined` → `|| 1`.
- Impact : sur le radar, la série « Diagnostic initial » montre **toujours 1 (aucun frein) sur l'axe numérique**, même si le CIP a saisi un frein numérique élevé. Fausse la lecture de l'évolution du frein numérique (frein pourtant central pour un public éloigné de l'emploi).
- Correctif : ajouter `frein_numerique` au SELECT ligne 309.

**MAJEUR-5 — `GET /:id/hours` : un COLLABORATEUR peut lire les heures de n'importe quel salarié**
- Preuve : `employees.js:292` `authorize('ADMIN','RH','MANAGER','COLLABORATEUR')` mais aucune vérification que `req.user` correspond à `:id`.
- Impact : un COLLABORATEUR peut énumérer `/api/employees/1/hours`, `/2/hours`… et lire les heures/absences/maladie de tous. Fuite PII horizontale.
- Correctif : si rôle = COLLABORATEUR, exiger que l'employé lié à `req.user.id` == `:id` (jointure `employees.user_id`), sinon 403.

**MAJEUR-6 — `prescripteurs.js` : lecture ouverte à tous les rôles authentifiés**
- Preuve : `prescripteurs.js:6` `router.use(authenticate)` seul ; `GET /` (`:15`), `GET /:id` (`:47`), `GET /types` (`:33`) sans `authorize`.
- Impact : tout utilisateur authentifié lit la liste des organismes prescripteurs et leurs contacts (nom, email, tel, SIRET). Moins sensible que la PII salarié mais reste une donnée partenaire à réserver ADMIN/RH/MANAGER.
- Correctif : ajouter `authorize('ADMIN','RH','MANAGER')` sur les GET.

**MAJEUR-7 — Deux calculs d'absentéisme incohérents entre écrans RH**
- Preuve : `employees.js:500` `/absenteeism/monthly` calcule un taux **en jours** (`jours_absents / (jours_travailles+jours_absents)`, `:531-533`), tandis que `employees.js:970` `/kpi/absenteisme` calcule un taux **en heures** (`heures_absence / heures_totales`, `:981-985`).
- Impact : deux pages RH afficheront **deux taux d'absentéisme différents pour la même période**, sans que l'utilisateur sache lequel fait foi. Perte de confiance dans le reporting (sensible pour un ACI audité par la DREETS).
- Correctif : choisir une définition unique (recommandé : heures, cohérent avec l'ETP 1607 h) et la réutiliser dans les deux endpoints.

**MAJEUR-8 — 3ᵉ chemin de création de jalons (scheduler) divergent + Bilan Sortie jamais auto-créé**
- Preuve : `services/scheduler.js:166-211` `checkInsertionMilestones` crée automatiquement **4** jalons à échéance (Diagnostic accueil, M+3, M+6, M+10 — `:178-183`) — **pas de Bilan Sortie**. C'est un **3ᵉ chemin** qui s'ajoute à ceux de MAJEUR-3 (`conversion.js`=4 sans Sortie ; `insertion/routes.js initialize`=5 avec Sortie).
- Impact : le jalon **Bilan Sortie (M12)** — pièce maîtresse du reporting DREETS des sorties dynamiques — n'est créé QUE si un utilisateur clique manuellement « initialiser » ; ni la conversion, ni le scheduler ne le produisent. Beaucoup de salariés termineront leur CDDI sans jalon de sortie enregistré.
- Correctif : factoriser une seule liste canonique de jalons (incluant Sortie) partagée par les 3 chemins.
- Note (correction d'un pré-diagnostic) : les **alertes entretiens SONT bien émises** (`scheduler.js:220-295` : `retard`/`planification`/`rappel_j7`/`rappel_j1` dans `insertion_interview_alerts` + email Brevo J-1). Résidu → MINEUR-12 (pas de liste in-app).

**MAJEUR-9 — WorkHours : horaires saisis (début/fin/pause) jamais persistés → affichage cassé**
- Preuve : `WorkHours.jsx:62-64` affiche `h.start_time`, `h.end_time`, `h.break_minutes` et le formulaire les envoie (`:145-154`). Mais la table `work_hours` (`init-db.js:283-294`) ne contient QUE `hours_worked`, `overtime_hours`, `type`, `notes` — **aucune colonne `start_time`/`end_time`/`break_minutes`**. Le POST `employees.js:346-368` convertit les créneaux en `hours_worked` (via `computeHoursFromSlots`) et jette les horaires.
- Impact : après enregistrement, les colonnes Début/Fin affichent toujours « — » et Pause affiche « undefinedmin » (`h.break_minutes` = `undefined`). L'encadrant ne peut jamais relire les horaires qu'il a saisis — seule l'heure totale calculée subsiste. Donnée perdue + UI incohérente avec le modèle.
- Correctif : soit ajouter les colonnes `start_time TIME`, `end_time TIME`, `break_minutes INT` à `work_hours` et les persister, soit retirer ces colonnes de l'affichage et n'exposer que `hours_worked`.

**MAJEUR-10 — Module « Schedule » d'`employees.js` entièrement cassé (GET `p.name` + POST `ON CONFLICT`)**
- Preuve GET : `employees.js:173` `SELECT … p.name as position_name` avec `LEFT JOIN positions p` (`:176`) → **`positions` n'a pas de `name`** (a `title`) → `GET /api/employees/schedule/planning` lève 42703 → **500**.
- Preuve POST : la migration `init-db.js:2267` fait `DROP CONSTRAINT schedule_employee_id_date_key` puis ajoute `UNIQUE (employee_id, date, periode)` (`:2270`). Or `employees.js:214` (`POST /schedule`) et `:255` (`/schedule/bulk`) utilisent `ON CONFLICT (employee_id, date)` — contrainte **supprimée** → `ERROR 42P10` → **500**. `planning-hebdo.js:306` (qui utilise `ON CONFLICT (employee_id, date, periode)`) fonctionne, lui.
- Impact : lecture ET écriture du planning mensuel via `employees.js` sont HS. Seul le planning hebdo (`planning-hebdo.js`) reste opérationnel.
- Correctif : `employees.js:173` → `p.title as position_name` ; `employees.js:214,255` → `ON CONFLICT (employee_id, date, periode)` (défaut `journee`).

### MINEUR

- **MINEUR-1 — Fuite `err.message` sur 3 KPI RH** : `employees.js:943,967,994` renvoient `res.status(500).json({ error: err.message })` (incohérent avec « Erreur serveur » ailleurs) → divulgation de structure SQL.
- **MINEUR-2 — Code mort confirmé** : `services/cv-processor.js` duplique `SKILLS_PATTERNS`/`getSkillPatterns` de `candidates/cv-engine.js` et **n'est requis nulle part** (grep `cv-processor` = 0 import) → supprimer.
- **MINEUR-3 — `positions/list` triple fallback SQL** : `candidates/positions.js:11-27` exécute jusqu'à 3 requêtes en cascade sur erreur `42703` (colonne manquante) — pansement masquant un schéma incertain ; devrait s'appuyer sur le schéma canonique `init-db.js:225`.
- **MINEUR-4 — CHECK constraint milestone incohérent** : `insertion/index.js:138` autorise `'Bilan M+2'` (jamais produit) mais le type standard reste `M+10`/`Sortie` ; résidu de migration.
- **MINEUR-5 — `pointage` overtime seuil 7 h/jour hardcodé** : `pointage.js:154` `Math.max(0, hoursWorked - 7)` alors que le CDDI = 26 h/sem (~5 h/j) ; seuil arbitraire non paramétrable.
- **MINEUR-6 — `pointage` event_type par parité** : `pointage.js:99-100` déduit entrée/sortie via `count % 2` ; un rejet/anti-doublon peut désynchroniser entrée/sortie sur la journée.
- **MINEUR-7 — PCM `/submit` via access_token sans limite de tentative** : `pcm.js:849-856` `authenticateSubmit` laisse passer si `access_token` présent ; pas de rate-limit ni d'expiration de session PCM.
- **MINEUR-8 — Absentéisme planifié : statuts hétérogènes** : `employees.js:511` compte `schedule.status IN ('absence','maladie','sick')` alors que `work_hours.type` n'a que `('absence','sick')` — le libellé `maladie` n'existe pas côté work_hours, risque de comparaison prévu/réel biaisée.
- **MINEUR-9 — Conversion : compétences seulement `confirmed`/`detected` transférées** : `candidates/conversion.js:44` — les compétences `not_mentioned` sont perdues (acceptable) mais aucun log si 0 compétence transférée.
- **MINEUR-10 — `employees` DELETE `/clear`** : `employees.js:560` purge dur `work_hours/schedule/availability/contracts` de TOUS les employés ; opération très destructive derrière un simple `authorize('ADMIN')` sans confirmation/2e facteur.
- **MINEUR-11 — `planning-hebdo` exclut RH** : `planning-hebdo.js:8` `authorize('ADMIN','MANAGER')` — le rôle RH (qui gère le planning selon §5 module 4) n'a pas accès au planning hebdo. À confirmer côté métier (intentionnel ou oubli).
- **MINEUR-12 — Alertes insertion sans consultation in-app** : `scheduler.js` remplit `insertion_interview_alerts` et envoie l'email J-1, mais **aucune route `GET /insertion/alerts`** — le CIP ne dispose d'aucune liste in-app des rappels/retards (dépend de l'email). Ajouter un endpoint + badge sur InsertionParcours.

---

## 3. LOGIQUE ROUTEURS (auth / rôles / PII)

- **Insertion** : tout ouvert ADMIN/RH/MANAGER (`insertion/index.js:187`) → BLOQUANT-3 (PII médico-sociale à MANAGER). IA restreint ADMIN/RH (bien).
- **Teams** : GET sans `authorize` → MAJEUR-1 (fuite fiches employés).
- **Prescripteurs** : GET sans `authorize` → MAJEUR-6.
- **Employees** : `/:id/hours` ouvert COLLABORATEUR sans self-check → MAJEUR-5. Reste ADMIN/RH/MANAGER (fiches salariés incluant statut insertion visibles MANAGER — cohérent avec l'encadrement mais large).
- **Planning-hebdo** : `ADMIN/MANAGER` seulement (`planning-hebdo.js:8`), **RH exclu** (MINEUR-11).
- **PCM** : profils déchiffrés bien restreints ADMIN/RH (`pcm.js:954,1011`) ; questionnaire/types ADMIN/RH/MANAGER (OK). Session autonome par token (OK).
- **Candidates** : lecture ADMIN/RH/MANAGER (participation MANAGER au recrutement = intentionnel) ; écriture ADMIN/RH ; suppression ADMIN. Cohérent. Note : `interview-form` (freins emploi, situation sociale) lisible MANAGER — acceptable en contexte recrutement mais à surveiller.
- **Acquis corrigés pendant l'audit** (non recomptés) : RESP_BTQ refusé par POST /api/users (corrigé) ; /candidates ouvert MANAGER (corrigé) ; bornes `month + '-31'` RH dans `employees.js` (corrigé via `utils/month-range.js`).

---

## 4. SIMPLICITÉ D'USAGE (encadrants/CIP peu à l'aise)

- **PCM FALC bien pensé** : `pcm.js:154-309` textes simplifiés + icônes + mélange déterministe des options (anti-biais 1re position). Bon point accessibilité.
- **Erreurs muettes** : plusieurs `catch` avalent l'erreur (`.catch(()=>{})` `individual.js:111`, try/catch silencieux insertion PCM `routes.js:587`) → l'utilisateur ne sait pas qu'une donnée n'a pas été enregistrée/chargée.
- **Jargon** : « frein linguistique », « explorama », « RPS » exposés sans définition ; `insertion/routes.js:88` `/freins-definitions` existe (bien) — vérifier qu'il est affiché côté UI.
- **Formulaire diagnostic très long** : `PUT /diagnostic` a ~46 champs (`routes.js:113-161`) — risque d'abandon ; envisager saisie par onglets/sauvegarde partielle.
- **CV parsing best-effort silencieux** : si l'extraction échoue, `parseCVFile` renvoie `''` sans prévenir → le RH croit que « rien n'a été trouvé » sans distinguer échec technique vs CV vide.

---

## 5. OPTIMISATIONS

- **N+1 conversion candidat** : `candidates/crud.js:96-101` et `individual.js:154-161` insèrent les compétences une par une en boucle (15 requêtes) — batcher en un seul INSERT multi-valeurs.
- **N+1 import CSV collaborateurs** : `employees.js:764-827` une requête `SELECT teams` + 2 INSERT par collaborateur en boucle → sur un import de 50 lignes = 150 requêtes ; précharger la map teams une fois.
- **N+1 insertion milestones initialize** : `insertion/routes.js:403-420` SELECT+INSERT par jalon (10 requêtes/ salarié).
- **`GET /insertion/:employeeId`** : 10 requêtes séquentielles (`routes.js:540-635`) — paralléliser via `Promise.all` (indépendantes).
- **Index** : vérifier index sur `work_hours(employee_id, date)`, `pointage_events(employee_id, date, status)`, `insertion_milestones(employee_id, milestone_type)` (unique OK `index.js:147`), `candidate_skills(candidate_id, skill_name)`.

---

## 6. ÉVOLUTIONS SIAE

- **Export DREETS / sorties dynamiques** : les champs `sortie_employeur_siret` + `sortie_duree_contrat_mois` existent (`routes.js:274-275`) mais aucun endpoint d'export agrégé « sorties positives/dynamiques » par cohorte. Ajouter un export CSV DREETS.
- **Lien France Travail** : `prescripteurs.js` distingue déjà PE/FT ; prévoir l'API France Travail (i-milo/ DE) pour pré-remplir la prescription au lieu de la saisie manuelle.
- **Suivi CDDI 24 mois** : `insertion/routes.js:71-75` calcule une urgence fin de contrat (30/60 j) mais **pas le plafond légal 24 mois CDDI** ; ajouter une alerte « approche 24 mois » (dérogation nécessaire au-delà).
- **Alertes fin de contrat** : matérialiser réellement `insertion_interview_alerts` (MAJEUR-8) + alertes fin de CDDI et visite médicale (la structure `visite_medicale/alertes` existe déjà `employees.js:853`, bon modèle à répliquer).

---

## 7. QUICK WINS SÛRS (faible risque, fort impact)

1. `pointage.js:252-253` → `monthBounds(month)` (corrige BLOQUANT-2, 1 ligne).
2. `insertion-ai.js` → `p.title as position_name`, join `p.title = e.position`, retirer `e.hire_date` + colonnes nues `d.mobilite…` (corrige BLOQUANT-4, feature IA réactivée).
3. `employees.js:214,255` → `ON CONFLICT (employee_id, date, periode)` (corrige MAJEUR-10, planning enregistrable).
4. `insertion/routes.js:309` → ajouter `frein_numerique` au SELECT (corrige MAJEUR-4).
5. `teams.js:13,29` + `prescripteurs.js:15,33,47` → ajouter `authorize('ADMIN','RH','MANAGER')` (corrige MAJEUR-1, MAJEUR-6).
6. `employees.js:943,967,994` → remplacer `err.message` par `'Erreur serveur'` (MINEUR-1).
7. Aligner `pcm.js:724` sur `PCM_ENCRYPTION_KEY || JWT_SECRET` (prépare BLOQUANT-1 ; prévoir migration de re-chiffrement).

---

## 8. NOTE MÉTHODE

Audit de bout en bout (route + page + table) sur : `candidates/*`, `pcm.js`, `employees.js`, `teams.js`, `planning-hebdo.js`, `pointage.js`, `insertion/*`, `prescripteurs.js`, `services/{cv-processor,insertion-ai}.js`, schéma `init-db.js`, et pages `Candidates/PersonalityMatrix/PCMTest/WorkHours/InsertionParcours/Pointage.jsx`. Schémas SQL vérifiés directement (positions, employees, work_hours, schedule, insertion_diagnostics). `insertion/engine.js` (base de connaissances freins/questionnaires CIP) non détaillé faute de temps mais alimente `buildTimeline`/`analyzeInsertion` (moteur heuristique local, distinct de l'IA Claude cassée en BLOQUANT-4).

*Rapport finalisé le 2026-07-03.*

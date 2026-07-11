# Audit technique — Module « Recrutement & profil de personnalité PCM »

**Date** : 11 juillet 2026
**Périmètre** : `backend/src/routes/candidates/` (index, crud, individual, conversion, cv-engine, keywords, positions, documents), `backend/src/routes/pcm.js`, `backend/src/services/cv-processor.js`, pages `Candidates.jsx`, `RecruitmentPlan.jsx`, `PersonalityMatrix.jsx`, `PCMTest.jsx`, schéma `init-db.js`, tests.
**Note globale : 6.5 / 10** — base saine et sécurisée, mais dette réelle (transactions, minimisation des données, contrat front/back, code mort, absence de tests sur le cœur métier).

---

## 1. Qualité & cohérence

Le module respecte globalement les patterns du projet. Le routeur `candidates` est proprement **modularisé** en sous-routeurs avec un ordre de montage documenté (`candidates/index.js` l. 63-86) qui évite la capture des chemins fixes par `/:id`. Les routes portent systématiquement `authenticate` + `authorize(...)`, la **SQL est paramétrée partout** ($1/$2), et les erreurs suivent le contrat `res.status().json({ error })`. Le moteur PCM (`pcm.js`) est bien pensé : scoring pondéré Base/Phase, tie-breakers non biaisés (`resolveDominantType`, l. 535), score de confiance, mélange déterministe des options (`shuffleOptionsDeterministic`, l. 321) pour éviter le biais « première position ».

**Duplication notable** :
- `SKILLS_PATTERNS` / `getSkillPatterns` / `escapeRegex` sont dupliqués à l'identique entre `candidates/cv-engine.js` et `services/cv-processor.js` (ce dernier étant du **code mort**, cf. §2).
- `TYPE_LABELS` (6 types PCM) est redéfini dans `PCMTest.jsx`, `PersonalityMatrix.jsx` et `pcm.js` — toute évolution du référentiel exige 3 éditions.
- Les deux sous-requêtes corrélées `linked_employee_id` / `linked_employee_name` (`crud.js` l. 20-23 et l. 52-54) sont copiées entre `GET /` et `GET /kanban` et exécutent 2 SELECT sur `employees` **par ligne** — factorisables en un `LEFT JOIN` unique.

**Taille de fichiers** : `Candidates.jsx` fait **1386 lignes** et embarque une douzaine de sous-composants dont `InterviewFormView` (~230 lignes de formulaire inline). `pcm.js` (1053 lignes) mélange le référentiel des 6 types, les 20 questions, les textes FALC, le moteur de scoring et les routes — candidat naturel à une extraction (`pcm-engine.js` + `pcm-content.js` + routeur).

## 2. Dette technique

- **Code mort confirmé** : `services/cv-processor.js` n'est importé nulle part dans `src/` (seules des références documentaires subsistent). À supprimer.
- **Divergence schéma DB ↔ runtime** : la définition canonique `CREATE TABLE candidates` (`init-db.js` l. 131-132) porte un CHECK obsolète `('received','preselected','interview','test','hired')` — **sans `rejected`**, statut pourtant utilisé partout dans le code (`crud.js` l. 82, `Candidates.jsx` l. 9). Le CHECK n'est corrigé que par une migration située ~1200 lignes plus loin (l. 2364-2380). La définition de tête est donc **trompeuse** pour tout lecteur et l'intégrité repose entièrement sur l'ordre d'exécution des migrations.
- **Dérive de schéma défensive** : `positions.js` `GET /list` (l. 12-27) tente **3 requêtes en cascade** en rattrapant l'erreur `42703` (colonne absente) — symptôme d'un schéma `positions` qui a divergé (`is_active`/`created_at` incertains sur bases anciennes) plutôt qu'une migration idempotente franche.
- **Valeurs magiques** : listes de statuts, rôles et types PCM répétés en dur côté back et front sans source unique.
- **Index manquants** : aucun index sur `pcm_reports(candidate_id)`, `pcm_sessions(candidate_id)`, `pcm_answers(session_id)` ni `candidate_history(candidate_id)`, alors que ces colonnes sont des critères de filtre (`pcm.js` l. 986-998, 1022-1031 ; `individual.js` l. 241-248). Impact faible vu les volumes d'une SIAE, mais à corriger par cohérence (les tables entretien/mise-en-situation, elles, sont indexées — l. 3076-3078).

## 3. Sécurité

Fondamentaux solides. **Aucune injection SQL** détectée (paramétrage systématique, y compris les `UPDATE` dynamiques de `crud.js`/`keywords.js` qui n'interpolent que des noms de colonnes issus d'une whitelist `allowedFields`). Le **download CV protège contre le path-traversal** (`individual.js` l. 187-192, résolution + vérification `startsWith(uploadsDir)`), et l'upload valide **extension ET type MIME** (`index.js` l. 34-41). Le flux candidat autonome repose sur un **capability-token** de 32 octets (`pcm.js` l. 795), le webhook/soumission publique étant borné par ce secret (`authenticateSubmit`, l. 860-867) — conception propre.

**Points d'attention** :
- **Exposition de données non minimisées (RGPD)** : `GET /candidates` et `GET /kanban` renvoient `SELECT c.*`, ce qui embarque **`cv_raw_text`** (texte intégral du CV, données personnelles) et tous les champs pour **chaque** candidat du tableau. C'est à la fois un enjeu de minimisation et un poids de charge utile inutile. Une projection de colonnes explicite est nécessaire.
- **Granularité `authorize`** : `GET /:id/history` est réservé ADMIN/RH alors que `GET /:id` (qui expose plus) est ouvert à MANAGER — incohérence mineure à trancher. Rien de sur-permissif en revanche : la suppression candidat/poste/keyword est bien ADMIN-only.

## 4. Robustesse

C'est le point faible principal.

- **Écritures multi-tables sans transaction** : `POST /pcm/submit` (`pcm.js` l. 908-941) insère les 18-20 réponses **une par une**, puis le rapport, puis met la session à `completed` — le tout **hors transaction**. Un échec en cours (ex. réponse au `question_number` manquant → violation `NOT NULL` → 500) laisse des réponses partielles persistées. Comme `pcm_answers` **n'a pas de contrainte `UNIQUE(session_id, question_number)`** (l. 204-212), une resoumission empile des **doublons** (le calcul les déduplique en mémoire, mais l'endpoint `/answers` les affichera). Idem pour `POST /candidates` et `upload-cv-new` (candidat + historique + N compétences non atomiques).
- **Upserts destructifs non atomiques** : `interview-form` et `mise-en-situation` font `DELETE` **puis** `INSERT` sans transaction (`conversion.js` l. 185-219, 261-276). Un échec de l'INSERT après le DELETE **perd** l'évaluation précédente.
- **Bonne pratique isolée** : à l'inverse, `link-employee` est correctement transactionnel avec `BEGIN/COMMIT`, verrou de cohérence et gestion des conflits 409 (`conversion.js` l. 81-136) — c'est le modèle à généraliser.
- **Catch muets côté front** : nombreux `catch { }` / `catch (err) { console.error(err); }` sans retour utilisateur dans `Candidates.jsx` (`moveCandidate` l. 163, `createCandidate` l. 173, `createPosition` l. 271), et recours à `alert()` ailleurs. Le `RecruitmentPlan.jsx` déclenche un **POST + rechargement complet à chaque frappe** sur le champ `slots` (`updateSlots`, l. 42/128) — à *debouncer*.

## 5. Testabilité

Couverture quasi inexistante sur le cœur métier. `tests/unit/routes/candidates.test.js` couvre seulement liste/détail/création/statut/stats (mocks `pg`). **Aucun test** sur :
- le **moteur PCM** `calculatePCMProfile` — pourtant des **fonctions pures** idéales à tester (résolution Base/Phase, tie-breakers, `computeConfidence`, `riskAlert`, cas d'égalité et d'indétermination). C'est la priorité n°1 : un module qui classe la personnalité de salariés en insertion doit être verrouillé par des tests.
- l'extraction CV (`extractName`, `extractFromCV`) et le chiffrement/déchiffrement avec repli de clé historique (`decryptReport`).
- la liaison candidat↔collaborateur (gardes d'unicité, 409).

## 6. Contrat front/back rompu (constat transverse)

`Candidates.jsx` filtre sur `c.pcm_completed`/`c.pcm_type` (l. 300, 375) et affiche `c.position_title` (l. 363) ainsi qu'un delta `stats.trend` (l. 331) — **aucun de ces champs n'est produit** par `GET /kanban` ni `GET /stats` (`crud.js`). Conséquence : le **filtre « Avec PCM » et le badge PCM des cartes ne se déclenchent jamais**, et le libellé de poste retombe toujours sur l'email. À réconcilier (enrichir la requête kanban avec `EXISTS(pcm_reports)` + jointure `positions`, ou retirer le code front mort).

---

## Propositions priorisées

| # | Priorité | Effort | Action |
|---|----------|--------|--------|
| 1 | **P1** | S | Rendre `POST /pcm/submit` atomique (transaction) et ajouter `UNIQUE(session_id, question_number)` + `ON CONFLICT` sur `pcm_answers` (anti-doublon, idempotence). Valider chaque `answer.question_number`. |
| 2 | **P1** | S | Restreindre `GET /candidates` et `/kanban` à une projection de colonnes explicite (exclure `cv_raw_text` et champs non affichés) — minimisation RGPD + charge utile. |
| 3 | **P1** | S | Aligner le contrat kanban ↔ `Candidates.jsx` : renvoyer `pcm_completed`/`pcm_type`/`position_title` (via `EXISTS` + JOIN `positions`) ou retirer le filtre/badge inopérant. |
| 4 | **P2** | S | Supprimer `services/cv-processor.js` (code mort) ; centraliser `SKILLS_PATTERNS` et `TYPE_LABELS` dans un module partagé unique. |
| 5 | **P2** | S | Ajouter une suite de tests unitaires du moteur PCM (`calculatePCMProfile` : Base/Phase, tie-breakers, confiance, `riskAlert`, cas limites) + `extractName`/`decryptReport`. |
| 6 | **P2** | S | Corriger la définition `CREATE TABLE candidates` (CHECK aligné sur `received/interview/hired/rejected`) pour cesser de dépendre d'une migration lointaine. |
| 7 | **P2** | M | Généraliser les transactions : upserts `interview-form`/`mise-en-situation` en `INSERT ... ON CONFLICT` atomique ; factoriser les sous-requêtes `linked_employee` en `LEFT JOIN`. |
| 8 | **P2** | S | *Debounce* l'écriture des `slots` dans `RecruitmentPlan.jsx` ; ajouter les index `candidate_id` manquants (`pcm_reports`, `pcm_sessions`, `pcm_answers`, `candidate_history`). |

---

*Fin du rapport — audit technique recrutement-pcm.*

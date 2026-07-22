# Plan de codage — Extension du module Insertion (historique des entretiens)

- **Date** : 22 juillet 2026 — rédigé par l'orchestrateur de la mission
- **Entrées** : `04-plan-action-fonctionnel.md` (lots et décisions D1-D13), `03-etat-des-lieux-technique.md` (références précises `fichier:ligne`), `01-cadrage-conformite.md` (EXG-01→48)
- **Statut** : PROPOSITION — à valider avant tout développement
- **Règles du projet respectées** : schéma uniquement dans `init-db.js` (idempotent), SQL paramétré, `authenticate`+`authorize`, UI en français, pas de nouvelle dépendance, patterns existants (exceljs, PDF par fenêtre d'impression, settings, scheduler instrumenté, pseudonymisation IA, anonymisation RGPD)

---

## 0. Principes d'implémentation

1. **Une seule table d'entretiens** : `insertion_milestones` est étendue (pas de table parallèle) — les 5 types historiques deviennent des occurrences du modèle élargi (D1, EXG-48).
2. **Référentiel unique des freins** : nouveau module `backend/src/routes/insertion/freins-registry.js` exportant `FREIN_KEYS` (9 axes), labels, colonnes SQL, flags de sensibilité (`sante`→art. 9, `judiciaire`→art. 10) ; miroir frontend `frontend/src/components/insertion/freins.js`. Tous les points aujourd'hui câblés en dur (03 §5.3 : engine, routes, IA, exports, anonymisation, radar, PDF) basculent sur ce registre.
3. **Aucune valeur métier en dur** : cibles conventionnelles, seuils d'alerte, délais → `settings` (préfixe `insertion.*`).
4. **Chaque endpoint nouveau/modifié** reçoit un test de contrat (pattern `backend/tests/contract/`) et les écritures sensibles un test d'habilitation.
5. **Migrations** : DO blocks idempotents dans la section migrations d'`init-db.js`, avec scan `pg_constraint` pour lever les contraintes nommées automatiquement (pattern migration `users.role`, v2.4.1) ; **double exécution prouvée** sur base neuve ET base peuplée legacy.

---

## 1. Schéma de données (init-db.js)

### 1.1 Lot 1 — modèle « entretiens »

**Migration des contraintes (DO blocks, ordre critique)** :
1. Lever le CHECK `milestone_type` (5 libellés figés, `init-db.js:2965`) → nouveau CHECK élargi :
   `('diagnostic_accueil','bilan_intermediaire','renouvellement','bilan_sortie','suivi_post_sortie')`.
2. **Migration de données** (UPDATE idempotent AVANT le nouveau CHECK) :
   - `'Diagnostic accueil'` → `type='diagnostic_accueil'`, `titre='Diagnostic d''accueil'`
   - `'Bilan M+3' / 'Bilan M+6' / 'Bilan M+10'` → `type='bilan_intermediaire'`, `titre=` libellé d'origine
   - `'Bilan Sortie'` → `type='bilan_sortie'`, `titre='Bilan de sortie'`
3. Supprimer `UNIQUE(employee_id, milestone_type)` (`init-db.js:3010`) et l'index `idx_milestones_emp_type_unique` (`init-db.js:3132`) → remplacés par **2 index uniques partiels** : `(employee_id) WHERE milestone_type='diagnostic_accueil'` et `(employee_id) WHERE milestone_type='bilan_sortie'` (un accueil et une sortie par salarié ; bilans/renouvellements/post-sortie multiples). Index simple `(employee_id, due_date)`.
4. Reprendre les `ON CONFLICT` qui s'appuyaient sur l'unicité par type (`routes.js:267`, `engine.js:1551`) → ciblage par id ou par index partiel.

**Nouvelles colonnes `insertion_milestones`** (ADD COLUMN IF NOT EXISTS) :

| Colonne | Type | Usage |
|---|---|---|
| `titre` | VARCHAR(120) | libellé affiché (« Bilan n° 3 », « Renouvellement mars 2027 ») |
| `previous_milestone_id` | INTEGER FK self SET NULL | chaînage bilan → bilan précédent |
| `previous_review` | JSONB | évaluation du bilan précédent : `[{kind:'objectif'\|'action', id, verdict:'ok'\|'non_ok'\|'partiel', echeance_respectee:bool, commentaire}]` |
| `validations` | JSONB | validations horodatées `[{role:'salarie'\|'cip'\|'eti'\|'directeur', user_id, at, mode:'compte'\|'presence'}]` (D7) |
| `ia_preparation`, `ia_preparation_at` | JSONB, TIMESTAMP | note de préparation IA historisée (Lot 7) |
| `contract_id` | INTEGER FK `employee_contracts` SET NULL | lien renouvellement ↔ contrat |
| `renouvellement_form` | JSONB | trame interne (assiduité, motivation, autonomie, participation, motifs, commentaires) |
| `renouvellement_avis` | VARCHAR(30) CHECK (`favorable`,`favorable_reserves`,`defavorable`) | requêtable |
| `renouvellement_duree_mois` | SMALLINT | 2/4/6/autre |
| `sortie_documents` | JSONB | check-list `{stc, certificat_travail, attestation_france_travail}` (EXG-07) |
| `post_sortie_situation` | VARCHAR(30) CHECK (`emploi_durable`,`emploi_transition`,`formation`,`recherche_emploi`,`autre`,`injoignable`) | EXG-08 |
| `post_sortie_commentaire` | TEXT | |
| `frein_logement`, `frein_judiciaire` | INTEGER CHECK 1-5, **sans défaut** | snapshots des 2 nouveaux axes |

**Nomenclature des sorties (D8, EXG-06)** : lever le CHECK `sortie_classification` (`positive`/`negative`) → `('emploi_durable','emploi_transition','sortie_positive','autre')` ; migration mappée par `sortie_type` existant (CDI, CDD≥6 mois, création → durable ; CDD_court, intérim → transition ; formation, autre_IAE → positive ; sans_suite, fin_contrat → autre), ancienne valeur conservée dans `sortie_classification_legacy` ; la définition unifiée `sortie_dynamique = classification IN (durable, transition, positive)` remplace `='positive'` partout (`routes.js` stats, `exports.js` FSE+, `metropole.js` sortie-dynamique).

### 1.2 Lot 2 — diagnostic refondu

**`insertion_diagnostics`** — ADD COLUMN IF NOT EXISTS (colonnes requêtables ; le détail à cases multiples va dans `questionnaire_detail` JSONB — D5) :

- Logement : `logement_statut` VARCHAR(30) CHECK (`locataire_social`,`locataire_prive`,`proprietaire`,`heberge`,`sans_abri`), `logement_satisfaction` BOOLEAN, `commentaire_logement` TEXT.
- Droits/administratif : `piece_identite_validite` DATE, `allocataire_caf` BOOLEAN, `ressources` TEXT[] (valeurs contrôlées applicativement : RSA, APL, AF, CF, ASF, AAH, ARE, prime_activite, aucune), `commentaire_droits` TEXT.
- Santé (art. 9) : `mutuelle_statut` VARCHAR(30), `rqth` BOOLEAN, `rqth_fin` DATE, `contre_indications` BOOLEAN, `suivi_sante` BOOLEAN, `commentaire_sante` TEXT **chiffré** (D9), les détails texte existants `frein_sante_detail/_causes` passent aussi au chiffrement applicatif.
- Budget : `difficultes_financieres` BOOLEAN, `credits_en_cours` BOOLEAN, `commentaire_budget` TEXT.
- Mobilité : `permis_b_statut` VARCHAR(20) CHECK (`oui`,`non`,`code_en_cours`,`conduite_en_cours`), `vehicule` BOOLEAN, `moyen_transport` TEXT[], `commentaire_mobilite` TEXT.
- Situation pro : `autre_employeur` BOOLEAN, `autre_employeur_heures` NUMERIC(4,1), `souhait_complement_heures` BOOLEAN.
- Projet pro : `niveau_formation` VARCHAR(10) (nomenclature officielle : `infra3`,`niv3`,`niv4`,`niv5`,`niv6plus`), `metiers_souhaites` TEXT, `pret_a_se_former` VARCHAR(20), `cpf_accessible` BOOLEAN, `projet_formation` TEXT, `emploi_vise` TEXT, `emploi_vise_rome` VARCHAR(8), `commentaire_projet` TEXT.
- Rubrique IX (expression salarié) : `attentes_parcours`, `difficultes_exprimees`, `objectifs_exprimes`, `aide_souhaitee` TEXT.
- Linguistique : `cecrl_niveau` VARCHAR(2) (A1…C2), `commentaire_linguistique` TEXT.
- Situation familiale : `situation_familiale` VARCHAR(20) CHECK (`marie`,`celibataire`,`en_couple`,`divorce`,`veuf`), `nb_enfants` SMALLINT, `enfants_a_charge` BOOLEAN.
- Nouveaux freins : `frein_logement`, `frein_logement_detail`, `frein_logement_causes` ; `frein_judiciaire` INTEGER, `frein_judiciaire_detail` TEXT **chiffré** (D9/D10 — niveau + impact organisationnel factuel uniquement, aide à la saisie explicite).
- `questionnaire_detail` JSONB (cases à cocher détaillées des rubriques : motifs logement, comptes en ligne, dettes, état du véhicule, souhaits de complément…).

**Colonnes dormantes** (03 §3.1 : 23 colonnes jamais écrites) : réutilisées quand elles correspondent (`cip_hypotheses_metiers` → exposé dans Projet pro ; `contraintes_*` → remplacées par les rubriques structurées, gelées en lecture seule legacy) ; les `pcm_q_*` et `explorama_*` restent gelées (décision documentée, pas de suppression de colonnes en v1).

**`employees`** : `pass_iae_number` VARCHAR(30), `pass_iae_start` DATE, `pass_iae_end` DATE, `cddi_derogation_motif` VARCHAR(30) CHECK (`formation_en_cours`,`senior_50`,`rqth`,`cdi_inclusion`), `cddi_derogation_date` DATE, `eligibilite_criteres` TEXT, `eligibilite_justificatifs_ref` TEXT (localisation des pièces, pas les pièces), `france_travail_id` VARCHAR(30) (**seulement si arbitrage n° 6 = oui**). → ajoutées à la liste blanche du `PUT /employees/:id` (`employees.js:106-117`) et au pré-remplissage depuis la fiche candidat au `link-employee`.

**`candidates`** (PROP-02, base) : `prescripteur_id` FK `prescripteur_orgas`, `pass_iae_number`/`pass_iae_start`/`pass_iae_end`, `eligibilite_criteres` TEXT — recopiés vers `employees` à la liaison.

### 1.3 Lot 3 — objectifs, partenaires, actions

```sql
CREATE TABLE IF NOT EXISTS insertion_objectifs (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES insertion_objectifs(id) ON DELETE CASCADE,   -- sous-objectif
  milestone_id INTEGER REFERENCES insertion_milestones(id) ON DELETE SET NULL, -- entretien d'origine
  titre VARCHAR(200) NOT NULL,
  description TEXT,
  origine VARCHAR(10) NOT NULL DEFAULT 'cip' CHECK (origine IN ('salarie','cip')),
  echeance DATE,
  date_butoir DATE,
  statut VARCHAR(25) NOT NULL DEFAULT 'en_cours'
    CHECK (statut IN ('a_venir','en_cours','atteint','partiellement_atteint','abandonne','reporte')),
  ordre SMALLINT NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insertion_objectifs_employee ON insertion_objectifs(employee_id);
CREATE INDEX IF NOT EXISTS idx_insertion_objectifs_parent   ON insertion_objectifs(parent_id);

CREATE TABLE IF NOT EXISTS insertion_partenaires (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(150) NOT NULL UNIQUE,
  categorie VARCHAR(30),          -- administratif, emploi, logement, sante, justice, formation, mobilite, autre
  contact_nom VARCHAR(120), contact_tel VARCHAR(30), contact_email VARCHAR(150),
  actif BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
-- seed idempotent (ON CONFLICT (nom) DO NOTHING) : CAF, France Travail, CPAM, ANTS, SOLIHA,
-- Action Logement, bailleurs sociaux, OPCO, Mission locale, CD76, centre des finances publiques,
-- Banque de France (surendettement), organisme de formation, auto-école sociale, SPIP, avocat/AJ…
```

`cip_action_plans` : `ALTER COLUMN milestone_id DROP NOT NULL` + ADD `objectif_id` FK `insertion_objectifs` SET NULL, `partenaire_id` FK `insertion_partenaires` SET NULL, `resultat` TEXT, `created_by` INTEGER FK users. (La « criticité » reste `priority`, relibellée dans l'UI — D6.)

### 1.4 Lot 4 — PMSMP, satisfaction

```sql
CREATE TABLE IF NOT EXISTS insertion_pmsmp (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  entreprise VARCHAR(200) NOT NULL, siret VARCHAR(14),
  objet VARCHAR(30) NOT NULL CHECK (objet IN ('decouvrir_metier','confirmer_projet','initier_recrutement')),
  date_debut DATE NOT NULL, date_fin DATE NOT NULL,
  tuteur VARCHAR(120), bilan TEXT,
  saisie_outil_officiel BOOLEAN NOT NULL DEFAULT false,  -- Immersion Facilitée (art. 3.3 convention)
  convention_ref VARCHAR(60),
  created_by INTEGER REFERENCES users(id), created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS insertion_satisfaction_sortie (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  milestone_id INTEGER REFERENCES insertion_milestones(id) ON DELETE SET NULL,
  date_reponse DATE,
  reponses JSONB NOT NULL DEFAULT '{}'::jsonb,   -- sections/questions de la trame, échelle 1-4 (smileys) + commentaires
  situation_sortie VARCHAR(30),
  satisfaction_globale SMALLINT CHECK (satisfaction_globale BETWEEN 1 AND 4),
  suggestions TEXT, avis_transmis TEXT,
  created_by INTEGER REFERENCES users(id), created_at TIMESTAMP DEFAULT NOW()
);
```

Contrôle applicatif PMSMP (EXG-05) : durée ≤ 31 j par convention, cumul ≤ 60 j sur 12 mois glissants → avertissement bloquant (409 avec détail).

### 1.5 Chiffrement applicatif (D9)

Nouveau `backend/src/utils/field-crypto.js` (AES-256 via crypto-js, clé `PCM_ENCRYPTION_KEY` — pattern PCM existant, `init-db.js` non concerné) : `encryptField/decryptField` + liste centrale `SENSITIVE_FIELDS` (santé : `commentaire_sante`, `frein_sante_detail`, `frein_sante_causes`, `contre_indications` détail ; judiciaire : `frein_judiciaire_detail`). Chiffrement/déchiffrement dans la couche route (jamais côté client) ; les champs chiffrés sont exclus des `SELECT *` renvoyés aux rôles non habilités (masquage §5).

---

## 2. API backend

### 2.1 Module insertion (`backend/src/routes/insertion/`)

**Modifiés** :
| Endpoint | Évolution |
|---|---|
| `POST /milestones` | accepte les nouveaux types ; `bilan_intermediaire` créable à toute date (titre auto « Bilan n° N ») ; `renouvellement` lié à `contract_id` ; garde d'unicité partielle accueil/sortie |
| `PUT /milestones/:id` | fin du COALESCE intégral (03 §6.3) : liste de champs explicites avec support du null ; écrit `previous_review`, `validations`, `renouvellement_*`, `sortie_documents`, `post_sortie_*` ; **à la réalisation** : contrôles de clôture (voir POST /close) |
| `POST /milestones/:id/close` | **nouveau** : clôture contrôlée — exige freins évalués (ou « non évalué » assumé), `previous_review` renseignée si un bilan précédent existe, **prochain entretien planifié** (création du suivant `planifie`, sauf sortie), catégorie de sortie + check-list documents si `bilan_sortie` ; déclenche `resyncMilestones` (EXG-16/22) et l'effet de clôture parcours existant |
| `GET /milestones/:employeeId/radar` | axes depuis `freins-registry` (9), **null honnête** (les non-évalués ne sont plus tracés à 1 — `routes.js:400,409`) |
| `PUT /diagnostic/:employeeId` | nouveaux champs structurés + JSONB + chiffrement des champs sensibles ; pré-calcul proposé des niveaux de freins depuis les réponses (retourné, jamais imposé) |
| `GET /cohorte/stats`, `GET /audit` | nomenclature sorties à 4 catégories + 3 taux ; typologies publics (RQTH, ressources, niveaux de formation) ; délai moyen diagnostic ; compteurs Pass IAE/renouvellements |
| `GET /:employeeId` | agrège en plus : objectifs, PMSMP, satisfaction (si sortie), alertes de la fiche ; l'auto-init paresseuse en GET est **déplacée** vers les déclencheurs explicites (link-employee, import, bouton) |
| `GET /ia/entretien/:employeeId` | paramètre `milestoneId` (préparation par entretien, tout type), persistance `ia_preparation` |

**Nouveaux** (déclarés AVANT `GET /:employeeId` — 03 §6.2) :
| Endpoint | Rôles | Fonction |
|---|---|---|
| `POST /:employeeId/resync-milestones` | A/RH | recalage manuel des jalons (bouton fiche) — EXG-22 |
| `GET/POST/PUT/DELETE /objectifs…` | A/RH (M lecture) | CRUD objectifs + sous-objectifs ; `GET /objectifs/:employeeId?statut=` |
| `GET/POST/PUT /partenaires` | lecture tous rôles module / écriture A/RH | référentiel partenaires |
| `GET /actions-overview` | A/RH/M | tableau transversal des actions (filtres salarié/catégorie/criticité/partenaire/retard/CIP, pagination) |
| `GET/POST/PUT/DELETE /pmsmp…` | A/RH | CRUD PMSMP avec contrôles de bornes |
| `GET /renouvellements` | A/RH/M | fins de contrat < 6 semaines + état du formulaire de renouvellement |
| `POST /satisfaction/:employeeId` + `GET /satisfaction-stats?year=` | A/RH ; stats non nominatives | questionnaire de sortie + agrégats qualité |
| `GET /alertes/:employeeId` | A/RH/M | alertes de la fiche (consomme enfin `insertion_interview_alerts` + calculs Pass/CDDI/diagnostic 30 j) |

### 2.2 Exports (`backend/src/routes/exports.js`)

- `GET /api/exports/insertion-freins?format=xlsx|csv&sensibles=0|1` (ADMIN/RH) : les 23 colonnes du CDC dans l'ordre (§5 du rapport 01) ; règle de valorisation « dernière évaluation en date » (LATERAL sur le dernier entretien réalisé avec freins, sinon diagnostic) ; `sensibles=0` par défaut (sans frein judiciaire — D10) ; **journalisation `rgpd_audit_log`** de chaque génération (EXG-43).
- `GET /api/exports/insertion-synthese?year=` : synthèse agrégée non nominative (comités de pilotage — EXG-14).
- Export FSE+ existant : aligné sur la nouvelle nomenclature de sorties.

### 2.3 Liaison recrutement (`backend/src/routes/candidates/conversion.js`)

`POST /link-employee` complété (PROP-01/02) : recopie prescripteur/Pass IAE/éligibilité vers `employees`, initialise `insertion_status='en_parcours'` + `insertion_start_date` (si contrat actif CDDI), **crée les jalons** (`generateMilestones`), pré-remplit le diagnostic (parcours antérieur, projet exprimé, freins signalés à l'embauche en **texte contextuel** — jamais de score pré-posé), trace `candidate_history`.

### 2.4 Scheduler (`backend/src/services/scheduler.js`)

Nouveaux jobs instrumentés (`runInstrumented`) : `checkPassIaeExpiring` (alerte à J-7 mois + J-2 mois), `checkRenouvellementsAPreparer` (fins de contrat < 6 semaines sans formulaire), `createPostSortieFollowups` (entretien `suivi_post_sortie` planifié à +3 mois après une sortie réalisée), `checkActionsCritiquesEnRetard` ; `checkInsertionMilestones`/`checkInsertionInterviewAlerts` adaptés au nouveau modèle (prochain entretien planifié = source des rappels). Option `insertion.ia_preparation_auto` (settings) : génération IA J-7 avant un entretien planifié.

---

## 3. Frontend

### 3.1 Composants partagés extraits (`frontend/src/components/insertion/`)

| Composant | Contenu | Origine |
|---|---|---|
| `freins.js` | miroir du registre (9 axes, labels, couleurs, flag sensible) | `FREIN_KEYS` (`InsertionParcours.jsx:52`) |
| `RadarFreins.jsx` | radar SVG 9 axes, séries superposées, **non-évalué non tracé**, légende deltas | `RadarChart` (l.89-138) |
| `FriseParcours.jsx` | **nouvelle** frise horizontale : bandeaux contrats successifs, points entretiens (couleur par type, plein/creux selon statut), losanges objectifs (échéance/butoir), segments PMSMP, événements recrutement, sortie/post-sortie ; zoom, clic → détail ; s'appuie sur `GET /timeline` enrichi |
| `EntretienForm.jsx` | formulaire d'entretien par type (sections conditionnelles : évaluation du précédent, freins, questionnaire CIP, renouvellement, sortie, post-sortie) + validations + PDF | `BilanPanel` (l.207-532) refondu |
| `DiagnosticForm.jsx` | questionnaire d'accueil 9 rubriques (accordéon, une rubrique = un bloc + commentaire CIP + suggestion de niveau de frein), adapté ST | formulaire actuel (l.1357-1428) refondu |
| `ObjectifsPanel.jsx` | arbre objectifs/sous-objectifs, statuts, échéances/butoirs, origine salarié/CIP | nouveau |
| `ActionsPanel.jsx` | liste + ajout rapide complet (catégorie, criticité, échéance, partenaire, rattachement) | bloc actions (l.485-520) |
| `AlertesBloc.jsx` | alertes de la fiche (retards, Pass, CDDI, renouvellement) | nouveau |

### 3.2 Pages

- **`InsertionParcours.jsx`** : recomposée sur les composants partagés ; onglets : Frise / Diagnostic / Entretiens & bilans / Objectifs & actions / Freins / Assistant IA ; en-tête enrichi (Pass IAE, badges alertes) ; `CohortePanel` conservé (KPI + files actives) avec lien vers les nouvelles vues.
- **`Employees.jsx`** : nouvel onglet « **Parcours insertion** » (frise + entretiens + objectifs/actions + alertes, lecture ADMIN/RH/MANAGER avec masquage des champs sensibles) — D11.
- **`ActionsCIP.jsx`** (nouvelle, `/insertion/actions`) : tableau transversal des actions (tri échéance, filtres, ajout rapide, export CSV).
- **`AuditInsertion.jsx`** : bloc « Indicateurs conventionnels » (3 taux de sorties vs cibles settings avec état « objectif non paramétré », ETP réalisés/conventionnés étiquetés « contrôle », typologies, délai diagnostic, PMSMP/formations) + formulaire cibles (ADMIN/RH) ; radar 9 axes.
- **`AdminInsertion.jsx`** (nouvelle, `/admin/insertion`) : référentiels — partenaires, postes ST du questionnaire, seuils d'alerte, option IA auto (ADMIN).
- Routage `App.jsx` + menu `Layout.jsx` (section RH et Insertion : + « Actions CIP », « Réglages insertion » sous Admin).

### 3.3 PDF (fenêtre d'impression existante)

Gabarits : fiche diagnostic (9 rubriques + radar + mention RGPD pied de page — EXG-29/41), bilan d'entretien (avec évaluation du précédent + validations), **bilan de prolongation Pass IAE** (synthèse parcours pour le prescripteur — EXG-02), bilan de sortie (synthèse évolution + deltas radar + actions restantes + documents remis), synthèse comité de pilotage.

---

## 4. RGPD & habilitations (transverse — EXG-35→44)

1. **Masquage par rôle** : helper `maskInsertionRow(row, baseRole)` appliqué dans les routes de lecture — MANAGER : jamais `frein_judiciaire*`, détails santé, budget, textes du diagnostic social ; AUTORITE : agrégats uniquement (rien de nominatif) ; le chiffrement (§1.5) garantit qu'un `SELECT *` accidentel n'expose que du chiffré.
2. **`services/anonymization.js`** : extension aux nouvelles tables/colonnes (objectifs → titres/descriptions anonymisés, actions → déjà couvert + `resultat`, PMSMP → entreprise/tuteur/bilan, satisfaction → verbatims, milestones → nouveaux JSONB) ; les scores de freins et classifications de sortie restent (agrégats).
3. **`utils/pii-pseudonymize.js`** : vérification que tous les nouveaux textes passés à l'IA transitent par `scrubText` (tests dédiés).
4. **Registre** : seed idempotent d'une entrée `rgpd_registre` « Accompagnement socio-professionnel des salariés en insertion » (finalités, art. 9/10, destinataires, durées).
5. **Purge** : durées § 6.3 du rapport 01 paramétrées (`insertion.retention_months` défaut 24 après dernier contact).
6. **Journal** : exports nominatifs → `rgpd_audit_log` ; consultations des fiches → `autoLogActivity` existant.

---

## 5. Tests

| Type | Contenu |
|---|---|
| Unit (Jest) | `freins-registry` ; `computeMilestoneSchedule` avec renouvellements ; règles de clôture d'entretien ; contrôles PMSMP (bornes 31 j / 60 j) ; mapping migration sorties ; `field-crypto` ; masquage par rôle |
| Schéma | double exécution `init-db.js` (base neuve + base legacy peuplée avec les 5 types historiques et le binaire positive/negative) — aucune perte, contraintes cibles en place |
| Contrat (`backend/tests/contract/`) | chaque endpoint nouveau/modifié : forme de réponse + matrice d'habilitations (ADMIN/RH/MANAGER/AUTORITE/DPO) — dont « MANAGER ne voit jamais frein_judiciaire » |
| Non-régression | suite existante `/insertion/*` verte (650 tests) ; smoke test `api-smoke.js` étendu aux nouvelles routes critiques |
| Recette fonctionnelle | scénario bout-en-bout scripté : liaison candidat → jalons auto → diagnostic → 2 bilans libres (delta freins) → renouvellement → sortie (nomenclature + documents) → post-sortie → exports 23 colonnes |

---

## 6. Séquencement, effort, livraison

| Étape | Contenu | Effort relatif | Dépendances |
|---|---|---|---|
| 0 | `freins-registry` + migrations Lot 1 (contraintes, types, sorties) + tests schéma | ★★ | — |
| 1 | Lot 1 API (close, resync, alertes) + adaptation scheduler | ★★ | 0 |
| 2 | Lot 2 diagnostic (schéma + PUT + DiagnosticForm 9 rubriques + radar 9 axes) | ★★★ | 0 |
| 3 | Lot 3 objectifs/partenaires/actions (+ ActionsCIP.jsx) | ★★ | 1 |
| 4 | Lot 4 conformité (Pass IAE, PMSMP, renouvellement, sortie, post-sortie, satisfaction) | ★★★ | 1 |
| 5 | Lot 5 frise + fiche unifiée (timeline v2, FriseParcours, onglet Employees) | ★★ | 1-4 |
| 6 | Lot 6 tableau de bord + exports (23 colonnes, synthèse, cibles settings) | ★★ | 2-4 |
| 7 | Lot 7 IA (préparation par entretien, persistance, jobs optionnels) | ★ | 1-4 |
| 8 | Transverse final : anonymisation, registre, doc (guide CIP, note certificateurs, CLAUDE.md, DOCUMENTATION_APPLICATIVE) | ★ | tous |

**PR 1** = étapes 0-3 ; **PR 2** = étapes 4-8 ; **PR 3 (phase 2)** = Lot 8 du plan fonctionnel (espace ETI, portefeuille de compétences, période d'essai, checklist embauche) — cadrée après retours terrain. Chaque PR : build Docker, Jest, smoke, migration prouvée, `deploy.sh update` documenté.

---

## 7. Points de vigilance (hérités du rapport 03 §6)

1. Ordre des routes : tout nouveau GET avant `GET /:employeeId` (attrape-tout).
2. Reprendre les 3 `ON CONFLICT` qui dépendent des contraintes migrées (`routes.js:175, 267`, `engine.js:1551`).
3. Préserver l'effet de clôture du parcours au bilan de sortie (`routes.js:341-359`) dans `POST /close`.
4. Supprimer l'auto-init en GET (effet de bord en lecture) après avoir branché les déclencheurs explicites.
5. `GET /cip-referents` : résoudre les rôles custom (`resolveBaseRole`) au passage.
6. Timeline multi-contrats : lire TOUS les `employee_contracts` (fin du `is_current` seul, `engine.js:1304`).
7. Aucun libellé « ODS » ; aucun nom du corpus dans seeds/tests ; aucun objectif conventionnel en dur.
8. Compatibilité mobile non concernée (module web uniquement) ; pas de nouvelle dépendance npm.

# PR A « Conformité immédiate » — Contrats techniques figés

> Orchestrateur, 13/09/2026. **Tout agent de lot lit ce fichier en entier avant d'écrire une ligne.**
> Références : plan 07 (§ 3 lots 0-1-2, § 8 décisions, § 9 amendements autorité), organisation 08 (+ § 10 amendements CIP),
> matrice autorité 09 (§ 2 spécification des exports — **fait foi pour les colonnes**), maquettes `maquettes/captures/`.
> Doctrines du dépôt (CLAUDE.md § 7-8) : requêtes paramétrées, `authenticate + authorize`, migrations idempotentes,
> **jamais de valeur inventée** (NULL reste NULL, jamais 0), journalisation RGPD des lectures/écritures nominatives sensibles
> et des exports, chiffrement des textes libres art. 9/10, tests de contrat avec `pg` simulé (pattern `tests/contract/insertion-contract.test.js`).

## 0. Règles de travail des agents de lot
1. **Fichiers disjoints** : chaque lot ne modifie QUE les fichiers de sa colonne (§ 1). Un besoin hors périmètre → le noter dans son rapport final, ne jamais toucher le fichier d'un autre lot.
2. **Aucune commande git** (l'orchestrateur commit). Aucun `npm install`.
3. Les points d'intégration (§ 2) sont **déjà câblés** par l'orchestrateur : les fichiers squelettes existent, l'agent les REMPLIT.
4. Chaque lot livre : code + tests (Jest `backend/tests/...`) + un rapport `rapports/cip-refonte-2026-09-12/11-realisation-lot<N>.md` (ce qui est fait, preuves, écarts, ce qui reste). `cd backend && npx jest <ses fichiers>` vert ; `cd frontend && npx vite build` vert si le lot touche le front.
5. Français à l'écran, libellés du § 10 de 08 : « Dossier administratif », « Dossiers FSE+ — pièces à compléter », « Fiche pour le référent ».
6. Statuts sociaux (BRSA, catégorie FT) : **ADMIN/RH strict**, jamais renvoyés à MANAGER.

## 1. Propriété des fichiers

| Lot | Agent | Fichiers (exclusifs) |
|---|---|---|
| **0 — Correctifs** | correctifs | `backend/src/routes/exports.js` (retirer l'ancienne route `/fse-plus` remplacée par `exports-fse.js` ; journaliser `/insertion` Excel/CSV → `EXPORT_INSERTION_COMPLET` ; en-tête de traçabilité), `backend/src/routes/employees.js` (liste `allowed` du `PUT /:id`), `backend/src/services/scheduler.js` (`createPostSortieFollowups` → +`insertion.post_sortie_mois` défaut 6 ; enregistrer le job `checkFseSortiesNonRenseignees` exporté par `services/fse-participants.js` dans `runAllJobs` + exports), `backend/src/routes/monitoring.js` (`JOB_SCHEDULE` : `checkFseSortiesNonRenseignees` daily), `backend/src/utils/insertion-settings.js` (nouvelles clés § 4), `frontend/src/utils/rgpd-libelles.js` (TOUS les codes du § 5), `docs/GUIDE_CIP_INSERTION.md`, `docs/GUIDE_UTILISATEUR.md` (§ 4.4 réécrit, numérotation), `docs/NOTE_CERTIFICATEURS_INSERTION.md` (promesses alignées sur la PR A), `backend/tests/contract/exports-journalisation-contract.test.js`, `backend/tests/unit/services/scheduler-post-sortie.test.js` |
| **1 — Dossier administratif** | cadre | `backend/src/scripts/migrations/insertion-cadre.js`, `backend/src/routes/insertion/cadre.js`, `backend/src/routes/insertion/pieces.js`, `backend/src/routes/insertion/eligibilite.js`, `backend/src/utils/pass-iae.js` (pur), `backend/src/services/anonymization.js` (purge des tables des lots 1 ET 2, noms § 3), `backend/src/services/asp-parser.js` + `backend/src/routes/effectifs.js` (conserver `nb_brsa` en base, colonne § 3), `frontend/src/components/insertion/DossierAdministratif.jsx`, `frontend/src/components/insertion/PassIaePanel.jsx`, `frontend/src/components/insertion/PiecesPanel.jsx`, `frontend/src/pages/InsertionParcours.jsx` (onglet + en-tête), `frontend/src/pages/AdminInsertion.jsx`, `backend/tests/contract/insertion-cadre-contract.test.js`, `backend/tests/unit/utils/pass-iae.test.js`, `backend/tests/unit/scripts/insertion-cadre-migration.test.js` |
| **2 — FSE+** | fse | `backend/src/scripts/migrations/insertion-fse.js`, `backend/src/utils/fse-schema.js` (pur), `backend/src/services/fse-participants.js`, `backend/src/routes/insertion/projets.js`, `backend/src/routes/insertion/fse.js`, `backend/src/routes/insertion/conformite.js`, `backend/src/routes/exports-fse.js`, `backend/src/routes/insertion/routes.js` (**uniquement** les 3 retouches § 6.4), `frontend/src/components/insertion/DiagnosticForm.jsx`, `frontend/src/components/insertion/EntretienForm.jsx`, `frontend/src/components/insertion/DossierConformite.jsx`, `frontend/src/components/insertion/FseSortieForm.jsx`, `frontend/src/pages/DossiersFSE.jsx`, `backend/tests/contract/fse-plus-contract.test.js`, `backend/tests/unit/utils/fse-schema.test.js`, `backend/tests/unit/services/fse-participants.test.js` |
| Orchestrateur | — | `backend/src/routes/insertion/index.js`, `backend/src/index.js`, `backend/src/scripts/init-db.js` (2 hooks), `frontend/src/App.jsx`, `frontend/src/components/Layout.jsx`, `CLAUDE.md`, `docs/DOCUMENTATION_APPLICATIVE.md`, intégration, commits |

## 2. Points d'intégration déjà câblés (ne pas modifier)
- `routes/insertion/index.js` monte, **avant** `routes.js` : `./eligibilite` (préfixe `/eligibilite-criteres`), `./cadre` (`/cadre`), `./pieces` (`/pieces`), `./projets` (`/projets`), `./fse` (`/fse`), `./conformite` (`/conformite`). Chaque module exporte un `express.Router()` **sans** `authenticate` (hérité : `authenticate, requireMfa, authorize('ADMIN','RH','MANAGER')`) ; restreindre localement avec `authorize('ADMIN','RH')`.
- `backend/src/index.js` monte `require('./routes/exports-fse')` sur `/api/exports` **avant** `./routes/exports` ; ce routeur porte `authenticate, requireMfa, authorize('ADMIN','RH')` lui-même et ne définit que `/fse-plus` et `/fse-plus/bilan`.
- `init-db.js` appelle, dans la transaction, juste avant le message final : `await require('./migrations/insertion-cadre').run(client)` puis `await require('./migrations/insertion-fse').run(client)`. Signature : `module.exports = { run }`, `run(client)` idempotent, `client.query` uniquement, aucune transaction interne, `console.log('[INIT-DB] … ✓')`.
- `App.jsx` : route `/insertion/conformite` (ADMIN, RH) → `pages/DossiersFSE.jsx` (squelette à remplacer par le lot 2). `Layout.jsx` : entrée « Dossiers FSE+ » (ADMIN, RH) après « Actions CIP ».
- Squelettes créés : `components/insertion/DossierConformite.jsx` (rend `null`) — le lot 1 l'importe, le lot 2 le remplit.

## 3. Schéma (DDL de référence — les migrations la reproduisent à l'identique)

### Lot 1 — `migrations/insertion-cadre.js`
```sql
CREATE TABLE IF NOT EXISTS insertion_eligibilite_criteres (
  code VARCHAR(30) PRIMARY KEY, libelle VARCHAR(120) NOT NULL, ordre SMALLINT NOT NULL DEFAULT 0, actif BOOLEAN NOT NULL DEFAULT true);
-- seed ON CONFLICT DO NOTHING (ordre 1..14) : brsa « Bénéficiaire du RSA », ass « Allocataire ASS », aah « Allocataire AAH »,
-- deld « Demandeur d'emploi de longue durée (12-24 mois) », detld « Demandeur d'emploi de très longue durée (> 24 mois) »,
-- jeune_26 « Jeune de moins de 26 ans », senior_50 « Senior (50 ans et plus) », rqth « Reconnaissance RQTH », qpv « Résident en QPV »,
-- zrr « Résident en ZRR », refugie_bpi « Réfugié / bénéficiaire de la protection internationale », sortant_detention « Sortant de détention »,
-- parent_isole « Parent isolé », sans_domicile « Sans domicile stable »
CREATE TABLE IF NOT EXISTS employee_eligibilite (
  id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  critere_code VARCHAR(30) NOT NULL REFERENCES insertion_eligibilite_criteres(code), date_constat DATE,
  created_by INTEGER REFERENCES users(id), created_at TIMESTAMP DEFAULT NOW(), UNIQUE(employee_id, critere_code));
ALTER TABLE employees ADD COLUMN IF NOT EXISTS brsa BOOLEAN;                       -- NULL = non renseigné
ALTER TABLE employees ADD COLUMN IF NOT EXISTS brsa_date_constat DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ft_categorie VARCHAR(1);            -- CHECK IN ('A','B','C','D','E','F','G') via DO-scan
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ft_categorie_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS orienteur_type VARCHAR(20);         -- departement_cms | france_travail | mission_locale | cap_emploi | ccas | autre
ALTER TABLE employees ADD COLUMN IF NOT EXISTS orienteur_nom VARCHAR(150);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS referent_unique_type VARCHAR(20) NOT NULL DEFAULT 'non_determine'; -- structure | france_travail | cms | autre | non_determine
ALTER TABLE employees ADD COLUMN IF NOT EXISTS referent_unique_nom VARCHAR(150);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS referent_unique_contact VARCHAR(200);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS actualisation_ft_requise BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS actualisation_ft_derniere_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS actualisation_ft_rappels_non_honores SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pass_iae_statut VARCHAR(12) NOT NULL DEFAULT 'inconnu'; -- actif | suspendu | prolonge | expire | inconnu
ALTER TABLE employees ADD COLUMN IF NOT EXISTS eligibilite_verifiee_le DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS eligibilite_source VARCHAR(30);     -- auto_prescription | prescripteur_habilite | inconnu
CREATE TABLE IF NOT EXISTS insertion_pass_iae_evenements (
  id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type VARCHAR(15) NOT NULL CHECK (type IN ('suspension','prolongation','autre')), date_debut DATE NOT NULL, date_fin DATE,
  motif TEXT, reference_externe VARCHAR(60), created_by INTEGER REFERENCES users(id), created_at TIMESTAMP DEFAULT NOW());
CREATE TABLE IF NOT EXISTS insertion_pieces (   -- pièces dont la structure est SEULE dépositaire (jamais un justificatif d'éligibilité)
  id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN ('entretien_signe','convention_pmsmp','accuse_remise','autre')),
  milestone_id INTEGER REFERENCES insertion_milestones(id) ON DELETE SET NULL, pmsmp_id INTEGER REFERENCES insertion_pmsmp(id) ON DELETE SET NULL,
  nom_fichier VARCHAR(200) NOT NULL, mime VARCHAR(80) NOT NULL CHECK (mime IN ('application/pdf','image/jpeg','image/png')),
  taille INTEGER NOT NULL CHECK (taille > 0 AND taille <= 5242880), contenu BYTEA NOT NULL, sha256 CHAR(64) NOT NULL,
  depose_par INTEGER REFERENCES users(id), created_at TIMESTAMP DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_insertion_pieces_employee ON insertion_pieces(employee_id);
ALTER TABLE etp_asp_mensuel ADD COLUMN IF NOT EXISTS nb_brsa INTEGER;
-- cip_action_plans.category : reconstruire le CHECK (DO-scan pg_constraint) pour ajouter 'job_dating' et 'formation'
-- insertion_partenaires : seed « Centre médico-social (CMS) — Département 76 » catégorie 'social' (NOT EXISTS sur le nom)
-- rgpd_registre : entrée « Dossier administratif d'insertion (éligibilité IAE, Pass IAE, référent unique, statuts sociaux, pièces signées) » (pattern init-db ~l.4229, garde NOT ILIKE)
```
Rétention / anonymisation (`services/anonymization.js`) : DELETE `employee_eligibilite`, `insertion_pass_iae_evenements`, `insertion_pieces` ; NULL sur `orienteur_nom`, `referent_unique_nom`, `referent_unique_contact`, `brsa_date_constat`, `ft_categorie_date` ; **`insertion_fse_sorties` et `insertion_projet_participants` CONSERVÉS** (piste d'audit FSE+ ≥ 5 ans, même doctrine que `fse_entree`/`fse_sortie`).

### Lot 2 — `migrations/insertion-fse.js`
```sql
CREATE TABLE IF NOT EXISTS insertion_projets (
  id SERIAL PRIMARY KEY, code VARCHAR(30) UNIQUE NOT NULL, nom VARCHAR(150) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('asi','ocs','autre')), financeur VARCHAR(120), date_debut DATE, date_fin DATE,
  convention_ref VARCHAR(80), taux_forfaitaire_pct NUMERIC(5,2), cofinancement_ue_pct NUMERIC(5,2), actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW());
-- seed ON CONFLICT (code) DO NOTHING : ('ASI-2026-2027','Accompagnement Social Intensif 2026-2027','asi','FSE+ / Département 76','2026-01-01','2027-12-31',NULL,NULL,60)
--                                       ('OCS-CIP-2026-2027','Postes CIP en OCS 2026-2027','ocs','FSE+ / DDETS 76','2026-01-01','2027-12-31',NULL,40,60)
CREATE TABLE IF NOT EXISTS insertion_projet_participants (
  id SERIAL PRIMARY KEY, projet_id INTEGER NOT NULL REFERENCES insertion_projets(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE, date_entree DATE NOT NULL, date_sortie DATE,
  created_by INTEGER REFERENCES users(id), created_at TIMESTAMP DEFAULT NOW(), UNIQUE(projet_id, employee_id, date_entree));
CREATE TABLE IF NOT EXISTS insertion_projet_postes (
  id SERIAL PRIMARY KEY, projet_id INTEGER NOT NULL REFERENCES insertion_projets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, quotite_pct NUMERIC(5,2) NOT NULL CHECK (quotite_pct > 0 AND quotite_pct <= 100),
  date_debut DATE, date_fin DATE, UNIQUE(projet_id, user_id));
CREATE TABLE IF NOT EXISTS insertion_fse_sorties (
  id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE, parcours_num SMALLINT NOT NULL DEFAULT 1,
  projet_id INTEGER REFERENCES insertion_projets(id) ON DELETE SET NULL, milestone_id INTEGER REFERENCES insertion_milestones(id) ON DELETE SET NULL,
  source VARCHAR(12) NOT NULL CHECK (source IN ('bilan','sans_bilan')), date_sortie DATE NOT NULL,
  situation_sortie VARCHAR(30) NOT NULL CHECK (situation_sortie IN ('emploi_durable','emploi_transition','formation','autre_sortie_positive','inactivite','chomage','inconnue')),
  fse_sortie JSONB, saisie_at TIMESTAMP NOT NULL DEFAULT NOW(), saisie_par INTEGER REFERENCES users(id),
  situation_6mois VARCHAR(30) CHECK (situation_6mois IN ('emploi_durable','emploi_transition','formation','autre_sortie_positive','inactivite','chomage','inconnue')),
  date_releve_6mois DATE, releve_6mois_par INTEGER REFERENCES users(id), UNIQUE(employee_id, parcours_num));
ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS duree_minutes SMALLINT CHECK (duree_minutes IS NULL OR (duree_minutes >= 0 AND duree_minutes <= 600));
ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS presence VARCHAR(10);      -- present | absent | excuse (CHECK via DO-scan)
ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS absence_motif VARCHAR(20); -- sante | administratif | garde | transport | autre (facultatif, jamais imprimé « injustifiée »)
ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS absence_piece_ref VARCHAR(200);
ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS fse_entree_saisie_at TIMESTAMP;
ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS fse_entree_complet BOOLEAN NOT NULL DEFAULT false;
-- insertion_interview_alerts.alert_type : reconstruire le CHECK pour ajouter 'fse_sortie_j15', 'fse_sortie_j25', 'fse_entree_manquante', 'suivi_6mois'
-- rgpd_registre : entrée « Cofinancement FSE+ — suivi des participants (questionnaires entrée / sortie / +6 mois, cohortes de projet) » (garde NOT ILIKE)
```

## 4. Réglages (`utils/insertion-settings.js`, lot 0 — lus par tous)
`insertion.post_sortie_mois` = 6 · `insertion.alerte_sortie_fse_j1` = 15 · `insertion.alerte_sortie_fse_j2` = 25 · `insertion.duree_entretien_defaut` = `{"diagnostic_accueil":90,"bilan_intermediaire":45,"periode_essai":30,"renouvellement":30,"bilan_sortie":60,"suivi_post_sortie":15}` (JSON).

## 5. Codes du journal RGPD (`frontend/src/utils/rgpd-libelles.js`, lot 0 — la garde anti-dérive exige un libellé pour chaque code employé)
`EXPORT_FSE_PLUS` « Export FSE+ participants » · `EXPORT_INSERTION_COMPLET` « Export complet du module Insertion (Excel/CSV) » · `INSERTION_CADRE_CONSULTATION` « Consultation du dossier administratif d'insertion » · `INSERTION_CADRE_MODIFICATION` « Modification du dossier administratif d'insertion » · `INSERTION_PIECE_DEPOT` « Dépôt d'une pièce signée (insertion) » · `INSERTION_PIECE_CONSULTATION` « Consultation d'une pièce signée (insertion) » · `INSERTION_PIECE_SUPPRESSION` « Suppression d'une pièce signée (insertion) » · `INSERTION_FSE_SORTIE_SAISIE` « Saisie de la sortie FSE+ d'un participant » · `INSERTION_FSE_SIX_MOIS_SAISIE` « Relevé de situation à 6 mois (FSE+) » · `INSERTION_PROJET_PARTICIPANT` « Rattachement / retrait d'un participant à un projet cofinancé ».

## 6. API

### 6.1 Lot 1
| Route | Rôles | Contrat |
|---|---|---|
| `GET /api/insertion/eligibilite-criteres` | A/RH/M | `[{code, libelle, ordre, actif}]` triés par `ordre` |
| `POST /api/insertion/eligibilite-criteres` · `PUT /:code` | ADMIN | `{code?, libelle, ordre, actif}` ; 409 doublon |
| `GET /api/insertion/cadre/:employeeId` | A/RH (M : sans `statuts`, sans `pieces`, sans `bloc_emplois_inclusion`) | `{ employee_id, eligibilite:{criteres:[{code,libelle,date_constat}], verifiee_le, source, justificatifs_ref}, pass_iae:{numero, debut, fin, statut, evenements:[{id,type,date_debut,date_fin,motif,reference_externe}]}, orientation:{orienteur_type, orienteur_nom, prescripteur:{id,nom,type}|null, date_prescription, referent_unique:{type,nom,contact}, actualisation_ft:{requise, derniere_date, rappels_non_honores}}, statuts:{brsa, brsa_date_constat, ft_categorie, ft_categorie_date, france_travail_id, rqth}, derogation_cddi:{motif,date}, projets:[{id,code,nom,type,date_entree,date_sortie}] (lu dans insertion_projet_participants si la table existe, sinon []), bloc_emplois_inclusion:"texte multi-lignes" }` ; consultation ADMIN/RH journalisée `INSERTION_CADRE_CONSULTATION` (une par appel) |
| `PUT /api/insertion/cadre/:employeeId` | A/RH | Corps partiel de la même forme (`eligibilite.criteres` = liste complète de codes → remplacement ; `pass_iae`, `orientation`, `statuts`, `derogation_cddi`) ; 400 valeur hors liste ; `pass_iae.statut` **recalculé serveur** par `utils/pass-iae.js › calculerStatutPassIae({numero, debut, fin, evenements, today})` ; journal `INSERTION_CADRE_MODIFICATION` (champs modifiés, jamais les valeurs) ; renvoie le GET |
| `POST /api/insertion/cadre/:employeeId/pass-iae/evenements` · `DELETE …/:id` | A/RH | `{type, date_debut, date_fin, motif, reference_externe}` ; recalcul du statut |
| `POST /api/insertion/cadre/:employeeId/actualisation-ft` | A/RH | `{date}` → `actualisation_ft_derniere_date`, remise à 0 des rappels |
| `GET /api/insertion/pieces/:employeeId` | A/RH | `[{id,type,nom_fichier,mime,taille,milestone_id,pmsmp_id,depose_par_nom,created_at}]` — jamais le contenu |
| `POST /api/insertion/pieces/:employeeId` | A/RH | multipart `fichier` (multer mémoire, ≤ 5 Mo, `imageFilter`+pdf → PDF/JPEG/PNG vérifiés par magic bytes) + `type`, `milestone_id?`, `pmsmp_id?` ; BYTEA ; journal `INSERTION_PIECE_DEPOT` |
| `GET /api/insertion/pieces/fichier/:id` | A/RH | contenu, `Content-Type` du mime stocké, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Content-Disposition: inline; filename=…` ; journal `INSERTION_PIECE_CONSULTATION` |
| `DELETE /api/insertion/pieces/:id` | A/RH | journal `INSERTION_PIECE_SUPPRESSION` |
`calculerStatutPassIae` : pas de numéro → `inconnu` ; `fin < today` → `expire` ; suspension couvrant `today` → `suspendu` ; prolongation existante et `fin ≥ today` → `prolonge` ; sinon `actif`. Le bloc « Emplois de l'inclusion » : `Critères : <libellés> · Prescripteur : <nom> (<type>) · Pass IAE : <numero> · début <jj/mm/aaaa> · fin <jj/mm/aaaa> · Statut : <statut>` — champs absents écrits « non renseigné ».

### 6.2 Lot 2
| Route | Rôles | Contrat |
|---|---|---|
| `GET /api/insertion/projets` | A/RH/M | `[{id,code,nom,type,financeur,date_debut,date_fin,convention_ref,taux_forfaitaire_pct,cofinancement_ue_pct,actif,nb_participants}]` |
| `POST /api/insertion/projets` · `PUT /:id` | ADMIN/RH | mêmes champs ; 409 code dupliqué |
| `GET /api/insertion/projets/:id/participants` · `POST` `{employee_id, date_entree}` · `PUT /:pid` `{date_sortie}` · `DELETE /:pid` | A/RH (GET aussi M) | journal `INSERTION_PROJET_PARTICIPANT` ; 409 doublon |
| `GET /api/insertion/projets/:id/postes` · `PUT` `[{user_id, quotite_pct, date_debut, date_fin}]` | ADMIN/RH | remplacement complet |
| `GET /api/insertion/fse/:employeeId` | A/RH | `{ projets:[…], entree:{items:{…}, completude:{total, renseignes, manquants:[cle]}, complet, saisie_at, suggestions:{cle:{valeur, source}}}, sortie:{date_sortie, situation_sortie, fse_sortie, saisie_at, source, delai_saisie_jours}|null, six_mois:{situation_6mois, date_releve_6mois, echeance}|null, contract_end }` |
| `POST /api/insertion/fse/:employeeId/sortie` | A/RH | `{date_sortie, situation_sortie, fse_sortie:{…}, projet_id?}` → upsert `insertion_fse_sorties` (`source='sans_bilan'` si aucun `bilan_sortie` réalisé) ; 400 hors schéma ; journal `INSERTION_FSE_SORTIE_SAISIE` |
| `POST /api/insertion/fse/:employeeId/six-mois` | A/RH | `{situation_6mois, date_releve_6mois}` ; journal `INSERTION_FSE_SIX_MOIS_SAISIE` |
| `GET /api/insertion/conformite/:employeeId` | A/RH | `{ pieces:[{cle, libelle, etat:'complet'|'partiel'|'a_faire'|'sans_objet', detail, echeance?, lien}], nb_a_faire, complet }` — les 9 pièces de la maquette dans cet ordre : `eligibilite`, `pass_iae`, `referent_unique`, `fse_entree`, `diagnostic_socle`, `fse_sortie`, `sortie_delai` (saisie dans les 30 j après `contract_end`), `six_mois`, `remise_documents` |
| `GET /api/insertion/conformite?projet=<id>&periode=<AAAA-Tn>` | A/RH | `{ projet, participants:[{employee_id, nom, prenom, statut_parcours, contract_end, pieces:{cle:etat}, a_faire:[texte]}], taux_completude, nb_complets, nb_total }` |
| `GET /api/exports/fse-plus?projet=<id>&annee=&trimestre=` | ADMIN/RH | CSV `;` BOM, **colonnes = § 2 (a) de 09 (29 colonnes, une par item, en français, jamais de JSON)**, 5 lignes d'en-tête `#` (généré le, par, périmètre, nb lignes, projet) ; **0 ligne → 409 `{error, code:'EXPORT_VIDE'}`** ; journal `EXPORT_FSE_PLUS` AVANT envoi (échec = échec) ; nom `fse-participants_<code>_<AAAA>_T<n>.csv` |
| `GET /api/exports/fse-plus/bilan?projet=&annee=` | ADMIN/RH | JSON agrégé (b) de 09 : entrées, sorties par situation, +6 mois, complétude, délais de saisie |

`utils/fse-schema.js` (pur) : `FSE_ENTREE_ITEMS` = `statut_avant_entree` (demandeur_emploi | inactif | emploi | formation), `duree_sans_emploi` (lt_6m | 6_12m | 12_24m | gt_24m), `foyer_monoparental` (bool), `sans_domicile_stable` (bool), `ressources_principales` (rsa | are | aah | ass | aucune | autre), `commentaire` (texte, facultatif) ; `FSE_SORTIE_ITEMS` = `situation_sortie` (enum § 3), `type_contrat` (cdi | cdd_6m_plus | cdd_moins_6m | interim | creation | formation_qualifiante | autre | sans_objet), `commentaire` ; `valider(obj, items)` → `{ok, erreurs[]}` (clé inconnue ou valeur hors liste = erreur) ; `completude(obj, items)` ; `suggestionsEntree(diagnosticRow, employeeRow)` → pour chaque item déductible `{valeur, source:'libellé lisible'}` : `sans_domicile_stable` ← `logement_statut` (sans_abri / heberge → true ; locataire / proprietaire → false) ; `foyer_monoparental` ← `situation_familiale` seul(e)/séparé(e) ∧ `enfants_a_charge` ; `ressources_principales` ← `employees.brsa` ou `ressources[]` ; `statut_avant_entree` ← `employees.france_travail_id` ou `fse.duree_sans_emploi` ; jamais une suggestion sans source. Les questions **exactes** de MDFSE+ restent « à confirmer sur la plateforme » : le schéma est extensible (ajouter un item = ajouter une entrée de liste).

### 6.3 Lot 0
- `PUT /api/employees/:id` accepte désormais `pass_iae_number`, `pass_iae_start`, `pass_iae_end`, `eligibilite_criteres`, `eligibilite_justificatifs_ref`, `france_travail_id`, `cddi_derogation_motif`, `cddi_derogation_date` (dateFields + validation du motif dans la liste de 4).
- `GET /api/exports/insertion` : journal `EXPORT_INSERTION_COMPLET` (format, dataset, lignes) **avant** envoi ; feuille/lignes « Informations » : date, générateur, périmètre, nb lignes ; 0 salarié → 409 `EXPORT_VIDE`.
- `createPostSortieFollowups` : échéance = sortie + `insertion.post_sortie_mois` (défaut 6) ; titre « Suivi post-sortie (+6 mois) » ; fenêtre de création : sortie réalisée depuis ≥ (mois−1) et ≤ mois+4 ; idempotent.
- Job `checkFseSortiesNonRenseignees` (fonction fournie par le lot 2 dans `services/fse-participants.js`, signature `async () => ({ crees, verifies })`) : enregistré dans `runAllJobs` via `runInstrumented`, exporté, ajouté à `JOB_SCHEDULE` (daily).

### 6.4 Retouches de `routes/insertion/routes.js` (lot 2, et RIEN d'autre)
1. `PUT /diagnostic/:employeeId` : si `fse_entree` présent → `valider()` (400 `{error, erreurs}`) ; écrire `fse_entree_complet`, `fse_entree_saisie_at` (NOW() la première fois que `complet` passe à true) ; la réponse et `GET /diagnostic` portent `suggestions_fse` (via `suggestionsEntree`) et `fse_completude`.
2. `PUT /milestones/:id` et `POST /milestones/:id/close` : champs `duree_minutes`, `presence`, `absence_motif`, `absence_piece_ref` acceptés (listes du § 3) ; à la clôture d'un `bilan_sortie` classé, appeler `fseParticipants.enregistrerSortie({employeeId, milestone, userId, client})` (source `bilan`) — la sortie FSE+ vit dans `insertion_fse_sorties`, `fse_sortie` du milestone reste écrit pour compatibilité.
3. `GET /alertes/:employeeId` : + `fse_entree_manquante` (participant d'un projet `asi` sans `fse_entree_complet`, niveau critique après `delai_diagnostic_jours`), `fse_sortie_a_saisir` (contrat terminé, aucune ligne `insertion_fse_sorties`, critique dès J+`alerte_sortie_fse_j1`), `referent_non_determine` (`brsa = true` et `referent_unique_type = 'non_determine'`, critique), `suivi_6mois_echu`.

## 7. Frontend
- **Lot 1** — `InsertionParcours.jsx` : onglet **« Dossier administratif »** inséré après « Diagnostic » (les 7 onglets existants restent ; la fusion en 4 est PR C) rendant `<DossierAdministratif employeeId employee baseRole onChanged/>` ; en-tête : le badge Pass IAE lit `cadre.pass_iae.statut` (teal actif/prolongé, ambre suspendu, rouge expiré, gris inconnu), + badges `BRSA` (ADMIN/RH), `Projet <code>` par rattachement, `Référent unique : <libellé>` (rouge si non déterminé) — données de `GET /insertion/cadre/:id`. `DossierAdministratif.jsx` : sections de la maquette 4a/4b (Éligibilité IAE chips + date + source + référence + bloc à copier · Pass IAE = `PassIaePanel` · Orientation et référent unique · Statuts (ADMIN/RH) · Projets cofinancés (lecture, lien vers Réglages) · Dérogation CDDI · colonne droite `<DossierConformite employeeId/>` · `PiecesPanel` dépôt/consultation). Un seul bouton Enregistrer par section, `useToast`, `Modal`/`ConfirmDialog` partagés, jamais `alert()`. `AdminInsertion.jsx` : un seul « Enregistrer » pour les paramètres (+ 3 nouvelles clés), section « Critères d'éligibilité IAE », section « Projets cofinancés » (CRUD sur l'API du lot 2, + postes/quotités), sonde IA (`GET /insertion/ia/diagnostic`) déplacée ici.
- **Lot 2** — `DiagnosticForm.jsx` : rubrique FSE+ conservée en avant-dernière position (13/14 aujourd'hui ; la réorganisation en socle est PR C) mais **pré-remplie** : boutons de réponse (chips, comme la maquette 5) ; sous chaque item une ligne « proposé depuis « <source> » » avec **Confirmer / Corriger** quand `suggestions_fse[cle]` existe et que la valeur est vide ; encart complétude « n/5 » et avertissement « fausse déclaration » ; le rail marque la rubrique en rouge si participant ASI et incomplète. `EntretienForm.jsx` : fenêtre de clôture = maquette 7 (chips durée 15/30/45/60/90/autre avec défaut par type lu dans `insertion.duree_entretien_defaut`, chips présence, motif facultatif si absent/excusé, référence de pièce) ; étape « Sortie & documents » : bloc **« Sortie FSE+ »** (situation, type de contrat, commentaire) envoyé dans `fse_sortie`. `DossierConformite.jsx` : colonne des 9 pièces (états, liens vers le champ). `FseSortieForm.jsx` : modale de saisie sans bilan (`POST /fse/:id/sortie`) + relevé +6 mois. `DossiersFSE.jsx` : maquette « Dossiers FSE+ » (sélecteur projet/période, 4 KPI, tableau participants × 9 pièces, boutons Export CSV / Bilan (JSON téléchargé), bloc OCS = postes et quotités).

## 8. Tests exigés
- Lot 0 : journalisation `/exports/insertion` avant envoi, 409 vide ; post-sortie +6 (paramètre lu, idempotent) ; `employees` PUT accepte/refuse.
- Lot 1 : matrice de rôles (MANAGER sans statuts ni pièces ; 403 sur écriture), recalcul du statut Pass (6 cas), pièces (mime forgé refusé, journalisation, no-store), copier-coller, migration idempotente rejouable (test textuel : chaque `CREATE`/`ALTER` porte `IF NOT EXISTS`).
- Lot 2 : schéma FSE+ (valider/complétude/suggestions), sortie sans bilan puis bilan (unicité), conformité 9 pièces (états), export 29 colonnes + 409 vide + journal, alertes J+15/J+25, rôles.
- Garde anti-dérive des libellés RGPD : verte (lot 0 fournit les libellés du § 5 **dès le début**).

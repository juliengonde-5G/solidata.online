# Reconnaissance — backend du module Insertion (état au 12/09/2026)

> Agent de reconnaissance (lecture seule). Chemins relatifs à la racine du dépôt.
> Résumé exécutif en tête ; cartographie détaillée ensuite.

## Résumé exécutif
- **72 endpoints** `/api/insertion/*` dans un seul fichier `routes/insertion/routes.js` (4 166 lignes), + exports (`/api/exports/fse-plus`, `/insertion`, `/insertion-freins`, `/insertion-synthese`), effectifs ETP/ASP, prescripteurs, liaison candidat→collaborateur.
- **Ce qui existe** : diagnostic 12 rubriques + 9 freins (NULL = non évalué), 6 types d'entretiens calés sur le contrat réel, clôture contrôlée + verrou probant + historique, objectifs/actions/partenaires (16 seedés dont France Travail), PMSMP (31 j / 60 j), renouvellements CDDI (triple validation), Pass IAE (n°/dates + alertes 7 mois / 2 mois), satisfaction de sortie, suivi post-sortie à +3 mois (job), FSE+ `fse_entree`/`fse_sortie` (JSONB libres), cibles conventionnelles, audit KPI, notes de suivi chiffrées, note de profil IA, compétences ETI, checklist d'embauche, prescripteurs structurés (8 types dont FT, ML, CD, CCAS, CAP_EMPLOI), `france_travail_id`.
- **Ce qui N'existe PAS** (0 occurrence) : DORA, connecteur Emplois de l'inclusion, **CER / PPAE**, **BRSA comme attribut de personne**, DELD, QPV/ZRR, DDETS, **critères d'éligibilité IAE typés** (texte libre seulement), orienteur distinct du prescripteur, référent unique (seul le CIP référent interne existe), **catégorie France Travail (F/G)**, suspension de Pass IAE, heures d'activité hebdo contrôlées, feuilles de temps CIP par projet FSE+, suivi post-sortie à **+6 mois** (le job crée le jalon à +3 mois).
- **Dettes principales** : monolithe de routes à ordre de routage sensible ; 3 bases d'ETP (35 h / 1 607 h / 1 820 h) ; `fse_entree`/`fse_sortie` sans schéma ni contrôle de complétude alors que c'est la donnée à piste d'audit ≥ 5 ans ; exports résilients qui peuvent livrer un CSV vide sans erreur visible ; accès MANAGER aux compétences non cloisonné par équipe ; `is_sent` des alertes jamais positionné.

## 1. Fichiers de routes et point de montage

| Fichier | Lignes | Rôle |
|---|---|---|
| `backend/src/index.js:209` | — | `app.use('/api/insertion', require('./routes/insertion'))` ; `:179` `/api/effectifs` ; `:197` `/api/exports` |
| `backend/src/routes/insertion/index.js` | 33 | `router.use(authenticate, requireMfa, authorize('ADMIN','RH','MANAGER'))` (`:27`). L'ancienne IIFE d'auto-migration a été retirée — `init-db.js` est source unique du schéma. |
| `backend/src/routes/insertion/routes.js` | 4166 | 72 endpoints (monolithe) |
| `backend/src/routes/insertion/engine.js` | 1833 | Base PCM/métiers, 9 freins, 5 questionnaires CIP, `analyzeInsertion`, `computeMilestoneSchedule`, `computeCddiCumulativeMonths`, `resyncMilestones`, `generateMilestones`, Kolb, moyennes de compétences |
| `backend/src/routes/insertion/freins-registry.js` | 76 | Registre unique des 9 axes (`FREINS`, `FREIN_KEYS`, `freinColumns()`, `EXPORT_FREINS`, `RADAR_AXES`) |
| `backend/src/routes/insertion/masking.js` | 57 | Masquage RGPD par rôle (MANAGER) |
| `backend/src/routes/insertion/pmsmp-rules.js` | 127 | Module pur : bornes légales PMSMP (31 j / 60 j sur 12 mois glissants) |
| `backend/src/utils/insertion-settings.js` | 80 | `readInsertionSetting` + défauts `insertion.*` |
| `backend/src/utils/insertion-freins-export.js` | 147 | Colonnes 23/24 du tableau CDC, `rowToCells`, `computeCompletude` |
| `backend/src/services/insertion-ai.js` | 936 | 6 fonctions IA Anthropic |
| `backend/src/services/scheduler.js` | 2133 | 6 jobs insertion |
| `backend/src/routes/exports.js` | ~980 | `/fse-plus:351`, `/insertion:489`, `/insertion-freins:778`, `/insertion-freins/completude:848`, `/insertion-synthese:878` ; routeur `authenticate, requireMfa, authorize('ADMIN','MANAGER','RH')` (`:16`) |
| `backend/src/routes/effectifs.js` | ~1450 | ETP conventionnés + import/comparaison ASP |
| `backend/src/routes/prescripteurs.js` | ~150 | Référentiel `prescripteur_orgas` + `/assign` |
| `backend/src/routes/candidates/conversion.js:141` | — | `link-employee` : initialise le parcours d'insertion |
| `backend/src/routes/employees.js` | — | `:288 /:id/cddi-duration`, `:1235 /kpi/etp`, colonnes insertion éditables `:223`, resync jalons `:269`/`:935` |
| `backend/src/services/anonymization.js`, `services/rgpd-purges.js:404` | — | Purge RGPD (`purgeInsertionDossiers`) |

## 2. Les 72 endpoints `/api/insertion/*`
Rôles par défaut = A/RH/M (ADMIN, RH, MANAGER) + MFA. Un `authorize(...)` local restreint.

### 2.1 Référentiels
| # | Route | Rôles | Effet | Ligne |
|---|---|---|---|---|
| 1 | `GET /` | A/RH/M | Salariés actifs + urgence fin de contrat (≤30 j critique, ≤60 j attention), `has_pcm`/`has_diagnostic` | `routes.js:101` |
| 2 | `GET /freins-definitions` | A/RH/M | 9 axes : questions indirectes, niveaux 1-5, actions de levée | `:164` |
| 3 | `GET /interview-template/:milestoneType` | A/RH/M | Questionnaire CIP du type (5 trames) | `:987` |
| 4 | `GET /parametres` | A/RH/M | 6 réglages `insertion.*` avec défauts | `:2905` |
| 5 | `GET /cip-referents` | A/RH/M | Utilisateurs RH/ADMIN actifs (rôles custom résolus) | `:2936` |

### 2.2 Diagnostic
| 6 | `GET /diagnostic/:employeeId?parcours=N` | A/RH/M | ADMIN/RH déchiffré, MANAGER champs sensibles retirés | `:171` |
| 7 | `PUT /diagnostic/:employeeId` | A/RH/M | Upsert `ON CONFLICT (employee_id, parcours_num)`, chiffre art. 9/10, renvoie `suggestions_freins` | `:306`/`:370` |

### 2.3 Entretiens (jalons)
| 8 | `GET /milestones/:employeeId` | A/RH/M | Tous les entretiens, masquage MANAGER | `:403` |
| 9 | `POST /milestones` | A/RH (M : renouvellement uniquement) | Crée ; `bilan_intermediaire` titré « Bilan n° N » ; accueil/sortie = upsert d'échéance | `:468` |
| 10 | `PUT /milestones/:id` | A/RH (403 MANAGER) | MAJ ; **409 si `locked_at`** ; snapshot `update` ; `mergeValidations` | `:609`/`:636` |
| 11 | `POST /milestones/:id/close` | A/RH/M | Clôture contrôlée : 6 familles de contrôles → 409 `{problems[]}` ; sinon `realise`+`locked_at`, snapshot, effets parcours, resync | `:693` |
| 12 | `POST /milestones/:id/reopen` | ADMIN/RH | Réouverture motivée, snapshot `reopen`, validations invalidées | `:872` |
| 13 | `GET /milestones/:employeeId/radar` | A/RH/M | Radar 9 axes (8 pour MANAGER) | `:913` |
| 14 | `GET /milestones-overview` | A/RH/M | Jalons des salariés `en_parcours` | `:967` |
| 15 | `POST /milestones/:employeeId/initialize` | A/RH/M | Démarre le parcours + génère les jalons | `:994` |
| 16 | `POST /:employeeId/resync-milestones` | ADMIN/RH | Recalage manuel | `:1441` |
| 17 | `GET /timeline/:employeeId` | A/RH/M | Timeline | `:1408` |

### 2.4 Plans d'action CIP
| 18-21 | `GET /action-plans/:employeeId`, `POST /action-plans`, `PUT /action-plans/:id`, `DELETE` (ADMIN/RH) | | catégorie, priorité, échéance, frein, partenaire, objectif, `duree_minutes`, `resultat` | `:1034`-`:1139` |
| 22 | `GET /actions-overview` | A/RH/M | Tableau transversal paginé (filtres employee/category/priority/partenaire/retard/mine/gestionnaire/statut) ; filtre judiciaire en SQL pour MANAGER | `:1677` |

### 2.5 Notes de suivi (2.47.0) — chiffrées, ADMIN/RH strict
| 23-27 | `GET /notes-suivi/:employeeId`, `GET /notes-suivi/:id/historique`, `POST`, `PUT /:id`, `DELETE /:id` | ADMIN/RH | Journal daté déchiffré, consultation journalisée sans le contenu, snapshot avant UPDATE/DELETE | `:1239`-`:1383` |

### 2.6 Objectifs — `GET /objectifs/:employeeId`, `POST` (ADMIN/RH, 1 seul niveau de sous-objectif), `PUT`, `DELETE` (`:1460`-`:1574`)
### 2.7 Partenaires — `GET /partenaires`, `POST`/`PUT` (ADMIN/RH) (`:1595`-`:1637`)
### 2.8 Alertes — `GET /alertes/:employeeId` (7 sources + acquittements, `:1750`), `POST /alertes/:employeeId/ack` (`:1913`)
### 2.9 PMSMP — `GET /pmsmp/:employeeId` (+ `cumul_12mois_jours`), `POST`/`PUT`/`DELETE` (ADMIN/RH, transaction + `FOR UPDATE`, contrôles 31 j / 60 j, forçage tracé) (`:2001`-`:2162`)
### 2.10 Satisfaction — `POST /satisfaction/:employeeId` (upsert), `GET`, `GET /satisfaction-stats?year=` (anonyme) (`:2184`-`:2292`)
### 2.11 Renouvellements — `GET /renouvellements` (CDDI finissant dans 42 j + état de l'entretien, `:2318`), `PUT /renouvellements/:milestoneId/formulaire` (seule voie d'écriture MANAGER/ETI : `renouvellement_form/avis/duree_mois` + validation `eti`, `:2381`)
### 2.12 Pass IAE — `GET /pass-iae/bilan/:employeeId` (ADMIN/RH ; JSON expurgé art. 9/10 ; mention « la demande officielle se fait sur les emplois de l'inclusion », `:2465`, `:2579`)
### 2.13 Cibles — `GET/PUT /cibles` (6 cibles nullables, `:2647`/`:2662`), `GET/PUT /objectif-sorties` (legacy, `:2876`/`:2881`)
### 2.14 Tableaux de bord — `GET /cohorte/stats?year=&mine=` (`:2711`), `GET /audit?year=` (`gatherAuditKpis`, `:3237`), `GET /audit/ia` (ADMIN/RH, `:3249`)
### 2.15 CIP référent — `PUT /:employeeId/cip-referent` (ADMIN/RH, `:3263`)
### 2.16 Compétences — `GET /competence-referentiels`, `POST/PUT/DELETE` (ADMIN), `GET /competences/:employeeId`, `POST`/`PUT` (A/RH/M), `DELETE` (ADMIN/RH) (`:3314`-`:3564`)
### 2.17 Checklist d'embauche — `GET/PUT /checklist-embauche/:employeeId` (PUT ADMIN/RH, upsert fusionnant) (`:3598`/`:3620`)
### 2.18 Note de profil — `GET /notes-profil/:employeeId` (journalisé), `POST /ia/note-profil/:employeeId`, `POST /notes-profil/:employeeId/communiquer` (ADMIN/RH) (`:3724`-`:3767`)
### 2.19 Fiche agrégée — `GET /:employeeId` (DERNIÈRE route GET, `:3800`) : employé + prescripteur/orienteur + CIP référent + Pass IAE, contrats, jalons, actions, objectifs, PMSMP, satisfaction, timeline, `analyzeInsertion` ; masquage structurel MANAGER (`:3960-4020`)
### 2.20 IA — `GET /ia/diagnostic` (sonde), `GET /ia/profil/:employeeId`, `GET /ia/entretien/:employeeId`, `GET /ia/cohorte` (ADMIN/RH, `:4066`-`:4152`) ; `handleIaError` (`:4045`)

### 2.21 Hors `/api/insertion`
| Route | Rôles | Effet |
|---|---|---|
| `GET /api/exports/fse-plus?annee=&trimestre=` | ADMIN/RH | CSV FSE+ trimestriel 24 colonnes (heures travaillées, prescripteur, sortie, `fse_entree`/`fse_sortie` sérialisés) — `exports.js:351` |
| `GET /api/exports/insertion` | ADMIN/RH | Excel 4 feuilles + Informations — `:489` |
| `GET /api/exports/insertion-freins?format=&sensibles=&annee=&statut=&cip=` | ADMIN/RH | 23/24 colonnes CDC, journal RGPD AVANT envoi — `:778` |
| `GET /api/exports/insertion-freins/completude` | ADMIN/RH | % renseigné par colonne — `:848` |
| `GET /api/exports/insertion-synthese?year=&format=` | A/RH/M | Synthèse COPIL non nominative — `:878` |
| `GET /api/employees/:id/cddi-duration` ; `GET /api/employees/kpi/etp` (base 1607 h) | | `employees.js:288`, `:1235` |
| `POST /api/candidates/:id/link-employee` | ADMIN/RH | Recopie prescripteur/Pass IAE/éligibilité, initialise parcours + jalons + période d'essai, squelette diagnostic, checklist, note de profil — `conversion.js:141-304` |
| `/api/effectifs/*` | lecture A/RH/M, écriture A/RH | `parametres`, `grille`, `ecarts`, `synthese`, `asp/import`, `asp/comparaison[/:mois]`, `asp/liaisons`, `asp/liaison`, `asp/export` |
| `/api/prescripteurs/*` | lecture module, écriture ADMIN/RH | CRUD + `/types` + `POST /:id/assign` |

## 3. Modèle de données (tout dans `backend/src/scripts/init-db.js`)

| Table | CREATE | Colonnes principales |
|---|---|---|
| `insertion_diagnostics` | `:3491` | `employee_id`, `parcours_num`, blocs historiques (contraintes, `pcm_q_*`, `obs_*`, `pref_*`, `explorama_*`), **9 freins** `frein_<axe>` (1-5, NULL = non évalué) + `_detail` + `_causes`, rubriques 2026-07 : `logement_statut`, `piece_identite_validite`, `allocataire_caf`, `ressources TEXT[]` (RSA/APL/AF/CF/ASF/AAH/ARE/prime_activite/aucune), `mutuelle_statut`, `rqth`/`rqth_fin`, `contre_indications`, `suivi_sante`, `commentaire_sante`, `difficultes_financieres`, `credits_en_cours`, `permis_b_statut`, `vehicule`, `moyen_transport TEXT[]`, `autre_employeur`+`_heures`, `souhait_complement_heures`, `niveau_formation`, `metiers_souhaites`, `pret_a_se_former`, `cpf_accessible`, `projet_formation`, `emploi_vise`+`_rome`, `attentes_parcours`, `difficultes_exprimees`, `objectifs_exprimes`, `aide_souhaitee`, `cecrl_niveau`, `situation_familiale`, `nb_enfants`, `enfants_a_charge`, `questionnaire_detail JSONB`, **`fse_entree JSONB`**, `statut_saisie` ; Lot 8 : `swot_*`, `besoins_exprimes`, `coa_texte`, `portefeuille_*`, `savoir_faire/etre`, `style_apprentissage` + `_reponses`. UNIQUE(employee_id, parcours_num) |
| `insertion_milestones` | `:3624` | `milestone_type` (CHECK 6 valeurs `:4437`), `titre`, `due_date`, `completed_date`, `status` (a_planifier/planifie/realise/reporte), `interview_date`, `interviewer_id`, 9 freins, `cip_*`, `bilan_*`, `objectifs_*`, `observations`, `actions_a_mener`, `avis_global`, `sortie_classification` (CHECK 4 catégories) + `_legacy`, `sortie_type`, `sortie_employeur`(+`_siret`), `sortie_duree_contrat_mois`, `sortie_formation`, `sortie_documents JSONB`, `previous_milestone_id`, `previous_review JSONB`, `validations JSONB`, `ia_preparation JSONB`, `contract_id`, `renouvellement_form/avis/duree_mois`, `post_sortie_situation` (6 valeurs), `remise_salarie JSONB`, **`fse_sortie JSONB`**, `locked_at`, `periode_essai_form/decision`, `ai_recommendations`. Index uniques partiels : un `diagnostic_accueil` et un `bilan_sortie` par (employé, parcours) |
| `cip_action_plans` | `:3680` | `milestone_id` nullable, `employee_id`, `action_label`, `category` (competence/insertion/socialisation/frein), `frein_type`, `priority`, `status`, `echeance`, `notes`, `objectif_id`, `partenaire_id`, `resultat`, `duree_minutes`, `created_by` |
| `insertion_interview_alerts` | `:3700` | `alert_type` (planification, rappel_j7, rappel_j1, retard, pass_iae_7m, pass_iae_2m), `target_date`, `is_sent` (jamais positionné) |
| `insertion_objectifs` | `:4102` | `parent_id` (1 niveau), `milestone_id`, `titre`, `origine` (salarie/cip), `echeance`, `date_butoir`, `statut` (6), `ordre` |
| `insertion_partenaires` | `:4125` | `nom UNIQUE`, `categorie`, contacts, `actif` ; seed 16 (`:4204`) dont France Travail, Mission locale, SPIP, CAF, CPAM, ANTS, Action Logement, auto-école sociale |
| `insertion_pmsmp` | `:4140` | `entreprise`, `siret`, `objet` (3), `date_debut/fin`, `tuteur`, `bilan`, `saisie_outil_officiel`, `convention_ref` |
| `insertion_satisfaction_sortie` | `:4161` | `reponses JSONB`, `situation_sortie`, `satisfaction_globale` (1-4), UNIQUE(employee_id, parcours_num) |
| `insertion_milestones_history` | `:4181` | `snapshot JSONB`, `action` (update/close/reopen), `motif` |
| `insertion_alert_acks` | `:4369` | `alert_type`, `acked_by`, `acked_until` |
| `insertion_competence_referentiels` / `_evaluations` / `_scores` | `:4452`-`:4489` | grille par filière (5), périodes, `note 0-10`, `non_evalue`, rubrique/item dénormalisés ; seed 34 items |
| `insertion_checklist_embauche` | `:4552` | `items JSONB` 7 étapes |
| `insertion_notes_profil` | `:4572` | `contenu_chiffre`, `sources`, `communiquee_cip_at/by` |
| `insertion_notes_suivi` / `_history` | `:4604`/`:4634` | `date_note`, `categorie` (6), `contenu_chiffre`, `milestone_id`, `objectif_id` ; historique sans FK sur `note_id` |

**`employees`** : `insertion_status` (none/en_parcours/termine/abandon), `insertion_start_date`, `insertion_end_date`, `prescripteur VARCHAR(100)` (texte libre historique), `visite_medicale_date` (`:3126-3131`) ; `cip_referent_user_id` (`:3136`) ; `prescripteur_id` FK `prescripteur_orgas` + `date_prescription` (`:3230`) ; `pass_iae_number/start/end`, `cddi_derogation_motif` (formation_en_cours/senior_50/rqth/cdi_inclusion), `cddi_derogation_date`, `eligibilite_criteres TEXT`, `eligibilite_justificatifs_ref TEXT`, `france_travail_id`, `parcours_num` (`:4077-4085`). **Aucune colonne `sortie_*` ni `fse_*` sur employees.**
**`candidates`** : `prescripteur_id`, `pass_iae_number/start/end`, `eligibilite_criteres` (`:4092-4097`), recopiés en COALESCE au link-employee.
**`prescripteur_orgas`** (`:3209`) : `nom`, `type` (PE, FT, ML, CD, CCAS, CAP_EMPLOI, AUTRE_ASSO, DIRECT), contacts, `siret`, `actif`.

## 4. Règles métier codées
- **Types d'entretiens** (`engine.js:14`) : `diagnostic_accueil`, `bilan_intermediaire`, `renouvellement`, `bilan_sortie`, `suivi_post_sortie`, `periode_essai`.
- **Échéancier** `computeMilestoneSchedule` (`engine.js:1471`) : diagnostic = début + 1 mois ; bilans M+3/M+6/M+10 seulement si `m < durationMonths` ; bilan de sortie = fin − 15 j. `resyncMilestones` ne touche jamais un `realise` ni un verrouillé.
- **Clôture** (`routes.js:693`) : 6 contrôles → freins évalués (ou non-évaluation assumée), `previous_review`, décision période d'essai, triple validation eti/cip/directeur pour le renouvellement, classification + documents de sortie (STC, certificat, attestation France Travail), prochain entretien. Puis `locked_at`. Effets : bilan de sortie réalisé → `insertion_status='termine'` ; période d'essai `rompu` → `abandon`.
- **9 freins** (`freins-registry.js`) : mobilite, sante (art. 9), finances, famille, linguistique, administratif, numerique, logement, judiciaire (art. 10). Suggestions serveur `computeSuggestionsFreins` (`routes.js:272`) sur 7 axes, jamais judiciaire/numérique, jamais enregistrées d'office.
- **Masquage** (`masking.js`) : MANAGER perd `commentaire_sante`, `frein_sante_detail/causes`, `commentaire_budget`, tout `frein_judiciaire*` ; actions judiciaires retirées entièrement.
- **Sorties** : `DYNAMIC_SORTIE_CLASSES = ['emploi_durable','emploi_transition','sortie_positive']` + `'autre'` (`routes.js:95`).
- **PMSMP** : 31 j/convention (non forçable), 60 j/12 mois glissants (forçable avec motif tracé), assiette prudente toutes entreprises + `autres_jours_connus`.
- **CDDI** : `computeCddiCumulativeMonths` ; ≥22 mois attention, ≥23 critique ; >24 sans motif de dérogation → critique (L.5132-15-1).
- **Pass IAE** : alertes ≤7 mois (`insertion.alerte_pass_iae_mois`) et ≤2 mois, expiré.
- **FSE+** : `fse_entree`/`fse_sortie` JSONB libres, exclus de l'anonymisation (piste ≥ 5 ans). Questionnaire d'entrée front : `statut_avant_entree`, `duree_sans_emploi` (4 tranches), `foyer_monoparental`, `sans_domicile_stable`, `commentaire`.
- **Audit** `gatherAuditKpis` (`routes.js:2960`) : dénominateur = bilans de sortie réalisés classés dans l'année civile ; typologies (RQTH, ressources, niveaux de formation, tranches d'âge) ; ETP « contrôle ERP » = `SUM(weekly_hours/35)` ; bloc `cvg: { statut: 'trame_en_attente' }`.
- **Alertes de fiche** (`:1750`) : 8 blocs, acquittables.

## 5. Jobs scheduler (`services/scheduler.js`, 7 h / 12 h / 18 h, advisory lock)
`checkInsertionMilestones` (`:300`), `checkInsertionInterviewAlerts` (`:356`, J-7 + préparation IA, J-1 + Brevo), `checkPassIaeExpiring` (`:440`), `checkRenouvellementsAPreparer` (`:475`), `createPostSortieFollowups` (`:512` — crée `suivi_post_sortie` à **sortie + 3 mois**), `genererNotesProfilManquantes` (`:574`), `purgeInsertionDossiers` (`rgpd-purges.js:404`, 24 mois).

## 6. Services IA (`services/insertion-ai.js`)
`getEmployeeInsertionData` (`:139`, résilient), `analyseProfilComplet` (`:252`, pseudonymisé, tranche d'âge, `risk_alert` retiré), `preparerEntretien` (`:374`), `bilanCohorte` (`:445`), `auditGlobalReport` (`:545`), `analyserProfilInitial` (`:718`, listes blanches). `reparerJsonTronque` (`:54`).

## 7. Existe / n'existe pas (grep)
**Existe** : prescripteur structuré (8 types), CIP référent interne, `france_travail_id`, seed partenaire France Travail, attestation FT en check-list de sortie, ASP (`asp-parser.js` lit « Dont BRSA »), heures hebdo contractuelles, sortie dynamique, FSE+ (JSONB), RQTH, éligibilité texte libre, RSA via `ressources TEXT[]`.
**N'existe pas (0 occurrence)** : DORA ; API Emplois de l'inclusion ; CER / PPAE ; BRSA comme attribut de personne ; DELD ; QPV/ZRR ; DDETS ; critères d'éligibilité typés ; orienteur distinct ; catégorie France Travail ; contrôle d'heures d'activité hebdo.

## 8. Tests existants
Contract : `insertion-contract.test.js` (236 `it`), `insertion-isolation-contract.test.js` (12), `notes-suivi-contract.test.js` (33), `note-profil-contract.test.js` (15), `note-profil-pdf-tronquee`, `effectifs-contract`, `asp-comparaison-contract`, `employees-masking-contract`, `rgpd-*`. Unit : `insertion-engine` (31), `pmsmp-rules` (16), `freins-registry` (10), `insertion-masking` (6), `insertion-freins-export` (11), `insertion-schema` (11), `insertion-schema-v2` (29), IA pseudonymize/notes/json-tronque, field-crypto, anonymization, effectifs-engine.
**Trous** : jobs scheduler insertion non testés ; `GET /exports/fse-plus` et `/exports/insertion` non testés ; `/timeline`, `/milestones-overview`, `/interview-template`, `/ia/*` hors note de profil non testés.

## 9. Points faibles et dettes
1. `routes.js` 4 166 lignes / 72 endpoints, helpers intercalés ; `gatherAuditKpis` ré-importé depuis `exports.js` par `require` paresseux.
2. Ordre de routage load-bearing (`GET /:employeeId` capture tout).
3. `CREATE TABLE insertion_milestones` porte encore le CHECK legacy défait par migration.
4. Trois bases ETP (35 h/sem, 1 607 h, 1 820 h).
5. `employees.prescripteur` texte libre coexiste avec `prescripteur_id`.
6. `fse_entree`/`fse_sortie` JSONB sans schéma ni validation ni complétude.
7. `insertion.objectif_sorties_dynamiques` et `insertion.cible_taux_dynamiques` coexistent.
8. Bilans intermédiaires pouvant tomber à la même date (`engine.js:1487`).
9. `sortie_classification_legacy` colonne morte.
10. `is_sent`/`sent_at` jamais positionnés.
11. Mentions « écran ETI phase B » (`routes.js:479`, `:2461`).
12. Avertissements « Phase B : reprendre les ON CONFLICT » périmés (`init-db.js:3850`, `:4048`).
13. **Accès MANAGER aux compétences non cloisonné par équipe** (`routes.js:3305`).
14. Filtre « gestionnaire » à double sémantique (`:1671`).
15. Bloc CVG réservé en attente de trame.
16. Modèle IA par défaut dupliqué.
17. Helpers `soft()` avalent les erreurs SQL : un export FSE+ peut sortir **vide** sans erreur visible (`exports.js:412`).
18. Resync post-commit best effort sans trace utilisateur.

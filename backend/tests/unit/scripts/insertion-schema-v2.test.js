/**
 * Extension insertion 2026-07 (PR1) — socle schéma (analyse statique
 * d'init-db.js, même approche que insertion-schema.test.js : aucune base
 * requise).
 *
 * Vérifie :
 * - les nouvelles colonnes/CHECK des entretiens (insertion_milestones) ;
 * - la requalification de milestone_type et la nomenclature des sorties avec
 *   l'ORDRE critique : DROP de l'ancien CHECK → UPDATE de données → nouveau
 *   CHECK (un UPDATE sous l'ancienne contrainte serait rejeté) ;
 * - la fin de l'unicité (employee_id, milestone_type) → index uniques
 *   partiels accueil/sortie par parcours ;
 * - le diagnostic versionné par parcours (UNIQUE(employee_id, parcours_num)) ;
 * - les colonnes conformité IAE d'employees/candidates ;
 * - les 5 tables satellites + cip_action_plans assoupli ;
 * - les seeds idempotents (partenaires, registre RGPD).
 */
const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..'); // → backend/
const src = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'scripts', 'init-db.js'), 'utf8');

// Colonnes ajoutées au modèle « entretiens ».
const MS_NEW_COLS = [
  'titre', 'parcours_num', 'previous_milestone_id', 'previous_review', 'validations',
  'ia_preparation', 'ia_preparation_at', 'contract_id', 'renouvellement_form',
  'renouvellement_avis', 'renouvellement_duree_mois', 'sortie_documents',
  'post_sortie_situation', 'post_sortie_commentaire', 'remise_salarie', 'fse_sortie',
  'locked_at', 'frein_logement', 'frein_judiciaire', 'sortie_classification_legacy',
];

// Colonnes ajoutées au diagnostic refondu (Lot 2 + §6bis).
const DIAG_NEW_COLS = [
  'parcours_num',
  'logement_statut', 'logement_satisfaction', 'commentaire_logement',
  'piece_identite_validite', 'allocataire_caf', 'ressources', 'commentaire_droits',
  'mutuelle_statut', 'rqth', 'rqth_fin', 'contre_indications', 'suivi_sante', 'commentaire_sante',
  'difficultes_financieres', 'credits_en_cours', 'commentaire_budget',
  'permis_b_statut', 'vehicule', 'moyen_transport', 'commentaire_mobilite',
  'autre_employeur', 'autre_employeur_heures', 'souhait_complement_heures',
  'niveau_formation', 'metiers_souhaites', 'pret_a_se_former', 'cpf_accessible',
  'projet_formation', 'emploi_vise', 'emploi_vise_rome', 'commentaire_projet',
  'attentes_parcours', 'difficultes_exprimees', 'objectifs_exprimes', 'aide_souhaitee',
  'cecrl_niveau', 'commentaire_linguistique',
  'situation_familiale', 'nb_enfants', 'enfants_a_charge',
  'frein_logement', 'frein_logement_detail', 'frein_logement_causes',
  'frein_judiciaire', 'frein_judiciaire_detail',
  'questionnaire_detail', 'fse_entree', 'statut_saisie',
];

const EMP_NEW_COLS = [
  'pass_iae_number', 'pass_iae_start', 'pass_iae_end',
  'cddi_derogation_motif', 'cddi_derogation_date',
  'eligibilite_criteres', 'eligibilite_justificatifs_ref',
  'france_travail_id', 'parcours_num',
];

const CAND_NEW_COLS = [
  'prescripteur_id', 'pass_iae_number', 'pass_iae_start', 'pass_iae_end', 'eligibilite_criteres',
];

describe('schéma v2 — insertion_milestones (modèle entretiens)', () => {
  test('toutes les nouvelles colonnes sont migrées en ADD COLUMN IF NOT EXISTS', () => {
    for (const col of MS_NEW_COLS) {
      expect(src).toContain(`ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS ${col} `);
    }
  });

  test('les 2 nouveaux freins portent un CHECK 1-5 (sans défaut)', () => {
    expect(src).toMatch(/insertion_milestones ADD COLUMN IF NOT EXISTS frein_logement INTEGER CHECK \(frein_logement BETWEEN 1 AND 5\)/);
    expect(src).toMatch(/insertion_milestones ADD COLUMN IF NOT EXISTS frein_judiciaire INTEGER CHECK \(frein_judiciaire BETWEEN 1 AND 5\)/);
    expect(src).not.toMatch(/frein_logement INTEGER DEFAULT/);
    expect(src).not.toMatch(/frein_judiciaire INTEGER DEFAULT/);
  });

  test('nouveau CHECK milestone_type : les 5 types techniques', () => {
    expect(src).toMatch(/insertion_milestones_milestone_type_check\s+CHECK \(milestone_type IN \('diagnostic_accueil', 'bilan_intermediaire', 'renouvellement', 'bilan_sortie', 'suivi_post_sortie'\)\)/);
  });

  test('migration de données des 5 anciens libellés + backfill titre', () => {
    expect(src).toContain(`SET milestone_type = 'diagnostic_accueil' WHERE milestone_type = 'Diagnostic accueil'`);
    expect(src).toContain(`SET milestone_type = 'bilan_intermediaire' WHERE milestone_type IN ('Bilan M+3', 'Bilan M+6', 'Bilan M+10')`);
    expect(src).toContain(`SET milestone_type = 'bilan_sortie' WHERE milestone_type = 'Bilan Sortie'`);
    // Backfill du titre depuis l'ancien libellé, seulement si titre absent.
    expect(src).toContain(`SET titre = 'Diagnostic d''accueil' WHERE titre IS NULL AND milestone_type = 'Diagnostic accueil'`);
    expect(src).toContain(`SET titre = milestone_type WHERE titre IS NULL AND milestone_type IN ('Bilan M+3', 'Bilan M+6', 'Bilan M+10')`);
    expect(src).toContain(`SET titre = 'Bilan de sortie' WHERE titre IS NULL AND milestone_type = 'Bilan Sortie'`);
  });

  test('ORDRE critique milestone_type : DROP ancien CHECK → DROP UNIQUE → UPDATE données → nouveau CHECK', () => {
    const dropCheckIdx = src.indexOf(`pg_get_constraintdef(oid) NOT ILIKE '%bilan_intermediaire%'`);
    // Le DROP de l'UNIQUE(employee_id, milestone_type) doit précéder les
    // UPDATE : la fusion M+3/M+6/M+10 → bilan_intermediaire crée plusieurs
    // lignes (employé, type) identiques (prouvé en duplicate key sinon).
    const dropUniqueIdx = src.indexOf(`contype = 'u'
            AND pg_get_constraintdef(oid) ILIKE '%milestone_type%'`);
    const dropOldIndexIdx = src.indexOf('DROP INDEX IF EXISTS idx_milestones_emp_type_unique');
    const updateIdx = src.indexOf(`SET milestone_type = 'diagnostic_accueil'`);
    const addIdx = src.indexOf('insertion_milestones_milestone_type_check');
    expect(dropCheckIdx).toBeGreaterThan(-1);
    expect(dropUniqueIdx).toBeGreaterThan(-1);
    expect(dropOldIndexIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(addIdx).toBeGreaterThan(-1);
    expect(dropCheckIdx).toBeLessThan(updateIdx);
    expect(dropUniqueIdx).toBeLessThan(updateIdx);
    expect(dropOldIndexIdx).toBeLessThan(updateIdx);
    expect(updateIdx).toBeLessThan(addIdx);
  });

  test('le backfill du titre précède le renommage des types (le libellé d\'origine est conservé)', () => {
    expect(src.indexOf(`SET titre = 'Diagnostic d''accueil'`)).toBeLessThan(src.indexOf(`SET milestone_type = 'diagnostic_accueil'`));
  });
});

describe('schéma v2 — unicité des entretiens', () => {
  test('l\'ancien anti-doublon destructeur est retiré (DELETE des doublons + index unique global)', () => {
    // Le DELETE qui dédupliquait par (employee_id, milestone_type) détruirait
    // les occurrences multiples légitimes du nouveau modèle.
    expect(src).not.toMatch(/DELETE FROM insertion_milestones a USING insertion_milestones b/);
    expect(src).not.toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_milestones_emp_type_unique/);
    expect(src).toContain('DROP INDEX IF EXISTS idx_milestones_emp_type_unique');
  });

  test('la contrainte UNIQUE(employee_id, milestone_type) est levée par scan pg_constraint', () => {
    const block = src.slice(src.indexOf('Migration extension entretiens 2026-07'));
    expect(block).toMatch(/contype = 'u'\s+AND pg_get_constraintdef\(oid\) ILIKE '%milestone_type%'/);
  });

  test('index uniques PARTIELS accueil/sortie par (employee_id, parcours_num) + index de consultation', () => {
    expect(src).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_milestones_accueil_unique\s+ON insertion_milestones\(employee_id, parcours_num\) WHERE milestone_type = 'diagnostic_accueil'/);
    expect(src).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_milestones_sortie_unique\s+ON insertion_milestones\(employee_id, parcours_num\) WHERE milestone_type = 'bilan_sortie'/);
    expect(src).toContain('CREATE INDEX IF NOT EXISTS idx_milestones_emp_due ON insertion_milestones(employee_id, due_date);');
  });
});

describe('schéma v2 — nomenclature des sorties (D8)', () => {
  test('sauvegarde legacy puis mapping par sortie_type, borné aux anciennes valeurs', () => {
    expect(src).toContain('ADD COLUMN IF NOT EXISTS sortie_classification_legacy VARCHAR(20)');
    expect(src).toContain('sortie_classification_legacy = sortie_classification');
    expect(src).toContain(`WHEN sortie_type IN ('CDI', 'CDD', 'creation_activite') THEN 'emploi_durable'`);
    expect(src).toContain(`WHEN sortie_type IN ('CDD_court', 'interim') THEN 'emploi_transition'`);
    expect(src).toContain(`WHEN sortie_type IN ('formation', 'autre_IAE') THEN 'sortie_positive'`);
    expect(src).toContain(`WHEN sortie_classification = 'negative' THEN 'autre'`);
    // Idempotence : seules les lignes encore en binaire sont migrées.
    expect(src).toContain(`WHERE sortie_classification IN ('positive', 'negative')`);
  });

  test('nouveau CHECK à 4 catégories, posé APRÈS la migration de données', () => {
    const updateIdx = src.indexOf('sortie_classification_legacy = sortie_classification');
    const addIdx = src.indexOf('insertion_milestones_sortie_classification_check');
    expect(src).toMatch(/CHECK \(sortie_classification IN \('emploi_durable', 'emploi_transition', 'sortie_positive', 'autre'\)\)/);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(addIdx).toBeGreaterThan(updateIdx);
  });
});

describe('schéma v2 — insertion_diagnostics (diagnostic refondu)', () => {
  test('toutes les nouvelles colonnes sont migrées en ADD COLUMN IF NOT EXISTS', () => {
    for (const col of DIAG_NEW_COLS) {
      expect(src).toContain(`ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS ${col} `);
    }
  });

  test('statut_saisie (stepper) : NOT NULL DEFAULT complet + CHECK en_cours/complet', () => {
    expect(src).toMatch(/statut_saisie VARCHAR\(15\) NOT NULL DEFAULT 'complet' CHECK \(statut_saisie IN \('en_cours', 'complet'\)\)/);
  });

  test('UNIQUE(employee_id) → UNIQUE(employee_id, parcours_num) (contrainte nommée, gardée)', () => {
    expect(src).toContain('insertion_diagnostics_employee_parcours_key UNIQUE (employee_id, parcours_num)');
    const block = src.slice(src.indexOf('Migration extension entretiens 2026-07'));
    expect(block).toMatch(/conrelid = 'insertion_diagnostics'::regclass AND contype = 'u'\s+AND pg_get_constraintdef\(oid\) NOT ILIKE '%parcours_num%'/);
  });
});

describe('schéma v2 — employees / candidates (conformité IAE)', () => {
  test('colonnes employees (Pass IAE, dérogation CDDI, éligibilité, France Travail, parcours)', () => {
    for (const col of EMP_NEW_COLS) {
      expect(src).toContain(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS ${col} `);
    }
    expect(src).toMatch(/cddi_derogation_motif VARCHAR\(30\) CHECK \(cddi_derogation_motif IN \('formation_en_cours', 'senior_50', 'rqth', 'cdi_inclusion'\)\)/);
  });

  test('colonnes candidates (prescripteur structuré + Pass IAE + éligibilité)', () => {
    for (const col of CAND_NEW_COLS) {
      expect(src).toContain(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS ${col} `);
    }
    expect(src).toContain('ALTER TABLE candidates ADD COLUMN IF NOT EXISTS prescripteur_id INTEGER REFERENCES prescripteur_orgas(id) ON DELETE SET NULL');
  });
});

describe('schéma v2 — tables satellites', () => {
  test('les 5 nouvelles tables sont créées (IF NOT EXISTS)', () => {
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS insertion_objectifs/);
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS insertion_partenaires/);
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS insertion_pmsmp/);
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS insertion_satisfaction_sortie/);
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS insertion_milestones_history/);
  });

  test('objectifs : sous-objectifs (parent_id), origine salarie/cip, 6 statuts, index', () => {
    expect(src).toMatch(/parent_id INTEGER REFERENCES insertion_objectifs\(id\) ON DELETE CASCADE/);
    expect(src).toMatch(/origine VARCHAR\(10\) NOT NULL DEFAULT 'cip' CHECK \(origine IN \('salarie', 'cip'\)\)/);
    expect(src).toMatch(/CHECK \(statut IN \('a_venir', 'en_cours', 'atteint', 'partiellement_atteint', 'abandonne', 'reporte'\)\)/);
    expect(src).toContain('idx_insertion_objectifs_employee');
    expect(src).toContain('idx_insertion_objectifs_parent');
  });

  test('pmsmp : objet contraint + bornes de dates + drapeau outil officiel', () => {
    expect(src).toMatch(/objet VARCHAR\(30\) NOT NULL CHECK \(objet IN \('decouvrir_metier', 'confirmer_projet', 'initier_recrutement'\)\)/);
    expect(src).toMatch(/saisie_outil_officiel BOOLEAN NOT NULL DEFAULT false/);
    expect(src).toContain('idx_insertion_pmsmp_employee');
  });

  test('satisfaction de sortie : une réponse par salarié ET par parcours (§6bis)', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS insertion_satisfaction_sortie'));
    expect(tbl.slice(0, 1200)).toContain('parcours_num SMALLINT NOT NULL DEFAULT 1');
    expect(tbl.slice(0, 1200)).toContain('UNIQUE(employee_id, parcours_num)');
    expect(tbl.slice(0, 1200)).toMatch(/satisfaction_globale SMALLINT CHECK \(satisfaction_globale BETWEEN 1 AND 4\)/);
    // Pas d'unicité simple employee_id (le plan initial est amendé par §6bis).
    expect(tbl.slice(0, 1200)).not.toMatch(/employee_id INTEGER NOT NULL UNIQUE/);
  });

  test('historique probant des entretiens : snapshot JSONB + action update/close/reopen (pattern refashion_dpav_history)', () => {
    const tbl = src.slice(src.indexOf('CREATE TABLE IF NOT EXISTS insertion_milestones_history'));
    expect(tbl.slice(0, 900)).toContain('milestone_id INTEGER NOT NULL REFERENCES insertion_milestones(id) ON DELETE CASCADE');
    expect(tbl.slice(0, 900)).toContain('snapshot JSONB NOT NULL');
    expect(tbl.slice(0, 900)).toMatch(/action VARCHAR\(20\) NOT NULL CHECK \(action IN \('update', 'close', 'reopen'\)\)/);
    expect(tbl.slice(0, 900)).toContain('motif TEXT');
    expect(src).toContain('idx_insertion_ms_history_milestone');
  });
});

describe('schéma v2 — cip_action_plans assoupli', () => {
  test('milestone_id devient nullable (action hors entretien)', () => {
    expect(src).toContain('ALTER TABLE cip_action_plans ALTER COLUMN milestone_id DROP NOT NULL;');
  });

  test('nouvelles colonnes : objectif_id, partenaire_id, resultat, duree_minutes, created_by', () => {
    expect(src).toContain('ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS objectif_id INTEGER REFERENCES insertion_objectifs(id) ON DELETE SET NULL');
    expect(src).toContain('ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS partenaire_id INTEGER REFERENCES insertion_partenaires(id) ON DELETE SET NULL');
    expect(src).toContain('ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS resultat TEXT');
    expect(src).toContain('ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS duree_minutes INTEGER');
    expect(src).toContain('ALTER TABLE cip_action_plans ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)');
  });

  test('la FK objectif_id est déclarée APRÈS la création d\'insertion_objectifs', () => {
    const createIdx = src.indexOf('CREATE TABLE IF NOT EXISTS insertion_objectifs');
    const fkIdx = src.indexOf('ADD COLUMN IF NOT EXISTS objectif_id INTEGER REFERENCES insertion_objectifs(id)');
    expect(createIdx).toBeGreaterThan(-1);
    expect(fkIdx).toBeGreaterThan(createIdx);
  });
});

describe('schéma v2 — seeds idempotents', () => {
  test('seed partenaires : ON CONFLICT (nom) DO NOTHING + partenaires clés', () => {
    const seedIdx = src.indexOf('INSERT INTO insertion_partenaires (nom, categorie) VALUES');
    expect(seedIdx).toBeGreaterThan(-1);
    const seed = src.slice(seedIdx, seedIdx + 1500);
    expect(seed).toContain('ON CONFLICT (nom) DO NOTHING');
    for (const nom of ['CAF', 'France Travail', 'CPAM', 'ANTS', 'SOLIHA', 'Action Logement',
      'Bailleur social', 'OPCO', 'Mission locale', 'Département 76',
      'Centre des finances publiques', 'Banque de France', 'Organisme de formation',
      'Auto-école sociale', 'SPIP', 'Avocat / aide juridictionnelle']) {
      expect(seed).toContain(`('${nom}'`);
    }
  });

  test('seed registre RGPD : traitement accompagnement socio-pro, gardé par WHERE NOT EXISTS', () => {
    const idx = src.indexOf(`'Accompagnement socio-professionnel des salariés en insertion'`);
    expect(idx).toBeGreaterThan(-1);
    const seed = src.slice(idx - 400, idx + 4000);
    expect(seed).toContain('INSERT INTO rgpd_registre');
    expect(seed).toContain('WHERE NOT EXISTS');
    // Les catégories particulières y sont explicitement documentées.
    expect(seed).toContain('art. 9');
    expect(seed).toContain('art. 10');
    expect(seed).toContain('field-crypto');
  });
});

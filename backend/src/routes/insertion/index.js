/**
 * Module Insertion — Point d'entrée
 * Découpage du fichier monolithique insertion.js en sous-modules :
 *   - engine.js : base de connaissances, questionnaires, moteur d'analyse IA
 *   - routes.js : toutes les routes API (diagnostics, jalons, plans d'action)
 */
const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authenticate, authorize } = require('../../middleware/auth');

// ══════════════════════════════════════════════════════════════
// AUTO-MIGRATION — Tables insertion_diagnostics + milestones + action_plans
// ══════════════════════════════════════════════════════════════
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS insertion_diagnostics (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        created_by INTEGER REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id),
        parcours_anterieur TEXT,
        contraintes_sante TEXT, contraintes_mobilite TEXT, contraintes_familiales TEXT, autres_contraintes TEXT,
        frein_mobilite INTEGER DEFAULT 1, frein_mobilite_detail TEXT,
        frein_sante INTEGER DEFAULT 1, frein_sante_detail TEXT,
        frein_finances INTEGER DEFAULT 1, frein_finances_detail TEXT,
        frein_famille INTEGER DEFAULT 1, frein_famille_detail TEXT,
        frein_linguistique INTEGER DEFAULT 1, frein_linguistique_detail TEXT,
        frein_administratif INTEGER DEFAULT 1, frein_administratif_detail TEXT,
        frein_numerique INTEGER DEFAULT 1, frein_numerique_detail TEXT,
        frein_mobilite_causes TEXT, frein_sante_causes TEXT, frein_finances_causes TEXT,
        frein_famille_causes TEXT, frein_linguistique_causes TEXT, frein_administratif_causes TEXT,
        frein_numerique_causes TEXT,
        obs_taches_realisees TEXT, obs_points_forts TEXT, obs_difficultes TEXT,
        obs_comportement_equipe TEXT, obs_autonomie_ponctualite TEXT,
        pref_aime_faire TEXT, pref_ne_veut_plus TEXT, pref_environnement_prefere TEXT,
        pref_environnement_eviter TEXT, pref_objectifs TEXT,
        explorama_interets TEXT, explorama_rejets TEXT,
        explorama_gestes_positifs TEXT, explorama_gestes_negatifs TEXT,
        explorama_environnements TEXT, explorama_rythme TEXT,
        cip_hypotheses_metiers TEXT, cip_questions TEXT,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_id)
      )
    `);
    const addCol = async (col, type) => {
      try { await pool.query(`ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS ${col} ${type}`); } catch (err) { console.warn('[INSERTION] Migration col:', err.message); }
    };
    await addCol('frein_mobilite_causes', 'TEXT');
    await addCol('frein_sante_causes', 'TEXT');
    await addCol('frein_finances_causes', 'TEXT');
    await addCol('frein_famille_causes', 'TEXT');
    await addCol('frein_linguistique_causes', 'TEXT');
    await addCol('frein_administratif_causes', 'TEXT');
    await addCol('frein_numerique_causes', 'TEXT');
    await addCol('explorama_gestes_positifs', 'TEXT');
    await addCol('explorama_gestes_negatifs', 'TEXT');
    await addCol('explorama_environnements', 'TEXT');
    await addCol('explorama_rythme', 'TEXT');

    try {
      await pool.query(`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS insertion_status VARCHAR(30) DEFAULT 'none';
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS insertion_start_date DATE;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS insertion_end_date DATE;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS prescripteur VARCHAR(100);
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS visite_medicale_date DATE;
      `);
    } catch (err) { console.warn('[INSERTION] Migration employees cols:', err.message); }
    try {
      await pool.query(`ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_insertion_status_check`);
      await pool.query(`ALTER TABLE employees ADD CONSTRAINT employees_insertion_status_check CHECK (insertion_status IN ('none', 'en_parcours', 'termine', 'abandon'))`);
    } catch (err) { console.warn('[INSERTION] Migration constraint:', err.message); }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS insertion_milestones (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        milestone_type VARCHAR(30) NOT NULL CHECK (milestone_type IN ('Diagnostic accueil', 'Bilan M+3', 'Bilan M+6', 'Bilan M+10', 'Bilan Sortie')),
        due_date DATE NOT NULL,
        completed_date DATE,
        status VARCHAR(30) NOT NULL DEFAULT 'a_planifier'
          CHECK (status IN ('a_planifier', 'planifie', 'realise', 'reporte')),
        interview_date TIMESTAMP,
        interviewer_id INTEGER REFERENCES users(id),
        frein_mobilite INTEGER CHECK (frein_mobilite BETWEEN 1 AND 5),
        frein_sante INTEGER CHECK (frein_sante BETWEEN 1 AND 5),
        frein_finances INTEGER CHECK (frein_finances BETWEEN 1 AND 5),
        frein_famille INTEGER CHECK (frein_famille BETWEEN 1 AND 5),
        frein_linguistique INTEGER CHECK (frein_linguistique BETWEEN 1 AND 5),
        frein_administratif INTEGER CHECK (frein_administratif BETWEEN 1 AND 5),
        frein_numerique INTEGER CHECK (frein_numerique BETWEEN 1 AND 5),
        cip_integration TEXT, cip_competences TEXT, cip_projet_pro TEXT, cip_socialisation TEXT,
        bilan_professionnel TEXT, bilan_social TEXT,
        objectifs_realises TEXT, objectifs_prochaine_periode TEXT,
        observations TEXT, actions_a_mener TEXT,
        avis_global VARCHAR(30) CHECK (avis_global IN ('tres_positif', 'positif', 'mitige', 'insuffisant')),
        sortie_classification VARCHAR(20) CHECK (sortie_classification IN ('positive', 'negative')),
        sortie_type VARCHAR(50), sortie_commentaires TEXT, sortie_employeur TEXT, sortie_formation TEXT,
        ai_recommendations JSONB,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_id, milestone_type)
      )
    `);

    const addMsCol = async (col, type) => {
      try { await pool.query(`ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS ${col} ${type}`); } catch (err) { console.warn('[INSERTION] Migration ms col:', err.message); }
    };
    await addMsCol('frein_numerique', 'INTEGER CHECK (frein_numerique BETWEEN 1 AND 5)');
    await addMsCol('cip_integration', 'TEXT');
    await addMsCol('cip_competences', 'TEXT');
    await addMsCol('cip_projet_pro', 'TEXT');
    await addMsCol('cip_socialisation', 'TEXT');
    await addMsCol('sortie_classification', "VARCHAR(20) CHECK (sortie_classification IN ('positive', 'negative'))");
    await addMsCol('sortie_type', 'VARCHAR(50)');
    await addMsCol('sortie_commentaires', 'TEXT');
    await addMsCol('sortie_employeur', 'TEXT');
    await addMsCol('sortie_formation', 'TEXT');
    await addMsCol('ai_recommendations', 'JSONB');

    try {
      await pool.query(`ALTER TABLE insertion_milestones DROP CONSTRAINT IF EXISTS insertion_milestones_milestone_type_check`);
      await pool.query(`ALTER TABLE insertion_milestones ADD CONSTRAINT insertion_milestones_milestone_type_check CHECK (milestone_type IN ('Diagnostic accueil', 'Bilan M+3', 'Bilan M+6', 'Bilan M+10', 'Bilan Sortie', 'Bilan M+2'))`);
    } catch (err) { console.warn('[INSERTION] Migration ms check:', err.message); }

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cip_action_plans (
          id SERIAL PRIMARY KEY,
          milestone_id INTEGER NOT NULL REFERENCES insertion_milestones(id) ON DELETE CASCADE,
          employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          action_label TEXT NOT NULL,
          category VARCHAR(30) NOT NULL CHECK (category IN ('competence', 'insertion', 'socialisation', 'frein')),
          frein_type VARCHAR(30),
          priority VARCHAR(20) DEFAULT 'moyenne' CHECK (priority IN ('haute', 'moyenne', 'basse')),
          status VARCHAR(20) DEFAULT 'a_faire' CHECK (status IN ('a_faire', 'en_cours', 'realise', 'abandonne')),
          echeance DATE, notes TEXT,
          created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
    } catch (err) { console.warn('[INSERTION] Migration action_plans:', err.message); }

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS insertion_interview_alerts (
          id SERIAL PRIMARY KEY,
          employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          milestone_type VARCHAR(30) NOT NULL,
          alert_type VARCHAR(30) NOT NULL CHECK (alert_type IN ('planification', 'rappel_j7', 'rappel_j1', 'retard')),
          sent_at TIMESTAMP, is_sent BOOLEAN DEFAULT false, target_date DATE NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
    } catch (err) { console.warn('[INSERTION] Migration alerts:', err.message); }

    console.log('[INSERTION] Tables insertion OK');
  } catch (err) {
    console.error('[INSERTION] Migration insertion :', err.message);
  }
})();

// Auth middleware for all insertion routes
router.use(authenticate, authorize('ADMIN', 'RH', 'MANAGER'));

// Mount routes
const routes = require('./routes');
router.use('/', routes);

module.exports = router;

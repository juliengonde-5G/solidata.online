/**
 * Routes insertion — Diagnostics, jalons, plans d'action, analyse
 * Extrait de insertion.js monolithique pour maintenabilité
 */
const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { body, param } = require('express-validator');
const { validate } = require('../../middleware/validate');
const CryptoJS = require('crypto-js');
const { FREINS_DEFINITIONS, CIP_QUESTIONNAIRES, analyzeInsertion, buildTimeline } = require('./engine');
const { autoLogActivity } = require('../../middleware/activity-logger');

const PCM_KEY = process.env.JWT_SECRET || 'solidata-pcm-encryption-key';

router.use(autoLogActivity('insertion'));

// GET /api/insertion — Vue d'ensemble de tous les employés actifs
// IMPORTANT: doit etre AVANT /:employeeId pour ne pas etre intercepte
router.get('/', async (req, res) => {
  try {
    // Detecter quelles tables existent pour adapter la requete
    const tablesCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('employee_contracts', 'pcm_reports', 'insertion_diagnostics')
    `);
    const existingTables = new Set(tablesCheck.rows.map(r => r.table_name));

    let subqueries = '';
    if (existingTables.has('employee_contracts')) {
      subqueries += `,
        COALESCE((SELECT COUNT(*)::int FROM employee_contracts WHERE employee_id = e.id), 0) as nb_contracts,
        (SELECT ec.contract_type FROM employee_contracts ec WHERE ec.employee_id = e.id AND ec.is_current = true LIMIT 1) as current_contract_type,
        (SELECT ec.end_date FROM employee_contracts ec WHERE ec.employee_id = e.id AND ec.is_current = true LIMIT 1) as contract_end_date`;
    } else {
      subqueries += `, 0 as nb_contracts, e.contract_type as current_contract_type, e.contract_end as contract_end_date`;
    }
    if (existingTables.has('pcm_reports')) {
      subqueries += `,
        CASE WHEN e.candidate_id IS NOT NULL THEN
          COALESCE((SELECT COUNT(*)::int FROM pcm_reports pr WHERE pr.candidate_id = e.candidate_id), 0)
        ELSE 0 END as has_pcm`;
    } else {
      subqueries += `, 0 as has_pcm`;
    }
    if (existingTables.has('insertion_diagnostics')) {
      subqueries += `,
        COALESCE((SELECT COUNT(*)::int FROM insertion_diagnostics diag WHERE diag.employee_id = e.id), 0) as has_diagnostic`;
    } else {
      subqueries += `, 0 as has_diagnostic`;
    }

    const result = await pool.query(`
      SELECT e.id, e.first_name, e.last_name, e.is_active,
        t.name as team_name, e.position, e.contract_type, e.contract_start, e.contract_end
        ${subqueries}
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      WHERE e.is_active = true
      ORDER BY e.last_name, e.first_name
    `);

    const now = new Date();
    const employees = result.rows.map(e => {
      let urgency = null;
      if (e.contract_end_date) {
        const days = Math.round((new Date(e.contract_end_date) - now) / 86400000);
        if (days <= 30) urgency = 'critique';
        else if (days <= 60) urgency = 'attention';
      }
      return { ...e, urgency, has_pcm: e.has_pcm > 0, has_diagnostic: e.has_diagnostic > 0 };
    });

    console.log(`[INSERTION] GET / → ${employees.length} salaries actifs`);
    res.json(employees);
  } catch (err) {
    console.error('[INSERTION] Erreur liste :', err.message, err.detail || '');
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
});

// GET /api/insertion/freins-definitions — Référentiel des freins (pour le frontend)
router.get('/freins-definitions', (req, res) => {
  res.json(FREINS_DEFINITIONS);
});

// GET /api/insertion/diagnostic/:employeeId — Récupérer le diagnostic CIP
router.get('/diagnostic/:employeeId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM insertion_diagnostics WHERE employee_id = $1',
      [req.params.employeeId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('[INSERTION] Erreur diagnostic GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/insertion/diagnostic/:employeeId — Sauvegarder/mettre a jour le diagnostic
router.put('/diagnostic/:employeeId', async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    if (isNaN(empId)) return res.status(400).json({ error: 'ID employe invalide' });
    const d = req.body;

    const result = await pool.query(`
      INSERT INTO insertion_diagnostics (
        employee_id, created_by, updated_by,
        parcours_anterieur, contraintes_sante, contraintes_mobilite, contraintes_familiales, autres_contraintes,
        frein_mobilite, frein_mobilite_detail, frein_mobilite_causes,
        frein_sante, frein_sante_detail, frein_sante_causes,
        frein_finances, frein_finances_detail, frein_finances_causes,
        frein_famille, frein_famille_detail, frein_famille_causes,
        frein_linguistique, frein_linguistique_detail, frein_linguistique_causes,
        frein_administratif, frein_administratif_detail, frein_administratif_causes,
        frein_numerique, frein_numerique_detail, frein_numerique_causes,
        obs_taches_realisees, obs_points_forts, obs_difficultes,
        obs_comportement_equipe, obs_autonomie_ponctualite,
        pref_aime_faire, pref_ne_veut_plus, pref_environnement_prefere,
        pref_environnement_eviter, pref_objectifs,
        explorama_interets, explorama_rejets,
        explorama_gestes_positifs, explorama_gestes_negatifs,
        explorama_environnements, explorama_rythme,
        cip_hypotheses_metiers, cip_questions
      ) VALUES (
        $1, $2, $2,
        $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
        $29, $30, $31, $32, $33,
        $34, $35, $36, $37, $38,
        $39, $40, $41, $42, $43, $44,
        $45, $46
      )
      ON CONFLICT (employee_id) DO UPDATE SET
        updated_by = $2, updated_at = NOW(),
        parcours_anterieur = $3, contraintes_sante = $4, contraintes_mobilite = $5,
        contraintes_familiales = $6, autres_contraintes = $7,
        frein_mobilite = $8, frein_mobilite_detail = $9, frein_mobilite_causes = $10,
        frein_sante = $11, frein_sante_detail = $12, frein_sante_causes = $13,
        frein_finances = $14, frein_finances_detail = $15, frein_finances_causes = $16,
        frein_famille = $17, frein_famille_detail = $18, frein_famille_causes = $19,
        frein_linguistique = $20, frein_linguistique_detail = $21, frein_linguistique_causes = $22,
        frein_administratif = $23, frein_administratif_detail = $24, frein_administratif_causes = $25,
        frein_numerique = $26, frein_numerique_detail = $27, frein_numerique_causes = $28,
        obs_taches_realisees = $29, obs_points_forts = $30, obs_difficultes = $31,
        obs_comportement_equipe = $32, obs_autonomie_ponctualite = $33,
        pref_aime_faire = $34, pref_ne_veut_plus = $35,
        pref_environnement_prefere = $36, pref_environnement_eviter = $37,
        pref_objectifs = $38,
        explorama_interets = $39, explorama_rejets = $40,
        explorama_gestes_positifs = $41, explorama_gestes_negatifs = $42,
        explorama_environnements = $43, explorama_rythme = $44,
        cip_hypotheses_metiers = $45, cip_questions = $46
      RETURNING *
    `, [
      empId, req.user.id,
      d.parcours_anterieur || null, d.contraintes_sante || null,
      d.contraintes_mobilite || null, d.contraintes_familiales || null,
      d.autres_contraintes || null,
      d.frein_mobilite || 1, d.frein_mobilite_detail || null, d.frein_mobilite_causes || null,
      d.frein_sante || 1, d.frein_sante_detail || null, d.frein_sante_causes || null,
      d.frein_finances || 1, d.frein_finances_detail || null, d.frein_finances_causes || null,
      d.frein_famille || 1, d.frein_famille_detail || null, d.frein_famille_causes || null,
      d.frein_linguistique || 1, d.frein_linguistique_detail || null, d.frein_linguistique_causes || null,
      d.frein_administratif || 1, d.frein_administratif_detail || null, d.frein_administratif_causes || null,
      d.frein_numerique || 1, d.frein_numerique_detail || null, d.frein_numerique_causes || null,
      d.obs_taches_realisees || null, d.obs_points_forts || null,
      d.obs_difficultes || null, d.obs_comportement_equipe || null,
      d.obs_autonomie_ponctualite || null,
      d.pref_aime_faire || null, d.pref_ne_veut_plus || null,
      d.pref_environnement_prefere || null, d.pref_environnement_eviter || null,
      d.pref_objectifs || null,
      d.explorama_interets || null, d.explorama_rejets || null,
      d.explorama_gestes_positifs || null, d.explorama_gestes_negatifs || null,
      d.explorama_environnements || null, d.explorama_rythme || null,
      d.cip_hypotheses_metiers || null, d.cip_questions || null,
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[INSERTION] Erreur diagnostic PUT :', err.message, err.detail || '');
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
});

// GET /api/insertion/:employeeId — Analyse complète
// ══════════════════════════════════════════════════════════════
// JALONS INSERTION — Diagnostic accueil, M+3, M+6, M+10, Sortie
// ══════════════════════════════════════════════════════════════

// GET /api/insertion/milestones/:employeeId — Tous les jalons d'un salarié
router.get('/milestones/:employeeId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT im.*, u.first_name as interviewer_first, u.last_name as interviewer_last
       FROM insertion_milestones im
       LEFT JOIN users u ON im.interviewer_id = u.id
       WHERE im.employee_id = $1
       ORDER BY im.due_date`,
      [req.params.employeeId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[INSERTION] Erreur milestones GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/insertion/milestones — Créer un jalon manuellement
router.post('/milestones', [
  body('employee_id').isInt().withMessage('ID employé requis'),
  body('milestone_type').notEmpty().withMessage('Type de jalon requis'),
], validate, async (req, res) => {
  try {
    const { employee_id, milestone_type, due_date } = req.body;
    if (!employee_id || !milestone_type) return res.status(400).json({ error: 'employee_id et milestone_type requis' });

    const result = await pool.query(
      `INSERT INTO insertion_milestones (employee_id, milestone_type, due_date, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_id, milestone_type) DO UPDATE SET
         due_date = COALESCE($3, insertion_milestones.due_date),
         updated_at = NOW()
       RETURNING *`,
      [employee_id, milestone_type, due_date || new Date().toISOString().split('T')[0], req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[INSERTION] Erreur milestones POST :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/insertion/milestones/:id — Mettre a jour un jalon (entretien bilan)
router.put('/milestones/:id', async (req, res) => {
  try {
    const d = req.body;
    const result = await pool.query(
      `UPDATE insertion_milestones SET
        status = COALESCE($1, status),
        interview_date = COALESCE($2, interview_date),
        interviewer_id = COALESCE($3, interviewer_id),
        completed_date = COALESCE($4, completed_date),
        frein_mobilite = COALESCE($5, frein_mobilite),
        frein_sante = COALESCE($6, frein_sante),
        frein_finances = COALESCE($7, frein_finances),
        frein_famille = COALESCE($8, frein_famille),
        frein_linguistique = COALESCE($9, frein_linguistique),
        frein_administratif = COALESCE($10, frein_administratif),
        frein_numerique = COALESCE($11, frein_numerique),
        cip_integration = COALESCE($12, cip_integration),
        cip_competences = COALESCE($13, cip_competences),
        cip_projet_pro = COALESCE($14, cip_projet_pro),
        cip_socialisation = COALESCE($15, cip_socialisation),
        bilan_professionnel = COALESCE($16, bilan_professionnel),
        bilan_social = COALESCE($17, bilan_social),
        objectifs_realises = COALESCE($18, objectifs_realises),
        objectifs_prochaine_periode = COALESCE($19, objectifs_prochaine_periode),
        observations = COALESCE($20, observations),
        actions_a_mener = COALESCE($21, actions_a_mener),
        avis_global = COALESCE($22, avis_global),
        sortie_classification = COALESCE($23, sortie_classification),
        sortie_type = COALESCE($24, sortie_type),
        sortie_commentaires = COALESCE($25, sortie_commentaires),
        sortie_employeur = COALESCE($26, sortie_employeur),
        sortie_formation = COALESCE($27, sortie_formation),
        ai_recommendations = COALESCE($28, ai_recommendations),
        updated_at = NOW()
      WHERE id = $29 RETURNING *`,
      [
        d.status, d.interview_date, d.interviewer_id, d.completed_date,
        d.frein_mobilite, d.frein_sante, d.frein_finances, d.frein_famille,
        d.frein_linguistique, d.frein_administratif, d.frein_numerique,
        d.cip_integration, d.cip_competences, d.cip_projet_pro, d.cip_socialisation,
        d.bilan_professionnel, d.bilan_social,
        d.objectifs_realises, d.objectifs_prochaine_periode,
        d.observations, d.actions_a_mener, d.avis_global,
        d.sortie_classification, d.sortie_type, d.sortie_commentaires,
        d.sortie_employeur, d.sortie_formation,
        d.ai_recommendations ? JSON.stringify(d.ai_recommendations) : null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Jalon non trouve' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[INSERTION] Erreur milestones PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/milestones/:employeeId/radar — Données radar chart (évolution freins)
router.get('/milestones/:employeeId/radar', async (req, res) => {
  try {
    const empId = req.params.employeeId;

    // Diagnostic initial
    const diagRes = await pool.query(
      'SELECT frein_mobilite, frein_sante, frein_finances, frein_famille, frein_linguistique, frein_administratif FROM insertion_diagnostics WHERE employee_id = $1',
      [empId]
    );

    // Jalons réalisés avec scores
    const milestonesRes = await pool.query(
      `SELECT milestone_type, completed_date,
        frein_mobilite, frein_sante, frein_finances, frein_famille, frein_linguistique, frein_administratif
       FROM insertion_milestones
       WHERE employee_id = $1 AND status = 'realise'
       AND frein_mobilite IS NOT NULL
       ORDER BY due_date`,
      [empId]
    );

    const axes = ['Mobilite', 'Sante', 'Finances', 'Famille', 'Langue', 'Administratif', 'Numerique'];
    const axeKeys = ['frein_mobilite', 'frein_sante', 'frein_finances', 'frein_famille', 'frein_linguistique', 'frein_administratif', 'frein_numerique'];

    const series = [];

    // Série initiale (diagnostic)
    if (diagRes.rows.length > 0) {
      const d = diagRes.rows[0];
      series.push({
        label: 'Diagnostic initial',
        data: axeKeys.map(k => d[k] || 1),
      });
    }

    // Séries jalons
    for (const ms of milestonesRes.rows) {
      series.push({
        label: ms.milestone_type,
        date: ms.completed_date,
        data: axeKeys.map(k => ms[k] || 1),
      });
    }

    res.json({ axes, series });
  } catch (err) {
    console.error('[INSERTION] Erreur radar :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/milestones-overview — Vue d'ensemble jalons (tous les employés en parcours)
router.get('/milestones-overview', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT im.*, e.first_name, e.last_name, e.insertion_start_date,
        u.first_name as interviewer_first, u.last_name as interviewer_last
      FROM insertion_milestones im
      JOIN employees e ON im.employee_id = e.id
      LEFT JOIN users u ON im.interviewer_id = u.id
      WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
      ORDER BY im.due_date
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[INSERTION] Erreur milestones overview :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/interview-template/:milestoneType — Questionnaire CIP par jalon
router.get('/interview-template/:milestoneType', (req, res) => {
  const template = CIP_QUESTIONNAIRES[req.params.milestoneType];
  if (!template) return res.status(404).json({ error: 'Type de bilan inconnu' });
  res.json(template);
});

// POST /api/insertion/milestones/:employeeId/initialize — Creer tous les jalons d'un parcours
router.post('/milestones/:employeeId/initialize', async (req, res) => {
  try {
    const empId = req.params.employeeId;
    const emp = await pool.query('SELECT insertion_start_date FROM employees WHERE id = $1', [empId]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Employe non trouve' });

    const startDate = emp.rows[0].insertion_start_date || new Date().toISOString().split('T')[0];
    function addMonths(dateStr, months) {
      const d = new Date(dateStr);
      d.setMonth(d.getMonth() + months);
      return d.toISOString().split('T')[0];
    }
    const milestonesDef = [
      { type: 'Diagnostic accueil', months: 1 },
      { type: 'Bilan M+3', months: 3 },
      { type: 'Bilan M+6', months: 6 },
      { type: 'Bilan M+10', months: 10 },
      { type: 'Bilan Sortie', months: 12 },
    ];

    // Insert milestones one by one (pas de ON CONFLICT pour éviter problème de contrainte UNIQUE manquante)
    const results = [];
    for (const ms of milestonesDef) {
      const dueDate = addMonths(startDate, ms.months);
      // Vérifier si le jalon existe déjà
      const existing = await pool.query(
        'SELECT * FROM insertion_milestones WHERE employee_id = $1 AND milestone_type = $2',
        [empId, ms.type]
      );
      if (existing.rows.length > 0) {
        results.push(existing.rows[0]);
      } else {
        const ins = await pool.query(
          `INSERT INTO insertion_milestones (employee_id, milestone_type, due_date, created_by)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [empId, ms.type, dueDate, req.user.id]
        );
        results.push(ins.rows[0]);
      }
    }

    res.status(201).json(results);
  } catch (err) {
    console.error('[INSERTION] Erreur initialize milestones :', err);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// PLAN D'ACTION CIP
// ══════════════════════════════════════════════════════════════

// GET /api/insertion/action-plans/:employeeId — Tous les plans d'action
router.get('/action-plans/:employeeId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ap.*, im.milestone_type
       FROM cip_action_plans ap
       JOIN insertion_milestones im ON ap.milestone_id = im.id
       WHERE ap.employee_id = $1
       ORDER BY ap.priority DESC, ap.created_at`,
      [req.params.employeeId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[INSERTION] Erreur action-plans GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/insertion/action-plans — Creer une action
router.post('/action-plans', [
  body('milestone_id').isInt().withMessage('ID jalon requis'),
  body('employee_id').isInt().withMessage('ID employé requis'),
  body('action_label').notEmpty().withMessage('Libellé de l\'action requis'),
  body('category').notEmpty().withMessage('Catégorie requise'),
], validate, async (req, res) => {
  try {
    const { milestone_id, employee_id, action_label, category, frein_type, priority, echeance, notes } = req.body;
    const result = await pool.query(
      `INSERT INTO cip_action_plans (milestone_id, employee_id, action_label, category, frein_type, priority, echeance, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [milestone_id, employee_id, action_label, category, frein_type || null, priority || 'moyenne', echeance || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[INSERTION] Erreur action-plans POST :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/insertion/action-plans/:id — Mettre a jour une action
router.put('/action-plans/:id', async (req, res) => {
  try {
    const d = req.body;
    const result = await pool.query(
      `UPDATE cip_action_plans SET
        action_label = COALESCE($1, action_label),
        status = COALESCE($2, status),
        priority = COALESCE($3, priority),
        echeance = COALESCE($4, echeance),
        notes = COALESCE($5, notes),
        updated_at = NOW()
      WHERE id = $6 RETURNING *`,
      [d.action_label, d.status, d.priority, d.echeance, d.notes, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Action non trouvee' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[INSERTION] Erreur action-plans PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/insertion/action-plans/:id
router.delete('/action-plans/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM cip_action_plans WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[INSERTION] Erreur action-plans DELETE :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/timeline/:employeeId — Timeline du parcours
router.get('/timeline/:employeeId', async (req, res) => {
  try {
    const empId = req.params.employeeId;
    const empRes = await pool.query(
      'SELECT e.*, ec.start_date, ec.end_date, ec.contract_type FROM employees e LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = true WHERE e.id = $1',
      [empId]
    );
    if (empRes.rows.length === 0) return res.status(404).json({ error: 'Employe non trouve' });

    const msRes = await pool.query('SELECT * FROM insertion_milestones WHERE employee_id = $1 ORDER BY due_date', [empId]);
    let diagnostic = null;
    try {
      const diagRes = await pool.query('SELECT created_at FROM insertion_diagnostics WHERE employee_id = $1', [empId]);
      diagnostic = diagRes.rows[0] || null;
    } catch (err) { console.warn('[INSERTION] Timeline diagnostic:', err.message); }

    const timeline = buildTimeline(empRes.rows[0], [empRes.rows[0]], msRes.rows, diagnostic);
    res.json(timeline);
  } catch (err) {
    console.error('[INSERTION] Erreur timeline :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/insertion/:employeeId — Analyse complete d'un salarié
// IMPORTANT: DOIT etre la DERNIERE route GET car /:employeeId capture tout
// ══════════════════════════════════════════════════════════════
router.get('/:employeeId', async (req, res) => {
  try {
    const empId = req.params.employeeId;

    // 1. Données employé
    const empRes = await pool.query(`
      SELECT e.*, t.name as team_name, p.title as position_title
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN positions p ON p.title = e.position
      WHERE e.id = $1
    `, [empId]);
    if (empRes.rows.length === 0) return res.status(404).json({ error: 'Employé non trouvé' });
    const employee = empRes.rows[0];

    // 2. Contrats
    let contractsRes = { rows: [] };
    try {
      contractsRes = await pool.query(
        'SELECT ec.*, t.name as team_name, p.title as position_title FROM employee_contracts ec LEFT JOIN teams t ON ec.team_id = t.id LEFT JOIN positions p ON ec.position_id = p.id WHERE ec.employee_id = $1 ORDER BY ec.start_date DESC',
        [empId]
      );
    } catch (err) { /* table might not exist */ }

    // 3. Candidat (par nom ou candidate_id)
    let candidate = null;
    try {
      if (employee.candidate_id) {
        const candRes = await pool.query('SELECT * FROM candidates WHERE id = $1', [employee.candidate_id]);
        candidate = candRes.rows[0] || null;
      }
      if (!candidate) {
        const candRes = await pool.query(
          'SELECT * FROM candidates WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2) ORDER BY created_at DESC LIMIT 1',
          [employee.first_name, employee.last_name]
        );
        candidate = candRes.rows[0] || null;
      }
    } catch (err) { /* table might not exist */ }

    // 4. Rapport PCM
    let pcmReport = null;
    if (candidate) {
      try {
        const pcmRes = await pool.query(
          'SELECT encrypted_report FROM pcm_reports WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1',
          [candidate.id]
        );
        if (pcmRes.rows[0]?.encrypted_report) {
          const bytes = CryptoJS.AES.decrypt(pcmRes.rows[0].encrypted_report, PCM_KEY);
          pcmReport = bytes.toString(CryptoJS.enc.Utf8);
        }
      } catch (err) { /* pcm might not exist */ }
    }

    // 5. Membres de l'équipe
    let teamMembers = [];
    if (employee.team_id) {
      try {
        const teamRes = await pool.query(
          'SELECT id, first_name, last_name FROM employees WHERE team_id = $1 AND is_active = true AND id != $2',
          [employee.team_id, empId]
        );
        teamMembers = teamRes.rows;
      } catch (err) { /* ignore */ }
    }

    // 6. Position
    let position = null;
    const currentContract = contractsRes.rows.find(c => c.is_current);
    if (currentContract?.position_id) {
      try {
        const posRes = await pool.query('SELECT * FROM positions WHERE id = $1', [currentContract.position_id]);
        position = posRes.rows[0] || null;
      } catch (err) { /* ignore */ }
    }

    // 7. Diagnostic CIP
    let diagnostic = null;
    try {
      const diagRes = await pool.query('SELECT * FROM insertion_diagnostics WHERE employee_id = $1', [empId]);
      diagnostic = diagRes.rows[0] || null;
    } catch (err) { /* table might not exist yet */ }

    // 8. Jalons insertion
    let milestones = [];
    try {
      const msRes = await pool.query(
        'SELECT * FROM insertion_milestones WHERE employee_id = $1 ORDER BY due_date', [empId]
      );
      milestones = msRes.rows;
    } catch (err) { /* table might not exist yet */ }

    // 9. Plan d'action CIP
    let actionPlans = [];
    try {
      const apRes = await pool.query(
        'SELECT * FROM cip_action_plans WHERE employee_id = $1 ORDER BY created_at', [empId]
      );
      actionPlans = apRes.rows;
    } catch (err) { /* table might not exist yet */ }

    // 10. Analyse complete
    const analysis = analyzeInsertion(
      employee, contractsRes.rows, candidate, pcmReport,
      teamMembers, position, diagnostic, milestones
    );

    // 11. Timeline du parcours
    const timeline = buildTimeline(employee, contractsRes.rows, milestones, diagnostic);

    res.json({
      employee: {
        id: employee.id,
        first_name: employee.first_name,
        last_name: employee.last_name,
        team_name: employee.team_name,
        position: employee.position,
        is_active: employee.is_active,
        insertion_start_date: employee.insertion_start_date,
        insertion_status: employee.insertion_status,
      },
      has_pcm: !!pcmReport,
      has_candidate_data: !!candidate,
      has_cv: !!candidate?.cv_raw_text,
      has_interview: !!candidate?.interview_comment,
      has_diagnostic: !!diagnostic,
      nb_contracts: contractsRes.rows.length,
      milestones,
      action_plans: actionPlans,
      timeline,
      ...analysis,
    });
  } catch (err) {
    console.error('[INSERTION] Erreur analyse :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// ANALYSE IA — Endpoints utilisant Claude pour l'insertion
// ══════════════════════════════════════════════════════════════

// GET /api/insertion/ia/profil/:employeeId — Analyse approfondie IA du profil
router.get('/ia/profil/:employeeId', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { analyseProfilComplet } = require('../../services/insertion-ai');
    const result = await analyseProfilComplet(parseInt(req.params.employeeId));
    res.json(result);
  } catch (err) {
    console.error('[INSERTION] Erreur analyse IA profil :', err);
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: 'Service IA non configuré' });
    }
    res.status(500).json({ error: 'Erreur analyse IA' });
  }
});

// GET /api/insertion/ia/entretien/:employeeId — Guide d'entretien adapté PCM
router.get('/ia/entretien/:employeeId', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { preparerEntretien } = require('../../services/insertion-ai');
    const milestoneType = req.query.type || 'Bilan M+3';
    const result = await preparerEntretien(parseInt(req.params.employeeId), milestoneType);
    res.json(result);
  } catch (err) {
    console.error('[INSERTION] Erreur entretien IA :', err);
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: 'Service IA non configuré' });
    }
    res.status(500).json({ error: 'Erreur analyse IA' });
  }
});

// GET /api/insertion/ia/cohorte — Bilan global de la cohorte en insertion
router.get('/ia/cohorte', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { bilanCohorte } = require('../../services/insertion-ai');
    const result = await bilanCohorte();
    res.json(result);
  } catch (err) {
    console.error('[INSERTION] Erreur bilan cohorte IA :', err);
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: 'Service IA non configuré' });
    }
    res.status(500).json({ error: 'Erreur analyse IA' });
  }
});

module.exports = router;

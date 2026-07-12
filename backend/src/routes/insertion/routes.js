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
const { FREINS_DEFINITIONS, CIP_QUESTIONNAIRES, analyzeInsertion, buildTimeline, computeMilestoneSchedule } = require('./engine');
const { autoLogActivity } = require('../../middleware/activity-logger');

const PCM_KEY = process.env.PCM_ENCRYPTION_KEY || process.env.JWT_SECRET;
if (!PCM_KEY) {
  console.error('[FATAL] PCM_ENCRYPTION_KEY et JWT_SECRET non définis. Arrêt immédiat.');
  process.exit(1);
}

router.use(autoLogActivity('insertion'));

// Crée (idempotent) les jalons d'un salarié en calant les échéances sur son
// contrat réel. Réutilisé par l'endpoint /initialize et par l'auto-init.
async function generateMilestones(db, employeeId, userId) {
  const empRes = await db.query(
    `SELECT e.insertion_start_date, e.contract_start, e.contract_end,
            ec.start_date AS c_start, ec.end_date AS c_end
     FROM employees e
     LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = true
     WHERE e.id = $1`,
    [employeeId]
  );
  if (empRes.rows.length === 0) return [];
  const r = empRes.rows[0];
  const start = r.insertion_start_date || r.c_start || r.contract_start || new Date();
  const end = r.c_end || r.contract_end || null;
  const schedule = computeMilestoneSchedule(start, end);

  const results = [];
  for (const d of schedule) {
    const existing = await db.query(
      'SELECT * FROM insertion_milestones WHERE employee_id = $1 AND milestone_type = $2',
      [employeeId, d.type]
    );
    if (existing.rows.length > 0) { results.push(existing.rows[0]); continue; }
    const ins = await db.query(
      `INSERT INTO insertion_milestones (employee_id, milestone_type, due_date, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [employeeId, d.type, d.due, userId || null]
    );
    results.push(ins.rows[0]);
  }
  return results;
}

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
    res.status(500).json({ error: 'Erreur serveur' });
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
      d.frein_mobilite || null, d.frein_mobilite_detail || null, d.frein_mobilite_causes || null,
      d.frein_sante || null, d.frein_sante_detail || null, d.frein_sante_causes || null,
      d.frein_finances || null, d.frein_finances_detail || null, d.frein_finances_causes || null,
      d.frein_famille || null, d.frein_famille_detail || null, d.frein_famille_causes || null,
      d.frein_linguistique || null, d.frein_linguistique_detail || null, d.frein_linguistique_causes || null,
      d.frein_administratif || null, d.frein_administratif_detail || null, d.frein_administratif_causes || null,
      d.frein_numerique || null, d.frein_numerique_detail || null, d.frein_numerique_causes || null,
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
    // On expose le code SQLSTATE (sans détail sensible) pour rendre l'erreur
    // diagnosticable ; 42703 = colonne manquante (base non migrée).
    const hint = err.code === '42703'
      ? 'Base non à jour (colonne manquante) — un redéploiement applique la migration.'
      : undefined;
    res.status(500).json({ error: 'Erreur serveur', code: err.code, hint });
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
        sortie_employeur_siret = COALESCE($28, sortie_employeur_siret),
        sortie_duree_contrat_mois = COALESCE($29, sortie_duree_contrat_mois),
        ai_recommendations = COALESCE($30, ai_recommendations),
        updated_at = NOW()
      WHERE id = $31 RETURNING *`,
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
        d.sortie_employeur_siret, d.sortie_duree_contrat_mois,
        d.ai_recommendations ? JSON.stringify(d.ai_recommendations) : null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Jalon non trouve' });
    const ms = result.rows[0];

    // Clôture du parcours d'insertion à la sortie : quand le « Bilan Sortie » est
    // marqué réalisé, on solde le parcours du salarié (insertion_status='termine'
    // + insertion_end_date) — sinon les cohortes double-comptent les sortis.
    // Idempotent : ne réactive pas un parcours déjà terminé et n'écrase pas une
    // date de sortie déjà posée (date = date de bilan réalisé, repli fin de contrat).
    if (ms.milestone_type === 'Bilan Sortie' && ms.status === 'realise') {
      await pool.query(
        `UPDATE employees
           SET insertion_status = 'termine',
               insertion_end_date = COALESCE(insertion_end_date, $2::date, contract_end, CURRENT_DATE),
               updated_at = NOW()
         WHERE id = $1 AND insertion_status <> 'termine'`,
        [ms.employee_id, ms.completed_date || null]
      );
    } else if (ms.milestone_type === 'Bilan Sortie' && d.status && d.status !== 'realise') {
      // Retour arrière : le bilan de sortie n'est plus « réalisé » → rouvre le
      // parcours précédemment clôturé par ce jalon (ne touche pas abandon/none).
      await pool.query(
        `UPDATE employees
           SET insertion_status = 'en_parcours', insertion_end_date = NULL, updated_at = NOW()
         WHERE id = $1 AND insertion_status = 'termine'`,
        [ms.employee_id]
      );
    }

    res.json(ms);
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
      'SELECT frein_mobilite, frein_sante, frein_finances, frein_famille, frein_linguistique, frein_administratif, frein_numerique FROM insertion_diagnostics WHERE employee_id = $1',
      [empId]
    );

    // Jalons réalisés avec scores
    const milestonesRes = await pool.query(
      `SELECT milestone_type, completed_date,
        frein_mobilite, frein_sante, frein_finances, frein_famille, frein_linguistique, frein_administratif, frein_numerique
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
    const emp = await pool.query(
      `SELECT e.insertion_status, e.insertion_start_date, e.contract_start,
              ec.start_date AS c_start
       FROM employees e
       LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = true
       WHERE e.id = $1`,
      [empId]
    );
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Employe non trouve' });
    const e = emp.rows[0];

    // Un seul geste : démarrer le parcours ET poser les jalons.
    // insertion_start_date par défaut = début de contrat (sinon aujourd'hui).
    const startDate = e.insertion_start_date || e.c_start || e.contract_start || new Date().toISOString().split('T')[0];
    await pool.query(
      `UPDATE employees SET
         insertion_status = CASE WHEN insertion_status IN ('termine','abandon') THEN insertion_status ELSE 'en_parcours' END,
         insertion_start_date = COALESCE(insertion_start_date, $2),
         updated_at = NOW()
       WHERE id = $1`,
      [empId, startDate]
    );

    const results = await generateMilestones(pool, empId, req.user.id);
    res.status(201).json(results);
  } catch (err) {
    console.error('[INSERTION] Erreur initialize milestones :', err);
    res.status(500).json({ error: 'Erreur serveur' });
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
// GET /api/insertion/cohorte/stats — Tableau de bord CIP (algorithmique)
// Toujours disponible (sans dépendance IA) : retards, à-venir, risques,
// répartition des freins, taux de sorties dynamiques.
// IMPORTANT: AVANT /:employeeId.
// ══════════════════════════════════════════════════════════════
router.get('/cohorte/stats', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    // Filtre « mes salariés » (item 61b) : restreint la cohorte au référent CIP courant.
    const mine = req.query.mine === '1' || req.query.mine === 'true';
    const refId = mine ? req.user.id : null;

    // Cohorte active
    const cohorteParams = [];
    let cohorteFilter = '';
    if (mine) { cohorteParams.push(refId); cohorteFilter = ` AND e.cip_referent_user_id = $${cohorteParams.length}`; }
    const cohorte = await pool.query(`
      SELECT e.id, e.first_name, e.last_name, e.insertion_start_date,
             ec.end_date AS contract_end
      FROM employees e
      LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = true
      WHERE e.insertion_status = 'en_parcours' AND e.is_active = true${cohorteFilter}
    `, cohorteParams);

    // Jalons non réalisés des salariés en parcours
    const jalonsParams = [];
    let jalonsFilter = '';
    if (mine) { jalonsParams.push(refId); jalonsFilter = ` AND e.cip_referent_user_id = $${jalonsParams.length}`; }
    const jalons = await pool.query(`
      SELECT im.id, im.employee_id, im.milestone_type, im.due_date, im.status,
             e.first_name, e.last_name,
             (im.due_date - CURRENT_DATE) AS days_until
      FROM insertion_milestones im
      JOIN employees e ON im.employee_id = e.id
      WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
        AND im.status <> 'realise'${jalonsFilter}
      ORDER BY im.due_date
    `, jalonsParams);
    const enRetard = jalons.rows.filter((j) => j.days_until < 0);
    const aVenir7 = jalons.rows.filter((j) => j.days_until >= 0 && j.days_until <= 7);
    // Agenda « Mes prochains entretiens » : jalons non réalisés à échéance dans
    // les 30 prochains jours, triés par date (item 61a).
    const agenda30 = jalons.rows.filter((j) => j.days_until >= 0 && j.days_until <= 30);

    // Salariés à risque : fin de contrat dans 60 jours
    const now = Date.now();
    const aRisque = cohorte.rows
      .filter((c) => c.contract_end)
      .map((c) => ({ id: c.id, first_name: c.first_name, last_name: c.last_name, contract_end: c.contract_end, days: Math.round((new Date(c.contract_end) - now) / 86400000) }))
      .filter((c) => c.days <= 60)
      .sort((a, b) => a.days - b.days);

    // Répartition des freins : dernière évaluation par salarié (jalon réalisé, sinon diagnostic)
    const axes = ['frein_mobilite', 'frein_sante', 'frein_finances', 'frein_famille', 'frein_linguistique', 'frein_administratif', 'frein_numerique'];
    const freinsParams = [];
    let freinsFilter = '';
    if (mine) { freinsParams.push(refId); freinsFilter = ` AND e.cip_referent_user_id = $${freinsParams.length}`; }
    const freinsRows = await pool.query(`
      WITH last_ms AS (
        SELECT DISTINCT ON (im.employee_id) im.employee_id,
          im.frein_mobilite, im.frein_sante, im.frein_finances, im.frein_famille,
          im.frein_linguistique, im.frein_administratif, im.frein_numerique
        FROM insertion_milestones im
        JOIN employees e ON e.id = im.employee_id
        WHERE e.insertion_status='en_parcours' AND e.is_active=true
          AND im.status='realise' AND im.frein_mobilite IS NOT NULL${freinsFilter}
        ORDER BY im.employee_id, im.due_date DESC
      ),
      diag AS (
        SELECT d.employee_id, d.frein_mobilite, d.frein_sante, d.frein_finances, d.frein_famille,
          d.frein_linguistique, d.frein_administratif, d.frein_numerique
        FROM insertion_diagnostics d
        JOIN employees e ON e.id=d.employee_id
        WHERE e.insertion_status='en_parcours' AND e.is_active=true${freinsFilter}
      )
      SELECT COALESCE(lm.employee_id, dg.employee_id) AS employee_id,
        COALESCE(lm.frein_mobilite, dg.frein_mobilite) AS frein_mobilite,
        COALESCE(lm.frein_sante, dg.frein_sante) AS frein_sante,
        COALESCE(lm.frein_finances, dg.frein_finances) AS frein_finances,
        COALESCE(lm.frein_famille, dg.frein_famille) AS frein_famille,
        COALESCE(lm.frein_linguistique, dg.frein_linguistique) AS frein_linguistique,
        COALESCE(lm.frein_administratif, dg.frein_administratif) AS frein_administratif,
        COALESCE(lm.frein_numerique, dg.frein_numerique) AS frein_numerique
      FROM diag dg FULL OUTER JOIN last_ms lm ON lm.employee_id = dg.employee_id
    `);
    const freinsMoyennes = {};
    let freinDominant = null, maxMoy = 0;
    for (const axe of axes) {
      const vals = freinsRows.rows.map((r) => r[axe]).filter((v) => v != null && +v >= 1);
      const moy = vals.length ? +(vals.reduce((a, b) => a + +b, 0) / vals.length).toFixed(2) : null;
      freinsMoyennes[axe] = moy;
      if (moy && moy > maxMoy) { maxMoy = moy; freinDominant = axe; }
    }

    // Taux de sorties dynamiques sur l'année
    const sorties = await pool.query(`
      SELECT sortie_classification, sortie_type, COUNT(*)::int AS n
      FROM insertion_milestones
      WHERE milestone_type = 'Bilan Sortie' AND status = 'realise'
        AND sortie_classification IS NOT NULL
        AND COALESCE(completed_date, updated_at::date) BETWEEN $1 AND $2
      GROUP BY sortie_classification, sortie_type
    `, [`${year}-01-01`, `${year}-12-31`]);
    let nbPositives = 0, nbNegatives = 0;
    const parType = {};
    for (const s of sorties.rows) {
      if (s.sortie_classification === 'positive') nbPositives += s.n; else nbNegatives += s.n;
      if (s.sortie_type) parType[s.sortie_type] = (parType[s.sortie_type] || 0) + s.n;
    }
    const totalSorties = nbPositives + nbNegatives;

    // Objectif conventionné DREETS (item 61c) : taux de sorties dynamiques cible,
    // stocké en settings. Toujours structure-wide (indépendant du filtre « mine »).
    const objectifSorties = await readObjectifSorties();

    res.json({
      annee: year,
      mine,
      nb_actifs: cohorte.rows.length,
      nb_jalons_en_retard: enRetard.length,
      nb_jalons_a_venir: aVenir7.length,
      taux_retard_jalons: jalons.rows.length ? Math.round((enRetard.length / jalons.rows.length) * 100) : 0,
      jalons_en_retard: enRetard,
      jalons_a_venir_7j: aVenir7,
      agenda_30j: agenda30,
      salaries_a_risque: aRisque,
      freins_moyennes: freinsMoyennes,
      frein_dominant: freinDominant,
      objectif_sorties_dynamiques: objectifSorties,
      sorties: {
        total: totalSorties,
        positives: nbPositives,
        negatives: nbNegatives,
        taux_dynamiques: totalSorties > 0 ? Math.round((nbPositives / totalSorties) * 100) : null,
        par_type: parType,
      },
    });
  } catch (err) {
    console.error('[INSERTION] Erreur cohorte stats :', err.message, err.detail || '');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Lit l'objectif conventionné de sorties dynamiques (%) depuis settings.
// Clé : insertion.objectif_sorties_dynamiques. Résilient (retourne null si absent).
const OBJECTIF_SORTIES_KEY = 'insertion.objectif_sorties_dynamiques';
async function readObjectifSorties() {
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [OBJECTIF_SORTIES_KEY]);
    const v = r.rows[0]?.value;
    if (v == null || v === '') return null;
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  } catch (_) { return null; }
}

// GET /api/insertion/objectif-sorties — Objectif conventionné DREETS (%). IMPORTANT: avant /:employeeId.
router.get('/objectif-sorties', async (req, res) => {
  res.json({ objectif: await readObjectifSorties() });
});

// PUT /api/insertion/objectif-sorties — Éditer l'objectif (ADMIN/RH). { objectif: number|null }
router.put('/objectif-sorties', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const raw = req.body?.objectif;
    const num = (raw === null || raw === undefined || raw === '') ? null : parseFloat(raw);
    if (num != null && (Number.isNaN(num) || num < 0 || num > 100)) {
      return res.status(400).json({ error: 'Objectif invalide (attendu : un pourcentage entre 0 et 100).' });
    }
    await pool.query(
      `INSERT INTO settings (key, value, category, updated_at)
       VALUES ($1, $2, 'insertion', NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [OBJECTIF_SORTIES_KEY, num == null ? null : String(num)]
    );
    res.json({ objectif: num });
  } catch (err) {
    console.error('[INSERTION] Erreur objectif-sorties PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/cip-referents — Utilisateurs RH/ADMIN actifs (sélecteur de
// CIP référent). IMPORTANT: avant /:employeeId.
router.get('/cip-referents', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, first_name, last_name, role
       FROM users
       WHERE COALESCE(is_active, true) = true AND role IN ('ADMIN', 'RH')
       ORDER BY last_name NULLS LAST, first_name NULLS LAST`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[INSERTION] Erreur cip-referents :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// AUDIT INSERTION — Synthèse de la situation d'insertion de la structure
// ══════════════════════════════════════════════════════════════

const MILESTONE_ORDER = ['Diagnostic accueil', 'Bilan M+3', 'Bilan M+6', 'Bilan M+10', 'Bilan Sortie'];
const FREIN_AXES = ['frein_mobilite', 'frein_sante', 'frein_finances', 'frein_famille', 'frein_linguistique', 'frein_administratif', 'frein_numerique'];

// Agrège les indicateurs chiffrés de l'audit. Résilient : chaque requête qui
// échoue (colonne absente sur base ancienne) dégrade au lieu de tout casser.
async function gatherAuditKpis(year) {
  const soft = async (label, text, params = []) => {
    try { return (await pool.query(text, params)).rows; }
    catch (err) { console.error(`[INSERTION][AUDIT] « ${label} » ignorée (${err.code || '?'}) : ${err.message}`); return []; }
  };

  // Nombre de salariés en parcours
  const enParcours = await soft('en_parcours',
    `SELECT COUNT(*)::int AS n FROM employees WHERE insertion_status = 'en_parcours' AND is_active = true`);
  const nbEnParcours = enParcours[0]?.n || 0;

  // Taux de réalisation des jalons par type (échéance)
  const msRows = await soft('milestones', `
    SELECT im.milestone_type AS type,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE im.due_date <= CURRENT_DATE)::int AS echus,
      COUNT(*) FILTER (WHERE im.status = 'realise')::int AS realises,
      COUNT(*) FILTER (WHERE im.status = 'realise' AND im.due_date <= CURRENT_DATE)::int AS realises_echus
    FROM insertion_milestones im
    JOIN employees e ON e.id = im.employee_id
    WHERE e.is_active = true
    GROUP BY im.milestone_type`);
  const msByType = {};
  for (const r of msRows) msByType[r.type] = r;
  const milestonesParType = MILESTONE_ORDER.map((type) => {
    const r = msByType[type] || { total: 0, echus: 0, realises: 0, realises_echus: 0 };
    return {
      type,
      total: r.total, echus: r.echus, realises: r.realises, realises_echus: r.realises_echus,
      taux_echeance: r.echus ? Math.round((r.realises_echus / r.echus) * 100) : null,
    };
  });
  const g = milestonesParType.reduce((a, m) => ({
    total: a.total + m.total, echus: a.echus + m.echus,
    realises: a.realises + m.realises, realises_echus: a.realises_echus + m.realises_echus,
  }), { total: 0, echus: 0, realises: 0, realises_echus: 0 });
  const milestonesGlobal = { ...g, taux: g.echus ? Math.round((g.realises_echus / g.echus) * 100) : null };

  // Freins consolidés (dernière éval par salarié : jalon réalisé sinon diagnostic)
  const freinsRows = await soft('freins', `
    WITH last_ms AS (
      SELECT DISTINCT ON (im.employee_id) im.employee_id,
        im.frein_mobilite, im.frein_sante, im.frein_finances, im.frein_famille,
        im.frein_linguistique, im.frein_administratif, im.frein_numerique
      FROM insertion_milestones im
      JOIN employees e ON e.id = im.employee_id
      WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
        AND im.status = 'realise' AND im.frein_mobilite IS NOT NULL
      ORDER BY im.employee_id, im.due_date DESC
    ),
    diag AS (
      SELECT d.employee_id, d.frein_mobilite, d.frein_sante, d.frein_finances, d.frein_famille,
        d.frein_linguistique, d.frein_administratif, d.frein_numerique
      FROM insertion_diagnostics d
      JOIN employees e ON e.id = d.employee_id
      WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
    )
    SELECT COALESCE(lm.frein_mobilite, dg.frein_mobilite) AS frein_mobilite,
      COALESCE(lm.frein_sante, dg.frein_sante) AS frein_sante,
      COALESCE(lm.frein_finances, dg.frein_finances) AS frein_finances,
      COALESCE(lm.frein_famille, dg.frein_famille) AS frein_famille,
      COALESCE(lm.frein_linguistique, dg.frein_linguistique) AS frein_linguistique,
      COALESCE(lm.frein_administratif, dg.frein_administratif) AS frein_administratif,
      COALESCE(lm.frein_numerique, dg.frein_numerique) AS frein_numerique
    FROM diag dg FULL OUTER JOIN last_ms lm ON lm.employee_id = dg.employee_id`);
  const freinsMoyennes = {};
  let freinDominant = null, maxMoy = 0, nbEvalues = 0;
  for (const axe of FREIN_AXES) {
    const vals = freinsRows.map((r) => r[axe]).filter((v) => v != null && +v >= 1);
    if (vals.length > nbEvalues) nbEvalues = vals.length;
    const moy = vals.length ? +(vals.reduce((a, b) => a + +b, 0) / vals.length).toFixed(2) : null;
    freinsMoyennes[axe] = moy;
    if (moy && moy > maxMoy) { maxMoy = moy; freinDominant = axe; }
  }

  // Plans d'action en cours
  const actRows = await soft('actions', `
    SELECT a.status, a.category, a.priority, COUNT(*)::int AS n
    FROM cip_action_plans a
    JOIN employees e ON e.id = a.employee_id
    WHERE e.is_active = true AND a.status IN ('a_faire', 'en_cours')
    GROUP BY a.status, a.category, a.priority`);
  const actions = { total_en_cours: 0, par_statut: {}, par_categorie: {}, par_priorite: {} };
  for (const r of actRows) {
    actions.total_en_cours += r.n;
    actions.par_statut[r.status] = (actions.par_statut[r.status] || 0) + r.n;
    if (r.category) actions.par_categorie[r.category] = (actions.par_categorie[r.category] || 0) + r.n;
    if (r.priority) actions.par_priorite[r.priority] = (actions.par_priorite[r.priority] || 0) + r.n;
  }

  // Sorties de l'année + statistiques
  const sortiesRows = await soft('sorties', `
    SELECT sortie_classification, sortie_type, COUNT(*)::int AS n
    FROM insertion_milestones
    WHERE milestone_type = 'Bilan Sortie' AND status = 'realise'
      AND sortie_classification IS NOT NULL
      AND COALESCE(completed_date, updated_at::date) BETWEEN $1 AND $2
    GROUP BY sortie_classification, sortie_type`, [`${year}-01-01`, `${year}-12-31`]);
  let nbPositives = 0, nbNegatives = 0;
  const parType = {};
  for (const s of sortiesRows) {
    if (s.sortie_classification === 'positive') nbPositives += s.n; else nbNegatives += s.n;
    if (s.sortie_type) parType[s.sortie_type] = (parType[s.sortie_type] || 0) + s.n;
  }
  const totalSorties = nbPositives + nbNegatives;

  return {
    annee: year,
    nb_en_parcours: nbEnParcours,
    freins_nb_evalues: nbEvalues,
    milestones: { par_type: milestonesParType, global: milestonesGlobal },
    freins_moyennes: freinsMoyennes,
    frein_dominant: freinDominant,
    actions,
    sorties: {
      total: totalSorties, positives: nbPositives, negatives: nbNegatives,
      taux_dynamiques: totalSorties > 0 ? Math.round((nbPositives / totalSorties) * 100) : null,
      par_type: parType,
    },
  };
}

// Collecte les verbatims (anonymisés) des CIP/agents pour le rapport IA.
async function gatherAuditVerbatims() {
  const soft = async (text) => { try { return (await pool.query(text)).rows; } catch { return []; } };
  const observations = await soft(`
    SELECT d.obs_points_forts, d.obs_difficultes, d.obs_comportement_equipe, d.parcours_anterieur
    FROM insertion_diagnostics d JOIN employees e ON e.id = d.employee_id
    WHERE e.is_active = true
      AND (d.obs_points_forts IS NOT NULL OR d.obs_difficultes IS NOT NULL OR d.obs_comportement_equipe IS NOT NULL)
    LIMIT 60`);
  const bilans = await soft(`
    SELECT im.milestone_type, im.avis_global, im.bilan_professionnel, im.bilan_social, im.observations
    FROM insertion_milestones im JOIN employees e ON e.id = im.employee_id
    WHERE e.is_active = true AND im.status = 'realise'
      AND (im.bilan_professionnel IS NOT NULL OR im.bilan_social IS NOT NULL OR im.observations IS NOT NULL)
    ORDER BY im.completed_date DESC NULLS LAST LIMIT 80`);
  const notesActions = await soft(`
    SELECT a.category, a.notes FROM cip_action_plans a JOIN employees e ON e.id = a.employee_id
    WHERE e.is_active = true AND a.notes IS NOT NULL AND a.notes <> '' LIMIT 60`);
  return { observations_diagnostics: observations, bilans_jalons: bilans, notes_actions: notesActions };
}

// GET /api/insertion/audit — Indicateurs chiffrés de l'audit (sans IA).
// IMPORTANT: AVANT /:employeeId.
router.get('/audit', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    res.json(await gatherAuditKpis(year));
  } catch (err) {
    console.error('[INSERTION][AUDIT] Erreur :', err.message);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
});

// GET /api/insertion/audit/ia — Rapport IA de situation globale (ADMIN/RH).
// Croise indicateurs chiffrés + verbatims anonymisés CIP/agents.
router.get('/audit/ia', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const [kpis, verbatims] = await Promise.all([gatherAuditKpis(year), gatherAuditVerbatims()]);
    const { auditGlobalReport } = require('../../services/insertion-ai');
    res.json(await auditGlobalReport({ kpis, verbatims }));
  } catch (err) {
    handleIaError(res, err, 'audit');
  }
});

// PUT /api/insertion/:employeeId/cip-referent — Affecter/retirer le CIP référent
// (ADMIN/RH). Body : { user_id: number|null }. Valide que l'utilisateur est un
// référent RH/ADMIN actif. Chemin à 2 segments → non capturé par GET /:employeeId.
router.put('/:employeeId/cip-referent', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    if (Number.isNaN(empId)) return res.status(400).json({ error: 'ID employé invalide' });
    const raw = req.body?.user_id;
    let userId = null;
    if (raw !== null && raw !== undefined && raw !== '') {
      userId = parseInt(raw, 10);
      if (Number.isNaN(userId)) return res.status(400).json({ error: 'user_id invalide' });
      const u = await pool.query(
        `SELECT id FROM users WHERE id = $1 AND COALESCE(is_active, true) = true AND role IN ('ADMIN', 'RH')`,
        [userId]
      );
      if (u.rows.length === 0) return res.status(400).json({ error: 'Référent invalide (doit être un utilisateur RH/ADMIN actif).' });
    }
    const r = await pool.query(
      `UPDATE employees SET cip_referent_user_id = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, cip_referent_user_id`,
      [userId, empId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Salarié non trouvé' });
    let nom = null;
    if (userId) {
      const n = await pool.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
      if (n.rows[0]) nom = `${n.rows[0].first_name || ''} ${n.rows[0].last_name || ''}`.trim();
    }
    res.json({ ...r.rows[0], cip_referent_nom: nom });
  } catch (err) {
    console.error('[INSERTION] Erreur cip-referent PUT :', err.message);
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

    // 1. Données employé (+ prescripteur / orienteur + CIP référent si rattaché)
    const empRes = await pool.query(`
      SELECT e.*, t.name as team_name, p.title as position_title,
             po.nom AS prescripteur_nom, po.type AS prescripteur_type,
             TRIM(CONCAT(cu.first_name, ' ', cu.last_name)) AS cip_referent_nom
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN positions p ON p.title = e.position
      LEFT JOIN prescripteur_orgas po ON po.id = e.prescripteur_id
      LEFT JOIN users cu ON cu.id = e.cip_referent_user_id
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
          if (!pcmReport && process.env.JWT_SECRET && PCM_KEY !== process.env.JWT_SECRET) {
            // Rapports historiques chiffrés avec JWT_SECRET (avant alignement clé PCM)
            const legacy = CryptoJS.AES.decrypt(pcmRes.rows[0].encrypted_report, process.env.JWT_SECRET);
            pcmReport = legacy.toString(CryptoJS.enc.Utf8);
          }
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

    // 8. Jalons insertion — auto-initialisés si le salarié est en parcours et
    // n'en a encore aucun (supprime le clic manuel « Initialiser jalons »).
    let milestones = [];
    try {
      const msRes = await pool.query(
        'SELECT * FROM insertion_milestones WHERE employee_id = $1 ORDER BY due_date', [empId]
      );
      milestones = msRes.rows;
      if (milestones.length === 0 && employee.insertion_status === 'en_parcours') {
        milestones = await generateMilestones(pool, empId, req.user.id);
      }
    } catch (err) { console.warn('[INSERTION] Jalons auto-init :', err.message); }

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
        contract_end: employee.contract_end,
        prescripteur: employee.prescripteur || null,
        prescripteur_nom: employee.prescripteur_nom || null,
        prescripteur_type: employee.prescripteur_type || null,
        cip_referent_user_id: employee.cip_referent_user_id || null,
        cip_referent_nom: employee.cip_referent_nom || null,
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

// Traduit une erreur du service IA (SDK Anthropic) en réponse diagnosticable.
// Endpoints ADMIN/RH → on peut exposer un indice technique (modèle/clé/quota).
function handleIaError(res, err, where) {
  const status = err.status || err.statusCode;
  console.error(`[INSERTION] Erreur IA ${where} :`, status || '', err.message);
  if (err.message?.includes('ANTHROPIC_API_KEY')) {
    return res.status(503).json({ error: "Service IA non configuré — clé ANTHROPIC_API_KEY absente côté serveur." });
  }
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
  let hint;
  if (status === 404 || /not[_ ]?found|model:/i.test(err.message || '')) {
    hint = `Le modèle IA « ${model} » n'est pas disponible pour cette clé API. Définissez CLAUDE_MODEL (dans le .env serveur) sur un modèle autorisé pour votre compte Anthropic, puis redémarrez le backend.`;
  } else if (status === 401 || /authentication|invalid.*api.?key|x-api-key/i.test(err.message || '')) {
    hint = "Clé ANTHROPIC_API_KEY invalide ou révoquée.";
  } else if (status === 429 || /rate.?limit|overloaded/i.test(err.message || '')) {
    hint = "Limite de débit / quota Anthropic atteinte — réessayez dans un instant.";
  }
  return res.status(500).json({ error: 'Erreur analyse IA', detail: err.message, hint });
}

// GET /api/insertion/ia/diagnostic — Sonde isolée de l'appel Anthropic.
// Ne dépend d'AUCUN salarié : teste purement clé + modèle + connectivité réseau,
// hors de toute logique de collecte de données. ADMIN/RH uniquement
// (expose le status HTTP + message bruts du SDK pour le diagnostic).
router.get('/ia/diagnostic', authorize('ADMIN', 'RH'), async (req, res) => {
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) {
    return res.json({ configured: false, model, ok: false, message: "ANTHROPIC_API_KEY absente côté serveur (variable non transmise au conteneur backend)." });
  }
  const t0 = Date.now();
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const probe = new Anthropic({ apiKey: key });
    const r = await probe.messages.create({
      model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return res.json({
      configured: true, ok: true, model,
      key_length: key.length,
      latency_ms: Date.now() - t0,
      reply: (r.content?.[0]?.text || '').slice(0, 40),
    });
  } catch (err) {
    const status = err.status || err.statusCode || null;
    console.error('[INSERTION] Diagnostic IA échec :', status || '', err.name, err.message);
    return res.json({
      configured: true, ok: false, model,
      key_length: key.length,
      latency_ms: Date.now() - t0,
      status,
      type: err.name || null,
      message: err.message || String(err),
    });
  }
});

// GET /api/insertion/ia/profil/:employeeId — Analyse approfondie IA du profil
router.get('/ia/profil/:employeeId', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { analyseProfilComplet } = require('../../services/insertion-ai');
    res.json(await analyseProfilComplet(parseInt(req.params.employeeId)));
  } catch (err) {
    handleIaError(res, err, 'profil');
  }
});

// GET /api/insertion/ia/entretien/:employeeId — Guide d'entretien adapté PCM
router.get('/ia/entretien/:employeeId', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { preparerEntretien } = require('../../services/insertion-ai');
    const milestoneType = req.query.type || 'Bilan M+3';
    res.json(await preparerEntretien(parseInt(req.params.employeeId), milestoneType));
  } catch (err) {
    handleIaError(res, err, 'entretien');
  }
});

// GET /api/insertion/ia/cohorte — Bilan global de la cohorte en insertion
router.get('/ia/cohorte', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { bilanCohorte } = require('../../services/insertion-ai');
    res.json(await bilanCohorte());
  } catch (err) {
    handleIaError(res, err, 'cohorte');
  }
});

module.exports = router;

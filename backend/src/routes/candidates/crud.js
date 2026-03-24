const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { getSkillPatterns, parseCVFile, extractFromCV } = require('./cv-engine');

// ══════════════════════════════════════════
// ROUTES CANDIDATES (liste, kanban, création, stats)
// ══════════════════════════════════════════

// GET /api/candidates — Liste avec filtres
router.get('/', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { status, search, team_id } = req.query;
    let query = `SELECT c.*, t.name as team_name FROM candidates c LEFT JOIN teams t ON c.assigned_team_id = t.id WHERE 1=1`;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND c.status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (c.first_name ILIKE $${params.length} OR c.last_name ILIKE $${params.length} OR c.email ILIKE $${params.length})`;
    }
    if (team_id) {
      params.push(team_id);
      query += ` AND c.assigned_team_id = $${params.length}`;
    }

    query += ' ORDER BY c.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[CANDIDATES] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/candidates/kanban — Groupé par statut
router.get('/kanban', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, t.name as team_name FROM candidates c
       LEFT JOIN teams t ON c.assigned_team_id = t.id
       ORDER BY c.updated_at DESC`
    );

    const kanban = {
      received: [],
      interview: [],
      hired: [],
      rejected: [],
    };

    result.rows.forEach(c => {
      // Migrer les anciens statuts supprimés
      const status = c.status === 'preselected' ? 'received' : c.status === 'test' ? 'interview' : c.status;
      if (kanban[status]) kanban[status].push({ ...c, status });
    });

    res.json(kanban);
  } catch (err) {
    console.error('[CANDIDATES] Erreur kanban :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates — Créer
router.post('/', authorize('ADMIN', 'RH'), [
  body('first_name').notEmpty().withMessage('Prénom requis'),
  body('last_name').notEmpty().withMessage('Nom requis'),
], validate, async (req, res) => {
  try {
    const { first_name, last_name, email, phone, gender, has_permis_b, has_caces, source_email, assigned_team_id } = req.body;

    const result = await pool.query(
      `INSERT INTO candidates (first_name, last_name, email, phone, gender, has_permis_b, has_caces, source_email, assigned_team_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [first_name, last_name, email, phone, gender, has_permis_b || false, has_caces || false, source_email, assigned_team_id]
    );

    // Historique
    await pool.query(
      'INSERT INTO candidate_history (candidate_id, to_status, comment, changed_by) VALUES ($1, $2, $3, $4)',
      [result.rows[0].id, 'received', 'Candidature créée', req.user.id]
    );

    // Compétences initiales (hardcodés + DB)
    const patterns = await getSkillPatterns();
    for (const skill of Object.keys(patterns)) {
      await pool.query(
        'INSERT INTO candidate_skills (candidate_id, skill_name, status, updated_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [result.rows[0].id, skill, 'not_mentioned', req.user.id]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/candidates/stats — KPIs recrutement
router.get('/stats', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const counts = await pool.query(
      `SELECT status, COUNT(*)::int as count FROM candidates GROUP BY status`
    );
    const total = await pool.query('SELECT COUNT(*)::int as count FROM candidates');
    const thisMonth = await pool.query(
      `SELECT COUNT(*)::int as count FROM candidates WHERE created_at >= date_trunc('month', NOW())`
    );
    const withPCM = await pool.query(
      `SELECT COUNT(DISTINCT candidate_id)::int as count FROM pcm_reports`
    );

    const byStatus = {};
    counts.rows.forEach(r => { byStatus[r.status] = r.count; });

    res.json({
      total: total.rows[0].count,
      thisMonth: thisMonth.rows[0].count,
      withPCM: withPCM.rows[0].count,
      byStatus,
    });
  } catch (err) {
    console.error('[CANDIDATES] Erreur stats :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/upload-cv-new — Upload CV → créer nouveau candidat
// IMPORTANT: must be declared BEFORE /:id routes to avoid Express matching "upload-cv-new" as :id
router.post('/upload-cv-new', authorize('ADMIN', 'RH'), (req, res, next) => {
  const { upload } = require('./index');
  upload.single('cv')(req, res, (err) => {
    if (err) {
      console.error('[CANDIDATES] Multer upload-cv-new :', err.message);
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Fichier trop volumineux (max 10 Mo)' });
      return res.status(400).json({ error: err.message || 'Erreur upload fichier' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier CV requis' });

    const filePath = `/uploads/cv/${req.file.filename}`;
    const rawText = await parseCVFile(req.file.path);
    const skillPatterns = await getSkillPatterns();
    const extracted = await extractFromCV(rawText, skillPatterns);

    const result = await pool.query(
      `INSERT INTO candidates (first_name, last_name, email, phone, cv_file_path, cv_raw_text,
       has_permis_b, has_caces, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'received') RETURNING *`,
      [
        extracted.firstName, extracted.lastName, extracted.email, extracted.phone,
        filePath, rawText,
        extracted.skills.permis_b === 'detected',
        extracted.skills.caces === 'detected',
      ]
    );

    const candidateId = result.rows[0].id;

    // Historique
    await pool.query(
      'INSERT INTO candidate_history (candidate_id, to_status, comment, changed_by) VALUES ($1, $2, $3, $4)',
      [candidateId, 'received', 'Candidature créée depuis upload CV', req.user.id]
    );

    // Compétences
    for (const [skill, status] of Object.entries(extracted.skills)) {
      await pool.query(
        'INSERT INTO candidate_skills (candidate_id, skill_name, status, updated_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [candidateId, skill, status, req.user.id]
      );
    }

    res.status(201).json({
      candidate: result.rows[0],
      extracted: {
        email: extracted.email,
        phone: extracted.phone,
        firstName: extracted.firstName,
        lastName: extracted.lastName,
        skills: extracted.skills,
      },
    });
  } catch (err) {
    console.error('[CANDIDATES] Erreur upload-cv-new :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

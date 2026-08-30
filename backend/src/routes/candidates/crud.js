const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { getSkillPatterns, parseCVFile, extractFromCV } = require('./cv-engine');
const { autoLogActivity } = require('../../middleware/activity-logger');

// ══════════════════════════════════════════
// ROUTES CANDIDATES (liste, kanban, création, stats)
// ══════════════════════════════════════════

router.use(autoLogActivity('candidate'));

// Existence d'un profil PCM pour ce candidat (2.43.0 — audit PCM, défauts D9).
// La page Candidats filtrait et badgeait sur `c.pcm_completed` / `c.pcm_type`,
// DEUX COLONNES QUI N'EXISTENT PAS dans `candidates` : `SELECT c.*` ne les
// ramenait donc jamais, l'onglet « Avec PCM (n) » affichait un compteur juste
// au-dessus d'une liste systématiquement vide, et aucune carte ne portait le
// badge. On expose la vraie information, calculée là où elle vit — même motif
// que `employees.js` pour ses propositions de rattachement.
//
// EXISTS sur pcm_reports (et non sur pcm_sessions seule) : une session lancée
// mais pas terminée n'est pas un profil, et l'écran promet « Avec PCM ».
const HAS_PCM_SQL = `EXISTS(
        SELECT 1 FROM pcm_reports pr WHERE pr.candidate_id = c.id
      ) AS has_pcm`;

// GET /api/candidates — Liste avec filtres
router.get('/', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { status, search, team_id } = req.query;
    let query = `SELECT c.*, t.name as team_name,
      (SELECT em.id FROM employees em WHERE em.candidate_id = c.id LIMIT 1) AS linked_employee_id,
      (SELECT UPPER(em.last_name) || ' ' || em.first_name FROM employees em WHERE em.candidate_id = c.id LIMIT 1) AS linked_employee_name,
      ${HAS_PCM_SQL}
      FROM candidates c LEFT JOIN teams t ON c.assigned_team_id = t.id WHERE 1=1`;
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
      // has_pcm : c'est le kanban qui alimente RÉELLEMENT les cartes et le
      // filtre « Avec PCM » de la page Candidats — l'exposer sur /candidates
      // seul n'aurait rien réparé à l'écran.
      `SELECT c.*, t.name as team_name,
        (SELECT em.id FROM employees em WHERE em.candidate_id = c.id LIMIT 1) AS linked_employee_id,
        (SELECT UPPER(em.last_name) || ' ' || em.first_name FROM employees em WHERE em.candidate_id = c.id LIMIT 1) AS linked_employee_name,
        ${HAS_PCM_SQL}
       FROM candidates c
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

    // Compétences initiales à semer (lecture hors transaction)
    const patterns = await getSkillPatterns();

    // Création ATOMIQUE : candidat + trace d'historique + compétences initiales.
    // Auparavant ces 3 écritures étaient hors transaction — un échec après l'INSERT
    // candidat laissait une fiche sans historique ni compétences.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO candidates (first_name, last_name, email, phone, gender, has_permis_b, has_caces, source_email, assigned_team_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [first_name, last_name, email, phone, gender, has_permis_b || false, has_caces || false, source_email, assigned_team_id]
      );
      const candidateId = result.rows[0].id;

      await client.query(
        'INSERT INTO candidate_history (candidate_id, to_status, comment, changed_by) VALUES ($1, $2, $3, $4)',
        [candidateId, 'received', 'Candidature créée', req.user.id]
      );

      for (const skill of Object.keys(patterns)) {
        await client.query(
          'INSERT INTO candidate_skills (candidate_id, skill_name, status, updated_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [candidateId, skill, 'not_mentioned', req.user.id]
        );
      }

      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
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

    // Création ATOMIQUE : candidat (issu du CV) + historique + compétences détectées.
    // Le parsing du CV ci-dessus reste hors transaction (I/O fichier, potentiellement lent).
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      result = await client.query(
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

      await client.query(
        'INSERT INTO candidate_history (candidate_id, to_status, comment, changed_by) VALUES ($1, $2, $3, $4)',
        [candidateId, 'received', 'Candidature créée depuis upload CV', req.user.id]
      );

      for (const [skill, status] of Object.entries(extracted.skills)) {
        await client.query(
          'INSERT INTO candidate_skills (candidate_id, skill_name, status, updated_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [candidateId, skill, status, req.user.id]
        );
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
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

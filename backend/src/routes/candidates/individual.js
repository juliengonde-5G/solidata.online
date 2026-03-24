const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { getSkillPatterns, parseCVFile, extractFromCV } = require('./cv-engine');
const { RECRUITMENT_DOCS } = require('./documents');

// ══════════════════════════════════════════
// ROUTES PAR CANDIDAT (/:id)
// ══════════════════════════════════════════

// GET /api/candidates/:id
router.get('/:id', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, t.name as team_name FROM candidates c
       LEFT JOIN teams t ON c.assigned_team_id = t.id WHERE c.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur détail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/candidates/:id
router.put('/:id', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const setClauses = [];
    const values = [];
    let i = 1;

    const allowedFields = [
      'first_name', 'last_name', 'email', 'phone', 'gender',
      'has_permis_b', 'has_caces', 'appointment_date', 'appointment_location',
      'sms_response', 'interviewer_name', 'interview_comment',
      'practical_test_done', 'practical_test_result', 'practical_test_comment',
      'assigned_team_id', 'position_id', 'comment',
    ];

    // Champs qui doivent être NULL au lieu de '' pour PostgreSQL (date, FK, CHECK constraints)
    const nullableFields = ['appointment_date', 'position_id', 'assigned_team_id', 'practical_test_result', 'sms_response', 'gender'];

    for (const field of allowedFields) {
      if (fields[field] !== undefined) {
        setClauses.push(`${field} = $${i}`);
        const val = nullableFields.includes(field) && fields[field] === '' ? null : fields[field];
        values.push(val);
        i++;
      }
    }

    if (setClauses.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE candidates SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/candidates/:id/status — Déplacer dans le Kanban
router.put('/:id/status', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, comment } = req.body;
    const validStatuses = ['received', 'interview', 'hired', 'rejected'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    const current = await pool.query('SELECT status FROM candidates WHERE id = $1', [id]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });

    const fromStatus = current.rows[0].status;

    const result = await pool.query(
      'UPDATE candidates SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );

    await pool.query(
      'INSERT INTO candidate_history (candidate_id, from_status, to_status, comment, changed_by) VALUES ($1, $2, $3, $4, $5)',
      [id, fromStatus, status, comment, req.user.id]
    );

    // Auto-délivrer le livret d'accueil + charte d'insertion quand le candidat est embauché
    if (status === 'hired') {
      for (const docType of ['livret_accueil', 'charte_insertion']) {
        await pool.query(
          `INSERT INTO recruitment_documents (candidate_id, document_type, delivered_by, delivery_method)
           VALUES ($1, $2, $3, 'email')
           ON CONFLICT (candidate_id, document_type) DO NOTHING`,
          [id, docType, req.user.id]
        ).catch(() => {}); // Ignore si table n'existe pas encore
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur changement statut :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/:id/upload-cv — Upload CV existant
router.post('/:id/upload-cv', authorize('ADMIN', 'RH'), (req, res, next) => {
  const { upload } = require('./index');
  upload.single('cv')(req, res, next);
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier CV requis' });

    const { id } = req.params;
    const filePath = `/uploads/cv/${req.file.filename}`;

    // Parser le CV (avec OCR si nécessaire)
    const rawText = await parseCVFile(req.file.path);
    const skillPatterns = await getSkillPatterns();
    const extracted = await extractFromCV(rawText, skillPatterns);

    // Mettre à jour le candidat
    await pool.query(
      `UPDATE candidates SET cv_file_path = $1, cv_raw_text = $2,
       email = COALESCE($3, email), phone = COALESCE($4, phone),
       has_permis_b = COALESCE($5, has_permis_b),
       has_caces = COALESCE($6, has_caces),
       updated_at = NOW() WHERE id = $7`,
      [
        filePath, rawText, extracted.email, extracted.phone,
        extracted.skills.permis_b === 'detected' ? true : null,
        extracted.skills.caces === 'detected' ? true : null,
        id,
      ]
    );

    // Mettre à jour les compétences détectées
    for (const [skill, status] of Object.entries(extracted.skills)) {
      await pool.query(
        `INSERT INTO candidate_skills (candidate_id, skill_name, status, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (candidate_id, skill_name) DO UPDATE SET status = $3, updated_by = $4, updated_at = NOW()`,
        [id, skill, status, req.user.id]
      );
    }

    res.json({
      message: 'CV uploadé et analysé',
      filePath,
      extracted: {
        email: extracted.email,
        phone: extracted.phone,
        firstName: extracted.firstName,
        lastName: extracted.lastName,
        skills: extracted.skills,
      },
    });
  } catch (err) {
    console.error('[CANDIDATES] Erreur upload CV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/candidates/:id/download-cv
router.get('/:id/download-cv', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query('SELECT cv_file_path FROM candidates WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0 || !result.rows[0].cv_file_path) {
      return res.status(404).json({ error: 'CV non trouvé' });
    }
    const uploadsDir = path.resolve(__dirname, '..', '..', '..', 'uploads');
    const filePath = path.resolve(__dirname, '..', '..', '..', result.rows[0].cv_file_path);
    // Protection Path Traversal : le fichier doit rester dans le dossier uploads
    if (!filePath.startsWith(uploadsDir)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });
    res.download(filePath);
  } catch (err) {
    console.error('[CANDIDATES] Erreur download CV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/candidates/:id/skills
router.get('/:id/skills', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM candidate_skills WHERE candidate_id = $1 ORDER BY skill_name',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CANDIDATES] Erreur compétences :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/candidates/:id/skills/:skillName
router.put('/:id/skills/:skillName', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { id, skillName } = req.params;
    const { status } = req.body;

    if (!['not_mentioned', 'detected', 'confirmed'].includes(status)) {
      return res.status(400).json({ error: 'Statut de compétence invalide' });
    }

    const result = await pool.query(
      `INSERT INTO candidate_skills (candidate_id, skill_name, status, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (candidate_id, skill_name) DO UPDATE SET status = $3, updated_by = $4, updated_at = NOW()
       RETURNING *`,
      [id, skillName, status, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur modification compétence :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/candidates/:id/history
router.get('/:id/history', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ch.*, u.first_name as changed_by_name, u.last_name as changed_by_lastname
       FROM candidate_history ch
       LEFT JOIN users u ON ch.changed_by = u.id
       WHERE ch.candidate_id = $1 ORDER BY ch.created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CANDIDATES] Erreur historique :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/:id/documents/deliver — Enregistrer la remise d'un document
router.post('/:id/documents/deliver', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { document_type, delivery_method } = req.body;
    if (!RECRUITMENT_DOCS[document_type]) {
      return res.status(400).json({ error: 'Type de document invalide' });
    }

    const result = await pool.query(
      `INSERT INTO recruitment_documents (candidate_id, document_type, delivered_by, delivery_method)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (candidate_id, document_type) DO UPDATE SET delivered_at = NOW(), delivered_by = $3, delivery_method = $4
       RETURNING *`,
      [req.params.id, document_type, req.user.id, delivery_method || 'telechargement']
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur remise document :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/candidates/:id/documents — Documents remis au candidat
router.get('/:id/documents', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*, u.first_name as delivered_by_name, u.last_name as delivered_by_lastname
       FROM recruitment_documents d
       LEFT JOIN users u ON d.delivered_by = u.id
       WHERE d.candidate_id = $1 ORDER BY d.delivered_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[CANDIDATES] Erreur liste documents :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/candidates/:id
router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM candidates WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Candidat non trouvé' });
    res.json({ message: 'Candidat supprimé' });
  } catch (err) {
    console.error('[CANDIDATES] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

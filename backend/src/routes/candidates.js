const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// Config multer pour upload CV
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'cv');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `cv_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ══════════════════════════════════════════
// MOTEUR D'ANALYSE CV
// ══════════════════════════════════════════
const SKILLS_PATTERNS = {
  'permis_b': /permis\s*b|permis\s*de\s*conduire|cat[ée]gorie\s*b/i,
  'permis_c': /permis\s*c|poids\s*lourds?/i,
  'caces': /caces|cariste|chariot\s*[ée]l[ée]vateur/i,
  'tri_textile': /tri\s*(de\s*)?textiles?|tri\s*v[êe]tements?|triage/i,
  'controle_qualite': /contr[ôo]le\s*(de\s*)?qualit[ée]|qualit[ée]|inspection/i,
  'gestion_equipe': /gestion\s*(d['']?)?[ée]quipe|management|encadrement|chef\s*d['']?[ée]quipe/i,
  'sst': /sst|secouriste|premiers?\s*secours|sauveteur/i,
  'habilitation_electrique': /habilitation\s*[ée]lectrique|[ée]lectricit[ée]/i,
  'logistique': /logistique|supply\s*chain|approvisionnement|magasinier/i,
  'manutention': /manutention|port\s*de\s*charges|manutentionnaire/i,
  'collecte': /collecte|ramassage|enlèvement|benne/i,
  'environnement': /environnement|d[ée]veloppement\s*durable|[ée]cologie|recyclage/i,
  'couture': /couture|retouche|confection|machine\s*[àa]\s*coudre/i,
  'vente': /vente|commerce|commercial|relation\s*client/i,
  'informatique': /informatique|ordinateur|excel|word|logiciel/i,
};

function extractFromCV(rawText) {
  if (!rawText) return { skills: {}, email: null, phone: null, firstName: null, lastName: null };

  const text = rawText.replace(/\s+/g, ' ');

  // Email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0] : null;

  // Téléphone (formats français)
  const phoneMatch = text.match(/(?:0|\+33\s?)[1-9](?:[\s.-]?\d{2}){4}/);
  const phone = phoneMatch ? phoneMatch[0].replace(/[\s.-]/g, '') : null;

  // Nom/Prénom (cherche les mots en majuscules en début de texte)
  let firstName = null, lastName = null;
  const nameMatch = text.match(/^[^a-z]*?([A-ZÀ-Ú][a-zà-ú]+)\s+([A-ZÀ-Ú]{2,})/m);
  if (nameMatch) {
    firstName = nameMatch[1];
    lastName = nameMatch[2];
  }

  // Compétences détectées
  const skills = {};
  for (const [skill, pattern] of Object.entries(SKILLS_PATTERNS)) {
    skills[skill] = pattern.test(text) ? 'detected' : 'not_mentioned';
  }

  return { skills, email, phone, firstName, lastName };
}

// Fonction pour parser le texte du CV (PDF)
async function parseCVFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return data.text;
    } catch (err) {
      console.error('[CV] Erreur parsing PDF :', err.message);
      return '';
    }
  }
  return '';
}

// Middleware auth pour toutes les routes
router.use(authenticate);

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
      to_contact: [],
      not_retained: [],
      summoned: [],
      recruited: [],
    };

    result.rows.forEach(c => {
      if (kanban[c.status]) kanban[c.status].push(c);
    });

    res.json(kanban);
  } catch (err) {
    console.error('[CANDIDATES] Erreur kanban :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates — Créer
router.post('/', authorize('ADMIN', 'RH'), async (req, res) => {
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

    // Compétences initiales
    for (const skill of Object.keys(SKILLS_PATTERNS)) {
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
      'assigned_team_id',
    ];

    for (const field of allowedFields) {
      if (fields[field] !== undefined) {
        setClauses.push(`${field} = $${i}`);
        values.push(fields[field]);
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
    const validStatuses = ['received', 'to_contact', 'not_retained', 'summoned', 'recruited'];

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

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CANDIDATES] Erreur changement statut :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/candidates/:id/upload-cv — Upload CV existant
router.post('/:id/upload-cv', authorize('ADMIN', 'RH'), upload.single('cv'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier CV requis' });

    const { id } = req.params;
    const filePath = `/uploads/cv/${req.file.filename}`;

    // Parser le CV
    const rawText = await parseCVFile(req.file.path);
    const extracted = extractFromCV(rawText);

    // Mettre à jour le candidat
    const updates = { cv_file_path: filePath, cv_raw_text: rawText };
    if (extracted.email) updates.email = extracted.email;
    if (extracted.phone) updates.phone = extracted.phone;

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

// POST /api/candidates/upload-cv-new — Upload CV → créer nouveau candidat
router.post('/upload-cv-new', authorize('ADMIN', 'RH'), upload.single('cv'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier CV requis' });

    const filePath = `/uploads/cv/${req.file.filename}`;
    const rawText = await parseCVFile(req.file.path);
    const extracted = extractFromCV(rawText);

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

// GET /api/candidates/:id/download-cv
router.get('/:id/download-cv', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query('SELECT cv_file_path FROM candidates WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0 || !result.rows[0].cv_file_path) {
      return res.status(404).json({ error: 'CV non trouvé' });
    }
    const filePath = path.join(__dirname, '..', '..', result.rows[0].cv_file_path);
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

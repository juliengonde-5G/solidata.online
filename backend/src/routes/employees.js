const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { monthBounds } = require('../utils/month-range');
const { autoLogActivity } = require('../middleware/activity-logger');
const { imageFilter, spreadsheetFilter } = require('../utils/upload-filters');
const { parseWorkbookBuffer, upsertCollaborators } = require('../services/collaborator-import');

// Upload photo
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'photos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // T1.1 : sanitize l'extension — ne garder que [a-z0-9.] pour éviter
    // qu'un originalname pathologique (..//, espaces, etc.) ne passe.
    const rawExt = path.extname(file.originalname || '').toLowerCase();
    const ext = rawExt.replace(/[^a-z0-9.]/g, '') || '.jpg';
    cb(null, `photo_${Date.now()}${ext}`);
  },
});
// T1.1 : whitelist image uniquement (jpg/png/webp/heic) — bloque le
// upload de .svg+JS, .html, .exe, etc.
const upload = multer({ storage: photoStorage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFilter });

// Import RH — fichier tableur (.xlsx / .csv) gardé en mémoire (pas de disque)
// puis parsé par le service collaborator-import. 10 Mo suffisent largement
// pour un export complet Malibou.
const uploadSpreadsheet = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: spreadsheetFilter });

// Exécute un middleware multer en convertissant ses erreurs (mauvais type,
// taille dépassée) en 400 JSON propre plutôt qu'un 500 par défaut.
const runUpload = (mw) => (req, res, next) => mw(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.message || 'Fichier invalide' });
  next();
});

router.use(authenticate);
router.use(autoLogActivity('employee'));

// GET /api/employees
router.get('/', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { team_id, is_active, search } = req.query;
    let query = `SELECT e.*, t.name as team_name FROM employees e LEFT JOIN teams t ON e.team_id = t.id WHERE 1=1`;
    const params = [];

    if (team_id) { params.push(team_id); query += ` AND e.team_id = $${params.length}`; }
    if (is_active !== undefined) { params.push(is_active === 'true'); query += ` AND e.is_active = $${params.length}`; }
    if (search) { params.push(`%${search}%`); query += ` AND (e.first_name ILIKE $${params.length} OR e.last_name ILIKE $${params.length})`; }

    query += ' ORDER BY e.last_name, e.first_name';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[EMPLOYEES] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/employees/:id
router.get('/:id', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, t.name as team_name FROM employees e
       LEFT JOIN teams t ON e.team_id = t.id WHERE e.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Employé non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[EMPLOYEES] Erreur détail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/employees
// POST /api/employees — DÉSACTIVÉ (409)
// Règle métier : un collaborateur est créé UNIQUEMENT par la synchronisation RH
// (import du logiciel de paye Malibou : POST /api/employees/import/xlsx|csv,
// service collaborator-import.js). La création manuelle est bloquée pour
// garantir que la base collaborateurs reste le miroir de la paye et éviter les
// doublons/fiches fantômes. Le lien avec le recrutement se fait via
// POST /api/candidates/:id/link-employee (liaison, pas création).
router.post('/', authorize('ADMIN', 'RH'), async (req, res) => {
  return res.status(409).json({
    error: 'La création manuelle de collaborateur est désactivée.',
    hint: "Les collaborateurs sont créés uniquement par la synchronisation RH (import du logiciel de paye, onglet « Importer »). Pour rattacher un candidat, utilisez « Lier à un collaborateur ».",
  });
});

// PUT /api/employees/:id
router.put('/:id', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const allowed = ['first_name', 'last_name', 'phone', 'email', 'team_id', 'position',
      'contract_type', 'contract_start', 'contract_end', 'has_permis_b', 'has_caces',
      'weekly_hours', 'skills', 'is_active', 'user_id', 'candidate_id',
      'insertion_status', 'insertion_start_date', 'insertion_end_date', 'prescripteur', 'visite_medicale_date',
      // Champs étendus import Malibou (identité, coordonnées, naissance, IAE, contrat)
      'malibou_id', 'birth_name', 'gender', 'birth_date', 'nationality', 'qualification', 'personal_email',
      'address', 'city', 'postal_code', 'country', 'civility',
      'birth_city', 'birth_country', 'birth_department',
      'disability_status', 'residence_permit_type', 'residence_permit_number', 'residence_permit_renewal',
      'medical_visit_frequency', 'seniority_date', 'manager_malibou_id', 'manager_name', 'manager_id',
      'work_time_type', 'gross_salary', 'siret', 'establishment'];

    // Nettoyer les types : strings vides → null pour les champs numériques/date/boolean
    const intFields = ['team_id', 'user_id', 'candidate_id', 'manager_id'];
    const dateFields = ['contract_start', 'contract_end', 'insertion_start_date', 'insertion_end_date',
      'visite_medicale_date', 'birth_date', 'seniority_date'];
    for (const f of intFields) {
      if (fields[f] !== undefined && !fields[f] && fields[f] !== 0) fields[f] = null;
      else if (fields[f]) fields[f] = Number(fields[f]);
    }
    for (const f of dateFields) {
      if (fields[f] !== undefined && !fields[f]) fields[f] = null;
    }

    const setClauses = [];
    const values = [];
    let i = 1;

    for (const field of allowed) {
      if (fields[field] !== undefined) {
        setClauses.push(`${field} = $${i}`);
        values.push(fields[field]);
        i++;
      }
    }

    if (setClauses.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

    setClauses.push('updated_at = NOW()');
    values.push(id);

    const result = await pool.query(
      `UPDATE employees SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Employé non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[EMPLOYEES] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/employees/:id/candidate-matches — fiches de recrutement candidates à la liaison
// Renvoie le candidat déjà lié (le cas échéant) + les candidats NON encore liés
// à un collaborateur, classés par proximité de nom. Sert au bouton « Lier une
// fiche de recrutement » de la fiche collaborateur (le PCM du recrutement
// remonte alors dans le module Insertion).
router.get('/:id/candidate-matches', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { id } = req.params;
    const emp = await pool.query('SELECT id, first_name, last_name, candidate_id FROM employees WHERE id = $1', [id]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Collaborateur non trouvé' });
    const e = emp.rows[0];

    const linked = e.candidate_id
      ? await pool.query('SELECT id, first_name, last_name, status, email FROM candidates WHERE id = $1', [e.candidate_id])
      : { rows: [] };

    // Candidats non encore rattachés à un collaborateur.
    const cands = await pool.query(`
      SELECT c.id, c.first_name, c.last_name, c.status, c.email,
             EXISTS(SELECT 1 FROM pcm_sessions ps JOIN pcm_reports pr ON pr.session_id = ps.id
                    WHERE ps.candidate_id = c.id) AS has_pcm
      FROM candidates c
      WHERE NOT EXISTS (SELECT 1 FROM employees em WHERE em.candidate_id = c.id)
      ORDER BY c.last_name, c.first_name`);

    const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
    const ef = norm(e.first_name); const el = norm(e.last_name);
    const scored = cands.rows.map((c) => {
      const cf = norm(c.first_name); const cl = norm(c.last_name);
      let score = 0;
      if (cf && cl && cf === ef && cl === el) score = 100;
      else if (el && cl === el && cf && (cf.startsWith(ef) || ef.startsWith(cf))) score = 80;
      else if (el && cl === el) score = 60;
      else if (ef && cf === ef) score = 40;
      else if (el && cl && (cl.includes(el) || el.includes(cl))) score = 20;
      return { ...c, match_score: score };
    }).sort((a, b) => b.match_score - a.match_score
      || String(a.last_name || '').localeCompare(String(b.last_name || '')));

    res.json({
      employee: { id: e.id, first_name: e.first_name, last_name: e.last_name },
      linked_candidate: linked.rows[0] || null,
      suggestions: scored,
    });
  } catch (err) {
    console.error('[EMPLOYEES] Erreur candidate-matches :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/employees/:id/photo
router.post('/:id/photo', authorize('ADMIN', 'RH'), upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Photo requise' });
    const photoPath = `/uploads/photos/${req.file.filename}`;
    await pool.query('UPDATE employees SET photo_path = $1 WHERE id = $2', [photoPath, req.params.id]);
    res.json({ message: 'Photo mise à jour', photoPath });
  } catch (err) {
    console.error('[EMPLOYEES] Erreur upload photo :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// PLANNING (Schedule)
// ══════════════════════════════════════════

// GET /api/employees/schedule?month=2026-03&team_id=1
router.get('/schedule/planning', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { month, team_id, employee_id } = req.query;
    let query = `
      SELECT s.*, e.first_name, e.last_name, e.team_id, p.title as position_name
      FROM schedule s
      JOIN employees e ON s.employee_id = e.id
      LEFT JOIN positions p ON s.position_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (month) {
      const [mStart, mEnd] = monthBounds(month);
      params.push(mStart);
      params.push(mEnd);
      query += ` AND s.date BETWEEN $${params.length - 1} AND $${params.length}`;
    }
    if (team_id) { params.push(team_id); query += ` AND e.team_id = $${params.length}`; }
    if (employee_id) { params.push(employee_id); query += ` AND s.employee_id = $${params.length}`; }

    query += ' ORDER BY s.date, e.last_name';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[SCHEDULE] Erreur planning :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/employees/schedule
router.post('/schedule', authorize('ADMIN', 'RH', 'MANAGER'), [
  body('employee_id').isInt().withMessage('ID employé requis'),
  body('date').notEmpty().withMessage('Date requise'),
  body('status').notEmpty().withMessage('Statut requis'),
], validate, async (req, res) => {
  try {
    const { employee_id, date, status, position_id, is_provisional, periode } = req.body;
    if (!employee_id || !date || !status) {
      return res.status(400).json({ error: 'employee_id, date et status requis' });
    }

    // La contrainte UNIQUE de schedule est (employee_id, date, periode) depuis
    // la migration matin/après-midi (init-db) — l'ancienne (employee_id, date)
    // n'existe plus et faisait échouer l'upsert (42P10).
    const result = await pool.query(
      `INSERT INTO schedule (employee_id, date, status, position_id, is_provisional, periode)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'journee'))
       ON CONFLICT (employee_id, date, periode) DO UPDATE SET
       status = $3, position_id = $4, is_provisional = $5
       RETURNING *`,
      [employee_id, date, status, position_id, is_provisional !== false, periode]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[SCHEDULE] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/employees/schedule/:id/confirm
router.put('/schedule/:id/confirm', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE schedule SET is_provisional = false, confirmed_by = $1, confirmed_at = NOW() WHERE id = $2 RETURNING *',
      [req.user.id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Entrée non trouvée' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[SCHEDULE] Erreur confirmation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/employees/schedule/bulk — Planification en masse
router.post('/schedule/bulk', authorize('ADMIN', 'RH', 'MANAGER'), [
  body('entries').isArray({ min: 1 }).withMessage('Liste d\'entrées requise'),
], validate, async (req, res) => {
  try {
    const { entries } = req.body; // [{employee_id, date, status, position_id}]
    if (!entries || !entries.length) return res.status(400).json({ error: 'Entrées requises' });

    const results = [];
    for (const entry of entries) {
      const r = await pool.query(
        `INSERT INTO schedule (employee_id, date, status, position_id, is_provisional, periode)
         VALUES ($1, $2, $3, $4, true, COALESCE($5, 'journee'))
         ON CONFLICT (employee_id, date, periode) DO UPDATE SET status = $3, position_id = $4
         RETURNING *`,
        [entry.employee_id, entry.date, entry.status, entry.position_id, entry.periode]
      );
      results.push(r.rows[0]);
    }

    res.json({ message: `${results.length} entrées créées/mises à jour`, entries: results });
  } catch (err) {
    console.error('[SCHEDULE] Erreur bulk :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// HEURES DE TRAVAIL
// ══════════════════════════════════════════

// Fix bugs R1/R2 : alias conservant la compatibilité avec
// frontend/src/pages/WorkHours.jsx qui appelle /employees/:id/hours,
// /employees/:id/hours/summary, POST /employees/:id/hours, et
// PUT /employees/:id/hours/:entryId/validate avec les champs start_time /
// end_time / break_minutes. On convertit vers hours_worked et on expose
// `validated` comme booléen dérivé de validated_by.

function computeHoursFromSlots(start_time, end_time, break_minutes) {
  if (!start_time || !end_time) return null;
  const [sh, sm] = String(start_time).split(':').map(Number);
  const [eh, em] = String(end_time).split(':').map(Number);
  if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return null;
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const gross = endMin - startMin - (parseInt(break_minutes, 10) || 0);
  return gross > 0 ? +(gross / 60).toFixed(2) : 0;
}

// GET /api/employees/:id/hours?month=YYYY-MM
router.get('/:id/hours', authorize('ADMIN', 'RH', 'MANAGER', 'COLLABORATEUR'), async (req, res) => {
  try {
    const { month } = req.query;
    if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ error: 'ID employé invalide' });
    let query = `
      SELECT wh.*,
             (wh.validated_by IS NOT NULL) AS validated,
             u.first_name AS validated_by_name
      FROM work_hours wh
      LEFT JOIN users u ON wh.validated_by = u.id
      WHERE wh.employee_id = $1`;
    const params = [req.params.id];
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [mStart, mEnd] = monthBounds(month);
      params.push(mStart);
      params.push(mEnd);
      query += ` AND wh.date BETWEEN $${params.length - 1} AND $${params.length}`;
    }
    query += ' ORDER BY wh.date DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[WORK_HOURS] Erreur /hours (alias) :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/employees/:id/hours/summary?month=YYYY-MM
router.get('/:id/hours/summary', authorize('ADMIN', 'RH', 'MANAGER', 'COLLABORATEUR'), async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Paramètre month requis (YYYY-MM)' });
    }
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(hours_worked), 0)::float AS total_hours,
         COALESCE(SUM(overtime_hours), 0)::float AS overtime_hours,
         COUNT(CASE WHEN type = 'normal' THEN 1 END)::int AS days_worked,
         COUNT(CASE WHEN type = 'absence' THEN 1 END)::int AS absence_days,
         COUNT(CASE WHEN type = 'sick' THEN 1 END)::int AS sick_days,
         COUNT(CASE WHEN type = 'holiday' THEN 1 END)::int AS holiday_days
       FROM work_hours
       WHERE employee_id = $1 AND date BETWEEN $2 AND $3`,
      [req.params.id, ...monthBounds(month)]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[WORK_HOURS] Erreur /hours/summary (alias) :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/employees/:id/hours — accepte start_time/end_time/break_minutes
router.post('/:id/hours', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const empId = req.params.id;
    const { date, start_time, end_time, break_minutes, type, notes, hours_worked: hw, overtime_hours: oh } = req.body;
    if (!date) return res.status(400).json({ error: 'Date requise' });
    const hours_worked = hw !== undefined && hw !== null && hw !== ''
      ? parseFloat(hw)
      : computeHoursFromSlots(start_time, end_time, break_minutes);
    if (hours_worked === null || Number.isNaN(hours_worked)) {
      return res.status(400).json({ error: 'Heures travaillées invalides (start_time/end_time requis)' });
    }
    const dbType = ['normal', 'training', 'absence', 'sick', 'holiday'].includes(type) ? type : 'normal';
    const result = await pool.query(
      `INSERT INTO work_hours (employee_id, date, hours_worked, overtime_hours, type, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (employee_id, date) DO UPDATE SET
         hours_worked = EXCLUDED.hours_worked,
         overtime_hours = EXCLUDED.overtime_hours,
         type = EXCLUDED.type,
         notes = EXCLUDED.notes
       RETURNING *`,
      [empId, date, hours_worked, parseFloat(oh) || 0, dbType, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[WORK_HOURS] Erreur POST /hours (alias) :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/employees/:id/hours/:entryId/validate
router.put('/:id/hours/:entryId/validate', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE work_hours SET validated_by = $1 WHERE id = $2 AND employee_id = $3 RETURNING *',
      [req.user.id, req.params.entryId, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Entrée non trouvée' });
    res.json({ ...result.rows[0], validated: true });
  } catch (err) {
    console.error('[WORK_HOURS] Erreur validate (alias) :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/employees/work-hours?month=2026-03&employee_id=1
router.get('/work-hours/list', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { month, employee_id, team_id } = req.query;
    let query = `
      SELECT wh.*, e.first_name, e.last_name, e.team_id, e.weekly_hours,
       u.first_name as validated_by_name
       FROM work_hours wh
       JOIN employees e ON wh.employee_id = e.id
       LEFT JOIN users u ON wh.validated_by = u.id
       WHERE 1=1
    `;
    const params = [];

    if (month) {
      const [mStart, mEnd] = monthBounds(month);
      params.push(mStart);
      params.push(mEnd);
      query += ` AND wh.date BETWEEN $${params.length - 1} AND $${params.length}`;
    }
    if (employee_id) { params.push(employee_id); query += ` AND wh.employee_id = $${params.length}`; }
    if (team_id) { params.push(team_id); query += ` AND e.team_id = $${params.length}`; }

    query += ' ORDER BY wh.date, e.last_name';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[WORK_HOURS] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/employees/work-hours
router.post('/work-hours', authorize('ADMIN', 'RH', 'MANAGER'), [
  body('employee_id').isInt().withMessage('ID employé requis'),
  body('date').notEmpty().withMessage('Date requise'),
  body('hours_worked').isFloat({ min: 0 }).withMessage('Heures travaillées requises (valeur numérique)'),
], validate, async (req, res) => {
  try {
    const { employee_id, date, hours_worked, overtime_hours, type, notes } = req.body;
    if (!employee_id || !date || hours_worked === undefined) {
      return res.status(400).json({ error: 'employee_id, date et hours_worked requis' });
    }

    const result = await pool.query(
      `INSERT INTO work_hours (employee_id, date, hours_worked, overtime_hours, type, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (employee_id, date) DO UPDATE SET
       hours_worked = $3, overtime_hours = $4, type = $5, notes = $6
       RETURNING *`,
      [employee_id, date, hours_worked, overtime_hours || 0, type || 'normal', notes]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[WORK_HOURS] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/employees/work-hours/:id/validate
router.put('/work-hours/:id/validate', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE work_hours SET validated_by = $1 WHERE id = $2 RETURNING *',
      [req.user.id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Entrée non trouvée' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[WORK_HOURS] Erreur validation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/employees/work-hours/summary?month=2026-03
router.get('/work-hours/summary', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'Paramètre month requis (YYYY-MM)' });

    const result = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.weekly_hours, e.team_id, t.name as team_name,
       SUM(wh.hours_worked) as total_hours,
       SUM(wh.overtime_hours) as total_overtime,
       COUNT(CASE WHEN wh.type = 'normal' THEN 1 END) as days_worked,
       COUNT(CASE WHEN wh.type = 'absence' THEN 1 END) as days_absent,
       COUNT(CASE WHEN wh.type = 'sick' THEN 1 END) as days_sick,
       COUNT(CASE WHEN wh.type = 'holiday' THEN 1 END) as days_holiday,
       COUNT(CASE WHEN wh.type = 'training' THEN 1 END) as days_training
       FROM employees e
       LEFT JOIN work_hours wh ON wh.employee_id = e.id AND wh.date BETWEEN $1 AND $2
       LEFT JOIN teams t ON e.team_id = t.id
       WHERE e.is_active = true
       GROUP BY e.id, e.first_name, e.last_name, e.weekly_hours, e.team_id, t.name
       ORDER BY e.last_name`,
      monthBounds(month)
    );

    res.json(result.rows);
  } catch (err) {
    console.error('[WORK_HOURS] Erreur résumé :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/employees/absenteeism?months=12
// Comparaison planning prévu (schedule) vs réel (work_hours) sur N derniers mois
// → utilisé par le reporting RH pour le graphique d'absentéisme
router.get('/absenteeism/monthly', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const months = Math.max(1, Math.min(24, parseInt(req.query.months) || 12));
    const result = await pool.query(
      `WITH series AS (
         SELECT date_trunc('month', NOW()) - (n || ' months')::interval AS mois_start
         FROM generate_series(0, $1::int - 1) n
       ),
       prevu AS (
         SELECT date_trunc('month', s.date) AS mois,
                COUNT(*)::int AS jours_planifies,
                SUM(CASE WHEN s.status IN ('absence', 'maladie', 'sick') THEN 1 ELSE 0 END)::int AS absences_planifiees
         FROM schedule s
         WHERE s.date >= (SELECT MIN(mois_start) FROM series)
         GROUP BY 1
       ),
       reel AS (
         SELECT date_trunc('month', wh.date) AS mois,
                COUNT(CASE WHEN wh.type = 'normal' THEN 1 END)::int AS jours_travailles,
                COUNT(CASE WHEN wh.type IN ('absence', 'sick') THEN 1 END)::int AS jours_absents,
                COALESCE(SUM(wh.hours_worked), 0)::float AS heures_reelles
         FROM work_hours wh
         WHERE wh.date >= (SELECT MIN(mois_start) FROM series)
         GROUP BY 1
       )
       SELECT to_char(s.mois_start, 'YYYY-MM') AS mois,
              COALESCE(p.jours_planifies, 0) AS jours_planifies,
              COALESCE(p.absences_planifiees, 0) AS absences_planifiees,
              COALESCE(r.jours_travailles, 0) AS jours_travailles,
              COALESCE(r.jours_absents, 0) AS jours_absents,
              COALESCE(r.heures_reelles, 0) AS heures_reelles,
              CASE WHEN COALESCE(r.jours_travailles, 0) + COALESCE(r.jours_absents, 0) > 0
                   THEN ROUND((COALESCE(r.jours_absents, 0)::numeric / (COALESCE(r.jours_travailles, 0) + COALESCE(r.jours_absents, 0))) * 100, 1)
                   ELSE 0 END AS taux_absenteisme,
              CASE WHEN COALESCE(p.jours_planifies, 0) > 0
                   THEN COALESCE(r.jours_travailles, 0) + COALESCE(r.jours_absents, 0) - COALESCE(p.jours_planifies, 0)
                   ELSE NULL END AS ecart_planning
         FROM series s
         LEFT JOIN prevu p ON p.mois = s.mois_start
         LEFT JOIN reel r ON r.mois = s.mois_start
         ORDER BY s.mois_start ASC`,
      [months]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[EMPLOYEES] Erreur absenteeism :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/employees/clear — Désactive tous les employés actifs (ADMIN only)
// IMPORTANT : déclarée AVANT /:id pour qu'Express ne matche pas :id="clear"
//
// Soft-delete au lieu de DELETE dur car plusieurs tables ont des FK NOT NULL
// vers employees (tours.driver_employee_id, preparation_collaborateurs, etc.)
// qui interdisent un DELETE sans casser l'historique métier.
//
// Les tables légères (work_hours, schedule, etc. en ON DELETE CASCADE) sont
// purgées comme avant. Le malibou_id est libéré pour éviter les conflits si
// le réimport contient les mêmes matricules.
router.delete('/clear', authorize('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Purge des données satellites (CASCADE depuis employees)
    await client.query('DELETE FROM work_hours');
    await client.query('DELETE FROM schedule');
    await client.query('DELETE FROM employee_availability');
    await client.query('DELETE FROM employee_contracts');
    // Soft-delete + libération du malibou_id (anti-doublon au réimport)
    const r = await client.query(`
      UPDATE employees
      SET is_active = false,
          malibou_id = NULL,
          updated_at = NOW()
      WHERE is_active = true
      RETURNING id
    `);
    await client.query('COMMIT');
    res.json({
      message: `${r.rows.length} collaborateur(s) désactivé(s). L'historique métier (tournées, expéditions…) est préservé.`,
      deactivated: r.rows.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[EMPLOYEES] Erreur suppression /clear :', err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// DELETE /api/employees/:id (désactivation)
router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE employees SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Employé non trouvé' });
    res.json({ message: 'Employé désactivé' });
  } catch (err) {
    console.error('[EMPLOYEES] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// CONTRATS
// ══════════════════════════════════════════

router.get('/:id/contracts', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ec.*, t.name as team_name, p.title as position_title
       FROM employee_contracts ec
       LEFT JOIN teams t ON ec.team_id = t.id
       LEFT JOIN positions p ON ec.position_id = p.id
       WHERE ec.employee_id = $1 ORDER BY ec.start_date DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[EMPLOYEES] Erreur contrats :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/:id/contracts', authorize('ADMIN', 'RH'), [
  body('contract_type').notEmpty().withMessage('Type de contrat requis'),
  body('start_date').notEmpty().withMessage('Date de début requise'),
], validate, async (req, res) => {
  try {
    const { contract_type, duration_months, start_date, end_date, weekly_hours, team_id, position_id } = req.body;
    const empId = req.params.id;

    // Déterminer l'origine : embauche si c'est le premier contrat
    const existing = await pool.query('SELECT id FROM employee_contracts WHERE employee_id = $1', [empId]);
    const origin = existing.rows.length === 0 ? 'embauche' : 'renouvellement';

    // Désactiver les contrats précédents
    await pool.query('UPDATE employee_contracts SET is_current = false WHERE employee_id = $1', [empId]);

    const result = await pool.query(
      `INSERT INTO employee_contracts (employee_id, contract_type, duration_months, start_date, end_date, origin, weekly_hours, team_id, position_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [empId, contract_type, duration_months || null, start_date, end_date || null, origin, weekly_hours || 35, team_id || null, position_id || null]
    );

    // Mettre à jour le collaborateur avec les infos du contrat courant
    await pool.query(
      `UPDATE employees SET team_id = COALESCE($1, team_id), contract_type = $2, weekly_hours = $3, updated_at = NOW() WHERE id = $4`,
      [team_id, contract_type, weekly_hours || 35, empId]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[EMPLOYEES] Erreur ajout contrat :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/:id/contracts/:contractId', authorize('ADMIN'), async (req, res) => {
  try {
    await pool.query('DELETE FROM employee_contracts WHERE id = $1 AND employee_id = $2', [req.params.contractId, req.params.id]);
    res.json({ message: 'Contrat supprimé' });
  } catch (err) {
    console.error('[EMPLOYEES] Erreur suppression contrat :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// INDISPONIBILITÉS HEBDOMADAIRES
// ══════════════════════════════════════════

router.get('/:id/availability', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query('SELECT day_off FROM employee_availability WHERE employee_id = $1', [req.params.id]);
    res.json(result.rows.map(r => r.day_off));
  } catch (err) {
    console.error('[EMPLOYEES] Erreur disponibilité :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/:id/availability', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { days_off } = req.body; // array of day names
    const empId = req.params.id;

    // Reset and re-insert
    await pool.query('DELETE FROM employee_availability WHERE employee_id = $1', [empId]);
    for (const day of (days_off || [])) {
      await pool.query('INSERT INTO employee_availability (employee_id, day_off) VALUES ($1, $2) ON CONFLICT DO NOTHING', [empId, day]);
    }

    res.json({ days_off });
  } catch (err) {
    console.error('[EMPLOYEES] Erreur mise à jour disponibilité :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// IMPORT COLLABORATEURS
// ══════════════════════════════════════════

// POST /api/employees/import/csv — Import collaborateurs (upsert idempotent)
//
// Le front envoie un tableau `collaborators` déjà parsé (copier-coller CSV
// d'une feuille Malibou). L'ancien comportement « supprimer tout puis insérer »
// créait un doublon inactif à chaque réimport → remplacé par un upsert :
//   • appariement par matricule (malibou_id) puis nom+prénom ;
//   • mise à jour non destructive de l'existant, création des seuls nouveaux.
router.post('/import/csv', authorize('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { collaborators } = req.body;
    if (!Array.isArray(collaborators) || collaborators.length === 0) {
      return res.status(400).json({ error: 'Tableau de collaborateurs requis' });
    }

    await client.query('BEGIN');
    const { created, updated, errors } = await upsertCollaborators(client, collaborators, { userId: req.user.id });
    await client.query('COMMIT');

    res.json({
      message: `${created.length} créé(s), ${updated.length} mis à jour${errors.length ? `, ${errors.length} erreur(s)` : ''}`,
      created,
      updated,
      errors,
      total: created.length + updated.length + errors.length,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[EMPLOYEES] Erreur import CSV :', err.message);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// POST /api/employees/import/xlsx — Import direct de l'export complet Malibou (.xlsx)
//
// Accepte le classeur tel quel (feuilles « Informations salariés » + « Contrats »)
// via multipart/form-data (champ `file`). Parse côté serveur avec exceljs puis
// applique le même upsert idempotent que la voie CSV.
router.post('/import/xlsx', authorize('ADMIN'), runUpload(uploadSpreadsheet.single('file')), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Fichier .xlsx requis (champ « file »)' });
    }

    const collaborators = await parseWorkbookBuffer(req.file.buffer);
    if (!collaborators.length) {
      return res.status(400).json({ error: 'Aucun collaborateur exploitable trouvé dans le classeur (feuille « Informations salariés »).' });
    }

    await client.query('BEGIN');
    const { created, updated, errors } = await upsertCollaborators(client, collaborators, { userId: req.user.id });
    await client.query('COMMIT');

    res.json({
      message: `${created.length} créé(s), ${updated.length} mis à jour${errors.length ? `, ${errors.length} erreur(s)` : ''} — ${collaborators.length} ligne(s) lue(s)`,
      created,
      updated,
      errors,
      total: created.length + updated.length + errors.length,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[EMPLOYEES] Erreur import XLSX :', err.message);
    res.status(500).json({ error: err.message || 'Erreur lecture du fichier' });
  } finally {
    client.release();
  }
});

// POST /api/employees/import/dedupe-ghosts — Nettoyage des doublons hérités
//
// Les anciens imports (delete-then-insert) ont laissé des fiches « fantômes »
// inactives (is_active=false, malibou_id NULL) en doublon d'une fiche active
// homonyme. Cette route supprime ces fantômes UNIQUEMENT s'ils n'ont aucune
// référence métier (contrats/tournées/pointages…) — chaque suppression est
// isolée : un fantôme protégé par une FK est simplement conservé et compté.
router.post('/import/dedupe-ghosts', authorize('ADMIN'), async (req, res) => {
  try {
    // Fantômes = inactifs sans matricule dont le nom correspond à un actif.
    const ghosts = await pool.query(`
      SELECT g.id, g.first_name, g.last_name
      FROM employees g
      WHERE g.is_active = false AND g.malibou_id IS NULL
        AND EXISTS (
          SELECT 1 FROM employees a
          WHERE a.is_active = true AND a.id <> g.id
            AND LOWER(a.first_name) = LOWER(g.first_name)
            AND LOWER(a.last_name) = LOWER(g.last_name)
        )
    `);

    let purged = 0;
    const kept = [];
    for (const g of ghosts.rows) {
      try {
        await pool.query('DELETE FROM employee_contracts WHERE employee_id = $1', [g.id]);
        await pool.query('DELETE FROM employee_availability WHERE employee_id = $1', [g.id]);
        await pool.query('DELETE FROM employees WHERE id = $1', [g.id]);
        purged++;
      } catch (err) {
        // Référencé ailleurs (historique tournées, etc.) → on conserve la fiche.
        kept.push(`${g.first_name} ${g.last_name}`);
      }
    }

    res.json({
      message: purged > 0
        ? `${purged} doublon(s) inactif(s) supprimé(s)${kept.length ? `, ${kept.length} conservé(s) (rattachés à l'historique)` : ''}.`
        : 'Aucun doublon inactif à nettoyer.',
      purged,
      kept,
    });
  } catch (err) {
    console.error('[EMPLOYEES] Erreur dedupe-ghosts :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// (route DELETE /clear déplacée AVANT DELETE /:id — voir ligne ~539)

// ══════════════════════════════════════════
// VISITE MÉDICALE POST-EMBAUCHE (P1#13 — conformité droit du travail IAE)
//
// Visite d'information et de prévention obligatoire dans les 3 mois suivant
// l'embauche (article R4624-10 du Code du travail). Pour CDDI, contrôle plus
// strict (2 mois). On gère J+90 par défaut, ajustable au cas par cas.
// ══════════════════════════════════════════

// GET /api/employees/visite-medicale/alertes
// Liste les visites en retard ou à venir dans les 30 jours
router.get('/visite-medicale/alertes', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.id, e.first_name, e.last_name, e.contract_start, e.contract_type,
             e.visite_medicale_due_date, e.visite_medicale_date,
             CASE
               WHEN e.visite_medicale_date IS NOT NULL THEN 'realisee'
               WHEN e.visite_medicale_due_date < CURRENT_DATE THEN 'en_retard'
               WHEN e.visite_medicale_due_date <= CURRENT_DATE + INTERVAL '14 days' THEN 'imminente'
               ELSE 'a_planifier'
             END AS etat,
             (e.visite_medicale_due_date - CURRENT_DATE) AS jours_restants
      FROM employees e
      WHERE e.visite_medicale_date IS NULL
        AND e.visite_medicale_due_date IS NOT NULL
        AND (e.is_active IS NULL OR e.is_active = true)
        AND e.visite_medicale_due_date <= CURRENT_DATE + INTERVAL '30 days'
      ORDER BY e.visite_medicale_due_date
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[EMPLOYEES] visite-medicale/alertes :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/employees/:id/visite-medicale — Enregistrer la visite réalisée
// Body : { date, resultat: 'conforme'|'restrictions'|'inapte'|'a_revoir', notes }
router.put('/:id/visite-medicale', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { date, resultat, notes } = req.body;
    if (!date) return res.status(400).json({ error: 'date requise' });
    const validResultats = ['conforme', 'restrictions', 'inapte', 'a_revoir'];
    if (resultat && !validResultats.includes(resultat)) {
      return res.status(400).json({ error: `resultat invalide. Valeurs : ${validResultats.join(', ')}` });
    }
    const result = await pool.query(
      `UPDATE employees
       SET visite_medicale_date = $1,
           visite_medicale_resultat = $2,
           visite_medicale_notes = $3
       WHERE id = $4
       RETURNING id, visite_medicale_date, visite_medicale_resultat, visite_medicale_notes, visite_medicale_due_date`,
      [date, resultat || 'conforme', notes || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Employé introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[EMPLOYEES] PUT visite-medicale :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/employees/:id/visite-medicale/programmer — Replanifier la due_date
// Utilisé si le médecin du travail a un délai. Body : { due_date }
router.put('/:id/visite-medicale/programmer', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { due_date } = req.body;
    if (!due_date) return res.status(400).json({ error: 'due_date requise' });
    const result = await pool.query(
      `UPDATE employees SET visite_medicale_due_date = $1 WHERE id = $2
       RETURNING id, visite_medicale_due_date`,
      [due_date, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Employé introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[EMPLOYEES] programmer visite-medicale :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════ KPI RH P1-D — formation, ETP, absentéisme ══════

router.get('/kpi/formation', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const annee = parseInt(req.query.annee) || new Date().getFullYear();
    const { rows } = await pool.query(`
      SELECT e.id, e.first_name, e.last_name, t.name AS equipe,
             COALESCE(SUM(wh.hours_worked) FILTER (WHERE wh.type='training'), 0)::numeric(8,2) AS heures_formation
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN work_hours wh ON wh.employee_id = e.id AND EXTRACT(YEAR FROM wh.date) = $1
      WHERE e.is_active = true
      GROUP BY e.id, e.first_name, e.last_name, t.name
      HAVING COALESCE(SUM(wh.hours_worked) FILTER (WHERE wh.type='training'), 0) > 0
      ORDER BY heures_formation DESC
    `, [annee]);
    const total = rows.reduce((s, r) => s + Number(r.heures_formation), 0);
    res.json({ annee, total_heures: total, par_personne: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/kpi/etp', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const annee = parseInt(req.query.annee) || new Date().getFullYear();
    const heuresPleinTemps = 1607;
    const { rows } = await pool.query(`
      SELECT t.name AS equipe,
             COALESCE(SUM(wh.hours_worked) FILTER (WHERE wh.type IN ('normal','training')), 0)::numeric(10,2) AS heures_travaillees,
             COUNT(DISTINCT e.id)::int AS nb_salaries
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN work_hours wh ON wh.employee_id = e.id AND EXTRACT(YEAR FROM wh.date) = $1
      WHERE e.is_active = true
      GROUP BY t.name
      ORDER BY heures_travaillees DESC
    `, [annee]);
    const enriched = rows.map(r => ({
      ...r,
      etp: Math.round((Number(r.heures_travaillees) / heuresPleinTemps) * 100) / 100,
    }));
    const totalEtp = enriched.reduce((s, r) => s + r.etp, 0);
    res.json({ annee, etp_reference_heures: heuresPleinTemps, total_etp: Math.round(totalEtp * 100) / 100, par_equipe: enriched });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/kpi/absenteisme', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const annee = parseInt(req.query.annee) || new Date().getFullYear();
    const mois = req.query.mois ? parseInt(req.query.mois) : null;
    const params = [annee];
    let monthFilter = '';
    if (mois) { params.push(mois); monthFilter = `AND EXTRACT(MONTH FROM wh.date) = $${params.length}`; }
    const { rows } = await pool.query(`
      SELECT t.name AS equipe,
             COALESCE(SUM(wh.hours_worked) FILTER (WHERE wh.type IN ('absence','sick')), 0)::numeric(10,2) AS heures_absence,
             COALESCE(SUM(wh.hours_worked) FILTER (WHERE wh.type IN ('normal','training','absence','sick')), 0)::numeric(10,2) AS heures_totales,
             ROUND(
               100.0 * SUM(wh.hours_worked) FILTER (WHERE wh.type IN ('absence','sick'))::numeric
               / NULLIF(SUM(wh.hours_worked) FILTER (WHERE wh.type IN ('normal','training','absence','sick')), 0),
               2
             ) AS taux_pct
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN work_hours wh ON wh.employee_id = e.id AND EXTRACT(YEAR FROM wh.date) = $1 ${monthFilter}
      WHERE e.is_active = true
      GROUP BY t.name
      ORDER BY taux_pct DESC NULLS LAST
    `, params);
    res.json({ annee, mois, par_equipe: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

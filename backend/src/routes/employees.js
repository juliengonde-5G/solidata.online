const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

// Upload photo
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'photos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `photo_${Date.now()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage: photoStorage, limits: { fileSize: 5 * 1024 * 1024 } });

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
router.post('/', authorize('ADMIN', 'RH'), [
  body('first_name').notEmpty().withMessage('Prénom requis'),
  body('last_name').notEmpty().withMessage('Nom requis'),
], validate, async (req, res) => {
  try {
    const { user_id, first_name, last_name, phone, email, team_id, position,
      contract_type, contract_start, contract_end, has_permis_b, has_caces, weekly_hours, skills, candidate_id } = req.body;

    if (!first_name || !last_name) return res.status(400).json({ error: 'Nom et prénom requis' });

    const result = await pool.query(
      `INSERT INTO employees (user_id, first_name, last_name, phone, email, team_id, position,
       contract_type, contract_start, contract_end, has_permis_b, has_caces, weekly_hours, skills, candidate_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [user_id || null, first_name, last_name, phone || null, email || null,
       team_id ? Number(team_id) : null, position || null,
       contract_type || null, contract_start || null, contract_end || null,
       has_permis_b || false, has_caces || false, weekly_hours || 35, skills || [], candidate_id || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[EMPLOYEES] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/employees/:id
router.put('/:id', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const allowed = ['first_name', 'last_name', 'phone', 'email', 'team_id', 'position',
      'contract_type', 'contract_start', 'contract_end', 'has_permis_b', 'has_caces',
      'weekly_hours', 'skills', 'is_active', 'user_id', 'candidate_id',
      'insertion_status', 'insertion_start_date', 'insertion_end_date', 'prescripteur', 'visite_medicale_date'];

    // Nettoyer les types : strings vides → null pour les champs numériques/date/boolean
    const intFields = ['team_id', 'user_id', 'candidate_id'];
    const dateFields = ['contract_start', 'contract_end', 'insertion_start_date', 'insertion_end_date', 'visite_medicale_date'];
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
      SELECT s.*, e.first_name, e.last_name, e.team_id, p.name as position_name
      FROM schedule s
      JOIN employees e ON s.employee_id = e.id
      LEFT JOIN positions p ON s.position_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (month) {
      params.push(month + '-01');
      params.push(month + '-31');
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
    const { employee_id, date, status, position_id, is_provisional } = req.body;
    if (!employee_id || !date || !status) {
      return res.status(400).json({ error: 'employee_id, date et status requis' });
    }

    const result = await pool.query(
      `INSERT INTO schedule (employee_id, date, status, position_id, is_provisional)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (employee_id, date) DO UPDATE SET
       status = $3, position_id = $4, is_provisional = $5
       RETURNING *`,
      [employee_id, date, status, position_id, is_provisional !== false]
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
        `INSERT INTO schedule (employee_id, date, status, position_id, is_provisional)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (employee_id, date) DO UPDATE SET status = $3, position_id = $4
         RETURNING *`,
        [entry.employee_id, entry.date, entry.status, entry.position_id]
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
      params.push(month + '-01');
      params.push(month + '-31');
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
      [month + '-01', month + '-31']
    );

    res.json(result.rows);
  } catch (err) {
    console.error('[WORK_HOURS] Erreur résumé :', err);
    res.status(500).json({ error: 'Erreur serveur' });
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

module.exports = router;

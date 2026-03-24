const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// ══════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════
const ANTI_DOUBLON_SECONDS = 60; // délai anti-doublon en secondes
const MAX_BADGEAGES_PAR_JOUR = 4; // entrée matin, sortie matin, entrée PM, sortie PM

// ══════════════════════════════════════════
// ENDPOINT BORNE — Pas d'auth utilisateur, auth par clé API
// ══════════════════════════════════════════

// POST /api/pointage/badge — Appelé par le Raspberry Pi
router.post('/badge', async (req, res) => {
  try {
    const { badge_uid, terminal_key } = req.body;

    if (!badge_uid || !terminal_key) {
      return res.status(400).json({ error: 'badge_uid et terminal_key requis' });
    }

    // Vérifier la clé du terminal
    const terminal = await pool.query(
      'SELECT * FROM pointage_terminals WHERE api_key = $1 AND is_active = true',
      [terminal_key]
    );
    if (terminal.rows.length === 0) {
      return res.status(403).json({ error: 'Terminal non autorisé' });
    }

    // Trouver le collaborateur par UID badge
    const badge = await pool.query(
      `SELECT b.*, e.first_name, e.last_name, e.id as employee_id
       FROM badges b
       JOIN employees e ON b.employee_id = e.id
       WHERE b.badge_uid = $1 AND b.is_active = true AND e.is_active = true`,
      [badge_uid]
    );

    if (badge.rows.length === 0) {
      // Enregistrer dans le log même si badge inconnu
      await pool.query(
        `INSERT INTO pointage_events (badge_uid, terminal_id, event_type, status)
         VALUES ($1, $2, 'unknown', 'rejected')`,
        [badge_uid, terminal.rows[0].id]
      );
      return res.status(404).json({ error: 'Badge non reconnu', badge_uid });
    }

    const employee = badge.rows[0];
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();

    // Vérifier anti-doublon (60 secondes)
    const lastEvent = await pool.query(
      `SELECT * FROM pointage_events
       WHERE employee_id = $1 AND status = 'accepted'
       ORDER BY event_time DESC LIMIT 1`,
      [employee.employee_id]
    );

    if (lastEvent.rows.length > 0) {
      const lastTime = new Date(lastEvent.rows[0].event_time);
      const diffSeconds = (now - lastTime) / 1000;
      if (diffSeconds < ANTI_DOUBLON_SECONDS) {
        return res.json({
          status: 'duplicate',
          message: `Doublon ignoré (${Math.round(diffSeconds)}s)`,
          employee_name: `${employee.first_name} ${employee.last_name}`
        });
      }
    }

    // Compter les badgeages du jour
    const dayCount = await pool.query(
      `SELECT COUNT(*) as count FROM pointage_events
       WHERE employee_id = $1 AND date = $2 AND status = 'accepted'`,
      [employee.employee_id, today]
    );

    if (parseInt(dayCount.rows[0].count) >= MAX_BADGEAGES_PAR_JOUR) {
      await pool.query(
        `INSERT INTO pointage_events (employee_id, badge_uid, terminal_id, date, event_type, status, notes)
         VALUES ($1, $2, $3, $4, 'excess', 'rejected', 'Maximum 4 badgeages/jour atteint')`,
        [employee.employee_id, badge_uid, terminal.rows[0].id, today]
      );
      return res.json({
        status: 'rejected',
        message: 'Maximum 4 badgeages par jour atteint',
        employee_name: `${employee.first_name} ${employee.last_name}`
      });
    }

    // Déterminer le type d'événement (entrée/sortie)
    const currentCount = parseInt(dayCount.rows[0].count);
    const event_type = currentCount % 2 === 0 ? 'entry' : 'exit'; // 0,2 = entrée ; 1,3 = sortie

    // Enregistrer l'événement
    const result = await pool.query(
      `INSERT INTO pointage_events (employee_id, badge_uid, terminal_id, date, event_time, event_type, status)
       VALUES ($1, $2, $3, $4, NOW(), $5, 'accepted')
       RETURNING *`,
      [employee.employee_id, badge_uid, terminal.rows[0].id, today, event_type]
    );

    // Si 4 badgeages complets, calculer et insérer les heures dans work_hours
    if (currentCount + 1 === MAX_BADGEAGES_PAR_JOUR) {
      await calculateAndInsertWorkHours(employee.employee_id, today);
    }

    res.json({
      status: 'accepted',
      event_type,
      event_number: currentCount + 1,
      employee_name: `${employee.first_name} ${employee.last_name}`,
      message: event_type === 'entry'
        ? `Bonjour ${employee.first_name} !`
        : `Au revoir ${employee.first_name} !`,
      time: result.rows[0].event_time
    });

  } catch (err) {
    console.error('[POINTAGE] Erreur badge :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Fonction de calcul automatique des heures
async function calculateAndInsertWorkHours(employeeId, date) {
  try {
    const events = await pool.query(
      `SELECT event_time, event_type FROM pointage_events
       WHERE employee_id = $1 AND date = $2 AND status = 'accepted'
       ORDER BY event_time ASC`,
      [employeeId, date]
    );

    if (events.rows.length < 2) return;

    let totalMinutes = 0;
    for (let i = 0; i < events.rows.length - 1; i += 2) {
      const entry = new Date(events.rows[i].event_time);
      const exit = new Date(events.rows[i + 1]?.event_time);
      if (exit) {
        totalMinutes += (exit - entry) / 60000;
      }
    }

    const hoursWorked = Math.round(totalMinutes / 60 * 100) / 100;
    const overtimeHours = Math.max(0, hoursWorked - 7); // au-delà de 7h/jour = heures sup

    // Upsert dans work_hours
    await pool.query(
      `INSERT INTO work_hours (employee_id, date, hours_worked, overtime_hours, type, notes)
       VALUES ($1, $2, $3, $4, 'normal', 'Calculé automatiquement par badgeage')
       ON CONFLICT (employee_id, date)
       DO UPDATE SET hours_worked = $3, overtime_hours = $4, notes = 'Mis à jour par badgeage'`,
      [employeeId, date, hoursWorked, overtimeHours]
    );
  } catch (err) {
    console.error('[POINTAGE] Erreur calcul heures :', err);
  }
}

// ══════════════════════════════════════════
// ROUTES PROTÉGÉES — Interface web Solidata
// ══════════════════════════════════════════
router.use(authenticate);

// GET /api/pointage/events — Liste des événements de pointage
router.get('/events', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { date, employee_id, status, limit = 100, offset = 0 } = req.query;
    let query = `
      SELECT pe.*, e.first_name, e.last_name, t.name as terminal_name
      FROM pointage_events pe
      LEFT JOIN employees e ON pe.employee_id = e.id
      LEFT JOIN pointage_terminals t ON pe.terminal_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (date) { params.push(date); query += ` AND pe.date = $${params.length}`; }
    if (employee_id) { params.push(employee_id); query += ` AND pe.employee_id = $${params.length}`; }
    if (status) { params.push(status); query += ` AND pe.status = $${params.length}`; }

    query += ` ORDER BY pe.event_time DESC`;
    params.push(parseInt(limit)); query += ` LIMIT $${params.length}`;
    params.push(parseInt(offset)); query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    // Compter le total
    let countQuery = `SELECT COUNT(*) FROM pointage_events pe WHERE 1=1`;
    const countParams = [];
    if (date) { countParams.push(date); countQuery += ` AND pe.date = $${countParams.length}`; }
    if (employee_id) { countParams.push(employee_id); countQuery += ` AND pe.employee_id = $${countParams.length}`; }
    if (status) { countParams.push(status); countQuery += ` AND pe.status = $${countParams.length}`; }
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      events: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('[POINTAGE] Erreur liste events :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/pointage/daily-summary — Résumé journalier pour tous les collaborateurs
router.get('/daily-summary', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { date = new Date().toISOString().slice(0, 10) } = req.query;

    const result = await pool.query(`
      SELECT
        e.id as employee_id, e.first_name, e.last_name, e.team_id, t.name as team_name,
        COALESCE(json_agg(
          json_build_object('event_time', pe.event_time, 'event_type', pe.event_type)
          ORDER BY pe.event_time
        ) FILTER (WHERE pe.id IS NOT NULL), '[]') as events,
        COUNT(pe.id) FILTER (WHERE pe.status = 'accepted') as badge_count,
        wh.hours_worked, wh.overtime_hours, wh.validated_by
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN pointage_events pe ON pe.employee_id = e.id AND pe.date = $1 AND pe.status = 'accepted'
      LEFT JOIN work_hours wh ON wh.employee_id = e.id AND wh.date = $1
      WHERE e.is_active = true
      GROUP BY e.id, e.first_name, e.last_name, e.team_id, t.name, wh.hours_worked, wh.overtime_hours, wh.validated_by
      ORDER BY e.last_name, e.first_name
    `, [date]);

    res.json(result.rows);
  } catch (err) {
    console.error('[POINTAGE] Erreur daily-summary :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/pointage/monthly-summary — Résumé mensuel
router.get('/monthly-summary', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { month = new Date().toISOString().slice(0, 7) } = req.query;
    const startDate = `${month}-01`;
    const endDate = `${month}-31`;

    const result = await pool.query(`
      SELECT
        e.id as employee_id, e.first_name, e.last_name, e.weekly_hours,
        t.name as team_name,
        COALESCE(SUM(wh.hours_worked), 0) as total_hours,
        COALESCE(SUM(wh.overtime_hours), 0) as total_overtime,
        COUNT(DISTINCT wh.date) as days_worked,
        COUNT(DISTINCT pe.date) FILTER (WHERE pe.status = 'accepted') as days_badged
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN work_hours wh ON wh.employee_id = e.id AND wh.date BETWEEN $1 AND $2
      LEFT JOIN pointage_events pe ON pe.employee_id = e.id AND pe.date BETWEEN $1 AND $2
      WHERE e.is_active = true
      GROUP BY e.id, e.first_name, e.last_name, e.weekly_hours, t.name
      ORDER BY e.last_name, e.first_name
    `, [startDate, endDate]);

    res.json(result.rows);
  } catch (err) {
    console.error('[POINTAGE] Erreur monthly-summary :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/pointage/manual — Saisie manuelle d'heures (manager)
router.post('/manual', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { employee_id, date, entry_am, exit_am, entry_pm, exit_pm, notes } = req.body;

    if (!employee_id || !date) {
      return res.status(400).json({ error: 'employee_id et date requis' });
    }

    // Supprimer les anciens événements manuels du jour
    await pool.query(
      `DELETE FROM pointage_events WHERE employee_id = $1 AND date = $2 AND source = 'manual'`,
      [employee_id, date]
    );

    const times = [
      { time: entry_am, type: 'entry' },
      { time: exit_am, type: 'exit' },
      { time: entry_pm, type: 'entry' },
      { time: exit_pm, type: 'exit' },
    ].filter(t => t.time);

    for (const t of times) {
      await pool.query(
        `INSERT INTO pointage_events (employee_id, date, event_time, event_type, status, source, notes, created_by)
         VALUES ($1, $2, $3, $4, 'accepted', 'manual', $5, $6)`,
        [employee_id, date, `${date} ${t.time}`, t.type, notes || 'Saisie manuelle', req.user.id]
      );
    }

    // Recalculer les heures
    if (times.length >= 2) {
      await calculateAndInsertWorkHours(employee_id, date);
    }

    res.json({ message: 'Heures saisies manuellement', count: times.length });
  } catch (err) {
    console.error('[POINTAGE] Erreur saisie manuelle :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// GESTION DES BADGES
// ══════════════════════════════════════════

// GET /api/pointage/badges — Liste tous les badges
router.get('/badges', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*, e.first_name, e.last_name, e.is_active as employee_active
      FROM badges b
      LEFT JOIN employees e ON b.employee_id = e.id
      ORDER BY b.assigned_at DESC NULLS LAST, b.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[POINTAGE] Erreur liste badges :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/pointage/badges — Créer/enregistrer un badge
router.post('/badges', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { badge_uid, employee_id, label } = req.body;

    if (!badge_uid) {
      return res.status(400).json({ error: 'badge_uid requis' });
    }

    // Vérifier si le badge existe déjà
    const existing = await pool.query('SELECT * FROM badges WHERE badge_uid = $1', [badge_uid]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Ce badge est déjà enregistré', badge: existing.rows[0] });
    }

    const result = await pool.query(
      `INSERT INTO badges (badge_uid, employee_id, label, is_active, assigned_at)
       VALUES ($1, $2, $3, true, $4)
       RETURNING *`,
      [badge_uid, employee_id || null, label || null, employee_id ? new Date() : null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POINTAGE] Erreur création badge :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/pointage/badges/:id/assign — Affecter un badge à un collaborateur
router.put('/badges/:id/assign', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { employee_id } = req.body;

    // Désactiver l'ancien badge du collaborateur s'il en avait un
    if (employee_id) {
      await pool.query(
        'UPDATE badges SET is_active = false, unassigned_at = NOW() WHERE employee_id = $1 AND is_active = true',
        [employee_id]
      );
    }

    const result = await pool.query(
      `UPDATE badges SET employee_id = $1, assigned_at = NOW(), is_active = true, unassigned_at = NULL
       WHERE id = $2 RETURNING *`,
      [employee_id, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Badge non trouvé' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[POINTAGE] Erreur affectation badge :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/pointage/badges/:id/deactivate — Désactiver un badge
router.put('/badges/:id/deactivate', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE badges SET is_active = false, unassigned_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Badge non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[POINTAGE] Erreur désactivation badge :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// GESTION DES TERMINAUX
// ══════════════════════════════════════════

// GET /api/pointage/terminals
router.get('/terminals', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM pointage_terminals ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/pointage/terminals
router.post('/terminals', authorize('ADMIN'), async (req, res) => {
  try {
    const { name, location, api_key } = req.body;
    const result = await pool.query(
      `INSERT INTO pointage_terminals (name, location, api_key) VALUES ($1, $2, $3) RETURNING *`,
      [name, location || 'Centre de tri', api_key]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POINTAGE] Erreur création terminal :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// ALERTES NON-BADGEAGE
// ══════════════════════════════════════════

// GET /api/pointage/alerts — Collaborateurs planifiés mais non badgés
router.get('/alerts', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { date = new Date().toISOString().slice(0, 10) } = req.query;

    // Collaborateurs planifiés en "work" mais sans badgeage
    const result = await pool.query(`
      SELECT
        e.id as employee_id, e.first_name, e.last_name,
        t.name as team_name, s.status as schedule_status,
        CASE
          WHEN pe.count IS NULL OR pe.count = 0 THEN 'absent'
          WHEN pe.count < 4 THEN 'incomplete'
          ELSE 'ok'
        END as alert_type
      FROM employees e
      JOIN schedule s ON s.employee_id = e.id AND s.date = $1
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN (
        SELECT employee_id, COUNT(*) as count
        FROM pointage_events
        WHERE date = $1 AND status = 'accepted'
        GROUP BY employee_id
      ) pe ON pe.employee_id = e.id
      WHERE e.is_active = true
        AND s.status = 'work'
        AND (pe.count IS NULL OR pe.count < 4)
      ORDER BY
        CASE WHEN pe.count IS NULL OR pe.count = 0 THEN 0 ELSE 1 END,
        e.last_name
    `, [date]);

    res.json(result.rows);
  } catch (err) {
    console.error('[POINTAGE] Erreur alertes :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/pointage/movement-log — Registre des mouvements
router.get('/movement-log', authorize('ADMIN', 'RH', 'MANAGER'), async (req, res) => {
  try {
    const { date_from, date_to, employee_id, limit = 200, offset = 0 } = req.query;
    let query = `
      SELECT pe.*, e.first_name, e.last_name, t.name as terminal_name,
        CASE WHEN pe.created_by IS NOT NULL THEN u.first_name || ' ' || u.last_name END as created_by_name
      FROM pointage_events pe
      LEFT JOIN employees e ON pe.employee_id = e.id
      LEFT JOIN pointage_terminals t ON pe.terminal_id = t.id
      LEFT JOIN users u ON pe.created_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (date_from) { params.push(date_from); query += ` AND pe.date >= $${params.length}`; }
    if (date_to) { params.push(date_to); query += ` AND pe.date <= $${params.length}`; }
    if (employee_id) { params.push(employee_id); query += ` AND pe.employee_id = $${params.length}`; }

    query += ` ORDER BY pe.event_time DESC`;
    params.push(parseInt(limit)); query += ` LIMIT $${params.length}`;
    params.push(parseInt(offset)); query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[POINTAGE] Erreur movement-log :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

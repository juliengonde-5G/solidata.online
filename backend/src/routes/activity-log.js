const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// GET /api/activity-log — Journal d'activité (ADMIN uniquement)
router.get('/', authorize('ADMIN'), async (req, res) => {
  try {
    const { user_id, action, entity_type, limit: lim, offset: off } = req.query;
    let query = `SELECT al.*, u.first_name, u.last_name, u.role
                 FROM user_activity_log al
                 LEFT JOIN users u ON al.user_id = u.id
                 WHERE 1=1`;
    const params = [];

    if (user_id) { params.push(user_id); query += ` AND al.user_id = $${params.length}`; }
    if (action) { params.push(action); query += ` AND al.action = $${params.length}`; }
    if (entity_type) { params.push(entity_type); query += ` AND al.entity_type = $${params.length}`; }

    query += ' ORDER BY al.created_at DESC';
    params.push(parseInt(lim) || 100);
    query += ` LIMIT $${params.length}`;
    params.push(parseInt(off) || 0);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    // Compteur total
    let countQuery = 'SELECT COUNT(*) FROM user_activity_log WHERE 1=1';
    const countParams = [];
    if (user_id) { countParams.push(user_id); countQuery += ` AND user_id = $${countParams.length}`; }
    if (action) { countParams.push(action); countQuery += ` AND action = $${countParams.length}`; }
    if (entity_type) { countParams.push(entity_type); countQuery += ` AND entity_type = $${countParams.length}`; }
    const countResult = await pool.query(countQuery, countParams);

    res.json({ rows: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    console.error('[ACTIVITY-LOG] Erreur GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/activity-log/stats — Statistiques d'activité
router.get('/stats', authorize('ADMIN'), async (req, res) => {
  try {
    const [byAction, byUser, recent] = await Promise.all([
      pool.query(`SELECT action, COUNT(*) as count FROM user_activity_log
                  WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY action ORDER BY count DESC`),
      pool.query(`SELECT al.user_id, u.first_name, u.last_name, COUNT(*) as count
                  FROM user_activity_log al LEFT JOIN users u ON al.user_id = u.id
                  WHERE al.created_at > NOW() - INTERVAL '30 days'
                  GROUP BY al.user_id, u.first_name, u.last_name ORDER BY count DESC LIMIT 10`),
      pool.query(`SELECT COUNT(*) as today FROM user_activity_log WHERE created_at::date = CURRENT_DATE`),
    ]);
    res.json({
      by_action: byAction.rows,
      by_user: byUser.rows,
      today: parseInt(recent.rows[0].today),
    });
  } catch (err) {
    console.error('[ACTIVITY-LOG] Erreur stats :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

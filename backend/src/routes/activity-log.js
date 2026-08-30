const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { requireMfa } = require('../middleware/mfa');

router.use(authenticate);
// Double authentification (2.43.0) : pour les rôles soumis (settings
// « securite.mfa_roles », défaut ADMIN/RH/DPO), la session doit avoir
// franchi le défi TOTP. No-op intégral pour les autres rôles.
router.use(requireMfa);

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
    let countQuery = 'SELECT COUNT(*) as count FROM user_activity_log WHERE 1=1';
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

// GET /api/activity-log/connections — Historique des connexions/déconnexions
router.get('/connections', authorize('ADMIN'), async (req, res) => {
  try {
    const { user_id, limit: lim, offset: off } = req.query;
    let query = `SELECT al.*, u.first_name, u.last_name, u.role
                 FROM user_activity_log al
                 LEFT JOIN users u ON al.user_id = u.id
                 WHERE al.action IN ('login', 'logout', 'password_change', 'login_failed')`;
    const params = [];

    if (user_id) { params.push(user_id); query += ` AND al.user_id = $${params.length}`; }

    query += ' ORDER BY al.created_at DESC';
    params.push(parseInt(lim) || 100);
    query += ` LIMIT $${params.length}`;
    params.push(parseInt(off) || 0);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    let countQuery = `SELECT COUNT(*) as count FROM user_activity_log
                      WHERE action IN ('login', 'logout', 'password_change', 'login_failed')`;
    const countParams = [];
    if (user_id) { countParams.push(user_id); countQuery += ` AND user_id = $${countParams.length}`; }
    const countResult = await pool.query(countQuery, countParams);

    res.json({ rows: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    console.error('[ACTIVITY-LOG] Erreur connections :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/activity-log/sessions — Sessions actives et historique
router.get('/sessions', authorize('ADMIN'), async (req, res) => {
  try {
    const { active_only } = req.query;
    let query = `SELECT s.*, u.username, u.first_name, u.last_name, u.role
                 FROM user_sessions s
                 LEFT JOIN users u ON s.user_id = u.id`;
    if (active_only === 'true') {
      query += ' WHERE s.is_active = true';
    }
    query += ' ORDER BY s.last_activity DESC LIMIT 200';

    const result = await pool.query(query);

    // Compteur sessions actives
    const activeCount = await pool.query('SELECT COUNT(*) as count FROM user_sessions WHERE is_active = true');

    res.json({
      rows: result.rows,
      active_count: parseInt(activeCount.rows[0].count),
    });
  } catch (err) {
    console.error('[ACTIVITY-LOG] Erreur sessions :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/activity-log/sessions/:id — Forcer la déconnexion d'une session
router.delete('/sessions/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE user_sessions SET is_active = false, ended_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session non trouvée' });

    // Révocation EFFECTIVE (audit vague 3, item 3.C-1) : fermer la ligne de
    // session ne suffisait pas (le JWT d'accès restait valide jusqu'à 8 h — le
    // « forcer la déconnexion » était cosmétique). On incrémente token_version
    // (invalide les access tokens du compte) ET on purge ses refresh tokens
    // (empêche le renouvellement). NB : granularité PAR UTILISATEUR — une seule
    // token_version par compte, donc toutes les sessions de l'utilisateur sont
    // coupées, pas uniquement celle-ci. Amélioration majeure vs l'existant.
    const uid = result.rows[0].user_id;
    if (uid != null) {
      await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [uid]);
      await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [uid]);
    }

    res.json({ message: 'Session fermée', session: result.rows[0] });
  } catch (err) {
    console.error('[ACTIVITY-LOG] Erreur delete session :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

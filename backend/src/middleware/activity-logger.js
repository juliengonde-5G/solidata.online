const pool = require('../config/database');

// Auto-migration : ajouter la colonne username si absente
(async () => {
  try {
    await pool.query(`ALTER TABLE user_activity_log ADD COLUMN IF NOT EXISTS username VARCHAR(100)`);
  } catch (e) { /* table pas encore créée — OK */ }
})();

/**
 * Log une action utilisateur dans user_activity_log
 * @param {object} params - { userId, username, action, entityType, entityId, details, ip }
 */
async function logActivity({ userId, username, action, entityType, entityId, details, ip }) {
  try {
    await pool.query(
      `INSERT INTO user_activity_log (user_id, username, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, username, action, entityType || null, entityId || null, details ? JSON.stringify(details) : null, ip || null]
    );
  } catch (err) {
    console.error('[ACTIVITY-LOG] Erreur écriture :', err.message);
  }
}

/**
 * Middleware Express qui log automatiquement les mutations (POST/PUT/DELETE)
 */
function autoLogActivity(entityType) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function (data) {
      // Logger seulement les mutations réussies
      if (['POST', 'PUT', 'DELETE'].includes(req.method) && res.statusCode < 400 && req.user) {
        const actionMap = { POST: 'create', PUT: 'update', DELETE: 'delete' };
        const entityId = data?.id || req.params?.id;
        logActivity({
          userId: req.user.id,
          username: req.user.username,
          action: actionMap[req.method],
          entityType,
          entityId: entityId ? parseInt(entityId) : null,
          details: { method: req.method, path: req.originalUrl },
          ip: req.ip,
        });
      }
      return originalJson(data);
    };
    next();
  };
}

module.exports = { logActivity, autoLogActivity };

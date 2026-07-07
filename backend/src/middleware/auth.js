const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'change-this-in-production') {
  console.error('[FATAL] JWT_SECRET non configuré en production. Arrêt immédiat.');
  process.exit(1);
}

/**
 * Middleware d'authentification JWT
 * Vérifie le token Bearer et attache req.user
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token d\'authentification requis' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
}

// Cache { role_key personnalisé → base_role intégré }. Rafraîchi périodiquement
// et à chaud à la création/suppression d'un rôle (refreshCustomRoles).
let customRoleBase = {};
async function refreshCustomRoles() {
  try {
    const r = await pool.query('SELECT role_key, base_role FROM custom_roles');
    const map = {};
    for (const row of r.rows) map[row.role_key] = row.base_role;
    customRoleBase = map;
  } catch (_) { /* table pas encore créée : aucun rôle custom */ }
}
refreshCustomRoles();
const _t = setInterval(refreshCustomRoles, 60000);
if (_t.unref) _t.unref();

// Rôle « effectif » : un rôle personnalisé hérite des accès de son rôle de base.
function resolveBaseRole(role) {
  return customRoleBase[role] || role;
}

/**
 * Middleware d'autorisation par rôles
 * Usage : authorize('ADMIN', 'MANAGER')
 * Un rôle personnalisé passe s'il l'est explicitement OU si son rôle de base
 * figure dans la liste (les rôles intégrés se résolvent vers eux-mêmes).
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    const role = req.user.role;
    if (roles.includes(role) || roles.includes(resolveBaseRole(role))) {
      return next();
    }
    return res.status(403).json({ error: 'Accès non autorisé pour ce rôle' });
  };
}

module.exports = { authenticate, authorize, refreshCustomRoles, resolveBaseRole };

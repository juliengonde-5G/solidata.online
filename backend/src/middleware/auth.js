const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'change-this-in-production') {
  console.error('[FATAL] JWT_SECRET non configuré en production. Arrêt immédiat.');
  process.exit(1);
}

/**
 * Middleware d'authentification JWT
 * Vérifie le token Bearer, contrôle la révocation de session, attache req.user.
 *
 * Révocation effective (audit vague 3, item 3.C-1) — approche « token_version »
 * sans Redis. Le JWT d'accès porte `tv` = users.token_version au moment de son
 * émission. Toute action de révocation (logout, reset mot de passe, désactivation
 * du compte, déconnexion forcée d'une session) incrémente users.token_version en
 * base : tout jeton portant l'ancien `tv` est alors rejeté (401 TOKEN_REVOKED,
 * capté par le front comme une expiration → redirection connexion).
 *
 * Coût : une lecture indexée par clé primaire (users.id) par requête authentifiée
 * — jugé acceptable pour cet ERP (cf. audit). Aucun cache, pour garder une
 * révocation immédiate.
 *
 * Rétro-compatibilité / non-régression : un jeton émis AVANT ce déploiement ne
 * porte pas `tv` → le contrôle est sauté (il expire de lui-même en ≤ 8 h, et
 * aucune lecture base n'est faite pour lui). Une panne de base ne verrouille
 * personne : on dégrade en simple validation JWT (comportement historique).
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token d\'authentification requis' });
  }

  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }

  req.user = decoded;

  // Jeton hérité sans `tv` (transitoire) : aucun contrôle de révocation possible,
  // aucune lecture base. Se résorbe seul en ≤ 8 h (durée de vie de l'access token).
  if (decoded.tv === undefined || decoded.tv === null) {
    return next();
  }

  const uid = decoded.id != null ? decoded.id : decoded.userId;
  if (uid == null) return next();

  try {
    const r = await pool.query('SELECT token_version FROM users WHERE id = $1', [uid]);
    // Utilisateur introuvable : on ne bloque pas ici (comportement historique ;
    // /auth/me renvoie 404 et les routes sensibles restent gardées par authorize).
    if (r && r.rows && r.rows.length > 0) {
      const dbTv = r.rows[0].token_version == null ? 0 : r.rows[0].token_version;
      if (dbTv !== decoded.tv) {
        return res.status(401).json({ error: 'Session expirée, reconnecte-toi', code: 'TOKEN_REVOKED' });
      }
    }
    return next();
  } catch (e) {
    // Non-régression : une panne base ne doit pas verrouiller toute l'application.
    console.error('[AUTH] Contrôle token_version indisponible :', e.message);
    return next();
  }
}

// Politique de mot de passe unifiée (audit vague 3, item 3.C-2). Volontairement
// simple : longueur minimale, sans règle de composition arbitraire (aligné sur
// les recommandations NIST/CNIL qui privilégient la longueur). Utilisé par les
// trois points d'écriture de mot de passe (self-service, création, réinit admin).
// Retourne un message d'erreur (string) si invalide, ou null si valide.
const MIN_PASSWORD_LENGTH = 10;
function validatePassword(pwd) {
  if (typeof pwd !== 'string' || pwd.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`;
  }
  return null;
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

module.exports = { authenticate, authorize, refreshCustomRoles, resolveBaseRole, validatePassword, MIN_PASSWORD_LENGTH };

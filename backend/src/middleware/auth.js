const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { verifierCle, toucherCle, METHODES_LECTURE } = require('./api-key');
const { logActivity } = require('./activity-logger');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'change-this-in-production') {
  console.error('[FATAL] JWT_SECRET non configuré en production. Arrêt immédiat.');
  process.exit(1);
}

/**
 * IDENTITÉ DE SERVICE PAR CLÉ D'API (2.45.0)
 * ═══════════════════════════════════════════
 * Pourquoi : le test post-déploiement (`scripts/tests/api-smoke.js`) se
 * connectait avec un VRAI compte ADMIN dont l'identifiant, le mot de passe ET
 * — depuis la 2.43.0 — le secret TOTP vivaient côte à côte dans le `.env` du
 * serveur. Ranger les deux facteurs au même endroit annule le bénéfice de la
 * double authentification : ce n'était plus qu'un mot de passe en deux
 * morceaux. Une clé d'API dédiée est un secret unique, à portée limitée,
 * révocable et expirable, qui n'ouvre AUCUNE session humaine.
 *
 * Ce qu'une clé de service peut : les mêmes LECTURES que le rôle qu'elle porte.
 * Ce qu'elle ne peut pas : écrire quoi que ce soit (garde structurelle
 * ci-dessous), ni se connecter, ni changer un mot de passe, ni s'enrôler.
 *
 * LECTURE SEULE — c'est la garantie qui rend acceptable un rôle élevé. Le
 * contrôle est posé DANS `authenticate`, donc sur toute route qui l'emprunte :
 * aucun routeur ne peut l'oublier, aucun ajout futur ne peut y échapper. Une
 * clé volée ne peut rien écrire, rien supprimer, rien purger.
 *
 * MFA — le claim `mfa` vaut `true` PAR CONSTRUCTION, et c'est délibéré : la
 * double authentification est une mesure destinée aux PERSONNES PHYSIQUES (un
 * mot de passe se devine, se réutilise, se donne au téléphone). Une clé est
 * déjà un secret fort, à portée limitée, révocable et expirable ; exiger d'elle
 * un second facteur n'ajouterait aucune sécurité et obligerait à stocker les
 * deux facteurs au même endroit — précisément le défaut que ce chantier
 * corrige.
 *
 * RÉVOCATION — il n'y a pas de `token_version` à contrôler (aucun jeton n'est
 * émis) : la révocation est IMMÉDIATE et se fait sur la clé elle-même
 * (`active = false`, `expires_at`, ou suppression) — meilleur que pour un JWT,
 * qui survit jusqu'à son expiration.
 */
async function authenticateServiceKey(req, res, next, rawKey) {
  let verdict;
  try {
    verdict = await verifierCle(rawKey, { service: true });
  } catch (err) {
    console.error('[AUTH-SERVICE] Vérification de clé indisponible :', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
  if (!verdict.ok) {
    const corps = { error: verdict.error };
    if (verdict.code) corps.code = verdict.code;
    return res.status(verdict.status).json(corps);
  }

  // Garde de LECTURE SEULE — vérifiée après la clé pour que le message dise la
  // vraie raison du refus (une clé invalide reste un 401, pas un « lecture
  // seule » trompeur).
  if (!METHODES_LECTURE.has(req.method)) {
    // Une tentative d'écriture avec une clé de service est un SIGNAL : soit un
    // script mal câblé, soit une clé qui a fuité. On la trace comme telle —
    // c'est même l'entrée la plus intéressante du journal.
    logActivity({
      userId: null,
      username: `api:${verdict.key.name}`,
      action: 'service_api_call',
      entityType: 'api_key',
      entityId: verdict.key.id,
      details: { method: req.method, path: req.originalUrl || req.url, refuse: 'lecture_seule' },
      ip: req.ip,
    });
    return res.status(403).json({
      error: "Une clé d'API de service est en lecture seule : cette opération d'écriture est refusée",
      code: 'SERVICE_KEY_READ_ONLY',
    });
  }

  req.user = {
    id: null,                                   // aucune personne derrière cette identité
    username: `api:${verdict.key.name}`,        // lisible au journal, jamais un vrai identifiant
    role: verdict.key.service_role,
    mfa: true,                                  // par construction — cf. en-tête
    is_service: true,
    api_key_id: verdict.key.id,
  };
  req.apiKey = { id: verdict.key.id, name: verdict.key.name, scopes: verdict.key.scopes };

  // Traçabilité (best-effort, jamais bloquante) : `last_used_at` dit QUAND la
  // clé a servi pour la dernière fois, le journal d'activité dit À QUOI.
  toucherCle(verdict.key.id);
  logActivity({
    userId: null,
    username: req.user.username,
    action: 'service_api_call',
    entityType: 'api_key',
    entityId: verdict.key.id,
    details: { method: req.method, path: req.originalUrl || req.url, role: req.user.role },
    ip: req.ip,
  });

  return next();
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

  // Identité de SERVICE par clé d'API. Le Bearer JWT reste PRIORITAIRE : une
  // requête humaine se comporte exactement comme avant, même si un en-tête
  // X-API-Key traîne. Sans Bearer et avec une clé, on bascule sur le chemin de
  // service (lecture seule, cf. authenticateServiceKey).
  const rawKey = req.get ? req.get('x-api-key') : (req.headers && req.headers['x-api-key']);
  if ((!authHeader || !authHeader.startsWith('Bearer ')) && rawKey) {
    return authenticateServiceKey(req, res, next, rawKey);
  }

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

  // `is_service` n'est JAMAIS un attribut de personne : seule la branche clé
  // d'API ci-dessus peut le poser. On l'efface ici de façon structurelle pour
  // qu'un jeton qui le porterait (bug d'émission, jeton fabriqué avec le secret)
  // ne puisse pas se faire passer pour un service, ni hériter d'un traitement
  // particulier.
  req.user = { ...decoded, is_service: false };

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

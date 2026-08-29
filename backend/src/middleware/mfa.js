/**
 * Double authentification (MFA/TOTP) — garde d'accès aux surfaces sensibles.
 * Chantier 2.43.0.
 *
 * PRINCIPE — le jeton d'accès porte un claim `mfa` (true|false) posé à
 * l'émission (routes/auth.js) :
 *   - `true`  : la session a franchi le défi TOTP, OU le rôle n'est pas soumis
 *               à la double authentification (le claim est alors posé à true
 *               d'office, pour que ce middleware et le contrôle Socket.IO
 *               restent une simple comparaison, sans cas particulier) ;
 *   - `false` : compte soumis à la double authentification mais PAS ENCORE
 *               enrôlé (il vient de se connecter, l'écran d'enrôlement le
 *               bloque côté front — mais c'est ICI que la fermeture est réelle).
 *
 * QUI EST SOUMIS — liste paramétrable dans `settings`, clé
 * « securite.mfa_roles » (tableau JSON de rôles de BASE), défaut EN CODE
 * ['ADMIN','RH','DPO','PCM'] : les rôles qui accèdent à des données
 * personnelles sensibles (parcours d'insertion, santé, judiciaire, profils de
 * personnalité, registre RGPD, sauvegarde de la base). Comme partout dans le
 * projet, aucun seed en base : la valeur par défaut vit dans le code et la
 * table ne sert qu'à la surcharger.
 *
 * MANAGER n'est délibérément PAS soumis (encadrants de terrain, surfaces déjà
 * masquées) ; les chauffeurs (jetons `driver-start`, rôle COLLABORATEUR en dur)
 * et les jobs du scheduler ne passent jamais par ici.
 *
 * ROLES PERSONNALISÉS : un rôle dupliqué est soumis si SON RÔLE DE BASE l'est
 * (resolveBaseRole) — sans quoi dupliquer « RH » suffirait à contourner la
 * double authentification.
 *
 * JETON HÉRITÉ (émis avant ce déploiement, donc sans claim `mfa`) d'un rôle
 * soumis → BLOQUÉ (403 MFA_REQUIRED). C'est un écart ASSUMÉ avec la doctrine de
 * dégradation douce des jetons sans `tv` : ici, laisser passer reviendrait à
 * offrir jusqu'à 8 h de contournement de la fonctionnalité qu'on installe.
 * L'utilisateur se reconnecte, et c'est tout.
 *
 * OÙ CE MIDDLEWARE EST CÂBLÉ (une ligne après le `authenticate` de chaque
 * routeur ciblé — il a besoin de `req.user`) :
 *   /api/insertion, /api/pcm, /api/employees, /api/candidates, /api/exports,
 *   /api/rgpd, /api/users, /api/permissions (administration de la matrice
 *   seulement — `/my-modules` et `/catalog` restent ouverts, le premier étant
 *   chargé par le front DÈS la connexion, avant tout enrôlement),
 *   /api/admin-db, /api/activity-log, /api/effectifs.
 * Plus le handshake Socket.IO (backend/src/index.js) : sans lui, une session
 * non enrôlée garderait le flux temps réel (messagerie) ouvert.
 *
 * Pour les rôles NON soumis, tout ceci est un no-op intégral : aucune
 * régression attendue sur MANAGER / AUTORITE / QHSE / FINANCE / RESP_BTQ…
 */
const pool = require('../config/database');
const { resolveBaseRole } = require('./auth');

// Défaut EN CODE (aucun seed en base) — cf. en-tête.
const DEFAULT_MFA_ROLES = ['ADMIN', 'RH', 'DPO', 'PCM'];
const SETTING_KEY = 'securite.mfa_roles';
const CACHE_TTL_MS = 60 * 1000;

// Cache mémoire : la liste est lue à chaque requête authentifiée d'un routeur
// sensible, une lecture base par appel serait gratuite. 60 s = le même ordre de
// grandeur que le cache des rôles personnalisés (middleware/auth.js).
let cachedRoles = DEFAULT_MFA_ROLES.slice();
let cachedAt = 0;

/** Normalise une valeur de settings en liste de rôles exploitable. */
function parseRoles(raw) {
  if (raw == null || raw === '') return null;
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const roles = parsed
    .map((r) => (typeof r === 'string' ? r.trim().toUpperCase() : null))
    .filter((r) => r);
  // Une liste VIDE est une valeur légitime (« plus personne n'est soumis »),
  // mais elle désarme la fonctionnalité entière : on l'accepte, en le disant.
  if (roles.length === 0) {
    console.warn(`[MFA] Réglage ${SETTING_KEY} vide — plus aucun rôle n'est soumis à la double authentification`);
  }
  return roles;
}

/**
 * Liste des rôles de base soumis à la double authentification.
 * Résiliente : table absente, valeur illisible, panne base → défaut en code
 * (jamais de désactivation accidentelle de la sécurité par un incident base).
 * @returns {Promise<string[]>}
 */
async function getMfaRoles() {
  if (Date.now() - cachedAt < CACHE_TTL_MS) return cachedRoles;
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [SETTING_KEY]);
    const roles = parseRoles(r.rows[0]?.value);
    cachedRoles = roles === null ? DEFAULT_MFA_ROLES.slice() : roles;
  } catch (_) {
    cachedRoles = DEFAULT_MFA_ROLES.slice();
  }
  cachedAt = Date.now();
  return cachedRoles;
}

/**
 * Version SYNCHRONE, sur le cache — pour les points d'appel qui ne peuvent pas
 * attendre une lecture base (handshake Socket.IO, composition de /auth/me).
 * Le cache est amorcé au défaut en code puis rafraîchi par getMfaRoles().
 * @param {string} role rôle brut du jeton (intégré ou personnalisé)
 * @returns {boolean}
 */
function isMfaRole(role) {
  if (!role) return false;
  const base = resolveBaseRole(role);
  return cachedRoles.includes(base);
}

// Amorce + rafraîchissement périodique du cache (même schéma que le cache des
// rôles personnalisés de middleware/auth.js). `unref` pour ne pas retenir le
// process (jobs, tests).
getMfaRoles().catch(() => { /* défaut en code déjà en place */ });
const _t = setInterval(() => { cachedAt = 0; getMfaRoles().catch(() => {}); }, CACHE_TTL_MS);
if (_t.unref) _t.unref();

/** Vide le cache — utilisé par les tests et après modification du réglage. */
function resetMfaRolesCache() {
  cachedRoles = DEFAULT_MFA_ROLES.slice();
  cachedAt = 0;
}

/**
 * Middleware — exige une session ayant franchi la double authentification pour
 * les rôles soumis. No-op pour les autres.
 * À monter APRÈS `authenticate` (il lit `req.user`).
 */
async function requireMfa(req, res, next) {
  // Même contrat que `authorize` : sans identité, il n'y a rien à vérifier et
  // ce middleware n'est pas là pour authentifier.
  if (!req.user) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  let roles;
  try {
    roles = await getMfaRoles();
  } catch (_) {
    roles = DEFAULT_MFA_ROLES;
  }
  const base = resolveBaseRole(req.user.role);
  if (!roles.includes(base)) return next();      // rôle hors périmètre
  if (req.user.mfa === true) return next();      // défi franchi (ou hors périmètre à l'émission)
  return res.status(403).json({
    error: 'Double authentification requise. Reconnectez-vous pour l\'activer.',
    code: 'MFA_REQUIRED',
  });
}

module.exports = {
  requireMfa,
  isMfaRole,
  getMfaRoles,
  resetMfaRolesCache,
  DEFAULT_MFA_ROLES,
  SETTING_KEY,
};

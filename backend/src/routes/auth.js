const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const { authenticate, resolveBaseRole, validatePassword, MIN_PASSWORD_LENGTH } = require('../middleware/auth');
const { getMfaRoles, getMfaDureeHeures, mfaExpiree } = require('../middleware/mfa');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { logActivity } = require('../middleware/activity-logger');
const totpLib = require('../utils/totp');
const { encryptSecret, decryptSecret } = require('../utils/mfa-crypto');

// Verrouillage léger anti-brute-force (audit vague 3, item 3.C-3).
// ~8 échecs sur une fenêtre glissante de 15 min → blocage temporaire de 15 min.
// Jamais de blocage définitif (pas de DoS possible sur un compte).
const MAX_FAILED_LOGINS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

// Enregistre un échec de connexion et applique le verrouillage temporaire au
// franchissement du seuil. Fenêtre glissante : un échec isolé hors fenêtre
// repart à 1. Au verrouillage, le compteur est remis à 0 → après expiration du
// blocage, l'utilisateur repart sur une fenêtre neuve (aucun blocage définitif).
async function registerFailedLogin(user) {
  const now = Date.now();
  const last = user.last_failed_login_at ? new Date(user.last_failed_login_at).getTime() : 0;
  const withinWindow = last && (now - last) < LOGIN_WINDOW_MS;
  const nextCount = withinWindow ? ((user.failed_login_count || 0) + 1) : 1;
  const lock = nextCount >= MAX_FAILED_LOGINS;
  const lockedUntil = lock ? new Date(now + LOCKOUT_MS) : null;
  await pool.query(
    'UPDATE users SET failed_login_count = $1, last_failed_login_at = NOW(), locked_until = $2 WHERE id = $3',
    [lock ? 0 : nextCount, lockedUntil, user.id]
  );
}

// Centralisé — fail-fast si non défini en production (cf. middleware/auth.js)
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'change-this-in-production') {
  console.error('[FATAL] JWT_SECRET non configuré en production (routes/auth.js).');
  process.exit(1);
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

function parseExpiry(str) {
  const match = str.match(/^(\d+)([hdm])$/);
  if (!match) return 8 * 3600 * 1000;
  const val = parseInt(match[1]);
  const unit = match[2];
  if (unit === 'h') return val * 3600 * 1000;
  if (unit === 'd') return val * 86400 * 1000;
  if (unit === 'm') return val * 60 * 1000;
  return val * 1000;
}

// ════════════════════════════════════════════════════════════════════════════
// DOUBLE AUTHENTIFICATION (MFA / TOTP) — chantier 2.43.0
// ════════════════════════════════════════════════════════════════════════════
//
// Le défi est posé AU LOGIN : pour un compte soumis ET enrôlé, aucun jeton
// d'accès n'est émis tant que le code n'est pas vérifié. Seul un « jeton de
// défi » de 5 minutes circule — il ne porte aucun rôle et `authenticate` le
// refuse (il n'a rien à autoriser) : seul POST /auth/mfa/verify le consomme.
//
// Verrou anti-force-brute DÉDIÉ (`mfa_failed_count` / `mfa_last_failed_at`,
// colonnes distinctes de celles du mot de passe) : un code à 6 chiffres n'a
// qu'un million de combinaisons, il est infiniment plus devinable qu'un mot de
// passe — lui faire partager le crédit d'essais du login (déjà entamé au moment
// où l'on arrive ici) reviendrait à ne presque plus le protéger.

const MFA_CHALLENGE_EXPIRES_IN = '5m';
const MAX_FAILED_MFA = 8;
const MFA_WINDOW_MS = 15 * 60 * 1000;
const MFA_LOCKOUT_MS = 15 * 60 * 1000;
const MFA_ISSUER = 'SOLIDATA';

/**
 * Refuse un JETON DE DÉFI présenté comme un jeton d'accès.
 *
 * Le jeton de défi ne porte pas de rôle : partout ailleurs dans l'application,
 * `authorize(...)` le rejette donc mécaniquement. Mais les routes de CE routeur
 * (/me, /password, /logout, /mfa/setup, /mfa/activate) n'ont que `authenticate`
 * — sans cette garde, quelqu'un ayant obtenu un défi (donc connaissant déjà le
 * mot de passe) pourrait CHANGER CE MOT DE PASSE sans jamais franchir la
 * double authentification. Le défi ne sert qu'à /mfa/verify, et à rien d'autre.
 *
 * À chaîner APRÈS `authenticate`.
 */
function denyChallengeToken(req, res, next) {
  if (req.user && req.user.purpose === 'mfa') {
    return res.status(401).json({
      error: 'Vérification en deux étapes non terminée',
      code: 'MFA_CHALLENGE_INVALID',
    });
  }
  return next();
}

// Chaîne d'authentification complète des routes de ce routeur.
const authFull = [authenticate, denyChallengeToken];

/**
 * Enregistre un échec de vérification MFA. Même logique de fenêtre glissante
 * que le login (jamais de blocage définitif) mais sur les compteurs dédiés.
 * Le verrou réutilise `locked_until` — un compte verrouillé l'est pour les deux
 * portes, ce qui est le comportement attendu (on ne veut pas qu'un attaquant
 * bloqué sur le TOTP puisse encore marteler le mot de passe).
 * @returns {Promise<boolean>} true si le compte vient d'être verrouillé
 */
async function registerFailedMfa(user) {
  const now = Date.now();
  const last = user.mfa_last_failed_at ? new Date(user.mfa_last_failed_at).getTime() : 0;
  const withinWindow = last && (now - last) < MFA_WINDOW_MS;
  const nextCount = withinWindow ? ((user.mfa_failed_count || 0) + 1) : 1;
  const lock = nextCount >= MAX_FAILED_MFA;
  const lockedUntil = lock ? new Date(now + MFA_LOCKOUT_MS) : null;
  await pool.query(
    `UPDATE users SET mfa_failed_count = $1, mfa_last_failed_at = NOW(),
            locked_until = COALESCE($2, locked_until)
     WHERE id = $3`,
    [lock ? 0 : nextCount, lockedUntil, user.id]
  );
  return lock;
}

/** Remet à zéro le compteur d'échecs MFA et lève le verrou après une réussite. */
async function resetMfaFailures(userId) {
  try {
    await pool.query(
      'UPDATE users SET mfa_failed_count = 0, mfa_last_failed_at = NULL, locked_until = NULL WHERE id = $1',
      [userId]
    );
  } catch (e) {
    console.error('[AUTH] reset compteur MFA :', e.message);
  }
}

/**
 * Les trois drapeaux MFA d'un compte, tels qu'exposés au frontend.
 * `mfa_enrollment_required` est celui qui déclenche l'écran bloquant
 * d'enrôlement (même pattern que `must_change_password`).
 */
async function mfaFlags(user) {
  let roles;
  try { roles = await getMfaRoles(); } catch (_) { roles = []; }
  const soumis = roles.includes(resolveBaseRole(user.role));
  const enabled = user.mfa_enabled === true;
  return {
    mfa_enabled: enabled,
    mfa_required: soumis,
    mfa_enrollment_required: soumis && !enabled,
  };
}

/**
 * ÉMISSION DE SESSION — factorisée : le login, la vérification du code et
 * l'activation de l'enrôlement produisent EXACTEMENT la même chose (jeton
 * d'accès, jeton de renouvellement en base + cookie, ligne de session, trace
 * d'activité). Trois copies de cette logique auraient divergé au premier
 * correctif.
 *
 * @param {object} user ligne `users` COMPLÈTE et À JOUR (token_version compris —
 *   après un bump, passer la ligne renvoyée par le UPDATE, jamais l'ancienne)
 * @param {object} opts
 * @param {boolean} opts.mfa valeur du claim `mfa` du jeton
 * @param {boolean} [opts.mfaVerifie] un SECOND FACTEUR VIENT D'ÊTRE PRÉSENTÉ
 *   (code TOTP ou code de secours). À ne poser que là : le claim `mfa` vaut
 *   aussi `true` d'office pour les rôles hors périmètre, qui n'ont rien vérifié
 *   — leur horodater une preuve inexistante donnerait 24 h d'accès sans second
 *   facteur le jour où leur rôle entrerait dans le périmètre.
 * @param {boolean} opts.mustChangePassword drapeau à renvoyer au front
 * @param {object} opts.req / opts.res
 * @param {object} [opts.logDetails] détail joint à la trace d'activité
 * @returns {Promise<{accessToken:string, refreshToken:string, body:object}>}
 */
async function issueSession(user, { mfa, mfaVerifie, mustChangePassword, req, res, logDetails }) {
  // Instant de la vérification RÉELLE du second facteur. Il voyage dans le
  // jeton (claim `mfa_at`, en secondes epoch) ET en base (`refresh_tokens
  // .mfa_verified_at`) : le premier permet à `requireMfa` et au handshake
  // Socket.IO de trancher sans lecture base, le second permet au
  // renouvellement de savoir s'il a encore le droit de reconduire le claim.
  const mfaAt = mfaVerifie === true ? Math.floor(Date.now() / 1000) : null;

  const tokenPayload = {
    id: user.id,
    username: user.username,
    role: user.role,
    first_name: user.first_name,
    last_name: user.last_name,
    // Révocation de session (item 3.C-1) : version au moment de l'émission.
    tv: user.token_version == null ? 0 : user.token_version,
    // Double authentification (2.43.0) : true = défi franchi OU rôle hors périmètre.
    mfa: mfa === true,
  };
  // Claim posé SEULEMENT quand il a un sens : un `mfa_at` sur une session qui
  // n'a jamais présenté de second facteur serait un mensonge daté.
  if (mfaAt != null) tokenPayload.mfa_at = mfaAt;

  const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const refreshToken = crypto.randomBytes(64).toString('hex');
  const expiresAt = new Date(Date.now() + parseExpiry(JWT_REFRESH_EXPIRES_IN));

  // `mfa` est porté par le jeton de renouvellement : c'est lui qui permettra,
  // au refresh, de savoir si CETTE session a franchi le défi (le claim n'est
  // jamais recopié aveuglément du jeton précédent).
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at, mfa, mfa_verified_at)
     VALUES ($1, $2, $3, $4, to_timestamp($5))`,
    [user.id, refreshToken, expiresAt, mfa === true, mfaAt]
  );

  logActivity({
    userId: user.id,
    username: user.username,
    action: 'login',
    ip: req.ip,
    details: { mfa: mfa === true, ...(logDetails || {}) },
  });

  const tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex').substring(0, 64);
  await pool.query(
    `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent)
     VALUES ($1, $2, $3, $4)`,
    [user.id, tokenHash, req.ip, req.get('user-agent') || null]
  );

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    maxAge: parseExpiry(JWT_REFRESH_EXPIRES_IN),
    path: '/',
  });

  const flags = await mfaFlags(user);
  return {
    accessToken,
    refreshToken,
    body: {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        team_id: user.team_id,
        must_change_password: mustChangePassword === true,
        ...flags,
      },
    },
  };
}

// POST /api/auth/driver-start — Mode chauffeur : démarrage par token véhicule
//
// Pattern « 1 URL = 1 véhicule » :
//   - Le chauffeur ouvre https://m.solidata.online/v/<qr_token> sur son téléphone
//     (raccourci écran d'accueil paramétré une fois par le manager au dépôt).
//   - Le front mobile POSTe ici { vehicle_token } et reçoit un JWT.
//   - Le `qr_token` est une chaîne hex 32 char (16 octets aléatoires) — espace
//     2^128, énumération infaisable. Régénération côté admin = révocation
//     immédiate de l'ancien raccourci.
//
// L'ancien comportement `{ vehicle_id }` (entier énumérable) a été supprimé.
router.post('/driver-start', async (req, res) => {
  try {
    const { vehicle_token, driver_name } = req.body;
    if (!vehicle_token || typeof vehicle_token !== 'string') {
      return res.status(400).json({ error: 'Token véhicule requis' });
    }
    // Format hex 32 caractères imposé pour rejeter rapidement les tokens malformés.
    if (!/^[a-f0-9]{32}$/.test(vehicle_token)) {
      return res.status(401).json({ error: 'Token véhicule invalide' });
    }

    // Chercher le véhicule et son chauffeur assigné via le qr_token (pas l'id).
    // Filtre `is_archived = false` pour qu'un véhicule retiré du service ne
    // délivre plus de JWT même si son ancien token traîne sur un téléphone.
    const vRes = await pool.query(
      `SELECT v.id, v.registration, v.name, v.assigned_driver_id,
              COALESCE(v.is_demo, false) AS is_demo,
              e.id as emp_id, e.first_name, e.last_name, e.user_id
       FROM vehicles v
       LEFT JOIN employees e ON e.id = v.assigned_driver_id
       WHERE v.qr_token = $1
         AND COALESCE(v.is_archived, false) = false`, [vehicle_token]
    );
    if (vRes.rows.length === 0) {
      // Message neutre : on ne dit pas si le token n'existe pas, est révoqué,
      // ou pointe sur un véhicule archivé → réduit la surface d'énumération.
      return res.status(401).json({ error: 'Accès véhicule invalide. Contacte ton responsable.' });
    }

    const vehicle = vRes.rows[0];
    let userId, employeeId, firstName, lastName;

    if (vehicle.user_id) {
      // Véhicule a un chauffeur assigné avec compte user
      userId = vehicle.user_id;
      employeeId = vehicle.emp_id;
      firstName = vehicle.first_name;
      lastName = vehicle.last_name;
    } else if (vehicle.emp_id) {
      // Chauffeur assigné mais sans user_id → créer un token générique
      employeeId = vehicle.emp_id;
      firstName = vehicle.first_name;
      lastName = vehicle.last_name;
      // Utiliser un user_id générique pour le token. JAMAIS de repli silencieux
      // vers l'id 1 (souvent un compte ADMIN) : l'identité du jeton sert à la
      // journalisation — mieux vaut refuser clairement qu'imputer les actions
      // du chauffeur à un administrateur. Le compte est seedé par init-db.
      const genericUser = await pool.query("SELECT id FROM users WHERE username = 'chauffeur' LIMIT 1");
      if (genericUser.rows.length === 0) {
        return res.status(503).json({
          error: "Compte de service « chauffeur » absent — relancez l'initialisation de la base (init-db) ou créez l'utilisateur 'chauffeur'.",
        });
      }
      userId = genericUser.rows[0].id;
    } else {
      // Pas de chauffeur assigné → utiliser le compte chauffeur générique
      const genericUser = await pool.query("SELECT id FROM users WHERE username = 'chauffeur' LIMIT 1");
      if (genericUser.rows.length === 0) {
        return res.status(400).json({ error: 'Aucun chauffeur assigné à ce véhicule. Contactez un admin.' });
      }
      userId = genericUser.rows[0].id;
      firstName = driver_name || 'Chauffeur';
      lastName = vehicle.registration;
      employeeId = null;
    }

    // Le jeton chauffeur porte un userId réel (chauffeur assigné, compte
    // « chauffeur » générique, ou repli). On y embarque `tv` pour qu'il soit
    // révocable comme les autres (item 3.C-1). Défaut 0 si la lecture échoue.
    let tv = 0;
    try {
      const tvRes = await pool.query('SELECT token_version FROM users WHERE id = $1', [userId]);
      tv = tvRes.rows[0]?.token_version == null ? 0 : tvRes.rows[0].token_version;
    } catch (_) { /* défaut 0 */ }

    // Le jeton porte explicitement le VÉHICULE et, quand il est connu, la fiche
    // employé du chauffeur affecté. C'est l'identité de la session : les fiches
    // salariés viennent de la paie et n'ont en général aucun compte utilisateur,
    // donc `userId` est le plus souvent le compte générique « chauffeur » — sur
    // lequel aucune fiche employé n'est rattachée. Sans ces deux claims, toute
    // action ayant besoin du chauffeur (prise de tournée) échouait sur
    // « Aucune fiche employé liée à votre compte ».
    // `username` = « driver_<vehicleId> » est conservé à l'identique : la garde
    // de périmètre véhicule de routes/tours/index.js s'appuie dessus.
    const token = jwt.sign(
      {
        id: userId,
        userId,
        role: 'COLLABORATEUR',
        username: `driver_${vehicle.id}`,
        vehicle_id: vehicle.id,
        employee_id: employeeId || null,
        tv,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      token,
      refreshToken: null,
      user: {
        id: userId,
        employee_id: employeeId,
        first_name: firstName,
        last_name: lastName,
        role: 'COLLABORATEUR',
        vehicle_id: vehicle.id,
        vehicle_registration: vehicle.registration,
        // MODE DÉMO (formations) : le mobile affiche un bandeau permanent et
        // le serveur neutralise toute écriture métier. Le drapeau vient du
        // VÉHICULE — le chauffeur ne peut ni l'activer ni le désactiver.
        is_demo: vehicle.is_demo === true,
      }
    });
  } catch (err) {
    console.error('[AUTH] Erreur driver-start:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/login
router.post('/login', [
  body('username').notEmpty().withMessage('Nom d\'utilisateur requis'),
  body('password').notEmpty().withMessage('Mot de passe requis'),
], validate, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
    }

    // On récupère le compte SANS filtrer is_active afin de pouvoir gérer le
    // verrouillage anti-brute-force et journaliser les échecs (item 3.C-3). Un
    // compte inexistant ou désactivé renvoie le même 401 « Identifiants invalides »
    // (pas d'énumération).
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0] || null;

    // Verrouillage temporaire actif ? (jamais définitif)
    if (user && user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      logActivity({ userId: user.id, username, action: 'login_failed', ip: req.ip, details: { reason: 'locked' } });
      return res.status(429).json({ error: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.' });
    }

    // Le mot de passe n'est vérifié que sur un compte existant ET actif.
    let validPassword = false;
    if (user && user.is_active) {
      validPassword = await bcrypt.compare(password, user.password_hash);
    }

    if (!validPassword) {
      // Journaliser l'échec — identifiant tenté + IP UNIQUEMENT, jamais le mot de passe.
      logActivity({
        userId: user ? user.id : null,
        username,
        action: 'login_failed',
        ip: req.ip,
        details: { reason: user ? (user.is_active ? 'bad_password' : 'inactive') : 'unknown_user' },
      });
      if (user) {
        try { await registerFailedLogin(user); }
        catch (e) { console.error('[AUTH] registerFailedLogin :', e.message); }
      }
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    // Succès : réinitialiser le compteur d'échecs / le verrou s'ils étaient posés.
    if ((user.failed_login_count && user.failed_login_count > 0) || user.locked_until) {
      try {
        await pool.query(
          'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_failed_login_at = NULL WHERE id = $1',
          [user.id]
        );
      } catch (e) { console.error('[AUTH] reset compteur échecs :', e.message); }
    }

    // Item 1 (audit) : filet de rattrapage pour les installations existantes —
    // un login réussi avec le mot de passe historique « admin123 » force le
    // changement au prochain écran, même si la colonne était restée à false.
    let mustChangePassword = user.must_change_password === true;
    if (password === 'admin123' && !mustChangePassword) {
      mustChangePassword = true;
      try {
        await pool.query('UPDATE users SET must_change_password = true WHERE id = $1', [user.id]);
      } catch (e) {
        console.error('[AUTH] Impossible de marquer must_change_password :', e.message);
      }
    }

    // ── Double authentification (2.43.0) — embranchement AVANT toute émission ──
    //
    // Trois cas, et un seul d'entre eux retient le jeton :
    //   • soumis ET enrôlé   → RIEN n'est émis : un jeton de défi de 5 min, et
    //                          l'utilisateur saisit son code (POST /mfa/verify) ;
    //   • soumis, PAS enrôlé → session complète mais claim `mfa:false` : les
    //                          routeurs sensibles restent fermés par requireMfa
    //                          pendant que le front affiche l'enrôlement ;
    //   • hors périmètre     → session complète, claim `mfa:true` d'office (le
    //                          claim signifie alors « rien à vérifier »).
    let mfaRoles = [];
    try { mfaRoles = await getMfaRoles(); }
    catch (e) { console.error('[AUTH] Lecture des rôles MFA :', e.message); }
    const soumisMfa = mfaRoles.includes(resolveBaseRole(user.role));

    if (soumisMfa && user.mfa_enabled === true) {
      // Jeton de défi : ni rôle, ni nom — juste de quoi retrouver le compte et
      // vérifier qu'il n'a pas été révoqué entre-temps. `authenticate` le rejette
      // (il ne porte pas de rôle), seul /auth/mfa/verify le consomme.
      const challengeToken = jwt.sign(
        { id: user.id, purpose: 'mfa', tv: user.token_version == null ? 0 : user.token_version },
        JWT_SECRET,
        { expiresIn: MFA_CHALLENGE_EXPIRES_IN }
      );
      logActivity({
        userId: user.id, username: user.username, action: 'login', ip: req.ip,
        details: { step: 'mfa_challenge' },
      });
      return res.json({ mfa_required: true, mfa_challenge_token: challengeToken });
    }

    const { body: responseBody } = await issueSession(user, {
      mfa: !soumisMfa,
      mustChangePassword,
      req,
      res,
    });
    res.json(responseBody);
  } catch (err) {
    console.error('[AUTH] Erreur login :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/mfa/verify — 2e étape de la connexion (code TOTP ou secours)
// ─────────────────────────────────────────────────────────────────────────────
// Consomme le jeton de défi émis par /login et, si le code est bon, émet la
// session complète (claim `mfa:true`). Aucune authentification Bearer ici :
// l'utilisateur n'a précisément pas encore de jeton d'accès.
router.post('/mfa/verify', async (req, res) => {
  try {
    const { mfa_challenge_token, code } = req.body || {};
    if (!mfa_challenge_token || !code) {
      return res.status(400).json({ error: 'Jeton de vérification et code requis' });
    }

    let decoded;
    try {
      decoded = jwt.verify(mfa_challenge_token, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({
        error: 'Vérification expirée. Reprenez la connexion depuis le début.',
        code: 'MFA_CHALLENGE_INVALID',
      });
    }
    if (decoded.purpose !== 'mfa' || decoded.id == null) {
      return res.status(401).json({ error: 'Jeton de vérification invalide', code: 'MFA_CHALLENGE_INVALID' });
    }

    const r = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
    const user = r.rows[0] || null;
    if (!user || user.is_active === false) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }
    // Le jeton de défi suit la même révocation que les jetons d'accès : un
    // logout ou une réinitialisation entre les deux étapes l'annule.
    if ((user.token_version == null ? 0 : user.token_version) !== decoded.tv) {
      return res.status(401).json({ error: 'Session expirée, reconnectez-vous', code: 'MFA_CHALLENGE_INVALID' });
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
    }
    if (user.mfa_enabled !== true) {
      return res.status(400).json({
        error: "La double authentification n'est pas activée sur ce compte.",
        code: 'MFA_NOT_ENABLED',
      });
    }

    const raw = String(code).trim().replace(/\s+/g, '').toUpperCase();
    let verified = false;
    let backupCodeUsed = false;
    let backupCodesRestants = null;

    if (/^\d{6}$/.test(raw)) {
      const secret = decryptSecret(user.mfa_secret);
      if (!secret) {
        // Secret illisible (clé d'environnement changée) : ce n'est PAS un
        // échec de l'utilisateur, on ne lui compte pas de tentative et on dit
        // quoi faire plutôt que de renvoyer « code incorrect » à l'infini.
        return res.status(503).json({
          error: "Le secret de double authentification de ce compte est illisible. Demandez à un administrateur de le réinitialiser.",
          code: 'MFA_SECRET_UNREADABLE',
        });
      }
      verified = totpLib.verifyTotp(secret, raw, { window: 1 });
    } else if (totpLib.BACKUP_CODE_REGEX.test(raw)) {
      const stored = Array.isArray(user.mfa_backup_codes) ? user.mfa_backup_codes : [];
      const hash = totpLib.hashBackupCode(raw);
      let matchedIndex = -1;
      // Tous les codes sont parcourus (pas de sortie anticipée) et comparés à
      // temps constant : la durée de la réponse ne doit pas trahir la position
      // du code trouvé, ni le nombre de codes restants.
      for (let i = 0; i < stored.length; i++) {
        const entry = stored[i] || {};
        const libre = !entry.used_at;
        if (libre && typeof entry.hash === 'string' && totpLib.safeEqual(entry.hash, hash)) {
          if (matchedIndex === -1) matchedIndex = i;
        }
      }
      if (matchedIndex >= 0) {
        // Usage UNIQUE : le code est marqué consommé avant d'émettre la session.
        const next = stored.map((e, i) => (i === matchedIndex ? { ...e, used_at: new Date().toISOString() } : e));
        await pool.query('UPDATE users SET mfa_backup_codes = $1::jsonb WHERE id = $2',
          [JSON.stringify(next), user.id]);
        verified = true;
        backupCodeUsed = true;
        backupCodesRestants = next.filter((e) => !e.used_at).length;
      }
    }
    // Tout autre format (longueur inattendue, lettres dans un code à 6 chiffres)
    // compte comme un échec : c'est bien une tentative.

    if (!verified) {
      let locked = false;
      try { locked = await registerFailedMfa(user); }
      catch (e) { console.error('[AUTH] registerFailedMfa :', e.message); }
      logActivity({
        userId: user.id, username: user.username, action: 'login_failed', ip: req.ip,
        details: { reason: 'mfa_code' },
      });
      if (locked) {
        return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
      }
      return res.status(401).json({ error: 'Code incorrect', code: 'MFA_CODE_INVALID' });
    }

    await resetMfaFailures(user.id);

    const { body: responseBody } = await issueSession(user, {
      mfa: true,
      mfaVerifie: true,   // un code TOTP (ou de secours) vient d'être vérifié
      mustChangePassword: user.must_change_password === true,
      req,
      res,
      logDetails: backupCodeUsed ? { backup_code: true } : undefined,
    });
    if (backupCodeUsed) {
      responseBody.backup_code_used = true;
      responseBody.backup_codes_restants = backupCodesRestants;
    }
    res.json(responseBody);
  } catch (err) {
    console.error('[AUTH] Erreur mfa/verify :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/mfa/setup — première étape de l'enrôlement
// ─────────────────────────────────────────────────────────────────────────────
// Authentifié, et VOLONTAIREMENT accessible à un jeton `mfa:false` : c'est le
// seul chemin par lequel un compte soumis mais non enrôlé peut s'en sortir
// (aucun requireMfa sur le routeur /api/auth).
router.post('/mfa/setup', authFull, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, username, mfa_enabled FROM users WHERE id = $1', [req.user.id]);
    const user = r.rows[0];
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    if (user.mfa_enabled === true) {
      return res.status(409).json({
        error: "La double authentification est déjà activée sur ce compte. Pour la reconfigurer, demandez sa réinitialisation à un administrateur.",
        code: 'MFA_ALREADY_ENABLED',
      });
    }

    const secret = totpLib.generateSecret();
    const encrypted = encryptSecret(secret);
    if (!encrypted) {
      return res.status(503).json({
        error: "Le chiffrement du secret est indisponible sur ce serveur. Contactez un administrateur.",
        code: 'MFA_CRYPTO_UNAVAILABLE',
      });
    }
    // `mfa_enabled` reste false : le secret n'est confirmé qu'à l'activation.
    await pool.query('UPDATE users SET mfa_secret = $1, updated_at = NOW() WHERE id = $2', [encrypted, user.id]);

    const label = encodeURIComponent(`${MFA_ISSUER}:${user.username}`);
    const otpauthUrl = `otpauth://totp/${label}`
      + `?secret=${secret}&issuer=${encodeURIComponent(MFA_ISSUER)}`
      + '&algorithm=SHA1&digits=6&period=30';

    let qrDataUrl = null;
    try {
      const QRCode = require('qrcode');
      qrDataUrl = await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
    } catch (e) {
      // Le QR est un confort : le secret en toutes lettres suffit à s'enrôler.
      // On le dit plutôt que de renvoyer une image cassée.
      console.error('[AUTH] Génération du QR MFA impossible :', e.message);
    }

    res.json({ otpauth_url: otpauthUrl, qr_data_url: qrDataUrl, secret_base32: secret });
  } catch (err) {
    console.error('[AUTH] Erreur mfa/setup :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/mfa/activate { code } — confirmation de l'enrôlement
// ─────────────────────────────────────────────────────────────────────────────
// Vérifie le premier code, active, génère les 8 codes de secours (affichés UNE
// seule fois), puis RÉÉMET la session avec `mfa:true` pour que l'utilisateur
// n'ait pas à se reconnecter.
//
// ORDRE CRITIQUE : incrémenter `token_version` D'ABORD (le UPDATE renvoie la
// ligne à jour), purger les anciens jetons de renouvellement (ils portent
// `mfa=false`), et SEULEMENT ENSUITE émettre — sinon on invaliderait le jeton
// que l'on vient de délivrer.
router.post('/mfa/activate', authFull, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Code requis' });

    const r = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = r.rows[0];
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    if (user.mfa_enabled === true) {
      return res.status(409).json({ error: 'La double authentification est déjà activée.', code: 'MFA_ALREADY_ENABLED' });
    }
    if (!user.mfa_secret) {
      return res.status(400).json({
        error: "Aucune configuration en cours. Recommencez l'activation.",
        code: 'MFA_SETUP_REQUIRED',
      });
    }

    const secret = decryptSecret(user.mfa_secret);
    if (!secret) {
      return res.status(503).json({
        error: "Le secret généré est illisible. Recommencez l'activation ; si le problème persiste, contactez un administrateur.",
        code: 'MFA_SECRET_UNREADABLE',
      });
    }

    const raw = String(code).trim().replace(/\s+/g, '');
    if (!totpLib.verifyTotp(secret, raw, { window: 1 })) {
      return res.status(400).json({
        error: "Code incorrect. Vérifiez l'heure de votre téléphone puis saisissez le code affiché.",
        code: 'MFA_CODE_INVALID',
      });
    }

    const codes = totpLib.generateBackupCodes(8);
    const stored = codes.map((c) => ({ hash: totpLib.hashBackupCode(c), used_at: null }));

    const upd = await pool.query(
      `UPDATE users
          SET mfa_enabled = true,
              mfa_enrolled_at = NOW(),
              mfa_backup_codes = $1::jsonb,
              mfa_failed_count = 0,
              mfa_last_failed_at = NULL,
              token_version = COALESCE(token_version, 0) + 1,
              updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [JSON.stringify(stored), user.id]
    );
    const updated = upd.rows[0] || { ...user, mfa_enabled: true, token_version: (user.token_version || 0) + 1 };

    // Les sessions antérieures (jetons `mfa:false`) n'ont plus lieu d'être.
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [user.id]);

    logActivity({ userId: user.id, username: user.username, action: 'mfa_enrolled', ip: req.ip });

    const { body: responseBody } = await issueSession(updated, {
      mfa: true,
      // L'enrôlement ne s'achève que sur un code TOTP vérifié : c'est bien un
      // second facteur présenté, la fenêtre de validité part d'ici.
      mfaVerifie: true,
      mustChangePassword: updated.must_change_password === true,
      req,
      res,
      logDetails: { step: 'mfa_enrolled' },
    });
    // Les codes de secours ne seront JAMAIS réaffichés (seules leurs empreintes
    // sont conservées) : c'est l'unique occasion de les noter.
    responseBody.backup_codes = codes;
    res.json(responseBody);
  } catch (err) {
    console.error('[AUTH] Erreur mfa/activate :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    // Read refresh token from cookie OR body (backward compatibility)
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token requis' });
    }

    // Les deux alias explicites (`rt_mfa`, `u_mfa_enabled`) évitent toute
    // ambiguïté de colonne homonyme entre rt.* et u.* — le claim `mfa` du
    // nouveau jeton est RECALCULÉ à partir d'eux, jamais recopié de l'ancien.
    const result = await pool.query(
      `SELECT rt.*, u.*, rt.mfa AS rt_mfa, rt.mfa_verified_at AS rt_mfa_verified_at,
              u.mfa_enabled AS u_mfa_enabled
         FROM refresh_tokens rt JOIN users u ON rt.user_id = u.id
        WHERE rt.token = $1 AND rt.expires_at > NOW()`,
      [refreshToken]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Refresh token invalide ou expiré' });
    }

    const row = result.rows[0];

    // Item 4 (audit) : un compte désactivé ne doit plus pouvoir rafraîchir sa
    // session. On révoque le refresh token présenté et on refuse l'accès.
    if (row.is_active === false) {
      await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
      return res.status(401).json({ error: 'Compte désactivé' });
    }

    // Supprimer l'ancien token
    await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);

    // ── Claim `mfa` RECALCULÉ (2.43.0) ──
    // Jamais recopié de l'ancien jeton : le rôle a pu changer, ou un
    // administrateur a pu réinitialiser la double authentification entre-temps.
    // Trois sources, dans cet ordre : le rôle courant, l'état d'enrôlement
    // courant, puis seulement le fait que CETTE session ait franchi le défi.
    let mfaRolesRefresh = [];
    try { mfaRolesRefresh = await getMfaRoles(); }
    catch (e) { console.error('[AUTH] Lecture des rôles MFA (refresh) :', e.message); }
    const soumisRefresh = mfaRolesRefresh.includes(resolveBaseRole(row.role));

    // ── Fraîcheur du second facteur ──
    // Le renouvellement est le seul endroit où une session peut se prolonger.
    // C'est donc ici que la fenêtre de validité doit être opposée : sans cela,
    // un rafraîchissement silencieux toutes les 8 h reconduirait indéfiniment
    // une vérification vieille de six jours, et la fenêtre ne fermerait rien.
    //
    // `mfa_verified_at` NULL sur une ligne `mfa = true` = session d'avant ce
    // déploiement (ou session d'un rôle alors hors périmètre, à qui le claim
    // avait été posé d'office sans qu'aucun code ait été présenté) : périmée
    // dans les deux cas, l'utilisateur repasse par le second facteur une fois.
    const mfaAtSec = row.rt_mfa_verified_at
      ? Math.floor(new Date(row.rt_mfa_verified_at).getTime() / 1000)
      : null;
    let dureeMfa;
    try { dureeMfa = await getMfaDureeHeures(); }
    catch (e) { dureeMfa = undefined; }
    const mfaPerime = mfaExpiree(mfaAtSec, dureeMfa);

    let mfaClaim;
    if (!soumisRefresh) mfaClaim = true;                       // hors périmètre : rien à vérifier
    else if (row.u_mfa_enabled !== true) mfaClaim = false;     // soumis mais pas (ou plus) enrôlé
    else if (mfaPerime) mfaClaim = false;                      // vérification trop ancienne
    else mfaClaim = row.rt_mfa === true;                       // session ayant franchi le défi

    const tokenPayload = {
      id: row.user_id,
      username: row.username,
      role: row.role,
      first_name: row.first_name,
      last_name: row.last_name,
      // Révocation de session (item 3.C-1) : version courante en base (jointe u.*).
      tv: row.token_version == null ? 0 : row.token_version,
      mfa: mfaClaim,
    };
    // L'horodatage de la vérification est RECONDUIT tel quel, jamais repoussé :
    // un renouvellement n'est pas une nouvelle preuve d'identité. Le repousser
    // rendrait la fenêtre infinie pour toute session simplement restée active.
    if (mfaClaim === true && mfaAtSec != null) tokenPayload.mfa_at = mfaAtSec;

    const newAccessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    const newRefreshToken = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + parseExpiry(JWT_REFRESH_EXPIRES_IN));

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at, mfa, mfa_verified_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.user_id, newRefreshToken, expiresAt, mfaClaim,
        mfaClaim === true ? row.rt_mfa_verified_at : null]
    );

    // Mettre à jour la session
    const newTokenHash = crypto.createHash('sha256').update(newAccessToken).digest('hex').substring(0, 64);
    await pool.query(
      `UPDATE user_sessions SET token_hash = $1, last_activity = NOW()
       WHERE user_id = $2 AND is_active = true`,
      [newTokenHash, row.user_id]
    );

    // Set new refresh token as HttpOnly cookie
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: parseExpiry(JWT_REFRESH_EXPIRES_IN),
      path: '/',
    });

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    console.error('[AUTH] Erreur refresh :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/logout
router.post('/logout', authFull, async (req, res) => {
  try {
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);

    // Révocation effective (item 3.C-1) : invalider immédiatement les access
    // tokens vivants du compte (et pas seulement supprimer le refresh token).
    // NB : la granularité est par compte → une déconnexion invalide les jetons
    // d'accès de tous les appareils de cet utilisateur (accepté pour cet ERP).
    if (req.user.id != null) {
      await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
    }

    // Fermer les sessions actives
    await pool.query(
      'UPDATE user_sessions SET is_active = false, ended_at = NOW() WHERE user_id = $1 AND is_active = true',
      [req.user.id]
    );
    logActivity({ userId: req.user.id, username: req.user.username, action: 'logout', ip: req.ip });

    // Clear the refreshToken cookie
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      path: '/',
    });

    res.json({ message: 'Déconnexion réussie' });
  } catch (err) {
    console.error('[AUTH] Erreur logout :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/auth/me
router.get('/me', authFull, async (req, res) => {
  try {
    // Identité de SERVICE (clé d'API) : il n'y a aucune ligne `users` derrière
    // elle. On répond ce qu'elle est, plutôt qu'un 404 trompeur — c'est aussi
    // le point de contrôle du smoke test de déploiement (« qui suis-je ? »).
    if (req.user && req.user.is_service) {
      return res.json({
        id: null,
        username: req.user.username,
        role: req.user.role,
        base_role: resolveBaseRole(req.user.role),
        is_service: true,
        api_key_id: req.user.api_key_id || null,
        must_change_password: false,
        mfa_enabled: false,
        mfa_required: false,
        mfa_enrollment_required: false,
      });
    }
    const result = await pool.query(
      `SELECT id, username, email, role, first_name, last_name, phone, team_id, is_active,
              must_change_password, mfa_enabled, mfa_enrolled_at, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    const u = result.rows[0];
    // base_role : rôle intégré effectif (pour un rôle personnalisé, son modèle).
    // mfa_* : le front en tire l'écran bloquant d'enrôlement (même pattern que
    // must_change_password).
    const flags = await mfaFlags(u);
    res.json({ ...u, base_role: resolveBaseRole(u.role), ...flags });
  } catch (err) {
    console.error('[AUTH] Erreur me :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/auth/password — changement de mot de passe par l'utilisateur lui-même.
// Sert aussi d'écran de changement forcé (must_change_password) : réinitialise le
// drapeau et révoque les refresh tokens pour un re-login propre (audit item 1).
router.put('/password', authFull, [
  body('currentPassword').notEmpty().withMessage('Mot de passe actuel requis'),
  body('newPassword').isLength({ min: MIN_PASSWORD_LENGTH }).withMessage(`Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`),
], validate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Mot de passe actuel et nouveau requis' });
    }
    // Politique de mot de passe unifiée (item 3.C-2).
    const pwdErr = validatePassword(newPassword);
    if (pwdErr) {
      return res.status(400).json({ error: pwdErr });
    }

    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2',
      [hash, req.user.id]
    );

    // Re-login propre : invalider les sessions renouvelables existantes.
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);

    logActivity({ userId: req.user.id, username: req.user.username, action: 'password_change', ip: req.ip });

    res.json({ message: 'Mot de passe modifié avec succès' });
  } catch (err) {
    console.error('[AUTH] Erreur password :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

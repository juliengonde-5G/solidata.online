const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const { authenticate, resolveBaseRole, validatePassword, MIN_PASSWORD_LENGTH } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { logActivity } = require('../middleware/activity-logger');

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
      // Utiliser un user_id générique pour le token
      const genericUser = await pool.query("SELECT id FROM users WHERE username = 'chauffeur' LIMIT 1");
      userId = genericUser.rows[0]?.id || 1;
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

    const tokenPayload = {
      id: user.id,
      username: user.username,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name,
      // Révocation de session (item 3.C-1) : version au moment de l'émission.
      tv: user.token_version == null ? 0 : user.token_version,
    };

    const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    const refreshToken = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + parseExpiry(JWT_REFRESH_EXPIRES_IN));

    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt]
    );

    // Logger la connexion
    logActivity({ userId: user.id, username: user.username, action: 'login', ip: req.ip });

    // Créer la session
    const tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex').substring(0, 64);
    await pool.query(
      `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent)
       VALUES ($1, $2, $3, $4)`,
      [user.id, tokenHash, req.ip, req.get('user-agent') || null]
    );

    // Set refresh token as HttpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: parseExpiry(JWT_REFRESH_EXPIRES_IN),
      path: '/',
    });

    // Still send refreshToken in body for backward compatibility
    res.json({
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
        must_change_password: mustChangePassword,
      },
    });
  } catch (err) {
    console.error('[AUTH] Erreur login :', err);
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

    const result = await pool.query(
      'SELECT rt.*, u.* FROM refresh_tokens rt JOIN users u ON rt.user_id = u.id WHERE rt.token = $1 AND rt.expires_at > NOW()',
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

    const tokenPayload = {
      id: row.user_id,
      username: row.username,
      role: row.role,
      first_name: row.first_name,
      last_name: row.last_name,
      // Révocation de session (item 3.C-1) : version courante en base (jointe u.*).
      tv: row.token_version == null ? 0 : row.token_version,
    };

    const newAccessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    const newRefreshToken = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + parseExpiry(JWT_REFRESH_EXPIRES_IN));

    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [row.user_id, newRefreshToken, expiresAt]
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
router.post('/logout', authenticate, async (req, res) => {
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
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, role, first_name, last_name, phone, team_id, is_active, must_change_password, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    const u = result.rows[0];
    // base_role : rôle intégré effectif (pour un rôle personnalisé, son modèle).
    res.json({ ...u, base_role: resolveBaseRole(u.role) });
  } catch (err) {
    console.error('[AUTH] Erreur me :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/auth/password — changement de mot de passe par l'utilisateur lui-même.
// Sert aussi d'écran de changement forcé (must_change_password) : réinitialise le
// drapeau et révoque les refresh tokens pour un re-login propre (audit item 1).
router.put('/password', authenticate, [
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

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { logActivity } = require('../middleware/activity-logger');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
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

// POST /api/auth/driver-start — Mode chauffeur : démarrage par véhicule (sans identifiant)
router.post('/driver-start', async (req, res) => {
  try {
    const { vehicle_id, driver_name } = req.body;
    if (!vehicle_id) return res.status(400).json({ error: 'Véhicule requis' });

    // Chercher le véhicule et son chauffeur assigné
    const vRes = await pool.query(
      `SELECT v.id, v.registration, v.name, v.assigned_driver_id,
              e.id as emp_id, e.first_name, e.last_name, e.user_id
       FROM vehicles v
       LEFT JOIN employees e ON e.id = v.assigned_driver_id
       WHERE v.id = $1`, [vehicle_id]
    );
    if (vRes.rows.length === 0) return res.status(404).json({ error: 'Véhicule non trouvé' });

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

    const token = jwt.sign(
      { id: userId, userId, role: 'COLLABORATEUR', username: `driver_${vehicle_id}` },
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

    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const tokenPayload = {
      id: user.id,
      username: user.username,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name,
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

    // Supprimer l'ancien token
    await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);

    const tokenPayload = {
      id: row.user_id,
      username: row.username,
      role: row.role,
      first_name: row.first_name,
      last_name: row.last_name,
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
      `SELECT id, username, email, role, first_name, last_name, phone, team_id, is_active, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[AUTH] Erreur me :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/auth/password
router.put('/password', authenticate, [
  body('currentPassword').notEmpty().withMessage('Mot de passe actuel requis'),
  body('newPassword').isLength({ min: 6 }).withMessage('Le nouveau mot de passe doit contenir au moins 6 caractères'),
], validate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Mot de passe actuel et nouveau requis' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
    }

    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.id]);

    logActivity({ userId: req.user.id, username: req.user.username, action: 'password_change', ip: req.ip });

    res.json({ message: 'Mot de passe modifié avec succès' });
  } catch (err) {
    console.error('[AUTH] Erreur password :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

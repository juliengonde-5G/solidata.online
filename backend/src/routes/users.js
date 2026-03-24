const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');

// Toutes les routes nécessitent ADMIN
router.use(authenticate, authorize('ADMIN'));

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, role, first_name, last_name, phone, team_id, is_active, created_at, updated_at
       FROM users ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[USERS] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/users
router.post('/', [
  body('username').notEmpty().withMessage('Nom d\'utilisateur requis'),
  body('password').isLength({ min: 6 }).withMessage('Mot de passe de 6 caractères minimum requis'),
  body('role').isIn(['ADMIN', 'MANAGER', 'RH', 'COLLABORATEUR', 'AUTORITE']).withMessage('Rôle invalide'),
], validate, async (req, res) => {
  try {
    const { username, password, email, role, first_name, last_name, phone, team_id } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Nom d\'utilisateur, mot de passe et rôle requis' });
    }

    const validRoles = ['ADMIN', 'MANAGER', 'RH', 'COLLABORATEUR', 'AUTORITE'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Ce nom d\'utilisateur existe déjà' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, email, role, first_name, last_name, phone, team_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, username, email, role, first_name, last_name, phone, team_id, is_active, created_at`,
      [username, hash, email, role, first_name, last_name, phone, team_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[USERS] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/users/:id
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, role, first_name, last_name, phone, team_id, is_active } = req.body;

    const result = await pool.query(
      `UPDATE users SET email = COALESCE($1, email), role = COALESCE($2, role),
       first_name = COALESCE($3, first_name), last_name = COALESCE($4, last_name),
       phone = COALESCE($5, phone), team_id = COALESCE($6, team_id),
       is_active = COALESCE($7, is_active), updated_at = NOW()
       WHERE id = $8
       RETURNING id, username, email, role, first_name, last_name, phone, team_id, is_active`,
      [email, role, first_name, last_name, phone, team_id, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[USERS] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/users/:id/reset-password
router.put('/:id/reset-password', [
  body('newPassword').isLength({ min: 6 }).withMessage('Mot de passe de 6 caractères minimum requis'),
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Mot de passe de 6 caractères minimum requis' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id',
      [hash, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Invalider les refresh tokens
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [id]);

    res.json({ message: 'Mot de passe réinitialisé' });
  } catch (err) {
    console.error('[USERS] Erreur reset password :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/users/:id (désactivation)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte' });
    }

    const result = await pool.query(
      'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [id]);

    res.json({ message: 'Utilisateur désactivé' });
  } catch (err) {
    console.error('[USERS] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

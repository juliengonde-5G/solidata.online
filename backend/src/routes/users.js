const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { authenticate, authorize, validatePassword, MIN_PASSWORD_LENGTH } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

// Toutes les routes nécessitent ADMIN
router.use(authenticate, authorize('ADMIN'));
router.use(autoLogActivity('user'));

// Rôles intégrés. DPO / FINANCE / QHSE ajoutés en vague 2 (parties prenantes) :
// DPO (RGPD sans pleins droits ADMIN), FINANCE (consultation direction/CA),
// QHSE (incidents + véhicules + exports d'audit). Ce sont des rôles INTÉGRÉS
// (pas des rôles personnalisés) car ils ouvrent des accès qu'un rôle dupliqué,
// borné aux droits de son rôle de base, ne pourrait pas accorder.
const BUILTIN_ROLES = ['ADMIN', 'MANAGER', 'RH', 'COLLABORATEUR', 'AUTORITE', 'RESP_BTQ', 'DPO', 'FINANCE', 'QHSE'];
// Un rôle est valide s'il est intégré ou personnalisé (table custom_roles).
async function isValidRole(role) {
  if (BUILTIN_ROLES.includes(role)) return true;
  try {
    const r = await pool.query('SELECT 1 FROM custom_roles WHERE role_key = $1', [role]);
    return r.rows.length > 0;
  } catch (_) { return false; }
}

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
  body('password').isLength({ min: MIN_PASSWORD_LENGTH }).withMessage(`Mot de passe de ${MIN_PASSWORD_LENGTH} caractères minimum requis`),
  body('role').notEmpty().withMessage('Rôle requis'),
], validate, async (req, res) => {
  try {
    const { username, password, email, role, first_name, last_name, phone, team_id } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Nom d\'utilisateur, mot de passe et rôle requis' });
    }

    // Politique de mot de passe unifiée (item 3.C-2).
    const pwdErr = validatePassword(password);
    if (pwdErr) {
      return res.status(400).json({ error: pwdErr });
    }

    if (!(await isValidRole(role))) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Ce nom d\'utilisateur existe déjà' });
    }

    // must_change_password = true (item 3.C-2) : le mot de passe posé par l'admin
    // est temporaire → l'écran bloquant de 1er login (vague 0) force son changement.
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, email, role, first_name, last_name, phone, team_id, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
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

    if (role != null && !(await isValidRole(role))) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    // État courant (pour le garde-fou « dernier ADMIN » et la purge de sessions).
    const currentRes = await pool.query('SELECT role, is_active FROM users WHERE id = $1', [id]);
    if (currentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    const current = currentRes.rows[0];

    // Item 2 (audit) : interdit de désactiver ou de rétrograder le DERNIER compte
    // ADMIN actif (verrouillage total de l'administration sinon). On ne compte que
    // le rôle intégré 'ADMIN' — un rôle personnalisé dérivé d'ADMIN ne compte pas.
    const currentIsActiveAdmin = current.role === 'ADMIN' && current.is_active === true;
    const nextRole = (role == null) ? current.role : role;
    const nextActive = (is_active == null) ? current.is_active : is_active;
    const stillActiveAdmin = nextRole === 'ADMIN' && nextActive === true;
    if (currentIsActiveAdmin && !stillActiveAdmin) {
      const { rows: cnt } = await pool.query(
        "SELECT COUNT(*)::int AS n FROM users WHERE role = 'ADMIN' AND is_active = true"
      );
      if ((cnt[0]?.n || 0) <= 1) {
        return res.status(409).json({
          error: "Impossible : c'est le dernier administrateur actif. Créez ou activez un autre administrateur avant de le désactiver ou de changer son rôle.",
        });
      }
    }

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

    // Item 4 (audit) + révocation effective (item 3.C-1) : un compte désactivé ne
    // doit plus conserver de session renouvelable (purge des refresh tokens) NI
    // d'access token vivant (incrément token_version → jetons rejetés au prochain
    // appel). Le passage is_active false → true n'a pas d'effet ici (pas de bump).
    if (result.rows[0].is_active === false) {
      await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [id]);
      await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [id]);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[USERS] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/users/:id/reset-password
router.put('/:id/reset-password', [
  body('newPassword').isLength({ min: MIN_PASSWORD_LENGTH }).withMessage(`Mot de passe de ${MIN_PASSWORD_LENGTH} caractères minimum requis`),
], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    // Politique de mot de passe unifiée (item 3.C-2).
    const pwdErr = validatePassword(newPassword);
    if (pwdErr) {
      return res.status(400).json({ error: pwdErr });
    }

    // must_change_password = true (item 3.C-2) : le mot de passe réinitialisé par
    // l'admin est temporaire → changement forcé au prochain login de l'utilisateur.
    const hash = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = true, updated_at = NOW() WHERE id = $2 RETURNING id',
      [hash, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Révocation effective (item 3.C-1) : purge des refresh tokens + incrément de
    // token_version → les access tokens vivants sont rejetés immédiatement.
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [id]);
    await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [id]);

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

    // Révocation effective (item 3.C-1) : purge refresh tokens + incrément
    // token_version (invalide les access tokens vivants du compte désactivé).
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [id]);
    await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [id]);

    res.json({ message: 'Utilisateur désactivé' });
  } catch (err) {
    console.error('[USERS] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

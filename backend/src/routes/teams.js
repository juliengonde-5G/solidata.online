const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

router.use(authenticate);
router.use(autoLogActivity('team'));

// GET /api/teams
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, COUNT(e.id) as member_count
       FROM teams t
       LEFT JOIN employees e ON e.team_id = t.id AND e.is_active = true
       GROUP BY t.id ORDER BY t.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[TEAMS] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/teams/:id
router.get('/:id', async (req, res) => {
  try {
    const team = await pool.query('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (team.rows.length === 0) return res.status(404).json({ error: 'Équipe non trouvée' });

    const members = await pool.query(
      'SELECT * FROM employees WHERE team_id = $1 AND is_active = true ORDER BY last_name',
      [req.params.id]
    );

    res.json({ ...team.rows[0], members: members.rows });
  } catch (err) {
    console.error('[TEAMS] Erreur détail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/teams
router.post('/', authorize('ADMIN', 'MANAGER'), [
  body('name').notEmpty().withMessage('Nom requis'),
], validate, async (req, res) => {
  try {
    const { name, type } = req.body;
    if (!name) return res.status(400).json({ error: 'Nom requis' });

    const result = await pool.query(
      'INSERT INTO teams (name, type) VALUES ($1, $2) RETURNING *',
      [name, type]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TEAMS] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/teams/:id
router.put('/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { name, type, is_active } = req.body;
    const result = await pool.query(
      `UPDATE teams SET name = COALESCE($1, name), type = COALESCE($2, type),
       is_active = COALESCE($3, is_active) WHERE id = $4 RETURNING *`,
      [name, type, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Équipe non trouvée' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TEAMS] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/teams/:id
router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE teams SET is_active = false WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Équipe non trouvée' });
    res.json({ message: 'Équipe désactivée' });
  } catch (err) {
    console.error('[TEAMS] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

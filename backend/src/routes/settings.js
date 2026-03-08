const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN'));

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings ORDER BY category, key');
    res.json(result.rows);
  } catch (err) {
    console.error('[SETTINGS] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/settings/:key
router.put('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const result = await pool.query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
       RETURNING *`,
      [key, value]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[SETTINGS] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/settings/templates
router.get('/templates', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM message_templates ORDER BY category, name');
    res.json(result.rows);
  } catch (err) {
    console.error('[SETTINGS] Erreur templates :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/settings/templates
router.post('/templates', async (req, res) => {
  try {
    const { name, type, category, subject, body, variables } = req.body;

    if (!name || !type || !category || !body) {
      return res.status(400).json({ error: 'Champs requis : name, type, category, body' });
    }

    const result = await pool.query(
      `INSERT INTO message_templates (name, type, category, subject, body, variables)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, type, category, subject, body, variables || []]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[SETTINGS] Erreur création template :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/settings/templates/:id
router.put('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, category, subject, body, variables, is_active } = req.body;

    const result = await pool.query(
      `UPDATE message_templates SET
       name = COALESCE($1, name), type = COALESCE($2, type),
       category = COALESCE($3, category), subject = COALESCE($4, subject),
       body = COALESCE($5, body), variables = COALESCE($6, variables),
       is_active = COALESCE($7, is_active), updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [name, type, category, subject, body, variables, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template non trouvé' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[SETTINGS] Erreur modification template :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

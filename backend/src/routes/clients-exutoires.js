const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));
router.use(autoLogActivity('client_exutoire'));

// GET /api/clients-exutoires
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM clients_exutoires WHERE actif = TRUE';
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (raison_sociale ILIKE $${params.length} OR ville ILIKE $${params.length} OR contact_nom ILIKE $${params.length})`;
    }

    query += ' ORDER BY raison_sociale';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[CLIENTS-EXUTOIRES] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/clients-exutoires/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients_exutoires WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client exutoire non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CLIENTS-EXUTOIRES] Erreur détail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/clients-exutoires
router.post('/', [
  body('raison_sociale').notEmpty().withMessage('Raison sociale requise'),
  body('adresse').notEmpty().withMessage('Adresse requise'),
  body('code_postal').notEmpty().withMessage('Code postal requis'),
  body('ville').notEmpty().withMessage('Ville requise'),
  body('contact_nom').notEmpty().withMessage('Nom du contact requis'),
  body('contact_email').isEmail().withMessage('Email du contact invalide'),
], validate, async (req, res) => {
  try {
    const { raison_sociale, adresse, code_postal, ville, contact_nom, contact_email, siret, contact_telephone, type_client } = req.body;

    if (!raison_sociale || !adresse || !code_postal || !ville || !contact_nom || !contact_email) {
      return res.status(400).json({ error: 'Champs obligatoires : raison_sociale, adresse, code_postal, ville, contact_nom, contact_email' });
    }

    const result = await pool.query(
      `INSERT INTO clients_exutoires (raison_sociale, adresse, code_postal, ville, contact_nom, contact_email, siret, contact_telephone, type_client)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [raison_sociale, adresse, code_postal, ville, contact_nom, contact_email, siret || null, contact_telephone || null, type_client || 'recycleur']
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[CLIENTS-EXUTOIRES] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/clients-exutoires/:id
router.put('/:id', async (req, res) => {
  try {
    const { raison_sociale, adresse, code_postal, ville, contact_nom, contact_email, siret, contact_telephone, type_client } = req.body;

    const result = await pool.query(
      `UPDATE clients_exutoires SET
       raison_sociale = COALESCE($1, raison_sociale),
       adresse = COALESCE($2, adresse),
       code_postal = COALESCE($3, code_postal),
       ville = COALESCE($4, ville),
       contact_nom = COALESCE($5, contact_nom),
       contact_email = COALESCE($6, contact_email),
       siret = COALESCE($7, siret),
       contact_telephone = COALESCE($8, contact_telephone),
       type_client = COALESCE($9, type_client),
       updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [raison_sociale, adresse, code_postal, ville, contact_nom, contact_email, siret, contact_telephone, type_client, req.params.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client exutoire non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CLIENTS-EXUTOIRES] Erreur mise à jour :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/clients-exutoires/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE clients_exutoires SET actif = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client exutoire non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[CLIENTS-EXUTOIRES] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

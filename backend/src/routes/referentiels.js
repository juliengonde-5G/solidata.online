const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// ══════ ASSOCIATIONS ══════

router.get('/associations', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM associations ORDER BY nom');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/associations', authorize('ADMIN'), async (req, res) => {
  try {
    const { nom, type, adresse, commune, contact_nom, contact_tel } = req.body;
    const result = await pool.query(
      'INSERT INTO associations (nom, type, adresse, commune, contact_nom, contact_tel) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [nom, type, adresse, commune, contact_nom, contact_tel]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.put('/associations/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const { nom, type, adresse, commune, contact_nom, contact_tel, is_active } = req.body;
    const result = await pool.query(
      `UPDATE associations SET nom=COALESCE($1,nom), type=COALESCE($2,type),
       adresse=COALESCE($3,adresse), commune=COALESCE($4,commune),
       contact_nom=COALESCE($5,contact_nom), contact_tel=COALESCE($6,contact_tel),
       is_active=COALESCE($7,is_active) WHERE id=$8 RETURNING *`,
      [nom, type, adresse, commune, contact_nom, contact_tel, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Non trouvé' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ══════ EXUTOIRES ══════

router.get('/exutoires', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM exutoires ORDER BY nom');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/exutoires', authorize('ADMIN'), async (req, res) => {
  try {
    const { nom, type, adresse, contact_nom, contact_email, contact_tel } = req.body;
    const result = await pool.query(
      'INSERT INTO exutoires (nom, type, adresse, contact_nom, contact_email, contact_tel) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [nom, type, adresse, contact_nom, contact_email, contact_tel]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.put('/exutoires/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const { nom, type, adresse, contact_nom, contact_email, contact_tel, is_active } = req.body;
    const result = await pool.query(
      `UPDATE exutoires SET nom=COALESCE($1,nom), type=COALESCE($2,type),
       adresse=COALESCE($3,adresse), contact_nom=COALESCE($4,contact_nom),
       contact_email=COALESCE($5,contact_email), contact_tel=COALESCE($6,contact_tel),
       is_active=COALESCE($7,is_active) WHERE id=$8 RETURNING *`,
      [nom, type, adresse, contact_nom, contact_email, contact_tel, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Non trouvé' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ══════ CATALOGUE PRODUITS ══════

router.get('/catalogue', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM produits_catalogue WHERE is_active = true ORDER BY nom');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/catalogue', authorize('ADMIN'), async (req, res) => {
  try {
    const { nom, categorie_eco_org, genre, saison, gamme } = req.body;
    const result = await pool.query(
      'INSERT INTO produits_catalogue (nom, categorie_eco_org, genre, saison, gamme) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [nom, categorie_eco_org, genre, saison || 'Sans Saison', gamme]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ══════ TYPES CONTENEURS ══════

router.get('/conteneurs', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM types_conteneurs ORDER BY nom');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ══════ POSITIONS ══════

router.get('/positions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM positions WHERE is_active = true ORDER BY name');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;

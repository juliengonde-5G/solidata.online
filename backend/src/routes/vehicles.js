const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// GET /api/vehicles
router.get('/', async (req, res) => {
  try {
    const { status, team_id } = req.query;
    let query = 'SELECT v.*, t.name as team_name FROM vehicles v LEFT JOIN teams t ON v.team_id = t.id WHERE 1=1';
    const params = [];

    if (status) { params.push(status); query += ` AND v.status = $${params.length}`; }
    if (team_id) { params.push(team_id); query += ` AND v.team_id = $${params.length}`; }

    query += ' ORDER BY v.name';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[VEHICLES] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/vehicles/available — Véhicules disponibles
router.get('/available', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM vehicles WHERE status = 'available' ORDER BY name"
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[VEHICLES] Erreur available :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/vehicles/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT v.*, t.name as team_name FROM vehicles v LEFT JOIN teams t ON v.team_id = t.id WHERE v.id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Véhicule non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[VEHICLES] Erreur détail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/vehicles
router.post('/', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { registration, name, max_capacity_kg, team_id, current_km } = req.body;
    if (!registration) return res.status(400).json({ error: 'Immatriculation requise' });

    const result = await pool.query(
      `INSERT INTO vehicles (registration, name, max_capacity_kg, team_id, current_km)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [registration.toUpperCase(), name, max_capacity_kg || 3500, team_id, current_km || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Immatriculation déjà existante' });
    console.error('[VEHICLES] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/vehicles/:id
router.put('/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { name, max_capacity_kg, team_id, status, current_km } = req.body;
    const result = await pool.query(
      `UPDATE vehicles SET name = COALESCE($1, name), max_capacity_kg = COALESCE($2, max_capacity_kg),
       team_id = COALESCE($3, team_id), status = COALESCE($4, status),
       current_km = COALESCE($5, current_km), updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [name, max_capacity_kg, team_id, status, current_km, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Véhicule non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[VEHICLES] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/vehicles/:id
router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE vehicles SET status = 'out_of_service', updated_at = NOW() WHERE id = $1 RETURNING id",
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Véhicule non trouvé' });
    res.json({ message: 'Véhicule mis hors service' });
  } catch (err) {
    console.error('[VEHICLES] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

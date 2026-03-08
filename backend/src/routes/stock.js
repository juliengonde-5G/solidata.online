const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// GET /api/stock — Mouvements de stock
router.get('/', async (req, res) => {
  try {
    const { type, date_from, date_to, limit: lim } = req.query;
    let query = `SELECT sm.*, m.categorie as matiere_categorie, m.sous_categorie
       FROM stock_movements sm LEFT JOIN matieres m ON sm.matiere_id = m.id WHERE 1=1`;
    const params = [];

    if (type) { params.push(type); query += ` AND sm.type = $${params.length}`; }
    if (date_from) { params.push(date_from); query += ` AND sm.date >= $${params.length}`; }
    if (date_to) { params.push(date_to); query += ` AND sm.date <= $${params.length}`; }

    query += ' ORDER BY sm.date DESC, sm.created_at DESC';
    if (lim) { params.push(parseInt(lim)); query += ` LIMIT $${params.length}`; }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[STOCK] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/stock/summary — Résumé par catégorie
router.get('/summary', async (req, res) => {
  try {
    const { period } = req.query; // 30, 90, 365
    const days = parseInt(period) || 30;

    const result = await pool.query(`
      SELECT
        COALESCE(m.categorie, 'Non classé') as categorie,
        SUM(CASE WHEN sm.type = 'entree' THEN sm.poids_kg ELSE 0 END) as total_entrees_kg,
        SUM(CASE WHEN sm.type = 'sortie' THEN sm.poids_kg ELSE 0 END) as total_sorties_kg,
        SUM(CASE WHEN sm.type = 'entree' THEN sm.poids_kg ELSE -sm.poids_kg END) as solde_kg,
        COUNT(*) as nb_mouvements
      FROM stock_movements sm
      LEFT JOIN matieres m ON sm.matiere_id = m.id
      WHERE sm.date >= NOW() - INTERVAL '${days} days'
      GROUP BY m.categorie
      ORDER BY solde_kg DESC
    `);

    const totals = await pool.query(`
      SELECT
        SUM(CASE WHEN type = 'entree' THEN poids_kg ELSE 0 END) as total_entrees,
        SUM(CASE WHEN type = 'sortie' THEN poids_kg ELSE 0 END) as total_sorties,
        SUM(CASE WHEN type = 'entree' THEN poids_kg ELSE -poids_kg END) as stock_actuel
      FROM stock_movements
    `);

    res.json({ byCategory: result.rows, totals: totals.rows[0] });
  } catch (err) {
    console.error('[STOCK] Erreur résumé :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/stock
router.post('/', async (req, res) => {
  try {
    const { type, date, poids_kg, matiere_id, destination, notes, code_barre,
      origine, categorie_collecte, poids_brut_kg, tare_kg, vehicle_id, tour_id } = req.body;

    if (!type || !date || !poids_kg) {
      return res.status(400).json({ error: 'type, date et poids_kg requis' });
    }

    const result = await pool.query(
      `INSERT INTO stock_movements (type, date, poids_kg, matiere_id, destination, notes,
       code_barre, origine, categorie_collecte, poids_brut_kg, tare_kg, vehicle_id, tour_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [type, date, poids_kg, matiere_id, destination, notes,
       code_barre, origine, categorie_collecte, poids_brut_kg, tare_kg, vehicle_id, tour_id, req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[STOCK] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/stock/matieres — Référentiel matières
router.get('/matieres', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM matieres ORDER BY categorie, sous_categorie');
    res.json(result.rows);
  } catch (err) {
    console.error('[STOCK] Erreur matières :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/stock/matieres
router.post('/matieres', async (req, res) => {
  try {
    const { categorie, sous_categorie, qualite, destination_possible } = req.body;
    const result = await pool.query(
      'INSERT INTO matieres (categorie, sous_categorie, qualite, destination_possible) VALUES ($1, $2, $3, $4) RETURNING *',
      [categorie, sous_categorie, qualite, destination_possible || []]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[STOCK] Erreur création matière :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

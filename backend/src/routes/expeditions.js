const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { autoLogActivity } = require('../middleware/activity-logger');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));
router.use(autoLogActivity('expedition'));

// GET /api/expeditions
router.get('/', async (req, res) => {
  try {
    const { exutoire_id, date_from, date_to } = req.query;
    let query = `SELECT exp.*, ex.nom as exutoire_nom, cs.nom as categorie_nom, cs.famille,
       tc.nom as conteneur_nom
       FROM expeditions exp
       JOIN exutoires ex ON exp.exutoire_id = ex.id
       JOIN categories_sortantes cs ON exp.categorie_sortante_id = cs.id
       LEFT JOIN types_conteneurs tc ON exp.type_conteneur_id = tc.id WHERE 1=1`;
    const params = [];

    if (exutoire_id) { params.push(exutoire_id); query += ` AND exp.exutoire_id = $${params.length}`; }
    if (date_from) { params.push(date_from); query += ` AND exp.date >= $${params.length}`; }
    if (date_to) { params.push(date_to); query += ` AND exp.date <= $${params.length}`; }

    query += ' ORDER BY exp.date DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[EXPEDITIONS] Erreur :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/expeditions
// Fix bug L1 : accepte les alias `date_expedition` et `poids_total_kg`
// utilisés par frontend/src/pages/Expeditions.jsx en plus des noms
// canoniques `date` / `poids_kg`.
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const date = body.date || body.date_expedition;
    const poids_kg = body.poids_kg ?? body.poids_total_kg;
    const { exutoire_id, categorie_sortante_id, type_conteneur_id,
      nb_conteneurs, valeur_euros, bon_livraison, notes } = body;

    if (!date) return res.status(400).json({ error: 'Date requise' });
    if (!exutoire_id) return res.status(400).json({ error: 'ID exutoire requis' });
    if (!categorie_sortante_id) return res.status(400).json({ error: 'ID catégorie sortante requis' });
    if (poids_kg === undefined || poids_kg === null || isNaN(parseFloat(poids_kg)) || parseFloat(poids_kg) < 0) {
      return res.status(400).json({ error: 'Poids requis (valeur numérique ≥ 0)' });
    }

    const result = await pool.query(
      `INSERT INTO expeditions (date, exutoire_id, categorie_sortante_id, type_conteneur_id,
       nb_conteneurs, poids_kg, valeur_euros, bon_livraison, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [date, exutoire_id, categorie_sortante_id, type_conteneur_id,
       nb_conteneurs || 1, poids_kg, valeur_euros, bon_livraison, notes, req.user.id]
    );

    // Stock Original : sortie automatique si expédition de famille 'original'
    const catCheck = await pool.query(
      'SELECT famille FROM categories_sortantes WHERE id = $1',
      [categorie_sortante_id]
    );
    if (catCheck.rows.length > 0 && catCheck.rows[0].famille === 'original') {
      await pool.query(
        `INSERT INTO stock_original_movements (type, date, poids_kg, expedition_id, origine, destination, notes, created_by)
         VALUES ('sortie', $1, $2, $3, 'expedition_original', $4, $5, $6)`,
        [date, poids_kg, result.rows[0].id,
         `Exutoire #${exutoire_id}`,
         `Auto: expédition #${result.rows[0].id} (${poids_kg} kg original)`, req.user.id]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[EXPEDITIONS] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/expeditions/summary — Consolidation mensuelle
router.get('/summary', async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const result = await pool.query(`
      SELECT ex.nom as exutoire, cs.nom as categorie, cs.famille,
       SUM(exp.poids_kg) as total_kg, SUM(exp.valeur_euros) as total_euros,
       SUM(exp.nb_conteneurs) as total_conteneurs, COUNT(*) as nb_expeditions
      FROM expeditions exp
      JOIN exutoires ex ON exp.exutoire_id = ex.id
      JOIN categories_sortantes cs ON exp.categorie_sortante_id = cs.id
      WHERE exp.date BETWEEN $1 AND $2
      GROUP BY ex.nom, cs.nom, cs.famille
      ORDER BY total_kg DESC
    `, [month + '-01', month + '-31']);

    res.json(result.rows);
  } catch (err) {
    console.error('[EXPEDITIONS] Erreur consolidation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

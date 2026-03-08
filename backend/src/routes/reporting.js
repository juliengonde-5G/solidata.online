const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN', 'MANAGER', 'AUTORITE'));

// GET /api/reporting/dashboard — KPIs globaux
router.get('/dashboard', async (req, res) => {
  try {
    const period = parseInt(req.query.period) || 30;
    if (period < 1 || period > 3650) {
      return res.status(400).json({ error: 'Période invalide (1-3650 jours)' });
    }

    // Tonnage collecté
    const collecte = await pool.query(
      `SELECT COALESCE(SUM(total_weight_kg), 0) as tonnage_collecte
       FROM tours WHERE status = 'completed' AND date >= NOW() - make_interval(days => $1)`,
      [period]
    );

    // Tonnage trié (production)
    const tri = await pool.query(
      `SELECT COALESCE(SUM(total_jour_t), 0) as tonnage_trie
       FROM production_daily WHERE date >= NOW() - make_interval(days => $1)`,
      [period]
    );

    // Nombre de tournées
    const tours = await pool.query(
      `SELECT COUNT(*) as nb_tours, COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
       FROM tours WHERE date >= NOW() - make_interval(days => $1)`,
      [period]
    );

    // CAV stats
    const cavStats = await pool.query(`
      SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'active' THEN 1 END) as actifs
      FROM cav
    `);

    // Candidats
    const candidates = await pool.query(`
      SELECT COUNT(*) as total,
       COUNT(CASE WHEN status = 'received' THEN 1 END) as received,
       COUNT(CASE WHEN status = 'recruited' THEN 1 END) as recruited
      FROM candidates
    `);

    // Employés actifs
    const employees = await pool.query("SELECT COUNT(*) as total FROM employees WHERE is_active = true");

    // CO2 évité
    const co2 = parseFloat(collecte.rows[0].tonnage_collecte) * 3.6;

    // Facturation
    const billing = await pool.query(
      `SELECT COALESCE(SUM(total_ttc), 0) as total_ttc,
       COUNT(CASE WHEN status = 'paid' THEN 1 END) as nb_payees,
       COUNT(CASE WHEN status = 'overdue' THEN 1 END) as nb_impayees
       FROM invoices WHERE date >= NOW() - make_interval(days => $1)`,
      [period]
    );

    res.json({
      period: parseInt(period),
      collecte: {
        tonnage_kg: parseFloat(collecte.rows[0].tonnage_collecte),
        tonnage_t: Math.round(parseFloat(collecte.rows[0].tonnage_collecte) / 100) / 10,
        co2_evite_kg: Math.round(co2),
      },
      production: {
        tonnage_trie_t: parseFloat(tri.rows[0].tonnage_trie),
      },
      tours: tours.rows[0],
      cav: cavStats.rows[0],
      candidates: candidates.rows[0],
      employees: { total: parseInt(employees.rows[0].total) },
      billing: billing.rows[0],
    });
  } catch (err) {
    console.error('[REPORTING] Erreur dashboard :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/reporting/collecte — Données collecte par période
router.get('/collecte', async (req, res) => {
  try {
    const { group_by, date_from, date_to } = req.query;
    const grouping = group_by === 'month' ? "TO_CHAR(date, 'YYYY-MM')" : 'date';

    let query = `
      SELECT ${grouping} as periode,
       COUNT(*) as nb_tours,
       ROUND(SUM(total_weight_kg)::numeric, 1) as total_kg,
       ROUND(AVG(total_weight_kg)::numeric, 1) as avg_kg
      FROM tours WHERE status = 'completed'
    `;
    const params = [];
    if (date_from) { params.push(date_from); query += ` AND date >= $${params.length}`; }
    if (date_to) { params.push(date_to); query += ` AND date <= $${params.length}`; }
    query += ` GROUP BY ${grouping === "TO_CHAR(date, 'YYYY-MM')" ? "TO_CHAR(date, 'YYYY-MM')" : 'date'} ORDER BY periode`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[REPORTING] Erreur collecte :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/reporting/cav-map — Données carte CAV prédictive
router.get('/cav-map', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.latitude, c.longitude, c.commune, c.nb_containers, c.status,
       (SELECT MAX(th.date) FROM tonnage_history th WHERE th.cav_id = c.id) as last_collection,
       (SELECT ROUND(AVG(th.weight_kg)::numeric, 1) FROM tonnage_history th WHERE th.cav_id = c.id AND th.date >= NOW() - INTERVAL '90 days') as avg_90d,
       (SELECT COUNT(*) FROM tour_cav tc JOIN tours t ON tc.tour_id = t.id WHERE tc.cav_id = c.id AND t.status = 'completed' AND t.date >= NOW() - INTERVAL '90 days') as nb_collectes_90d
      FROM cav c WHERE c.status = 'active'
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[REPORTING] Erreur cav-map :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

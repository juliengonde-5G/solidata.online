const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// ══════════════════════════════════════════
// DASHBOARD COLLECTIVITÉ — Métropole de Rouen
// ══════════════════════════════════════════

// GET /api/metropole/dashboard — KPIs mensuels
router.get('/dashboard', async (req, res) => {
  try {
    const { year, month } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || new Date().getMonth() + 1;

    const dateFrom = `${y}-${String(m).padStart(2, '0')}-01`;
    const dateTo = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    // Volume de collecte global (kg)
    const collecte = await pool.query(`
      SELECT COALESCE(SUM(total_weight_kg), 0) as total_kg,
        COUNT(*) as nb_tours,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as tours_completees
      FROM tours
      WHERE date >= $1 AND date < $2
    `, [dateFrom, dateTo]);

    // Émissions CO2 évitées (facteur: 1 tonne textile réemployé = 3.169 t CO2 évitées, recyclé = 0.5 t)
    const totalKg = parseFloat(collecte.rows[0].total_kg) || 0;
    const totalTonnes = totalKg / 1000;
    // Hypothèse: 40% réemploi, 45% recyclage, 15% CSR/énergie
    const co2Reemploi = totalTonnes * 0.40 * 3.169;
    const co2Recyclage = totalTonnes * 0.45 * 0.5;
    const co2Total = Math.round((co2Reemploi + co2Recyclage) * 100) / 100;

    // Effectifs
    const effectifs = await pool.query(`
      SELECT COUNT(*) as total,
        COUNT(CASE WHEN contract_type IN ('CDD', 'CDI') THEN 1 END) as cdi_cdd,
        COUNT(CASE WHEN contract_type = 'interim' THEN 1 END) as interimaires,
        COUNT(CASE WHEN contract_type IN ('stage', 'apprentissage') THEN 1 END) as formation
      FROM employees WHERE is_active = true
    `);

    // CAV actifs et indisponibles
    const cavStats = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as actifs,
        COUNT(CASE WHEN status = 'unavailable' THEN 1 END) as indisponibles
      FROM cav
    `);

    // Historique mensuel (12 derniers mois)
    const historique = await pool.query(`
      SELECT
        DATE_TRUNC('month', t.date) as mois,
        COALESCE(SUM(t.total_weight_kg), 0) as total_kg,
        COUNT(t.id) as nb_tours
      FROM tours t
      WHERE t.status = 'completed'
      AND t.date >= (DATE_TRUNC('month', $1::date) - INTERVAL '11 months')
      AND t.date < $2::date
      GROUP BY DATE_TRUNC('month', t.date)
      ORDER BY mois
    `, [dateFrom, dateTo]);

    res.json({
      period: { year: y, month: m },
      collecte: {
        total_kg: totalKg,
        total_tonnes: Math.round(totalTonnes * 100) / 100,
        nb_tours: parseInt(collecte.rows[0].nb_tours),
        tours_completees: parseInt(collecte.rows[0].tours_completees),
      },
      emissions_evitees: {
        co2_total_tonnes: co2Total,
        detail: {
          reemploi_tonnes: Math.round(co2Reemploi * 100) / 100,
          recyclage_tonnes: Math.round(co2Recyclage * 100) / 100,
        },
      },
      effectifs: effectifs.rows[0],
      cav: cavStats.rows[0],
      historique_mensuel: historique.rows,
    });
  } catch (err) {
    console.error('[METROPOLE] Erreur dashboard :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/metropole/cav — Liste des CAV avec statut pour la carte
router.get('/cav', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.address, c.commune, c.latitude, c.longitude,
        c.nb_containers, c.status, c.unavailable_reason, c.unavailable_since,
        c.qr_code_data,
        (SELECT MAX(th.date) FROM tonnage_history th WHERE th.cav_id = c.id) as derniere_collecte,
        (SELECT COUNT(*) FROM tonnage_history th WHERE th.cav_id = c.id
         AND th.date >= NOW() - INTERVAL '12 months') as nb_collectes_12m,
        (SELECT COALESCE(SUM(th.weight_kg), 0) FROM tonnage_history th WHERE th.cav_id = c.id
         AND th.date >= NOW() - INTERVAL '12 months') as total_kg_12m
      FROM cav c
      ORDER BY c.commune, c.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[METROPOLE] Erreur CAV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/metropole/cav/:id/details — Détail d'un CAV (historique + événements)
router.get('/cav/:id/details', async (req, res) => {
  try {
    const cav = await pool.query('SELECT * FROM cav WHERE id = $1', [req.params.id]);
    if (cav.rows.length === 0) return res.status(404).json({ error: 'CAV non trouvé' });

    // Historique de collecte (12 mois)
    const history = await pool.query(`
      SELECT date, weight_kg, source FROM tonnage_history
      WHERE cav_id = $1 AND date >= NOW() - INTERVAL '12 months'
      ORDER BY date DESC
    `, [req.params.id]);

    // Historique des niveaux de remplissage
    const fillHistory = await pool.query(`
      SELECT t.date, tc.fill_level, tc.status as collection_status
      FROM tour_cav tc
      JOIN tours t ON tc.tour_id = t.id
      WHERE tc.cav_id = $1 AND t.date >= NOW() - INTERVAL '12 months'
      ORDER BY t.date DESC
    `, [req.params.id]);

    // Événements (indisponibilités, changements de statut)
    const events = await pool.query(`
      SELECT date, weight_kg as value, source as type FROM tonnage_history
      WHERE cav_id = $1 AND date >= NOW() - INTERVAL '12 months'
      UNION ALL
      SELECT t.date, tc.fill_level::DOUBLE PRECISION, 'fill_level'
      FROM tour_cav tc JOIN tours t ON tc.tour_id = t.id
      WHERE tc.cav_id = $1 AND tc.fill_level IS NOT NULL AND t.date >= NOW() - INTERVAL '12 months'
      ORDER BY date DESC
    `, [req.params.id]);

    // Scans QR (si table existe)
    let qrScans = [];
    try {
      const scans = await pool.query(`
        SELECT * FROM cav_qr_scans WHERE cav_id = $1
        ORDER BY scanned_at DESC LIMIT 50
      `, [req.params.id]);
      qrScans = scans.rows;
    } catch (_) {}

    // Stats agrégées
    const stats = await pool.query(`
      SELECT
        COUNT(*) as nb_collectes,
        COALESCE(SUM(weight_kg), 0) as total_kg,
        COALESCE(AVG(weight_kg), 0) as avg_kg,
        COALESCE(MIN(weight_kg), 0) as min_kg,
        COALESCE(MAX(weight_kg), 0) as max_kg
      FROM tonnage_history
      WHERE cav_id = $1 AND date >= NOW() - INTERVAL '12 months'
    `, [req.params.id]);

    res.json({
      cav: cav.rows[0],
      stats: stats.rows[0],
      collection_history: history.rows,
      fill_history: fillHistory.rows,
      events,
      qr_scans: qrScans,
    });
  } catch (err) {
    console.error('[METROPOLE] Erreur détail CAV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/metropole/evolution — Évolution mensuelle sur N mois
router.get('/evolution', async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 12;

    const result = await pool.query(`
      SELECT
        DATE_TRUNC('month', t.date) as mois,
        COALESCE(SUM(t.total_weight_kg), 0) as total_kg,
        COUNT(t.id) as nb_tours,
        COUNT(DISTINCT tc.cav_id) as nb_cav_collectes
      FROM tours t
      LEFT JOIN tour_cav tc ON tc.tour_id = t.id AND tc.status = 'collected'
      WHERE t.status = 'completed'
      AND t.date >= DATE_TRUNC('month', NOW()) - make_interval(months => $1)
      GROUP BY DATE_TRUNC('month', t.date)
      ORDER BY mois
    `, [months]);

    res.json(result.rows);
  } catch (err) {
    console.error('[METROPOLE] Erreur évolution :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

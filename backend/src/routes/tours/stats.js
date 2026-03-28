const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { isHoliday, getSchoolVacationStatus, getSeasonalFactors, getDayOfWeekFactors } = require('./predictions');

// ══════ REPORTING & ALERTES ══════

// GET /api/tours/reporting/kpis — KPIs globaux des tournées
router.get('/reporting/kpis', async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const from = date_from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const to = date_to || new Date().toISOString().split('T')[0];

    const kpis = await pool.query(`
      SELECT
        COUNT(*) as total_tours,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as tours_completees,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as tours_annulees,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN total_weight_kg ELSE 0 END), 0) as poids_total_kg,
        COALESCE(AVG(CASE WHEN status = 'completed' THEN total_weight_kg END), 0) as poids_moyen_kg,
        COALESCE(AVG(CASE WHEN status = 'completed' THEN EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600 END), 0) as duree_moyenne_h
      FROM tours
      WHERE date BETWEEN $1 AND $2
    `, [from, to]);

    const cavStats = await pool.query(`
      SELECT
        COUNT(*) as total_cav_planifies,
        COUNT(CASE WHEN tc.status = 'collected' THEN 1 END) as cav_collectes,
        COUNT(CASE WHEN tc.status = 'skipped' THEN 1 END) as cav_ignores
      FROM tour_cav tc
      JOIN tours t ON tc.tour_id = t.id
      WHERE t.date BETWEEN $1 AND $2
    `, [from, to]);

    const driverKpis = await pool.query(`
      SELECT
        u.id, u.first_name, u.last_name,
        COUNT(t.id) as nb_tours,
        COALESCE(SUM(t.total_weight_kg), 0) as total_kg,
        COALESCE(AVG(t.total_weight_kg), 0) as avg_kg_par_tour,
        COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as tours_completees
      FROM tours t
      JOIN users u ON t.driver_id = u.id
      WHERE t.date BETWEEN $1 AND $2
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY total_kg DESC
    `, [from, to]);

    res.json({
      period: { from, to },
      global: kpis.rows[0],
      cav: cavStats.rows[0],
      drivers: driverKpis.rows,
    });
  } catch (err) {
    console.error('[TOURS] Erreur KPIs :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/reporting/anomalies — Détection d'anomalies
router.get('/reporting/anomalies', async (req, res) => {
  try {
    const anomalies = [];

    // Tours complétées sans poids
    const noWeight = await pool.query(`
      SELECT id, date, driver_id FROM tours
      WHERE status = 'completed' AND (total_weight_kg IS NULL OR total_weight_kg = 0)
      AND date >= NOW() - INTERVAL '30 days'
      ORDER BY date DESC LIMIT 20
    `);
    for (const t of noWeight.rows) {
      anomalies.push({ type: 'tour_sans_poids', severity: 'warning', tour_id: t.id, date: t.date,
        message: `Tournée #${t.id} complétée sans poids enregistré` });
    }

    // CAVs planifiés mais non collectés
    const skippedCavs = await pool.query(`
      SELECT tc.tour_id, tc.cav_id, c.nom as cav_nom, t.date
      FROM tour_cav tc
      JOIN tours t ON tc.tour_id = t.id
      JOIN cav c ON tc.cav_id = c.id
      WHERE t.status = 'completed' AND tc.status != 'collected'
      AND t.date >= NOW() - INTERVAL '7 days'
      ORDER BY t.date DESC LIMIT 30
    `);
    for (const s of skippedCavs.rows) {
      anomalies.push({ type: 'cav_non_collecte', severity: 'info', tour_id: s.tour_id,
        cav_id: s.cav_id, cav_nom: s.cav_nom, date: s.date,
        message: `CAV "${s.cav_nom}" non collecté lors de la tournée #${s.tour_id}` });
    }

    // Poids aberrants (> 2x la moyenne)
    const avgWeight = await pool.query(`
      SELECT AVG(total_weight_kg) as avg, STDDEV(total_weight_kg) as stddev
      FROM tours WHERE status = 'completed' AND total_weight_kg > 0
    `);
    if (avgWeight.rows[0].avg) {
      const threshold = parseFloat(avgWeight.rows[0].avg) + 2 * parseFloat(avgWeight.rows[0].stddev || 0);
      const outliers = await pool.query(`
        SELECT id, date, total_weight_kg FROM tours
        WHERE status = 'completed' AND total_weight_kg > $1
        AND date >= NOW() - INTERVAL '30 days'
        ORDER BY total_weight_kg DESC LIMIT 10
      `, [threshold]);
      for (const o of outliers.rows) {
        anomalies.push({ type: 'poids_aberrant', severity: 'warning', tour_id: o.id,
          date: o.date, weight: o.total_weight_kg,
          message: `Poids anormalement élevé: ${o.total_weight_kg}kg (moyenne: ${Math.round(avgWeight.rows[0].avg)}kg)` });
      }
    }

    // Tours sans mouvement de stock associé
    const noStock = await pool.query(`
      SELECT t.id, t.date, t.total_weight_kg FROM tours t
      LEFT JOIN stock_movements sm ON sm.tour_id = t.id
      WHERE t.status = 'completed' AND t.total_weight_kg > 0
      AND sm.id IS NULL AND t.date >= NOW() - INTERVAL '30 days'
      ORDER BY t.date DESC LIMIT 20
    `);
    for (const n of noStock.rows) {
      anomalies.push({ type: 'stock_manquant', severity: 'error', tour_id: n.id,
        date: n.date, weight: n.total_weight_kg,
        message: `Tournée #${n.id} (${n.total_weight_kg}kg) sans entrée de stock` });
    }

    res.json(anomalies);
  } catch (err) {
    console.error('[TOURS] Erreur anomalies :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/reporting/cav-analytics — Analytiques par CAV
router.get('/reporting/cav-analytics', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id, c.nom, c.commune, c.type,
        COUNT(tc.id) as nb_collectes,
        COALESCE(SUM(th.weight_kg), 0) as total_kg,
        COALESCE(AVG(th.weight_kg), 0) as avg_kg,
        MAX(t.date) as derniere_collecte,
        COALESCE(AVG(tc.fill_level), 0) as avg_fill_level
      FROM cav c
      LEFT JOIN tour_cav tc ON tc.cav_id = c.id AND tc.status = 'collected'
      LEFT JOIN tours t ON tc.tour_id = t.id AND t.status = 'completed'
      LEFT JOIN tonnage_history th ON th.cav_id = c.id
      WHERE c.is_active = true
      GROUP BY c.id, c.nom, c.commune, c.type
      ORDER BY total_kg DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[TOURS] Erreur analytics CAV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// MOTEUR PRÉDICTIF V2 — ENDPOINTS AVANCÉS
// ══════════════════════════════════════════════════════════════

// GET /api/tours/predictive/accuracy — Précision du moteur prédictif
// Mesure la qualité des prédictions sur les N derniers jours
router.get('/predictive/accuracy', authorize('ADMIN'), async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    // Précision globale : écart moyen prédit vs observé
    const global = await pool.query(`
      SELECT
        COUNT(*) as total_samples,
        AVG(ABS(predicted_fill_rate - (observed_fill_level * 20))) as mae,
        SQRT(AVG(POWER(predicted_fill_rate - (observed_fill_level * 20), 2))) as rmse,
        AVG(predicted_fill_rate) as avg_predicted,
        AVG(observed_fill_level * 20) as avg_observed,
        CORR(predicted_fill_rate, observed_fill_level * 20) as correlation
      FROM collection_learning_feedback
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        AND observed_fill_level IS NOT NULL
    `, [days]);

    // Précision par CAV (top 10 meilleurs et pires)
    const perCav = await pool.query(`
      SELECT
        clf.cav_id,
        c.name as cav_name,
        c.commune,
        COUNT(*) as samples,
        AVG(ABS(clf.predicted_fill_rate - (clf.observed_fill_level * 20))) as mae,
        SQRT(AVG(POWER(clf.predicted_fill_rate - (clf.observed_fill_level * 20), 2))) as rmse,
        AVG(clf.predicted_fill_rate - (clf.observed_fill_level * 20)) as bias
      FROM collection_learning_feedback clf
      JOIN cav c ON clf.cav_id = c.id
      WHERE clf.created_at >= NOW() - INTERVAL '1 day' * $1
        AND clf.observed_fill_level IS NOT NULL
      GROUP BY clf.cav_id, c.name, c.commune
      HAVING COUNT(*) >= 3
      ORDER BY mae ASC
    `, [days]);

    // Évolution de la précision dans le temps (par semaine)
    const trend = await pool.query(`
      SELECT
        DATE_TRUNC('week', created_at) as week,
        COUNT(*) as samples,
        AVG(ABS(predicted_fill_rate - (observed_fill_level * 20))) as mae,
        SQRT(AVG(POWER(predicted_fill_rate - (observed_fill_level * 20), 2))) as rmse
      FROM collection_learning_feedback
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        AND observed_fill_level IS NOT NULL
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week ASC
    `, [days]);

    // Distribution des erreurs (pour histogramme)
    const errorDist = await pool.query(`
      SELECT
        CASE
          WHEN ABS(predicted_fill_rate - (observed_fill_level * 20)) < 5 THEN 'excellent (<5%)'
          WHEN ABS(predicted_fill_rate - (observed_fill_level * 20)) < 10 THEN 'bon (5-10%)'
          WHEN ABS(predicted_fill_rate - (observed_fill_level * 20)) < 20 THEN 'moyen (10-20%)'
          WHEN ABS(predicted_fill_rate - (observed_fill_level * 20)) < 30 THEN 'faible (20-30%)'
          ELSE 'mauvais (>30%)'
        END as category,
        COUNT(*) as count
      FROM collection_learning_feedback
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        AND observed_fill_level IS NOT NULL
      GROUP BY category
      ORDER BY count DESC
    `, [days]);

    const stats = global.rows[0];
    res.json({
      period: { days, from: new Date(Date.now() - days * 86400000).toISOString().split('T')[0] },
      global: {
        totalSamples: parseInt(stats.total_samples),
        mae: stats.mae ? Math.round(parseFloat(stats.mae) * 10) / 10 : null,
        rmse: stats.rmse ? Math.round(parseFloat(stats.rmse) * 10) / 10 : null,
        avgPredicted: stats.avg_predicted ? Math.round(parseFloat(stats.avg_predicted)) : null,
        avgObserved: stats.avg_observed ? Math.round(parseFloat(stats.avg_observed)) : null,
        correlation: stats.correlation ? Math.round(parseFloat(stats.correlation) * 100) / 100 : null,
        modelVersion: 'predictive_v2',
      },
      perCav: perCav.rows.map(r => ({
        cavId: r.cav_id,
        cavName: r.cav_name,
        commune: r.commune,
        samples: parseInt(r.samples),
        mae: Math.round(parseFloat(r.mae) * 10) / 10,
        rmse: Math.round(parseFloat(r.rmse) * 10) / 10,
        bias: Math.round(parseFloat(r.bias) * 10) / 10,
      })),
      weeklyTrend: trend.rows.map(r => ({
        week: r.week,
        samples: parseInt(r.samples),
        mae: Math.round(parseFloat(r.mae) * 10) / 10,
        rmse: Math.round(parseFloat(r.rmse) * 10) / 10,
      })),
      errorDistribution: errorDist.rows.map(r => ({
        category: r.category,
        count: parseInt(r.count),
      })),
    });
  } catch (err) {
    console.error('[TOURS] Erreur accuracy :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/predictive/export-training — Export des données d'entraînement ML
// Format prêt pour XGBoost/scikit-learn : une ligne par (CAV, date) avec tous les features
router.get('/predictive/export-training', authorize('ADMIN'), async (req, res) => {
  try {
    const SEASONAL_FACTORS = getSeasonalFactors();
    const DAY_OF_WEEK_FACTORS = getDayOfWeekFactors();

    const days = parseInt(req.query.days) || 365;
    const format = req.query.format || 'json'; // json ou csv

    const result = await pool.query(`
      SELECT
        th.cav_id,
        c.name as cav_name,
        c.commune,
        c.latitude,
        c.longitude,
        c.nb_containers,
        th.date,
        th.weight_kg,
        EXTRACT(MONTH FROM th.date) as month,
        EXTRACT(DOW FROM th.date) as day_of_week,
        EXTRACT(DOY FROM th.date) as day_of_year,
        cc.weather_code,
        cc.weather_factor,
        cc.temp_max,
        cc.precip_mm,
        cc.traffic_factor,
        cc.duration_factor,
        clf.predicted_fill_rate,
        clf.observed_fill_level,
        (SELECT MAX(th2.date) FROM tonnage_history th2
         WHERE th2.cav_id = th.cav_id AND th2.date < th.date) as prev_collection_date,
        (SELECT th2.weight_kg FROM tonnage_history th2
         WHERE th2.cav_id = th.cav_id AND th2.date < th.date
         ORDER BY th2.date DESC LIMIT 1) as prev_weight_kg,
        (SELECT AVG(th2.weight_kg) FROM tonnage_history th2
         WHERE th2.cav_id = th.cav_id
         AND th2.date BETWEEN th.date - INTERVAL '30 days' AND th.date - INTERVAL '1 day') as avg_weight_30d,
        (SELECT COUNT(*) FROM tonnage_history th2
         WHERE th2.cav_id = th.cav_id
         AND th2.date BETWEEN th.date - INTERVAL '30 days' AND th.date) as collections_30d
      FROM tonnage_history th
      JOIN cav c ON th.cav_id = c.id
      LEFT JOIN collection_context cc ON cc.date = th.date
      LEFT JOIN collection_learning_feedback clf ON clf.cav_id = th.cav_id
        AND DATE(clf.created_at) = th.date
      WHERE th.date >= NOW() - INTERVAL '1 day' * $1
      ORDER BY th.date DESC, th.cav_id
    `, [days]);

    // Enrichir avec les features calculés
    const rows = result.rows.map(r => {
      const prevDate = r.prev_collection_date;
      const daysSince = prevDate ? Math.floor((new Date(r.date) - new Date(prevDate)) / 86400000) : null;
      const monthIdx = parseInt(r.month) - 1;
      const dow = parseInt(r.day_of_week);
      const dowIdx = dow === 0 ? 6 : dow - 1;

      return {
        cav_id: r.cav_id,
        cav_name: r.cav_name,
        commune: r.commune,
        latitude: r.latitude ? parseFloat(r.latitude) : null,
        longitude: r.longitude ? parseFloat(r.longitude) : null,
        nb_containers: r.nb_containers,
        date: r.date,
        weight_kg: parseFloat(r.weight_kg),
        month: parseInt(r.month),
        day_of_week: dowIdx,
        day_of_year: parseInt(r.day_of_year),
        seasonal_factor: SEASONAL_FACTORS[monthIdx],
        dow_factor: DAY_OF_WEEK_FACTORS[dowIdx],
        is_holiday: isHoliday(r.date.toISOString ? r.date.toISOString().split('T')[0] : r.date) ? 1 : 0,
        vacation_status: getSchoolVacationStatus(r.date.toISOString ? r.date.toISOString().split('T')[0] : r.date).status || 'none',
        weather_code: r.weather_code,
        weather_factor: r.weather_factor ? parseFloat(r.weather_factor) : null,
        temp_max: r.temp_max ? parseFloat(r.temp_max) : null,
        precip_mm: r.precip_mm ? parseFloat(r.precip_mm) : null,
        days_since_prev: daysSince,
        prev_weight_kg: r.prev_weight_kg ? parseFloat(r.prev_weight_kg) : null,
        avg_weight_30d: r.avg_weight_30d ? parseFloat(r.avg_weight_30d) : null,
        collections_30d: parseInt(r.collections_30d) || 0,
        predicted_fill: r.predicted_fill_rate ? parseFloat(r.predicted_fill_rate) : null,
        observed_fill: r.observed_fill_level != null ? parseInt(r.observed_fill_level) * 20 : null,
      };
    });

    if (format === 'csv') {
      if (rows.length === 0) return res.status(200).send('');
      const headers = Object.keys(rows[0]);
      const csv = [headers.join(',')].concat(
        rows.map(r => headers.map(h => r[h] ?? '').join(','))
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=solidata_training_data.csv');
      return res.send(csv);
    }

    res.json({
      exportDate: new Date().toISOString(),
      period: { days },
      totalRows: rows.length,
      features: rows.length > 0 ? Object.keys(rows[0]) : [],
      data: rows,
    });
  } catch (err) {
    console.error('[TOURS] Erreur export training :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/predictive/cav-correlations — Corrélations entre CAV
// Identifie les CAV qui ont des patterns similaires (pour prédiction croisée)
router.get('/predictive/cav-correlations', authorize('ADMIN'), async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 90;

    // Trouver les paires de CAV avec des collectes aux mêmes dates
    const result = await pool.query(`
      WITH cav_timeseries AS (
        SELECT cav_id, date, weight_kg
        FROM tonnage_history
        WHERE date >= NOW() - INTERVAL '1 day' * $1
      )
      SELECT
        a.cav_id as cav_a,
        b.cav_id as cav_b,
        COUNT(*) as common_dates,
        CORR(a.weight_kg, b.weight_kg) as correlation,
        AVG(a.weight_kg) as avg_a,
        AVG(b.weight_kg) as avg_b
      FROM cav_timeseries a
      JOIN cav_timeseries b ON a.date = b.date AND a.cav_id < b.cav_id
      GROUP BY a.cav_id, b.cav_id
      HAVING COUNT(*) >= 5 AND CORR(a.weight_kg, b.weight_kg) IS NOT NULL
      ORDER BY ABS(CORR(a.weight_kg, b.weight_kg)) DESC
      LIMIT 50
    `, [days]);

    // Enrichir avec les noms
    const cavIds = new Set();
    result.rows.forEach(r => { cavIds.add(r.cav_a); cavIds.add(r.cav_b); });
    const cavNames = {};
    if (cavIds.size > 0) {
      const names = await pool.query(
        'SELECT id, name, commune FROM cav WHERE id = ANY($1)',
        [Array.from(cavIds)]
      );
      names.rows.forEach(r => { cavNames[r.id] = { name: r.name, commune: r.commune }; });
    }

    const correlations = result.rows.map(r => ({
      cavA: { id: r.cav_a, ...cavNames[r.cav_a] },
      cavB: { id: r.cav_b, ...cavNames[r.cav_b] },
      commonDates: parseInt(r.common_dates),
      correlation: Math.round(parseFloat(r.correlation) * 100) / 100,
      avgWeightA: Math.round(parseFloat(r.avg_a) * 10) / 10,
      avgWeightB: Math.round(parseFloat(r.avg_b) * 10) / 10,
    }));

    // Séparer corrélations positives (similaires) et négatives (inverses)
    const positive = correlations.filter(c => c.correlation > 0.5);
    const negative = correlations.filter(c => c.correlation < -0.3);

    res.json({
      period: { days },
      totalPairs: correlations.length,
      strongPositive: positive,
      strongNegative: negative,
      all: correlations,
    });
  } catch (err) {
    console.error('[TOURS] Erreur corrélations :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// ANALYSE IA — Endpoints utilisant Claude pour l'analyse prédictive
// ══════════════════════════════════════════════════════════════

// GET /api/tours/predictive/ia/synthese — Synthèse hebdomadaire IA
router.get('/predictive/ia/synthese', authorize('ADMIN'), async (req, res) => {
  try {
    const { analyseHebdomadaire } = require('../../services/predictive-ai');
    const result = await analyseHebdomadaire();
    res.json(result);
  } catch (err) {
    console.error('[TOURS] Erreur synthèse IA :', err);
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: 'Service IA non configuré' });
    }
    res.status(500).json({ error: 'Erreur analyse IA' });
  }
});

// GET /api/tours/predictive/ia/ajustements — Recommandations d'ajustement des facteurs
router.get('/predictive/ia/ajustements', authorize('ADMIN'), async (req, res) => {
  try {
    const { recommanderAjustements } = require('../../services/predictive-ai');
    const result = await recommanderAjustements();
    res.json(result);
  } catch (err) {
    console.error('[TOURS] Erreur ajustements IA :', err);
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: 'Service IA non configuré' });
    }
    res.status(500).json({ error: 'Erreur analyse IA' });
  }
});

// GET /api/tours/predictive/ia/prediction/:cavId — Prédiction enrichie IA pour un CAV
router.get('/predictive/ia/prediction/:cavId', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { predictionEnrichie } = require('../../services/predictive-ai');
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const result = await predictionEnrichie(parseInt(req.params.cavId), date);
    res.json(result);
  } catch (err) {
    console.error('[TOURS] Erreur prédiction enrichie IA :', err);
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: 'Service IA non configuré' });
    }
    res.status(500).json({ error: 'Erreur prédiction IA' });
  }
});

module.exports = router;

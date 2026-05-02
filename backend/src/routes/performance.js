const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// ══════════════════════════════════════════
// GET /api/performance/dashboard — KPIs consolides
// ══════════════════════════════════════════
router.get('/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const monthStart = now.toISOString().slice(0, 7) + '-01';
    const today = now.toISOString().split('T')[0];

    // Previous year same period for N-1 comparison
    const prevYearMonthStart = `${year - 1}-${(now.getMonth() + 1).toString().padStart(2, '0')}-01`;
    const prevYearToday = `${year - 1}-${today.slice(5)}`;

    const [
      tonnageMois, tonnageMoisN1,
      prodMois, prodMoisN1,
      employesActifs,
      toursCount, toursCountN1,
      trendCollecte7j, trendProd7j
    ] = await Promise.all([
      // Tonnage collecte ce mois
      pool.query(
        `SELECT COALESCE(SUM(total_weight_kg), 0) as total FROM tours WHERE status = 'completed' AND date >= $1 AND date <= $2`,
        [monthStart, today]
      ),
      // Tonnage collecte N-1
      pool.query(
        `SELECT COALESCE(SUM(total_weight_kg), 0) as total FROM tours WHERE status = 'completed' AND date >= $1 AND date <= $2`,
        [prevYearMonthStart, prevYearToday]
      ),
      // Production ce mois
      pool.query(
        `SELECT COALESCE(SUM(total_jour_t), 0) as total_t, COALESCE(AVG(productivite_kg_per), 0) as productivite_avg FROM production_daily WHERE date >= $1 AND date <= $2`,
        [monthStart, today]
      ),
      // Production N-1
      pool.query(
        `SELECT COALESCE(SUM(total_jour_t), 0) as total_t, COALESCE(AVG(productivite_kg_per), 0) as productivite_avg FROM production_daily WHERE date >= $1 AND date <= $2`,
        [prevYearMonthStart, prevYearToday]
      ),
      // Employes actifs
      pool.query(`SELECT COUNT(*)::int as count FROM employees WHERE is_active = true`),
      // Tours ce mois
      pool.query(
        `SELECT COUNT(*)::int as total, COUNT(CASE WHEN status = 'completed' THEN 1 END)::int as completed FROM tours WHERE date >= $1`,
        [monthStart]
      ),
      // Tours N-1
      pool.query(
        `SELECT COUNT(*)::int as total, COUNT(CASE WHEN status = 'completed' THEN 1 END)::int as completed FROM tours WHERE date >= $1 AND date <= $2`,
        [prevYearMonthStart, prevYearToday]
      ),
      // Trend collecte 7 derniers jours
      pool.query(`
        SELECT date, COALESCE(SUM(total_weight_kg), 0) as kg
        FROM tours WHERE status = 'completed' AND date >= NOW() - INTERVAL '7 days'
        GROUP BY date ORDER BY date
      `),
      // Trend production 7 derniers jours
      pool.query(`
        SELECT date, COALESCE(SUM(total_jour_t * 1000), 0) as kg
        FROM production_daily WHERE date >= NOW() - INTERVAL '7 days'
        GROUP BY date ORDER BY date
      `),
    ]);

    const collecteKg = parseFloat(tonnageMois.rows[0].total);
    const collecteKgN1 = parseFloat(tonnageMoisN1.rows[0].total);
    const prodT = parseFloat(prodMois.rows[0].total_t);
    const prodTN1 = parseFloat(prodMoisN1.rows[0].total_t);

    res.json({
      collecte: {
        tonnage_mois_kg: collecteKg,
        tonnage_mois_n1_kg: collecteKgN1,
        variation_pct: collecteKgN1 > 0 ? Math.round((collecteKg - collecteKgN1) / collecteKgN1 * 100) : null,
        tours: toursCount.rows[0],
        tours_n1: toursCountN1.rows[0],
        trend_7j: trendCollecte7j.rows.map(r => parseFloat(r.kg)),
      },
      production: {
        total_mois_t: prodT,
        total_mois_n1_t: prodTN1,
        variation_pct: prodTN1 > 0 ? Math.round((prodT - prodTN1) / prodTN1 * 100) : null,
        productivite_avg: Math.round(parseFloat(prodMois.rows[0].productivite_avg)),
        productivite_avg_n1: Math.round(parseFloat(prodMoisN1.rows[0].productivite_avg)),
        trend_7j: trendProd7j.rows.map(r => parseFloat(r.kg)),
      },
      rh: {
        employes_actifs: employesActifs.rows[0].count,
      },
      valorisation_pct: collecteKg > 0 ? Math.round((prodT * 1000) / collecteKg * 100) : 0,
    });
  } catch (err) {
    console.error('[PERFORMANCE] dashboard error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// GET /api/performance/tonnage-evolution — 6 mois collecte + production
// ══════════════════════════════════════════
router.get('/tonnage-evolution', async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 6;

    const [collecte, production] = await Promise.all([
      pool.query(`
        SELECT TO_CHAR(date, 'YYYY-MM') as mois, COALESCE(SUM(total_weight_kg), 0) as kg
        FROM tours WHERE status = 'completed' AND date >= NOW() - make_interval(months => $1)
        GROUP BY 1 ORDER BY 1
      `, [months]),
      pool.query(`
        SELECT TO_CHAR(date, 'YYYY-MM') as mois, COALESCE(SUM(total_jour_t * 1000), 0) as kg
        FROM production_daily WHERE date >= NOW() - make_interval(months => $1)
        GROUP BY 1 ORDER BY 1
      `, [months]),
    ]);

    // Merge into unified series
    const allMonths = new Set([
      ...collecte.rows.map(r => r.mois),
      ...production.rows.map(r => r.mois),
    ]);
    const collecteMap = Object.fromEntries(collecte.rows.map(r => [r.mois, parseFloat(r.kg)]));
    const productionMap = Object.fromEntries(production.rows.map(r => [r.mois, parseFloat(r.kg)]));

    const data = [...allMonths].sort().map(mois => ({
      mois,
      collecte_kg: collecteMap[mois] || 0,
      production_kg: productionMap[mois] || 0,
    }));

    res.json(data);
  } catch (err) {
    console.error('[PERFORMANCE] tonnage-evolution error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// GET /api/performance/tri-distribution — repartition sorties
// ══════════════════════════════════════════
router.get('/tri-distribution', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COALESCE(destination, 'Non classé') as categorie,
        COALESCE(SUM(weight_kg), 0) as total_kg
      FROM expeditions
      WHERE date >= DATE_TRUNC('year', NOW())
      GROUP BY destination
      ORDER BY total_kg DESC
    `);

    const total = result.rows.reduce((s, r) => s + parseFloat(r.total_kg), 0);
    const data = result.rows.map(r => ({
      categorie: r.categorie,
      kg: parseFloat(r.total_kg),
      pct: total > 0 ? Math.round(parseFloat(r.total_kg) / total * 1000) / 10 : 0,
    }));

    res.json(data);
  } catch (err) {
    console.error('[PERFORMANCE] tri-distribution error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// GET /api/performance/activity-heatmap — activite par jour/heure
// ══════════════════════════════════════════
router.get('/activity-heatmap', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT EXTRACT(DOW FROM date)::int as day_of_week,
        EXTRACT(HOUR FROM COALESCE(created_at, date::timestamp))::int as hour,
        COUNT(*)::int as count
      FROM tours
      WHERE date >= NOW() - INTERVAL '3 months'
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);

    // Build 7x24 matrix (0=Sunday)
    const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const row of result.rows) {
      matrix[row.day_of_week][row.hour] = row.count;
    }

    res.json({ matrix, labels_days: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'] });
  } catch (err) {
    console.error('[PERFORMANCE] activity-heatmap error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// GET /api/performance/scorecard — objectifs vs realise par module
// ══════════════════════════════════════════
router.get('/scorecard', async (req, res) => {
  try {
    const monthStart = new Date().toISOString().slice(0, 7) + '-01';
    const today = new Date().toISOString().split('T')[0];

    const [collecte, production, objectifs] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(total_weight_kg), 0) as kg FROM tours WHERE status = 'completed' AND date >= $1`,
        [monthStart]
      ),
      pool.query(
        `SELECT COALESCE(SUM(total_jour_t), 0) as total_t FROM production_daily WHERE date >= $1`,
        [monthStart]
      ),
      pool.query(`SELECT * FROM periodic_objectives WHERE is_active = true ORDER BY indicateur`),
    ]);

    const scorecard = objectifs.rows.map(obj => {
      const realise = parseFloat(obj.realise || 0);
      const cible = parseFloat(obj.valeur_cible || 1);
      const pct = Math.round((realise / cible) * 100);
      return {
        indicateur: obj.indicateur,
        unite: obj.unite,
        periode: obj.periode,
        objectif: cible,
        realise,
        ecart_pct: pct - 100,
        statut: pct >= 90 ? 'ok' : pct >= 70 ? 'warning' : 'alerte',
      };
    });

    res.json(scorecard);
  } catch (err) {
    console.error('[PERFORMANCE] scorecard error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// GET /api/performance/industrial-kpis — KPIs industriels
// ══════════════════════════════════════════
router.get('/industrial-kpis', async (req, res) => {
  try {
    const monthStart = new Date().toISOString().slice(0, 7) + '-01';
    const today = new Date().toISOString().split('T')[0];

    const [collecteStats, prodStats, rhStats, insertionStats] = await Promise.all([
      // Collecte KPIs
      pool.query(`
        SELECT COUNT(*)::int as nb_tours,
          COALESCE(AVG(total_weight_kg), 0) as kg_par_tour,
          COALESCE(SUM(total_weight_kg), 0) as total_kg,
          COUNT(CASE WHEN status = 'completed' THEN 1 END)::int as completed,
          COUNT(*)::int as total
        FROM tours WHERE date >= $1
      `, [monthStart]),

      // Production KPIs
      pool.query(`
        SELECT COALESCE(AVG(productivite_kg_per), 0) as productivite_avg,
          COALESCE(AVG(effectif_reel), 0) as effectif_moyen,
          COALESCE(SUM(entree_ligne_kg), 0) as total_entree_kg,
          COALESCE(SUM(total_jour_t * 1000), 0) as total_sortie_kg,
          COUNT(*)::int as jours_travailles
        FROM production_daily WHERE date >= $1
      `, [monthStart]),

      // RH KPIs
      pool.query(`
        SELECT COUNT(*)::int as actifs FROM employees WHERE is_active = true
      `),

      // Insertion KPIs
      pool.query(`
        SELECT COUNT(*)::int as total,
          COUNT(CASE WHEN status = 'completed' THEN 1 END)::int as termines,
          COUNT(CASE WHEN status = 'active' OR status IS NULL THEN 1 END)::int as actifs
        FROM insertion_diagnostics
      `),
    ]);

    const cs = collecteStats.rows[0];
    const ps = prodStats.rows[0];

    const totalEntreeKg = parseFloat(ps.total_entree_kg);
    const totalSortieKg = parseFloat(ps.total_sortie_kg);
    const rendement = totalEntreeKg > 0 ? Math.round(totalSortieKg / totalEntreeKg * 100) : 0;
    const tauxCompletion = parseInt(cs.total) > 0 ? Math.round(parseInt(cs.completed) / parseInt(cs.total) * 100) : 0;

    res.json({
      collecte: {
        kg_par_tour: Math.round(parseFloat(cs.kg_par_tour)),
        tours_mois: parseInt(cs.nb_tours),
        taux_completion: tauxCompletion,
        total_kg: parseFloat(cs.total_kg),
      },
      production: {
        rendement_matiere_pct: rendement,
        productivite_kg_pers_jour: Math.round(parseFloat(ps.productivite_avg)),
        effectif_moyen: Math.round(parseFloat(ps.effectif_moyen) * 10) / 10,
        jours_travailles: parseInt(ps.jours_travailles),
        total_entree_kg: totalEntreeKg,
        total_sortie_kg: totalSortieKg,
      },
      rh: {
        employes_actifs: rhStats.rows[0].actifs,
      },
      insertion: {
        parcours_actifs: insertionStats.rows[0].actifs,
        parcours_termines: insertionStats.rows[0].termines,
        total: insertionStats.rows[0].total,
      },
    });
  } catch (err) {
    console.error('[PERFORMANCE] industrial-kpis error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

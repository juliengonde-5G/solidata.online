const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// GET /api/production — Liste KPI journaliers
router.get('/', async (req, res) => {
  try {
    const { month, date_from, date_to } = req.query;
    let query = 'SELECT * FROM production_daily WHERE 1=1';
    const params = [];

    if (month) {
      params.push(month + '-01');
      params.push(month + '-31');
      query += ` AND date BETWEEN $${params.length - 1} AND $${params.length}`;
    }
    if (date_from) { params.push(date_from); query += ` AND date >= $${params.length}`; }
    if (date_to) { params.push(date_to); query += ` AND date <= $${params.length}`; }

    query += ' ORDER BY date DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[PRODUCTION] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/production/dashboard — KPIs du mois
router.get('/dashboard', async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    const result = await pool.query(`
      SELECT
        COUNT(*) as jours_travailles,
        ROUND(AVG(effectif_reel)::numeric, 1) as effectif_moyen,
        ROUND(SUM(entree_ligne_kg)::numeric, 0) as total_entree_ligne_kg,
        ROUND(SUM(entree_recyclage_r3_kg)::numeric, 0) as total_entree_r3_kg,
        ROUND(SUM(total_jour_t)::numeric, 2) as total_mois_t,
        ROUND(AVG(productivite_kg_per)::numeric, 0) as productivite_moyenne,
        ROUND(AVG(entree_ligne_kg)::numeric, 0) as moyenne_entree_ligne,
        ROUND(AVG(entree_recyclage_r3_kg)::numeric, 0) as moyenne_entree_r3
      FROM production_daily
      WHERE date BETWEEN $1 AND $2
    `, [month + '-01', month + '-31']);

    const daily = await pool.query(
      'SELECT date, entree_ligne_kg, objectif_entree_ligne_kg, entree_recyclage_r3_kg, objectif_entree_r3_kg, total_jour_t, productivite_kg_per, effectif_reel FROM production_daily WHERE date BETWEEN $1 AND $2 ORDER BY date',
      [month + '-01', month + '-31']
    );

    // Objectif mensuel : 46.8t (22 jours) ou 41.6t (mois court)
    const joursOuvres = parseInt(result.rows[0].jours_travailles) || 0;
    const objectifMensuel = joursOuvres >= 22 ? 46.8 : 41.6;
    const totalMois = parseFloat(result.rows[0].total_mois_t) || 0;

    res.json({
      summary: result.rows[0],
      daily: daily.rows,
      objectif_mensuel_t: objectifMensuel,
      atteinte_pct: objectifMensuel > 0 ? Math.round((totalMois / objectifMensuel) * 100) : 0,
    });
  } catch (err) {
    console.error('[PRODUCTION] Erreur dashboard :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/production — Saisir KPI journalier
router.post('/', [
  body('date').notEmpty().withMessage('Date requise'),
], validate, async (req, res) => {
  try {
    const { date, effectif_theorique, effectif_reel, entree_ligne_kg, objectif_entree_ligne_kg,
      entree_recyclage_r3_kg, objectif_entree_r3_kg, encadrant, commentaire } = req.body;

    if (!date) return res.status(400).json({ error: 'Date requise' });

    const totalJour = ((parseFloat(entree_ligne_kg) || 0) + (parseFloat(entree_recyclage_r3_kg) || 0)) / 1000;
    const productivite = (effectif_reel && effectif_reel > 0)
      ? ((parseFloat(entree_ligne_kg) || 0) + (parseFloat(entree_recyclage_r3_kg) || 0)) / effectif_reel
      : 0;

    const result = await pool.query(
      `INSERT INTO production_daily (date, effectif_theorique, effectif_reel,
       entree_ligne_kg, objectif_entree_ligne_kg, entree_recyclage_r3_kg, objectif_entree_r3_kg,
       total_jour_t, productivite_kg_per, encadrant, commentaire, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (date) DO UPDATE SET
       effectif_theorique = $2, effectif_reel = $3, entree_ligne_kg = $4,
       objectif_entree_ligne_kg = $5, entree_recyclage_r3_kg = $6, objectif_entree_r3_kg = $7,
       total_jour_t = $8, productivite_kg_per = $9, encadrant = $10, commentaire = $11, updated_at = NOW()
       RETURNING *`,
      [date, effectif_theorique, effectif_reel,
       entree_ligne_kg || 0, objectif_entree_ligne_kg || 1300,
       entree_recyclage_r3_kg || 0, objectif_entree_r3_kg || 1300,
       totalJour, Math.round(productivite), encadrant, commentaire, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PRODUCTION] Erreur saisie :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

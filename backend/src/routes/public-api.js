// ══════════════════════════════════════════════════════════════
// API publique partenaires (Niveau 3.3) — Read-only.
// ══════════════════════════════════════════════════════════════
// Protégée par X-API-Key. Scopes utilisés :
//   - cav:read       — liste des CAV (lat/lng/adresse, statut, commune)
//   - stats:read     — statistiques agrégées (tonnage, tournées)
//   - refashion:read — données DPAV / Refashion
//
// Aucune donnée personnelle ni contact. Pas d'accès aux noms
// chauffeurs ni à l'historique détaillé des tournées.

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { apiKeyAuth } = require('../middleware/api-key');

// Rate limit léger via middleware global (pas besoin ici).

router.get('/health', apiKeyAuth(), async (req, res) => {
  res.json({ ok: true, client: req.apiKey?.name, scopes: req.apiKey?.scopes });
});

// GET /api/public/cav — Liste CAV publique
router.get('/cav', apiKeyAuth(['cav:read']), async (req, res) => {
  try {
    const { commune, status } = req.query;
    let query = `SELECT id, name, address, commune, code_postal, latitude, longitude,
                        nb_containers, status, ref_refashion,
                        estimated_fill_rate
                   FROM cav
                  WHERE status <> 'deleted'`;
    const params = [];
    if (commune) { params.push(commune); query += ` AND commune = $${params.length}`; }
    if (status) { params.push(status); query += ` AND status = $${params.length}`; }
    query += ' ORDER BY commune, name';
    const r = await pool.query(query, params);
    res.json({ count: r.rows.length, cav: r.rows });
  } catch (err) {
    console.error('[PUBLIC-API] cav :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/public/stats/daily?date=YYYY-MM-DD — Agrégats d'un jour
router.get('/stats/daily', apiKeyAuth(['stats:read']), async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const toursRes = await pool.query(
      `SELECT COUNT(*)::int AS nb_tours,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS nb_completed,
              COUNT(*) FILTER (WHERE status = 'in_progress')::int AS nb_in_progress,
              COALESCE(SUM(total_weight_kg), 0)::float AS total_weight_kg,
              COALESCE(SUM(estimated_distance_km), 0)::float AS total_distance_km
         FROM tours WHERE date = $1`,
      [date]
    );
    const incRes = await pool.query(
      `SELECT COUNT(*)::int AS nb_incidents
         FROM incidents i JOIN tours t ON t.id = i.tour_id
        WHERE t.date = $1`,
      [date]
    );
    res.json({
      date,
      tours: toursRes.rows[0],
      incidents: incRes.rows[0],
    });
  } catch (err) {
    console.error('[PUBLIC-API] stats/daily :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/public/stats/monthly?month=YYYY-MM — Totaux mensuels
router.get('/stats/monthly', apiKeyAuth(['stats:read']), async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Paramètre month invalide (YYYY-MM)' });
    }
    const r = await pool.query(
      `SELECT COUNT(*)::int AS nb_tours,
              COALESCE(SUM(total_weight_kg), 0)::float AS total_weight_kg,
              COALESCE(SUM(estimated_distance_km), 0)::float AS total_distance_km,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS nb_completed
         FROM tours
        WHERE to_char(date, 'YYYY-MM') = $1`,
      [month]
    );
    res.json({ month, totals: r.rows[0] });
  } catch (err) {
    console.error('[PUBLIC-API] stats/monthly :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/public/refashion/dpav — Déclarations DPAV agrégées
router.get('/refashion/dpav', apiKeyAuth(['refashion:read']), async (req, res) => {
  try {
    const { year, trimester } = req.query;
    let query = `SELECT * FROM refashion_dpav WHERE 1=1`;
    const params = [];
    if (year) { params.push(year); query += ` AND year = $${params.length}`; }
    if (trimester) { params.push(trimester); query += ` AND trimester = $${params.length}`; }
    query += ' ORDER BY year DESC, trimester DESC';
    const r = await pool.query(query, params);
    res.json({ count: r.rows.length, dpav: r.rows });
  } catch (err) {
    // Table peut ne pas exister dans les très vieilles installations
    if (err.code === '42P01') return res.json({ count: 0, dpav: [] });
    console.error('[PUBLIC-API] refashion/dpav :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

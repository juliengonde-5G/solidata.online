const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { fetchOpenMeteoDaily, fetchOpenMeteoHourly } = require('../utils/weather');

router.use(authenticate);

// GET /api/boutique-meteo?boutique_id=X&date_from=&date_to=
router.get('/', async (req, res) => {
  try {
    const { boutique_id, date_from, date_to } = req.query;
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });
    let query = 'SELECT * FROM boutique_meteo_quotidien WHERE boutique_id = $1';
    const params = [boutique_id];
    if (date_from) { params.push(date_from); query += ` AND date >= $${params.length}`; }
    if (date_to) { params.push(date_to); query += ` AND date <= $${params.length}`; }
    query += ' ORDER BY date';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[boutique-meteo] GET /:', err);
    res.status(500).json({ error: 'Erreur' });
  }
});

// GET /api/boutique-meteo/correlation — corrélation pluie/CA
router.get('/correlation', async (req, res) => {
  try {
    const { boutique_id, date_from, date_to } = req.query;
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });
    const result = await pool.query(`
      SELECT m.date, m.weather_label, m.weather_code,
             COALESCE(m.temp_max, 0)::FLOAT AS temp_max,
             COALESCE(m.precipitation_mm, 0)::FLOAT AS precipitation_mm,
             COALESCE(SUM(v.total_ttc), 0)::FLOAT AS ca_ttc,
             COUNT(DISTINCT v.ticket_id)::INT AS nb_tickets
      FROM boutique_meteo_quotidien m
      LEFT JOIN boutique_ventes v ON v.boutique_id = m.boutique_id AND DATE(v.date_vente) = m.date
      WHERE m.boutique_id = $1
        AND ($2::DATE IS NULL OR m.date >= $2::DATE)
        AND ($3::DATE IS NULL OR m.date <= $3::DATE)
      GROUP BY m.date, m.weather_label, m.weather_code, m.temp_max, m.precipitation_mm
      ORDER BY m.date
    `, [boutique_id, date_from || null, date_to || null]);
    res.json(result.rows);
  } catch (err) {
    console.error('[boutique-meteo] correlation:', err);
    res.status(500).json({ error: 'Erreur' });
  }
});

// GET /api/boutique-meteo/hourly?boutique_id=X&date=YYYY-MM-DD
// Météo heure par heure (cache mémoire 1h dans utils/weather.js).
// Fallback gracieux : 200 + points=[] en cas d'erreur pour que le front reste fonctionnel.
router.get('/hourly', async (req, res) => {
  try {
    const { boutique_id } = req.query;
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const btq = await pool.query(
      'SELECT latitude, longitude FROM boutiques WHERE id = $1',
      [boutique_id]
    );
    if (btq.rows.length === 0) return res.status(404).json({ error: 'Boutique introuvable' });

    const { latitude, longitude } = btq.rows[0];
    if (latitude == null || longitude == null) {
      return res.json({
        boutique_id: Number(boutique_id), date,
        points: [], warning: 'coordonnées manquantes'
      });
    }

    const data = await fetchOpenMeteoHourly(latitude, longitude, date);
    if (!data) {
      return res.json({
        boutique_id: Number(boutique_id), date,
        points: [], warning: 'open-meteo indisponible'
      });
    }

    res.json({
      boutique_id: Number(boutique_id),
      date,
      lat: latitude,
      lng: longitude,
      points: data.points,
    });
  } catch (err) {
    console.error('[boutique-meteo] hourly:', err);
    res.status(500).json({ error: 'Erreur météo horaire', details: err.message });
  }
});

// POST /api/boutique-meteo/collect — trigger manuel (ADMIN)
router.post('/collect', authorize('ADMIN'), async (req, res) => {
  try {
    const { boutique_id, date } = req.body;
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const btq = await pool.query('SELECT latitude, longitude FROM boutiques WHERE id = $1', [boutique_id]);
    if (btq.rows.length === 0) return res.status(404).json({ error: 'Boutique introuvable' });

    const lat = btq.rows[0].latitude || 49.4431;
    const lng = btq.rows[0].longitude || 1.0993;

    const data = await fetchOpenMeteoDaily(lat, lng, targetDate);
    if (!data) return res.status(502).json({ error: 'Pas de donnée météo' });

    await pool.query(`
      INSERT INTO boutique_meteo_quotidien
        (boutique_id, date, weather_code, weather_label, temp_min, temp_max,
         precipitation_mm, wind_speed_max, sunshine_hours)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (boutique_id, date) DO UPDATE SET
        weather_code = EXCLUDED.weather_code, weather_label = EXCLUDED.weather_label,
        temp_min = EXCLUDED.temp_min, temp_max = EXCLUDED.temp_max,
        precipitation_mm = EXCLUDED.precipitation_mm,
        wind_speed_max = EXCLUDED.wind_speed_max, sunshine_hours = EXCLUDED.sunshine_hours
    `, [
      boutique_id, targetDate, data.code, data.label,
      data.tempMin, data.tempMax, data.precipMm, data.windMax, data.sunshineHours
    ]);

    res.json({ success: true, data });
  } catch (err) {
    console.error('[boutique-meteo] collect:', err);
    res.status(500).json({ error: 'Erreur collecte', details: err.message });
  }
});

module.exports = router;

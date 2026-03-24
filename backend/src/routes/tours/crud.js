const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { predictFillRate, getSeasonalFactors, setSeasonalFactors, getDayOfWeekFactors, setDayOfWeekFactors, getHolidays, setHolidays, getSchoolVacations, setSchoolVacations, getScoringConfig, setScoringConfig } = require('./predictions');
const { generateIntelligentTour } = require('./smart-tour');
const { CENTRE_TRI_LAT, CENTRE_TRI_LNG } = require('./context');

// GET /api/tours — Liste des tournées
router.get('/', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { date, status, vehicle_id } = req.query;
    let query = `
      SELECT t.*, v.registration, v.name as vehicle_name,
       CONCAT(e.first_name, ' ', e.last_name) as driver_name,
       sr.name as route_name,
       COALESCE(t.nb_cav, (SELECT COUNT(*)::int FROM tour_cav tc WHERE tc.tour_id = t.id)) as nb_cav,
       (SELECT COUNT(*)::int FROM tour_cav tc WHERE tc.tour_id = t.id AND tc.status = 'collected') as collected_count
      FROM tours t
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN employees e ON t.driver_employee_id = e.id
      LEFT JOIN standard_routes sr ON t.standard_route_id = sr.id
      WHERE 1=1
    `;
    const params = [];

    if (date) { params.push(date); query += ` AND t.date = $${params.length}`; }
    if (status) { params.push(status); query += ` AND t.status = $${params.length}`; }
    if (vehicle_id) { params.push(vehicle_id); query += ` AND t.vehicle_id = $${params.length}`; }

    query += ' ORDER BY t.date DESC, t.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[TOURS] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// ADMIN — Variables du moteur prédictif
// ══════════════════════════════════════════

// GET /api/tours/predictive-config — Lire les variables du moteur
router.get('/predictive-config', authorize('ADMIN'), async (req, res) => {
  try {
    res.json({
      seasonalFactors: getSeasonalFactors(),
      dayOfWeekFactors: getDayOfWeekFactors(),
      holidays: getHolidays(),
      schoolVacations: getSchoolVacations(),
      scoring: getScoringConfig(),
      centreTri: { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG },
    });
  } catch (err) {
    console.error('[TOURS] Erreur config prédictive :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/predictive-config — Mettre à jour les variables
router.put('/predictive-config', authorize('ADMIN'), async (req, res) => {
  try {
    const { seasonalFactors, dayOfWeekFactors, holidays, schoolVacations, scoring } = req.body;

    if (seasonalFactors && Array.isArray(seasonalFactors) && seasonalFactors.length === 12) {
      setSeasonalFactors(seasonalFactors.map(Number));
    }
    if (dayOfWeekFactors && Array.isArray(dayOfWeekFactors) && dayOfWeekFactors.length === 7) {
      setDayOfWeekFactors(dayOfWeekFactors.map(Number));
    }
    if (holidays && Array.isArray(holidays)) {
      setHolidays(holidays);
    }
    if (schoolVacations && Array.isArray(schoolVacations)) {
      setSchoolVacations(schoolVacations.filter(v => v.name && v.start && v.end));
    }
    if (scoring && typeof scoring === 'object') {
      setScoringConfig({ ...getScoringConfig(), ...scoring });
    }

    res.json({
      message: 'Configuration mise à jour',
      seasonalFactors: getSeasonalFactors(),
      dayOfWeekFactors: getDayOfWeekFactors(),
      holidays: getHolidays(),
      schoolVacations: getSchoolVacations(),
      scoring: getScoringConfig(),
    });
  } catch (err) {
    console.error('[TOURS] Erreur update config :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/:id — Détail avec CAV et pesées
router.get('/:id', async (req, res) => {
  try {
    const tour = await pool.query(`
      SELECT t.*, v.registration, v.name as vehicle_name, v.max_capacity_kg,
       e.first_name as driver_first_name, e.last_name as driver_last_name
      FROM tours t
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN employees e ON t.driver_employee_id = e.id
      WHERE t.id = $1
    `, [req.params.id]);

    if (tour.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });

    const cavs = await pool.query(
      `SELECT tc.*, c.name as cav_name, c.address, c.commune, c.latitude, c.longitude, c.nb_containers
       FROM tour_cav tc JOIN cav c ON tc.cav_id = c.id
       WHERE tc.tour_id = $1 ORDER BY tc.position`,
      [req.params.id]
    );

    const weights = await pool.query(
      'SELECT * FROM tour_weights WHERE tour_id = $1 ORDER BY recorded_at',
      [req.params.id]
    );

    const incidents = await pool.query(
      'SELECT * FROM incidents WHERE tour_id = $1 ORDER BY created_at',
      [req.params.id]
    );

    const checklist = await pool.query(
      'SELECT * FROM vehicle_checklists WHERE tour_id = $1',
      [req.params.id]
    );

    res.json({
      ...tour.rows[0],
      cavs: cavs.rows,
      weights: weights.rows,
      incidents: incidents.rows,
      checklist: checklist.rows[0] || null,
    });
  } catch (err) {
    console.error('[TOURS] Erreur détail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/intelligent — Générer une tournée intelligente
router.post('/intelligent', authorize('ADMIN', 'MANAGER'), [
  body('vehicle_id').isInt().withMessage('ID véhicule requis'),
  body('date').notEmpty().withMessage('Date requise'),
], validate, async (req, res) => {
  try {
    const { vehicle_id, date, driver_employee_id } = req.body;

    const vid = parseInt(vehicle_id, 10);
    const did = driver_employee_id ? parseInt(driver_employee_id, 10) : null;
    if (isNaN(vid)) return res.status(400).json({ error: 'vehicle_id invalide' });

    const result = await generateIntelligentTour(vid, date);

    // Créer la tournée en BDD (avec distance, durée, nb_cav)
    const tourResult = await pool.query(
      `INSERT INTO tours (date, vehicle_id, driver_employee_id, mode, status, ai_explanation, estimated_distance_km, estimated_duration_min, nb_cav)
       VALUES ($1, $2, $3, 'intelligent', 'planned', $4, $5, $6, $7) RETURNING *`,
      [date, vid, did, result.explanation,
       result.stats.totalDistance, result.stats.estimatedDuration, result.stats.totalCavs]
    );
    const tourId = tourResult.rows[0].id;

    // Insérer les CAV (avec prédiction pour apprentissage continu)
    for (const cav of result.cavList) {
      await pool.query(
        `INSERT INTO tour_cav (tour_id, cav_id, position, predicted_fill_rate) VALUES ($1, $2, $3, $4)`,
        [tourId, cav.cav_id, cav.position, cav.predicted_fill ?? null]
      );
    }

    res.status(201).json({
      tour: tourResult.rows[0],
      cavs: result.cavList,
      ...result,
    });
  } catch (err) {
    console.error('[TOURS] Erreur tournée intelligente :', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

// POST /api/tours/standard — Créer une tournée standard (route prédéfinie)
router.post('/standard', authorize('ADMIN', 'MANAGER'), [
  body('vehicle_id').isInt().withMessage('ID véhicule requis'),
  body('date').notEmpty().withMessage('Date requise'),
  body('standard_route_id').isInt().withMessage('ID route standard requis'),
], validate, async (req, res) => {
  try {
    const { vehicle_id, date, driver_employee_id, standard_route_id } = req.body;

    const vid = parseInt(vehicle_id, 10);
    const did = driver_employee_id ? parseInt(driver_employee_id, 10) : null;
    const srid = parseInt(standard_route_id, 10);

    const tourResult = await pool.query(
      `INSERT INTO tours (date, vehicle_id, driver_employee_id, standard_route_id, mode, status)
       VALUES ($1, $2, $3, $4, 'standard', 'planned') RETURNING *`,
      [date, vid, did, srid]
    );
    const tourId = tourResult.rows[0].id;

    // Copier les CAV de la route standard
    const routeCavs = await pool.query(
      'SELECT * FROM standard_route_cav WHERE route_id = $1 ORDER BY position',
      [standard_route_id]
    );
    for (const rc of routeCavs.rows) {
      await pool.query(
        'INSERT INTO tour_cav (tour_id, cav_id, position) VALUES ($1, $2, $3)',
        [tourId, rc.cav_id, rc.position]
      );
    }

    res.status(201).json(tourResult.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur tournée standard :', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

// POST /api/tours/manual — Créer une tournée manuelle
router.post('/manual', authorize('ADMIN', 'MANAGER'), [
  body('vehicle_id').isInt().withMessage('ID véhicule requis'),
  body('date').notEmpty().withMessage('Date requise'),
  body('cav_ids').isArray({ min: 1 }).withMessage('Liste de CAV requise'),
], validate, async (req, res) => {
  try {
    const { vehicle_id, date, driver_employee_id, cav_ids } = req.body;

    const vid = parseInt(vehicle_id, 10);
    const did = driver_employee_id ? parseInt(driver_employee_id, 10) : null;

    const tourResult = await pool.query(
      `INSERT INTO tours (date, vehicle_id, driver_employee_id, mode, status)
       VALUES ($1, $2, $3, 'manual', 'planned') RETURNING *`,
      [date, vid, did]
    );
    const tourId = tourResult.rows[0].id;

    for (let i = 0; i < cav_ids.length; i++) {
      await pool.query(
        'INSERT INTO tour_cav (tour_id, cav_id, position) VALUES ($1, $2, $3)',
        [tourId, cav_ids[i], i + 1]
      );
    }

    res.status(201).json(tourResult.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur tournée manuelle :', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

// GET /api/tours/predict/:cavId — Prédiction de remplissage pour un CAV
router.get('/predict/:cavId', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const prediction = await predictFillRate(req.params.cavId, req.query.date);
    res.json(prediction);
  } catch (err) {
    console.error('[TOURS] Erreur prédiction :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// ROUTES STANDARD
// ══════════════════════════════════════════

// GET /api/tours/routes — Routes standard
router.get('/routes/list', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sr.*, COUNT(src.id) as cav_count
      FROM standard_routes sr
      LEFT JOIN standard_route_cav src ON src.route_id = sr.id
      GROUP BY sr.id ORDER BY sr.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[TOURS] Erreur routes standard :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/routes — Créer route standard
router.post('/routes', authorize('ADMIN', 'MANAGER'), [
  body('name').notEmpty().withMessage('Nom requis'),
], validate, async (req, res) => {
  try {
    const { name, description, cav_ids } = req.body;

    const result = await pool.query(
      'INSERT INTO standard_routes (name, description) VALUES ($1, $2) RETURNING *',
      [name, description]
    );
    const routeId = result.rows[0].id;

    if (cav_ids?.length) {
      for (let i = 0; i < cav_ids.length; i++) {
        await pool.query(
          'INSERT INTO standard_route_cav (route_id, cav_id, position) VALUES ($1, $2, $3)',
          [routeId, cav_ids[i], i + 1]
        );
      }
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur création route :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

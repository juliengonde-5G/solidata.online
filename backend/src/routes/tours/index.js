const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../../middleware/auth');

// Upload photos incidents
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'incidents');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `incident_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage: photoStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// Sub-routers
const crudRouter = require('./crud');
const proposalsRouter = require('./proposals');
const createExecutionRouter = require('./execution');
const eventsRouter = require('./events');
const eventsAutoRouter = require('./events-auto');
const statsRouter = require('./stats');

// ── Endpoints publics (mobile sans auth) ──────────────────────────────

const pool = require('../../config/database');

// GET /api/tours/vehicle/:vehicleId/today — Tournée du jour pour un véhicule (public)
router.get('/vehicle/:vehicleId/today', async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const tourResult = await pool.query(
      `SELECT t.*, v.registration, v.name as vehicle_name,
              (SELECT COUNT(*) FROM tour_cav tc WHERE tc.tour_id = t.id) as nb_cav
       FROM tours t
       JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.vehicle_id = $1
         AND t.date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date
         AND t.status IN ('planned', 'in_progress')
       ORDER BY t.id DESC LIMIT 1`,
      [vehicleId]
    );
    if (tourResult.rows.length === 0) {
      return res.json({ tour: null });
    }
    const tour = tourResult.rows[0];
    // Charger les CAV de la tournée
    const cavsResult = await pool.query(
      `SELECT tc.*, c.name as cav_name, c.address, c.commune, c.latitude, c.longitude,
              c.nb_containers, c.qr_code_data
       FROM tour_cav tc
       JOIN cav c ON c.id = tc.cav_id
       WHERE tc.tour_id = $1
       ORDER BY tc.position`,
      [tour.id]
    );
    res.json({ tour, cavs: cavsResult.rows });
  } catch (err) {
    console.error('[TOURS] Erreur vehicle/today:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/:id/public — Détail d'une tournée (public, pour mobile sans auth)
router.get('/:id/public', async (req, res) => {
  try {
    const tourResult = await pool.query(
      `SELECT t.*, v.registration, v.name as vehicle_name
       FROM tours t JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (tourResult.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });
    const tour = tourResult.rows[0];
    const cavsResult = await pool.query(
      `SELECT tc.*, c.name as cav_name, c.address, c.commune, c.latitude, c.longitude,
              c.nb_containers, c.qr_code_data
       FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
       WHERE tc.tour_id = $1 ORDER BY tc.position`,
      [tour.id]
    );
    res.json({ ...tour, cavs: cavsResult.rows });
  } catch (err) {
    console.error('[TOURS] Erreur public/:id:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/checklist-public — Sauvegarder checklist (mobile sans auth)
router.post('/:id/checklist-public', async (req, res) => {
  try {
    const { vehicle_id, exterior_ok, fuel_level, km_start } = req.body;
    await pool.query(
      `INSERT INTO vehicle_checklists (tour_id, vehicle_id, exterior_ok, fuel_level, km_start)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [req.params.id, vehicle_id, exterior_ok, fuel_level || '1/2', km_start || 0]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[TOURS] Erreur checklist-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/:id/start-public — Démarrer une tournée (mobile sans auth)
router.put('/:id/start-public', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE tours SET status = 'in_progress', started_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'planned' RETURNING id, status`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      // Peut-être déjà in_progress
      const existing = await pool.query('SELECT id, status FROM tours WHERE id = $1', [req.params.id]);
      return res.json(existing.rows[0] || { error: 'Tournée non trouvée' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur start-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// All routes below require authentication
router.use(authenticate);

// Mount execution routes (needs upload for incidents)
const executionRouter = createExecutionRouter(upload);
router.use('/', executionRouter);

// Mount events routes
router.use('/', eventsRouter);

// Mount auto-discovery events routes
router.use('/', eventsAutoRouter);

// Mount stats/reporting routes
router.use('/', statsRouter);

// Mount proposals routes
router.use('/', proposalsRouter);

// Mount CRUD routes (must be after more specific routes to avoid /:id catching everything)
router.use('/', crudRouter);

module.exports = router;

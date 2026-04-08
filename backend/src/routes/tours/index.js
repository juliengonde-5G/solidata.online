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
    // Charger les points de la tournée selon le type de collecte
    let points = [];
    if (tour.collection_type === 'association') {
      const assoResult = await pool.query(
        `SELECT tap.id, tap.tour_id, tap.association_point_id as cav_id, tap.position, tap.status,
                tap.fill_level, tap.collected_at, tap.notes,
                ap.name as cav_name, ap.address, ap.ville as commune, ap.latitude, ap.longitude,
                ap.contact_phone, NULL as nb_containers, NULL as qr_code_data
         FROM tour_association_point tap
         JOIN association_points ap ON ap.id = tap.association_point_id
         WHERE tap.tour_id = $1 ORDER BY tap.position`,
        [tour.id]
      );
      points = assoResult.rows;
    } else {
      const cavsResult = await pool.query(
        `SELECT tc.*, c.name as cav_name, c.address, c.commune, c.latitude, c.longitude,
                c.nb_containers, c.qr_code_data
         FROM tour_cav tc
         JOIN cav c ON c.id = tc.cav_id
         WHERE tc.tour_id = $1
         ORDER BY tc.position`,
        [tour.id]
      );
      points = cavsResult.rows;
    }
    res.json({ tour, cavs: points });
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

    let points = [];
    if (tour.collection_type === 'association') {
      // Charger les points association
      const assoResult = await pool.query(
        `SELECT tap.id, tap.tour_id, tap.association_point_id as cav_id, tap.position, tap.status,
                tap.fill_level, tap.collected_at, tap.notes,
                ap.name as cav_name, ap.address, ap.ville as commune, ap.latitude, ap.longitude,
                ap.contact_phone, NULL as nb_containers, NULL as qr_code_data
         FROM tour_association_point tap
         JOIN association_points ap ON ap.id = tap.association_point_id
         WHERE tap.tour_id = $1 ORDER BY tap.position`,
        [tour.id]
      );
      points = assoResult.rows;
    } else {
      const cavsResult = await pool.query(
        `SELECT tc.*, c.name as cav_name, c.address, c.commune, c.latitude, c.longitude,
                c.nb_containers, c.qr_code_data
         FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
         WHERE tc.tour_id = $1 ORDER BY tc.position`,
        [tour.id]
      );
      points = cavsResult.rows;
    }
    res.json({ ...tour, cavs: points });
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

// PUT /api/tours/:id/cav/:cavId/collect-public — Marquer un point comme collecté (mobile sans auth)
router.put('/:id/cav/:cavId/collect-public', async (req, res) => {
  try {
    const { fill_level, qr_scanned, qr_unavailable, qr_unavailable_reason, notes } = req.body;

    // Vérifier si c'est une tournée association
    const tourCheck = await pool.query('SELECT collection_type FROM tours WHERE id = $1', [req.params.id]);
    const collectionType = tourCheck.rows[0]?.collection_type || 'pav';

    if (collectionType === 'association') {
      // Mettre à jour dans tour_association_point
      const result = await pool.query(
        `UPDATE tour_association_point SET status = 'collected',
         fill_level = $1,
         notes = $2,
         collected_at = NOW()
         WHERE tour_id = $3 AND association_point_id = $4 RETURNING *`,
        [fill_level, notes || null, req.params.id, req.params.cavId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Point association non trouvé dans la tournée' });
      res.json(result.rows[0]);
    } else {
      const result = await pool.query(
        `UPDATE tour_cav SET status = 'collected',
         fill_level = $1,
         qr_scanned = $2,
         qr_unavailable = $3,
         qr_unavailable_reason = $4,
         notes = $5,
         collected_at = NOW()
         WHERE tour_id = $6 AND cav_id = $7 RETURNING *`,
        [fill_level, qr_scanned || false, qr_unavailable || false, qr_unavailable_reason || null, notes || null, req.params.id, req.params.cavId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'CAV de tournée non trouvé' });
      res.json(result.rows[0]);
    }
  } catch (err) {
    console.error('[TOURS] Erreur collect-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/scan-public — Enregistrer un scan QR (mobile sans auth)
router.post('/:id/scan-public', async (req, res) => {
  try {
    const { cav_id, scanned_at } = req.body;
    await pool.query(
      `INSERT INTO cav_qr_scans (cav_id, tour_id, scanned_at)
       VALUES ($1, $2, $3)`,
      [cav_id, req.params.id, scanned_at || new Date()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[TOURS] Erreur scan-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/weigh-public — Enregistrer une pesée (mobile sans auth)
router.post('/:id/weigh-public', async (req, res) => {
  try {
    const { weight_kg } = req.body;
    if (!weight_kg && weight_kg !== 0) {
      return res.status(400).json({ error: 'Poids requis (weight_kg)' });
    }
    const result = await pool.query(
      `INSERT INTO tour_weights (tour_id, weight_kg, recorded_at)
       VALUES ($1, $2, NOW()) RETURNING *`,
      [req.params.id, weight_kg]
    );
    // Mettre à jour le total de la tournée
    await pool.query(
      `UPDATE tours SET total_weight_kg = (SELECT COALESCE(SUM(weight_kg), 0) FROM tour_weights WHERE tour_id = $1) WHERE id = $1`,
      [req.params.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur weigh-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/incident-public — Signaler un incident (mobile sans auth, sans photo)
router.post('/:id/incident-public', async (req, res) => {
  try {
    const { type, description, cav_id, vehicle_id } = req.body;
    if (!type || !description) {
      return res.status(400).json({ error: 'Type et description requis' });
    }
    const result = await pool.query(
      `INSERT INTO incidents (tour_id, type, description, cav_id, vehicle_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [req.params.id, type, description, cav_id || null, vehicle_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur incident-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/:id/status-public — Changer le statut d'une tournée (mobile sans auth)
router.put('/:id/status-public', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Statut requis' });
    }
    // Vérifier les transitions autorisées
    const allowedTransitions = {
      'planned': ['in_progress'],
      'in_progress': ['returning', 'completed'],
      'returning': ['completed']
    };
    const current = await pool.query('SELECT status FROM tours WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Tournée non trouvée' });
    }
    const currentStatus = current.rows[0].status;
    const allowed = allowedTransitions[currentStatus];
    if (!allowed || !allowed.includes(status)) {
      return res.status(400).json({ error: `Transition ${currentStatus} → ${status} non autorisée` });
    }

    const updates = ['status = $1', 'updated_at = NOW()'];
    const params = [status];
    if (status === 'in_progress') updates.push('started_at = NOW()');
    if (status === 'completed') updates.push('completed_at = NOW()');

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE tours SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur status-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/:id/summary-public — Résumé d'une tournée (mobile sans auth)
router.get('/:id/summary-public', async (req, res) => {
  try {
    const tourResult = await pool.query(
      `SELECT t.*, v.registration, v.name as vehicle_name
       FROM tours t
       JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (tourResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournée non trouvée' });
    }
    const tour = tourResult.rows[0];

    // Adapter les stats selon le type de collecte
    let statsResult;
    if (tour.collection_type === 'association') {
      statsResult = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM tour_association_point WHERE tour_id = $1 AND status = 'collected') as cavs_collected,
           (SELECT COUNT(*)::int FROM tour_association_point WHERE tour_id = $1) as cavs_total,
           (SELECT COALESCE(SUM(weight_kg), 0) FROM tour_weights WHERE tour_id = $1) as total_weight_kg,
           (SELECT COUNT(*)::int FROM incidents WHERE tour_id = $1) as incidents_count`,
        [req.params.id]
      );
    } else {
      statsResult = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM tour_cav WHERE tour_id = $1 AND status = 'collected') as cavs_collected,
           (SELECT COUNT(*)::int FROM tour_cav WHERE tour_id = $1) as cavs_total,
           (SELECT COALESCE(SUM(weight_kg), 0) FROM tour_weights WHERE tour_id = $1) as total_weight_kg,
           (SELECT COUNT(*)::int FROM incidents WHERE tour_id = $1) as incidents_count`,
        [req.params.id]
      );
    }
    const stats = statsResult.rows[0];

    // Calculer la durée en minutes
    let duration_minutes = null;
    if (tour.started_at && tour.completed_at) {
      duration_minutes = Math.round((new Date(tour.completed_at) - new Date(tour.started_at)) / 60000);
    } else if (tour.started_at) {
      duration_minutes = Math.round((new Date() - new Date(tour.started_at)) / 60000);
    }

    res.json({
      tour,
      stats: {
        cavs_collected: stats.cavs_collected,
        cavs_total: stats.cavs_total,
        total_weight_kg: parseFloat(stats.total_weight_kg),
        incidents_count: stats.incidents_count,
        duration_minutes,
        distance_km: tour.estimated_distance_km || null
      }
    });
  } catch (err) {
    console.error('[TOURS] Erreur summary-public:', err);
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

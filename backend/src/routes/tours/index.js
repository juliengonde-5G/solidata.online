const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate, authorize } = require('../../middleware/auth');
const { imageFilter } = require('../../utils/upload-filters');

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
// T1.1 : whitelist image — bloque l'upload de fichiers exécutables / SVG+JS
// qui pourraient être réfléchis via /uploads/incidents.
const upload = multer({ storage: photoStorage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: imageFilter });

// Upload photos de collecte (audit aléatoire — une par tournée, FillLevel.jsx)
const collectePhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'collectes');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `collecte_${Date.now()}${ext}`);
  },
});
const uploadCollectePhoto = multer({ storage: collectePhotoStorage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: imageFilter });

// Sub-routers
const crudRouter = require('./crud');
const proposalsRouter = require('./proposals');
const createExecutionRouter = require('./execution');
const eventsRouter = require('./events');
const eventsAutoRouter = require('./events-auto');
const statsRouter = require('./stats');
const liveSummaryRouter = require('./live-summary');
const activeSummaryRouter = require('./active-summary');
const reoptimizeRouter = require('./reoptimize');
const planningRouter = require('./planning');
const dashboardRouter = require('./dashboard');
const { ensurePlannedPassages } = require('./planned-passage');
// Session chauffeur « 1 URL = 1 véhicule » : le véhicule est lu dans le claim
// `vehicle_id` du jeton et, en repli, dans le `username` historique
// « driver_<vehicleId> ». Helper partagé avec routes/tours/execution.js.
const { driverVehicleIdFromToken } = require('./driver-session');
const {
  proposeReoptimization,
  applyReoptimization,
  rejectReoptimization,
} = require('./reoptimize-service');
const { sendPushToRoles } = require('../../services/push-notifications');

// ── Endpoints publics (mobile sans auth) ──────────────────────────────

const pool = require('../../config/database');

// ── Auth chauffeur sur les routes mobile historiquement « publiques » ──────
// Audit 07/2026 : le détail de tournée et les actions de collecte (démarrer,
// collecter, peser, incident, statut, scan, ré-optim) étaient exposés SANS
// authentification, avec un :id de tournée/véhicule énumérable — n'importe qui
// sur Internet pouvait lire les tournées (adresses CAV, GPS) ou falsifier
// anonymement tonnage/pesées/incidents. Elles exigent désormais le JWT
// chauffeur émis par POST /auth/driver-start ; le mobile le joint et se
// ré-authentifie de façon transparente (mobile/src/services/authedFetch.js).
// Les URLs « -public »/« /public »/« /today » sont conservées à l'identique
// pour éviter une migration d'URL coordonnée — seule l'exigence d'auth change.
const MOBILE_DRIVER_PATH = /(-public(\/|$))|(^\/[^/]+\/public$)|(^\/vehicle\/[^/]+\/today$)/;

// ── Vague 3 — Contre-vérification JWT ↔ véhicule (durcissement) ─────────────
// Résiduel vague 2 (point 4) : le JWT chauffeur était exigé, mais AUCUN contrôle
// ne liait la requête au véhicule du token — un chauffeur (ou un raccourci
// détourné) portant le token du véhicule A pouvait agir sur les tournées/pesées/
// incidents/consignes du véhicule B (id de tournée/véhicule énumérable).
// Le JWT de POST /auth/driver-start encode le véhicule dans son `username` :
// « driver_<vehicleId> » (tous les chauffeurs partagent un user générique — seul
// l'username distingue le véhicule). On en dérive le véhicule autorisé et on
// refuse (403) toute cible d'un autre véhicule. Le flux légitime (le chauffeur
// agit TOUJOURS sur son véhicule) est inchangé.

// Refuse (403) si le token chauffeur cible un véhicule différent du sien.
//   - tokenVehId null → token NON chauffeur (ADMIN/MANAGER en supervision, ou
//     tout autre compte authentifié) : comportement historique inchangé, aucune
//     restriction ajoutée (zéro régression pour les appelants non-mobile).
//   - vehId null → cible inconnue (tournée/message introuvable) : on laisse le
//     handler répondre 404 ; aucune donnée d'un autre véhicule n'est exposée.
function driverVehicleMismatch(req, res, vehId) {
  const tokenVehId = driverVehicleIdFromToken(req.user);
  if (tokenVehId == null) return false;
  if (vehId == null) return false;
  if (Number(vehId) !== tokenVehId) {
    res.status(403).json({ error: 'Ce véhicule ne correspond pas à votre session chauffeur' });
    return true;
  }
  return false;
}

// Garde de périmètre véhicule appliquée aux routes mobiles « -public » après
// authentification. read-public / history-public sont bornées dans leur handler
// (elles chargent déjà leur entité → pas de requête supplémentaire ici).
async function enforceDriverVehicleScope(req, res, next) {
  try {
    const tokenVehId = driverVehicleIdFromToken(req.user);
    if (tokenVehId == null) return next(); // non-chauffeur : comportement inchangé

    const p = req.path;

    // Enforcées dans le handler (réutilisation de la requête existante).
    if (/\/history-public$/.test(p) || /^\/messages\/\d+\/read-public$/.test(p)) {
      return next();
    }

    // Flush GPS hors-ligne : chaque position doit porter le véhicule du chauffeur.
    if (/^\/gps-batch-public(\/|$)/.test(p)) {
      const positions = Array.isArray(req.body && req.body.positions) ? req.body.positions : [];
      const foreign = positions.some((pos) =>
        pos && pos.vehicle_id != null && parseInt(pos.vehicle_id, 10) !== tokenVehId);
      if (foreign) {
        return res.status(403).json({ error: 'Position GPS d\'un autre véhicule refusée' });
      }
      return next();
    }

    // Routes ciblant un véhicule par paramètre (/vehicle/:id/...) : compare sans requête.
    let m;
    if ((m = /^\/vehicle\/(\d+)(\/|$)/.exec(p))) {
      if (parseInt(m[1], 10) !== tokenVehId) {
        return res.status(403).json({ error: 'Ce véhicule ne correspond pas à votre session chauffeur' });
      }
      return next();
    }

    // Toutes les autres routes mobiles ciblent une tournée via /:tourId/... :
    // le véhicule de la tournée doit être celui du chauffeur.
    if ((m = /^\/(\d+)(\/|$)/.exec(p))) {
      const r = await pool.query('SELECT vehicle_id FROM tours WHERE id = $1', [parseInt(m[1], 10)]);
      const vehId = r.rows.length ? r.rows[0].vehicle_id : null;
      if (vehId != null && Number(vehId) !== tokenVehId) {
        return res.status(403).json({ error: 'Cette tournée ne correspond pas à votre véhicule' });
      }
      return next();
    }

    return next();
  } catch (err) {
    console.error('[TOURS] garde véhicule mobile:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

router.use((req, res, next) => {
  if (!MOBILE_DRIVER_PATH.test(req.path)) return next();
  // 1. JWT chauffeur exigé, puis 2. le véhicule ciblé doit être celui du token.
  authenticate(req, res, (err) => {
    if (err) return next(err);
    enforceDriverVehicleScope(req, res, next);
  });
});

// GET /api/tours/vehicle/:vehicleId/today — Tournée du jour (JWT chauffeur requis)
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
                tap.fill_level, tap.collected_at, tap.planned_passage_time, tap.notes,
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
                tap.fill_level, tap.collected_at, tap.planned_passage_time, tap.notes,
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
    // Vague 1 (item 45) : `notes` (remarques/anomalies saisies par le chauffeur
    // dans Checklist.jsx) était ignoré → l'anomalie disparaissait silencieusement.
    // Désormais persisté et consultable côté web (fiche véhicule).
    const { vehicle_id, employee_id, exterior_ok, fuel_level, km_start, notes } = req.body;
    await pool.query(
      `INSERT INTO vehicle_checklists (tour_id, vehicle_id, employee_id, exterior_ok, fuel_level, km_start, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [req.params.id, vehicle_id, employee_id || null, exterior_ok, fuel_level || '1/2', km_start || 0,
       (notes && String(notes).trim()) ? String(notes).trim() : null]
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
    // Calculer les horaires prévisionnels en tâche de fond (non bloquant)
    ensurePlannedPassages(req.params.id).catch(err =>
      console.warn('[TOURS] planned-passage (start-public) échec :', err.message));
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur start-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/:id/cav/:cavId/collect-public — Marquer un point (mobile sans auth)
// Vague 1 (item 46a) : gère la collecte ET le « saut » d'un CAV (status='skipped'
// + skip_reason) — le chauffeur peut déclarer un point impossible à collecter
// (inaccessible, bouché, vide…) sans forcer une saisie de niveau. skip_reason
// est aligné sur le CHECK de tour_cav et sur la route web execution.js.
const VALID_SKIP_REASON = ['cav_fermee', 'bouchee', 'acces_impossible', 'proprietaire_absent', 'vide', 'autre'];
// multer laisse passer les requêtes JSON non-multipart (hors ligne, sans
// photo) — même pattern que incident-public.
router.put('/:id/cav/:cavId/collect-public', uploadCollectePhoto.single('photo'), async (req, res) => {
  try {
    const { fill_level, qr_scanned, qr_unavailable, qr_unavailable_reason, notes } = req.body;
    const status = req.body.status === 'skipped' ? 'skipped' : 'collected';
    const skip_reason = req.body.skip_reason || null;
    // multipart : les champs arrivent en string ('true'/'false').
    const remballe = req.body.remballe === true || req.body.remballe === 'true';
    // Photo d'audit (item « photo aléatoire par tournée ») : présente seulement
    // si ce point est le point tiré au sort pour cette tournée (choisi côté
    // mobile, cf. services/auditPhoto.js). COALESCE : un re-submit sans photo
    // (ex. correction du niveau) ne doit jamais effacer une photo déjà reçue.
    const photo_path = req.file ? `/uploads/collectes/${req.file.filename}` : null;

    if (status === 'skipped' && skip_reason && !VALID_SKIP_REASON.includes(skip_reason)) {
      return res.status(400).json({ error: 'skip_reason invalide', allowed: VALID_SKIP_REASON });
    }

    // Vérifier si c'est une tournée association
    const tourCheck = await pool.query('SELECT collection_type FROM tours WHERE id = $1', [req.params.id]);
    const collectionType = tourCheck.rows[0]?.collection_type || 'pav';

    if (collectionType === 'association') {
      // tour_association_point n'a pas de colonne skip_reason : le motif de saut
      // est conservé dans notes. collected_at reste null si le point est sauté.
      const result = await pool.query(
        `UPDATE tour_association_point SET status = $1,
         fill_level = $2,
         notes = $3,
         remballe = $4,
         photo_path = COALESCE($5, photo_path),
         collected_at = CASE WHEN $1 = 'collected' THEN NOW() ELSE collected_at END
         WHERE tour_id = $6 AND association_point_id = $7 RETURNING *`,
        [status,
         status === 'skipped' ? null : fill_level,
         status === 'skipped' ? (notes || (skip_reason ? `Non collecté : ${skip_reason}` : 'Non collecté')) : (notes || null),
         remballe, photo_path,
         req.params.id, req.params.cavId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Point association non trouvé dans la tournée' });
      res.json(result.rows[0]);
    } else {
      const result = await pool.query(
        `UPDATE tour_cav SET status = $1,
         fill_level = CASE WHEN $1 = 'skipped' THEN NULL ELSE $2 END,
         qr_scanned = $3,
         qr_unavailable = $4,
         qr_unavailable_reason = $5,
         skip_reason = CASE WHEN $1 = 'skipped' THEN $6 ELSE NULL END,
         notes = $7,
         remballe = $8,
         photo_path = COALESCE($9, photo_path),
         collected_at = CASE WHEN $1 = 'collected' THEN NOW() ELSE collected_at END
         WHERE tour_id = $10 AND cav_id = $11 RETURNING *`,
        [status, fill_level, qr_scanned || false, qr_unavailable || false, qr_unavailable_reason || null,
         skip_reason, notes || null, remballe, photo_path, req.params.id, req.params.cavId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'CAV de tournée non trouvé' });
      res.json(result.rows[0]);
    }
  } catch (err) {
    console.error('[TOURS] Erreur collect-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/scan-public — Enregistrer un scan QR (JWT chauffeur requis)
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

// POST /api/tours/gps-batch-public — Flush des positions GPS bufferisées hors-ligne.
// Le suivi temps réel passe par Socket.IO (gps-update) quand le réseau est là ;
// hors zone de couverture, le mobile bufferise localement (IndexedDB) et rejoue
// ici par lots à la reconnexion. Auth : JWT chauffeur (route « -public », voir
// le middleware MOBILE_DRIVER_PATH en tête de ce routeur).
router.post('/gps-batch-public', async (req, res) => {
  const positions = Array.isArray(req.body?.positions) ? req.body.positions : [];
  if (positions.length === 0) return res.json({ inserted: 0 });
  if (positions.length > 500) {
    return res.status(400).json({ error: 'Lot trop volumineux (max 500 positions)' });
  }
  // On ne garde que les positions complètes (tour_id + vehicle_id NOT NULL en
  // base) ; une position incomplète est ignorée sans faire échouer tout le lot.
  const valid = positions.filter((p) =>
    p && p.tour_id != null && p.vehicle_id != null &&
    p.latitude != null && p.longitude != null);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of valid) {
      await client.query(
        `INSERT INTO gps_positions (tour_id, vehicle_id, latitude, longitude, speed, recorded_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))`,
        [p.tour_id, p.vehicle_id, p.latitude, p.longitude, p.speed ?? null, p.recorded_at || null]
      );
    }
    await client.query('COMMIT');
    res.json({ inserted: valid.length, skipped: positions.length - valid.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[TOURS] Erreur gps-batch-public:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// POST /api/tours/:id/weigh-public — Enregistrer une pesée (mobile sans auth)
router.post('/:id/weigh-public', async (req, res) => {
  try {
    const { weight_kg, tare_kg, is_intermediate, notes } = req.body;
    if (weight_kg === undefined || weight_kg === null) {
      return res.status(400).json({ error: 'Poids requis (weight_kg)' });
    }
    // Fix bug C5 : persistance de tare_kg, is_intermediate et notes
    // (champs envoyés par mobile/WeighIn.jsx mais ignorés auparavant).
    const result = await pool.query(
      `INSERT INTO tour_weights (tour_id, weight_kg, tare_kg, is_intermediate, notes, recorded_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [
        req.params.id,
        weight_kg,
        tare_kg ?? null,
        is_intermediate === true || is_intermediate === 'true',
        notes ?? null,
      ]
    );
    // Mettre à jour le total de la tournée (somme des pesées non intermédiaires)
    await pool.query(
      `UPDATE tours SET total_weight_kg = (
         SELECT COALESCE(SUM(weight_kg), 0) FROM tour_weights
         WHERE tour_id = $1 AND COALESCE(is_intermediate, FALSE) = FALSE
       ) WHERE id = $1`,
      [req.params.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur weigh-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/incident-public — Signaler un incident (mobile, JWT chauffeur)
// Vague 1 (item 46b) : accepte une photo en multipart quand l'appareil est en
// ligne (upload.single('photo')). Hors ligne, le mobile poste du JSON via la
// file de sync (sans photo) — multer laisse passer les requêtes non-multipart.
// Vague 1 (item 44) : types mobiles hors du CHECK SQL (cav_overflow, security)
// normalisés vers un type valide, le libellé d'origine préservé en description
// (avant : violation de contrainte → 500 en boucle dans la file de sync).
const INCIDENT_TYPE_MAP = { cav_overflow: 'environment', security: 'other' };
const INCIDENT_TYPE_ORIG_LABELS = { cav_overflow: 'Débordement', security: 'Sécurité' };
const VALID_INCIDENT_TYPES = ['cav_problem', 'environment', 'vehicle_breakdown', 'accident', 'other'];
router.post('/:id/incident-public', upload.single('photo'), async (req, res) => {
  try {
    const { type, description, cav_id, vehicle_id, current_lat, current_lng } = req.body;
    if (!type) {
      return res.status(400).json({ error: 'Type d\'incident requis' });
    }
    const dbType = INCIDENT_TYPE_MAP[type] || type;
    if (!VALID_INCIDENT_TYPES.includes(dbType)) {
      return res.status(400).json({ error: 'Type d\'incident invalide', allowed: VALID_INCIDENT_TYPES });
    }
    // Conserve le libellé mobile d'origine dans la description si le type a été
    // remappé (ex. « Débordement » → environment).
    let finalDescription = description || null;
    if (INCIDENT_TYPE_MAP[type]) {
      const lbl = INCIDENT_TYPE_ORIG_LABELS[type] || type;
      finalDescription = finalDescription ? `[${lbl}] ${finalDescription}` : lbl;
    }
    const photo_path = req.file ? `/uploads/incidents/${req.file.filename}` : null;

    const result = await pool.query(
      `INSERT INTO incidents (tour_id, type, description, cav_id, vehicle_id, photo_path, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
      [req.params.id, dbType, finalDescription, cav_id || null, vehicle_id || null, photo_path]
    );

    // Si l'incident bloque un CAV, déclenche une proposition de ré-optim
    // en arrière-plan (non bloquant) — ordonne les CAV restants depuis la
    // position GPS actuelle si fournie.
    if (dbType === 'cav_problem' || dbType === 'environment') {
      const io = req.app.get('io');
      proposeReoptimization({
        tourId: parseInt(req.params.id, 10),
        triggerReason: 'incident',
        triggeredBy: 'auto',
        currentLat: typeof current_lat === 'number' ? current_lat : parseFloat(current_lat) || null,
        currentLng: typeof current_lng === 'number' ? current_lng : parseFloat(current_lng) || null,
        io,
      }).catch(err => console.warn('[TOURS] auto-reoptim (incident) échec :', err.message));
    }

    // Push aux managers : nouvel incident sur tournée en cours. Le lien pointe
    // vers la page Incidents (cycle de vie / clôture), pas seulement la carte.
    sendPushToRoles(['ADMIN', 'MANAGER'], {
      title: 'Incident signalé',
      body: `Tournée #${req.params.id} — ${dbType}${finalDescription ? ` : ${finalDescription.slice(0, 80)}` : ''}`,
      tag: `incident-${req.params.id}`,
      data: { url: `/incidents?tourId=${parseInt(req.params.id, 10)}`, tourId: parseInt(req.params.id, 10) },
    }).catch(() => {});

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur incident-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/reoptimize-public — Proposer une ré-optim (mobile sans auth)
router.post('/:id/reoptimize-public', async (req, res) => {
  try {
    const io = req.app.get('io');
    const result = await proposeReoptimization({
      tourId: parseInt(req.params.id, 10),
      triggerReason: req.body?.reason || 'manual',
      triggeredBy: 'driver',
      currentLat: req.body?.current_lat != null ? parseFloat(req.body.current_lat) : null,
      currentLng: req.body?.current_lng != null ? parseFloat(req.body.current_lng) : null,
      io,
    });
    res.json(result);
  } catch (err) {
    console.error('[TOURS] Erreur reoptimize-public :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/reoptimize/:reoptId/accept-public — Chauffeur accepte
router.post('/:id/reoptimize/:reoptId/accept-public', async (req, res) => {
  try {
    const result = await applyReoptimization(parseInt(req.params.reoptId, 10), null);
    if (result.error) return res.status(400).json(result);
    const io = req.app.get('io');
    if (io) io.to(`tour-${result.tour_id}`).emit('reoptimization-accepted', {
      reoptId: parseInt(req.params.reoptId, 10), tour_id: result.tour_id,
    });
    res.json(result);
  } catch (err) {
    console.error('[TOURS] Erreur accept-public :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/reoptimize/:reoptId/reject-public — Chauffeur refuse
router.post('/:id/reoptimize/:reoptId/reject-public', async (req, res) => {
  try {
    const result = await rejectReoptimization(parseInt(req.params.reoptId, 10), null);
    if (result.error) return res.status(400).json(result);
    const io = req.app.get('io');
    if (io) io.to(`tour-${result.tour_id}`).emit('reoptimization-rejected', {
      reoptId: parseInt(req.params.reoptId, 10), tour_id: result.tour_id,
    });
    res.json(result);
  } catch (err) {
    console.error('[TOURS] Erreur reject-public :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/:id/reoptimize/pending-public — Proposition en attente (mobile)
router.get('/:id/reoptimize/pending-public', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM tour_reoptimizations
         WHERE tour_id = $1 AND status = 'pending'
         ORDER BY triggered_at DESC LIMIT 1`,
      [req.params.id]
    );
    res.json(r.rows[0] || null);
  } catch (err) {
    console.error('[TOURS] Erreur pending-public :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/:id/status-public — Changer le statut d'une tournée (mobile sans auth)
router.put('/:id/status-public', async (req, res) => {
  try {
    const { status, km_start, km_end, notes } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Statut requis' });
    }
    // Vérifier les transitions autorisées
    const allowedTransitions = {
      'planned': ['in_progress'],
      'in_progress': ['returning', 'completed'],
      'returning': ['completed']
    };
    const current = await pool.query('SELECT * FROM tours WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Tournée non trouvée' });
    }
    const currentStatus = current.rows[0].status;

    // Résidu 2 (vague 0) — Idempotence du chemin MOBILE de clôture.
    // Le chemin web execution.js a été rendu idempotent en vague 0
    // (garde AND status <> 'completed' + réponse 200 sans effet de bord).
    // On réplique ici : un rejeu offline demandant le statut déjà courant est
    // un no-op qui répond 200 avec la tournée telle quelle, SANS ré-émettre de
    // push aux managers ni recalculer les horaires. Indispensable car la file
    // de sync peut renvoyer « completed » plusieurs fois (finalisation de
    // pesée) — sans cette garde le mobile recevait un 400 « transition non
    // autorisée » trompeur.
    if (status === currentStatus) {
      return res.json(current.rows[0]);
    }

    const allowed = allowedTransitions[currentStatus];
    if (!allowed || !allowed.includes(status)) {
      return res.status(400).json({ error: `Transition ${currentStatus} → ${status} non autorisée` });
    }

    // Fix bug C6 : persister km_start / km_end / notes envoyés par le
    // mobile (Checklist, ReturnCentre). Sans ça, TourSummary affiche
    // distance = null.
    const updates = ['status = $1', 'updated_at = NOW()'];
    const params = [status];
    if (status === 'in_progress') updates.push('started_at = NOW()');
    if (status === 'completed') updates.push('completed_at = NOW()');
    // Déclenche le calcul OSRM des horaires prévisionnels une fois la
    // tournée passée en in_progress (non bloquant).
    if (status === 'in_progress') {
      ensurePlannedPassages(req.params.id).catch(err =>
        console.warn('[TOURS] planned-passage (status-public) échec :', err.message));
    }
    if (km_start !== undefined && km_start !== null && km_start !== '') {
      params.push(parseInt(km_start, 10));
      updates.push(`km_start = $${params.length}`);
    }
    if (km_end !== undefined && km_end !== null && km_end !== '') {
      params.push(parseInt(km_end, 10));
      updates.push(`km_end = $${params.length}`);
    }
    if (notes !== undefined && notes !== null && notes !== '') {
      params.push(String(notes));
      updates.push(`notes = $${params.length}`);
    }

    params.push(req.params.id);
    // Garde d'idempotence défensive contre une course (deux requêtes « completed »
    // lisant toutes deux « in_progress ») : seule la première ligne bascule et
    // déclenche le push. Aligné sur execution.js (vague 0).
    let whereClause = `id = $${params.length}`;
    if (status === 'completed') whereClause += " AND status <> 'completed'";
    const result = await pool.query(
      `UPDATE tours SET ${updates.join(', ')} WHERE ${whereClause} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      // 0 ligne sur une clôture = déjà terminée entre-temps (course) → no-op
      // idempotent : on renvoie la tournée existante sans ré-émettre de push.
      return res.json(current.rows[0]);
    }

    // Push notification aux managers sur fin / annulation déclenchée côté mobile.
    // Lien vers la page Incidents non pertinent ici : on garde la vue collecte.
    if (status === 'completed' || status === 'cancelled') {
      const label = status === 'completed' ? 'terminée' : 'annulée';
      const tour = result.rows[0];
      sendPushToRoles(['ADMIN', 'MANAGER'], {
        title: `Tournée #${req.params.id} ${label}`,
        body: tour?.total_weight_kg
          ? `Poids total : ${Math.round(tour.total_weight_kg)} kg`
          : 'Déclarée depuis le mobile chauffeur',
        tag: `tour-${req.params.id}-${status}`,
        data: { url: '/collections-live', tourId: parseInt(req.params.id, 10) },
      }).catch(() => {});
    }

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

    // Liste détaillée des points pour que l'écran récap mobile puisse
    // afficher la comparaison prévu / réalisé (badges décalage).
    let cavs = [];
    if (tour.collection_type === 'association') {
      const r = await pool.query(
        `SELECT tap.id, tap.association_point_id AS cav_id, tap.position, tap.status,
                tap.fill_level, tap.collected_at, tap.planned_passage_time, tap.notes,
                ap.name AS cav_name, ap.ville AS commune
           FROM tour_association_point tap
           JOIN association_points ap ON ap.id = tap.association_point_id
          WHERE tap.tour_id = $1 ORDER BY tap.position`,
        [req.params.id]
      );
      cavs = r.rows;
    } else {
      const r = await pool.query(
        `SELECT tc.id, tc.cav_id, tc.position, tc.status, tc.fill_level,
                tc.collected_at, tc.planned_passage_time, tc.notes, tc.skip_reason,
                c.name AS cav_name, c.commune
           FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
          WHERE tc.tour_id = $1 ORDER BY tc.position`,
        [req.params.id]
      );
      cavs = r.rows;
    }
    const enrichedCavs = cavs.map(c => {
      let delay_minutes = null;
      if (c.collected_at && c.planned_passage_time) {
        delay_minutes = Math.round((new Date(c.collected_at) - new Date(c.planned_passage_time)) / 60000);
      }
      return { ...c, delay_minutes };
    });

    const incidentsRows = await pool.query(
      `SELECT id, type, description, created_at FROM incidents WHERE tour_id = $1 ORDER BY created_at`,
      [req.params.id]
    );

    const checklistRes = await pool.query(
      `SELECT * FROM vehicle_checklists WHERE tour_id = $1 LIMIT 1`,
      [req.params.id]
    );

    res.json({
      tour,
      cavs: enrichedCavs,
      incidents: incidentsRows.rows,
      checklist: checklistRes.rows[0] || null,
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

// ── Vague 2 (item 62) — Canal manager → chauffeur (côté mobile) ────────────
// Ces routes « -public » sont authentifiées par le JWT chauffeur (middleware
// MOBILE_DRIVER_PATH en tête de ce routeur) — pas d'accès anonyme.

// GET /api/tours/vehicle/:vehicleId/messages-public — consignes NON LUES pour
// le véhicule du chauffeur. Sert la bannière DriverMessageBanner (poll mobile).
router.get('/vehicle/:vehicleId/messages-public', async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (!vehicleId) return res.status(400).json({ error: 'vehicleId invalide' });
    const r = await pool.query(
      `SELECT id, tour_id, vehicle_id, message, created_at, read_at
         FROM driver_messages
        WHERE vehicle_id = $1 AND read_at IS NULL
        ORDER BY created_at ASC`,
      [vehicleId]
    );
    res.json({ messages: r.rows });
  } catch (err) {
    console.error('[TOURS] Erreur messages-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/messages/:id/read-public — accusé de lecture (« J'ai compris »).
// Idempotent : le premier accusé fixe read_at ; un rejeu (file de sync offline)
// répond 200 sans effet de bord (jamais d'erreur qui bloquerait la file).
router.post('/messages/:id/read-public', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id invalide' });
    // Vague 3 — garde véhicule : un chauffeur n'accuse réception que d'une
    // consigne destinée à SON véhicule. La clause `vehicle_id = $2` borne
    // l'UPDATE (aucun effet de bord sur une consigne d'un autre véhicule) ; en
    // cas de 0 ligne, on distingue « autre véhicule » (403) de « déjà lu ».
    const tokenVehId = driverVehicleIdFromToken(req.user);
    const r = tokenVehId != null
      ? await pool.query(
          `UPDATE driver_messages SET read_at = NOW()
            WHERE id = $1 AND read_at IS NULL AND vehicle_id = $2
            RETURNING id, read_at`,
          [id, tokenVehId]
        )
      : await pool.query(
          `UPDATE driver_messages SET read_at = NOW()
            WHERE id = $1 AND read_at IS NULL
            RETURNING id, read_at`,
          [id]
        );
    if (r.rows.length === 0) {
      const existing = await pool.query('SELECT id, read_at, vehicle_id FROM driver_messages WHERE id = $1', [id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Message non trouvé' });
      if (tokenVehId != null && existing.rows[0].vehicle_id != null
          && Number(existing.rows[0].vehicle_id) !== tokenVehId) {
        return res.status(403).json({ error: 'Consigne destinée à un autre véhicule' });
      }
      return res.json({ id: existing.rows[0].id, read_at: existing.rows[0].read_at, already: true });
    }
    res.json({ id: r.rows[0].id, read_at: r.rows[0].read_at });
  } catch (err) {
    console.error('[TOURS] Erreur read-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/:id/history-public — historique SERVEUR enrichi d'une tournée
// pour le mobile (points, incidents déclarés, pesées enregistrées). Permet au
// chauffeur de vérifier que « sa pesée est bien passée » au-delà de sa file
// locale (qui se vide après synchronisation).
router.get('/:id/history-public', async (req, res) => {
  try {
    const tourId = parseInt(req.params.id, 10);
    if (!tourId) return res.status(400).json({ error: 'id invalide' });
    const tourCheck = await pool.query('SELECT id, collection_type, vehicle_id FROM tours WHERE id = $1', [tourId]);
    if (tourCheck.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });
    // Vague 3 — garde véhicule : historique borné à la tournée du véhicule du token.
    if (driverVehicleMismatch(req, res, tourCheck.rows[0].vehicle_id)) return;
    const collectionType = tourCheck.rows[0].collection_type || 'pav';

    let cavs = [];
    if (collectionType === 'association') {
      const r = await pool.query(
        `SELECT tap.id, tap.association_point_id AS cav_id, tap.position, tap.status,
                tap.fill_level, tap.collected_at, tap.notes,
                ap.name AS cav_name, ap.ville AS commune
           FROM tour_association_point tap
           JOIN association_points ap ON ap.id = tap.association_point_id
          WHERE tap.tour_id = $1 ORDER BY tap.position`,
        [tourId]
      );
      cavs = r.rows;
    } else {
      const r = await pool.query(
        `SELECT tc.id, tc.cav_id, tc.position, tc.status, tc.fill_level,
                tc.collected_at, tc.notes, tc.skip_reason,
                c.name AS cav_name, c.commune
           FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
          WHERE tc.tour_id = $1 ORDER BY tc.position`,
        [tourId]
      );
      cavs = r.rows;
    }

    const incidents = await pool.query(
      `SELECT id, type, description, photo_path, created_at
         FROM incidents WHERE tour_id = $1 ORDER BY created_at`,
      [tourId]
    );
    const weights = await pool.query(
      `SELECT id, weight_kg, tare_kg, is_intermediate, notes, recorded_at
         FROM tour_weights WHERE tour_id = $1 ORDER BY recorded_at`,
      [tourId]
    );

    res.json({ cavs, incidents: incidents.rows, weights: weights.rows });
  } catch (err) {
    console.error('[TOURS] Erreur history-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// All routes below require authentication
router.use(authenticate);

// ── Vague 2 (item 62) — Canal manager → chauffeur (côté web) ───────────────
// Le responsable logistique envoie une consigne à un chauffeur en tournée
// (consigne, CAV ajouté, danger signalé) depuis la Collecte en direct.
// LECTURE + ÉCRITURE réservées ADMIN/MANAGER (aucune écriture pour AUTORITE).

// POST /api/tours/messages — envoyer une consigne au chauffeur d'un véhicule.
router.post('/messages', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const vehicleId = parseInt(req.body?.vehicle_id, 10);
    const tourId = req.body?.tour_id != null && req.body.tour_id !== ''
      ? parseInt(req.body.tour_id, 10) : null;
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!vehicleId) return res.status(400).json({ error: 'vehicle_id requis' });
    if (!message) return res.status(400).json({ error: 'Message vide' });
    if (message.length > 1000) return res.status(400).json({ error: 'Message trop long (max 1000 caractères)' });

    const veh = await pool.query('SELECT id FROM vehicles WHERE id = $1', [vehicleId]);
    if (veh.rows.length === 0) return res.status(404).json({ error: 'Véhicule non trouvé' });

    const r = await pool.query(
      `INSERT INTO driver_messages (tour_id, vehicle_id, message, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tour_id, vehicle_id, message, created_by, created_at, read_at`,
      [tourId, vehicleId, message, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur POST messages:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/messages?vehicle_id=&tour_id= — consignes envoyées (lu/non lu).
router.get('/messages', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const vehicleId = req.query.vehicle_id ? parseInt(req.query.vehicle_id, 10) : null;
    const tourId = req.query.tour_id ? parseInt(req.query.tour_id, 10) : null;
    const conds = [];
    const params = [];
    if (vehicleId) { params.push(vehicleId); conds.push(`dm.vehicle_id = $${params.length}`); }
    if (tourId) { params.push(tourId); conds.push(`dm.tour_id = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT dm.id, dm.tour_id, dm.vehicle_id, dm.message, dm.created_at, dm.read_at,
              u.first_name AS sender_first_name, u.last_name AS sender_last_name
         FROM driver_messages dm
         LEFT JOIN users u ON u.id = dm.created_by
         ${where}
        ORDER BY dm.created_at DESC
        LIMIT 100`,
      params
    );
    res.json({ messages: r.rows });
  } catch (err) {
    console.error('[TOURS] Erreur GET messages:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Mount live-summary route (supervision d'une tournée en cours)
router.use('/', liveSummaryRouter);
router.use('/', activeSummaryRouter);

// Mount reoptimize routes (manager trigger / accept / reject)
router.use('/', reoptimizeRouter);

// Mount planning routes (Niveau 2.7 — drag-drop affectation)
router.use('/', planningRouter);

// Mount dashboard collecte (Niveau 2.1 — supervision consolidée)
router.use('/', dashboardRouter);

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

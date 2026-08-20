const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { predictFillRate, getSeasonalFactors, setSeasonalFactors, getDayOfWeekFactors, setDayOfWeekFactors, getHolidays, setHolidays, getSchoolVacations, setSchoolVacations, getScoringConfig, setScoringConfig, reloadPersistedConfig, ensureConfigLoaded } = require('./predictions');
const fillFactors = require('../../utils/fill-factors');
const { generateIntelligentTour, estimateFixedRoute, estimationSummary } = require('./smart-tour');
const { CENTRE_TRI_LAT, CENTRE_TRI_LNG } = require('./context');

// ══════════════════════════════════════════════════════════════
// Contraintes de journée sur TOUS les modes de création (août 2026)
// ──────────────────────────────────────────────────────────────
// Le mode « intelligent » était le seul à connaître la durée maximale, la
// pause déjeuner et les retours de vidage : les tournées standard / manuelle /
// association étaient créées sans AUCUN calcul (ni durée, ni distance, ni
// poids) et pouvaient donc dépasser silencieusement la journée de travail.
// Elles passent désormais toutes par le même moteur (services/tour-time-engine)
// via `estimateFixedRoute`, stockent leur estimation et sont REFUSÉES en 409
// quand le budget de travail est dépassé — sauf forçage explicite (`force`),
// qui laisse une trace dans `ai_explanation`.
// ══════════════════════════════════════════════════════════════

const DEPASSEMENT_CODE = 'DUREE_MAX_DEPASSEE';

/** Charge un véhicule (id, capacité) ou null. */
async function loadVehicle(vehicleId) {
  const r = await pool.query(
    'SELECT id, registration, name, max_capacity_kg, status FROM vehicles WHERE id = $1',
    [vehicleId]
  );
  return r.rows[0] || null;
}

/** Identifiants entiers uniques d'une liste hétérogène. */
function uniqueIds(list) {
  return [...new Set((list || []).map((v) => parseInt(v, 10)).filter(Number.isFinite))];
}

/** Points CAV dans l'ordre demandé (les ids inconnus sont ignorés). */
async function loadCavPoints(cavIds) {
  const ids = (cavIds || []).map((v) => parseInt(v, 10)).filter(Number.isFinite);
  if (ids.length === 0) return [];
  const r = await pool.query(
    `SELECT id, name, address, commune, latitude, longitude, nb_containers
       FROM cav WHERE id = ANY($1)`,
    [ids]
  );
  const byId = new Map(r.rows.map((row) => [Number(row.id), row]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((row) => ({ ...row, type: 'cav' }));
}

/** Points CAV d'un modèle de tournée, dans l'ordre du modèle. */
async function loadRouteCavPoints(routeId) {
  const r = await pool.query(
    `SELECT c.id, c.name, c.address, c.commune, c.latitude, c.longitude, c.nb_containers, src.position
       FROM standard_route_cav src JOIN cav c ON c.id = src.cav_id
      WHERE src.route_id = $1 ORDER BY src.position`,
    [routeId]
  );
  return r.rows.map((row) => ({ ...row, type: 'cav' }));
}

/** Points association dans l'ordre demandé. */
async function loadAssociationPoints(pointIds) {
  const ids = (pointIds || []).map((v) => parseInt(v, 10)).filter(Number.isFinite);
  if (ids.length === 0) return [];
  const r = await pool.query(
    `SELECT id, name, address, ville AS commune, latitude, longitude
       FROM association_points WHERE id = ANY($1)`,
    [ids]
  );
  const byId = new Map(r.rows.map((row) => [Number(row.id), row]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((row) => ({ ...row, type: 'association', nb_containers: null }));
}

/** Jour utilisé par défaut pour une estimation (jour civil de Paris). */
function defaultEstimateDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}

// ── Modèles de tournée (`standard_routes`) ────────────────────────────────
// Capacité du véhicule GÉNÉRIQUE utilisée pour estimer un MODÈLE : un modèle
// n'est pas attaché à un véhicule, on prend donc la valeur par défaut du parc
// (`vehicles.max_capacity_kg DEFAULT 3500`). L'estimation réelle est refaite
// avec le véhicule choisi au moment de créer la tournée.
const GENERIC_VEHICLE = { id: null, name: 'Véhicule générique', max_capacity_kg: 3500 };

/** Écrit la composition CAV ordonnée d'un modèle (les ids invalides sont ignorés). */
async function insertCavComposition(client, routeId, cavIds) {
  const ids = (cavIds || []).map((v) => parseInt(v, 10)).filter(Number.isFinite);
  const seen = new Set();
  let position = 1;
  for (const cavId of ids) {
    if (seen.has(cavId)) continue; // UNIQUE(route_id, cav_id)
    seen.add(cavId);
    await client.query(
      'INSERT INTO standard_route_cav (route_id, cav_id, position) VALUES ($1, $2, $3)',
      [routeId, cavId, position++]
    );
  }
}

/** Écrit la composition association ordonnée d'un modèle. */
async function insertAssociationComposition(client, routeId, pointIds) {
  const ids = (pointIds || []).map((v) => parseInt(v, 10)).filter(Number.isFinite);
  const seen = new Set();
  let position = 1;
  for (const pointId of ids) {
    if (seen.has(pointId)) continue; // UNIQUE(route_id, association_point_id)
    seen.add(pointId);
    await client.query(
      'INSERT INTO standard_route_association (route_id, association_point_id, position) VALUES ($1, $2, $3)',
      [routeId, pointId, position++]
    );
  }
}

/**
 * Estimation d'un MODÈLE de tournée (véhicule générique, départ à l'heure
 * paramétrée). Best effort : un échec d'estimation ne doit jamais empêcher
 * d'enregistrer le modèle — on renvoie alors `null` (jamais de valeur inventée).
 */
async function estimateRouteModel({ cavIds = null, associationPointIds = null } = {}) {
  try {
    const points = cavIds
      ? await loadCavPoints(cavIds)
      : await loadAssociationPoints(associationPointIds);
    if (points.length === 0) return null;
    const { estimation } = await estimateFixedRoute({
      vehicle: GENERIC_VEHICLE, points, date: defaultEstimateDate(),
    });
    return estimation;
  } catch (err) {
    console.warn('[TOURS] Estimation du modèle de tournée ignorée :', err.message);
    return null;
  }
}

/** Persiste durée/distance estimées d'un modèle (null si non estimable). */
async function persistRouteEstimation(client, routeId, estimation) {
  await client.query(
    'UPDATE standard_routes SET estimated_duration_minutes = $2, estimated_distance_km = $3 WHERE id = $1',
    [routeId, estimation ? estimation.duree_travail_min : null, estimation ? estimation.distance_km : null]
  );
}

/** Champs d'estimation renvoyés à côté de la ligne `standard_routes`. */
function routeEstimationFields(estimation) {
  return {
    estimated_duration_minutes: estimation ? estimation.duree_travail_min : null,
    estimated_distance_km: estimation ? estimation.distance_km : null,
  };
}

/**
 * Un modèle référencé par une tournée ne peut pas être supprimé (l'historique
 * perdrait son libellé). Renvoie le corps du 409 ou null.
 */
async function routeInUse(routeId) {
  const r = await pool.query(
    'SELECT COUNT(*)::int AS n FROM tours WHERE standard_route_id = $1', [routeId]
  );
  const n = r.rows[0]?.n || 0;
  if (n === 0) return null;
  return {
    error: `Ce modèle de tournée est utilisé par ${n} tournée(s) : il ne peut pas être supprimé. `
      + 'Désactivez-le pour le retirer des listes tout en conservant l’historique.',
    code: 'ROUTE_UTILISEE',
    tours_count: n,
  };
}

// Vague 1 (item 47a) — Double affectation véhicule.
// Refuse d'affecter un véhicule déjà engagé sur une autre tournée non terminée
// le même jour. Renvoie la tournée en conflit (id/status) ou null.
async function findVehicleConflict(vehicleId, date, excludeTourId = null) {
  if (!vehicleId || !date) return null;
  const params = [vehicleId, date];
  let sql = `SELECT id, status FROM tours
             WHERE vehicle_id = $1 AND date = $2
               AND status NOT IN ('completed', 'cancelled')`;
  if (excludeTourId) { params.push(excludeTourId); sql += ` AND id <> $${params.length}`; }
  const r = await pool.query(sql + ' ORDER BY id LIMIT 1', params);
  return r.rows[0] || null;
}
function vehicleConflictMessage(conflict) {
  return `Ce véhicule est déjà affecté à la tournée #${conflict.id} ce jour-là (statut : ${conflict.status}). `
    + 'Terminez ou annulez cette tournée, ou choisissez un autre véhicule.';
}

// GET /api/tours — Liste des tournées
router.get('/', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { date, status, vehicle_id } = req.query;
    let query = `
      SELECT t.*, v.registration, v.name as vehicle_name,
       NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '') as driver_name,
       sr.name as route_name,
       CASE WHEN t.collection_type = 'association'
         THEN COALESCE(t.nb_cav, (SELECT COUNT(*)::int FROM tour_association_point tap WHERE tap.tour_id = t.id))
         ELSE COALESCE(t.nb_cav, (SELECT COUNT(*)::int FROM tour_cav tc WHERE tc.tour_id = t.id))
       END as nb_cav,
       CASE WHEN t.collection_type = 'association'
         THEN (SELECT COUNT(*)::int FROM tour_association_point tap WHERE tap.tour_id = t.id AND tap.status = 'collected')
         ELSE (SELECT COUNT(*)::int FROM tour_cav tc WHERE tc.tour_id = t.id AND tc.status = 'collected')
       END as collected_count
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
// Renvoie les facteurs EFFECTIFS (appris > manuel > défaut) + la source de
// chacun (item 49). Les tableaux `seasonalFactors`/`dayOfWeekFactors` reflètent
// donc ce que le moteur applique réellement ; `*Sources` documente l'origine.
router.get('/predictive-config', authorize('ADMIN'), async (req, res) => {
  try {
    await ensureConfigLoaded();
    const resolved = await fillFactors.getResolvedFactors();
    // Pondération météo apprise (best effort : {ok:false} si pas encore apprise)
    let weatherLearned = { ok: false };
    try {
      weatherLearned = await require('../../services/weather-learning').getLearnedWeatherRatios();
    } catch (e) { /* affichage admin seulement, jamais bloquant */ }
    res.json({
      seasonalFactors: resolved.seasonal,
      dayOfWeekFactors: resolved.dayOfWeek,
      seasonalSources: resolved.seasonalSources,
      dayOfWeekSources: resolved.dayOfWeekSources,
      learnedMonthlyCount: resolved.learnedMonthlyCount,
      learnedDowCount: resolved.learnedDowCount,
      holidays: getHolidays(),
      schoolVacations: getSchoolVacations(),
      scoring: getScoringConfig(),
      weatherLearned,
      centreTri: { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG },
    });
  } catch (err) {
    console.error('[TOURS] Erreur config prédictive :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/predictive-config — Mettre à jour les variables
// Persiste la config dans `settings` (via fill-factors) ET met à jour la copie
// en mémoire (getters historiques). Les facteurs saisis alimentent la couche
// MANUELLE ; ils restent supplantés par les facteurs APPRIS là où ils existent.
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

    // Persistance en base (survit aux redéploiements) + invalidation du cache
    // fill-factors pour que la résolution reprenne les nouvelles valeurs manuelles.
    await fillFactors.persistConfig({
      seasonalFactors: getSeasonalFactors(),
      dayOfWeekFactors: getDayOfWeekFactors(),
      holidays: getHolidays(),
      schoolVacations: getSchoolVacations(),
      scoring: getScoringConfig(),
    });
    // Recharge la copie mémoire depuis la source persistée (idempotent).
    await reloadPersistedConfig();

    const resolved = await fillFactors.getResolvedFactors();
    res.json({
      message: 'Configuration mise à jour',
      seasonalFactors: resolved.seasonal,
      dayOfWeekFactors: resolved.dayOfWeek,
      seasonalSources: resolved.seasonalSources,
      dayOfWeekSources: resolved.dayOfWeekSources,
      learnedMonthlyCount: resolved.learnedMonthlyCount,
      learnedDowCount: resolved.learnedDowCount,
      holidays: getHolidays(),
      schoolVacations: getSchoolVacations(),
      scoring: getScoringConfig(),
      centreTri: { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG },
    });
  } catch (err) {
    console.error('[TOURS] Erreur update config :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// POST /api/tours/estimate — Simulation d'une tournée (aucune écriture)
// ──────────────────────────────────────────
// Permet au manager de vérifier AVANT création qu'une liste de points tient
// dans la journée (6 h de travail, pause déjeuner au centre hors travail,
// retours de vidage comptés). Exactement UNE source de points : `cav_ids`,
// `standard_route_id` ou `association_point_ids`.
// ══════════════════════════════════════════
router.post('/estimate', authorize('ADMIN', 'MANAGER'), [
  body('vehicle_id').isInt().withMessage('ID véhicule requis'),
], validate, async (req, res) => {
  try {
    const { vehicle_id, date, cav_ids, standard_route_id, association_point_ids, optimize } = req.body;
    const vid = parseInt(vehicle_id, 10);
    if (!Number.isFinite(vid)) return res.status(400).json({ error: 'vehicle_id invalide' });

    const sources = [
      Array.isArray(cav_ids) && cav_ids.length > 0 ? 'cav_ids' : null,
      standard_route_id != null && standard_route_id !== '' ? 'standard_route_id' : null,
      Array.isArray(association_point_ids) && association_point_ids.length > 0 ? 'association_point_ids' : null,
    ].filter(Boolean);
    if (sources.length !== 1) {
      return res.status(400).json({
        error: 'Fournissez exactement une source de points : cav_ids, standard_route_id ou association_point_ids.',
      });
    }

    const vehicle = await loadVehicle(vid);
    if (!vehicle) return res.status(404).json({ error: 'Véhicule non trouvé' });

    let points = [];
    if (sources[0] === 'cav_ids') points = await loadCavPoints(cav_ids);
    else if (sources[0] === 'standard_route_id') points = await loadRouteCavPoints(parseInt(standard_route_id, 10));
    else points = await loadAssociationPoints(association_point_ids);

    if (points.length === 0) {
      return res.status(400).json({ error: 'Aucun point valide pour cette estimation.' });
    }

    const { estimation, ordre_optimise } = await estimateFixedRoute({
      vehicle,
      points,
      date: date || defaultEstimateDate(),
      optimize: optimize === true || optimize === 'true',
    });
    if (ordre_optimise) estimation.ordre_optimise = ordre_optimise;

    res.json({ estimation });
  } catch (err) {
    console.error('[TOURS] Erreur estimation :', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
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

    let cavs;
    if (tour.rows[0].collection_type === 'association') {
      cavs = await pool.query(
        `SELECT tap.id, tap.tour_id, tap.association_point_id as cav_id, tap.position, tap.status,
                tap.fill_level, tap.collected_at, tap.notes,
                ap.name as cav_name, ap.address, ap.ville as commune, ap.latitude, ap.longitude,
                ap.contact_phone, NULL as nb_containers
         FROM tour_association_point tap
         JOIN association_points ap ON ap.id = tap.association_point_id
         WHERE tap.tour_id = $1 ORDER BY tap.position`,
        [req.params.id]
      );
    } else {
      cavs = await pool.query(
        `SELECT tc.*, c.name as cav_name, c.address, c.commune, c.latitude, c.longitude, c.nb_containers
         FROM tour_cav tc JOIN cav c ON tc.cav_id = c.id
         WHERE tc.tour_id = $1 ORDER BY tc.position`,
        [req.params.id]
      );
    }

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

    // Vague 1 (item 47a) — bloque la double affectation avant la génération.
    const conflict = await findVehicleConflict(vid, date);
    if (conflict) return res.status(409).json({ error: vehicleConflictMessage(conflict) });

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
    const { vehicle_id, date, driver_employee_id, standard_route_id, force } = req.body;

    const vid = parseInt(vehicle_id, 10);
    const did = driver_employee_id ? parseInt(driver_employee_id, 10) : null;
    const srid = parseInt(standard_route_id, 10);

    // Vague 1 (item 47a) — bloque la double affectation véhicule.
    const conflict = await findVehicleConflict(vid, date);
    if (conflict) return res.status(409).json({ error: vehicleConflictMessage(conflict) });

    const vehicle = await loadVehicle(vid);
    if (!vehicle) return res.status(404).json({ error: 'Véhicule non trouvé' });

    const points = await loadRouteCavPoints(srid);
    const { estimation, points: estimated } = await estimateFixedRoute({ vehicle, points, date });
    const forced = force === true || force === 'true';
    if (estimation.depassement_min > 0 && !forced) {
      return res.status(409).json({
        error: `Ce modèle de tournée dépasse la journée de travail de ${estimation.depassement_min} min `
          + `(${Math.round(estimation.duree_travail_min / 6) / 10} h de travail pour un maximum de `
          + `${Math.round(estimation.budget_travail_min / 6) / 10} h). Retirez des points ou forcez la création.`,
        code: DEPASSEMENT_CODE,
        estimation,
      });
    }

    const tourResult = await pool.query(
      `INSERT INTO tours (date, vehicle_id, driver_employee_id, standard_route_id, mode, status,
                          ai_explanation, estimated_distance_km, estimated_duration_min, nb_cav)
       VALUES ($1, $2, $3, $4, 'standard', 'planned', $5, $6, $7, $8) RETURNING *`,
      [date, vid, did, srid,
        estimationSummary(estimation, { mode: 'standard', vehicle, forced: forced && estimation.depassement_min > 0 }),
        estimation.distance_km, estimation.duree_travail_min, estimation.nb_points]
    );
    const tourId = tourResult.rows[0].id;

    // Copier les CAV de la route standard (avec le remplissage prédit du jour)
    for (let i = 0; i < estimated.length; i++) {
      await pool.query(
        'INSERT INTO tour_cav (tour_id, cav_id, position, predicted_fill_rate) VALUES ($1, $2, $3, $4)',
        [tourId, estimated[i].id, i + 1, estimated[i]._fill ?? null]
      );
    }

    res.status(201).json({ ...tourResult.rows[0], estimation });
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
    const { vehicle_id, date, driver_employee_id, cav_ids, force } = req.body;

    const vid = parseInt(vehicle_id, 10);
    const did = driver_employee_id ? parseInt(driver_employee_id, 10) : null;

    // Vague 1 (item 47a) — bloque la double affectation véhicule.
    const conflict = await findVehicleConflict(vid, date);
    if (conflict) return res.status(409).json({ error: vehicleConflictMessage(conflict) });

    const vehicle = await loadVehicle(vid);
    if (!vehicle) return res.status(404).json({ error: 'Véhicule non trouvé' });

    const points = await loadCavPoints(cav_ids);
    if (points.length === 0) return res.status(400).json({ error: 'Aucun CAV valide dans la liste fournie.' });
    // Un identifiant inconnu ne doit pas disparaître en silence : mieux vaut
    // refuser que créer une tournée amputée sans que personne ne le sache.
    const inconnus = uniqueIds(cav_ids).filter((id) => !points.some((p) => Number(p.id) === id));
    if (inconnus.length > 0) {
      return res.status(400).json({ error: `CAV introuvable(s) : ${inconnus.join(', ')}` });
    }

    const { estimation, points: estimated } = await estimateFixedRoute({ vehicle, points, date });
    const forced = force === true || force === 'true';
    if (estimation.depassement_min > 0 && !forced) {
      return res.status(409).json({
        error: `Cette tournée dépasse la journée de travail de ${estimation.depassement_min} min `
          + `(${Math.round(estimation.duree_travail_min / 6) / 10} h de travail pour un maximum de `
          + `${Math.round(estimation.budget_travail_min / 6) / 10} h). Retirez des CAV ou forcez la création.`,
        code: DEPASSEMENT_CODE,
        estimation,
      });
    }

    const tourResult = await pool.query(
      `INSERT INTO tours (date, vehicle_id, driver_employee_id, mode, status,
                          ai_explanation, estimated_distance_km, estimated_duration_min, nb_cav)
       VALUES ($1, $2, $3, 'manual', 'planned', $4, $5, $6, $7) RETURNING *`,
      [date, vid, did,
        estimationSummary(estimation, { mode: 'manual', vehicle, forced: forced && estimation.depassement_min > 0 }),
        estimation.distance_km, estimation.duree_travail_min, estimation.nb_points]
    );
    const tourId = tourResult.rows[0].id;

    for (let i = 0; i < estimated.length; i++) {
      await pool.query(
        'INSERT INTO tour_cav (tour_id, cav_id, position, predicted_fill_rate) VALUES ($1, $2, $3, $4)',
        [tourId, estimated[i].id, i + 1, estimated[i]._fill ?? null]
      );
    }

    res.status(201).json({ ...tourResult.rows[0], estimation });
  } catch (err) {
    console.error('[TOURS] Erreur tournée manuelle :', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

// POST /api/tours/association — Créer une tournée association
router.post('/association', authorize('ADMIN', 'MANAGER'), [
  body('vehicle_id').isInt().withMessage('ID véhicule requis'),
  body('date').notEmpty().withMessage('Date requise'),
  body('association_point_ids').isArray({ min: 1 }).withMessage('Liste de points association requise'),
], validate, async (req, res) => {
  try {
    const { vehicle_id, date, driver_employee_id, association_point_ids, standard_route_id, force } = req.body;

    const vid = parseInt(vehicle_id, 10);
    const did = driver_employee_id ? parseInt(driver_employee_id, 10) : null;
    const srid = standard_route_id ? parseInt(standard_route_id, 10) : null;

    // Vague 1 (item 47a) — bloque la double affectation véhicule.
    const conflict = await findVehicleConflict(vid, date);
    if (conflict) return res.status(409).json({ error: vehicleConflictMessage(conflict) });

    const vehicle = await loadVehicle(vid);
    if (!vehicle) return res.status(404).json({ error: 'Véhicule non trouvé' });

    const points = await loadAssociationPoints(association_point_ids);
    if (points.length === 0) return res.status(400).json({ error: 'Aucun point association valide dans la liste fournie.' });
    const inconnus = uniqueIds(association_point_ids).filter((id) => !points.some((p) => Number(p.id) === id));
    if (inconnus.length > 0) {
      return res.status(400).json({ error: `Point(s) association introuvable(s) : ${inconnus.join(', ')}` });
    }

    const { estimation } = await estimateFixedRoute({ vehicle, points, date });
    const forced = force === true || force === 'true';
    if (estimation.depassement_min > 0 && !forced) {
      return res.status(409).json({
        error: `Cette tournée association dépasse la journée de travail de ${estimation.depassement_min} min `
          + `(${Math.round(estimation.duree_travail_min / 6) / 10} h de travail pour un maximum de `
          + `${Math.round(estimation.budget_travail_min / 6) / 10} h). Retirez des points ou forcez la création.`,
        code: DEPASSEMENT_CODE,
        estimation,
      });
    }

    const tourResult = await pool.query(
      `INSERT INTO tours (date, vehicle_id, driver_employee_id, standard_route_id, mode, status, collection_type,
                          ai_explanation, estimated_distance_km, estimated_duration_min, nb_cav)
       VALUES ($1, $2, $3, $4, 'standard', 'planned', 'association', $5, $6, $7, $8) RETURNING *`,
      [date, vid, did, srid,
        estimationSummary(estimation, { mode: 'association', vehicle, forced: forced && estimation.depassement_min > 0 }),
        estimation.distance_km, estimation.duree_travail_min, estimation.nb_points]
    );
    const tourId = tourResult.rows[0].id;

    for (let i = 0; i < points.length; i++) {
      await pool.query(
        'INSERT INTO tour_association_point (tour_id, association_point_id, position) VALUES ($1, $2, $3)',
        [tourId, points[i].id, i + 1]
      );
    }

    res.status(201).json({ ...tourResult.rows[0], estimation });
  } catch (err) {
    console.error('[TOURS] Erreur tournée association :', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// MODÈLES DE TOURNÉE — ASSOCIATION
// ──────────────────────────────────────────
// Les deux familles de modèles partagent la table `standard_routes` : un modèle
// est « association » dès qu'il possède des lignes `standard_route_association`,
// « CAV » sinon. Les listes filtrent donc explicitement pour ne jamais mélanger
// les deux (un modèle association ne doit pas apparaître comme modèle CAV).
// ══════════════════════════════════════════

// GET /api/tours/association-routes — Routes standard association
router.get('/association-routes/list', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
    const result = await pool.query(`
      SELECT sr.*, COUNT(sra.id)::int as point_count
      FROM standard_routes sr
      LEFT JOIN standard_route_association sra ON sra.route_id = sr.id
      WHERE EXISTS (SELECT 1 FROM standard_route_association sra2 WHERE sra2.route_id = sr.id)
        ${includeInactive ? '' : 'AND COALESCE(sr.is_active, true) = true'}
      GROUP BY sr.id ORDER BY sr.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[TOURS] Erreur routes association :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/association-routes/:id/points — Points d'une route association
router.get('/association-routes/:id/points', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sra.position, ap.*
      FROM standard_route_association sra
      JOIN association_points ap ON ap.id = sra.association_point_id
      WHERE sra.route_id = $1
      ORDER BY sra.position
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/association-routes/:id — Détail d'un modèle association
router.get('/association-routes/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Identifiant invalide' });
    const route = await pool.query('SELECT * FROM standard_routes WHERE id = $1', [id]);
    if (route.rows.length === 0) return res.status(404).json({ error: 'Modèle de tournée non trouvé' });
    const points = await pool.query(`
      SELECT ap.id AS association_point_id, ap.name, ap.address, ap.ville AS commune,
             ap.latitude, ap.longitude, sra.position
        FROM standard_route_association sra
        JOIN association_points ap ON ap.id = sra.association_point_id
       WHERE sra.route_id = $1 ORDER BY sra.position`, [id]);
    res.json({ route: route.rows[0], points: points.rows });
  } catch (err) {
    console.error('[TOURS] Erreur détail route association :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/association-routes — Créer un modèle association
router.post('/association-routes', authorize('ADMIN', 'MANAGER'), [
  body('name').notEmpty().withMessage('Nom requis'),
  body('association_point_ids').isArray({ min: 1 }).withMessage('Liste de points association requise'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, description, association_point_ids } = req.body;
    await client.query('BEGIN');
    const result = await client.query(
      'INSERT INTO standard_routes (name, description) VALUES ($1, $2) RETURNING *',
      [name, description || null]
    );
    const routeId = result.rows[0].id;
    await insertAssociationComposition(client, routeId, association_point_ids);
    const estim = await estimateRouteModel({ associationPointIds: association_point_ids });
    await persistRouteEstimation(client, routeId, estim);
    await client.query('COMMIT');
    res.status(201).json({ ...result.rows[0], ...routeEstimationFields(estim), estimation: estim });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[TOURS] Erreur création route association :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// PUT /api/tours/association-routes/:id — Modifier un modèle association
router.put('/association-routes/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Identifiant invalide' });
    const { name, description, is_active, association_point_ids } = req.body;

    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM standard_routes WHERE id = $1 FOR UPDATE', [id]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Modèle de tournée non trouvé' });
    }
    const updated = await client.query(
      `UPDATE standard_routes
          SET name = COALESCE($2, name),
              description = COALESCE($3, description),
              is_active = COALESCE($4, is_active)
        WHERE id = $1 RETURNING *`,
      [id, name ?? null, description ?? null, typeof is_active === 'boolean' ? is_active : null]
    );

    let estim = null;
    if (Array.isArray(association_point_ids)) {
      await client.query('DELETE FROM standard_route_association WHERE route_id = $1', [id]);
      await insertAssociationComposition(client, id, association_point_ids);
      estim = await estimateRouteModel({ associationPointIds: association_point_ids });
    } else {
      const current = await client.query(
        'SELECT association_point_id FROM standard_route_association WHERE route_id = $1 ORDER BY position',
        [id]
      );
      estim = await estimateRouteModel({ associationPointIds: current.rows.map((r) => r.association_point_id) });
    }
    await persistRouteEstimation(client, id, estim);
    await client.query('COMMIT');
    res.json({ ...updated.rows[0], ...routeEstimationFields(estim), estimation: estim });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[TOURS] Erreur modification route association :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// DELETE /api/tours/association-routes/:id — Supprimer un modèle association
router.delete('/association-routes/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Identifiant invalide' });
    const refused = await routeInUse(id);
    if (refused) return res.status(409).json(refused);
    const del = await pool.query('DELETE FROM standard_routes WHERE id = $1 RETURNING id', [id]);
    if (del.rows.length === 0) return res.status(404).json({ error: 'Modèle de tournée non trouvé' });
    res.json({ message: 'Modèle de tournée supprimé', id });
  } catch (err) {
    console.error('[TOURS] Erreur suppression route association :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
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
// MODÈLES DE TOURNÉE — CAV (« routes standard »)
// ══════════════════════════════════════════

// GET /api/tours/routes/list — Modèles de tournée CAV
// Par défaut : modèles ACTIFS uniquement (comportement historique).
// `?include_inactive=1` ajoute les modèles désactivés.
router.get('/routes/list', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
    const result = await pool.query(`
      SELECT sr.id, sr.name, sr.description, sr.is_active,
             sr.estimated_duration_minutes, sr.estimated_distance_km, sr.created_at,
             COUNT(src.id)::int as cav_count
      FROM standard_routes sr
      LEFT JOIN standard_route_cav src ON src.route_id = sr.id
      WHERE NOT EXISTS (SELECT 1 FROM standard_route_association sra WHERE sra.route_id = sr.id)
        ${includeInactive ? '' : 'AND COALESCE(sr.is_active, true) = true'}
      GROUP BY sr.id ORDER BY sr.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[TOURS] Erreur routes standard :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/routes/:id — Détail d'un modèle CAV (composition ordonnée)
router.get('/routes/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Identifiant invalide' });
    const route = await pool.query('SELECT * FROM standard_routes WHERE id = $1', [id]);
    if (route.rows.length === 0) return res.status(404).json({ error: 'Modèle de tournée non trouvé' });
    const cavs = await pool.query(`
      SELECT c.id AS cav_id, c.name, c.address, c.commune, c.latitude, c.longitude,
             c.nb_containers, src.position
        FROM standard_route_cav src JOIN cav c ON c.id = src.cav_id
       WHERE src.route_id = $1 ORDER BY src.position`, [id]);
    res.json({ route: route.rows[0], cavs: cavs.rows });
  } catch (err) {
    console.error('[TOURS] Erreur détail route standard :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/routes — Créer un modèle CAV
router.post('/routes', authorize('ADMIN', 'MANAGER'), [
  body('name').notEmpty().withMessage('Nom requis'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, description, cav_ids } = req.body;
    await client.query('BEGIN');
    const result = await client.query(
      'INSERT INTO standard_routes (name, description) VALUES ($1, $2) RETURNING *',
      [name, description || null]
    );
    const routeId = result.rows[0].id;
    await insertCavComposition(client, routeId, cav_ids);
    // Estimations du modèle (durée de travail + distance) — jusqu'ici jamais
    // renseignées, si bien que le manager ne savait pas ce que « valait » un modèle.
    const estim = await estimateRouteModel({ cavIds: cav_ids });
    await persistRouteEstimation(client, routeId, estim);
    await client.query('COMMIT');
    res.status(201).json({ ...result.rows[0], ...routeEstimationFields(estim), estimation: estim });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[TOURS] Erreur création route :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// PUT /api/tours/routes/:id — Modifier un modèle CAV
// `cav_ids` = REMPLACEMENT COMPLET et ordonné de la composition (transaction).
router.put('/routes/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Identifiant invalide' });
    const { name, description, is_active, cav_ids } = req.body;

    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM standard_routes WHERE id = $1 FOR UPDATE', [id]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Modèle de tournée non trouvé' });
    }
    const updated = await client.query(
      `UPDATE standard_routes
          SET name = COALESCE($2, name),
              description = COALESCE($3, description),
              is_active = COALESCE($4, is_active)
        WHERE id = $1 RETURNING *`,
      [id, name ?? null, description ?? null, typeof is_active === 'boolean' ? is_active : null]
    );

    let estim = null;
    if (Array.isArray(cav_ids)) {
      await client.query('DELETE FROM standard_route_cav WHERE route_id = $1', [id]);
      await insertCavComposition(client, id, cav_ids);
      estim = await estimateRouteModel({ cavIds: cav_ids });
    } else {
      const current = await client.query(
        'SELECT cav_id FROM standard_route_cav WHERE route_id = $1 ORDER BY position', [id]
      );
      estim = await estimateRouteModel({ cavIds: current.rows.map((r) => r.cav_id) });
    }
    await persistRouteEstimation(client, id, estim);
    await client.query('COMMIT');
    res.json({ ...updated.rows[0], ...routeEstimationFields(estim), estimation: estim });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[TOURS] Erreur modification route :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// DELETE /api/tours/routes/:id — Supprimer un modèle CAV
// Refus 409 si le modèle est référencé par une tournée (l'historique doit rester
// lisible) : le désactiver (`is_active: false`) est alors la bonne manœuvre.
router.delete('/routes/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Identifiant invalide' });
    const refused = await routeInUse(id);
    if (refused) return res.status(409).json(refused);
    const del = await pool.query('DELETE FROM standard_routes WHERE id = $1 RETURNING id', [id]);
    if (del.rows.length === 0) return res.status(404).json({ error: 'Modèle de tournée non trouvé' });
    res.json({ message: 'Modèle de tournée supprimé', id });
  } catch (err) {
    console.error('[TOURS] Erreur suppression route :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

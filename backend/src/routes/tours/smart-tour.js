const pool = require('../../config/database');
const { CENTRE_TRI_LAT, CENTRE_TRI_LNG, getContextForDate, getLocalEventsForDate } = require('./context');
const { nearestNeighborTSP, twoOptImprove, osrmRouteSegment, osrmOptimizedTrip } = require('./geo');
// Cache des tronçons routiers : le réseau entre deux bornes fixes ne change
// pas, seul le trafic varie (appliqué APRÈS, en multipliant la durée).
const { cachedRouteSegment } = require('../../services/route-cache');
const { predictFillRate, getSchoolVacationStatus, getScoringConfig } = require('./predictions');
const fillFactors = require('../../utils/fill-factors');
const timeEngine = require('../../services/tour-time-engine');

// ══════════════════════════════════════════════════════════════
// ALGORITHME DE TOURNÉE INTELLIGENTE v3
// ──────────────────────────────────────────────────────────────
// v3 (août 2026) : les règles de TEMPS (journée de 6 h de travail, pause
// déjeuner au centre hors temps de travail, retours de vidage comptés en
// travail) sortent d'ici et vivent dans le moteur PUR
// `services/tour-time-engine.js`, partagé avec les modes standard / manuel /
// association (routes/tours/crud.js) et avec le calcul des ETA d'exécution
// (planned-passage.js). Une seule implémentation des règles → aucune
// divergence possible entre les modes de création.
//
// v3 ajoute aussi la GARDE DE SATURATION : les CAV dont le remplissage prédit
// atteint `saturationThresholdPct` sont servis EN PRIORITÉ (ils passent en tête
// de la liste candidate) ; ceux que la capacité ou le temps ne permettent pas
// d'inclure sont renvoyés dans `saturation_non_couverte` — le manque de
// couverture est explicite au lieu d'être silencieux.
// ══════════════════════════════════════════════════════════════

// Perf (item 3.D-4) : la prédiction de remplissage est calculée pour ~200 CAV.
// Elle était exécutée en ~200 `await` séquentiels (chemin HTTP synchrone : le
// manager attend). On borne la concurrence pour paralléliser sans saturer le pool
// PG (max 20). Le RÉSULTAT par CAV est inchangé (predictFillRate est déterministe
// et ne mute pas les données lues par ses voisins) ; seul l'ordonnancement change.
const PREDICT_CONCURRENCY = parseInt(process.env.TOUR_PREDICT_CONCURRENCY, 10) || 6;

// Remplissage retenu quand AUCUNE prédiction n'est disponible pour un CAV.
// Aligné sur le défaut de predictFillRate (« pas d'historique → 50 % »).
const DEFAULT_FILL_PCT = 50;

/** Nombre fini issu d'une valeur de config, sinon le défaut (NaN inclus). */
function numOr(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

// map à concurrence bornée qui PRÉSERVE l'ordre (results[i] ↔ items[i]).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Précharge en UNE requête les temps de collecte appris (moyenne des durées
// réelles) pour une liste de CAV — remplace l'appel getLearnedTimePerCav PAR CAV
// dans la boucle de routage (N+1 → 1). Sémantique identique à l'ancienne fonction :
// un temps n'est retenu que si ≥ 3 mesures valides (0 < durée < 3600 s), arrondi en
// minutes ; sinon le défaut est appliqué à la lecture (learnedTimeFor).
async function loadLearnedTimesPerCav(cavIds) {
  const map = new Map();
  const ids = [...new Set((cavIds || []).map((v) => parseInt(v, 10)).filter(Number.isFinite))];
  if (ids.length === 0) return map;
  try {
    const result = await pool.query(
      `SELECT cav_id, AVG(duration_seconds) AS avg_duration, COUNT(*) AS count
       FROM cav_collection_times
       WHERE cav_id = ANY($1) AND duration_seconds > 0 AND duration_seconds < 3600
       GROUP BY cav_id`,
      [ids]
    );
    for (const row of result.rows) {
      if (parseInt(row.count, 10) >= 3) {
        map.set(Number(row.cav_id), Math.round(parseFloat(row.avg_duration) / 60)); // s → min
      }
    }
  } catch (_) { /* table cav_collection_times absente (schéma ancien) → défauts partout */ }
  return map;
}

// Résout le temps de collecte d'un CAV depuis la map préchargée (fallback défaut).
// Retour identique à getLearnedTimePerCav(cavId, defaultTime).
function learnedTimeFor(map, cavId, defaultTime) {
  const v = map.get(Number(cavId));
  return v != null ? v : defaultTime;
}

/**
 * Poids estimé (kg) collecté sur un CAV = remplissage prédit × capacité du CAV
 * (nb conteneurs × 150 kg, source unique utils/fill-factors).
 *
 * C'est le modèle d'ACCUMULATION dimensionnellement correct (item 48) : le
 * remplissage prédit est lui-même construit à partir du poids moyen réel des
 * collectes passées, rapporté au nombre de jours écoulés et à la capacité.
 * Il remplace la lecture directe de `prediction.factors.avgWeight`, qui
 * ignorait le délai depuis la dernière collecte (un CAV relevé après 14 jours
 * au lieu de 7 pèse deux fois plus).
 *
 * @param {number|null} fillPct  remplissage prédit en % (0-120), null si inconnu
 * @param {number} nbContainers  nombre de conteneurs du CAV
 * @returns {number} poids estimé en kg
 */
function estimatedWeightKgFor(fillPct, nbContainers) {
  const capacity = fillFactors.getCapacityKg(nbContainers);
  const pct = Number.isFinite(parseFloat(fillPct)) ? parseFloat(fillPct) : DEFAULT_FILL_PCT;
  return Math.max(0, (pct / 100) * capacity);
}

/**
 * Fabrique la fonction `routeLeg` attendue par le moteur de temps : distances
 * routières OSRM (repli Haversine géré par geo.js), durée pondérée par le
 * facteur de trafic du jour.
 */
function makeRouteLeg(trafficFactor = 1) {
  const factor = Number.isFinite(parseFloat(trafficFactor)) && parseFloat(trafficFactor) > 0
    ? parseFloat(trafficFactor) : 1;
  return async (from, to) => {
    // Distance/durée « à vide » servies par le cache dès le 2e passage sur le
    // tronçon ; le facteur de circulation du jour est appliqué ensuite, il
    // n'est donc JAMAIS figé par le cache.
    const seg = await cachedRouteSegment(from.lat, from.lng, to.lat, to.lng);
    return { km: seg.distance_km, minutes: seg.duration_min * factor };
  };
}

/**
 * Ordre géographique optimisé (OSRM Trip, repli TSP local + 2-opt).
 * @returns {Promise<{ordered: Array, method: string}>}
 */
async function optimizeOrder(points) {
  if (!points || points.length <= 1) return { ordered: points || [], method: 'osrm_trip' };
  const osrmResult = await osrmOptimizedTrip(points, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
  if (osrmResult && osrmResult.orderedPoints) {
    return { ordered: osrmResult.orderedPoints, method: 'osrm_trip' };
  }
  let ordered = nearestNeighborTSP(points, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
  ordered = twoOptImprove(ordered, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
  return { ordered, method: 'haversine_tsp_2opt' };
}

/**
 * Options du moteur de temps déduites de la config prédictive + du véhicule.
 * Source UNIQUE des paramètres de journée : tout mode de création passe par ici.
 *
 * @param {object} vehicle véhicule (max_capacity_kg)
 * @param {object} [over]  surcharges ponctuelles (ex. startHour réel)
 */
function timeEngineOptions(vehicle, over = {}) {
  const cfg = getScoringConfig();
  const capacityKg = parseFloat(vehicle?.max_capacity_kg) || 0;
  return {
    center: { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG, name: 'Centre de tri' },
    maxWorkMinutes: numOr(cfg.maxDailyHours, 6) * 60,
    lunchBreakMinutes: numOr(cfg.lunchBreakMinutes, 30),
    lunchAfterMinutes: numOr(cfg.lunchAfterHours, 4) * 60,
    lunchStartHour: numOr(cfg.lunchStartHour, 12),
    startHour: numOr(cfg.workdayStartHour, 8),
    unloadMinutes: numOr(cfg.unloadMinutes, 15),
    capacityKg,
    returnThresholdKg: timeEngine.resolveReturnThresholdKg({
      returnEveryKg: cfg.returnEveryKg,
      vehicleFillReturnPct: cfg.vehicleFillReturnPct,
      capacityKg,
    }),
    ...over,
  };
}

/**
 * Remplissage prédit du jour pour une liste de CAV, en 2 temps :
 *  1. lecture en UNE requête des prédictions déjà calculées par le job
 *     quotidien (`ml_fill_predictions`) — chemin normal, très peu coûteux ;
 *  2. calcul heuristique `predictFillRate` pour les seuls CAV manquants
 *     (concurrence bornée), chaque échec dégradant à `null` sans casser
 *     l'estimation (« best effort », doctrine soft du dépôt).
 *
 * @returns {Promise<Map<number, {fill:number|null, source:string}>>}
 */
async function loadPredictedFills(cavIds, dateStr) {
  const map = new Map();
  const ids = [...new Set((cavIds || []).map((v) => parseInt(v, 10)).filter(Number.isFinite))];
  if (ids.length === 0) return map;

  try {
    const r = await pool.query(
      `SELECT cav_id, predicted_fill_rate FROM ml_fill_predictions
        WHERE cav_id = ANY($1) AND predicted_date = $2`,
      [ids, dateStr]
    );
    for (const row of r.rows) {
      const fill = parseFloat(row.predicted_fill_rate);
      if (Number.isFinite(fill)) map.set(Number(row.cav_id), { fill, source: 'prediction' });
    }
  } catch (err) {
    console.warn('[SMART-TOUR] Lecture ml_fill_predictions ignorée :', err.message);
  }

  const missing = ids.filter((id) => !map.has(id));
  if (missing.length > 0) {
    const preds = await mapWithConcurrency(missing, PREDICT_CONCURRENCY, async (id) => {
      try { return await predictFillRate(id, dateStr); } catch (_) { return null; }
    });
    missing.forEach((id, i) => {
      const fill = preds[i] && Number.isFinite(parseFloat(preds[i].fill)) ? parseFloat(preds[i].fill) : null;
      map.set(id, { fill, source: fill != null ? 'heuristique' : 'inconnue' });
    });
  }
  return map;
}

/**
 * Estimation d'une tournée dont la LISTE DE POINTS EST FIXE — modes standard,
 * manuel, association et simulation `POST /tours/estimate`. Applique EXACTEMENT
 * les mêmes règles de journée que le mode intelligent (moteur partagé).
 *
 * @param {object} p
 * @param {object} p.vehicle  véhicule (max_capacity_kg)
 * @param {Array}  p.points   points ORDONNÉS : {id, type:'cav'|'association',
 *                            name, latitude, longitude, nb_containers}
 * @param {string} p.date     date de la tournée (YYYY-MM-DD)
 * @param {boolean} [p.optimize] réordonner géographiquement avant estimation
 * @returns {Promise<{estimation:object, ordre_optimise:number[]|null, points:Array}>}
 *          `points` = les points dans l'ordre finalement estimé, enrichis du
 *          remplissage prédit `_fill` (écrit dans tour_cav.predicted_fill_rate)
 *          et du poids retenu `_weightKg`.
 */
async function estimateFixedRoute({ vehicle, points, date, optimize = false }) {
  const cfg = getScoringConfig();
  const dateStr = typeof date === 'string' && date
    ? date.slice(0, 10)
    : new Date(date || Date.now()).toISOString().split('T')[0];
  const warnings = [];

  const rows = (points || []).map((p) => ({
    ...p,
    id: p.id,
    type: p.type === 'association' ? 'association' : 'cav',
    latitude: p.latitude != null ? parseFloat(p.latitude) : null,
    longitude: p.longitude != null ? parseFloat(p.longitude) : null,
  }));

  const cavIds = rows.filter((p) => p.type === 'cav').map((p) => p.id);
  const [fills, learnedTimes] = await Promise.all([
    loadPredictedFills(cavIds, dateStr),
    loadLearnedTimesPerCav(cavIds),
  ]);

  const nbSansPrediction = cavIds.filter((id) => (fills.get(Number(id))?.fill ?? null) == null).length;
  if (nbSansPrediction > 0) {
    warnings.push(
      `${nbSansPrediction} CAV sans prédiction de remplissage — poids estimé au défaut de `
      + `${DEFAULT_FILL_PCT} % de la capacité.`
    );
  }
  const nbAssociation = rows.filter((p) => p.type === 'association').length;
  if (nbAssociation > 0) {
    warnings.push(
      `${nbAssociation} point(s) association : poids non estimé (aucun historique de remplissage `
      + 'exploitable) — les retours de vidage ne sont pas anticipés pour ces points.'
    );
  }

  const defaultService = numOr(cfg.timePerCav, 10);
  const enriched = rows.map((p) => ({
    ...p,
    _weightKg: p.type === 'cav'
      ? estimatedWeightKgFor(fills.get(Number(p.id))?.fill ?? null, p.nb_containers)
      : 0,
    _serviceMinutes: p.type === 'cav'
      ? learnedTimeFor(learnedTimes, p.id, defaultService)
      : defaultService,
    _fill: p.type === 'cav' ? (fills.get(Number(p.id))?.fill ?? null) : null,
  }));

  let ordered = enriched;
  let ordreOptimise = null;
  if (optimize && enriched.length > 1) {
    const { ordered: opt } = await optimizeOrder(enriched);
    ordered = opt;
    ordreOptimise = opt.map((p) => p.id);
  }

  let trafficFactor = 1;
  try {
    const context = await getContextForDate(dateStr);
    trafficFactor = parseFloat(context?.trafficFactor) || 1;
  } catch (_) { /* contexte indisponible → facteur neutre */ }

  const estimation = await timeEngine.buildTimeline(
    ordered.map((p) => ({
      id: p.id,
      type: p.type,
      name: p.name,
      lat: p.latitude,
      lng: p.longitude,
      serviceMinutes: p._serviceMinutes,
      weightKg: p._weightKg,
    })),
    { ...timeEngineOptions(vehicle), routeLeg: makeRouteLeg(trafficFactor) }
  );
  estimation.avertissements = [...estimation.avertissements, ...warnings];

  return { estimation, ordre_optimise: ordreOptimise, points: ordered };
}

async function generateIntelligentTour(vehicleId, date) {
  const SCORING_CONFIG = getScoringConfig();

  // 1. Récupérer le véhicule
  const vResult = await pool.query('SELECT id, registration, name, max_capacity_kg, team_id, status, current_km FROM vehicles WHERE id = $1', [vehicleId]);
  if (vResult.rows.length === 0) throw new Error('Véhicule non trouvé');
  const vehicle = vResult.rows[0];

  // 1b. Vérifier que le véhicule n'est pas déjà affecté à une tournée association ce jour
  const assoTourCheck = await pool.query(
    `SELECT id FROM tours WHERE vehicle_id = $1 AND date = $2 AND collection_type = 'association' AND status != 'cancelled'`,
    [vehicleId, date]
  );
  if (assoTourCheck.rows.length > 0) {
    throw new Error('Ce véhicule est déjà affecté à une tournée association ce jour. On ne peut pas mélanger collecte PAV et association.');
  }

  // 2. Récupérer tous les CAV actifs (uniquement PAV, pas les associations)
  const cavResult = await pool.query("SELECT id, name, address, commune, latitude, longitude, nb_containers, status FROM cav WHERE status = 'active' ORDER BY name");
  const allCavs = cavResult.rows;
  if (allCavs.length === 0) throw new Error('Aucun CAV actif trouvé. Ajoutez des CAV avant de créer une tournée.');

  // 3. Prédire le remplissage pour chaque CAV.
  //    Perf (item 3.D-4) : (a) pré-chauffe du contexte du jour UNE fois — la même
  //    date sert à tous les CAV, donc getContextForDate n'appelle Open-Meteo qu'une
  //    fois et écrit la ligne collection_context ; les predictFillRate suivants la
  //    relisent (et voient tous la même météo → déterminisme). (b) prédictions à
  //    concurrence bornée au lieu de ~200 await séquentiels. L'ordre est préservé
  //    (predictions[i] ↔ allCavs[i]) → scores/tri/tournée strictement identiques.
  const dateStr = typeof date === 'string' ? date.slice(0, 10) : new Date(date).toISOString().split('T')[0];
  await getContextForDate(dateStr).catch(() => {});
  const predictions = await mapWithConcurrency(allCavs, PREDICT_CONCURRENCY, (cav) => predictFillRate(cav.id, date));
  const cavWithPredictions = allCavs.map((cav, i) => ({ ...cav, prediction: predictions[i] }));

  // 4. Calculer le score de priorité
  const scoredCavs = cavWithPredictions.map(cav => {
    const fill = cav.prediction.fill;
    let score = 0;

    // Score basé sur le remplissage
    if (fill >= 100) score += 50;
    else if (fill >= 80) score += 35;
    else if (fill >= 60) score += 20;
    else if (fill >= 40) score += 10;
    else score += 2;

    // Bonus : jours depuis dernière collecte
    score += (cav.prediction.factors?.daysSinceCollection || 0) * 1.5;

    // Bonus : nombre de conteneurs (priorité aux grands sites)
    score += (cav.nb_containers || 1) * 3;

    // Bonus confiance
    score *= cav.prediction.confidence;

    return {
      ...cav,
      score: Math.round(score * 10) / 10,
      // Poids estimé = remplissage prédit × capacité du CAV (modèle d'accumulation)
      estimatedWeightKg: estimatedWeightKgFor(cav.prediction.fill, cav.nb_containers),
    };
  });

  // 5. Trier par score décroissant
  scoredCavs.sort((a, b) => b.score - a.score);

  // 5b. ── GARDE DE SATURATION (exigence client) ─────────────────────────────
  // Aucun CAV ne doit dépasser son seuil de saturation sans qu'une rotation le
  // vide : les CAV dont le remplissage prédit atteint le seuil sont traités
  // comme OBLIGATOIRES et passent en tête de la liste candidate (le plus saturé
  // d'abord). Ceux qui ne peuvent pas être servis (capacité du véhicule ou
  // budget de temps) ressortent dans `saturation_non_couverte`.
  const saturationThresholdPct = numOr(SCORING_CONFIG.saturationThresholdPct, 90);
  const obligatoires = scoredCavs
    .filter((c) => (c.prediction?.fill ?? 0) >= saturationThresholdPct)
    .sort((a, b) => (b.prediction.fill - a.prediction.fill) || (b.score - a.score));
  const obligatoireIds = new Set(obligatoires.map((c) => c.id));
  const autres = scoredCavs.filter((c) => !obligatoireIds.has(c.id));

  // 6. Sélectionner les CAV avec contrainte capacité véhicule (obligatoires d'abord)
  const maxCapacity = vehicle.max_capacity_kg * 0.95;
  const maxDailyMinutes = numOr(SCORING_CONFIG.maxDailyHours, 6) * 60;
  const returnThresholdKg = timeEngine.resolveReturnThresholdKg({
    returnEveryKg: SCORING_CONFIG.returnEveryKg,
    vehicleFillReturnPct: SCORING_CONFIG.vehicleFillReturnPct,
    capacityKg: parseFloat(vehicle.max_capacity_kg) || 0,
  });
  const lunchBreakMinutes = numOr(SCORING_CONFIG.lunchBreakMinutes, 30);

  const nonCouverts = [];
  const pickWithinCapacity = (list, state) => {
    const kept = [];
    for (const cav of list) {
      if (state.weight + cav.estimatedWeightKg <= maxCapacity) {
        kept.push(cav);
        state.weight += cav.estimatedWeightKg;
      } else if (obligatoireIds.has(cav.id)) {
        nonCouverts.push(cav);
      }
    }
    return kept;
  };
  const capacityState = { weight: 0 };
  const keptObligatoires = pickWithinCapacity(obligatoires, capacityState);
  const keptAutres = pickWithinCapacity(autres, capacityState);
  const selectedCavs = [...keptObligatoires, ...keptAutres];

  if (selectedCavs.length === 0) throw new Error('Aucun CAV sélectionné — vérifiez la capacité du véhicule et les données de remplissage.');

  // Perf (item 3.D-4) : précharger EN UNE requête les temps de collecte appris des
  // CAV retenus (au lieu d'1 requête cav_collection_times par CAV dans la boucle de
  // routage ci-dessous). Résultat identique via learnedTimeFor (fallback défaut).
  const learnedTimes = await loadLearnedTimesPerCav(selectedCavs.map((c) => c.id));
  const defaultService = numOr(SCORING_CONFIG.timePerCav, 10);
  for (const cav of selectedCavs) {
    cav._learnedTimePerCav = learnedTimeFor(learnedTimes, cav.id, defaultService);
  }

  // 7. Optimiser la route via OSRM (ou fallback TSP local). Les obligatoires et
  //    les autres sont optimisés SÉPARÉMENT puis concaténés : la sélection
  //    gloutonne sous budget (étape 8) sert ainsi les CAV saturés en premier.
  const optObl = await optimizeOrder(keptObligatoires);
  const optAutres = await optimizeOrder(keptAutres);
  const routingMethod = (optObl.method === 'osrm_trip' && optAutres.method === 'osrm_trip')
    ? 'osrm_trip' : 'haversine_tsp_2opt';
  const candidateOrder = [...optObl.ordered, ...optAutres.ordered];

  // 8. Contraintes de journée (moteur partagé) : 6 h de travail max, pause
  //    déjeuner au centre hors temps de travail, retours de vidage comptés.
  // dateStr est déjà résolu à l'étape 3 (pré-chauffe du contexte).
  const context = await getContextForDate(dateStr);
  const engineOpts = {
    ...timeEngineOptions(vehicle),
    routeLeg: makeRouteLeg(context?.trafficFactor),
  };
  const toEnginePoint = (cav) => ({
    id: cav.id,
    type: 'cav',
    name: cav.name,
    lat: cav.latitude,
    lng: cav.longitude,
    serviceMinutes: cav._learnedTimePerCav,
    weightKg: cav.estimatedWeightKg,
  });

  // planWithBudget travaille sur la projection « point moteur » ; les CAV
  // d'origine se retrouvent ensuite par identifiant.
  const enginePoints = candidateOrder.map(toEnginePoint);
  const planned = await timeEngine.planWithBudget(enginePoints, engineOpts);
  const selectedIds = new Set(planned.selected.map((p) => p.id));
  let optimizedRoute = candidateOrder.filter((c) => selectedIds.has(c.id));
  let estimation = planned.estimation;

  if (optimizedRoute.length === 0) {
    throw new Error(
      'Aucun CAV ne tient dans le budget de temps de travail (points trop éloignés du centre ou budget trop court) — aucune tournée créée.'
    );
  }

  // Les CAV saturés écartés par le budget de temps rejoignent les non couverts.
  for (const rejected of planned.rejected) {
    const cav = candidateOrder.find((c) => c.id === rejected.id);
    if (cav && obligatoireIds.has(cav.id)) nonCouverts.push(cav);
  }

  // 8b. Ré-optimisation géographique de la SÉLECTION finale (les obligatoires
  //     ont fait valoir leur priorité, l'ordre peut redevenir purement
  //     géographique). On ne la retient que si elle tient dans le budget.
  if (optimizedRoute.length > 1 && keptObligatoires.length > 0) {
    const { ordered: reordered } = await optimizeOrder(optimizedRoute);
    const rebuilt = await timeEngine.buildTimeline(reordered.map(toEnginePoint), engineOpts);
    if (rebuilt.depassement_min === 0) {
      optimizedRoute = reordered;
      estimation = rebuilt;
    }
  }

  // Compté sur la tournée RÉELLEMENT retenue (après la coupe de budget) et non
  // sur la présélection : le chiffre affiché correspond à ce qui sera collecté.
  const urgentCount = optimizedRoute.filter((c) => (c.prediction?.fill ?? 0) >= 80).length;

  const totalDistance = estimation.distance_km;
  const estimatedDuration = estimation.duree_travail_min;
  const estimatedWeight = estimation.poids_estime_kg;
  const nbRetours = estimation.nb_retours_vidage;
  const lunchTaken = estimation.pause_dejeuner_incluse;

  const saturationNonCouverte = [...new Map(
    nonCouverts.map((c) => [c.id, {
      cav_id: c.id,
      name: c.name,
      commune: c.commune || null,
      predicted_fill_rate: c.prediction?.fill ?? null,
    }])
  ).values()].sort((a, b) => (b.predicted_fill_rate ?? 0) - (a.predicted_fill_rate ?? 0));

  if (saturationNonCouverte.length > 0) {
    estimation.avertissements.push(
      `${saturationNonCouverte.length} CAV au-delà du seuil de saturation (${saturationThresholdPct} %) `
      + 'ne peuvent pas être servis par cette tournée — planifiez une rotation complémentaire.'
    );
  }

  // 9. Récupérer événements locaux pour l'explication
  const localEvents = await getLocalEventsForDate(dateStr);

  // 10. Générer l'explication
  const vacationStatus = getSchoolVacationStatus(dateStr);
  const explanation = generateAIExplanation({
    route: optimizedRoute,
    distance: totalDistance,
    duration: estimatedDuration,
    weight: estimatedWeight,
    urgentCount,
    vehicle,
    context,
    localEvents,
    vacationStatus,
    routingMethod,
    lunchTaken,
    nbRetours,
    lunchBreakMinutes,
    estimation,
    saturationNonCouverte,
    saturationThresholdPct,
  });

  return {
    vehicle,
    cavList: optimizedRoute.map((cav, idx) => ({
      cav_id: cav.id,
      name: cav.name,
      address: cav.address,
      commune: cav.commune,
      latitude: cav.latitude,
      longitude: cav.longitude,
      position: idx + 1,
      predicted_fill: cav.prediction.fill,
      confidence: cav.prediction.confidence,
      score: cav.score,
      estimated_weight: Math.round(cav.estimatedWeightKg),
      nb_containers: cav.nb_containers,
      learned_time_min: cav._learnedTimePerCav,
    })),
    stats: {
      totalCavs: optimizedRoute.length,
      totalDistance: Math.round(totalDistance * 10) / 10,
      estimatedDuration,
      estimatedWeight: Math.round(estimatedWeight),
      maxCapacity: vehicle.max_capacity_kg,
      fillRate: vehicle.max_capacity_kg > 0
        ? Math.round((estimatedWeight / vehicle.max_capacity_kg) * 100) : 0,
      urgentCavs: urgentCount,
      nbRetourscentre: nbRetours,
      maxDailyHours: numOr(SCORING_CONFIG.maxDailyHours, 6),
      returnEveryKg: Number.isFinite(returnThresholdKg) ? returnThresholdKg : null,
      routingMethod,
      lunchBreakIncluded: lunchTaken,
      // Ajouts v3 (additifs — le frontend existant n'en dépend pas)
      totalDurationWithBreak: estimation.duree_totale_min,
      lunchBreakMinutes: estimation.pause_dejeuner_min,
      budgetTravailMin: estimation.budget_travail_min,
      saturationThresholdPct,
      maxDailyMinutes,
    },
    estimation,
    saturation_non_couverte: saturationNonCouverte,
    explanation,
  };
}

function generateAIExplanation(opts) {
  const {
    route, distance, duration, weight, urgentCount, vehicle, context, localEvents,
    vacationStatus, routingMethod, lunchTaken, nbRetours, lunchBreakMinutes,
    estimation = null, saturationNonCouverte = [], saturationThresholdPct = 90,
  } = opts || {};
  const SCORING_CONFIG = getScoringConfig();
  const maxDailyHours = numOr(SCORING_CONFIG.maxDailyHours, 6);
  const lines = [];
  lines.push(`Tournée intelligente générée pour ${vehicle.name || vehicle.registration}`);
  lines.push(`\n${route.length} points de collecte sélectionnés parmi les CAV actifs`);
  lines.push(`Distance totale estimée : ${Math.round(distance * 10) / 10} km (distances routières ${routingMethod === 'osrm_trip' ? 'OSRM' : 'Haversine'})`);

  const durH = Math.floor(duration / 60);
  const durM = String(duration % 60).padStart(2, '0');
  lines.push(`Temps de travail estimé : ${durH}h${durM} (maximum ${maxDailyHours}h/jour — pause déjeuner NON comprise)`);
  if (estimation) {
    lines.push(`Amplitude : ${estimation.heure_depart} → ${estimation.heure_fin_estimee} (pause incluse)`);
  }
  lines.push(`Poids estimé : ${Math.round(weight)} kg / ${vehicle.max_capacity_kg} kg (${vehicle.max_capacity_kg > 0 ? Math.round(weight / vehicle.max_capacity_kg * 100) : 0}%)`);
  const seuilVidage = timeEngine.resolveReturnThresholdKg({
    returnEveryKg: SCORING_CONFIG.returnEveryKg,
    vehicleFillReturnPct: SCORING_CONFIG.vehicleFillReturnPct,
    capacityKg: parseFloat(vehicle.max_capacity_kg) || 0,
  });
  lines.push(`Retours centre de tri pour vidage : ${nbRetours}`
    + `${Number.isFinite(seuilVidage) ? ` (seuil ${Math.round(seuilVidage / 100) / 10}t, déchargement compté dans le temps de travail)` : ''}`);

  if (lunchTaken) {
    lines.push(`\n🍽️ Pause déjeuner au centre de tri : ${lunchBreakMinutes} min, HORS temps de travail `
      + `(déclenchée après ${SCORING_CONFIG.lunchAfterHours || 4}h de travail ou à ${SCORING_CONFIG.lunchStartHour || 12}h). `
      + 'Les trajets aller/retour, eux, sont comptés.');
  }

  if (urgentCount > 0) {
    lines.push(`\n⚠️ ${urgentCount} CAV urgents (remplissage >= 80%)`);
  }

  if (saturationNonCouverte.length > 0) {
    lines.push(`\n🚨 ${saturationNonCouverte.length} CAV au-delà du seuil de saturation (${saturationThresholdPct}%) NON couverts par cette tournée :`);
    saturationNonCouverte.slice(0, 5).forEach((c) => {
      lines.push(`  • ${c.name}${c.commune ? ` (${c.commune})` : ''} — ${Math.round(c.predicted_fill_rate ?? 0)}%`);
    });
    if (saturationNonCouverte.length > 5) lines.push(`  • … et ${saturationNonCouverte.length - 5} autre(s)`);
  }

  // Routing method
  lines.push(`\n🗺️ Méthode de routage : ${routingMethod === 'osrm_trip' ? 'OSRM (distances routières réelles + optimisation TSP)' : 'Haversine + TSP nearest neighbor + 2-opt (fallback)'}`);

  // Météo
  if (context && context.weatherLabel) {
    let weatherLine = `\n🌤️ Météo : ${context.weatherLabel}`;
    if (context.tempMax != null) weatherLine += ` (${context.tempMax}°C)`;
    weatherLine += ` — facteur x${context.weatherFactor}`;
    lines.push(weatherLine);
  }

  // Vacances scolaires
  if (vacationStatus && vacationStatus.status) {
    const labels = { pre: 'Semaine pré-vacances', during: 'Pendant les vacances', post: 'Semaine post-vacances' };
    const bonusValues = { pre: SCORING_CONFIG.preVacationBonus, during: SCORING_CONFIG.schoolVacationFactor || SCORING_CONFIG.schoolVacationBonus, post: SCORING_CONFIG.postVacationBonus };
    lines.push(`\n🎒 ${labels[vacationStatus.status]} (${vacationStatus.name}) — facteur x${bonusValues[vacationStatus.status]}`);
  }

  // Événements locaux
  if (localEvents && localEvents.length > 0) {
    lines.push(`\n📍 ${localEvents.length} événement(s) local(aux) actif(s) :`);
    localEvents.forEach(evt => {
      lines.push(`  • ${evt.nom} (${evt.commune || 'N/A'}) — rayon ${evt.rayon_km} km, bonus x${evt.bonus_factor}`);
    });
  }

  lines.push(`\n🔬 Prédiction : historique 180j + saisonnalité + météo + vacances scolaires + événements locaux + tendance + feedback ML V2`);

  const topCavs = route.slice(0, 3);
  if (topCavs.length > 0) {
    lines.push(`\n🏆 Priorités :`);
    topCavs.forEach((cav, i) => {
      let detail = `  ${i + 1}. ${cav.name} — remplissage estimé ${cav.prediction.fill}% (confiance ${Math.round(cav.prediction.confidence * 100)}%)`;
      if (cav._learnedTimePerCav && cav._learnedTimePerCav !== (SCORING_CONFIG.timePerCav || 10)) {
        detail += ` ⏱️${cav._learnedTimePerCav}min`;
      }
      if (cav.prediction.contextUsed?.weekendSunny) detail += ' ☀️';
      if (cav.prediction.contextUsed?.eventBonus) detail += ` 📍x${cav.prediction.contextUsed.eventBonus}`;
      if (cav.prediction.contextUsed?.vacationStatus) detail += ` 🎒`;
      lines.push(detail);
    });
  }

  return lines.join('\n');
}

/**
 * Récapitulatif français court d'une estimation, stocké dans
 * `tours.ai_explanation` pour les modes standard / manuel / association.
 */
function estimationSummary(estimation, { mode, vehicle, forced = false } = {}) {
  const lines = [];
  const labels = { standard: 'modèle de tournée', manual: 'saisie manuelle', association: 'points association' };
  lines.push(`Tournée créée (${labels[mode] || mode}) pour ${vehicle?.name || vehicle?.registration || 'véhicule'}`);
  const h = Math.floor(estimation.duree_travail_min / 60);
  const m = String(estimation.duree_travail_min % 60).padStart(2, '0');
  lines.push(`${estimation.nb_points} point(s) · ${estimation.distance_km} km · temps de travail ${h}h${m} `
    + `(budget ${Math.round(estimation.budget_travail_min / 60 * 10) / 10}h, pause déjeuner exclue)`);
  lines.push(`Amplitude ${estimation.heure_depart} → ${estimation.heure_fin_estimee}`
    + (estimation.pause_dejeuner_incluse ? ` · pause déjeuner ${estimation.pause_dejeuner_min} min au centre de tri` : ' · pas de pause déjeuner'));
  lines.push(`Poids estimé ${estimation.poids_estime_kg} kg · ${estimation.nb_retours_vidage} retour(s) de vidage`);
  if (forced) {
    lines.push(`⚠ créée malgré un dépassement de ${estimation.depassement_min} min (forcé)`);
  }
  for (const a of estimation.avertissements) lines.push(`• ${a}`);
  return lines.join('\n');
}

module.exports = {
  generateIntelligentTour,
  generateAIExplanation,
  estimateFixedRoute,
  estimationSummary,
  estimatedWeightKgFor,
  loadPredictedFills,
  loadLearnedTimesPerCav,
  learnedTimeFor,
  timeEngineOptions,
  makeRouteLeg,
  optimizeOrder,
  DEFAULT_FILL_PCT,
};

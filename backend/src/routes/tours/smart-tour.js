const pool = require('../../config/database');
const { CENTRE_TRI_LAT, CENTRE_TRI_LNG, getContextForDate, getLocalEventsForDate } = require('./context');
const { haversineDistance, nearestNeighborTSP, twoOptImprove, osrmRouteSegment, osrmOptimizedTrip } = require('./geo');
const { predictFillRate, getSchoolVacationStatus, getScoringConfig } = require('./predictions');

// ══════════════════════════════════════════════════════════════
// ALGORITHME DE TOURNÉE INTELLIGENTE v2
// ══════════════════════════════════════════════════════════════

// Perf (item 3.D-4) : la prédiction de remplissage est calculée pour ~200 CAV.
// Elle était exécutée en ~200 `await` séquentiels (chemin HTTP synchrone : le
// manager attend). On borne la concurrence pour paralléliser sans saturer le pool
// PG (max 20). Le RÉSULTAT par CAV est inchangé (predictFillRate est déterministe
// et ne mute pas les données lues par ses voisins) ; seul l'ordonnancement change.
const PREDICT_CONCURRENCY = parseInt(process.env.TOUR_PREDICT_CONCURRENCY, 10) || 6;

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
  const dateStr = typeof date === 'string' ? date : new Date(date).toISOString().split('T')[0];
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

    return { ...cav, score: Math.round(score * 10) / 10 };
  });

  // 5. Trier par score décroissant
  scoredCavs.sort((a, b) => b.score - a.score);

  // 6. Sélectionner les CAV avec contrainte capacité véhicule
  const maxCapacity = vehicle.max_capacity_kg * 0.95;
  const maxDailyMinutes = (SCORING_CONFIG.maxDailyHours || 7) * 60;
  const returnThresholdKg = SCORING_CONFIG.returnEveryKg || 2000;
  const lunchBreakMinutes = SCORING_CONFIG.lunchBreakMinutes || 30;
  const lunchAfterHours = SCORING_CONFIG.lunchAfterHours || 4;
  let estimatedWeight = 0;
  const selectedCavs = [];
  let urgentCount = 0;

  for (const cav of scoredCavs) {
    const estimatedCavWeight = cav.prediction.factors?.avgWeight || 50;
    if (estimatedWeight + estimatedCavWeight <= maxCapacity) {
      selectedCavs.push(cav);
      estimatedWeight += estimatedCavWeight;
      if (cav.prediction.fill >= 80) urgentCount++;
    }
    if (estimatedWeight >= maxCapacity) break;
  }

  if (selectedCavs.length === 0) throw new Error('Aucun CAV sélectionné — vérifiez la capacité du véhicule et les données de remplissage.');

  // Perf (item 3.D-4) : précharger EN UNE requête les temps de collecte appris des
  // CAV retenus (au lieu d'1 requête cav_collection_times par CAV dans la boucle de
  // routage ci-dessous). Résultat identique via learnedTimeFor (fallback défaut).
  const learnedTimes = await loadLearnedTimesPerCav(selectedCavs.map((c) => c.id));

  // 7. Optimiser la route via OSRM (ou fallback TSP local)
  let optimizedRoute;
  let routingMethod = 'osrm_trip';

  const osrmResult = await osrmOptimizedTrip(selectedCavs, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
  if (osrmResult && osrmResult.orderedPoints) {
    optimizedRoute = osrmResult.orderedPoints;
  } else {
    // Fallback : TSP nearest neighbor + 2-opt (Haversine)
    routingMethod = 'haversine_tsp_2opt';
    optimizedRoute = nearestNeighborTSP(selectedCavs, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
    optimizedRoute = twoOptImprove(optimizedRoute, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
  }

  // 8. Calculer distance et durée avec :
  //    - OSRM pour les segments (distances réelles par la route)
  //    - Retours intermédiaires au centre toutes les 2t
  //    - Pause déjeuner après 4h de travail
  // dateStr est déjà résolu à l'étape 3 (pré-chauffe du contexte).
  const context = await getContextForDate(dateStr);

  let totalDistance = 0;
  let totalDuration = 0;
  let currentLoad = 0;
  let nbRetours = 0;
  let lunchTaken = false;
  let lastLat = CENTRE_TRI_LAT, lastLng = CENTRE_TRI_LNG;
  const routeWithReturns = [];

  for (let i = 0; i < optimizedRoute.length; i++) {
    const cav = optimizedRoute[i];
    const cavWeight = cav.prediction?.factors?.avgWeight || 50;

    // ── Pause déjeuner : après lunchAfterHours heures de travail ──
    if (!lunchTaken && totalDuration >= lunchAfterHours * 60) {
      // Retour au centre pour le déjeuner
      const lunchReturn = await osrmRouteSegment(lastLat, lastLng, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
      totalDistance += lunchReturn.distance_km;
      totalDuration += lunchReturn.duration_min + lunchBreakMinutes;
      // Repartir du centre après le déjeuner
      lastLat = CENTRE_TRI_LAT;
      lastLng = CENTRE_TRI_LNG;
      lunchTaken = true;
      routeWithReturns.push({ type: 'pause_dejeuner', after_cav_index: i - 1, duration_min: lunchBreakMinutes });
      // Si on a aussi de la charge, on décharge en même temps
      if (currentLoad > 0) {
        totalDuration += 15; // déchargement pendant la pause
        currentLoad = 0;
        nbRetours++;
      }
    }

    // ── Vérifier si retour centre nécessaire (seuil 2t) ──
    if (currentLoad + cavWeight > returnThresholdKg && currentLoad > 0) {
      const retour = await osrmRouteSegment(lastLat, lastLng, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
      totalDistance += retour.distance_km;
      totalDuration += retour.duration_min + 15; // 15min déchargement
      lastLat = CENTRE_TRI_LAT;
      lastLng = CENTRE_TRI_LNG;
      currentLoad = 0;
      nbRetours++;
      routeWithReturns.push({ type: 'retour_centre', after_cav_index: i - 1 });
    }

    // ── Aller au CAV (OSRM distance réelle) ──
    const segment = await osrmRouteSegment(lastLat, lastLng, cav.latitude, cav.longitude);
    const timePerCav = learnedTimeFor(learnedTimes, cav.id, SCORING_CONFIG.timePerCav || 10);

    totalDistance += segment.distance_km;
    totalDuration += segment.duration_min + timePerCav;
    currentLoad += cavWeight;
    lastLat = cav.latitude;
    lastLng = cav.longitude;

    // Stocker le temps de collecte appris pour l'explication
    cav._learnedTimePerCav = timePerCav;

    // ── Vérifier contrainte durée max (7h + pause déjeuner) ──
    const returnSegment = await osrmRouteSegment(lastLat, lastLng, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
    const totalWithReturn = totalDuration + returnSegment.duration_min;
    // Budget total = heures de travail + pause déjeuner (la pause ne compte pas dans le travail productif)
    const totalBudget = maxDailyMinutes + (lunchTaken ? lunchBreakMinutes : 0);
    if (totalWithReturn > totalBudget) {
      optimizedRoute = optimizedRoute.slice(0, i + 1);
      estimatedWeight = optimizedRoute.reduce((s, c) => s + (c.prediction?.factors?.avgWeight || 50), 0);
      break;
    }
  }

  // Retour final au centre
  const retourFinal = await osrmRouteSegment(lastLat, lastLng, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
  totalDistance += retourFinal.distance_km;
  totalDuration += retourFinal.duration_min;

  // Appliquer les facteurs de contexte (trafic, météo)
  const estimatedDuration = Math.round(totalDuration * context.trafficFactor);

  // 9. Récupérer événements locaux pour l'explication
  const localEvents = await getLocalEventsForDate(dateStr);

  // 10. Générer l'explication
  const vacationStatus = getSchoolVacationStatus(dateStr);
  const explanation = generateAIExplanation(optimizedRoute, totalDistance, estimatedDuration, estimatedWeight, urgentCount, vehicle, context, localEvents, vacationStatus, routingMethod, lunchTaken, nbRetours, lunchBreakMinutes);

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
      estimated_weight: cav.prediction.factors?.avgWeight || 50,
      nb_containers: cav.nb_containers,
      learned_time_min: cav._learnedTimePerCav,
    })),
    stats: {
      totalCavs: optimizedRoute.length,
      totalDistance: Math.round(totalDistance * 10) / 10,
      estimatedDuration,
      estimatedWeight: Math.round(estimatedWeight),
      maxCapacity: vehicle.max_capacity_kg,
      fillRate: Math.round((estimatedWeight / vehicle.max_capacity_kg) * 100),
      urgentCavs: urgentCount,
      nbRetourscentre: nbRetours,
      maxDailyHours: SCORING_CONFIG.maxDailyHours || 7,
      returnEveryKg: returnThresholdKg,
      routingMethod,
      lunchBreakIncluded: lunchTaken,
    },
    explanation,
  };
}

function generateAIExplanation(route, distance, duration, weight, urgentCount, vehicle, context, localEvents, vacationStatus, routingMethod, lunchTaken, nbRetours, lunchBreakMinutes) {
  const SCORING_CONFIG = getScoringConfig();
  const lines = [];
  lines.push(`Tournée intelligente générée pour ${vehicle.name || vehicle.registration}`);
  lines.push(`\n${route.length} points de collecte sélectionnés parmi les CAV actifs`);
  lines.push(`Distance totale estimée : ${Math.round(distance * 10) / 10} km (distances routières ${routingMethod === 'osrm_trip' ? 'OSRM' : 'Haversine'})`);

  const durH = Math.floor(duration / 60);
  const durM = String(duration % 60).padStart(2, '0');
  lines.push(`Durée estimée : ${durH}h${durM} (max ${SCORING_CONFIG.maxDailyHours || 7}h/jour + pause déjeuner)`);
  lines.push(`Poids estimé : ${Math.round(weight)} kg / ${vehicle.max_capacity_kg} kg (${Math.round(weight / vehicle.max_capacity_kg * 100)}%)`);
  lines.push(`Retours centre de tri : ${nbRetours} (seuil ${(SCORING_CONFIG.returnEveryKg || 2000) / 1000}t)`);

  if (lunchTaken) {
    lines.push(`\n🍽️ Pause déjeuner : ${lunchBreakMinutes} min (retour centre après ${SCORING_CONFIG.lunchAfterHours || 4}h)`);
  }

  if (urgentCount > 0) {
    lines.push(`\n⚠️ ${urgentCount} CAV urgents (remplissage >= 80%)`);
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

module.exports = {
  generateIntelligentTour,
  generateAIExplanation,
};

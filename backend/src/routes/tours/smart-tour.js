const pool = require('../../config/database');
const { CENTRE_TRI_LAT, CENTRE_TRI_LNG, getContextForDate, getLocalEventsForDate } = require('./context');
const { haversineDistance, nearestNeighborTSP, twoOptImprove, osrmRouteSegment, osrmOptimizedTrip } = require('./geo');
const { predictFillRate, getSchoolVacationStatus, getScoringConfig } = require('./predictions');

// ══════════════════════════════════════════════════════════════
// ALGORITHME DE TOURNÉE INTELLIGENTE v2
// ══════════════════════════════════════════════════════════════

// Récupérer le temps moyen de collecte appris pour un CAV
async function getLearnedTimePerCav(cavId, defaultTime) {
  try {
    const result = await pool.query(
      `SELECT AVG(duration_seconds) as avg_duration, COUNT(*) as count
       FROM cav_collection_times
       WHERE cav_id = $1 AND duration_seconds > 0 AND duration_seconds < 3600`,
      [cavId]
    );
    if (result.rows[0] && parseInt(result.rows[0].count) >= 3) {
      return Math.round(parseFloat(result.rows[0].avg_duration) / 60); // secondes → minutes
    }
  } catch (_) { /* table pas encore créée, pas grave */ }
  return defaultTime;
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

  // 3. Prédire le remplissage pour chaque CAV
  const cavWithPredictions = [];
  for (const cav of allCavs) {
    const prediction = await predictFillRate(cav.id, date);
    cavWithPredictions.push({ ...cav, prediction });
  }

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
  const dateStr = typeof date === 'string' ? date : new Date(date).toISOString().split('T')[0];
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
    const timePerCav = await getLearnedTimePerCav(cav.id, SCORING_CONFIG.timePerCav || 10);

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

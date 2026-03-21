const pool = require('../../config/database');
const { CENTRE_TRI_LAT, CENTRE_TRI_LNG, getContextForDate, getLocalEventsForDate } = require('./context');
const { haversineDistance, nearestNeighborTSP, twoOptImprove } = require('./geo');
const { predictFillRate, getSchoolVacationStatus, getScoringConfig } = require('./predictions');

// ══════════════════════════════════════════════════════════════
// ALGORITHME DE TOURNÉE INTELLIGENTE
// ══════════════════════════════════════════════════════════════
async function generateIntelligentTour(vehicleId, date) {
  const SCORING_CONFIG = getScoringConfig();

  // 1. Récupérer le véhicule
  const vResult = await pool.query('SELECT id, registration, name, max_capacity_kg, team_id, status, current_km FROM vehicles WHERE id = $1', [vehicleId]);
  if (vResult.rows.length === 0) throw new Error('Véhicule non trouvé');
  const vehicle = vResult.rows[0];

  // 2. Récupérer tous les CAV actifs
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

  // 6. Selectionner les CAV avec contrainte 7h max + retour centre toutes les 2t
  const maxCapacity = vehicle.max_capacity_kg * 0.95;
  const maxDailyMinutes = (SCORING_CONFIG.maxDailyHours || 7) * 60;
  const returnThresholdKg = SCORING_CONFIG.returnEveryKg || 2000;
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

  if (selectedCavs.length === 0) throw new Error('Aucun CAV selectionne — verifiez la capacite du vehicule et les donnees de remplissage.');

  // 7. Optimiser la route (TSP + 2-opt)
  let optimizedRoute = nearestNeighborTSP(selectedCavs, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
  optimizedRoute = twoOptImprove(optimizedRoute, CENTRE_TRI_LAT, CENTRE_TRI_LNG);

  // 8. Calculer distance et duree avec retours intermediaires au centre de tri
  // Toutes les 2t chargees, le camion doit revenir au centre de tri
  const dateStr = typeof date === 'string' ? date : new Date(date).toISOString().split('T')[0];
  const context = await getContextForDate(dateStr);

  let totalDistance = 0;
  let totalDuration = 0;
  let currentLoad = 0;
  let nbRetours = 0;
  let lastLat = CENTRE_TRI_LAT, lastLng = CENTRE_TRI_LNG;
  const routeWithReturns = [];

  for (let i = 0; i < optimizedRoute.length; i++) {
    const cav = optimizedRoute[i];
    const cavWeight = cav.prediction?.factors?.avgWeight || 50;
    const distToCav = haversineDistance(lastLat, lastLng, cav.latitude, cav.longitude);

    // Verifier si on doit retourner au centre avant (seuil 2t)
    if (currentLoad + cavWeight > returnThresholdKg && currentLoad > 0) {
      // Retour au centre de tri
      const distRetour = haversineDistance(lastLat, lastLng, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
      totalDistance += distRetour;
      totalDuration += Math.round((distRetour / SCORING_CONFIG.avgSpeed) * 60) + 15; // 15min dechargement
      lastLat = CENTRE_TRI_LAT;
      lastLng = CENTRE_TRI_LNG;
      currentLoad = 0;
      nbRetours++;
      routeWithReturns.push({ type: 'retour_centre', after_cav_index: i - 1 });
    }

    // Aller au CAV
    const dist = haversineDistance(lastLat, lastLng, cav.latitude, cav.longitude);
    totalDistance += dist;
    totalDuration += Math.round((dist / SCORING_CONFIG.avgSpeed) * 60) + SCORING_CONFIG.timePerCav;
    currentLoad += cavWeight;
    lastLat = cav.latitude;
    lastLng = cav.longitude;

    // Verifier contrainte 7h
    const durationWithReturn = totalDuration + Math.round((haversineDistance(lastLat, lastLng, CENTRE_TRI_LAT, CENTRE_TRI_LNG) / SCORING_CONFIG.avgSpeed) * 60);
    if (durationWithReturn > maxDailyMinutes) {
      // Tronquer la tournee ici
      optimizedRoute = optimizedRoute.slice(0, i + 1);
      estimatedWeight = optimizedRoute.reduce((s, c) => s + (c.prediction?.factors?.avgWeight || 50), 0);
      break;
    }
  }

  // Retour final au centre
  const distRetourFinal = haversineDistance(lastLat, lastLng, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
  totalDistance += distRetourFinal;
  totalDuration += Math.round((distRetourFinal / SCORING_CONFIG.avgSpeed) * 60);

  const estimatedDuration = Math.round(totalDuration * context.durationFactor * context.trafficFactor);

  // 9. Récupérer événements locaux actifs pour l'explication
  const localEvents = await getLocalEventsForDate(dateStr);

  // 10. Générer l'explication IA
  const vacationStatus = getSchoolVacationStatus(dateStr);
  const explanation = generateAIExplanation(optimizedRoute, totalDistance, estimatedDuration, estimatedWeight, urgentCount, vehicle, context, localEvents, vacationStatus);

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
    },
    explanation,
  };
}

function generateAIExplanation(route, distance, duration, weight, urgentCount, vehicle, context, localEvents, vacationStatus) {
  const SCORING_CONFIG = getScoringConfig();
  const lines = [];
  lines.push(`Tournee intelligente generee pour ${vehicle.name || vehicle.registration}`);
  lines.push(`\n${route.length} points de collecte selectionnes parmi les CAV actifs`);
  lines.push(`Distance totale estimee : ${Math.round(distance * 10) / 10} km`);
  lines.push(`Duree estimee : ${Math.floor(duration / 60)}h${String(duration % 60).padStart(2, '0')} (max ${SCORING_CONFIG.maxDailyHours || 7}h/jour)`);
  lines.push(`Poids estime : ${Math.round(weight)} kg / ${vehicle.max_capacity_kg} kg (${Math.round(weight / vehicle.max_capacity_kg * 100)}%)`);
  lines.push(`Retours centre de tri prevus : toutes les ${(SCORING_CONFIG.returnEveryKg || 2000) / 1000}t chargees`);

  if (urgentCount > 0) {
    lines.push(`\n${urgentCount} CAV urgents (remplissage >= 80%)`);
  }

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

  lines.push(`\n🔬 Méthode : Prédiction de remplissage (historique 180j + saisonnalité + météo + vacances scolaires + événements locaux + tendance) + TSP 2-opt`);

  const topCavs = route.slice(0, 3);
  if (topCavs.length > 0) {
    lines.push(`\n🏆 Priorités :`);
    topCavs.forEach((cav, i) => {
      let detail = `  ${i + 1}. ${cav.name} — remplissage estimé ${cav.prediction.fill}% (confiance ${Math.round(cav.prediction.confidence * 100)}%)`;
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

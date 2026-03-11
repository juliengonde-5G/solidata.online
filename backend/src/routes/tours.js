const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// Upload photos incidents
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'incidents');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `incident_${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage: photoStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// Centre de tri (coordonnées par défaut)
const CENTRE_TRI_LAT = parseFloat(process.env.CENTRE_TRI_LAT) || 49.4231;
const CENTRE_TRI_LNG = parseFloat(process.env.CENTRE_TRI_LNG) || 1.0993;

// ══════════════════════════════════════════════════════════════
// CONTEXTE COLLECTE (météo, trafic, apprentissage)
// ══════════════════════════════════════════════════════════════

async function getContextForDate(dateStr) {
  const res = await pool.query(
    'SELECT * FROM collection_context WHERE date = $1',
    [dateStr]
  );
  if (res.rows.length > 0) {
    const row = res.rows[0];
    return {
      weatherFactor: parseFloat(row.weather_factor) || 1,
      trafficFactor: parseFloat(row.traffic_factor) || 1,
      durationFactor: parseFloat(row.duration_factor) || 1,
      weatherCode: row.weather_code,
      weatherLabel: row.weather_label || null,
      tempMax: row.temp_max != null ? parseFloat(row.temp_max) : null,
      precipMm: row.precip_mm != null ? parseFloat(row.precip_mm) : null,
      notes: row.notes,
    };
  }
  // Appeler Open-Meteo (gratuit, sans clé) pour la météo du jour
  try {
    const lat = CENTRE_TRI_LAT;
    const lng = CENTRE_TRI_LNG;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,precipitation_sum&timezone=Europe/Paris&start_date=${dateStr}&end_date=${dateStr}`;
    const response = await globalThis.fetch(url);
    const data = await response.json();
    const code = data.daily?.weather_code?.[0];
    const tempMax = data.daily?.temperature_2m_max?.[0] ?? null;
    const precipMm = data.daily?.precipitation_sum?.[0] ?? null;
    // Facteur météo : pluie/neige = légère baisse remplissage ou durée plus longue
    let weatherFactor = 1;
    if (code >= 61 && code <= 67) weatherFactor = 0.95;  // pluie
    if (code >= 80 && code <= 82) weatherFactor = 0.92;  // averse
    if (code >= 71 && code <= 77) weatherFactor = 0.9;   // neige
    // Beau temps = les gens sortent davantage, trient plus → bonus remplissage
    if (code <= 3 && tempMax != null && tempMax >= 18) weatherFactor = 1.08;
    const weatherLabel = wmoCodeToLabel(code);

    // Persister en cache
    try {
      await pool.query(
        `INSERT INTO collection_context (date, weather_factor, weather_code, weather_label, temp_max, precip_mm, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (date) DO UPDATE SET
           weather_factor = EXCLUDED.weather_factor, weather_code = EXCLUDED.weather_code,
           weather_label = EXCLUDED.weather_label, temp_max = EXCLUDED.temp_max,
           precip_mm = EXCLUDED.precip_mm, updated_at = NOW()`,
        [dateStr, weatherFactor, String(code), weatherLabel, tempMax, precipMm]
      );
    } catch (_) { /* ignore cache write errors */ }

    return { weatherFactor, trafficFactor: 1, durationFactor: 1, weatherCode: String(code), weatherLabel, tempMax, precipMm, notes: null };
  } catch (e) {
    return { weatherFactor: 1, trafficFactor: 1, durationFactor: 1, weatherCode: null, weatherLabel: null, tempMax: null, precipMm: null, notes: null };
  }
}

function wmoCodeToLabel(code) {
  if (code == null) return null;
  if (code <= 1) return 'Dégagé';
  if (code <= 3) return 'Nuageux';
  if (code <= 48) return 'Brouillard';
  if (code <= 57) return 'Bruine';
  if (code <= 67) return 'Pluie';
  if (code <= 77) return 'Neige';
  if (code <= 82) return 'Averses';
  if (code <= 86) return 'Neige';
  if (code >= 95) return 'Orage';
  return 'Inconnu';
}

// Vérifier les événements locaux à proximité d'un CAV pour une date
async function getLocalEventsForDate(dateStr) {
  try {
    const res = await pool.query(
      `SELECT * FROM evenements_locaux
       WHERE date_debut <= $1 AND date_fin >= $1 AND is_active = true
       ORDER BY rayon_km DESC`,
      [dateStr]
    );
    return res.rows;
  } catch (e) {
    return [];
  }
}

function isEventNearCav(event, cav) {
  if (!event.latitude || !event.longitude || !cav.latitude || !cav.longitude) return false;
  const dist = haversineDistance(event.latitude, event.longitude, cav.latitude, cav.longitude);
  return dist <= (event.rayon_km || 2);
}

// ══════════════════════════════════════════════════════════════
// ALGORITHMES GÉOGRAPHIQUES
// ══════════════════════════════════════════════════════════════

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// TSP : Plus proche voisin (Nearest Neighbor)
function nearestNeighborTSP(points, startLat, startLng) {
  const remaining = [...points];
  const ordered = [];
  let currentLat = startLat;
  let currentLng = startLng;

  while (remaining.length > 0) {
    let minDist = Infinity;
    let nearestIdx = 0;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineDistance(currentLat, currentLng, remaining[i].latitude, remaining[i].longitude);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }
    const nearest = remaining.splice(nearestIdx, 1)[0];
    ordered.push(nearest);
    currentLat = nearest.latitude;
    currentLng = nearest.longitude;
  }
  return ordered;
}

// Amélioration 2-opt
function twoOptImprove(route, startLat, startLng) {
  let improved = true;
  let bestRoute = [...route];

  while (improved) {
    improved = false;
    for (let i = 0; i < bestRoute.length - 1; i++) {
      for (let j = i + 2; j < bestRoute.length; j++) {
        const newRoute = [...bestRoute];
        // Inverser le segment entre i+1 et j
        const segment = newRoute.splice(i + 1, j - i);
        segment.reverse();
        newRoute.splice(i + 1, 0, ...segment);

        const oldDist = calculateTotalDistance(bestRoute, startLat, startLng);
        const newDist = calculateTotalDistance(newRoute, startLat, startLng);

        if (newDist < oldDist) {
          bestRoute = newRoute;
          improved = true;
        }
      }
    }
  }
  return bestRoute;
}

function calculateTotalDistance(route, startLat, startLng) {
  let total = 0;
  let prevLat = startLat, prevLng = startLng;
  for (const p of route) {
    total += haversineDistance(prevLat, prevLng, p.latitude, p.longitude);
    prevLat = p.latitude;
    prevLng = p.longitude;
  }
  // Retour au centre
  total += haversineDistance(prevLat, prevLng, startLat, startLng);
  return total;
}

// ══════════════════════════════════════════════════════════════
// MOTEUR DE PRÉDICTION DE REMPLISSAGE (IA)
// ══════════════════════════════════════════════════════════════

// Facteurs saisonniers mensuels (jan→déc) — calibrés sur données réelles 2025-2026
// Pic en août (1.27), creux en décembre (0.75). Juin proche de la moyenne (0.99).
let SEASONAL_FACTORS = [0.88, 0.82, 0.94, 1.05, 1.12, 0.99, 1.19, 1.27, 1.13, 1.02, 0.84, 0.75];

// Facteurs jour de la semaine (lun→dim) — calibrés sur données réelles
// Lundi le plus lourd (accumulation weekend), jeudi bas (~50%), pas de collecte sam/dim
// Note : sam/dim = facteur d'accumulation dans les conteneurs (pas de collecte)
let DAY_OF_WEEK_FACTORS = [1.25, 1.09, 1.05, 0.49, 1.11, 1.15, 1.1];

// Jours fériés français (approximation)
// Jours fériés français — source : service-public.gouv.fr
let FRENCH_HOLIDAYS_2026 = [
  // 2025 (fin d'année)
  '2025-11-01', '2025-11-11', '2025-12-25',
  // 2026
  '2026-01-01', // Jour de l'An
  '2026-04-06', // Lundi de Pâques
  '2026-05-01', // Fête du Travail
  '2026-05-08', // Victoire 1945
  '2026-05-14', // Ascension
  '2026-05-15', // Pont de l'Ascension (pas classe)
  '2026-05-25', // Lundi de Pentecôte
  '2026-07-14', // Fête nationale
  '2026-08-15', // Assomption
  '2026-11-01', // Toussaint
  '2026-11-11', // Armistice
  '2026-12-25', // Noël
  // 2027
  '2027-01-01', // Jour de l'An
  '2027-03-29', // Lundi de Pâques
  '2027-05-01', // Fête du Travail
  '2027-05-06', // Ascension
  '2027-05-07', // Pont de l'Ascension (pas classe)
  '2027-05-08', // Victoire 1945
  '2027-05-17', // Lundi de Pentecôte
  '2027-07-14', // Fête nationale
  '2027-08-15', // Assomption
];

// Vacances scolaires zone B (Normandie) — source : education.gouv.fr
// Dates officielles arrêté du 22/10/2025
let SCHOOL_VACATIONS = [
  // Année scolaire 2025-2026
  { name: 'Toussaint 2025', start: '2025-10-18', end: '2025-11-03' },
  { name: 'Noël 2025', start: '2025-12-20', end: '2026-01-05' },
  { name: 'Hiver 2026', start: '2026-02-14', end: '2026-03-02' },
  { name: 'Printemps 2026', start: '2026-04-11', end: '2026-04-27' },
  { name: 'Pont Ascension 2026', start: '2026-05-13', end: '2026-05-18' },
  { name: 'Été 2026', start: '2026-07-04', end: '2026-09-01' },
  // Année scolaire 2026-2027
  { name: 'Toussaint 2026', start: '2026-10-17', end: '2026-11-02' },
  { name: 'Noël 2026', start: '2026-12-19', end: '2027-01-04' },
  { name: 'Hiver 2027', start: '2027-02-20', end: '2027-03-08' },
  { name: 'Printemps 2027', start: '2027-04-17', end: '2027-05-03' },
  { name: 'Été 2027', start: '2027-07-03', end: '2027-09-01' },
];

// Paramètres de scoring — modifiables via admin
let SCORING_CONFIG = {
  fillThresholds: { critical: 100, high: 80, medium: 60, low: 40 },
  fillScores: { critical: 50, high: 35, medium: 20, low: 10, minimal: 2 },
  daysSinceWeight: 1.5,
  containerBonus: 3,
  vehicleFillTarget: 0.95,
  avgSpeed: 30,          // km/h vitesse moyenne
  timePerCav: 10,        // min par CAV
  maxDailyHours: 7,      // max 7h de collecte par jour
  returnEveryKg: 2000,   // retour centre de tri toutes les 2 tonnes
  historyDays: 180,      // jours d'historique analysés
  weeklyCollectionCycle: 7, // hypothèse collecte hebdomadaire
  densityThreshold: 3,   // nb conteneurs pour bonus densité
  densityBonus: 1.1,
  holidayBonus: 1.1,
  maxFillCap: 120,
  weekendSunnyBonus: 1.15,  // beau temps le weekend → plus de tri
  localEventBonus: 1.2,     // brocante/vide-grenier à proximité
  // Vacances scolaires — calibrés sur données réelles 2025-2026
  // Hors été : baisse ~10% (routes moins fréquentes, moins de dépôts)
  // Été : déjà capté par les facteurs saisonniers juil/août
  schoolVacationFactor: 0.90,    // pendant les vacances (hors été)
  summerVacationFactor: 1.0,     // été (neutre, déjà dans facteurs saisonniers)
  preVacationBonus: 1.05,        // semaine avant (léger surcroît de tri)
  postVacationBonus: 1.05,       // semaine après (retour, vidage)
};

function isHoliday(dateStr) {
  return FRENCH_HOLIDAYS_2026.includes(dateStr);
}

// Détection vacances scolaires : pendant, semaine avant, semaine après
function getSchoolVacationStatus(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const msPerDay = 86400000;

  for (const vac of SCHOOL_VACATIONS) {
    const start = new Date(vac.start + 'T00:00:00');
    const end = new Date(vac.end + 'T00:00:00');
    const preStart = new Date(start.getTime() - 7 * msPerDay);
    const postEnd = new Date(end.getTime() + 7 * msPerDay);

    if (d >= start && d <= end) {
      return { status: 'during', name: vac.name };
    }
    if (d >= preStart && d < start) {
      return { status: 'pre', name: vac.name };
    }
    if (d > end && d <= postEnd) {
      return { status: 'post', name: vac.name };
    }
  }
  return { status: null, name: null };
}

async function predictFillRate(cavId, targetDate) {
  const now = new Date(targetDate || Date.now());
  const monthIndex = now.getMonth();
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // 0=lun, 6=dim
  const dateStr = now.toISOString().split('T')[0];

  // Récupérer l'historique de ce CAV
  const histResult = await pool.query(
    `SELECT date, weight_kg FROM tonnage_history
     WHERE cav_id = $1 AND date >= NOW() - INTERVAL '180 days'
     ORDER BY date DESC`,
    [cavId]
  );

  const cavResult = await pool.query('SELECT * FROM cav WHERE id = $1', [cavId]);
  if (cavResult.rows.length === 0) return { fill: 0, confidence: 0 };
  const cav = cavResult.rows[0];

  const history = histResult.rows;

  if (history.length === 0) {
    // Pas d'historique → estimation par défaut
    return {
      fill: 50, // Milieu de fourchette
      confidence: 0.2,
      method: 'default',
    };
  }

  // Calculer le poids moyen par collecte
  const avgWeight = history.reduce((sum, h) => sum + parseFloat(h.weight_kg), 0) / history.length;

  // Jours depuis dernière collecte
  const lastCollection = history[0].date;
  const daysSince = Math.floor((now - new Date(lastCollection)) / 86400000);

  // Accumulation journalière estimée
  const dailyAccumulation = avgWeight / 7; // Hypothèse : collecte hebdomadaire moyenne

  // Calcul du remplissage brut
  let rawFill = (daysSince * dailyAccumulation / (cav.nb_containers || 1)) * 100;

  // Appliquer les facteurs
  rawFill *= SEASONAL_FACTORS[monthIndex];
  rawFill *= DAY_OF_WEEK_FACTORS[dayOfWeek];

  // Facteur jours fériés : +10% pendant les jours fériés
  if (isHoliday(dateStr)) rawFill *= SCORING_CONFIG.holidayBonus || 1.1;

  // Facteur vacances scolaires : semaine avant, pendant, semaine après
  // Données réelles : vacances hors été = baisse ~10%, été = neutre (déjà dans saisonnier)
  const vacationStatus = getSchoolVacationStatus(dateStr);
  let vacationFactor = 1;
  if (vacationStatus.status === 'during') {
    const isSummer = vacationStatus.name && /été/i.test(vacationStatus.name);
    vacationFactor = isSummer
      ? (SCORING_CONFIG.summerVacationFactor || 1.0)
      : (SCORING_CONFIG.schoolVacationFactor || 0.90);
  } else if (vacationStatus.status === 'pre') {
    vacationFactor = SCORING_CONFIG.preVacationBonus || 1.05;
  } else if (vacationStatus.status === 'post') {
    vacationFactor = SCORING_CONFIG.postVacationBonus || 1.05;
  }
  rawFill *= vacationFactor;

  // Tendance sur les 30 derniers jours vs les 90 jours
  const recent30 = history.filter(h => {
    const d = new Date(h.date);
    return (now - d) / 86400000 <= 30;
  });
  const older = history.filter(h => {
    const d = new Date(h.date);
    return (now - d) / 86400000 > 30 && (now - d) / 86400000 <= 90;
  });

  if (recent30.length > 0 && older.length > 0) {
    const recentAvg = recent30.reduce((s, h) => s + parseFloat(h.weight_kg), 0) / recent30.length;
    const olderAvg = older.reduce((s, h) => s + parseFloat(h.weight_kg), 0) / older.length;
    const trend = recentAvg / olderAvg; // >1 = tendance hausse
    rawFill *= trend;
  }

  // Facteur densité de population (basé sur le nombre de conteneurs)
  // Plus de conteneurs = zone plus dense = remplissage potentiellement plus rapide
  if (cav.nb_containers >= 3) rawFill *= 1.1;

  // Contexte météo (météo défavorable = moins de dépôts ou report)
  const context = await getContextForDate(dateStr);
  rawFill *= context.weatherFactor;

  // Beau temps le weekend = plus de dépôts (gens font du rangement/tri)
  const isWeekend = (dayOfWeek >= 5); // 5=sam, 6=dim
  if (isWeekend && context.tempMax != null && context.tempMax >= 18 && context.weatherFactor >= 1) {
    rawFill *= SCORING_CONFIG.weekendSunnyBonus || 1.15;
  }

  // Événements locaux à proximité (brocante, vide-grenier → excédent de collecte)
  const localEvents = await getLocalEventsForDate(dateStr);
  let eventBonus = 1;
  for (const evt of localEvents) {
    if (isEventNearCav(evt, cav)) {
      eventBonus = Math.max(eventBonus, parseFloat(evt.bonus_factor) || (SCORING_CONFIG.localEventBonus || 1.2));
    }
  }
  rawFill *= eventBonus;

  // ── Apprentissage continu V2 : correction par CAV + par période ──
  // 1. Correction spécifique à ce CAV (feedback récent, pondéré par récence)
  const feedbackResult = await pool.query(
    `SELECT predicted_fill_rate, observed_fill_level, created_at FROM collection_learning_feedback
     WHERE cav_id = $1 ORDER BY created_at DESC LIMIT 60`,
    [cavId]
  );

  let cavCorrection = 1;
  if (feedbackResult.rows.length >= 3) {
    let weightedSum = 0, weightTotal = 0;
    for (let i = 0; i < feedbackResult.rows.length; i++) {
      const row = feedbackResult.rows[i];
      const observedPct = (row.observed_fill_level ?? 0) * 20;
      const pred = parseFloat(row.predicted_fill_rate) || 50;
      if (pred > 0) {
        // Pondération exponentielle : les feedbacks récents comptent plus
        const weight = Math.exp(-i * 0.05); // decay factor
        weightedSum += (observedPct / pred) * weight;
        weightTotal += weight;
      }
    }
    cavCorrection = weightTotal > 0 ? weightedSum / weightTotal : 1;
    cavCorrection = Math.max(0.5, Math.min(1.5, cavCorrection));
  }

  // 2. Correction saisonnière par période (même mois des données passées)
  const periodFeedback = await pool.query(
    `SELECT predicted_fill_rate, observed_fill_level FROM collection_learning_feedback
     WHERE cav_id = $1 AND EXTRACT(MONTH FROM created_at) = $2
     ORDER BY created_at DESC LIMIT 20`,
    [cavId, monthIndex + 1]
  );

  let periodCorrection = 1;
  if (periodFeedback.rows.length >= 3) {
    let sumRatio = 0, count = 0;
    for (const row of periodFeedback.rows) {
      const observedPct = (row.observed_fill_level ?? 0) * 20;
      const pred = parseFloat(row.predicted_fill_rate) || 50;
      if (pred > 0) { sumRatio += observedPct / pred; count++; }
    }
    periodCorrection = count > 0 ? sumRatio / count : 1;
    periodCorrection = Math.max(0.7, Math.min(1.3, periodCorrection));
  }

  // 3. Correction de zone : CAV proches géographiquement ont des patterns similaires
  let zoneCorrection = 1;
  if (cav.latitude && cav.longitude) {
    const zoneFeedback = await pool.query(
      `SELECT clf.predicted_fill_rate, clf.observed_fill_level
       FROM collection_learning_feedback clf
       JOIN cav c ON clf.cav_id = c.id
       WHERE clf.cav_id != $1
         AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
         AND ABS(c.latitude - $2) < 0.05 AND ABS(c.longitude - $3) < 0.1
         AND clf.created_at >= NOW() - INTERVAL '30 days'
       ORDER BY clf.created_at DESC LIMIT 30`,
      [cavId, parseFloat(cav.latitude), parseFloat(cav.longitude)]
    );
    if (zoneFeedback.rows.length >= 5) {
      let sumRatio = 0, count = 0;
      for (const row of zoneFeedback.rows) {
        const observedPct = (row.observed_fill_level ?? 0) * 20;
        const pred = parseFloat(row.predicted_fill_rate) || 50;
        if (pred > 0) { sumRatio += observedPct / pred; count++; }
      }
      zoneCorrection = count > 0 ? sumRatio / count : 1;
      zoneCorrection = Math.max(0.8, Math.min(1.2, zoneCorrection));
    }
  }

  // Combiner les corrections (CAV individuel pèse 60%, période 25%, zone 15%)
  const combinedCorrection = cavCorrection * 0.6 + periodCorrection * 0.25 + zoneCorrection * 0.15;
  rawFill *= combinedCorrection;

  // Cap à 120%
  const fill = Math.min(120, Math.max(0, rawFill));

  // ── Confiance bayésienne V2 ──
  // Base sur : quantité de données, cohérence du feedback, fraîcheur des données
  const dataScore = Math.min(1, history.length / 30); // 0-1, saturé à 30 entrées
  const feedbackCount = feedbackResult.rows.length;
  const feedbackScore = Math.min(1, feedbackCount / 15); // 0-1, saturé à 15 feedbacks
  // Cohérence : si cavCorrection est proche de 1, le modèle est bien calibré
  const coherenceScore = 1 - Math.min(1, Math.abs(cavCorrection - 1) * 2);
  // Fraîcheur : bonus si dernière collecte < 14 jours
  const freshnessScore = daysSince <= 14 ? 1 : Math.max(0.3, 1 - (daysSince - 14) / 30);

  const confidence = Math.min(0.95, 0.1 + dataScore * 0.35 + feedbackScore * 0.25 + coherenceScore * 0.2 + freshnessScore * 0.15);

  return {
    fill: Math.round(fill),
    confidence: Math.round(confidence * 100) / 100,
    method: 'predictive_v2',
    contextUsed: {
      weatherFactor: context.weatherFactor,
      weatherLabel: context.weatherLabel,
      tempMax: context.tempMax,
      weekendSunny: isWeekend && context.tempMax >= 18 && context.weatherFactor >= 1,
      eventBonus: eventBonus > 1 ? eventBonus : null,
      vacationStatus: vacationStatus.status,
      vacationName: vacationStatus.name,
      vacationFactor: vacationFactor !== 1 ? vacationFactor : null,
    },
    factors: {
      seasonal: SEASONAL_FACTORS[monthIndex],
      dayOfWeek: DAY_OF_WEEK_FACTORS[dayOfWeek],
      daysSinceCollection: daysSince,
      avgWeight: Math.round(avgWeight * 10) / 10,
      dailyAccumulation: Math.round(dailyAccumulation * 10) / 10,
    },
    learning: {
      cavCorrection: Math.round(cavCorrection * 1000) / 1000,
      periodCorrection: Math.round(periodCorrection * 1000) / 1000,
      zoneCorrection: Math.round(zoneCorrection * 1000) / 1000,
      combinedCorrection: Math.round(combinedCorrection * 1000) / 1000,
      feedbackSamples: feedbackResult.rows.length,
      confidenceBreakdown: {
        data: Math.round(dataScore * 100) / 100,
        feedback: Math.round(feedbackScore * 100) / 100,
        coherence: Math.round(coherenceScore * 100) / 100,
        freshness: Math.round(freshnessScore * 100) / 100,
      },
    },
  };
}

// ══════════════════════════════════════════════════════════════
// ALGORITHME DE TOURNÉE INTELLIGENTE
// ══════════════════════════════════════════════════════════════
async function generateIntelligentTour(vehicleId, date) {
  // 1. Récupérer le véhicule
  const vResult = await pool.query('SELECT * FROM vehicles WHERE id = $1', [vehicleId]);
  if (vResult.rows.length === 0) throw new Error('Véhicule non trouvé');
  const vehicle = vResult.rows[0];

  // 2. Récupérer tous les CAV actifs
  const cavResult = await pool.query("SELECT * FROM cav WHERE status = 'active' ORDER BY name");
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

// ══════════════════════════════════════════════════════════════
// ROUTES API
// ══════════════════════════════════════════════════════════════

router.use(authenticate);

// GET /api/tours/my — Vehicules et tournees du jour (mobile)
// Retourne les tournees planned/in_progress + les vehicules disponibles sans tournee
router.get('/my', async (req, res) => {
  try {
    const userId = req.user.id;
    const empResult = await pool.query('SELECT id FROM employees WHERE user_id = $1', [userId]);
    const employeeId = empResult.rows.length > 0 ? empResult.rows[0].id : null;

    // 1. Tournees existantes du jour
    const toursResult = await pool.query(`
      SELECT t.*, v.registration, v.name as vehicle_name,
       CONCAT(e.first_name, ' ', e.last_name) as driver_name,
       COALESCE(t.nb_cav, (SELECT COUNT(*)::int FROM tour_cav tc WHERE tc.tour_id = t.id)) as nb_cav,
       (SELECT COUNT(*)::int FROM tour_cav tc WHERE tc.tour_id = t.id AND tc.status = 'collected') as collected_count,
       false as is_free_vehicle
      FROM tours t
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN employees e ON t.driver_employee_id = e.id
      WHERE
        (t.date = CURRENT_DATE AND t.status = 'planned')
        OR (t.driver_employee_id = $1 AND t.status = 'in_progress')
      ORDER BY t.status = 'in_progress' DESC, t.date ASC, t.created_at DESC
    `, [employeeId]);

    // 2. Vehicules disponibles sans tournee du jour
    const vehicleIdsInTours = toursResult.rows
      .filter(t => t.vehicle_id)
      .map(t => t.vehicle_id);

    let freeVehicles = [];
    try {
      const vRes = await pool.query(`
        SELECT v.id as vehicle_id, v.registration, v.name as vehicle_name, v.type as vehicle_type,
          NULL as id, 'planned' as status, CURRENT_DATE as date,
          NULL as driver_employee_id, NULL as driver_name,
          0 as nb_cav, 0 as collected_count, true as is_free_vehicle
        FROM vehicles v
        WHERE v.is_active = true
          ${vehicleIdsInTours.length > 0 ? `AND v.id NOT IN (${vehicleIdsInTours.join(',')})` : ''}
        ORDER BY v.name, v.registration
      `);
      freeVehicles = vRes.rows;
    } catch { /* vehicles table might not have is_active */ }

    res.json([...toursResult.rows, ...freeVehicles]);
  } catch (err) {
    console.error('[TOURS] Erreur /my :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/claim-vehicle — Le chauffeur prend un vehicule libre (sans tournee)
// Cree une tournee a la volee pour ce vehicule
router.post('/claim-vehicle', async (req, res) => {
  try {
    const userId = req.user.id;
    const { vehicle_id } = req.body;
    if (!vehicle_id) return res.status(400).json({ error: 'vehicle_id requis' });

    const empResult = await pool.query('SELECT id FROM employees WHERE user_id = $1', [userId]);
    if (empResult.rows.length === 0) {
      return res.status(400).json({ error: 'Aucune fiche employe liee a votre compte' });
    }
    const employeeId = empResult.rows[0].id;

    // Verifier que le vehicule n'est pas deja en tournee
    const existing = await pool.query(
      `SELECT id FROM tours WHERE vehicle_id = $1 AND date = CURRENT_DATE AND status IN ('planned', 'in_progress')`,
      [vehicle_id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Ce vehicule est deja en tournee aujourd\'hui' });
    }

    // Creer une tournee a la volee
    const result = await pool.query(
      `INSERT INTO tours (vehicle_id, driver_employee_id, date, status, created_at, updated_at)
       VALUES ($1, $2, CURRENT_DATE, 'in_progress', NOW(), NOW())
       RETURNING *`,
      [vehicle_id, employeeId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur claim-vehicle :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/:id/claim — Le chauffeur prend une tournee planifiee
// Le claim assigne le chauffeur connecte et passe la tournee en in_progress
// Seule une tournee planned peut etre claimee -> atomique
router.put('/:id/claim', async (req, res) => {
  try {
    const userId = req.user.id;
    const empResult = await pool.query('SELECT id FROM employees WHERE user_id = $1', [userId]);
    if (empResult.rows.length === 0) {
      return res.status(400).json({ error: 'Aucune fiche employe liee a votre compte' });
    }
    const employeeId = empResult.rows[0].id;

    // Assigner le chauffeur et passer en in_progress atomiquement
    // Seule une tournee planned peut etre claimee (empeche double claim)
    const result = await pool.query(
      `UPDATE tours SET driver_employee_id = $1, status = 'in_progress', updated_at = NOW()
       WHERE id = $2 AND status = 'planned'
       RETURNING *`,
      [employeeId, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Ce véhicule a déjà été pris par un autre chauffeur' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur claim :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

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
      seasonalFactors: SEASONAL_FACTORS,
      dayOfWeekFactors: DAY_OF_WEEK_FACTORS,
      holidays: FRENCH_HOLIDAYS_2026,
      schoolVacations: SCHOOL_VACATIONS,
      scoring: SCORING_CONFIG,
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
      SEASONAL_FACTORS = seasonalFactors.map(Number);
    }
    if (dayOfWeekFactors && Array.isArray(dayOfWeekFactors) && dayOfWeekFactors.length === 7) {
      DAY_OF_WEEK_FACTORS = dayOfWeekFactors.map(Number);
    }
    if (holidays && Array.isArray(holidays)) {
      FRENCH_HOLIDAYS_2026 = holidays;
    }
    if (schoolVacations && Array.isArray(schoolVacations)) {
      SCHOOL_VACATIONS = schoolVacations.filter(v => v.name && v.start && v.end);
    }
    if (scoring && typeof scoring === 'object') {
      SCORING_CONFIG = { ...SCORING_CONFIG, ...scoring };
    }

    res.json({
      message: 'Configuration mise à jour',
      seasonalFactors: SEASONAL_FACTORS,
      dayOfWeekFactors: DAY_OF_WEEK_FACTORS,
      holidays: FRENCH_HOLIDAYS_2026,
      schoolVacations: SCHOOL_VACATIONS,
      scoring: SCORING_CONFIG,
    });
  } catch (err) {
    console.error('[TOURS] Erreur update config :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/proposals/daily — Propositions de tournées pour une date
router.get('/proposals/daily', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const vehiclesResult = await pool.query(
      `SELECT * FROM vehicles WHERE status = 'available' OR status = 'in_use' ORDER BY name`
    );
    const driversResult = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.team_id FROM employees e
       JOIN teams t ON e.team_id = t.id WHERE t.type = 'collecte' AND e.is_active = true`
    );
    const existingTours = await pool.query(
      `SELECT vehicle_id, driver_employee_id FROM tours WHERE date = $1 AND status NOT IN ('cancelled', 'completed')`,
      [date]
    );
    const usedVehicleIds = new Set(existingTours.rows.map(r => r.vehicle_id));
    const availableVehicles = vehiclesResult.rows.filter(v => !usedVehicleIds.has(v.id));

    const proposals = [];
    for (const vehicle of availableVehicles.slice(0, 5)) {
      try {
        const result = await generateIntelligentTour(vehicle.id, date);
        proposals.push({
          vehicle_id: vehicle.id,
          vehicle_name: vehicle.name || vehicle.registration,
          proposal: result,
        });
      } catch (err) {
        console.warn('[TOURS] Proposition ignorée pour véhicule', vehicle.id, err.message);
      }
    }

    const context = await getContextForDate(date);
    const vacationStatus = getSchoolVacationStatus(date);
    const holiday = isHoliday(date);

    // Prochaines vacances scolaires (pour affichage calendrier)
    const upcomingVacations = SCHOOL_VACATIONS.filter(v => v.end >= date).slice(0, 3);

    // Jours fériés proches (±30 jours)
    const d = new Date(date + 'T00:00:00');
    const nearbyHolidays = FRENCH_HOLIDAYS_2026.filter(h => {
      const hd = new Date(h + 'T00:00:00');
      const diff = Math.abs(hd - d) / 86400000;
      return diff <= 30;
    });

    res.json({
      date,
      context: {
        weatherFactor: context.weatherFactor,
        weatherLabel: context.weatherLabel,
        weatherCode: context.weatherCode,
        tempMax: context.tempMax,
        precipMm: context.precipMm,
        trafficFactor: context.trafficFactor,
        durationFactor: context.durationFactor,
        notes: context.notes,
      },
      vacationStatus: vacationStatus.status ? {
        status: vacationStatus.status,
        name: vacationStatus.name,
        bonus: vacationStatus.status === 'during' ? (SCORING_CONFIG.schoolVacationFactor || SCORING_CONFIG.schoolVacationBonus)
          : vacationStatus.status === 'pre' ? SCORING_CONFIG.preVacationBonus
          : SCORING_CONFIG.postVacationBonus,
      } : null,
      holiday: holiday ? { date, bonus: SCORING_CONFIG.holidayBonus } : null,
      referenceCalendar: {
        upcomingVacations,
        nearbyHolidays,
        seasonalFactor: SEASONAL_FACTORS[d.getMonth()],
        dayOfWeekFactor: DAY_OF_WEEK_FACTORS[d.getDay() === 0 ? 6 : d.getDay() - 1],
      },
      availableVehicles: availableVehicles.length,
      drivers: driversResult.rows,
      proposals,
    });
  } catch (err) {
    console.error('[TOURS] Erreur propositions journalières :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/proposals/weekly — Plan hebdomadaire (propositions par jour)
router.get('/proposals/weekly', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const weekStart = req.query.week_start;
    let startDate;
    if (weekStart) {
      startDate = new Date(weekStart);
    } else {
      const d = new Date();
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      startDate = new Date(d.getFullYear(), d.getMonth(), diff);
    }
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      days.push(d.toISOString().split('T')[0]);
    }

    const weekly = [];
    for (const dateStr of days) {
      const vehiclesResult = await pool.query(
        `SELECT id, name, registration FROM vehicles WHERE status IN ('available', 'in_use')`
      );
      const existingTours = await pool.query(
        `SELECT t.id, t.vehicle_id, v.name as vehicle_name FROM tours t LEFT JOIN vehicles v ON t.vehicle_id = v.id WHERE t.date = $1 AND t.status NOT IN ('cancelled', 'completed')`,
        [dateStr]
      );
      const usedIds = new Set(existingTours.rows.map(r => r.vehicle_id));
      const available = vehiclesResult.rows.filter(v => !usedIds.has(v.id));

      let bestProposal = null;
      if (available.length > 0) {
        try {
          const result = await generateIntelligentTour(available[0].id, dateStr);
          bestProposal = { vehicle: available[0], stats: result.stats, cavCount: result.cavList.length };
        } catch (e) {}
      }

      const context = await getContextForDate(dateStr);
      const vacStatus = getSchoolVacationStatus(dateStr);
      const hol = isHoliday(dateStr);
      weekly.push({
        date: dateStr,
        dayName: new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long' }),
        existingTours: existingTours.rows,
        availableVehicles: available.length,
        suggestedTour: bestProposal,
        context: {
          weatherFactor: context.weatherFactor,
          weatherLabel: context.weatherLabel,
          tempMax: context.tempMax,
          precipMm: context.precipMm,
          durationFactor: context.durationFactor,
        },
        vacationStatus: vacStatus.status ? { status: vacStatus.status, name: vacStatus.name } : null,
        holiday: hol,
      });
    }

    // Vacances couvrant la semaine
    const upcomingVacations = SCHOOL_VACATIONS.filter(v => v.end >= days[0] && v.start <= days[6]);
    res.json({ weekStart: days[0], weekEnd: days[6], days: weekly, upcomingVacations });
  } catch (err) {
    console.error('[TOURS] Erreur propositions hebdo :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/context/:date — Contexte (météo, trafic) pour une date
router.get('/context/:date', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const context = await getContextForDate(req.params.date);
    res.json(context);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/context — Enregistrer ou mettre à jour le contexte (admin)
router.put('/context', authorize('ADMIN'), async (req, res) => {
  try {
    const { date, weather_factor, traffic_factor, duration_factor, weather_code, notes } = req.body;
    if (!date) return res.status(400).json({ error: 'date requis' });

    await pool.query(
      `INSERT INTO collection_context (date, weather_factor, traffic_factor, duration_factor, weather_code, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (date) DO UPDATE SET
         weather_factor = COALESCE(EXCLUDED.weather_factor, collection_context.weather_factor),
         traffic_factor = COALESCE(EXCLUDED.traffic_factor, collection_context.traffic_factor),
         duration_factor = COALESCE(EXCLUDED.duration_factor, collection_context.duration_factor),
         weather_code = COALESCE(EXCLUDED.weather_code, collection_context.weather_code),
         notes = COALESCE(EXCLUDED.notes, collection_context.notes),
         updated_at = NOW()`,
      [date, weather_factor ?? 1, traffic_factor ?? 1, duration_factor ?? 1, weather_code ?? null, notes ?? null]
    );
    const context = await getContextForDate(date);
    res.json({ message: 'Contexte enregistré', context });
  } catch (err) {
    console.error('[TOURS] Erreur contexte :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// ÉVÉNEMENTS LOCAUX (brocantes, vide-greniers, etc.)
// ══════════════════════════════════════════

// GET /api/tours/events — Liste des événements locaux
router.get('/events', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM evenements_locaux ORDER BY date_debut DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[TOURS] Erreur événements :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/events — Créer un événement local
router.post('/events', authorize('ADMIN'), async (req, res) => {
  try {
    const { nom, type, date_debut, date_fin, latitude, longitude, adresse, commune, rayon_km, bonus_factor, notes } = req.body;
    if (!nom || !date_debut || !date_fin) {
      return res.status(400).json({ error: 'nom, date_debut, date_fin requis' });
    }
    const result = await pool.query(
      `INSERT INTO evenements_locaux (nom, type, date_debut, date_fin, latitude, longitude, adresse, commune, rayon_km, bonus_factor, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [nom, type || 'brocante', date_debut, date_fin, latitude || null, longitude || null, adresse || null, commune || null, rayon_km || 2, bonus_factor || 1.2, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur création événement :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/events/:id — Modifier un événement
router.put('/events/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const { nom, type, date_debut, date_fin, latitude, longitude, adresse, commune, rayon_km, bonus_factor, notes, is_active } = req.body;
    const result = await pool.query(
      `UPDATE evenements_locaux SET
       nom = COALESCE($1, nom), type = COALESCE($2, type),
       date_debut = COALESCE($3, date_debut), date_fin = COALESCE($4, date_fin),
       latitude = COALESCE($5, latitude), longitude = COALESCE($6, longitude),
       adresse = COALESCE($7, adresse), commune = COALESCE($8, commune),
       rayon_km = COALESCE($9, rayon_km), bonus_factor = COALESCE($10, bonus_factor),
       notes = COALESCE($11, notes), is_active = COALESCE($12, is_active)
       WHERE id = $13 RETURNING *`,
      [nom, type, date_debut, date_fin, latitude, longitude, adresse, commune, rayon_km, bonus_factor, notes, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Événement non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur modification événement :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/tours/events/:id — Supprimer un événement
router.delete('/events/:id', authorize('ADMIN'), async (req, res) => {
  try {
    await pool.query('DELETE FROM evenements_locaux WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[TOURS] Erreur suppression événement :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════ REPORTING & ALERTES ══════

// GET /api/tours/reporting/kpis — KPIs globaux des tournées
router.get('/reporting/kpis', async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const from = date_from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const to = date_to || new Date().toISOString().split('T')[0];

    const kpis = await pool.query(`
      SELECT
        COUNT(*) as total_tours,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as tours_completees,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as tours_annulees,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN total_weight_kg ELSE 0 END), 0) as poids_total_kg,
        COALESCE(AVG(CASE WHEN status = 'completed' THEN total_weight_kg END), 0) as poids_moyen_kg,
        COALESCE(AVG(CASE WHEN status = 'completed' THEN EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600 END), 0) as duree_moyenne_h
      FROM tours
      WHERE date BETWEEN $1 AND $2
    `, [from, to]);

    const cavStats = await pool.query(`
      SELECT
        COUNT(*) as total_cav_planifies,
        COUNT(CASE WHEN tc.status = 'collected' THEN 1 END) as cav_collectes,
        COUNT(CASE WHEN tc.status = 'skipped' THEN 1 END) as cav_ignores
      FROM tour_cav tc
      JOIN tours t ON tc.tour_id = t.id
      WHERE t.date BETWEEN $1 AND $2
    `, [from, to]);

    const driverKpis = await pool.query(`
      SELECT
        u.id, u.first_name, u.last_name,
        COUNT(t.id) as nb_tours,
        COALESCE(SUM(t.total_weight_kg), 0) as total_kg,
        COALESCE(AVG(t.total_weight_kg), 0) as avg_kg_par_tour,
        COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as tours_completees
      FROM tours t
      JOIN users u ON t.driver_id = u.id
      WHERE t.date BETWEEN $1 AND $2
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY total_kg DESC
    `, [from, to]);

    res.json({
      period: { from, to },
      global: kpis.rows[0],
      cav: cavStats.rows[0],
      drivers: driverKpis.rows,
    });
  } catch (err) {
    console.error('[TOURS] Erreur KPIs :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/reporting/anomalies — Détection d'anomalies
router.get('/reporting/anomalies', async (req, res) => {
  try {
    const anomalies = [];

    // Tours complétées sans poids
    const noWeight = await pool.query(`
      SELECT id, date, driver_id FROM tours
      WHERE status = 'completed' AND (total_weight_kg IS NULL OR total_weight_kg = 0)
      AND date >= NOW() - INTERVAL '30 days'
      ORDER BY date DESC LIMIT 20
    `);
    for (const t of noWeight.rows) {
      anomalies.push({ type: 'tour_sans_poids', severity: 'warning', tour_id: t.id, date: t.date,
        message: `Tournée #${t.id} complétée sans poids enregistré` });
    }

    // CAVs planifiés mais non collectés
    const skippedCavs = await pool.query(`
      SELECT tc.tour_id, tc.cav_id, c.nom as cav_nom, t.date
      FROM tour_cav tc
      JOIN tours t ON tc.tour_id = t.id
      JOIN cav c ON tc.cav_id = c.id
      WHERE t.status = 'completed' AND tc.status != 'collected'
      AND t.date >= NOW() - INTERVAL '7 days'
      ORDER BY t.date DESC LIMIT 30
    `);
    for (const s of skippedCavs.rows) {
      anomalies.push({ type: 'cav_non_collecte', severity: 'info', tour_id: s.tour_id,
        cav_id: s.cav_id, cav_nom: s.cav_nom, date: s.date,
        message: `CAV "${s.cav_nom}" non collecté lors de la tournée #${s.tour_id}` });
    }

    // Poids aberrants (> 2x la moyenne)
    const avgWeight = await pool.query(`
      SELECT AVG(total_weight_kg) as avg, STDDEV(total_weight_kg) as stddev
      FROM tours WHERE status = 'completed' AND total_weight_kg > 0
    `);
    if (avgWeight.rows[0].avg) {
      const threshold = parseFloat(avgWeight.rows[0].avg) + 2 * parseFloat(avgWeight.rows[0].stddev || 0);
      const outliers = await pool.query(`
        SELECT id, date, total_weight_kg FROM tours
        WHERE status = 'completed' AND total_weight_kg > $1
        AND date >= NOW() - INTERVAL '30 days'
        ORDER BY total_weight_kg DESC LIMIT 10
      `, [threshold]);
      for (const o of outliers.rows) {
        anomalies.push({ type: 'poids_aberrant', severity: 'warning', tour_id: o.id,
          date: o.date, weight: o.total_weight_kg,
          message: `Poids anormalement élevé: ${o.total_weight_kg}kg (moyenne: ${Math.round(avgWeight.rows[0].avg)}kg)` });
      }
    }

    // Tours sans mouvement de stock associé
    const noStock = await pool.query(`
      SELECT t.id, t.date, t.total_weight_kg FROM tours t
      LEFT JOIN stock_movements sm ON sm.tour_id = t.id
      WHERE t.status = 'completed' AND t.total_weight_kg > 0
      AND sm.id IS NULL AND t.date >= NOW() - INTERVAL '30 days'
      ORDER BY t.date DESC LIMIT 20
    `);
    for (const n of noStock.rows) {
      anomalies.push({ type: 'stock_manquant', severity: 'error', tour_id: n.id,
        date: n.date, weight: n.total_weight_kg,
        message: `Tournée #${n.id} (${n.total_weight_kg}kg) sans entrée de stock` });
    }

    res.json(anomalies);
  } catch (err) {
    console.error('[TOURS] Erreur anomalies :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/reporting/cav-analytics — Analytiques par CAV
router.get('/reporting/cav-analytics', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id, c.nom, c.commune, c.type,
        COUNT(tc.id) as nb_collectes,
        COALESCE(SUM(th.weight_kg), 0) as total_kg,
        COALESCE(AVG(th.weight_kg), 0) as avg_kg,
        MAX(t.date) as derniere_collecte,
        COALESCE(AVG(tc.fill_level), 0) as avg_fill_level
      FROM cav c
      LEFT JOIN tour_cav tc ON tc.cav_id = c.id AND tc.status = 'collected'
      LEFT JOIN tours t ON tc.tour_id = t.id AND t.status = 'completed'
      LEFT JOIN tonnage_history th ON th.cav_id = c.id
      WHERE c.is_active = true
      GROUP BY c.id, c.nom, c.commune, c.type
      ORDER BY total_kg DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[TOURS] Erreur analytics CAV :', err);
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
router.post('/intelligent', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { vehicle_id, date, driver_employee_id } = req.body;
    if (!vehicle_id || !date) {
      return res.status(400).json({ error: 'vehicle_id et date requis' });
    }

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
router.post('/standard', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { vehicle_id, date, driver_employee_id, standard_route_id } = req.body;
    if (!vehicle_id || !date || !standard_route_id) {
      return res.status(400).json({ error: 'vehicle_id, date et standard_route_id requis' });
    }

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
router.post('/manual', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { vehicle_id, date, driver_employee_id, cav_ids } = req.body;
    if (!vehicle_id || !date || !cav_ids?.length) {
      return res.status(400).json({ error: 'vehicle_id, date et cav_ids requis' });
    }

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

// PUT /api/tours/:id/status — Changer le statut
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['planned', 'in_progress', 'paused', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    const updates = ['status = $1', 'updated_at = NOW()'];
    const params = [status];

    if (status === 'in_progress') updates.push('started_at = NOW()');
    if (status === 'completed') updates.push('completed_at = NOW()');

    // Auto-assigner le chauffeur connecté si pas encore assigné
    if (status === 'in_progress' && req.user) {
      const empRes = await pool.query('SELECT id FROM employees WHERE user_id = $1', [req.user.id]);
      if (empRes.rows.length > 0) {
        params.push(empRes.rows[0].id);
        updates.push(`driver_employee_id = COALESCE(driver_employee_id, $${params.length})`);
      }
    }

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE tours SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });

    // Remettre le véhicule en available si terminé
    if (status === 'completed' || status === 'cancelled') {
      const tour = result.rows[0];
      await pool.query("UPDATE vehicles SET status = 'available' WHERE id = $1", [tour.vehicle_id]);

      // Mettre à jour le tonnage dans l'historique si complété
      if (status === 'completed' && tour.total_weight_kg > 0) {
        const cavs = await pool.query(
          "SELECT cav_id FROM tour_cav WHERE tour_id = $1 AND status = 'collected'",
          [req.params.id]
        );
        const weightPerCav = tour.total_weight_kg / (cavs.rows.length || 1);
        for (const tc of cavs.rows) {
          await pool.query(
            "INSERT INTO tonnage_history (date, cav_id, weight_kg, source) VALUES ($1, $2, $3, 'mobile')",
            [tour.date, tc.cav_id, weightPerCav]
          );
        }

        // Création automatique du mouvement de stock (entrée matière première)
        await pool.query(
          `INSERT INTO stock_movements (type, date, poids_kg, tour_id, vehicle_id, origine, notes, created_by)
           VALUES ('entree', $1, $2, $3, $4, 'collecte', $5, $6)`,
          [tour.date, tour.total_weight_kg, parseInt(req.params.id), tour.vehicle_id,
           `Auto: tournée #${req.params.id} (${cavs.rows.length} CAV collectés)`, req.user.id]
        );
      }

      // Apprentissage continu : enregistrer prédit vs observé (fill_level 0-5)
      if (status === 'completed') {
        const tourCavs = await pool.query(
          'SELECT cav_id, predicted_fill_rate, fill_level FROM tour_cav WHERE tour_id = $1 AND predicted_fill_rate IS NOT NULL AND fill_level IS NOT NULL',
          [req.params.id]
        );
        for (const tc of tourCavs.rows) {
          await pool.query(
            `INSERT INTO collection_learning_feedback (tour_id, cav_id, predicted_fill_rate, observed_fill_level)
             VALUES ($1, $2, $3, $4)`,
            [req.params.id, tc.cav_id, tc.predicted_fill_rate, tc.fill_level]
          );
        }
      }
    } else if (status === 'in_progress') {
      const tour = result.rows[0];
      await pool.query("UPDATE vehicles SET status = 'in_use' WHERE id = $1", [tour.vehicle_id]);
    }

    // Émettre l'événement Socket.io
    const io = req.app.get('io');
    if (io) io.to(`tour-${req.params.id}`).emit('tour-status-update', { tourId: req.params.id, status });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur changement statut :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/:tourId/cav/:cavId — Mettre à jour un CAV de tournée
router.put('/:tourId/cav/:cavId', async (req, res) => {
  try {
    const { status, fill_level, qr_scanned, qr_unavailable, qr_unavailable_reason, notes } = req.body;

    const result = await pool.query(
      `UPDATE tour_cav SET status = COALESCE($1, status),
       fill_level = COALESCE($2, fill_level),
       qr_scanned = COALESCE($3, qr_scanned),
       qr_unavailable = COALESCE($4, qr_unavailable),
       qr_unavailable_reason = COALESCE($5, qr_unavailable_reason),
       notes = COALESCE($6, notes),
       collected_at = CASE WHEN $1 = 'collected' THEN NOW() ELSE collected_at END
       WHERE tour_id = $7 AND cav_id = $8 RETURNING *`,
      [status, fill_level, qr_scanned, qr_unavailable, qr_unavailable_reason, notes, req.params.tourId, req.params.cavId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'CAV de tournée non trouvé' });

    // Socket.io broadcast
    const io = req.app.get('io');
    if (io) io.to(`tour-${req.params.tourId}`).emit('cav-status-update', result.rows[0]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur MAJ CAV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/weigh — Enregistrer une pesée
router.post('/:id/weigh', async (req, res) => {
  try {
    const { weight_kg, employee_id } = req.body;
    if (!weight_kg) return res.status(400).json({ error: 'Poids requis' });

    const result = await pool.query(
      'INSERT INTO tour_weights (tour_id, weight_kg, recorded_by) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, weight_kg, employee_id || null]
    );

    // Mettre à jour le total de la tournée
    await pool.query(
      'UPDATE tours SET total_weight_kg = (SELECT COALESCE(SUM(weight_kg), 0) FROM tour_weights WHERE tour_id = $1) WHERE id = $1',
      [req.params.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur pesée :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/checklist — Checklist véhicule
router.post('/:id/checklist', async (req, res) => {
  try {
    const { vehicle_id, employee_id, exterior_ok, fuel_level, km_start } = req.body;

    const result = await pool.query(
      `INSERT INTO vehicle_checklists (tour_id, vehicle_id, employee_id, exterior_ok, fuel_level, km_start)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, vehicle_id, employee_id, exterior_ok, fuel_level, km_start]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur checklist :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/:id/checklist/end — Finaliser checklist (km fin)
router.put('/:id/checklist/end', async (req, res) => {
  try {
    const { km_end } = req.body;
    const result = await pool.query(
      'UPDATE vehicle_checklists SET km_end = $1 WHERE tour_id = $2 RETURNING *',
      [km_end, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Checklist non trouvée' });

    // Mettre à jour le km du véhicule
    if (km_end) {
      await pool.query(
        'UPDATE vehicles SET current_km = $1, updated_at = NOW() WHERE id = $2',
        [km_end, result.rows[0].vehicle_id]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur fin checklist :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/incidents — Signaler un incident
router.post('/:id/incidents', upload.single('photo'), async (req, res) => {
  try {
    const { cav_id, employee_id, vehicle_id, type, description } = req.body;
    const photo_path = req.file ? `/uploads/incidents/${req.file.filename}` : null;

    const result = await pool.query(
      `INSERT INTO incidents (tour_id, cav_id, employee_id, vehicle_id, type, description, photo_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.id, cav_id, employee_id, vehicle_id, type, description, photo_path]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur incident :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/:id/gps — Positions GPS
router.get('/:id/gps', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM gps_positions WHERE tour_id = $1 ORDER BY recorded_at',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[TOURS] Erreur GPS :', err);
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
router.post('/routes', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { name, description, cav_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'Nom requis' });

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

// ══════════════════════════════════════════════════════════════
// MOTEUR PRÉDICTIF V2 — ENDPOINTS AVANCÉS
// ══════════════════════════════════════════════════════════════

// GET /api/tours/predictive/accuracy — Précision du moteur prédictif
// Mesure la qualité des prédictions sur les N derniers jours
router.get('/predictive/accuracy', authorize('ADMIN'), async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    // Précision globale : écart moyen prédit vs observé
    const global = await pool.query(`
      SELECT
        COUNT(*) as total_samples,
        AVG(ABS(predicted_fill_rate - (observed_fill_level * 20))) as mae,
        SQRT(AVG(POWER(predicted_fill_rate - (observed_fill_level * 20), 2))) as rmse,
        AVG(predicted_fill_rate) as avg_predicted,
        AVG(observed_fill_level * 20) as avg_observed,
        CORR(predicted_fill_rate, observed_fill_level * 20) as correlation
      FROM collection_learning_feedback
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        AND observed_fill_level IS NOT NULL
    `, [days]);

    // Précision par CAV (top 10 meilleurs et pires)
    const perCav = await pool.query(`
      SELECT
        clf.cav_id,
        c.name as cav_name,
        c.commune,
        COUNT(*) as samples,
        AVG(ABS(clf.predicted_fill_rate - (clf.observed_fill_level * 20))) as mae,
        SQRT(AVG(POWER(clf.predicted_fill_rate - (clf.observed_fill_level * 20), 2))) as rmse,
        AVG(clf.predicted_fill_rate - (clf.observed_fill_level * 20)) as bias
      FROM collection_learning_feedback clf
      JOIN cav c ON clf.cav_id = c.id
      WHERE clf.created_at >= NOW() - INTERVAL '1 day' * $1
        AND clf.observed_fill_level IS NOT NULL
      GROUP BY clf.cav_id, c.name, c.commune
      HAVING COUNT(*) >= 3
      ORDER BY mae ASC
    `, [days]);

    // Évolution de la précision dans le temps (par semaine)
    const trend = await pool.query(`
      SELECT
        DATE_TRUNC('week', created_at) as week,
        COUNT(*) as samples,
        AVG(ABS(predicted_fill_rate - (observed_fill_level * 20))) as mae,
        SQRT(AVG(POWER(predicted_fill_rate - (observed_fill_level * 20), 2))) as rmse
      FROM collection_learning_feedback
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        AND observed_fill_level IS NOT NULL
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week ASC
    `, [days]);

    // Distribution des erreurs (pour histogramme)
    const errorDist = await pool.query(`
      SELECT
        CASE
          WHEN ABS(predicted_fill_rate - (observed_fill_level * 20)) < 5 THEN 'excellent (<5%)'
          WHEN ABS(predicted_fill_rate - (observed_fill_level * 20)) < 10 THEN 'bon (5-10%)'
          WHEN ABS(predicted_fill_rate - (observed_fill_level * 20)) < 20 THEN 'moyen (10-20%)'
          WHEN ABS(predicted_fill_rate - (observed_fill_level * 20)) < 30 THEN 'faible (20-30%)'
          ELSE 'mauvais (>30%)'
        END as category,
        COUNT(*) as count
      FROM collection_learning_feedback
      WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        AND observed_fill_level IS NOT NULL
      GROUP BY category
      ORDER BY count DESC
    `, [days]);

    const stats = global.rows[0];
    res.json({
      period: { days, from: new Date(Date.now() - days * 86400000).toISOString().split('T')[0] },
      global: {
        totalSamples: parseInt(stats.total_samples),
        mae: stats.mae ? Math.round(parseFloat(stats.mae) * 10) / 10 : null,
        rmse: stats.rmse ? Math.round(parseFloat(stats.rmse) * 10) / 10 : null,
        avgPredicted: stats.avg_predicted ? Math.round(parseFloat(stats.avg_predicted)) : null,
        avgObserved: stats.avg_observed ? Math.round(parseFloat(stats.avg_observed)) : null,
        correlation: stats.correlation ? Math.round(parseFloat(stats.correlation) * 100) / 100 : null,
        modelVersion: 'predictive_v2',
      },
      perCav: perCav.rows.map(r => ({
        cavId: r.cav_id,
        cavName: r.cav_name,
        commune: r.commune,
        samples: parseInt(r.samples),
        mae: Math.round(parseFloat(r.mae) * 10) / 10,
        rmse: Math.round(parseFloat(r.rmse) * 10) / 10,
        bias: Math.round(parseFloat(r.bias) * 10) / 10,
      })),
      weeklyTrend: trend.rows.map(r => ({
        week: r.week,
        samples: parseInt(r.samples),
        mae: Math.round(parseFloat(r.mae) * 10) / 10,
        rmse: Math.round(parseFloat(r.rmse) * 10) / 10,
      })),
      errorDistribution: errorDist.rows.map(r => ({
        category: r.category,
        count: parseInt(r.count),
      })),
    });
  } catch (err) {
    console.error('[TOURS] Erreur accuracy :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/predictive/export-training — Export des données d'entraînement ML
// Format prêt pour XGBoost/scikit-learn : une ligne par (CAV, date) avec tous les features
router.get('/predictive/export-training', authorize('ADMIN'), async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 365;
    const format = req.query.format || 'json'; // json ou csv

    const result = await pool.query(`
      SELECT
        th.cav_id,
        c.name as cav_name,
        c.commune,
        c.latitude,
        c.longitude,
        c.nb_containers,
        th.date,
        th.weight_kg,
        EXTRACT(MONTH FROM th.date) as month,
        EXTRACT(DOW FROM th.date) as day_of_week,
        EXTRACT(DOY FROM th.date) as day_of_year,
        cc.weather_code,
        cc.weather_factor,
        cc.temp_max,
        cc.precip_mm,
        cc.traffic_factor,
        cc.duration_factor,
        clf.predicted_fill_rate,
        clf.observed_fill_level,
        (SELECT MAX(th2.date) FROM tonnage_history th2
         WHERE th2.cav_id = th.cav_id AND th2.date < th.date) as prev_collection_date,
        (SELECT th2.weight_kg FROM tonnage_history th2
         WHERE th2.cav_id = th.cav_id AND th2.date < th.date
         ORDER BY th2.date DESC LIMIT 1) as prev_weight_kg,
        (SELECT AVG(th2.weight_kg) FROM tonnage_history th2
         WHERE th2.cav_id = th.cav_id
         AND th2.date BETWEEN th.date - INTERVAL '30 days' AND th.date - INTERVAL '1 day') as avg_weight_30d,
        (SELECT COUNT(*) FROM tonnage_history th2
         WHERE th2.cav_id = th.cav_id
         AND th2.date BETWEEN th.date - INTERVAL '30 days' AND th.date) as collections_30d
      FROM tonnage_history th
      JOIN cav c ON th.cav_id = c.id
      LEFT JOIN collection_context cc ON cc.date = th.date
      LEFT JOIN collection_learning_feedback clf ON clf.cav_id = th.cav_id
        AND DATE(clf.created_at) = th.date
      WHERE th.date >= NOW() - INTERVAL '1 day' * $1
      ORDER BY th.date DESC, th.cav_id
    `, [days]);

    // Enrichir avec les features calculés
    const rows = result.rows.map(r => {
      const prevDate = r.prev_collection_date;
      const daysSince = prevDate ? Math.floor((new Date(r.date) - new Date(prevDate)) / 86400000) : null;
      const monthIdx = parseInt(r.month) - 1;
      const dow = parseInt(r.day_of_week);
      const dowIdx = dow === 0 ? 6 : dow - 1;

      return {
        cav_id: r.cav_id,
        cav_name: r.cav_name,
        commune: r.commune,
        latitude: r.latitude ? parseFloat(r.latitude) : null,
        longitude: r.longitude ? parseFloat(r.longitude) : null,
        nb_containers: r.nb_containers,
        date: r.date,
        weight_kg: parseFloat(r.weight_kg),
        month: parseInt(r.month),
        day_of_week: dowIdx,
        day_of_year: parseInt(r.day_of_year),
        seasonal_factor: SEASONAL_FACTORS[monthIdx],
        dow_factor: DAY_OF_WEEK_FACTORS[dowIdx],
        is_holiday: isHoliday(r.date.toISOString ? r.date.toISOString().split('T')[0] : r.date) ? 1 : 0,
        vacation_status: getSchoolVacationStatus(r.date.toISOString ? r.date.toISOString().split('T')[0] : r.date).status || 'none',
        weather_code: r.weather_code,
        weather_factor: r.weather_factor ? parseFloat(r.weather_factor) : null,
        temp_max: r.temp_max ? parseFloat(r.temp_max) : null,
        precip_mm: r.precip_mm ? parseFloat(r.precip_mm) : null,
        days_since_prev: daysSince,
        prev_weight_kg: r.prev_weight_kg ? parseFloat(r.prev_weight_kg) : null,
        avg_weight_30d: r.avg_weight_30d ? parseFloat(r.avg_weight_30d) : null,
        collections_30d: parseInt(r.collections_30d) || 0,
        predicted_fill: r.predicted_fill_rate ? parseFloat(r.predicted_fill_rate) : null,
        observed_fill: r.observed_fill_level != null ? parseInt(r.observed_fill_level) * 20 : null,
      };
    });

    if (format === 'csv') {
      if (rows.length === 0) return res.status(200).send('');
      const headers = Object.keys(rows[0]);
      const csv = [headers.join(',')].concat(
        rows.map(r => headers.map(h => r[h] ?? '').join(','))
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=solidata_training_data.csv');
      return res.send(csv);
    }

    res.json({
      exportDate: new Date().toISOString(),
      period: { days },
      totalRows: rows.length,
      features: rows.length > 0 ? Object.keys(rows[0]) : [],
      data: rows,
    });
  } catch (err) {
    console.error('[TOURS] Erreur export training :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/predictive/cav-correlations — Corrélations entre CAV
// Identifie les CAV qui ont des patterns similaires (pour prédiction croisée)
router.get('/predictive/cav-correlations', authorize('ADMIN'), async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 90;

    // Trouver les paires de CAV avec des collectes aux mêmes dates
    const result = await pool.query(`
      WITH cav_timeseries AS (
        SELECT cav_id, date, weight_kg
        FROM tonnage_history
        WHERE date >= NOW() - INTERVAL '1 day' * $1
      )
      SELECT
        a.cav_id as cav_a,
        b.cav_id as cav_b,
        COUNT(*) as common_dates,
        CORR(a.weight_kg, b.weight_kg) as correlation,
        AVG(a.weight_kg) as avg_a,
        AVG(b.weight_kg) as avg_b
      FROM cav_timeseries a
      JOIN cav_timeseries b ON a.date = b.date AND a.cav_id < b.cav_id
      GROUP BY a.cav_id, b.cav_id
      HAVING COUNT(*) >= 5 AND CORR(a.weight_kg, b.weight_kg) IS NOT NULL
      ORDER BY ABS(CORR(a.weight_kg, b.weight_kg)) DESC
      LIMIT 50
    `, [days]);

    // Enrichir avec les noms
    const cavIds = new Set();
    result.rows.forEach(r => { cavIds.add(r.cav_a); cavIds.add(r.cav_b); });
    const cavNames = {};
    if (cavIds.size > 0) {
      const names = await pool.query(
        'SELECT id, name, commune FROM cav WHERE id = ANY($1)',
        [Array.from(cavIds)]
      );
      names.rows.forEach(r => { cavNames[r.id] = { name: r.name, commune: r.commune }; });
    }

    const correlations = result.rows.map(r => ({
      cavA: { id: r.cav_a, ...cavNames[r.cav_a] },
      cavB: { id: r.cav_b, ...cavNames[r.cav_b] },
      commonDates: parseInt(r.common_dates),
      correlation: Math.round(parseFloat(r.correlation) * 100) / 100,
      avgWeightA: Math.round(parseFloat(r.avg_a) * 10) / 10,
      avgWeightB: Math.round(parseFloat(r.avg_b) * 10) / 10,
    }));

    // Séparer corrélations positives (similaires) et négatives (inverses)
    const positive = correlations.filter(c => c.correlation > 0.5);
    const negative = correlations.filter(c => c.correlation < -0.3);

    res.json({
      period: { days },
      totalPairs: correlations.length,
      strongPositive: positive,
      strongNegative: negative,
      all: correlations,
    });
  } catch (err) {
    console.error('[TOURS] Erreur corrélations :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

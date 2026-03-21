const pool = require('../../config/database');
const { getContextForDate, getLocalEventsForDate, isEventNearCav } = require('./context');
const { haversineDistance } = require('./geo');

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
    if (isEventNearCav(evt, cav, haversineDistance)) {
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

// Getters and setters for mutable config (used by predictive-config routes)
function getSeasonalFactors() { return SEASONAL_FACTORS; }
function setSeasonalFactors(v) { SEASONAL_FACTORS = v; }
function getDayOfWeekFactors() { return DAY_OF_WEEK_FACTORS; }
function setDayOfWeekFactors(v) { DAY_OF_WEEK_FACTORS = v; }
function getHolidays() { return FRENCH_HOLIDAYS_2026; }
function setHolidays(v) { FRENCH_HOLIDAYS_2026 = v; }
function getSchoolVacations() { return SCHOOL_VACATIONS; }
function setSchoolVacations(v) { SCHOOL_VACATIONS = v; }
function getScoringConfig() { return SCORING_CONFIG; }
function setScoringConfig(v) { SCORING_CONFIG = v; }

module.exports = {
  predictFillRate,
  isHoliday,
  getSchoolVacationStatus,
  getSeasonalFactors,
  setSeasonalFactors,
  getDayOfWeekFactors,
  setDayOfWeekFactors,
  getHolidays,
  setHolidays,
  getSchoolVacations,
  setSchoolVacations,
  getScoringConfig,
  setScoringConfig,
};

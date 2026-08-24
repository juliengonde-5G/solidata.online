const pool = require('../../config/database');
const { getContextForDate, getLocalEventsForDate, isEventNearCav } = require('./context');
const { haversineDistance } = require('./geo');
const fillFactors = require('../../utils/fill-factors');
// Pondération météo APPRISE (semaine/week-end × beau temps) — le module ne
// require predictions qu'en paresseux : pas de cycle.
const weatherLearning = require('../../services/weather-learning');

// ══════════════════════════════════════════════════════════════
// MOTEUR DE PRÉDICTION DE REMPLISSAGE (IA)
// ══════════════════════════════════════════════════════════════
//
// Les facteurs saisonniers / jour-de-semaine ont UNE SEULE source de vérité :
// `utils/fill-factors.js` (item 50). Les tableaux ci-dessous ne sont plus que
// la couche "MANUEL" en mémoire (miroir de la config persistée dans settings)
// exposée via les getters/setters historiques (proposals.js, stats.js…).
// Le moteur lui-même (predictFillRate) consomme les facteurs EFFECTIFS résolus
// (appris > manuel > défaut) via fillFactors.getResolvedFactors().

// Facteurs saisonniers mensuels (jan→déc) — défaut codé (source unique fill-factors).
let SEASONAL_FACTORS = [...fillFactors.SEASONAL_DEFAULT];

// Facteurs jour de la semaine (lun→dim) — défaut codé (source unique fill-factors).
// Lundi le plus lourd (accumulation weekend), jeudi bas (~50%), pas de collecte sam/dim.
let DAY_OF_WEEK_FACTORS = [...fillFactors.DOW_DEFAULT];

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
  // Vitesse moyenne de REPLI (km/h) : réellement consommée dès qu'OSRM est
  // indisponible (geo.js, planned-passage.js, reoptimize-service.js) — avant
  // août 2026 elle n'était lue nulle part et trois constantes divergentes
  // (30 / 28 / 28) vivaient en dur dans ces trois fichiers.
  avgSpeed: 30,
  timePerCav: 10,        // min par CAV (défaut si aucun temps appris)
  // ── Contraintes de journée de travail (exigences client, août 2026) ──
  // La journée est plafonnée à 6 h de TRAVAIL (conduite + collecte +
  // déchargements). La pause déjeuner est HORS temps de travail.
  maxDailyHours: 6,
  workdayStartHour: 8,   // heure de départ par défaut pour les estimations
  lunchStartHour: 12,    // heure à partir de laquelle la pause devient due
  unloadMinutes: 15,     // déchargement au centre de tri (compté en travail)
  vehicleFillReturnPct: 90,     // % de la capacité déclenchant un retour de vidage
  saturationThresholdPct: 90,   // % de remplissage à partir duquel un CAV est « saturé »
  // Seuil kg historique. Le seuil EFFECTIF est le plus contraignant des deux :
  // min(returnEveryKg ; vehicleFillReturnPct % × capacité du véhicule réel).
  returnEveryKg: 2000,
  historyDays: 180,      // jours d'historique analysés
  weeklyCollectionCycle: 7, // hypothèse collecte hebdomadaire
  densityThreshold: 3,   // nb conteneurs pour bonus densité
  densityBonus: 1.1,
  holidayBonus: 1.1,
  maxFillCap: 120,
  weekendSunnyBonus: 1.15,  // beau temps le weekend → plus de tri (REPLI tant
                            // que l'apprentissage météo n'a pas produit)
  beauTempsTempMin: 15,     // « beau temps » = temp. max ≥ 15 °C…
  beauTempsPrecipMm: 1,     // …et pluie < 1 mm (partagé apprentissage/moteur)
  localEventBonus: 1.2,     // brocante/vide-grenier à proximité
  // Vacances scolaires — calibrés sur données réelles 2025-2026
  // Hors été : baisse ~10% (routes moins fréquentes, moins de dépôts)
  // Été : déjà capté par les facteurs saisonniers juil/août
  schoolVacationFactor: 0.90,    // pendant les vacances (hors été)
  summerVacationFactor: 1.0,     // été (neutre, déjà dans facteurs saisonniers)
  preVacationBonus: 1.05,        // semaine avant (léger surcroît de tri)
  postVacationBonus: 1.05,       // semaine après (retour, vidage)
  lunchBreakMinutes: 30,         // durée pause déjeuner (minutes)
  lunchAfterHours: 4,            // déclencher la pause après N heures de travail
  cavProximityRadius: 100,       // rayon en mètres pour détecter arrivée/départ GPS d'un CAV
  // ── Optimisation des tournées (CO2 & efficacité, août 2026) ──────────
  // `objectif` arbitre entre les deux grandeurs que le client veut optimiser :
  //   'distance' = CO2 pur (les émissions sont proportionnelles aux km)
  //   'duree'    = efficacité pure (le budget de 6 h est la vraie contrainte)
  //   'mixte'    = pondération des deux (défaut)
  reoptimObjectif: 'mixte',
  reoptimPoidsDistance: 0.5,   // pondération CO2 dans l'objectif « mixte »
  reoptimPoidsDuree: 0.5,      // pondération efficacité
  reoptimGainMinPct: 5,        // gain minimal pour proposer un nouvel ordre
  reoptimIntervalMin: 15,      // cadence du recalcul en cours de tournée (min)
  // Application AUTOMATIQUE du nouvel ordre. Désactivée par défaut : changer
  // l'itinéraire d'un chauffeur en cours de route est une décision
  // d'exploitation, pas un effet de bord d'un calcul.
  reoptimAuto: false,
  reoptimAutoGainMinPct: 12,   // seuil, plus élevé, de l'application auto
};

// ──────────────────────────────────────────────────────────────
// Persistance de la config prédictive (item 49)
// La config (facteurs manuels, jours fériés, vacances, scoring) était mutée
// EN MÉMOIRE par PUT /predictive-config → perdue à chaque redéploiement.
// Elle est désormais persistée dans `settings` (via fill-factors) et rechargée
// paresseusement au démarrage dans les variables de module ci-dessus.
// ──────────────────────────────────────────────────────────────
let _configLoaded = null;

async function loadPersistedConfig() {
  const cfg = await fillFactors.getPersistedConfig();
  if (!cfg || typeof cfg !== 'object') return;
  if (Array.isArray(cfg.seasonalFactors) && cfg.seasonalFactors.length === 12) {
    SEASONAL_FACTORS = cfg.seasonalFactors.map(Number);
  }
  if (Array.isArray(cfg.dayOfWeekFactors) && cfg.dayOfWeekFactors.length === 7) {
    DAY_OF_WEEK_FACTORS = cfg.dayOfWeekFactors.map(Number);
  }
  if (Array.isArray(cfg.holidays)) FRENCH_HOLIDAYS_2026 = cfg.holidays;
  if (Array.isArray(cfg.schoolVacations)) {
    SCHOOL_VACATIONS = cfg.schoolVacations.filter((v) => v && v.name && v.start && v.end);
  }
  if (cfg.scoring && typeof cfg.scoring === 'object') {
    SCORING_CONFIG = { ...SCORING_CONFIG, ...cfg.scoring };
  }
}

// Idempotent : charge la config persistée une seule fois (mémoïsé).
function ensureConfigLoaded() {
  if (!_configLoaded) {
    _configLoaded = loadPersistedConfig().catch((err) => {
      console.warn('[PREDICTIONS] Config persistée non chargée :', err.message);
    });
  }
  return _configLoaded;
}

// Recharge forcée après un PUT /predictive-config.
function reloadPersistedConfig() {
  _configLoaded = loadPersistedConfig().catch((err) => {
    console.warn('[PREDICTIONS] Rechargement config échoué :', err.message);
  });
  return _configLoaded;
}

// Déclenche le chargement au require du module (fire-and-forget) pour que les
// getters synchrones (proposals.js, stats.js) voient rapidement la config.
ensureConfigLoaded();

function isHoliday(dateStr) {
  return FRENCH_HOLIDAYS_2026.includes(dateStr);
}

// Convertit une ligne de feedback en % observé (0-120), par ordre de fiabilité :
//   1. capteur          — observed_fill_rate (DOUBLE 0-120), vérité terrain ;
//   2. saisie chauffeur — observed_fill_percent, le POURCENTAGE RÉELLEMENT
//      choisi sur le téléphone (« un fond » 10 %, « à moitié » 50 %,
//      « au-delà » 110 %…) ;
//   3. repli historique — observed_fill_level (INTEGER 0-5) × 20.
//
// Le repli ×20 suppose que 5 = 100 %, or l'écran mobile plafonne à 4 : « plein »
// y était donc appris comme 80 %, et toutes les observations sous-estimées de
// 20 points — le moteur croyait les bornes moins remplies qu'annoncé et
// proposait les collectes trop tard. Le pourcentage réel (2.) lève cette
// distorsion ; le repli reste pour les lignes historiques, qui n'ont pas mieux.
function observedPercentFromRow(row) {
  if (row.observed_fill_rate != null && Number.isFinite(parseFloat(row.observed_fill_rate))) {
    return Math.max(0, Math.min(120, parseFloat(row.observed_fill_rate)));
  }
  if (row.observed_fill_percent != null && Number.isFinite(parseFloat(row.observed_fill_percent))) {
    return Math.max(0, Math.min(120, parseFloat(row.observed_fill_percent)));
  }
  if (row.observed_fill_level != null && Number.isFinite(parseInt(row.observed_fill_level, 10))) {
    return Math.max(0, Math.min(120, parseInt(row.observed_fill_level, 10) * 20));
  }
  return null;
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
  await ensureConfigLoaded();
  const resolved = await fillFactors.getResolvedFactors();
  const now = new Date(targetDate || Date.now());
  const monthIndex = now.getMonth();
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // 0=lun, 6=dim
  const dateStr = now.toISOString().split('T')[0];

  // Facteurs EFFECTIFS (appris > manuel > défaut), source unique fill-factors.
  const seasonalFactor = fillFactors.seasonalFactorFor(resolved, monthIndex);
  const dayFactor = fillFactors.dayFactorFor(resolved, now.getDay());

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
  // Jalon de remise à zéro : le moteur ne remonte jamais avant cette date —
  // tous les CAV y sont réputés vides (aucun tonnage n'est supprimé pour autant).
  const lastCollection = fillFactors.effectiveLastCollection(history[0].date, await fillFactors.getResetDate());
  const daysSince = Math.floor((now - lastCollection) / 86400000);

  // Cadence moyenne RÉELLE entre collectes (fallback 7 j) — cohérent avec
  // cav.js /fill-rate. L'ancienne hypothèse « collecte hebdomadaire » (avgWeight/7)
  // surestimait l'accumulation des CAV collectés moins souvent.
  let avgDaysBetween = 7;
  if (history.length >= 2) {
    const times = history.map((h) => new Date(h.date).getTime()).sort((a, b) => b - a);
    let gapSum = 0, gaps = 0;
    for (let i = 0; i < times.length - 1; i++) {
      const g = (times[i] - times[i + 1]) / 86400000;
      if (g > 0) { gapSum += g; gaps++; }
    }
    if (gaps > 0) avgDaysBetween = gapSum / gaps;
  }

  // ── Calcul du remplissage NORMALISÉ PAR LA CAPACITÉ (item 48) ──
  // kg accumulés ÷ (nb conteneurs × 150 kg) × 100, saisonnier + jour inclus.
  // Remplace l'ancienne formule dimensionnellement incohérente (kg traités
  // comme des %) qui saturait systématiquement à 100-120 %.
  let rawFill = fillFactors.computeBaseFillPercent({
    daysSinceCollection: daysSince,
    avgWeightKg: avgWeight,
    avgDaysBetween,
    nbContainers: cav.nb_containers,
    seasonalFactor,
    dayFactor,
    maxFill: SCORING_CONFIG.maxFillCap || 120,
  });

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

  // Beau temps = plus de dépôts (les gens trient/rangent), surtout le week-end.
  // Pondération APPRISE depuis l'expérience réelle (intervalles entre collectes
  // croisés avec la météo quotidienne — services/weather-learning.js, job
  // mensuel). Les RATIOS d'interaction sont appliqués (beau vs autre, à type de
  // jour égal) : l'effet week-end « de base » reste porté par les facteurs
  // jour-de-semaine appris — pas de double compte. Tant que l'apprentissage n'a
  // pas assez de données : règle historique (week-end ensoleillé ×1.15).
  const isWeekend = (dayOfWeek >= 5); // 5=sam, 6=dim
  const beauJour = weatherLearning.isBeauTemps(context.tempMax, context.precipMm, {
    tempMin: SCORING_CONFIG.beauTempsTempMin,
    precipMax: SCORING_CONFIG.beauTempsPrecipMm,
  });
  if (beauJour) {
    const learned = await weatherLearning.getLearnedWeatherRatios();
    if (learned.ok) {
      rawFill *= isWeekend ? learned.ratios.beau_weekend : learned.ratios.beau_semaine;
    } else if (isWeekend) {
      rawFill *= SCORING_CONFIG.weekendSunnyBonus || 1.15;
    }
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
  // NB (item 51) : on lit `observed_fill_rate` (vérité terrain capteur, 0-120 %)
  // ET `observed_fill_level` (saisie chauffeur 0-5 ×20), coalescés via
  // observedPercentFromRow. Avant, seul observed_fill_level était lu, si bien
  // que les lignes capteur (observed_fill_level = NULL) étaient comptées à 0 %
  // et écrasaient la calibration. Les lignes sans aucune observation sont ignorées.
  const feedbackResult = await pool.query(
    `SELECT predicted_fill_rate, observed_fill_level, observed_fill_percent, observed_fill_rate, created_at
     FROM collection_learning_feedback
     WHERE cav_id = $1 ORDER BY created_at DESC LIMIT 60`,
    [cavId]
  );

  let cavCorrection = 1;
  const usableCav = feedbackResult.rows.filter((r) => observedPercentFromRow(r) != null);
  if (usableCav.length >= 3) {
    let weightedSum = 0, weightTotal = 0;
    for (let i = 0; i < usableCav.length; i++) {
      const row = usableCav[i];
      const observedPct = observedPercentFromRow(row);
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
    `SELECT predicted_fill_rate, observed_fill_level, observed_fill_percent, observed_fill_rate
     FROM collection_learning_feedback
     WHERE cav_id = $1 AND EXTRACT(MONTH FROM created_at) = $2
     ORDER BY created_at DESC LIMIT 20`,
    [cavId, monthIndex + 1]
  );

  let periodCorrection = 1;
  {
    let sumRatio = 0, count = 0;
    for (const row of periodFeedback.rows) {
      const observedPct = observedPercentFromRow(row);
      if (observedPct == null) continue;
      const pred = parseFloat(row.predicted_fill_rate) || 50;
      if (pred > 0) { sumRatio += observedPct / pred; count++; }
    }
    if (count >= 3) {
      periodCorrection = sumRatio / count;
      periodCorrection = Math.max(0.7, Math.min(1.3, periodCorrection));
    }
  }

  // 3. Correction de zone : CAV proches géographiquement ont des patterns similaires
  let zoneCorrection = 1;
  if (cav.latitude && cav.longitude) {
    const zoneFeedback = await pool.query(
      `SELECT clf.predicted_fill_rate, clf.observed_fill_level, clf.observed_fill_rate
       FROM collection_learning_feedback clf
       JOIN cav c ON clf.cav_id = c.id
       WHERE clf.cav_id != $1
         AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
         AND ABS(c.latitude - $2) < 0.05 AND ABS(c.longitude - $3) < 0.1
         AND clf.created_at >= NOW() - INTERVAL '30 days'
       ORDER BY clf.created_at DESC LIMIT 30`,
      [cavId, parseFloat(cav.latitude), parseFloat(cav.longitude)]
    );
    let sumRatio = 0, count = 0;
    for (const row of zoneFeedback.rows) {
      const observedPct = observedPercentFromRow(row);
      if (observedPct == null) continue;
      const pred = parseFloat(row.predicted_fill_rate) || 50;
      if (pred > 0) { sumRatio += observedPct / pred; count++; }
    }
    if (count >= 5) {
      zoneCorrection = sumRatio / count;
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
  const feedbackCount = usableCav.length; // feedbacks réellement exploitables (capteur ∪ chauffeur)
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
      seasonal: seasonalFactor,
      seasonalSource: resolved.seasonalSources[monthIndex],
      dayOfWeek: dayFactor,
      dayOfWeekSource: resolved.dayOfWeekSources[dayOfWeek],
      daysSinceCollection: daysSince,
      avgDaysBetween: Math.round(avgDaysBetween * 10) / 10,
      capacityKg: fillFactors.getCapacityKg(cav.nb_containers, resolved.capacityKgPerContainer),
      avgWeight: Math.round(avgWeight * 10) / 10,
      dailyAccumulation: Math.round((avgWeight / Math.max(avgDaysBetween, 1)) * 10) / 10,
    },
    learning: {
      cavCorrection: Math.round(cavCorrection * 1000) / 1000,
      periodCorrection: Math.round(periodCorrection * 1000) / 1000,
      zoneCorrection: Math.round(zoneCorrection * 1000) / 1000,
      combinedCorrection: Math.round(combinedCorrection * 1000) / 1000,
      feedbackSamples: usableCav.length,
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
// PRÉDICTION REMPLISSAGE ASSOCIATION (isolé des PAV)
// ══════════════════════════════════════════════════════════════
async function predictAssociationFillRate(associationPointId, targetDate) {
  await ensureConfigLoaded();
  const resolved = await fillFactors.getResolvedFactors();
  const now = new Date(targetDate || Date.now());
  const monthIndex = now.getMonth();
  const dateStr = now.toISOString().split('T')[0];

  // Historique de ce point association
  const histResult = await pool.query(
    `SELECT date, weight_kg FROM tonnage_history_association
     WHERE association_point_id = $1 AND date >= NOW() - INTERVAL '180 days'
     ORDER BY date DESC`,
    [associationPointId]
  );

  const pointResult = await pool.query('SELECT * FROM association_points WHERE id = $1', [associationPointId]);
  if (pointResult.rows.length === 0) return { fill: 0, confidence: 0 };

  const history = histResult.rows;

  if (history.length === 0) {
    return { fill: 50, confidence: 0.2, method: 'default' };
  }

  const avgWeight = history.reduce((sum, h) => sum + parseFloat(h.weight_kg), 0) / history.length;
  // Jalon de remise à zéro : le moteur ne remonte jamais avant cette date —
  // tous les CAV y sont réputés vides (aucun tonnage n'est supprimé pour autant).
  const lastCollection = fillFactors.effectiveLastCollection(history[0].date, await fillFactors.getResetDate());
  const daysSince = Math.floor((now - lastCollection) / 86400000);

  // Cadence moyenne réelle entre collectes (fallback 7 j).
  let avgDaysBetween = 7;
  if (history.length >= 2) {
    const times = history.map((h) => new Date(h.date).getTime()).sort((a, b) => b - a);
    let gapSum = 0, gaps = 0;
    for (let i = 0; i < times.length - 1; i++) {
      const g = (times[i] - times[i + 1]) / 86400000;
      if (g > 0) { gapSum += g; gaps++; }
    }
    if (gaps > 0) avgDaysBetween = gapSum / gaps;
  }

  // ── Remplissage NORMALISÉ PAR LA CAPACITÉ (item 48) ──
  // Les points association sont des points de dépôt uniques : capacité assimilée
  // à un conteneur (getCapacityKg(1) = 150 kg). Avant, la formule multipliait des
  // kg par 100 (kg traités comme %), saturant systématiquement à 120.
  const dailyAccumulation = avgWeight / Math.max(avgDaysBetween, 1);
  let rawFill = fillFactors.computeBaseFillPercent({
    daysSinceCollection: daysSince,
    avgWeightKg: avgWeight,
    avgDaysBetween,
    nbContainers: 1,
    seasonalFactor: fillFactors.seasonalFactorFor(resolved, monthIndex),
    maxFill: SCORING_CONFIG.maxFillCap || 120,
  });

  if (isHoliday(dateStr)) rawFill *= SCORING_CONFIG.holidayBonus || 1.1;

  const vacationStatus = getSchoolVacationStatus(dateStr);
  if (vacationStatus.status === 'during') {
    const isSummer = vacationStatus.name && /été/i.test(vacationStatus.name);
    rawFill *= isSummer ? 1.0 : 0.90;
  }

  // ML correction depuis feedback
  const feedbackResult = await pool.query(
    `SELECT predicted_fill_rate, observed_fill_level FROM association_learning_feedback
     WHERE association_point_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [associationPointId]
  );
  let mlCorrection = 1;
  if (feedbackResult.rows.length >= 3) {
    const ratios = feedbackResult.rows.map(f => {
      const observed = (f.observed_fill_level / 4) * 100; // 0-4 → 0-100
      return f.predicted_fill_rate > 0 ? observed / f.predicted_fill_rate : 1;
    });
    mlCorrection = ratios.reduce((s, r) => s + r, 0) / ratios.length;
    mlCorrection = Math.max(0.5, Math.min(1.5, mlCorrection));
  }
  rawFill *= mlCorrection;

  const fill = Math.min(120, Math.max(0, rawFill));
  const confidence = Math.min(0.95, 0.1 + Math.min(history.length / 20, 1) * 0.4 + Math.min(feedbackResult.rows.length / 10, 1) * 0.3);

  return {
    fill: Math.round(fill * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    method: feedbackResult.rows.length >= 3 ? 'ml_corrected' : 'historical',
    factors: {
      daysSinceCollection: daysSince,
      avgDaysBetween: Math.round(avgDaysBetween * 10) / 10,
      avgWeight,
      dailyAccumulation: Math.round(dailyAccumulation * 10) / 10,
      mlCorrection,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// GÉNÉRATION QUOTIDIENNE DES PRÉDICTIONS (résidu 8)
// ──────────────────────────────────────────────────────────────
// Le feedback capteur (liveobjects-processor) ne peut se refermer que s'il
// existe une prédiction datée à comparer à la mesure. Ce job calcule LOCALEMENT
// (heuristique predictFillRate, sans appel LLM) les prédictions J..J+N pour les
// CAV actifs et les upserte dans ml_fill_predictions (en %, cohérent avec la
// vérité terrain capteur 0-120 %). Appelé quotidiennement par le scheduler.
// ══════════════════════════════════════════════════════════════
async function generateDailyPredictions({ horizonDays = 7 } = {}) {
  const started = Date.now();
  await ensureConfigLoaded();

  let cavs = [];
  try {
    const r = await pool.query("SELECT id FROM cav WHERE status = 'active' ORDER BY id");
    cavs = r.rows;
  } catch (err) {
    console.error('[PREDICTIONS] generateDailyPredictions — lecture CAV échouée :', err.message);
    return { generated: 0, cavs: 0, errors: 1, durationMs: Date.now() - started };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let generated = 0, errors = 0;

  for (const cav of cavs) {
    for (let d = 0; d <= horizonDays; d++) {
      const target = new Date(today.getTime() + d * 86400000);
      const dateStr = target.toISOString().split('T')[0];
      try {
        const pred = await predictFillRate(cav.id, target);
        if (!pred || pred.fill == null) continue;
        await pool.query(
          `INSERT INTO ml_fill_predictions (cav_id, predicted_date, predicted_fill_rate, confidence, model_version, features)
           VALUES ($1, $2, $3, $4, 'heuristic_v2', $5)
           ON CONFLICT (cav_id, predicted_date)
           DO UPDATE SET predicted_fill_rate = EXCLUDED.predicted_fill_rate,
                         confidence = EXCLUDED.confidence,
                         model_version = EXCLUDED.model_version,
                         features = EXCLUDED.features,
                         created_at = NOW()`,
          [cav.id, dateStr, pred.fill, pred.confidence ?? 0,
           JSON.stringify({ method: pred.method, factors: pred.factors || null })]
        );
        generated++;
      } catch (err) {
        errors++;
        if (errors <= 3) console.error(`[PREDICTIONS] generateDailyPredictions CAV ${cav.id} ${dateStr} :`, err.message);
      }
    }
  }

  console.log(`[PREDICTIONS] Prédictions heuristiques générées : ${generated} lignes (J..J+${horizonDays}) / ${cavs.length} CAV actifs, ${errors} erreurs, ${Date.now() - started}ms`);
  return { generated, cavs: cavs.length, errors, durationMs: Date.now() - started };
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
  predictAssociationFillRate,
  generateDailyPredictions,
  loadPersistedConfig,
  reloadPersistedConfig,
  ensureConfigLoaded,
};

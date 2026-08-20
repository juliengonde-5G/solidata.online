const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { getContextForDate } = require('./context');
const { generateIntelligentTour } = require('./smart-tour');
const { isHoliday, getSchoolVacationStatus, getHolidays, getSchoolVacations, getScoringConfig } = require('./predictions');
// v1-6 : source unique des facteurs (résolution appris > manuel > défaut).
const fillFactors = require('../../utils/fill-factors');

// ══════════════════════════════════════════════════════════════
// GET /api/tours/saturation-risks — CAV qui vont saturer sans rotation
// ──────────────────────────────────────────────────────────────
// Exigence client : « aucun CAV ne doit dépasser son seuil de saturation sans
// qu'une rotation planifiée le vide ». Cet écran liste, sur un horizon glissant,
// les CAV qui atteindront le seuil ET dit si une tournée déjà planifiée les
// couvre AVANT cette date.
//
// Sources de données, dans l'ordre de fiabilité (« jamais de valeur inventée » :
// un CAV sans aucune donnée exploitable N'APPARAÎT PAS) :
//   1. `ml_fill_predictions` — prédictions J..J+N du job quotidien ;
//   2. capteur LoRaWAN — `cav.sensor_last_reading` EST un pourcentage de
//      remplissage (écrit par liveobjects-processor), retenu s'il est FRAIS
//      (SENSOR_FRESHNESS_HOURS, défaut 8 h) ;
//   3. extrapolation `estimated_fill_rate + daily_fill_rate × jours` — seulement
//      si ces colonnes sont réellement alimentées (elles sont figées à 0 sur le
//      schéma actuel : la branche est prête mais ne produit rien tant qu'aucune
//      source ne les remplit).
// ══════════════════════════════════════════════════════════════
router.get('/saturation-risks', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const SCORING_CONFIG = getScoringConfig();
    const seuil = parseFloat(SCORING_CONFIG.saturationThresholdPct) || 90;
    const horizon = Math.max(1, Math.min(60, parseInt(req.query.days, 10) || 7));
    const freshnessHours = parseInt(process.env.SENSOR_FRESHNESS_HOURS, 10) || 8;

    let rows = [];
    try {
      const r = await pool.query(
        `WITH pred AS (
           SELECT p.cav_id, MIN(p.predicted_date) AS date_saturation
             FROM ml_fill_predictions p
            WHERE p.predicted_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + ($1::int))
              AND p.predicted_fill_rate >= $2
            GROUP BY p.cav_id
         ),
         aujourdhui AS (
           SELECT cav_id, predicted_fill_rate
             FROM ml_fill_predictions WHERE predicted_date = CURRENT_DATE
         )
         SELECT c.id, c.name, c.commune,
                pred.date_saturation,
                a.predicted_fill_rate AS fill_prediction,
                c.sensor_last_reading, c.sensor_last_reading_at,
                c.estimated_fill_rate, c.daily_fill_rate
           FROM cav c
           LEFT JOIN pred ON pred.cav_id = c.id
           LEFT JOIN aujourdhui a ON a.cav_id = c.id
          WHERE c.status = 'active'
            AND (
              pred.cav_id IS NOT NULL
              OR (c.sensor_last_reading IS NOT NULL AND c.sensor_last_reading >= $2
                  AND c.sensor_last_reading_at IS NOT NULL
                  AND c.sensor_last_reading_at > NOW() - ($3::int * INTERVAL '1 hour'))
              OR (COALESCE(c.daily_fill_rate, 0) > 0 AND COALESCE(c.estimated_fill_rate, 0) > 0)
            )
          ORDER BY c.name`,
        [horizon, seuil, freshnessHours]
      );
      rows = r.rows;
    } catch (err) {
      // Schéma ancien (table/colonne absente) → on renvoie une liste vide plutôt
      // qu'une erreur : l'écran de pilotage doit rester consultable.
      console.warn('[TOURS] saturation-risks — lecture dégradée :', err.message);
      rows = [];
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const iso = (d) => d.toISOString().slice(0, 10);
    const toDate = (v) => {
      if (!v) return null;
      const d = v instanceof Date ? v : new Date(`${String(v).slice(0, 10)}T00:00:00`);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const risques = [];
    for (const row of rows) {
      const sensorPct = row.sensor_last_reading != null ? parseFloat(row.sensor_last_reading) : null;
      const sensorFresh = sensorPct != null && row.sensor_last_reading_at
        && (Date.now() - new Date(row.sensor_last_reading_at).getTime()) < freshnessHours * 3600 * 1000;
      const predPct = row.fill_prediction != null ? parseFloat(row.fill_prediction) : null;
      const estimatedPct = parseFloat(row.estimated_fill_rate) || 0;
      const dailyPct = parseFloat(row.daily_fill_rate) || 0;

      let source = null;
      let dateSaturation = null;
      const datePred = toDate(row.date_saturation);
      if (datePred) {
        source = 'prediction';
        dateSaturation = datePred;
      } else if (sensorFresh && sensorPct >= seuil) {
        source = 'capteur';
        dateSaturation = today;
      } else if (dailyPct > 0 && estimatedPct > 0) {
        const jours = estimatedPct >= seuil ? 0 : Math.ceil((seuil - estimatedPct) / dailyPct);
        if (jours >= 0 && jours <= horizon) {
          source = 'estimation';
          dateSaturation = new Date(today.getTime() + jours * 86400000);
        }
      }
      if (!source) continue; // aucune donnée exploitable → le CAV n'apparaît pas

      const fillActuel = predPct != null ? predPct
        : (sensorFresh ? sensorPct : (estimatedPct > 0 ? estimatedPct : null));

      risques.push({
        cav_id: row.id,
        name: row.name,
        commune: row.commune || null,
        fill_actuel_pct: fillActuel != null ? Math.round(fillActuel) : null,
        date_saturation_prevue: dateSaturation ? iso(dateSaturation) : null,
        jours_avant_saturation: dateSaturation
          ? Math.max(0, Math.round((dateSaturation - today) / 86400000)) : null,
        source,
        couverture: { couvert: false },
      });
    }

    // Couverture : première tournée PLANIFIÉE ou EN COURS, à partir d'aujourd'hui,
    // qui contient le CAV. Elle « couvre » si elle passe AVANT la saturation.
    if (risques.length > 0) {
      try {
        const cover = await pool.query(
          `SELECT DISTINCT ON (tc.cav_id) tc.cav_id, t.id AS tour_id, t.date AS tour_date
             FROM tour_cav tc JOIN tours t ON t.id = tc.tour_id
            WHERE tc.cav_id = ANY($1)
              AND t.status IN ('planned', 'in_progress')
              AND t.date >= CURRENT_DATE
            ORDER BY tc.cav_id, t.date ASC`,
          [risques.map((r) => r.cav_id)]
        );
        const byCav = new Map(cover.rows.map((r) => [Number(r.cav_id), r]));
        for (const risque of risques) {
          const tour = byCav.get(Number(risque.cav_id));
          if (!tour) continue;
          const tourDate = toDate(tour.tour_date);
          const satDate = toDate(risque.date_saturation_prevue);
          if (tourDate && satDate && tourDate <= satDate) {
            risque.couverture = { couvert: true, tour_id: tour.tour_id, tour_date: iso(tourDate) };
          }
        }
      } catch (err) {
        console.warn('[TOURS] saturation-risks — couverture non évaluée :', err.message);
      }
    }

    // Tri par URGENCE : d'abord ce qui n'est pas couvert, puis la saturation la
    // plus proche, puis le remplissage le plus élevé.
    risques.sort((a, b) => {
      if (a.couverture.couvert !== b.couverture.couvert) return a.couverture.couvert ? 1 : -1;
      const ja = a.jours_avant_saturation ?? Number.MAX_SAFE_INTEGER;
      const jb = b.jours_avant_saturation ?? Number.MAX_SAFE_INTEGER;
      if (ja !== jb) return ja - jb;
      return (b.fill_actuel_pct ?? 0) - (a.fill_actuel_pct ?? 0);
    });

    res.json({
      seuil_pct: seuil,
      horizon_jours: horizon,
      generated_at: new Date().toISOString(),
      risques,
    });
  } catch (err) {
    console.error('[TOURS] Erreur saturation-risks :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/proposals/daily — Propositions de tournées pour une date
router.get('/proposals/daily', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const SCORING_CONFIG = getScoringConfig();
    // v1-6 : le calendrier de référence affiche désormais les facteurs EFFECTIFS du
    // moteur (appris > manuel > défaut) au lieu de la seule couche manuelle/défaut.
    const resolvedFactors = await fillFactors.getResolvedFactors();
    const FRENCH_HOLIDAYS_2026 = getHolidays();
    const SCHOOL_VACATIONS = getSchoolVacations();

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
    const skipped = [];
    for (const vehicle of availableVehicles.slice(0, 5)) {
      try {
        const result = await generateIntelligentTour(vehicle.id, date);
        proposals.push({
          vehicle_id: vehicle.id,
          vehicle_name: vehicle.name || vehicle.registration,
          proposal: result,
          // Remontés au premier niveau : contraintes de journée respectées et
          // CAV saturés que cette proposition ne couvre pas (exigence client).
          estimation: result.estimation,
          saturation_non_couverte: result.saturation_non_couverte || [],
        });
      } catch (err) {
        console.warn('[TOURS] Proposition ignorée pour véhicule', vehicle.id, err.message);
        skipped.push({
          vehicle_id: vehicle.id,
          vehicle_name: vehicle.name || vehicle.registration,
          reason: err.message,
        });
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
        seasonalFactor: fillFactors.seasonalFactorFor(resolvedFactors, d.getMonth()),
        dayOfWeekFactor: fillFactors.dayFactorFor(resolvedFactors, d.getDay()),
      },
      availableVehicles: availableVehicles.length,
      drivers: driversResult.rows,
      proposals,
      skipped,
      diagnostics: {
        totalVehicles: vehiclesResult.rows.length,
        usedVehicles: usedVehicleIds.size,
        candidateVehicles: availableVehicles.length,
        attemptedVehicles: Math.min(5, availableVehicles.length),
        successCount: proposals.length,
        skippedCount: skipped.length,
      },
    });
  } catch (err) {
    console.error('[TOURS] Erreur propositions journalières :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/proposals/weekly — Plan hebdomadaire (propositions par jour)
router.get('/proposals/weekly', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const SCHOOL_VACATIONS = getSchoolVacations();

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

      // Une proposition PAR véhicule disponible (plafonné à 3/jour pour tenir
      // le temps de réponse sur 7 jours) — l'ancienne version ne proposait que
      // le premier véhicule du parc toute la semaine, même trop petit pour
      // absorber les CAV en approche de saturation.
      const proposals = [];
      for (const vehicle of available.slice(0, 3)) {
        try {
          const result = await generateIntelligentTour(vehicle.id, dateStr);
          proposals.push({
            vehicle,
            stats: result.stats,
            cavCount: result.cavList.length,
            // L'estimation (6 h de travail, pause, vidages) et les CAV saturés
            // non couverts sont exposés comme sur les propositions du jour.
            estimation: result.estimation,
            saturation_non_couverte: result.saturation_non_couverte || [],
          });
        } catch (e) { /* véhicule sans tournée possible ce jour : ignoré */ }
      }
      // suggestedTour conservé (compat consommateurs existants) = 1re proposition.
      const bestProposal = proposals[0] || null;

      const context = await getContextForDate(dateStr);
      const vacStatus = getSchoolVacationStatus(dateStr);
      const hol = isHoliday(dateStr);
      weekly.push({
        date: dateStr,
        dayName: new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long' }),
        existingTours: existingTours.rows,
        availableVehicles: available.length,
        suggestedTour: bestProposal,
        proposals,
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
router.put('/context', authorize('ADMIN'), [
  body('date').notEmpty().withMessage('Date requise'),
], validate, async (req, res) => {
  try {
    const { date, weather_factor, traffic_factor, duration_factor, weather_code, notes } = req.body;

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

module.exports = router;

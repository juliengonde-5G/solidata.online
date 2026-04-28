const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { getContextForDate } = require('./context');
const { generateIntelligentTour } = require('./smart-tour');
const { isHoliday, getSchoolVacationStatus, getSeasonalFactors, getDayOfWeekFactors, getHolidays, getSchoolVacations, getScoringConfig } = require('./predictions');

// GET /api/tours/proposals/daily — Propositions de tournées pour une date
router.get('/proposals/daily', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const SCORING_CONFIG = getScoringConfig();
    const SEASONAL_FACTORS = getSeasonalFactors();
    const DAY_OF_WEEK_FACTORS = getDayOfWeekFactors();
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
        seasonalFactor: SEASONAL_FACTORS[d.getMonth()],
        dayOfWeekFactor: DAY_OF_WEEK_FACTORS[d.getDay() === 0 ? 6 : d.getDay() - 1],
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

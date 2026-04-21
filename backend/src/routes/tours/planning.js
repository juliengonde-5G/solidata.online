// ══════════════════════════════════════════════════════════════
// Planning des tournées (Niveau 2.7) — affectation drag-drop
// ══════════════════════════════════════════════════════════════
//
// Expose :
//   GET  /api/tours/planning/resources?date=YYYY-MM-DD  → tournées + ressources
//   PATCH /api/tours/:id/assign                         → assigner driver et/ou vehicle

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');

// Mapping JS getDay() → clé française (dimanche = 0)
const DAY_OFF_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function dayOffForDate(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  return DAY_OFF_FR[d.getDay()];
}

// GET /api/tours/planning/resources?date=YYYY-MM-DD
// Retourne les tournées de la date + la liste des chauffeurs (annotés dispo/indispo)
// et des véhicules (annotés affectés/libres). La requête reste plate : la page
// frontend assemble les associations et les conflits.
router.get('/planning/resources',
  authorize('ADMIN', 'MANAGER'),
  async (req, res) => {
    try {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const dayOff = dayOffForDate(date);

      const toursRes = await pool.query(`
        SELECT t.id, t.date, t.status, t.collection_type, t.mode,
               t.vehicle_id, t.driver_employee_id,
               t.started_at, t.completed_at,
               t.estimated_distance_km, t.estimated_duration_min,
               COALESCE(t.nb_cav, 0) AS nb_cav,
               v.registration, v.name AS vehicle_name, v.max_capacity_kg, v.status AS vehicle_status,
               CONCAT(e.first_name, ' ', e.last_name) AS driver_name,
               sr.name AS route_name
          FROM tours t
          LEFT JOIN vehicles v ON v.id = t.vehicle_id
          LEFT JOIN employees e ON e.id = t.driver_employee_id
          LEFT JOIN standard_routes sr ON sr.id = t.standard_route_id
         WHERE t.date = $1
         ORDER BY t.created_at
      `, [date]);

      // Chauffeurs (tout employé avec position contenant 'chauffeur' OU role
      // driver sur user lié). Simplification : on expose tous les employés
      // actifs (insertion_status != 'abandon') et on laisse le front filtrer.
      const driversRes = await pool.query(`
        SELECT e.id, e.first_name, e.last_name, e.phone, e.position,
               e.team_id, t.name AS team_name
          FROM employees e
          LEFT JOIN teams t ON t.id = e.team_id
         WHERE (e.insertion_status IS NULL OR e.insertion_status <> 'abandon')
         ORDER BY e.last_name, e.first_name
      `);

      // Disponibilités : jours off par employé
      const availRes = await pool.query(`SELECT employee_id, day_off FROM employee_availability`);
      const offByEmp = {};
      for (const r of availRes.rows) {
        (offByEmp[r.employee_id] ||= []).push(r.day_off);
      }

      // Véhicules (hors out_of_service / maintenance)
      const vehiclesRes = await pool.query(`
        SELECT id, registration, name, max_capacity_kg, status, current_km
          FROM vehicles
         WHERE status <> 'out_of_service'
         ORDER BY name, registration
      `);

      // Indexation affectations du jour
      const driverTourId = {}; // employee_id -> tour_id
      const vehicleTourId = {}; // vehicle_id -> tour_id
      for (const t of toursRes.rows) {
        if (t.driver_employee_id) driverTourId[t.driver_employee_id] = t.id;
        if (t.vehicle_id) vehicleTourId[t.vehicle_id] = t.id;
      }

      const drivers = driversRes.rows.map(e => ({
        ...e,
        is_day_off: dayOff ? (offByEmp[e.id] || []).includes(dayOff) : false,
        assigned_tour_id: driverTourId[e.id] || null,
      }));
      const vehicles = vehiclesRes.rows.map(v => ({
        ...v,
        assigned_tour_id: vehicleTourId[v.id] || null,
      }));

      res.json({
        date,
        day_off: dayOff,
        tours: toursRes.rows,
        drivers,
        vehicles,
      });
    } catch (err) {
      console.error('[TOURS] Erreur planning/resources :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// PATCH /api/tours/:id/assign — Modifier driver et/ou véhicule
// Vérifie : tournée terminée = refus ; conflit dispo ; conflit déjà affecté.
// Passer null pour déaffecter une ressource.
router.patch('/:id/assign',
  authorize('ADMIN', 'MANAGER'),
  [
    body('driver_employee_id').optional({ nullable: true }),
    body('vehicle_id').optional({ nullable: true }),
    body('force').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    try {
      const tourId = parseInt(req.params.id, 10);
      const tourRes = await pool.query(
        'SELECT id, date, status, vehicle_id, driver_employee_id FROM tours WHERE id = $1',
        [tourId]
      );
      if (tourRes.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });
      const tour = tourRes.rows[0];
      if (['completed', 'cancelled'].includes(tour.status)) {
        return res.status(400).json({ error: `Tournée ${tour.status}, affectation interdite` });
      }

      const force = req.body.force === true;
      const hasDriver = Object.prototype.hasOwnProperty.call(req.body, 'driver_employee_id');
      const hasVehicle = Object.prototype.hasOwnProperty.call(req.body, 'vehicle_id');
      const conflicts = [];

      const driverId = hasDriver
        ? (req.body.driver_employee_id === null ? null : parseInt(req.body.driver_employee_id, 10))
        : undefined;
      const vehicleId = hasVehicle
        ? (req.body.vehicle_id === null ? null : parseInt(req.body.vehicle_id, 10))
        : undefined;

      // Conflit chauffeur : déjà affecté à une autre tournée ce jour-là
      if (driverId) {
        const r = await pool.query(
          `SELECT id FROM tours
             WHERE date = $1 AND driver_employee_id = $2 AND id <> $3
                AND status NOT IN ('completed', 'cancelled')`,
          [tour.date, driverId, tourId]
        );
        if (r.rows.length > 0) {
          conflicts.push({ field: 'driver_employee_id', reason: 'driver_already_assigned', tour_id: r.rows[0].id });
        }
        // Jour off ?
        const dayOff = dayOffForDate(tour.date);
        if (dayOff) {
          const off = await pool.query(
            `SELECT 1 FROM employee_availability WHERE employee_id = $1 AND day_off = $2`,
            [driverId, dayOff]
          );
          if (off.rows.length > 0) {
            conflicts.push({ field: 'driver_employee_id', reason: 'driver_day_off', day_off: dayOff });
          }
        }
      }

      // Conflit véhicule : déjà affecté ce jour-là
      if (vehicleId) {
        const r = await pool.query(
          `SELECT id FROM tours
             WHERE date = $1 AND vehicle_id = $2 AND id <> $3
                AND status NOT IN ('completed', 'cancelled')`,
          [tour.date, vehicleId, tourId]
        );
        if (r.rows.length > 0) {
          conflicts.push({ field: 'vehicle_id', reason: 'vehicle_already_assigned', tour_id: r.rows[0].id });
        }
        // Statut véhicule ?
        const vres = await pool.query(`SELECT status FROM vehicles WHERE id = $1`, [vehicleId]);
        const vstatus = vres.rows[0]?.status;
        if (vstatus === 'out_of_service' || vstatus === 'maintenance') {
          conflicts.push({ field: 'vehicle_id', reason: 'vehicle_unavailable', status: vstatus });
        }
      }

      if (conflicts.length > 0 && !force) {
        return res.status(409).json({ error: 'Conflit d\'affectation', conflicts });
      }

      const updates = [];
      const params = [];
      if (hasDriver) { params.push(driverId); updates.push(`driver_employee_id = $${params.length}`); }
      if (hasVehicle) { params.push(vehicleId); updates.push(`vehicle_id = $${params.length}`); }
      if (updates.length === 0) return res.status(400).json({ error: 'Aucun changement' });
      updates.push('updated_at = NOW()');
      params.push(tourId);

      const result = await pool.query(
        `UPDATE tours SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );
      res.json({ tour: result.rows[0], conflicts });
    } catch (err) {
      console.error('[TOURS] Erreur assign :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

module.exports = router;

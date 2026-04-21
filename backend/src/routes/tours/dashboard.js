// ══════════════════════════════════════════════════════════════
// Dashboard supervision collecte (Niveau 2.1)
// ══════════════════════════════════════════════════════════════
// GET /api/tours/dashboard/summary?date=YYYY-MM-DD
// Agrège pour la date (défaut = aujourd'hui) :
//   - KPIs : tournées actives, tonnage collecté, on-time rate, incidents ouverts
//   - Donut statuts : planned, in_progress, completed, cancelled
//   - Liste ordres enrichis (tour + véhicule + chauffeur + ETA estimée)
//   - Santé flotte (véhicules + alertes maintenance / contrat expirant)

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');

router.get('/dashboard/summary', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    // 1) Tournées de la date
    const toursRes = await pool.query(`
      SELECT t.id, t.date, t.status, t.collection_type, t.mode,
             t.vehicle_id, t.driver_employee_id,
             t.started_at, t.completed_at,
             t.estimated_distance_km, t.estimated_duration_min,
             t.total_weight_kg,
             COALESCE(t.nb_cav, (
               CASE WHEN t.collection_type = 'association'
                    THEN (SELECT COUNT(*)::int FROM tour_association_point WHERE tour_id = t.id)
                    ELSE (SELECT COUNT(*)::int FROM tour_cav WHERE tour_id = t.id)
               END
             )) AS nb_cav,
             (CASE WHEN t.collection_type = 'association'
                   THEN (SELECT COUNT(*)::int FROM tour_association_point WHERE tour_id = t.id AND status = 'collected')
                   ELSE (SELECT COUNT(*)::int FROM tour_cav WHERE tour_id = t.id AND status = 'collected')
              END) AS collected_count,
             v.registration, v.name AS vehicle_name, v.max_capacity_kg,
             CONCAT(e.first_name, ' ', e.last_name) AS driver_name,
             sr.name AS route_name
        FROM tours t
        LEFT JOIN vehicles v ON v.id = t.vehicle_id
        LEFT JOIN employees e ON e.id = t.driver_employee_id
        LEFT JOIN standard_routes sr ON sr.id = t.standard_route_id
       WHERE t.date = $1
       ORDER BY
         CASE t.status
           WHEN 'in_progress' THEN 0
           WHEN 'planned' THEN 1
           WHEN 'paused' THEN 2
           WHEN 'returning' THEN 3
           WHEN 'completed' THEN 4
           WHEN 'cancelled' THEN 5
           ELSE 6
         END, t.created_at
    `, [date]);
    const tours = toursRes.rows;

    // 2) ETA + retard pour chaque tournée in_progress
    const orders = tours.map(t => {
      let eta = null;
      let delay = null;
      if (t.status === 'in_progress' && t.started_at && t.estimated_duration_min) {
        const endExpected = new Date(t.started_at).getTime() + t.estimated_duration_min * 60 * 1000;
        eta = new Date(endExpected).toISOString();
        const overshoot = (Date.now() - endExpected) / 60000;
        if (overshoot > 0) delay = Math.round(overshoot);
      }
      return {
        id: t.id,
        status: t.status,
        collection_type: t.collection_type,
        registration: t.registration,
        vehicle_name: t.vehicle_name,
        driver_name: t.driver_name,
        route_name: t.route_name,
        nb_cav: t.nb_cav,
        collected_count: t.collected_count,
        total_weight_kg: t.total_weight_kg,
        started_at: t.started_at,
        completed_at: t.completed_at,
        eta,
        delay_minutes: delay,
      };
    });

    // 3) Donut par statut
    const statusCount = { planned: 0, in_progress: 0, paused: 0, returning: 0, completed: 0, cancelled: 0 };
    for (const t of tours) {
      if (statusCount[t.status] === undefined) statusCount[t.status] = 0;
      statusCount[t.status]++;
    }

    // 4) On-time rate (sur tournées complétées aujourd'hui)
    let onTimeRate = null;
    const completedTours = tours.filter(t => t.status === 'completed' && t.started_at && t.completed_at && t.estimated_duration_min);
    if (completedTours.length > 0) {
      const onTime = completedTours.filter(t => {
        const actualMin = (new Date(t.completed_at) - new Date(t.started_at)) / 60000;
        return actualMin <= t.estimated_duration_min * 1.15; // tolérance 15 %
      }).length;
      onTimeRate = Math.round((onTime / completedTours.length) * 100);
    }

    // 5) Tonnage total du jour
    const totalWeight = tours.reduce((sum, t) => sum + parseFloat(t.total_weight_kg || 0), 0);

    // 6) Incidents ouverts sur les tournées du jour
    const incidentsRes = await pool.query(`
      SELECT COUNT(*)::int AS open_count
        FROM incidents i
        JOIN tours t ON t.id = i.tour_id
       WHERE t.date = $1 AND i.status = 'open'
    `, [date]);
    const openIncidents = incidentsRes.rows[0]?.open_count || 0;

    // 7) Santé flotte : tous les véhicules (hors out_of_service) + alertes proches
    const fleetRes = await pool.query(`
      SELECT v.id, v.registration, v.name, v.status, v.current_km, v.max_capacity_kg,
             (SELECT COUNT(*)::int FROM vehicle_maintenance_alerts
                WHERE vehicle_id = v.id AND COALESCE(is_resolved, false) = false) AS pending_alerts
        FROM vehicles v
       WHERE v.status <> 'out_of_service'
       ORDER BY v.name, v.registration
    `);
    const fleet = [];
    for (const v of fleetRes.rows) {
      let contract_days_left = null;
      try {
        const c = await pool.query(
          `SELECT (fin - CURRENT_DATE)::int AS days_left
             FROM vehicle_maintenance_contracts
            WHERE vehicle_id = $1 AND active = true
            ORDER BY fin ASC LIMIT 1`,
          [v.id]
        );
        contract_days_left = c.rows[0]?.days_left ?? null;
      } catch (_) { /* table absente */ }

      let health = 'healthy';
      if (v.status === 'maintenance') health = 'maintenance';
      else if ((v.pending_alerts || 0) > 0) health = 'alerts';
      else if (contract_days_left !== null && contract_days_left <= 30) health = 'contract_expiring';

      fleet.push({
        ...v,
        contract_days_left,
        health,
      });
    }

    res.json({
      date,
      kpis: {
        active_tours: statusCount.in_progress + (statusCount.returning || 0),
        total_tours: tours.length,
        total_weight_kg: Math.round(totalWeight * 10) / 10,
        on_time_rate: onTimeRate,
        open_incidents: openIncidents,
      },
      status_breakdown: statusCount,
      orders,
      fleet,
    });
  } catch (err) {
    console.error('[TOURS] Erreur dashboard summary :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

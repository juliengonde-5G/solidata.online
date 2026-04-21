const express = require('express');
const router = express.Router();
const pool = require('../../config/database');

// Distance haversine en km
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Estime l'horaire prévisionnel de passage à un CAV en répartissant
// linéairement estimated_duration_min sur le nombre de points.
function plannedPassageAt(startedAt, estimatedDurationMin, position, nbPoints) {
  if (!startedAt || !estimatedDurationMin || !nbPoints || nbPoints < 1) return null;
  const ratio = Math.min(1, Math.max(0, (position || 1) / nbPoints));
  const offsetMs = ratio * estimatedDurationMin * 60 * 1000;
  return new Date(new Date(startedAt).getTime() + offsetMs).toISOString();
}

// GET /api/tours/:id/live-summary — Synthèse tournée en cours
// Consolide : tour + véhicule + chauffeur, liste CAV enrichie (statut,
// remplissage, incident, horaire prévu vs réel, décalage), KPIs (distance
// parcourue, durée écoulée, ETA, remplissage cumulé), alertes, pesées.
router.get('/:id/live-summary', async (req, res) => {
  try {
    const tourId = parseInt(req.params.id, 10);
    if (!Number.isInteger(tourId)) {
      return res.status(400).json({ error: 'ID de tournée invalide' });
    }

    const tourResult = await pool.query(`
      SELECT t.*,
             v.registration, v.name AS vehicle_name, v.max_capacity_kg,
             CONCAT(e.first_name, ' ', e.last_name) AS driver_name,
             e.id AS driver_id
      FROM tours t
      LEFT JOIN vehicles v ON v.id = t.vehicle_id
      LEFT JOIN employees e ON e.id = t.driver_employee_id
      WHERE t.id = $1
    `, [tourId]);

    if (tourResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournée non trouvée' });
    }
    const tour = tourResult.rows[0];

    // Points (CAV ou points association selon type). On récupère
    // planned_passage_time si la colonne a été peuplée au démarrage de la
    // tournée (OSRM), sinon on tombera sur une estimation linéaire en aval.
    let points = [];
    if (tour.collection_type === 'association') {
      const r = await pool.query(`
        SELECT tap.id, tap.tour_id, tap.association_point_id AS cav_id,
               tap.position, tap.status, tap.fill_level, tap.collected_at,
               tap.notes, tap.planned_passage_time,
               ap.name AS cav_name, ap.address, ap.ville AS commune,
               ap.latitude, ap.longitude, NULL::int AS nb_containers
        FROM tour_association_point tap
        JOIN association_points ap ON ap.id = tap.association_point_id
        WHERE tap.tour_id = $1
        ORDER BY tap.position
      `, [tourId]);
      points = r.rows;
    } else {
      const r = await pool.query(`
        SELECT tc.*, c.name AS cav_name, c.address, c.commune,
               c.latitude, c.longitude, c.nb_containers
        FROM tour_cav tc
        JOIN cav c ON c.id = tc.cav_id
        WHERE tc.tour_id = $1
        ORDER BY tc.position
      `, [tourId]);
      points = r.rows;
    }

    // Incidents liés à la tournée
    const incidentsResult = await pool.query(`
      SELECT id, cav_id, vehicle_id, type, description, status, created_at
      FROM incidents
      WHERE tour_id = $1
      ORDER BY created_at DESC
    `, [tourId]);
    const incidents = incidentsResult.rows;
    const incidentsByCav = incidents.reduce((acc, inc) => {
      if (inc.cav_id) {
        acc[inc.cav_id] = acc[inc.cav_id] || [];
        acc[inc.cav_id].push(inc);
      }
      return acc;
    }, {});
    const incidentsOpenCount = incidents.filter(i => i.status === 'open').length;

    // Pesées
    const weightsResult = await pool.query(
      `SELECT id, weight_kg, is_intermediate, notes, recorded_at
       FROM tour_weights WHERE tour_id = $1 ORDER BY recorded_at`,
      [tourId]
    );
    const totalWeight = weightsResult.rows
      .filter(w => !w.is_intermediate)
      .reduce((sum, w) => sum + parseFloat(w.weight_kg || 0), 0);

    // Positions GPS — récupère les 200 dernières pour calculer distance parcourue
    const gpsResult = await pool.query(`
      SELECT latitude, longitude, speed, recorded_at
      FROM gps_positions
      WHERE tour_id = $1
      ORDER BY recorded_at ASC
    `, [tourId]);
    const gpsPoints = gpsResult.rows;

    let distanceKm = 0;
    for (let i = 1; i < gpsPoints.length; i++) {
      const a = gpsPoints[i - 1];
      const b = gpsPoints[i];
      distanceKm += haversineKm(
        parseFloat(a.latitude), parseFloat(a.longitude),
        parseFloat(b.latitude), parseFloat(b.longitude)
      );
    }
    distanceKm = Math.round(distanceKm * 10) / 10;

    const lastPosition = gpsPoints.length > 0 ? gpsPoints[gpsPoints.length - 1] : null;

    // Durée écoulée
    let elapsedMin = null;
    if (tour.started_at) {
      const endRef = tour.completed_at ? new Date(tour.completed_at) : new Date();
      elapsedMin = Math.round((endRef - new Date(tour.started_at)) / 60000);
    }

    // Construire la liste points enrichie. On privilégie le
    // planned_passage_time stocké en BDD (calcul OSRM au démarrage de la
    // tournée) ; sinon on retombe sur l'estimation linéaire naïve.
    const nbPoints = points.length;
    const plannedSource = points.some(p => p.planned_passage_time) ? 'osrm' : 'estimate';
    const enrichedPoints = points.map((p) => {
      const planned = p.planned_passage_time
        ? new Date(p.planned_passage_time).toISOString()
        : plannedPassageAt(tour.started_at, tour.estimated_duration_min, p.position, nbPoints);
      let delayMinutes = null;
      if (planned && p.collected_at) {
        delayMinutes = Math.round((new Date(p.collected_at) - new Date(planned)) / 60000);
      }
      const pointIncidents = incidentsByCav[p.cav_id] || [];
      return {
        id: p.id,
        cav_id: p.cav_id,
        position: p.position,
        status: p.status,
        fill_level: p.fill_level,
        collected_at: p.collected_at,
        notes: p.notes,
        cav_name: p.cav_name,
        address: p.address,
        commune: p.commune,
        latitude: p.latitude,
        longitude: p.longitude,
        nb_containers: p.nb_containers,
        planned_passage_at: planned,
        delay_minutes: delayMinutes,
        has_incident: pointIncidents.length > 0,
        incidents: pointIncidents.map(i => ({
          id: i.id, type: i.type, description: i.description, status: i.status,
        })),
      };
    });

    // Agrégats
    const collectedPoints = enrichedPoints.filter(p => p.status === 'collected');
    const nbCollected = collectedPoints.length;
    const nbTotal = nbPoints;

    // Remplissage cumulé : moyenne des fill_level * 20 % (échelle 0-5 → 0-100)
    const sumFill = collectedPoints.reduce((s, p) => s + (p.fill_level || 0), 0);
    const avgFillPercent = nbCollected > 0 ? Math.round((sumFill / nbCollected) * 20) : 0;

    // Décalage moyen (sur CAV collectés avec planned_passage_at)
    const delays = collectedPoints
      .map(p => p.delay_minutes)
      .filter(d => d !== null && Number.isFinite(d));
    const avgDelayMin = delays.length > 0
      ? Math.round(delays.reduce((s, d) => s + d, 0) / delays.length)
      : null;

    // ETA fin de tournée = started_at + estimated_duration_min + retard moyen
    let etaEnd = null;
    if (tour.started_at && tour.estimated_duration_min) {
      const extra = (avgDelayMin || 0) * 60 * 1000;
      etaEnd = new Date(
        new Date(tour.started_at).getTime() +
        tour.estimated_duration_min * 60 * 1000 +
        extra
      ).toISOString();
    }

    // Alertes opérationnelles
    const alerts = [];
    if (avgDelayMin !== null && avgDelayMin > 15) {
      alerts.push({
        level: 'warn',
        category: 'delay',
        message: `Retard moyen ${avgDelayMin} min sur la tournée`,
      });
    }
    if (incidentsOpenCount > 0) {
      alerts.push({
        level: 'error',
        category: 'incident',
        message: `${incidentsOpenCount} incident${incidentsOpenCount > 1 ? 's' : ''} non résolu${incidentsOpenCount > 1 ? 's' : ''}`,
      });
    }
    const skippedPoints = enrichedPoints.filter(p => p.status === 'skipped');
    if (skippedPoints.length > 0) {
      alerts.push({
        level: 'info',
        category: 'skipped',
        message: `${skippedPoints.length} point${skippedPoints.length > 1 ? 's' : ''} non collecté${skippedPoints.length > 1 ? 's' : ''}`,
      });
    }

    // Alerte maintenance véhicule proche (si table présente)
    try {
      const maintResult = await pool.query(`
        SELECT type, description, due_at, due_km
        FROM vehicle_maintenance_alerts
        WHERE vehicle_id = $1
          AND status = 'pending'
          AND (due_at IS NULL OR due_at <= NOW() + INTERVAL '7 days')
        ORDER BY due_at NULLS LAST LIMIT 3
      `, [tour.vehicle_id]);
      for (const m of maintResult.rows) {
        alerts.push({
          level: 'warn',
          category: 'maintenance',
          message: `Maintenance ${m.type || ''} prévue : ${m.description || 'échéance proche'}`,
        });
      }
    } catch (_) { /* table absente — on ignore */ }

    res.json({
      tour: {
        id: tour.id,
        date: tour.date,
        status: tour.status,
        collection_type: tour.collection_type,
        started_at: tour.started_at,
        completed_at: tour.completed_at,
        estimated_distance_km: tour.estimated_distance_km,
        estimated_duration_min: tour.estimated_duration_min,
        vehicle: {
          id: tour.vehicle_id,
          registration: tour.registration,
          name: tour.vehicle_name,
          max_capacity_kg: tour.max_capacity_kg,
        },
        driver: {
          id: tour.driver_id,
          name: tour.driver_name,
        },
      },
      kpis: {
        nb_cav_total: nbTotal,
        nb_cav_collected: nbCollected,
        progress_percent: nbTotal > 0 ? Math.round((nbCollected / nbTotal) * 100) : 0,
        fill_cumulated_percent: avgFillPercent,
        total_weight_kg: Math.round(totalWeight * 10) / 10,
        distance_km: distanceKm,
        elapsed_min: elapsedMin,
        avg_delay_min: avgDelayMin,
        eta_end: etaEnd,
        incidents_open: incidentsOpenCount,
      },
      last_position: lastPosition ? {
        latitude: parseFloat(lastPosition.latitude),
        longitude: parseFloat(lastPosition.longitude),
        speed: lastPosition.speed,
        recorded_at: lastPosition.recorded_at,
      } : null,
      points: enrichedPoints,
      incidents,
      weights: weightsResult.rows,
      alerts,
      planned_source: plannedSource,
    });
  } catch (err) {
    console.error('[TOURS] Erreur live-summary :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

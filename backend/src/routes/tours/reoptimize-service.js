// ══════════════════════════════════════════════════════════════
// Service interne de ré-optimisation (Niveau 2.6)
// ══════════════════════════════════════════════════════════════
// Logique découplée du router pour être importable depuis les
// endpoints d'auto-déclenchement (incident, skip, delay, etc.).

const pool = require('../../config/database');
const {
  OSRM_BASE_URL,
  haversineDistance,
  nearestNeighborTSP,
  osrmOptimizedTrip,
  calculateTotalDistance,
} = require('./geo');
const { CENTRE_TRI_LAT, CENTRE_TRI_LNG } = require('./context');
const { computeAndStorePlannedPassages } = require('./planned-passage');

const REOPT_AVG_SPEED_KMH = 28;
const MIN_GAIN_PERCENT = 5; // seuil en % pour proposer une ré-optim

async function osrmRouteTotal(waypoints) {
  try {
    const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
    const url = `${OSRM_BASE_URL}/route/v1/driving/${coords}?overview=false&steps=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes?.[0]) {
      return {
        distance_km: data.routes[0].distance / 1000,
        duration_min: data.routes[0].duration / 60,
      };
    }
  } catch (_) { /* fallback */ }
  let dist = 0;
  for (let i = 1; i < waypoints.length; i++) {
    dist += haversineDistance(waypoints[i - 1].lat, waypoints[i - 1].lng, waypoints[i].lat, waypoints[i].lng) * 1.3;
  }
  return { distance_km: dist, duration_min: (dist / REOPT_AVG_SPEED_KMH) * 60 };
}

async function proposeReoptimization({
  tourId,
  triggerReason = 'manual',
  triggeredBy = 'auto',
  currentLat = null,
  currentLng = null,
  io = null,
}) {
  const tourRes = await pool.query(
    'SELECT id, collection_type, status FROM tours WHERE id = $1',
    [tourId]
  );
  if (tourRes.rows.length === 0) return { error: 'Tournée non trouvée' };
  const tour = tourRes.rows[0];
  if (tour.status !== 'in_progress') {
    return { error: `Tournée non en cours (statut: ${tour.status})` };
  }
  const isAssoc = tour.collection_type === 'association';

  const remainingRes = isAssoc
    ? await pool.query(
        `SELECT tap.id, tap.association_point_id AS cav_id, tap.position,
                ap.name AS cav_name, ap.latitude, ap.longitude
           FROM tour_association_point tap
           JOIN association_points ap ON ap.id = tap.association_point_id
          WHERE tap.tour_id = $1 AND tap.status = 'pending'
            AND ap.latitude IS NOT NULL AND ap.longitude IS NOT NULL
          ORDER BY tap.position`,
        [tourId]
      )
    : await pool.query(
        `SELECT tc.id, tc.cav_id, tc.position,
                c.name AS cav_name, c.latitude, c.longitude
           FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
          WHERE tc.tour_id = $1 AND tc.status = 'pending'
            AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
          ORDER BY tc.position`,
        [tourId]
      );
  const remaining = remainingRes.rows.map(r => ({
    id: r.id,
    cav_id: r.cav_id,
    position: r.position,
    cav_name: r.cav_name,
    latitude: parseFloat(r.latitude),
    longitude: parseFloat(r.longitude),
  }));

  if (remaining.length < 2) {
    return { skipped: true, reason: 'moins_de_2_points_restants' };
  }

  // Éviter les doublons de propositions pendantes
  const pending = await pool.query(
    `SELECT id FROM tour_reoptimizations WHERE tour_id = $1 AND status = 'pending' LIMIT 1`,
    [tourId]
  );
  if (pending.rows.length > 0) {
    return { skipped: true, reason: 'proposition_pending_existante', existing_id: pending.rows[0].id };
  }

  const startLat = Number.isFinite(currentLat) ? currentLat : CENTRE_TRI_LAT;
  const startLng = Number.isFinite(currentLng) ? currentLng : CENTRE_TRI_LNG;

  const oldSequence = remaining.map(r => r.id);
  const oldTotal = await osrmRouteTotal([
    { lat: startLat, lng: startLng },
    ...remaining.map(r => ({ lat: r.latitude, lng: r.longitude })),
    { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG },
  ]);

  let orderedPoints = null;
  let newTotal = oldTotal;
  const optimized = await osrmOptimizedTrip(remaining, startLat, startLng);
  if (optimized?.orderedPoints) {
    orderedPoints = optimized.orderedPoints;
    newTotal = { distance_km: optimized.distance_km, duration_min: optimized.duration_min };
  } else {
    orderedPoints = nearestNeighborTSP(remaining, startLat, startLng);
    const fbDistance = calculateTotalDistance(orderedPoints, startLat, startLng);
    newTotal = { distance_km: fbDistance, duration_min: (fbDistance / REOPT_AVG_SPEED_KMH) * 60 };
  }
  const newSequence = orderedPoints.map(p => p.id);

  const sameOrder = newSequence.length === oldSequence.length &&
    newSequence.every((v, i) => v === oldSequence[i]);
  const gainPercent = oldTotal.distance_km > 0
    ? ((oldTotal.distance_km - newTotal.distance_km) / oldTotal.distance_km) * 100
    : 0;
  if (sameOrder || gainPercent < MIN_GAIN_PERCENT) {
    return {
      skipped: true,
      reason: sameOrder ? 'ordre_identique' : 'gain_marginal',
      gainPercent: Math.round(gainPercent * 10) / 10,
    };
  }

  const insert = await pool.query(
    `INSERT INTO tour_reoptimizations
       (tour_id, trigger_reason, triggered_by, current_lat, current_lng,
        old_sequence, new_sequence, old_distance_km, new_distance_km,
        old_duration_min, new_duration_min, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, 'pending')
     RETURNING id, triggered_at`,
    [
      tourId, triggerReason, triggeredBy, startLat, startLng,
      JSON.stringify(oldSequence), JSON.stringify(newSequence),
      oldTotal.distance_km, newTotal.distance_km,
      oldTotal.duration_min, newTotal.duration_min,
    ]
  );
  const proposal = {
    id: insert.rows[0].id,
    tour_id: tourId,
    trigger_reason: triggerReason,
    triggered_by: triggeredBy,
    triggered_at: insert.rows[0].triggered_at,
    old_sequence: oldSequence,
    new_sequence: newSequence,
    old_distance_km: Math.round(oldTotal.distance_km * 10) / 10,
    new_distance_km: Math.round(newTotal.distance_km * 10) / 10,
    old_duration_min: Math.round(oldTotal.duration_min),
    new_duration_min: Math.round(newTotal.duration_min),
    gain_distance_km: Math.round((oldTotal.distance_km - newTotal.distance_km) * 10) / 10,
    gain_percent: Math.round(gainPercent * 10) / 10,
    points: orderedPoints.map((p, idx) => ({
      id: p.id,
      cav_id: p.cav_id,
      cav_name: p.cav_name,
      old_position: p.position,
      new_position: idx + 1,
    })),
  };

  if (io) io.to(`tour-${tourId}`).emit('reoptimization-proposal', proposal);
  return { created: true, proposal };
}

async function applyReoptimization(reoptId, userId = null) {
  const rowRes = await pool.query('SELECT * FROM tour_reoptimizations WHERE id = $1', [reoptId]);
  if (rowRes.rows.length === 0) return { error: 'Proposition non trouvée' };
  const reopt = rowRes.rows[0];
  if (reopt.status !== 'pending') return { error: `Proposition déjà ${reopt.status}` };

  const tourRes = await pool.query('SELECT collection_type FROM tours WHERE id = $1', [reopt.tour_id]);
  const isAssoc = tourRes.rows[0]?.collection_type === 'association';
  const targetTable = isAssoc ? 'tour_association_point' : 'tour_cav';

  const pinned = await pool.query(
    `SELECT COALESCE(MAX(position), 0)::int AS max_pos
       FROM ${targetTable}
       WHERE tour_id = $1 AND status <> 'pending'`,
    [reopt.tour_id]
  );
  const baseOffset = pinned.rows[0]?.max_pos || 0;

  const newSequence = Array.isArray(reopt.new_sequence) ? reopt.new_sequence : JSON.parse(reopt.new_sequence);
  for (let i = 0; i < newSequence.length; i++) {
    await pool.query(
      `UPDATE ${targetTable} SET position = $1 WHERE id = $2 AND tour_id = $3`,
      [baseOffset + i + 1, newSequence[i], reopt.tour_id]
    );
  }

  await pool.query(
    `UPDATE tour_reoptimizations
        SET status = 'accepted', decided_at = NOW(), decided_by_user_id = $1
      WHERE id = $2`,
    [userId, reoptId]
  );

  await pool.query(
    `UPDATE ${targetTable} SET planned_passage_time = NULL
      WHERE tour_id = $1 AND status = 'pending'`,
    [reopt.tour_id]
  );
  await computeAndStorePlannedPassages(reopt.tour_id).catch(() => {});

  return { accepted: true, tour_id: reopt.tour_id };
}

async function rejectReoptimization(reoptId, userId = null) {
  const res = await pool.query(
    `UPDATE tour_reoptimizations
        SET status = 'rejected', decided_at = NOW(), decided_by_user_id = $1
      WHERE id = $2 AND status = 'pending'
      RETURNING id, tour_id`,
    [userId, reoptId]
  );
  if (res.rows.length === 0) return { error: 'Proposition non trouvée ou déjà traitée' };
  return { rejected: true, tour_id: res.rows[0].tour_id };
}

module.exports = {
  proposeReoptimization,
  applyReoptimization,
  rejectReoptimization,
};

// ══════════════════════════════════════════════════════════════
// Calcul des horaires prévisionnels de passage à chaque CAV
// ══════════════════════════════════════════════════════════════
//
// Appelé au démarrage d'une tournée (passage in_progress). Interroge
// OSRM avec la séquence complète des points (centre → CAV1 → CAV2…)
// en un seul appel, récupère la durée de chaque tronçon, puis ajoute
// un temps de service fixe par arrêt pour obtenir le timestamp
// prévisionnel de chaque collecte. Les timestamps sont persistés dans
// tour_cav.planned_passage_time (ou tour_association_point si la
// tournée est de type 'association').

const pool = require('../../config/database');
const { OSRM_BASE_URL, haversineDistance } = require('./geo');
const { CENTRE_TRI_LAT, CENTRE_TRI_LNG } = require('./context');

// Temps de service moyen par point (arrêt, benne, QR scan, …) en minutes.
// Aligné sur l'observé dans cav_collection_times (généralement 3-6 min).
const SERVICE_TIME_MIN_PER_POINT = parseFloat(process.env.SERVICE_TIME_MIN || '4');

// Vitesse moyenne fallback (km/h) si OSRM indisponible.
const FALLBACK_AVG_SPEED_KMH = 28;

// ── OSRM : route multi-waypoints, retourne la durée de chaque leg ───
async function osrmRouteLegs(waypoints) {
  try {
    const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
    const url = `${OSRM_BASE_URL}/route/v1/driving/${coords}?overview=false&steps=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes?.[0]?.legs) {
      return data.routes[0].legs.map(l => ({
        duration_min: l.duration / 60,
        distance_km: l.distance / 1000,
      }));
    }
  } catch (err) {
    console.warn('[PLANNED-PASSAGE] OSRM legs error, fallback haversine:', err.message);
  }
  // Fallback : durées par paire basé sur Haversine × 1.3 / vitesse moyenne
  const legs = [];
  for (let i = 1; i < waypoints.length; i++) {
    const d = haversineDistance(waypoints[i - 1].lat, waypoints[i - 1].lng, waypoints[i].lat, waypoints[i].lng) * 1.3;
    legs.push({ duration_min: (d / FALLBACK_AVG_SPEED_KMH) * 60, distance_km: d });
  }
  return legs;
}

// ── Calcul principal ────────────────────────────────────────────────
// Entrée : tour_id (tournée en base, idéalement started_at renseigné)
// Écrit  : tour_cav.planned_passage_time (ou tour_association_point)
// Retour : { updated: N, legs: [...] } ou null si aucune coord valide
async function computeAndStorePlannedPassages(tourId) {
  if (!tourId) return null;
  const tourRes = await pool.query(
    `SELECT id, collection_type, started_at FROM tours WHERE id = $1`,
    [tourId]
  );
  if (tourRes.rows.length === 0) return null;
  const tour = tourRes.rows[0];
  const startAt = tour.started_at ? new Date(tour.started_at) : new Date();
  const isAssoc = tour.collection_type === 'association';

  // Charger points ordonnés
  const pointsQuery = isAssoc
    ? `SELECT tap.id, ap.latitude, ap.longitude
         FROM tour_association_point tap
         JOIN association_points ap ON ap.id = tap.association_point_id
         WHERE tap.tour_id = $1 ORDER BY tap.position`
    : `SELECT tc.id, c.latitude, c.longitude
         FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
         WHERE tc.tour_id = $1 ORDER BY tc.position`;
  const pointsRes = await pool.query(pointsQuery, [tourId]);
  const points = pointsRes.rows.filter(p => p.latitude !== null && p.longitude !== null);
  if (points.length === 0) return { updated: 0, legs: [] };

  // Waypoints = centre de tri + chaque CAV
  const waypoints = [
    { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG },
    ...points.map(p => ({ lat: parseFloat(p.latitude), lng: parseFloat(p.longitude) })),
  ];

  const legs = await osrmRouteLegs(waypoints);

  // Cumul des durées + temps de service à chaque arrêt
  let cumulativeMs = 0;
  const targetTable = isAssoc ? 'tour_association_point' : 'tour_cav';
  let updated = 0;
  for (let i = 0; i < points.length; i++) {
    const leg = legs[i] || { duration_min: 0 };
    cumulativeMs += leg.duration_min * 60 * 1000;
    // Le temps de service de ce CAV vient après le trajet — le passage = arrivée
    const plannedAt = new Date(startAt.getTime() + cumulativeMs);
    // Ajoute le temps de service pour le départ (impacte les CAV suivants)
    cumulativeMs += SERVICE_TIME_MIN_PER_POINT * 60 * 1000;

    await pool.query(
      `UPDATE ${targetTable} SET planned_passage_time = $1 WHERE id = $2`,
      [plannedAt.toISOString(), points[i].id]
    );
    updated++;
  }
  return { updated, legs };
}

// Helper : ne déclenche le calcul que si les plannings ne sont pas déjà calculés.
async function ensurePlannedPassages(tourId) {
  if (!tourId) return null;
  const res = await pool.query(
    `SELECT COUNT(*)::int AS n FROM tour_cav
      WHERE tour_id = $1 AND planned_passage_time IS NOT NULL`,
    [tourId]
  );
  const resAssoc = await pool.query(
    `SELECT COUNT(*)::int AS n FROM tour_association_point
      WHERE tour_id = $1 AND planned_passage_time IS NOT NULL`,
    [tourId]
  ).catch(() => ({ rows: [{ n: 0 }] }));
  if ((res.rows[0]?.n || 0) > 0 || (resAssoc.rows[0]?.n || 0) > 0) return { skipped: true };
  return computeAndStorePlannedPassages(tourId);
}

module.exports = {
  computeAndStorePlannedPassages,
  ensurePlannedPassages,
  SERVICE_TIME_MIN_PER_POINT,
};

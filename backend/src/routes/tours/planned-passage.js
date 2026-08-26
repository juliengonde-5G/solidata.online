// ══════════════════════════════════════════════════════════════
// Calcul des horaires prévisionnels de passage à chaque point
// ══════════════════════════════════════════════════════════════
//
// Appelé au démarrage d'une tournée (passage in_progress), quel que soit le
// MODE de la tournée (intelligente, standard, manuelle, association). Interroge
// OSRM avec la séquence complète des points (centre → P1 → P2…) en un seul
// appel, puis fait tourner le MÊME moteur de temps que la planification
// (services/tour-time-engine) pour obtenir des ETA réalistes :
//   - temps de service par point : durée APPRISE (cav_collection_times) sinon
//     le défaut paramétré `scoring.timePerCav` ;
//   - PAUSE DÉJEUNER au centre de tri, ancrée sur l'heure RÉELLE de départ
//     (tours.started_at) — elle décale tous les points de l'après-midi ;
//   - RETOURS DE VIDAGE estimés à partir du remplissage prédit déjà stocké
//     dans tour_cav.predicted_fill_rate (aucun appel de prédiction ici) ;
//   - vitesse de repli = `scoring.avgSpeed` quand OSRM est indisponible.
//
// Avant août 2026, ce second moteur de temps ignorait pause et vidages et
// appliquait un temps de service fixe de 4 min : les horaires d'après-midi
// étaient systématiquement optimistes.
//
// Les timestamps sont persistés dans tour_cav.planned_passage_time (ou
// tour_association_point si la tournée est de type 'association') — format
// inchangé (timestamp ISO).

const pool = require('../../config/database');
const { OSRM_BASE_URL, haversineDistance, resolveAvgSpeedKmh, ROAD_FACTOR } = require('./geo');
const { CENTRE_TRI_LAT, CENTRE_TRI_LNG } = require('./context');
const { getScoringConfig } = require('./predictions');
const fillFactors = require('../../utils/fill-factors');
const timeEngine = require('../../services/tour-time-engine');
const {
  loadLearnedTimesPerCav, learnedTimeFor, timeEngineOptions,
  resolveServiceMinutes, ancrageDuPoint,
} = require('./smart-tour');

// Temps de service moyen par point, ULTIME repli historique (minutes).
// Il n'est retenu QUE si la variable d'environnement SERVICE_TIME_MIN est
// explicitement définie ; sinon on prend le temps appris par CAV, à défaut le
// défaut paramétrable `scoring.timePerCav`.
const SERVICE_TIME_MIN_PER_POINT = parseFloat(process.env.SERVICE_TIME_MIN || '4');
const SERVICE_TIME_FORCED = process.env.SERVICE_TIME_MIN != null && process.env.SERVICE_TIME_MIN !== '';

// Vitesse moyenne fallback (km/h) si OSRM ET la config sont indisponibles.
const FALLBACK_AVG_SPEED_KMH = 28;

// Remplissage retenu quand `tour_cav.predicted_fill_rate` est vide : le poids
// ne sert qu'à anticiper les retours de vidage, jamais à un chiffre publié.
const DEFAULT_FILL_PCT = 50;

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
  const speed = resolveAvgSpeedKmh(FALLBACK_AVG_SPEED_KMH);
  const legs = [];
  for (let i = 1; i < waypoints.length; i++) {
    const d = haversineDistance(waypoints[i - 1].lat, waypoints[i - 1].lng, waypoints[i].lat, waypoints[i].lng) * ROAD_FACTOR;
    legs.push({ duration_min: (d / speed) * 60, distance_km: d });
  }
  return legs;
}

/** Clé de tronçon (5 décimales ≈ 1 m), pour retrouver un leg OSRM déjà connu. */
function coordKey(lat, lng) {
  const f = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v).toFixed(5) : 'x');
  return `${f(lat)},${f(lng)}`;
}

/**
 * Fabrique la fonction `routeLeg` du moteur de temps à partir d'UN SEUL appel
 * OSRM (la chaîne centre → P1 → … → Pn). Les tronçons consécutifs de la chaîne
 * sont servis depuis ce résultat ; les autres (retour au centre pour la pause
 * ou un vidage, puis reprise) sont estimés en Haversine × 1.3 / vitesse moyenne
 * — on évite ainsi N appels HTTP au démarrage d'une tournée.
 */
function makeChainRouteLeg(waypoints, legs) {
  const chain = new Map();
  for (let i = 1; i < waypoints.length; i++) {
    const key = `${coordKey(waypoints[i - 1].lat, waypoints[i - 1].lng)}>${coordKey(waypoints[i].lat, waypoints[i].lng)}`;
    const leg = legs[i - 1] || { duration_min: 0, distance_km: 0 };
    chain.set(key, { km: leg.distance_km, minutes: leg.duration_min });
  }
  const speed = resolveAvgSpeedKmh(FALLBACK_AVG_SPEED_KMH);
  return async (from, to) => {
    const key = `${coordKey(from.lat, from.lng)}>${coordKey(to.lat, to.lng)}`;
    if (chain.has(key)) return chain.get(key);
    if (!Number.isFinite(parseFloat(from.lat)) || !Number.isFinite(parseFloat(to.lat))) {
      return { km: 0, minutes: 0 };
    }
    const d = haversineDistance(
      parseFloat(from.lat), parseFloat(from.lng), parseFloat(to.lat), parseFloat(to.lng)
    ) * ROAD_FACTOR;
    return { km: d, minutes: (d / speed) * 60 };
  };
}

// ── Calcul principal ────────────────────────────────────────────────
// Entrée : tour_id (tournée en base, idéalement started_at renseigné)
// Écrit  : tour_cav.planned_passage_time (ou tour_association_point)
// Retour : { updated: N, legs: [...], estimation } ou null si aucune coord valide
async function computeAndStorePlannedPassages(tourId) {
  if (!tourId) return null;
  const tourRes = await pool.query(
    `SELECT t.id, t.collection_type, t.started_at, t.vehicle_id, v.max_capacity_kg
       FROM tours t LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.id = $1`,
    [tourId]
  );
  if (tourRes.rows.length === 0) return null;
  const tour = tourRes.rows[0];
  const startAt = tour.started_at ? new Date(tour.started_at) : new Date();
  const isAssoc = tour.collection_type === 'association';

  // Charger points ordonnés (+ données servant au temps de service et au poids)
  // Points association : la durée d'arrêt suit la MÊME cascade que
  // l'estimation (ajustement de la tournée > fiche > réglage global) et le
  // rendez-vous éventuel ancre l'heure de passage. Sans cela, l'heure prévue
  // affichée au chauffeur contredirait celle annoncée à la planification.
  const pointsQuery = isAssoc
    ? `SELECT tap.id, tap.association_point_id AS ref_id, ap.name,
              ap.latitude, ap.longitude, NULL::int AS nb_containers, NULL::float AS predicted_fill_rate,
              tap.duree_prevue_min, ap.duree_collecte_min,
              d.id AS demande_id, d.heure_debut, d.heure_fin, d.tolerance_min
         FROM tour_association_point tap
         JOIN association_points ap ON ap.id = tap.association_point_id
         LEFT JOIN association_collecte_demandes d
                ON d.id = tap.demande_id AND d.annulee_le IS NULL
         WHERE tap.tour_id = $1 ORDER BY tap.position`
    : `SELECT tc.id, tc.cav_id AS ref_id, c.name,
              c.latitude, c.longitude, c.nb_containers, tc.predicted_fill_rate
         FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
         WHERE tc.tour_id = $1 ORDER BY tc.position`;
  const pointsRes = await pool.query(pointsQuery, [tourId]);
  const points = pointsRes.rows.filter(p => p.latitude !== null && p.longitude !== null);
  if (points.length === 0) return { updated: 0, legs: [] };

  // Waypoints = centre de tri + chaque point
  const waypoints = [
    { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG },
    ...points.map(p => ({ lat: parseFloat(p.latitude), lng: parseFloat(p.longitude) })),
  ];

  const legs = await osrmRouteLegs(waypoints);

  // Temps de service : appris > défaut paramétré (> SERVICE_TIME_MIN si forcé).
  const cfg = getScoringConfig();
  const defaultService = SERVICE_TIME_FORCED
    ? SERVICE_TIME_MIN_PER_POINT
    : (parseFloat(cfg.timePerCav) || 10);
  const learned = isAssoc
    ? new Map()
    : await loadLearnedTimesPerCav(points.map(p => p.ref_id));

  const toleranceRdv = parseFloat(cfg.rdvToleranceMin);
  const enginePoints = points.map((p) => {
    const fill = p.predicted_fill_rate != null && Number.isFinite(parseFloat(p.predicted_fill_rate))
      ? parseFloat(p.predicted_fill_rate)
      : (isAssoc ? null : DEFAULT_FILL_PCT);
    return {
      id: p.ref_id,
      type: isAssoc ? 'association' : 'cav',
      name: p.name,
      lat: parseFloat(p.latitude),
      lng: parseFloat(p.longitude),
      serviceMinutes: isAssoc
        ? resolveServiceMinutes(p, defaultService)
        : learnedTimeFor(learned, p.ref_id, defaultService),
      weightKg: fill != null ? (fill / 100) * fillFactors.getCapacityKg(p.nb_containers) : 0,
      // Rendez-vous : l'attente éventuelle avant l'ouverture décale TOUS les
      // points suivants. Les horaires d'accessibilité, eux, ne fabriquent
      // aucune attente (doctrine) : ils ne sont pas passés ici.
      anchor: isAssoc && p.heure_debut
        ? ancrageDuPoint({ _demande: p }, Number.isFinite(toleranceRdv) ? toleranceRdv : 15)
        : null,
    };
  });

  // Départ ancré sur l'heure RÉELLE (started_at) : la pause déjeuner tombe au
  // bon moment, y compris pour une tournée partie en retard ou l'après-midi.
  const startHour = startAt.getHours() + startAt.getMinutes() / 60;
  const estimation = await timeEngine.buildTimeline(enginePoints, {
    ...timeEngineOptions({ max_capacity_kg: tour.max_capacity_kg }, { startHour }),
    routeLeg: makeChainRouteLeg(waypoints, legs),
  });

  // Les entrées « point » de la timeline sont dans l'ordre des points fournis :
  // l'arrivée (minutes depuis le départ) donne l'horaire prévisionnel.
  const arrivals = estimation.timeline.filter((t) => t.type === 'point');
  const targetTable = isAssoc ? 'tour_association_point' : 'tour_cav';
  let updated = 0;
  for (let i = 0; i < points.length; i++) {
    const arrival = arrivals[i];
    if (!arrival) continue;
    const plannedAt = new Date(startAt.getTime() + arrival.arrivee_min * 60 * 1000);
    await pool.query(
      `UPDATE ${targetTable} SET planned_passage_time = $1 WHERE id = $2`,
      [plannedAt.toISOString(), points[i].id]
    );
    updated++;
  }
  return { updated, legs, estimation };
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

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


/**
 * HEURE MURALE DE PARIS d'un instant, en heures décimales (9 h 27 → 9.45).
 *
 * Le moteur de temps raisonne en heure d'horloge : « la pause déjeuner à
 * 12 h ». Encore faut-il lui donner la bonne horloge. Le conteneur backend
 * tourne en UTC — `new Date().getHours()` y renvoie 10 quand il est midi à
 * Rouen. La pause de midi se déclenchait donc à 12 h UTC, c'est-à-dire à
 * 14 h heure de Paris en été (13 h en hiver) : deux heures après le moment
 * voulu, toute l'année.
 *
 * Même famille de piège que le jour civil des tournées (2.24.1) et que les
 * horaires VAK (2.20.0) : l'instant se stocke en UTC, l'heure se LIT à Paris.
 * `Intl` gère le changement d'heure sans table à maintenir.
 *
 * Fonction PURE, exportée pour être testée aux deux saisons.
 */
function heureMuraleParis(instant) {
  const d = instant instanceof Date ? instant : new Date(instant);
  // `formatToParts` LÈVE sur une date invalide : la garde doit être ici, avant
  // l'appel. Un horodatage illisible ne doit pas faire échouer une collecte.
  if (Number.isNaN(d.getTime())) return 8;                    // défaut du moteur
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const h = Number(parts.find((x) => x.type === 'hour')?.value);
  const m = Number(parts.find((x) => x.type === 'minute')?.value);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 8;
  return (h % 24) + m / 60;
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
  // Heure de PARIS et non celle du conteneur (UTC) — sans quoi la pause de midi
  // se déclenche à 14 h heure locale.
  const startHour = heureMuraleParis(startAt);
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


// ══════════════════════════════════════════════════════════════
// REPLANIFICATION SUR L'AVANCEMENT RÉEL
// ══════════════════════════════════════════════════════════════

/**
 * Où se trouve réellement l'équipage, et depuis combien de temps il travaille.
 *
 * La position est celle du DERNIER élément traité du programme — borne
 * collectée ou sautée, ou passage au centre dont l'arrivée a été déclarée. Rien
 * de traité (la tournée vient de démarrer) → le centre de tri, qui est le point
 * de départ réel.
 *
 * Le travail déjà fait est mesuré à l'horloge (`NOW() - started_at`), moins la
 * pause déjà prise. C'est une mesure GROSSIÈRE — elle compte les minutes
 * perdues comme du travail — mais c'est une mesure du RÉEL, là où la simulation
 * ne donnerait qu'une journée théorique de plus. Sur la question posée (« la
 * pause est-elle due ? »), le temps passé depuis le départ est précisément ce
 * qui compte.
 */
async function lireAvancement(tourId, centre) {
  const r = await pool.query(
    `WITH traites AS (
       SELECT tc.position, c.latitude, c.longitude, c.name
         FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
        WHERE tc.tour_id = $1 AND tc.status IN ('collected', 'skipped', 'incident')
       UNION ALL
       SELECT tap.position, ap.latitude, ap.longitude, ap.name
         FROM tour_association_point tap JOIN association_points ap ON ap.id = tap.association_point_id
        WHERE tap.tour_id = $1 AND tap.status IN ('collected', 'skipped', 'incident')
       UNION ALL
       SELECT ta.position, l.latitude, l.longitude, ta.libelle
         FROM tour_arret_technique ta LEFT JOIN lieux_techniques l ON l.id = ta.lieu_id
        WHERE ta.tour_id = $1 AND ta.status = 'done'
     )
     SELECT position, latitude, longitude, name FROM traites ORDER BY position DESC LIMIT 1`,
    [tourId]
  ).catch(() => ({ rows: [] }));

  const dernier = r.rows[0];
  const position = (dernier && dernier.latitude != null && dernier.longitude != null)
    ? { lat: parseFloat(dernier.latitude), lng: parseFloat(dernier.longitude), name: dernier.name }
    : { lat: centre.lat, lng: centre.lng, name: centre.name };
  return { position, derniere_position_programme: dernier ? parseInt(dernier.position, 10) : 0 };
}

/** La pause du jour a-t-elle DÉJÀ eu lieu ? (arrêt « done » — un fait, pas une prévision) */
async function pauseDejaPrise(tourId) {
  const r = await pool.query(
    `SELECT 1 FROM tour_arret_technique
      WHERE tour_id = $1 AND motif = 'pause_dejeuner' AND status = 'done' LIMIT 1`,
    [tourId]
  ).catch(() => ({ rows: [] }));
  return r.rows.length > 0;
}

/**
 * Rejoue le RESTE de la journée depuis maintenant, réécrit les heures prévues
 * des points encore à faire, et dit après combien de points restants la pause
 * déjeuner tombe.
 *
 * C'est la SOURCE UNIQUE : la même simulation donne l'heure et la place. Deux
 * calculs séparés finissaient par se contredire (constat du 02/09/2026).
 *
 * @returns {Promise<{heures_mises_a_jour:number, pause_apres_n_points:number|null,
 *                    estimation:object}|{motif:string}>}
 */
async function computePlanEnCours(tourId) {
  if (!tourId) return { motif: 'identifiant_manquant' };
  const tourRes = await pool.query(
    `SELECT t.id, t.collection_type, t.started_at, t.status, t.vehicle_id, v.max_capacity_kg
       FROM tours t LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.id = $1`,
    [tourId]
  );
  if (tourRes.rows.length === 0) return { motif: 'tournee_introuvable' };
  const tour = tourRes.rows[0];
  // Une tournée qui n'a pas commencé n'a pas d'avancement à suivre ; une
  // tournée close ne se replanifie pas.
  if (tour.status !== 'in_progress') return { motif: 'tournee_non_en_cours' };

  const isAssoc = tour.collection_type === 'association';
  const centre = { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG, name: 'Centre de tri' };

  // Points RESTANTS seulement : ce qui est fait ne se refait pas.
  const pointsQuery = isAssoc
    ? `SELECT tap.id, tap.association_point_id AS ref_id, ap.name,
              ap.latitude, ap.longitude, NULL::int AS nb_containers, NULL::float AS predicted_fill_rate,
              tap.duree_prevue_min, ap.duree_collecte_min,
              d.id AS demande_id, d.heure_debut, d.heure_fin, d.tolerance_min
         FROM tour_association_point tap
         JOIN association_points ap ON ap.id = tap.association_point_id
         LEFT JOIN association_collecte_demandes d
                ON d.id = tap.demande_id AND d.annulee_le IS NULL
        WHERE tap.tour_id = $1 AND tap.status = 'pending' ORDER BY tap.position`
    : `SELECT tc.id, tc.cav_id AS ref_id, c.name,
              c.latitude, c.longitude, c.nb_containers, tc.predicted_fill_rate
         FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
        WHERE tc.tour_id = $1 AND tc.status = 'pending' ORDER BY tc.position`;
  const pointsRes = await pool.query(pointsQuery, [tourId]);
  const points = pointsRes.rows.filter((p) => p.latitude !== null && p.longitude !== null);
  if (points.length === 0) return { motif: 'aucun_point_restant' };

  const { position: depuis } = await lireAvancement(tourId, centre);
  const dejaPrise = await pauseDejaPrise(tourId);

  // Travail déjà accompli, à l'horloge. Borné à la journée : une tournée dont
  // le `started_at` traîne d'un jour ne doit pas déclencher une pause absurde.
  const maintenant = new Date();
  const depart = tour.started_at ? new Date(tour.started_at) : maintenant;
  const priorWorkMinutes = Math.min(
    24 * 60,
    Math.max(0, Math.round((maintenant.getTime() - depart.getTime()) / 60000))
  );

  // L'itinéraire part de la POSITION RÉELLE, pas du centre.
  const waypoints = [
    { lat: depuis.lat, lng: depuis.lng },
    ...points.map((p) => ({ lat: parseFloat(p.latitude), lng: parseFloat(p.longitude) })),
  ];
  const legs = await osrmRouteLegs(waypoints);

  const cfg = getScoringConfig();
  const defaultService = SERVICE_TIME_FORCED
    ? SERVICE_TIME_MIN_PER_POINT
    : (parseFloat(cfg.timePerCav) || 10);
  const learned = isAssoc ? new Map() : await loadLearnedTimesPerCav(points.map((p) => p.ref_id));
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
      anchor: isAssoc && p.heure_debut
        ? ancrageDuPoint({ _demande: p }, Number.isFinite(toleranceRdv) ? toleranceRdv : 15)
        : null,
    };
  });

  // L'horloge repart de MAINTENANT — c'est tout l'objet de la manœuvre — et à
  // l'heure de PARIS, celle que lit l'équipage sur son tableau de bord.
  const startHour = heureMuraleParis(maintenant);
  const estimation = await timeEngine.buildTimeline(enginePoints, {
    ...timeEngineOptions({ max_capacity_kg: tour.max_capacity_kg }, { startHour }),
    routeLeg: makeChainRouteLeg(waypoints, legs),
    startPosition: depuis,
    priorWorkMinutes,
    lunchAlreadyTaken: dejaPrise,
  });

  // Heures prévues des points RESTANTS. Les points déjà traités gardent la
  // leur : c'est la trace de ce qui avait été annoncé, que l'écran confronte à
  // l'heure réelle.
  const arrivals = estimation.timeline.filter((t) => t.type === 'point');
  const targetTable = isAssoc ? 'tour_association_point' : 'tour_cav';
  let heures = 0;
  for (let i = 0; i < points.length; i++) {
    const arrival = arrivals[i];
    if (!arrival) continue;
    const plannedAt = new Date(maintenant.getTime() + arrival.arrivee_min * 60 * 1000);
    await pool.query(
      `UPDATE ${targetTable} SET planned_passage_time = $1 WHERE id = $2`,
      [plannedAt.toISOString(), points[i].id]
    );
    heures++;
  }

  // Après combien de points RESTANTS la pause tombe-t-elle ? `null` = le moteur
  // n'en prévoit aucune (déjà prise, ou journée qui finit avant l'heure).
  const idxPause = estimation.timeline.findIndex((t) => t && t.type === 'pause_dejeuner');
  const pauseApres = idxPause < 0
    ? null
    : estimation.timeline.slice(0, idxPause).filter((t) => t && t.type === 'point').length;

  return {
    heures_mises_a_jour: heures,
    pause_apres_n_points: pauseApres,
    pause_deja_prise: dejaPrise,
    travail_deja_fait_min: priorWorkMinutes,
    estimation,
  };
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
  computePlanEnCours,
  heureMuraleParis,
  SERVICE_TIME_MIN_PER_POINT,
};

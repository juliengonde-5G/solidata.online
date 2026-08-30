const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { osrmRouteGeometry } = require('./geo');
const { CENTRE_TRI_LAT, CENTRE_TRI_LNG } = require('./context');

// GET /api/tours/active-summary?date=YYYY-MM-DD
// Synthèse de TOUTES les tournées actives du jour pour la vue "Collecte en direct"
// Renvoie : KPIs agrégés + une entrée par tournée (résumé compact + points + dernière position)
router.get('/active-summary', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    // 1. Tournées du jour avec véhicule + chauffeur
    const toursRes = await pool.query(
      `SELECT t.id, t.date, t.status, t.collection_type,
              t.started_at, t.completed_at,
              t.estimated_duration_min, t.estimated_distance_km AS distance_km,
              v.id AS vehicle_id, v.registration, v.name AS vehicle_name,
              v.max_capacity_kg,
              NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '') AS driver_name,
              e.id AS driver_id
       FROM tours t
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
       LEFT JOIN employees e ON e.id = t.driver_employee_id
       WHERE t.date = $1
         AND t.status IN ('planned', 'in_progress', 'returning')
       ORDER BY t.started_at ASC NULLS LAST, t.id ASC`,
      [date]
    );

    const tours = toursRes.rows;
    if (tours.length === 0) {
      return res.json({
        date,
        kpis: {
          vehicules_actifs: 0,
          cav_a_vider: 0,
          avancement_pct: 0,
          distance_restante_km: 0,
        },
        tours: [],
      });
    }

    const tourIds = tours.map((t) => t.id);

    // 2. Points (CAV ou association points selon collection_type)
    //
    // Aucun poids par point : le camion est pesé au centre de tri, pas borne par
    // borne. La colonne existait ici en NULL constant, et l'écran affichait donc
    // une colonne de tirets qui se lisait comme une donnée manquante alors
    // qu'elle n'a jamais existé. Le poids se lit au total de la tournée
    // (tour_weights), là où il est réellement mesuré.
    const cavPointsRes = await pool.query(
      `SELECT tc.tour_id, tc.id AS point_id, tc.cav_id, tc.position, tc.status,
              tc.fill_level, tc.collected_at,
              tc.planned_passage_time,
              c.name AS point_name, c.address, c.commune, c.latitude, c.longitude
       FROM tour_cav tc
       JOIN cav c ON c.id = tc.cav_id
       WHERE tc.tour_id = ANY($1::int[])
       ORDER BY tc.tour_id, tc.position`,
      [tourIds]
    );
    const assoPointsRes = await pool.query(
      `SELECT tap.tour_id, tap.id AS point_id, tap.association_point_id AS cav_id,
              tap.position, tap.status, tap.fill_level, tap.collected_at,
              tap.planned_passage_time,
              ap.name AS point_name, ap.address, ap.ville AS commune,
              ap.latitude, ap.longitude
       FROM tour_association_point tap
       JOIN association_points ap ON ap.id = tap.association_point_id
       WHERE tap.tour_id = ANY($1::int[])
       ORDER BY tap.tour_id, tap.position`,
      [tourIds]
    );
    const allPoints = [...cavPointsRes.rows, ...assoPointsRes.rows];

    // 3. Dernière position GPS connue par véhicule
    const lastPositionsRes = await pool.query(
      `SELECT DISTINCT ON (vehicle_id) vehicle_id, latitude, longitude, speed, recorded_at
       FROM gps_positions
       WHERE vehicle_id = ANY($1::int[])
         AND recorded_at >= NOW() - INTERVAL '4 hours'
       ORDER BY vehicle_id, recorded_at DESC`,
      [tours.filter((t) => t.vehicle_id).map((t) => t.vehicle_id)]
    );
    const lastPosByVehicle = {};
    lastPositionsRes.rows.forEach((r) => {
      lastPosByVehicle[r.vehicle_id] = r;
    });

    // 4. Pesées du jour par tournée
    const weightsRes = await pool.query(
      `SELECT tour_id, COALESCE(SUM(weight_kg), 0) AS total_weight_kg
       FROM tour_weights
       WHERE tour_id = ANY($1::int[])
       GROUP BY tour_id`,
      [tourIds]
    );
    const weightsByTour = {};
    weightsRes.rows.forEach((r) => { weightsByTour[r.tour_id] = parseFloat(r.total_weight_kg) || 0; });

    // 5. Incidents du jour par tournée
    const incidentsRes = await pool.query(
      `SELECT tour_id, COUNT(*)::int AS nb_incidents
       FROM incidents
       WHERE tour_id = ANY($1::int[])
       GROUP BY tour_id`,
      [tourIds]
    );
    const incidentsByTour = {};
    incidentsRes.rows.forEach((r) => { incidentsByTour[r.tour_id] = r.nb_incidents; });

    // 6. Construire la réponse par tournée
    const enrichedTours = tours.map((t) => {
      const points = allPoints.filter((p) => p.tour_id === t.id);
      const collectedCount = points.filter((p) => p.status === 'collected').length;
      const remainingCount = points.filter((p) => p.status === 'pending' || p.status === 'in_progress').length;
      const lastPos = lastPosByVehicle[t.vehicle_id] || null;
      const weight = weightsByTour[t.id] || 0;
      const incidentsCount = incidentsByTour[t.id] || 0;

      // ETA simple : si tournée commencée et durée estimée connue
      let eta = null;
      if (t.started_at && t.estimated_duration_min) {
        eta = new Date(new Date(t.started_at).getTime() + t.estimated_duration_min * 60 * 1000).toISOString();
      }

      // Distance restante : ratio CAV restants × distance totale (estimation linéaire)
      const totalCount = points.length || 1;
      const distanceRemaining = t.distance_km
        ? Math.round(parseFloat(t.distance_km) * (remainingCount / totalCount) * 10) / 10
        : null;

      // Alerte dépassement : si on a passé 80% de la durée mais < 80% de progression
      const now = Date.now();
      const elapsedMin = t.started_at ? (now - new Date(t.started_at).getTime()) / 60000 : 0;
      const progressPct = totalCount > 0 ? (collectedCount / totalCount) * 100 : 0;
      const elapsedPct = t.estimated_duration_min ? (elapsedMin / t.estimated_duration_min) * 100 : 0;
      const alertOverrun = elapsedPct > 80 && progressPct < elapsedPct - 15;

      return {
        id: t.id,
        date: t.date,
        status: t.status,
        collection_type: t.collection_type || 'cav',
        vehicle_id: t.vehicle_id,
        vehicle_registration: t.registration,
        vehicle_name: t.vehicle_name,
        max_capacity_kg: t.max_capacity_kg,
        driver_name: t.driver_name,
        started_at: t.started_at,
        estimated_duration_min: t.estimated_duration_min,
        distance_km: t.distance_km ? parseFloat(t.distance_km) : null,
        distance_remaining_km: distanceRemaining,
        elapsed_min: Math.round(elapsedMin),
        progress_pct: Math.round(progressPct),
        nb_points: totalCount,
        nb_collected: collectedCount,
        nb_remaining: remainingCount,
        weight_collected_kg: weight,
        nb_incidents: incidentsCount,
        eta,
        alert_overrun: alertOverrun,
        last_position: lastPos
          ? { latitude: parseFloat(lastPos.latitude), longitude: parseFloat(lastPos.longitude), speed: lastPos.speed, recorded_at: lastPos.recorded_at }
          : null,
        points: points.map((p) => ({
          id: p.point_id,
          cav_id: p.cav_id,
          position: p.position,
          name: p.point_name,
          address: p.address,
          commune: p.commune,
          latitude: p.latitude ? parseFloat(p.latitude) : null,
          longitude: p.longitude ? parseFloat(p.longitude) : null,
          status: p.status,
          fill_level: p.fill_level,
          collected_at: p.collected_at,
          planned_passage_time: p.planned_passage_time,
        })),
      };
    });

    // 7. KPIs agrégés
    const totalRemaining = enrichedTours.reduce((s, t) => s + t.nb_remaining, 0);
    const totalCollected = enrichedTours.reduce((s, t) => s + t.nb_collected, 0);
    const totalPoints = enrichedTours.reduce((s, t) => s + t.nb_points, 0);
    const totalDistanceRemaining = enrichedTours.reduce((s, t) => s + (t.distance_remaining_km || 0), 0);
    const vehiculesActifs = new Set(enrichedTours.filter((t) => t.status === 'in_progress' || t.status === 'returning').map((t) => t.vehicle_id)).size;
    const avancementPct = totalPoints > 0 ? Math.round((totalCollected / totalPoints) * 100) : 0;

    res.json({
      date,
      kpis: {
        vehicules_actifs: vehiculesActifs,
        cav_a_vider: totalRemaining,
        avancement_pct: avancementPct,
        distance_restante_km: Math.round(totalDistanceRemaining * 10) / 10,
      },
      tours: enrichedTours,
    });
  } catch (err) {
    console.error('[TOURS] Erreur active-summary :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/tours/active-summary/itineraires?date=YYYY-MM-DD
// ══════════════════════════════════════════════════════════════════════════
// Tracé ROUTIER restant de chaque tournée active, pour la carte « Collecte en
// direct ». Remplace le trait à vol d'oiseau reliant les points : la
// polyligne suit les rues, et la distance renvoyée est la distance RÉELLE à
// parcourir (et non un prorata du kilométrage total estimé).
//
// Départ du tracé = dernière position GPS connue du véhicule si elle est
// fraîche, sinon le centre de tri. Arrivée = retour au centre de tri.
//
// HONNÊTETÉ : si le routeur est injoignable, la géométrie vaut `null` et
// `source` vaut 'indisponible'. Le front retombe alors sur le trait droit EN
// LE SIGNALANT — jamais une distance approchée présentée comme routière.

// Fraîcheur maxi d'une position GPS pour servir de point de départ (minutes).
const GPS_FRAICHEUR_MIN = 15;
// Plafond de waypoints par appel au routeur (protection du service public).
const MAX_WAYPOINTS = 80;
// Durée de vie du tracé mémorisé : il ne change qu'au fil des collectes.
const TRACE_TTL_MS = 3 * 60 * 1000;

const traceMemo = new Map();

function memoKey(tourId, depart, pointIds) {
  const d = depart ? `${depart.lat.toFixed(4)},${depart.lng.toFixed(4)}` : 'centre';
  return `${tourId}|${d}|${pointIds.join('-')}`;
}

/**
 * Tracé routier depuis `depart` (ou le centre de tri), passant par les points
 * restants dans l'ordre, et revenant au centre de tri.
 * Renvoie toujours un objet : `source = 'indisponible'` si le routeur n'a pas
 * répondu — la carte retombe alors sur le trait droit EN LE SIGNALANT.
 */
async function calculerTrace(points, depart, tronque = false) {
  const commun = {
    nb_points: points.length,
    depart: depart ? 'position_vehicule' : 'centre_tri',
    tronque,
  };
  const waypoints = [
    depart || { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG },
    ...points.map((p) => ({ lat: parseFloat(p.latitude), lng: parseFloat(p.longitude) })),
    { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG },
  ];
  const trace = await osrmRouteGeometry(waypoints);
  if (!trace) {
    return {
      ...commun, geometry: null, distance_restante_km: null,
      duree_restante_min: null, source: 'indisponible',
    };
  }
  return {
    ...commun,
    geometry: trace.geometry,
    distance_restante_km: Math.round(trace.distance_km * 10) / 10,
    duree_restante_min: Math.round(trace.duration_min),
    source: 'routier',
  };
}

router.get('/active-summary/itineraires', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const toursRes = await pool.query(
      `SELECT t.id, t.collection_type, t.vehicle_id
         FROM tours t
        WHERE t.date = $1
          AND t.status IN ('planned', 'in_progress', 'returning')
        ORDER BY t.id`,
      [date]
    );
    if (toursRes.rows.length === 0) return res.json({ date, itineraires: [] });

    const tourIds = toursRes.rows.map((t) => t.id);

    // Points restants (CAV et points association), dans l'ordre de passage
    const cavRes = await pool.query(
      `SELECT tc.tour_id, tc.id AS point_id, tc.position,
              c.latitude, c.longitude
         FROM tour_cav tc
         JOIN cav c ON c.id = tc.cav_id
        WHERE tc.tour_id = ANY($1::int[])
          AND tc.status IN ('pending', 'in_progress')
          AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        ORDER BY tc.tour_id, tc.position`,
      [tourIds]
    );
    const assoRes = await pool.query(
      `SELECT tap.tour_id, tap.id AS point_id, tap.position,
              ap.latitude, ap.longitude
         FROM tour_association_point tap
         JOIN association_points ap ON ap.id = tap.association_point_id
        WHERE tap.tour_id = ANY($1::int[])
          AND tap.status IN ('pending', 'in_progress')
          AND ap.latitude IS NOT NULL AND ap.longitude IS NOT NULL
        ORDER BY tap.tour_id, tap.position`,
      [tourIds]
    );
    const pointsParTournee = {};
    [...cavRes.rows, ...assoRes.rows].forEach((r) => {
      (pointsParTournee[r.tour_id] = pointsParTournee[r.tour_id] || []).push(r);
    });
    Object.values(pointsParTournee).forEach((arr) => arr.sort((a, b) => a.position - b.position));

    // Dernière position GPS fraîche par véhicule
    const vehicleIds = [...new Set(toursRes.rows.map((t) => t.vehicle_id).filter(Boolean))];
    const posParVehicule = {};
    if (vehicleIds.length > 0) {
      const posRes = await pool.query(
        `SELECT DISTINCT ON (vehicle_id) vehicle_id, latitude, longitude, recorded_at
           FROM gps_positions
          WHERE vehicle_id = ANY($1::int[])
            AND recorded_at > CURRENT_TIMESTAMP - ($2 || ' minutes')::interval
          ORDER BY vehicle_id, recorded_at DESC`,
        [vehicleIds, String(GPS_FRAICHEUR_MIN)]
      );
      posRes.rows.forEach((r) => {
        posParVehicule[r.vehicle_id] = { lat: parseFloat(r.latitude), lng: parseFloat(r.longitude) };
      });
    }

    const itineraires = [];
    for (const t of toursRes.rows) {
      const points = pointsParTournee[t.id] || [];
      if (points.length === 0) {
        itineraires.push({
          tour_id: t.id, geometry: null, distance_restante_km: null,
          duree_restante_min: null, source: 'aucun_point_restant',
          nb_points: 0, tronque: false,
        });
        continue;
      }

      const depart = posParVehicule[t.vehicle_id] || null;
      const retenus = points.slice(0, MAX_WAYPOINTS);
      const tronque = points.length > retenus.length;
      const pointIds = retenus.map((p) => p.point_id);

      const cle = memoKey(t.id, depart, pointIds);
      const memo = traceMemo.get(cle);
      if (memo && Date.now() - memo.at < TRACE_TTL_MS) {
        itineraires.push({ ...memo.valeur, tour_id: t.id });
        continue;
      }

      const valeur = await calculerTrace(retenus, depart, tronque);

      // Un échec de routeur n'est pas mémorisé : le tracé sera retenté.
      if (valeur.source === 'routier') {
        if (traceMemo.size > 200) traceMemo.clear();
        traceMemo.set(cle, { at: Date.now(), valeur });
      }
      itineraires.push({ ...valeur, tour_id: t.id });
    }

    res.json({ date, itineraires });
  } catch (err) {
    console.error('[TOURS] Erreur active-summary/itineraires :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ITINÉRAIRE DU CHAUFFEUR — le calcul, écrit une seule fois
// ══════════════════════════════════════════════════════════════════════════
// Extrait du corps de `GET /:id/itineraire-public` (extraction MÉCANIQUE : le
// handler ci-dessous se contente désormais d'appeler cette fonction et de
// traduire son résultat en réponse HTTP). Raison : l'assistant conversationnel
// du chauffeur a besoin du MÊME itinéraire, et un second calcul de trajet
// finirait par annoncer une distance restante différente de celle affichée sur
// la carte — deux vérités pour la même route.
//
// Renvoie `null` si la tournée n'existe pas ; sinon l'objet d'itinéraire
// (géométrie, distance et durée restantes, `source`), toujours honnête :
// `source: 'indisponible'` quand le routeur n'a pas répondu, jamais une
// distance approchée présentée comme routière.
//
// @param {number} tourId
// @param {{lat?:number, lng?:number}} [depuis] position transmise par l'appelant
//   (GPS du téléphone) ; à défaut, dernière position fraîche du véhicule ; à
//   défaut, le centre de tri.
async function itineraireChauffeur(tourId, depuis = {}) {
  const tourRes = await pool.query(
    'SELECT id, vehicle_id FROM tours WHERE id = $1', [tourId]
  );
  if (tourRes.rows.length === 0) return null;

  const cavRes = await pool.query(
    `SELECT tc.id AS point_id, tc.position, c.latitude, c.longitude
       FROM tour_cav tc
       JOIN cav c ON c.id = tc.cav_id
      WHERE tc.tour_id = $1
        AND tc.status IN ('pending', 'in_progress')
        AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      ORDER BY tc.position`,
    [tourId]
  );
  const assoRes = await pool.query(
    `SELECT tap.id AS point_id, tap.position, ap.latitude, ap.longitude
       FROM tour_association_point tap
       JOIN association_points ap ON ap.id = tap.association_point_id
      WHERE tap.tour_id = $1
        AND tap.status IN ('pending', 'in_progress')
        AND ap.latitude IS NOT NULL AND ap.longitude IS NOT NULL
      ORDER BY tap.position`,
    [tourId]
  );
  const points = [...cavRes.rows, ...assoRes.rows].sort((a, b) => a.position - b.position);
  if (points.length === 0) {
    return {
      tour_id: tourId, geometry: null, distance_restante_km: null,
      duree_restante_min: null, source: 'aucun_point_restant', nb_points: 0, tronque: false,
    };
  }

  // Position du chauffeur : transmise par le mobile (GPS du téléphone), à
  // défaut dernière position GPS fraîche du véhicule, à défaut le centre.
  let depart = null;
  const lat = parseFloat(depuis && depuis.lat);
  const lng = parseFloat(depuis && depuis.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    depart = { lat, lng };
  } else if (tourRes.rows[0].vehicle_id) {
    const posRes = await pool.query(
      `SELECT latitude, longitude FROM gps_positions
        WHERE vehicle_id = $1
          AND recorded_at > CURRENT_TIMESTAMP - ($2 || ' minutes')::interval
        ORDER BY recorded_at DESC LIMIT 1`,
      [tourRes.rows[0].vehicle_id, String(GPS_FRAICHEUR_MIN)]
    );
    if (posRes.rows.length > 0) {
      depart = { lat: parseFloat(posRes.rows[0].latitude), lng: parseFloat(posRes.rows[0].longitude) };
    }
  }

  const retenus = points.slice(0, MAX_WAYPOINTS);
  const cle = memoKey(tourId, depart, retenus.map((p) => p.point_id));
  const memo = traceMemo.get(cle);
  if (memo && Date.now() - memo.at < TRACE_TTL_MS) {
    return { ...memo.valeur, tour_id: tourId };
  }

  const valeur = await calculerTrace(retenus, depart, points.length > retenus.length);
  if (valeur.source === 'routier') {
    if (traceMemo.size > 200) traceMemo.clear();
    traceMemo.set(cle, { at: Date.now(), valeur });
  }
  return { ...valeur, tour_id: tourId };
}

// GET /api/tours/:id/itineraire-public
// Même tracé routier, côté chauffeur : la carte de l'application mobile suit
// les rues au lieu de relier les bornes en ligne droite, et affiche la
// distance/durée RÉELLES jusqu'au retour au centre.
// Auth : JWT chauffeur (suffixe « -public » → garde de périmètre véhicule
// appliquée en amont par tours/index.js, aucune tournée d'un autre véhicule).
router.get('/:id/itineraire-public', async (req, res) => {
  try {
    const tourId = parseInt(req.params.id, 10);
    if (!Number.isInteger(tourId)) return res.status(400).json({ error: 'Tournée invalide' });

    const itineraire = await itineraireChauffeur(tourId, { lat: req.query.lat, lng: req.query.lng });
    if (!itineraire) return res.status(404).json({ error: 'Tournée non trouvée' });
    return res.json(itineraire);
  } catch (err) {
    console.error('[TOURS] Erreur itineraire-public :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
// Vidage du tracé mémorisé — utilisé par les tests, et disponible en
// exploitation si un tracé devait être forcé à se recalculer.
module.exports.resetTraceMemo = () => traceMemo.clear();
// Itinéraire du chauffeur, calculé UNE fois : la route HTTP ci-dessus et
// l'assistant conversationnel du chauffeur consomment la même fonction.
module.exports.itineraireChauffeur = itineraireChauffeur;
// Fraîcheur maximale d'une position GPS pour servir de point de départ.
// Partagée avec l'assistant du chauffeur, qui borne son « secteur » sur la
// même règle : deux définitions de « position récente » se contrediraient.
module.exports.GPS_FRAICHEUR_MIN = GPS_FRAICHEUR_MIN;

// ══════════════════════════════════════════════════════════════════════════
// RÉ-OPTIMISATION D'UNE TOURNÉE EN COURS — CO2 & efficacité
// ══════════════════════════════════════════════════════════════════════════
//
// Recalcule l'ordre des points RESTANTS d'une tournée en cours, en tenant
// compte de la circulation du moment, et chiffre le gain en kilomètres, en
// minutes ET en CO2.
//
// S'APPLIQUE À TOUS LES MODES — moteur IA, modèle de tournée, saisie
// manuelle — et à tous les points restants, y compris ceux AJOUTÉS en cours
// de route par le gestionnaire (ce sont des lignes `tour_cav` en attente
// comme les autres : rien ne les distingue ici, c'est voulu).
//
// ARCHITECTURE EN TROIS TEMPS, dictée par le coût des appels externes :
//   1. RECHERCHE — locale, sans réseau. L'optimiseur (services/tour-optimizer)
//      évalue des milliers de séquences ; il lit une matrice préchargée depuis
//      le cache de tronçons, complétée par une approximation là où rien n'a
//      encore été mesuré. Aucun appel au routeur dans la boucle.
//   2. MESURE — la séquence retenue ET la séquence actuelle sont mesurées
//      pour de bon, dans les MÊMES conditions de circulation (TomTom trafic +
//      mode poids lourd si une clé est configurée, sinon OSRM). Deux appels,
//      pas davantage : c'est ce qui rend le dispositif tenable sur un forfait
//      gratuit à 4 véhicules × 20 jours.
//   3. DÉCISION — le gain est comparé au seuil ; en dessous, on ne dérange
//      personne.
//
// DOCTRINE : les chiffres publiés viennent toujours de l'étape 2. Si aucun
// routeur ne répond, la proposition porte `source: 'estimation'` et le dit —
// on ne présente jamais une approximation comme une mesure.

const pool = require('../../config/database');
const { haversineDistance, ROAD_FACTOR, resolveAvgSpeedKmh } = require('./geo');
const { CENTRE_TRI_LAT, CENTRE_TRI_LNG, getContextForDate } = require('./context');
const { getScoringConfig } = require('./predictions');
const { computeAndStorePlannedPassages } = require('./planned-passage');
const { sendPushToRoles } = require('../../services/push-notifications');
const { prefetchLegs, cachedRouteSegment } = require('../../services/route-cache');
const { tomtomRouteSequence } = require('../../services/routing-tomtom');
const { emissionsVehicule } = require('../../services/vehicle-emissions');
const optimizer = require('../../services/tour-optimizer');
const { DEPART, ARRIVEE } = optimizer;

/** Vitesse de repli si ni le cache ni la config ne renseignent mieux. */
const REOPT_AVG_SPEED_KMH = 28;
const reoptSpeed = () => resolveAvgSpeedKmh(REOPT_AVG_SPEED_KMH);

/** Nombre maximal de points restants réordonnés en une passe. */
const MAX_POINTS = 60;

function num(v, defaut) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : defaut;
}

/** Paramètres d'optimisation effectifs (config admin, défauts en code). */
function optionsOptimisation(cfg = getScoringConfig()) {
  return {
    objectif: optimizer.OBJECTIFS.includes(cfg.reoptimObjectif) ? cfg.reoptimObjectif : 'mixte',
    poids: {
      distance: num(cfg.reoptimPoidsDistance, 0.5),
      duree: num(cfg.reoptimPoidsDuree, 0.5),
    },
    gainMinPct: num(cfg.reoptimGainMinPct, 5),
    auto: cfg.reoptimAuto === true,
    autoGainMinPct: num(cfg.reoptimAutoGainMinPct, 12),
  };
}

/**
 * Fonction de tronçon utilisée par la RECHERCHE : cache d'abord, sinon
 * approximation Haversine × 1,3. Fonction pure une fois la matrice fournie —
 * aucune E/S, donc utilisable dans la boucle d'optimisation.
 *
 * @param {Map<string,{lat,lng}>} coords
 * @param {Map<string,{distance_km,duration_min}>} matrice tronçons mesurés
 * @param {number} facteurTrafic multiplicateur de durée du jour
 */
function fabriqueLegLocal(coords, matrice, facteurTrafic, cleDe) {
  const vitesse = reoptSpeed();
  return (a, b) => {
    const pa = coords.get(a);
    const pb = coords.get(b);
    if (!pa || !pb) return { km: 0, min: 0 };
    const mesure = matrice.get(cleDe(pa.lat, pa.lng, pb.lat, pb.lng));
    if (mesure) {
      return { km: mesure.distance_km, min: mesure.duration_min * facteurTrafic };
    }
    const km = haversineDistance(pa.lat, pa.lng, pb.lat, pb.lng) * ROAD_FACTOR;
    return { km, min: (km / vitesse) * 60 * facteurTrafic };
  };
}

/**
 * Mesure RÉELLE d'une séquence : TomTom avec trafic et gabarit poids lourd si
 * une clé est configurée, sinon OSRM (durées à circulation libre, corrigées du
 * facteur de circulation du jour).
 * @returns {Promise<{distance_km, duration_min, source, retard_trafic_min}|null>}
 */
async function mesurerSequence(waypoints, { vehicule, facteurTrafic }) {
  const tt = await tomtomRouteSequence(waypoints, { vehicule });
  if (tt && Number.isFinite(tt.distance_km) && Number.isFinite(tt.duration_min)) {
    return {
      distance_km: tt.distance_km,
      duration_min: tt.duration_min,
      retard_trafic_min: tt.retard_trafic_min,
      source: 'tomtom_trafic',
    };
  }
  // Repli OSRM : on additionne les tronçons (servis par le cache dès le 2e
  // passage), puis on applique le facteur de circulation du jour.
  let km = 0;
  let min = 0;
  let mesureReelle = true;
  for (let i = 1; i < waypoints.length; i++) {
    const seg = await cachedRouteSegment(
      waypoints[i - 1].lat, waypoints[i - 1].lng, waypoints[i].lat, waypoints[i].lng
    );
    if (seg.source === 'haversine') mesureReelle = false;
    km += seg.distance_km;
    min += seg.duration_min;
  }
  if (!mesureReelle) return null; // aucun routeur : l'appelant le signalera
  return {
    distance_km: km,
    duration_min: min * facteurTrafic,
    retard_trafic_min: facteurTrafic > 1 ? min * (facteurTrafic - 1) : 0,
    source: 'osrm_facteur_jour',
  };
}

/**
 * Reconstruit l'ordre complet : les passages épinglés (rendez-vous) reprennent
 * EXACTEMENT leur place, les points libres réoptimisés comblent le reste.
 * @param {Array} ordreLibre      ids des points libres, dans le nouvel ordre
 * @param {Map<number, any>} places  index figé → id du passage épinglé
 * @param {number} taille         nombre total de passages restants
 */
function reinsererEpingles(ordreLibre, places, taille) {
  const resultat = new Array(taille).fill(undefined);
  for (const [index, id] of places) resultat[index] = id;
  let k = 0;
  for (let i = 0; i < taille; i++) {
    if (resultat[i] === undefined) resultat[i] = ordreLibre[k++];
  }
  return resultat;
}

/**
 * Propose (et applique éventuellement) un nouvel ordre de passage.
 *
 * @param {object} p
 * @param {number} p.tourId
 * @param {string} [p.triggerReason] 'incident' | 'arret' | 'recurrent' | 'manual'
 * @param {string} [p.triggeredBy]   'auto' | 'manager' | 'driver'
 * @param {number} [p.currentLat]    position du camion (sinon dernière position GPS)
 * @param {number} [p.currentLng]
 * @param {object} [p.io]            Socket.IO, pour prévenir le chauffeur
 */
async function proposeReoptimization({
  tourId,
  triggerReason = 'manual',
  triggeredBy = 'auto',
  currentLat = null,
  currentLng = null,
  io = null,
}) {
  const tourRes = await pool.query(
    `SELECT t.id, t.collection_type, t.status, t.date, t.vehicle_id, t.is_demo,
            v.tare_weight_kg, v.max_capacity_kg
       FROM tours t
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.id = $1`,
    [tourId]
  );
  if (tourRes.rows.length === 0) return { error: 'Tournée non trouvée' };
  const tour = tourRes.rows[0];
  if (tour.status !== 'in_progress') {
    return { error: `Tournée non en cours (statut: ${tour.status})` };
  }
  // Une tournée de formation ne doit produire ni proposition, ni notification.
  if (tour.is_demo) return { skipped: true, reason: 'tournee_demo' };

  const isAssoc = tour.collection_type === 'association';
  const table = isAssoc ? 'tour_association_point' : 'tour_cav';
  const remainingRes = isAssoc
    ? await pool.query(
        `SELECT tap.id, tap.association_point_id AS cav_id, tap.position, tap.demande_id,
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

  const remaining = remainingRes.rows.slice(0, MAX_POINTS).map((r) => ({
    id: r.id,
    cav_id: r.cav_id,
    position: r.position,
    cav_name: r.cav_name,
    lat: parseFloat(r.latitude),
    lng: parseFloat(r.longitude),
    // Passage rattaché à une demande de collecte (rendez-vous) : ÉPINGLÉ.
    demande_id: r.demande_id != null ? Number(r.demande_id) : null,
  }));
  if (remaining.length < 2) {
    return { skipped: true, reason: 'moins_de_2_points_restants' };
  }

  const pending = await pool.query(
    `SELECT id FROM tour_reoptimizations WHERE tour_id = $1 AND status = 'pending' LIMIT 1`,
    [tourId]
  );
  if (pending.rows.length > 0) {
    return { skipped: true, reason: 'proposition_pending_existante', existing_id: pending.rows[0].id };
  }

  // Point de départ : position transmise, sinon dernière position GPS fraîche,
  // sinon le centre de tri (le camion n'est pas encore parti).
  let startLat = num(currentLat, null);
  let startLng = num(currentLng, null);
  if (startLat === null || startLng === null) {
    const pos = await pool.query(
      `SELECT latitude, longitude FROM gps_positions
        WHERE vehicle_id = $1 AND recorded_at > CURRENT_TIMESTAMP - INTERVAL '20 minutes'
        ORDER BY recorded_at DESC LIMIT 1`,
      [tour.vehicle_id]
    );
    if (pos.rows.length > 0) {
      startLat = parseFloat(pos.rows[0].latitude);
      startLng = parseFloat(pos.rows[0].longitude);
    }
  }
  if (startLat === null || startLng === null) {
    startLat = CENTRE_TRI_LAT;
    startLng = CENTRE_TRI_LNG;
  }

  // ── 1. RECHERCHE (locale, sans réseau) ──────────────────────────────────
  const coords = new Map();
  coords.set(DEPART, { lat: startLat, lng: startLng });
  coords.set(ARRIVEE, { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG });
  remaining.forEach((r) => coords.set(r.id, { lat: r.lat, lng: r.lng }));

  const paires = [];
  const cles = [...coords.keys()];
  cles.forEach((a) => cles.forEach((b) => {
    if (a === b) return;
    const pa = coords.get(a);
    const pb = coords.get(b);
    paires.push([pa.lat, pa.lng, pb.lat, pb.lng]);
  }));
  const { legKey } = require('../../services/route-cache');
  const matrice = await prefetchLegs(paires);

  const contexte = await getContextForDate(
    (tour.date instanceof Date ? tour.date : new Date(tour.date)).toISOString().slice(0, 10)
  ).catch(() => ({ trafficFactor: 1 }));
  const facteurTrafic = num(contexte?.trafficFactor, 1) || 1;

  const legLocal = fabriqueLegLocal(coords, matrice, facteurTrafic, legKey);
  const opts = optionsOptimisation();
  const ordreActuel = remaining.map((r) => r.id);

  // ── RG-B5 : les rendez-vous sont ÉPINGLÉS ───────────────────────────────
  // Un passage rattaché à une demande de collecte a une heure convenue avec
  // une personne : la ré-optimisation ne le déplace JAMAIS. Sa PLACE dans
  // l'ordre est figée (et non le point retiré de la liste : le retirer
  // laisserait sa position en collision avec celles des points renumérotés) ;
  // seuls les autres points sont permutés, entre eux, autour de lui.
  const placesEpinglees = new Map(); // index dans l'ordre → id de passage
  remaining.forEach((r, i) => { if (r.demande_id != null) placesEpinglees.set(i, r.id); });
  const libres = remaining.filter((r) => r.demande_id == null).map((r) => r.id);

  if (placesEpinglees.size > 0 && libres.length < 2) {
    return {
      skipped: true,
      reason: 'points_epingles_rendez_vous',
      epingles: placesEpinglees.size,
      objectif: opts.objectif,
    };
  }

  // Sans rendez-vous : comportement strictement inchangé (tout est permutable).
  const aOptimiser = placesEpinglees.size > 0 ? libres : ordreActuel;
  const recherche = optimizer.optimiserOrdre(aOptimiser, legLocal, opts);

  if (!recherche.ameliore) {
    return { skipped: true, reason: 'ordre_deja_optimal', objectif: opts.objectif };
  }

  // Ordre complet reconstruit : les épinglés retrouvent leur place exacte.
  // NB : la recherche a raisonné sur le SOUS-PARCOURS des points libres ; le
  // gain publié, lui, est TOUJOURS mesuré ci-dessous sur les séquences
  // complètes (avant / après), donc sur la réalité de la tournée.
  const ordrePropose = placesEpinglees.size > 0
    ? reinsererEpingles(recherche.ordre, placesEpinglees, remaining.length)
    : recherche.ordre;

  // ── 2. MESURE (deux appels, mêmes conditions de circulation) ────────────
  const enWaypoints = (ordre) => [
    { lat: startLat, lng: startLng },
    ...ordre.map((id) => coords.get(id)),
    { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG },
  ];
  const vehicule = { tare_weight_kg: tour.tare_weight_kg, max_capacity_kg: tour.max_capacity_kg };
  const [mesureAvant, mesureApres] = await Promise.all([
    mesurerSequence(enWaypoints(ordreActuel), { vehicule, facteurTrafic }),
    mesurerSequence(enWaypoints(ordrePropose), { vehicule, facteurTrafic }),
  ]);

  const mesure = mesureAvant && mesureApres;
  const avant = mesure
    ? { km: mesureAvant.distance_km, min: mesureAvant.duration_min }
    : recherche.coutInitial;
  const apres = mesure
    ? { km: mesureApres.distance_km, min: mesureApres.duration_min }
    : recherche.cout;
  const source = mesure ? mesureApres.source : 'estimation';

  // ── 3. DÉCISION ─────────────────────────────────────────────────────────
  const gainPctDistance = avant.km > 0 ? ((avant.km - apres.km) / avant.km) * 100 : 0;
  const gainPctDuree = avant.min > 0 ? ((avant.min - apres.min) / avant.min) * 100 : 0;
  const gainRetenu = opts.objectif === 'duree' ? gainPctDuree
    : opts.objectif === 'distance' ? gainPctDistance
      : Math.max(gainPctDistance, gainPctDuree);

  if (gainRetenu < opts.gainMinPct) {
    return {
      skipped: true,
      reason: 'gain_marginal',
      objectif: opts.objectif,
      source,
      gainPercent: Math.round(gainRetenu * 10) / 10,
    };
  }

  // CO2 : consommation MESURÉE du véhicule × facteur d'émission ADEME.
  const emissions = await emissionsVehicule(tour.vehicle_id);
  const co2Avant = optimizer.co2Kg(avant.km, emissions.litresPer100km, emissions.kgCo2eParLitre);
  const co2Apres = optimizer.co2Kg(apres.km, emissions.litresPer100km, emissions.kgCo2eParLitre);
  const co2Evite = co2Avant !== null && co2Apres !== null
    ? Math.round((co2Avant - co2Apres) * 1000) / 1000 : null;

  const insert = await pool.query(
    `INSERT INTO tour_reoptimizations
       (tour_id, trigger_reason, triggered_by, current_lat, current_lng,
        old_sequence, new_sequence, old_distance_km, new_distance_km,
        old_duration_min, new_duration_min, objectif, source_calcul,
        co2_evite_kg, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, 'pending')
     RETURNING id, triggered_at`,
    [
      tourId, triggerReason, triggeredBy, startLat, startLng,
      JSON.stringify(ordreActuel), JSON.stringify(ordrePropose),
      avant.km, apres.km, avant.min, apres.min,
      opts.objectif, source, co2Evite,
    ]
  );

  const parId = new Map(remaining.map((r) => [r.id, r]));
  const proposal = {
    id: insert.rows[0].id,
    tour_id: tourId,
    trigger_reason: triggerReason,
    triggered_by: triggeredBy,
    triggered_at: insert.rows[0].triggered_at,
    objectif: opts.objectif,
    source_calcul: source,
    facteur_trafic: facteurTrafic,
    retard_trafic_min: mesure && mesureApres.retard_trafic_min != null
      ? Math.round(mesureApres.retard_trafic_min) : null,
    old_sequence: ordreActuel,
    new_sequence: ordrePropose,
    old_distance_km: Math.round(avant.km * 10) / 10,
    new_distance_km: Math.round(apres.km * 10) / 10,
    old_duration_min: Math.round(avant.min),
    new_duration_min: Math.round(apres.min),
    gain_distance_km: Math.round((avant.km - apres.km) * 10) / 10,
    gain_duree_min: Math.round(avant.min - apres.min),
    gain_percent: Math.round(gainRetenu * 10) / 10,
    gain_percent_distance: Math.round(gainPctDistance * 10) / 10,
    gain_percent_duree: Math.round(gainPctDuree * 10) / 10,
    // null (et non 0) quand la consommation du véhicule n'est pas saisie :
    // « non calculable » n'est pas « aucune émission évitée ».
    co2_evite_kg: co2Evite,
    co2_motif: emissions.motif,
    points: ordrePropose.map((id, idx) => {
      const p = parId.get(id) || {};
      return {
        id, cav_id: p.cav_id, cav_name: p.cav_name,
        old_position: p.position, new_position: idx + 1,
      };
    }),
  };

  if (io) io.to(`tour-${tourId}`).emit('reoptimization-proposal', proposal);

  // Application automatique, si la Direction l'a activée et que le gain le
  // justifie. Par défaut désactivée : réordonner la route d'un chauffeur en
  // cours de tournée est une décision d'exploitation.
  if (opts.auto && gainRetenu >= opts.autoGainMinPct) {
    const applique = await applyReoptimization(proposal.id, null, { auto: true });
    if (applique.accepted) {
      proposal.applique_automatiquement = true;
      if (io) io.to(`tour-${tourId}`).emit('reoptimization-accepted', {
        reoptId: proposal.id, tour_id: tourId, auto: true,
      });
    }
  }

  // Réchauffement opportuniste du cache sur les tronçons RETENUS : la
  // prochaine recherche s'appuiera sur des mesures, plus sur l'approximation.
  const retenus = enWaypoints(ordrePropose);
  Promise.all(retenus.slice(1).map((w, i) =>
    cachedRouteSegment(retenus[i].lat, retenus[i].lng, w.lat, w.lng).catch(() => null)
  )).catch(() => {});

  if (!proposal.applique_automatiquement) {
    sendPushToRoles(['ADMIN', 'MANAGER'], {
      title: `Ré-optim. proposée — Tournée #${tourId}`,
      body: `Gain ${proposal.gain_percent}% (${proposal.old_distance_km} → ${proposal.new_distance_km} km`
        + `${co2Evite !== null ? `, ${co2Evite} kg CO2 évités` : ''}) — motif ${triggerReason}`,
      tag: `reopt-${tourId}`,
      data: { url: '/collections-live', tourId },
    }).catch(() => {});
  }

  return { created: true, proposal };
}

async function applyReoptimization(reoptId, userId = null, opts = {}) {
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
        SET status = 'accepted', decided_at = NOW(), decided_by_user_id = $1,
            decision_auto = $2
      WHERE id = $3`,
    [userId, opts.auto === true, reoptId]
  );

  await pool.query(
    `UPDATE ${targetTable} SET planned_passage_time = NULL
      WHERE tour_id = $1 AND status = 'pending'`,
    [reopt.tour_id]
  );
  await computeAndStorePlannedPassages(reopt.tour_id).catch(() => {});

  return { accepted: true, tour_id: reopt.tour_id, auto: opts.auto === true };
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
  // exportés pour les tests
  optionsOptimisation,
  fabriqueLegLocal,
  mesurerSequence,
  MAX_POINTS,
};

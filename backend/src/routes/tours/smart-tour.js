const pool = require('../../config/database');
const { CENTRE_TRI_LAT, CENTRE_TRI_LNG, getContextForDate, getLocalEventsForDate } = require('./context');
const { nearestNeighborTSP, twoOptImprove, osrmRouteSegment, osrmOptimizedTrip, haversineDistance } = require('./geo');
// Cache des tronçons routiers : le réseau entre deux bornes fixes ne change
// pas, seul le trafic varie (appliqué APRÈS, en multipliant la durée).
const { cachedRouteSegment } = require('../../services/route-cache');
const cavScoring = require('../../services/cav-scoring');
const { emissionsVehicule } = require('../../services/vehicle-emissions');
const { predictFillRate, getSchoolVacationStatus, getScoringConfig } = require('./predictions');
const fillFactors = require('../../utils/fill-factors');
const timeEngine = require('../../services/tour-time-engine');

// ──────────────────────────────────────────────────────────────
// Horaires d'accessibilité des associations — module PUR partagé
// ──────────────────────────────────────────────────────────────
// Le module `services/association-horaires` porte TOUTE la connaissance du
// calendrier hebdomadaire (validation, plages du jour, fenêtre effective d'un
// rendez-vous). Il est chargé de façon TOLÉRANTE : tant qu'il n'est pas
// déployé, la planification continue — mais SANS contrôle d'horaires, et
// l'estimation le DIT (avertissement explicite, cf. estimateFixedRoute).
// Un contrôle qui disparaît en silence serait pire que pas de contrôle du tout.
let associationHoraires = null;
try {
  associationHoraires = require('../../services/association-horaires');
} catch (_) {
  console.warn('[SMART-TOUR] services/association-horaires indisponible — '
    + 'le contrôle des horaires d\'accessibilité des associations est INACTIF.');
}

/** Le module d'horaires est-il exploitable (fonctions attendues présentes) ? */
function horairesDisponibles() {
  return !!(associationHoraires
    && typeof associationHoraires.plagesDuJour === 'function'
    && typeof associationHoraires.fenetreEffective === 'function');
}

// ══════════════════════════════════════════════════════════════
// ALGORITHME DE TOURNÉE INTELLIGENTE v3
// ──────────────────────────────────────────────────────────────
// v3 (août 2026) : les règles de TEMPS (journée de 6 h de travail, pause
// déjeuner au centre hors temps de travail, retours de vidage comptés en
// travail) sortent d'ici et vivent dans le moteur PUR
// `services/tour-time-engine.js`, partagé avec les modes standard / manuel /
// association (routes/tours/crud.js) et avec le calcul des ETA d'exécution
// (planned-passage.js). Une seule implémentation des règles → aucune
// divergence possible entre les modes de création.
//
// v3 ajoute aussi la GARDE DE SATURATION : les CAV dont le remplissage prédit
// atteint `saturationThresholdPct` sont servis EN PRIORITÉ (ils passent en tête
// de la liste candidate) ; ceux que la capacité ou le temps ne permettent pas
// d'inclure sont renvoyés dans `saturation_non_couverte` — le manque de
// couverture est explicite au lieu d'être silencieux.
// ══════════════════════════════════════════════════════════════

// Perf (item 3.D-4) : la prédiction de remplissage est calculée pour ~200 CAV.
// Elle était exécutée en ~200 `await` séquentiels (chemin HTTP synchrone : le
// manager attend). On borne la concurrence pour paralléliser sans saturer le pool
// PG (max 20). Le RÉSULTAT par CAV est inchangé (predictFillRate est déterministe
// et ne mute pas les données lues par ses voisins) ; seul l'ordonnancement change.
const PREDICT_CONCURRENCY = parseInt(process.env.TOUR_PREDICT_CONCURRENCY, 10) || 6;

// Remplissage retenu quand AUCUNE prédiction n'est disponible pour un CAV.
// Aligné sur le défaut de predictFillRate (« pas d'historique → 50 % »).
const DEFAULT_FILL_PCT = 50;

/** Nombre fini issu d'une valeur de config, sinon le défaut (NaN inclus). */
function numOr(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

// map à concurrence bornée qui PRÉSERVE l'ordre (results[i] ↔ items[i]).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Précharge en UNE requête les temps de collecte appris (moyenne des durées
// réelles) pour une liste de CAV — remplace l'appel getLearnedTimePerCav PAR CAV
// dans la boucle de routage (N+1 → 1). Sémantique identique à l'ancienne fonction :
// un temps n'est retenu que si ≥ 3 mesures valides (0 < durée < 3600 s), arrondi en
// minutes ; sinon le défaut est appliqué à la lecture (learnedTimeFor).
async function loadLearnedTimesPerCav(cavIds) {
  const map = new Map();
  const ids = [...new Set((cavIds || []).map((v) => parseInt(v, 10)).filter(Number.isFinite))];
  if (ids.length === 0) return map;
  try {
    const result = await pool.query(
      `SELECT cav_id, AVG(duration_seconds) AS avg_duration, COUNT(*) AS count
       FROM cav_collection_times
       WHERE cav_id = ANY($1) AND duration_seconds > 0 AND duration_seconds < 3600
       GROUP BY cav_id`,
      [ids]
    );
    for (const row of result.rows) {
      if (parseInt(row.count, 10) >= 3) {
        map.set(Number(row.cav_id), Math.round(parseFloat(row.avg_duration) / 60)); // s → min
      }
    }
  } catch (_) { /* table cav_collection_times absente (schéma ancien) → défauts partout */ }
  return map;
}

// Résout le temps de collecte d'un CAV depuis la map préchargée (fallback défaut).
// Retour identique à getLearnedTimePerCav(cavId, defaultTime).
function learnedTimeFor(map, cavId, defaultTime) {
  const v = map.get(Number(cavId));
  return v != null ? v : defaultTime;
}

// ──────────────────────────────────────────────────────────────
// CASCADE DES DURÉES D'ARRÊT (RG-C3) — source UNIQUE
// ──────────────────────────────────────────────────────────────
// duree_prevue_min (ajustement de CETTE tournée, table tour_association_point)
//   → duree_collecte_min (défaut de la FICHE association)
//     → réglage global `timePerCav` (10 min, partagé avec les CAV).
// Chaque niveau ne s'applique QUE si le précédent est vide : aucune valeur
// n'est inventée, et la provenance reste affichable (`resolveDureeArret`).
// Consommée par l'estimation (estimateFixedRoute), la création et le calcul
// des heures prévues (planned-passage.js) : les trois lisent la même règle,
// sans quoi deux écrans donneraient deux horaires différents pour un même point.

/** Durée d'arrêt exploitable (minutes) ou null : > 0 et ≤ 480 (8 h). */
function dureeArretValide(valeur) {
  const n = typeof valeur === 'string' ? parseFloat(valeur) : valeur;
  if (!Number.isFinite(n)) return null;
  if (n <= 0 || n > 480) return null;
  return n;
}

/**
 * Résout la durée d'arrêt d'un point ET sa provenance.
 * @param {object} point  peut porter `duree_prevue_min` et/ou `duree_collecte_min`
 * @param {number} defautGlobal  réglage `timePerCav`
 * @returns {{minutes:number, source:'tournee'|'fiche'|'global'}}
 */
function resolveDureeArret(point, defautGlobal) {
  const tournee = dureeArretValide(point && point.duree_prevue_min);
  if (tournee != null) return { minutes: tournee, source: 'tournee' };
  const fiche = dureeArretValide(point && point.duree_collecte_min);
  if (fiche != null) return { minutes: fiche, source: 'fiche' };
  return { minutes: defautGlobal, source: 'global' };
}

/** Raccourci : minutes seules (cf. resolveDureeArret pour la provenance). */
function resolveServiceMinutes(point, defautGlobal) {
  return resolveDureeArret(point, defautGlobal).minutes;
}

// ──────────────────────────────────────────────────────────────
// CONVERSION référentiel → moteur (le moteur ne connaît ni le calendrier
// ni la table des demandes — même partage des rôles que `routeLeg`)
// ──────────────────────────────────────────────────────────────

/**
 * Plages d'accessibilité du JOUR de la tournée, en minutes d'horloge.
 * @returns {Array<[number,number]>|null} null = horaires inconnus (jamais bloquant)
 */
function fenetresDuJour(point, dateStr) {
  if (!point || point.type !== 'association') return null;
  if (!horairesDisponibles()) return null;
  const brut = point.horaires_accessibilite;
  if (brut === undefined || brut === null) return null;
  try {
    return associationHoraires.plagesDuJour(brut, dateStr);
  } catch (_) {
    return null; // horaires illisibles → inconnus, jamais « fermé » par défaut
  }
}

/**
 * Fenêtre effective d'un rendez-vous porté par le point (`_demande`), en
 * minutes d'horloge, tolérance appliquée des deux côtés.
 * @returns {{debutMin:number, finMin:number}|null}
 */
function ancrageDuPoint(point, toleranceDefautMin) {
  const d = point && point._demande;
  if (!d || !d.heure_debut) return null;
  if (!horairesDisponibles()) return null;
  try {
    const f = associationHoraires.fenetreEffective(
      { heure_debut: d.heure_debut, heure_fin: d.heure_fin, tolerance_min: d.tolerance_min },
      toleranceDefautMin
    );
    if (!f || !Number.isFinite(f.debutMin) || !Number.isFinite(f.finMin)) return null;
    return { debutMin: f.debutMin, finMin: f.finMin };
  } catch (_) {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// SUGGESTION D'ORDRE SOUS RENDEZ-VOUS (RG-B4) — heuristique v1
// ──────────────────────────────────────────────────────────────
// Volontairement simple (l'optimisation fine sous fenêtres — 2-opt contraint —
// est explicitement hors périmètre) :
//   1. les points ANCRÉS sont placés d'abord, triés par fenêtre croissante ;
//   2. chaque point LIBRE est inséré à la position qui minimise le détour,
//      sous test de faisabilité par simulation ; on retient la première
//      position faisable en partant de la moins coûteuse.
// Aucun point n'est jamais abandonné : si aucune position ne tient le
// rendez-vous, le point est placé au moindre détour et la faisabilité de
// l'ordre complet est vérifiée à la fin. Un ordre qui ne tient toujours pas
// n'est PAS proposé (`null`) — proposer un ordre qui échoue serait mentir.
//
// Fonction PURE : la distance et le test de faisabilité sont INJECTÉS.
//
// @param {Array} points   points dans l'ordre soumis (peuvent porter `anchor`)
// @param {object} deps
// @param {(a,b)=>number} deps.distance  coût entre deux points (a/b = null → centre)
// @param {(ordre)=>Promise<boolean>} deps.faisable  vrai si l'ordre tient les RDV
// @returns {Promise<Array|null>} ordre suggéré (mêmes objets) ou null
async function suggererOrdre(points, { distance, faisable } = {}) {
  const liste = Array.isArray(points) ? points.slice() : [];
  if (liste.length < 2 || typeof distance !== 'function' || typeof faisable !== 'function') {
    return null;
  }
  const ancres = liste.filter((p) => p && p.anchor);
  if (ancres.length === 0) return null; // rien à ancrer : aucune suggestion à faire

  // 1. Squelette : les points ancrés, par fenêtre croissante (début puis fin).
  const ordre = ancres.slice().sort((a, b) => (
    a.anchor.debutMin - b.anchor.debutMin || a.anchor.finMin - b.anchor.finMin
  ));

  // 2. Insertion des points libres au moindre détour, sous test de faisabilité.
  const rangSoumis = new Map(liste.map((p, i) => [p, i]));
  const libres = liste.filter((p) => !(p && p.anchor));
  for (const point of libres) {
    // À DÉTOUR ÉGAL, on bouleverse le moins possible l'ordre soumis : la
    // position de référence est le nombre de points déjà placés qui
    // précédaient déjà ce point dans la sélection du gestionnaire.
    const reference = ordre.filter((q) => rangSoumis.get(q) < rangSoumis.get(point)).length;
    const candidats = [];
    for (let i = 0; i <= ordre.length; i++) {
      const avant = i === 0 ? null : ordre[i - 1];
      const apres = i === ordre.length ? null : ordre[i];
      const detour = distance(avant, point) + distance(point, apres) - distance(avant, apres);
      candidats.push({ i, detour, ecart: Math.abs(i - reference) });
    }
    candidats.sort((a, b) => a.detour - b.detour || a.ecart - b.ecart || a.i - b.i);
    let place = false;
    for (const c of candidats) {
      const essai = ordre.slice();
      essai.splice(c.i, 0, point);
      // eslint-disable-next-line no-await-in-loop
      if (await faisable(essai)) { ordre.splice(c.i, 0, point); place = true; break; }
    }
    // Aucune position ne tient les rendez-vous : on garde le moindre détour et
    // c'est la vérification finale qui tranchera (jamais de point abandonné).
    if (!place) ordre.splice(candidats[0].i, 0, point);
  }

  if (!(await faisable(ordre))) return null;
  // Un ordre identique à celui soumis n'est pas une « suggestion ».
  const memeOrdre = ordre.length === liste.length
    && ordre.every((p, i) => p === liste[i]);
  return memeOrdre ? null : ordre;
}

/**
 * Poids estimé (kg) collecté sur un CAV = remplissage prédit × capacité du CAV
 * (nb conteneurs × 150 kg, source unique utils/fill-factors).
 *
 * C'est le modèle d'ACCUMULATION dimensionnellement correct (item 48) : le
 * remplissage prédit est lui-même construit à partir du poids moyen réel des
 * collectes passées, rapporté au nombre de jours écoulés et à la capacité.
 * Il remplace la lecture directe de `prediction.factors.avgWeight`, qui
 * ignorait le délai depuis la dernière collecte (un CAV relevé après 14 jours
 * au lieu de 7 pèse deux fois plus).
 *
 * @param {number|null} fillPct  remplissage prédit en % (0-120), null si inconnu
 * @param {number} nbContainers  nombre de conteneurs du CAV
 * @returns {number} poids estimé en kg
 */
function estimatedWeightKgFor(fillPct, nbContainers) {
  const capacity = fillFactors.getCapacityKg(nbContainers);
  const pct = Number.isFinite(parseFloat(fillPct)) ? parseFloat(fillPct) : DEFAULT_FILL_PCT;
  return Math.max(0, (pct / 100) * capacity);
}

/**
 * Fabrique la fonction `routeLeg` attendue par le moteur de temps : distances
 * routières OSRM (repli Haversine géré par geo.js), durée pondérée par le
 * facteur de trafic du jour.
 */
function makeRouteLeg(trafficFactor = 1) {
  const factor = Number.isFinite(parseFloat(trafficFactor)) && parseFloat(trafficFactor) > 0
    ? parseFloat(trafficFactor) : 1;
  return async (from, to) => {
    // Distance/durée « à vide » servies par le cache dès le 2e passage sur le
    // tronçon ; le facteur de circulation du jour est appliqué ensuite, il
    // n'est donc JAMAIS figé par le cache.
    const seg = await cachedRouteSegment(from.lat, from.lng, to.lat, to.lng);
    return { km: seg.distance_km, minutes: seg.duration_min * factor };
  };
}

/**
 * Mémoïse une fonction `routeLeg` sur la paire de coordonnées (5 décimales
 * ≈ 1 m). La suggestion d'ordre rejoue plusieurs simulations sur les MÊMES
 * points : sans mémo, chaque simulation redemanderait tous ses tronçons au
 * routeur. Le moteur mémoïse déjà en interne, mais seulement par appel.
 */
function memoRouteLeg(routeLeg) {
  const cache = new Map();
  const cle = (p) => `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`;
  return async (from, to) => {
    const k = `${cle(from)}>${cle(to)}`;
    if (cache.has(k)) return cache.get(k);
    const leg = await routeLeg(from, to);
    cache.set(k, leg);
    return leg;
  };
}

/**
 * Distance à vol d'oiseau entre deux points, le CENTRE DE TRI tenant lieu de
 * point de départ et d'arrivée (`null`). Sert uniquement à CLASSER les
 * positions d'insertion candidates de la suggestion d'ordre : la faisabilité,
 * elle, est toujours vérifiée par une simulation complète du moteur.
 */
function distanceOuCentre(a, b) {
  const lat = (p) => (p && p.latitude != null ? parseFloat(p.latitude) : CENTRE_TRI_LAT);
  const lng = (p) => (p && p.longitude != null ? parseFloat(p.longitude) : CENTRE_TRI_LNG);
  const d = haversineDistance(lat(a), lng(a), lat(b), lng(b));
  return Number.isFinite(d) ? d : 0;
}

/**
 * Ordre géographique optimisé (OSRM Trip, repli TSP local + 2-opt).
 * @returns {Promise<{ordered: Array, method: string}>}
 */
async function optimizeOrder(points, opts = {}) {
  if (!points || points.length <= 1) return { ordered: points || [], method: 'osrm_trip' };

  // ── 1. AMORCE : un bon ordre de départ, sur le réseau routier ──────────
  // Le TSP d'OSRM cherche l'ordre à partir de rien ; l'amélioration locale qui
  // suit ne sait qu'améliorer un ordre existant. Les deux sont complémentaires.
  let ordered;
  let method;
  const osrmResult = await osrmOptimizedTrip(points, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
  if (osrmResult && osrmResult.orderedPoints) {
    ordered = osrmResult.orderedPoints;
    method = 'osrm_trip';
  } else {
    ordered = twoOptImprove(
      nearestNeighborTSP(points, CENTRE_TRI_LAT, CENTRE_TRI_LNG),
      CENTRE_TRI_LAT, CENTRE_TRI_LNG
    );
    method = 'haversine_tsp_2opt';
  }

  // ── 2. AMÉLIORATION sur l'objectif réel (CO2 & efficacité, trafic inclus) ─
  // L'amorce minimise la DISTANCE à circulation libre. Le client veut aussi
  // l'efficacité de la journée : on repasse sur l'ordre avec l'objectif
  // paramétré et les durées pondérées par la circulation attendue.
  // S'applique aux TROIS modes de création (IA, modèle, manuel) : ils passent
  // tous par ici.
  try {
    const affine = await affinerOrdreAvecTrafic(ordered, opts);
    if (affine && affine.ordered) return affine;
  } catch (err) {
    console.warn('[SMART-TOUR] Affinage trafic ignoré :', err.message);
  }
  return { ordered, method };
}

/**
 * Repasse un ordre de points sur l'objectif d'optimisation configuré, avec les
 * distances routières mises en cache et le facteur de circulation attendu.
 * Aucun appel réseau dans la boucle : la matrice est préchargée.
 *
 * @param {Array} ordered points déjà ordonnés (amorce)
 * @param {object} opts { trafficFactor }
 * @returns {Promise<{ordered, method, gain}|null>} null si rien à améliorer
 */
async function affinerOrdreAvecTrafic(ordered, opts = {}) {
  if (!Array.isArray(ordered) || ordered.length < 3) return null;

  const optimizer = require('../../services/tour-optimizer');
  const { prefetchLegs, legKey } = require('../../services/route-cache');
  const { ROAD_FACTOR, resolveAvgSpeedKmh } = require('./geo');
  const cfg = getScoringConfig();
  const objectif = optimizer.OBJECTIFS.includes(cfg.reoptimObjectif) ? cfg.reoptimObjectif : 'mixte';
  const poids = {
    distance: numOr(cfg.reoptimPoidsDistance, 0.5),
    duree: numOr(cfg.reoptimPoidsDuree, 0.5),
  };
  const facteur = numOr(opts.trafficFactor, 1) || 1;

  const coords = new Map();
  coords.set(optimizer.DEPART, { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG });
  coords.set(optimizer.ARRIVEE, { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG });
  ordered.forEach((p, i) => coords.set(i, {
    lat: parseFloat(p.latitude), lng: parseFloat(p.longitude),
  }));
  if ([...coords.values()].some((c) => !Number.isFinite(c.lat) || !Number.isFinite(c.lng))) {
    return null; // un point sans coordonnées : on ne réordonne pas à l'aveugle
  }

  const paires = [];
  const cles = [...coords.keys()];
  cles.forEach((a) => cles.forEach((b) => {
    if (a === b) return;
    const pa = coords.get(a);
    const pb = coords.get(b);
    paires.push([pa.lat, pa.lng, pb.lat, pb.lng]);
  }));
  const matrice = await prefetchLegs(paires);
  const vitesse = resolveAvgSpeedKmh();

  const leg = (a, b) => {
    const pa = coords.get(a);
    const pb = coords.get(b);
    if (!pa || !pb) return { km: 0, min: 0 };
    const mesure = matrice.get(legKey(pa.lat, pa.lng, pb.lat, pb.lng));
    if (mesure) return { km: mesure.distance_km, min: mesure.duration_min * facteur };
    const km = haversineDistance(pa.lat, pa.lng, pb.lat, pb.lng) * ROAD_FACTOR;
    return { km, min: (km / vitesse) * 60 * facteur };
  };

  const r = optimizer.optimiserOrdre(ordered.map((_, i) => i), leg, { objectif, poids });
  if (!r.ameliore) return null;
  return {
    ordered: r.ordre.map((i) => ordered[i]),
    method: `objectif_${objectif}`,
    gain: r.gain,
  };
}

/**
 * Options du moteur de temps déduites de la config prédictive + du véhicule.
 * Source UNIQUE des paramètres de journée : tout mode de création passe par ici.
 *
 * @param {object} vehicle véhicule (max_capacity_kg)
 * @param {object} [over]  surcharges ponctuelles (ex. startHour réel)
 */
function timeEngineOptions(vehicle, over = {}) {
  const cfg = getScoringConfig();
  const capacityKg = parseFloat(vehicle?.max_capacity_kg) || 0;
  return {
    center: { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG, name: 'Centre de tri' },
    maxWorkMinutes: numOr(cfg.maxDailyHours, 6) * 60,
    lunchBreakMinutes: numOr(cfg.lunchBreakMinutes, 30),
    lunchAfterMinutes: numOr(cfg.lunchAfterHours, 4) * 60,
    lunchStartHour: numOr(cfg.lunchStartHour, 12),
    startHour: numOr(cfg.workdayStartHour, 8),
    unloadMinutes: numOr(cfg.unloadMinutes, 15),
    capacityKg,
    returnThresholdKg: timeEngine.resolveReturnThresholdKg({
      returnEveryKg: cfg.returnEveryKg,
      vehicleFillReturnPct: cfg.vehicleFillReturnPct,
      capacityKg,
    }),
    // Arbitrage client n°3 : l'attente devant une association avant l'heure de
    // son rendez-vous est du temps de travail (l'équipage est en service).
    attenteCompteTravail: cfg.attenteCompteTravail !== false,
    ...over,
  };
}

/**
 * Remplissage prédit du jour pour une liste de CAV, en 2 temps :
 *  1. lecture en UNE requête des prédictions déjà calculées par le job
 *     quotidien (`ml_fill_predictions`) — chemin normal, très peu coûteux ;
 *  2. calcul heuristique `predictFillRate` pour les seuls CAV manquants
 *     (concurrence bornée), chaque échec dégradant à `null` sans casser
 *     l'estimation (« best effort », doctrine soft du dépôt).
 *
 * @returns {Promise<Map<number, {fill:number|null, source:string}>>}
 */
async function loadPredictedFills(cavIds, dateStr) {
  const map = new Map();
  const ids = [...new Set((cavIds || []).map((v) => parseInt(v, 10)).filter(Number.isFinite))];
  if (ids.length === 0) return map;

  try {
    const r = await pool.query(
      `SELECT cav_id, predicted_fill_rate FROM ml_fill_predictions
        WHERE cav_id = ANY($1) AND predicted_date = $2`,
      [ids, dateStr]
    );
    for (const row of r.rows) {
      const fill = parseFloat(row.predicted_fill_rate);
      if (Number.isFinite(fill)) map.set(Number(row.cav_id), { fill, source: 'prediction' });
    }
  } catch (err) {
    console.warn('[SMART-TOUR] Lecture ml_fill_predictions ignorée :', err.message);
  }

  const missing = ids.filter((id) => !map.has(id));
  if (missing.length > 0) {
    const preds = await mapWithConcurrency(missing, PREDICT_CONCURRENCY, async (id) => {
      try { return await predictFillRate(id, dateStr); } catch (_) { return null; }
    });
    missing.forEach((id, i) => {
      const fill = preds[i] && Number.isFinite(parseFloat(preds[i].fill)) ? parseFloat(preds[i].fill) : null;
      map.set(id, { fill, source: fill != null ? 'heuristique' : 'inconnue' });
    });
  }
  return map;
}

/**
 * Estimation d'une tournée dont la LISTE DE POINTS EST FIXE — modes standard,
 * manuel, association et simulation `POST /tours/estimate`. Applique EXACTEMENT
 * les mêmes règles de journée que le mode intelligent (moteur partagé).
 *
 * @param {object} p
 * @param {object} p.vehicle  véhicule (max_capacity_kg)
 * @param {Array}  p.points   points ORDONNÉS : {id, type:'cav'|'association',
 *                            name, latitude, longitude, nb_containers}
 * @param {string} p.date     date de la tournée (YYYY-MM-DD)
 * @param {boolean} [p.optimize] réordonner géographiquement avant estimation
 * @param {boolean} [p.suggererOrdre] proposer un ordre tenant les rendez-vous
 *                  quand l'ordre soumis en manque un (RG-B4)
 * @returns {Promise<{estimation:object, ordre_optimise:number[]|null,
 *                    ordre_suggere:number[]|null, points:Array}>}
 *          `points` = les points dans l'ordre finalement estimé, enrichis du
 *          remplissage prédit `_fill` (écrit dans tour_cav.predicted_fill_rate)
 *          et du poids retenu `_weightKg`.
 *
 * Points ASSOCIATION : la durée d'arrêt suit la cascade RG-C3
 * (`duree_prevue_min` → `duree_collecte_min` → `timePerCav`), les horaires
 * d'accessibilité (`horaires_accessibilite`) deviennent les `windows` du jour
 * et une demande de collecte rattachée (`_demande`) devient l'`anchor` du
 * moteur. Le moteur SIGNALE (violations), la route DÉCIDE (409 forçable).
 */
async function estimateFixedRoute({
  vehicle, points, date, optimize = false, suggererOrdre: avecSuggestion = false,
}) {
  const cfg = getScoringConfig();
  const dateStr = typeof date === 'string' && date
    ? date.slice(0, 10)
    : new Date(date || Date.now()).toISOString().split('T')[0];
  const warnings = [];

  const rows = (points || []).map((p) => ({
    ...p,
    id: p.id,
    type: p.type === 'association' ? 'association' : 'cav',
    latitude: p.latitude != null ? parseFloat(p.latitude) : null,
    longitude: p.longitude != null ? parseFloat(p.longitude) : null,
  }));

  const cavIds = rows.filter((p) => p.type === 'cav').map((p) => p.id);
  const [fills, learnedTimes] = await Promise.all([
    loadPredictedFills(cavIds, dateStr),
    loadLearnedTimesPerCav(cavIds),
  ]);

  const nbSansPrediction = cavIds.filter((id) => (fills.get(Number(id))?.fill ?? null) == null).length;
  if (nbSansPrediction > 0) {
    warnings.push(
      `${nbSansPrediction} CAV sans prédiction de remplissage — poids estimé au défaut de `
      + `${DEFAULT_FILL_PCT} % de la capacité.`
    );
  }
  const nbAssociation = rows.filter((p) => p.type === 'association').length;
  if (nbAssociation > 0) {
    warnings.push(
      `${nbAssociation} point(s) association : poids non estimé (aucun historique de remplissage `
      + 'exploitable) — les retours de vidage ne sont pas anticipés pour ces points.'
    );
  }

  const defaultService = numOr(cfg.timePerCav, 10);
  const toleranceRdv = numOr(cfg.rdvToleranceMin, 15);
  const enriched = rows.map((p) => {
    // Durée d'arrêt : temps APPRIS pour les CAV (inchangé), cascade RG-C3 pour
    // les associations (ajustement de la tournée > fiche > réglage global).
    const duree = p.type === 'cav'
      ? { minutes: learnedTimeFor(learnedTimes, p.id, defaultService), source: 'appris' }
      : resolveDureeArret(p, defaultService);
    return {
      ...p,
      _weightKg: p.type === 'cav'
        ? estimatedWeightKgFor(fills.get(Number(p.id))?.fill ?? null, p.nb_containers)
        : 0,
      _serviceMinutes: duree.minutes,
      _dureeSource: duree.source,
      _fill: p.type === 'cav' ? (fills.get(Number(p.id))?.fill ?? null) : null,
      _windows: fenetresDuJour(p, dateStr),
      _anchor: ancrageDuPoint(p, toleranceRdv),
    };
  });

  // Un contrôle d'horaires qui n'a pas pu être fait doit se VOIR : sans le
  // module d'horaires, une association fermée passerait pour ouverte.
  const nbHorairesRenseignes = rows.filter(
    (p) => p.type === 'association' && p.horaires_accessibilite != null
  ).length;
  const nbDemandes = rows.filter((p) => p.type === 'association' && p._demande).length;
  if (!horairesDisponibles() && (nbHorairesRenseignes > 0 || nbDemandes > 0)) {
    warnings.push(
      'Contrôle des horaires d’accessibilité et des rendez-vous INDISPONIBLE '
      + '(module association-horaires absent) — les heures prévues ne sont pas vérifiées.'
    );
  }

  // Circulation attendue ce jour-là : lue AVANT l'optimisation d'ordre, car
  // elle en fait partie (un ordre optimal à circulation libre ne l'est plus
  // quand un axe est saturé). Elle sert ensuite à la chronologie.
  let trafficFactor = 1;
  try {
    const context = await getContextForDate(dateStr);
    trafficFactor = parseFloat(context?.trafficFactor) || 1;
  } catch (_) { /* contexte indisponible → facteur neutre */ }

  let ordered = enriched;
  let ordreOptimise = null;
  if (optimize && enriched.length > 1) {
    const { ordered: opt } = await optimizeOrder(enriched, { trafficFactor });
    ordered = opt;
    ordreOptimise = opt.map((p) => p.id);
  }

  // Un seul résolveur de tronçons pour l'estimation ET les simulations de la
  // suggestion d'ordre : chaque tronçon n'est demandé au routeur qu'une fois.
  const routeLeg = memoRouteLeg(makeRouteLeg(trafficFactor));
  const pourMoteur = (liste) => liste.map((p) => ({
    id: p.id,
    type: p.type,
    name: p.name,
    lat: p.latitude,
    lng: p.longitude,
    serviceMinutes: p._serviceMinutes,
    weightKg: p._weightKg,
    windows: p._windows,
    anchor: p._anchor,
  }));
  const optionsMoteur = { ...timeEngineOptions(vehicle), routeLeg };

  const estimation = await timeEngine.buildTimeline(pourMoteur(ordered), optionsMoteur);

  // Rétro-compatibilité : un moteur qui ne connaît pas encore les fenêtres ne
  // renvoie pas `violations`. On expose alors un tableau vide (aucune violation
  // constatée) et on le DIT quand un contrôle était attendu.
  const moteurControle = Array.isArray(estimation.violations);
  if (!moteurControle) {
    estimation.violations = [];
    const attendait = ordered.some((p) => p._windows != null || p._anchor != null);
    if (attendait) {
      warnings.push(
        'Contrôle des horaires et des rendez-vous NON EFFECTUÉ : le moteur de temps '
        + 'installé ne gère pas les fenêtres horaires.'
      );
    }
  }
  if (!Number.isFinite(estimation.duree_attente_min)) estimation.duree_attente_min = 0;

  // Suggestion d'ordre : uniquement quand un rendez-vous n'est pas tenu (RG-B4).
  // Deux passes, dans cet ordre :
  //   1. un ordre SANS AUCUNE violation — c'est le seul qui serait accepté tel
  //      quel, donc le seul vraiment utile ;
  //   2. à défaut, un ordre qui tient au moins les rendez-vous — c'est l'objet
  //      de la règle. Le reste des violations reste affiché à côté : proposer
  //      un ordre en taisant ce qu'il ne résout pas serait malhonnête.
  let ordreSuggere = null;
  if (avecSuggestion && estimation.violations.some((v) => v && v.type === 'rdv_manque')) {
    const candidats = ordered.map((p) => ({ ...p, anchor: p._anchor }));
    const simuler = async (essai) => {
      const test = await timeEngine.buildTimeline(pourMoteur(essai), optionsMoteur);
      return Array.isArray(test.violations) ? test.violations : [];
    };
    const distance = (a, b) => distanceOuCentre(a, b);
    const sansAucuneViolation = await suggererOrdre(candidats, {
      distance,
      faisable: async (essai) => (await simuler(essai)).length === 0,
    });
    const propose = sansAucuneViolation || await suggererOrdre(candidats, {
      distance,
      faisable: async (essai) => !(await simuler(essai)).some((v) => v && v.type === 'rdv_manque'),
    });
    if (propose) ordreSuggere = propose.map((p) => p.id);
  }

  estimation.avertissements = [...estimation.avertissements, ...warnings];

  return {
    estimation,
    ordre_optimise: ordreOptimise,
    ordre_suggere: ordreSuggere,
    points: ordered,
  };
}

async function generateIntelligentTour(vehicleId, date) {
  const SCORING_CONFIG = getScoringConfig();

  // 1. Récupérer le véhicule
  const vResult = await pool.query('SELECT id, registration, name, max_capacity_kg, team_id, status, current_km FROM vehicles WHERE id = $1', [vehicleId]);
  if (vResult.rows.length === 0) throw new Error('Véhicule non trouvé');
  const vehicle = vResult.rows[0];

  // 1b. Vérifier que le véhicule n'est pas déjà affecté à une tournée association ce jour
  const assoTourCheck = await pool.query(
    `SELECT id FROM tours WHERE vehicle_id = $1 AND date = $2 AND collection_type = 'association' AND status != 'cancelled'`,
    [vehicleId, date]
  );
  if (assoTourCheck.rows.length > 0) {
    throw new Error('Ce véhicule est déjà affecté à une tournée association ce jour. On ne peut pas mélanger collecte PAV et association.');
  }

  // 2. Récupérer tous les CAV actifs (uniquement PAV, pas les associations)
  const cavResult = await pool.query("SELECT id, name, address, commune, latitude, longitude, nb_containers, status FROM cav WHERE status = 'active' ORDER BY name");
  const allCavs = cavResult.rows;
  if (allCavs.length === 0) throw new Error('Aucun CAV actif trouvé. Ajoutez des CAV avant de créer une tournée.');

  // 3. Prédire le remplissage pour chaque CAV.
  //    Perf (item 3.D-4) : (a) pré-chauffe du contexte du jour UNE fois — la même
  //    date sert à tous les CAV, donc getContextForDate n'appelle Open-Meteo qu'une
  //    fois et écrit la ligne collection_context ; les predictFillRate suivants la
  //    relisent (et voient tous la même météo → déterminisme). (b) prédictions à
  //    concurrence bornée au lieu de ~200 await séquentiels. L'ordre est préservé
  //    (predictions[i] ↔ allCavs[i]) → scores/tri/tournée strictement identiques.
  const dateStr = typeof date === 'string' ? date.slice(0, 10) : new Date(date).toISOString().split('T')[0];
  await getContextForDate(dateStr).catch(() => {});
  const predictions = await mapWithConcurrency(allCavs, PREDICT_CONCURRENCY, (cav) => predictFillRate(cav.id, date));
  const cavWithPredictions = allCavs.map((cav, i) => ({ ...cav, prediction: predictions[i] }));

  // Temps de collecte APPRIS par borne : chargés EN UNE requête avant le
  // scoring, car le critère « temps » en dépend. (Ils étaient jusqu'ici lus
  // après la sélection, uniquement pour le calcul d'itinéraire.)
  const learnedTimes = await loadLearnedTimesPerCav(allCavs.map((c) => c.id));

  // 4. Score de sélection — 4 facteurs hiérarchisés (arbitrage client 08/2026)
  //    remplissage > temps > distance > émissions. Le calcul lui-même est un
  //    module PUR (services/cav-scoring) : il ne dépend ni de la base ni du
  //    réseau, et il est testable pour lui-même.
  //    Les ÉMISSIONS n'entrent dans le score que si la consommation du
  //    véhicule est mesurée (pleins saisis) — jamais estimée. Absentes, elles
  //    le sont pour toutes les bornes de la tournée : le classement reste
  //    cohérent.
  const carburant = await emissionsVehicule(vehicle.id).catch(() => ({}));
  const poidsSelection = {
    remplissage: numOr(SCORING_CONFIG.poidsRemplissage, 1),
    temps: numOr(SCORING_CONFIG.poidsTemps, 0.6),
    distance: numOr(SCORING_CONFIG.poidsDistance, 0.3),
    emissions: numOr(SCORING_CONFIG.poidsEmissions, 0.1),
  };
  const echellesSelection = {
    detourKm: numOr(SCORING_CONFIG.echelleDetourKm, 15),
    serviceMin: numOr(SCORING_CONFIG.echelleServiceMin, 20),
  };
  const defautService = numOr(SCORING_CONFIG.timePerCav, 10);

  const scoredCavs = cavWithPredictions.map(cav => {
    // Distance à vol d'oiseau depuis le centre de tri : approximation assumée
    // du « coût d'aller la chercher » AVANT que l'ordre de passage n'existe.
    // L'itinéraire réel est calculé ensuite, sur les bornes retenues.
    const detourKm = (cav.latitude != null && cav.longitude != null)
      ? haversineDistance(CENTRE_TRI_LAT, CENTRE_TRI_LNG,
        parseFloat(cav.latitude), parseFloat(cav.longitude))
      : null;
    const serviceMinutes = learnedTimeFor(learnedTimes, cav.id, defautService);

    const evaluation = cavScoring.scoreSelection({
      fillPct: cav.prediction.fill,
      daysSince: cav.prediction.factors?.daysSinceCollection || 0,
      nbContainers: cav.nb_containers || 1,
      confidence: cav.prediction.confidence,
      serviceMinutes,
      detourKm,
    }, { poids: poidsSelection, echelles: echellesSelection, carburant });

    return {
      ...cav,
      // Score ramené sur 100 : les écrans et l'explication IA affichaient une
      // échelle de cet ordre, on ne casse pas leur lisibilité.
      score: Math.round(evaluation.score * 1000) / 10,
      score_detail: evaluation.detail,
      score_emissions_prises_en_compte: evaluation.emissionsPrisesEnCompte,
      _detourKm: detourKm,
      _learnedTimePerCav: serviceMinutes,
      // Poids estimé = remplissage prédit × capacité du CAV (modèle d'accumulation)
      estimatedWeightKg: estimatedWeightKgFor(cav.prediction.fill, cav.nb_containers),
    };
  });

  // 5. Trier par score décroissant
  scoredCavs.sort((a, b) => b.score - a.score);

  // 5b. ── GARDE DE SATURATION (exigence client) ─────────────────────────────
  // Aucun CAV ne doit dépasser son seuil de saturation sans qu'une rotation le
  // vide : les CAV dont le remplissage prédit atteint le seuil sont traités
  // comme OBLIGATOIRES et passent en tête de la liste candidate (le plus saturé
  // d'abord). Ceux qui ne peuvent pas être servis (capacité du véhicule ou
  // budget de temps) ressortent dans `saturation_non_couverte`.
  const saturationThresholdPct = numOr(SCORING_CONFIG.saturationThresholdPct, 90);
  const obligatoires = scoredCavs
    .filter((c) => (c.prediction?.fill ?? 0) >= saturationThresholdPct)
    .sort((a, b) => (b.prediction.fill - a.prediction.fill) || (b.score - a.score));
  const obligatoireIds = new Set(obligatoires.map((c) => c.id));
  const autres = scoredCavs.filter((c) => !obligatoireIds.has(c.id));

  // 6. Sélectionner les CAV avec contrainte capacité véhicule (obligatoires d'abord)
  const maxCapacity = vehicle.max_capacity_kg * 0.95;
  const maxDailyMinutes = numOr(SCORING_CONFIG.maxDailyHours, 6) * 60;
  const returnThresholdKg = timeEngine.resolveReturnThresholdKg({
    returnEveryKg: SCORING_CONFIG.returnEveryKg,
    vehicleFillReturnPct: SCORING_CONFIG.vehicleFillReturnPct,
    capacityKg: parseFloat(vehicle.max_capacity_kg) || 0,
  });
  const lunchBreakMinutes = numOr(SCORING_CONFIG.lunchBreakMinutes, 30);

  const nonCouverts = [];
  const pickWithinCapacity = (list, state) => {
    const kept = [];
    for (const cav of list) {
      if (state.weight + cav.estimatedWeightKg <= maxCapacity) {
        kept.push(cav);
        state.weight += cav.estimatedWeightKg;
      } else if (obligatoireIds.has(cav.id)) {
        nonCouverts.push(cav);
      }
    }
    return kept;
  };
  const capacityState = { weight: 0 };
  const keptObligatoires = pickWithinCapacity(obligatoires, capacityState);
  const keptAutres = pickWithinCapacity(autres, capacityState);
  const selectedCavs = [...keptObligatoires, ...keptAutres];

  if (selectedCavs.length === 0) throw new Error('Aucun CAV sélectionné — vérifiez la capacité du véhicule et les données de remplissage.');

  // Les temps appris sont déjà chargés (étape 4, avant le scoring) et posés
  // sur chaque borne : rien à recharger ici.

  // 7. Optimiser la route via OSRM (ou fallback TSP local). Les obligatoires et
  //    les autres sont optimisés SÉPARÉMENT puis concaténés : la sélection
  //    gloutonne sous budget (étape 8) sert ainsi les CAV saturés en premier.
  // Circulation attendue : partagée par les deux blocs d'optimisation et par
  // le moteur de temps ci-dessous (une seule lecture du contexte).
  const context = await getContextForDate(dateStr).catch(() => null);
  const facteurJour = parseFloat(context?.trafficFactor) || 1;
  const optObl = await optimizeOrder(keptObligatoires, { trafficFactor: facteurJour });
  const optAutres = await optimizeOrder(keptAutres, { trafficFactor: facteurJour });
  const routingMethod = (optObl.method === 'osrm_trip' && optAutres.method === 'osrm_trip')
    ? 'osrm_trip' : 'haversine_tsp_2opt';
  const candidateOrder = [...optObl.ordered, ...optAutres.ordered];

  // 8. Contraintes de journée (moteur partagé) : 6 h de travail max, pause
  //    déjeuner au centre hors temps de travail, retours de vidage comptés.
  // dateStr est déjà résolu à l'étape 3 (pré-chauffe du contexte).
  const engineOpts = {
    ...timeEngineOptions(vehicle),
    routeLeg: makeRouteLeg(facteurJour),
  };
  const toEnginePoint = (cav) => ({
    id: cav.id,
    type: 'cav',
    name: cav.name,
    lat: cav.latitude,
    lng: cav.longitude,
    serviceMinutes: cav._learnedTimePerCav,
    weightKg: cav.estimatedWeightKg,
  });

  // planWithBudget travaille sur la projection « point moteur » ; les CAV
  // d'origine se retrouvent ensuite par identifiant.
  const enginePoints = candidateOrder.map(toEnginePoint);
  const planned = await timeEngine.planWithBudget(enginePoints, engineOpts);
  const selectedIds = new Set(planned.selected.map((p) => p.id));
  let optimizedRoute = candidateOrder.filter((c) => selectedIds.has(c.id));
  let estimation = planned.estimation;

  if (optimizedRoute.length === 0) {
    throw new Error(
      'Aucun CAV ne tient dans le budget de temps de travail (points trop éloignés du centre ou budget trop court) — aucune tournée créée.'
    );
  }

  // Les CAV saturés écartés par le budget de temps rejoignent les non couverts.
  for (const rejected of planned.rejected) {
    const cav = candidateOrder.find((c) => c.id === rejected.id);
    if (cav && obligatoireIds.has(cav.id)) nonCouverts.push(cav);
  }

  // 8b. Ré-optimisation géographique de la SÉLECTION finale (les obligatoires
  //     ont fait valoir leur priorité, l'ordre peut redevenir purement
  //     géographique). On ne la retient que si elle tient dans le budget.
  if (optimizedRoute.length > 1 && keptObligatoires.length > 0) {
    const { ordered: reordered } = await optimizeOrder(optimizedRoute, { trafficFactor: facteurJour });
    const rebuilt = await timeEngine.buildTimeline(reordered.map(toEnginePoint), engineOpts);
    if (rebuilt.depassement_min === 0) {
      optimizedRoute = reordered;
      estimation = rebuilt;
    }
  }

  // Compté sur la tournée RÉELLEMENT retenue (après la coupe de budget) et non
  // sur la présélection : le chiffre affiché correspond à ce qui sera collecté.
  const urgentCount = optimizedRoute.filter((c) => (c.prediction?.fill ?? 0) >= 80).length;

  const totalDistance = estimation.distance_km;
  const estimatedDuration = estimation.duree_travail_min;
  const estimatedWeight = estimation.poids_estime_kg;
  const nbRetours = estimation.nb_retours_vidage;
  const lunchTaken = estimation.pause_dejeuner_incluse;

  const saturationNonCouverte = [...new Map(
    nonCouverts.map((c) => [c.id, {
      cav_id: c.id,
      name: c.name,
      commune: c.commune || null,
      predicted_fill_rate: c.prediction?.fill ?? null,
    }])
  ).values()].sort((a, b) => (b.predicted_fill_rate ?? 0) - (a.predicted_fill_rate ?? 0));

  if (saturationNonCouverte.length > 0) {
    estimation.avertissements.push(
      `${saturationNonCouverte.length} CAV au-delà du seuil de saturation (${saturationThresholdPct} %) `
      + 'ne peuvent pas être servis par cette tournée — planifiez une rotation complémentaire.'
    );
  }

  // 9. Récupérer événements locaux pour l'explication
  const localEvents = await getLocalEventsForDate(dateStr);

  // 10. Générer l'explication
  const vacationStatus = getSchoolVacationStatus(dateStr);
  const explanation = generateAIExplanation({
    route: optimizedRoute,
    distance: totalDistance,
    duration: estimatedDuration,
    weight: estimatedWeight,
    urgentCount,
    vehicle,
    context,
    localEvents,
    vacationStatus,
    routingMethod,
    lunchTaken,
    nbRetours,
    lunchBreakMinutes,
    estimation,
    saturationNonCouverte,
    saturationThresholdPct,
  });

  return {
    vehicle,
    cavList: optimizedRoute.map((cav, idx) => ({
      cav_id: cav.id,
      name: cav.name,
      address: cav.address,
      commune: cav.commune,
      latitude: cav.latitude,
      longitude: cav.longitude,
      position: idx + 1,
      predicted_fill: cav.prediction.fill,
      confidence: cav.prediction.confidence,
      score: cav.score,
      estimated_weight: Math.round(cav.estimatedWeightKg),
      nb_containers: cav.nb_containers,
      learned_time_min: cav._learnedTimePerCav,
    })),
    stats: {
      totalCavs: optimizedRoute.length,
      totalDistance: Math.round(totalDistance * 10) / 10,
      estimatedDuration,
      estimatedWeight: Math.round(estimatedWeight),
      maxCapacity: vehicle.max_capacity_kg,
      fillRate: vehicle.max_capacity_kg > 0
        ? Math.round((estimatedWeight / vehicle.max_capacity_kg) * 100) : 0,
      urgentCavs: urgentCount,
      nbRetourscentre: nbRetours,
      maxDailyHours: numOr(SCORING_CONFIG.maxDailyHours, 6),
      returnEveryKg: Number.isFinite(returnThresholdKg) ? returnThresholdKg : null,
      routingMethod,
      lunchBreakIncluded: lunchTaken,
      // Ajouts v3 (additifs — le frontend existant n'en dépend pas)
      totalDurationWithBreak: estimation.duree_totale_min,
      lunchBreakMinutes: estimation.pause_dejeuner_min,
      budgetTravailMin: estimation.budget_travail_min,
      saturationThresholdPct,
      maxDailyMinutes,
    },
    estimation,
    saturation_non_couverte: saturationNonCouverte,
    explanation,
  };
}

function generateAIExplanation(opts) {
  const {
    route, distance, duration, weight, urgentCount, vehicle, context, localEvents,
    vacationStatus, routingMethod, lunchTaken, nbRetours, lunchBreakMinutes,
    estimation = null, saturationNonCouverte = [], saturationThresholdPct = 90,
  } = opts || {};
  const SCORING_CONFIG = getScoringConfig();
  const maxDailyHours = numOr(SCORING_CONFIG.maxDailyHours, 6);
  const lines = [];
  lines.push(`Tournée intelligente générée pour ${vehicle.name || vehicle.registration}`);
  lines.push(`\n${route.length} points de collecte sélectionnés parmi les CAV actifs`);
  lines.push(`Distance totale estimée : ${Math.round(distance * 10) / 10} km (distances routières ${routingMethod === 'osrm_trip' ? 'OSRM' : 'Haversine'})`);

  const durH = Math.floor(duration / 60);
  const durM = String(duration % 60).padStart(2, '0');
  lines.push(`Temps de travail estimé : ${durH}h${durM} (maximum ${maxDailyHours}h/jour — pause déjeuner NON comprise)`);
  if (estimation) {
    lines.push(`Amplitude : ${estimation.heure_depart} → ${estimation.heure_fin_estimee} (pause incluse)`);
  }
  lines.push(`Poids estimé : ${Math.round(weight)} kg / ${vehicle.max_capacity_kg} kg (${vehicle.max_capacity_kg > 0 ? Math.round(weight / vehicle.max_capacity_kg * 100) : 0}%)`);
  const seuilVidage = timeEngine.resolveReturnThresholdKg({
    returnEveryKg: SCORING_CONFIG.returnEveryKg,
    vehicleFillReturnPct: SCORING_CONFIG.vehicleFillReturnPct,
    capacityKg: parseFloat(vehicle.max_capacity_kg) || 0,
  });
  lines.push(`Retours centre de tri pour vidage : ${nbRetours}`
    + `${Number.isFinite(seuilVidage) ? ` (seuil ${Math.round(seuilVidage / 100) / 10}t, déchargement compté dans le temps de travail)` : ''}`);

  if (lunchTaken) {
    lines.push(`\n🍽️ Pause déjeuner au centre de tri : ${lunchBreakMinutes} min, HORS temps de travail `
      + `(déclenchée après ${SCORING_CONFIG.lunchAfterHours || 4}h de travail ou à ${SCORING_CONFIG.lunchStartHour || 12}h). `
      + 'Les trajets aller/retour, eux, sont comptés.');
  }

  if (urgentCount > 0) {
    lines.push(`\n⚠️ ${urgentCount} CAV urgents (remplissage >= 80%)`);
  }

  if (saturationNonCouverte.length > 0) {
    lines.push(`\n🚨 ${saturationNonCouverte.length} CAV au-delà du seuil de saturation (${saturationThresholdPct}%) NON couverts par cette tournée :`);
    saturationNonCouverte.slice(0, 5).forEach((c) => {
      lines.push(`  • ${c.name}${c.commune ? ` (${c.commune})` : ''} — ${Math.round(c.predicted_fill_rate ?? 0)}%`);
    });
    if (saturationNonCouverte.length > 5) lines.push(`  • … et ${saturationNonCouverte.length - 5} autre(s)`);
  }

  // Routing method
  lines.push(`\n🗺️ Méthode de routage : ${routingMethod === 'osrm_trip' ? 'OSRM (distances routières réelles + optimisation TSP)' : 'Haversine + TSP nearest neighbor + 2-opt (fallback)'}`);

  // Météo
  if (context && context.weatherLabel) {
    let weatherLine = `\n🌤️ Météo : ${context.weatherLabel}`;
    if (context.tempMax != null) weatherLine += ` (${context.tempMax}°C)`;
    weatherLine += ` — facteur x${context.weatherFactor}`;
    lines.push(weatherLine);
  }

  // Vacances scolaires
  if (vacationStatus && vacationStatus.status) {
    const labels = { pre: 'Semaine pré-vacances', during: 'Pendant les vacances', post: 'Semaine post-vacances' };
    const bonusValues = { pre: SCORING_CONFIG.preVacationBonus, during: SCORING_CONFIG.schoolVacationFactor || SCORING_CONFIG.schoolVacationBonus, post: SCORING_CONFIG.postVacationBonus };
    lines.push(`\n🎒 ${labels[vacationStatus.status]} (${vacationStatus.name}) — facteur x${bonusValues[vacationStatus.status]}`);
  }

  // Événements locaux
  if (localEvents && localEvents.length > 0) {
    lines.push(`\n📍 ${localEvents.length} événement(s) local(aux) actif(s) :`);
    localEvents.forEach(evt => {
      lines.push(`  • ${evt.nom} (${evt.commune || 'N/A'}) — rayon ${evt.rayon_km} km, bonus x${evt.bonus_factor}`);
    });
  }

  lines.push(`\n🔬 Prédiction : historique 180j + saisonnalité + météo + vacances scolaires + événements locaux + tendance + feedback ML V2`);

  const topCavs = route.slice(0, 3);
  if (topCavs.length > 0) {
    lines.push(`\n🏆 Priorités :`);
    topCavs.forEach((cav, i) => {
      let detail = `  ${i + 1}. ${cav.name} — remplissage estimé ${cav.prediction.fill}% (confiance ${Math.round(cav.prediction.confidence * 100)}%)`;
      if (cav._learnedTimePerCav && cav._learnedTimePerCav !== (SCORING_CONFIG.timePerCav || 10)) {
        detail += ` ⏱️${cav._learnedTimePerCav}min`;
      }
      if (cav.prediction.contextUsed?.weekendSunny) detail += ' ☀️';
      if (cav.prediction.contextUsed?.eventBonus) detail += ` 📍x${cav.prediction.contextUsed.eventBonus}`;
      if (cav.prediction.contextUsed?.vacationStatus) detail += ` 🎒`;
      lines.push(detail);
    });
  }

  return lines.join('\n');
}

/**
 * Récapitulatif français court d'une estimation, stocké dans
 * `tours.ai_explanation` pour les modes standard / manuel / association.
 */
function estimationSummary(estimation, { mode, vehicle, forced = false, forcages = [] } = {}) {
  const lines = [];
  const labels = { standard: 'modèle de tournée', manual: 'saisie manuelle', association: 'points association' };
  lines.push(`Tournée créée (${labels[mode] || mode}) pour ${vehicle?.name || vehicle?.registration || 'véhicule'}`);
  const h = Math.floor(estimation.duree_travail_min / 60);
  const m = String(estimation.duree_travail_min % 60).padStart(2, '0');
  lines.push(`${estimation.nb_points} point(s) · ${estimation.distance_km} km · temps de travail ${h}h${m} `
    + `(budget ${Math.round(estimation.budget_travail_min / 60 * 10) / 10}h, pause déjeuner exclue)`);
  lines.push(`Amplitude ${estimation.heure_depart} → ${estimation.heure_fin_estimee}`
    + (estimation.pause_dejeuner_incluse ? ` · pause déjeuner ${estimation.pause_dejeuner_min} min au centre de tri` : ' · pas de pause déjeuner'));
  lines.push(`Poids estimé ${estimation.poids_estime_kg} kg · ${estimation.nb_retours_vidage} retour(s) de vidage`);
  if (forced) {
    lines.push(`⚠ créée malgré un dépassement de ${estimation.depassement_min} min (forcé)`);
  }
  // Autres forçages tracés (horaires d'association, rendez-vous non tenable) :
  // le gestionnaire peut savoir ce que le logiciel ignore, mais la tournée doit
  // porter la trace de ce qui a été outrepassé.
  for (const f of (forcages || [])) lines.push(`⚠ ${f}`);
  for (const a of estimation.avertissements) lines.push(`• ${a}`);
  return lines.join('\n');
}

module.exports = {
  // Cascade des durées d'arrêt (RG-C3) — partagée avec planned-passage.js
  resolveDureeArret,
  resolveServiceMinutes,
  dureeArretValide,
  // Conversion référentiel → moteur + suggestion d'ordre (RG-A / RG-B)
  fenetresDuJour,
  ancrageDuPoint,
  suggererOrdre,
  horairesDisponibles,
  generateIntelligentTour,
  generateAIExplanation,
  estimateFixedRoute,
  estimationSummary,
  estimatedWeightKgFor,
  loadPredictedFills,
  loadLearnedTimesPerCav,
  learnedTimeFor,
  timeEngineOptions,
  makeRouteLeg,
  optimizeOrder,
  affinerOrdreAvecTrafic,
  DEFAULT_FILL_PCT,
};

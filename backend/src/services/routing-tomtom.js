// ══════════════════════════════════════════════════════════════════════════
// ROUTAGE TOMTOM AVEC TRAFIC — mode POIDS LOURD
// ══════════════════════════════════════════════════════════════════════════
//
// POURQUOI EN PLUS D'OSRM
// OSRM calcule un itinéraire de VOITURE sur un réseau figé : il ignore le
// trafic, et il ignore qu'un camion de collecte ne passe pas partout (ponts,
// tonnage, gabarit). TomTom sait faire les deux. On l'utilise donc là où il
// apporte quelque chose qu'OSRM ne sait pas produire :
//   • `traffic=true`   → durées réelles du moment, retard de circulation isolé
//   • `travelMode=truck` + poids → itinéraire praticable par le véhicule réel
//
// ÉCONOMIE DU FORFAIT (20 000 appels Routing/mois en offre gratuite)
// On n'appelle JAMAIS TomTom tronçon par tronçon : un appel porte la SÉQUENCE
// ENTIÈRE (jusqu'à 150 points) et renvoie le détail par tronçon. L'ordre est
// cherché localement (services/tour-optimizer, sur les distances mises en
// cache), et TomTom ne sert qu'à VALIDER la séquence retenue avec les
// conditions de circulation du moment — 1 à 2 appels par ré-optimisation.
// Ordre de grandeur pour 4 véhicules × 20 jours, ré-optimisation après chaque
// arrêt : ~1 300 à 2 600 appels/mois, soit 7 à 13 % du forfait.
//
// DOCTRINE : sans clé, ou si TomTom ne répond pas, on renvoie `null`.
// L'appelant retombe alors sur OSRM + le facteur de circulation du jour, et
// le dit. Aucune donnée n'est fabriquée pour combler un silence.

const { getApiKey, noterAppelTomTom } = require('./traffic');

const BASE_URL = 'https://api.tomtom.com/routing/1/calculateRoute';
const TIMEOUT_MS = parseInt(process.env.TOMTOM_ROUTING_TIMEOUT_MS, 10) || 8000;
/** Limite de l'API ; au-delà, l'appelant doit découper. */
const MAX_WAYPOINTS = 150;

/**
 * Poids total roulant du véhicule (kg), pour un itinéraire réellement
 * praticable. `null` si on ne le connaît pas : on préfère laisser TomTom
 * appliquer son défaut plutôt que d'inventer un tonnage.
 * @param {{tare_weight_kg, max_capacity_kg}} vehicule
 */
function poidsRoulantKg(vehicule) {
  if (!vehicule) return null;
  const tare = parseFloat(vehicule.tare_weight_kg);
  const charge = parseFloat(vehicule.max_capacity_kg);
  if (!Number.isFinite(tare) || tare <= 0) return null;
  // Poids à vide + charge utile déclarée : l'hypothèse haute, celle qui
  // interdit les ponts que le camion PLEIN ne peut pas franchir.
  return Math.round(tare + (Number.isFinite(charge) && charge > 0 ? charge : 0));
}

/**
 * Construit l'URL d'un calcul d'itinéraire (fonction PURE, testée).
 * @param {Array<{lat, lng}>} waypoints
 * @param {object} opts { key, vehicule, departAt, trafic }
 */
function buildRouteUrl(waypoints, opts = {}) {
  const locations = waypoints.map((w) => `${w.lat},${w.lng}`).join(':');
  const params = new URLSearchParams({
    key: opts.key,
    routeType: opts.routeType || 'fastest',
    traffic: opts.trafic === false ? 'false' : 'true',
    // Demande les DEUX durées : avec et sans circulation. C'est ce qui permet
    // d'afficher « +12 min de trafic » plutôt qu'un total opaque.
    computeTravelTimeFor: 'all',
    travelMode: opts.travelMode || 'truck',
    vehicleCommercial: 'true',
  });
  const poids = poidsRoulantKg(opts.vehicule);
  if (poids) params.set('vehicleWeight', String(poids));
  if (opts.departAt) params.set('departAt', opts.departAt);
  return `${BASE_URL}/${locations}/json?${params}`;
}

/**
 * Normalise une réponse TomTom (fonction PURE, testée).
 * @returns {object|null} null si la charge utile est inexploitable
 */
function parseRouteResponse(data) {
  const route = data && Array.isArray(data.routes) ? data.routes[0] : null;
  const resume = route && route.summary;
  if (!resume || !Number.isFinite(Number(resume.lengthInMeters))) return null;

  const avecTrafic = Number(resume.travelTimeInSeconds);
  const sansTrafic = Number(resume.noTrafficTravelTimeInSeconds);
  const retard = Number(resume.trafficDelayInSeconds);

  const legs = Array.isArray(route.legs)
    ? route.legs.map((l) => ({
        km: Number(l.summary?.lengthInMeters || 0) / 1000,
        min: Number(l.summary?.travelTimeInSeconds || 0) / 60,
      }))
    : [];

  return {
    distance_km: Number(resume.lengthInMeters) / 1000,
    duration_min: Number.isFinite(avecTrafic) ? avecTrafic / 60 : null,
    duration_sans_trafic_min: Number.isFinite(sansTrafic) ? sansTrafic / 60 : null,
    retard_trafic_min: Number.isFinite(retard) ? retard / 60 : null,
    legs,
    source: 'tomtom',
  };
}

/**
 * Itinéraire d'une séquence complète, avec le trafic du moment.
 *
 * @param {Array<{lat, lng}>} waypoints départ → points → arrivée
 * @param {object} opts { vehicule, departAt, trafic, key, fetchImpl }
 * @returns {Promise<object|null>} null si clé absente, séquence trop courte,
 *          trop longue, ou service muet — jamais de valeur de remplacement.
 */
async function tomtomRouteSequence(waypoints, opts = {}) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return null;
  if (waypoints.length > MAX_WAYPOINTS) return null;

  const key = opts.key || await getApiKey();
  if (!key) return null;

  const doFetch = opts.fetchImpl || fetch;
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_MS);
  try {
    noterAppelTomTom();
    const rep = await doFetch(buildRouteUrl(waypoints, { ...opts, key }), { signal: controleur.signal });
    if (!rep.ok) {
      console.warn(`[ROUTAGE-TOMTOM] Réponse ${rep.status} : repli sur OSRM.`);
      return null;
    }
    return parseRouteResponse(await rep.json());
  } catch (err) {
    console.warn('[ROUTAGE-TOMTOM] Appel en échec, repli sur OSRM :', err.message);
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

/** TomTom est-il utilisable (clé configurée) ? */
async function tomtomDisponible() {
  return !!(await getApiKey());
}

module.exports = {
  tomtomRouteSequence, tomtomDisponible,
  buildRouteUrl, parseRouteResponse, poidsRoulantKg,
  MAX_WAYPOINTS,
};

/**
 * TourService — utilitaires partagés pour la logique de tournée.
 *
 * Issue de l'audit Architecte (V6.2). Centralise les fonctions
 * géographiques et d'accès aux CAVs d'une tournée pour éviter la
 * duplication entre `index.js` (handler GPS Socket.IO) et les
 * 15 fichiers de `routes/tours/`.
 *
 * Le module `routes/tours/geo.js` reste la source pour la logique
 * d'optimisation de tournée (OSRM, TSP). Ce service est destiné aux
 * USAGES TRANSVERSES (proximité GPS temps réel, scheduler, dashboards).
 */

/**
 * Calcul Haversine de la distance en km entre 2 points.
 * Implémentation simple, sans dépendance OSRM.
 *
 * @param {number} lat1 latitude point 1 (degrés décimaux)
 * @param {number} lon1 longitude point 1
 * @param {number} lat2 latitude point 2
 * @param {number} lon2 longitude point 2
 * @returns {number} distance en km (0 si entrées invalides)
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const a1 = Number(lat1);
  const b1 = Number(lon1);
  const a2 = Number(lat2);
  const b2 = Number(lon2);
  if (!isFinite(a1) || !isFinite(b1) || !isFinite(a2) || !isFinite(b2)) return 0;

  const R = 6371; // rayon terrestre en km
  const dLat = (a2 - a1) * Math.PI / 180;
  const dLon = (b2 - b1) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a1 * Math.PI / 180)
    * Math.cos(a2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Charge la liste des CAVs d'une tournée avec leurs coordonnées GPS.
 * Utilisé en hot path du Socket.IO GPS pour la détection de proximité.
 *
 * @param {object} pool Le pool pg
 * @param {number|string} tourId
 * @returns {Promise<Array<{cav_id, latitude, longitude}>>}
 */
async function loadTourCAVs(pool, tourId) {
  const result = await pool.query(
    `SELECT tc.cav_id, c.latitude AS cav_lat, c.longitude AS cav_lng
     FROM tour_cav tc
     JOIN cav c ON tc.cav_id = c.id
     WHERE tc.tour_id = $1 AND c.latitude IS NOT NULL`,
    [tourId]
  );
  return result.rows.map((r) => ({
    cav_id: r.cav_id,
    latitude: parseFloat(r.cav_lat),
    longitude: parseFloat(r.cav_lng),
  }));
}

/**
 * Filtre une liste de CAVs (avec lat/lng) pour ne garder que ceux dans
 * un rayon donné autour d'un point.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {Array<{cav_id, latitude, longitude}>} cavs
 * @param {number} [radiusKm=0.1] rayon en km (par défaut 100m, seuil
 *   habituel de détection d'arrêt sur CAV)
 * @returns {Array<{cav_id, distance}>}  Trié par distance croissante.
 */
function findCAVsInProximity(lat, lng, cavs, radiusKm = 0.1) {
  if (!Array.isArray(cavs) || cavs.length === 0) return [];
  const inRange = [];
  for (const c of cavs) {
    const d = haversineDistance(lat, lng, c.latitude, c.longitude);
    if (d <= radiusKm) inRange.push({ cav_id: c.cav_id, distance: d });
  }
  return inRange.sort((a, b) => a.distance - b.distance);
}

module.exports = {
  haversineDistance,
  loadTourCAVs,
  findCAVsInProximity,
};

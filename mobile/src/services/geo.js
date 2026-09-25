/**
 * Géolocalisation — helpers partagés (distance + lecture position).
 *
 * Sert la sécurité anti-fraude « présence physique au CAV » (scan QR /
 * confirmation manuelle) : sans ça, un chauffeur pourrait valider un point
 * depuis n'importe où.
 */

const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Distance en mètres entre deux points GPS (formule haversine), ou null si
 * une coordonnée manque. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null || Number.isNaN(v))) return null;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/** Position actuelle de l'appareil (one-shot), avec timeout raisonnable.
 * Rejette si la géolocalisation est indisponible, refusée, ou expire. */
export function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('geolocation_unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000, ...options }
    );
  });
}

/**
 * Lien de guidage Google Maps vers une destination, ou `null` si elle n'a pas
 * de coordonnées exploitables. (0, 0) est une valeur par défaut et non une
 * position : on ne lance jamais un guidage vers le golfe de Guinée.
 */
export function lienGuidage(destination) {
  if (!destination) return null;
  const { latitude, longitude } = destination;
  if (latitude == null || longitude == null || latitude === '' || longitude === '') return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

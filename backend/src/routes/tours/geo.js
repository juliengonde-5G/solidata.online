// ══════════════════════════════════════════════════════════════
// ALGORITHMES GÉOGRAPHIQUES + OSRM (Open Source Routing Machine)
// ══════════════════════════════════════════════════════════════

// URL du serveur OSRM — utilise le serveur de démo par défaut
// En production, pointer vers un serveur OSRM self-hosted pour la fiabilité
const OSRM_BASE_URL = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';

// ── Distance Haversine (fallback si OSRM indisponible) ──────
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── OSRM : Distance et durée réelles par la route ───────────
// Retourne { distance_km, duration_min } entre deux points
async function osrmRouteSegment(lat1, lon1, lat2, lon2) {
  try {
    const url = `${OSRM_BASE_URL}/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.code === 'Ok' && data.routes?.[0]) {
      return {
        distance_km: data.routes[0].distance / 1000,
        duration_min: data.routes[0].duration / 60,
      };
    }
  } catch (err) {
    console.warn('[GEO] OSRM segment error, fallback haversine:', err.message);
  }
  // Fallback : Haversine × 1.3 (coefficient route/vol d'oiseau) + estimation 30km/h
  const dist = haversineDistance(lat1, lon1, lat2, lon2) * 1.3;
  return { distance_km: dist, duration_min: dist / 30 * 60 };
}

// ── OSRM : Matrice de distances entre N points ──────────────
// Retourne { distances: number[][], durations: number[][] } en km et minutes
async function osrmDistanceMatrix(points) {
  try {
    const coords = points.map(p => `${p.longitude},${p.latitude}`).join(';');
    const url = `${OSRM_BASE_URL}/table/v1/driving/${coords}?annotations=distance,duration`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.code === 'Ok') {
      return {
        distances: data.distances.map(row => row.map(d => d / 1000)), // m → km
        durations: data.durations.map(row => row.map(d => d / 60)),   // s → min
      };
    }
  } catch (err) {
    console.warn('[GEO] OSRM matrix error, fallback haversine:', err.message);
  }
  return null; // fallback signalé
}

// ── OSRM Trip : Optimisation de tournée (TSP réel) ──────────
// Utilise l'API Trip pour trouver l'ordre optimal sur le réseau routier
// Retourne { waypoints, distance_km, duration_min } ou null si indisponible
async function osrmOptimizedTrip(points, centreLat, centreLng) {
  try {
    // Centre en premier (source=first, roundtrip=true)
    const allCoords = [`${centreLng},${centreLat}`, ...points.map(p => `${p.longitude},${p.latitude}`)];
    const url = `${OSRM_BASE_URL}/trip/v1/driving/${allCoords.join(';')}?source=first&roundtrip=true&overview=false`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.code === 'Ok' && data.waypoints && data.trips?.[0]) {
      // Réordonner les points selon l'optimisation OSRM
      // waypoints[0] = centre, waypoints[1..n] = CAVs dans l'ordre optimal
      const waypointOrder = data.waypoints
        .slice(1) // exclure le centre (index 0)
        .map(wp => ({ originalIndex: wp.waypoint_index - 1, tripIndex: wp.trips_index }))
        .sort((a, b) => {
          // Trier selon l'ordre dans le trip
          const legA = data.trips[0].legs.findIndex((_, i) => i === a.tripIndex);
          const legB = data.trips[0].legs.findIndex((_, i) => i === b.tripIndex);
          return legA - legB;
        });

      // Extraire l'ordre optimal des waypoints
      const orderedPoints = [];
      const wpIndices = data.waypoints.slice(1).sort((a, b) => {
        // Utiliser waypoint_index pour retrouver l'ordre dans le trip
        return a.waypoint_index - b.waypoint_index;
      });

      // Reconstruire l'ordre : les waypoints OSRM ont un waypoint_index qui indique la position dans le trip
      const sortedByTrip = data.waypoints
        .filter((_, i) => i > 0) // exclure le centre
        .map((wp, originalIdx) => ({ wp, originalIdx }))
        .sort((a, b) => a.wp.waypoint_index - b.wp.waypoint_index);

      for (const { originalIdx } of sortedByTrip) {
        if (originalIdx < points.length) {
          orderedPoints.push(points[originalIdx]);
        }
      }

      return {
        orderedPoints: orderedPoints.length === points.length ? orderedPoints : null,
        distance_km: data.trips[0].distance / 1000,
        duration_min: data.trips[0].duration / 60,
      };
    }
  } catch (err) {
    console.warn('[GEO] OSRM trip error, fallback TSP local:', err.message);
  }
  return null;
}

// ── TSP : Plus proche voisin (Nearest Neighbor) — fallback ──
function nearestNeighborTSP(points, startLat, startLng) {
  const remaining = [...points];
  const ordered = [];
  let currentLat = startLat;
  let currentLng = startLng;

  while (remaining.length > 0) {
    let minDist = Infinity;
    let nearestIdx = 0;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineDistance(currentLat, currentLng, remaining[i].latitude, remaining[i].longitude);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }
    const nearest = remaining.splice(nearestIdx, 1)[0];
    ordered.push(nearest);
    currentLat = nearest.latitude;
    currentLng = nearest.longitude;
  }
  return ordered;
}

// ── Amélioration 2-opt — fallback ───────────────────────────
function twoOptImprove(route, startLat, startLng) {
  let improved = true;
  let bestRoute = [...route];

  while (improved) {
    improved = false;
    for (let i = 0; i < bestRoute.length - 1; i++) {
      for (let j = i + 2; j < bestRoute.length; j++) {
        const newRoute = [...bestRoute];
        const segment = newRoute.splice(i + 1, j - i);
        segment.reverse();
        newRoute.splice(i + 1, 0, ...segment);

        const oldDist = calculateTotalDistance(bestRoute, startLat, startLng);
        const newDist = calculateTotalDistance(newRoute, startLat, startLng);

        if (newDist < oldDist) {
          bestRoute = newRoute;
          improved = true;
        }
      }
    }
  }
  return bestRoute;
}

function calculateTotalDistance(route, startLat, startLng) {
  let total = 0;
  let prevLat = startLat, prevLng = startLng;
  for (const p of route) {
    total += haversineDistance(prevLat, prevLng, p.latitude, p.longitude);
    prevLat = p.latitude;
    prevLng = p.longitude;
  }
  total += haversineDistance(prevLat, prevLng, startLat, startLng);
  return total;
}

module.exports = {
  haversineDistance,
  nearestNeighborTSP,
  twoOptImprove,
  calculateTotalDistance,
  osrmRouteSegment,
  osrmDistanceMatrix,
  osrmOptimizedTrip,
  OSRM_BASE_URL,
};

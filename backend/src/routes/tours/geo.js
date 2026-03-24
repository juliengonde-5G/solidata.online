// ══════════════════════════════════════════════════════════════
// ALGORITHMES GÉOGRAPHIQUES
// ══════════════════════════════════════════════════════════════

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// TSP : Plus proche voisin (Nearest Neighbor)
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

// Amélioration 2-opt
function twoOptImprove(route, startLat, startLng) {
  let improved = true;
  let bestRoute = [...route];

  while (improved) {
    improved = false;
    for (let i = 0; i < bestRoute.length - 1; i++) {
      for (let j = i + 2; j < bestRoute.length; j++) {
        const newRoute = [...bestRoute];
        // Inverser le segment entre i+1 et j
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
  // Retour au centre
  total += haversineDistance(prevLat, prevLng, startLat, startLng);
  return total;
}

module.exports = {
  haversineDistance,
  nearestNeighborTSP,
  twoOptImprove,
  calculateTotalDistance,
};

/**
 * Sélection du point de collecte soumis à photo obligatoire — « test aléatoire »
 * demandé pour amener chaque chauffeur à prendre au moins une photo par
 * tournée.
 *
 * Déterministe par tournée (même point tiré au sort à chaque chargement de
 * la page — fonctionne hors ligne, cohérent après un retour/correction), mais
 * imprévisible pour le chauffeur (dépend d'un hash de l'identifiant de
 * tournée, pas d'un ordre ou d'une règle qu'il pourrait deviner).
 */

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * @param {string|number} tourId
 * @param {Array<{cav_id?: number|string, id?: number|string}>} cavs - points
 *   de la tournée, dans un ordre stable (celui renvoyé par
 *   /api/tours/:id/public, trié par position côté backend).
 * @returns {number|string|null} l'identifiant (cav_id ou id) du point tiré au
 *   sort pour cette tournée, ou null si la liste est vide.
 */
export function pickAuditCavId(tourId, cavs) {
  if (!Array.isArray(cavs) || cavs.length === 0 || tourId == null) return null;
  const idx = hashString(String(tourId)) % cavs.length;
  const cav = cavs[idx];
  return cav ? (cav.cav_id ?? cav.id ?? null) : null;
}

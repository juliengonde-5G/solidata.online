/**
 * Photo du point de collecte — décision d'exigence côté chauffeur.
 *
 * Exigence métier (08/2026) :
 *  1. le chauffeur peut TOUJOURS ajouter une photo du point ;
 *  2. si le point n'a aucune photo → on la DEMANDE avant de repartir ;
 *  3. si la photo a dépassé le seuil de fraîcheur → on la redemande ;
 *  4. si une photo fraîche existe → on ne demande rien.
 *
 * La règle de fraîcheur est évaluée CÔTÉ SERVEUR (`photo_requise` dans le
 * payload de tournée) : le mobile ne rejoue aucun calcul de date, il ne fait
 * qu'appliquer la décision reçue. Le seuil en mois (`photo_fraicheur_mois`)
 * n'est utilisé que pour l'affichage du message.
 *
 * HORS LIGNE (doctrine offline de l'app, identique à la photo d'audit et à la
 * photo d'incident) : une photo n'est JAMAIS bloquante ni mise en file d'attente
 * — pas de blob dans la file de sync. Le chauffeur est averti, la photo sera
 * redemandée au prochain passage.
 */

/**
 * @param {object} opts
 * @param {object|null} opts.point   point de tournée (`photo_requise`, `cav_photo_path`)
 * @param {boolean} opts.auditRequired point tiré au sort pour la photo d'audit
 * @param {boolean} opts.online      navigator.onLine au moment de la décision
 * @param {number}  opts.fraicheurMois seuil paramétré, pour le libellé
 * @returns {{required: boolean, blocking: boolean, reason: string|null,
 *            title: string, hint: string}}
 */
export function computePhotoRequirement({
  point = null,
  auditRequired = false,
  online = true,
  fraicheurMois = 6,
} = {}) {
  const cavRequired = !!(point && point.photo_requise);
  const hasCavPhoto = !!(point && point.cav_photo_path);
  const required = cavRequired || !!auditRequired;

  let reason = null;
  if (cavRequired) reason = hasCavPhoto ? 'perimee' : 'absente';
  else if (auditRequired) reason = 'audit';

  let hint = '';
  if (reason === 'absente') hint = "Ce point n'a pas encore de photo.";
  else if (reason === 'perimee') hint = `Sa photo date de plus de ${fraicheurMois} mois.`;
  else if (reason === 'audit') hint = 'Contrôle aléatoire de la tournée.';

  return {
    required,
    // Hors ligne : on n'empêche jamais le chauffeur de continuer sa tournée.
    blocking: required && !!online,
    reason,
    title: required ? 'Prends une photo du point' : 'Ajouter une photo du point (facultatif)',
    hint,
  };
}

export default computePhotoRequirement;

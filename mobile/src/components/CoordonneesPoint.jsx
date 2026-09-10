/**
 * LES COORDONNÉES DÉCIMALES DU POINT, sous son adresse (10/09/2026).
 *
 * Pourquoi sur l'écran du chauffeur : une borne posée sur un parking n'a
 * souvent pas de numéro de rue, et quand la navigation intégrée ne démarre pas
 * (réseau, application tierce absente), le seul recours est de taper le couple
 * décimal dans un GPS. Il ne servira pas tous les jours ; le jour où il sert,
 * il n'y a rien d'autre.
 *
 * Un appui long copie la valeur (`select-all`) — pas de bouton dédié : la
 * barre d'action du bas est déjà chargée, et une cible de plus se toucherait
 * par erreur avec des gants.
 */
export default function CoordonneesPoint({ latitude, longitude, className = '' }) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const absent = (v) => v === null || v === undefined || v === '';
  // 0,0 est le point nul, pas une position : le taire vaut mieux que d'envoyer
  // un chauffeur au large du golfe de Guinée (même piège qu'en 2.42.0).
  if (absent(latitude) || absent(longitude)) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;

  return (
    <p className={`text-[11px] text-gray-400 font-mono select-all ${className}`}>
      {lat.toFixed(6)}, {lng.toFixed(6)}
    </p>
  );
}

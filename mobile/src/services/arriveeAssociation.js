/**
 * Arrivée déclarée chez une association — mémoire locale du geste.
 *
 * Une borne de rue se prouve par son QR code. Une association n'en a pas : le
 * seul témoin du passage, c'est l'équipage. Il déclare donc son arrivée, puis
 * son départ, et l'écart entre les deux donne enfin la DURÉE RÉELLE de l'arrêt
 * — celle que le module fait ajuster à la main depuis la 2.38.0 sans jamais
 * pouvoir la confronter au terrain.
 *
 * L'heure est gardée EN LOCAL parce que la déclaration doit fonctionner hors
 * ligne, et qu'une arrivée rejouée le lendemain doit porter son heure
 * d'origine, pas celle du rattrapage. Elle repart ensuite avec le départ, dans
 * le même envoi (`arrivee_at` de la collecte).
 *
 * Module PUR : aucune requête réseau, uniquement `localStorage`. Un stockage
 * indisponible (navigation privée, quota) ne fait jamais échouer une collecte —
 * on perd la durée d'arrêt, pas le travail du chauffeur.
 */

const PREFIXE = 'assoc_arrivee';

export const clefArrivee = (tourId, pointId) => `${PREFIXE}:${tourId}:${pointId}`;

/** Pose l'heure d'arrivée si elle n'existe pas déjà. La PREMIÈRE fait foi. */
export function poserArrivee(tourId, pointId, quand = new Date()) {
  const existante = lireArrivee(tourId, pointId);
  // Un double appui, un retour en arrière ou un rechargement d'écran ne
  // repoussent pas l'arrivée : sinon un arrêt long se raccourcirait tout seul.
  if (existante) return existante;
  const iso = quand instanceof Date ? quand.toISOString() : String(quand);
  try {
    localStorage.setItem(clefArrivee(tourId, pointId), iso);
  } catch { /* stockage indisponible — la durée d'arrêt sera simplement inconnue */ }
  return iso;
}

/** Heure d'arrivée mémorisée, ou `null`. Une valeur illisible vaut `null`. */
export function lireArrivee(tourId, pointId) {
  let brut = null;
  try {
    brut = localStorage.getItem(clefArrivee(tourId, pointId));
  } catch { return null; }
  if (!brut) return null;
  const d = new Date(brut);
  return Number.isNaN(d.getTime()) ? null : brut;
}

export function effacerArrivee(tourId, pointId) {
  try { localStorage.removeItem(clefArrivee(tourId, pointId)); } catch { /* sans effet */ }
}

/**
 * Minutes passées sur place. `null` — et jamais 0 — quand l'arrivée est
 * inconnue : « arrivé à l'instant » et « on ne sait pas » sont deux choses
 * différentes, et les confondre inventerait une durée d'arrêt de zéro minute.
 */
export function dureeSurPlaceMin(arriveeIso, maintenant = new Date()) {
  if (!arriveeIso) return null;
  const d = new Date(arriveeIso);
  if (Number.isNaN(d.getTime())) return null;
  const min = Math.floor((maintenant.getTime() - d.getTime()) / 60000);
  return min < 0 ? 0 : min;
}

/** « 1 h 05 » / « 12 min » — lecture directe, sans calcul mental. */
export function formatDuree(min) {
  if (min == null || !Number.isFinite(Number(min))) return null;
  const m = Math.round(Number(min));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** « 14:05 » depuis un ISO, ou `null`. */
export function formatHeure(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

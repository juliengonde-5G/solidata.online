/**
 * Fraîcheur de la photo d'un point d'apport volontaire (CAV).
 *
 * Exigence métier (08/2026) : chaque CAV doit porter une photo à jour.
 * Au passage du chauffeur :
 *   - aucune photo en base                → photo DEMANDÉE avant de continuer ;
 *   - photo plus vieille que le seuil     → photo caduque, DEMANDÉE de nouveau ;
 *   - photo fraîche                       → rien n'est demandé (prise volontaire
 *     toujours possible).
 *
 * Le seuil est PARAMÉTRABLE (aucune valeur métier en dur, cf. CLAUDE.md §8) :
 *   clé `settings` → `collecte.photo_fraicheur_mois` (défaut 6 mois).
 *
 * Doctrine « jamais de valeur inventée » : une photo SANS date de prise de vue
 * connue est traitée comme « à renouveler » (on ne suppose pas qu'elle est
 * récente). Seul le backfill de migration approxime la date des photos
 * historiques par `cav.updated_at` — approximation assumée et documentée dans
 * init-db.js, pour ne pas redemander d'emblée une photo de TOUS les CAV déjà
 * photographiés.
 */

const SETTINGS_KEY = 'collecte.photo_fraicheur_mois';
const DEFAULT_PHOTO_FRAICHEUR_MOIS = 6;
const CACHE_TTL_MS = 60 * 1000;

let cache = { value: null, at: 0 };

/** Normalise un seuil en mois : entier ≥ 1, sinon le défaut documenté. */
function normalizeMois(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return DEFAULT_PHOTO_FRAICHEUR_MOIS;
  const i = Math.floor(n);
  return i >= 1 ? i : DEFAULT_PHOTO_FRAICHEUR_MOIS;
}

/**
 * Lit `collecte.photo_fraicheur_mois` (cache mémoire 60 s).
 * Résilient : toute erreur (table absente, valeur illisible) retombe sur le
 * défaut — le parcours chauffeur ne doit jamais casser sur un réglage.
 * @param {{query: Function}} pool
 * @returns {Promise<number>} seuil en mois (entier ≥ 1)
 */
async function getPhotoFraicheurMois(pool) {
  const now = Date.now();
  if (cache.value != null && now - cache.at < CACHE_TTL_MS) return cache.value;
  let value = DEFAULT_PHOTO_FRAICHEUR_MOIS;
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [SETTINGS_KEY]);
    const raw = r && r.rows && r.rows[0] ? r.rows[0].value : null;
    if (raw != null && String(raw).trim() !== '') value = normalizeMois(raw);
  } catch (_) {
    value = DEFAULT_PHOTO_FRAICHEUR_MOIS;
  }
  cache = { value, at: now };
  return value;
}

/** Vide le cache (tests, et changement de réglage à chaud). */
function resetPhotoFraicheurCache() {
  cache = { value: null, at: 0 };
}

/**
 * Ajoute `months` mois calendaires à une date, en bornant le quantième au
 * dernier jour du mois cible (31 janvier + 1 mois → 28/29 février, jamais un
 * débordement sur mars comme le ferait setMonth()).
 */
function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const daysInTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInTarget));
  return d;
}

/**
 * La photo du CAV est-elle encore valable ?
 * FONCTION PURE (aucun accès base, aucune horloge implicite : `now` injectable).
 *
 * @param {string|null} photoPath    chemin de la photo (null/vide = pas de photo)
 * @param {Date|string|null} photoTakenAt date de prise de vue (null = inconnue)
 * @param {number} mois              seuil de fraîcheur en mois
 * @param {Date} [now]               horloge de référence
 * @returns {boolean} true seulement si une photo existe ET est datée ET non périmée
 */
function isPhotoFresh(photoPath, photoTakenAt, mois, now = new Date()) {
  if (!photoPath || String(photoPath).trim() === '') return false;
  if (photoTakenAt == null || photoTakenAt === '') return false;
  const taken = photoTakenAt instanceof Date ? photoTakenAt : new Date(photoTakenAt);
  if (Number.isNaN(taken.getTime())) return false;
  const expiry = addMonths(taken, normalizeMois(mois));
  return now.getTime() < expiry.getTime();
}

/**
 * Faut-il demander une photo au chauffeur pour ce point ?
 * Strict complément de isPhotoFresh — même signature.
 */
function photoRequise(photoPath, photoTakenAt, mois, now = new Date()) {
  return !isPhotoFresh(photoPath, photoTakenAt, mois, now);
}

module.exports = {
  SETTINGS_KEY,
  DEFAULT_PHOTO_FRAICHEUR_MOIS,
  getPhotoFraicheurMois,
  resetPhotoFraicheurCache,
  isPhotoFresh,
  photoRequise,
  addMonths,
};

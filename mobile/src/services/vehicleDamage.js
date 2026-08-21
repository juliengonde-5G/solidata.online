/**
 * Schéma dégâts véhicule — logique PURE de validation/normalisation des
 * points posés par le chauffeur sur `VehicleDamageMap` (checklist de début
 * de journée, section « État du véhicule »). Aucune dépendance : testable
 * sans DOM ni IndexedDB (même esprit que cavPhoto.js / auditPhoto.js).
 *
 * Un dégât : { id, vue, x, y, type, commentaire }
 *   - vue : 'avant' | 'arriere' | 'gauche' | 'droit'
 *   - x, y : coordonnées RELATIVES [0, 1] sur le schéma de la vue — restent
 *     justes quelle que soit la taille d'écran (constat amiable).
 *   - type : 'rayure' | 'choc' | 'bris' | 'autre'
 *   - commentaire : texte libre facultatif (null si vide)
 *
 * Contrat backend POST /tours/:id/checklist-public — champ `degats` :
 *   [{ vue, x, y, type, commentaire? }] (voir toApiPayload : `id` est un
 *   identifiant LOCAL de session, jamais envoyé au serveur).
 */

export const DAMAGE_VUES = ['avant', 'arriere', 'gauche', 'droit'];
export const DAMAGE_TYPES = ['rayure', 'choc', 'bris', 'autre'];

const VUE_LABELS = {
  avant: 'Avant',
  arriere: 'Arrière',
  gauche: 'Côté gauche',
  droit: 'Côté droit',
};

const TYPE_LABELS = {
  rayure: 'Rayure',
  choc: 'Choc',
  bris: 'Bris',
  autre: 'Autre',
};

export function vueLabel(vue) {
  return VUE_LABELS[vue] || vue;
}

export function typeLabel(type) {
  return TYPE_LABELS[type] || type;
}

/** Ramène un nombre dans [0, 1] — position relative sur le schéma. Toute
 * valeur non finie (undefined, NaN, string vide…) retombe sur 0 plutôt que
 * de propager une position invalide. */
export function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Identifiant local de session (pas persisté tel quel côté serveur). */
export function newDamageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Normalise un dégât saisi par le chauffeur :
 *  - `vue` retombe sur la 1re vue connue si absente/invalide (l'appelant est
 *    censé toujours la fournir — c'est un garde-fou, jamais une devinette) ;
 *  - `type` retombe sur 'autre' si absent/inconnu ;
 *  - `x`/`y` clampés dans [0, 1] ;
 *  - `commentaire` réduit à null si vide/blanc (jamais une chaîne vide).
 */
export function normalizeDamage(input = {}) {
  const vue = DAMAGE_VUES.includes(input.vue) ? input.vue : DAMAGE_VUES[0];
  const type = DAMAGE_TYPES.includes(input.type) ? input.type : 'autre';
  const commentaire = typeof input.commentaire === 'string' && input.commentaire.trim()
    ? input.commentaire.trim()
    : null;
  return {
    id: input.id || newDamageId(),
    vue,
    x: clamp01(input.x),
    y: clamp01(input.y),
    type,
    commentaire,
  };
}

/** Ajoute un dégât normalisé à la liste — nouvelle liste, jamais de mutation. */
export function addDamage(list, input) {
  const safe = Array.isArray(list) ? list : [];
  return [...safe, normalizeDamage(input)];
}

/** Retire un dégât par id — nouvelle liste, no-op si l'id est absent. */
export function removeDamage(list, id) {
  const safe = Array.isArray(list) ? list : [];
  return safe.filter((d) => d.id !== id);
}

/** Met à jour un dégât existant (ex. changement de type/commentaire) en
 * conservant son id et sa position d'origine. No-op si l'id est absent. */
export function updateDamage(list, id, patch) {
  const safe = Array.isArray(list) ? list : [];
  return safe.map((d) => (d.id === id ? normalizeDamage({ ...d, ...patch, id: d.id }) : d));
}

/** Compte les dégâts par vue — pour un badge sur chaque onglet. */
export function countByVue(list) {
  const safe = Array.isArray(list) ? list : [];
  return DAMAGE_VUES.reduce((acc, v) => {
    acc[v] = safe.filter((d) => d.vue === v).length;
    return acc;
  }, {});
}

/**
 * Sérialise la liste pour le payload API `degats` : dépouille l'identifiant
 * local (`id`, jamais transmis) et n'inclut `commentaire` que s'il est
 * renseigné (le contrat backend le déclare facultatif).
 */
export function toApiPayload(list) {
  const safe = Array.isArray(list) ? list : [];
  return safe.map((d) => {
    const norm = normalizeDamage(d);
    const out = { vue: norm.vue, x: norm.x, y: norm.y, type: norm.type };
    if (norm.commentaire) out.commentaire = norm.commentaire;
    return out;
  });
}

import api from '../../services/api';

/**
 * Réglages du module Insertion (REC-UX-18) — GET /insertion/parametres.
 * Les DÉFAUTS ci-dessous doublent ceux du backend (utils/insertion-settings.js)
 * pour que l'UI reste utilisable si l'appel échoue (offline, base ancienne).
 * Cache mémoire simple (les réglages changent rarement — pas de re-fetch par
 * ouverture de modale).
 */

export const PARAMETRES_DEFAUTS = {
  echeance_action_defaut_jours: 14,
  rythme_bilans_mois: 2,
  delai_diagnostic_jours: 30,
  alerte_pass_iae_mois: 7,
  ia_preparation_auto: false,
  // PR A (2026-09) — volet FSE+ et durée des entretiens (mêmes défauts que le
  // backend, utils/insertion-settings.js) : la fenêtre de clôture propose la
  // durée par type, les alertes de sortie FSE+ sonnent à J+15 puis J+25.
  post_sortie_mois: 6,
  alerte_sortie_fse_j1: 15,
  alerte_sortie_fse_j2: 25,
  duree_entretien_defaut: {
    diagnostic_accueil: 90, bilan_intermediaire: 45, periode_essai: 30,
    renouvellement: 30, bilan_sortie: 60, suivi_post_sortie: 15,
  },
};

let cache = null;
let inflight = null;

/** Lit les réglages (cache mémoire, défauts en repli). Ne rejette jamais. */
export function getInsertionParametres() {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = api.get('/insertion/parametres')
    .then((r) => {
      cache = { ...PARAMETRES_DEFAUTS, ...(r.data || {}) };
      return cache;
    })
    .catch(() => ({ ...PARAMETRES_DEFAUTS }))
    .finally(() => { inflight = null; });
  return inflight;
}

/** Vide le cache (tests / après édition des settings). */
export function resetInsertionParametresCache() {
  cache = null;
  inflight = null;
}

/** Date du jour + n jours, au format AAAA-MM-JJ. */
export function plusJours(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Date du jour + n mois, au format AAAA-MM-JJ. */
export function plusMois(n) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

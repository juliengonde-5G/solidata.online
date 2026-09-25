'use strict';

/**
 * Référence propriétaire d'une carte de badgeage (ex. « SOLIDATA A1 ») — la
 * référence imprimée ou étiquetée sur le support, qui permet de dire quelle
 * carte on tient en main sans jamais lire son UID.
 *
 * Règle UNIQUE de normalisation, partagée par l'attribution et la correction :
 * espaces de bord retirés, espaces internes réduits à un, majuscules. Sans
 * elle, « solidata  a1 » et « SOLIDATA A1 » désigneraient deux cartes.
 *
 * Retour :
 *   { ok: true, reference: 'SOLIDATA A1' }  — référence exploitable
 *   { ok: true, reference: null }           — champ vide (non fournie)
 *   { ok: false, erreur }                   — refusée, avec le motif
 */
const LONGUEUR_MAX = 40;
const FORMAT = /^[A-Z0-9][A-Z0-9 ._\-/]*$/;

function normaliserReferenceBadge(valeur) {
  if (valeur === undefined || valeur === null) return { ok: true, reference: null };
  if (typeof valeur !== 'string') return { ok: false, erreur: 'La référence doit être un texte' };
  const ref = valeur.trim().replace(/\s+/g, ' ').toUpperCase();
  if (ref === '') return { ok: true, reference: null };
  if (ref.length > LONGUEUR_MAX) {
    return { ok: false, erreur: `La référence ne doit pas dépasser ${LONGUEUR_MAX} caractères` };
  }
  if (!FORMAT.test(ref)) {
    return {
      ok: false,
      erreur: 'Référence invalide : lettres, chiffres, espaces et . _ - / uniquement (ex. SOLIDATA A1)',
    };
  }
  return { ok: true, reference: ref };
}

module.exports = { normaliserReferenceBadge, LONGUEUR_MAX };

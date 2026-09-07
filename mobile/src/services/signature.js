/**
 * Signature manuscrite recueillie sur le téléphone — logique PURE.
 *
 * Le pad lui-même (composants/SignaturePad.jsx) dessine dans un <canvas> ; ce
 * module ne connaît ni le DOM ni le réseau. Il répond à trois questions, et
 * uniquement à celles-là :
 *
 *   1. « Ce geste est-il une signature, ou un doigt posé par erreur ? »
 *      (`signatureExploitable`) — un seul point de contact produit un point
 *      noir de 3 px : le reporter sur un document officiel signé par un tiers
 *      serait pire qu'une case vide, parce que ça se lit comme une signature.
 *   2. « L'image produite est-elle bien un PNG encodé en dataURL ? »
 *      (`estDataUrlPng`) — le serveur refuse tout le reste (contrat §2.1,
 *      code SIGNATURE_INVALIDE), autant le voir avant de mettre en file.
 *   3. « Combien pèse-t-elle vraiment ? » (`tailleDataUrlOctets`) — la borne
 *      serveur est de 200 Ko décodés ; c'est elle qui rend acceptable
 *      l'exception à la doctrine « aucun blob en file » (cf. services/db.js).
 *
 * Aucune de ces fonctions ne corrige quoi que ce soit : elles disent oui ou
 * non. Une signature refusée est redemandée au chauffeur, jamais réparée.
 */

/**
 * Nombre minimal de points de tracé pour qu'un geste compte comme une
 * signature. Douze : un simple appui en produit un ou deux (pointerdown +
 * éventuel micro-mouvement), un paraphe même très rapide en produit
 * plusieurs dizaines. Le seuil sépare donc l'accident du geste volontaire
 * sans jamais refuser une vraie signature courte.
 */
export const SIGNATURE_MIN_POINTS = 12;

/**
 * Borne de poids d'une signature, en octets DÉCODÉS. Valeur alignée AU MÊME
 * NOMBRE que la borne serveur (`SIGNATURE_MAX_OCTETS` de
 * backend/src/services/bordereau-decheterie.js, 200 Kio) : dépasser ici, c'est
 * se faire refuser là-bas après avoir occupé la file ; refuser ici plus tôt que
 * là-bas ferait perdre un document que le serveur aurait accepté. Un canevas de
 * 600 × 220 en PNG monochrome pèse en pratique quelques dizaines de Ko — la
 * marge est large et volontaire.
 */
export const SIGNATURE_MAX_OCTETS = 200 * 1024;

const PREFIXE_PNG = 'data:image/png;base64,';

/**
 * Le geste est-il exploitable comme signature ?
 * @param {Array<Array<object>>} traits - tracés, chacun étant une liste de points.
 * @returns {boolean}
 */
export function signatureExploitable(traits) {
  if (!Array.isArray(traits) || traits.length === 0) return false;
  let total = 0;
  for (const trait of traits) {
    if (!Array.isArray(trait)) continue;
    total += trait.length;
    if (total >= SIGNATURE_MIN_POINTS) return true;
  }
  return false;
}

/**
 * La chaîne est-elle une dataURL PNG en base64 ?
 * Volontairement strict : le serveur ne connaît que cette forme, et une image
 * « presque » valide serait refusée après coup, hors de portée du chauffeur.
 * @param {*} s
 * @returns {boolean}
 */
export function estDataUrlPng(s) {
  if (typeof s !== 'string') return false;
  if (!s.startsWith(PREFIXE_PNG)) return false;
  const b64 = s.slice(PREFIXE_PNG.length);
  if (b64.length === 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(b64);
}

/**
 * Poids en octets DÉCODÉS d'une dataURL base64 (approximation exacte à
 * l'octet près pour un base64 bien formé : 4 caractères ↦ 3 octets, moins le
 * remplissage final).
 * @param {*} s
 * @returns {number} 0 si la chaîne n'est pas une dataURL exploitable.
 */
export function tailleDataUrlOctets(s) {
  if (typeof s !== 'string') return 0;
  const virgule = s.indexOf(',');
  if (virgule < 0) return 0;
  const b64 = s.slice(virgule + 1);
  if (!b64) return 0;
  let remplissage = 0;
  if (b64.endsWith('==')) remplissage = 2;
  else if (b64.endsWith('=')) remplissage = 1;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - remplissage);
}

/**
 * Signature acceptable pour l'envoi : PNG bien formé ET sous la borne.
 * Regroupée ici pour que les deux règles ne se séparent jamais en chemin.
 * @param {*} dataUrl
 * @returns {boolean}
 */
export function signaturePresentableAuServeur(dataUrl) {
  return estDataUrlPng(dataUrl) && tailleDataUrlOctets(dataUrl) <= SIGNATURE_MAX_OCTETS;
}

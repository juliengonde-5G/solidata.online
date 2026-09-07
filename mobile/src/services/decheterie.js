/**
 * Bordereau de collecte en déchèterie — règles PURES (chantier 2.50.0).
 *
 * Une déchèterie de la Métropole n'est pas une borne de rue : elle exige un
 * bordereau papier signé par son agent ET par le chauffeur. Ce module dit
 * quand ce bordereau est dû, ce qui le rend valide, et quelle forme prend le
 * corps JSON envoyé au serveur. Aucun DOM, aucun réseau, aucune base : tout
 * est testable sans navigateur.
 *
 * Deux principes qui portent tout le reste :
 *
 *  • LE POIDS EST INDICATIF, ET LE RESTE. Il ne rejoint jamais les pesées de
 *    la tournée : c'est une estimation demandée par la Métropole pour SON
 *    formulaire. Le confondre avec une pesée fausserait le tonnage et le stock.
 *
 *  • L'ABSENCE DE L'AGENT SE DÉCLARE, elle ne se devine pas. Un bordereau sans
 *    signature d'agent et sans motif serait indiscernable d'un oubli ; avec
 *    son motif, il reste un document opposable qui dit pourquoi il manque une
 *    signature (arbitrage client Q2, cahier des charges §5).
 */

import { signaturePresentableAuServeur } from './signature';

/**
 * Seul motif d'absence accepté (liste FERMÉE, alignée sur la contrainte
 * serveur `signature_agent_absente_motif`). Une liste ouverte laisserait
 * s'installer des motifs libres qu'aucun document officiel ne peut porter.
 */
export const MOTIF_AGENT_INDISPONIBLE = 'agent_indisponible';

/** Borne haute du poids indicatif, alignée sur le CHECK serveur. */
export const POIDS_INDICATIF_MAX_KG = 60000;

/**
 * Ce point exige-t-il un bordereau maintenant ?
 *
 * Les deux drapeaux viennent du serveur (contrat §2.2) et sont lus SANS
 * interprétation : `is_decheterie` strictement vrai, et pas de bordereau déjà
 * déposé pour ce passage. Un payload qui ne porte pas encore ces champs (mobile
 * à jour face à un serveur qui ne l'est pas) répond donc « non » — le parcours
 * ordinaire continue, personne n'est bloqué.
 *
 * @param {object|null|undefined} point - un élément de `cavs[]`.
 * @returns {boolean}
 */
export function bordereauRequis(point) {
  if (!point || typeof point !== 'object') return false;
  return point.is_decheterie === true && point.bordereau_deja_depose !== true;
}

/**
 * Le poids indicatif est-il saisissable tel quel ?
 * `null`, chaîne vide, texte, NaN, négatif, au-delà de la borne : non.
 * Zéro est VALIDE — « rien pesé » est une déclaration, pas une absence
 * (même distinction que les sacs d'association, cf. services/db.js).
 * @param {*} n
 * @returns {boolean}
 */
export function poidsIndicatifValide(n) {
  if (n === null || n === undefined || n === '') return false;
  if (typeof n === 'boolean') return false;
  const v = typeof n === 'number' ? n : Number(String(n).replace(',', '.'));
  if (!Number.isFinite(v)) return false;
  return v >= 0 && v <= POIDS_INDICATIF_MAX_KG;
}

/** Poids normalisé pour l'envoi : NUMERIC(8,1) côté serveur, donc 1 décimale. */
export function poidsIndicatifNormalise(n) {
  const v = typeof n === 'number' ? n : Number(String(n).replace(',', '.'));
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 10) / 10;
}

/**
 * Le bordereau est-il complet ? Renvoie TOUTES les erreurs d'un coup (et non
 * la première) : sur un écran FALC, corriger un manque pour en découvrir un
 * autre est la meilleure façon de faire abandonner un chauffeur sous la pluie.
 *
 * @param {object} saisie
 * @param {number|string|null} saisie.poidsKg
 * @param {string|null} saisie.signatureAgent - dataURL PNG, ou null.
 * @param {string|null} saisie.agentAbsentMotif - MOTIF_AGENT_INDISPONIBLE ou null.
 * @param {string|null} saisie.signatureChauffeur - dataURL PNG (obligatoire).
 * @returns {{ ok: boolean, erreurs: string[] }}
 */
export function validerBordereau({
  poidsKg = null,
  signatureAgent = null,
  agentAbsentMotif = null,
  signatureChauffeur = null,
} = {}) {
  const erreurs = [];

  if (poidsKg === null || poidsKg === undefined || poidsKg === '') {
    erreurs.push('Indiquez le poids indicatif en kg.');
  } else if (!poidsIndicatifValide(poidsKg)) {
    const v = typeof poidsKg === 'number' ? poidsKg : Number(String(poidsKg).replace(',', '.'));
    if (Number.isFinite(v) && v > POIDS_INDICATIF_MAX_KG) {
      erreurs.push('Le poids indicatif ne peut pas dépasser 60 000 kg.');
    } else {
      erreurs.push('Le poids indicatif doit être un nombre de kilos, zéro ou plus.');
    }
  }

  const agentSigne = signaturePresentableAuServeur(signatureAgent);
  if (!agentSigne && agentAbsentMotif !== MOTIF_AGENT_INDISPONIBLE) {
    erreurs.push(
      signatureAgent
        ? "La signature de l’agent n’a pas pu être enregistrée. Refaites-la, ou indiquez que l’agent n’est pas disponible."
        : "Faites signer l’agent de la déchèterie, ou indiquez qu’il n’est pas disponible."
    );
  }

  if (!signaturePresentableAuServeur(signatureChauffeur)) {
    erreurs.push(
      signatureChauffeur
        ? 'Votre signature n’a pas pu être enregistrée. Refaites-la.'
        : 'Signez le bordereau (signature du chauffeur).'
    );
  }

  return { ok: erreurs.length === 0, erreurs };
}

/**
 * Corps JSON EXACT attendu par
 * `POST /api/tours/:id/cav/:cavId/bordereau-decheterie-public` (contrat §2.1).
 *
 * Rien de plus, rien de moins : la tournée et le point voyagent dans l'URL, et
 * le serveur ne fait aucune confiance à un champ supplémentaire.
 *
 * `signature_agent` et `agent_absent_motif` sont toujours PRÉSENTS, à `null`
 * quand ils ne s'appliquent pas : un champ absent et un champ nul se
 * confondraient dans le journal du serveur, et l'absence d'agent est
 * précisément l'information qu'on ne veut pas perdre.
 *
 * @param {object} item - l'élément de file (services/db.js addPendingBordereau).
 * @returns {object}
 */
export function construirePayloadBordereau(item = {}) {
  const agentSigne = signaturePresentableAuServeur(item.signatureAgent) ? item.signatureAgent : null;
  return {
    client_id: item.clientId || null,
    poids_indicatif_kg: poidsIndicatifNormalise(item.poidsKg),
    signature_chauffeur: signaturePresentableAuServeur(item.signatureChauffeur)
      ? item.signatureChauffeur
      : null,
    signature_agent: agentSigne,
    // Le motif n'accompagne QUE l'absence : le poser à côté d'une signature
    // présente ferait mentir le document (« agent indisponible » sous un
    // paraphe d'agent).
    agent_absent_motif: agentSigne ? null : (item.agentAbsentMotif || null),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// DOUBLAGE DES NOTIFICATIONS D'EXPLOITATION DANS LA MESSAGERIE INTERNE
// ──────────────────────────────────────────────────────────────────────────
// La messagerie S'AJOUTE aux canaux existants (push VAPID, Brevo) sans en
// retirer aucun (arbitrage §12.3 du contrat du 26/08). Ce module porte le
// geste de doublage à UN SEUL endroit, pour qu'il ne se répande pas en copies
// divergentes au fil des points d'appel.
//
// CORRECTIF DU 27/08 — pourquoi ce fichier existe : le doublage avait été
// posé sur les anomalies de checklist, les incidents, les consignes chauffeur,
// les relances candidats et les jalons d'insertion, mais PAS sur la fin de
// tournée ni sur les propositions de ré-optimisation d'ordre. Un gestionnaire
// qui prend la messagerie pour son canal de notifications manquait ces
// événements sans savoir qu'ils existaient ailleurs — et rien à l'écran ne le
// lui disait.
//
// DEUX RÈGLES, toutes deux délibérées :
//
//   1. `require` PARESSEUX sous try/catch. Le service de messagerie a été
//      livré par un lot parallèle ; un `require` en tête de fichier ferait
//      échouer TOUT le module des tournées — donc le parcours chauffeur —
//      pour un canal de confort. Son absence dégrade sur un avertissement.
//
//   2. JAMAIS BLOQUANT. Ces fonctions n'attendent pas et ne rejettent jamais :
//      une messagerie en panne ne doit pas empêcher une tournée de se clôturer.
// ══════════════════════════════════════════════════════════════════════════

/** Rôles destinataires des notifications d'exploitation. */
const ROLES_EXPLOITATION = ['ADMIN', 'MANAGER'];

/**
 * Dépose un message système dans la messagerie des gestionnaires.
 *
 * @param {{texte: string, source: string, lien?: string|null}} args
 * @returns {void} — délibérément SANS promesse : aucun appelant ne doit
 *   pouvoir se mettre à l'attendre par inadvertance.
 */
function notifierGestionnaires({ texte, source, lien = null }) {
  try {
    const { envoyerMessageSystemeRoles } = require('../../services/messagerie');
    if (typeof envoyerMessageSystemeRoles !== 'function') return;
    Promise.resolve(envoyerMessageSystemeRoles(ROLES_EXPLOITATION, { texte, source, lien }))
      .catch((err) => console.warn('[TOURS] Messagerie interne indisponible :', err.message));
  } catch (err) {
    console.warn('[TOURS] Service de messagerie absent, notification non doublée :', err.message);
  }
}

module.exports = { notifierGestionnaires, ROLES_EXPLOITATION };

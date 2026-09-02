// ══════════════════════════════════════════════════════════════
// REPLANIFICATION D'UNE TOURNÉE EN COURS
// ──────────────────────────────────────────────────────────────
// Constat client (02/09/2026, tournée #681) : il est midi, le camion en est à
// sa 3e borne, et la « Pause déjeuner au centre » est affichée en 15e étape,
// derrière neuf bornes encore à faire. Les heures prévues annonçaient 10:16
// pour l'étape suivante.
//
// CE QUI SE PASSAIT — deux calculs, faits UNE SEULE FOIS, et jamais rejoués :
//   • la POSITION de la pause dans le programme était posée au démarrage
//     (arrets.poserRetoursAutomatiques), sur une chronologie théorique ;
//   • les HEURES PRÉVUES étaient calculées au démarrage elles aussi, et
//     `ensurePlannedPassages` refusait de recommencer dès qu'un point en
//     portait une (garde d'idempotence).
// Une journée qui prend deux heures de retard — un vidage imprévu, une borne
// inaccessible, un bouchon — laissait donc le programme raconter la matinée
// qu'on avait imaginée, pas celle qui avait lieu.
//
// Pire : les deux calculs pouvaient se contredire. La pause était placée
// d'après une simulation, les heures d'après une autre, avec des ancrages
// différents — on pouvait lire un trou d'une heure et demie entre deux bornes
// à un endroit, et la pause dessinée à un autre.
//
// CE QUE FAIT CE MODULE — UNE SEULE simulation, refaite à chaque avancement,
// qui décide À LA FOIS de l'heure et de la place :
//   1. on repart de MAINTENANT et de là où l'équipage se trouve réellement ;
//   2. on ne simule que ce qui RESTE à faire ;
//   3. le travail déjà accompli est transmis au moteur (`priorWorkMinutes`) —
//      un équipage qui a quatre heures derrière lui a droit à sa pause tout de
//      suite, même si la simulation vient de commencer ;
//   4. les heures prévues des points restants sont réécrites ;
//   5. la pause est DÉPLACÉE à l'endroit que cette même simulation lui donne.
//
// DEUX RÈGLES QU'ON NE TRANSGRESSE PAS :
//   • une pause déjà prise (arrêt « done ») n'est jamais reposée ni déplacée —
//     elle a eu lieu, c'est un fait, pas une prévision ;
//   • la pause ne recule jamais DERRIÈRE le chauffeur. Une étape placée dans
//     son passé est invisible du mobile (l'étape courante est toujours la
//     première devant lui) : c'est le défaut corrigé en 2.37.1, on ne le
//     réintroduit pas par la porte de derrière.
//
// Les heures prévues des points DÉJÀ traités ne sont pas retouchées : elles
// sont la trace de ce qui avait été annoncé, et l'écran les confronte à l'heure
// réelle. Les réécrire effacerait l'écart que le gestionnaire cherche à lire.
// ══════════════════════════════════════════════════════════════

const pool = require('../../config/database');
const { computePlanEnCours } = require('./planned-passage');
const { deplacerPauseDejeuner } = require('./arrets');

/**
 * Rejoue le programme d'une tournée EN COURS sur son avancement réel.
 *
 * Best effort de bout en bout : c'est un confort d'affichage, jamais une
 * condition de la collecte. Un échec est journalisé et la tournée continue —
 * le chauffeur ne doit jamais être bloqué parce qu'une pause n'a pas pu être
 * replacée.
 *
 * @param {number} tourId
 * @returns {Promise<{replanifie: boolean, motif?: string, heures_mises_a_jour?: number,
 *                    pause?: object}>}
 */
async function replanifierTourneeEnCours(tourId) {
  const id = parseInt(tourId, 10);
  if (!Number.isInteger(id)) return { replanifie: false, motif: 'identifiant_invalide' };

  const plan = await computePlanEnCours(id);
  if (!plan || plan.motif) {
    return { replanifie: false, motif: (plan && plan.motif) || 'plan_indisponible' };
  }

  let pause = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    pause = await deplacerPauseDejeuner(client, id, plan.pause_apres_n_points);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Les heures ont déjà été écrites par `computePlanEnCours` : le programme
    // reste cohérent, seule la position de la pause n'a pas bougé. On le dit.
    console.warn(`[TOURS] Pause déjeuner non replacée (tournée ${id}) :`, err.message);
    return { replanifie: true, heures_mises_a_jour: plan.heures_mises_a_jour, pause: null };
  } finally {
    client.release();
  }

  return { replanifie: true, heures_mises_a_jour: plan.heures_mises_a_jour, pause };
}

/** Version qui n'échoue jamais — pour les accroches en arrière-plan. */
function replanifierEnArrierePlan(tourId, contexte = 'avancement') {
  return replanifierTourneeEnCours(tourId).catch((err) => {
    console.warn(`[TOURS] Replanification (${contexte}) échouée :`, err.message);
    return { replanifie: false, motif: 'erreur' };
  });
}

module.exports = { replanifierTourneeEnCours, replanifierEnArrierePlan };

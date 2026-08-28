// ══════════════════════════════════════════════════════════════
// POIDS D'UNE TOURNÉE — la règle de calcul, en un seul endroit
// ──────────────────────────────────────────────────────────────
// `tours.total_weight_kg` est une valeur DÉRIVÉE : la somme des pesées de
// `tour_weights`. Cette somme était recopiée à l'identique dans chaque écran
// qui enregistre une pesée (mobile `weigh-public`, web `POST /:id/weigh`), et
// c'est précisément ce genre de recopie qui a produit le défaut d'août 2026 :
// une des copies excluait les pesées « intermédiaires », les kilos déposés au
// centre en cours de journée disparaissaient du total — et avec eux le tonnage
// par borne, l'entrée de stock et l'apprentissage du moteur prédictif.
//
// LA RÈGLE, écrite une fois : le poids d'une tournée est la somme de TOUTES
// ses pesées, les intermédiaires comprises. Une pesée intermédiaire n'est pas
// un relevé provisoire, c'est un chargement réellement déposé par un équipage
// qui repart collecter.
//
// Ce module n'expose rien d'autre : ni route, ni état. Il est requis par la
// voie chauffeur comme par la voie gestionnaire, pour qu'aucune des deux ne
// puisse dériver de l'autre.
// ══════════════════════════════════════════════════════════════

const pool = require('../../config/database');

/**
 * Borne haute d'une pesée. Un semi-remorque plein plafonne autour de 40 t ;
 * au-delà de 60 t on ne pèse plus un camion, on saisit un chiffre de travers
 * (virgule oubliée, grammes pris pour des kilos). Refuser tôt vaut mieux que
 * de laisser une valeur aberrante contaminer le tonnage et le stock.
 */
const POIDS_MAX_KG = 60000;

/**
 * Lit un poids envoyé par un écran. Renvoie `{ valeur }` ou `{ error }` —
 * jamais une valeur de remplacement : un poids illisible est une saisie à
 * corriger, pas un zéro à enregistrer.
 *
 * @param {*} brut          la valeur reçue
 * @param {object} options  { obligatoire: bool, champ: string }
 */
function lirePoidsKg(brut, { obligatoire = true, champ = 'Le poids' } = {}) {
  if (brut === undefined || brut === null || brut === '') {
    return obligatoire ? { error: `${champ} est obligatoire.` } : { valeur: null };
  }
  const n = typeof brut === 'number' ? brut : Number(String(brut).replace(',', '.'));
  if (!Number.isFinite(n)) return { error: `${champ} doit être un nombre.` };
  if (n < 0) return { error: `${champ} ne peut pas être négatif.` };
  if (n > POIDS_MAX_KG) {
    return { error: `${champ} dépasse ${POIDS_MAX_KG} kg : vérifiez la saisie.` };
  }
  // Le gramme n'a pas de sens sur un pont-bascule ; on garde toutefois deux
  // décimales pour ne pas rogner une saisie légitime en tonnes converties.
  return { valeur: Math.round(n * 100) / 100 };
}

/**
 * Recalcule et enregistre `tours.total_weight_kg` depuis `tour_weights`.
 * @returns {Promise<number>} le total désormais stocké, en kg.
 */
async function recalculerTotalTournee(db, tourId) {
  const r = await (db || pool).query(
    `UPDATE tours SET total_weight_kg = (
       SELECT COALESCE(SUM(weight_kg), 0) FROM tour_weights WHERE tour_id = $1
     ) WHERE id = $1
     RETURNING total_weight_kg`,
    [tourId]
  );
  return Number(r.rows[0]?.total_weight_kg) || 0;
}

module.exports = { POIDS_MAX_KG, lirePoidsKg, recalculerTotalTournee };

// Effets de bord de la clôture d'une tournée (passage à status = 'completed').
//
// Historiquement portés par la seule route web PUT /api/tours/:id/status
// (execution.js) : la route jumelle mobile PUT /:id/status-public — la SEULE
// utilisée par l'application chauffeur — clôturait la tournée SANS eux. Une
// tournée terminée depuis le téléphone n'alimentait donc ni tonnage_history
// (base d'apprentissage du moteur prédictif), ni les entrées de stock, ni le
// feedback prédit/observé : la boucle « on collecte → le modèle apprend » était
// silencieusement cassée. Ce module est désormais la source UNIQUE, appelée par
// les deux routes.
//
// Idempotence : l'appelant garantit que la transition vers 'completed' n'a eu
// lieu qu'une fois (garde SQL `AND status <> 'completed'`) — ces effets ne sont
// exécutés que sur la ligne réellement basculée.
const pool = require('../../config/database');
const { isDemoTour } = require('../../services/demo-mode');

/**
 * @param {object} tour  Ligne `tours` APRÈS la bascule en completed
 *                       (date, total_weight_kg, vehicle_id, collection_type).
 * @param {number} tourId
 * @param {number|null} userId  Auteur (req.user.id — compte générique chauffeur
 *                              pour le mobile), tracé dans created_by du stock.
 */
async function applyCompletionSideEffects(tour, tourId, userId) {
  // MODE DÉMO (formations) : une tournée d'entraînement ne produit AUCUN effet
  // métier — ni tonnage, ni entrée de stock, ni apprentissage du moteur
  // prédictif. Le stagiaire clôture normalement, l'écran se comporte comme en
  // vrai, mais aucune statistique réelle ne bouge.
  if (isDemoTour(tour)) {
    console.log(`[DEMO] Tournée #${tourId} clôturée en mode démo — effets métier neutralisés.`);
    return;
  }

  // 1. Tonnage par CAV collecté : le poids total pesé est réparti entre les
  //    CAV effectivement collectés (source 'mobile', même règle que la route web).
  if (tour.total_weight_kg > 0) {
    const cavs = await pool.query(
      "SELECT cav_id FROM tour_cav WHERE tour_id = $1 AND status = 'collected'",
      [tourId]
    );
    const weightPerCav = tour.total_weight_kg / (cavs.rows.length || 1);
    for (const tc of cavs.rows) {
      await pool.query(
        "INSERT INTO tonnage_history (date, cav_id, weight_kg, source) VALUES ($1, $2, $3, 'mobile')",
        [tour.date, tc.cav_id, weightPerCav]
      );
    }

    // 2. Entrée matière première (stock moderne)
    await pool.query(
      `INSERT INTO stock_movements (type, date, poids_kg, tour_id, vehicle_id, origine, notes, created_by)
       VALUES ('entree', $1, $2, $3, $4, 'collecte', $5, $6)`,
      [tour.date, tour.total_weight_kg, tourId, tour.vehicle_id,
       `Auto: tournée #${tourId} (${cavs.rows.length} CAV collectés)`, userId]
    );

    // 3. Entrée stock original (grand livre brut)
    await pool.query(
      `INSERT INTO stock_original_movements (type, date, poids_kg, tour_id, vehicle_id, origine, notes, created_by)
       VALUES ('entree', $1, $2, $3, $4, $5, $6, $7)`,
      [tour.date, tour.total_weight_kg, tourId, tour.vehicle_id,
       tour.collection_type === 'association' ? 'collecte_association' : 'collecte_pav',
       `Auto: tournée #${tourId} (${cavs.rows.length} CAV collectés)`, userId]
    );
  }

  // 4. Apprentissage continu : prédit vs observé (fill_level 0-5 saisi chauffeur)
  // On remonte AUSSI le pourcentage réellement saisi (`fill_percent`) : il est
  // plus fidèle que l'échelle 0-5 ×20, qui sous-estimait « plein » à 80 %.
  const tourCavs = await pool.query(
    'SELECT cav_id, predicted_fill_rate, fill_level, fill_percent FROM tour_cav WHERE tour_id = $1 AND predicted_fill_rate IS NOT NULL AND fill_level IS NOT NULL',
    [tourId]
  );
  for (const tc of tourCavs.rows) {
    await pool.query(
      `INSERT INTO collection_learning_feedback (tour_id, cav_id, predicted_fill_rate, observed_fill_level, observed_fill_percent)
       VALUES ($1, $2, $3, $4, $5)`,
      [tourId, tc.cav_id, tc.predicted_fill_rate, tc.fill_level, tc.fill_percent ?? null]
    );
  }
}

module.exports = { applyCompletionSideEffects };

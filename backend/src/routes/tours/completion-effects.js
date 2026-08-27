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
// DEUXIÈME DÉFAUT DE LA MÊME FAMILLE (constat L4 du 26/08/2026) : ces effets ne
// lisaient que `tour_cav`. Sur une tournée d'ASSOCIATIONS, dont les points
// vivent dans `tour_association_point`, le décompte des points collectés valait
// donc toujours zéro. Conséquences observées :
//   • `tonnage_history_association` n'était JAMAIS écrite — alors qu'elle est
//     lue par la carte des associations (« dernière collecte », « poids moyen
//     90 j ») et par `predictAssociationFillRate`. Les deux étaient donc
//     structurellement vides, sans que rien ne le signale ;
//   • le libellé du mouvement de stock annonçait « 0 CAV collectés » sur une
//     tournée qui en avait pourtant collecté quatre.
// Les deux familles suivent désormais la MÊME règle de répartition, chacune
// dans sa table.
//
// Idempotence : l'appelant garantit que la transition vers 'completed' n'a eu
// lieu qu'une fois (garde SQL `AND status <> 'completed'`) — ces effets ne sont
// exécutés que sur la ligne réellement basculée.
const pool = require('../../config/database');
const { isDemoTour } = require('../../services/demo-mode');
// Règle de répartition du poids — source UNIQUE, partagée avec le compte rendu
// de tournée. Le rapport doit dire exactement ce que la base a enregistré.
const { repartirPoids } = require('./sacs');

/** Une tournée d'associations collecte des points de dépôt, pas des bornes. */
const estAssociation = (tour) => !!tour && tour.collection_type === 'association';

/** Ce que le mouvement de stock doit dire de la collecte, sans mentir sur sa nature. */
function libelleCollectes(tour, nb) {
  return estAssociation(tour)
    ? `${nb} point(s) association collecté(s)`
    : `${nb} CAV collectés`;
}

/**
 * Identifiants des points RÉELLEMENT collectés, lus dans la table qui les
 * porte. Renvoie une liste d'objets `{ point_id }` : le reste du module n'a pas
 * à savoir de quelle famille il s'agit.
 */
async function pointsCollectes(tour, tourId, db = pool) {
  if (estAssociation(tour)) {
    // `nb_sacs` remonte AVEC le point : c'est la clé de répartition du poids.
    // Repli sur une base non migrée (colonne absente) : on relit sans elle
    // plutôt que d'échouer la clôture, qui porte le tonnage, le stock et
    // l'apprentissage. Les points reviennent alors sans déclaration, et la
    // répartition retombe d'elle-même à parts égales, en le disant.
    try {
      const r = await db.query(
        "SELECT association_point_id AS point_id, nb_sacs FROM tour_association_point WHERE tour_id = $1 AND status = 'collected'",
        [tourId]
      );
      return r.rows.filter((p) => p.point_id != null);
    } catch (err) {
      if (err.code !== '42703') throw err;   // colonne inexistante — tout autre échec doit remonter
      console.warn(`[TOURS] Colonne nb_sacs absente (tournée ${tourId}) : répartition à parts égales.`);
      const r = await db.query(
        "SELECT association_point_id AS point_id FROM tour_association_point WHERE tour_id = $1 AND status = 'collected'",
        [tourId]
      );
      return r.rows.filter((p) => p.point_id != null);
    }
  }
  const r = await db.query(
    "SELECT cav_id FROM tour_cav WHERE tour_id = $1 AND status = 'collected'",
    [tourId]
  );
  return r.rows.filter((p) => p.cav_id != null).map((p) => ({ point_id: p.cav_id }));
}

/**
 * Répartit le poids total pesé entre les points effectivement collectés.
 *
 * Le camion est pesé au centre de tri, jamais point par point. La répartition à
 * PARTS ÉGALES a longtemps été la seule information disponible, et elle était
 * assumée comme telle — sur une tournée qui ramasse deux sacs chez l'une et
 * quarante chez l'autre, elle inscrivait pourtant dans l'historique deux
 * chiffres également faux, que relisent ensuite la carte des associations et la
 * prédiction de remplissage.
 *
 * Depuis que l'équipage déclare son NOMBRE DE SACS au départ de chaque
 * association (08/2026), une clé observée existe : le poids d'un sac est le
 * poids pesé divisé par le total des sacs de la journée. La règle vit dans
 * `sacs.repartirPoids` — une seule fois, partagée avec le compte rendu — et
 * retombe d'elle-même à parts égales quand la déclaration manque ou est
 * incomplète. Ce repli est JOURNALISÉ : une moyenne présentée comme une mesure
 * serait précisément le défaut qu'on corrige.
 *
 * Les tournées de BORNES ne déclarent aucun sac : elles conservent donc
 * exactement le comportement historique, sans exception à écrire ici.
 *
 * @returns {Promise<number>} nombre de lignes d'historique écrites.
 */
async function ecrireTonnage(tour, tourId, points, db = pool) {
  if (points.length === 0) return 0;
  const repartition = repartirPoids(points, tour.total_weight_kg);

  if (repartition.mode === 'prorata_sacs') {
    console.log(
      `[TOURS] Clôture #${tourId} : poids réparti au prorata des sacs ` +
      `(${repartition.total_sacs} sac(s), ${Math.round(repartition.poids_par_sac_kg * 10) / 10} kg par sac).`
    );
  } else if (repartition.mode === 'parts_egales') {
    // Jamais silencieux : le motif dit POURQUOI la clé observée n'a pas servi.
    console.warn(`[TOURS] Clôture #${tourId} : ${repartition.motif}.`);
  }

  // `mode: 'aucun'` (rien à répartir) laisse `parts` vide : aucune ligne n'est
  // écrite, plutôt qu'une rangée de zéros dans l'historique d'apprentissage.
  for (const part of repartition.parts) {
    if (estAssociation(tour)) {
      await db.query(
        `INSERT INTO tonnage_history_association (association_point_id, date, weight_kg, tour_id, source)
         VALUES ($1, $2, $3, $4, 'mobile')`,
        [part.point_id, tour.date, part.poids_kg, tourId]
      );
    } else {
      await db.query(
        "INSERT INTO tonnage_history (date, cav_id, weight_kg, source) VALUES ($1, $2, $3, 'mobile')",
        [tour.date, part.point_id, part.poids_kg]
      );
    }
  }
  return repartition.parts.length;
}

/**
 * Apprentissage continu des points ASSOCIATION : prédit vs observé.
 *
 * Difficulté honnête : `tour_association_point` ne porte AUCUNE colonne de
 * prédiction (contrairement à `tour_cav.predicted_fill_rate`), et rien, nulle
 * part, n'appelait `predictAssociationFillRate` au moment de la planification.
 * Il n'existe donc pas de « prédiction du jour » stockée à comparer.
 *
 * On ne l'invente pas pour autant : on rejoue le VRAI moteur, AVANT d'écrire
 * les tonnages de cette tournée. La prédiction obtenue repose donc exactement
 * sur l'historique dont le planificateur disposait, et elle est reproductible.
 * Et quand le moteur n'a aucun historique pour ce point, il renvoie sa valeur
 * de repli (`method: 'default'`, 50 %) : ce n'est pas une prédiction, elle
 * n'est donc PAS enregistrée — l'écrire fausserait la correction ML qui lit
 * cette table.
 *
 * Best effort : un moteur muet ne doit jamais empêcher une tournée de se
 * clôturer, mais l'échec est journalisé, jamais avalé en silence.
 */
async function ecrireFeedbackAssociation(tourId, tour, db = pool) {
  let predictAssociationFillRate;
  try {
    // Requis ici et non en tête de module : le moteur de prédiction est lourd
    // et n'a rien à faire dans le parcours de clôture d'une tournée de bornes.
    ({ predictAssociationFillRate } = require('./predictions'));
  } catch (err) {
    console.warn('[TOURS] Moteur de prédiction association indisponible :', err.message);
    return 0;
  }

  const observes = await db.query(
    `SELECT association_point_id, fill_level FROM tour_association_point
      WHERE tour_id = $1 AND fill_level IS NOT NULL AND association_point_id IS NOT NULL`,
    [tourId]
  );

  let ecrits = 0;
  for (const p of observes.rows) {
    try {
      const prediction = await predictAssociationFillRate(p.association_point_id, tour.date);
      // Seul critère de rejet : le moteur n'avait AUCUN historique et a renvoyé
      // son repli (`method: 'default'`, 50 %). Une prédiction basse — jusqu'à
      // zéro sur un point vidé la veille — reste une prédiction du modèle : la
      // taire reviendrait à ne lui montrer que ses succès.
      if (!prediction || prediction.method === 'default' || !Number.isFinite(prediction.fill)) {
        continue;
      }
      await db.query(
        `INSERT INTO association_learning_feedback (tour_id, association_point_id, predicted_fill_rate, observed_fill_level)
         VALUES ($1, $2, $3, $4)`,
        [tourId, p.association_point_id, prediction.fill, p.fill_level]
      );
      ecrits += 1;
    } catch (err) {
      console.warn(
        `[TOURS] Apprentissage association non enregistré (tournée ${tourId}, point ${p.association_point_id}) :`,
        err.message
      );
    }
  }
  return ecrits;
}

/**
 * Détection et enregistrement des ARRÊTS GPS de la tournée.
 *
 * Le module d'analyse est requis PARESSEUSEMENT, ici et non en tête de fichier :
 * il tire `services/TourService` et le référentiel des lieux, dont la clôture
 * d'une tournée n'a aucun besoin par ailleurs. Une base non migrée (table
 * `tour_gps_stops` absente) dégrade donc sur un avertissement, sans jamais
 * remonter jusqu'à l'appelant.
 *
 * @returns {Promise<number>} nombre d'arrêts enregistrés (0 si dégradé).
 */
async function enregistrerArretsGps(tourId) {
  try {
    const { analyserArretsGps } = require('./analyse-gps');
    const r = await analyserArretsGps(tourId, { persist: true, source: 'cloture' });
    if (!r.ok) {
      console.warn(`[TOURS] Arrêts GPS non enregistrés (tournée ${tourId}) : ${r.motif}`);
      return 0;
    }
    if (r.persistes > 0) {
      console.log(`[TOURS] Clôture #${tourId} : ${r.persistes} arrêt(s) GPS enregistré(s).`);
    }
    return r.persistes;
  } catch (err) {
    console.warn(`[TOURS] Analyse des arrêts GPS indisponible (tournée ${tourId}) :`, err.message);
    return 0;
  }
}

/**
 * @param {object} tour  Ligne `tours` APRÈS la bascule en completed
 *                       (date, total_weight_kg, vehicle_id, collection_type).
 * @param {number} tourId
 * @param {number|null} userId  Auteur (req.user.id — compte générique chauffeur
 *                              pour le mobile), tracé dans created_by du stock.
 */
/**
 * Poids réellement pesé sur la tournée — LA source de vérité, `tour_weights`.
 *
 * `tours.total_weight_kg` est une valeur DÉRIVÉE, recalculée par les écrans de
 * pesée. Elle est donc juste tant qu'on passe par eux — et périmée dès qu'on
 * clôture autrement : par la ré-ouverture d'une tournée, par le bouton
 * « Terminer » du gestionnaire, ou (depuis le 26/08/2026) par un équipage qui
 * termine sans repasser par la pesée parce que le camion venait d'être vidé.
 * Dans ce dernier cas la colonne valait encore 0 alors que 980 kg avaient été
 * pesés en cours de journée : ni tonnage, ni entrée de stock, ni apprentissage.
 *
 * On ne fait donc plus confiance à la valeur stockée au moment de la clôture :
 * on la recalcule. La règle est celle de la 2.35.0 — TOUTES les pesées, les
 * intermédiaires comprises, chacune étant un chargement réellement déposé.
 */
async function poidsTotalPese(tourId, db = pool) {
  const r = await db.query(
    'SELECT COALESCE(SUM(weight_kg), 0) AS total FROM tour_weights WHERE tour_id = $1',
    [tourId]
  );
  return Number(r.rows[0]?.total) || 0;
}

async function applyCompletionSideEffects(tour, tourId, userId) {
  // MODE DÉMO (formations) : une tournée d'entraînement ne produit AUCUN effet
  // métier — ni tonnage, ni entrée de stock, ni apprentissage du moteur
  // prédictif. Le stagiaire clôture normalement, l'écran se comporte comme en
  // vrai, mais aucune statistique réelle ne bouge.
  if (isDemoTour(tour)) {
    console.log(`[DEMO] Tournée #${tourId} clôturée en mode démo — effets métier neutralisés.`);
    return;
  }

  // 0. Apprentissage des points ASSOCIATION — RELEVÉ AVANT toute écriture de
  //    tonnage : la prédiction rejouée doit reposer sur l'historique dont le
  //    planificateur disposait, pas sur la collecte qu'on est en train
  //    d'enregistrer. Inverser l'ordre ferait comparer le modèle à lui-même.
  if (estAssociation(tour)) {
    await ecrireFeedbackAssociation(tourId, tour);
  }

  // Le poids fait foi depuis `tour_weights` — sauf si cette table est muette.
  //
  // Règle, et sa raison : quand des pesées EXISTENT, leur somme est la
  // définition même du poids de la tournée, et elle l'emporte sur la colonne
  // dérivée (qui peut être périmée — voir poidsTotalPese). Quand il n'y en a
  // AUCUNE, un total déjà stocké vient forcément d'ailleurs (reprise manuelle,
  // import, historique) : on ne le RAMÈNE PAS à zéro, car rien ne permettrait
  // de le retrouver. Le correctif ne peut donc qu'ajouter du poids qui se
  // perdait, jamais en retirer.
  const totalPese = await poidsTotalPese(tourId);
  const stocke = Number(tour.total_weight_kg || 0);
  const total = totalPese > 0 ? totalPese : stocke;
  if (totalPese > 0 && totalPese !== stocke) {
    console.warn(
      `[TOURS] Clôture #${tourId} : total recalculé depuis les pesées ` +
      `(${stocke} kg stockés → ${totalPese} kg pesés).`
    );
    await pool.query('UPDATE tours SET total_weight_kg = $1 WHERE id = $2', [totalPese, tourId]);
  }
  tour = { ...tour, total_weight_kg: total };

  if (total > 0) {
    const points = await pointsCollectes(tour, tourId);

    // 1. Tonnage par point collecté : le poids total pesé est réparti entre les
    //    points effectivement collectés (bornes → tonnage_history, points
    //    association → tonnage_history_association).
    await ecrireTonnage(tour, tourId, points);

    const notes = `Auto: tournée #${tourId} (${libelleCollectes(tour, points.length)})`;

    // 2. Entrée matière première (stock moderne)
    await pool.query(
      `INSERT INTO stock_movements (type, date, poids_kg, tour_id, vehicle_id, origine, notes, created_by)
       VALUES ('entree', $1, $2, $3, $4, 'collecte', $5, $6)`,
      [tour.date, tour.total_weight_kg, tourId, tour.vehicle_id, notes, userId]
    );

    // 3. Entrée stock original (grand livre brut)
    await pool.query(
      `INSERT INTO stock_original_movements (type, date, poids_kg, tour_id, vehicle_id, origine, notes, created_by)
       VALUES ('entree', $1, $2, $3, $4, $5, $6, $7)`,
      [tour.date, tour.total_weight_kg, tourId, tour.vehicle_id,
       estAssociation(tour) ? 'collecte_association' : 'collecte_pav', notes, userId]
    );
  }

  // 3bis. Arrêts GPS de la journée : détectés et figés MAINTENANT, une fois
  //    que la trace est complète. C'est le seul moment où elle l'est — un arrêt
  //    calculé en cours de route n'a pas encore de fin.
  //
  //    BEST EFFORT ASSUMÉ : l'analyse lit des relevés GPS et écrit dans une
  //    table de confort. Un échec ne doit JAMAIS empêcher une clôture, dont
  //    dépendent le tonnage, le stock et l'apprentissage. Il est journalisé —
  //    jamais avalé en silence.
  await enregistrerArretsGps(tourId);

  // 4. Apprentissage continu des BORNES : prédit vs observé (fill_level 0-5
  //    saisi chauffeur). Celui des associations a été relevé à l'étape 0.
  if (estAssociation(tour)) return;

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

module.exports = {
  applyCompletionSideEffects,
  poidsTotalPese,
  enregistrerArretsGps,
  // Exportés pour le script de rattrapage et les tests : la règle de
  // répartition doit rester UNE seule, jamais réécrite ailleurs.
  estAssociation,
  libelleCollectes,
  pointsCollectes,
  ecrireTonnage,
};

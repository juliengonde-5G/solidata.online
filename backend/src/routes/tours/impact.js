// ══════════════════════════════════════════════════════════════
// IMPACT D'UNE MODIFICATION DE PROGRAMME
// ──────────────────────────────────────────────────────────────
// Constat client (08/2026) : le gestionnaire pouvait réordonner une tournée en
// cours, y ajouter un point ou un arrêt — sans jamais savoir ce que ça coûtait.
// Combien de kilomètres en plus ? La journée tient-elle encore dans les six
// heures ? À quelle heure l'équipe rentre-t-elle maintenant ? Aucune de ces
// questions n'avait de réponse à l'écran : on déplaçait des lignes à l'aveugle.
//
// Ce module estime le programme AVANT et APRÈS la modification, avec la MÊME
// méthode des deux côtés — sans quoi l'écart mesurerait la différence entre
// deux façons de calculer, pas l'effet du geste. Il rafraîchit au passage les
// chiffres stockés de la tournée, pour que les écrans cessent d'afficher une
// estimation devenue fausse.
//
// Doctrine : jamais de valeur inventée. Si l'estimation ne peut pas être faite
// (véhicule introuvable, routeur muet, base incomplète), l'impact vaut `null`
// avec son motif — on ne présente pas un zéro rassurant à la place d'un calcul
// qui n'a pas eu lieu.
// ══════════════════════════════════════════════════════════════

const pool = require('../../config/database');
const { estimateFixedRoute } = require('./smart-tour');

/**
 * Points de collecte d'une tournée, DANS L'ORDRE du programme, mis en forme
 * pour le moteur de temps.
 *
 * Les arrêts de retour au centre ne sont volontairement PAS transmis : le
 * moteur décide lui-même des vidages et de la pause déjeuner à partir de la
 * charge et de l'heure. Les fournir en plus reviendrait à compter deux fois le
 * même aller-retour. Un arrêt technique ordinaire (magasin, entretien) n'entre
 * pas non plus dans le calcul : sa durée est connue, mais il n'a pas de poids
 * collecté et le moteur ne modélise pas encore ce cas — c'est dit ici plutôt
 * que masqué par une approximation.
 */
async function chargerPointsTournee(tourId) {
  const r = await pool.query(
    `SELECT c.id, c.name, c.address, c.commune, c.latitude, c.longitude, c.nb_containers
       FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
      WHERE tc.tour_id = $1
      ORDER BY tc.position`,
    [tourId]
  );
  if (r.rows.length > 0) return r.rows.map((row) => ({ ...row, type: 'cav' }));

  // Tournée association : mêmes clés, autre table.
  const a = await pool.query(
    `SELECT ap.id, ap.name, ap.address, ap.ville AS commune, ap.latitude, ap.longitude
       FROM tour_association_point tap JOIN association_points ap ON ap.id = tap.association_point_id
      WHERE tap.tour_id = $1
      ORDER BY tap.position`,
    [tourId]
  );
  return a.rows.map((row) => ({ ...row, type: 'association' }));
}

/**
 * Estime le programme actuel d'une tournée.
 * @returns {Promise<object|null>} estimation, ou `null` si non calculable.
 */
async function estimerProgramme(tourId) {
  try {
    const t = await pool.query(
      `SELECT t.id, t.date, t.vehicle_id,
              v.id AS v_id, v.registration, v.name AS v_name, v.max_capacity_kg
         FROM tours t LEFT JOIN vehicles v ON v.id = t.vehicle_id
        WHERE t.id = $1`,
      [tourId]
    );
    if (t.rows.length === 0 || t.rows[0].v_id == null) return null;

    const points = await chargerPointsTournee(tourId);
    if (points.length === 0) return null;

    const vehicle = {
      id: t.rows[0].v_id,
      registration: t.rows[0].registration,
      name: t.rows[0].v_name,
      max_capacity_kg: t.rows[0].max_capacity_kg,
    };
    const { estimation } = await estimateFixedRoute({ vehicle, points, date: t.rows[0].date });
    return estimation;
  } catch (err) {
    console.warn(`[TOURS] Estimation du programme ${tourId} impossible :`, err.message);
    return null;
  }
}

/** Différence signée entre deux nombres, `null` si l'un des deux manque. */
function ecart(apres, avant) {
  if (!Number.isFinite(apres) || !Number.isFinite(avant)) return null;
  return Math.round((apres - avant) * 10) / 10;
}

/**
 * Compare deux estimations et produit le bloc `impact` du contrat d'API.
 * Renvoie toujours un objet : `calculable: false` + `motif` quand l'un des deux
 * côtés manque, pour que l'écran puisse le DIRE au lieu d'afficher « 0 ».
 */
function comparer(avant, apres) {
  if (!apres) {
    return {
      calculable: false,
      motif: 'Nouvelle estimation indisponible (véhicule, points ou routeur).',
      avant: avant || null,
      apres: null,
    };
  }
  if (!avant) {
    return {
      calculable: false,
      motif: 'Aucune estimation de référence avant la modification : l’écart ne peut pas être mesuré.',
      avant: null,
      apres,
    };
  }
  return {
    calculable: true,
    avant,
    apres,
    ecart: {
      distance_km: ecart(apres.distance_km, avant.distance_km),
      duree_travail_min: ecart(apres.duree_travail_min, avant.duree_travail_min),
      duree_totale_min: ecart(apres.duree_totale_min, avant.duree_totale_min),
      nb_points: ecart(apres.nb_points, avant.nb_points),
      nb_retours_vidage: ecart(apres.nb_retours_vidage, avant.nb_retours_vidage),
      poids_estime_kg: ecart(apres.poids_estime_kg, avant.poids_estime_kg),
    },
    // Ce qui compte pour décider : la journée tient-elle encore ?
    budget: {
      budget_travail_min: apres.budget_travail_min,
      depassement_min: apres.depassement_min,
      faisable: apres.faisable,
      // Le passage de « ça tient » à « ça ne tient plus » est l'information la
      // plus utile du lot : elle mérite d'être explicite, pas déduite.
      bascule_hors_budget: avant.faisable === true && apres.faisable === false,
      revient_dans_budget: avant.faisable === false && apres.faisable === true,
    },
    horaires: {
      heure_depart: apres.heure_depart,
      heure_fin_estimee: apres.heure_fin_estimee,
      heure_fin_precedente: avant.heure_fin_estimee,
    },
    avertissements: apres.avertissements || [],
  };
}

/**
 * Rafraîchit les chiffres stockés de la tournée. Sans cela, les écrans
 * continueraient d'afficher l'estimation faite à la création, devenue fausse
 * dès la première modification — exactement le genre de chiffre périmé qu'on
 * prend pour un chiffre juste.
 */
async function rafraichirEstimationStockee(tourId, estimation) {
  if (!estimation) return;
  try {
    await pool.query(
      `UPDATE tours
          SET estimated_distance_km = $2,
              estimated_duration_min = $3,
              nb_cav = $4
        WHERE id = $1`,
      [tourId, estimation.distance_km, estimation.duree_travail_min, estimation.nb_points]
    );
  } catch (err) {
    console.warn(`[TOURS] Estimation stockée non rafraîchie (tournée ${tourId}) :`, err.message);
  }
}

/**
 * Enveloppe complète : à appeler APRÈS la modification, avec l'estimation
 * relevée AVANT. Best effort de bout en bout — un impact non calculable ne doit
 * jamais annuler une modification déjà commitée.
 */
async function impactApresModification(tourId, estimationAvant) {
  const apres = await estimerProgramme(tourId);
  await rafraichirEstimationStockee(tourId, apres);
  return comparer(estimationAvant, apres);
}

/**
 * Phrase courte résumant l'impact, destinée au message envoyé au chauffeur et
 * au bandeau du gestionnaire. Renvoie `null` quand il n'y a rien d'honnête à
 * dire — un impact non calculable ne se raconte pas.
 */
function resumerImpact(impact) {
  if (!impact || !impact.calculable) return null;
  const e = impact.ecart || {};
  const morceaux = [];
  if (Number.isFinite(e.distance_km) && e.distance_km !== 0) {
    morceaux.push(`${e.distance_km > 0 ? '+' : ''}${e.distance_km} km`);
  }
  if (Number.isFinite(e.duree_travail_min) && e.duree_travail_min !== 0) {
    morceaux.push(`${e.duree_travail_min > 0 ? '+' : ''}${Math.round(e.duree_travail_min)} min de travail`);
  }
  if (morceaux.length === 0) return 'Aucun effet mesurable sur la distance ni sur la durée.';
  let phrase = morceaux.join(', ');
  if (impact.horaires?.heure_fin_estimee) {
    phrase += ` — retour estimé à ${impact.horaires.heure_fin_estimee}`;
  }
  if (impact.budget?.bascule_hors_budget) {
    phrase += `. La journée dépasse désormais le temps de travail maximum de ${impact.budget.depassement_min} min.`;
  }
  return phrase;
}

module.exports = {
  chargerPointsTournee,
  estimerProgramme,
  comparer,
  ecart,
  rafraichirEstimationStockee,
  impactApresModification,
  resumerImpact,
};

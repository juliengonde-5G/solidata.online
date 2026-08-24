// ══════════════════════════════════════════════════════════════════════════
// ÉMISSIONS D'UNE TOURNÉE — consommation RÉELLE du véhicule × facteur ADEME
// ══════════════════════════════════════════════════════════════════════════
//
// Le gain d'une ré-optimisation s'exprime en kilomètres et en minutes ; le
// client veut aussi le voir en CO2. Les deux ingrédients existent déjà dans
// l'ERP, on ne fabrique rien :
//   • la consommation L/100 km, MESURÉE plein à plein (module Énergie & GES,
//     table carburant_pleins) — fonction de calcul réutilisée telle quelle,
//     pas réécrite ;
//   • le facteur d'émission du carburant (table ges_facteurs, valeurs ADEME
//     indicatives, paramétrables).
//
// DOCTRINE : moins de deux pleins saisis, ou aucun facteur pour ce carburant
// → `null`. Le gain reste affiché en km et en minutes, et l'écran dit que le
// CO2 n'est pas calculable. Un CO2 estimé sur une consommation « moyenne de
// la profession » serait un chiffre inventé présenté comme une mesure.

const pool = require('../config/database');

/** Repli de dernier recours pour le type de carburant d'un plein non typé. */
const CARBURANT_DEFAUT = 'gazole';
/** Nombre de pleins remontés pour le calcul (les plus récents). */
const NB_PLEINS = 12;

/**
 * Consommation et facteur d'émission d'un véhicule.
 * @param {number} vehicleId
 * @param {object} [deps] injection pour les tests : { pool, computeConso }
 * @returns {Promise<{litresPer100km, kgCo2eParLitre, carburant, source, motif}>}
 */
async function emissionsVehicule(vehicleId, deps = {}) {
  const db = 'pool' in deps ? deps.pool : pool;
  const computeConso = deps.computeConso
    || require('../routes/energie').computeConsommation100km;

  const vide = {
    litresPer100km: null, kgCo2eParLitre: null,
    carburant: null, source: 'indisponible', motif: null,
  };
  // parseInt et non Number : Number(null) vaut 0, un entier valide — le
  // véhicule inconnu passerait alors la garde et déclencherait des requêtes.
  const id = parseInt(vehicleId, 10);
  if (!Number.isInteger(id) || !db) {
    return { ...vide, motif: 'vehicule_inconnu' };
  }

  let pleins = [];
  try {
    const r = await db.query(
      `SELECT litres, km_compteur, type_carburant, date_plein
         FROM carburant_pleins
        WHERE vehicle_id = $1 AND km_compteur IS NOT NULL
        ORDER BY date_plein DESC, km_compteur DESC
        LIMIT $2`,
      [id, NB_PLEINS]
    );
    pleins = r.rows;
  } catch (err) {
    // Base sans le module Énergie : le calcul de tournée continue sans CO2.
    return { ...vide, motif: 'table_carburant_indisponible' };
  }

  const conso = computeConso(pleins);
  if (!conso || !(conso.conso_l_100km > 0)) {
    return { ...vide, motif: 'moins_de_deux_pleins_saisis' };
  }

  const carburant = (pleins.find((p) => p.type_carburant)?.type_carburant || CARBURANT_DEFAUT)
    .toString().trim().toLowerCase();

  let facteur = null;
  try {
    const f = await db.query(
      `SELECT facteur_kgco2e FROM ges_facteurs
        WHERE LOWER(poste) = $1 AND actif = TRUE
        ORDER BY annee DESC LIMIT 1`,
      [carburant]
    );
    if (f.rows.length > 0) facteur = parseFloat(f.rows[0].facteur_kgco2e);
  } catch (_) { /* table absente : facteur inconnu, assumé */ }

  if (!(facteur > 0)) {
    return {
      litresPer100km: conso.conso_l_100km, kgCo2eParLitre: null,
      carburant, source: 'conso_seule', motif: 'facteur_emission_absent',
    };
  }

  return {
    litresPer100km: conso.conso_l_100km,
    kgCo2eParLitre: facteur,
    carburant,
    source: 'mesure',
    motif: null,
  };
}

module.exports = { emissionsVehicule, CARBURANT_DEFAUT, NB_PLEINS };

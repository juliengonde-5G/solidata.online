// ══════════════════════════════════════════════════════════════════════════
// REPRISE D'UNE TOURNÉE TERMINÉE — la mécanique, en un seul endroit
// ──────────────────────────────────────────────────────────────────────────
// Une journée close se corrige parfois : une pesée oubliée au pont-bascule, un
// niveau de remplissage saisi de travers, un nombre de sacs annoncé au jugé.
// Ces corrections ne sont pas des saisies ordinaires — à la clôture, le poids a
// DÉJÀ été réparti en tonnage par point et transformé en entrée de stock. Les
// toucher oblige donc à reconstruire ce qui en dérive, et à dire ce qui n'est
// pas reconstruit.
//
// Ce module ne contient ni route ni état : il est requis à la fois par le
// script de reprise en ligne de commande (`scripts/ajouter-pesee-tournee.js`)
// et par l'écran d'administration (`reprise.js`). C'est la condition pour que
// les deux ne puissent pas diverger — la recopie est précisément ce qui avait
// produit le défaut d'août 2026 sur le calcul du poids (cf. poids.js).
//
// CE QUI EST RECONSTRUIT
//   • `tours.total_weight_kg`  — par la règle unique de poids.js ;
//   • `tonnage_history` / `tonnage_history_association` — par les MÊMES
//     fonctions que la clôture, aucune règle de répartition réécrite ici.
//
// CE QUI NE L'EST PAS, ET POURQUOI
//   L'entrée de stock. Doctrine de la 2.35.0, inchangée : une écriture de stock
//   est un acte comptable, elle se régularise par une écriture DATÉE depuis le
//   module Stock, jamais par une réécriture silencieuse de l'historique. Elle
//   est donc RECENSÉE — le chiffre exact à régulariser est rendu à l'appelant.
// ══════════════════════════════════════════════════════════════════════════

const pool = require('../../config/database');
const { lireTotalPeseTournee } = require('./poids');
const {
  estAssociation, pointsCollectes, ecrireTonnage,
} = require('./completion-effects');

/**
 * L'instant demandé, exprimé en heure de PARIS et converti par PostgreSQL
 * lui-même. `NOW()` traverse exactement la même conversion quand il atterrit
 * dans la colonne `timestamp` de `tour_weights` : une pesée reprise se range
 * donc dans le même repère que celles écrites par les écrans, sans qu'aucun
 * fuseau soit deviné côté Node.
 *
 * Le paramètre porté par ce fragment est TOUJOURS $1 : les requêtes qui
 * l'interpolent numérotent leurs autres paramètres à partir de $2.
 */
const SQL_INSTANT_PARIS = "(($1)::timestamp AT TIME ZONE 'Europe/Paris')";

/** Relecture d'un horodatage stocké, rendue en heure de Paris. */
const SQL_LIRE_HEURE_PARIS = (col) =>
  `to_char(${col} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI')`;

/**
 * Contrôle du format d'un horodatage de reprise. PURE.
 * Renvoie `{ valeur }` normalisé « AAAA-MM-JJ HH:MM », ou `{ error }`.
 *
 * On refuse plutôt que de deviner : une reprise se fait sur une heure qu'on a
 * sous les yeux (le ticket de pesée), jamais sur un défaut inventé.
 */
function lireInstantParis(brut, { champ = 'La date et l\'heure' } = {}) {
  const s = String(brut ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) {
    return { error: `${champ} est attendue au format « AAAA-MM-JJ HH:MM » (heure de Paris).` };
  }
  const [, a, mo, j, h, mi] = m;
  // Contrôle de plage : « 2026-13-45 99:99 » passe la forme, pas le calendrier.
  const d = new Date(Date.UTC(+a, +mo - 1, +j, +h, +mi));
  if (d.getUTCFullYear() !== +a || d.getUTCMonth() !== +mo - 1 || d.getUTCDate() !== +j
      || d.getUTCHours() !== +h || d.getUTCMinutes() !== +mi) {
    return { error: `${champ} ne correspond à aucune date réelle.` };
  }
  return { valeur: `${a}-${mo}-${j} ${h}:${mi}`, jour: `${a}-${mo}-${j}` };
}

/**
 * LES PALIERS DE REMPLISSAGE d'une borne, tels que le chauffeur les voit.
 *
 * Le mobile ne stocke pas un pourcentage libre : il présente sept paliers
 * nommés et en déduit DEUX colonnes — `fill_level` sur l'échelle 0-4 que lit le
 * moteur historique, et `fill_percent`, plus fidèle (« un fond » vaut 10 % et
 * non 0 ; « plein » vaut 100 % et non 80 %, que donnait 4 × 20).
 *
 * Corriger un volume déclaré, c'est donc choisir le palier que le chauffeur
 * aurait dû cocher — jamais taper deux nombres qui pourraient se contredire.
 * Cette table est la référence côté serveur ; un test de garde
 * (`tests/unit/reprise-paliers.test.js`) échoue si elle cesse de correspondre à
 * celle du mobile, pour que les deux ne dérivent pas en silence.
 */
const PALIERS_REMPLISSAGE = Object.freeze([
  { code: 'vide', libelle: 'vide', fill_level: 0, fill_percent: 0 },
  { code: 'fond', libelle: 'un fond', fill_level: 0, fill_percent: 10 },
  { code: 'peu', libelle: 'un peu', fill_level: 1, fill_percent: 25 },
  { code: 'moitie', libelle: 'à moitié', fill_level: 2, fill_percent: 50 },
  { code: 'presque_plein', libelle: 'presque plein', fill_level: 3, fill_percent: 75 },
  { code: 'plein', libelle: 'plein', fill_level: 4, fill_percent: 100 },
  { code: 'au_dela', libelle: 'au-delà (débordement)', fill_level: 4, fill_percent: 110 },
].map(Object.freeze));

/** Palier par son code. `null` si le code n'existe pas — jamais de repli. PURE. */
function lirePalier(code) {
  return PALIERS_REMPLISSAGE.find((p) => p.code === String(code ?? '')) || null;
}

/**
 * Retrouve le palier correspondant à un couple déjà stocké, pour que l'écran
 * puisse présenter la valeur actuelle comme un choix et non comme deux nombres.
 *
 * Le pourcentage prime quand il est renseigné : c'est la valeur fine, et c'est
 * elle qui distingue « un fond » de « vide », ou « au-delà » de « plein » —
 * distinctions que l'échelle 0-4 ne sait pas porter. Sans pourcentage (points
 * saisis avant 2026, ou par un mobile ancien), on retombe sur le premier palier
 * du niveau, et l'appelant sait que la correspondance est approchée. PURE.
 */
function palierDepuisStockage(fillLevel, fillPercent) {
  // `Number(null)` vaut 0, et 0 est un pourcentage PARFAITEMENT valide ici :
  // sans ce filtre, une borne dont le pourcentage n'a jamais été relevé serait
  // présentée comme « vide », avec certitude. Le piège a déjà coûté un point de
  // départ dans le golfe de Guinée (2.42.0) et une tolérance de rendez-vous à
  // zéro minute (2.38.0) — l'absence se teste avant la conversion, jamais après.
  const absent = (v) => v === null || v === undefined || v === '';

  if (!absent(fillPercent)) {
    const pct = Number(fillPercent);
    if (Number.isFinite(pct)) {
      const exact = PALIERS_REMPLISSAGE.find((p) => p.fill_percent === pct);
      if (exact) return { palier: exact, exact: true };
    }
  }
  if (absent(fillLevel)) return { palier: null, exact: false };
  const niv = Number(fillLevel);
  if (!Number.isFinite(niv)) return { palier: null, exact: false };
  const parNiveau = PALIERS_REMPLISSAGE.find((p) => p.fill_level === niv);
  return { palier: parNiveau || null, exact: false };
}

/**
 * Reconstruit le tonnage dérivé d'une tournée depuis ses pesées et ses points.
 *
 * Le total pesé est RELU ici (règle unique de poids.js) plutôt que reçu de
 * l'appelant : une répartition calculée sur un total périmé écrirait dans
 * l'historique d'apprentissage des kilos que plus aucune pesée ne justifie.
 *
 * Idempotent par construction : la répartition de CETTE tournée est effacée
 * avant d'être réécrite — on n'additionne jamais deux répartitions du même
 * poids. Le périmètre de l'effacement est borné à la tournée (associations) ou
 * à sa date ET à ses propres points (bornes, dont l'historique ne porte pas
 * l'identifiant de tournée).
 *
 * LIMITE DITE : faute de `tour_id` sur `tonnage_history`, deux tournées qui
 * passeraient le MÊME JOUR sur la MÊME borne ne sont pas distinguables — la
 * reconstruction de l'une réécrit alors la ligne de l'autre. Le cas ne se
 * présente pas en exploitation (une borne est vidée une fois par jour), et le
 * corriger demanderait une colonne de plus dans l'historique. C'est la raison
 * pour laquelle l'appelant ne reconstruit QUE lorsque la clé de répartition a
 * réellement bougé, et jamais « au cas où ».
 *
 * @returns {Promise<{reconstruit:boolean, motif?:string, lignes?:number,
 *                    points?:number, total_kg?:number}>}
 */
async function reconstruireTonnage(tour, tourId, db = pool) {
  // Une tournée non clôturée n'a AUCUN tonnage écrit : c'est sa clôture qui
  // s'en chargera, avec le poids complet puisqu'il vient d'être corrigé.
  if (tour.status !== 'completed') {
    return { reconstruit: false, motif: 'tournee_non_cloturee' };
  }
  const total = await lireTotalPeseTournee(db, tourId);
  const points = await pointsCollectes(tour, tourId, db);
  const tourAJour = { ...tour, total_weight_kg: total };

  if (estAssociation(tour)) {
    await db.query('DELETE FROM tonnage_history_association WHERE tour_id = $1', [tourId]);
  } else if (points.length > 0) {
    await db.query(
      `DELETE FROM tonnage_history
        WHERE date = $1 AND source = 'mobile' AND cav_id = ANY($2::int[])`,
      [tour.date, points.map((p) => p.point_id)]
    );
  }
  if (points.length === 0) {
    // Plus aucun point collecté : la répartition précédente a été effacée et
    // rien ne la remplace. C'est le résultat juste, il est dit.
    return { reconstruit: true, lignes: 0, points: 0, total_kg: total };
  }
  const lignes = await ecrireTonnage(tourAJour, tourId, points, db);
  return { reconstruit: true, lignes, points: points.length, total_kg: total };
}

/**
 * Écart entre les kilos réellement entrés en stock à la clôture et les kilos
 * pesés après correction. RECENSÉ, jamais réécrit (cf. en-tête du module).
 *
 * Résilient : une table de stock illisible ne doit pas faire échouer une
 * correction de pesée — l'écart est alors déclaré indisponible, et l'absence
 * est NOMMÉE plutôt que rendue comme un zéro rassurant.
 */
async function lireEcartStock(tourId, totalPeseKg, db = pool) {
  let entre = null;
  try {
    const r = await db.query(
      "SELECT COALESCE(SUM(poids_kg), 0)::float AS kg FROM stock_movements WHERE tour_id = $1 AND type = 'entree'",
      [tourId]
    );
    entre = r.rows[0]?.kg ?? 0;
  } catch (err) {
    return { disponible: false, motif: `entrée de stock illisible (${err.message})` };
  }
  const pese = Number(totalPeseKg) || 0;
  return {
    disponible: true,
    entre_kg: Math.round(entre * 100) / 100,
    pese_kg: Math.round(pese * 100) / 100,
    ecart_kg: Math.round((pese - entre) * 100) / 100,
  };
}

module.exports = {
  SQL_INSTANT_PARIS,
  SQL_LIRE_HEURE_PARIS,
  lireInstantParis,
  PALIERS_REMPLISSAGE,
  lirePalier,
  palierDepuisStockage,
  reconstruireTonnage,
  lireEcartStock,
};

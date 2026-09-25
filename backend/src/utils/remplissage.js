/**
 * LE REMPLISSAGE D'UNE BORNE, TEL QUE LE CHAUFFEUR L'A DÉCLARÉ.
 * ═══════════════════════════════════════════════════════════════════════════
 * Ce module porte la table des paliers ET la façon de la relire. Il vivait
 * jusqu'ici dans `routes/tours/reprise-service.js`, qui l'avait introduite pour
 * la reprise d'une tournée close (2.48.0) — mais la même question se pose
 * partout où l'on RESTITUE un passage : dans la fiche d'un point, dans
 * l'historique du chauffeur, dans le compte rendu de tournée.
 *
 * POURQUOI IL A FALLU LE SORTIR DE LÀ (constat client du 10/09/2026) : le
 * chauffeur peut déclarer « au-delà » quand la borne DÉBORDE, et le mobile
 * l'envoie en 110 %. Mais l'échelle historique `fill_level` plafonne à 4 : dans
 * l'historique de collecte, ce passage s'affichait « 4/5 », c'est-à-dire
 * exactement comme une borne pleine. L'information la plus utile de la
 * déclaration — celle qui dit qu'il faut repasser plus tôt — se perdait à
 * l'affichage, alors qu'elle était bien en base.
 *
 * DEUX COLONNES, ET C'EST VOULU : `fill_level` (0-4) nourrit le moteur
 * historique, `fill_percent` est la valeur fine. Le pourcentage PRIME toujours
 * à la lecture : lui seul distingue « un fond » (10 %) de « vide » (0 %), et
 * « au-delà » (110 %) de « plein » (100 %).
 */

/**
 * Les paliers, dans l'ordre où le chauffeur les voit sur son téléphone.
 * Un test de garde (`tests/unit/reprise-service.test.js`) échoue si cette table
 * cesse de correspondre à celle du mobile : les deux ne peuvent pas être
 * fusionnées (le mobile fonctionne hors ligne et n'interroge aucun référentiel),
 * elles ne doivent donc pas dériver en silence.
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

/** Le palier « au-delà » est le seul qui dépasse la borne pleine. */
const SEUIL_DEBORDEMENT = 100;

/** Palier par son code. `null` si le code n'existe pas — jamais de repli. PURE. */
function lirePalier(code) {
  return PALIERS_REMPLISSAGE.find((p) => p.code === String(code ?? '')) || null;
}

/** `null`, `undefined` et `''` sont des ABSENCES ; 0 est une valeur. PURE. */
function absent(v) {
  return v === null || v === undefined || v === '';
}

/**
 * Retrouve le palier correspondant à un couple déjà stocké, pour qu'un écran
 * puisse présenter la valeur actuelle comme un choix et non comme deux nombres.
 *
 * Sans pourcentage (points saisis avant 2026, ou par un mobile ancien), on
 * retombe sur le premier palier du niveau, et l'appelant SAIT que la
 * correspondance est approchée (`exact: false`) — à lui de le dire à l'écran
 * plutôt que de faire passer une approximation pour une déclaration. PURE.
 */
function palierDepuisStockage(fillLevel, fillPercent) {
  // `Number(null)` vaut 0, et 0 est un pourcentage PARFAITEMENT valide ici :
  // sans ce filtre, une borne dont le pourcentage n'a jamais été relevé serait
  // présentée comme « vide », avec certitude. Le piège a déjà coûté un point de
  // départ dans le golfe de Guinée (2.42.0) et une tolérance de rendez-vous à
  // zéro minute (2.38.0) — l'absence se teste avant la conversion, jamais après.
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
 * CE QU'IL FAUT AFFICHER pour un passage déjà enregistré.
 *
 * Rend `null` quand rien n'a été déclaré — « non déclaré » et « vide » sont
 * deux choses différentes, et les confondre inventerait une donnée.
 *
 * @returns {{pourcentage: number, libelle: string, code: string|null,
 *            debordement: boolean, approche: boolean, source: 'pourcentage'|'echelle'}|null}
 *   - `debordement` : la borne a été déclarée AU-DELÀ du plein. C'est
 *     l'information que l'échelle 0-4 ne sait pas porter.
 *   - `approche` : le pourcentage n'était pas enregistré, la valeur est
 *     reconstituée depuis l'échelle — à signaler, jamais à taire.
 * PURE.
 */
function remplissageEffectif(fillLevel, fillPercent) {
  const { palier, exact } = palierDepuisStockage(fillLevel, fillPercent);

  if (!absent(fillPercent)) {
    const pct = Number(fillPercent);
    if (Number.isFinite(pct)) {
      return {
        pourcentage: pct,
        // Un pourcentage hors table (saisi par un import, un capteur, une
        // reprise) garde sa valeur : on ne le rabat pas sur le palier le plus
        // proche, ce serait réécrire une déclaration.
        libelle: exact && palier ? palier.libelle : `${Math.round(pct)} %`,
        code: exact && palier ? palier.code : null,
        debordement: pct > SEUIL_DEBORDEMENT,
        approche: false,
        source: 'pourcentage',
      };
    }
  }

  if (!palier) return null;
  // Repli sur l'échelle : le mobile plafonnant à 4, « plein » y vaut 80 % si on
  // multiplie par 20. On rend donc le pourcentage DU PALIER, en disant qu'il
  // est approché — et le débordement, lui, reste indétectable par cette voie.
  return {
    pourcentage: palier.fill_percent,
    libelle: palier.libelle,
    code: palier.code,
    debordement: false,
    approche: true,
    source: 'echelle',
  };
}

module.exports = {
  PALIERS_REMPLISSAGE,
  SEUIL_DEBORDEMENT,
  lirePalier,
  palierDepuisStockage,
  remplissageEffectif,
};

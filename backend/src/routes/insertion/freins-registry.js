/**
 * Registre UNIQUE des freins périphériques — extension insertion 2026-07 (PR1).
 *
 * Source de vérité des 9 axes de freins du parcours d'insertion. Tous les
 * points qui câblaient les 7 freins historiques en dur (engine.js, routes.js,
 * insertion-ai.js, exports.js, anonymization.js, radar, PDF) doivent basculer
 * sur ce module — un ajout d'axe ne se fait plus qu'ici (+ colonnes init-db.js).
 *
 * Ordre du tableau : les 7 freins HISTORIQUES d'abord (compatibilité du radar
 * existant et des séries déjà stockées), puis les 2 nouveaux axes du CDC
 * (logement, judiciaire).
 *
 * Champs de chaque axe :
 * - key         : clé applicative (suffixe des colonnes SQL frein_<key>)
 * - column      : nom EXACT de la colonne score en base (insertion_diagnostics
 *                 et insertion_milestones) — 'frein_' + key ; le cas
 *                 « financier » du CDC est porté par la colonne existante
 *                 frein_finances (key = 'finances')
 * - label       : libellé français complet (UI)
 * - labelExport : intitulé de colonne du tableau d'export CDC (les 7 freins du
 *                 CDC : linguistique, santé, logement, administratif,
 *                 financier, judiciaire, mobilité) ; null = axe HORS export
 *                 CDC (famille, numérique)
 * - sensible    : catégorie RGPD particulière — 'art9' (santé), 'art10'
 *                 (données judiciaires) ou null. Les axes sensibles imposent
 *                 chiffrement applicatif des textes (utils/field-crypto.js)
 *                 et masquage par rôle.
 * - legacy      : true pour les 7 freins historiques (colonnes présentes
 *                 depuis l'origine du module), false pour les 2 axes ajoutés
 *                 par la PR1.
 */

const FREINS = [
  { key: 'mobilite', column: 'frein_mobilite', label: 'Mobilité', labelExport: 'Frein mobilité', sensible: null, legacy: true },
  { key: 'sante', column: 'frein_sante', label: 'Santé', labelExport: 'Frein santé', sensible: 'art9', legacy: true },
  { key: 'finances', column: 'frein_finances', label: 'Finances', labelExport: 'Frein financier', sensible: null, legacy: true },
  { key: 'famille', column: 'frein_famille', label: 'Famille', labelExport: null, sensible: null, legacy: true },
  { key: 'linguistique', column: 'frein_linguistique', label: 'Linguistique', labelExport: 'Frein linguistique', sensible: null, legacy: true },
  { key: 'administratif', column: 'frein_administratif', label: 'Administratif', labelExport: 'Frein administratif', sensible: null, legacy: true },
  { key: 'numerique', column: 'frein_numerique', label: 'Numérique', labelExport: null, sensible: null, legacy: true },
  { key: 'logement', column: 'frein_logement', label: 'Logement', labelExport: 'Frein logement', sensible: null, legacy: false },
  { key: 'judiciaire', column: 'frein_judiciaire', label: 'Judiciaire', labelExport: 'Frein judiciaire', sensible: 'art10', legacy: false },
];

// Clés des 9 axes, dans l'ordre du registre.
const FREIN_KEYS = FREINS.map((f) => f.key);

/**
 * Colonnes SQL des scores, dans l'ordre du registre.
 * @param {string} prefix préfixe optionnel (ex. 'd.' pour un alias de table)
 * @returns {string[]} ex. ['d.frein_mobilite', 'd.frein_sante', ...]
 */
function freinColumns(prefix = '') {
  return FREINS.map((f) => prefix + f.column);
}

// Les 7 freins du tableau d'export CDC, DANS L'ORDRE DU CDC
// (linguistique, santé, logement, administratif, financier, judiciaire,
// mobilité) — distinct de l'ordre du registre.
const EXPORT_FREIN_KEYS = ['linguistique', 'sante', 'logement', 'administratif', 'finances', 'judiciaire', 'mobilite'];
const EXPORT_FREINS = EXPORT_FREIN_KEYS.map((k) => FREINS.find((f) => f.key === k));

// Labels courts des axes du radar (SVG) — les 7 premiers reprennent à
// L'IDENTIQUE les axes du radar existant (routes.js /milestones/:id/radar :
// 'Mobilite', 'Sante', 'Finances', 'Famille', 'Langue', 'Administratif',
// 'Numerique' — sans accent, comme historiquement rendu), suivis des 2
// nouveaux axes.
const RADAR_AXES = ['Mobilite', 'Sante', 'Finances', 'Famille', 'Langue', 'Administratif', 'Numerique', 'Logement', 'Judiciaire'];

module.exports = {
  FREINS,
  FREIN_KEYS,
  freinColumns,
  EXPORT_FREINS,
  RADAR_AXES,
};

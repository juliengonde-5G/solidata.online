/**
 * Lecture des réglages du module Insertion (extension 2026-07 PR1).
 * Aucune valeur métier en dur dans le code (plan 05 §0.3) : tout passe par la
 * table `settings` (préfixe insertion.*) avec des DÉFAUTS documentés ici.
 *
 * Clés :
 *  - insertion.objectif_sorties_dynamiques : % cible DREETS (existant, géré
 *    par routes.js /objectif-sorties) ;
 *  - insertion.delai_diagnostic_jours      : délai cible du diagnostic
 *    d'accueil après l'embauche (défaut 30 — arbitrage j du rapport 11) ;
 *  - insertion.alerte_pass_iae_mois        : 1er seuil d'alerte avant la fin
 *    du Pass IAE, en mois (défaut 7 ; le 2e seuil est fixé à 2 mois) ;
 *  - insertion.ia_preparation_auto         : génération automatique de la note
 *    de préparation IA à J-7 d'un entretien planifié (défaut 'false').
 */
const pool = require('../config/database');

const INSERTION_SETTING_DEFAULTS = {
  'insertion.delai_diagnostic_jours': 30,
  'insertion.alerte_pass_iae_mois': 7,
  'insertion.ia_preparation_auto': false,
};

/**
 * Lit une clé insertion.* avec son défaut. Résilient : toute erreur (table
 * absente, valeur invalide) retombe sur le défaut.
 * @param {string} key clé complète (ex. 'insertion.delai_diagnostic_jours')
 * @returns {Promise<number|boolean|string|null>}
 */
async function readInsertionSetting(key) {
  const def = INSERTION_SETTING_DEFAULTS[key] ?? null;
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    const v = r.rows[0]?.value;
    if (v == null || v === '') return def;
    if (typeof def === 'number') {
      const n = parseFloat(v);
      return Number.isNaN(n) ? def : n;
    }
    if (typeof def === 'boolean') {
      return ['true', '1', 'oui', 'yes'].includes(String(v).trim().toLowerCase());
    }
    return v;
  } catch (_) {
    return def;
  }
}

module.exports = { readInsertionSetting, INSERTION_SETTING_DEFAULTS };

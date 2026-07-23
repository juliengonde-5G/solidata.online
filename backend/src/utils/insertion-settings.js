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
 *    de préparation IA à J-7 d'un entretien planifié (défaut 'false') ;
 *  - insertion.echeance_action_defaut_jours : échéance proposée par défaut à
 *    la création d'une action CIP, en jours (défaut 14 — REC-UX-18) ;
 *  - insertion.rythme_bilans_mois          : rythme usuel des bilans, en mois —
 *    sert à proposer la date du prochain entretien à la clôture (défaut 2 —
 *    REC-UX-18) ;
 *  - insertion.renouvellement_anticipation_jours : fenêtre d'anticipation des
 *    renouvellements de CDDI (GET /insertion/renouvellements — défaut 42 j =
 *    6 semaines, EXG-04 / PR 2) ;
 *  - insertion.retention_months            : rétention RGPD des dossiers
 *    d'insertion sortis avant anonymisation (défaut 24 mois après la fin du
 *    parcours + dernier contact — référentiel CNIL 2023, EXG-40 / PR 2).
 * Les clés sont exposées au frontend par GET /api/insertion/parametres
 * (à l'exception des clés de purge/scheduler, consommées côté serveur).
 *
 * Cibles conventionnelles (EXG-47/D12, PR 2) — clés insertion.cible_* et
 * insertion.effectif_reference : NULLABLES SANS DÉFAUT (null = « objectif non
 * paramétré », jamais de valeur inventée) ; gérées par GET/PUT
 * /api/insertion/cibles (routes.js), donc absentes du dictionnaire ci-dessous.
 */
const pool = require('../config/database');

const INSERTION_SETTING_DEFAULTS = {
  'insertion.delai_diagnostic_jours': 30,
  'insertion.alerte_pass_iae_mois': 7,
  'insertion.ia_preparation_auto': false,
  'insertion.echeance_action_defaut_jours': 14,
  'insertion.rythme_bilans_mois': 2,
  'insertion.renouvellement_anticipation_jours': 42,
  'insertion.retention_months': 24,
  // Lot 8 (PR3) — durée de la période d'essai en jours (échéance de l'entretien
  // de période d'essai créé à la liaison candidat→collaborateur, EXG-30). Lue
  // côté serveur (conversion.js), non exposée par GET /insertion/parametres.
  'insertion.periode_essai_jours': 30,
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

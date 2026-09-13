/**
 * Compteur d'activité hebdomadaire — accès base (PR B, lot 3).
 *
 * Ce module ne décide de rien : il va chercher les cinq sources dont le moteur
 * pur (`activite-hebdo-engine.js`) a besoin et lui passe la main. Le calcul est
 * ailleurs pour qu'il soit testable sans base — et pour qu'on puisse rejouer le
 * cas d'une personne réelle en changeant une seule ligne du jeu d'essai.
 *
 * RÉSILIENCE ASSUMÉE : chaque source est lue par `soft()`, qui dégrade à liste
 * vide en NOMMANT la panne dans le journal serveur. Une base non migrée ou une
 * table absente ne doit pas empêcher d'ouvrir la fiche d'un salarié — mais la
 * dégradation ne doit pas être silencieuse non plus, sans quoi un compteur faux
 * passerait pour un compteur bas.
 */

'use strict';

const pool = require('../config/database');
const { readInsertionSetting } = require('../utils/insertion-settings');
const { calculerSemaines } = require('./activite-hebdo-engine');

/** Lecture tolérante : une table ou une colonne absente rend [] et le dit. */
async function soft(label, text, params = []) {
  try {
    const r = await pool.query(text, params);
    return r.rows;
  } catch (err) {
    console.error(`[INSERTION][ACTIVITE] « ${label} » ignorée (${err.code || '?'}) : ${err.message}`);
    return [];
  }
}

/**
 * Les trois réglages du compteur, lus avec leurs défauts EN CODE.
 * `consecutives` est borné à [1 ; 12] : une valeur aberrante en base ferait
 * soit sonner l'alerte à la première semaine, soit ne jamais la faire sonner.
 */
async function lireReglages() {
  const [min, max, consec] = await Promise.all([
    readInsertionSetting('insertion.cer_heures_min'),
    readInsertionSetting('insertion.cer_heures_max'),
    readInsertionSetting('insertion.semaines_sous_seuil_consecutives'),
  ]);
  const n = (v, def, bas, haut) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= bas && x <= haut ? x : def;
  };
  return {
    seuilMin: n(min, 15, 1, 48),
    seuilMax: n(max, 20, 1, 48),
    consecutives: Math.round(n(consec, 2, 1, 12)),
  };
}

/**
 * Activité hebdomadaire d'un salarié sur une année civile.
 *
 * @param {object} p
 * @param {number} p.employeeId
 * @param {number} p.annee
 * @returns {Promise<object>} la forme rendue par `calculerSemaines`
 */
async function activiteHebdo({ employeeId, annee }) {
  const an = Number(annee) || new Date().getFullYear();
  const id = Number(employeeId);
  const debut = `${an - 1}-12-01`; // marge : une semaine ISO 1 commence parfois en décembre
  const fin = `${an + 1}-01-31`;

  const reglages = await lireReglages();

  const [weekHours, milestones, actions, pmsmp, leaves] = await Promise.all([
    soft('week_hours',
      `SELECT iso_year, iso_week, hours_worked, hours_contract
         FROM employee_week_hours
        WHERE employee_id = $1 AND iso_year = $2
        ORDER BY iso_week`, [id, an]),
    // Entretiens RÉALISÉS et CHRONOMÉTRÉS. Sans `duree_minutes`, pas de ligne :
    // le moteur écarte les durées absentes plutôt que d'en inventer une.
    soft('entretiens',
      `SELECT completed_date, duree_minutes
         FROM insertion_milestones
        WHERE employee_id = $1 AND status = 'realise'
          AND completed_date BETWEEN $2::date AND $3::date`, [id, debut, fin]),
    soft('actions',
      `SELECT date_realisation, duree_minutes
         FROM cip_action_plans
        WHERE employee_id = $1 AND status = 'realise'
          AND date_realisation BETWEEN $2::date AND $3::date`, [id, debut, fin]),
    soft('pmsmp',
      `SELECT date_debut, date_fin
         FROM insertion_pmsmp
        WHERE employee_id = $1 AND date_fin >= $2::date AND date_debut <= $3::date`, [id, debut, fin]),
    soft('conges',
      `SELECT type_category, start_date, end_date
         FROM employee_leaves
        WHERE employee_id = $1
          AND start_date <= $3::date AND COALESCE(end_date, start_date) >= $2::date`, [id, debut, fin]),
  ]);

  return calculerSemaines({
    annee: an,
    weekHours,
    milestones,
    actions,
    pmsmp,
    leaves,
    ...reglages,
  });
}

module.exports = { activiteHebdo, lireReglages };

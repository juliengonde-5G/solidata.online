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

/**
 * Activité hebdomadaire de TOUTE une cohorte, en un nombre CONSTANT de
 * requêtes (correctif D-07).
 *
 * `activiteHebdo` coûte 3 lectures de réglage + 5 requêtes PAR DOSSIER. Le
 * tableau de bord CIP l'appelait en boucle séquentielle sur la cohorte en
 * parcours : 325 requêtes pour 40 dossiers, mesuré — pour un bloc de quatre
 * lignes. Ici les réglages sont lus UNE fois (ils sont les mêmes pour tout le
 * monde) et chaque source est chargée d'un coup par `= ANY($1::int[])`, puis
 * regroupée en mémoire avant d'appeler le moteur PUR, qui n'a jamais eu besoin
 * que de tableaux.
 *
 * Coût : **8 requêtes au total**, quelle que soit la taille de la cohorte.
 *
 * @param {object} p
 * @param {number[]} p.employeeIds
 * @param {number} p.annee
 * @returns {Promise<Map<number, object>>} identifiant → forme de `calculerSemaines`
 */
async function activiteHebdoCohorte({ employeeIds = [], annee }) {
  const ids = [...new Set((employeeIds || []).map(Number).filter(Number.isFinite))];
  const resultat = new Map();
  if (ids.length === 0) return resultat;

  const an = Number(annee) || new Date().getFullYear();
  const debut = `${an - 1}-12-01`;
  const fin = `${an + 1}-01-31`;

  const reglages = await lireReglages();

  const [weekHours, milestones, actions, pmsmp, leaves] = await Promise.all([
    soft('week_hours_cohorte',
      `SELECT employee_id, iso_year, iso_week, hours_worked, hours_contract
         FROM employee_week_hours
        WHERE employee_id = ANY($1::int[]) AND iso_year = $2
        ORDER BY iso_week`, [ids, an]),
    soft('entretiens_cohorte',
      `SELECT employee_id, completed_date, duree_minutes
         FROM insertion_milestones
        WHERE employee_id = ANY($1::int[]) AND status = 'realise'
          AND completed_date BETWEEN $2::date AND $3::date`, [ids, debut, fin]),
    soft('actions_cohorte',
      `SELECT employee_id, date_realisation, duree_minutes
         FROM cip_action_plans
        WHERE employee_id = ANY($1::int[]) AND status = 'realise'
          AND date_realisation BETWEEN $2::date AND $3::date`, [ids, debut, fin]),
    soft('pmsmp_cohorte',
      `SELECT employee_id, date_debut, date_fin
         FROM insertion_pmsmp
        WHERE employee_id = ANY($1::int[]) AND date_fin >= $2::date AND date_debut <= $3::date`, [ids, debut, fin]),
    soft('conges_cohorte',
      `SELECT employee_id, type_category, start_date, end_date
         FROM employee_leaves
        WHERE employee_id = ANY($1::int[])
          AND start_date <= $3::date AND COALESCE(end_date, start_date) >= $2::date`, [ids, debut, fin]),
  ]);

  // Regroupement par salarié. Un dossier SANS aucune ligne reçoit des tableaux
  // vides et non « pas de résultat » : le moteur doit pouvoir dire « 52 semaines
  // sans relevé », qui n'est pas la même chose qu'une absence de calcul.
  const parSalarie = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = Number(r.employee_id);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };
  const gWeek = parSalarie(weekHours);
  const gMs = parSalarie(milestones);
  const gAct = parSalarie(actions);
  const gPmsmp = parSalarie(pmsmp);
  const gLeaves = parSalarie(leaves);

  for (const id of ids) {
    resultat.set(id, calculerSemaines({
      annee: an,
      weekHours: gWeek.get(id) || [],
      milestones: gMs.get(id) || [],
      actions: gAct.get(id) || [],
      pmsmp: gPmsmp.get(id) || [],
      leaves: gLeaves.get(id) || [],
      ...reglages,
    }));
  }
  return resultat;
}

module.exports = { activiteHebdo, activiteHebdoCohorte, lireReglages };

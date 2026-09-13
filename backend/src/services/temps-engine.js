/**
 * MOTEUR PUR de la feuille de temps d'accompagnement (PR B lot 4, contrat
 * 15 § 6.4). Aucune E/S, aucune dépendance : tout entre par les arguments, tout
 * sort par le retour. C'est ce qui le rend testable sans base, et c'est ce qui
 * permet de le rejouer à l'identique au moment de FIGER la feuille.
 *
 * TROIS RÈGLES QUI NE SE NÉGOCIENT PAS.
 *
 *  1. **Une durée absente n'est pas zéro.** Un entretien réalisé dont la CIP
 *     n'a pas renseigné la durée ne produit AUCUNE ligne. Il serait facile de
 *     lui prêter la durée proposée par défaut pour son type : ce serait
 *     inventer une dépense, et l'autorité écarte une dépense qu'elle ne peut
 *     pas rattacher à un fait constaté (09 § 2 (c)).
 *
 *  2. **Aucune anomalie ne bloque.** Une ligne posée un jour de congé ou un
 *     total supérieur au temps contractuel s'IMPRIMENT (« à expliquer »). Le
 *     contrat est explicite : il n'existe pas de 409 « cohérence non
 *     conforme ». Bloquer la signature transformerait une question en panne,
 *     et la feuille resterait non signée — c'est-à-dire écartée.
 *
 *  3. **Le nom du bénéficiaire n'entre jamais ici.** Les lignes ne portent que
 *     `employee_id`. La version transmise (CSV, PDF) n'a donc rien à masquer :
 *     elle n'a jamais reçu le nom.
 */

'use strict';

/** Code de projet des lignes qui ne se rattachent à aucune opération. */
const HORS_PROJET = 'HORS_PROJET';

/** Activités possibles d'une ligne (composées puis saisies). */
const ACTIVITES = ['entretien', 'action', 'atelier_collectif', 'reunion_projet', 'autre'];

/** Repli de quotité contractuelle quand `weekly_hours` est inconnu (heures). */
const HEURES_HEBDO_DEFAUT = 35;

// ───────────────────────────────────────────────────────────────────────────
// Dates — tout en 'YYYY-MM-DD', jamais d'objet Date qui traînerait un fuseau
// ───────────────────────────────────────────────────────────────────────────

/**
 * Normalise une date (chaîne ISO, Date, timestamp Postgres) en 'YYYY-MM-DD'.
 * Une valeur illisible rend `null` — jamais la date du jour en remplacement.
 */
function jourISO(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Nombre de jours du mois (mois 1-12). */
function joursDuMois(annee, mois) {
  return new Date(Date.UTC(annee, mois, 0)).getUTCDate();
}

/**
 * La date appartient-elle à la période demandée ? `mois` nul vaut « toute
 * l'année » — extension additive documentée, utilisée par l'agrégat annuel
 * (`heuresAccompagnement`) qui compose les lignes des douze mois d'un coup.
 */
function dansPeriode(iso, annee, mois) {
  if (!iso) return false;
  if (String(iso).slice(0, 4) !== String(annee)) return false;
  if (mois == null) return true;
  return Number(iso.slice(5, 7)) === Number(mois);
}

/** Une date tombe-t-elle dans l'intervalle [debut, fin] (fin nulle = ouverte) ? */
function couvre(iso, debut, fin) {
  if (!iso) return false;
  const d = jourISO(debut);
  const f = jourISO(fin);
  if (d && iso < d) return false;
  if (f && iso > f) return false;
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// Rattachement d'une ligne à une opération cofinancée
// ───────────────────────────────────────────────────────────────────────────

/**
 * Projet d'une ligne individuelle (entretien ou action), selon la règle du
 * contrat § 6.4 : opération ASI où LE SALARIÉ est participant actif à cette
 * date, sinon opération OCS où L'INTERVENANT a un poste actif, sinon hors
 * projet. L'ordre compte : c'est la personne accompagnée qui rattache une
 * heure à l'ASI ; l'OCS, lui, finance un POSTE, donc il ne se déduit que de
 * l'affectation de l'intervenant.
 *
 * @param {object} p
 * @param {number|null} p.employeeId salarié concerné (null = aucun)
 * @param {string} p.date 'YYYY-MM-DD'
 * @param {Array} p.participations [{ employee_id, projet_id, projet_code, projet_type, date_entree, date_sortie }]
 * @param {Array} p.postes [{ projet_id, projet_code, projet_type, date_debut, date_fin }] de CET intervenant
 * @returns {{ code: string, projet_id: number|null }}
 */
function projetDeLigne({ employeeId, date, participations = [], postes = [] }) {
  if (employeeId != null) {
    const asi = participations.find((p) => Number(p.employee_id) === Number(employeeId)
      && String(p.projet_type) === 'asi'
      && couvre(date, p.date_entree, p.date_sortie));
    if (asi) return { code: asi.projet_code, projet_id: asi.projet_id != null ? Number(asi.projet_id) : null };
  }
  const ocs = postes.find((p) => String(p.projet_type) === 'ocs' && couvre(date, p.date_debut, p.date_fin));
  if (ocs) return { code: ocs.projet_code, projet_id: ocs.projet_id != null ? Number(ocs.projet_id) : null };
  return { code: HORS_PROJET, projet_id: null };
}

// ───────────────────────────────────────────────────────────────────────────
// Composition des lignes
// ───────────────────────────────────────────────────────────────────────────

/**
 * Compose les lignes de la feuille d'UN intervenant sur une période.
 *
 * @param {object} p
 * @param {number} p.annee
 * @param {number|null} p.mois 1-12, ou null pour l'année entière
 * @param {Array} p.milestones entretiens MENÉS par l'intervenant
 *        [{ id, employee_id, completed_date, duree_minutes, milestone_type }]
 * @param {Array} p.actions actions CIP CRÉÉES par l'intervenant et réalisées
 *        [{ id, employee_id, date_realisation, duree_minutes, action_label, status }]
 * @param {Array} p.saisies [{ id, date, projet_id, activite, duree_minutes, libelle }]
 * @param {Array} p.postes postes de l'intervenant (rattachement OCS + quotité)
 * @param {Array} [p.participations] rattachements ASI des salariés concernés
 * @param {Map|object} [p.projets] projets par id (pour le code des saisies)
 * @returns {Array} lignes triées par date puis par origine
 */
function composerLignes({ annee, mois = null, milestones = [], actions = [], saisies = [], postes = [], participations = [], projets = null } = {}) {
  const an = Number(annee);
  const mo = mois == null || mois === '' ? null : Number(mois);
  const codeProjet = (id) => {
    if (id == null) return HORS_PROJET;
    const p = projets instanceof Map ? projets.get(Number(id)) : (projets ? projets[id] : null);
    return p && p.code ? p.code : HORS_PROJET;
  };

  const lignes = [];

  // (1) Entretiens réalisés. `duree_minutes` non nul et > 0 : sans durée, pas
  // de ligne (règle 1 de l'en-tête). Une durée de 0 minute déclarée n'est pas
  // davantage un temps d'accompagnement.
  for (const m of milestones) {
    const date = jourISO(m.completed_date);
    const duree = m.duree_minutes == null ? null : Number(m.duree_minutes);
    if (!date || !dansPeriode(date, an, mo)) continue;
    if (duree == null || !Number.isFinite(duree) || duree <= 0) continue;
    const employeeId = m.employee_id == null ? null : Number(m.employee_id);
    const { code, projet_id } = projetDeLigne({ employeeId, date, participations, postes });
    lignes.push({
      date, projet_code: code, projet_id, activite: 'entretien',
      employee_id: employeeId, duree_minutes: duree,
      origine: 'composee', source: 'milestone', source_id: m.id == null ? null : Number(m.id),
      libelle: m.milestone_type || null,
    });
  }

  // (2) Actions CIP réalisées. Même règle de durée ; `date_realisation` fait
  // foi (pas `updated_at` : une action corrigée en octobre reste une action
  // réalisée en septembre, et la dépense appartient à septembre).
  for (const a of actions) {
    const date = jourISO(a.date_realisation);
    const duree = a.duree_minutes == null ? null : Number(a.duree_minutes);
    if (!date || !dansPeriode(date, an, mo)) continue;
    if (duree == null || !Number.isFinite(duree) || duree <= 0) continue;
    if (a.status != null && String(a.status) !== 'realise') continue;
    const employeeId = a.employee_id == null ? null : Number(a.employee_id);
    const { code, projet_id } = projetDeLigne({ employeeId, date, participations, postes });
    lignes.push({
      date, projet_code: code, projet_id, activite: 'action',
      employee_id: employeeId, duree_minutes: duree,
      origine: 'composee', source: 'action', source_id: a.id == null ? null : Number(a.id),
      libelle: a.action_label || null,
    });
  }

  // (3) Saisies manuelles : telles quelles. Le projet y est EXPLICITE (c'est
  // l'intervenant qui déclare à quelle opération son atelier se rattache) —
  // rien à déduire.
  for (const s of saisies) {
    const date = jourISO(s.date);
    const duree = s.duree_minutes == null ? null : Number(s.duree_minutes);
    if (!date || !dansPeriode(date, an, mo)) continue;
    if (duree == null || !Number.isFinite(duree) || duree <= 0) continue;
    lignes.push({
      date, projet_code: codeProjet(s.projet_id), projet_id: s.projet_id == null ? null : Number(s.projet_id),
      activite: ACTIVITES.includes(String(s.activite)) ? String(s.activite) : 'autre',
      employee_id: null, duree_minutes: duree,
      origine: 'saisie', source: 'saisie', source_id: s.id == null ? null : Number(s.id),
      libelle: s.libelle || null,
    });
  }

  lignes.sort((a, b) => (a.date === b.date
    ? (a.origine === b.origine ? (a.source_id || 0) - (b.source_id || 0) : (a.origine === 'composee' ? -1 : 1))
    : (a.date < b.date ? -1 : 1)));
  return lignes;
}

// ───────────────────────────────────────────────────────────────────────────
// Totaux
// ───────────────────────────────────────────────────────────────────────────

/**
 * Totaux de la feuille : minutes globales, par projet, et — pour chaque projet
 * concerné — la QUOTITÉ d'affectation du poste et le TAUX FORFAITAIRE de
 * l'opération (amendement F2 de l'autorité : sans ces deux nombres, la feuille
 * ne se raccorde à aucun plan de financement, 09 § 4.2).
 *
 * Une quotité ou un taux inconnus sont ABSENTS de l'objet (jamais 0) : la
 * feuille imprime alors « non renseignée », ce qui est une information de
 * gestion — un 0 % se lirait « poste non financé ».
 *
 * @param {Array} lignes
 * @param {Array} postes [{ projet_id, projet_code, quotite_pct }]
 * @param {Array|Map} projets [{ id, code, taux_forfaitaire_pct }]
 */
function calculerTotaux(lignes = [], postes = [], projets = []) {
  const parProjet = {};
  let total = 0;
  for (const l of lignes) {
    const d = Number(l.duree_minutes) || 0;
    total += d;
    const c = l.projet_code || HORS_PROJET;
    parProjet[c] = (parProjet[c] || 0) + d;
  }

  const quotites = {};
  for (const p of postes || []) {
    const code = p.projet_code;
    const q = p.quotite_pct == null ? null : Number(p.quotite_pct);
    if (code && q != null && Number.isFinite(q)) quotites[code] = q;
  }

  const liste = projets instanceof Map ? Array.from(projets.values()) : (projets || []);
  const tauxForfaitaire = {};
  for (const p of liste) {
    const t = p && p.taux_forfaitaire_pct == null ? null : Number(p.taux_forfaitaire_pct);
    if (p && p.code && t != null && Number.isFinite(t)) tauxForfaitaire[p.code] = t;
  }

  return { total_minutes: total, par_projet: parProjet, quotites, taux_forfaitaire: tauxForfaitaire };
}

// ───────────────────────────────────────────────────────────────────────────
// Cohérence
// ───────────────────────────────────────────────────────────────────────────

/**
 * Ligne « Cohérence avec les congés » de l'export (c) — c'est l'une des quatre
 * raisons qui font écarter une dépense (09 § 2 (c)).
 *
 * Deux familles d'anomalies, et deux seulement :
 *  - `jour_absence`             : une ligne tombe un jour couvert par un congé
 *                                 de L'INTERVENANT (TOUTES catégories : un jour
 *                                 de congés payés est aussi peu travaillé qu'un
 *                                 arrêt) ;
 *  - `depassement_contractuel`  : le total du mois dépasse le temps de travail
 *                                 contractuel de l'intervenant.
 *
 * La base du plafond est dite dans l'anomalie, y compris quand elle repose sur
 * le repli de 35 h : un lecteur doit pouvoir refaire le calcul. Le nombre de
 * semaines du mois est pris au prorata des jours (30 j → 4,29 semaines) plutôt
 * qu'en semaines ISO : le plafond porte sur un MOIS de paie, pas sur un
 * découpage hebdomadaire.
 *
 * @param {object} p
 * @param {Array} p.lignes
 * @param {Array} p.leaves congés de l'intervenant [{ type_category, leave_type, start_date, end_date }]
 * @param {number|null} p.weeklyHours quotité contractuelle hebdomadaire
 * @param {number} p.annee
 * @param {number|null} p.mois
 */
function verifierCoherence({ lignes = [], leaves = [], weeklyHours = null, annee = null, mois = null } = {}) {
  const anomalies = [];

  // (a) Jours d'absence. Le MOTIF n'est jamais repris : `type_category` suffit
  // à dire « ce jour-là l'intervenant était absent », et un libellé de congé
  // peut porter une information de santé.
  const absences = (leaves || []).map((l) => ({
    categorie: l.type_category || null,
    debut: jourISO(l.start_date || l.start),
    fin: jourISO(l.end_date || l.end || l.start_date || l.start),
  })).filter((l) => l.debut);

  const dejaSignales = new Set();
  for (const l of lignes) {
    const abs = absences.find((a) => l.date >= a.debut && l.date <= (a.fin || a.debut));
    if (!abs || dejaSignales.has(l.date)) continue;
    dejaSignales.add(l.date);
    anomalies.push({
      date: l.date,
      type: 'jour_absence',
      detail: `Temps déclaré un jour d'absence de l'intervenant (${LIBELLES_ABSENCE[abs.categorie] || 'absence déclarée'}).`,
    });
  }

  // (b) Dépassement du temps contractuel.
  const total = lignes.reduce((s, l) => s + (Number(l.duree_minutes) || 0), 0);
  const h = Number(weeklyHours);
  const heuresHebdo = Number.isFinite(h) && h > 0 ? h : HEURES_HEBDO_DEFAUT;
  const replisDefaut = !(Number.isFinite(h) && h > 0);
  if (annee != null) {
    const nbJours = mois == null
      ? (joursDuMois(Number(annee), 2) === 29 ? 366 : 365)
      : joursDuMois(Number(annee), Number(mois));
    const nbSemaines = nbJours / 7;
    const plafondMinutes = heuresHebdo * nbSemaines * 60;
    if (total > plafondMinutes) {
      anomalies.push({
        date: null,
        type: 'depassement_contractuel',
        detail: `Total de ${arrondi1(total / 60)} h pour un maximum contractuel estimé à ${arrondi1(plafondMinutes / 60)} h `
          + `(${arrondi1(heuresHebdo)} h par semaine × ${arrondi2(nbSemaines)} semaines`
          + `${replisDefaut ? ' — quotité contractuelle inconnue, 35 h retenues par défaut' : ''}).`,
      });
    }
  }

  return { conforme: anomalies.length === 0, anomalies };
}

/** Catégories de congé, en clair et SANS jamais reprendre le libellé de paie. */
const LIBELLES_ABSENCE = {
  holiday: 'congés payés', sick: 'arrêt de travail', absence: 'absence',
};

const arrondi1 = (x) => Math.round(x * 10) / 10;
const arrondi2 = (x) => Math.round(x * 100) / 100;

module.exports = {
  HORS_PROJET, ACTIVITES, HEURES_HEBDO_DEFAUT, LIBELLES_ABSENCE,
  jourISO, joursDuMois, dansPeriode, couvre, projetDeLigne,
  composerLignes, calculerTotaux, verifierCoherence,
};

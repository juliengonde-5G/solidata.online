/**
 * Règles PMSMP (EXG-05, PR 2) — bornes réglementaires des Périodes de Mise en
 * Situation en Milieu Professionnel (L.5135-1 s., convention ACI art. 3.3).
 *
 * Deux contrôles applicatifs :
 *  1. Durée d'une convention : ≤ 31 jours calendaires (« 1 mois maximum par
 *     convention ») → 409 `pmsmp_duree`, non forçable.
 *  2. Cumul sur 12 mois glissants : ≤ 60 jours → 409 `pmsmp_cumul`,
 *     FORÇABLE ({ force: true } + motif_depassement obligatoire, tracé).
 *
 * Assiette du cumul (réserve auditeur RES-07, arbitrage PR 2) : la
 * réglementation apprécie le plafond de 60 j pour un même bénéficiaire chez un
 * même organisme d'accueil ; l'ERP applique un contrôle PRUDENT toutes
 * entreprises confondues (somme des PMSMP enregistrées + `autres_jours_connus`
 * saisis pour les périodes réalisées hors de la structure / avant l'embauche,
 * inconnues de l'ERP). Un dépassement licite (immersions chez des organismes
 * différents) reste enregistrable via force + motif — le contrôle alerte, il
 * n'interdit pas un parcours conforme. Règle sourcée : Q/R DGEFP PMSMP.
 *
 * Module PUR (aucune dépendance DB) — testé unitairement.
 */

const PMSMP_MAX_JOURS_CONVENTION = 31; // 1 mois max par convention (L.5135-1 s.)
const PMSMP_MAX_CUMUL_12M = 60; // 60 jours sur 12 mois glissants
const PMSMP_FENETRE_MOIS = 12;

const DAY_MS = 86400000;

function toUtcDate(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  // Normalise à minuit UTC (les dates arrivent en 'YYYY-MM-DD').
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Nombre de jours calendaires INCLUSIFS d'une période (déb. = fin → 1 jour).
 * @returns {number|null} null si dates inexploitables ou fin < début
 */
function pmsmpDays(dateDebut, dateFin) {
  const a = toUtcDate(dateDebut);
  const b = toUtcDate(dateFin);
  if (!a || !b || b < a) return null;
  return Math.round((b - a) / DAY_MS) + 1;
}

/**
 * Recul de N mois avec BORNAGE de fin de mois (évite la normalisation JS des
 * quantièmes invalides : Date.UTC(2024, -11, 30) déborderait en 2023-03-02).
 * Ex. 2024-02-29 − 12 mois → 2023-02-28 (et non une date de mars).
 */
function subtractMonthsClamped(date, months) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  // Dernier jour du mois cible (jour 0 du mois suivant le mois cible).
  const lastDayTarget = new Date(Date.UTC(y, m - months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - months, Math.min(d, lastDayTarget)));
}

/** Jours d'intersection INCLUSIFS entre [debut, fin] et [du, au] (0 si disjoints). */
function overlapDays(debut, fin, du, au) {
  const s = Math.max(debut.getTime(), du.getTime());
  const e = Math.min(fin.getTime(), au.getTime());
  if (e < s) return 0;
  return Math.round((e - s) / DAY_MS) + 1;
}

/**
 * Cumul de jours PMSMP sur la fenêtre de 12 mois glissants se terminant à la
 * fin de la période de référence.
 *
 * @param {{date_debut:string|Date, date_fin:string|Date}} nouvelle  période contrôlée
 *   (comptée intégralement dans la fenêtre, bornée par intersection)
 * @param {Array<{date_debut:string|Date, date_fin:string|Date}>} existantes
 *   PMSMP déjà enregistrées (la période en cours d'édition doit en être exclue
 *   par l'appelant) — seuls les jours tombant dans la fenêtre comptent
 * @param {number} [autresJoursConnus=0]  jours déclarés hors ERP (autres
 *   employeurs / avant l'embauche — réserve auditeur)
 * @returns {{ fenetre_du:string, fenetre_au:string, jours_nouvelle:number,
 *             jours_enregistres:number, autres_jours_connus:number,
 *             total:number, plafond:number, depassement:boolean }|null}
 *   null si la période de référence est inexploitable
 */
function computeCumul12MoisGlissants(nouvelle, existantes = [], autresJoursConnus = 0) {
  const nd = toUtcDate(nouvelle && nouvelle.date_debut);
  const nf = toUtcDate(nouvelle && nouvelle.date_fin);
  if (!nd || !nf || nf < nd) return null;

  // Fenêtre glissante : les 12 mois se terminant à la fin de la période
  // contrôlée. Recul de 12 mois AVEC bornage de fin de mois PUIS +1 jour (fenêtre
  // inclusive de 12 mois exactement) — corrige la dérive du 29/02 qui excluait à
  // tort un jour de la fenêtre (revue Codex PR#74).
  const du = new Date(subtractMonthsClamped(nf, PMSMP_FENETRE_MOIS).getTime() + DAY_MS);
  const au = nf;

  const joursNouvelle = overlapDays(nd, nf, du, au);
  let joursEnregistres = 0;
  for (const p of existantes || []) {
    const d = toUtcDate(p && p.date_debut);
    const f = toUtcDate(p && p.date_fin);
    if (!d || !f || f < d) continue;
    joursEnregistres += overlapDays(d, f, du, au);
  }
  const autres = Number.isFinite(Number(autresJoursConnus)) && Number(autresJoursConnus) > 0
    ? Math.round(Number(autresJoursConnus)) : 0;

  const total = joursNouvelle + joursEnregistres + autres;
  return {
    fenetre_du: du.toISOString().slice(0, 10),
    fenetre_au: au.toISOString().slice(0, 10),
    jours_nouvelle: joursNouvelle,
    jours_enregistres: joursEnregistres,
    autres_jours_connus: autres,
    total,
    plafond: PMSMP_MAX_CUMUL_12M,
    depassement: total > PMSMP_MAX_CUMUL_12M,
  };
}

module.exports = {
  PMSMP_MAX_JOURS_CONVENTION,
  PMSMP_MAX_CUMUL_12M,
  pmsmpDays,
  computeCumul12MoisGlissants,
};

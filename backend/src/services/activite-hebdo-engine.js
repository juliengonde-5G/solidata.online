/**
 * Compteur d'activité hebdomadaire — MOTEUR PUR (PR B, lot 3).
 *
 * Le cadre du RSA rénové attend d'un bénéficiaire 15 à 20 heures d'activité
 * hebdomadaire, et la direction a tranché (décision 4 du plan 07) : **le temps
 * de travail en CDDI compte**. Un salarié à 26 h de contrat est donc au-dessus
 * du plancher par le seul fait de travailler — ce compteur n'est pas là pour le
 * surveiller, il est là pour que la structure d'accueil puisse RÉPONDRE au
 * référent quand celui-ci demande « combien d'heures cette personne fait-elle ? »
 * sans que la CIP ait à recompter à la main.
 *
 * ═══ TROIS RÈGLES QU'ON NE TRANSGRESSE PAS ════════════════════════════════
 *
 * 1. UNE SEMAINE SANS RELEVÉ N'EST PAS UNE SEMAINE À ZÉRO HEURE.
 *    `employee_week_hours` vient de l'import de paie : tant que le mois n'est
 *    pas importé, la ligne n'existe pas. Compter 0 h ferait apparaître, chaque
 *    début de mois, des « semaines sous le minimum » qui ne sont que des
 *    semaines non encore saisies — et ce faux constat partirait vers le
 *    référent, où il peut fonder une suspension de droits. D'où
 *    `sans_releve: true`, `heures_travail: null`, `total_heures: null`,
 *    `sous_seuil: null` (et non `false` : on ne prétend pas davantage que la
 *    semaine était au-dessus).
 *
 * 2. L'ALERTE NE SE DÉCLENCHE JAMAIS PENDANT UN ARRÊT DÉCLARÉ.
 *    Une personne en arrêt maladie ne travaille pas : c'est une constatation,
 *    pas un manquement. L'alerte exige `consecutives` semaines consécutives
 *    RELEVÉES, sous le minimum, dont AUCUNE ne porte d'arrêt déclaré.
 *
 * 3. L'INDICATEUR N'EST PAS UNE MOYENNE, C'EST UN NOMBRE DE SEMAINES.
 *    Une moyenne annuelle noie un mois entier passé sous le minimum dans onze
 *    mois au-dessus : elle dit « tout va bien » précisément quand il faut
 *    regarder. `nb_semaines_sous_seuil` compte toutes les semaines sous le
 *    minimum — arrêts COMPRIS, contrairement à l'alerte : l'autorité demande
 *    un volume d'activité constaté (amendement A4), pas un jugement.
 *
 * Aucun accès base, aucune E/S : tout est injecté. Les semaines ISO sont à
 * pivot jeudi, via `services/effectifs-engine.js` (source unique du dépôt —
 * une seconde définition de la semaine ISO finirait par diverger de la
 * première, et deux écrans donneraient deux comptes différents).
 */

'use strict';

const { isoWeeksOfYear, addDaysISO, round2 } = require('./effectifs-engine');

/** Catégories de congé qui valent « arrêt déclaré » (mêmes que effectifs-engine). */
const CATEGORIES_ARRET = ['sick', 'absence'];

/** Normalise une date (Date | 'AAAA-MM-JJ' | ISO complet) en 'AAAA-MM-JJ', sinon null. */
function jour(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * Nombre `null` si la valeur est absente — JAMAIS 0.
 * `Number(null) === 0` est le piège qui a déjà produit un point de départ dans
 * le golfe de Guinée (2.42.0) et une tolérance de rendez-vous à zéro minute
 * (2.38.0) ; ici il transformerait « pas de relevé » en « zéro heure ».
 */
function nombreOuNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Intersection non vide de [aDeb, aFin] et [bDeb, bFin] (dates ISO, bornes incluses). */
function serecoupent(aDeb, aFin, bDeb, bFin) {
  if (!aDeb || !bDeb) return false;
  const af = aFin || aDeb;
  const bf = bFin || bDeb;
  return aDeb <= bf && bDeb <= af;
}

/** Jours ouvrés (lundi→vendredi) d'une semaine couverts par une période. */
function joursOuvresCouverts(lundi, debut, fin) {
  if (!debut) return 0;
  const f = fin || debut;
  let n = 0;
  for (let i = 0; i < 5; i += 1) {
    const j = addDaysISO(lundi, i);
    if (j >= debut && j <= f) n += 1;
  }
  return n;
}

/**
 * Compose les semaines d'activité d'une année.
 *
 * @param {object} p
 * @param {number} p.annee année civile (les semaines ISO sont celles dont le
 *   jeudi tombe dans l'année — 52 ou 53 semaines)
 * @param {Array}  p.weekHours  [{ iso_year, iso_week, hours_worked, hours_contract }]
 * @param {Array}  p.milestones [{ completed_date, duree_minutes }] entretiens RÉALISÉS
 * @param {Array}  p.actions    [{ date_realisation, duree_minutes }] actions RÉALISÉES
 * @param {Array}  p.pmsmp      [{ date_debut, date_fin }]
 * @param {Array}  p.leaves     [{ type_category, start_date, end_date }]
 * @param {number} p.seuilMin   plancher hebdomadaire, en heures (défaut 15)
 * @param {number} p.seuilMax   plafond informatif (défaut 20 — jamais une alerte)
 * @param {number} p.consecutives semaines consécutives sous le plancher qui déclenchent l'alerte (défaut 2)
 * @returns {{ annee, seuil_min, seuil_max, semaines, nb_semaines_sous_seuil,
 *   nb_semaines_relevees, alerte, raisons }}
 */
function calculerSemaines({
  annee,
  weekHours = [],
  milestones = [],
  actions = [],
  pmsmp = [],
  leaves = [],
  seuilMin = 15,
  seuilMax = 20,
  consecutives = 2,
} = {}) {
  const an = Number(annee);
  const min = Number.isFinite(Number(seuilMin)) ? Number(seuilMin) : 15;
  const max = Number.isFinite(Number(seuilMax)) ? Number(seuilMax) : 20;
  // Une valeur illisible ou < 1 retomberait sur « alerte dès la première
  // semaine », c'est-à-dire l'inverse de la prudence voulue.
  const consec = Math.max(1, Math.round(Number(consecutives) || 2));

  if (!Number.isFinite(an)) {
    return {
      annee: null, seuil_min: min, seuil_max: max, semaines: [],
      nb_semaines_sous_seuil: 0, nb_semaines_relevees: 0,
      alerte: { active: false, depuis_semaine: null }, raisons: [],
    };
  }

  // Index des relevés de paie par numéro de semaine ISO de l'année demandée.
  const parSemaine = new Map();
  for (const w of weekHours || []) {
    if (!w) continue;
    if (Number(w.iso_year) !== an) continue;
    const num = Number(w.iso_week);
    if (!Number.isFinite(num)) continue;
    parSemaine.set(num, w);
  }

  // Périodes normalisées, calculées UNE fois (elles sont relues à chaque semaine).
  const congesNorm = (leaves || []).map((l) => ({
    categorie: l && l.type_category ? String(l.type_category) : null,
    debut: jour(l && (l.start_date ?? l.start)),
    fin: jour(l && (l.end_date ?? l.end)),
  })).filter((l) => l.debut);

  const pmsmpNorm = (pmsmp || []).map((p) => ({
    debut: jour(p && (p.date_debut ?? p.debut)),
    fin: jour(p && (p.date_fin ?? p.fin)),
  })).filter((p) => p.debut);

  const entretiensNorm = (milestones || []).map((m) => ({
    date: jour(m && (m.completed_date ?? m.date)),
    minutes: nombreOuNull(m && m.duree_minutes),
  })).filter((m) => m.date && m.minutes != null && m.minutes > 0);

  const actionsNorm = (actions || []).map((a) => ({
    date: jour(a && (a.date_realisation ?? a.date)),
    minutes: nombreOuNull(a && a.duree_minutes),
  })).filter((a) => a.date && a.minutes != null && a.minutes > 0);

  const semaines = [];
  const raisons = [];

  for (const w of isoWeeksOfYear(an)) {
    const lundi = w.lundi;
    const dimanche = addDaysISO(lundi, 6);
    const vendredi = addDaysISO(lundi, 4);

    const releve = parSemaine.get(w.num);
    const heuresTravail = releve ? nombreOuNull(releve.hours_worked) : null;
    const heuresContrat = releve ? nombreOuNull(releve.hours_contract) : null;
    const sansReleve = heuresTravail == null;

    // Accompagnement : entretiens et actions RÉALISÉS dans la semaine civile.
    // Une durée absente ne produit pas de ligne (filtrée plus haut) : on ne
    // devine pas combien de temps a duré un entretien qu'on n'a pas chronométré.
    let minutesAccompagnement = 0;
    for (const e of entretiensNorm) if (e.date >= lundi && e.date <= dimanche) minutesAccompagnement += e.minutes;
    for (const a of actionsNorm) if (a.date >= lundi && a.date <= dimanche) minutesAccompagnement += a.minutes;

    // Immersion : jours OUVRÉS de la semaine couverts par une PMSMP. Le
    // recouvrement de deux conventions ne peut pas donner plus de 5 jours.
    let joursPmsmp = 0;
    for (const p of pmsmpNorm) joursPmsmp = Math.max(joursPmsmp, joursOuvresCouverts(lundi, p.debut, p.fin));

    // Arrêt déclaré : au moins un jour ouvré couvert par un arrêt maladie ou
    // une absence. Les congés payés (`holiday`) n'en sont pas : une personne en
    // congés n'est pas empêchée, elle est en congés — mais son activité est
    // légitimement basse, d'où leur présence dans les RAISONS ci-dessous.
    let arretDeclare = false;
    let congeHoliday = false;
    for (const c of congesNorm) {
      if (!serecoupent(lundi, vendredi, c.debut, c.fin)) continue;
      if (CATEGORIES_ARRET.includes(c.categorie)) arretDeclare = true;
      else if (c.categorie === 'holiday') congeHoliday = true;
    }

    const totalHeures = sansReleve ? null : round2(heuresTravail + minutesAccompagnement / 60);
    const sousSeuil = totalHeures == null ? null : totalHeures < min;

    const ligne = {
      iso_year: an,
      iso_week: w.num,
      week_start: lundi,
      heures_travail: heuresTravail,
      minutes_accompagnement: minutesAccompagnement,
      jours_pmsmp: joursPmsmp,
      total_heures: totalHeures,
      sous_seuil: sousSeuil,
      arret_declare: arretDeclare,
      sans_releve: sansReleve,
    };
    semaines.push(ligne);

    if (sousSeuil === true) {
      // Catégorie de la raison, dans cet ordre : l'arrêt prime sur tout (il
      // explique à lui seul), puis le temps partiel contractuel (le contrat
      // lui-même est sous le plancher — ce n'est pas un comportement mais une
      // quotité), puis les congés, puis « inconnue ». Jamais de motif inventé :
      // « inconnue » est dit tel quel, c'est à la CIP d'aller voir.
      let categorie = 'inconnue';
      if (arretDeclare) categorie = 'arret';
      else if (heuresContrat != null && heuresContrat < min) categorie = 'temps_partiel';
      else if (congeHoliday) categorie = 'absence';
      // `iso_year` accompagne la semaine (correctif m-01) : la fiche pour le
      // référent concatène les raisons de DEUX années civiles quand la période
      // est à cheval, et un appariement sur le seul numéro de semaine recopiait
      // la raison de la S3 2025 sur la S3 2026.
      raisons.push({ iso_year: an, iso_week: w.num, categorie });
    }
  }

  const nbSousSeuil = semaines.filter((s) => s.sous_seuil === true).length;
  const nbRelevees = semaines.filter((s) => !s.sans_releve).length;

  return {
    annee: an,
    seuil_min: min,
    seuil_max: max,
    semaines,
    nb_semaines_sous_seuil: nbSousSeuil,
    nb_semaines_relevees: nbRelevees,
    alerte: calculerAlerte(semaines, consec),
    raisons,
  };
}

/**
 * Alerte : `consecutives` semaines CONSÉCUTIVES relevées, sous le minimum et
 * SANS arrêt déclaré. La série est cherchée dans l'ordre chronologique et c'est
 * la PLUS RÉCENTE qui est retenue (`depuis_semaine` = sa première semaine) :
 * ce qu'on veut savoir, c'est si la situation est en cours, pas qu'elle a eu
 * lieu une fois en février.
 *
 * Une semaine sans relevé INTERROMPT la série au lieu de la prolonger : sinon
 * un mois de paie non encore importé fabriquerait une alerte de toutes pièces.
 */
function calculerAlerte(semaines, consecutives) {
  let courante = 0;
  let debutSerie = null;
  let resultat = { active: false, depuis_semaine: null };
  for (const s of semaines) {
    const compte = s.sous_seuil === true && s.arret_declare !== true && s.sans_releve !== true;
    if (compte) {
      courante += 1;
      if (courante === 1) debutSerie = s.iso_week;
      if (courante >= consecutives) resultat = { active: true, depuis_semaine: debutSerie };
    } else {
      courante = 0;
      debutSerie = null;
    }
  }
  return resultat;
}

module.exports = {
  calculerSemaines,
  calculerAlerte,
  joursOuvresCouverts,
  CATEGORIES_ARRET,
};

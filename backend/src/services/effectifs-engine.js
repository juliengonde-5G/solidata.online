/**
 * Moteur de calcul « Effectifs conventionnés (ETP) » — fonctions PURES.
 *
 * Suivi prévisionnel / réalisé des ETP d'insertion vs convention ACI (annexe
 * financière). Toutes les fonctions de ce module sont pures (aucun accès DB,
 * aucune horloge implicite : « aujourd'hui » est toujours passé en paramètre)
 * pour être testables unitairement — le câblage SQL vit dans routes/effectifs.js.
 *
 * RÈGLES MÉTIER (validées client) :
 *  1. Grille hebdomadaire S1→S52/53 (semaines ISO de l'année). Une semaine ISO
 *     appartient à l'année de son JEUDI (définition ISO-8601) et est rattachée
 *     au MOIS de ce même jeudi (pivot : une semaine à cheval sur deux mois est
 *     comptée dans le mois où tombe son jeudi). Quotité de la semaine = celle
 *     du contrat EFFECTIF couvrant le jeudi de la semaine.
 *  2. Quotité = heures hebdo contractuelles / 35, arrondie à 2 décimales
 *     (26 h → 0.74 ; 35 h → 1). Aucun plafonnement (un 39 h afficherait 1.11 —
 *     cas théorique, les CDDI sont ≤ 35 h).
 *  3. PRÉVISIONNEL = contrats signés (périodes effectives chaînées
 *     d'employee_contracts, lot 3) + RENOUVELLEMENT PRÉSUMÉ : après la fin du
 *     dernier contrat signé, si le salarié est `en_parcours` sans sortie actée,
 *     prolongation à la même quotité jusqu'à la borne
 *     min(pass_iae_end ; début du 1er CDDI + 24 mois − 1 jour). Si les deux
 *     bornes sont connues on prend la plus proche (min) ; si une seule est
 *     connue on la prend ; si aucune → pas de présomption (jamais de valeur
 *     inventée). Un contrat sans date de fin (CDI Inclusion en cours) couvre
 *     indéfiniment en 'signe' → aucune présomption.
 *  4. RÉALISÉ (semaines entièrement passées, contrats SIGNÉS uniquement) =
 *     quotité prévisionnelle × (1 − jours_ouvrés_absents / 5). Absences =
 *     employee_leaves type_category IN ('sick','absence') — les congés payés
 *     ('holiday') ne déduisent PAS. Jours ouvrés lun→ven, intersection
 *     période × semaine, total plafonné à 5 j/semaine, résultat clippé
 *     [0, quotité], arrondi 2 décimales.
 *  5. ETP mensuel = MOYENNE des sommes hebdomadaires des semaines rattachées
 *     au mois. NB : sommer par semaine puis moyenner ≡ moyenner par personne
 *     puis sommer, dès lors qu'une personne non couverte une semaine compte 0
 *     dans la somme de cette semaine (linéarité de la moyenne).
 *
 * Toutes les dates manipulées sont des chaînes ISO 'YYYY-MM-DD' (comparables
 * lexicographiquement) ; l'interne travaille en UTC pour éviter tout effet DST.
 */

const MS_DAY = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' (ou Date) → Date UTC minuit. null si invalide. */
function parseISO(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // Date pg (minuit local) → on lit la date CALENDAIRE via les getters locaux.
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date UTC → 'YYYY-MM-DD'. */
function toISO(d) {
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' | Date → 'YYYY-MM-DD' | null (normalisation des lignes pg). */
function isoOrNull(value) {
  const d = parseISO(value);
  return d ? toISO(d) : null;
}

/** Ajoute n jours à une date ISO. */
function addDaysISO(iso, n) {
  const d = parseISO(iso);
  if (!d) return null;
  return toISO(new Date(d.getTime() + n * MS_DAY));
}

/**
 * Ajoute n mois à une date ISO, en bornant au dernier jour du mois cible
 * (2026-01-31 + 1 mois → 2026-02-28).
 */
function addMonthsISO(iso, n) {
  const d = parseISO(iso);
  if (!d) return null;
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return toISO(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), lastDay))));
}

/** Nombre de jours entre deux ISO (to − from). */
function diffDaysISO(fromIso, toIso) {
  const a = parseISO(fromIso); const b = parseISO(toIso);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / MS_DAY);
}

/** Arrondi à 2 décimales (règle client : quotités et agrégats à 2 déc.). */
function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** Arrondi à 3 décimales (taux de réalisation = ratio réalisé/prévisionnel). */
function round3(x) {
  return Math.round((x + Number.EPSILON) * 1000) / 1000;
}

/**
 * Semaines ISO de l'année : toutes les semaines dont le JEUDI tombe dans
 * `annee` (définition ISO-8601 → 52 ou 53 semaines ; 2026 commence un jeudi
 * → 53 semaines). Retour : [{ num, lundi, jeudi, mois }] avec lundi/jeudi en
 * 'YYYY-MM-DD' et mois = mois calendaire (1-12) du jeudi (pivot de rattachement).
 */
function isoWeeksOfYear(annee) {
  // Le 4 janvier est TOUJOURS en semaine ISO 1 → lundi de S1 = lundi de sa semaine.
  const jan4 = new Date(Date.UTC(annee, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7; // 0 = lundi
  let lundi = new Date(jan4.getTime() - dow * MS_DAY);
  const weeks = [];
  let num = 1;
  for (;;) {
    const jeudi = new Date(lundi.getTime() + 3 * MS_DAY);
    if (jeudi.getUTCFullYear() !== annee) break; // la semaine appartient à annee+1
    weeks.push({ num, lundi: toISO(lundi), jeudi: toISO(jeudi), mois: jeudi.getUTCMonth() + 1 });
    lundi = new Date(lundi.getTime() + 7 * MS_DAY);
    num += 1;
  }
  return weeks;
}

/** Quotité d'un contrat : heures hebdo / 35 arrondi 2 déc. (26 → 0.74). */
function computeQuotite(weeklyHours) {
  const h = Number(weeklyHours);
  if (!Number.isFinite(h) || h <= 0) return null;
  return round2(h / 35);
}

/**
 * Construit les segments de couverture d'un salarié (signés + présumé).
 *
 * @param {Object} p
 * @param {Array}  p.contrats  [{ start, end|null, weeklyHours }] — périodes
 *   effectives CHAÎNÉES (employee_contracts lot 3), déjà filtrées CDDI /
 *   CDI Inclusion, ISO strings. end null = contrat en cours sans terme (CDI).
 * @param {string} p.insertionStatus  employees.insertion_status
 * @param {string|null} p.passIaeEnd  employees.pass_iae_end (ISO)
 * @param {string|null} p.premierCddiDebut  début du 1er CDDI (date d'embauche
 *   officielle du premier contrat CDDI — borne légale des 24 mois)
 * @returns {{ segments: Array<{debut,fin,quotite,statut}>,
 *            finDernierContrat: string|null, bornePresume: string|null }}
 *   finDernierContrat = max des fins effectives ; null si un contrat est sans
 *   terme (couverture ouverte → pas de présomption).
 */
function buildSegments({ contrats, insertionStatus, passIaeEnd, premierCddiDebut }) {
  const segments = [];
  let finDernierContrat = null;
  let openEnded = false;

  const sorted = (contrats || [])
    .filter((c) => c && c.start)
    .slice()
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  for (const c of sorted) {
    const quotite = computeQuotite(c.weeklyHours);
    if (quotite == null) continue;
    segments.push({ debut: c.start, fin: c.end || null, quotite, statut: 'signe' });
    if (!c.end) openEnded = true;
    else if (finDernierContrat == null || c.end > finDernierContrat) finDernierContrat = c.end;
  }
  if (openEnded) finDernierContrat = null; // couverture ouverte (CDI Inclusion en cours)

  // Renouvellement présumé : uniquement si en parcours, sans sortie actée,
  // après un dernier contrat signé BORNÉ. Borne = min des bornes CONNUES
  // (pass IAE ; 1er CDDI + 24 mois − 1 j) ; aucune borne connue → pas de
  // présomption (jamais de valeur inventée).
  let bornePresume = null;
  if (insertionStatus === 'en_parcours' && finDernierContrat && segments.length > 0) {
    const bornes = [];
    if (passIaeEnd) bornes.push(passIaeEnd);
    if (premierCddiDebut) {
      const b24 = addDaysISO(addMonthsISO(premierCddiDebut, 24), -1);
      if (b24) bornes.push(b24);
    }
    if (bornes.length > 0) {
      bornes.sort(); // ISO lexicographique = chronologique
      const borne = bornes[0];
      if (borne > finDernierContrat) {
        // Quotité présumée = celle du dernier contrat signé (fin la plus tardive,
        // départage sur le début le plus tardif).
        let dernier = null;
        for (const s of segments) {
          if (s.fin !== finDernierContrat) continue;
          if (!dernier || s.debut > dernier.debut) dernier = s;
        }
        if (dernier) {
          bornePresume = borne;
          segments.push({
            debut: addDaysISO(finDernierContrat, 1),
            fin: borne,
            quotite: dernier.quotite,
            statut: 'presume',
          });
        }
      }
    }
  }

  return { segments, finDernierContrat, bornePresume };
}

/**
 * Quotité d'une semaine = segment couvrant le JEUDI de la semaine (pivot ISO).
 * Priorité au segment 'signe' sur 'presume' ; à statut égal, au début le plus
 * tardif (avenant le plus récent — les périodes effectives chaînées ne se
 * recouvrent normalement pas, garde défensive).
 * @returns {{ q: number|null, statut: 'signe'|'presume'|null }}
 */
function quotiteSemaine(jeudiIso, segments) {
  let hit = null;
  for (const seg of segments || []) {
    if (seg.quotite == null || !seg.debut) continue;
    if (jeudiIso < seg.debut) continue;
    if (seg.fin && jeudiIso > seg.fin) continue;
    if (!hit
      || (hit.statut === 'presume' && seg.statut === 'signe')
      || (hit.statut === seg.statut && seg.debut > hit.debut)) {
      hit = seg;
    }
  }
  return hit ? { q: hit.quotite, statut: hit.statut } : { q: null, statut: null };
}

/**
 * Jours OUVRÉS (lun→ven) d'absence déductible sur la semaine commençant
 * `lundiIso`. Seules les catégories 'sick' et 'absence' déduisent ('holiday'
 * = congés payés : jamais déduits). Intersection [start, end||start] ×
 * [lundi, vendredi] ; les demi-journées sont comptées en jours pleins
 * (granularité assumée) ; total plafonné à 5 (des absences qui se recouvrent
 * ne peuvent pas déduire plus qu'une semaine complète).
 * @param {Array} leaves [{ type_category, start, end|null }] (ISO)
 */
function joursOuvresAbsents(lundiIso, leaves) {
  const vendredi = addDaysISO(lundiIso, 4);
  let jours = 0;
  for (const l of leaves || []) {
    if (!l || (l.type_category !== 'sick' && l.type_category !== 'absence')) continue;
    const debut = l.start;
    if (!debut) continue;
    const fin = l.end || l.start;
    const from = debut > lundiIso ? debut : lundiIso;
    const to = fin < vendredi ? fin : vendredi;
    if (to < from) continue;
    // La fenêtre [lundi, vendredi] ne contient que des jours ouvrés → le nombre
    // de jours calendaires de l'intersection EST le nombre de jours ouvrés.
    jours += diffDaysISO(from, to) + 1;
  }
  return Math.min(5, jours);
}

/**
 * Quotité réalisée d'une semaine passée : q × (1 − joursAbsents/5),
 * arrondi 2 déc., clippé [0, q].
 */
function quotiteRealisee(q, joursAbsents) {
  if (q == null) return null;
  const ja = Math.min(5, Math.max(0, Number(joursAbsents) || 0));
  const r = round2(q * (1 - ja / 5));
  return Math.min(q, Math.max(0, r));
}

/**
 * Moyenne arrondie 2 déc. d'une liste de nombres ; null si liste vide
 * (« jamais de valeur inventée » : un mois sans semaine observée rend null,
 * pas 0).
 */
function moyenne2(values) {
  const nums = (values || []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  if (nums.length === 0) return null;
  return round2(nums.reduce((a, b) => a + b, 0) / nums.length);
}

module.exports = {
  MS_DAY,
  parseISO,
  toISO,
  isoOrNull,
  addDaysISO,
  addMonthsISO,
  diffDaysISO,
  round2,
  round3,
  isoWeeksOfYear,
  computeQuotite,
  buildSegments,
  quotiteSemaine,
  joursOuvresAbsents,
  quotiteRealisee,
  moyenne2,
};

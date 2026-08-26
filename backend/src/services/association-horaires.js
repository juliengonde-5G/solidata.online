/**
 * Horaires d'accessibilité des points association — fonctions PURES.
 *
 * Aucun accès base, aucun réseau, AUCUNE horloge implicite : tout ce dont ce
 * module a besoin lui est passé en argument. Les règles d'accessibilité sont
 * ainsi identiques quel que soit l'appelant (fiche association, estimation de
 * tournée, création, écran chauffeur) et testables sans PostgreSQL.
 *
 * RÈGLES MÉTIER (cahier des charges du 26/08/2026, RG-A et RG-B) :
 *  1. Une association a des horaires HEBDOMADAIRES : pour chaque jour, zéro,
 *     une ou plusieurs plages `début–fin`.
 *  2. Sémantique NON NÉGOCIABLE de l'absence d'information :
 *       - horaires `null`          → INCONNUS. La planification reste permise,
 *                                    l'écran le dit. On ne bloque JAMAIS sur une
 *                                    information qui n'existe pas (RG-A2).
 *       - objet présent, jour `[]` → FERMÉ ce jour-là (RG-A5).
 *     Un jour absent de l'objet vaut fermé : la normalisation porte toujours
 *     les 7 jours pour que cette lecture soit explicite.
 *  3. Un passage TIENT dans les horaires si l'intervalle
 *     [arrivée ; arrivée + durée d'arrêt] est contenu dans UNE plage du jour
 *     (RG-A3) — un service ne se coupe pas en deux morceaux de part et d'autre
 *     d'une fermeture de midi.
 *  4. Fenêtre effective d'un rendez-vous = [début − tolérance ; fin + tolérance],
 *     `fin` valant `début` quand la demande porte une heure exacte (RG-B3).
 *
 * Unité de temps : les MINUTES D'HORLOGE depuis minuit (09:30 → 570). Ne jamais
 * les confondre avec les minutes écoulées depuis le départ manipulées par le
 * moteur de temps (`tour-time-engine.js`).
 */

// Ordre ISO : le lundi ouvre la semaine. L'index dans ce tableau est la clé de
// conversion depuis `Date.getUTCDay()` (qui, lui, commence au dimanche).
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

// Tolérance de rendez-vous par défaut (arbitrage n° 4 du cahier des charges).
// Valeur métier documentée, pas un défaut silencieux : elle n'est appliquée que
// lorsque la demande n'en porte aucune.
const TOLERANCE_RDV_DEFAUT_MIN = 15;

// Format STRICT des plages saisies en fiche : 00:00 → 23:59, secondes interdites.
const RE_HHMM_STRICT = /^([01]\d|2[0-3]):[0-5]\d$/;
// Format TOLÉRÉ à la lecture : PostgreSQL rend les colonnes TIME en 'HH:MM:SS'.
const RE_HHMM_LECTURE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

const MINUTES_PAR_JOUR = 1440;

/**
 * '09:30' → 570. Accepte aussi 'HH:MM:SS' (colonnes TIME de PostgreSQL) ; les
 * secondes sont ignorées, jamais arrondies. Tout autre format → null.
 * @param {string} valeur
 * @returns {number|null} minutes depuis minuit
 */
function minutesDepuisHHMM(valeur) {
  if (typeof valeur !== 'string') return null;
  const m = RE_HHMM_LECTURE.exec(valeur.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 570 → '09:30'. Au-delà de 24 h, le débordement est DIT : 1445 → '00:05 (+1 j)'.
 * Une valeur négative (tolérance qui remonte avant minuit) ou non finie n'a pas
 * de représentation horaire : null, jamais une heure inventée.
 * @param {number} minutes
 * @returns {string|null}
 */
function hhmmDepuisMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  const total = Math.round(minutes);
  const jours = Math.floor(total / MINUTES_PAR_JOUR);
  const reste = total % MINUTES_PAR_JOUR;
  const hh = String(Math.floor(reste / 60)).padStart(2, '0');
  const mm = String(reste % 60).padStart(2, '0');
  return jours >= 1 ? `${hh}:${mm} (+${jours} j)` : `${hh}:${mm}`;
}

/**
 * '2026-08-31' → 'lundi'. Parsing UTC STRICT (`Date.UTC`) : le fuseau du
 * conteneur ne doit jamais faire glisser un jour de collecte. Accepte une chaîne
 * 'YYYY-MM-DD' (éventuellement suffixée d'une heure ISO) ou un objet Date.
 * Une date qui n'existe pas au calendrier (2026-02-31) → null.
 * @param {string|Date} date
 * @returns {string|null} un élément de JOURS
 */
function jourDeDate(date) {
  let annee; let mois; let jour;
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return null;
    annee = date.getUTCFullYear(); mois = date.getUTCMonth() + 1; jour = date.getUTCDate();
  } else if (typeof date === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date.trim());
    if (!m) return null;
    annee = Number(m[1]); mois = Number(m[2]); jour = Number(m[3]);
  } else {
    return null;
  }
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  // Contrôle de débordement : Date.UTC(2026, 1, 31) glisse au 3 mars.
  if (d.getUTCFullYear() !== annee || d.getUTCMonth() !== mois - 1 || d.getUTCDate() !== jour) return null;
  // getUTCDay() : 0 = dimanche. JOURS commence au lundi.
  return JOURS[(d.getUTCDay() + 6) % 7];
}

/**
 * Valide et normalise l'objet d'horaires hebdomadaires saisi en fiche.
 *
 * @param {object|null|undefined} brut
 * @returns {{valide: boolean, erreurs: string[], normalise: object|null}}
 *   `normalise` porte TOUJOURS les 7 jours (jour absent → []), plages triées.
 *   `brut` null/undefined → { valide: true, erreurs: [], normalise: null } :
 *   « non renseigné » est une réponse valide, pas une erreur de saisie.
 */
function validerHoraires(brut) {
  if (brut === null || brut === undefined) {
    return { valide: true, erreurs: [], normalise: null };
  }
  const erreurs = [];
  if (typeof brut !== 'object' || Array.isArray(brut)) {
    return {
      valide: false,
      erreurs: ['Horaires : un objet { lundi: [...], mardi: [...] } est attendu.'],
      normalise: null,
    };
  }

  const normalise = {};
  for (const jour of JOURS) normalise[jour] = [];

  for (const cle of Object.keys(brut)) {
    if (!JOURS.includes(cle)) {
      erreurs.push(`Jour inconnu : « ${cle} » (attendus : ${JOURS.join(', ')}).`);
      continue;
    }
    const valeur = brut[cle];
    if (valeur === null || valeur === undefined) {
      // Absence explicite = jour fermé, comme un tableau vide.
      continue;
    }
    if (!Array.isArray(valeur)) {
      erreurs.push(`${cle} : une liste de plages est attendue (liste vide = fermé).`);
      continue;
    }

    const plages = [];
    valeur.forEach((plage, i) => {
      const rang = i + 1;
      if (!plage || typeof plage !== 'object' || Array.isArray(plage)) {
        erreurs.push(`${cle}, plage ${rang} : { "debut": "09:00", "fin": "12:00" } attendu.`);
        return;
      }
      const { debut, fin } = plage;
      const debutOk = typeof debut === 'string' && RE_HHMM_STRICT.test(debut);
      const finOk = typeof fin === 'string' && RE_HHMM_STRICT.test(fin);
      if (!debutOk) erreurs.push(`${cle}, plage ${rang} : heure de début invalide (format HH:MM attendu).`);
      if (!finOk) erreurs.push(`${cle}, plage ${rang} : heure de fin invalide (format HH:MM attendu).`);
      if (!debutOk || !finOk) return;

      const dm = minutesDepuisHHMM(debut);
      const fm = minutesDepuisHHMM(fin);
      if (dm >= fm) {
        erreurs.push(`${cle}, plage ${rang} : la fin (${fin}) doit être après le début (${debut}).`);
        return;
      }
      plages.push({ debut, fin, dm, fm });
    });

    plages.sort((a, b) => a.dm - b.dm);
    for (let i = 1; i < plages.length; i++) {
      if (plages[i].dm < plages[i - 1].fm) {
        erreurs.push(
          `${cle} : les plages ${plages[i - 1].debut}–${plages[i - 1].fin} et `
          + `${plages[i].debut}–${plages[i].fin} se chevauchent.`
        );
      }
    }
    normalise[cle] = plages.map(p => ({ debut: p.debut, fin: p.fin }));
  }

  return erreurs.length > 0
    ? { valide: false, erreurs, normalise: null }
    : { valide: true, erreurs: [], normalise };
}

/**
 * Plages du jour de la date donnée.
 * @param {object|null} horaires  objet d'horaires (brut ou normalisé)
 * @param {string|Date} date
 * @returns {Array<[number, number]>|null}
 *   [[540,720],[840,1020]] = ouvert · [] = FERMÉ · null = horaires INCONNUS
 *   (horaires absents, illisibles, ou date illisible : on ne devine pas).
 */
function plagesDuJour(horaires, date) {
  if (horaires === null || horaires === undefined) return null;
  const { valide, normalise } = validerHoraires(horaires);
  if (!valide || !normalise) return null;
  const jour = jourDeDate(date);
  if (!jour) return null;
  return normalise[jour].map(p => [minutesDepuisHHMM(p.debut), minutesDepuisHHMM(p.fin)]);
}

/**
 * Jours de fermeture (aucune plage).
 * @param {object|null} horaires
 * @returns {string[]} [] si les horaires sont inconnus ou illisibles — un jour
 *   n'est déclaré fermé que sur une information réellement saisie.
 */
function joursFermes(horaires) {
  if (horaires === null || horaires === undefined) return [];
  const { valide, normalise } = validerHoraires(horaires);
  if (!valide || !normalise) return [];
  return JOURS.filter(j => normalise[j].length === 0);
}

/**
 * Le service [debutMin ; finMin] tient-il dans UNE plage ?
 * @param {number} debutMin  minutes d'horloge
 * @param {number} finMin    minutes d'horloge
 * @param {Array<[number, number]>|null} plages
 * @returns {boolean} `plages === null` (horaires inconnus) → true : inconnu
 *   n'est pas interdit (RG-A2). `plages === []` (fermé) → false.
 */
function tientDansPlages(debutMin, finMin, plages) {
  if (plages === null || plages === undefined) return true;
  if (!Array.isArray(plages) || plages.length === 0) return false;
  if (!Number.isFinite(debutMin) || !Number.isFinite(finMin)) return false;
  return plages.some(p => (
    Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
    && p[0] <= debutMin && finMin <= p[1]
  ));
}

/**
 * Premier moment, au plus tôt à `apresMin`, où un service de `dureeMin` tient
 * entièrement dans une plage.
 * @param {number} dureeMin
 * @param {Array<[number, number]>|null} plages
 * @param {number} [apresMin=0]
 * @returns {number|null} minutes d'horloge, ou null si aucun créneau ne convient
 *   (jour fermé, journée trop avancée, ou horaires inconnus : sans plages
 *   connues il n'y a rien à suggérer — on ne propose pas une heure inventée).
 */
function premierCreneauCompatible(dureeMin, plages, apresMin = 0) {
  if (!Array.isArray(plages) || plages.length === 0) return null;
  if (!Number.isFinite(dureeMin) || dureeMin < 0) return null;
  const depuis = Number.isFinite(apresMin) ? apresMin : 0;
  const triees = plages
    .filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .slice()
    .sort((a, b) => a[0] - b[0]);
  for (const [debut, fin] of triees) {
    const candidat = Math.max(debut, depuis);
    if (candidat + dureeMin <= fin) return candidat;
  }
  return null;
}

/**
 * Fenêtre effective d'un rendez-vous : [début − tolérance ; fin + tolérance].
 * @param {{heure_debut: string, heure_fin?: string|null, tolerance_min?: number|null}} demande
 * @param {number} [toleranceParDefaut=TOLERANCE_RDV_DEFAUT_MIN]
 * @returns {{debutMin: number, finMin: number}|null}
 *   null si l'heure de début est illisible — sans heure, il n'y a pas de
 *   rendez-vous, et surtout pas une fenêtre par défaut.
 */
function fenetreEffective(demande, toleranceParDefaut = TOLERANCE_RDV_DEFAUT_MIN) {
  if (!demande || typeof demande !== 'object') return null;
  const debut = minutesDepuisHHMM(demande.heure_debut);
  if (debut === null) return null;
  // Heure de fin absente = rendez-vous à heure exacte : la fenêtre se réduit à
  // la tolérance de part et d'autre.
  const finBrute = (demande.heure_fin === null || demande.heure_fin === undefined)
    ? debut
    : minutesDepuisHHMM(demande.heure_fin);
  const fin = finBrute === null ? debut : Math.max(debut, finBrute);
  const tolerance = Number.isFinite(demande.tolerance_min) && demande.tolerance_min >= 0
    ? demande.tolerance_min
    : (Number.isFinite(toleranceParDefaut) && toleranceParDefaut >= 0
      ? toleranceParDefaut
      : TOLERANCE_RDV_DEFAUT_MIN);
  return { debutMin: debut - tolerance, finMin: fin + tolerance };
}

module.exports = {
  JOURS,
  TOLERANCE_RDV_DEFAUT_MIN,
  minutesDepuisHHMM,
  hhmmDepuisMinutes,
  jourDeDate,
  validerHoraires,
  plagesDuJour,
  joursFermes,
  tientDansPlages,
  premierCreneauCompatible,
  fenetreEffective,
};

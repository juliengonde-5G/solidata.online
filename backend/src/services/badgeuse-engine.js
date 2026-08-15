/**
 * Moteur de calcul « Temps & Présence » (badgeuse) — fonctions PURES.
 *
 * Toutes les fonctions de ce module sont pures : aucun accès DB, aucune horloge
 * implicite (« maintenant » et les paramètres sont TOUJOURS passés en argument).
 * C'est ce qui rend les règles de gestion RH testables exhaustivement sans base
 * — le câblage SQL vit dans routes/badgeuse.js (pattern effectifs-engine.js).
 *
 * ══ RÈGLE ABSOLUE (ADR-0002) ══
 * AUCUN seuil, arrondi, tolérance ou durée de pause n'est écrit en dur ici.
 * Tout vient de l'objet `params` (issu de la table `settings` via
 * utils/badgeuse-settings.js). Un test de contrat appelle computeDay() avec deux
 * jeux de paramètres différents et vérifie que le résultat change : si une règle
 * se figeait dans le code, ce test tomberait.
 *
 * ══ RÈGLES IMPLÉMENTÉES (paramétrées) ══
 *  1. ÉVÉNEMENTS EFFECTIFS = pointages bruts + corrections additives (BO-03).
 *     L'enregistrement brut n'est JAMAIS modifié : `annulation` exclut,
 *     `modification` remplace horodatage/sens, `ajout` insère. Les corrections
 *     sont appliquées dans l'ordre (la dernière sur un même pointage gagne).
 *  2. APPARIEMENT entrée/sortie chronologique. Un second pointage de même sens
 *     dans la fenêtre d'anti-rebond est un DOUBLON (ignoré, signalé `info`) ;
 *     au-delà c'est une séquence impaire. Sur `entree, entree`, on conserve la
 *     PREMIÈRE entrée ouverte : c'est l'heure d'arrivée réelle, donc la lecture
 *     à l'avantage du salarié — l'anomalie est signalée pour régularisation.
 *  3. ARRONDI « à l'avantage du salarié » (params.arrondi_sens), au pas
 *     params.arrondi_minutes (0 = pas d'arrondi) : l'ENTRÉE recule au pas
 *     INFÉRIEUR ; la SORTIE est comptée AU RÉEL (ADR-0002 addendum §2, QA-10 —
 *     lettre exacte de NOTE_RH §3 « sortie arrondie au réel »). Autres sens
 *     supportés : 'reel' (aucun arrondi), 'proche' (au plus proche des deux
 *     bornes — mode alternatif paramétrable, hors grille arbitrée).
 *  4. ENTRÉE EN AVANCE sur l'heure planifiée → ramenée à l'heure planifiée
 *     (le temps d'attente avant la prise de poste n'est pas du travail effectif,
 *     NOTE_RH §3), sauf si params.badge_avant_heure_compte est vrai.
 *     RETARD ≤ params.tolerance_retard_minutes → sans effet paie (compté à
 *     l'heure planifiée) ; au-delà → décompte réel.
 *  5. PAUSE : si la journée dépasse params.pause_deduite_seuil_heures SANS
 *     pointage intermédiaire (une seule paire), params.pause_deduite_minutes
 *     sont déduites — mais la déduction est PLAFONNÉE au dépassement du seuil
 *     (ADR-0002 addendum §1, QA-06) : `min(pause, max(0, travaillé − seuil))`.
 *     La fonction de paie est ainsi MONOTONE — 6 h 01 ne peut plus être payée
 *     moins que 6 h 00. Avec 4 pointages, la pause est déjà hors comptage →
 *     aucune déduction (NOTE_RH §3 : « évite la déduction forfaitaire
 *     contestable »).
 *  6. ALERTE journée > params.journee_max_heures (anomalie, jamais un blocage :
 *     aucune heure n'est perdue, c'est un signalement à l'encadrant).
 *  7. POINTAGES INCOMPLETS (ADR-0002 addendum §4, QA-05) : une journée qui
 *     dépasse le seuil de pause est censée comporter params.pointages_par_jour
 *     événements (NOTE_RH §3 : « 4 — permet de justifier la pause »). En
 *     dessous, l'anomalie `pointages_incomplets` est levée et la journée sort
 *     du taux de pointages complets (indicateur NOTE_RH §9).
 *
 * ══ FUSEAU ══
 * Les horodatages sont des instants UTC (colonne TIMESTAMPTZ) ; les journées
 * civiles sont en Europe/Paris. Les durées se calculent sur les INSTANTS, donc
 * les bascules d'heure d'été/hiver sont exactes par construction : une nuit de
 * passage à l'heure d'hiver dure réellement une heure de plus que ce que montre
 * l'horloge murale, et le moteur la compte telle quelle (tests DST dédiés).
 */

const PARIS_TZ = 'Europe/Paris';
const MS_MIN = 60 * 1000;

// ── Helpers fuseau (Intl — même approche que services/sumup.js) ────────────

/** Décalage de Paris (minutes) à un instant donné. */
function parisOffsetMinutes(instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PARIS_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(instant).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour === '24' ? '0' : parts.hour), Number(parts.minute), Number(parts.second)
  );
  return Math.round((asUTC - instant.getTime()) / MS_MIN);
}

/**
 * Heure murale Paris → instant UTC. Deux passes (estimation puis vérification
 * de l'offset à l'instant ajusté) pour traverser correctement les bascules DST.
 */
function parisWallClockToUTC(year, monthIdx, day, hh, mm, ss = 0) {
  const naive = Date.UTC(year, monthIdx, day, hh, mm, ss);
  const offset = parisOffsetMinutes(new Date(naive));
  let ts = naive - offset * MS_MIN;
  const offset2 = parisOffsetMinutes(new Date(ts));
  if (offset2 !== offset) ts = naive - offset2 * MS_MIN;
  return new Date(ts);
}

/** Date civile 'YYYY-MM-DD' d'un instant, vue depuis Paris. */
function parisDateStr(instant) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PARIS_TZ }).format(toDate(instant));
}

/** Heure murale 'HH:MM' d'un instant, vue depuis Paris. */
function parisTimeStr(instant) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: PARIS_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(toDate(instant));
}

/** 'YYYY-MM-DD' + 'HH:MM' (heure murale Paris) → instant UTC, null si invalide. */
function parisDateTimeToUTC(dateISO, hhmm) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateISO || ''));
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!d || !t) return null;
  return parisWallClockToUTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], 0);
}

/** Valeur quelconque (Date, ISO, epoch) → Date ; null si invalide. */
function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value == null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Valeur quelconque → epoch ms ; null si invalide. */
function toMs(value) {
  const d = toDate(value);
  return d ? d.getTime() : null;
}

/** Arrondi à 2 décimales. */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Minutes → 'HH:MM' (format sexagésimal des exports paie). */
function minutesToHms(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Minutes → heures décimales arrondies 2 déc. */
function minutesToDecimal(minutes) {
  return round2((Number(minutes) || 0) / 60);
}

// ── Jours ouvrés (calendrier) ──────────────────────────────────────────────
// « Jour ouvré » = lundi→vendredi, MÊME DÉFINITION que services/effectifs-engine.js
// (« Jours ouvrés lun→ven »). Ce n'est pas une règle de gestion arbitrable mais
// un fait calendaire : la semaine de travail de référence compte 5 jours. Les
// jours fériés ne sont PAS retranchés — l'ADR-0002 addendum §3 dit « jours
// ouvrés du mois ÷ 5 » sans autre précision, et retrancher les fériés serait
// inventer une règle que la Direction n'a pas arbitrée.
const JOURS_OUVRES_SEMAINE = 5;

/** Un jour civil 'YYYY-MM-DD' est-il un jour ouvré (lun→ven) ? */
function estJourOuvre(dateISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateISO || ''));
  if (!m) return false;
  const jour = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return jour >= 1 && jour <= 5;
}

/** Nombre de jours ouvrés d'une période 'YYYY-MM' ; null si période invalide. */
function joursOuvresDuMois(periode) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periode || ''));
  if (!m) return null;
  const annee = +m[1];
  const mois = +m[2];
  if (mois < 1 || mois > 12) return null;
  const nbJours = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  let total = 0;
  for (let d = 1; d <= nbJours; d += 1) {
    const jour = new Date(Date.UTC(annee, mois - 1, d)).getUTCDay();
    if (jour >= 1 && jour <= 5) total += 1;
  }
  return total;
}

/**
 * Nombre de jours OUVRÉS écoulés entre deux jours civils, borne de départ
 * EXCLUE et borne d'arrivée INCLUSE : `joursOuvresEcoules('2026-08-17',
 * '2026-08-18')` = 1. Rend null si une borne est illisible, 0 si l'arrivée
 * précède le départ (aucun délai écoulé — jamais un nombre négatif).
 */
function joursOuvresEcoules(debutISO, finISO) {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(debutISO || ''));
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(finISO || ''));
  if (!a || !b) return null;
  let curseur = Date.UTC(+a[1], +a[2] - 1, +a[3]);
  const fin = Date.UTC(+b[1], +b[2] - 1, +b[3]);
  if (fin <= curseur) return 0;
  let total = 0;
  const JOUR_MS = 24 * 3600 * 1000;
  while (curseur < fin) {
    curseur += JOUR_MS;
    const jour = new Date(curseur).getUTCDay();
    if (jour >= 1 && jour <= 5) total += 1;
  }
  return total;
}

/**
 * Heures THÉORIQUES d'un mois (BO-04, ADR-0002 addendum §3, QA-03) :
 *   heures hebdomadaires contractuelles × jours ouvrés du mois ÷ 5.
 * Rend `null` si aucune heure hebdomadaire n'est connue ou si la période est
 * illisible — « jamais de valeur inventée » : une feuille sans contrat connu
 * affiche « — », pas 0.
 *
 * @param {number|string|null} heuresHebdo heures hebdo contractuelles
 * @param {string} periode 'YYYY-MM'
 * @returns {number|null} heures théoriques arrondies 2 décimales
 */
function heuresTheoriquesMois(heuresHebdo, periode) {
  const h = Number(heuresHebdo);
  if (!Number.isFinite(h) || h <= 0) return null;
  const ouvres = joursOuvresDuMois(periode);
  if (ouvres == null) return null;
  return round2((h * ouvres) / JOURS_OUVRES_SEMAINE);
}

// ── 1. Événements effectifs (pointages bruts + corrections) ────────────────

/**
 * Applique les corrections additives aux pointages bruts et rend la liste des
 * ÉVÉNEMENTS EFFECTIFS, triée chronologiquement. Le brut est intouché : cette
 * fonction ne fait que projeter la vue « traitée » par-dessus (BO-03).
 *
 * @param {Array} pointages [{ id, horodatage_utc, sens, source, statut }]
 * @param {Array} corrections [{ id, pointage_id, type, horodatage_corrige, sens_corrige, motif_code, auteur_id }]
 * @returns {Array} [{ pointage_id, correction_id, horodatage_utc(Date), sens, source, origine, corrige, motif_code }]
 */
function buildEffectiveEvents(pointages, corrections) {
  const corrs = [...(corrections || [])].sort(
    (a, b) => (Number(a.id) || 0) - (Number(b.id) || 0)
  );

  // Dernière correction structurante par pointage (la plus récente gagne).
  const parPointage = new Map();
  const ajouts = [];
  for (const c of corrs) {
    if (c.type === 'ajout' || c.pointage_id == null) {
      if (c.type === 'ajout') ajouts.push(c);
      continue;
    }
    parPointage.set(Number(c.pointage_id), c);
  }

  const events = [];
  for (const p of pointages || []) {
    // Un orphelin non rattaché n'est pas une heure d'un salarié : il n'entre pas
    // dans le calcul (il vit dans /orphelins jusqu'à rattachement RH).
    if (p.statut === 'orphelin' && p.employee_id == null) continue;

    const c = parPointage.get(Number(p.id));
    if (c && c.type === 'annulation') continue; // exclu du calcul, jamais supprimé

    const horodatage = c && c.type === 'modification' && c.horodatage_corrige
      ? toDate(c.horodatage_corrige)
      : toDate(p.horodatage_utc);
    if (!horodatage) continue;

    const sens = c && c.type === 'modification' && c.sens_corrige ? c.sens_corrige : p.sens;
    events.push({
      pointage_id: p.id != null ? Number(p.id) : null,
      correction_id: c ? Number(c.id) : null,
      horodatage_utc: horodatage,
      sens,
      source: p.source || 'badge',
      origine: 'pointage',
      corrige: !!c,
      motif_code: c ? c.motif_code || null : null,
    });
  }

  for (const c of ajouts) {
    const horodatage = toDate(c.horodatage_corrige);
    if (!horodatage || !c.sens_corrige) continue;
    events.push({
      pointage_id: null,
      correction_id: Number(c.id),
      horodatage_utc: horodatage,
      sens: c.sens_corrige,
      source: 'manuel',
      origine: 'correction',
      corrige: true,
      motif_code: c.motif_code || null,
    });
  }

  events.sort((a, b) => a.horodatage_utc.getTime() - b.horodatage_utc.getTime());
  return events;
}

/**
 * Restreint des JOURNÉES calculées à une période, par leur jour civil Paris
 * (revue Codex — correctif du filtrage C2). C'est la JOURNÉE, et non
 * l'événement, qui appartient à une période : le moteur rattache une paire au
 * jour civil de son ENTRÉE (`computeDays`), si bien qu'une nuit du 31/08 23:50
 * au 01/09 00:10 est une journée du 31/08 — elle appartient à août ENTIÈRE.
 * Filtrer les événements avant l'appariement coupait la paire en deux et
 * perdait les minutes des deux côtés ; filtrer après le calcul les conserve.
 *
 * Comparaison de chaînes ISO 'YYYY-MM-DD' (ordre lexicographique = ordre
 * chronologique), donc aucun aléa de fuseau à ce stade.
 *
 * @param {Array} jours sortie de computeDays (chaque journée porte `date`)
 * @param {string|null} dateDebut jour civil INCLUS ('YYYY-MM-DD')
 * @param {string|null} dateFinExclue premier jour civil EXCLU
 * @returns {Array} journées de la période, ordre conservé
 */
function filterDaysToPeriod(jours, dateDebut, dateFinExclue) {
  return (jours || []).filter((j) => {
    const d = j && j.date;
    if (!d) return false;
    if (dateDebut && d < dateDebut) return false;
    if (dateFinExclue && d >= dateFinExclue) return false;
    return true;
  });
}

// ── 2. Appariement entrée / sortie ─────────────────────────────────────────

/**
 * Apparie les événements en paires entrée→sortie et relève les anomalies de
 * séquence. Voir règle 2 en tête de fichier.
 *
 * @param {Array} events sortie de buildEffectiveEvents (triée)
 * @param {object} options { anti_rebond_sec } — 0/absent = aucune fenêtre de doublon
 * @returns {{ paires: Array, anomalies: Array, ouvert: object|null }}
 */
function pairEvents(events, options = {}) {
  const antiRebondMs = Math.max(0, Number(options.anti_rebond_sec) || 0) * 1000;
  const paires = [];
  const anomalies = [];
  let ouvert = null;
  let dernier = null;

  for (const e of events || []) {
    // Un événement de sens inconnu (orphelin rattaché sans sens tranché) ne peut
    // pas être apparié : il est signalé pour que l'encadrant tranche.
    if (e.sens !== 'entree' && e.sens !== 'sortie') {
      anomalies.push({ type: 'sens_indetermine', horodatage_utc: e.horodatage_utc, pointage_id: e.pointage_id, severite: 'alerte' });
      continue;
    }

    if (dernier && dernier.sens === e.sens && antiRebondMs > 0
      && (e.horodatage_utc.getTime() - dernier.horodatage_utc.getTime()) <= antiRebondMs) {
      anomalies.push({ type: 'double_pointage', horodatage_utc: e.horodatage_utc, pointage_id: e.pointage_id, severite: 'info' });
      continue; // doublon matériel (rebond lecteur) — ignoré, jamais supprimé
    }

    if (e.sens === 'entree') {
      if (ouvert) {
        // Séquence impaire : on garde la PREMIÈRE entrée ouverte (heure d'arrivée
        // réelle → lecture à l'avantage du salarié), la seconde est signalée.
        anomalies.push({ type: 'sequence_impaire', horodatage_utc: e.horodatage_utc, pointage_id: e.pointage_id, severite: 'alerte', detail: 'entree_sans_sortie_precedente' });
      } else {
        ouvert = e;
      }
    } else if (!ouvert) {
      anomalies.push({ type: 'sortie_sans_entree', horodatage_utc: e.horodatage_utc, pointage_id: e.pointage_id, severite: 'alerte' });
    } else {
      paires.push({ entree: ouvert, sortie: e });
      ouvert = null;
    }
    dernier = e;
  }

  if (ouvert) {
    anomalies.push({ type: 'oubli_sortie', horodatage_utc: ouvert.horodatage_utc, pointage_id: ouvert.pointage_id, severite: 'alerte' });
  }
  return { paires, anomalies, ouvert };
}

// ── 3. Arrondis (paramétrés) ───────────────────────────────────────────────

/**
 * Arrondit un instant au pas params.arrondi_minutes selon params.arrondi_sens.
 * 'avantage_salarie' : l'ENTRÉE recule au pas inférieur, la SORTIE est comptée
 *   AU RÉEL (ADR-0002 addendum §2, QA-10). L'arrondi ne peut donc jamais
 *   retirer une minute au salarié, et il ne lui en ajoute plus non plus en fin
 *   de journée : la sortie affichée est la sortie badgée.
 * 'proche' : au plus proche (les deux bornes). 'reel'/'aucun' (ou pas = 0) :
 *   inchangé.
 */
function arrondirInstant(ms, sens, params) {
  const pas = Math.max(0, Number(params.arrondi_minutes) || 0) * MS_MIN;
  const mode = String(params.arrondi_sens || 'reel');
  if (pas === 0 || mode === 'reel' || mode === 'aucun') return ms;
  if (mode === 'proche') return Math.round(ms / pas) * pas;
  // avantage_salarie : entrée au pas inférieur, sortie intouchée (au réel).
  return sens === 'entree' ? Math.floor(ms / pas) * pas : ms;
}

/** Ajuste une heure d'entrée (règles 3 et 4 en tête de fichier). */
function ajusterEntree(ms, planifieeMs, params) {
  if (planifieeMs != null) {
    if (ms < planifieeMs) {
      return params.badge_avant_heure_compte ? arrondirInstant(ms, 'entree', params) : planifieeMs;
    }
    const tolerance = Math.max(0, Number(params.tolerance_retard_minutes) || 0) * MS_MIN;
    if (ms <= planifieeMs + tolerance) return planifieeMs; // retard toléré, sans effet paie
  }
  return arrondirInstant(ms, 'entree', params);
}

/**
 * Ajuste une heure de sortie. En grille arbitrée ('avantage_salarie') la sortie
 * est comptée AU RÉEL : `arrondirInstant` la rend inchangée (QA-10). Le passage
 * par l'helper est conservé pour que le mode alternatif 'proche' reste actif.
 */
function ajusterSortie(ms, params) {
  return arrondirInstant(ms, 'sortie', params);
}

// ── 4. Journée ─────────────────────────────────────────────────────────────

/**
 * Calcule une journée de travail à partir de ses événements effectifs.
 *
 * @param {Array} events événements effectifs de la journée (une sortie après
 *   minuit appartient à la journée de son ENTRÉE : le cas est géré nativement,
 *   les durées portant sur des instants)
 * @param {object} params grille badgeuse.* (readBadgeuseParams)
 * @param {object} options { date:'YYYY-MM-DD' (jour civil Paris),
 *   heure_planifiee_debut:'HH:MM'|null }
 * @returns {object} journée calculée (minutes, paires, anomalies, règles appliquées)
 */
function computeDay(events, params = {}, options = {}) {
  const date = options.date || (events && events.length ? parisDateStr(events[0].horodatage_utc) : null);
  const { paires, anomalies, ouvert } = pairEvents(events, params);

  const planifieeMs = options.heure_planifiee_debut && date
    ? toMs(parisDateTimeToUTC(date, options.heure_planifiee_debut))
    : null;

  const reglesAppliquees = [];
  const pairesCalculees = [];
  let minutesBrutes = 0;

  paires.forEach((p, index) => {
    const entreeReelle = p.entree.horodatage_utc.getTime();
    const sortieReelle = p.sortie.horodatage_utc.getTime();
    // L'heure planifiée ne s'applique qu'à la PREMIÈRE entrée de la journée
    // (prise de poste) ; les retours de pause s'arrondissent au pas.
    const entreeAjustee = ajusterEntree(entreeReelle, index === 0 ? planifieeMs : null, params);
    const sortieAjustee = ajusterSortie(sortieReelle, params);
    const minutes = Math.max(0, (sortieAjustee - entreeAjustee) / MS_MIN);
    minutesBrutes += minutes;

    if (index === 0 && planifieeMs != null) {
      if (entreeReelle < planifieeMs && !params.badge_avant_heure_compte) {
        reglesAppliquees.push('entree_avant_heure_non_comptee');
      } else if (entreeReelle > planifieeMs && entreeAjustee === planifieeMs) {
        reglesAppliquees.push('tolerance_retard');
      }
    }
    // « arrondi » ne se déclare que si l'ARRONDI a effectivement déplacé une
    // borne : le recalage sur l'heure planifiée est une autre règle (déjà
    // signalée ci-dessus), il ne doit pas être compté comme un arrondi.
    if (arrondirInstant(entreeReelle, 'entree', params) !== entreeReelle || sortieAjustee !== sortieReelle) {
      if (!reglesAppliquees.includes('arrondi')) reglesAppliquees.push('arrondi');
    }

    pairesCalculees.push({
      entree_utc: new Date(entreeReelle).toISOString(),
      sortie_utc: new Date(sortieReelle).toISOString(),
      entree_comptee_utc: new Date(entreeAjustee).toISOString(),
      sortie_comptee_utc: new Date(sortieAjustee).toISOString(),
      minutes: round2(minutes),
      corrige: !!(p.entree.corrige || p.sortie.corrige),
    });
  });

  // Règle 5 — pause déduite si la journée dépasse le seuil SANS pointage
  // intermédiaire (une seule paire : la pause n'a pas été badgée).
  // MONOTONICITÉ (ADR-0002 addendum §1, QA-06) : la déduction est plafonnée au
  // DÉPASSEMENT du seuil, elle ne fait donc jamais retomber la journée sous le
  // seuil. 6 h 00 → 6 h 00 ; 6 h 01 → 6 h 00 ; 6 h 45 → 6 h 00 ; 7 h 00 →
  // 6 h 15. Travailler une minute de plus ne peut plus rapporter 44 min de
  // moins — la falaise de la lettre de NOTE_RH §3 est supprimée.
  const seuilPauseMin = Math.max(0, Number(params.pause_deduite_seuil_heures) || 0) * 60;
  const pauseMin = Math.max(0, Number(params.pause_deduite_minutes) || 0);
  let pauseDeduite = 0;
  if (pauseMin > 0 && seuilPauseMin > 0 && pairesCalculees.length === 1 && minutesBrutes > seuilPauseMin) {
    pauseDeduite = Math.min(pauseMin, Math.max(0, minutesBrutes - seuilPauseMin));
    reglesAppliquees.push('pause_deduite');
  }

  const minutes = Math.max(0, minutesBrutes - pauseDeduite);

  // Règle 6 — alerte journée longue (signalement, jamais un blocage).
  const journeeMaxMin = Math.max(0, Number(params.journee_max_heures) || 0) * 60;
  const toutesAnomalies = [...anomalies];
  if (journeeMaxMin > 0 && minutes > journeeMaxMin) {
    toutesAnomalies.push({
      type: 'journee_longue', date, severite: 'alerte',
      detail: `${minutesToDecimal(minutes)} h > ${round2(journeeMaxMin / 60)} h`,
    });
  }

  return {
    date,
    paires: pairesCalculees,
    nb_pointages: (events || []).length,
    minutes_brutes: round2(minutesBrutes),
    pause_deduite_minutes: round2(pauseDeduite),
    minutes: round2(minutes),
    heures: minutesToDecimal(minutes),
    heures_hms: minutesToHms(minutes),
    anomalies: toutesAnomalies.map((a) => ({ ...a, date: a.date || date })),
    session_ouverte: !!ouvert,
    regles_appliquees: reglesAppliquees,
  };
}

/**
 * Découpe un flux d'événements en journées civiles Paris PUIS calcule chaque
 * journée. L'appariement est fait sur le flux complet en amont : une paire est
 * rattachée au jour civil de son ENTRÉE, ce qui traite nativement les journées
 * à cheval sur minuit (poste du soir).
 *
 * @returns {Array} journées (computeDay) triées par date croissante
 */
function computeDays(events, params = {}, options = {}) {
  const { paires, anomalies } = pairEvents(events, params);
  const parJour = new Map();
  const push = (date, event) => {
    if (!parJour.has(date)) parJour.set(date, []);
    parJour.get(date).push(event);
  };

  for (const p of paires) {
    const date = parisDateStr(p.entree.horodatage_utc);
    push(date, p.entree);
    push(date, p.sortie);
  }
  // Les événements non appariés restent rattachés à LEUR jour (l'anomalie doit
  // apparaître à la date où elle s'est produite).
  for (const a of anomalies) {
    if (!a.horodatage_utc) continue;
    const orphelin = (events || []).find((e) => e.horodatage_utc === a.horodatage_utc
      && !paires.some((p) => p.entree === e || p.sortie === e));
    if (orphelin) push(parisDateStr(orphelin.horodatage_utc), orphelin);
  }

  const planning = options.planning || {};
  return [...parJour.keys()].sort().map((date) => {
    const jour = parJour.get(date).sort((a, b) => a.horodatage_utc - b.horodatage_utc);
    return computeDay(jour, params, {
      date,
      heure_planifiee_debut: planning[date] || options.heure_planifiee_debut || null,
    });
  });
}

// ── 5. Mois ────────────────────────────────────────────────────────────────

/**
 * Agrège des journées calculées en feuille de temps mensuelle (BO-04).
 * `heures_theoriques` n'est JAMAIS inventé : il vaut null si l'appelant ne le
 * fournit pas (options.heures_theoriques), et l'écart vaut alors null aussi.
 *
 * @param {Array} days sorties de computeDay
 * @param {object} params grille badgeuse.*
 * @param {object} options { periode:'YYYY-MM', heures_theoriques:number|null }
 */
function computeMonth(days, params = {}, options = {}) {
  const jours = (days || []).filter((d) => d && d.date)
    .filter((d) => !options.periode || String(d.date).slice(0, 7) === options.periode)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const minutes = jours.reduce((acc, d) => acc + (Number(d.minutes) || 0), 0);
  const anomalies = jours.flatMap((d) => d.anomalies || []);
  const heuresTheoriques = options.heures_theoriques == null ? null : round2(options.heures_theoriques);
  const heuresPointees = minutesToDecimal(minutes);

  // Taux de pointages complets (indicateur NOTE_RH §9, ADR-0002 addendum §4).
  // DÉNOMINATEUR : les seules journées SOUMISES à l'attendu (celles qui
  // dépassent le seuil de pause) — une demi-journée n'a pas à porter 4
  // pointages. Aucune journée concernée (ou paramètres absents) → `null`,
  // jamais 0 % : « jamais de valeur inventée ».
  const joursSoumis = jours.filter((d) => journeeSoumiseAttenduPointages(d, params));
  const joursComplets = joursSoumis.filter((d) => !pointagesIncomplets(d, params));

  return {
    periode: options.periode || (jours[0] ? String(jours[0].date).slice(0, 7) : null),
    jours_travailles: jours.filter((d) => (Number(d.minutes) || 0) > 0).length,
    minutes,
    heures_pointees: heuresPointees,
    heures_hms: minutesToHms(minutes),
    heures_theoriques: heuresTheoriques,
    ecart_heures: heuresTheoriques == null ? null : round2(heuresPointees - heuresTheoriques),
    pause_deduite_minutes: round2(jours.reduce((acc, d) => acc + (Number(d.pause_deduite_minutes) || 0), 0)),
    nb_anomalies: anomalies.length,
    jours_pointage_attendu: joursSoumis.length,
    jours_pointage_complet: joursComplets.length,
    taux_pointages_complets_pct: joursSoumis.length === 0
      ? null
      : round2((joursComplets.length / joursSoumis.length) * 100),
    detail: jours,
  };
}

// ── 6. Anomalies (BO-05) ───────────────────────────────────────────────────

/**
 * Une journée est-elle CONCERNÉE par l'attendu de pointages (règle 7) ?
 * Seules les journées qui dépassent le seuil de pause le sont : exiger 4
 * pointages d'une matinée de 4 h serait une règle inventée. Rend `false` si
 * l'un des deux paramètres n'est pas fourni (aucune règle → aucun signalement).
 */
function journeeSoumiseAttenduPointages(day, params = {}) {
  const attendus = Math.max(0, Number(params.pointages_par_jour) || 0);
  const seuilMin = Math.max(0, Number(params.pause_deduite_seuil_heures) || 0) * 60;
  if (attendus <= 0 || seuilMin <= 0 || !day) return false;
  return (Number(day.minutes_brutes) || 0) > seuilMin;
}

/**
 * La journée compte-t-elle MOINS d'événements que params.pointages_par_jour
 * alors qu'elle y est soumise ? (ADR-0002 addendum §4, QA-05.)
 */
function pointagesIncomplets(day, params = {}) {
  if (!journeeSoumiseAttenduPointages(day, params)) return false;
  const attendus = Math.max(0, Number(params.pointages_par_jour) || 0);
  return (Number(day.nb_pointages) || 0) < attendus;
}

/**
 * Aplatit les anomalies de journées calculées et y ajoute les anomalies
 * transverses fournies par l'appelant (orphelins, pointages hors plage — qui
 * sont détectés à l'INGESTION côté serveur, pas au calcul).
 *
 * Y ajoute `pointages_incomplets` (règle 7) : signalement de SÉVÉRITÉ `info`
 * — la journée est payée (la déduction forfaitaire de pause s'applique déjà et
 * est tracée dans `regles_appliquees`), mais la pause n'a pas été badgée, ce
 * que l'encadrant doit pouvoir régulariser. Une sévérité `alerte` noierait la
 * page d'anomalies, le cas étant le plus fréquent.
 *
 * @param {Array} days sorties de computeDay
 * @param {object} params grille badgeuse.*
 * @param {object} options { employee_id, orphelins:Array, hors_plage:Array }
 */
function detectAnomalies(days, params = {}, options = {}) {
  const out = [];
  for (const d of days || []) {
    if (pointagesIncomplets(d, params)) {
      out.push({
        employee_id: options.employee_id == null ? null : options.employee_id,
        date: d.date,
        type: 'pointages_incomplets',
        severite: 'info',
        detail: `${Number(d.nb_pointages) || 0} pointage(s) sur ${Math.max(0, Number(params.pointages_par_jour) || 0)} attendus`,
        pointage_id: null,
      });
    }
    for (const a of d.anomalies || []) {
      out.push({
        employee_id: options.employee_id == null ? null : options.employee_id,
        date: a.date || d.date,
        type: a.type,
        severite: a.severite || 'alerte',
        detail: a.detail || null,
        pointage_id: a.pointage_id == null ? null : a.pointage_id,
      });
    }
  }
  for (const o of options.orphelins || []) {
    out.push({
      employee_id: null,
      date: o.horodatage_utc ? parisDateStr(o.horodatage_utc) : null,
      type: 'orphelin',
      severite: 'alerte',
      detail: o.orphelin_raison || null,
      pointage_id: o.id == null ? null : Number(o.id),
    });
  }
  return out.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

/**
 * Un instant tombe-t-il hors de la plage d'acceptation (heure murale Paris) ?
 * Utilisé à l'INGESTION (route device) : hors plage → statut `orphelin`, jamais
 * un rejet (aucune heure ne se perd, PST-04). Bornes inclusives.
 */
function estHorsPlage(instant, params = {}) {
  const debut = String(params.plage_acceptation_debut || '');
  const fin = String(params.plage_acceptation_fin || '');
  if (!/^\d{1,2}:\d{2}$/.test(debut) || !/^\d{1,2}:\d{2}$/.test(fin)) return false;
  const d = toDate(instant);
  if (!d) return false;
  const hhmm = parisTimeStr(d);
  const pad = (s) => String(s).padStart(5, '0');
  return pad(hhmm) < pad(debut) || pad(hhmm) > pad(fin);
}

module.exports = {
  PARIS_TZ,
  // fuseau
  parisOffsetMinutes,
  parisWallClockToUTC,
  parisDateStr,
  parisTimeStr,
  parisDateTimeToUTC,
  // utilitaires
  toDate,
  toMs,
  round2,
  minutesToHms,
  minutesToDecimal,
  // jours ouvrés & heures théoriques (BO-04)
  JOURS_OUVRES_SEMAINE,
  estJourOuvre,
  joursOuvresDuMois,
  joursOuvresEcoules,
  heuresTheoriquesMois,
  // moteur
  buildEffectiveEvents,
  filterDaysToPeriod,
  pairEvents,
  arrondirInstant,
  ajusterEntree,
  ajusterSortie,
  computeDay,
  computeDays,
  computeMonth,
  detectAnomalies,
  journeeSoumiseAttenduPointages,
  pointagesIncomplets,
  estHorsPlage,
};

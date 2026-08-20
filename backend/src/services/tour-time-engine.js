/**
 * Moteur de temps des tournées de collecte — fonctions PURES.
 *
 * Aucun accès base / réseau / horloge : les distances-durées entre deux points
 * arrivent par la fonction `routeLeg` INJECTÉE par l'appelant (OSRM en
 * production, repli Haversine, ou stub déterministe dans les tests). Le câblage
 * SQL/OSRM vit dans routes/tours/* — ce module ne contient QUE les règles de
 * temps de travail, de pause et de vidage, pour qu'elles soient identiques quel
 * que soit le mode de création de la tournée (IA / modèle standard / manuel /
 * association) et testables unitairement.
 *
 * RÈGLES MÉTIER (exigences client, août 2026) :
 *  1. JOURNÉE = 6 h de TRAVAIL au maximum (`maxWorkMinutes`). Le travail
 *     comprend la conduite, le temps de collecte à chaque point ET les
 *     déchargements au centre de tri.
 *  2. PAUSE DÉJEUNER obligatoire, prise AU CENTRE DE TRI et HORS temps de
 *     travail : sa durée n'entre pas dans les 6 h. En revanche les TRAJETS pour
 *     y aller (et en repartir vers le point suivant) SONT du travail.
 *     Elle devient due dès que l'une des deux conditions est remplie :
 *       (a) `lunchAfterMinutes` de travail cumulé, ou
 *       (b) l'heure d'horloge atteint `lunchStartHour`.
 *     Elle est prise UNE seule fois, au moment où elle devient due (contrôle
 *     avant chaque point). Une tournée qui se termine avant que la pause soit
 *     due n'en comporte pas (on ne fabrique pas une pause après la fin).
 *  3. RETOURS DE VIDAGE : dès que la charge cumulée dépasserait
 *     `returnThresholdKg` en ajoutant le point suivant, le véhicule rentre
 *     vider au centre AVANT d'y aller. Trajet + `unloadMinutes` = du travail.
 *     Si la charge n'est pas nulle au moment de la pause déjeuner, le vidage se
 *     fait au même passage (un SEUL trajet, le déchargement reste du travail).
 *  4. RETOUR FINAL au centre : trajet (travail) + `unloadMinutes` si le
 *     véhicule est chargé.
 *
 * Toutes les minutes renvoyées sont comptées depuis le DÉPART (élapsé réel,
 * pause incluse) ; `duree_travail_min` en revanche EXCLUT toujours la pause.
 */

// ──────────────────────────────────────────────────────────────
// Défauts du moteur — miroir des clés `SCORING_CONFIG` correspondantes
// (routes/tours/predictions.js). Ils ne servent que si l'appelant n'a rien
// passé : en production la config admin persistée fait foi.
// ──────────────────────────────────────────────────────────────
const DEFAULTS = {
  maxWorkMinutes: 360,      // 6 h de travail
  lunchBreakMinutes: 30,
  lunchAfterMinutes: 240,   // 4 h de travail cumulé
  lunchStartHour: 12,
  startHour: 8,
  unloadMinutes: 15,
  returnThresholdKg: 2000,
  capacityKg: 0,
  maxConsecutiveRejects: 3, // planWithBudget : arrêt du balayage (voir plus bas)
};

function num(value, fallback) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : fallback;
}

function isFiniteCoord(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n);
}

/** Minutes depuis minuit → 'HH:MM' (modulo 24 h, jamais de valeur négative). */
function minutesToHHMM(totalMinutes) {
  const m = Math.round(num(totalMinutes, 0));
  const wrapped = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Seuil effectif de vidage : le plus contraignant entre le seuil métier en kg
 * (`returnEveryKg`, historique) et le taux de remplissage du véhicule réel
 * (`vehicleFillReturnPct` % de sa capacité). Une valeur absente/nulle/négative
 * est ignorée ; si aucune n'est exploitable on renvoie `Infinity` (jamais de
 * vidage fabriqué).
 *
 * @param {object} p
 * @param {number} [p.returnEveryKg]        seuil kg legacy (0/absent → ignoré)
 * @param {number} [p.vehicleFillReturnPct] % de la capacité (0/absent → ignoré)
 * @param {number} [p.capacityKg]           capacité du véhicule (kg)
 * @returns {number} seuil en kg (Infinity si aucun seuil exploitable)
 */
function resolveReturnThresholdKg({ returnEveryKg, vehicleFillReturnPct, capacityKg } = {}) {
  const candidates = [];
  const kg = num(returnEveryKg, 0);
  if (kg > 0) candidates.push(kg);
  const pct = num(vehicleFillReturnPct, 0);
  const cap = num(capacityKg, 0);
  if (pct > 0 && cap > 0) candidates.push((pct / 100) * cap);
  return candidates.length ? Math.min(...candidates) : Infinity;
}

/** Normalise les options + applique les défauts. */
function resolveOptions(opts = {}) {
  const center = opts.center || {};
  return {
    routeLeg: typeof opts.routeLeg === 'function' ? opts.routeLeg : null,
    maxWorkMinutes: Math.max(0, num(opts.maxWorkMinutes, DEFAULTS.maxWorkMinutes)),
    lunchBreakMinutes: Math.max(0, num(opts.lunchBreakMinutes, DEFAULTS.lunchBreakMinutes)),
    lunchAfterMinutes: Math.max(0, num(opts.lunchAfterMinutes, DEFAULTS.lunchAfterMinutes)),
    lunchStartHour: num(opts.lunchStartHour, DEFAULTS.lunchStartHour),
    startHour: num(opts.startHour, DEFAULTS.startHour),
    unloadMinutes: Math.max(0, num(opts.unloadMinutes, DEFAULTS.unloadMinutes)),
    // `Infinity` est une valeur LÉGITIME (aucun seuil de vidage exploitable,
    // cf. resolveReturnThresholdKg) : elle doit traverser `num` sans être
    // remplacée par le défaut. Un seuil nul/négatif désactive aussi le vidage.
    returnThresholdKg: opts.returnThresholdKg === Infinity
      ? Infinity
      : (num(opts.returnThresholdKg, DEFAULTS.returnThresholdKg) > 0
        ? num(opts.returnThresholdKg, DEFAULTS.returnThresholdKg)
        : Infinity),
    capacityKg: Math.max(0, num(opts.capacityKg, DEFAULTS.capacityKg)),
    maxConsecutiveRejects: Math.max(1, num(opts.maxConsecutiveRejects, DEFAULTS.maxConsecutiveRejects)),
    center: {
      lat: num(center.lat, null),
      lng: num(center.lng, null),
      name: center.name || 'Centre de tri',
    },
  };
}

/** Clé de mémoïsation d'un tronçon (5 décimales ≈ 1 m). */
function legKey(a, b) {
  const f = (v) => (isFiniteCoord(v) ? Number(v).toFixed(5) : 'x');
  return `${f(a.lat)},${f(a.lng)}>${f(b.lat)},${f(b.lng)}`;
}

/**
 * Enveloppe la fonction `routeLeg` injectée :
 *  - mémoïse les tronçons déjà demandés (le retour au centre est redemandé à
 *    chaque test de budget) ;
 *  - neutralise proprement une coordonnée manquante ou une erreur du routeur
 *    (tronçon 0 km / 0 min) au lieu de propager NaN dans tous les cumuls.
 */
function makeLegResolver(routeLeg, onWarning) {
  const cache = new Map();
  return async function resolveLeg(from, to) {
    if (!isFiniteCoord(from.lat) || !isFiniteCoord(from.lng)
      || !isFiniteCoord(to.lat) || !isFiniteCoord(to.lng)) {
      if (onWarning) onWarning(to.name || from.name || null);
      return { km: 0, minutes: 0 };
    }
    const key = legKey(from, to);
    if (cache.has(key)) return cache.get(key);
    let leg = { km: 0, minutes: 0 };
    try {
      const raw = routeLeg ? await routeLeg(from, to) : null;
      leg = {
        km: Math.max(0, num(raw && raw.km, 0)),
        minutes: Math.max(0, num(raw && raw.minutes, 0)),
      };
    } catch (_) {
      leg = { km: 0, minutes: 0 };
    }
    cache.set(key, leg);
    return leg;
  };
}

/** Point d'entrée normalisé (tolère les colonnes SQL en chaîne). */
function normalizePoint(p, index) {
  return {
    id: p.id != null ? p.id : null,
    type: p.type === 'association' ? 'association' : 'cav',
    name: p.name || null,
    lat: num(p.lat, null),
    lng: num(p.lng, null),
    serviceMinutes: Math.max(0, num(p.serviceMinutes, 0)),
    weightKg: Math.max(0, num(p.weightKg, 0)),
    _index: index,
  };
}

// ──────────────────────────────────────────────────────────────
// Simulation incrémentale (cœur commun aux deux fonctions publiques)
// ──────────────────────────────────────────────────────────────

function initialState(o) {
  return {
    workMinutes: 0,      // conduite + collecte + déchargements (PAUSE EXCLUE)
    pauseMinutes: 0,     // pause déjeuner effectivement prise
    distanceKm: 0,
    loadKg: 0,           // charge courante du véhicule
    peakLoadKg: 0,       // pic de charge avant vidage (→ taux de remplissage)
    collectedKg: 0,      // total collecté sur la journée
    lunchTaken: false,
    unloadStops: 0,      // retours de vidage INTERMÉDIAIRES (hors retour final)
    position: { lat: o.center.lat, lng: o.center.lng, name: o.center.name },
    timeline: [{ type: 'depart', name: o.center.name, arrivee_min: 0, depart_min: 0 }],
    points: [],          // points effectivement desservis (objets normalisés)
  };
}

function cloneState(s) {
  return {
    ...s,
    position: { ...s.position },
    timeline: s.timeline.slice(),
    points: s.points.slice(),
  };
}

/** Minutes écoulées depuis le départ (travail + pause). */
function elapsed(s) {
  return s.workMinutes + s.pauseMinutes;
}

/** La pause déjeuner est-elle due à cet instant ? */
function lunchDue(s, o) {
  if (s.lunchTaken) return false;
  if (o.lunchBreakMinutes <= 0) return false;
  if (s.workMinutes >= o.lunchAfterMinutes) return true;
  return (o.startHour * 60 + elapsed(s)) >= o.lunchStartHour * 60;
}

/** Ajoute le passage au centre pour la pause déjeuner (vidage si chargé). */
async function applyLunch(s, o, resolveLeg) {
  const leg = await resolveLeg(s.position, o.center);
  s.workMinutes += leg.minutes;
  s.distanceKm += leg.km;
  s.position = { lat: o.center.lat, lng: o.center.lng, name: o.center.name };

  const arrivee = elapsed(s);
  if (s.loadKg > 0) {
    // Vidage au même passage : UN seul trajet, le déchargement reste du travail.
    s.workMinutes += o.unloadMinutes;
    s.loadKg = 0;
    s.unloadStops += 1;
    s.timeline.push({
      type: 'retour_vidage', name: o.center.name,
      arrivee_min: Math.round(arrivee), depart_min: Math.round(elapsed(s)),
      poids_cumule_kg: 0,
    });
  }
  const pauseStart = elapsed(s);
  s.pauseMinutes += o.lunchBreakMinutes;
  s.lunchTaken = true;
  s.timeline.push({
    type: 'pause_dejeuner', name: o.center.name,
    arrivee_min: Math.round(pauseStart), depart_min: Math.round(elapsed(s)),
  });
}

/** Ajoute un retour de vidage intermédiaire (capacité atteinte). */
async function applyUnloadReturn(s, o, resolveLeg) {
  const leg = await resolveLeg(s.position, o.center);
  s.workMinutes += leg.minutes;
  s.distanceKm += leg.km;
  s.position = { lat: o.center.lat, lng: o.center.lng, name: o.center.name };
  const arrivee = elapsed(s);
  s.workMinutes += o.unloadMinutes;
  s.loadKg = 0;
  s.unloadStops += 1;
  s.timeline.push({
    type: 'retour_vidage', name: o.center.name,
    arrivee_min: Math.round(arrivee), depart_min: Math.round(elapsed(s)),
    poids_cumule_kg: 0,
  });
}

/**
 * Ajoute UN point à l'état (pause + vidage préalables si dus, trajet, service).
 * Mute `s`. L'appelant décide de committer ou non (cf. planWithBudget).
 */
async function applyPoint(s, point, o, resolveLeg) {
  if (lunchDue(s, o)) await applyLunch(s, o, resolveLeg);

  if (s.loadKg > 0 && s.loadKg + point.weightKg > o.returnThresholdKg) {
    await applyUnloadReturn(s, o, resolveLeg);
  }

  const leg = await resolveLeg(s.position, { lat: point.lat, lng: point.lng, name: point.name });
  s.workMinutes += leg.minutes;
  s.distanceKm += leg.km;
  const arrivee = elapsed(s);
  s.workMinutes += point.serviceMinutes;
  s.loadKg += point.weightKg;
  s.collectedKg += point.weightKg;
  if (s.loadKg > s.peakLoadKg) s.peakLoadKg = s.loadKg;
  s.position = { lat: point.lat, lng: point.lng, name: point.name };
  s.points.push(point);

  const entry = {
    type: 'point',
    name: point.name,
    arrivee_min: Math.round(arrivee),
    depart_min: Math.round(elapsed(s)),
    poids_cumule_kg: Math.round(s.loadKg * 10) / 10,
  };
  if (point.type === 'association') entry.association_point_id = point.id;
  else entry.cav_id = point.id;
  s.timeline.push(entry);
}

/** Retour final au centre (trajet + déchargement si le véhicule est chargé). */
async function applyFinalReturn(s, o, resolveLeg) {
  const leg = await resolveLeg(s.position, o.center);
  s.workMinutes += leg.minutes;
  s.distanceKm += leg.km;
  const arrivee = elapsed(s);
  if (s.loadKg > 0) {
    s.workMinutes += o.unloadMinutes;
    s.loadKg = 0;
  }
  s.position = { lat: o.center.lat, lng: o.center.lng, name: o.center.name };
  s.timeline.push({
    type: 'retour_final', name: o.center.name,
    arrivee_min: Math.round(arrivee), depart_min: Math.round(elapsed(s)),
    poids_cumule_kg: 0,
  });
}

/** Coût en minutes de travail du retour final depuis l'état courant. */
async function finalReturnCost(s, o, resolveLeg) {
  const leg = await resolveLeg(s.position, o.center);
  return leg.minutes + (s.loadKg > 0 ? o.unloadMinutes : 0);
}

// ──────────────────────────────────────────────────────────────
// Restitution
// ──────────────────────────────────────────────────────────────

function buildEstimation(s, o, warnings) {
  const work = Math.round(s.workMinutes);
  const budget = Math.round(o.maxWorkMinutes);
  const depassement = Math.max(0, work - budget);
  const startMinutes = o.startHour * 60;
  const total = Math.round(s.workMinutes + s.pauseMinutes);
  const capacite = Math.round(o.capacityKg);
  const avertissements = warnings.slice();

  if (depassement > 0) {
    avertissements.unshift(
      `Durée de travail estimée à ${Math.floor(work / 60)} h ${String(work % 60).padStart(2, '0')} — `
      + `au-delà du maximum de ${Math.round(budget / 60 * 10) / 10} h (dépassement de ${depassement} min).`
    );
  }
  if (capacite > 0 && s.peakLoadKg > capacite) {
    avertissements.push(
      `Charge maximale estimée (${Math.round(s.peakLoadKg)} kg) supérieure à la capacité du véhicule `
      + `(${capacite} kg) — un vidage supplémentaire sera nécessaire.`
    );
  }

  return {
    faisable: depassement === 0,
    duree_travail_min: work,
    duree_totale_min: total,
    budget_travail_min: budget,
    depassement_min: depassement,
    distance_km: Math.round(s.distanceKm * 10) / 10,
    poids_estime_kg: Math.round(s.collectedKg),
    capacite_vehicule_kg: capacite,
    taux_remplissage_vehicule_pct: capacite > 0 ? Math.round((s.peakLoadKg / capacite) * 100) : 0,
    nb_points: s.points.length,
    nb_retours_vidage: s.unloadStops,
    pause_dejeuner_incluse: s.lunchTaken,
    pause_dejeuner_min: Math.round(s.pauseMinutes),
    heure_depart: minutesToHHMM(startMinutes),
    // Suffixe « (+N j) » quand la fin déborde sur le(s) jour(s) suivant(s)
    // (tournée forcée au-delà du budget) : sans lui, « 08:00 → 05:52 » se lit
    // comme une fin AVANT le départ.
    heure_fin_estimee: (() => {
      const endMinutes = startMinutes + total;
      const days = Math.floor(endMinutes / 1440);
      return days > 0 ? `${minutesToHHMM(endMinutes)} (+${days} j)` : minutesToHHMM(endMinutes);
    })(),
    timeline: s.timeline,
    avertissements,
  };
}

// ──────────────────────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────────────────────

/**
 * Estime une tournée dont la LISTE DE POINTS EST FIXE (modes standard, manuel,
 * association, ou simulation `POST /tours/estimate`). Aucun point n'est retiré :
 * si la journée ne tient pas dans le budget, l'estimation le dit
 * (`faisable: false`, `depassement_min > 0`) — c'est l'appelant qui décide de
 * refuser la création ou de forcer.
 *
 * @param {Array} points  points ORDONNÉS {id,type,name,lat,lng,serviceMinutes,weightKg}
 * @param {object} opts   cf. resolveOptions (+ `routeLeg` injectée)
 * @returns {Promise<object>} objet `estimation` (contrat API)
 */
async function buildTimeline(points, opts = {}) {
  const o = resolveOptions(opts);
  const warnings = [];
  const missingCoords = new Set();
  const resolveLeg = makeLegResolver(o.routeLeg, (name) => {
    if (name) missingCoords.add(name);
  });

  const normalized = (points || []).map(normalizePoint);
  const s = initialState(o);

  for (const point of normalized) {
    await applyPoint(s, point, o, resolveLeg);
  }
  await applyFinalReturn(s, o, resolveLeg);

  if (missingCoords.size > 0) {
    warnings.push(
      `Coordonnées manquantes pour ${missingCoords.size} point(s) (${[...missingCoords].slice(0, 3).join(', ')}`
      + `${missingCoords.size > 3 ? '…' : ''}) — distances et durées sous-estimées.`
    );
  }
  return buildEstimation(s, o, warnings);
}

/**
 * Sélection GLOUTONNE sous contrainte de budget (mode « tournée intelligente ») :
 * parcourt les candidats DANS L'ORDRE FOURNI et n'en retient un que si, RETOUR
 * FINAL COMPRIS, le budget de travail tient encore. Un candidat qui ne tient pas
 * est rejeté et le balayage continue (un point plus proche, plus loin dans la
 * liste, peut encore tenir) ; il s'arrête après `maxConsecutiveRejects` refus
 * consécutifs pour ne pas multiplier les appels au routeur.
 *
 * @returns {Promise<{selected: Array, rejected: Array, estimation: object}>}
 *          `selected`/`rejected` contiennent les OBJETS D'ORIGINE (l'appelant y
 *          retrouve ses CAV pour, par exemple, signaler une saturation non couverte).
 */
async function planWithBudget(candidates, opts = {}) {
  const o = resolveOptions(opts);
  const warnings = [];
  const missingCoords = new Set();
  const resolveLeg = makeLegResolver(o.routeLeg, (name) => {
    if (name) missingCoords.add(name);
  });

  const source = candidates || [];
  const normalized = source.map(normalizePoint);
  let s = initialState(o);
  const selected = [];
  const rejected = [];
  let streak = 0;
  let stopped = false;

  for (let i = 0; i < normalized.length; i++) {
    if (stopped) { rejected.push(source[i]); continue; }
    const candidate = cloneState(s);
    await applyPoint(candidate, normalized[i], o, resolveLeg);
    const cost = await finalReturnCost(candidate, o, resolveLeg);
    if (candidate.workMinutes + cost <= o.maxWorkMinutes) {
      s = candidate;
      selected.push(source[i]);
      streak = 0;
    } else {
      rejected.push(source[i]);
      streak += 1;
      if (streak >= o.maxConsecutiveRejects) stopped = true;
    }
  }

  await applyFinalReturn(s, o, resolveLeg);

  if (missingCoords.size > 0) {
    warnings.push(
      `Coordonnées manquantes pour ${missingCoords.size} point(s) (${[...missingCoords].slice(0, 3).join(', ')}`
      + `${missingCoords.size > 3 ? '…' : ''}) — distances et durées sous-estimées.`
    );
  }
  if (rejected.length > 0) {
    warnings.push(
      `${rejected.length} point(s) écarté(s) : la journée de ${Math.round(o.maxWorkMinutes / 60 * 10) / 10} h `
      + 'de travail (pause déjeuner exclue) ne permet pas de les desservir.'
    );
  }

  return { selected, rejected, estimation: buildEstimation(s, o, warnings) };
}

module.exports = {
  DEFAULTS,
  buildTimeline,
  planWithBudget,
  resolveReturnThresholdKg,
  minutesToHHMM,
};

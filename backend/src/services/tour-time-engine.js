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
 *  5. POINTS À CONTRAINTE HORAIRE (associations, août 2026) — deux champs
 *     OPTIONNELS par point, tous deux exprimés en minutes d'HORLOGE :
 *       - `windows` : plages d'accessibilité du jour ([[540,720],…]). `null` =
 *         horaires INCONNUS (on ne bloque pas sur une information absente) ;
 *         `[]` = fermé toute la journée. Un service qui ne tient pas dans une
 *         plage produit une VIOLATION `hors_horaires` — mais JAMAIS d'attente :
 *         arriver à 11h55 devant un local qui rouvre à 14h ne doit pas
 *         fabriquer deux heures d'attente silencieuse. Seul l'ancrage attend.
 *       - `anchor` : fenêtre effective d'un RENDEZ-VOUS ({debutMin, finMin}).
 *         Une arrivée en avance crée une entrée `attente` explicite (imputée au
 *         travail ou hors travail selon `attenteCompteTravail`) ; une arrivée
 *         après la fenêtre produit une violation `rdv_manque`.
 *     Le moteur SIGNALE (`violations`), il n'élimine jamais un point de
 *     lui-même : c'est la route appelante qui refuse ou laisse forcer.
 *
 * ⚠ DEUX RÉFÉRENTIELS DE TEMPS COEXISTENT — ne jamais les mélanger :
 *   - minutes ÉCOULÉES depuis le départ : tout ce qui est suffixé `_min` dans
 *     la timeline et l'estimation (`arrivee_min`, `depart_min`, `fin_service_min`…) ;
 *   - minutes d'HORLOGE depuis minuit : `windows`, `anchor.debutMin/finMin`,
 *     `prochain_creneau_min`, `plages`. La conversion est `clockMin()`, le même
 *     calcul que celui qui décide la pause déjeuner.
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
  // Attente devant un rendez-vous : l'équipage est en service, elle compte donc
  // dans le budget de travail (arbitrage client 3a, août 2026). Réversible sans
  // code par le réglage `attenteCompteTravail` d'AdminPredictive.
  attenteCompteTravail: true,
};

function num(value, fallback) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Coercition défensive d'un booléen de configuration : les réglages admin
 * transitent par JSON/settings et peuvent arriver en chaîne. Toute valeur
 * non reconnue retombe sur le défaut (jamais d'interprétation inventée).
 */
function coerceBool(value, fallback) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
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

/**
 * Position de départ d'une simulation reprise en cours de journée : là où se
 * trouve réellement l'équipage. Renvoie `null` — donc « le centre de tri » —
 * dès qu'une coordonnée manque : simuler depuis un point inventé serait pire
 * que de repartir du centre, qui est au moins un lieu connu.
 */
function normalizeStartPosition(p) {
  if (!p) return null;
  const lat = num(p.lat, null);
  const lng = num(p.lng, null);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, name: p.name || 'Position actuelle' };
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
    attenteCompteTravail: coerceBool(opts.attenteCompteTravail, DEFAULTS.attenteCompteTravail),
    // ── REPRISE EN COURS DE JOURNÉE (2.47.0) ──
    // Le moteur simulait toujours une journée VIERGE, partie du centre à
    // l'heure théorique. Rejouer une tournée déjà entamée avec ces hypothèses
    // place la pause déjeuner d'après une journée qui n'a pas eu lieu : c'est
    // ainsi qu'une pause s'est retrouvée en 15e étape alors qu'il était midi et
    // que le camion en était à sa 3e borne (constat client du 02/09/2026).
    // Ces trois options laissent l'appelant amorcer la simulation sur le RÉEL.
    //
    // `priorWorkMinutes` n'entre PAS dans l'élapsé : l'horloge repart de
    // `startHour` (= l'heure qu'il est), le travail déjà fait ne se rejoue pas.
    // Il ne pèse que là où il a un sens — le déclencheur « après N heures de
    // travail » de la pause, et le dépassement du budget de la journée.
    priorWorkMinutes: Math.max(0, num(opts.priorWorkMinutes, 0)),
    lunchAlreadyTaken: coerceBool(opts.lunchAlreadyTaken, false),
    // Point de départ de la simulation. `null` = le centre de tri, comportement
    // historique inchangé pour tous les appelants existants.
    startPosition: normalizeStartPosition(opts.startPosition),
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

// ──────────────────────────────────────────────────────────────
// Fenêtres horaires (minutes d'HORLOGE depuis minuit)
// ──────────────────────────────────────────────────────────────

/**
 * Coercition défensive des plages d'accessibilité d'un point.
 *
 * Distinction NON négociable : `null` = horaires inconnus (aucun contrôle),
 * `[]` = fermé toute la journée (tout passage est hors horaires). Une entrée
 * malformée invalide TOUT le jeu de plages et retombe sur `null` plutôt que
 * d'être silencieusement écartée : d'une donnée douteuse on ne fabrique pas une
 * fermeture, qui bloquerait la planification sur une information qu'on n'a pas.
 *
 * @returns {Array<[number, number]>|null}
 */
function normalizeWindows(raw) {
  if (raw == null || !Array.isArray(raw)) return null;
  const out = [];
  for (const plage of raw) {
    if (!Array.isArray(plage) || plage.length < 2) return null;
    const debut = num(plage[0], null);
    const fin = num(plage[1], null);
    // Une plage à l'envers (fin < début) ne peut jamais être satisfaite :
    // la retenir reviendrait à inventer une contrainte impossible.
    if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin < debut) return null;
    out.push([debut, fin]);
  }
  return out;
}

/**
 * Coercition défensive de la fenêtre effective d'un rendez-vous.
 * Les DEUX bornes sont exigées (l'appelant les produit ensemble, tolérance
 * comprise) : une borne manquante ne se devine pas, l'ancrage est alors ignoré.
 * Une fenêtre à l'envers est conservée telle quelle — elle produira un
 * `rdv_manque` honnête plutôt qu'un élargissement inventé.
 *
 * @returns {{debutMin: number, finMin: number}|null}
 */
function normalizeAnchor(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const debutMin = num(raw.debutMin, null);
  const finMin = num(raw.finMin, null);
  if (!Number.isFinite(debutMin) || !Number.isFinite(finMin)) return null;
  return { debutMin, finMin };
}

/**
 * L'intervalle [debutMin ; finMin] tient-il ENTIÈREMENT dans une plage ?
 * Plages `null` (inconnues) → true : inconnu n'est pas interdit.
 */
function fitsInWindows(debutMin, finMin, windows) {
  if (windows === null) return true;
  return windows.some(([d, f]) => debutMin >= d && finMin <= f);
}

/**
 * Premier instant d'horloge, à `afterMin` ou plus tard, où un service de
 * `serviceMinutes` tient entièrement dans une plage. `null` si aucune plage ne
 * peut l'accueillir (jour fermé, plage plus courte que le service, journée
 * déjà terminée) — jamais de créneau de remplacement inventé.
 */
function nextWindowStart(windows, serviceMinutes, afterMin) {
  if (!Array.isArray(windows)) return null;
  let best = null;
  for (const [debut, fin] of windows) {
    const start = Math.max(debut, afterMin);
    if (start + serviceMinutes <= fin && (best === null || start < best)) best = start;
  }
  return best;
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
    // Contraintes horaires (optionnelles) : un point qui ne les porte pas se
    // comporte EXACTEMENT comme avant — `null` désactive tout contrôle.
    windows: normalizeWindows(p.windows),
    anchor: normalizeAnchor(p.anchor),
    _index: index,
  };
}

// ──────────────────────────────────────────────────────────────
// Simulation incrémentale (cœur commun aux deux fonctions publiques)
// ──────────────────────────────────────────────────────────────

function initialState(o) {
  // D'où l'on part : la position réelle de l'équipage si elle est fournie,
  // le centre de tri sinon (cas de la planification, inchangé).
  const depart = o.startPosition || o.center;
  return {
    // Travail déjà accompli AVANT cette simulation (reprise en cours de
    // journée). Hors élapsé, hors distance : il ne compte que pour savoir si la
    // pause est due et si le budget de la journée est déjà entamé.
    priorWorkMinutes: o.priorWorkMinutes,
    workMinutes: 0,      // conduite + collecte + déchargements (PAUSE EXCLUE)
    pauseMinutes: 0,     // pause déjeuner effectivement prise
    distanceKm: 0,
    loadKg: 0,           // charge courante du véhicule
    peakLoadKg: 0,       // pic de charge avant vidage (→ taux de remplissage)
    collectedKg: 0,      // total collecté sur la journée
    // Attente devant un rendez-vous. `waitMinutes` sert au SEUL affichage
    // (`duree_attente_min`) ; `waitOffWorkMinutes` est la part qui n'est PAS
    // imputée au travail et qu'il faut donc compter à part dans l'élapsé.
    // Séparer les deux évite de polluer `pause_dejeuner_min`, qui doit rester
    // la seule pause déjeuner (une attente n'est pas un déjeuner).
    waitMinutes: 0,
    waitOffWorkMinutes: 0,
    violations: [],      // signalements horaires (le moteur ne décide de rien)
    lunchTaken: o.lunchAlreadyTaken,
    unloadStops: 0,      // retours de vidage INTERMÉDIAIRES (hors retour final)
    position: { lat: depart.lat, lng: depart.lng, name: depart.name },
    timeline: [{ type: 'depart', name: depart.name, arrivee_min: 0, depart_min: 0 }],
    points: [],          // points effectivement desservis (objets normalisés)
  };
}

function cloneState(s) {
  return {
    ...s,   // `priorWorkMinutes` est un scalaire : la copie superficielle suffit
    position: { ...s.position },
    timeline: s.timeline.slice(),
    points: s.points.slice(),
    // Sans cette copie, un candidat REJETÉ par planWithBudget laisserait ses
    // violations dans l'état committé : on signalerait un problème d'horaires
    // sur un point qui ne fait finalement pas partie de la tournée.
    violations: s.violations.slice(),
  };
}

/**
 * Minutes écoulées depuis le départ (travail + pause + attente hors travail).
 * L'attente IMPUTÉE AU TRAVAIL est déjà dans `workMinutes` : l'ajouter ici la
 * compterait deux fois.
 */
function elapsed(s) {
  return s.workMinutes + s.pauseMinutes + s.waitOffWorkMinutes;
}

/**
 * Heure d'horloge simulée, en minutes depuis MINUIT — le référentiel des
 * fenêtres d'accessibilité et des rendez-vous. Source unique : c'est le même
 * calcul qui déclenche la pause déjeuner (`lunchDue`).
 */
function clockMin(s, o) {
  return o.startHour * 60 + elapsed(s);
}

/** La pause déjeuner est-elle due à cet instant ? */
function lunchDue(s, o) {
  if (s.lunchTaken) return false;
  if (o.lunchBreakMinutes <= 0) return false;
  // Travail de la journée ENTIÈRE, pas seulement de la portion simulée : un
  // équipage qui a déjà quatre heures derrière lui a droit à sa pause tout de
  // suite, même si la simulation vient de commencer.
  if (s.priorWorkMinutes + s.workMinutes >= o.lunchAfterMinutes) return true;
  return clockMin(s, o) >= o.lunchStartHour * 60;
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
 * Ajoute UN point à l'état (pause + vidage préalables si dus, trajet, attente
 * de rendez-vous, contrôle d'accessibilité, service).
 * Mute `s`. L'appelant décide de committer ou non (cf. planWithBudget).
 *
 * ORDRE IMPOSÉ à l'arrivée : ancrage (qui peut faire AVANCER l'horloge), puis
 * accessibilité (qui n'avance jamais rien), puis service. L'inverse jugerait
 * les horaires d'ouverture sur une heure d'arrivée que l'attente va corriger.
 */
async function applyPoint(s, point, o, resolveLeg) {
  if (lunchDue(s, o)) await applyLunch(s, o, resolveLeg);

  if (s.loadKg > 0 && s.loadKg + point.weightKg > o.returnThresholdKg) {
    await applyUnloadReturn(s, o, resolveLeg);
  }

  const leg = await resolveLeg(s.position, { lat: point.lat, lng: point.lng, name: point.name });
  s.workMinutes += leg.minutes;
  s.distanceKm += leg.km;

  // ── 1. ANCRAGE : rendez-vous pris avec l'association ───────────────────
  if (point.anchor) {
    const arriveeClock = clockMin(s, o);
    if (arriveeClock < point.anchor.debutMin) {
      // Arrivée en avance : l'attente est EXPLICITE dans la chronologie. Elle
      // n'est jamais bornée : une attente absurde doit se voir (et faire sauter
      // le budget) plutôt que d'être rabotée en douce.
      const attente = point.anchor.debutMin - arriveeClock;
      const debutAttente = elapsed(s);
      if (o.attenteCompteTravail) s.workMinutes += attente;
      else s.waitOffWorkMinutes += attente;
      s.waitMinutes += attente;
      s.timeline.push({
        type: 'attente',
        name: point.name,
        arrivee_min: Math.round(debutAttente),
        depart_min: Math.round(elapsed(s)),
      });
    }
    // Après l'attente éventuelle : le rendez-vous est-il encore tenable ?
    if (clockMin(s, o) > point.anchor.finMin) {
      s.violations.push({
        type: 'rdv_manque',
        point_id: point.id,
        point_type: point.type,
        name: point.name,
        arrivee_min: Math.round(elapsed(s)),        // ÉLAPSÉ depuis le départ
        fenetre: { debutMin: point.anchor.debutMin, finMin: point.anchor.finMin }, // HORLOGE
      });
    }
  }

  const arrivee = elapsed(s);

  // ── 2. ACCESSIBILITÉ : horaires d'ouverture du local ───────────────────
  // Le service ENTIER doit tenir dans une plage. Aucune attente n'est générée
  // ici : un horaire d'ouverture n'est pas un rendez-vous, et faire patienter
  // une équipe jusqu'à la réouverture sans que personne l'ait décidé serait
  // pire que de signaler le problème au gestionnaire.
  if (point.windows !== null) {
    const debutService = clockMin(s, o);
    const finService = debutService + point.serviceMinutes;
    if (!fitsInWindows(debutService, finService, point.windows)) {
      s.violations.push({
        type: 'hors_horaires',
        point_id: point.id,
        point_type: point.type,
        name: point.name,
        arrivee_min: Math.round(arrivee),                              // ÉLAPSÉ
        fin_service_min: Math.round(arrivee + point.serviceMinutes),   // ÉLAPSÉ
        plages: point.windows.map(([d, f]) => [d, f]),                 // HORLOGE
        prochain_creneau_min: nextWindowStart(point.windows, point.serviceMinutes, debutService), // HORLOGE
      });
    }
  }

  // ── 3. Service : mécanique inchangée ──────────────────────────────────
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
  // Le budget de la journée se juge sur la journée ENTIÈRE : sur une reprise en
  // cours de route, le travail déjà fait est derrière l'équipage mais il a bien
  // été fait. `priorWorkMinutes` vaut 0 pour tous les appels de planification,
  // qui retrouvent donc exactement le chiffre d'avant.
  const work = Math.round(s.priorWorkMinutes + s.workMinutes);
  const budget = Math.round(o.maxWorkMinutes);
  const depassement = Math.max(0, work - budget);
  const startMinutes = o.startHour * 60;
  // `elapsed` et non `work + pause` : une attente NON imputée au travail est du
  // temps réellement passé, elle doit décaler l'heure de fin.
  const total = Math.round(elapsed(s));
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
    // Travail restant à faire, distinct du travail de la journée : sur une
    // reprise, confondre les deux ferait croire que tout est encore devant.
    duree_travail_restant_min: Math.round(s.workMinutes),
    duree_travail_deja_faite_min: Math.round(s.priorWorkMinutes),
    pause_dejeuner_incluse: s.lunchTaken,
    pause_dejeuner_min: Math.round(s.pauseMinutes),
    // Attente devant un rendez-vous, quelle que soit son imputation : elle est
    // comptée dans `duree_travail_min` si `attenteCompteTravail`, hors de lui
    // sinon, mais elle est TOUJOURS dans `duree_totale_min`.
    duree_attente_min: Math.round(s.waitMinutes),
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
    // TOUJOURS un tableau (vide = conforme). Le moteur signale, la route
    // appelante décide de refuser (409) ou de laisser forcer.
    violations: s.violations.slice(),
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
 * La sélection est pilotée par le SEUL budget : un point porteur d'une
 * violation d'horaires ou de rendez-vous n'est pas éliminé d'office — il est
 * retenu et sa violation remonte dans l'estimation, à charge de la route d'en
 * décider (refus 409 forçable). Une attente de rendez-vous, si elle compte dans
 * le travail, pèse en revanche sur le budget comme n'importe quelle minute.
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

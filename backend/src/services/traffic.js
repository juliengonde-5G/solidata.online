// ══════════════════════════════════════════════════════════════
// ÉVÉNEMENTS DE CIRCULATION (accidents, bouchons, fermetures)
// ──────────────────────────────────────────────────────────────
// Affichés sur la carte « Collecte en direct » pour que le gestionnaire voie
// ce qui gêne ses tournées en cours (demande client, août 2026 — arbitrage :
// source externe TomTom plutôt que saisie manuelle).
//
// DOCTRINE « jamais de valeur inventée » : sans clé API configurée, ou si le
// service ne répond pas, on renvoie `disponible: false` avec un message clair.
// On n'affiche JAMAIS une carte vide en la faisant passer pour « aucun
// incident » : une carte sans perturbation et une carte non renseignée sont
// deux choses différentes, et le gestionnaire doit pouvoir les distinguer.
//
// Clé : réglage `trafic.tomtom_api_key` (back-office), ou variable
// d'environnement TOMTOM_API_KEY. Aucune clé n'est codée en dur.
// ══════════════════════════════════════════════════════════════

const pool = require('../config/database');

const SETTINGS_KEY = 'trafic.tomtom_api_key';
const BASE_URL = 'https://api.tomtom.com/traffic/services/5/incidentDetails';
/** Au-delà, on considère que le service ne répond pas (la carte doit rester vive). */
const TIMEOUT_MS = 6000;
// ── Économie du quota (offre gratuite TomTom : 2 500 appels/mois) ──────────
// L'écran « Collecte en direct » interroge le trafic en continu tant qu'il est
// ouvert. Sans précaution, une seule journée de supervision épuise le forfait
// mensuel. Deux garde-fous, sans dégrader l'usage réel (les bouchons ne
// changent pas en 60 secondes) :
//   1. l'emprise est ARRONDIE à une grille de ~2 km : déplacer légèrement la
//      carte ne redéclenche plus d'appel (le cache d'origine, mono-emplacement
//      et à bbox exacte, ratait à chaque pixel de déplacement) ;
//   2. le cache retient PLUSIEURS emprises pendant 5 minutes : faire des
//      allers-retours entre deux zones ne coûte plus rien.
// Ordre de grandeur obtenu : ~100 appels/jour de supervision continue au lieu
// de 480+, soit une marge confortable sur le forfait.
const CACHE_MS = parseInt(process.env.TRAFIC_CACHE_MS, 10) || 5 * 60 * 1000;
/** Pas d'arrondi de l'emprise, en degrés (~2,2 km en latitude). */
const GRILLE_DEG = 0.02;
/** Nombre d'emprises retenues simultanément. */
const CACHE_MAX = 20;
const _cache = new Map();

/** Compteur d'appels réellement émis vers TomTom (supervision du quota). */
const _compteur = { appels: 0, depuis: new Date().toISOString(), dernier: null };

/**
 * Arrondit une emprise à la grille (fonction PURE) : deux vues voisines
 * partagent la même clé de cache, donc le même appel.
 */
function snapBbox({ sud, ouest, nord, est }) {
  const bas = (v) => Math.floor(v / GRILLE_DEG) * GRILLE_DEG;
  const haut = (v) => Math.ceil(v / GRILLE_DEG) * GRILLE_DEG;
  return {
    sud: Math.round(bas(sud) * 1e6) / 1e6,
    ouest: Math.round(bas(ouest) * 1e6) / 1e6,
    nord: Math.round(haut(nord) * 1e6) / 1e6,
    est: Math.round(haut(est) * 1e6) / 1e6,
  };
}

/** Consommation observée (exposée par la supervision, jamais estimée). */
function trafficUsage() {
  return { ..._compteur, emprises_en_cache: _cache.size, cache_ms: CACHE_MS };
}

/**
 * Traduction des catégories TomTom (iconCategory) vers nos libellés métier.
 * Les catégories non listées retombent sur « autre » plutôt que d'être
 * ignorées : un incident inconnu reste un incident à afficher.
 */
const CATEGORIES = {
  0: { type: 'autre', label: 'Perturbation' },
  1: { type: 'accident', label: 'Accident' },
  2: { type: 'autre', label: 'Brouillard' },
  3: { type: 'autre', label: 'Danger' },
  4: { type: 'autre', label: 'Pluie' },
  5: { type: 'autre', label: 'Verglas' },
  6: { type: 'bouchon', label: 'Embouteillage' },
  7: { type: 'fermeture', label: 'Voie fermée' },
  8: { type: 'fermeture', label: 'Route fermée' },
  9: { type: 'travaux', label: 'Travaux' },
  10: { type: 'autre', label: 'Vent' },
  11: { type: 'autre', label: 'Inondation' },
  14: { type: 'accident', label: 'Véhicule en panne' },
};

/** Clé API effective (réglage back-office, sinon variable d'environnement). */
async function getApiKey() {
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [SETTINGS_KEY]);
    const v = r.rows[0]?.value;
    if (v && String(v).trim()) return String(v).trim();
  } catch (err) {
    console.warn('[TRAFIC] Lecture de la clé API ignorée :', err.message);
  }
  return process.env.TOMTOM_API_KEY || null;
}

/**
 * Normalise une bbox « sud,ouest,nord,est » (fonction PURE, exportée pour les
 * tests). Renvoie null si elle est absente, mal formée ou aberrante — on
 * préfère refuser une requête qu'interroger le monde entier.
 */
function parseBbox(raw) {
  if (!raw) return null;
  const parts = String(raw).split(',').map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) return null;
  const [sud, ouest, nord, est] = parts;
  if (sud < -90 || nord > 90 || ouest < -180 || est > 180) return null;
  if (sud >= nord || ouest >= est) return null;
  // Garde-fou : une emprise démesurée ramènerait des milliers d'incidents sans
  // rapport avec la zone de collecte.
  if ((nord - sud) > 3 || (est - ouest) > 3) return null;
  return { sud, ouest, nord, est };
}

/**
 * Convertit une réponse TomTom en incidents exploitables par la carte
 * (fonction PURE, exportée pour les tests). Une entrée sans position est
 * ignorée : un incident qu'on ne sait pas placer n'a rien à faire sur la carte.
 */
function mapIncidents(payload) {
  const bruts = Array.isArray(payload?.incidents) ? payload.incidents : [];
  return bruts.map((inc, i) => {
    const props = inc?.properties || {};
    const coords = inc?.geometry?.coordinates;
    // Point : [lng, lat] ; LineString : [[lng, lat], …] → on prend l'origine.
    const premier = Array.isArray(coords) && Array.isArray(coords[0]) ? coords[0] : coords;
    const lng = Number(premier?.[0]); const lat = Number(premier?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const cat = CATEGORIES[props.iconCategory] || CATEGORIES[0];
    const description = (props.events || [])
      .map((e) => e?.description).filter(Boolean).join(' — ') || cat.label;
    return {
      id: String(props.id || `inc-${i}`),
      type: cat.type,
      label: cat.label,
      description,
      latitude: lat,
      longitude: lng,
      // magnitudeOfDelay : 0 inconnu → 4 majeur. Sert à graduer l'affichage.
      gravite: Number.isFinite(Number(props.magnitudeOfDelay)) ? Number(props.magnitudeOfDelay) : 0,
      retard_sec: Number.isFinite(Number(props.delay)) ? Number(props.delay) : null,
      debut: props.startTime || null,
      fin: props.endTime || null,
    };
  }).filter(Boolean);
}

/**
 * Incidents de circulation sur une emprise donnée.
 * @returns {{disponible:boolean, source?:string, incidents?:Array, message?:string}}
 */
async function getTrafficIncidents(bboxRaw) {
  const bbox = parseBbox(bboxRaw);
  if (!bbox) {
    return { disponible: false, message: 'Zone de recherche invalide ou trop étendue.' };
  }
  const key = await getApiKey();
  if (!key) {
    return {
      disponible: false,
      message: 'Les événements de circulation ne sont pas configurés. '
        + 'Renseignez une clé TomTom dans les réglages pour les afficher.',
      configuration_requise: true,
    };
  }

  const zone = snapBbox(bbox);
  const cacheKey = `${zone.sud},${zone.ouest},${zone.nord},${zone.est}`;
  const enCache = _cache.get(cacheKey);
  if (enCache && (Date.now() - enCache.ts) < CACHE_MS) {
    return enCache.data;
  }

  const params = new URLSearchParams({
    key,
    bbox: `${zone.ouest},${zone.sud},${zone.est},${zone.nord}`, // TomTom : min lon, min lat, max lon, max lat
    fields: '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,'
      + 'events{description,code},startTime,endTime,delay}}}',
    language: 'fr-FR',
    timeValidityFilter: 'present',
  });

  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_MS);
  try {
    _compteur.appels += 1;
    _compteur.dernier = new Date().toISOString();
    const rep = await fetch(`${BASE_URL}?${params}`, { signal: controleur.signal });
    if (!rep.ok) {
      // 403 = clé invalide ou quota dépassé : on le dit, on ne masque pas.
      return {
        disponible: false,
        message: rep.status === 403
          ? 'Clé TomTom refusée (clé invalide ou quota dépassé).'
          : `Service de trafic indisponible (code ${rep.status}).`,
      };
    }
    const data = { disponible: true, source: 'tomtom', incidents: mapIncidents(await rep.json()) };
    if (_cache.size >= CACHE_MAX) {
      const plusAncienne = _cache.keys().next().value;
      if (plusAncienne !== undefined) _cache.delete(plusAncienne);
    }
    _cache.set(cacheKey, { ts: Date.now(), data });
    return data;
  } catch (err) {
    const expire = err?.name === 'AbortError';
    console.warn('[TRAFIC] Appel TomTom en échec :', err.message);
    return {
      disponible: false,
      message: expire
        ? 'Le service de trafic n\'a pas répondu à temps.'
        : 'Service de trafic momentanément injoignable.',
    };
  } finally {
    clearTimeout(minuteur);
  }
}

module.exports = {
  getTrafficIncidents, parseBbox, mapIncidents, getApiKey, trafficUsage,
  snapBbox, SETTINGS_KEY, CATEGORIES, GRILLE_DEG, CACHE_MS,
};

// ══════════════════════════════════════════════════════════════════════════
// FACTEUR DE CIRCULATION DU JOUR (alimente le moteur de temps de travail)
// ══════════════════════════════════════════════════════════════════════════
//
// CONSTAT À L'ORIGINE : les incidents TomTom étaient AFFICHÉS sur la carte,
// mais le calcul des durées de tournée n'en tenait aucun compte — il lit
// `collection_context.traffic_factor`, qui n'était jamais alimenté et valait
// donc toujours 1 (circulation fluide) quelle que soit la réalité du terrain.
//
// PRINCIPE : on mesure, sur quelques points du réseau RÉELLEMENT parcouru, le
// rapport « temps de parcours actuel / temps à circulation fluide » (API
// TomTom Traffic Flow Segment Data). La moyenne devient le multiplicateur de
// durée du jour, consommé tel quel par le moteur (makeRouteLeg).
//
// POINTS DE SONDE : aucune coordonnée n'est inventée. Ce sont le centre de
// tri et des CAV de nos propres tournées — donc exactement là où roulent les
// camions. À défaut de tournée programmée, les CAV les plus collectés.
//
// COÛT : ~6 points × 3 mesures/jour × 20 jours ≈ 360 appels/mois, soit moins
// de 2 % du forfait gratuit « Traffic Flow Segment Data » (20 000/mois).
//
// DOCTRINE « jamais de valeur inventée » : sans clé, ou si moins de deux
// points répondent, AUCUNE écriture — le facteur reste à sa valeur connue
// plutôt que d'être remplacé par une moyenne d'un seul relevé.

const FLOW_URL = 'https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json';
/** Nombre de points de sonde (borne le coût en appels). */
const NB_SONDES = parseInt(process.env.TRAFIC_NB_SONDES, 10) || 5;
/** Minimum de relevés exploitables pour retenir une mesure. */
const MIN_RELEVES = 2;
/** Bornes du multiplicateur : au-delà, c'est une anomalie locale, pas la journée. */
const FACTEUR_MIN = 1;
const FACTEUR_MAX = 2;

/**
 * Multiplicateur de durée déduit des relevés (fonction PURE, testée).
 * Chaque relevé vaut `temps actuel / temps fluide`. On borne le résultat :
 * un ratio inférieur à 1 (plus rapide que la vitesse libre) n'a pas de sens
 * pour une estimation, et un tronçon fermé ne doit pas doubler toute la
 * journée de travail.
 * @returns {number|null} null si l'échantillon est insuffisant
 */
function facteurDepuisReleves(releves) {
  const ratios = (releves || [])
    .map((r) => {
      const actuel = Number(r?.currentTravelTime);
      const fluide = Number(r?.freeFlowTravelTime);
      if (!Number.isFinite(actuel) || !Number.isFinite(fluide) || fluide <= 0) return null;
      return actuel / fluide;
    })
    .filter((v) => v !== null && Number.isFinite(v) && v > 0);
  if (ratios.length < MIN_RELEVES) return null;
  const moyenne = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return Math.round(Math.min(FACTEUR_MAX, Math.max(FACTEUR_MIN, moyenne)) * 100) / 100;
}

/** Points de sonde : centre de tri + CAV réellement parcourus aujourd'hui. */
async function pointsDeSonde(dateStr) {
  const points = [{
    lat: parseFloat(process.env.CENTRE_TRI_LAT) || 49.4231,
    lng: parseFloat(process.env.CENTRE_TRI_LNG) || 1.0993,
    libelle: 'Centre de tri',
  }];
  try {
    const r = await pool.query(
      `SELECT c.latitude, c.longitude, c.name
         FROM tour_cav tc
         JOIN tours t ON t.id = tc.tour_id
         JOIN cav c ON c.id = tc.cav_id
        WHERE t.date = $1 AND t.is_demo IS NOT TRUE
          AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        ORDER BY tc.position
        LIMIT $2`,
      [dateStr, NB_SONDES]
    );
    let lignes = r.rows;
    if (lignes.length === 0) {
      // Aucune tournée programmée : on sonde les CAV les plus collectés, qui
      // sont sur les axes réellement empruntés.
      const f = await pool.query(
        `SELECT c.latitude, c.longitude, c.name
           FROM tonnage_history th
           JOIN cav c ON c.id = th.cav_id
          WHERE c.latitude IS NOT NULL AND c.longitude IS NOT NULL
          GROUP BY c.id, c.latitude, c.longitude, c.name
          ORDER BY COUNT(*) DESC
          LIMIT $1`,
        [NB_SONDES]
      );
      lignes = f.rows;
    }
    lignes.forEach((l) => points.push({
      lat: parseFloat(l.latitude), lng: parseFloat(l.longitude), libelle: l.name,
    }));
  } catch (err) {
    console.warn('[TRAFIC] Points de sonde indisponibles :', err.message);
  }
  return points;
}

/** Relevé de circulation en un point (null si le service ne répond pas). */
async function releverFlux(key, point) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_MS);
  try {
    _compteur.appels += 1;
    _compteur.dernier = new Date().toISOString();
    const url = `${FLOW_URL}?key=${encodeURIComponent(key)}&point=${point.lat},${point.lng}&unit=KMPH`;
    const rep = await fetch(url, { signal: controleur.signal });
    if (!rep.ok) return null;
    const data = await rep.json();
    const seg = data?.flowSegmentData;
    if (!seg) return null;
    return {
      libelle: point.libelle,
      currentSpeed: Number(seg.currentSpeed),
      freeFlowSpeed: Number(seg.freeFlowSpeed),
      currentTravelTime: Number(seg.currentTravelTime),
      freeFlowTravelTime: Number(seg.freeFlowTravelTime),
    };
  } catch (err) {
    console.warn('[TRAFIC] Relevé de flux en échec :', err.message);
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Mesure la circulation du jour et met à jour `collection_context`.
 * @param {string} [dateStr] jour civil (défaut : aujourd'hui, heure de Paris)
 * @returns {{mesure:boolean, facteur?:number, releves?:number, message?:string}}
 */
async function measureTrafficFactor(dateStr = null) {
  const jour = dateStr || new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' })
  ).toISOString().slice(0, 10);

  const key = await getApiKey();
  if (!key) {
    return {
      mesure: false, date: jour, configuration_requise: true,
      message: 'Aucune clé TomTom : le facteur de circulation reste à sa valeur connue.',
    };
  }

  const points = await pointsDeSonde(jour);
  const releves = (await Promise.all(points.map((p) => releverFlux(key, p)))).filter(Boolean);
  const facteur = facteurDepuisReleves(releves);

  if (facteur === null) {
    return {
      mesure: false, date: jour, releves: releves.length, points: points.length,
      message: `Relevés insuffisants (${releves.length}/${MIN_RELEVES} minimum) : aucune écriture.`,
    };
  }

  await pool.query(
    `INSERT INTO collection_context (date, traffic_factor, traffic_source, traffic_measured_at)
          VALUES ($1, $2, 'tomtom', CURRENT_TIMESTAMP)
     ON CONFLICT (date) DO UPDATE
             SET traffic_factor = EXCLUDED.traffic_factor,
                 traffic_source = EXCLUDED.traffic_source,
                 traffic_measured_at = EXCLUDED.traffic_measured_at,
                 updated_at = NOW()`,
    [jour, facteur]
  );

  return {
    mesure: true, date: jour, facteur,
    releves: releves.length, points: points.length,
    detail: releves.map((r) => ({
      point: r.libelle,
      vitesse_actuelle_kmh: r.currentSpeed,
      vitesse_fluide_kmh: r.freeFlowSpeed,
    })),
  };
}

module.exports.measureTrafficFactor = measureTrafficFactor;
module.exports.facteurDepuisReleves = facteurDepuisReleves;
module.exports.pointsDeSonde = pointsDeSonde;
module.exports.NB_SONDES = NB_SONDES;
module.exports.FACTEUR_MIN = FACTEUR_MIN;
module.exports.FACTEUR_MAX = FACTEUR_MAX;

// ── Cadence de mesure ─────────────────────────────────────────────────────
// Trois relevés par jour ouvré suffisent à qualifier une journée de collecte
// (départ, milieu de matinée, début d'après-midi) — la circulation d'un
// créneau ne bascule pas d'une minute à l'autre sur ce territoire.
// Le conteneur tourne en UTC : la décision est évaluée en Europe/Paris via
// Intl (fonction PURE, testable, changement d'heure géré) — même approche que
// la sauvegarde automatique de la base.
const HEURES_MESURE = (process.env.TRAFIC_HEURES_MESURE || '8,11,14')
  .split(',').map((v) => parseInt(v.trim(), 10)).filter(Number.isFinite);
const JOURS_MESURE = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Heure, jour et date civile à Paris (fonction PURE hors horloge). */
function partiesParis(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris', hour12: false, hour: '2-digit',
      year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    }).formatToParts(now).map((x) => [x.type, x.value])
  );
  return {
    heure: parseInt(parts.hour, 10) % 24,
    jour: parts.weekday,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Faut-il relever la circulation à cet instant ? (fonction PURE, testée) */
function shouldMeasureTraffic(now = new Date()) {
  const { heure, jour } = partiesParis(now);
  return JOURS_MESURE.includes(jour) && HEURES_MESURE.includes(heure);
}

module.exports.shouldMeasureTraffic = shouldMeasureTraffic;
module.exports.partiesParis = partiesParis;
module.exports.HEURES_MESURE = HEURES_MESURE;
module.exports.JOURS_MESURE = JOURS_MESURE;

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
/** Les incidents bougent lentement : un cache court évite de marteler l'API. */
const CACHE_MS = 60000;
let _cache = { ts: 0, key: null, data: null };

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

  const cacheKey = `${bbox.sud},${bbox.ouest},${bbox.nord},${bbox.est}`;
  if (_cache.data && _cache.key === cacheKey && (Date.now() - _cache.ts) < CACHE_MS) {
    return _cache.data;
  }

  const params = new URLSearchParams({
    key,
    bbox: `${bbox.ouest},${bbox.sud},${bbox.est},${bbox.nord}`, // TomTom : min lon, min lat, max lon, max lat
    fields: '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,'
      + 'events{description,code},startTime,endTime,delay}}}',
    language: 'fr-FR',
    timeValidityFilter: 'present',
  });

  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_MS);
  try {
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
    _cache = { ts: Date.now(), key: cacheKey, data };
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

module.exports = { getTrafficIncidents, parseBbox, mapIncidents, getApiKey, SETTINGS_KEY, CATEGORIES };

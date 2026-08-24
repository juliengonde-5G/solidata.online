// ══════════════════════════════════════════════════════════════════════════
// CACHE DES TRONÇONS ROUTIERS (route_legs_cache)
// ══════════════════════════════════════════════════════════════════════════
//
// POURQUOI
// Le moteur de temps demande une distance/durée ROUTIÈRE pour CHAQUE tronçon
// (centre → P1, P1 → P2, …). Une estimation de tournée de 16 points = ~20
// appels HTTP au routeur ; et l'écran de création recalcule l'estimation à
// CHAQUE point ajouté (debounce 600 ms) → ~200 appels pour composer une seule
// tournée. Multiplié par 4 véhicules × 20 jours, on dépasse le quota gratuit
// de n'importe quel routeur commercial et l'estimation dépend d'un tiers.
//
// CE QUI EST MIS EN CACHE — ET CE QUI NE L'EST PAS
// Le réseau routier entre deux bornes FIXES ne change pas : la distance et la
// durée « à vide » d'un tronçon sont stables. Elles sont donc calculées UNE
// fois puis relues. Le TRAFIC, lui, varie : il reste appliqué APRÈS le cache,
// en multipliant la durée (cf. makeRouteLeg(trafficFactor) dans smart-tour) —
// le cache ne fige donc jamais une condition de circulation.
//
// DOCTRINE « JAMAIS DE VALEUR INVENTÉE »
// Un repli Haversine × 1.3 (routeur injoignable) n'est JAMAIS persisté : le
// mettre en cache figerait une approximation à la place d'une mesure réelle,
// pour toujours. Il est renvoyé à l'appelant, pas mémorisé — le tronçon sera
// recalculé au prochain passage, quand le routeur répondra.

const pool = require('../config/database');
const { osrmRouteSegment } = require('../routes/tours/geo');

// Plafond du cache mémoire (processus). ~50 000 tronçons ≈ quelques Mo.
const MEMO_MAX = parseInt(process.env.ROUTE_CACHE_MEMO_MAX, 10) || 50000;

// Cache mémoire du processus : évite l'aller-retour SQL sur les tronçons déjà
// vus dans la même session de travail (une estimation en enchaîne 20).
const memo = new Map();

let tableDisponible = true; // faux si la table n'existe pas encore (base ancienne)

// ── Fonctions PURES (testables sans base ni réseau) ────────────────────────

/**
 * Arrondit une coordonnée à 5 décimales (~1,1 m) : deux passages sur la même
 * borne produisent la même clé, malgré le bruit de saisie.
 * @returns {number|null} null si la valeur n'est pas un nombre fini
 */
function roundCoord(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1e5) / 1e5;
}

/**
 * Clé d'un tronçon ORIENTÉ (A→B ≠ B→A : sens interdits, voies rapides).
 * @returns {string|null} null si une coordonnée est invalide
 */
function legKey(lat1, lng1, lat2, lng2) {
  const parts = [roundCoord(lat1), roundCoord(lng1), roundCoord(lat2), roundCoord(lng2)];
  if (parts.some((v) => v === null)) return null;
  return parts.join(',');
}

/** Un résultat n'est mémorisable que s'il vient d'une VRAIE mesure routière. */
function isCacheable(seg) {
  return !!seg && seg.source === 'osrm'
    && Number.isFinite(seg.distance_km) && Number.isFinite(seg.duration_min);
}

// ── Cache mémoire ─────────────────────────────────────────────────────────

function memoGet(key) {
  return memo.get(key) || null;
}

function memoSet(key, value) {
  if (memo.size >= MEMO_MAX) {
    // Éviction FIFO simple : la Map conserve l'ordre d'insertion.
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  memo.set(key, value);
}

function resetMemo() {
  memo.clear();
  tableDisponible = true;
}

// ── Accès base (best effort : une base non migrée ne casse jamais le calcul)

async function lireEnBase(db, key) {
  if (!db || !tableDisponible) return null;
  try {
    const r = await db.query(
      'SELECT distance_km, duration_min FROM route_legs_cache WHERE cle = $1',
      [key]
    );
    if (r.rows.length === 0) return null;
    // Compteur d'usage : incrémenté une seule fois par clé et par processus
    // (les relectures suivantes sont servies par le cache mémoire).
    db.query('UPDATE route_legs_cache SET hits = hits + 1, last_used_at = CURRENT_TIMESTAMP WHERE cle = $1', [key])
      .catch(() => { /* compteur non critique */ });
    return {
      distance_km: parseFloat(r.rows[0].distance_km),
      duration_min: parseFloat(r.rows[0].duration_min),
    };
  } catch (err) {
    if (err && err.code === '42P01') tableDisponible = false; // table absente
    else console.warn('[ROUTE-CACHE] lecture impossible :', err.message);
    return null;
  }
}

async function ecrireEnBase(db, key, coords, seg) {
  if (!db || !tableDisponible) return;
  try {
    await db.query(
      `INSERT INTO route_legs_cache (cle, from_lat, from_lng, to_lat, to_lng,
                                     distance_km, duration_min, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'osrm')
       ON CONFLICT (cle) DO UPDATE
               SET distance_km = EXCLUDED.distance_km,
                   duration_min = EXCLUDED.duration_min,
                   source = EXCLUDED.source,
                   computed_at = CURRENT_TIMESTAMP`,
      [key, coords[0], coords[1], coords[2], coords[3], seg.distance_km, seg.duration_min]
    );
  } catch (err) {
    if (err && err.code === '42P01') tableDisponible = false;
    else console.warn('[ROUTE-CACHE] écriture impossible :', err.message);
  }
}

// ── API publique ──────────────────────────────────────────────────────────

/**
 * Distance/durée routière d'un tronçon, servie par le cache quand elle a déjà
 * été mesurée. Signature et forme de retour identiques à osrmRouteSegment :
 * remplaçable partout sans adapter les appelants.
 *
 * @param {object} [deps] injection pour les tests : { routeSegment, pool }
 * @returns {Promise<{distance_km, duration_min, source}>}
 *          source : 'cache' | 'osrm' | 'haversine'
 */
async function cachedRouteSegment(lat1, lng1, lat2, lng2, deps = {}) {
  const routeSegment = deps.routeSegment || osrmRouteSegment;
  const db = 'pool' in deps ? deps.pool : pool;

  const key = legKey(lat1, lng1, lat2, lng2);
  if (!key) return routeSegment(lat1, lng1, lat2, lng2);

  const enMemoire = memoGet(key);
  if (enMemoire) return { ...enMemoire, source: 'cache' };

  const enBase = await lireEnBase(db, key);
  if (enBase) {
    memoSet(key, enBase);
    return { ...enBase, source: 'cache' };
  }

  const seg = await routeSegment(lat1, lng1, lat2, lng2);
  if (isCacheable(seg)) {
    const valeur = { distance_km: seg.distance_km, duration_min: seg.duration_min };
    memoSet(key, valeur);
    await ecrireEnBase(db, key, key.split(',').map(Number), valeur);
  }
  return seg;
}

/**
 * Précharge en UNE requête tous les tronçons déjà mesurés d'un jeu de paires.
 *
 * L'optimiseur d'ordre évalue des milliers de séquences : il ne peut pas
 * interroger le routeur dans sa boucle. Il lui faut donc une matrice en
 * mémoire, servie par ce préchargement — et, pour les paires jamais mesurées,
 * une approximation locale assumée (l'appelant mesure ENSUITE la séquence
 * retenue pour publier des chiffres réels).
 *
 * @param {Array<[number, number, number, number]>} paires [latA, lngA, latB, lngB]
 * @returns {Promise<Map<string, {distance_km, duration_min}>>}
 */
async function prefetchLegs(paires, deps = {}) {
  const db = 'pool' in deps ? deps.pool : pool;
  const trouves = new Map();
  const cles = [];
  (paires || []).forEach((p) => {
    const k = legKey(p[0], p[1], p[2], p[3]);
    if (!k) return;
    const enMemoire = memoGet(k);
    if (enMemoire) trouves.set(k, { distance_km: enMemoire.distance_km, duration_min: enMemoire.duration_min });
    else cles.push(k);
  });
  if (cles.length === 0 || !db || !tableDisponible) return trouves;
  try {
    const r = await db.query(
      'SELECT cle, distance_km, duration_min FROM route_legs_cache WHERE cle = ANY($1::text[])',
      [cles]
    );
    r.rows.forEach((row) => {
      const valeur = {
        distance_km: parseFloat(row.distance_km),
        duration_min: parseFloat(row.duration_min),
      };
      memoSet(row.cle, valeur);
      trouves.set(row.cle, valeur);
    });
  } catch (err) {
    if (err && err.code === '42P01') tableDisponible = false;
    else console.warn('[ROUTE-CACHE] préchargement impossible :', err.message);
  }
  return trouves;
}

/** Statistiques du cache (page d'administration / supervision). */
async function cacheStats(db = pool) {
  const stats = { memoire: memo.size, base: null, hits: null, dernier_calcul: null };
  if (!db) return stats;
  try {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(hits), 0)::int AS hits,
              MAX(computed_at) AS dernier
         FROM route_legs_cache`
    );
    stats.base = r.rows[0].n;
    stats.hits = r.rows[0].hits;
    stats.dernier_calcul = r.rows[0].dernier;
  } catch (_) { /* table absente : stats partielles honnêtes */ }
  return stats;
}

module.exports = {
  cachedRouteSegment,
  prefetchLegs,
  cacheStats,
  // exportés pour les tests unitaires
  roundCoord,
  legKey,
  isCacheable,
  resetMemo,
  MEMO_MAX,
};

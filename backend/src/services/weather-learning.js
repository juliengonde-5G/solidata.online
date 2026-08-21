// ═══════════════════════════════════════════════════════════════════════════
// APPRENTISSAGE MÉTÉO DES DÉPÔTS (demande client 08/2026)
// ───────────────────────────────────────────────────────────────────────────
// Constat métier : il y a plus de dépôts dans les bornes quand il fait beau,
// SURTOUT le week-end (les gens trient/rangent). Jusqu'ici cette réalité était
// codée en dur (« week-end ensoleillé → ×1.15 ») : ce module l'APPREND depuis
// l'expérience réelle de collecte.
//
// Méthode (honnête, bornée, jamais de valeur inventée) :
//   1. Chaque paire de collectes consécutives d'un CAV (tonnage_history) donne
//      un INTERVALLE : « D jours d'accumulation → K kg collectés ».
//   2. Chaque jour de l'intervalle est classé dans un des 4 SEGMENTS :
//      semaine/week-end × beau temps/autre (météo quotidienne historisée —
//      boutique_meteo_quotidien agrégée par date, repli collection_context).
//   3. Moindres carrés : K_i / r_c ≈ Σ_segment n_i,seg × f_seg, où r_c est le
//      débit moyen du CAV (kg/jour) — la taille du CAV est ainsi neutralisée,
//      on n'apprend que l'EFFET RELATIF des segments.
//   4. Facteurs normalisés (moyenne pondérée = 1) puis bornés [0.6, 1.6].
//      Ce qui est APPLIQUÉ au moteur, ce sont les RATIOS d'interaction :
//        beau_weekend = f_we_beau / f_we_autre   (remplace le 1.15 fixe)
//        beau_semaine = f_sem_beau / f_sem_autre (nouveau, défaut 1)
//      — l'effet week-end « de base » reste porté par les facteurs jour-de-
//      semaine déjà appris (predictive_seasonal_factors), pas de double compte.
//   5. Échantillon insuffisant (peu d'intervalles, segment sous-exposé,
//      couverture météo lacunaire) → AUCUNE écriture : le moteur garde la
//      règle par défaut et l'écran d'admin l'affiche tel quel.
//
// Job mensuel : recalcWeatherFactors() (scheduler, avec recalcSeasonalFactors).
// Résultat persisté dans predictive_weather_factors, lu avec cache 10 min.
// ═══════════════════════════════════════════════════════════════════════════
const pool = require('../config/database');

// Seuils « beau temps » (surchargeables par SCORING_CONFIG.beauTempsTempMin /
// beauTempsPrecipMm côté appelant) : journée sans pluie significative et douce.
const DEFAULTS = {
  tempMin: 15,        // °C de temp. max pour compter « beau »
  precipMax: 1,       // mm de pluie max
  maxGapDays: 45,     // au-delà, l'intervalle entre 2 collectes est écarté
  maxUnknownShare: 0.1, // part max de jours sans météo connue dans un intervalle
  minIntervalles: 60, // nb minimal d'intervalles exploitables
  minJoursSegment: 30, // exposition minimale de CHAQUE segment (en jours)
  clampFactor: [0.6, 1.6],
  clampRatio: [0.8, 1.5],
};

const SEGMENTS = ['sem_autre', 'sem_beau', 'we_autre', 'we_beau'];

function isoDate(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

/** Beau temps = journée douce sans pluie significative (seuils surchargables). */
function isBeauTemps(tempMax, precipMm, opts = {}) {
  const tMin = Number.isFinite(opts.tempMin) ? opts.tempMin : DEFAULTS.tempMin;
  const pMax = Number.isFinite(opts.precipMax) ? opts.precipMax : DEFAULTS.precipMax;
  if (tempMax == null || precipMm == null) return null; // météo inconnue
  return parseFloat(tempMax) >= tMin && parseFloat(precipMm) < pMax;
}

/**
 * Classe un jour dans un des 4 segments, ou null si la météo est inconnue.
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {{temp_max, precipitation_mm}|undefined} meteo
 */
function classifyDay(dateStr, meteo, opts = {}) {
  const beau = meteo ? isBeauTemps(meteo.temp_max, meteo.precipitation_mm, opts) : null;
  if (beau == null) return null;
  const day = new Date(`${isoDate(dateStr)}T12:00:00Z`).getUTCDay(); // 0=dim, 6=sam
  const weekend = day === 0 || day === 6;
  if (weekend) return beau ? 'we_beau' : 'we_autre';
  return beau ? 'sem_beau' : 'sem_autre';
}

/**
 * Construit les intervalles entre collectes consécutives par CAV.
 * @param {Array<{cav_id, date, kg}>} rows Une ligne par (CAV, jour de collecte),
 *        kg = total collecté ce jour-là. Doivent être triables par date.
 * @returns {Array<{cavId, start, end, days, kg}>} start exclu, end inclus.
 */
function buildIntervals(rows, opts = {}) {
  const maxGap = opts.maxGapDays || DEFAULTS.maxGapDays;
  const byCav = new Map();
  for (const r of rows) {
    const kg = parseFloat(r.kg);
    if (!Number.isFinite(kg) || kg <= 0) continue;
    const list = byCav.get(r.cav_id) || [];
    list.push({ date: isoDate(r.date), kg });
    byCav.set(r.cav_id, list);
  }
  const intervals = [];
  for (const [cavId, list] of byCav) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 1; i < list.length; i++) {
      const days = Math.round(
        (Date.parse(`${list[i].date}T00:00:00Z`) - Date.parse(`${list[i - 1].date}T00:00:00Z`)) / 86400000
      );
      if (days <= 0 || days > maxGap) continue;
      intervals.push({ cavId, start: list[i - 1].date, end: list[i].date, days, kg: list[i].kg });
    }
  }
  return intervals;
}

/** Jours (start, end] d'un intervalle, en 'YYYY-MM-DD'. */
function intervalDays(start, end) {
  const out = [];
  let t = Date.parse(`${start}T00:00:00Z`) + 86400000;
  const endT = Date.parse(`${end}T00:00:00Z`);
  for (; t <= endT; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Résout X f = y au sens des moindres carrés via équations normales 4×4. */
function solveLeastSquares(rowsX, y) {
  const n = 4;
  const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let k = 0; k < rowsX.length; k++) {
    const x = rowsX[k];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] += x[i] * x[j];
      A[i][n] += x[i] * y[k];
    }
  }
  // Élimination de Gauss avec pivot partiel
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    if (Math.abs(A[pivot][col]) < 1e-9) return null; // matrice singulière
    [A[col], A[pivot]] = [A[pivot], A[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}

const clamp = ([lo, hi], v) => Math.min(hi, Math.max(lo, v));

/**
 * Estime les 4 facteurs de segment depuis les intervalles et la météo par date.
 * PUR : aucune I/O. Renvoie { ok:false, raison } si les données ne suffisent pas.
 * @param {Array} intervals sortie de buildIntervals()
 * @param {Map<string,{temp_max,precipitation_mm}>} meteoByDate
 */
function estimateWeatherFactors(intervals, meteoByDate, opts = {}) {
  const o = { ...DEFAULTS, ...opts };

  // 1. Composition par segment de chaque intervalle (couverture météo exigée)
  const kept = [];
  let ecartesMeteo = 0;
  for (const it of intervals) {
    const counts = { sem_autre: 0, sem_beau: 0, we_autre: 0, we_beau: 0 };
    let unknown = 0;
    for (const day of intervalDays(it.start, it.end)) {
      const seg = classifyDay(day, meteoByDate.get(day), o);
      if (seg == null) unknown++;
      else counts[seg]++;
    }
    if (unknown / it.days > o.maxUnknownShare) { ecartesMeteo++; continue; }
    kept.push({ ...it, counts, known: it.days - unknown });
  }

  // 2. Débit de base par CAV (kg/jour) sur ses intervalles retenus
  const perCav = new Map();
  for (const it of kept) {
    const agg = perCav.get(it.cavId) || { kg: 0, days: 0 };
    agg.kg += it.kg; agg.days += it.known;
    perCav.set(it.cavId, agg);
  }
  const usable = kept.filter((it) => {
    const agg = perCav.get(it.cavId);
    return agg && agg.days >= 14 && agg.kg > 0;
  });

  const jours = { sem_autre: 0, sem_beau: 0, we_autre: 0, we_beau: 0 };
  for (const it of usable) for (const s of SEGMENTS) jours[s] += it.counts[s];

  if (usable.length < o.minIntervalles) {
    return { ok: false, raison: `intervalles exploitables insuffisants (${usable.length} < ${o.minIntervalles})`, intervalles: usable.length, jours, ecartes_meteo: ecartesMeteo };
  }
  const sousExpose = SEGMENTS.find((s) => jours[s] < o.minJoursSegment);
  if (sousExpose) {
    return { ok: false, raison: `segment « ${sousExpose} » sous-exposé (${jours[sousExpose]} j < ${o.minJoursSegment})`, intervalles: usable.length, jours, ecartes_meteo: ecartesMeteo };
  }

  // 3. Moindres carrés sur les observations normalisées par le débit du CAV
  const X = []; const y = [];
  for (const it of usable) {
    const agg = perCav.get(it.cavId);
    const rate = agg.kg / agg.days;
    X.push(SEGMENTS.map((s) => it.counts[s]));
    y.push(it.kg / rate);
  }
  const solved = solveLeastSquares(X, y);
  if (!solved || solved.some((v) => !Number.isFinite(v) || v <= 0)) {
    return { ok: false, raison: 'système non résoluble (données dégénérées)', intervalles: usable.length, jours, ecartes_meteo: ecartesMeteo };
  }

  // 4. Normalisation (moyenne pondérée par l'exposition = 1) + bornes
  const totalJours = SEGMENTS.reduce((s, k) => s + jours[k], 0);
  const mean = SEGMENTS.reduce((s, k, i) => s + jours[k] * solved[i], 0) / totalJours;
  const facteurs = {};
  SEGMENTS.forEach((k, i) => { facteurs[k] = Math.round(clamp(o.clampFactor, solved[i] / mean) * 1000) / 1000; });

  const ratios = {
    beau_weekend: Math.round(clamp(o.clampRatio, facteurs.we_beau / facteurs.we_autre) * 1000) / 1000,
    beau_semaine: Math.round(clamp(o.clampRatio, facteurs.sem_beau / facteurs.sem_autre) * 1000) / 1000,
  };

  return {
    ok: true, facteurs, ratios, jours,
    intervalles: usable.length,
    cavs: perCav.size,
    ecartes_meteo: ecartesMeteo,
  };
}

// ─── Orchestration (I/O) ────────────────────────────────────────────────────

async function ensureTable(client = pool) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS predictive_weather_factors (
      segment VARCHAR(20) PRIMARY KEY,
      factor DOUBLE PRECISION NOT NULL,
      jours INTEGER,
      intervalles INTEGER,
      cavs INTEGER,
      computed_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

/** Charge la météo quotidienne : boutiques (moyenne par date), repli contexte collecte. */
async function loadMeteoByDate(months) {
  const meteo = new Map();
  const ctx = await pool.query(
    `SELECT date, temp_max, precip_mm AS precipitation_mm
       FROM collection_context
      WHERE date >= NOW() - make_interval(months => $1)`,
    [months]
  );
  for (const r of ctx.rows) meteo.set(isoDate(r.date), r);
  // Les boutiques historisent la météo quotidiennement depuis 04/2026 —
  // meilleure couverture, elle PRIME sur le contexte collecte (posé après).
  const btq = await pool.query(
    `SELECT date, AVG(temp_max) AS temp_max, AVG(precipitation_mm) AS precipitation_mm
       FROM boutique_meteo_quotidien
      WHERE date >= NOW() - make_interval(months => $1)
      GROUP BY date`,
    [months]
  );
  for (const r of btq.rows) meteo.set(isoDate(r.date), r);
  return meteo;
}

/**
 * Job mensuel : recalcule et persiste les facteurs météo appris.
 * En données insuffisantes, ne touche PAS au dernier apprentissage valide.
 */
async function recalcWeatherFactors({ months = 24 } = {}) {
  // Seuils « beau temps » alignés sur la config du moteur (require paresseux,
  // predictions.js require ce module à son chargement).
  let cfg = {};
  try { cfg = require('../routes/tours/predictions').getScoringConfig() || {}; } catch (_) { /* tests */ }
  const opts = {
    tempMin: Number.isFinite(cfg.beauTempsTempMin) ? cfg.beauTempsTempMin : undefined,
    precipMax: Number.isFinite(cfg.beauTempsPrecipMm) ? cfg.beauTempsPrecipMm : undefined,
  };

  const tonnage = await pool.query(
    `SELECT cav_id, date, SUM(weight_kg) AS kg
       FROM tonnage_history
      WHERE cav_id IS NOT NULL AND date >= NOW() - make_interval(months => $1)
      GROUP BY cav_id, date
      ORDER BY cav_id, date`,
    [months]
  );
  const meteoByDate = await loadMeteoByDate(months);
  const intervals = buildIntervals(tonnage.rows);
  const result = estimateWeatherFactors(intervals, meteoByDate, opts);

  if (!result.ok) {
    console.log(`[WEATHER-LEARNING] Apprentissage non appliqué : ${result.raison}`);
    return result;
  }

  await ensureTable();
  for (const seg of SEGMENTS) {
    await pool.query(
      `INSERT INTO predictive_weather_factors (segment, factor, jours, intervalles, cavs, computed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (segment) DO UPDATE
         SET factor = EXCLUDED.factor, jours = EXCLUDED.jours,
             intervalles = EXCLUDED.intervalles, cavs = EXCLUDED.cavs,
             computed_at = NOW()`,
      [seg, result.facteurs[seg], result.jours[seg], result.intervalles, result.cavs]
    );
  }
  console.log(
    `[WEATHER-LEARNING] Facteurs appris (${result.intervalles} intervalles, ${result.cavs} CAV) : `
    + SEGMENTS.map((s) => `${s}=${result.facteurs[s]}`).join(' ')
  );
  invalidateCache();
  return result;
}

// ─── Lecture avec cache (consommée par le moteur de prédiction) ─────────────
let _cache = null;
let _cacheAt = 0;
const CACHE_MS = 10 * 60 * 1000;

function invalidateCache() { _cache = null; _cacheAt = 0; }

/**
 * Facteurs appris + ratios appliqués par le moteur.
 * { ok:false } tant que l'apprentissage n'a pas produit (le moteur garde alors
 * la règle par défaut week-end ensoleillé × weekendSunnyBonus).
 */
async function getLearnedWeatherRatios() {
  if (_cache && Date.now() - _cacheAt < CACHE_MS) return _cache;
  try {
    const r = await pool.query('SELECT segment, factor, jours, intervalles, cavs, computed_at FROM predictive_weather_factors');
    if (r.rows.length === SEGMENTS.length) {
      const facteurs = {};
      for (const row of r.rows) facteurs[row.segment] = parseFloat(row.factor);
      if (SEGMENTS.every((s) => Number.isFinite(facteurs[s]) && facteurs[s] > 0)) {
        _cache = {
          ok: true,
          facteurs,
          ratios: {
            beau_weekend: Math.round(clamp(DEFAULTS.clampRatio, facteurs.we_beau / facteurs.we_autre) * 1000) / 1000,
            beau_semaine: Math.round(clamp(DEFAULTS.clampRatio, facteurs.sem_beau / facteurs.sem_autre) * 1000) / 1000,
          },
          jours: Object.fromEntries(r.rows.map((row) => [row.segment, row.jours])),
          intervalles: r.rows[0].intervalles,
          cavs: r.rows[0].cavs,
          computed_at: r.rows[0].computed_at,
        };
        _cacheAt = Date.now();
        return _cache;
      }
    }
  } catch (err) {
    // Table absente (base pas encore migrée) ou indisponible : repli honnête.
    if (err.code !== '42P01') console.warn('[WEATHER-LEARNING] lecture ignorée :', err.message);
  }
  _cache = { ok: false };
  _cacheAt = Date.now();
  return _cache;
}

module.exports = {
  DEFAULTS,
  SEGMENTS,
  isBeauTemps,
  classifyDay,
  buildIntervals,
  intervalDays,
  estimateWeatherFactors,
  recalcWeatherFactors,
  getLearnedWeatherRatios,
  invalidateCache,
  ensureTable,
};

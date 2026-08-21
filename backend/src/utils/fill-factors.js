// ══════════════════════════════════════════════════════════════
// SOURCE UNIQUE DES FACTEURS DE REMPLISSAGE CAV (Vague 1 — item 50)
// ──────────────────────────────────────────────────────────────
// Avant ce module, trois jeux de facteurs saisonniers/jour vivaient en
// dur et divergeaient (cav.js /map, /fill-rate, /:id/activity + le moteur
// predictions.js). Ce module centralise :
//   1. la capacité d'un CAV (nb conteneurs × capacité unitaire) ;
//   2. les facteurs saisonniers (12 mois) et jour-de-semaine (7 jours) ;
//   3. le calcul « brut » de remplissage normalisé par la capacité.
//
// Hiérarchie de résolution d'un facteur (item 49), du plus prioritaire au
// moins prioritaire — documentée et exposée à l'UI via les *sources* :
//   1. APPRIS  — `predictive_seasonal_factors` (recalculé mensuellement sur
//                le tonnage réel des 24 derniers mois) ;
//   2. MANUEL  — override admin persisté dans `settings` (`predictive.config`) ;
//   3. DÉFAUT  — valeurs codées ci-dessous (calibrées 2025-2026).
//
// Aucune dépendance vers routes/tours/predictions.js (sens unique) pour
// éviter tout cycle : predictions.js et cav.js consomment CE module.
// ══════════════════════════════════════════════════════════════

const pool = require('../config/database');

// Capacité unitaire d'un conteneur (kg) : le POIDS D'UN CONTENEUR PLEIN À 100 %.
// C'est l'étalon de tout le calcul de remplissage — un CAV est « plein » quand
// il a accumulé nb_conteneurs × cette valeur. Il est désormais PARAMÉTRABLE
// (réglage `predictive.config`, champ `capacityKgPerContainer`) : la valeur
// dépend du modèle de conteneur et se mesure sur le terrain ; la figer à 150
// biaisait mécaniquement toutes les prédictions d'un parc qui ne s'y conforme
// pas. 150 reste le défaut historique quand rien n'est saisi.
const CAPACITY_KG_PER_CONTAINER = 150;
// Bornes de bon sens : en deçà/au-delà, c'est une saisie erronée, pas un
// réglage — on retombe alors sur le défaut plutôt que de fausser le moteur.
const CAPACITY_MIN_KG = 20;
const CAPACITY_MAX_KG = 2000;

/** Capacité unitaire effective (paramétrée si valide, sinon défaut). */
function resolveCapacityKg(config) {
  const v = Number(config?.capacityKgPerContainer);
  if (Number.isFinite(v) && v >= CAPACITY_MIN_KG && v <= CAPACITY_MAX_KG) return v;
  return CAPACITY_KG_PER_CONTAINER;
}

// Facteurs saisonniers par défaut (index 0 = janvier … 11 = décembre).
// Pic en août (1.27), creux en décembre (0.75) — calibrés sur données réelles.
const SEASONAL_DEFAULT = [0.88, 0.82, 0.94, 1.05, 1.12, 0.99, 1.19, 1.27, 1.13, 1.02, 0.84, 0.75];

// Facteurs jour-de-semaine par défaut (index 0 = lundi … 6 = dimanche).
// Lundi le plus lourd (accumulation weekend), jeudi bas (~50 %).
const DOW_DEFAULT = [1.25, 1.09, 1.05, 0.49, 1.11, 1.15, 1.1];

// Clé de persistance dans la table `settings`.
const SETTINGS_KEY = 'predictive.config';

// Cache mémoire court (config manuelle + facteurs appris résolus).
const CACHE_TTL_MS = 60 * 1000;
let _cache = { ts: 0, resolved: null, config: null };

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function clampFactor(v) {
  // Borne de sécurité des facteurs appris/manuels (mêmes bornes que la
  // reco IA d'ajustement) : évite qu'un facteur aberrant sature la prédiction.
  return Math.max(0.3, Math.min(2.5, v));
}

/**
 * Capacité totale d'un CAV en kg = nb conteneurs × capacité unitaire.
 * @param {number} nbContainers
 * @returns {number} capacité en kg (>= capacité d'un conteneur)
 */
function getCapacityKg(nbContainers, capacityPerContainer = CAPACITY_KG_PER_CONTAINER) {
  const n = parseInt(nbContainers, 10);
  const unit = Number.isFinite(Number(capacityPerContainer)) && Number(capacityPerContainer) > 0
    ? Number(capacityPerContainer) : CAPACITY_KG_PER_CONTAINER;
  return (Number.isFinite(n) && n > 0 ? n : 1) * unit;
}

/**
 * Calcul « brut » du taux de remplissage, NORMALISÉ PAR LA CAPACITÉ (item 48).
 * C'est le cœur dimensionnellement correct : on estime les kilos accumulés
 * depuis la dernière collecte puis on les divise par la capacité totale.
 *
 * kg accumulés = joursDepuisCollecte × (poidsMoyen ÷ cadence) × saisonnier × jour
 * remplissage % = kg accumulés ÷ capacité × 100  (borné 0 → maxFill)
 *
 * Fonction PURE (aucune I/O) → testable unitairement.
 *
 * @param {object} p
 * @param {number} p.daysSinceCollection  jours depuis la dernière collecte
 * @param {number} p.avgWeightKg          poids moyen par collecte (kg)
 * @param {number} p.avgDaysBetween       cadence moyenne réelle entre collectes (j)
 * @param {number} p.nbContainers         nombre de conteneurs du CAV
 * @param {number} [p.seasonalFactor=1]   multiplicateur saisonnier
 * @param {number} [p.dayFactor=1]        multiplicateur jour-de-semaine
 * @param {number} [p.maxFill=120]        borne haute (cap remplissage)
 * @returns {number} taux de remplissage estimé en % (0 → maxFill)
 */
function computeBaseFillPercent({
  daysSinceCollection,
  avgWeightKg,
  avgDaysBetween,
  nbContainers,
  seasonalFactor = 1,
  dayFactor = 1,
  maxFill = 120,
  capacityKgPerContainer = CAPACITY_KG_PER_CONTAINER,
}) {
  const capacityKg = getCapacityKg(nbContainers, capacityKgPerContainer);
  const cadence = Math.max(Number(avgDaysBetween) || 7, 1);
  const dailyAccumulationKg = (Number(avgWeightKg) || 0) / cadence;
  const days = Math.max(0, Number(daysSinceCollection) || 0);
  const season = Number(seasonalFactor) || 1;
  const dow = Number(dayFactor) || 1;
  const accumulatedKg = days * dailyAccumulationKg * season * dow;
  const pct = capacityKg > 0 ? (accumulatedKg / capacityKg) * 100 : 0;
  return Math.max(0, Math.min(maxFill, pct));
}

// ──────────────────────────────────────────────────────────────
// Lecture des couches (appris / manuel) + résolution
// ──────────────────────────────────────────────────────────────

async function _readConfig() {
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [SETTINGS_KEY]);
    if (!r.rows[0] || !r.rows[0].value) return {};
    const parsed = JSON.parse(r.rows[0].value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.warn('[FILL-FACTORS] Lecture config manuelle échouée :', err.message);
    return {};
  }
}

async function _readLearned() {
  const out = { monthly: {}, dow: {} };
  try {
    const r = await pool.query(
      "SELECT type, key, factor, sample_size FROM predictive_seasonal_factors WHERE type IN ('monthly','dow')"
    );
    for (const row of r.rows) {
      const f = parseFloat(row.factor);
      if (!isFiniteNum(f) || f <= 0) continue;                 // ignore 0 / négatif / NaN
      if ((parseInt(row.sample_size, 10) || 0) <= 0) continue; // ignore les périodes sans données
      const key = parseInt(row.key, 10);
      if (row.type === 'monthly') out.monthly[key] = clampFactor(f);
      else out.dow[key] = clampFactor(f);
    }
  } catch (err) {
    // Table absente (schéma ancien) → pas de facteurs appris, on retombera sur manuel/défaut.
    if (err.code !== '42P01') console.warn('[FILL-FACTORS] Lecture facteurs appris échouée :', err.message);
  }
  return out;
}

// jsDay (0=dim … 6=sam, cf. Date.getDay()) → index lundi-premier (0=lun … 6=dim)
function jsDayToLunIndex(jsDay) {
  return jsDay === 0 ? 6 : jsDay - 1;
}
// index lundi-premier → jsDay
function lunIndexToJsDay(lun) {
  return lun === 6 ? 0 : lun + 1;
}

function _resolve(config, learned) {
  const manualSeasonal = Array.isArray(config?.seasonalFactors) && config.seasonalFactors.length === 12
    ? config.seasonalFactors.map(Number) : null;
  const manualDow = Array.isArray(config?.dayOfWeekFactors) && config.dayOfWeekFactors.length === 7
    ? config.dayOfWeekFactors.map(Number) : null;

  const seasonal = new Array(12);
  const seasonalSources = new Array(12);
  for (let m = 0; m < 12; m++) {
    const learnedVal = learned.monthly[m + 1]; // clé mensuelle 1-12
    if (isFiniteNum(learnedVal)) {
      seasonal[m] = learnedVal; seasonalSources[m] = 'appris';
    } else if (manualSeasonal && isFiniteNum(manualSeasonal[m])) {
      seasonal[m] = manualSeasonal[m]; seasonalSources[m] = 'manuel';
    } else {
      seasonal[m] = SEASONAL_DEFAULT[m]; seasonalSources[m] = 'défaut';
    }
  }

  const dayOfWeek = new Array(7);
  const dayOfWeekSources = new Array(7);
  for (let lun = 0; lun < 7; lun++) {
    const learnedVal = learned.dow[lunIndexToJsDay(lun)]; // clé dow 0-6 (dim-sam)
    if (isFiniteNum(learnedVal)) {
      dayOfWeek[lun] = learnedVal; dayOfWeekSources[lun] = 'appris';
    } else if (manualDow && isFiniteNum(manualDow[lun])) {
      dayOfWeek[lun] = manualDow[lun]; dayOfWeekSources[lun] = 'manuel';
    } else {
      dayOfWeek[lun] = DOW_DEFAULT[lun]; dayOfWeekSources[lun] = 'défaut';
    }
  }

  return {
    seasonal, seasonalSources,
    dayOfWeek, dayOfWeekSources,
    capacityKgPerContainer: resolveCapacityKg(config),
    learnedMonthlyCount: Object.keys(learned.monthly).length,
    learnedDowCount: Object.keys(learned.dow).length,
  };
}

async function _refresh() {
  const [config, learned] = await Promise.all([_readConfig(), _readLearned()]);
  _cache = { ts: Date.now(), resolved: _resolve(config, learned), config };
}

async function _ensure() {
  if (!_cache.resolved || Date.now() - _cache.ts > CACHE_TTL_MS) {
    await _refresh();
  }
}

/**
 * Facteurs effectifs résolus (appris > manuel > défaut) + leur source.
 * @returns {Promise<{seasonal:number[], seasonalSources:string[], dayOfWeek:number[], dayOfWeekSources:string[], capacityKgPerContainer:number, learnedMonthlyCount:number, learnedDowCount:number}>}
 */
async function getResolvedFactors() {
  await _ensure();
  return _cache.resolved;
}

/**
 * Configuration manuelle persistée complète (facteurs override + jours fériés
 * + vacances + scoring). Objet vide si rien n'a été enregistré.
 */
async function getPersistedConfig() {
  await _ensure();
  return _cache.config || {};
}

/**
 * Facteur saisonnier effectif pour un index de mois (0=janvier … 11=décembre).
 */
function seasonalFactorFor(resolved, monthIndex) {
  return resolved.seasonal[((monthIndex % 12) + 12) % 12];
}

/**
 * Facteur jour effectif pour un jsDay (0=dimanche … 6=samedi, cf. Date.getDay()).
 */
function dayFactorFor(resolved, jsDay) {
  return resolved.dayOfWeek[jsDayToLunIndex(((jsDay % 7) + 7) % 7)];
}

/**
 * Persiste la configuration prédictive complète dans `settings` (upsert JSON)
 * et invalide le cache. Appelé par PUT /tours/predictive-config.
 * @param {object} config
 */
async function persistConfig(config) {
  await pool.query(
    `INSERT INTO settings (key, value, category, updated_at)
     VALUES ($1, $2, 'predictive', NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, category = 'predictive', updated_at = NOW()`,
    [SETTINGS_KEY, JSON.stringify(config)]
  );
  invalidateCache();
}

// ══════════════════════════════════════════════════════════════
// JALON DE REMISE À ZÉRO DU REMPLISSAGE
// ──────────────────────────────────────────────────────────────
// Demande client (août 2026) : « on relance tout à zéro à partir d'aujourd'hui,
// le moteur de prédiction démarre à partir d'aujourd'hui ».
//
// Plutôt que de DÉTRUIRE l'historique de tonnage — qui alimente aussi les KPI
// de collecte, la captation par commune et les déclarations Refashion —, on
// pose un JALON : une date à partir de laquelle tous les CAV sont réputés
// vides. Le calcul du remplissage prend alors comme dernière collecte
// effective le PLUS RÉCENT de (dernière collecte réelle, jalon).
//
// Conséquences : remplissage à 0 % partout le jour du jalon, aucune ligne
// supprimée, opération RÉVERSIBLE (il suffit d'effacer le réglage). Les poids
// moyens et cadences appris par le moteur restent disponibles.
// ══════════════════════════════════════════════════════════════
const RESET_SETTINGS_KEY = 'collecte.remplissage_reset_le';
let _resetCache = { ts: 0, value: undefined };

/** Jalon effectif (objet Date) ou null si aucun n'est posé. Cache 60 s. */
async function getResetDate() {
  const now = Date.now();
  if (_resetCache.value !== undefined && (now - _resetCache.ts) < 60000) return _resetCache.value;
  let value = null;
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [RESET_SETTINGS_KEY]);
    const raw = r.rows[0]?.value;
    if (raw) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) value = d;
    }
  } catch (err) {
    // Table settings absente (base neuve) → pas de jalon, comportement normal.
    console.warn('[FILL] Lecture du jalon de remise à zéro ignorée :', err.message);
  }
  _resetCache = { ts: now, value };
  return value;
}

/**
 * Dernière collecte EFFECTIVE d'un CAV (fonction PURE, testable) :
 * le plus récent entre la dernière collecte réelle et le jalon de remise à
 * zéro. Renvoie `null` si les deux sont absents — l'appelant garde alors son
 * comportement « aucun historique ».
 *
 * @param {Date|string|null} lastCollection dernière collecte réelle
 * @param {Date|null} resetDate jalon de remise à zéro
 * @returns {Date|null}
 */
function effectiveLastCollection(lastCollection, resetDate) {
  const last = lastCollection ? new Date(lastCollection) : null;
  const valid = last && !Number.isNaN(last.getTime()) ? last : null;
  if (!resetDate) return valid;
  if (!valid) return resetDate;
  return valid.getTime() >= resetDate.getTime() ? valid : resetDate;
}

function invalidateCache() {
  _cache = { ts: 0, resolved: null, config: null };
  _resetCache = { ts: 0, value: undefined };
}

module.exports = {
  CAPACITY_KG_PER_CONTAINER,
  CAPACITY_MIN_KG,
  CAPACITY_MAX_KG,
  resolveCapacityKg,
  SEASONAL_DEFAULT,
  DOW_DEFAULT,
  SETTINGS_KEY,
  getCapacityKg,
  computeBaseFillPercent,
  RESET_SETTINGS_KEY,
  getResetDate,
  effectiveLastCollection,
  getResolvedFactors,
  getPersistedConfig,
  seasonalFactorFor,
  dayFactorFor,
  jsDayToLunIndex,
  lunIndexToJsDay,
  persistConfig,
  invalidateCache,
};

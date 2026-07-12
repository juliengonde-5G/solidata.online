#!/usr/bin/env node
/**
 * BACKTEST DU MOTEUR PRÉDICTIF (Vague 1 — item 48)
 * ─────────────────────────────────────────────────────────────
 * Rejoue, sur des points de vérité terrain historiques, l'ANCIENNE formule
 * (dimensionnellement incohérente : kg traités comme des %) et la NOUVELLE
 * (normalisée par la capacité), et compare leur MAE / biais à la vérité.
 *
 * Deux sources de vérité terrain :
 *   A. cav_sensor_readings.fill_level_percent  (mesure capteur réelle, 0-120 %)
 *   B. collection_learning_feedback (observed_fill_rate ∪ observed_fill_level×20)
 *
 * Pour chaque point à la date D, on reconstruit les entrées telles qu'elles
 * étaient « as-of D » (dernière collecte avant D, poids moyen 90 j, cadence)
 * à partir de tonnage_history, puis on calcule les deux prédictions.
 *
 * Best-effort, exécution MANUELLE :
 *   node src/scripts/backtest-predictions.js [--days=180] [--limit=5000]
 *
 * N'écrit rien en base. Sort un rapport texte + code retour 0.
 */

const pool = require('../config/database');
const { computeBaseFillPercent, getCapacityKg, SEASONAL_DEFAULT } = require('../utils/fill-factors');

const DAY_MS = 86400000;

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
}

// Ancienne formule (avant item 48) : kg accumulés traités comme un %.
//   rawFill = joursDepuis × (poidsMoyen / 7) / nbConteneurs × 100 × saisonnier
function oldFormula({ daysSince, avgWeight, nbContainers, monthIndex }) {
  const dailyAccumulation = avgWeight / 7;
  const raw = (daysSince * dailyAccumulation / (nbContainers || 1)) * 100 * SEASONAL_DEFAULT[monthIndex];
  return Math.max(0, Math.min(120, raw));
}

// Nouvelle formule (item 48) : normalisée par la capacité totale.
function newFormula({ daysSince, avgWeight, avgDaysBetween, nbContainers, monthIndex }) {
  return computeBaseFillPercent({
    daysSinceCollection: daysSince,
    avgWeightKg: avgWeight,
    avgDaysBetween,
    nbContainers,
    seasonalFactor: SEASONAL_DEFAULT[monthIndex],
  });
}

// Reconstruit les entrées « as-of D » depuis l'historique trié ASC par date.
function inputsAsOf(historyAsc, D) {
  const before = historyAsc.filter((h) => new Date(h.date).getTime() < D.getTime());
  if (before.length === 0) return null;
  const last = before[before.length - 1];
  const daysSince = Math.floor((D.getTime() - new Date(last.date).getTime()) / DAY_MS);
  if (daysSince < 0) return null;

  const win90 = before.filter((h) => (D.getTime() - new Date(h.date).getTime()) <= 90 * DAY_MS);
  const wSet = win90.length ? win90 : before;
  const avgWeight = wSet.reduce((s, h) => s + parseFloat(h.weight_kg), 0) / wSet.length;

  // Cadence moyenne sur les collectes des 180 derniers jours avant D.
  const win180 = before.filter((h) => (D.getTime() - new Date(h.date).getTime()) <= 180 * DAY_MS);
  let avgDaysBetween = 7;
  if (win180.length >= 2) {
    const times = win180.map((h) => new Date(h.date).getTime()).sort((a, b) => a - b);
    let sum = 0, n = 0;
    for (let i = 1; i < times.length; i++) { const g = (times[i] - times[i - 1]) / DAY_MS; if (g > 0) { sum += g; n++; } }
    if (n > 0) avgDaysBetween = sum / n;
  }
  return { daysSince, avgWeight, avgDaysBetween, monthIndex: D.getMonth() };
}

function stats(errors) {
  if (errors.length === 0) return { n: 0, mae: null, bias: null };
  const mae = errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length;
  const bias = errors.reduce((s, e) => s + e, 0) / errors.length;
  return { n: errors.length, mae, bias };
}

async function backtestSensors(days, limit) {
  const cavs = await pool.query(`
    SELECT DISTINCT r.cav_id, c.nb_containers
    FROM cav_sensor_readings r JOIN cav c ON c.id = r.cav_id
    WHERE r.reading_at >= NOW() - INTERVAL '1 day' * $1
  `, [days]);

  const oldErr = [], newErr = [];
  let points = 0;

  for (const row of cavs.rows) {
    const cavId = row.cav_id;
    const nb = parseInt(row.nb_containers, 10) || 1;

    const hist = await pool.query(
      `SELECT date, weight_kg FROM tonnage_history WHERE cav_id = $1 ORDER BY date ASC`, [cavId]
    );
    if (hist.rows.length === 0) continue;

    // 1 mesure capteur / jour (moyenne) pour lisser le bruit.
    const readings = await pool.query(`
      SELECT DATE(reading_at) AS d, AVG(fill_level_percent) AS obs
      FROM cav_sensor_readings
      WHERE cav_id = $1 AND reading_at >= NOW() - INTERVAL '1 day' * $2
      GROUP BY DATE(reading_at) ORDER BY d ASC
    `, [cavId, days]);

    for (const rd of readings.rows) {
      if (points >= limit) break;
      const D = new Date(rd.d);
      const inputs = inputsAsOf(hist.rows, D);
      if (!inputs) continue;
      const observed = Math.max(0, Math.min(120, parseFloat(rd.obs)));
      const predOld = oldFormula({ ...inputs, nbContainers: nb });
      const predNew = newFormula({ ...inputs, nbContainers: nb });
      oldErr.push(predOld - observed);
      newErr.push(predNew - observed);
      points++;
    }
  }
  return { old: stats(oldErr), new: stats(newErr), points, cavs: cavs.rows.length };
}

async function backtestFeedback(days, limit) {
  const rows = await pool.query(`
    SELECT clf.cav_id, c.nb_containers, clf.created_at::date AS d,
           COALESCE(clf.observed_fill_rate, clf.observed_fill_level * 20) AS obs
    FROM collection_learning_feedback clf JOIN cav c ON c.id = clf.cav_id
    WHERE clf.created_at >= NOW() - INTERVAL '1 day' * $1
      AND (clf.observed_fill_rate IS NOT NULL OR clf.observed_fill_level IS NOT NULL)
    ORDER BY clf.cav_id, clf.created_at ASC
    LIMIT $2
  `, [days, limit]);

  const histCache = {};
  const oldErr = [], newErr = [];
  for (const r of rows.rows) {
    if (r.obs == null) continue;
    if (!histCache[r.cav_id]) {
      const h = await pool.query('SELECT date, weight_kg FROM tonnage_history WHERE cav_id = $1 ORDER BY date ASC', [r.cav_id]);
      histCache[r.cav_id] = h.rows;
    }
    const inputs = inputsAsOf(histCache[r.cav_id], new Date(r.d));
    if (!inputs) continue;
    const nb = parseInt(r.nb_containers, 10) || 1;
    const observed = Math.max(0, Math.min(120, parseFloat(r.obs)));
    oldErr.push(oldFormula({ ...inputs, nbContainers: nb }) - observed);
    newErr.push(newFormula({ ...inputs, nbContainers: nb }) - observed);
  }
  return { old: stats(oldErr), new: stats(newErr), points: oldErr.length };
}

function fmt(s) {
  return s.n === 0 ? 'aucun point' : `n=${s.n}  MAE=${s.mae.toFixed(1)}  biais=${s.bias.toFixed(1)}`;
}

async function main() {
  const days = parseInt(arg('days', '180'), 10);
  const limit = parseInt(arg('limit', '5000'), 10);
  console.log(`\n=== BACKTEST PRÉDICTIF (fenêtre ${days} j, limite ${limit} points) ===\n`);

  try {
    const sensor = await backtestSensors(days, limit);
    console.log('── Vérité terrain : CAPTEURS (fill_level_percent) ──');
    console.log(`  CAV analysés     : ${sensor.cavs}   points : ${sensor.points}`);
    console.log(`  ANCIENNE formule : ${fmt(sensor.old)}`);
    console.log(`  NOUVELLE formule : ${fmt(sensor.new)}`);
    if (sensor.old.n && sensor.new.n) {
      const gain = sensor.old.mae - sensor.new.mae;
      console.log(`  → Gain de MAE    : ${gain >= 0 ? '-' : '+'}${Math.abs(gain).toFixed(1)} points`);
    }
  } catch (err) {
    console.error('  [capteurs] échec :', err.message);
  }

  console.log('');
  try {
    const fb = await backtestFeedback(days, limit);
    console.log('── Vérité terrain : FEEDBACK (observed_fill_rate ∪ level×20) ──');
    console.log(`  points           : ${fb.points}`);
    console.log(`  ANCIENNE formule : ${fmt(fb.old)}`);
    console.log(`  NOUVELLE formule : ${fmt(fb.new)}`);
    if (fb.old.n && fb.new.n) {
      const gain = fb.old.mae - fb.new.mae;
      console.log(`  → Gain de MAE    : ${gain >= 0 ? '-' : '+'}${Math.abs(gain).toFixed(1)} points`);
    }
  } catch (err) {
    console.error('  [feedback] échec :', err.message);
  }

  console.log('\nNB : reconstruction « as-of » approximative (historique complet lu, ');
  console.log('facteurs par défaut sans corrections apprises) — comparaison de FORMULES,');
  console.log('pas de la prédiction en production. Aucune écriture en base.\n');
}

if (require.main === module) {
  main()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { oldFormula, newFormula, inputsAsOf, stats };

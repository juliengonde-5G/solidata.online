#!/usr/bin/env node
/**
 * RECALCUL DU MOTEUR PRÉDICTIF
 * ─────────────────────────────────────────────────────────────────────────────
 * Rejoue à la demande les trois apprentissages du moteur de remplissage, qui ne
 * tournent sinon qu'aux heures du scheduler. À lancer après un import de reprise
 * d'ancienneté ou une remise à zéro : sans cela, le moteur continue de raisonner
 * sur ce qu'il avait appris AVANT que l'historique change.
 *
 *   1. Facteurs saisonniers   (services/predictive-ai)     — mensuel, 1er à 3 h
 *   2. Pondération météo      (services/weather-learning)  — mensuel, 1er à 4 h
 *   3. Prédictions J..J+N     (routes/tours/predictions)   — quotidien
 *
 * Chaque étape est INDÉPENDANTE : si l'une échoue ou refuse de conclure, les
 * autres se font quand même et l'échec est affiché tel quel. Un apprentissage
 * qui refuse de conclure faute de données n'est PAS une panne — c'est la
 * doctrine « jamais de valeur inventée » : mieux vaut aucune pondération qu'une
 * pondération tirée de trois observations.
 *
 * Ces recalculs ne détruisent aucune donnée d'origine : ils reconstruisent des
 * données DÉRIVÉES (facteurs appris, prédictions) à partir de l'historique de
 * collecte, qui reste la seule source. Ré-exécutable sans risque.
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/recalculer-predictif.js
 *   node src/scripts/recalculer-predictif.js --horizon=14
 */

const pool = require('../config/database');

/** Lecture PURE des arguments (exportée pour les tests). */
function parseArgs(argv) {
  let horizon = 7;
  for (const a of argv) {
    if (a.startsWith('--horizon=')) {
      const v = Number(a.slice('--horizon='.length));
      if (!Number.isInteger(v) || v < 1 || v > 60) {
        throw new Error(`--horizon attend un entier de 1 à 60 jour(s) (reçu « ${a.slice('--horizon='.length)} »)`);
      }
      horizon = v;
    }
  }
  return { horizon };
}

/**
 * Résumé lisible d'un retour d'apprentissage (fonction PURE, exportée pour les
 * tests). Les trois jobs renvoient des formes différentes ; on affiche ce qu'ils
 * disent réellement plutôt qu'un « OK » qui masquerait un refus de conclure.
 */
function resumer(valeur) {
  if (valeur === null || valeur === undefined) return 'terminé (aucun détail renvoyé)';
  if (typeof valeur !== 'object') return String(valeur);
  if (valeur.skipped || valeur.raison || valeur.reason) {
    return `aucune écriture — ${valeur.raison || valeur.reason || 'données insuffisantes'}`;
  }
  const parts = [];
  for (const [k, v] of Object.entries(valeur)) {
    if (v === null || typeof v === 'object') continue;
    parts.push(`${k}=${v}`);
  }
  return parts.length ? parts.join(', ') : 'terminé';
}

const ETAPES = [
  {
    titre: 'Facteurs saisonniers',
    detail: 'poids moyen par mois appris sur l\'historique de tonnage',
    run: async () => {
      const { recalcSeasonalFactors } = require('../services/predictive-ai');
      if (typeof recalcSeasonalFactors !== 'function') return { raison: 'apprentissage non disponible' };
      return recalcSeasonalFactors();
    },
  },
  {
    titre: 'Pondération météo',
    detail: 'effet du beau temps sur les dépôts, semaine vs week-end',
    run: async () => {
      const { recalcWeatherFactors } = require('../services/weather-learning');
      return recalcWeatherFactors();
    },
  },
  {
    titre: 'Prédictions de remplissage',
    detail: 'taux prévus par borne sur l\'horizon demandé',
    run: async (opts) => {
      const { generateDailyPredictions } = require('../routes/tours/predictions');
      return generateDailyPredictions({ horizonDays: opts.horizon });
    },
  },
];

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`ERREUR : ${err.message}`);
    process.exitCode = 1;
    await pool.end().catch(() => {});
    return;
  }

  // Assise réelle du calcul : sans historique, tout ce qui suit sortira à vide.
  try {
    const a = (await pool.query(
      `SELECT COUNT(*)::int AS n, MIN(date) AS debut, MAX(date) AS fin FROM tonnage_history`
    )).rows[0];
    console.log(`Historique de collecte disponible : ${a.n} pesée(s)`
      + (a.n ? ` (du ${String(a.debut).slice(0, 10)} au ${String(a.fin).slice(0, 10)})` : ''));
    if (!a.n) {
      console.log('Aucun historique : les apprentissages n\'auront rien à apprendre.');
    }
    const { RESET_SETTINGS_KEY } = require('../utils/fill-factors');
    const jalon = (await pool.query('SELECT value FROM settings WHERE key = $1', [RESET_SETTINGS_KEY])).rows[0]?.value;
    if (jalon) {
      console.log(`⚠ Un jalon de remise à zéro est posé au ${String(jalon).slice(0, 10)} : le moteur`);
      console.log('  considère les CAV vides à cette date et IGNORE l\'historique antérieur.');
      console.log('  Le retirer : node src/scripts/reset-remplissage-cav.js --annuler --apply');
    }
  } catch (err) {
    console.warn(`Lecture de l'historique ignorée : ${err.message}`);
  }

  console.log('');
  let echecs = 0;
  for (const [i, etape] of ETAPES.entries()) {
    process.stdout.write(`${i + 1}/${ETAPES.length} · ${etape.titre} — ${etape.detail}\n`);
    try {
      const r = await etape.run(args);
      console.log(`      ✓ ${resumer(r)}\n`);
    } catch (err) {
      echecs++;
      console.log(`      ✗ échec : ${err.message}\n`);
    }
  }

  console.log(echecs
    ? `Terminé avec ${echecs} étape(s) en échec — les autres ont abouti.`
    : 'Moteur prédictif à jour.');
  process.exitCode = echecs ? 1 : 0;
  await pool.end().catch(() => {});
}

module.exports = { parseArgs, resumer, ETAPES };

if (require.main === module) {
  main();
}

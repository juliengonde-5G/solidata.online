#!/usr/bin/env node
/**
 * PURGE DES TOURNÉES RÉALISÉES (statut `completed`)
 * ─────────────────────────────────────────────────────────────────────────────
 * Supprime les tournées RÉALISÉES et leurs données d'EXÉCUTION, en PRÉSERVANT
 * l'historique métier qui nourrit le reste de l'application.
 *
 * SUPPRIMÉ (cascade FK) avec chaque tournée :
 *   - tour_cav / tour_association_point   (points de passage)
 *   - tour_weights                        (pesées de tournée)
 *   - gps_positions                       (trace GPS)
 *   - tour_reoptimizations                (ré-optimisations)
 *
 * DÉTACHÉ (tour_id → NULL, lignes CONSERVÉES) — soit par FK SET NULL, soit
 * explicitement par le script pour les FK sans action (sinon le DELETE serait
 * refusé) :
 *   - incidents, vehicle_checklists, tour_end_of_day_declarations (explicite)
 *   - stock_movements, stock_original_movements (explicite — le stock est
 *     comptable, on ne détruit JAMAIS un mouvement)
 *   - cav_qr_scans, driver_messages, collection_learning_feedback,
 *     tonnage_history_association, association_learning_feedback (FK SET NULL)
 *
 * INTACT (aucun lien avec `tours`) :
 *   - tonnage_history (rattaché par CAV + date) → le moteur prédictif, la
 *     carte de remplissage, les KPI et l'historique de tonnage par CAV ne
 *     perdent RIEN. Purger l'historique de collecte lui-même est un AUTRE
 *     périmètre, volontairement hors de ce script.
 *
 * Effet visible : les tournées purgées disparaissent des écrans (planning,
 * dashboard, listes) et l'onglet « passages » de l'historique AdminCAV se vide
 * pour ces tournées ; les tonnages, incidents et mouvements de stock restent.
 *
 * Seules les tournées `completed` sont touchées — jamais les planifiées, en
 * cours ou annulées. Transactionnel ; l'opération est journalisée dans
 * `rgpd_audit_log` (action TOURS_PURGE).
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/purge-tournees-realisees.js                     # simulation
 *   node src/scripts/purge-tournees-realisees.js --apply             # purge tout
 *   node src/scripts/purge-tournees-realisees.js --avant=2026-06-01 --apply
 *                                    # ne purge que les réalisées AVANT le 1er juin
 */

const pool = require('../config/database');

/** Tables à détacher explicitement (FK sans action → le DELETE échouerait). */
const DETACH_EXPLICITE = [
  'incidents',
  'vehicle_checklists',
  'tour_end_of_day_declarations',
  'stock_movements',
  'stock_original_movements',
];

/** Tables détachées par la FK elle-même (ON DELETE SET NULL) — comptées au récap. */
const DETACH_PAR_FK = [
  'cav_qr_scans',
  'driver_messages',
  'collection_learning_feedback',
  'tonnage_history_association',
  'association_learning_feedback',
];

/** Tables supprimées par la FK elle-même (ON DELETE CASCADE) — comptées au récap. */
const CASCADE = [
  'tour_cav',
  'tour_association_point',
  'tour_weights',
  'gps_positions',
  'tour_reoptimizations',
];

/**
 * Lecture PURE des arguments (exportée pour les tests).
 * Retourne { apply, avant } — `avant` = 'YYYY-MM-DD' validé ou null ;
 * une valeur mal formée lève (on ne purge pas sur un filtre mal compris).
 */
function parseArgs(argv) {
  const apply = argv.includes('--apply');
  let avant = null;
  for (const a of argv) {
    if (a.startsWith('--avant=')) {
      const v = a.slice('--avant='.length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
        throw new Error(`--avant attend une date YYYY-MM-DD valide (reçu « ${v} »)`);
      }
      avant = v;
    }
  }
  return { apply, avant };
}

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
  const { apply, avant } = args;

  const client = await pool.connect();
  try {
    const where = avant
      ? { sql: "status = 'completed' AND date < $1", params: [avant] }
      : { sql: "status = 'completed'", params: [] };

    const cible = (await client.query(
      `SELECT COUNT(*)::int AS n, MIN(date) AS premiere, MAX(date) AS derniere
         FROM tours WHERE ${where.sql}`, where.params
    )).rows[0];

    console.log(`Tournées réalisées ciblées : ${cible.n}`
      + (cible.n ? ` (du ${String(cible.premiere).slice(0, 10)} au ${String(cible.derniere).slice(0, 10)})` : '')
      + (avant ? ` — filtre : date < ${avant}` : ' — toutes'));
    if (!apply) console.log('MODE SIMULATION (aucune écriture) — relancer avec --apply pour purger.\n');
    if (cible.n === 0) {
      console.log('Rien à purger.');
      process.exitCode = 0;
      return;
    }

    // Volumes liés, comptés AVANT toute écriture (mêmes chiffres en simulation
    // et en application — le récap dit exactement ce qui va se passer).
    const inTours = `IN (SELECT id FROM tours WHERE ${where.sql})`;
    async function countLinked(table) {
      const r = await client.query(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE tour_id ${inTours}`, where.params
      );
      return r.rows[0].n;
    }
    console.log('Supprimé avec les tournées (cascade) :');
    for (const t of CASCADE) console.log(`  - ${t} : ${await countLinked(t)} ligne(s)`);
    console.log('Conservé mais détaché des tournées (tour_id → NULL) :');
    for (const t of [...DETACH_EXPLICITE, ...DETACH_PAR_FK]) console.log(`  - ${t} : ${await countLinked(t)} ligne(s)`);
    console.log('Intact : tonnage_history (aucun lien avec les tournées — prédictif/KPI préservés).\n');

    if (!apply) {
      console.log('Aucune écriture (simulation). Relancer avec --apply.');
      process.exitCode = 0;
      return;
    }

    await client.query('BEGIN');
    for (const t of DETACH_EXPLICITE) {
      const r = await client.query(
        `UPDATE ${t} SET tour_id = NULL WHERE tour_id ${inTours}`, where.params
      );
      if (r.rowCount) console.log(`  détaché ${t} : ${r.rowCount} ligne(s)`);
    }
    const del = await client.query(`DELETE FROM tours WHERE ${where.sql}`, where.params);
    // Journal best-effort DANS la transaction (le schéma rgpd_audit_log existe
    // partout via init-db ; user_id null = opération d'exploitation en script).
    await client.query(
      `INSERT INTO rgpd_audit_log (user_id, action, entity_type, details)
       VALUES (NULL, 'TOURS_PURGE', 'tours', $1)`,
      [JSON.stringify({ nb_tournees: del.rowCount, filtre_avant: avant, script: 'purge-tournees-realisees.js' })]
    ).catch((err) => console.warn(`  journal rgpd_audit_log ignoré : ${err.message}`));
    await client.query('COMMIT');
    console.log(`\nPurge appliquée (COMMIT) : ${del.rowCount} tournée(s) supprimée(s). Ré-exécutable (re-run = 0).`);
    process.exitCode = 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERREUR purge tournées réalisées :', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

// Fonctions PURES exportées pour les tests (aucune DB dedans).
module.exports = { parseArgs, DETACH_EXPLICITE, DETACH_PAR_FK, CASCADE };

if (require.main === module) {
  main();
}

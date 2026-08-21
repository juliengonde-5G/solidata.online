#!/usr/bin/env node
/**
 * REMISE À ZÉRO DU REMPLISSAGE DES CAV
 * ─────────────────────────────────────────────────────────────────────────────
 * « On relance tout à zéro à partir d'aujourd'hui. Le moteur de prédiction
 * démarre à partir d'aujourd'hui. » (demande client, août 2026)
 *
 * CE QUE FAIT CE SCRIPT : il pose un JALON (réglage
 * `collecte.remplissage_reset_le`). À partir de cette date, TOUS les CAV sont
 * réputés vides : la carte de remplissage, la garde de saturation et le moteur
 * de prédiction repartent de 0 % et ne regardent plus ce qui précède.
 *
 * DEUX MODES, à choisir selon ce qu'on veut vraiment :
 *
 * 1. JALON (par défaut) — ne supprime RIEN. L'historique de tonnage alimente
 *    aussi les indicateurs de collecte, la captation par commune (Métropole) et
 *    les déclarations Refashion : quand ces données ont une valeur, le jalon
 *    donne le même résultat visible sans rien détruire, et conserve les poids
 *    moyens et cadences que le moteur réutilise dès le premier jour.
 *    RÉVERSIBLE : `--annuler` remet tout comme avant.
 *
 * 2. PURGE (`--purger-historique`) — supprime réellement, voir plus bas.
 *
 * PURGE RÉELLE — `--purger-historique` : sur décision explicite du client
 * (« nous ne commençons la vraie exploitation qu'aujourd'hui », 21/08/2026),
 * le script peut aussi SUPPRIMER l'historique de collecte et d'apprentissage,
 * qui ne contient alors que des données d'essai et d'import. C'est une
 * opération IRRÉVERSIBLE : elle efface les tonnages passés, donc aussi les
 * indicateurs de collecte, la captation par commune et l'assise des
 * déclarations Refashion antérieures. Le récapitulatif détaille ligne à ligne
 * ce qui sera détruit AVANT toute écriture ; rien ne part sans --apply.
 *
 * Les mouvements de stock (entrées matière au centre de tri) ne sont PAS
 * concernés : ils relèvent de l'inventaire, avec ses propres outils.
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/reset-remplissage-cav.js                  # simulation
 *   node src/scripts/reset-remplissage-cav.js --apply          # remet à zéro AUJOURD'HUI (jalon)
 *   node src/scripts/reset-remplissage-cav.js --date=2026-09-01 --apply
 *   node src/scripts/reset-remplissage-cav.js --annuler --apply   # retire le jalon
 *   node src/scripts/reset-remplissage-cav.js --purger-historique          # simulation de la purge
 *   node src/scripts/reset-remplissage-cav.js --purger-historique --apply  # PURGE IRRÉVERSIBLE
 */

const pool = require('../config/database');
const { RESET_SETTINGS_KEY } = require('../utils/fill-factors');

/**
 * Tables vidées par `--purger-historique`, dans l'ordre (les dépendances
 * d'abord). Chaque entrée porte ce qu'elle représente, pour que le récapitulatif
 * dise en clair ce qui disparaît.
 */
const TABLES_HISTORIQUE = [
  ['collection_learning_feedback', 'apprentissage prédit/observé (bornes)'],
  ['association_learning_feedback', 'apprentissage prédit/observé (associations)'],
  ['ml_fill_predictions', 'prédictions de remplissage déjà calculées'],
  ['predictive_weather_factors', 'pondération météo apprise'],
  ['cav_collection_times', 'temps de collecte appris par borne'],
  ['cav_qr_scans', 'historique des scans de QR'],
  ['tonnage_history', 'historique des tonnages collectés par borne'],
  ['tonnage_history_association', 'historique des tonnages (associations)'],
];

/**
 * Lecture PURE des arguments (exportée pour les tests).
 * `date` = 'YYYY-MM-DD' validée, ou null pour « aujourd'hui, heure de Paris ».
 * Une date mal formée lève : on ne remet jamais à zéro sur un filtre mal compris.
 */
function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const annuler = argv.includes('--annuler');
  const purger = argv.includes('--purger-historique');
  let date = null;
  for (const a of argv) {
    if (a.startsWith('--date=')) {
      const v = a.slice('--date='.length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
        throw new Error(`--date attend une date YYYY-MM-DD valide (reçu « ${v} »)`);
      }
      date = v;
    }
  }
  return { apply, annuler, purger, date };
}

/** Jour civil de Paris (le conteneur tourne en UTC). */
function aujourdhuiParis() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
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
  const { apply, annuler } = args;
  const date = args.date || aujourdhuiParis();

  const client = await pool.connect();
  try {
    const actuel = await client.query('SELECT value FROM settings WHERE key = $1', [RESET_SETTINGS_KEY]);
    const jalonActuel = actuel.rows[0]?.value || null;

    if (annuler) {
      console.log(jalonActuel
        ? `Jalon actuel : ${String(jalonActuel).slice(0, 10)} — il serait RETIRÉ (retour au calcul sur l'historique réel).`
        : 'Aucun jalon posé — rien à annuler.');
      if (!apply) { console.log('\nSIMULATION — relancer avec --annuler --apply.'); return; }
      await client.query('DELETE FROM settings WHERE key = $1', [RESET_SETTINGS_KEY]);
      console.log('Jalon retiré. Le remplissage est de nouveau calculé sur l\'historique complet.');
      process.exitCode = 0;
      return;
    }

    if (args.purger) {
      console.log('PURGE DE L\'HISTORIQUE DE COLLECTE ET D\'APPRENTISSAGE');
      console.log('Opération IRRÉVERSIBLE — décision client du 21/08/2026 :');
      console.log('« nous ne commençons la vraie exploitation qu\'aujourd\'hui ».\n');
      let total = 0;
      const presentes = [];
      for (const [table, libelle] of TABLES_HISTORIQUE) {
        try {
          const n = (await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n;
          console.log(`  ${String(n).padStart(6)} · ${table} — ${libelle}`);
          total += n;
          presentes.push(table);
        } catch (err) {
          // Table absente sur cette base : on l'ignore sans faire échouer la purge.
          console.log(`       — · ${table} (absente de cette base)`);
        }
      }
      console.log(`\n  Total : ${total} ligne(s) à supprimer.`);
      console.log('  NON concernés : mouvements de stock, tournées, incidents, fiches CAV.');
      if (!apply) {
        console.log('\nMODE SIMULATION (aucune suppression) — relancer avec --purger-historique --apply.');
        process.exitCode = 0;
        return;
      }
      await client.query('BEGIN');
      for (const table of presentes) {
        await client.query(`DELETE FROM ${table}`);
      }
      // Après la purge, le jalon n'a plus d'objet : sans historique, tous les
      // CAV sont déjà vus comme neufs. On le retire pour ne pas laisser un
      // réglage qui ne correspond plus à rien.
      await client.query('DELETE FROM settings WHERE key = $1', [RESET_SETTINGS_KEY]);
      await client.query(
        `INSERT INTO rgpd_audit_log (user_id, action, entity_type, details)
         VALUES (NULL, 'CAV_HISTORIQUE_PURGE', 'cav', $1)`,
        [JSON.stringify({ tables: presentes, lignes_supprimees: total, script: 'reset-remplissage-cav.js' })]
      ).catch((err) => console.warn(`  journal rgpd_audit_log ignoré : ${err.message}`));
      await client.query('COMMIT');
      console.log(`\nPurge appliquée : ${total} ligne(s) supprimée(s). Le moteur de prédiction`);
      console.log('repart de zéro et n\'apprendra plus que sur les collectes à venir.');
      process.exitCode = 0;
      return;
    }

    // Photo AVANT : combien de CAV seraient effectivement remis à zéro, c.-à-d.
    // ceux dont la dernière collecte connue est antérieure au jalon.
    const stats = (await client.query(
      `SELECT COUNT(*)::int AS actifs,
              COUNT(*) FILTER (WHERE h.last_collection IS NOT NULL AND h.last_collection < $1::date)::int AS remis_a_zero,
              COUNT(*) FILTER (WHERE h.last_collection IS NULL)::int AS sans_historique
         FROM cav c
         LEFT JOIN (SELECT cav_id, MAX(date) AS last_collection FROM tonnage_history GROUP BY cav_id) h
                ON h.cav_id = c.id
        WHERE c.status = 'active'`,
      [date]
    )).rows[0];
    const tonnages = (await client.query('SELECT COUNT(*)::int AS n FROM tonnage_history')).rows[0].n;

    console.log(`Jalon de remise à zéro : ${date}`);
    if (jalonActuel) console.log(`  (un jalon existe déjà : ${String(jalonActuel).slice(0, 10)} — il sera remplacé)`);
    console.log(`CAV actifs : ${stats.actifs}`);
    console.log(`  · ${stats.remis_a_zero} repartiront de 0 % (dernière collecte antérieure au jalon)`);
    console.log(`  · ${stats.sans_historique} sans historique de collecte (déjà traités comme neufs)`);
    console.log(`Historique de tonnage CONSERVÉ : ${tonnages} ligne(s) — aucune suppression.`);
    console.log('Indicateurs de collecte, captation par commune et Refashion : inchangés.');

    if (!apply) {
      console.log('\nMODE SIMULATION (aucune écriture) — relancer avec --apply.');
      process.exitCode = 0;
      return;
    }

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO settings (key, value, category) VALUES ($1, $2, 'collecte')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [RESET_SETTINGS_KEY, date]
    );
    await client.query(
      `INSERT INTO rgpd_audit_log (user_id, action, entity_type, details)
       VALUES (NULL, 'CAV_REMPLISSAGE_RESET', 'cav', $1)`,
      [JSON.stringify({ jalon: date, jalon_precedent: jalonActuel, cav_remis_a_zero: stats.remis_a_zero,
        script: 'reset-remplissage-cav.js' })]
    ).catch((err) => console.warn(`  journal rgpd_audit_log ignoré : ${err.message}`));
    await client.query('COMMIT');

    console.log(`\nRemise à zéro appliquée. Tous les CAV repartent de 0 % au ${date}.`);
    console.log('Le moteur de prédiction ne regarde plus les collectes antérieures.');
    console.log('Réversible à tout moment : node src/scripts/reset-remplissage-cav.js --annuler --apply');
    process.exitCode = 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERREUR remise à zéro du remplissage :', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

module.exports = { parseArgs, aujourdhuiParis, TABLES_HISTORIQUE };

if (require.main === module) {
  main();
}

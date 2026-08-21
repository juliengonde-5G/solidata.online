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
 * CE QU'IL NE FAIT PAS — et c'est délibéré : il ne SUPPRIME rien.
 * L'historique de tonnage (`tonnage_history`) alimente aussi les indicateurs de
 * collecte, la captation par commune (Métropole) et les déclarations Refashion.
 * Le détruire pour remettre un affichage à zéro serait une perte sèche et
 * irréversible. Le jalon obtient le même résultat visible, en gardant :
 *   - tous les tonnages déclarés (indicateurs et déclarations intacts) ;
 *   - les poids moyens et cadences par CAV, que le moteur réutilise pour
 *     estimer la vitesse de remplissage dès le premier jour.
 *
 * RÉVERSIBLE : `--annuler` retire le jalon et tout revient à l'état antérieur.
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/reset-remplissage-cav.js                  # simulation
 *   node src/scripts/reset-remplissage-cav.js --apply          # remet à zéro AUJOURD'HUI
 *   node src/scripts/reset-remplissage-cav.js --date=2026-09-01 --apply
 *   node src/scripts/reset-remplissage-cav.js --annuler --apply   # retire le jalon
 */

const pool = require('../config/database');
const { RESET_SETTINGS_KEY } = require('../utils/fill-factors');

/**
 * Lecture PURE des arguments (exportée pour les tests).
 * `date` = 'YYYY-MM-DD' validée, ou null pour « aujourd'hui, heure de Paris ».
 * Une date mal formée lève : on ne remet jamais à zéro sur un filtre mal compris.
 */
function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const annuler = argv.includes('--annuler');
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
  return { apply, annuler, date };
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

module.exports = { parseArgs, aujourdhuiParis };

if (require.main === module) {
  main();
}

#!/usr/bin/env node
/**
 * INSTALLATION DE LA DÉMO DE FORMATION (application conducteur)
 * ─────────────────────────────────────────────────────────────────────────────
 * Crée (ou remet à zéro) l'environnement d'entraînement du parcours chauffeur :
 *
 *   1. un VÉHICULE de démonstration `is_demo = true` — il porte son propre lien
 *      « 1 URL = 1 véhicule » (`/v/<qr_token>`), à poser sur le téléphone du
 *      stagiaire. Il est exclu du parc opérationnel (planning, propositions,
 *      tableau de bord) : aucun risque de partir en tournée réelle avec.
 *   2. une TOURNÉE du jour `is_demo = true` sur de VRAIS CAV (adresses réelles,
 *      vraie carte — nettement plus parlant qu'un décor fictif), ordonnée et
 *      prête à démarrer.
 *
 * TOUT effet métier est neutralisé côté serveur (services/demo-mode.js) : ni
 * tonnage, ni mouvement de stock, ni apprentissage du moteur prédictif, ni
 * photo de référence écrasée, ni notification aux managers. Le stagiaire peut
 * donc tout essayer — y compris se tromper — sans qu'une statistique bouge.
 *
 * RÉINITIALISATION : `resetDemoTour()` supprime la tournée d'exercice (ses
 * points, pesées, GPS, checklists et incidents partent en cascade) et en
 * recrée une neuve. C'est ce que fait le bouton « Réinitialiser la démo » de
 * l'écran formateur, et ce que fait ce script relancé.
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/seed-demo-formation.js            # simulation (dry-run)
 *   node src/scripts/seed-demo-formation.js --apply    # installe / réinitialise
 *   node src/scripts/seed-demo-formation.js --apply --supprimer   # désinstalle tout
 */

const pool = require('../config/database');
const {
  DEMO_VEHICLE_REGISTRATION, DEMO_VEHICLE_NAME, DEMO_NB_POINTS, DEMO_RESET_SETTING,
} = require('../services/demo-mode');

/**
 * Garantit l'existence du véhicule de démonstration et le renvoie.
 * Idempotent : identifié par son immatriculation réservée.
 */
async function ensureDemoVehicle(client) {
  const existing = await client.query(
    'SELECT id, registration, name, qr_token FROM vehicles WHERE registration = $1',
    [DEMO_VEHICLE_REGISTRATION]
  );
  if (existing.rows.length > 0) {
    // Ré-affirme le drapeau (une base restaurée d'avant la migration pourrait
    // l'avoir perdu) sans toucher au jeton : le lien déjà posé sur les
    // téléphones des formateurs doit continuer de fonctionner.
    await client.query('UPDATE vehicles SET is_demo = true WHERE id = $1', [existing.rows[0].id]);
    return existing.rows[0];
  }
  const created = await client.query(
    `INSERT INTO vehicles (registration, name, max_capacity_kg, status, is_demo)
     VALUES ($1, $2, 3500, 'available', true)
     RETURNING id, registration, name, qr_token`,
    [DEMO_VEHICLE_REGISTRATION, DEMO_VEHICLE_NAME]
  );
  return created.rows[0];
}

/**
 * Choisit les points de collecte du scénario : de VRAIS CAV actifs, géolocalisés,
 * pris parmi les plus proches du centre de tri pour que la carte du stagiaire
 * reste lisible et que le parcours soit réaliste.
 * Renvoie [] si la base n'a pas de CAV géolocalisé (base neuve) — on ne crée
 * alors aucune tournée plutôt que d'inventer des points.
 */
async function pickDemoCavs(client, limit = DEMO_NB_POINTS) {
  const r = await client.query(
    `SELECT id, name FROM cav
      WHERE status = 'active' AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY (POWER(latitude - 49.4231, 2) + POWER(longitude - 1.0993, 2)) ASC
      LIMIT $1`,
    [limit]
  );
  return r.rows;
}

/**
 * Efface les traces d'un exercice avant de supprimer ses tournées.
 * Les points de passage, pesées, positions GPS et ré-optimisations partent en
 * cascade avec la tournée ; ces trois tables-ci ont une FK SANS action, donc
 * le DELETE serait REFUSÉ sans nettoyage préalable (défaut constaté en recette
 * sur PostgreSQL réel : « violates foreign key constraint
 * vehicle_checklists_tour_id_fkey »). Les mouvements de stock sont listés par
 * précaution : le mode démo n'en produit jamais, mais une base ayant tourné
 * avant la neutralisation pourrait en porter.
 */
async function purgeTracesExercice(client, tourIds) {
  if (!tourIds || tourIds.length === 0) return;
  for (const table of ['incidents', 'vehicle_checklists', 'tour_end_of_day_declarations',
    'stock_movements', 'stock_original_movements']) {
    await client.query(`DELETE FROM ${table} WHERE tour_id = ANY($1)`, [tourIds]);
  }
}

/**
 * Supprime la ou les tournées de démonstration existantes puis en crée une
 * neuve, datée du jour (heure de Paris), prête à démarrer.
 * Les données d'exercice (points, pesées, GPS, ré-optimisations) partent en
 * cascade ; les incidents de démo, dont la FK ne cascade pas, sont supprimés
 * explicitement — ils ne sont que des traces d'entraînement.
 *
 * @returns {{tourId:number, nbCav:number, vehicleId:number}}
 */
async function resetDemoTour(db, { log = console.log } = {}) {
  const client = db.connect ? await db.connect() : db;
  const shouldRelease = Boolean(db.connect);
  try {
    await client.query('BEGIN');
    const vehicle = await ensureDemoVehicle(client);

    const anciennes = await client.query(
      'SELECT id FROM tours WHERE vehicle_id = $1 AND is_demo = true', [vehicle.id]
    );
    if (anciennes.rows.length > 0) {
      const ids = anciennes.rows.map((r) => r.id);
      await purgeTracesExercice(client, ids);
      await client.query('DELETE FROM tours WHERE id = ANY($1)', [ids]);
      log(`  ${ids.length} tournée(s) d'exercice précédente(s) supprimée(s).`);
    }

    const cavs = await pickDemoCavs(client);
    if (cavs.length === 0) {
      throw new Error('Aucun CAV géolocalisé en base : impossible de composer un scénario de démonstration.');
    }

    const tour = await client.query(
      `INSERT INTO tours (date, vehicle_id, mode, status, nb_cav, is_demo, ai_explanation)
       VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date, $1, 'manual', 'planned', $2, true, $3)
       RETURNING id`,
      [vehicle.id, cavs.length,
        'Tournée de DÉMONSTRATION (formation chauffeur). Aucune donnée réelle n\'est modifiée.']
    );
    const tourId = tour.rows[0].id;

    let position = 1;
    for (const cav of cavs) {
      await client.query(
        // 'pending' = point non encore traité (CHECK tour_cav_status_check :
        // pending | collected | skipped | incident — 'planned' n'existe que
        // sur `tours.status`, ne pas confondre les deux machines à états).
        `INSERT INTO tour_cav (tour_id, cav_id, position, status) VALUES ($1, $2, $3, 'pending')`,
        [tourId, cav.id, position++]
      );
    }

    await client.query(
      `INSERT INTO settings (key, value, category) VALUES ($1, $2, 'collecte')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [DEMO_RESET_SETTING, new Date().toISOString()]
    );

    await client.query('COMMIT');
    log(`  Tournée de démonstration #${tourId} créée avec ${cavs.length} point(s).`);
    return { tourId, nbCav: cavs.length, vehicleId: vehicle.id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (shouldRelease) client.release();
  }
}

/** Désinstalle complètement la démo (véhicule + tournées + incidents). */
async function removeDemo(client, { log = console.log } = {}) {
  const v = await client.query('SELECT id FROM vehicles WHERE is_demo = true');
  for (const row of v.rows) {
    const tours = await client.query('SELECT id FROM tours WHERE vehicle_id = $1', [row.id]);
    const ids = tours.rows.map((t) => t.id);
    if (ids.length > 0) {
      await purgeTracesExercice(client, ids);
      await client.query('DELETE FROM tours WHERE id = ANY($1)', [ids]);
    }
    await client.query('DELETE FROM vehicle_checklists WHERE vehicle_id = $1', [row.id]);
    await client.query('DELETE FROM driver_messages WHERE vehicle_id = $1', [row.id]);
    await client.query('DELETE FROM vehicles WHERE id = $1', [row.id]);
    log(`  Véhicule de démonstration #${row.id} et ses données supprimés.`);
  }
  await client.query('DELETE FROM settings WHERE key = $1', [DEMO_RESET_SETTING]);
  return v.rows.length;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const supprimer = process.argv.includes('--supprimer');
  const client = await pool.connect();
  try {
    if (supprimer) {
      if (!apply) {
        const v = await client.query('SELECT registration FROM vehicles WHERE is_demo = true');
        console.log(`SIMULATION — ${v.rows.length} véhicule(s) de démonstration seraient supprimés.`);
        console.log('Relancer avec --apply --supprimer pour désinstaller.');
        return;
      }
      await client.query('BEGIN');
      const n = await removeDemo(client);
      await client.query('COMMIT');
      console.log(`Démo désinstallée (${n} véhicule(s)).`);
      return;
    }

    if (!apply) {
      const cavs = await pickDemoCavs(client);
      const v = await client.query(
        'SELECT id, registration, qr_token FROM vehicles WHERE registration = $1',
        [DEMO_VEHICLE_REGISTRATION]
      );
      console.log('MODE SIMULATION (aucune écriture) — relancer avec --apply.\n');
      console.log(v.rows.length > 0
        ? `  Véhicule de démonstration DÉJÀ installé (#${v.rows[0].id}) — sa tournée serait réinitialisée.`
        : `  Véhicule « ${DEMO_VEHICLE_REGISTRATION} » à créer.`);
      console.log(`  Scénario : ${cavs.length} point(s) de collecte réels`
        + (cavs.length ? ` — du plus proche du centre de tri : ${cavs.slice(0, 3).map((c) => c.name).join(' | ')}…` : ''));
      if (cavs.length === 0) console.log('  ⚠ Aucun CAV géolocalisé : la démo ne peut pas être composée sur cette base.');
      return;
    }

    const result = await resetDemoTour(pool);
    const v = await client.query(
      'SELECT registration, qr_token FROM vehicles WHERE id = $1', [result.vehicleId]
    );
    const base = process.env.MOBILE_BASE_URL || 'https://m.solidata.online';
    console.log('\n══════════════════════════════════════════════');
    console.log('DÉMO DE FORMATION PRÊTE');
    console.log('══════════════════════════════════════════════');
    console.log(`Véhicule  : ${v.rows[0].registration}`);
    console.log(`Points    : ${result.nbCav} CAV réels`);
    console.log(`LIEN      : ${base}/v/${v.rows[0].qr_token}`);
    console.log('\nÀ ouvrir sur le téléphone du stagiaire. Aucune donnée réelle');
    console.log('n\'est modifiée par ce lien. Réinitialisation entre deux stagiaires');
    console.log('depuis la page Véhicules (bouton « Réinitialiser la démo »).');
    process.exitCode = 0;
  } catch (err) {
    console.error('ERREUR démo de formation :', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

module.exports = { ensureDemoVehicle, pickDemoCavs, resetDemoTour, removeDemo };

if (require.main === module) {
  main();
}

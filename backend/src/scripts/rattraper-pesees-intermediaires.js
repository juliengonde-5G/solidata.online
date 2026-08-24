#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// RATTRAPAGE — pesées intermédiaires exclues du total des tournées
// ══════════════════════════════════════════════════════════════════════════
//
// LE DÉFAUT CORRIGÉ
// `tours.total_weight_kg` ne sommait que les pesées « non intermédiaires ».
// Or une pesée intermédiaire n'est pas un relevé provisoire : c'est un
// chargement RÉELLEMENT DÉPOSÉ au centre par un chauffeur qui repart
// collecter. Les kilos concernés disparaissaient donc :
//   • du total affiché de la tournée ;
//   • de `tonnage_history` — donc du moteur prédictif et de la carte des CAV ;
//   • des entrées de stock (moderne et grand livre brut).
// Pire : quand TOUTES les pesées d'une tournée étaient intermédiaires, le
// total tombait à 0 et la clôture ne créait plus AUCUN effet (la garde
// `if (total_weight_kg > 0)` d'applyCompletionSideEffects sautait tout).
//
// CE QUE FAIT CE SCRIPT
//   1. recalcule `tours.total_weight_kg` = somme de TOUTES les pesées ;
//   2. reconstruit `tonnage_history` des tournées concernées (donnée DÉRIVÉE :
//      poids total réparti entre les CAV collectés, source 'mobile') ;
//   3. RECENSE l'écart de stock sans y toucher.
//
// POURQUOI LE STOCK N'EST PAS CORRIGÉ AUTOMATIQUEMENT
// Une écriture de stock est un acte comptable : elle se régularise par une
// écriture datée et tracée, pas par une réécriture silencieuse de l'historique.
// Le script affiche le détail par tournée ; la régularisation se fait ensuite
// dans le module Stock, en connaissance de cause.
//
// USAGE
//   node src/scripts/rattraper-pesees-intermediaires.js            (simulation)
//   node src/scripts/rattraper-pesees-intermediaires.js --apply
//   node src/scripts/rattraper-pesees-intermediaires.js --apply --depuis=2026-01-01

const pool = require('../config/database');

function parseArgs(argv) {
  const args = { apply: false, depuis: null };
  (argv || []).forEach((a) => {
    if (a === '--apply') args.apply = true;
    else if (a.startsWith('--depuis=')) args.depuis = a.slice('--depuis='.length);
  });
  return args;
}

/** Écart entre le total stocké et la somme réelle des pesées (fonction PURE). */
function ecartTournee(ligne) {
  const stocke = parseFloat(ligne.total_weight_kg) || 0;
  const reel = parseFloat(ligne.total_reel_kg) || 0;
  return Math.round((reel - stocke) * 100) / 100;
}

/** Une tournée est-elle à rattraper ? (fonction PURE) */
function aRattraper(ligne, tolerance = 0.5) {
  return Math.abs(ecartTournee(ligne)) > tolerance;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log('══ Rattrapage des pesées intermédiaires ══');
  console.log(args.apply ? 'MODE : application' : 'MODE : simulation (--apply pour écrire)');
  if (args.depuis) console.log(`Période : tournées à partir du ${args.depuis}`);

  const params = [];
  let filtre = '';
  if (args.depuis) { params.push(args.depuis); filtre = ` AND t.date >= $${params.length}`; }

  const res = await pool.query(
    `SELECT t.id, t.date, t.status, t.is_demo, t.vehicle_id, t.collection_type,
            COALESCE(t.total_weight_kg, 0) AS total_weight_kg,
            COALESCE(p.total_reel, 0) AS total_reel_kg,
            COALESCE(p.nb_pesees, 0) AS nb_pesees,
            COALESCE(p.nb_intermediaires, 0) AS nb_intermediaires
       FROM tours t
       LEFT JOIN (
         SELECT tour_id,
                SUM(weight_kg) AS total_reel,
                COUNT(*) AS nb_pesees,
                COUNT(*) FILTER (WHERE COALESCE(is_intermediate, FALSE)) AS nb_intermediaires
           FROM tour_weights GROUP BY tour_id
       ) p ON p.tour_id = t.id
      WHERE t.is_demo IS NOT TRUE AND COALESCE(p.nb_pesees, 0) > 0${filtre}
      ORDER BY t.date, t.id`,
    params
  );

  const concernees = res.rows.filter((r) => aRattraper(r));
  console.log(`\nTournées avec pesées : ${res.rows.length}`);
  console.log(`Tournées à rattraper : ${concernees.length}`);

  if (concernees.length === 0) {
    console.log('\nRien à rattraper.');
    await pool.end();
    return;
  }

  let kgTotal = 0;
  let tonnageRecree = 0;
  let stockManquantKg = 0;
  const sansEffet = [];

  for (const t of concernees) {
    const ecart = ecartTournee(t);
    kgTotal += ecart;
    const jour = (t.date instanceof Date ? t.date : new Date(t.date)).toISOString().slice(0, 10);
    console.log(`  #${t.id} ${jour} — stocké ${t.total_weight_kg} kg → réel ${t.total_reel_kg} kg `
      + `(+${ecart} kg, ${t.nb_intermediaires}/${t.nb_pesees} pesées intermédiaires)`);

    // Une tournée dont le total était à 0 n'a produit AUCUN effet de clôture :
    // ni tonnage, ni entrée de stock. C'est le cas le plus grave.
    const totalStocke = parseFloat(t.total_weight_kg) || 0;
    if (totalStocke === 0 && t.status === 'completed') sansEffet.push(t.id);

    if (!args.apply) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE tours SET total_weight_kg = $1 WHERE id = $2',
        [parseFloat(t.total_reel_kg), t.id]);

      // tonnage_history est une donnée DÉRIVÉE du poids total : on la
      // reconstruit intégralement pour cette tournée, sans doublon possible.
      if (t.status === 'completed') {
        const cavs = await client.query(
          "SELECT cav_id FROM tour_cav WHERE tour_id = $1 AND status = 'collected'", [t.id]);
        await client.query(
          `DELETE FROM tonnage_history
            WHERE date = $1 AND source = 'mobile'
              AND cav_id = ANY($2::int[])`,
          [t.date, cavs.rows.map((c) => c.cav_id)]
        );
        if (cavs.rows.length > 0) {
          const parCav = parseFloat(t.total_reel_kg) / cavs.rows.length;
          for (const c of cavs.rows) {
            await client.query(
              "INSERT INTO tonnage_history (date, cav_id, weight_kg, source) VALUES ($1, $2, $3, 'mobile')",
              [t.date, c.cav_id, parCav]
            );
            tonnageRecree += 1;
          }
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ! Tournée #${t.id} non rattrapée : ${err.message}`);
    } finally {
      client.release();
    }
  }

  // Écart de stock : recensé, jamais réécrit.
  for (const t of concernees) {
    const mvt = await pool.query(
      "SELECT COALESCE(SUM(poids_kg), 0)::float AS kg FROM stock_movements WHERE tour_id = $1 AND type = 'entree'",
      [t.id]
    );
    stockManquantKg += Math.max(0, parseFloat(t.total_reel_kg) - (mvt.rows[0]?.kg || 0));
  }

  console.log('\n══ Bilan ══');
  console.log(`Kilos réintégrés au total des tournées : ${Math.round(kgTotal)} kg`);
  if (args.apply) console.log(`Lignes tonnage_history reconstruites   : ${tonnageRecree}`);
  if (sansEffet.length > 0) {
    console.log(`\nTournées clôturées SANS aucun effet (total à 0) : ${sansEffet.length}`);
    console.log(`  ${sansEffet.join(', ')}`);
    console.log('  → ni tonnage, ni entrée de stock n\'avaient été créés.');
  }
  console.log(`\nÉcart de stock à régulariser : ${Math.round(stockManquantKg)} kg`);
  console.log('  Le stock n\'est PAS corrigé automatiquement : une écriture de stock');
  console.log('  se régularise par une écriture datée et tracée, dans le module Stock.');
  if (!args.apply) console.log('\n(simulation — relancer avec --apply pour écrire)');

  await pool.end();
}

if (require.main === module) {
  main().catch((err) => { console.error('ERREUR', err); process.exit(1); });
}

module.exports = { parseArgs, ecartTournee, aRattraper };

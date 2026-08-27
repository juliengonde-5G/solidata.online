#!/usr/bin/env node
/**
 * TONNAGES DES TOURNÉES ASSOCIATION — RATTRAPAGE DES TOURNÉES DÉJÀ CLOSES
 * ─────────────────────────────────────────────────────────────────────────────
 * Jusqu'au 26/08/2026, les effets de clôture d'une tournée ne lisaient que
 * `tour_cav`. Sur une tournée d'ASSOCIATIONS — dont les points vivent dans
 * `tour_association_point` — le décompte des points collectés valait donc
 * toujours zéro, et `tonnage_history_association` n'était JAMAIS écrite.
 *
 * Cette table est pourtant LUE : « dernière collecte » et « poids moyen 90 j »
 * de la carte des associations en viennent, tout comme l'historique dont se
 * sert `predictAssociationFillRate`. Les deux étaient structurellement vides,
 * sans que rien ne le signale.
 *
 * Le correctif rend le comportement correct pour les tournées à venir. Ce
 * script rattrape celles qui sont DÉJÀ CLOSES, avec exactement la même règle de
 * répartition (fonctions partagées `pointsCollectes` / `ecrireTonnage` de
 * `routes/tours/completion-effects.js` — jamais une seconde règle écrite ici).
 *
 * PÉRIMÈTRE, et ce qu'il ne fait volontairement PAS :
 *   • tournées `collection_type = 'association'`, `status = 'completed'`, hors
 *     mode démo, et dont le poids total pesé est strictement positif ;
 *   • une tournée qui porte DÉJÀ des lignes de tonnage n'est jamais retouchée
 *     (idempotence : une seconde exécution n'écrit rien) ;
 *   • une tournée close sans aucun point collecté n'a rien à répartir : c'est
 *     dit, et rien n'est inventé ;
 *   • les MOUVEMENTS DE STOCK ne sont pas retouchés : ils ont bien été écrits à
 *     la clôture, avec le bon poids. Seul leur libellé annonçait « 0 CAV
 *     collectés » ; réécrire un mouvement de stock passé pour corriger un
 *     libellé serait réécrire l'historique comptable, ce qu'on ne fait pas ;
 *   • l'APPRENTISSAGE (`association_learning_feedback`) n'est pas rattrapé : il
 *     compare une prédiction à une observation, et la prédiction d'une date
 *     passée ne peut plus être rejouée honnêtement une fois l'historique
 *     modifié. Il ne se remplira donc qu'à partir des prochaines clôtures.
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/rattraper-tonnage-associations.js               # simulation
 *   node src/scripts/rattraper-tonnage-associations.js --apply       # applique
 *   node src/scripts/rattraper-tonnage-associations.js --depuis=2026-01-01 --apply
 *   node src/scripts/rattraper-tonnage-associations.js --tour=412 --apply
 */

const pool = require('../config/database');
const { pointsCollectes, ecrireTonnage } = require('../routes/tours/completion-effects');
// Même règle de répartition que la clôture : le script ne recalcule rien de son
// côté, il lit la décision de la source unique (cf. routes/tours/sacs.js).
const { repartirPoids } = require('../routes/tours/sacs');

/** Analyse des arguments — fonction PURE, testée sans base. */
function parseArgs(argv) {
  const args = argv.slice(2);
  const valeur = (nom) => {
    const a = args.find((x) => x.startsWith(`--${nom}=`));
    return a ? a.split('=').slice(1).join('=').trim() : null;
  };
  const depuis = valeur('depuis');
  if (depuis && !/^\d{4}-\d{2}-\d{2}$/.test(depuis)) {
    throw new Error(`--depuis attend une date AAAA-MM-JJ (reçu « ${depuis} »)`);
  }
  const tourBrut = valeur('tour');
  const tour = tourBrut == null ? null : parseInt(tourBrut, 10);
  if (tourBrut != null && !Number.isInteger(tour)) {
    throw new Error(`--tour attend un identifiant de tournée (reçu « ${tourBrut} »)`);
  }
  return { apply: args.includes('--apply'), depuis, tour };
}

/**
 * Tournées candidates. Les colonnes calculées disent, pour chacune, ce qu'il y
 * a à répartir et ce qui a déjà été écrit — le filtre d'idempotence se lit donc
 * dans la même passe, sans requête supplémentaire par tournée.
 *
 * `--tour` vise une tournée précise quel que soit son état : c'est la boucle
 * qui refuse alors explicitement, plutôt que de la faire disparaître d'un
 * filtre SQL sans rien dire.
 */
function buildQuery({ depuis, tour }) {
  const colonnes = `t.id, to_char(t.date, 'YYYY-MM-DD') AS date, t.status, t.collection_type,
              COALESCE(t.is_demo, false) AS is_demo, t.total_weight_kg, t.vehicle_id,
              v.registration,
              (SELECT COUNT(*)::int FROM tour_association_point tap
                WHERE tap.tour_id = t.id AND tap.status = 'collected') AS points_collectes,
              (SELECT COUNT(*)::int FROM tonnage_history_association th
                WHERE th.tour_id = t.id) AS lignes_existantes`;
  if (tour != null) {
    return {
      text: `SELECT ${colonnes}
               FROM tours t LEFT JOIN vehicles v ON v.id = t.vehicle_id
              WHERE t.id = $1 ORDER BY t.id`,
      values: [tour],
    };
  }
  return {
    text: `SELECT ${colonnes}
             FROM tours t LEFT JOIN vehicles v ON v.id = t.vehicle_id
            WHERE t.collection_type = 'association'
              AND t.status = 'completed'
              AND COALESCE(t.is_demo, false) = false
              AND COALESCE(t.total_weight_kg, 0) > 0
              AND t.date >= $1::date
            ORDER BY t.date, t.id`,
    values: [depuis || '1970-01-01'],
  };
}

/**
 * Pourquoi une tournée est hors périmètre, ou `null` si elle est traitable.
 * Fonction PURE — c'est elle qui porte la règle, la boucle ne fait que la lire.
 */
function motifExclusion(t) {
  if (t.collection_type !== 'association') return 'ce n\'est pas une tournée association';
  if (t.status !== 'completed') return `tournée non close (${t.status})`;
  if (t.is_demo) return 'tournée de démonstration (formation)';
  if (!(parseFloat(t.total_weight_kg) > 0)) return 'aucun poids pesé à répartir';
  if (t.lignes_existantes > 0) return `déjà rattrapée (${t.lignes_existantes} ligne(s) de tonnage)`;
  if (t.points_collectes === 0) return 'aucun point collecté : rien à répartir';
  return null;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  const { text, values } = buildQuery(opts);
  console.log('Tonnages des tournées association — rattrapage des tournées closes');
  console.log(`Périmètre : ${opts.tour != null ? `tournée #${opts.tour}` : `tournées association closes à partir du ${values[0]}`}`);
  console.log(opts.apply ? 'Mode : APPLICATION (--apply)\n' : 'Mode : SIMULATION (aucune écriture) — ajoutez --apply pour appliquer\n');

  const bilan = { traitees: 0, lignes: 0, kg: 0, ignorees: 0, erreurs: 0 };
  try {
    const { rows } = await pool.query(text, values);
    if (rows.length === 0) {
      console.log('Aucune tournée dans le périmètre. Rien à faire.');
      return;
    }

    for (const t of rows) {
      const etiquette = `#${t.id} du ${t.date} (${t.registration || 'véhicule inconnu'})`;
      const exclusion = motifExclusion(t);
      if (exclusion) {
        bilan.ignorees += 1;
        console.log(`  = ${etiquette} : ${exclusion}`);
        continue;
      }

      const poids = parseFloat(t.total_weight_kg);
      // La simulation doit annoncer EXACTEMENT ce que fera `--apply`. Depuis que
      // le poids se répartit au prorata des sacs déclarés, un décompte « N points
      // × X kg » serait un mensonge dès qu'une association a chargé plus que sa
      // voisine : on simulerait 3 × 100 kg pour écrire ensuite 40/200/60. On
      // interroge donc la MÊME fonction pure que la clôture (`repartirPoids`),
      // sur les mêmes points — une lecture, aucune écriture.
      const pointsSimules = await pointsCollectes(t, t.id);
      const repartition = repartirPoids(pointsSimules, poids);
      const arrondi = (v) => Math.round(Number(v) * 100) / 100;
      const detail = repartition.mode === 'prorata_sacs'
        ? `${repartition.nb_points} point(s), ${repartition.total_sacs} sac(s) `
          + `→ ${arrondi(repartition.poids_par_sac_kg)} kg par sac (total ${poids} kg)`
        : `${repartition.nb_points} point(s) × ${arrondi(poids / (repartition.nb_points || 1))} kg `
          + `(total ${poids} kg) — ${repartition.motif || 'parts égales'}`;

      if (!opts.apply) {
        bilan.traitees += 1;
        bilan.lignes += t.points_collectes;
        bilan.kg += poids;
        console.log(`  + ${etiquette} : ${detail}`);
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const points = await pointsCollectes(t, t.id, client);
        const ecrites = await ecrireTonnage(t, t.id, points, client);
        await client.query('COMMIT');
        bilan.traitees += 1;
        bilan.lignes += ecrites;
        bilan.kg += poids;
        console.log(`  + ${etiquette} : ${ecrites} ligne(s) de tonnage écrite(s) — ${detail}`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        bilan.erreurs += 1;
        console.log(`  ! ${etiquette} : échec — ${err.message}`);
      } finally {
        client.release();
      }
    }

    console.log('\nBilan');
    console.log(`  tournées examinées ............ ${rows.length}`);
    console.log(`  tournées ${opts.apply ? 'rattrapées' : 'à rattraper'} ...........${bilan.traitees}`);
    console.log(`  lignes de tonnage ${opts.apply ? 'écrites' : 'à écrire'} ......${bilan.lignes}`);
    console.log(`  poids réparti ................. ${Math.round(bilan.kg * 100) / 100} kg`);
    console.log(`  hors périmètre / déjà faites .. ${bilan.ignorees}`);
    if (bilan.erreurs > 0) console.log(`  échecs ........................ ${bilan.erreurs}`);
    if (!opts.apply) console.log('\nSimulation terminée : rien n\'a été écrit. Relancez avec --apply.');
  } catch (err) {
    console.error('ERREUR rattrapage des tonnages association :', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

// Fonctions PURES exportées pour les tests (aucune DB dedans).
module.exports = { parseArgs, buildQuery, motifExclusion };

if (require.main === module) {
  main();
}

#!/usr/bin/env node
/**
 * PASSAGES AU CENTRE DE TRI — RATTRAPAGE DES TOURNÉES DÉJÀ PLANIFIÉES
 * ─────────────────────────────────────────────────────────────────────────────
 * Depuis la 2.37.1, toute tournée créée porte ses trois passages au centre de
 * tri : le départ du matin, la pause du midi, le retour de fin. Les tournées
 * planifiées AVANT cette mise en place n'en ont aucun — et comme une semaine se
 * planifie souvent d'avance, leur programme reste incomplet plusieurs jours :
 * l'équipage n'y voit pas la pause, et le gestionnaire ne la voit pas non plus
 * dans « Collecte en direct ».
 *
 * Ce script pose les passages manquants sur les tournées À VENIR, sans attendre
 * qu'elles démarrent. Il fait exactement ce que fait désormais le démarrage
 * d'une tournée — même fonction, mêmes règles :
 *
 *   • une tournée qui porte DÉJÀ un passage au centre n'est pas retouchée ;
 *   • une tournée ENTAMÉE (au moins un point collecté, sauté ou en incident)
 *     est laissée telle quelle : la pause y serait placée à une position
 *     calculée sur une chronologie théorique, donc derrière le chauffeur, donc
 *     invisible. Sur une tournée en route, c'est le geste « je rentre » de
 *     l'équipage qui crée l'étape, et c'est le bon comportement ;
 *   • la pause du midi vient de la chronologie du moteur de temps. Si le moteur
 *     ne la juge pas due (tournée courte finissant avant midi), aucune pause
 *     n'est posée — on n'impose pas un retour au centre à une équipe rentrée.
 *
 * Idempotent : une seconde exécution ne pose plus rien.
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/backfill-passages-centre.js                # simulation
 *   node src/scripts/backfill-passages-centre.js --apply        # applique
 *   node src/scripts/backfill-passages-centre.js --depuis=2026-08-20 --apply
 *   node src/scripts/backfill-passages-centre.js --tour=363 --apply
 */

const pool = require('../config/database');
const { assurerPassagesCentre } = require('../routes/tours/arrets');

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
 * Tournées candidates : celles qui peuvent encore être roulées. Les tournées
 * closes ou annulées sont volontairement hors périmètre — réécrire le programme
 * d'une journée déjà faite ne rendrait service à personne et fausserait
 * l'historique.
 */
function buildQuery({ depuis, tour }) {
  if (tour != null) {
    return {
      text: `SELECT t.id, to_char(t.date, 'YYYY-MM-DD') AS date, t.status, v.registration
               FROM tours t LEFT JOIN vehicles v ON v.id = t.vehicle_id
              WHERE t.id = $1 ORDER BY t.id`,
      values: [tour],
    };
  }
  return {
    text: `SELECT t.id, to_char(t.date, 'YYYY-MM-DD') AS date, t.status, v.registration
             FROM tours t LEFT JOIN vehicles v ON v.id = t.vehicle_id
            WHERE t.status IN ('planned', 'in_progress')
              AND t.date >= $1::date
              AND COALESCE(t.is_demo, false) = false
            ORDER BY t.date, t.id`,
    values: [depuis || new Date().toISOString().slice(0, 10)],
  };
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
  console.log('Passages au centre de tri — rattrapage des tournées planifiées');
  console.log(`Périmètre : ${opts.tour != null ? `tournée #${opts.tour}` : `tournées à rouler à partir du ${values[0]}`}`);
  console.log(opts.apply ? 'Mode : APPLICATION (--apply)\n' : 'Mode : SIMULATION (aucune écriture) — ajoutez --apply pour appliquer\n');

  try {
    const { rows } = await pool.query(text, values);
    if (rows.length === 0) {
      console.log('Aucune tournée dans le périmètre. Rien à faire.');
      return;
    }

    const bilan = { posees: 0, deja: 0, entamees: 0, erreurs: 0, sans_pause: 0 };
    for (const t of rows) {
      const etiquette = `#${t.id} du ${t.date} (${t.registration || 'véhicule inconnu'}, ${t.status})`;

      if (!opts.apply) {
        // En simulation on n'écrit rien : on se contente de dire ce que le
        // rattrapage ferait, sur les mêmes critères que la fonction réelle.
        const deja = await pool.query(
          `SELECT 1 FROM tour_arret_technique
            WHERE tour_id = $1 AND motif IN ('depart_centre','vidage','pause_dejeuner','fin_tournee') LIMIT 1`,
          [t.id]
        );
        if (deja.rows.length > 0) { bilan.deja += 1; console.log(`  = ${etiquette} : déjà équipée`); continue; }
        const entamee = await pool.query(
          `SELECT 1 FROM tour_cav WHERE tour_id = $1 AND status IN ('collected','skipped','incident') LIMIT 1`,
          [t.id]
        );
        if (entamee.rows.length > 0) { bilan.entamees += 1; console.log(`  · ${etiquette} : déjà entamée, laissée telle quelle`); continue; }
        bilan.posees += 1;
        console.log(`  + ${etiquette} : passages à poser`);
        continue;
      }

      const r = await assurerPassagesCentre(pool, t.id);
      if (r.pose) {
        bilan.posees += 1;
        if (!r.pause) bilan.sans_pause += 1;
        console.log(`  + ${etiquette} : départ + ${r.pause ? 'pause + ' : ''}retour de fin posés`
          + (r.pause ? '' : r.estimation_disponible
            ? ' (pas de pause : le moteur n\'en prévoit pas ce jour-là)'
            : ' (PAS DE PAUSE : estimation indisponible)'));
      } else if (r.motif === 'deja_equipee') { bilan.deja += 1; console.log(`  = ${etiquette} : déjà équipée`); }
      else if (r.motif === 'tournee_entamee') { bilan.entamees += 1; console.log(`  · ${etiquette} : déjà entamée, laissée telle quelle`); }
      else { bilan.erreurs += 1; console.log(`  ! ${etiquette} : échec (voir le journal ci-dessus)`); }
    }

    console.log('\nBilan');
    console.log(`  tournées examinées ......... ${rows.length}`);
    console.log(`  passages ${opts.apply ? 'posés' : 'à poser'} ...........${bilan.posees}`);
    console.log(`  déjà équipées .............. ${bilan.deja}`);
    console.log(`  déjà entamées (ignorées) ... ${bilan.entamees}`);
    if (bilan.sans_pause > 0) console.log(`  dont sans pause du midi .... ${bilan.sans_pause}`);
    if (bilan.erreurs > 0) console.log(`  échecs ..................... ${bilan.erreurs}`);
    if (!opts.apply) console.log('\nSimulation terminée : rien n\'a été écrit. Relancez avec --apply.');
  } catch (err) {
    console.error('ERREUR rattrapage des passages au centre :', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

// Fonctions PURES exportées pour les tests (aucune DB dedans).
module.exports = { parseArgs, buildQuery };

if (require.main === module) {
  main();
}

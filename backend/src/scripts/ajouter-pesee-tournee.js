#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// REPRISE — poser une pesée sur une tournée DÉJÀ CLÔTURÉE
// ══════════════════════════════════════════════════════════════════════════
//
// POURQUOI UN SCRIPT, ET PAS L'ÉCRAN
// Le gestionnaire saisit et corrige les pesées d'une tournée depuis « Collecte
// en direct » (2.42.0) — mais cet écran, délibérément, ne peut pas servir ici :
//   • il REFUSE (409 TOURNEE_NON_MODIFIABLE) dès que la tournée est terminée,
//     parce qu'à la clôture le poids a déjà été réparti en tonnage par borne et
//     transformé en entrée de stock ;
//   • et il horodate la pesée à `NOW()` : impossible d'enregistrer un pesage
//     qui a eu lieu l'avant-veille à 16 h.
// Une pesée oubliée sur une journée close est donc une REPRISE, un acte
// délibéré et tracé — ce que fait ce script, en disant tout ce qu'il touche et
// tout ce qu'il ne touche pas.
//
// CE QU'IL FAIT
//   1. pose la pesée à l'instant demandé (heure de PARIS) ;
//   2. recalcule `tours.total_weight_kg` par la RÈGLE UNIQUE de poids.js
//      (somme de TOUTES les pesées, intermédiaires comprises) ;
//   3. reconstruit le tonnage dérivé de la tournée — `tonnage_history` pour les
//      bornes, `tonnage_history_association` pour les associations — avec les
//      MÊMES fonctions que la clôture (aucune règle de répartition réécrite) ;
//   4. RECENSE l'écart d'entrée de stock, sans y toucher.
//
// POURQUOI LE STOCK N'EST PAS CORRIGÉ AUTOMATIQUEMENT
// Doctrine de la 2.35.0, inchangée : une écriture de stock est un acte
// comptable, elle se régularise par une écriture datée depuis le module Stock,
// jamais par une réécriture silencieuse de l'historique. Le script affiche le
// montant exact à régulariser.
//
// IDEMPOTENT : relancé, il reconnaît sa propre pesée (même tournée, même
// poids, même horodatage) et n'écrit rien. Une reprise ne doit jamais pouvoir
// doubler les kilos qu'elle rattrape.
//
// USAGE (dans le conteneur backend)
//   node src/scripts/ajouter-pesee-tournee.js                    (simulation)
//   node src/scripts/ajouter-pesee-tournee.js --apply
//   node src/scripts/ajouter-pesee-tournee.js --tour=676 --poids=1140 \
//        --le="2026-08-28 16:00" [--tare=<kg>] [--intermediaire] --apply

const pool = require('../config/database');
const { lirePoidsKg, recalculerTotalTournee } = require('../routes/tours/poids');
// Répartition du poids : les MÊMES fonctions que la clôture de tournée.
// Elles sont exportées « pour le script de rattrapage et les tests : la règle
// de répartition doit rester UNE seule, jamais réécrite ailleurs ».
const {
  estAssociation, pointsCollectes, ecrireTonnage,
} = require('../routes/tours/completion-effects');

// ── Valeurs par défaut : la reprise demandée le 30/08/2026 ────────────────
const DEFAUTS = { tour: 676, poids: 1140, le: '2026-08-28 16:00' };

/**
 * L'instant demandé, exprimé en heure de PARIS et converti par PostgreSQL
 * lui-même. `NOW()` traverse exactement la même conversion quand il atterrit
 * dans la colonne `timestamp` de `tour_weights` : la pesée reprise se range
 * donc dans le même repère que celles écrites par les écrans, sans qu'aucun
 * fuseau soit deviné côté Node.
 */
const SQL_INSTANT_PARIS = "(($1)::timestamp AT TIME ZONE 'Europe/Paris')";

function parseArgs(argv) {
  const args = { apply: false, intermediaire: false, tare: null, ...DEFAUTS };
  (argv || []).forEach((a) => {
    if (a === '--apply') args.apply = true;
    else if (a === '--intermediaire') args.intermediaire = true;
    else if (a.startsWith('--tour=')) args.tour = parseInt(a.slice('--tour='.length), 10);
    else if (a.startsWith('--poids=')) args.poids = a.slice('--poids='.length);
    else if (a.startsWith('--tare=')) args.tare = a.slice('--tare='.length);
    else if (a.startsWith('--le=')) args.le = a.slice('--le='.length);
  });
  return args;
}

/**
 * Contrôle des arguments AVANT toute lecture en base. Renvoie `{ error }` sur
 * une saisie douteuse plutôt qu'une valeur de remplacement : une reprise se
 * fait sur des chiffres qu'on a sous les yeux, jamais sur un défaut deviné.
 * Fonction PURE.
 */
function validerArgs(args) {
  if (!Number.isInteger(args.tour) || args.tour <= 0) {
    return { error: 'Identifiant de tournée invalide (--tour=<entier>).' };
  }
  const poids = lirePoidsKg(args.poids, { champ: 'Le poids collecté (--poids)' });
  if (poids.error) return { error: poids.error };
  if (poids.valeur === 0) {
    return { error: 'Une pesée à 0 kg ne se rattrape pas : il n\'y a rien à ajouter.' };
  }
  const tare = lirePoidsKg(args.tare, { obligatoire: false, champ: 'La tare (--tare)' });
  if (tare.error) return { error: tare.error };
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(String(args.le || ''))) {
    return { error: 'Horodatage attendu au format « AAAA-MM-JJ HH:MM » (--le), en heure de Paris.' };
  }
  return { valeurs: { poids: poids.valeur, tare: tare.valeur } };
}

/** Kilos réellement entrés en stock pour cette tournée (jamais réécrits ici). */
async function lireEntreeStock(tourId) {
  try {
    const r = await pool.query(
      "SELECT COALESCE(SUM(poids_kg), 0)::float AS kg FROM stock_movements WHERE tour_id = $1 AND type = 'entree'",
      [tourId]
    );
    return r.rows[0]?.kg ?? 0;
  } catch (err) {
    console.warn(`  (entrée de stock illisible : ${err.message})`);
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log('══ Reprise — pesée sur une tournée close ══');
  console.log(args.apply ? 'MODE : application' : 'MODE : simulation (--apply pour écrire)');

  const controle = validerArgs(args);
  if (controle.error) {
    console.error(`\nRefusé : ${controle.error}`);
    await pool.end();
    process.exitCode = 1;
    return;
  }
  const { poids, tare } = controle.valeurs;

  const tRes = await pool.query(
    `SELECT id, date, status, collection_type, is_demo,
            COALESCE(total_weight_kg, 0) AS total_weight_kg
       FROM tours WHERE id = $1`,
    [args.tour]
  );
  if (tRes.rows.length === 0) {
    console.error(`\nTournée #${args.tour} introuvable — aucune écriture.`);
    await pool.end();
    process.exitCode = 1;
    return;
  }
  const tour = tRes.rows[0];
  if (tour.is_demo) {
    console.error(`\nTournée #${args.tour} : c'est une tournée de DÉMONSTRATION (formation).`);
    console.error('Une reprise de poids n\'y a aucun sens — vérifiez l\'identifiant.');
    await pool.end();
    process.exitCode = 1;
    return;
  }

  const jour = (tour.date instanceof Date ? tour.date : new Date(tour.date)).toISOString().slice(0, 10);
  console.log(`\nTournée #${tour.id} — ${jour} — statut « ${tour.status} »`
    + ` — ${estAssociation(tour) ? 'associations' : 'bornes'}`);

  // Contrôle de vraisemblance, jamais bloquant : une pesée se rattache à la
  // journée de la tournée. Un écart de date est presque toujours une erreur
  // d'identifiant — on le DIT, et l'opérateur décide.
  if (!String(args.le).startsWith(jour)) {
    console.warn(`\n  ⚠ L'horodatage demandé (${args.le}) ne tombe pas le jour de la tournée (${jour}).`);
    console.warn('    Vérifiez l\'identifiant de tournée avant d\'appliquer.');
  }

  // L'heure est rendue en PARIS par PostgreSQL lui-même : l'opérateur doit
  // relire l'horaire qu'il a saisi, pas la valeur brute d'une colonne stockée
  // dans le fuseau du serveur (UTC en production), qu'il lirait « 14:00 » pour
  // une pesée de 16 h et prendrait pour une erreur.
  const avant = await pool.query(
    `SELECT id, weight_kg, tare_kg, is_intermediate, notes,
            to_char(recorded_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris',
                    'YYYY-MM-DD HH24:MI') AS heure_paris
       FROM tour_weights WHERE tour_id = $1 ORDER BY recorded_at, id`,
    [args.tour]
  );
  console.log(`\nPesées déjà enregistrées : ${avant.rows.length}`);
  avant.rows.forEach((p) => {
    console.log(`  • ${p.weight_kg} kg à ${p.heure_paris}${p.is_intermediate ? ' (intermédiaire)' : ''}`);
  });
  const totalAvant = avant.rows.reduce((s, p) => s + (Number(p.weight_kg) || 0), 0);
  console.log(`Total pesé actuel : ${Math.round(totalAvant * 100) / 100} kg`
    + ` (colonne stockée : ${tour.total_weight_kg} kg)`);

  // Idempotence : même tournée, même poids, même instant → déjà fait.
  // $1 = l'instant demandé (consommé par SQL_INSTANT_PARIS), $2 = la tournée,
  // $3 = le poids.
  const doublon = await pool.query(
    `SELECT id FROM tour_weights
      WHERE tour_id = $2 AND weight_kg = $3 AND recorded_at = ${SQL_INSTANT_PARIS}`,
    [args.le, args.tour, poids]
  );
  if (doublon.rows.length > 0) {
    console.log(`\nCette pesée est DÉJÀ enregistrée (#${doublon.rows[0].id}) — rien à faire.`);
    await pool.end();
    return;
  }

  const totalApres = Math.round((totalAvant + poids) * 100) / 100;
  console.log(`\nÀ poser : ${poids} kg${tare != null ? ` (tare ${tare} kg)` : ''}`
    + `${args.intermediaire ? ', pesée intermédiaire' : ''} le ${args.le} (heure de Paris)`);
  console.log(`Total pesé après reprise : ${totalApres} kg`);

  const stockAvant = await lireEntreeStock(args.tour);

  if (!args.apply) {
    console.log('\n(simulation — relancer avec --apply pour écrire)');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let peseeId = null;
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO tour_weights (tour_id, weight_kg, tare_kg, is_intermediate, notes, recorded_at)
       VALUES ($2, $3, $4, $5, $6, ${SQL_INSTANT_PARIS})
       RETURNING id, recorded_at`,
      [args.le, args.tour, poids, tare, args.intermediaire,
        `Pesée ajoutée après clôture (reprise du ${new Date().toISOString().slice(0, 10)}).`]
    );
    peseeId = ins.rows[0].id;
    const total = await recalculerTotalTournee(client, args.tour);
    await client.query('COMMIT');
    console.log(`\n✔ Pesée #${peseeId} enregistrée. Total de la tournée : ${total} kg.`);
    tour.total_weight_kg = total;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\n✗ Pesée NON enregistrée : ${err.message}`);
    client.release();
    await pool.end();
    process.exitCode = 1;
    return;
  } finally {
    client.release();
  }

  // ── Tonnage dérivé ───────────────────────────────────────────────────────
  // Il n'est reconstruit que pour une tournée CLÔTURÉE : sur une tournée encore
  // ouverte, aucun tonnage n'a été écrit, et c'est sa clôture qui s'en chargera
  // — avec le poids complet, puisqu'il vient d'être corrigé.
  if (tour.status !== 'completed') {
    console.log('\nTonnage : rien à reconstruire, la tournée n\'est pas clôturée.');
    console.log('  Sa clôture répartira le poids complet, correction comprise.');
  } else {
    const c2 = await pool.connect();
    try {
      await c2.query('BEGIN');
      const points = await pointsCollectes(tour, args.tour, c2);
      if (points.length === 0) {
        console.log('\nTonnage : aucun point collecté sur cette tournée — rien à répartir.');
        await c2.query('ROLLBACK');
      } else {
        // Donnée DÉRIVÉE : on efface la répartition de cette tournée avant de
        // la réécrire, pour ne jamais additionner deux répartitions du même
        // poids. Le périmètre est borné à la date ET aux points de la tournée.
        if (estAssociation(tour)) {
          await c2.query('DELETE FROM tonnage_history_association WHERE tour_id = $1', [args.tour]);
        } else {
          await c2.query(
            `DELETE FROM tonnage_history
              WHERE date = $1 AND source = 'mobile' AND cav_id = ANY($2::int[])`,
            [tour.date, points.map((p) => p.point_id)]
          );
        }
        const lignes = await ecrireTonnage(tour, args.tour, points, c2);
        await c2.query('COMMIT');
        console.log(`\n✔ Tonnage reconstruit : ${lignes} ligne(s) sur ${points.length} point(s) collecté(s).`);
      }
    } catch (err) {
      await c2.query('ROLLBACK').catch(() => {});
      console.error(`\n✗ Tonnage NON reconstruit : ${err.message}`);
      console.error('  La pesée, elle, est bien enregistrée. Relancer le script corrigera le tonnage.');
    } finally {
      c2.release();
    }
  }

  // ── Stock : recensé, jamais réécrit ──────────────────────────────────────
  console.log('\n══ Entrée de stock ══');
  if (stockAvant == null) {
    console.log('  Écart non calculable (table de stock illisible).');
  } else {
    const manquant = Math.round((Number(tour.total_weight_kg) - stockAvant) * 100) / 100;
    console.log(`  Entré en stock à la clôture : ${stockAvant} kg`);
    console.log(`  Poids pesé après reprise    : ${tour.total_weight_kg} kg`);
    if (manquant > 0) {
      console.log(`  → ${manquant} kg à régulariser par une écriture DATÉE depuis le module Stock.`);
      console.log('    Le script n\'y touche pas : une écriture de stock ne se réécrit pas en silence.');
    } else {
      console.log('  → Aucun écart de stock à régulariser.');
    }
  }

  await pool.end();
}

if (require.main === module) {
  main().catch((err) => { console.error('ERREUR', err); process.exit(1); });
}

module.exports = { parseArgs, validerArgs, DEFAUTS };

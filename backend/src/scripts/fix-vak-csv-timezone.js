#!/usr/bin/env node
/**
 * CORRECTION FUSEAU DES VENTES VAK IMPORTÉES PAR CSV (Lot 12 — heure de Paris)
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI : jusqu'au Lot 12, `parseFRDate` (services/sumup.js) interprétait
 * l'horodatage FRANÇAIS de l'export CSV SumUp (« 15 mai 2026 10:15 » = heure
 * murale Paris) comme de l'UTC. Les lignes `source = 'csv_manuel'` ont donc été
 * stockées avec l'HEURE MURALE PARIS dans un champ censé contenir de l'UTC :
 * l'instant réel est décalé de −1 h (hiver) / −2 h (été). Tant que l'affichage
 * était en GMT (v2.6.0), l'utilisateur voyait la bonne heure murale ; avec
 * l'affichage en heure de Paris (Lot 12), ces lignes historiques s'afficheraient
 * décalées de +1 h/+2 h.
 *
 * CE QUE FAIT LE SCRIPT : pour les lignes `source = 'csv_manuel'` UNIQUEMENT
 * (les voies API/webhook ont toujours été de vrais UTC — on n'y touche pas),
 * il ré-interprète la valeur stockée comme une heure murale Paris et la
 * reconvertit en UTC :
 *     nouvelle valeur = (ancienne AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC'
 * soit un décalage de −1 h/−2 h selon la date de CHAQUE ligne (heure d'été
 * gérée par la tzdata de PostgreSQL). Tables corrigées : vak_tickets.date_ticket
 * et vak_ventes.date_vente.
 *
 * QUAND L'EXÉCUTER : UNE SEULE FOIS, juste après le déploiement du Lot 12 et
 * AVANT tout nouvel import CSV (un CSV importé APRÈS le déploiement est déjà
 * converti correctement à l'ingestion : le re-décaler le fausserait — c'est ce
 * que protègent le verrou settings et le filtre --before).
 *
 * IDEMPOTENCE / GARDE-FOUS :
 *   - dry-run PAR DÉFAUT : n'écrit rien, affiche le périmètre + un échantillon
 *     avant/après. Passer --apply pour écrire.
 *   - verrou settings `vak.fix_csv_timezone.applied_at` : posé au succès d'un
 *     --apply ; toute ré-exécution --apply est refusée (no-op, code 0) sauf
 *     --force. Le décalage n'est donc appliqué qu'une fois.
 *   - --before=<ISO> : ne corrige que les lignes INGÉRÉES (created_at) avant
 *     cet instant. Défaut : l'instant de lancement du script. À fixer sur la
 *     date du déploiement du Lot 12 si des CSV ont été importés entre le
 *     déploiement et l'exécution du script.
 *   - transaction unique : tout est corrigé ou rien.
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/fix-vak-csv-timezone.js                 # dry-run
 *   node src/scripts/fix-vak-csv-timezone.js --apply         # exécution réelle
 *   node src/scripts/fix-vak-csv-timezone.js --apply --before=2026-08-04T00:00:00Z
 *   node src/scripts/fix-vak-csv-timezone.js --apply --force # ignorer le verrou
 *
 * NON COUVERT (assumé) : vak_import_batches.date_debut/date_fin (DATE civiles,
 * inchangées par un décalage intra-journée) ; l'heure murale 02:00-03:00 du
 * dimanche de repasse à l'heure d'hiver est ambiguë (PostgreSQL choisit un
 * offset) — aucune VAK ne vend à cette heure-là.
 */

const pool = require('../config/database');

const LOCK_KEY = 'vak.fix_csv_timezone.applied_at';
const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.split('=')[1] : new Date().toISOString();

// Expression de correction : la valeur stockée est une heure murale Paris →
// on la lit comme telle puis on la ramène en UTC naïf.
const FIX = (col) => `(${col} AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC'`;

async function main() {
  if (Number.isNaN(new Date(BEFORE).getTime())) {
    console.error(`--before invalide : "${BEFORE}" (attendu : timestamp ISO)`);
    process.exitCode = 1;
    return;
  }

  console.log(`Mode        : ${APPLY ? 'APPLY (écriture)' : 'DRY-RUN (aucune écriture)'}`);
  console.log(`Périmètre   : source = 'csv_manuel' ET created_at < ${BEFORE}`);

  // Verrou : déjà appliqué ?
  const lock = await pool.query('SELECT value FROM settings WHERE key = $1', [LOCK_KEY]);
  const appliedAt = lock.rows[0]?.value || null;
  if (appliedAt && APPLY && !FORCE) {
    console.log(`\nDéjà appliqué le ${appliedAt} (settings ${LOCK_KEY}).`);
    console.log('Ré-appliquer décalerait les données UNE DEUXIÈME FOIS. Refus (utiliser --force en connaissance de cause).');
    return;
  }
  if (appliedAt && !APPLY) {
    console.log(`\nNote : correction déjà appliquée le ${appliedAt} — le dry-run ci-dessous re-décalerait ces lignes, ne PAS enchaîner --apply sans --force réfléchi.`);
  }

  // Périmètre + échantillon avant/après
  const [tickets, ventes, sample] = await Promise.all([
    pool.query(`
      SELECT COUNT(*)::INT AS n, MIN(date_ticket) AS min_ts, MAX(date_ticket) AS max_ts
      FROM vak_tickets WHERE source = 'csv_manuel' AND created_at < $1
    `, [BEFORE]),
    pool.query(`
      SELECT COUNT(*)::INT AS n, MIN(date_vente) AS min_ts, MAX(date_vente) AS max_ts
      FROM vak_ventes WHERE source = 'csv_manuel' AND created_at < $1
    `, [BEFORE]),
    pool.query(`
      SELECT id, vak_id, ref_transaction,
             to_char(date_ticket, 'YYYY-MM-DD HH24:MI:SS')        AS stocke_actuel,
             to_char(${FIX('date_ticket')}, 'YYYY-MM-DD HH24:MI:SS') AS stocke_corrige_utc,
             EXTRACT(EPOCH FROM (date_ticket - ${FIX('date_ticket')}))::INT / 3600 AS decalage_h
      FROM vak_tickets WHERE source = 'csv_manuel' AND created_at < $1
      ORDER BY date_ticket LIMIT 8
    `, [BEFORE]),
  ]);

  const t = tickets.rows[0];
  const v = ventes.rows[0];
  console.log(`\nvak_tickets : ${t.n} ligne(s) à corriger${t.n ? ` (${t.min_ts?.toISOString?.() || t.min_ts} → ${t.max_ts?.toISOString?.() || t.max_ts})` : ''}`);
  console.log(`vak_ventes  : ${v.n} ligne(s) à corriger`);

  if (sample.rows.length > 0) {
    console.log('\nÉchantillon (heure stockée = murale Paris → heure corrigée = UTC) :');
    for (const s of sample.rows) {
      console.log(`  ticket #${s.id} (vak ${s.vak_id}, ${s.ref_transaction}) : ${s.stocke_actuel} → ${s.stocke_corrige_utc}  (−${s.decalage_h} h)`);
    }
  }

  if (t.n === 0 && v.n === 0) {
    console.log('\nRien à corriger.');
    return;
  }

  if (!APPLY) {
    console.log('\nDry-run terminé. Relancer avec --apply pour écrire.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r1 = await client.query(`
      UPDATE vak_tickets SET date_ticket = ${FIX('date_ticket')}
      WHERE source = 'csv_manuel' AND created_at < $1
    `, [BEFORE]);
    const r2 = await client.query(`
      UPDATE vak_ventes SET date_vente = ${FIX('date_vente')}
      WHERE source = 'csv_manuel' AND created_at < $1
    `, [BEFORE]);
    await client.query(`
      INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [LOCK_KEY, new Date().toISOString()]);
    await client.query('COMMIT');
    console.log(`\nOK — corrigé : ${r1.rowCount} ticket(s), ${r2.rowCount} ligne(s) de vente. Verrou ${LOCK_KEY} posé.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nÉCHEC — transaction annulée, aucune ligne modifiée :', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end().catch(() => {}));

#!/usr/bin/env node
/**
 * RESYNC DES DÉTAILS DE TRANSACTIONS SUMUP (VAK) — récupération des VRAIS poids
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTEXTE (bug « poids trop faibles malgré le correctif v2.20.0 ») :
 * `/v0.1/me/transactions/history` ne renvoie que des RÉSUMÉS sans lignes
 * produits. Quand le « retrieve » du détail (fetchTransactionDetail) échouait
 * ou ne renvoyait pas de produits, l'ingestion créait une LIGNE GLOBALE
 * SYNTHÉTIQUE `quantite = 1, unite = 'pce'`. Le backfill v2.20.0
 * (backfill-vak-poids.js) a ensuite requalifié ces lignes en 'kg' d'après le
 * libellé — mais avec la quantité 1 stockée : chaque vente au kilo comptait
 * ~1 kg au lieu du poids réellement pesé (ex. 3,2 kg saisi en caisse dans le
 * champ quantité). Le VRAI poids existe chez SumUp (quantity décimale du
 * produit) : ce script va le RECHERCHER transaction par transaction.
 *
 * CE QU'IL FAIT (idempotent, --dry-run par défaut) :
 *   1. Sélectionne les vak_tickets source api_sumup/webhook_sumup dont les
 *      lignes sont SYNTHÉTIQUES : aucune ligne, OU une ligne unique de
 *      |quantité| = 1 (forme produite par le fallback d'ingestion — couvre
 *      aussi les lignes requalifiées 'kg'/1 par le backfill). Un vrai ticket
 *      mono-article quantité 1 peut matcher : sans conséquence, la
 *      reconstruction depuis la vérité SumUp est idempotente.
 *   2. Ré-appelle le détail SumUp (fetchTransactionDetailStrict : cascade
 *      ?id= / ?transaction_code= / chemin) avec un rate limiting doux
 *      (--rate, défaut 5 req/s) et une reprise possible (un ticket non
 *      corrigé reste candidat au run suivant).
 *   3. Détail avec produits → reconstruit les vraies lignes vak_ventes
 *      (quantités décimales préservées), recalcule vak_tickets.poids_kg /
 *      nb_articles / totaux, puis les totaux des batches concernés.
 *   4. Détail SANS produits (SumUp ne connaît pas les lignes) → doctrine
 *      « jamais de valeur inventée » : la ligne 'kg' quantité 1 fabriquée par
 *      le backfill est requalifiée en 'pce' (poids honnête 0) et le ticket est
 *      compté dans l'indicateur « sans détail ». Un échec d'APPEL (réseau,
 *      quota) ne modifie RIEN (retenter plus tard).
 *   5. Journalise le run dans vak_sumup_sync_log (sync_type 'resync_detail')
 *      et affiche un récapitulatif avant/après par VAK.
 *
 * USAGE (dans le conteneur backend, EN PRODUCTION où l'API SumUp est joignable) :
 *   node src/scripts/resync-vak-details.js                # simulation (défaut)
 *   node src/scripts/resync-vak-details.js --apply        # applique
 *   node src/scripts/resync-vak-details.js --vak=12       # une seule VAK
 *   node src/scripts/resync-vak-details.js --limit=200    # borne le run (reprise)
 *   node src/scripts/resync-vak-details.js --rate=3       # 3 requêtes/seconde max
 *
 * PRÉREQUIS : SumUp connecté (page /admin/vak/sumup-config). Sans connexion,
 * le script s'arrête immédiatement avec un message clair.
 */

const pool = require('../config/database');
const sumup = require('../services/sumup');

const API_SOURCES = ['api_sumup', 'webhook_sumup'];

function fmt(n, dec = 3) {
  return Number(n || 0).toFixed(dec);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = { apply: false, vakId: null, limit: null, rate: 5 };
  for (const a of argv) {
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a.startsWith('--vak=')) args.vakId = parseInt(a.slice(6), 10) || null;
    else if (a.startsWith('--limit=')) args.limit = parseInt(a.slice(8), 10) || null;
    else if (a.startsWith('--rate=')) args.rate = Math.max(0.5, parseFloat(a.slice(7)) || 5);
  }
  return args;
}

/**
 * Reconstruit (PUR, sans DB) le contenu d'un ticket depuis le détail SumUp.
 * Réutilise mapSumUpTransaction (la même logique que l'ingestion : quantités
 * décimales préservées, isKgItem, remboursements signés) — la date des lignes
 * reste celle du ticket stocké (l'horodatage d'origine fait foi).
 */
function computeRebuildFromDetail(ticket, detail) {
  const txLike = {
    id: ticket.sumup_transaction_id || undefined,
    transaction_code: ticket.ref_transaction || undefined,
    timestamp: ticket.date_ticket,
  };
  const m = sumup.mapSumUpTransaction(txLike, detail);
  return {
    hasRealItems: m.hasRealItems,
    poids_kg: m.poidsTicket,
    nb_articles: m.nbArticles,
    total_ttc: m.totalTTC,
    total_ht: m.totalHT,
    total_tva: m.totalTVA,
    moyen_paiement: m.moyenPaiement,
    entry_mode: m.entryMode,
    lignes: m.lignes,
  };
}

/**
 * Le ticket porte-t-il une ligne 'kg' de |quantité| = 1 fabriquée par le
 * backfill (poids inventé) qu'il faut requalifier en 'pce' quand SumUp
 * confirme ne pas avoir de détail produits ? (PUR, testé.)
 */
function doitDegraderLigneKgSynthetique(lignes) {
  return Array.isArray(lignes)
    && lignes.length === 1
    && String(lignes[0].unite || '').toLowerCase().includes('kg')
    && Math.abs(Number(lignes[0].quantite) || 0) === 1;
}

async function snapshotParVak(vakId) {
  const r = await pool.query(`
    SELECT v.id, v.libelle,
           COALESCE(SUM(t.poids_kg), 0)::FLOAT AS poids_tickets,
           COUNT(t.id)::INT AS nb_tickets
    FROM vaks v
    LEFT JOIN vak_tickets t ON t.vak_id = v.id
    WHERE $1::INT IS NULL OR v.id = $1
    GROUP BY v.id, v.libelle
    ORDER BY v.id
  `, [vakId]);
  return r.rows;
}

async function selectCandidats(vakId, limit) {
  // Tickets API/webhook « synthétiques » : 0 ligne, ou 1 ligne |quantité| = 1.
  const r = await pool.query(`
    SELECT t.id, t.vak_id, t.batch_id, t.source, t.ref_transaction,
           t.sumup_transaction_id, t.date_ticket,
           t.poids_kg::FLOAT AS poids_kg, t.total_ttc::FLOAT AS total_ttc,
           COUNT(v.id)::INT AS nb_lignes,
           COALESCE(MAX(ABS(v.quantite)), 0)::FLOAT AS max_abs_quantite
    FROM vak_tickets t
    LEFT JOIN vak_ventes v ON v.ticket_id = t.id
    WHERE t.source = ANY($1)
      AND ($2::INT IS NULL OR t.vak_id = $2)
    GROUP BY t.id
    HAVING COUNT(v.id) = 0
        OR (COUNT(v.id) = 1 AND COALESCE(MAX(ABS(v.quantite)), 0) <= 1)
    ORDER BY t.id
    ${limit ? 'LIMIT ' + Number(limit) : ''}
  `, [API_SOURCES, vakId]);
  return r.rows;
}

async function lignesDuTicket(ticketId) {
  const r = await pool.query(`
    SELECT id, description, segment, unite, quantite::FLOAT AS quantite
    FROM vak_ventes WHERE ticket_id = $1 ORDER BY id
  `, [ticketId]);
  return r.rows;
}

async function rebuildTicket(ticket, rebuild) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      UPDATE vak_tickets SET
        poids_kg = $1, nb_articles = $2, total_ttc = $3, total_ht = $4,
        total_tva = $5, moyen_paiement = $6, entry_mode = COALESCE($7, entry_mode)
      WHERE id = $8
    `, [rebuild.poids_kg, rebuild.nb_articles, rebuild.total_ttc, rebuild.total_ht,
        rebuild.total_tva, rebuild.moyen_paiement, rebuild.entry_mode, ticket.id]);
    await client.query('DELETE FROM vak_ventes WHERE ticket_id = $1', [ticket.id]);
    for (const l of rebuild.lignes) {
      await client.query(`
        INSERT INTO vak_ventes
          (vak_id, ticket_id, batch_id, date_vente, ref_transaction, moyen_paiement,
           description, segment, unite, quantite, prix_unitaire_ttc,
           total_ht, total_ttc, total_tva, taux_tva, source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      `, [ticket.vak_id, ticket.id, ticket.batch_id, ticket.date_ticket,
          ticket.ref_transaction, rebuild.moyen_paiement,
          l.description, l.segment, l.unite, l.quantite, l.prix_unitaire_ttc,
          l.total_ht, l.total_ttc, l.total_tva, l.taux_tva, ticket.source]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function degraderTicketSansDetail(ticket) {
  // SumUp confirme : pas de détail produits → la ligne 'kg' quantité 1 du
  // backfill est un poids INVENTÉ ; on la requalifie en 'pce' et le poids du
  // ticket redevient honnêtement 0 (« jamais de valeur inventée »).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      UPDATE vak_ventes SET unite = 'pce'
      WHERE ticket_id = $1 AND unite ILIKE '%kg%' AND ABS(quantite) = 1
    `, [ticket.id]);
    await client.query(`
      UPDATE vak_tickets t SET poids_kg = COALESCE((
        SELECT ROUND(SUM(CASE WHEN unite ILIKE '%kg%' THEN quantite ELSE 0 END)::NUMERIC, 3)
        FROM vak_ventes WHERE ticket_id = t.id
      ), 0)
      WHERE t.id = $1
    `, [ticket.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function recalcBatches(batchIds) {
  if (batchIds.length === 0) return 0;
  const r = await pool.query(`
    WITH agg AS (
      SELECT batch_id,
             ROUND(SUM(CASE WHEN unite ILIKE '%kg%' THEN quantite ELSE 0 END)::NUMERIC, 3) AS poids
      FROM vak_ventes
      WHERE batch_id = ANY($1::int[])
      GROUP BY batch_id
    )
    UPDATE vak_import_batches b
    SET poids_total_kg = agg.poids
    FROM agg
    WHERE agg.batch_id = b.id
      AND b.poids_total_kg IS DISTINCT FROM agg.poids
    RETURNING b.id
  `, [batchIds]);
  return r.rowCount;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !args.apply;
  const pauseMs = Math.round(1000 / args.rate);

  console.log('');
  console.log(`RESYNC DÉTAILS SUMUP (VAK) ${dryRun ? '— MODE SIMULATION (--dry-run par défaut, aucun écrit ; --apply pour écrire)' : '— APPLICATION'}`);
  console.log('─'.repeat(78));

  try {
    // Pré-vol : SumUp doit être connecté (le script tourne en production).
    const status = await sumup.getConnectionStatus();
    if (!status.connected) {
      console.error('ABANDON : SumUp n\'est pas connecté (tokens absents/révoqués).');
      console.error('→ Reconnecter depuis /admin/vak/sumup-config puis relancer.');
      process.exitCode = 1;
      return;
    }

    const avant = await snapshotParVak(args.vakId);
    const candidats = await selectCandidats(args.vakId, args.limit);
    console.log(`Tickets candidats (lignes synthétiques ou absentes, sources ${API_SOURCES.join('/')}) : ${candidats.length}`);
    if (args.vakId) console.log(`Filtre --vak=${args.vakId}`);
    console.log(`Rate limiting : ${args.rate} req/s max (pause ${pauseMs} ms entre appels SumUp)`);
    console.log('');

    let reconstruits = 0;
    let sansDetail = 0;
    let degrades = 0;
    let echecsFetch = 0;
    let echecsConsecutifs = 0;
    let deltaPoidsTotal = 0;
    const deltaParVak = new Map(); // vak_id → delta poids (pour le récap dry-run)
    const batchIds = new Set();

    for (let i = 0; i < candidats.length; i++) {
      const t = candidats[i];
      if (i > 0) await sleep(pauseMs); // rate limiting doux
      if ((i + 1) % 25 === 0) console.log(`  … ${i + 1}/${candidats.length} tickets traités`);

      let fetchRes;
      try {
        fetchRes = await sumup.fetchTransactionDetailStrict({
          id: t.sumup_transaction_id,
          transactionCode: t.ref_transaction,
        });
      } catch (err) {
        fetchRes = { ok: false, attempts: [{ via: 'exception', error: err.message }] };
      }

      if (!fetchRes.ok) {
        // Échec d'APPEL (réseau, 401, quota…) : on ne touche à RIEN — le
        // ticket reste candidat, le run peut être relancé (reprise).
        echecsFetch++;
        echecsConsecutifs++;
        const firstErr = (fetchRes.attempts || []).map((a) => a.error).filter(Boolean)[0] || 'inconnu';
        console.warn(`  ✗ Ticket #${t.id} (${t.ref_transaction}) : détail injoignable — ${String(firstErr).slice(0, 120)}`);
        if (echecsConsecutifs >= 5) {
          console.error('');
          console.error('ABANDON : 5 échecs d\'appel SumUp consécutifs (token révoqué, quota ou réseau).');
          console.error('→ Vérifier la connexion SumUp (bouton « Diagnostic transaction » de /admin/vak/sumup-config) puis relancer : le script reprend où il s\'est arrêté.');
          break;
        }
        continue;
      }
      echecsConsecutifs = 0;

      if (!fetchRes.has_products) {
        // SumUp répond mais SANS produits : pas de poids connaissable.
        sansDetail++;
        const lignes = await lignesDuTicket(t.id);
        if (doitDegraderLigneKgSynthetique(lignes)) {
          const deltaDegrade = -(t.poids_kg || 0);
          console.log(`  ∅ Ticket #${t.id} (${t.ref_transaction}) : aucun détail chez SumUp — ligne 'kg' qté 1 requalifiée 'pce' (poids ${fmt(t.poids_kg)} → 0.000, ${dryRun ? 'simulé' : 'appliqué'})`);
          if (!dryRun) await degraderTicketSansDetail(t);
          degrades++;
          deltaPoidsTotal += deltaDegrade;
          deltaParVak.set(t.vak_id, (deltaParVak.get(t.vak_id) || 0) + deltaDegrade);
        } else {
          console.log(`  ∅ Ticket #${t.id} (${t.ref_transaction}) : aucun détail chez SumUp — poids inchangé (${fmt(t.poids_kg)} kg), compté « sans détail »`);
        }
        continue;
      }

      // Détail avec produits → reconstruction depuis la vérité SumUp.
      const rebuild = computeRebuildFromDetail(t, fetchRes.detail);
      const delta = rebuild.poids_kg - (t.poids_kg || 0);
      console.log(`  ✓ Ticket #${t.id} (${t.ref_transaction}) via ${fetchRes.via} : ${rebuild.lignes.length} ligne(s), poids ${fmt(t.poids_kg)} → ${fmt(rebuild.poids_kg)} kg (Δ ${(delta >= 0 ? '+' : '') + fmt(delta)})${dryRun ? ' [simulé]' : ''}`);
      if (!dryRun) {
        await rebuildTicket(t, rebuild);
        if (t.batch_id) batchIds.add(t.batch_id);
      }
      reconstruits++;
      deltaPoidsTotal += delta;
      deltaParVak.set(t.vak_id, (deltaParVak.get(t.vak_id) || 0) + delta);
    }

    let batchesRecalcules = 0;
    if (!dryRun) batchesRecalcules = await recalcBatches([...batchIds]);

    // Journal du run (uniquement en --apply : un dry-run ne laisse AUCUNE trace).
    if (!dryRun) {
      await pool.query(`
        INSERT INTO vak_sumup_sync_log
          (sync_type, status, ended_at, nb_transactions_received,
           nb_transactions_inserted, nb_transactions_skipped, details)
        VALUES ('resync_detail', 'success', NOW(), $1, $2, $3, $4)
      `, [candidats.length, reconstruits, sansDetail + echecsFetch,
          JSON.stringify({
            script: 'resync-vak-details.js',
            vak_id: args.vakId,
            reconstruits,
            sans_detail: sansDetail,
            degrades,
            echecs_fetch: echecsFetch,
            delta_poids_kg: Number(deltaPoidsTotal.toFixed(3)),
          })]);
    }

    // Récapitulatif avant/après par VAK.
    console.log('');
    console.log('RÉCAPITULATIF');
    console.log('─'.repeat(78));
    console.log(`Tickets examinés          : ${candidats.length}`);
    console.log(`Reconstruits (détail OK)  : ${reconstruits}`);
    console.log(`Sans détail chez SumUp    : ${sansDetail} (dont ${degrades} ligne(s) 'kg' qté 1 requalifiée(s) 'pce')`);
    console.log(`Échecs d'appel (reprise)  : ${echecsFetch}`);
    if (!dryRun) console.log(`Batches recalculés        : ${batchesRecalcules}`);
    console.log('');
    console.log('Poids par VAK (somme vak_tickets.poids_kg) :');
    console.log('  VAK'.padEnd(40) + 'AVANT (kg)'.padStart(14) + (dryRun ? 'APRÈS simulé' : 'APRÈS (kg)').padStart(14) + 'Δ'.padStart(10));
    const apres = dryRun ? avant : await snapshotParVak(args.vakId);
    const avantById = new Map(avant.map((v) => [v.id, v]));
    for (const v of apres) {
      const a = avantById.get(v.id) || { poids_tickets: 0 };
      const delta = dryRun ? (deltaParVak.get(v.id) || 0) : (v.poids_tickets - a.poids_tickets);
      const apresVal = dryRun ? a.poids_tickets + delta : v.poids_tickets;
      if (delta === 0 && candidats.every((c) => c.vak_id !== v.id)) continue; // VAK non concernée
      console.log(
        `  #${v.id} ${String(v.libelle || '').slice(0, 32)}`.padEnd(40)
        + fmt(a.poids_tickets).padStart(14)
        + fmt(apresVal).padStart(14)
        + ((delta >= 0 ? '+' : '') + fmt(delta)).padStart(10),
      );
    }
    console.log('');
    if (dryRun) {
      console.log('Simulation terminée — base inchangée. Relancer avec --apply pour écrire.');
    } else {
      console.log('Resync appliqué. Ré-exécutable sans effet (les tickets reconstruits ne matchent plus le critère synthétique).');
    }
    process.exitCode = 0;
  } catch (err) {
    console.error('ERREUR resync détails VAK :', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

// Exporte les fonctions PURES pour les tests (aucun réseau/DB dans celles-ci).
module.exports = { computeRebuildFromDetail, doitDegraderLigneKgSynthetique, parseArgs };

if (require.main === module) {
  main();
}

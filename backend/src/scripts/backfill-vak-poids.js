#!/usr/bin/env node
/**
 * BACKFILL DES POIDS VAK (Lot 6 — bug « les poids des ventes sont tous à zéro »)
 * ─────────────────────────────────────────────────────────────────────────────
 * CAUSE : le chemin d'ingestion API/webhook SumUp ne recevait pas d'unité sur
 * les produits (l'API n'en expose pas) → toutes les lignes étaient stockées
 * `unite = 'pce'` et le poids (vak_tickets.poids_kg + agrégat SQL
 * `unite ILIKE '%kg%'` sur vak_ventes) sortait à 0. Corrigé à l'ingestion
 * (services/sumup.js — helper isKgItem : inférence « kg » par le libellé
 * produit via les segments au poids KG_SEGMENTS). Ce script répare
 * l'HISTORIQUE déjà en base SANS re-synchroniser SumUp, à partir des
 * descriptions/quantités stockées dans vak_ventes.
 *
 * CE QU'IL FAIT (idempotent, transactionnel) :
 *   1. Requalifie en 'kg' l'unité des lignes vak_ventes vendues au kilo —
 *      segments au poids KG_SEGMENTS = textile_vrac ET chaussures (données
 *      réelles FRIP & CO : « 1.595 x Chaussures » = 1,595 kg × 3,00 €/kg ;
 *      les « Sacs » restent à la pièce). Relancer ce script après le
 *      déploiement de la règle chaussures requalifie l'HISTORIQUE des lignes
 *      « Chaussures » stockées 'pce' avec quantité décimale :
 *      - sources api_sumup / webhook_sumup : le 'pce' stocké était un DÉFAUT
 *        synthétique (jamais une donnée SumUp) → requalification par le
 *        libellé seul (isKgItem(description)), SAUF |quantité| = 1 EXACTEMENT
 *        (garde d'ambiguïté, voir classifierRequalification) ;
 *      - source csv_manuel (et autres) : la colonne « Unité » du CSV fait
 *        foi → requalification UNIQUEMENT si l'unité stockée est vide et que
 *        le libellé tombe dans un segment au poids.
 *      Jamais de déclassement (une unité 'kg' existante n'est pas touchée).
 *   2. Recalcule vak_tickets.poids_kg = somme SIGNÉE des quantités des lignes
 *      kg du ticket (les remboursements pèsent négatif, comme à l'ingestion).
 *      Seuls les tickets ayant AU MOINS une ligne sont recalculés (un ticket
 *      orphelin de lignes garde son poids — on ne détruit pas d'information).
 *   3. Recalcule vak_import_batches.poids_total_kg depuis les lignes du batch.
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/backfill-vak-poids.js --dry-run   # simulation, aucun écrit
 *   node src/scripts/backfill-vak-poids.js             # applique
 *
 * Affiche un récapitulatif avant/après par VAK. Ré-exécutable à volonté :
 * une fois l'historique corrigé, le script ne modifie plus rien.
 */

const pool = require('../config/database');
const { isKgItem } = require('../services/sumup');

const API_SOURCES = ['api_sumup', 'webhook_sumup'];

/**
 * Classification PURE d'une ligne vak_ventes candidate (unité stockée ne
 * contenant pas déjà 'kg') — exportée pour les tests, aucune DB ici.
 * Retourne :
 *   - 'kg'        → la ligne doit être requalifiée unite = 'kg' ;
 *   - 'ambigue'   → libellé au poids MAIS |quantité| = 1 exactement sur une
 *                   source API/webhook : JAMAIS requalifiée (comptée au récap) ;
 *   - 'inchangee' → rien à faire (article à la pièce, unité CSV qui fait foi…).
 *
 * GARDE D'AMBIGUÏTÉ |qté| = 1 (doctrine PR#90 « jamais de valeur inventée ») :
 * sur les sources API/webhook, une ligne de |quantité| = 1 EXACTEMENT est
 * indistinguable a posteriori de :
 *   - la LIGNE GLOBALE SYNTHÉTIQUE du fallback d'ingestion (1 ligne, qté ±1 :
 *     un artefact « 1 ticket », pas un poids — l'ancienne garde PR#90) ;
 *   - une vente À LA PIÈCE historique (ex. « Chaussures » = 1 paire, prix à
 *     la paire, avant le passage de la caisse au €/kg) ;
 *   - une vraie vente de 1,000 kg pile.
 * La requalifier en 'kg' inventerait potentiellement un poids → on n'y touche
 * pas ; c'est resync-vak-details.js qui re-lit la vérité chez SumUp. Le seuil
 * est bien === 1 STRICT et non ≤ 1 : une quantité décimale (« 0.92 x Vente
 * Moins de 5 Kg », « 1.595 x Chaussures ») est un poids pesé RÉEL qui doit
 * être requalifié.
 *
 * PORTÉE DE LA GARDE (revue Codex PR#91) : l'ambiguïté ne concerne que les
 * tickets MONO-ligne — la ligne globale synthétique du fallback d'ingestion
 * n'a JAMAIS produit de ticket multi-lignes. Dans un ticket multi-lignes, les
 * lignes viennent d'un VRAI détail produits SumUp : une quantité 1 y est un
 * vrai 1,000 kg pesé → requalifiée 'kg' (sinon elle tombait entre les deux
 * filets, resync-vak-details ne sélectionnant que les tickets à 0/1 ligne).
 * `nb_lignes_ticket` = nombre TOTAL de lignes du ticket (défaut 1 si absent).
 */
function classifierRequalification(ligne) {
  const apiSource = API_SOURCES.includes(String(ligne.source || '').trim());
  if (apiSource) {
    // API/webhook : le 'pce' stocké était un défaut du code (SumUp ne fournit
    // pas d'unité) → inférence par le libellé seul (segments au poids
    // KG_SEGMENTS = textile_vrac + chaussures, cf. services/sumup.js).
    if (!isKgItem(ligne.description, '')) return 'inchangee';
    const nbLignes = Number(ligne.nb_lignes_ticket) || 1;
    if (nbLignes <= 1 && Math.abs(Number(ligne.quantite) || 0) === 1) return 'ambigue';
    return 'kg';
  }
  // CSV (et autres) : l'unité stockée fait foi (isKgItem ne requalifie que si
  // elle est vide et que le libellé tombe dans un segment au poids).
  return isKgItem(ligne.description, ligne.unite) ? 'kg' : 'inchangee';
}

function fmt(n, dec = 3) {
  return Number(n || 0).toFixed(dec);
}

async function snapshotParVak(client) {
  const r = await client.query(`
    SELECT v.id, v.libelle,
           COALESCE(SUM(t.poids_kg), 0)::FLOAT AS poids_tickets,
           COALESCE((
             SELECT SUM(CASE WHEN vv.unite ILIKE '%kg%' THEN vv.quantite ELSE 0 END)
             FROM vak_ventes vv WHERE vv.vak_id = v.id
           ), 0)::FLOAT AS poids_ventes,
           COUNT(t.id)::INT AS nb_tickets
    FROM vaks v
    LEFT JOIN vak_tickets t ON t.vak_id = v.id
    GROUP BY v.id, v.libelle
    ORDER BY v.id
  `);
  return r.rows;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const avant = await snapshotParVak(client);

    // ── 1. Requalification des lignes vendues au kilo ────────────────────────
    // Chargement des lignes candidates (unité ne contenant pas déjà 'kg') ;
    // la décision par ligne est portée par classifierRequalification (pure,
    // testée) : segments au poids textile_vrac + chaussures, garde
    // d'ambiguïté |qté| = 1 sur les sources API/webhook (englobe l'ancienne
    // détection de la ligne GLOBALE SYNTHÉTIQUE du fallback d'ingestion).
    const lignes = await client.query(`
      SELECT vv.id, vv.description, vv.unite, vv.source, vv.quantite::FLOAT AS quantite,
             COALESCE((
               SELECT COUNT(*) FROM vak_ventes x WHERE x.ticket_id = vv.ticket_id
             ), 1)::INT AS nb_lignes_ticket
      FROM vak_ventes vv
      WHERE COALESCE(vv.unite, '') NOT ILIKE '%kg%'
    `);

    const idsAKg = [];
    let lignesAmbigues = 0;
    for (const l of lignes.rows) {
      const verdict = classifierRequalification(l);
      if (verdict === 'kg') idsAKg.push(l.id);
      else if (verdict === 'ambigue') lignesAmbigues++;
    }

    let lignesRequalifiees = 0;
    if (idsAKg.length > 0) {
      const upd = await client.query(
        `UPDATE vak_ventes SET unite = 'kg' WHERE id = ANY($1::int[])`,
        [idsAKg],
      );
      lignesRequalifiees = upd.rowCount;
    }

    // ── 2. Recalcul du poids des tickets depuis leurs lignes (somme signée) ──
    const updTickets = await client.query(`
      WITH agg AS (
        SELECT ticket_id,
               ROUND(SUM(CASE WHEN unite ILIKE '%kg%' THEN quantite ELSE 0 END)::NUMERIC, 3) AS poids
        FROM vak_ventes
        WHERE ticket_id IS NOT NULL
        GROUP BY ticket_id
      )
      UPDATE vak_tickets t
      SET poids_kg = agg.poids
      FROM agg
      WHERE agg.ticket_id = t.id
        AND t.poids_kg IS DISTINCT FROM agg.poids
      RETURNING t.id
    `);

    // ── 3. Recalcul du poids total des batches d'import ──────────────────────
    const updBatches = await client.query(`
      WITH agg AS (
        SELECT batch_id,
               ROUND(SUM(CASE WHEN unite ILIKE '%kg%' THEN quantite ELSE 0 END)::NUMERIC, 3) AS poids
        FROM vak_ventes
        WHERE batch_id IS NOT NULL
        GROUP BY batch_id
      )
      UPDATE vak_import_batches b
      SET poids_total_kg = agg.poids
      FROM agg
      WHERE agg.batch_id = b.id
        AND b.poids_total_kg IS DISTINCT FROM agg.poids
      RETURNING b.id
    `);

    const apres = await snapshotParVak(client);

    // ── Récapitulatif ────────────────────────────────────────────────────────
    console.log('');
    console.log(`BACKFILL POIDS VAK ${dryRun ? '— MODE SIMULATION (--dry-run, aucun écrit)' : ''}`);
    console.log('─'.repeat(78));
    console.log(`Lignes vak_ventes requalifiées en 'kg' : ${lignesRequalifiees}`);
    if (lignesAmbigues > 0) {
      console.log(`Lignes AMBIGUËS non touchées (|qté|=1) : ${lignesAmbigues} — libellé au poids mais quantité 1 pile sur source API/webhook (forme synthétique, vente à la pièce historique ou vraie vente de 1,000 kg — indistinguables) ; resync-vak-details.js relit la vérité chez SumUp.`);
    }
    console.log(`Tickets vak_tickets recalculés         : ${updTickets.rowCount}`);
    console.log(`Batches vak_import_batches recalculés  : ${updBatches.rowCount}`);
    console.log('');
    console.log('Poids par VAK (somme vak_tickets.poids_kg) :');
    console.log('  VAK'.padEnd(40) + 'AVANT (kg)'.padStart(14) + 'APRÈS (kg)'.padStart(14) + 'Δ'.padStart(10));
    const avantById = new Map(avant.map((v) => [v.id, v]));
    for (const v of apres) {
      const a = avantById.get(v.id) || { poids_tickets: 0 };
      const delta = v.poids_tickets - a.poids_tickets;
      console.log(
        `  #${v.id} ${String(v.libelle || '').slice(0, 32)}`.padEnd(40)
        + fmt(a.poids_tickets).padStart(14)
        + fmt(v.poids_tickets).padStart(14)
        + ((delta >= 0 ? '+' : '') + fmt(delta)).padStart(10),
      );
    }
    console.log('');

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('Simulation terminée — ROLLBACK effectué, base inchangée.');
      console.log('Relancer sans --dry-run pour appliquer.');
    } else {
      await client.query('COMMIT');
      console.log('Backfill appliqué (COMMIT). Ré-exécutable sans effet (idempotent).');
    }
    process.exitCode = 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERREUR backfill poids VAK :', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

// Exporte la fonction PURE de décision pour les tests (aucune DB dedans).
module.exports = { classifierRequalification };

if (require.main === module) {
  main();
}

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
const { isKgItem, parseKgPrefix, getSegment } = require('../services/sumup');

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
 *
 * POIDS DANS LE TEXTE (2.21.3 — forme RÉELLE de l'API en prod, transaction
 * TAAA4NPRDAC) : la caisse SumUp nomme les articles pesés « X kg <libellé> »
 * (name produit « 3,88 kg Vente Moins de 5 Kg », quantity toujours 1 ;
 * product_summary « 1 x 3,88 kg Vente… » recopié dans la description des
 * lignes synthétiques). Quand la description stockée porte ce préfixe MONO-
 * article (parseKgPrefix), le poids RÉEL est LISIBLE dans le texte → verdict
 * 'kg_texte' : unite = 'kg' ET quantite = poids extrait (signé). La garde
 * d'ambiguïté |qté| = 1 NE S'APPLIQUE PLUS ici — le texte fait foi, il n'y a
 * plus rien à inventer. Un résumé synthétique MULTI-articles (« …, 2 x … »)
 * n'est jamais parsé (poids par article inconnu) : c'est le script
 * repair-vak-from-report.js (rapport CSV) ou resync-vak-details.js (API) qui
 * reconstruit ses vraies lignes. Réservé aux sources API/webhook : côté CSV,
 * les colonnes Quantité/Unité explicites font foi, jamais le libellé.
 */
function classifierRequalification(ligne) {
  const apiSource = API_SOURCES.includes(String(ligne.source || '').trim());
  const uniteKg = String(ligne.unite || '').toLowerCase().includes('kg');
  if (apiSource) {
    // 1. Poids encodé dans le texte de la description (prioritaire — lisible,
    //    donc la garde d'ambiguïté ne s'applique pas).
    const prefix = parseKgPrefix(ligne.description);
    if (prefix) {
      if (!uniteKg) return 'kg_texte';
      // Déjà 'kg' mais quantité ≠ poids du texte (ex. requalifiée qté 1 par le
      // backfill v2.20.0 alors que le texte dit 3,88 kg) → corrigée. Tolérance
      // 0,0005 : quantite est un NUMERIC(10,3) arrondi en base.
      const q = Math.abs(Number(ligne.quantite) || 0);
      return Math.abs(q - prefix.poids) > 0.0005 ? 'kg_texte' : 'inchangee';
    }
    if (uniteKg) return 'inchangee'; // déjà au kilo, rien dans le texte
    // 2. API/webhook : le 'pce' stocké était un défaut du code (SumUp ne
    //    fournit pas d'unité) → inférence par le libellé seul (segments au
    //    poids KG_SEGMENTS = textile_vrac + chaussures, cf. services/sumup.js).
    if (!isKgItem(ligne.description, '')) return 'inchangee';
    const nbLignes = Number(ligne.nb_lignes_ticket) || 1;
    if (nbLignes <= 1 && Math.abs(Number(ligne.quantite) || 0) === 1) return 'ambigue';
    return 'kg';
  }
  if (uniteKg) return 'inchangee';
  // CSV (et autres) : l'unité stockée fait foi (isKgItem ne requalifie que si
  // elle est vide et que le libellé tombe dans un segment au poids).
  return isKgItem(ligne.description, ligne.unite) ? 'kg' : 'inchangee';
}

/**
 * Nouvelle valeur d'une ligne 'kg_texte' (PURE) : quantité = poids extrait du
 * texte, SIGNÉE comme la ligne d'origine (un remboursement synthétique stocké
 * quantité −1 redevient −poids), segment recalculé sur le libellé débarrassé
 * du préfixe, prix unitaire = €/kg réel (total TTC ÷ poids) quand calculable.
 * La description stockée n'est PAS réécrite (le texte est la preuve du poids).
 */
function valeursDepuisTexte(ligne) {
  const prefix = parseKgPrefix(ligne.description);
  if (!prefix) return null;
  const q = Number(ligne.quantite) || 0;
  const ttc = Number(ligne.total_ttc) || 0;
  const sign = q < 0 || (q === 0 && ttc < 0) ? -1 : 1;
  const quantite = sign * prefix.poids;
  const prixKg = prefix.poids > 0 && ttc !== 0
    ? Math.round((Math.abs(ttc) / prefix.poids) * 100) / 100 * sign
    : null;
  return {
    quantite,
    segment: getSegment(prefix.libelle),
    prix_unitaire_ttc: prixKg,
  };
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
    // Candidates : (a) unité ne contenant pas déjà 'kg' (règles historiques),
    // (b) lignes API/webhook dont la DESCRIPTION porte un préfixe « X kg »
    // (2.21.3 — y compris déjà 'kg' : une ligne requalifiée qté 1 par le
    // backfill v2.20.0 alors que le texte dit « 3,88 kg » doit être corrigée).
    // La décision par ligne est portée par classifierRequalification (pure,
    // testée) : 'kg_texte' (poids lisible dans le texte, prioritaire),
    // 'kg' (inférence segments au poids textile_vrac + chaussures), 'ambigue'
    // (|qté| = 1 mono-ligne API — jamais touchée), 'inchangee'.
    const lignes = await client.query(`
      SELECT vv.id, vv.description, vv.unite, vv.source,
             vv.quantite::FLOAT AS quantite, vv.total_ttc::FLOAT AS total_ttc,
             COALESCE((
               SELECT COUNT(*) FROM vak_ventes x WHERE x.ticket_id = vv.ticket_id
             ), 1)::INT AS nb_lignes_ticket
      FROM vak_ventes vv
      WHERE COALESCE(vv.unite, '') NOT ILIKE '%kg%'
         OR (vv.source = ANY($1)
             AND vv.description ~* '^\\s*(1\\s*[x×]\\s*)?[0-9]+([.,][0-9]+)?\\s*kg\\s')
    `, [API_SOURCES]);

    const idsAKg = [];
    const lignesTexte = []; // { id, quantite, segment, prix_unitaire_ttc }
    let lignesAmbigues = 0;
    for (const l of lignes.rows) {
      const verdict = classifierRequalification(l);
      if (verdict === 'kg') idsAKg.push(l.id);
      else if (verdict === 'kg_texte') {
        const v = valeursDepuisTexte(l);
        if (v) lignesTexte.push({ id: l.id, ...v });
      } else if (verdict === 'ambigue') lignesAmbigues++;
    }

    let lignesRequalifiees = 0;
    if (idsAKg.length > 0) {
      const upd = await client.query(
        `UPDATE vak_ventes SET unite = 'kg' WHERE id = ANY($1::int[])`,
        [idsAKg],
      );
      lignesRequalifiees = upd.rowCount;
    }

    // 'kg_texte' : le poids RÉEL est lu dans la description (« 3,88 kg Vente
    // Moins de 5 Kg ») → unité kg + quantité = poids signé + €/kg recalculé.
    // La description est conservée telle quelle (preuve du poids) ; idempotent
    // (au run suivant, quantité == poids du texte → 'inchangee').
    let lignesTexteCorrigees = 0;
    for (const lt of lignesTexte) {
      const upd = await client.query(`
        UPDATE vak_ventes SET
          unite = 'kg',
          quantite = $1,
          segment = $2,
          prix_unitaire_ttc = COALESCE($3, prix_unitaire_ttc)
        WHERE id = $4
      `, [lt.quantite, lt.segment, lt.prix_unitaire_ttc, lt.id]);
      lignesTexteCorrigees += upd.rowCount;
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
    console.log(`Lignes corrigées depuis le TEXTE (« X kg <libellé> », poids réel lu dans la description) : ${lignesTexteCorrigees}`);
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

// Exporte les fonctions PURES de décision pour les tests (aucune DB dedans).
module.exports = { classifierRequalification, valeursDepuisTexte };

if (require.main === module) {
  main();
}

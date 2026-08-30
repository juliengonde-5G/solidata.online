#!/usr/bin/env node
/**
 * RÉPARATION DES VAK DEPUIS LE « RAPPORT DES VENTES » SUMUP (CSV 17 colonnes)
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTEXTE (v2.21.3 — « VAK juillet : 645 kg affichés au lieu de 2 786,9 kg ») :
 * en production, l'API SumUp ne renvoie PAS le détail produits des transactions
 * (resync-vak-details.js --apply exécuté sans effet) — la majorité des tickets
 * api_sumup/webhook_sumup portent une ligne globale synthétique quantité 1 :
 * le poids pesé est PERDU côté API. Or l'export « Rapport des ventes » SumUp
 * (CSV 17 colonnes : Date, Type, Réf. transaction, Moyen de paiement, Quantité,
 * Unité, Description, Catégorie, SKU, Devise, Prix avant réduction, Réduction,
 * Prix (TTC), Prix (HT), TVA, Taux de TVA, Compte) contient LA VÉRITÉ ligne à
 * ligne : quantités décimales, unité kg/pce EXPLICITE, une ligne par article
 * par transaction (Réf. transaction partagée), et le COMPTE de caisse
 * (« Caissier Frip & Co » / « Caisse Vintiz »…). Ce script répare la base
 * depuis ce fichier, SANS dépendre de l'API.
 *
 * CE QU'IL FAIT (transactionnel, idempotent, --dry-run par défaut) :
 *   1. Parse le CSV avec le MÊME parseur que l'import (services/sumup.js :
 *      splitCSVLine, parseFRDate en heure murale Paris → stockage UTC,
 *      parseNumberFR, getSegment, isKgItem — l'unité CSV explicite fait foi,
 *      remboursements signés) et groupe les lignes par « Réf. transaction ».
 *   2. Pour chaque transaction du fichier :
 *      - ticket EXISTANT (match ref_transaction OU sumup_transaction_id,
 *        toutes sources api_sumup/webhook_sumup/csv_manuel) → REMPLACE ses
 *        lignes vak_ventes par les lignes CSV, recalcule poids_kg /
 *        nb_articles / totaux du ticket et renseigne son `compte` (colonne
 *        « Compte ») ; la date du ticket stocké est CONSERVÉE (l'horodatage
 *        d'origine, API à la seconde, fait foi) ;
 *      - AUCUN ticket → le CRÉE (rattachement à la VAK couvrant sa date
 *        civile Paris, batch dédié source 'repair_csv') pour combler les
 *        trous de la sync ;
 *      - GARDE PAIEMENTS SCINDÉS : une vente réglée en deux fois apparaît dans
 *        le rapport sur UNE ligne portant les DEUX références (« REF1, REF2 »)
 *        alors que l'API livre DEUX transactions, une par moyen de paiement,
 *        dont la SOMME est déjà juste. Si l'une des deux existe en base, la
 *        transaction est IGNORÉE et signalée : la réécrire compterait la vente
 *        deux fois, et répartir ses articles entre les deux moitiés serait une
 *        invention. Si aucune n'existe, le ticket est créé normalement (trou de
 *        sync réellement comblé).
 *      - GARDE ANTI-DÉGRADATION : un ticket dont les lignes stockées sont
 *        déjà détaillées ET identiques au CSV n'est jamais réécrit
 *        (re-run = 0 changement) ; un ticket ABSENT du fichier n'est JAMAIS
 *        supprimé ni modifié.
 *   3. Récapitulatif avant/après par VAK (poids / CA / tickets) et journal
 *      vak_sumup_sync_log type 'repair_csv' (en --apply uniquement).
 *
 * USAGE (dans le conteneur backend) :
 *   node src/scripts/repair-vak-from-report.js --file=/chemin/rapport.csv          # simulation
 *   node src/scripts/repair-vak-from-report.js --file=/chemin/rapport.csv --apply  # applique
 *   node src/scripts/repair-vak-from-report.js --file=... --vak=12                 # une seule VAK
 *
 * NB : les transactions du fichier hors de toute période VAK sont ignorées
 * (comptées « hors VAK ») — le rattachement reste par jour civil Paris. Le
 * filtre par caisse (vaks.compte_caisse) s'applique à la LECTURE des KPI, pas
 * ici : on répare TOUT ce que le fichier prouve, y compris les tickets d'une
 * autre caisse (leur compte est justement ce qui permettra de les exclure).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/database');
const sumup = require('../services/sumup');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const fmt = (n, dec = 3) => Number(n || 0).toFixed(dec);

function parseArgs(argv) {
  const args = { apply: false, file: null, vakId: null };
  for (const a of argv) {
    if (a === '--apply') args.apply = true;
    else if (a === '--dry-run') args.apply = false;
    else if (a.startsWith('--file=')) args.file = a.slice(7) || null;
    else if (a.startsWith('--vak=')) args.vakId = parseInt(a.slice(6), 10) || null;
  }
  return args;
}

/**
 * Parse PUR du rapport CSV (17 colonnes) — même sémantique que l'import
 * (services/sumup.importCSVContent), SANS bornage par période de VAK (le
 * rattachement se fait ensuite, ticket par ticket). Retourne les transactions
 * groupées par « Réf. transaction » + les erreurs de parse.
 */
function parseReportCSV(content) {
  const lines = String(content).replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  let header = lines.shift();
  // Auto-detect : si la 1ère ligne ne ressemble pas à un en-tête, la traiter en data
  if (header && !/^Date|^Réf|^Date,/i.test(header)) {
    lines.unshift(header);
    header = null;
  }

  const erreurs = [];
  const parRef = new Map(); // ref → lignes[]
  for (let i = 0; i < lines.length; i++) {
    const parts = sumup.splitCSVLine(lines[i]);
    if (parts.length < 14) {
      erreurs.push({ line: i + 2, error: `Colonnes insuffisantes (${parts.length})` });
      continue;
    }
    try {
      const [
        dateStr, type, refTx, moyenPaiement, quantiteStr, unite, description,
        _categorie, _sku, _devise, _prixAvantRed, remiseStr, totalTTCStr, totalHTStr, totalTVAStr, tauxTVAStr, compte,
      ] = parts;

      const dateVente = sumup.parseFRDate(dateStr);
      if (!dateVente) throw new Error(`Date invalide: "${dateStr}"`);

      const quantite = sumup.parseNumberFR(quantiteStr);
      const totalTTC = sumup.parseNumberFR(totalTTCStr);
      const totalHT = sumup.parseNumberFR(totalHTStr);
      const totalTVA = sumup.parseNumberFR(totalTVAStr);
      const tauxTVA = sumup.parseNumberFR((tauxTVAStr || '').replace(/[%\s]/g, ''));
      const remise = sumup.parseNumberFR(remiseStr);
      const segment = sumup.getSegment(description);
      // Unité kg : la colonne « Unité » du CSV FAIT FOI ; inférence par le
      // libellé seulement si elle est vide (même règle que l'import).
      const ligneKg = sumup.isKgItem(description, unite);
      const uniteNorm = (unite || '').trim().toLowerCase() || (ligneKg ? 'kg' : '');
      // Remboursement (colonne « Type ») → lignes en négatif (même sémantique
      // que l'import CSV et les voies API/webhook).
      const sign = sumup.isRefundTransaction({ type }) ? -1 : 1;
      const moyenPaiementNorm = sumup.normalizePaymentMethod(moyenPaiement);

      const ref = (refTx || '').trim() || `unknown-${i}`;
      if (!parRef.has(ref)) parRef.set(ref, []);
      parRef.get(ref).push({
        date_vente: dateVente,
        moyen_paiement: moyenPaiementNorm,
        description: (description || '').trim(),
        segment,
        unite: uniteNorm,
        quantite: sign * quantite,
        prix_unitaire_ttc: sign * (totalTTC / Math.max(1, Math.abs(quantite || 1))),
        remise,
        total_ht: sign * totalHT,
        total_ttc: sign * totalTTC,
        total_tva: sign * totalTVA,
        taux_tva: tauxTVA,
        compte: (compte || '').trim(),
        est_kg: ligneKg,
      });
    } catch (e) {
      erreurs.push({ line: i + 2, error: e.message });
    }
  }

  const transactions = [...parRef.entries()].map(([ref, lignes]) => construireTicket(ref, lignes));
  return { transactions, nb_lignes: lines.length, erreurs };
}

/**
 * Agrégats PURS d'un ticket depuis ses lignes CSV : poids = somme SIGNÉE des
 * quantités kg (les remboursements pèsent négatif), totaux = sommes signées,
 * compte = 1re valeur non vide de la colonne « Compte », date = 1re ligne
 * chronologique (même règle que l'import).
 */
function construireTicket(ref, lignes) {
  const dateTicket = lignes.reduce((min, l) => (l.date_vente < min ? l.date_vente : min), lignes[0].date_vente);
  const poids = round3(lignes.filter((l) => (l.unite || '').includes('kg'))
    .reduce((s, l) => s + (Number.isFinite(l.quantite) ? l.quantite : 0), 0));
  const compte = lignes.map((l) => (l.compte || '').trim()).find((c) => c) || null;
  return {
    ref,
    date_ticket: dateTicket,
    moyen_paiement: lignes[0].moyen_paiement,
    compte: compte ? compte.slice(0, 120) : null,
    nb_articles: lignes.length,
    poids_kg: poids,
    total_ttc: round2(lignes.reduce((s, l) => s + l.total_ttc, 0)),
    total_ht: round2(lignes.reduce((s, l) => s + l.total_ht, 0)),
    total_tva: round2(lignes.reduce((s, l) => s + l.total_tva, 0)),
    lignes,
  };
}

// Clé de comparaison d'une ligne (ordre indifférent — multiset).
function normLigne(l) {
  return [
    String(l.description || '').trim().toLowerCase(),
    String(l.unite || '').trim().toLowerCase(),
    round3(l.quantite).toFixed(3),
    round2(l.total_ttc).toFixed(2),
    String(l.compte || '').trim().toLowerCase(),
  ].join('|');
}

/**
 * Les lignes stockées sont-elles déjà DÉTAILLÉES ET IDENTIQUES aux lignes du
 * CSV (description, unité, quantité, TTC, compte — comparaison en multiset) ?
 * → garde anti-dégradation : un ticket déjà juste n'est jamais réécrit.
 */
function lignesIdentiques(existantes, nouvelles) {
  if (!Array.isArray(existantes) || existantes.length !== (nouvelles || []).length) return false;
  const a = existantes.map(normLigne).sort();
  const b = nouvelles.map(normLigne).sort();
  return a.every((k, i) => k === b[i]);
}

// Les agrégats du ticket stocké correspondent-ils au calcul CSV ?
function ticketIdentique(existant, calcule) {
  const eq2 = (x, y) => Math.abs((Number(x) || 0) - (Number(y) || 0)) < 0.005;
  const eq3 = (x, y) => Math.abs((Number(x) || 0) - (Number(y) || 0)) < 0.0005;
  const compteEq = String(existant.compte || '').trim().toLowerCase()
    === String(calcule.compte || '').trim().toLowerCase();
  return eq3(existant.poids_kg, calcule.poids_kg)
    && Number(existant.nb_articles) === calcule.nb_articles
    && eq2(existant.total_ttc, calcule.total_ttc)
    && eq2(existant.total_ht, calcule.total_ht)
    && eq2(existant.total_tva, calcule.total_tva)
    && compteEq;
}

/**
 * Décision PURE par transaction :
 *  - 'create'     → aucun ticket en base (trou de sync) ;
 *  - 'inchange'   → lignes ET agrégats identiques (idempotence — jamais réécrit) ;
 *  - 'maj_ticket' → lignes identiques mais agrégats/compte du ticket à corriger
 *                   (pas de réécriture des lignes) ;
 *  - 'replace'    → lignes différentes (synthétiques, incomplètes, chaussures
 *                   perdues…) → remplacées par la vérité CSV.
 */
function decideAction(existant, lignesExistantes, calcule) {
  if (!existant) return 'create';
  if (lignesIdentiques(lignesExistantes, calcule.lignes)) {
    return ticketIdentique(existant, calcule) ? 'inchange' : 'maj_ticket';
  }
  return 'replace';
}

// ── Helpers DB ──────────────────────────────────────────────────────────────

async function snapshotParVak(client, vakId) {
  const r = await client.query(`
    SELECT v.id, v.libelle,
           COALESCE(SUM(t.poids_kg), 0)::FLOAT AS poids,
           COALESCE(SUM(t.total_ttc), 0)::FLOAT AS ca,
           COUNT(t.id)::INT AS nb_tickets
    FROM vaks v
    LEFT JOIN vak_tickets t ON t.vak_id = v.id
    WHERE $1::INT IS NULL OR v.id = $1
    GROUP BY v.id, v.libelle
    ORDER BY v.id
  `, [vakId]);
  return r.rows;
}

/**
 * PAIEMENT SCINDÉ — une vente réglée en deux fois (carte + espèces) apparaît
 * dans le rapport CSV sur UNE ligne portant les DEUX références séparées par
 * une virgule (« TAAA4NHDU9G, TAAA4NHD2GE »), alors que l'API SumUp livre
 * DEUX transactions distinctes, une par moyen de paiement.
 *
 * Découpe les références d'une cellule. Une référence simple donne un tableau
 * d'un élément — l'appelant n'a pas à distinguer les deux cas. Fonction PURE.
 */
function referencesDe(ref) {
  return String(ref || '')
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

/**
 * Cherche le(s) ticket(s) correspondant à une cellule de référence.
 * @returns {Promise<Array>} les tickets trouvés, dans l'ordre des références.
 */
async function chercherTickets(client, ref) {
  const refs = referencesDe(ref);
  if (refs.length === 0) return [];
  // La référence COMPLÈTE est cherchée en plus de ses parties : une passe
  // antérieure a pu créer un ticket qui la porte telle quelle (cas d'un
  // paiement scindé absent de la base au moment de cette passe). Sans elle, la
  // relance ne retrouverait pas son propre ticket et tenterait de le recréer —
  // le script perdrait son idempotence sur une contrainte d'unicité.
  const cles = refs.length > 1 ? refs.concat([String(ref).trim()]) : refs;
  const r = await client.query(`
    SELECT t.id, t.vak_id, t.batch_id, t.source, t.ref_transaction, t.sumup_transaction_id,
           t.date_ticket, t.moyen_paiement, t.compte, t.nb_articles,
           t.poids_kg::FLOAT AS poids_kg, t.total_ttc::FLOAT AS total_ttc,
           t.total_ht::FLOAT AS total_ht, t.total_tva::FLOAT AS total_tva
    FROM vak_tickets t
    WHERE t.ref_transaction = ANY($1) OR t.sumup_transaction_id = ANY($1)
    ORDER BY t.id
  `, [cles]);
  return r.rows;
}

async function lignesDuTicket(client, ticketId) {
  const r = await client.query(`
    SELECT description, segment, unite, quantite::FLOAT AS quantite,
           total_ttc::FLOAT AS total_ttc, compte
    FROM vak_ventes WHERE ticket_id = $1 ORDER BY id
  `, [ticketId]);
  return r.rows;
}

async function vakCouvrante(client, isoDateParis) {
  const r = await client.query(
    'SELECT id FROM vaks WHERE $1::DATE BETWEEN date_debut AND date_fin ORDER BY date_debut DESC LIMIT 1',
    [isoDateParis],
  );
  return r.rows[0]?.id ?? null;
}

async function insererLignes(client, { vakId, ticketId, batchId, ref, lignes }) {
  for (const l of lignes) {
    await client.query(`
      INSERT INTO vak_ventes
        (vak_id, ticket_id, batch_id, date_vente, ref_transaction, moyen_paiement,
         description, segment, unite, quantite, prix_unitaire_ttc, remise,
         total_ht, total_ttc, total_tva, taux_tva, compte, source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'csv_manuel')
    `, [vakId, ticketId, batchId, l.date_vente.toISOString(), ref, l.moyen_paiement,
        l.description, l.segment, l.unite, l.quantite, l.prix_unitaire_ttc,
        l.remise, l.total_ht, l.total_ttc, l.total_tva, l.taux_tva, l.compte || null]);
  }
}

// Recalcule poids_total_kg des anciens batches touchés (même règle que resync).
async function recalcBatches(client, batchIds) {
  if (batchIds.length === 0) return 0;
  const r = await client.query(`
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

  console.log('');
  console.log(`RÉPARATION VAK DEPUIS RAPPORT CSV ${dryRun ? '— MODE SIMULATION (--dry-run par défaut, aucun écrit ; --apply pour écrire)' : '— APPLICATION'}`);
  console.log('─'.repeat(78));

  if (!args.file) {
    console.error('Usage : node src/scripts/repair-vak-from-report.js --file=/chemin/rapport.csv [--apply] [--vak=<id>]');
    process.exitCode = 1;
    await pool.end().catch(() => {});
    return;
  }
  let content;
  try {
    content = fs.readFileSync(args.file, 'utf-8');
  } catch (err) {
    console.error(`Fichier illisible : ${args.file} (${err.message})`);
    process.exitCode = 1;
    await pool.end().catch(() => {});
    return;
  }

  const { transactions, nb_lignes: nbLignes, erreurs } = parseReportCSV(content);
  console.log(`Fichier : ${args.file}`);
  console.log(`Lignes utiles : ${nbLignes} — transactions distinctes : ${transactions.length} — erreurs de parse : ${erreurs.length}`);
  for (const e of erreurs.slice(0, 5)) console.warn(`  ! ligne ${e.line} : ${e.error}`);
  if (erreurs.length > 5) console.warn(`  ! … ${erreurs.length - 5} autre(s) erreur(s) de parse`);
  if (args.vakId) console.log(`Filtre --vak=${args.vakId}`);
  console.log('');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const avant = await snapshotParVak(client, args.vakId);

    const stats = {
      remplaces: 0, crees: 0, maj_ticket: 0, inchanges: 0,
      hors_vak: 0, hors_filtre: 0, comptes_renseignes: 0,
      scindes_ignores: 0, refs_scindees: [],
    };
    let deltaPoids = 0;
    let deltaCA = 0;
    const vaksTouchees = new Set();
    const batchesTouches = new Set();
    const repairBatches = new Map(); // vak_id → batch id (créé paresseusement)

    async function getRepairBatch(vakId) {
      if (repairBatches.has(vakId)) return repairBatches.get(vakId);
      // Batch dédié 'repair_csv' — trace les tickets CRÉÉS par la réparation.
      // Hash salé (contenu + vak + horodatage) : la contrainte UNIQUE de
      // file_hash ne doit jamais bloquer une réparation légitime re-jouée.
      const hash = crypto.createHash('sha256')
        .update(content).update(`:repair:${vakId}:${Date.now()}`).digest('hex');
      const r = await client.query(`
        INSERT INTO vak_import_batches (vak_id, filename, file_hash, statut, source)
        VALUES ($1, $2, $3, 'termine', 'repair_csv') RETURNING id
      `, [vakId, `repair:${path.basename(args.file)}`, hash]);
      repairBatches.set(vakId, r.rows[0].id);
      return r.rows[0].id;
    }

    for (const tx of transactions) {
      const trouves = await chercherTickets(client, tx.ref);

      // GARDE — paiement scindé déjà présent en base. La ligne du rapport porte
      // le montant TOTAL de la vente et plusieurs références ; les tickets de
      // l'API, eux, portent chacun sa moitié — et leur SOMME est déjà juste,
      // tout comme le mix de paiement qu'ils permettent seuls de distinguer.
      // Créer un ticket de plus avec la référence combinée COMPTERAIT LA VENTE
      // DEUX FOIS ; réécrire l'un des deux ferait diverger son total de son
      // encaissement réel. On laisse donc ces ventes en l'état, et on le DIT :
      // un script de réparation ne doit jamais dégrader ce qu'il ne sait pas
      // réparer sans inventer une répartition.
      const refComplete = String(tx.ref).trim();
      const parMoitie = trouves.filter((t) => t.ref_transaction !== refComplete
        && t.sumup_transaction_id !== refComplete);
      if (referencesDe(tx.ref).length > 1 && parMoitie.length > 0) {
        stats.scindes_ignores++;
        stats.refs_scindees.push(tx.ref);
        continue;
      }

      // Sinon : soit une référence simple, soit un ticket combiné créé par une
      // passe antérieure de ce même script — dans les deux cas on le met à jour.
      const existant = trouves[0] || null;
      const vakId = existant
        ? existant.vak_id
        : await vakCouvrante(client, sumup.parisDateStr(tx.date_ticket));
      if (!vakId) { stats.hors_vak++; continue; }
      if (args.vakId && vakId !== args.vakId) { stats.hors_filtre++; continue; }

      if (!existant) {
        // Trou de sync : création via la logique d'import CSV (rattachement
        // par jour civil Paris, batch dédié 'repair_csv').
        const batchId = await getRepairBatch(vakId);
        const ins = await client.query(`
          INSERT INTO vak_tickets
            (vak_id, ref_transaction, date_ticket, moyen_paiement, nb_articles,
             poids_kg, total_ttc, total_ht, total_tva, compte, batch_id, source)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'csv_manuel')
          RETURNING id
        `, [vakId, tx.ref, tx.date_ticket.toISOString(), tx.moyen_paiement, tx.nb_articles,
            tx.poids_kg, tx.total_ttc, tx.total_ht, tx.total_tva, tx.compte, batchId]);
        await insererLignes(client, { vakId, ticketId: ins.rows[0].id, batchId, ref: tx.ref, lignes: tx.lignes });
        stats.crees++;
        if (tx.compte) stats.comptes_renseignes++;
        deltaPoids += tx.poids_kg;
        deltaCA += tx.total_ttc;
        vaksTouchees.add(vakId);
        console.log(`  + Ticket ${tx.ref} CRÉÉ (VAK #${vakId}) : ${tx.lignes.length} ligne(s), ${fmt(tx.poids_kg)} kg, ${fmt(tx.total_ttc, 2)} €${dryRun ? ' [simulé]' : ''}`);
        continue;
      }

      const lignesExistantes = await lignesDuTicket(client, existant.id);
      const action = decideAction(existant, lignesExistantes, tx);
      if (action === 'inchange') { stats.inchanges++; continue; }

      if (action === 'maj_ticket') {
        // Lignes déjà justes — seuls les agrégats/compte du ticket divergent.
        await client.query(`
          UPDATE vak_tickets SET
            poids_kg = $1, nb_articles = $2, total_ttc = $3, total_ht = $4,
            total_tva = $5, moyen_paiement = $6, compte = COALESCE($7, compte)
          WHERE id = $8
        `, [tx.poids_kg, tx.nb_articles, tx.total_ttc, tx.total_ht, tx.total_tva,
            tx.moyen_paiement, tx.compte, existant.id]);
        stats.maj_ticket++;
        if (tx.compte && String(existant.compte || '').trim() === '') stats.comptes_renseignes++;
        deltaPoids += tx.poids_kg - (existant.poids_kg || 0);
        deltaCA += tx.total_ttc - (existant.total_ttc || 0);
        vaksTouchees.add(vakId);
        if (existant.batch_id) batchesTouches.add(existant.batch_id);
        console.log(`  ~ Ticket #${existant.id} (${tx.ref}) : agrégats/compte mis à jour (poids ${fmt(existant.poids_kg)} → ${fmt(tx.poids_kg)} kg)${dryRun ? ' [simulé]' : ''}`);
        continue;
      }

      // action === 'replace' : lignes remplacées par la vérité CSV. La date du
      // ticket stocké est conservée (horodatage d'origine, API à la seconde) ;
      // le batch du ticket n'est pas déplacé (provenance conservée), ses
      // totaux sont recalculés ensuite.
      await client.query(`
        UPDATE vak_tickets SET
          poids_kg = $1, nb_articles = $2, total_ttc = $3, total_ht = $4,
          total_tva = $5, moyen_paiement = $6, compte = COALESCE($7, compte)
        WHERE id = $8
      `, [tx.poids_kg, tx.nb_articles, tx.total_ttc, tx.total_ht, tx.total_tva,
          tx.moyen_paiement, tx.compte, existant.id]);
      await client.query('DELETE FROM vak_ventes WHERE ticket_id = $1', [existant.id]);
      await insererLignes(client, {
        vakId, ticketId: existant.id, batchId: existant.batch_id, ref: tx.ref, lignes: tx.lignes,
      });
      stats.remplaces++;
      if (tx.compte && String(existant.compte || '').trim() === '') stats.comptes_renseignes++;
      deltaPoids += tx.poids_kg - (existant.poids_kg || 0);
      deltaCA += tx.total_ttc - (existant.total_ttc || 0);
      vaksTouchees.add(vakId);
      if (existant.batch_id) batchesTouches.add(existant.batch_id);
      console.log(`  ✓ Ticket #${existant.id} (${tx.ref}, ${existant.source}) : ${lignesExistantes.length} → ${tx.lignes.length} ligne(s), poids ${fmt(existant.poids_kg)} → ${fmt(tx.poids_kg)} kg${dryRun ? ' [simulé]' : ''}`);
    }

    // Totaux des batches : anciens batches touchés + batches 'repair_csv'.
    const batchesRecalcules = await recalcBatches(client, [...batchesTouches]);
    for (const [vakId, batchId] of repairBatches.entries()) {
      await client.query(`
        UPDATE vak_import_batches b SET
          nb_lignes_total = agg.nb_lignes, nb_lignes_importees = agg.nb_lignes,
          nb_tickets_reconstitues = agg.nb_tickets,
          ca_total_ttc = agg.ca, poids_total_kg = agg.poids,
          date_debut = agg.dmin, date_fin = agg.dmax
        FROM (
          SELECT COUNT(v.id) AS nb_lignes,
                 COUNT(DISTINCT v.ticket_id) AS nb_tickets,
                 COALESCE(SUM(v.total_ttc), 0) AS ca,
                 COALESCE(SUM(CASE WHEN v.unite ILIKE '%kg%' THEN v.quantite ELSE 0 END), 0) AS poids,
                 MIN(((v.date_vente AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date) AS dmin,
                 MAX(((v.date_vente AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date) AS dmax
          FROM vak_ventes v WHERE v.batch_id = $1
        ) agg
        WHERE b.id = $1
      `, [batchId]);
      void vakId;
    }

    // Journal du run (uniquement en --apply : un dry-run ne laisse AUCUNE trace).
    if (!dryRun) {
      await client.query(`
        INSERT INTO vak_sumup_sync_log
          (sync_type, status, ended_at, nb_transactions_received,
           nb_transactions_inserted, nb_transactions_skipped, details)
        VALUES ('repair_csv', 'success', NOW(), $1, $2, $3, $4)
      `, [transactions.length,
          stats.remplaces + stats.crees + stats.maj_ticket,
          stats.inchanges + stats.hors_vak + stats.hors_filtre,
          JSON.stringify({
            script: 'repair-vak-from-report.js',
            file: path.basename(args.file),
            vak_filter: args.vakId,
            ...stats,
            erreurs_parse: erreurs.length,
            delta_poids_kg: Number(deltaPoids.toFixed(3)),
            delta_ca_ttc: Number(deltaCA.toFixed(2)),
          })]);
    }

    const apres = await snapshotParVak(client, args.vakId);

    // ── Récapitulatif avant/après par VAK ──
    console.log('');
    console.log('RÉCAPITULATIF');
    console.log('─'.repeat(78));
    console.log(`Transactions du fichier   : ${transactions.length}`);
    console.log(`Tickets remplacés         : ${stats.remplaces}`);
    console.log(`Tickets créés (trous)     : ${stats.crees}`);
    console.log(`Tickets màj (agrégats)    : ${stats.maj_ticket}`);
    console.log(`Inchangés (déjà justes)   : ${stats.inchanges}`);
    if (stats.scindes_ignores > 0) {
      console.log(`Paiements scindés IGNORÉS : ${stats.scindes_ignores}  (déjà en base sous leurs`);
      console.log(`                            références individuelles — les réécrire compterait`);
      console.log(`                            la vente deux fois ; leurs lignes restent celles de l'API)`);
      stats.refs_scindees.slice(0, 10).forEach((r) => console.log(`    · ${r}`));
      if (stats.refs_scindees.length > 10) {
        console.log(`    · … ${stats.refs_scindees.length - 10} autre(s)`);
      }
    }
    console.log(`Hors période VAK          : ${stats.hors_vak}`);
    if (args.vakId) console.log(`Hors filtre --vak         : ${stats.hors_filtre}`);
    console.log(`Comptes de caisse posés   : ${stats.comptes_renseignes}`);
    console.log(`Batches recalculés        : ${batchesRecalcules} (+ ${repairBatches.size} batch(es) 'repair_csv')`);
    console.log('');
    console.log('Par VAK (somme vak_tickets, AVANT → APRÈS) :');
    console.log('  VAK'.padEnd(36) + 'Poids (kg)'.padStart(24) + 'CA TTC (€)'.padStart(26) + 'Tickets'.padStart(14));
    const avantById = new Map(avant.map((v) => [v.id, v]));
    for (const v of apres) {
      const a = avantById.get(v.id) || { poids: 0, ca: 0, nb_tickets: 0 };
      if (!vaksTouchees.has(v.id) && v.poids === a.poids && v.ca === a.ca && v.nb_tickets === a.nb_tickets) continue;
      console.log(
        `  #${v.id} ${String(v.libelle || '').slice(0, 28)}`.padEnd(36)
        + `${fmt(a.poids)} → ${fmt(v.poids)}`.padStart(24)
        + `${fmt(a.ca, 2)} → ${fmt(v.ca, 2)}`.padStart(26)
        + `${a.nb_tickets} → ${v.nb_tickets}`.padStart(14),
      );
    }
    console.log('');

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('Simulation terminée — ROLLBACK effectué, base inchangée. Relancer avec --apply pour écrire.');
    } else {
      await client.query('COMMIT');
      console.log('Réparation appliquée (COMMIT). Ré-exécutable sans effet (idempotent : re-run = 0 changement).');
      console.log('Penser à renseigner la caisse de l\'événement (« Caisse SumUp » sur la session, ex. « Caissier Frip & Co »)');
      console.log('pour exclure les tickets des autres caisses (Vintiz…) des KPI.');
    }
    process.exitCode = 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERREUR réparation VAK :', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

// Exporte les fonctions PURES pour les tests (aucune DB dedans).
module.exports = {
  parseArgs,
  parseReportCSV,
  referencesDe,
  construireTicket,
  lignesIdentiques,
  ticketIdentique,
  decideAction,
};

if (require.main === module) {
  main();
}

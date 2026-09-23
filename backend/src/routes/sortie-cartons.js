/**
 * Sortie de cartons par scan — `/api/sortie-cartons` (2.57.0).
 *
 * Déménagé de `routes/etiquettes.js` : scanner un carton pour le sortir du stock
 * n'est pas fabriquer une étiquette, et les deux gestes ont désormais chacun leur
 * habilitation (`etiquettes` / `sortie_cartons`).
 *
 * TROIS RÈGLES, ET LEURS RAISONS
 *
 * 1. CHAQUE SCAN EST JOURNALISÉ, RÉUSSI OU REFUSÉ (arbitrage D1). Un refus est
 *    précisément ce qu'on cherche quand un carton « a disparu » : un code
 *    inconnu, un carton déjà sorti, une commande fermée. Le journal est donc
 *    écrit HORS de la transaction de sortie — après COMMIT ou après ROLLBACK —
 *    sinon un refus annulerait sa propre trace.
 *
 * 2. LE JOURNAL NE PORTE JAMAIS L'IDENTITÉ DE LA PERSONNE. Les scans se font
 *    sous un profil unique et partagé (OPERATEUR_STOCK) : un nom n'y dirait
 *    rien, et un journal nominatif du rythme de travail serait un traitement
 *    de données personnelles sans finalité. La sortie elle-même garde son
 *    `scanned_by` historique (effet inchangé).
 *
 * 3. ANNULER UNE SORTIE NE SUPPRIME RIEN (D3). En sortie libre, le mouvement de
 *    stock est CONTRE-PASSÉ — même mécanique que `POST /stock/movements/:id/cancel` :
 *    une écriture opposée liée à l'originale, l'historique reste intact. Les
 *    sorties btq/vak n'écrivent pas de mouvement (décrément en aval, règle
 *    anti-double-compte inchangée) : il n'y a rien à contre-passer.
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { requireModule } = require('../middleware/module-access');
const { analyserCode, formeLisible, LIBELLES_FORMAT } = require('../utils/codification-etiquettes');

const ROLES_OPERATEUR = ['ADMIN', 'COLLABORATEUR', 'OPERATEUR_STOCK'];

router.use(authenticate, authorize(...ROLES_OPERATEUR), requireModule('sortie_cartons'));

const BTQ_ACTIVE_STATUTS = ['envoyee', 'ajustee', 'en_preparation'];
const VAK_ACTIVE_STATUTS = ['confirmee', 'en_preparation', 'chargee'];
const TYPES_COMMANDE = ['btq', 'vak', 'libre'];
const RESULTATS = ['ok', 'inconnu', 'deja_sorti', 'commande_fermee', 'invalide', 'annulation'];

/** Entier strictement positif, sinon null. */
function entierPositif(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function tronquer(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s === '' ? null : s.slice(0, max);
}

/** Candidats de recherche d'un code lu : forme normalisée, puis forme brute (filet). */
function candidatsCode(brut, normalise) {
  const brutPropre = String(brut ?? '').trim();
  return [...new Set([normalise, brutPropre].filter(Boolean))];
}

/**
 * Inscrit un scan au journal. Toujours via le POOL (jamais le client de la
 * transaction de sortie) : la trace survit au ROLLBACK d'un refus. Aucune
 * colonne ne porte l'identité de la personne. Un échec d'écriture est signalé
 * au journal serveur mais ne change pas la réponse au scan : le carton, lui, est
 * déjà sorti (ou refusé) pour de bon.
 */
async function journaliser(e) {
  try {
    await pool.query(
      `INSERT INTO sortie_cartons_journal
         (scanned_at, session_id, code_lu, code_normalise, format, resultat,
          produit_fini_id, commande_type, commande_id, message)
       VALUES ((NOW() AT TIME ZONE 'UTC'), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tronquer(e.session_id, 40),
        String(e.code_lu ?? '').slice(0, 64),
        tronquer(e.code_normalise, 64),
        tronquer(e.format, 20),
        e.resultat,
        e.produit_fini_id ?? null,
        TYPES_COMMANDE.includes(e.commande_type) ? e.commande_type : null,
        entierPositif(e.commande_id),
        tronquer(e.message, 200),
      ]
    );
  } catch (err) {
    console.error('[SORTIE-CARTONS] Journal non écrit :', err.message);
  }
}

/** Carton tel que renvoyé à l'écran de sortie. */
function formaterCarton(c, extra = {}) {
  return {
    id: c.id,
    code_barre: c.code_barre,
    code_lisible: c.code_barre ? formeLisible(c.code_barre) : c.code_barre,
    codification: c.codification ?? null,
    produit: c.produit ?? null,
    categorie_eco_org: c.categorie_eco_org ?? null,
    genre: c.genre ?? null,
    saison: c.saison ?? null,
    gamme: c.gamme ?? null,
    poids_kg: c.poids_kg !== null && c.poids_kg !== undefined ? Number(c.poids_kg) : null,
    date_fabrication: c.date_fabrication ?? null,
    date_sortie: c.date_sortie ?? null,
    ...extra,
  };
}

/** Message d'un code introuvable : il dit CE QUI a été reconnu. */
function messageInconnu(analyse) {
  const code = analyse.normalise;
  switch (analyse.format) {
    case 'ancien_base24':
    case 'ancien_horodate':
      return `${LIBELLES_FORMAT[analyse.format]} « ${code} » : absent du stock importé`;
    case 'v2':
      return `Nouvelle codification « ${code} » : aucun carton ne porte ce code`;
    case 'balance':
      return `Code du kiosque balance « ${code} » : introuvable en stock`;
    default:
      return `Format non reconnu : « ${code} » n'est pas un code d'étiquette`;
  }
}

const COLONNES = `id, code_barre, codification, status, date_sortie, sortie_commande_type,
  poids_kg, produit, categorie_eco_org, genre, saison, gamme, date_fabrication`;

// ══════════════════════════════════════════
router.get('/commandes-actives/:type', async (req, res) => {
  const { type } = req.params;
  try {
    if (type === 'btq') {
      const { rows } = await pool.query(
        `SELECT bc.id, bc.reference, bc.statut, bc.date_commande, b.nom AS label
         FROM boutique_commandes bc LEFT JOIN boutiques b ON b.id = bc.boutique_id
         WHERE bc.statut = ANY($1::varchar[])
         ORDER BY bc.date_commande DESC LIMIT 50`,
        [BTQ_ACTIVE_STATUTS]
      );
      return res.json(rows);
    }
    if (type === 'vak') {
      const { rows } = await pool.query(
        `SELECT ce.id, ce.reference, ce.statut, ce.date_commande,
                COALESCE(cl.raison_sociale, ce.reference) AS label
         FROM commandes_exutoires ce LEFT JOIN clients_exutoires cl ON cl.id = ce.client_id
         WHERE ce.statut = ANY($1::varchar[])
         ORDER BY ce.date_commande DESC LIMIT 50`,
        [VAK_ACTIVE_STATUTS]
      );
      return res.json(rows);
    }
    res.status(400).json({ error: 'type doit être btq ou vak', code: 'PARAMETRES' });
  } catch (err) {
    console.error('[SORTIE-CARTONS] Erreur commandes actives :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// POST /scan
// ══════════════════════════════════════════
router.post('/scan', async (req, res) => {
  const { code_barre, commande_type, commande_id, session_id } = req.body || {};
  const analyse = analyserCode(code_barre);
  const base = {
    code_lu: code_barre ?? '',
    code_normalise: analyse.normalise || null,
    format: analyse.format,
    commande_type,
    commande_id,
    session_id,
  };

  // ── Paramètres ──
  if (!analyse.normalise) {
    const error = 'Code vide : aucun caractère lisible';
    await journaliser({ ...base, resultat: 'invalide', message: error });
    return res.status(400).json({ resultat: 'invalide', code: 'CODE_VIDE', error });
  }
  const cmdId = entierPositif(commande_id);
  let erreurParam = null;
  if (!TYPES_COMMANDE.includes(commande_type)) erreurParam = 'commande_type doit être btq, vak ou libre';
  else if (commande_type !== 'libre' && !cmdId) erreurParam = 'commande_id requis pour ce type de sortie';
  if (erreurParam) {
    await journaliser({ ...base, resultat: 'invalide', message: erreurParam });
    return res.status(400).json({ resultat: 'invalide', code: 'PARAMETRES', error: erreurParam });
  }

  const client = await pool.connect();
  let issue = null; // { status, body, journal } — journalisé APRÈS la transaction
  try {
    await client.query('BEGIN');

    const carton = await client.query(
      `SELECT ${COLONNES} FROM produits_finis
       WHERE code_barre = ANY($1::varchar[])
       ORDER BY (code_barre = $2) DESC LIMIT 1 FOR UPDATE`,
      [candidatsCode(code_barre, analyse.normalise), analyse.normalise]
    );
    if (carton.rowCount === 0) {
      await client.query('ROLLBACK');
      const error = messageInconnu(analyse);
      issue = {
        status: 404,
        body: {
          resultat: 'inconnu', code: 'NOT_FOUND', error,
          format: analyse.format, format_libelle: LIBELLES_FORMAT[analyse.format],
          code_normalise: analyse.normalise,
        },
        journal: { resultat: 'inconnu', message: error },
      };
    } else {
      const c = carton.rows[0];
      if (c.status !== 'en_stock' || c.date_sortie) {
        await client.query('ROLLBACK');
        const error = 'Carton déjà sorti du stock';
        issue = {
          status: 409,
          body: {
            resultat: 'deja_sorti', code: 'ALREADY_OUT', error,
            carton: formaterCarton(c, { sortie_commande_type: c.sortie_commande_type ?? null }),
          },
          journal: { resultat: 'deja_sorti', message: error, produit_fini_id: c.id },
        };
      } else {
        let cmd = null;
        if (commande_type === 'btq' || commande_type === 'vak') {
          const table = commande_type === 'btq' ? 'boutique_commandes' : 'commandes_exutoires';
          const statuts = commande_type === 'btq' ? BTQ_ACTIVE_STATUTS : VAK_ACTIVE_STATUTS;
          const r = await client.query(`SELECT id, reference, statut FROM ${table} WHERE id = $1`, [cmdId]);
          if (r.rowCount === 0 || !statuts.includes(r.rows[0].statut)) {
            await client.query('ROLLBACK');
            const error = `Commande ${commande_type.toUpperCase()} inactive ou introuvable`;
            issue = {
              status: 409,
              body: { resultat: 'commande_fermee', code: 'COMMANDE_FERMEE', error },
              journal: { resultat: 'commande_fermee', message: error, produit_fini_id: c.id },
            };
          } else {
            cmd = r.rows[0];
          }
        }

        if (!issue) {
          const upd = await client.query(
            `UPDATE produits_finis SET
               date_sortie = NOW(), status = 'expedie',
               sortie_commande_type = $1, sortie_commande_id = $2, scanned_by = $3
             WHERE id = $4
             RETURNING ${COLONNES}`,
            [commande_type, commande_type === 'libre' ? null : cmdId, req.user.id ?? null, c.id]
          );

          // La sortie carton DÉCRÉMENTE le stock moderne UNIQUEMENT pour les
          // sorties LIBRES : les flux btq/vak ont leur décrément canonique en aval
          // (boutique-commandes.js, preparations.js). Écrire aussi une sortie par
          // carton ferait sortir la même marchandise DEUX FOIS du grand livre.
          if (commande_type === 'libre') {
            const catMatch = await client.query(
              `SELECT id FROM categories_sortantes WHERE lower(nom) = lower($1) AND is_active = true LIMIT 1`,
              [c.categorie_eco_org]
            );
            await client.query(
              `INSERT INTO stock_movements
                 (type, date, poids_kg, matiere_id, code_barre, origine, notes, produit_fini_id, created_by)
               VALUES ('sortie', CURRENT_DATE, $1, $2, $3, 'sortie_carton', $4, $5, $6)`,
              [c.poids_kg, catMatch.rows[0]?.id || null, c.code_barre,
                `Sortie carton ${c.code_barre} (libre)`, c.id, req.user.id ?? null]
            );
          }
          await client.query('COMMIT');
          issue = {
            status: 200,
            body: { resultat: 'ok', carton: formaterCarton(upd.rows[0]), commande: cmd },
            journal: { resultat: 'ok', message: null, produit_fini_id: c.id },
          };
        }
      }
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[SORTIE-CARTONS] Erreur scan :', err);
    client.release();
    return res.status(500).json({ error: 'Erreur serveur' });
  }
  client.release();

  await journaliser({ ...base, commande_id: cmdId, ...issue.journal });
  return res.status(issue.status).json(issue.body);
});

// ══════════════════════════════════════════
router.get('/session/:type/:commande_id', async (req, res) => {
  const { type } = req.params;
  const cmdId = entierPositif(req.params.commande_id);
  if (!['btq', 'vak'].includes(type) || !cmdId) {
    return res.status(400).json({ error: 'type (btq ou vak) et commande_id requis', code: 'PARAMETRES' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT ${COLONNES} FROM produits_finis
       WHERE sortie_commande_type = $1 AND sortie_commande_id = $2
       ORDER BY date_sortie DESC`,
      [type, cmdId]
    );
    const items = rows.map((r) => formaterCarton(r));
    const total_kg = items.reduce((s, r) => s + Number(r.poids_kg || 0), 0);
    res.json({ items, count: items.length, total_kg });
  } catch (err) {
    console.error('[SORTIE-CARTONS] Erreur session :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// POST /annuler — tous types (D3), jamais de suppression
// ══════════════════════════════════════════
router.post('/annuler', async (req, res) => {
  const { code_barre, commande_type, commande_id, motif, session_id } = req.body || {};
  const analyse = analyserCode(code_barre);
  const cmdId = entierPositif(commande_id);
  if (!analyse.normalise || !TYPES_COMMANDE.includes(commande_type) || (commande_type !== 'libre' && !cmdId)) {
    return res.status(400).json({ error: 'code_barre, commande_type (btq, vak ou libre) et commande_id (btq/vak) requis', code: 'PARAMETRES' });
  }
  const motifTexte = motif === null || motif === undefined ? '' : String(motif).trim();
  if (motifTexte.length > 200) {
    return res.status(400).json({ error: 'Le motif ne peut dépasser 200 caractères', code: 'PARAMETRES' });
  }

  const client = await pool.connect();
  let carton;
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT id FROM produits_finis
       WHERE code_barre = ANY($1::varchar[]) AND date_sortie IS NOT NULL
         AND sortie_commande_type = $2
         AND ${commande_type === 'libre' ? 'sortie_commande_id IS NULL' : 'sortie_commande_id = $3'}
       ORDER BY (code_barre = $${commande_type === 'libre' ? 3 : 4}) DESC LIMIT 1 FOR UPDATE`,
      commande_type === 'libre'
        ? [candidatsCode(code_barre, analyse.normalise), commande_type, analyse.normalise]
        : [candidatsCode(code_barre, analyse.normalise), commande_type, cmdId, analyse.normalise]
    );
    if (found.rowCount === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'Aucune sortie de ce carton pour cette commande', code: 'NOT_FOUND' });
    }
    const id = found.rows[0].id;
    const upd = await client.query(
      `UPDATE produits_finis SET
         date_sortie = NULL, status = 'en_stock',
         sortie_commande_type = NULL, sortie_commande_id = NULL, scanned_by = NULL
       WHERE id = $1 RETURNING ${COLONNES}`,
      [id]
    );
    carton = upd.rows[0];

    if (commande_type === 'libre') {
      // Contre-écriture de CHAQUE sortie non encore contre-passée de ce carton
      // (en pratique une seule) — même mécanique que /stock/movements/:id/cancel.
      const mvts = await client.query(
        `SELECT * FROM stock_movements
         WHERE produit_fini_id = $1 AND origine = 'sortie_carton' AND type = 'sortie'
           AND reversal_movement_id IS NULL AND reversed_of_id IS NULL
         FOR UPDATE`,
        [id]
      );
      const raison = motifTexte || 'Annulation de la sortie carton';
      for (const orig of mvts.rows) {
        const rev = await client.query(
          `INSERT INTO stock_movements
             (type, date, poids_kg, matiere_id, destination, code_barre, origine, notes,
              produit_fini_id, reversed_of_id, reversal_reason, created_by)
           VALUES ('entree', $1, $2, $3, $4, $5, 'annulation', $6, $7, $8, $9, $10)
           RETURNING id`,
          [orig.date, orig.poids_kg, orig.matiere_id, orig.destination, orig.code_barre,
            `Annulation du mouvement #${orig.id} — ${raison}`, id, orig.id, raison, req.user.id ?? null]
        );
        await client.query(
          `UPDATE stock_movements SET reversal_movement_id = $1, reversed_at = NOW(), updated_at = NOW() WHERE id = $2`,
          [rev.rows[0].id, orig.id]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error('[SORTIE-CARTONS] Erreur annulation :', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
  client.release();

  await journaliser({
    code_lu: code_barre ?? '', code_normalise: analyse.normalise, format: analyse.format,
    resultat: 'annulation', produit_fini_id: carton.id, commande_type,
    commande_id: commande_type === 'libre' ? null : cmdId, session_id,
    message: motifTexte ? `Sortie annulée — ${motifTexte}` : 'Sortie annulée',
  });
  res.json({ ok: true, carton: formaterCarton(carton) });
});

// ══════════════════════════════════════════
// GET /journal — jour courant (heure de Paris) par défaut
// ══════════════════════════════════════════
router.get('/journal', async (req, res) => {
  const { date, session_id, resultat } = req.query;
  if (date !== undefined && date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return res.status(400).json({ error: 'date au format AAAA-MM-JJ', code: 'PARAMETRES' });
  }
  if (resultat && !RESULTATS.includes(resultat)) {
    return res.status(400).json({ error: `resultat parmi : ${RESULTATS.join(', ')}`, code: 'PARAMETRES' });
  }
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 200;
  limit = Math.min(limit, 1000);

  // scanned_at est écrit en heure UTC (cf. journaliser) : le jour civil se lit à Paris.
  const params = [date || null];
  let filtre = `((j.scanned_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date
                = COALESCE($1::date, (NOW() AT TIME ZONE 'Europe/Paris')::date)`;
  if (session_id) { params.push(String(session_id).slice(0, 40)); filtre += ` AND j.session_id = $${params.length}`; }

  try {
    const cpt = await pool.query(
      `SELECT j.resultat, COUNT(*)::int AS n FROM sortie_cartons_journal j WHERE ${filtre} GROUP BY j.resultat`,
      params
    );
    const itemsParams = [...params];
    let filtreItems = filtre;
    if (resultat) { itemsParams.push(resultat); filtreItems += ` AND j.resultat = $${itemsParams.length}`; }
    itemsParams.push(limit);
    const items = await pool.query(
      `SELECT j.id, (j.scanned_at AT TIME ZONE 'UTC') AS scanned_at, j.code_lu, j.code_normalise, j.format,
              j.resultat, j.message, j.commande_type, j.commande_id,
              pf.code_barre AS pf_code_barre, pf.produit AS pf_produit, pf.gamme AS pf_gamme, pf.poids_kg AS pf_poids_kg
       FROM sortie_cartons_journal j
       LEFT JOIN produits_finis pf ON pf.id = j.produit_fini_id
       WHERE ${filtreItems}
       ORDER BY j.scanned_at DESC, j.id DESC
       LIMIT $${itemsParams.length}`,
      itemsParams
    );
    const compteurs = Object.fromEntries(RESULTATS.map((r) => [r, 0]));
    for (const r of cpt.rows) if (r.resultat in compteurs) compteurs[r.resultat] = Number(r.n);
    res.json({
      items: items.rows.map((r) => ({
        id: Number(r.id),
        scanned_at: r.scanned_at,
        code_lu: r.code_lu,
        code_normalise: r.code_normalise,
        format: r.format,
        resultat: r.resultat,
        message: r.message,
        commande_type: r.commande_type,
        commande_id: r.commande_id,
        carton: r.pf_code_barre ? {
          code_barre: r.pf_code_barre, produit: r.pf_produit, gamme: r.pf_gamme,
          poids_kg: r.pf_poids_kg !== null ? Number(r.pf_poids_kg) : null,
        } : null,
      })),
      compteurs,
    });
  } catch (err) {
    console.error('[SORTIE-CARTONS] Erreur journal :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
module.exports.journaliser = journaliser;

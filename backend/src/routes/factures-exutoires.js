const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// ══════════════════════════════════════════
// CONTRÔLE FACTURATION (V1.8+)
// Outil de rapprochement entre factures clients émises sur Pennylane
// (importées via /api/pennylane/sync/customer-invoices) et les
// commandes_exutoires. NE GÉNÈRE PAS de factures.
// ══════════════════════════════════════════

// Recalcule + persiste les écarts pour une facture liée
async function recomputeFactureEcart(client, factureId) {
  const r = await client.query(
    `SELECT f.id, f.commande_id, f.quantite_facturee, f.montant_ht,
            cp.pesee_client AS pesee_client_t,
            c.prix_tonne
     FROM factures_exutoires f
     LEFT JOIN commandes_exutoires c ON c.id = f.commande_id
     LEFT JOIN LATERAL (
       SELECT pesee_client FROM controles_pesee WHERE commande_id = f.commande_id
       ORDER BY id DESC LIMIT 1
     ) cp ON true
     WHERE f.id = $1`,
    [factureId]
  );
  if (r.rows.length === 0) return null;
  const f = r.rows[0];
  const peseeClientT = parseFloat(f.pesee_client_t) || null;
  const qtyFacturee = parseFloat(f.quantite_facturee) || null;
  let ecart = null;
  let ecartPct = null;
  if (peseeClientT != null && qtyFacturee != null) {
    ecart = Math.round((qtyFacturee - peseeClientT) * 1000) / 1000;
    ecartPct = peseeClientT > 0 ? Math.round((ecart / peseeClientT) * 10000) / 100 : null;
  }
  const prix = parseFloat(f.prix_tonne) || 0;
  const montantAttendu = peseeClientT != null ? Math.round(peseeClientT * prix * 100) / 100 : null;
  const ecartMontant = (montantAttendu != null && f.montant_ht != null)
    ? Math.round((parseFloat(f.montant_ht) - montantAttendu) * 100) / 100
    : null;

  await client.query(
    `UPDATE factures_exutoires
     SET pesee_client_kg = $1,
         ecart_quantite = $2,
         ecart_quantite_pct = $3,
         montant_attendu = $4,
         ecart_montant = $5
     WHERE id = $6`,
    [peseeClientT, ecart, ecartPct, montantAttendu, ecartMontant, factureId]
  );
  return { peseeClientT, ecart, ecartPct, montantAttendu, ecartMontant };
}

async function getTolerance() {
  try {
    const r = await pool.query("SELECT value FROM settings WHERE key = 'facturation_tolerance_pct' LIMIT 1");
    const v = parseFloat(r.rows[0]?.value);
    return Number.isFinite(v) ? v : 5;
  } catch { return 5; }
}

// GET /api/factures-exutoires — Liste enrichie (avec commande + client + écarts)
router.get('/', async (req, res) => {
  try {
    const { statut, matched, search } = req.query;
    const conditions = ["f.source = 'pennylane'"];
    const params = [];
    if (statut) {
      params.push(statut);
      conditions.push(`f.statut_facture = $${params.length}`);
    }
    if (matched === 'true') conditions.push('f.commande_id IS NOT NULL');
    if (matched === 'false') conditions.push('f.commande_id IS NULL');
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(
        f.pennylane_invoice_number ILIKE $${params.length}
        OR f.pennylane_customer_name ILIKE $${params.length}
        OR c.reference ILIKE $${params.length}
      )`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(`
      SELECT f.id, f.statut_facture, f.commande_id, f.imported_at,
             f.pennylane_invoice_id, f.pennylane_invoice_number, f.pennylane_customer_name,
             f.pennylane_external_reference, f.pennylane_data,
             f.date_facture, f.montant_ht, f.montant_ttc,
             f.quantite_facturee, f.unite_quantite,
             f.pesee_client_kg, f.ecart_quantite, f.ecart_quantite_pct,
             f.montant_attendu, f.ecart_montant,
             f.rapprochement_mode, f.validee_par, f.date_validation,
             c.reference AS commande_reference, c.type_produit, c.prix_tonne, c.statut AS commande_statut,
             cl.raison_sociale AS client_nom
      FROM factures_exutoires f
      LEFT JOIN commandes_exutoires c ON f.commande_id = c.id
      LEFT JOIN clients_exutoires cl ON c.client_id = cl.id
      ${where}
      ORDER BY f.date_facture DESC NULLS LAST, f.imported_at DESC
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[FACTURES-EXUTOIRES] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/factures-exutoires/stats — KPIs pour le dashboard
router.get('/stats', async (req, res) => {
  try {
    const tolerance = await getTolerance();
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE source = 'pennylane') AS total,
        COUNT(*) FILTER (WHERE source = 'pennylane' AND commande_id IS NULL) AS unmatched,
        COUNT(*) FILTER (WHERE source = 'pennylane' AND commande_id IS NOT NULL AND ABS(COALESCE(ecart_quantite_pct, 0)) > $1) AS with_ecart,
        COUNT(*) FILTER (WHERE source = 'pennylane' AND statut_facture = 'validee') AS validated
      FROM factures_exutoires
    `, [tolerance]);
    const orphans = await pool.query(`
      SELECT COUNT(*) AS count FROM commandes_exutoires c
      WHERE c.statut IN ('expediee', 'pesee_recue', 'facturee')
        AND NOT EXISTS (SELECT 1 FROM factures_exutoires f WHERE f.commande_id = c.id AND f.source = 'pennylane')
    `);
    res.json({
      tolerance_pct: tolerance,
      total: parseInt(stats.rows[0].total) || 0,
      unmatched: parseInt(stats.rows[0].unmatched) || 0,
      with_ecart: parseInt(stats.rows[0].with_ecart) || 0,
      validated: parseInt(stats.rows[0].validated) || 0,
      orphan_commandes: parseInt(orphans.rows[0].count) || 0,
    });
  } catch (err) {
    console.error('[FACTURES-EXUTOIRES] Erreur stats :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/factures-exutoires/orphan-commandes — Commandes sans facture rapprochée
router.get('/orphan-commandes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.reference, c.statut, c.type_produit, c.tonnage_prevu, c.prix_tonne, c.date_commande,
             cl.raison_sociale AS client_nom,
             cp.pesee_client AS pesee_client_t
      FROM commandes_exutoires c
      JOIN clients_exutoires cl ON c.client_id = cl.id
      LEFT JOIN LATERAL (
        SELECT pesee_client FROM controles_pesee WHERE commande_id = c.id ORDER BY id DESC LIMIT 1
      ) cp ON true
      WHERE c.statut IN ('expediee', 'pesee_recue', 'facturee')
        AND NOT EXISTS (SELECT 1 FROM factures_exutoires f WHERE f.commande_id = c.id AND f.source = 'pennylane')
      ORDER BY c.date_commande DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[FACTURES-EXUTOIRES] Erreur orphan-commandes :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/factures-exutoires/candidates-for/:factureId
// Liste des commandes potentiellement rapprochables pour une facture donnée
router.get('/candidates-for/:factureId', async (req, res) => {
  try {
    const factureId = parseInt(req.params.factureId, 10);
    if (!Number.isInteger(factureId)) return res.status(400).json({ error: 'ID invalide' });
    const factureRes = await pool.query(
      `SELECT pennylane_customer_name, date_facture, montant_ht, quantite_facturee
       FROM factures_exutoires WHERE id = $1`, [factureId]);
    if (factureRes.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable' });
    const f = factureRes.rows[0];
    const result = await pool.query(`
      SELECT c.id, c.reference, c.statut, c.type_produit, c.tonnage_prevu, c.prix_tonne,
             c.date_commande, cl.raison_sociale AS client_nom,
             cp.pesee_client AS pesee_client_t,
             CASE WHEN LOWER(cl.raison_sociale) LIKE LOWER($1) THEN 10 ELSE 0 END
             + CASE WHEN c.date_commande BETWEEN ($2::date - INTERVAL '30 days') AND ($2::date + INTERVAL '30 days') THEN 5 ELSE 0 END
             AS match_score
      FROM commandes_exutoires c
      JOIN clients_exutoires cl ON c.client_id = cl.id
      LEFT JOIN LATERAL (
        SELECT pesee_client FROM controles_pesee WHERE commande_id = c.id ORDER BY id DESC LIMIT 1
      ) cp ON true
      WHERE c.statut NOT IN ('annulee')
        AND NOT EXISTS (SELECT 1 FROM factures_exutoires fx WHERE fx.commande_id = c.id AND fx.source = 'pennylane')
      ORDER BY match_score DESC, c.date_commande DESC
      LIMIT 50
    `, [`%${f.pennylane_customer_name || ''}%`, f.date_facture]);
    res.json(result.rows);
  } catch (err) {
    console.error('[FACTURES-EXUTOIRES] Erreur candidates :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/factures-exutoires/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.*, f.statut_facture as statut,
             c.reference, c.type_produit, c.prix_tonne, c.tonnage_prevu, c.statut as commande_statut,
             cl.raison_sociale, cl.contact_nom, cl.contact_email,
             cp.pesee_client AS pesee_client_t, cp.pesee_interne, cp.ecart_pesee, cp.ecart_pourcentage
      FROM factures_exutoires f
      LEFT JOIN commandes_exutoires c ON f.commande_id = c.id
      LEFT JOIN clients_exutoires cl ON c.client_id = cl.id
      LEFT JOIN LATERAL (
        SELECT pesee_client, pesee_interne, ecart_pesee, ecart_pourcentage
        FROM controles_pesee WHERE commande_id = f.commande_id ORDER BY id DESC LIMIT 1
      ) cp ON true
      WHERE f.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[FACTURES-EXUTOIRES] Erreur detail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/factures-exutoires/:id/link-commande
// Rapproche manuellement une facture à une commande, recalcule les écarts,
// bascule la commande en statut 'cloturee' (Q5 : peu importe l'écart).
router.post('/:id/link-commande', async (req, res) => {
  const client = await pool.connect();
  try {
    const factureId = parseInt(req.params.id, 10);
    const commandeId = parseInt(req.body.commande_id, 10);
    if (!Number.isInteger(factureId) || !Number.isInteger(commandeId)) {
      return res.status(400).json({ error: 'IDs invalides' });
    }
    await client.query('BEGIN');
    // Vérifie que la commande n'est pas déjà liée à une autre facture
    const existing = await client.query(
      `SELECT id FROM factures_exutoires WHERE commande_id = $1 AND id != $2 AND source = 'pennylane'`,
      [commandeId, factureId]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Cette commande est déjà rapprochée d\'une autre facture' });
    }
    const upd = await client.query(
      `UPDATE factures_exutoires
       SET commande_id = $1, rapprochement_mode = 'manuel', statut_facture = 'rapprochement_manuel'
       WHERE id = $2 AND source = 'pennylane'
       RETURNING id`,
      [commandeId, factureId]
    );
    if (upd.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture introuvable' });
    }
    const ecart = await recomputeFactureEcart(client, factureId);
    // Bascule statut commande → cloturee
    await client.query(
      `UPDATE commandes_exutoires SET statut = 'cloturee', updated_at = NOW() WHERE id = $1`,
      [commandeId]
    );
    await client.query(
      `INSERT INTO historique_commandes_exutoires (commande_id, ancien_statut, nouveau_statut, commentaire, utilisateur_id)
       VALUES ($1, NULL, 'cloturee', $2, $3)`,
      [commandeId, `Rapprochement manuel facture #${factureId}`, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ success: true, facture_id: factureId, commande_id: commandeId, ...ecart });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[FACTURES-EXUTOIRES] Erreur link-commande :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// POST /api/factures-exutoires/:id/unlink — Délier (ADMIN seulement)
router.post('/:id/unlink', authorize('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const factureRes = await client.query(
      `SELECT id, commande_id FROM factures_exutoires WHERE id = $1`,
      [req.params.id]
    );
    if (factureRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Facture introuvable' });
    }
    const oldCommandeId = factureRes.rows[0].commande_id;
    await client.query(
      `UPDATE factures_exutoires
       SET commande_id = NULL, rapprochement_mode = NULL, statut_facture = 'recue',
           pesee_client_kg = NULL, ecart_quantite = NULL, ecart_quantite_pct = NULL,
           montant_attendu = NULL, ecart_montant = NULL
       WHERE id = $1`,
      [req.params.id]
    );
    if (oldCommandeId) {
      // Restaurer la commande au statut 'expediee' (la plus probable)
      await client.query(
        `UPDATE commandes_exutoires SET statut = 'expediee', updated_at = NOW() WHERE id = $1 AND statut = 'cloturee'`,
        [oldCommandeId]
      );
      await client.query(
        `INSERT INTO historique_commandes_exutoires (commande_id, ancien_statut, nouveau_statut, commentaire, utilisateur_id)
         VALUES ($1, 'cloturee', 'expediee', 'Désouplage manuel facture', $2)`,
        [oldCommandeId, req.user.id]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[FACTURES-EXUTOIRES] Erreur unlink :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// POST /api/factures-exutoires/:id/validate-ecart — Valider une facture malgré l'écart
router.post('/:id/validate-ecart', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE factures_exutoires
       SET statut_facture = 'ecart_valide', validee_par = $1, date_validation = NOW()
       WHERE id = $2 AND commande_id IS NOT NULL
       RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable ou non rapprochée' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[FACTURES-EXUTOIRES] Erreur validate-ecart :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/factures-exutoires/:id/valider — alias de validate-ecart (rétrocompat)
router.patch('/:id/valider', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE factures_exutoires
       SET statut_facture = 'validee', validee_par = $1, date_validation = NOW()
       WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable' });
    if (result.rows[0].commande_id) {
      await pool.query(
        `UPDATE commandes_exutoires SET statut = 'cloturee', updated_at = NOW() WHERE id = $1`,
        [result.rows[0].commande_id]
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[FACTURES-EXUTOIRES] Erreur validation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

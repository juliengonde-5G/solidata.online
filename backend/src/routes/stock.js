const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));
router.use(autoLogActivity('stock'));

// GET /api/stock — Mouvements de stock
router.get('/', async (req, res) => {
  try {
    const { type, date_from, date_to, limit: lim } = req.query;
    // matiere_id référence categories_sortantes (cf. A1, migration init-db).
    // sm.reversed_of_id / reversal_movement_id : chaîne de contre-écriture (item 30).
    let query = `SELECT sm.*, m.nom as matiere_categorie, m.famille as matiere_famille
       FROM stock_movements sm LEFT JOIN categories_sortantes m ON sm.matiere_id = m.id WHERE 1=1`;
    const params = [];

    if (type) { params.push(type); query += ` AND sm.type = $${params.length}`; }
    if (date_from) { params.push(date_from); query += ` AND sm.date >= $${params.length}`; }
    if (date_to) { params.push(date_to); query += ` AND sm.date <= $${params.length}`; }

    query += ' ORDER BY sm.date DESC, sm.created_at DESC';
    if (lim) { params.push(parseInt(lim)); query += ` LIMIT $${params.length}`; }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[STOCK] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/stock/summary — Résumé par catégorie
router.get('/summary', async (req, res) => {
  try {
    const { period } = req.query; // 30, 90, 365
    const days = parseInt(period) || 30;

    const result = await pool.query(
      `SELECT
        COALESCE(m.nom, 'Non classé') as categorie,
        SUM(CASE WHEN sm.type = 'entree' THEN sm.poids_kg ELSE 0 END) as total_entrees_kg,
        SUM(CASE WHEN sm.type = 'sortie' THEN sm.poids_kg ELSE 0 END) as total_sorties_kg,
        SUM(CASE WHEN sm.type = 'entree' THEN sm.poids_kg ELSE -sm.poids_kg END) as solde_kg,
        COUNT(*) as nb_mouvements
      FROM stock_movements sm
      LEFT JOIN categories_sortantes m ON sm.matiere_id = m.id
      WHERE sm.date >= NOW() - make_interval(days => $1)
      GROUP BY m.nom
      ORDER BY solde_kg DESC`,
      [days]
    );

    const totals = await pool.query(`
      SELECT
        SUM(CASE WHEN type = 'entree' THEN poids_kg ELSE 0 END) as total_entrees,
        SUM(CASE WHEN type = 'sortie' THEN poids_kg ELSE 0 END) as total_sorties,
        SUM(CASE WHEN type = 'entree' THEN poids_kg ELSE -poids_kg END) as stock_actuel
      FROM stock_movements
    `);

    res.json({ byCategory: result.rows, totals: totals.rows[0] });
  } catch (err) {
    console.error('[STOCK] Erreur résumé :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/stock
router.post('/', [
  body('type').isIn(['entree', 'sortie']).withMessage('Type requis (entree ou sortie)'),
  body('date').notEmpty().withMessage('Date requise'),
  body('poids_kg').isFloat({ min: 0 }).withMessage('Poids requis (valeur numérique)'),
], validate, async (req, res) => {
  try {
    const { type, date, poids_kg, matiere_id, destination, notes, code_barre,
      origine, categorie_collecte, poids_brut_kg, tare_kg, vehicle_id, tour_id, origine_type } = req.body;

    if (!type || !date || poids_kg == null) {
      return res.status(400).json({ error: 'type, date et poids_kg requis' });
    }

    const result = await pool.query(
      `INSERT INTO stock_movements (type, date, poids_kg, matiere_id, destination, notes,
       code_barre, origine, categorie_collecte, poids_brut_kg, tare_kg, vehicle_id, tour_id, created_by, origine_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [type, date, poids_kg, matiere_id, destination, notes,
       code_barre, origine, categorie_collecte, poids_brut_kg, tare_kg, vehicle_id, tour_id, req.user.id, origine_type || 'pav']
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[STOCK] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// CORRECTION AUDITÉE DES MOUVEMENTS (item 30)
// Pattern comptable : on ne supprime jamais un mouvement, on crée une
// contre-écriture liée qui l'annule. L'historique reste intact.
// ══════════════════════════════════════════

// POST /api/stock/movements/:id/cancel — Annuler un mouvement (contre-écriture)
router.post('/movements/:id/cancel', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const motif = (req.body?.motif || '').trim();
  if (!motif) {
    return res.status(400).json({ error: 'Un motif d\'annulation est obligatoire' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT * FROM stock_movements WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Mouvement introuvable' });
    }
    const orig = existing.rows[0];

    if (orig.reversed_of_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Une contre-écriture ne peut pas être annulée' });
    }
    if (orig.reversal_movement_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ce mouvement a déjà été annulé', reversal_id: orig.reversal_movement_id });
    }

    const oppositeType = orig.type === 'entree' ? 'sortie' : 'entree';

    // Contre-écriture : type opposé, même poids/catégorie/date → solde net = 0
    // sur la date d'origine (stock historique corrigé). Le « quand/qui/pourquoi »
    // est porté par created_at / created_by / reversal_reason.
    const reversal = await client.query(
      `INSERT INTO stock_movements
         (type, date, poids_kg, matiere_id, destination, code_barre, origine, notes,
          reversed_of_id, reversal_reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'annulation', $7, $8, $9, $10) RETURNING *`,
      [oppositeType, orig.date, orig.poids_kg, orig.matiere_id, orig.destination, orig.code_barre,
       `Annulation du mouvement #${orig.id} — ${motif}`, orig.id, motif, req.user.id]
    );

    await client.query(
      `UPDATE stock_movements SET reversal_movement_id = $1, reversed_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [reversal.rows[0].id, orig.id]
    );

    await client.query('COMMIT');
    res.status(201).json({ original_id: orig.id, reversal: reversal.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[STOCK] Erreur annulation mouvement :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// GET /api/stock/matieres — Référentiel matières
router.get('/matieres', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM matieres ORDER BY categorie, sous_categorie');
    res.json(result.rows);
  } catch (err) {
    console.error('[STOCK] Erreur matières :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/stock/matieres
router.post('/matieres', [
  body('categorie').notEmpty().withMessage('Catégorie requise'),
], validate, async (req, res) => {
  try {
    const { categorie, sous_categorie, qualite, destination_possible } = req.body;
    const result = await pool.query(
      'INSERT INTO matieres (categorie, sous_categorie, qualite, destination_possible) VALUES ($1, $2, $3, $4) RETURNING *',
      [categorie, sous_categorie, qualite, destination_possible || []]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[STOCK] Erreur création matière :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/stock/reconciliation — Vérifier la cohérence entre tournées et stock
router.get('/reconciliation', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        t.id as tour_id, t.date, t.total_weight_kg as tour_weight,
        sm.poids_kg as stock_weight, sm.id as stock_movement_id,
        CASE
          WHEN sm.id IS NULL THEN 'manquant'
          WHEN ABS(t.total_weight_kg - sm.poids_kg) > 1 THEN 'ecart'
          ELSE 'ok'
        END as status
      FROM tours t
      LEFT JOIN stock_movements sm ON sm.tour_id = t.id AND sm.type = 'entree'
      WHERE t.status = 'completed' AND t.total_weight_kg > 0
      ORDER BY t.date DESC
      LIMIT 100
    `);
    const summary = {
      total: result.rows.length,
      ok: result.rows.filter(r => r.status === 'ok').length,
      manquant: result.rows.filter(r => r.status === 'manquant').length,
      ecart: result.rows.filter(r => r.status === 'ecart').length,
    };
    res.json({ summary, details: result.rows });
  } catch (err) {
    console.error('[STOCK] Erreur réconciliation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// INVENTAIRE PHYSIQUE
// ══════════════════════════════════════════

// GET /api/stock/inventories — Liste des inventaires
router.get('/inventories', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ib.*, u.first_name || ' ' || u.last_name as created_by_name,
        v.first_name || ' ' || v.last_name as validated_by_name
      FROM inventory_batches ib
      LEFT JOIN users u ON ib.created_by = u.id
      LEFT JOIN users v ON ib.validated_by = v.id
      ORDER BY ib.date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[STOCK] Erreur inventaires :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/stock/inventories — Créer un nouvel inventaire
router.post('/inventories', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { type, notes } = req.body;
    const code = `INV-${type === 'complet' ? 'C' : 'P'}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

    await client.query('BEGIN');

    // Récupérer le stock théorique actuel par catégorie
    const stockRes = await client.query(`
      SELECT cs.id as categorie_id, cs.nom as categorie_nom,
        COALESCE(SUM(CASE WHEN sm.type = 'entree' THEN sm.poids_kg ELSE -sm.poids_kg END), 0) as stock_theorique_kg
      FROM categories_sortantes cs
      LEFT JOIN stock_movements sm ON sm.matiere_id = cs.id
      GROUP BY cs.id, cs.nom
      ORDER BY cs.nom
    `);

    const totalTheorique = stockRes.rows.reduce((s, r) => s + parseFloat(r.stock_theorique_kg || 0), 0);

    const batch = await client.query(
      `INSERT INTO inventory_batches (code, type, notes, total_theorique_kg, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [code, type || 'partiel', notes, totalTheorique, req.user.id]
    );

    // Lignes d'inventaire pré-remplies avec le théorique. stock_physique_kg reste
    // NULL = « non compté » (distinct de 0 = « compté, rien trouvé »), pour ne
    // régulariser que ce qui a réellement été compté (item 29).
    for (const cat of stockRes.rows) {
      await client.query(
        `INSERT INTO inventory_items (batch_id, categorie_sortante_id, categorie_nom, stock_theorique_kg, stock_physique_kg, ecart_kg, ecart_percent)
         VALUES ($1, $2, $3, $4, NULL, NULL, NULL)`,
        [batch.rows[0].id, cat.categorie_id, cat.categorie_nom, cat.stock_theorique_kg]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(batch.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[STOCK] Erreur création inventaire :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// GET /api/stock/inventories/:id — Détail d'un inventaire
router.get('/inventories/:id', async (req, res) => {
  try {
    const batch = await pool.query('SELECT * FROM inventory_batches WHERE id = $1', [req.params.id]);
    if (batch.rows.length === 0) return res.status(404).json({ error: 'Inventaire non trouvé' });

    const items = await pool.query(
      'SELECT * FROM inventory_items WHERE batch_id = $1 ORDER BY categorie_nom',
      [req.params.id]
    );

    // Régularisations générées à la validation (item 29) — pour audit / re-consultation
    const reguls = await pool.query(
      `SELECT sm.id, sm.type, sm.date, sm.poids_kg, sm.notes, m.nom as categorie_nom
       FROM stock_movements sm
       LEFT JOIN categories_sortantes m ON sm.matiere_id = m.id
       WHERE sm.inventory_batch_id = $1
       ORDER BY sm.id`,
      [req.params.id]
    );

    res.json({ ...batch.rows[0], items: items.rows, regularisations: reguls.rows });
  } catch (err) {
    console.error('[STOCK] Erreur détail inventaire :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/stock/inventories/:id/items — Saisir les quantités physiques
router.put('/inventories/:id/items', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { items } = req.body; // [{id, stock_physique_kg, notes}]
    if (!items || !Array.isArray(items)) { client.release(); return res.status(400).json({ error: 'items requis' }); }

    await client.query('BEGIN');

    // Garde : un inventaire validé n'est plus modifiable (fige les écarts régularisés)
    const batchState = await client.query('SELECT status FROM inventory_batches WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (batchState.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Inventaire non trouvé' });
    }
    if (batchState.rows[0].status !== 'en_cours') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Inventaire déjà validé — saisie impossible' });
    }

    let totalPhysique = 0;
    let totalTheorique = 0;

    for (const item of items) {
      const existing = await client.query('SELECT stock_theorique_kg FROM inventory_items WHERE id = $1 AND batch_id = $2', [item.id, req.params.id]);
      if (existing.rows.length === 0) continue;
      const theorique = parseFloat(existing.rows[0].stock_theorique_kg) || 0;

      // NULL / '' / undefined = non compté → on n'écrit ni physique ni écart
      const raw = item.stock_physique_kg;
      const counted = !(raw === null || raw === undefined || raw === '');
      const physique = counted ? parseFloat(raw) : null;

      if (physique === null || isNaN(physique)) {
        await client.query(
          `UPDATE inventory_items SET stock_physique_kg = NULL, ecart_kg = NULL, ecart_percent = NULL, counted = false, notes = $1
           WHERE id = $2 AND batch_id = $3`,
          [item.notes || null, item.id, req.params.id]
        );
        continue;
      }

      const ecart = physique - theorique;
      const ecartPct = theorique > 0 ? Math.round((ecart / theorique) * 10000) / 100 : 0;

      await client.query(
        `UPDATE inventory_items SET stock_physique_kg = $1, ecart_kg = $2, ecart_percent = $3, counted = true, notes = $4
         WHERE id = $5 AND batch_id = $6`,
        [physique, ecart, ecartPct, item.notes || null, item.id, req.params.id]
      );

      totalPhysique += physique;
      totalTheorique += theorique;
    }

    const ecartTotal = totalPhysique - totalTheorique;
    const ecartPctTotal = totalTheorique > 0 ? Math.round((ecartTotal / totalTheorique) * 10000) / 100 : 0;

    await client.query(
      `UPDATE inventory_batches SET total_physique_kg = $1, ecart_kg = $2, ecart_percent = $3, updated_at = NOW()
       WHERE id = $4`,
      [totalPhysique, ecartTotal, ecartPctTotal, req.params.id]
    );

    await client.query('COMMIT');
    res.json({ total_physique_kg: totalPhysique, ecart_kg: ecartTotal, ecart_percent: ecartPctTotal });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[STOCK] Erreur saisie inventaire :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// POST /api/stock/inventories/:id/validate — Valider un inventaire
// Item 29 : la validation POSE des écritures de régularisation (une par
// catégorie comptée dont l'écart ≠ 0) pour recaler le stock théorique sur le
// comptage physique. Sans cela, le théorique diverge indéfiniment après chaque
// inventaire. Idempotent : la garde WHERE status='en_cours' empêche le doublon.
router.post('/inventories/:id/validate', authorize('ADMIN'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const upd = await client.query(
      `UPDATE inventory_batches SET status = 'valide', validated_by = $1, validated_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND status = 'en_cours' RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (upd.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Inventaire non trouvé ou déjà validé' });
    }
    const batch = upd.rows[0];

    // Régularisations : uniquement les lignes réellement comptées (physique non NULL)
    // avec un écart significatif (> 10 g pour éviter le bruit flottant).
    const items = await client.query(
      `SELECT id, categorie_sortante_id, categorie_nom, stock_theorique_kg, stock_physique_kg, ecart_kg
       FROM inventory_items
       WHERE batch_id = $1 AND counted = true AND stock_physique_kg IS NOT NULL`,
      [req.params.id]
    );

    const regularisations = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const it of items.rows) {
      const theorique = parseFloat(it.stock_theorique_kg) || 0;
      const physique = parseFloat(it.stock_physique_kg);
      const ecart = physique - theorique;
      if (Math.abs(ecart) < 0.01) continue;

      // écart > 0 → il manque du stock au théorique → 'entree' ; sinon 'sortie'.
      const mvType = ecart > 0 ? 'entree' : 'sortie';
      const notes = `Régularisation inventaire ${batch.code} — ${it.categorie_nom || 'catégorie'} : théorique ${theorique.toFixed(1)} → compté ${physique.toFixed(1)} kg`;
      const ins = await client.query(
        `INSERT INTO stock_movements
           (type, date, poids_kg, matiere_id, origine, notes, inventory_batch_id, created_by)
         VALUES ($1, $2, $3, $4, 'regularisation_inventaire', $5, $6, $7)
         RETURNING id, type, date, poids_kg, matiere_id, notes`,
        [mvType, today, Math.abs(ecart), it.categorie_sortante_id, notes, batch.id, req.user.id]
      );
      regularisations.push({ ...ins.rows[0], categorie_nom: it.categorie_nom, ecart_kg: ecart });
    }

    await client.query('COMMIT');
    res.json({ ...batch, regularisations });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[STOCK] Erreur validation inventaire :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

module.exports = router;

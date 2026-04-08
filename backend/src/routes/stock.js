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
    let query = `SELECT sm.*, m.categorie as matiere_categorie, m.sous_categorie
       FROM stock_movements sm LEFT JOIN matieres m ON sm.matiere_id = m.id WHERE 1=1`;
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
        COALESCE(m.categorie, 'Non classé') as categorie,
        SUM(CASE WHEN sm.type = 'entree' THEN sm.poids_kg ELSE 0 END) as total_entrees_kg,
        SUM(CASE WHEN sm.type = 'sortie' THEN sm.poids_kg ELSE 0 END) as total_sorties_kg,
        SUM(CASE WHEN sm.type = 'entree' THEN sm.poids_kg ELSE -sm.poids_kg END) as solde_kg,
        COUNT(*) as nb_mouvements
      FROM stock_movements sm
      LEFT JOIN matieres m ON sm.matiere_id = m.id
      WHERE sm.date >= NOW() - make_interval(days => $1)
      GROUP BY m.categorie
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

    if (!type || !date || !poids_kg) {
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

    // Créer les lignes d'inventaire pré-remplies avec le stock théorique
    for (const cat of stockRes.rows) {
      await client.query(
        `INSERT INTO inventory_items (batch_id, categorie_sortante_id, categorie_nom, stock_theorique_kg)
         VALUES ($1, $2, $3, $4)`,
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

    res.json({ ...batch.rows[0], items: items.rows });
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

    let totalPhysique = 0;
    let totalTheorique = 0;

    for (const item of items) {
      const physique = parseFloat(item.stock_physique_kg) || 0;
      const existing = await client.query('SELECT stock_theorique_kg FROM inventory_items WHERE id = $1 AND batch_id = $2', [item.id, req.params.id]);
      if (existing.rows.length === 0) continue;

      const theorique = parseFloat(existing.rows[0].stock_theorique_kg) || 0;
      const ecart = physique - theorique;
      const ecartPct = theorique > 0 ? Math.round((ecart / theorique) * 10000) / 100 : 0;

      await client.query(
        `UPDATE inventory_items SET stock_physique_kg = $1, ecart_kg = $2, ecart_percent = $3, notes = $4
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
router.post('/inventories/:id/validate', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE inventory_batches SET status = 'valide', validated_by = $1, validated_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND status = 'en_cours' RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Inventaire non trouvé ou déjà validé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[STOCK] Erreur validation inventaire :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

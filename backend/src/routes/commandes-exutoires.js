const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// Helper: generate order reference
async function generateReference() {
  const year = new Date().getFullYear();
  const result = await pool.query(
    "SELECT MAX(reference) as last FROM commandes_exutoires WHERE reference LIKE $1",
    [`CMD-${year}-%`]
  );
  const last = result.rows[0].last;
  if (!last) return `CMD-${year}-0001`;
  const num = parseInt(last.split('-')[2]) + 1;
  return `CMD-${year}-${String(num).padStart(4, '0')}`;
}

const STATUTS_VALIDES = [
  'en_attente',
  'confirmee',
  'en_preparation',
  'expediee',
  'pesee_recue',
  'facturee',
  'cloturee',
  'annulee'
];

// GET /api/commandes-exutoires
router.get('/', async (req, res) => {
  try {
    const { statut, client_id, type_produit, date_from, date_to } = req.query;
    let query = `
      SELECT c.*, cl.raison_sociale
      FROM commandes_exutoires c
      JOIN clients_exutoires cl ON c.client_id = cl.id
      WHERE 1=1
    `;
    const params = [];

    if (statut) {
      params.push(statut);
      query += ` AND c.statut = $${params.length}`;
    }
    if (client_id) {
      params.push(client_id);
      query += ` AND c.client_id = $${params.length}`;
    }
    if (type_produit) {
      params.push(type_produit);
      query += ` AND $${params.length} = ANY(c.type_produit)`;
    }
    if (date_from) {
      params.push(date_from);
      query += ` AND c.date_commande >= $${params.length}`;
    }
    if (date_to) {
      params.push(date_to);
      query += ` AND c.date_commande <= $${params.length}`;
    }

    query += ' ORDER BY c.date_commande DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[COMMANDES-EXUTOIRES] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/commandes-exutoires/stats
router.get('/stats', async (req, res) => {
  try {
    const countByStatut = await pool.query(
      'SELECT statut, COUNT(*)::int as count FROM commandes_exutoires GROUP BY statut'
    );

    const totaux = await pool.query(
      'SELECT COALESCE(SUM(tonnage_prevu), 0) as total_tonnage_prevu, COALESCE(SUM(tonnage_prevu * prix_tonne), 0) as total_ca_prevu FROM commandes_exutoires'
    );

    res.json({
      count_by_statut: countByStatut.rows,
      total_tonnage_prevu: parseFloat(totaux.rows[0].total_tonnage_prevu),
      total_ca_prevu: parseFloat(totaux.rows[0].total_ca_prevu)
    });
  } catch (err) {
    console.error('[COMMANDES-EXUTOIRES] Erreur stats :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/commandes-exutoires/:id
router.get('/:id', async (req, res) => {
  try {
    const orderResult = await pool.query(
      `SELECT c.*, cl.raison_sociale
       FROM commandes_exutoires c
       JOIN clients_exutoires cl ON c.client_id = cl.id
       WHERE c.id = $1`,
      [req.params.id]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Commande exutoire non trouvee' });
    }

    const order = orderResult.rows[0];

    const preparationResult = await pool.query(
      'SELECT * FROM preparations_expedition WHERE commande_id = $1',
      [req.params.id]
    );

    const controlePeseeResult = await pool.query(
      'SELECT * FROM controles_pesee WHERE commande_id = $1',
      [req.params.id]
    );

    const factureResult = await pool.query(
      'SELECT * FROM factures_exutoires WHERE commande_id = $1',
      [req.params.id]
    );

    res.json({
      ...order,
      preparation: preparationResult.rows[0] || null,
      controle_pesee: controlePeseeResult.rows[0] || null,
      facture: factureResult.rows[0] || null
    });
  } catch (err) {
    console.error('[COMMANDES-EXUTOIRES] Erreur detail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/commandes-exutoires
router.post('/', async (req, res) => {
  try {
    const { client_id, type_produit, date_commande, prix_tonne, tonnage_prevu, frequence, date_fin_recurrence, notes } = req.body;

    if (!client_id || !type_produit || !date_commande || !prix_tonne) {
      return res.status(400).json({ error: 'Champs obligatoires : client_id, type_produit, date_commande, prix_tonne' });
    }

    // Normalize type_produit to array
    const types = Array.isArray(type_produit) ? type_produit : [type_produit];

    const reference = await generateReference();

    const result = await pool.query(
      `INSERT INTO commandes_exutoires (reference, client_id, type_produit, date_commande, prix_tonne, tonnage_prevu, frequence, date_fin_recurrence, notes, statut)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'en_attente') RETURNING *`,
      [reference, client_id, types, date_commande, prix_tonne, tonnage_prevu || null, frequence || 'unique', date_fin_recurrence || null, notes || null]
    );

    await pool.query(
      `INSERT INTO historique_commandes_exutoires (commande_id, ancien_statut, nouveau_statut, utilisateur_id)
       VALUES ($1, $2, $3, $4)`,
      [result.rows[0].id, null, 'en_attente', req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[COMMANDES-EXUTOIRES] Erreur creation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/commandes-exutoires/:id
router.put('/:id', async (req, res) => {
  try {
    const { client_id, type_produit, date_commande, prix_tonne, tonnage_prevu, frequence, date_fin_recurrence, notes } = req.body;

    // Normalize type_produit to array if provided
    const types = type_produit ? (Array.isArray(type_produit) ? type_produit : [type_produit]) : null;

    const result = await pool.query(
      `UPDATE commandes_exutoires SET
       client_id = COALESCE($1, client_id),
       type_produit = COALESCE($2, type_produit),
       date_commande = COALESCE($3, date_commande),
       prix_tonne = COALESCE($4, prix_tonne),
       tonnage_prevu = COALESCE($5, tonnage_prevu),
       frequence = COALESCE($6, frequence),
       date_fin_recurrence = COALESCE($7, date_fin_recurrence),
       notes = COALESCE($8, notes),
       updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [client_id, types, date_commande, prix_tonne, tonnage_prevu, frequence, date_fin_recurrence, notes, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Commande exutoire non trouvee' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[COMMANDES-EXUTOIRES] Erreur mise a jour :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/commandes-exutoires/:id/statut
router.patch('/:id/statut', async (req, res) => {
  try {
    const { statut, commentaire } = req.body;

    if (!statut || !STATUTS_VALIDES.includes(statut)) {
      return res.status(400).json({ error: `Statut invalide. Valeurs acceptees : ${STATUTS_VALIDES.join(', ')}` });
    }

    const current = await pool.query('SELECT statut FROM commandes_exutoires WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Commande exutoire non trouvee' });
    }

    const ancienStatut = current.rows[0].statut;

    const result = await pool.query(
      'UPDATE commandes_exutoires SET statut = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [statut, req.params.id]
    );

    await pool.query(
      `INSERT INTO historique_commandes_exutoires (commande_id, ancien_statut, nouveau_statut, commentaire, utilisateur_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, ancienStatut, statut, commentaire || null, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[COMMANDES-EXUTOIRES] Erreur changement statut :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/commandes-exutoires/:id/annuler
router.patch('/:id/annuler', async (req, res) => {
  try {
    const current = await pool.query('SELECT statut FROM commandes_exutoires WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Commande exutoire non trouvee' });
    }

    const ancienStatut = current.rows[0].statut;
    const statutsNonAnnulables = ['expediee', 'pesee_recue', 'facturee', 'cloturee'];

    if (statutsNonAnnulables.includes(ancienStatut)) {
      return res.status(400).json({ error: `Impossible d'annuler une commande au statut "${ancienStatut}"` });
    }

    const result = await pool.query(
      'UPDATE commandes_exutoires SET statut = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      ['annulee', req.params.id]
    );

    await pool.query(
      `INSERT INTO historique_commandes_exutoires (commande_id, ancien_statut, nouveau_statut, commentaire, utilisateur_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, ancienStatut, 'annulee', 'Annulation de la commande', req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[COMMANDES-EXUTOIRES] Erreur annulation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

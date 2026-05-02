const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');
const billingService = require('../services/BillingService');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));
router.use(autoLogActivity('billing'));

// GET /api/billing/invoices (+ alias /api/billing)
router.get('/invoices', async (req, res) => {
  try {
    const { status, date_from, date_to } = req.query;
    let query = 'SELECT * FROM invoices WHERE 1=1';
    const params = [];

    if (status) { params.push(status); query += ` AND status = $${params.length}`; }
    if (date_from) { params.push(date_from); query += ` AND date >= $${params.length}`; }
    if (date_to) { params.push(date_to); query += ` AND date <= $${params.length}`; }

    query += ' ORDER BY date DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[BILLING] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/billing/invoices/:id
router.get('/invoices/:id', async (req, res) => {
  try {
    const invoice = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (invoice.rows.length === 0) return res.status(404).json({ error: 'Facture non trouvée' });

    const lines = await pool.query(
      'SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY position',
      [req.params.id]
    );

    res.json({ ...invoice.rows[0], lines: lines.rows });
  } catch (err) {
    console.error('[BILLING] Erreur détail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/billing (alias)
router.get('/', async (req, res, next) => {
  req.url = '/invoices';
  router.handle(req, res, next);
});

// POST /api/billing/invoices
router.post('/invoices', [
  body('client_name').notEmpty().withMessage('Nom du client requis'),
  body('date').notEmpty().withMessage('Date requise'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const { client_name, client_address, client_email, date, due_date, notes, lines } = req.body;
    if (!client_name || !date) return res.status(400).json({ error: 'Client et date requis' });

    await client.query('BEGIN');

    // Numérotation + totaux via BillingService (V5.4)
    const invoiceNumber = await billingService.generateInvoiceNumber(
      client, 'FAC', 'invoices', 'invoice_number'
    );
    const { totalHT, totalTVA, totalTTC, lineDetails } = billingService.calculateTotals(lines);

    const result = await client.query(
      `INSERT INTO invoices (invoice_number, client_name, client_address, client_email,
       date, due_date, total_ht, total_tva, total_ttc, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [invoiceNumber, client_name, client_address, client_email,
       date, due_date, totalHT, totalTVA, totalTTC, notes, req.user.id]
    );
    const invoiceId = result.rows[0].id;

    // Lignes (déjà arrondies par calculateTotals)
    for (let i = 0; i < lineDetails.length; i++) {
      const l = lineDetails[i];
      await client.query(
        'INSERT INTO invoice_lines (invoice_id, position, description, quantity, unit_price, total) VALUES ($1, $2, $3, $4, $5, $6)',
        [invoiceId, i + 1, l.description, l.quantity, l.unit_price, l.total]
      );
    }

    await client.query('COMMIT');

    const full = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
    const insertedLines = await pool.query('SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY position', [invoiceId]);

    res.status(201).json({ ...full.rows[0], lines: insertedLines.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[BILLING] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// PUT /api/billing/invoices/:id/status
router.put('/invoices/:id/status', [
  body('status').isIn(['draft', 'sent', 'paid', 'overdue', 'cancelled']).withMessage('Statut invalide'),
], validate, async (req, res) => {
  try {
    const { status } = req.body;

    // Récupère le statut actuel pour valider la transition (V5.4)
    const current = await pool.query('SELECT status FROM invoices WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Facture non trouvée' });

    const check = billingService.canTransitionStatus(current.rows[0].status, status);
    if (!check.ok) return res.status(409).json({ error: check.reason });

    const updates = ['status = $1', 'updated_at = NOW()'];
    if (status === 'paid') updates.push('paid_at = NOW()');

    const result = await pool.query(
      `UPDATE invoices SET ${updates.join(', ')} WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[BILLING] Erreur statut :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

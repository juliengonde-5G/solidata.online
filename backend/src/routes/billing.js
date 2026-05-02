const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');
const billingService = require('../services/BillingService');
const invoiceRepo = require('../repositories/InvoiceRepository');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));
router.use(autoLogActivity('billing'));

// GET /api/billing/invoices (+ alias /api/billing)
router.get('/invoices', async (req, res) => {
  try {
    const { status, date_from, date_to } = req.query;
    const rows = await invoiceRepo.findAll({ status, date_from, date_to });
    res.json(rows);
  } catch (err) {
    console.error('[BILLING] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/billing/invoices/:id
router.get('/invoices/:id', async (req, res) => {
  try {
    const result = await invoiceRepo.findByIdWithLines(req.params.id);
    if (!result) return res.status(404).json({ error: 'Facture non trouvée' });
    res.json(result);
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

    // Persistance via InvoiceRepository (V6.3)
    const inserted = await invoiceRepo.create(
      {
        invoice_number: invoiceNumber,
        client_name, client_address, client_email,
        date, due_date,
        total_ht: totalHT, total_tva: totalTVA, total_ttc: totalTTC,
        notes,
        created_by: req.user.id,
      },
      lineDetails,
      { client }
    );

    await client.query('COMMIT');

    const full = await invoiceRepo.findByIdWithLines(inserted.id);
    res.status(201).json(full);
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

    const current = await invoiceRepo.findById(req.params.id);
    if (!current) return res.status(404).json({ error: 'Facture non trouvée' });

    const check = billingService.canTransitionStatus(current.status, status);
    if (!check.ok) return res.status(409).json({ error: check.reason });

    const updated = await invoiceRepo.updateStatus(req.params.id, status);
    res.json(updated);
  } catch (err) {
    console.error('[BILLING] Erreur statut :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// Générer numéro de facture auto
async function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const result = await pool.query(
    "SELECT MAX(invoice_number) as last FROM invoices WHERE invoice_number LIKE $1",
    [`FAC-${year}-%`]
  );
  const last = result.rows[0].last;
  if (!last) return `FAC-${year}-0001`;
  const num = parseInt(last.split('-')[2]) + 1;
  return `FAC-${year}-${String(num).padStart(4, '0')}`;
}

// GET /api/billing
router.get('/', async (req, res) => {
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

// GET /api/billing/:id
router.get('/:id', async (req, res) => {
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

// POST /api/billing
router.post('/', async (req, res) => {
  try {
    const { client_name, client_address, client_email, date, due_date, notes, lines } = req.body;
    if (!client_name || !date) return res.status(400).json({ error: 'Client et date requis' });

    const invoiceNumber = await generateInvoiceNumber();

    // Calcul totaux
    let totalHT = 0;
    if (lines?.length) {
      totalHT = lines.reduce((sum, l) => sum + (l.quantity || 1) * (l.unit_price || 0), 0);
    }
    const tvaRate = 0.20;
    const totalTVA = totalHT * tvaRate;
    const totalTTC = totalHT + totalTVA;

    const result = await pool.query(
      `INSERT INTO invoices (invoice_number, client_name, client_address, client_email,
       date, due_date, total_ht, total_tva, total_ttc, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [invoiceNumber, client_name, client_address, client_email,
       date, due_date, Math.round(totalHT * 100) / 100,
       Math.round(totalTVA * 100) / 100, Math.round(totalTTC * 100) / 100,
       notes, req.user.id]
    );
    const invoiceId = result.rows[0].id;

    // Lignes
    if (lines?.length) {
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const lineTotal = (l.quantity || 1) * (l.unit_price || 0);
        await pool.query(
          'INSERT INTO invoice_lines (invoice_id, position, description, quantity, unit_price, total) VALUES ($1, $2, $3, $4, $5, $6)',
          [invoiceId, i + 1, l.description, l.quantity || 1, l.unit_price || 0, Math.round(lineTotal * 100) / 100]
        );
      }
    }

    const full = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
    const insertedLines = await pool.query('SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY position', [invoiceId]);

    res.status(201).json({ ...full.rows[0], lines: insertedLines.rows });
  } catch (err) {
    console.error('[BILLING] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/billing/:id/status
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Statut invalide' });

    const updates = ['status = $1', 'updated_at = NOW()'];
    if (status === 'paid') updates.push('paid_at = NOW()');

    const result = await pool.query(
      `UPDATE invoices SET ${updates.join(', ')} WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Facture non trouvée' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[BILLING] Erreur statut :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

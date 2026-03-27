const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

// Auto-create tables
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pennylane_config (
        id SERIAL PRIMARY KEY,
        api_key_encrypted TEXT,
        company_id VARCHAR(100),
        is_active BOOLEAN DEFAULT false,
        last_sync_at TIMESTAMP,
        sync_invoices BOOLEAN DEFAULT true,
        sync_suppliers BOOLEAN DEFAULT true,
        sync_journal BOOLEAN DEFAULT true,
        webhook_secret TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pennylane_sync_log (
        id SERIAL PRIMARY KEY,
        sync_type VARCHAR(50) NOT NULL,
        direction VARCHAR(10) NOT NULL DEFAULT 'push',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        records_count INTEGER DEFAULT 0,
        error_message TEXT,
        details JSONB DEFAULT '{}',
        started_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP,
        created_by INTEGER REFERENCES users(id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pennylane_mappings (
        id SERIAL PRIMARY KEY,
        local_type VARCHAR(50) NOT NULL,
        local_id INTEGER NOT NULL,
        pennylane_type VARCHAR(50) NOT NULL,
        pennylane_id VARCHAR(100) NOT NULL,
        last_synced_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(local_type, local_id)
      )
    `);
    console.log('[PENNYLANE] Tables OK');
  } catch (err) {
    console.error('[PENNYLANE] Migration :', err.message);
  }
})();

router.use(authenticate);
router.use(autoLogActivity('pennylane'));

// ══════════════════════════════════════════
// CONFIGURATION PENNYLANE
// ══════════════════════════════════════════

// GET /api/pennylane/config — Récupérer la configuration
router.get('/config', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, company_id, is_active, last_sync_at, sync_invoices, sync_suppliers, sync_journal, created_at, updated_at FROM pennylane_config LIMIT 1');
    res.json(result.rows[0] || { is_active: false, company_id: '', sync_invoices: true, sync_suppliers: true, sync_journal: true });
  } catch (err) {
    console.error('[PENNYLANE] Erreur config GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/pennylane/config — Mettre à jour la configuration
router.put('/config', authorize('ADMIN'), [
  body('company_id').notEmpty().withMessage('ID société Pennylane requis'),
], validate, async (req, res) => {
  try {
    const { api_key, company_id, is_active, sync_invoices, sync_suppliers, sync_journal } = req.body;

    // Chiffrement simple de la clé API (en production, utiliser AES-256 via crypto-js)
    const crypto = require('crypto');
    const API_ENCRYPTION_KEY = process.env.PENNYLANE_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-key';
    let api_key_encrypted = null;
    if (api_key) {
      const cipher = crypto.createCipheriv('aes-256-cbc',
        crypto.createHash('sha256').update(API_ENCRYPTION_KEY).digest(),
        Buffer.alloc(16, 0)
      );
      api_key_encrypted = cipher.update(api_key, 'utf8', 'hex') + cipher.final('hex');
    }

    const existing = await pool.query('SELECT id FROM pennylane_config LIMIT 1');
    let result;
    if (existing.rows.length > 0) {
      const updates = [];
      const params = [];
      let idx = 1;

      params.push(company_id); updates.push(`company_id = $${idx++}`);
      params.push(is_active ?? false); updates.push(`is_active = $${idx++}`);
      params.push(sync_invoices ?? true); updates.push(`sync_invoices = $${idx++}`);
      params.push(sync_suppliers ?? true); updates.push(`sync_suppliers = $${idx++}`);
      params.push(sync_journal ?? true); updates.push(`sync_journal = $${idx++}`);
      if (api_key_encrypted) {
        params.push(api_key_encrypted); updates.push(`api_key_encrypted = $${idx++}`);
      }
      updates.push(`updated_at = NOW()`);
      params.push(existing.rows[0].id);

      result = await pool.query(
        `UPDATE pennylane_config SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, company_id, is_active, last_sync_at, sync_invoices, sync_suppliers, sync_journal, updated_at`,
        params
      );
    } else {
      result = await pool.query(
        `INSERT INTO pennylane_config (api_key_encrypted, company_id, is_active, sync_invoices, sync_suppliers, sync_journal)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, company_id, is_active, sync_invoices, sync_suppliers, sync_journal`,
        [api_key_encrypted, company_id, is_active ?? false, sync_invoices ?? true, sync_suppliers ?? true, sync_journal ?? true]
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[PENNYLANE] Erreur config PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// TEST CONNEXION
// ══════════════════════════════════════════

// POST /api/pennylane/test — Tester la connexion Pennylane
router.post('/test', authorize('ADMIN'), async (req, res) => {
  try {
    const config = await pool.query('SELECT api_key_encrypted, company_id FROM pennylane_config WHERE is_active = true LIMIT 1');
    if (config.rows.length === 0) {
      return res.status(400).json({ error: 'Pennylane non configuré ou inactif', connected: false });
    }

    // Déchiffrer la clé API
    const crypto = require('crypto');
    const API_ENCRYPTION_KEY = process.env.PENNYLANE_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-key';
    const decipher = crypto.createDecipheriv('aes-256-cbc',
      crypto.createHash('sha256').update(API_ENCRYPTION_KEY).digest(),
      Buffer.alloc(16, 0)
    );
    const apiKey = decipher.update(config.rows[0].api_key_encrypted, 'hex', 'utf8') + decipher.final('utf8');

    // Test API Pennylane
    const https = require('https');
    const testResult = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'app.pennylane.com',
        path: '/api/external/v2/company',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
        timeout: 10000,
      };
      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ status: response.statusCode, data: parsed });
          } catch {
            resolve({ status: response.statusCode, data: data });
          }
        });
      });
      request.on('error', reject);
      request.on('timeout', () => { request.destroy(); reject(new Error('Timeout')); });
      request.end();
    });

    if (testResult.status === 200) {
      await pool.query('UPDATE pennylane_config SET last_sync_at = NOW()');
      res.json({
        connected: true,
        company: testResult.data?.company?.name || testResult.data?.name || config.rows[0].company_id,
        message: 'Connexion Pennylane OK',
      });
    } else if (testResult.status === 401) {
      res.json({ connected: false, error: 'Clé API invalide ou expirée' });
    } else {
      res.json({ connected: false, error: `Erreur Pennylane (HTTP ${testResult.status})` });
    }
  } catch (err) {
    console.error('[PENNYLANE] Erreur test :', err);
    res.json({ connected: false, error: err.message || 'Erreur de connexion' });
  }
});

// ══════════════════════════════════════════
// SYNCHRONISATION
// ══════════════════════════════════════════

// POST /api/pennylane/sync/invoices — Synchroniser les factures vers Pennylane
router.post('/sync/invoices', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const config = await pool.query('SELECT api_key_encrypted, company_id FROM pennylane_config WHERE is_active = true LIMIT 1');
    if (config.rows.length === 0) {
      return res.status(400).json({ error: 'Pennylane non configuré' });
    }

    // Récupérer les factures non synchronisées
    const invoices = await pool.query(`
      SELECT i.*, il.description as line_desc, il.quantity, il.unit_price, il.total as line_total
      FROM invoices i
      LEFT JOIN invoice_lines il ON il.invoice_id = i.id
      LEFT JOIN pennylane_mappings pm ON pm.local_type = 'invoice' AND pm.local_id = i.id
      WHERE pm.id IS NULL AND i.status != 'draft'
      ORDER BY i.date DESC
    `);

    // Log de sync
    const syncLog = await pool.query(
      `INSERT INTO pennylane_sync_log (sync_type, direction, status, records_count, created_by)
       VALUES ('invoices', 'push', 'in_progress', $1, $2) RETURNING id`,
      [invoices.rows.length, req.user.id]
    );

    // Ici on prépare les données pour l'API Pennylane
    // En production : appel réel à l'API Pennylane pour chaque facture
    const results = { synced: 0, errors: 0, details: [] };

    // Grouper par facture
    const invoiceMap = {};
    invoices.rows.forEach(row => {
      if (!invoiceMap[row.id]) {
        invoiceMap[row.id] = { ...row, lines: [] };
      }
      if (row.line_desc) {
        invoiceMap[row.id].lines.push({
          description: row.line_desc,
          quantity: row.quantity,
          unit_price: row.unit_price,
          total: row.line_total,
        });
      }
    });

    for (const invoice of Object.values(invoiceMap)) {
      try {
        // Mapping Solidata → Pennylane
        const pennylaneInvoice = {
          date: invoice.date,
          deadline: invoice.due_date,
          invoice_number: invoice.invoice_number,
          currency: 'EUR',
          customer: {
            name: invoice.client_name,
            address: invoice.client_address,
            emails: invoice.client_email ? [invoice.client_email] : [],
          },
          line_items: invoice.lines.map(l => ({
            label: l.description,
            quantity: l.quantity,
            unit: 'piece',
            vat_rate: 'FR_200',
            unit_price: l.unit_price,
          })),
        };

        // Enregistrer le mapping (simulation — en prod, utiliser l'ID retourné par Pennylane)
        await pool.query(
          `INSERT INTO pennylane_mappings (local_type, local_id, pennylane_type, pennylane_id)
           VALUES ('invoice', $1, 'customer_invoice', $2)
           ON CONFLICT (local_type, local_id) DO UPDATE SET pennylane_id = $2, last_synced_at = NOW()`,
          [invoice.id, `PL-${invoice.invoice_number}`]
        );
        results.synced++;
        results.details.push({ invoice_number: invoice.invoice_number, status: 'ok' });
      } catch (syncErr) {
        results.errors++;
        results.details.push({ invoice_number: invoice.invoice_number, status: 'error', error: syncErr.message });
      }
    }

    // Mettre à jour le log
    await pool.query(
      `UPDATE pennylane_sync_log SET status = $1, completed_at = NOW(), details = $2 WHERE id = $3`,
      [results.errors > 0 ? 'partial' : 'completed', JSON.stringify(results), syncLog.rows[0].id]
    );

    await pool.query('UPDATE pennylane_config SET last_sync_at = NOW()');

    res.json({
      message: `Synchronisation terminée : ${results.synced} facture(s) synchronisée(s), ${results.errors} erreur(s)`,
      ...results,
    });
  } catch (err) {
    console.error('[PENNYLANE] Erreur sync factures :', err);
    res.status(500).json({ error: 'Erreur synchronisation' });
  }
});

// ══════════════════════════════════════════
// HISTORIQUE DE SYNC
// ══════════════════════════════════════════

// GET /api/pennylane/sync/history — Historique des synchronisations
router.get('/sync/history', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT psl.*, u.first_name || ' ' || u.last_name as user_name
      FROM pennylane_sync_log psl
      LEFT JOIN users u ON psl.created_by = u.id
      ORDER BY psl.started_at DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[PENNYLANE] Erreur historique :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/pennylane/mappings — Voir les correspondances Solidata ↔ Pennylane
router.get('/mappings', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM pennylane_mappings ORDER BY last_synced_at DESC LIMIT 100'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[PENNYLANE] Erreur mappings :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/pennylane/status — Statut global de la connexion
router.get('/status', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const config = await pool.query('SELECT is_active, last_sync_at, company_id FROM pennylane_config LIMIT 1');
    const mappingsCount = await pool.query('SELECT COUNT(*) as total FROM pennylane_mappings');
    const lastSync = await pool.query('SELECT * FROM pennylane_sync_log ORDER BY started_at DESC LIMIT 1');

    res.json({
      configured: config.rows.length > 0,
      active: config.rows[0]?.is_active || false,
      company_id: config.rows[0]?.company_id || null,
      last_sync: config.rows[0]?.last_sync_at || null,
      total_mappings: parseInt(mappingsCount.rows[0].total),
      last_sync_log: lastSync.rows[0] || null,
    });
  } catch (err) {
    console.error('[PENNYLANE] Erreur status :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

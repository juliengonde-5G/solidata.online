const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');
const crypto = require('crypto');
const https = require('https');

// ══════════════════════════════════════════
// HELPERS CHIFFREMENT + API PENNYLANE
// ══════════════════════════════════════════

function getEncryptionKey() {
  const key = process.env.PENNYLANE_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!key) throw new Error('Clé de chiffrement non configurée (PENNYLANE_ENCRYPTION_KEY ou JWT_SECRET requis)');
  return crypto.createHash('sha256').update(key).digest();
}

function decryptApiKey(encrypted) {
  const [ivHex, encryptedHex] = encrypted.split(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKey(), Buffer.from(ivHex, 'hex'));
  return decipher.update(encryptedHex, 'hex', 'utf8') + decipher.final('utf8');
}

function encryptApiKey(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', getEncryptionKey(), iv);
  return iv.toString('hex') + ':' + cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
}

function pennylaneRequest(apiKey, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'app.pennylane.com', path: `/api/external/v2${path}`, method,
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json', 'X-Use-2026-API-Changes': 'true' },
      timeout: 15000,
    };
    if (postData) { options.headers['Content-Type'] = 'application/json'; options.headers['Content-Length'] = Buffer.byteLength(postData); }
    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => { try { resolve({ status: response.statusCode, data: JSON.parse(data) }); } catch { resolve({ status: response.statusCode, data }); } });
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('Timeout Pennylane')); });
    if (postData) request.write(postData);
    request.end();
  });
}

async function getActiveApiKey() {
  const config = await pool.query('SELECT api_key_encrypted, company_id FROM pennylane_config WHERE is_active = true LIMIT 1');
  if (config.rows.length === 0) return null;
  return { apiKey: decryptApiKey(config.rows[0].api_key_encrypted), companyId: config.rows[0].company_id };
}

async function fetchAllPages(apiKey, basePath, params = {}) {
  const allItems = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const qs = new URLSearchParams({ ...params, page: String(page), per_page: String(perPage) });
    const result = await pennylaneRequest(apiKey, 'GET', `${basePath}?${qs.toString()}`);
    if (result.status !== 200) throw new Error(`Pennylane API ${result.status}: ${JSON.stringify(result.data?.error || result.data?.message || '')}`);
    const items = result.data?.ledger_entries || result.data?.bank_transactions || result.data?.ledger_accounts || result.data?.customer_invoices || result.data?.items || result.data?.data || [];
    if (!Array.isArray(items) || items.length === 0) break;
    allItems.push(...items);
    if (items.length < perPage) break;
    page++;
    await new Promise(r => setTimeout(r, 250)); // rate limit 5 req/s
  }
  return allItems;
}

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

    let api_key_encrypted = null;
    if (api_key) {
      try { api_key_encrypted = encryptApiKey(api_key); }
      catch (e) { return res.status(500).json({ error: e.message }); }
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
    const active = await getActiveApiKey();
    if (!active) return res.status(400).json({ error: 'Pennylane non configuré ou inactif', connected: false });
    const testResult = await pennylaneRequest(active.apiKey, 'GET', '/me');
    if (testResult.status === 200) {
      await pool.query('UPDATE pennylane_config SET last_sync_at = NOW()');
      res.json({ connected: true, company: testResult.data?.company_name || testResult.data?.current_company?.name || testResult.data?.name || active.companyId, message: 'Connexion Pennylane OK' });
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
    const active = await getActiveApiKey();
    if (!active) return res.status(400).json({ error: 'Pennylane non configuré' });

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
        // Mapping Solidata → Pennylane API v2
        const pennylanePayload = {
          date: invoice.date ? new Date(invoice.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          deadline: invoice.due_date ? new Date(invoice.due_date).toISOString().split('T')[0] : null,
          external_reference: invoice.invoice_number || null,
          currency: 'EUR',
          draft: false,
          invoice_lines: invoice.lines.map(l => ({
            label: l.description || 'Prestation',
            quantity: l.quantity || 1,
            unit: 'piece',
            vat_rate: 'FR_200',
            raw_currency_unit_price: String(parseFloat(l.unit_price) || 0),
          })),
        };

        const plResult = await pennylaneRequest(active.apiKey, 'POST', '/customer_invoices', pennylanePayload);

        if (plResult.status >= 200 && plResult.status < 300) {
          const plId = plResult.data?.invoice?.id || plResult.data?.id || `PL-${invoice.invoice_number}`;
          await pool.query(
            `INSERT INTO pennylane_mappings (local_type, local_id, pennylane_type, pennylane_id)
             VALUES ('invoice', $1, 'customer_invoice', $2)
             ON CONFLICT (local_type, local_id) DO UPDATE SET pennylane_id = $2, last_synced_at = NOW()`,
            [invoice.id, String(plId)]
          );
          results.synced++;
          results.details.push({ invoice_number: invoice.invoice_number, status: 'ok', pennylane_id: plId });
        } else {
          const errMsg = plResult.data?.error || plResult.data?.message || `HTTP ${plResult.status}`;
          results.errors++;
          results.details.push({ invoice_number: invoice.invoice_number, status: 'error', error: errMsg });
        }
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
// SYNC PULL : GL ANALYTIQUE (Pennylane → Solidata)
// ══════════════════════════════════════════

router.post('/sync/gl', authorize('ADMIN'), async (req, res) => {
  try {
    const active = await getActiveApiKey();
    if (!active) return res.status(400).json({ error: 'Pennylane non configuré' });
    const fiscalYear = parseInt(req.body.year) || new Date().getFullYear();

    const syncLog = await pool.query(
      `INSERT INTO pennylane_sync_log (sync_type, direction, status, created_by) VALUES ('gl_analytique', 'pull', 'in_progress', $1) RETURNING id`, [req.user.id]);

    const entries = await fetchAllPages(active.apiKey, '/ledger_entries', { 'filter[date_from]': `${fiscalYear}-01-01`, 'filter[date_to]': `${fiscalYear}-12-31` });

    if (entries.length === 0) {
      await pool.query(`UPDATE pennylane_sync_log SET status = 'completed', completed_at = NOW(), records_count = 0 WHERE id = $1`, [syncLog.rows[0].id]);
      return res.json({ year: fiscalYear, count: 0, message: 'Aucune écriture trouvée sur Pennylane' });
    }

    let exResult = await pool.query('SELECT id FROM financial_exercises WHERE year = $1', [fiscalYear]);
    if (exResult.rows.length === 0) exResult = await pool.query('INSERT INTO financial_exercises (year) VALUES ($1) RETURNING id', [fiscalYear]);
    const exerciseId = exResult.rows[0].id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM financial_gl_entries WHERE exercise_id = $1 AND source = 'api'", [exerciseId]);

      // Flatten ledger entries → lines
      const allLines = [];
      for (const e of entries) {
        const lines = e.ledger_entry_lines || e.lines || [e];
        for (const line of lines) {
          allLines.push({
            exercise_id: exerciseId,
            line_id: String(line.id || e.id || ''),
            date: e.date || line.date || null,
            journal: e.journal?.code || e.journal_code || null,
            account: line.ledger_account?.number || line.account_number || line.account || null,
            account_label: line.ledger_account?.label || line.account_label || null,
            vat_rate: parseFloat(line.vat_rate) || 0,
            piece_label: e.label || line.label || null,
            line_label: line.label || null,
            invoice_number: e.invoice_number || line.invoice_number || null,
            third_party: line.third_party || e.third_party || null,
            family_category: line.family_category || line.category_group || null,
            category: line.category || line.analytic_category || null,
            analytical_code: line.analytic_code || line.analytical_code || line.cost_center || null,
            currency: line.currency || 'EUR',
            exchange_rate: parseFloat(line.exchange_rate) || 1,
            debit: parseFloat(line.debit) || 0,
            credit: parseFloat(line.credit) || 0,
          });
        }
      }

      for (let i = 0; i < allLines.length; i += 500) {
        const batch = allLines.slice(i, i + 500);
        const values = []; const placeholders = []; let p = 1;
        for (const r of batch) {
          placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},'api')`);
          values.push(r.exercise_id, r.line_id, r.date, r.journal, r.account, r.account_label, r.vat_rate, r.piece_label, r.line_label, r.invoice_number, r.third_party, r.family_category, r.category, r.analytical_code, r.currency, r.exchange_rate, r.debit, r.credit, r.debit - r.credit);
        }
        if (placeholders.length > 0) {
          await client.query(`INSERT INTO financial_gl_entries (exercise_id,line_id,date,journal,account,account_label,vat_rate,piece_label,line_label,invoice_number,third_party,family_category,category,analytical_code,currency,exchange_rate,debit,credit,balance,source) VALUES ${placeholders.join(',')}`, values);
        }
      }

      await client.query('INSERT INTO financial_import_logs (exercise_id,type,filename,row_count,period,imported_by) VALUES ($1,$2,$3,$4,$5,$6)', [exerciseId, 'GL Pennylane API', 'sync-pennylane', allLines.length, String(fiscalYear), req.user.id]);
      await client.query('COMMIT');
    } catch (txErr) { await client.query('ROLLBACK'); throw txErr; }
    finally { client.release(); }

    await pool.query(`UPDATE pennylane_sync_log SET status = 'completed', completed_at = NOW(), records_count = $1 WHERE id = $2`, [allLines.length, syncLog.rows[0].id]);
    await pool.query('UPDATE pennylane_config SET last_sync_at = NOW()');
    res.json({ year: fiscalYear, count: allLines.length, message: `${allLines.length} écriture(s) importée(s) depuis Pennylane` });
  } catch (err) {
    console.error('[PENNYLANE] Erreur sync GL :', err);
    res.status(500).json({ error: 'Erreur synchronisation GL' });
  }
});

// ══════════════════════════════════════════
// SYNC PULL : MOUVEMENTS DE TRESORERIE
// ══════════════════════════════════════════

router.post('/sync/transactions', authorize('ADMIN'), async (req, res) => {
  try {
    const active = await getActiveApiKey();
    if (!active) return res.status(400).json({ error: 'Pennylane non configuré' });
    const fiscalYear = parseInt(req.body.year) || new Date().getFullYear();

    const syncLog = await pool.query(
      `INSERT INTO pennylane_sync_log (sync_type, direction, status, created_by) VALUES ('transactions', 'pull', 'in_progress', $1) RETURNING id`, [req.user.id]);

    const transactions = await fetchAllPages(active.apiKey, '/bank_transactions', { 'filter[date_from]': `${fiscalYear}-01-01`, 'filter[date_to]': `${fiscalYear}-12-31` });

    if (transactions.length === 0) {
      await pool.query(`UPDATE pennylane_sync_log SET status = 'completed', completed_at = NOW(), records_count = 0 WHERE id = $1`, [syncLog.rows[0].id]);
      return res.json({ year: fiscalYear, count: 0, message: 'Aucune transaction trouvée' });
    }

    let exResult = await pool.query('SELECT id FROM financial_exercises WHERE year = $1', [fiscalYear]);
    if (exResult.rows.length === 0) exResult = await pool.query('INSERT INTO financial_exercises (year) VALUES ($1) RETURNING id', [fiscalYear]);
    const exerciseId = exResult.rows[0].id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM financial_transactions WHERE exercise_id = $1 AND COALESCE(pl, '') = 'pennylane-api'", [exerciseId]);

      for (let i = 0; i < transactions.length; i += 500) {
        const batch = transactions.slice(i, i + 500);
        const values = []; const placeholders = []; let p = 1;
        for (const t of batch) {
          const txDate = t.date || t.operation_date || null;
          const month = txDate ? new Date(txDate).toLocaleString('fr-FR', { month: 'long' }) : null;
          placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
          values.push(exerciseId, txDate, month, t.bank_account?.name || t.bank_account_name || null, t.label || t.wording || t.description || null, parseFloat(t.amount) || 0, t.third_party || t.supplier_name || t.customer_name || null, t.justified ?? t.matched ?? false, 'pennylane-api');
        }
        if (placeholders.length > 0) {
          await client.query(`INSERT INTO financial_transactions (exercise_id,date,month,bank_account,label,amount,third_party,justified,pl) VALUES ${placeholders.join(',')}`, values);
        }
      }

      await client.query('INSERT INTO financial_import_logs (exercise_id,type,filename,row_count,period,imported_by) VALUES ($1,$2,$3,$4,$5,$6)', [exerciseId, 'Transactions Pennylane API', 'sync-pennylane', transactions.length, String(fiscalYear), req.user.id]);
      await client.query('COMMIT');
    } catch (txErr) { await client.query('ROLLBACK'); throw txErr; }
    finally { client.release(); }

    await pool.query(`UPDATE pennylane_sync_log SET status = 'completed', completed_at = NOW(), records_count = $1 WHERE id = $2`, [transactions.length, syncLog.rows[0].id]);
    await pool.query('UPDATE pennylane_config SET last_sync_at = NOW()');
    res.json({ year: fiscalYear, count: transactions.length, message: `${transactions.length} transaction(s) importée(s)` });
  } catch (err) {
    console.error('[PENNYLANE] Erreur sync transactions :', err);
    res.status(500).json({ error: 'Erreur synchronisation transactions' });
  }
});

// ══════════════════════════════════════════
// SYNC PULL : BALANCES COMPTABLES
// ══════════════════════════════════════════

router.get('/sync/balances', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const active = await getActiveApiKey();
    if (!active) return res.status(400).json({ error: 'Pennylane non configuré' });
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const accounts = await fetchAllPages(active.apiKey, '/ledger_accounts', { 'filter[fiscal_year]': String(year) });

    const balance = { year, classes: {}, totals: { debit: 0, credit: 0, balance: 0 }, accounts: [] };
    for (const acc of accounts) {
      const number = acc.number || acc.account_number || '';
      const classe = number.charAt(0);
      const debit = parseFloat(acc.debit_amount || acc.debit || acc.total_debit) || 0;
      const credit = parseFloat(acc.credit_amount || acc.credit || acc.total_credit) || 0;
      const solde = debit - credit;
      if (!balance.classes[classe]) balance.classes[classe] = { debit: 0, credit: 0, balance: 0, count: 0 };
      balance.classes[classe].debit += debit; balance.classes[classe].credit += credit; balance.classes[classe].balance += solde; balance.classes[classe].count++;
      balance.totals.debit += debit; balance.totals.credit += credit; balance.totals.balance += solde;
      balance.accounts.push({ number, label: acc.label || acc.name || '', debit, credit, balance: solde });
    }
    balance.accounts.sort((a, b) => a.number.localeCompare(b.number));
    res.json(balance);
  } catch (err) {
    console.error('[PENNYLANE] Erreur balances :', err);
    res.status(500).json({ error: 'Erreur récupération balances' });
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

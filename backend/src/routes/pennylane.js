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
// HELPERS
// ══════════════════════════════════════════

/**
 * Retourne la clé de chiffrement depuis l'environnement.
 * Lève une erreur si aucune clé n'est configurée (pas de fallback 'default-key').
 */
function getEncryptionKey() {
  const key = process.env.PENNYLANE_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!key) throw new Error('Clé de chiffrement non configurée (PENNYLANE_ENCRYPTION_KEY ou JWT_SECRET requis)');
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Déchiffre une clé API stockée au format iv_hex:encrypted_hex (AES-256-CBC, IV aléatoire).
 */
function decryptApiKey(encrypted) {
  const derivedKey = getEncryptionKey();
  const [ivHex, encryptedHex] = encrypted.split(':');
  if (!ivHex || !encryptedHex) throw new Error('Format de clé chiffrée invalide');
  const decipher = crypto.createDecipheriv('aes-256-cbc', derivedKey, Buffer.from(ivHex, 'hex'));
  return decipher.update(encryptedHex, 'hex', 'utf8') + decipher.final('utf8');
}

/**
 * Chiffre une clé API en AES-256-CBC avec IV aléatoire.
 * Retourne iv_hex:encrypted_hex.
 */
function encryptApiKey(plaintext) {
  const derivedKey = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', derivedKey, iv);
  const encrypted = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Effectue une requête HTTPS vers l'API Pennylane v2.
 * @param {string} method - GET, POST, PUT, DELETE
 * @param {string} path - chemin relatif (ex: '/me', '/customer_invoices')
 * @param {string} apiKey - bearer token
 * @param {object|null} body - corps JSON (pour POST/PUT)
 * @param {number} timeout - timeout en ms (défaut 15000)
 * @returns {Promise<{status: number, data: any}>}
 */
function pennylaneRequest(method, path, apiKey, body = null, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'app.pennylane.com',
      path: `/api/external/v2${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'X-Use-2026-API-Changes': 'true',
      },
      timeout,
    };
    if (postData) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }
    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try { resolve({ status: response.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: response.statusCode, data }); }
      });
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('Timeout Pennylane')); });
    if (postData) request.write(postData);
    request.end();
  });
}

/**
 * Récupère et déchiffre la clé API active depuis la BDD.
 * @returns {Promise<{apiKey: string, companyId: string}>}
 */
async function getActiveApiKey() {
  const config = await pool.query('SELECT api_key_encrypted, company_id FROM pennylane_config WHERE is_active = true LIMIT 1');
  if (config.rows.length === 0) throw Object.assign(new Error('Pennylane non configuré ou inactif'), { statusCode: 400 });
  if (!config.rows[0].api_key_encrypted) throw Object.assign(new Error('Clé API Pennylane absente'), { statusCode: 400 });
  const apiKey = decryptApiKey(config.rows[0].api_key_encrypted);
  return { apiKey, companyId: config.rows[0].company_id };
}

/**
 * Récupère toutes les pages d'un endpoint Pennylane paginé.
 * @param {string} path - chemin de base (ex: '/ledger_entries')
 * @param {string} apiKey - bearer token
 * @param {object} params - paramètres de query string supplémentaires
 * @returns {Promise<Array>} tous les éléments concaténés
 */
async function fetchAllPages(path, apiKey, params = {}) {
  const allItems = [];
  let cursor = null;
  const limit = 100;
  let pages = 0;
  while (true) {
    const qsParams = { ...params, limit: String(limit) };
    if (cursor) qsParams.cursor = cursor;
    const qs = new URLSearchParams(qsParams);
    const fullPath = `${path}?${qs.toString()}`;
    const result = await pennylaneRequest('GET', fullPath, apiKey);
    if (result.status !== 200) {
      throw new Error(`Erreur Pennylane API ${result.status} : ${JSON.stringify(result.data)}`);
    }
    // Pennylane v2 renvoie les données dans un champ selon l'endpoint
    const items = Array.isArray(result.data) ? result.data
      : result.data?.items || result.data?.ledger_entries || result.data?.ledger_entry_lines || result.data?.transactions || result.data?.ledger_accounts || result.data?.data || [];
    allItems.push(...items);
    // Pagination par curseur : continuer si has_more + next_cursor
    if (result.data?.has_more && result.data?.next_cursor) {
      cursor = result.data.next_cursor;
    } else {
      break;
    }
    pages++;
    if (pages > 200) break;
    // Rate limit Pennylane : 5 req/s
    await new Promise(r => setTimeout(r, 250));
  }
  return allItems;
}

/**
 * Enrichit les écritures GL en base avec les catégories analytiques Pennylane.
 * Pour chaque écriture API sans catégorie, appelle GET /ledger_entry_lines/{id}/categories
 * et met à jour family_category, category, analytical_code.
 * @param {number} exerciseId
 * @param {string} apiKey
 * @returns {Promise<number>} nombre de lignes enrichies
 */
async function enrichGLCategories(exerciseId, apiKey) {
  // Récupérer les lignes API sans catégorie qui ont un line_id Pennylane
  const lines = await pool.query(
    `SELECT id, line_id FROM financial_gl_entries
     WHERE exercise_id = $1 AND source = 'api' AND line_id IS NOT NULL
       AND (category IS NULL OR category = '')`,
    [exerciseId]
  );
  if (lines.rows.length === 0) return 0;

  console.log(`[PENNYLANE] Enrichissement catégories : ${lines.rows.length} lignes à traiter`);

  let enriched = 0;
  for (let i = 0; i < lines.rows.length; i++) {
    const row = lines.rows[i];
    try {
      const result = await pennylaneRequest('GET', `/ledger_entry_lines/${row.line_id}/categories`, apiKey);
      if (result.status !== 200 || !result.data) continue;

      const cats = Array.isArray(result.data) ? result.data : result.data?.categories || result.data?.items || [];
      if (cats.length === 0) continue;

      let category = null, familyCategory = null, analyticalCode = null;
      for (const cat of cats) {
        const group = (cat.group_name || cat.group_label || '').toLowerCase();
        const label = cat.label || cat.name || cat.code || null;
        if (!label) continue;
        if (group.includes('dépenses') || group.includes('depenses') || group.includes('revenus') || group.includes('catégorie') || group.includes('categorie')) {
          category = label;
        } else if (group.includes('famille')) {
          familyCategory = label;
        } else if (group.includes('analytique') || group.includes('analyse') || group.includes('cost') || group.includes('centre')) {
          analyticalCode = label;
        }
      }

      // Si aucune correspondance par group_name, utiliser le premier comme category
      if (!category && !familyCategory && !analyticalCode && cats.length > 0) {
        category = cats[0].label || cats[0].name || null;
      }

      if (category || familyCategory || analyticalCode) {
        const updates = [];
        const params = [];
        let idx = 1;
        if (category) { updates.push(`category = $${idx++}`); params.push(category); }
        if (familyCategory) { updates.push(`family_category = $${idx++}`); params.push(familyCategory); }
        if (analyticalCode) { updates.push(`analytical_code = COALESCE(analytical_code, $${idx++})`); params.push(analyticalCode); }
        params.push(row.id);
        await pool.query(`UPDATE financial_gl_entries SET ${updates.join(', ')} WHERE id = $${idx}`, params);
        enriched++;
      }
    } catch (err) {
      // Rate limit ou erreur réseau — continuer
      if (i > 0 && i % 100 === 0) console.log(`[PENNYLANE] Catégories : ${i}/${lines.rows.length} traitées, ${enriched} enrichies`);
    }
    // Rate limit Pennylane : 5 req/s
    await new Promise(r => setTimeout(r, 220));
  }

  console.log(`[PENNYLANE] Enrichissement terminé : ${enriched}/${lines.rows.length} lignes enrichies`);
  return enriched;
}

// ══════════════════════════════════════════
// AUTO-CREATE TABLES
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// MIDDLEWARE
// ══════════════════════════════════════════

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
      api_key_encrypted = encryptApiKey(api_key);
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
    if (err.message && err.message.includes('chiffrement')) {
      return res.status(500).json({ error: err.message });
    }
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// TEST CONNEXION
// ══════════════════════════════════════════

// POST /api/pennylane/test — Tester la connexion Pennylane
router.post('/test', authorize('ADMIN'), async (req, res) => {
  try {
    const { apiKey } = await getActiveApiKey();
    const testResult = await pennylaneRequest('GET', '/me', apiKey, null, 10000);

    if (testResult.status === 200) {
      await pool.query('UPDATE pennylane_config SET last_sync_at = NOW()');
      res.json({
        connected: true,
        company: testResult.data?.company_name || testResult.data?.current_company?.name || testResult.data?.name || 'Pennylane',
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
// SYNCHRONISATION — PUSH FACTURES
// ══════════════════════════════════════════

// POST /api/pennylane/sync/invoices — Synchroniser les factures vers Pennylane
router.post('/sync/invoices', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { apiKey } = await getActiveApiKey();

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

        const plResult = await pennylaneRequest('POST', '/customer_invoices', apiKey, pennylanePayload);

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
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur synchronisation' });
  }
});

// ══════════════════════════════════════════
// SYNCHRONISATION — PULL GL ANALYTIQUE
// ══════════════════════════════════════════

// POST /api/pennylane/sync/gl — Importer le Grand Livre analytique depuis Pennylane
router.post('/sync/gl', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { apiKey } = await getActiveApiKey();

    // Log de sync
    const syncLog = await pool.query(
      `INSERT INTO pennylane_sync_log (sync_type, direction, status, records_count, created_by)
       VALUES ('gl', 'pull', 'in_progress', 0, $1) RETURNING id`,
      [req.user.id]
    );

    // Récupérer les LIGNES comptables Pennylane filtrées par année
    // IMPORTANT : Pennylane v2 sépare les entrées (headers) des lignes (détails)
    // L'endpoint /ledger_entry_lines retourne directement les lignes avec comptes et montants
    const year = parseInt(req.body.year) || new Date().getFullYear();
    const filter = JSON.stringify([
      { field: 'date', operator: 'gteq', value: `${year}-01-01` },
      { field: 'date', operator: 'lteq', value: `${year}-12-31` },
    ]);

    const allLines = await fetchAllPages('/ledger_entry_lines', apiKey, { filter });

    // Capturer la structure brute pour diagnostic
    const sampleLine = allLines.length > 0 ? allLines[0] : null;
    const lineKeys = sampleLine ? Object.keys(sampleLine) : [];

    console.log('[PENNYLANE] Total lignes GL récupérées :', allLines.length);
    if (sampleLine) {
      console.log('[PENNYLANE] Structure première ligne GL :', JSON.stringify(sampleLine, null, 2));
      console.log('[PENNYLANE] Clés disponibles :', lineKeys.join(', '));
    }

    await client.query('BEGIN');

    const exResult = await client.query(
      `INSERT INTO financial_exercises (year, status) VALUES ($1, 'open')
       ON CONFLICT (year) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [year]
    );
    const exerciseId = exResult.rows[0].id;

    // Supprimer les anciennes entrées source='api' pour cet exercice (remplacement complet)
    await client.query(
      `DELETE FROM financial_gl_entries WHERE exercise_id = $1 AND source = 'api'`,
      [exerciseId]
    );

    // Insérer par batch de 500
    let inserted = 0;
    const batchSize = 500;
    for (let i = 0; i < allLines.length; i += batchSize) {
      const batch = allLines.slice(i, i + batchSize);
      const values = [];
      const placeholders = [];
      let paramIdx = 1;

      for (const line of batch) {
        const entryDate = line.date || null;

        // Pennylane v2 ledger_entry_lines : debit et credit sont des strings ("1000.00")
        const debit = parseFloat(line.debit) || 0;
        const credit = parseFloat(line.credit) || 0;
        const balance = debit - credit;

        // Pennylane v2 avec X-Use-2026-API-Changes : ledger_account est un objet { id, number, url }
        // Sans ce header : ledger_account_id est un entier
        const accountNumber = (line.ledger_account && line.ledger_account.number)
          || line.plan_item_number || line.account_number || line.account || null;
        const accountLabel = (line.ledger_account && (line.ledger_account.label || line.ledger_account.name))
          || line.account_name || line.account_label || null;

        // Journal : peut être un objet ou un string
        const journal = (typeof line.journal === 'object' && line.journal?.code)
          || line.journal_code || line.journal || null;

        // Axes analytiques Pennylane : catégorie et famille de catégories
        const category = line.category || line.expense_category || line.revenue_category || null;
        const familyCategory = line.family_category || line.category_family || line.family || null;

        placeholders.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
        values.push(
          exerciseId,
          line.id ? String(line.id) : null,
          entryDate,
          journal,
          accountNumber,
          accountLabel,
          line.label || null,
          line.document_label || line.description || null,
          line.invoice_number || line.document_number || null,
          line.third_party || line.third_party_name || line.thirdparty_name || null,
          familyCategory,
          category,
          line.analytical_reference || line.analytical_code || null,
          line.currency || 'EUR',
          debit,
          credit,
          balance,
          line.due_date || null,
          'api'
        );
      }

      if (placeholders.length > 0) {
        await client.query(
          `INSERT INTO financial_gl_entries
            (exercise_id, line_id, date, journal, account, account_label, piece_label, line_label, invoice_number, third_party, family_category, category, analytical_code, currency, debit, credit, balance, due_date, source)
           VALUES ${placeholders.join(', ')}`,
          values
        );
        inserted += batch.length;
      }
    }

    await client.query('COMMIT');

    // Mettre à jour le log de sync
    await pool.query(
      `UPDATE pennylane_sync_log SET status = 'completed', completed_at = NOW(), records_count = $1, details = $2 WHERE id = $3`,
      [inserted, JSON.stringify({ exercise_id: exerciseId, year, entries_imported: inserted }), syncLog.rows[0].id]
    );

    await pool.query('UPDATE pennylane_config SET last_sync_at = NOW()');

    // Phase 2 : Enrichir les lignes avec les catégories analytiques Pennylane
    let enrichedCount = 0;
    try {
      enrichedCount = await enrichGLCategories(exerciseId, apiKey);
    } catch (err) {
      console.error('[PENNYLANE] Erreur enrichissement catégories (non bloquant) :', err.message);
    }

    // Diagnostic : vérifier ce qui a été inséré
    const diag = await pool.query(`
      SELECT COUNT(*) as total,
        ROUND(SUM(debit)::numeric, 2) as sum_debit,
        ROUND(SUM(credit)::numeric, 2) as sum_credit,
        COUNT(CASE WHEN account LIKE '6%' THEN 1 END) as class6,
        COUNT(CASE WHEN account LIKE '7%' THEN 1 END) as class7,
        COUNT(CASE WHEN account IS NULL OR account = '' THEN 1 END) as no_account,
        COUNT(CASE WHEN category IS NOT NULL AND category != '' THEN 1 END) as with_category
      FROM financial_gl_entries WHERE exercise_id = $1 AND source = 'api'
    `, [exerciseId]);

    const diagData = diag.rows[0] || {};

    res.json({
      message: `Import GL terminé : ${inserted} écriture(s) importée(s), ${enrichedCount} enrichie(s) avec catégories analytiques pour l'exercice ${year}`,
      synced: inserted,
      enriched: enrichedCount,
      exercise_id: exerciseId,
      year,
      diagnostic: {
        en_base: diagData,
        total_lignes_pennylane: allLines.length,
        cles_ligne: lineKeys,
        exemple_ligne: sampleLine,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[PENNYLANE] Erreur sync GL :', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur import GL' });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════
// SYNCHRONISATION — PULL TRANSACTIONS BANCAIRES
// ══════════════════════════════════════════

// POST /api/pennylane/sync/transactions — Importer les transactions bancaires depuis Pennylane
router.post('/sync/transactions', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { apiKey } = await getActiveApiKey();

    // Log de sync
    const syncLog = await pool.query(
      `INSERT INTO pennylane_sync_log (sync_type, direction, status, records_count, created_by)
       VALUES ('transactions', 'pull', 'in_progress', 0, $1) RETURNING id`,
      [req.user.id]
    );

    // Récupérer les transactions bancaires filtrées par année
    const year = parseInt(req.body.year) || new Date().getFullYear();
    const filter = JSON.stringify([
      { field: 'date', operator: 'gteq', value: `${year}-01-01` },
      { field: 'date', operator: 'lteq', value: `${year}-12-31` },
    ]);
    const transactions = await fetchAllPages('/transactions', apiKey, { filter });
    await client.query('BEGIN');

    const exResult = await client.query(
      `INSERT INTO financial_exercises (year, status) VALUES ($1, 'open')
       ON CONFLICT (year) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [year]
    );
    const exerciseId = exResult.rows[0].id;

    // Supprimer les anciennes transactions importées par API pour cet exercice
    await client.query(
      `DELETE FROM financial_transactions WHERE exercise_id = $1 AND label LIKE '[API]%'`,
      [exerciseId]
    );

    // Insérer par batch de 500
    let inserted = 0;
    const batchSize = 500;
    const months = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

    for (let i = 0; i < transactions.length; i += batchSize) {
      const batch = transactions.slice(i, i + batchSize);
      const values = [];
      const placeholders = [];
      let paramIdx = 1;

      for (const tx of batch) {
        const txDate = tx.date || tx.operation_date || null;
        const txMonth = txDate ? months[new Date(txDate).getMonth()] : null;
        const amount = parseFloat(tx.amount) || parseFloat(tx.currency_amount) || 0;
        const label = `[API] ${tx.label || tx.wording || tx.description || ''}`;
        const bankAccount = tx.bank_account_name || tx.account_name || tx.source_account || null;
        const thirdParty = tx.third_party || tx.counterpart_name || null;
        const justified = tx.is_justified || tx.justified || false;

        placeholders.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
        values.push(
          exerciseId,
          txDate,
          txMonth,
          bankAccount,
          label,
          amount,
          thirdParty,
          justified
        );
      }

      if (placeholders.length > 0) {
        await client.query(
          `INSERT INTO financial_transactions
            (exercise_id, date, month, bank_account, label, amount, third_party, justified)
           VALUES ${placeholders.join(', ')}`,
          values
        );
        inserted += batch.length;
      }
    }

    await client.query('COMMIT');

    // Mettre à jour le log de sync
    await pool.query(
      `UPDATE pennylane_sync_log SET status = 'completed', completed_at = NOW(), records_count = $1, details = $2 WHERE id = $3`,
      [inserted, JSON.stringify({ exercise_id: exerciseId, year, transactions_imported: inserted }), syncLog.rows[0].id]
    );

    await pool.query('UPDATE pennylane_config SET last_sync_at = NOW()');

    res.json({
      message: `Import trésorerie terminé : ${inserted} transaction(s) importée(s) pour l'exercice ${year}`,
      synced: inserted,
      exercise_id: exerciseId,
      year,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[PENNYLANE] Erreur sync transactions :', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur import transactions' });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════
// SYNCHRONISATION — BALANCES COMPTABLES (lecture seule)
// ══════════════════════════════════════════

// GET /api/pennylane/sync/balances — Balance des comptes calculée depuis le GL importé en base
router.get('/sync/balances', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    // Calculer les balances depuis le GL importé en base (source fiable)
    const result = await pool.query(`
      SELECT g.account as account_number,
             MAX(g.account_label) as account_label,
             ROUND(SUM(g.debit)::numeric, 2) as debit,
             ROUND(SUM(g.credit)::numeric, 2) as credit,
             ROUND(SUM(g.debit - g.credit)::numeric, 2) as balance
      FROM financial_gl_entries g
      JOIN financial_exercises e ON g.exercise_id = e.id
      WHERE e.year = $1 AND g.account IS NOT NULL
      GROUP BY g.account
      ORDER BY g.account
    `, [year]);

    const balances = result.rows.map(acc => ({
      ...acc,
      debit: parseFloat(acc.debit) || 0,
      credit: parseFloat(acc.credit) || 0,
      balance: parseFloat(acc.balance) || 0,
      account_class: (acc.account_number || '').charAt(0),
    }));

    const totals = balances.reduce((t, b) => ({ debit: t.debit + b.debit, credit: t.credit + b.credit }), { debit: 0, credit: 0 });

    res.json({
      year,
      accounts: balances,
      total_accounts: balances.length,
      totals: { debit: Math.round(totals.debit * 100) / 100, credit: Math.round(totals.credit * 100) / 100, balance: Math.round((totals.debit - totals.credit) * 100) / 100 },
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[PENNYLANE] Erreur balances :', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur récupération balances' });
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

// ══════════════════════════════════════════
// MAPPINGS
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// STATUT GLOBAL
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// FONCTIONS DE SYNC RÉUTILISABLES (pour scheduler)
// ══════════════════════════════════════════

/**
 * Import automatique du Grand Livre depuis Pennylane.
 * Utilisable sans contexte HTTP (scheduler, cron).
 * @param {number} [year] - Année à importer (défaut : année courante)
 * @returns {Promise<{synced: number, year: number}>}
 */
async function syncGLAuto(year) {
  year = year || new Date().getFullYear();
  const { apiKey } = await getActiveApiKey();
  const client = await pool.connect();
  try {
    const syncLog = await pool.query(
      `INSERT INTO pennylane_sync_log (sync_type, direction, status, records_count)
       VALUES ('gl', 'pull', 'in_progress', 0) RETURNING id`
    );

    const filter = JSON.stringify([
      { field: 'date', operator: 'gteq', value: `${year}-01-01` },
      { field: 'date', operator: 'lteq', value: `${year}-12-31` },
    ]);
    const allLines = await fetchAllPages('/ledger_entry_lines', apiKey, { filter });

    await client.query('BEGIN');

    const exResult = await client.query(
      `INSERT INTO financial_exercises (year, status) VALUES ($1, 'open')
       ON CONFLICT (year) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [year]
    );
    const exerciseId = exResult.rows[0].id;

    await client.query(
      `DELETE FROM financial_gl_entries WHERE exercise_id = $1 AND source = 'api'`,
      [exerciseId]
    );

    let inserted = 0;
    const batchSize = 500;
    for (let i = 0; i < allLines.length; i += batchSize) {
      const batch = allLines.slice(i, i + batchSize);
      const values = [];
      const placeholders = [];
      let paramIdx = 1;

      for (const line of batch) {
        const debit = parseFloat(line.debit) || 0;
        const credit = parseFloat(line.credit) || 0;
        const accountNumber = (line.ledger_account && line.ledger_account.number)
          || line.plan_item_number || line.account_number || line.account || null;
        const accountLabel = (line.ledger_account && (line.ledger_account.label || line.ledger_account.name))
          || line.account_name || line.account_label || null;
        const journal = (typeof line.journal === 'object' && line.journal?.code)
          || line.journal_code || line.journal || null;

        // Axes analytiques Pennylane : catégorie et famille de catégories
        const category = line.category || line.expense_category || line.revenue_category || null;
        const familyCategory = line.family_category || line.category_family || line.family || null;

        placeholders.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
        values.push(
          exerciseId,
          line.id ? String(line.id) : null,
          line.date || null,
          journal,
          accountNumber,
          accountLabel,
          line.label || null,
          line.document_label || line.description || null,
          line.invoice_number || line.document_number || null,
          line.third_party || line.third_party_name || line.thirdparty_name || null,
          familyCategory,
          category,
          line.analytical_reference || line.analytical_code || null,
          line.currency || 'EUR',
          debit,
          credit,
          debit - credit,
          line.due_date || null,
          'api'
        );
      }

      if (placeholders.length > 0) {
        await client.query(
          `INSERT INTO financial_gl_entries
            (exercise_id, line_id, date, journal, account, account_label, piece_label, line_label, invoice_number, third_party, family_category, category, analytical_code, currency, debit, credit, balance, due_date, source)
           VALUES ${placeholders.join(', ')}`,
          values
        );
        inserted += batch.length;
      }
    }

    await client.query('COMMIT');

    await pool.query(
      `UPDATE pennylane_sync_log SET status = 'completed', completed_at = NOW(), records_count = $1, details = $2 WHERE id = $3`,
      [inserted, JSON.stringify({ exercise_id: exerciseId, year, entries_imported: inserted }), syncLog.rows[0].id]
    );
    await pool.query('UPDATE pennylane_config SET last_sync_at = NOW()');

    // Phase 2 : Enrichir les lignes avec les catégories analytiques
    let enrichedCount = 0;
    try {
      enrichedCount = await enrichGLCategories(exerciseId, apiKey);
      console.log(`[PENNYLANE] Auto sync GL : ${enrichedCount} lignes enrichies avec catégories`);
    } catch (err) {
      console.error('[PENNYLANE] Erreur enrichissement catégories auto (non bloquant) :', err.message);
    }

    return { synced: inserted, enriched: enrichedCount, year };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Import automatique des transactions bancaires depuis Pennylane.
 * @param {number} [year] - Année à importer (défaut : année courante)
 * @returns {Promise<{synced: number, year: number}>}
 */
async function syncTransactionsAuto(year) {
  year = year || new Date().getFullYear();
  const { apiKey } = await getActiveApiKey();
  const client = await pool.connect();
  try {
    const syncLog = await pool.query(
      `INSERT INTO pennylane_sync_log (sync_type, direction, status, records_count)
       VALUES ('transactions', 'pull', 'in_progress', 0) RETURNING id`
    );

    const filter = JSON.stringify([
      { field: 'date', operator: 'gteq', value: `${year}-01-01` },
      { field: 'date', operator: 'lteq', value: `${year}-12-31` },
    ]);
    const transactions = await fetchAllPages('/transactions', apiKey, { filter });

    await client.query('BEGIN');

    const exResult = await client.query(
      `INSERT INTO financial_exercises (year, status) VALUES ($1, 'open')
       ON CONFLICT (year) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [year]
    );
    const exerciseId = exResult.rows[0].id;

    await client.query(
      `DELETE FROM financial_transactions WHERE exercise_id = $1 AND label LIKE '[API]%'`,
      [exerciseId]
    );

    let inserted = 0;
    const batchSize = 500;
    const months = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

    for (let i = 0; i < transactions.length; i += batchSize) {
      const batch = transactions.slice(i, i + batchSize);
      const values = [];
      const placeholders = [];
      let paramIdx = 1;

      for (const tx of batch) {
        const txDate = tx.date || tx.operation_date || null;
        const txMonth = txDate ? months[new Date(txDate).getMonth()] : null;
        const amount = parseFloat(tx.amount) || parseFloat(tx.currency_amount) || 0;

        placeholders.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
        values.push(
          exerciseId,
          txDate,
          txMonth,
          tx.bank_account_name || tx.account_name || tx.source_account || null,
          `[API] ${tx.label || tx.wording || tx.description || ''}`,
          amount,
          tx.third_party || tx.counterpart_name || null,
          tx.is_justified || tx.justified || false
        );
      }

      if (placeholders.length > 0) {
        await client.query(
          `INSERT INTO financial_transactions
            (exercise_id, date, month, bank_account, label, amount, third_party, justified)
           VALUES ${placeholders.join(', ')}`,
          values
        );
        inserted += batch.length;
      }
    }

    await client.query('COMMIT');

    await pool.query(
      `UPDATE pennylane_sync_log SET status = 'completed', completed_at = NOW(), records_count = $1, details = $2 WHERE id = $3`,
      [inserted, JSON.stringify({ exercise_id: exerciseId, year, transactions_imported: inserted }), syncLog.rows[0].id]
    );
    await pool.query('UPDATE pennylane_config SET last_sync_at = NOW()');

    return { synced: inserted, year };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = router;
module.exports.syncGLAuto = syncGLAuto;
module.exports.syncTransactionsAuto = syncTransactionsAuto;

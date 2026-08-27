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
// Appel HTTP brut sans retry — utilisé en interne par pennylaneRequest()
function pennylaneRequestRaw(method, path, apiKey, body = null, timeout = 15000) {
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
        const headers = response.headers || {};
        try { resolve({ status: response.statusCode, headers, data: JSON.parse(data) }); }
        catch { resolve({ status: response.statusCode, headers, data }); }
      });
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('Timeout Pennylane')); });
    if (postData) request.write(postData);
    request.end();
  });
}

// Extrait le délai de retry à partir du body Pennylane ou du header Retry-After
function extractRetryAfterMs(result) {
  // 1) Header HTTP standard
  const ra = result?.headers?.['retry-after'];
  if (ra) {
    const sec = parseInt(ra, 10);
    if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, 30000);
  }
  // 2) Message dans le body : "retry in N seconds"
  const msg = typeof result?.data === 'string' ? result.data : (result?.data?.error || result?.data?.message || '');
  const m = String(msg).match(/retry\s+in\s+(\d+)\s+second/i);
  if (m) return Math.min(parseInt(m[1], 10) * 1000, 30000);
  return null;
}

// Wrapper avec retry automatique sur 429 (Rate limit exceeded).
// Respecte le délai indiqué par Pennylane (header ou body), sinon backoff
// exponentiel 1s → 2s → 4s → 8s → 16s. Max 5 retries.
async function pennylaneRequest(method, path, apiKey, body = null, timeout = 15000) {
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await pennylaneRequestRaw(method, path, apiKey, body, timeout);
    if (result.status !== 429 || attempt === MAX_RETRIES) {
      return result;
    }
    const hint = extractRetryAfterMs(result);
    const wait = hint != null ? hint + 250 : Math.min(1000 * Math.pow(2, attempt), 16000);
    console.warn(`[PENNYLANE] 429 reçu sur ${method} ${path} — retry dans ${wait}ms (tentative ${attempt + 1}/${MAX_RETRIES})`);
    await new Promise((r) => setTimeout(r, wait));
  }
  // unreachable
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
    // Throttle Pennylane : ~3 req/s (le 429 reste retry-é par pennylaneRequest)
    await new Promise(r => setTimeout(r, 350));
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
      // Erreur réseau (le 429 est désormais retry-é dans pennylaneRequest)
      if (i > 0 && i % 100 === 0) console.log(`[PENNYLANE] Catégories : ${i}/${lines.rows.length} traitées, ${enriched} enrichies`);
    }
    // Throttle Pennylane : ~3 req/s pour rester confortable sous la limite (était 220ms)
    await new Promise(r => setTimeout(r, 350));
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
    // Curseur DÉDIÉ à la synchronisation des factures clients. `init-db.js` pose
    // la même colonne, mais SEULEMENT si la table existe déjà : sur une base
    // NEUVE, `pennylane_config` naît ICI, au montage du routeur — donc APRÈS le
    // dernier passage d'init-db de la séquence de reconstruction. Sans cet
    // ALTER, la table de première installation n'aurait pas la colonne et
    // `syncCustomerInvoicesAuto` échouerait en 42703 jusqu'au déploiement
    // suivant. Idempotent : sur une base existante, la colonne est déjà là.
    await pool.query(`ALTER TABLE pennylane_config ADD COLUMN IF NOT EXISTS last_invoice_sync_at TIMESTAMP;`);
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
    // S'assurer que les colonnes analytiques existent dans financial_gl_entries
    // Whitelist stricte : nom colonne + type SQL internes, pas d'input externe.
    const SAFE_IDENT_PL = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    const SAFE_TYPE_PL = /^[A-Z0-9_() ]+$/i;
    const glCols = [['family_category', 'TEXT'], ['category', 'TEXT'], ['analytical_code', 'TEXT']];
    for (const [colName, colType] of glCols) {
      if (!SAFE_IDENT_PL.test(colName) || !SAFE_TYPE_PL.test(colType)) continue;
      try {
        await pool.query(`ALTER TABLE financial_gl_entries ADD COLUMN IF NOT EXISTS ${colName} ${colType}`);
      } catch (e) { /* colonne existe deja ou table absente — OK */ }
    }
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
router.get('/config', authorize('ADMIN', 'FINANCE'), async (req, res) => {
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
// SYNCHRONISATION — PULL FACTURES CLIENTS (V1.8+)
// L'outil ne génère pas de factures : il importe celles émises sur
// Pennylane et les rapproche des commandes_exutoires pour contrôle.
// ══════════════════════════════════════════

// Extrait la quantité totale d'une facture Pennylane (en tonnes par défaut)
// en sommant les invoice_lines. Conversion kg→t si l'unité ressemble à "kg".
function extractInvoiceQuantity(invoiceData) {
  const lines = invoiceData?.invoice_lines || invoiceData?.lines || [];
  if (!Array.isArray(lines) || lines.length === 0) return { qty: null, unit: 't' };
  let totalT = 0;
  for (const line of lines) {
    const qty = parseFloat(line.quantity ?? line.qty ?? 0) || 0;
    const unit = String(line.unit || line.unit_label || 't').toLowerCase();
    if (unit.includes('kg')) totalT += qty / 1000;
    else if (unit.includes('tonne') || unit === 't') totalT += qty;
    else totalT += qty; // Défaut : on suppose tonnes
  }
  return { qty: Math.round(totalT * 1000) / 1000, unit: 't' };
}

// Extrait les références de commande COMPLÈTES (format CMD-AAAA-NNNN) présentes
// dans les champs textuels d'une facture Pennylane. Fonction PURE (testable).
// On capture la référence entière — et pas seulement « CMD-AAAA » — pour ne pas
// rapprocher une commande arbitraire de l'année (item 34, Vague 1).
function extractCommandeReferences(invoiceData) {
  const fields = [
    invoiceData?.external_reference,
    invoiceData?.reference,
    invoiceData?.invoice_number,
    invoiceData?.label,
    invoiceData?.customer_reference,
    ...((invoiceData?.invoice_lines || invoiceData?.lines || [])
      .map((l) => l && (l.label || l.description)).filter(Boolean)),
  ].filter(Boolean).map(String);

  const refs = new Set();
  const re = /\bCMD-\d{4}-\d{1,8}\b/gi;
  for (const field of fields) {
    const matches = field.match(re);
    if (matches) for (const m of matches) refs.add(m.toUpperCase());
  }
  return Array.from(refs);
}

// Tente de retrouver LA commande_exutoires d'une facture par sa référence complète.
// Règle de fiabilité (item 34, Vague 1) : on ne rapproche/clôture AUTOMATIQUEMENT
// que si UNE SEULE commande correspond exactement à une référence extraite. En cas
// d'ambiguïté (aucune référence trouvée, ou plusieurs commandes candidates), on
// renvoie null → la facture reste « à rapprocher » et l'utilisateur tranche via le
// rapprochement manuel. Plus de LIKE '%CMD-AAAA%' LIMIT 1 sans ORDER BY.
async function autoMatchCommande(invoiceData) {
  const refs = extractCommandeReferences(invoiceData);
  if (refs.length === 0) return null;

  const r = await pool.query(
    `SELECT id, reference, statut FROM commandes_exutoires
     WHERE UPPER(reference) = ANY($1::text[])
       AND statut <> 'annulee'`,
    [refs]
  );
  // Match automatique uniquement si exactement une commande candidate.
  if (r.rows.length === 1) return r.rows[0];
  return null;
}

// Calcule + persiste l'écart pour une facture liée
async function recomputeFactureEcart(client, factureId) {
  const r = await client.query(
    `SELECT f.id, f.commande_id, f.quantite_facturee, f.montant_ht,
            cp.pesee_client AS pesee_client_t,
            c.tonnage_prevu, c.prix_tonne
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
  const peseeClientT = parseFloat(f.pesee_client_t) || null; // pesee_client est en tonnes (DECIMAL(10,3))
  const qtyFacturee = parseFloat(f.quantite_facturee) || null;
  let ecart = null;
  let ecartPct = null;
  if (peseeClientT != null && qtyFacturee != null) {
    ecart = Math.round((qtyFacturee - peseeClientT) * 1000) / 1000;
    ecartPct = peseeClientT > 0
      ? Math.round((ecart / peseeClientT) * 10000) / 100
      : null;
  }
  // Montant attendu : pesee_client × prix_tonne
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
  return { ecart, ecartPct, montantAttendu, ecartMontant };
}

// Import réutilisable des factures clients Pennylane (item 37, Vague 1).
// Utilisable sans contexte HTTP (scheduler). Incrémental : {since} explicite,
// sinon depuis last_sync_at, sinon 90 jours en arrière. Idempotent (skip / mise à
// jour sur pennylane_invoice_id). Renvoie le compte-rendu d'import.
/**
 * Lit le curseur DÉDIÉ des factures clients.
 *
 * CAUSE RACINE DU « 0 FACTURE REMONTÉE » (lot L7, contrat §8.3) : cette
 * fonction lisait `pennylane_config.last_sync_at`, colonne PARTAGÉE par le test
 * de connexion, la synchro du Grand Livre et celle des transactions — qui la
 * repoussent tous à `NOW()`. Le job GL tournant chaque jour, le curseur des
 * factures valait donc toujours « hier » : le bouton « Importer les factures »
 * ne demandait à Pennylane que les factures datées d'hier ou d'aujourd'hui, et
 * une facture émise la semaine précédente n'était JAMAIS vue. Aucune erreur
 * n'était levée — le compte-rendu affichait simplement « 0 importée(s) ».
 *
 * Correctif : colonne dédiée `last_invoice_sync_at`, que SEULE la synchro des
 * factures écrit. Repli 90 jours si elle est nulle (première synchro).
 * La colonne est récente : si la base n'est pas encore migrée, on retombe sur
 * le repli 90 jours plutôt que de faire échouer l'import.
 */
// Ne LÈVE JAMAIS : c'est une lecture informative. Un curseur illisible doit
// faire retomber la synchro sur son repli documenté (90 j) et laisser l'écran
// d'état s'afficher — pas transformer une page de statut en erreur 500. Le
// motif est toujours rendu dans `source`, donc rien n'est masqué.
async function lireCurseurFactures() {
  try {
    const cfg = await pool.query('SELECT last_invoice_sync_at FROM pennylane_config LIMIT 1');
    const brut = cfg?.rows?.[0]?.last_invoice_sync_at;
    if (!brut) return { date: null, source: 'aucun curseur — première synchronisation' };
    const d = new Date(brut);
    if (Number.isNaN(d.getTime())) return { date: null, source: 'curseur illisible' };
    return { date: d.toISOString().split('T')[0], source: 'dernière synchronisation des factures' };
  } catch (err) {
    if (err && err.code === '42703') {
      return { date: null, source: 'colonne last_invoice_sync_at absente (base non à jour)' };
    }
    console.warn('[PENNYLANE] Curseur des factures non lisible :', err.message);
    return { date: null, source: `curseur non lisible (${err.message})` };
  }
}

async function syncCustomerInvoicesAuto({ since, userId } = {}) {
  const { apiKey } = await getActiveApiKey();

  // Date de référence : {since} explicite prioritaire, sinon le curseur DÉDIÉ
  // aux factures, sinon 90 jours en arrière.
  const REPLI_JOURS = 90;
  const curseur = since ? { date: null, source: null } : await lireCurseurFactures();
  const sinceDate = since
    || curseur.date
    || new Date(Date.now() - REPLI_JOURS * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sinceSource = since
    ? 'période demandée'
    : (curseur.date ? curseur.source : `${curseur.source} → repli ${REPLI_JOURS} jours`);

  const syncLog = await pool.query(
    `INSERT INTO pennylane_sync_log (sync_type, direction, status, records_count, created_by)
     VALUES ('customer_invoices', 'pull', 'in_progress', 0, $1) RETURNING id`,
    [userId || null]
  );
  const syncLogId = syncLog.rows[0].id;
  try {
    const filter = JSON.stringify([
      { field: 'date', operator: 'gteq', value: sinceDate },
    ]);
    const allInvoices = await fetchAllPages('/customer_invoices', apiKey, { filter });

    const results = {
      imported: 0, updated: 0, matched: 0, unmatched: 0, errors: 0, details: [],
      // `recuperees` = ce que Pennylane a RÉELLEMENT renvoyé. Sans lui, « 0
      // importée(s) » ne distingue pas « Pennylane n'a rien renvoyé » de
      // « tout était déjà présent » : deux situations qui n'appellent pas du
      // tout la même action de l'utilisateur.
      recuperees: allInvoices.length,
      deja_presentes: 0,
    };
    const client = await pool.connect();
    try {
      for (const inv of allInvoices) {
        const invId = String(inv.id || inv.invoice_id || '');
        if (!invId) { results.errors++; continue; }
        try {
          await client.query('BEGIN');
          // Skip si déjà importée (basé sur pennylane_invoice_id)
          const existing = await client.query(
            'SELECT id, commande_id FROM factures_exutoires WHERE pennylane_invoice_id = $1 LIMIT 1',
            [invId]
          );

          // Extraction des champs Pennylane
          const number = inv.invoice_number || inv.number || inv.external_reference || `PL-${invId}`;
          const date = inv.date ? String(inv.date).slice(0, 10) : null;
          const customerId = String(inv.customer?.id || inv.customer_id || '');
          const customerName = inv.customer?.name || inv.customer_name || null;
          const externalRef = inv.external_reference || null;
          const montantHt = parseFloat(inv.amount_ht ?? inv.subtotal ?? inv.amount_excl_tax ?? 0) || null;
          const montantTtc = parseFloat(inv.amount_ttc ?? inv.total ?? inv.amount ?? 0) || null;
          const { qty: quantite, unit: unite } = extractInvoiceQuantity(inv);

          // Matching automatique sur libellé / external_reference
          const matched = await autoMatchCommande(inv);
          const commandeId = matched ? matched.id : null;

          if (existing.rows.length === 0) {
            const ins = await client.query(
              `INSERT INTO factures_exutoires (
                 commande_id, source, statut_facture,
                 pennylane_invoice_id, pennylane_invoice_number, pennylane_external_reference,
                 pennylane_customer_id, pennylane_customer_name, pennylane_data,
                 date_facture, montant_ht, montant_ttc,
                 quantite_facturee, unite_quantite,
                 rapprochement_mode
               ) VALUES (
                 $1, 'pennylane', $2,
                 $3, $4, $5,
                 $6, $7, $8,
                 $9, $10, $11,
                 $12, $13,
                 $14
               ) RETURNING id`,
              [
                commandeId,
                commandeId ? 'recue' : 'recue',
                invId, number, externalRef,
                customerId || null, customerName, JSON.stringify(inv),
                date, montantHt, montantTtc,
                quantite, unite,
                commandeId ? 'auto' : null,
              ]
            );
            const factureId = ins.rows[0].id;
            if (commandeId) {
              await recomputeFactureEcart(client, factureId);
              // Bascule statut commande → cloturee (Q5 : peu importe l'écart)
              await client.query(
                `UPDATE commandes_exutoires SET statut = 'cloturee', updated_at = NOW() WHERE id = $1`,
                [commandeId]
              );
              await client.query(
                `INSERT INTO historique_commandes_exutoires (commande_id, ancien_statut, nouveau_statut, commentaire)
                 VALUES ($1, NULL, 'cloturee', 'Facture Pennylane rapprochée automatiquement')`,
                [commandeId]
              );
              results.matched++;
            } else {
              results.unmatched++;
            }
            results.imported++;
            results.details.push({ id: factureId, number, status: commandeId ? 'matched' : 'unmatched' });
          } else {
            // Mettre à jour les champs si la facture existait déjà
            await client.query(
              `UPDATE factures_exutoires SET
                 pennylane_invoice_number = $1, pennylane_external_reference = $2,
                 pennylane_customer_name = $3, pennylane_data = $4,
                 date_facture = $5, montant_ht = $6, montant_ttc = $7,
                 quantite_facturee = $8, imported_at = NOW()
               WHERE pennylane_invoice_id = $9`,
              [number, externalRef, customerName, JSON.stringify(inv), date, montantHt, montantTtc, quantite, invId]
            );
            if (existing.rows[0].commande_id) {
              await recomputeFactureEcart(client, existing.rows[0].id);
            }
            results.updated++;
            results.deja_presentes++;
          }
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          console.error('[PENNYLANE] Erreur import facture', invId, err.message);
          results.errors++;
          results.details.push({ id: invId, status: 'error', error: err.message });
        }
      }
    } finally {
      client.release();
    }

    await pool.query(
      `UPDATE pennylane_sync_log
       SET status = $1, completed_at = NOW(), records_count = $2, details = $3
       WHERE id = $4`,
      [results.errors > 0 ? 'partial' : 'completed', results.imported + results.updated, JSON.stringify(results), syncLogId]
    );
    // ── Curseur ────────────────────────────────────────────────────────────
    // Curseur DÉDIÉ : on n'écrit surtout PAS `last_sync_at`, partagé avec le
    // Grand Livre et les transactions (c'est ce partage qui cassait l'import).
    //
    // ET ON NE L'AVANCE QU'EN CAS DE SUCCÈS COMPLET (correctif du 27/08).
    // L'avancer inconditionnellement reproduisait le défaut que ce lot répare,
    // simplement déplacé : la boucle ci-dessus fait un ROLLBACK par facture en
    // erreur, mais le curseur repartait quand même de NOW(). Une facture datée
    // d'avant et tombée en erreur n'était PLUS JAMAIS redemandée à Pennylane,
    // et la synchro suivante annonçait honnêtement « 0 récupérée » — exactement
    // le symptôme signalé par le client.
    //
    // Curseur figé = la période sera redemandée au prochain passage. Les
    // factures déjà importées y sont reconnues par `pennylane_invoice_id` et
    // simplement mises à jour : redemander ne coûte qu'un peu de réseau, alors
    // qu'avancer trop tôt perd une facture pour de bon.
    let curseurAvance = false;
    let curseurMotif = null;
    if (results.errors > 0) {
      curseurMotif = `${results.errors} facture(s) en erreur — la période sera redemandée au prochain passage`;
      console.warn(`[PENNYLANE] Curseur des factures NON avancé : ${curseurMotif}.`);
    } else {
      try {
        await pool.query('UPDATE pennylane_config SET last_invoice_sync_at = NOW()');
        curseurAvance = true;
      } catch (err) {
        if (err && err.code === '42703') {
          curseurMotif = 'colonne last_invoice_sync_at absente (base non à jour) — repli 90 jours au prochain passage';
          console.warn(`[PENNYLANE] ${curseurMotif}.`);
        } else { throw err; }
      }
    }

    const auJour = new Date().toISOString().split('T')[0];
    return {
      ...results,
      since: sinceDate,
      since_source: sinceSource,
      periode: { du: sinceDate, au: auJour },
      // Alias français du contrat §8.3, à côté des clés historiques
      // (`imported`/`matched`/`errors`) que consomment déjà les écrans en place.
      importees: results.imported,
      rapprochees: results.matched,
      erreurs: results.errors,
      // L'écran doit pouvoir dire à l'utilisateur que la période reste ouverte :
      // sans ça, il conclut d'un « 3 en erreur » qu'il a perdu 3 factures.
      curseur_avance: curseurAvance,
      curseur_motif: curseurMotif,
      syncLogId,
    };
  } catch (err) {
    try {
      await pool.query(`UPDATE pennylane_sync_log SET status = 'error', completed_at = NOW(), details = $1 WHERE id = $2`,
        [JSON.stringify({ error: err.message }), syncLogId]);
    } catch (_) { /* best-effort */ }
    console.error('[PENNYLANE] Erreur syncCustomerInvoicesAuto :', err);
    throw err;
  }
}

// POST /api/pennylane/sync/customer-invoices — Importer les factures clients
// émises sur Pennylane (incrémental : depuis last_sync_at). Rapproche + clôture
// automatiquement UNIQUEMENT si la référence de commande est sans ambiguïté.
router.post('/sync/customer-invoices', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const since = req.body?.since ? String(req.body.since).slice(0, 10) : undefined;
    if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
      return res.status(400).json({ error: 'Date de début invalide (format attendu AAAA-MM-JJ)', code: 'SINCE_INVALIDE' });
    }
    const results = await syncCustomerInvoicesAuto({ since, userId: req.user.id });

    // Message HONNÊTE : « 0 importée(s) » tout court laissait croire à une
    // panne alors que le cas le plus fréquent est « rien de neuf sur la
    // période ». On distingue donc les deux, et on dit d'où vient la période.
    const message = results.recuperees === 0
      ? `Aucune facture renvoyée par Pennylane sur la période du ${results.periode.du} au ${results.periode.au}.`
      : `Synchronisation terminée — ${results.recuperees} facture(s) reçue(s) de Pennylane : ${results.imported} importée(s), ${results.deja_presentes} déjà présente(s), ${results.matched} rapprochée(s) automatiquement, ${results.unmatched} à rapprocher manuellement, ${results.errors} erreur(s).`;
    res.json({ message, ...results });
  } catch (err) {
    console.error('[PENNYLANE] Erreur sync customer-invoices :', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Erreur synchronisation', code: 'SYNC_FACTURES_ECHEC' });
  }
});

// GET /api/pennylane/sync/diagnostic-invoices — Diagnostic de la remontée des
// factures clients (ADMIN, contrat §8.3, pattern « Diagnostic transaction » VAK).
//
// POURQUOI : la cause racine du « 0 facture » (curseur partagé, corrigée
// ci-dessus) est établie par lecture du code ; la piste « Pennylane ne renvoie
// pas les brouillons par défaut » ne peut PAS être tranchée hors production —
// il faut une vraie clé API et un vrai dossier comptable. Cet appel interroge
// donc l'API SANS AUCUN filtre de date, sur une page courte, et rend ce qu'il
// voit vraiment. Si la liste revient vide ici, le problème n'est plus chez nous.
//
// Aucun secret n'est renvoyé : ni la clé API, ni la charge Pennylane brute —
// seulement une liste blanche de champs par facture.
router.get('/sync/diagnostic-invoices', authorize('ADMIN'), async (req, res) => {
  const constate = {
    endpoint: 'GET /api/external/v2/customer_invoices',
    filtre_date: 'aucun (diagnostic)',
    entete_api: 'X-Use-2026-API-Changes: true',
  };
  try {
    const { apiKey } = await getActiveApiKey();

    // Page courte et SANS filtre : on veut savoir si l'API renvoie quoi que ce soit.
    const result = await pennylaneRequest('GET', '/customer_invoices?limit=20', apiKey);
    constate.statut_http = result.status;

    if (result.status !== 200) {
      const raison = result.status === 401 || result.status === 403
        ? "Clé API refusée par Pennylane (401/403) : vérifiez la clé et ses habilitations « customer_invoices »."
        : `Pennylane a répondu ${result.status}.`;
      await journaliserDiagnostic(req.user.id, { ...constate, raison }, 'error');
      return res.status(502).json({ error: raison, code: 'PENNYLANE_REFUS', ...constate });
    }

    const items = Array.isArray(result.data) ? result.data : (result.data?.items || result.data?.data || []);
    const totalEstime = Number.isFinite(Number(result.data?.total_count))
      ? Number(result.data.total_count)
      : (result.data?.has_more ? null : items.length);

    // Liste blanche stricte des champs exposés.
    const exemples = items.slice(0, 3).map((inv) => ({
      id: inv.id ?? null,
      invoice_number: inv.invoice_number ?? inv.number ?? null,
      date: inv.date ? String(inv.date).slice(0, 10) : null,
      status: inv.status ?? null,
      draft: inv.draft ?? null,
      amount: inv.amount ?? inv.currency_amount ?? null,
      customer: inv.customer?.name ?? inv.customer_name ?? null,
    }));

    let raison = null;
    if (items.length === 0) {
      // On ne tranche pas : on énumère ce qui reste possible, et on le dit.
      raison = "Pennylane n'a renvoyé AUCUNE facture, même sans filtre de date. "
        + "Trois causes possibles, à vérifier dans cet ordre : (1) le dossier comptable rattaché à cette clé API ne contient pas de facture CLIENT (les factures fournisseurs sont un autre endpoint) ; "
        + "(2) les factures existent mais sont à l'état BROUILLON — l'API v2 ne renvoie par défaut que les factures finalisées ; "
        + "(3) la clé API n'a pas l'habilitation de lecture des factures clients.";
    }

    const reponse = {
      ...constate,
      total_estime: totalEstime,
      total_estime_note: totalEstime == null ? "Pennylane n'expose pas de compteur total : d'autres pages existent." : null,
      recuperees_sur_cette_page: items.length,
      exemples,
      raison,
      curseur_factures: await lireCurseurFactures(),
    };
    await journaliserDiagnostic(req.user.id, reponse, items.length === 0 ? 'partial' : 'completed');
    res.json(reponse);
  } catch (err) {
    console.error('[PENNYLANE] Erreur diagnostic factures :', err);
    await journaliserDiagnostic(req.user?.id, { ...constate, erreur: err.message }, 'error');
    res.status(err.statusCode || 500).json({ error: err.message || 'Diagnostic impossible', code: 'DIAGNOSTIC_ECHEC', ...constate });
  }
});

// Trace le diagnostic dans pennylane_sync_log (best-effort : un journal
// indisponible ne doit jamais masquer le résultat du diagnostic).
async function journaliserDiagnostic(userId, details, statut) {
  try {
    await pool.query(
      `INSERT INTO pennylane_sync_log (sync_type, direction, status, records_count, details, completed_at, created_by)
       VALUES ('diagnostic_invoices', 'pull', $1, $2, $3, NOW(), $4)`,
      [statut, Number(details?.recuperees_sur_cette_page) || 0, JSON.stringify(details || {}), userId || null]
    );
  } catch (err) {
    console.warn('[PENNYLANE] Diagnostic non journalisé :', err.message);
  }
}

// ══════════════════════════════════════════
// CLIENTS DEPUIS PENNYLANE (lot L7, contrat §8.3) — PULL SEUL
// ──────────────────────────────────────────
// Le référentiel comptable fait foi côté Pennylane ; SOLIDATA l'importe et le
// rapproche, il ne le renvoie jamais (doctrine PULL-only du module 23).
// Aucune suppression, aucun écrasement d'un champ saisi dans l'ERP.
// ══════════════════════════════════════════

/**
 * Normalise une raison sociale pour le rapprochement : casse, accents,
 * ponctuation légère et espaces multiples neutralisés.
 * FONCTION PURE — la comparaison seule est normalisée, jamais l'affichage.
 */
function normaliserNomClient(nom) {
  if (nom == null) return '';
  return String(nom)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // accents (marques combinantes)
    .toUpperCase()
    .replace(/[’']/g, ' ')                        // apostrophes typographiques
    .replace(/[.,;:!?"()\[\]/\\-]/g, ' ')              // ponctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Projette un client Pennylane sur les colonnes de `clients_exutoires`.
 * FONCTION PURE (aucune E/S) — testée sans réseau ni base.
 *
 * DOCTRINE : une information absente reste VIDE, jamais devinée. Les colonnes
 * `adresse`/`code_postal`/`ville`/`contact_nom`/`contact_email` sont NOT NULL
 * dans le schéma : on y met la chaîne vide (« non renseigné »), qui se corrige
 * à l'écran — et surtout PAS une adresse ou un e-mail fabriqués.
 * Le code postal n'est retenu que s'il a bien 5 chiffres (la colonne est
 * VARCHAR(5) : tronquer un code étranger le rendrait FAUX au lieu d'absent) ;
 * le SIRET seulement s'il a 14 chiffres.
 */
function extraireClientPennylane(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id != null ? String(raw.id) : null;
  if (!id) return null;

  const adr = raw.billing_address || raw.address || raw.delivery_address || {};
  const nomComplet = [raw.first_name, raw.last_name].filter(Boolean).join(' ').trim();
  const nom = raw.name || raw.company_name || nomComplet || null;

  const emails = Array.isArray(raw.emails) ? raw.emails.filter(Boolean) : [];
  const email = raw.email || raw.billing_email || emails[0] || '';

  const cpBrut = String(adr.postal_code || raw.postal_code || '').trim();
  const codePostal = /^\d{5}$/.test(cpBrut) ? cpBrut : '';

  const siretBrut = String(raw.reg_no || raw.siret || raw.registration_number || '').replace(/\D/g, '');
  const siret = siretBrut.length === 14 ? siretBrut : null;

  return {
    pennylane_customer_id: id,
    nom,
    nom_normalise: normaliserNomClient(nom),
    siret,
    adresse: String(adr.address || adr.street || raw.address_line || '').trim(),
    code_postal: codePostal,
    code_postal_brut: cpBrut || null,
    ville: String(adr.city || raw.city || '').trim(),
    contact_nom: String(nomComplet || raw.contact_name || '').trim(),
    contact_email: String(email).trim().slice(0, 255),
    contact_telephone: String(raw.phone || raw.phone_number || '').trim().slice(0, 20) || null,
  };
}

/**
 * Récupère au plus `maxItems` clients Pennylane en suivant le curseur v2.
 * Le filtre/limite est renvoyé à CHAQUE page (exigence documentée de la
 * pagination par curseur Pennylane).
 */
async function fetchCustomersLimited(apiKey, maxItems) {
  const items = [];
  let cursor = null;
  let pages = 0;
  let hasMore = false;
  while (items.length < maxItems && pages < 50) {
    const qs = new URLSearchParams({ limit: String(Math.min(100, maxItems - items.length)) });
    if (cursor) qs.set('cursor', cursor);
    const result = await pennylaneRequest('GET', `/customers?${qs.toString()}`, apiKey);
    if (result.status !== 200) {
      throw Object.assign(
        new Error(`Pennylane a répondu ${result.status} sur /customers : ${typeof result.data === 'string' ? result.data.slice(0, 200) : JSON.stringify(result.data).slice(0, 200)}`),
        { statusCode: result.status === 401 || result.status === 403 ? 502 : 502 }
      );
    }
    const page = Array.isArray(result.data) ? result.data : (result.data?.items || result.data?.customers || result.data?.data || []);
    items.push(...page);
    hasMore = Boolean(result.data?.has_more && result.data?.next_cursor);
    if (!hasMore) break;
    cursor = result.data.next_cursor;
    pages++;
    await new Promise((r) => setTimeout(r, 350)); // throttle ~3 req/s
  }
  return { items: items.slice(0, maxItems), has_more: hasMore };
}

// GET /api/pennylane/customers?limit= — Prévisualisation (lecture seule).
// Renvoie ce que Pennylane expose ET le rapprochement PRÉVU avec l'ERP, pour
// que l'utilisateur voie ce qui sera créé avant de valider quoi que ce soit.
router.get('/customers', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const limitBrut = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitBrut) && limitBrut > 0 ? Math.min(limitBrut, 500) : 100;

    const { apiKey } = await getActiveApiKey();
    const { items, has_more } = await fetchCustomersLimited(apiKey, limit);
    const clients = items.map(extraireClientPennylane).filter(Boolean);

    const locaux = await chargerClientsLocaux();
    const apercu = clients.map((c) => {
      const decision = deciderRapprochement(c, locaux);
      return {
        pennylane_customer_id: c.pennylane_customer_id,
        nom: c.nom,
        ville: c.ville || null,
        code_postal: c.code_postal || null,
        siret: c.siret,
        operation: decision.operation,
        client_exutoire_id: decision.client?.id ?? null,
        client_exutoire_nom: decision.client?.raison_sociale ?? null,
        candidats: decision.candidats || null,
      };
    });

    res.json({
      recuperes: clients.length,
      has_more,
      limite_appliquee: limit,
      resume: {
        a_creer: apercu.filter((a) => a.operation === 'creer').length,
        a_relier: apercu.filter((a) => a.operation === 'relier').length,
        deja_lies: apercu.filter((a) => a.operation === 'inchange').length,
        ambigus: apercu.filter((a) => a.operation === 'ambigu').length,
      },
      clients: apercu,
    });
  } catch (err) {
    console.error('[PENNYLANE] Erreur lecture clients :', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Lecture des clients impossible', code: 'CLIENTS_LECTURE_ECHEC' });
  }
});

/** Charge le référentiel local (actifs ET inactifs : on ne recrée pas un client désactivé). */
async function chargerClientsLocaux() {
  const SQL = (avecPennylane) => `
    SELECT id, raison_sociale, siret, adresse, code_postal, ville,
           contact_nom, contact_email, contact_telephone, actif
           ${avecPennylane ? ', pennylane_customer_id, pennylane_customer_name' : ''}
      FROM clients_exutoires`;
  try {
    const r = await pool.query(SQL(true));
    return r.rows;
  } catch (err) {
    if (err && err.code === '42703') {
      const r = await pool.query(SQL(false));
      return r.rows.map((c) => ({ ...c, pennylane_customer_id: null, pennylane_customer_name: null }));
    }
    throw err;
  }
}

/**
 * Décide, pour UN client Pennylane, ce qu'il faut faire côté ERP. FONCTION PURE.
 * Cascade : identifiant Pennylane → nom normalisé → création.
 * Un nom qui rapproche PLUSIEURS clients est déclaré `ambigu` et n'est PAS
 * tranché au hasard : deux clients homonymes fusionnés silencieusement
 * mélangeraient leurs commandes et leurs factures.
 */
function deciderRapprochement(pennylaneClient, clientsLocaux) {
  if (!pennylaneClient) return { operation: 'ignore', motif: 'client Pennylane illisible' };

  const parId = clientsLocaux.find((c) => c.pennylane_customer_id && String(c.pennylane_customer_id) === pennylaneClient.pennylane_customer_id);
  if (parId) return { operation: 'inchange', client: parId, mode: 'identifiant Pennylane' };

  if (!pennylaneClient.nom_normalise) {
    return { operation: 'ignore', motif: 'client Pennylane sans raison sociale — non importable' };
  }

  const parNom = clientsLocaux.filter(
    (c) => !c.pennylane_customer_id && normaliserNomClient(c.raison_sociale) === pennylaneClient.nom_normalise
  );
  if (parNom.length === 1) return { operation: 'relier', client: parNom[0], mode: 'nom normalisé' };
  if (parNom.length > 1) {
    return {
      operation: 'ambigu',
      candidats: parNom.map((c) => ({ id: c.id, raison_sociale: c.raison_sociale, ville: c.ville })),
      motif: `${parNom.length} clients de l'ERP portent ce nom — rapprochement non tranché`,
    };
  }
  return { operation: 'creer' };
}

// POST /api/pennylane/customers/import — Import / rapprochement (jamais destructif).
router.post('/customers/import', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const syncLog = await pool.query(
    `INSERT INTO pennylane_sync_log (sync_type, direction, status, records_count, created_by)
     VALUES ('customers', 'pull', 'in_progress', 0, $1) RETURNING id`,
    [req.user.id]
  );
  const syncLogId = syncLog.rows[0].id;
  try {
    const limitBrut = parseInt(req.body?.limit, 10);
    const limit = Number.isFinite(limitBrut) && limitBrut > 0 ? Math.min(limitBrut, 1000) : 500;

    const { apiKey } = await getActiveApiKey();
    const { items, has_more } = await fetchCustomersLimited(apiKey, limit);
    const clients = items.map(extraireClientPennylane).filter(Boolean);
    const locaux = await chargerClientsLocaux();

    const bilan = { recuperes: clients.length, crees: 0, relies: 0, inchanges: 0, ignores: 0, erreurs: 0, ambigus: [], details: [], has_more };

    for (const c of clients) {
      const decision = deciderRapprochement(c, locaux);
      try {
        if (decision.operation === 'ambigu') {
          bilan.ambigus.push({ pennylane_customer_id: c.pennylane_customer_id, nom: c.nom, motif: decision.motif, candidats: decision.candidats });
          continue;
        }
        if (decision.operation === 'ignore') { bilan.ignores++; continue; }

        if (decision.operation === 'inchange') {
          // Le nom d'affichage Pennylane peut avoir changé : on le rafraîchit
          // (colonne miroir), sans jamais toucher à la raison sociale de l'ERP.
          await pool.query(
            'UPDATE clients_exutoires SET pennylane_customer_name = $1, updated_at = NOW() WHERE id = $2',
            [c.nom, decision.client.id]
          );
          bilan.inchanges++;
          continue;
        }

        if (decision.operation === 'relier') {
          // COALESCE/NULLIF : on ne comble QUE les champs vides de l'ERP.
          // Un contact saisi par un utilisateur n'est jamais écrasé par
          // l'annuaire comptable (pattern import Malibou).
          const maj = await pool.query(
            `UPDATE clients_exutoires SET
               pennylane_customer_id = $1,
               pennylane_customer_name = $2,
               siret             = COALESCE(NULLIF(siret, ''), $3),
               adresse           = COALESCE(NULLIF(adresse, ''), $4),
               code_postal       = COALESCE(NULLIF(code_postal, ''), $5),
               ville             = COALESCE(NULLIF(ville, ''), $6),
               contact_nom       = COALESCE(NULLIF(contact_nom, ''), $7),
               contact_email     = COALESCE(NULLIF(contact_email, ''), $8),
               contact_telephone = COALESCE(NULLIF(contact_telephone, ''), $9),
               updated_at = NOW()
             WHERE id = $10 RETURNING id, raison_sociale`,
            [c.pennylane_customer_id, c.nom, c.siret, c.adresse, c.code_postal, c.ville,
              c.contact_nom, c.contact_email, c.contact_telephone, decision.client.id]
          );
          decision.client.pennylane_customer_id = c.pennylane_customer_id;
          bilan.relies++;
          bilan.details.push({ operation: 'relie', id: maj.rows[0].id, nom: maj.rows[0].raison_sociale, pennylane_customer_id: c.pennylane_customer_id });
          continue;
        }

        // Création. `type_client` reste sur le défaut 'recycleur' du schéma :
        // Pennylane ne connaît pas cette nomenclature métier et la deviner
        // serait une valeur inventée — c'est à l'utilisateur de la qualifier.
        const ins = await pool.query(
          `INSERT INTO clients_exutoires
             (raison_sociale, siret, adresse, code_postal, ville, contact_nom, contact_email, contact_telephone,
              actif, pennylane_customer_id, pennylane_customer_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, $10)
           RETURNING id, raison_sociale`,
          [c.nom, c.siret, c.adresse, c.code_postal, c.ville, c.contact_nom, c.contact_email,
            c.contact_telephone, c.pennylane_customer_id, c.nom]
        );
        locaux.push({
          id: ins.rows[0].id, raison_sociale: c.nom, pennylane_customer_id: c.pennylane_customer_id,
          siret: c.siret, adresse: c.adresse, code_postal: c.code_postal, ville: c.ville,
          contact_nom: c.contact_nom, contact_email: c.contact_email, contact_telephone: c.contact_telephone, actif: true,
        });
        bilan.crees++;
        bilan.details.push({ operation: 'cree', id: ins.rows[0].id, nom: ins.rows[0].raison_sociale, pennylane_customer_id: c.pennylane_customer_id });
      } catch (err) {
        if (err && err.code === '42703') throw err; // base non migrée : échec global explicite
        bilan.erreurs++;
        bilan.details.push({ operation: 'erreur', nom: c.nom, pennylane_customer_id: c.pennylane_customer_id, erreur: err.message });
        console.error('[PENNYLANE] Import client en échec', c.pennylane_customer_id, err.message);
      }
    }

    await pool.query(
      `UPDATE pennylane_sync_log SET status = $1, completed_at = NOW(), records_count = $2, details = $3 WHERE id = $4`,
      [bilan.erreurs > 0 ? 'partial' : 'completed', bilan.crees + bilan.relies, JSON.stringify(bilan), syncLogId]
    );

    const message = bilan.recuperes === 0
      ? "Aucun client renvoyé par Pennylane — vérifiez que la clé API a bien l'habilitation « customers »."
      : `${bilan.recuperes} client(s) reçu(s) : ${bilan.crees} créé(s), ${bilan.relies} rapproché(s), ${bilan.inchanges} déjà lié(s), ${bilan.ambigus.length} ambigu(s) laissé(s) de côté, ${bilan.erreurs} erreur(s).`;
    res.json({ message, ...bilan });
  } catch (err) {
    try {
      await pool.query(`UPDATE pennylane_sync_log SET status = 'error', completed_at = NOW(), details = $1 WHERE id = $2`,
        [JSON.stringify({ error: err.message }), syncLogId]);
    } catch (_) { /* best-effort */ }
    console.error('[PENNYLANE] Erreur import clients :', err);
    if (err && err.code === '42703') {
      return res.status(503).json({
        error: "Import indisponible : la base n'est pas à jour (colonnes pennylane_customer_id / pennylane_customer_name absentes de clients_exutoires).",
        code: 'BASE_NON_MIGREE',
      });
    }
    res.status(err.statusCode || 500).json({ error: err.message || 'Import des clients impossible', code: 'CLIENTS_IMPORT_ECHEC' });
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

    // Phase 2 : Enrichir les lignes avec les catégories analytiques (en arrière-plan)
    // Ne pas bloquer la réponse HTTP — l'enrichissement peut prendre plusieurs minutes
    enrichGLCategories(exerciseId, apiKey).then(count => {
      console.log(`[PENNYLANE] Enrichissement catégories terminé : ${count} lignes`);
    }).catch(err => {
      console.error('[PENNYLANE] Erreur enrichissement catégories :', err.message);
    });

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
      message: `Import GL terminé : ${inserted} écriture(s) importée(s) pour l'exercice ${year}. Enrichissement catégories analytiques en cours en arrière-plan.`,
      synced: inserted,
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
router.get('/sync/balances', authorize('ADMIN', 'MANAGER', 'FINANCE'), async (req, res) => {
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
router.get('/sync/history', authorize('ADMIN', 'FINANCE'), async (req, res) => {
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
router.get('/status', authorize('ADMIN', 'MANAGER', 'FINANCE'), async (req, res) => {
  try {
    const config = await pool.query('SELECT is_active, last_sync_at, company_id FROM pennylane_config LIMIT 1');
    const mappingsCount = await pool.query('SELECT COUNT(*) as total FROM pennylane_mappings');
    const lastSync = await pool.query('SELECT * FROM pennylane_sync_log ORDER BY started_at DESC LIMIT 1');

    // Curseur DÉDIÉ aux factures, exposé À CÔTÉ de `last_sync` : ces deux dates
    // ne veulent pas dire la même chose, et les confondre est précisément le
    // défaut corrigé dans ce lot.
    const curseurFactures = await lireCurseurFactures();

    res.json({
      configured: config.rows.length > 0,
      active: config.rows[0]?.is_active || false,
      company_id: config.rows[0]?.company_id || null,
      last_sync: config.rows[0]?.last_sync_at || null,
      last_invoice_sync: curseurFactures.date,
      last_invoice_sync_source: curseurFactures.source,
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
module.exports.syncCustomerInvoicesAuto = syncCustomerInvoicesAuto;
module.exports.extractCommandeReferences = extractCommandeReferences;
module.exports.autoMatchCommande = autoMatchCommande;
// Helpers PURS du lot L7 (clients Pennylane) — exposés pour les tests unitaires :
// ils ne touchent ni le réseau ni la base.
module.exports.normaliserNomClient = normaliserNomClient;
module.exports.extraireClientPennylane = extraireClientPennylane;
module.exports.deciderRapprochement = deciderRapprochement;

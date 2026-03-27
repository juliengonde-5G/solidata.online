const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const multer = require('multer');
const ExcelJS = require('exceljs');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// ══════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════

function normalizeHeader(str) {
  return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const GL_COLUMN_MAP = {
  'identifiant de ligne': 'line_id', 'date': 'date', 'code journal': 'journal',
  'numero de compte': 'account', 'libelle de compte': 'account_label',
  'taux de tva du compte': 'vat_rate', 'libelle de piece': 'piece_label',
  'libelle de ligne': 'line_label', 'numero de facture': 'invoice_number',
  'tiers': 'third_party', 'famille de categories': 'family_category',
  'categorie': 'category', 'code analytique': 'analytical_code',
  'devise': 'currency', 'taux de change': 'exchange_rate',
  'debit': 'debit', 'credit': 'credit', 'solde': 'balance',
  "date d'echeance": 'due_date'
};

function parseExcelDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().split('T')[0];
  if (typeof v === 'number') {
    const d = new Date((v - 25569) * 86400000);
    return d.toISOString().split('T')[0];
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  const parts = s.split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  return null;
}

function parseNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/\s/g, '').replace(',', '.')) || 0;
}

async function getOrCreateExercise(year) {
  let r = await pool.query('SELECT id FROM financial_exercises WHERE year = $1', [year]);
  if (r.rows.length === 0) {
    r = await pool.query('INSERT INTO financial_exercises (year) VALUES ($1) RETURNING id', [year]);
  }
  return r.rows[0].id;
}

// ══════════════════════════════════════════
// EXERCISES
// ══════════════════════════════════════════

router.get('/exercises', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT e.*,
        (SELECT COUNT(*) FROM financial_gl_entries WHERE exercise_id = e.id) as gl_count,
        (SELECT COUNT(*) FROM financial_transactions WHERE exercise_id = e.id) as trans_count,
        (SELECT COUNT(*) FROM financial_budgets WHERE exercise_id = e.id) as budget_count
      FROM financial_exercises e ORDER BY e.year DESC
    `);
    res.json(r.rows);
  } catch (err) {
    console.error('[FINANCE] Erreur exercises :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// IMPORT GL
// ══════════════════════════════════════════

router.post('/import/gl', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier requis' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return res.status(400).json({ error: 'Feuille vide' });

    // Map headers
    const headerRow = sheet.getRow(1);
    const colMap = {};
    headerRow.eachCell((cell, colNumber) => {
      const normalized = normalizeHeader(cell.value);
      if (GL_COLUMN_MAP[normalized]) colMap[colNumber] = GL_COLUMN_MAP[normalized];
    });

    if (!colMap || Object.keys(colMap).length < 5) {
      return res.status(400).json({ error: 'Format de fichier non reconnu. Colonnes attendues: GL analytique Pennylane.' });
    }

    // Parse rows
    const rows = [];
    let detectedYear = null;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const entry = {};
      for (const [col, field] of Object.entries(colMap)) {
        entry[field] = row.getCell(parseInt(col)).value;
      }
      // Parse types
      entry.date = parseExcelDate(entry.date);
      entry.due_date = parseExcelDate(entry.due_date);
      entry.debit = parseNum(entry.debit);
      entry.credit = parseNum(entry.credit);
      entry.balance = parseNum(entry.balance);
      entry.vat_rate = parseNum(entry.vat_rate);
      entry.exchange_rate = parseNum(entry.exchange_rate) || 1;
      entry.line_id = entry.line_id ? String(entry.line_id) : null;
      entry.account = entry.account ? String(entry.account) : null;

      if (entry.date && !detectedYear) {
        detectedYear = parseInt(entry.date.substring(0, 4));
      }
      if (entry.account) rows.push(entry);
    });

    if (rows.length === 0) return res.status(400).json({ error: 'Aucune ecriture trouvee' });
    if (!detectedYear) detectedYear = new Date().getFullYear();

    const exerciseId = await getOrCreateExercise(detectedYear);

    // Delete existing entries for this year then insert
    await pool.query('DELETE FROM financial_gl_entries WHERE exercise_id = $1', [exerciseId]);

    // Batch insert
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const values = [];
      const placeholders = [];
      let paramIdx = 1;

      for (const r of batch) {
        placeholders.push(`($${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++},$${paramIdx++})`);
        values.push(exerciseId, r.line_id, r.date, r.journal, r.account, r.account_label,
          r.vat_rate, r.piece_label, r.line_label, r.invoice_number, r.third_party,
          r.family_category, r.category, r.analytical_code, r.currency || 'EUR',
          r.exchange_rate, r.debit, r.credit, r.balance);
      }

      await pool.query(`INSERT INTO financial_gl_entries
        (exercise_id, line_id, date, journal, account, account_label, vat_rate, piece_label,
         line_label, invoice_number, third_party, family_category, category, analytical_code,
         currency, exchange_rate, debit, credit, balance)
        VALUES ${placeholders.join(',')}`, values);
    }

    // Log import
    await pool.query(
      'INSERT INTO financial_import_logs (exercise_id, type, filename, row_count, period, imported_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [exerciseId, 'Grand Livre', req.file.originalname, rows.length, String(detectedYear), req.user.id]
    );

    res.json({ year: detectedYear, count: rows.length, exerciseId });
  } catch (err) {
    console.error('[FINANCE] Erreur import GL :', err);
    res.status(500).json({ error: 'Erreur import: ' + err.message });
  }
});

// ══════════════════════════════════════════
// IMPORT TRANSACTIONS
// ══════════════════════════════════════════

router.post('/import/transactions', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier requis' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];
    const headerRow = sheet.getRow(1);

    const TRANS_MAP = { 'date': 'date', 'mois': 'month', 'compte bancaire': 'bank_account',
      'libelle': 'label', 'montant': 'amount', 'tiers': 'third_party',
      'justifie': 'justified', 'p&l': 'pl', 'tresorerie': 'tresorerie' };

    const colMap = {};
    headerRow.eachCell((cell, colNumber) => {
      const n = normalizeHeader(cell.value);
      if (TRANS_MAP[n]) colMap[colNumber] = TRANS_MAP[n];
    });

    const rows = [];
    let detectedYear = null;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const entry = {};
      for (const [col, field] of Object.entries(colMap)) {
        entry[field] = row.getCell(parseInt(col)).value;
      }
      entry.date = parseExcelDate(entry.date);
      entry.amount = parseNum(entry.amount);
      entry.justified = entry.justified === true || entry.justified === 'Oui' || entry.justified === 'oui';
      if (entry.date && !detectedYear) detectedYear = parseInt(entry.date.substring(0, 4));
      rows.push(entry);
    });

    if (!detectedYear) detectedYear = new Date().getFullYear();
    const exerciseId = await getOrCreateExercise(detectedYear);
    await pool.query('DELETE FROM financial_transactions WHERE exercise_id = $1', [exerciseId]);

    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const values = [];
      const placeholders = [];
      let p = 1;
      for (const r of batch) {
        placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
        values.push(exerciseId, r.date, r.month, r.bank_account, r.label, r.amount, r.third_party, r.justified, r.pl);
      }
      await pool.query(`INSERT INTO financial_transactions (exercise_id, date, month, bank_account, label, amount, third_party, justified, pl) VALUES ${placeholders.join(',')}`, values);
    }

    await pool.query('INSERT INTO financial_import_logs (exercise_id, type, filename, row_count, period, imported_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [exerciseId, 'Transactions', req.file.originalname, rows.length, String(detectedYear), req.user.id]);

    res.json({ year: detectedYear, count: rows.length });
  } catch (err) {
    console.error('[FINANCE] Erreur import transactions :', err);
    res.status(500).json({ error: 'Erreur: ' + err.message });
  }
});

// ══════════════════════════════════════════
// IMPORT BUDGET
// ══════════════════════════════════════════

router.post('/import/budget', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier requis' });
    const year = parseInt(req.body.year) || new Date().getFullYear();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];

    const exerciseId = await getOrCreateExercise(year);
    await pool.query('DELETE FROM financial_budgets WHERE exercise_id = $1', [exerciseId]);

    const MONTHS = ['jan','fev','mar','avr','mai','jun','jul','aou','sep','oct','nov','dec'];
    const headerRow = sheet.getRow(1);
    const monthCols = {};
    headerRow.eachCell((cell, colNumber) => {
      const n = normalizeHeader(cell.value);
      const idx = MONTHS.findIndex(m => n.startsWith(m));
      if (idx >= 0) monthCols[colNumber] = idx;
    });

    let catCol = null;
    headerRow.eachCell((cell, colNumber) => {
      const n = normalizeHeader(cell.value);
      if (n.includes('categorie') || n.includes('type') || n.includes('poste')) catCol = colNumber;
    });
    if (!catCol) catCol = 1;

    let count = 0;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const category = row.getCell(catCol).value;
      if (!category) return;

      for (const [col, month] of Object.entries(monthCols)) {
        const amount = parseNum(row.getCell(parseInt(col)).value);
        if (amount !== 0) {
          pool.query(
            'INSERT INTO financial_budgets (exercise_id, category, month, amount, created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (exercise_id, category, month) DO UPDATE SET amount = $4',
            [exerciseId, String(category).trim(), month, amount, req.user.id]
          );
          count++;
        }
      }
    });

    await pool.query('INSERT INTO financial_import_logs (exercise_id, type, filename, row_count, period, imported_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [exerciseId, 'Budget', req.file.originalname, count, String(year), req.user.id]);

    res.json({ year, count });
  } catch (err) {
    console.error('[FINANCE] Erreur import budget :', err);
    res.status(500).json({ error: 'Erreur: ' + err.message });
  }
});

// ══════════════════════════════════════════
// GL ENTRIES (READ)
// ══════════════════════════════════════════

router.get('/gl/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const { account, family_category, category, analytical_code, limit: lim, offset: off } = req.query;

    let query = 'SELECT g.* FROM financial_gl_entries g JOIN financial_exercises e ON g.exercise_id = e.id WHERE e.year = $1';
    const params = [year];

    if (account) { params.push(account + '%'); query += ` AND g.account LIKE $${params.length}`; }
    if (family_category) { params.push(family_category); query += ` AND g.family_category = $${params.length}`; }
    if (category) { params.push(category); query += ` AND g.category = $${params.length}`; }
    if (analytical_code) { params.push(analytical_code); query += ` AND g.analytical_code = $${params.length}`; }

    query += ' ORDER BY g.date, g.id';
    if (lim) { params.push(parseInt(lim)); query += ` LIMIT $${params.length}`; }
    if (off) { params.push(parseInt(off)); query += ` OFFSET $${params.length}`; }

    const r = await pool.query(query, params);
    res.json(r.rows);
  } catch (err) {
    console.error('[FINANCE] Erreur GL :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// BUDGET (READ/WRITE)
// ══════════════════════════════════════════

router.get('/budget/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const r = await pool.query(`
      SELECT b.* FROM financial_budgets b
      JOIN financial_exercises e ON b.exercise_id = e.id
      WHERE e.year = $1 ORDER BY b.category, b.month
    `, [year]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/budget/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const { category, month, amount } = req.body;
    const exerciseId = await getOrCreateExercise(year);
    await pool.query(
      'INSERT INTO financial_budgets (exercise_id, category, month, amount, created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (exercise_id, category, month) DO UPDATE SET amount = $4, updated_at = NOW()',
      [exerciseId, category, month, amount, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// OPERATIONAL DATA
// ══════════════════════════════════════════

router.get('/operations/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const r = await pool.query(`
      SELECT o.* FROM financial_operational_data o
      JOIN financial_exercises e ON o.exercise_id = e.id
      WHERE e.year = $1 ORDER BY o.field_id, o.month
    `, [year]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/operations/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const { data } = req.body; // [{ field_id, month, value }]
    const exerciseId = await getOrCreateExercise(year);

    for (const item of data) {
      await pool.query(
        `INSERT INTO financial_operational_data (exercise_id, field_id, month, value, source, updated_by)
         VALUES ($1,$2,$3,$4,'manual',$5)
         ON CONFLICT (exercise_id, field_id, month) DO UPDATE SET value = $4, source = 'manual', updated_by = $5, updated_at = NOW()`,
        [exerciseId, item.field_id, item.month, item.value, req.user.id]
      );
    }
    res.json({ ok: true, count: data.length });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Auto-populated data from solidata tables
router.get('/operations/:year/auto', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const auto = {};

    // Tonnes collectees par mois (from tours)
    const tours = await pool.query(`
      SELECT EXTRACT(MONTH FROM date)::int - 1 as month, SUM(total_weight_kg) / 1000.0 as tonnes
      FROM tours WHERE EXTRACT(YEAR FROM date) = $1 AND status = 'completed'
      GROUP BY EXTRACT(MONTH FROM date) ORDER BY month
    `, [year]);
    auto.tonnes_collectees = {};
    for (const r of tours.rows) auto.tonnes_collectees[r.month] = parseFloat(r.tonnes) || 0;

    // Tonnes au tri par mois (from production_daily)
    const prod = await pool.query(`
      SELECT EXTRACT(MONTH FROM date)::int - 1 as month, SUM(entree_ligne_kg) / 1000.0 as tonnes
      FROM production_daily WHERE EXTRACT(YEAR FROM date) = $1
      GROUP BY EXTRACT(MONTH FROM date) ORDER BY month
    `, [year]);
    auto.tonnes_au_tri = {};
    for (const r of prod.rows) auto.tonnes_au_tri[r.month] = parseFloat(r.tonnes) || 0;

    // ETP collecte (employees in collecte team)
    const etpColl = await pool.query(`
      SELECT COUNT(*) as count FROM employees e
      JOIN teams t ON e.team_id = t.id
      WHERE t.type = 'collecte' AND e.status = 'active'
    `);
    auto.etp_collecte = parseInt(etpColl.rows[0].count) || 0;

    // ETP tri
    const etpTri = await pool.query(`
      SELECT COUNT(*) as count FROM employees e
      JOIN teams t ON e.team_id = t.id
      WHERE t.type = 'tri' AND e.status = 'active'
    `);
    auto.etp_tri = parseInt(etpTri.rows[0].count) || 0;

    // Vehicules actifs
    const vehi = await pool.query(`SELECT COUNT(*) as count FROM vehicles WHERE status != 'out_of_service'`);
    auto.nb_vehicules = parseInt(vehi.rows[0].count) || 0;

    // Points de collecte actifs
    const cav = await pool.query(`SELECT COUNT(*) as count FROM cav WHERE status = 'active'`);
    auto.nb_points_collecte = parseInt(cav.rows[0].count) || 0;

    res.json(auto);
  } catch (err) {
    console.error('[FINANCE] Erreur ops auto :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// KPIs
// ══════════════════════════════════════════

router.get('/kpis/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year);

    // Revenue & charges from GL
    const gl = await pool.query(`
      SELECT
        SUM(CASE WHEN g.account LIKE '7%' THEN g.credit - g.debit ELSE 0 END) as produits,
        SUM(CASE WHEN g.account LIKE '6%' THEN g.debit - g.credit ELSE 0 END) as charges,
        SUM(CASE WHEN g.account LIKE '512%' THEN g.debit - g.credit ELSE 0 END) as tresorerie,
        SUM(CASE WHEN g.account LIKE '411%' THEN g.debit - g.credit ELSE 0 END) as clients,
        SUM(CASE WHEN g.account LIKE '401%' THEN g.credit - g.debit ELSE 0 END) as fournisseurs,
        SUM(CASE WHEN g.account LIKE '43%' THEN g.credit - g.debit ELSE 0 END) as social
      FROM financial_gl_entries g
      JOIN financial_exercises e ON g.exercise_id = e.id
      WHERE e.year = $1
    `, [year]);

    const d = gl.rows[0] || {};
    const produits = parseFloat(d.produits) || 0;
    const charges = parseFloat(d.charges) || 0;
    const tresorerie = parseFloat(d.tresorerie) || 0;
    const clients = parseFloat(d.clients) || 0;
    const fournisseurs = parseFloat(d.fournisseurs) || 0;
    const social = parseFloat(d.social) || 0;
    const bfr = clients - fournisseurs - social;

    // Charges by centre P&L
    const centres = await pool.query(`
      SELECT g.category as centre,
        SUM(CASE WHEN g.account LIKE '6%' THEN g.debit - g.credit ELSE 0 END) as charges,
        SUM(CASE WHEN g.account LIKE '7%' THEN g.credit - g.debit ELSE 0 END) as produits
      FROM financial_gl_entries g
      JOIN financial_exercises e ON g.exercise_id = e.id
      WHERE e.year = $1 AND g.family_category = 'Centre P&L'
      GROUP BY g.category
    `, [year]);

    // Ops data for cost/tonne
    const ops = await pool.query(`
      SELECT field_id, SUM(value) as total
      FROM financial_operational_data o
      JOIN financial_exercises e ON o.exercise_id = e.id
      WHERE e.year = $1
      GROUP BY field_id
    `, [year]);

    const opsMap = {};
    for (const r of ops.rows) opsMap[r.field_id] = parseFloat(r.total) || 0;

    const tonnesCollectees = opsMap.tonnes_collectees || 0;
    const tonnesAuTri = opsMap.tonnes_au_tri || 0;

    // Find centre charges
    const centreMap = {};
    for (const r of centres.rows) centreMap[r.centre] = { charges: parseFloat(r.charges) || 0, produits: parseFloat(r.produits) || 0 };

    const chargesCollecte = (centreMap['Collecte & Original'] || {}).charges || 0;
    const chargesTri = (centreMap['Tri & Recyclage - 2nde main'] || {}).charges || 0;
    const chargesFG = (centreMap['Frais Generaux'] || centreMap['Frais G\u00e9n\u00e9raux'] || {}).charges || 0;

    const ratioTri = tonnesCollectees > 0 ? tonnesAuTri / tonnesCollectees : 0;
    const fgCollecte = chargesFG * (1 - ratioTri);
    const fgTri = chargesFG * ratioTri;
    const coutCompletCollecte = chargesCollecte + fgCollecte;
    const coutTonneCollecte = tonnesCollectees > 0 ? coutCompletCollecte / tonnesCollectees : 0;
    const transfertInterne = coutTonneCollecte * tonnesAuTri;
    const coutCompletTri = chargesTri + fgTri + transfertInterne;
    const coutTonneTri = tonnesAuTri > 0 ? coutCompletTri / tonnesAuTri : 0;

    // Monthly data for charts
    const monthly = await pool.query(`
      SELECT EXTRACT(MONTH FROM g.date)::int - 1 as month,
        SUM(CASE WHEN g.account LIKE '7%' THEN g.credit - g.debit ELSE 0 END) as produits,
        SUM(CASE WHEN g.account LIKE '6%' THEN g.debit - g.credit ELSE 0 END) as charges,
        SUM(CASE WHEN g.account LIKE '512%' THEN g.debit - g.credit ELSE 0 END) as tresorerie
      FROM financial_gl_entries g
      JOIN financial_exercises e ON g.exercise_id = e.id
      WHERE e.year = $1
      GROUP BY EXTRACT(MONTH FROM g.date)
      ORDER BY month
    `, [year]);

    res.json({
      produits, charges, resultat: produits - charges,
      tresorerie, bfr, clients, fournisseurs, social,
      coutTonneCollecte, coutTonneTri,
      tonnesCollectees, tonnesAuTri,
      chargesCollecte, chargesTri, chargesFG,
      fgCollecte, fgTri, transfertInterne,
      coutCompletCollecte, coutCompletTri,
      centres: centreMap,
      monthly: monthly.rows,
      marge: produits - charges
    });
  } catch (err) {
    console.error('[FINANCE] Erreur KPIs :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// CONTROLS
// ══════════════════════════════════════════

router.get('/controls/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const checks = [];

    const gl = await pool.query(`
      SELECT COUNT(*) as total,
        SUM(debit) as total_debit, SUM(credit) as total_credit,
        SUM(CASE WHEN family_category IS NULL OR family_category = '' THEN 1 ELSE 0 END) as no_family,
        SUM(CASE WHEN (account LIKE '6%' OR account LIKE '7%') AND (analytical_code IS NULL OR analytical_code = '') THEN 1 ELSE 0 END) as no_analytical,
        SUM(CASE WHEN account LIKE '6%' OR account LIKE '7%' THEN 1 ELSE 0 END) as pl_total
      FROM financial_gl_entries g
      JOIN financial_exercises e ON g.exercise_id = e.id
      WHERE e.year = $1
    `, [year]);

    const d = gl.rows[0] || {};
    const total = parseInt(d.total) || 0;
    const totalDebit = parseFloat(d.total_debit) || 0;
    const totalCredit = parseFloat(d.total_credit) || 0;
    const ecart = Math.abs(totalDebit - totalCredit);

    checks.push({ id: 'equilibre', name: 'Equilibre debit/credit', status: ecart < 1 ? 'green' : ecart < 100 ? 'orange' : 'red',
      desc: ecart < 1 ? 'Parfait equilibre' : 'Ecart: ' + ecart.toFixed(2) + ' EUR',
      values: { debit: totalDebit, credit: totalCredit, ecart } });

    const noFamily = parseInt(d.no_family) || 0;
    const pctNoFamily = total > 0 ? noFamily / total : 0;
    checks.push({ id: 'nofamily', name: 'Lignes sans famille analytique', status: noFamily === 0 ? 'green' : pctNoFamily < 0.05 ? 'orange' : 'red',
      desc: noFamily + ' / ' + total + ' lignes (' + (pctNoFamily * 100).toFixed(1) + '%)', values: { count: noFamily, total } });

    const noAnalytical = parseInt(d.no_analytical) || 0;
    const plTotal = parseInt(d.pl_total) || 0;
    const pctNoAnal = plTotal > 0 ? noAnalytical / plTotal : 0;
    checks.push({ id: 'noanalytics', name: 'Lignes P&L sans code analytique', status: noAnalytical === 0 ? 'green' : pctNoAnal < 0.05 ? 'orange' : 'red',
      desc: noAnalytical + ' / ' + plTotal + ' ecritures P&L', values: { count: noAnalytical, total: plTotal } });

    const budgetCheck = await pool.query(`SELECT COUNT(*) as c FROM financial_budgets b JOIN financial_exercises e ON b.exercise_id = e.id WHERE e.year = $1`, [year]);
    const budgetCount = parseInt(budgetCheck.rows[0].c) || 0;
    checks.push({ id: 'budget', name: 'Budget charge', status: budgetCount > 0 ? 'green' : 'orange',
      desc: budgetCount > 0 ? budgetCount + ' postes' : 'Aucun budget', values: { count: budgetCount } });

    checks.push({ id: 'resultat', name: 'Resultat P&L', status: (totalCredit - totalDebit) >= 0 ? 'green' : 'red',
      desc: 'Produits - Charges', values: { produits: totalCredit, charges: totalDebit, resultat: totalCredit - totalDebit } });

    res.json(checks);
  } catch (err) {
    console.error('[FINANCE] Erreur controls :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════

router.get('/settings', async (req, res) => {
  try {
    const r = await pool.query('SELECT key, value FROM financial_settings');
    const settings = {};
    for (const row of r.rows) settings[row.key] = row.value;
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const { key, value } = req.body;
    await pool.query(
      'INSERT INTO financial_settings (key, value, updated_by) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()',
      [key, JSON.stringify(value), req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// IMPORT LOGS
// ══════════════════════════════════════════

router.get('/logs', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT l.*, u.username as imported_by_name
      FROM financial_import_logs l
      LEFT JOIN users u ON l.imported_by = u.id
      ORDER BY l.imported_at DESC LIMIT 100
    `);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// PENNYLANE PROXY (direct from backend)
// ══════════════════════════════════════════

const PENNYLANE_BASE = 'https://app.pennylane.com/api/external/v2';

router.post('/pennylane/test', async (req, res) => {
  try {
    const apiKey = req.headers['x-pennylane-key'];
    if (!apiKey) return res.status(400).json({ error: 'Cle API requise (header X-Pennylane-Key)' });

    const resp = await fetch(`${PENNYLANE_BASE}/me`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
    });

    if (!resp.ok) return res.status(resp.status).json({ error: 'Erreur Pennylane: ' + resp.status });
    const data = await resp.json();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ error: 'Erreur connexion: ' + err.message });
  }
});

module.exports = router;

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
// DIAGNOSTIC — Vérifier les données importées
// ══════════════════════════════════════════

router.get('/diagnostic/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year);

    const exercise = await pool.query('SELECT * FROM financial_exercises WHERE year = $1', [year]);
    if (exercise.rows.length === 0) return res.json({ error: 'Aucun exercice pour ' + year, exercises: [] });

    const exId = exercise.rows[0].id;

    const counts = await pool.query(`
      SELECT COUNT(*) as total,
        SUM(debit) as sum_debit, SUM(credit) as sum_credit,
        COUNT(CASE WHEN account IS NOT NULL THEN 1 END) as with_account,
        COUNT(CASE WHEN account LIKE '6%' THEN 1 END) as class6,
        COUNT(CASE WHEN account LIKE '7%' THEN 1 END) as class7,
        COUNT(CASE WHEN account LIKE '5%' THEN 1 END) as class5,
        COUNT(CASE WHEN source = 'api' THEN 1 END) as from_api,
        COUNT(CASE WHEN source = 'file' THEN 1 END) as from_file
      FROM financial_gl_entries WHERE exercise_id = $1
    `, [exId]);

    const sample = await pool.query(
      'SELECT id, account, account_label, debit, credit, date, source, journal FROM financial_gl_entries WHERE exercise_id = $1 LIMIT 10',
      [exId]
    );

    const accountClasses = await pool.query(`
      SELECT SUBSTRING(account, 1, 1) as class, COUNT(*) as count,
             SUM(debit) as debit, SUM(credit) as credit
      FROM financial_gl_entries WHERE exercise_id = $1 AND account IS NOT NULL
      GROUP BY SUBSTRING(account, 1, 1) ORDER BY class
    `, [exId]);

    res.json({
      year,
      exercise: exercise.rows[0],
      counts: counts.rows[0],
      account_classes: accountClasses.rows,
      sample: sample.rows,
    });
  } catch (err) {
    console.error('[FINANCE] Erreur diagnostic :', err);
    res.status(500).json({ error: err.message });
  }
});

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

    // Import dans une transaction SQL (rollback si erreur)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM financial_gl_entries WHERE exercise_id = $1', [exerciseId]);

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

        await client.query(`INSERT INTO financial_gl_entries
          (exercise_id, line_id, date, journal, account, account_label, vat_rate, piece_label,
           line_label, invoice_number, third_party, family_category, category, analytical_code,
           currency, exchange_rate, debit, credit, balance)
          VALUES ${placeholders.join(',')}`, values);
      }

      await client.query(
        'INSERT INTO financial_import_logs (exercise_id, type, filename, row_count, period, imported_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [exerciseId, 'Grand Livre', req.file.originalname, rows.length, String(detectedYear), req.user.id]
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ year: detectedYear, count: rows.length, exerciseId });
  } catch (err) {
    console.error('[FINANCE] Erreur import GL :', err);
    res.status(500).json({ error: 'Erreur import GL' });
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

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM financial_transactions WHERE exercise_id = $1', [exerciseId]);

      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const values = [];
        const placeholders = [];
        let p = 1;
        for (const r of batch) {
          placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
          values.push(exerciseId, r.date, r.month, r.bank_account, r.label, r.amount, r.third_party, r.justified, r.pl);
        }
        await client.query(`INSERT INTO financial_transactions (exercise_id, date, month, bank_account, label, amount, third_party, justified, pl) VALUES ${placeholders.join(',')}`, values);
      }

      await client.query('INSERT INTO financial_import_logs (exercise_id, type, filename, row_count, period, imported_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [exerciseId, 'Transactions', req.file.originalname, rows.length, String(detectedYear), req.user.id]);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ year: detectedYear, count: rows.length });
  } catch (err) {
    console.error('[FINANCE] Erreur import transactions :', err);
    res.status(500).json({ error: 'Erreur import' });
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

    const budgetRows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const category = row.getCell(catCol).value;
      if (!category) return;

      for (const [col, month] of Object.entries(monthCols)) {
        const amount = parseNum(row.getCell(parseInt(col)).value);
        if (amount !== 0) {
          budgetRows.push({ category: String(category).trim(), month, amount });
        }
      }
    });

    for (const item of budgetRows) {
      await pool.query(
        'INSERT INTO financial_budgets (exercise_id, category, month, amount, created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (exercise_id, category, month) DO UPDATE SET amount = $4',
        [exerciseId, item.category, item.month, item.amount, req.user.id]
      );
    }
    const count = budgetRows.length;

    await pool.query('INSERT INTO financial_import_logs (exercise_id, type, filename, row_count, period, imported_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [exerciseId, 'Budget', req.file.originalname, count, String(year), req.user.id]);

    res.json({ year, count });
  } catch (err) {
    console.error('[FINANCE] Erreur import budget :', err);
    res.status(500).json({ error: 'Erreur import' });
  }
});

// ══════════════════════════════════════════
// P&L — Compte de résultat structuré
// ══════════════════════════════════════════

router.get('/gl/:year/pl', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const { centre } = req.query;

    // Récupérer toutes les écritures classe 6 et 7
    let query = `SELECT g.account, g.account_label, g.family_category, g.category, g.analytical_code,
                        g.debit, g.credit, g.date
                 FROM financial_gl_entries g
                 JOIN financial_exercises e ON g.exercise_id = e.id
                 WHERE e.year = $1 AND (g.account LIKE '6%' OR g.account LIKE '7%')`;
    const params = [year];
    if (centre && centre !== 'all') {
      params.push(centre);
      query += ` AND g.analytical_code = $${params.length}`;
    }
    const r = await pool.query(query, params);
    const entries = r.rows;

    // Calculer KPIs
    let totalProduits = 0, totalCharges = 0;
    for (const e of entries) {
      if ((e.account || '').startsWith('7')) totalProduits += (parseFloat(e.credit) || 0) - (parseFloat(e.debit) || 0);
      if ((e.account || '').startsWith('6')) totalCharges += (parseFloat(e.debit) || 0) - (parseFloat(e.credit) || 0);
    }

    // Centres analytiques distincts
    const centresSet = new Set();
    for (const e of entries) if (e.analytical_code) centresSet.add(e.analytical_code);
    const centres = [...centresSet].sort().map(c => ({ code: c, label: c }));

    // Grouper par catégorie (family_category ou premier chiffre + libellé)
    const groupMap = {};
    for (const e of entries) {
      const acct = e.account || '';
      const cls = acct.charAt(0);
      const key = e.family_category || e.category || `Classe ${cls}`;
      if (!groupMap[key]) {
        groupMap[key] = { key, label: key, class: cls, months: Array.from({ length: 12 }, () => 0), total: 0, lines: {} };
      }
      const amount = cls === '7' ? (parseFloat(e.credit) || 0) - (parseFloat(e.debit) || 0) : (parseFloat(e.debit) || 0) - (parseFloat(e.credit) || 0);
      groupMap[key].total += amount;
      if (e.date) {
        const m = new Date(e.date).getMonth();
        groupMap[key].months[m] += amount;
      }
      // Sous-lignes par compte
      const lineKey = `${acct} - ${e.account_label || ''}`;
      if (!groupMap[key].lines[lineKey]) {
        groupMap[key].lines[lineKey] = { label: lineKey, months: Array.from({ length: 12 }, () => 0), total: 0 };
      }
      groupMap[key].lines[lineKey].total += amount;
      if (e.date) {
        const m = new Date(e.date).getMonth();
        groupMap[key].lines[lineKey].months[m] += amount;
      }
    }

    // Budget par catégorie
    const budgets = await pool.query(`
      SELECT b.category, b.month, b.amount FROM financial_budgets b
      JOIN financial_exercises e ON b.exercise_id = e.id WHERE e.year = $1
    `, [year]);
    const budgetMap = {};
    for (const b of budgets.rows) {
      if (!budgetMap[b.category]) budgetMap[b.category] = 0;
      budgetMap[b.category] += parseFloat(b.amount) || 0;
    }

    const groups = Object.values(groupMap)
      .map(g => ({
        key: g.key,
        label: g.label,
        class: g.class,
        type: g.class === '7' ? 'revenue' : 'expense',
        months: g.months.map(v => Math.round(v * 100) / 100),
        total: Math.round(g.total * 100) / 100,
        budget: budgetMap[g.key] || 0,
        ecart: Math.round(((budgetMap[g.key] || 0) - g.total) * 100) / 100,
        lines: Object.values(g.lines).map(l => ({
          ...l,
          months: l.months.map(v => Math.round(v * 100) / 100),
          total: Math.round(l.total * 100) / 100,
          budget: 0,
          ecart: 0,
        })).sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
      }))
      .sort((a, b) => a.class.localeCompare(b.class) || Math.abs(b.total) - Math.abs(a.total));

    // Totaux résultat par mois
    const totalMonths = Array.from({ length: 12 }, () => 0);
    for (const g of groups) {
      for (let i = 0; i < 12; i++) {
        totalMonths[i] += g.class === '7' ? g.months[i] : -g.months[i];
      }
    }
    const totalBudget = Object.values(budgetMap).reduce((s, v) => s + v, 0);

    res.json({
      kpis: {
        produits: Math.round(totalProduits * 100) / 100,
        charges: Math.round(totalCharges * 100) / 100,
        resultat: Math.round((totalProduits - totalCharges) * 100) / 100,
      },
      centres,
      groups,
      totals: {
        months: totalMonths.map(v => Math.round(v * 100) / 100),
        total: Math.round((totalProduits - totalCharges) * 100) / 100,
        budget: totalBudget,
        ecart: Math.round((totalBudget - (totalProduits - totalCharges)) * 100) / 100,
      },
    });
  } catch (err) {
    console.error('[FINANCE] Erreur P&L :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// BILAN — Bilan simplifié, SIG, ratios
// ══════════════════════════════════════════

router.get('/gl/:year/bilan', async (req, res) => {
  try {
    const year = parseInt(req.params.year);

    // Tous les comptes, aggrégés par classe et sous-classe
    const r = await pool.query(`
      SELECT SUBSTRING(g.account, 1, 2) as sub, SUBSTRING(g.account, 1, 1) as cls,
             SUM(g.debit) as total_debit, SUM(g.credit) as total_credit,
             SUM(g.debit - g.credit) as solde
      FROM financial_gl_entries g
      JOIN financial_exercises e ON g.exercise_id = e.id
      WHERE e.year = $1
      GROUP BY SUBSTRING(g.account, 1, 2), SUBSTRING(g.account, 1, 1)
      ORDER BY sub
    `, [year]);

    // Même chose pour N-1
    const rn1 = await pool.query(`
      SELECT SUBSTRING(g.account, 1, 2) as sub, SUBSTRING(g.account, 1, 1) as cls,
             SUM(g.debit - g.credit) as solde
      FROM financial_gl_entries g
      JOIN financial_exercises e ON g.exercise_id = e.id
      WHERE e.year = $1
      GROUP BY SUBSTRING(g.account, 1, 2), SUBSTRING(g.account, 1, 1)
    `, [year - 1]);

    const n1Map = {};
    for (const row of rn1.rows) n1Map[row.sub] = parseFloat(row.solde) || 0;

    // Agréger par sous-classe
    const subs = {};
    for (const row of r.rows) {
      subs[row.sub] = parseFloat(row.solde) || 0;
    }

    const s = (prefix) => {
      let total = 0;
      for (const [k, v] of Object.entries(subs)) if (k.startsWith(prefix)) total += v;
      return total;
    };
    const sn1 = (prefix) => {
      let total = 0;
      for (const [k, v] of Object.entries(n1Map)) if (k.startsWith(prefix)) total += v;
      return total;
    };

    // Résultat
    const produits = -(s('7'));  // classe 7 est créditrice
    const charges = s('6');      // classe 6 est débitrice
    const resultat = produits - charges;
    const produitsN1 = -(sn1('7'));
    const chargesN1 = sn1('6');
    const resultatN1 = produitsN1 - chargesN1;

    // Actif
    const immobilisations = s('2');
    const stocks = s('3');
    const clients = s('41');
    const autresCreances = s('4') - s('41') - s('40') - s('43');
    const tresorerie = s('5');
    const totalActif = immobilisations + stocks + clients + Math.max(0, autresCreances) + tresorerie;

    // Passif
    const capitaux = -(s('1'));  // classe 1 créditrice
    const fournisseurs = -(s('40'));
    const social = -(s('43'));
    const autresDettes = -(s('4') - s('41') - s('40') - s('43'));
    const totalPassif = capitaux + fournisseurs + social + Math.max(0, autresDettes) + resultat;

    // N-1
    const immobilisationsN1 = sn1('2');
    const totalActifN1 = immobilisationsN1 + sn1('3') + sn1('41') + sn1('5');
    const capitauxN1 = -(sn1('1'));

    // SIG
    const sig = [
      { label: 'Produits d\'exploitation (cl. 7)', n: Math.round(produits), n1: Math.round(produitsN1), highlight: false },
      { label: 'Charges d\'exploitation (cl. 6)', n: -Math.round(charges), n1: -Math.round(chargesN1), highlight: false },
      { label: 'RESULTAT D\'EXPLOITATION', n: Math.round(resultat), n1: Math.round(resultatN1), highlight: true,
        variation: resultatN1 !== 0 ? Math.round((resultat - resultatN1) / Math.abs(resultatN1) * 100 * 10) / 10 : null },
      { label: 'Produits financiers', n: Math.round(-(s('76'))), n1: Math.round(-(sn1('76'))), highlight: false },
      { label: 'Charges financieres', n: -Math.round(s('66')), n1: -Math.round(sn1('66')), highlight: false },
      { label: 'RESULTAT NET', n: Math.round(resultat), n1: Math.round(resultatN1), highlight: true,
        variation: resultatN1 !== 0 ? Math.round((resultat - resultatN1) / Math.abs(resultatN1) * 100 * 10) / 10 : null },
    ];

    // Actif/Passif
    const rd = (v) => Math.round(v * 100) / 100;
    const actifRows = [
      { label: 'ACTIF IMMOBILISE', n: rd(immobilisations), n1: rd(immobilisationsN1), bold: true },
      { label: 'Immobilisations', n: rd(immobilisations), n1: rd(immobilisationsN1), indent: true },
      { label: 'ACTIF CIRCULANT', n: rd(stocks + clients + Math.max(0, autresCreances)), n1: rd(sn1('3') + sn1('41')), bold: true },
      { label: 'Stocks', n: rd(stocks), n1: rd(sn1('3')), indent: true },
      { label: 'Clients', n: rd(clients), n1: rd(sn1('41')), indent: true },
      { label: 'TRESORERIE ACTIVE', n: rd(Math.max(0, tresorerie)), n1: rd(Math.max(0, sn1('5'))), bold: true },
      { label: 'TOTAL ACTIF', n: rd(totalActif), n1: rd(totalActifN1), bold: true },
    ];

    const passifRows = [
      { label: 'CAPITAUX PROPRES', n: rd(capitaux), n1: rd(capitauxN1), bold: true },
      { label: 'Resultat de l\'exercice', n: rd(resultat), n1: rd(resultatN1), indent: true },
      { label: 'DETTES', n: rd(fournisseurs + social + Math.max(0, autresDettes)), n1: rd(-(sn1('40')) - sn1('43')), bold: true },
      { label: 'Fournisseurs', n: rd(fournisseurs), n1: rd(-(sn1('40'))), indent: true },
      { label: 'Dettes sociales et fiscales', n: rd(social), n1: rd(-(sn1('43'))), indent: true },
      { label: 'TRESORERIE PASSIVE', n: rd(Math.max(0, -tresorerie)), n1: rd(Math.max(0, -sn1('5'))), bold: true },
      { label: 'TOTAL PASSIF', n: rd(totalPassif), n1: rd(totalActifN1), bold: true },
    ];

    // Ratios
    const bfr = clients - fournisseurs - social;
    const ratios = [
      { label: 'Marge nette', value: produits > 0 ? resultat / produits * 100 : 0, unit: '%',
        status: resultat / (produits || 1) > 0.05 ? 'good' : resultat >= 0 ? 'warning' : 'bad', benchmark: '> 5%' },
      { label: 'Ratio de liquidite', value: totalActif > 0 ? (stocks + clients + tresorerie) / (fournisseurs + social || 1) : 0, unit: '',
        status: (stocks + clients + tresorerie) / (fournisseurs + social || 1) > 1 ? 'good' : 'bad', benchmark: '> 1' },
      { label: 'BFR en jours de CA', value: produits > 0 ? bfr / produits * 365 : 0, unit: 'jours',
        status: bfr / (produits || 1) * 365 < 60 ? 'good' : bfr / (produits || 1) * 365 < 90 ? 'warning' : 'bad', benchmark: '< 60 j' },
      { label: 'Autonomie financiere', value: totalPassif > 0 ? capitaux / totalPassif * 100 : 0, unit: '%',
        status: capitaux / (totalPassif || 1) > 0.3 ? 'good' : capitaux / (totalPassif || 1) > 0.15 ? 'warning' : 'bad', benchmark: '> 30%' },
    ];

    // Seuil de rentabilité (simplifié)
    const chargesVariables = s('60') + s('61') + s('62'); // achats, services ext
    const chargesFixes = charges - chargesVariables;
    const mcv = produits > 0 ? (produits - chargesVariables) / produits * 100 : 0;
    const caSeuil = mcv > 0 ? chargesFixes / (mcv / 100) : 0;

    const breakeven = {
      ca_seuil: Math.round(caSeuil),
      charges_fixes: Math.round(chargesFixes),
      charges_variables: Math.round(chargesVariables),
      marge_cv: Math.round(mcv * 10) / 10,
      marge_securite: caSeuil > 0 ? Math.round((produits - caSeuil) / caSeuil * 100 * 10) / 10 : 0,
      date_atteinte: (() => {
        if (produits <= 0 || caSeuil <= 0) return null;
        const monthNum = Math.ceil(caSeuil / (produits / 12));
        if (monthNum > 12) return null;
        return `${year}-${String(monthNum).padStart(2, '0')}-28`;
      })(),
    };

    res.json({
      kpis: {
        total_actif: rd(totalActif),
        capitaux_propres: rd(capitaux),
        resultat_net: rd(resultat),
        actif_variation: totalActifN1 !== 0 ? Math.round((totalActif - totalActifN1) / Math.abs(totalActifN1) * 100 * 10) / 10 : null,
        cp_variation: capitauxN1 !== 0 ? Math.round((capitaux - capitauxN1) / Math.abs(capitauxN1) * 100 * 10) / 10 : null,
        resultat_variation: resultatN1 !== 0 ? Math.round((resultat - resultatN1) / Math.abs(resultatN1) * 100 * 10) / 10 : null,
      },
      sig,
      actif: actifRows,
      passif: passifRows,
      ratios,
      breakeven,
    });
  } catch (err) {
    console.error('[FINANCE] Erreur bilan :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// TRESORERIE — Données structurées pour la page trésorerie
// ══════════════════════════════════════════

router.get('/gl/:year/tresorerie', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const MONTHS_FR = ['Janvier','Fevrier','Mars','Avril','Mai','Juin','Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];

    // Toutes les écritures des comptes 512 (banque/trésorerie)
    const r = await pool.query(`
      SELECT g.date, g.account, g.account_label, g.third_party, g.piece_label, g.line_label,
             g.debit, g.credit, g.journal
      FROM financial_gl_entries g
      JOIN financial_exercises e ON g.exercise_id = e.id
      WHERE e.year = $1 AND g.account LIKE '512%'
      ORDER BY g.date, g.id
    `, [year]);

    const entries = r.rows;

    // Mensuel : encaissements (debit), décaissements (credit), solde cumulé
    const monthly = Array.from({ length: 12 }, () => ({ encaissements: 0, decaissements: 0, solde: 0 }));
    let cumul = 0;

    for (const e of entries) {
      if (!e.date) continue;
      const m = new Date(e.date).getMonth();
      const debit = parseFloat(e.debit) || 0;
      const credit = parseFloat(e.credit) || 0;
      monthly[m].encaissements += debit;
      monthly[m].decaissements += credit;
    }

    for (let i = 0; i < 12; i++) {
      cumul += monthly[i].encaissements - monthly[i].decaissements;
      monthly[i].solde = Math.round(cumul * 100) / 100;
      monthly[i].encaissements = Math.round(monthly[i].encaissements * 100) / 100;
      monthly[i].decaissements = Math.round(monthly[i].decaissements * 100) / 100;
    }

    // KPIs
    const totalEncaissements = monthly.reduce((s, m) => s + m.encaissements, 0);
    const totalDecaissements = monthly.reduce((s, m) => s + m.decaissements, 0);
    const now = new Date();
    const currentMonth = now.getFullYear() === year ? now.getMonth() : 11;
    const position = monthly[currentMonth]?.solde || 0;
    const prevPosition = currentMonth > 0 ? monthly[currentMonth - 1]?.solde || 0 : 0;

    // Waterfall
    const waterfall = [
      { label: 'Solde initial', value: 0, invisible: 0, type: 'total' },
    ];
    for (let i = 0; i <= currentMonth; i++) {
      const net = monthly[i].encaissements - monthly[i].decaissements;
      waterfall.push({
        label: MONTHS_FR[i].substring(0, 3),
        value: Math.round(net),
        invisible: Math.max(0, Math.round(waterfall[waterfall.length - 1].invisible + (waterfall[waterfall.length - 1].value > 0 ? waterfall[waterfall.length - 1].value : 0) + (net < 0 ? net : 0))),
        type: net >= 0 ? 'positive' : 'negative',
      });
    }
    waterfall.push({ label: 'Position', value: Math.round(position), invisible: 0, type: 'total' });

    // Cash flow par tiers (top 10)
    const byThirdParty = {};
    for (const e of entries) {
      const key = e.third_party || e.piece_label || 'Autres';
      if (!byThirdParty[key]) byThirdParty[key] = Array.from({ length: 12 }, () => 0);
      if (!e.date) continue;
      const m = new Date(e.date).getMonth();
      byThirdParty[key][m] += (parseFloat(e.debit) || 0) - (parseFloat(e.credit) || 0);
    }

    const cashFlow = Object.entries(byThirdParty)
      .map(([label, months]) => ({
        key: label,
        label,
        months: months.map(v => Math.round(v * 100) / 100),
        lines: [],
      }))
      .sort((a, b) => {
        const totalA = a.months.reduce((s, v) => s + Math.abs(v), 0);
        const totalB = b.months.reduce((s, v) => s + Math.abs(v), 0);
        return totalB - totalA;
      })
      .slice(0, 20);

    res.json({
      kpis: {
        position: Math.round(position * 100) / 100,
        encaissements: Math.round(totalEncaissements * 100) / 100,
        decaissements: Math.round(totalDecaissements * 100) / 100,
        variation: Math.round((totalEncaissements - totalDecaissements) * 100) / 100,
        position_trend: prevPosition !== 0 ? Math.round((position - prevPosition) / Math.abs(prevPosition) * 100) : 0,
      },
      monthly,
      waterfall,
      cash_flow: cashFlow,
    });
  } catch (err) {
    console.error('[FINANCE] Erreur trésorerie :', err);
    res.status(500).json({ error: 'Erreur serveur' });
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
      // Aliases attendus par Finance.jsx (dashboard)
      ca_ytd: produits, charges_ytd: charges,
      marge_globale: produits > 0 ? ((produits - charges) / produits * 100) : 0,
      tresorerie, bfr, clients, fournisseurs, social,
      coutTonneCollecte, coutTonneTri,
      cout_tonne_collecte: coutTonneCollecte, cout_tonne_trie: coutTonneTri,
      tonnesCollectees, tonnesAuTri,
      chargesCollecte, chargesTri, chargesFG,
      fgCollecte, fgTri, transfertInterne,
      coutCompletCollecte, coutCompletTri,
      centres: centreMap,
      monthly: monthly.rows.map(m => ({
        ...m,
        produits: parseFloat(m.produits) || 0,
        charges: parseFloat(m.charges) || 0,
        tresorerie: parseFloat(m.tresorerie) || 0,
        ca: parseFloat(m.produits) || 0,
        resultat: (parseFloat(m.produits) || 0) - (parseFloat(m.charges) || 0),
      })),
      // Evolution trésorerie (solde cumulé par mois)
      tresorerie_evolution: (() => {
        const monthlyArr = Array.from({ length: 12 }, () => ({ solde: 0 }));
        let cumul = 0;
        for (const m of monthly.rows) {
          const idx = parseInt(m.month);
          const net = (parseFloat(m.tresorerie) || 0);
          cumul += net;
          if (idx >= 0 && idx < 12) monthlyArr[idx].solde = Math.round(cumul * 100) / 100;
        }
        return monthlyArr;
      })(),
      marge: produits - charges,
      // Alertes automatiques
      alertes: (() => {
        const a = [];
        if (produits - charges < 0) a.push({ type: 'error', message: `Resultat negatif : ${Math.round(produits - charges).toLocaleString()} EUR` });
        if (tresorerie < 0) a.push({ type: 'error', message: `Tresorerie negative : ${Math.round(tresorerie).toLocaleString()} EUR` });
        if (bfr > produits * 0.3 && produits > 0) a.push({ type: 'warning', message: `BFR eleve (${Math.round(bfr / produits * 100)}% du CA)` });
        if (charges > 0 && produits > 0 && (produits - charges) / produits < 0.05) a.push({ type: 'warning', message: 'Marge inferieure a 5%' });
        return a;
      })(),
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

    checks.push({ id: 'equilibre', name: 'Equilibre debit/credit', status: ecart < 1 ? 'ok' : ecart < 100 ? 'warning' : 'error',
      desc: ecart < 1 ? 'Parfait equilibre' : 'Ecart: ' + ecart.toFixed(2) + ' EUR',
      values: { debit: totalDebit, credit: totalCredit, ecart } });

    const noFamily = parseInt(d.no_family) || 0;
    const pctNoFamily = total > 0 ? noFamily / total : 0;
    checks.push({ id: 'nofamily', name: 'Lignes sans famille analytique', status: noFamily === 0 ? 'ok' : pctNoFamily < 0.05 ? 'warning' : 'error',
      desc: noFamily + ' / ' + total + ' lignes (' + (pctNoFamily * 100).toFixed(1) + '%)', values: { count: noFamily, total } });

    const noAnalytical = parseInt(d.no_analytical) || 0;
    const plTotal = parseInt(d.pl_total) || 0;
    const pctNoAnal = plTotal > 0 ? noAnalytical / plTotal : 0;
    checks.push({ id: 'noanalytics', name: 'Lignes P&L sans code analytique', status: noAnalytical === 0 ? 'ok' : pctNoAnal < 0.05 ? 'warning' : 'error',
      desc: noAnalytical + ' / ' + plTotal + ' ecritures P&L', values: { count: noAnalytical, total: plTotal } });

    const budgetCheck = await pool.query(`SELECT COUNT(*) as c FROM financial_budgets b JOIN financial_exercises e ON b.exercise_id = e.id WHERE e.year = $1`, [year]);
    const budgetCount = parseInt(budgetCheck.rows[0].c) || 0;
    checks.push({ id: 'budget', name: 'Budget charge', status: budgetCount > 0 ? 'ok' : 'warning',
      desc: budgetCount > 0 ? budgetCount + ' postes' : 'Aucun budget', values: { count: budgetCount } });

    checks.push({ id: 'resultat', name: 'Resultat P&L', status: (totalCredit - totalDebit) >= 0 ? 'ok' : 'error',
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

module.exports = router;

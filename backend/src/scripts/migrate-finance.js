require('dotenv').config();
const pool = require('../config/database');

async function migrateFinance() {
  const client = await pool.connect();
  try {
    console.log('[MIGRATE-FINANCE] Démarrage de la migration finance...');

    await client.query('BEGIN');

    // ══════════════════════════════════════════
    // TABLE 1 : Exercices comptables
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS financial_exercises (
        id SERIAL PRIMARY KEY,
        year INTEGER NOT NULL UNIQUE,
        status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[MIGRATE-FINANCE] Table financial_exercises ✓');

    // ══════════════════════════════════════════
    // TABLE 2 : Ecritures Grand Livre
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS financial_gl_entries (
        id SERIAL PRIMARY KEY,
        exercise_id INTEGER REFERENCES financial_exercises(id) ON DELETE CASCADE,
        line_id TEXT,
        date DATE,
        journal TEXT,
        account TEXT,
        account_label TEXT,
        vat_rate DECIMAL(5,2),
        piece_label TEXT,
        line_label TEXT,
        invoice_number TEXT,
        third_party TEXT,
        family_category TEXT,
        category TEXT,
        analytical_code TEXT,
        currency VARCHAR(10) DEFAULT 'EUR',
        exchange_rate DECIMAL(10,4) DEFAULT 1,
        debit DECIMAL(15,2) DEFAULT 0,
        credit DECIMAL(15,2) DEFAULT 0,
        balance DECIMAL(15,2) DEFAULT 0,
        due_date DATE,
        source VARCHAR(20) DEFAULT 'file' CHECK (source IN ('file', 'api')),
        imported_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[MIGRATE-FINANCE] Table financial_gl_entries ✓');

    // ══════════════════════════════════════════
    // TABLE 3 : Transactions bancaires
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS financial_transactions (
        id SERIAL PRIMARY KEY,
        exercise_id INTEGER REFERENCES financial_exercises(id) ON DELETE CASCADE,
        date DATE,
        month VARCHAR(20),
        bank_account VARCHAR(255),
        label VARCHAR(500),
        amount DECIMAL(15,2),
        third_party VARCHAR(255),
        justified BOOLEAN DEFAULT false,
        pl VARCHAR(255),
        tresorerie VARCHAR(255),
        imported_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[MIGRATE-FINANCE] Table financial_transactions ✓');

    // ══════════════════════════════════════════
    // TABLE 4 : Budget par type de depense et mois
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS financial_budgets (
        id SERIAL PRIMARY KEY,
        exercise_id INTEGER REFERENCES financial_exercises(id) ON DELETE CASCADE,
        category VARCHAR(255) NOT NULL,
        month INTEGER NOT NULL CHECK (month >= 0 AND month <= 11),
        amount DECIMAL(15,2) DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(exercise_id, category, month)
      );
    `);
    console.log('[MIGRATE-FINANCE] Table financial_budgets ✓');

    // ══════════════════════════════════════════
    // TABLE 5 : Donnees operationnelles
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS financial_operational_data (
        id SERIAL PRIMARY KEY,
        exercise_id INTEGER REFERENCES financial_exercises(id) ON DELETE CASCADE,
        field_id VARCHAR(50) NOT NULL,
        month INTEGER NOT NULL CHECK (month >= 0 AND month <= 11),
        value DECIMAL(15,4) DEFAULT 0,
        source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'solidata', 'calculated')),
        updated_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(exercise_id, field_id, month)
      );
    `);
    console.log('[MIGRATE-FINANCE] Table financial_operational_data ✓');

    // ══════════════════════════════════════════
    // TABLE 6 : Logs d'import
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS financial_import_logs (
        id SERIAL PRIMARY KEY,
        exercise_id INTEGER REFERENCES financial_exercises(id),
        type VARCHAR(50) NOT NULL,
        filename VARCHAR(255),
        row_count INTEGER DEFAULT 0,
        period VARCHAR(50),
        imported_by INTEGER REFERENCES users(id),
        imported_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[MIGRATE-FINANCE] Table financial_import_logs ✓');

    // ══════════════════════════════════════════
    // TABLE 7 : Parametres financiers
    // ══════════════════════════════════════════
    await client.query(`
      CREATE TABLE IF NOT EXISTS financial_settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) UNIQUE NOT NULL,
        value JSONB,
        updated_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[MIGRATE-FINANCE] Table financial_settings ✓');

    // ══════════════════════════════════════════
    // INDEX
    // ══════════════════════════════════════════
    await client.query('CREATE INDEX IF NOT EXISTS idx_fin_gl_exercise ON financial_gl_entries(exercise_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_fin_gl_account ON financial_gl_entries(account)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_fin_gl_date ON financial_gl_entries(date)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_fin_gl_family ON financial_gl_entries(family_category)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_fin_gl_category ON financial_gl_entries(category)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_fin_gl_analytical ON financial_gl_entries(analytical_code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_fin_trans_exercise ON financial_transactions(exercise_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_fin_budget_exercise ON financial_budgets(exercise_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_fin_ops_exercise ON financial_operational_data(exercise_id)');
    console.log('[MIGRATE-FINANCE] Index créés ✓');

    // ══════════════════════════════════════════
    // MIGRATION : Élargir colonnes GL si trop courtes (Pennylane)
    // ══════════════════════════════════════════
    const glWidenings = [
      { col: 'line_id', def: 'TEXT' },
      { col: 'journal', def: 'TEXT' },
      { col: 'account', def: 'TEXT' },
      { col: 'account_label', def: 'TEXT' },
      { col: 'piece_label', def: 'TEXT' },
      { col: 'line_label', def: 'TEXT' },
      { col: 'invoice_number', def: 'TEXT' },
      { col: 'third_party', def: 'TEXT' },
      { col: 'family_category', def: 'TEXT' },
      { col: 'category', def: 'TEXT' },
      { col: 'analytical_code', def: 'TEXT' },
    ];
    for (const w of glWidenings) {
      try {
        await client.query(`ALTER TABLE financial_gl_entries ADD COLUMN IF NOT EXISTS ${w.col} ${w.def}`);
        await client.query(`ALTER TABLE financial_gl_entries ALTER COLUMN ${w.col} TYPE ${w.def}`);
      } catch (e) { console.warn(`[MIGRATE-FINANCE] Colonne ${w.col}:`, e.message); }
    }
    console.log('[MIGRATE-FINANCE] Colonnes GL élargies ✓');

    // ══════════════════════════════════════════
    // DONNEES PAR DEFAUT
    // ══════════════════════════════════════════
    await client.query(`
      INSERT INTO financial_settings (key, value) VALUES
        ('centres_pl', '{"Collecte & Original": {"type": "direct"}, "Tri & Recyclage - 2nde main": {"type": "direct"}, "Frais Generaux": {"type": "indirect"}}'),
        ('fg_allocation_key', '"tonnage_tri"'),
        ('alert_thresholds', '{"treasuryMinDays": 30, "agingCriticalDays": 90, "budgetVarianceWarning": 0.10, "budgetVarianceCritical": 0.20}'),
        ('soutien_tri_compte', '"7400000470"')
      ON CONFLICT (key) DO NOTHING;
    `);
    console.log('[MIGRATE-FINANCE] Paramètres par défaut insérés ✓');

    await client.query('COMMIT');

    console.log('\n[MIGRATE-FINANCE] ══════════════════════════════════════');
    console.log('[MIGRATE-FINANCE] Migration finance terminée avec succès !');
    console.log('[MIGRATE-FINANCE] ══════════════════════════════════════\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[MIGRATE-FINANCE] ERREUR :', err.message);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrateFinance()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
} else {
  module.exports = { migrateFinance };
}

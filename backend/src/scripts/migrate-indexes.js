require('dotenv').config();
const pool = require('../config/database');

const INDEXES = [
  // GPS positions (queried by tour_id and timestamp)
  'CREATE INDEX IF NOT EXISTS idx_gps_positions_tour_id ON gps_positions(tour_id)',
  'CREATE INDEX IF NOT EXISTS idx_gps_positions_timestamp ON gps_positions(timestamp DESC)',
  'CREATE INDEX IF NOT EXISTS idx_gps_positions_vehicle ON gps_positions(vehicle_id, timestamp DESC)',

  // Tours (queried by date, status, vehicle_id)
  'CREATE INDEX IF NOT EXISTS idx_tours_date ON tours(date DESC)',
  'CREATE INDEX IF NOT EXISTS idx_tours_status ON tours(status)',
  'CREATE INDEX IF NOT EXISTS idx_tours_vehicle ON tours(vehicle_id)',
  'CREATE INDEX IF NOT EXISTS idx_tours_date_status ON tours(date, status)',

  // Tour CAV (queried by tour_id, cav_id)
  'CREATE INDEX IF NOT EXISTS idx_tour_cav_tour_id ON tour_cav(tour_id)',
  'CREATE INDEX IF NOT EXISTS idx_tour_cav_cav_id ON tour_cav(cav_id)',

  // Stock movements (queried by date, type)
  'CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(type)',

  // Employees (queried by team_id, is_active)
  'CREATE INDEX IF NOT EXISTS idx_employees_team ON employees(team_id)',
  'CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(is_active)',

  // Candidates (queried by status)
  'CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status)',
  'CREATE INDEX IF NOT EXISTS idx_candidate_history_created ON candidate_history(created_at DESC)',

  // Work hours (queried by employee_id, date)
  'CREATE INDEX IF NOT EXISTS idx_work_hours_employee ON work_hours(employee_id)',
  'CREATE INDEX IF NOT EXISTS idx_work_hours_date ON work_hours(date DESC)',
  'CREATE INDEX IF NOT EXISTS idx_work_hours_employee_date ON work_hours(employee_id, date)',

  // Employee contracts (queried by employee_id, is_current)
  'CREATE INDEX IF NOT EXISTS idx_contracts_employee ON employee_contracts(employee_id)',
  'CREATE INDEX IF NOT EXISTS idx_contracts_current ON employee_contracts(is_current)',
  'CREATE INDEX IF NOT EXISTS idx_contracts_end_date ON employee_contracts(end_date)',

  // Commandes exutoires (queried by status)
  'CREATE INDEX IF NOT EXISTS idx_commandes_exutoires_status ON commandes_exutoires(status)',

  // Insertion diagnostics
  'CREATE INDEX IF NOT EXISTS idx_insertion_diagnostics_employee ON insertion_diagnostics(employee_id)',

  // Schedule
  'CREATE INDEX IF NOT EXISTS idx_schedule_employee_date ON schedule(employee_id, date)',

  // Audit log
  'CREATE INDEX IF NOT EXISTS idx_rgpd_audit_created ON rgpd_audit_log(created_at DESC)',

  // CAV
  'CREATE INDEX IF NOT EXISTS idx_cav_department ON cav(department)',
  'CREATE INDEX IF NOT EXISTS idx_cav_active ON cav(is_active) WHERE is_active IS NOT FALSE',

  // Production daily
  'CREATE INDEX IF NOT EXISTS idx_production_daily_date ON production_daily(date DESC)',

  // PCM reports
  'CREATE INDEX IF NOT EXISTS idx_pcm_reports_candidate ON pcm_reports(candidate_id)',
];

async function migrateIndexes() {
  console.log('[MIGRATE-INDEXES] Création des index de performance...');
  let created = 0;
  let errors = 0;

  for (const sql of INDEXES) {
    try {
      await pool.query(sql);
      const indexName = sql.match(/IF NOT EXISTS (\S+)/)?.[1] || sql;
      console.log(`[MIGRATE-INDEXES] ✓ ${indexName}`);
      created++;
    } catch (err) {
      const indexName = sql.match(/IF NOT EXISTS (\S+)/)?.[1] || sql;
      console.error(`[MIGRATE-INDEXES] ✗ ${indexName} : ${err.message}`);
      errors++;
    }
  }

  console.log(`[MIGRATE-INDEXES] Terminé : ${created} index créés, ${errors} erreurs`);
  await pool.end();
  process.exit(errors > 0 ? 1 : 0);
}

migrateIndexes().catch(err => {
  console.error('[MIGRATE-INDEXES] Erreur fatale :', err);
  pool.end().then(() => process.exit(1));
});

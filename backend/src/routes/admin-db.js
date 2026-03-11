const express = require('express');
const router = express.Router();
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.use(authorize('ADMIN'));

// ══════════════════════════════════════════
// INFORMATIONS BASE DE DONNÉES
// ══════════════════════════════════════════

// GET /api/admin-db/info — Informations sur la base
router.get('/info', async (req, res) => {
  try {
    const dbSize = await pool.query("SELECT pg_size_pretty(pg_database_size(current_database())) as size");
    const tables = await pool.query(`
      SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.tablename AND c.table_schema = 'public') as columns
      FROM pg_tables t
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `);

    // Nombre de lignes par table (estimation)
    const rowCounts = await pool.query(`
      SELECT relname as table_name, reltuples::BIGINT as estimated_rows
      FROM pg_class
      WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND relkind = 'r'
      ORDER BY reltuples DESC
    `);

    const version = await pool.query('SELECT version()');
    const connections = await pool.query(`
      SELECT count(*) as total,
        count(*) FILTER (WHERE state = 'active') as active,
        count(*) FILTER (WHERE state = 'idle') as idle
      FROM pg_stat_activity WHERE datname = current_database()
    `);

    res.json({
      database_size: dbSize.rows[0].size,
      version: version.rows[0].version,
      connections: connections.rows[0],
      tables: tables.rows,
      row_counts: rowCounts.rows,
    });
  } catch (err) {
    console.error('[ADMIN-DB] Erreur info :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// SAUVEGARDE (Backup)
// ══════════════════════════════════════════

// POST /api/admin-db/backup — Créer une sauvegarde
router.post('/backup', async (req, res) => {
  try {
    const backupDir = path.join(__dirname, '..', '..', 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `solidata_backup_${timestamp}.sql`;
    const filepath = path.join(backupDir, filename);

    const dbUrl = process.env.DATABASE_URL || `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'solidata'}`;

    execSync(`pg_dump "${dbUrl}" --no-owner --no-acl > "${filepath}"`, { timeout: 120000 });

    const stats = fs.statSync(filepath);

    // Log audit
    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'DB_BACKUP', 'database', 0, JSON.stringify({ filename, size_bytes: stats.size })]
    );

    res.json({
      message: 'Sauvegarde créée',
      filename,
      size: `${(stats.size / 1024 / 1024).toFixed(2)} Mo`,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ADMIN-DB] Erreur backup :', err);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// GET /api/admin-db/backups — Lister les sauvegardes
router.get('/backups', async (req, res) => {
  try {
    const backupDir = path.join(__dirname, '..', '..', 'backups');
    if (!fs.existsSync(backupDir)) return res.json([]);

    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.sql'))
      .map(f => {
        const stats = fs.statSync(path.join(backupDir, f));
        return { filename: f, size: `${(stats.size / 1024 / 1024).toFixed(2)} Mo`, created_at: stats.mtime };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json(files);
  } catch (err) {
    console.error('[ADMIN-DB] Erreur liste backups :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin-db/restore — Restaurer une sauvegarde
router.post('/restore', async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Nom de fichier requis' });

    const filepath = path.join(__dirname, '..', '..', 'backups', path.basename(filename));
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Sauvegarde non trouvée' });

    const dbUrl = process.env.DATABASE_URL || `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'solidata'}`;

    execSync(`psql "${dbUrl}" < "${filepath}"`, { timeout: 300000 });

    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'DB_RESTORE', 'database', 0, JSON.stringify({ filename })]
    );

    res.json({ message: 'Restauration effectuée', filename, restored_at: new Date().toISOString() });
  } catch (err) {
    console.error('[ADMIN-DB] Erreur restore :', err);
    res.status(500).json({ error: 'Erreur lors de la restauration' });
  }
});

// DELETE /api/admin-db/backups/:filename — Supprimer une sauvegarde
router.delete('/backups/:filename', async (req, res) => {
  try {
    const filepath = path.join(__dirname, '..', '..', 'backups', path.basename(req.params.filename));
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Fichier non trouvé' });
    fs.unlinkSync(filepath);
    res.json({ message: 'Sauvegarde supprimée' });
  } catch (err) {
    console.error('[ADMIN-DB] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// MAINTENANCE
// ══════════════════════════════════════════

// POST /api/admin-db/vacuum — Optimiser la base (VACUUM ANALYZE)
router.post('/vacuum', async (req, res) => {
  try {
    await pool.query('VACUUM ANALYZE');
    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'DB_VACUUM', 'database', 0, JSON.stringify({ performed_at: new Date().toISOString() })]
    );
    res.json({ message: 'Optimisation terminée (VACUUM ANALYZE)', performed_at: new Date().toISOString() });
  } catch (err) {
    console.error('[ADMIN-DB] Erreur vacuum :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin-db/purge — Purger des données anciennes (avec confirmation)
router.post('/purge', async (req, res) => {
  try {
    const { table, months, confirm } = req.body;
    if (confirm !== 'CONFIRMER_PURGE') {
      return res.status(400).json({ error: 'Confirmation requise: envoyez confirm = "CONFIRMER_PURGE"' });
    }

    const allowedPurgeTables = {
      gps_positions: { column: 'recorded_at', min_months: 6 },
      tonnage_history: { column: 'date', min_months: 24 },
      candidate_history: { column: 'created_at', min_months: 36 },
      collection_learning_feedback: { column: 'created_at', min_months: 12 },
    };

    const config = allowedPurgeTables[table];
    if (!config) {
      return res.status(400).json({ error: `Table non autorisée. Tables autorisées: ${Object.keys(allowedPurgeTables).join(', ')}` });
    }

    const retention = Math.max(parseInt(months) || config.min_months, config.min_months);

    const result = await pool.query(
      `DELETE FROM ${table} WHERE ${config.column} < NOW() - make_interval(months => $1)`,
      [retention]
    );

    await pool.query(
      'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'DB_PURGE', table, 0, JSON.stringify({ rows_deleted: result.rowCount, retention_months: retention })]
    );

    res.json({
      message: `${result.rowCount} lignes supprimées de ${table}`,
      retention_months: retention,
      purged_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ADMIN-DB] Erreur purge :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin-db/stats — Statistiques d'utilisation
router.get('/stats', async (req, res) => {
  try {
    const stats = {};

    // Activité récente par table
    const activity = await pool.query(`
      SELECT schemaname, relname, seq_scan, seq_tup_read, idx_scan, n_tup_ins, n_tup_upd, n_tup_del, last_vacuum, last_analyze
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY n_tup_ins + n_tup_upd + n_tup_del DESC
      LIMIT 20
    `);
    stats.table_activity = activity.rows;

    // Requêtes les plus lentes (si pg_stat_statements est activé)
    try {
      const slowQueries = await pool.query(`
        SELECT query, calls, mean_exec_time, total_exec_time
        FROM pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        ORDER BY mean_exec_time DESC LIMIT 10
      `);
      stats.slow_queries = slowQueries.rows;
    } catch (_) {
      stats.slow_queries = [];
    }

    // Index non utilisés
    const unusedIndexes = await pool.query(`
      SELECT indexrelname, relname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) as index_size
      FROM pg_stat_user_indexes
      WHERE idx_scan = 0 AND schemaname = 'public'
      ORDER BY pg_relation_size(indexrelid) DESC LIMIT 10
    `);
    stats.unused_indexes = unusedIndexes.rows;

    res.json(stats);
  } catch (err) {
    console.error('[ADMIN-DB] Erreur stats :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

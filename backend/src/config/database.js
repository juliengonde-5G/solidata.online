const { Pool } = require('pg');

// Refus du mot de passe par défaut en production — évite qu'une instance
// passe en ligne avec `changeme`. En dev, le fallback reste toléré pour
// faciliter l'initialisation locale.
if (process.env.NODE_ENV === 'production' && !process.env.DB_PASSWORD) {
  console.error('[FATAL] DB_PASSWORD non défini en production. Arrêt immédiat.');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'solidata',
  user: process.env.DB_USER || 'solidata_user',
  password: process.env.DB_PASSWORD || 'changeme',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[DB] Erreur inattendue sur le pool :', err);
});

module.exports = pool;

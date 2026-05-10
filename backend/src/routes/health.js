const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { getRedisClient, isRedisAvailable } = require('../config/redis');

const APP_VERSION = process.env.APP_VERSION || require('../../package.json').version;
const DB_TIMEOUT_MS = 5000;
const REDIS_TIMEOUT_MS = 1500;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms)),
  ]);
}

router.get('/', async (req, res) => {
  const checks = { uptime_sec: Math.floor(process.uptime()) };
  const database = { connected: false };
  let overallOk = true;

  const dbStart = Date.now();
  try {
    await withTimeout(pool.query('SELECT 1'), DB_TIMEOUT_MS, 'DB');
    checks.database = { status: 'ok', latency_ms: Date.now() - dbStart };
    database.connected = true;
    try {
      const meta = await withTimeout(
        pool.query("SELECT version() AS pg, extversion AS postgis FROM pg_extension WHERE extname = 'postgis'"),
        DB_TIMEOUT_MS, 'DB-meta'
      );
      if (meta.rows[0]) {
        database.version = meta.rows[0].pg;
        database.postgis = meta.rows[0].postgis;
      } else {
        const v = await pool.query('SELECT version() AS pg');
        database.version = v.rows[0]?.pg;
      }
    } catch (_) { /* meta best-effort */ }
  } catch (err) {
    overallOk = false;
    checks.database = { status: 'error', error: err.message, latency_ms: Date.now() - dbStart };
  }

  const redisStart = Date.now();
  if (!isRedisAvailable()) {
    checks.redis = { status: 'unavailable', latency_ms: 0 };
  } else {
    try {
      const client = getRedisClient();
      await withTimeout(client.ping(), REDIS_TIMEOUT_MS, 'Redis');
      checks.redis = { status: 'ok', latency_ms: Date.now() - redisStart };
    } catch (err) {
      checks.redis = { status: 'degraded', error: err.message, latency_ms: Date.now() - redisStart };
    }
  }

  const mem = process.memoryUsage();
  checks.memory = {
    rss_mb: Math.round(mem.rss / 1024 / 1024),
    heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
    heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
  };

  const modules = {
    auth: !!process.env.JWT_SECRET,
    redis: checks.redis?.status === 'ok',
  };

  res.status(overallOk ? 200 : 503).json({
    status: overallOk ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    database,
    modules,
    checks,
  });
});

router.get('/live', (req, res) => res.status(200).json({ status: 'ok' }));

router.get('/ready', async (req, res) => {
  try {
    await withTimeout(pool.query('SELECT 1'), DB_TIMEOUT_MS, 'DB');
    res.status(200).json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', error: err.message });
  }
});

module.exports = router;

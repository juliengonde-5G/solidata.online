/**
 * Cache Redis léger pour endpoints GET coûteux.
 * Échoue silencieusement si Redis indisponible (dégradation gracieuse).
 */
const { getRedisClient, isRedisAvailable } = require('../config/redis');
const logger = require('../config/logger');

const PREFIX = 'cache:';

async function getCached(key) {
  if (!isRedisAvailable()) return null;
  try {
    const raw = await getRedisClient().get(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger?.warn?.('[CACHE] get failed', { key, error: err.message });
    return null;
  }
}

async function setCached(key, value, ttlSeconds = 60) {
  if (!isRedisAvailable()) return;
  try {
    await getRedisClient().setex(PREFIX + key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    logger?.warn?.('[CACHE] set failed', { key, error: err.message });
  }
}

async function invalidate(pattern) {
  if (!isRedisAvailable()) return;
  try {
    const client = getRedisClient();
    const keys = await client.keys(PREFIX + pattern);
    if (keys.length > 0) await client.del(...keys);
  } catch (err) {
    logger?.warn?.('[CACHE] invalidate failed', { pattern, error: err.message });
  }
}

/**
 * Middleware Express qui cache la réponse JSON d'un GET endpoint.
 * Usage : router.get('/kpis', cacheMiddleware('dashboard:kpis', 120), handler);
 */
function cacheMiddleware(keyBuilder, ttlSeconds = 60) {
  return async (req, res, next) => {
    if (req.method !== 'GET') return next();
    const key = typeof keyBuilder === 'function' ? keyBuilder(req) : keyBuilder;
    if (!key) return next();

    const cached = await getCached(key);
    if (cached !== null) {
      res.set('X-Cache', 'HIT');
      return res.json(cached);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        setCached(key, body, ttlSeconds).catch(() => {});
      }
      res.set('X-Cache', 'MISS');
      return originalJson(body);
    };
    next();
  };
}

module.exports = { getCached, setCached, invalidate, cacheMiddleware };

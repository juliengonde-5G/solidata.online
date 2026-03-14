/**
 * Configuration Redis (optionnel)
 * Utilisé pour Socket.IO adapter, BullMQ, et cache distribué
 * Si Redis n'est pas disponible, le système fonctionne en mode dégradé
 */
const Redis = require('ioredis');

let redisClient = null;
let redisAvailable = false;

function getRedisUrl() {
  return process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;
}

function createRedisClient(options = {}) {
  const url = getRedisUrl();
  const client = new Redis(url, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: true,
    retryStrategy: (times) => {
      if (times > 3) return null; // Stop retrying after 3 attempts
      return Math.min(times * 1000, 3000);
    },
    ...options,
  });

  client.on('connect', () => {
    redisAvailable = true;
    console.log('[REDIS] Connecté');
  });

  client.on('error', (err) => {
    if (redisAvailable) {
      console.warn('[REDIS] Erreur connexion:', err.message);
      redisAvailable = false;
    }
  });

  client.on('close', () => {
    redisAvailable = false;
  });

  return client;
}

function getRedisClient() {
  if (!redisClient) {
    redisClient = createRedisClient();
  }
  return redisClient;
}

function isRedisAvailable() {
  return redisAvailable;
}

module.exports = { createRedisClient, getRedisClient, isRedisAvailable, getRedisUrl };

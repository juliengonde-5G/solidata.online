/**
 * Middleware de logging HTTP : trace chaque requête API avec
 * méthode, path, statut, durée, userId. Complémente le logger Winston
 * existant pour rendre les logs corrélables et exploitables côté ops.
 */
const { randomUUID } = require('crypto');
const logger = require('../config/logger');

const SKIP_PATHS = new Set(['/api/health', '/api/health/live', '/api/health/ready']);
const SLOW_REQUEST_MS = 1000;

function requestLogger(req, res, next) {
  if (SKIP_PATHS.has(req.path)) return next();

  const start = process.hrtime.bigint();
  const requestId = req.headers['x-request-id'] || randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
    const meta = {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      duration_ms: durationMs,
      user_id: req.user?.id,
      ip: req.ip,
    };

    if (res.statusCode >= 500) logger.error('http_request', meta);
    else if (res.statusCode >= 400) logger.warn('http_request', meta);
    else if (durationMs >= SLOW_REQUEST_MS) logger.warn('http_request_slow', meta);
    else logger.info('http_request', meta);
  });

  next();
}

module.exports = requestLogger;

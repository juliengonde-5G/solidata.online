/**
 * Tests du middleware request-logger (V1 #15 — logs HTTP corrélés).
 */

jest.mock('../../../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const logger = require('../../../src/config/logger');
const requestLogger = require('../../../src/middleware/request-logger');

function makeReqRes({ method = 'GET', path = '/api/things', headers = {}, user = null } = {}) {
  const handlers = {};
  const req = { method, path, originalUrl: path, headers, user, ip: '127.0.0.1' };
  const res = {
    statusCode: 200,
    _headers: {},
    on: (event, cb) => { handlers[event] = cb; },
    setHeader: (k, v) => { res._headers[k] = v; },
  };
  return { req, res, finish: () => handlers.finish?.() };
}

describe('request-logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('logge en INFO les requêtes 2xx', () => {
    const { req, res, finish } = makeReqRes();
    const next = jest.fn();
    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();
    finish();
    expect(logger.info).toHaveBeenCalledWith('http_request', expect.objectContaining({
      method: 'GET',
      path: '/api/things',
      status: 200,
    }));
  });

  test('logge en WARN les requêtes 4xx', () => {
    const { req, res, finish } = makeReqRes();
    res.statusCode = 404;
    const next = jest.fn();
    requestLogger(req, res, next);
    finish();
    expect(logger.warn).toHaveBeenCalled();
  });

  test('logge en ERROR les requêtes 5xx', () => {
    const { req, res, finish } = makeReqRes();
    res.statusCode = 500;
    const next = jest.fn();
    requestLogger(req, res, next);
    finish();
    expect(logger.error).toHaveBeenCalled();
  });

  test('skippe les routes /api/health*', () => {
    const { req, res, finish } = makeReqRes({ path: '/api/health' });
    const next = jest.fn();
    requestLogger(req, res, next);
    finish();
    expect(next).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  test('génère un x-request-id si absent', () => {
    const { req, res } = makeReqRes();
    requestLogger(req, res, jest.fn());
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res._headers['x-request-id']).toBe(req.requestId);
  });

  test('réutilise le x-request-id fourni dans les headers', () => {
    const { req, res } = makeReqRes({ headers: { 'x-request-id': 'corr-123' } });
    requestLogger(req, res, jest.fn());
    expect(req.requestId).toBe('corr-123');
    expect(res._headers['x-request-id']).toBe('corr-123');
  });

  test('inclut user_id dans la meta si auth présente', () => {
    const { req, res, finish } = makeReqRes({ user: { id: 42 } });
    requestLogger(req, res, jest.fn());
    finish();
    expect(logger.info).toHaveBeenCalledWith('http_request', expect.objectContaining({
      user_id: 42,
    }));
  });
});

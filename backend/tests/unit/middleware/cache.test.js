/**
 * Tests du middleware de cache Redis (V1 #8).
 * Le cache doit échouer en silence si Redis est indisponible (graceful degradation).
 */

jest.mock('../../../src/config/redis', () => ({
  getRedisClient: jest.fn(),
  isRedisAvailable: jest.fn(),
}));

const { isRedisAvailable, getRedisClient } = require('../../../src/config/redis');
const { cacheMiddleware, getCached, setCached } = require('../../../src/middleware/cache');

describe('cache middleware — Redis disponible', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = {
      get: jest.fn(),
      setex: jest.fn().mockResolvedValue('OK'),
      keys: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(0),
    };
    getRedisClient.mockReturnValue(mockClient);
    isRedisAvailable.mockReturnValue(true);
  });

  test('renvoie la valeur cachée si présente (HIT)', async () => {
    mockClient.get.mockResolvedValue(JSON.stringify({ foo: 'bar' }));
    const middleware = cacheMiddleware('test-key', 60);

    const req = { method: 'GET' };
    const headers = {};
    const res = {
      json: jest.fn(),
      set: (k, v) => { headers[k] = v; },
    };
    const next = jest.fn();

    await middleware(req, res, next);

    expect(mockClient.get).toHaveBeenCalledWith('cache:test-key');
    expect(res.json).toHaveBeenCalledWith({ foo: 'bar' });
    expect(headers['X-Cache']).toBe('HIT');
    expect(next).not.toHaveBeenCalled();
  });

  test('passe au handler si miss et stocke après réponse', async () => {
    mockClient.get.mockResolvedValue(null);
    const middleware = cacheMiddleware('test-key', 60);

    const req = { method: 'GET' };
    const headers = {};
    const res = {
      statusCode: 200,
      json: jest.fn(function (body) { this._body = body; return this; }),
      set: (k, v) => { headers[k] = v; },
    };
    const next = jest.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();

    // Simuler le handler qui appelle res.json
    res.json({ result: 42 });

    // Wait for setex (called async after res.json)
    await new Promise((r) => setImmediate(r));
    expect(mockClient.setex).toHaveBeenCalledWith('cache:test-key', 60, JSON.stringify({ result: 42 }));
    expect(headers['X-Cache']).toBe('MISS');
  });

  test('skip pour les méthodes non-GET', async () => {
    const middleware = cacheMiddleware('test-key', 60);
    const req = { method: 'POST' };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockClient.get).not.toHaveBeenCalled();
  });

  test('keyBuilder peut être une fonction du request', async () => {
    mockClient.get.mockResolvedValue(null);
    const middleware = cacheMiddleware((req) => `user:${req.user.id}`, 60);
    const req = { method: 'GET', user: { id: 42 } };
    const res = { statusCode: 200, json: jest.fn(), set: jest.fn() };
    const next = jest.fn();

    await middleware(req, res, next);
    expect(mockClient.get).toHaveBeenCalledWith('cache:user:42');
  });
});

describe('cache middleware — Redis indisponible (graceful)', () => {
  beforeEach(() => {
    isRedisAvailable.mockReturnValue(false);
  });

  test('getCached retourne null sans erreur', async () => {
    const v = await getCached('any-key');
    expect(v).toBeNull();
  });

  test('setCached échoue en silence', async () => {
    await expect(setCached('any-key', { x: 1 }, 60)).resolves.toBeUndefined();
  });

  test('cacheMiddleware passe directement au handler', async () => {
    const middleware = cacheMiddleware('test-key', 60);
    const req = { method: 'GET' };
    const res = { statusCode: 200, json: jest.fn(), set: jest.fn() };
    const next = jest.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

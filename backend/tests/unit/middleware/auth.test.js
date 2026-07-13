const jwt = require('jsonwebtoken');

// Mock le module database avant d'importer auth
jest.mock('../../../src/config/database', () => ({
  query: jest.fn(),
}));

const db = require('../../../src/config/database');
const { authenticate, authorize, validatePassword } = require('../../../src/middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

describe('authenticate middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it('should return 401 if no Authorization header', () => {
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 if Authorization header is not Bearer', () => {
    req.headers.authorization = 'Basic abc123';
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 with TOKEN_EXPIRED code if token is expired', () => {
    const token = jwt.sign({ id: 1, role: 'ADMIN' }, JWT_SECRET, { expiresIn: '-1s' });
    req.headers.authorization = `Bearer ${token}`;
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_EXPIRED' }));
  });

  it('should return 401 if token is invalid', () => {
    req.headers.authorization = 'Bearer invalid.token.here';
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should attach user to req and call next() for valid token', () => {
    const payload = { id: 1, username: 'admin', role: 'ADMIN', first_name: 'Test', last_name: 'User' };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
    req.headers.authorization = `Bearer ${token}`;
    authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe(1);
    expect(req.user.role).toBe('ADMIN');
  });
});

describe('authorize middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { user: { id: 1, role: 'ADMIN' } };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it('should return 401 if no user on request', () => {
    req.user = null;
    const middleware = authorize('ADMIN');
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should return 403 if user role is not in allowed roles', () => {
    req.user.role = 'COLLABORATEUR';
    const middleware = authorize('ADMIN', 'MANAGER');
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should call next() if user role is in allowed roles', () => {
    req.user.role = 'ADMIN';
    const middleware = authorize('ADMIN', 'MANAGER');
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should work with multiple roles', () => {
    req.user.role = 'RH';
    const middleware = authorize('ADMIN', 'RH', 'MANAGER');
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should reject if role not in list of multiple roles', () => {
    req.user.role = 'COLLABORATEUR';
    const middleware = authorize('ADMIN', 'RH', 'MANAGER');
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// Révocation de session effective — approche token_version (audit vague 3, 3.C-1)
describe('authenticate — révocation par token_version', () => {
  let res, next;

  beforeEach(() => {
    db.query.mockReset();
    res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    next = jest.fn();
  });

  function reqWith(payload) {
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
    return { headers: { authorization: `Bearer ${token}` } };
  }

  it('accepte un token dont tv correspond à users.token_version', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ token_version: 3 }] });
    const req = reqWith({ id: 5, role: 'ADMIN', tv: 3 });
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('rejette (401 TOKEN_REVOKED) un token dont tv est périmé', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ token_version: 4 }] });
    const req = reqWith({ id: 5, role: 'ADMIN', tv: 3 });
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_REVOKED' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('coerce token_version NULL en 0 (tv=0 accepté)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ token_version: null }] });
    const req = reqWith({ id: 5, role: 'ADMIN', tv: 0 });
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('ne bloque pas si l\'utilisateur est introuvable (rows vide)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const req = reqWith({ id: 999, role: 'ADMIN', tv: 1 });
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('dégrade en accès autorisé si la base est indisponible (non-régression)', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const req = reqWith({ id: 5, role: 'ADMIN', tv: 2 });
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('ne consulte pas la base pour un token hérité sans tv (transitoire)', async () => {
    const req = reqWith({ id: 5, role: 'ADMIN' }); // pas de claim tv
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('supporte les tokens chauffeur (userId au lieu de id)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ token_version: 0 }] });
    const req = reqWith({ userId: 7, role: 'COLLABORATEUR', tv: 0 });
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('token_version'), [7]);
  });
});

// Politique de mot de passe unifiée (audit vague 3, 3.C-2)
describe('validatePassword', () => {
  it('refuse un mot de passe de moins de 10 caractères', () => {
    expect(validatePassword('court')).toBeTruthy();
    expect(validatePassword('123456789')).toBeTruthy(); // 9 caractères
  });

  it('accepte un mot de passe de 10 caractères ou plus', () => {
    expect(validatePassword('1234567890')).toBeNull();
    expect(validatePassword('un-mot-de-passe-assez-long')).toBeNull();
  });

  it('refuse une valeur vide ou non-chaîne', () => {
    expect(validatePassword('')).toBeTruthy();
    expect(validatePassword(null)).toBeTruthy();
    expect(validatePassword(undefined)).toBeTruthy();
    expect(validatePassword(12345678901)).toBeTruthy();
  });
});

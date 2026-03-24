const jwt = require('jsonwebtoken');

// Mock le module database avant d'importer auth
jest.mock('../../../src/config/database', () => ({
  query: jest.fn(),
}));

const { authenticate, authorize } = require('../../../src/middleware/auth');

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

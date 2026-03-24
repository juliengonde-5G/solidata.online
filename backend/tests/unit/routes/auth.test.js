const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

// Mock database pool
const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
}));

// On a besoin d'Express pour tester les routes
const express = require('express');
const request = require('supertest');

let app;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  const authRoutes = require('../../../src/routes/auth');
  app.use('/api/auth', authRoutes);
});

afterEach(() => {
  mockQuery.mockReset();
});

describe('POST /api/auth/login', () => {
  it('should return 400 if username is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'test123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('should return 400 if password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin' });
    expect(res.status).toBe(400);
  });

  it('should return 401 if user not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nonexistent', password: 'test123' });
    expect(res.status).toBe(401);
  });

  it('should return 401 if password is wrong', async () => {
    const passwordHash = await bcrypt.hash('correct_password', 10);
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, username: 'admin', password_hash: passwordHash, role: 'ADMIN', first_name: 'Test', last_name: 'User', is_active: true }],
    });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong_password' });
    expect(res.status).toBe(401);
  });

  it('should return tokens and user on successful login', async () => {
    const passwordHash = await bcrypt.hash('correct_password', 10);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 1, username: 'admin', password_hash: passwordHash, role: 'ADMIN', first_name: 'Test', last_name: 'User', email: 'admin@test.com', phone: null, team_id: null, is_active: true }],
      })
      .mockResolvedValueOnce({ rows: [] }); // INSERT refresh token

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'correct_password' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.username).toBe('admin');
    expect(res.body.user.role).toBe('ADMIN');

    // Verify JWT is valid
    const decoded = jwt.verify(res.body.accessToken, JWT_SECRET);
    expect(decoded.id).toBe(1);
    expect(decoded.role).toBe('ADMIN');
  });
});

describe('POST /api/auth/refresh', () => {
  it('should return 400 if no refreshToken provided', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({});
    expect(res.status).toBe(400);
  });

  it('should return 401 if refresh token is invalid', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'invalid_token' });
    expect(res.status).toBe(401);
  });

  it('should return new tokens on valid refresh', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ user_id: 1, username: 'admin', role: 'ADMIN', first_name: 'Test', last_name: 'User', token: 'old_token', expires_at: new Date(Date.now() + 86400000) }],
      })
      .mockResolvedValueOnce({ rows: [] }) // DELETE old token
      .mockResolvedValueOnce({ rows: [] }); // INSERT new token

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'valid_refresh_token' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });
});

describe('PUT /api/auth/password', () => {
  it('should return 401 without auth token', async () => {
    const res = await request(app)
      .put('/api/auth/password')
      .send({ currentPassword: 'old', newPassword: 'newpass' });
    expect(res.status).toBe(401);
  });

  it('should return 400 if currentPassword or newPassword missing', async () => {
    const token = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'old' });
    expect(res.status).toBe(400);
  });

  it('should return 400 if newPassword is too short', async () => {
    const token = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'old', newPassword: '123' });
    expect(res.status).toBe(400);
  });

  it('should return 401 if current password is wrong', async () => {
    const passwordHash = await bcrypt.hash('correct', 10);
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: passwordHash }] });

    const token = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrong', newPassword: 'newpassword123' });
    expect(res.status).toBe(401);
  });

  it('should change password successfully', async () => {
    const passwordHash = await bcrypt.hash('correct', 10);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ password_hash: passwordHash }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const token = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'correct', newPassword: 'newpassword123' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });
});

describe('POST /api/auth/logout', () => {
  it('should return 401 without auth token', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });

  it('should logout successfully with valid token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE refresh tokens
    const token = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/auth/me', () => {
  it('should return 401 without auth token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('should return user data with valid token', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, username: 'admin', email: 'admin@test.com', role: 'ADMIN', first_name: 'Test', last_name: 'User', phone: null, team_id: null, is_active: true, created_at: new Date() }],
    });
    const token = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('admin');
  });

  it('should return 404 if user no longer exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const token = jwt.sign({ id: 999, username: 'deleted', role: 'ADMIN', first_name: 'D', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

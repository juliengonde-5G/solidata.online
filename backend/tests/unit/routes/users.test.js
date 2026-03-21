const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
}));

const express = require('express');
const request = require('supertest');

let app;
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' }, JWT_SECRET, { expiresIn: '1h' });
const managerToken = jwt.sign({ id: 2, username: 'manager', role: 'MANAGER', first_name: 'M', last_name: 'G' }, JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign({ id: 3, username: 'collab', role: 'COLLABORATEUR', first_name: 'C', last_name: 'L' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  const usersRoutes = require('../../../src/routes/users');
  app.use('/api/users', usersRoutes);
});

afterEach(() => {
  mockQuery.mockReset();
});

describe('GET /api/users', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('should return 403 for non-admin', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(403);
  });

  it('should return users list for ADMIN', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, username: 'admin', role: 'ADMIN', first_name: 'Admin', last_name: 'User', is_active: true },
      ],
    });
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/users', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'new', password: 'test123', role: 'COLLABORATEUR' });
    expect(res.status).toBe(401);
  });

  it('should create a new user for ADMIN', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // CHECK existing username
      .mockResolvedValueOnce({
        rows: [{ id: 2, username: 'newuser', role: 'COLLABORATEUR', first_name: 'New', last_name: 'User', is_active: true }],
      });

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'newuser',
        password: 'password123',
        role: 'COLLABORATEUR',
        first_name: 'New',
        last_name: 'User',
      });
    expect(res.status).toBe(201);
    expect(res.body.username).toBe('newuser');
  });
});

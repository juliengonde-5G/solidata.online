const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
const mockConnect = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
  connect: () => mockConnect(),
}));

const express = require('express');
const request = require('supertest');

let app;
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' }, JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign({ id: 2, username: 'user', role: 'COLLABORATEUR', first_name: 'U', last_name: 'S' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  const stockRoutes = require('../../../src/routes/stock');
  app.use('/api/stock', stockRoutes);
});

afterEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

describe('GET /api/stock', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app).get('/api/stock');
    expect(res.status).toBe(401);
  });

  it('should return 403 for COLLABORATEUR role', async () => {
    const res = await request(app)
      .get('/api/stock')
      .set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(403);
  });

  it('should return stock movements for ADMIN', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, type: 'entree', poids_kg: 500, date: '2026-03-20' },
        { id: 2, type: 'sortie', poids_kg: 200, date: '2026-03-19' },
      ],
    });
    const res = await request(app)
      .get('/api/stock')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
  });

  it('should filter by type', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, type: 'entree', poids_kg: 500 }] });
    const res = await request(app)
      .get('/api/stock?type=entree')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    // Verify the query was called with the type filter
    expect(mockQuery.mock.calls[0][1]).toContain('entree');
  });
});

describe('GET /api/stock/summary', () => {
  it('should return stock summary', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ categorie: 'Crème', total_entrees_kg: 1000, total_sorties_kg: 300, solde_kg: 700, nb_mouvements: 10 }],
      })
      .mockResolvedValueOnce({
        rows: [{ total_entrees: 1000, total_sorties: 300, stock_actuel: 700 }],
      });
    const res = await request(app)
      .get('/api/stock/summary?period=30')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.byCategory).toBeDefined();
    expect(res.body.totals).toBeDefined();
  });
});

describe('POST /api/stock', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app)
      .post('/api/stock')
      .send({ type: 'entree', date: '2026-03-20', poids_kg: 500 });
    expect(res.status).toBe(401);
  });

  it('should return 400 if required fields missing', async () => {
    const res = await request(app)
      .post('/api/stock')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ poids_kg: 500 });
    expect(res.status).toBe(400);
  });

  it('should create a stock movement', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, type: 'entree', date: '2026-03-20', poids_kg: 500 }],
    });

    const res = await request(app)
      .post('/api/stock')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'entree', date: '2026-03-20', poids_kg: 500 });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('entree');
  });
});

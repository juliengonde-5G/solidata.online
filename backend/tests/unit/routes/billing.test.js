const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
}));

const express = require('express');
const request = require('supertest');

let app;
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' }, JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign({ id: 2, username: 'user', role: 'COLLABORATEUR', first_name: 'U', last_name: 'S' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  const billingRoutes = require('../../../src/routes/billing');
  app.use('/api/billing', billingRoutes);
});

afterEach(() => {
  mockQuery.mockReset();
});

describe('GET /api/billing', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app).get('/api/billing');
    expect(res.status).toBe(401);
  });

  it('should return 403 for non-admin/manager', async () => {
    const res = await request(app)
      .get('/api/billing')
      .set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(403);
  });

  it('should return invoices list for ADMIN', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, invoice_number: 'FAC-2026-0001', status: 'draft', total_ttc: 1200.50 },
      ],
    });
    const res = await request(app)
      .get('/api/billing')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should filter by status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/billing?status=paid')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toContain('paid');
  });
});

describe('GET /api/billing/:id', () => {
  it('should return 404 if invoice not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/billing/999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('should return invoice with lines', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, invoice_number: 'FAC-2026-0001', status: 'draft' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, description: 'Balles crème', quantity: 10, unit_price_ht: 100 }] });

    const res = await request(app)
      .get('/api/billing/1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.lines).toBeDefined();
  });
});

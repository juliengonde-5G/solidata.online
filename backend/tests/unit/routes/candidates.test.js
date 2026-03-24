const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
const mockConnect = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
  connect: () => mockConnect(),
}));

// Mock tesseract.js et job-queue pour éviter les imports lourds
jest.mock('../../../src/services/job-queue', () => ({
  addOcrJob: jest.fn().mockResolvedValue(null),
}));

const express = require('express');
const request = require('supertest');

let app;
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' }, JWT_SECRET, { expiresIn: '1h' });
const rhToken = jwt.sign({ id: 2, username: 'rh', role: 'RH', first_name: 'R', last_name: 'H' }, JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign({ id: 3, username: 'collab', role: 'COLLABORATEUR', first_name: 'C', last_name: 'L' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  const candidatesRoutes = require('../../../src/routes/candidates');
  app.use('/api/candidates', candidatesRoutes);
});

afterEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

describe('GET /api/candidates', () => {
  it('should return 401 without auth', async () => {
    const res = await request(app).get('/api/candidates');
    expect(res.status).toBe(401);
  });

  it('should return 403 for COLLABORATEUR', async () => {
    const res = await request(app)
      .get('/api/candidates')
      .set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(403);
  });

  it('should return candidates list for RH', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, first_name: 'Jean', last_name: 'Dupont', status: 'received' },
        { id: 2, first_name: 'Marie', last_name: 'Martin', status: 'interview' },
      ],
    });
    const res = await request(app)
      .get('/api/candidates')
      .set('Authorization', `Bearer ${rhToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
  });

  it('should filter by status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, status: 'received' }] });
    const res = await request(app)
      .get('/api/candidates?status=received')
      .set('Authorization', `Bearer ${rhToken}`);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toContain('received');
  });
});

describe('GET /api/candidates/:id', () => {
  it('should return 404 if candidate not found', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // candidate query
      .mockResolvedValueOnce({ rows: [] }); // skills query (may or may not be called)
    const res = await request(app)
      .get('/api/candidates/999')
      .set('Authorization', `Bearer ${rhToken}`);
    expect(res.status).toBe(404);
  });

  it('should return candidate details', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 1, first_name: 'Jean', last_name: 'Dupont', status: 'received', email: 'jean@test.com' }],
      })
      .mockResolvedValueOnce({ rows: [{ skill: 'Tri textile' }] }) // skills
      .mockResolvedValueOnce({ rows: [] }) // history
      .mockResolvedValueOnce({ rows: [] }); // interviews
    const res = await request(app)
      .get('/api/candidates/1')
      .set('Authorization', `Bearer ${rhToken}`);
    expect(res.status).toBe(200);
    expect(res.body.first_name).toBe('Jean');
  });
});

describe('POST /api/candidates', () => {
  it('should create a candidate', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, first_name: 'Jean', last_name: 'Dupont', status: 'received' }] }) // INSERT
      .mockResolvedValueOnce({ rows: [] }) // history INSERT
      .mockResolvedValueOnce({ rows: [] }) // getSkillPatterns query
      .mockResolvedValue({ rows: [] }); // skill inserts
    const res = await request(app)
      .post('/api/candidates')
      .set('Authorization', `Bearer ${rhToken}`)
      .send({ first_name: 'Jean', last_name: 'Dupont', phone: '0612345678' });
    expect(res.status).toBe(201);
    expect(res.body.first_name).toBe('Jean');
  });
});

describe('PUT /api/candidates/:id/status', () => {
  it('should update candidate status', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'received' }] }) // check exists
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'interview' }] }) // update
      .mockResolvedValueOnce({ rows: [] }); // history log
    const res = await request(app)
      .put('/api/candidates/1/status')
      .set('Authorization', `Bearer ${rhToken}`)
      .send({ status: 'interview' });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/candidates/stats', () => {
  it('should return statistics', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'received', count: 10 }, { status: 'recruited', count: 8 }] }) // counts by status
      .mockResolvedValueOnce({ rows: [{ count: 30 }] }) // total
      .mockResolvedValueOnce({ rows: [{ count: 5 }] }) // thisMonth
      .mockResolvedValueOnce({ rows: [{ count: 12 }] }); // withPCM
    const res = await request(app)
      .get('/api/candidates/stats')
      .set('Authorization', `Bearer ${rhToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(30);
    expect(res.body.byStatus).toBeDefined();
  });
});

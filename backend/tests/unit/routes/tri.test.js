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
const collabToken = jwt.sign({ id: 2, username: 'u', role: 'COLLABORATEUR', first_name: 'U', last_name: 'S' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tri', require('../../../src/routes/tri'));
});

afterEach(() => mockQuery.mockReset());

describe('GET /api/tri/batches/:id — traçabilité lot → cartons', () => {
  it('401 sans auth', async () => {
    const res = await request(app).get('/api/tri/batches/7');
    expect(res.status).toBe(401);
  });

  it('lecture ouverte à un COLLABORATEUR authentifié (opérateur de poste)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, code: 'LOT-ABC', poids_initial_kg: 300 }] }) // batch
      .mockResolvedValueOnce({ rows: [] }) // executions
      .mockResolvedValueOnce({ rows: [] }); // cartons
    const res = await request(app).get('/api/tri/batches/7').set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(200);
  });

  it('404 si le lot n’existe pas', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // batch introuvable
    const res = await request(app).get('/api/tri/batches/999').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('renvoie le lot avec ses exécutions ET ses cartons rattachés', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, code: 'LOT-ABC', chaine_nom: 'Chaîne Qualité', poids_initial_kg: 300 }] }) // batch
      .mockResolvedValueOnce({ rows: [{ id: 10, operation_nom: 'Crackage' }] }) // executions
      .mockResolvedValueOnce({ rows: [] }) // outputs de l'exec 10
      .mockResolvedValueOnce({ rows: [ // cartons rattachés (batch_id = 7)
        { id: 1, code_barre: 'P10001', produit: 'Pull', poids_kg: 12, status: 'en_stock', sortie_commande_type: null, date_sortie: null },
        { id: 2, code_barre: 'P10002', produit: 'Jean', poids_kg: 15, status: 'expedie', sortie_commande_type: 'btq', date_sortie: '2026-07-01T09:00:00Z' },
      ] });
    const res = await request(app).get('/api/tri/batches/7').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('LOT-ABC');
    expect(Array.isArray(res.body.cartons)).toBe(true);
    expect(res.body.cartons).toHaveLength(2);
    expect(res.body.cartons[1].sortie_commande_type).toBe('btq');
    expect(res.body.executions[0].outputs).toEqual([]);
  });
});

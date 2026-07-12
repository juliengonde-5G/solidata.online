// Tests Vague 1 — Stock : régularisation d'inventaire (item 29) +
// correction auditée des mouvements par contre-écriture (item 30).
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockClientQuery(...a), release: mockRelease }),
}));

const express = require('express');
const request = require('supertest');

let app;
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/stock', require('../../../src/routes/stock'));
});

afterEach(() => { mockQuery.mockReset(); mockClientQuery.mockReset(); mockRelease.mockReset(); });

describe('POST /api/stock/movements/:id/cancel (item 30 — contre-écriture)', () => {
  it('refuse sans motif (400)', async () => {
    const res = await request(app)
      .post('/api/stock/movements/5/cancel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('crée une contre-écriture de type opposé (201)', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 5, type: 'entree', poids_kg: 100, date: '2026-07-01', matiere_id: 3, destination: null, code_barre: null, reversed_of_id: null, reversal_movement_id: null }] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 6, type: 'sortie', poids_kg: 100, reversed_of_id: 5 }] }) // INSERT contre-écriture
      .mockResolvedValueOnce({}) // UPDATE original
      .mockResolvedValueOnce({}); // COMMIT
    const res = await request(app)
      .post('/api/stock/movements/5/cancel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ motif: 'erreur de saisie' });
    expect(res.status).toBe(201);
    expect(res.body.original_id).toBe(5);
    expect(res.body.reversal.type).toBe('sortie');
    const insertCall = mockClientQuery.mock.calls.find(c => /INSERT INTO stock_movements/.test(c[0]));
    expect(insertCall[1][0]).toBe('sortie'); // type opposé à 'entree'
    expect(insertCall[1]).toContain('erreur de saisie'); // motif tracé
  });

  it('renvoie 409 si le mouvement est déjà annulé', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 5, type: 'entree', poids_kg: 100, reversed_of_id: null, reversal_movement_id: 9 }] }) // SELECT
      .mockResolvedValueOnce({}); // ROLLBACK
    const res = await request(app)
      .post('/api/stock/movements/5/cancel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ motif: 'x' });
    expect(res.status).toBe(409);
    expect(mockClientQuery.mock.calls.at(-1)[0]).toMatch(/ROLLBACK/);
  });

  it('refuse d\'annuler une contre-écriture (400)', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 6, type: 'sortie', reversed_of_id: 5, reversal_movement_id: null }] }) // SELECT
      .mockResolvedValueOnce({}); // ROLLBACK
    const res = await request(app)
      .post('/api/stock/movements/6/cancel')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ motif: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/stock/inventories/:id/validate (item 29 — régularisation)', () => {
  it('pose une régularisation par catégorie comptée avec écart, dans le bon sens', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 2, code: 'INV-P-20260712', status: 'valide' }] }) // UPDATE batch RETURNING
      .mockResolvedValueOnce({ rows: [
        { id: 10, categorie_sortante_id: 3, categorie_nom: 'Crème', stock_theorique_kg: 100, stock_physique_kg: 120, ecart_kg: 20 },
        { id: 11, categorie_sortante_id: 4, categorie_nom: 'Chiffon', stock_theorique_kg: 50, stock_physique_kg: 50, ecart_kg: 0 },
        { id: 12, categorie_sortante_id: 5, categorie_nom: 'CSR', stock_theorique_kg: 80, stock_physique_kg: 60, ecart_kg: -20 },
      ] }) // SELECT items comptés
      .mockResolvedValueOnce({ rows: [{ id: 100, type: 'entree', date: '2026-07-12', poids_kg: 20, matiere_id: 3, notes: 'x' }] }) // INSERT regul cat 3
      .mockResolvedValueOnce({ rows: [{ id: 101, type: 'sortie', date: '2026-07-12', poids_kg: 20, matiere_id: 5, notes: 'x' }] }) // INSERT regul cat 5
      .mockResolvedValueOnce({}); // COMMIT
    const res = await request(app)
      .post('/api/stock/inventories/2/validate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.regularisations).toHaveLength(2); // la ligne à écart 0 est ignorée
    const inserts = mockClientQuery.mock.calls.filter(c => /INSERT INTO stock_movements/.test(c[0]));
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1][0]).toBe('entree'); // écart +20 → entrée
    expect(inserts[1][1][0]).toBe('sortie'); // écart -20 → sortie
  });

  it('renvoie 404 (et ne régularise pas) si déjà validé', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // UPDATE batch → 0 (déjà validé)
      .mockResolvedValueOnce({}); // ROLLBACK
    const res = await request(app)
      .post('/api/stock/inventories/2/validate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(404);
    const inserts = mockClientQuery.mock.calls.filter(c => /INSERT INTO stock_movements/.test(c[0]));
    expect(inserts).toHaveLength(0);
  });
});

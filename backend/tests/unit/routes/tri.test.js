const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
  connect: async () => ({ query: (...args) => mockClientQuery(...args), release: mockRelease }),
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

afterEach(() => { mockQuery.mockReset(); mockClientQuery.mockReset(); mockRelease.mockReset(); });

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

describe('PUT /api/tri/executions/:id/complete — reversement stock trié (I4)', () => {
  it('404 si l’exécution n’existe pas (ROLLBACK)', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // exec FOR UPDATE → introuvable
      .mockResolvedValueOnce({}); // ROLLBACK
    const res = await request(app).put('/api/tri/executions/9/complete')
      .set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(404);
    expect(mockClientQuery.mock.calls.at(-1)[0]).toMatch(/ROLLBACK/);
  });

  it('409 si l’opération est déjà terminée (idempotence anti double-comptage)', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 9, status: 'termine', batch_id: 3, batch_code: 'LOT-X', poids_entree_kg: 100 }] })
      .mockResolvedValueOnce({}); // ROLLBACK
    const res = await request(app).put('/api/tri/executions/9/complete')
      .set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(409);
  });

  it('termine l’exécution et crée une entrée de stock par sortie catégorisée', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 9, status: 'en_cours', batch_id: 3, batch_code: 'LOT-X', poids_entree_kg: 100 }] }) // exec
      .mockResolvedValueOnce({ rows: [ // outputs
        { id: 1, poids_kg: 60, categorie_sortante_id: 5 },
        { id: 2, poids_kg: 30, categorie_sortante_id: 8 },
        { id: 3, poids_kg: 5, categorie_sortante_id: null }, // sans catégorie → pas d'entrée stock
      ] })
      .mockResolvedValueOnce({ rows: [{ id: 9, status: 'termine', poids_sortie_total_kg: 90, perte_kg: 10 }] }) // UPDATE exec
      .mockResolvedValueOnce({}) // UPDATE batch
      .mockResolvedValueOnce({}) // INSERT stock (cat 5)
      .mockResolvedValueOnce({}) // INSERT stock (cat 8)
      .mockResolvedValueOnce({}); // COMMIT
    const res = await request(app).put('/api/tri/executions/9/complete')
      .set('Authorization', `Bearer ${adminToken}`).send({ notes: 'ok' });
    expect(res.status).toBe(200);
    expect(res.body.stock_lines_created).toBe(2); // seulement les 2 sorties catégorisées
    // Les INSERT stock ciblent categories_sortantes via matiere_id
    const inserts = mockClientQuery.mock.calls.filter(c => /INSERT INTO stock_movements/.test(c[0]));
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]).toContain(5); // matiere_id = categorie_sortante_id 5
    expect(mockClientQuery.mock.calls.at(-1)[0]).toMatch(/COMMIT/);
  });
});

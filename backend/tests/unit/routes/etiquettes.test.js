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

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/etiquettes', require('../../../src/routes/etiquettes'));
});

afterEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockRelease.mockReset();
});

const validBody = {
  poste_id: 1, produit: 'Pull', categorie_eco_org: 'TLC', genre: 'Homme',
  saison: 'Hiver', gamme: 'STANDARD', poids_kg: 10,
};

describe('POST /api/etiquettes/generer — lien carton → lot (batch_id)', () => {
  it('refuse sans authentification (401)', async () => {
    const res = await request(app).post('/api/etiquettes/generer').send(validBody);
    expect(res.status).toBe(401);
  });

  it('rejette un batch_id introuvable ou clôturé (400) et ROLLBACK', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, numero_poste: 1, compteur_actuel: 0 }] }) // poste FOR UPDATE
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // batch validation → introuvable
      .mockResolvedValueOnce({}); // ROLLBACK
    const res = await request(app)
      .post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validBody, batch_id: 999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lot/i);
    // Dernier appel client = ROLLBACK
    expect(mockClientQuery.mock.calls.at(-1)[0]).toMatch(/ROLLBACK/);
  });

  it('rattache un lot valide et renvoie batch_id (201)', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, numero_poste: 1, compteur_actuel: 0 }] }) // poste
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 7 }] }) // batch valide (en_cours)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5 }] }) // catalogue existant
      .mockResolvedValueOnce({ rows: [{ id: 1, code_barre: 'P10001', poids_kg: 10, batch_id: 7 }] }) // INSERT PF
      .mockResolvedValueOnce({}) // UPDATE poste
      .mockResolvedValueOnce({}); // COMMIT
    const res = await request(app)
      .post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validBody, batch_id: 7 });
    expect(res.status).toBe(201);
    expect(res.body.batch_id).toBe(7);
    // L'INSERT produits_finis reçoit bien le batch_id (avant-dernier param)
    const insertCall = mockClientQuery.mock.calls.find(c => /INSERT INTO produits_finis/.test(c[0]));
    expect(insertCall).toBeTruthy();
    expect(insertCall[1]).toContain(7);
  });

  it('fonctionne sans batch_id (rétrocompatible, batch non validé)', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1, numero_poste: 1, compteur_actuel: 0 }] }) // poste
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 5 }] }) // catalogue existant (pas de requête batch)
      .mockResolvedValueOnce({ rows: [{ id: 2, code_barre: 'P10002', poids_kg: 10, batch_id: null }] }) // INSERT PF
      .mockResolvedValueOnce({}) // UPDATE poste
      .mockResolvedValueOnce({}); // COMMIT
    const res = await request(app)
      .post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.batch_id).toBeNull();
    // Aucune requête de validation de lot n'a été émise
    const batchValidation = mockClientQuery.mock.calls.find(c => /FROM batch_tracking/.test(c[0]));
    expect(batchValidation).toBeFalsy();
  });
});

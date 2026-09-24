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
  poste_id: 1, gamme: 'VAK', categorie_eco_org: 'Textiles', produit_id: 12,
  genre: 'Adulte Femme', saison: 'Hiver', poids_kg: 10,
};

// Routage SQL du client de transaction (codification v2, 2.57.0).
function routerClient({ batch }) {
  mockClientQuery.mockImplementation(async (text, params = []) => {
    const s = String(text);
    if (/FROM etiquettes_combinaisons c/.test(s)) {
      return { rowCount: 1, rows: [{
        combinaison_id: 1, gamme: 'VAK', categorie_eco_org: 'Textiles', produit_id: 12, produit: 'Paréos',
        genre: 'Adulte Femme', saison: 'Hiver', gamme_code: 3, categorie_code: 1, produit_code: 42, genre_code: 2, saison_code: 2,
      }] };
    }
    if (/FROM postes_etiquetage/.test(s)) return { rowCount: 1, rows: [{ id: 1, numero_poste: 1 }] };
    if (/FROM batch_tracking/.test(s)) return batch ? { rowCount: 1, rows: [{ id: batch }] } : { rowCount: 0, rows: [] };
    if (/nextval/.test(s)) return { rows: [{ ref: '1' }] };
    if (/FROM produits_catalogue/.test(s)) return { rowCount: 1, rows: [{ id: 5 }] };
    if (/INSERT INTO produits_finis/.test(s)) {
      return { rows: [{ id: 1, code_barre: params[0], codification: 'v2', poids_kg: 10, batch_id: params[9], nb_impressions: 1 }] };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('POST /api/etiquettes/generer — lien carton → lot (batch_id)', () => {
  it('refuse sans authentification (401)', async () => {
    const res = await request(app).post('/api/etiquettes/generer').send(validBody);
    expect(res.status).toBe(401);
  });

  it('rejette un batch_id introuvable ou clôturé (400) et ROLLBACK', async () => {
    routerClient({ batch: null });
    const res = await request(app)
      .post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validBody, batch_id: 999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lot/i);
    expect(mockClientQuery.mock.calls.at(-1)[0]).toMatch(/ROLLBACK/);
    expect(mockClientQuery.mock.calls.some((c) => /INSERT INTO produits_finis/.test(c[0]))).toBe(false);
  });

  it('rattache un lot valide et renvoie batch_id (201)', async () => {
    routerClient({ batch: 7 });
    const res = await request(app)
      .post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validBody, batch_id: 7 });
    expect(res.status).toBe(201);
    expect(res.body.batch_id).toBe(7);
    const insertCall = mockClientQuery.mock.calls.find(c => /INSERT INTO produits_finis/.test(c[0]));
    expect(insertCall).toBeTruthy();
    expect(insertCall[1][9]).toBe(7);
    expect(res.body.code_barre).toBe('312A022000001');
  });

  it('fonctionne sans batch_id (lot non validé)', async () => {
    routerClient({ batch: null });
    const res = await request(app)
      .post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.batch_id).toBeNull();
    const batchValidation = mockClientQuery.mock.calls.find(c => /FROM batch_tracking/.test(c[0]));
    expect(batchValidation).toBeFalsy();
  });

  it('batch_id non entier → 400 PARAMETRES avant toute transaction', async () => {
    const res = await request(app)
      .post('/api/etiquettes/generer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validBody, batch_id: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PARAMETRES');
    expect(mockClientQuery).not.toHaveBeenCalled();
  });
});

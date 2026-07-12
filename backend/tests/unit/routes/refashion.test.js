const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
  connect: jest.fn(),
}));

const express = require('express');
const request = require('supertest');

let app;
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' }, JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign({ id: 2, username: 'user', role: 'COLLABORATEUR', first_name: 'U', last_name: 'S' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  const refashionRoutes = require('../../../src/routes/refashion');
  app.use('/api/refashion', refashionRoutes);
});

afterEach(() => {
  mockQuery.mockReset();
});

// Item 26 — le filtre trimestre ne doit s'appliquer qu'aux vues qui portent une
// colonne trimestre. Les vues mensuelles (annee + mois) crashaient auparavant
// en 500 « column "trimestre" does not exist » dès qu'un trimestre était choisi.
describe('GET /api/refashion/exports/:slug (garde filtre trimestre)', () => {
  it('rejette sans auth (401)', async () => {
    const res = await request(app).get('/api/refashion/exports/dpav-sortants');
    expect(res.status).toBe(401);
  });

  it('rejette un COLLABORATEUR (403)', async () => {
    const res = await request(app)
      .get('/api/refashion/exports/dpav-sortants')
      .set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(403);
  });

  it('404 sur un slug inconnu', async () => {
    const res = await request(app)
      .get('/api/refashion/exports/inexistant')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('applique le filtre trimestre sur vw_dpav_sortants (vue trimestrielle)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/refashion/exports/dpav-sortants?annee=2026&trimestre=1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0][0];
    const params = mockQuery.mock.calls[0][1];
    expect(sql).toContain('vw_dpav_sortants');
    expect(sql).toContain('trimestre =');
    expect(params).toEqual([2026, 1]);
  });

  it('N\'applique PAS le filtre trimestre sur vw_coherence_tri_filiere (vue mensuelle)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/refashion/exports/coherence-tri-filiere?annee=2026&trimestre=1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0][0];
    const params = mockQuery.mock.calls[0][1];
    expect(sql).toContain('vw_coherence_tri_filiere');
    expect(sql).not.toContain('trimestre');
    // seul le filtre annee subsiste
    expect(params).toEqual([2026]);
  });

  it('N\'applique PAS le filtre trimestre sur vw_subvention_refashion_mensuelle', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/refashion/exports/subvention-mensuelle?annee=2026&trimestre=3')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).not.toContain('trimestre');
  });

  it('exporte en CSV avec entêtes de fichier', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ annee: 2026, trimestre: 1, tonnage_t: 1.5 }] });
    const res = await request(app)
      .get('/api/refashion/exports/dpav-sortants?annee=2026&format=csv')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('annee;trimestre;tonnage_t');
  });
});

describe('GET /api/refashion/exports (catalogue)', () => {
  it('expose trimestre_filtrable par export', async () => {
    const res = await request(app)
      .get('/api/refashion/exports')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const bySlug = Object.fromEntries(res.body.map(e => [e.slug, e]));
    expect(bySlug['dpav-sortants'].trimestre_filtrable).toBe(true);
    expect(bySlug['dpav-communes'].trimestre_filtrable).toBe(true);
    expect(bySlug['coherence-tri-filiere'].trimestre_filtrable).toBe(false);
    expect(bySlug['subvention-mensuelle'].trimestre_filtrable).toBe(false);
    expect(bySlug['tonnage-annuel-tournee'].trimestre_filtrable).toBe(false);
  });
});

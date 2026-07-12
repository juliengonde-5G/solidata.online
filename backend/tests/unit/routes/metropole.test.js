const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
}));

const express = require('express');
const request = require('supertest');

let app;
let metropoleRoutes;
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' }, JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign({ id: 2, username: 'user', role: 'COLLABORATEUR', first_name: 'U', last_name: 'S' }, JWT_SECRET, { expiresIn: '1h' });
const autoriteToken = jwt.sign({ id: 3, username: 'metro', role: 'AUTORITE', first_name: 'M', last_name: 'R' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  metropoleRoutes = require('../../../src/routes/metropole');
  app.use('/api/metropole', metropoleRoutes);
});

afterEach(() => {
  mockQuery.mockReset();
});

// ── Contrat HTTP de /captation-par-commune ────────────────────────────────
describe('GET /api/metropole/captation-par-commune', () => {
  it('renvoie 401 sans authentification', async () => {
    const res = await request(app).get('/api/metropole/captation-par-commune');
    expect(res.status).toBe(401);
  });

  it('renvoie 403 pour un COLLABORATEUR', async () => {
    const res = await request(app)
      .get('/api/metropole/captation-par-commune')
      .set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(403);
  });

  it('renvoie 200 pour le rôle AUTORITE (Métropole)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { commune: 'ROUEN', code_insee: '76540', epci_nom: 'Métropole Rouen Normandie', population: 110000, poids_kg: 4200, nb_tournees: 12, nb_cav: 8, kg_par_hab: 0.038 },
        { commune: '(non rattaché)', code_insee: null, epci_nom: null, population: null, poids_kg: 900, nb_tournees: 3, nb_cav: 2, kg_par_hab: null },
      ],
    });
    const res = await request(app)
      .get('/api/metropole/captation-par-commune?annee=2026')
      .set('Authorization', `Bearer ${autoriteToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].commune).toBe('ROUEN');
    // la ligne « non rattaché » (code_insee null) est bien exposée pour un affichage honnête
    expect(res.body.some((r) => r.code_insee == null)).toBe(true);
  });

  it('utilise des CTE séparées (poids_tour + cav_par_tour) — pas de produit cartésien', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app)
      .get('/api/metropole/captation-par-commune?annee=2026')
      .set('Authorization', `Bearer ${adminToken}`);
    const sql = mockQuery.mock.calls[0][0];
    // Preuve anti-régression : le poids est réparti via NULLIF(nb_cav_collectes...)
    // et NON via un SUM(tw.weight_kg) joint directement à tour_cav.
    expect(sql).toContain('poids_tour');
    expect(sql).toContain('cav_par_tour');
    expect(sql).toMatch(/NULLIF\(cpt\.nb_cav_collectes/);
    expect(sql).not.toMatch(/SUM\(tw\.weight_kg\)/);
  });
});

// ── Oracle de calcul du prorata (spécification exécutable) ─────────────────
describe('distributeTonnageProrata (répartition au prorata)', () => {
  const distribute = () => metropoleRoutes.distributeTonnageProrata;

  it('est exportée par le module', () => {
    expect(typeof distribute()).toBe('function');
  });

  it('répartit le poids d\'une tournée sans le gonfler (cas de l\'audit)', () => {
    // 300 kg, 15 CAV collectés : 10 ROUEN, 3 SOTTEVILLE, 2 BOIS
    const communes = [
      ...Array(10).fill('ROUEN'),
      ...Array(3).fill('SOTTEVILLE'),
      ...Array(2).fill('BOIS'),
    ];
    const res = distribute()([{ poids_net: 300, communes }]);
    expect(res.ROUEN).toBeCloseTo(200, 6);
    expect(res.SOTTEVILLE).toBeCloseTo(60, 6);
    expect(res.BOIS).toBeCloseTo(40, 6);
    // Invariant central : la somme répartie = le poids net (aucune inflation)
    const total = Object.values(res).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(300, 6);
  });

  it('additionne plusieurs tournées commune par commune', () => {
    const res = distribute()([
      { poids_net: 200, communes: ['ROUEN', 'ROUEN', 'SOTTEVILLE', 'SOTTEVILLE'] }, // 100 / 100
      { poids_net: 90, communes: ['ROUEN', 'BOIS', 'BOIS'] }, // 30 / 60
    ]);
    expect(res.ROUEN).toBeCloseTo(130, 6);
    expect(res.SOTTEVILLE).toBeCloseTo(100, 6);
    expect(res.BOIS).toBeCloseTo(60, 6);
    const total = Object.values(res).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(290, 6); // 200 + 90
  });

  it('ignore une tournée sans CAV collecté (poids non attribuable)', () => {
    const res = distribute()([{ poids_net: 500, communes: [] }]);
    expect(Object.keys(res)).toHaveLength(0);
  });

  it('regroupe les CAV sans commune sous « (non rattaché) »', () => {
    const res = distribute()([{ poids_net: 100, communes: ['ROUEN', null, ''] }]);
    expect(res.ROUEN).toBeCloseTo(100 / 3, 6);
    expect(res['(non rattaché)']).toBeCloseTo((100 / 3) * 2, 6);
  });

  it('tolère une entrée vide ou nulle', () => {
    expect(distribute()(null)).toEqual({});
    expect(distribute()([])).toEqual({});
  });
});

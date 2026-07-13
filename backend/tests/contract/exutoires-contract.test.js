// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — module LOGISTIQUE EXUTOIRES (Vague 3, item 3.A)
// ───────────────────────────────────────────────────────────────────────────
// Constat T3 de l'audit : contrats front/back désalignés qui échouent en
// silence. La page des commandes affichait « — » sur ses cartes KPI parce que
// le back renvoie total_tonnage_prevu / total_ca_prevu alors que le front lit
// ces clés (vagues 0-1 : alignement des noms).
//
// Ce test verrouille la forme de GET /commandes-exutoires/stats.
// Réf. rapports : technique/logistique-exutoires.md.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
const mockConnect = jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} }));
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

let app;
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/commandes-exutoires', require('../../src/routes/commandes-exutoires'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path) => request(app).get(path).set('Authorization', `Bearer ${adminToken}`);

// ───────────────────────────────────────────────────────────────────────────
// GET /commandes-exutoires/stats
// Écran : ExutoiresCommandes.jsx (lignes 162-171 : d.total_tonnage_prevu →
//         tonnage_prevu, d.total_ca_prevu → ca_previsionnel). Sans ces clés
//         EXACTES, les cartes KPI « Tonnage prévu » / « CA prévisionnel »
//         retombent sur 0 (comportement pré-vague).
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /commandes-exutoires/stats (ExutoiresCommandes.jsx)', () => {
  const wire = (sql) => {
    const s = String(sql);
    if (/GROUP BY statut/.test(s)) return Promise.resolve({ rows: [
      { statut: 'confirmee', count: 3 },
      { statut: 'cloturee', count: 5 },
    ] });
    if (/total_tonnage_prevu/.test(s)) return Promise.resolve({ rows: [
      { total_tonnage_prevu: '123.5', total_ca_prevu: '45000' },
    ] });
    return Promise.resolve({ rows: [] });
  };

  it('expose total_tonnage_prevu et total_ca_prevu comme des NOMBRES', async () => {
    mockQuery.mockImplementation(wire);
    const res = await get('/api/commandes-exutoires/stats');
    expect(res.status).toBe(200);
    // le front fait `d.total_tonnage_prevu ?? 0` : la clé doit exister et être un nombre
    expect(typeof res.body.total_tonnage_prevu).toBe('number');
    expect(res.body.total_tonnage_prevu).toBe(123.5);
    expect(typeof res.body.total_ca_prevu).toBe('number');
    expect(res.body.total_ca_prevu).toBe(45000);
  });

  it('expose count_by_statut : tableau de { statut, count }', async () => {
    mockQuery.mockImplementation(wire);
    const { body } = await get('/api/commandes-exutoires/stats');
    expect(Array.isArray(body.count_by_statut)).toBe(true);
    for (const row of body.count_by_statut) {
      expect(typeof row.statut).toBe('string');
      expect(typeof row.count).toBe('number');
    }
  });

  it('ne renvoie pas NaN quand les tables sont vides (COALESCE → 0)', async () => {
    // Défaut [] : totaux.rows[0] absent ferait planter — le handler renvoie 0
    // grâce à COALESCE côté SQL ; on simule le retour SQL réel (une ligne à 0).
    mockQuery.mockImplementation((sql) => {
      if (/total_tonnage_prevu/.test(String(sql))) return Promise.resolve({ rows: [{ total_tonnage_prevu: '0', total_ca_prevu: '0' }] });
      return Promise.resolve({ rows: [] });
    });
    const { body } = await get('/api/commandes-exutoires/stats');
    expect(Number.isNaN(body.total_tonnage_prevu)).toBe(false);
    expect(Number.isNaN(body.total_ca_prevu)).toBe(false);
    expect(body.total_tonnage_prevu).toBe(0);
  });
});

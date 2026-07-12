// Résiduel v1-2 (item 40) — Recopie permis B / CACES du candidat vers le
// collaborateur AU MOMENT DU LIEN (flux au fil de l'eau). OR logique :
// jamais de rétrogradation d'une valeur saisie côté RH.
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
const clientQuery = jest.fn();
const mockConnect = jest.fn(async () => ({ query: (...a) => clientQuery(...a), release: () => {} }));
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));

const express = require('express');
const request = require('supertest');

let app;
const rhToken = jwt.sign({ id: 7, username: 'rh', role: 'RH' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  // Le routeur candidates applique authenticate au niveau parent avant de monter
  // ses sous-routeurs ; on le reproduit ici pour tester conversion isolément.
  const { authenticate } = require('../../../src/middleware/auth');
  const conversionRouter = require('../../../src/routes/candidates/conversion');
  app.use('/api/candidates', authenticate, conversionRouter);
});

afterEach(() => { mockQuery.mockReset(); clientQuery.mockReset(); mockConnect.mockClear(); });

// Séquence des client.query() d'un link-employee réussi :
// cand, emp, other(conflit), BEGIN, UPDATE candidate_id, UPDATE skills,
// INSERT diagnostics, INSERT history, COMMIT. Puis pool.query = updated SELECT.
function setupLinkSequence({ cand, emp }) {
  clientQuery
    .mockResolvedValueOnce({ rows: [cand] })
    .mockResolvedValueOnce({ rows: [emp] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({});
  mockQuery.mockResolvedValueOnce({ rows: [{ id: emp.id, candidate_id: cand.id }] });
}

const historyCall = () => clientQuery.mock.calls.find((c) => /INSERT INTO candidate_history/.test(c[0]));
const skillUpdateCall = () => clientQuery.mock.calls.find((c) => /has_permis_b\s*=\s*\(COALESCE/.test(c[0]));

describe('POST /api/candidates/:id/link-employee — recopie permis B / CACES', () => {
  it('recopie permis B (false→true) + trace la note dans candidate_history', async () => {
    setupLinkSequence({
      cand: { id: 1, first_name: 'Jean', last_name: 'Dupont', status: 'hired', has_permis_b: true, has_caces: false },
      emp: { id: 10, candidate_id: null, first_name: 'Jean', last_name: 'Dupont', has_permis_b: false, has_caces: false },
    });
    const res = await request(app).post('/api/candidates/1/link-employee')
      .set('Authorization', `Bearer ${rhToken}`).send({ employee_id: 10 });
    expect(res.status).toBe(200);
    const su = skillUpdateCall();
    expect(su).toBeTruthy();
    expect(su[0]).toMatch(/has_caces\s*=\s*\(COALESCE/); // OR logique sur les deux
    expect(su[1]).toEqual([10, '1']); // [employeeId (int), candidateId (param string)]
    const h = historyCall();
    expect(h[1][2]).toMatch(/compétences recopiées : permis B/);
    expect(h[1][2]).not.toMatch(/CACES/);
  });

  it('ne dégrade jamais une valeur RH + aucune note si rien de nouveau', async () => {
    setupLinkSequence({
      cand: { id: 2, first_name: 'A', last_name: 'B', status: 'hired', has_permis_b: false, has_caces: false },
      emp: { id: 20, candidate_id: null, first_name: 'A', last_name: 'B', has_permis_b: true, has_caces: true },
    });
    const res = await request(app).post('/api/candidates/2/link-employee')
      .set('Authorization', `Bearer ${rhToken}`).send({ employee_id: 20 });
    expect(res.status).toBe(200);
    expect(skillUpdateCall()).toBeTruthy(); // la recopie OR est émise (idempotente)
    const h = historyCall();
    expect(h[1][2]).not.toMatch(/compétences recopiées/);
  });

  it('recopie CACES seul quand seul le CACES est nouveau', async () => {
    setupLinkSequence({
      cand: { id: 3, first_name: 'C', last_name: 'D', status: 'hired', has_permis_b: true, has_caces: true },
      emp: { id: 30, candidate_id: null, first_name: 'C', last_name: 'D', has_permis_b: true, has_caces: false },
    });
    const res = await request(app).post('/api/candidates/3/link-employee')
      .set('Authorization', `Bearer ${rhToken}`).send({ employee_id: 30 });
    expect(res.status).toBe(200);
    const h = historyCall();
    expect(h[1][2]).toMatch(/compétences recopiées : CACES/);
    expect(h[1][2]).not.toMatch(/permis B/);
  });
});

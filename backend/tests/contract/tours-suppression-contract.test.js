// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — DELETE /api/tours/:id
// ───────────────────────────────────────────────────────────────────────────
// Une tournée programmée par erreur (mauvais jour, mauvais véhicule, doublon)
// se supprime tant qu'elle n'a rien produit. Au-delà, elle porte des faits :
// elle se clôture ou s'annule, elle ne s'efface pas (409 motivé).
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
const mockRelease = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: mockRelease })),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  logActivity: jest.fn(),
  autoLogActivity: () => (req, res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const { authenticate } = require('../../src/middleware/auth');
const { logActivity } = require('../../src/middleware/activity-logger');

const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign({ id: 2, username: 'c', role: 'COLLABORATEUR' }, JWT_SECRET, { expiresIn: '1h' });

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(authenticate);
  router.use('/', require('../../src/routes/tours/crud'));
  app.use('/api/tours', router);
});

/** Scénario SQL : tournée + compteurs d'activité pilotés par le test. */
function scenario({ tour, activite = {}, deleteError = null } = {}) {
  return (sql) => {
    if (/FROM role_module_access|FROM custom_roles/.test(sql)) return Promise.resolve({ rows: [] });
    if (/SELECT id, status, started_at, date, vehicle_id FROM tours/.test(sql)) {
      return Promise.resolve({ rows: tour ? [tour] : [] });
    }
    if (/FROM tour_cav WHERE/.test(sql)) return Promise.resolve({ rows: [{ n: activite.cav || 0 }] });
    if (/FROM tour_association_point WHERE/.test(sql)) return Promise.resolve({ rows: [{ n: activite.asso || 0 }] });
    if (/FROM tour_weights WHERE/.test(sql)) return Promise.resolve({ rows: [{ n: activite.pesees || 0 }] });
    if (/FROM tour_decheterie_bordereaux WHERE/.test(sql)) return Promise.resolve({ rows: [{ n: activite.bordereaux || 0 }] });
    if (/^DELETE FROM tours/.test(sql) && deleteError) return Promise.reject(deleteError);
    return Promise.resolve({ rows: [], rowCount: 0 });
  };
}

const PLANIFIEE = { id: 12, status: 'planned', started_at: null, date: '2026-09-26', vehicle_id: 3 };
const sqlJoue = () => mockQuery.mock.calls.map((c) => c[0]);

beforeEach(() => {
  mockQuery.mockReset();
  mockRelease.mockReset();
  logActivity.mockReset();
});

describe('DELETE /api/tours/:id', () => {
  test('tournée programmée sans activité : supprimée, liens conservés détachés, journalisée', async () => {
    mockQuery.mockImplementation(scenario({ tour: PLANIFIEE }));
    const r = await request(app).delete('/api/tours/12').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 12 });
    const sql = sqlJoue();
    expect(sql.some((q) => /^DELETE FROM tours WHERE id = \$1/.test(q))).toBe(true);
    // la vérification du matin et un incident éventuel restent en base
    expect(sql.some((q) => /UPDATE vehicle_checklists SET tour_id = NULL/.test(q))).toBe(true);
    expect(sql.some((q) => /UPDATE incidents SET tour_id = NULL/.test(q))).toBe(true);
    expect(sql).toContain('COMMIT');
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', entityType: 'tour', entityId: 12 }));
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['en cours', { ...PLANIFIEE, status: 'in_progress' }],
    ['terminée', { ...PLANIFIEE, status: 'completed' }],
    ['planifiée mais démarrée', { ...PLANIFIEE, started_at: '2026-09-26T07:00:00Z' }],
  ])('tournée %s : refus 409 TOURNEE_DEMARREE, rien de supprimé', async (_l, tour) => {
    mockQuery.mockImplementation(scenario({ tour }));
    const r = await request(app).delete('/api/tours/12').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('TOURNEE_DEMARREE');
    expect(sqlJoue().some((q) => /DELETE FROM tours/.test(q))).toBe(false);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['un point collecté', { cav: 1 }],
    ['une association visitée', { asso: 1 }],
    ['une pesée', { pesees: 1 }],
    ['un bordereau de déchèterie', { bordereaux: 1 }],
  ])('tournée portant %s : refus 409 TOURNEE_AVEC_ACTIVITE', async (_l, activite) => {
    mockQuery.mockImplementation(scenario({ tour: PLANIFIEE, activite }));
    const r = await request(app).delete('/api/tours/12').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('TOURNEE_AVEC_ACTIVITE');
    expect(sqlJoue().some((q) => /DELETE FROM tours/.test(q))).toBe(false);
  });

  test('tournée introuvable → 404 ; identifiant illisible → 400', async () => {
    mockQuery.mockImplementation(scenario({ tour: null }));
    const r = await request(app).delete('/api/tours/999').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(404);
    const r2 = await request(app).delete('/api/tours/abc').set('Authorization', `Bearer ${adminToken}`);
    expect(r2.status).toBe(400);
  });

  test('donnée encore rattachée (FK) : 409 lisible, pas 500', async () => {
    const fk = Object.assign(new Error('fk'), { code: '23503' });
    mockQuery.mockImplementation(scenario({ tour: PLANIFIEE, deleteError: fk }));
    const r = await request(app).delete('/api/tours/12').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('TOURNEE_REFERENCEE');
    expect(sqlJoue()).toContain('ROLLBACK');
  });

  test('rôle sans habilitation : 403 avant toute lecture de la tournée', async () => {
    mockQuery.mockImplementation(scenario({ tour: PLANIFIEE }));
    const r = await request(app).delete('/api/tours/12').set('Authorization', `Bearer ${collabToken}`);
    expect(r.status).toBe(403);
    expect(sqlJoue().some((q) => /FROM tours/.test(q))).toBe(false);
  });
});

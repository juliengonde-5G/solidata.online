// ═══════════════════════════════════════════════════════════════════════════
// TEST DE CONTRAT — AFFECTATION DU VÉHICULE SUR UNE TOURNÉE PLANIFIÉE
// ───────────────────────────────────────────────────────────────────────────
// Constat client (26/08/2026) : « Erreur serveur » en retirant le véhicule
// d'une tournée future. La demande partait jusqu'à PostgreSQL, qui la refusait
// (tours.vehicle_id est NOT NULL par conception : c'est le véhicule qui porte
// le lien d'accès du chauffeur, « 1 URL = 1 véhicule »). L'utilisateur n'avait
// aucun moyen de comprendre pourquoi.
//
// Verrouille : refus EXPLICITE en 400 avec son code, et remplacement toujours
// possible. Le chauffeur, lui, reste déaffectable — il est nullable depuis la
// 2.24.1, et confondre les deux règles est précisément l'erreur d'origine.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} })),
}));

const express = require('express');
const request = require('supertest');
const { authenticate } = require('../../src/middleware/auth');
const planningRouter = require('../../src/routes/tours/planning');

const token = jwt.sign(
  { id: 1, username: 'u', role: 'ADMIN', first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' }
);

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', authenticate, planningRouter);
});

const TOUR = {
  id: 42, date: '2026-08-27', status: 'planned', vehicle_id: 5,
  driver_employee_id: 7, suiveur1_employee_id: null, suiveur2_employee_id: null,
};

function installMocks({ tour = TOUR } = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/FROM tours WHERE id/.test(s)) return Promise.resolve({ rows: [tour] });
    if (/FROM tours WHERE date/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM employee_availability/.test(s)) return Promise.resolve({ rows: [] });
    if (/SELECT status FROM vehicles/.test(s)) return Promise.resolve({ rows: [{ status: 'available' }] });
    if (/UPDATE tours SET/.test(s)) return Promise.resolve({ rows: [{ ...tour, vehicle_id: 9 }] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => { mockQuery.mockReset(); installMocks(); });

const assign = (body) => request(app)
  .patch('/api/tours/42/assign').set('Authorization', `Bearer ${token}`).send(body);

describe('PATCH /tours/:id/assign — véhicule', () => {
  test('retirer le véhicule est refusé EXPLICITEMENT, pas en erreur serveur', async () => {
    const res = await assign({ vehicle_id: null });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VEHICULE_OBLIGATOIRE');
    expect(res.body.error).toMatch(/sans véhicule/i);
    // Aucune écriture tentée : la demande est arrêtée avant la base.
    const update = mockQuery.mock.calls.find(([s]) => /UPDATE tours SET/.test(String(s)));
    expect(update).toBeUndefined();
  });

  test('remplacer le véhicule reste possible', async () => {
    const res = await assign({ vehicle_id: 9 });

    expect(res.status).toBe(200);
    expect(res.body.tour.vehicle_id).toBe(9);
  });

  test('un identifiant illisible est refusé en 400, pas en 500', async () => {
    const res = await assign({ vehicle_id: 'camion-bleu' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test('le chauffeur, lui, reste déaffectable — la règle ne vaut que pour le véhicule', async () => {
    const res = await assign({ driver_employee_id: null });

    expect(res.status).toBe(200);
    const update = mockQuery.mock.calls.find(([s]) => /UPDATE tours SET/.test(String(s)));
    expect(update).toBeDefined();
    expect(update[1]).toContain(null);
  });
});

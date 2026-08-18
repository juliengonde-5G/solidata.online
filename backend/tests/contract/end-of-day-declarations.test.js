// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — déclarations de fin de journée (chauffeur/suiveur/binôme)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la garantie centrale demandée : le serveur, pas seulement l'écran
// mobile, refuse toute déclaration partielle. Un client modifié ou une requête
// rejouée à la main ne doit jamais pouvoir poser une déclaration incomplète.
//
// Auth réelle (JWT chauffeur), DB mockée.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(),
}));
jest.mock('../../src/services/push-notifications', () => ({
  sendPushToRoles: jest.fn().mockResolvedValue({ skipped: true }),
  sendPushToUser: jest.fn().mockResolvedValue({ skipped: true }),
  isConfigured: () => false,
  getPublicKey: () => null,
}));

const express = require('express');
const request = require('supertest');

let app;
const driverToken = jwt.sign(
  { id: 4, userId: 4, username: 'driver_5', role: 'COLLABORATEUR', vehicle_id: 5, employee_id: 42 },
  JWT_SECRET, { expiresIn: '1h' });

const FULL_BODY = {
  chauffeur_non_fume: true,
  chauffeur_pas_objet_personnel: true,
  suiveur_non_fume: true,
  suiveur_pas_objet_personnel: true,
  binome_vehicule_vide: true,
  binome_vehicule_ok: true,
};

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', require('../../src/routes/tours'));
});

beforeEach(() => { mockQuery.mockReset(); });

describe('POST /api/tours/:id/end-of-day-public', () => {
  // Le middleware de périmètre véhicule (enforceDriverVehicleScope) interroge
  // d'abord `tours.vehicle_id` pour vérifier que la tournée ciblée appartient
  // bien au véhicule de la session — avant même que le handler ne s'exécute.
  const mockScopeGuard = () => mockQuery.mockResolvedValueOnce({ rows: [{ vehicle_id: 5 }] });

  it('accepte les 6 déclarations à true et les persiste avec le véhicule de la session', async () => {
    mockScopeGuard()
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // resolveDriverEmployeeId : employé du jeton
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // INSERT

    const res = await request(app)
      .post('/api/tours/90/end-of-day-public')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ ...FULL_BODY, remarques: 'Rien à signaler' });

    expect(res.status).toBe(201);
    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO tour_end_of_day_declarations/.test(String(c[0])));
    expect(insert[1]).toEqual(['90', 5, 42, true, true, true, true, true, true, 'Rien à signaler']);
  });

  it.each(Object.keys(FULL_BODY))('REFUSE (400) si %s manque ou vaut false', async (missingField) => {
    mockScopeGuard();
    const body = { ...FULL_BODY, [missingField]: false };
    const res = await request(app)
      .post('/api/tours/90/end-of-day-public')
      .set('Authorization', `Bearer ${driverToken}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.missing).toContain(missingField);
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO tour_end_of_day_declarations/.test(String(c[0])))).toBe(false);
  });

  it('remarques vide -> NULL (jamais une chaîne vide)', async () => {
    mockScopeGuard()
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });

    await request(app)
      .post('/api/tours/90/end-of-day-public')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ ...FULL_BODY, remarques: '   ' });

    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO tour_end_of_day_declarations/.test(String(c[0])));
    expect(insert[1][insert[1].length - 1]).toBeNull();
  });

  it('401 sans JWT', async () => {
    const res = await request(app).post('/api/tours/90/end-of-day-public').send(FULL_BODY);
    expect(res.status).toBe(401);
  });
});

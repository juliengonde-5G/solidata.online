// Vague 3 — Durcissement mobile : contre-vérification JWT chauffeur ↔ véhicule.
// Le JWT de POST /auth/driver-start encode le véhicule dans son username
// (« driver_<vehicleId> »). Ces tests prouvent qu'un token du véhicule A (driver_5)
// ne peut PAS agir sur le véhicule B, tout en laissant le flux légitime (véhicule A)
// et les comptes non-chauffeur inchangés (non-régression).
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
const mockConnect = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: () => mockConnect(),
}));
jest.mock('../../../src/services/push-notifications', () => ({
  sendPushToRoles: jest.fn().mockResolvedValue({ skipped: true }),
  sendPushToUser: jest.fn().mockResolvedValue({ skipped: true }),
  isConfigured: () => false,
  getPublicKey: () => null,
}));

const express = require('express');
const request = require('supertest');

let app;
// driverA : token chauffeur du véhicule 5 (username driver_5).
const driverA = jwt.sign({ id: 4, username: 'driver_5', role: 'COLLABORATEUR' }, JWT_SECRET, { expiresIn: '1h' });
// Compte non-chauffeur (ADMIN) : ne doit PAS être borné à un véhicule.
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', require('../../../src/routes/tours'));
});
afterEach(() => { mockQuery.mockReset(); mockConnect.mockReset(); });

// ── Route ciblant un véhicule par paramètre (aucune requête dans la garde) ──
describe('Route /vehicle/:id/* — véhicule par paramètre', () => {
  it('401 sans JWT', async () => {
    const res = await request(app).get('/api/tours/vehicle/5/messages-public');
    expect(res.status).toBe(401);
  });

  it('REFUSE (403) une action sur le véhicule B (driver_5 → véhicule 9)', async () => {
    const res = await request(app).get('/api/tours/vehicle/9/messages-public')
      .set('Authorization', `Bearer ${driverA}`);
    expect(res.status).toBe(403);
    // Aucune requête handler ne doit avoir été atteinte.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('ACCEPTE une action sur son propre véhicule (driver_5 → véhicule 5)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // handler : consignes non lues
    const res = await request(app).get('/api/tours/vehicle/5/messages-public')
      .set('Authorization', `Bearer ${driverA}`);
    expect(res.status).toBe(200);
  });
});

// ── Route ciblant une tournée (la garde résout tours.vehicle_id) ──
describe('Route /:tourId/* — véhicule résolu via la tournée', () => {
  it('REFUSE (403) une tournée d\'un autre véhicule (tour 12 = véhicule 9)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ vehicle_id: 9 }] }); // garde : SELECT vehicle_id FROM tours
    const res = await request(app).get('/api/tours/12/reoptimize/pending-public')
      .set('Authorization', `Bearer ${driverA}`);
    expect(res.status).toBe(403);
    // La garde a fait 1 requête (résolution véhicule) ; le handler n'est pas atteint.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('ACCEPTE une tournée de son véhicule (tour 12 = véhicule 5)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ vehicle_id: 5 }] }) // garde
      .mockResolvedValueOnce({ rows: [] });                 // handler : pas de proposition en attente
    const res = await request(app).get('/api/tours/12/reoptimize/pending-public')
      .set('Authorization', `Bearer ${driverA}`);
    expect(res.status).toBe(200);
  });

  it('tournée introuvable → laisse le handler répondre (pas de 403 abusif)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // garde : tournée inexistante → véhicule inconnu → on passe
      .mockResolvedValueOnce({ rows: [] }); // handler
    const res = await request(app).get('/api/tours/999/reoptimize/pending-public')
      .set('Authorization', `Bearer ${driverA}`);
    expect(res.status).toBe(200);
  });
});

// ── read-public : borné dans le handler (clause vehicle_id sur l'UPDATE) ──
describe('POST /messages/:id/read-public — accusé borné au véhicule', () => {
  it('ACCEPTE l\'accusé d\'une consigne de son véhicule', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 10, read_at: '2026-07-13T10:00:00Z' }] }); // UPDATE 1 ligne
    const res = await request(app).post('/api/tours/messages/10/read-public')
      .set('Authorization', `Bearer ${driverA}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(10);
  });

  it('REFUSE (403) l\'accusé d\'une consigne d\'un autre véhicule', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // UPDATE borné vehicle_id=5 → 0 ligne
      .mockResolvedValueOnce({ rows: [{ id: 10, read_at: null, vehicle_id: 9 }] }); // SELECT existant → véhicule 9
    const res = await request(app).post('/api/tours/messages/10/read-public')
      .set('Authorization', `Bearer ${driverA}`).send({});
    expect(res.status).toBe(403);
  });
});

// ── history-public : borné dans le handler (via le SELECT de tournée) ──
describe('GET /:id/history-public — historique borné au véhicule', () => {
  it('REFUSE (403) l\'historique d\'une tournée d\'un autre véhicule', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 12, collection_type: 'pav', vehicle_id: 9 }] });
    const res = await request(app).get('/api/tours/12/history-public')
      .set('Authorization', `Bearer ${driverA}`);
    expect(res.status).toBe(403);
  });

  it('ACCEPTE l\'historique d\'une tournée de son véhicule', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 12, collection_type: 'pav', vehicle_id: 5 }] }) // tour check
      .mockResolvedValueOnce({ rows: [] })  // cavs
      .mockResolvedValueOnce({ rows: [] })  // incidents
      .mockResolvedValueOnce({ rows: [] }); // weights
    const res = await request(app).get('/api/tours/12/history-public')
      .set('Authorization', `Bearer ${driverA}`);
    expect(res.status).toBe(200);
  });
});

// ── gps-batch-public : la garde valide le véhicule de chaque position ──
describe('POST /gps-batch-public — positions bornées au véhicule', () => {
  it('REFUSE (403) un lot contenant une position d\'un autre véhicule', async () => {
    const res = await request(app).post('/api/tours/gps-batch-public')
      .set('Authorization', `Bearer ${driverA}`)
      .send({ positions: [{ tour_id: 1, vehicle_id: 9, latitude: 49.4, longitude: 1.0 }] });
    expect(res.status).toBe(403);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('ACCEPTE un lot de positions de son véhicule', async () => {
    const client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    mockConnect.mockResolvedValueOnce(client);
    const res = await request(app).post('/api/tours/gps-batch-public')
      .set('Authorization', `Bearer ${driverA}`)
      .send({ positions: [{ tour_id: 1, vehicle_id: 5, latitude: 49.4, longitude: 1.0 }] });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
  });
});

// ── Non-régression : un compte NON chauffeur n'est pas borné à un véhicule ──
describe('Comptes non-chauffeur — comportement historique inchangé', () => {
  it('ADMIN accède à une tournée sans requête de garde véhicule', async () => {
    // Une seule requête (celle du handler) : la garde ne fait AUCUN SELECT pour
    // un token non « driver_<id> ».
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/tours/12/reoptimize/pending-public')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('ADMIN accède à une route /vehicle/:id/* d\'un véhicule quelconque', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/tours/vehicle/9/messages-public')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

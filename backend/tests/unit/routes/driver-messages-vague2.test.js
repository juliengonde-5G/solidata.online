// Vague 2 (item 62) — Canal manager → chauffeur (driver_messages).
// Vérifie : autorisation (lecture seule AUTORITE ne peut PAS écrire), validation,
// idempotence de l'accusé de lecture, filtre « non lu » côté mobile.
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
const mockConnect = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: () => mockConnect(),
}));
// Neutralise les effets de bord réseau (web-push) et de ré-optimisation.
jest.mock('../../../src/services/push-notifications', () => ({
  sendPushToRoles: jest.fn().mockResolvedValue({ skipped: true }),
  sendPushToUser: jest.fn().mockResolvedValue({ skipped: true }),
  isConfigured: () => false,
  getPublicKey: () => null,
}));

const express = require('express');
const request = require('supertest');

let app;
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });
const managerToken = jwt.sign({ id: 2, username: 'mgr', role: 'MANAGER' }, JWT_SECRET, { expiresIn: '1h' });
const autoriteToken = jwt.sign({ id: 3, username: 'auto', role: 'AUTORITE' }, JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign({ id: 4, username: 'driver_5', role: 'COLLABORATEUR' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  const toursRoutes = require('../../../src/routes/tours');
  app.use('/api/tours', toursRoutes);
});

afterEach(() => { mockQuery.mockReset(); mockConnect.mockReset(); });

function insertCall() {
  return mockQuery.mock.calls.find((c) => /INSERT INTO driver_messages/.test(c[0]));
}

describe('POST /api/tours/messages (envoi consigne)', () => {
  it('401 sans authentification', async () => {
    const res = await request(app).post('/api/tours/messages').send({ vehicle_id: 5, message: 'x' });
    expect(res.status).toBe(401);
  });

  it('403 pour AUTORITE (rôle lecture seule — aucune écriture)', async () => {
    const res = await request(app).post('/api/tours/messages')
      .set('Authorization', `Bearer ${autoriteToken}`).send({ vehicle_id: 5, message: 'x' });
    expect(res.status).toBe(403);
  });

  it('403 pour COLLABORATEUR (chauffeur ne s\'auto-envoie pas de consigne)', async () => {
    const res = await request(app).post('/api/tours/messages')
      .set('Authorization', `Bearer ${collabToken}`).send({ vehicle_id: 5, message: 'x' });
    expect(res.status).toBe(403);
  });

  it('400 si message vide (que des espaces)', async () => {
    const res = await request(app).post('/api/tours/messages')
      .set('Authorization', `Bearer ${managerToken}`).send({ vehicle_id: 5, message: '   ' });
    expect(res.status).toBe(400);
  });

  it('400 si vehicle_id manquant', async () => {
    const res = await request(app).post('/api/tours/messages')
      .set('Authorization', `Bearer ${managerToken}`).send({ message: 'consigne' });
    expect(res.status).toBe(400);
  });

  it('404 si véhicule inexistant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT vehicle → aucun
    const res = await request(app).post('/api/tours/messages')
      .set('Authorization', `Bearer ${managerToken}`).send({ vehicle_id: 999, message: 'x' });
    expect(res.status).toBe(404);
  });

  it('201 (MANAGER) — trim du message + created_by = req.user.id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // SELECT vehicle existe
      .mockResolvedValueOnce({ rows: [{ id: 10, tour_id: 3, vehicle_id: 5, message: 'Danger', read_at: null }] });
    const res = await request(app).post('/api/tours/messages')
      .set('Authorization', `Bearer ${managerToken}`).send({ vehicle_id: 5, tour_id: 3, message: '  Danger  ' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(10);
    const call = insertCall();
    expect(call).toBeTruthy();
    expect(call[1]).toEqual([3, 5, 'Danger', 2]); // [tour_id, vehicle_id, message trimmé, created_by]
  });

  it('201 (ADMIN) — tour_id optionnel envoyé en null', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5 }] })
      .mockResolvedValueOnce({ rows: [{ id: 11, tour_id: null, vehicle_id: 5, message: 'Consigne du jour', read_at: null }] });
    const res = await request(app).post('/api/tours/messages')
      .set('Authorization', `Bearer ${adminToken}`).send({ vehicle_id: 5, message: 'Consigne du jour' });
    expect(res.status).toBe(201);
    const call = insertCall();
    expect(call[1][0]).toBeNull(); // tour_id null
  });
});

describe('GET /api/tours/messages (suivi manager lu/non lu)', () => {
  it('403 pour AUTORITE', async () => {
    const res = await request(app).get('/api/tours/messages?vehicle_id=5')
      .set('Authorization', `Bearer ${autoriteToken}`);
    expect(res.status).toBe(403);
  });

  it('200 (MANAGER) — renvoie la liste', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 10, message: 'x', read_at: null }] });
    const res = await request(app).get('/api/tours/messages?vehicle_id=5')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
  });
});

describe('GET /api/tours/vehicle/:id/messages-public (mobile)', () => {
  it('401 sans JWT chauffeur (endpoint protégé)', async () => {
    const res = await request(app).get('/api/tours/vehicle/5/messages-public');
    expect(res.status).toBe(401);
  });

  it('200 (chauffeur) — ne renvoie que les non lues', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 10, tour_id: 3, vehicle_id: 5, message: 'Danger', created_at: 'x', read_at: null }] });
    const res = await request(app).get('/api/tours/vehicle/5/messages-public')
      .set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    const q = mockQuery.mock.calls.find((c) => /FROM driver_messages/.test(c[0]));
    expect(q[0]).toMatch(/read_at IS NULL/);
  });
});

describe('POST /api/tours/messages/:id/read-public (accusé de lecture)', () => {
  it('401 sans JWT chauffeur', async () => {
    const res = await request(app).post('/api/tours/messages/10/read-public').send({});
    expect(res.status).toBe(401);
  });

  it('200 — premier accusé fixe read_at', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 10, read_at: '2026-07-12T10:00:00Z' }] });
    const res = await request(app).post('/api/tours/messages/10/read-public')
      .set('Authorization', `Bearer ${collabToken}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(10);
    expect(res.body.already).toBeUndefined();
  });

  it('200 idempotent — rejeu offline d\'un message déjà lu', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // UPDATE ... WHERE read_at IS NULL → 0 ligne
      .mockResolvedValueOnce({ rows: [{ id: 10, read_at: '2026-07-12T09:00:00Z' }] }); // SELECT existant
    const res = await request(app).post('/api/tours/messages/10/read-public')
      .set('Authorization', `Bearer ${collabToken}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.already).toBe(true);
  });

  it('404 message inexistant', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // UPDATE → 0
      .mockResolvedValueOnce({ rows: [] }); // SELECT → aucun
    const res = await request(app).post('/api/tours/messages/999/read-public')
      .set('Authorization', `Bearer ${collabToken}`).send({});
    expect(res.status).toBe(404);
  });
});

describe('GET /api/tours/:id/history-public (historique enrichi mobile)', () => {
  it('401 sans JWT chauffeur', async () => {
    const res = await request(app).get('/api/tours/12/history-public');
    expect(res.status).toBe(401);
  });

  it('200 (chauffeur) — renvoie cavs + incidents + pesées', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 12, collection_type: 'pav' }] }) // tour check
      .mockResolvedValueOnce({ rows: [{ id: 1, cav_id: 7, status: 'collected' }] }) // cavs
      .mockResolvedValueOnce({ rows: [{ id: 2, type: 'cav_problem', description: 'plein' }] }) // incidents
      .mockResolvedValueOnce({ rows: [{ id: 3, weight_kg: 340, is_intermediate: false }] }); // weights
    const res = await request(app).get('/api/tours/12/history-public')
      .set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(200);
    expect(res.body.cavs).toHaveLength(1);
    expect(res.body.incidents).toHaveLength(1);
    expect(res.body.weights).toHaveLength(1);
  });

  it('404 tournée inexistante', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tour check → aucun
    const res = await request(app).get('/api/tours/999/history-public')
      .set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(404);
  });
});

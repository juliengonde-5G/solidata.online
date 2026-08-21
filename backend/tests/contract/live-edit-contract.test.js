// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — pilotage d'une tournée EN COURS (« Collecte en direct »).
// Verrouille les garde-fous : on ne réécrit pas le passé du chauffeur, et
// toute modification le prévient.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} })),
}));
jest.mock('../../src/services/push-notifications', () => ({ sendPushToRoles: jest.fn(async () => {}) }));

const express = require('express');
const request = require('supertest');
const { authenticate } = require('../../src/middleware/auth');

const adminToken = jwt.sign({ id: 1, username: 'a', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign({ id: 2, username: 'c', role: 'COLLABORATEUR' }, JWT_SECRET, { expiresIn: '1h' });

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', authenticate, require('../../src/routes/tours/live-edit'));
});
beforeEach(() => mockQuery.mockReset());

/** Programme : 1 point collecté (figé) + 2 à faire. */
function programmeType() {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/FROM tours t LEFT JOIN vehicles v/.test(s) || /SELECT t.id, t.date, t.status/.test(s)) {
      return Promise.resolve({ rows: [{ id: 7, status: 'in_progress', vehicle_id: 3, date: '2026-08-21' }] });
    }
    if (/FROM tour_cav tc JOIN cav c/.test(s)) {
      return Promise.resolve({ rows: [
        { id: 11, ref_id: 101, position: 1, status: 'collected', name: 'CAV A' },
        { id: 12, ref_id: 102, position: 2, status: 'pending', name: 'CAV B' },
        { id: 13, ref_id: 103, position: 3, status: 'pending', name: 'CAV C' },
      ] });
    }
    if (/FROM tour_arret_technique/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

describe('GET /:id/programme', () => {
  it('fusionne points de collecte et arrêts, et marque ce qui est figé', async () => {
    programmeType();
    const res = await request(app).get('/api/tours/7/programme').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(3);
    expect(res.body.points[0]).toMatchObject({ kind: 'cav', editable: false });
    expect(res.body.points[1].editable).toBe(true);
  });

  it('refuse un rôle non habilité', async () => {
    programmeType();
    const res = await request(app).get('/api/tours/7/programme').set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(403);
  });
});

describe('PUT /:id/programme/ordre — garde-fous', () => {
  it('refuse un ordre qui ne porte pas tous les points', async () => {
    programmeType();
    const res = await request(app).put('/api/tours/7/programme/ordre')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ordre: [{ kind: 'cav', id: 12 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ORDRE_INCOHERENT');
  });

  it('refuse un ordre contenant un point inconnu', async () => {
    programmeType();
    const res = await request(app).put('/api/tours/7/programme/ordre')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ordre: [{ kind: 'cav', id: 11 }, { kind: 'cav', id: 12 }, { kind: 'cav', id: 999 }] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ORDRE_INCOHERENT');
  });

  it('refuse de DÉPLACER un point déjà traité (position absolue, pas seulement l’ordre relatif)', async () => {
    programmeType();
    const res = await request(app).put('/api/tours/7/programme/ordre')
      .set('Authorization', `Bearer ${adminToken}`)
      // Le point collecté (11) passerait de la 1re à la 2e place.
      .send({ ordre: [{ kind: 'cav', id: 12 }, { kind: 'cav', id: 11 }, { kind: 'cav', id: 13 }] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('POINT_DEJA_TRAITE');
    expect(res.body.error).toMatch(/CAV A/);
  });

  it('accepte un réordonnancement qui laisse les points traités en place', async () => {
    programmeType();
    const res = await request(app).put('/api/tours/7/programme/ordre')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ordre: [{ kind: 'cav', id: 11 }, { kind: 'cav', id: 13 }, { kind: 'cav', id: 12 }] });
    expect(res.status).toBe(200);
    // Le chauffeur est prévenu du nouvel itinéraire.
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO driver_messages/.test(s))).toBe(true);
  });
});

describe('tournée non modifiable', () => {
  it('refuse toute modification sur une tournée terminée', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM tours t LEFT JOIN vehicles v/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 7, status: 'completed', vehicle_id: 3 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).post('/api/tours/7/programme/cav')
      .set('Authorization', `Bearer ${adminToken}`).send({ cav_id: 42 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TOURNEE_NON_MODIFIABLE');
  });
});

describe('PATCH /:id/equipe', () => {
  it('refuse qu’une même personne soit chauffeur ET suiveur', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM tours t LEFT JOIN vehicles v/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 7, status: 'in_progress', vehicle_id: 3,
          driver_employee_id: 5, suiveur1_employee_id: null, suiveur2_employee_id: null }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).patch('/api/tours/7/equipe')
      .set('Authorization', `Bearer ${adminToken}`).send({ suiveur1_employee_id: 5 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ROLE_CUMULE');
  });

  it('refuse une requête sans aucun changement', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM tours t LEFT JOIN vehicles v/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 7, status: 'in_progress', vehicle_id: 3 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).patch('/api/tours/7/equipe')
      .set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(400);
  });
});

describe('référentiel des lieux d’arrêt', () => {
  it('refuse la suppression d’un lieu utilisé et propose la désactivation', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM tour_arret_technique WHERE lieu_id/.test(String(sql))) {
        return Promise.resolve({ rows: [{ n: 4 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).delete('/api/tours/lieux-techniques/9')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LIEU_UTILISE');
    expect(res.body.error).toMatch(/[Dd]ésactivez/);
  });

  it('exige un nom à la création', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).post('/api/tours/lieux-techniques')
      .set('Authorization', `Bearer ${adminToken}`).send({ categorie: 'magasin' });
    expect(res.status).toBe(400);
  });
});

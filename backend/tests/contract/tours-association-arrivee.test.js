// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — arrivée et départ chez une association
// ───────────────────────────────────────────────────────────────────────────
// Question client du 26/08/2026 : « Les associations n'ont pas de QR code.
// Comment l'agent va annoncer la gestion de la collecte ? »
//
// Une borne de rue se prouve par son QR code ; une association n'en a pas, et
// rien n'attestait le passage avant la validation de la collecte. L'équipage
// déclare donc son arrivée, puis son départ. Ce que cela change :
//   1. la DURÉE RÉELLE de l'arrêt devient mesurable — celle-là même que le
//      module fait ajuster à la main depuis la 2.38.0 sans jamais la mesurer ;
//   2. le RENDEZ-VOUS se juge sur l'ARRIVÉE et non sur le départ (un équipage
//      ponctuel resté deux heures ressortait « non honoré ») ;
//   3. l'arrivée survit au hors-ligne : elle voyage avec le départ.
//
// Règle qui gouverne tout le reste : JAMAIS DE VALEUR INVENTÉE — une heure
// invraisemblable est ignorée, une durée non calculable vaut `null`, pas 0.
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const mockQuery = jest.fn();
const mockClient = { query: (...a) => mockQuery(...a), release: jest.fn() };
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => mockClient),
}));
jest.mock('../../src/services/push-notifications', () => ({
  sendPushToRoles: jest.fn().mockResolvedValue({ skipped: true }),
  sendPushToUser: jest.fn().mockResolvedValue({ skipped: true }),
  isConfigured: () => false,
  getPublicKey: () => null,
}));
jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({}), isRedisAvailable: () => false,
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(), logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

const TOUR_ID = 500;
const POINT_ID = 77;
const VEHICLE_ID = 5;

const driverToken = jwt.sign(
  { id: 4, userId: 4, username: `driver_${VEHICLE_ID}`, role: 'COLLABORATEUR', vehicle_id: VEHICLE_ID },
  JWT_SECRET, { expiresIn: '1h' }
);

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', require('../../src/routes/tours'));
});

/** Capture le SQL et les paramètres pour pouvoir affirmer ce qui a été écrit. */
function mockDb({ ligne = {}, trouve = true } = {}) {
  const vus = [];
  mockQuery.mockImplementation((sql, params) => {
    const t = String(sql);
    vus.push({ sql: t, params });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(t)) return Promise.resolve({ rows: [] });
    if (/SELECT vehicle_id FROM tours WHERE id/.test(t)) {
      return Promise.resolve({ rows: [{ vehicle_id: VEHICLE_ID }] });
    }
    if (/SELECT collection_type FROM tours WHERE id/.test(t)) {
      return Promise.resolve({ rows: [{ collection_type: 'association' }] });
    }
    if (/UPDATE tour_association_point/.test(t)) {
      return Promise.resolve({ rows: trouve ? [ligne] : [] });
    }
    return Promise.resolve({ rows: [] });
  });
  return vus;
}

beforeEach(() => { mockQuery.mockReset(); mockClient.release.mockReset(); });

const arriver = () => request(app)
  .post(`/api/tours/${TOUR_ID}/association/${POINT_ID}/arrivee-public`)
  .set('Authorization', `Bearer ${driverToken}`).send({});

const partir = (body) => request(app)
  .put(`/api/tours/${TOUR_ID}/cav/${POINT_ID}/collect-public`)
  .set('Authorization', `Bearer ${driverToken}`).send(body || {});

describe('POST /:id/association/:pointId/arrivee-public', () => {
  test('déclare l’arrivée et rend le temps prévu au programme', async () => {
    mockDb({ ligne: {
      id: 9, association_point_id: POINT_ID, position: 2, status: 'pending',
      arrived_at: '2026-08-26T10:05:00Z', collected_at: null, duree_prevue_min: 45,
    } });
    const res = await arriver();

    expect(res.status).toBe(200);
    expect(res.body.arrived_at).toBe('2026-08-26T10:05:00Z');
    expect(res.body.duree_prevue_min).toBe(45);
    expect(res.body.deja_collecte).toBe(false);
  });

  test('IDEMPOTENT : la PREMIÈRE arrivée fait foi (COALESCE)', async () => {
    // Sans cela, un double appui ou un rejeu hors ligne raccourcirait tout seul
    // un arrêt long — et cette durée sert à corriger les estimations.
    const vus = mockDb({ ligne: { id: 9, association_point_id: POINT_ID, arrived_at: 'x', duree_prevue_min: null } });
    await arriver();

    const update = vus.find((q) => /UPDATE tour_association_point/.test(q.sql));
    expect(update.sql).toMatch(/arrived_at\s*=\s*COALESCE\(arrived_at,\s*NOW\(\)\)/);
  });

  test('point absent de la tournée → 404, jamais un succès muet', async () => {
    mockDb({ trouve: false });
    const res = await arriver();
    expect(res.status).toBe(404);
  });

  test('identifiant illisible → 400', async () => {
    mockDb();
    const res = await request(app)
      .post(`/api/tours/${TOUR_ID}/association/abc/arrivee-public`)
      .set('Authorization', `Bearer ${driverToken}`).send({});
    expect(res.status).toBe(400);
  });

  test('sans jeton chauffeur → 401', async () => {
    mockDb();
    const res = await request(app)
      .post(`/api/tours/${TOUR_ID}/association/${POINT_ID}/arrivee-public`).send({});
    expect(res.status).toBe(401);
  });

  test('jeton d’un AUTRE véhicule → 403', async () => {
    mockDb();
    const autre = jwt.sign(
      { id: 9, username: 'driver_99', role: 'COLLABORATEUR', vehicle_id: 99 },
      JWT_SECRET, { expiresIn: '1h' }
    );
    const res = await request(app)
      .post(`/api/tours/${TOUR_ID}/association/${POINT_ID}/arrivee-public`)
      .set('Authorization', `Bearer ${autre}`).send({});
    expect(res.status).toBe(403);
  });
});

describe('Départ : la durée réelle de l’arrêt', () => {
  const ligneAvec = (arrivee, depart) => ({
    id: 9, association_point_id: POINT_ID, status: 'collected',
    arrived_at: arrivee, collected_at: depart, duree_prevue_min: 45,
  });

  test('arrivée et départ connus → durée mesurée', async () => {
    mockDb({ ligne: ligneAvec('2026-08-26T10:05:00Z', '2026-08-26T10:57:00Z') });
    const res = await partir({ fill_level: 3 });

    expect(res.status).toBe(200);
    expect(res.body.duree_reelle_min).toBe(52);
    expect(res.body.duree_prevue_min).toBe(45);
  });

  test('sans arrivée déclarée → durée null, PAS 0', async () => {
    // On ne la reconstitue pas depuis l'estimation : ce serait mesurer la
    // prévision avec la prévision.
    mockDb({ ligne: ligneAvec(null, '2026-08-26T10:57:00Z') });
    const res = await partir({ fill_level: 3 });

    expect(res.body.duree_reelle_min).toBeNull();
  });

  test('l’arrivée hors ligne voyage avec le départ', async () => {
    const horsLigne = new Date(Date.now() - 38 * 60000).toISOString();
    const vus = mockDb({ ligne: ligneAvec(horsLigne, new Date().toISOString()) });
    await partir({ fill_level: 2, arrivee_at: horsLigne });

    const update = vus.find((q) => /UPDATE tour_association_point/.test(q.sql));
    expect(update.sql).toMatch(/arrived_at\s*=\s*COALESCE\(arrived_at,\s*\$8::timestamp\)/);
    expect(update.params[7]).toBe(horsLigne);   // l'heure d'origine, pas celle du rattrapage
  });

  test('HORLOGE DE TRAVERS : une arrivée dans le futur est ignorée', async () => {
    const futur = new Date(Date.now() + 3 * 3600e3).toISOString();
    const vus = mockDb({ ligne: ligneAvec(null, new Date().toISOString()) });
    await partir({ fill_level: 1, arrivee_at: futur });

    const update = vus.find((q) => /UPDATE tour_association_point/.test(q.sql));
    expect(update.params[7]).toBeNull();
  });

  test('une arrivée vieille de plus de 24 h est ignorée', async () => {
    const vieux = new Date(Date.now() - 30 * 3600e3).toISOString();
    const vus = mockDb({ ligne: ligneAvec(null, new Date().toISOString()) });
    await partir({ fill_level: 1, arrivee_at: vieux });

    const update = vus.find((q) => /UPDATE tour_association_point/.test(q.sql));
    expect(update.params[7]).toBeNull();
  });

  test('une valeur illisible est ignorée sans faire échouer la collecte', async () => {
    const vus = mockDb({ ligne: ligneAvec(null, new Date().toISOString()) });
    const res = await partir({ fill_level: 1, arrivee_at: 'hier matin' });

    expect(res.status).toBe(200);
    const update = vus.find((q) => /UPDATE tour_association_point/.test(q.sql));
    expect(update.params[7]).toBeNull();
  });
});

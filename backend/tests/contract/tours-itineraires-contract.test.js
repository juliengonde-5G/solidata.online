// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — Tracé ROUTIER des tournées
//   GET /api/tours/active-summary/itineraires   (superviseur, carte web)
//   GET /api/tours/:id/itineraire-public        (chauffeur, carte mobile)
// ───────────────────────────────────────────────────────────────────────────
// Les deux cartes reliaient jusqu'ici les bornes par des SEGMENTS DROITS, et
// la « distance restante » affichée n'était qu'un prorata du kilométrage total
// estimé. Ces endpoints livrent la polyligne qui suit les rues et la distance
// réellement à parcourir jusqu'au retour au centre.
//
// Propriété non négociable vérifiée ici : quand le routeur ne répond pas, la
// réponse le DIT (`source: 'indisponible'`, distance null) — jamais une
// distance approchée présentée comme routière.
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(),
}));
const mockGeometry = jest.fn();
jest.mock('../../src/routes/tours/geo', () => ({
  ...jest.requireActual('../../src/routes/tours/geo'),
  osrmRouteGeometry: (...a) => mockGeometry(...a),
}));

const express = require('express');
const request = require('supertest');
const { authenticate } = require('../../src/middleware/auth');

const adminToken = jwt.sign(
  { id: 1, username: 'admin', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });
const driverToken = jwt.sign(
  { id: 9, username: 'driver_7', role: 'COLLABORATEUR', vehicle_id: 7 },
  JWT_SECRET, { expiresIn: '1h' });

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(authenticate);
  router.use('/', require('../../src/routes/tours/active-summary'));
  app.use('/api/tours', router);
});

const TRACE = {
  geometry: [[49.4231, 1.0993], [49.4300, 1.1100], [49.4400, 1.1200]],
  distance_km: 18.42, duration_min: 31.6, source: 'osrm',
};

/** Aiguillage SQL : chaque requête est reconnue à son motif. */
function routeSql(sql) {
  if (/FROM tours t\s*$|FROM tours t\n\s*WHERE t\.date/.test(sql) || /t\.status IN \('planned'/.test(sql)) {
    return { rows: [{ id: 42, collection_type: 'cav', vehicle_id: 7 }] };
  }
  if (/FROM tour_cav tc/.test(sql)) {
    return { rows: [
      { tour_id: 42, point_id: 1, position: 1, latitude: '49.44', longitude: '1.12' },
      { tour_id: 42, point_id: 2, position: 2, latitude: '49.45', longitude: '1.13' },
    ] };
  }
  if (/FROM tour_association_point/.test(sql)) return { rows: [] };
  if (/FROM gps_positions/.test(sql)) {
    return { rows: [{ vehicle_id: 7, latitude: '49.4250', longitude: '1.1000', recorded_at: new Date() }] };
  }
  if (/SELECT id, vehicle_id FROM tours/.test(sql)) {
    return { rows: [{ id: 42, vehicle_id: 7 }] };
  }
  return { rows: [] };
}

beforeEach(() => {
  // Le tracé est mémorisé 3 min côté serveur (il ne change qu'au fil des
  // collectes) : on le vide entre deux cas pour tester le calcul lui-même.
  require('../../src/routes/tours/active-summary').resetTraceMemo();
  mockQuery.mockReset();
  mockGeometry.mockReset();
  mockQuery.mockImplementation((sql) => Promise.resolve(routeSql(sql)));
  mockGeometry.mockResolvedValue(TRACE);
});

describe('GET /api/tours/active-summary/itineraires (carte web)', () => {
  test('renvoie la polyligne routière et la distance RÉELLE restante', async () => {
    const r = await request(app)
      .get('/api/tours/active-summary/itineraires?date=2026-08-24')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.itineraires).toHaveLength(1);
    const it = r.body.itineraires[0];
    expect(it).toMatchObject({
      tour_id: 42, source: 'routier', distance_restante_km: 18.4,
      duree_restante_min: 32, nb_points: 2, tronque: false,
    });
    expect(it.geometry).toEqual(TRACE.geometry);
  });

  test('le tracé part de la position GPS du véhicule et revient au centre', async () => {
    await request(app)
      .get('/api/tours/active-summary/itineraires?date=2026-08-24')
      .set('Authorization', `Bearer ${adminToken}`);
    const waypoints = mockGeometry.mock.calls[0][0];
    // départ (GPS) + 2 points restants + retour au centre de tri
    expect(waypoints).toHaveLength(4);
    expect(waypoints[0]).toEqual({ lat: 49.425, lng: 1.1 });
    expect(waypoints[3].lat).toBeCloseTo(49.4231, 3);
  });

  test('routeur injoignable : le DIT, ne fabrique aucune distance', async () => {
    mockGeometry.mockResolvedValue(null);
    const r = await request(app)
      .get('/api/tours/active-summary/itineraires?date=2026-08-24')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.itineraires[0]).toMatchObject({
      source: 'indisponible', geometry: null,
      distance_restante_km: null, duree_restante_min: null,
    });
  });

  test('aucune tournée active : réponse vide, aucun appel au routeur', async () => {
    mockQuery.mockImplementation((sql) => Promise.resolve(
      /t\.status IN \('planned'/.test(sql) ? { rows: [] } : routeSql(sql)
    ));
    const r = await request(app)
      .get('/api/tours/active-summary/itineraires')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.itineraires).toEqual([]);
    expect(mockGeometry).not.toHaveBeenCalled();
  });

  test('tous les points collectés : rien à tracer, aucun appel au routeur', async () => {
    mockQuery.mockImplementation((sql) => Promise.resolve(
      /FROM tour_cav tc/.test(sql) ? { rows: [] } : routeSql(sql)
    ));
    const r = await request(app)
      .get('/api/tours/active-summary/itineraires')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.itineraires[0]).toMatchObject({ source: 'aucun_point_restant', nb_points: 0 });
    expect(mockGeometry).not.toHaveBeenCalled();
  });
});

describe('GET /api/tours/:id/itineraire-public (carte chauffeur)', () => {
  test('renvoie le tracé de la tournée du chauffeur', async () => {
    const r = await request(app)
      .get('/api/tours/42/itineraire-public')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ tour_id: 42, source: 'routier', distance_restante_km: 18.4 });
    expect(r.body.geometry).toEqual(TRACE.geometry);
  });

  test('la position GPS du téléphone, quand elle est transmise, sert de départ', async () => {
    await request(app)
      .get('/api/tours/42/itineraire-public?lat=49.4700&lng=1.1500')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(mockGeometry.mock.calls[0][0][0]).toEqual({ lat: 49.47, lng: 1.15 });
  });

  test('tournée inexistante → 404', async () => {
    mockQuery.mockImplementation((sql) => Promise.resolve(
      /SELECT id, vehicle_id FROM tours/.test(sql) ? { rows: [] } : routeSql(sql)
    ));
    const r = await request(app)
      .get('/api/tours/999/itineraire-public')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(r.status).toBe(404);
  });

  test('sans jeton → 401 (le tracé expose les adresses de collecte)', async () => {
    const r = await request(app).get('/api/tours/42/itineraire-public');
    expect(r.status).toBe(401);
  });
});

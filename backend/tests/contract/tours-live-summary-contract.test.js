// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — GET /api/tours/:id/live-summary
// ───────────────────────────────────────────────────────────────────────────
// Cette réponse alimente la fiche de tournée de l'historique (Tours.jsx) et le
// suivi en direct. Deux champs y sont verrouillés ici parce que l'écran les
// AFFICHE point par point, et qu'ils ne valent quelque chose que s'ils sont
// honnêtes :
//
//   • `nb_containers` — le nombre de conteneurs installés sur le point. Un
//     point association n'en a pas : il vaut alors `null`, JAMAIS 1, qui
//     ferait passer une inconnue pour une mesure.
//   • `remballe` — les sacs de remballe déposés par l'équipage. Trois états
//     distincts : `true` (déclaré), `false` (l'équipage a répondu non),
//     `null` (la question n'a pas été posée — colonne absente d'une base
//     ancienne). L'écran ne signale que le `true`.
//
// Et la garantie qui va avec : sur une base où `tour_association_point.remballe`
// n'existe pas encore, l'endpoint ne tombe pas — il retombe sur la forme
// historique et sert la tournée, `remballe` à `null`.
//
// Auth réelle (JWT signé), base mockée par routage sur le TEXTE SQL.
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
  getRedisClient: () => ({}),
  isRedisAvailable: () => false,
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

const TOUR_ID = 517;

// Jeton SANS `tv` : le contrôle de révocation est alors sauté (jeton hérité),
// donc aucune lecture `users` ne vient polluer le routage du mock.
const adminToken = jwt.sign(
  { id: 1, userId: 1, username: 'u1', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' }
);

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', require('../../src/routes/tours'));
});

const TOUR_PAV = {
  id: TOUR_ID, date: '2026-08-26', status: 'completed', collection_type: 'pav',
  started_at: '2026-08-26T05:40:00.000Z', completed_at: '2026-08-26T13:20:00.000Z',
  estimated_distance_km: 92, estimated_duration_min: 340,
  vehicle_id: 4, registration: 'AB-123-CD', vehicle_name: 'Renault Master',
  max_capacity_kg: 3500, driver_id: 12, driver_name: 'DUPONT Marc',
};

/**
 * Routeur de mock par TEXTE SQL.
 * `remballeAbsente` reproduit une base non migrée : TOUTE requête nommant
 * `tap.remballe` échoue en 42703, comme le ferait PostgreSQL.
 */
function mockDb(opts = {}) {
  const {
    tour = TOUR_PAV, cavs = [], associations = [], remballeAbsente = false,
  } = opts;

  mockQuery.mockImplementation((sql) => {
    const t = String(sql);
    if (/FROM tour_cav tc/.test(t)) return Promise.resolve({ rows: cavs });
    if (/FROM tour_association_point tap/.test(t)) {
      if (remballeAbsente && /tap\.remballe/.test(t)) {
        const e = new Error('column tap.remballe does not exist');
        e.code = '42703';
        return Promise.reject(e);
      }
      // La requête de repli n'a pas les colonnes : elle projette NULL, comme
      // le ferait PostgreSQL sur `NULL::boolean AS remballe`.
      const rows = associations.map((r) => (
        /tap\.remballe/.test(t) ? r : { ...r, remballe: null, nb_sacs: null }
      ));
      return Promise.resolve({ rows });
    }
    if (/FROM incidents/.test(t)) return Promise.resolve({ rows: [] });
    if (/FROM tour_weights/.test(t)) return Promise.resolve({ rows: [] });
    if (/FROM gps_positions/.test(t)) return Promise.resolve({ rows: [] });
    if (/FROM tours t/.test(t)) return Promise.resolve({ rows: tour ? [tour] : [] });
    return Promise.resolve({ rows: [] });
  });
}

const get = (id = TOUR_ID) => request(app)
  .get(`/api/tours/${id}/live-summary`)
  .set('Authorization', `Bearer ${adminToken}`);

beforeEach(() => { mockQuery.mockReset(); mockClient.release.mockReset(); });

describe('habilitations et garde-fous', () => {
  test('401 sans jeton', async () => {
    mockDb();
    const r = await request(app).get(`/api/tours/${TOUR_ID}/live-summary`);
    expect(r.status).toBe(401);
  });

  test('404 sur une tournée inexistante', async () => {
    mockDb({ tour: null });
    const r = await get(99999);
    expect(r.status).toBe(404);
  });

  test('400 sur un identifiant illisible', async () => {
    mockDb();
    const r = await request(app).get('/api/tours/abc/live-summary')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(400);
  });
});

describe('points d’une tournée de bornes', () => {
  const cav = (extra) => ({
    id: 1, cav_id: 88, position: 1, status: 'collected', fill_level: 4,
    collected_at: '2026-08-26T06:30:00.000Z', notes: null,
    planned_passage_time: '2026-08-26T06:20:00.000Z',
    cav_name: 'LE HOULME - 12 rue Verte', address: '12 rue Verte',
    commune: 'LE HOULME', latitude: 49.45, longitude: 1.05,
    ...extra,
  });

  test('nb_containers et remballe sont exposés tels qu’ils sont en base', async () => {
    mockDb({ cavs: [cav({ nb_containers: 3, remballe: true, skip_reason: null })] });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.points).toHaveLength(1);
    expect(r.body.points[0]).toMatchObject({
      cav_id: 88, nb_containers: 3, remballe: true, skip_reason: null,
    });
  });

  test('« non » reste « non » : remballe false n’est pas confondu avec absent', async () => {
    mockDb({ cavs: [cav({ nb_containers: 1, remballe: false })] });
    const r = await get();
    expect(r.body.points[0].remballe).toBe(false);
    expect(r.body.points[0].nb_containers).toBe(1);
  });

  test('base ancienne (colonnes absentes de la ligne) : null, jamais false ni 1', async () => {
    // Une base d'avant la migration ne renvoie tout simplement pas ces clés.
    mockDb({ cavs: [cav()] });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.points[0].remballe).toBeNull();
    expect(r.body.points[0].nb_containers).toBeNull();
  });

  test('le motif de non-collecte remonte, au lieu du seul statut « skipped »', async () => {
    mockDb({ cavs: [cav({ status: 'skipped', collected_at: null, skip_reason: 'acces_impossible' })] });
    const r = await get();
    expect(r.body.points[0]).toMatchObject({ status: 'skipped', skip_reason: 'acces_impossible' });
  });
});

describe('points d’une tournée association', () => {
  const TOUR_ASSO = { ...TOUR_PAV, collection_type: 'association' };
  const point = (extra) => ({
    id: 9, cav_id: 42, position: 1, status: 'collected', fill_level: 3,
    collected_at: '2026-08-26T09:10:00.000Z', arrived_at: '2026-08-26T08:55:00.000Z',
    duree_prevue_min: 30, notes: null, planned_passage_time: '2026-08-26T09:00:00.000Z',
    cav_name: 'Croix-Rouge — Rouen', address: '3 rue du Bac', commune: 'ROUEN',
    latitude: 49.44, longitude: 1.10, nb_containers: null,
    ...extra,
  });

  test('remballe et nb_sacs remontent, nb_containers vaut null — jamais 1', async () => {
    mockDb({ tour: TOUR_ASSO, associations: [point({ remballe: true, nb_sacs: 12 })] });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.points[0]).toMatchObject({ cav_id: 42, remballe: true, nb_sacs: 12 });
    expect(r.body.points[0].nb_containers).toBeNull();
  });

  test('remballe déclarée sans décompte : nb_sacs null, jamais 0', async () => {
    mockDb({ tour: TOUR_ASSO, associations: [point({ remballe: true, nb_sacs: null })] });
    const r = await get();
    expect(r.body.points[0].remballe).toBe(true);
    expect(r.body.points[0].nb_sacs).toBeNull();
  });

  test('colonnes absentes : l’endpoint sert la tournée, remballe et nb_sacs à null', async () => {
    mockDb({
      tour: TOUR_ASSO,
      associations: [point({ remballe: true, nb_sacs: 12 })],
      remballeAbsente: true,
    });
    const r = await get();
    // C'est la garantie qui compte : le repli n'ampute pas l'écran de ses
    // points, il n'ampute que les champs qui n'existent pas encore.
    expect(r.status).toBe(200);
    expect(r.body.points).toHaveLength(1);
    expect(r.body.points[0].cav_id).toBe(42);
    expect(r.body.points[0].remballe).toBeNull();
    expect(r.body.points[0].nb_sacs).toBeNull();
  });
});

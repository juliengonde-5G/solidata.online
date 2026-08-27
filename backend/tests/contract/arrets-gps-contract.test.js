// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — arrêts GPS d'une tournée
// ───────────────────────────────────────────────────────────────────────────
//   GET  /api/tours/:id/arrets-gps
//   POST /api/tours/:id/arrets-gps/recalcul
//   GET  /api/tours/analyse-gps/cav-durees
//
// Ce que ces tests verrouillent, au-delà des codes HTTP : la FORME de la
// réponse (l'écran la lit telle quelle), le fait qu'une tournée en cours ne
// soit JAMAIS figée en base, et qu'une absence de donnée se dise avec un motif
// au lieu de se présenter comme un zéro.
//
// Auth réelle (JWT), base mockée par routage SQL — même harnais que
// `cav-historique-contract.test.js`.
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

const mockQuery = jest.fn();
const mockClient = {
  query: jest.fn().mockResolvedValue({ rows: [] }),
  release: jest.fn(),
};
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn().mockImplementation(() => Promise.resolve(mockClient)),
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
const { resetReglagesCache } = require('../../src/routes/tours/analyse-gps');

const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });
const managerToken = jwt.sign({ id: 2, username: 'manager', role: 'MANAGER' }, JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign({ id: 3, username: 'collab', role: 'COLLABORATEUR' }, JWT_SECRET, { expiresIn: '1h' });

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', require('../../src/routes/tours'));
});

function mockDb(handlers) {
  mockQuery.mockImplementation((sql, params) => {
    const text = String(sql);
    for (const [pattern, rows] of handlers) {
      if (pattern.test(text)) {
        return Promise.resolve({ rows: typeof rows === 'function' ? rows(params) : rows });
      }
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockClient.query.mockReset().mockResolvedValue({ rows: [] });
  mockClient.release.mockReset();
  // Les réglages sont mis en cache 60 s : sans purge, le premier test imposerait
  // ses seuils à tous les suivants.
  resetReglagesCache();
});

const LAT = 49.4231;
const LNG = 1.0993;
const nord = (m) => LAT + m / 111320;
const t0 = Date.UTC(2026, 7, 26, 6, 0, 0);
const at = (min) => new Date(t0 + min * 60000).toISOString();

/** Trace : 10 min immobile sur la borne 11, puis départ. */
const TRACE_BORNE = [
  { latitude: nord(1000), longitude: LNG, recorded_at: at(0) },
  { latitude: nord(1005), longitude: LNG, recorded_at: at(4) },
  { latitude: nord(1002), longitude: LNG, recorded_at: at(10) },
  { latitude: nord(4000), longitude: LNG, recorded_at: at(20) },
];

const CONTEXTE = [
  [/FROM tour_cav tc JOIN cav c/, [{ id: 11, name: 'ROUEN - Rue A', latitude: nord(1000), longitude: LNG }]],
  [/FROM tour_association_point tap JOIN association_points/, []],
  [/FROM lieux_techniques/, [{ id: 1, nom: 'Centre de tri', adresse: null, latitude: LAT, longitude: LNG, duree_min: 20 }]],
];

describe('GET /api/tours/:id/arrets-gps', () => {
  test('tournée EN COURS → calcul à la volée, source « live », AUCUNE écriture', async () => {
    mockDb([
      [/SELECT id, status FROM tours/, [{ id: 7, status: 'in_progress' }]],
      [/SELECT id, vehicle_id, is_demo FROM tours/, [{ id: 7, vehicle_id: 3, is_demo: false }]],
      [/FROM gps_positions/, TRACE_BORNE],
      ...CONTEXTE,
    ]);

    const r = await request(app).get('/api/tours/7/arrets-gps').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('live');
    expect(r.body.arrets).toHaveLength(1);
    expect(r.body.arrets[0]).toMatchObject({
      type: 'cav', cav_id: 11, cav_nom: 'ROUEN - Rue A', duree_min: 10,
    });
    expect(r.body.seuil_min).toBe(5);
    expect(r.body.rayon_m).toBe(40);
    // Rien ne doit être figé tant que la journée n'est pas finie.
    const ecritures = mockQuery.mock.calls.filter(([s]) => /INSERT INTO tour_gps_stops|DELETE FROM tour_gps_stops/.test(String(s)));
    expect(ecritures).toHaveLength(0);
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  test('tournée CLOSE → lecture de la table, source « table »', async () => {
    mockDb([
      [/SELECT id, status FROM tours/, [{ id: 8, status: 'completed' }]],
      [/FROM tour_gps_stops s/, [{
        id: 1, debut: at(0), fin: at(10), duree_min: '10.0',
        latitude: nord(1000), longitude: LNG, type: 'cav',
        cav_id: 11, association_point_id: null, source: 'cloture',
        cav_nom: 'ROUEN - Rue A', association_nom: null, duree_prevue_min: null,
      }]],
    ]);

    const r = await request(app).get('/api/tours/8/arrets-gps').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('table');
    expect(r.body.arrets[0].duree_min).toBe(10);
    expect(r.body.arrets[0].cav_nom).toBe('ROUEN - Rue A');
  });

  test('aucun relevé GPS → liste vide ET motif, jamais un zéro muet', async () => {
    mockDb([
      [/SELECT id, status FROM tours/, [{ id: 9, status: 'completed' }]],
      [/FROM tour_gps_stops s/, []],
      [/SELECT id, vehicle_id, is_demo FROM tours/, [{ id: 9, vehicle_id: 3, is_demo: false }]],
      [/FROM gps_positions/, []],
      ...CONTEXTE,
    ]);

    const r = await request(app).get('/api/tours/9/arrets-gps').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.arrets).toEqual([]);
    expect(r.body.motif).toMatch(/Aucun relevé GPS/i);
  });

  test('tournée inconnue → 404 avec code stable', async () => {
    mockDb([[/SELECT id, status FROM tours/, []]]);
    const r = await request(app).get('/api/tours/999/arrets-gps').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('TOUR_INTROUVABLE');
  });

  test('identifiant illisible → 400, la requête ne descend jamais jusqu’à PostgreSQL', async () => {
    mockDb([]);
    const r = await request(app).get('/api/tours/abc/arrets-gps').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('TOUR_INVALIDE');
  });

  test('MANAGER autorisé, COLLABORATEUR refusé, anonyme refusé', async () => {
    mockDb([
      [/SELECT id, status FROM tours/, [{ id: 7, status: 'completed' }]],
      [/FROM tour_gps_stops s/, []],
      [/SELECT id, vehicle_id, is_demo FROM tours/, [{ id: 7, vehicle_id: 3, is_demo: false }]],
      [/FROM gps_positions/, []],
      ...CONTEXTE,
    ]);
    expect((await request(app).get('/api/tours/7/arrets-gps').set('Authorization', `Bearer ${managerToken}`)).status).toBe(200);
    expect((await request(app).get('/api/tours/7/arrets-gps').set('Authorization', `Bearer ${collabToken}`)).status).toBe(403);
    expect((await request(app).get('/api/tours/7/arrets-gps')).status).toBe(401);
  });
});

describe('POST /api/tours/:id/arrets-gps/recalcul', () => {
  test('tournée non clôturée → 409 TOURNEE_NON_CLOTUREE (jamais de durée figée à tort)', async () => {
    mockDb([[/SELECT id, status FROM tours/, [{ id: 7, status: 'in_progress' }]]]);
    const r = await request(app).post('/api/tours/7/arrets-gps/recalcul').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('TOURNEE_NON_CLOTUREE');
  });

  test('tournée close → DELETE puis INSERT dans UNE transaction (recalcul idempotent)', async () => {
    mockDb([
      [/SELECT id, status FROM tours/, [{ id: 8, status: 'completed' }]],
      [/SELECT id, vehicle_id, is_demo FROM tours/, [{ id: 8, vehicle_id: 3, is_demo: false }]],
      [/FROM gps_positions/, TRACE_BORNE],
      ...CONTEXTE,
    ]);

    const r = await request(app).post('/api/tours/8/arrets-gps/recalcul').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.persistes).toBe(1);

    const sql = mockClient.query.mock.calls.map(([s]) => String(s));
    expect(sql[0]).toBe('BEGIN');
    expect(sql.some((s) => /DELETE FROM tour_gps_stops WHERE tour_id/.test(s))).toBe(true);
    expect(sql.some((s) => /INSERT INTO tour_gps_stops/.test(s))).toBe(true);
    expect(sql[sql.length - 1]).toBe('COMMIT');
    // Le DELETE précède l'INSERT : c'est ce qui rend le recalcul idempotent.
    expect(sql.findIndex((s) => /DELETE FROM tour_gps_stops/.test(s)))
      .toBeLessThan(sql.findIndex((s) => /INSERT INTO tour_gps_stops/.test(s)));
    // La source dit d'où vient la ligne — « recalcul », pas « cloture ».
    const insert = mockClient.query.mock.calls.find(([s]) => /INSERT INTO tour_gps_stops/.test(String(s)));
    expect(insert[1][insert[1].length - 1]).toBe('recalcul');
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('COLLABORATEUR refusé en écriture', async () => {
    mockDb([[/SELECT id, status FROM tours/, [{ id: 8, status: 'completed' }]]]);
    const r = await request(app).post('/api/tours/8/arrets-gps/recalcul').set('Authorization', `Bearer ${collabToken}`);
    expect(r.status).toBe(403);
  });
});

describe('GET /api/tours/analyse-gps/cav-durees', () => {
  const LIGNES = [
    { cav_id: 11, cav_nom: 'ROUEN - Rue A', fill_level: 4, nb_passages: 6, duree_moyenne_min: '11.5', duree_mediane_min: '12.0' },
    { cav_id: 11, cav_nom: 'ROUEN - Rue A', fill_level: 2, nb_passages: 3, duree_moyenne_min: '6.0', duree_mediane_min: '6.0' },
  ];

  test('la route n’est PAS captée par « /:id » et renvoie le croisement durée × remplissage', async () => {
    mockDb([[/FROM tour_gps_stops s/, LIGNES]]);
    const r = await request(app).get('/api/tours/analyse-gps/cav-durees').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.lignes).toHaveLength(2);
    expect(r.body.lignes[0]).toEqual({
      cav_id: 11, cav_nom: 'ROUEN - Rue A', fill_level: 4,
      nb_passages: 6, duree_moyenne_min: 11.5, duree_mediane_min: 12,
    });
    expect(r.body.periode.mois).toBe(6);
  });

  test('la fenêtre est bornée 1–24 mois, une valeur hors bornes retombe sur le défaut', async () => {
    mockDb([[/FROM tour_gps_stops s/, (params) => { expect(params[0]).toBe(6); return LIGNES; }]]);
    const r = await request(app).get('/api/tours/analyse-gps/cav-durees?mois=99').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.periode.mois).toBe(6);
  });

  test('mois = 12 est honoré et paramétré (jamais interpolé dans le SQL)', async () => {
    let vus = null;
    mockDb([[/FROM tour_gps_stops s/, (params) => { vus = params; return []; }]]);
    const r = await request(app).get('/api/tours/analyse-gps/cav-durees?mois=12').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.periode.mois).toBe(12);
    expect(vus).toEqual([12]);
  });

  test('cav_id illisible → 400 (aucune requête émise)', async () => {
    mockDb([]);
    const r = await request(app).get('/api/tours/analyse-gps/cav-durees?cav_id=zz').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('CAV_INVALIDE');
  });

  test('aucune mesure sur la période → liste vide AVEC motif, jamais des zéros', async () => {
    mockDb([[/FROM tour_gps_stops s/, []]]);
    const r = await request(app).get('/api/tours/analyse-gps/cav-durees').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.lignes).toEqual([]);
    expect(r.body.motif).toMatch(/Aucun arrêt rattaché/i);
  });

  test('COLLABORATEUR refusé', async () => {
    mockDb([[/FROM tour_gps_stops s/, []]]);
    expect((await request(app).get('/api/tours/analyse-gps/cav-durees').set('Authorization', `Bearer ${collabToken}`)).status).toBe(403);
  });
});

describe('Réglages lus dans settings, jamais en dur', () => {
  test('un seuil paramétré à 12 min est appliqué à la détection', async () => {
    mockDb([
      [/FROM settings WHERE key = ANY/, [
        { key: 'collecte.arret_seuil_min', value: '12' },
        { key: 'collecte.arret_rayon_m', value: '25' },
      ]],
      [/SELECT id, status FROM tours/, [{ id: 7, status: 'in_progress' }]],
      [/SELECT id, vehicle_id, is_demo FROM tours/, [{ id: 7, vehicle_id: 3, is_demo: false }]],
      [/FROM gps_positions/, TRACE_BORNE],
      ...CONTEXTE,
    ]);
    const r = await request(app).get('/api/tours/7/arrets-gps').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.seuil_min).toBe(12);
    expect(r.body.rayon_m).toBe(25);
    // L'arrêt de 10 min ne passe plus le seuil de 12.
    expect(r.body.arrets).toEqual([]);
  });

  test('une valeur aberrante en base retombe sur le défaut documenté', async () => {
    mockDb([
      [/FROM settings WHERE key = ANY/, [
        { key: 'collecte.arret_seuil_min', value: 'douze' },
        { key: 'collecte.arret_rayon_m', value: '-40' },
      ]],
      [/SELECT id, status FROM tours/, [{ id: 7, status: 'in_progress' }]],
      [/SELECT id, vehicle_id, is_demo FROM tours/, [{ id: 7, vehicle_id: 3, is_demo: false }]],
      [/FROM gps_positions/, []],
      ...CONTEXTE,
    ]);
    const r = await request(app).get('/api/tours/7/arrets-gps').set('Authorization', `Bearer ${adminToken}`);
    expect(r.body.seuil_min).toBe(5);
    expect(r.body.rayon_m).toBe(40);
  });
});

describe('Tournée de DÉMONSTRATION', () => {
  test('aucun arrêt analysé : un exercice de formation ne dit rien du terrain', async () => {
    mockDb([
      [/SELECT id, status FROM tours/, [{ id: 42, status: 'in_progress' }]],
      [/SELECT id, vehicle_id, is_demo FROM tours/, [{ id: 42, vehicle_id: 3, is_demo: true }]],
      [/FROM gps_positions/, TRACE_BORNE],
      ...CONTEXTE,
    ]);
    const r = await request(app).get('/api/tours/42/arrets-gps').set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.arrets).toEqual([]);
    expect(mockQuery.mock.calls.some(([s]) => /FROM gps_positions/.test(String(s)))).toBe(false);
  });
});

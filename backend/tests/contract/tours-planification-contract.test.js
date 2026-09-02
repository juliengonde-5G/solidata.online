// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — PLANIFICATION DES TOURNÉES (contraintes de journée)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la forme de réponse consommée par le frontend et par l'écran de
// pilotage, pour les évolutions d'août 2026 :
//   - POST /tours/estimate     : forme EXACTE de l'objet `estimation`
//                                (travail vs total, pause, vidages, timeline) ;
//   - POST /tours/standard|manual : refus 409 `DUREE_MAX_DEPASSEE` quand la
//                                journée de 6 h de travail est dépassée, et
//                                création possible avec `force: true` ;
//   - CRUD des modèles de tournée : GET détail, PUT (remplacement complet et
//                                ordonné de la composition), DELETE refusé en
//                                409 `ROUTE_UTILISEE` ;
//   - GET /tours/saturation-risks : forme, tri par urgence, couverture ;
//   - POST /tours/intelligent  : exposition de `saturation_non_couverte`.
//
// Auth réelle (JWT sans `tv` → aucun contrôle token_version), DB mockée,
// OSRM mocké (aucun appel réseau), prédiction de remplissage mockée.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
const mockConnect = jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} }));
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));

// OSRM : chaque tronçon coûte 10 min / 5 km, l'optimisation « Trip » est
// indisponible → repli TSP local (pur, déterministe, sans réseau).
jest.mock('../../src/routes/tours/geo', () => {
  const actual = jest.requireActual('../../src/routes/tours/geo');
  return {
    ...actual,
    osrmRouteSegment: jest.fn(async () => ({ distance_km: 5, duration_min: 10 })),
    osrmOptimizedTrip: jest.fn(async () => null),
  };
});

// Contexte du jour : pas d'appel météo, facteur de trafic neutre.
jest.mock('../../src/routes/tours/context', () => {
  const actual = jest.requireActual('../../src/routes/tours/context');
  return {
    ...actual,
    getContextForDate: jest.fn(async () => ({
      weatherFactor: 1, trafficFactor: 1, durationFactor: 1,
      weatherLabel: 'Ensoleillé', weatherCode: 0, tempMax: 20, precipMm: 0, notes: null,
    })),
    getLocalEventsForDate: jest.fn(async () => []),
  };
});

// Remplissage prédit piloté par le test (mockFills), le reste du moteur est réel.
// Préfixe « mock » obligatoire pour être accessible depuis une fabrique jest.mock.
const mockFills = new Map();
jest.mock('../../src/routes/tours/predictions', () => {
  const actual = jest.requireActual('../../src/routes/tours/predictions');
  return {
    ...actual,
    predictFillRate: jest.fn(async (cavId) => ({
      fill: mockFills.has(Number(cavId)) ? mockFills.get(Number(cavId)) : 50,
      confidence: 0.8,
      method: 'test',
      factors: { daysSinceCollection: 5, avgWeight: 100, avgDaysBetween: 7 },
      contextUsed: {},
    })),
  };
});

const express = require('express');
const request = require('supertest');
const { authenticate } = require('../../src/middleware/auth');

const crudRouter = require('../../src/routes/tours/crud');
const proposalsRouter = require('../../src/routes/tours/proposals');

const tokenFor = (role) => jwt.sign(
  { id: 1, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), MANAGER: tokenFor('MANAGER'), COLLABORATEUR: tokenFor('COLLABORATEUR'),
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', authenticate, proposalsRouter);
  app.use('/api/tours', authenticate, crudRouter);
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (path, role, body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const put = (path, role, body = {}) => request(app).put(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const del = (path, role) => request(app).delete(path).set('Authorization', `Bearer ${TOKENS[role]}`);

// ── Jeu de données mocké ───────────────────────────────────────────────────
const VEHICLE = { id: 3, registration: 'AB-123-CD', name: 'Camion 1', max_capacity_kg: 3500, status: 'available' };

function makeCavs(n, { containers = 1 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `CAV ${i + 1}`,
    address: `${i + 1} rue du Tri`,
    commune: 'Rouen',
    latitude: 49.42 + (i + 1) / 100,
    longitude: 1.09,
    nb_containers: containers,
    status: 'active',
  }));
}

/** Installe le routage des requêtes SQL mockées (dispatch par motif). */
function installMocks(state = {}) {
  const {
    vehicle = VEHICLE,
    cavs = makeCavs(3),
    routeCavs = null,
    associationPoints = [],
    predictions = [],
    conflict = [],
    toursUsingRoute = 0,
    route = { id: 9, name: 'Modèle Rive Droite', description: null, is_active: true },
    routeComposition = [],
    saturationRows = [],
    coverageRows = [],
    inserted = { id: 101 },
    tourRow = null,
    plannedPoints = [],
  } = state;
  const calls = [];
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql).replace(/\s+/g, ' ');
    calls.push({ sql: s, params });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return Promise.resolve({ rows: [] });
    // planned-passage (ETA d'exécution)
    if (/FROM tours t LEFT JOIN vehicles v/.test(s)) return Promise.resolve({ rows: tourRow ? [tourRow] : [] });
    if (/FROM tour_cav tc JOIN cav c ON c\.id = tc\.cav_id/.test(s)) return Promise.resolve({ rows: plannedPoints });
    if (/UPDATE tour_cav SET planned_passage_time/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM vehicles WHERE id = \$1/.test(s)) return Promise.resolve({ rows: vehicle ? [vehicle] : [] });
    if (/FROM tours WHERE vehicle_id = \$1 AND date = \$2 AND collection_type = 'association'/.test(s)) {
      return Promise.resolve({ rows: [] });
    }
    if (/FROM tours WHERE vehicle_id = \$1 AND date = \$2/.test(s)) return Promise.resolve({ rows: conflict });
    if (/FROM cav WHERE id = ANY\(\$1\)/.test(s)) {
      const ids = (params[0] || []).map(Number);
      return Promise.resolve({ rows: cavs.filter((c) => ids.includes(c.id)) });
    }
    if (/FROM cav WHERE status = 'active' ORDER BY name/.test(s)) return Promise.resolve({ rows: cavs });
    if (/FROM standard_route_cav src JOIN cav/.test(s)) {
      return Promise.resolve({ rows: (routeCavs || cavs).map((c, i) => ({ ...c, position: i + 1 })) });
    }
    if (/SELECT cav_id FROM standard_route_cav WHERE route_id/.test(s)) {
      return Promise.resolve({ rows: routeComposition.map((id) => ({ cav_id: id })) });
    }
    if (/FROM association_points WHERE id = ANY/.test(s)) {
      const ids = (params[0] || []).map(Number);
      return Promise.resolve({ rows: associationPoints.filter((p) => ids.includes(p.id)) });
    }
    if (/FROM ml_fill_predictions WHERE cav_id = ANY/.test(s)) return Promise.resolve({ rows: predictions });
    if (/WITH pred AS/.test(s) && /FROM cav c/.test(s)) return Promise.resolve({ rows: saturationRows });
    if (/DISTINCT ON \(tc\.cav_id\)/.test(s)) return Promise.resolve({ rows: coverageRows });
    if (/FROM cav_collection_times/.test(s)) return Promise.resolve({ rows: [] });
    if (/INSERT INTO tours/.test(s)) {
      return Promise.resolve({ rows: [{ ...inserted, date: params[0], vehicle_id: params[1] }] });
    }
    if (/INSERT INTO tour_cav/.test(s) || /INSERT INTO tour_association_point/.test(s)) {
      return Promise.resolve({ rows: [] });
    }
    if (/SELECT COUNT\(\*\)::int AS n FROM tours WHERE standard_route_id/.test(s)) {
      return Promise.resolve({ rows: [{ n: toursUsingRoute }] });
    }
    if (/FROM standard_routes WHERE id = \$1/.test(s)) return Promise.resolve({ rows: route ? [route] : [] });
    if (/INSERT INTO standard_routes/.test(s)) return Promise.resolve({ rows: [{ ...route, name: params[0] }] });
    if (/UPDATE standard_routes SET name/.test(s)) return Promise.resolve({ rows: [{ ...route, name: params[1] || route.name }] });
    if (/UPDATE standard_routes SET estimated_duration_minutes/.test(s)) return Promise.resolve({ rows: [] });
    if (/DELETE FROM standard_routes/.test(s)) return Promise.resolve({ rows: [{ id: params[0] }] });
    if (/DELETE FROM standard_route_cav/.test(s) || /DELETE FROM standard_route_association/.test(s)) {
      return Promise.resolve({ rows: [] });
    }
    if (/INSERT INTO standard_route_cav/.test(s) || /INSERT INTO standard_route_association/.test(s)) {
      return Promise.resolve({ rows: [] });
    }
    if (/UPDATE tours SET/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
  return calls;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockClear();
  mockFills.clear();
  installMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/tours/estimate — forme de l’objet `estimation`', () => {
  it('renvoie tous les champs du contrat, pause exclue du temps de travail', async () => {
    installMocks({ cavs: makeCavs(3), predictions: [] });
    const res = await post('/api/tours/estimate', 'MANAGER', {
      vehicle_id: 3, date: '2026-09-01', cav_ids: [1, 2, 3],
    });
    expect(res.status).toBe(200);
    const e = res.body.estimation;
    expect(e).toBeTruthy();
    // Champs obligatoires du contrat
    for (const k of [
      'faisable', 'duree_travail_min', 'duree_totale_min', 'budget_travail_min',
      'depassement_min', 'distance_km', 'poids_estime_kg', 'capacite_vehicule_kg',
      'taux_remplissage_vehicule_pct', 'nb_points', 'nb_retours_vidage',
      'pause_dejeuner_incluse', 'pause_dejeuner_min', 'heure_depart',
      'heure_fin_estimee', 'timeline', 'avertissements',
    ]) {
      expect(e).toHaveProperty(k);
    }
    expect(typeof e.faisable).toBe('boolean');
    expect(Array.isArray(e.timeline)).toBe(true);
    expect(Array.isArray(e.avertissements)).toBe(true);
    expect(e.nb_points).toBe(3);
    expect(e.budget_travail_min).toBe(360); // 6 h de travail
    expect(e.duree_totale_min).toBe(e.duree_travail_min + e.pause_dejeuner_min);
    expect(e.heure_depart).toMatch(/^\d{2}:\d{2}$/);
    expect(e.heure_fin_estimee).toMatch(/^\d{2}:\d{2}$/);
    expect(e.capacite_vehicule_kg).toBe(3500);
    // Timeline : départ … points … retour final
    expect(e.timeline[0].type).toBe('depart');
    expect(e.timeline[e.timeline.length - 1].type).toBe('retour_final');
    const points = e.timeline.filter((t) => t.type === 'point');
    expect(points).toHaveLength(3);
    for (const p of points) {
      expect(p).toHaveProperty('cav_id');
      expect(p).toHaveProperty('arrivee_min');
      expect(p).toHaveProperty('depart_min');
      expect(p).toHaveProperty('poids_cumule_kg');
    }
    // `ordre_optimise` n'est présent que sur demande
    expect(e.ordre_optimise).toBeUndefined();
  });

  it('optimize:true renvoie `ordre_optimise` (les mêmes identifiants, réordonnés)', async () => {
    installMocks({ cavs: makeCavs(4) });
    const res = await post('/api/tours/estimate', 'ADMIN', {
      vehicle_id: 3, date: '2026-09-01', cav_ids: [4, 1, 3, 2], optimize: true,
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.estimation.ordre_optimise)).toBe(true);
    expect([...res.body.estimation.ordre_optimise].sort()).toEqual([1, 2, 3, 4]);
  });

  it('accepte un modèle de tournée comme source de points', async () => {
    installMocks({ cavs: makeCavs(3) });
    const res = await post('/api/tours/estimate', 'ADMIN', {
      vehicle_id: 3, date: '2026-09-01', standard_route_id: 9,
    });
    expect(res.status).toBe(200);
    expect(res.body.estimation.nb_points).toBe(3);
  });

  it('400 si zéro ou plusieurs sources de points', async () => {
    const aucune = await post('/api/tours/estimate', 'ADMIN', { vehicle_id: 3 });
    expect(aucune.status).toBe(400);
    const deux = await post('/api/tours/estimate', 'ADMIN', {
      vehicle_id: 3, cav_ids: [1], standard_route_id: 9,
    });
    expect(deux.status).toBe(400);
  });

  it('404 si le véhicule n’existe pas', async () => {
    installMocks({ vehicle: null });
    const res = await post('/api/tours/estimate', 'ADMIN', { vehicle_id: 999, cav_ids: [1] });
    expect(res.status).toBe(404);
  });

  it('réservé ADMIN/MANAGER (403 pour les autres rôles)', async () => {
    const res = await post('/api/tours/estimate', 'COLLABORATEUR', { vehicle_id: 3, cav_ids: [1] });
    expect(res.status).toBe(403);
  });

  it('journée trop chargée : faisable=false et dépassement chiffré, sans rien retirer', async () => {
    installMocks({ cavs: makeCavs(20) });
    const res = await post('/api/tours/estimate', 'ADMIN', {
      vehicle_id: 3, date: '2026-09-01', cav_ids: makeCavs(20).map((c) => c.id),
    });
    expect(res.status).toBe(200);
    const e = res.body.estimation;
    expect(e.nb_points).toBe(20);
    expect(e.faisable).toBe(false);
    expect(e.depassement_min).toBeGreaterThan(0);
    expect(e.duree_travail_min).toBeGreaterThan(e.budget_travail_min);
    expect(e.avertissements.join(' ')).toMatch(/dépassement/i);
  });

  it('les points association sont estimés sans poids (avertissement explicite)', async () => {
    installMocks({
      associationPoints: [
        { id: 51, name: 'Asso A', address: 'rue A', commune: 'Rouen', latitude: 49.44, longitude: 1.10 },
        { id: 52, name: 'Asso B', address: 'rue B', commune: 'Rouen', latitude: 49.45, longitude: 1.11 },
      ],
    });
    const res = await post('/api/tours/estimate', 'ADMIN', {
      vehicle_id: 3, date: '2026-09-01', association_point_ids: [51, 52],
    });
    expect(res.status).toBe(200);
    expect(res.body.estimation.poids_estime_kg).toBe(0);
    expect(res.body.estimation.avertissements.join(' ')).toMatch(/poids non estimé/i);
    const points = res.body.estimation.timeline.filter((t) => t.type === 'point');
    expect(points[0].association_point_id).toBe(51);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/tours/manual — contrainte de durée sur le mode manuel', () => {
  it('409 DUREE_MAX_DEPASSEE avec l’estimation jointe, aucune tournée créée', async () => {
    const calls = installMocks({ cavs: makeCavs(20) });
    const res = await post('/api/tours/manual', 'MANAGER', {
      vehicle_id: 3, date: '2026-09-01', cav_ids: makeCavs(20).map((c) => c.id),
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUREE_MAX_DEPASSEE');
    expect(res.body.estimation).toBeTruthy();
    expect(res.body.estimation.depassement_min).toBeGreaterThan(0);
    expect(res.body.error).toMatch(/dépasse la journée de travail/i);
    expect(calls.some((c) => /INSERT INTO tours/.test(c.sql))).toBe(false);
  });

  it('force:true crée quand même la tournée et trace le forçage', async () => {
    const calls = installMocks({ cavs: makeCavs(20) });
    const res = await post('/api/tours/manual', 'MANAGER', {
      vehicle_id: 3, date: '2026-09-01', cav_ids: makeCavs(20).map((c) => c.id), force: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.estimation.depassement_min).toBeGreaterThan(0);
    const insert = calls.find((c) => /INSERT INTO tours/.test(c.sql));
    expect(insert).toBeTruthy();
    expect(String(insert.params[3])).toMatch(/forcé/);
  });

  it('tournée courte : création normale, distance / durée / nb_cav stockés', async () => {
    const calls = installMocks({ cavs: makeCavs(3) });
    const res = await post('/api/tours/manual', 'MANAGER', {
      vehicle_id: 3, date: '2026-09-01', cav_ids: [1, 2, 3],
    });
    expect(res.status).toBe(201);
    expect(res.body.estimation.faisable).toBe(true);
    const insert = calls.find((c) => /INSERT INTO tours/.test(c.sql));
    // [date, vid, did, ai_explanation, distance, duree_travail, nb_points]
    expect(insert.params[4]).toBe(res.body.estimation.distance_km);
    expect(insert.params[5]).toBe(res.body.estimation.duree_travail_min);
    expect(insert.params[6]).toBe(3);
    // Le remplissage prédit est écrit sur chaque point
    const cavInserts = calls.filter((c) => /INSERT INTO tour_cav/.test(c.sql));
    expect(cavInserts).toHaveLength(3);
    expect(cavInserts[0].params[3]).not.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/tours/standard — contrainte de durée sur le mode standard', () => {
  it('409 DUREE_MAX_DEPASSEE quand le modèle ne tient pas dans la journée', async () => {
    installMocks({ cavs: makeCavs(20), routeCavs: makeCavs(20) });
    const res = await post('/api/tours/standard', 'ADMIN', {
      vehicle_id: 3, date: '2026-09-01', standard_route_id: 9,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUREE_MAX_DEPASSEE');
    expect(res.body.estimation.budget_travail_min).toBe(360);
  });

  it('modèle court : création + estimation renvoyée', async () => {
    installMocks({ cavs: makeCavs(3), routeCavs: makeCavs(3) });
    const res = await post('/api/tours/standard', 'ADMIN', {
      vehicle_id: 3, date: '2026-09-01', standard_route_id: 9,
    });
    expect(res.status).toBe(201);
    expect(res.body.estimation.nb_points).toBe(3);
    expect(res.body.id).toBe(101);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Modèles de tournée — CRUD', () => {
  it('GET /routes/:id renvoie { route, cavs } ordonnés par position', async () => {
    installMocks({ cavs: makeCavs(3) });
    const res = await get('/api/tours/routes/9', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.route).toBeTruthy();
    expect(Array.isArray(res.body.cavs)).toBe(true);
    expect(res.body.cavs[0]).toHaveProperty('position');
  });

  it('GET /routes/:id → 404 si le modèle n’existe pas', async () => {
    installMocks({ route: null });
    const res = await get('/api/tours/routes/404', 'ADMIN');
    expect(res.status).toBe(404);
  });

  it('PUT /routes/:id remplace COMPLÈTEMENT la composition (delete + insert ordonné)', async () => {
    const calls = installMocks({ cavs: makeCavs(3) });
    const res = await put('/api/tours/routes/9', 'ADMIN', { name: 'Rive Gauche', cav_ids: [3, 1, 2] });
    expect(res.status).toBe(200);
    expect(calls.some((c) => /DELETE FROM standard_route_cav/.test(c.sql))).toBe(true);
    const inserts = calls.filter((c) => /INSERT INTO standard_route_cav/.test(c.sql));
    expect(inserts.map((c) => c.params[1])).toEqual([3, 1, 2]);
    expect(inserts.map((c) => c.params[2])).toEqual([1, 2, 3]);
    // Estimations recalculées et persistées
    const upd = calls.find((c) => /UPDATE standard_routes SET estimated_duration_minutes/.test(c.sql));
    expect(upd).toBeTruthy();
    expect(typeof upd.params[1]).toBe('number');
    expect(res.body.estimated_duration_minutes).toBe(upd.params[1]);
  });

  it('PUT /routes/:id sans cav_ids conserve la composition et recalcule l’estimation', async () => {
    const calls = installMocks({ cavs: makeCavs(3), routeComposition: [1, 2] });
    const res = await put('/api/tours/routes/9', 'ADMIN', { is_active: false });
    expect(res.status).toBe(200);
    expect(calls.some((c) => /DELETE FROM standard_route_cav/.test(c.sql))).toBe(false);
    expect(res.body.estimated_distance_km).not.toBeUndefined();
  });

  it('POST /routes crée le modèle ET renseigne durée/distance estimées', async () => {
    const calls = installMocks({ cavs: makeCavs(3) });
    const res = await post('/api/tours/routes', 'ADMIN', { name: 'Nouveau modèle', cav_ids: [1, 2, 3] });
    expect(res.status).toBe(201);
    expect(res.body.estimated_duration_minutes).toBeGreaterThan(0);
    expect(res.body.estimated_distance_km).toBeGreaterThan(0);
    expect(calls.filter((c) => /INSERT INTO standard_route_cav/.test(c.sql))).toHaveLength(3);
  });

  it('DELETE /routes/:id → 409 ROUTE_UTILISEE si des tournées le référencent', async () => {
    const calls = installMocks({ toursUsingRoute: 4 });
    const res = await del('/api/tours/routes/9', 'ADMIN');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROUTE_UTILISEE');
    expect(res.body.tours_count).toBe(4);
    expect(calls.some((c) => /DELETE FROM standard_routes/.test(c.sql))).toBe(false);
  });

  it('DELETE /routes/:id supprime quand aucune tournée ne l’utilise', async () => {
    installMocks({ toursUsingRoute: 0 });
    const res = await del('/api/tours/routes/9', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(9);
  });

  it('GET /routes/list n’expose PAS les modèles association et inclut les compteurs', async () => {
    const calls = installMocks();
    const res = await get('/api/tours/routes/list', 'MANAGER');
    expect(res.status).toBe(200);
    const sql = calls.find((c) => /FROM standard_routes sr/.test(c.sql)).sql;
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM standard_route_association/);
    expect(sql).toMatch(/cav_count/);
    expect(sql).toMatch(/is_active/);
  });

  it('GET /association-routes/:id renvoie { route, points }', async () => {
    installMocks();
    const res = await get('/api/tours/association-routes/9', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('route');
    expect(res.body).toHaveProperty('points');
  });

  it('CRUD association : PUT remplace la composition, DELETE refuse si utilisé', async () => {
    const calls = installMocks({ toursUsingRoute: 0 });
    const upd = await put('/api/tours/association-routes/9', 'ADMIN', { association_point_ids: [52, 51] });
    expect(upd.status).toBe(200);
    const inserts = calls.filter((c) => /INSERT INTO standard_route_association/.test(c.sql));
    expect(inserts.map((c) => c.params[1])).toEqual([52, 51]);

    installMocks({ toursUsingRoute: 2 });
    const res = await del('/api/tours/association-routes/9', 'ADMIN');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROUTE_UTILISEE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/tours/saturation-risks', () => {
  const dayOffset = (n) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
  };

  it('forme de réponse + tri par urgence (non couverts d’abord, saturation la plus proche)', async () => {
    installMocks({
      saturationRows: [
        { id: 10, name: 'CAV lointain', commune: 'Rouen', date_saturation: dayOffset(5), fill_prediction: 70 },
        { id: 11, name: 'CAV imminent', commune: 'Le Houlme', date_saturation: dayOffset(1), fill_prediction: 88 },
        { id: 12, name: 'CAV couvert', commune: 'Rouen', date_saturation: dayOffset(2), fill_prediction: 92 },
      ],
      coverageRows: [{ cav_id: 12, tour_id: 77, tour_date: dayOffset(1) }],
    });
    const res = await get('/api/tours/saturation-risks?days=7', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.seuil_pct).toBe(90);
    expect(res.body.horizon_jours).toBe(7);
    expect(typeof res.body.generated_at).toBe('string');
    const r = res.body.risques;
    expect(r.map((x) => x.cav_id)).toEqual([11, 10, 12]); // non couverts d'abord, puis délai
    for (const item of r) {
      for (const k of ['cav_id', 'name', 'commune', 'fill_actuel_pct',
        'date_saturation_prevue', 'jours_avant_saturation', 'source', 'couverture']) {
        expect(item).toHaveProperty(k);
      }
      expect(item.couverture).toHaveProperty('couvert');
    }
    expect(r[0].source).toBe('prediction');
    expect(r[0].jours_avant_saturation).toBe(1);
    expect(r[2].couverture).toEqual({ couvert: true, tour_id: 77, tour_date: dayOffset(1) });
  });

  it('une tournée planifiée APRÈS la saturation ne couvre pas', async () => {
    installMocks({
      saturationRows: [{ id: 20, name: 'CAV', commune: null, date_saturation: dayOffset(1), fill_prediction: 95 }],
      coverageRows: [{ cav_id: 20, tour_id: 88, tour_date: dayOffset(4) }],
    });
    const res = await get('/api/tours/saturation-risks', 'ADMIN');
    expect(res.body.risques[0].couverture).toEqual({ couvert: false });
  });

  it('capteur frais au-dessus du seuil : source « capteur », saturation immédiate', async () => {
    installMocks({
      saturationRows: [{
        id: 30, name: 'CAV capteur', commune: 'Rouen', date_saturation: null, fill_prediction: null,
        sensor_last_reading: 96, sensor_last_reading_at: new Date().toISOString(),
      }],
    });
    const res = await get('/api/tours/saturation-risks', 'ADMIN');
    expect(res.body.risques).toHaveLength(1);
    expect(res.body.risques[0].source).toBe('capteur');
    expect(res.body.risques[0].fill_actuel_pct).toBe(96);
    expect(res.body.risques[0].jours_avant_saturation).toBe(0);
  });

  it('aucune donnée exploitable → le CAV n’apparaît pas (jamais de valeur inventée)', async () => {
    installMocks({
      saturationRows: [{
        id: 40, name: 'CAV sans donnée', commune: null, date_saturation: null, fill_prediction: null,
        sensor_last_reading: null, sensor_last_reading_at: null,
        estimated_fill_rate: 0, daily_fill_rate: 0,
      }],
    });
    const res = await get('/api/tours/saturation-risks', 'ADMIN');
    expect(res.body.risques).toEqual([]);
  });

  it('extrapolation estimated/daily quand ces colonnes sont alimentées', async () => {
    installMocks({
      saturationRows: [{
        id: 50, name: 'CAV extrapolé', commune: null, date_saturation: null, fill_prediction: null,
        sensor_last_reading: null, sensor_last_reading_at: null,
        estimated_fill_rate: 80, daily_fill_rate: 5,
      }],
    });
    const res = await get('/api/tours/saturation-risks?days=7', 'ADMIN');
    expect(res.body.risques[0].source).toBe('estimation');
    expect(res.body.risques[0].jours_avant_saturation).toBe(2); // (90-80)/5
  });

  it('réservé ADMIN/MANAGER', async () => {
    const res = await get('/api/tours/saturation-risks', 'COLLABORATEUR');
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /api/tours/intelligent — garde de saturation', () => {
  it('expose `saturation_non_couverte` et `estimation` en plus de la réponse historique', async () => {
    // Véhicule 300 kg : les deux CAV saturés (150 + 142,5 kg) ne tiennent pas
    // ensemble dans 95 % de la capacité → le second est signalé non couvert.
    mockFills.set(1, 100); mockFills.set(2, 95); mockFills.set(3, 50);
    installMocks({
      vehicle: { ...VEHICLE, max_capacity_kg: 300 },
      cavs: makeCavs(3),
    });
    const res = await post('/api/tours/intelligent', 'ADMIN', { vehicle_id: 3, date: '2026-09-01' });
    expect(res.status).toBe(201);
    // Réponse historique conservée
    expect(res.body.tour).toBeTruthy();
    expect(Array.isArray(res.body.cavs)).toBe(true);
    for (const k of ['totalCavs', 'totalDistance', 'estimatedDuration', 'estimatedWeight',
      'maxCapacity', 'fillRate', 'urgentCavs', 'nbRetourscentre', 'maxDailyHours',
      'returnEveryKg', 'routingMethod', 'lunchBreakIncluded']) {
      expect(res.body.stats).toHaveProperty(k);
    }
    expect(res.body.stats.maxDailyHours).toBe(6);
    expect(typeof res.body.explanation).toBe('string');
    // Ajouts du contrat
    expect(res.body.estimation).toBeTruthy();
    expect(res.body.estimation.budget_travail_min).toBe(360);
    expect(Array.isArray(res.body.saturation_non_couverte)).toBe(true);
    expect(res.body.saturation_non_couverte).toHaveLength(1);
    expect(res.body.saturation_non_couverte[0]).toEqual({
      cav_id: 2, name: 'CAV 2', commune: 'Rouen', predicted_fill_rate: 95,
    });
    expect(res.body.explanation).toMatch(/seuil de saturation/i);
  });

  it('aucun CAV saturé : `saturation_non_couverte` vide', async () => {
    mockFills.set(1, 40); mockFills.set(2, 45); mockFills.set(3, 50);
    installMocks({ cavs: makeCavs(3) });
    const res = await post('/api/tours/intelligent', 'ADMIN', { vehicle_id: 3, date: '2026-09-01' });
    expect(res.status).toBe(201);
    expect(res.body.saturation_non_couverte).toEqual([]);
    expect(res.body.estimation.faisable).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ETA d'exécution (planned-passage) — mêmes règles que la planification
// ═══════════════════════════════════════════════════════════════════════════
describe('computeAndStorePlannedPassages — horaires prévisionnels', () => {
  const { computeAndStorePlannedPassages } = require('../../src/routes/tours/planned-passage');
  const START = '2026-09-01T08:00:00.000Z';

  /** N points de tournée alignés, remplissage prédit 50 %. */
  const points = (n) => Array.from({ length: n }, (_, i) => ({
    id: 1000 + i,           // id de la ligne tour_cav
    ref_id: i + 1,          // cav_id
    name: `CAV ${i + 1}`,
    latitude: 49.42 + (i + 1) / 1000,
    longitude: 1.09,
    nb_containers: 1,
    predicted_fill_rate: 50,
  }));

  let realFetch;
  beforeEach(() => {
    realFetch = global.fetch;
    // OSRM multi-waypoints : chaque leg de la chaîne coûte 10 min / 5 km.
    global.fetch = jest.fn(async (url) => {
      const nbCoords = String(url).split('/driving/')[1].split('?')[0].split(';').length;
      return {
        json: async () => ({
          code: 'Ok',
          routes: [{ legs: Array.from({ length: nbCoords - 1 }, () => ({ duration: 600, distance: 5000 })) }],
        }),
      };
    });
  });
  afterEach(() => { global.fetch = realFetch; });

  it('cale le premier passage sur l’heure RÉELLE de départ + le trajet', async () => {
    const calls = installMocks({
      tourRow: { id: 1, collection_type: 'pav', started_at: START, vehicle_id: 3, max_capacity_kg: 3500 },
      plannedPoints: points(3),
    });
    const res = await computeAndStorePlannedPassages(1);
    expect(res.updated).toBe(3);
    const updates = calls.filter((c) => /UPDATE tour_cav SET planned_passage_time/.test(c.sql));
    expect(updates).toHaveLength(3);
    const t0 = new Date(updates[0].params[0]).getTime();
    expect(t0 - new Date(START).getTime()).toBe(10 * 60 * 1000); // 10 min de trajet
    // Points suivants : + trajet (10) + service (10 = timePerCav par défaut)
    const t1 = new Date(updates[1].params[0]).getTime();
    expect(t1 - t0).toBe(20 * 60 * 1000);
  });

  it('décale l’après-midi de la pause déjeuner (le second moteur l’ignorait)', async () => {
    const calls = installMocks({
      tourRow: { id: 1, collection_type: 'pav', started_at: START, vehicle_id: 3, max_capacity_kg: 3500 },
      plannedPoints: points(14),
    });
    await computeAndStorePlannedPassages(1);
    const updates = calls.filter((c) => /UPDATE tour_cav SET planned_passage_time/.test(c.sql));
    expect(updates).toHaveLength(14);
    const at = (i) => new Date(updates[i].params[0]).getTime();
    // Écart normal entre deux points consécutifs du matin : 20 min
    expect(at(1) - at(0)).toBe(20 * 60 * 1000);

    // Le trou de la pause : retour au centre + 30 min + reprise. On le CHERCHE
    // au lieu de l'épingler à un index — sa place dépend de l'heure de départ,
    // et la figer avait masqué le défaut de fuseau corrigé le 02/09/2026.
    const ecarts = [];
    for (let i = 1; i < 14; i++) ecarts.push({ i, min: (at(i) - at(i - 1)) / 60000 });
    const pause = ecarts.find((e) => e.min >= 50);
    expect(pause).toBeDefined();

    // ET ELLE TOMBE À MIDI, HEURE DE PARIS. `started_at` vaut 08:00 UTC, soit
    // 10:00 à Rouen en septembre : c'est cette horloge-là qui doit piloter la
    // pause. Tant que le moteur lisait `getHours()` — l'heure du CONTENEUR, en
    // UTC — la pause de midi se déclenchait deux heures trop tard.
    //
    // On mesure la REPRISE (le premier point après la pause) plutôt que le
    // dernier point d'avant : c'est le marqueur net. Avec l'heure du conteneur
    // elle tombait à 14:51 ; à l'heure de Rouen elle tombe à 12:49.
    const minutesParis = (ms) => {
      const [h, m] = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).format(new Date(ms)).split(':').map(Number);
      return h * 60 + m;
    };
    const reprise = minutesParis(at(pause.i));
    expect(reprise).toBeGreaterThanOrEqual(12 * 60);
    expect(reprise).toBeLessThan(14 * 60);

    // Les horaires restent strictement croissants
    for (let i = 1; i < 14; i++) expect(at(i)).toBeGreaterThan(at(i - 1));
  });

  it('tournée sans point géolocalisé : aucun horaire écrit, pas d’erreur', async () => {
    installMocks({
      tourRow: { id: 1, collection_type: 'pav', started_at: START, vehicle_id: 3, max_capacity_kg: 3500 },
      plannedPoints: [{ ...points(1)[0], latitude: null, longitude: null }],
    });
    const res = await computeAndStorePlannedPassages(1);
    expect(res).toEqual({ updated: 0, legs: [] });
  });
});

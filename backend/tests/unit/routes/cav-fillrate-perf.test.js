// Vague 3 — Lot « Performance » (item 3.D-4).
// Prouve la NON-RÉGRESSION FONCTIONNELLE des réécritures perf de cav.js :
//  1. /cav/fill-rate et /cav/map : sous-requêtes corrélées PAR CAV → agrégats
//     groupés (WITH agg / LAG / LEFT JOIN). Le cœur du risque est l'écart moyen
//     entre collectes : l'ancienne version appariait les rangs ROW_NUMBER() DESC,
//     la nouvelle utilise LAG(date). On démontre que les deux produisent le MÊME
//     multiensemble d'écarts (donc la même moyenne) — « résultat agrégé == ancien ».
//  2. Le mapping en mémoire consomme toujours correctement les colonnes agrégées
//     (fill_source capteur/stale/calculé, nb_collectes_90d, stats).
//  3. Le cache court est bien monté (header X-Cache) — no-op ici (Redis mocké off),
//     donc le handler s'exécute et les valeurs restent identiques.
//
// Auth réelle (JWT), DB + Redis mockés (aucune connexion réseau).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const mockQuery = jest.fn();
const mockConnect = jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} }));
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));
// Redis indisponible → cacheMiddleware devient un no-op (le handler s'exécute
// toujours, X-Cache = MISS) : perf sans changer les résultats.
jest.mock('../../../src/config/redis', () => ({
  getRedisClient: () => ({}),
  isRedisAvailable: () => false,
}));
// Journal d'activité neutralisé (écrit en base au chargement du middleware).
jest.mock('../../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

const adminToken = jwt.sign(
  { id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' },
  JWT_SECRET, { expiresIn: '1h' }
);
const collabToken = jwt.sign(
  { id: 2, username: 'user', role: 'COLLABORATEUR', first_name: 'U', last_name: 'S' },
  JWT_SECRET, { expiresIn: '1h' }
);

// ── Fixtures renvoyées par la NOUVELLE requête groupée ──────────────────────
const NOW = new Date();
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600 * 1000);
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400 * 1000);

// /fill-rate : 3 CAV — capteur frais, capteur périmé, sans capteur (heuristique).
const fillRateRows = [
  {
    id: 1, name: 'A_Capteur_Frais', address: 'a', commune: 'ROUEN',
    latitude: 49.4, longitude: 1.1, nb_containers: 2, status: 'active',
    tournee: 'T1', jours_collecte: null, freq_passage: null, avg_fill_rate: null, route_count: 1,
    lora_deveui: 'AABB', sensor_reference: 'S1',
    sensor_last_reading: 73, sensor_last_reading_at: hoursAgo(2), // < 48h → frais
    sensor_battery_level: 90, sensor_last_rssi: -80, sensor_status: 'active',
    last_collection: daysAgo(8), avg_weight_90d: 120, nb_collectes_90d: 5,
    avg_days_between_collections: 7,
  },
  {
    id: 2, name: 'B_Capteur_Perime', address: 'b', commune: 'ROUEN',
    latitude: 49.41, longitude: 1.11, nb_containers: 1, status: 'active',
    tournee: 'T1', jours_collecte: null, freq_passage: null, avg_fill_rate: null, route_count: 1,
    lora_deveui: 'CCDD', sensor_reference: 'S2',
    sensor_last_reading: 55, sensor_last_reading_at: hoursAgo(100), // > 48h → périmé
    sensor_battery_level: 60, sensor_last_rssi: -95, sensor_status: 'active',
    last_collection: daysAgo(5), avg_weight_90d: 80, nb_collectes_90d: 3,
    avg_days_between_collections: 12,
  },
  {
    id: 3, name: 'C_Sans_Capteur', address: 'c', commune: 'BOIS',
    latitude: 49.42, longitude: 1.12, nb_containers: 1, status: 'active',
    tournee: 'T2', jours_collecte: 'lundi', freq_passage: null, avg_fill_rate: null, route_count: 1,
    lora_deveui: null, sensor_reference: null,
    sensor_last_reading: null, sensor_last_reading_at: null,
    sensor_battery_level: null, sensor_last_rssi: null, sensor_status: null,
    last_collection: daysAgo(10), avg_weight_90d: 100, nb_collectes_90d: 6,
    avg_days_between_collections: 10,
  },
];

// /map : 2 CAV — capteur frais (< 8h) et sans capteur.
const mapRows = [
  {
    id: 1, name: 'A', address: 'a', commune: 'ROUEN', latitude: 49.4, longitude: 1.1,
    nb_containers: 2, avg_fill_rate: null, status: 'active', unavailable_reason: null, route_count: 1,
    lora_deveui: 'AABB', sensor_reference: 'S1',
    sensor_last_reading: 64, sensor_last_reading_at: hoursAgo(1), // < 8h → frais
    sensor_battery_level: 90, sensor_last_rssi: -80, sensor_status: 'active',
    last_collection: daysAgo(6), avg_weight_90d: 90,
  },
  {
    id: 2, name: 'B', address: 'b', commune: 'BOIS', latitude: 49.41, longitude: 1.11,
    nb_containers: 1, avg_fill_rate: null, status: 'active', unavailable_reason: null, route_count: 1,
    lora_deveui: null, sensor_reference: null,
    sensor_last_reading: null, sensor_last_reading_at: null,
    sensor_battery_level: null, sensor_last_rssi: null, sensor_status: null,
    last_collection: daysAgo(9), avg_weight_90d: 70,
  },
];

const sensorRows = [
  { id: 1, name: 'A', commune: 'ROUEN', latitude: 49.4, longitude: 1.1,
    sensor_reference: 'S1', sensor_type: 'ultrasonic', lora_deveui: 'AABB',
    sensor_height_cm: 150, sensor_distance_full_cm: 30, sensor_install_date: '2026-01-01',
    sensor_reporting_interval_min: 180, sensor_last_reading: 64, sensor_last_reading_at: hoursAgo(1),
    sensor_battery_level: 90, sensor_last_rssi: -80, computed_status: 'active',
    sensor_status: 'active', open_alerts: 0 },
];

// Aiguillage du mock par contenu SQL (robuste à l'ordre des appels + aux
// requêtes internes de fill-factors : settings / predictive_seasonal_factors).
function smartMock(sql) {
  const s = String(sql);
  if (/FROM settings/i.test(s)) return Promise.resolve({ rows: [] });        // fill-factors _readConfig
  if (/predictive_seasonal_factors/i.test(s)) return Promise.resolve({ rows: [] }); // _readLearned
  if (/custom_roles/i.test(s)) return Promise.resolve({ rows: [] });          // auth refreshCustomRoles
  if (/user_activity_log/i.test(s)) return Promise.resolve({ rows: [] });
  if (/FROM cav c/i.test(s) && /avg_days_between_collections/i.test(s)) {
    return Promise.resolve({ rows: fillRateRows });
  }
  if (/FROM cav c/i.test(s) && /unavailable_reason/i.test(s)) {
    return Promise.resolve({ rows: mapRows });
  }
  if (/computed_status/i.test(s) || /open_alerts/i.test(s)) {
    return Promise.resolve({ rows: sensorRows });
  }
  return Promise.resolve({ rows: [] });
}

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  const cavRoutes = require('../../../src/routes/cav');
  app.use('/api/cav', cavRoutes);
});
beforeEach(() => {
  mockQuery.mockImplementation((sql) => smartMock(sql));
});
afterEach(() => {
  mockQuery.mockClear();
});

// Retrouve le SQL de la requête principale (celle sur `cav c`) réellement exécutée.
function mainCavSql() {
  const call = mockQuery.mock.calls.find(
    (c) => /FROM cav c/i.test(String(c[0])) &&
      (/avg_days_between_collections/i.test(String(c[0])) || /unavailable_reason/i.test(String(c[0])))
  );
  return call ? String(call[0]) : '';
}

// ════════════════════════════════════════════════════════════════════════════
// 1. ÉQUIVALENCE DE L'AGRÉGAT avg_days_between_collections (cœur du risque SQL)
//    ancien : ROW_NUMBER() OVER (ORDER BY date DESC), th2.rn = th1.rn - 1
//    nouveau : AVG(date - LAG(date) OVER (ORDER BY date))
// ════════════════════════════════════════════════════════════════════════════
describe('Équivalence avg_days_between : ROW_NUMBER DESC (ancien) == LAG ASC (nouveau)', () => {
  // Simulation fidèle de l'ANCIENNE requête SQL.
  function oldAvgGap(dates) {
    const desc = [...dates].sort((a, b) => b - a); // rn1 = plus récent
    const gaps = [];
    for (let k = 2; k <= desc.length; k++) gaps.push(desc[k - 2] - desc[k - 1]);
    if (gaps.length === 0) return null;
    return gaps.reduce((s, x) => s + x, 0) / gaps.length;
  }
  // Simulation fidèle de la NOUVELLE requête SQL (LAG en ordre croissant).
  function newAvgGap(dates) {
    const asc = [...dates].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < asc.length; i++) gaps.push(asc[i] - asc[i - 1]);
    if (gaps.length === 0) return null;
    return gaps.reduce((s, x) => s + x, 0) / gaps.length;
  }

  const fixed = [
    [], [5], [5, 12], [10, 10, 12], [10, 11, 11, 15], [3, 3, 3],
    [100, 1, 50, 50, 7, 7, 7, 200],
  ];
  test.each(fixed.map((c, i) => [i, c]))('cas fixe #%i', (_i, dates) => {
    expect(newAvgGap(dates)).toEqual(oldAvgGap(dates));
  });

  test('1000 jeux aléatoires (dont doublons de dates) — moyennes identiques', () => {
    for (let r = 0; r < 1000; r++) {
      const n = Math.floor(Math.random() * 8);
      const arr = Array.from({ length: n }, () => Math.floor(Math.random() * 40));
      const a = oldAvgGap(arr);
      const b = newAvgGap(arr);
      if (a === null || b === null) expect(b).toBe(a);
      else expect(Math.abs(a - b)).toBeLessThan(1e-9);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. /cav/fill-rate — forme SQL groupée + mapping identique
// ════════════════════════════════════════════════════════════════════════════
describe('GET /api/cav/fill-rate', () => {
  it('401 sans authentification', async () => {
    const res = await request(app).get('/api/cav/fill-rate');
    expect(res.status).toBe(401);
  });

  it('utilise des agrégats groupés (WITH agg / LAG / LEFT JOIN) et non les sous-requêtes corrélées', async () => {
    const res = await request(app).get('/api/cav/fill-rate').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const sql = mainCavSql();
    expect(sql).toContain('WITH agg');
    expect(sql).toContain('LAG(');
    expect(sql).toContain('GROUP BY cav_id');
    expect(sql).toContain('LEFT JOIN agg');
    expect(sql).toContain('LEFT JOIN gaps');
    // Anti-régression : plus d'auto-jointure corrélée à double ROW_NUMBER DESC.
    expect(sql).not.toMatch(/ROW_NUMBER\(\)\s+OVER\s*\(\s*ORDER BY date DESC/i);
    // Plus de sous-requête corrélée MAX(th.date) ... WHERE th.cav_id = c.id
    expect(sql).not.toMatch(/WHERE th\.cav_id = c\.id/i);
  });

  it('mappe correctement les colonnes agrégées (capteur frais / périmé / calculé)', async () => {
    const res = await request(app).get('/api/cav/fill-rate').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stats');
    expect(res.body).toHaveProperty('cavs');
    const cavs = res.body.cavs;
    expect(cavs).toHaveLength(3);

    // Capteur frais → source 'sensor', valeur = arrondi de la lecture.
    expect(cavs[0].fill_source).toBe('sensor');
    expect(cavs[0].fill_rate).toBe(73);

    // Capteur périmé (> 48h) → source 'sensor_stale', valeur = arrondi de la lecture.
    expect(cavs[1].fill_source).toBe('sensor_stale');
    expect(cavs[1].fill_rate).toBe(55);

    // Sans capteur → heuristique 'calculated', borné 0..120, entier.
    expect(cavs[2].fill_source).toBe('calculated');
    expect(Number.isInteger(cavs[2].fill_rate)).toBe(true);
    expect(cavs[2].fill_rate).toBeGreaterThanOrEqual(0);
    expect(cavs[2].fill_rate).toBeLessThanOrEqual(120);
    expect(typeof cavs[2].calculated_fill_rate).toBe('number');
    // nb_collectes_90d (issu de COUNT(*) FILTER) transite bien en entier.
    expect(cavs[2].nb_collectes_90d).toBe(6);

    // Stats cohérentes.
    const { total, critical, warning, ok } = res.body.stats;
    expect(total).toBe(3);
    expect(critical + warning + ok).toBe(3);
  });

  it('monte le cache court (header X-Cache présent — no-op car Redis off)', async () => {
    const res = await request(app).get('/api/cav/fill-rate').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('MISS');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. /cav/map — forme SQL groupée + mapping identique
// ════════════════════════════════════════════════════════════════════════════
describe('GET /api/cav/map', () => {
  it('utilise l\'agrégat groupé (WITH agg / LEFT JOIN) et non les sous-requêtes corrélées', async () => {
    const res = await request(app).get('/api/cav/map').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const sql = mainCavSql();
    expect(sql).toContain('WITH agg');
    expect(sql).toContain('GROUP BY cav_id');
    expect(sql).toContain('LEFT JOIN agg');
    expect(sql).not.toMatch(/WHERE th\.cav_id = c\.id/i);
  });

  it('mappe le remplissage (capteur frais < 8h vs heuristique)', async () => {
    const res = await request(app).get('/api/cav/map').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    // Capteur frais < 8h.
    expect(res.body[0].fill_source).toBe('sensor');
    expect(res.body[0].fill_rate).toBe(64);
    // Sans capteur → heuristique.
    expect(res.body[1].fill_source).toBe('calculated');
    expect(Number.isInteger(res.body[1].fill_rate)).toBe(true);
    expect(res.body[1]).toHaveProperty('estimated_fill_rate');
    expect(res.headers['x-cache']).toBe('MISS');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. /cav/sensors — cache court sur la lecture flotte (item 3)
// ════════════════════════════════════════════════════════════════════════════
describe('GET /api/cav/sensors', () => {
  it('403 pour un rôle non ADMIN/MANAGER (autorisation avant cache)', async () => {
    const res = await request(app).get('/api/cav/sensors').set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(403);
  });

  it('200 + cache monté pour ADMIN', async () => {
    const res = await request(app).get('/api/cav/sensors').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.headers['x-cache']).toBe('MISS');
  });
});

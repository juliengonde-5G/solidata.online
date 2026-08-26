// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — GET /api/tours/:id/rapport
// ───────────────────────────────────────────────────────────────────────────
// Ce endpoint est le SEUL appel du générateur de compte rendu PDF : sa forme
// est un contrat. Les tests ci-dessous verrouillent ce que le PDF lit, et les
// deux règles qui le rendent honnête :
//
//   • l'écart d'horaire vaut `null` — jamais 0 — dès qu'une des deux heures
//     manque ; « à l'heure » et « on ne sait pas » ne se confondent pas ;
//   • un bloc dont la lecture échoue dégrade SEUL, il est nommé dans
//     `degraded`, et le reste du rapport est servi.
//
// Auth réelle (JWT signé), base mockée par routage sur le TEXTE SQL — le test
// reste indépendant de l'ordre d'exécution des requêtes.
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

const TOUR_ID = 412;

// Jetons SANS `tv` : le contrôle de révocation est alors sauté (jeton hérité),
// donc aucune lecture `users` ne vient polluer le routage du mock.
const tokenPour = (role, id = 1) => jwt.sign(
  { id, userId: id, username: `u${id}`, role }, JWT_SECRET, { expiresIn: '1h' }
);
const adminToken = tokenPour('ADMIN', 1);
const managerToken = tokenPour('MANAGER', 2);
const collabToken = tokenPour('COLLABORATEUR', 3);

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', require('../../src/routes/tours'));
});

const CENTRE = {
  id: 3, nom: 'Centre de tri — Le Houlme', adresse: 'Le Houlme',
  latitude: 49.4231, longitude: 1.0993, duree_min: 20,
};

const TOUR_CAV = {
  id: TOUR_ID, date: '2026-08-20', status: 'completed', mode: 'intelligent',
  collection_type: 'pav', is_demo: false,
  started_at: '2026-08-20T05:45:00.000Z', completed_at: '2026-08-20T13:10:00.000Z',
  km_start: 120340, km_end: 120452, notes: 'RAS',
  estimated_distance_km: 104, estimated_duration_min: 380, total_weight_kg: 0,
  vehicle_id: 7, registration: 'AB-123-CD', vehicle_name: 'Renault Master',
  max_capacity_kg: 3500,
  driver_employee_id: 21, driver_name: 'DUPONT Marc',
  suiveur1_employee_id: 34, suiveur1_name: 'MARTIN Léa',
  suiveur2_employee_id: null, suiveur2_name: null,
};

/**
 * Routeur de mock par TEXTE SQL. Chaque bloc du rapport a sa clé ; passer
 * `Symbol('boom')` (via `erreurs`) fait échouer CE bloc et lui seul.
 */
function mockDb(opts = {}) {
  const {
    tour = TOUR_CAV, cavs = [], associations = [], arrets = [],
    weights = [], incidents = [], messages = [], gps = [],
    checklist = null, endOfDay = null, centre = CENTRE,
    erreurs = [], tourIntrouvable = false,
  } = opts;
  const boom = (bloc) => {
    const e = new Error(`colonne absente (${bloc})`);
    e.code = '42703';
    return Promise.reject(e);
  };
  const ko = (bloc) => erreurs.includes(bloc);

  mockQuery.mockImplementation((sql) => {
    const t = String(sql);
    if (/FROM tour_cav tc/.test(t)) return ko('points_cav') ? boom('points_cav') : Promise.resolve({ rows: cavs });
    if (/FROM tour_association_point tap/.test(t)) return ko('points_association') ? boom('points_association') : Promise.resolve({ rows: associations });
    if (/FROM tour_arret_technique ta/.test(t)) return ko('arrets') ? boom('arrets') : Promise.resolve({ rows: arrets });
    if (/FROM tour_weights w/.test(t)) return ko('weights') ? boom('weights') : Promise.resolve({ rows: weights });
    if (/FROM incidents i/.test(t)) return ko('incidents') ? boom('incidents') : Promise.resolve({ rows: incidents });
    if (/FROM driver_messages dm/.test(t)) return ko('messages') ? boom('messages') : Promise.resolve({ rows: messages });
    if (/FROM gps_positions/.test(t)) return ko('gps') ? boom('gps') : Promise.resolve({ rows: gps });
    if (/FROM vehicle_checklists vc/.test(t)) return ko('checklist') ? boom('checklist') : Promise.resolve({ rows: checklist ? [checklist] : [] });
    if (/FROM tour_end_of_day_declarations d/.test(t)) return ko('end_of_day') ? boom('end_of_day') : Promise.resolve({ rows: endOfDay ? [endOfDay] : [] });
    if (/FROM lieux_techniques/.test(t)) return Promise.resolve({ rows: centre ? [centre] : [] });
    if (/FROM tours t/.test(t) || /FROM tours WHERE id/.test(t)) {
      return Promise.resolve({ rows: tourIntrouvable ? [] : [tour] });
    }
    return Promise.resolve({ rows: [] });
  });
}

const get = (id = TOUR_ID, token = adminToken) => request(app)
  .get(`/api/tours/${id}/rapport`)
  .set('Authorization', `Bearer ${token}`);

beforeEach(() => { mockQuery.mockReset(); mockClient.release.mockReset(); });

// ── Habilitations ─────────────────────────────────────────────────────────
describe('habilitations', () => {
  test('401 sans jeton', async () => {
    mockDb();
    const r = await request(app).get(`/api/tours/${TOUR_ID}/rapport`);
    expect(r.status).toBe(401);
  });

  test('403 pour un rôle non habilité (COLLABORATEUR)', async () => {
    mockDb();
    const r = await get(TOUR_ID, collabToken);
    expect(r.status).toBe(403);
  });

  test('200 pour ADMIN et pour MANAGER', async () => {
    mockDb();
    expect((await get(TOUR_ID, adminToken)).status).toBe(200);
    mockDb();
    expect((await get(TOUR_ID, managerToken)).status).toBe(200);
  });

  test('404 sur une tournée inexistante', async () => {
    mockDb({ tourIntrouvable: true });
    const r = await get(99999);
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/non trouv/i);
  });

  test('400 sur un identifiant illisible', async () => {
    mockDb();
    const r = await request(app).get('/api/tours/abc/rapport')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(400);
  });
});

// ── Forme de la réponse ───────────────────────────────────────────────────
describe('forme de la réponse', () => {
  test('les blocs attendus par le générateur PDF sont tous présents', async () => {
    mockDb({
      cavs: [{
        id: 1, ref_id: 10, position: 1, status: 'collected', fill_level: 4,
        fill_percent: 90, skip_reason: null, remballe: false,
        collected_at: '2026-08-20T06:30:00.000Z', notes: null,
        planned_passage_time: '2026-08-20T06:15:00.000Z',
        name: 'LE HOULME - 12 rue Verte', address: '12 rue Verte',
        commune: 'LE HOULME', latitude: 49.45, longitude: 1.05, nb_containers: 2,
      }],
      weights: [{ id: 1, weight_kg: 1200, tare_kg: 2100, is_intermediate: false, notes: null, recorded_at: '2026-08-20T13:00:00.000Z', recorded_by_name: 'DUPONT Marc' }],
      gps: [
        { latitude: 49.42, longitude: 1.09, speed: 0, recorded_at: '2026-08-20T05:45:00.000Z' },
        { latitude: 49.45, longitude: 1.05, speed: 40, recorded_at: '2026-08-20T06:20:00.000Z' },
      ],
    });
    const r = await get();
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual([
      'checklist', 'degraded', 'end_of_day', 'generated_at', 'gps_track',
      'incidents', 'kpis', 'messages', 'planned_route', 'points', 'tour',
      'warnings', 'weights',
    ]);

    // 1. Tournée
    expect(r.body.tour).toMatchObject({
      id: TOUR_ID, date: '2026-08-20', status: 'completed', is_completed: true,
      mode: 'intelligent', collection_type: 'pav', is_association: false,
      is_demo: false, km_start: 120340, km_end: 120452, notes: 'RAS',
    });
    expect(r.body.tour.vehicle).toEqual({
      id: 7, registration: 'AB-123-CD', name: 'Renault Master', max_capacity_kg: 3500,
    });
    expect(r.body.tour.driver).toEqual({ id: 21, name: 'DUPONT Marc' });
    expect(r.body.tour.suiveurs).toEqual([{ id: 34, name: 'MARTIN Léa' }]);

    // 2. Indicateurs
    expect(r.body.kpis.duration_min).toBe(445);          // 05:45 → 13:10
    expect(r.body.kpis.estimated_duration_min).toBe(380);
    expect(r.body.kpis.km_driven).toBe(112);
    expect(r.body.kpis.distance_source).toBe('gps');
    expect(r.body.kpis.distance_km).toBeGreaterThan(0);
    expect(r.body.kpis.nb_points_total).toBe(1);
    expect(r.body.kpis.nb_points_collected).toBe(1);
    expect(r.body.kpis.total_weight_kg).toBe(1200);
    expect(r.body.kpis.avg_fill_percent).toBe(90);

    // 3. Points
    expect(r.body.points[0]).toMatchObject({
      rank: 1, kind: 'cav', name: 'LE HOULME - 12 rue Verte', commune: 'LE HOULME',
      status: 'collected', planned_source: 'calcule', delay_minutes: 15,
      actual_time_field: 'collected_at', fill_source: 'reel', fill_effective_percent: 90,
    });

    // 6-8. Blocs annexes
    expect(r.body.gps_track).toMatchObject({ total_positions: 2, returned_positions: 2, sampling_step: 1, tronque: false });
    expect(r.body.planned_route.centre_tri).toMatchObject({ id: 3, source: 'referentiel' });
    expect(r.body.planned_route.waypoints).toEqual([
      { rank: 1, kind: 'cav', name: 'LE HOULME - 12 rue Verte', latitude: 49.45, longitude: 1.05 },
    ]);
    expect(r.body.degraded).toEqual([]);
    expect(r.body.warnings).toEqual([]);
    expect(typeof r.body.generated_at).toBe('string');
  });

  test('une tournée non clôturée est servie, mais le rapport le DIT', async () => {
    mockDb({ tour: { ...TOUR_CAV, status: 'in_progress', completed_at: null } });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.tour.is_completed).toBe(false);
    expect(r.body.kpis.duration_min).toBeNull();
    expect(r.body.kpis.duration_motif).toMatch(/non clôturée/i);
    expect(r.body.warnings.join(' ')).toMatch(/pas clôturée/i);
  });
});

// ── Écart d'horaire : `null`, jamais 0 ────────────────────────────────────
describe("écart d'horaire", () => {
  test('null quand l\'heure prévue manque, null quand l\'heure réelle manque, chiffré quand les deux sont là', async () => {
    mockDb({
      cavs: [
        // Les deux heures : écart calculable (10 min de retard).
        { id: 1, ref_id: 10, position: 1, status: 'collected', fill_level: 3, fill_percent: null, skip_reason: null, remballe: false, collected_at: '2026-08-20T06:40:00.000Z', notes: null, planned_passage_time: '2026-08-20T06:30:00.000Z', name: 'A', address: null, commune: 'ROUEN', latitude: 49.4, longitude: 1.1, nb_containers: 1 },
        // Heure prévue absente (moteur non passé) → null.
        { id: 2, ref_id: 11, position: 2, status: 'collected', fill_level: 2, fill_percent: null, skip_reason: null, remballe: false, collected_at: '2026-08-20T07:10:00.000Z', notes: null, planned_passage_time: null, name: 'B', address: null, commune: 'ROUEN', latitude: 49.41, longitude: 1.11, nb_containers: 1 },
        // Point non collecté : pas d'heure réelle → null (et surtout pas 0).
        { id: 3, ref_id: 12, position: 3, status: 'skipped', fill_level: null, fill_percent: null, skip_reason: 'acces_impossible', remballe: false, collected_at: null, notes: null, planned_passage_time: '2026-08-20T07:30:00.000Z', name: 'C', address: null, commune: 'ROUEN', latitude: 49.42, longitude: 1.12, nb_containers: 1 },
      ],
    });
    const r = await get();
    const [p1, p2, p3] = r.body.points;

    expect(p1.delay_minutes).toBe(10);
    expect(p1.planned_source).toBe('calcule');

    expect(p2.delay_minutes).toBeNull();
    expect(p2.planned_passage_time).toBeNull();
    expect(p2.planned_source).toBeNull();

    expect(p3.delay_minutes).toBeNull();
    expect(p3.delay_minutes).not.toBe(0);
    expect(p3.actual_time).toBeNull();

    // La moyenne ne porte que sur les écarts réellement calculables.
    expect(r.body.kpis.avg_delay_min).toBe(10);
    expect(r.body.kpis.avg_delay_nb_points).toBe(1);
  });

  test('le motif de non-collecte est traduit, sans perdre la valeur brute', async () => {
    mockDb({
      cavs: [{ id: 3, ref_id: 12, position: 1, status: 'skipped', fill_level: null, fill_percent: null, skip_reason: 'acces_impossible', remballe: false, collected_at: null, notes: null, planned_passage_time: null, name: 'C', address: null, commune: 'ROUEN', latitude: null, longitude: null, nb_containers: 1 }],
    });
    const r = await get();
    expect(r.body.points[0].skip_reason).toBe('acces_impossible');
    expect(r.body.points[0].skip_reason_label).toBe('Accès impossible');
    expect(r.body.kpis.nb_points_skipped).toBe(1);
    // Point sans coordonnées : exclu du tracé prévisionnel ET compté.
    expect(r.body.planned_route.waypoints).toEqual([]);
    expect(r.body.planned_route.nb_points_sans_coordonnees).toBe(1);
  });
});

// ── Programme : rang séquentiel, arrêts au centre, tournée association ────
describe('programme', () => {
  test('le rang est séquentiel même si les positions ont des trous, et les arrêts au centre sont dans le programme', async () => {
    mockDb({
      cavs: [
        { id: 1, ref_id: 10, position: 1, status: 'collected', fill_level: 4, fill_percent: null, skip_reason: null, remballe: false, collected_at: '2026-08-20T06:30:00.000Z', notes: null, planned_passage_time: null, name: 'A', address: null, commune: 'X', latitude: 49.4, longitude: 1.1, nb_containers: 1 },
        // Position 4 : les 3 ont été retirées du programme, le trou reste.
        { id: 2, ref_id: 11, position: 4, status: 'collected', fill_level: 4, fill_percent: null, skip_reason: null, remballe: false, collected_at: '2026-08-20T09:00:00.000Z', notes: null, planned_passage_time: null, name: 'B', address: null, commune: 'X', latitude: 49.41, longitude: 1.11, nb_containers: 1 },
      ],
      arrets: [
        { id: 90, ref_id: 3, position: 2, status: 'done', notes: null, motif: 'vidage', arrived_at: '2026-08-20T08:00:00.000Z', completed_at: '2026-08-20T08:25:00.000Z', name: 'Centre de tri', address: 'Le Houlme', latitude: 49.4231, longitude: 1.0993, categorie: 'centre_tri', duree_min: 20 },
        { id: 91, ref_id: 3, position: 6, status: 'done', notes: null, motif: 'fin_tournee', arrived_at: '2026-08-20T13:00:00.000Z', completed_at: null, name: 'Centre de tri', address: 'Le Houlme', latitude: 49.4231, longitude: 1.0993, categorie: 'centre_tri', duree_min: 20 },
      ],
    });
    const r = await get();
    expect(r.body.points.map((p) => [p.rank, p.kind, p.position])).toEqual([
      [1, 'cav', 1], [2, 'arret_technique', 2], [3, 'cav', 4], [4, 'arret_technique', 6],
    ]);
    // Un arrêt porte son motif, traduit ; son heure réelle est l'ARRIVÉE.
    expect(r.body.points[1]).toMatchObject({
      motif: 'vidage',
      motif_label: 'Retour au centre — camion plein',
      actual_time: '2026-08-20T08:00:00.000Z',
      actual_time_field: 'arrived_at',
      completed_at: '2026-08-20T08:25:00.000Z',
      lieu_categorie: 'centre_tri',
    });
    // Les arrêts ne sont pas des points de collecte : ils ne gonflent pas le
    // dénominateur d'avancement.
    expect(r.body.kpis.nb_points_total).toBe(2);
    expect(r.body.kpis.nb_arrets).toBe(2);
    expect(r.body.kpis.progress_percent).toBe(100);
  });

  test('tournée ASSOCIATION : les points viennent de tour_association_point', async () => {
    mockDb({
      tour: { ...TOUR_CAV, collection_type: 'association' },
      associations: [
        { id: 51, ref_id: 900, position: 1, status: 'collected', fill_level: 5, fill_percent: null, skip_reason: null, remballe: false, collected_at: '2026-08-20T09:05:00.000Z', notes: 'Portail arrière', planned_passage_time: '2026-08-20T09:00:00.000Z', name: 'Croix-Rouge Rouen', address: '3 rue du Bac', commune: 'ROUEN', latitude: 49.44, longitude: 1.09, nb_containers: null },
        { id: 52, ref_id: 901, position: 2, status: 'skipped', fill_level: null, fill_percent: null, skip_reason: null, remballe: false, collected_at: null, notes: 'Local fermé', planned_passage_time: '2026-08-20T10:00:00.000Z', name: 'Secours Pop', address: null, commune: 'ELBEUF', latitude: 49.28, longitude: 1.00, nb_containers: null },
      ],
      arrets: [{ id: 92, ref_id: 3, position: 3, status: 'done', notes: null, motif: 'fin_tournee', arrived_at: '2026-08-20T13:00:00.000Z', completed_at: null, name: 'Centre de tri', address: null, latitude: 49.4231, longitude: 1.0993, categorie: 'centre_tri', duree_min: 20 }],
    });
    const r = await get();
    expect(r.body.tour.is_association).toBe(true);
    expect(r.body.points.map((p) => p.kind)).toEqual(['association', 'association', 'arret_technique']);
    expect(r.body.points[0]).toMatchObject({
      rank: 1, ref_id: 900, name: 'Croix-Rouge Rouen', commune: 'ROUEN',
      delay_minutes: 5, nb_containers: null,
    });
    // `tour_association_point` n'a pas de colonne skip_reason : le motif est
    // dans les notes, et l'API ne fabrique pas un motif qu'elle n'a pas.
    expect(r.body.points[1].skip_reason).toBeNull();
    expect(r.body.points[1].skip_reason_label).toBeNull();
    expect(r.body.points[1].notes).toBe('Local fermé');
    expect(r.body.kpis.nb_points_total).toBe(2);
    expect(r.body.kpis.nb_points_skipped).toBe(1);
  });
});

// ── Pesées, incidents, consignes ─────────────────────────────────────────
describe('pesées, incidents, consignes', () => {
  test('le poids total somme TOUTES les pesées, intermédiaires comprises', async () => {
    mockDb({
      weights: [
        { id: 1, weight_kg: 649, tare_kg: 2100, is_intermediate: true, notes: 'camion plein', recorded_at: '2026-08-20T09:00:00.000Z', recorded_by_name: null },
        { id: 2, weight_kg: 810.5, tare_kg: 2100, is_intermediate: true, notes: null, recorded_at: '2026-08-20T11:00:00.000Z', recorded_by_name: null },
        { id: 3, weight_kg: 430, tare_kg: 2100, is_intermediate: false, notes: null, recorded_at: '2026-08-20T13:05:00.000Z', recorded_by_name: 'DUPONT Marc' },
      ],
    });
    const r = await get();
    expect(r.body.kpis.total_weight_kg).toBe(1889.5);
    expect(r.body.kpis.nb_weighings).toBe(3);
    expect(r.body.kpis.nb_weighings_intermediate).toBe(2);
    expect(r.body.weights[0]).toMatchObject({ weight_kg: 649, is_intermediate: true });
  });

  test('aucune pesée : le poids vaut null avec son motif, jamais 0', async () => {
    mockDb({ weights: [] });
    const r = await get();
    expect(r.body.kpis.total_weight_kg).toBeNull();
    expect(r.body.kpis.total_weight_motif).toMatch(/aucune pesée/i);
  });

  test('incidents et consignes : sens, accusé de lecture et résolution', async () => {
    mockDb({
      incidents: [{ id: 5, type: 'cav_problem', status: 'resolved', description: 'Conteneur tagué', created_at: '2026-08-20T07:00:00.000Z', resolved_at: '2026-08-21T09:00:00.000Z', resolution_notes: 'Nettoyage programmé', resolved_by_name: 'ADMIN Test', cav_id: 10, photo_path: '/uploads/i5.jpg' }],
      messages: [
        { id: 71, tour_id: TOUR_ID, vehicle_id: 7, message: 'Ajout d\'une borne rue Verte', created_at: '2026-08-20T08:00:00.000Z', read_at: '2026-08-20T08:04:00.000Z', sender_name: 'CHEF Ana' },
        { id: 72, tour_id: null, vehicle_id: 7, message: 'Attention verglas', created_at: '2026-08-20T06:00:00.000Z', read_at: null, sender_name: 'CHEF Ana' },
      ],
    });
    const r = await get();
    expect(r.body.incidents[0]).toMatchObject({
      id: 5, type: 'cav_problem', status: 'resolved',
      resolution_notes: 'Nettoyage programmé', resolved_by_name: 'ADMIN Test',
    });
    expect(r.body.kpis.nb_incidents).toBe(1);
    expect(r.body.kpis.nb_incidents_open).toBe(0);

    expect(r.body.messages[0]).toMatchObject({
      sens: 'gestionnaire_vers_chauffeur', acquitte: true, rattachement: 'tournee',
    });
    expect(r.body.messages[1]).toMatchObject({
      sens: 'gestionnaire_vers_chauffeur', acquitte: false,
      rattachement: 'vehicule_pendant_la_tournee',
    });
  });
});

// ── Trace GPS ─────────────────────────────────────────────────────────────
describe('trace GPS', () => {
  test('échantillonnage régulier plafonné, dernier point conservé, total exact', async () => {
    const gps = Array.from({ length: 4000 }, (_, i) => ({
      latitude: 49.4 + i * 0.0001, longitude: 1.09 + i * 0.0001,
      speed: 30, recorded_at: new Date(Date.UTC(2026, 7, 20, 6, 0, i)).toISOString(),
    }));
    mockDb({ gps });
    const r = await get();
    expect(r.body.gps_track.total_positions).toBe(4000);
    expect(r.body.gps_track.sampling_step).toBe(14);              // ceil(4000/300)
    expect(r.body.gps_track.returned_positions).toBeLessThanOrEqual(301);
    expect(r.body.gps_track.positions.length).toBe(r.body.gps_track.returned_positions);
    // La forme du trajet est conservée aux deux bouts.
    expect(r.body.gps_track.positions[0].recorded_at).toBe(gps[0].recorded_at);
    expect(r.body.gps_track.positions.at(-1).recorded_at).toBe(gps[3999].recorded_at);
    // La distance est mesurée sur la trace COMPLÈTE, pas sur l'échantillon.
    expect(r.body.kpis.distance_km).toBeGreaterThan(50);
  });

  test('aucun relevé : distance null avec son motif, jamais 0', async () => {
    mockDb({ gps: [] });
    const r = await get();
    expect(r.body.kpis.distance_km).toBeNull();
    expect(r.body.kpis.distance_source).toBeNull();
    expect(r.body.kpis.distance_motif).toMatch(/aucun relevé gps/i);
    expect(r.body.gps_track).toMatchObject({ total_positions: 0, returned_positions: 0 });
  });
});

// ── Résilience ────────────────────────────────────────────────────────────
describe('résilience', () => {
  test('un bloc en échec dégrade SEUL, est nommé, et le rapport reste servi', async () => {
    mockDb({
      erreurs: ['gps', 'messages'],
      cavs: [{ id: 1, ref_id: 10, position: 1, status: 'collected', fill_level: 4, fill_percent: null, skip_reason: null, remballe: false, collected_at: '2026-08-20T06:30:00.000Z', notes: null, planned_passage_time: null, name: 'A', address: null, commune: 'X', latitude: 49.4, longitude: 1.1, nb_containers: 1 }],
      weights: [{ id: 1, weight_kg: 500, tare_kg: null, is_intermediate: false, notes: null, recorded_at: '2026-08-20T13:00:00.000Z', recorded_by_name: null }],
    });
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.degraded.sort()).toEqual(['gps', 'messages']);
    expect(r.body.warnings.join(' ')).toMatch(/Données indisponibles pour/);
    // Le reste du rapport est intact.
    expect(r.body.points).toHaveLength(1);
    expect(r.body.kpis.total_weight_kg).toBe(500);
    expect(r.body.messages).toEqual([]);
    expect(r.body.gps_track.total_positions).toBe(0);
  });

  test('référentiel du centre de tri vide : repli d\'environnement, dit en clair', async () => {
    mockDb({ centre: null });
    const r = await get();
    expect(r.body.planned_route.centre_tri).toMatchObject({ id: null, source: 'environnement' });
    expect(r.body.planned_route.centre_tri.latitude).toBeCloseTo(49.4231, 3);
  });

  test('checklist sans détail : le rapport le DIT au lieu de laisser croire à un sans-faute', async () => {
    mockDb({
      checklist: { id: 8, exterior_ok: true, fuel_level: '1/2', km_start: 120340, km_end: null, notes: null, degats: null, reponses: null, created_at: '2026-08-20T05:40:00.000Z', employee_name: 'DUPONT Marc' },
      endOfDay: { id: 4, chauffeur_non_fume: true, chauffeur_pas_objet_personnel: true, suiveur_non_fume: true, suiveur_pas_objet_personnel: true, binome_vehicule_vide: true, binome_vehicule_ok: true, remarques: 'RAS', created_at: '2026-08-20T13:12:00.000Z', employee_name: 'DUPONT Marc' },
    });
    const r = await get();
    expect(r.body.checklist).toMatchObject({
      id: 8, fuel_level: '1/2', km_start: 120340, detail_disponible: false,
    });
    expect(r.body.checklist.reponses).toEqual([]);
    expect(r.body.end_of_day).toMatchObject({ id: 4, remarques: 'RAS' });
  });

  test('checklist et fin de journée absentes valent null, pas un objet vide', async () => {
    mockDb();
    const r = await get();
    expect(r.body.checklist).toBeNull();
    expect(r.body.end_of_day).toBeNull();
  });
});

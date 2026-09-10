// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — GET /api/cav/:id/historique
// ───────────────────────────────────────────────────────────────────────────
// Volet « Historique & incidents » de la fiche AdminCAV (exigence 08/2026) :
// pour un CAV donné, l'endpoint consolide les passages en tournée (collecté /
// sauté avec motif, niveau relevé), les tonnages attribués et les incidents,
// avec une synthèse chiffrée de la période (bornée 1-60 mois, défaut 12).
//
// Auth réelle (JWT), DB mockée par routage SQL (même harnais que
// cav-photo-contract.test.js).
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(),
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

const adminToken = jwt.sign(
  { id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' },
  JWT_SECRET, { expiresIn: '1h' });
const gestionnaireToken = jwt.sign(
  { id: 2, username: 'manager', role: 'ADMIN' },
  JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign(
  { id: 3, username: 'collab', role: 'COLLABORATEUR' },
  JWT_SECRET, { expiresIn: '1h' });

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/cav', require('../../src/routes/cav'));
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

beforeEach(() => { mockQuery.mockReset(); });

const PASSAGES = [
  { tour_id: 12, date: '2026-08-18', mode: 'intelligent', tour_status: 'completed', registration: 'AB-123-CD', vehicle_name: 'Master', status: 'collected', fill_level: 4, fill_percent: 110, skip_reason: null, collected_at: '2026-08-18T09:12:00.000Z' },
  { tour_id: 9, date: '2026-08-04', mode: 'manual', tour_status: 'completed', registration: 'AB-123-CD', vehicle_name: 'Master', status: 'skipped', fill_level: null, fill_percent: null, skip_reason: 'bouchee', collected_at: null },
  { tour_id: 15, date: '2026-08-25', mode: 'standard', tour_status: 'planned', registration: 'EF-456-GH', vehicle_name: 'Kangoo', status: 'pending', fill_level: null, skip_reason: null, collected_at: null },
];
const TONNAGES = [
  { date: '2026-08-18', weight_kg: '181.5', source: 'mobile' },
  { date: '2026-07-02', weight_kg: '120.4', source: 'mobile' },
];
const INCIDENTS = [
  { id: 3, type: 'cav_problem', description: 'Trappe forcée', status: 'open', created_at: '2026-08-10T08:00:00.000Z', resolved_at: null, tour_id: 9 },
  { id: 1, type: 'environment', description: 'Dépôt sauvage', status: 'resolved', created_at: '2026-06-01T08:00:00.000Z', resolved_at: '2026-06-03T10:00:00.000Z', tour_id: null },
];

const FULL_DB = [
  [/FROM tour_cav tc\s+JOIN tours t ON/, PASSAGES],
  [/FROM tonnage_history\s+WHERE cav_id/, TONNAGES],
  [/FROM incidents\s+WHERE cav_id/, INCIDENTS],
];

describe('GET /api/cav/:id/historique — consolidation fiche AdminCAV', () => {
  it('200 : passages + tonnages + incidents + synthèse cohérente', async () => {
    mockDb(FULL_DB);
    const res = await request(app)
      .get('/api/cav/7/historique')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.periode_mois).toBe(12);
    expect(res.body.passages).toHaveLength(3);
    expect(res.body.tonnages).toHaveLength(2);
    expect(res.body.incidents).toHaveLength(2);

    // Synthèse calculée depuis les lignes, pas inventée
    expect(res.body.synthese).toEqual({
      nb_passages: 3,
      nb_collectes: 1,
      nb_sautes: 1,
      poids_total_kg: 302, // 181.5 + 120.4 arrondi
      nb_incidents: 2,
      incidents_ouverts: 1, // 'resolved' et 'closed' exclus
    });

    // Champs consommés par le front (badges statut / motif / niveau)
    const saute = res.body.passages.find((p) => p.status === 'skipped');
    expect(saute.skip_reason).toBe('bouchee');
    expect(res.body.passages[0].registration).toBe('AB-123-CD');
    expect(res.body.incidents[0].type).toBe('cav_problem');
  });

  it('borne la période : mois=999 → 60, mois invalide → 12', async () => {
    mockDb(FULL_DB);
    const r1 = await request(app)
      .get('/api/cav/7/historique?mois=999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r1.status).toBe(200);
    expect(r1.body.periode_mois).toBe(60);

    const r2 = await request(app)
      .get('/api/cav/7/historique?mois=abc')
      .set('Authorization', `Bearer ${gestionnaireToken}`);
    expect(r2.status).toBe(200);
    expect(r2.body.periode_mois).toBe(12);
  });

  it('CAV sans activité : tableaux vides et synthèse à zéro (jamais de valeur inventée)', async () => {
    mockDb([]); // toutes les requêtes → rows: []
    const res = await request(app)
      .get('/api/cav/42/historique')
      .set('Authorization', `Bearer ${gestionnaireToken}`);
    expect(res.status).toBe(200);
    expect(res.body.passages).toEqual([]);
    expect(res.body.tonnages).toEqual([]);
    expect(res.body.incidents).toEqual([]);
    expect(res.body.synthese).toEqual({
      nb_passages: 0, nb_collectes: 0, nb_sautes: 0,
      poids_total_kg: 0, nb_incidents: 0, incidents_ouverts: 0,
    });
  });

  it('400 : identifiant non numérique', async () => {
    mockDb(FULL_DB);
    const res = await request(app)
      .get('/api/cav/abc/historique')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('403 : refusé à un rôle COLLABORATEUR (fiche réservée ADMIN/MANAGER)', async () => {
    mockDb(FULL_DB);
    const res = await request(app)
      .get('/api/cav/7/historique')
      .set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(403);
  });

  it('401 : sans jeton', async () => {
    mockDb(FULL_DB);
    const res = await request(app).get('/api/cav/7/historique');
    expect(res.status).toBe(401);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LE DÉBORDEMENT NE SE PERD PLUS DANS L'HISTORIQUE (constat client 10/09/2026)
// ───────────────────────────────────────────────────────────────────────────
// Le chauffeur peut déclarer une borne « au-delà » du plein. C'est stocké
// `fill_level = 4` — exactement comme « plein », l'échelle plafonnant à 4 — et
// `fill_percent = 110`. La fiche du point n'affichait que l'échelle : elle
// montrait « 4/5 », donc rien de plus qu'une borne pleine. L'endpoint décode
// désormais le remplissage pour que l'écran n'ait plus à le réinterpréter.
describe('GET /api/cav/:id/historique — le remplissage déclaré est restitué', () => {
  it('un passage EN DÉBORDEMENT est nommé et marqué comme tel', async () => {
    mockDb(FULL_DB);
    const res = await request(app).get('/api/cav/7/historique')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const passage = res.body.passages.find((p) => p.tour_id === 12);
    expect(passage.remplissage).toMatchObject({
      pourcentage: 110, debordement: true, approche: false,
    });
    expect(passage.remplissage.libelle).toMatch(/au-delà/);
    // Les colonnes brutes restent servies : aucun appelant existant ne casse.
    expect(passage.fill_level).toBe(4);
    expect(passage.fill_percent).toBe(110);
  });

  it("un passage SAUTÉ n'a pas de remplissage — et pas « vide » non plus", async () => {
    mockDb(FULL_DB);
    const res = await request(app).get('/api/cav/7/historique')
      .set('Authorization', `Bearer ${adminToken}`);
    const saute = res.body.passages.find((p) => p.status === 'skipped');
    expect(saute.remplissage).toBeNull();
  });

  it('la requête demande bien le pourcentage à la base', async () => {
    mockDb(FULL_DB);
    await request(app).get('/api/cav/7/historique').set('Authorization', `Bearer ${adminToken}`);
    const sql = mockQuery.mock.calls.map(([q]) => String(q)).find((q) => /FROM tour_cav tc/.test(q));
    expect(sql).toMatch(/tc\.fill_percent/);
  });
});

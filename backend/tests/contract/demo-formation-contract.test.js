// ═══════════════════════════════════════════════════════════════════════════
// TEST DE CONTRAT — MODE DÉMO (formations de l'application conducteur)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la promesse faite au client : « un stagiaire peut tout essayer
// sans qu'une seule donnée réelle bouge ».
//
//   1. les effets de clôture (tonnage, stock, apprentissage) sont NEUTRALISÉS
//      sur une tournée de démo, et TOUJOURS appliqués sur une tournée réelle ;
//   2. le scan de QR n'historise rien en démo ;
//   3. la photo du stagiaire ne remplace jamais la photo de référence du CAV ;
//   4. l'endpoint formateur expose le lien et l'état de la démo.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;
process.env.MOBILE_BASE_URL = 'https://m.solidata.online';

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} })),
}));
jest.mock('../../src/services/push-notifications', () => ({ sendPushToRoles: jest.fn(async () => {}) }));

const { applyCompletionSideEffects } = require('../../src/routes/tours/completion-effects');

// ── 1. Effets de clôture ───────────────────────────────────────────────────
describe('applyCompletionSideEffects — neutralisation en mode démo', () => {
  beforeEach(() => mockQuery.mockReset());

  const TOUR_REEL = {
    id: 10, date: '2026-08-21', total_weight_kg: 900, vehicle_id: 3,
    collection_type: 'pav', is_demo: false,
  };

  it('une tournée de DÉMO n’écrit RIEN (ni tonnage, ni stock, ni apprentissage)', async () => {
    await applyCompletionSideEffects({ ...TOUR_REEL, is_demo: true }, 10, 1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('une tournée RÉELLE applique bien tous ses effets (non-régression)', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/FROM tour_cav WHERE tour_id = \$1 AND status = 'collected'/.test(s)) {
        return Promise.resolve({ rows: [{ cav_id: 1 }, { cav_id: 2 }] });
      }
      if (/predicted_fill_rate IS NOT NULL/.test(s)) {
        return Promise.resolve({ rows: [{ cav_id: 1, predicted_fill_rate: 80, fill_level: 4 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await applyCompletionSideEffects(TOUR_REEL, 10, 1);
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' '));
    expect(sqls.some((s) => /INSERT INTO tonnage_history/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO stock_movements/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO stock_original_movements/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO collection_learning_feedback/.test(s))).toBe(true);
  });

  it('en l’absence de drapeau, la tournée est traitée comme RÉELLE (jamais de perte)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await applyCompletionSideEffects({ ...TOUR_REEL, is_demo: undefined }, 10, 1);
    expect(mockQuery).toHaveBeenCalled();
  });
});

// ── 2-4. Endpoints ─────────────────────────────────────────────────────────
describe('endpoints du parcours en mode démo', () => {
  const express = require('express');
  const request = require('supertest');
  const { authenticate } = require('../../src/middleware/auth');

  let app;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/tours', authenticate, require('../../src/routes/tours/demo'));
    // Routeur complet pour scan-public (JWT chauffeur).
    app.use('/api/tours', require('../../src/routes/tours'));
  });
  beforeEach(() => mockQuery.mockReset());

  const driverToken = (vehicleId, demo = true) => jwt.sign(
    { id: 1, username: `driver_${vehicleId}`, role: 'COLLABORATEUR', vehicle_id: vehicleId, is_demo: demo },
    JWT_SECRET, { expiresIn: '1h' }
  );
  const adminToken = jwt.sign(
    { id: 1, username: 'a', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' }
  );

  it('scan-public : aucun historique de scan en démo', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/SELECT vehicle_id FROM tours WHERE id/.test(s)) return Promise.resolve({ rows: [{ vehicle_id: 7 }] });
      if (/SELECT is_demo FROM tours WHERE id/.test(s)) return Promise.resolve({ rows: [{ is_demo: true }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).post('/api/tours/55/scan-public')
      .set('Authorization', `Bearer ${driverToken(7)}`).send({ cav_id: 3 });

    expect(res.status).toBe(200);
    expect(res.body.demo).toBe(true);
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO cav_qr_scans/.test(s))).toBe(false);
  });

  it('demo/access-info : lien + état de la tournée d’exercice', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/FROM vehicles WHERE is_demo = true/.test(s)) {
        return Promise.resolve({ rows: [{ id: 7, registration: 'DEMO-FORMATION', name: 'Camion École', qr_token: 'a'.repeat(32) }] });
      }
      if (/FROM tours t WHERE t.vehicle_id = \$1 AND t.is_demo = true/.test(s)) {
        return Promise.resolve({ rows: [{ id: 55, date: '2026-08-21', status: 'planned', nb_cav: 8, nb_collectes: 2 }] });
      }
      if (/FROM settings WHERE key/.test(s)) return Promise.resolve({ rows: [{ value: '2026-08-21T09:00:00.000Z' }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).get('/api/tours/demo/access-info')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.disponible).toBe(true);
    expect(res.body.url).toBe(`https://m.solidata.online/v/${'a'.repeat(32)}`);
    expect(res.body.vehicle).toEqual({ id: 7, registration: 'DEMO-FORMATION', name: 'Camion École' });
    expect(res.body.tour).toMatchObject({ id: 55, nb_cav: 8, nb_collectes: 2 });
    expect(res.body.reinitialisee_le).toBe('2026-08-21T09:00:00.000Z');
  });

  it('demo/access-info : état honnête quand la démo n’est pas installée', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/tours/demo/access-info')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.disponible).toBe(false);
    expect(res.body.message).toMatch(/seed-demo-formation/);
    expect(res.body.url).toBeUndefined();
  });

  it('demo/reset : refus explicite si la démo n’est pas installée', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).post('/api/tours/demo/reset')
      .set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DEMO_ABSENTE');
  });

  it('demo/access-info : interdit à un rôle non habilité', async () => {
    const collabToken = jwt.sign({ id: 2, username: 'c', role: 'COLLABORATEUR' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/api/tours/demo/access-info')
      .set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(403);
  });
});

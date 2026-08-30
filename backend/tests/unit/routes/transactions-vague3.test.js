/**
 * Vague 3 — item 3.B « Intégrité transactionnelle ».
 * Vérifie que les écritures multi-tables encapsulées passent bien par une
 * transaction (BEGIN → … → COMMIT) et ROLLBACK proprement en cas d'échec.
 * Mocks pg alignés sur le pattern du projet (cf. tri.test.js).
 */
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
  connect: async () => ({ query: (...args) => mockClientQuery(...args), release: mockRelease }),
}));

const express = require('express');
const request = require('supertest');

const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' }, JWT_SECRET, { expiresIn: '1h' });

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/pcm', require('../../../src/routes/pcm'));
  app.use('/api/tri', require('../../../src/routes/tri'));
  app.use('/api/planning-hebdo', require('../../../src/routes/planning-hebdo'));
});

afterEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockRelease.mockReset();
});

const calls = () => mockClientQuery.mock.calls.map((c) => String(c[0]));

// ═══════════════════════════════════════════════════════════════
// PCM /submit — atomicité + UPSERT anti-doublon
// ═══════════════════════════════════════════════════════════════
describe('POST /api/pcm/submit — écriture atomique + ON CONFLICT', () => {
  const TYPES = ['analyseur', 'perseverant', 'empathique', 'imagineur', 'energiseur', 'promoteur'];
  const answers = Array.from({ length: 20 }, (_, k) => ({
    question_number: k + 1,
    answer_value: TYPES[k % TYPES.length],
  }));

  it('enregistre réponses (UPSERT) + rapport + clôture session dans une transaction commitée', async () => {
    // session trouvée par access_token (hors transaction)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, candidate_id: 9, status: 'in_progress',
      // 2.45.0 : /submit refuse (409) une session dont la notice d'information
      // n'a pas été confirmée. Cette suite-ci porte sur l'ATOMICITÉ de l'écriture ;
      // la garde elle-même est vérifiée par pcm-notice-restitution-contract.
      notice_acceptee_at: '2026-08-30T09:00:00Z' }] });
    mockClientQuery.mockResolvedValue({ rows: [] }); // BEGIN, inserts, update, COMMIT

    const res = await request(app).post('/api/pcm/submit').send({ access_token: 'tok-abc', answers });

    expect(res.status).toBe(200);
    expect(res.body.profile.baseType).toBeTruthy();
    const c = calls();
    expect(c[0]).toMatch(/BEGIN/);
    expect(c.at(-1)).toMatch(/COMMIT/);
    // les réponses passent par un UPSERT idempotent
    const upserts = c.filter((s) => /INSERT INTO pcm_answers[\s\S]*ON CONFLICT \(session_id, question_number\)/.test(s));
    expect(upserts).toHaveLength(20); // 20 questions distinctes
    expect(c.some((s) => /INSERT INTO pcm_reports/.test(s))).toBe(true);
    expect(c.some((s) => /UPDATE pcm_sessions SET status/.test(s))).toBe(true);
    expect(mockRelease).toHaveBeenCalled();
  });

  it('ROLLBACK si l’insertion du rapport échoue (aucun COMMIT)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, candidate_id: 9, status: 'in_progress',
      // 2.45.0 : /submit refuse (409) une session dont la notice d'information
      // n'a pas été confirmée. Cette suite-ci porte sur l'ATOMICITÉ de l'écriture ;
      // la garde elle-même est vérifiée par pcm-notice-restitution-contract.
      notice_acceptee_at: '2026-08-30T09:00:00Z' }] });
    mockClientQuery.mockImplementation((sql) =>
      /INSERT INTO pcm_reports/.test(sql) ? Promise.reject(new Error('boom')) : Promise.resolve({ rows: [] }));

    const res = await request(app).post('/api/pcm/submit').send({ access_token: 'tok-abc', answers });

    expect(res.status).toBe(500);
    const c = calls();
    expect(c.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(c.some((s) => /COMMIT/.test(s))).toBe(false);
    expect(mockRelease).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// tri /batches — lot + sortie de stock original atomiques
// ═══════════════════════════════════════════════════════════════
describe('POST /api/tri/batches — lot + mouvement stock atomiques', () => {
  it('crée le lot et la sortie de stock dans une transaction commitée', async () => {
    mockQuery.mockResolvedValue({ rows: [] }); // strays (activity-logger)
    mockClientQuery.mockImplementation((sql) => {
      if (/INSERT INTO batch_tracking/.test(sql)) return Promise.resolve({ rows: [{ id: 7, code: 'LOT-X' }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).post('/api/tri/batches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ chaine_id: 1, poids_initial_kg: 300 });

    expect(res.status).toBe(201);
    const c = calls();
    expect(c[0]).toMatch(/BEGIN/);
    expect(c.at(-1)).toMatch(/COMMIT/);
    expect(c.some((s) => /INSERT INTO stock_original_movements/.test(s))).toBe(true);
  });

  it('ROLLBACK si la sortie de stock échoue → pas de lot orphelin', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockClientQuery.mockImplementation((sql) => {
      if (/INSERT INTO batch_tracking/.test(sql)) return Promise.resolve({ rows: [{ id: 7, code: 'LOT-X' }] });
      if (/INSERT INTO stock_original_movements/.test(sql)) return Promise.reject(new Error('fk fail'));
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).post('/api/tri/batches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ chaine_id: 1, poids_initial_kg: 300 });

    expect(res.status).toBe(500);
    const c = calls();
    expect(c.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(c.some((s) => /COMMIT/.test(s))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// tri /colisages/:id/status — transition verrouillée (FOR UPDATE)
// ═══════════════════════════════════════════════════════════════
describe('PUT /api/tri/colisages/:id/status — transition atomique verrouillée', () => {
  it('lit le statut FOR UPDATE puis UPDATE + historique et COMMIT', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockClientQuery.mockImplementation((sql) => {
      if (/SELECT status FROM colisages WHERE id = \$1 FOR UPDATE/.test(sql)) return Promise.resolve({ rows: [{ status: 'ouvert' }] });
      if (/UPDATE colisages SET/.test(sql)) return Promise.resolve({ rows: [{ id: 3, status: 'scelle' }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).put('/api/tri/colisages/3/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'scelle' });

    expect(res.status).toBe(200);
    const c = calls();
    expect(c.some((s) => /FOR UPDATE/.test(s))).toBe(true);
    expect(c.some((s) => /INSERT INTO colisage_history/.test(s))).toBe(true);
    expect(c.at(-1)).toMatch(/COMMIT/);
  });

  it('400 sur transition interdite → ROLLBACK, pas d’historique', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockClientQuery.mockImplementation((sql) => {
      if (/FOR UPDATE/.test(sql)) return Promise.resolve({ rows: [{ status: 'ouvert' }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).put('/api/tri/colisages/3/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'livre' }); // ouvert → livre interdit

    expect(res.status).toBe(400);
    const c = calls();
    expect(c.some((s) => /ROLLBACK/.test(s))).toBe(true);
    expect(c.some((s) => /INSERT INTO colisage_history/.test(s))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// planning-hebdo /affecter — DELETE + upsert atomiques
// ═══════════════════════════════════════════════════════════════
describe('POST /api/planning-hebdo/affecter — affectation atomique', () => {
  it('résout le conflit de période et upsert l’affectation dans une transaction', async () => {
    mockQuery.mockResolvedValue({ rows: [] }); // dispo + absence (pas d'indispo)
    mockClientQuery.mockImplementation((sql) => {
      if (/INSERT INTO schedule/.test(sql)) return Promise.resolve({ rows: [{ id: 1, employee_id: 5, periode: 'journee' }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).post('/api/planning-hebdo/affecter')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employee_id: 5, date: '2026-07-15', periode: 'journee' });

    expect(res.status).toBe(200);
    const c = calls();
    expect(c[0]).toMatch(/BEGIN/);
    expect(c.some((s) => /DELETE FROM schedule/.test(s))).toBe(true);
    expect(c.at(-1)).toMatch(/COMMIT/);
  });
});

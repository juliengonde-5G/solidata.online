// Vague 2 — ouverture de l'application aux parties prenantes (lot « acces-roles »).
// Vérifie la MATRICE D'ACCÈS des nouveaux rôles intégrés (DPO / FINANCE / QHSE)
// et de l'auditeur AUTORITE : lecture ouverte là où c'est prévu, écriture
// toujours refusée aux rôles de consultation. Auth réelle (JWT), DB mockée.
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
const mockConnect = jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} }));
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));
// Le middleware de journal d'activité écrit en base — neutralisé ici.
jest.mock('../../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

const tok = (role) => jwt.sign({ id: 1, username: role.toLowerCase(), role, first_name: 'T', last_name: role, mfa: true, mfa_at: Math.floor(Date.now() / 1000) }, JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  ADMIN: tok('ADMIN'), MANAGER: tok('MANAGER'), COLLABORATEUR: tok('COLLABORATEUR'),
  AUTORITE: tok('AUTORITE'), DPO: tok('DPO'), FINANCE: tok('FINANCE'), QHSE: tok('QHSE'), RH: tok('RH'),
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/refashion', require('../../../src/routes/refashion'));
  app.use('/api/finance', require('../../../src/routes/finance'));
  app.use('/api/pennylane', require('../../../src/routes/pennylane'));
  app.use('/api/rgpd', require('../../../src/routes/rgpd'));
  app.use('/api/incidents', require('../../../src/routes/incidents'));
  app.use('/api/metropole', require('../../../src/routes/metropole'));
});

afterEach(() => { mockQuery.mockReset(); mockConnect.mockClear(); });

const get = (path, role) => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (path, role, body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const put = (path, role, body = {}) => request(app).put(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

// ── ITEM 52 — Refashion : AUTORITE/QHSE en LECTURE, écriture réservée ──────────
describe('Refashion — auditeur AUTORITE en lecture seule', () => {
  it('AUTORITE lit le catalogue des exports (GET) → 200', async () => {
    const res = await get('/api/refashion/exports', 'AUTORITE');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
  it('QHSE lit le catalogue des exports (GET) → 200', async () => {
    const res = await get('/api/refashion/exports', 'QHSE');
    expect(res.status).toBe(200);
  });
  it('AUTORITE ne peut PAS écrire une DPAV (POST) → 403', async () => {
    const res = await post('/api/refashion/dpav', 'AUTORITE', { annee: 2026, trimestre: 1 });
    expect(res.status).toBe(403);
  });
  it('AUTORITE ne peut PAS joindre un justificatif (POST) → 403', async () => {
    const res = await post('/api/refashion/taux/1/justificatif', 'AUTORITE');
    expect(res.status).toBe(403);
  });
  it('MANAGER ne peut PAS créer un taux (réservé ADMIN) → 403', async () => {
    const res = await post('/api/refashion/taux', 'MANAGER', { taux_euro_par_tonne: 100, valid_from: '2026-01-01' });
    expect(res.status).toBe(403);
  });
  it('COLLABORATEUR n\'a aucun accès Refashion → 403', async () => {
    const res = await get('/api/refashion/exports', 'COLLABORATEUR');
    expect(res.status).toBe(403);
  });
});

// ── ITEM 54 — FINANCE : lecture seule sur le domaine finance ────────────────────
describe('Finance — rôle FINANCE en lecture seule', () => {
  it('FINANCE lit les exercices (GET) → 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await get('/api/finance/exercises', 'FINANCE');
    expect(res.status).toBe(200);
  });
  it('FINANCE ne peut PAS modifier un budget (PUT) → 403', async () => {
    const res = await put('/api/finance/budget/2026', 'FINANCE', { category: 'X', month: 0, amount: 1 });
    expect(res.status).toBe(403);
  });
  it('FINANCE ne peut PAS importer (POST) → 403', async () => {
    const res = await post('/api/finance/import/gl', 'FINANCE');
    expect(res.status).toBe(403);
  });
  it('COLLABORATEUR n\'accède pas à la finance → 403', async () => {
    const res = await get('/api/finance/exercises', 'COLLABORATEUR');
    expect(res.status).toBe(403);
  });
});

describe('Pennylane — FINANCE lecture, pas de sync', () => {
  it('FINANCE lit le statut (GET) → 200', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_active: true, last_sync_at: null, company_id: 'C1' }] }) // config
      .mockResolvedValueOnce({ rows: [{ total: '0' }] }) // mappings count
      .mockResolvedValueOnce({ rows: [] }); // last sync log
    const res = await get('/api/pennylane/status', 'FINANCE');
    expect(res.status).toBe(200);
  });
  it('FINANCE ne peut PAS déclencher un sync GL (POST) → 403', async () => {
    const res = await post('/api/pennylane/sync/gl', 'FINANCE', {});
    expect(res.status).toBe(403);
  });
});

// ── ITEM 54 — DPO : écrans RGPD sans pleins droits ADMIN ────────────────────────
describe('RGPD — rôle DPO', () => {
  it('DPO lit le registre des traitements (GET) → 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await get('/api/rgpd/registre', 'DPO');
    expect(res.status).toBe(200);
  });
  it('DPO consulte le journal d\'audit RGPD (GET) → 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await get('/api/rgpd/audit', 'DPO');
    expect(res.status).toBe(200);
  });
  it('MANAGER n\'a aucun accès RGPD → 403', async () => {
    const res = await get('/api/rgpd/registre', 'MANAGER');
    expect(res.status).toBe(403);
  });
  it('COLLABORATEUR n\'a aucun accès RGPD → 403', async () => {
    const res = await get('/api/rgpd/registre', 'COLLABORATEUR');
    expect(res.status).toBe(403);
  });
});

// ── ITEM 54 — QHSE : lecture + résolution des incidents ─────────────────────────
describe('Incidents — rôle QHSE', () => {
  it('QHSE lit les statistiques d\'incidents (GET) → 200', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // GROUP BY status
      .mockResolvedValueOnce({ rows: [{ resolus: 0, delai_moyen_jours: null }] }); // délai moyen
    const res = await get('/api/incidents/stats', 'QHSE');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('delai_moyen_jours');
  });
  it('COLLABORATEUR n\'accède pas aux incidents → 403', async () => {
    const res = await get('/api/incidents/stats', 'COLLABORATEUR');
    expect(res.status).toBe(403);
  });
});

// ── ITEM 53 — Métropole : indicateurs agrégés pour AUTORITE ────────────────────
describe('Métropole — indicateurs agrégés non nominatifs (AUTORITE)', () => {
  it('AUTORITE lit le délai d\'intervention incidents (GET) → 200 (agrégé)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await get('/api/metropole/delai-intervention-incidents', 'AUTORITE');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('global');
    expect(res.body).toHaveProperty('par_type_mois');
  });
  it('AUTORITE lit les KPI insertion/ETP (GET) → 200 (agrégé)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await get('/api/metropole/kpi-insertion?annee=2026', 'AUTORITE');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_etp');
    expect(res.body).toHaveProperty('absenteisme_taux_pct');
    expect(res.body).toHaveProperty('insertion');
    // Aucune donnée nominative : pas de champ prénom/nom au niveau racine.
    expect(res.body).not.toHaveProperty('first_name');
    expect(res.body).not.toHaveProperty('nom');
  });
  it('COLLABORATEUR n\'accède pas à la Métropole → 403', async () => {
    const res = await get('/api/metropole/kpi-insertion', 'COLLABORATEUR');
    expect(res.status).toBe(403);
  });
});

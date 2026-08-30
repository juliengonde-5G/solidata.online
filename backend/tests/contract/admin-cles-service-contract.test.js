/**
 * ADMINISTRATION DES CLÉS D'API — garde-fous du rôle de service (2.45.0)
 *
 * Une clé de service porte un rôle applicatif : c'est ce qui lui donne accès
 * aux lectures d'un ADMIN. Deux façons de se tirer une balle dans le pied, que
 * ce contrat interdit :
 *   • poser un rôle qui n'existe pas (la clé passerait toutes les gardes
 *     `authorize` en n'en satisfaisant aucune — une clé morte, silencieuse) ;
 *   • dissocier le rôle du scope dédié (une clé « à moitié de service »).
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
jest.mock('../../src/config/database');

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const pool = require('../../src/config/database');

const app = express();
app.use(express.json());
app.use('/api/admin/api-keys', require('../../src/routes/admin-api-keys'));

const admin = () => 'Bearer ' + jwt.sign(
  { id: 1, username: 'julien', role: 'ADMIN', tv: 0, mfa: true },
  process.env.JWT_SECRET, { expiresIn: '1h' });

beforeEach(() => {
  pool.query.mockReset();
  pool.query.mockImplementation((sql) => {
    if (/SELECT token_version FROM users/i.test(sql)) return Promise.resolve({ rows: [{ token_version: 0 }] });
    if (/FROM custom_roles WHERE role_key/i.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM custom_roles/i.test(sql)) return Promise.resolve({ rows: [] });
    if (/INSERT INTO api_keys/i.test(sql)) {
      return Promise.resolve({ rows: [{ id: 9, name: 'Smoke', key_prefix: 'abcdef012345', scopes: ['service:read'], service_role: 'ADMIN', active: true, expires_at: null, created_at: new Date() }] });
    }
    if (/SELECT scopes, service_role FROM api_keys/i.test(sql)) {
      return Promise.resolve({ rows: [{ scopes: ['service:read'], service_role: 'ADMIN' }] });
    }
    if (/UPDATE api_keys SET/i.test(sql)) {
      return Promise.resolve({ rows: [{ id: 9, name: 'Smoke', key_prefix: 'abcdef012345', scopes: ['service:read'], service_role: 'MANAGER', active: true, expires_at: null, last_used_at: null }] });
    }
    return Promise.resolve({ rows: [] });
  });
});

describe('création d’une clé de service', () => {
  test('rôle + scope cohérents → 201, et la clé en clair n’est rendue qu’ici', async () => {
    const r = await request(app).post('/api/admin/api-keys').set('Authorization', admin())
      .send({ name: 'Smoke', scopes: ['service:read'], service_role: 'ADMIN' });
    expect(r.status).toBe(201);
    expect(r.body.key).toMatch(/^sol_[0-9a-f]{12}_/);
    expect(r.body.service_role).toBe('ADMIN');
  });

  test('la base ne reçoit JAMAIS la clé en clair, seulement son hash', async () => {
    const r = await request(app).post('/api/admin/api-keys').set('Authorization', admin())
      .send({ name: 'Smoke', scopes: ['service:read'], service_role: 'ADMIN' });
    const insert = pool.query.mock.calls.find((c) => /INSERT INTO api_keys/i.test(String(c[0])));
    expect(insert[1]).not.toContain(r.body.key);
    expect(insert[1].some((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v))).toBe(true);
  });

  test('rôle inconnu → 400, aucune écriture', async () => {
    const r = await request(app).post('/api/admin/api-keys').set('Authorization', admin())
      .send({ name: 'Smoke', scopes: ['service:read'], service_role: 'SUPERADMIN' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Rôle inconnu/);
    expect(pool.query.mock.calls.some((c) => /INSERT INTO api_keys/i.test(String(c[0])))).toBe(false);
  });

  test('rôle sans le scope dédié → 400 (pas de clé « à moitié de service »)', async () => {
    const r = await request(app).post('/api/admin/api-keys').set('Authorization', admin())
      .send({ name: 'Smoke', scopes: ['cav:read'], service_role: 'ADMIN' });
    expect(r.status).toBe(400);
    expect(pool.query.mock.calls.some((c) => /INSERT INTO api_keys/i.test(String(c[0])))).toBe(false);
  });

  test('scope dédié sans rôle → 400 (la clé serait morte à l’usage)', async () => {
    const r = await request(app).post('/api/admin/api-keys').set('Authorization', admin())
      .send({ name: 'Smoke', scopes: ['service:read'] });
    expect(r.status).toBe(400);
  });

  test('clé partenaire classique (ni rôle ni scope de service) → 201, inchangé', async () => {
    pool.query.mockImplementation((sql) => {
      if (/SELECT token_version FROM users/i.test(sql)) return Promise.resolve({ rows: [{ token_version: 0 }] });
      if (/INSERT INTO api_keys/i.test(sql)) return Promise.resolve({ rows: [{ id: 10, name: 'Métropole', key_prefix: 'aaaaaaaaaaaa', scopes: ['cav:read'], service_role: null, active: true, expires_at: null, created_at: new Date() }] });
      return Promise.resolve({ rows: [] });
    });
    const r = await request(app).post('/api/admin/api-keys').set('Authorization', admin())
      .send({ name: 'Métropole', scopes: ['cav:read'] });
    expect(r.status).toBe(201);
    expect(r.body.service_role).toBeNull();
  });
});

describe('modification d’une clé de service', () => {
  test('le couple (rôle, scopes) est validé sur l’ÉTAT FINAL', async () => {
    // Retirer le scope de service d'une clé qui garde son rôle laisserait une
    // clé incohérente : refusé.
    const r = await request(app).put('/api/admin/api-keys/9').set('Authorization', admin())
      .send({ scopes: ['cav:read'] });
    expect(r.status).toBe(400);
  });

  test('changer le seul rôle d’une clé de service reste possible', async () => {
    const r = await request(app).put('/api/admin/api-keys/9').set('Authorization', admin())
      .send({ service_role: 'MANAGER' });
    expect(r.status).toBe(200);
    expect(r.body.service_role).toBe('MANAGER');
  });

  test('désactiver une clé ne demande aucune validation de rôle', async () => {
    const r = await request(app).put('/api/admin/api-keys/9').set('Authorization', admin())
      .send({ active: false });
    expect(r.status).toBe(200);
  });
});

describe('qui peut administrer les clés', () => {
  test('un rôle non ADMIN reste dehors', async () => {
    for (const role of ['MANAGER', 'RH', 'DPO', 'QHSE', 'COLLABORATEUR']) {
      const jeton = 'Bearer ' + jwt.sign({ id: 2, username: 'x', role, tv: 0, mfa: true },
        process.env.JWT_SECRET, { expiresIn: '1h' });
      const r = await request(app).get('/api/admin/api-keys').set('Authorization', jeton);
      expect(r.status).toBe(403);
    }
  });
});

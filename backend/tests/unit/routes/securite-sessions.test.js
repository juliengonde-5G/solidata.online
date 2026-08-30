// Tests — Lot « Sécurité sessions » (audit vague 3, items 3.C-1 / 3.C-2).
// Vérifie le CÂBLAGE de la révocation effective (token_version + purge refresh
// tokens) sur les événements de révocation, et la politique de mot de passe
// unifiée (min 10 + must_change_password) côté routes users / activity-log.
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
}));

const express = require('express');
const request = require('supertest');

let app;
// Jetons signés sans `tv` (jetons « hérités ») → authenticate ne consulte pas la
// base, ce qui garde les séquences de mock déterministes.
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D', mfa: true, mfa_at: Math.floor(Date.now() / 1000) }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/users', require('../../../src/routes/users'));
  app.use('/api/activity-log', require('../../../src/routes/activity-log'));
});

afterEach(() => { mockQuery.mockReset(); });

function sqlList() {
  return mockQuery.mock.calls.map((c) => String(c[0]));
}
function calledWith(re, firstParam) {
  return mockQuery.mock.calls.some(
    (c) => re.test(String(c[0])) && Array.isArray(c[1]) && c[1][0] === firstParam
  );
}

describe('Révocation effective (3.C-1)', () => {
  it('DELETE /activity-log/sessions/:id incrémente token_version ET purge les refresh tokens du compte', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    // UPDATE user_sessions ... RETURNING * → la session appartient à l'utilisateur 42
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 10, user_id: 42, is_active: false }] });

    const res = await request(app)
      .delete('/api/activity-log/sessions/10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(calledWith(/token_version = token_version \+ 1/, 42)).toBe(true);
    expect(calledWith(/DELETE FROM refresh_tokens/, 42)).toBe(true);
  });

  it('DELETE /users/:id (désactivation) incrémente token_version + purge refresh tokens', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] }); // UPDATE is_active=false RETURNING id

    const res = await request(app)
      .delete('/api/users/42')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(calledWith(/token_version = token_version \+ 1/, '42')).toBe(true);
    expect(calledWith(/DELETE FROM refresh_tokens/, '42')).toBe(true);
  });

  it('PUT /users/:id is_active=false incrémente token_version', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'COLLABORATEUR', is_active: true }] }); // état courant
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42, is_active: false, role: 'COLLABORATEUR' }] }); // UPDATE RETURNING

    const res = await request(app)
      .put('/api/users/42')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });

    expect(res.status).toBe(200);
    expect(sqlList().some((s) => /token_version = token_version \+ 1/.test(s))).toBe(true);
  });
});

describe('Politique de mot de passe unifiée (3.C-2)', () => {
  it('POST /users refuse un mot de passe < 10 caractères', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'x', password: 'court', role: 'COLLABORATEUR' });
    expect(res.status).toBe(400);
  });

  it('POST /users crée le compte avec must_change_password', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT username existant
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, username: 'newuser', role: 'COLLABORATEUR' }] }); // INSERT

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'newuser', password: 'un-mot-de-passe-long', role: 'COLLABORATEUR' });

    expect(res.status).toBe(201);
    expect(sqlList().some((s) => /INSERT INTO users/.test(s) && /must_change_password/.test(s))).toBe(true);
  });

  it('PUT /users/:id/reset-password refuse < 10 caractères', async () => {
    const res = await request(app)
      .put('/api/users/42/reset-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'court' });
    expect(res.status).toBe(400);
  });

  it('PUT /users/:id/reset-password pose must_change_password + révoque les sessions', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] }); // UPDATE ... RETURNING id

    const res = await request(app)
      .put('/api/users/42/reset-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'un-mot-de-passe-long' });

    expect(res.status).toBe(200);
    const sqls = sqlList();
    expect(sqls.some((s) => /must_change_password = true/.test(s))).toBe(true);
    expect(sqls.some((s) => /token_version = token_version \+ 1/.test(s))).toBe(true);
    expect(sqls.some((s) => /DELETE FROM refresh_tokens/.test(s))).toBe(true);
  });
});

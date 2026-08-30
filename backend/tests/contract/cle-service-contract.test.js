/**
 * CLÉ D'API DE SERVICE — contrat d'identité et de LECTURE SEULE (2.45.0)
 *
 * Ce que ce chantier remplace : le test post-déploiement se connectait avec un
 * VRAI compte ADMIN dont le mot de passe ET le secret TOTP vivaient côte à côte
 * dans le `.env` du serveur — les deux facteurs au même endroit, donc plus de
 * double authentification du tout.
 *
 * Ce que ce contrat verrouille, et qui est la RAISON pour laquelle une clé peut
 * porter un rôle élevé :
 *   • une clé valide vaut identité de service, `mfa: true`, en LECTURE ;
 *   • elle ne peut RIEN écrire, sur AUCUN routeur — la garde est dans
 *     `authenticate`, donc aucune route ne peut l'oublier ;
 *   • inactive / expirée / mal formée → 401 ; sans le scope dédié → 403 ;
 *   • un Bearer JWT humain continue de se comporter exactement comme avant ;
 *   • aucun jeton d'humain ne peut se déclarer « de service ».
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
jest.mock('../../src/config/database');

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const pool = require('../../src/config/database');
const { sha256 } = require('../../src/middleware/api-key');
const { authenticate, authorize } = require('../../src/middleware/auth');
const { requireMfa, resetMfaRolesCache } = require('../../src/middleware/mfa');

// ── Clés du jeu d'essai ──────────────────────────────────────────────────────
const CLE_SERVICE = 'sol_aaaaaaaaaaaa_secretdeservice';
const CLE_PARTENAIRE = 'sol_bbbbbbbbbbbb_secretpartenaire';
const CLE_INACTIVE = 'sol_cccccccccccc_secretinactif';
const CLE_EXPIREE = 'sol_dddddddddddd_secretexpire';
const CLE_SANS_ROLE = 'sol_eeeeeeeeeeee_secretsansrole';

const LIGNES = {
  aaaaaaaaaaaa: { id: 1, name: 'Smoke test de déploiement', scopes: ['service:read'], active: true, expires_at: null, key_hash: sha256(CLE_SERVICE), service_role: 'ADMIN' },
  bbbbbbbbbbbb: { id: 2, name: 'Métropole', scopes: ['cav:read'], active: true, expires_at: null, key_hash: sha256(CLE_PARTENAIRE), service_role: null },
  cccccccccccc: { id: 3, name: 'Révoquée', scopes: ['service:read'], active: false, expires_at: null, key_hash: sha256(CLE_INACTIVE), service_role: 'ADMIN' },
  dddddddddddd: { id: 4, name: 'Expirée', scopes: ['service:read'], active: true, expires_at: '2020-01-01T00:00:00.000Z', key_hash: sha256(CLE_EXPIREE), service_role: 'ADMIN' },
  eeeeeeeeeeee: { id: 5, name: 'Sans rôle', scopes: ['service:read'], active: true, expires_at: null, key_hash: sha256(CLE_SANS_ROLE), service_role: null },
};

// ── Application d'essai : un routeur de lecture + un routeur d'écriture ──────
const app = express();
app.use(express.json());

// Routeur « sensible » : mêmes gardes que les vrais (authenticate + requireMfa
// + authorize ADMIN). C'est la chaîne complète qu'un ADMIN humain franchit.
const sensible = express.Router();
sensible.use(authenticate, requireMfa, authorize('ADMIN'));
sensible.get('/liste', (req, res) => res.json({ user: req.user }));
sensible.post('/creer', (req, res) => res.json({ ecrit: true }));
sensible.put('/modifier/:id', (req, res) => res.json({ ecrit: true }));
sensible.patch('/corriger/:id', (req, res) => res.json({ ecrit: true }));
sensible.delete('/supprimer/:id', (req, res) => res.json({ ecrit: true }));
app.use('/api/sensible', sensible);

// Deuxième routeur, ouvert à plusieurs rôles : la garde de lecture seule ne
// doit pas dépendre du routeur qui l'héberge.
const metier = express.Router();
metier.use(authenticate, authorize('ADMIN', 'MANAGER'));
metier.get('/', (req, res) => res.json({ ok: true, user: req.user }));
metier.post('/', (req, res) => res.json({ ecrit: true }));
metier.delete('/:id', (req, res) => res.json({ ecrit: true }));
app.use('/api/metier', metier);

app.use('/api/admin/api-keys', require('../../src/routes/admin-api-keys'));

const jetonHumain = (role = 'ADMIN', extra = {}) => 'Bearer ' + jwt.sign(
  { id: 42, username: 'julien', role, tv: 0, mfa: true, mfa_at: Math.floor(Date.now() / 1000), ...extra },
  process.env.JWT_SECRET, { expiresIn: '1h' });

beforeEach(() => {
  resetMfaRolesCache();
  pool.query.mockReset();
  pool.query.mockImplementation((sql, params) => {
    if (/FROM api_keys WHERE key_prefix/i.test(sql)) {
      const ligne = LIGNES[params[0]];
      return Promise.resolve({ rows: ligne ? [ligne] : [] });
    }
    if (/UPDATE api_keys SET last_used_at/i.test(sql)) return Promise.resolve({ rows: [] });
    if (/INSERT INTO user_activity_log/i.test(sql)) return Promise.resolve({ rows: [] });
    if (/ALTER TABLE user_activity_log/i.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM custom_roles/i.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM settings/i.test(sql)) return Promise.resolve({ rows: [] });
    if (/SELECT token_version FROM users/i.test(sql)) return Promise.resolve({ rows: [{ token_version: 0 }] });
    return Promise.resolve({ rows: [] });
  });
});

describe('la clé de service vaut identité en lecture', () => {
  test('une clé valide franchit authenticate, requireMfa et authorize(ADMIN)', async () => {
    const r = await request(app).get('/api/sensible/liste').set('X-API-Key', CLE_SERVICE);
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({
      id: null,
      username: 'api:Smoke test de déploiement',
      role: 'ADMIN',
      // `mfa: true` par construction, et SANS `mfa_at` : une clé ne présente
      // jamais de second facteur — c'est `is_service` qui la fait sortir de la
      // fenêtre de renouvellement (2.46.0), pas un horodatage inventé.
      mfa: true,
      is_service: true,
      api_key_id: 1,
    });
  });

  test('la fenêtre de renouvellement du second facteur ne s\'applique pas à une clé', async () => {
    // Sans cette sortie, le smoke test de `deploy.sh` — qui porte un rôle
    // ADMIN — serait refusé en MFA_EXPIREE et ferait échouer CHAQUE
    // déploiement : une clé n'a par nature aucun second facteur à présenter.
    const r = await request(app).get('/api/sensible/liste').set('X-API-Key', CLE_SERVICE);
    expect(r.status).toBe(200);
    expect(r.body.user.mfa_at).toBeUndefined();
  });

  test('`mfa: true` par construction — la garde MFA ne bloque pas une clé', async () => {
    // Une clé N'EST PAS une personne : elle ne peut pas s'enrôler, et exiger
    // d'elle un second facteur obligerait à ranger les deux secrets ensemble,
    // c'est-à-dire à refaire exactement le défaut que ce chantier corrige.
    const r = await request(app).get('/api/sensible/liste').set('X-API-Key', CLE_SERVICE);
    expect(r.status).not.toBe(403);
    expect(r.body.user.mfa).toBe(true);
  });

  test('elle n’a aucune identité humaine : id null, username préfixé « api: »', async () => {
    const r = await request(app).get('/api/metier').set('X-API-Key', CLE_SERVICE);
    expect(r.body.user.id).toBeNull();
    expect(r.body.user.username.startsWith('api:')).toBe(true);
  });

  test('l’usage de la clé est tracé (last_used_at + journal d’activité)', async () => {
    await request(app).get('/api/metier').set('X-API-Key', CLE_SERVICE);
    await new Promise((r) => setImmediate(r));
    const sqls = pool.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /UPDATE api_keys SET last_used_at/i.test(s))).toBe(true);
    const journal = pool.query.mock.calls.find((c) => /INSERT INTO user_activity_log/i.test(String(c[0])));
    expect(journal).toBeDefined();
    expect(journal[1]).toEqual(expect.arrayContaining(['service_api_call', 'api_key']));
  });

  test('aucun mot de passe, aucun secret TOTP n’est requis nulle part', async () => {
    // Contrôle de non-retour : la clé ne déclenche AUCUNE lecture de la table
    // users (ni hash de mot de passe, ni secret TOTP, ni token_version).
    await request(app).get('/api/sensible/liste').set('X-API-Key', CLE_SERVICE);
    const sqls = pool.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /FROM users/i.test(s))).toBe(false);
    expect(sqls.some((s) => /mfa_secret|password_hash/i.test(s))).toBe(false);
  });
});

describe('la clé de service est en LECTURE SEULE', () => {
  // C'est la garantie qui rend acceptable un rôle élevé : une clé volée ne peut
  // rien écrire, rien supprimer, rien purger.
  const verbes = [
    ['post', '/api/sensible/creer'],
    ['put', '/api/sensible/modifier/1'],
    ['patch', '/api/sensible/corriger/1'],
    ['delete', '/api/sensible/supprimer/1'],
    ['post', '/api/metier'],
    ['delete', '/api/metier/1'],
  ];
  test.each(verbes)('%s %s est refusé (403 SERVICE_KEY_READ_ONLY)', async (verbe, chemin) => {
    const r = await request(app)[verbe](chemin).set('X-API-Key', CLE_SERVICE).send({ a: 1 });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SERVICE_KEY_READ_ONLY');
    expect(r.body.ecrit).toBeUndefined();
  });

  test('le handler d’écriture n’est jamais atteint', async () => {
    const r = await request(app).post('/api/sensible/creer').set('X-API-Key', CLE_SERVICE).send({});
    expect(r.body.ecrit).toBeUndefined();
  });

  test('la tentative d’écriture est TRACÉE (script mal câblé, ou clé qui a fuité)', async () => {
    await request(app).post('/api/metier').set('X-API-Key', CLE_SERVICE).send({});
    await new Promise((r) => setImmediate(r));
    const journal = pool.query.mock.calls.filter((c) => /INSERT INTO user_activity_log/i.test(String(c[0])));
    expect(journal.length).toBeGreaterThan(0);
    const params = journal[journal.length - 1][1];
    const details = JSON.parse(params.find((v) => typeof v === 'string' && v.startsWith('{')));
    expect(details).toMatchObject({ method: 'POST', refuse: 'lecture_seule' });
  });

  test('HEAD reste permis (c’est une lecture)', async () => {
    const r = await request(app).head('/api/metier').set('X-API-Key', CLE_SERVICE);
    expect(r.status).toBe(200);
  });

  test('une clé de service ne gère pas le trousseau, même en lecture', async () => {
    const r = await request(app).get('/api/admin/api-keys').set('X-API-Key', CLE_SERVICE);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SERVICE_KEY_FORBIDDEN');
  });
});

describe('les clés qui ne doivent pas ouvrir', () => {
  test('clé mal formée → 401', async () => {
    for (const mauvaise of ['nimportequoi', 'sol_', 'sol_prefixe', '', 'Bearer sol_a_b']) {
      const r = await request(app).get('/api/metier').set('X-API-Key', mauvaise);
      expect(r.status).toBe(401);
    }
  });

  test('clé inconnue → 401', async () => {
    const r = await request(app).get('/api/metier').set('X-API-Key', 'sol_ffffffffffff_inconnue');
    expect(r.status).toBe(401);
  });

  test('bon préfixe mais mauvais secret → 401', async () => {
    const r = await request(app).get('/api/metier').set('X-API-Key', 'sol_aaaaaaaaaaaa_mauvaissecret');
    expect(r.status).toBe(401);
  });

  test('clé désactivée → 401 (révocation immédiate, sans attendre d’expiration)', async () => {
    const r = await request(app).get('/api/metier').set('X-API-Key', CLE_INACTIVE);
    expect(r.status).toBe(401);
  });

  test('clé expirée → 401', async () => {
    const r = await request(app).get('/api/metier').set('X-API-Key', CLE_EXPIREE);
    expect(r.status).toBe(401);
  });

  test('clé partenaire (sans le scope de service) → 403, jamais une identité', async () => {
    const r = await request(app).get('/api/metier').set('X-API-Key', CLE_PARTENAIRE);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SERVICE_SCOPE_MANQUANT');
  });

  test('clé portant le scope mais aucun rôle → 403 explicite', async () => {
    const r = await request(app).get('/api/metier').set('X-API-Key', CLE_SANS_ROLE);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SERVICE_ROLE_MANQUANT');
  });

  test('aucune identité du tout → 401 (comportement historique)', async () => {
    const r = await request(app).get('/api/metier');
    expect(r.status).toBe(401);
  });
});

describe('non-régression : le jeton humain se comporte exactement comme avant', () => {
  test('un Bearer ADMIN lit', async () => {
    const r = await request(app).get('/api/sensible/liste').set('Authorization', jetonHumain('ADMIN'));
    expect(r.status).toBe(200);
    expect(r.body.user.username).toBe('julien');
  });

  test('un Bearer ADMIN ÉCRIT (la garde de lecture seule ne le concerne pas)', async () => {
    const r = await request(app).post('/api/sensible/creer').set('Authorization', jetonHumain('ADMIN')).send({});
    expect(r.status).toBe(200);
    expect(r.body.ecrit).toBe(true);
  });

  test('le contrôle token_version reste actif sur un jeton humain', async () => {
    pool.query.mockImplementation((sql) => {
      if (/SELECT token_version FROM users/i.test(sql)) return Promise.resolve({ rows: [{ token_version: 7 }] });
      if (/FROM custom_roles|FROM settings/i.test(sql)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const r = await request(app).get('/api/metier').set('Authorization', jetonHumain('ADMIN'));
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('TOKEN_REVOKED');
  });

  test('un compte soumis à la MFA non franchie reste bloqué (requireMfa intact)', async () => {
    const r = await request(app).get('/api/sensible/liste')
      .set('Authorization', jetonHumain('ADMIN', { mfa: false }));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('MFA_REQUIRED');
  });

  test('un rôle insuffisant reste refusé', async () => {
    const r = await request(app).get('/api/metier').set('Authorization', jetonHumain('COLLABORATEUR'));
    expect(r.status).toBe(403);
  });

  test('le Bearer est PRIORITAIRE : un X-API-Key qui traîne ne change rien', async () => {
    const r = await request(app).post('/api/sensible/creer')
      .set('Authorization', jetonHumain('ADMIN'))
      .set('X-API-Key', CLE_SERVICE)
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.ecrit).toBe(true);
  });
});

describe('un humain ne peut pas se faire passer pour un service', () => {
  test('un jeton portant is_service:true n’obtient AUCUN privilège de service', async () => {
    // Le claim ne peut venir que de nous (le jeton est signé) ; on le neutralise
    // quand même de façon structurelle, pour qu'un bug d'émission futur ne
    // fabrique jamais une identité de service à partir d'une session humaine.
    const r = await request(app).get('/api/metier')
      .set('Authorization', jetonHumain('ADMIN', { is_service: true, api_key_id: 1 }));
    expect(r.status).toBe(200);
    expect(r.body.user.is_service).toBe(false);
  });

  test('… et il continue de pouvoir écrire comme l’humain qu’il est', async () => {
    // Contrôle symétrique : neutraliser le claim ne doit pas transformer un
    // ADMIN en identité en lecture seule.
    const r = await request(app).post('/api/metier')
      .set('Authorization', jetonHumain('ADMIN', { is_service: true }))
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.ecrit).toBe(true);
  });

  test('un jeton is_service:true n’est pas dispensé du contrôle de révocation', async () => {
    pool.query.mockImplementation((sql) => {
      if (/SELECT token_version FROM users/i.test(sql)) return Promise.resolve({ rows: [{ token_version: 9 }] });
      return Promise.resolve({ rows: [] });
    });
    const r = await request(app).get('/api/metier')
      .set('Authorization', jetonHumain('ADMIN', { is_service: true }));
    expect(r.status).toBe(401);
  });
});

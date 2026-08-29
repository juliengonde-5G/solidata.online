// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — DOUBLE AUTHENTIFICATION (MFA/TOTP), chantier 2.43.0
// ───────────────────────────────────────────────────────────────────────────
// Ce que ces tests verrouillent, dans l'ordre du parcours réel :
//   1. LOGIN — les trois embranchements : soumis+enrôlé (aucun jeton émis,
//      seulement un défi), soumis non enrôlé (jeton `mfa:false`), hors
//      périmètre (jeton `mfa:true` d'office) ;
//   2. VÉRIFICATION — code juste, code faux, verrou au 8e échec, code de
//      secours à USAGE UNIQUE ;
//   3. ENRÔLEMENT — setup (secret stocké CHIFFRÉ), activation (token_version
//      incrémenté PUIS jetons réémis — l'ordre inverse invaliderait le jeton
//      qu'on vient de délivrer), 8 codes de secours affichés une seule fois ;
//   4. requireMfa — un jeton hérité d'un rôle soumis est BLOQUÉ (403
//      MFA_REQUIRED), un rôle hors périmètre passe, un rôle PERSONNALISÉ est
//      soumis si son rôle de base l'est ;
//   5. REFRESH — le claim est RECALCULÉ, jamais recopié ;
//   6. RÉINITIALISATION ADMIN.
//
// Harnais maison du projet : auth réelle (vrais JWT), base mockée par un petit
// entrepôt en mémoire, activity-logger mocké.
// ═══════════════════════════════════════════════════════════════════════════
const JWT_SECRET = 'secret-de-test-mfa';
process.env.JWT_SECRET = JWT_SECRET;
process.env.MFA_ENCRYPTION_KEY = 'cle-de-test-mfa-dediee';

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const totpLib = require('../../src/utils/totp');
const { decryptSecret } = require('../../src/utils/mfa-crypto');
const { resetMfaRolesCache } = require('../../src/middleware/mfa');

const app = express();
app.use(express.json());
app.use('/api/auth', require('../../src/routes/auth'));
app.use('/api/users', require('../../src/routes/users'));

const MDP = 'motdepasse-solide';
const HASH = bcrypt.hashSync(MDP, 4); // coût réduit : on teste l'aiguillage, pas bcrypt

// ── Entrepôt en mémoire ─────────────────────────────────────────────────────
let db;
function resetDb() {
  db = {
    users: [
      { id: 1, username: 'admin', password_hash: HASH, role: 'ADMIN', email: 'a@x.fr',
        first_name: 'A', last_name: 'D', phone: null, team_id: null, is_active: true,
        token_version: 0, must_change_password: false,
        failed_login_count: 0, last_failed_login_at: null, locked_until: null,
        mfa_enabled: false, mfa_secret: null, mfa_enrolled_at: null, mfa_backup_codes: null,
        mfa_failed_count: 0, mfa_last_failed_at: null },
      { id: 2, username: 'collab', password_hash: HASH, role: 'COLLABORATEUR', email: null,
        first_name: 'C', last_name: 'L', phone: null, team_id: null, is_active: true,
        token_version: 0, must_change_password: false,
        failed_login_count: 0, last_failed_login_at: null, locked_until: null,
        mfa_enabled: false, mfa_secret: null, mfa_enrolled_at: null, mfa_backup_codes: null,
        mfa_failed_count: 0, mfa_last_failed_at: null },
      { id: 3, username: 'manager', password_hash: HASH, role: 'MANAGER', email: null,
        first_name: 'M', last_name: 'G', phone: null, team_id: null, is_active: true,
        token_version: 0, must_change_password: false,
        failed_login_count: 0, last_failed_login_at: null, locked_until: null,
        mfa_enabled: false, mfa_secret: null, mfa_enrolled_at: null, mfa_backup_codes: null,
        mfa_failed_count: 0, mfa_last_failed_at: null },
    ],
    refreshTokens: [],
    settings: {},
    customRoles: [],
  };
}
const user = (id) => db.users.find((u) => u.id === id);

// Dispatcher SQL : l'ordre compte (la requête la plus spécifique d'abord).
function dispatch(sql, params = []) {
  const q = String(sql).replace(/\s+/g, ' ').trim();

  if (/^SELECT token_version FROM users WHERE id/i.test(q)) {
    const u = user(params[0]);
    return { rows: u ? [{ token_version: u.token_version }] : [] };
  }
  if (/FROM custom_roles/i.test(q)) return { rows: db.customRoles };
  if (/SELECT value FROM settings WHERE key/i.test(q)) {
    const v = db.settings[params[0]];
    return { rows: v === undefined ? [] : [{ value: v }] };
  }
  if (/^SELECT \* FROM users WHERE username/i.test(q)) {
    const u = db.users.find((x) => x.username === params[0]);
    return { rows: u ? [u] : [] };
  }
  // Liste des comptes (GET /api/users) : la projection est APPLIQUÉE pour de
  // vrai — on lit les colonnes demandées par la requête. Si la route repassait
  // un jour en `SELECT *`, le mock rendrait tout et le test de non-exposition
  // du secret tomberait, comme il se doit.
  if (/^SELECT .* FROM users ORDER BY/i.test(q)) {
    const cols = q.slice(7, q.search(/ FROM users/i)).split(',').map((c) => {
      const t = c.trim();
      const alias = t.match(/\bAS\s+([a-z_]+)$/i);
      return alias ? alias[1] : t.split(/[\s.]/).pop();
    });
    return { rows: db.users.map((u) => Object.fromEntries(cols.map((c) => [c, u[c] ?? null]))) };
  }
  if (/FROM users WHERE id = \$1/i.test(q) && /^SELECT/i.test(q)) {
    const u = user(params[0]);
    return { rows: u ? [{ ...u }] : [] };
  }
  if (/FROM refresh_tokens rt JOIN users u/i.test(q)) {
    const rt = db.refreshTokens.find((r) => r.token === params[0]);
    if (!rt) return { rows: [] };
    const u = user(rt.user_id);
    return { rows: [{ ...u, ...rt, user_id: rt.user_id, rt_mfa: rt.mfa, u_mfa_enabled: u.mfa_enabled }] };
  }
  if (/^INSERT INTO refresh_tokens/i.test(q)) {
    db.refreshTokens.push({ user_id: params[0], token: params[1], expires_at: params[2], mfa: params[3] === true });
    return { rows: [] };
  }
  if (/^DELETE FROM refresh_tokens WHERE user_id/i.test(q)) {
    db.refreshTokens = db.refreshTokens.filter((r) => r.user_id !== Number(params[0]));
    return { rows: [] };
  }
  if (/^DELETE FROM refresh_tokens WHERE token/i.test(q)) {
    db.refreshTokens = db.refreshTokens.filter((r) => r.token !== params[0]);
    return { rows: [] };
  }
  if (/^INSERT INTO user_sessions/i.test(q) || /^UPDATE user_sessions/i.test(q)) return { rows: [] };

  if (/^UPDATE users SET/i.test(q)) {
    // On applique les mutations qui comptent pour le contrat, en s'appuyant sur
    // les colonnes citées par la requête.
    const id = Number(params[params.length - 1]);
    const u = user(id) || user(Number(params[0]));
    if (!u) return { rows: [] };
    if (/mfa_secret = \$1/i.test(q)) u.mfa_secret = params[0];
    if (/mfa_backup_codes = \$1::jsonb/i.test(q) && /mfa_enabled = true/i.test(q)) {
      u.mfa_backup_codes = JSON.parse(params[0]);
    } else if (/^UPDATE users SET mfa_backup_codes = \$1::jsonb/i.test(q)) {
      u.mfa_backup_codes = JSON.parse(params[0]);
    }
    if (/mfa_enabled = true/i.test(q)) { u.mfa_enabled = true; u.mfa_enrolled_at = new Date(); }
    if (/mfa_enabled = false/i.test(q)) {
      u.mfa_enabled = false; u.mfa_secret = null; u.mfa_backup_codes = null; u.mfa_enrolled_at = null;
    }
    if (/token_version = COALESCE\(token_version, 0\) \+ 1/i.test(q) || /token_version = token_version \+ 1/i.test(q)) {
      u.token_version = (u.token_version || 0) + 1;
    }
    if (/mfa_failed_count = \$1/i.test(q)) {
      u.mfa_failed_count = params[0];
      u.mfa_last_failed_at = new Date();
      if (params[1]) u.locked_until = params[1];
    } else if (/mfa_failed_count = 0/i.test(q)) {
      u.mfa_failed_count = 0; u.mfa_last_failed_at = null;
      if (/locked_until = NULL/i.test(q)) u.locked_until = null;
    }
    if (/failed_login_count = 0/i.test(q)) { u.failed_login_count = 0; u.locked_until = null; }
    if (/must_change_password = true/i.test(q)) u.must_change_password = true;
    return { rows: [{ ...u }] };
  }
  return { rows: [] };
}

beforeEach(() => {
  resetDb();
  resetMfaRolesCache();
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (sql, params) => dispatch(sql, params));
});

// ── Utilitaires ─────────────────────────────────────────────────────────────
const login = (username = 'admin', password = MDP) =>
  request(app).post('/api/auth/login').send({ username, password });
const claims = (token) => jwt.decode(token);

/** Enrôle un compte directement en base (raccourci pour les tests d'aval). */
function enroler(id) {
  const secret = totpLib.generateSecret();
  const u = user(id);
  u.mfa_enabled = true;
  u.mfa_secret = require('../../src/utils/mfa-crypto').encryptSecret(secret);
  u.mfa_backup_codes = totpLib.generateBackupCodes(8).map((c) => ({ hash: totpLib.hashBackupCode(c), used_at: null }));
  return secret;
}

// ════════════════════════════════════════════════════════════════════════════
describe('1. LOGIN — embranchement selon le rôle et l’enrôlement', () => {
  test('rôle soumis ET enrôlé : AUCUN jeton n’est émis, seulement un défi', async () => {
    const secret = enroler(1);
    const r = await login();
    expect(r.status).toBe(200);
    expect(r.body.mfa_required).toBe(true);
    expect(typeof r.body.mfa_challenge_token).toBe('string');
    // Le cœur de l'option retenue : rien d'exploitable ne circule avant le code.
    expect(r.body.accessToken).toBeUndefined();
    expect(r.body.refreshToken).toBeUndefined();
    expect(r.body.user).toBeUndefined();
    expect(db.refreshTokens).toHaveLength(0);
    // Le jeton de défi ne porte pas de rôle.
    const c = claims(r.body.mfa_challenge_token);
    expect(c.purpose).toBe('mfa');
    expect(c.role).toBeUndefined();
    expect(secret).toBeTruthy();
  });

  test('rôle soumis NON enrôlé : session complète mais claim mfa:false', async () => {
    const r = await login();
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    expect(claims(r.body.accessToken).mfa).toBe(false);
    expect(r.body.user.mfa_enrollment_required).toBe(true);
    expect(r.body.user.mfa_required).toBe(true);
    expect(r.body.user.mfa_enabled).toBe(false);
    expect(db.refreshTokens[0].mfa).toBe(false);
  });

  test('rôle HORS périmètre : login normal, claim mfa:true d’office', async () => {
    for (const nom of ['collab', 'manager']) {
      resetDb(); resetMfaRolesCache();
      const r = await login(nom);
      expect(r.status).toBe(200);
      expect(claims(r.body.accessToken).mfa).toBe(true);
      expect(r.body.user.mfa_required).toBe(false);
      expect(r.body.user.mfa_enrollment_required).toBe(false);
    }
  });

  test('la liste des rôles soumis est paramétrable (securite.mfa_roles)', async () => {
    db.settings['securite.mfa_roles'] = JSON.stringify(['MANAGER']);
    resetMfaRolesCache();
    const rAdmin = await login('admin');
    expect(claims(rAdmin.body.accessToken).mfa).toBe(true);       // ADMIN retiré de la liste
    const rMgr = await login('manager');
    expect(claims(rMgr.body.accessToken).mfa).toBe(false);        // MANAGER ajouté
    expect(rMgr.body.user.mfa_enrollment_required).toBe(true);
  });

  test('un mot de passe faux ne délivre AUCUN défi', async () => {
    enroler(1);
    const r = await login('admin', 'mauvais');
    expect(r.status).toBe(401);
    expect(r.body.mfa_challenge_token).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('2. VÉRIFICATION du code', () => {
  test('code TOTP juste → session complète avec claim mfa:true', async () => {
    const secret = enroler(1);
    const defi = (await login()).body.mfa_challenge_token;
    const r = await request(app).post('/api/auth/mfa/verify')
      .send({ mfa_challenge_token: defi, code: totpLib.totp(secret) });

    expect(r.status).toBe(200);
    expect(claims(r.body.accessToken).mfa).toBe(true);
    expect(r.body.user.mfa_enabled).toBe(true);
    expect(r.body.user.mfa_enrollment_required).toBe(false);
    expect(db.refreshTokens[0].mfa).toBe(true);
  });

  test('code faux → 401 MFA_CODE_INVALID, sans jeton', async () => {
    enroler(1);
    const defi = (await login()).body.mfa_challenge_token;
    const r = await request(app).post('/api/auth/mfa/verify')
      .send({ mfa_challenge_token: defi, code: '000000' });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('MFA_CODE_INVALID');
    expect(r.body.accessToken).toBeUndefined();
  });

  test('8 codes faux → verrou temporaire (429)', async () => {
    enroler(1);
    const defi = (await login()).body.mfa_challenge_token;
    const statuts = [];
    for (let i = 0; i < 8; i++) {
      const r = await request(app).post('/api/auth/mfa/verify')
        .send({ mfa_challenge_token: defi, code: '000000' });
      statuts.push(r.status);
    }
    expect(statuts.slice(0, 7)).toEqual(Array(7).fill(401));
    expect(statuts[7]).toBe(429);                       // le 8e verrouille
    expect(user(1).locked_until).toBeTruthy();

    // Verrou effectif : même un code JUSTE est refusé tant qu'il dure.
    const secret = decryptSecret(user(1).mfa_secret);
    const r = await request(app).post('/api/auth/mfa/verify')
      .send({ mfa_challenge_token: defi, code: totpLib.totp(secret) });
    expect(r.status).toBe(429);
  });

  test('une réussite remet le compteur d’échecs à zéro', async () => {
    const secret = enroler(1);
    const defi = (await login()).body.mfa_challenge_token;
    await request(app).post('/api/auth/mfa/verify').send({ mfa_challenge_token: defi, code: '000000' });
    expect(user(1).mfa_failed_count).toBe(1);
    await request(app).post('/api/auth/mfa/verify').send({ mfa_challenge_token: defi, code: totpLib.totp(secret) });
    expect(user(1).mfa_failed_count).toBe(0);
  });

  test('code de secours : accepté UNE fois, puis jamais plus', async () => {
    enroler(1);
    // On refabrique un lot dont on connaît le clair.
    const codes = totpLib.generateBackupCodes(8);
    user(1).mfa_backup_codes = codes.map((c) => ({ hash: totpLib.hashBackupCode(c), used_at: null }));

    const defi1 = (await login()).body.mfa_challenge_token;
    const r1 = await request(app).post('/api/auth/mfa/verify')
      .send({ mfa_challenge_token: defi1, code: codes[0] });
    expect(r1.status).toBe(200);
    expect(r1.body.backup_code_used).toBe(true);
    expect(r1.body.backup_codes_restants).toBe(7);
    expect(claims(r1.body.accessToken).mfa).toBe(true);

    // Rejeu du MÊME code : refusé (marqué consommé).
    const defi2 = (await login()).body.mfa_challenge_token;
    const r2 = await request(app).post('/api/auth/mfa/verify')
      .send({ mfa_challenge_token: defi2, code: codes[0] });
    expect(r2.status).toBe(401);

    // Un AUTRE code du lot fonctionne toujours, et la casse importe peu.
    const defi3 = (await login()).body.mfa_challenge_token;
    const r3 = await request(app).post('/api/auth/mfa/verify')
      .send({ mfa_challenge_token: defi3, code: codes[1].toLowerCase() });
    expect(r3.status).toBe(200);
    expect(r3.body.backup_codes_restants).toBe(6);
  });

  test('jeton de défi absent, illisible ou expiré → 401', async () => {
    enroler(1);
    const expire = jwt.sign({ id: 1, purpose: 'mfa', tv: 0 }, JWT_SECRET, { expiresIn: '-1s' });
    for (const jeton of ['', 'pas-un-jwt', expire]) {
      const r = await request(app).post('/api/auth/mfa/verify')
        .send({ mfa_challenge_token: jeton, code: '123456' });
      expect([400, 401]).toContain(r.status);
      expect(r.body.accessToken).toBeUndefined();
    }
  });

  test('un jeton d’accès ordinaire ne peut pas servir de défi', async () => {
    // Le défi doit porter purpose:'mfa' : un JWT de session, même valide, est refusé.
    const acces = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', tv: 0, mfa: true }, JWT_SECRET, { expiresIn: '1h' });
    const r = await request(app).post('/api/auth/mfa/verify').send({ mfa_challenge_token: acces, code: '123456' });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('MFA_CHALLENGE_INVALID');
  });

  test('le jeton de défi ne vaut PAS jeton d’accès (aucun détournement)', async () => {
    enroler(1);
    const defi = (await login()).body.mfa_challenge_token;
    // /auth/me et surtout /auth/password doivent le refuser : sinon quelqu'un
    // ayant le mot de passe changerait celui-ci sans franchir le second facteur.
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${defi}`);
    expect(me.status).toBe(401);
    expect(me.body.code).toBe('MFA_CHALLENGE_INVALID');
    const pwd = await request(app).put('/api/auth/password')
      .set('Authorization', `Bearer ${defi}`)
      .send({ currentPassword: MDP, newPassword: 'nouveau-mot-de-passe' });
    expect(pwd.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('3. ENRÔLEMENT', () => {
  const jetonNonEnrole = () => jwt.sign(
    { id: 1, username: 'admin', role: 'ADMIN', tv: 0, mfa: false }, JWT_SECRET, { expiresIn: '1h' });

  test('setup : QR + secret, stocké CHIFFRÉ et jamais en clair', async () => {
    const r = await request(app).post('/api/auth/mfa/setup')
      .set('Authorization', `Bearer ${jetonNonEnrole()}`).send({});
    expect(r.status).toBe(200);
    expect(r.body.otpauth_url).toMatch(/^otpauth:\/\/totp\/SOLIDATA%3Aadmin\?secret=/);
    expect(r.body.otpauth_url).toContain('algorithm=SHA1');
    expect(r.body.otpauth_url).toContain('digits=6');
    expect(r.body.otpauth_url).toContain('period=30');
    expect(r.body.qr_data_url).toMatch(/^data:image\/png;base64,/);
    expect(r.body.secret_base32).toMatch(/^[A-Z2-7]+$/);

    // En base : chiffré, relisible, et l'activation reste à faire.
    expect(user(1).mfa_secret).toMatch(/^mfaenc:v1:/);
    expect(user(1).mfa_secret).not.toContain(r.body.secret_base32);
    expect(decryptSecret(user(1).mfa_secret)).toBe(r.body.secret_base32);
    expect(user(1).mfa_enabled).toBe(false);
  });

  test('setup refusé si la double authentification est DÉJÀ active (passer par le reset ADMIN)', async () => {
    enroler(1);
    const jeton = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', tv: 0, mfa: true }, JWT_SECRET, { expiresIn: '1h' });
    const r = await request(app).post('/api/auth/mfa/setup').set('Authorization', `Bearer ${jeton}`).send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('MFA_ALREADY_ENABLED');
  });

  test('activate : active, rend 8 codes de secours, et réémet des jetons UTILISABLES', async () => {
    const setup = await request(app).post('/api/auth/mfa/setup')
      .set('Authorization', `Bearer ${jetonNonEnrole()}`).send({});
    const secret = setup.body.secret_base32;

    const r = await request(app).post('/api/auth/mfa/activate')
      .set('Authorization', `Bearer ${jetonNonEnrole()}`)
      .send({ code: totpLib.totp(secret) });

    expect(r.status).toBe(200);
    expect(user(1).mfa_enabled).toBe(true);
    expect(r.body.backup_codes).toHaveLength(8);
    r.body.backup_codes.forEach((c) => expect(c).toMatch(totpLib.BACKUP_CODE_REGEX));
    // Les codes ne sont stockés que hachés.
    expect(user(1).mfa_backup_codes.every((e) => /^[0-9a-f]{64}$/.test(e.hash) && e.used_at === null)).toBe(true);

    // ORDRE CRITIQUE : token_version incrémenté PUIS jetons émis. Le jeton rendu
    // doit porter la NOUVELLE version — sinon il serait mort-né.
    expect(user(1).token_version).toBe(1);
    const c = claims(r.body.accessToken);
    expect(c.tv).toBe(1);
    expect(c.mfa).toBe(true);
    expect(r.body.user.mfa_enrollment_required).toBe(false);

    // Et il ouvre effectivement les surfaces protégées.
    const users = await request(app).get('/api/users').set('Authorization', `Bearer ${r.body.accessToken}`);
    expect(users.status).toBe(200);

    // Le jeton de renouvellement rendu est bien celui qui est en base.
    expect(db.refreshTokens).toHaveLength(1);
    expect(db.refreshTokens[0].token).toBe(r.body.refreshToken);
    expect(db.refreshTokens[0].mfa).toBe(true);
  });

  test('activate avec un code faux : rien n’est activé', async () => {
    await request(app).post('/api/auth/mfa/setup').set('Authorization', `Bearer ${jetonNonEnrole()}`).send({});
    const r = await request(app).post('/api/auth/mfa/activate')
      .set('Authorization', `Bearer ${jetonNonEnrole()}`).send({ code: '000000' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('MFA_CODE_INVALID');
    expect(user(1).mfa_enabled).toBe(false);
    expect(user(1).token_version).toBe(0);
  });

  test('activate sans setup préalable → 400 explicite', async () => {
    const r = await request(app).post('/api/auth/mfa/activate')
      .set('Authorization', `Bearer ${jetonNonEnrole()}`).send({ code: '123456' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('MFA_SETUP_REQUIRED');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('4. requireMfa — fermeture effective des surfaces sensibles', () => {
  test('jeton HÉRITÉ (sans claim mfa) d’un rôle soumis → 403 MFA_REQUIRED', async () => {
    const herite = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', tv: 0 }, JWT_SECRET, { expiresIn: '1h' });
    const r = await request(app).get('/api/users').set('Authorization', `Bearer ${herite}`);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('MFA_REQUIRED');
  });

  test('jeton mfa:false (enrôlement en cours) → 403 MFA_REQUIRED', async () => {
    const jeton = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', tv: 0, mfa: false }, JWT_SECRET, { expiresIn: '1h' });
    const r = await request(app).get('/api/users').set('Authorization', `Bearer ${jeton}`);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('MFA_REQUIRED');
  });

  test('jeton mfa:true → passe', async () => {
    const jeton = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', tv: 0, mfa: true }, JWT_SECRET, { expiresIn: '1h' });
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${jeton}`)).status).toBe(200);
  });

  test('un rôle PERSONNALISÉ hérite du périmètre de son rôle de base', async () => {
    // Dupliquer « RH » ne doit pas offrir un contournement de la double
    // authentification : c'est le rôle de BASE qui décide.
    db.customRoles = [{ role_key: 'CR_CIP', base_role: 'RH' }];
    await require('../../src/middleware/auth').refreshCustomRoles();
    const { isMfaRole } = require('../../src/middleware/mfa');
    expect(isMfaRole('CR_CIP')).toBe(true);
    expect(isMfaRole('CR_INCONNU')).toBe(false); // sans correspondance → son propre nom
    db.customRoles = [{ role_key: 'CR_CHEF', base_role: 'MANAGER' }];
    await require('../../src/middleware/auth').refreshCustomRoles();
    expect(isMfaRole('CR_CHEF')).toBe(false);
  });

  test('décision du handshake Socket.IO : la même porte que le HTTP', async () => {
    // PÉRIMÈTRE DE CE TEST : la DÉCISION (`isMfaRole(role) && mfa !== true`),
    // pas le câblage dans index.js — aucun harnais du projet ne démarre le
    // serveur temps réel, et le vérifier ici demanderait de recopier le code du
    // handshake, ce qui ne prouverait rien. Le câblage lui-même est une ligne,
    // relue, placée AVANT le contrôle de révocation (qui sort par `next()` sur
    // un jeton hérité — la population que la garde vise justement à refuser).
    const { isMfaRole } = require('../../src/middleware/mfa');
    const refuse = (jetonDecode) => isMfaRole(jetonDecode.role) && jetonDecode.mfa !== true;

    expect(refuse({ role: 'ADMIN' })).toBe(true);                    // jeton hérité, sans claim
    expect(refuse({ role: 'ADMIN', mfa: false })).toBe(true);        // enrôlement en cours
    expect(refuse({ role: 'ADMIN', mfa: true })).toBe(false);        // défi franchi
    expect(refuse({ role: 'RH' })).toBe(true);
    expect(refuse({ role: 'MANAGER' })).toBe(false);                 // hors périmètre
    // Jeton chauffeur (`driver-start`) : rôle COLLABORATEUR en dur, jamais de
    // claim `mfa` — le mobile ne doit surtout pas être fermé par cette garde.
    expect(refuse({ role: 'COLLABORATEUR', username: 'driver_12', vehicle_id: 12 })).toBe(false);
  });

  test('les rôles par défaut sont ADMIN, RH, DPO et PCM — et personne d’autre', async () => {
    const { getMfaRoles, isMfaRole } = require('../../src/middleware/mfa');
    resetMfaRolesCache();
    expect(await getMfaRoles()).toEqual(['ADMIN', 'RH', 'DPO', 'PCM']);
    for (const r of ['ADMIN', 'RH', 'DPO', 'PCM']) expect(isMfaRole(r)).toBe(true);
    for (const r of ['MANAGER', 'COLLABORATEUR', 'AUTORITE', 'RESP_BTQ', 'FINANCE', 'QHSE']) {
      expect(isMfaRole(r)).toBe(false);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('5. REFRESH — le claim est RECALCULÉ, jamais recopié', () => {
  async function sessionVerifiee() {
    const secret = enroler(1);
    const defi = (await login()).body.mfa_challenge_token;
    const r = await request(app).post('/api/auth/mfa/verify')
      .send({ mfa_challenge_token: defi, code: totpLib.totp(secret) });
    return r.body.refreshToken;
  }

  test('une session ayant franchi le défi conserve mfa:true', async () => {
    const rt = await sessionVerifiee();
    const r = await request(app).post('/api/auth/refresh').send({ refreshToken: rt });
    expect(r.status).toBe(200);
    expect(claims(r.body.accessToken).mfa).toBe(true);
    expect(db.refreshTokens.find((x) => x.token === r.body.refreshToken).mfa).toBe(true);
  });

  test('si un ADMIN réinitialise la MFA entre-temps, le refresh retombe à mfa:false', async () => {
    const rt = await sessionVerifiee();
    user(1).mfa_enabled = false;               // réinitialisation côté administrateur
    const r = await request(app).post('/api/auth/refresh').send({ refreshToken: rt });
    expect(r.status).toBe(200);
    expect(claims(r.body.accessToken).mfa).toBe(false);
  });

  test('une session mfa:false ne devient jamais mfa:true par simple refresh', async () => {
    const rt = (await login()).body.refreshToken;   // ADMIN non enrôlé
    user(1).mfa_enabled = true;                     // enrôlé ailleurs, pas sur CETTE session
    const r = await request(app).post('/api/auth/refresh').send({ refreshToken: rt });
    expect(claims(r.body.accessToken).mfa).toBe(false);
  });

  test('un rôle sorti du périmètre récupère mfa:true au refresh', async () => {
    const rt = (await login()).body.refreshToken;
    db.settings['securite.mfa_roles'] = JSON.stringify(['DPO']);
    resetMfaRolesCache();
    const r = await request(app).post('/api/auth/refresh').send({ refreshToken: rt });
    expect(claims(r.body.accessToken).mfa).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('6. RÉINITIALISATION par un administrateur', () => {
  const jetonAdmin = () => jwt.sign(
    { id: 1, username: 'admin', role: 'ADMIN', tv: 0, mfa: true }, JWT_SECRET, { expiresIn: '1h' });

  test('reset-mfa remet le compte à « non enrôlé » et coupe ses sessions', async () => {
    enroler(2);
    user(2).role = 'RH';
    db.refreshTokens.push({ user_id: 2, token: 'rt-de-la-cible', expires_at: new Date(Date.now() + 1e6), mfa: true });
    const tvAvant = user(2).token_version;

    const r = await request(app).put('/api/users/2/reset-mfa').set('Authorization', `Bearer ${jetonAdmin()}`).send({});
    expect(r.status).toBe(200);
    expect(r.body.message).toMatch(/réinitialis/i);

    expect(user(2).mfa_enabled).toBe(false);
    expect(user(2).mfa_secret).toBeNull();
    expect(user(2).mfa_backup_codes).toBeNull();
    expect(user(2).mfa_enrolled_at).toBeNull();
    expect(user(2).mfa_failed_count).toBe(0);
    // Révocation immédiate : sans le bump, une session « mfa:true » ouverte
    // avant la réinitialisation resterait valide jusqu'à 8 h.
    expect(user(2).token_version).toBe(tvAvant + 1);
    expect(db.refreshTokens.filter((x) => x.user_id === 2)).toHaveLength(0);
  });

  test('reset-mfa sur un identifiant inconnu → 404', async () => {
    const r = await request(app).put('/api/users/999/reset-mfa').set('Authorization', `Bearer ${jetonAdmin()}`).send({});
    expect(r.status).toBe(404);
  });

  test('reset-mfa est réservé à l’ADMIN', async () => {
    const rh = jwt.sign({ id: 2, username: 'rh', role: 'RH', tv: 0, mfa: true }, JWT_SECRET, { expiresIn: '1h' });
    expect((await request(app).put('/api/users/1/reset-mfa').set('Authorization', `Bearer ${rh}`).send({})).status).toBe(403);
  });

  test('la liste des comptes expose mfa_enabled — jamais le secret ni les codes', async () => {
    enroler(1);
    const r = await request(app).get('/api/users').set('Authorization', `Bearer ${jetonAdmin()}`);
    expect(r.status).toBe(200);
    const ligne = r.body.find((u) => u.id === 1);
    expect(ligne).toHaveProperty('mfa_enabled');
    expect(ligne).not.toHaveProperty('mfa_secret');
    expect(ligne).not.toHaveProperty('mfa_backup_codes');
    expect(ligne).not.toHaveProperty('password_hash');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('7. GET /auth/me — drapeaux consommés par l’écran d’enrôlement', () => {
  test('rôle soumis non enrôlé : mfa_enrollment_required = true', async () => {
    const jeton = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', tv: 0, mfa: false }, JWT_SECRET, { expiresIn: '1h' });
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jeton}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mfa_enabled: false, mfa_required: true, mfa_enrollment_required: true });
    expect(r.body.base_role).toBe('ADMIN');
  });

  test('rôle hors périmètre : aucun enrôlement réclamé', async () => {
    const jeton = jwt.sign({ id: 3, username: 'manager', role: 'MANAGER', tv: 0, mfa: true }, JWT_SECRET, { expiresIn: '1h' });
    const r = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${jeton}`);
    expect(r.body).toMatchObject({ mfa_required: false, mfa_enrollment_required: false });
  });
});

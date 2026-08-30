// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — double authentification sur /api/chat et /api/messages
// ───────────────────────────────────────────────────────────────────────────
// CE QUE CES TESTS FERMENT
//
// Avant ce lot, /api/chat était le SEUL point d'accès aux synthèses de pilotage
// à n'être pas gardé par `requireMfa`. Un compte ADMIN ou RH soumis à la double
// authentification mais NON ENROLÉ (claim `mfa: false`) recevait 403 sur
// /api/employees, /api/insertion, /api/effectifs, /api/rgpd… et obtenait par la
// conversation des agrégats que ces mêmes routeurs lui fermaient.
//
// Ce fichier fixe donc le comportement dans LES DEUX SENS, parce qu'une garde
// qui ferme trop est un incident aussi sûrement qu'une garde qui ne ferme pas :
//   • un rôle SOUMIS non enrôlé est refusé (403 MFA_REQUIRED) ;
//   • un rôle soumis ENRÔLÉ passe ;
//   • un rôle HORS PÉRIMÈTRE passe SANS AVOIR BESOIN du claim — MANAGER, QHSE,
//     FINANCE, RESP_BTQ, AUTORITE, et surtout les JETONS CHAUFFEUR, dont le rôle
//     est COLLABORATEUR en dur et dont le mobile est la surface qu'il ne faut
//     surtout pas fermer.
//
// La preuve « ça passe » est ici un 503 « IA non configurée » : la clé Anthropic
// est délibérément absente, donc franchir la garde MENE au refus SUIVANT. Un 503
// démontre mieux qu'un 200 que la requête a dépassé le contrôle d'accès.
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
delete process.env.ANTHROPIC_API_KEY;

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const mockQuery = jest.fn();
const mockClient = { query: (...a) => mockQuery(...a), release: jest.fn() };
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => mockClient),
}));

const express = require('express');
const request = require('supertest');

const { resetMfaRolesCache, DEFAULT_MFA_ROLES } = require('../../src/middleware/mfa');

// `mfa` volontairement omis quand il doit l'être : c'est le cas « jeton hérité ».
const jeton = (props) => jwt.sign({ id: 1, username: 'u', first_name: 'T', last_name: 'U', ...props },
  JWT_SECRET, { expiresIn: '1h' });

const ADMIN_ENROLE = jeton({ role: 'ADMIN', mfa: true, mfa_at: Math.floor(Date.now() / 1000) });
const ADMIN_NON_ENROLE = jeton({ role: 'ADMIN', mfa: false });
const ADMIN_JETON_HERITE = jeton({ role: 'ADMIN' }); // émis avant 2.43.0 : pas de claim
const RH_NON_ENROLE = jeton({ role: 'RH', mfa: false });
const DPO_NON_ENROLE = jeton({ role: 'DPO', mfa: false });
// Rôles HORS périmètre : aucun claim `mfa`, et c'est le cas nominal.
const MANAGER = jeton({ role: 'MANAGER' });
const QHSE = jeton({ role: 'QHSE' });
const COLLABORATEUR = jeton({ id: 3, role: 'COLLABORATEUR' });
// Jeton chauffeur : compte générique PARTAGÉ, identité réelle = le véhicule.
const CHAUFFEUR = jwt.sign(
  { id: 5, userId: 5, username: 'driver_1', role: 'COLLABORATEUR', vehicle_id: 1 },
  JWT_SECRET, { expiresIn: '1h' });

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/chat', require('../../src/routes/chat'));
  app.use('/api/messages', require('../../src/routes/messages'));
});

beforeEach(() => {
  mockQuery.mockReset();
  // Aucune ligne en `settings` → la liste des rôles soumis retombe sur le
  // défaut EN CODE (ADMIN/RH/DPO), qui est ce que ces tests décrivent.
  mockQuery.mockResolvedValue({ rows: [] });
  resetMfaRolesCache();
});

const post = (t, url, body) => request(app).post(url).set('Authorization', `Bearer ${t}`).send(body || {});
const get = (t, url) => request(app).get(url).set('Authorization', `Bearer ${t}`);

describe('/api/chat — la double authentification est exigée des rôles soumis', () => {
  it('le défaut en code est bien ADMIN/RH/DPO', () => {
    expect(DEFAULT_MFA_ROLES).toEqual(expect.arrayContaining(['ADMIN', 'RH', 'DPO']));
    expect(DEFAULT_MFA_ROLES).not.toContain('MANAGER');
    expect(DEFAULT_MFA_ROLES).not.toContain('COLLABORATEUR');
  });

  it('ADMIN non enrôlé → 403 MFA_REQUIRED (le contournement est fermé)', async () => {
    const res = await post(ADMIN_NON_ENROLE, '/api/chat', { message: 'Résume la finance' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_REQUIRED');
  });

  it('RH non enrôlé → 403', async () => {
    const res = await post(RH_NON_ENROLE, '/api/chat', { message: 'Où en est la cohorte ?' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_REQUIRED');
  });

  it('DPO non enrôlé → 403', async () => {
    const res = await post(DPO_NON_ENROLE, '/api/chat', { message: 'Les purges ont-elles tourné ?' });
    expect(res.status).toBe(403);
  });

  it("jeton ADMIN HÉRITÉ (sans claim mfa) → 403 : c'est l'écart assumé de mfa.js", async () => {
    const res = await post(ADMIN_JETON_HERITE, '/api/chat', { message: 'bonjour' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_REQUIRED');
  });

  it('la garde couvre AUSSI les autres routes du routeur, pas seulement POST /', async () => {
    const suggestions = await get(ADMIN_NON_ENROLE, '/api/chat/suggestions');
    expect(suggestions.status).toBe(403);
    const historique = await get(ADMIN_NON_ENROLE, '/api/chat/history');
    expect(historique.status).toBe(403);
  });

  it('ADMIN enrôlé → passe la garde (refusé plus loin, faute de clé IA)', async () => {
    const res = await post(ADMIN_ENROLE, '/api/chat', { message: 'Résume la finance' });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(503);
    const sug = await get(ADMIN_ENROLE, '/api/chat/suggestions');
    expect(sug.status).toBe(200);
  });
});

describe('/api/chat — NON-RÉGRESSION des rôles hors périmètre (sans claim mfa)', () => {
  it.each([
    ['MANAGER', MANAGER],
    ['QHSE', QHSE],
    ['COLLABORATEUR', COLLABORATEUR],
  ])('%s passe la garde sans avoir enrôlé quoi que ce soit', async (_role, token) => {
    const res = await post(token, '/api/chat', { message: 'Quel est le stock ?' });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(503); // franchi la garde → bloqué par l'absence de clé IA
  });

  it("le JETON CHAUFFEUR garde l'assistant du parcours mobile", async () => {
    const res = await post(CHAUFFEUR, '/api/chat', { message: 'Ma tournée ?' });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(503);
    const sug = await get(CHAUFFEUR, '/api/chat/suggestions');
    expect(sug.status).toBe(200);
  });

  it('un rôle non soumis conserve ses suggestions', async () => {
    const res = await get(MANAGER, '/api/chat/suggestions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
  });
});

describe('/api/messages — même garde (le bot y passe par le même chemin)', () => {
  it('ADMIN non enrôlé → 403 sur la messagerie', async () => {
    const res = await get(ADMIN_NON_ENROLE, '/api/messages/non-lus');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_REQUIRED');
  });

  it("ADMIN non enrôlé ne peut pas non plus écrire au bot par la messagerie", async () => {
    const res = await post(ADMIN_NON_ENROLE, '/api/messages/conversations/1/messages', { texte: 'coucou' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_REQUIRED');
  });

  it('ADMIN enrôlé → passe (la messagerie répond)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await get(ADMIN_ENROLE, '/api/messages/non-lus');
    expect(res.status).not.toBe(403);
  });

  it('le CHAUFFEUR continue de messager (identité véhicule, rôle hors périmètre)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await get(CHAUFFEUR, '/api/messages/non-lus');
    expect(res.status).not.toBe(403);
  });

  it('MANAGER continue de messager sans claim mfa', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await get(MANAGER, '/api/messages/non-lus');
    expect(res.status).not.toBe(403);
  });
});

describe('la garde suit le RÔLE DE BASE (rôles personnalisés)', () => {
  it("un rôle personnalisé dérivé de RH est soumis comme RH : dupliquer « RH » ne contourne rien", async () => {
    // `custom_roles` est lu par le cache de middleware/auth : on le réamorce
    // avec un rôle « Opérations » de base RH.
    mockQuery.mockResolvedValue({ rows: [{ role_key: 'OPERATIONS', base_role: 'RH' }] });
    await require('../../src/middleware/auth').refreshCustomRoles();
    resetMfaRolesCache();
    mockQuery.mockResolvedValue({ rows: [] });

    const custom = jeton({ role: 'OPERATIONS', mfa: false });
    const res = await post(custom, '/api/chat', { message: 'Où en est la cohorte ?' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_REQUIRED');

    // Remise à zéro du cache pour ne pas imposer ce rôle aux suites suivantes.
    mockQuery.mockResolvedValue({ rows: [] });
    await require('../../src/middleware/auth').refreshCustomRoles();
  });
});

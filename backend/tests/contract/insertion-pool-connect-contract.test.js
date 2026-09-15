// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — `pool.connect()` DANS le `try` (correctif M-02, PR D)
// ───────────────────────────────────────────────────────────────────────────
// Huit handlers transactionnels de `routes/insertion/routes.js` prenaient leur
// connexion AVANT le `try`. Quand `pool.connect()` rejette — pool saturé,
// `53300 remaining connection slots are reserved` —, la promesse du handler est
// rejetée HORS de tout try/catch. Express 4 ne capture pas le rejet d'un
// gestionnaire `async`, aucun `process.on('unhandledRejection')` n'existe dans
// le dépôt, et Node ≥ 15 TERMINE le processus : ce n'est pas une requête
// pendante, c'est l'arrêt du backend. La PR D rend d'ailleurs l'épuisement plus
// probable — chaque ouverture de `/insertion/audit` déclenche désormais une
// vingtaine de requêtes de plus.
//
// La règle est écrite au contrat (§ 2.5) depuis la PR A, où elle a été corrigée
// une première fois ; retrouvée en PR B ; `routes.js` ne l'avait jamais reçue.
// Le trou de couverture comblé en PR B pour `temps.js` est comblé ici pour les
// deux handlers PMSMP que la PR D rouvre.
//
// Ce que ces tests mesurent : une réponse ARRIVE, et elle dit 500. Sans le
// correctif, `supertest` attend son propre délai puis échoue sur un socket
// fermé, et le processus de test meurt sur un rejet non géré.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.PCM_ENCRYPTION_KEY = process.env.PCM_ENCRYPTION_KEY || 'test-pcm-key-0123456789abcdef';

const mockQuery = jest.fn();
const mockConnect = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

let app;
const token = jwt.sign(
  { id: 9, username: 'u', role: 'ADMIN', first_name: 'T', last_name: 'U', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' }
);

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
});

/** Client de transaction ordinaire — utilisé pour le cas nominal. */
const clientOk = () => ({ query: (...a) => mockQuery(...a), release: jest.fn() });

const panne = () => mockConnect.mockImplementationOnce(() => Promise.reject(
  Object.assign(new Error('remaining connection slots are reserved'), { code: '53300' })
));

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockConnect.mockImplementation(async () => clientOk());
  mockQuery.mockResolvedValue({ rows: [] });
});

const post = (url, body) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body);
const put = (url, body) => request(app).put(url).set('Authorization', `Bearer ${token}`).send(body);

const PMSMP = {
  employee_id: 7, entreprise: 'Atelier Nord', objet: 'decouvrir_metier',
  date_debut: '2026-03-02', date_fin: '2026-03-13',
};

describe('M-02 — une connexion indisponible rend 500 au lieu de tuer le processus', () => {
  it('POST /pmsmp', async () => {
    panne();
    const r = await post('/api/insertion/pmsmp', PMSMP);
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('Erreur serveur');
  });

  it('PUT /pmsmp/:id', async () => {
    panne();
    const r = await put('/api/insertion/pmsmp/12', { tuteur: 'M. Durand' });
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('Erreur serveur');
  });

  it("aucune connexion n'est demandée deux fois, ni rendue sans avoir été prise", async () => {
    panne();
    await post('/api/insertion/pmsmp', PMSMP);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('le ROLLBACK du `catch` ne s’exécute pas sur une connexion qui n’existe pas', async () => {
    panne();
    await post('/api/insertion/pmsmp', PMSMP);
    // Aucun `client.query('ROLLBACK')` : il n'y a pas de client. Un `catch` qui
    // appellerait `client.query` sur `undefined` relancerait une TypeError
    // depuis le `catch` lui-même, ce qui remettrait le processus en danger.
    const sqls = mockQuery.mock.calls.map(([s]) => String(s));
    expect(sqls.filter((s) => /ROLLBACK/.test(s))).toHaveLength(0);
  });

  it('la connexion est bien RENDUE quand elle a pu être prise (pas de fuite de pool)', async () => {
    const client = clientOk();
    mockConnect.mockImplementationOnce(async () => client);
    // Salarié introuvable → 404 : le chemin le plus court après la prise.
    mockQuery.mockResolvedValue({ rows: [] });
    const r = await post('/api/insertion/pmsmp', PMSMP);
    expect(r.status).toBe(404);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

// ── Garde statique : la règle vaut pour TOUS les handlers du fichier ────────
describe('garde statique — plus aucun `pool.connect()` hors du try dans routes.js', () => {
  it('le motif fautif a disparu du fichier', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'routes', 'insertion', 'routes.js'), 'utf8'
    );
    // Le motif fautif est reconnaissable à l'œil : une affectation `const
    // client = await pool.connect();` suivie du `try`. Le motif correct déclare
    // `let client;` PUIS prend la connexion à l'intérieur.
    expect(src).not.toMatch(/const client = await pool\.connect\(\);\s*\n\s*try \{/);
    expect(src.match(/client = await pool\.connect\(\);/g) || []).toHaveLength(8);
    expect(src.match(/if \(client\) client\.release\(\);/g) || []).toHaveLength(8);
  });
});

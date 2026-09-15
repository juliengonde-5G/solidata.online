// ═══════════════════════════════════════════════════════════════════════════
// REVUE DE SÉCURITÉ PR A — vérifications de PÉRIMÈTRE qui doivent rester
// vertes. Ces tests-là NE reproduisent PAS un défaut : ils verrouillent ce qui
// est bien fait, pour qu'un correctif des constats C-01..C-04 ne l'abîme pas.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

let app; let appExports;
const tok = (extra) => jwt.sign(
  { id: 3, username: 'u', first_name: 'A', last_name: 'B', mfa: true, mfa_at: Math.floor(Date.now() / 1000), ...extra },
  JWT_SECRET, { expiresIn: '1h' }
);

// Jetons hors périmètre : rôles intégrés qui ne doivent joindre AUCUNE route
// d'insertion, et le jeton chauffeur (qui porte COLLABORATEUR EN DUR).
const HORS_PERIMETRE = {
  COMMUNICATION: tok({ role: 'COMMUNICATION' }),
  AUTORITE: tok({ role: 'AUTORITE' }),
  DPO: tok({ role: 'DPO' }),
  QHSE: tok({ role: 'QHSE' }),
  COLLABORATEUR: tok({ role: 'COLLABORATEUR' }),
  CHAUFFEUR: tok({ role: 'COLLABORATEUR', username: 'driver_12', vehicle_id: 12 }),
};

beforeAll(() => {
  app = express(); app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
  appExports = express(); appExports.use(express.json());
  appExports.use('/api/exports', require('../../src/routes/exports-fse'));
});

beforeEach(() => { mockQuery.mockReset(); mockQuery.mockResolvedValue({ rows: [] }); });

const ROUTES_INSERTION = [
  '/api/insertion/cadre/5',
  '/api/insertion/pieces/5',
  '/api/insertion/pieces/fichier/1',
  '/api/insertion/fse/5',
  '/api/insertion/conformite/5',
  '/api/insertion/projets',
  '/api/insertion/eligibilite-criteres',
  '/api/insertion/alertes/5',
];

describe('Périmètre — les rôles hors insertion ne joignent rien', () => {
  test.each(Object.entries(HORS_PERIMETRE))('%s : 403 sur toutes les routes de la PR A', async (_nom, jeton) => {
    for (const r of ROUTES_INSERTION) {
      const res = await request(app).get(r).set('Authorization', `Bearer ${jeton}`);
      expect(res.status).toBe(403);
    }
    const exp = await request(appExports).get('/api/exports/fse-plus?projet=1').set('Authorization', `Bearer ${jeton}`);
    expect(exp.status).toBe(403);
  });

  test('aucune requête en base n’est émise sur un refus (le refus précède la lecture)', async () => {
    for (const jeton of Object.values(HORS_PERIMETRE)) {
      for (const r of ROUTES_INSERTION) {
        await request(app).get(r).set('Authorization', `Bearer ${jeton}`);
      }
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('Exports FSE+ — la chaîne d’authentification est portée par le routeur lui-même', () => {
  test('sans jeton : 401 (le routeur est monté à la racine /api/exports, il n’hérite de rien)', async () => {
    const res = await request(appExports).get('/api/exports/fse-plus?projet=1');
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('MANAGER : 403 sur l’export nominatif ET sur le bilan', async () => {
    const m = tok({ role: 'MANAGER' });
    expect((await request(appExports).get('/api/exports/fse-plus?projet=1').set('Authorization', `Bearer ${m}`)).status).toBe(403);
    expect((await request(appExports).get('/api/exports/fse-plus/bilan?projet=1').set('Authorization', `Bearer ${m}`)).status).toBe(403);
  });

  test('un jeton ADMIN SANS second facteur est refusé (requireMfa porté par le routeur)', async () => {
    const sansMfa = jwt.sign(
      { id: 3, username: 'u', role: 'ADMIN', first_name: 'A', last_name: 'B' },
      JWT_SECRET, { expiresIn: '1h' }
    );
    const res = await request(appExports).get('/api/exports/fse-plus?projet=1').set('Authorization', `Bearer ${sansMfa}`);
    expect([401, 403]).toContain(res.status);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('Pièces — écritures réservées à ADMIN/RH', () => {
  test('MANAGER refusé au dépôt, à la consultation du fichier et à la suppression', async () => {
    const m = tok({ role: 'MANAGER' });
    expect((await request(app).post('/api/insertion/pieces/5').set('Authorization', `Bearer ${m}`)).status).toBe(403);
    expect((await request(app).get('/api/insertion/pieces/fichier/1').set('Authorization', `Bearer ${m}`)).status).toBe(403);
    expect((await request(app).delete('/api/insertion/pieces/1').set('Authorization', `Bearer ${m}`)).status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// Périmètre du profil OPERATEUR_STOCK (arbitrage client du 24/09/2026 :
// « le profil étiquette, étendu à la page de scan » — rien d'autre).
// Le filtre vit dans `authenticate` : il couvre aussi les routeurs qui n'ont
// que `authenticate` sur leurs lectures, et ceux écrits demain.
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({ query: (...a) => mockQuery(...a) }));

const express = require('express');
const request = require('supertest');
const { authenticate, dansPerimetreOperateur, refreshCustomRoles } = require('../../src/middleware/auth');

function app() {
  const a = express();
  a.use(authenticate);
  a.all('*', (req, res) => res.json({ ok: true }));
  return a;
}
const jeton = (role) => jwt.sign({ id: 7, username: 'op', role }, JWT_SECRET, { expiresIn: '1h' });

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('dansPerimetreOperateur', () => {
  test.each([
    '/api/auth/me', '/api/permissions/my-modules', '/api/etiquettes/referentiel',
    '/api/etiquettes/generer', '/api/etiquettes/carton/P10AAH', '/api/sortie-cartons/scan',
    '/api/sortie-cartons/journal?date=2026-09-24',
  ])('ouvert : %s', (u) => expect(dansPerimetreOperateur(u)).toBe(true));

  test.each([
    '/api/etiquettes/admin/referentiel', '/api/etiquettes/admin', '/api/teams', '/api/cav',
    '/api/vehicles', '/api/tri/batches', '/api/messages/conversations', '/api/dashboard/kpis',
    '/api/permissions/matrix', '/api/etiquettesX/referentiel', '/api/sortie-cartonsX',
  ])('fermé : %s', (u) => expect(dansPerimetreOperateur(u)).toBe(false));
});

describe('authenticate — profil OPERATEUR_STOCK', () => {
  test('lecture hors périmètre refusée en 403 PERIMETRE_OPERATEUR', async () => {
    const r = await request(app()).get('/api/teams').set('Authorization', `Bearer ${jeton('OPERATEUR_STOCK')}`);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('PERIMETRE_OPERATEUR');
  });
  test('étiquetage et sortie de cartons passent', async () => {
    for (const u of ['/api/etiquettes/referentiel', '/api/sortie-cartons/scan']) {
      const r = await request(app()).get(u).set('Authorization', `Bearer ${jeton('OPERATEUR_STOCK')}`);
      expect(r.status).toBe(200);
    }
  });
  test('un rôle personnalisé dupliqué du profil hérite de la restriction', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role_key: 'SCAN_ATELIER', base_role: 'OPERATEUR_STOCK' }] });
    await refreshCustomRoles();
    const r = await request(app()).get('/api/cav').set('Authorization', `Bearer ${jeton('SCAN_ATELIER')}`);
    expect(r.status).toBe(403);
  });
  test('non-régression : un COLLABORATEUR n\'est pas concerné', async () => {
    const r = await request(app()).get('/api/teams').set('Authorization', `Bearer ${jeton('COLLABORATEUR')}`);
    expect(r.status).toBe(200);
  });
});

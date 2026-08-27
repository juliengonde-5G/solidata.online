// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — /api/geocodage/adresse
// ───────────────────────────────────────────────────────────────────────────
// Cette suite existe à cause d'un défaut PROUVÉ : le routeur portait
// `authorize(...)` sans `authenticate`, et il est monté directement sur
// l'application (aucun middleware d'authentification en amont). `req.user`
// n'étant assigné que par `authenticate`, la route répondait 401 à TOUT le
// monde — jeton ADMIN valide compris. Fonctionnalité morte, échec fermé.
//
// Ce qui est verrouillé ici :
//   1. sans jeton → 401 (la route n'est JAMAIS un relais sortant public) ;
//   2. avec un jeton ADMIN valide → la route répond réellement (200) ;
//   3. un rôle hors périmètre → 403, et non 401 : la distinction prouve que
//      l'authentification a bien eu lieu avant l'autorisation.
//
// Sans (2), un futur « correctif au symptôme » qui retirerait l'`authorize`
// pour faire disparaître le 401 passerait inaperçu.
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(),
}));

// Le service de géocodage sort sur le réseau (Base Adresse Nationale) : on le
// remplace, les tests ne joignent jamais un service externe.
const mockChercherAdresse = jest.fn();
jest.mock('../../src/services/geocodage', () => ({
  chercherAdresse: (...a) => mockChercherAdresse(...a),
}));

const express = require('express');
const request = require('supertest');

// Jeton sans claim `tv` : `authenticate` le laisse passer sans lecture base
// (jeton hérité, cf. middleware/auth.js) — le harnais n'a donc pas à simuler
// `users.token_version`.
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign({ id: 3, username: 'collab', role: 'COLLABORATEUR' }, JWT_SECRET, { expiresIn: '1h' });

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  // MÊME montage qu'index.js : directement sur l'application, sans middleware
  // d'authentification en amont. C'est ce montage qui rendait le défaut
  // possible ; le reproduire est ce qui donne sa valeur au test.
  app.use('/api/geocodage', require('../../src/routes/geocodage'));
});

beforeEach(() => {
  mockChercherAdresse.mockReset().mockResolvedValue({
    disponible: true,
    resultats: [{
      libelle: '1 Rue de la Gare 76770 Le Houlme',
      adresse: '1 Rue de la Gare', code_postal: '76770', commune: 'Le Houlme',
      code_insee: '76377', latitude: 49.4231, longitude: 1.0993, score: 0.97,
    }],
  });
});

describe('GET /api/geocodage/adresse — chaîne de garde', () => {
  test('sans jeton → 401, et le service externe n\'est JAMAIS appelé', async () => {
    const r = await request(app).get('/api/geocodage/adresse?q=1 rue de la gare');
    expect(r.status).toBe(401);
    expect(mockChercherAdresse).not.toHaveBeenCalled();
  });

  test('jeton invalide → 401', async () => {
    const r = await request(app)
      .get('/api/geocodage/adresse?q=test')
      .set('Authorization', 'Bearer jeton-fabrique');
    expect(r.status).toBe(401);
    expect(mockChercherAdresse).not.toHaveBeenCalled();
  });

  test('jeton ADMIN valide → 200 et propositions rendues (la route N\'EST PAS morte)', async () => {
    const r = await request(app)
      .get('/api/geocodage/adresse?q=1 rue de la gare')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.disponible).toBe(true);
    expect(r.body.resultats).toHaveLength(1);
    expect(r.body.resultats[0]).toMatchObject({ commune: 'Le Houlme', latitude: 49.4231 });
    // Le biais vers le centre de tri est bien transmis : sans lui, « rue de la
    // République » est ambigu partout en France.
    expect(mockChercherAdresse).toHaveBeenCalledWith(
      '1 rue de la gare',
      expect.objectContaining({ autour: expect.objectContaining({ lat: expect.any(Number), lng: expect.any(Number) }) })
    );
  });

  test('rôle hors périmètre → 403 (et non 401 : l\'authentification a bien eu lieu)', async () => {
    const r = await request(app)
      .get('/api/geocodage/adresse?q=test')
      .set('Authorization', `Bearer ${collabToken}`);
    expect(r.status).toBe(403);
    expect(mockChercherAdresse).not.toHaveBeenCalled();
  });

  test('service indisponible → la réponse le DIT, aucune coordonnée inventée', async () => {
    mockChercherAdresse.mockResolvedValue({
      disponible: false,
      motif: 'Service de géocodage injoignable',
      resultats: [],
    });
    const r = await request(app)
      .get('/api/geocodage/adresse?q=test')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(r.status).toBe(200);
    expect(r.body.disponible).toBe(false);
    expect(r.body.resultats).toEqual([]);
    expect(r.body.motif).toBeTruthy();
  });
});

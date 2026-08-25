// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — le retour au centre de tri est une ÉTAPE
// ───────────────────────────────────────────────────────────────────────────
// Constat client (08/2026) : l'équipage déclarait « camion plein » et se
// retrouvait DIRECTEMENT sur la page de pesée. Le trajet de retour n'existait
// nulle part — ni étape, ni itinéraire, ni minute comptée.
//
// Contrat vérifié ici :
//   1. Déclarer un retour CRÉE un arrêt de programme, il n'ouvre pas la pesée.
//   2. Le mobile reçoit ces arrêts à côté de ses points de collecte.
//   3. La pesée n'arrive qu'APRÈS la déclaration d'arrivée, et la suite dépend
//      du motif (vidage → pesée intermédiaire, fin → pesée finale).
//   4. Un motif inconnu est refusé ; la pause du midi n'est pas créable depuis
//      le mobile (c'est le serveur qui la pose).
//   5. La garde de périmètre véhicule s'applique comme à toute route mobile.
//
// Auth réelle (JWT chauffeur), DB mockée par routage SQL.
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

const mockQuery = jest.fn();
const mockClient = {
  query: (...a) => mockQuery(...a),
  release: jest.fn(),
};
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => mockClient),
}));
jest.mock('../../src/services/push-notifications', () => ({
  sendPushToRoles: jest.fn().mockResolvedValue({ skipped: true }),
  sendPushToUser: jest.fn().mockResolvedValue({ skipped: true }),
  isConfigured: () => false,
  getPublicKey: () => null,
}));
jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({}),
  isRedisAvailable: () => false,
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

const TOUR_ID = 77;
const VEHICLE_ID = 5;

const driverToken = jwt.sign(
  { id: 4, userId: 4, username: `driver_${VEHICLE_ID}`, role: 'COLLABORATEUR', vehicle_id: VEHICLE_ID, employee_id: 42 },
  JWT_SECRET, { expiresIn: '1h' });
const autreDriverToken = jwt.sign(
  { id: 9, userId: 9, username: 'driver_9', role: 'COLLABORATEUR', vehicle_id: 99, employee_id: 43 },
  JWT_SECRET, { expiresIn: '1h' });

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', require('../../src/routes/tours'));
});

const CENTRE = {
  id: 3, nom: 'Centre de tri — Solidarité Textiles', adresse: 'Le Houlme',
  latitude: 49.4231, longitude: 1.0993, duree_min: 20,
};

/**
 * Routeur de mock par TEXTE SQL : le test reste indépendant de l'ordre exact
 * des requêtes (le module lit le lieu, compte les positions, insère…).
 */
function mockDb({ tourStatus = 'in_progress', arretExistant = null, arrets = [], cavs = [] } = {}) {
  mockQuery.mockImplementation((sql) => {
    const t = String(sql);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(t)) return Promise.resolve({ rows: [] });
    if (/FROM settings WHERE key/.test(t)) return Promise.resolve({ rows: [{ value: '6' }] });
    // Garde de périmètre véhicule
    if (/SELECT vehicle_id FROM tours WHERE id/.test(t)) {
      return Promise.resolve({ rows: [{ vehicle_id: VEHICLE_ID }] });
    }
    if (/SELECT id, status FROM tours WHERE id/.test(t)) {
      return Promise.resolve({ rows: [{ id: TOUR_ID, status: tourStatus }] });
    }
    if (/FROM lieux_techniques/.test(t)) return Promise.resolve({ rows: [CENTRE] });
    if (/SELECT id, position FROM tour_arret_technique/.test(t)) {
      return Promise.resolve({ rows: arretExistant ? [arretExistant] : [] });
    }
    if (/COALESCE\(MAX\(position\), 0\) AS derniere/.test(t)) {
      return Promise.resolve({ rows: [{ derniere: 3 }] });
    }
    if (/COALESCE\(MAX\(p\), 0\) \+ 1 AS suivante/.test(t)) {
      return Promise.resolve({ rows: [{ suivante: 9 }] });
    }
    if (/INSERT INTO tour_arret_technique/.test(t)) {
      return Promise.resolve({ rows: [{ id: 501, position: 4 }] });
    }
    if (/UPDATE tour_arret_technique/.test(t) && /RETURNING/.test(t)) {
      return Promise.resolve({
        rows: [{ id: 501, motif: 'vidage', position: 4, arrived_at: '2026-08-25T10:00:00Z' }],
      });
    }
    if (/UPDATE tour_cav SET position|UPDATE tour_arret_technique SET position/.test(t)) {
      return Promise.resolve({ rows: [] });
    }
    if (/FROM tour_arret_technique ta/.test(t)) return Promise.resolve({ rows: arrets });
    if (/FROM tours t JOIN vehicles v/.test(t)) {
      return Promise.resolve({ rows: [{ id: TOUR_ID, vehicle_id: VEHICLE_ID, collection_type: 'cav', status: tourStatus }] });
    }
    if (/FROM tour_cav tc/.test(t)) return Promise.resolve({ rows: cavs });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => { mockQuery.mockReset(); mockClient.release.mockReset(); });

const declarer = (motif, token = driverToken) =>
  request(app).post(`/api/tours/${TOUR_ID}/retour-centre-public`)
    .set('Authorization', `Bearer ${token}`).send({ motif });

describe('POST /:id/retour-centre-public', () => {
  test('« camion plein » crée une étape et renvoie la destination — pas la pesée', async () => {
    mockDb();
    const res = await declarer('vidage');

    expect(res.status).toBe(200);
    expect(res.body.arret_id).toBe(501);
    expect(res.body.suite).toBe('pesee_intermediaire');
    expect(res.body.destination.latitude).toBe(CENTRE.latitude);
    expect(res.body.destination.longitude).toBe(CENTRE.longitude);

    // L'étape a bien été écrite avec son motif.
    const insert = mockQuery.mock.calls.find(([s]) => /INSERT INTO tour_arret_technique/.test(String(s)));
    expect(insert).toBeDefined();
    expect(insert[1]).toContain('vidage');
  });

  test('la fin de tournée déclarée vient DEVANT le chauffeur, pas en queue', async () => {
    mockDb();
    const res = await declarer('fin_tournee');

    expect(res.status).toBe(200);
    expect(res.body.suite).toBe('pesee_finale');
    // Le retour s'intercale après le dernier point traité : laissé en queue de
    // programme, il resterait derrière les bornes non collectées et l'étape
    // courante du mobile ne le sélectionnerait jamais — l'appui sur « Fin »
    // n'aurait rien affiché.
    const decalage = mockQuery.mock.calls.find(([s]) => /UPDATE tour_cav SET position = position \+ 1/.test(String(s)));
    expect(decalage).toBeDefined();
  });

  test('un retour déjà prévu plus loin est DÉPLACÉ devant le chauffeur', async () => {
    // Cas réel : la création de tournée a posé le retour de fin en queue de
    // programme ; l'équipage décide de rentrer avant d'avoir tout collecté.
    mockDb({ arretExistant: { id: 707, position: 11 } });
    const res = await declarer('fin_tournee');

    expect(res.status).toBe(200);
    expect(res.body.arret_id).toBe(707);
    expect(res.body.deja_present).toBe(true);
    // Sorti de la file, le trou refermé, puis réinséré devant le chauffeur.
    const sentinelle = mockQuery.mock.calls.find(([s]) => /SET position = -1/.test(String(s)));
    expect(sentinelle).toBeDefined();
    const reinsertion = mockQuery.mock.calls.find(
      ([s, p]) => /UPDATE tour_arret_technique SET position = \$2 WHERE id = \$1/.test(String(s)) && p[0] === 707
    );
    expect(reinsertion).toBeDefined();
    // Il ne repart pas de sa position d'origine : il a bien changé de place.
    expect(reinsertion[1][1]).not.toBe(11);
  });

  test('un double appui n\'empile pas deux retours', async () => {
    mockDb({ arretExistant: { id: 404, position: 4 } });
    // Aucun second arrêt créé : le premier est réutilisé (et repositionné).
    const res = await declarer('vidage');

    expect(res.status).toBe(200);
    expect(res.body.deja_present).toBe(true);
    expect(res.body.arret_id).toBe(404);
    const insert = mockQuery.mock.calls.find(([s]) => /INSERT INTO tour_arret_technique/.test(String(s)));
    expect(insert).toBeUndefined();
  });

  test('la pause du midi n\'est pas créable depuis le mobile', async () => {
    mockDb();
    const res = await declarer('pause_dejeuner');
    expect(res.status).toBe(400);
  });

  test('motif inconnu refusé', async () => {
    mockDb();
    const res = await declarer('cafe');
    expect(res.status).toBe(400);
  });

  test('tournée déjà terminée → 409 explicite', async () => {
    mockDb({ tourStatus: 'completed' });
    const res = await declarer('vidage');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/terminée/i);
  });

  test('le véhicule d\'un autre chauffeur est refusé', async () => {
    mockDb();
    const res = await declarer('vidage', autreDriverToken);
    expect(res.status).toBe(403);
  });

  test('sans jeton, rien ne passe', async () => {
    mockDb();
    const res = await request(app)
      .post(`/api/tours/${TOUR_ID}/retour-centre-public`).send({ motif: 'vidage' });
    expect(res.status).toBe(401);
  });
});

describe('POST /:id/arret/:arretId/arrive-public', () => {
  test('c\'est l\'arrivée déclarée qui ouvre la pesée', async () => {
    mockDb();
    const res = await request(app)
      .post(`/api/tours/${TOUR_ID}/arret/501/arrive-public`)
      .set('Authorization', `Bearer ${driverToken}`).send({});

    expect(res.status).toBe(200);
    expect(res.body.suite).toBe('pesee_intermediaire');
    expect(res.body.arrived_at).toBeTruthy();
  });

  test('arrêt inconnu → 404, jamais un succès silencieux', async () => {
    mockQuery.mockImplementation((sql) => {
      const t = String(sql);
      if (/SELECT vehicle_id FROM tours WHERE id/.test(t)) return Promise.resolve({ rows: [{ vehicle_id: VEHICLE_ID }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app)
      .post(`/api/tours/${TOUR_ID}/arret/999/arrive-public`)
      .set('Authorization', `Bearer ${driverToken}`).send({});
    expect(res.status).toBe(404);
  });
});

describe('GET /:id/public', () => {
  test('les arrêts voyagent À CÔTÉ des points de collecte', async () => {
    mockDb({
      cavs: [{ id: 1, cav_id: 10, position: 1, status: 'collected', cav_name: 'Borne A' }],
      arrets: [{
        id: 501, position: 2, status: 'pending', motif: 'vidage',
        name: 'Retour au centre — camion plein', address: 'Le Houlme',
        latitude: 49.4231, longitude: 1.0993, categorie: 'centre_tri', duree_min: 20,
      }],
    });

    const res = await request(app)
      .get(`/api/tours/${TOUR_ID}/public`).set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.cavs)).toBe(true);
    expect(Array.isArray(res.body.arrets)).toBe(true);
    expect(res.body.arrets[0].est_retour_centre).toBe(true);
    expect(res.body.arrets[0].suite).toBe('pesee_intermediaire');
    // Le contrat historique n'est pas touché : un mobile ancien lit toujours `cavs`.
    expect(res.body.cavs[0].cav_name).toBe('Borne A');
  });

  test('un arrêt dont le lieu a disparu garde une destination exploitable', async () => {
    mockDb({
      arrets: [{
        id: 502, position: 2, status: 'pending', motif: 'fin_tournee',
        name: 'Retour au centre — fin de tournée',
        address: null, latitude: null, longitude: null, categorie: null, duree_min: 15,
      }],
    });

    const res = await request(app)
      .get(`/api/tours/${TOUR_ID}/public`).set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    // Sans ce repli, le chauffeur n'aurait aucun itinéraire vers sa destination.
    expect(res.body.arrets[0].latitude).toBe(CENTRE.latitude);
    expect(res.body.arrets[0].longitude).toBe(CENTRE.longitude);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — session chauffeur « 1 URL = 1 véhicule » (mobile)
// ───────────────────────────────────────────────────────────────────────────
// Constat prod (18/08/2026) : après le choix du véhicule, /vehicle-select
// renvoyait « Aucune fiche employé liée à votre compte », et la liste de TOUT
// le parc s'affichait alors même que la session vient d'un lien unique de
// véhicule.
//
// Deux règles sont verrouillées ici :
//   1. PÉRIMÈTRE — une session chauffeur (JWT porteur d'un véhicule) ne voit et
//      ne prend QUE son véhicule. Jamais le parc, jamais la tournée d'un autre.
//   2. IDENTITÉ — l'accès est porté par le VÉHICULE, pas par une fiche employé
//      liée au compte utilisateur. Les fiches salariés viennent de la paie et
//      n'ont pas de compte : exiger `employees.user_id` bloquait tout départ.
//      Le chauffeur est résolu en cascade (jeton → compte → affectation du
//      véhicule) et reste NULL quand il est inconnu — sans bloquer la tournée.
//
// Auth réelle (JWT sans `tv` → pas de contrôle token_version), DB mockée.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(),
}));
jest.mock('../../src/services/push-notifications', () => ({
  sendPushToRoles: jest.fn().mockResolvedValue({ skipped: true }),
  sendPushToUser: jest.fn().mockResolvedValue({ skipped: true }),
  isConfigured: () => false,
  getPublicKey: () => null,
}));

const express = require('express');
const request = require('supertest');

let app;

// Jeton émis par POST /auth/driver-start APRÈS ce correctif : véhicule 5,
// chauffeur affecté (employé 42), compte générique « chauffeur » (user 4).
const driverToken = jwt.sign(
  { id: 4, userId: 4, username: 'driver_5', role: 'COLLABORATEUR', vehicle_id: 5, employee_id: 42 },
  JWT_SECRET, { expiresIn: '1h' });

// Jeton chauffeur d'un véhicule SANS chauffeur affecté (employee_id null).
const driverNoEmployee = jwt.sign(
  { id: 4, userId: 4, username: 'driver_7', role: 'COLLABORATEUR', vehicle_id: 7, employee_id: null },
  JWT_SECRET, { expiresIn: '1h' });

// Jeton hérité, émis AVANT ce correctif : véhicule seulement dans `username`.
const legacyDriverToken = jwt.sign(
  { id: 4, userId: 4, username: 'driver_5', role: 'COLLABORATEUR' },
  JWT_SECRET, { expiresIn: '1h' });

// Compte non-chauffeur : la supervision garde son comportement historique.
const adminToken = jwt.sign(
  { id: 1, username: 'admin', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', require('../../src/routes/tours'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const auth = (token) => `Bearer ${token}`;
const sqlCalls = () => mockQuery.mock.calls.map((c) => String(c[0]));

// ── 1. PÉRIMÈTRE : GET /tours/my ───────────────────────────────────────────
describe('GET /api/tours/my — périmètre de la session chauffeur', () => {
  it('ne renvoie QUE le véhicule du jeton et ne liste jamais le parc', async () => {
    mockQuery
      // véhicule de la session
      .mockResolvedValueOnce({ rows: [{ id: 5, registration: 'AB-123-CD', name: 'Renault Master', status: 'available', assigned_driver_id: 42 }] })
      // tournée du jour de CE véhicule
      .mockResolvedValueOnce({ rows: [{ id: 90, vehicle_id: 5, status: 'planned', registration: 'AB-123-CD', nb_cav: 12 }] });

    const res = await request(app).get('/api/tours/my').set('Authorization', auth(driverToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(90);
    // Toutes les requêtes portent le véhicule de la session…
    expect(mockQuery.mock.calls.every((c) => (c[1] || []).includes(5))).toBe(true);
    // …et aucune ne balaye le parc des véhicules disponibles.
    expect(sqlCalls().some((s) => /status\s*=\s*'available'/.test(s))).toBe(false);
  });

  it('propose son propre véhicule (et lui seul) quand aucune tournée n\'est planifiée', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, registration: 'AB-123-CD', name: 'Renault Master', status: 'available', assigned_driver_id: 42 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/tours/my').set('Authorization', auth(driverToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ vehicle_id: 5, is_free_vehicle: true, registration: 'AB-123-CD' });
  });

  it('borne aussi un jeton hérité (véhicule lu dans username driver_<id>)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, registration: 'AB-123-CD', name: null, status: 'available', assigned_driver_id: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/tours/my').set('Authorization', auth(legacyDriverToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].vehicle_id).toBe(5);
  });

  it('véhicule archivé après émission du jeton → liste vide (pas d\'erreur)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/tours/my').set('Authorization', auth(driverToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('NON-RÉGRESSION : un compte non-chauffeur garde la vue parc complète', async () => {
    const res = await request(app).get('/api/tours/my').set('Authorization', auth(adminToken));
    expect(res.status).toBe(200);
    // La branche superviseur interroge bien les véhicules disponibles.
    expect(sqlCalls().some((s) => /status\s*=\s*'available'/.test(s))).toBe(true);
  });
});

// ── 2. IDENTITÉ : POST /tours/claim-vehicle ────────────────────────────────
describe('POST /api/tours/claim-vehicle — le véhicule porte l\'accès, pas la fiche employé', () => {
  it('crée la tournée avec le chauffeur du jeton, SANS exiger employees.user_id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })          // cascade 1 : employé du jeton
      .mockResolvedValueOnce({ rows: [] })                     // pas de tournée en cours
      .mockResolvedValueOnce({ rows: [{ id: 5, is_demo: false }] })  // lecture du véhicule (existe, pas la démo)
      .mockResolvedValueOnce({ rows: [{ id: 91, vehicle_id: 5 }] }); // INSERT

    const res = await request(app).post('/api/tours/claim-vehicle')
      .set('Authorization', auth(driverToken)).send({ vehicle_id: 5 });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(91);
    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO tours/.test(String(c[0])));
    expect(insert[1]).toEqual([5, 42, false]);
    // Le message de blocage historique a disparu.
    expect(JSON.stringify(res.body)).not.toMatch(/fiche employe/i);
  });

  it('véhicule sans chauffeur affecté : la tournée démarre avec driver_employee_id NULL', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // cascade 2 : aucun employé lié au compte générique
      .mockResolvedValueOnce({ rows: [{ assigned_driver_id: null }] }) // cascade 3 : véhicule sans chauffeur
      .mockResolvedValueOnce({ rows: [] })  // pas de tournée en cours
      .mockResolvedValueOnce({ rows: [{ id: 7, is_demo: false }] })  // lecture du véhicule (existe, pas la démo)
      .mockResolvedValueOnce({ rows: [{ id: 92, vehicle_id: 7 }] });

    const res = await request(app).post('/api/tours/claim-vehicle')
      .set('Authorization', auth(driverNoEmployee)).send({ vehicle_id: 7 });

    expect(res.status).toBe(200);
    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO tours/.test(String(c[0])));
    expect(insert[1]).toEqual([7, null, false]);
  });

  it('jeton hérité : le chauffeur est relu depuis l\'affectation du véhicule', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // cascade 2 : compte générique sans fiche
      .mockResolvedValueOnce({ rows: [{ assigned_driver_id: 42 }] }) // cascade 3
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 5, is_demo: false }] })  // lecture du véhicule (existe, pas la démo)
      .mockResolvedValueOnce({ rows: [{ id: 93, vehicle_id: 5 }] });

    const res = await request(app).post('/api/tours/claim-vehicle')
      .set('Authorization', auth(legacyDriverToken)).send({ vehicle_id: 5 });

    expect(res.status).toBe(200);
    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO tours/.test(String(c[0])));
    expect(insert[1]).toEqual([5, 42, false]);
  });

  it('REFUSE (403) la prise du véhicule d\'un autre, sans toucher la base', async () => {
    const res = await request(app).post('/api/tours/claim-vehicle')
      .set('Authorization', auth(driverToken)).send({ vehicle_id: 9 });

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('la tournée est datée du jour civil de Paris (aligné sur /vehicle/:id/today)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 5, is_demo: false }] })  // lecture du véhicule (existe, pas la démo)
      .mockResolvedValueOnce({ rows: [{ id: 94 }] });

    await request(app).post('/api/tours/claim-vehicle')
      .set('Authorization', auth(driverToken)).send({ vehicle_id: 5 });

    const insert = String(mockQuery.mock.calls.find((c) => /INSERT INTO tours/.test(String(c[0])))[0]);
    expect(insert).toMatch(/Europe\/Paris/);
    expect(insert).not.toMatch(/CURRENT_DATE/);
    // `mode` est NOT NULL en base : l'omettre faisait échouer l'INSERT en
    // 23502, donc rendait impossible TOUT départ sur un véhicule libre (500
    // « Erreur serveur » du 30/08/2026, camion école compris). Le mock ne peut
    // pas porter la contrainte — la garde tests/unit/tours-colonnes-obligatoires
    // la vérifie sur la source ; ici on épingle simplement la colonne.
    expect(insert).toMatch(/INSERT INTO tours \([^)]*\bmode\b/);
  });
});

// ── 3. IDENTITÉ + PÉRIMÈTRE : PUT /tours/:id/claim ─────────────────────────
describe('PUT /api/tours/:id/claim — prise d\'une tournée planifiée', () => {
  it('rattache le chauffeur du jeton sans exiger de fiche liée au compte', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ vehicle_id: 5 }] })   // tournée ciblée
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })          // cascade 1
      .mockResolvedValueOnce({ rows: [{ id: 90, status: 'in_progress' }] }); // UPDATE

    const res = await request(app).put('/api/tours/90/claim').set('Authorization', auth(driverToken));

    expect(res.status).toBe(200);
    const upd = mockQuery.mock.calls.find((c) => /UPDATE tours SET driver_employee_id/.test(String(c[0])));
    expect(upd[1]).toEqual([42, 90]);
    // Un chauffeur déjà planifié par le manager n'est pas effacé.
    expect(String(upd[0])).toMatch(/COALESCE\(\$1, driver_employee_id\)/);
  });

  it('REFUSE (403) la tournée d\'un autre véhicule', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ vehicle_id: 9 }] });
    const res = await request(app).put('/api/tours/12/claim').set('Authorization', auth(driverToken));
    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('404 sur une tournée inexistante', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/api/tours/999/claim').set('Authorization', auth(driverToken));
    expect(res.status).toBe(404);
  });

  it('409 si la tournée a déjà été prise (statut non planned)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ vehicle_id: 5 }] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [] });   // UPDATE 0 ligne

    const res = await request(app).put('/api/tours/90/claim').set('Authorization', auth(driverToken));
    expect(res.status).toBe(409);
  });
});

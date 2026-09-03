// ═══════════════════════════════════════════════════════════════════════════
// TEST DE CONTRAT — REPRISE D'UNE TOURNÉE TERMINÉE (ADMIN)
// ───────────────────────────────────────────────────────────────────────────
// Demande client (09/2026) : un administrateur doit pouvoir corriger les
// données d'une tournée RÉALISÉE — volume déclaré, pesées oubliées.
//
// Ce que ce contrat verrouille, c'est le PÉRIMÈTRE de cette permission, parce
// que c'est lui qui la rend acceptable :
//   • ADMIN et personne d'autre — le gestionnaire garde « Collecte en direct »,
//     dont le refus sur une tournée close reste entier ;
//   • une tournée TERMINÉE et rien d'autre — une journée en cours se corrige
//     là où elle se déroule, une tournée de démonstration n'a rien à reprendre ;
//   • une saisie contrôlée AVANT toute écriture — horodatage, palier, sacs.
//
// La mécanique (recalcul du total, reconstruction du tonnage, recensement de
// l'écart de stock) est prouvée sur PostgreSQL réel : elle dépend de
// contraintes et d'un SQL que des mocks ne sauraient pas reproduire.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} })),
}));

const express = require('express');
const request = require('supertest');
const { authenticate } = require('../../src/middleware/auth');
const repriseRouter = require('../../src/routes/tours/reprise');

const jeton = (role) => jwt.sign(
  { id: 1, username: 'u', role, first_name: 'T', last_name: 'U', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' }
);
const ADMIN = jeton('ADMIN');
const MANAGER = jeton('MANAGER');

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', authenticate, repriseRouter);
});

const TERMINEE = {
  id: 676, date: '2026-08-28', status: 'completed', collection_type: 'pav',
  is_demo: false, total_weight_kg: 900,
};

function mocker(tour = TERMINEE, extra = () => null) {
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql).replace(/\s+/g, ' ');
    const sur_mesure = extra(s, params);
    if (sur_mesure) return sur_mesure;
    if (/FROM tours WHERE id/.test(s)) return Promise.resolve({ rows: tour ? [tour] : [] });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

beforeEach(() => { mockQuery.mockReset(); mocker(); });

describe('Qui peut reprendre une tournée', () => {
  test('un MANAGER est refusé (403) — la reprise n\'est pas du pilotage', async () => {
    const r = await request(app).get('/api/tours/676/reprise').set('Authorization', `Bearer ${MANAGER}`);
    expect(r.status).toBe(403);
  });

  test('le refus tombe AVANT toute lecture en base', async () => {
    await request(app).get('/api/tours/676/reprise').set('Authorization', `Bearer ${MANAGER}`);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('sans jeton, 401', async () => {
    expect((await request(app).get('/api/tours/676/reprise')).status).toBe(401);
  });
});

describe('Quelles tournées se reprennent', () => {
  test('une tournée EN COURS est refusée, et renvoie vers le bon écran', async () => {
    mocker({ ...TERMINEE, status: 'in_progress' });
    const r = await request(app).get('/api/tours/676/reprise').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('TOURNEE_NON_TERMINEE');
    expect(r.body.error).toMatch(/Collecte en direct/);
  });

  test('une tournée ANNULÉE est refusée pour sa propre raison', async () => {
    mocker({ ...TERMINEE, status: 'cancelled' });
    const r = await request(app).get('/api/tours/676/reprise').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/annulée/);
  });

  test('une tournée de DÉMONSTRATION est refusée : elle ne produit rien à corriger', async () => {
    mocker({ ...TERMINEE, is_demo: true });
    const r = await request(app).get('/api/tours/676/reprise').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('TOURNEE_DEMO');
  });

  test('une tournée inexistante → 404', async () => {
    mocker(null);
    const r = await request(app).get('/api/tours/676/reprise').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(404);
  });

  test('un identifiant illisible → 400, sans toucher la base', async () => {
    const r = await request(app).get('/api/tours/abc/reprise').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('Ce qu\'une pesée reprise doit porter', () => {
  const poster = (corps) => request(app)
    .post('/api/tours/676/reprise/pesees').set('Authorization', `Bearer ${ADMIN}`).send(corps);

  test('sans horodatage, refus explicite', async () => {
    const r = await poster({ weight_kg: 1140 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PESEE_INVALIDE');
    expect(r.body.error).toMatch(/AAAA-MM-JJ HH:MM/);
  });

  test('un poids illisible ou aberrant est refusé', async () => {
    expect((await poster({ weight_kg: 'beaucoup', recorded_at: '2026-08-28 16:00' })).status).toBe(400);
    expect((await poster({ weight_kg: -5, recorded_at: '2026-08-28 16:00' })).status).toBe(400);
    expect((await poster({ weight_kg: 99999, recorded_at: '2026-08-28 16:00' })).status).toBe(400);
  });

  test('la saisie est contrôlée AVANT de charger la tournée', async () => {
    // L'ordre compte : une saisie fautive ne doit pas coûter une lecture, et
    // surtout pas ouvrir une transaction qu'il faudrait ensuite annuler.
    await poster({ weight_kg: 1140 });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('Ce qu\'une correction de volume doit porter', () => {
  const patcher = (chemin, corps) => request(app)
    .patch(`/api/tours/676/reprise/points/${chemin}`).set('Authorization', `Bearer ${ADMIN}`).send(corps);

  test('un palier inconnu est refusé, et les paliers valides sont nommés', async () => {
    const r = await patcher('cav/2', { palier: 'a_ras_bord' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PALIER_INCONNU');
    expect(r.body.paliers).toContain('plein');
  });

  test('une famille de point inconnue est refusée', async () => {
    const r = await patcher('camion/2', { palier: 'plein' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('KIND_INCONNU');
  });

  test('des sacs sur une tournée de bornes : refus motivé', async () => {
    const r = await patcher('association/2', { nb_sacs: 3 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('KIND_INADAPTE');
    expect(r.body.error).toMatch(/palier/);
  });

  test('un palier sur une tournée d\'associations : refus symétrique', async () => {
    mocker({ ...TERMINEE, collection_type: 'association' });
    const r = await patcher('cav/2', { palier: 'plein' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('KIND_INADAPTE');
    expect(r.body.error).toMatch(/sacs/);
  });

  test('un nombre de sacs hors bornes est refusé', async () => {
    mocker({ ...TERMINEE, collection_type: 'association' });
    const r = await patcher('association/2', { nb_sacs: 6000 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('SACS_INVALIDE');
  });

  test('un point qui n\'a pas été collecté n\'a pas de volume à corriger', async () => {
    mocker(TERMINEE, (s) => {
      if (/FROM tour_cav WHERE id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 3, point_id: 9, status: 'skipped', fill_level: null, fill_percent: null }] });
      }
      return null;
    });
    const r = await patcher('cav/3', { palier: 'plein' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('POINT_NON_COLLECTE');
  });
});

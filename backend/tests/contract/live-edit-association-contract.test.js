// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — pilotage en direct d'une tournée ASSOCIATION.
// ───────────────────────────────────────────────────────────────────────────
// Constat L5 du 26/08/2026 : `/programme` ne lisait que `tour_cav`. Sur une
// tournée d'associations, l'écran « Collecte en direct » n'affichait que les
// arrêts au centre — pas un seul point — et rien n'y était modifiable : ni
// ajout, ni retrait, ni réordonnancement. Cette suite verrouille la surface
// d'édition rendue à ces tournées, et les deux refus qui l'encadrent.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} })),
}));
jest.mock('../../src/services/push-notifications', () => ({ sendPushToRoles: jest.fn(async () => {}) }));

const express = require('express');
const request = require('supertest');
const { authenticate } = require('../../src/middleware/auth');

const adminToken = jwt.sign({ id: 1, username: 'a', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', authenticate, require('../../src/routes/tours/live-edit'));
});
beforeEach(() => mockQuery.mockReset());

const sqls = () => mockQuery.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' '));

/**
 * Tournée association en cours : 1 point collecté (figé), 2 à faire, plus les
 * trois passages au centre. `v_id` reste absent : l'estimation n'est donc pas
 * calculable et l'impact le DIT — c'est le contrat d'`impact.js`, et cela
 * garde cette suite centrée sur la surface d'édition.
 */
function tourneeAssociation({ collectionType = 'association', pointsAssoc, arrets } = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/FROM tours t LEFT JOIN vehicles v/.test(s)) {
      return Promise.resolve({ rows: [{
        id: 7, status: 'in_progress', vehicle_id: 3, date: '2026-08-26',
        collection_type: collectionType, nb_cav: 3,
      }] });
    }
    if (/FROM tour_association_point tap JOIN association_points ap/.test(s)) {
      return Promise.resolve({ rows: pointsAssoc || [
        { id: 21, ref_id: 1, position: 2, status: 'collected', name: 'Secours Populaire Rouen' },
        { id: 22, ref_id: 2, position: 3, status: 'pending', name: 'Croix-Rouge Sotteville' },
        { id: 23, ref_id: 3, position: 5, status: 'pending', name: 'Emmaüs Le Grand-Quevilly' },
      ] });
    }
    if (/FROM tour_arret_technique ta LEFT JOIN lieux_techniques/.test(s)) {
      return Promise.resolve({ rows: arrets || [
        { id: 31, ref_id: 7, position: 1, status: 'done', name: 'Départ du centre de tri', motif: 'depart_centre' },
        { id: 32, ref_id: 7, position: 4, status: 'pending', name: 'Pause déjeuner au centre', motif: 'pause_dejeuner' },
        { id: 33, ref_id: 7, position: 6, status: 'pending', name: 'Retour au centre — fin de tournée', motif: 'fin_tournee' },
      ] });
    }
    if (/FROM tour_cav tc JOIN cav c/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

describe('GET /:id/programme — tournée association', () => {
  it('affiche enfin les points association, fusionnés avec les arrêts au centre', async () => {
    tourneeAssociation();
    const res = await request(app).get('/api/tours/7/programme').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(6);
    expect(res.body.points.map((p) => p.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(res.body.points.map((p) => p.kind)).toEqual([
      'arret_technique', 'association', 'association', 'arret_technique', 'association', 'arret_technique',
    ]);
    // Ce qui est fait ne bouge plus : le point collecté et le départ acquitté.
    expect(res.body.points[1]).toMatchObject({ kind: 'association', editable: false });
    expect(res.body.points[2].editable).toBe(true);
  });
});

describe('POST /:id/programme/association', () => {
  it('ajoute un point du référentiel et prévient le chauffeur', async () => {
    tourneeAssociation();
    const base = mockQuery.getMockImplementation();
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/FROM association_points WHERE id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 4, name: 'Restos du Cœur Darnétal', status: 'active', unavailable_reason: null }] });
      }
      if (/SELECT id FROM tour_association_point WHERE tour_id = \$1 AND association_point_id/.test(s)) {
        return Promise.resolve({ rows: [] });
      }
      if (/AS suivante/.test(s)) return Promise.resolve({ rows: [{ suivante: 7 }] });
      return base(sql, params);
    });

    const res = await request(app).post('/api/tours/7/programme/association')
      .set('Authorization', `Bearer ${adminToken}`).send({ association_point_id: 4 });
    expect(res.status).toBe(201);
    expect(res.body.avertissement).toBeNull();
    const emises = sqls();
    expect(emises.some((s) => /INSERT INTO tour_association_point/.test(s))).toBe(true);
    expect(emises.some((s) => /INSERT INTO driver_messages/.test(s))).toBe(true);
    // La place libre est cherchée sur les TROIS tables du programme.
    const position = emises.find((s) => /AS suivante/.test(s));
    expect(position).toMatch(/tour_cav/);
    expect(position).toMatch(/tour_association_point/);
    expect(position).toMatch(/tour_arret_technique/);
  });

  it('signale un point non ouvert au référentiel sans pour autant refuser', async () => {
    tourneeAssociation();
    const base = mockQuery.getMockImplementation();
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/FROM association_points WHERE id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 4, name: 'Restos du Cœur Darnétal', status: 'temporairement_indisponible', unavailable_reason: 'Local en travaux' }] });
      }
      if (/SELECT id FROM tour_association_point WHERE tour_id = \$1 AND association_point_id/.test(s)) {
        return Promise.resolve({ rows: [] });
      }
      if (/AS suivante/.test(s)) return Promise.resolve({ rows: [{ suivante: 7 }] });
      return base(sql, params);
    });
    const res = await request(app).post('/api/tours/7/programme/association')
      .set('Authorization', `Bearer ${adminToken}`).send({ association_point_id: 4 });
    expect(res.status).toBe(201);
    expect(res.body.avertissement).toMatch(/temporairement_indisponible/);
    expect(res.body.avertissement).toMatch(/Local en travaux/);
  });

  it('refuse un point déjà au programme', async () => {
    tourneeAssociation();
    const base = mockQuery.getMockImplementation();
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/FROM association_points WHERE id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 2, name: 'Croix-Rouge Sotteville', status: 'active' }] });
      }
      if (/SELECT id FROM tour_association_point WHERE tour_id = \$1 AND association_point_id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 22 }] });
      }
      return base(sql, params);
    });
    const res = await request(app).post('/api/tours/7/programme/association')
      .set('Authorization', `Bearer ${adminToken}`).send({ association_point_id: 2 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('POINT_DEJA_PRESENT');
  });

  it('refuse un point association inconnu du référentiel', async () => {
    tourneeAssociation();
    const res = await request(app).post('/api/tours/7/programme/association')
      .set('Authorization', `Bearer ${adminToken}`).send({ association_point_id: 999 });
    expect(res.status).toBe(404);
  });
});

describe('familles de points : jamais de mélange silencieux', () => {
  it('refuse d’ajouter une BORNE à une tournée association', async () => {
    tourneeAssociation();
    const res = await request(app).post('/api/tours/7/programme/cav')
      .set('Authorization', `Bearer ${adminToken}`).send({ cav_id: 42 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TYPE_POINT_INCOMPATIBLE');
    expect(sqls().some((s) => /INSERT INTO tour_cav/.test(s))).toBe(false);
  });

  it('refuse d’ajouter un POINT ASSOCIATION à une tournée de bornes', async () => {
    tourneeAssociation({ collectionType: 'pav' });
    const res = await request(app).post('/api/tours/7/programme/association')
      .set('Authorization', `Bearer ${adminToken}`).send({ association_point_id: 4 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TYPE_POINT_INCOMPATIBLE');
    expect(sqls().some((s) => /INSERT INTO tour_association_point/.test(s))).toBe(false);
  });
});

describe('DELETE /:id/programme/association/:tourPointId', () => {
  it('refuse de retirer un point déjà traité par le chauffeur', async () => {
    tourneeAssociation();
    const base = mockQuery.getMockImplementation();
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/SELECT tap.status, ap.name/.test(s)) {
        return Promise.resolve({ rows: [{ status: 'collected', name: 'Secours Populaire Rouen' }] });
      }
      return base(sql, params);
    });
    const res = await request(app).delete('/api/tours/7/programme/association/21')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('POINT_DEJA_TRAITE');
    expect(sqls().some((s) => /DELETE FROM tour_association_point/.test(s))).toBe(false);
  });

  it('retire un point à faire, renumérote le programme ENTIER et décrémente le compte', async () => {
    tourneeAssociation();
    const base = mockQuery.getMockImplementation();
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/SELECT tap.status, ap.name/.test(s)) {
        return Promise.resolve({ rows: [{ status: 'pending', name: 'Emmaüs Le Grand-Quevilly' }] });
      }
      if (/'cav'::text AS kind/.test(s)) {
        return Promise.resolve({ rows: [
          { id: 31, kind: 'arret_technique', rang: 1, position: 1 },
          { id: 21, kind: 'association', rang: 0, position: 2 },
          { id: 22, kind: 'association', rang: 0, position: 3 },
          { id: 32, kind: 'arret_technique', rang: 1, position: 4 },
          { id: 33, kind: 'arret_technique', rang: 1, position: 6 },   // trou en 5
        ] });
      }
      return base(sql, params);
    });
    const res = await request(app).delete('/api/tours/7/programme/association/23')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const emises = sqls();
    expect(emises.some((s) => /DELETE FROM tour_association_point/.test(s))).toBe(true);
    // La renumérotation regarde les trois tables, pas la seule table du point retiré.
    const renum = emises.find((s) => /'cav'::text AS kind/.test(s));
    expect(renum).toMatch(/tour_association_point/);
    expect(renum).toMatch(/tour_arret_technique/);
    // Seul l'élément réellement décalé est réécrit (le trou en 5 se referme).
    expect(emises.some((s) => /UPDATE tour_arret_technique SET position = \$2 WHERE id = \$1/.test(s))).toBe(true);
    expect(emises.some((s) => /nb_cav = GREATEST/.test(s))).toBe(true);
  });
});

describe('PUT /:id/programme/ordre — réordonnancement d’une tournée association', () => {
  it('écrit les nouvelles positions dans tour_association_point', async () => {
    tourneeAssociation();
    const res = await request(app).put('/api/tours/7/programme/ordre')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ordre: [
        { kind: 'arret_technique', id: 31 },
        { kind: 'association', id: 21 },
        { kind: 'association', id: 23 },
        { kind: 'arret_technique', id: 32 },
        { kind: 'association', id: 22 },
        { kind: 'arret_technique', id: 33 },
      ] });
    expect(res.status).toBe(200);
    const maj = mockQuery.mock.calls
      .filter((c) => /UPDATE tour_association_point SET position/.test(String(c[0])))
      .map((c) => c[1]);
    // Les trois points association sont repositionnés (2, 3 et 5).
    expect(maj.map((p) => [p[0], p[1]])).toEqual([[2, 21], [3, 23], [5, 22]]);
  });

  it('refuse de déplacer un point association déjà collecté', async () => {
    tourneeAssociation();
    const res = await request(app).put('/api/tours/7/programme/ordre')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ordre: [
        { kind: 'arret_technique', id: 31 },
        { kind: 'association', id: 22 },
        { kind: 'association', id: 21 },   // le point collecté reculerait
        { kind: 'arret_technique', id: 32 },
        { kind: 'association', id: 23 },
        { kind: 'arret_technique', id: 33 },
      ] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('POINT_DEJA_TRAITE');
    expect(res.body.error).toMatch(/Secours Populaire/);
  });
});

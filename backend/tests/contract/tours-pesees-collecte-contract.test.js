// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — le gestionnaire reprend la main sur les poids et les collectes.
//
// Trois demandes client (08/2026) vérifiées ici :
//   A. saisir / corriger / supprimer une pesée, et marquer un point « Fait » ;
//   B. poser un retour au centre de tri depuis « Collecte en direct » ;
//   C. lire la position du centre de tri pour l'afficher sur la carte.
//
// Ce que le test VERROUILLE, au-delà du fait que « ça répond 200 » :
//   • le total d'une tournée reste la somme de TOUTES les pesées, les
//     intermédiaires comprises (correctif d'août 2026) ;
//   • une pesée ne se saisit plus après la clôture, parce que le tonnage et le
//     stock sont déjà écrits — et le refus dit où régulariser ;
//   • aucun niveau de remplissage n'est inventé quand le bureau marque « Fait » ;
//   • un point déjà déclaré par le chauffeur n'est pas réécrit ;
//   • un poids négatif ou aberrant est refusé, jamais rangé en base ;
//   • ces écritures sont réservées à ADMIN/MANAGER et journalisées.
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
jest.mock('../../src/services/messagerie', () => ({ envoyerMessageSysteme: jest.fn(async () => ({ ok: true })) }));

const express = require('express');
const request = require('supertest');
const { authenticate } = require('../../src/middleware/auth');

const adminToken = jwt.sign({ id: 1, username: 'a', role: 'ADMIN', first_name: 'Camille', last_name: 'GESTION' }, JWT_SECRET, { expiresIn: '1h' });
const managerToken = jwt.sign({ id: 5, username: 'm', role: 'MANAGER' }, JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign({ id: 2, username: 'c', role: 'COLLABORATEUR' }, JWT_SECRET, { expiresIn: '1h' });

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', authenticate, require('../../src/routes/tours/live-edit'));
});
beforeEach(() => mockQuery.mockReset());

const plat = (sql) => String(sql).replace(/\s+/g, ' ');

/**
 * Base simulée : tournée #7 en cours, 3 points (1 collecté, 2 à faire),
 * deux pesées dont UNE INTERMÉDIAIRE — c'est le cas qui a produit le défaut
 * historique, il doit rester couvert.
 * @param {object} options { statut, pesees, statutPoint }
 */
function baseType({ statut = 'in_progress', pesees, statutPoint = 'pending' } = {}) {
  const lignesPesees = pesees || [
    { id: 31, weight_kg: 640, tare_kg: 2100, is_intermediate: true, notes: 'Vidage du matin', recorded_at: '2026-08-28T09:10:00Z' },
    { id: 32, weight_kg: 815, tare_kg: 2100, is_intermediate: false, notes: null, recorded_at: '2026-08-28T16:20:00Z' },
  ];
  mockQuery.mockImplementation((sql, params) => {
    const s = plat(sql);
    if (/SELECT id, status, total_weight_kg FROM tours/.test(s)) {
      return Promise.resolve({ rows: [{ id: 7, status: statut, total_weight_kg: 640 }] });
    }
    if (/FROM tours t LEFT JOIN vehicles v/.test(s)) {
      return Promise.resolve({ rows: [{ id: 7, status: statut, vehicle_id: 3, date: '2026-08-28', collection_type: 'pav' }] });
    }
    if (/FROM tour_weights WHERE tour_id/.test(s) && /^SELECT/.test(s)) {
      return Promise.resolve({ rows: lignesPesees });
    }
    if (/UPDATE tours SET total_weight_kg/.test(s)) {
      return Promise.resolve({ rows: [{ total_weight_kg: 1455 }] });
    }
    if (/INSERT INTO tour_weights/.test(s)) {
      return Promise.resolve({ rows: [{ id: 33, weight_kg: params[1], tare_kg: params[2], is_intermediate: params[3], notes: params[4], recorded_at: '2026-08-28T17:00:00Z' }] });
    }
    if (/SELECT weight_kg FROM tour_weights WHERE id/.test(s)) {
      return Promise.resolve({ rows: [{ weight_kg: 815 }] });
    }
    if (/UPDATE tour_weights/.test(s)) {
      return Promise.resolve({ rows: [{ id: 32, weight_kg: params[2], tare_kg: params[3], is_intermediate: params[4], notes: params[5], recorded_at: '2026-08-28T16:20:00Z' }] });
    }
    if (/DELETE FROM tour_weights/.test(s)) {
      return Promise.resolve({ rows: [{ weight_kg: 640, is_intermediate: true }] });
    }
    // Point de collecte visé par « Fait »
    if (/SELECT status, notes FROM tour_cav/.test(s)) {
      return Promise.resolve({ rows: [{ status: statutPoint, notes: null }] });
    }
    if (/UPDATE tour_cav SET status = 'collected'/.test(s)) {
      return Promise.resolve({ rows: [{ id: 12, position: 2, status: 'collected', fill_level: params[2], collected_at: '2026-08-28T17:05:00Z', notes: params[3] }] });
    }
    // Programme (chargerProgramme)
    if (/FROM tour_cav tc JOIN cav c/.test(s)) {
      return Promise.resolve({ rows: [
        { id: 11, ref_id: 101, position: 1, status: 'collected', name: 'CAV A' },
        { id: 12, ref_id: 102, position: 2, status: statutPoint, name: 'CAV B' },
      ] });
    }
    if (/FROM tour_association_point tap/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM tour_arret_technique ta/.test(s)) return Promise.resolve({ rows: [] });
    // Retour au centre (arrets.js)
    if (/FROM lieux_techniques WHERE categorie = 'centre_tri'/.test(s)) {
      return Promise.resolve({ rows: [{ id: 4, nom: 'Centre de tri', adresse: 'Le Houlme', latitude: 49.4231, longitude: 1.0993, duree_min: 20 }] });
    }
    if (/SELECT id, position FROM tour_arret_technique/.test(s)) return Promise.resolve({ rows: [] });
    if (/COALESCE\(MAX\(position\), 0\) AS derniere/.test(s)) return Promise.resolve({ rows: [{ derniere: 1 }] });
    if (/INSERT INTO tour_arret_technique/.test(s)) return Promise.resolve({ rows: [{ id: 55, position: 2 }] });
    return Promise.resolve({ rows: [] });
  });
}

const sqls = () => mockQuery.mock.calls.map((c) => plat(c[0]));

// ── A1. Lecture des pesées ────────────────────────────────────────────────
describe('GET /:id/pesees', () => {
  it('somme TOUTES les pesées, y compris les intermédiaires', async () => {
    baseType();
    const res = await request(app).get('/api/tours/7/pesees').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    // 640 (intermédiaire, chargement réellement déposé) + 815 = 1455.
    expect(res.body.total_kg).toBe(1455);
    expect(res.body.pesees).toHaveLength(2);
    expect(res.body.modifiable).toBe(true);
  });

  it('annonce « non modifiable » sur une tournée close, sans refuser la lecture', async () => {
    baseType({ statut: 'completed' });
    const res = await request(app).get('/api/tours/7/pesees').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.modifiable).toBe(false);
  });

  it('refuse un rôle non habilité', async () => {
    baseType();
    const res = await request(app).get('/api/tours/7/pesees').set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(403);
  });
});

// ── A1. Écriture des pesées ───────────────────────────────────────────────
describe('POST /:id/pesees', () => {
  it('enregistre la pesée et RECALCULE le total de la tournée', async () => {
    baseType();
    const res = await request(app).post('/api/tours/7/pesees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ weight_kg: 815, tare_kg: 2100, is_intermediate: false, notes: 'Ticket 4471' });
    expect(res.status).toBe(201);
    expect(res.body.total_kg).toBe(1455);
    // Le total est RECALCULÉ depuis tour_weights, jamais incrémenté à la main.
    expect(sqls().some((s) => /UPDATE tours SET total_weight_kg = \( SELECT COALESCE\(SUM\(weight_kg\), 0\) FROM tour_weights/.test(s))).toBe(true);
  });

  it('accepte le rôle MANAGER', async () => {
    baseType();
    const res = await request(app).post('/api/tours/7/pesees')
      .set('Authorization', `Bearer ${managerToken}`).send({ weight_kg: 500 });
    expect(res.status).toBe(201);
  });

  it('journalise l’auteur de la saisie', async () => {
    baseType();
    await request(app).post('/api/tours/7/pesees')
      .set('Authorization', `Bearer ${adminToken}`).send({ weight_kg: 500 });
    expect(sqls().some((s) => /INSERT INTO rgpd_audit_log/.test(s))).toBe(true);
  });

  it.each([
    ['un poids négatif', { weight_kg: -5 }, /négatif/],
    ['un poids aberrant', { weight_kg: 999999 }, /60000/],
    ['un poids absent', {}, /obligatoire/],
    ['un poids illisible', { weight_kg: 'beaucoup' }, /nombre/],
    ['une tare négative', { weight_kg: 100, tare_kg: -1 }, /négatif/],
  ])('refuse %s sans rien écrire', async (_titre, corps, motif) => {
    baseType();
    const res = await request(app).post('/api/tours/7/pesees')
      .set('Authorization', `Bearer ${adminToken}`).send(corps);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PESEE_INVALIDE');
    expect(res.body.error).toMatch(motif);
    expect(sqls().some((s) => /INSERT INTO tour_weights/.test(s))).toBe(false);
  });

  it('refuse une tournée close EN DISANT où régulariser', async () => {
    baseType({ statut: 'completed' });
    const res = await request(app).post('/api/tours/7/pesees')
      .set('Authorization', `Bearer ${adminToken}`).send({ weight_kg: 100 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TOURNEE_NON_MODIFIABLE');
    // Le tonnage et le stock sont déjà écrits : le message doit renvoyer vers
    // une régularisation datée, pas laisser croire à un simple verrou.
    expect(res.body.error).toMatch(/stock/i);
    expect(sqls().some((s) => /INSERT INTO tour_weights/.test(s))).toBe(false);
  });
});

describe('PUT / DELETE /:id/pesees/:peseeId', () => {
  it('corrige une pesée et recalcule le total', async () => {
    baseType();
    const res = await request(app).put('/api/tours/7/pesees/32')
      .set('Authorization', `Bearer ${adminToken}`).send({ weight_kg: 905 });
    expect(res.status).toBe(200);
    expect(res.body.pesee.weight_kg).toBe(905);
    expect(sqls().some((s) => /UPDATE tours SET total_weight_kg/.test(s))).toBe(true);
    // La valeur d'avant est conservée au journal : une correction de poids doit
    // rester reconstituable.
    const journal = mockQuery.mock.calls.find((c) => /INSERT INTO rgpd_audit_log/.test(plat(c[0])));
    expect(JSON.parse(journal[1][4])).toMatchObject({ poids_avant_kg: 815, poids_apres_kg: 905 });
  });

  it('renvoie 404 sur une pesée d’une autre tournée', async () => {
    baseType();
    mockQuery.mockImplementation((sql) => {
      const s = plat(sql);
      if (/FROM tours t LEFT JOIN vehicles v/.test(s)) return Promise.resolve({ rows: [{ id: 7, status: 'in_progress', vehicle_id: 3 }] });
      if (/SELECT weight_kg FROM tour_weights WHERE id/.test(s)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).put('/api/tours/7/pesees/999')
      .set('Authorization', `Bearer ${adminToken}`).send({ weight_kg: 10 });
    expect(res.status).toBe(404);
  });

  it('supprime une pesée et recalcule le total', async () => {
    baseType();
    const res = await request(app).delete('/api/tours/7/pesees/31').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(sqls().some((s) => /DELETE FROM tour_weights/.test(s))).toBe(true);
    expect(sqls().some((s) => /UPDATE tours SET total_weight_kg/.test(s))).toBe(true);
  });

  it('refuse la suppression à un rôle non habilité', async () => {
    baseType();
    const res = await request(app).delete('/api/tours/7/pesees/31').set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(403);
    expect(sqls().some((s) => /DELETE FROM tour_weights/.test(s))).toBe(false);
  });
});

// ── A2. « Fait » sur un point de collecte ─────────────────────────────────
describe('POST /:id/programme/cav/:pointId/collecte', () => {
  it('marque le point collecté SANS inventer de niveau de remplissage', async () => {
    baseType();
    const res = await request(app).post('/api/tours/7/programme/cav/12/collecte')
      .set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.point.status).toBe('collected');
    // Le bureau n'a pas vu la borne : le niveau reste vide, il ne devient ni 0 ni 5.
    expect(res.body.point.fill_level).toBeNull();
    const maj = mockQuery.mock.calls.find((c) => /UPDATE tour_cav SET status = 'collected'/.test(plat(c[0])));
    expect(maj[1][2]).toBeNull();
    // La saisie laisse une marque lisible dans les notes du point.
    expect(maj[1][3]).toMatch(/depuis le bureau/i);
    expect(maj[1][3]).toMatch(/Camille GESTION/);
  });

  it('n’écrase pas un collected_at déjà posé par le chauffeur', async () => {
    baseType();
    await request(app).post('/api/tours/7/programme/cav/12/collecte')
      .set('Authorization', `Bearer ${adminToken}`).send({});
    const maj = mockQuery.mock.calls.find((c) => /UPDATE tour_cav SET status = 'collected'/.test(plat(c[0])));
    expect(plat(maj[0])).toMatch(/collected_at = COALESCE\(collected_at, NOW\(\)\)/);
  });

  it('enregistre le niveau quand le gestionnaire le connaît', async () => {
    baseType();
    const res = await request(app).post('/api/tours/7/programme/cav/12/collecte')
      .set('Authorization', `Bearer ${adminToken}`).send({ fill_level: 3 });
    expect(res.status).toBe(200);
    expect(res.body.point.fill_level).toBe(3);
  });

  it.each([[9], [-1], [2.5], ['plein']])('refuse un niveau hors échelle (%s)', async (valeur) => {
    baseType();
    const res = await request(app).post('/api/tours/7/programme/cav/12/collecte')
      .set('Authorization', `Bearer ${adminToken}`).send({ fill_level: valeur });
    expect(res.status).toBe(400);
    expect(sqls().some((s) => /UPDATE tour_cav SET status = 'collected'/.test(s))).toBe(false);
  });

  it.each(['collected', 'skipped', 'incident'])(
    'refuse de réécrire un point déjà traité (%s)', async (statutPoint) => {
      baseType({ statutPoint });
      const res = await request(app).post('/api/tours/7/programme/cav/12/collecte')
        .set('Authorization', `Bearer ${adminToken}`).send({});
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('POINT_DEJA_TRAITE');
      expect(sqls().some((s) => /UPDATE tour_cav SET status = 'collected'/.test(s))).toBe(false);
    });

  it('prévient le chauffeur que le point ne lui est plus demandé', async () => {
    baseType();
    await request(app).post('/api/tours/7/programme/cav/12/collecte')
      .set('Authorization', `Bearer ${adminToken}`).send({});
    expect(sqls().some((s) => /INSERT INTO driver_messages/.test(s))).toBe(true);
  });

  it('refuse la route « association » sur une tournée de bornes', async () => {
    baseType();
    const res = await request(app).post('/api/tours/7/programme/association/12/collecte')
      .set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TYPE_DE_POINT_INATTENDU');
  });

  it('refuse un rôle non habilité', async () => {
    baseType();
    const res = await request(app).post('/api/tours/7/programme/cav/12/collecte')
      .set('Authorization', `Bearer ${collabToken}`).send({});
    expect(res.status).toBe(403);
  });

  it('refuse sur une tournée close', async () => {
    baseType({ statut: 'completed' });
    const res = await request(app).post('/api/tours/7/programme/cav/12/collecte')
      .set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TOURNEE_NON_MODIFIABLE');
  });
});

// ── B. Retour au centre de tri posé par le gestionnaire ───────────────────
describe('POST /:id/programme/retour-centre', () => {
  it.each(['vidage', 'pause_dejeuner', 'fin_tournee'])('pose un retour « %s »', async (motif) => {
    baseType();
    const res = await request(app).post('/api/tours/7/programme/retour-centre')
      .set('Authorization', `Bearer ${adminToken}`).send({ motif });
    expect(res.status).toBe(201);
    expect(res.body.motif).toBe(motif);
    expect(res.body.arret_id).toBe(55);
    expect(res.body.destination.latitude).toBe(49.4231);
    // C'est bien la mécanique partagée avec le chauffeur qui écrit l'étape.
    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO tour_arret_technique/.test(plat(c[0])));
    expect(insert[1]).toContain(motif);
  });

  it('refuse un motif hors liste et le dit', async () => {
    baseType();
    const res = await request(app).post('/api/tours/7/programme/retour-centre')
      .set('Authorization', `Bearer ${adminToken}`).send({ motif: 'café' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MOTIF_INCONNU');
    expect(res.body.motifs_possibles).toEqual(['vidage', 'pause_dejeuner', 'fin_tournee']);
    expect(sqls().some((s) => /INSERT INTO tour_arret_technique/.test(s))).toBe(false);
  });

  it('refuse « depart_centre », qui est posé par le serveur au démarrage', async () => {
    baseType();
    const res = await request(app).post('/api/tours/7/programme/retour-centre')
      .set('Authorization', `Bearer ${adminToken}`).send({ motif: 'depart_centre' });
    expect(res.status).toBe(400);
  });

  it('prévient le chauffeur du nouveau programme', async () => {
    baseType();
    await request(app).post('/api/tours/7/programme/retour-centre')
      .set('Authorization', `Bearer ${adminToken}`).send({ motif: 'vidage' });
    expect(sqls().some((s) => /INSERT INTO driver_messages/.test(s))).toBe(true);
  });

  it('refuse un rôle non habilité', async () => {
    baseType();
    const res = await request(app).post('/api/tours/7/programme/retour-centre')
      .set('Authorization', `Bearer ${collabToken}`).send({ motif: 'vidage' });
    expect(res.status).toBe(403);
  });
});

// ── C. Position du centre de tri ──────────────────────────────────────────
describe('GET /centre-tri', () => {
  it('renvoie la position du référentiel', async () => {
    baseType();
    const res = await request(app).get('/api/tours/centre-tri').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ disponible: true, source: 'referentiel', latitude: 49.4231, longitude: 1.0993 });
  });

  it('dit que la position est inconnue plutôt que d’en inventer une', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM lieux_techniques WHERE categorie = 'centre_tri'/.test(plat(sql))) {
        return Promise.resolve({ rows: [{ id: 4, nom: 'Centre de tri', adresse: null, latitude: null, longitude: null }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).get('/api/tours/centre-tri').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.disponible).toBe(false);
    expect(res.body.latitude).toBeUndefined();
    expect(res.body.motif).toMatch(/coordonnées/);
  });

  it('signale un repli sur les variables d’environnement', async () => {
    mockQuery.mockImplementation(() => Promise.resolve({ rows: [] }));
    const res = await request(app).get('/api/tours/centre-tri').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ disponible: true, source: 'environnement' });
  });

  it('refuse un rôle non habilité', async () => {
    baseType();
    const res = await request(app).get('/api/tours/centre-tri').set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(403);
  });
});

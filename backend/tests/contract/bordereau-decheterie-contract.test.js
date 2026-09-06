// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — bordereau de collecte en déchèterie (chantier 2.50.0)
// ───────────────────────────────────────────────────────────────────────────
// Ce que ce fichier verrouille, et pourquoi :
//
//  1. LE DÉPÔT CÔTÉ CHAUFFEUR est protégé par la garde de périmètre véhicule
//     héritée du chemin « -public » — un chauffeur ne dépose pas un bordereau
//     sur la tournée d'un autre camion.
//  2. UNE VALEUR MAL FORMÉE EST REFUSÉE EN 4xx AVEC SON CODE. C'est une
//     différence de doctrine assumée avec collect-public : la file hors ligne
//     du mobile purge sur 4xx, et un bordereau que le serveur ne peut pas
//     accepter ne doit pas être rejoué indéfiniment.
//  3. LE POIDS INDICATIF N'ENTRE JAMAIS DANS LES PESÉES. L'assertion porte sur
//     les requêtes RÉELLEMENT émises : c'est la seule façon de prouver qu'une
//     estimation de chauffeur ne finira pas dans le tonnage.
//  4. LES NOTIFICATIONS PARTENT APRÈS LA RÉPONSE, et jamais en démonstration.
//  5. LE PDF EST SERVI AVEC SES EN-TÊTES DE PIÈCE SENSIBLE et sa trace de
//     consultation (le document porte deux signatures manuscrites).
//
// Auth réelle (JWT), base mockée : `query` ET `connect` (les écritures sont
// transactionnelles, le mock doit rendre un client { query, release }).
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => ({ query: (...a) => mockClientQuery(...a), release: mockRelease })),
}));

const mockPush = jest.fn().mockResolvedValue({ skipped: true });
jest.mock('../../src/services/push-notifications', () => ({
  sendPushToRoles: (...a) => mockPush(...a),
  sendPushToUser: jest.fn().mockResolvedValue({ skipped: true }),
  isConfigured: () => false,
  getPublicKey: () => null,
}));

const mockMessagerie = jest.fn().mockResolvedValue({ ok: true });
jest.mock('../../src/services/messagerie', () => ({
  envoyerMessageSystemeRoles: (...a) => mockMessagerie(...a),
}));

const mockLogActivity = jest.fn();
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: (...a) => mockLogActivity(...a),
}));

jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({}),
  isRedisAvailable: () => false,
}));

const express = require('express');
const request = require('supertest');

// PNG 1×1 valide — une data URL fabriquée dessus est une signature acceptable.
const PNG_BUF = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64');
const PNG_DATA_URL = `data:image/png;base64,${PNG_BUF.toString('base64')}`;

const driverToken = jwt.sign(
  { id: 4, userId: 4, username: 'driver_5', role: 'COLLABORATEUR', vehicle_id: 5, employee_id: 42 },
  JWT_SECRET, { expiresIn: '1h' });
const adminToken = jwt.sign(
  { id: 1, username: 'admin', role: 'ADMIN', first_name: 'Alice', last_name: 'Dupont' },
  JWT_SECRET, { expiresIn: '1h' });
const managerToken = jwt.sign(
  { id: 2, username: 'manager', role: 'MANAGER' }, JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign(
  { id: 3, username: 'collab', role: 'COLLABORATEUR' }, JWT_SECRET, { expiresIn: '1h' });

let app;
beforeAll(() => {
  app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/tours', require('../../src/routes/tours'));
  app.use('/api/cav', require('../../src/routes/cav'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockRelease.mockReset();
  mockPush.mockClear();
  mockMessagerie.mockClear();
  mockLogActivity.mockClear();
});

/** Contexte renvoyé par la lecture « tournée + point + CAV » du dépôt. */
const CTX_DECHETERIE = {
  tour_id: 90, is_demo: false, vehicle_id: 5, driver_employee_id: 42,
  tour_cav_id: 700, cav_id: 7, cav_nom: 'LE PETIT-QUEVILLY - Déchetterie',
  is_decheterie: true, decheterie_code: 'petit_quevilly',
};

/**
 * Programme le mock : garde de périmètre, contexte, puis idempotence.
 * `apresIdempotence` permet d'enchaîner d'autres réponses (rejeu, etc.).
 */
function amorcerDepot({ ctx = CTX_DECHETERIE, dejaEnregistre = [] } = {}) {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ vehicle_id: 5 }] })  // garde de périmètre véhicule
    .mockResolvedValueOnce({ rows: ctx ? [ctx] : [] })     // contexte tournée + point
    .mockResolvedValueOnce({ rows: dejaEnregistre })       // idempotence client_id
    .mockResolvedValue({ rows: [] });
}

/** Corps valide type. */
function corpsValide(extra = {}) {
  return {
    client_id: 'c0ffee00-1111-4222-8333-444444444444',
    poids_indicatif_kg: 185,
    signature_chauffeur: PNG_DATA_URL,
    signature_agent: PNG_DATA_URL,
    ...extra,
  };
}

const URL_DEPOT = '/api/tours/90/cav/7/bordereau-decheterie-public';

// ═══════════════════════════════════════════════════════════════════════════
describe('POST bordereau-decheterie-public — périmètre et garde du point', () => {
  it('403 : le jeton chauffeur cible la tournée d’un autre véhicule', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ vehicle_id: 9 }] }); // garde de périmètre
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`).send(corpsValide());
    expect(res.status).toBe(403);
    // Refus AVANT toute lecture du bordereau : une seule requête (la garde).
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('401 : sans jeton', async () => {
    const res = await request(app).post(URL_DEPOT).send(corpsValide());
    expect(res.status).toBe(401);
  });

  it('409 POINT_NON_DECHETERIE : le point n’est pas marqué déchèterie', async () => {
    amorcerDepot({ ctx: { ...CTX_DECHETERIE, is_decheterie: false, decheterie_code: null } });
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`).send(corpsValide());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('POINT_NON_DECHETERIE');
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('409 POINT_NON_DECHETERIE : le point n’appartient pas à cette tournée', async () => {
    amorcerDepot({ ctx: { ...CTX_DECHETERIE, tour_cav_id: null, is_decheterie: null } });
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`).send(corpsValide());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('POINT_NON_DECHETERIE');
  });

  it('404 : tournée inconnue', async () => {
    amorcerDepot({ ctx: null });
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`).send(corpsValide());
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST bordereau-decheterie-public — validations (4xx définitifs)', () => {
  const cas = [
    ['POIDS_INVALIDE', { poids_indicatif_kg: 'beaucoup' }],
    ['POIDS_INVALIDE', { poids_indicatif_kg: -5 }],
    ['POIDS_INVALIDE', { poids_indicatif_kg: 60001 }],
    ['POIDS_INVALIDE', { poids_indicatif_kg: null }],
    ['SIGNATURE_INVALIDE', { signature_chauffeur: null }],
    ['SIGNATURE_INVALIDE', { signature_chauffeur: 'data:image/jpeg;base64,AAAA' }],
    ['SIGNATURE_INVALIDE', { signature_chauffeur: 'pas une data url' }],
  ];
  it.each(cas)('400 %s', async (code, patch) => {
    amorcerDepot();
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`).send(corpsValide(patch));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(code);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('400 SIGNATURE_INVALIDE : une signature au-delà de 200 Ko est refusée', async () => {
    amorcerDepot();
    // PNG valide en en-tête, mais gonflé bien au-delà de la borne serveur.
    const gros = Buffer.concat([PNG_BUF, Buffer.alloc(300 * 1024, 0x41)]);
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`)
      .send(corpsValide({ signature_chauffeur: `data:image/png;base64,${gros.toString('base64')}` }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SIGNATURE_INVALIDE');
    expect(res.body.motif).toBe('taille');
  });

  it('400 MOTIF_REQUIS : agent non signataire sans motif', async () => {
    amorcerDepot();
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`)
      .send(corpsValide({ signature_agent: null }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MOTIF_REQUIS');
  });

  it('400 MOTIF_REQUIS : motif hors de la liste fermée', async () => {
    amorcerDepot();
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`)
      .send(corpsValide({ signature_agent: null, agent_absent_motif: 'flemme' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MOTIF_REQUIS');
  });

  it('400 CLIENT_ID_INVALIDE : identifiant de dépôt manquant', async () => {
    amorcerDepot();
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ ...corpsValide(), client_id: undefined });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CLIENT_ID_INVALIDE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST bordereau-decheterie-public — dépôt nominal', () => {
  function amorcerEcriture() {
    // Transaction : BEGIN, numéro, INSERT, COMMIT.
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })                                  // BEGIN
      .mockResolvedValueOnce({ rows: [{ numero: 'BD-2026-0006' }] })        // dernier numéro
      .mockResolvedValueOnce({ rows: [{ id: 12, numero: 'BD-2026-0007', statut: 'a_valider', poids_indicatif_kg: '185.0', date_enlevement: '2026-09-06' }] })
      .mockResolvedValueOnce({ rows: [] });                                 // COMMIT
  }

  it('201 : numéro séquentiel, statut à valider, aucune écriture de pesée', async () => {
    amorcerDepot();
    amorcerEcriture();
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`).send(corpsValide());

    expect(res.status).toBe(201);
    expect(res.body.bordereau).toMatchObject({
      id: 12, numero: 'BD-2026-0007', statut: 'a_valider', poids_indicatif_kg: 185,
    });

    // Le poids est écrit dans la table des bordereaux, et NULLE PART ailleurs.
    const sql = [...mockQuery.mock.calls, ...mockClientQuery.mock.calls].map((c) => String(c[0]));
    expect(sql.some((t) => /INSERT INTO tour_decheterie_bordereaux/.test(t))).toBe(true);
    expect(sql.some((t) => /tour_weights/.test(t))).toBe(false);
    expect(sql.some((t) => /total_weight_kg/.test(t))).toBe(false);
    expect(sql.some((t) => /tonnage_history/.test(t))).toBe(false);
    expect(sql.some((t) => /collection_learning_feedback/.test(t))).toBe(false);

    // Snapshots posés au moment de la collecte + PDF non vide.
    const insert = mockClientQuery.mock.calls.find((c) => /INSERT INTO tour_decheterie_bordereaux/.test(String(c[0])));
    expect(insert[1]).toContain('BD-2026-0007');
    expect(insert[1]).toContain('petit_quevilly');
    expect(insert[1]).toContain('Petit-Quevilly');       // libellé de la case du formulaire
    const pdf = insert[1][insert[1].length - 1];
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('notifie les gestionnaires APRÈS la réponse (push + messagerie + journal)', async () => {
    amorcerDepot();
    amorcerEcriture();
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`).send(corpsValide());
    expect(res.status).toBe(201);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toEqual(['ADMIN', 'MANAGER']);
    expect(mockPush.mock.calls[0][1]).toMatchObject({
      title: 'Collecte en déchèterie', tag: 'bordereau-12',
      data: { url: '/tours?tour=90', tourId: 90 },
    });
    expect(mockPush.mock.calls[0][1].body).toMatch(/BD-2026-0007/);

    expect(mockMessagerie).toHaveBeenCalledTimes(1);
    expect(mockMessagerie.mock.calls[0][0]).toEqual(['ADMIN', 'MANAGER']);
    expect(mockMessagerie.mock.calls[0][1]).toMatchObject({
      source: 'bordereau_decheterie', lien: '/tours?tour=90',
    });

    expect(mockLogActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create', entityType: 'bordereau_decheterie', entityId: 12,
    }));
  });

  it('accepte l’absence de signature de l’agent AVEC son motif', async () => {
    amorcerDepot();
    amorcerEcriture();
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`)
      .send(corpsValide({ signature_agent: null, agent_absent_motif: 'agent_indisponible' }));
    expect(res.status).toBe(201);
    const insert = mockClientQuery.mock.calls.find((c) => /INSERT INTO tour_decheterie_bordereaux/.test(String(c[0])));
    expect(insert[1]).toContain('agent_indisponible');
  });

  it('BD-AAAA-0001 quand l’année n’a encore aucun bordereau', async () => {
    amorcerDepot();
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })                 // BEGIN
      .mockResolvedValueOnce({ rows: [] })                 // aucun numéro cette année
      .mockResolvedValueOnce({ rows: [{ id: 1, numero: 'x', statut: 'a_valider', poids_indicatif_kg: '185.0', date_enlevement: '2026-09-06' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`).send(corpsValide());
    expect(res.status).toBe(201);
    const insert = mockClientQuery.mock.calls.find((c) => /INSERT INTO tour_decheterie_bordereaux/.test(String(c[0])));
    expect(insert[1][0]).toMatch(/^BD-\d{4}-0001$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST bordereau-decheterie-public — idempotence et démonstration', () => {
  it('200 deja_enregistre : un rejeu ne crée jamais un second bordereau', async () => {
    amorcerDepot({ dejaEnregistre: [{ id: 12, numero: 'BD-2026-0007', statut: 'a_valider' }] });
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`).send(corpsValide());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      deja_enregistre: true,
      bordereau: { id: 12, numero: 'BD-2026-0007', statut: 'a_valider' },
    });
    expect(mockClientQuery).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('200 demo : aucune écriture, aucune notification (un exercice ne réveille personne)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ vehicle_id: 5 }] })
      .mockResolvedValueOnce({ rows: [{ ...CTX_DECHETERIE, is_demo: true }] })
      .mockResolvedValue({ rows: [] });
    const res = await request(app).post(URL_DEPOT)
      .set('Authorization', `Bearer ${driverToken}`).send(corpsValide());
    expect(res.status).toBe(200);
    expect(res.body.demo).toBe(true);
    expect(mockClientQuery).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockMessagerie).not.toHaveBeenCalled();
    // Le mode démo est tranché AVANT toute autre lecture (2 requêtes : garde + contexte).
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Back-office — référentiel, listes, PDF, validation', () => {
  it('GET /tours/bordereaux/referentiel-decheteries : les 7 cases dans l’ordre', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/tours/bordereaux/referentiel-decheteries')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.decheteries.map((d) => d.libelle)).toEqual([
      'Cléon', 'Boos', 'Caudebec-lès-Elbeuf', 'Déville-lès-Rouen',
      'Petit-Quevilly', 'Le Trait', 'Saint-Étienne-du-Rouvray',
    ]);
  });

  it('403 : un COLLABORATEUR n’atteint aucune route back-office', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    for (const url of [
      '/api/tours/bordereaux/referentiel-decheteries',
      '/api/tours/90/bordereaux',
      '/api/tours/bordereaux/12/pdf',
      '/api/cav/7/bordereaux',
    ]) {
      const res = await request(app).get(url).set('Authorization', `Bearer ${collabToken}`);
      expect([403, 404]).toContain(res.status);
      expect(res.status).toBe(403);
    }
  });

  it('GET /tours/:id/bordereaux : résumés sans aucun BYTEA', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 12, numero: 'BD-2026-0007', tour_id: 90, tour_cav_id: 700, cav_id: 7,
        vehicle_id: 5, date_enlevement: '2026-09-04', decheterie_code: 'petit_quevilly',
        decheterie_libelle: 'Petit-Quevilly', cav_nom: 'Déchetterie', poids_indicatif_kg: '185.0',
        signature_agent_presente: true, signature_agent_absente_motif: null,
        signature_chauffeur_presente: true, signature_chauffeur_absente_motif: null,
        statut: 'a_valider', valide_le: null, pdf_genere_le: 'x', created_at: 'y',
        valide_par_nom: null,
      }],
    });
    const res = await request(app).get('/api/tours/90/bordereaux')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const b = res.body.bordereaux[0];
    expect(b.poids_indicatif_kg).toBe(185);   // nombre, pas la chaîne de PostgreSQL
    expect(b.signature_agent_presente).toBe(true);
    expect(b).not.toHaveProperty('pdf');
    expect(b).not.toHaveProperty('signature_agent');
    expect(b).not.toHaveProperty('signature_chauffeur');
    // La requête ne demande jamais les colonnes binaires.
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).not.toMatch(/\bb\.pdf\b/);
    expect(sql).toMatch(/signature_agent IS NOT NULL/);
  });

  it('GET /tours/bordereaux/:bid/pdf : en-têtes de pièce sensible + trace de consultation', async () => {
    const faux = Buffer.from('%PDF-1.3 faux document');
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 12, numero: 'BD-2026-0007', pdf: faux, tour_id: 90, cav_id: 7 }] })
      .mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/tours/bordereaux/12/pdf')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toBe('inline; filename="bordereau-BD-2026-0007.pdf"');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');

    const audit = mockQuery.mock.calls.find((c) => /INSERT INTO rgpd_audit_log/.test(String(c[0])));
    expect(audit).toBeDefined();
    expect(audit[1][1]).toBe('BORDEREAU_DECHETERIE_CONSULTE');
    expect(audit[1][2]).toBe('tour_decheterie_bordereaux');
    expect(audit[1][3]).toBe(12);
    expect(mockLogActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'view', entityType: 'bordereau_decheterie', entityId: 12,
    }));
  });

  it('404 : PDF d’un bordereau inconnu', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/tours/bordereaux/999/pdf')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  const LIGNE_A_VALIDER = {
    id: 12, numero: 'BD-2026-0007', tour_id: 90, tour_cav_id: 700, cav_id: 7, vehicle_id: 5,
    driver_employee_id: 42, client_id: 'c1', date_enlevement: '2026-09-04',
    decheterie_code: 'petit_quevilly', decheterie_libelle: 'Petit-Quevilly',
    cav_nom: 'Déchetterie', poids_indicatif_kg: '185.0',
    signature_agent: PNG_BUF, signature_agent_absente_motif: null,
    signature_chauffeur: PNG_BUF, signature_chauffeur_absente_motif: null,
    remarques: null, statut: 'a_valider', pdf_genere_le: 'x', valide_par: null,
    valide_le: null, created_at: 'y', vehicule: 'AB-123-CD',
  };

  it('POST /tours/bordereaux/:bid/valider : statut validé et PDF RÉGÉNÉRÉ', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })                     // BEGIN
      .mockResolvedValueOnce({ rows: [LIGNE_A_VALIDER] })      // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ ...LIGNE_A_VALIDER, statut: 'valide', valide_le: 'z',
        signature_agent_presente: true, signature_chauffeur_presente: true }] })  // UPDATE
      .mockResolvedValueOnce({ rows: [] });                    // COMMIT

    const res = await request(app).post('/api/tours/bordereaux/12/valider')
      .set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.bordereau.statut).toBe('valide');
    expect(res.body.bordereau.valide_par_nom).toBe('Alice Dupont');

    const upd = mockClientQuery.mock.calls.find((c) => /UPDATE tour_decheterie_bordereaux/.test(String(c[0])));
    expect(String(upd[0])).toMatch(/statut = 'valide'/);
    // Le PDF est bien réécrit : un statut en base sans document régénéré
    // laisserait circuler un bordereau sans sa mention de validation.
    const pdf = upd[1][1];
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.slice(0, 5).toString()).toBe('%PDF-');
    // Ni le poids ni les signatures ne sont touchés.
    expect(String(upd[0])).not.toMatch(/poids_indicatif_kg\s*=/);
    expect(String(upd[0])).not.toMatch(/signature_(agent|chauffeur)\s*=/);

    const audit = mockQuery.mock.calls.find((c) => /INSERT INTO rgpd_audit_log/.test(String(c[0])));
    expect(audit[1][1]).toBe('BORDEREAU_DECHETERIE_VALIDE');
  });

  it('409 BORDEREAU_DEJA_VALIDE : une seconde validation est refusée', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...LIGNE_A_VALIDER, statut: 'valide', valide_le: '2026-09-05' }] })
      .mockResolvedValue({ rows: [] });
    const res = await request(app).post('/api/tours/bordereaux/12/valider')
      .set('Authorization', `Bearer ${managerToken}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BORDEREAU_DEJA_VALIDE');
    // Rien n'a été réécrit.
    expect(mockClientQuery.mock.calls.some((c) => /UPDATE tour_decheterie_bordereaux/.test(String(c[0])))).toBe(false);
  });

  it('404 : validation d’un bordereau inconnu', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    mockClientQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValue({ rows: [] });
    const res = await request(app).post('/api/tours/bordereaux/999/valider')
      .set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(404);
  });

  it('GET /cav/:id/bordereaux : historique du point, avec tournée et véhicule', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 12, numero: 'BD-2026-0007', tour_id: 90, cav_id: 7, cav_nom: 'Déchetterie',
        decheterie_code: null, decheterie_libelle: 'ROUEN - Déchetterie',
        date_enlevement: '2026-09-04', poids_indicatif_kg: '90.5',
        signature_agent_presente: false, signature_agent_absente_motif: 'agent_indisponible',
        signature_chauffeur_presente: true, signature_chauffeur_absente_motif: null,
        statut: 'valide', valide_le: 'z', pdf_genere_le: 'x', created_at: 'y',
        tour_date: '2026-09-04', vehicule: 'AB-123-CD Master', valide_par_nom: 'Alice Dupont',
      }],
    });
    const res = await request(app).get('/api/cav/7/bordereaux')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    const b = res.body.bordereaux[0];
    expect(b).toMatchObject({
      numero: 'BD-2026-0007', tour_id: 90, tour_date: '2026-09-04',
      vehicule: 'AB-123-CD Master', statut: 'valide', poids_indicatif_kg: 90.5,
      signature_agent_presente: false, signature_agent_absente_motif: 'agent_indisponible',
      decheterie_code: null,
    });
    expect(b).not.toHaveProperty('pdf');
  });

  it('base non migrée : la fiche continue de s’afficher (liste vide, pas 500)', async () => {
    const err = new Error('relation "tour_decheterie_bordereaux" does not exist');
    err.code = '42P01';
    mockQuery.mockRejectedValueOnce(err);
    const res = await request(app).get('/api/cav/7/bordereaux')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.bordereaux).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Marquage déchèterie du référentiel CAV', () => {
  it('400 DECHETERIE_CODE_INVALIDE : case inconnue du formulaire', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app).put('/api/cav/7')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_decheterie: true, decheterie_code: 'mon_village' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DECHETERIE_CODE_INVALIDE');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('PUT : marque le point et pose la case du formulaire', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 7, is_decheterie: true, decheterie_code: 'boos' }] });
    const res = await request(app).put('/api/cav/7')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_decheterie: true, decheterie_code: 'boos' });
    expect(res.status).toBe(200);
    const upd = mockQuery.mock.calls.find((c) => /UPDATE cav SET/.test(String(c[0])));
    expect(String(upd[0])).toMatch(/is_decheterie = \$\d+/);
    expect(String(upd[0])).toMatch(/decheterie_code = \$\d+/);
    expect(upd[1]).toContain('boos');
  });

  it('PUT : décocher la case remet le code à NULL (jamais de code orphelin)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 7 }] });
    const res = await request(app).put('/api/cav/7')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_decheterie: false, decheterie_code: 'boos' });
    expect(res.status).toBe(200);
    const upd = mockQuery.mock.calls.find((c) => /UPDATE cav SET/.test(String(c[0])));
    expect(upd[1]).toContain(false);
    expect(upd[1]).not.toContain('boos');
    expect(upd[1]).toContain(null);
  });

  it('PUT sans le champ : le marquage n’est pas touché', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 7 }] });
    await request(app).put('/api/cav/7')
      .set('Authorization', `Bearer ${adminToken}`).send({ name: 'Nouveau nom' });
    const upd = mockQuery.mock.calls.find((c) => /UPDATE cav SET/.test(String(c[0])));
    expect(String(upd[0])).not.toMatch(/is_decheterie/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GARDE ANTI-RÉCIDIVE — payload mobile décoré par `decorerDecheterie`
// ───────────────────────────────────────────────────────────────────────────
// TROUVÉ PAR CONTRE-ÉPREUVE (agent de debug, 06/09/2026) : retirer l'appel à
// `decorerDecheterie` de `GET /api/tours/:id/public` (routes/tours/index.js)
// ne faisait tomber AUCUN test de ce fichier — la moitié « dépôt du bordereau »
// était couverte, la moitié « le chauffeur SAIT qu'il doit en déposer un »
// (contrat §2.2) ne l'était pas. Un chauffeur sur un serveur régressé aurait
// vu un point déchèterie strictement identique à une borne ordinaire.
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /api/tours/:id/public — décoration déchèterie du payload mobile (§2.2)', () => {
  const { resetPhotoFraicheurCache } = require('../../src/utils/cav-photo');

  function mockPublicPayload({ cavRow, decoInfo }) {
    mockQuery.mockImplementation((sql, params) => {
      const t = String(sql);
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(t)) return Promise.resolve({ rows: [] });
      // Garde de périmètre véhicule (middleware MOBILE_DRIVER_PATH).
      if (/SELECT vehicle_id FROM tours WHERE id/.test(t)) return Promise.resolve({ rows: [{ vehicle_id: 5 }] });
      // Fraîcheur photo (settings) — AVANT decorerDecheterie dans decoratePhotoState.
      if (/FROM settings WHERE key/.test(t)) return Promise.resolve({ rows: [] });
      // Tournée + véhicule.
      if (/FROM tours t JOIN vehicles v/.test(t)) {
        return Promise.resolve({ rows: [{ id: 90, vehicle_id: 5, collection_type: 'cav', status: 'in_progress' }] });
      }
      // decorerDecheterie : distinguée de la requête de points par `c.is_decheterie`.
      if (/c\.is_decheterie/.test(t)) return Promise.resolve({ rows: decoInfo ? [decoInfo] : [] });
      // Points de la tournée (tc.* + colonnes CAV) : ne doit PAS matcher la ligne ci-dessus.
      if (/FROM tour_cav tc JOIN cav c/.test(t)) return Promise.resolve({ rows: cavRow ? [cavRow] : [] });
      if (/FROM tour_arret_technique ta/.test(t)) return Promise.resolve({ rows: [] });
      if (/FROM lieux_techniques/.test(t)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
  }

  beforeEach(() => { resetPhotoFraicheurCache(); });

  it('point marqué déchèterie (code connu) : is_decheterie, decheterie_libelle, bordereau_deja_depose=false', async () => {
    mockPublicPayload({
      cavRow: { id: 700, tour_id: 90, cav_id: 7, position: 1, status: 'pending', cav_name: 'LE PETIT-QUEVILLY - Déchetterie' },
      decoInfo: { cav_id: 7, is_decheterie: true, decheterie_code: 'petit_quevilly', bordereau_deja_depose: false },
    });
    const res = await request(app).get('/api/tours/90/public').set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    const point = res.body.cavs[0];
    expect(point.is_decheterie).toBe(true);
    expect(point.decheterie_libelle).toBe('Petit-Quevilly');
    expect(point.bordereau_deja_depose).toBe(false);
  });

  it('un bordereau déjà déposé pour ce passage : bordereau_deja_depose=true', async () => {
    mockPublicPayload({
      cavRow: { id: 700, tour_id: 90, cav_id: 7, position: 1, status: 'collected', cav_name: 'LE PETIT-QUEVILLY - Déchetterie' },
      decoInfo: { cav_id: 7, is_decheterie: true, decheterie_code: 'petit_quevilly', bordereau_deja_depose: true },
    });
    const res = await request(app).get('/api/tours/90/public').set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(res.body.cavs[0].bordereau_deja_depose).toBe(true);
  });

  it('point ORDINAIRE (non déchèterie) : is_decheterie=false, decheterie_libelle=null', async () => {
    mockPublicPayload({
      cavRow: { id: 701, tour_id: 90, cav_id: 8, position: 1, status: 'pending', cav_name: 'Borne de rue' },
      decoInfo: { cav_id: 8, is_decheterie: false, decheterie_code: null, bordereau_deja_depose: false },
    });
    const res = await request(app).get('/api/tours/90/public').set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    const point = res.body.cavs[0];
    expect(point.is_decheterie).toBe(false);
    expect(point.decheterie_libelle).toBeNull();
  });
});

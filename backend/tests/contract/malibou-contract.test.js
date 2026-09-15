// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — SYNCHRONISATION MALIBOU (API de paie)
// ───────────────────────────────────────────────────────────────────────────
// Trois invariants, chacun avec un coût réel s'il tombe :
//
//   1. LA CLÉ NE SORT JAMAIS. Elle donne accès en lecture à tout l'annuaire du
//      personnel de la structure chez le prestataire de paie. Aucune route ne
//      la rend, même à un ADMIN, même en aperçu complet.
//   2. ADMIN STRICT. Ces routes écrivent dans les dossiers du personnel.
//   3. LA SIMULATION EST LE DÉFAUT. Un POST sans `{appliquer:true}` ne doit
//      rien écrire : c'est son compte rendu qu'on lit avant de se décider.
//
// Auth réelle (JWT), services Malibou simulés — le client, lui, est éprouvé
// contre un vrai serveur HTTP dans tests/unit/malibou-client.test.js.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(),
}));
jest.mock('../../src/config/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));
jest.mock('../../src/services/malibou', () => ({
  statut: jest.fn(),
  listerCollaborateurs: jest.fn(),
}));
jest.mock('../../src/services/malibou-sync', () => ({ synchroniserTout: jest.fn() }));

const express = require('express');
const request = require('supertest');
const malibou = require('../../src/services/malibou');
const sync = require('../../src/services/malibou-sync');

const tokenFor = (role) => jwt.sign(
  { id: 1, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' },
);
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), COLLABORATEUR: tokenFor('COLLABORATEUR') };

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/malibou', require('../../src/routes/malibou'));
});

const CONFIGURE = {
  configure: true, cle_presente: true, cle_apercu: 'mlb_••••••1a2b',
  base_url: 'https://app.malibou.com/api/public/v1', mode_auth: 'bearer',
  organization_id: 'org-42', manques: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
  malibou.statut.mockResolvedValue(CONFIGURE);
  malibou.listerCollaborateurs.mockResolvedValue([{ id: 'clb_1' }]);
  sync.synchroniserTout.mockResolvedValue({
    applique: false, duree_ms: 12,
    collaborateurs: { lus: 2, convertis: 2, crees: 0, maj: 0, erreurs: [], avertissements: [] },
    absences: { lues: 3, a_ecrire: 3, crees: 0, maj: 0, codes_inconnus: [], avertissements: [] },
  });
});

const get = (p, role = 'ADMIN') => request(app).get(p).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (p, role, body = {}) => request(app).post(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

describe('habilitation — ADMIN strict', () => {
  it.each(['/api/malibou/statut', '/api/malibou/essai'])('%s : RH et COLLABORATEUR sont refusés', async (chemin) => {
    expect((await get(chemin, 'RH')).status).toBe(403);
    expect((await get(chemin, 'COLLABORATEUR')).status).toBe(403);
    expect((await get(chemin, 'ADMIN')).status).toBe(200);
  });

  it('le déclenchement est refusé à RH — et AUCUNE synchro n\'est lancée', async () => {
    const r = await post('/api/malibou/synchroniser', 'RH', { appliquer: true });
    expect(r.status).toBe(403);
    // Le refus doit tomber AVANT l'action : un refus d'affichage après
    // écriture ne serait pas un refus d'accès.
    expect(sync.synchroniserTout).not.toHaveBeenCalled();
  });

  it('sans jeton du tout : 401', async () => {
    expect((await request(app).get('/api/malibou/statut')).status).toBe(401);
  });
});

describe('la clé d\'API ne sort jamais', () => {
  it('le statut ne rend qu\'un aperçu masqué', async () => {
    const r = await get('/api/malibou/statut');
    expect(r.body.cle_apercu).toBe('mlb_••••••1a2b');
    expect(JSON.stringify(r.body)).not.toMatch(/cle_claire|api_key|"cle"/);
  });

  it('aucune route n\'écrit ni ne lit la clé', async () => {
    // La clé se pose par `configurer-malibou.js`, sur l'entrée standard : une
    // route la ferait passer par un journal de requêtes.
    const routeur = require('../../src/routes/malibou');
    const chemins = routeur.stack.filter((c) => c.route).map((c) => `${Object.keys(c.route.methods)[0]} ${c.route.path}`);
    expect(chemins.sort()).toEqual(['get /essai', 'get /statut', 'post /synchroniser']);
  });
});

describe('configuration incomplète — on dit CE QUI manque', () => {
  it('400 motivé, et aucune synchronisation lancée', async () => {
    malibou.statut.mockResolvedValue({ ...CONFIGURE, configure: false, manques: ["identifiant d'organisation"] });
    const r = await post('/api/malibou/synchroniser', 'ADMIN', { appliquer: true });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('MALIBOU_NON_CONFIGURE');
    expect(r.body.manques).toContain("identifiant d'organisation");
    expect(sync.synchroniserTout).not.toHaveBeenCalled();
  });
});

describe('simulation par défaut', () => {
  it('un POST nu simule — il n\'applique PAS', async () => {
    const r = await post('/api/malibou/synchroniser', 'ADMIN');
    expect(r.status).toBe(200);
    expect(sync.synchroniserTout).toHaveBeenCalledWith({ appliquer: false });
  });

  it.each([['true (chaîne)', 'true'], ['1', 1], ['objet', {}]])(
    'seul le booléen vrai applique — %s ne suffit pas', async (_nom, valeur) => {
      await post('/api/malibou/synchroniser', 'ADMIN', { appliquer: valeur });
      expect(sync.synchroniserTout).toHaveBeenCalledWith({ appliquer: false });
    },
  );

  it('{ appliquer: true } applique', async () => {
    await post('/api/malibou/synchroniser', 'ADMIN', { appliquer: true });
    expect(sync.synchroniserTout).toHaveBeenCalledWith({ appliquer: true });
  });
});

describe('essai de connexion', () => {
  it('ne rend PAS l\'annuaire, juste le fait qu\'on voie quelqu\'un', async () => {
    malibou.listerCollaborateurs.mockResolvedValue([
      { id: 'clb_1', firstName: 'Alex', lastName: 'DURAND', email: 'alex@ex.fr' },
    ]);
    const r = await get('/api/malibou/essai');
    expect(r.body).toEqual({ ok: true, collaborateurs_visibles: true });
    expect(JSON.stringify(r.body)).not.toMatch(/DURAND|alex@ex\.fr|clb_1/);
  });

  it('relaie le motif du refus plutôt qu\'un « erreur » opaque', async () => {
    const e = new Error('Clé Malibou refusée (401) — vérifier la clé et son organisation');
    e.code = 'MALIBOU_AUTH'; e.status = 401;
    malibou.listerCollaborateurs.mockRejectedValue(e);
    const r = await get('/api/malibou/essai');
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'MALIBOU_AUTH', status: 401 });
    expect(r.body.error).toMatch(/vérifier la clé/);
  });

  it('une panne du prestataire est un 502, pas un 400 de notre fait', async () => {
    const e = new Error('Malibou indisponible'); e.status = 503;
    malibou.listerCollaborateurs.mockRejectedValue(e);
    expect((await get('/api/malibou/essai')).status).toBe(502);
  });
});

describe('compte rendu', () => {
  it('rend le bilan des deux volets tel quel', async () => {
    const r = await post('/api/malibou/synchroniser', 'ADMIN', { appliquer: true });
    expect(r.body.collaborateurs).toMatchObject({ lus: 2, convertis: 2 });
    expect(r.body.absences).toMatchObject({ lues: 3, a_ecrire: 3 });
  });

  it('un échec de synchronisation est un 502 qui NOMME la cause', async () => {
    const e = new Error('pagination interrompue'); e.code = 'MALIBOU_ERREUR';
    sync.synchroniserTout.mockRejectedValue(e);
    const r = await post('/api/malibou/synchroniser', 'ADMIN', { appliquer: true });
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/pagination interrompue/);
  });
});

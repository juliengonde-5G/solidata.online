// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — MODULE ENQUÊTES (RSEI-13)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la forme de réponse, la matrice d'habilitations et — surtout — les
// deux invariants du 30e module (routes/enquetes.js) :
//   1. SURFACE PUBLIQUE anonyme SANS auth (GET/POST /public/:token) montée avant
//      authenticate (pattern webhook SumUp) ;
//   2. SEUIL D'ANONYMAT n ≥ 5 sur la restitution (GET /campagnes/:id/resultats) :
//      < 5 réponses → { n, sous_seuil:true } sans distribution ; ≥ 5 → distribution.
//   + oracle computeResultats / nuageMots, verbatims bruts SEULEMENT si anonyme.
//
// Auth réelle (JWT sans `tv`), DB mockée, activity-logger mocké. Même harnais que
// energie-contract.test.js / rse-contract.test.js.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
const mockConnect = jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} }));
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

const enquetes = require('../../src/routes/enquetes');
const tokenFor = (role) => jwt.sign({ id: 1, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER'),
  QHSE: tokenFor('QHSE'), COLLABORATEUR: tokenFor('COLLABORATEUR'),
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/enquetes', enquetes);
});
beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (path, role, body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const put = (path, role, body = {}) => request(app).put(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const del = (path, role) => request(app).delete(path).set('Authorization', `Bearer ${TOKENS[role]}`);
// Surface publique : AUCUN header d'authentification.
const pubGet = (path) => request(app).get(path);
const pubPost = (path, body = {}) => request(app).post(path).send(body);

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'; // hex 32

// ───────────────────────────────────────────────────────────────────────────
// ORACLE computeResultats — seuil d'anonymat + agrégats
// ───────────────────────────────────────────────────────────────────────────
describe('ORACLE computeResultats (seuil n ≥ 5)', () => {
  const QUESTIONS = [
    { id: 1, ordre: 1, libelle: 'Note globale', type: 'note_10' },
    { id: 2, ordre: 2, libelle: 'Recommande', type: 'oui_non' },
    { id: 3, ordre: 3, libelle: 'Sujets à traiter', type: 'choix_multiple' },
    { id: 4, ordre: 4, libelle: 'Remarque libre', type: 'texte' },
  ];
  const R5 = [
    { 1: 8, 2: 'oui', 3: ['a', 'b'], 4: 'super ambiance équipe' },
    { 1: 6, 2: 'non', 3: ['a'], 4: 'bruit atelier trop fort' },
    { 1: 10, 2: 'oui', 3: ['b', 'c'], 4: 'ambiance super' },
    { 1: 4, 2: 'oui', 3: [], 4: '' },
    { 1: 7, 2: 'non', 3: ['a'], 4: 'plus de pauses' },
  ];

  it('n < 5 → { n, sous_seuil:true } SANS distribution', () => {
    const r = enquetes.computeResultats(QUESTIONS, R5.slice(0, 4), true);
    expect(r.n).toBe(4);
    expect(r.sous_seuil).toBe(true);
    expect(r.seuil).toBe(5);
    expect(r.questions).toBeUndefined();
  });

  it('n = 5 → distribution par question (comptages/moyennes)', () => {
    const r = enquetes.computeResultats(QUESTIONS, R5, true);
    expect(r.sous_seuil).toBe(false);
    expect(r.n).toBe(5);
    expect(r.questions).toHaveLength(4);

    const note = r.questions.find((q) => q.question_id === 1);
    expect(note.moyenne).toBe(7); // (8+6+10+4+7)/5
    expect(note.min).toBe(4);
    expect(note.max).toBe(10);
    expect(note.distribution['8']).toBe(1);

    const reco = r.questions.find((q) => q.question_id === 2);
    expect(reco.distribution).toEqual({ oui: 3, non: 2 });

    const sujets = r.questions.find((q) => q.question_id === 3);
    expect(sujets.distribution).toEqual({ a: 3, b: 2, c: 1 });
    expect(sujets.n_reponses).toBe(4); // r4 avec [] exclu
  });

  it('texte : verbatims bruts SEULEMENT si anonyme + nuage de mots toujours', () => {
    const anon = enquetes.computeResultats(QUESTIONS, R5, true).questions.find((q) => q.question_id === 4);
    expect(anon.reponses_texte).toHaveLength(4); // '' exclu
    expect(Array.isArray(anon.nuage_mots)).toBe(true);
    expect(anon.nuage_mots.find((w) => w.mot === 'ambiance').count).toBe(2);

    const nonAnon = enquetes.computeResultats(QUESTIONS, R5, false).questions.find((q) => q.question_id === 4);
    expect(nonAnon.reponses_texte).toBeUndefined(); // pas de brut si non anonyme
    expect(Array.isArray(nonAnon.nuage_mots)).toBe(true); // agrégat conservé
  });
});

describe('ORACLE nuageMots', () => {
  it('normalise les accents, exclut les stop-mots et les mots ≤ 2 lettres', () => {
    const nuage = enquetes.nuageMots(['Très bonne ambiance', 'ambiance agréable et de qualité']);
    const byMot = Object.fromEntries(nuage.map((w) => [w.mot, w.count]));
    expect(byMot.ambiance).toBe(2);
    expect(byMot.tres).toBeUndefined(); // 'très' = stop-mot
    expect(byMot.et).toBeUndefined();   // ≤ 2 lettres
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SURFACE PUBLIQUE — SANS authentification (montée avant authenticate)
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT surface publique /public/:token (SANS auth)', () => {
  it('GET /public/:token : campagne ouverte → 200 (aucun token JWT requis)', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/m\.id AS modele_id/.test(s)) {
        return Promise.resolve({ rowCount: 1, rows: [{
          id: 3, titre: 'QVCT 2027', public_cible: 'Tous salariés', statut: 'ouverte',
          date_ouverture: '2027-01-01', date_cloture: null,
          modele_id: 7, modele_titre: 'Conditions de travail', modele_description: null,
          modele_categorie: 'qvct', modele_anonyme: true,
        }] });
      }
      if (/FROM enquete_questions WHERE modele_id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 1, ordre: 1, libelle: 'Note', type: 'note_10', options: [], obligatoire: true }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await pubGet(`/api/enquetes/public/${TOKEN}`);
    expect(res.status).toBe(200); // preuve : pas de 401 → route bien publique
    expect(res.body.modele.anonyme).toBe(true);
    expect(res.body.questions).toHaveLength(1);
  });

  it('GET /public/:token : token inconnu / campagne close → 404', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/m\.id AS modele_id/.test(String(sql))) return Promise.resolve({ rowCount: 0, rows: [] });
      return Promise.resolve({ rows: [] });
    });
    expect((await pubGet(`/api/enquetes/public/${TOKEN}`)).status).toBe(404);
  });

  it('POST /public/:token : réponse anonyme valide → 201 { received:true }', async () => {
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT c\.id, c\.statut, c\.modele_id, m\.anonyme/.test(s)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 3, statut: 'ouverte', modele_id: 7, anonyme: true }] });
      }
      if (/FROM enquete_questions WHERE modele_id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 1, libelle: 'Note', type: 'note_10', obligatoire: true }] });
      }
      if (/INSERT INTO enquete_reponses/.test(s)) {
        return Promise.resolve({ rows: [{ id: 42, submitted_at: '2027-02-01T10:00:00Z' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await pubPost(`/api/enquetes/public/${TOKEN}`, { reponses: { 1: 8 } });
    expect(res.status).toBe(201);
    expect(res.body.received).toBe(true);
    expect(res.body.id).toBe(42);
  });

  it('POST /public/:token : question obligatoire sans réponse → 400 (validation serveur)', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT c\.id, c\.statut, c\.modele_id, m\.anonyme/.test(s)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 3, statut: 'ouverte', modele_id: 7, anonyme: true }] });
      }
      if (/FROM enquete_questions WHERE modele_id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 1, libelle: 'Note', type: 'note_10', obligatoire: true }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await pubPost(`/api/enquetes/public/${TOKEN}`, { reponses: {} });
    expect(res.status).toBe(400);
    expect(res.body.manquantes[0].question_id).toBe(1);
  });

  it('POST /public/:token : campagne non ouverte (brouillon) → 403', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT c\.id, c\.statut, c\.modele_id, m\.anonyme/.test(String(sql))) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 3, statut: 'brouillon', modele_id: 7, anonyme: true }] });
      }
      return Promise.resolve({ rows: [] });
    });
    expect((await pubPost(`/api/enquetes/public/${TOKEN}`, { reponses: { 1: 8 } })).status).toBe(403);
  });

  it('POST /public/:token : jeton d\'unicité déjà utilisé (23505) → 409', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT c\.id, c\.statut, c\.modele_id, m\.anonyme/.test(s)) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 3, statut: 'ouverte', modele_id: 7, anonyme: true }] });
      }
      if (/FROM enquete_questions WHERE modele_id/.test(s)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO enquete_reponses/.test(s)) { const e = new Error('dup'); e.code = '23505'; return Promise.reject(e); }
      return Promise.resolve({ rows: [] });
    });
    const res = await pubPost(`/api/enquetes/public/${TOKEN}`, { reponses: {}, jeton_unicite: 'poste-3' });
    expect(res.status).toBe(409);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// MODÈLES — habilitations (lecture ADMIN/MANAGER/RH/QHSE, écriture + QHSE)
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /enquetes/modeles (habilitations)', () => {
  it('GET /modeles : lecture ADMIN/MANAGER/RH/QHSE, refusée COLLABORATEUR (403)', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'RH', 'QHSE']) {
      expect((await get('/api/enquetes/modeles', role)).status).toBe(200);
    }
    expect((await get('/api/enquetes/modeles', 'COLLABORATEUR')).status).toBe(403);
  });

  it('POST /modeles : QHSE (QVCT) → 201 ; COLLABORATEUR → 403 ; catégorie hors enum → 400', async () => {
    expect((await post('/api/enquetes/modeles', 'COLLABORATEUR', { titre: 'X' })).status).toBe(403);
    expect((await post('/api/enquetes/modeles', 'QHSE', { titre: 'X', categorie: 'inconnu' })).status).toBe(400);
    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO enquete_modeles/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 1, titre: params[0], categorie: params[2], anonyme: params[3] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/enquetes/modeles', 'QHSE', { titre: 'Conditions de travail', categorie: 'qvct' });
    expect(res.status).toBe(201);
    expect(res.body.categorie).toBe('qvct');
    expect(res.body.anonyme).toBe(true); // défaut
  });

  it('DELETE /modeles/:id : référencé par une campagne (23503) → 409', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/DELETE FROM enquete_modeles/.test(String(sql))) { const e = new Error('fk'); e.code = '23503'; return Promise.reject(e); }
      return Promise.resolve({ rows: [] });
    });
    expect((await del('/api/enquetes/modeles/1', 'ADMIN')).status).toBe(409);
  });

  it('POST /modeles/:id/questions : type hors enum → 400 ; RH valide → 201', async () => {
    expect((await post('/api/enquetes/modeles/1/questions', 'RH', { libelle: 'Q', type: 'radio' })).status).toBe(400);
    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO enquete_questions/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 5, modele_id: params[0], libelle: params[2], type: params[3] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/enquetes/modeles/1/questions', 'RH', { libelle: 'Ambiance ?', type: 'echelle', options: ['1', '2', '3'] });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('echelle');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// CAMPAGNES — génération du token + transitions de statut
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /enquetes/campagnes', () => {
  it('POST /campagnes : génère un token hex 32 imprévisible + lien public', async () => {
    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO enquete_campagnes/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 9, modele_id: params[0], titre: params[1], token: params[3], statut: params[6] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/enquetes/campagnes', 'MANAGER', { modele_id: 7, titre: 'QVCT 2027' });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[a-f0-9]{32}$/); // 128 bits, imprévisible
    expect(res.body.statut).toBe('brouillon'); // défaut
    expect(res.body.lien_public).toContain(res.body.token);
  });

  it('POST /campagnes : modèle inconnu (23503) → 400', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/INSERT INTO enquete_campagnes/.test(String(sql))) { const e = new Error('fk'); e.code = '23503'; return Promise.reject(e); }
      return Promise.resolve({ rows: [] });
    });
    expect((await post('/api/enquetes/campagnes', 'ADMIN', { modele_id: 999, titre: 'X' })).status).toBe(400);
  });

  it('PUT /campagnes/:id : transition brouillon→close INVALIDE → 409 ; brouillon→ouverte OK → 200', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT statut FROM enquete_campagnes/.test(String(sql))) return Promise.resolve({ rowCount: 1, rows: [{ statut: 'brouillon' }] });
      if (/UPDATE enquete_campagnes SET/.test(String(sql))) return Promise.resolve({ rowCount: 1, rows: [{ id: 9, statut: 'ouverte', token: TOKEN }] });
      return Promise.resolve({ rows: [] });
    });
    expect((await put('/api/enquetes/campagnes/9', 'MANAGER', { statut: 'close' })).status).toBe(409);
    const ok = await put('/api/enquetes/campagnes/9', 'MANAGER', { statut: 'ouverte' });
    expect(ok.status).toBe(200);
    expect(ok.body.statut).toBe('ouverte');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// RÉSULTATS — SEUIL D'ANONYMAT n ≥ 5 (HTTP, bout en bout)
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /enquetes/campagnes/:id/resultats (seuil n ≥ 5)', () => {
  const wire = (nbReponses, anonyme = true) => (sql) => {
    const s = String(sql);
    if (/FROM enquete_campagnes c JOIN enquete_modeles/.test(s)) {
      return Promise.resolve({ rowCount: 1, rows: [{
        id: 1, titre: 'QVCT', public_cible: 'Tous', statut: 'close', date_ouverture: null, date_cloture: null,
        modele_id: 7, modele_titre: 'QVCT', modele_categorie: 'qvct', modele_anonyme: anonyme,
      }] });
    }
    if (/FROM enquete_questions WHERE modele_id/.test(s)) {
      return Promise.resolve({ rows: [
        { id: 1, ordre: 1, libelle: 'Note', type: 'note_10', options: [] },
        { id: 4, ordre: 2, libelle: 'Remarque', type: 'texte', options: [] },
      ] });
    }
    if (/FROM enquete_reponses WHERE campagne_id/.test(s)) {
      const rows = [];
      for (let i = 0; i < nbReponses; i++) rows.push({ reponses: { 1: 5 + (i % 5), 4: `avis ambiance ${i}` } });
      return Promise.resolve({ rows });
    }
    return Promise.resolve({ rows: [] });
  };

  it('< 5 réponses → sous_seuil:true SANS distribution (anonymat protégé)', async () => {
    mockQuery.mockImplementation(wire(3));
    const res = await get('/api/enquetes/campagnes/1/resultats', 'QHSE');
    expect(res.status).toBe(200);
    expect(res.body.n).toBe(3);
    expect(res.body.sous_seuil).toBe(true);
    expect(res.body.questions).toBeUndefined();
  });

  it('≥ 5 réponses → distribution par question + verbatims (modèle anonyme)', async () => {
    mockQuery.mockImplementation(wire(6, true));
    const res = await get('/api/enquetes/campagnes/1/resultats', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.sous_seuil).toBe(false);
    expect(res.body.n).toBe(6);
    expect(res.body.questions).toHaveLength(2);
    const texte = res.body.questions.find((q) => q.question_id === 4);
    expect(texte.reponses_texte).toHaveLength(6); // brut car anonyme
  });

  it('COLLABORATEUR → 403 (résultats réservés à la lecture du module)', async () => {
    expect((await get('/api/enquetes/campagnes/1/resultats', 'COLLABORATEUR')).status).toBe(403);
  });
});

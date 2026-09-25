// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — NOTES / COMMENTAIRES DE SUIVI (journal d'accompagnement CIP)
// ───────────────────────────────────────────────────────────────────────────
// Ce que ces tests tiennent :
//   1. ADMIN/RH STRICT — un MANAGER n'atteint aucune des quatre routes. Le
//      masquage par champ ne peut rien contre du texte libre : la seule
//      protection est de ne pas ouvrir la surface (doctrine 2.43.0).
//   2. CHIFFRÉ EN BASE — le clair ne part jamais dans l'INSERT ; il est
//      déchiffré à la lecture seulement.
//   3. JOURNAL SANS CONTENU — le registre RGPD trace qui a lu ou écrit,
//      jamais ce que la note raconte.
//   4. HISTORISÉ — modification et suppression déposent l'état ANTÉRIEUR dans
//      l'historique, DANS la transaction, avant l'écriture qu'elles documentent.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockClientQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');
const { encryptField, decryptField, ENC_PREFIX } = require('../../src/utils/field-crypto');

let app;
const tokenFor = (role) => jwt.sign(
  { id: 7, username: 'cip', role, first_name: 'C', last_name: 'IP', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), COLLABORATEUR: tokenFor('COLLABORATEUR') };

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockClientQuery.mockResolvedValue({ rows: [] });
});

const get = (p, role = 'ADMIN') => request(app).get(p).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (p, role, body = {}) => request(app).post(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const put = (p, role, body = {}) => request(app).put(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const del = (p, role) => request(app).delete(p).set('Authorization', `Bearer ${TOKENS[role]}`);

const ligne = (over = {}) => ({
  id: 3, employee_id: 5, parcours_num: 1, date_note: '2026-09-02', categorie: 'echange',
  contenu_chiffre: encryptField('A dit vouloir passer le CACES ; garde d\'enfant à régler.'),
  milestone_id: null, objectif_id: null, created_by: 7, created_at: '2026-09-03T08:00:00.000Z',
  updated_by: null, updated_at: null, created_by_name: 'Claire IP', updated_by_name: null,
  milestone_titre: null, objectif_titre: null, versions_anterieures: 0,
  ...over,
});

// ───────────────────────────────────────────────────────────────────────────
describe('Habilitations — ADMIN/RH strict', () => {
  it('un rôle non habilité est refusé sur les quatre routes', async () => {
    expect((await get('/api/insertion/notes-suivi/5', 'COLLABORATEUR')).status).toBe(403);
    expect((await post('/api/insertion/notes-suivi', 'COLLABORATEUR', { employee_id: 5, contenu: 'x' })).status).toBe(403);
    expect((await put('/api/insertion/notes-suivi/3', 'COLLABORATEUR', { contenu: 'x' })).status).toBe(403);
    expect((await del('/api/insertion/notes-suivi/3', 'COLLABORATEUR')).status).toBe(403);
  });

  it('un refus ne touche AUCUNE requête en base', async () => {
    await get('/api/insertion/notes-suivi/5', 'COLLABORATEUR');
    const lues = mockQuery.mock.calls.filter(([sql]) => /insertion_notes_suivi/.test(String(sql)));
    expect(lues).toHaveLength(0);
  });

  it('RH lit le journal', async () => {
    mockQuery.mockResolvedValue({ rows: [ligne()] });
    expect((await get('/api/insertion/notes-suivi/5', 'RH')).status).toBe(200);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('GET — lecture déchiffrée et journalisée', () => {
  it('rend le contenu en clair, l\'auteur et la date de l\'événement', async () => {
    mockQuery.mockImplementation((sql) => (/FROM insertion_notes_suivi n/.test(String(sql))
      ? Promise.resolve({ rows: [ligne()] }) : Promise.resolve({ rows: [] })));
    const res = await get('/api/insertion/notes-suivi/5');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].contenu).toMatch(/CACES/);
    expect(res.body[0].contenu_illisible).toBe(false);
    expect(res.body[0].date_note).toBe('2026-09-02');
    expect(res.body[0].created_by_name).toBe('Claire IP');
    // Le blob chiffré ne sort jamais vers l'écran.
    expect(JSON.stringify(res.body)).not.toContain(ENC_PREFIX);
  });

  it('journalise la consultation SANS le contenu de la note', async () => {
    mockQuery.mockImplementation((sql) => (/FROM insertion_notes_suivi n/.test(String(sql))
      ? Promise.resolve({ rows: [ligne()] }) : Promise.resolve({ rows: [] })));
    await get('/api/insertion/notes-suivi/5');
    const journal = mockQuery.mock.calls.find(([sql]) => /INSERT INTO rgpd_audit_log/.test(String(sql)));
    expect(journal).toBeDefined();
    expect(journal[1][1]).toBe('INSERTION_NOTE_SUIVI_LECTURE');
    expect(journal[1][2]).toBe('insertion_notes_suivi');
    expect(JSON.stringify(journal[1])).not.toMatch(/CACES/);
  });

  it('un contenu illisible est NOMMÉ, jamais rendu en blob', async () => {
    mockQuery.mockResolvedValue({ rows: [ligne({ contenu_chiffre: `${ENC_PREFIX}charabia-non-dechiffrable` })] });
    const res = await get('/api/insertion/notes-suivi/5');
    expect(res.body[0].contenu).toBeNull();
    expect(res.body[0].contenu_illisible).toBe(true);
  });

  it('base non migrée (42P01) → liste vide, l\'écran s\'ouvre', async () => {
    mockQuery.mockRejectedValue(Object.assign(new Error('relation absente'), { code: '42P01' }));
    const res = await get('/api/insertion/notes-suivi/5');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('POST — création', () => {
  const brancher = () => mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/COALESCE\(parcours_num, 1\) AS pn FROM employees/.test(s)) return Promise.resolve({ rows: [{ pn: 3 }] });
    if (/INSERT INTO insertion_notes_suivi/.test(s)) return Promise.resolve({ rows: [{ id: 42 }] });
    if (/FROM insertion_notes_suivi n/.test(s)) return Promise.resolve({ rows: [ligne({ id: 42, parcours_num: 3 })] });
    return Promise.resolve({ rows: [] });
  });

  it('chiffre le contenu : le clair n\'apparaît dans AUCUN paramètre de l\'INSERT', async () => {
    brancher();
    const secret = 'Rendez-vous manqué chez le médecin du travail.';
    const res = await post('/api/insertion/notes-suivi', 'RH', { employee_id: 5, contenu: secret, categorie: 'evenement' });
    expect(res.status).toBe(201);
    const ins = mockQuery.mock.calls.find(([sql]) => /INSERT INTO insertion_notes_suivi/.test(String(sql)));
    expect(ins[1]).not.toContain(secret);
    const chiffre = ins[1].find((v) => typeof v === 'string' && v.startsWith(ENC_PREFIX));
    expect(chiffre).toBeDefined();
    expect(decryptField(chiffre)).toBe(secret);
  });

  it('range la note dans le parcours EN COURS du salarié', async () => {
    brancher();
    await post('/api/insertion/notes-suivi', 'RH', { employee_id: 5, contenu: 'note' });
    const ins = mockQuery.mock.calls.find(([sql]) => /INSERT INTO insertion_notes_suivi/.test(String(sql)));
    expect(ins[1][1]).toBe(3); // parcours_num lu sur employees, jamais supposé à 1
  });

  it('refuse un contenu vide, une catégorie inconnue, un texte hors bornes', async () => {
    brancher();
    expect((await post('/api/insertion/notes-suivi', 'RH', { employee_id: 5, contenu: '   ' })).status).toBe(400);
    expect((await post('/api/insertion/notes-suivi', 'RH', { employee_id: 5, contenu: 'x', categorie: 'sante' })).status).toBe(400);
    expect((await post('/api/insertion/notes-suivi', 'RH', { employee_id: 5, contenu: 'x'.repeat(5001) })).status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PUT / DELETE — historisation', () => {
  const brancherClient = (avant = ligne()) => mockClientQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/SELECT \* FROM insertion_notes_suivi WHERE id = \$1 FOR UPDATE/.test(s)) return Promise.resolve({ rows: [avant] });
    return Promise.resolve({ rows: [] });
  });

  it('la modification dépose l\'état ANTÉRIEUR avant l\'UPDATE, dans la transaction', async () => {
    brancherClient();
    mockQuery.mockResolvedValue({ rows: [ligne({ contenu_chiffre: encryptField('corrigé') })] });
    const res = await put('/api/insertion/notes-suivi/3', 'ADMIN', { contenu: 'corrigé' });
    expect(res.status).toBe(200);
    const ordre = mockClientQuery.mock.calls.map(([sql]) => String(sql).trim().split('\n')[0]);
    const iBegin = ordre.findIndex((s) => /^BEGIN/.test(s));
    const iHist = ordre.findIndex((s) => /INSERT INTO insertion_notes_suivi_history/.test(s));
    const iUpd = ordre.findIndex((s) => /UPDATE insertion_notes_suivi SET/.test(s));
    const iCommit = ordre.findIndex((s) => /^COMMIT/.test(s));
    expect(iBegin).toBeGreaterThanOrEqual(0);
    expect(iHist).toBeGreaterThan(iBegin);
    expect(iUpd).toBeGreaterThan(iHist);   // la trace précède l'écriture qu'elle documente
    expect(iCommit).toBeGreaterThan(iUpd);
  });

  it('le snapshot conserve le contenu CHIFFRÉ (l\'historique ne perce pas le chiffrement)', async () => {
    brancherClient();
    mockQuery.mockResolvedValue({ rows: [ligne()] });
    await put('/api/insertion/notes-suivi/3', 'ADMIN', { contenu: 'corrigé' });
    const hist = mockClientQuery.mock.calls.find(([sql]) => /INSERT INTO insertion_notes_suivi_history/.test(String(sql)));
    const snap = JSON.parse(hist[1][2]);
    expect(snap.contenu_chiffre.startsWith(ENC_PREFIX)).toBe(true);
    expect(JSON.stringify(snap)).not.toMatch(/CACES/);
    expect(hist[1][3]).toBe('update');
  });

  it('la suppression laisse une trace « delete » avant le DELETE', async () => {
    brancherClient();
    const res = await del('/api/insertion/notes-suivi/3', 'ADMIN');
    expect(res.status).toBe(200);
    const ordre = mockClientQuery.mock.calls.map(([sql]) => String(sql).trim().split('\n')[0]);
    const iHist = ordre.findIndex((s) => /INSERT INTO insertion_notes_suivi_history/.test(s));
    const iDel = ordre.findIndex((s) => /DELETE FROM insertion_notes_suivi WHERE/.test(s));
    expect(iHist).toBeGreaterThanOrEqual(0);
    expect(iDel).toBeGreaterThan(iHist);
    const hist = mockClientQuery.mock.calls.find(([sql]) => /INSERT INTO insertion_notes_suivi_history/.test(String(sql)));
    expect(hist[1][3]).toBe('delete');
    expect(hist[1][1]).toBe(5); // employee_id porté par l'historique → purgeable à l'anonymisation
  });

  it('note inexistante → 404 et transaction annulée', async () => {
    mockClientQuery.mockResolvedValue({ rows: [] });
    const res = await put('/api/insertion/notes-suivi/999', 'ADMIN', { contenu: 'x' });
    expect(res.status).toBe(404);
    expect(mockClientQuery.mock.calls.some(([sql]) => /^ROLLBACK/.test(String(sql).trim()))).toBe(true);
  });
});

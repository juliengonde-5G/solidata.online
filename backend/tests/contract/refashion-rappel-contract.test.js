// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — RAPPEL « EXTRANET REFASHION » À CHAQUE SAISIE DE DPAV
// ───────────────────────────────────────────────────────────────────────────
// Demande client du 10/09/2026. Refashion n'expose aucune API : la déclaration
// trimestrielle se saisit à la main sur leur extranet. SOLIDATA ne peut donc
// pas synchroniser — il peut empêcher l'oubli, qui ne se voit sinon qu'à
// l'audit, des mois plus tard, sur une subvention calculée à faux.
//
// Ce qui est tenu ici : le rappel part APRÈS le COMMIT (jamais pour une
// écriture annulée), il distingue une PREMIÈRE saisie d'une reprise (le cas le
// plus à risque : l'extranet porte déjà une valeur, donc une valeur fausse), et
// une messagerie en panne n'empêche pas d'enregistrer une DPAV.
// ═══════════════════════════════════════════════════════════════════════════
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

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
const mockEnvoyer = jest.fn().mockResolvedValue({ ok: true, envoyes: 1, echecs: [] });
jest.mock('../../src/services/messagerie', () => ({
  envoyerMessageSystemeRoles: (...a) => mockEnvoyer(...a),
}));

const express = require('express');
const request = require('supertest');

const app = express();
app.use(express.json());
app.use('/api/refashion', require('../../src/routes/refashion'));

const jeton = (role) => jwt.sign(
  { id: 1, username: 'u', role, first_name: 'Julien', last_name: 'Gondé', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' });
const ADMIN = jeton('ADMIN');

const DPAV = { id: 3, annee: 2026, trimestre: 2, stock_debut_t: 1, stock_fin_t: 2 };

/** @param {boolean} existeDeja le trimestre a-t-il déjà été déclaré ? */
function brancher(existeDeja) {
  mockClientQuery.mockImplementation(async (sql) => {
    const q = String(sql);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(q)) return { rows: [] };
    if (/SELECT id FROM refashion_dpav/i.test(q)) return { rows: existeDeja ? [{ id: 3 }] : [], rowCount: existeDeja ? 1 : 0 };
    if (/INSERT INTO refashion_dpav_history/i.test(q)) return { rows: [] };
    if (/INSERT INTO refashion_dpav/i.test(q)) return { rows: [{ ...DPAV }] };
    return { rows: [] };
  });
  mockQuery.mockImplementation(async (sql) => {
    const q = String(sql);
    if (/FROM custom_roles/i.test(q)) return { rows: [] };
    if (/SELECT token_version FROM users/i.test(q)) return { rows: [{ token_version: 0 }] };
    if (/SELECT value FROM settings/i.test(q)) return { rows: [] };
    return { rows: [] };
  });
}

beforeEach(() => { mockQuery.mockReset(); mockClientQuery.mockReset(); mockEnvoyer.mockClear(); });

const saisir = () => request(app).post('/api/refashion/dpav')
  .set('Authorization', `Bearer ${ADMIN}`).send({ annee: 2026, trimestre: 2, stock_debut_t: 1 });
const laisserPartirLeRappel = () => new Promise((r) => setImmediate(r));

describe('POST /api/refashion/dpav — le rappel extranet', () => {
  it('première saisie : rappel « enregistrée », adressé aux ADMIN', async () => {
    brancher(false);
    const r = await saisir();
    expect(r.status).toBe(200);
    await laisserPartirLeRappel();
    expect(mockEnvoyer).toHaveBeenCalledTimes(1);
    const [roles, args] = mockEnvoyer.mock.calls[0];
    expect(roles).toEqual(['ADMIN']);
    expect(args.texte).toMatch(/DPAV 2026 T2/);
    expect(args.texte).toMatch(/enregistrée/);
    expect(args.texte).toMatch(/EXTRANET REFASHION/i);
    expect(args.texte).toMatch(/Julien Gondé/); // qui a saisi : la trace est nominative
    expect(args.lien).toBe('/refashion');
  });

  it('reprise d’un trimestre DÉJÀ déclaré : le rappel dit « modifiée »', async () => {
    brancher(true);
    await saisir();
    await laisserPartirLeRappel();
    expect(mockEnvoyer.mock.calls[0][1].texte).toMatch(/modifiée/);
  });

  it('écriture ANNULÉE (rollback) : aucun rappel — on ne fait pas déclarer un chiffre qui n’existe pas', async () => {
    brancher(false);
    mockClientQuery.mockImplementation(async (sql) => {
      const q = String(sql);
      if (/^\s*(BEGIN|ROLLBACK)/i.test(q)) return { rows: [] };
      if (/SELECT id FROM refashion_dpav/i.test(q)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO refashion_dpav/i.test(q)) throw new Error('contrainte violée');
      return { rows: [] };
    });
    const r = await saisir();
    expect(r.status).toBe(500);
    await laisserPartirLeRappel();
    expect(mockEnvoyer).not.toHaveBeenCalled();
  });

  it('messagerie en panne : la DPAV est quand même enregistrée', async () => {
    brancher(false);
    mockEnvoyer.mockRejectedValueOnce(new Error('messagerie indisponible'));
    const r = await saisir();
    expect(r.status).toBe(200);
    await laisserPartirLeRappel();
  });
});

describe('GET /api/refashion/extranet-url — jamais d’URL inventée', () => {
  it('réglage absent → null (le bandeau s’affiche sans lien)', async () => {
    brancher(false);
    const r = await request(app).get('/api/refashion/extranet-url').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.url).toBeNull();
  });

  it('réglage renseigné → l’URL telle quelle', async () => {
    brancher(false);
    mockQuery.mockImplementation(async (sql) => {
      const q = String(sql);
      if (/FROM custom_roles/i.test(q)) return { rows: [] };
      if (/SELECT token_version FROM users/i.test(q)) return { rows: [{ token_version: 0 }] };
      if (/SELECT value FROM settings/i.test(q)) return { rows: [{ value: ' https://extranet.refashion.fr ' }] };
      return { rows: [] };
    });
    const r = await request(app).get('/api/refashion/extranet-url').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.body.url).toBe('https://extranet.refashion.fr');
  });

  it('valeur qui n’est pas une URL → null, plutôt qu’un lien mort', async () => {
    brancher(false);
    mockQuery.mockImplementation(async (sql) => {
      const q = String(sql);
      if (/FROM custom_roles/i.test(q)) return { rows: [] };
      if (/SELECT token_version FROM users/i.test(q)) return { rows: [{ token_version: 0 }] };
      if (/SELECT value FROM settings/i.test(q)) return { rows: [{ value: 'à demander à la direction' }] };
      return { rows: [] };
    });
    const r = await request(app).get('/api/refashion/extranet-url').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.body.url).toBeNull();
  });
});

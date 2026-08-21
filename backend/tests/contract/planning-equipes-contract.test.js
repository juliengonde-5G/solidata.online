// ═══════════════════════════════════════════════════════════════════════════
// TEST DE CONTRAT — PRIORISATION DES ÉQUIPES DANS LE PLANNING DES TOURNÉES
// ───────────────────────────────────────────────────────────────────────────
// Demande client (21/08/2026) : sur /planning-tournees, afficher en priorité
// les collaborateurs des équipes « Collecte » et « Logistique », tout en
// laissant possible l'affectation EXCEPTIONNELLE d'une autre équipe.
//
// Verrouille : le drapeau `is_equipe_collecte`, le TRI (prioritaires d'abord),
// la PRÉSENCE des autres équipes dans la réponse (elles restent affectables),
// et le réglage `collecte.equipes_prioritaires` (jamais d'équipe en dur).
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
const planningRouter = require('../../src/routes/tours/planning');

const token = jwt.sign(
  { id: 1, username: 'u', role: 'ADMIN', first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' }
);

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tours', authenticate, planningRouter);
});

const EMPLOYES = [
  { id: 1, first_name: 'Alice', last_name: 'ADAM', team_id: 5, team_name: 'Tri' },
  { id: 2, first_name: 'Bruno', last_name: 'ZOLA', team_id: 2, team_name: 'Collecte' },
  { id: 3, first_name: 'Chloé', last_name: 'BERNARD', team_id: 3, team_name: 'Logistique' },
  { id: 4, first_name: 'David', last_name: 'MARTIN', team_id: null, team_name: null },
  { id: 5, first_name: 'Emma', last_name: 'ANDRE', team_id: 7, team_name: 'collecte' }, // casse différente
];

/** Route les requêtes SQL du endpoint ; `setting` = valeur brute en base. */
function installMocks({ setting = null } = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/FROM tours t LEFT JOIN vehicles v/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM employees e LEFT JOIN teams/.test(s)) return Promise.resolve({ rows: EMPLOYES });
    if (/FROM employee_availability/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM vehicles/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM settings WHERE key/.test(s)) {
      return Promise.resolve({ rows: setting === null ? [] : [{ value: setting }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

const getResources = () => request(app)
  .get('/api/tours/planning/resources?date=2026-08-24')
  .set('Authorization', `Bearer ${token}`);

beforeEach(() => mockQuery.mockReset());

describe('GET /planning/resources — priorisation Collecte/Logistique', () => {
  it('marque les équipes prioritaires et les renvoie EN TÊTE', async () => {
    installMocks();
    const res = await getResources();
    expect(res.status).toBe(200);

    const prioritaires = res.body.drivers.filter((d) => d.is_equipe_collecte).map((d) => d.id);
    expect(prioritaires.sort()).toEqual([2, 3, 5]); // Collecte, Logistique, collecte (casse)

    // Les 3 prioritaires occupent les 3 premières places, triés NOM puis Prénom.
    expect(res.body.drivers.slice(0, 3).map((d) => d.last_name)).toEqual(['ANDRE', 'BERNARD', 'ZOLA']);
  });

  it('conserve les AUTRES équipes dans la liste (affectation exceptionnelle possible)', async () => {
    installMocks();
    const res = await getResources();
    const autres = res.body.drivers.filter((d) => !d.is_equipe_collecte);
    expect(autres.map((d) => d.id).sort()).toEqual([1, 4]); // Tri + sans équipe
    expect(res.body.drivers).toHaveLength(EMPLOYES.length); // personne n'est masqué
  });

  it('expose les équipes prioritaires effectives (défaut Collecte/Logistique)', async () => {
    installMocks();
    const res = await getResources();
    expect(res.body.equipes_prioritaires).toEqual(['Collecte', 'Logistique']);
  });

  it('le réglage `collecte.equipes_prioritaires` fait foi', async () => {
    installMocks({ setting: JSON.stringify(['Tri']) });
    const res = await getResources();
    expect(res.body.equipes_prioritaires).toEqual(['Tri']);
    expect(res.body.drivers[0].id).toBe(1); // Alice ADAM (Tri) passe en tête
    expect(res.body.drivers.find((d) => d.id === 2).is_equipe_collecte).toBe(false);
  });

  it('réglage illisible → repli sur le défaut, jamais d’erreur', async () => {
    installMocks({ setting: '{ceci n’est pas du JSON' });
    const res = await getResources();
    expect(res.status).toBe(200);
    expect(res.body.equipes_prioritaires).toEqual(['Collecte', 'Logistique']);
  });
});

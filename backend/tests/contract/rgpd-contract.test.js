// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — MODULE RGPD (Lot 5 : rappel codifié des règles de gestion)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la forme de réponse et les habilitations de GET /api/rgpd/politique
// (routes/rgpd.js) :
//   1. HABILITATIONS : réservé ADMIN/DPO (même garde que /registre et /audit,
//      alignée sur l'accès à la page RGPD côté frontend) ;
//   2. FORME : 6 catégories attendues (conservation, suppression, chiffrement,
//      droits, journalisation, sous_traitance_ia), chaque règle porte
//      { titre, description, valeur, source, reference } ;
//   3. VALEUR PARAMÉTRABLE : `insertion.retention_months` retombe sur son défaut
//      de code (24 mois) quand la table settings ne porte aucune ligne pour
//      cette clé — même mécanisme que readInsertionSetting.
//
// Auth réelle (JWT sans `tv`), DB mockée, activity-logger mocké. Même harnais
// que achats-contract.test.js / enquetes-contract.test.js.
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

const rgpd = require('../../src/routes/rgpd');
const tokenFor = (role) => jwt.sign({ id: 1, username: 'u', role, first_name: 'T', last_name: 'U', mfa: true }, JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), DPO: tokenFor('DPO'), RH: tokenFor('RH'),
  MANAGER: tokenFor('MANAGER'), COLLABORATEUR: tokenFor('COLLABORATEUR'),
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/rgpd', rgpd);
});
beforeEach(() => {
  mockQuery.mockReset();
  // Table `settings` sans ligne pour insertion.retention_months (repli défaut) ;
  // rgpd_registre vide (compteur à 0) — comportement par défaut d'une base neuve.
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);

const CATEGORY_KEYS = ['conservation', 'suppression', 'chiffrement', 'droits', 'journalisation', 'sous_traitance_ia'];

describe('GET /api/rgpd/politique — habilitations', () => {
  it('403 pour un rôle non ADMIN/DPO (ex. MANAGER, RH, COLLABORATEUR)', async () => {
    for (const role of ['MANAGER', 'RH', 'COLLABORATEUR']) {
      const res = await get('/api/rgpd/politique', role);
      expect(res.status).toBe(403);
    }
  });

  it('200 pour ADMIN et DPO', async () => {
    for (const role of ['ADMIN', 'DPO']) {
      const res = await get('/api/rgpd/politique', role);
      expect(res.status).toBe(200);
    }
  });

  it('401 sans jeton', async () => {
    const res = await request(app).get('/api/rgpd/politique');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/rgpd/politique — forme de la réponse', () => {
  it('renvoie generated_at + les 6 catégories attendues, chacune avec des règles complètes', async () => {
    const res = await get('/api/rgpd/politique', 'ADMIN');
    expect(res.status).toBe(200);
    expect(typeof res.body.generated_at).toBe('string');
    expect(Array.isArray(res.body.categories)).toBe(true);

    const keys = res.body.categories.map((c) => c.key);
    expect(keys).toEqual(CATEGORY_KEYS);

    for (const cat of res.body.categories) {
      expect(typeof cat.label).toBe('string');
      expect(Array.isArray(cat.regles)).toBe(true);
      expect(cat.regles.length).toBeGreaterThan(0);
      for (const regle of cat.regles) {
        expect(typeof regle.titre).toBe('string');
        expect(regle.titre.length).toBeGreaterThan(0);
        expect(typeof regle.description).toBe('string');
        expect(regle.description.length).toBeGreaterThan(0);
        expect(regle.valeur).toBeTruthy();
        expect(typeof regle.source).toBe('string');
        expect(typeof regle.reference).toBe('string');
        expect(regle.reference.length).toBeGreaterThan(0);
      }
    }
  });

  it('la rétention des dossiers d\'insertion retombe sur le défaut de code (24 mois) quand settings est vide', async () => {
    const res = await get('/api/rgpd/politique', 'ADMIN');
    const cat = res.body.categories.find((c) => c.key === 'conservation');
    const regle = cat.regles.find((r) => r.source === 'insertion.retention_months');
    expect(regle).toBeDefined();
    expect(regle.valeur).toBe('24 mois');
  });

  it('reflète une valeur de settings différente du défaut quand elle est présente en base', async () => {
    mockQuery.mockImplementation(async (sql, params) => {
      if (typeof sql === 'string' && sql.includes('FROM settings') && params && params[0] === 'insertion.retention_months') {
        return { rows: [{ value: '36' }] };
      }
      return { rows: [] };
    });
    const res = await get('/api/rgpd/politique', 'ADMIN');
    const cat = res.body.categories.find((c) => c.key === 'conservation');
    const regle = cat.regles.find((r) => r.source === 'insertion.retention_months');
    expect(regle.valeur).toBe('36 mois');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — module FINANCE (Vague 3, item 3.A)
// ───────────────────────────────────────────────────────────────────────────
// Constat transverse T3 de l'audit (00-synthese-executive.md) : « contrats
// front/back désalignés qui échouent en silence ». Les vagues 0-1 ont réparé
// plusieurs écrans Finance (FinanceOperations, FinanceTresorerie, Finance) dont
// le backend ne renvoyait pas la forme attendue par le front.
//
// Ces tests VERROUILLENT la FORME (présence + type des champs consommés par le
// front) des réponses réparées. Ils ne testent PAS la logique métier : un futur
// refactor qui renomme/supprime un champ lu par une page casse ICI un test au
// lieu de casser un écran en silence.
//
// Chaque describe indique l'ÉCRAN consommateur et la ligne où il lit le champ.
// Réf. rapports : technique/finance-facturation.md.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
const mockConnect = jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} }));
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));
// Journal d'activité neutralisé (sinon écrit en base + IIFE ALTER TABLE au load).
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

let app;
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/finance', require('../../src/routes/finance'));
});

beforeEach(() => {
  mockQuery.mockReset();
  // Défaut résilient : toute requête non explicitement mockée renvoie [] — les
  // handlers financiers tolèrent des jeux vides (COALESCE, ?., try/catch).
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path) => request(app).get(path).set('Authorization', `Bearer ${adminToken}`);

// ───────────────────────────────────────────────────────────────────────────
// GET /finance/operations/:year/auto
// Écran : FinanceOperations.jsx (lignes 71-74 : res.data.auto / .overrides /
//         .results ; 163-166 : results.cout_tonne_collecte / .cout_tonne_trie /
//         .marge_operationnelle / .ca_par_etp ; 230-256 : results.centres[] et
//         results.total avec centre/produits/charges_directes/fg_alloues/
//         transferts/resultat/marge).
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /finance/operations/:year/auto → { auto, overrides, results } (FinanceOperations.jsx)', () => {
  // Aiguillage par contenu SQL : robuste à l'ordre des requêtes du handler.
  const wire = (sql) => {
    const s = String(sql);
    if (/FROM tours WHERE/.test(s)) return Promise.resolve({ rows: [{ tonnes: 100 }] });
    if (/FROM production_daily/.test(s)) return Promise.resolve({ rows: [{ tonnes: 80 }] });
    if (/FROM expeditions/.test(s)) return Promise.resolve({ rows: [{ tonnes: 70, ca: 21000, nb: 3 }] });
    if (/FROM vehicles/.test(s)) return Promise.resolve({ rows: [{ c: 5 }] });
    if (/FROM employees WHERE is_active/.test(s)) return Promise.resolve({ rows: [{ c: 12 }] });
    if (/financial_operational_data/.test(s)) return Promise.resolve({ rows: [] });
    // centres P&L (avant la requête totale générique sur financial_gl_entries)
    if (/family_category = 'Centre P&L'/.test(s)) return Promise.resolve({ rows: [
      { centre: 'Collecte & Original', charges: 50000, produits: 60000 },
      { centre: 'Tri & Recyclage - 2nde main', charges: 40000, produits: 55000 },
    ] });
    if (/FROM financial_gl_entries/.test(s)) return Promise.resolve({ rows: [{ produits: 115000, charges: 90000 }] });
    return Promise.resolve({ rows: [] });
  };

  it('expose les 3 clés de premier niveau { auto, overrides, results }', async () => {
    mockQuery.mockImplementation(wire);
    const res = await get('/api/finance/operations/2026/auto');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('auto');
    expect(res.body).toHaveProperty('overrides');
    expect(res.body).toHaveProperty('results');
    expect(typeof res.body.auto).toBe('object');
    expect(typeof res.body.overrides).toBe('object');
    expect(res.body.results && typeof res.body.results).toBe('object');
  });

  it('results porte les 4 KPI lus par les KPICard + le tableau centres/total', async () => {
    mockQuery.mockImplementation(wire);
    const { body } = await get('/api/finance/operations/2026/auto');
    const r = body.results;
    for (const k of ['cout_tonne_collecte', 'cout_tonne_trie', 'marge_operationnelle', 'ca_par_etp']) {
      expect(typeof r[k]).toBe('number');
    }
    expect(Array.isArray(r.centres)).toBe(true);
    expect(r.centres.length).toBeGreaterThan(0);
    // clé/type de chaque colonne du tableau « Résultat par centre »
    const c = r.centres[0];
    expect(typeof c.centre).toBe('string');
    for (const k of ['produits', 'charges_directes', 'fg_alloues', 'transferts', 'resultat', 'marge']) {
      expect(typeof c[k]).toBe('number');
    }
    // tfoot Total (non-null dès qu'il y a au moins un centre)
    expect(r.total).not.toBeNull();
    for (const k of ['produits', 'charges_directes', 'fg_alloues', 'transferts', 'resultat', 'marge']) {
      expect(typeof r.total[k]).toBe('number');
    }
  });

  it('auto est un dictionnaire de valeurs numériques (corrections manuelles côté front)', async () => {
    mockQuery.mockImplementation(wire);
    const { body } = await get('/api/finance/operations/2026/auto');
    // tonnes collectées = 100 t remontées telles quelles pour pré-remplir le formulaire
    expect(typeof body.auto.tonnes_collectees).toBe('number');
    expect(body.auto.tonnes_collectees).toBe(100);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /finance/gl/:year/tresorerie
// Écran : FinanceTresorerie.jsx (ligne 57 : data.cash_flow ; 183-184 :
//         g.type === 'revenue' / g.class === '7' et g.type === 'expense' /
//         g.class !== '7' ; 218-247 : group.key / .label / .months / .lines).
// C'est LE contrat cité par l'item 3.A : chaque ligne cash_flow porte type ET class.
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /finance/gl/:year/tresorerie → cash_flow[].{ type, class } (FinanceTresorerie.jsx)', () => {
  const wire = (sql) => {
    const s = String(sql);
    if (/account LIKE '512%'/.test(s)) return Promise.resolve({ rows: [
      { date: '2026-01-15', debit: 1000, credit: 0 },
      { date: '2026-02-10', debit: 0, credit: 400 },
    ] });
    if (/FROM financial_transactions/.test(s)) return Promise.resolve({ rows: [
      { date: '2026-01-15', amount: 1000, tresorerie: 'Ventes marchandises' },
      { date: '2026-03-01', amount: -400, tresorerie: 'Achats fournitures' },
    ] });
    return Promise.resolve({ rows: [] });
  };

  it('renvoie l’enveloppe { kpis, monthly, waterfall, cash_flow }', async () => {
    mockQuery.mockImplementation(wire);
    const res = await get('/api/finance/gl/2026/tresorerie');
    expect(res.status).toBe(200);
    expect(typeof res.body.kpis).toBe('object');
    expect(Array.isArray(res.body.monthly)).toBe(true);
    expect(res.body.monthly).toHaveLength(12);
    expect(Array.isArray(res.body.waterfall)).toBe(true);
    expect(Array.isArray(res.body.cash_flow)).toBe(true);
  });

  it('chaque ligne cash_flow porte key/label/type/class/months/lines', async () => {
    mockQuery.mockImplementation(wire);
    const { body } = await get('/api/finance/gl/2026/tresorerie');
    expect(body.cash_flow.length).toBeGreaterThan(0);
    for (const g of body.cash_flow) {
      expect(typeof g.key).toBe('string');
      expect(typeof g.label).toBe('string');
      expect(['revenue', 'expense']).toContain(g.type);      // lu par le filtre front
      expect(['6', '7']).toContain(g.class);                  // lu par le filtre front
      expect(Array.isArray(g.months)).toBe(true);
      expect(g.months).toHaveLength(12);
      expect(Array.isArray(g.lines)).toBe(true);
    }
  });

  it('couple type↔class cohérent : revenue→7, expense→6 (dérivé du signe Pennylane)', async () => {
    mockQuery.mockImplementation(wire);
    const { body } = await get('/api/finance/gl/2026/tresorerie');
    const revenue = body.cash_flow.find((g) => g.type === 'revenue');
    const expense = body.cash_flow.find((g) => g.type === 'expense');
    expect(revenue).toBeTruthy();
    expect(revenue.class).toBe('7');
    expect(expense).toBeTruthy();
    expect(expense.class).toBe('6');
  });

  it('monthly[i] porte encaissements/decaissements/solde numériques', async () => {
    mockQuery.mockImplementation(wire);
    const { body } = await get('/api/finance/gl/2026/tresorerie');
    for (const m of body.monthly) {
      expect(typeof m.encaissements).toBe('number');
      expect(typeof m.decaissements).toBe('number');
      expect(typeof m.solde).toBe('number');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /finance/rapprochement-ca/:year  (Vague 1, item 36)
// Écran : Finance.jsx (ligne 86 : setRappro(r.data) ; 118-122 : rappro.sources.
//         {gl,exutoires,boutiques,vak,subventions} ; 298-301 : ventes.activites[]
//         avec a.cle/.libelle/.annuel ; 308-319 : ventes/subventions
//         .operationnel_annuel / .comptable_annuel / .ecart_annuel / .ecart_pct).
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /finance/rapprochement-ca/:year → { year, sources, ventes, subventions } (Finance.jsx)', () => {
  const wire = (sql) => {
    const s = String(sql);
    if (/FROM commandes_exutoires c/.test(s)) return Promise.resolve({ rows: [{ mois: 1, ca: 10000 }] });
    if (/FROM boutique_ventes/.test(s)) return Promise.resolve({ rows: [{ mois: 2, ca: 5000 }] });
    if (/FROM vak_ventes/.test(s)) return Promise.resolve({ rows: [{ mois: 3, ca: 2000 }] });
    if (/account LIKE '70%'/.test(s)) return Promise.resolve({ rows: [{ mois: 1, ca: 9000 }] });
    if (/account LIKE '74%'/.test(s)) return Promise.resolve({ rows: [{ mois: 1, ca: 30000 }] });
    if (/FROM refashion_subventions/.test(s)) return Promise.resolve({ rows: [{ montant: 31000 }] });
    return Promise.resolve({ rows: [] });
  };

  it('renvoie year, sources (5 booléens), ventes et subventions', async () => {
    mockQuery.mockImplementation(wire);
    const res = await get('/api/finance/rapprochement-ca/2026');
    expect(res.status).toBe(200);
    expect(typeof res.body.year).toBe('number');
    for (const k of ['exutoires', 'boutiques', 'vak', 'gl', 'subventions']) {
      expect(typeof res.body.sources[k]).toBe('boolean');
    }
    expect(typeof res.body.ventes).toBe('object');
    expect(typeof res.body.subventions).toBe('object');
  });

  it('ventes.activites[] porte cle/libelle/mensuel(12)/annuel', async () => {
    mockQuery.mockImplementation(wire);
    const { body } = await get('/api/finance/rapprochement-ca/2026');
    expect(Array.isArray(body.ventes.activites)).toBe(true);
    expect(body.ventes.activites.length).toBe(3); // exutoires / boutiques / vak
    for (const a of body.ventes.activites) {
      expect(typeof a.cle).toBe('string');
      expect(typeof a.libelle).toBe('string');
      expect(Array.isArray(a.mensuel)).toBe(true);
      expect(a.mensuel).toHaveLength(12);
      expect(typeof a.annuel).toBe('number');
    }
  });

  it('ventes/subventions portent operationnel_annuel, comptable_annuel, ecart_annuel (nombre) et ecart_pct (nombre|null)', async () => {
    mockQuery.mockImplementation(wire);
    const { body } = await get('/api/finance/rapprochement-ca/2026');
    for (const bloc of [body.ventes, body.subventions]) {
      expect(typeof bloc.operationnel_annuel).toBe('number');
      expect(typeof bloc.comptable_annuel).toBe('number');
      expect(typeof bloc.ecart_annuel).toBe('number');
      expect(bloc.ecart_pct === null || typeof bloc.ecart_pct === 'number').toBe(true);
    }
    expect(Array.isArray(body.ventes.operationnel_mensuel)).toBe(true);
    expect(body.ventes.operationnel_mensuel).toHaveLength(12);
  });
});

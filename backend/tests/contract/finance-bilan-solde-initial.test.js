// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — FINANCE lots 7+8 : comparatif N-1 du bilan + solde
// initial de trésorerie
// ───────────────────────────────────────────────────────────────────────────
// Deux demandes client (juillet 2026) :
//  A) /finance/gl/:year/bilan — colonnes N-1 alimentées par le Grand Livre
//     Pennylane de l'exercice précédent. Doctrine « jamais de valeur
//     inventée » : si l'exercice N-1 n'est pas importé, les valeurs N-1 sont
//     null (pas 0) et le flag n1_disponible=false permet au front d'afficher
//     « exercice N-1 non importé ».
//  B) /finance/gl/:year/tresorerie — solde initial au 01/01 résolu en cascade
//     honnête : (1) setting finance.tresorerie_solde_initial_<annee> saisi
//     ADMIN, (2) sinon solde des comptes 512* du GL N-1 importé, (3) sinon 0
//     avec source 'aucune'. Le solde mensuel/position/waterfall partent de ce
//     montant. PUT /gl/:year/solde-initial réservé ADMIN.
// Écrans consommateurs : FinanceBilan.jsx (bandeau n1_disponible, colonnes
// N-1) et FinanceTresorerie.jsx (bandeau solde_initial + formulaire ADMIN).
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
const managerToken = jwt.sign({ id: 2, username: 'manager', role: 'MANAGER', first_name: 'M', last_name: 'G' }, JWT_SECRET, { expiresIn: '1h' });
const financeToken = jwt.sign({ id: 3, username: 'finance', role: 'FINANCE', first_name: 'F', last_name: 'N' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/finance', require('../../src/routes/finance'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path) => request(app).get(path).set('Authorization', `Bearer ${adminToken}`);
const putAs = (token) => (path, body) => request(app).put(path).set('Authorization', `Bearer ${token}`).send(body);

// ───────────────────────────────────────────────────────────────────────────
// A) GET /finance/gl/:year/bilan — comparatif N-1 depuis l'import Pennylane
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /finance/gl/:year/bilan → colonnes N-1 (FinanceBilan.jsx)', () => {
  // Le handler exécute 2 requêtes agrégées par sous-classe : exercice N
  // (params [year]) puis exercice N-1 (params [year-1]) → aiguillage par param.
  const wireBilan = (rowsN, rowsN1) => (sql, params) => {
    const s = String(sql);
    if (/SUBSTRING\(g\.account, 1, 2\)/.test(s)) {
      if (params && params[0] === 2026) return Promise.resolve({ rows: rowsN });
      if (params && params[0] === 2025) return Promise.resolve({ rows: rowsN1 });
    }
    return Promise.resolve({ rows: [] });
  };

  const rowsN = [
    { sub: '70', cls: '7', solde: -100000 },
    { sub: '60', cls: '6', solde: 60000 },
    { sub: '51', cls: '5', solde: 20000 },
  ];
  const rowsN1 = [
    { sub: '70', cls: '7', solde: -80000 },
    { sub: '60', cls: '6', solde: 50000 },
  ];

  it('N-1 importé → n1_disponible=true, n1_annee=year-1, valeurs N-1 numériques', async () => {
    mockQuery.mockImplementation(wireBilan(rowsN, rowsN1));
    const res = await get('/api/finance/gl/2026/bilan');
    expect(res.status).toBe(200);
    expect(res.body.n1_disponible).toBe(true);
    expect(res.body.n1_annee).toBe(2025);
    // SIG : produits N-1 = 80 000 (classe 7 créditrice), résultat N-1 = 30 000
    const sigProduits = res.body.sig[0];
    expect(sigProduits.n1).toBe(80000);
    const sigResultat = res.body.sig.find((r) => r.label === 'RESULTAT NET');
    expect(sigResultat.n1).toBe(30000);
    // Variation du résultat : (40000-30000)/30000 = +33.3 %
    expect(typeof sigResultat.variation).toBe('number');
    expect(typeof res.body.kpis.resultat_variation).toBe('number');
    // Actif/Passif : chaque ligne porte un n1 numérique
    for (const row of [...res.body.actif, ...res.body.passif]) {
      expect(typeof row.n1).toBe('number');
    }
  });

  it('N-1 NON importé → n1_disponible=false et valeurs N-1 à null (jamais 0 inventé)', async () => {
    mockQuery.mockImplementation(wireBilan(rowsN, []));
    const res = await get('/api/finance/gl/2026/bilan');
    expect(res.status).toBe(200);
    expect(res.body.n1_disponible).toBe(false);
    expect(res.body.n1_annee).toBe(2025);
    // Toutes les colonnes N-1 sont null (le front affiche « — ») ; les valeurs
    // N restent des nombres.
    for (const row of res.body.sig) {
      expect(row.n1).toBeNull();
      expect(typeof row.n).toBe('number');
      expect(row.variation == null).toBe(true);
    }
    for (const row of [...res.body.actif, ...res.body.passif]) {
      expect(row.n1).toBeNull();
      expect(typeof row.n).toBe('number');
    }
    expect(res.body.kpis.actif_variation).toBeNull();
    expect(res.body.kpis.cp_variation).toBeNull();
    expect(res.body.kpis.resultat_variation).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// B) GET /finance/gl/:year/tresorerie — cascade du solde initial au 01/01
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /finance/gl/:year/tresorerie → solde_initial (FinanceTresorerie.jsx)', () => {
  // Aiguillage par contenu SQL. ATTENTION à l'ordre : la requête GL N-1 de la
  // cascade contient aussi « account LIKE '512%' » mais se distingue par
  // « AS nb » — elle doit être testée AVANT la requête 512 de l'exercice N.
  const wireTreso = ({ settingRows = [], glN1Rows = [] } = {}) => (sql) => {
    const s = String(sql);
    if (/FROM settings WHERE key = \$1/.test(s)) return Promise.resolve({ rows: settingRows });
    if (/AS nb/.test(s)) return Promise.resolve({ rows: glN1Rows });
    if (/account LIKE '512%'/.test(s)) return Promise.resolve({ rows: [
      { date: '2026-01-15', debit: 1000, credit: 0 },
      { date: '2026-02-10', debit: 0, credit: 400 },
    ] });
    if (/FROM financial_transactions/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  };

  it('priorité 1 : setting explicite → source=setting, la courbe part du montant saisi', async () => {
    mockQuery.mockImplementation(wireTreso({ settingRows: [{ value: '12345.67' }], glN1Rows: [{ nb: 99, solde: 5000 }] }));
    const res = await get('/api/finance/gl/2026/tresorerie');
    expect(res.status).toBe(200);
    expect(res.body.solde_initial).toMatchObject({ montant: 12345.67, source: 'setting', annee: 2026 });
    expect(typeof res.body.solde_initial.detail).toBe('string');
    // Solde janvier = 12 345,67 + 1 000 ; février = − 400
    expect(res.body.monthly[0].solde).toBe(13345.67);
    expect(res.body.monthly[1].solde).toBe(12945.67);
    // La première barre du waterfall porte le solde initial (arrondi)
    expect(res.body.waterfall[0]).toMatchObject({ label: 'Solde initial', value: 12346, type: 'total' });
  });

  it('priorité 2 : pas de setting mais GL N-1 importé → source=gl_n1 (comptes 512 au 31/12 N-1)', async () => {
    mockQuery.mockImplementation(wireTreso({ settingRows: [], glN1Rows: [{ nb: 42, solde: '5000.5' }] }));
    const res = await get('/api/finance/gl/2026/tresorerie');
    expect(res.status).toBe(200);
    expect(res.body.solde_initial).toMatchObject({ montant: 5000.5, source: 'gl_n1', annee: 2026 });
    expect(res.body.monthly[0].solde).toBe(6000.5);
    expect(res.body.waterfall[0].value).toBe(5001);
  });

  it('priorité 3 : ni setting ni GL N-1 → source=aucune, montant 0 (avertissement côté UI)', async () => {
    mockQuery.mockImplementation(wireTreso({}));
    const res = await get('/api/finance/gl/2026/tresorerie');
    expect(res.status).toBe(200);
    expect(res.body.solde_initial).toMatchObject({ montant: 0, source: 'aucune', annee: 2026 });
    expect(res.body.monthly[0].solde).toBe(1000);
    expect(res.body.waterfall[0].value).toBe(0);
  });

  it('setting illisible (non numérique) → la cascade dégrade proprement (aucune)', async () => {
    mockQuery.mockImplementation(wireTreso({ settingRows: [{ value: 'abc' }], glN1Rows: [] }));
    const res = await get('/api/finance/gl/2026/tresorerie');
    expect(res.status).toBe(200);
    expect(res.body.solde_initial.source).toBe('aucune');
    expect(res.body.solde_initial.montant).toBe(0);
  });

  it('le contrat historique { kpis, monthly, waterfall, cash_flow } est préservé', async () => {
    mockQuery.mockImplementation(wireTreso({}));
    const res = await get('/api/finance/gl/2026/tresorerie');
    expect(typeof res.body.kpis).toBe('object');
    expect(res.body.monthly).toHaveLength(12);
    expect(Array.isArray(res.body.waterfall)).toBe(true);
    expect(Array.isArray(res.body.cash_flow)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// B-bis) PUT /finance/gl/:year/solde-initial — saisie ADMIN
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT PUT /finance/gl/:year/solde-initial (ADMIN uniquement)', () => {
  it('ADMIN : upsert du setting + renvoie le solde initial re-résolu', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/INSERT INTO settings/.test(s)) return Promise.resolve({ rows: [] });
      if (/FROM settings WHERE key = \$1/.test(s)) return Promise.resolve({ rows: [{ value: '1234.56' }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await putAs(adminToken)('/api/finance/gl/2026/solde-initial', { montant: '1 234,56' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.solde_initial).toMatchObject({ montant: 1234.56, source: 'setting', annee: 2026 });
    // L'écriture cible bien la clé settings paramétrée par année, valeur normalisée
    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO settings/.test(String(sql)));
    expect(insertCall).toBeTruthy();
    expect(insertCall[1][0]).toBe('finance.tresorerie_solde_initial_2026');
    expect(insertCall[1][1]).toBe('1234.56');
  });

  it('ADMIN : montant null → efface la saisie (DELETE) et rend la main à la cascade', async () => {
    const res = await putAs(adminToken)('/api/finance/gl/2026/solde-initial', { montant: null });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.solde_initial.source).toBe('aucune');
    const deleteCall = mockQuery.mock.calls.find(([sql]) => /DELETE FROM settings/.test(String(sql)));
    expect(deleteCall).toBeTruthy();
    expect(deleteCall[1][0]).toBe('finance.tresorerie_solde_initial_2026');
  });

  it('ADMIN : montant non numérique → 400 (aucune écriture)', async () => {
    const res = await putAs(adminToken)('/api/finance/gl/2026/solde-initial', { montant: 'abc' });
    expect(res.status).toBe(400);
    const writes = mockQuery.mock.calls.filter(([sql]) => /INSERT INTO settings|DELETE FROM settings/.test(String(sql)));
    expect(writes).toHaveLength(0);
  });

  it('ADMIN : année invalide → 400', async () => {
    const res = await putAs(adminToken)('/api/finance/gl/abcd/solde-initial', { montant: '100' });
    expect(res.status).toBe(400);
  });

  it('MANAGER → 403 (authorize ADMIN au niveau route)', async () => {
    const res = await putAs(managerToken)('/api/finance/gl/2026/solde-initial', { montant: '100' });
    expect(res.status).toBe(403);
  });

  it('FINANCE (lecture seule) → 403 (garde par méthode du routeur)', async () => {
    const res = await putAs(financeToken)('/api/finance/gl/2026/solde-initial', { montant: '100' });
    expect(res.status).toBe(403);
  });
});

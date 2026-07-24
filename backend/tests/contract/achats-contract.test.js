// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — MODULE ACHATS RESPONSABLES (RSEI-17)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la forme de réponse, la matrice d'habilitations et les invariants du
// 31e module (routes/achats.js) :
//   1. ORACLES : isResponsable (≥ 1 drapeau), normalizeName (rapprochement strict),
//      aggregateFds (FDS à traiter : document/date manquants ou périmée) ;
//   2. HABILITATIONS : lecture ADMIN/MANAGER/RH/QHSE, écriture ADMIN/RH/MANAGER
//      (QHSE lit mais n'écrit PAS) ;
//   3. CRUD fournisseurs / critères / FDS (enum, doublon 23505, FK 23503) ;
//   4. DASHBOARD : part de fournisseurs responsables (en NOMBRE), FDS manquantes, et
//      rapprochement CLASSE 60 « jamais de valeur inventée » (part_montant null si
//      total classe 60 indisponible ; estimation si GL + tiers rapprochés).
//
// Auth réelle (JWT sans `tv`), DB mockée, activity-logger mocké. Même harnais que
// enquetes-contract.test.js / energie-contract.test.js.
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

const achats = require('../../src/routes/achats');
const tokenFor = (role) => jwt.sign({ id: 1, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER'),
  QHSE: tokenFor('QHSE'), COLLABORATEUR: tokenFor('COLLABORATEUR'),
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/achats', achats);
});
beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (path, role, body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const put = (path, role, body = {}) => request(app).put(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const del = (path, role) => request(app).delete(path).set('Authorization', `Bearer ${TOKENS[role]}`);

// ───────────────────────────────────────────────────────────────────────────
// ORACLE isResponsable — ≥ 1 des 4 drapeaux
// ───────────────────────────────────────────────────────────────────────────
describe('ORACLE isResponsable', () => {
  it('true dès qu\'un drapeau est vrai, false si aucun', () => {
    expect(achats.isResponsable({ local: true, inclusif: false, demarche_rse: false, labellise: false })).toBe(true);
    expect(achats.isResponsable({ local: false, inclusif: false, demarche_rse: false, labellise: true })).toBe(true);
    expect(achats.isResponsable({ local: false, inclusif: false, demarche_rse: false, labellise: false })).toBe(false);
    expect(achats.isResponsable({})).toBe(false);
    expect(achats.isResponsable(null)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ORACLE normalizeName — égalité stricte normalisée (accents/casse/ponctuation)
// ───────────────────────────────────────────────────────────────────────────
describe('ORACLE normalizeName', () => {
  it('neutralise accents, casse, ponctuation et espaces', () => {
    expect(achats.normalizeName('Éco-Fournitures SARL')).toBe(achats.normalizeName('eco fournitures sarl'));
    expect(achats.normalizeName('  ATELIER   du   Tri  ')).toBe('atelier du tri');
    expect(achats.normalizeName(null)).toBe('');
    // Deux raisons sociales distinctes ne se rapprochent pas (borne basse honnête).
    expect(achats.normalizeName('Fournisseur A')).not.toBe(achats.normalizeName('Fournisseur B'));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ORACLE aggregateFds — FDS à traiter (document/date manquants ou périmée)
// ───────────────────────────────────────────────────────────────────────────
describe('ORACLE aggregateFds', () => {
  const TODAY = new Date('2027-06-01T00:00:00Z');
  const ROWS = [
    // OK : document joint + révision récente
    { id: 1, produit: 'Détergent', has_fichier: true, date_fds: '2026-01-01', date_revision: '2027-01-01' },
    // document non joint → à traiter
    { id: 2, produit: 'Solvant', has_fichier: false, date_fds: '2027-01-01', date_revision: null },
    // aucune date → à traiter
    { id: 3, produit: 'Colle', has_fichier: true, date_fds: null, date_revision: null },
    // périmée (révision > 365 j) → à traiter
    { id: 4, produit: 'Acide', has_fichier: true, date_fds: '2024-01-01', date_revision: '2025-01-01' },
  ];

  it('compte sans_fichier / sans_date / périmées et liste les FDS à traiter', () => {
    const agg = achats.aggregateFds(ROWS, 365, TODAY);
    expect(agg.total).toBe(4);
    expect(agg.sans_fichier).toBe(1); // Solvant
    expect(agg.sans_date).toBe(1);    // Colle
    expect(agg.perimees).toBe(1);     // Acide (rev 2025-01 < 2027-06 − 365 j)
    expect(agg.a_traiter).toBe(3);    // Détergent OK
    expect(agg.fraicheur_jours).toBe(365);
    const ids = agg.liste_a_traiter.map((x) => x.id).sort();
    expect(ids).toEqual([2, 3, 4]);
    const acide = agg.liste_a_traiter.find((x) => x.id === 4);
    expect(acide.motif).toContain('périmée');
  });

  it('seuil de fraîcheur invalide → défaut 365 ; liste vide si tout est conforme', () => {
    const agg = achats.aggregateFds([{ id: 9, produit: 'OK', has_fichier: true, date_fds: '2027-05-01', date_revision: '2027-05-01' }], 0, TODAY);
    expect(agg.fraicheur_jours).toBe(365);
    expect(agg.a_traiter).toBe(0);
    expect(agg.liste_a_traiter).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// FOURNISSEURS — habilitations + CRUD
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /achats/fournisseurs (habilitations + CRUD)', () => {
  it('GET : lecture ADMIN/MANAGER/RH/QHSE, refusée COLLABORATEUR (403)', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'RH', 'QHSE']) {
      expect((await get('/api/achats/fournisseurs', role)).status).toBe(200);
    }
    expect((await get('/api/achats/fournisseurs', 'COLLABORATEUR')).status).toBe(403);
  });

  it('POST : écriture ADMIN/RH/MANAGER ; QHSE lit mais N\'ÉCRIT PAS (403) ; COLLABORATEUR 403', async () => {
    expect((await post('/api/achats/fournisseurs', 'QHSE', { nom: 'X' })).status).toBe(403);
    expect((await post('/api/achats/fournisseurs', 'COLLABORATEUR', { nom: 'X' })).status).toBe(403);
    // catégorie hors enum → 400 (validation)
    expect((await post('/api/achats/fournisseurs', 'ADMIN', { nom: 'X', categorie: 'inconnu' })).status).toBe(400);

    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO achats_fournisseurs/.test(String(sql))) {
        return Promise.resolve({ rows: [{
          id: 1, nom: params[0], categorie: params[2], local: params[3], inclusif: params[4],
          demarche_rse: params[5], labellise: params[6], responsable: params[3] || params[4] || params[5] || params[6],
        }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/achats/fournisseurs', 'MANAGER', { nom: 'Éco-Fournitures', categorie: 'fournitures', inclusif: true });
    expect(res.status).toBe(201);
    expect(res.body.responsable).toBe(true); // inclusif → responsable
    expect(res.body.categorie).toBe('fournitures');
  });

  it('GET ?responsable=1 : filtre appliqué en SQL (drapeaux)', async () => {
    let captured = '';
    mockQuery.mockImplementation((sql) => { captured = String(sql); return Promise.resolve({ rows: [] }); });
    await get('/api/achats/fournisseurs?responsable=1', 'RH');
    expect(captured).toMatch(/f\.local OR f\.inclusif OR f\.demarche_rse OR f\.labellise/);
  });

  it('DELETE : introuvable → 404', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/DELETE FROM achats_fournisseurs/.test(String(sql))) return Promise.resolve({ rowCount: 0, rows: [] });
      return Promise.resolve({ rows: [] });
    });
    expect((await del('/api/achats/fournisseurs/999', 'ADMIN')).status).toBe(404);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// CRITÈRES — CRUD + doublon (famille, critere) 23505 → 409
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /achats/criteres', () => {
  it('POST : RH valide → 201 ; doublon (23505) → 409', async () => {
    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO achats_criteres/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 3, famille: params[0], critere: params[1] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const ok = await post('/api/achats/criteres', 'RH', { famille: 'epi', critere: 'Exiger les FDS' });
    expect(ok.status).toBe(201);
    expect(ok.body.famille).toBe('epi');

    mockQuery.mockImplementation((sql) => {
      if (/INSERT INTO achats_criteres/.test(String(sql))) { const e = new Error('dup'); e.code = '23505'; return Promise.reject(e); }
      return Promise.resolve({ rows: [] });
    });
    expect((await post('/api/achats/criteres', 'ADMIN', { famille: 'epi', critere: 'Exiger les FDS' })).status).toBe(409);
  });

  it('POST : critère vide → 400 ; QHSE (lecture seule) → 403', async () => {
    expect((await post('/api/achats/criteres', 'ADMIN', { critere: '' })).status).toBe(400);
    expect((await post('/api/achats/criteres', 'QHSE', { critere: 'X' })).status).toBe(403);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// FDS — CRUD + FK fournisseur inconnu 23503 → 400 + habilitations
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /achats/fds', () => {
  it('GET : QHSE lit le registre FDS → 200', async () => {
    expect((await get('/api/achats/fds', 'QHSE')).status).toBe(200);
  });

  it('POST : produit + fournisseur → 201 ; fournisseur inconnu (23503) → 400', async () => {
    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO achats_fds/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 5, produit: params[0], fournisseur_id: params[1], has_fichier: false }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const ok = await post('/api/achats/fds', 'ADMIN', { produit: 'Eau de Javel', fournisseur_id: 2, dangers: 'corrosif' });
    expect(ok.status).toBe(201);
    expect(ok.body.produit).toBe('Eau de Javel');
    expect(ok.body.has_fichier).toBe(false);

    mockQuery.mockImplementation((sql) => {
      if (/INSERT INTO achats_fds/.test(String(sql))) { const e = new Error('fk'); e.code = '23503'; return Promise.reject(e); }
      return Promise.resolve({ rows: [] });
    });
    expect((await post('/api/achats/fds', 'ADMIN', { produit: 'X', fournisseur_id: 999 })).status).toBe(400);
  });

  it('GET /fds/:id/fichier : aucune pièce jointe → 404', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT fichier_path/.test(String(sql))) return Promise.resolve({ rowCount: 1, rows: [{ fichier_path: null }] });
      return Promise.resolve({ rows: [] });
    });
    expect((await get('/api/achats/fds/5/fichier', 'RH')).status).toBe(404);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DASHBOARD — part responsables (NOMBRE) + FDS + rapprochement classe 60
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /achats/dashboard', () => {
  // Fournisseurs : 4 au total dont 2 responsables → 50 %.
  // FDS : 2 lignes dont 1 sans fichier → à traiter.
  const base = (sql) => {
    const s = String(sql);
    if (/AS actifs/.test(s) && /FROM achats_fournisseurs/.test(s)) {
      return Promise.resolve({ rows: [{ total: 4, actifs: 4, local: 1, inclusif: 1, demarche_rse: 0, labellise: 0, responsables: 2 }] });
    }
    if (/GROUP BY f\.categorie/.test(s)) {
      return Promise.resolve({ rows: [{ famille: 'fournitures', total: 3, responsables: 2 }, { famille: 'autre', total: 1, responsables: 0 }] });
    }
    if (/FROM achats_criteres WHERE actif/.test(s)) {
      return Promise.resolve({ rows: [{ id: 1, famille: 'epi', critere: 'FDS', poids: null }, { id: 2, famille: 'fournitures', critere: 'Local', poids: null }] });
    }
    if (/FROM achats_fds d LEFT JOIN/.test(s)) {
      return Promise.resolve({ rows: [
        { id: 1, produit: 'Javel', has_fichier: true, date_fds: '2027-01-01', date_revision: null, reference: 'R1', dangers: 'corrosif', fournisseur_nom: 'Éco' },
        { id: 2, produit: 'Solvant', has_fichier: false, date_fds: '2027-01-01', date_revision: null, reference: null, dangers: 'inflammable', fournisseur_nom: null },
      ] });
    }
    return null;
  };

  it('lecture QHSE → 200 ; part de fournisseurs responsables en NOMBRE + FDS à traiter', async () => {
    mockQuery.mockImplementation((sql, params) => {
      const hit = base(sql);
      if (hit) return hit;
      if (/FROM settings WHERE key/.test(String(sql))) return Promise.resolve({ rows: [] });
      if (/financial_gl_entries/.test(String(sql))) return Promise.reject(new Error('no GL')); // pas de Grand Livre
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/achats/dashboard?annee=2027', 'QHSE');
    expect(res.status).toBe(200);
    expect(typeof res.body.generated_at).toBe('string');
    expect(res.body.fournisseurs.total).toBe(4);
    expect(res.body.fournisseurs.responsables).toBe(2);
    expect(res.body.fournisseurs.part_responsables_pct).toBe(50); // 2/4
    expect(res.body.fournisseurs.par_famille).toHaveLength(2);
    expect(res.body.criteres.total).toBe(2);
    expect(res.body.criteres.par_famille.epi).toHaveLength(1);
    // FDS : Solvant sans fichier → à traiter
    expect(res.body.fds.total).toBe(2);
    expect(res.body.fds.sans_fichier).toBe(1);
    expect(res.body.fds.a_traiter).toBeGreaterThanOrEqual(1);
  });

  it('classe 60 INDISPONIBLE (pas de GL, pas de setting) → part_montant null, source indisponible (jamais de valeur inventée)', async () => {
    mockQuery.mockImplementation((sql) => {
      const hit = base(sql);
      if (hit) return hit;
      if (/FROM settings WHERE key/.test(String(sql))) return Promise.resolve({ rows: [] });
      if (/financial_gl_entries/.test(String(sql))) return Promise.reject(new Error('no GL'));
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/achats/dashboard?annee=2027', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.montant.total_classe_60).toBeNull();
    expect(res.body.montant.total_source).toBe('indisponible');
    expect(res.body.montant.part_montant_pct).toBeNull();
    expect(res.body.montant.part_source).toBe('indisponible');
  });

  it('classe 60 disponible (GL) + tiers rapproché → estimation de la part en montant', async () => {
    mockQuery.mockImplementation((sql) => {
      const hit = base(sql);
      if (hit) return hit;
      const s = String(sql);
      if (/FROM settings WHERE key/.test(s)) return Promise.resolve({ rows: [] }); // aucun setting → GL
      if (/third_party AS tiers/.test(s)) {
        return Promise.resolve({ rows: [
          { tiers: 'Éco-Fournitures SARL', montant: 30000 },
          { tiers: 'Grossiste Anonyme', montant: 70000 },
        ] });
      }
      if (/AS total/.test(s) && /financial_gl_entries/.test(s)) {
        return Promise.resolve({ rows: [{ total: 100000 }] }); // total classe 60
      }
      if (/SELECT nom FROM achats_fournisseurs/.test(s)) {
        return Promise.resolve({ rows: [{ nom: 'eco fournitures sarl' }] }); // responsable, rapproché par nom normalisé
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/achats/dashboard?annee=2027', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.montant.total_classe_60).toBe(100000);
    expect(res.body.montant.total_source).toBe('gl');
    expect(res.body.montant.fournisseurs_rapproches).toBe(1);
    expect(res.body.montant.montant_responsables).toBe(30000);
    expect(res.body.montant.part_montant_pct).toBe(30); // 30000 / 100000
    expect(res.body.montant.part_source).toBe('estimation_gl');
  });

  it('total classe 60 depuis un setting de référence (pas de GL) → total settings, part montant indisponible', async () => {
    mockQuery.mockImplementation((sql, params) => {
      const hit = base(sql);
      if (hit) return hit;
      const s = String(sql);
      if (/FROM settings WHERE key/.test(s)) {
        if (params && params[0] === 'achats.montant_reference_annee') return Promise.resolve({ rows: [{ value: '250000' }] });
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/achats/dashboard?annee=2027', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.montant.total_classe_60).toBe(250000);
    expect(res.body.montant.total_source).toBe('settings');
    // Numérateur non rapprochable sans GL → part en montant indisponible (honnête).
    expect(res.body.montant.part_montant_pct).toBeNull();
    expect(res.body.montant.part_source).toBe('indisponible');
  });
});

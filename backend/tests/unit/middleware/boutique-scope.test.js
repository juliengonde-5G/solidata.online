// Mock la base avant d'importer le middleware (auth.js déclenche une requête au require).
jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
const pool = require('../../../src/config/database');

const {
  boutiqueScopeSql,
  canAccessBoutique,
  enforceBoutiqueParam,
  enforceBoutiqueForEntity,
  attachBoutiqueScope,
  loadUserBoutiqueIds,
} = require('../../../src/middleware/boutique-scope');

function mockRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  pool.query.mockReset();
});

describe('boutiqueScopeSql', () => {
  it('accès total (scope null) → aucun filtre, params inchangés', () => {
    const params = [10];
    const sql = boutiqueScopeSql({ boutiqueScope: null }, 'b.id', params);
    expect(sql).toBe('');
    expect(params).toEqual([10]);
  });

  it('périmètre non vide → clause IN paramétrée avec bons index', () => {
    const params = ['2026-01-01'];
    const sql = boutiqueScopeSql({ boutiqueScope: new Set([3, 7]) }, 'b.id', params);
    expect(sql).toBe(' AND b.id IN ($2,$3)');
    expect(params).toEqual(['2026-01-01', 3, 7]);
  });

  it('périmètre vide → AND false (ne renvoie rien)', () => {
    const params = [];
    const sql = boutiqueScopeSql({ boutiqueScope: new Set() }, 'boutique_id', params);
    expect(sql).toBe(' AND false');
    expect(params).toEqual([]);
  });
});

describe('canAccessBoutique', () => {
  it('scope null → toujours vrai', () => {
    expect(canAccessBoutique({ boutiqueScope: null }, 5)).toBe(true);
  });
  it('id dans le périmètre → vrai (tolère string/number)', () => {
    expect(canAccessBoutique({ boutiqueScope: new Set([5]) }, '5')).toBe(true);
  });
  it('id hors périmètre → faux', () => {
    expect(canAccessBoutique({ boutiqueScope: new Set([5]) }, 9)).toBe(false);
  });
});

describe('enforceBoutiqueParam', () => {
  it('id absent → passe (le filtrage liste prend le relais)', () => {
    const res = mockRes();
    expect(enforceBoutiqueParam({ boutiqueScope: new Set([1]) }, res, undefined)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });
  it('id invalide → 400', () => {
    const res = mockRes();
    expect(enforceBoutiqueParam({ boutiqueScope: null }, res, 'abc')).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it('id hors périmètre → 403', () => {
    const res = mockRes();
    expect(enforceBoutiqueParam({ boutiqueScope: new Set([1]) }, res, 2)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it('id dans le périmètre → true, aucune réponse', () => {
    const res = mockRes();
    expect(enforceBoutiqueParam({ boutiqueScope: new Set([2]) }, res, 2)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });
  it('accès total → true quel que soit l\'id', () => {
    const res = mockRes();
    expect(enforceBoutiqueParam({ boutiqueScope: null }, res, 999)).toBe(true);
  });
});

describe('enforceBoutiqueForEntity', () => {
  it('accès total → true sans requête SQL', async () => {
    const res = mockRes();
    const ok = await enforceBoutiqueForEntity({ boutiqueScope: null }, res, 'boutique_commandes', 1);
    expect(ok).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('table hors whitelist → 500', async () => {
    const res = mockRes();
    const ok = await enforceBoutiqueForEntity({ boutiqueScope: new Set([1]) }, res, 'users', 1);
    expect(ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(500);
  });
  it('entité introuvable → 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    const ok = await enforceBoutiqueForEntity({ boutiqueScope: new Set([1]) }, res, 'boutique_commandes', 42);
    expect(ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(404);
  });
  it('entité hors périmètre → 403', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ boutique_id: 9 }] });
    const res = mockRes();
    const ok = await enforceBoutiqueForEntity({ boutiqueScope: new Set([1]) }, res, 'boutique_commandes', 3);
    expect(ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it('entité dans le périmètre → true', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ boutique_id: 1 }] });
    const res = mockRes();
    const ok = await enforceBoutiqueForEntity({ boutiqueScope: new Set([1]) }, res, 'boutique_commandes', 3);
    expect(ok).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('loadUserBoutiqueIds', () => {
  it('mappe les lignes en entiers', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ boutique_id: '2' }, { boutique_id: 5 }] });
    const ids = await loadUserBoutiqueIds(7);
    expect(ids).toEqual([2, 5]);
    // La requête union combine user_boutiques + responsable_id
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/user_boutiques/);
    expect(sql).toMatch(/responsable_id/);
  });
});

describe('attachBoutiqueScope', () => {
  it('sans utilisateur → 401', async () => {
    const res = mockRes();
    const next = jest.fn();
    await attachBoutiqueScope({}, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('ADMIN → accès total (scope null), aucune requête périmètre', async () => {
    const req = { user: { id: 1, role: 'ADMIN' } };
    const next = jest.fn();
    await attachBoutiqueScope(req, mockRes(), next);
    expect(req.boutiqueScope).toBeNull();
    expect(next).toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('MANAGER → accès total (scope null)', async () => {
    const req = { user: { id: 2, role: 'MANAGER' } };
    const next = jest.fn();
    await attachBoutiqueScope(req, mockRes(), next);
    expect(req.boutiqueScope).toBeNull();
    expect(next).toHaveBeenCalled();
  });

  it('RESP_BTQ → périmètre restreint chargé depuis la base', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ boutique_id: 4 }, { boutique_id: 8 }] });
    const req = { user: { id: 3, role: 'RESP_BTQ' } };
    const next = jest.fn();
    await attachBoutiqueScope(req, mockRes(), next);
    expect(req.boutiqueScope instanceof Set).toBe(true);
    expect([...req.boutiqueScope].sort()).toEqual([4, 8]);
    expect(next).toHaveBeenCalled();
  });

  it('RESP_BTQ sans affectation → périmètre vide (Set vide)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const req = { user: { id: 3, role: 'RESP_BTQ' } };
    const next = jest.fn();
    await attachBoutiqueScope(req, mockRes(), next);
    expect(req.boutiqueScope instanceof Set).toBe(true);
    expect(req.boutiqueScope.size).toBe(0);
    expect(next).toHaveBeenCalled();
  });

  it('autre rôle (RH) → accès total (comportement historique)', async () => {
    const req = { user: { id: 9, role: 'RH' } };
    const next = jest.fn();
    await attachBoutiqueScope(req, mockRes(), next);
    expect(req.boutiqueScope).toBeNull();
    expect(next).toHaveBeenCalled();
  });
});

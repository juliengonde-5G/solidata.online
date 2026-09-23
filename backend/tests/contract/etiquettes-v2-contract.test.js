// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — ÉTIQUETTES V2 (2.57.0, contrat rapports/etiquettes-v2-2026-09-23 § 2.1)
// ───────────────────────────────────────────────────────────────────────────
// Ce qui est verrouillé ici :
//  1. /referentiel ne sert que l'actif ET codifié, dans la forme figée.
//  2. /generer compose un code v2 (13 hex), écrit TOUJOURS codification='v2',
//     valide la combinaison CÔTÉ SERVEUR (une combinaison forgée → 400
//     COMBINAISON_INVALIDE, rien n'est écrit), trace l'impression 'creation'.
//     L'Upcycling est une combinaison ordinaire (gamme UP).
//  3. Rôles : ADMIN / COLLABORATEUR / OPERATEUR_STOCK ; RH refusé.
//  4. /reimprimer : 404 / 409 DEJA_SORTI / 200 avec compteur et trace.
//  5. Voie manuelle POST /api/produits-finis : même générateur, même corps.
//  6. Admin : codes attribués d'office, renommages refusés quand ils changeraient
//     la signification d'un code déjà imprimé.
//
// Auth réelle (JWT), base mockée par routage SQL : aucun accès disque ni réseau.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');
const { refreshModuleAccess } = require('../../src/middleware/module-access');
const { decomposerCodeV2 } = require('../../src/utils/codification-etiquettes');

const tokenFor = (role, id = 7) => jwt.sign(
  { id, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), COLLABORATEUR: tokenFor('COLLABORATEUR'),
  OPERATEUR_STOCK: tokenFor('OPERATEUR_STOCK'), RH: tokenFor('RH'),
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/etiquettes', require('../../src/routes/etiquettes'));
  app.use('/api/produits-finis', require('../../src/routes/produits-finis'));
});

// ── Référentiel simulé ──────────────────────────────────────────────────────
const CODES = {
  gamme: { VAK: 3, UP: 5, EXTRA: 1 },
  categorie_eco_org: { Textiles: 1, Upcycling: 9 },
  genre: { 'Adulte Femme': 2, 'Sans Genre': 0 },
  saison: { Hiver: 2, 'Sans Saison': 0 },
};
const PRODUITS = { 12: { nom: 'Paréos', code: 0x2A }, 71: { nom: 'Upcycling', code: 71 } };
const COMBIS = [
  { id: 1, gamme: 'VAK', categorie_eco_org: 'Textiles', produit_id: 12, genre: 'Adulte Femme', saison: 'Hiver' },
  { id: 209, gamme: 'UP', categorie_eco_org: 'Upcycling', produit_id: 71, genre: 'Sans Genre', saison: 'Sans Saison' },
];
function ligneCombi(c) {
  return {
    combinaison_id: c.id, gamme: c.gamme, categorie_eco_org: c.categorie_eco_org,
    produit_id: c.produit_id, produit: PRODUITS[c.produit_id].nom, genre: c.genre, saison: c.saison,
    gamme_code: CODES.gamme[c.gamme], categorie_code: CODES.categorie_eco_org[c.categorie_eco_org],
    produit_code: PRODUITS[c.produit_id].code, genre_code: CODES.genre[c.genre], saison_code: CODES.saison[c.saison],
  };
}

let refus; let seq; let pfInserts; let impressions; let carton; let updates;
beforeEach(() => {
  refus = []; seq = 30; pfInserts = []; impressions = []; updates = [];
  carton = null;
  refreshModuleAccess();
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (text, params = []) => {
    const s = String(text);
    if (/role_module_access/.test(s)) return { rows: refus.filter(() => /allowed = false/.test(s)) };
    if (/FROM custom_roles/.test(s)) return { rows: [] };
    if (/FROM etiquettes_combinaisons c/.test(s) && /c\.gamme = \$1/.test(s)) {
      const [g, cat, pid, ge, sa] = params;
      const c = COMBIS.find((x) => x.gamme === g && x.categorie_eco_org === cat
        && x.produit_id === pid && x.genre === ge && x.saison === sa);
      return c ? { rows: [ligneCombi(c)], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/FROM etiquettes_combinaisons c/.test(s)) return { rows: COMBIS.map(ligneCombi) };
    if (/FROM ref_dimensions/.test(s) && /code IS NOT NULL/.test(s) && /SELECT type, valeur, code, definition/.test(s)) {
      return {
        rows: [
          { type: 'gamme', valeur: 'VAK', code: 3, definition: 'Vente au kilo' },
          { type: 'categorie_eco_org', valeur: 'Textiles', code: 1, definition: null },
          { type: 'genre', valeur: 'Adulte Femme', code: 2, definition: null },
          { type: 'saison', valeur: 'Hiver', code: 2, definition: null },
        ],
      };
    }
    if (/FROM etiquettes_produits WHERE is_active = true/.test(s)) return { rows: [{ id: 12, nom: 'Paréos', code: 42 }] };
    if (/FROM postes_etiquetage WHERE id = \$1 AND is_active/.test(s)) {
      return params[0] === 1 ? { rows: [{ id: 1, numero_poste: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/nextval\('produits_finis_reference_seq'\)/.test(s)) { seq += 1; return { rows: [{ ref: String(seq) }] }; }
    if (/FROM produits_catalogue/.test(s)) return { rows: [{ id: 5 }], rowCount: 1 };
    if (/INSERT INTO produits_finis/.test(s)) {
      pfInserts.push({ text: s, params });
      return {
        rows: [{
          id: 100 + pfInserts.length, code_barre: params[0], codification: 'v2', reference_colis: params[12],
          produit: params[2], categorie_eco_org: params[3], genre: params[4], saison: params[5], gamme: params[6],
          poids_kg: params[7], date_fabrication: '2026-09-23T10:00:00.000Z', batch_id: params[9],
          poste_etiquetage_id: params[8], nb_impressions: 1,
        }],
      };
    }
    if (/INSERT INTO etiquettes_impressions/.test(s)) { impressions.push({ text: s, params }); return { rows: [] }; }
    if (/FROM produits_finis pf/.test(s) && /FOR UPDATE/.test(s)) {
      return carton ? { rows: [carton], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/FROM produits_finis pf LEFT JOIN postes_etiquetage/.test(s)) {
      return carton ? { rows: [{ ...carton, nb_impressions: (carton.nb_impressions || 1) + updates.length, numero_poste: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/UPDATE produits_finis SET nb_impressions/.test(s)) { updates.push(params); return { rows: [], rowCount: 1 }; }
    return { rows: [], rowCount: 0 };
  });
});

const post = (url, role, body) => request(app).post(url).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const get = (url, role) => request(app).get(url).set('Authorization', `Bearer ${TOKENS[role]}`);

const CORPS = {
  poste_id: 1, gamme: 'VAK', categorie_eco_org: 'Textiles', produit_id: 12,
  genre: 'Adulte Femme', saison: 'Hiver', poids_kg: 12.5,
};

// ═══════════════════════════════════════════════════════════════════════════
describe('1. GET /referentiel', () => {
  it('forme figée : gammes avec définition, dimensions {valeur, code}, produits, combinaisons', async () => {
    const res = await get('/api/etiquettes/referentiel', 'OPERATEUR_STOCK');
    expect(res.status).toBe(200);
    expect(res.body.gammes).toEqual([{ valeur: 'VAK', code: 3, definition: 'Vente au kilo' }]);
    expect(res.body.categories).toEqual([{ valeur: 'Textiles', code: 1 }]);
    expect(res.body.genres).toEqual([{ valeur: 'Adulte Femme', code: 2 }]);
    expect(res.body.saisons).toEqual([{ valeur: 'Hiver', code: 2 }]);
    expect(res.body.produits).toEqual([{ id: 12, nom: 'Paréos', code: 42 }]);
    expect(res.body.combinaisons[0]).toEqual({
      id: 1, gamme: 'VAK', categorie_eco_org: 'Textiles', produit_id: 12, produit: 'Paréos',
      genre: 'Adulte Femme', saison: 'Hiver',
    });
  });

  it("filtrage : seul l'actif ET codifié est servi (dimensions, produits, combinaisons)", async () => {
    await get('/api/etiquettes/referentiel', 'ADMIN');
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    const dims = sqls.find((s) => /SELECT type, valeur, code, definition FROM ref_dimensions/.test(s));
    expect(dims).toMatch(/is_active = true AND code IS NOT NULL/);
    const combis = sqls.find((s) => /FROM etiquettes_combinaisons c/.test(s));
    expect(combis).toMatch(/WHERE c\.is_active = true/);
    expect(combis).toMatch(/p\.is_active = true/);
    for (const t of ['gamme', 'categorie_eco_org', 'genre', 'saison']) {
      expect(combis).toMatch(new RegExp(`type = '${t}'[\\s\\S]*?is_active = true AND d\\w\\.code IS NOT NULL`));
    }
  });

  it('les lectures /postes, /options, /dimensions sont AUSSI bornées aux rôles opérateur (audit 2.57.0)', async () => {
    // Elles n'avaient que requireModule : un RH ou un DPO les lisait. Contrat § 2.
    for (const p of ['/api/etiquettes/postes', '/api/etiquettes/options', '/api/etiquettes/dimensions']) {
      const rh = await request(app).get(p).set('Authorization', `Bearer ${TOKENS.RH}`);
      expect([p, rh.status]).toEqual([p, 403]);
      const op = await request(app).get(p).set('Authorization', `Bearer ${TOKENS.OPERATEUR_STOCK}`);
      expect([p, op.status]).toEqual([p, 200]);
    }
  });

  it('RH refusé (403), module retiré → 403 MODULE_NON_HABILITE', async () => {
    expect((await get('/api/etiquettes/referentiel', 'RH')).status).toBe(403);
    refus = [{ role: 'OPERATEUR_STOCK', module_key: 'etiquettes' }];
    const res = await get('/api/etiquettes/referentiel', 'OPERATEUR_STOCK');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MODULE_NON_HABILITE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. POST /generer', () => {
  it('combinaison valide → 201, code v2 de 13 hex, codification v2 écrite explicitement', async () => {
    const res = await post('/api/etiquettes/generer', 'COLLABORATEUR', CORPS);
    expect(res.status).toBe(201);
    expect(res.body.code_barre).toMatch(/^[0-9A-F]{13}$/);
    expect(decomposerCodeV2(res.body.code_barre)).toEqual({
      gamme: 3, categorie: 1, produit: 0x2A, genre: 2, saison: 2, reference: 31,
    });
    expect(res.body.code_barre).toBe('312A0220' + '0001F');
    expect(res.body.code_lisible).toBe('3-1-2A-02-2-00001F');
    expect(res.body.codification).toBe('v2');
    expect(res.body.reference_colis).toBe(31);
    expect(res.body.produit).toBe('Paréos');
    expect(res.body.poste_label).toBe('Poste 1');
    expect(res.body.nb_impressions).toBe(1);
    for (const k of ['id', 'categorie_eco_org', 'genre', 'saison', 'gamme', 'poids_kg', 'date_fabrication', 'batch_id', 'poste_etiquetage_id']) {
      expect(res.body).toHaveProperty(k);
    }
    // codification 'v2' en DUR dans l'INSERT, référence et combinaison liées.
    expect(pfInserts).toHaveLength(1);
    expect(pfInserts[0].text).toMatch(/codification, reference_colis, combinaison_id/);
    expect(pfInserts[0].text).toMatch(/'v2', \$13, \$14/);
    expect(pfInserts[0].params[12]).toBe(31);
    expect(pfInserts[0].params[13]).toBe(1);
    expect(pfInserts[0].params[11]).toBe('etiquette');
    // Trace de création.
    expect(impressions).toHaveLength(1);
    expect(impressions[0].text).toMatch(/'creation'/);
  });

  it('deux générations → deux codes distincts (référence de colis)', async () => {
    const a = await post('/api/etiquettes/generer', 'ADMIN', CORPS);
    const b = await post('/api/etiquettes/generer', 'ADMIN', CORPS);
    expect(a.body.code_barre).not.toBe(b.body.code_barre);
  });

  it("combinaison inexistante (validée CÔTÉ SERVEUR) → 400 COMBINAISON_INVALIDE, rien n'est écrit", async () => {
    const res = await post('/api/etiquettes/generer', 'ADMIN', { ...CORPS, saison: 'Sans Saison' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COMBINAISON_INVALIDE');
    expect(pfInserts).toHaveLength(0);
    expect(impressions).toHaveLength(0);
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /nextval/.test(s))).toBe(false);
    expect(sqls).toContain('ROLLBACK');
  });

  it('Upcycling = combinaison ordinaire (gamme UP) : 201, déclinaisons écrites telles quelles', async () => {
    const res = await post('/api/etiquettes/generer', 'OPERATEUR_STOCK', {
      poste_id: 1, gamme: 'UP', categorie_eco_org: 'Upcycling', produit_id: 71,
      genre: 'Sans Genre', saison: 'Sans Saison', poids_kg: 4.2,
    });
    expect(res.status).toBe(201);
    expect(res.body.code_barre.slice(0, 7)).toBe('5947000');
    expect(res.body).toMatchObject({ gamme: 'UP', categorie_eco_org: 'Upcycling', produit: 'Upcycling', genre: 'Sans Genre', saison: 'Sans Saison' });
    const p = pfInserts[0].params;
    expect(p.slice(2, 7)).toEqual(['Upcycling', 'Upcycling', 'Sans Genre', 'Sans Saison', 'UP']);
  });

  it('corps sans déclinaisons → 400 PARAMETRES, y compris pour Upcycling (plus de chemin NULL)', async () => {
    const res = await post('/api/etiquettes/generer', 'ADMIN', { poste_id: 1, categorie_eco_org: 'Upcycling', poids_kg: 4 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PARAMETRES');
    expect(mockQuery.mock.calls.some((c) => /BEGIN/.test(String(c[0])))).toBe(false);
  });

  it.each([[0], [-2], [1000.5], ['abc'], [null]])('poids %p → 400 PARAMETRES', async (poids) => {
    const res = await post('/api/etiquettes/generer', 'ADMIN', { ...CORPS, poids_kg: poids });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PARAMETRES');
  });

  it('poids 1000 kg accepté (borne incluse)', async () => {
    const res = await post('/api/etiquettes/generer', 'ADMIN', { ...CORPS, poids_kg: 1000 });
    expect(res.status).toBe(201);
  });

  it('poste inactif → 404', async () => {
    const res = await post('/api/etiquettes/generer', 'ADMIN', { ...CORPS, poste_id: 9 });
    expect(res.status).toBe(404);
  });

  it('OPERATEUR_STOCK autorisé, RH refusé (403) sans transaction', async () => {
    expect((await post('/api/etiquettes/generer', 'OPERATEUR_STOCK', CORPS)).status).toBe(201);
    mockQuery.mockClear();
    const res = await post('/api/etiquettes/generer', 'RH', CORPS);
    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some((c) => /BEGIN/.test(String(c[0])))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Voie manuelle POST /api/produits-finis', () => {
  it('même générateur (source manuel), même validation de combinaison', async () => {
    const ok = await post('/api/produits-finis', 'ADMIN', CORPS);
    expect(ok.status).toBe(201);
    expect(ok.body.codification).toBe('v2');
    expect(pfInserts[0].params[11]).toBe('manuel');
    const ko = await post('/api/produits-finis', 'ADMIN', { ...CORPS, genre: 'Sans Genre' });
    expect(ko.status).toBe(400);
    expect(ko.body.code).toBe('COMBINAISON_INVALIDE');
  });

  it('reste réservée à l’ADMIN', async () => {
    expect((await post('/api/produits-finis', 'OPERATEUR_STOCK', CORPS)).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. POST /reimprimer et GET /carton/:code', () => {
  const EN_STOCK = {
    id: 55, code_barre: '312A0220001F0', codification: 'v2', status: 'en_stock', date_sortie: null,
    produit: 'Paréos', gamme: 'VAK', categorie_eco_org: 'Textiles', genre: 'Adulte Femme', saison: 'Hiver',
    poids_kg: 10, nb_impressions: 1, poste_etiquetage_id: 1,
  };

  it('code inconnu → 404 NOT_FOUND', async () => {
    const res = await post('/api/etiquettes/reimprimer', 'OPERATEUR_STOCK', { code_barre: 'P10AAH' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('carton sorti → 409 DEJA_SORTI, aucune trace', async () => {
    carton = { ...EN_STOCK, status: 'expedie', date_sortie: '2026-09-20' };
    const res = await post('/api/etiquettes/reimprimer', 'OPERATEUR_STOCK', { code_barre: EN_STOCK.code_barre });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DEJA_SORTI');
    expect(updates).toHaveLength(0);
    expect(impressions).toHaveLength(0);
  });

  it('carton en stock → 200, MÊME code, compteur +1, trace « reimpression » avec motif', async () => {
    carton = { ...EN_STOCK };
    const res = await post('/api/etiquettes/reimprimer', 'OPERATEUR_STOCK', { code_barre: EN_STOCK.code_barre, motif: 'Étiquette déchirée' });
    expect(res.status).toBe(200);
    expect(res.body.code_barre).toBe(EN_STOCK.code_barre);
    expect(res.body.code_lisible).toBe('3-1-2A-02-2-0001F0');
    expect(res.body.nb_impressions).toBe(2);
    expect(updates).toHaveLength(1);
    expect(impressions[0].text).toMatch(/'reimpression'/);
    expect(impressions[0].params[1]).toBe('Étiquette déchirée');
  });

  it('ancien code réimprimé tel quel (code lisible = code brut)', async () => {
    carton = { ...EN_STOCK, code_barre: 'P10AAH', codification: 'ancien' };
    const res = await post('/api/etiquettes/reimprimer', 'ADMIN', { code_barre: 'p10aah' });
    expect(res.status).toBe(200);
    expect(res.body.code_barre).toBe('P10AAH');
    expect(res.body.code_lisible).toBe('P10AAH');
  });

  it('motif > 200 caractères → 400', async () => {
    carton = { ...EN_STOCK };
    const res = await post('/api/etiquettes/reimprimer', 'ADMIN', { code_barre: EN_STOCK.code_barre, motif: 'x'.repeat(201) });
    expect(res.status).toBe(400);
  });

  it('GET /carton/:code → 200 avec format, 404 avec format et code normalisé', async () => {
    carton = { ...EN_STOCK };
    const ok = await get(`/api/etiquettes/carton/${EN_STOCK.code_barre}`, 'OPERATEUR_STOCK');
    expect(ok.status).toBe(200);
    expect(ok.body.format).toBe('v2');
    expect(ok.body.carton).toMatchObject({ code_barre: EN_STOCK.code_barre, status: 'en_stock', nb_impressions: 1 });
    carton = null;
    const ko = await get('/api/etiquettes/carton/P10AAH', 'OPERATEUR_STOCK');
    expect(ko.status).toBe(404);
    expect(ko.body).toMatchObject({ code: 'NOT_FOUND', format: 'ancien_base24', code_normalise: 'P10AAH' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Administration', () => {
  it('POST /admin/produits-v2 : plus petit code libre ; 409 si nom existant', async () => {
    mockQuery.mockImplementation(async (text, params) => {
      const s = String(text);
      if (/lower\(nom\) = lower/.test(s)) return { rows: params[0] === 'Pulls' ? [{ id: 1 }] : [], rowCount: params[0] === 'Pulls' ? 1 : 0 };
      if (/SELECT code FROM etiquettes_produits/.test(s)) return { rows: [{ code: 1 }, { code: 2 }, { code: 4 }] };
      if (/INSERT INTO etiquettes_produits/.test(s)) return { rows: [{ id: 99, nom: params[0], code: params[1], is_active: true }] };
      return { rows: [] };
    });
    const ok = await post('/api/etiquettes/admin/produits-v2', 'ADMIN', { nom: 'Kimonos' });
    expect(ok.status).toBe(201);
    expect(ok.body.code).toBe(3);
    const ko = await post('/api/etiquettes/admin/produits-v2', 'ADMIN', { nom: 'Pulls' });
    expect(ko.status).toBe(409);
    expect(ko.body.code).toBe('PRODUIT_EXISTANT');
    expect((await post('/api/etiquettes/admin/produits-v2', 'OPERATEUR_STOCK', { nom: 'X' })).status).toBe(403);
  });

  it('POST /admin/produits-v2 : 409 CODES_EPUISES quand 1..255 sont pris', async () => {
    mockQuery.mockImplementation(async (text) => {
      const s = String(text);
      if (/SELECT code FROM etiquettes_produits/.test(s)) return { rows: Array.from({ length: 255 }, (_, i) => ({ code: i + 1 })) };
      return { rows: [], rowCount: 0 };
    });
    const res = await post('/api/etiquettes/admin/produits-v2', 'ADMIN', { nom: 'Trop' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CODES_EPUISES');
  });

  it('PATCH /admin/produits-v2/:id : renommer un produit imprimé → 409 PRODUIT_UTILISE', async () => {
    mockQuery.mockImplementation(async (text) => {
      const s = String(text);
      if (/SELECT id, nom FROM etiquettes_produits/.test(s)) return { rows: [{ id: 12, nom: 'Paréos' }], rowCount: 1 };
      if (/JOIN etiquettes_combinaisons c ON c\.id = pf\.combinaison_id/.test(s)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app).patch('/api/etiquettes/admin/produits-v2/12')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`).send({ nom: 'Paréo' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PRODUIT_UTILISE');
  });

  it('PATCH /admin/dimensions/:id : renommer une valeur codifiée → 409 VALEUR_CODIFIEE', async () => {
    mockQuery.mockImplementation(async (text) => {
      if (/SELECT id, valeur, code FROM ref_dimensions/.test(String(text))) return { rows: [{ id: 3, valeur: 'VAK', code: 3 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await request(app).patch('/api/etiquettes/admin/dimensions/3')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`).send({ valeur: 'Vrac' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VALEUR_CODIFIEE');
  });

  it('POST /admin/dimensions : code attribué d’office (gamme commence à 1)', async () => {
    let insertParams;
    mockQuery.mockImplementation(async (text, params) => {
      const s = String(text);
      if (/SELECT id, code FROM ref_dimensions WHERE type/.test(s)) return { rows: [], rowCount: 0 };
      if (/SELECT code FROM ref_dimensions WHERE type/.test(s)) return { rows: [{ code: 1 }, { code: 2 }, { code: 3 }, { code: 5 }] };
      if (/INSERT INTO ref_dimensions/.test(s)) { insertParams = params; return { rows: [{ id: 50, type: params[0], valeur: params[1], ordre: params[2], code: params[3], definition: params[4], is_active: true }] }; }
      return { rows: [] };
    });
    const res = await post('/api/etiquettes/admin/dimensions', 'ADMIN', { type: 'gamme', valeur: 'NEUF' });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe(4);
    expect(insertParams[3]).toBe(4);
  });

  it('POST /admin/combinaisons : valeur inactive ou sans code → 400', async () => {
    mockQuery.mockImplementation(async (text) => {
      const s = String(text);
      if (/FROM ref_dimensions/.test(s)) return { rows: [{ type: 'gamme' }, { type: 'categorie_eco_org' }, { type: 'genre' }] };
      if (/FROM etiquettes_produits WHERE id = \$1/.test(s)) return { rows: [{ id: 12 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await post('/api/etiquettes/admin/combinaisons', 'ADMIN', {
      gamme: 'VAK', categorie_eco_org: 'Textiles', produit_id: 12, genre: 'Adulte Femme', saison: 'Printemps',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COMBINAISON_INVALIDE');
    expect(res.body.error).toMatch(/saison/);
  });
});

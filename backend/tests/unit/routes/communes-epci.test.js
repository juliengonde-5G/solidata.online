// ═══════════════════════════════════════════════════════════════════════════
// TESTS — RÉFÉRENTIEL COMMUNES MULTI-EPCI (Lot 10, 2026-08)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille l'élargissement du référentiel communes aux EPCI limitrophes :
//   1. ORACLES purs : parseEpciSetting (setting JSON → liste jamais vide,
//      défaut Métropole Rouen), isValidEpciCode (SIREN 9 chiffres),
//      mapApiCommune (réponse geo.api.gouv.fr → ligne référentiel),
//      filterEpcisByDep (filtre département 27/76) ;
//   2. HABILITATIONS : GET /epcis + /epci-search ADMIN/MANAGER, POST/DELETE
//      /epcis ADMIN uniquement ;
//   3. CONFIG : ajout (400 code invalide, 409 doublon), retrait (404 inconnu,
//      409 Métropole protégée) ;
//   4. REFRESH multi-EPCI : boucle sur les EPCI configurés, is_metropole_rouen
//      true UNIQUEMENT pour 200023414, un EPCI en échec ne casse pas les autres
//      (récap par EPCI avec erreur), backfill des communes historiques par
//      ré-upsert.
// AUCUN appel réseau réel : geo.api.gouv.fr est mocké via global.fetch
// (l'API n'est joignable que depuis le serveur de production).
// Auth réelle (JWT sans `tv`), DB mockée — même harnais que
// achats-contract.test.js.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
const mockConnect = jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} }));
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));

const express = require('express');
const request = require('supertest');

const communes = require('../../../src/routes/communes');

const tokenFor = (role) => jwt.sign({ id: 1, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  ADMIN: tokenFor('ADMIN'),
  MANAGER: tokenFor('MANAGER'),
  COLLABORATEUR: tokenFor('COLLABORATEUR'),
};

let app;
const realFetch = global.fetch;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/communes', communes);
});
beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  global.fetch = jest.fn(() => { throw new Error('fetch non mocké pour ce test'); });
});
afterAll(() => { global.fetch = realFetch; });

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (path, role = 'ADMIN', body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const del = (path, role = 'ADMIN') => request(app).delete(path).set('Authorization', `Bearer ${TOKENS[role]}`);

const METROPOLE = '200023414';
const EPCIS_SETTING = JSON.stringify([
  { code: METROPOLE, nom: 'Métropole Rouen Normandie' },
  { code: '247600620', nom: 'CC inter-Caux-Vexin' },
]);

/** Le mock renvoie la liste d'EPCI configurée pour les SELECT settings. */
function mockSettingsValue(value) {
  mockQuery.mockImplementation(async (sql) => {
    if (typeof sql === 'string' && sql.includes('FROM settings')) {
      return { rows: value == null ? [] : [{ value }], rowCount: value == null ? 0 : 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 1. ORACLES purs
// ───────────────────────────────────────────────────────────────────────────
describe('ORACLE parseEpciSetting', () => {
  it('setting absent / vide / JSON invalide → défaut Métropole Rouen (jamais vide)', () => {
    for (const raw of [null, undefined, '', 'pas du json', '{"code":"x"}', '[]', '[{"code":"abc","nom":"X"}]']) {
      const out = communes.parseEpciSetting(raw);
      expect(out).toEqual([{ code: METROPOLE, nom: 'Métropole Rouen Normandie' }]);
    }
  });

  it('filtre les entrées malformées, trim et déduplique par code', () => {
    const raw = JSON.stringify([
      { code: ' 200023414 ', nom: ' Métropole Rouen Normandie ' },
      { code: '247600620', nom: 'CC inter-Caux-Vexin' },
      { code: '247600620', nom: 'Doublon' },            // doublon → écarté
      { code: '12345', nom: 'Code trop court' },        // pas un SIREN → écarté
      { code: '247600588', nom: '' },                   // nom vide → écarté
      'chaine', null, 42,                               // types invalides → écartés
    ]);
    expect(communes.parseEpciSetting(raw)).toEqual([
      { code: METROPOLE, nom: 'Métropole Rouen Normandie' },
      { code: '247600620', nom: 'CC inter-Caux-Vexin' },
    ]);
  });

  it('renvoie une COPIE du défaut (pas de mutation partagée)', () => {
    const a = communes.parseEpciSetting(null);
    a[0].nom = 'muté';
    expect(communes.parseEpciSetting(null)[0].nom).toBe('Métropole Rouen Normandie');
    expect(communes.DEFAULT_EPCIS[0].nom).toBe('Métropole Rouen Normandie');
  });
});

describe('ORACLE isValidEpciCode', () => {
  it('SIREN = exactement 9 chiffres', () => {
    expect(communes.isValidEpciCode('200023414')).toBe(true);
    expect(communes.isValidEpciCode('247600620')).toBe(true);
    expect(communes.isValidEpciCode('12345678')).toBe(false);
    expect(communes.isValidEpciCode('1234567890')).toBe(false);
    expect(communes.isValidEpciCode('20002341A')).toBe(false);
    expect(communes.isValidEpciCode('')).toBe(false);
    expect(communes.isValidEpciCode(200023414)).toBe(false);
    expect(communes.isValidEpciCode(null)).toBe(false);
  });
});

describe('ORACLE mapApiCommune', () => {
  it('mappe code/nom/premier code postal/population', () => {
    expect(communes.mapApiCommune({ code: '76108', nom: 'Le Houlme', codesPostaux: ['76770'], population: 4102 }))
      .toEqual({ code_insee: '76108', nom: 'Le Houlme', code_postal: '76770', population: 4102 });
  });
  it('codesPostaux absent/vide → null ; population non numérique → null', () => {
    expect(communes.mapApiCommune({ code: '27001', nom: 'Aclou' }))
      .toEqual({ code_insee: '27001', nom: 'Aclou', code_postal: null, population: null });
    expect(communes.mapApiCommune({ code: '27001', nom: 'Aclou', codesPostaux: [], population: 'n/a' }))
      .toEqual({ code_insee: '27001', nom: 'Aclou', code_postal: null, population: null });
  });
  it('entrée inexploitable → null', () => {
    expect(communes.mapApiCommune(null)).toBeNull();
    expect(communes.mapApiCommune({ nom: 'Sans code' })).toBeNull();
    expect(communes.mapApiCommune({ code: '76108' })).toBeNull();
  });
});

describe('ORACLE filterEpcisByDep', () => {
  const list = [
    { code: '1', nom: 'A', codesDepartements: ['27'] },
    { code: '2', nom: 'B', codesDepartements: ['76', '27'] },
    { code: '3', nom: 'C', codesDepartements: ['14'] },
    { code: '4', nom: 'D' }, // pas de codesDepartements → écarté si dep demandé
  ];
  it('sans département : liste inchangée', () => {
    expect(communes.filterEpcisByDep(list, '')).toEqual(list);
    expect(communes.filterEpcisByDep(list, null)).toEqual(list);
  });
  it('avec département : ne garde que les EPCI le contenant', () => {
    expect(communes.filterEpcisByDep(list, '27').map((e) => e.code)).toEqual(['1', '2']);
    expect(communes.filterEpcisByDep(list, '76').map((e) => e.code)).toEqual(['2']);
    expect(communes.filterEpcisByDep(list, '99')).toEqual([]);
  });
  it('entrée non-array → []', () => {
    expect(communes.filterEpcisByDep(null, '27')).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Habilitations
// ───────────────────────────────────────────────────────────────────────────
describe('Habilitations', () => {
  it('GET /epcis : ADMIN et MANAGER oui, COLLABORATEUR non', async () => {
    expect((await get('/api/communes/epcis', 'ADMIN')).status).toBe(200);
    expect((await get('/api/communes/epcis', 'MANAGER')).status).toBe(200);
    expect((await get('/api/communes/epcis', 'COLLABORATEUR')).status).toBe(403);
  });
  it('POST /epcis et DELETE /epcis/:code : ADMIN uniquement', async () => {
    expect((await post('/api/communes/epcis', 'MANAGER', { code: '247600620', nom: 'CC' })).status).toBe(403);
    expect((await del('/api/communes/epcis/247600620', 'MANAGER')).status).toBe(403);
  });
  it('GET /epci-search : MANAGER oui, COLLABORATEUR non', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => [] }));
    expect((await get('/api/communes/epci-search?q=caux', 'MANAGER')).status).toBe(200);
    expect((await get('/api/communes/epci-search?q=caux', 'COLLABORATEUR')).status).toBe(403);
  });
  it('sans token → 401', async () => {
    expect((await request(app).get('/api/communes/epcis')).status).toBe(401);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Configuration des EPCI suivis
// ───────────────────────────────────────────────────────────────────────────
describe('GET /epcis', () => {
  it('sans setting : défaut Métropole Rouen + metropole_code', async () => {
    const r = await get('/api/communes/epcis');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      epcis: [{ code: METROPOLE, nom: 'Métropole Rouen Normandie' }],
      metropole_code: METROPOLE,
    });
  });
  it('avec setting : liste configurée', async () => {
    mockSettingsValue(EPCIS_SETTING);
    const r = await get('/api/communes/epcis');
    expect(r.status).toBe(200);
    expect(r.body.epcis).toHaveLength(2);
    expect(r.body.epcis[1]).toEqual({ code: '247600620', nom: 'CC inter-Caux-Vexin' });
  });
});

describe('POST /epcis', () => {
  it('400 si code non SIREN ou nom vide', async () => {
    expect((await post('/api/communes/epcis', 'ADMIN', { code: '12AB', nom: 'X' })).status).toBe(400);
    expect((await post('/api/communes/epcis', 'ADMIN', { code: '247600620', nom: '  ' })).status).toBe(400);
  });
  it('409 si déjà suivi', async () => {
    mockSettingsValue(EPCIS_SETTING);
    const r = await post('/api/communes/epcis', 'ADMIN', { code: '247600620', nom: 'CC inter-Caux-Vexin' });
    expect(r.status).toBe(409);
  });
  it('201 : ajoute, persiste dans settings (JSON) et renvoie la liste', async () => {
    mockSettingsValue(null); // aucun setting → défaut Métropole seul
    const r = await post('/api/communes/epcis', 'ADMIN', { code: ' 247600620 ', nom: ' CC inter-Caux-Vexin ' });
    expect(r.status).toBe(201);
    expect(r.body.epcis).toEqual([
      { code: METROPOLE, nom: 'Métropole Rouen Normandie' },
      { code: '247600620', nom: 'CC inter-Caux-Vexin' },
    ]);
    const upsert = mockQuery.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO settings'));
    expect(upsert).toBeDefined();
    expect(upsert[1][0]).toBe(communes.EPCI_SETTING_KEY);
    expect(JSON.parse(upsert[1][1])).toEqual(r.body.epcis);
  });
});

describe('DELETE /epcis/:code', () => {
  it('409 : la Métropole Rouen (référence du reporting) n\'est pas retirable', async () => {
    mockSettingsValue(EPCIS_SETTING);
    const r = await del(`/api/communes/epcis/${METROPOLE}`, 'ADMIN');
    expect(r.status).toBe(409);
  });
  it('404 si EPCI non suivi', async () => {
    mockSettingsValue(EPCIS_SETTING);
    expect((await del('/api/communes/epcis/999999999', 'ADMIN')).status).toBe(404);
  });
  it('200 : retire et persiste la liste restante', async () => {
    mockSettingsValue(EPCIS_SETTING);
    const r = await del('/api/communes/epcis/247600620', 'ADMIN');
    expect(r.status).toBe(200);
    expect(r.body.epcis).toEqual([{ code: METROPOLE, nom: 'Métropole Rouen Normandie' }]);
    const upsert = mockQuery.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO settings'));
    expect(JSON.parse(upsert[1][1])).toEqual([{ code: METROPOLE, nom: 'Métropole Rouen Normandie' }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. GET /epci-search (proxy geo.api.gouv.fr mocké)
// ───────────────────────────────────────────────────────────────────────────
describe('GET /epci-search', () => {
  it('400 si q trop court ou département invalide', async () => {
    expect((await get('/api/communes/epci-search?q=a')).status).toBe(400);
    expect((await get('/api/communes/epci-search?q=caux&dep=XX')).status).toBe(400);
  });

  it('proxifie vers geo.api.gouv.fr, refiltre par département et marque deja_suivi', async () => {
    mockSettingsValue(EPCIS_SETTING);
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => [
        { code: '247600620', nom: 'CC inter-Caux-Vexin', codesDepartements: ['76'] },
        { code: '247600588', nom: 'CC Caux-Austreberthe', codesDepartements: ['76'] },
        { code: '241400555', nom: 'CC hors périmètre', codesDepartements: ['14'] },
      ],
    }));
    const r = await get('/api/communes/epci-search?q=caux&dep=76');
    expect(r.status).toBe(200);
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('/epcis?nom=caux');
    expect(url).toContain('codeDepartement=76');
    expect(r.body.results.map((e) => e.code)).toEqual(['247600620', '247600588']);
    expect(r.body.results[0].deja_suivi).toBe(true);   // déjà dans la config
    expect(r.body.results[1].deja_suivi).toBe(false);
  });

  it('erreur réseau (dev sans Internet) → 502 avec message propre, timeout → 504', async () => {
    global.fetch = jest.fn(async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { name: 'Error' }); });
    let r = await get('/api/communes/epci-search?q=caux');
    expect(r.status).toBe(502);
    expect(r.body.error).toContain('geo.api.gouv.fr');

    global.fetch = jest.fn(async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); });
    r = await get('/api/communes/epci-search?q=caux');
    expect(r.status).toBe(504);
    expect(r.body.error).toContain('accès Internet du serveur');
  });

  it('statut HTTP non-2xx de l\'API → 502', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const r = await get('/api/communes/epci-search?q=caux');
    expect(r.status).toBe(502);
    expect(r.body.error).toContain('503');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Refresh multi-EPCI
// ───────────────────────────────────────────────────────────────────────────
describe('POST /refresh-epcis (et alias /refresh-metropole)', () => {
  it('boucle sur les EPCI configurés ; un EPCI en échec ne casse pas les autres ; récap par EPCI', async () => {
    mockSettingsValue(EPCIS_SETTING);
    global.fetch = jest.fn(async (url) => {
      if (url.includes(`/epcis/${METROPOLE}/communes`)) {
        return {
          ok: true, status: 200,
          json: async () => [
            { code: '76540', nom: 'Rouen', codesPostaux: ['76000'], population: 114083 },
            { code: '76108', nom: 'Le Houlme', codesPostaux: ['76770'], population: 4102 },
          ],
        };
      }
      // 2e EPCI : l'API répond 500 → l'EPCI est en échec, pas la requête globale
      return { ok: false, status: 500, json: async () => ({}) };
    });

    const r = await post('/api/communes/refresh-epcis', 'ADMIN');
    expect(r.status).toBe(200);
    expect(r.body.epcis).toHaveLength(2);
    expect(r.body.epcis[0]).toMatchObject({ code: METROPOLE, communes_upsertees: 2, inserted: 2, updated: 0 });
    expect(r.body.epcis[1]).toMatchObject({ code: '247600620', communes_upsertees: 0 });
    expect(r.body.epcis[1].erreur).toContain('500');
    expect(r.body.ok).toBe(1);
    expect(r.body.echecs).toBe(1);
    expect(r.body.total).toBe(2);

    // is_metropole_rouen = true UNIQUEMENT pour l'EPCI 200023414 (scoping KPI)
    const upserts = mockQuery.mock.calls.filter(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO referentiel_communes'));
    expect(upserts).toHaveLength(2);
    for (const [, params] of upserts) {
      expect(params[3]).toBe(METROPOLE);                 // epci_code
      expect(params[4]).toBe('Métropole Rouen Normandie'); // epci_nom
      expect(params[6]).toBe(true);                       // is_metropole_rouen
    }
  });

  it('un EPCI limitrophe est upserté avec is_metropole_rouen = false', async () => {
    mockSettingsValue(JSON.stringify([{ code: '247600620', nom: 'CC inter-Caux-Vexin' }]));
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => [{ code: '76750', nom: 'Buchy', codesPostaux: ['76750'], population: 1350 }],
    }));
    const r = await post('/api/communes/refresh-metropole', 'ADMIN'); // alias historique
    expect(r.status).toBe(200);
    const [, params] = mockQuery.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO referentiel_communes'));
    expect(params[3]).toBe('247600620');
    expect(params[4]).toBe('CC inter-Caux-Vexin');
    expect(params[6]).toBe(false); // PAS Métropole → n'entre pas dans le scope KPI
  });

  it('réponse inattendue (non-array) → EPCI en échec, réponse 200 quand même', async () => {
    mockSettingsValue(null); // défaut Métropole seul
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ pas: 'un tableau' }) }));
    const r = await post('/api/communes/refresh-epcis', 'ADMIN');
    expect(r.status).toBe(200);
    expect(r.body.echecs).toBe(1);
    expect(r.body.epcis[0].erreur).toContain('inattendue');
  });
});

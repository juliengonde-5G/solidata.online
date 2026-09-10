// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — ACTUALITÉ LOCALE SUR L'ÉCRAN DU POSTE
// Référence : ADR-0006 (presse) + son addendum du 10/09/2026 (portées).
// ───────────────────────────────────────────────────────────────────────────
// Ce que ces tests protègent, et pourquoi c'est coûteux à retrouver après coup :
//
//  1. LA NON-RÉGRESSION DES ÉCRANS EXISTANTS. Un écran de presse configuré
//     avant l'addendum doit continuer d'afficher l'actualité nationale, et
//     RIEN d'autre. Le jour où le défaut de portée basculerait sur « toutes »,
//     l'atelier verrait des brèves locales apparaître sans que personne ne
//     l'ait demandé — et personne ne saurait pourquoi.
//  2. LA PORTÉE VIENT DU FLUX, jamais du texte. Rien dans un article ne dit
//     s'il est local ; le deviner serait inventer une donnée.
//  3. L'ESSAI D'UN FLUX N'ÉCRIT RIEN et garde toutes les gardes anti-SSRF :
//     c'est un point d'entrée où un utilisateur colle une URL arbitraire que
//     le serveur va chercher.
//  4. LE PÉRIMÈTRE DU RÔLE COMMUNICATION : diffuser, oui ; le reste du module
//     Temps & Présence, non.
//
// Auth réelle (JWT), DB mockée, `fetch` et `dns` mockés : aucun appel réseau.
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
const mockLookup = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
jest.mock('dns', () => ({ promises: { lookup: (...a) => mockLookup(...a) } }));

const express = require('express');
const request = require('supertest');
const badgeuse = require('../../src/routes/badgeuse');

const tokenFor = (role, id = 1) => jwt.sign(
  { id, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER'),
  COMMUNICATION: tokenFor('COMMUNICATION'), COLLABORATEUR: tokenFor('COLLABORATEUR'),
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/badgeuse', badgeuse);
});

const get = (p, role = 'ADMIN') => request(app).get(p).set('Authorization', `Bearer ${TOKENS[role]}`);
const put = (p, role, body = {}) => request(app).put(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const post = (p, role, body = {}) => request(app).post(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

let settings;
let compteurs;
let erreurCompteurs;

function installMocks(o = {}) {
  settings = { ...(o.settings || {}) };
  compteurs = o.compteurs === undefined
    ? [{ portee: 'locale', total: 4, dernier: '2026-09-09T07:00:00Z' },
       { portee: 'nationale', total: 8, dernier: '2026-09-10T06:00:00Z' }]
    : o.compteurs;
  erreurCompteurs = o.erreurCompteurs || null;

  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(s)) return Promise.resolve({ rows: [] });
    if (/SELECT key, value FROM settings WHERE key LIKE/.test(s)) {
      return Promise.resolve({ rows: Object.entries(settings).map(([key, value]) => ({ key, value })) });
    }
    if (/SELECT key, value FROM settings WHERE key IN/.test(s)) {
      return Promise.resolve({
        rows: Object.entries(settings).filter(([k]) => (params || []).includes(k)).map(([key, value]) => ({ key, value })),
      });
    }
    if (/SELECT value FROM settings/.test(s)) {
      const key = params && params[0];
      return Promise.resolve({ rows: settings[key] != null ? [{ value: settings[key] }] : [] });
    }
    if (/INSERT INTO settings/.test(s)) { settings[params[0]] = params[1]; return Promise.resolve({ rows: [] }); }
    if (/FROM badgeuse_presse_articles/.test(s)) {
      if (erreurCompteurs) return Promise.reject(Object.assign(new Error('colonne absente'), { code: erreurCompteurs }));
      return Promise.resolve({ rows: compteurs });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => { mockQuery.mockReset(); mockConnect.mockClear(); installMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
// 1. GET /presse/status
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /presse/status', () => {
  test('rend les flux avec leur portée et les compteurs par portée', async () => {
    installMocks({
      settings: {
        'badgeuse.presse_flux': JSON.stringify([
          { libelle: 'Journal local', source: 'Journal local', url: 'https://exemple.fr/rss', actif: true, portee: 'locale' },
        ]),
      },
    });
    const r = await get('/api/badgeuse/presse/status');
    expect(r.status).toBe(200);
    expect(r.body.flux[0]).toMatchObject({ url: 'https://exemple.fr/rss', actif: true, portee: 'locale' });
    expect(r.body.par_portee).toEqual(expect.arrayContaining([
      expect.objectContaining({ portee: 'locale', articles: 4 }),
    ]));
  });

  test('un flux SANS portée est présenté « nationale » (et non « inconnue »)', async () => {
    installMocks({
      settings: { 'badgeuse.presse_flux': JSON.stringify([{ url: 'https://exemple.fr/rss', actif: true }]) },
    });
    expect((await get('/api/badgeuse/presse/status')).body.flux[0].portee).toBe('nationale');
  });

  test('base non migrée : `par_portee` vaut null — jamais « 0 article »', async () => {
    // Un « 0 » se lirait « les flux ne rapportent rien », ce qui enverrait
    // l'exploitant chercher un problème qui n'existe pas.
    installMocks({ erreurCompteurs: '42703' });
    const r = await get('/api/badgeuse/presse/status');
    expect(r.status).toBe(200);
    expect(r.body.par_portee).toBeNull();
  });

  test('habilitations : la surface AFFICHAGE, COMMUNICATION compris', async () => {
    expect((await get('/api/badgeuse/presse/status', 'COMMUNICATION')).status).toBe(200);
    expect((await get('/api/badgeuse/presse/status', 'MANAGER')).status).toBe(200);
    expect((await get('/api/badgeuse/presse/status', 'COLLABORATEUR')).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PUT /presse/config
// ═══════════════════════════════════════════════════════════════════════════
describe('PUT /presse/config', () => {
  const flux = (o = {}) => ({ libelle: 'Journal local', source: 'Journal local', url: 'https://exemple.fr/rss', actif: true, portee: 'locale', ...o });

  test('enregistre les flux avec leur portée', async () => {
    const r = await put('/api/badgeuse/presse/config', 'COMMUNICATION', { flux: [flux()], sync_actif: true });
    expect(r.status).toBe(200);
    expect(JSON.parse(settings['badgeuse.presse_flux'])[0]).toMatchObject({ portee: 'locale', actif: true });
    expect(settings['badgeuse.presse_sync_actif']).toBe('true');
  });

  test('un flux en http est REFUSÉ, et le lot entier avec lui', async () => {
    const r = await put('/api/badgeuse/presse/config', 'ADMIN', {
      flux: [flux(), flux({ url: 'http://exemple.fr/rss' })], sync_actif: true,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/https/i);
    // Rien n'a été écrit : un paramétrage à moitié appliqué serait pire.
    expect(settings['badgeuse.presse_flux']).toBeUndefined();
    expect(settings['badgeuse.presse_sync_actif']).toBeUndefined();
  });

  test('une portée inconnue est refusée (liste fermée)', async () => {
    // `porteeDeFlux` normalise déjà tout ce qui n'est pas « locale » en
    // « nationale » : ce test vérifie que le CONTRÔLE de fond existe malgré
    // tout côté réglages — c'est lui qui protège une écriture directe.
    const { validateAffichageSettings } = require('../../src/utils/badgeuse-settings');
    expect(validateAffichageSettings([['badgeuse.presse_flux', [{ url: 'https://x.fr/rss', portee: 'regionale' }]]]))
      .toMatch(/portée/i);
  });

  test('habilitation : écriture réservée à la surface AFFICHAGE', async () => {
    expect((await put('/api/badgeuse/presse/config', 'COMMUNICATION', { sync_actif: true })).status).toBe(200);
    expect((await put('/api/badgeuse/presse/config', 'MANAGER', { sync_actif: true })).status).toBe(403);
    expect((await put('/api/badgeuse/presse/config', 'COLLABORATEUR', { sync_actif: true })).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. POST /presse/tester — l'essai n'écrit RIEN et garde les gardes SSRF
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /presse/tester', () => {
  const RSS = `<?xml version="1.0"?><rss><channel>
      <item><title>Le pont rouvre lundi</title><description>Circulation rétablie.</description>
      <guid>a1</guid><pubDate>Tue, 09 Sep 2026 07:00:00 +0200</pubDate></item>
    </channel></rss>`;

  /** Réponse HTTP simulée, à la forme que `fetchFluxRss` consomme réellement. */
  const reponse = (corps, type = 'application/rss+xml') => {
    const h = new Map([['content-type', type]]);
    return { ok: true, status: 200, headers: { get: (k) => h.get(String(k).toLowerCase()) },
             text: async () => corps };
  };

  test('un flux lisible rend le nombre d\'articles ET le premier titre', async () => {
    global.fetch = jest.fn(async () => reponse(RSS));
    const r = await post('/api/badgeuse/presse/tester', 'COMMUNICATION', { url: 'https://exemple.fr/rss' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, articles: 1, premier_titre: 'Le pont rouvre lundi' });
    // AUCUNE écriture : l'essai regarde, il ne range pas.
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO badgeuse_presse_articles/.test(String(c[0])))).toBe(false);
    expect(settings['badgeuse.presse_flux']).toBeUndefined();
  });

  test('une adresse interne est refusée — et l\'échec est une RÉPONSE, pas un 500', async () => {
    global.fetch = jest.fn();
    const r = await post('/api/badgeuse/presse/tester', 'ADMIN', { url: 'https://127.0.0.1/rss' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.motif).toMatch(/interne/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('http est refusé (le serveur sort à la place du poste, pas n\'importe comment)', async () => {
    const r = await post('/api/badgeuse/presse/tester', 'ADMIN', { url: 'http://exemple.fr/rss' });
    expect(r.body.ok).toBe(false);
    expect(r.body.motif).toMatch(/https/i);
  });

  test('une page HTML n\'est pas un flux, et le motif le DIT', async () => {
    global.fetch = jest.fn(async () => reponse('<html></html>', 'text/html'));
    const r = await post('/api/badgeuse/presse/tester', 'ADMIN', { url: 'https://exemple.fr/actualites' });
    expect(r.body.ok).toBe(false);
    expect(r.body.motif).toMatch(/flux RSS/i);
  });

  test('habilitation : COLLABORATEUR ne peut pas faire sortir le serveur', async () => {
    expect((await post('/api/badgeuse/presse/tester', 'COLLABORATEUR', { url: 'https://exemple.fr/rss' })).status).toBe(403);
  });

});

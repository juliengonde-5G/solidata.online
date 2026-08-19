// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — ÉCRAN D'INFORMATION v2 (back-office badgeuse)
// Références : docs/badgeuse/CDC_AFFICHAGE_V2.md §2/§4, ADR-0004 §4/§6.
// ───────────────────────────────────────────────────────────────────────────
// Trois familles de garanties, toutes coûteuses à retrouver après coup :
//
//  1. ANTI-SSRF (`POST /contenus/lien`) — le serveur devient client HTTP pour
//     que le poste n'ait pas à l'être. C'est la surface la plus dangereuse du
//     lot : chaque garde a son test (https strict, adresses internes,
//     redirection revalidée, type et taille plafonnés).
//  2. CONSENTEMENT (`POST /salaries/:id/optin-festif`) — recueil et retrait
//     JOURNALISÉS DANS LA TRANSACTION : un consentement non tracé ne se prouve
//     pas, et l'ADR-0004 §4 en fait la condition de l'affichage festif.
//  3. PARAMÉTRAGE (`PUT /parametres`) — les gabarits doivent rester
//     substituables ({prenom}) et les plages lisibles : un paramétrage cassé
//     casserait l'écran en silence.
//
// Auth réelle (JWT), DB mockée, `dns` et `fetch` mockés : aucun appel réseau,
// aucune résolution de nom réelle ne part de ces tests.
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

// Résolution DNS mockée : les gardes anti-SSRF sont éprouvées sans jamais
// interroger un résolveur réel (et donc sans dépendre du réseau du CI).
const mockLookup = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
jest.mock('dns', () => ({ promises: { lookup: (...a) => mockLookup(...a) } }));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const media = require('../../src/services/badgeuse-social');
const { decryptSecret } = require('../../src/utils/badgeuse-crypto');

const badgeuse = require('../../src/routes/badgeuse');
const { BADGEUSE_SETTING_DEFAULTS } = require('../../src/utils/badgeuse-settings');

const tokenFor = (role, id = 1) => jwt.sign(
  { id, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER'),
  COLLABORATEUR: tokenFor('COLLABORATEUR'),
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/badgeuse', badgeuse);
});

const post = (p, role, body = {}) => request(app).post(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const put = (p, role, body = {}) => request(app).put(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const get = (p, role = 'ADMIN') => request(app).get(p).set('Authorization', `Bearer ${TOKENS[role]}`);

/** Mock DB. `settings` est mutable : les PUT y écrivent vraiment. */
function installMocks({ settings = {}, employee = { id: 5 }, badges = [] } = {}) {
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
    if (/INSERT INTO badgeuse_contenus/.test(s)) {
      return Promise.resolve({ rows: [{ id: 42, type: params[1] === undefined ? 'media' : params[1], fichier: params.find((v) => typeof v === 'string' && /^(media|lien)-/.test(v)) || null }] });
    }
    if (/DELETE FROM badgeuse_contenus/.test(s)) return Promise.resolve({ rows: [{ id: 42, fichier: null }] });
    if (/UPDATE employees/.test(s)) {
      return Promise.resolve({
        rows: employee ? [{ id: employee.id, badgeuse_optin_festif: params[1], badgeuse_optin_festif_le: params[1] ? new Date().toISOString() : null }] : [],
      });
    }
    if (/FROM badgeuse_badges b/.test(s)) return Promise.resolve({ rows: badges });
    if (/FROM badgeuse_social_posts/.test(s)) return Promise.resolve({ rows: [{ total: 3, dernier: '2026-08-10T10:00:00Z' }] });
    if (/INSERT INTO rgpd_audit_log/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

/** Entrées rgpd_audit_log réellement émises. */
const journal = () => mockQuery.mock.calls
  .filter((c) => /INSERT INTO rgpd_audit_log/.test(String(c[0])))
  .map((c) => ({ action: c[1][1], entity: c[1][2], entity_id: c[1][3], details: JSON.parse(c[1][4]) }));

/** Réponse HTTP simulée (forme minimale de l'API fetch de Node 20). */
function fakeResponse({ status = 200, headers = {}, chunks = [Buffer.from('binaire')] }) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  let i = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (h.has(String(k).toLowerCase()) ? h.get(String(k).toLowerCase()) : null) },
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length ? { done: false, value: new Uint8Array(chunks[i++]) } : { done: true }),
        cancel: async () => {},
      }),
    },
    arrayBuffer: async () => Buffer.concat(chunks),
  };
}

let fetchSpy;
beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockClear();
  mockLookup.mockReset();
  mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  installMocks();
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    fakeResponse({ headers: { 'content-type': 'image/jpeg', 'content-length': '7' } })
  );
});
afterEach(() => fetchSpy.mockRestore());

// ═══════════════════════════════════════════════════════════════════════════
// 1. POST /contenus/lien — gardes anti-SSRF
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /contenus/lien — le serveur télécharge à la place du poste', () => {
  const LIEN = 'https://exemple.test/visuel.jpg';

  test('nominal : le contenu est rapatrié et devient un média local', async () => {
    const r = await post('/api/badgeuse/contenus/lien', 'ADMIN', { url: LIEN, titre: 'Affiche' });
    expect(r.status).toBe(201);

    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_contenus/.test(String(c[0])));
    expect(insert[1]).toContain('image');   // media_type déduit du Content-Type
    expect(insert[1]).toContain(LIEN);      // provenance conservée (auditabilité)
    const fichier = insert[1].find((v) => typeof v === 'string' && v.startsWith('lien-'));
    expect(fichier).toBeDefined();
    // Le binaire est bien sur le disque du serveur : le poste n'ira jamais le
    // chercher chez le tiers.
    const abs = media.resolveMediaPath(fichier);
    expect(fs.existsSync(abs)).toBe(true);
    fs.unlinkSync(abs);
  });

  test('HTTP simple REFUSÉ (422) — https uniquement', async () => {
    const r = await post('/api/badgeuse/contenus/lien', 'ADMIN', { url: 'http://exemple.test/visuel.jpg' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('protocole');
    expect(fetchSpy).not.toHaveBeenCalled(); // rien n'est même tenté
  });

  test('nom de domaine résolvant vers une IP PRIVÉE → refusé, sans requête sortante', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const r = await post('/api/badgeuse/contenus/lien', 'ADMIN', { url: 'https://interne.test/x.jpg' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('ip_privee');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('UNE SEULE adresse interne parmi plusieurs suffit à refuser', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    const r = await post('/api/badgeuse/contenus/lien', 'ADMIN', { url: 'https://mixte.test/x.jpg' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('ip_privee');
  });

  test('adresse de MÉTADONNÉES cloud en dur dans l\'URL → refusée sans DNS', async () => {
    const r = await post('/api/badgeuse/contenus/lien', 'ADMIN', { url: 'https://169.254.169.254/latest/meta-data/' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('ip_privee');
    expect(mockLookup).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('loopback IPv6 littéral → refusé', async () => {
    const r = await post('/api/badgeuse/contenus/lien', 'ADMIN', { url: 'https://[::1]/x.jpg' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('ip_privee');
  });

  test('REDIRECTION vers une adresse interne → refusée au saut suivant', async () => {
    fetchSpy.mockResolvedValueOnce(fakeResponse({ status: 302, headers: { location: 'https://interne.test/x.jpg' } }));
    mockLookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]) // 1er saut public
      .mockResolvedValueOnce([{ address: '192.168.1.10', family: 4 }]); // cible interne
    const r = await post('/api/badgeuse/contenus/lien', 'ADMIN', { url: LIEN });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('ip_privee');
  });

  test('boucle de redirections → refusée (jamais de poursuite indéfinie)', async () => {
    fetchSpy.mockResolvedValue(fakeResponse({ status: 302, headers: { location: 'https://exemple.test/encore.jpg' } }));
    const r = await post('/api/badgeuse/contenus/lien', 'ADMIN', { url: LIEN });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('redirections');
  });

  test('type non diffusable (page HTML) → 422 avec un message compréhensible', async () => {
    fetchSpy.mockResolvedValue(fakeResponse({ headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const r = await post('/api/badgeuse/contenus/lien', 'ADMIN', { url: 'https://exemple.test/page' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('type');
    expect(r.body.error).toMatch(/image ou une vidéo/i);
  });

  test('taille ANNONCÉE au-dessus du plafond → refusée avant téléchargement', async () => {
    installMocks({ settings: { 'badgeuse.lien_taille_max_mo': '1' } });
    fetchSpy.mockResolvedValue(fakeResponse({
      headers: { 'content-type': 'video/mp4', 'content-length': String(5 * 1024 * 1024) },
    }));
    const r = await post('/api/badgeuse/contenus/lien', 'ADMIN', { url: 'https://exemple.test/film.mp4' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('trop_gros');
  });

  test('taille MENSONGÈRE : le flux est coupé net au dépassement, aucun fichier ne reste', async () => {
    installMocks({ settings: { 'badgeuse.lien_taille_max_mo': '1' } });
    const gros = Buffer.alloc(700 * 1024, 1);
    fetchSpy.mockResolvedValue(fakeResponse({
      headers: { 'content-type': 'image/png' }, // aucun content-length annoncé
      chunks: [gros, gros],                     // 1,4 Mo réels pour un plafond de 1 Mo
    }));
    const r = await post('/api/badgeuse/contenus/lien', 'ADMIN', { url: 'https://exemple.test/gros.png' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('trop_gros');
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO badgeuse_contenus/.test(String(c[0])))).toBe(false);
  });

  test('réponse 404 du tiers → 422 (jamais un 500 de notre côté)', async () => {
    fetchSpy.mockResolvedValue(fakeResponse({ status: 404, headers: {} }));
    const r = await post('/api/badgeuse/contenus/lien', 'ADMIN', { url: LIEN });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('http');
  });

  test('habilitation : écriture réservée ADMIN/RH', async () => {
    expect((await post('/api/badgeuse/contenus/lien', 'RH', { url: LIEN })).status).toBe(201);
    expect((await post('/api/badgeuse/contenus/lien', 'MANAGER', { url: LIEN })).status).toBe(403);
    expect((await post('/api/badgeuse/contenus/lien', 'COLLABORATEUR', { url: LIEN })).status).toBe(403);
    // Nettoyage des fichiers créés par les cas autorisés.
    for (const c of mockQuery.mock.calls.filter((x) => /INSERT INTO badgeuse_contenus/.test(String(x[0])))) {
      const f = c[1].find((v) => typeof v === 'string' && v.startsWith('lien-'));
      if (f) media.unlinkMedia(f);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. POST /contenus/upload — téléversement d'un média
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /contenus/upload', () => {
  const attach = (role, nom, type, contenu = Buffer.from('89504e470d0a1a0a', 'hex')) => request(app)
    .post('/api/badgeuse/contenus/upload')
    .set('Authorization', `Bearer ${TOKENS[role]}`)
    .attach('fichier', contenu, { filename: nom, contentType: type });

  test('image acceptée : contenu `media` créé avec son condensat SHA-256', async () => {
    const r = await attach('ADMIN', 'affiche.png', 'image/png');
    expect(r.status).toBe(201);
    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_contenus/.test(String(c[0])));
    expect(insert[1]).toContain('image');
    const sha = insert[1].find((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v));
    expect(sha).toBeDefined();
    const fichier = insert[1].find((v) => typeof v === 'string' && v.startsWith('media-'));
    media.unlinkMedia(fichier);
  });

  test('SVG REFUSÉ (415) — format exécutable côté navigateur, jamais diffusé', async () => {
    const r = await attach('ADMIN', 'piege.svg', 'image/svg+xml', Buffer.from('<svg onload="alert(1)"/>'));
    expect(r.status).toBe(415);
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO badgeuse_contenus/.test(String(c[0])))).toBe(false);
  });

  test('habilitation : MANAGER refusé', async () => {
    expect((await attach('MANAGER', 'affiche.png', 'image/png')).status).toBe(403);
  });

  // ── Plafond de taille (défaut de production : « network error » sur vidéo) ──
  //
  // CE QUI S'EST PASSÉ : le plafond applicatif valait 100 Mo alors que le
  // reverse proxy refuse tout corps au-delà de 50 Mo. Une vidéo de 60 Mo
  // passait donc les contrôles de l'écran, partait, et se faisait couper en
  // vol : le navigateur n'avait plus de réponse à lire et affichait
  // « network error ». Ces tests verrouillent les deux moitiés du correctif —
  // le plafond est UN réglage lu depuis la base, et il est ANNONCÉ à l'écran.

  test('le plafond annoncé est celui du réglage, pas une constante figée', async () => {
    installMocks({ settings: { 'badgeuse.media_upload_max_mo': '50' } });
    const r = await get('/api/badgeuse/contenus/upload-limites', 'ADMIN');
    expect(r.status).toBe(200);
    expect(r.body.max_mo).toBe(50);
    expect(r.body.extensions).toEqual(expect.arrayContaining(['.mp4', '.webm']));
  });

  test('relever le réglage relève le plafond annoncé, sans redémarrage', async () => {
    installMocks({ settings: { 'badgeuse.media_upload_max_mo': '80' } });
    expect((await get('/api/badgeuse/contenus/upload-limites', 'ADMIN')).body.max_mo).toBe(80);
  });

  test('réglage absent : repli sur le défaut documenté (50 Mo), jamais illimité', async () => {
    installMocks({ settings: {} });
    expect((await get('/api/badgeuse/contenus/upload-limites', 'ADMIN')).body.max_mo)
      .toBe(BADGEUSE_SETTING_DEFAULTS['badgeuse.media_upload_max_mo']);
  });

  test('vidéo au-delà du plafond : 413 EXPLICITE en français, jamais un échec muet', async () => {
    installMocks({ settings: { 'badgeuse.media_upload_max_mo': '1' } });
    const grosse = Buffer.alloc(2 * 1024 * 1024, 0); // 2 Mo pour un plafond de 1 Mo
    const r = await attach('ADMIN', 'veille.mp4', 'video/mp4', grosse);

    expect(r.status).toBe(413);
    expect(r.body.max_mo).toBe(1);
    // Le message doit nommer la limite : c'est tout l'objet du correctif.
    expect(r.body.error).toMatch(/trop volumineux/i);
    expect(r.body.error).toContain('1 Mo');
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO badgeuse_contenus/.test(String(c[0])))).toBe(false);
  });

  test('vidéo sous le plafond : acceptée et enregistrée en type vidéo', async () => {
    installMocks({ settings: { 'badgeuse.media_upload_max_mo': '5' } });
    const r = await attach('ADMIN', 'veille.mp4', 'video/mp4', Buffer.alloc(1024 * 1024, 7));

    expect(r.status).toBe(201);
    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_contenus/.test(String(c[0])));
    expect(insert[1]).toContain('video');
    const fichier = insert[1].find((v) => typeof v === 'string' && v.startsWith('media-'));
    expect(fichier).toMatch(/\.mp4$/);
    media.unlinkMedia(fichier);
  });

  test('le plafond est un réglage d\'EXPLOITATION : le modifier ne vaut pas arbitrage RH (ADR-0002)', async () => {
    const settings = {};
    installMocks({ settings });
    const r = await put('/api/badgeuse/parametres', 'ADMIN', { media_upload_max_mo: 40 });
    expect(r.status).toBe(200);
    expect(settings['badgeuse.media_upload_max_mo']).toBe('40');
    expect(settings['badgeuse.regles_validees_le']).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Consentement à l'affichage festif (ADR-0004 §4)
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /salaries/:employeeId/optin-festif', () => {
  test('le recueil est JOURNALISÉ, dans la même transaction que l\'écriture', async () => {
    const r = await post('/api/badgeuse/salaries/5/optin-festif', 'ADMIN', { actif: true });
    expect(r.status).toBe(200);
    expect(r.body.badgeuse_optin_festif).toBe(true);
    expect(r.body.badgeuse_optin_festif_le).toBeTruthy(); // un consentement se date

    const entree = journal().find((j) => j.action === 'BADGEUSE_OPTIN_FESTIF');
    expect(entree).toBeDefined();
    expect(entree.details).toMatchObject({ employee_id: 5, consentement: 'recueilli' });
    expect(entree.details.finalite).toMatch(/anniversaires/i);

    // Ordre réel : BEGIN … UPDATE … INSERT journal … COMMIT.
    const ordre = mockQuery.mock.calls.map((c) => String(c[0]).trim().split(/\s+/).slice(0, 3).join(' '));
    const iBegin = ordre.findIndex((x) => x.startsWith('BEGIN'));
    const iLog = ordre.findIndex((x) => x.startsWith('INSERT INTO rgpd_audit_log'));
    const iCommit = ordre.findIndex((x) => x.startsWith('COMMIT'));
    expect(iBegin).toBeGreaterThanOrEqual(0);
    expect(iLog).toBeGreaterThan(iBegin);
    expect(iCommit).toBeGreaterThan(iLog);
  });

  test('le RETRAIT est aussi tracé, et efface la date de recueil', async () => {
    const r = await post('/api/badgeuse/salaries/5/optin-festif', 'ADMIN', { actif: false });
    expect(r.status).toBe(200);
    expect(r.body.badgeuse_optin_festif).toBe(false);
    expect(journal().find((j) => j.action === 'BADGEUSE_OPTIN_FESTIF').details.consentement).toBe('retire');
    const upd = mockQuery.mock.calls.find((c) => /UPDATE employees/.test(String(c[0])));
    expect(String(upd[0])).toMatch(/badgeuse_optin_festif_le = CASE WHEN \$2 THEN NOW\(\) ELSE NULL END/);
  });

  test('salarié inconnu → 404 (et transaction annulée)', async () => {
    installMocks({ employee: null });
    const r = await post('/api/badgeuse/salaries/999/optin-festif', 'ADMIN', { actif: true });
    expect(r.status).toBe(404);
    expect(mockQuery.mock.calls.some((c) => /ROLLBACK/.test(String(c[0])))).toBe(true);
  });

  test('`actif` est obligatoire et booléen', async () => {
    expect((await post('/api/badgeuse/salaries/5/optin-festif', 'ADMIN', {})).status).toBe(400);
  });

  test('habilitation : ADMIN/RH seulement', async () => {
    expect((await post('/api/badgeuse/salaries/5/optin-festif', 'RH', { actif: true })).status).toBe(200);
    expect((await post('/api/badgeuse/salaries/5/optin-festif', 'MANAGER', { actif: true })).status).toBe(403);
  });

  test('GET /badges expose l\'état du consentement ET sa date', async () => {
    installMocks({
      badges: [{
        id: 1, employee_id: 5, uid_hmac: 'a'.repeat(64), statut: 'actif', first_name: 'Karim',
        last_name: 'Benali', malibou_id: 'M1', badgeuse_optin_festif: true,
        badgeuse_optin_festif_le: '2026-08-01T09:00:00Z',
      }],
    });
    const r = await get('/api/badgeuse/badges');
    expect(r.body[0]).toMatchObject({
      badgeuse_optin_festif: true, badgeuse_optin_festif_le: '2026-08-01T09:00:00Z',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. PUT /parametres — garde-fous d'affichage (ADR-0002 : tout est paramétré)
// ═══════════════════════════════════════════════════════════════════════════
describe('PUT /parametres — gabarits, plages et phrases', () => {
  test('un gabarit SANS {prenom} est refusé (400), et rien n\'est écrit', async () => {
    const r = await put('/api/badgeuse/parametres', 'ADMIN', { msg_matin: 'Bonjour à tous' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/\{prenom\}/);
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO settings/.test(String(c[0])))).toBe(false);
  });

  test('un gabarit valide passe et est enregistré', async () => {
    const r = await put('/api/badgeuse/parametres', 'ADMIN', { msg_matin: 'Salut {prenom} !' });
    expect(r.status).toBe(200);
    const ecriture = mockQuery.mock.calls.find((c) => /INSERT INTO settings/.test(String(c[0])) && c[1][0] === 'badgeuse.msg_matin');
    expect(ecriture[1][1]).toBe('Salut {prenom} !');
  });

  test('un gabarit trop long est refusé', async () => {
    const r = await put('/api/badgeuse/parametres', 'ADMIN', { msg_soir: `{prenom} ${'x'.repeat(200)}` });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/120 caractères/);
  });

  test('une plage horaire illisible est refusée', async () => {
    for (const valeur of ['11h30', '25:00', '', 'midi']) {
      const r = await put('/api/badgeuse/parametres', 'ADMIN', { moment_matin_fin: valeur });
      expect(r.status).toBe(400);
    }
    expect((await put('/api/badgeuse/parametres', 'ADMIN', { moment_matin_fin: '10:45' })).status).toBe(200);
  });

  test('le vivier de phrases : chaînes non vides, ≤ 200 caractères, ≤ 30 entrées', async () => {
    expect((await put('/api/badgeuse/parametres', 'ADMIN', { phrases_motivation: ['Belle journée'] })).status).toBe(200);
    expect((await put('/api/badgeuse/parametres', 'ADMIN', { phrases_motivation: ['x'.repeat(250)] })).status).toBe(400);
    expect((await put('/api/badgeuse/parametres', 'ADMIN', { phrases_motivation: Array(31).fill('ok') })).status).toBe(400);
    expect((await put('/api/badgeuse/parametres', 'ADMIN', { phrases_motivation: ['ok', ''] })).status).toBe(400);
    expect((await put('/api/badgeuse/parametres', 'ADMIN', { phrases_motivation: 'pas un tableau' })).status).toBe(400);
  });

  test('un tableau est stocké en JSON (et se relit tel quel)', async () => {
    const settings = {};
    installMocks({ settings });
    await put('/api/badgeuse/parametres', 'ADMIN', { phrases_motivation: ['Une', 'Deux'] });
    expect(settings['badgeuse.phrases_motivation']).toBe('["Une","Deux"]');
    const relu = await get('/api/badgeuse/parametres');
    expect(relu.body.parametres.phrases_motivation).toEqual(['Une', 'Deux']);
  });

  // ADR-0002 §3 : le bandeau « règles par défaut — à faire arbitrer par la
  // Direction » ne doit pas s'éteindre tout seul parce qu'on a changé un
  // message de bienvenue. Les deux familles passent par le même endpoint.
  test('modifier un paramètre d\'AFFICHAGE ne vaut PAS arbitrage de la grille RH', async () => {
    const settings = {};
    installMocks({ settings });
    await put('/api/badgeuse/parametres', 'ADMIN', { msg_matin: 'Salut {prenom} !' });
    expect(settings['badgeuse.regles_validees_le']).toBeUndefined();

    const r = await get('/api/badgeuse/parametres');
    expect(r.body.regles_validees.validees).toBe(false); // bandeau toujours affiché
  });

  test('modifier une VRAIE règle de gestion RH vaut arbitrage (comportement inchangé)', async () => {
    const settings = {};
    installMocks({ settings });
    await put('/api/badgeuse/parametres', 'ADMIN', { pause_deduite_minutes: 45 });
    expect(settings['badgeuse.regles_validees_le']).toBeTruthy();
    expect(settings['badgeuse.regles_validees_par']).toBe('1');
  });

  test('GET /parametres expose les nouveaux réglages ET leurs défauts documentés', async () => {
    const r = await get('/api/badgeuse/parametres');
    expect(r.body.parametres).toMatchObject({
      msg_matin: 'Bonjour, {prenom} !',
      moment_pause_debut: '11:00',
      motivation_active: true,
      festif_actif: true,
      lien_taille_max_mo: 50,
      social_sync_actif: false,
    });
    expect(r.body.defauts['badgeuse.msg_anniversaire']).toBe('Joyeux anniversaire, {prenom} ! 🎉');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Réseaux sociaux — jeton chiffré, jamais relu (ADR-0004 §6)
// ═══════════════════════════════════════════════════════════════════════════
describe('Configuration des réseaux sociaux', () => {
  test('le jeton Meta est stocké CHIFFRÉ et n\'est JAMAIS renvoyé', async () => {
    const settings = {};
    installMocks({ settings });
    const r = await put('/api/badgeuse/social/config', 'ADMIN', {
      meta_token: 'EAAG-jeton-secret', sync_actif: true,
      comptes: [{ reseau: 'instagram', compte: 'fripandcorouen', graph_id: '17841400000000000', actif: true }],
    });
    expect(r.status).toBe(200);

    const stocke = settings['badgeuse.meta_token'];
    expect(stocke).toMatch(/^v1:/);                       // AES-256-GCM (pattern SumUp)
    expect(stocke).not.toContain('EAAG-jeton-secret');
    expect(decryptSecret(stocke)).toBe('EAAG-jeton-secret'); // relisible par le serveur seul

    const charge = JSON.stringify(r.body);
    expect(charge).not.toContain('EAAG-jeton-secret');
    expect(r.body.jeton_configure).toBe(true);
    expect(r.body.jeton_configure_le).toBeTruthy();
  });

  test('les comptes sont normalisés (réseau contraint, identifiant Graph conservé)', async () => {
    const settings = {};
    installMocks({ settings });
    await put('/api/badgeuse/social/config', 'ADMIN', {
      comptes: [
        { reseau: 'twitter', compte: 'ailleurs', actif: true }, // réseau non géré → instagram
        { reseau: 'facebook', compte: 'SolidariteTextiles', graph_id: '1234', actif: false },
        { reseau: 'facebook', compte: '', actif: true },        // sans nom → écarté
      ],
    });
    const comptes = JSON.parse(settings['badgeuse.social_comptes']);
    expect(comptes).toEqual([
      { reseau: 'instagram', compte: 'ailleurs', graph_id: null, actif: true },
      { reseau: 'facebook', compte: 'SolidariteTextiles', graph_id: '1234', actif: false },
    ]);
  });

  test('GET /social/status ne divulgue pas le jeton', async () => {
    installMocks({ settings: { 'badgeuse.meta_token': 'v1:aaa:bbb:ccc' } });
    const r = await get('/api/badgeuse/social/status');
    expect(r.status).toBe(200);
    expect(r.body.jeton_configure).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('v1:aaa');
    expect(r.body).not.toHaveProperty('meta_token');
  });

  test('les 7 comptes de la structure sont pré-inscrits INACTIFS et sans identifiant inventé', async () => {
    const r = await get('/api/badgeuse/social/status');
    expect(r.body.comptes).toHaveLength(7);
    expect(r.body.comptes.every((c) => c.actif === false)).toBe(true);
    expect(r.body.comptes.every((c) => c.graph_id === null)).toBe(true);
    expect(r.body.comptes.map((c) => c.compte)).toContain('fripandcorouen');
  });

  test('habilitations : configuration et déclenchement réservés à ADMIN', async () => {
    expect((await put('/api/badgeuse/social/config', 'RH', { sync_actif: true })).status).toBe(403);
    expect((await post('/api/badgeuse/social/sync', 'RH')).status).toBe(403);
    expect((await get('/api/badgeuse/social/status', 'MANAGER')).status).toBe(200); // lecture ouverte READ
  });

  test('POST /social/sync sans jeton : no-op SILENCIEUX, jamais une erreur', async () => {
    const r = await post('/api/badgeuse/social/sync', 'ADMIN');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ items: 0, ignore: 'desactive' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('synchronisation ACTIVE mais sans jeton → ignorée, toujours sans appel réseau', async () => {
    installMocks({ settings: { 'badgeuse.social_sync_actif': 'true' } });
    const r = await post('/api/badgeuse/social/sync', 'ADMIN');
    expect(r.body).toMatchObject({ ignore: 'sans_jeton' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Contenus : types v2 acceptés, fichier supprimé avec sa ligne
// ═══════════════════════════════════════════════════════════════════════════
describe('Contenus de playlist (types v2)', () => {
  test('les 7 nouveaux types sont acceptés', async () => {
    for (const type of ['annonces', 'actus', 'tournees', 'social', 'media', 'lien', 'vak_live']) {
      const r = await post('/api/badgeuse/contenus', 'ADMIN', { type, titre: type });
      expect([200, 201]).toContain(r.status);
    }
  });

  test('un type inconnu reste refusé (400)', async () => {
    expect((await post('/api/badgeuse/contenus', 'ADMIN', { type: 'iframe_externe' })).status).toBe(400);
  });

  test('la config JSONB d\'un générateur est enregistrée', async () => {
    await post('/api/badgeuse/contenus', 'ADMIN', { type: 'actus', config: { nb_actus: 5 } });
    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_contenus/.test(String(c[0])));
    expect(insert[1]).toContain('{"nb_actus":5}');
  });

  test('supprimer un contenu média supprime AUSSI son fichier (aucun orphelin)', async () => {
    media.ensureMediaDir();
    const nom = 'media-a-supprimer-test.png';
    fs.writeFileSync(path.join(media.mediaRoot(), nom), 'x');
    mockQuery.mockImplementation((sql) => {
      if (/DELETE FROM badgeuse_contenus/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 42, fichier: nom }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await request(app).delete('/api/badgeuse/contenus/42').set('Authorization', `Bearer ${TOKENS.ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.fichier_supprime).toBe(true);
    expect(fs.existsSync(path.join(media.mediaRoot(), nom))).toBe(false);
  });
});

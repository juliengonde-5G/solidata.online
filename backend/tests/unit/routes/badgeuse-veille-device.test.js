/**
 * Module 33 « Temps & Présence » — API device : PLAYLIST météo et presse.
 * Contrat : docs/badgeuse/CONTRAT_API_DEVICE.md §3ter (v1.5), CDC_AFFICHAGE_V2 §2,
 * arbitrages : docs/badgeuse/adr/0006-presse-nationale-droits.md.
 *
 * CE QUI EST VERROUILLÉ ICI — les deux défauts constatés en production
 * (août 2026) et ce qui empêche leur retour :
 *   1. « L'écran météo n'affiche rien » : le type `meteo` était servi SANS
 *      aucune donnée (générateur inexistant). Le test 1 échoue si l'élément
 *      repart sans son bloc `meteo`.
 *   2. « L'actualité doit être NATIONALE, un écran par article » : le type
 *      `presse` produit UN ÉLÉMENT DE PLAYLIST PAR ARTICLE, et le fil interne
 *      `actus` continue d'exister à côté, inchangé.
 * Plus les garanties du module : rien n'est inventé (pas de météo sans relevé
 * du jour, pas d'écran presse sans article), et la vignette de presse est
 * servie par l'API device — jamais par une URL externe.
 *
 * DB mockée, aucune base (même harnais que badgeuse-affichage-device.test.js).
 */
const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));

const express = require('express');
const request = require('supertest');
const { hashDeviceKey } = require('../../../src/utils/badgeuse-crypto');
const deviceRouter = require('../../../src/routes/badgeuse-device');

const DEVICE_CODE = 'LH-P1';
const DEVICE_KEY = 'a'.repeat(64);
const DEVICE_ROW = {
  id: 1, code: DEVICE_CODE, site_id: 1, actif: true,
  api_key_hash: hashDeviceKey(DEVICE_KEY), site_code: 'LH',
};
const PATH = `/api/badgeuse/device/v1/devices/${DEVICE_CODE}`;

const jourParis = (decalage = 0) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(Date.now() + decalage * 86400000));

const AUJOURDHUI = jourParis(0);
const DEMAIN = jourParis(1);

const RELEVE_JOUR = {
  jour: AUJOURDHUI, code: 3, libelle: 'Nuageux', temp_min: 14.2, temp_max: 24.6,
  precip_mm: 0.4, vent_max: 18, releve_le: '2026-08-19T05:00:00.000Z',
};
const RELEVE_DEMAIN = {
  jour: DEMAIN, code: 61, libelle: 'Pluie', temp_min: 15.1, temp_max: 21.3,
  precip_mm: 5.2, vent_max: 30, releve_le: '2026-08-19T05:00:00.000Z',
};
const ARTICLE = {
  id: 12, source: 'franceinfo', flux: 'franceinfo — à la une',
  titre: "Rentrée scolaire : ce qui change à l'école",
  chapo: 'Le ministre a détaillé les nouveautés attendues.',
  publie_le: '2026-08-19T05:12:00.000Z',
  media_fichier: 'presse/presse-1.jpg', media_sha256: 'ab'.repeat(32), media_type: 'image',
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/badgeuse/device', deviceRouter);
});

function installMocks({
  settings = {}, contenus = [], site = { code: 'LH', libelle: 'Le Houlme — atelier', latitude: null, longitude: null },
  meteo = [], articles = [], news = [], presseFichier = undefined,
} = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/FROM badgeuse_devices d/.test(s)) return Promise.resolve({ rows: [DEVICE_ROW] });
    if (/SELECT key, value FROM settings/.test(s)) {
      return Promise.resolve({ rows: Object.entries(settings).map(([key, value]) => ({ key, value })) });
    }
    if (/FROM badgeuse_contenus/.test(s)) return Promise.resolve({ rows: contenus });
    if (/FROM badgeuse_sites WHERE id/.test(s)) return Promise.resolve({ rows: site ? [site] : [] });
    if (/FROM badgeuse_meteo/.test(s)) return Promise.resolve({ rows: meteo });
    if (/FROM badgeuse_presse_articles WHERE id/.test(s)) {
      return Promise.resolve({ rows: presseFichier === undefined ? [] : [{ fichier: presseFichier }] });
    }
    if (/FROM badgeuse_presse_articles/.test(s)) return Promise.resolve({ rows: articles });
    if (/FROM news_articles/.test(s)) return Promise.resolve({ rows: news });
    return Promise.resolve({ rows: [] });
  });
}

const contenu = (o) => ({
  id: 9, titre: null, corps: null, media_url: null, duree_sec: 12, ordre: 1, config: null, ...o,
});

const get = (p) => request(app).get(p).set('X-Device-Key', DEVICE_KEY);

beforeEach(() => {
  mockQuery.mockReset();
  installMocks();
  // Aucun appel sortant depuis un test : si un générateur tentait de joindre
  // Open-Meteo, on veut le savoir ici et pas en production.
  globalThis.fetch = jest.fn(async () => { throw new Error('réseau interdit en test'); });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. MÉTÉO — le défaut de production
// ═══════════════════════════════════════════════════════════════════════════
describe('playlist — type `meteo`', () => {
  test('l\'élément porte la météo du JOUR (avant le correctif : rien du tout)', async () => {
    installMocks({
      contenus: [contenu({ type: 'meteo' })],
      meteo: [RELEVE_JOUR, RELEVE_DEMAIN],
    });
    const r = await get(`${PATH}/playlist`);
    const el = r.body.elements[0];
    expect(el.type).toBe('meteo');
    expect(el.meteo).toBeDefined();
    expect(el.meteo.jour).toMatchObject({
      date: AUJOURDHUI, code: 3, libelle: 'Nuageux', temp_min: 14.2, temp_max: 24.6,
    });
  });

  test('la prévision des jours SUIVANTS accompagne le jour courant', async () => {
    installMocks({ contenus: [contenu({ type: 'meteo' })], meteo: [RELEVE_JOUR, RELEVE_DEMAIN] });
    const { meteo } = (await get(`${PATH}/playlist`)).body.elements[0];
    expect(meteo.prevision).toHaveLength(1);
    expect(meteo.prevision[0]).toMatchObject({ date: DEMAIN, libelle: 'Pluie' });
    // Le jour courant n'est pas répété dans la prévision.
    expect(meteo.prevision.some((j) => j.date === AUJOURDHUI)).toBe(false);
  });

  test('le LIEU et sa SOURCE voyagent avec la prévision (l\'écran ne peut pas mentir sur la ville)', async () => {
    installMocks({
      contenus: [contenu({ type: 'meteo' })],
      site: { code: 'LH', libelle: 'Atelier du Houlme', latitude: '49.4900', longitude: '1.0500' },
      meteo: [RELEVE_JOUR],
    });
    const { meteo } = (await get(`${PATH}/playlist`)).body.elements[0];
    expect(meteo.lieu).toBe('Atelier du Houlme');
    expect(meteo.lieu_source).toBe('site');
  });

  test('SANS relevé pour aujourd\'hui, l\'écran est OMIS (jamais la météo d\'hier)', async () => {
    // Un relevé de demain existe, mais pas celui du jour : on n'affiche pas
    // « la météo » avec la mauvaise journée.
    installMocks({ contenus: [contenu({ type: 'meteo' })], meteo: [RELEVE_DEMAIN] });
    expect((await get(`${PATH}/playlist`)).body.elements).toHaveLength(0);
  });

  test('NON-RÉGRESSION : une météo saisie à la main (texte) survit à l\'absence de prévision', async () => {
    installMocks({
      contenus: [contenu({ type: 'meteo', titre: 'Météo', corps: 'Grand soleil, pensez à boire' })],
      meteo: [],
    });
    const el = (await get(`${PATH}/playlist`)).body.elements[0];
    expect(el.corps).toBe('Grand soleil, pensez à boire');
    expect(el.meteo).toBeUndefined();
  });

  test('source injoignable : le rattrapage n\'est PAS rejoué à chaque lecture de playlist', async () => {
    // Sans cette garde, un Open-Meteo en panne ferait attendre le poste le
    // délai maximal à chaque interrogation, toutes les quinze minutes.
    // Lieu propre à ce test : la mise au repos est mémorisée PAR LIEU dans le
    // processus, et les tests précédents ont déjà pu la déclencher ailleurs.
    installMocks({
      contenus: [contenu({ type: 'meteo' })],
      site: { code: 'ZZ', libelle: 'Site de test', latitude: '48.1111', longitude: '2.2222' },
      meteo: [],
    });
    let appels = 0;
    globalThis.fetch = jest.fn(async () => { appels += 1; throw new Error('injoignable'); });

    await get(`${PATH}/playlist`);
    await get(`${PATH}/playlist`);
    await get(`${PATH}/playlist`);
    expect(appels).toBe(1);
  });

  test('un relevé sans température n\'invente pas de zéro', async () => {
    installMocks({
      contenus: [contenu({ type: 'meteo' })],
      meteo: [{ ...RELEVE_JOUR, temp_min: null, temp_max: null, precip_mm: null, vent_max: null }],
    });
    const { meteo } = (await get(`${PATH}/playlist`)).body.elements[0];
    expect(meteo.jour.temp_max).toBeNull();
    expect(meteo.jour.vent_max).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PRESSE — un écran par article
// ═══════════════════════════════════════════════════════════════════════════
describe('playlist — type `presse`', () => {
  const troisArticles = [
    ARTICLE,
    { ...ARTICLE, id: 13, titre: 'Canicule : alerte orange maintenue', media_fichier: null, media_sha256: null, media_type: null },
    { ...ARTICLE, id: 14, titre: 'Budget : le débat s\'ouvre à l\'Assemblée' },
  ];

  test('UN ÉLÉMENT PAR ARTICLE (la demande de l\'exploitant, verrouillée)', async () => {
    installMocks({ contenus: [contenu({ type: 'presse', titre: 'À la une' })], articles: troisArticles });
    const elements = (await get(`${PATH}/playlist`)).body.elements;
    expect(elements).toHaveLength(3);
    expect(elements.map((e) => e.article.titre)).toEqual([
      "Rentrée scolaire : ce qui change à l'école",
      'Canicule : alerte orange maintenue',
      "Budget : le débat s'ouvre à l'Assemblée",
    ]);
    expect(elements.every((e) => e.type === 'presse')).toBe(true);
  });

  test('chaque écran porte titre, chapô, SOURCE et date (attribution due au média)', async () => {
    installMocks({ contenus: [contenu({ type: 'presse' })], articles: [ARTICLE] });
    const { article } = (await get(`${PATH}/playlist`)).body.elements[0];
    expect(article).toEqual({
      titre: "Rentrée scolaire : ce qui change à l'école",
      chapo: 'Le ministre a détaillé les nouveautés attendues.',
      source: 'franceinfo',
      publie_le: '2026-08-19T05:12:00.000Z',
    });
  });

  test('la vignette est référencée par media_id — JAMAIS par une URL externe', async () => {
    installMocks({ contenus: [contenu({ type: 'presse' })], articles: [ARTICLE] });
    const el = (await get(`${PATH}/playlist`)).body.elements[0];
    expect(el.media_id).toBe('p12');
    expect(el.media_type).toBe('image');
    expect(el.media_sha256).toBe('ab'.repeat(32));
    // Aucune adresse de site de presse ne descend vers le poste.
    expect(JSON.stringify(el)).not.toMatch(/https?:\/\//);
  });

  test('un article sans vignette reste un écran (le titre suffit)', async () => {
    installMocks({ contenus: [contenu({ type: 'presse' })], articles: [troisArticles[1]] });
    const el = (await get(`${PATH}/playlist`)).body.elements[0];
    expect(el.media_id).toBeUndefined();
    expect(el.article.titre).toBe('Canicule : alerte orange maintenue');
  });

  test('le nombre d\'articles est paramétrable par écran, et borné', async () => {
    installMocks({ contenus: [contenu({ type: 'presse', config: { nb_articles: 2 } })], articles: troisArticles });
    await get(`${PATH}/playlist`);
    const req = mockQuery.mock.calls.find((c) => /FROM badgeuse_presse_articles\b/.test(String(c[0])) && !/WHERE id/.test(String(c[0])));
    expect(req[1]).toEqual([2]);

    installMocks({ contenus: [contenu({ type: 'presse', config: { nb_articles: 99 } })], articles: troisArticles });
    mockQuery.mockClear();   // sinon `find` retrouverait la requête précédente
    await get(`${PATH}/playlist`);
    const borne = mockQuery.mock.calls.find((c) => /FROM badgeuse_presse_articles\b/.test(String(c[0])) && !/WHERE id/.test(String(c[0])));
    expect(borne[1]).toEqual([8]);
  });

  test('aucun article en base → aucun écran (pas d\'écran creux)', async () => {
    installMocks({ contenus: [contenu({ type: 'presse' })], articles: [] });
    expect((await get(`${PATH}/playlist`)).body.elements).toHaveLength(0);
  });

  test('le fil INTERNE `actus` continue de fonctionner à côté, inchangé', async () => {
    installMocks({
      contenus: [contenu({ id: 1, type: 'actus', ordre: 1 }), contenu({ id: 2, type: 'presse', ordre: 2 })],
      news: [{ title: 'Nouvelle benne au tri', summary: 'Mise en service lundi', source_name: 'SOLIDATA' }],
      articles: [ARTICLE],
    });
    const elements = (await get(`${PATH}/playlist`)).body.elements;
    expect(elements[0].type).toBe('actus');
    expect(elements[0].actus[0]).toMatchObject({ titre: 'Nouvelle benne au tri', source: 'SOLIDATA' });
    expect(elements[1].type).toBe('presse');
  });

  test('un générateur en panne n\'emporte pas la playlist entière', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM badgeuse_devices d/.test(s)) return Promise.resolve({ rows: [DEVICE_ROW] });
      if (/FROM badgeuse_contenus/.test(s)) {
        return Promise.resolve({ rows: [contenu({ id: 1, type: 'presse', ordre: 1 }), contenu({ id: 2, type: 'message', titre: 'Consigne', corps: 'Gants obligatoires', ordre: 2 })] });
      }
      if (/FROM badgeuse_presse_articles/.test(s)) return Promise.reject(Object.assign(new Error('table absente'), { code: '42P01' }));
      return Promise.resolve({ rows: [] });
    });
    const elements = (await get(`${PATH}/playlist`)).body.elements;
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe('message');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. DIFFUSION DE LA VIGNETTE — le poste passe par l'API device
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /media/p<id> — vignette de presse', () => {
  test('un identifiant `p<id>` interroge bien la table des articles de presse', async () => {
    installMocks({ presseFichier: 'presse/inexistant.jpg' });
    await get(`${PATH}/media/p12`);
    const req = mockQuery.mock.calls.find((c) => /FROM badgeuse_presse_articles WHERE id/.test(String(c[0])));
    expect(req).toBeDefined();
    expect(req[1]).toEqual([12]);
  });

  test('sans clé device, la vignette n\'est pas servie', async () => {
    installMocks({ presseFichier: 'presse/x.jpg' });
    const r = await request(app).get(`${PATH}/media/p12`);
    expect(r.status).toBe(401);
  });

  test('un préfixe inconnu est un 404 (aucune table devinée)', async () => {
    installMocks();
    expect((await get(`${PATH}/media/z12`)).status).toBe(404);
  });

  test('une échappatoire de chemin est refusée (404, pas de fichier hors racine)', async () => {
    installMocks({ presseFichier: '../../../etc/passwd' });
    expect((await get(`${PATH}/media/p12`)).status).toBe(404);
  });
});

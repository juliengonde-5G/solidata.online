/**
 * Module 33 « Temps & Présence » — ÉCRAN DE VEILLE : presse nationale et météo.
 * Cadre : CDC_AFFICHAGE_V2.md §2, ADR-0004 §6, ADR-0006 (droits de la presse).
 *
 * Ce que ce fichier verrouille, et qu'aucune relecture ne rattrapera dans six
 * mois :
 *   - le SERVEUR est le seul client HTTP : un flux non-https, une adresse
 *     interne ou une page HTML déguisée en flux sont refusés AVANT tout appel ;
 *   - la vidéo de presse n'est PAS rediffusée tant que la Direction n'a pas
 *     tranché (ADR-0006) — l'interrupteur est à false par défaut, et le
 *     comportement par défaut est testé, pas seulement documenté ;
 *   - la météo ne sort JAMAIS une valeur inventée : sans relevé, rien ;
 *   - le lieu de la météo suit une cascade site → réglage → rien.
 *
 * DB et réseau mockés (aucune base, aucun appel sortant).
 */
const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));

const dns = require('dns');
const media = require('../../../src/services/badgeuse-social');
const { fetchOpenMeteoDailyRange } = require('../../../src/utils/weather');

// Un fil « à la une » tel que les rédactions françaises le publient : RSS 2.0,
// CDATA, HTML dans la description, entités, media:thumbnail, et un item vidéo.
const FLUX_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>franceinfo</title>
  <item>
    <title><![CDATA[Rentrée scolaire : ce qui change à l'école]]></title>
    <link>https://exemple-presse.fr/education/article-1.html</link>
    <description><![CDATA[<p>Le ministre a détaillé les <b>nouveautés</b> attendues &amp; leurs délais.</p>]]></description>
    <pubDate>Wed, 19 Aug 2026 07:12:00 +0200</pubDate>
    <guid isPermaLink="false">presse-99881</guid>
    <media:thumbnail url="https://exemple-presse.fr/img/99881.jpg" width="560"/>
  </item>
  <item>
    <title>Canicule : l&#39;alerte orange maintenue</title>
    <link>https://exemple-presse.fr/meteo/article-2.html</link>
    <description>Douze d&eacute;partements restent en vigilance.</description>
    <pubDate>Wed, 19 Aug 2026 06:40:00 +0200</pubDate>
    <enclosure url="https://exemple-presse.fr/video/2.mp4" type="video/mp4" length="4500000"/>
  </item>
</channel></rss>`;

const REGLAGES = {
  'badgeuse.presse_sync_actif': 'true',
  'badgeuse.presse_flux': JSON.stringify([
    { libelle: 'Presse — à la une', source: 'franceinfo', url: 'https://exemple-presse.fr/titres.rss', actif: true },
  ]),
};

/** Mock DB : réglages + tables de l'écran de veille. */
function installMocks({ settings = {}, presseConnu = [], sites = [], meteo = [] } = {}) {
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql);
    if (/SELECT key, value FROM settings WHERE key LIKE/.test(s)) {
      return Promise.resolve({ rows: Object.entries(settings).map(([key, value]) => ({ key, value })) });
    }
    if (/FROM badgeuse_presse_articles WHERE flux/.test(s)) return Promise.resolve({ rows: presseConnu });
    if (/INSERT INTO badgeuse_presse_articles/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM badgeuse_sites WHERE id/.test(s)) return Promise.resolve({ rows: sites });
    if (/JOIN badgeuse_devices d/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM badgeuse_meteo/.test(s)) return Promise.resolve({ rows: meteo });
    if (/INSERT INTO badgeuse_meteo/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

let fetchOrigine;
let lookupOrigine;
beforeEach(() => {
  mockQuery.mockReset();
  installMocks();
  fetchOrigine = globalThis.fetch;
  lookupOrigine = dns.promises.lookup;
  // Toute résolution DNS rend une adresse PUBLIQUE : les tests portent sur le
  // comportement du service, pas sur l'Internet du poste de développement.
  dns.promises.lookup = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
});
afterEach(() => {
  globalThis.fetch = fetchOrigine;
  dns.promises.lookup = lookupOrigine;
});

/** Réponse fetch minimale (le service n'utilise que ces membres). */
const reponse = (corps, { status = 200, type = 'application/rss+xml' } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? type : null) },
  text: async () => corps,
});

// ═══════════════════════════════════════════════════════════════════════════
// LECTURE D'UN FLUX — fonction PURE
// ═══════════════════════════════════════════════════════════════════════════
describe('parseFluxRss', () => {
  test('lit titre, chapô, lien, date et vignette d\'un RSS 2.0', () => {
    const [a] = media.parseFluxRss(FLUX_RSS);
    expect(a.titre).toBe("Rentrée scolaire : ce qui change à l'école");
    expect(a.chapo).toBe('Le ministre a détaillé les nouveautés attendues & leurs délais.');
    expect(a.lien).toBe('https://exemple-presse.fr/education/article-1.html');
    expect(a.guid).toBe('presse-99881');
    expect(a.publie_le).toBe('2026-08-19T05:12:00.000Z');
    expect(a.media_url).toBe('https://exemple-presse.fr/img/99881.jpg');
    expect(a.media_kind).toBe('image');
  });

  test('le HTML du chapô est retiré : un écran ne montre pas de balises', () => {
    const [a] = media.parseFluxRss(FLUX_RSS);
    expect(a.chapo).not.toMatch(/<|>/);
  });

  test('les entités sont décodées (&#39;, &eacute;, &amp;)', () => {
    const [, b] = media.parseFluxRss(FLUX_RSS);
    expect(b.titre).toBe("Canicule : l'alerte orange maintenue");
    expect(b.chapo).toBe('Douze départements restent en vigilance.');
  });

  test('une enclosure video/mp4 est reconnue comme VIDÉO (le type MIME fait foi)', () => {
    const [, b] = media.parseFluxRss(FLUX_RSS);
    expect(b.media_kind).toBe('video');
  });

  test('sans guid, le lien sert d\'identifiant stable (dédoublonnage possible)', () => {
    const [, b] = media.parseFluxRss(FLUX_RSS);
    expect(b.guid).toBe('https://exemple-presse.fr/meteo/article-2.html');
  });

  test('un flux Atom est lu aussi (entry/summary/link href)', () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry><id>urn:1</id><title>Titre Atom</title>
      <summary>Résumé Atom</summary>
      <link rel="alternate" href="https://exemple-presse.fr/a.html"/>
      <published>2026-08-18T10:00:00Z</published></entry></feed>`;
    const [a] = media.parseFluxRss(atom);
    expect(a).toMatchObject({ titre: 'Titre Atom', chapo: 'Résumé Atom', lien: 'https://exemple-presse.fr/a.html' });
  });

  test('un article SANS TITRE est ignoré (il ne ferait pas un écran)', () => {
    expect(media.parseFluxRss('<rss><channel><item><link>https://x.fr/a</link></item></channel></rss>')).toEqual([]);
  });

  test('une entrée inconnue ne fait pas planter (page HTML, XML vide)', () => {
    expect(media.parseFluxRss('<html><body>bonjour</body></html>')).toEqual([]);
    expect(media.parseFluxRss('')).toEqual([]);
    expect(media.parseFluxRss(null)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GARDES DU FETCH — le serveur est le client HTTP, pas le poste
// ═══════════════════════════════════════════════════════════════════════════
describe('fetchFluxRss — gardes', () => {
  test('un flux http (non chiffré) est refusé AVANT tout appel réseau', async () => {
    globalThis.fetch = jest.fn();
    await expect(media.fetchFluxRss('http://exemple-presse.fr/f.rss')).rejects.toMatchObject({ code: 'protocole' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('un flux pointant sur le réseau interne est refusé (SSRF)', async () => {
    dns.promises.lookup = jest.fn(async () => [{ address: '169.254.169.254', family: 4 }]);
    globalThis.fetch = jest.fn();
    await expect(media.fetchFluxRss('https://metadata.interne/f.rss')).rejects.toMatchObject({ code: 'ip_privee' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('une page HTML servie à la place d\'un flux est refusée, pas « parsée au cas où »', async () => {
    globalThis.fetch = jest.fn(async () => reponse('<html>mur de consentement</html>', { type: 'text/html' }));
    await expect(media.fetchFluxRss('https://exemple-presse.fr/f.rss')).rejects.toMatchObject({ code: 'type' });
  });

  test('une redirection est REVALIDÉE : un saut vers une adresse interne est refusé', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: false, status: 302,
      headers: { get: (k) => (String(k).toLowerCase() === 'location' ? 'https://interne.local/f.rss' : null) },
    }));
    dns.promises.lookup = jest.fn(async (hote) => (hote === 'interne.local'
      ? [{ address: '10.0.0.5', family: 4 }]
      : [{ address: '93.184.216.34', family: 4 }]));
    await expect(media.fetchFluxRss('https://exemple-presse.fr/f.rss')).rejects.toMatchObject({ code: 'ip_privee' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SYNCHRONISATION DE LA PRESSE
// ═══════════════════════════════════════════════════════════════════════════
describe('syncPresseArticles', () => {
  test('désactivée → no-op, aucun appel réseau', async () => {
    installMocks({ settings: { ...REGLAGES, 'badgeuse.presse_sync_actif': 'false' } });
    globalThis.fetch = jest.fn();
    expect(await media.syncPresseArticles()).toMatchObject({ ignore: 'desactive', articles: 0 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('flux inactif → ignoré (l\'exploitant décide, pas le code)', async () => {
    installMocks({ settings: {
      ...REGLAGES,
      'badgeuse.presse_flux': JSON.stringify([{ libelle: 'x', url: 'https://exemple-presse.fr/f.rss', actif: false }]),
    } });
    globalThis.fetch = jest.fn();
    expect((await media.syncPresseArticles()).articles).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('articles rangés en base par upsert IDEMPOTENT (ON CONFLICT)', async () => {
    installMocks({ settings: REGLAGES });
    globalThis.fetch = jest.fn(async () => reponse(FLUX_RSS));
    const bilan = await media.syncPresseArticles();
    expect(bilan.articles).toBe(2);
    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_presse_articles/.test(String(c[0])));
    expect(String(insert[0])).toMatch(/ON CONFLICT \(flux, guid\) DO UPDATE/);
    expect(insert[1][3]).toBe("Rentrée scolaire : ce qui change à l'école");
  });

  test('ADR-0006 — la VIDÉO de presse n\'est PAS rediffusée par défaut', async () => {
    installMocks({ settings: REGLAGES });
    const appels = [];
    globalThis.fetch = jest.fn(async (url) => { appels.push(String(url)); return reponse(FLUX_RSS); });
    const bilan = await media.syncPresseArticles();

    expect(bilan.videos_ignorees).toBe(1);
    // Le fichier vidéo n'est même pas TÉLÉCHARGÉ : le refus est en amont du
    // disque, pas un simple filtre d'affichage.
    expect(appels.some((u) => u.includes('2.mp4'))).toBe(false);
    // L'article existe quand même (titre + chapô) : on retire la vidéo, pas
    // l'information — et aucun média n'est associé.
    const insertions = mockQuery.mock.calls.filter((c) => /INSERT INTO badgeuse_presse_articles/.test(String(c[0])));
    expect(insertions).toHaveLength(2);
    const article2 = insertions.find((c) => String(c[1][3]).startsWith('Canicule'));
    expect(article2[1][7]).toBeNull();   // media_fichier
  });

  test('vignettes désactivées → aucun téléchargement, l\'article passe quand même', async () => {
    installMocks({ settings: { ...REGLAGES, 'badgeuse.presse_vignettes': 'false' } });
    const appels = [];
    globalThis.fetch = jest.fn(async (url) => { appels.push(String(url)); return reponse(FLUX_RSS); });
    const bilan = await media.syncPresseArticles();
    expect(bilan.articles).toBe(2);
    expect(bilan.vignettes).toBe(0);
    expect(appels.some((u) => u.includes('99881.jpg'))).toBe(false);
  });

  test('la vignette est rapatriée dans le sous-dossier `presse/` — pas à la racine', async () => {
    // Ce n'est pas un détail de rangement : la purge des médias orphelins ne
    // balaie que les dossiers qu'elle connaît. Une vignette posée à la racine
    // et référencée par une table qu'elle ignorait serait effacée sous 24 h,
    // et l'écran de presse perdrait ses images en silence.
    installMocks({ settings: REGLAGES });
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(reponse(FLUX_RSS))
      .mockResolvedValueOnce({                       // la vignette du 1er article
        ok: true, status: 200,
        headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
        body: null,
        arrayBuffer: async () => Buffer.from('jpeg'),
      });

    const bilan = await media.syncPresseArticles();
    expect(bilan.vignettes).toBe(1);
    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_presse_articles/.test(String(c[0])));
    const fichier = insert[1][7];
    expect(fichier).toMatch(/^presse\//);
    expect(insert[1][8]).toMatch(/^[0-9a-f]{64}$/);   // empreinte vérifiable par le poste
    expect(insert[1][9]).toBe('image');
    media.unlinkMedia(fichier);
  });

  test('flux injoignable : signalé, RIEN n\'est supprimé (l\'écran garde le dernier état)', async () => {
    installMocks({ settings: REGLAGES });
    globalThis.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    const bilan = await media.syncPresseArticles();
    expect(bilan.erreurs).toBe(1);
    expect(mockQuery.mock.calls.some((c) => /DELETE/i.test(String(c[0])))).toBe(false);
  });

  test('le job ne SUPPRIME jamais rien (la conservation appartient à la purge)', async () => {
    installMocks({ settings: REGLAGES });
    globalThis.fetch = jest.fn(async () => reponse(FLUX_RSS));
    await media.syncPresseArticles();
    expect(mockQuery.mock.calls.some((c) => /DELETE/i.test(String(c[0])))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MÉTÉO — cascade du lieu et « jamais de valeur inventée »
// ═══════════════════════════════════════════════════════════════════════════
describe('resolveMeteoLieu — cascade honnête', () => {
  test('les coordonnées DU SITE priment quand elles existent', async () => {
    installMocks({ sites: [{ code: 'LH', libelle: 'Le Houlme — atelier', latitude: '49.4900', longitude: '1.0500' }] });
    expect(await media.resolveMeteoLieu(1)).toEqual({
      latitude: 49.49, longitude: 1.05, libelle: 'Le Houlme — atelier', source: 'site',
    });
  });

  test('site sans coordonnées → repli sur le réglage, source ANNONCÉE', async () => {
    installMocks({
      sites: [{ code: 'LH', libelle: 'Le Houlme', latitude: null, longitude: null }],
      settings: { 'badgeuse.meteo_latitude': '49.4231', 'badgeuse.meteo_longitude': '1.0993', 'badgeuse.meteo_lieu': 'Le Houlme' },
    });
    expect(await media.resolveMeteoLieu(1)).toMatchObject({ latitude: 49.4231, longitude: 1.0993, source: 'parametre' });
  });

  test('base illisible (colonnes ou table absentes) → défauts DOCUMENTÉS, jamais un écran sans lieu', async () => {
    // Ce que ce test fixe : la dégradation. Une base non migrée ne doit pas
    // faire disparaître l'écran météo — elle le fait retomber sur les
    // coordonnées documentées du seul site équipé, avec `source: parametre`
    // affiché. Le retour `null` (aucun lieu) reste possible et volontaire : il
    // n'est atteint que si quelqu'un vide les défauts du dictionnaire.
    mockQuery.mockImplementation(() => Promise.reject(new Error('relation « badgeuse_sites » inexistante')));
    const lieu = await media.resolveMeteoLieu(1);
    expect(lieu).toMatchObject({ source: 'parametre', latitude: 49.4231, longitude: 1.0993 });
  });
});

describe('refreshMeteoLieu / syncMeteo', () => {
  const LIEU = { latitude: 49.4231, longitude: 1.0993, libelle: 'Le Houlme', source: 'parametre' };

  test('la prévision reçue est écrite jour par jour (upsert)', async () => {
    installMocks();
    globalThis.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ daily: {
        time: ['2026-08-19', '2026-08-20'],
        weather_code: [3, 61],
        temperature_2m_max: [24.6, 21.3],
        temperature_2m_min: [14.2, 15.1],
        precipitation_sum: [0.4, 5.2],
        wind_speed_10m_max: [18, 30],
      } }),
    }));
    expect(await media.refreshMeteoLieu(LIEU, 1)).toBe(2);
    const ins = mockQuery.mock.calls.filter((c) => /INSERT INTO badgeuse_meteo/.test(String(c[0])));
    expect(ins).toHaveLength(2);
    expect(String(ins[0][0])).toMatch(/ON CONFLICT \(latitude, longitude, jour\) DO UPDATE/);
    expect(ins[0][1].slice(0, 8)).toEqual([49.4231, 1.0993, '2026-08-19', 3, 'Nuageux', 14.2, 24.6, 0.4]);
  });

  test('source injoignable → 0 écriture : la base garde le dernier état connu', async () => {
    installMocks();
    globalThis.fetch = jest.fn(async () => { throw new Error('réseau'); });
    expect(await media.refreshMeteoLieu(LIEU, 3)).toBe(0);
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO badgeuse_meteo/.test(String(c[0])))).toBe(false);
  });

  test('synchronisation désactivée → no-op, aucun appel', async () => {
    installMocks({ settings: { 'badgeuse.meteo_sync_actif': 'false' } });
    globalThis.fetch = jest.fn();
    expect(await media.syncMeteo()).toMatchObject({ ignore: 'desactive' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('fetchOpenMeteoDailyRange (utils/weather.js)', () => {
  test('une seule requête pour toute la plage, en heure de Paris', async () => {
    const urls = [];
    globalThis.fetch = jest.fn(async (u) => {
      urls.push(String(u));
      return { ok: true, status: 200, json: async () => ({ daily: { time: ['2026-08-19'], weather_code: [0], temperature_2m_max: [26], temperature_2m_min: [13], precipitation_sum: [0], wind_speed_10m_max: [12] } }) };
    });
    const r = await fetchOpenMeteoDailyRange(49.4231, 1.0993, '2026-08-19', '2026-08-22');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(urls[0]).toContain('start_date=2026-08-19');
    expect(urls[0]).toContain('end_date=2026-08-22');
    expect(urls[0]).toContain('timezone=Europe/Paris');
    expect(r.jours[0]).toMatchObject({ date: '2026-08-19', label: 'Dégagé', tempMax: 26 });
  });

  test('réponse vide ou en erreur → null (jamais un tableau vide pris pour une prévision)', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ daily: { time: [] } }) }));
    expect(await fetchOpenMeteoDailyRange(1, 2, '2026-01-01', '2026-01-02')).toBeNull();
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await fetchOpenMeteoDailyRange(3, 4, '2026-01-01', '2026-01-02')).toBeNull();
  });
});

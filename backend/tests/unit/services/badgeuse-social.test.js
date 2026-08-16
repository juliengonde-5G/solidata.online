/**
 * Écran d'information v2 — service MÉDIAS & RÉSEAUX SOCIAUX
 * (services/badgeuse-social.js — CDC_AFFICHAGE_V2 §2, ADR-0004 §6).
 *
 * Verrouille les trois oracles dont dépend la sûreté du lot :
 *  - `isPrivateAddress` : la frontière entre « internet » et « notre réseau ».
 *    C'est elle qui décide si le serveur accepte d'aller chercher une URL ;
 *    une erreur ici rouvre le SSRF que tout le reste s'échine à fermer.
 *  - `resolveMediaPath` : aucun chemin venu de la base ne sort de la racine.
 *  - `normalizeGraphPost` : Meta n'expose pas la même forme selon le type de
 *    compte — on lit en TOLÉRANT, sans jamais inventer un champ absent.
 * Plus le comportement du job : vidéos ignorées (V2 assumée), compte sans
 * identifiant Graph ignoré et signalé, AUCUNE purge (elle appartient au job de
 * rétention RGPD, un seul endroit).
 */
const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} })),
}));
const mockLookup = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
jest.mock('dns', () => ({ promises: { lookup: (...a) => mockLookup(...a) } }));

const path = require('path');
const social = require('../../../src/services/badgeuse-social');

describe('isPrivateAddress — frontière réseau interne / internet', () => {
  test.each([
    ['10.0.0.5', 'privé RFC1918'],
    ['172.16.4.1', 'privé RFC1918'],
    ['172.31.255.254', 'privé RFC1918 (borne haute)'],
    ['192.168.1.1', 'privé RFC1918'],
    ['127.0.0.1', 'loopback'],
    ['0.0.0.0', 'non spécifiée'],
    ['169.254.169.254', 'métadonnées cloud (lien-local)'],
    ['100.64.0.1', 'CGNAT'],
    ['198.18.0.1', 'banc d\'essai'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'diffusion'],
    ['::1', 'loopback IPv6'],
    ['::', 'non spécifiée IPv6'],
    ['fd00::1', 'unique-local IPv6'],
    ['fe80::1', 'lien-local IPv6'],
    ['ff02::1', 'multicast IPv6'],
    ['::ffff:127.0.0.1', 'IPv4 loopback encapsulée en IPv6'],
    ['::ffff:10.1.2.3', 'IPv4 privée encapsulée en IPv6'],
    ['pas-une-ip', 'valeur illisible'],
    ['', 'valeur vide'],
  ])('%s (%s) → REFUSÉE', (ip) => {
    expect(social.isPrivateAddress(ip)).toBe(true);
  });

  test.each([
    ['93.184.216.34'],
    ['8.8.8.8'],
    ['172.32.0.1'],   // juste au-dessus de la plage privée
    ['172.15.255.1'], // juste en dessous
    ['2001:4860:4860::8888'],
  ])('%s → adresse publique acceptée', (ip) => {
    expect(social.isPrivateAddress(ip)).toBe(false);
  });
});

describe('assertSafeHttpsUrl', () => {
  beforeEach(() => {
    mockLookup.mockReset();
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  test('accepte une URL https vers une adresse publique', async () => {
    const url = await social.assertSafeHttpsUrl('https://exemple.test/a.jpg');
    expect(url.hostname).toBe('exemple.test');
  });

  test.each([
    ['http://exemple.test/a.jpg', 'protocole'],
    ['file:///etc/passwd', 'protocole'],
    ['pas une url', 'protocole'],
  ])('%s → refusée (%s)', async (url, code) => {
    await expect(social.assertSafeHttpsUrl(url)).rejects.toMatchObject({ code });
  });

  test('un nom qui ne résout pas est refusé (jamais tenté « au cas où »)', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(social.assertSafeHttpsUrl('https://inexistant.test/a.jpg')).rejects.toMatchObject({ code: 'dns' });
  });

  test('une résolution vide est refusée', async () => {
    mockLookup.mockResolvedValue([]);
    await expect(social.assertSafeHttpsUrl('https://vide.test/a.jpg')).rejects.toMatchObject({ code: 'dns' });
  });
});

describe('resolveMediaPath / mimeForFile — service de fichiers', () => {
  test('un nom simple est résolu sous la racine des médias', () => {
    const abs = social.resolveMediaPath('media-1.jpg');
    expect(abs).toBe(path.join(social.mediaRoot(), 'media-1.jpg'));
  });

  test('le sous-dossier social est autorisé', () => {
    expect(social.resolveMediaPath('social/ig-1.jpg')).toContain(path.join('badgeuse', 'social'));
  });

  test.each([
    ['../../etc/passwd', 'remontée'],
    ['/etc/passwd', 'chemin absolu'],
    ['social/../../secret', 'remontée masquée'],
    ['..\\windows', 'séparateur Windows'],
    ['', 'vide'],
  ])('%s (%s) → refusé', (chemin) => {
    expect(social.resolveMediaPath(chemin)).toBeNull();
  });

  test('le type MIME vient de l\'EXTENSION, en liste blanche', () => {
    expect(social.mimeForFile('a.png')).toBe('image/png');
    expect(social.mimeForFile('a.MP4')).toBe('video/mp4');
    expect(social.mimeForFile('a.svg')).toBeNull();   // exécutable côté navigateur
    expect(social.mimeForFile('a.html')).toBeNull();
    expect(social.mimeForFile('a')).toBeNull();
  });

  test('mediaTypeForMime distingue image et vidéo, et refuse le reste', () => {
    expect(social.mediaTypeForMime('image/jpeg')).toBe('image');
    expect(social.mediaTypeForMime('video/webm; codecs=vp9')).toBe('video');
    expect(social.mediaTypeForMime('text/html')).toBeNull();
    expect(social.mediaTypeForMime('image/svg+xml')).toBeNull();
  });
});

describe('normalizeGraphPost — tolérance aux deux dialectes Meta', () => {
  test('forme Instagram Business', () => {
    expect(social.normalizeGraphPost({
      id: '17900', permalink: 'https://instagram.test/p/1', caption: 'Nouvelle collection',
      media_type: 'IMAGE', media_url: 'https://cdn.test/1.jpg', timestamp: '2026-08-10T10:00:00+0000',
    })).toEqual({
      post_id: '17900', permalink: 'https://instagram.test/p/1', legende: 'Nouvelle collection',
      media_url: 'https://cdn.test/1.jpg', publie_le: '2026-08-10T10:00:00+0000', kind: 'image',
    });
  });

  test('forme Page Facebook (autres noms de champs)', () => {
    expect(social.normalizeGraphPost({
      id: '123_456', permalink_url: 'https://facebook.test/1', message: 'Portes ouvertes',
      full_picture: 'https://cdn.test/2.jpg', created_time: '2026-08-09T09:00:00+0000',
    })).toMatchObject({
      post_id: '123_456', permalink: 'https://facebook.test/1',
      legende: 'Portes ouvertes', media_url: 'https://cdn.test/2.jpg', kind: 'image',
    });
  });

  test('une vidéo est reconnue comme telle (traitée en V2, jamais téléchargée ici)', () => {
    expect(social.normalizeGraphPost({ id: '1', media_type: 'VIDEO' }).kind).toBe('video');
    expect(social.normalizeGraphPost({ id: '2', type: 'reels' }).kind).toBe('video');
  });

  test('sans identifiant, le post est ignoré (rien n\'est inventé)', () => {
    expect(social.normalizeGraphPost({ caption: 'orpheline' })).toBeNull();
    expect(social.normalizeGraphPost(null)).toBeNull();
  });

  test('extractGraphData accepte les formes connues et refuse l\'inconnue', () => {
    expect(social.extractGraphData({ data: [{ id: '1' }] })).toHaveLength(1);
    expect(social.extractGraphData([{ id: '1' }])).toHaveLength(1);
    expect(social.extractGraphData({ data: { data: [{ id: '1' }] } })).toHaveLength(1);
    expect(social.extractGraphData({ error: { message: 'jeton expiré' } })).toBeNull();
  });
});

describe('syncSocialPosts — comportement du job', () => {
  let fetchSpy;
  let warnSpy;
  let errSpy;
  let logSpy;

  /** settings + réponses Graph. */
  function installMocks({ settings = {}, connu = null } = {}) {
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT key, value FROM settings WHERE key LIKE/.test(s)) {
        return Promise.resolve({ rows: Object.entries(settings).map(([key, value]) => ({ key, value })) });
      }
      if (/SELECT value FROM settings/.test(s)) {
        const key = params && params[0];
        return Promise.resolve({ rows: settings[key] != null ? [{ value: settings[key] }] : [] });
      }
      if (/SELECT id, media_fichier FROM badgeuse_social_posts/.test(s)) {
        return Promise.resolve({ rows: connu ? [connu] : [] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  const comptes = (o = {}) => JSON.stringify([
    { reseau: 'instagram', compte: 'fripandcorouen', graph_id: '17841', actif: true, ...o },
  ]);

  beforeEach(() => {
    mockQuery.mockReset();
    mockLookup.mockReset();
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    installMocks();
  });
  afterEach(() => {
    fetchSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore(); logSpy.mockRestore();
  });

  test('désactivé → no-op, aucun appel réseau', async () => {
    const r = await social.syncSocialPosts();
    expect(r).toMatchObject({ items: 0, ignore: 'desactive' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('activé SANS jeton → no-op SILENCIEUX (le partage manuel reste la voie nominale)', async () => {
    installMocks({ settings: { 'badgeuse.social_sync_actif': 'true' } });
    const r = await social.syncSocialPosts();
    expect(r).toMatchObject({ ignore: 'sans_jeton' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled(); // une intégration non installée n'est pas une panne
  });

  test('compte SANS identifiant Graph : ignoré et SIGNALÉ (jamais deviné depuis le pseudo)', async () => {
    installMocks({
      settings: {
        'badgeuse.social_sync_actif': 'true',
        'badgeuse.meta_token': 'jeton-en-clair-pour-le-test',
        'badgeuse.social_comptes': comptes({ graph_id: null }),
      },
    });
    const r = await social.syncSocialPosts();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.erreurs).toBe(1);
    expect(warnSpy.mock.calls.flat().join(' ')).toMatch(/identifiant Graph non renseigné/);
  });

  test('post image : visuel rapatrié et upsert idempotent (ON CONFLICT)', async () => {
    installMocks({
      settings: {
        'badgeuse.social_sync_actif': 'true',
        'badgeuse.meta_token': 'jeton',
        'badgeuse.social_comptes': comptes(),
      },
    });
    fetchSpy
      .mockResolvedValueOnce({ // Graph
        ok: true, status: 200,
        json: async () => ({ data: [{ id: '17900', media_type: 'IMAGE', media_url: 'https://cdn.test/1.jpg', caption: 'Bonjour', permalink: 'https://ig.test/p/1', timestamp: '2026-08-10T10:00:00+0000' }] }),
      })
      .mockResolvedValueOnce({ // média
        ok: true, status: 200,
        headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
        body: null,
        arrayBuffer: async () => Buffer.from('jpeg'),
      });

    const r = await social.syncSocialPosts();
    expect(r.posts).toBe(1);
    const upsert = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_social_posts/.test(String(c[0])));
    expect(String(upsert[0])).toMatch(/ON CONFLICT \(reseau, post_id\) DO UPDATE/);
    expect(upsert[1][0]).toBe('instagram');
    expect(upsert[1][2]).toBe('17900');
    const fichier = upsert[1][5];
    expect(fichier).toMatch(/^social\//);
    social.unlinkMedia(fichier);
  });

  test('VIDÉO ignorée et comptée (stories = V2, ADR-0004 §6 — dit, pas promis à moitié)', async () => {
    installMocks({
      settings: {
        'badgeuse.social_sync_actif': 'true', 'badgeuse.meta_token': 'jeton',
        'badgeuse.social_comptes': comptes(),
      },
    });
    fetchSpy.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ data: [{ id: '1', media_type: 'VIDEO', media_url: 'https://cdn.test/v.mp4' }] }),
    });
    const r = await social.syncSocialPosts();
    expect(r.videos_ignorees).toBe(1);
    expect(r.posts).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // aucun téléchargement tenté
  });

  test('erreur Graph : journalisée avec le message de Meta, le job ne casse pas', async () => {
    installMocks({
      settings: {
        'badgeuse.social_sync_actif': 'true', 'badgeuse.meta_token': 'jeton',
        'badgeuse.social_comptes': comptes(),
      },
    });
    fetchSpy.mockResolvedValue({
      ok: false, status: 401, json: async () => ({ error: { message: 'jeton expiré' } }),
    });
    const r = await social.syncSocialPosts();
    expect(r.erreurs).toBeGreaterThan(0);
    expect(errSpy.mock.calls.flat().join(' ')).toMatch(/jeton expiré/);
  });

  test('le job ne SUPPRIME jamais rien (la rétention appartient à la purge RGPD)', async () => {
    installMocks({
      settings: {
        'badgeuse.social_sync_actif': 'true', 'badgeuse.meta_token': 'jeton',
        'badgeuse.social_comptes': comptes(),
      },
    });
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) });
    await social.syncSocialPosts();
    expect(mockQuery.mock.calls.some((c) => /DELETE/i.test(String(c[0])))).toBe(false);
  });
});

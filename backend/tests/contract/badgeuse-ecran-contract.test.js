// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — ÉCRAN DU POSTE (playlist « jours de VAK », écran en
// direct, aperçu des médias, plage d'activation)
// ───────────────────────────────────────────────────────────────────────────
// Quatre garanties, chacune correspondant à une manière de mentir à l'écran :
//
//  1. UN CONTENU « JOURS DE VAK » NE PASSE QUE LES JOURS DE VAK. Les dates
//     viennent du module VAK ; en cas de doute (source inaccessible) le
//     contenu est OMIS — annoncer aux visiteurs une vente qui n'a peut-être
//     pas lieu coûte plus cher qu'un écran manquant.
//  2. L'ÉCRAN EN DIRECT LIT LA MÊME PLAYLIST QUE LE POSTE. Il appelle la
//     fonction partagée `construirePlaylist` : c'est ce qui interdit à
//     l'écran de contrôle de diverger de l'atelier.
//  3. LES MÉDIAS SONT SERVIS AU BACK-OFFICE SOUS AUTHENTIFICATION, avec les
//     mêmes gardes de chemin que l'API device (référence préfixée, liste
//     blanche d'extensions).
//  4. LA PLAGE D'ACTIVATION EST VALIDÉE À LA SAISIE, et n'est pas une règle
//     de gestion RH : la régler ne vaut pas arbitrage de la grille (ADR-0002).
//
// Auth réelle (JWT), base mockée : aucun accès disque ni réseau.
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

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const badgeuse = require('../../src/routes/badgeuse');
const deviceApi = require('../../src/routes/badgeuse-device');
const { BADGEUSE_SETTING_DEFAULTS, REGLES_RH_KEYS } = require('../../src/utils/badgeuse-settings');

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

const get = (p, role = 'ADMIN') => request(app).get(p).set('Authorization', `Bearer ${TOKENS[role]}`);
const put = (p, role, body = {}) => request(app).put(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

// ── Base simulée ───────────────────────────────────────────────────────────
// `contenus` et `vaks` sont pilotés par chaque test ; tout le reste répond
// « rien », ce qui suffit : les générateurs sans donnée s'effacent, comme en
// production.
let contenus;
let vaks;
let settings;
let devices;

beforeEach(() => {
  contenus = [];
  vaks = [];
  settings = {};
  devices = [];
  mockQuery.mockReset();
  mockQuery.mockImplementation((text, params = []) => {
    const s = String(text);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM badgeuse_contenus/.test(s)) return Promise.resolve({ rows: contenus });
    if (/FROM vaks/.test(s)) {
      if (vaks === 'panne') return Promise.reject(new Error('relation « vaks » inaccessible'));
      return Promise.resolve({ rows: vaks });
    }
    if (/FROM badgeuse_devices/.test(s)) return Promise.resolve({ rows: devices });
    if (/SELECT key, value FROM settings WHERE key LIKE/.test(s)) {
      return Promise.resolve({ rows: Object.entries(settings).map(([key, value]) => ({ key, value: String(value) })) });
    }
    if (/SELECT key, value FROM settings WHERE key IN/.test(s)) return Promise.resolve({ rows: [] });
    if (/INSERT INTO settings/.test(s)) { settings[params[0]] = params[1]; return Promise.resolve({ rows: [] }); }
    if (/INSERT INTO rgpd_audit_log/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
});

const contenuMessage = (over = {}) => ({
  id: 1, type: 'message', titre: 'Consignes', corps: 'Tri sécurisé', media_url: null,
  duree_sec: 10, ordre: 0, fichier: null, media_type: null, media_sha256: null,
  config: null, vak_uniquement: false, ...over,
});
const VAK_EN_COURS = { id: 7, libelle: 'VAK septembre', poids_objectif_kg: 2000, ca_objectif_ttc: 12000 };

// ═══════════════════════════════════════════════════════════════════════════
describe('playlist : un contenu « jours de VAK » ne passe que les jours de VAK', () => {
  test('sans vente en cours, le contenu est OMIS — et les autres passent', async () => {
    contenus = [
      contenuMessage(),
      contenuMessage({ id: 2, titre: 'Promo VAK', vak_uniquement: true }),
    ];
    vaks = [];
    const elements = await deviceApi.construirePlaylist(1);
    expect(elements.map((e) => e.id)).toEqual([1]);
  });

  test('avec une vente en cours, le contenu EST diffusé', async () => {
    contenus = [
      contenuMessage(),
      contenuMessage({ id: 2, titre: 'Promo VAK', vak_uniquement: true }),
    ];
    vaks = [VAK_EN_COURS];
    const elements = await deviceApi.construirePlaylist(1);
    expect(elements.map((e) => e.id)).toEqual([1, 2]);
  });

  test('média téléversé réservé à la VAK : même règle, forme de média conservée', async () => {
    contenus = [contenuMessage({
      id: 5, type: 'media', fichier: 'media-1.jpg', media_type: 'image',
      media_sha256: 'a'.repeat(64), vak_uniquement: true,
    })];
    vaks = [VAK_EN_COURS];
    const [el] = await deviceApi.construirePlaylist(1);
    expect(el).toMatchObject({ type: 'media', media_id: 'c5', media_type: 'image' });

    vaks = [];
    expect(await deviceApi.construirePlaylist(1)).toEqual([]);
  });

  test('source VAK inaccessible : le contenu est OMIS, jamais diffusé « au cas où »', async () => {
    // Annoncer une vente qui n'a peut-être pas lieu trompe des visiteurs ;
    // un écran manquant ne trompe personne.
    contenus = [contenuMessage({ id: 2, vak_uniquement: true }), contenuMessage()];
    vaks = 'panne';
    const elements = await deviceApi.construirePlaylist(1);
    expect(elements.map((e) => e.id)).toEqual([1]);
  });

  test('aucun contenu VAK : la question n\'est même pas posée à la base', async () => {
    contenus = [contenuMessage()];
    await deviceApi.construirePlaylist(1);
    expect(mockQuery.mock.calls.some((c) => /FROM vaks/.test(String(c[0])))).toBe(false);
  });

  test('le SITE du poste atteint les générateurs (défaut trouvé en extrayant la fonction)', async () => {
    // La fonction a été SORTIE de la route pour être partagée avec le
    // back-office : une référence oubliée à `req.device.site_id` y survivait,
    // et l'écran météo disparaissait en silence (le try/catch par générateur
    // avale l'erreur). Le site doit voyager par le paramètre, et lui seul.
    contenus = [contenuMessage({ id: 3, type: 'meteo', corps: 'Repli texte' })];
    await deviceApi.construirePlaylist(42);
    const lectureContenus = mockQuery.mock.calls.find((c) => /FROM badgeuse_contenus/.test(String(c[0])));
    expect(lectureContenus[1]).toEqual([42]);
    const lectureSite = mockQuery.mock.calls.find((c) => /FROM badgeuse_sites WHERE id/.test(String(c[0])));
    expect(lectureSite && lectureSite[1]).toEqual([42]);
  });

  test('la playlist demande bien la colonne au SQL (garde anti-régression)', async () => {
    contenus = [contenuMessage()];
    await deviceApi.construirePlaylist(1);
    const lecture = mockQuery.mock.calls.find((c) => /FROM badgeuse_contenus/.test(String(c[0])));
    expect(String(lecture[0])).toMatch(/vak_uniquement/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /ecran-direct — le back-office lit ce que le poste reçoit', () => {
  test('mêmes éléments que la playlist du poste, avec l\'état du poste', async () => {
    contenus = [contenuMessage(), contenuMessage({ id: 2, titre: 'Sécurité' })];
    devices = [{
      id: 3, code: 'LH-P1', libelle: 'Atelier', site_id: 1, actif: true,
      dernier_heartbeat: new Date().toISOString(), heartbeat_info: {}, site_code: 'LH', site_libelle: 'Le Houlme',
    }];
    const r = await get('/api/badgeuse/ecran-direct');
    expect(r.status).toBe(200);
    expect(r.body.elements.map((e) => e.id)).toEqual([1, 2]);
    expect(r.body.poste).toMatchObject({ code: 'LH-P1', online: true });
    expect(r.body.genere_le).toBeTruthy();
  });

  test('poste muet : `online:false` — l\'écran doit pouvoir le dire', async () => {
    contenus = [contenuMessage()];
    devices = [{
      id: 3, code: 'LH-P1', site_id: 1, actif: true,
      dernier_heartbeat: new Date(Date.now() - 3600 * 1000).toISOString(), heartbeat_info: {},
    }];
    const r = await get('/api/badgeuse/ecran-direct');
    expect(r.body.poste.online).toBe(false);
  });

  test('aucun poste appairé : la playlist commune est rendue, `poste` vaut null', async () => {
    contenus = [contenuMessage()];
    devices = [];
    const r = await get('/api/badgeuse/ecran-direct');
    expect(r.status).toBe(200);
    expect(r.body.poste).toBeNull();
    expect(r.body.elements).toHaveLength(1);
  });

  test('poste demandé inexistant → 404 (jamais un autre poste en silence)', async () => {
    devices = [];
    const r = await get('/api/badgeuse/ecran-direct?device_id=99');
    expect(r.status).toBe(404);
  });

  test('habilitations : lecture ADMIN/RH/MANAGER, refus aux autres', async () => {
    contenus = [contenuMessage()];
    devices = [];
    for (const role of ['ADMIN', 'RH', 'MANAGER']) {
      expect((await get('/api/badgeuse/ecran-direct', role)).status).toBe(200);
    }
    expect((await get('/api/badgeuse/ecran-direct', 'COLLABORATEUR')).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /apercu-media/:ref — le média réel, sous authentification', () => {
  test('référence malformée → 400, sans toucher la base', async () => {
    const r = await get('/api/badgeuse/apercu-media/../../etc/passwd');
    expect([400, 404]).toContain(r.status);
    expect(mockQuery.mock.calls.some((c) => /badgeuse_contenus/.test(String(c[0])))).toBe(false);
  });

  test('référence inconnue → 404 (« absent » et « refusé » ne se distinguent pas)', async () => {
    const r = await get('/api/badgeuse/apercu-media/c404');
    expect(r.status).toBe(404);
  });

  test('habilitation : refusé au COLLABORATEUR', async () => {
    expect((await get('/api/badgeuse/apercu-media/c1', 'COLLABORATEUR')).status).toBe(403);
  });

  test('la résolution partage la garde de chemin de l\'API device', async () => {
    // Un chemin qui sort de la racine des médias doit être traité comme absent,
    // que la demande vienne du poste ou du back-office : une seconde copie de
    // cette garde serait la porte par laquelle un « .. » finirait par passer.
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [{ fichier: '../../../etc/passwd' }] }));
    expect(await deviceApi.resoudreMediaRef('c1')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /contenus/vak-agenda — dire QUAND un contenu VAK passera', () => {
  // LES DATES SONT DES OBJETS `Date`, comme les rend le pilote pg sur une
  // colonne DATE. Une première version comparait `String(date_debut)` au jour
  // courant : « Wed Sep 04 2026… » face à « 2026-09-04 », comparaison qui
  // échoue TOUJOURS, en silence — la vente du jour n'était jamais reconnue.
  // Le test rend donc ce que rend une vraie base, pas des chaînes commodes.
  const jourSql = (decalage) => new Date(Date.now() + decalage * 86400000);

  test('vente en cours aujourd\'hui : elle est identifiée comme telle', async () => {
    vaks = [{ id: 7, libelle: 'VAK septembre', date_debut: jourSql(-1), date_fin: jourSql(1), en_cours: true }];
    const r = await get('/api/badgeuse/contenus/vak-agenda');
    expect(r.status).toBe(200);
    expect(r.body.vak_du_jour).toMatchObject({ id: 7 });
  });

  test('c\'est PostgreSQL qui compare les dates, pas JavaScript', async () => {
    vaks = [{ id: 7, date_debut: jourSql(-1), date_fin: jourSql(1), en_cours: true }];
    await get('/api/badgeuse/contenus/vak-agenda');
    const requete = String(mockQuery.mock.calls.find((c) => /FROM vaks/.test(String(c[0])))[0]);
    expect(requete).toMatch(/BETWEEN date_debut AND date_fin/);
  });

  test('aucune vente en cours : `vak_du_jour` est null, les suivantes sont listées', async () => {
    vaks = [{ id: 8, libelle: 'VAK octobre', date_debut: jourSql(10), date_fin: jourSql(11), en_cours: false }];
    const r = await get('/api/badgeuse/contenus/vak-agenda');
    expect(r.body.vak_du_jour).toBeNull();
    expect(r.body.prochaines).toHaveLength(1);
  });

  test('module VAK en panne : `disponible:false` — jamais « aucune vente »', async () => {
    vaks = 'panne';
    const r = await get('/api/badgeuse/contenus/vak-agenda');
    expect(r.status).toBe(200);
    expect(r.body.disponible).toBe(false);
    expect(r.body.prochaines).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('PUT /parametres — plage d\'activation de l\'écran', () => {
  test('les deux clés existent avec un défaut documenté', () => {
    expect(BADGEUSE_SETTING_DEFAULTS['badgeuse.dpms_allumage']).toBe('05:30');
    expect(BADGEUSE_SETTING_DEFAULTS['badgeuse.dpms_extinction']).toBe('21:30');
  });

  test('heure illisible : le lot est REFUSÉ en entier, rien n\'est écrit', async () => {
    const r = await put('/api/badgeuse/parametres', 'ADMIN', {
      dpms_allumage: '5h30', dpms_extinction: '21:30',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/HH:MM/);
    expect(mockQuery.mock.calls.some((c) => /INSERT INTO settings/.test(String(c[0])))).toBe(false);
  });

  test('heures valides : enregistrées', async () => {
    const r = await put('/api/badgeuse/parametres', 'ADMIN', {
      dpms_allumage: '04:45', dpms_extinction: '22:15',
    });
    expect(r.status).toBe(200);
    expect(settings['badgeuse.dpms_allumage']).toBe('04:45');
    expect(settings['badgeuse.dpms_extinction']).toBe('22:15');
  });

  test('plage à cheval sur minuit acceptée (équipes de nuit)', async () => {
    const r = await put('/api/badgeuse/parametres', 'ADMIN', {
      dpms_allumage: '21:00', dpms_extinction: '06:00',
    });
    expect(r.status).toBe(200);
  });

  test('ce n\'est PAS une règle de gestion RH : la régler ne vaut pas arbitrage', async () => {
    // Sans cette distinction, changer l'heure d'allumage d'un écran éteindrait
    // le signal « grille non arbitrée par la Direction » (ADR-0002 §3).
    expect(REGLES_RH_KEYS).not.toContain('badgeuse.dpms_allumage');
    expect(REGLES_RH_KEYS).not.toContain('badgeuse.dpms_extinction');
    await put('/api/badgeuse/parametres', 'ADMIN', { dpms_allumage: '06:00', dpms_extinction: '20:00' });
    expect(settings['badgeuse.regles_validees_le']).toBeUndefined();
  });

  test('la configuration envoyée au poste porte la plage', async () => {
    settings['badgeuse.dpms_allumage'] = '04:45';
    settings['badgeuse.dpms_extinction'] = '22:15';
    const { readBadgeuseParams } = require('../../src/utils/badgeuse-settings');
    const p = await readBadgeuseParams();
    expect(p.dpms_allumage).toBe('04:45');
    expect(p.dpms_extinction).toBe('22:15');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT ÉCRAN ↔ API — ce que l'interface envoie doit exister côté serveur.
// Les fichiers du front sont LUS, jamais réimplémentés.
// ═══════════════════════════════════════════════════════════════════════════
const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'components', 'badgeuse');
const lireFront = (f) => fs.readFileSync(path.join(FRONT, f), 'utf8');

describe('contrat écran ↔ API : contenus VAK et titre d\'un média', () => {
  test('les trois formulaires de création envoient `vak_uniquement`', () => {
    for (const f of ['PlaylistAffichage.jsx', 'UploadMediaModal.jsx', 'PartagerLienModal.jsx']) {
      expect(lireFront(f)).toMatch(/vak_uniquement/);
    }
  });

  test('le titre d\'un média téléversé est ÉDITABLE (défaut corrigé)', () => {
    // LE DÉFAUT EXACT : l'encadré promettait « seuls le titre, la durée…
    // sont modifiables ici », mais le champ Titre vivait dans la branche
    // « pas un média » d'un ternaire `verrouTypeMedia ? encadré : titre` —
    // il n'apparaissait donc JAMAIS pour un média téléversé ou un lien.
    const src = lireFront('PlaylistAffichage.jsx');
    expect(src).toMatch(/value=\{form\.titre\}/);

    // La forme fautive, verrouillée telle quelle : un encadré média suivi
    // d'un « sinon » qui porte le champ Titre.
    expect(src).not.toMatch(/\)\s*:\s*\(\s*<div>\s*<label[^>]*>\s*Titre/);

    // Et le champ ne doit dépendre d'AUCUNE condition : il est au premier
    // niveau du formulaire, entre le bloc d'information média et le corps.
    const avantChamp = src.slice(0, src.indexOf('value={form.titre}'));
    const derniereOuverture = avantChamp.lastIndexOf('{verrouTypeMedia');
    const derniereFermeture = avantChamp.lastIndexOf(')}');
    expect(derniereFermeture).toBeGreaterThan(derniereOuverture);
  });

  test('l\'aperçu affiche le média par la route authentifiée du back-office', () => {
    expect(lireFront('PrevisualisationContenu.jsx')).toMatch(/badgeuse\/apercu-media/);
  });

  test('l\'écran en direct lit /ecran-direct, pas la liste des contenus', () => {
    const src = lireFront('EcranDirect.jsx');
    expect(src).toMatch(/badgeuse\/ecran-direct/);
    expect(src).not.toMatch(/badgeuse\/contenus'/);
  });
});

/**
 * Module 33 « Temps & Présence » — API device : PLAYLIST « position des
 * tournées » (type `tournees_carte`).
 * Cadre : docs/badgeuse/adr/0004-affichage-enrichi-conformite.md, addendum du
 * 19/08/2026 ; contrat docs/badgeuse/CONTRAT_API_DEVICE.md §3quinquies (v1.6).
 *
 * CE QUE CE FICHIER VERROUILLE — ce ne sont pas des détails d'implémentation,
 * ce sont les CONDITIONS DE CONFORMITÉ de l'écran :
 *   1. AUCUNE COORDONNÉE ne descend vers le poste. Ni celle d'un véhicule
 *      (interdit), ni celle d'un secteur (projetée côté serveur). Un poste
 *      compromis ne peut pas restituer le trajet de quelqu'un.
 *   2. AUCUN NOM DE CHAUFFEUR, et la requête ne LIT même pas `employees` :
 *      ce qui n'est pas lu ne peut pas fuir par distraction (ADR-0004 §5).
 *   3. `gps_positions` n'est jamais interrogée : la position affichée est la
 *      commune du DERNIER POINT COLLECTÉ, un événement de travail — pas une
 *      position fine dégradée après coup.
 *   4. RIEN N'EST INVENTÉ : une tournée sans point collecté, ou dont la
 *      commune n'est pas plaçable, est annoncée « position inconnue » — elle
 *      n'est jamais posée au dépôt ni au centre de la carte.
 *   5. L'écran `tournees` (la LISTE des progressions) continue d'exister à
 *      côté, inchangé : ajouter la carte ne retire une fonction à personne.
 *
 * DB mockée, aucune base (même harnais que badgeuse-veille-device.test.js).
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

// Territoire de collecte tel que le renvoie la requête « secteurs ».
const SECTEURS = [
  { code: '76108', nom: 'Le Houlme', lat: 49.5100, lng: 1.0500 },
  { code: '76681', nom: 'Sotteville-lès-Rouen', lat: 49.4100, lng: 1.0900 },
  { code: '76451', nom: 'Maromme', lat: 49.4700, lng: 1.0200 },
  { code: '76039', nom: 'Bonsecours', lat: 49.4400, lng: 1.1400 },
];

const tournee = (o) => ({
  id: 1, status: 'in_progress', collection_type: 'pav',
  vehicule_nom: null, registration: 'AB-123-CD', secteur: '76108',
  total: '12', faits: '7', ...o,
});

let app;
let sqlVus;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/badgeuse/device', deviceRouter);
});

function installMocks({ contenus = [], secteurs = SECTEURS, tournees = [tournee()] } = {}) {
  sqlVus = [];
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    sqlVus.push(s);
    if (/FROM badgeuse_devices d/.test(s)) return Promise.resolve({ rows: [DEVICE_ROW] });
    if (/SELECT key, value FROM settings/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM badgeuse_contenus/.test(s)) return Promise.resolve({ rows: contenus });
    if (/WITH points AS/.test(s)) return Promise.resolve({ rows: secteurs });   // secteurs du territoire
    if (/WITH jour AS/.test(s)) return Promise.resolve({ rows: tournees });     // tournées + dernier secteur
    if (/FROM tours t/.test(s)) return Promise.resolve({ rows: [] });           // ancien type `tournees`
    return Promise.resolve({ rows: [] });
  });
}

const contenu = (o) => ({
  id: 9, titre: null, corps: null, media_url: null, duree_sec: 12, ordre: 1, config: null, ...o,
});
const get = (p) => request(app).get(p).set('X-Device-Key', DEVICE_KEY);
const carteDe = async () => (await get(`${PATH}/playlist`)).body.elements[0];

beforeEach(() => {
  mockQuery.mockReset();
  installMocks();
  globalThis.fetch = jest.fn(async () => { throw new Error('réseau interdit en test'); });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. CONFORMITÉ — ce qui ne doit JAMAIS partir vers le poste
// ═══════════════════════════════════════════════════════════════════════════
describe('conformité de la charge utile', () => {
  test('AUCUNE latitude ni longitude dans toute la réponse', async () => {
    installMocks({ contenus: [contenu({ type: 'tournees_carte' })] });
    const brut = JSON.stringify((await get(`${PATH}/playlist`)).body);
    expect(brut).not.toMatch(/latitude|longitude|"lat"|"lng"/i);
    // Et aucune valeur numérique reconnaissable comme une coordonnée locale.
    expect(brut).not.toMatch(/49\.[0-9]{2}/);
  });

  test('un véhicule ne porte QU\'UNE RÉFÉRENCE de secteur, jamais de position propre', async () => {
    installMocks({ contenus: [contenu({ type: 'tournees_carte' })] });
    const el = await carteDe();
    const v = el.carte.vehicules[0];
    expect(v.secteur).toBe('76108');
    expect(v).not.toHaveProperty('x');
    expect(v).not.toHaveProperty('y');
    expect(Object.keys(v).sort()).toEqual(
      ['code', 'libelle', 'points_faits', 'points_total', 'secteur', 'statut']
    );
  });

  test('la position s\'arrête à la COMMUNE : le secteur affiché est bien celui du territoire', async () => {
    installMocks({ contenus: [contenu({ type: 'tournees_carte' })] });
    const { carte } = await carteDe();
    const secteur = carte.secteurs.find((s) => s.code === carte.vehicules[0].secteur);
    expect(secteur.nom).toBe('Le Houlme');
    // Le secteur porte une place SUR LE FOND (repère abstrait), pas une
    // coordonnée : c'est la projection serveur qui a détruit la géographie.
    expect(Number.isInteger(secteur.x)).toBe(true);
    expect(Number.isInteger(secteur.y)).toBe(true);
    expect(secteur.x).toBeLessThanOrEqual(carte.largeur);
    expect(secteur.y).toBeLessThanOrEqual(carte.hauteur);
  });

  test('aucun nom de chauffeur : `employees` n\'est même pas LUE', async () => {
    installMocks({ contenus: [contenu({ type: 'tournees_carte' })] });
    await get(`${PATH}/playlist`);
    const sqlCarte = sqlVus.filter((s) => /WITH jour AS|WITH points AS/.test(s)).join('\n');
    expect(sqlCarte.length).toBeGreaterThan(0);
    expect(sqlCarte).not.toMatch(/employees/i);
    expect(sqlCarte).not.toMatch(/first_name|last_name|driver/i);
  });

  test('`gps_positions` n\'est jamais interrogée pour cet écran', async () => {
    installMocks({ contenus: [contenu({ type: 'tournees_carte' })] });
    await get(`${PATH}/playlist`);
    expect(sqlVus.join('\n')).not.toMatch(/gps_positions/i);
  });

  test('la requête est PARAMÉTRÉE (le jour ne se concatène pas)', async () => {
    installMocks({ contenus: [contenu({ type: 'tournees_carte' })] });
    await get(`${PATH}/playlist`);
    const appel = mockQuery.mock.calls.find((c) => /WITH jour AS/.test(String(c[0])));
    expect(String(appel[0])).toMatch(/\$1::date/);
    expect(Array.isArray(appel[1])).toBe(true);
    expect(appel[1]).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. FOND DE CARTE — dessiné localement, jamais téléchargé
// ═══════════════════════════════════════════════════════════════════════════
describe('fond de carte', () => {
  test('le contour et les secteurs suffisent à dessiner : aucune URL n\'est servie', async () => {
    installMocks({ contenus: [contenu({ type: 'tournees_carte' })] });
    const { carte } = await carteDe();
    expect(carte.largeur).toBeGreaterThan(0);
    expect(carte.hauteur).toBeGreaterThan(0);
    expect(carte.secteurs).toHaveLength(4);
    expect(carte.contour.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(carte)).not.toMatch(/https?:|tile|\.png|\.jpg/i);
  });

  test('chaque sommet du contour est un secteur réel du territoire', async () => {
    installMocks({ contenus: [contenu({ type: 'tournees_carte' })] });
    const { carte } = await carteDe();
    for (const [x, y] of carte.contour) {
      expect(carte.secteurs.some((s) => s.x === x && s.y === y)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. JAMAIS DE VALEUR INVENTÉE
// ═══════════════════════════════════════════════════════════════════════════
describe('doctrine « jamais de valeur inventée »', () => {
  test('une tournée SANS point collecté part en « position inconnue »', async () => {
    installMocks({
      contenus: [contenu({ type: 'tournees_carte' })],
      tournees: [tournee({ id: 2, secteur: null, faits: '0', status: 'planned' })],
    });
    const { carte } = await carteDe();
    expect(carte.vehicules).toHaveLength(0);
    expect(carte.sans_position).toHaveLength(1);
    expect(carte.sans_position[0].code).toBe('AB-123-CD');
    expect(carte.sans_position[0]).not.toHaveProperty('secteur');
  });

  test('une commune ABSENTE du fond n\'est pas placée au hasard', async () => {
    // Le dernier CAV collecté est dans une commune dont aucun point n'est
    // géolocalisé : elle n'existe pas sur le fond, donc on ne la place pas.
    installMocks({
      contenus: [contenu({ type: 'tournees_carte' })],
      tournees: [tournee({ secteur: '76999' })],
    });
    const { carte } = await carteDe();
    expect(carte.vehicules).toHaveLength(0);
    expect(carte.sans_position).toHaveLength(1);
  });

  test('AUCUNE tournée aujourd\'hui : l\'écran est OMIS, pas affiché vide', async () => {
    installMocks({ contenus: [contenu({ type: 'tournees_carte' })], tournees: [] });
    expect((await get(`${PATH}/playlist`)).body.elements).toHaveLength(0);
  });

  test('AUCUN point géolocalisé : l\'écran est OMIS (pas de fond à dessiner)', async () => {
    installMocks({ contenus: [contenu({ type: 'tournees_carte' })], secteurs: [] });
    expect((await get(`${PATH}/playlist`)).body.elements).toHaveLength(0);
  });

  test('une coordonnée aberrante en base ne fait pas dérailler le fond', async () => {
    installMocks({
      contenus: [contenu({ type: 'tournees_carte' })],
      secteurs: [...SECTEURS, { code: '76000', nom: 'Jamais géocodée', lat: 0, lng: 0 }],
    });
    const { carte } = await carteDe();
    expect(carte.secteurs).toHaveLength(4);
    expect(carte.secteurs.some((s) => s.code === '76000')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CONTENU MÉTIER
// ═══════════════════════════════════════════════════════════════════════════
describe('contenu de l\'écran', () => {
  test('progression et code véhicule accompagnent la position', async () => {
    installMocks({ contenus: [contenu({ type: 'tournees_carte', titre: 'Sur le terrain' })] });
    const el = await carteDe();
    expect(el.type).toBe('tournees_carte');
    expect(el.titre).toBe('Sur le terrain');
    expect(el.carte.vehicules[0]).toMatchObject({
      code: 'AB-123-CD', libelle: 'Tournée CAV',
      points_faits: 7, points_total: 12, statut: 'in_progress',
    });
  });

  test('le nom du véhicule prime sur l\'immatriculation quand il existe', async () => {
    installMocks({
      contenus: [contenu({ type: 'tournees_carte' })],
      tournees: [tournee({ vehicule_nom: 'Camion 2' })],
    });
    const { carte } = await carteDe();
    expect(carte.vehicules[0].code).toBe('Camion 2');
  });

  test('une tournée ASSOCIATIONS est libellée comme telle et se situe aussi', async () => {
    installMocks({
      contenus: [contenu({ type: 'tournees_carte' })],
      tournees: [tournee({ collection_type: 'association', secteur: '76451' })],
    });
    const { carte } = await carteDe();
    expect(carte.vehicules[0].libelle).toBe('Tournée associations');
    expect(carte.vehicules[0].secteur).toBe('76451');
  });

  test('plusieurs tournées, placées et non placées, cohabitent', async () => {
    installMocks({
      contenus: [contenu({ type: 'tournees_carte' })],
      tournees: [
        tournee({ id: 1, secteur: '76108' }),
        tournee({ id: 2, secteur: '76039', registration: 'CD-456-EF' }),
        tournee({ id: 3, secteur: null, registration: 'GH-789-IJ' }),
      ],
    });
    const { carte } = await carteDe();
    expect(carte.vehicules.map((v) => v.code)).toEqual(['AB-123-CD', 'CD-456-EF']);
    expect(carte.sans_position.map((v) => v.code)).toEqual(['GH-789-IJ']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. NON-RÉGRESSION — la LISTE des tournées reste un écran à part entière
// ═══════════════════════════════════════════════════════════════════════════
describe('non-régression : `tournees` et `tournees_carte` sont DEUX écrans', () => {
  test('la liste des progressions conserve sa forme, sans bloc `carte`', async () => {
    installMocks({ contenus: [contenu({ id: 3, type: 'tournees' })] });
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM badgeuse_devices d/.test(s)) return Promise.resolve({ rows: [DEVICE_ROW] });
      if (/SELECT key, value FROM settings/.test(s)) return Promise.resolve({ rows: [] });
      if (/FROM badgeuse_contenus/.test(s)) {
        return Promise.resolve({ rows: [contenu({ id: 3, type: 'tournees' })] });
      }
      if (/FROM tours t/.test(s)) {
        return Promise.resolve({ rows: [{
          id: 1, status: 'in_progress', collection_type: 'pav',
          vehicule_nom: null, registration: 'AB-123-CD', total: '12', faits: '7',
        }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const el = (await get(`${PATH}/playlist`)).body.elements[0];
    expect(el.type).toBe('tournees');
    expect(el.tournees[0]).toMatchObject({ vehicule: 'AB-123-CD', points_faits: 7, points_total: 12 });
    expect(el).not.toHaveProperty('carte');
  });

  test('les deux écrans peuvent être programmés ensemble', async () => {
    installMocks({
      contenus: [contenu({ id: 3, type: 'tournees', ordre: 1 }),
                 contenu({ id: 9, type: 'tournees_carte', ordre: 2 })],
    });
    // La requête de l'ancien type renvoie la même tournée que la carte.
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM badgeuse_devices d/.test(s)) return Promise.resolve({ rows: [DEVICE_ROW] });
      if (/SELECT key, value FROM settings/.test(s)) return Promise.resolve({ rows: [] });
      if (/FROM badgeuse_contenus/.test(s)) {
        return Promise.resolve({ rows: [contenu({ id: 3, type: 'tournees', ordre: 1 }),
                                        contenu({ id: 9, type: 'tournees_carte', ordre: 2 })] });
      }
      if (/WITH points AS/.test(s)) return Promise.resolve({ rows: SECTEURS });
      if (/WITH jour AS/.test(s)) return Promise.resolve({ rows: [tournee()] });
      if (/FROM tours t/.test(s)) return Promise.resolve({ rows: [tournee()] });
      return Promise.resolve({ rows: [] });
    });
    const { elements } = (await get(`${PATH}/playlist`)).body;
    expect(elements.map((e) => e.type)).toEqual(['tournees', 'tournees_carte']);
  });

  test('un générateur en panne n\'emporte pas la playlist', async () => {
    installMocks({ contenus: [contenu({ type: 'tournees_carte' }), contenu({ id: 10, type: 'message', corps: 'Consigne', ordre: 2 })] });
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM badgeuse_devices d/.test(s)) return Promise.resolve({ rows: [DEVICE_ROW] });
      if (/SELECT key, value FROM settings/.test(s)) return Promise.resolve({ rows: [] });
      if (/FROM badgeuse_contenus/.test(s)) {
        return Promise.resolve({ rows: [contenu({ type: 'tournees_carte' }),
                                        contenu({ id: 10, type: 'message', corps: 'Consigne', ordre: 2 })] });
      }
      if (/WITH points AS/.test(s)) return Promise.reject(new Error('relation « cav » inexistante'));
      return Promise.resolve({ rows: [] });
    });
    const { elements } = (await get(`${PATH}/playlist`)).body;
    expect(elements.map((e) => e.type)).toEqual(['message']);
  });
});

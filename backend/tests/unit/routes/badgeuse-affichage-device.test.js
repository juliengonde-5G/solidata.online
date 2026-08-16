/**
 * Module 33 « Temps & Présence » — API device v1.3, ÉCRAN D'INFORMATION v2.
 * Contrat : docs/badgeuse/CONTRAT_API_DEVICE.md §3bis, CDC_AFFICHAGE_V2.md,
 * arbitrages de conformité : docs/badgeuse/adr/0004-affichage-enrichi-conformite.md.
 *
 * Ce fichier verrouille les INTERDITS de l'ADR-0004, ceux qu'aucune revue de
 * code ne rattrapera dans six mois :
 *   §1 — l'écran ne reçoit JAMAIS un nom complet (prénom + initiale) ;
 *   §4 — les drapeaux d'anniversaire n'existent QUE sur consentement, et la
 *        DATE DE NAISSANCE ne quitte jamais le serveur ;
 *   §5 — les tournées affichées ne portent JAMAIS le nom du chauffeur ;
 *   ADR-0002 — aucune règle d'affichage codée en dur : messages, plages
 *        horaires et phrases descendent tous des settings.
 * Plus les garanties de service : générateur vide = élément OMIS (jamais un
 * écran creux), média servi avec un Content-Type de liste blanche et sans
 * échappatoire de chemin.
 *
 * DB mockée, aucune base (même harnais que badgeuse-device.test.js).
 */
const mockQuery = jest.fn();
const mockConnect = jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} }));
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: (...a) => mockConnect(...a),
}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { hashDeviceKey } = require('../../../src/utils/badgeuse-crypto');
const media = require('../../../src/services/badgeuse-social');

const deviceRouter = require('../../../src/routes/badgeuse-device');

const DEVICE_CODE = 'LH-P1';
const DEVICE_KEY = 'a'.repeat(64);
const UID = '6af79677ac212277ce9caf53668e1561c75c43aaba28c6588da17c55915551d8';
const DEVICE_ROW = {
  id: 1, code: DEVICE_CODE, site_id: 1, actif: true,
  api_key_hash: hashDeviceKey(DEVICE_KEY), site_code: 'LH',
};
const PATH = `/api/badgeuse/device/v1/devices/${DEVICE_CODE}`;

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/badgeuse/device', deviceRouter);
});

/**
 * Mock DB par motif SQL. L'ORDRE des motifs compte : la requête « badges »
 * contient une sous-requête sur employee_contracts, elle doit donc être
 * reconnue avant.
 */
function installMocks({
  settings = {},
  badges = [{ uid_hmac: UID, employee_id: 7, first_name: 'Karim', last_name: 'Benali' }],
  contenus = [],
  employesFestifs = [],
  news = [],
  tournees = [],
  vak = null,
  vakCompteurs = { poids: 0, ca: 0, tickets: 0 },
  social = [],
  contenuFichier = undefined,
  socialFichier = undefined,
  erreurs = [],
} = {}) {
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql);
    for (const motif of erreurs) {
      if (s.includes(motif)) return Promise.reject(Object.assign(new Error('table absente'), { code: '42P01' }));
    }
    if (/FROM badgeuse_devices d/.test(s)) return Promise.resolve({ rows: [DEVICE_ROW] });
    if (/SELECT key, value FROM settings/.test(s)) {
      return Promise.resolve({ rows: Object.entries(settings).map(([key, value]) => ({ key, value })) });
    }
    if (/FROM badgeuse_badges b/.test(s)) return Promise.resolve({ rows: badges });
    if (/FROM badgeuse_contenus\b/.test(s) && /SELECT fichier/.test(s)) {
      return Promise.resolve({ rows: contenuFichier === undefined ? [] : [{ fichier: contenuFichier }] });
    }
    if (/FROM badgeuse_contenus/.test(s)) return Promise.resolve({ rows: contenus });
    if (/FROM badgeuse_social_posts/.test(s) && /media_fichier AS fichier/.test(s)) {
      return Promise.resolve({ rows: socialFichier === undefined ? [] : [{ fichier: socialFichier }] });
    }
    if (/FROM badgeuse_social_posts/.test(s)) return Promise.resolve({ rows: social });
    if (/FROM employees e/.test(s)) return Promise.resolve({ rows: employesFestifs });
    if (/FROM news_articles/.test(s)) return Promise.resolve({ rows: news });
    if (/FROM tours t/.test(s)) return Promise.resolve({ rows: tournees });
    if (/FROM vaks /.test(s)) return Promise.resolve({ rows: vak ? [vak] : [] });
    if (/FROM vak_tickets/.test(s)) return Promise.resolve({ rows: [vakCompteurs] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockClear();
  installMocks();
});

const get = (p, key = DEVICE_KEY, headers = {}) => {
  const r = request(app).get(p);
  if (key !== null) r.set('X-Device-Key', key);
  Object.entries(headers).forEach(([k, v]) => r.set(k, v));
  return r;
};

/** Un badge, avec ses drapeaux tels que SQL les rendrait. */
const badge = (o = {}) => ({
  uid_hmac: UID, employee_id: 7, first_name: 'Karim', last_name: 'Benali',
  optin: false, anniversaire: false, anniversaire_annees: null, premier_jour: false,
  ...o,
});

// ═══════════════════════════════════════════════════════════════════════════
// ADR-0004 §4 — drapeaux festifs : opt-in obligatoire, jamais de date
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /badges — drapeaux festifs (ADR-0004 §4)', () => {
  test('SANS opt-in, un anniversaire du jour ne produit AUCUN drapeau', async () => {
    // Le salarié fête bien son anniversaire (SQL le dit) mais n'a pas consenti :
    // l'écran n'en saura rien.
    installMocks({ badges: [badge({ optin: false, anniversaire: true, anniversaire_annees: 3 })] });
    const r = await get(`${PATH}/badges`);
    expect(r.body.badges[0].anniversaire).toBe(false);
    expect(r.body.badges[0].anniversaire_entreprise_annees).toBeNull();
  });

  test('AVEC opt-in, l\'anniversaire de naissance est signalé', async () => {
    installMocks({ badges: [badge({ optin: true, anniversaire: true })] });
    const r = await get(`${PATH}/badges`);
    expect(r.body.badges[0].anniversaire).toBe(true);
  });

  test('AVEC opt-in, les années d\'ancienneté remontent en ENTIER', async () => {
    installMocks({ badges: [badge({ optin: true, anniversaire_annees: 2 })] });
    const r = await get(`${PATH}/badges`);
    expect(r.body.badges[0].anniversaire_entreprise_annees).toBe(2);
  });

  test('moins d\'un an d\'ancienneté → null (on ne fête pas « 0 an »)', async () => {
    installMocks({ badges: [badge({ optin: true, anniversaire_annees: 0 })] });
    expect((await get(`${PATH}/badges`)).body.badges[0].anniversaire_entreprise_annees).toBeNull();
  });

  test('`premier_jour` est INDÉPENDANT de l\'opt-in (bienvenue ≠ anniversaire)', async () => {
    installMocks({ badges: [badge({ optin: false, premier_jour: true })] });
    const r = await get(`${PATH}/badges`);
    expect(r.body.badges[0].premier_jour).toBe(true);
    expect(r.body.badges[0].anniversaire).toBe(false);
  });

  test('l\'interrupteur global `festif_actif=false` coupe les anniversaires, pas la bienvenue', async () => {
    installMocks({
      settings: { 'badgeuse.festif_actif': 'false' },
      badges: [badge({ optin: true, anniversaire: true, anniversaire_annees: 4, premier_jour: true })],
    });
    const r = await get(`${PATH}/badges`);
    expect(r.body.badges[0].anniversaire).toBe(false);
    expect(r.body.badges[0].anniversaire_entreprise_annees).toBeNull();
    expect(r.body.badges[0].premier_jour).toBe(true);
  });

  test('AUCUNE date de naissance ne transite, même avec opt-in', async () => {
    installMocks({
      badges: [{ ...badge({ optin: true, anniversaire: true }), birth_date: '1988-08-16', seniority_date: '2022-08-16' }],
    });
    const charge = JSON.stringify((await get(`${PATH}/badges`)).body);
    expect(charge).not.toContain('1988-08-16');
    expect(charge).not.toContain('2022-08-16');
    expect(charge).not.toMatch(/birth_date|seniority_date/);
  });

  test('la date de naissance n\'est pas non plus SÉLECTIONNÉE telle quelle en SQL', async () => {
    await get(`${PATH}/badges`);
    const sql = mockQuery.mock.calls.map((c) => String(c[0])).find((x) => /FROM badgeuse_badges b/.test(x));
    // Elle n'apparaît que dans une COMPARAISON, jamais comme colonne rendue :
    // c'est le résultat booléen qui part, pas la date. On le vérifie occurrence
    // par occurrence plutôt qu'à vue d'œil.
    expect(sql).toMatch(/to_char\(e\.birth_date/);
    const occurrences = sql.split('e.birth_date').slice(1);
    expect(occurrences.length).toBeGreaterThan(0);
    for (const suite of occurrences) {
      expect(suite).toMatch(/^(\s+IS NOT NULL|,\s*'MM-DD'\))/);
    }
    expect(sql).not.toMatch(/e\.birth_date\s+AS/i);
    expect(sql).not.toMatch(/e\.seniority_date\s+AS/i);
  });

  test('l\'ETag CHANGE quand un drapeau change (sinon le poste garderait la veille)', async () => {
    installMocks({ badges: [badge({ optin: true, anniversaire: false })] });
    const veille = (await get(`${PATH}/badges`)).headers.etag;
    installMocks({ badges: [badge({ optin: true, anniversaire: true })] });
    const jourJ = (await get(`${PATH}/badges`)).headers.etag;
    expect(jourJ).not.toBe(veille);
  });

  test('base non migrée (42703) : le cache badges continue de servir, sans drapeaux', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let premier = true;
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM badgeuse_devices d/.test(s)) return Promise.resolve({ rows: [DEVICE_ROW] });
      if (/SELECT key, value FROM settings/.test(s)) return Promise.resolve({ rows: [] });
      if (/FROM badgeuse_badges b/.test(s)) {
        if (premier) {
          premier = false;
          return Promise.reject(Object.assign(new Error('column "badgeuse_optin_festif" does not exist'), { code: '42703' }));
        }
        return Promise.resolve({ rows: [badge()] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await get(`${PATH}/badges`);
    expect(r.status).toBe(200);
    expect(r.body.badges[0].prenom).toBe('Karim'); // le pointage reste possible
    expect(r.body.badges[0].anniversaire).toBe(false);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/base non migrée/i);
    warn.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /config — bloc `affichage` (ADR-0002 : rien en dur dans le poste)
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /config — bloc affichage', () => {
  test('gabarits, plages, phrases et interrupteurs sont servis avec leurs défauts', async () => {
    const a = (await get(`${PATH}/config`)).body.config.affichage;
    expect(a.messages).toEqual({
      matin: 'Bonjour, {prenom} !',
      pause: 'Bon appétit, {prenom} !',
      retour: 'Bon après-midi, {prenom} !',
      soir: 'Bonne fin de journée, {prenom} !',
      premier_jour: 'Bienvenue chez Solidarité Textiles, {prenom} !',
      anniversaire: 'Joyeux anniversaire, {prenom} ! 🎉',
      anniversaire_entreprise: '{annees} an(s) avec nous, {prenom} — merci ! 🎉',
    });
    expect(a.plages_moments).toEqual({
      matin_fin: '11:30', pause_debut: '11:00', pause_fin: '14:00',
      retour_fin: '15:00', soir_debut: '14:00',
    });
    expect(Array.isArray(a.phrases_motivation)).toBe(true);
    expect(a.phrases_motivation.length).toBeGreaterThanOrEqual(8);
    expect(a.motivation_active).toBe(true);
    expect(a.festif_actif).toBe(true);
  });

  test('TOUT vient des settings : un gabarit et une plage modifiés sont servis tels quels', async () => {
    installMocks({
      settings: {
        'badgeuse.msg_matin': 'Salut {prenom} !',
        'badgeuse.moment_matin_fin': '10:45',
        'badgeuse.motivation_active': 'false',
        'badgeuse.phrases_motivation': JSON.stringify(['Une seule phrase']),
      },
    });
    const a = (await get(`${PATH}/config`)).body.config.affichage;
    expect(a.messages.matin).toBe('Salut {prenom} !');
    expect(a.plages_moments.matin_fin).toBe('10:45');
    expect(a.motivation_active).toBe(false);
    expect(a.phrases_motivation).toEqual(['Une seule phrase']);
  });

  test('un vivier de phrases illisible retombe sur le défaut documenté (jamais un écran vide)', async () => {
    installMocks({ settings: { 'badgeuse.phrases_motivation': '{ ceci n\'est pas du JSON' } });
    expect((await get(`${PATH}/config`)).body.config.affichage.phrases_motivation.length).toBeGreaterThan(0);
  });

  test('hors VAK, la cadence de playlist reste celle des paramètres', async () => {
    expect((await get(`${PATH}/config`)).body.config.sync_playlist_interval_sec).toBe(900);
  });

  test('jour de VAK : le SERVEUR abaisse la cadence à 300 s (CONTRAT §3bis)', async () => {
    installMocks({ vak: { id: 3, libelle: 'VAK août', poids_objectif_kg: 2000, ca_objectif_ttc: 8000 } });
    expect((await get(`${PATH}/config`)).body.config.sync_playlist_interval_sec).toBe(300);
  });

  test('une VAK injoignable ne casse pas la config (cadence paramétrée conservée)', async () => {
    installMocks({ erreurs: ['FROM vaks '] });
    const r = await get(`${PATH}/config`);
    expect(r.status).toBe(200);
    expect(r.body.config.sync_playlist_interval_sec).toBe(900);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /playlist — générateurs construits CÔTÉ SERVEUR
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /playlist — générateurs', () => {
  const contenu = (o) => ({
    id: 1, type: 'message', titre: 'T', corps: null, media_url: null,
    duree_sec: 10, ordre: 1, fichier: null, media_type: null, media_sha256: null, config: null,
    ...o,
  });

  test('les éléments TEXTE existants gardent exactement leur forme (aucune régression)', async () => {
    installMocks({ contenus: [contenu({ id: 7, type: 'message', corps: 'Port des gants', duree_sec: 12 })] });
    const r = await get(`${PATH}/playlist`);
    expect(r.body.elements[0]).toEqual({
      id: 7, type: 'message', titre: 'T', corps: 'Port des gants',
      media_url: null, duree_sec: 12, ordre: 1,
    });
  });

  describe('annonces (anniversaires)', () => {
    test('AUCUNE annonce du jour → l\'élément est OMIS (pas d\'écran vide)', async () => {
      installMocks({ contenus: [contenu({ type: 'annonces' })], employesFestifs: [] });
      expect((await get(`${PATH}/playlist`)).body.elements).toEqual([]);
    });

    test('prénom + INITIALE uniquement : le nom de famille ne sort jamais (ADR-0004 §1)', async () => {
      installMocks({
        contenus: [contenu({ type: 'annonces' })],
        employesFestifs: [{ first_name: 'Sonia', last_name: 'Dupont', anniversaire: true, annees: null }],
      });
      const r = await get(`${PATH}/playlist`);
      expect(r.body.elements[0].annonces).toEqual([
        { prenom: 'Sonia', initiale: 'D', type: 'anniversaire', annees: null },
      ]);
      expect(JSON.stringify(r.body)).not.toContain('Dupont');
    });

    test('anniversaire d\'entreprise : deux annonces distinctes si les deux tombent le même jour', async () => {
      installMocks({
        contenus: [contenu({ type: 'annonces' })],
        employesFestifs: [{ first_name: 'Karim', last_name: 'Benali', anniversaire: true, annees: 2 }],
      });
      const annonces = (await get(`${PATH}/playlist`)).body.elements[0].annonces;
      expect(annonces.map((a) => a.type)).toEqual(['anniversaire', 'anniversaire_entreprise']);
      expect(annonces[1].annees).toBe(2);
    });

    test('seuls les salariés CONSENTANTS et actifs sont interrogés', async () => {
      installMocks({ contenus: [contenu({ type: 'annonces' })] });
      await get(`${PATH}/playlist`);
      const sql = mockQuery.mock.calls.map((c) => String(c[0])).find((x) => /FROM employees e/.test(x));
      expect(sql).toMatch(/badgeuse_optin_festif, false\) = true/);
      expect(sql).toMatch(/is_active, true\) = true/);
    });

    test('`festif_actif=false` supprime le générateur d\'annonces', async () => {
      installMocks({
        settings: { 'badgeuse.festif_actif': 'false' },
        contenus: [contenu({ type: 'annonces' })],
        employesFestifs: [{ first_name: 'Sonia', last_name: 'Dupont', anniversaire: true, annees: null }],
      });
      expect((await get(`${PATH}/playlist`)).body.elements).toEqual([]);
    });
  });

  describe('tournées (ADR-0004 §5 — jamais de nom de chauffeur)', () => {
    const tournee = {
      id: 4, status: 'in_progress', collection_type: 'cav',
      vehicule_nom: 'Renault Master', registration: 'AB-123-CD', total: '10', faits: '4',
    };

    test('libellé, véhicule et progression — et RIEN qui identifie une personne', async () => {
      installMocks({ contenus: [contenu({ type: 'tournees' })], tournees: [tournee] });
      const r = await get(`${PATH}/playlist`);
      expect(r.body.elements[0].tournees).toEqual([
        { libelle: 'Tournée CAV', vehicule: 'Renault Master', statut: 'in_progress', points_faits: 4, points_total: 10 },
      ]);
      expect(Object.keys(r.body.elements[0].tournees[0]).sort())
        .toEqual(['libelle', 'points_faits', 'points_total', 'statut', 'vehicule']);
    });

    test('la requête ne JOINT même pas la table des salariés', async () => {
      installMocks({ contenus: [contenu({ type: 'tournees' })], tournees: [tournee] });
      await get(`${PATH}/playlist`);
      const sql = mockQuery.mock.calls.map((c) => String(c[0])).find((x) => /FROM tours t/.test(x));
      expect(sql).not.toMatch(/employees/);
      expect(sql).not.toMatch(/driver/);
      expect(sql).not.toMatch(/first_name|last_name/);
    });

    test('aucune tournée en cours → élément OMIS', async () => {
      installMocks({ contenus: [contenu({ type: 'tournees' })], tournees: [] });
      expect((await get(`${PATH}/playlist`)).body.elements).toEqual([]);
    });
  });

  describe('vak_live', () => {
    test('VAK active : libellé, poids cumulé et objectif', async () => {
      installMocks({
        contenus: [contenu({ type: 'vak_live' })],
        vak: { id: 3, libelle: 'VAK août', poids_objectif_kg: '2000', ca_objectif_ttc: '8000' },
        vakCompteurs: { poids: 1234.56, ca: 4321.5, tickets: 87 },
      });
      const el = (await get(`${PATH}/playlist`)).body.elements[0];
      expect(el.vak).toEqual({
        libelle: 'VAK août', poids_kg: 1234.6, objectif_poids_kg: 2000,
        ca_ttc: 4321.5, objectif_ca_ttc: 8000, tickets: 87,
      });
    });

    test('les compteurs respectent le PÉRIMÈTRE DE CAISSE du module VAK', async () => {
      installMocks({ contenus: [contenu({ type: 'vak_live' })], vak: { id: 3, libelle: 'VAK' } });
      await get(`${PATH}/playlist`);
      const sql = mockQuery.mock.calls.map((c) => String(c[0])).find((x) => /FROM vak_tickets/.test(x));
      expect(sql).toMatch(/compte_caisse/); // prédicat partagé sqlPerimetreCaisse
    });

    test('pas de VAK aujourd\'hui → élément OMIS', async () => {
      installMocks({ contenus: [contenu({ type: 'vak_live' })], vak: null });
      expect((await get(`${PATH}/playlist`)).body.elements).toEqual([]);
    });
  });

  describe('actus', () => {
    test('titre, résumé et source ; les épinglées d\'abord', async () => {
      installMocks({
        contenus: [contenu({ type: 'actus' })],
        news: [{ title: 'Refashion 2026', summary: 'Nouveaux barèmes', source_name: 'Refashion' }],
      });
      const r = await get(`${PATH}/playlist`);
      expect(r.body.elements[0].actus).toEqual([
        { titre: 'Refashion 2026', resume: 'Nouveaux barèmes', source: 'Refashion' },
      ]);
      const sql = mockQuery.mock.calls.map((c) => String(c[0])).find((x) => /FROM news_articles/.test(x));
      expect(sql).toMatch(/is_pinned DESC/);
    });

    test('le nombre de brèves vient de la config JSONB du contenu (défaut 3)', async () => {
      installMocks({
        contenus: [contenu({ type: 'actus', config: { nb_actus: 7 } })],
        news: [{ title: 'A', summary: null, source_name: null }],
      });
      await get(`${PATH}/playlist`);
      const appel = mockQuery.mock.calls.find((c) => /FROM news_articles/.test(String(c[0])));
      expect(appel[1]).toEqual([7]);
    });

    test('aucune brève → élément OMIS', async () => {
      installMocks({ contenus: [contenu({ type: 'actus' })], news: [] });
      expect((await get(`${PATH}/playlist`)).body.elements).toEqual([]);
    });
  });

  describe('médias et posts sociaux', () => {
    test('un contenu `media` référence son binaire par media_id préfixé « c »', async () => {
      installMocks({
        contenus: [contenu({ id: 12, type: 'media', fichier: 'media-1.jpg', media_type: 'image', media_sha256: 'ab'.repeat(32) })],
      });
      const el = (await get(`${PATH}/playlist`)).body.elements[0];
      expect(el).toMatchObject({ type: 'media', media_id: 'c12', media_type: 'image', media_sha256: 'ab'.repeat(32) });
      // Le chemin de fichier serveur ne part JAMAIS vers le poste.
      expect(JSON.stringify(el)).not.toContain('media-1.jpg');
    });

    test('un `lien` rapatrié est servi comme un média local (le poste ne fetch rien)', async () => {
      installMocks({
        contenus: [contenu({ id: 13, type: 'lien', fichier: 'lien-1.mp4', media_type: 'video' })],
      });
      const el = (await get(`${PATH}/playlist`)).body.elements[0];
      expect(el.type).toBe('media');
      expect(el.media_id).toBe('c13');
      expect(el.media_type).toBe('video');
    });

    test('un média sans fichier est OMIS (élément muet plutôt qu\'écran noir)', async () => {
      installMocks({ contenus: [contenu({ id: 14, type: 'media', fichier: null })] });
      expect((await get(`${PATH}/playlist`)).body.elements).toEqual([]);
    });

    test('les posts sociaux sont référencés par media_id préfixé « s »', async () => {
      installMocks({
        contenus: [contenu({ type: 'social', config: { nb_posts: 2 } })],
        social: [{ id: 9, reseau: 'instagram', compte: 'fripandcorouen', legende: 'Nouvelle collection', media_sha256: 'cd'.repeat(32), publie_le: '2026-08-10T10:00:00Z' }],
      });
      const el = (await get(`${PATH}/playlist`)).body.elements[0];
      expect(el.posts[0]).toMatchObject({ media_id: 's9', media_type: 'image', reseau: 'instagram' });
      const appel = mockQuery.mock.calls.find((c) => /FROM badgeuse_social_posts/.test(String(c[0])));
      expect(appel[1]).toEqual([2]);
    });

    test('aucun post → élément OMIS', async () => {
      installMocks({ contenus: [contenu({ type: 'social' })], social: [] });
      expect((await get(`${PATH}/playlist`)).body.elements).toEqual([]);
    });
  });

  test('un générateur en panne n\'efface pas le reste de la playlist', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    installMocks({
      contenus: [contenu({ id: 1, type: 'tournees' }), contenu({ id: 2, type: 'message', corps: 'Consigne' })],
      erreurs: ['FROM tours t'],
    });
    const r = await get(`${PATH}/playlist`);
    expect(r.status).toBe(200);
    expect(r.body.elements.map((e) => e.id)).toEqual([2]);
    expect(err.mock.calls.flat().join(' ')).toMatch(/Générateur/);
    err.mockRestore();
  });

  test('AUCUN nom de famille ne peut apparaître dans une playlist complète', async () => {
    installMocks({
      contenus: [contenu({ id: 1, type: 'annonces' }), contenu({ id: 2, type: 'tournees' })],
      employesFestifs: [{ first_name: 'Sonia', last_name: 'Dupont', anniversaire: true, annees: null }],
      tournees: [{ id: 4, status: 'in_progress', collection_type: 'cav', vehicule_nom: 'Master', registration: null, total: '3', faits: '1' }],
    });
    const charge = JSON.stringify((await get(`${PATH}/playlist`)).body);
    expect(charge).not.toContain('Dupont');
    expect(charge).not.toMatch(/driver|chauffeur|last_name/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /media/:id — diffusion binaire
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /media/:id', () => {
  const FICHIER = 'test-affichage-v2.png';
  const FICHIER_SOCIAL = `${media.SOCIAL_SUBDIR}/test-affichage-v2.jpg`;

  beforeAll(() => {
    media.ensureMediaDir();
    media.ensureMediaDir(media.SOCIAL_SUBDIR);
    fs.writeFileSync(path.join(media.mediaRoot(), FICHIER), Buffer.from('89504e470d0a1a0a', 'hex'));
    fs.writeFileSync(path.join(media.mediaRoot(), FICHIER_SOCIAL), Buffer.from('ffd8ffe0', 'hex'));
  });
  afterAll(() => {
    try { fs.unlinkSync(path.join(media.mediaRoot(), FICHIER)); } catch (_) { /* déjà nettoyé */ }
    try { fs.unlinkSync(path.join(media.mediaRoot(), FICHIER_SOCIAL)); } catch (_) { /* déjà nettoyé */ }
  });

  test('sans clé device → 401 (le média n\'est pas public)', async () => {
    expect((await get(`${PATH}/media/c1`, null)).status).toBe(401);
  });

  test('contenu de playlist : flux servi avec un Content-Type de LISTE BLANCHE', async () => {
    installMocks({ contenuFichier: FICHIER });
    const r = await get(`${PATH}/media/c1`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    // Le navigateur du kiosque n'a pas le droit de réinterpréter le fichier.
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  test('post social : même route, préfixe « s »', async () => {
    installMocks({ socialFichier: FICHIER_SOCIAL });
    const r = await get(`${PATH}/media/s9`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/jpeg');
    const sql = mockQuery.mock.calls.map((c) => String(c[0])).find((x) => /badgeuse_social_posts/.test(x));
    expect(sql).toMatch(/media_fichier AS fichier/);
  });

  test('identifiant inconnu → 404', async () => {
    installMocks({ contenuFichier: undefined });
    expect((await get(`${PATH}/media/c404`)).status).toBe(404);
  });

  test('identifiant malformé (sans préfixe) → 404, sans requête base', async () => {
    const r = await get(`${PATH}/media/12`);
    expect(r.status).toBe(404);
    expect(mockQuery.mock.calls.some((c) => /badgeuse_contenus/.test(String(c[0])))).toBe(false);
  });

  test('TRAVERSÉE DE CHEMIN : un « ../ » stocké en base ne sort jamais de la racine', async () => {
    installMocks({ contenuFichier: '../../src/index.js' });
    expect((await get(`${PATH}/media/c1`)).status).toBe(404);
  });

  test('chemin ABSOLU en base → refusé', async () => {
    installMocks({ contenuFichier: '/etc/passwd' });
    expect((await get(`${PATH}/media/c1`)).status).toBe(404);
  });

  test('extension hors liste blanche → 404 (jamais servi, même si le fichier existe)', async () => {
    const script = path.join(media.mediaRoot(), 'test-affichage-v2.svg');
    fs.writeFileSync(script, '<svg onload="alert(1)"></svg>');
    try {
      installMocks({ contenuFichier: 'test-affichage-v2.svg' });
      expect((await get(`${PATH}/media/c1`)).status).toBe(404);
    } finally {
      try { fs.unlinkSync(script); } catch (_) { /* déjà nettoyé */ }
    }
  });

  test('référence en base sans fichier sur le disque → 404 (jamais un 500)', async () => {
    installMocks({ contenuFichier: 'media-inexistant-987654.png' });
    expect((await get(`${PATH}/media/c1`)).status).toBe(404);
  });
});

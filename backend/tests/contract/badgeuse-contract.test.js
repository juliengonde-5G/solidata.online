// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — MODULE 33 « TEMPS & PRÉSENCE » (badgeuse)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la MATRICE D'HABILITATIONS et la forme des réponses de
// routes/badgeuse.js (le frontend consomme ce contrat tel quel) :
//   - lecture ADMIN/RH/MANAGER, écriture ADMIN/RH, administration des postes ADMIN ;
//   - COLLABORATEUR : refusé partout SAUF /mes-pointages (droit d'accès art. 15) ;
//   - garde-fous RH : 403 sur l'autocorrection d'un encadrant, 409 sur une
//     correction visant une période déjà validée RH, 400 si le motif « autre »
//     arrive sans précision ;
//   - exports : 409 tant que des feuilles ne sont pas validées, journalisation ;
//   - marqueur d'arbitrage des règles (ADR-0002) exposé par GET /parametres.
//
// Auth réelle (JWT sans `tv` → aucune lecture base), DB mockée, activity-logger
// mocké. Même harnais que effectifs-contract.test.js.
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

const express = require('express');
const request = require('supertest');

const badgeuse = require('../../src/routes/badgeuse');

const tokenFor = (role, id = 1) => jwt.sign(
  { id, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER'),
  COLLABORATEUR: tokenFor('COLLABORATEUR'), QHSE: tokenFor('QHSE'),
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/badgeuse', badgeuse);
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (path, role, body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const put = (path, role, body = {}) => request(app).put(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const patch = (path, role, body = {}) => request(app).patch(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const del = (path, role) => request(app).delete(path).set('Authorization', `Bearer ${TOKENS[role]}`);

/** Mock DB par motif SQL. `settings` est mutable (les PUT y écrivent). */
function installMocks({
  settings = {}, employee = { id: 5, user_id: 99 }, feuille = null,
  pointages = [], corrections = [], badges = [], devices = [], contenus = [],
  contrats = [],
} = {}) {
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(s)) return Promise.resolve({ rows: [] });
    // Heures hebdo contractuelles (QA-03) : le contrat couvrant le 1er du mois.
    if (/FROM employee_contracts ec/.test(s)) return Promise.resolve({ rows: contrats });
    if (/SELECT key, value FROM settings WHERE key LIKE/.test(s)) {
      return Promise.resolve({ rows: Object.entries(settings).map(([key, value]) => ({ key, value })) });
    }
    if (/SELECT key, value FROM settings WHERE key IN/.test(s)) {
      return Promise.resolve({
        rows: Object.entries(settings)
          .filter(([k]) => params.includes(k)).map(([key, value]) => ({ key, value })),
      });
    }
    if (/SELECT value FROM settings/.test(s)) {
      const key = params && params[0];
      return Promise.resolve({ rows: settings[key] != null ? [{ value: settings[key] }] : [] });
    }
    if (/INSERT INTO settings/.test(s)) { settings[params[0]] = params[1]; return Promise.resolve({ rows: [] }); }
    if (/FROM employees WHERE id/.test(s) || /SELECT id, user_id FROM employees/.test(s)) {
      return Promise.resolve({ rows: employee ? [employee] : [] });
    }
    if (/FROM employees WHERE user_id/.test(s)) return Promise.resolve({ rows: employee ? [employee] : [] });
    if (/SELECT statut FROM badgeuse_feuilles_temps/.test(s)) {
      return Promise.resolve({ rows: feuille ? [feuille] : [] });
    }
    if (/FROM badgeuse_feuilles_temps/.test(s)) return Promise.resolve({ rows: feuille ? [feuille] : [] });
    if (/INSERT INTO badgeuse_feuilles_temps/.test(s)) {
      return Promise.resolve({ rows: [{ id: 1, employee_id: 5, periode: '2026-08', statut: 'brouillon' }] });
    }
    if (/FROM badgeuse_pointages/.test(s)) return Promise.resolve({ rows: pointages });
    if (/INSERT INTO badgeuse_corrections/.test(s)) {
      return Promise.resolve({ rows: [{ id: 1, employee_id: 5, type: params[2], motif_code: params[5] }] });
    }
    if (/FROM badgeuse_corrections/.test(s)) return Promise.resolve({ rows: corrections });
    if (/FROM badgeuse_badges b/.test(s)) return Promise.resolve({ rows: badges });
    if (/INSERT INTO badgeuse_badges/.test(s)) return Promise.resolve({ rows: [{ id: 1, employee_id: 5, statut: 'actif' }] });
    if (/FROM badgeuse_devices d/.test(s)) return Promise.resolve({ rows: devices });
    if (/INSERT INTO badgeuse_devices/.test(s)) {
      return Promise.resolve({ rows: [{ id: 1, code: params[0], site_id: params[2], actif: true }] });
    }
    if (/FROM badgeuse_contenus/.test(s)) return Promise.resolve({ rows: contenus });
    if (/INSERT INTO badgeuse_contenus/.test(s)) return Promise.resolve({ rows: [{ id: 1, type: 'message' }] });
    if (/FROM badgeuse_sites/.test(s)) return Promise.resolve({ rows: [{ id: 1, code: 'LH', libelle: 'Le Houlme — atelier', actif: true }] });
    if (/INSERT INTO rgpd_audit_log/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockClear();
  installMocks();
});

/** Requêtes rgpd_audit_log effectivement émises (action → détails). */
const auditCalls = () => mockQuery.mock.calls
  .filter((c) => /INSERT INTO rgpd_audit_log/.test(String(c[0])))
  .map((c) => ({ action: c[1][1], entity: c[1][2], details: JSON.parse(c[1][4] || '{}') }));

// ═══════════════════════════════════════════════════════════════════════════
describe('matrice d\'habilitations (BO-11)', () => {
  test('LECTURE ouverte à ADMIN / RH / MANAGER', async () => {
    for (const role of ['ADMIN', 'RH', 'MANAGER']) {
      expect((await get('/api/badgeuse/pointages', role)).status).toBe(200);
      expect((await get('/api/badgeuse/parametres', role)).status).toBe(200);
      expect((await get('/api/badgeuse/badges', role)).status).toBe(200);
      expect((await get('/api/badgeuse/orphelins', role)).status).toBe(200);
      expect((await get('/api/badgeuse/devices', role)).status).toBe(200);
    }
  });

  test('COLLABORATEUR : 403 sur /pointages et les autres lectures RH', async () => {
    expect((await get('/api/badgeuse/pointages', 'COLLABORATEUR')).status).toBe(403);
    expect((await get('/api/badgeuse/badges', 'COLLABORATEUR')).status).toBe(403);
    expect((await get('/api/badgeuse/orphelins', 'COLLABORATEUR')).status).toBe(403);
    expect((await get('/api/badgeuse/anomalies?du=2026-08-01&au=2026-08-31', 'COLLABORATEUR')).status).toBe(403);
    expect((await get('/api/badgeuse/salaries/5/releve?periode=2026-08', 'COLLABORATEUR')).status).toBe(403);
  });

  test('QHSE (rôle hors périmètre) : 403 en lecture', async () => {
    expect((await get('/api/badgeuse/pointages', 'QHSE')).status).toBe(403);
  });

  test('ÉCRITURES réservées à ADMIN/RH — MANAGER et COLLABORATEUR refusés', async () => {
    for (const role of ['MANAGER', 'COLLABORATEUR']) {
      expect((await put('/api/badgeuse/parametres', role, { arrondi_minutes: 15 })).status).toBe(403);
      expect((await post('/api/badgeuse/badges', role, { employee_id: 5, uid_hmac: 'a'.repeat(64) })).status).toBe(403);
      expect((await patch('/api/badgeuse/badges/1', role, { statut: 'perdu' })).status).toBe(403);
      expect((await post('/api/badgeuse/orphelins/1/rattacher', role, { employee_id: 5 })).status).toBe(403);
      expect((await post('/api/badgeuse/contenus', role, { type: 'message' })).status).toBe(403);
    }
  });

  test('ADMINISTRATION DES POSTES réservée à ADMIN (RH et MANAGER refusés)', async () => {
    for (const role of ['RH', 'MANAGER', 'COLLABORATEUR']) {
      expect((await post('/api/badgeuse/devices', role, { code: 'LH-P2' })).status).toBe(403);
      expect((await post('/api/badgeuse/devices/1/regenerate-key', role)).status).toBe(403);
      expect((await patch('/api/badgeuse/devices/1', role, { actif: false })).status).toBe(403);
    }
  });

  test('DÉVALIDATION d\'une feuille : ADMIN uniquement', async () => {
    expect((await del('/api/badgeuse/feuilles-temps/5/validation?periode=2026-08', 'RH')).status).toBe(403);
    expect((await del('/api/badgeuse/feuilles-temps/5/validation?periode=2026-08', 'MANAGER')).status).toBe(403);
  });

  test('EXPORTS réservés à ADMIN/RH', async () => {
    for (const role of ['MANAGER', 'COLLABORATEUR']) {
      expect((await get('/api/badgeuse/exports/paie?periode=2026-08', role)).status).toBe(403);
      expect((await get('/api/badgeuse/exports/iae?periode=2026-08', role)).status).toBe(403);
    }
  });

  test('CORRECTIONS ouvertes au MANAGER (c\'est lui qui régularise, NOTE_RH §5.1)', async () => {
    const r = await post('/api/badgeuse/corrections', 'MANAGER', {
      employee_id: 5, type: 'ajout', horodatage_corrige: '2026-08-17T06:00:00Z',
      sens_corrige: 'entree', motif_code: 'oubli_badge',
    });
    expect(r.status).toBe(201);
    expect((await post('/api/badgeuse/corrections', 'COLLABORATEUR', {})).status).toBe(403);
  });

  test('/mes-pointages est accessible à TOUT rôle authentifié (droit d\'accès art. 15)', async () => {
    installMocks({ employee: { id: 5, user_id: 1, first_name: 'A', last_name: 'B' } });
    for (const role of ['COLLABORATEUR', 'MANAGER', 'RH', 'ADMIN', 'QHSE']) {
      const r = await get('/api/badgeuse/mes-pointages?periode=2026-08', role);
      expect(r.status).toBe(200);
      expect(r.body).toHaveProperty('heures_pointees');
    }
  });

  test('sans jeton : 401 partout', async () => {
    expect((await request(app).get('/api/badgeuse/pointages')).status).toBe(401);
    expect((await request(app).get('/api/badgeuse/mes-pointages')).status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET/PUT /parametres — grille et marqueur d\'arbitrage (ADR-0002)', () => {
  test('les DÉFAUTS sont les recommandations RH écrites, et l\'état non arbitré est visible', async () => {
    const r = await get('/api/badgeuse/parametres');
    expect(r.status).toBe(200);
    expect(r.body.parametres).toMatchObject({
      pointages_par_jour: 4,
      arrondi_minutes: 5,
      arrondi_sens: 'avantage_salarie',
      tolerance_retard_minutes: 5,
      badge_avant_heure_compte: false,
      pause_deduite_minutes: 45,
      pause_deduite_seuil_heures: 6,
      journee_max_heures: 10,
      plage_acceptation_debut: '05:00',
      plage_acceptation_fin: '21:00',
      affichage_cumul_hebdo: false,
    });
    // Tant que la Direction n'a pas arbitré : jamais silencieux.
    expect(r.body.regles_validees).toEqual({ validees: false, le: null, par: null });
    expect(r.body.motifs_correction).toEqual([
      'oubli_badge', 'badge_defaillant', 'mission_exterieure', 'rdv_accompagnement', 'formation', 'autre',
    ]);
    // Les durées de conservation (NOTE_JURIDIQUE §3.7) sont exposées elles aussi.
    // NB : accès par crochets — le point est un séparateur de chemin pour Jest.
    expect(r.body.defauts['badgeuse.retention_pointages_mois']).toBe(60);
    expect(r.body.defauts['badgeuse.retention_badges_apres_restitution_jours']).toBe(90);
    expect(r.body.defauts['badgeuse.retention_journal_acces_mois']).toBe(12);
  });

  test('PUT enregistre la grille ET pose le marqueur d\'arbitrage', async () => {
    const settings = {};
    installMocks({ settings });
    const r = await put('/api/badgeuse/parametres', 'RH', { arrondi_minutes: 15, journee_max_heures: 9 });
    expect(r.status).toBe(200);
    expect(settings['badgeuse.arrondi_minutes']).toBe('15');
    expect(settings['badgeuse.journee_max_heures']).toBe('9');
    expect(settings['badgeuse.regles_validees_le']).toBeTruthy();
    expect(settings['badgeuse.regles_validees_par']).toBe('1');
    expect(r.body.regles_validees.validees).toBe(true);
  });

  test('une clé hors dictionnaire est ignorée (aucune règle « fantôme »)', async () => {
    const settings = {};
    installMocks({ settings });
    const r = await put('/api/badgeuse/parametres', 'ADMIN', { regle_inventee: 42 });
    expect(r.status).toBe(400);
    expect(settings['badgeuse.regle_inventee']).toBeUndefined();
  });

  test('les valeurs enregistrées prennent le pas sur les défauts', async () => {
    installMocks({ settings: { 'badgeuse.pause_deduite_minutes': '30', 'badgeuse.regles_validees_le': '2026-08-15T10:00:00Z' } });
    const r = await get('/api/badgeuse/parametres');
    expect(r.body.parametres.pause_deduite_minutes).toBe(30);
    expect(r.body.regles_validees.validees).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('POST /corrections — verrous RH', () => {
  test('403 : un encadrant ne corrige pas SES PROPRES pointages', async () => {
    // employees.user_id = 1 = l'utilisateur connecté.
    installMocks({ employee: { id: 5, user_id: 1 } });
    const r = await post('/api/badgeuse/corrections', 'MANAGER', {
      employee_id: 5, type: 'ajout', horodatage_corrige: '2026-08-17T06:00:00Z',
      sens_corrige: 'entree', motif_code: 'oubli_badge',
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/vos propres pointages/i);
  });

  test('409 : aucune correction sur une période déjà validée RH', async () => {
    installMocks({ employee: { id: 5, user_id: 99 }, feuille: { statut: 'validee_rh' } });
    const r = await post('/api/badgeuse/corrections', 'RH', {
      employee_id: 5, type: 'ajout', horodatage_corrige: '2026-08-17T06:00:00Z',
      sens_corrige: 'entree', motif_code: 'oubli_badge',
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/2026-08/);
  });

  test('une feuille en brouillon ou validée ENCADRANT reste corrigeable', async () => {
    for (const statut of ['brouillon', 'validee_encadrant']) {
      installMocks({ employee: { id: 5, user_id: 99 }, feuille: { statut } });
      const r = await post('/api/badgeuse/corrections', 'RH', {
        employee_id: 5, type: 'ajout', horodatage_corrige: '2026-08-17T06:00:00Z',
        sens_corrige: 'entree', motif_code: 'oubli_badge',
      });
      expect(r.status).toBe(201);
    }
  });

  test('400 : motif « autre » sans précision', async () => {
    const r = await post('/api/badgeuse/corrections', 'RH', {
      employee_id: 5, type: 'ajout', horodatage_corrige: '2026-08-17T06:00:00Z',
      sens_corrige: 'entree', motif_code: 'autre',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/autre/);
  });

  test('400 : une précision sur un motif codé (le champ libre reste proscrit)', async () => {
    const r = await post('/api/badgeuse/corrections', 'RH', {
      employee_id: 5, type: 'ajout', horodatage_corrige: '2026-08-17T06:00:00Z',
      sens_corrige: 'entree', motif_code: 'formation', motif_detail: 'commentaire libre',
    });
    expect(r.status).toBe(400);
  });

  test('motif « autre » AVEC précision : accepté', async () => {
    const r = await post('/api/badgeuse/corrections', 'RH', {
      employee_id: 5, type: 'ajout', horodatage_corrige: '2026-08-17T06:00:00Z',
      sens_corrige: 'entree', motif_code: 'autre', motif_detail: 'Panne du poste signalée par l\'encadrant',
    });
    expect(r.status).toBe(201);
  });

  test('400 : motif hors liste fermée', async () => {
    const r = await post('/api/badgeuse/corrections', 'RH', {
      employee_id: 5, type: 'ajout', horodatage_corrige: '2026-08-17T06:00:00Z',
      sens_corrige: 'entree', motif_code: 'parce_que',
    });
    expect(r.status).toBe(400);
  });

  test('400 : champs requis manquants selon le type de correction', async () => {
    expect((await post('/api/badgeuse/corrections', 'RH',
      { employee_id: 5, type: 'ajout', motif_code: 'oubli_badge' })).status).toBe(400);
    expect((await post('/api/badgeuse/corrections', 'RH',
      { employee_id: 5, type: 'annulation', motif_code: 'oubli_badge' })).status).toBe(400);
  });

  test('la correction est ADDITIVE : aucun UPDATE/DELETE sur badgeuse_pointages', async () => {
    await post('/api/badgeuse/corrections', 'RH', {
      employee_id: 5, type: 'modification', pointage_id: 3,
      horodatage_corrige: '2026-08-17T06:00:00Z', motif_code: 'oubli_badge',
    });
    const sqls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO badgeuse_corrections/.test(s))).toBe(true);
    expect(sqls.some((s) => /UPDATE badgeuse_pointages/.test(s))).toBe(false);
    expect(sqls.some((s) => /DELETE FROM badgeuse_pointages/.test(s))).toBe(false);
  });

  // ══ QA-05 — `regularisation_delai_jours` produit enfin un effet ══
  describe('QA-05 — délai de signalement (ADR-0002 addendum §4)', () => {
    /** Correction portant sur une date donnée (heure murale Paris). */
    const corriger = (dateISO, extra = {}) => post('/api/badgeuse/corrections', 'RH', {
      employee_id: 5, type: 'ajout', horodatage_corrige: `${dateISO}T08:00:00`,
      sens_corrige: 'entree', motif_code: 'oubli_badge', ...extra,
    });

    /** Date civile Paris décalée de N jours (N négatif = dans le passé). */
    const jourDecale = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' })
      .format(new Date(Date.now() + n * 24 * 3600 * 1000));

    test('une régularisation du jour ne porte AUCUN avertissement', async () => {
      const r = await corriger(jourDecale(0));
      expect(r.status).toBe(201);
      expect(r.body.avertissement).toBeNull();
      expect(r.body.regularisation_delai_jours).toBe(5);
    });

    test('au-delà du délai, la réponse porte « hors_delai_signalement »', async () => {
      // 60 jours calendaires en arrière : bien plus de 5 jours OUVRÉS.
      const r = await corriger(jourDecale(-60));
      expect(r.status).toBe(201);
      expect(r.body.avertissement).toBe('hors_delai_signalement');
      expect(r.body.jours_ouvres_ecoules).toBeGreaterThan(5);
    });

    test('l\'avertissement est NON BLOQUANT : la correction est bien enregistrée', async () => {
      await corriger(jourDecale(-60));
      expect(mockQuery.mock.calls.map((c) => String(c[0]))
        .some((s) => /INSERT INTO badgeuse_corrections/.test(s))).toBe(true);
    });

    test('le délai vient du PARAMÈTRE, jamais du code', async () => {
      // Délai porté à 999 jours ouvrés : la même correction repasse dans les clous.
      installMocks({ settings: { 'badgeuse.regularisation_delai_jours': '999' } });
      const large = await corriger(jourDecale(-60));
      expect(large.body.avertissement).toBeNull();
      expect(large.body.regularisation_delai_jours).toBe(999);
      // Délai à 0 = règle désactivée : aucun avertissement non plus.
      installMocks({ settings: { 'badgeuse.regularisation_delai_jours': '0' } });
      expect((await corriger(jourDecale(-60))).body.avertissement).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('forme des réponses des endpoints principaux', () => {
  test('GET /pointages : enveloppe paginée + indicateur d\'anomalie par ligne', async () => {
    installMocks({
      pointages: [{
        id: '10', uuid: 'u1', employee_id: 5, device_id: 1, horodatage_utc: '2026-08-17T06:00:00Z',
        horodatage_local: '2026-08-17T08:00:00', sens: 'entree', source: 'badge', statut: 'orphelin',
        orphelin_raison: 'hors_plage', sequence_device: '42', chaine_valide: true,
        recu_le: '2026-08-17T06:00:01Z', first_name: 'Karim', last_name: 'Benali',
        malibou_id: 'M42', device_code: 'LH-P1', total: '1',
      }],
    });
    const r = await get('/api/badgeuse/pointages');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 1, limit: 100, offset: 0 });
    expect(r.body.pointages[0]).toMatchObject({
      id: 10, employee_id: 5, nom: 'BENALI Karim', matricule: 'M42',
      device_code: 'LH-P1', sens: 'entree', statut: 'orphelin',
      orphelin_raison: 'hors_plage', sequence_device: 42, anomalie: true,
    });
  });

  test('GET /pointages : une chaîne rompue lève aussi l\'indicateur d\'anomalie', async () => {
    installMocks({
      pointages: [{ id: '11', uuid: 'u2', employee_id: 5, statut: 'brut', chaine_valide: false, sequence_device: '1', total: '1' }],
    });
    const r = await get('/api/badgeuse/pointages');
    expect(r.body.pointages[0].anomalie).toBe(true);
    expect(r.body.pointages[0].chaine_valide).toBe(false);
  });

  test('GET /orphelins : liste des pointages non rattachés', async () => {
    installMocks({
      pointages: [{ id: '12', uuid: 'u3', uid_hmac: 'a'.repeat(64), horodatage_utc: '2026-08-17T06:00:00Z', sens: 'inconnu', orphelin_raison: 'badge_inconnu', device_code: 'LH-P1' }],
    });
    const r = await get('/api/badgeuse/orphelins');
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ id: 12, orphelin_raison: 'badge_inconnu' });
  });

  test('GET /anomalies : enveloppe { du, au, total, anomalies }', async () => {
    const r = await get('/api/badgeuse/anomalies?du=2026-08-01&au=2026-08-31');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ du: '2026-08-01', au: '2026-08-31', total: expect.any(Number) });
    expect(Array.isArray(r.body.anomalies)).toBe(true);
  });

  test('GET /anomalies : bornes obligatoires', async () => {
    expect((await get('/api/badgeuse/anomalies')).status).toBe(400);
    expect((await get('/api/badgeuse/anomalies?du=2026-08-01')).status).toBe(400);
  });

  test('QA-05 : GET /anomalies restitue le taux de pointages complets (NOTE_RH §9)', async () => {
    const r = await get('/api/badgeuse/anomalies?du=2026-08-01&au=2026-08-31');
    expect(r.body).toHaveProperty('taux_pointages_complets_pct');
    expect(r.body).toHaveProperty('jours_pointage_attendu');
    // Aucun salarié pointé sur la fenêtre → null, JAMAIS 0 %.
    expect(r.body.taux_pointages_complets_pct).toBeNull();
  });

  test('GET /devices : enveloppe { silence_minutes, devices } et « online » sur la fraîcheur du heartbeat', async () => {
    installMocks({
      devices: [
        { id: 1, code: 'LH-P1', actif: true, dernier_heartbeat: new Date().toISOString(), appaire: true },
        { id: 2, code: 'LH-P2', actif: true, dernier_heartbeat: new Date(Date.now() - 3600 * 1000).toISOString(), appaire: true },
        { id: 3, code: 'LH-P3', actif: true, dernier_heartbeat: null, appaire: false },
      ],
    });
    const r = await get('/api/badgeuse/devices');
    // Le seuil « en ligne » est PARAMÉTRÉ (QA-11) : il est exposé pour que la
    // supervision affiche la même vérité que le job d'alerte.
    expect(r.body.silence_minutes).toBe(15);
    expect(r.body.devices.map((d) => d.online)).toEqual([true, false, false]);
    // Le condensat de la clé n'est JAMAIS exposé, même à l'ADMIN.
    expect(JSON.stringify(r.body)).not.toContain('api_key_hash');
  });

  test('QA-11 : le seuil « en ligne » suit le paramètre (plus de 5 min en dur)', async () => {
    installMocks({
      settings: { 'badgeuse.supervision_silence_minutes': '120' },
      devices: [
        // Silencieux depuis 1 h : hors ligne à 15 min, EN LIGNE à 120 min.
        { id: 2, code: 'LH-P2', actif: true, dernier_heartbeat: new Date(Date.now() - 3600 * 1000).toISOString(), appaire: true },
      ],
    });
    const r = await get('/api/badgeuse/devices');
    expect(r.body.silence_minutes).toBe(120);
    expect(r.body.devices[0].online).toBe(true);
  });

  test('QA-02 : l\'alerte remontée par le poste est exposée à la supervision', async () => {
    installMocks({
      devices: [{
        id: 1, code: 'LH-P1', actif: true, dernier_heartbeat: new Date().toISOString(), appaire: true,
        heartbeat_info: { version: '1.0.0', alerte: '3 pointage(s) refusés définitivement' },
      }],
    });
    const r = await get('/api/badgeuse/devices');
    expect(r.body.devices[0].alerte).toBe('3 pointage(s) refusés définitivement');
  });

  test('sans alerte du poste, le champ vaut null (jamais une chaîne vide trompeuse)', async () => {
    installMocks({
      devices: [{ id: 1, code: 'LH-P1', actif: true, dernier_heartbeat: null, appaire: true, heartbeat_info: { version: '1.0.0' } }],
    });
    expect((await get('/api/badgeuse/devices')).body.devices[0].alerte).toBeNull();
  });

  test('GET /feuilles-temps : période obligatoire, enveloppe { periode, feuilles }', async () => {
    expect((await get('/api/badgeuse/feuilles-temps')).status).toBe(400);
    const r = await get('/api/badgeuse/feuilles-temps?periode=2026-08');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ periode: '2026-08' });
    expect(Array.isArray(r.body.feuilles)).toBe(true);
  });

  test('GET /sites : référentiel multi-site', async () => {
    const r = await get('/api/badgeuse/sites');
    expect(r.body[0]).toMatchObject({ code: 'LH' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QA-03 — BO-04 : « théorique » et « écart » ne sont plus vides à vie.
// ═══════════════════════════════════════════════════════════════════════════
describe('QA-03 — heures théoriques et écart de la feuille de temps (BO-04)', () => {
  /** Le salarié 5 remonte dans la population de la période. */
  const POPULATION = [{ id: 5, first_name: 'Karim', last_name: 'Benali', malibou_id: 'M42', team_id: 1 }];

  /** Mock complet : population + contrat + insertion de feuille. */
  function mocksFeuille({ contrats = [], weeklyHoursFiche = null, statut = 'brouillon' } = {}) {
    installMocks({ contrats, employee: { id: 5, user_id: 99, weekly_hours: weeklyHoursFiche } });
    const base = mockQuery.getMockImplementation();
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/FROM employees e\s+WHERE e\.id IN/.test(s)) return Promise.resolve({ rows: POPULATION });
      if (/INSERT INTO badgeuse_feuilles_temps/.test(s)) {
        // Le RETURNING rend la ligne telle qu'elle vient d'être écrite.
        return Promise.resolve({
          rows: [{
            id: 1, employee_id: 5, periode: params[1], statut,
            heures_theoriques: params[2], heures_pointees: params[3],
          }],
        });
      }
      return base(sql, params);
    });
  }

  test('35 h hebdo au contrat → 147 h théoriques en août 2026 (21 jours ouvrés)', async () => {
    mocksFeuille({ contrats: [{ weekly_hours: 35 }] });
    const r = await get('/api/badgeuse/feuilles-temps?periode=2026-08');
    expect(r.body.feuilles[0].heures_theoriques).toBe(147);
    expect(r.body.feuilles[0].source_theorique).toBe('contrat');
  });

  test('l\'ÉCART théorique/pointé est enfin calculé (raison d\'être de BO-04)', async () => {
    mocksFeuille({ contrats: [{ weekly_hours: 35 }] });
    const f = (await get('/api/badgeuse/feuilles-temps?periode=2026-08')).body.feuilles[0];
    expect(f.ecart_heures).toBe(Number((f.heures_pointees - f.heures_theoriques).toFixed(2)));
    expect(f.ecart_heures).toBe(-147); // aucun pointage sur la période mockée
  });

  test('temps partiel : 26 h hebdo → 109,2 h (la quotité est respectée)', async () => {
    mocksFeuille({ contrats: [{ weekly_hours: 26 }] });
    expect((await get('/api/badgeuse/feuilles-temps?periode=2026-08')).body.feuilles[0].heures_theoriques).toBe(109.2);
  });

  test('REPLI documenté sur la fiche quand aucun contrat ne couvre le 1er du mois', async () => {
    mocksFeuille({ contrats: [], weeklyHoursFiche: 35 });
    const f = (await get('/api/badgeuse/feuilles-temps?periode=2026-08')).body.feuilles[0];
    expect(f.heures_theoriques).toBe(147);
    expect(f.source_theorique).toBe('fiche');
  });

  test('aucune heure connue → théorique ET écart à NULL (jamais 0)', async () => {
    mocksFeuille({ contrats: [], weeklyHoursFiche: null });
    const f = (await get('/api/badgeuse/feuilles-temps?periode=2026-08')).body.feuilles[0];
    expect(f.heures_theoriques).toBeNull();
    expect(f.ecart_heures).toBeNull();
    expect(f.source_theorique).toBeNull();
  });

  test('le théorique est PERSISTÉ en base (colonne heures_theoriques)', async () => {
    mocksFeuille({ contrats: [{ weekly_hours: 35 }] });
    await get('/api/badgeuse/feuilles-temps?periode=2026-08');
    const ins = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_feuilles_temps/.test(String(c[0])));
    expect(String(ins[0])).toMatch(/heures_theoriques/);
    expect(ins[1][2]).toBe(147);
  });

  test('la requête de contrat vise bien le 1er du mois de la période', async () => {
    mocksFeuille({ contrats: [{ weekly_hours: 35 }] });
    await get('/api/badgeuse/feuilles-temps?periode=2026-08');
    const c = mockQuery.mock.calls.find((x) => /FROM employee_contracts ec/.test(String(x[0])));
    expect(c[1]).toEqual([5, '2026-08-01']);
    expect(String(c[0])).toMatch(/start_date <= \$2::date/);
    expect(String(c[0])).toMatch(/end_date IS NULL OR ec\.end_date >= \$2::date/);
  });

  test('QA-05 : le taux de pointages complets accompagne la feuille', async () => {
    mocksFeuille({ contrats: [{ weekly_hours: 35 }] });
    const f = (await get('/api/badgeuse/feuilles-temps?periode=2026-08')).body.feuilles[0];
    expect(f).toHaveProperty('taux_pointages_complets_pct');
    expect(f.taux_pointages_complets_pct).toBeNull(); // aucune journée soumise
  });

  test('une feuille VALIDÉE rend ses chiffres figés, jamais le recalcul', async () => {
    // La ligne existante doit être lue en entier : sur une feuille validée,
    // ce sont ses colonnes qui font foi (heures pointées/théoriques/validées
    // et dates de validation). Une projection partielle les rendait undefined.
    installMocks({
      contrats: [{ weekly_hours: 35 }],
      feuille: {
        id: 1, employee_id: 5, periode: '2026-08', statut: 'validee_rh',
        heures_theoriques: '140.00', heures_pointees: '138.50', heures_validees: '138.50',
        valide_rh_le: '2026-09-02T09:00:00Z', valide_encadrant_le: '2026-09-01T09:00:00Z',
      },
    });
    const base = mockQuery.getMockImplementation();
    mockQuery.mockImplementation((sql, params) => {
      if (/FROM employees e\s+WHERE e\.id IN/.test(String(sql))) return Promise.resolve({ rows: POPULATION });
      return base(sql, params);
    });

    const f = (await get('/api/badgeuse/feuilles-temps?periode=2026-08')).body.feuilles[0];
    expect(f.statut).toBe('validee_rh');
    expect(f.heures_theoriques).toBe(140);       // figé, PAS le recalcul (147)
    expect(f.heures_pointees).toBe(138.5);
    expect(f.heures_validees).toBe(138.5);
    expect(f.ecart_heures).toBe(-1.5);           // dérivé des chiffres qui font foi
    expect(f.valide_rh_le).toBeTruthy();         // la date de validation remonte
  });

  test('la requête de lecture de la feuille existante n\'est pas une projection partielle', async () => {
    mocksFeuille({ contrats: [{ weekly_hours: 35 }] });
    await get('/api/badgeuse/feuilles-temps?periode=2026-08');
    const lecture = mockQuery.mock.calls
      .map((c) => String(c[0]))
      .find((s) => /SELECT .* FROM badgeuse_feuilles_temps WHERE employee_id/.test(s));
    expect(lecture).not.toMatch(/SELECT id, statut FROM badgeuse_feuilles_temps/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('journalisation RGPD (BO-11)', () => {
  test('une consultation INDIVIDUELLE est journalisée', async () => {
    await get('/api/badgeuse/pointages?employee_id=5');
    // La journalisation est best-effort (hors transaction) : on laisse la
    // micro-tâche se résoudre avant d'inspecter.
    await new Promise((r) => setImmediate(r));
    const consultations = auditCalls().filter((a) => a.action === 'BADGEUSE_CONSULTATION');
    expect(consultations.length).toBeGreaterThan(0);
    expect(consultations[0].details).toMatchObject({ employee_id: 5, portee: 'journal_pointages' });
  });

  test('une consultation NON individuelle (liste globale) n\'est pas journalisée', async () => {
    await get('/api/badgeuse/pointages');
    await new Promise((r) => setImmediate(r));
    expect(auditCalls().filter((a) => a.action === 'BADGEUSE_CONSULTATION')).toHaveLength(0);
  });

  test('le relevé individuel est journalisé', async () => {
    installMocks({ employee: { id: 5, user_id: 99, first_name: 'Karim', last_name: 'Benali' } });
    const r = await get('/api/badgeuse/salaries/5/releve?periode=2026-08');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ employee_id: 5, nom: 'BENALI Karim', periode: '2026-08' });
    await new Promise((x) => setImmediate(x));
    expect(auditCalls().some((a) => a.details.portee === 'releve_individuel')).toBe(true);
  });

  test('le rattachement d\'un orphelin est journalisé DANS la transaction', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/UPDATE badgeuse_pointages/.test(s)) {
        return Promise.resolve({ rows: [{ id: '12', uuid: 'u3', horodatage_utc: '2026-08-17T06:00:00Z', sens: 'inconnu', orphelin_raison: 'badge_inconnu' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await post('/api/badgeuse/orphelins/12/rattacher', 'RH', { employee_id: 5 });
    expect(r.status).toBe(200);

    const ordre = mockQuery.mock.calls.map((c) => String(c[0]));
    const iAudit = ordre.findIndex((s) => /INSERT INTO rgpd_audit_log/.test(s));
    const iCommit = ordre.findIndex((s) => /^\s*COMMIT/.test(s));
    expect(iAudit).toBeGreaterThan(-1);
    expect(iAudit).toBeLessThan(iCommit); // journal AVANT le commit
    expect(auditCalls()[0].action).toBe('BADGEUSE_ORPHELIN_RATTACHEMENT');
  });

  test('le rattachement ne touche AUCUN champ couvert par la chaîne d\'intégrité', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/UPDATE badgeuse_pointages/.test(String(sql))) return Promise.resolve({ rows: [{ id: '12' }] });
      return Promise.resolve({ rows: [] });
    });
    await post('/api/badgeuse/orphelins/12/rattacher', 'RH', { employee_id: 5 });
    const upd = mockQuery.mock.calls.map((c) => String(c[0])).find((s) => /UPDATE badgeuse_pointages/.test(s));
    for (const protege of ['uuid', 'horodatage_utc', 'sens', 'source', 'uid_hmac', 'sequence_device', 'hash_courant']) {
      expect(upd).not.toMatch(new RegExp(`${protege}\\s*=`));
    }
    expect(upd).toMatch(/employee_id = \$2/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('validation des feuilles de temps (BO-04)', () => {
  test('la validation RH est refusée au MANAGER (il s\'arrête au niveau encadrant)', async () => {
    const r = await post('/api/badgeuse/feuilles-temps/5/valider', 'MANAGER', { periode: '2026-08', niveau: 'rh' });
    expect(r.status).toBe(403);
  });

  test('la validation ENCADRANT est ouverte au MANAGER', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/INSERT INTO badgeuse_feuilles_temps/.test(s)) return Promise.resolve({ rows: [{ id: 1, statut: 'brouillon', heures_pointees: 0 }] });
      if (/UPDATE badgeuse_feuilles_temps/.test(s)) return Promise.resolve({ rows: [{ id: 1, statut: 'validee_encadrant' }] });
      return Promise.resolve({ rows: [] });
    });
    const r = await post('/api/badgeuse/feuilles-temps/5/valider', 'MANAGER', { periode: '2026-08', niveau: 'encadrant' });
    expect(r.status).toBe(200);
    expect(r.body.statut).toBe('validee_encadrant');
  });

  test('la validation RH est journalisée DANS la transaction', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/INSERT INTO badgeuse_feuilles_temps/.test(s)) return Promise.resolve({ rows: [{ id: 1, statut: 'brouillon', heures_pointees: 0 }] });
      if (/UPDATE badgeuse_feuilles_temps/.test(s)) return Promise.resolve({ rows: [{ id: 1, statut: 'validee_rh' }] });
      return Promise.resolve({ rows: [] });
    });
    const r = await post('/api/badgeuse/feuilles-temps/5/valider', 'RH', { periode: '2026-08', niveau: 'rh' });
    expect(r.status).toBe(200);

    const ordre = mockQuery.mock.calls.map((c) => String(c[0]));
    const iAudit = ordre.findIndex((s) => /INSERT INTO rgpd_audit_log/.test(s));
    expect(iAudit).toBeLessThan(ordre.findIndex((s) => /^\s*COMMIT/.test(s)));
    expect(auditCalls()[0]).toMatchObject({
      action: 'BADGEUSE_FEUILLE_VALIDATION',
      details: { employee_id: 5, periode: '2026-08', niveau: 'rh' },
    });
  });

  test('409 si la feuille est déjà validée RH', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      // La feuille existante est lue en entier (ses chiffres font foi).
      if (/SELECT \* FROM badgeuse_feuilles_temps WHERE employee_id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 1, statut: 'validee_rh', heures_pointees: '120.00' }] });
      }
      if (/UPDATE badgeuse_feuilles_temps/.test(s)) return Promise.resolve({ rows: [] }); // clause statut <> 'validee_rh'
      return Promise.resolve({ rows: [] });
    });
    const r = await post('/api/badgeuse/feuilles-temps/5/valider', 'RH', { periode: '2026-08', niveau: 'rh' });
    expect(r.status).toBe(409);
  });

  test('la validation RH d\'une feuille déjà validée ENCADRANT reprend ses heures (jamais NaN)', async () => {
    // Régression : la ligne existante était lue en `id, statut` seulement, donc
    // `heures_pointees` valait undefined → Number(undefined) = NaN écrit en base.
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT \* FROM badgeuse_feuilles_temps WHERE employee_id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 1, statut: 'validee_encadrant', heures_pointees: '138.50', heures_theoriques: '140.00' }] });
      }
      if (/UPDATE badgeuse_feuilles_temps/.test(s)) {
        return Promise.resolve({ rows: [{ id: 1, statut: 'validee_rh', heures_validees: '138.50' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await post('/api/badgeuse/feuilles-temps/5/valider', 'RH', { periode: '2026-08', niveau: 'rh' });
    expect(r.status).toBe(200);
    const upd = mockQuery.mock.calls.find((c) => /UPDATE badgeuse_feuilles_temps/.test(String(c[0])));
    expect(upd[1][3]).toBe(138.5);
    expect(Number.isNaN(upd[1][3])).toBe(false);
  });

  test('la dévalidation ADMIN est journalisée', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/UPDATE badgeuse_feuilles_temps/.test(String(sql))) return Promise.resolve({ rows: [{ id: 1, statut: 'brouillon' }] });
      return Promise.resolve({ rows: [] });
    });
    const r = await del('/api/badgeuse/feuilles-temps/5/validation?periode=2026-08', 'ADMIN');
    expect(r.status).toBe(200);
    expect(auditCalls()[0].action).toBe('BADGEUSE_FEUILLE_DEVALIDATION');
  });

  test('niveau invalide → 400', async () => {
    expect((await post('/api/badgeuse/feuilles-temps/5/valider', 'RH', { periode: '2026-08', niveau: 'direction' })).status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('exports paie (BO-06) et IAE (BO-07)', () => {
  const FEUILLES = [
    { employee_id: 5, statut: 'validee_rh', heures_validees: '151.50', heures_pointees: '151.50', detail: [{ date: '2026-08-17', minutes: 480 }], first_name: 'Karim', last_name: 'Benali', malibou_id: 'M42' },
    { employee_id: 6, statut: 'brouillon', heures_validees: null, heures_pointees: '120.00', detail: [], first_name: 'Sonia', last_name: 'Dupont', malibou_id: 'M43' },
  ];

  test('409 tant que des feuilles ne sont PAS validées RH, avec la liste des salariés', async () => {
    installMocks({ feuille: null });
    mockQuery.mockImplementation((sql) => {
      if (/FROM badgeuse_feuilles_temps f/.test(String(sql))) return Promise.resolve({ rows: FEUILLES });
      return Promise.resolve({ rows: [] });
    });
    const r = await get('/api/badgeuse/exports/paie?periode=2026-08', 'RH');
    expect(r.status).toBe(409);
    expect(r.body.non_validees).toEqual([{ employee_id: 6, nom: 'DUPONT Sonia', statut: 'brouillon' }]);
    expect(r.body.hint).toMatch(/force=1/);
  });

  test('force=1 : n\'exporte QUE les feuilles validées (CSV `;` + BOM)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM badgeuse_feuilles_temps f/.test(String(sql))) return Promise.resolve({ rows: FEUILLES });
      return Promise.resolve({ rows: [] });
    });
    const r = await get('/api/badgeuse/exports/paie?periode=2026-08&force=1', 'RH');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toMatch(/badgeuse_paie_2026-08\.csv/);
    expect(r.text.charCodeAt(0)).toBe(0xFEFF); // BOM UTF-8
    const lignes = r.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lignes[0]).toBe('matricule;nom;prenom;periode;jours_travailles;heures');
    expect(lignes).toHaveLength(2);                  // en-tête + le seul validé
    expect(lignes[1]).toBe('M42;BENALI;Karim;2026-08;1;151,5'); // décimale FR
    expect(r.text).not.toContain('Sonia');
  });

  test('format « hms » : heures sexagésimales', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM badgeuse_feuilles_temps f/.test(String(sql))) return Promise.resolve({ rows: [FEUILLES[0]] });
      return Promise.resolve({ rows: [] });
    });
    const r = await get('/api/badgeuse/exports/paie?periode=2026-08&heures=hms', 'RH');
    expect(r.text).toContain('151:30');
  });

  test('l\'export paie est journalisé', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM badgeuse_feuilles_temps f/.test(String(sql))) return Promise.resolve({ rows: [FEUILLES[0]] });
      return Promise.resolve({ rows: [] });
    });
    await get('/api/badgeuse/exports/paie?periode=2026-08', 'RH');
    await new Promise((r) => setImmediate(r));
    expect(auditCalls().some((a) => a.action === 'BADGEUSE_EXPORT_PAIE')).toBe(true);
  });

  test('export IAE : salariés en parcours, heures validées, journalisé', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM badgeuse_feuilles_temps f/.test(s)) {
        expect(s).toMatch(/insertion_status = 'en_parcours'/);
        expect(s).toMatch(/statut = 'validee_rh'/);
        return Promise.resolve({ rows: [FEUILLES[0]] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await get('/api/badgeuse/exports/iae?periode=2026-08', 'RH');
    expect(r.status).toBe(200);
    const lignes = r.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lignes[0]).toBe('matricule;nom;prenom;periode;heures_travaillees');
    expect(lignes[1]).toBe('M42;BENALI;Karim;2026-08;151,5');
    await new Promise((x) => setImmediate(x));
    expect(auditCalls().some((a) => a.action === 'BADGEUSE_EXPORT_IAE')).toBe(true);
  });

  test('période obligatoire et bien formée', async () => {
    expect((await get('/api/badgeuse/exports/paie', 'RH')).status).toBe(400);
    expect((await get('/api/badgeuse/exports/paie?periode=aout', 'RH')).status).toBe(400);
    expect((await get('/api/badgeuse/exports/iae?periode=2026', 'RH')).status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('badges (BO-01) et postes (BO-09)', () => {
  test('POST /badges refuse un UID en clair et n\'accepte qu\'un condensat', async () => {
    expect((await post('/api/badgeuse/badges', 'RH', { employee_id: 5, uid_hmac: '04A23B1C' })).status).toBe(400);
    expect((await post('/api/badgeuse/badges', 'RH', { employee_id: 5, uid_hmac: 'a'.repeat(64) })).status).toBe(201);
  });

  test('QA-12 : POST /badges normalise le condensat en MINUSCULES avant stockage', async () => {
    // Le poste et la base doivent porter la même casse, sans quoi un badge
    // légitime deviendrait « orphelin » à la première présentation.
    const majuscules = 'AB'.repeat(32);
    const r = await post('/api/badgeuse/badges', 'RH', { employee_id: 5, uid_hmac: majuscules });
    expect(r.status).toBe(201);
    const ins = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_badges/.test(String(c[0])));
    expect(ins[1][1]).toBe(majuscules.toLowerCase());
  });

  test('un second badge actif pour le même salarié → 409', async () => {
    const err = new Error('unique'); err.code = '23505';
    mockQuery.mockImplementation((sql) => {
      if (/INSERT INTO badgeuse_badges/.test(String(sql))) return Promise.reject(err);
      return Promise.resolve({ rows: [] });
    });
    const r = await post('/api/badgeuse/badges', 'RH', { employee_id: 5, uid_hmac: 'a'.repeat(64) });
    expect(r.status).toBe(409);
  });

  test('PATCH /badges/:id — perte/vol tracés dans l\'historique', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT \* FROM badgeuse_badges WHERE id/.test(s)) return Promise.resolve({ rows: [{ id: 1, statut: 'actif' }] });
      if (/UPDATE badgeuse_badges/.test(s)) return Promise.resolve({ rows: [{ id: 1, statut: 'perdu' }] });
      return Promise.resolve({ rows: [] });
    });
    const r = await patch('/api/badgeuse/badges/1', 'RH', { statut: 'perdu' });
    expect(r.status).toBe(200);
    const hist = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_badge_historique/.test(String(c[0])));
    expect(hist[1]).toContain('perte');
  });

  test('statut de badge hors énumération → 400', async () => {
    expect((await patch('/api/badgeuse/badges/1', 'RH', { statut: 'cassé' })).status).toBe(400);
  });

  test('POST /devices : la clé device est renvoyée UNE SEULE FOIS, seul son condensat est stocké', async () => {
    const r = await post('/api/badgeuse/devices', 'ADMIN', { code: 'LH-P2', site_id: 1 });
    expect(r.status).toBe(201);
    expect(r.body.api_key).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.avertissement).toMatch(/plus jamais/i);

    const ins = mockQuery.mock.calls.find((c) => /INSERT INTO badgeuse_devices/.test(String(c[0])));
    expect(ins[1]).not.toContain(r.body.api_key);        // le clair n'est pas stocké
    expect(ins[1][3]).toMatch(/^[0-9a-f]{64}$/);          // le condensat l'est
    expect(ins[1][3]).not.toBe(r.body.api_key);
  });

  test('POST /devices : la clé HMAC de site est générée puis STOCKÉE CHIFFRÉE', async () => {
    const settings = {};
    installMocks({ settings });
    const r = await post('/api/badgeuse/devices', 'ADMIN', { code: 'LH-P2', site_id: 1 });
    expect(r.body.hmac_key).toMatch(/^[0-9a-f]{64}$/);
    const stockee = settings['badgeuse.hmac_key_site_1'];
    expect(stockee).toMatch(/^v1:/);              // AES-256-GCM
    expect(stockee).not.toContain(r.body.hmac_key); // jamais en clair
  });

  test('POST /devices : si le site a déjà une clé HMAC, elle n\'est ni régénérée ni ré-affichée', async () => {
    installMocks({ settings: { 'badgeuse.hmac_key_site_1': 'v1:deja:chiffree:ici' } });
    const r = await post('/api/badgeuse/devices', 'ADMIN', { code: 'LH-P2', site_id: 1 });
    expect(r.body.hmac_key).toBeNull();
  });

  test('code de poste en doublon → 409', async () => {
    const err = new Error('unique'); err.code = '23505';
    mockQuery.mockImplementation((sql) => {
      if (/INSERT INTO badgeuse_devices/.test(String(sql))) return Promise.reject(err);
      return Promise.resolve({ rows: [] });
    });
    expect((await post('/api/badgeuse/devices', 'ADMIN', { code: 'LH-P1' })).status).toBe(409);
  });

  test('regenerate-key : nouvelle clé montrée une fois, révocation immédiate annoncée', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/UPDATE badgeuse_devices/.test(String(sql))) return Promise.resolve({ rows: [{ id: 1, code: 'LH-P1' }] });
      return Promise.resolve({ rows: [] });
    });
    const r = await post('/api/badgeuse/devices/1/regenerate-key', 'ADMIN');
    expect(r.status).toBe(200);
    expect(r.body.api_key).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.avertissement).toMatch(/révoquée/i);
  });

  test('GET /devices/:id/verify-chain : { ok, total, ruptures } (CONTRAT_INTEGRITE §4)', async () => {
    const { genesisHash, chainHash, canonicalPointage } = require('../../src/utils/badgeuse-crypto');
    const base = {
      uuid: '11111111-2222-4333-8444-555555555555', device_code: 'LH-P1', sequence_device: 1,
      uid_hmac: 'a'.repeat(64), horodatage_utc: '2026-08-17T06:58:12.031Z', sens: 'entree', source: 'badge',
    };
    const hashValide = chainHash(genesisHash('LH-P1'), canonicalPointage(base));

    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT id, code FROM badgeuse_devices/.test(s)) return Promise.resolve({ rows: [{ id: 1, code: 'LH-P1' }] });
      if (/FROM badgeuse_pointages p/.test(s)) {
        return Promise.resolve({
          rows: [{
            uuid: base.uuid, sequence_device: '1', uid_hmac: base.uid_hmac,
            horodatage_utc: base.horodatage_utc, sens: base.sens, source: base.source,
            hash_precedent: genesisHash('LH-P1'), hash_courant: hashValide, chaine_valide: true,
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await get('/api/badgeuse/devices/1/verify-chain');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, total: 1, ruptures: [], device_code: 'LH-P1', ancrage_genese: true });
  });

  test('verify-chain DÉTECTE un horodatage modifié directement en base (exigence A4/A5)', async () => {
    const { genesisHash, chainHash, canonicalPointage } = require('../../src/utils/badgeuse-crypto');
    const base = {
      uuid: '11111111-2222-4333-8444-555555555555', device_code: 'LH-P1', sequence_device: 1,
      uid_hmac: 'a'.repeat(64), horodatage_utc: '2026-08-17T06:58:12.031Z', sens: 'entree', source: 'badge',
    };
    const hashDOrigine = chainHash(genesisHash('LH-P1'), canonicalPointage(base));

    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT id, code FROM badgeuse_devices/.test(s)) return Promise.resolve({ rows: [{ id: 1, code: 'LH-P1' }] });
      if (/FROM badgeuse_pointages p/.test(s)) {
        return Promise.resolve({
          rows: [{
            ...base, sequence_device: '1',
            // Falsification : une heure d'arrivée avancée d'une heure en base,
            // le hash enregistré étant resté celui de la capture d'origine.
            horodatage_utc: '2026-08-17T05:58:12.031Z',
            hash_precedent: genesisHash('LH-P1'), hash_courant: hashDOrigine, chaine_valide: true,
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await get('/api/badgeuse/devices/1/verify-chain');
    expect(r.body.ok).toBe(false);
    expect(r.body.ruptures).toHaveLength(1);
    expect(r.body.ruptures[0]).toMatchObject({ sequence: 1, trouve: hashDOrigine });
    expect(r.body.ruptures[0].attendu).not.toBe(hashDOrigine);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('contenus de veille (BO-08) — aucune donnée personnelle', () => {
  test('durée bornée 5–60 s', async () => {
    expect((await post('/api/badgeuse/contenus', 'RH', { type: 'message', duree_sec: 2 })).status).toBe(400);
    expect((await post('/api/badgeuse/contenus', 'RH', { type: 'message', duree_sec: 90 })).status).toBe(400);
    expect((await post('/api/badgeuse/contenus', 'RH', { type: 'message', duree_sec: 12 })).status).toBe(201);
  });

  test('type hors énumération → 400', async () => {
    expect((await post('/api/badgeuse/contenus', 'RH', { type: 'video' })).status).toBe(400);
  });

  test('corps de plus de 2000 caractères → 400', async () => {
    expect((await post('/api/badgeuse/contenus', 'RH', { type: 'message', corps: 'x'.repeat(2001) })).status).toBe(400);
    expect((await post('/api/badgeuse/contenus', 'RH', { type: 'message', corps: 'x'.repeat(2000) })).status).toBe(201);
  });

  test('dates de visibilité au format attendu', async () => {
    expect((await post('/api/badgeuse/contenus', 'RH', { type: 'message', visible_du: '17/08/2026' })).status).toBe(400);
    expect((await post('/api/badgeuse/contenus', 'RH', { type: 'message', visible_du: '2026-08-17' })).status).toBe(201);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('/mes-pointages — droit d\'accès du salarié (art. 15)', () => {
  test('404 explicite si le compte n\'est lié à aucune fiche salarié', async () => {
    installMocks({ employee: null });
    const r = await get('/api/badgeuse/mes-pointages', 'COLLABORATEUR');
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/fiche salarié/i);
  });

  test('la recherche se fait bien sur employees.user_id = utilisateur connecté', async () => {
    installMocks({ employee: { id: 5, user_id: 1 } });
    await get('/api/badgeuse/mes-pointages?periode=2026-08', 'COLLABORATEUR');
    const sel = mockQuery.mock.calls.find((c) => /FROM employees WHERE user_id/.test(String(c[0])));
    expect(sel).toBeDefined();
    expect(sel[1]).toEqual([1]);
  });

  test('le salarié voit ses pointages ET les corrections avec leur motif (transparence NOTE_RH §5.2)', async () => {
    installMocks({ employee: { id: 5, user_id: 1 } });
    const r = await get('/api/badgeuse/mes-pointages?periode=2026-08', 'COLLABORATEUR');
    expect(r.body).toHaveProperty('pointages');
    expect(r.body).toHaveProperty('corrections');
    expect(r.body).toHaveProperty('jours');
    expect(r.body).toHaveProperty('feuille');
  });

  test('période mal formée → 400', async () => {
    expect((await get('/api/badgeuse/mes-pointages?periode=2026', 'COLLABORATEUR')).status).toBe(400);
  });
});

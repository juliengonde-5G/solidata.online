// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — JOURNALISATION DES EXPORTS NOMINATIFS (PR A, lot 0)
// ───────────────────────────────────────────────────────────────────────────
// Écart constaté à la reconnaissance (rapport 03 § 5.9 et § 9.1) : la note aux
// certificateurs promet que « chaque génération d'un export nominatif est
// inscrite au journal d'audit », or DEUX exports sur quatre ne l'étaient pas —
// l'export complet du module Insertion (Excel/CSV) et l'export FSE+. Ce lot
// tient la promesse pour le premier ; le second est repris par le lot 2 dans
// un fichier dédié (`routes/exports-fse.js`), l'ancienne route étant retirée
// d'ici — ce test vérifie aussi qu'elle a bien disparu de ce routeur.
//
// Ce que le fichier verrouille :
//   - GET /exports/insertion : journal `EXPORT_INSERTION_COMPLET` AVANT l'envoi
//     (un journal en échec = export en échec, jamais de fichier non tracé) ;
//   - 0 ligne → 409 `EXPORT_VIDE` motivé, JAMAIS un fichier vide (qui se lit
//     « il n'y a personne » alors qu'il signale un filtre ou une base vide) ;
//   - en-tête de traçabilité : feuille « Informations » (Excel) et lignes « # »
//     (CSV) portant date/heure, générateur, périmètre et nombre de lignes ;
//   - une erreur SQL rend un 500 qui NOMME le jeu de données fautif (fin du
//     `.catch(() => ({ rows: [] }))` qui transformait une panne en feuille
//     vide, indiscernable d'une absence de saisie) ;
//   - matrice de rôles : ADMIN/RH seulement (données art. 9/10).
//
// S'y ajoute (faute de fichier de test propre au lot 0 côté RH) le contrat du
// PUT /employees/:id sur les champs de conformité IAE rendus écrivables.
//
// Auth réelle (JWT sans `tv` → pas de contrôle token_version), DB simulée.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} })),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');
const ExcelJS = require('exceljs');

let app;
let appEmployees;
const tokenFor = (role) => jwt.sign(
  { id: 7, username: 'cip', role, first_name: 'Claire', last_name: 'MARTIN', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER') };

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/exports', require('../../src/routes/exports'));
  appEmployees = express();
  appEmployees.use(express.json());
  appEmployees.use('/api/employees', require('../../src/routes/employees'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { console.error.mockRestore && console.error.mockRestore(); });

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const put = (path, role, body) => request(appEmployees).put(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

// Une ligne de chaque jeu de données — la forme exacte importe peu, seul le
// COMPTE est vérifié par les assertions (l'export est à colonnes dynamiques).
const SALARIE = { matricule: 'M001', nom: 'DUPONT', prenom: 'Alice', statut: 'en_parcours', frein_sante: 2 };
const DIAG = { matricule: 'M001', nom: 'DUPONT', prenom: 'Alice', employee_id: 5, logement_statut: 'locataire' };
const JALON = { matricule: 'M001', nom: 'DUPONT', prenom: 'Alice', milestone_type: 'bilan_intermediaire' };
const ACTION = { matricule: 'M001', nom: 'DUPONT', prenom: 'Alice', category: 'mobilite' };

/**
 * Simule la base : chaque requête reconnue rend ses lignes. `over` permet de
 * vider un jeu de données ou de faire échouer une requête précise.
 */
function baseAvec({ salaries = [SALARIE], diagnostics = [DIAG], jalons = [JALON], actions = [ACTION], journal = () => ({ rows: [] }) } = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/INSERT INTO rgpd_audit_log/.test(s)) return Promise.resolve(journal());
    if (/FROM employees e[\s\S]*LEFT JOIN teams t/.test(s)) return Promise.resolve({ rows: salaries });
    if (/FROM insertion_diagnostics d/.test(s)) return Promise.resolve({ rows: diagnostics });
    if (/FROM insertion_milestones m/.test(s)) return Promise.resolve({ rows: jalons });
    if (/FROM cip_action_plans a/.test(s)) return Promise.resolve({ rows: actions });
    return Promise.resolve({ rows: [] });
  });
}

/** Appels d'écriture au journal RGPD observés depuis le début du test. */
const appelsJournal = () => mockQuery.mock.calls.filter((c) => /INSERT INTO rgpd_audit_log/.test(String(c[0])));

/** Récupère le corps binaire d'une réponse (classeur Excel). */
const binaire = (req) => req.buffer(true).parse((res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});

// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /exports/insertion — journalisation RGPD (EXG-43)', () => {
  it('refuse un MANAGER (données art. 9/10 : freins santé et judiciaire)', async () => {
    baseAvec();
    expect((await get('/api/exports/insertion', 'MANAGER')).status).toBe(403);
    expect(appelsJournal()).toHaveLength(0);
  });

  it('journalise EXPORT_INSERTION_COMPLET avec format, jeu de données et nb de lignes (CSV)', async () => {
    baseAvec();
    const res = await get('/api/exports/insertion?format=csv&dataset=jalons', 'RH');
    expect(res.status).toBe(200);

    const journal = appelsJournal();
    expect(journal).toHaveLength(1);
    const [sql, params] = journal[0];
    expect(String(sql)).toContain('INSERT INTO rgpd_audit_log');
    expect(params[0]).toBe(7);                       // user_id de l'appelant
    expect(params[1]).toBe('EXPORT_INSERTION_COMPLET');
    expect(params[2]).toBe('insertion');
    const details = JSON.parse(params[4]);
    expect(details).toMatchObject({ format: 'csv', dataset: 'jalons', lignes: 1, requested_by: 7 });
  });

  it("écrit le journal AVANT d'envoyer le fichier (et non après)", async () => {
    // Preuve d'ORDRE : on relève l'index de l'INSERT de journal dans la
    // séquence des requêtes, et on vérifie qu'aucune requête de données n'est
    // émise après lui — l'envoi ne peut donc pas précéder la trace.
    baseAvec();
    const res = await get('/api/exports/insertion?format=csv', 'ADMIN');
    expect(res.status).toBe(200);
    const sequence = mockQuery.mock.calls.map((c) => String(c[0]));
    const iJournal = sequence.findIndex((s) => /INSERT INTO rgpd_audit_log/.test(s));
    expect(iJournal).toBeGreaterThan(-1);
    expect(iJournal).toBe(sequence.length - 1);
    expect(res.text).toContain('DUPONT');
  });

  it('un journal en ÉCHEC fait échouer l’export (aucun fichier non tracé)', async () => {
    baseAvec({ journal: () => { throw Object.assign(new Error('rgpd_audit_log absente'), { code: '42P01' }); } });
    const res = await get('/api/exports/insertion?format=csv', 'ADMIN');
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('DUPONT');
  });

  it('journalise aussi le format Excel, avec le total des 4 feuilles', async () => {
    baseAvec({ salaries: [SALARIE, { ...SALARIE, matricule: 'M002' }] });
    const res = await binaire(get('/api/exports/insertion', 'ADMIN'));
    expect(res.status).toBe(200);
    const details = JSON.parse(appelsJournal()[0][1][4]);
    expect(details).toMatchObject({ format: 'xlsx', dataset: 'tout', lignes: 5 }); // 2 + 1 + 1 + 1
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /exports/insertion — jamais de fichier vide', () => {
  it('0 salarié → 409 EXPORT_VIDE motivé, sans journal ni fichier (Excel)', async () => {
    baseAvec({ salaries: [], diagnostics: [], jalons: [], actions: [] });
    const res = await get('/api/exports/insertion', 'ADMIN');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPORT_VIDE');
    expect(res.body.error).toMatch(/Aucun salarié/i);
    expect(res.body.hint).toBeTruthy();
    expect(appelsJournal()).toHaveLength(0); // rien n'est sorti : rien à tracer
  });

  it('0 salarié → 409 aussi en CSV (le format ne change pas la règle)', async () => {
    baseAvec({ salaries: [], diagnostics: [], jalons: [], actions: [] });
    const res = await get('/api/exports/insertion?format=csv&dataset=salaries', 'RH');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPORT_VIDE');
  });

  it('jeu de données CSV demandé mais vide → 409 qui NOMME le jeu de données', async () => {
    baseAvec({ actions: [] });
    const res = await get('/api/exports/insertion?format=csv&dataset=actions', 'ADMIN');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPORT_VIDE');
    expect(res.body.error).toContain("Plans d'action");
    expect(appelsJournal()).toHaveLength(0);
  });

  it('un jeu de données inconnu retombe sur « Salariés » plutôt que sur un fichier vide', async () => {
    baseAvec();
    const res = await get('/api/exports/insertion?format=csv&dataset=inexistant', 'ADMIN');
    expect(res.status).toBe(200);
    expect(JSON.parse(appelsJournal()[0][1][4]).dataset).toBe('salaries');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /exports/insertion — en-tête de traçabilité', () => {
  it('CSV : lignes « # » portant date/heure, générateur, périmètre et nb de lignes', async () => {
    baseAvec();
    const res = await get('/api/exports/insertion?format=csv&dataset=salaries', 'RH');
    expect(res.status).toBe(200);
    const tete = res.text.split('\n').filter((l) => l.startsWith('# '));
    expect(tete.join('\n')).toMatch(/Généré le : .*heure de Paris/);
    expect(tete.join('\n')).toContain('Générateur : Claire MARTIN');
    expect(tete.join('\n')).toMatch(/Périmètre : .+/);
    expect(tete.join('\n')).toContain('Lignes : 1');
    expect(tete.join('\n')).toMatch(/Confidentialité/);
    // L'en-tête précède la ligne de colonnes, qui reste lisible par Excel.
    const lignes = res.text.replace('﻿', '').split('\n');
    expect(lignes[0].startsWith('# ')).toBe(true);
    expect(lignes.find((l) => l.startsWith('matricule;'))).toBeTruthy();
  });

  it('Excel : feuille « Informations » en première position, avec le générateur et les comptes', async () => {
    baseAvec({ jalons: [JALON, { ...JALON, milestone_type: 'bilan_sortie' }] });
    const res = await binaire(get('/api/exports/insertion', 'ADMIN'));
    expect(res.status).toBe(200);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.worksheets[0].name).toBe('Informations');
    expect(wb.worksheets.map((w) => w.name)).toEqual(
      ['Informations', 'Salariés', 'Diagnostics CIP', 'Jalons', "Plans d'action"]
    );
    const lu = {};
    wb.getWorksheet('Informations').eachRow((row, i) => { if (i > 1) lu[row.getCell(1).value] = row.getCell(2).value; });
    expect(lu['Générateur']).toBe('Claire MARTIN');
    expect(String(lu['Généré le'])).toMatch(/heure de Paris/);
    expect(lu['Périmètre']).toMatch(/insertion/i);
    expect(lu['Lignes (total)']).toBe(5);
    expect(lu['Jalons']).toBe(2);
    expect(String(lu['Traçabilité'])).toMatch(/journal d['’]audit RGPD/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /exports/insertion — une erreur SQL ne se déguise plus en feuille vide', () => {
  it('500 qui nomme le jeu de données fautif (et non un fichier partiel)', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM employees e[\s\S]*LEFT JOIN teams t/.test(s)) return Promise.resolve({ rows: [SALARIE] });
      if (/FROM insertion_diagnostics d/.test(s)) {
        return Promise.reject(Object.assign(new Error('column d.fse_entree does not exist'), { code: '42703' }));
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/exports/insertion', 'ADMIN');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Diagnostics CIP');
    expect(appelsJournal()).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("CONTRAT /exports/fse-plus — retiré de ce routeur (repris par exports-fse.js)", () => {
  it('ne répond plus depuis routes/exports.js', async () => {
    baseAvec();
    expect((await get('/api/exports/fse-plus?annee=2026&trimestre=1', 'ADMIN')).status).toBe(404);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PUT /api/employees/:id — champs de conformité IAE (lot 0, § 6.3)
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT PUT /employees/:id — conformité IAE', () => {
  const okUpdate = () => mockQuery.mockImplementation((sql) => {
    if (/UPDATE employees SET/.test(String(sql))) return Promise.resolve({ rows: [{ id: 5 }] });
    return Promise.resolve({ rows: [] });
  });

  it('écrit le Pass IAE, l’éligibilité, l’identifiant France Travail et la dérogation CDDI', async () => {
    okUpdate();
    const res = await put('/api/employees/5', 'RH', {
      pass_iae_number: '999999999999',
      pass_iae_start: '2026-01-05',
      pass_iae_end: '2028-01-04',
      eligibilite_criteres: 'BRSA, DELD',
      eligibilite_justificatifs_ref: 'Emplois de l’inclusion — dossier 12345',
      france_travail_id: '1234567A',
      cddi_derogation_motif: 'senior_50',
      cddi_derogation_date: '2026-09-01',
    });
    expect(res.status).toBe(200);
    const call = mockQuery.mock.calls.find((c) => /UPDATE employees SET/.test(String(c[0])));
    expect(call).toBeTruthy();
    for (const col of ['pass_iae_number', 'pass_iae_start', 'pass_iae_end', 'eligibilite_criteres',
      'eligibilite_justificatifs_ref', 'france_travail_id', 'cddi_derogation_motif', 'cddi_derogation_date']) {
      expect(String(call[0])).toContain(`${col} = $`);
    }
    expect(call[1]).toContain('999999999999');
    expect(call[1]).toContain('senior_50');
  });

  it('refuse un motif de dérogation hors des 4 motifs légaux (400 explicite, jamais un 500 SQL)', async () => {
    okUpdate();
    const res = await put('/api/employees/5', 'ADMIN', { cddi_derogation_motif: 'parce_que' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dérogation/i);
    expect(res.body.hint).toContain('formation_en_cours');
    expect(mockQuery.mock.calls.some((c) => /UPDATE employees SET/.test(String(c[0])))).toBe(false);
  });

  it('une dérogation vidée vaut « pas de dérogation » (NULL), pas une valeur refusée', async () => {
    okUpdate();
    const res = await put('/api/employees/5', 'ADMIN', { cddi_derogation_motif: '' });
    expect(res.status).toBe(200);
    const call = mockQuery.mock.calls.find((c) => /UPDATE employees SET/.test(String(c[0])));
    expect(call[1]).toContain(null);
  });

  it('une date de Pass IAE vidée devient NULL (et non une chaîne vide refusée par PostgreSQL)', async () => {
    okUpdate();
    const res = await put('/api/employees/5', 'RH', { pass_iae_end: '' });
    expect(res.status).toBe(200);
    const call = mockQuery.mock.calls.find((c) => /UPDATE employees SET/.test(String(c[0])));
    expect(String(call[0])).toContain('pass_iae_end = $1');
    expect(call[1][0]).toBeNull();
  });

  it('reste fermé à un MANAGER', async () => {
    okUpdate();
    expect((await put('/api/employees/5', 'MANAGER', { pass_iae_number: 'X' })).status).toBe(403);
  });
});

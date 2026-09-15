// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — DOSSIER ADMINISTRATIF D'INSERTION (PR A, lot 1)
// ───────────────────────────────────────────────────────────────────────────
// Ce que ces tests tiennent :
//   1. MATRICE DE RÔLES — un MANAGER lit le dossier mais n'en reçoit ni les
//      STATUTS SOCIAUX, ni les PIÈCES, ni le BLOC de report (les clés sont
//      ABSENTES, pas nulles : une clé à null dirait déjà qu'il y a quelque
//      chose là). Il n'écrit rien.
//   2. STATUT DU PASS RECALCULÉ SERVEUR — le client ne peut pas le dicter ;
//      ajouter une suspension le fait basculer.
//   3. JOURNALISATION — consultation et modification tracées ; la trace de
//      modification porte les NOMS des champs, jamais leurs valeurs.
//   4. LISTES FERMÉES — une valeur hors liste est refusée en 400 AVANT toute
//      écriture.
//   5. PIÈCES — type vérifié par les OCTETS (un PDF forgé par son seul MIME est
//      refusé), service en `no-store` + `nosniff`, dépôt / consultation /
//      suppression journalisés, et AUCUN justificatif d'éligibilité accepté.
//   6. BLOC « EMPLOIS DE L'INCLUSION » — gabarit exact, « non renseigné » pour
//      tout champ absent (jamais un blanc sur un formulaire officiel).
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockClientQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

let app;
const tokenFor = (role) => jwt.sign(
  { id: 7, username: 'cip', role, first_name: 'C', last_name: 'IP', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER') };

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
});

const get = (p, role = 'ADMIN') => request(app).get(p).set('Authorization', `Bearer ${TOKENS[role]}`);
const put = (p, role, body = {}) => request(app).put(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const post = (p, role, body = {}) => request(app).post(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const del = (p, role) => request(app).delete(p).set('Authorization', `Bearer ${TOKENS[role]}`);

// Ligne `employees` telle que la renvoie la requête de composerCadre().
const EMP = {
  id: 5,
  pass_iae_number: '2025-07-0918', pass_iae_start: '2025-07-15', pass_iae_end: '2099-03-14',
  pass_iae_statut: 'actif',
  orienteur_type: 'departement_cms', orienteur_nom: 'CMS Grand-Quevilly',
  prescripteur_id: 3, date_prescription: '2025-07-01',
  referent_unique_type: 'cms', referent_unique_nom: 'Mme L.', referent_unique_contact: '02 35 00 00 00',
  actualisation_ft_requise: false, actualisation_ft_derniere_date: null, actualisation_ft_rappels_non_honores: 0,
  brsa: true, brsa_date_constat: '2025-07-10', ft_categorie: 'F', ft_categorie_date: '2025-09-01',
  france_travail_id: '7612345A',
  eligibilite_verifiee_le: '2025-07-10', eligibilite_source: 'prescripteur_habilite',
  eligibilite_justificatifs_ref: 'Dossier Emplois de l\'inclusion n° 4471-K',
  cddi_derogation_motif: null, cddi_derogation_date: null, parcours_num: 1,
  prescripteur_nom: 'CMS Grand-Quevilly', prescripteur_type: 'CD',
};

/**
 * Aiguillage du faux `pg` : chaque requête du dossier reçoit sa réponse.
 * `over` permet de surcharger un cas précis (liste d'événements, critères…).
 */
function branche(over = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/FROM employees e\s+LEFT JOIN prescripteur_orgas/.test(s)) return Promise.resolve({ rows: over.employees ?? [EMP] });
    if (/FROM employee_eligibilite e/.test(s)) return Promise.resolve({ rows: over.criteres ?? [{ code: 'brsa', libelle: 'Bénéficiaire du RSA', date_constat: '2025-07-10' }, { code: 'deld', libelle: "Demandeur d'emploi de longue durée (12-24 mois)", date_constat: null }] });
    if (/FROM insertion_pass_iae_evenements/.test(s)) return Promise.resolve({ rows: over.evenements ?? [] });
    if (/FROM insertion_projet_participants/.test(s)) return Promise.resolve({ rows: over.projets ?? [] });
    if (/FROM insertion_pieces p/.test(s)) return Promise.resolve({ rows: over.pieces ?? [] });
    if (/SELECT rqth FROM insertion_diagnostics/.test(s)) return Promise.resolve({ rows: [{ rqth: false }] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockClientQuery.mockResolvedValue({ rows: [] });
  branche();
});

const journaux = () => mockQuery.mock.calls.filter(([sql]) => /INSERT INTO rgpd_audit_log/.test(String(sql)));
const journalPour = (action) => journaux().find(([, p]) => p && p[1] === action);

// ───────────────────────────────────────────────────────────────────────────
describe('1. Matrice de rôles', () => {
  test('ADMIN et RH lisent le dossier complet', async () => {
    for (const r of ['ADMIN', 'RH']) {
      const res = await get('/api/insertion/cadre/5', r);
      expect(res.status).toBe(200);
      expect(res.body.statuts).toBeDefined();
      expect(res.body.bloc_emplois_inclusion).toBeTruthy();
    }
  });

  test('MANAGER lit le dossier SANS statuts, SANS pièces, SANS bloc de report — clés ABSENTES', async () => {
    const res = await get('/api/insertion/cadre/5', 'MANAGER');
    expect(res.status).toBe(200);
    // `toBeUndefined` ne suffirait pas : une clé présente à `undefined`
    // disparaît du JSON mais existerait dans l'objet. On teste la PRÉSENCE.
    expect(Object.keys(res.body)).not.toContain('statuts');
    expect(Object.keys(res.body)).not.toContain('pieces');
    expect(Object.keys(res.body)).not.toContain('bloc_emplois_inclusion');
    // Ce qu'il conserve : le Pass et l'orientation.
    expect(res.body.pass_iae).toBeDefined();
    expect(res.body.orientation.referent_unique.type).toBe('cms');
  });

  // ── C-01 (correctif du 13/09) ─────────────────────────────────────────────
  // Cette assertion disait l'inverse : elle EXIGEAIT que le MANAGER reçoive les
  // deux critères, sur un jeu de données dont le premier est « Bénéficiaire du
  // RSA » — c'est-à-dire le statut social que la clé `statuts`, retirée trois
  // lignes plus haut, est censée protéger. Le test verrouillait la fuite.
  test('C-01 — le MANAGER ne reçoit AUCUN critère d’éligibilité (ni code, ni libellé)', async () => {
    branche({
      criteres: [
        { code: 'brsa', libelle: 'Bénéficiaire du RSA', date_constat: '2025-07-10', sensible_art10: false },
        { code: 'rqth', libelle: 'Reconnaissance RQTH', date_constat: null, sensible_art10: false },
        { code: 'sortant_detention', libelle: 'Sortant de détention', date_constat: null, sensible_art10: true },
      ],
    });
    const res = await get('/api/insertion/cadre/5', 'MANAGER');
    expect(res.status).toBe(200);
    // Aucune liste, sous aucune forme.
    expect(res.body.eligibilite.criteres).toBeUndefined();
    const brut = JSON.stringify(res.body);
    for (const interdit of ['brsa', 'rqth', 'sortant_detention',
      'Bénéficiaire du RSA', 'Reconnaissance RQTH', 'Sortant de détention']) {
      expect(brut).not.toContain(interdit);
    }
    // Ce qu'il reçoit : la preuve que la vérification a eu lieu.
    expect(res.body.eligibilite.verifiee_le).toBe('2025-07-10');
    expect(res.body.eligibilite.source).toBe('prescripteur_habilite');
    // M-06 — le critère art. 10 n'est pas COMPTÉ : 3 critères en base, 2 annoncés.
    expect(res.body.eligibilite.nb_criteres).toBe(2);
    // La référence des justificatifs est un texte libre : elle ne part pas non plus.
    expect(res.body.eligibilite.justificatifs_ref).toBeUndefined();
  });

  test('C-01 — l’ADMIN, lui, reçoit la liste complète (y compris le critère art. 10)', async () => {
    branche({
      criteres: [
        { code: 'brsa', libelle: 'Bénéficiaire du RSA', date_constat: '2025-07-10', sensible_art10: false },
        { code: 'sortant_detention', libelle: 'Sortant de détention', date_constat: null, sensible_art10: true },
      ],
    });
    const res = await get('/api/insertion/cadre/5', 'ADMIN');
    expect(res.body.eligibilite.criteres.map((c) => c.code)).toEqual(['brsa', 'sortant_detention']);
    // M-06 — mais le bloc de report, qui se COPIE hors de l'outil, ne le nomme pas.
    expect(res.body.bloc_emplois_inclusion).toContain('Bénéficiaire du RSA');
    expect(res.body.bloc_emplois_inclusion).not.toContain('Sortant de détention');
    expect(res.body.bloc_emplois_inclusion).toContain('[critère judiciaire — voir la fiche]');
  });

  // m-10 — « un refus après lecture serait un refus d'affichage, pas d'accès ».
  test('m-10 — pour un MANAGER, ni les pièces ni les statuts ne sont LUS en base', async () => {
    await get('/api/insertion/cadre/5', 'MANAGER');
    const sqls = mockQuery.mock.calls.map(([s]) => String(s));
    expect(sqls.some((s) => /FROM insertion_pieces/.test(s))).toBe(false);
    expect(sqls.some((s) => /SELECT rqth FROM insertion_diagnostics/.test(s))).toBe(false);
    const selectEmp = sqls.find((s) => /FROM employees e\s+LEFT JOIN prescripteur_orgas/.test(s));
    expect(selectEmp).toBeDefined();
    for (const col of ['e.brsa', 'e.ft_categorie', 'e.france_travail_id', 'e.eligibilite_justificatifs_ref']) {
      expect(selectEmp).not.toContain(col);
    }
  });

  test('l’ADMIN, lui, LIT bien les pièces et les statuts', async () => {
    await get('/api/insertion/cadre/5', 'ADMIN');
    const sqls = mockQuery.mock.calls.map(([s]) => String(s));
    expect(sqls.some((s) => /FROM insertion_pieces/.test(s))).toBe(true);
    const selectEmp = sqls.find((s) => /FROM employees e\s+LEFT JOIN prescripteur_orgas/.test(s));
    expect(selectEmp).toContain('e.brsa');
  });

  test('la lecture MANAGER n’est PAS journalisée — et elle ne sert désormais aucune donnée sensible', async () => {
    await get('/api/insertion/cadre/5', 'MANAGER');
    expect(journaux()).toHaveLength(0);
  });

  test('MANAGER est refusé sur toutes les écritures', async () => {
    expect((await put('/api/insertion/cadre/5', 'MANAGER', { statuts: { brsa: true } })).status).toBe(403);
    expect((await post('/api/insertion/cadre/5/pass-iae/evenements', 'MANAGER', { type: 'suspension', date_debut: '2026-01-01' })).status).toBe(403);
    expect((await del('/api/insertion/cadre/5/pass-iae/evenements/1', 'MANAGER')).status).toBe(403);
    expect((await post('/api/insertion/cadre/5/actualisation-ft', 'MANAGER', {})).status).toBe(403);
  });

  test('un refus MANAGER n’écrit RIEN en base', async () => {
    await put('/api/insertion/cadre/5', 'MANAGER', { statuts: { brsa: true } });
    const ecritures = [...mockQuery.mock.calls, ...mockClientQuery.mock.calls]
      .filter(([sql]) => /UPDATE employees|INSERT INTO employee_eligibilite/.test(String(sql)));
    expect(ecritures).toHaveLength(0);
  });

  test('MANAGER n’atteint aucune pièce (les 4 routes)', async () => {
    expect((await get('/api/insertion/pieces/5', 'MANAGER')).status).toBe(403);
    expect((await get('/api/insertion/pieces/fichier/1', 'MANAGER')).status).toBe(403);
    expect((await post('/api/insertion/pieces/5', 'MANAGER', {})).status).toBe(403);
    expect((await del('/api/insertion/pieces/1', 'MANAGER')).status).toBe(403);
  });

  test('le référentiel des critères : lecture ouverte, écriture ADMIN seul', async () => {
    expect((await get('/api/insertion/eligibilite-criteres', 'MANAGER')).status).toBe(200);
    expect((await post('/api/insertion/eligibilite-criteres', 'RH', { code: 'x_test', libelle: 'X' })).status).toBe(403);
    expect((await put('/api/insertion/eligibilite-criteres/brsa', 'RH', { libelle: 'X' })).status).toBe(403);
  });

  test('un salarié inconnu → 404 (jamais un dossier vide présenté comme réel)', async () => {
    branche({ employees: [] });
    expect((await get('/api/insertion/cadre/999', 'ADMIN')).status).toBe(404);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('2. Statut du Pass IAE — recalculé SERVEUR', () => {
  test('un Pass sans événement est « actif »', async () => {
    const res = await get('/api/insertion/cadre/5', 'ADMIN');
    expect(res.body.pass_iae.statut).toBe('actif');
  });

  test('une suspension en cours bascule le statut à « suspendu » et le PERSISTE', async () => {
    const hier = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    branche({ evenements: [{ id: 1, type: 'suspension', date_debut: hier, date_fin: null, motif: 'Arrêt maladie > 15 j', reference_externe: 'SUSP-2026-041' }] });
    const res = await get('/api/insertion/cadre/5', 'ADMIN');
    expect(res.body.pass_iae.statut).toBe('suspendu');
    // Le cache `employees.pass_iae_statut` est réécrit : les listes et les
    // alertes ne peuvent pas rejouer le raisonnement ligne par ligne.
    const maj = mockQuery.mock.calls.find(([s]) => /UPDATE employees SET pass_iae_statut/.test(String(s)));
    expect(maj).toBeTruthy();
    expect(maj[1][0]).toBe('suspendu');
  });

  test('sans numéro de Pass, le statut est « inconnu »', async () => {
    branche({ employees: [{ ...EMP, pass_iae_number: null, pass_iae_statut: 'inconnu' }] });
    const res = await get('/api/insertion/cadre/5', 'ADMIN');
    expect(res.body.pass_iae.statut).toBe('inconnu');
  });

  test('un statut envoyé par le client est IGNORÉ (jamais dicté)', async () => {
    mockClientQuery.mockImplementation((sql) => {
      if (/SELECT id FROM employees/.test(String(sql))) return Promise.resolve({ rows: [{ id: 5 }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/cadre/5', 'ADMIN', { pass_iae: { numero: 'P9', statut: 'prolonge' } });
    expect(res.status).toBe(200);
    const upd = mockClientQuery.mock.calls.find(([s]) => /UPDATE employees SET/.test(String(s)));
    expect(String(upd[0])).toContain('pass_iae_number');
    expect(String(upd[0])).not.toContain('pass_iae_statut');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('3. Journalisation RGPD', () => {
  test('une consultation ADMIN/RH écrit une ligne INSERTION_CADRE_CONSULTATION', async () => {
    await get('/api/insertion/cadre/5', 'RH');
    const j = journalPour('INSERTION_CADRE_CONSULTATION');
    expect(j).toBeTruthy();
    expect(j[1][2]).toBe('insertion_cadre');
    expect(j[1][3]).toBe(5);
  });

  test('une modification trace les NOMS des champs, JAMAIS leurs valeurs', async () => {
    mockClientQuery.mockImplementation((sql) => {
      if (/SELECT id FROM employees/.test(String(sql))) return Promise.resolve({ rows: [{ id: 5 }] });
      return Promise.resolve({ rows: [] });
    });
    await put('/api/insertion/cadre/5', 'ADMIN', {
      statuts: { brsa: true, france_travail_id: '7612345A' },
      orientation: { referent_unique: { nom: 'Mme LEROY', contact: 'leroy@cd76.fr' } },
    });
    const j = journalPour('INSERTION_CADRE_MODIFICATION');
    expect(j).toBeTruthy();
    const details = JSON.parse(j[1][4]);
    expect(details.champs).toEqual(expect.arrayContaining(['brsa', 'france_travail_id', 'referent_unique_nom']));
    // Aucune valeur ne doit figurer dans la trace : le journal d'audit n'est
    // pas une seconde copie des statuts sociaux qu'il protège.
    const brut = j[1][4];
    expect(brut).not.toContain('7612345A');
    expect(brut).not.toContain('LEROY');
    expect(brut).not.toContain('leroy@cd76.fr');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('4. Listes fermées — refus AVANT écriture', () => {
  const casInvalides = [
    ['orienteur hors liste', { orientation: { orienteur_type: 'pole_emploi' } }],
    ['référent unique hors liste', { orientation: { referent_unique: { type: 'mairie' } } }],
    ['catégorie France Travail hors liste', { statuts: { ft_categorie: 'Z' } }],
    ['source d’éligibilité hors liste', { eligibilite: { source: 'au_pif' } }],
    ['motif de dérogation hors liste', { derogation_cddi: { motif: 'parce_que' } }],
    ['date mal formée', { pass_iae: { fin: '14/03/2027' } }],
    ['BRSA à une valeur inattendue', { statuts: { brsa: 'peut-être' } }],
  ];
  for (const [libelle, corps] of casInvalides) {
    test(`400 — ${libelle}`, async () => {
      const res = await put('/api/insertion/cadre/5', 'ADMIN', corps);
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
      const ecritures = mockClientQuery.mock.calls.filter(([s]) => /UPDATE employees SET/.test(String(s)));
      expect(ecritures).toHaveLength(0);
    });
  }

  test('un corps vide est refusé plutôt qu’exécuté à blanc', async () => {
    expect((await put('/api/insertion/cadre/5', 'ADMIN', {})).status).toBe(400);
  });

  test('un critère d’éligibilité inconnu est refusé (400) et la transaction annulée', async () => {
    mockClientQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT id FROM employees/.test(s)) return Promise.resolve({ rows: [{ id: 5 }] });
      if (/FROM insertion_eligibilite_criteres WHERE code = ANY/.test(s)) return Promise.resolve({ rows: [{ code: 'brsa' }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/cadre/5', 'ADMIN', { eligibilite: { criteres: ['brsa', 'inexistant'] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('inexistant');
    expect(mockClientQuery.mock.calls.some(([s]) => String(s) === 'ROLLBACK')).toBe(true);
  });

  test('« non renseigné » ≠ « non » : une valeur explicitement nulle efface, une clé absente n’efface pas', async () => {
    mockClientQuery.mockImplementation((sql) => {
      if (/SELECT id FROM employees/.test(String(sql))) return Promise.resolve({ rows: [{ id: 5 }] });
      return Promise.resolve({ rows: [] });
    });
    await put('/api/insertion/cadre/5', 'ADMIN', { statuts: { brsa: null } });
    const upd = mockClientQuery.mock.calls.find(([s]) => /UPDATE employees SET/.test(String(s)));
    expect(String(upd[0])).toContain('brsa =');
    expect(upd[1][0]).toBeNull();
    // `ft_categorie` n'était pas dans le corps : il ne doit pas être touché.
    expect(String(upd[0])).not.toContain('ft_categorie');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('5. Événements du Pass', () => {
  test('un type hors liste est refusé (400)', async () => {
    const res = await post('/api/insertion/cadre/5/pass-iae/evenements', 'ADMIN', { type: 'radiation', date_debut: '2026-01-01' });
    expect(res.status).toBe(400);
  });

  test('une date de fin antérieure au début est refusée (400)', async () => {
    const res = await post('/api/insertion/cadre/5/pass-iae/evenements', 'ADMIN', {
      type: 'suspension', date_debut: '2026-03-01', date_fin: '2026-02-01',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/précède/);
  });

  test('un ajout valide écrit l’événement et renvoie le dossier recomposé', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/INSERT INTO insertion_pass_iae_evenements/.test(s)) return Promise.resolve({ rows: [{ id: 42 }] });
      if (/FROM employees e\s+LEFT JOIN prescripteur_orgas/.test(s)) return Promise.resolve({ rows: [EMP] });
      if (/FROM employee_eligibilite e/.test(s)) return Promise.resolve({ rows: [] });
      if (/FROM insertion_pass_iae_evenements/.test(s)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/cadre/5/pass-iae/evenements', 'ADMIN', {
      type: 'prolongation', date_debut: '2026-07-15', date_fin: '2027-03-14',
      motif: 'Formation en cours', reference_externe: 'PROL-2026-118',
    });
    expect(res.status).toBe(201);
    expect(res.body.pass_iae).toBeDefined();
    expect(journalPour('INSERTION_CADRE_MODIFICATION')).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('6. Bloc « Emplois de l’inclusion »', () => {
  test('gabarit exact avec les libellés des critères et le type du prescripteur', async () => {
    const res = await get('/api/insertion/cadre/5', 'ADMIN');
    expect(res.body.bloc_emplois_inclusion).toBe(
      "Critères : Bénéficiaire du RSA ; Demandeur d'emploi de longue durée (12-24 mois)"
      + ' · Prescripteur : CMS Grand-Quevilly (CD)'
      + ' · Pass IAE : 2025-07-0918 · début 15/07/2025 · fin 14/03/2099 · Statut : actif'
    );
  });

  test('tout champ absent s’écrit « non renseigné » — jamais un blanc', async () => {
    branche({
      employees: [{ ...EMP, pass_iae_number: null, pass_iae_start: null, pass_iae_end: null, prescripteur_id: null, prescripteur_nom: null, prescripteur_type: null }],
      criteres: [],
    });
    const res = await get('/api/insertion/cadre/5', 'ADMIN');
    expect(res.body.bloc_emplois_inclusion).toBe(
      'Critères : non renseigné · Prescripteur : non renseigné · Pass IAE : non renseigné'
      + ' · début non renseigné · fin non renseigné · Statut : inconnu'
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('7. Pièces — le type est vérifié par les OCTETS', () => {
  const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0x20)]);
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const HTML_DEGUISE = Buffer.from('<html><script>alert(1)</script></html>');

  const depose = (buf, nom, mime, type = 'entretien_signe', role = 'ADMIN') => request(app)
    .post('/api/insertion/pieces/5')
    .set('Authorization', `Bearer ${TOKENS[role]}`)
    .field('type', type)
    .attach('fichier', buf, { filename: nom, contentType: mime });

  test('un PDF réel est accepté, stocké en BYTEA avec son empreinte', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/INSERT INTO insertion_pieces/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 11, type: 'entretien_signe', nom_fichier: 'bilan.pdf', mime: 'application/pdf', taille: PDF.length }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await depose(PDF, 'bilan.pdf', 'application/pdf');
    expect(res.status).toBe(201);
    const ins = mockQuery.mock.calls.find(([s]) => /INSERT INTO insertion_pieces/.test(String(s)));
    expect(Buffer.isBuffer(ins[1][7])).toBe(true);          // contenu = Buffer
    expect(ins[1][5]).toBe('application/pdf');               // mime déduit des octets
    expect(ins[1][8]).toMatch(/^[0-9a-f]{64}$/);             // sha256
    expect(journalPour('INSERTION_PIECE_DEPOT')).toBeTruthy();
  });

  test('un HTML annoncé « application/pdf » est REFUSÉ (le MIME déclaré ne fait pas foi)', async () => {
    const res = await depose(HTML_DEGUISE, 'piege.pdf', 'application/pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PDF, JPEG et PNG/);
    expect(mockQuery.mock.calls.filter(([s]) => /INSERT INTO insertion_pieces/.test(String(s)))).toHaveLength(0);
  });

  test('un type de pièce hors liste fermée est refusé — AUCUN justificatif d’éligibilité', async () => {
    const res = await depose(PNG, 'notif-caf.png', 'image/png', 'justificatif_eligibilite');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Type de pièce invalide/);
  });

  test('la consultation sert le document en no-store + nosniff, et la journalise', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM insertion_pieces WHERE id/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 11, employee_id: 5, type: 'entretien_signe', nom_fichier: 'bilan.pdf', mime: 'application/pdf', contenu: PDF }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/pieces/fichier/11', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toMatch(/^inline; filename="bilan\.pdf"$/);
    expect(journalPour('INSERTION_PIECE_CONSULTATION')).toBeTruthy();
  });

  test('un nom de fichier hostile ne casse pas l’en-tête Content-Disposition', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM insertion_pieces WHERE id/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 11, employee_id: 5, type: 'autre', nom_fichier: 'a"\r\nX-Injecte: 1', mime: 'image/png', contenu: PNG }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/pieces/fichier/11', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.headers['x-injecte']).toBeUndefined();
    expect(res.headers['content-disposition']).not.toContain('\n');
  });

  test('la suppression est journalisée', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/DELETE FROM insertion_pieces/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 11, employee_id: 5, type: 'autre', nom_fichier: 'x.pdf', sha256: 'a'.repeat(64) }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await del('/api/insertion/pieces/11', 'ADMIN');
    expect(res.status).toBe(200);
    expect(journalPour('INSERTION_PIECE_SUPPRESSION')).toBeTruthy();
  });

  test('une pièce inexistante → 404', async () => {
    expect((await get('/api/insertion/pieces/fichier/999', 'ADMIN')).status).toBe(404);
    expect((await del('/api/insertion/pieces/999', 'ADMIN')).status).toBe(404);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('8. Résilience — base non migrée', () => {
  test('les projets cofinancés (tables du lot 2) absents rendent [] et non un 500', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM insertion_projet_participants/.test(s)) return Promise.reject(Object.assign(new Error('relation absente'), { code: '42P01' }));
      if (/FROM employees e\s+LEFT JOIN prescripteur_orgas/.test(s)) return Promise.resolve({ rows: [EMP] });
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/cadre/5', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.projets).toEqual([]);
  });

  test('le référentiel absent rend [] (l’écran de réglages s’ouvre)', async () => {
    mockQuery.mockRejectedValue(Object.assign(new Error('relation absente'), { code: '42P01' }));
    const res = await get('/api/insertion/eligibilite-criteres', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

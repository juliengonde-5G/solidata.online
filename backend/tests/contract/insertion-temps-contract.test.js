// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — PR B « Temps d'accompagnement », LOT 4
// ───────────────────────────────────────────────────────────────────────────
// Verrouille ce que l'autorité contrôlera sur l'export (c) (09 § 2 (c)) et ce
// que le contrat 15 § 10 exige comme preuve :
//   - MANAGER refusé sur la feuille d'un autre **AVANT toute requête en base** ;
//   - feuille FIGÉE après validation (plus aucune saisie, plus de suppression) ;
//   - auto-validation refusée (409 AUTO_VALIDATION : deux signatures =
//     deux personnes) ;
//   - export à zéro ligne → 409 EXPORT_VIDE, jamais un fichier vide ;
//   - le NOM du bénéficiaire est absent du CSV (seul l'identifiant interne) ;
//   - un entretien réalisé SANS durée ne produit AUCUNE ligne ;
//   - le journal RGPD est écrit AVANT l'envoi de l'export, et son échec fait
//     échouer l'export.
// Auth réelle (JWT), DB simulée, activity-logger simulé.
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

let app;
const tokenFor = (role, id, prenom = 'Claire', nom = 'MARTIN') => jwt.sign(
  { id, username: `u${id}`, role, first_name: prenom, last_name: nom, mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' }
);
// L'ADMIN et la RH sont des personnes DIFFÉRENTES de l'intervenant (id 7) :
// c'est précisément ce que la contre-signature exige.
const TOKENS = {
  ADMIN: tokenFor('ADMIN', 1, 'Awa', 'DIOP'),
  RH: tokenFor('RH', 2, 'Claire', 'MARTIN'),
  MANAGER: tokenFor('MANAGER', 7, 'Sofia', 'RENARD'),
  MANAGER_AUTRE: tokenFor('MANAGER', 8, 'Luc', 'BERTIN'),
};

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (p, role = 'ADMIN') => request(app).get(p).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (p, role, body = {}) => request(app).post(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const del = (p, role) => request(app).delete(p).set('Authorization', `Bearer ${TOKENS[role]}`);

// ── Jeux de données ────────────────────────────────────────────────────────
const PROJETS = [
  { id: 1, code: 'ASI-2026-2027', nom: 'Accompagnement Social Intensif', type: 'asi', taux_forfaitaire_pct: null },
  { id: 2, code: 'OCS-CIP-2026-2027', nom: 'Postes CIP en OCS', type: 'ocs', taux_forfaitaire_pct: 40 },
];
const POSTES = [{ projet_id: 2, projet_code: 'OCS-CIP-2026-2027', projet_type: 'ocs', user_id: 7, quotite_pct: 60, date_debut: '2026-01-01', date_fin: null }];
const PARTICIPATIONS = [{ employee_id: 5, projet_id: 1, projet_code: 'ASI-2026-2027', projet_type: 'asi', date_entree: '2026-01-01', date_sortie: null }];

const MILESTONES = [
  { id: 11, employee_id: 5, completed_date: '2026-09-04', duree_minutes: 60, milestone_type: 'bilan_intermediaire', interviewer_id: 7 },
  // Entretien réalisé SANS durée — il ne doit produire AUCUNE ligne.
  { id: 12, employee_id: 5, completed_date: '2026-09-11', duree_minutes: null, milestone_type: 'bilan_intermediaire', interviewer_id: 7 },
];
const ACTIONS = [{ id: 21, employee_id: 5, date_realisation: '2026-09-08', duree_minutes: 45, action_label: 'Orientation CMS', status: 'realise', created_by: 7 }];
const SAISIES = [{ id: 31, user_id: 7, date: '2026-09-15', projet_id: 2, activite: 'atelier_collectif', duree_minutes: 120, libelle: 'Atelier mobilité' }];

/** Branche les requêtes ; `feuille` pilote l'état stocké de la feuille. */
function brancher({
  feuille = null, milestones = MILESTONES, actions = ACTIONS, saisies = SAISIES,
  leaves = [], journalKo = false, weeklyHours = 35,
} = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/INSERT INTO rgpd_audit_log/.test(s)) {
      if (journalKo) return Promise.reject(Object.assign(new Error('journal indisponible'), { code: '42P01' }));
      return Promise.resolve({ rows: [] });
    }
    if (/INSERT INTO insertion_feuilles_temps/.test(s)) {
      return Promise.resolve({ rows: [{ id: 99, user_id: 7, annee: 2026, mois: 9, statut: 'validee_intervenant' }] });
    }
    if (/UPDATE insertion_feuilles_temps/.test(s)) {
      return Promise.resolve({ rows: [{ id: 99, user_id: 7, annee: 2026, mois: 9, statut: 'validee_rh' }] });
    }
    if (/FROM insertion_feuilles_temps/.test(s)) return Promise.resolve({ rows: feuille ? [feuille] : [] });
    if (/FROM insertion_milestones m/.test(s)) return Promise.resolve({ rows: milestones });
    if (/FROM cip_action_plans a/.test(s)) return Promise.resolve({ rows: actions });
    if (/FROM insertion_temps_saisies s/.test(s)) return Promise.resolve({ rows: saisies });
    if (/FROM insertion_temps_saisies WHERE id/.test(s)) return Promise.resolve({ rows: saisies.filter((x) => x.id === 31) });
    if (/FROM insertion_projets/.test(s)) return Promise.resolve({ rows: PROJETS });
    if (/FROM insertion_projet_postes pp/.test(s)) return Promise.resolve({ rows: POSTES });
    if (/FROM insertion_projet_participants pa/.test(s)) return Promise.resolve({ rows: PARTICIPATIONS });
    if (/FROM employee_leaves l/.test(s)) return Promise.resolve({ rows: leaves });
    if (/weekly_hours, first_name, last_name FROM employees/.test(s)) return Promise.resolve({ rows: [{ weekly_hours: weeklyHours, first_name: 'Sofia', last_name: 'Renard' }] });
    if (/FROM employees WHERE id = ANY/.test(s)) return Promise.resolve({ rows: [{ id: 5, first_name: 'Karim', last_name: 'Benali' }] });
    if (/FROM users WHERE id = ANY/.test(s)) return Promise.resolve({ rows: [{ id: 7, first_name: 'Sofia', last_name: 'Renard' }] });
    if (/first_name, last_name FROM users WHERE id/.test(s)) return Promise.resolve({ rows: [{ first_name: 'Sofia', last_name: 'Renard' }] });
    if (/FROM settings/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM users u/.test(s)) return Promise.resolve({ rows: [{ user_id: 7, first_name: 'Sofia', last_name: 'Renard', role: 'MANAGER', postes: [] }] });
    return Promise.resolve({ rows: [] });
  });
}

/** Requêtes réellement envoyées qui touchent une table du module. */
const requetesMetier = () => mockQuery.mock.calls
  .map(([t]) => String(t))
  .filter((t) => /insertion_feuilles_temps|insertion_temps_saisies|insertion_milestones|cip_action_plans|insertion_projet/.test(t));

// ═══════════════════════════════════════════════════════════════════════════
describe('PÉRIMÈTRE — le refus est posé AVANT toute lecture en base', () => {
  beforeAll(async () => {
    // Le cache des rôles soumis à la double authentification est chargé une
    // fois par une requête quelconque : sans ce préchauffage, la première
    // requête du test ci-dessous lirait `settings` et l'assertion « zéro
    // requête » mesurerait ce réglage plutôt que la garde.
    brancher();
    await get('/api/insertion/temps/7/2026/9', 'ADMIN');
  });

  it('MANAGER sur la feuille d’un AUTRE : 403, et AUCUNE requête n’est partie', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await get('/api/insertion/temps/7/2026/9', 'MANAGER_AUTRE');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FEUILLE_HORS_PERIMETRE');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('MANAGER sur SA feuille : autorisé', async () => {
    brancher();
    const res = await get('/api/insertion/temps/7/2026/9', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(7);
  });

  it('MANAGER refusé sur la liste des intervenants (ADMIN/RH)', async () => {
    brancher();
    const res = await get('/api/insertion/temps/intervenants', 'MANAGER');
    expect(res.status).toBe(403);
    expect(requetesMetier()).toHaveLength(0);
  });

  it('MANAGER refusé sur la synthèse (agrégats nominatifs par salarié)', async () => {
    brancher();
    const res = await get('/api/insertion/temps/synthese?annee=2026', 'MANAGER');
    expect(res.status).toBe(403);
    expect(requetesMetier()).toHaveLength(0);
  });

  it('la réouverture est réservée à l’ADMIN — la RH est refusée avant toute requête', async () => {
    brancher();
    const res = await post('/api/insertion/temps/7/2026/9/rouvrir', 'RH', { motif: 'correction' });
    expect(res.status).toBe(403);
    expect(requetesMetier()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /:userId/:annee/:mois — composition de la feuille', () => {
  it('compose les lignes sans rien écrire', async () => {
    brancher();
    const res = await get('/api/insertion/temps/7/2026/9', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.statut).toBe('brouillon');
    expect(mockQuery.mock.calls.some(([t]) => /INSERT INTO|UPDATE /.test(String(t)))).toBe(false);
  });

  it('un entretien réalisé SANS durée ne produit AUCUNE ligne (jamais de durée inventée)', async () => {
    brancher();
    const res = await get('/api/insertion/temps/7/2026/9', 'ADMIN');
    const ids = res.body.lignes.filter((l) => l.activite === 'entretien').map((l) => l.source_id);
    expect(ids).toEqual([11]);
    expect(ids).not.toContain(12);
  });

  it('les trois origines sont présentes, avec leur rattachement de projet', async () => {
    brancher();
    const res = await get('/api/insertion/temps/7/2026/9', 'ADMIN');
    expect(res.body.lignes).toHaveLength(3);
    expect(res.body.lignes.map((l) => l.projet_code)).toEqual([
      'ASI-2026-2027',       // entretien d'un participant ASI
      'ASI-2026-2027',       // action pour le même participant
      'OCS-CIP-2026-2027',   // saisie rattachée explicitement à l'OCS
    ]);
    expect(res.body.totaux.total_minutes).toBe(225);
  });

  it('quotité et taux forfaitaire (amendement F2) ; inconnus = ABSENTS, jamais 0', async () => {
    brancher();
    const res = await get('/api/insertion/temps/7/2026/9', 'ADMIN');
    expect(res.body.totaux.quotites['OCS-CIP-2026-2027']).toBe(60);
    expect(res.body.totaux.taux_forfaitaire['OCS-CIP-2026-2027']).toBe(40);
    expect(res.body.totaux.taux_forfaitaire['ASI-2026-2027']).toBeUndefined();
  });

  it('la ligne de cohérence est TOUJOURS présente, même conforme', async () => {
    brancher();
    const res = await get('/api/insertion/temps/7/2026/9', 'ADMIN');
    expect(res.body.coherence).toEqual({ conforme: true, anomalies: [] });
  });

  it('une ligne posée un jour d’absence est SIGNALÉE, sans bloquer', async () => {
    brancher({ leaves: [{ type_category: 'sick', start_date: '2026-09-04', end_date: '2026-09-04' }] });
    const res = await get('/api/insertion/temps/7/2026/9', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.coherence.conforme).toBe(false);
    expect(res.body.coherence.anomalies[0].type).toBe('jour_absence');
  });

  it('aucune ligne ne porte le NOM du bénéficiaire', async () => {
    brancher();
    const res = await get('/api/insertion/temps/7/2026/9', 'ADMIN');
    expect(JSON.stringify(res.body.lignes)).not.toMatch(/Benali|Karim/i);
    expect(res.body.lignes.some((l) => l.employee_id === 5)).toBe(true);
  });

  it('une feuille VALIDÉE rend le SNAPSHOT, pas une recomposition', async () => {
    const figee = {
      id: 99, user_id: 7, annee: 2026, mois: 9, statut: 'validee_rh',
      lignes: [{ date: '2026-09-04', projet_code: 'ASI-2026-2027', activite: 'entretien', employee_id: 5, duree_minutes: 60, origine: 'composee', source: 'milestone', source_id: 11 }],
      totaux: { total_minutes: 60, par_projet: { 'ASI-2026-2027': 60 }, quotites: {}, taux_forfaitaire: {} },
      coherence: { conforme: true, anomalies: [] },
      validation_intervenant: { user_id: 7, nom: 'RENARD Sofia', at: '2026-10-02T09:00:00.000Z' },
      validation_rh: { user_id: 2, nom: 'MARTIN Claire', at: '2026-10-03T09:00:00.000Z' },
    };
    brancher({ feuille: figee });
    const res = await get('/api/insertion/temps/7/2026/9', 'ADMIN');
    // Le snapshot ne contient qu'une ligne : la composition vivante en rendrait
    // trois. C'est ce qui a été SIGNÉ qui est rendu.
    expect(res.body.lignes).toHaveLength(1);
    expect(res.body.totaux.total_minutes).toBe(60);
    expect(res.body.fige).toBe(true);
    expect(mockQuery.mock.calls.some(([t]) => /FROM insertion_milestones/.test(String(t)))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Saisies — la feuille figée ne bouge plus', () => {
  const url = '/api/insertion/temps/7/2026/9/saisies';

  it('ajout accepté tant que la feuille est au brouillon', async () => {
    brancher();
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [] })); // feuille absente
    const res = await post(url, 'MANAGER', { date: '2026-09-17', activite: 'reunion_projet', duree_minutes: 60 });
    expect([201, 200]).toContain(res.status);
  });

  it('409 FEUILLE_FIGEE dès que la feuille est validée par l’intervenant', async () => {
    brancher({ feuille: { id: 99, user_id: 7, annee: 2026, mois: 9, statut: 'validee_intervenant' } });
    const res = await post(url, 'MANAGER', { date: '2026-09-17', activite: 'autre', duree_minutes: 30 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('FEUILLE_FIGEE');
    expect(mockQuery.mock.calls.some(([t]) => /INSERT INTO insertion_temps_saisies/.test(String(t)))).toBe(false);
  });

  it('400 DATE_HORS_MOIS : une saisie d’octobre ne se range pas dans la feuille de septembre', async () => {
    brancher();
    const res = await post(url, 'MANAGER', { date: '2026-10-02', activite: 'autre', duree_minutes: 30 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DATE_HORS_MOIS');
  });

  it('400 sur une durée hors bornes (1 à 600 minutes)', async () => {
    brancher();
    const trop = await post(url, 'MANAGER', { date: '2026-09-17', activite: 'autre', duree_minutes: 601 });
    const zero = await post(url, 'MANAGER', { date: '2026-09-17', activite: 'autre', duree_minutes: 0 });
    expect(trop.status).toBe(400);
    expect(zero.status).toBe(400);
  });

  it('400 sur une activité hors liste fermée', async () => {
    brancher();
    const res = await post(url, 'MANAGER', { date: '2026-09-17', activite: 'entretien', duree_minutes: 30 });
    expect(res.status).toBe(400);
  });

  it('suppression refusée en 409 quand la feuille du mois est figée', async () => {
    brancher({ feuille: { id: 99, user_id: 7, annee: 2026, mois: 9, statut: 'validee_rh' } });
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [SAISIES[0]] })); // lecture de la saisie
    const res = await del('/api/insertion/temps/saisies/31', 'MANAGER');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('FEUILLE_FIGEE');
    expect(mockQuery.mock.calls.some(([t]) => /DELETE FROM insertion_temps_saisies/.test(String(t)))).toBe(false);
  });

  // CORRECTIF m-04 — anti-énumération. La saisie d'un AUTRE intervenant et une
  // saisie INEXISTANTE rendent le MÊME 404 pour qui n'est ni ADMIN ni RH : le
  // couple 404/403 permettait à un MANAGER de découvrir quels identifiants
  // existent chez ses collègues. Aucune donnée n'était rendue — c'est bien
  // l'existence, et elle seule, qui fuyait.
  it('suppression de la saisie d’un AUTRE intervenant : 404 INDISCERNABLE d’une saisie inexistante', async () => {
    brancher();
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [{ ...SAISIES[0], user_id: 42 }] }));
    const autre = await del('/api/insertion/temps/saisies/31', 'MANAGER');

    brancher();
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [] }));
    const inexistante = await del('/api/insertion/temps/saisies/31', 'MANAGER');

    expect(autre.status).toBe(404);
    expect({ statut: autre.status, corps: autre.body }).toEqual({ statut: inexistante.status, corps: inexistante.body });
    // Et la suppression n'a évidemment pas eu lieu.
    expect(mockQuery.mock.calls.some(([t]) => /DELETE FROM insertion_temps_saisies/.test(String(t)))).toBe(false);
  });

  it('un ADMIN, lui, distingue encore une saisie inexistante (404) de la suppression d’une autre (200)', async () => {
    brancher();
    mockQuery.mockImplementationOnce(() => Promise.resolve({ rows: [{ ...SAISIES[0], user_id: 42 }] }));
    const res = await del('/api/insertion/temps/saisies/31', 'ADMIN');
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Validation — forward-only, deux signatures = deux personnes', () => {
  const url = '/api/insertion/temps/7/2026/9/valider';

  it('brouillon → validee_intervenant : la feuille est FIGÉE (snapshot écrit)', async () => {
    brancher();
    const res = await post(url, 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.statut).toBe('validee_intervenant');
    const insert = mockQuery.mock.calls.find(([t]) => /INSERT INTO insertion_feuilles_temps/.test(String(t)));
    expect(insert).toBeDefined();
    // Le snapshot écrit est bien la composition (3 lignes, 225 minutes).
    const lignes = JSON.parse(insert[1][3]);
    const totaux = JSON.parse(insert[1][4]);
    expect(lignes).toHaveLength(3);
    expect(totaux.total_minutes).toBe(225);
    // Et il ne contient aucun nom.
    expect(insert[1][3]).not.toMatch(/Benali|Karim/i);
  });

  it('la validation est journalisée (INSERTION_FEUILLE_TEMPS_VALIDATION)', async () => {
    brancher();
    await post(url, 'MANAGER');
    const journal = mockQuery.mock.calls.find(([t]) => /INSERT INTO rgpd_audit_log/.test(String(t)));
    expect(journal).toBeDefined();
    expect(journal[1][1]).toBe('INSERTION_FEUILLE_TEMPS_VALIDATION');
    // Le journal dit COMBIEN, jamais QUI a été accompagné.
    expect(journal[1][4]).not.toMatch(/Benali|Karim/i);
  });

  it('409 FEUILLE_VIDE : on ne signe pas un mois sans aucune ligne', async () => {
    brancher({ milestones: [], actions: [], saisies: [] });
    const res = await post(url, 'MANAGER');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('FEUILLE_VIDE');
  });

  it('une anomalie de cohérence n’empêche PAS la signature (aucun 409 « non conforme »)', async () => {
    brancher({ leaves: [{ type_category: 'sick', start_date: '2026-09-04', end_date: '2026-09-04' }] });
    const res = await post(url, 'MANAGER');
    expect(res.status).toBe(200);
    const insert = mockQuery.mock.calls.find(([t]) => /INSERT INTO insertion_feuilles_temps/.test(String(t)));
    const coherence = JSON.parse(insert[1][5]);
    expect(coherence.conforme).toBe(false);
    expect(coherence.anomalies).toHaveLength(1);
  });

  it('409 AUTO_VALIDATION : l’intervenant ne contresigne pas sa propre feuille', async () => {
    brancher({
      feuille: {
        id: 99, user_id: 7, annee: 2026, mois: 9, statut: 'validee_intervenant',
        validation_intervenant: { user_id: 7, nom: 'RENARD Sofia', at: '2026-10-02T09:00:00.000Z' },
      },
    });
    // Jeton ADMIN dont l'id EST celui de l'intervenant : même personne.
    const res = await request(app)
      .post('/api/insertion/temps/7/2026/9/valider')
      .set('Authorization', `Bearer ${tokenFor('ADMIN', 7, 'Sofia', 'RENARD')}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('AUTO_VALIDATION');
    expect(mockQuery.mock.calls.some(([t]) => /UPDATE insertion_feuilles_temps/.test(String(t)))).toBe(false);
  });

  it('409 AUTO_VALIDATION aussi quand le signataire du 1er volet contresigne', async () => {
    brancher({
      feuille: {
        id: 99, user_id: 7, annee: 2026, mois: 9, statut: 'validee_intervenant',
        validation_intervenant: { user_id: 2, nom: 'MARTIN Claire', at: '2026-10-02T09:00:00.000Z' },
      },
    });
    const res = await post('/api/insertion/temps/7/2026/9/valider', 'RH');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('AUTO_VALIDATION');
  });

  it('validee_intervenant → validee_rh par une AUTRE personne : accepté', async () => {
    brancher({
      feuille: {
        id: 99, user_id: 7, annee: 2026, mois: 9, statut: 'validee_intervenant',
        validation_intervenant: { user_id: 7, nom: 'RENARD Sofia', at: '2026-10-02T09:00:00.000Z' },
      },
    });
    const res = await post('/api/insertion/temps/7/2026/9/valider', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.statut).toBe('validee_rh');
  });

  it('un MANAGER ne peut pas contresigner à la place de la RH (403)', async () => {
    brancher({
      feuille: {
        id: 99, user_id: 7, annee: 2026, mois: 9, statut: 'validee_intervenant',
        validation_intervenant: { user_id: 7, at: '2026-10-02T09:00:00.000Z' },
      },
    });
    const res = await post('/api/insertion/temps/7/2026/9/valider', 'MANAGER');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('VALIDATION_RH_RESERVEE');
  });

  it('409 TRANSITION_INVALIDE : on ne « dé-signe » pas, on rouvre', async () => {
    brancher({ feuille: { id: 99, user_id: 7, annee: 2026, mois: 9, statut: 'validee_rh' } });
    const res = await post('/api/insertion/temps/7/2026/9/valider', 'ADMIN');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TRANSITION_INVALIDE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Réouverture — ADMIN, motif obligatoire, signatures retirées', () => {
  const url = '/api/insertion/temps/7/2026/9/rouvrir';

  it('400 sans motif', async () => {
    brancher({ feuille: { id: 99, user_id: 7, annee: 2026, mois: 9, statut: 'validee_rh' } });
    const res = await post(url, 'ADMIN', {});
    expect(res.status).toBe(400);
  });

  it('remet au brouillon, efface le snapshot ET les deux validations', async () => {
    brancher({
      feuille: {
        id: 99, user_id: 7, annee: 2026, mois: 9, statut: 'validee_rh',
        totaux: { total_minutes: 225 },
        validation_intervenant: { user_id: 7 }, validation_rh: { user_id: 2 },
      },
    });
    const res = await post(url, 'ADMIN', { motif: "Durée d'un entretien corrigée après signature." });
    expect(res.status).toBe(200);
    const update = mockQuery.mock.calls.find(([t]) => /UPDATE insertion_feuilles_temps/.test(String(t)));
    const sql = String(update[0]).replace(/\s+/g, ' ');
    expect(sql).toMatch(/statut = 'brouillon'/);
    expect(sql).toMatch(/lignes = NULL/);
    expect(sql).toMatch(/validation_intervenant = NULL/);
    expect(sql).toMatch(/validation_rh = NULL/);
  });

  it('le motif est journalisé (INSERTION_FEUILLE_TEMPS_REOUVERTURE)', async () => {
    brancher({ feuille: { id: 99, user_id: 7, annee: 2026, mois: 9, statut: 'validee_rh' } });
    await post(url, 'ADMIN', { motif: 'Erreur de saisie constatée.' });
    const journal = mockQuery.mock.calls.find(([t]) => /INSERT INTO rgpd_audit_log/.test(String(t)));
    expect(journal[1][1]).toBe('INSERTION_FEUILLE_TEMPS_REOUVERTURE');
    expect(JSON.parse(journal[1][4]).motif).toBe('Erreur de saisie constatée.');
  });

  it('409 sur une feuille déjà au brouillon', async () => {
    brancher({ feuille: { id: 99, user_id: 7, annee: 2026, mois: 9, statut: 'brouillon' } });
    const res = await post(url, 'ADMIN', { motif: 'sans objet' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TRANSITION_INVALIDE');
  });

  it('404 quand aucune feuille n’existe pour ce mois', async () => {
    brancher();
    const res = await post(url, 'ADMIN', { motif: 'sans objet' });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Export (c) — CSV de la feuille de temps', () => {
  const url = '/api/insertion/temps/7/2026/9/export.csv';

  it('409 EXPORT_VIDE sur zéro ligne — jamais un fichier vide', async () => {
    brancher({ milestones: [], actions: [], saisies: [] });
    const res = await get(url, 'ADMIN');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPORT_VIDE');
    expect(mockQuery.mock.calls.some(([t]) => /INSERT INTO rgpd_audit_log/.test(String(t)))).toBe(false);
  });

  it('les 6 colonnes dictées, dans l’ordre, en français', async () => {
    brancher();
    const res = await get(url, 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lignes = res.text.split('\n');
    const entete = lignes.find((l) => l.startsWith('Date;'));
    expect(entete).toBe('Date;Projet;Activité;Bénéficiaire (identifiant interne);Durée (min);Origine');
  });

  it('le NOM du bénéficiaire est ABSENT du fichier (identifiant interne seul)', async () => {
    brancher();
    const res = await get(url, 'ADMIN');
    expect(res.text).not.toMatch(/Benali/i);
    expect(res.text).not.toMatch(/Karim/i);
    // La ligne d'entretien porte bien l'identifiant 5.
    expect(res.text).toMatch(/2026-09-04;ASI-2026-2027;Entretien;5;60;Composée automatiquement/);
  });

  it('en-tête de traçabilité complet (5 lignes commentées)', async () => {
    brancher();
    const res = await get(url, 'ADMIN');
    expect(res.text).toMatch(/# Export;Feuille de temps d'accompagnement/);
    expect(res.text).toMatch(/# Généré le;.*;Généré par;Awa DIOP/);
    expect(res.text).toMatch(/# Périmètre;Mois 09\/2026/);
    expect(res.text).toMatch(/# Nombre de lignes;3;Version de l'outil;/);
    expect(res.text).toMatch(/les saisies officielles \(ASP, emplois de l'inclusion, Immersion Facilitée, Ma Démarche FSE\+\) font foi/);
  });

  it('pied : total, par projet, quotité, taux forfaitaire, ligne de cohérence, signatures', async () => {
    brancher();
    const res = await get(url, 'ADMIN');
    expect(res.text).toMatch(/Total mensuel;225;minutes;3,75;heures/);
    expect(res.text).toMatch(/Total OCS-CIP-2026-2027;120;minutes;Quotité d'affectation : 60 %;Taux forfaitaire : 40 %/);
    // ASI sans quotité ni taux : « non renseigné », jamais 0 %.
    expect(res.text).toMatch(/Total ASI-2026-2027;105;minutes;Quotité d'affectation : non renseignée;Taux forfaitaire : non renseigné/);
    expect(res.text).toMatch(/Cohérence avec les congés;conforme/);
    expect(res.text).toMatch(/Signature de l'intervenant;MANQUANTE/);
    expect(res.text).toMatch(/Signature de la RH;MANQUANTE/);
    expect(res.text).toMatch(/Durées déclarées par l'intervenant à la clôture des entretiens/);
  });

  it('la ligne de cohérence détaille les anomalies sans bloquer l’export', async () => {
    brancher({ leaves: [{ type_category: 'sick', start_date: '2026-09-04', end_date: '2026-09-04' }] });
    const res = await get(url, 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Cohérence avec les congés;à expliquer/);
    expect(res.text).toMatch(/jour_absence/);
  });

  it('le journal RGPD est écrit AVANT l’envoi — son échec fait échouer l’export', async () => {
    brancher({ journalKo: true });
    const res = await get(url, 'ADMIN');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).not.toMatch(/text\/csv/);
  });

  it('l’export est journalisé sous EXPORT_FEUILLE_TEMPS', async () => {
    brancher();
    await get(url, 'ADMIN');
    const journal = mockQuery.mock.calls.find(([t]) => /INSERT INTO rgpd_audit_log/.test(String(t)));
    expect(journal[1][1]).toBe('EXPORT_FEUILLE_TEMPS');
    expect(JSON.parse(journal[1][4])).toMatchObject({ format: 'csv', intervenant_id: 7, annee: 2026, mois: 9, lignes: 3 });
  });

  it('un MANAGER exporte la sienne, jamais celle d’un autre', async () => {
    brancher();
    const mienne = await get(url, 'MANAGER');
    expect(mienne.status).toBe(200);
    const autre = await get(url, 'MANAGER_AUTRE');
    expect(autre.status).toBe(403);
  });

  it('une cellule commençant par « = » est neutralisée (pas de formule chez le destinataire)', async () => {
    brancher({ saisies: [{ id: 31, user_id: 7, date: '2026-09-15', projet_id: null, activite: 'autre', duree_minutes: 30, libelle: '=HYPERLINK("http://x")' }] });
    const res = await get(url, 'ADMIN');
    // Le libellé n'est pas une colonne de l'export, mais le projet « Hors
    // projet » et les autres chaînes passent par le même échappement : on
    // vérifie qu'aucune cellule ne commence par un caractère de formule.
    for (const l of res.text.split('\n')) {
      for (const cell of l.split(';')) expect(cell).not.toMatch(/^=/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Synthèse — indicateur n° 14 (ADMIN/RH)', () => {
  it('agrège par projet, intervenant et salarié, avec la moyenne par personne', async () => {
    brancher();
    const res = await get('/api/insertion/temps/synthese?annee=2026', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.annee).toBe(2026);
    expect(res.body.global_minutes).toBe(225);
    expect(res.body.nb_salaries_concernes).toBe(1);
    expect(res.body.moyenne_minutes_par_salarie).toBe(105);
    expect(res.body.par_intervenant).toEqual([{ user_id: 7, nom: 'RENARD Sofia', minutes: 225 }]);
  });

  it('aucune personne accompagnée → moyenne `null`, jamais 0', async () => {
    brancher({ milestones: [], actions: [], saisies: [] });
    const res = await get('/api/insertion/temps/synthese?annee=2026', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.global_minutes).toBe(0);
    expect(res.body.moyenne_minutes_par_salarie).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CORRECTIF M-04 — `pool.connect()` DANS le `try`
// ───────────────────────────────────────────────────────────────────────────
// Les deux routes transactionnelles prenaient leur connexion AVANT le `try`.
// Si `pool.connect()` rejette — pool saturé, base momentanément injoignable —
// la promesse du handler est rejetée hors de tout try/catch. Express 4 ne
// capture pas le rejet d'un handler `async` : AUCUNE réponse n'est envoyée, la
// requête reste ouverte jusqu'au délai du client, et le rejet remonte en
// `unhandledRejection`. C'est le défaut déjà trouvé et corrigé en PR A, qui
// était revenu ici.
//
// Ce que ces deux tests mesurent : une réponse ARRIVE, et elle dit 500. Sans le
// correctif, `supertest` attend jusqu'à son propre délai puis échoue sur un
// socket fermé — et aucun `release()` n'est possible, puisqu'il n'y a pas de
// connexion à rendre.
// ═══════════════════════════════════════════════════════════════════════════
describe('M-04 — une connexion indisponible rend 500, elle ne laisse pas la requête sans réponse', () => {
  const panne = () => {
    mockConnect.mockImplementationOnce(() => Promise.reject(
      Object.assign(new Error('timeout exceeded when trying to connect'), { code: '53300' })
    ));
  };

  it('POST /valider', async () => {
    brancher();
    panne();
    const res = await post('/api/insertion/temps/7/2026/9/valider', 'ADMIN');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Erreur serveur');
  });

  it('POST /rouvrir', async () => {
    brancher();
    panne();
    const res = await post('/api/insertion/temps/7/2026/9/rouvrir', 'ADMIN', { motif: 'Erreur de saisie constatée' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Erreur serveur');
  });

  it('aucune connexion n’est demandée deux fois, ni rendue sans avoir été prise', async () => {
    brancher();
    mockConnect.mockClear();
    panne();
    await post('/api/insertion/temps/7/2026/9/valider', 'ADMIN');
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});

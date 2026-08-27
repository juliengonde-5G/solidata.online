// ═══════════════════════════════════════════════════════════════════════════
// TEST DE CONTRAT — REFONTE DU PLANNING HEBDOMADAIRE (lot L5, 26/08/2026)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille les trois règles de la refonte, celles qui se briseraient en
// silence si quelqu'un « rangeait » le code plus tard :
//
//   1. Le planning des BOUTIQUES est géré hors logiciel : plus de filière ni
//      de poste `btq`, et les affectations historiques `BTQ_*` ne remontent
//      plus — sans jamais être supprimées de la base.
//   2. La collecte se planifie PAR VÉHICULE RÉEL (`COLL_VEH_<id>`), liste
//      lue dans `vehicles` : le parc évolue sans toucher au code. Un poste
//      de collecte ne s'invente pas — parc illisible = motif exposé.
//   3. Les ÉQUIPAGES remontent de la gestion de la collecte (`tours`) en
//      lecture seule : chauffeur + suiveurs en « NOM Prénom », statut de la
//      tournée. Un chauffeur non identifié vaut `null`, jamais un nom vide.
//
// Verrouille aussi le drapeau `est_permanent` (permanents vs salariés en
// parcours) et la matrice d'habilitations lecture/écriture.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} })),
}));

const express = require('express');
const request = require('supertest');

const app = express();
app.use(express.json());
app.use('/api/planning-hebdo', require('../../src/routes/planning-hebdo'));

const jeton = (role, id = 1) => jwt.sign({ id, username: 'u', role }, JWT_SECRET, { expiresIn: '1h' });
const ADMIN = jeton('ADMIN');
const MANAGER = jeton('MANAGER', 3);
const RH = jeton('RH', 4);
const RESP_BTQ = jeton('RESP_BTQ', 7);

// ── Jeu de données ─────────────────────────────────────────────────────────
const VEHICULES = [
  { id: 1, registration: 'AA-111-AA', name: 'Renault Master', status: 'available' },
  { id: 2, registration: 'BB-222-BB', name: 'Iveco Daily', status: 'in_use' },
  { id: 3, registration: 'CC-333-CC', name: 'Fiat Ducato', status: 'maintenance' },
];

const SCHEDULE = [
  { id: 1, employee_id: 1, date: '2026-08-24', poste_code: 'COLL_VEH_1', periode: 'matin', first_name: 'Marc', last_name: 'DUPONT', insertion_status: 'none', est_permanent: true },
  { id: 2, employee_id: 3, date: '2026-08-24', poste_code: 'COLL_CHAUFF', periode: 'journee', first_name: 'Ali', last_name: 'ZOUAOUI', insertion_status: 'en_parcours', est_permanent: false },
];

const EMPLOYES = [
  { id: 1, first_name: 'Marc', last_name: 'DUPONT', insertion_status: 'none', est_permanent: true, jours_off: null },
  { id: 3, first_name: 'Ali', last_name: 'ZOUAOUI', insertion_status: 'en_parcours', est_permanent: false, jours_off: ['samedi'] },
];

const TOURNEES = [
  {
    tour_id: 10, date: '2026-08-24', status: 'in_progress', vehicle_id: 1,
    registration: 'AA-111-AA', vehicle_name: 'Renault Master',
    driver_employee_id: 1, driver_first_name: 'Marc', driver_last_name: 'DUPONT',
    suiveur1_employee_id: 3, suiveur1_first_name: 'Ali', suiveur1_last_name: 'ZOUAOUI',
    suiveur2_employee_id: null, suiveur2_first_name: null, suiveur2_last_name: null,
  },
  {
    tour_id: 11, date: '2026-08-25', status: 'planned', vehicle_id: 2,
    registration: 'BB-222-BB', vehicle_name: 'Iveco Daily',
    driver_employee_id: null, driver_first_name: null, driver_last_name: null,
    suiveur1_employee_id: null, suiveur1_first_name: null, suiveur1_last_name: null,
    suiveur2_employee_id: null, suiveur2_first_name: null, suiveur2_last_name: null,
  },
];

/**
 * Route les requêtes par expression régulière sur le SQL. `echecs` permet de
 * simuler la panne d'une source (parc, tournées) pour prouver la dégradation.
 */
function installerMocks({ echecs = [] } = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    const tombe = (cle) => echecs.includes(cle);
    if (/FROM postes_operation/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM schedule s/.test(s)) return Promise.resolve({ rows: SCHEDULE });
    if (/FROM tours t/.test(s)) {
      return tombe('tours')
        ? Promise.reject(new Error('relation "tours" indisponible'))
        : Promise.resolve({ rows: TOURNEES });
    }
    if (/FROM work_hours/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM employees e/.test(s)) return Promise.resolve({ rows: EMPLOYES });
    if (/FROM vehicles/.test(s)) {
      return tombe('vehicles')
        ? Promise.reject(new Error('relation "vehicles" indisponible'))
        : Promise.resolve({ rows: VEHICULES });
    }
    return Promise.resolve({ rows: [] });
  });
}

const getPostes = (t = ADMIN) => request(app).get('/api/planning-hebdo/postes').set('Authorization', `Bearer ${t}`);
const getSemaine = (t = ADMIN, q = '?week_start=2026-08-24') =>
  request(app).get(`/api/planning-hebdo${q}`).set('Authorization', `Bearer ${t}`);

beforeEach(() => { mockQuery.mockReset(); installerMocks(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('GET /postes — les boutiques sortent, les véhicules entrent', () => {
  it('ne propose plus ni filière ni poste boutique', async () => {
    const res = await getPostes();
    expect(res.status).toBe(200);
    expect(res.body.filieres.map(f => f.code)).toEqual(['tri', 'collecte', 'logistique']);
    expect(res.body.postes.some(p => p.filiere === 'btq')).toBe(false);
    expect(res.body.postes.some(p => String(p.code).toUpperCase().startsWith('BTQ'))).toBe(false);
  });

  it('génère un poste par véhicule réel — la liste suit le parc', async () => {
    const res = await getPostes();
    const collecte = res.body.postes.filter(p => p.filiere === 'collecte');
    expect(collecte).toHaveLength(VEHICULES.length);
    expect(collecte.map(p => p.code)).toEqual(['COLL_VEH_1', 'COLL_VEH_2', 'COLL_VEH_3']);
    expect(collecte.map(p => p.nom)).toEqual(['AA-111-AA', 'BB-222-BB', 'CC-333-CC']);
    expect(collecte.map(p => p.vehicle_id)).toEqual([1, 2, 3]);
    // Ni obligatoire ni exigeant le permis : c'est une ligne de planning, pas
    // une habilitation — le permis se contrôle au Planning tournées.
    expect(collecte.every(p => p.obligatoire === false)).toBe(true);
    expect(collecte.every(p => p.permet_doublure === true)).toBe(true);
    expect(collecte.every(p => p.require_permis_b === false)).toBe(true);
  });

  it('exclut le parc de démonstration et les véhicules hors service (au SQL)', async () => {
    await getPostes();
    const sqlVehicules = mockQuery.mock.calls
      .map(c => String(c[0]).replace(/\s+/g, ' '))
      .find(s => /FROM vehicles/.test(s));
    expect(sqlVehicules).toMatch(/COALESCE\(is_demo, false\) = false/);
    expect(sqlVehicules).toMatch(/status <> 'out_of_service'/);
  });

  it('parc illisible : aucun poste inventé, le motif est exposé', async () => {
    installerMocks({ echecs: ['vehicles'] });
    const res = await getPostes();
    expect(res.status).toBe(200); // la page reste utilisable pour le tri
    expect(res.body.postes.filter(p => p.filiere === 'collecte')).toHaveLength(0);
    expect(res.body.collecte_indisponible).toMatch(/parc de véhicules/i);
    // Surtout pas de repli « Chauffeur / Ripeur » sans rapport avec le parc.
    expect(res.body.postes.some(p => String(p.code).startsWith('COLL_CHAUFF'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET / — les équipages remontent de la gestion de la collecte', () => {
  it('expose la tournée du jour par véhicule, noms en « NOM Prénom »', async () => {
    const res = await getSemaine();
    expect(res.status).toBe(200);
    const [t1, t2] = res.body.collecte_tournees;
    expect(t1).toMatchObject({
      date: '2026-08-24', tour_id: 10, vehicle_id: 1,
      registration: 'AA-111-AA', statut: 'in_progress',
    });
    expect(t1.chauffeur).toMatchObject({ employee_id: 1, nom: 'DUPONT Marc' });
    expect(t1.suiveurs).toEqual([expect.objectContaining({ employee_id: 3, nom: 'ZOUAOUI Ali' })]);
    // Un suiveur non renseigné n'occupe pas de place vide dans la liste.
    expect(t1.suiveurs).toHaveLength(1);
    expect(t2.chauffeur).toBeNull(); // chauffeur non identifié : jamais inventé
    expect(t2.suiveurs).toEqual([]);
  });

  it('ne remonte que les tournées d’exploitation de la semaine (au SQL)', async () => {
    await getSemaine();
    const sqlTours = mockQuery.mock.calls
      .map(c => String(c[0]).replace(/\s+/g, ' '))
      .find(s => /FROM tours t/.test(s));
    expect(sqlTours).toMatch(/COALESCE\(t\.is_demo, false\) = false/);
    expect(sqlTours).toMatch(/t\.date >= \$1 AND t\.date <= \$2/);
    const params = mockQuery.mock.calls.find(c => /FROM tours t/.test(String(c[0])))[1];
    expect(params).toEqual(['2026-08-24', '2026-08-29']);
  });

  it('tournées illisibles : null + motif, jamais « aucune tournée »', async () => {
    installerMocks({ echecs: ['tours'] });
    const res = await getSemaine();
    expect(res.status).toBe(200);
    expect(res.body.collecte_tournees).toBeNull();
    expect(res.body.collecte_indisponible).toMatch(/tournées de la semaine/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('GET / — permanents, boutiques, semaine', () => {
  it('distingue les permanents des salariés en parcours', async () => {
    const res = await getSemaine();
    expect(res.body.employees.map(e => e.est_permanent)).toEqual([true, false]);
    expect(res.body.employees.map(e => e.insertion_status)).toEqual(['none', 'en_parcours']);
    const sqlEmployes = mockQuery.mock.calls
      .map(c => String(c[0]).replace(/\s+/g, ' '))
      .find(s => /FROM employees e LEFT JOIN teams/.test(s));
    expect(sqlEmployes).toMatch(/insertion_status IS DISTINCT FROM 'en_parcours'\) AS est_permanent/);
  });

  it('écarte les affectations boutique de la réponse SANS les supprimer', async () => {
    const res = await getSemaine();
    const sqlSchedule = mockQuery.mock.calls
      .map(c => String(c[0]).replace(/\s+/g, ' '))
      .find(s => /FROM schedule s/.test(s));
    expect(sqlSchedule).toMatch(/NOT LIKE 'BTQ!_%' ESCAPE '!'/);
    // Aucune suppression : le lot ne doit jamais écrire dans schedule en lecture.
    const ecritures = mockQuery.mock.calls
      .map(c => String(c[0]))
      .filter(s => /DELETE FROM schedule|UPDATE schedule|INSERT INTO schedule/i.test(s));
    expect(ecritures).toEqual([]);
    // Un poste historique inconnu du référentiel reste lisible (« Anciens postes »).
    expect(res.body.affectations.map(a => a.poste_code)).toContain('COLL_CHAUFF');
  });

  it('calcule la semaine du lundi au samedi et refuse une date illisible', async () => {
    const res = await getSemaine(ADMIN, '?week_start=2026-08-27'); // un jeudi
    expect(res.body.week_start).toBe('2026-08-24');
    expect(res.body.dates).toHaveLength(6);
    expect(res.body.dates[5]).toBe('2026-08-29');
    expect(res.body.jours[0]).toBe('Lundi');

    const ko = await getSemaine(ADMIN, '?week_start=hier');
    expect(ko.status).toBe(400);
    expect(ko.body.code).toBe('WEEK_START_INVALIDE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Habilitations', () => {
  it('RESP_BTQ : 200 vide et motivé sur les deux lectures (jamais 500)', async () => {
    const postes = await getPostes(RESP_BTQ);
    expect(postes.status).toBe(200);
    expect(postes.body).toEqual({ filieres: [], postes: [], message: expect.stringMatching(/hors logiciel/) });

    const semaine = await getSemaine(RESP_BTQ);
    expect(semaine.status).toBe(200);
    expect(semaine.body.message).toMatch(/hors logiciel/);
    expect(semaine.body.affectations).toEqual([]);
    expect(semaine.body.employees).toEqual([]);
    expect(semaine.body.collecte_tournees).toEqual([]);
  });

  // Reprend la couverture de l'ancienne suite `planning-hebdo-resp-btq-vague3`,
  // que la refonte rend caduque : RESP_BTQ n'écrit rien et ne cherche personne.
  it('RESP_BTQ : aucune écriture, aucune recherche de salarié', async () => {
    const post = await request(app).post('/api/planning-hebdo/affecter')
      .set('Authorization', `Bearer ${RESP_BTQ}`).send({ employee_id: 1, date: '2026-08-24' });
    expect(post.status).toBe(403);

    const del = await request(app).delete('/api/planning-hebdo/affecter')
      .set('Authorization', `Bearer ${RESP_BTQ}`).send({ employee_id: 1, date: '2026-08-24' });
    expect(del.status).toBe(403);

    const confirmer = await request(app).post('/api/planning-hebdo/confirmer')
      .set('Authorization', `Bearer ${RESP_BTQ}`).send({ week_start: '2026-08-24' });
    expect(confirmer.status).toBe(403);

    const dispo = await request(app).get('/api/planning-hebdo/employes-disponibles?date=2026-08-24')
      .set('Authorization', `Bearer ${RESP_BTQ}`);
    expect(dispo.status).toBe(403);
  });

  it('RH lit, mais n’écrit pas', async () => {
    expect((await getSemaine(RH)).status).toBe(200);
    expect((await getPostes(RH)).status).toBe(200);
    const ecrit = await request(app).post('/api/planning-hebdo/affecter')
      .set('Authorization', `Bearer ${RH}`).send({ employee_id: 1, date: '2026-08-24' });
    expect(ecrit.status).toBe(403);
  });

  it('MANAGER écrit ; sans jeton, tout est fermé', async () => {
    const ecrit = await request(app).post('/api/planning-hebdo/affecter')
      .set('Authorization', `Bearer ${MANAGER}`).send({ employee_id: 1, date: '2026-08-24' });
    expect(ecrit.status).not.toBe(403);
    expect((await request(app).get('/api/planning-hebdo/postes')).status).toBe(401);
    expect((await request(app).get('/api/planning-hebdo')).status).toBe(401);
  });

  it('la recherche d’employés disponibles expose aussi le drapeau permanent', async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/planning-hebdo/employes-disponibles?date=2026-08-24')
      .set('Authorization', `Bearer ${ADMIN}`);
    expect(res.status).toBe(200);
    const sql = String(mockQuery.mock.calls[0][0]).replace(/\s+/g, ' ');
    expect(sql).toMatch(/IS DISTINCT FROM 'en_parcours'\) AS est_permanent/);
  });
});

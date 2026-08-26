// ═══════════════════════════════════════════════════════════════════════════
// TEST DE CONTRAT — DEMANDES DE COLLECTE DES ASSOCIATIONS (RG-B)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la forme de l'API que consomment le planning et la création de
// tournée, et surtout la règle qui fonde le module : LE STATUT EST DÉRIVÉ,
// JAMAIS STOCKÉ (RG-B7). Un statut rangé en colonne devrait être corrigé à
// chaque suppression de tournée ; la première désynchronisation ferait mentir
// l'écran, et l'écran est ici la seule chose que regarde le gestionnaire.
//
// Base mockée : ces tests décrivent le CONTRAT (codes, formes, garde-fous). La
// justesse du SQL de dérivation, elle, est prouvée sur PostgreSQL 16 réel.
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
const demandesRouter = require('../../src/routes/association-demandes');

const jeton = (role) => jwt.sign(
  { id: 1, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' },
);
const TOKEN = jeton('ADMIN');

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/association-demandes', demandesRouter);
});

// Une demande telle que la renvoie la requête de lecture (statut DÉRIVÉ).
const DEMANDE = {
  id: 7, association_point_id: 3, association_nom: 'Croix-Rouge Sotteville',
  date_souhaitee: '2026-09-07', heure_debut: '10:15:00', heure_fin: '10:45:00',
  tolerance_min: null, commentaire: 'Quai arrière', annulee_le: null,
  created_at: '2026-08-26T08:00:00.000Z', tour_id: null, statut: 'a_planifier',
};

// SQL réellement exécuté, pour inspection.
const sqlExecute = () => mockQuery.mock.calls.map(([s]) => String(s).replace(/\s+/g, ' '));
const lectures = () => sqlExecute().filter((s) => /FROM association_collecte_demandes d/.test(s));
const ecritures = () => sqlExecute().filter((s) => /(INSERT INTO|UPDATE) association_collecte_demandes/.test(s));

function installerMocks({ demande = DEMANDE, pointExiste = true, erreurEcriture = null } = {}) {
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/FROM association_points WHERE id/.test(s)) {
      return Promise.resolve({ rows: pointExiste ? [{ id: params[0] }] : [] });
    }
    if (/FROM association_collecte_demandes d/.test(s)) {
      return Promise.resolve({ rows: demande ? [demande] : [] });
    }
    if (/INSERT INTO association_collecte_demandes/.test(s)) {
      if (erreurEcriture) return Promise.reject(erreurEcriture);
      return Promise.resolve({ rows: [{ id: DEMANDE.id }] });
    }
    if (/UPDATE association_collecte_demandes/.test(s)) {
      if (erreurEcriture) return Promise.reject(erreurEcriture);
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => { mockQuery.mockReset(); installerMocks(); });

const get = (url) => request(app).get(url).set('Authorization', `Bearer ${TOKEN}`);
const post = (url, corps) => request(app).post(url).set('Authorization', `Bearer ${TOKEN}`).send(corps);
const put = (url, corps) => request(app).put(url).set('Authorization', `Bearer ${TOKEN}`).send(corps);

describe('accès', () => {
  test('sans jeton : 401', async () => {
    expect((await request(app).get('/api/association-demandes')).status).toBe(401);
  });
  test('un rôle hors ADMIN/MANAGER est refusé en lecture comme en écriture', async () => {
    for (const role of ['COLLABORATEUR', 'RH', 'AUTORITE']) {
      const t = jeton(role);
      expect((await request(app).get('/api/association-demandes').set('Authorization', `Bearer ${t}`)).status).toBe(403);
      expect((await request(app).post('/api/association-demandes').set('Authorization', `Bearer ${t}`).send({})).status).toBe(403);
    }
  });
  test('MANAGER lit ET écrit (les demandes arrivent par téléphone, il les saisit)', async () => {
    const t = jeton('MANAGER');
    expect((await request(app).get('/api/association-demandes').set('Authorization', `Bearer ${t}`)).status).toBe(200);
  });
});

describe('GET / — liste et statut dérivé', () => {
  test('la ligne renvoyée porte les 11 champs du contrat', async () => {
    const res = await get('/api/association-demandes');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body[0]).sort()).toEqual([
      'annulee_le', 'association_nom', 'association_point_id', 'commentaire', 'created_at',
      'date_souhaitee', 'heure_debut', 'heure_fin', 'id', 'statut', 'tolerance_min', 'tour_id',
    ]);
  });

  test('le statut est DÉRIVÉ en SQL, dans l’ordre exact de la table de vérité', async () => {
    await get('/api/association-demandes');
    const sql = lectures()[0];
    // Ordre imposé : annulée > à planifier > planifiée > honorée > non honorée.
    expect(sql).toMatch(/WHEN b\.annulee_le IS NOT NULL THEN 'annulee'/);
    expect(sql).toMatch(/WHEN p\.tour_id IS NULL THEN 'a_planifier'/);
    expect(sql).toMatch(/WHEN p\.tournee_ouverte THEN 'planifiee'/);
    expect(sql).toMatch(/WHEN p\.dans_fenetre THEN 'honoree'/);
    expect(sql).toMatch(/ELSE 'non_honoree'/);
    expect(sql.indexOf("'annulee'")).toBeLessThan(sql.indexOf("'a_planifier'"));
    expect(sql.indexOf("'a_planifier'")).toBeLessThan(sql.indexOf("'planifiee'"));
    expect(sql.indexOf("'planifiee'")).toBeLessThan(sql.indexOf("'honoree'"));
  });

  test('« planifiée » se lit sur une tournée NON close, « honorée » sur la fenêtre effective', async () => {
    await get('/api/association-demandes');
    const sql = lectures()[0];
    expect(sql).toMatch(/t\.status <> 'completed'/);
    expect(sql).toMatch(/tap\.collected_at >= b\.fenetre_debut AND tap\.collected_at <= b\.fenetre_fin/);
    expect(sql).toMatch(/COALESCE\(d\.tolerance_min, \$1::int\)/);
  });

  test('aucune écriture ne range un statut en colonne', async () => {
    await get('/api/association-demandes');
    await post('/api/association-demandes', { association_point_id: 3, date_souhaitee: '2026-09-07', heure_debut: '10:00' });
    for (const sql of ecritures()) expect(sql).not.toMatch(/\bstatut\b/);
  });

  test('la date est renvoyée en texte AAAA-MM-JJ (aucune dérive de fuseau possible)', async () => {
    await get('/api/association-demandes');
    expect(lectures()[0]).toMatch(/TO_CHAR\(d\.date_souhaitee, 'YYYY-MM-DD'\)/);
  });

  test('filtres du/au/statut/association_point_id passés en paramètres liés', async () => {
    await get('/api/association-demandes?du=2026-09-01&au=2026-09-30&statut=a_planifier&association_point_id=3');
    const [sql, params] = mockQuery.mock.calls.find(([s]) => /FROM association_collecte_demandes d/.test(String(s)));
    expect(String(sql)).toMatch(/d\.date_souhaitee >= \$\d+::date/);
    expect(String(sql)).toMatch(/d\.date_souhaitee <= \$\d+::date/);
    expect(String(sql)).toMatch(/q\.statut = \$\d+/);
    expect(params).toEqual([15, '2026-09-01', '2026-09-30', 3, 'a_planifier']);
  });

  test('un statut inconnu ou une date illisible sont refusés AVANT la base', async () => {
    const s1 = await get('/api/association-demandes?statut=en_cours');
    expect(s1.status).toBe(400);
    expect(s1.body.statuts).toEqual(['a_planifier', 'planifiee', 'honoree', 'non_honoree', 'annulee']);
    expect((await get('/api/association-demandes?du=01/09/2026')).status).toBe(400);
    expect(lectures()).toHaveLength(0);
  });
});

describe('POST / — enregistrer une demande', () => {
  const corpsValide = {
    association_point_id: 3, date_souhaitee: '2026-09-07',
    heure_debut: '10:15', heure_fin: '10:45', commentaire: 'Quai arrière',
  };

  test('201 avec la ligne relue, statut dérivé compris', async () => {
    const res = await post('/api/association-demandes', corpsValide);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(7);
    expect(res.body.statut).toBe('a_planifier');
  });

  test('l’auteur de la saisie est tracé (created_by)', async () => {
    await post('/api/association-demandes', corpsValide);
    const [sql, params] = mockQuery.mock.calls.find(([s]) => /INSERT INTO association_collecte_demandes/.test(String(s)));
    expect(String(sql)).toMatch(/created_by/);
    expect(params[6]).toBe(1);
  });

  test('un rendez-vous à heure exacte se saisit sans heure de fin', async () => {
    const res = await post('/api/association-demandes', { association_point_id: 3, date_souhaitee: '2026-09-07', heure_debut: '10:30' });
    expect(res.status).toBe(201);
    const [, params] = mockQuery.mock.calls.find(([s]) => /INSERT INTO association_collecte_demandes/.test(String(s)));
    expect(params[3]).toBeNull(); // heure_fin : absente, et non « devinée » égale au début
  });

  test('saisie fautive : 400 DEMANDE_INVALIDE listant TOUTES les erreurs', async () => {
    const res = await post('/api/association-demandes', { association_point_id: 'trois', date_souhaitee: '07/09/2026', heure_debut: '25:00' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DEMANDE_INVALIDE');
    expect(res.body.erreurs).toHaveLength(3);
    expect(ecritures()).toHaveLength(0);
  });

  test('un créneau qui finit avant de commencer est refusé', async () => {
    const res = await post('/api/association-demandes', { ...corpsValide, heure_debut: '11:00', heure_fin: '10:00' });
    expect(res.status).toBe(400);
    expect(res.body.erreurs.join(' ')).toMatch(/après son début/);
  });

  test('une tolérance hors bornes est refusée (jamais rabotée en silence)', async () => {
    const res = await post('/api/association-demandes', { ...corpsValide, tolerance_min: 1000 });
    expect(res.status).toBe(400);
    expect(res.body.erreurs.join(' ')).toMatch(/0 à 240/);
  });

  test('point association inconnu : 404, aucune écriture', async () => {
    installerMocks({ pointExiste: false });
    const res = await post('/api/association-demandes', corpsValide);
    expect(res.status).toBe(404);
    expect(ecritures()).toHaveLength(0);
  });

  test('deux demandes le même jour sur la même association : 409 DEMANDE_DOUBLON', async () => {
    const doublon = Object.assign(new Error('duplicate key'), { code: '23505' });
    installerMocks({ erreurEcriture: doublon });
    const res = await post('/api/association-demandes', corpsValide);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DEMANDE_DOUBLON');
  });
});

describe('PUT /:id — modifier une demande', () => {
  test('mise à jour partielle : seules les colonnes envoyées sont écrites', async () => {
    const res = await put('/api/association-demandes/7', { heure_debut: '09:30' });
    expect(res.status).toBe(200);
    const sql = ecritures()[0];
    expect(sql).toMatch(/SET heure_debut = \$1::time, updated_at = NOW\(\)/);
    expect(sql).not.toMatch(/commentaire/); // non envoyé donc non écrasé
  });

  test('une demande soldée par une tournée close n’est plus modifiable (409)', async () => {
    for (const statut of ['honoree', 'non_honoree']) {
      installerMocks({ demande: { ...DEMANDE, statut } });
      const res = await put('/api/association-demandes/7', { heure_debut: '09:30' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DEMANDE_CLOTUREE');
      expect(res.body.statut).toBe(statut);
      expect(ecritures()).toHaveLength(0);
    }
  });

  test('une demande planifiée reste modifiable (le rendez-vous se renégocie)', async () => {
    installerMocks({ demande: { ...DEMANDE, statut: 'planifiee', tour_id: 42 } });
    expect((await put('/api/association-demandes/7', { heure_debut: '09:30' })).status).toBe(200);
  });

  test('demande introuvable : 404', async () => {
    installerMocks({ demande: null });
    expect((await put('/api/association-demandes/7', { heure_debut: '09:30' })).status).toBe(404);
  });

  test('corps vide : la demande est renvoyée telle quelle, sans écriture', async () => {
    const res = await put('/api/association-demandes/7', {});
    expect(res.status).toBe(200);
    expect(ecritures()).toHaveLength(0);
  });

  test('créneau incohérent avec l’heure CONSERVÉE : refus 400', async () => {
    // La demande stockée commence à 10:15 ; on ne fournit qu'une fin à 09:00.
    const res = await put('/api/association-demandes/7', { heure_fin: '09:00' });
    expect(res.status).toBe(400);
    expect(ecritures()).toHaveLength(0);
  });

  test('déplacer la demande sur une date déjà prise : 409 DEMANDE_DOUBLON', async () => {
    const doublon = Object.assign(new Error('duplicate key'), { code: '23505' });
    installerMocks({ erreurEcriture: doublon });
    const res = await put('/api/association-demandes/7', { date_souhaitee: '2026-09-08' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DEMANDE_DOUBLON');
  });
});

describe('POST /:id/annuler — seul état posé à la main', () => {
  test('pose annulee_le et journalise le motif dans le commentaire', async () => {
    await post('/api/association-demandes/7/annuler', { motif: 'Local fermé' });
    const [sql, params] = mockQuery.mock.calls.find(([s]) => /UPDATE association_collecte_demandes/.test(String(s)));
    expect(String(sql)).toMatch(/SET annulee_le = NOW\(\)/);
    expect(params[1]).toBe('Annulation : Local fermé');
  });

  test('sans motif, le commentaire existant n’est pas touché', async () => {
    await post('/api/association-demandes/7/annuler', {});
    const [, params] = mockQuery.mock.calls.find(([s]) => /UPDATE association_collecte_demandes/.test(String(s)));
    expect(params[1]).toBe('');
  });

  test('annulation idempotente : la date d’annulation d’origine n’est pas réécrite', async () => {
    installerMocks({ demande: { ...DEMANDE, statut: 'annulee', annulee_le: '2026-08-20T09:00:00.000Z' } });
    const res = await post('/api/association-demandes/7/annuler', { motif: 'doublon' });
    expect(res.status).toBe(200);
    expect(res.body.statut).toBe('annulee');
    expect(ecritures()).toHaveLength(0);
  });

  test('demande introuvable : 404', async () => {
    installerMocks({ demande: null });
    expect((await post('/api/association-demandes/7/annuler', {})).status).toBe(404);
  });
});

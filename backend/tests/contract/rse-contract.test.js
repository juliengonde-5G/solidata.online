// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — MODULE PILOTAGE RSE (RSEI-10)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la forme de réponse et la matrice d'habilitations du 28e module
// (routes/rse.js) : lecture ADMIN/MANAGER/RH, écriture ADMIN/RH/MANAGER
// (MANAGER = base du rôle custom REF_RSE ; COLLABORATEUR reste refusé).
//   - GET  /rse/criteres            (lecture tiers)
//   - PUT  /rse/criteres/:code      (cotation, écriture A/RH)
//   - CRUD /rse/actions (+ /actions/export CSV)
//   - POST /rse/preuves             (génération référence P-AAAA-NNN)
//   - GET  /rse/dashboard           (heatmap 27 critères + indicateurs de succès)
//   - GET  /rse/dossier-afnor       (par critère : niveau + preuves + constat)
//   - GET  /rse/bilan?annee=        (plan d'action + niveaux + dernière évaluation)
//   - /rse/parties-prenantes, /rse/interactions, /rse/evaluations(+items)
//
// Auth réelle (JWT sans `tv` → pas de contrôle token_version), DB mockée,
// activity-logger mocké. Même harnais que insertion-contract.test.js.
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
const tokenFor = (role) => jwt.sign({ id: 1, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER'), COLLABORATEUR: tokenFor('COLLABORATEUR'),
};
const YEAR = new Date().getFullYear();

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/rse', require('../../src/routes/rse'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (path, role, body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const put = (path, role, body = {}) => request(app).put(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const del = (path, role) => request(app).delete(path).set('Authorization', `Bearer ${TOKENS[role]}`);

// ───────────────────────────────────────────────────────────────────────────
// CRITÈRES
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /rse/criteres', () => {
  it('GET : lecture ouverte ADMIN/MANAGER/RH, refusée COLLABORATEUR (403)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ code: '1.1', intitule: 'Projet', niveau_auto_evalue: null }] });
    for (const role of ['ADMIN', 'MANAGER', 'RH']) {
      const res = await get('/api/rse/criteres', role);
      expect(res.status).toBe(200);
    }
    expect((await get('/api/rse/criteres', 'COLLABORATEUR')).status).toBe(403);
  });

  it('PUT (écriture A/RH/MANAGER=REF_RSE) : COLLABORATEUR → 403', async () => {
    // L'écriture inclut MANAGER (base du rôle REF_RSE) ; un rôle hors périmètre
    // (COLLABORATEUR) reste refusé.
    expect((await put('/api/rse/criteres/1.1', 'COLLABORATEUR', { niveau_auto_evalue: 2 })).status).toBe(403);
  });

  it('PUT (RH) : cotation OK → 200 ; niveau hors 1-4 → 400 ; critère inconnu → 404', async () => {
    // niveau hors bornes
    expect((await put('/api/rse/criteres/1.1', 'RH', { niveau_vise: 5 })).status).toBe(400);

    // introuvable
    mockQuery.mockImplementation((sql) => {
      if (/UPDATE rsei_criteres/.test(String(sql))) return Promise.resolve({ rows: [], rowCount: 0 });
      return Promise.resolve({ rows: [] });
    });
    expect((await put('/api/rse/criteres/9.9', 'RH', { niveau_auto_evalue: 2 })).status).toBe(404);

    // OK
    mockQuery.mockImplementation((sql, params) => {
      if (/UPDATE rsei_criteres/.test(String(sql))) {
        return Promise.resolve({ rows: [{ code: '1.1', niveau_vise: params[0], niveau_auto_evalue: params[1] }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [] });
    });
    const ok = await put('/api/rse/criteres/1.1', 'RH', { niveau_vise: 3, niveau_auto_evalue: 2, commentaire: 'preuve à jour' });
    expect(ok.status).toBe(200);
    expect(ok.body.niveau_auto_evalue).toBe(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PLAN D'ACTION
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /rse/actions', () => {
  it('POST : COLLABORATEUR → 403 ; statut hors enum → 400 ; RH valide → 201', async () => {
    expect((await post('/api/rse/actions', 'COLLABORATEUR', { titre: 'X' })).status).toBe(403);
    expect((await post('/api/rse/actions', 'RH', { titre: 'X', statut: 'zzz' })).status).toBe(400);

    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO rsei_actions/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 7, titre: params[0], critere_codes: params[2], statut: params[7], priorite: params[8] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/rse/actions', 'RH', { titre: 'Écrire le plan d\'action RSE', critere_codes: ['1.5'], priorite: 'haute' });
    expect(res.status).toBe(201);
    expect(res.body.titre).toBe('Écrire le plan d\'action RSE');
    expect(res.body.priorite).toBe('haute');
    expect(res.body.statut).toBe('a_faire'); // défaut
  });

  it('GET : liste avec drapeau en_retard', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM rsei_actions a\s+LEFT JOIN users/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 1, titre: 'A', statut: 'a_faire', echeance: '2026-01-01', en_retard: true }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/rse/actions', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body[0].en_retard).toBe(true);
  });

  it('GET /actions/export?format=csv → CSV (route résolue avant tout /:id)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM rsei_actions a\s+LEFT JOIN users/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 1, titre: 'Action 1', description: null, critere_codes: ['1.1', '1.5'], indicateur: 'x', echeance: '2026-06-01', moyens: null, statut: 'en_cours', priorite: 'haute', created_at: '2026-01-01', responsable_nom: 'A B' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/rse/actions/export?format=csv', 'RH');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('Titre');
    expect(res.text).toContain('Action 1');
    expect(res.text).toContain('1.1, 1.5'); // critere_codes sérialisés
  });

  it('PUT / DELETE (A/RH) : 200 quand la ligne existe', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/UPDATE rsei_actions SET/.test(s)) return Promise.resolve({ rows: [{ id: 1, statut: 'realise' }], rowCount: 1 });
      if (/DELETE FROM rsei_actions/.test(s)) return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 });
      return Promise.resolve({ rows: [] });
    });
    expect((await put('/api/rse/actions/1', 'RH', { statut: 'realise' })).status).toBe(200);
    expect((await del('/api/rse/actions/1', 'ADMIN')).status).toBe(200);
    expect((await del('/api/rse/actions/1', 'COLLABORATEUR')).status).toBe(403);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// REGISTRE DE PREUVES — génération P-AAAA-NNN
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /rse/preuves (référence P-AAAA-NNN)', () => {
  it('POST : COLLABORATEUR → 403 ; intitulé manquant → 400', async () => {
    expect((await post('/api/rse/preuves', 'COLLABORATEUR', { intitule: 'X' })).status).toBe(403);
    expect((await post('/api/rse/preuves', 'RH', {})).status).toBe(400);
  });

  it('POST : incrémente la séquence de l\'année (P-AAAA-004 → 005)', async () => {
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT reference FROM rsei_preuves WHERE reference LIKE/.test(s)) {
        return Promise.resolve({ rows: [{ reference: `P-${YEAR}-004` }] });
      }
      if (/INSERT INTO rsei_preuves/.test(s)) {
        return Promise.resolve({ rows: [{ id: 5, reference: params[0], intitule: params[1] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/rse/preuves', 'RH', { intitule: 'DUERP 2026', critere_codes: ['2.4'], type: 'upload', date_preuve: '2026-01-15' });
    expect(res.status).toBe(201);
    expect(res.body.reference).toBe(`P-${YEAR}-005`);
  });

  it('POST : premier de l\'année → P-AAAA-001 (registre vide)', async () => {
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT reference FROM rsei_preuves WHERE reference LIKE/.test(s)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO rsei_preuves/.test(s)) return Promise.resolve({ rows: [{ id: 1, reference: params[0] }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/rse/preuves', 'ADMIN', { intitule: 'Lettre de mission référent' });
    expect(res.body.reference).toBe(`P-${YEAR}-001`);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// TABLEAU DE BORD
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /rse/dashboard', () => {
  const wire = (sql) => {
    const s = String(sql);
    if (/rsei_criteres c LEFT JOIN users/.test(s)) {
      return Promise.resolve({ rows: [
        { id: 1, chapitre: 1, code: '1.1', intitule: 'Projet', niveau_vise: 2, niveau_auto_evalue: 2, pilote_user_id: 3, ordre: 1, pilote_nom: 'A B' },
        { id: 2, chapitre: 1, code: '1.2', intitule: 'PP', niveau_vise: null, niveau_auto_evalue: null, pilote_user_id: null, ordre: 2, pilote_nom: null },
      ] });
    }
    if (/nb_fraiches/.test(s)) return Promise.resolve({ rows: [{ code: '1.1', nb: 3, nb_perimees: 1, nb_fraiches: 2 }] });
    if (/nb_en_cours/.test(s)) return Promise.resolve({ rows: [{ code: '1.1', nb_en_cours: 1, nb_en_retard: 1 }] });
    if (/echues_realisees/.test(s)) return Promise.resolve({ rows: [{ total: 4, realisees: 1, echues: 2, echues_realisees: 1, en_retard: 1 }] });
    if (/AS perimees/.test(s)) return Promise.resolve({ rows: [{ total: 5, perimees: 1 }] });
    return Promise.resolve({ rows: [] });
  };

  it('agrège par critère (preuves + actions) et calcule les indicateurs globaux', async () => {
    mockQuery.mockImplementation(wire);
    const res = await get('/api/rse/dashboard', 'RH');
    expect(res.status).toBe(200);
    expect(typeof res.body.generated_at).toBe('string');
    expect(res.body.criteres).toHaveLength(2);
    const c11 = res.body.criteres.find((c) => c.code === '1.1');
    expect(c11.nb_preuves).toBe(3);
    expect(c11.nb_preuves_fraiches).toBe(2);
    expect(c11.nb_preuves_perimees).toBe(1);
    expect(c11.nb_actions_en_cours).toBe(1);
    expect(c11.nb_actions_en_retard).toBe(1);
    const g = res.body.global;
    expect(g.total_criteres).toBe(2);
    expect(g.criteres_cotes).toBe(1);              // seul 1.1 est coté
    expect(g.criteres_niveau2_demontrable).toBe(1); // 1.1 coté ≥2 avec preuve fraîche
    expect(g.criteres_sans_preuve_recente).toBe(1); // 1.2 : 0 preuve fraîche
    expect(g.actions.taux_solde_echeance).toBe(50); // 1 réalisée / 2 échues
    expect(g.preuves.total).toBe(5);
    expect(g.preuves.perimees).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DOSSIER AFNOR
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /rse/dossier-afnor', () => {
  it('par critère : niveau, preuves rattachées et dernier constat', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/rsei_criteres c LEFT JOIN users/.test(s)) {
        return Promise.resolve({ rows: [{ chapitre: 1, code: '1.1', intitule: 'Projet', niveau_vise: 2, niveau_auto_evalue: 2, commentaire: 'ok', pilote_nom: 'A B' }] });
      }
      if (/unnest\(critere_codes\) AS code/.test(s) && /reference/.test(s)) {
        return Promise.resolve({ rows: [{ code: '1.1', id: 1, reference: `P-${YEAR}-001`, intitule: 'Doc', type: 'procedure', source: 'QHSE', lien_interne: null, date_preuve: '2026-01-01', echeance_fraicheur: '2027-01-01' }] });
      }
      if (/DISTINCT ON \(i\.critere_code\)/.test(s)) {
        return Promise.resolve({ rows: [{ critere_code: '1.1', niveau_constate: 2, constat: 'RAS', ecart: null, date_evaluation: '2026-02-01', evaluation_type: 'auto_evaluation', evaluation_libelle: 'Auto 2026' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/rse/dossier-afnor', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.referentiel).toBe('RSEi-2026');
    const c = res.body.criteres[0];
    expect(c.code).toBe('1.1');
    expect(c.preuves[0].reference).toBe(`P-${YEAR}-001`);
    expect(c.dernier_constat.niveau_constate).toBe(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BILAN ANNUEL
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /rse/bilan', () => {
  it('assemble plan d\'action, répartition des niveaux et dernière évaluation cloturée', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM rsei_actions a LEFT JOIN users/.test(s)) {
        return Promise.resolve({ rows: [
          { id: 1, titre: 'A1', critere_codes: ['1.1'], statut: 'realise', priorite: 'haute', echeance: '2026-06-01', responsable_nom: 'A B' },
          { id: 2, titre: 'A2', critere_codes: [], statut: 'en_cours', priorite: 'moyenne', echeance: '2026-08-01', responsable_nom: null },
        ] });
      }
      if (/SELECT niveau_vise, niveau_auto_evalue FROM rsei_criteres/.test(s)) {
        return Promise.resolve({ rows: [{ niveau_vise: 2, niveau_auto_evalue: 1 }, { niveau_vise: null, niveau_auto_evalue: null }] });
      }
      if (/AS perimees/.test(s)) return Promise.resolve({ rows: [{ total: 5, perimees: 1 }] });
      if (/WHERE e\.statut = 'cloturee'/.test(s)) {
        return Promise.resolve({ rows: [{ id: 9, type: 'audit_interne', libelle: 'Audit interne', date_evaluation: '2026-09-01', statut: 'cloturee', synthese: 'S', evaluateur_nom: 'X Y' }] });
      }
      if (/FROM rsei_evaluation_items WHERE evaluation_id/.test(s)) {
        return Promise.resolve({ rows: [{ critere_code: '1.1', niveau_constate: 2, constat: 'ok', ecart: null, action_id: null }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/rse/bilan?annee=2026', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.annee).toBe(2026);
    expect(res.body.plan_action.total).toBe(2);
    expect(res.body.plan_action.par_statut.realise).toBe(1);
    expect(res.body.plan_action.taux_realisation).toBe(50);
    expect(res.body.niveaux.vise['2']).toBe(1);
    expect(res.body.niveaux.vise.non_cote).toBe(1);
    expect(res.body.preuves.total).toBe(5);
    expect(res.body.derniere_evaluation.id).toBe(9);
    expect(res.body.derniere_evaluation.nb_items).toBe(1);
  });

  it('annee non entière → 400', async () => {
    expect((await get('/api/rse/bilan?annee=abcd', 'RH')).status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PARTIES PRENANTES + INTERACTIONS
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /rse/parties-prenantes + /rse/interactions', () => {
  it('POST partie prenante : COLLABORATEUR → 403 ; RH → 201', async () => {
    expect((await post('/api/rse/parties-prenantes', 'COLLABORATEUR', { nom: 'CAF' })).status).toBe(403);
    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO rsei_parties_prenantes/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 3, nom: params[0], categorie: params[1], influence: params[2] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/rse/parties-prenantes', 'RH', { nom: 'DDETS 76', categorie: 'financeur', influence: 4, interet: 3 });
    expect(res.status).toBe(201);
    expect(res.body.nom).toBe('DDETS 76');
  });

  it('POST interaction : type hors enum → 400 ; PP inconnue (23503) → 404 ; RH valide → 201', async () => {
    expect((await post('/api/rse/interactions', 'RH', { partie_prenante_id: 3, type: 'zzz' })).status).toBe(400);

    mockQuery.mockImplementation((sql) => {
      if (/INSERT INTO rsei_interactions/.test(String(sql))) {
        const e = new Error('fk'); e.code = '23503'; return Promise.reject(e);
      }
      return Promise.resolve({ rows: [] });
    });
    expect((await post('/api/rse/interactions', 'RH', { partie_prenante_id: 999, type: 'reclamation' })).status).toBe(404);

    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO rsei_interactions/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 1, partie_prenante_id: params[0], type: params[4] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const ok = await post('/api/rse/interactions', 'RH', { partie_prenante_id: 3, type: 'demande', objet: 'Question conventionnement' });
    expect(ok.status).toBe(201);
    expect(ok.body.type).toBe('demande');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ÉVALUATIONS + ITEMS
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /rse/evaluations', () => {
  it('POST : type hors enum → 400 ; RH valide → 201', async () => {
    expect((await post('/api/rse/evaluations', 'RH', { type: 'zzz', libelle: 'X' })).status).toBe(400);
    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO rsei_evaluations/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 4, type: params[0], libelle: params[1], statut: params[4] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/rse/evaluations', 'RH', { type: 'auto_evaluation', libelle: 'Auto-évaluation 2027 (état zéro)' });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('auto_evaluation');
    expect(res.body.statut).toBe('en_cours'); // défaut
  });

  it('POST /:id/items : upsert d\'une cotation par critère (201)', async () => {
    expect((await post('/api/rse/evaluations/4/items', 'COLLABORATEUR', { critere_code: '1.1' })).status).toBe(403);
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT statut FROM rsei_evaluations WHERE id/.test(s)) return Promise.resolve({ rows: [{ statut: 'en_cours' }], rowCount: 1 });
      if (/INSERT INTO rsei_evaluation_items/.test(s)) {
        return Promise.resolve({ rows: [{ id: 1, evaluation_id: params[0], critere_code: params[1], niveau_constate: params[2] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/rse/evaluations/4/items', 'RH', { critere_code: '1.5', niveau_constate: 2, constat: 'Plan d\'action formalisé', ecart: 'Bilan annuel à produire' });
    expect(res.status).toBe(201);
    expect(res.body.critere_code).toBe('1.5');
    expect(res.body.niveau_constate).toBe(2);
  });

  it('POST /:id/items : niveau_constate hors 1-4 → 400', async () => {
    expect((await post('/api/rse/evaluations/4/items', 'RH', { critere_code: '1.5', niveau_constate: 9 })).status).toBe(400);
  });

  it('POST /:id/items sur campagne CLÔTURÉE → 409 (audit figé — revue Codex PR#75)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT statut FROM rsei_evaluations WHERE id/.test(String(sql))) return Promise.resolve({ rows: [{ statut: 'cloturee' }], rowCount: 1 });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/rse/evaluations/4/items', 'RH', { critere_code: '1.5', niveau_constate: 2 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('evaluation_cloturee');
  });
});

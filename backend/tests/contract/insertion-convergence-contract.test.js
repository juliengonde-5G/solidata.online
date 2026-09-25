// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — REPORTING CONVERGENCE (programme CVG), lot 2.60.0
// ───────────────────────────────────────────────────────────────────────────
// `pg` est simulé ; on exerce les VRAIS handlers à travers le routeur monté
// (`src/routes/insertion`).
//
//   1. HABILITATION — COLLABORATEUR, AUTORITE, DPO et le jeton chauffeur sont
//      refusés en 403 AVANT toute requête.
//   2. JOURNAL BLOQUANT — aperçu, génération, CSV : un registre indisponible
//      fait échouer le geste (500, aucun contenu).
//   3. EXPORT VIDE — 409 `EXPORT_VIDE`, ni instantané ni journal.
//   4. INSTANTANÉ — `type = 'cvg'`, période enregistrée, historique filtré ;
//      l'historique de la synthèse de dialogue de gestion ne montre plus les
//      instantanés CVG.
//   5. SITUATION DE SORTIE — proposition sourcée, upsert, trace sans valeurs.
//   6. MOYENS HUMAINS — CRUD validé.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;
process.env.PCM_ENCRYPTION_KEY = process.env.PCM_ENCRYPTION_KEY || 'test-pcm-key-0123456789abcdef';

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

let app;
const mfa = () => ({ mfa: true, mfa_at: Math.floor(Date.now() / 1000) });
const TOKENS = {
  ADMIN: jwt.sign({ id: 7, username: 'cip', role: 'ADMIN', first_name: 'Claire', last_name: 'MARTIN', ...mfa() }, JWT_SECRET),
  RH: jwt.sign({ id: 7, username: 'cip', role: 'RH', first_name: 'Claire', last_name: 'MARTIN', ...mfa() }, JWT_SECRET),
  COLLABORATEUR: jwt.sign({ id: 8, username: 'col', role: 'COLLABORATEUR' }, JWT_SECRET),
  AUTORITE: jwt.sign({ id: 9, username: 'aut', role: 'AUTORITE' }, JWT_SECRET),
  DPO: jwt.sign({ id: 10, username: 'dpo', role: 'DPO', ...mfa() }, JWT_SECRET),
  CHAUFFEUR: jwt.sign({ id: 11, username: 'driver_5', role: 'COLLABORATEUR', vehicle_id: 5, employee_id: 42 }, JWT_SECRET),
};

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
});

const as = (role) => ({ Authorization: `Bearer ${TOKENS[role]}` });
const get = (p, role = 'RH') => request(app).get(p).set(as(role));
const post = (p, role = 'RH', b = {}) => request(app).post(p).set(as(role)).send(b);
const put = (p, role = 'RH', b = {}) => request(app).put(p).set(as(role)).send(b);
const del = (p, role = 'RH') => request(app).delete(p).set(as(role));

const PERIODE = 'debut=2026-04-01&fin=2026-09-30';

function branche(over = {}) {
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql);
    if (/INSERT INTO rgpd_audit_log/.test(s)) {
      if (over.journalEnEchec) return Promise.reject(Object.assign(new Error('journal indisponible'), { code: '42P01' }));
      return Promise.resolve({ rows: [] });
    }
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(s.trim())) return Promise.resolve({ rows: [] });
    if (/INSERT INTO insertion_dialogues_gestion/.test(s)) return Promise.resolve({ rows: [{ id: 31, genere_le: '2026-10-02T08:00:00Z' }] });
    if (/FROM insertion_dialogues_gestion d/.test(s)) return Promise.resolve({ rows: over.historique ?? [] });
    if (/FROM insertion_dialogues_gestion WHERE id/.test(s)) {
      const id = Number(params[0]);
      return Promise.resolve({ rows: (over.snapshots || []).filter((x) => x.id === id) });
    }
    if (/FROM settings/.test(s)) return Promise.resolve({ rows: over.settings ?? [] });
    if (/FROM employees e\s+LEFT JOIN insertion_diagnostics d/.test(s)) {
      if (over.cohorteIllisible) return Promise.reject(Object.assign(new Error('cohorte'), { code: '42P01' }));
      return Promise.resolve({ rows: over.cohorte ?? [] });
    }
    if (/insertion_end_date BETWEEN/.test(s)) {
      if (over.finsIllisibles) return Promise.reject(Object.assign(new Error('fins'), { code: '42P01' }));
      return Promise.resolve({ rows: over.fins ?? [] });
    }
    if (/SELECT 1 FROM users WHERE id/.test(s)) return Promise.resolve({ rows: over.userExiste === false ? [] : [{ '?column?': 1 }] });
    if (/SELECT 1 FROM employees WHERE id/.test(s)) return Promise.resolve({ rows: over.employeExiste === false ? [] : [{ '?column?': 1 }] });
    if (/FROM insertion_sortie_cvg WHERE employee_id = \$1 AND parcours_num = \$2 FOR UPDATE/.test(s)) return Promise.resolve({ rows: over.existante ?? [] });
    if (/INSERT INTO insertion_sortie_cvg_history/.test(s)) return Promise.resolve({ rows: [] });
    if (/INSERT INTO insertion_sortie_cvg/.test(s)) return Promise.resolve({ rows: [] });
    if (/FROM insertion_sortie_cvg s/.test(s)) return Promise.resolve({ rows: over.situation ?? [] });
    if (/FROM employees WHERE id = \$1/.test(s) && /parcours_num/.test(s)) return Promise.resolve({ rows: over.employe ?? [{ id: 42, parcours_num: 1, insertion_status: 'termine' }] });
    if (/SELECT disability_status FROM employees/.test(s)) return Promise.resolve({ rows: [{ disability_status: over.disability ?? null }] });
    if (/milestone_type = 'bilan_sortie'/.test(s) && /LIMIT 1/.test(s)) return Promise.resolve({ rows: over.bilanSortie ?? [] });
    if (/FROM insertion_diagnostics WHERE employee_id/.test(s)) return Promise.resolve({ rows: over.diag ?? [] });
    if (/FROM employee_eligibilite/.test(s)) return Promise.resolve({ rows: over.criteres ?? [] });
    if (/suivi_post_sortie/.test(s)) return Promise.resolve({ rows: over.suivi ?? [] });
    if (/INSERT INTO insertion_cvg_ressources/.test(s)) return Promise.resolve({ rows: [{ id: 5, ...over.ressourceCreee }] });
    if (/UPDATE insertion_cvg_ressources/.test(s)) return Promise.resolve({ rows: [{ id: 5 }] });
    if (/DELETE FROM insertion_cvg_ressources/.test(s)) return Promise.resolve({ rows: over.supprime ?? [{ id: 5 }] });
    if (/FROM insertion_cvg_ressources WHERE id/.test(s)) return Promise.resolve({ rows: over.ressourceExistante ?? [] });
    if (/FROM insertion_cvg_ressources/.test(s)) return Promise.resolve({ rows: over.ressources ?? [] });
    return Promise.resolve({ rows: [] });
  });
}

const PERSONNE = {
  id: 1, gender: 'F', birth_date: '1985-01-01', brsa: true, orienteur_type: 'france_travail',
  insertion_status: 'en_parcours', insertion_start_date: '2026-01-05', insertion_end_date: null,
  parcours_num: 1, diag_id: 1, niveau_formation: 'niv3', habitat_type: 'autonome',
};

beforeEach(() => { mockQuery.mockReset(); branche({ cohorte: [PERSONNE] }); });

const journaux = () => mockQuery.mock.calls.filter(([s]) => /INSERT INTO rgpd_audit_log/.test(String(s)));
const journalPour = (action) => journaux().find(([, p]) => p && p[1] === action);

// ───────────────────────────────────────────────────────────────────────────
describe('1. habilitation — refus AVANT toute requête', () => {
  const routes = [
    ['get', `/api/insertion/convergence/apercu?${PERIODE}`],
    ['post', '/api/insertion/convergence/generer'],
    ['get', '/api/insertion/convergence/historique'],
    ['get', '/api/insertion/convergence/parametres'],
    ['get', '/api/insertion/convergence/snapshot/1'],
    ['get', '/api/insertion/convergence/comparaison?a=1&b=2'],
    ['get', `/api/insertion/convergence/completude?${PERIODE}`],
    ['get', `/api/insertion/convergence/csv?${PERIODE}`],
    ['get', '/api/insertion/convergence/situation-sortie/42'],
    ['put', '/api/insertion/convergence/situation-sortie/42'],
    ['get', '/api/insertion/convergence/ressources'],
    ['post', '/api/insertion/convergence/ressources'],
    ['delete', '/api/insertion/convergence/ressources/5'],
    ['put', '/api/insertion/convergence/ressources/5'],
  ];
  it.each(['COLLABORATEUR', 'AUTORITE', 'DPO', 'CHAUFFEUR'])('%s est refusé en 403 sur toutes les routes', async (role) => {
    for (const [verbe, url] of routes) {
      mockQuery.mockClear();
      const r = await request(app)[verbe](url).set(as(role)).send({});
      expect(r.status).toBe(403);
      expect(mockQuery).not.toHaveBeenCalled();
    }
  });
});

describe('2. aperçu, génération, CSV — journal bloquant', () => {
  it('aperçu : 200, trace sans contenu', async () => {
    const r = await get(`/api/insertion/convergence/apercu?${PERIODE}`, 'ADMIN');
    expect(r.status).toBe(200);
    expect(r.body.partie1.effectifs.accueillis).toBe(1);
    const j = journalPour('INSERTION_CVG_APERCU');
    expect(j).toBeTruthy();
    const details = JSON.parse(j[1][4]);
    expect(details).toEqual(expect.objectContaining({ periode_debut: '2026-04-01', periode_fin: '2026-09-30' }));
    expect(JSON.stringify(details)).not.toMatch(/partie1|publics|femmes/);
  });

  it('aperçu : journal indisponible → 500, aucun contenu', async () => {
    branche({ cohorte: [PERSONNE], journalEnEchec: true });
    const r = await get(`/api/insertion/convergence/apercu?${PERIODE}`);
    expect(r.status).toBe(500);
    expect(r.body.partie1).toBeUndefined();
  });

  it('période invalide → 400 avant toute requête', async () => {
    for (const q of ['debut=2026-09-30&fin=2026-04-01', 'debut=2024-01-01&fin=2026-09-30', 'debut=2026-02-30&fin=2026-09-30', 'debut=avril&fin=2026-09-30', '']) {
      mockQuery.mockClear();
      const r = await get(`/api/insertion/convergence/apercu?${q}`);
      expect(r.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    }
  });

  it('génération : instantané type « cvg » avec sa période, trace dans la transaction', async () => {
    const r = await post('/api/insertion/convergence/generer', 'RH', { debut: '2026-04-01', fin: '2026-09-30' });
    expect(r.status).toBe(201);
    expect(r.body.id).toBe(31);
    expect(r.body.contenu.en_tete.periode_fin).toBe('2026-09-30');
    const ins = mockQuery.mock.calls.find(([s]) => /INSERT INTO insertion_dialogues_gestion/.test(String(s)));
    expect(String(ins[0])).toMatch(/'cvg'/);
    expect(ins[1]).toEqual(expect.arrayContaining([2026, '2026-04-01', '2026-09-30']));
    const appels = mockQuery.mock.calls.map(([s]) => String(s).trim());
    const iIns = appels.findIndex((s) => /INSERT INTO insertion_dialogues_gestion/.test(s));
    const iJ = appels.findIndex((s, i) => i > iIns && /INSERT INTO rgpd_audit_log/.test(s));
    const iCommit = appels.findIndex((s) => /^COMMIT/.test(s));
    expect(iIns).toBeGreaterThan(-1);
    expect(iJ).toBeGreaterThan(iIns);
    expect(iCommit).toBeGreaterThan(iJ);
    expect(journalPour('INSERTION_CVG_GENERATION')).toBeTruthy();
  });

  it('génération : journal indisponible → ROLLBACK, 500', async () => {
    branche({ cohorte: [PERSONNE], journalEnEchec: true });
    const r = await post('/api/insertion/convergence/generer', 'RH', { debut: '2026-04-01', fin: '2026-09-30' });
    expect(r.status).toBe(500);
    expect(mockQuery.mock.calls.some(([s]) => /^ROLLBACK/.test(String(s).trim()))).toBe(true);
    expect(mockQuery.mock.calls.some(([s]) => /^COMMIT/.test(String(s).trim()))).toBe(false);
  });

  it('période vide → 409 EXPORT_VIDE, ni instantané ni journal (génération ET CSV)', async () => {
    branche({ cohorte: [], fins: [] });
    const g = await post('/api/insertion/convergence/generer', 'RH', { debut: '2026-04-01', fin: '2026-09-30' });
    expect(g.status).toBe(409);
    expect(g.body.code).toBe('EXPORT_VIDE');
    const c = await get(`/api/insertion/convergence/csv?${PERIODE}`);
    expect(c.status).toBe(409);
    expect(mockQuery.mock.calls.some(([s]) => /INSERT INTO insertion_dialogues_gestion/.test(String(s)))).toBe(false);
    expect(journaux()).toHaveLength(0);
  });

  it('CSV : journal EXPORT_CVG écrit avant l’envoi ; journal indisponible → 500', async () => {
    const r = await get(`/api/insertion/convergence/csv?${PERIODE}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.text).toMatch(/programme CVG/);
    expect(journalPour('EXPORT_CVG')).toBeTruthy();
    branche({ cohorte: [PERSONNE], journalEnEchec: true });
    expect((await get(`/api/insertion/convergence/csv?${PERIODE}`)).status).toBe(500);
  });
});

describe('3. historique, instantané, comparaison', () => {
  it('l’historique CVG ne lit que type = cvg', async () => {
    branche({ historique: [{ id: 31, periode_debut: '2026-04-01', periode_fin: '2026-09-30', genere_le: 'x', version_application: '2.60.0', first_name: 'Claire', last_name: 'MARTIN' }] });
    const r = await get('/api/insertion/convergence/historique');
    expect(r.status).toBe(200);
    expect(r.body[0]).toEqual(expect.objectContaining({ id: 31, genere_par_nom: 'Claire M.', periode_debut: '2026-04-01' }));
    const sql = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /FROM insertion_dialogues_gestion d/.test(s));
    expect(sql).toMatch(/d\.type = 'cvg'/);
  });

  it('l’historique de la synthèse de dialogue de gestion filtre type = dialogue', async () => {
    branche({ historique: [] });
    const r = await get('/api/insertion/reporting/dialogue-gestion/historique');
    expect(r.status).toBe(200);
    const sql = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /FROM insertion_dialogues_gestion d/.test(s));
    expect(sql).toMatch(/d\.type = 'dialogue'/);
  });

  it('la génération de la synthèse de dialogue de gestion pose type = dialogue', async () => {
    branche({ cohorte: [{ id: 1, gender: 'F', birth_date: '1985-04-02', brsa: true, ft_categorie: 'G', referent_unique_type: 'cms', niveau_formation: 'niv3' }] });
    const r = await post('/api/insertion/reporting/dialogue-gestion', 'RH', { annee: 2026 });
    expect(r.status).toBe(201);
    const ins = mockQuery.mock.calls.find(([s]) => /INSERT INTO insertion_dialogues_gestion/.test(String(s)));
    expect(String(ins[0])).toMatch(/'dialogue'/);
  });

  it('instantané : rendu tel qu’enregistré, consultation journalisée ; inconnu → 404', async () => {
    const contenu = { en_tete: { periode_debut: '2026-04-01', periode_fin: '2026-09-30' }, partie1: { base: 46 } };
    branche({ snapshots: [{ id: 31, periode_debut: '2026-04-01', periode_fin: '2026-09-30', contenu, genere_le: 'x', version_application: '2.60.0' }] });
    const r = await get('/api/insertion/convergence/snapshot/31');
    expect(r.status).toBe(200);
    expect(r.body.contenu).toEqual(contenu);
    expect(journalPour('INSERTION_CVG_CONSULTATION')).toBeTruthy();
    const sql = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => /FROM insertion_dialogues_gestion WHERE id/.test(s));
    expect(sql).toMatch(/type = 'cvg'/);
    expect((await get('/api/insertion/convergence/snapshot/99')).status).toBe(404);
  });

  it('comparaison de deux instantanés : deltas + lecture, journalisée', async () => {
    const c = (acc) => ({
      en_tete: { periode_debut: '2026-04-01', periode_fin: '2026-09-30' },
      partie1: { effectifs: { accueillis: acc }, base: acc, publics: { femmes: { nb: 10 } }, habitat_entree: {}, difficultes_entree: {} },
      sorties: { total: 5 },
    });
    branche({ snapshots: [{ id: 1, contenu: c(40) }, { id: 2, contenu: c(46) }] });
    const r = await get('/api/insertion/convergence/comparaison?a=1&b=2');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.deltas)).toBe(true);
    expect(r.body.lecture.join(' ')).toMatch(/passe de 40 à 46/);
    expect(journalPour('INSERTION_CVG_COMPARAISON')).toBeTruthy();
  });

  it('comparaison incomplète → 400', async () => {
    expect((await get('/api/insertion/convergence/comparaison?a=1')).status).toBe(400);
  });
});

describe('4. situation de sortie', () => {
  it('lecture : situation absente + proposition sourcée depuis le bilan et le diagnostic', async () => {
    branche({
      situation: [],
      bilanSortie: [{ sortie_type: 'CDI' }],
      diag: [{ habitat_type: null, logement_statut: 'locataire_social', rqth: true, pension_invalidite: false, medecin_traitant: true, diag_id: 3 }],
      suivi: [{ '?column?': 1 }],
    });
    const r = await get('/api/insertion/convergence/situation-sortie/42');
    expect(r.status).toBe(200);
    expect(r.body.situation).toBeNull();
    const p = r.body.proposition;
    expect(p).toEqual(expect.objectContaining({
      categorie: 'emploi', habitat_type_sortie: 'autonome', rqth_sortie: true,
      pension_invalidite_sortie: false, medecin_traitant_sortie: true,
      accompagnement_post_sortie: true, couverture_sante_amelioree: null,
    }));
    expect(p.source.categorie).toMatch(/CDI/);
    expect(p.source.habitat_type_sortie).toMatch(/à confirmer/);
  });

  it('salarié inconnu → 404', async () => {
    branche({ employe: [] });
    expect((await get('/api/insertion/convergence/situation-sortie/999')).status).toBe(404);
  });

  it('écriture : upsert des seuls champs transmis, trace SANS les valeurs, situation relue', async () => {
    branche({ situation: [{ id: 1, employee_id: 42, parcours_num: 1, categorie: 'formation', rqth_sortie: true, first_name: 'Claire', last_name: 'MARTIN', updated_at: 'x' }] });
    const r = await put('/api/insertion/convergence/situation-sortie/42', 'RH', { categorie: 'formation', rqth_sortie: true });
    expect(r.status).toBe(200);
    expect(r.body.situation).toEqual(expect.objectContaining({ categorie: 'formation', saisi_par_nom: 'Claire M.' }));
    const up = mockQuery.mock.calls.find(([s]) => /INSERT INTO insertion_sortie_cvg/.test(String(s)));
    expect(String(up[0])).toMatch(/ON CONFLICT \(employee_id, parcours_num\)/);
    expect(String(up[0])).not.toMatch(/habitat_type_sortie/);
    const j = journalPour('INSERTION_SORTIE_CVG_ECRITURE');
    expect(j[1][3]).toBe(42);
    const details = JSON.parse(j[1][4]);
    expect(details.champs).toEqual(['categorie', 'rqth_sortie']);
    expect(JSON.stringify(details)).not.toMatch(/formation|true/);
  });

  it('écriture : valeur hors liste ou booléen non strict → 400 sans écriture', async () => {
    for (const b of [{ categorie: 'cdi' }, { habitat_type_sortie: 'heberge' }, { rqth_sortie: 'oui' }, {}]) {
      mockQuery.mockClear();
      const r = await put('/api/insertion/convergence/situation-sortie/42', 'RH', b);
      expect(r.status).toBe(400);
      expect(mockQuery.mock.calls.some(([s]) => /INSERT INTO insertion_sortie_cvg/.test(String(s)))).toBe(false);
    }
  });

  it('écriture : journal indisponible → 500 et ROLLBACK', async () => {
    branche({ journalEnEchec: true });
    const r = await put('/api/insertion/convergence/situation-sortie/42', 'RH', { categorie: 'retraite' });
    expect(r.status).toBe(500);
    expect(mockQuery.mock.calls.some(([s]) => /^ROLLBACK/.test(String(s).trim()))).toBe(true);
  });
});

describe('5. moyens humains', () => {
  it('liste', async () => {
    branche({ ressources: [{ id: 1, type: 'interne', nom: 'MARTIN Claire' }] });
    const r = await get('/api/insertion/convergence/ressources');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
  });

  it('création : mutualisée → quotités d’accompagnement/encadrement remises à vide', async () => {
    const r = await post('/api/insertion/convergence/ressources', 'RH', {
      type: 'mutualisee', nom: 'LEROY Anne', fonction: 'Chargée de mission', employeur: 'PLIE',
      etp_total: 0.2, etp_accompagnement: 0.1,
    });
    expect(r.status).toBe(201);
    const ins = mockQuery.mock.calls.find(([s]) => /INSERT INTO insertion_cvg_ressources/.test(String(s)));
    const cols = String(ins[0]).match(/\(([^)]*)\)/)[1].split(',').map((x) => x.trim());
    expect(ins[1][cols.indexOf('etp_accompagnement')]).toBeNull();
    expect(ins[1][cols.indexOf('etp_encadrement')]).toBeNull();
  });

  it('validation : type, nom, ETP 0-2, quotités cohérentes, dates', async () => {
    const cas = [
      { type: 'benevole', nom: 'X', etp_total: 1 },
      { type: 'interne', nom: '', etp_total: 1 },
      { type: 'interne', nom: 'X', etp_total: 3 },
      { type: 'interne', nom: 'X', etp_total: 0.5, etp_accompagnement: 0.4, etp_encadrement: 0.4 },
      { type: 'interne', nom: 'X', date_debut: '2026-09-01', date_fin: '2026-01-01' },
    ];
    for (const b of cas) {
      mockQuery.mockClear();
      const r = await post('/api/insertion/convergence/ressources', 'RH', b);
      expect(r.status).toBe(400);
      expect(mockQuery.mock.calls.some(([s]) => /INSERT INTO insertion_cvg_ressources/.test(String(s)))).toBe(false);
    }
  });

  it('modification et suppression ; inconnue → 404', async () => {
    branche({ ressourceExistante: [{ id: 5, type: 'interne', nom: 'X', etp_total: 1 }] });
    expect((await put('/api/insertion/convergence/ressources/5', 'RH', { fonction: 'CIP' })).status).toBe(200);
    expect((await del('/api/insertion/convergence/ressources/5')).status).toBe(200);
    branche({ ressourceExistante: [], supprime: [] });
    expect((await put('/api/insertion/convergence/ressources/5', 'RH', { fonction: 'CIP' })).status).toBe(404);
    expect((await del('/api/insertion/convergence/ressources/5')).status).toBe(404);
  });
});

describe('6. orienteurs étendus — la liste fermée du dossier administratif suit le CHECK', () => {
  it('les 12 valeurs Convergence et les 3 anciennes sont acceptées par la route du cadre', () => {
    const R = require('../../src/utils/convergence-cvg-referentiels');
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'src', 'routes', 'insertion', 'cadre.js'), 'utf8');
    expect(src).toMatch(/ORIENTEUR_TYPES = require\('..\/..\/utils\/convergence-cvg-referentiels'\)\.ORIENTEURS_ACCEPTES/);
    expect(R.ORIENTEURS_ACCEPTES).toHaveLength(15);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. CORRECTIFS 2.60.0 — revue de sécurité PR E (rapport 32)
// ═══════════════════════════════════════════════════════════════════════════
describe('7. correctifs 2.60.0', () => {
  it('GET /parametres : k = 5 et justice non transmise par défaut (encadré avant « Générer »)', async () => {
    const r = await get('/api/insertion/convergence/parametres');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ k_min: 5, k_source: 'defaut', base_marginales_brutes: 20, transmettre_justice: false });
    expect(journaux()).toHaveLength(0);
  });

  it('B-02 — l’aperçu par défaut ne lit PAS la colonne du frein judiciaire', async () => {
    const r = await get(`/api/insertion/convergence/apercu?${PERIODE}`);
    expect(r.status).toBe(200);
    expect(r.body.partie1.difficultes_entree.judiciaire).toBeUndefined();
    const sqls = mockQuery.mock.calls.map(([x]) => String(x)).join('\n');
    expect(sqls).not.toMatch(/frein_judiciaire/);
  });

  it('m-07 — cohorte ET sorties illisibles : 503 SOURCE_ILLISIBLE (génération et CSV), jamais « aucun salarié »', async () => {
    branche({ cohorteIllisible: true, finsIllisibles: true });
    const g = await post('/api/insertion/convergence/generer', 'RH', { debut: '2026-04-01', fin: '2026-09-30' });
    expect(g.status).toBe(503);
    expect(g.body.code).toBe('SOURCE_ILLISIBLE');
    expect(g.body.error).not.toMatch(/Aucun salarié accueilli ni sorti/);
    const c = await get(`/api/insertion/convergence/csv?${PERIODE}`);
    expect(c.status).toBe(503);
    expect(mockQuery.mock.calls.some(([x]) => /INSERT INTO insertion_dialogues_gestion/.test(String(x)))).toBe(false);
  });

  it('m-01 — lecture d’une situation de sortie : trace TOLÉRANTE, sans valeur', async () => {
    branche({ situation: [], diag: [{ rqth: true, diag_id: 3 }] });
    const r = await get('/api/insertion/convergence/situation-sortie/42');
    expect(r.status).toBe(200);
    const j = journalPour('INSERTION_SORTIE_CVG_LECTURE');
    expect(j).toBeTruthy();
    expect(j[1][3]).toBe(42);
    const d = JSON.parse(j[1][4]);
    expect(d.parcours_num).toBe(1);
    expect(JSON.stringify(d)).not.toMatch(/rqth|true/);
    branche({ situation: [], journalEnEchec: true });
    expect((await get('/api/insertion/convergence/situation-sortie/42')).status).toBe(200);
  });

  it('m-02 — liste de complétude nominative : trace TOLÉRANTE (période, nombre — jamais les noms)', async () => {
    const r = await get(`/api/insertion/convergence/completude?${PERIODE}`);
    expect(r.status).toBe(200);
    const j = journalPour('INSERTION_CVG_COMPLETUDE');
    expect(JSON.parse(j[1][4])).toEqual(expect.objectContaining({ periode_debut: '2026-04-01', nb_personnes: r.body.length }));
    branche({ cohorte: [PERSONNE], journalEnEchec: true });
    expect((await get(`/api/insertion/convergence/completude?${PERIODE}`)).status).toBe(200);
  });

  it.each(['Non concerné', 'Pas de RQTH', 'En cours', 'NON RQTH'])('M-02 — fiche « %s » : aucune RQTH proposée à la sortie', async (texte) => {
    branche({ situation: [], diag: [{ rqth: null, diag_id: 3 }], disability: texte });
    const r = await get('/api/insertion/convergence/situation-sortie/42');
    expect(r.body.proposition.rqth_sortie).not.toBe(true);
    expect(r.body.proposition.source.rqth_sortie).toBeUndefined();
  });

  it('M-02 — fiche « RQTH 2024 » : RQTH proposée, sourcée', async () => {
    branche({ situation: [], diag: [{ rqth: null, diag_id: 3 }], disability: 'RQTH 2024' });
    const r = await get('/api/insertion/convergence/situation-sortie/42');
    expect(r.body.proposition.rqth_sortie).toBe(true);
  });

  it('m-05 — personne sans parcours → 409 ; parcours au-delà du courant → 400 ; rien n’est écrit', async () => {
    branche({ employe: [{ id: 42, parcours_num: 1, insertion_status: 'none' }] });
    const a = await put('/api/insertion/convergence/situation-sortie/42', 'RH', { categorie: 'emploi' });
    expect(a.status).toBe(409);
    expect(a.body.code).toBe('SANS_PARCOURS');
    branche({});
    const b = await put('/api/insertion/convergence/situation-sortie/42', 'RH', { categorie: 'emploi', parcours_num: 3 });
    expect(b.status).toBe(400);
    expect(b.body.code).toBe('PARCOURS_INVALIDE');
    expect((await get('/api/insertion/convergence/situation-sortie/42?parcours_num=3')).status).toBe(400);
    expect(mockQuery.mock.calls.some(([x]) => /INSERT INTO insertion_sortie_cvg/.test(String(x)))).toBe(false);
  });

  it('m-04 — la catégorie devient « retraite » : « parcours de soin » remis à vide dans la MÊME écriture', async () => {
    branche({ existante: [{ id: 9, categorie: 'autre_positive', parcours_de_soin: true, saisi_par: 7 }] });
    const r = await put('/api/insertion/convergence/situation-sortie/42', 'RH', { categorie: 'retraite' });
    expect(r.status).toBe(200);
    const up = mockQuery.mock.calls.find(([x]) => /INSERT INTO insertion_sortie_cvg \(/.test(String(x)));
    const cols = String(up[0]).match(/\(([^)]*)\)/)[1].split(',').map((x) => x.trim());
    expect(cols).toContain('parcours_de_soin');
    expect(up[1][cols.indexOf('parcours_de_soin')]).toBeNull();
    expect(up[1][cols.indexOf('categorie')]).toBe('retraite');
  });

  it('m-04 — « parcours de soin : oui » envoyé avec une catégorie autre que « autre positive » n’est pas écrit', async () => {
    branche({});
    await put('/api/insertion/convergence/situation-sortie/42', 'RH', { categorie: 'sortie_neutre', parcours_de_soin: true });
    const up = mockQuery.mock.calls.find(([x]) => /INSERT INTO insertion_sortie_cvg \(/.test(String(x)));
    const cols = String(up[0]).match(/\(([^)]*)\)/)[1].split(',').map((x) => x.trim());
    expect(up[1][cols.indexOf('parcours_de_soin')]).toBeNull();
  });

  it('m-03 — l’état ANTÉRIEUR est déposé dans l’historique avant la modification ; l’auteur initial n’est plus écrasé', async () => {
    branche({ existante: [{ id: 9, categorie: 'formation', rqth_sortie: true, saisi_par: 7, saisi_at: '2026-10-01' }] });
    const r = await put('/api/insertion/convergence/situation-sortie/42', 'ADMIN', { categorie: 'emploi' });
    expect(r.status).toBe(200);
    const appels = mockQuery.mock.calls.map(([x]) => String(x));
    const iHist = appels.findIndex((x) => /INSERT INTO insertion_sortie_cvg_history/.test(x));
    const iUp = appels.findIndex((x) => /INSERT INTO insertion_sortie_cvg \(/.test(x));
    expect(iHist).toBeGreaterThan(-1);
    expect(iUp).toBeGreaterThan(iHist);
    const hist = mockQuery.mock.calls[iHist][1];
    expect(hist[0]).toBe(9);
    expect(JSON.parse(hist[3])).toEqual(expect.objectContaining({ categorie: 'formation', saisi_par: 7 }));
    expect(appels[iUp]).toMatch(/modifie_par = EXCLUDED\.saisi_par/);
    expect(appels[iUp]).not.toMatch(/SET saisi_par = /);
    // Première saisie : pas d'historique.
    branche({ existante: [] });
    mockQuery.mockClear();
    await put('/api/insertion/convergence/situation-sortie/42', 'RH', { categorie: 'emploi' });
    expect(mockQuery.mock.calls.some(([x]) => /INSERT INTO insertion_sortie_cvg_history/.test(String(x)))).toBe(false);
  });

  it('m-06 — registre : trace tolérante des trois gestes, jamais le nom ; références et booléens vérifiés', async () => {
    branche({ ressourceExistante: [{ id: 5, type: 'interne', nom: 'MARTIN Claire', etp_total: 1 }] });
    await post('/api/insertion/convergence/ressources', 'RH', { type: 'interne', nom: 'MARTIN Claire', etp_total: 1 });
    await put('/api/insertion/convergence/ressources/5', 'RH', { fonction: 'CIP' });
    await del('/api/insertion/convergence/ressources/5');
    for (const code of ['INSERTION_CVG_RESSOURCE_CREATION', 'INSERTION_CVG_RESSOURCE_MODIFICATION', 'INSERTION_CVG_RESSOURCE_SUPPRESSION']) {
      const j = journalPour(code);
      expect(j).toBeTruthy();
      expect(j[1][2]).toBe('insertion_cvg_ressources');
      expect(j[1][4]).not.toMatch(/MARTIN|Claire|CIP"/);
    }
    // Utilisateur inconnu : 400 et non 500 ; aucune écriture.
    branche({ userExiste: false });
    mockQuery.mockClear();
    const u = await post('/api/insertion/convergence/ressources', 'RH', { type: 'interne', nom: 'X', user_id: 999 });
    expect(u.status).toBe(400);
    expect(mockQuery.mock.calls.some(([x]) => /INSERT INTO insertion_cvg_ressources/.test(String(x)))).toBe(false);
    branche({ employeExiste: false });
    expect((await post('/api/insertion/convergence/ressources', 'RH', { type: 'interne', nom: 'X', employee_id: 999 })).status).toBe(400);
    // « "1" » n'est plus un booléen accepté puis normalisé à faux.
    branche({});
    expect((await post('/api/insertion/convergence/ressources', 'RH', { type: 'interne', nom: 'X', actif: '1' })).status).toBe(400);
    // Journal indisponible : le geste passe quand même (écran interne).
    branche({ journalEnEchec: true });
    expect((await post('/api/insertion/convergence/ressources', 'RH', { type: 'interne', nom: 'X' })).status).toBe(201);
  });
});

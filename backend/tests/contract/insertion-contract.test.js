// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — EXTENSION INSERTION 2026-07 (PR1 phase B)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la forme de réponse et la matrice d'habilitations des endpoints
// livrés par les lots 1-3 (plan 05 §2, révisions rapport 11 §2) :
//   - POST /insertion/milestones               (types techniques, titre auto)
//   - PUT  /insertion/milestones/:id           (verrouillage → 409)
//   - POST /insertion/milestones/:id/close     (contrôles de clôture + verrou)
//   - POST /insertion/milestones/:id/reopen    (ADMIN/RH, motif, caducité validations)
//   - GET  /insertion/milestones/:id/radar     (9 axes, null honnête, MANAGER sans judiciaire)
//   - PUT/GET /insertion/diagnostic/:id        (chiffrement + masquage MANAGER)
//   - CRUD /insertion/objectifs                (sous-objectifs 1 niveau, écriture A/RH)
//   - GET/POST /insertion/partenaires          (lecture module, écriture A/RH)
//   - GET  /insertion/actions-overview         (filtres + pagination)
//   - GET  /insertion/alertes/:employeeId      (alertes consolidées + acquittées)
// Phase D (écarts contractuels 1a-1d + REC-UX-18) :
//   - GET  /insertion/cohorte/stats            (jalons : titre/interview_date/
//                                               ia_preparation_ready ; sorties
//                                               SANS alias positives/negatives)
//   - PUT  /insertion/diagnostic/:id           (suggestions_freins serveur)
//   - POST /insertion/alertes/:employeeId/ack  (acquittement journalisé)
//   - GET  /insertion/parametres               (réglages avec défauts)
// PR 2 phase A (résiduels 12-realisation-pr1 §6) :
//   - CRUD /insertion/pmsmp                    (bornes 31 j / 60 j → 409, force
//                                               motivée, A/RH écriture)
//   - POST/GET /insertion/satisfaction         (upsert par parcours, stats
//                                               ANONYMES ouvertes au module)
//   - GET  /insertion/renouvellements          (file CDDI + état formulaire)
//   - PUT  /insertion/renouvellements/:id/formulaire (volet ETI LIMITÉ)
//   - GET  /insertion/pass-iae/bilan/:id       (A/RH, SANS axe judiciaire)
//   - GET/PUT /insertion/cibles                (nullables — « non paramétré »)
//   - GET  /insertion/audit                    (blocs conventionnel/typologies/
//                                               etp contrôle/pmsmp/satisf/cvg)
//   - GET  /exports/insertion-freins(+/completude) (ADMIN/RH + journal RGPD)
//   - GET  /exports/insertion-synthese         (agrégé non nominatif, A/RH/M)
//
// Auth réelle (JWT sans `tv` → pas de contrôle token_version), DB mockée,
// activity-logger mocké.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET; // clé de chiffrement de repli (field-crypto)

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
const { encryptField, decryptField, ENC_PREFIX } = require('../../src/utils/field-crypto');
const { FREINS } = require('../../src/routes/insertion/freins-registry');

let app;
let appExports;
const tokenFor = (role) => jwt.sign({ id: 1, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER') };

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
  // App séparée pour les exports (PR 2 : tableau des freins + synthèse comité).
  appExports = express();
  appExports.use(express.json());
  appExports.use('/api/exports', require('../../src/routes/exports'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (path, role, body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const put = (path, role, body = {}) => request(app).put(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

// Ligne d'entretien complète (9 freins évalués) pour les scénarios de clôture.
const fullMilestone = (over = {}) => ({
  id: 10, employee_id: 5, parcours_num: 1,
  milestone_type: 'bilan_intermediaire', titre: 'Bilan n° 1',
  due_date: '2026-06-01', status: 'planifie', completed_date: null,
  locked_at: null, previous_review: null, validations: null,
  sortie_classification: null, sortie_documents: null,
  ...Object.fromEntries(FREINS.map((f) => [f.column, 2])),
  ...over,
});

// ───────────────────────────────────────────────────────────────────────────
// POST /milestones — types techniques + titre auto
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT POST /insertion/milestones', () => {
  it("rejette un type hors nomenclature technique (400 + détail express-validator)", async () => {
    const res = await post('/api/insertion/milestones', 'RH', { employee_id: 5, milestone_type: 'Bilan M+3' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Erreur de validation');
  });

  it('crée un bilan intermédiaire à toute date avec titre auto « Bilan n° N »', async () => {
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT COALESCE\(parcours_num, 1\) AS pn FROM employees/.test(s)) return Promise.resolve({ rows: [{ pn: 1 }] });
      if (/SELECT COUNT\(\*\)::int AS n FROM insertion_milestones/.test(s)) return Promise.resolve({ rows: [{ n: 2 }] });
      if (/INSERT INTO insertion_milestones/.test(s)) {
        return Promise.resolve({ rows: [{ id: 99, employee_id: params[0], parcours_num: params[1], milestone_type: params[2], titre: params[3], due_date: params[4], status: 'a_planifier' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones', 'RH', { employee_id: 5, milestone_type: 'bilan_intermediaire', due_date: '2026-09-15' });
    expect(res.status).toBe(201);
    expect(res.body.milestone_type).toBe('bilan_intermediaire');
    expect(res.body.titre).toBe('Bilan n° 3'); // 2 existants + 1
    expect(res.body.parcours_num).toBe(1);
  });

  it('refuse un contract_id qui n’appartient pas au salarié (renouvellement)', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT COALESCE\(parcours_num, 1\) AS pn FROM employees/.test(s)) return Promise.resolve({ rows: [{ pn: 1 }] });
      if (/SELECT id FROM employee_contracts WHERE id = \$1 AND employee_id = \$2/.test(s)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones', 'RH', { employee_id: 5, milestone_type: 'renouvellement', contract_id: 77 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contrat introuvable/i);
  });

  it("diagnostic d'accueil déjà existant → upsert de l'échéance (200, pas de doublon)", async () => {
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT COALESCE\(parcours_num, 1\) AS pn FROM employees/.test(s)) return Promise.resolve({ rows: [{ pn: 1 }] });
      if (/SELECT \* FROM insertion_milestones\s+WHERE employee_id = \$1/.test(s)) {
        return Promise.resolve({ rows: [fullMilestone({ milestone_type: 'diagnostic_accueil', id: 3 })] });
      }
      if (/UPDATE insertion_milestones SET due_date/.test(s)) {
        return Promise.resolve({ rows: [fullMilestone({ milestone_type: 'diagnostic_accueil', id: 3, due_date: params[0] })] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones', 'RH', { employee_id: 5, milestone_type: 'diagnostic_accueil', due_date: '2026-08-01' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(3);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PUT /milestones/:id — verrouillage probant
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT PUT /insertion/milestones/:id (verrou RES-02)', () => {
  it('entretien verrouillé → 409 avec hint « réouvrir d’abord »', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT \* FROM insertion_milestones WHERE id = \$1/.test(String(sql))) {
        return Promise.resolve({ rows: [fullMilestone({ locked_at: '2026-07-01T10:00:00Z', status: 'realise' })] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/milestones/10', 'RH', { observations: 'test' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/verrouillé/i);
    expect(res.body.hint).toMatch(/réouvrir/i);
  });

  it('null EXPLICITE accepté (fin du COALESCE intégral) + snapshot update sur un réalisé', async () => {
    const calls = [];
    mockQuery.mockImplementation((sql, params) => {
      calls.push({ sql: String(sql), params });
      const s = String(sql);
      if (/SELECT \* FROM insertion_milestones WHERE id = \$1/.test(s)) {
        return Promise.resolve({ rows: [fullMilestone({ status: 'realise' })] });
      }
      if (/UPDATE insertion_milestones SET/.test(s)) {
        return Promise.resolve({ rows: [fullMilestone({ status: 'realise', interview_date: null })] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/milestones/10', 'RH', { interview_date: null, previous_review: [{ kind: 'action', id: 1, verdict: 'ok' }] });
    expect(res.status).toBe(200);
    const upd = calls.find((c) => /UPDATE insertion_milestones SET/.test(c.sql));
    expect(upd.sql).toContain('interview_date = $');
    expect(upd.params).toContain(null); // le null est bien transmis
    // Historisation d'une modification hors clôture sur un entretien réalisé
    const hist = calls.find((c) => /INSERT INTO insertion_milestones_history/.test(c.sql));
    expect(hist).toBeTruthy();
    expect(hist.params[2]).toBe('update');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// POST /milestones/:id/close — clôture contrôlée
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT POST /insertion/milestones/:id/close', () => {
  it('contrôles non satisfaits → 409 { error, problems[] } typés', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FOR UPDATE/.test(s)) {
        // freins non évalués + un entretien réalisé antérieur existe
        return Promise.resolve({ rows: [fullMilestone(Object.fromEntries(FREINS.map((f) => [f.column, null])))] });
      }
      if (/status = 'realise' LIMIT 1/.test(s)) return Promise.resolve({ rows: [{ id: 4 }] });
      if (/status = 'planifie' LIMIT 1/.test(s)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones/10/close', 'RH', {});
    expect(res.status).toBe(409);
    expect(Array.isArray(res.body.problems)).toBe(true);
    const codes = res.body.problems.map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['freins_non_evalues', 'previous_review_manquante', 'prochain_entretien_manquant']));
    for (const p of res.body.problems) expect(typeof p.message).toBe('string');
  });

  it('clôture d’un renouvellement : triple validation eti/cip/directeur exigée (P1 Codex PR#74)', async () => {
    const freinsOk = Object.fromEntries(FREINS.map((f) => [f.column, 3]));
    // Manque 'directeur' → 409 avec le code dédié
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FOR UPDATE/.test(s)) return Promise.resolve({ rows: [fullMilestone({ milestone_type: 'renouvellement', ...freinsOk, previous_review: [{ kind: 'action', id: 1, verdict: 'ok' }], validations: [{ role: 'eti' }, { role: 'cip' }] })] });
      if (/status = 'realise' LIMIT 1/.test(s)) return Promise.resolve({ rows: [] });
      if (/status = 'planifie' LIMIT 1/.test(s)) return Promise.resolve({ rows: [{ id: 9 }] }); // prochain déjà planifié
      return Promise.resolve({ rows: [] });
    });
    const manque = await post('/api/insertion/milestones/10/close', 'RH', {});
    expect(manque.status).toBe(409);
    const codes = manque.body.problems.map((p) => p.code);
    expect(codes).toContain('validations_renouvellement_incompletes');
    const prob = manque.body.problems.find((p) => p.code === 'validations_renouvellement_incompletes');
    expect(prob.manquants).toEqual(['directeur']);

    // Les trois présentes → la clôture n'est plus bloquée par ce contrôle
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/FOR UPDATE/.test(s)) return Promise.resolve({ rows: [fullMilestone({ milestone_type: 'renouvellement', ...freinsOk, previous_review: [{ kind: 'action', id: 1, verdict: 'ok' }], validations: [{ role: 'eti' }, { role: 'cip' }, { role: 'directeur' }] })] });
      if (/status = 'realise' LIMIT 1/.test(s)) return Promise.resolve({ rows: [] });
      if (/status = 'planifie' LIMIT 1/.test(s)) return Promise.resolve({ rows: [{ id: 9 }] });
      if (/UPDATE insertion_milestones\s+SET status = 'realise'/.test(s)) return Promise.resolve({ rows: [fullMilestone({ status: 'realise', completed_date: params[0], locked_at: 'x' })] });
      return Promise.resolve({ rows: [] });
    });
    const ok = await post('/api/insertion/milestones/10/close', 'RH', {});
    expect(ok.status).toBe(200);
  });

  it('clôture OK : realise + locked_at + snapshot close + prochain entretien créé planifie + resync', async () => {
    const calls = [];
    mockQuery.mockImplementation((sql, params) => {
      calls.push({ sql: String(sql), params });
      const s = String(sql);
      if (/FOR UPDATE/.test(s)) return Promise.resolve({ rows: [fullMilestone()] });
      if (/status = 'realise' LIMIT 1/.test(s)) return Promise.resolve({ rows: [] }); // pas d'antérieur
      if (/status = 'planifie' LIMIT 1/.test(s)) return Promise.resolve({ rows: [] }); // pas de prochain → body.next
      if (/SELECT COUNT\(\*\)::int AS n FROM insertion_milestones/.test(s)) return Promise.resolve({ rows: [{ n: 1 }] });
      if (/INSERT INTO insertion_milestones\s*\n?\s*\(employee_id, parcours_num, milestone_type, titre, due_date, interview_date, status/.test(s.replace(/\s+/g, ' '))
        || /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, 'planifie', \$7, \$8\)/.test(s)) {
        return Promise.resolve({ rows: [{ id: 11, milestone_type: params[2], titre: params[3], due_date: params[4], status: 'planifie' }] });
      }
      if (/UPDATE insertion_milestones\s+SET status = 'realise'/.test(s)) {
        return Promise.resolve({ rows: [fullMilestone({ status: 'realise', completed_date: params[0], locked_at: '2026-07-23T10:00:00Z' })] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones/10/close', 'RH', {
      completed_date: '2026-07-23',
      next: { milestone_type: 'bilan_intermediaire', due_date: '2026-10-01' },
    });
    expect(res.status).toBe(200);
    expect(res.body.milestone.status).toBe('realise');
    expect(res.body.milestone.locked_at).toBeTruthy();
    expect(res.body.next).toBeTruthy();
    expect(res.body.next.status).toBe('planifie');
    expect(res.body.next.titre).toBe('Bilan n° 2');
    expect('resync' in res.body).toBe(true);
    // Snapshot probant 'close'
    const hist = calls.find((c) => /INSERT INTO insertion_milestones_history/.test(c.sql));
    expect(hist).toBeTruthy();
    expect(hist.params[2]).toBe('close');
  });

  it('déjà verrouillé → 409', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FOR UPDATE/.test(String(sql))) return Promise.resolve({ rows: [fullMilestone({ locked_at: '2026-07-01T00:00:00Z' })] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones/10/close', 'RH', {});
    expect(res.status).toBe(409);
  });

  it('bilan de sortie sans catégorie ni documents → 409 avec les 2 problèmes dédiés', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FOR UPDATE/.test(s)) return Promise.resolve({ rows: [fullMilestone({ milestone_type: 'bilan_sortie', titre: 'Bilan de sortie' })] });
      if (/status = 'realise' LIMIT 1/.test(s)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones/10/close', 'RH', {});
    expect(res.status).toBe(409);
    const codes = res.body.problems.map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['sortie_classification_manquante', 'sortie_documents_manquants']));
    // pas d'exigence de prochain entretien pour un bilan de sortie
    expect(codes).not.toContain('prochain_entretien_manquant');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// POST /milestones/:id/reopen — réouverture tracée (ADMIN/RH)
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT POST /insertion/milestones/:id/reopen', () => {
  it('MANAGER → 403 (réservé ADMIN/RH)', async () => {
    const res = await post('/api/insertion/milestones/10/reopen', 'MANAGER', { motif: 'test' });
    expect(res.status).toBe(403);
  });

  it('motif manquant → 400', async () => {
    const res = await post('/api/insertion/milestones/10/reopen', 'RH', {});
    expect(res.status).toBe(400);
  });

  it('non verrouillé → 409', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FOR UPDATE/.test(String(sql))) return Promise.resolve({ rows: [fullMilestone({ locked_at: null })] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones/10/reopen', 'RH', { motif: 'correction' });
    expect(res.status).toBe(409);
  });

  it('réouverture OK : snapshot reopen (motif) + locked_at levé + validations INVALIDÉES', async () => {
    const calls = [];
    mockQuery.mockImplementation((sql, params) => {
      calls.push({ sql: String(sql), params });
      const s = String(sql);
      if (/FOR UPDATE/.test(s)) {
        return Promise.resolve({ rows: [fullMilestone({ locked_at: '2026-07-01T00:00:00Z', status: 'realise', validations: [{ role: 'cip', at: 'x' }] })] });
      }
      if (/SET locked_at = NULL, validations = NULL/.test(s)) {
        return Promise.resolve({ rows: [fullMilestone({ locked_at: null, validations: null, status: 'realise' })] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones/10/reopen', 'RH', { motif: 'Erreur de saisie sur les freins' });
    expect(res.status).toBe(200);
    expect(res.body.locked_at).toBeNull();
    expect(res.body.validations).toBeNull();
    const hist = calls.find((c) => /INSERT INTO insertion_milestones_history/.test(c.sql));
    expect(hist.params[2]).toBe('reopen');
    expect(hist.params[4]).toBe('Erreur de saisie sur les freins');
    // La trace des validations invalidées vit dans le snapshot pré-réouverture
    expect(JSON.parse(hist.params[1]).validations).toEqual([{ role: 'cip', at: 'x' }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /milestones/:employeeId/radar — 9 axes, null honnête, MANAGER filtré
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /insertion/milestones/:id/radar (9 axes)', () => {
  const wire = (sql) => {
    const s = String(sql);
    if (/SELECT COALESCE\(parcours_num, 1\) AS pn FROM employees/.test(s)) return Promise.resolve({ rows: [{ pn: 1 }] });
    if (/FROM insertion_diagnostics/.test(s)) {
      return Promise.resolve({ rows: [{ frein_mobilite: 3, frein_sante: null, frein_finances: 2, frein_famille: null, frein_linguistique: null, frein_administratif: null, frein_numerique: null, frein_logement: 4, frein_judiciaire: 5 }] });
    }
    if (/FROM insertion_milestones/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  };

  it('ADMIN : 9 axes (dont Logement et Judiciaire) et null HONNÊTE (plus de || 1)', async () => {
    mockQuery.mockImplementation(wire);
    const res = await get('/api/insertion/milestones/5/radar', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.axes).toHaveLength(9);
    expect(res.body.axes).toEqual(expect.arrayContaining(['Logement', 'Judiciaire']));
    const serie = res.body.series[0];
    expect(serie.data[0]).toBe(3);     // mobilite évaluée
    expect(serie.data[1]).toBeNull();  // sante NON évaluée → null (pas 1)
    expect(serie.data[8]).toBe(5);     // judiciaire visible pour ADMIN
  });

  it("MANAGER : l'axe Judiciaire est ABSENT (8 axes, aucune donnée judiciaire)", async () => {
    mockQuery.mockImplementation(wire);
    const res = await get('/api/insertion/milestones/5/radar', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.axes).toHaveLength(8);
    expect(res.body.axes).not.toContain('Judiciaire');
    for (const s of res.body.series) expect(s.data).toHaveLength(8);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Diagnostic — chiffrement à l'écriture, déchiffrement A/RH, masquage MANAGER
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT PUT/GET /insertion/diagnostic/:employeeId (chiffrement + masquage)', () => {
  it('PUT (RH) : les champs sensibles partent CHIFFRÉS en base et reviennent DÉCHIFFRÉS', async () => {
    const calls = [];
    mockQuery.mockImplementation((sql, params) => {
      calls.push({ sql: String(sql), params });
      const s = String(sql);
      if (/SELECT COALESCE\(parcours_num, 1\) AS pn FROM employees/.test(s)) return Promise.resolve({ rows: [{ pn: 1 }] });
      if (/INSERT INTO insertion_diagnostics/.test(s)) {
        // Reconstruit la ligne écrite depuis les colonnes dynamiques du INSERT
        const cols = s.match(/INSERT INTO insertion_diagnostics \(([^)]+)\)/)[1].split(',').map((c) => c.trim());
        const row = { id: 1 };
        cols.forEach((c, i) => { row[c] = params[i]; });
        return Promise.resolve({ rows: [row] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/diagnostic/5', 'RH', {
      commentaire_sante: 'Suivi kiné hebdomadaire',
      frein_judiciaire: 3,
      frein_judiciaire_detail: 'Rendez-vous mensuels à intégrer au planning',
      statut_saisie: 'en_cours',
    });
    expect(res.status).toBe(200);
    const ins = calls.find((c) => /INSERT INTO insertion_diagnostics/.test(c.sql));
    // En base : chiffré (préfixe encv1:), jamais le clair
    const stored = ins.params.filter((p) => typeof p === 'string' && p.startsWith(ENC_PREFIX));
    expect(stored.length).toBe(2); // commentaire_sante + frein_judiciaire_detail
    expect(ins.params).not.toContain('Suivi kiné hebdomadaire');
    // En réponse (RH) : déchiffré
    expect(res.body.commentaire_sante).toBe('Suivi kiné hebdomadaire');
    expect(res.body.frein_judiciaire_detail).toBe('Rendez-vous mensuels à intégrer au planning');
    expect(res.body.statut_saisie).toBe('en_cours');
  });

  it('PUT : statut_saisie hors enum → 400', async () => {
    const res = await put('/api/insertion/diagnostic/5', 'RH', { statut_saisie: 'brouillon' });
    expect(res.status).toBe(400);
  });

  const diagRow = () => ({
    id: 1, employee_id: 5, parcours_num: 1,
    frein_sante: 3, frein_judiciaire: 4,
    commentaire_sante: encryptField('Suivi médical en cours'),
    frein_judiciaire_detail: encryptField('Contrainte de planning'),
    frein_sante_detail: encryptField('Port de charges limité'),
    commentaire_budget: 'Dossier surendettement',
    commentaire_logement: 'Recherche de logement social',
  });

  it('GET (ADMIN) : champs sensibles présents et déchiffrés', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT COALESCE\(parcours_num, 1\) AS pn FROM employees/.test(s)) return Promise.resolve({ rows: [{ pn: 1 }] });
      if (/FROM insertion_diagnostics/.test(s)) return Promise.resolve({ rows: [diagRow()] });
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/diagnostic/5', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.commentaire_sante).toBe('Suivi médical en cours');
    expect(res.body.frein_judiciaire).toBe(4);
    expect(res.body.frein_judiciaire_detail).toBe('Contrainte de planning');
  });

  it('GET (MANAGER) : frein_judiciaire*, détails santé et commentaire_budget RETIRÉS ; le reste visible', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT COALESCE\(parcours_num, 1\) AS pn FROM employees/.test(s)) return Promise.resolve({ rows: [{ pn: 1 }] });
      if (/FROM insertion_diagnostics/.test(s)) return Promise.resolve({ rows: [diagRow()] });
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/diagnostic/5', 'MANAGER');
    expect(res.status).toBe(200);
    for (const hidden of ['frein_judiciaire', 'frein_judiciaire_detail', 'commentaire_sante', 'frein_sante_detail', 'commentaire_budget']) {
      expect(hidden in res.body).toBe(false);
    }
    // Le score santé (non détaillé) et les rubriques non sensibles restent visibles
    expect(res.body.frein_sante).toBe(3);
    expect(res.body.commentaire_logement).toBe('Recherche de logement social');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Objectifs — CRUD + garde sous-objectif 1 niveau
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /insertion/objectifs (Lot 3)', () => {
  it('POST par MANAGER → 403 (écriture A/RH)', async () => {
    const res = await post('/api/insertion/objectifs', 'MANAGER', { employee_id: 5, titre: 'X' });
    expect(res.status).toBe(403);
  });

  it('POST : sous-objectif de 2e niveau REFUSÉ (400)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT id, employee_id, parent_id FROM insertion_objectifs/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 3, employee_id: 5, parent_id: 7 }] }); // le parent est déjà un sous-objectif
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/objectifs', 'RH', { employee_id: 5, titre: 'Sous-sous-objectif', parent_id: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1 seul niveau/i);
  });

  it('POST OK → 201 avec la ligne créée', async () => {
    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO insertion_objectifs/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 12, employee_id: params[0], titre: params[3], statut: params[8], origine: params[5], parent_id: params[1] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/objectifs', 'RH', { employee_id: 5, titre: 'Obtenir le permis B', origine: 'salarie', echeance: '2026-12-01' });
    expect(res.status).toBe(201);
    expect(res.body.titre).toBe('Obtenir le permis B');
    expect(res.body.statut).toBe('en_cours'); // défaut
  });

  it('GET /objectifs/:employeeId → liste plate avec parent_id + nb_sous_objectifs (lecture MANAGER OK)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM insertion_objectifs o/.test(String(sql))) {
        return Promise.resolve({ rows: [
          { id: 1, employee_id: 5, parent_id: null, titre: 'Objectif A', statut: 'en_cours', nb_sous_objectifs: 1, milestone_titre: 'Bilan n° 1' },
          { id: 2, employee_id: 5, parent_id: 1, titre: 'Sous-objectif A1', statut: 'a_venir', nb_sous_objectifs: 0, milestone_titre: null },
        ] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/objectifs/5', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].nb_sous_objectifs).toBe(1);
    expect(res.body[1].parent_id).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Partenaires — lecture module / écriture A/RH
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /insertion/partenaires (Lot 3)', () => {
  it('GET accessible à tous les rôles du module (MANAGER inclus)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM insertion_partenaires/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 1, nom: 'CAF', categorie: 'administratif', actif: true }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/partenaires', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body[0].nom).toBe('CAF');
  });

  it('POST par MANAGER → 403 ; POST ADMIN → 201 ; doublon de nom → 409', async () => {
    expect((await post('/api/insertion/partenaires', 'MANAGER', { nom: 'X' })).status).toBe(403);

    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO insertion_partenaires/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 9, nom: params[0], categorie: params[1], actif: true }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const ok = await post('/api/insertion/partenaires', 'ADMIN', { nom: 'Mission locale', categorie: 'emploi' });
    expect(ok.status).toBe(201);

    mockQuery.mockImplementation((sql) => {
      if (/INSERT INTO insertion_partenaires/.test(String(sql))) {
        const err = new Error('duplicate'); err.code = '23505';
        return Promise.reject(err);
      }
      return Promise.resolve({ rows: [] });
    });
    const dup = await post('/api/insertion/partenaires', 'ADMIN', { nom: 'Mission locale' });
    expect(dup.status).toBe(409);
  });

  it('POST : catégorie hors référentiel → 400', async () => {
    const res = await post('/api/insertion/partenaires', 'RH', { nom: 'X', categorie: 'inconnue' });
    expect(res.status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /actions-overview — tableau transversal filtrable
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /insertion/actions-overview (Lot 3)', () => {
  it('renvoie { total, limit, offset, actions[] } avec salarié + rattachements + en_retard', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT COUNT\(\*\)::int AS n FROM cip_action_plans/.test(s)) return Promise.resolve({ rows: [{ n: 2 }] });
      if (/FROM cip_action_plans a/.test(s)) {
        return Promise.resolve({ rows: [
          { id: 1, employee_id: 5, first_name: 'A', last_name: 'B', action_label: 'Dossier CAF', category: 'frein', priority: 'haute', status: 'a_faire', echeance: '2026-06-01', milestone_titre: 'Bilan n° 1', objectif_titre: null, partenaire_nom: 'CAF', en_retard: true },
          { id: 2, employee_id: 6, first_name: 'C', last_name: 'D', action_label: 'CV', category: 'insertion', priority: 'moyenne', status: 'en_cours', echeance: null, milestone_titre: null, objectif_titre: 'Objectif A', partenaire_nom: null, en_retard: false },
        ] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/actions-overview', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.limit).toBe(100);
    expect(res.body.offset).toBe(0);
    expect(res.body.actions).toHaveLength(2);
    const a = res.body.actions[0];
    for (const k of ['first_name', 'last_name', 'action_label', 'category', 'priority', 'status', 'en_retard']) {
      expect(k in a).toBe(true);
    }
  });

  it('applique les filtres retard / mine / category / partenaire_id dans le SQL', async () => {
    const seen = [];
    mockQuery.mockImplementation((sql, params) => {
      seen.push({ sql: String(sql), params });
      if (/SELECT COUNT\(\*\)::int AS n/.test(String(sql))) return Promise.resolve({ rows: [{ n: 0 }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/actions-overview?retard=1&mine=1&category=frein&partenaire_id=3&statut=a_faire', 'RH');
    expect(res.status).toBe(200);
    const main = seen.find((c) => /FROM cip_action_plans a/.test(c.sql) && /ORDER BY a.echeance/.test(c.sql));
    expect(main.sql).toContain("a.echeance < CURRENT_DATE AND a.status IN ('a_faire', 'en_cours')");
    expect(main.sql).toContain('e.cip_referent_user_id');
    expect(main.params).toEqual(expect.arrayContaining(['frein', '3', 'a_faire', 1])); // 1 = user id (mine)
    expect(main.sql).toContain('ORDER BY a.echeance ASC NULLS LAST');
  });

  it('limit hors bornes → 400 (express-validator)', async () => {
    const res = await get('/api/insertion/actions-overview?limit=9999', 'RH');
    expect(res.status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /alertes/:employeeId — alertes consolidées de la fiche
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /insertion/alertes/:employeeId (Lot 1)', () => {
  it('consolide retards / pass IAE / CDDI / diagnostic / actions critiques + alertes scheduler', async () => {
    const in30d = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM employees e WHERE e.id = \$1/.test(s)) {
        return Promise.resolve({ rows: [{ id: 5, first_name: 'A', last_name: 'B', insertion_status: 'en_parcours', insertion_start_date: '2026-01-01', pass_iae_number: 'P1', pass_iae_end: in30d, parcours_num: 1 }] });
      }
      if (/jours_retard/.test(s)) return Promise.resolve({ rows: [{ id: 1, milestone_type: 'bilan_intermediaire', titre: 'Bilan n° 1', due_date: '2026-06-01', jours_retard: 45 }] });
      if (/status = 'a_planifier' AND due_date >= CURRENT_DATE/.test(s)) return Promise.resolve({ rows: [] });
      if (/SELECT value FROM settings/.test(s)) return Promise.resolve({ rows: [] }); // défauts
      if (/FROM employee_contracts/.test(s)) {
        return Promise.resolve({ rows: [{ contract_type: 'CDDI', start_date: '2024-08-01', end_date: '2026-08-01' }] });
      }
      if (/FROM insertion_diagnostics/.test(s)) return Promise.resolve({ rows: [] }); // pas de diagnostic
      if (/priority = 'haute'/.test(s)) return Promise.resolve({ rows: [{ id: 9, action_label: 'Dossier logement', echeance: '2026-07-01' }] });
      if (/FROM insertion_interview_alerts/.test(s)) return Promise.resolve({ rows: [{ id: 3, milestone_type: 'bilan_intermediaire', alert_type: 'retard', target_date: '2026-07-20', created_at: '2026-07-20T05:00:00Z' }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/alertes/5', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.employee_id).toBe(5);
    expect(typeof res.body.generated_at).toBe('string');
    expect(typeof res.body.total).toBe('number');
    const types = res.body.alertes.map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining([
      'jalon_en_retard', 'pass_iae_bientot_expire', 'cddi_plafond', 'diagnostic_absent', 'action_critique_en_retard',
    ]));
    for (const a of res.body.alertes) {
      expect(['critique', 'attention', 'info']).toContain(a.niveau);
      expect(typeof a.message).toBe('string');
    }
    expect(Array.isArray(res.body.alertes_scheduler)).toBe(true);
    expect(res.body.alertes_scheduler[0].alert_type).toBe('retard');
  });

  it('salarié inconnu → 404', async () => {
    const res = await get('/api/insertion/alertes/999', 'RH');
    expect(res.status).toBe(404);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PHASE D — écart 1c : acquittement d'alertes journalisé
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT POST /insertion/alertes/:employeeId/ack (phase D)', () => {
  const future = new Date(Date.now() + 7 * 86400000).toISOString();

  it('type manquant → 400 ; jusqu_au non ISO → 400', async () => {
    expect((await post('/api/insertion/alertes/5/ack', 'RH', { jusqu_au: future })).status).toBe(400);
    expect((await post('/api/insertion/alertes/5/ack', 'RH', { type: 'cddi_plafond', jusqu_au: 'demain' })).status).toBe(400);
  });

  it('jusqu_au dans le passé → 400 (message explicite)', async () => {
    const res = await post('/api/insertion/alertes/5/ack', 'RH', { type: 'cddi_plafond', jusqu_au: '2020-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future/i);
  });

  it('salarié inconnu → 404', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT id FROM employees WHERE id = \$1/.test(String(sql))) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/alertes/999/ack', 'RH', { type: 'cddi_plafond', jusqu_au: future });
    expect(res.status).toBe(404);
  });

  it('acquittement OK (MANAGER inclus) → 201 { employee_id, alert_type, acked_by, acked_until }', async () => {
    const calls = [];
    mockQuery.mockImplementation((sql, params) => {
      calls.push({ sql: String(sql), params });
      const s = String(sql);
      if (/SELECT id FROM employees WHERE id = \$1/.test(s)) return Promise.resolve({ rows: [{ id: 5 }] });
      if (/INSERT INTO insertion_alert_acks/.test(s)) {
        return Promise.resolve({ rows: [{ id: 1, employee_id: params[0], alert_type: params[1], acked_by: params[2], acked_until: params[3], created_at: '2026-07-23T08:00:00Z' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/alertes/5/ack', 'MANAGER', { type: 'pass_iae_a_surveiller', jusqu_au: future });
    expect(res.status).toBe(201);
    expect(res.body.employee_id).toBe(5);
    expect(res.body.alert_type).toBe('pass_iae_a_surveiller');
    expect(res.body.acked_by).toBe(1); // l'utilisateur du JWT est journalisé
    expect(typeof res.body.acked_until).toBe('string');
  });
});

describe('CONTRAT GET /insertion/alertes/:employeeId — filtrage des acquittées (phase D)', () => {
  it("une alerte dont le type est acquitté sort d'`alertes` et part dans `acquittees` ; total = actives", async () => {
    const ackedUntil = new Date(Date.now() + 5 * 86400000).toISOString();
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM employees e WHERE e.id = \$1/.test(s)) {
        return Promise.resolve({ rows: [{ id: 5, first_name: 'A', last_name: 'B', insertion_status: 'en_parcours', insertion_start_date: null, pass_iae_number: null, pass_iae_end: null, parcours_num: 1 }] });
      }
      if (/jours_retard/.test(s)) return Promise.resolve({ rows: [{ id: 1, milestone_type: 'bilan_intermediaire', titre: 'Bilan n° 1', due_date: '2026-06-01', jours_retard: 45 }] });
      if (/FROM employee_contracts/.test(s)) {
        return Promise.resolve({ rows: [{ contract_type: 'CDDI', start_date: '2024-08-01', end_date: '2026-08-01' }] });
      }
      if (/FROM insertion_alert_acks/.test(s)) {
        return Promise.resolve({ rows: [{ alert_type: 'cddi_plafond', acked_until: ackedUntil }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/alertes/5', 'RH');
    expect(res.status).toBe(200);
    const typesActifs = res.body.alertes.map((a) => a.type);
    expect(typesActifs).toContain('jalon_en_retard');       // non acquittée → active
    expect(typesActifs).not.toContain('cddi_plafond');       // acquittée → retirée
    expect(res.body.acquittees).toHaveLength(1);
    expect(res.body.acquittees[0].type).toBe('cddi_plafond');
    expect(res.body.acquittees[0].acked_until).toBe(ackedUntil);
    expect(res.body.total).toBe(res.body.alertes.length);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PHASE D — écarts 1a/1d : cohorte/stats enrichie, alias retirés
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /insertion/cohorte/stats (phase D)', () => {
  const wire = (sql) => {
    const s = String(sql);
    if (/im\.status <> 'realise'/.test(s)) {
      return Promise.resolve({ rows: [
        { id: 1, employee_id: 5, milestone_type: 'bilan_intermediaire', titre: 'Bilan n° 2', due_date: '2026-07-23', interview_date: '2026-07-23T14:30:00Z', status: 'planifie', ia_preparation_ready: true, first_name: 'A', last_name: 'B', days_until: 0 },
        { id: 2, employee_id: 6, milestone_type: 'renouvellement', titre: null, due_date: '2026-07-01', interview_date: null, status: 'a_planifier', ia_preparation_ready: false, first_name: 'C', last_name: 'D', days_until: -22 },
      ] });
    }
    if (/milestone_type = 'bilan_sortie'/.test(s)) {
      return Promise.resolve({ rows: [
        { sortie_classification: 'emploi_durable', sortie_type: 'CDI', n: 2 },
        { sortie_classification: 'autre', sortie_type: null, n: 1 },
      ] });
    }
    return Promise.resolve({ rows: [] });
  };

  it('jalons (agenda/retards) portent titre, interview_date et ia_preparation_ready', async () => {
    mockQuery.mockImplementation(wire);
    const res = await get('/api/insertion/cohorte/stats', 'RH');
    expect(res.status).toBe(200);
    const auj = res.body.agenda_30j.find((j) => j.id === 1);
    expect(auj.titre).toBe('Bilan n° 2');
    expect(auj.interview_date).toBe('2026-07-23T14:30:00Z');
    expect(auj.ia_preparation_ready).toBe(true);
    const retard = res.body.jalons_en_retard.find((j) => j.id === 2);
    expect(retard.ia_preparation_ready).toBe(false);
    expect('titre' in retard).toBe(true);
  });

  it('sorties : dynamiques/autres SANS les alias positives/negatives (retirés)', async () => {
    mockQuery.mockImplementation(wire);
    const res = await get('/api/insertion/cohorte/stats', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.sorties.total).toBe(3);
    expect(res.body.sorties.dynamiques).toBe(2);
    expect(res.body.sorties.autres).toBe(1);
    expect(res.body.sorties.taux_dynamiques).toBe(67);
    expect('positives' in res.body.sorties).toBe(false);
    expect('negatives' in res.body.sorties).toBe(false);
  });

  it("GET /insertion/audit : alias positives/negatives également retirés", async () => {
    mockQuery.mockImplementation(wire);
    const res = await get('/api/insertion/audit?year=2026', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.sorties.dynamiques).toBe(2);
    expect(res.body.sorties.autres).toBe(1);
    expect('positives' in res.body.sorties).toBe(false);
    expect('negatives' in res.body.sorties).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PHASE D — écart 1b : suggestions de freins calculées côté serveur
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT PUT /insertion/diagnostic/:id — suggestions_freins (phase D)', () => {
  const wireUpsert = () => {
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT COALESCE\(parcours_num, 1\) AS pn FROM employees/.test(s)) return Promise.resolve({ rows: [{ pn: 1 }] });
      if (/INSERT INTO insertion_diagnostics/.test(s)) {
        const cols = s.match(/INSERT INTO insertion_diagnostics \(([^)]+)\)/)[1].split(',').map((c) => c.trim());
        const row = { id: 1 };
        cols.forEach((c, i) => { row[c] = params[i]; });
        return Promise.resolve({ rows: [row] });
      }
      return Promise.resolve({ rows: [] });
    });
  };

  it('règles documentées : sans_abri→logement 5, difficultés+crédits→finances 4, ni permis/véhicule/TC→mobilité 4, A1→linguistique 4, contre-indications→santé 3', async () => {
    wireUpsert();
    const res = await put('/api/insertion/diagnostic/5', 'RH', {
      logement_statut: 'sans_abri',
      difficultes_financieres: true,
      credits_en_cours: true,
      permis_b_statut: 'non',
      vehicule: false,
      moyen_transport: ['a_pied'],
      cecrl_niveau: 'A1',
      contre_indications: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.suggestions_freins).toEqual(expect.objectContaining({
      logement: 5, finances: 4, mobilite: 4, linguistique: 4, sante: 3,
    }));
    expect('judiciaire' in res.body.suggestions_freins).toBe(false); // jamais de suggestion art. 10
  });

  it('transports en commun disponibles → mobilité suggérée 3 (au lieu de 4)', async () => {
    wireUpsert();
    const res = await put('/api/insertion/diagnostic/5', 'RH', {
      permis_b_statut: 'non', vehicule: false, moyen_transport: ['transports_commun'],
    });
    expect(res.status).toBe(200);
    expect(res.body.suggestions_freins.mobilite).toBe(3);
  });

  it('situation stable → suggestions basses ; aucune réponse → objet vide', async () => {
    wireUpsert();
    const ok = await put('/api/insertion/diagnostic/5', 'RH', {
      logement_statut: 'locataire_social', difficultes_financieres: false,
      permis_b_statut: 'oui', vehicule: true, cecrl_niveau: 'C1',
    });
    expect(ok.body.suggestions_freins).toEqual(expect.objectContaining({ logement: 1, finances: 1, mobilite: 1, linguistique: 1 }));

    wireUpsert();
    const vide = await put('/api/insertion/diagnostic/5', 'RH', { statut_saisie: 'en_cours' });
    expect(vide.status).toBe(200);
    expect(vide.body.suggestions_freins).toEqual({});
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PHASE D — REC-UX-18 : GET /insertion/parametres
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /insertion/parametres (REC-UX-18)', () => {
  it('sans réglage en base → défauts documentés (14 j / 2 mois / 30 j / 7 mois / IA off)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await get('/api/insertion/parametres', 'MANAGER'); // tous rôles du module
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      echeance_action_defaut_jours: 14,
      rythme_bilans_mois: 2,
      delai_diagnostic_jours: 30,
      alerte_pass_iae_mois: 7,
      ia_preparation_auto: false,
    });
  });

  it('réglages présents en settings → valeurs lues (nombre parsé)', async () => {
    mockQuery.mockImplementation((sql, params) => {
      if (/SELECT value FROM settings WHERE key = \$1/.test(String(sql))) {
        const byKey = {
          'insertion.echeance_action_defaut_jours': '21',
          'insertion.rythme_bilans_mois': '3',
          'insertion.ia_preparation_auto': 'true',
        };
        const v = byKey[params[0]];
        return Promise.resolve({ rows: v ? [{ value: v }] : [] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/parametres', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.echeance_action_defaut_jours).toBe(21);
    expect(res.body.rythme_bilans_mois).toBe(3);
    expect(res.body.ia_preparation_auto).toBe(true);
    expect(res.body.delai_diagnostic_jours).toBe(30); // défaut conservé
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Masquage MANAGER sur les listes d'entretiens
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT habilitations — MANAGER ne voit JAMAIS frein_judiciaire', () => {
  it('GET /milestones/:employeeId : frein_judiciaire retiré pour MANAGER, présent pour RH', async () => {
    const wire = (sql) => {
      if (/FROM insertion_milestones im/.test(String(sql))) {
        return Promise.resolve({ rows: [fullMilestone({ frein_judiciaire: 5 })] });
      }
      return Promise.resolve({ rows: [] });
    };
    mockQuery.mockImplementation(wire);
    const rh = await get('/api/insertion/milestones/5', 'RH');
    expect(rh.status).toBe(200);
    expect(rh.body[0].frein_judiciaire).toBe(5);

    mockQuery.mockImplementation(wire);
    const mgr = await get('/api/insertion/milestones/5', 'MANAGER');
    expect(mgr.status).toBe(200);
    expect('frein_judiciaire' in mgr.body[0]).toBe(false);
    expect(mgr.body[0].frein_mobilite).toBe(2); // les autres axes restent visibles
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PR 2 PHASE A — PMSMP / satisfaction / renouvellements / Pass IAE / cibles /
// audit conventionnel / exports freins & synthèse
// ═══════════════════════════════════════════════════════════════════════════
const getX = (path, role = 'ADMIN') => request(appExports).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);

// ───────────────────────────────────────────────────────────────────────────
// PMSMP (EXG-05) — bornes 31 j / 60 j, forçage motivé
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /insertion/pmsmp (PR 2 — EXG-05)', () => {
  const wireEmploye = (extra = () => null) => {
    mockQuery.mockImplementation((sql, params) => {
      const r = extra(String(sql), params);
      if (r) return r;
      const s = String(sql);
      if (/SELECT id FROM employees WHERE id = \$1/.test(s)) return Promise.resolve({ rows: [{ id: 5 }] });
      if (/SELECT date_debut, date_fin FROM insertion_pmsmp/.test(s)) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
  };

  it('POST par MANAGER → 403 (écriture A/RH) ; DELETE MANAGER → 403', async () => {
    expect((await post('/api/insertion/pmsmp', 'MANAGER', {})).status).toBe(403);
    expect((await request(app).delete('/api/insertion/pmsmp/1').set('Authorization', `Bearer ${TOKENS.MANAGER}`)).status).toBe(403);
  });

  it('durée > 31 jours par convention → 409 { error, code: pmsmp_duree } (non forçable)', async () => {
    wireEmploye();
    const res = await post('/api/insertion/pmsmp', 'RH', {
      employee_id: 5, entreprise: 'Atelier ST', objet: 'decouvrir_metier',
      date_debut: '2026-07-01', date_fin: '2026-08-05', force: true, motif_depassement: 'x',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('pmsmp_duree');
    expect(res.body.jours).toBe(36);
  });

  it('date_fin < date_debut → 400 ; objet hors nomenclature → 400', async () => {
    wireEmploye();
    const dates = await post('/api/insertion/pmsmp', 'RH', {
      employee_id: 5, entreprise: 'X', objet: 'confirmer_projet',
      date_debut: '2026-07-10', date_fin: '2026-07-01',
    });
    expect(dates.status).toBe(400);
    const objet = await post('/api/insertion/pmsmp', 'RH', {
      employee_id: 5, entreprise: 'X', objet: 'stage', date_debut: '2026-07-01', date_fin: '2026-07-05',
    });
    expect(objet.status).toBe(400);
  });

  it('cumul > 60 j / 12 mois glissants → 409 { code: pmsmp_cumul, detail, cumul } avec l’assiette expliquée', async () => {
    wireEmploye((s) => {
      if (/SELECT date_debut, date_fin FROM insertion_pmsmp/.test(s)) {
        return Promise.resolve({ rows: [{ date_debut: '2026-01-05', date_fin: '2026-02-18' }] }); // 45 j
      }
      return null;
    });
    const res = await post('/api/insertion/pmsmp', 'RH', {
      employee_id: 5, entreprise: 'X', objet: 'confirmer_projet',
      date_debut: '2026-07-01', date_fin: '2026-07-20', // +20 j → 65
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('pmsmp_cumul');
    expect(res.body.detail).toMatch(/même organisme d'accueil/i); // réserve RES-07 sourcée
    expect(res.body.cumul.total).toBe(65);
  });

  it('les jours déclarés hors ERP (autres_jours_connus) comptent dans le contrôle', async () => {
    wireEmploye();
    const res = await post('/api/insertion/pmsmp', 'RH', {
      employee_id: 5, entreprise: 'X', objet: 'confirmer_projet',
      date_debut: '2026-07-01', date_fin: '2026-07-20', autres_jours_connus: 45,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('pmsmp_cumul');
    expect(res.body.cumul.autres_jours_connus).toBe(45);
  });

  it('force sans motif_depassement → 400 { code: pmsmp_motif_requis }', async () => {
    wireEmploye((s) => (/SELECT date_debut, date_fin FROM insertion_pmsmp/.test(s)
      ? Promise.resolve({ rows: [{ date_debut: '2026-01-05', date_fin: '2026-02-18' }] }) : null));
    const res = await post('/api/insertion/pmsmp', 'RH', {
      employee_id: 5, entreprise: 'X', objet: 'confirmer_projet',
      date_debut: '2026-07-01', date_fin: '2026-07-20', force: true,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('pmsmp_motif_requis');
  });

  it('force + motif → 201, dépassement TRACÉ dans bilan, rappel « Immersion Facilitée » si non saisi dans l’outil', async () => {
    let inserted = null;
    wireEmploye((s, params) => {
      if (/SELECT date_debut, date_fin FROM insertion_pmsmp/.test(s)) {
        return Promise.resolve({ rows: [{ date_debut: '2026-01-05', date_fin: '2026-02-18' }] });
      }
      if (/INSERT INTO insertion_pmsmp/.test(s)) {
        inserted = params;
        return Promise.resolve({ rows: [{ id: 3, employee_id: params[0], entreprise: params[1], objet: params[3], date_debut: params[4], date_fin: params[5], bilan: params[7], saisie_outil_officiel: false }] });
      }
      return null;
    });
    const res = await post('/api/insertion/pmsmp', 'RH', {
      employee_id: 5, entreprise: 'Recyclerie', objet: 'initier_recrutement',
      date_debut: '2026-07-01', date_fin: '2026-07-20',
      force: true, motif_depassement: 'Immersions chez des organismes différents (plafond par organisme respecté)',
    });
    expect(res.status).toBe(201);
    expect(res.body.jours).toBe(20);
    expect(inserted[7]).toMatch(/Dépassement du cumul PMSMP/);
    expect(inserted[7]).toMatch(/organismes différents/);
    expect(res.body.rappel).toMatch(/Immersion Facilitée/);
  });

  it('GET /pmsmp/:employeeId (MANAGER lecture) → { employee_id, total, cumul_12mois_jours, regles, pmsmp[] avec jours }', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM insertion_pmsmp p/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 1, employee_id: 5, entreprise: 'X', objet: 'confirmer_projet', date_debut: '2026-07-01', date_fin: '2026-07-10', saisie_outil_officiel: true, created_by_first: 'T', created_by_last: 'U' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/pmsmp/5', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.employee_id).toBe(5);
    expect(res.body.total).toBe(1);
    expect(res.body.regles).toEqual({ max_jours_convention: 31, max_cumul_12mois: 60 });
    expect(res.body.pmsmp[0].jours).toBe(10);
    expect(typeof res.body.cumul_12mois_jours).toBe('number');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Satisfaction de sortie (EXG-09) — upsert par parcours + stats ANONYMES
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /insertion/satisfaction (PR 2 — EXG-09)', () => {
  it('POST par MANAGER → 403 (saisie A/RH)', async () => {
    expect((await post('/api/insertion/satisfaction/5', 'MANAGER', {})).status).toBe(403);
  });

  it('POST RH → 201, upsert par (employee_id, parcours_num) — parcours courant du salarié', async () => {
    let upsert = null;
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT id FROM employees WHERE id = \$1/.test(s)) return Promise.resolve({ rows: [{ id: 5 }] });
      if (/SELECT COALESCE\(parcours_num, 1\) AS pn FROM employees/.test(s)) return Promise.resolve({ rows: [{ pn: 2 }] });
      if (/INSERT INTO insertion_satisfaction_sortie/.test(s)) {
        upsert = { sql: s, params };
        return Promise.resolve({ rows: [{ id: 7, employee_id: params[0], parcours_num: params[1], satisfaction_globale: params[6] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/satisfaction/5', 'RH', {
      satisfaction_globale: 4, situation_sortie: 'emploi',
      reponses: { accueil: 4, accompagnement: { entretiens: 3 } },
      suggestions: 'Plus de visites d’entreprises',
    });
    expect(res.status).toBe(201);
    expect(res.body.parcours_num).toBe(2); // RES-05 : un 2e parcours a SA réponse
    expect(upsert.sql).toContain('ON CONFLICT (employee_id, parcours_num)');
  });

  it('satisfaction_globale hors échelle 1-4 → 400', async () => {
    const res = await post('/api/insertion/satisfaction/5', 'RH', { satisfaction_globale: 5 });
    expect(res.status).toBe(400);
  });

  it('GET /satisfaction-stats → agrégats ANONYMES (moyennes par section, répartition, situations) — MANAGER autorisé', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM insertion_satisfaction_sortie/.test(String(sql))) {
        return Promise.resolve({ rows: [
          { reponses: { accueil: 4, accompagnement: { q1: 3, q2: 4 } }, situation_sortie: 'emploi', satisfaction_globale: 4 },
          { reponses: { accueil: 2 }, situation_sortie: null, satisfaction_globale: 3 },
        ] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/satisfaction-stats?year=2026', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.annee).toBe(2026);
    expect(res.body.nb_reponses).toBe(2);
    expect(res.body.satisfaction_globale.moyenne).toBe(3.5);
    expect(res.body.satisfaction_globale.repartition).toEqual({ 1: 0, 2: 0, 3: 1, 4: 1 });
    expect(res.body.sections.accueil).toEqual({ moyenne: 3, nb: 2 });
    expect(res.body.sections.accompagnement).toEqual({ moyenne: 3.5, nb: 2 });
    expect(res.body.situations_sortie).toEqual({ emploi: 1 });
    // ANONYME : aucun identifiant nominatif ni verbatim dans la réponse
    const flat = JSON.stringify(res.body);
    expect(flat).not.toMatch(/first_name|last_name|employee_id|suggestions|avis_transmis/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Renouvellements (EXG-04 reste) — file + formulaire ETI limité
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /insertion/renouvellements (PR 2 — EXG-04/RES-10)', () => {
  it('GET → { anticipation_jours (défaut 42), total, renouvellements[] } avec état de l’entretien', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = true/.test(s)) {
        return Promise.resolve({ rows: [
          { employee_id: 5, first_name: 'A', last_name: 'B', contract_id: 9, contract_end: '2026-08-20', jours_restants: 28, milestone_id: 44, milestone_status: 'planifie', milestone_titre: 'Renouvellement août 2026', milestone_due_date: '2026-08-10', renouvellement_avis: null, renouvellement_duree_mois: null, formulaire_rempli: true, verrouille: false },
          { employee_id: 6, first_name: 'C', last_name: 'D', contract_id: 10, contract_end: '2026-08-05', jours_restants: 13, milestone_id: null, milestone_status: null, milestone_titre: null, milestone_due_date: null, renouvellement_avis: null, renouvellement_duree_mois: null, formulaire_rempli: null, verrouille: null },
        ] });
      }
      return Promise.resolve({ rows: [] }); // settings → défaut 42
    });
    const res = await get('/api/insertion/renouvellements', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.anticipation_jours).toBe(42);
    expect(res.body.total).toBe(2);
    const [avec, sans] = res.body.renouvellements;
    expect(avec.a_creer).toBe(false);
    expect(avec.entretien).toEqual(expect.objectContaining({ id: 44, formulaire_rempli: true, verrouille: false }));
    expect(sans.a_creer).toBe(true);
    expect(sans.entretien).toBeNull();
  });

  it('PUT formulaire : tout champ HORS bloc renouvellement → 400 { champs_refuses, champs_acceptes }', async () => {
    const res = await put('/api/insertion/renouvellements/44/formulaire', 'MANAGER', {
      renouvellement_avis: 'favorable', observations: 'tentative hors périmètre',
    });
    expect(res.status).toBe(400);
    expect(res.body.champs_refuses).toEqual(['observations']);
    expect(res.body.champs_acceptes).toEqual(['renouvellement_form', 'renouvellement_avis', 'renouvellement_duree_mois']);
  });

  it('PUT formulaire (MANAGER) : n’écrit QUE le bloc renouvellement + validation « eti » horodatée ; réponse masquée', async () => {
    let update = null;
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT \* FROM insertion_milestones WHERE id = \$1/.test(s)) {
        return Promise.resolve({ rows: [fullMilestone({ id: 44, milestone_type: 'renouvellement', titre: 'Renouvellement', frein_judiciaire: 4 })] });
      }
      // Ownership : le MANAGER (id 1) est l'encadrant référent du salarié.
      if (/cip_referent_user_id, mgr\.user_id/.test(s)) {
        return Promise.resolve({ rows: [{ cip_referent_user_id: null, manager_user_id: 1 }] });
      }
      if (/UPDATE insertion_milestones SET/.test(s)) {
        update = { sql: s, params };
        return Promise.resolve({ rows: [fullMilestone({ id: 44, milestone_type: 'renouvellement', frein_judiciaire: 4, renouvellement_avis: params[1], validations: [{ role: 'eti', user_id: 1, at: 'x', mode: 'compte' }] })] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/renouvellements/44/formulaire', 'MANAGER', {
      renouvellement_form: { assiduite: 'bonne', motivation: 'ok' },
      renouvellement_avis: 'favorable_reserves',
      renouvellement_duree_mois: 4,
    });
    expect(res.status).toBe(200);
    // SQL : uniquement les 3 champs du bloc + validations (+ updated_at)
    expect(update.sql).toContain('renouvellement_form = $');
    expect(update.sql).toContain('renouvellement_avis = $');
    expect(update.sql).toContain('renouvellement_duree_mois = $');
    expect(update.sql).toContain('validations = $');
    expect(update.sql).not.toMatch(/frein_|observations =|bilan_professionnel =|sortie_/);
    const validations = JSON.parse(update.params[3]);
    expect(validations[validations.length - 1]).toEqual(expect.objectContaining({ role: 'eti', user_id: 1, mode: 'compte' }));
    // Masquage MANAGER conservé sur la réponse
    expect('frein_judiciaire' in res.body).toBe(false);
    expect(res.body.renouvellement_avis).toBe('favorable_reserves');
  });

  it('PUT formulaire (MANAGER NON référent) → 403 { code: renouvellement_non_autorise } (P1 Codex PR#74)', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT \* FROM insertion_milestones WHERE id = \$1/.test(s)) {
        return Promise.resolve({ rows: [fullMilestone({ id: 44, milestone_type: 'renouvellement' })] });
      }
      // Ownership : ni CIP référent ni encadrant du salarié (autre encadrant).
      if (/cip_referent_user_id, mgr\.user_id/.test(s)) {
        return Promise.resolve({ rows: [{ cip_referent_user_id: 99, manager_user_id: 42 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/renouvellements/44/formulaire', 'MANAGER', { renouvellement_avis: 'favorable' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('renouvellement_non_autorise');
  });

  it('ADMIN/RH conservent le bypass d’ownership sur le formulaire de renouvellement', async () => {
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT \* FROM insertion_milestones WHERE id = \$1/.test(s)) {
        return Promise.resolve({ rows: [fullMilestone({ id: 44, milestone_type: 'renouvellement' })] });
      }
      if (/cip_referent_user_id, mgr\.user_id/.test(s)) return Promise.resolve({ rows: [{ cip_referent_user_id: 999, manager_user_id: 999 }] });
      if (/UPDATE insertion_milestones SET/.test(s)) return Promise.resolve({ rows: [fullMilestone({ id: 44, milestone_type: 'renouvellement', renouvellement_avis: params[1] })] });
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/renouvellements/44/formulaire', 'RH', { renouvellement_avis: 'favorable' });
    expect(res.status).toBe(200); // RH n'est pas soumis au contrôle d'ownership
  });

  it('PUT formulaire : entretien verrouillé → 409 ; type non renouvellement → 400 ; avis hors enum → 400', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT \* FROM insertion_milestones WHERE id = \$1/.test(String(sql))) {
        return Promise.resolve({ rows: [fullMilestone({ milestone_type: 'renouvellement', locked_at: '2026-07-01T00:00:00Z' })] });
      }
      return Promise.resolve({ rows: [] });
    });
    expect((await put('/api/insertion/renouvellements/44/formulaire', 'RH', { renouvellement_avis: 'favorable' })).status).toBe(409);

    mockQuery.mockImplementation((sql) => {
      if (/SELECT \* FROM insertion_milestones WHERE id = \$1/.test(String(sql))) {
        return Promise.resolve({ rows: [fullMilestone({ milestone_type: 'bilan_intermediaire' })] });
      }
      return Promise.resolve({ rows: [] });
    });
    expect((await put('/api/insertion/renouvellements/44/formulaire', 'RH', { renouvellement_avis: 'favorable' })).status).toBe(400);

    expect((await put('/api/insertion/renouvellements/44/formulaire', 'RH', { renouvellement_avis: 'tres_favorable' })).status).toBe(400);
  });

  it('garde RES-10 : un MANAGER ne peut NI créer un entretien non-renouvellement NI passer par le PUT générique', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/SELECT COALESCE\(parcours_num, 1\) AS pn FROM employees/.test(String(sql))) return Promise.resolve({ rows: [{ pn: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    const creation = await post('/api/insertion/milestones', 'MANAGER', { employee_id: 5, milestone_type: 'bilan_intermediaire' });
    expect(creation.status).toBe(403);

    const putGenerique = await put('/api/insertion/milestones/44', 'MANAGER', { renouvellement_avis: 'favorable' });
    expect(putGenerique.status).toBe(403);
    expect(putGenerique.body.hint).toMatch(/renouvellements\/:id\/formulaire/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /:employeeId — la fiche agrège désormais PMSMP + satisfaction (plan §2.1)
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /insertion/:employeeId — agrégation PMSMP/satisfaction (PR 2)', () => {
  it('expose pmsmp[] (avec jours) et satisfaction (parcours courant) sur la fiche', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/LEFT JOIN users cu ON cu.id = e.cip_referent_user_id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 5, first_name: 'A', last_name: 'B', team_id: null, position: 'Agent de tri Cddi', is_active: true, insertion_status: 'en_parcours', insertion_start_date: '2026-01-05', contract_end: null, parcours_num: 1 }] });
      }
      if (/FROM insertion_pmsmp/.test(s)) {
        return Promise.resolve({ rows: [{ id: 1, employee_id: 5, entreprise: 'Recyclerie', objet: 'confirmer_projet', date_debut: '2026-03-02', date_fin: '2026-03-13' }] });
      }
      if (/FROM insertion_satisfaction_sortie/.test(s)) {
        return Promise.resolve({ rows: [{ id: 2, employee_id: 5, parcours_num: 1, satisfaction_globale: 3 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/5', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.pmsmp).toHaveLength(1);
    expect(res.body.pmsmp[0].jours).toBe(12);
    expect(res.body.satisfaction).toEqual(expect.objectContaining({ satisfaction_globale: 3 }));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Bilan de prolongation Pass IAE (EXG-02) — A/RH, sans art. 9/10
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /insertion/pass-iae/bilan/:employeeId (PR 2 — EXG-02)', () => {
  it('MANAGER → 403 (document destiné au prescripteur, généré par A/RH)', async () => {
    expect((await get('/api/insertion/pass-iae/bilan/5', 'MANAGER')).status).toBe(403);
  });

  it('ADMIN → JSON structuré : Pass, entretiens, freins SANS judiciaire, actions sans détail santé/judiciaire, PMSMP', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/LEFT JOIN prescripteur_orgas po ON po.id = e.prescripteur_id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 5, first_name: 'A', last_name: 'B', position: 'Agent de tri Cddi', insertion_status: 'en_parcours', insertion_start_date: '2025-01-06', insertion_end_date: null, pass_iae_number: 'PASS-123', pass_iae_start: '2025-01-06', pass_iae_end: '2027-01-05', parcours_num: 1, prescripteur_nom: 'France Travail Rouen', prescripteur_type: 'FT' }] });
      }
      if (/SELECT contract_type, start_date, end_date FROM employee_contracts/.test(s)) {
        return Promise.resolve({ rows: [{ contract_type: 'CDDI', start_date: '2025-01-06', end_date: '2026-01-05' }] });
      }
      if (/SELECT id, milestone_type, titre, status, due_date/.test(s)) {
        return Promise.resolve({ rows: [{ id: 1, milestone_type: 'diagnostic_accueil', titre: "Diagnostic d'accueil", status: 'realise', due_date: '2025-02-01', completed_date: '2025-02-01', avis_global: 'positif', renouvellement_avis: null, renouvellement_duree_mois: null }] });
      }
      if (/FROM insertion_diagnostics/.test(s)) {
        return Promise.resolve({ rows: [{ frein_mobilite: 4, frein_sante: 2, frein_finances: 3, frein_famille: null, frein_linguistique: 1, frein_administratif: 2, frein_numerique: 2, frein_logement: 3, projet_formation: 'CACES', emploi_vise: 'Cariste', niveau_formation: 'niv3' }] });
      }
      if (/FROM cip_action_plans a/.test(s)) {
        return Promise.resolve({ rows: [
          { action_label: 'Dossier logement social', category: 'frein', frein_type: 'logement', status: 'en_cours', echeance: '2026-09-01', resultat: null, duree_minutes: 30, partenaire_nom: 'SOLIHA' },
          { action_label: 'Suivi médical', category: 'frein', frein_type: 'sante', status: 'en_cours', echeance: null, resultat: 'RDV pris', duree_minutes: null, partenaire_nom: 'CPAM' },
          { action_label: 'RDV SPIP', category: 'frein', frein_type: 'judiciaire', status: 'a_faire', echeance: null, resultat: null, duree_minutes: null, partenaire_nom: 'SPIP' },
        ] });
      }
      if (/FROM insertion_pmsmp/.test(s)) {
        return Promise.resolve({ rows: [{ entreprise: 'Recyclerie', objet: 'confirmer_projet', date_debut: '2026-03-02', date_fin: '2026-03-13', saisie_outil_officiel: true }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/pass-iae/bilan/5', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.pass_iae).toEqual({ number: 'PASS-123', start: '2025-01-06', end: '2027-01-05' });
    expect(res.body.prescripteur).toEqual({ nom: 'France Travail Rouen', type: 'FT' });
    expect(res.body.mention).toMatch(/emplois de l'inclusion/);
    // Freins : 8 axes, JAMAIS le judiciaire (destinataire externe — art. 10)
    expect(res.body.freins).toHaveLength(8);
    expect(res.body.freins.map((f) => f.key)).not.toContain('judiciaire');
    const mob = res.body.freins.find((f) => f.key === 'mobilite');
    expect(mob).toEqual(expect.objectContaining({ premier: 4, dernier: 4, delta: 0 }));
    // Actions : la judiciaire est EXCLUE ; la santé est comptée mais masquée
    expect(res.body.actions.liste).toHaveLength(2);
    expect(JSON.stringify(res.body.actions)).not.toMatch(/SPIP|judiciaire/);
    const sante = res.body.actions.liste.find((a) => a.detail_masque);
    expect(sante.action_label).toBeNull();
    expect(sante.partenaire_nom).toBe('CPAM');
    // PMSMP avec durée calculée
    expect(res.body.pmsmp[0].jours).toBe(12);
    expect(res.body.entretiens).toHaveLength(1);
    expect(res.body.cddi.months_total).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Cibles conventionnelles (EXG-47/D12) — nullables, jamais inventées
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT /insertion/cibles (PR 2 — EXG-47)', () => {
  it('GET (MANAGER lecture) sans paramétrage → les 6 cibles à null + note « objectif non paramétré »', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await get('/api/insertion/cibles', 'MANAGER');
    expect(res.status).toBe(200);
    for (const k of ['cible_etp_conventionnes', 'cible_taux_dynamiques', 'cible_taux_durable', 'cible_taux_transition', 'cible_taux_positive', 'effectif_reference']) {
      expect(res.body[k]).toBeNull();
    }
    expect(res.body.note).toMatch(/objectif non paramétré/);
  });

  it('GET : cibles présentes en settings → nombres parsés ; repli sur l’objectif DREETS historique pour les dynamiques', async () => {
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/SELECT key, value FROM settings WHERE key = ANY\(\$1\)/.test(s)) {
        return Promise.resolve({ rows: [{ key: 'insertion.cible_taux_durable', value: '54.3' }] });
      }
      if (/SELECT value FROM settings WHERE key = \$1/.test(s) && params[0] === 'insertion.objectif_sorties_dynamiques') {
        return Promise.resolve({ rows: [{ value: '82.6' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/cibles', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.cible_taux_durable).toBe(54.3);
    expect(res.body.cible_taux_dynamiques).toBe(82.6); // repli clé historique
    expect(res.body.cible_taux_transition).toBeNull();
  });

  it('PUT par MANAGER → 403 ; pourcentage hors 0-100 → 400 ; valeur négative → 400', async () => {
    expect((await put('/api/insertion/cibles', 'MANAGER', { cible_taux_dynamiques: 80 })).status).toBe(403);
    expect((await put('/api/insertion/cibles', 'RH', { cible_taux_dynamiques: 150 })).status).toBe(400);
    expect((await put('/api/insertion/cibles', 'RH', { cible_etp_conventionnes: -3 })).status).toBe(400);
    expect((await put('/api/insertion/cibles', 'RH', {})).status).toBe(400); // rien à modifier
  });

  it('PUT RH → upsert settings (clé insertion.cible_*) ; null EFFACE (retour à « non paramétré »)', async () => {
    const writes = [];
    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO settings/.test(String(sql))) { writes.push(params); return Promise.resolve({ rows: [] }); }
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/cibles', 'RH', { cible_etp_conventionnes: 24.76, cible_taux_dynamiques: null });
    expect(res.status).toBe(200);
    expect(writes).toEqual(expect.arrayContaining([
      ['insertion.cible_etp_conventionnes', '24.76'],
      ['insertion.cible_taux_dynamiques', null],
    ]));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /insertion/audit — blocs conventionnels PR 2
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /insertion/audit — blocs conventionnel/typologies/contrôle (PR 2 — EXG-10/24)', () => {
  it('expose conventionnel (cibles nullables + taux + écarts null), etp contrôle, pmsmp/satisfaction, cvg placeholder', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await get('/api/insertion/audit?year=2026', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.conventionnel.cibles.cible_taux_dynamiques).toBeNull();
    expect(res.body.conventionnel.taux_realises).toEqual({
      dynamiques: null, emploi_durable: null, emploi_transition: null, sortie_positive: null,
    });
    expect(res.body.conventionnel.ecarts.dynamiques).toBeNull(); // pas de cible → pas d'écart inventé
    expect(res.body.conventionnel.methode).toMatch(/sorties constatées/i); // dénominateur documenté (RES-09)
    expect(res.body.etp_realises_approx.source).toBe('controle_erp');
    expect(res.body.etp_realises_approx.note).toMatch(/ASP/);
    expect(res.body.delai_moyen_diagnostic_jours).toBeNull();
    expect(res.body.pmsmp).toEqual({ nb: 0, jours: 0, nb_salaries: 0 });
    expect(res.body.satisfaction).toEqual({ nb_reponses: 0, moyenne_globale: null });
    expect(res.body.cvg.statut).toBe('trame_en_attente');
  });

  it('typologies NON nominatives : RQTH (avec repli texte paie), ressources, niveaux, TRANCHES d’âge (jamais la date de naissance)', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT e.birth_date, e.disability_status, d.rqth, d.ressources, d.niveau_formation/.test(s)) {
        return Promise.resolve({ rows: [
          { birth_date: '2002-01-01', disability_status: null, rqth: true, ressources: ['RSA', 'APL'], niveau_formation: 'infra3' },
          { birth_date: '1970-06-15', disability_status: 'RQTH renouvelée', rqth: null, ressources: ['RSA'], niveau_formation: null },
        ] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/audit?year=2026', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.typologies.effectif).toBe(2);
    expect(res.body.typologies.rqth).toBe(2);
    expect(res.body.typologies.ressources).toEqual({ RSA: 2, APL: 1 });
    expect(res.body.typologies.niveaux_formation).toEqual({ infra3: 1 });
    const tranches = Object.keys(res.body.typologies.tranches_age);
    expect(tranches.length).toBe(2);
    expect(JSON.stringify(res.body.typologies)).not.toMatch(/2002-01-01|1970-06-15/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Export « tableau des freins » (EXG-25/38/43) + complétude + synthèse comité
// ───────────────────────────────────────────────────────────────────────────
describe('CONTRAT GET /exports/insertion-freins (PR 2 — EXG-25/38/43)', () => {
  const freinsRow = () => ({
    id: 5, last_name: 'X', first_name: 'Y', nationality: 'Française', gender: 'F',
    birth_date: '1990-01-15', city: 'Rouen', qualification: null,
    disability_status: 'RQTH', pass_iae_end: '2027-01-31',
    date_entree_aci: '2025-03-01', heures_semaine: 28,
    rqth: null, niveau_formation: 'niv3', ressources: ['RSA'],
    logement_statut: 'locataire_social', situation_familiale: 'celibataire',
    projet_formation: 'CACES', emploi_vise: 'Agent de tri', emploi_vise_rome: 'K2304',
    frein_mobilite: 2, frein_sante: 3, frein_finances: null, frein_famille: 1,
    frein_linguistique: 2, frein_administratif: null, frein_numerique: 1,
    frein_logement: 4, frein_judiciaire: 5,
    nb_pmsmp: 2, derniere_pmsmp: '2026-05-12',
  });
  const wireFreins = () => {
    const calls = [];
    mockQuery.mockImplementation((sql, params) => {
      calls.push({ sql: String(sql), params });
      if (/premier_cddi/.test(String(sql))) return Promise.resolve({ rows: [freinsRow()] });
      return Promise.resolve({ rows: [] });
    });
    return calls;
  };

  it('MANAGER → 403 (export nominatif réservé ADMIN/RH — le router exports autorise MANAGER ailleurs)', async () => {
    expect((await getX('/api/exports/insertion-freins?format=csv', 'MANAGER')).status).toBe(403);
    expect((await getX('/api/exports/insertion-freins/completude', 'MANAGER')).status).toBe(403);
  });

  it('CSV (RH) : 23 colonnes dans l’ordre CDC, SANS frein judiciaire par défaut ; génération JOURNALISÉE (rgpd_audit_log)', async () => {
    const calls = wireFreins();
    const res = await getX('/api/exports/insertion-freins?format=csv', 'RH');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.text.replace(/^﻿/, '').trim().split('\n');
    const headers = lines[0].split(';');
    expect(headers).toHaveLength(23);
    expect(headers[0]).toBe('NOM');
    expect(headers[1]).toBe('Prénom');
    expect(headers).not.toContain('Frein judiciaire');
    expect(lines[1]).toContain('X;Y;Française');
    expect(lines[1]).toContain('Oui'); // RQTH depuis le texte paie
    expect(lines[1]).toContain('2 (dern. 2026-05-12)');
    // EXG-43 : journal AVANT l'envoi, format rgpd.js
    const log = calls.find((c) => /INSERT INTO rgpd_audit_log/.test(c.sql));
    expect(log).toBeTruthy();
    expect(log.params[1]).toBe('EXPORT_INSERTION_FREINS');
    expect(log.params[2]).toBe('insertion_freins');
    expect(JSON.parse(log.params[4])).toEqual(expect.objectContaining({ format: 'csv', sensibles: false, lignes: 1 }));
  });

  it('sensibles=1 : colonne « Frein judiciaire » à sa position CDC + action de journal DISTINCTE', async () => {
    const calls = wireFreins();
    const res = await getX('/api/exports/insertion-freins?format=csv&sensibles=1', 'ADMIN');
    expect(res.status).toBe(200);
    const headers = res.text.replace(/^﻿/, '').split('\n')[0].split(';');
    expect(headers).toHaveLength(24);
    expect(headers[headers.indexOf('Frein financier') + 1]).toBe('Frein judiciaire');
    const log = calls.find((c) => /INSERT INTO rgpd_audit_log/.test(c.sql));
    expect(log.params[1]).toBe('EXPORT_INSERTION_FREINS_SENSIBLE');
  });

  it('sensibles=0 : la colonne judiciaire n’est PAS lue en SQL (defense in depth) ; filtres statut/annee/cip paramétrés', async () => {
    const calls = wireFreins();
    const res = await getX('/api/exports/insertion-freins?format=csv&statut=sortis&annee=2026&cip=7', 'RH');
    expect(res.status).toBe(200);
    const main = calls.find((c) => /premier_cddi/.test(c.sql));
    expect(main.sql).not.toContain('frein_judiciaire');
    expect(main.sql).toContain(`insertion_status IN ('termine', 'abandon')`);
    expect(main.params).toEqual([2026, 7]);
  });

  it('statut hors référentiel → 400 (express-validator)', async () => {
    expect((await getX('/api/exports/insertion-freins?statut=partis', 'RH')).status).toBe(400);
  });

  it('complétude (REC-UX-14) : % de renseigné par colonne, sans journalisation (aucune ligne nominative ne sort)', async () => {
    const calls = wireFreins();
    const res = await getX('/api/exports/insertion-freins/completude', 'RH');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.colonnes).toHaveLength(23);
    const byKey = Object.fromEntries(res.body.colonnes.map((c) => [c.cle, c]));
    expect(byKey.nom.pct).toBe(100);
    expect(byKey.frein_finances.pct).toBe(0); // non évalué
    expect(calls.find((c) => /INSERT INTO rgpd_audit_log/.test(c.sql))).toBeUndefined();
  });
});

describe('CONTRAT GET /exports/insertion-synthese (PR 2 — EXG-14)', () => {
  it('JSON (MANAGER autorisé) : mention « non nominatif » + mêmes blocs que /insertion/audit', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await getX('/api/exports/insertion-synthese?year=2026', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.mention).toBe('Document agrégé non nominatif — comité de pilotage');
    expect(res.body.annee).toBe(2026);
    expect(res.body.conventionnel).toBeTruthy();
    expect(res.body.etp_realises_approx.source).toBe('controle_erp');
    expect(JSON.stringify(res.body)).not.toMatch(/first_name|last_name/);
  });

  it('CSV : 1re ligne = la mention, puis Section;Indicateur;Valeur (cibles absentes → « objectif non paramétré »)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await getX('/api/exports/insertion-synthese?year=2026&format=csv', 'RH');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.text.replace(/^﻿/, '').split('\n');
    expect(lines[0]).toBe('Document agrégé non nominatif — comité de pilotage');
    expect(lines[1]).toBe('Section;Indicateur;Valeur');
    expect(res.text).toContain('objectif non paramétré');
    expect(res.text).toContain('saisie officielle : ASP');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOT 8 (2026-07 PR3) — grilles de compétences, période d'essai, checklist
// ═══════════════════════════════════════════════════════════════════════════
const del = (path, role = 'ADMIN') => request(app).delete(path).set('Authorization', `Bearer ${TOKENS[role]}`);

describe('CONTRAT /insertion/competence-referentiels (Lot 8, EXG-26)', () => {
  it('GET accessible au module (MANAGER inclus)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM insertion_competence_referentiels/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 1, filiere: 'tri', rubrique: 'Activités métier', item: 'Tri par catégorie', ordre: 2, actif: true }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/competence-referentiels?filiere=tri&actifs=1', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body[0].item).toBe('Tri par catégorie');
  });

  it('écriture réservée ADMIN : POST MANAGER/RH → 403, ADMIN → 201', async () => {
    expect((await post('/api/insertion/competence-referentiels', 'MANAGER', { filiere: 'tri', rubrique: 'R', item: 'I' })).status).toBe(403);
    expect((await post('/api/insertion/competence-referentiels', 'RH', { filiere: 'tri', rubrique: 'R', item: 'I' })).status).toBe(403);
    mockQuery.mockImplementation((sql, params) => {
      if (/INSERT INTO insertion_competence_referentiels/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 5, filiere: params[0], rubrique: params[1], item: params[2] }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const ok = await post('/api/insertion/competence-referentiels', 'ADMIN', { filiere: 'boutique', rubrique: 'Activités métier', item: 'Tenue de caisse' });
    expect(ok.status).toBe(201);
    expect(ok.body.item).toBe('Tenue de caisse');
  });

  it('filiere hors référentiel → 400 ; doublon → 409', async () => {
    expect((await post('/api/insertion/competence-referentiels', 'ADMIN', { filiere: 'zzz', rubrique: 'R', item: 'I' })).status).toBe(400);
    mockQuery.mockImplementation((sql) => {
      if (/INSERT INTO insertion_competence_referentiels/.test(String(sql))) { const e = new Error('dup'); e.code = '23505'; return Promise.reject(e); }
      return Promise.resolve({ rows: [] });
    });
    const dup = await post('/api/insertion/competence-referentiels', 'ADMIN', { filiere: 'tri', rubrique: 'R', item: 'I' });
    expect(dup.status).toBe(409);
  });

  it('DELETE réservé ADMIN (MANAGER → 403)', async () => {
    expect((await del('/api/insertion/competence-referentiels/1', 'MANAGER')).status).toBe(403);
  });
});

describe('CONTRAT /insertion/competences (Lot 8, EXG-26/27 — accès ETI)', () => {
  it('GET (MANAGER) : évaluations + scores + moyenne (N/E exclu)', async () => {
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (/FROM insertion_competence_evaluations ev/.test(s)) {
        return Promise.resolve({ rows: [{ id: 10, employee_id: 5, filiere: 'tri', periode: '1-6', statut: 'valide' }] });
      }
      if (/FROM insertion_competence_scores s/.test(s)) {
        return Promise.resolve({ rows: [
          { id: 1, evaluation_id: 10, note: 7, non_evalue: false, rubrique: null, ref_rubrique: 'Comportement', item: null, ref_item: 'Assiduité' },
          { id: 2, evaluation_id: 10, note: null, non_evalue: true, rubrique: 'Comportement', item: 'Sécurité' },
          { id: 3, evaluation_id: 10, note: 9, non_evalue: false, rubrique: 'Activités métier', item: 'Tri' },
        ] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/competences/5', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].scores).toHaveLength(3);
    expect(res.body[0].moyenne).toBe(8); // (7+9)/2, N/E exclu
    // snapshot repli sur le référentiel courant quand le snapshot est null
    expect(res.body[0].scores[0].rubrique).toBe('Comportement');
  });

  it('POST par MANAGER (ETI légitime) → 201 : transaction + scores + moyenne', async () => {
    const calls = [];
    mockQuery.mockImplementation((sql, params) => {
      calls.push({ sql: String(sql), params });
      const s = String(sql);
      if (/SELECT id FROM employees WHERE id = \$1/.test(s)) return Promise.resolve({ rows: [{ id: 5 }] });
      if (/COALESCE\(parcours_num, 1\) AS pn FROM employees/.test(s)) return Promise.resolve({ rows: [{ pn: 1 }] });
      if (/INSERT INTO insertion_competence_evaluations/.test(s)) return Promise.resolve({ rows: [{ id: 20, employee_id: 5, parcours_num: 1, statut: 'brouillon' }] });
      if (/SELECT \* FROM insertion_competence_scores WHERE evaluation_id = \$1/.test(s)) {
        return Promise.resolve({ rows: [{ id: 1, note: 6, non_evalue: false }, { id: 2, note: null, non_evalue: true }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/competences', 'MANAGER', {
      employee_id: 5, filiere: 'tri', periode: '1-6',
      scores: [{ referentiel_id: null, rubrique: 'Comportement', item: 'Assiduité', note: 6 }, { rubrique: 'Comportement', item: 'Sécurité', non_evalue: true }],
    });
    expect(res.status).toBe(201);
    expect(calls.some((c) => c.sql === 'BEGIN')).toBe(true);
    expect(calls.some((c) => c.sql === 'COMMIT')).toBe(true);
    expect(calls.some((c) => /INSERT INTO insertion_competence_scores/.test(c.sql))).toBe(true);
    expect(res.body.moyenne).toBe(6); // 1 note évaluée + 1 N/E exclu
  });

  it('POST : note hors bornes (0-10) → 400 + ROLLBACK', async () => {
    const calls = [];
    mockQuery.mockImplementation((sql) => {
      calls.push(String(sql));
      const s = String(sql);
      if (/SELECT id FROM employees WHERE id = \$1/.test(s)) return Promise.resolve({ rows: [{ id: 5 }] });
      if (/COALESCE\(parcours_num, 1\) AS pn FROM employees/.test(s)) return Promise.resolve({ rows: [{ pn: 1 }] });
      if (/INSERT INTO insertion_competence_evaluations/.test(s)) return Promise.resolve({ rows: [{ id: 20 }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/competences', 'MANAGER', { employee_id: 5, scores: [{ note: 11 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/0-10|N\/E/);
    expect(calls).toContain('ROLLBACK');
  });

  it('DELETE réservé ADMIN/RH (MANAGER → 403)', async () => {
    expect((await del('/api/insertion/competences/20', 'MANAGER')).status).toBe(403);
  });
});

describe('CONTRAT POST /insertion/milestones/:id/close — période d\'essai (Lot 8, EXG-30)', () => {
  it('sans décision → 409 { periode_essai_decision_manquante } SANS freins/previous_review/prochain', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FOR UPDATE/.test(String(sql))) {
        return Promise.resolve({ rows: [fullMilestone({
          milestone_type: 'periode_essai', titre: "Entretien de période d'essai",
          periode_essai_decision: null,
          ...Object.fromEntries(FREINS.map((f) => [f.column, null])), // freins non évalués : ignorés pour ce type
        })] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones/10/close', 'RH', {});
    expect(res.status).toBe(409);
    const codes = res.body.problems.map((p) => p.code);
    expect(codes).toContain('periode_essai_decision_manquante');
    expect(codes).not.toContain('freins_non_evalues');
    expect(codes).not.toContain('previous_review_manquante');
    expect(codes).not.toContain('prochain_entretien_manquant');
  });

  it('décision « rompu » → 200 + clôture du parcours en abandon', async () => {
    const calls = [];
    mockQuery.mockImplementation((sql, params) => {
      calls.push({ sql: String(sql), params });
      const s = String(sql);
      if (/FOR UPDATE/.test(s)) {
        return Promise.resolve({ rows: [fullMilestone({ milestone_type: 'periode_essai', periode_essai_decision: 'rompu' })] });
      }
      if (/UPDATE insertion_milestones\s+SET status = 'realise'/.test(s)) {
        return Promise.resolve({ rows: [fullMilestone({ milestone_type: 'periode_essai', periode_essai_decision: 'rompu', status: 'realise', completed_date: params[0], locked_at: '2026-07-23T10:00:00Z' })] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones/10/close', 'RH', { completed_date: '2026-02-01' });
    expect(res.status).toBe(200);
    expect(res.body.milestone.status).toBe('realise');
    expect(res.body.next).toBeNull(); // pas de prochain entretien exigé pour la période d'essai
    const effet = calls.find((c) => /UPDATE employees\s+SET insertion_status = 'abandon'/.test(c.sql));
    expect(effet).toBeTruthy();
  });
});

describe('CONTRAT /insertion/checklist-embauche (Lot 8, EXG-30/PROP-05)', () => {
  it('GET (MANAGER) : items normalisés + steps, même sans ligne en base', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await get('/api/insertion/checklist-embauche/5', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
    expect(res.body.steps).toEqual(expect.arrayContaining(['promesse_embauche', 'contrat_signe', 'mutuelle', 'charte_insertion', 'livret_accueil', 'reglement_interieur', 'formation_poste']));
    expect(res.body.items.contrat_signe).toEqual({ fait: false, date: null, responsable: null });
  });

  it('PUT réservé ADMIN/RH : MANAGER → 403 ; RH → merge + upsert', async () => {
    expect((await put('/api/insertion/checklist-embauche/5', 'MANAGER', { items: { mutuelle: { fait: true } } })).status).toBe(403);
    const calls = [];
    mockQuery.mockImplementation((sql, params) => {
      calls.push({ sql: String(sql), params });
      const s = String(sql);
      if (/SELECT id FROM employees WHERE id = \$1/.test(s)) return Promise.resolve({ rows: [{ id: 5 }] });
      if (/SELECT items FROM insertion_checklist_embauche/.test(s)) return Promise.resolve({ rows: [{ items: { contrat_signe: { fait: true } } }] });
      if (/INSERT INTO insertion_checklist_embauche/.test(s)) return Promise.resolve({ rows: [{ id: 1, employee_id: 5, items: JSON.parse(params[1]) }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await put('/api/insertion/checklist-embauche/5', 'RH', { items: { mutuelle: { fait: true, responsable: 'Assistante' }, inconnu_step: { fait: true } } });
    expect(res.status).toBe(200);
    // merge : le contrat_signe existant est conservé, mutuelle ajoutée, step inconnu ignoré
    const ins = calls.find((c) => /INSERT INTO insertion_checklist_embauche/.test(c.sql));
    const written = JSON.parse(ins.params[1]);
    expect(written.contrat_signe.fait).toBe(true);
    expect(written.mutuelle).toEqual({ fait: true, date: null, responsable: 'Assistante' });
    expect('inconnu_step' in written).toBe(false);
  });
});

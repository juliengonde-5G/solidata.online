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
const tokenFor = (role) => jwt.sign({ id: 1, username: 'u', role, first_name: 'T', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER') };

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
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

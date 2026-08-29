/**
 * Correctifs de l'audit du module PCM (2.43.0) — contrats.
 *
 * Rapport : rapports/pcm-insertion-2026-08-29/01-audit-module-pcm.md
 *
 * Cinq garanties, chacune correspondant à un défaut mesuré par l'audit et
 * corrigé dans ce lot. Elles portent sur des CONTRATS (forme des réponses,
 * écritures produites), pas sur des détails d'implémentation :
 *
 *   D15/R10 — la liste des profils ne diffuse plus l'e-mail des candidats ;
 *   D4/R6   — consulter un rapport de personnalité laisse une trace RGPD ;
 *   D9      — la liste des candidats expose `has_pcm` (le filtre « Avec PCM »
 *             s'appuyait sur deux colonnes qui n'existent pas) ;
 *   D5/R7   — anonymiser un salarié purge enfin son profil PCM ;
 *   §3.3.a  — l'indicateur « risque » PCM ne part plus chez le sous-traitant IA.
 *
 * Les jetons portent le claim `mfa: true` : le routeur PCM est derrière la
 * double authentification (chantier 2.43.0), un jeton sans ce claim serait
 * refusé en 403 avant même d'atteindre ce qu'on veut vérifier.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const jeton = (role) => 'Bearer ' + jwt.sign(
  { id: 42, username: 'u', role, token_version: 0, mfa: true }, process.env.JWT_SECRET, { expiresIn: '1h' });

// ══════════════════════════════════════════════════════════════
// (a) + (b) — routeur PCM
// ══════════════════════════════════════════════════════════════
describe('module PCM — surfaces et traçabilité', () => {
  jest.isolateModules(() => {});

  let app; let pool;

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../../src/config/database');
    pool = require('../../src/config/database');
    app = express();
    app.use(express.json());
    app.use('/api/pcm', require('../../src/routes/pcm'));
  });

  afterAll(() => { jest.dontMock('../../src/config/database'); });

  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM users/i.test(s)) return Promise.resolve({ rows: [{ id: 42, is_active: true, token_version: 0 }] });
      if (/FROM custom_roles/i.test(s)) return Promise.resolve({ rows: [] });
      // Liste des profils : on renvoie DÉLIBÉRÉMENT une ligne large (avec un
      // e-mail), pour que le test échoue si la route se remettait à le
      // sélectionner — et non parce que la donnée manquerait au mock.
      if (/FROM pcm_reports pr/i.test(s) && /ORDER BY pr\.created_at DESC$/m.test(s.trim())) {
        return Promise.resolve({ rows: [{
          id: 1, session_id: 3, candidate_id: 7, base_type: 'analyseur',
          phase_type: 'empathique', risk_alert: false, created_at: '2026-08-01T10:00:00Z',
          first_name: 'Amel', last_name: 'ZEROUAL',
        }] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  // ── (a) D15/R10 ────────────────────────────────────────────
  test('GET /profiles ne renvoie JAMAIS l’e-mail des candidats', async () => {
    const r = await request(app).get('/api/pcm/profiles').set('Authorization', jeton('PCM'));
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).not.toHaveProperty('email');
    // L'identité reste : sans elle, le praticien ne saurait pas quel profil ouvrir.
    expect(r.body[0].last_name).toBe('ZEROUAL');
  });

  test('la requête SQL de /profiles ne sélectionne plus c.email', async () => {
    // Le test ci-dessus passerait aussi si le mock omettait simplement la
    // colonne. On vérifie donc la PROJECTION réellement demandée à PostgreSQL :
    // c'est elle qui décide de ce qui quitte la base.
    await request(app).get('/api/pcm/profiles').set('Authorization', jeton('PCM'));
    const sqlProfils = pool.query.mock.calls
      .map((c) => String(c[0]))
      .find((s) => /FROM pcm_reports pr/i.test(s));
    expect(sqlProfils).toBeDefined();
    expect(sqlProfils).not.toMatch(/c\.email/);
  });

  // ── (b) D4/R6 ──────────────────────────────────────────────
  describe('consultation d’un rapport — journal RGPD', () => {
    const rapport = {
      id: 11, session_id: 3, candidate_id: 7, base_type: 'analyseur',
      phase_type: 'empathique', risk_alert: false,
      // Rapport chiffré illisible en test → la route recalcule depuis les
      // réponses ; le chemin de journalisation est le même.
      encrypted_report: 'illisible',
      first_name: 'Amel', last_name: 'ZEROUAL', email: 'a@z.fr',
      created_at: '2026-08-01T10:00:00Z',
    };

    function monterMockRapport() {
      pool.query.mockImplementation((sql) => {
        const s = String(sql);
        if (/FROM users/i.test(s)) return Promise.resolve({ rows: [{ id: 42, is_active: true, token_version: 0 }] });
        if (/FROM custom_roles/i.test(s)) return Promise.resolve({ rows: [] });
        if (/SELECT pr\.\*/i.test(s)) return Promise.resolve({ rows: [rapport] });
        if (/FROM pcm_answers/i.test(s)) {
          // 20 réponses valides → le rapport est reconstructible.
          return Promise.resolve({ rows: Array.from({ length: 20 }, (_, i) => ({
            question_number: i + 1, answer_value: 'analyseur',
          })) });
        }
        if (/INSERT INTO rgpd_audit_log/i.test(s)) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      });
    }

    test('écrit PCM_RAPPORT_CONSULTATION dans rgpd_audit_log', async () => {
      monterMockRapport();
      const r = await request(app).get('/api/pcm/profiles/7').set('Authorization', jeton('RH'));
      expect(r.status).toBe(200);

      const trace = pool.query.mock.calls.find((c) => /INSERT INTO rgpd_audit_log/i.test(String(c[0])));
      expect(trace).toBeDefined();
      const [, params] = trace;
      expect(params[0]).toBe(42);                    // qui a consulté
      expect(params[1]).toBe('PCM_RAPPORT_CONSULTATION');
      expect(params[2]).toBe('pcm_reports');
      expect(params[3]).toBe(7);                     // sur qui
      expect(JSON.parse(params[4])).toMatchObject({ candidate_id: 7, report_id: 11 });
    });

    test('un profil INTROUVABLE n’est pas journalisé comme une consultation', async () => {
      pool.query.mockImplementation((sql) => {
        const s = String(sql);
        if (/FROM users/i.test(s)) return Promise.resolve({ rows: [{ id: 42, is_active: true, token_version: 0 }] });
        if (/FROM custom_roles/i.test(s)) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] }); // aucun rapport
      });
      const r = await request(app).get('/api/pcm/profiles/999').set('Authorization', jeton('RH'));
      expect(r.status).toBe(404);
      expect(pool.query.mock.calls.some((c) => /rgpd_audit_log/i.test(String(c[0])))).toBe(false);
    });

    test('un journal en panne ne prive pas le RH du rapport', async () => {
      // Doctrine du produit (cf. journaliserNoteProfil) : la trace est
      // importante, mais elle n'est pas un droit d'accès. Si son écriture
      // échoue, la lecture aboutit quand même.
      monterMockRapport();
      const avant = pool.query.getMockImplementation();
      pool.query.mockImplementation((sql, params) => {
        if (/INSERT INTO rgpd_audit_log/i.test(String(sql))) return Promise.reject(new Error('journal indisponible'));
        return avant(sql, params);
      });
      const r = await request(app).get('/api/pcm/profiles/7').set('Authorization', jeton('RH'));
      expect(r.status).toBe(200);
      expect(r.body.baseType).toBe('analyseur');
    });
  });
});

// ══════════════════════════════════════════════════════════════
// (c) D9 — has_pcm sur la liste des candidats
// ══════════════════════════════════════════════════════════════
describe('liste des candidats — has_pcm (défaut D9)', () => {
  let app; let pool;

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../../src/config/database');
    pool = require('../../src/config/database');
    app = express();
    app.use(express.json());
    // `authenticate` est monté par le routeur parent en production ; ici on
    // injecte l'utilisateur, seule la PROJECTION SQL nous intéresse.
    app.use('/api/candidates', (req, _res, next) => { req.user = { id: 42, role: 'RH', username: 'u' }; next(); },
      require('../../src/routes/candidates/crud'));
  });

  afterAll(() => { jest.dontMock('../../src/config/database'); });

  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation((sql) => {
      if (/FROM custom_roles/i.test(String(sql))) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [{ id: 7, first_name: 'Amel', last_name: 'ZEROUAL', has_pcm: true }] });
    });
  });

  test('GET /candidates calcule has_pcm depuis pcm_reports et le renvoie', async () => {
    const r = await request(app).get('/api/candidates').set('Authorization', jeton('RH'));
    expect(r.status).toBe(200);
    expect(r.body[0]).toHaveProperty('has_pcm', true);

    const sql = String(pool.query.mock.calls.find((c) => /FROM candidates c/i.test(String(c[0])))[0]);
    expect(sql).toMatch(/EXISTS\(/i);
    expect(sql).toMatch(/pcm_reports/);
    expect(sql).toMatch(/AS has_pcm/);
    // L'existence d'une SESSION ne suffit pas : un test lancé et non terminé
    // n'est pas un profil, alors que l'écran promet « Avec PCM ».
    expect(sql).not.toMatch(/FROM pcm_sessions/);
  });

  test('le kanban aussi — c’est lui qui alimente les cartes et le filtre', async () => {
    const r = await request(app).get('/api/candidates/kanban').set('Authorization', jeton('RH'));
    expect(r.status).toBe(200);
    const sql = String(pool.query.mock.calls.find((c) => /FROM candidates c/i.test(String(c[0])))[0]);
    expect(sql).toMatch(/AS has_pcm/);
  });
});

// ══════════════════════════════════════════════════════════════
// (d) D5/R7 — purge du PCM à l'anonymisation d'un salarié
// ══════════════════════════════════════════════════════════════
describe('anonymisation d’un salarié — purge du profil PCM (défaut D5)', () => {
  const PRESENTES = new Set([
    'employees', 'pcm_sessions', 'pcm_reports', 'insertion_diagnostics',
    'insertion_milestones', 'cip_action_plans',
  ]);

  function clientMock() {
    const calls = [];
    return {
      calls,
      query: async (sql, params) => {
        calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
        if (/information_schema\.tables/i.test(sql)) {
          return { rows: PRESENTES.has(params[0]) ? [{ 1: 1 }] : [] };
        }
        if (/information_schema\.columns/i.test(sql)) {
          // Toutes les colonnes demandées sont réputées présentes.
          return { rows: [{ column_name: 'employee_id' }, { column_name: 'action_label' }, { column_name: 'titre' }] };
        }
        return { rows: [] };
      },
    };
  }

  test('supprime les sessions PCM du candidat lié (cascade réponses + rapports)', async () => {
    jest.resetModules();
    const { anonymizeEmployee } = require('../../src/services/anonymization');
    const client = clientMock();
    await anonymizeEmployee(client, 5);

    const del = client.calls.find((c) => /^DELETE FROM pcm_sessions/i.test(c.sql));
    expect(del).toBeDefined();
    // Le rattachement passe par employees.candidate_id — jamais par un nom.
    expect(del.sql).toMatch(/SELECT candidate_id FROM employees WHERE id = \$1/i);
    expect(del.sql).toMatch(/candidate_id IS NOT NULL/i);
    expect(del.params).toEqual([5]);
  });

  test('supprime aussi les rapports (ils portent leur propre FK candidate_id)', async () => {
    jest.resetModules();
    const { anonymizeEmployee } = require('../../src/services/anonymization');
    const client = clientMock();
    await anonymizeEmployee(client, 5);
    const del = client.calls.find((c) => /^DELETE FROM pcm_reports/i.test(c.sql));
    expect(del).toBeDefined();
    expect(del.params).toEqual([5]);
  });

  test('reste sans effet si les tables PCM n’existent pas (base partielle)', async () => {
    jest.resetModules();
    const { anonymizeEmployee } = require('../../src/services/anonymization');
    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push(String(sql).replace(/\s+/g, ' ').trim());
        if (/information_schema\.tables/i.test(sql)) {
          return { rows: params[0] === 'employees' ? [{ 1: 1 }] : [] };
        }
        if (/information_schema\.columns/i.test(sql)) return { rows: [] };
        return { rows: [] };
      },
    };
    await expect(anonymizeEmployee(client, 5)).resolves.not.toThrow();
    expect(calls.some((s) => /DELETE FROM pcm_sessions/i.test(s))).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════
// (e) §3.3.a — l'indicateur « risque » PCM ne part plus chez Anthropic
// ══════════════════════════════════════════════════════════════
describe('sous-traitance IA — l’indicateur de « risque » PCM n’est plus transmis', () => {
  let mockCreate; let insertionAi;

  beforeAll(() => {
    jest.resetModules();
    mockCreate = jest.fn();
    jest.doMock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
      messages: { create: (...a) => mockCreate(...a) },
    })));
    const mockQuery = jest.fn((sql) => {
      const s = String(sql);
      if (s.includes('LEFT JOIN teams')) {
        return Promise.resolve({ rows: [{
          id: 1, first_name: 'Jean', last_name: 'Dupont', position_name: 'Trieur',
          team_name: 'Atelier Tri', insertion_status: 'en_parcours', birth_date: '1990-01-01',
        }] });
      }
      // Rapport PCM ILLISIBLE → repli honnête sur les types en clair, avec
      // risk_alert à true : c'est le cas où l'ancien code transmettait
      // `alerte_risque: true` au modèle.
      if (s.includes('FROM pcm_reports pr')) {
        return Promise.resolve({ rows: [{
          encrypted_report: 'illisible', base_type: 'analyseur',
          phase_type: 'empathique', risk_alert: true,
        }] });
      }
      return Promise.resolve({ rows: [] });
    });
    jest.doMock('../../src/config/database', () => ({
      query: (...a) => mockQuery(...a),
      connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
    }));
    process.env.ANTHROPIC_API_KEY = 'test-key';
    insertionAi = require('../../src/services/insertion-ai');
  });

  afterAll(() => {
    jest.dontMock('@anthropic-ai/sdk');
    jest.dontMock('../../src/config/database');
  });

  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ synthese: 'ok' }) }],
      stop_reason: 'end_turn', usage: { output_tokens: 5 },
    });
  });

  test('analyseProfilComplet : le bloc pcm ne contient plus alerte_risque', async () => {
    await insertionAi.analyseProfilComplet(1);
    const charge = mockCreate.mock.calls[0][0].messages[0].content;

    // Le contexte PCM part bien (types de base et de phase) …
    expect(charge).toMatch(/"type_base": ?"analyseur"/);
    expect(charge).toMatch(/"type_phase": ?"empathique"/);
    // … mais SANS l'indicateur, qui mesure la cohérence des réponses et non un
    // état de la personne (32 % de déclenchements sur des réponses aléatoires).
    expect(charge).not.toMatch(/alerte_risque/);
    expect(charge).not.toMatch(/riskAlert/);
    expect(charge).not.toMatch(/rpsIndicators/);
  });

  test('preparerEntretien : seul le type de base sert de repère', async () => {
    await insertionAi.preparerEntretien(1, 'bilan_intermediaire');
    const charge = mockCreate.mock.calls[0][0].messages[0].content;
    expect(charge).toMatch(/"pcm_type": ?"analyseur"/);
    expect(charge).not.toMatch(/alerte_risque/);
    expect(charge).not.toMatch(/riskAlert/);
  });
});

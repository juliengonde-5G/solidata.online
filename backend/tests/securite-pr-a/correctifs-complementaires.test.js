// ═══════════════════════════════════════════════════════════════════════════
// REVUE DE SÉCURITÉ PR A — constats qu'AUCUN test ne couvrait.
//
// La revue le disait elle-même (§ 5, « réserve sur la couverture ») : M-02 et
// m-01 étaient établis par lecture de code, faute de base réelle. Les voici
// exercés à travers les VRAIS handlers Express, sur un faux `pg` : ce qui se
// vérifie ici n'est pas le contenu d'une table mais le fait qu'une requête soit
// émise ou non, et qu'un refus tombe AVANT elle.
//
//   M-01  un MANAGER ne peut pas ÉCRIRE le questionnaire FSE+ d'entrée ;
//   M-02  un MANAGER ne peut pas clôturer un BILAN DE SORTIE (il écrirait la
//         pièce sur laquelle l'autorité calcule son délai de saisie), et le
//         409 d'échec n'expose plus le message SQL brut ;
//   m-02  la consultation d'une pièce signée laisse DEUX traces ;
//   m-06  une pièce ne peut pas être rattachée à l'entretien d'un autre ;
//   m-09  `toCsv` refuse un jeu vide au lieu de lever un TypeError.
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
const mockLogActivity = jest.fn();
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: (...a) => mockLogActivity(...a),
}));

const express = require('express');
const request = require('supertest');

let app;
const tokenFor = (role) => jwt.sign(
  { id: 9, username: 'cip.test', role, first_name: 'C', last_name: 'IP', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER') };

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockLogActivity.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockClientQuery.mockResolvedValue({ rows: [] });
});

const put = (p, role, body = {}) => request(app).put(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const post = (p, role, body = {}) => request(app).post(p).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);
const get = (p, role) => request(app).get(p).set('Authorization', `Bearer ${TOKENS[role]}`);

// ───────────────────────────────────────────────────────────────────────────
describe('M-01 — écriture du questionnaire FSE+ d’entrée', () => {
  test('le MANAGER est refusé en 403, et rien n’est écrit', async () => {
    const res = await put('/api/insertion/diagnostic/5', 'MANAGER', {
      fse_entree: { foyer_monoparental: true, commentaire: 'suivi psychologique en cours' },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FSE_ADMIN_RH_STRICT');
    // Refus EXPLICITE et non retrait silencieux : une pièce d'audit qu'on croit
    // enregistrée alors qu'elle ne l'est pas est pire qu'un refus.
    const ecritures = mockQuery.mock.calls
      .map(([s]) => String(s))
      .filter((s) => /INSERT INTO insertion_diagnostics/i.test(s));
    expect(ecritures).toHaveLength(0);
  });

  test('les autres champs du diagnostic restent écrivables par le MANAGER', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/INSERT INTO insertion_diagnostics/i.test(s)) return Promise.resolve({ rows: [{ id: 1, employee_id: 5 }] });
      return Promise.resolve({ rows: [{ parcours_num: 1 }] });
    });
    const res = await put('/api/insertion/diagnostic/5', 'MANAGER', { obs_points_forts: 'ponctuel' });
    expect(res.status).toBe(200);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('M-02 — clôture d’un bilan de sortie', () => {
  const jalon = (type) => ({
    id: 42, employee_id: 5, milestone_type: type, status: 'planifie',
    locked_at: null, parcours_num: 1, sortie_classification: 'emploi_durable',
  });

  test('le MANAGER est refusé (403) : il écrirait la sortie FSE+', async () => {
    mockClientQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT \* FROM insertion_milestones WHERE id = \$1 FOR UPDATE/.test(s)) {
        return Promise.resolve({ rows: [jalon('bilan_sortie')] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones/42/close', 'MANAGER', {});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('BILAN_SORTIE_ADMIN_RH');
    // La transaction est annulée, aucune ligne de sortie n'est écrite.
    const sqls = mockClientQuery.mock.calls.map(([s]) => String(s));
    expect(sqls).toContain('ROLLBACK');
    expect(sqls.some((s) => /insertion_fse_sorties/i.test(s))).toBe(false);
    expect(sqls.some((s) => /UPDATE insertion_milestones\s+SET status = 'realise'/i.test(s))).toBe(false);
  });

  test('les AUTRES entretiens restent clôturables par le MANAGER (il les conduit)', async () => {
    // La garde est posée après lecture du TYPE, et non sur la route : fermer la
    // route entière aurait retiré à l'encadrement technique les bilans
    // intermédiaires et l'entretien de période d'essai, qu'il mène lui-même.
    mockClientQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT \* FROM insertion_milestones WHERE id = \$1 FOR UPDATE/.test(s)) {
        return Promise.resolve({ rows: [{ ...jalon('bilan_intermediaire'), sortie_classification: null }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await post('/api/insertion/milestones/42/close', 'MANAGER', {});
    // Il peut être refusé pour une autre raison métier (freins non évalués,
    // prochain entretien manquant…), mais JAMAIS en 403 sur son habilitation.
    expect(res.status).not.toBe(403);
  });

  test('le 409 d’échec de sortie FSE+ n’expose plus le message SQL brut (m-03)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../src/routes/insertion/routes.js'), 'utf8');
    const bloc = src
      .slice(src.indexOf('FSE_SORTIE_NON_ENREGISTREE') - 400, src.indexOf('FSE_SORTIE_NON_ENREGISTREE') + 400)
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'); // hors commentaires
    expect(bloc).not.toContain('detail: e.message');
    expect(bloc).toContain('erreurs: e.erreurs');
  });

  test('`sortie_fse` est PROJETÉ : le JSONB et son commentaire libre ne partent pas', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../src/routes/insertion/routes.js'), 'utf8');
    expect(src).toContain('sortie_fse: sortieFseProjetee');
    const bloc = src.slice(src.indexOf('const sortieFseProjetee'), src.indexOf('sortie_fse: sortieFseProjetee'));
    expect(bloc).not.toContain('fse_sortie');
    for (const cle of ['id', 'date_sortie', 'situation_sortie', 'source', 'saisie_at']) {
      expect(bloc).toContain(`${cle}:`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('m-02 — la consultation d’une pièce signée laisse DEUX traces', () => {
  test('registre RGPD ET journal d’activité', async () => {
    const PDF = Buffer.from('%PDF-1.4 test');
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM insertion_pieces WHERE id = \$1/.test(s)) {
        return Promise.resolve({ rows: [{ id: 3, employee_id: 5, type: 'entretien_signe', nom_fichier: 'e.pdf', mime: 'application/pdf', contenu: PDF }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/insertion/pieces/fichier/3', 'ADMIN');
    expect(res.status).toBe(200);
    const registre = mockQuery.mock.calls.filter(([s]) => /INSERT INTO rgpd_audit_log/.test(String(s)));
    expect(registre).toHaveLength(1);
    expect(registre[0][1][1]).toBe('INSERTION_PIECE_CONSULTATION');
    // Le second journal : c'est lui qui rend la condition de l'autorité
    // (« consultation journalisée ») indépendante d'une seule écriture.
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(mockLogActivity.mock.calls[0][0]).toMatchObject({ action: 'view', entityType: 'insertion_piece', entityId: 5 });
  });

  test('le registre en échec ne fait PAS disparaître la trace', async () => {
    const PDF = Buffer.from('%PDF-1.4 test');
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/INSERT INTO rgpd_audit_log/.test(s)) return Promise.reject(new Error('journal indisponible'));
      if (/FROM insertion_pieces WHERE id = \$1/.test(s)) {
        return Promise.resolve({ rows: [{ id: 3, employee_id: 5, type: 'entretien_signe', nom_fichier: 'e.pdf', mime: 'application/pdf', contenu: PDF }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const erreur = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('/api/insertion/pieces/fichier/3', 'ADMIN');
    erreur.mockRestore();
    expect(res.status).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('m-06 — rattachement d’une pièce à l’entretien d’un AUTRE salarié', () => {
  test('refusé en 400, sans insertion', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      // L'entretien 77 existe (la FK serait satisfaite) mais appartient à
      // quelqu'un d'autre : la vérification d'appartenance ne renvoie rien.
      if (/SELECT 1 FROM insertion_milestones WHERE id = \$1 AND employee_id = \$2/.test(s)) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app)
      .post('/api/insertion/pieces/5')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`)
      .field('type', 'entretien_signe')
      .field('milestone_id', '77')
      .attach('fichier', Buffer.from('%PDF-1.4 x'), 'e.pdf');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RATTACHEMENT_HORS_SALARIE');
    expect(mockQuery.mock.calls.filter(([s]) => /INSERT INTO insertion_pieces/i.test(String(s)))).toHaveLength(0);
  });

  test('accepté quand l’entretien appartient bien au salarié', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT 1 FROM insertion_milestones WHERE id = \$1 AND employee_id = \$2/.test(s)) {
        return Promise.resolve({ rows: [{ '?column?': 1 }] });
      }
      if (/INSERT INTO insertion_pieces/i.test(s)) return Promise.resolve({ rows: [{ id: 9, type: 'entretien_signe' }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app)
      .post('/api/insertion/pieces/5')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`)
      .field('type', 'entretien_signe')
      .field('milestone_id', '77')
      .attach('fichier', Buffer.from('%PDF-1.4 x'), 'e.pdf');
    expect(res.status).toBe(201);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('m-09 — `toCsv` sur un jeu vide', () => {
  test('la garde est rétablie dans le source (elle ne dépend plus des appelants)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../src/routes/exports.js'), 'utf8');
    const bloc = src.slice(src.indexOf('const toCsv ='), src.indexOf('const toCsv =') + 900);
    expect(bloc).toContain("e.code = 'EXPORT_VIDE'");
    // …et le handler la traduit en 409 motivé, jamais en 500 « TypeError ».
    expect(src).toContain("if (err.code === 'EXPORT_VIDE')");
  });
});

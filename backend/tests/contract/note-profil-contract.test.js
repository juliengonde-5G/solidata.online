// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — NOTE DE PROFIL INITIAL CIP (2.43.0)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la forme de réponse, la matrice d'habilitations et la trace RGPD
// des trois routes livrées :
//   - GET  /insertion/notes-profil/:employeeId        (lecture JOURNALISÉE)
//   - POST /insertion/ia/note-profil/:employeeId      (génération JOURNALISÉE)
//   - POST /insertion/notes-profil/:employeeId/communiquer (IDEMPOTENT)
// Les trois sont ADMIN/RH STRICTEMENT — jamais MANAGER : la note croise le
// rapport PCM (que routes/pcm.js refuse déjà au MANAGER) et le dossier de
// recrutement.
//
// Auth réelle (JWT sans `tv` → pas de contrôle token_version), DB mockée,
// activity-logger mocké, service IA mocké. Le claim `mfa: true` est posé dans
// les jetons pour rester valide si le module est un jour placé derrière
// `requireMfa` (chantier MFA du même lot).
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET; // clé de chiffrement de repli (field-crypto)

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));
const mockAnalyser = jest.fn();
jest.mock('../../src/services/insertion-ai', () => ({
  analyserProfilInitial: (...a) => mockAnalyser(...a),
}));

const express = require('express');
const request = require('supertest');
const { encryptField } = require('../../src/utils/field-crypto');

let app;
const tokenFor = (role) => jwt.sign(
  { id: 9, username: 'u', role, first_name: 'T', last_name: 'U', mfa: true }, JWT_SECRET, { expiresIn: '1h' });
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER') };

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const post = (path, role = 'ADMIN', body = {}) => request(app).post(path).set('Authorization', `Bearer ${TOKENS[role]}`).send(body);

// Contenu type d'une note, tel qu'il est stocké (chiffré) en base.
const CONTENU = {
  synthese: 'Reprend un rythme de travail après une longue interruption.',
  expression_de_la_personne: ['Je ne veux plus travailler de nuit'],
  structure_personnalite: { type_pcm_base: 'Empathique', canaux_communication: 'Relation d\'abord' },
  freins_pressentis: [{ frein: 'mobilite', niveau_suggere: 3, justification: 'Pas de permis', source: 'entretien' }],
  competences_observees: ['Respect des consignes (mise en situation)'],
  points_vigilance_entretien: ['Aborder les horaires'],
  questions_suggerees_diagnostic: ['Comment organisez-vous vos trajets ?'],
  limites: 'Rien sur la situation de logement.',
};
const SOURCES = {
  has_cv: true, has_interview_form: true, has_interview_comment: false,
  has_mise_en_situation: ['craquage'], has_pcm: true,
  manques: ["Commentaire libre de l'entretien de recrutement absent"],
};
const ligneNote = (over = {}) => ({
  id: 42, parcours_num: 1,
  contenu_chiffre: encryptField(JSON.stringify(CONTENU)),
  sources: SOURCES, modele: 'claude-sonnet-5',
  generated_at: '2026-08-29T09:00:00.000Z', generated_by: 9,
  communiquee_cip_at: null, communiquee_cip_by: null,
  generated_by_name: 'T U', communiquee_cip_by_name: null,
  ...over,
});

// Journal RGPD écrit pendant le test courant.
const journal = () => mockQuery.mock.calls
  .filter(([sql]) => String(sql).includes('rgpd_audit_log'))
  .map(([, params]) => ({ user_id: params[0], action: params[1], entity_type: params[2], entity_id: params[3], details: JSON.parse(params[4]) }));

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockAnalyser.mockReset();
});

// ───────────────────────────────────────────────────────────────────────────
describe('GET /insertion/notes-profil/:employeeId', () => {
  it('renvoie { note: null } quand aucune note n\'existe (et ne journalise rien)', async () => {
    const r = await get('/api/insertion/notes-profil/7');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ note: null });
    expect(journal()).toHaveLength(0); // rien de consulté → rien à tracer
  });

  it('déchiffre le contenu, expose les sources et JOURNALISE la lecture', async () => {
    mockQuery.mockImplementation((sql) => (String(sql).includes('insertion_notes_profil n')
      ? Promise.resolve({ rows: [ligneNote()] })
      : Promise.resolve({ rows: [] })));
    const r = await get('/api/insertion/notes-profil/7', 'RH');
    expect(r.status).toBe(200);
    expect(r.body.note.contenu).toEqual(CONTENU);
    expect(r.body.note.contenu_illisible).toBe(false);
    expect(r.body.note.sources).toEqual(SOURCES);
    expect(r.body.note.generated_by_name).toBe('T U');
    // Jamais le chiffré vers le client.
    expect(r.body.note.contenu_chiffre).toBeUndefined();
    const j = journal();
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({
      user_id: 9, action: 'INSERTION_NOTE_PROFIL_LECTURE',
      entity_type: 'insertion_notes_profil', entity_id: 7,
    });
    expect(j[0].details).toMatchObject({ employee_id: 7, note_id: 42, parcours_num: 1 });
  });

  it('NOMME un contenu illisible au lieu d\'afficher une note vide', async () => {
    mockQuery.mockImplementation((sql) => (String(sql).includes('insertion_notes_profil n')
      ? Promise.resolve({ rows: [ligneNote({ contenu_chiffre: 'encv2:charabia-non-dechiffrable' })] })
      : Promise.resolve({ rows: [] })));
    const r = await get('/api/insertion/notes-profil/7');
    expect(r.status).toBe(200);
    expect(r.body.note.contenu).toBeNull();
    expect(r.body.note.contenu_illisible).toBe(true);
  });

  it('dégrade en { note: null } sur une base non migrée (table absente)', async () => {
    mockQuery.mockImplementation(() => Promise.reject(Object.assign(new Error('relation does not exist'), { code: '42P01' })));
    const r = await get('/api/insertion/notes-profil/7');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ note: null });
  });

  it('refuse un MANAGER (403) — la note croise le PCM', async () => {
    const r = await get('/api/insertion/notes-profil/7', 'MANAGER');
    expect(r.status).toBe(403);
  });

  it('refuse un identifiant non numérique (400)', async () => {
    const r = await get('/api/insertion/notes-profil/abc');
    expect(r.status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('POST /insertion/ia/note-profil/:employeeId', () => {
  it('génère, JOURNALISE avant la réponse, et renvoie la note relue', async () => {
    mockAnalyser.mockResolvedValue({
      note: CONTENU, sources: SOURCES, parcours_num: 1, id: 42, generated_at: '2026-08-29T09:00:00.000Z',
    });
    mockQuery.mockImplementation((sql) => (String(sql).includes('insertion_notes_profil n')
      ? Promise.resolve({ rows: [ligneNote()] })
      : Promise.resolve({ rows: [] })));
    const r = await post('/api/insertion/ia/note-profil/7', 'ADMIN');
    expect(r.status).toBe(200);
    expect(mockAnalyser).toHaveBeenCalledWith(7, { generatedBy: 9 });
    expect(r.body.note.contenu).toEqual(CONTENU);
    const actions = journal().map((j) => j.action);
    expect(actions).toContain('INSERTION_NOTE_PROFIL_GENERATION');
    const gen = journal().find((j) => j.action === 'INSERTION_NOTE_PROFIL_GENERATION');
    expect(gen.details).toMatchObject({ employee_id: 7, note_id: 42, parcours_num: 1 });
    expect(gen.details.sources).toEqual(SOURCES);
  });

  it('traduit une clé IA absente en 503 explicite (handleIaError)', async () => {
    mockAnalyser.mockRejectedValue(new Error('ANTHROPIC_API_KEY non configurée'));
    const r = await post('/api/insertion/ia/note-profil/7');
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('donne un indice exploitable sur un modèle indisponible (404 SDK)', async () => {
    mockAnalyser.mockRejectedValue(Object.assign(new Error('model: not_found'), { status: 404 }));
    const r = await post('/api/insertion/ia/note-profil/7');
    expect(r.status).toBe(500);
    expect(r.body.hint).toMatch(/CLAUDE_MODEL/);
  });

  it('refuse un MANAGER (403)', async () => {
    const r = await post('/api/insertion/ia/note-profil/7', 'MANAGER');
    expect(r.status).toBe(403);
    expect(mockAnalyser).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('POST /insertion/notes-profil/:employeeId/communiquer', () => {
  it('enregistre la prise de connaissance et la journalise', async () => {
    mockQuery.mockImplementation((sql) => (String(sql).includes('UPDATE insertion_notes_profil')
      ? Promise.resolve({ rows: [{ id: 42, parcours_num: 1, communiquee_cip_at: '2026-08-29T10:00:00.000Z', communiquee_cip_by: 9 }] })
      : Promise.resolve({ rows: [] })));
    const r = await post('/api/insertion/notes-profil/7/communiquer', 'RH');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ note_id: 42, communiquee_cip_by: 9 });
    expect(journal().map((j) => j.action)).toContain('INSERTION_NOTE_PROFIL_COMMUNIQUEE');
  });

  it('est IDEMPOTENT : la première prise de connaissance fait foi (COALESCE)', async () => {
    let sqlVu = '';
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (s.includes('UPDATE insertion_notes_profil')) {
        sqlVu = s;
        // Le COALESCE renvoie la date d'origine, pas NOW().
        return Promise.resolve({ rows: [{ id: 42, parcours_num: 1, communiquee_cip_at: '2026-08-01T08:00:00.000Z', communiquee_cip_by: 3 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await post('/api/insertion/notes-profil/7/communiquer');
    expect(r.status).toBe(200);
    expect(sqlVu).toMatch(/communiquee_cip_at\s*=\s*COALESCE\(n\.communiquee_cip_at, NOW\(\)\)/);
    expect(sqlVu).toMatch(/communiquee_cip_by\s*=\s*COALESCE\(n\.communiquee_cip_by, \$2\)/);
    expect(r.body.communiquee_cip_at).toBe('2026-08-01T08:00:00.000Z');
    expect(r.body.communiquee_cip_by).toBe(3); // l'auteur d'origine est conservé
  });

  it('renvoie 404 quand aucune note n\'existe pour ce collaborateur', async () => {
    const r = await post('/api/insertion/notes-profil/7/communiquer');
    expect(r.status).toBe(404);
  });

  it('refuse un MANAGER (403)', async () => {
    const r = await post('/api/insertion/notes-profil/7/communiquer', 'MANAGER');
    expect(r.status).toBe(403);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('GET /insertion/parametres — réglage note_profil_auto', () => {
  it('expose note_profil_auto avec son défaut TRUE (analyse systématique)', async () => {
    const r = await get('/api/insertion/parametres');
    expect(r.status).toBe(200);
    expect(r.body.note_profil_auto).toBe(true);
  });
});

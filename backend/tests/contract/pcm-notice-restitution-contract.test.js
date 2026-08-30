/**
 * INFORMATION PRÉALABLE ET RESTITUTION AU CANDIDAT — contrat.
 *
 * Le client a écarté le déplacement de la passation PCM après l'embauche
 * (audit `rapports/pcm-insertion-2026-08-29/01-audit-module-pcm.md`, §6.3 a de
 * la recherche) : le test reste dans le parcours de recrutement. En
 * contrepartie, deux obligations qui reposaient jusqu'ici sur l'usage passent
 * dans le code, et ce fichier les verrouille :
 *
 *   1. INFORMER AVANT (défaut D6). L'écran de passation ne disait ni la
 *      finalité, ni les destinataires, ni la durée, ni les droits. La notice
 *      s'affiche désormais avant la première question, la confirmation est
 *      horodatée sur la session, et le SERVEUR refuse une soumission sans
 *      elle — une obligation d'information que seul le front applique est une
 *      obligation qu'un appel direct contourne.
 *
 *   2. RESTITUER (art. 15 RGPD, défaut D6). La personne ne voyait que son type
 *      de base et repartait sans rien. Elle obtient son résultat par son propre
 *      jeton de passation — et par lui SEUL : un jeton ne peut pas atteindre le
 *      résultat de quelqu'un d'autre.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
jest.mock('../../src/config/database');

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const pool = require('../../src/config/database');
const { encryptReport } = require('../../src/utils/pcm-crypto');

const app = express();
app.use(express.json());
app.use('/api/pcm', require('../../src/routes/pcm'));

const jeton = (role) => 'Bearer ' + jwt.sign(
  { id: 1, username: 'u', role, token_version: 0, mfa: true }, process.env.JWT_SECRET, { expiresIn: '1h' });

const REPONSES = Array.from({ length: 18 }, (_, i) => ({
  question_number: i + 1,
  answer_value: ['analyseur', 'empathique', 'promoteur'][i % 3],
}));

const JETON_AMEL = 'a'.repeat(64);
const JETON_KARIM = 'b'.repeat(64);

/**
 * Deux candidats, deux jetons. Amel a passé son test ; Karim a reçu son lien
 * mais n'a pas répondu. C'est le couple qui permet de prouver qu'un jeton ne
 * traverse pas vers le résultat d'un autre.
 */
const SESSIONS = {
  [JETON_AMEL]: {
    id: 3, candidate_id: 7, status: 'completed', access_token: JETON_AMEL,
    notice_acceptee_at: '2026-08-30T09:00:00.000Z',
    completed_at: '2026-08-30T09:20:00.000Z', created_at: '2026-08-30T08:55:00.000Z',
    first_name: 'Amel',
  },
  [JETON_KARIM]: {
    id: 4, candidate_id: 8, status: 'in_progress', access_token: JETON_KARIM,
    notice_acceptee_at: null,
    completed_at: null, created_at: '2026-08-30T10:00:00.000Z',
    first_name: 'Karim',
  },
};

/** Rapport RÉEL, chiffré comme en base — pas un objet posé à la main. */
const RAPPORT_AMEL = {
  base: { type: 'analyseur' },
  phase: { type: 'promoteur' },
  immeuble: [
    { etage: 1, type: 'analyseur', nom: 'Analyseur', score: 100 },
    { etage: 2, type: 'empathique', nom: 'Empathique', score: 62 },
  ],
  riskAlert: true,
  rpsIndicators: ['Profil de phase Promoteur avec indices de stress élevé (3/3 réponses stress concordantes)'],
  confidence: { base: 34, phase: 20, baseIndetermine: false, phaseIndetermine: false },
  comportementsPrincipaux: {
    sousStress: 'Niveau 3 : Rejet des autres, dépression, sentiment d’incompétence',
    avecManager: { do: ['Donner des informations factuelles'], dont: ['Être flou'] },
  },
};

/** Ce que renvoie le mock quand `journaliserNotice` a été appelé. */
let noticePosee;

beforeEach(() => {
  noticePosee = { ...SESSIONS };
  pool.query.mockReset();
  pool.connect.mockReset();
  pool.connect.mockImplementation(async () => ({
    query: (...a) => pool.query(...a),
    release: () => {},
  }));
  pool.query.mockImplementation((sql, params) => {
    if (/FROM users/i.test(sql)) return Promise.resolve({ rows: [{ id: 1, is_active: true, token_version: 0 }] });
    if (/FROM custom_roles/i.test(sql)) return Promise.resolve({ rows: [] });

    // POST /sessions/:token/notice
    if (/UPDATE pcm_sessions[\s\S]*notice_acceptee_at = COALESCE/i.test(sql)) {
      const s = noticePosee[params[0]];
      if (!s || s.status === 'completed') return Promise.resolve({ rows: [] });
      s.notice_acceptee_at = s.notice_acceptee_at || '2026-08-30T11:00:00.000Z';
      return Promise.resolve({ rows: [{ id: s.id, notice_acceptee_at: s.notice_acceptee_at }] });
    }

    // GET /sessions/:token/restitution — jointure session + dernier rapport
    if (/FROM pcm_sessions ps[\s\S]*JOIN candidates c/i.test(sql) && /pcm_reports/i.test(sql)) {
      const s = noticePosee[params[0]];
      if (!s) return Promise.resolve({ rows: [] });
      const aUnRapport = s.status === 'completed';
      return Promise.resolve({ rows: [{
        session_id: s.id, candidate_id: s.candidate_id, completed_at: s.completed_at,
        base_type: aUnRapport ? 'analyseur' : null,
        phase_type: aUnRapport ? 'promoteur' : null,
        encrypted_report: aUnRapport ? encryptReport(RAPPORT_AMEL) : null,
        created_at: s.completed_at,
        first_name: s.first_name,
      }] });
    }

    if (/FROM pcm_sessions WHERE access_token/i.test(sql)) {
      return Promise.resolve({ rows: noticePosee[params[0]] ? [noticePosee[params[0]]] : [] });
    }
    if (/FROM pcm_sessions WHERE id/i.test(sql)) {
      const s = Object.values(noticePosee).find((x) => x.id === Number(params[0]));
      return Promise.resolve({ rows: s ? [s] : [] });
    }
    return Promise.resolve({ rows: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. INFORMER AVANT
// ═══════════════════════════════════════════════════════════════════════════
describe('notice d’information préalable', () => {
  test('sans confirmation, la soumission est REFUSÉE (409) et rien n’est enregistré', async () => {
    // Karim n'a pas confirmé : ses réponses ne doivent pas entrer en base.
    const r = await request(app).post('/api/pcm/submit')
      .send({ access_token: JETON_KARIM, answers: REPONSES });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PCM_NOTICE_NON_CONFIRMEE');
    const sqls = pool.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /INSERT INTO pcm_answers/i.test(s))).toBe(false);
    expect(sqls.some((s) => /INSERT INTO pcm_reports/i.test(s))).toBe(false);
  });

  test('la garde vaut AUSSI pour un agent authentifié (la règle porte sur la passation)', async () => {
    // Sinon la notice serait contournable par le chemin interne : c'est la
    // personne qui doit avoir été informée, pas celui qui clique sur Envoyer.
    for (const role of ['ADMIN', 'RH', 'PCM']) {
      const r = await request(app).post('/api/pcm/submit')
        .set('Authorization', jeton(role)).send({ session_id: 4, answers: REPONSES });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('PCM_NOTICE_NON_CONFIRMEE');
    }
  });

  test('la confirmation écrit une trace HORODATÉE sur la session, puis le test peut commencer', async () => {
    const c = await request(app).post(`/api/pcm/sessions/${JETON_KARIM}/notice`).send({});
    expect(c.status).toBe(200);
    expect(c.body.notice_acceptee_at).toBeTruthy();
    // La trace est bien écrite PAR le serveur, sur la session désignée par le
    // jeton (et pas par un identifiant venu de la requête).
    const upd = pool.query.mock.calls.find(([sql]) => /UPDATE pcm_sessions/i.test(String(sql)));
    expect(String(upd[0])).toMatch(/notice_acceptee_at = COALESCE\(notice_acceptee_at, NOW\(\)\)/);
    expect(String(upd[0])).toMatch(/WHERE access_token = \$1/);
    expect(upd[1]).toEqual([JETON_KARIM]);

    const r = await request(app).post('/api/pcm/submit')
      .send({ access_token: JETON_KARIM, answers: REPONSES });
    expect(r.status).toBe(200);
  });

  test('confirmer deux fois ne réécrit pas la date (COALESCE) — la première fait foi', async () => {
    await request(app).post(`/api/pcm/sessions/${JETON_KARIM}/notice`).send({});
    const premiere = noticePosee[JETON_KARIM].notice_acceptee_at;
    const seconde = await request(app).post(`/api/pcm/sessions/${JETON_KARIM}/notice`).send({});
    expect(seconde.body.notice_acceptee_at).toBe(premiere);
  });

  test('un jeton inconnu ne renseigne rien (404, comme une session terminée)', async () => {
    const r = await request(app).post('/api/pcm/sessions/' + 'c'.repeat(64) + '/notice').send({});
    expect(r.status).toBe(404);
    const dejaFait = await request(app).post(`/api/pcm/sessions/${JETON_AMEL}/notice`).send({});
    expect(dejaFait.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. RESTITUER
// ═══════════════════════════════════════════════════════════════════════════
describe('restitution du résultat au candidat', () => {
  test('avec SON jeton, la personne obtient SON résultat', async () => {
    const r = await request(app).get(`/api/pcm/sessions/${JETON_AMEL}/restitution`);
    expect(r.status).toBe(200);
    expect(r.body.prenom).toBe('Amel');
    expect(r.body.base.nom).toBe('Analyseur');
    expect(r.body.base.canal).toBeTruthy();
    expect(r.body.base.points_forts.length).toBeGreaterThan(0);
    expect(r.body.immeuble).toHaveLength(2);
  });

  test('le jeton d’un AUTRE candidat ne donne jamais ce résultat', async () => {
    // Le jeton est la seule pièce d'identité : la session est retrouvée PAR lui,
    // jamais par un identifiant de candidat qui viendrait de la requête.
    const r = await request(app).get(`/api/pcm/sessions/${JETON_KARIM}/restitution`);
    expect(r.status).toBe(409);          // Karim n'a pas de résultat…
    expect(r.body.code).toBe('PCM_SANS_RESULTAT');
    expect(JSON.stringify(r.body)).not.toMatch(/Amel|Analyseur/); // …et surtout pas celui d'Amel
  });

  test('un jeton inconnu est refusé', async () => {
    const r = await request(app).get('/api/pcm/sessions/' + 'd'.repeat(64) + '/restitution');
    expect(r.status).toBe(404);
  });

  test('AUCUN indicateur de cohérence des réponses, ni vocabulaire clinique', async () => {
    // Le cœur du sujet : le rapport chiffré CONTIENT l'indicateur (riskAlert,
    // rpsIndicators) et les paliers de stress rédigés en termes cliniques. Ce
    // qui sort ne doit rien en porter — ni la valeur, ni un dérivé.
    const r = await request(app).get(`/api/pcm/sessions/${JETON_AMEL}/restitution`);
    const brut = JSON.stringify(r.body);
    for (const interdit of ['riskAlert', 'risk_alert', 'rpsIndicators', 'stressNiveaux',
      'masqueStress', 'driverPrincipal', 'guideManager', 'dépression', 'stress']) {
      expect(brut).not.toMatch(new RegExp(interdit, 'i'));
    }
  });

  test('la restitution est journalisée sous son propre code', async () => {
    await request(app).get(`/api/pcm/sessions/${JETON_AMEL}/restitution`);
    const log = pool.query.mock.calls.find(([sql]) => /INSERT INTO rgpd_audit_log/i.test(String(sql)));
    expect(log).toBeDefined();
    expect(log[1][1]).toBe('PCM_RESTITUTION_CANDIDAT'); // et non PCM_RAPPORT_CONSULTATION
    expect(log[1][0]).toBeNull();                       // aucun agent : c'est la personne elle-même
    expect(log[1][3]).toBe(7);                          // rattachée au bon candidat
  });

  test('rapport illisible : le profil est quand même rendu, et l’absence est NOMMÉE', async () => {
    // Les types de base et de phase sont stockés en clair : une clé perdue ne
    // doit pas priver la personne de son résultat. Ce qui manque est dit.
    pool.query.mockImplementation((sql, params) => {
      if (/FROM pcm_sessions ps[\s\S]*JOIN candidates c/i.test(sql) && /pcm_reports/i.test(sql)) {
        return Promise.resolve({ rows: [{
          session_id: 3, candidate_id: 7, completed_at: '2026-08-30T09:20:00.000Z',
          base_type: 'analyseur', phase_type: 'promoteur',
          encrypted_report: 'illisible-clé-perdue', created_at: '2026-08-30T09:20:00.000Z',
          first_name: 'Amel',
        }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await request(app).get(`/api/pcm/sessions/${JETON_AMEL}/restitution`);
    expect(r.status).toBe(200);
    expect(r.body.base.nom).toBe('Analyseur');
    expect(r.body.immeuble).toBeNull();
    expect(r.body.note_immeuble).toMatch(/n’est plus disponible|n'est plus disponible/);
  });
});

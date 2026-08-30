/**
 * Rôle intégré « Praticien PCM » — contrat d'habilitation.
 *
 * Ce rôle FAIT PASSER les tests de personnalité, SANS accéder au dossier de
 * recrutement (CV, entretiens), au reste des RH — ni, depuis l'arbitrage client
 * de la 2.43.0, AUX RÉSULTATS eux-mêmes. Il désigne la personne, crée la
 * session, transmet le lien et suit l'avancement ; le profil se lit dans la
 * fiche de la personne, par ADMIN/RH.
 *
 * Les frontières ci-dessous sont la raison d'être du rôle : si l'une cède,
 * le rôle ne protège plus rien.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
jest.mock('../../src/config/database');

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const pool = require('../../src/config/database');

const app = express();
app.use(express.json());
app.use('/api/pcm', require('../../src/routes/pcm'));

const jeton = (role) => 'Bearer ' + jwt.sign(
  { id: 1, username: 'u', role, token_version: 0, mfa: true, mfa_at: Math.floor(Date.now() / 1000) }, process.env.JWT_SECRET, { expiresIn: '1h' });

/** 18 réponses valides — le minimum exigé par POST /submit. */
const REPONSES = Array.from({ length: 18 }, (_, i) => ({
  question_number: i + 1,
  answer_value: ['analyseur', 'empathique', 'promoteur'][i % 3],
}));

beforeEach(() => {
  pool.query.mockReset();
  pool.connect.mockReset();
  // Transaction de POST /submit : le client rejoue le même mock de requêtes.
  pool.connect.mockImplementation(async () => ({
    query: (...a) => pool.query(...a),
    release: () => {},
  }));
  pool.query.mockImplementation((sql) => {
    if (/FROM users/i.test(sql)) return Promise.resolve({ rows: [{ id: 1, is_active: true, token_version: 0 }] });
    if (/FROM custom_roles/i.test(sql)) return Promise.resolve({ rows: [] });
    // Les deux routes de résultats interrogent `pcm_reports pr` — le LEFT JOIN
    // de /candidats, lui, alias la table en `r` : les deux ne se confondent pas.
    // Aucune ligne renvoyée : la liste répond 200 (vide), le détail 404. Dans
    // les deux cas, un 403 attendu ailleurs reste discernable.
    if (/FROM pcm_reports pr/i.test(sql)) return Promise.resolve({ rows: [] });
    if (/FROM pcm_sessions ps/i.test(sql)) return Promise.resolve({ rows: [] });
    // `notice_acceptee_at` : depuis la 2.45.0, POST /submit refuse (409) une
    // session dont la notice d'information n'a pas été confirmée. Une session
    // de test qui n'a pas franchi cette étape n'existe pas dans le produit ; la
    // renseigner ici garde ce contrat-ci sur SON sujet — les habilitations du
    // praticien. La garde elle-même est vérifiée par
    // tests/contract/pcm-notice-restitution-contract.test.js.
    if (/FROM pcm_sessions WHERE id/i.test(sql)) {
      return Promise.resolve({ rows: [{ id: 3, candidate_id: 7, status: 'in_progress', notice_acceptee_at: '2026-08-30T09:00:00Z' }] });
    }
    if (/FROM pcm_sessions WHERE access_token/i.test(sql)) {
      return Promise.resolve({ rows: [{ id: 3, candidate_id: 7, status: 'in_progress', notice_acceptee_at: '2026-08-30T09:00:00Z' }] });
    }
    if (/FROM candidates/i.test(sql)) {
      return Promise.resolve({ rows: [{
        id: 7, first_name: 'Amel', last_name: 'ZEROUAL', status: 'interview',
        poste_vise: 'Agent de tri Cddi', session_id: null, session_status: null,
        access_token: null, session_created_at: null, a_un_profil: false,
      }] });
    }
    if (/INSERT INTO pcm_sessions/i.test(sql)) {
      return Promise.resolve({ rows: [{ id: 3, candidate_id: 7, access_token: 'a'.repeat(64), status: 'pending' }] });
    }
    return Promise.resolve({ rows: [] });
  });
});

describe('ce que le praticien PCM peut faire', () => {
  test('consulter la liste minimale des candidats', async () => {
    const r = await request(app).get('/api/pcm/candidats').set('Authorization', jeton('PCM'));
    expect(r.status).toBe(200);
    expect(r.body[0].last_name).toBe('ZEROUAL');
  });

  test('la projection ne contient NI CV, NI entretien, NI coordonnées', async () => {
    // C'est tout l'intérêt du rôle : désigner un candidat sans ouvrir son dossier.
    const r = await request(app).get('/api/pcm/candidats').set('Authorization', jeton('PCM'));
    for (const interdit of ['cv_raw_text', 'cv_file_path', 'interview_comment',
      'practical_test_comment', 'email', 'phone', 'comment']) {
      expect(r.body[0]).not.toHaveProperty(interdit);
    }
  });

  test('la liste des candidats donne l’ÉTAT du test, jamais son résultat', async () => {
    // Frontière de la demande client : le praticien voit où en est la
    // passation (aucun test / en attente / en cours / profil disponible) et
    // rien de ce que le test a produit. On vérifie la PROJECTION envoyée à
    // PostgreSQL : une assertion sur la seule réponse passerait aussi bien si
    // le mock omettait simplement les colonnes.
    await request(app).get('/api/pcm/candidats').set('Authorization', jeton('PCM'));
    const sql = pool.query.mock.calls.map((c) => String(c[0]))
      .find((s) => /FROM candidates c/i.test(s));
    expect(sql).toBeDefined();
    expect(sql).toMatch(/a_un_profil/);        // avancement : oui
    expect(sql).toMatch(/s\.status AS session_status/);
    expect(sql).not.toMatch(/base_type/);      // résultat : non
    expect(sql).not.toMatch(/phase_type/);
    expect(sql).not.toMatch(/risk_alert/);
    expect(sql).not.toMatch(/encrypted_report/);
  });

  test('lancer un test', async () => {
    const r = await request(app).post('/api/pcm/sessions')
      .set('Authorization', jeton('PCM')).send({ candidate_id: 7, mode: 'autonomous' });
    expect(r.status).toBe(201);
  });

  test('consulter le référentiel des types (aucune donnée personnelle)', async () => {
    expect((await request(app).get('/api/pcm/types').set('Authorization', jeton('PCM'))).status).toBe(200);
    expect((await request(app).get('/api/pcm/questionnaire').set('Authorization', jeton('PCM'))).status).toBe(200);
  });
});

describe('ce que le praticien PCM ne peut PAS faire', () => {
  test('un rôle sans habilitation PCM reste dehors', async () => {
    for (const role of ['COLLABORATEUR', 'RESP_BTQ', 'FINANCE', 'AUTORITE']) {
      const r = await request(app).get('/api/pcm/candidats').set('Authorization', jeton(role));
      expect(r.status).toBe(403);
    }
  });

  test('CONSULTER LES RÉSULTATS — les trois routes lui sont fermées', async () => {
    // Demande client : « retirer au praticien PCM la possibilité de voir les
    // résultats des tests ». Les trois portes d'accès au résultat : la liste
    // des profils, le rapport déchiffré d'une personne, ses réponses brutes.
    for (const chemin of ['/api/pcm/profiles', '/api/pcm/profiles/7', '/api/pcm/profiles/7/answers']) {
      const r = await request(app).get(chemin).set('Authorization', jeton('PCM'));
      expect(r.status).toBe(403);
    }
  });

  test('aucune requête ne part en base sur un refus', async () => {
    // Le 403 doit tomber AVANT la lecture : un refus qui interroge quand même
    // `pcm_reports` laisserait la donnée sortir de la base pour rien, et
    // journaliserait une consultation qui n'a pas eu lieu.
    await request(app).get('/api/pcm/profiles/7').set('Authorization', jeton('PCM'));
    const sqls = pool.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /FROM pcm_reports/i.test(s))).toBe(false);
    expect(sqls.some((s) => /PCM_RAPPORT_CONSULTATION/.test(s))).toBe(false);
  });

  test('soumettre un test ne lui rend pas le profil calculé', async () => {
    // Porte de derrière : /submit reste ouvert au praticien (il fait passer le
    // test), mais sa réponse porterait sinon base, phase, scores et rapport —
    // le correctif sur /profiles serait contournable en une requête.
    const r = await request(app).post('/api/pcm/submit')
      .set('Authorization', jeton('PCM')).send({ session_id: 3, answers: REPONSES });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body).not.toHaveProperty('report');
    expect(r.body).not.toHaveProperty('profile');
    expect(JSON.stringify(r.body)).not.toMatch(/analyseur|empathique|promoteur/i);
    // Les réponses SONT enregistrées : on ne perd pas le test, on tait le résultat.
    expect(pool.query.mock.calls.some((c) => /INSERT INTO pcm_reports/i.test(String(c[0])))).toBe(true);
  });
});

describe('non-régression des rôles existants', () => {
  test('ADMIN et RH conservent l’accès complet au PCM', async () => {
    for (const role of ['ADMIN', 'RH']) {
      expect((await request(app).get('/api/pcm/candidats').set('Authorization', jeton(role))).status).toBe(200);
      // La liste des profils répond 200 (le mock ne renvoie aucune ligne) ; le
      // détail et les réponses répondent 404 faute de données. Aucun 403 :
      // c'est ce qui distingue « pas de donnée » de « pas le droit ».
      expect((await request(app).get('/api/pcm/profiles').set('Authorization', jeton(role))).status).toBe(200);
      expect((await request(app).get('/api/pcm/profiles/7').set('Authorization', jeton(role))).status).toBe(404);
      expect((await request(app).get('/api/pcm/profiles/7/answers').set('Authorization', jeton(role))).status).toBe(404);
    }
  });

  test('la liste des profils ne donne pas non plus les e-mails', async () => {
    // Minimisation posée en 2.43.0 (défaut D15) pour le praticien PCM ; elle
    // tient toujours alors qu'il ne lit plus cette route — une liste de profils
    // de personnalité n'a pas besoin des coordonnées. On vérifie la PROJECTION
    // demandée à PostgreSQL : c'est elle qui décide de ce qui sort de la base.
    await request(app).get('/api/pcm/profiles').set('Authorization', jeton('ADMIN'));
    const sql = pool.query.mock.calls
      .map((c) => String(c[0]))
      .find((s) => /FROM pcm_reports pr/i.test(s));
    expect(sql).toBeDefined();
    expect(sql).not.toMatch(/c\.email/);
    expect(sql).toMatch(/c\.first_name/); // l'identité, elle, reste nécessaire
  });

  test('le candidat, lui, garde sa propre restitution', async () => {
    // Le chemin public par jeton de session est INCHANGÉ : c'est l'écran de
    // passation, la personne reçoit son propre résultat en fin de test.
    const r = await request(app).post('/api/pcm/submit')
      .send({ access_token: 'a'.repeat(64), answers: REPONSES });
    expect(r.status).toBe(200);
    expect(r.body.profile).toBeDefined();
    expect(r.body.profile.baseType).toBeTruthy();
    expect(r.body.report).toBeDefined();
  });

  test('ADMIN qui soumet reçoit toujours le profil', async () => {
    const r = await request(app).post('/api/pcm/submit')
      .set('Authorization', jeton('ADMIN')).send({ session_id: 3, answers: REPONSES });
    expect(r.status).toBe(200);
    expect(r.body.profile?.baseType).toBeTruthy();
  });

  test('MANAGER garde la lecture des types, pas la création de session', async () => {
    expect((await request(app).get('/api/pcm/types').set('Authorization', jeton('MANAGER'))).status).toBe(200);
    const r = await request(app).post('/api/pcm/sessions')
      .set('Authorization', jeton('MANAGER')).send({ candidate_id: 7, mode: 'autonomous' });
    expect(r.status).toBe(403);
  });
});

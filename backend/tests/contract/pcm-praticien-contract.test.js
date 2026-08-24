/**
 * Rôle intégré « Praticien PCM » — contrat d'habilitation.
 *
 * Ce rôle fait passer les tests de personnalité et restitue les profils, SANS
 * accéder au dossier de recrutement (CV, entretiens) ni au reste des RH.
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
  { id: 1, username: 'u', role, token_version: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });

beforeEach(() => {
  pool.query.mockReset();
  pool.query.mockImplementation((sql) => {
    if (/FROM users/i.test(sql)) return Promise.resolve({ rows: [{ id: 1, is_active: true, token_version: 0 }] });
    if (/FROM custom_roles/i.test(sql)) return Promise.resolve({ rows: [] });
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

  test('lancer un test', async () => {
    const r = await request(app).post('/api/pcm/sessions')
      .set('Authorization', jeton('PCM')).send({ candidate_id: 7, mode: 'autonomous' });
    expect(r.status).toBe(201);
  });

  test('lire les profils et les types', async () => {
    expect((await request(app).get('/api/pcm/profiles').set('Authorization', jeton('PCM'))).status).toBe(200);
    expect((await request(app).get('/api/pcm/types').set('Authorization', jeton('PCM'))).status).toBe(200);
  });
});

describe('ce que le praticien PCM ne peut PAS faire', () => {
  test('un rôle sans habilitation PCM reste dehors', async () => {
    for (const role of ['COLLABORATEUR', 'RESP_BTQ', 'FINANCE', 'AUTORITE']) {
      const r = await request(app).get('/api/pcm/candidats').set('Authorization', jeton(role));
      expect(r.status).toBe(403);
    }
  });
});

describe('non-régression des rôles existants', () => {
  test('ADMIN et RH conservent l’accès complet au PCM', async () => {
    for (const role of ['ADMIN', 'RH']) {
      expect((await request(app).get('/api/pcm/candidats').set('Authorization', jeton(role))).status).toBe(200);
      expect((await request(app).get('/api/pcm/profiles').set('Authorization', jeton(role))).status).toBe(200);
    }
  });

  test('MANAGER garde la lecture des types, pas la création de session', async () => {
    expect((await request(app).get('/api/pcm/types').set('Authorization', jeton('MANAGER'))).status).toBe(200);
    const r = await request(app).post('/api/pcm/sessions')
      .set('Authorization', jeton('MANAGER')).send({ candidate_id: 7, mode: 'autonomous' });
    expect(r.status).toBe(403);
  });
});

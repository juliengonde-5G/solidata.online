// Vague 3 — Ouverture en LECTURE (filière boutique) du planning hebdo au rôle
// RESP_BTQ (résiduel vague 2, point 3) pour alimenter la page « Planning
// boutiques ». Les écritures et la recherche d'employés disponibles restent
// réservées ADMIN/MANAGER.
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(),
}));

const express = require('express');
const request = require('supertest');

let app;
const respToken = jwt.sign({ id: 7, username: 'resp1', role: 'RESP_BTQ' }, JWT_SECRET, { expiresIn: '1h' });
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/planning-hebdo', require('../../../src/routes/planning-hebdo'));
});
afterEach(() => { mockQuery.mockReset(); });

describe('GET /api/planning-hebdo/postes', () => {
  it('401 sans authentification', async () => {
    const res = await request(app).get('/api/planning-hebdo/postes');
    expect(res.status).toBe(401);
  });

  it('RESP_BTQ : 200, uniquement les postes filière boutique', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // postes de tri (aucun ici)
    const res = await request(app).get('/api/planning-hebdo/postes')
      .set('Authorization', `Bearer ${respToken}`);
    expect(res.status).toBe(200);
    expect(res.body.postes.length).toBeGreaterThan(0);
    expect(res.body.postes.every(p => p.filiere === 'btq')).toBe(true);
    expect(res.body.filieres).toHaveLength(1);
    expect(res.body.filieres[0].code).toBe('btq');
  });

  it('ADMIN : 200, toutes les filières (non-régression)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/planning-hebdo/postes')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.filieres).toHaveLength(4);
    const filieres = new Set(res.body.postes.map(p => p.filiere));
    expect(filieres.has('collecte')).toBe(true);
    expect(filieres.has('btq')).toBe(true);
  });
});

describe('GET /api/planning-hebdo', () => {
  const scheduleRows = {
    rows: [
      { id: 1, employee_id: 1, date: '2026-07-13', poste_code: 'BTQ_ST_SEVER_VEND', periode: 'matin', first_name: 'Alice', last_name: 'Martin' },
      { id: 2, employee_id: 2, date: '2026-07-13', poste_code: 'COLL_CHAUFF', periode: 'journee', first_name: 'Bob', last_name: 'Durand' },
    ],
  };

  it('RESP_BTQ : n\'expose que les affectations boutique, masque le roster', async () => {
    mockQuery
      .mockResolvedValueOnce(scheduleRows)                                       // affectations
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] })        // employés actifs
      .mockResolvedValueOnce({ rows: [] });                                      // absences
    const res = await request(app).get('/api/planning-hebdo?week_start=2026-07-13')
      .set('Authorization', `Bearer ${respToken}`);
    expect(res.status).toBe(200);
    expect(res.body.affectations).toHaveLength(1);
    expect(res.body.affectations[0].poste_code).toBe('BTQ_ST_SEVER_VEND');
    expect(res.body.employees).toEqual([]);   // roster complet masqué
    expect(res.body.absences).toEqual({});
  });

  it('ADMIN : renvoie tout le planning (non-régression)', async () => {
    mockQuery
      .mockResolvedValueOnce(scheduleRows)
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/planning-hebdo?week_start=2026-07-13')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.affectations).toHaveLength(2); // toutes filières
    expect(res.body.employees).toHaveLength(3);
  });
});

describe('Écritures — RESP_BTQ interdit', () => {
  it('POST /affecter → 403 pour RESP_BTQ', async () => {
    const res = await request(app).post('/api/planning-hebdo/affecter')
      .set('Authorization', `Bearer ${respToken}`)
      .send({ employee_id: 1, date: '2026-07-13' });
    expect(res.status).toBe(403);
  });

  it('DELETE /affecter → 403 pour RESP_BTQ', async () => {
    const res = await request(app).delete('/api/planning-hebdo/affecter')
      .set('Authorization', `Bearer ${respToken}`)
      .send({ employee_id: 1, date: '2026-07-13' });
    expect(res.status).toBe(403);
  });

  it('GET /employes-disponibles → 403 pour RESP_BTQ', async () => {
    const res = await request(app).get('/api/planning-hebdo/employes-disponibles?date=2026-07-13')
      .set('Authorization', `Bearer ${respToken}`);
    expect(res.status).toBe(403);
  });

  it('POST /affecter → autorisé pour MANAGER (pas de 403)', async () => {
    const managerToken = jwt.sign({ id: 2, username: 'mgr', role: 'MANAGER' }, JWT_SECRET, { expiresIn: '1h' });
    // Corps invalide volontairement → on vérifie seulement que l'autorisation
    // passe (statut != 403). La validation renvoie 400.
    const res = await request(app).post('/api/planning-hebdo/affecter')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({});
    expect(res.status).not.toBe(403);
  });
});

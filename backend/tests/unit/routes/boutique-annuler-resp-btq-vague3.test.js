// Vague 3 — RESP_BTQ peut annuler SA commande boutique tant qu'elle est en
// BROUILLON (résiduel vague 2, point 2). Prouve de bout en bout : la route
// autorise RESP_BTQ, le cloisonnement boutique s'applique, et la state machine
// n'ouvre l'annulation qu'au statut brouillon (les statuts avancés restent
// ADMIN/MANAGER).
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
const mockConnect = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: () => mockConnect(),
}));

const express = require('express');
const request = require('supertest');

let app;
const respToken = jwt.sign({ id: 7, username: 'resp1', role: 'RESP_BTQ' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/boutique-commandes', require('../../../src/routes/boutique-commandes'));
});
afterEach(() => { mockQuery.mockReset(); mockConnect.mockReset(); });

describe('PATCH /api/boutique-commandes/:id/annuler (RESP_BTQ)', () => {
  it('ANNULE un brouillon de SA boutique (200)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ boutique_id: 1 }] })  // attachBoutiqueScope : périmètre RESP_BTQ = {1}
      .mockResolvedValueOnce({ rows: [{ boutique_id: 1 }] })  // enforceBoutiqueForEntity : commande dans le périmètre
      .mockResolvedValueOnce({});                             // state_transitions_audit (post-commit, best effort)
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({})                                                            // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 3, statut: 'brouillon', boutique_id: 1, reference: 'BTQ-2026-0003' }] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({})                                                            // UPDATE statut
        .mockResolvedValueOnce({})                                                            // INSERT historique
        .mockResolvedValueOnce({}),                                                           // COMMIT
      release: jest.fn(),
    };
    mockConnect.mockResolvedValueOnce(client);

    const res = await request(app).patch('/api/boutique-commandes/3/annuler')
      .set('Authorization', `Bearer ${respToken}`).send({ commentaire: 'erreur de saisie' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('REFUSE (403) l\'annulation d\'une commande hors de son périmètre boutique', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ boutique_id: 1 }] })  // périmètre RESP_BTQ = {1}
      .mockResolvedValueOnce({ rows: [{ boutique_id: 2 }] }); // commande sur boutique 2 → hors périmètre
    const res = await request(app).patch('/api/boutique-commandes/9/annuler')
      .set('Authorization', `Bearer ${respToken}`).send({});
    expect(res.status).toBe(403);
    expect(mockConnect).not.toHaveBeenCalled(); // pas de transition tentée
  });

  it('REFUSE (400) l\'annulation d\'une commande déjà envoyée (statut avancé)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ boutique_id: 1 }] })  // périmètre
      .mockResolvedValueOnce({ rows: [{ boutique_id: 1 }] }); // commande dans le périmètre
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({})                                                      // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 3, statut: 'envoyee', boutique_id: 1 }] }) // SELECT FOR UPDATE → déjà envoyée
        .mockResolvedValueOnce({}),                                                     // ROLLBACK
      release: jest.fn(),
    };
    mockConnect.mockResolvedValueOnce(client);

    const res = await request(app).patch('/api/boutique-commandes/3/annuler')
      .set('Authorization', `Bearer ${respToken}`).send({});
    expect(res.status).toBe(400);
    // La state machine refuse le rôle RESP_BTQ pour envoyee → annulee.
    expect(res.body.error).toMatch(/Rôle RESP_BTQ non autorisé/i);
  });
});

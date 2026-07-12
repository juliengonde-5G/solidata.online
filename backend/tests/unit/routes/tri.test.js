const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
  connect: async () => ({ query: (...args) => mockClientQuery(...args), release: mockRelease }),
}));

const express = require('express');
const request = require('supertest');

let app;
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' }, JWT_SECRET, { expiresIn: '1h' });
const collabToken = jwt.sign({ id: 2, username: 'u', role: 'COLLABORATEUR', first_name: 'U', last_name: 'S' }, JWT_SECRET, { expiresIn: '1h' });
const autoriteToken = jwt.sign({ id: 3, username: 'a', role: 'AUTORITE', first_name: 'A', last_name: 'U' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/tri', require('../../../src/routes/tri'));
});

afterEach(() => { mockQuery.mockReset(); mockClientQuery.mockReset(); mockRelease.mockReset(); });

describe('GET /api/tri/batches/:id — traçabilité lot → cartons', () => {
  it('401 sans auth', async () => {
    const res = await request(app).get('/api/tri/batches/7');
    expect(res.status).toBe(401);
  });

  it('lecture ouverte à un COLLABORATEUR authentifié (opérateur de poste)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, code: 'LOT-ABC', poids_initial_kg: 300 }] }) // batch
      .mockResolvedValueOnce({ rows: [] }) // executions
      .mockResolvedValueOnce({ rows: [] }); // cartons
    const res = await request(app).get('/api/tri/batches/7').set('Authorization', `Bearer ${collabToken}`);
    expect(res.status).toBe(200);
  });

  it('404 si le lot n’existe pas', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // batch introuvable
    const res = await request(app).get('/api/tri/batches/999').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('renvoie le lot avec ses exécutions ET ses cartons rattachés', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, code: 'LOT-ABC', chaine_nom: 'Chaîne Qualité', poids_initial_kg: 300 }] }) // batch
      .mockResolvedValueOnce({ rows: [{ id: 10, operation_nom: 'Crackage' }] }) // executions
      .mockResolvedValueOnce({ rows: [] }) // outputs de l'exec 10
      .mockResolvedValueOnce({ rows: [ // cartons rattachés (batch_id = 7)
        { id: 1, code_barre: 'P10001', produit: 'Pull', poids_kg: 12, status: 'en_stock', sortie_commande_type: null, date_sortie: null },
        { id: 2, code_barre: 'P10002', produit: 'Jean', poids_kg: 15, status: 'expedie', sortie_commande_type: 'btq', date_sortie: '2026-07-01T09:00:00Z' },
      ] });
    const res = await request(app).get('/api/tri/batches/7').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('LOT-ABC');
    expect(Array.isArray(res.body.cartons)).toBe(true);
    expect(res.body.cartons).toHaveLength(2);
    expect(res.body.cartons[1].sortie_commande_type).toBe('btq');
    expect(res.body.executions[0].outputs).toEqual([]);
  });
});

describe('PUT /api/tri/executions/:id/complete — reversement stock trié (I4)', () => {
  it('404 si l’exécution n’existe pas (ROLLBACK)', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // exec FOR UPDATE → introuvable
      .mockResolvedValueOnce({}); // ROLLBACK
    const res = await request(app).put('/api/tri/executions/9/complete')
      .set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(404);
    expect(mockClientQuery.mock.calls.at(-1)[0]).toMatch(/ROLLBACK/);
  });

  it('409 si l’opération est déjà terminée (idempotence anti double-comptage)', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 9, status: 'termine', batch_id: 3, batch_code: 'LOT-X', poids_entree_kg: 100 }] })
      .mockResolvedValueOnce({}); // ROLLBACK
    const res = await request(app).put('/api/tri/executions/9/complete')
      .set('Authorization', `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(409);
  });

  it('termine l’exécution et crée une entrée de stock par sortie catégorisée', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 9, status: 'en_cours', batch_id: 3, batch_code: 'LOT-X', poids_entree_kg: 100 }] }) // exec
      .mockResolvedValueOnce({ rows: [ // outputs
        { id: 1, poids_kg: 60, categorie_sortante_id: 5 },
        { id: 2, poids_kg: 30, categorie_sortante_id: 8 },
        { id: 3, poids_kg: 5, categorie_sortante_id: null }, // sans catégorie → pas d'entrée stock
      ] })
      .mockResolvedValueOnce({ rows: [{ id: 9, status: 'termine', poids_sortie_total_kg: 90, perte_kg: 10 }] }) // UPDATE exec
      .mockResolvedValueOnce({}) // UPDATE batch
      .mockResolvedValueOnce({}) // INSERT stock (cat 5)
      .mockResolvedValueOnce({}) // INSERT stock (cat 8)
      .mockResolvedValueOnce({}); // COMMIT
    const res = await request(app).put('/api/tri/executions/9/complete')
      .set('Authorization', `Bearer ${adminToken}`).send({ notes: 'ok' });
    expect(res.status).toBe(200);
    expect(res.body.stock_lines_created).toBe(2); // seulement les 2 sorties catégorisées
    // Les INSERT stock ciblent categories_sortantes via matiere_id
    const inserts = mockClientQuery.mock.calls.filter(c => /INSERT INTO stock_movements/.test(c[0]));
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]).toContain(5); // matiere_id = categorie_sortante_id 5
    expect(mockClientQuery.mock.calls.at(-1)[0]).toMatch(/COMMIT/);
  });
});

// ═══ Item 56 — démarrage d'exécution (transactionnel) ═══
describe('POST /api/tri/executions — démarrage transactionnel', () => {
  it('403 pour un rôle sans écriture (AUTORITE lecture seule)', async () => {
    const res = await request(app).post('/api/tri/executions')
      .set('Authorization', `Bearer ${autoriteToken}`).send({ batch_id: 3, operation_id: 1 });
    expect(res.status).toBe(403);
  });

  it('409 si le lot est clôturé (termine) — ROLLBACK', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 3, status: 'termine' }] }) // batch FOR UPDATE
      .mockResolvedValueOnce({}); // ROLLBACK
    const res = await request(app).post('/api/tri/executions')
      .set('Authorization', `Bearer ${adminToken}`).send({ batch_id: 3, operation_id: 1, poids_entree_kg: 100 });
    expect(res.status).toBe(409);
    expect(mockClientQuery.mock.calls.at(-1)[0]).toMatch(/ROLLBACK/);
  });

  it('400 si l’opération n’appartient pas à la chaîne du lot', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 3, status: 'en_cours' }] }) // batch
      .mockResolvedValueOnce({ rows: [] }) // opération non trouvée dans la chaîne
      .mockResolvedValueOnce({}); // ROLLBACK
    const res = await request(app).post('/api/tri/executions')
      .set('Authorization', `Bearer ${adminToken}`).send({ batch_id: 3, operation_id: 99, poids_entree_kg: 100 });
    expect(res.status).toBe(400);
  });

  it('démarre l’exécution et déclenche le lot au 1er lancement (en_attente → en_cours)', async () => {
    mockClientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 3, status: 'en_attente' }] }) // batch
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // opération valide
      .mockResolvedValueOnce({}) // UPDATE batch → en_cours
      .mockResolvedValueOnce({ rows: [{ id: 42, status: 'en_cours', batch_id: 3 }] }) // INSERT exec
      .mockResolvedValueOnce({}); // COMMIT
    const res = await request(app).post('/api/tri/executions')
      .set('Authorization', `Bearer ${adminToken}`).send({ batch_id: 3, operation_id: 1, poids_entree_kg: 250 });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(42);
    const startBatch = mockClientQuery.mock.calls.find(c => /UPDATE batch_tracking SET status = 'en_cours'/.test(c[0]));
    expect(startBatch).toBeTruthy();
    expect(mockClientQuery.mock.calls.at(-1)[0]).toMatch(/COMMIT/);
  });
});

// ═══ Item 56 — saisie des sorties par catégorie ═══
describe('POST /api/tri/executions/:id/outputs — saisie catégorie-driven', () => {
  it('400 si categorie_sortante_id manquant', async () => {
    const res = await request(app).post('/api/tri/executions/9/outputs')
      .set('Authorization', `Bearer ${adminToken}`).send({ poids_kg: 10 });
    expect(res.status).toBe(400);
  });

  it('400 si poids_kg <= 0', async () => {
    const res = await request(app).post('/api/tri/executions/9/outputs')
      .set('Authorization', `Bearer ${adminToken}`).send({ categorie_sortante_id: 5, poids_kg: 0 });
    expect(res.status).toBe(400);
  });

  it('404 si l’exécution n’existe pas', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT status → introuvable
    const res = await request(app).post('/api/tri/executions/9/outputs')
      .set('Authorization', `Bearer ${adminToken}`).send({ categorie_sortante_id: 5, poids_kg: 10 });
    expect(res.status).toBe(404);
  });

  it('409 si l’exécution est déjà terminée (sortie non reversable)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'termine' }] });
    const res = await request(app).post('/api/tri/executions/9/outputs')
      .set('Authorization', `Bearer ${adminToken}`).send({ categorie_sortante_id: 5, poids_kg: 10 });
    expect(res.status).toBe(409);
  });

  it('201 et enregistre categorie_sortante_id + created_by', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ status: 'en_cours' }] }) // SELECT status
      .mockResolvedValueOnce({ rows: [{ id: 77, categorie_sortante_id: 5, poids_kg: 12 }] }); // INSERT
    const res = await request(app).post('/api/tri/executions/9/outputs')
      .set('Authorization', `Bearer ${adminToken}`).send({ categorie_sortante_id: 5, poids_kg: 12 });
    expect(res.status).toBe(201);
    const insert = mockQuery.mock.calls.find(c => /INSERT INTO operation_outputs/.test(c[0]));
    expect(insert[1]).toContain(5); // categorie_sortante_id
    expect(insert[1]).toContain(1); // created_by = req.user.id (admin)
  });
});

// ═══ Item 56 — liste des exécutions du jour ═══
describe('GET /api/tri/executions — liste du jour', () => {
  it('403 pour AUTORITE (donnée opérationnelle, hors périmètre auditeur)', async () => {
    const res = await request(app).get('/api/tri/executions').set('Authorization', `Bearer ${autoriteToken}`);
    expect(res.status).toBe(403);
  });

  it('renvoie la liste avec cumul des sorties', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 9, batch_code: 'LOT-X', operation_nom: 'Crackage 1', status: 'en_cours', poids_sortie_courant: 40, nb_sorties: 2 },
    ] });
    const res = await request(app).get('/api/tri/executions').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].nb_sorties).toBe(2);
  });
});

// ═══ Item 57 — administration du référentiel tri ═══
describe('Item 57 — CRUD référentiel tri', () => {
  it('PUT /chaines/:id : 200 met à jour, 404 si absente', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, nom: 'Qualité', is_active: false }] });
    const ok = await request(app).put('/api/tri/chaines/1')
      .set('Authorization', `Bearer ${adminToken}`).send({ nom: 'Qualité', is_active: false });
    expect(ok.status).toBe(200);
    expect(ok.body.is_active).toBe(false);

    mockQuery.mockResolvedValueOnce({ rows: [] });
    const nf404 = await request(app).put('/api/tri/chaines/999')
      .set('Authorization', `Bearer ${adminToken}`).send({ nom: 'X' });
    expect(nf404.status).toBe(404);
  });

  it('POST /categories-sortantes : 403 pour non-ADMIN', async () => {
    const res = await request(app).post('/api/tri/categories-sortantes')
      .set('Authorization', `Bearer ${collabToken}`)
      .send({ nom: 'Test', famille: 'Recyclage', famille_refashion: 'recyclage' });
    expect(res.status).toBe(403);
  });

  it('POST /categories-sortantes : 400 si famille_refashion hors nomenclature', async () => {
    const res = await request(app).post('/api/tri/categories-sortantes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nom: 'Test', famille: 'X', famille_refashion: 'inconnue' });
    expect(res.status).toBe(400);
  });

  it('POST /categories-sortantes : 201 avec famille_refashion valide', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 20, nom: 'Effilochage Lin', famille_refashion: 'recyclage', ordre: 55 }] });
    const res = await request(app).post('/api/tri/categories-sortantes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nom: 'Effilochage Lin', famille: 'Recyclage', famille_refashion: 'recyclage', ordre: 55 });
    expect(res.status).toBe(201);
    const insert = mockQuery.mock.calls.find(c => /INSERT INTO categories_sortantes/.test(c[0]));
    expect(insert[1]).toEqual(expect.arrayContaining(['recyclage']));
  });

  it('PUT /categories-sortantes/:id : désactivation via is_active (pas de suppression dure)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, nom: 'CSR Textiles', is_active: false }] });
    const res = await request(app).put('/api/tri/categories-sortantes/5')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nom: 'CSR Textiles', famille: 'CSR', famille_refashion: 'csr', is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);
  });

  it('PUT /categories-sortantes/:id : 400 si famille_refashion invalide', async () => {
    const res = await request(app).put('/api/tri/categories-sortantes/5')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nom: 'CSR', famille: 'CSR', famille_refashion: 'nope' });
    expect(res.status).toBe(400);
  });

  it('GET /admin/categories : 403 pour non-ADMIN, renvoie tout (inactives incluses) pour ADMIN', async () => {
    const denied = await request(app).get('/api/tri/admin/categories').set('Authorization', `Bearer ${collabToken}`);
    expect(denied.status).toBe(403);

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, is_active: true }, { id: 2, is_active: false }] });
    const ok = await request(app).get('/api/tri/admin/categories').set('Authorization', `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveLength(2);
  });

  it('PUT /operations/:id : 403 pour AUTORITE (lecture seule)', async () => {
    const res = await request(app).put('/api/tri/operations/1')
      .set('Authorization', `Bearer ${autoriteToken}`).send({ nom: 'X' });
    expect(res.status).toBe(403);
  });
});

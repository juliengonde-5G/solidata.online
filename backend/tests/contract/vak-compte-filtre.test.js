// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — filtre de périmètre par caisse du module VAK (2.21.3)
// ───────────────────────────────────────────────────────────────────────────
// Constat prod : une deuxième caisse SumUp (« Caisse Vintiz », ventes à la
// pièce toute l'année) encaisse sur le même compte marchand → ses tickets
// tombent dans la fenêtre de dates des VAK et polluent les KPI. Décision
// client : filtre par caisse configurable par session (vaks.compte_caisse).
//
// SÉMANTIQUE VERROUILLÉE ICI : chaque agrégat du module VAK (KPI, horaire,
// par jour, segments, paiements, comparaison, annuel, live, listes brutes)
// doit porter le prédicat de périmètre (services/sumup.sqlPerimetreCaisse) —
// « exclut le compte CONNU ET DIFFÉRENT, garde les NULL ». Un refactor qui
// retire le prédicat d'une requête casse ICI un test au lieu de réintroduire
// silencieusement les tickets Vintiz dans les KPI.
//
// Auth réelle (JWT sans `tv` → pas de contrôle token_version), DB mockée.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';

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

let app;
const adminToken = jwt.sign({ id: 1, username: 'admin', role: 'ADMIN', first_name: 'A', last_name: 'D' }, JWT_SECRET, { expiresIn: '1h' });

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/vak', require('../../src/routes/vak'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path) => request(app).get(path).set('Authorization', `Bearer ${adminToken}`);

// Requêtes capturées pendant un appel qui agrègent les tables VAK.
function requetesTablesVak() {
  return mockQuery.mock.calls
    .map((c) => String(c[0]))
    .filter((s) => /vak_tickets|vak_ventes/.test(s));
}

describe('CONTRAT — le prédicat de périmètre par caisse est présent sur tous les agrégats VAK', () => {
  test('GET /api/vak (liste, ca_realise/poids_realise/nb_tickets filtrés)', async () => {
    const res = await get('/api/vak');
    expect(res.status).toBe(200);
    const qs = requetesTablesVak();
    expect(qs.length).toBeGreaterThan(0);
    qs.forEach((s) => expect(s).toContain('compte_caisse'));
    // Liste NOIRE globale (2.46.2) : la caisse Vintiz est exclue de TOUTE
    // VAK, sans saisie. Un agrégat qui perdrait ce fragment la réintroduirait
    // en silence — c'est exactement l'oubli constaté sur la VAK d'août 2026.
    qs.forEach((s) => expect(s).toContain('vak.caisses_exclues'));
  });

  test('GET /api/vak/:id/analytics/kpis — lignes ET tickets filtrés, forme de réponse intacte', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM vak_ventes/.test(s)) {
        return Promise.resolve({ rows: [{ ca_ttc: 20.95, ca_ht: 17.46, tva_collectee: 3.49, nb_lignes: 3, poids_kg: 12.17, ca_textile: 15.86, ca_chaussures: 4.79, ca_sacs: 0.3, nb_sacs: 2, remise_totale: 0 }] });
      }
      if (/FROM vak_tickets/.test(s)) {
        return Promise.resolve({ rows: [{ nb_tickets: 1, panier_moyen: 20.95, total_articles: 3, ca_especes: 0, ca_cb: 20.95, nb_especes: 0, nb_cb: 1 }] });
      }
      return Promise.resolve({ rows: [{ kg_approvisionnes: null }] });
    });
    const res = await get('/api/vak/3/analytics/kpis');
    expect(res.status).toBe(200);
    // Forme consommée par VakPerformance.jsx
    expect(res.body.ca_ttc).toBeCloseTo(20.95, 2);
    expect(res.body.poids_kg).toBeCloseTo(12.17, 3);
    expect(res.body.prix_moyen_kg).toBeCloseTo(20.95 / 12.17, 3);
    expect(res.body.taux_ecoulement).toBeNull();
    const qs = requetesTablesVak();
    expect(qs.length).toBeGreaterThanOrEqual(2); // vak_ventes + vak_tickets
    qs.forEach((s) => expect(s).toContain('compte_caisse'));
    // Liste NOIRE globale (2.46.2) : la caisse Vintiz est exclue de TOUTE
    // VAK, sans saisie. Un agrégat qui perdrait ce fragment la réintroduirait
    // en silence — c'est exactement l'oubli constaté sur la VAK d'août 2026.
    qs.forEach((s) => expect(s).toContain('vak.caisses_exclues'));
  });

  test('GET /api/vak/live/current — compteurs live et ticker filtrés (NULL comptés)', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM vaks v\s+WHERE \$1::DATE BETWEEN/.test(s)) {
        return Promise.resolve({ rows: [{ id: 3, libelle: 'VAK Juillet', compte_caisse: 'Caissier Frip & Co', ca_objectif_ttc: null, poids_objectif_kg: null }] });
      }
      if (/AS ca_jour/.test(s)) {
        return Promise.resolve({ rows: [{ ca_jour: 0, poids_jour: 0, tickets_jour: 0, ca_vak: 0, poids_vak: 0, tickets_vak: 0 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/vak/live/current');
    expect(res.status).toBe(200);
    expect(res.body.current).toBeTruthy();
    expect(res.body.counters).toBeTruthy();
    const qs = requetesTablesVak();
    expect(qs.length).toBeGreaterThanOrEqual(2); // compteurs + dernières ventes
    qs.forEach((s) => expect(s).toContain('compte_caisse'));
    // Liste NOIRE globale (2.46.2) : la caisse Vintiz est exclue de TOUTE
    // VAK, sans saisie. Un agrégat qui perdrait ce fragment la réintroduirait
    // en silence — c'est exactement l'oubli constaté sur la VAK d'août 2026.
    qs.forEach((s) => expect(s).toContain('vak.caisses_exclues'));
  });

  test.each([
    ['/api/vak/3/analytics/hourly'],
    ['/api/vak/3/analytics/segments'],
    ['/api/vak/3/analytics/payments'],
    ['/api/vak/3/analytics/by-day'],
    ['/api/vak/3/analytics/comparison'],
    ['/api/vak/annual/overview?annee=2026'],
    ['/api/vak/annual/hourly-heatmap?annee=2026'],
    ['/api/vak/annual/segments-trend?annee=2026'],
    ['/api/vak/annual/payment-mix?annee=2026'],
    ['/api/vak/3/tickets'],
    ['/api/vak/3/ventes'],
  ])('GET %s — chaque requête vak_tickets/vak_ventes porte le prédicat', async (path) => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      // comparison : la VAK courante doit exister avec ses dates
      if (/WHERE v\.id = \$1 GROUP BY v\.id/.test(s)) {
        return Promise.resolve({ rows: [{ id: 3, libelle: 'VAK', date_debut: new Date('2026-07-10'), date_fin: new Date('2026-07-11'), ca_ttc: 0, poids_kg: 0, nb_tickets: 0, panier_moyen: 0 }] });
      }
      if (/AVG\(per_vak\.ca\)/.test(s)) {
        return Promise.resolve({ rows: [{ avg_ca: 0, avg_poids: 0, avg_tickets: 0, avg_panier: 0 }] });
      }
      // annual/overview : le résumé annuel doit exister (rows[0] déréférencé)
      if (/AS nb_vaks/.test(s)) {
        return Promise.resolve({ rows: [{ nb_vaks: 0, ca_total: 0, poids_total: 0, tickets_total: 0, panier_moyen: 0 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get(path);
    expect(res.status).toBe(200);
    const qs = requetesTablesVak();
    expect(qs.length).toBeGreaterThan(0);
    qs.forEach((s) => expect(s).toContain('compte_caisse'));
    // Liste NOIRE globale (2.46.2) : la caisse Vintiz est exclue de TOUTE
    // VAK, sans saisie. Un agrégat qui perdrait ce fragment la réintroduirait
    // en silence — c'est exactement l'oubli constaté sur la VAK d'août 2026.
    qs.forEach((s) => expect(s).toContain('vak.caisses_exclues'));
  });
});

describe('CONTRAT — compte_caisse configurable par session (VakSessions.jsx)', () => {
  test('POST /api/vak transmet compte_caisse (rogné à 200, vide → NULL)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/INSERT INTO vaks/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 9, compte_caisse: 'Caissier Frip & Co' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).post('/api/vak')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ libelle: 'VAK Août', date_debut: '2026-08-10', date_fin: '2026-08-11', compte_caisse: '  Caissier Frip & Co  ' });
    expect(res.status).toBe(201);
    const insert = mockQuery.mock.calls.find((c) => /INSERT INTO vaks/.test(String(c[0])));
    expect(String(insert[0])).toContain('compte_caisse');
    expect(insert[1]).toContain('Caissier Frip & Co'); // trimé
  });

  test('PUT /api/vak/:id met à jour compte_caisse (chaîne vide → NULL = filtre retiré)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/UPDATE vaks SET/.test(String(sql))) return Promise.resolve({ rows: [{ id: 3, compte_caisse: null }] });
      return Promise.resolve({ rows: [] });
    });
    const res = await request(app).put('/api/vak/3')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ compte_caisse: '' });
    expect(res.status).toBe(200);
    const upd = mockQuery.mock.calls.find((c) => /UPDATE vaks SET/.test(String(c[0])));
    expect(String(upd[0])).toContain('compte_caisse = $8');
    expect(upd[1][7]).toBeNull(); // '' → null (pas de filtre)
  });
});

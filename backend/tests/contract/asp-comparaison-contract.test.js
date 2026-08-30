// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — COMPARAISON SOLIDATA ↔ ASP (routes/effectifs.js)
// ───────────────────────────────────────────────────────────────────────────
// Verrouille la forme de réponse et la matrice d'habilitations des endpoints
// consommés par l'onglet « Comparaison ASP » de la page EffectifsETP :
//   - GET  /asp/comparaison        (tableau mensuel + bloc `couverture`)
//   - GET  /asp/comparaison/:mois  (3 blocs motivés : concordants / asp_seul /
//                                   solidata_seul)
//   - POST /asp/import             (prévisualisation vs écriture, PDF requis)
//   - POST/DELETE /asp/liaison     (correspondance nom d'usage ↔ salarié)
//   - GET  /asp/export             (.xlsx)
// Habilitations : lecture ADMIN/RH/MANAGER, écriture ADMIN/RH.
//
// Auth réelle (JWT), DB mockée — même harnais que effectifs-contract.test.js.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

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
const effectifs = require('../../src/routes/effectifs');

const tokenFor = (role) => jwt.sign(
  { id: 1, username: 'u', role, first_name: 'T', last_name: 'U', mfa: true },
  JWT_SECRET, { expiresIn: '1h' },
);
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'),
  MANAGER: tokenFor('MANAGER'), COLLABORATEUR: tokenFor('COLLABORATEUR'),
};

let app;
beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/effectifs', effectifs);
});
beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockClear();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (url, role = 'ADMIN') => request(app).get(url).set('Authorization', `Bearer ${TOKENS[role]}`);

describe('CONTRAT GET /asp/comparaison', () => {
  it('renvoie 12 mois avec les champs attendus par le tableau de comparaison', async () => {
    const res = await get('/api/effectifs/asp/comparaison?annee=2026');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('annee', 2026);
    expect(res.body).toHaveProperty('convention');
    expect(Array.isArray(res.body.mois)).toBe(true);
    expect(res.body.mois).toHaveLength(12);
    const m = res.body.mois[0];
    for (const champ of ['mois', 'etp_asp', 'heures_asp', 'etp_solidata_previsionnel',
      'etp_solidata_realise', 'ecart_etp', 'ecart_pct', 'nb_salaries_asp',
      'nb_salaries_solidata', 'statut', 'couverture']) {
      expect(m).toHaveProperty(champ);
    }
    // Le bloc `couverture` est ce qui rend l'écart EXPLICABLE d'un coup d'œil
    // (« écart de X ETP dont Y dus à des salariés absents de l'import de paie »).
    for (const champ of ['nb_asp', 'nb_solidata', 'nb_absents_import', 'etp_asp_non_couvert']) {
      expect(m.couverture).toHaveProperty(champ);
    }
  });

  it('sans état ASP : statut « absent » et valeurs null, jamais 0 inventé', async () => {
    const res = await get('/api/effectifs/asp/comparaison?annee=2026');
    const m = res.body.mois.find((x) => x.mois === 1);
    expect(m.statut).toBe('absent');
    expect(m.etp_asp).toBeNull();
    expect(m.ecart_etp).toBeNull();
  });

  it('lecture ouverte ADMIN/RH/MANAGER, fermée aux autres rôles', async () => {
    for (const role of ['ADMIN', 'RH', 'MANAGER']) {
      expect((await get('/api/effectifs/asp/comparaison?annee=2026', role)).status).toBe(200);
    }
    expect((await get('/api/effectifs/asp/comparaison?annee=2026', 'COLLABORATEUR')).status).toBe(403);
  });

  it('année hors bornes → 400', async () => {
    expect((await get('/api/effectifs/asp/comparaison?annee=1990')).status).toBe(400);
  });
});

describe('CONTRAT GET /asp/comparaison/:mois', () => {
  it('renvoie les 3 blocs, vides et non en erreur quand aucun état n\'est importé', async () => {
    const res = await get('/api/effectifs/asp/comparaison/3?annee=2026');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ annee: 2026, mois: 3 });
    expect(Array.isArray(res.body.concordants)).toBe(true);
    expect(Array.isArray(res.body.asp_seul)).toBe(true);
    expect(Array.isArray(res.body.solidata_seul)).toBe(true);
  });

  it('mois invalide → 400', async () => {
    expect((await get('/api/effectifs/asp/comparaison/13?annee=2026')).status).toBe(400);
    expect((await get('/api/effectifs/asp/comparaison/0?annee=2026')).status).toBe(400);
  });
});

describe('CONTRAT POST /asp/import — habilitations et validation', () => {
  const post = (role) => request(app).post('/api/effectifs/asp/import')
    .set('Authorization', `Bearer ${TOKENS[role]}`);

  it('écriture réservée ADMIN/RH (MANAGER refusé en lecture seule)', async () => {
    expect((await post('MANAGER')).status).toBe(403);
    expect((await post('COLLABORATEUR')).status).toBe(403);
  });

  it('sans fichier → 400 explicite (jamais 500)', async () => {
    const res = await post('ADMIN');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('CONTRAT /asp/liaison — correspondance des noms d\'usage', () => {
  it('création réservée ADMIN/RH', async () => {
    const body = { nom_asp: 'GINFRAY VERONIQUE', date_naissance: '1961-01-31', employee_id: 12 };
    const r = await request(app).post('/api/effectifs/asp/liaison')
      .set('Authorization', `Bearer ${TOKENS.MANAGER}`).send(body);
    expect(r.status).toBe(403);
  });

  it('champs manquants → 400', async () => {
    const r = await request(app).post('/api/effectifs/asp/liaison')
      .set('Authorization', `Bearer ${TOKENS.ADMIN}`).send({ nom_asp: 'X' });
    expect(r.status).toBe(400);
  });

  it('suppression réservée ADMIN/RH', async () => {
    const r = await request(app).delete('/api/effectifs/asp/liaison/1')
      .set('Authorization', `Bearer ${TOKENS.MANAGER}`);
    expect(r.status).toBe(403);
  });
});

describe('CONTRAT GET /asp/export', () => {
  it('renvoie un classeur .xlsx pour un rôle en lecture', async () => {
    const res = await get('/api/effectifs/asp/export?annee=2026', 'MANAGER');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toMatch(/spreadsheetml|octet-stream/);
  });
});

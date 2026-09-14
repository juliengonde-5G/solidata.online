// ═══════════════════════════════════════════════════════════════════════════
// TEST DE CONTRAT — CORRECTIF B-02 (PR B)
// ───────────────────────────────────────────────────────────────────────────
// `heuresAccompagnement` (service du temps d'accompagnement, PR B lot 4)
// compose, entre autres :
//
//     par_salarie:     [{ employee_id, nom: 'NOM Prénom', minutes }, …]
//     par_intervenant: [{ user_id,     nom: 'NOM Prénom', minutes }, …]
//
// soit, pour l'année entière, la liste NOMINATIVE de toutes les personnes
// accompagnées avec le volume d'heures consacré à chacune. Le lot 4 le sait et
// réserve cette ventilation : `GET /temps/synthese` porte
// `authorize('ADMIN','RH')` et son propre test de contrat s'intitule
// « MANAGER refusé sur la synthèse (agrégats nominatifs par salarié) ».
//
// L'intégration versait pourtant l'objet COMPLET dans `gatherAuditKpis`, que
// deux surfaces plus larges servent :
//   · `GET /api/insertion/audit`            → ADMIN / RH / **MANAGER** ;
//   · `GET /api/exports/insertion-synthese` → `res.json({ mention, ...k })`,
//     sous la bannière « Document agrégé non nominatif — comité de pilotage ».
//
// C'est le défaut de la PR A (C-01, C-02) au caractère près : la donnée
// protégée sur une route revient par sa voisine. Ce fichier ferme les DEUX
// portes, et il tombe si l'une d'elles se rouvre.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;
process.env.PCM_ENCRYPTION_KEY = process.env.PCM_ENCRYPTION_KEY || 'test-pcm-key-0123456789abcdef';

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

// Le service du temps d'accompagnement est simulé : ce qui est éprouvé ici,
// c'est la PROJECTION de son résultat, pas sa composition (couverte par
// `pr-b-temps-e2e`). Il rend donc délibérément la forme COMPLÈTE, nominative.
const NOMINATIF = {
  annee: 2026,
  global_minutes: 4200,
  par_projet: [{ code: 'ASI', nom: 'Accompagnement social intensif', minutes: 3000, taux_forfaitaire_pct: 40 }],
  par_salarie: [
    { employee_id: 41, nom: 'PREVOST Sandrine', minutes: 2400 },
    { employee_id: 58, nom: 'BENALI Karim', minutes: 1800 },
  ],
  par_intervenant: [{ user_id: 7, nom: 'DURAND Amel', minutes: 4200 }],
  nb_salaries_concernes: 2,
  moyenne_minutes_par_salarie: 2100,
};
jest.mock('../../src/services/temps-accompagnement', () => ({
  heuresAccompagnement: jest.fn(async () => JSON.parse(JSON.stringify(NOMINATIF))),
}));

const express = require('express');
const request = require('supertest');

let app;
const tokenFor = (role) => jwt.sign(
  { id: 9, username: 'u', role, first_name: 'T', last_name: 'U', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' });
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER') };

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
  app.use('/api/exports', require('../../src/routes/exports'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);

/** Les deux patronymes du jeu d'essai — ils ne doivent apparaître NULLE PART. */
const PATRONYMES = /PREVOST|Sandrine|BENALI|Karim|DURAND|Amel/;

describe('B-02 — les indicateurs d’audit ne transportent aucune ventilation nominative', () => {
  test('`gatherAuditKpis` projette : ni `par_salarie`, ni `par_intervenant`', async () => {
    const { gatherAuditKpis } = require('../../src/routes/insertion/routes');
    const k = await gatherAuditKpis(2026);
    expect(k.heures_accompagnement).toBeTruthy();
    expect(k.heures_accompagnement).not.toHaveProperty('par_salarie');
    expect(k.heures_accompagnement).not.toHaveProperty('par_intervenant');
    // …et rien n'est perdu de ce que l'autorité demande (indicateur n° 14).
    expect(k.heures_accompagnement).toEqual({
      annee: 2026,
      global_minutes: 4200,
      par_projet: NOMINATIF.par_projet,
      nb_salaries_concernes: 2,
      moyenne_minutes_par_salarie: 2100,
    });
  });

  test('GET /insertion/audit — aucun patronyme dans la réponse servie au MANAGER', async () => {
    const res = await get('/api/insertion/audit?year=2026', 'MANAGER');
    expect(res.status).toBe(200);
    const brut = JSON.stringify(res.body);
    expect(brut).not.toMatch(/"par_salarie"/);
    expect(brut).not.toMatch(/"par_intervenant"/);
    expect(brut).not.toMatch(PATRONYMES);
  });

  test('GET /insertion/audit — l’ADMIN non plus : la projection est à la SOURCE', async () => {
    // Une projection posée par route se réintroduit à la troisième route. La
    // ventilation nominative n'existe que sur `/temps/synthese`, gardée ADMIN/RH.
    const res = await get('/api/insertion/audit?year=2026', 'ADMIN');
    expect(JSON.stringify(res.body)).not.toMatch(PATRONYMES);
  });

  test('GET /exports/insertion-synthese (JSON) — le document qui s’annonce non nominatif l’est', async () => {
    const res = await get('/api/exports/insertion-synthese?year=2026&format=json', 'MANAGER');
    expect(res.status).toBe(200);
    expect(res.body.mention).toMatch(/non nominatif/i);
    const brut = JSON.stringify(res.body);
    expect(brut).not.toMatch(/"par_salarie"/);
    expect(brut).not.toMatch(/"par_intervenant"/);
    expect(brut).not.toMatch(PATRONYMES);
    // Et l'agrégat utile est bien là : on ferme une fuite, on n'ampute pas le
    // comité de pilotage.
    expect(res.body.heures_accompagnement.global_minutes).toBe(4200);
  });

  test('GET /exports/insertion-synthese (CSV) — aucun patronyme non plus', async () => {
    // PR D : le CSV est désormais la SYNTHÈSE DE DIALOGUE DE GESTION, et elle
    // refuse (409) une période sans aucune donnée. On pose donc une cohorte
    // d'une personne — le point du test reste le même : la ventilation
    // NOMINATIVE des heures d'accompagnement ne doit pas ressortir par le
    // fichier, alors même que le service simulé la rend en entier.
    mockQuery.mockImplementation((sql) => {
      if (/FROM employees e\s+LEFT JOIN insertion_diagnostics d/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: 1, gender: 'F', birth_date: '1985-04-02', brsa: null, ft_categorie: null, referent_unique_type: 'non_determine', niveau_formation: null }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await get('/api/exports/insertion-synthese?year=2026&format=csv', 'MANAGER');
    expect(res.status).toBe(200);
    expect(String(res.text)).not.toMatch(PATRONYMES);
    expect(String(res.text)).not.toMatch(/par_salarie|par_intervenant/);
  });

  test('GET /exports/insertion-synthese (CSV) — période vide → 409, jamais un fichier vide', async () => {
    const res = await get('/api/exports/insertion-synthese?year=2026&format=csv', 'MANAGER');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPORT_VIDE');
  });
});

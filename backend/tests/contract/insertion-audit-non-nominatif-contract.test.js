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
//   · `GET /api/insertion/audit`            → ADMIN / RH / **MANAGER** (rôle
//     retiré sur main le 10/09/2026 — fusion du 25/09/2026 : il est désormais
//     refusé en 403 ; les tests « MANAGER » prouvent ce refus, et la
//     projection par rôle, conservée en garde morte, est éprouvée en unitaire) ;
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

// ═══════════════════════════════════════════════════════════════════════════
// CORRECTIF B-02 (PR D) — LES STATUTS SOCIAUX NE SONT PAS SERVIS AU MANAGER
// ───────────────────────────────────────────────────────────────────────────
// La PR D verse dans `gatherAuditKpis` un bloc `publics_entree` qui porte le
// statut BRSA, la catégorie France Travail, le type de référent unique et les
// critères d'éligibilité IAE — dont « Travailleur handicapé (RQTH) ». Ces
// données sont ADMIN/RH strict (`CLAUDE.md` module 5 ; PR C : « brsa jamais LU
// pour un MANAGER » ; constat bloquant de la PR A sur la liste des critères
// servie à l'encadrant). Elles partaient pourtant vers `/insertion/audit` et
// `/exports/insertion-synthese`, tous deux ouverts au MANAGER, SANS aucune
// suppression : sur une période à UNE personne, l'encadrant lisait `brsa: 1` et
// « RQTH (1) », c'est-à-dire la donnée individuelle elle-même.
//
// La protection dont ces données bénéficiaient n'était pas « pas de clé par
// salarié » — c'était LE RÔLE. Ces tests cherchent les clés dans la RÉPONSE :
// une projection explicite oublie à la colonne suivante, un test qui lit ce qui
// part, non.
// ═══════════════════════════════════════════════════════════════════════════
describe('B-02 (PR D) — statuts sociaux réservés à ADMIN/RH', () => {
  /** Aiguillage minimal : la cohorte porte un BRSA, un RQTH, une catégorie G. */
  const brancherPublics = () => mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (/FROM employee_eligibilite/.test(s)) {
      return Promise.resolve({ rows: [{ code: 'TH', libelle: 'Travailleur handicapé (RQTH)', ordre: 1, n: 1 }] });
    }
    // ⚠ ORDRE : la requête des typologies part elle aussi de `employees LEFT
    // JOIN insertion_diagnostics` — elle doit être reconnue AVANT celle de la
    // cohorte, sinon elle reçoit les lignes de la cohorte et `rqth` vaut 0 sans
    // que rien ne le dise.
    if (/d\.rqth, d\.ressources/.test(s)) {
      return Promise.resolve({ rows: [{ birth_date: '1980-01-01', disability_status: 'RQTH 2024', rqth: true, ressources: ['RSA'], niveau_formation: 'niv3' }] });
    }
    if (/FROM employees e\s+LEFT JOIN insertion_diagnostics d/.test(s) && !/AS entree_frein_/.test(s)) {
      return Promise.resolve({
        rows: [{ id: 1, gender: 'F', birth_date: '1980-01-01', brsa: true, ft_categorie: 'G', referent_unique_type: 'cms', niveau_formation: 'niv3' }],
      });
    }
    return Promise.resolve({ rows: [] });
  });

  test('GET /insertion/audit — un MANAGER (rôle retiré) est refusé en 403 : ni BRSA, ni catégorie FT, ni RQTH', async () => {
    brancherPublics();
    const res = await get('/api/insertion/audit?year=2026', 'MANAGER');
    expect(res.status).toBe(403);
    const brut = JSON.stringify(res.body);
    expect('publics_entree' in res.body).toBe(false);
    expect(brut).not.toMatch(/"brsa"/);
    expect(brut).not.toMatch(/RQTH/);
    expect(res.body.typologies).toBeUndefined();
    // Le refus est posé AVANT la lecture : la requête des critères ne part pas.
    const sqls = mockQuery.mock.calls.map(([x]) => String(x));
    expect(sqls.some((x) => /FROM employee_eligibilite/.test(x))).toBe(false);
    expect(sqls.some((x) => /d\.rqth, d\.ressources/.test(x))).toBe(false);
  });

  test('GET /insertion/audit — un ADMIN, lui, les reçoit (le correctif n’appauvrit pas la CIP)', async () => {
    brancherPublics();
    const res = await get('/api/insertion/audit?year=2026', 'ADMIN');
    expect(res.status).toBe(200);
    expect(res.body.publics_entree).toBeTruthy();
    expect(res.body.publics_entree.brsa.n).toBe(1);
    expect(JSON.stringify(res.body.publics_entree)).toMatch(/RQTH/);
    expect(res.body.typologies.rqth).toBe(1);
  });

  test('GET /exports/insertion-synthese (JSON) — même frontière sur la route voisine (403 au MANAGER)', async () => {
    brancherPublics();
    const res = await get('/api/exports/insertion-synthese?year=2026&format=json', 'MANAGER');
    expect(res.status).toBe(403);
    const brut = JSON.stringify(res.body);
    expect(brut).not.toMatch(/"brsa"/);
    expect(brut).not.toMatch(/RQTH/);
    expect('publics_entree' in res.body).toBe(false);
    const sqls = mockQuery.mock.calls.map(([x]) => String(x));
    expect(sqls.some((x) => /FROM employee_eligibilite/.test(x))).toBe(false);
  });

  // La projection par rôle n'est plus atteignable par HTTP (seuls ADMIN/RH
  // franchissent le routeur), mais elle reste la garde de secours si un rôle
  // non ADMIN/RH revenait un jour sur ces surfaces : on l'éprouve donc
  // directement, pour qu'elle ne pourrisse pas en silence.
  test('garde morte — la projection d’un rôle non ADMIN/RH retire les statuts ET l’annonce', () => {
    const { projeterAuditPourRole } = require('../../src/routes/insertion/routes');
    const k = {
      publics_entree: { brsa: { n: 1 } },
      typologies: { rqth: 1, ressources: { RSA: 1 }, tranches_age: { '40-49': 1 } },
    };
    for (const role of ['MANAGER', 'COLLABORATEUR', 'AUTORITE']) {
      const out = projeterAuditPourRole(k, role);
      expect('publics_entree' in out).toBe(false);
      expect('rqth' in out.typologies).toBe(false);
      expect('ressources' in out.typologies).toBe(false);
      expect(out.typologies.tranches_age).toBeTruthy();
      expect(out.projection_role.note).toMatch(/ADMIN \/ RH/);
    }
    expect(projeterAuditPourRole(k, 'RH')).toBe(k);
  });
});

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

  test('GET /insertion/audit — aucun patronyme dans la réponse servie à la RH', async () => {
    // (Servie au MANAGER jusqu'au retrait du rôle sur main le 10/09/2026 ; il
    // est désormais refusé en 403 — la projection à la source reste éprouvée
    // sur le rôle le plus bas qui atteint encore la route.)
    const res = await get('/api/insertion/audit?year=2026', 'RH');
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
    const res = await get('/api/exports/insertion-synthese?year=2026&format=json', 'RH');
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
    const res = await get('/api/exports/insertion-synthese?year=2026&format=csv', 'RH');
    expect(res.status).toBe(200);
    expect(String(res.text)).not.toMatch(PATRONYMES);
    expect(String(res.text)).not.toMatch(/par_salarie|par_intervenant/);
  });

  test('GET /exports/insertion-synthese (CSV) — période vide → 409, jamais un fichier vide', async () => {
    const res = await get('/api/exports/insertion-synthese?year=2026&format=csv', 'RH');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPORT_VIDE');
  });

  test('GET /exports/insertion-synthese (CSV) — un MANAGER (rôle retiré) est refusé en 403, aucun fichier', async () => {
    const res = await get('/api/exports/insertion-synthese?year=2026&format=csv', 'MANAGER');
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).not.toMatch(/text\/csv/);
  });
});

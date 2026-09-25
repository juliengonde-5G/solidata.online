// ═══════════════════════════════════════════════════════════════════════════
// Lot 2.60.0 — OBLIGATION « situation de sortie Convergence » (10ᵉ famille de
// Mes échéances), SUR POSTGRESQL RÉEL
//
// Les tests unitaires du lot ont injecté des lignes de cohorte toutes faites ;
// ce qui n'y était pas éprouvé : le vrai périmètre de la file active (un
// `make_interval` sur CURRENT_DATE), le seuil STRICT de 30 jours au jour civil
// de Paris, l'appariement par parcours avec la vraie table, le report par la
// route existante, et la dégradation quand la table est illisible.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const {
  RUN, pool, creerComptes, purgerPrE, creerSalarie, signer, jourParisDecale, ins,
} = require('./_helpers');

jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

const app = express();
app.use(express.json());
app.use('/api/insertion', require('../../src/routes/insertion'));

jest.setTimeout(120000);

const PREFIXE = 'jest_prE_ech';
const M = {
  j40: 'PRECVGE_J40', j31: 'PRECVGE_J31', j30: 'PRECVGE_J30', j10: 'PRECVGE_J10',
  saisi: 'PRECVGE_SAISI', autreParcours: 'PRECVGE_P2', enParcours: 'PRECVGE_EN',
};
const MATS = Object.values(M);
let U; const E = {};
const auth = (r, role) => r.set('Authorization', `Bearer ${U[role].token}`);
const cvgDe = (corps, id) => corps.obligations.find((o) => o.employee_id === id && o.type === 'sortie_cvg');

async function sortant(cle, joursDepuisFin, extra = {}) {
  return creerSalarie(pool, M[cle], {
    first_name: 'Ech', last_name: cle, insertion_status: 'termine', is_active: false,
    insertion_start_date: jourParisDecale(-400), insertion_end_date: jourParisDecale(-joursDepuisFin),
    ...extra,
  });
}

(RUN ? describe : describe.skip)('Lot 2.60.0 — obligation sortie_cvg (PostgreSQL réel)', () => {
  beforeAll(async () => {
    await purgerPrE(pool, { matricules: MATS, usernamePrefix: PREFIXE });
    U = await creerComptes(pool, PREFIXE, ['ADMIN', 'RH']);
    U.COLLABORATEUR = { token: signer({ id: 0, username: `${PREFIXE}_col`, role: 'COLLABORATEUR' }) };
    E.j40 = await sortant('j40', 40);
    E.j31 = await sortant('j31', 31);
    E.j30 = await sortant('j30', 30);
    E.j10 = await sortant('j10', 10);
    E.saisi = await sortant('saisi', 45);
    await ins('insertion_sortie_cvg', { employee_id: E.saisi, parcours_num: 1, categorie: 'emploi' });
    // Situation saisie pour le parcours 1, mais la personne en est à son parcours 2 :
    // la saisie ancienne ne couvre PAS la sortie actuelle.
    E.autreParcours = await sortant('autreParcours', 45, { parcours_num: 2 });
    await ins('insertion_sortie_cvg', { employee_id: E.autreParcours, parcours_num: 1, categorie: 'emploi' });
    E.enParcours = await creerSalarie(pool, M.enParcours, {
      first_name: 'Ech', last_name: 'EnParcours', insertion_status: 'en_parcours',
      insertion_start_date: jourParisDecale(-100),
    });
  });

  afterAll(async () => {
    await purgerPrE(pool, { matricules: MATS, usernamePrefix: PREFIXE });
    await pool.end().catch(() => {});
  });

  let corps;
  test('V-80 — sortant depuis 40 j sans situation : obligation ROUGE, échéance = fin + 30 j', async () => {
    const r = await auth(request(app).get('/api/insertion/echeances'), 'ADMIN');
    expect(r.status).toBe(200);
    corps = r.body;
    const o = cvgDe(corps, E.j40);
    expect(o).toEqual(expect.objectContaining({ niveau: 'rouge', jours: 40, echeance: jourParisDecale(-10) }));
    expect(o.libelle).toMatch(/Situation de sortie Convergence à saisir — parcours terminé depuis 40 jour/);
    // Le libellé ne dit RIEN de la santé ni de la catégorie.
    expect(o.libelle).not.toMatch(/RQTH|AAH|pension|médecin|emploi/i);
  });

  test('V-81 — seuil STRICT : 31 j → obligation ; 30 j et 10 j → rien', () => {
    expect(cvgDe(corps, E.j31)).toBeTruthy();
    expect(cvgDe(corps, E.j30)).toBeUndefined();
    expect(cvgDe(corps, E.j10)).toBeUndefined();
  });

  test('V-82 — situation saisie → rien ; saisie d\'un AUTRE parcours → obligation maintenue', () => {
    expect(cvgDe(corps, E.saisi)).toBeUndefined();
    expect(cvgDe(corps, E.autreParcours)).toBeTruthy();
    expect(cvgDe(corps, E.enParcours)).toBeUndefined();
  });

  test('V-83 — RH la reçoit aussi ; COLLABORATEUR refusé 403', async () => {
    const r = await auth(request(app).get('/api/insertion/echeances'), 'RH');
    expect(cvgDe(r.body, E.j40)).toBeTruthy();
    const c = await auth(request(app).get('/api/insertion/echeances'), 'COLLABORATEUR');
    expect(c.status).toBe(403);
  });

  test('V-84 — report par la route existante : sort des obligations, entre dans `reportees`', async () => {
    const avant = corps.compteur_rouges;
    const r = await auth(request(app).post('/api/insertion/echeances/report'), 'RH')
      .send({ employee_id: E.j40, type: 'sortie_cvg' });
    expect(r.status).toBe(201);
    expect(r.body.nb_reports).toBe(1);
    const g = await auth(request(app).get('/api/insertion/echeances'), 'RH');
    expect(cvgDe(g.body, E.j40)).toBeUndefined();
    expect(g.body.reportees.find((o) => o.employee_id === E.j40 && o.type === 'sortie_cvg')).toBeTruthy();
    expect(g.body.compteur_rouges).toBe(avant - 1);
    // Second report sans motif → 409 MOTIF_REQUIS (jamais acquittable).
    const r2 = await auth(request(app).post('/api/insertion/echeances/report'), 'RH')
      .send({ employee_id: E.j40, type: 'sortie_cvg' });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('MOTIF_REQUIS');
  });

  test('V-85 — table illisible : famille NON calculée (aucun sortant réclamé), source nommée', async () => {
    await pool.query('ALTER TABLE insertion_sortie_cvg RENAME TO insertion_sortie_cvg_hors_ligne');
    try {
      const r = await auth(request(app).get('/api/insertion/echeances'), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.obligations.filter((o) => o.type === 'sortie_cvg')).toEqual([]);
      expect(r.body.sources_indisponibles).toContain('sorties_cvg');
    } finally {
      await pool.query('ALTER TABLE insertion_sortie_cvg_hors_ligne RENAME TO insertion_sortie_cvg');
    }
  });
});

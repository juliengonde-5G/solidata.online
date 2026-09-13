// ═══════════════════════════════════════════════════════════════════════════
// REVUE DE SÉCURITÉ PR A — C-01 / C-02 : les statuts sociaux atteignent le
// MANAGER par deux chemins dérivés, alors que la PR les lui interdit.
//
// Ces tests sont des tests de REPRODUCTION : ils sont VERTS tant que le défaut
// est là. Après correctif, les trois `expect` marqués « DÉFAUT » doivent être
// inversés (ils sont écrits pour être lus par le correcteur).
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockClientQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

let app;
const tokenFor = (role) => jwt.sign(
  { id: 9, username: 'encadrant', role, first_name: 'E', last_name: 'T', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = { ADMIN: tokenFor('ADMIN'), MANAGER: tokenFor('MANAGER') };

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
});

const get = (p, role) => request(app).get(p).set('Authorization', `Bearer ${TOKENS[role]}`);

// ───────────────────────────────────────────────────────────────────────────
// C-01 — GET /cadre/:id : `statuts` est bien retiré au MANAGER, mais la LISTE
// DES CRITÈRES D'ÉLIGIBILITÉ lui est servie intégralement. Or elle contient
// `brsa` (le statut social que la clé `statuts` protège), `rqth` et `aah`
// (art. 9) et `sortant_detention` (art. 10).
// ───────────────────────────────────────────────────────────────────────────
describe('C-01 — critères d\'éligibilité servis au MANAGER', () => {
  const EMP = {
    id: 5, pass_iae_number: 'P1', pass_iae_start: null, pass_iae_end: null, pass_iae_statut: 'actif',
    orienteur_type: null, orienteur_nom: null, prescripteur_id: null, date_prescription: null,
    referent_unique_type: 'cms', referent_unique_nom: null, referent_unique_contact: null,
    actualisation_ft_requise: false, actualisation_ft_derniere_date: null, actualisation_ft_rappels_non_honores: 0,
    brsa: true, brsa_date_constat: '2025-07-10', ft_categorie: 'F', ft_categorie_date: null,
    france_travail_id: '7612345A', eligibilite_verifiee_le: null, eligibilite_source: null,
    eligibilite_justificatifs_ref: null, cddi_derogation_motif: null, cddi_derogation_date: null,
    parcours_num: 1, prescripteur_nom: null, prescripteur_type: null,
  };
  const CRITERES = [
    { code: 'brsa', libelle: 'Bénéficiaire du RSA', date_constat: '2025-07-10' },
    { code: 'rqth', libelle: 'Reconnaissance RQTH', date_constat: null },
    { code: 'sortant_detention', libelle: 'Sortant de détention', date_constat: null },
  ];

  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM employees e\s+LEFT JOIN prescripteur_orgas/.test(s)) return Promise.resolve({ rows: [EMP] });
      if (/FROM employee_eligibilite e/.test(s)) return Promise.resolve({ rows: CRITERES });
      return Promise.resolve({ rows: [] });
    });
  });

  test('DÉFAUT — le MANAGER reçoit « Bénéficiaire du RSA », « RQTH » et « Sortant de détention »', async () => {
    const res = await get('/api/insertion/cadre/5', 'MANAGER');
    expect(res.status).toBe(200);
    // La protection annoncée :
    expect(Object.keys(res.body)).not.toContain('statuts');
    // DÉFAUT — la même information passe par la porte d'à côté :
    const codes = res.body.eligibilite.criteres.map((c) => c.code);
    expect(codes).toContain('brsa');
    expect(codes).toContain('rqth');
    expect(codes).toContain('sortant_detention');
    const libelles = JSON.stringify(res.body.eligibilite.criteres);
    expect(libelles).toContain('Bénéficiaire du RSA');
    expect(libelles).toContain('Sortant de détention');
  });

  test('DÉFAUT — cette lecture n\'est pas journalisée (le lot la croit inoffensive)', async () => {
    await get('/api/insertion/cadre/5', 'MANAGER');
    const journaux = mockQuery.mock.calls.filter(([sql]) => /INSERT INTO rgpd_audit_log/.test(String(sql)));
    expect(journaux).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// C-02 — GET /diagnostic/:id : `enrichirFse` relit `employees.brsa` APRÈS le
// masquage et compose `suggestions_fse`, dont la `source` est une phrase en
// clair (« Dossier administratif : bénéficiaire du RSA »).
// ───────────────────────────────────────────────────────────────────────────
describe('C-02 — suggestions FSE+ dérivées de BRSA servies au MANAGER', () => {
  const DIAG = {
    id: 1, employee_id: 5, parcours_num: 1,
    logement_statut: 'heberge', situation_familiale: 'celibataire', enfants_a_charge: true,
    ressources: ['rsa'],
    fse_entree: { commentaire: 'a évoqué un suivi psychologique en cours', sans_domicile_stable: true },
    fse_entree_complet: false, fse_entree_saisie_at: null,
    frein_sante_detail: 'CHIFFRE', frein_judiciaire: 4,
  };

  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/SELECT \* FROM insertion_diagnostics/.test(s)) return Promise.resolve({ rows: [{ ...DIAG }] });
      if (/SELECT brsa, france_travail_id FROM employees/.test(s)) {
        return Promise.resolve({ rows: [{ brsa: true, france_travail_id: '7612345A' }] });
      }
      if (/parcours_num/.test(s)) return Promise.resolve({ rows: [{ parcours_num: 1 }] });
      return Promise.resolve({ rows: [] });
    });
  });

  test('DÉFAUT — « bénéficiaire du RSA » et « identifiant France Travail renseigné » sont servis au MANAGER', async () => {
    const res = await get('/api/insertion/diagnostic/5', 'MANAGER');
    expect(res.status).toBe(200);
    const brut = JSON.stringify(res.body);
    // Le masquage fait son travail sur les champs qu'il connaît :
    expect(Object.keys(res.body)).not.toContain('frein_judiciaire');
    expect(Object.keys(res.body)).not.toContain('frein_sante_detail');
    // DÉFAUT — le statut BRSA arrive quand même, en toutes lettres :
    expect(res.body.suggestions_fse.ressources_principales).toEqual({
      valeur: 'rsa', source: 'Dossier administratif : bénéficiaire du RSA',
    });
    expect(brut).toContain('bénéficiaire du RSA');
    expect(res.body.suggestions_fse.statut_avant_entree.source)
      .toBe('Dossier administratif : identifiant France Travail renseigné');
  });

  test('DÉFAUT — le questionnaire FSE+ (dont son commentaire libre) est servi au MANAGER', async () => {
    const res = await get('/api/insertion/diagnostic/5', 'MANAGER');
    expect(res.body.fse_entree.sans_domicile_stable).toBe(true);
    expect(res.body.fse_entree.commentaire).toContain('suivi psychologique');
  });

  test('référence — l\'ADMIN reçoit la même chose (comportement attendu pour lui)', async () => {
    const res = await get('/api/insertion/diagnostic/5', 'ADMIN');
    expect(res.body.suggestions_fse.ressources_principales.valeur).toBe('rsa');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// C-04 — GET /alertes/:employeeId : l'alerte « référent non déterminé » ÉNONCE
// le statut BRSA en toutes lettres, et la route n'a aucune restriction de rôle
// (elle hérite d'ADMIN/RH/MANAGER). `AlertesBloc` est rendu dans l'en-tête de
// fiche pour tous les rôles.
// ───────────────────────────────────────────────────────────────────────────
describe('C-04 — l\'alerte « référent non déterminé » énonce le statut BRSA', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (/FROM employees e WHERE e\.id = \$1/.test(s)) {
        return Promise.resolve({
          rows: [{
            id: 5, first_name: 'K', last_name: 'B', insertion_status: 'en_parcours',
            insertion_start_date: '2025-07-15', pass_iae_number: 'P1', pass_iae_end: '2027-01-01',
            cddi_derogation_motif: null, contract_end: null,
            brsa: true, referent_unique_type: 'non_determine', parcours_num: 1,
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  test('DÉFAUT — un MANAGER reçoit « alors que la personne est bénéficiaire du RSA »', async () => {
    const res = await get('/api/insertion/alertes/5', 'MANAGER');
    expect(res.status).toBe(200);
    const textes = JSON.stringify(res.body);
    expect(textes).toContain('bénéficiaire du RSA');
    expect((res.body.alertes || res.body).length ?? 0).toBeGreaterThan(0);
  });
});

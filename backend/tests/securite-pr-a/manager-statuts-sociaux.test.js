// ═══════════════════════════════════════════════════════════════════════════
// REVUE DE SÉCURITÉ PR A — C-01 / C-02 / C-03 : les statuts sociaux
// atteignaient le MANAGER par trois chemins dérivés, alors que la PR les lui
// interdit (contrat § 0.6, commentaires de code et registre art. 30).
//
// CES TESTS ONT ÉTÉ RETOURNÉS le 13/09 avec les correctifs. Ils étaient VERTS
// PARCE QUE le défaut était là : ils exigeaient que le MANAGER reçoive « brsa »,
// « Bénéficiaire du RSA » et « Sortant de détention ». Ils exigent maintenant
// l'inverse — c'est la même mise en scène, exactement le même jeu de données et
// les mêmes trois routes, seule l'attente a changé de sens. Ils échouent donc
// si la fuite revient, par l'un quelconque des trois chemins :
//   C-01  la LISTE DES CRITÈRES d'éligibilité servie par GET /cadre/:id ;
//   C-02  les SUGGESTIONS FSE+ dérivées d'une seconde lecture de employees.brsa,
//         postérieure au masquage de la ligne de diagnostic ;
//   C-03  le TEXTE de l'alerte « référent non déterminé », qui énonçait le
//         statut en toutes lettres sur l'écran d'un salarié.
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
    { code: 'brsa', libelle: 'Bénéficiaire du RSA', date_constat: '2025-07-10', sensible_art10: false },
    { code: 'rqth', libelle: 'Reconnaissance RQTH', date_constat: null, sensible_art10: false },
    { code: 'sortant_detention', libelle: 'Sortant de détention', date_constat: null, sensible_art10: true },
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

  test('CORRIGÉ — le MANAGER ne reçoit ni « Bénéficiaire du RSA », ni « RQTH », ni « Sortant de détention »', async () => {
    const res = await get('/api/insertion/cadre/5', 'MANAGER');
    expect(res.status).toBe(200);
    // La protection annoncée :
    expect(Object.keys(res.body)).not.toContain('statuts');
    // …et la porte d'à côté, désormais fermée : plus AUCUNE liste de critères.
    expect(res.body.eligibilite.criteres).toBeUndefined();
    const brut = JSON.stringify(res.body);
    for (const interdit of ['brsa', 'rqth', 'sortant_detention',
      'Bénéficiaire du RSA', 'Reconnaissance RQTH', 'Sortant de détention']) {
      expect(brut).not.toContain(interdit);
    }
    // Ce qu'il conserve : la PREUVE que l'éligibilité a été vérifiée.
    expect(res.body.eligibilite.verifiee_le).toBeDefined();
    // M-06 — le critère art. 10 ne compte pas : 3 en base, 2 annoncés.
    expect(res.body.eligibilite.nb_criteres).toBe(2);
  });

  test('CORRIGÉ — cette lecture reste non journalisée : elle ne sert plus rien de sensible', async () => {
    await get('/api/insertion/cadre/5', 'MANAGER');
    const journaux = mockQuery.mock.calls.filter(([sql]) => /INSERT INTO rgpd_audit_log/.test(String(sql)));
    expect(journaux).toHaveLength(0);
  });

  test('CORRIGÉ — les statuts et les pièces ne sont même pas LUS pour un MANAGER (m-10)', async () => {
    await get('/api/insertion/cadre/5', 'MANAGER');
    const sqls = mockQuery.mock.calls.map(([s]) => String(s));
    expect(sqls.some((q) => /FROM insertion_pieces/.test(q))).toBe(false);
    const emp = sqls.find((q) => /LEFT JOIN prescripteur_orgas/.test(q));
    expect(emp).not.toContain('e.brsa');
    expect(emp).not.toContain('e.france_travail_id');
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

  test('CORRIGÉ — ni « bénéficiaire du RSA » ni l\'identifiant France Travail n\'atteignent le MANAGER', async () => {
    const res = await get('/api/insertion/diagnostic/5', 'MANAGER');
    expect(res.status).toBe(200);
    const brut = JSON.stringify(res.body);
    // Le masquage fait son travail sur les champs qu'il connaît :
    expect(Object.keys(res.body)).not.toContain('frein_judiciaire');
    expect(Object.keys(res.body)).not.toContain('frein_sante_detail');
    // …et le moteur de suggestions n'est plus ALIMENTÉ : rien de dérivé ne fuit.
    expect(res.body.suggestions_fse).toEqual({});
    expect(res.body.fse_completude).toBeNull();
    expect(brut).not.toContain('bénéficiaire du RSA');
    expect(brut).not.toContain('France Travail');
  });

  test('CORRIGÉ — on ne LIT même pas les statuts du salarié pour un MANAGER (correctif structurel)', async () => {
    await get('/api/insertion/diagnostic/5', 'MANAGER');
    const lectures = mockQuery.mock.calls
      .map(([s]) => String(s))
      .filter((q) => /SELECT brsa, france_travail_id FROM employees/.test(q));
    // C'est le cœur du correctif : filtrer la sortie aurait laissé la donnée
    // traverser le serveur ; ici la requête n'est pas émise.
    expect(lectures).toHaveLength(0);
  });

  test('CORRIGÉ — le questionnaire FSE+ (et son commentaire libre) est RETIRÉ au MANAGER', async () => {
    const res = await get('/api/insertion/diagnostic/5', 'MANAGER');
    // Les clés sont ABSENTES (≠ null) : l'absence dit « non habilité ».
    expect(Object.keys(res.body)).not.toContain('fse_entree');
    expect(Object.keys(res.body)).not.toContain('fse_entree_complet');
    expect(Object.keys(res.body)).not.toContain('fse_entree_saisie_at');
    expect(JSON.stringify(res.body)).not.toContain('suivi psychologique');
  });

  test('référence — l\'ADMIN, lui, reçoit bien les suggestions et le questionnaire', async () => {
    const res = await get('/api/insertion/diagnostic/5', 'ADMIN');
    expect(res.body.suggestions_fse.ressources_principales.valeur).toBe('rsa');
    expect(res.body.fse_entree.commentaire).toContain('suivi psychologique');
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

  test('CORRIGÉ — le MANAGER ne reçoit plus l\'alerte, et le statut n\'est pas lu pour lui', async () => {
    const res = await get('/api/insertion/alertes/5', 'MANAGER');
    expect(res.status).toBe(200);
    const textes = JSON.stringify(res.body);
    expect(textes).not.toContain('bénéficiaire du RSA');
    expect(textes).not.toContain('referent_non_determine');
    // Refus AVANT lecture : la colonne n'est pas sélectionnée.
    const emp = mockQuery.mock.calls.map(([s]) => String(s)).find((q) => /FROM employees e WHERE e\.id = \$1/.test(q));
    expect(emp).toBeDefined();
    expect(emp).toContain('NULL::boolean AS brsa');
    expect(emp).not.toMatch(/\be\.brsa\b/);
  });

  test('CORRIGÉ — ADMIN/RH reçoivent l\'alerte, mais son texte ne NOMME plus le statut', async () => {
    const res = await get('/api/insertion/alertes/5', 'ADMIN');
    expect(res.status).toBe(200);
    const liste = res.body.alertes || res.body;
    const a = liste.find((x) => x.type === 'referent_non_determine');
    expect(a).toBeDefined();
    expect(a.message).toBe('Référent unique non déterminé — à signaler au Département.');
    expect(a.message).not.toContain('RSA');
    // L'action à faire est toujours dite : c'est ce qui compte à l'écran.
    expect(a.message).toContain('Département');
  });
});

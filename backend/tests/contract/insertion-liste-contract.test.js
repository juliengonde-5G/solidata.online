// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — FILE ACTIVE `GET /api/insertion` (PR C, lot 5, contrat § 5.2)
// ───────────────────────────────────────────────────────────────────────────
// Ce que ces tests tiennent, et pourquoi chacun a coûté quelque chose :
//
//   1. LE PÉRIMÈTRE. Les permanents sortent (la CIP n'a pas à voir la
//      comptable dans sa file), les parcours TERMINÉS restent sept mois (la
//      sortie FSE+ et le relevé +6 mois sont dus APRÈS la sortie), et
//      `is_active` n'est plus un filtre — un sorti est inactif.
//
//   2. `brsa` N'EST PAS LU POUR UN MANAGER. Pas masqué après lecture : ABSENT
//      de la requête. C'est le correctif C-03 de la PR A, appliqué à la source
//      cette fois-ci — la même famille de défaut a produit trois constats
//      bloquants dans ce module.
//
//   3. LA PASTILLE DE RISQUE vient des obligations, par la MÊME fonction que
//      l'écran « Mes échéances ». Deux règles, et la liste contredirait l'écran.
//
//   4. LES CHAMPS AJOUTÉS ont la forme figée (prochain_rdv en objet ou null,
//      jamais un champ plat ; `diagnostic_socle_complet` booléen ; `projets`
//      tableau, jamais null).
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;
process.env.PCM_ENCRYPTION_KEY = process.env.PCM_ENCRYPTION_KEY || 'test-pcm-key';

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

let app;
const tokenFor = (role) => jwt.sign(
  { id: 7, username: 'cip', role, first_name: 'Claire', last_name: 'MARTIN', mfa: true, mfa_at: Math.floor(Date.now() / 1000) },
  JWT_SECRET, { expiresIn: '1h' }
);
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER') };

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
});

const get = (p, role = 'ADMIN') => request(app).get(p).set('Authorization', `Bearer ${TOKENS[role]}`);

const LIGNE = {
  id: 5, first_name: 'Amine', last_name: 'BENALI', is_active: false,
  team_name: 'Tri', position: 'Agent de tri', contract_type: 'CDDI',
  contract_start: '2026-03-01', contract_end: '2026-09-30',
  insertion_status: 'termine', insertion_start_date: '2026-03-01',
  insertion_end_date: '2026-09-30', parcours_num: 1,
  cip_referent_user_id: 7, cip_referent_nom: 'MARTIN Claire',
  pass_iae_statut: 'actif', pass_iae_end: '2028-02-29', referent_unique_type: 'cms',
  brsa: true,
  // Le jour et l'heure sont désormais rendus PAR POSTGRESQL (`to_char`) sur la
  // valeur stockée — heure MURALE de Paris, jamais reconvertie (correctif
  // M-08 / D-01). Le TITRE n'est plus lu du tout (correctif M-01).
  prochain_rdv_jour: '2026-10-12', prochain_rdv_heure: '09:30',
  prochain_rdv_type: 'bilan_intermediaire',
  dernier_entretien: '2026-08-20',
  nb_contracts: 2, current_contract_type: 'CDDI', contract_end_date: '2026-09-30',
  has_pcm: 1, has_diagnostic: 1, diagnostic_socle_complet: true,
  projets: ['ASI'],
};

function branche(over = {}) {
  mockQuery.mockImplementation((sql, params) => {
    const s = String(sql).replace(/\s+/g, ' ');
    for (const [motif, lignes] of Object.entries(over)) {
      if (s.includes(motif)) {
        if (lignes instanceof Error) return Promise.reject(lignes);
        return Promise.resolve({ rows: lignes });
      }
    }
    if (/information_schema.tables/.test(s)) {
      return Promise.resolve({ rows: [
        { table_name: 'employee_contracts' }, { table_name: 'pcm_reports' },
        { table_name: 'insertion_diagnostics' }, { table_name: 'insertion_projet_participants' },
      ] });
    }
    if (/LEFT JOIN LATERAL/.test(s)) return Promise.resolve({ rows: [LIGNE] });
    if (/FROM employees e WHERE/.test(s)) return Promise.resolve({ rows: [] }); // cohorte du moteur d'échéances
    if (/FROM settings/.test(s)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => { mockQuery.mockReset(); branche(); });

/** Le texte SQL de la liste (celui qui porte les LATERAL du prochain RDV). */
const sqlListe = () => String(
  (mockQuery.mock.calls.find(([s]) => String(s).includes('LEFT JOIN LATERAL')) || [''])[0]
).replace(/\s+/g, ' ');

// ═══════════════════════════════════════════════════════════════════════════
describe('périmètre (§ 5.2)', () => {
  test('les permanents sont EXCLUS et `is_active` n’est pas un filtre', async () => {
    await get('/api/insertion');
    const q = sqlListe();
    expect(q).toContain("e.insertion_status = 'en_parcours'");
    expect(q).toContain("e.insertion_status = 'termine'");
    expect(q).toContain('make_interval(months => 7)');
    expect(q).not.toMatch(/WHERE.*e\.is_active = true/);
  });

  test('`?inclure=tous` ouvre à tous les parcours, sans fenêtre de rémanence', async () => {
    await get('/api/insertion?inclure=tous');
    const q = sqlListe();
    expect(q).toContain("e.insertion_status <> 'none'");
    expect(q).not.toContain('make_interval');
  });

  // ═══ CORRECTIF M-07 — le MANAGER ne voit que les parcours EN COURS ════════
  // La rémanence de sept mois existe pour la sortie FSE+ et le relevé à
  // +6 mois : deux gestes ADMIN/RH STRICT. Elle faisait rester une personne
  // partie dans la liste de son encadrant, avec son poste, son dernier
  // entretien et sa pastille de risque. `?inclure=tous` allait plus loin —
  // aucune borne, aucune garde de rôle, un appel HTTP direct suffisait.
  test('un MANAGER ne reçoit PAS les parcours terminés', async () => {
    await get('/api/insertion', 'MANAGER');
    const q = sqlListe();
    expect(q).toContain("e.insertion_status = 'en_parcours'");
    expect(q).not.toContain("e.insertion_status = 'termine'");
    expect(q).not.toContain('make_interval');
  });

  test('`?inclure=tous` est SANS EFFET pour un MANAGER', async () => {
    await get('/api/insertion?inclure=tous', 'MANAGER');
    const q = sqlListe();
    expect(q).toContain("e.insertion_status = 'en_parcours'");
    expect(q).not.toContain("insertion_status <> 'none'");
  });

  test('une CIP, elle, garde les deux (la sortie FSE+ se saisit APRÈS la sortie)', async () => {
    await get('/api/insertion', 'RH');
    expect(sqlListe()).toContain("e.insertion_status = 'termine'");
  });

  test('`?mine=1` restreint au CIP référent', async () => {
    await get('/api/insertion?mine=1');
    const appel = mockQuery.mock.calls.find(([s]) => String(s).includes('LEFT JOIN LATERAL'));
    expect(String(appel[0])).toContain('cip_referent_user_id');
    expect(appel[1]).toContain(7);
  });

  test('un parcours TERMINÉ et inactif est bien rendu (la sortie FSE+ est due après)', async () => {
    const r = await get('/api/insertion');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ id: 5, insertion_status: 'termine', is_active: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('projection par rôle', () => {
  test('un MANAGER : `brsa` n’est PAS LU (colonne absente de la requête)', async () => {
    await get('/api/insertion', 'MANAGER');
    const q = sqlListe();
    expect(q).toContain('NULL::boolean AS brsa');
    expect(q).not.toMatch(/,\s*e\.brsa\b/);
  });

  test('un MANAGER reçoit `brsa: null`, jamais `true`', async () => {
    branche({ 'LEFT JOIN LATERAL': [{ ...LIGNE, brsa: null }] });
    const r = await get('/api/insertion', 'MANAGER');
    expect(r.body[0].brsa).toBeNull();
  });

  test('un ADMIN lit bien la colonne', async () => {
    await get('/api/insertion', 'ADMIN');
    expect(sqlListe()).toMatch(/,\s*e\.brsa\b/);
  });

  test('un RH aussi', async () => {
    await get('/api/insertion', 'RH');
    expect(sqlListe()).toMatch(/,\s*e\.brsa\b/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('champs ajoutés (§ 5.2)', () => {
  test('la ligne porte tous les champs du contrat', async () => {
    const r = await get('/api/insertion');
    const l = r.body[0];
    for (const k of ['insertion_status', 'insertion_start_date', 'insertion_end_date', 'parcours_num',
      'cip_referent_user_id', 'cip_referent_nom', 'prochain_rdv', 'dernier_entretien', 'risque',
      'projets', 'pass_iae_statut', 'pass_iae_end', 'referent_unique_type', 'brsa',
      'has_diagnostic', 'diagnostic_socle_complet', 'contract_end_date', 'urgency']) {
      expect(l).toHaveProperty(k);
    }
  });

  test('`prochain_rdv` est un OBJET {date, heure, type} ou null — jamais des champs plats', async () => {
    const r = await get('/api/insertion');
    expect(r.body[0].prochain_rdv).toEqual({ date: '2026-10-12', heure: '09:30', type: 'bilan_intermediaire' });
    expect(r.body[0]).not.toHaveProperty('prochain_rdv_jour');
    expect(r.body[0]).not.toHaveProperty('prochain_rdv_heure');
  });

  // CORRECTIF M-01 — le titre d'un entretien est LIBRE (« Bilan après
  // l'hospitalisation ») et cette liste s'affiche à tous les rôles du module :
  // il n'est même plus SÉLECTIONNÉ, et le type rendu vient de la liste fermée.
  test('le TITRE saisi n’est ni lu ni rendu', async () => {
    const r = await get('/api/insertion');
    expect(sqlListe()).not.toMatch(/im\.titre/);
    expect(JSON.stringify(r.body)).not.toContain('titre');
  });

  // CORRECTIF M-08 / D-01 — l'heure et le jour sont demandés à PostgreSQL sur
  // la valeur STOCKÉE : `toISOString()` rendait l'heure UTC (12:00 pour un
  // rendez-vous de 14:00) et faisait reculer d'un jour ceux d'avant 02 h.
  test('l’heure et le jour du rendez-vous sont lus par PostgreSQL, sans conversion', async () => {
    await get('/api/insertion');
    const q = sqlListe();
    expect(q).toContain("to_char(im.interview_date, 'HH24:MI')");
    expect(q).toContain("to_char(im.interview_date, 'YYYY-MM-DD')");
    expect(q).not.toMatch(/interview_date AT TIME ZONE/);
  });

  test('aucun rendez-vous planifié → `prochain_rdv: null` (jamais un objet vide)', async () => {
    branche({ 'LEFT JOIN LATERAL': [{ ...LIGNE, prochain_rdv_jour: null, prochain_rdv_heure: null, prochain_rdv_type: null }] });
    const r = await get('/api/insertion');
    expect(r.body[0].prochain_rdv).toBeNull();
  });

  test('une heure de rendez-vous à minuit vaut « heure non posée », pas « 00:00 »', async () => {
    // Le module date les entretiens à J 00:00 tant que l'heure n'est pas saisie :
    // afficher « 00 h 00 » ferait croire à un rendez-vous à minuit.
    branche({ 'LEFT JOIN LATERAL': [{ ...LIGNE, prochain_rdv_heure: '00:00' }] });
    const r = await get('/api/insertion');
    expect(r.body[0].prochain_rdv.heure).toBeNull();
    expect(r.body[0].prochain_rdv.date).toBe('2026-10-12');
  });

  test('`projets` est toujours un tableau, `diagnostic_socle_complet` toujours un booléen', async () => {
    branche({ 'LEFT JOIN LATERAL': [{ ...LIGNE, projets: null, diagnostic_socle_complet: null }] });
    const r = await get('/api/insertion');
    expect(r.body[0].projets).toEqual([]);
    expect(r.body[0].diagnostic_socle_complet).toBe(false);
  });

  test('la complétude du socle est dérivée du fichier PARTAGÉ de champs', async () => {
    const { CHAMPS_SOCLE } = require('../../src/services/echeances-cip');
    await get('/api/insertion');
    const q = sqlListe();
    for (const c of CHAMPS_SOCLE) expect(q).toContain(`d2.${c.colonne}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('pastille de risque', () => {
  test('le risque vient des obligations — une seule règle pour la liste et l’écran', async () => {
    branche({
      'LEFT JOIN LATERAL': [LIGNE],
      // La cohorte du moteur d'échéances rend un salarié sans référent unique :
      // l'obligation `referent_unique` est ROUGE, donc la pastille aussi.
      'FROM employees e WHERE': [{
        id: 5, first_name: 'Amine', last_name: 'BENALI', insertion_status: 'en_parcours',
        insertion_start_date: '2026-03-01', parcours_num: 1, referent_unique_type: 'non_determine',
        pass_iae_statut: 'actif', pass_iae_end: '2030-01-01',
      }],
      'FROM insertion_diagnostics d WHERE': [{ employee_id: 5, socle_complet: true, fse_entree_complet: true }],
    });
    const r = await get('/api/insertion');
    expect(r.body[0].risque).toBe('rouge');
  });

  test('aucune obligation → `risque: null` (jamais « vert », qui serait une promesse)', async () => {
    branche({
      'LEFT JOIN LATERAL': [LIGNE],
      'FROM employees e WHERE': [{
        id: 5, first_name: 'Amine', last_name: 'BENALI', insertion_status: 'en_parcours',
        insertion_start_date: '2026-03-01', parcours_num: 1, referent_unique_type: 'cms',
        pass_iae_statut: 'actif', pass_iae_end: '2030-01-01',
      }],
      'FROM insertion_diagnostics d WHERE': [{ employee_id: 5, socle_complet: true, fse_entree_complet: true }],
    });
    const r = await get('/api/insertion');
    expect(r.body[0].risque).toBeNull();
  });

  test('un moteur d’échéances en panne laisse la liste UTILISABLE, sans pastille', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    branche({ 'FROM employees e WHERE': new Error('base injoignable') });
    const r = await get('/api/insertion');
    expect(r.status).toBe(200);
    expect(r.body[0].risque).toBeNull();
    err.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('renouvellements — lien public (§ 5.3)', () => {
  const RENOUV = {
    employee_id: 5, first_name: 'Amine', last_name: 'BENALI', contract_id: 11,
    contract_end: '2026-09-30', jours_restants: 20, milestone_id: 42,
    milestone_status: 'planifie', milestone_titre: 'Renouvellement',
    milestone_due_date: '2026-09-16', renouvellement_avis: null, renouvellement_duree_mois: null,
    formulaire_rempli: false, verrouille: false,
  };

  test('un jeton VIVANT est exposé comme lien public complet', async () => {
    process.env.PUBLIC_BASE_URL = 'https://solidata.online';
    branche({ 'JOIN employee_contracts ec ON ec.employee_id': [{
      ...RENOUV, eti_token: 'a'.repeat(32), eti_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
    }] });
    const r = await get('/api/insertion/renouvellements');
    expect(r.body.renouvellements[0].entretien.lien_eti)
      .toBe(`https://solidata.online/eti/renouvellement/${'a'.repeat(32)}`);
    expect(r.body.renouvellements[0].entretien.eti_expire_le).toBeTruthy();
  });

  test('un jeton EXPIRÉ n’est pas exposé (un lien qui répondra 410 vaut moins que rien)', async () => {
    branche({ 'JOIN employee_contracts ec ON ec.employee_id': [{
      ...RENOUV, eti_token: 'b'.repeat(32), eti_token_expires_at: new Date(Date.now() - 86400000).toISOString(),
    }] });
    const r = await get('/api/insertion/renouvellements');
    expect(r.body.renouvellements[0].entretien.lien_eti).toBeNull();
    expect(r.body.renouvellements[0].entretien.eti_expire_le).toBeNull();
  });

  test('aucun jeton → `lien_eti: null`, et la ligne reste exploitable', async () => {
    branche({ 'JOIN employee_contracts ec ON ec.employee_id': [{ ...RENOUV, eti_token: null, eti_token_expires_at: null }] });
    const r = await get('/api/insertion/renouvellements');
    expect(r.body.renouvellements[0].entretien.lien_eti).toBeNull();
    expect(r.body.renouvellements[0].entretien.id).toBe(42);
  });
});

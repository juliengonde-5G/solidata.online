// ═══════════════════════════════════════════════════════════════════════════
// TESTS DE CONTRAT — CORRECTIFS D'ISOLEMENT DU MODULE INSERTION (2.43.0)
// ───────────────────────────────────────────────────────────────────────────
// Le module insertion est ouvert à ADMIN/RH/MANAGER, et le masquage fin
// (masking.js) ne couvrait QUE les lignes de diagnostic / d'entretien. Trois
// surfaces republiaient donc à un MANAGER ce que d'autres modules lui
// refusent :
//
//  1. [CRITIQUE] GET /insertion/:employeeId — `profil_pcm` (type de
//     personnalité), le type PCM cité en clair dans `fiche_synthese.resume`,
//     `pistes_metiers[].pourquoi`, `recommandations_cip`, `parcours_dev`, et un
//     extrait du commentaire d'entretien de recrutement. Or routes/pcm.js
//     réserve la lecture des rapports PCM à ADMIN/RH/PCM.
//  2. [MOYEN] GET /action-plans/:employeeId et /actions-overview — `notes` et
//     `resultat` sont du texte libre, sans chiffrement ni masquage, y compris
//     sur les axes santé (art. 9) et judiciaire (art. 10).
//  3. [FAIBLE] DELETE /action-plans/:id — un MANAGER pouvait supprimer une
//     action de suivi CIP.
//
// Chaque test vérifiait les DEUX faces : ce que le MANAGER ne reçoit plus, ET
// que l'ADMIN le reçoit toujours (le correctif ne doit pas appauvrir la CIP).
//
// MISE À JOUR DU 10/09/2026 — le rôle MANAGER a été RETIRÉ de l'application.
// Le module insertion est donc ADMIN/RH, et il n'y a plus de vue masquée à
// servir : le jeton qui porte ce rôle est refusé en 403. Les gardes de masquage
// restent au code (elles protégeraient de nouveau si le rôle revenait), mais ce
// qui est OBSERVABLE, et donc testable ici, c'est le refus.
// ═══════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));
// Le rapport PCM est chiffré en base : on court-circuite le déchiffrement.
const PCM_REPORT = {
  base: {
    type: 'empathique', nom: 'Empathique', canal: 'nourricier',
    besoinPsychologique: 'Reconnaissance de la personne',
    pointsForts: ['Attentif aux autres', 'Sens du collectif', 'Chaleureux'],
    faiblesses_stress: ['Se sur-adapte'],
    facteurs_motivation: ['Climat d\'équipe'],
    guideManager: { do: ['Saluer'], dont: ['Aller droit au fait'] },
  },
  phase: { type: 'persevérant', nom: 'Persévérant' },
  riskAlert: true,
};
jest.mock('../../src/utils/pcm-crypto', () => ({ decryptReport: () => PCM_REPORT }));

const express = require('express');
const request = require('supertest');

let app;
const tokenFor = (role) => jwt.sign(
  { id: 9, username: 'u', role, first_name: 'T', last_name: 'U', mfa: true, mfa_at: Math.floor(Date.now() / 1000) }, JWT_SECRET, { expiresIn: '1h' });
const TOKENS = {
  ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), COLLABORATEUR: tokenFor('COLLABORATEUR'),
  // Rôles retirés le 10/09/2026 : le JWT les porte encore (il accepte n'importe
  // quelle chaîne), plus aucun `authorize` ne les reconnaît.
  MANAGER: tokenFor('MANAGER'), CR_CHEF: tokenFor('CR_CHEF'),
};

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use('/api/insertion', require('../../src/routes/insertion'));
});

const get = (path, role = 'ADMIN') => request(app).get(path).set('Authorization', `Bearer ${TOKENS[role]}`);
const del = (path, role = 'ADMIN') => request(app).delete(path).set('Authorization', `Bearer ${TOKENS[role]}`);

const INTERVIEW_COMMENT = 'Candidat ponctuel et volontaire, à confirmer sur la durée du poste au tri.';

// Base commune de la fiche : salarié + candidat (CV + entretien) + rapport PCM.
function mockFiche() {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (s.includes('prescripteur_orgas')) {
      return Promise.resolve({ rows: [{
        id: 7, first_name: 'Amina', last_name: 'Berthelot', position: 'Trieuse',
        team_name: 'Atelier Tri', is_active: true, candidate_id: 3, parcours_num: 1,
        insertion_status: 'en_parcours', has_permis_b: false, has_caces: false,
      }] });
    }
    if (s.includes('FROM employee_contracts')) {
      return Promise.resolve({ rows: [{ id: 1, is_current: true, contract_type: 'CDDI', position_id: null, start_date: '2026-02-01' }] });
    }
    if (s.includes('FROM candidates WHERE id')) {
      return Promise.resolve({ rows: [{
        id: 3, first_name: 'Amina', last_name: 'Berthelot',
        interview_comment: INTERVIEW_COMMENT, interviewer_name: 'Mme D.',
        practical_test_result: 'conforme', cv_raw_text: 'Dix ans en blanchisserie industrielle.',
      }] });
    }
    if (s.includes('FROM pcm_reports')) {
      return Promise.resolve({ rows: [{ encrypted_report: 'FAKE' }] });
    }
    if (s.includes('FROM insertion_diagnostics')) {
      return Promise.resolve({ rows: [{
        id: 5, employee_id: 7, parcours_num: 1,
        frein_mobilite: 4, frein_sante: 3, frein_judiciaire: 2,
        frein_judiciaire_detail: 'encv2:xxx', commentaire_sante: 'encv2:yyy',
        obs_points_forts: 'Ponctuelle',
      }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

// ───────────────────────────────────────────────────────────────────────────
describe('[CRITIQUE] GET /insertion/:employeeId — le PCM ne fuit plus vers un MANAGER', () => {
  it("un ADMIN reçoit toujours profil_pcm, le type PCM et l'extrait d'entretien", async () => {
    mockFiche();
    const r = await get('/api/insertion/7', 'ADMIN');
    expect(r.status).toBe(200);
    expect(r.body.profil_pcm).toBeTruthy();
    expect(r.body.profil_pcm.empathique.niveau).toBe('FORT');
    expect(r.body.fiche_synthese.resume).toMatch(/Empathique/);
    expect(r.body.fiche_synthese.resume).toMatch(/Entretien :/);
    expect(r.body.data_sources.pcm).toBeTruthy();
    expect(r.body.data_sources.interview).toBeTruthy();
    // Le correctif ne doit rien retirer à la CIP.
    expect(r.body.has_pcm).toBe(true);
    expect(r.body.has_interview).toBe(true);
  });

  // Le rôle MANAGER a été RETIRÉ le 10/09/2026 : il n'y a plus de vue masquée à
  // lui servir, la fiche lui est REFUSÉE. Ce qui se prouvait par « la clé
  // profil_pcm est absente » se prouve désormais par « rien ne sort du tout » —
  // et il faut le dire ainsi : sur une réponse 403, chercher une clé absente
  // passerait au vert sans rien démontrer.
  it("un jeton portant le rôle RETIRÉ n'obtient RIEN : 403 et corps vide de toute donnée", async () => {
    mockFiche();
    const r = await get('/api/insertion/7', 'MANAGER');
    expect(r.status).toBe(403);
    const brut = JSON.stringify(r.body);
    for (const fuite of [/Empathique/i, /Persévérant/i, /nourricier/i, /ponctuel et volontaire/i, /judiciaire/i]) {
      expect(brut).not.toMatch(fuite);
    }
  });

  it("un rôle personnalisé dérivé du rôle retiré n'hérite de rien non plus", async () => {
    mockQuery.mockImplementation((sql) => (/FROM custom_roles/i.test(String(sql))
      ? Promise.resolve({ rows: [{ role_key: 'CR_CHEF', base_role: 'MANAGER' }] })
      : Promise.resolve({ rows: [] })));
    await require('../../src/middleware/auth').refreshCustomRoles();
    expect((await get('/api/insertion/7', 'CR_CHEF')).status).toBe(403);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('[MOYEN] Actions CIP — texte libre santé/judiciaire masqué au MANAGER', () => {
  const ACTIONS = [
    { id: 1, employee_id: 7, action_label: 'Dossier logement', category: 'insertion', frein_type: 'logement', notes: 'RDV bailleur', resultat: 'en attente' },
    { id: 2, employee_id: 7, action_label: 'Suivi médical', category: 'frein', frein_type: 'sante', notes: 'Rendez-vous cardiologue le 12', resultat: 'traitement en cours' },
    { id: 3, employee_id: 7, action_label: 'Rendez-vous SPIP', category: 'frein', frein_type: 'judiciaire', notes: 'Aménagement de peine', resultat: null },
  ];
  const mockActions = () => mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (s.includes('FROM cip_action_plans ap')) {
      // Le filtre judiciaire est posé en SQL pour un MANAGER : on le simule.
      const rows = s.includes("<> 'judiciaire'") ? ACTIONS.filter((a) => a.frein_type !== 'judiciaire') : ACTIONS;
      return Promise.resolve({ rows: rows.map((a) => ({ ...a })) });
    }
    return Promise.resolve({ rows: [] });
  });

  it('un ADMIN voit tout, y compris les notes santé et l\'axe judiciaire', async () => {
    mockActions();
    const r = await get('/api/insertion/action-plans/7', 'ADMIN');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(3);
    expect(r.body.find((a) => a.frein_type === 'sante').notes).toBe('Rendez-vous cardiologue le 12');
    expect(r.body.some((a) => a.frein_type === 'judiciaire')).toBe(true);
  });

  // Même bascule que ci-dessus : le masquage du texte libre santé/judiciaire
  // visait le MANAGER, rôle retiré. Le filtre SQL et le retrait des clés
  // RESTENT dans routes/insertion/routes.js (garde de secours), mais la seule
  // chose observable de l'extérieur est désormais le refus.
  it("le rôle RETIRÉ n'atteint plus aucune action CIP (403), ni la fiche agrégée", async () => {
    mockActions();
    expect((await get('/api/insertion/action-plans/7', 'MANAGER')).status).toBe(403);
    expect((await get('/api/insertion/actions-overview', 'MANAGER')).status).toBe(403);
    expect((await get('/api/insertion/7', 'MANAGER')).status).toBe(403);
    // Aucune lecture des actions n'a même été tentée.
    const lectures = mockQuery.mock.calls.map(([s]) => String(s)).filter((q) => q.includes('cip_action_plans'));
    expect(lectures).toHaveLength(0);
  });

  it("l'ADMIN garde la vue complète des actions (aucun appauvrissement)", async () => {
    mockActions();
    const ra = await get('/api/insertion/action-plans/7', 'ADMIN');
    expect(ra.status).toBe(200);
    expect(ra.body).toHaveLength(3);
    expect(ra.body.find((a) => a.frein_type === 'sante').notes).toBe('Rendez-vous cardiologue le 12');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('[FAIBLE] DELETE /insertion/action-plans/:id — écriture sensible ADMIN/RH', () => {
  it('refuse un rôle non habilité (403) et ne supprime rien', async () => {
    const r = await del('/api/insertion/action-plans/3', 'COLLABORATEUR');
    expect(r.status).toBe(403);
    const suppressions = mockQuery.mock.calls.map(([s]) => String(s)).filter((s) => s.includes('DELETE FROM cip_action_plans'));
    expect(suppressions).toHaveLength(0);
  });

  it('accepte un ADMIN et un RH', async () => {
    for (const role of ['ADMIN', 'RH']) {
      mockQuery.mockClear();
      const r = await del('/api/insertion/action-plans/3', role);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });
    }
  });
});

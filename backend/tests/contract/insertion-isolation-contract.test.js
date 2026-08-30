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
// Chaque test vérifie les DEUX faces : ce que le MANAGER ne reçoit plus, ET que
// l'ADMIN le reçoit toujours (le correctif ne doit pas appauvrir la CIP).
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
const TOKENS = { ADMIN: tokenFor('ADMIN'), RH: tokenFor('RH'), MANAGER: tokenFor('MANAGER') };

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

  it('un MANAGER ne reçoit NI profil_pcm NI aucune mention du type PCM', async () => {
    mockFiche();
    const r = await get('/api/insertion/7', 'MANAGER');
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty('profil_pcm');      // clé RETIRÉE (≠ null)
    // Balayage exhaustif de la réponse : le type PCM ne doit apparaître nulle
    // part (fiche_synthese, pistes_metiers, recommandations_cip, parcours_dev,
    // competences, ai_recommendations…).
    const brut = JSON.stringify(r.body);
    expect(brut).not.toMatch(/Empathique/i);
    expect(brut).not.toMatch(/Persévérant/i);
    expect(brut).not.toMatch(/nourricier/i);
    expect(brut).not.toMatch(/Reconnaissance de la personne/i);
  });

  it("un MANAGER ne reçoit plus l'extrait du commentaire d'entretien de recrutement", async () => {
    mockFiche();
    const r = await get('/api/insertion/7', 'MANAGER');
    const brut = JSON.stringify(r.body);
    expect(brut).not.toMatch(/ponctuel et volontaire/i);
    expect(r.body.fiche_synthese.resume).not.toMatch(/Entretien :/);
  });

  it('les booléens has_* restent exposés au MANAGER (non habilité ≠ inexistant)', async () => {
    mockFiche();
    const r = await get('/api/insertion/7', 'MANAGER');
    expect(r.body.has_pcm).toBe(true);
    expect(r.body.has_interview).toBe(true);
    expect(r.body.has_cv).toBe(true);
    // …mais le DÉTAIL des sources PCM/entretien est retiré, pas mis à
    // « non disponible » (ce serait faux : la source existe).
    expect(r.body.data_sources).not.toHaveProperty('pcm');
    expect(r.body.data_sources).not.toHaveProperty('interview');
    expect(r.body.data_sources.cv).toBeTruthy();          // le CV lui reste accessible
    expect(r.body.data_sources.diagnostic).toBeTruthy();
  });

  it("l'axe judiciaire reste retiré des freins sociaux d'un MANAGER (non-régression)", async () => {
    mockFiche();
    const r = await get('/api/insertion/7', 'MANAGER');
    const types = (r.body.freins_sociaux?.freins || []).map((f) => f.type);
    expect(types).not.toContain('judiciaire');
    expect(types).toContain('mobilite');
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

  it('un MANAGER ne voit plus les actions de l\'axe judiciaire (art. 10)', async () => {
    mockActions();
    const r = await get('/api/insertion/action-plans/7', 'MANAGER');
    expect(r.status).toBe(200);
    expect(r.body.some((a) => a.frein_type === 'judiciaire')).toBe(false);
    expect(JSON.stringify(r.body)).not.toMatch(/SPIP|Aménagement de peine/);
    // Le SQL lui-même exclut l'axe (pour que les totaux restent cohérents).
    const sqlActions = mockQuery.mock.calls.map(([s]) => String(s)).find((s) => s.includes('FROM cip_action_plans ap'));
    expect(sqlActions).toMatch(/<> 'judiciaire'/);
  });

  it('un MANAGER garde l\'action santé mais SANS son texte libre', async () => {
    mockActions();
    const r = await get('/api/insertion/action-plans/7', 'MANAGER');
    const sante = r.body.find((a) => a.frein_type === 'sante');
    expect(sante).toBeTruthy();               // l'encadrant doit pouvoir suivre l'action
    expect(sante).not.toHaveProperty('notes'); // clé RETIRÉE (≠ null)
    expect(sante).not.toHaveProperty('resultat');
    // Les autres axes ne sont pas touchés.
    const logement = r.body.find((a) => a.frein_type === 'logement');
    expect(logement.notes).toBe('RDV bailleur');
    expect(logement.resultat).toBe('en attente');
  });

  it('GET /actions-overview : même masquage, et le total suit le filtre SQL', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      const exclu = s.includes("<> 'judiciaire'");
      if (s.includes('COUNT(*)::int AS n')) return Promise.resolve({ rows: [{ n: exclu ? 2 : 3 }] });
      if (s.includes('FROM cip_action_plans a')) {
        const rows = exclu ? ACTIONS.filter((a) => a.frein_type !== 'judiciaire') : ACTIONS;
        return Promise.resolve({ rows: rows.map((a) => ({ ...a, first_name: 'Amina', last_name: 'Berthelot' })) });
      }
      return Promise.resolve({ rows: [] });
    });
    const rm = await get('/api/insertion/actions-overview', 'MANAGER');
    expect(rm.status).toBe(200);
    expect(rm.body.total).toBe(2);
    expect(rm.body.actions).toHaveLength(2);   // total ET lignes cohérents
    expect(rm.body.actions.find((a) => a.frein_type === 'sante')).not.toHaveProperty('notes');

    const ra = await get('/api/insertion/actions-overview', 'ADMIN');
    expect(ra.body.total).toBe(3);
    expect(ra.body.actions).toHaveLength(3);
    expect(ra.body.actions.find((a) => a.frein_type === 'sante').notes).toBe('Rendez-vous cardiologue le 12');
  });

  it('la fiche agrégée GET /:employeeId applique le même masquage aux actions', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (s.includes('prescripteur_orgas')) {
        return Promise.resolve({ rows: [{ id: 7, first_name: 'A', last_name: 'B', candidate_id: null, parcours_num: 1 }] });
      }
      if (s.includes('FROM cip_action_plans WHERE employee_id')) {
        return Promise.resolve({ rows: ACTIONS.map((a) => ({ ...a })) });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await get('/api/insertion/7', 'MANAGER');
    expect(r.status).toBe(200);
    expect(r.body.action_plans.some((a) => a.frein_type === 'judiciaire')).toBe(false);
    expect(r.body.action_plans.find((a) => a.frein_type === 'sante')).not.toHaveProperty('notes');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('[FAIBLE] DELETE /insertion/action-plans/:id — écriture sensible ADMIN/RH', () => {
  it('refuse un MANAGER (403) et ne supprime rien', async () => {
    const r = await del('/api/insertion/action-plans/3', 'MANAGER');
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

// Preuve bout-en-bout (Vague 3 — item 3.C-5) : la charge utile envoyée à
// Anthropic depuis insertion-ai.js est PSEUDONYMISÉE (aucun nom réel), et la
// réponse du modèle est RÉ-HYDRATÉE (jeton → nom réel) pour le CIP.
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: (...a) => mockCreate(...a) },
})));

const mockQuery = jest.fn((sql) => {
  const s = String(sql);
  if (s.includes('LEFT JOIN teams')) {
    return Promise.resolve({ rows: [{
      id: 1, first_name: 'Jean', last_name: 'Dupont', position_name: 'Trieur',
      team_name: 'Atelier Tri', insertion_status: 'en_parcours',
      birth_date: '1990-01-01', contract_start: '2026-01-01', insertion_start_date: '2026-01-01',
    }] });
  }
  if (s.includes('insertion_diagnostics')) {
    return Promise.resolve({ rows: [{
      frein_sante: 3, frein_sante_detail: 'Jean Dupont a un souci de dos, tel 0612345678',
      obs_points_forts: 'Jean est très ponctuel', obs_difficultes: null,
    }] });
  }
  if (s.includes('FROM candidates c')) {
    return Promise.resolve({ rows: [{ first_name: 'Jean', last_name: 'Dupont', interview_comment: 'Bon entretien avec Jean' }] });
  }
  return Promise.resolve({ rows: [] });
});
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));

process.env.ANTHROPIC_API_KEY = 'test-key';
const insertionAi = require('../../../src/services/insertion-ai');

describe('analyseProfilComplet — pseudonymisation avant Anthropic', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        synthese: 'Salarié A est ponctuel et doit soigner son dos.',
        prochaine_etape: 'Planifier un RDV avec Salarié A.',
      }) }],
      stop_reason: 'end_turn', usage: { output_tokens: 20 },
    });
  });

  it('la charge utile envoyée au modèle ne contient AUCUN nom réel', async () => {
    await insertionAi.analyseProfilComplet(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const payloadStr = mockCreate.mock.calls[0][0].messages[0].content;
    expect(payloadStr).not.toMatch(/Dupont/);
    expect(payloadStr).not.toMatch(/Jean/);        // prénom scrubé partout (obs, entretien, frein)
    expect(payloadStr).not.toMatch(/0612345678/);  // téléphone masqué
    expect(payloadStr).toMatch(/Salarié A/);       // jeton présent
    expect(payloadStr).toMatch(/30-39 ans/);       // date de naissance → tranche d'âge
  });

  it('la réponse du modèle est ré-hydratée (jeton → nom réel) pour le CIP', async () => {
    const out = await insertionAi.analyseProfilComplet(1);
    expect(out.synthese).toBe('Jean Dupont est ponctuel et doit soigner son dos.');
    expect(out.prochaine_etape).toBe('Planifier un RDV avec Jean Dupont.');
  });
});

describe('bilanCohorte — pseudonymisation de cohorte', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    // Cohorte : override le mock pour la requête des salariés actifs.
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (s.includes('WHERE e.is_active = true') && s.includes('frein_mobilite')) {
        return Promise.resolve({ rows: [
          { id: 10, first_name: 'Marie', last_name: 'Martin', insertion_status: 'en_parcours', position_name: 'Trieur', team_name: 'Tri', frein_sante: 2 },
          { id: 11, first_name: 'Ali', last_name: 'Bennani', insertion_status: 'en_parcours', position_name: 'Chauffeur', team_name: 'Collecte', frein_mobilite: 4 },
        ] });
      }
      if (s.includes('insertion_milestones')) {
        return Promise.resolve({ rows: [{ employee_id: 10, first_name: 'Marie', last_name: 'Martin', milestone_type: 'Bilan M+3', due_date: '2026-01-01', status: 'planifie' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        synthese: 'Cohorte suivie.',
        alertes: [{ salarie: 'Salarié A', niveau: 'attention', raison: 'jalon en retard' }],
      }) }],
      stop_reason: 'end_turn', usage: { output_tokens: 20 },
    });
  });

  it('n’envoie que des jetons ; ré-hydrate les alertes avec les noms réels', async () => {
    const out = await insertionAi.bilanCohorte();
    const payloadStr = mockCreate.mock.calls[0][0].messages[0].content;
    expect(payloadStr).not.toMatch(/Martin/);
    expect(payloadStr).not.toMatch(/Bennani/);
    expect(payloadStr).toMatch(/Salarié A/);
    expect(payloadStr).toMatch(/Salarié B/);
    // "Salarié A" = premier enregistré (Marie Martin) → ré-hydraté dans l'alerte.
    expect(out.alertes[0].salarie).toBe('Marie Martin');
  });
});

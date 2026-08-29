// ═══════════════════════════════════════════════════════════════════════════
// NOTE DE PROFIL INITIAL CIP (2.43.0) — services/insertion-ai.analyserProfilInitial
// ───────────────────────────────────────────────────────────────────────────
// Ce que cette suite verrouille (et pourquoi) :
//  1. PSEUDONYMISATION — le CV brut et TOUS les textes libres d'entretien /
//     mise en situation partent nettoyés (aucun patronyme, aucune coordonnée),
//     la date de naissance est réduite à une tranche d'âge, et la réponse est
//     ré-hydratée pour le CIP.
//  2. `risk_alert` / `rpsIndicators` du rapport PCM ne SORTENT JAMAIS vers le
//     modèle (artefact statistique — audit du module PCM, chantier 2.43.0).
//  3. SOURCES HONNÊTES — les manques sont NOMMÉS, jamais comblés.
//  4. PERSISTANCE CHIFFRÉE + suggestions de freins bornées au registre, et
//     AUCUNE écriture dans insertion_diagnostics.frein_* (la CIP décide seule).
//  5. Robustesse : JSON inexploitable → `_raw`, jamais une note faussement
//     structurée.
// ═══════════════════════════════════════════════════════════════════════════
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: (...a) => mockCreate(...a) },
})));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-note-profil';
process.env.ANTHROPIC_API_KEY = 'test-key';

// Rapport PCM tel que le produit routes/pcm.js (structure réelle) — il porte
// riskAlert et rpsIndicators, qui doivent rester au chaud côté serveur.
const PCM_REPORT = {
  base: {
    type: 'empathique', nom: 'Empathique', canal: 'nourricier',
    besoinPsychologique: 'Reconnaissance de la personne',
    pointsForts: ['Attentif aux autres', 'Sensible au climat d\'équipe'],
  },
  phase: { type: 'persevérant', nom: 'Persévérant' },
  scores: { empathique: 88, analyseur: 12 },
  comportementsPrincipaux: {
    avecManager: { do: ['Saluer chaleureusement'], dont: ['Aller droit au fait sans bonjour'] },
    sousStress: 'Niveau 1 : se sur-adapte',
  },
  communicationTips: ['Canal privilégié : nourricier'],
  riskAlert: true,
  rpsIndicators: ['Profil de phase Persévérant avec indices de stress élevé (7/10 réponses stress concordantes)'],
  confidence: { base: 0.9 },
};

const captured = { inserts: [] };
const mockQuery = jest.fn((sql, params) => {
  const s = String(sql);
  if (s.includes('LEFT JOIN teams')) {
    return Promise.resolve({ rows: [{
      id: 7, first_name: 'Amina', last_name: 'Berthelot', position_name: 'Trieuse',
      team_name: 'Atelier Tri', insertion_status: 'en_parcours',
      birth_date: '1988-05-03', contract_start: '2026-02-01', insertion_start_date: '2026-02-01',
      has_permis_b: true, has_caces: false,
    }] });
  }
  if (s.includes('FROM pcm_reports')) {
    return Promise.resolve({ rows: [{
      encrypted_report: 'FAKE', base_type: 'empathique', phase_type: 'persevérant', risk_alert: true,
    }] });
  }
  if (s.includes('FROM candidates c') && s.includes('cv_raw_text')) {
    return Promise.resolve({ rows: [{
      first_name: 'Amina', last_name: 'Berthelot',
      interview_comment: 'Amina Berthelot est motivée, joignable au 0612345678',
      practical_test_result: 'conforme',
      cv_raw_text: 'CV de Amina Berthelot — amina.berthelot@example.com — 10 ans en blanchisserie',
    }] });
  }
  if (s.includes('recruitment_interviews')) {
    return Promise.resolve({ rows: [{
      candidate_id: 3, situation_actuelle: 'retour_emploi', duree_sans_emploi: 'plus_1_an',
      freins_emploi: ['mobilité', 'garde d\'enfants'],
      motivation_reprise: 'Amina veut retrouver un rythme',
      question_ouverte: 'Je ne veux plus travailler de nuit',
      commentaire_evaluateur: 'Entretien favorable pour Berthelot',
      evaluation_globale: 'favorable',
    }] });
  }
  if (s.includes('mise_en_situation')) {
    return Promise.resolve({ rows: [{
      type: 'craquage', resultat: 'conforme', respect_consignes: 4, capacite_physique: 3,
      endurance: 3, comprehension: 4, qualite_travail: 4, rapidite: 3, securite: 5, autonomie: 3,
      points_forts: 'Amina respecte les consignes', points_amelioration: null,
      commentaire: null, duree_minutes: 90,
    }] });
  }
  if (s.includes('FROM candidates c') && s.includes('practical_test_comment')) {
    return Promise.resolve({ rows: [{ id: 3, interviewer_name: 'Mme D.', practical_test_comment: null }] });
  }
  if (s.includes('COALESCE(parcours_num, 1) AS pn')) {
    return Promise.resolve({ rows: [{ pn: 2 }] });
  }
  if (s.includes('INSERT INTO insertion_notes_profil')) {
    captured.inserts.push({ sql: s, params });
    return Promise.resolve({ rows: [{ id: 42, parcours_num: params[1], generated_at: '2026-08-29T10:00:00Z', communiquee_cip_at: null }] });
  }
  return Promise.resolve({ rows: [] });
});
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
// Le rapport PCM stocké est chiffré : on court-circuite le déchiffrement
// (la clé de chiffrement PCM n'est pas l'objet de cette suite).
jest.mock('../../src/utils/pcm-crypto', () => ({ decryptReport: () => PCM_REPORT }));

const { decryptField } = require('../../src/utils/field-crypto');
const { analyserProfilInitial } = require('../../src/services/insertion-ai');

const REPONSE_MODELE = {
  synthese: 'Salarié A revient à l\'emploi après plus d\'un an.',
  expression_de_la_personne: ['Je ne veux plus travailler de nuit'],
  structure_personnalite: {
    type_pcm_base: 'Empathique', phase: 'Persévérant',
    canaux_communication: 'S\'engage plus volontiers quand la relation est posée d\'abord.',
    besoins_psychologiques: 'Attache de l\'importance à être reconnue comme personne.',
    points_forts: ['Attentive au climat d\'équipe'],
    signaux_stress_a_observer: ['Se sur-adapte → reformuler la demande et proposer une pause'],
    conseils_posture_cip: ['Ouvrir par un temps informel'],
  },
  freins_pressentis: [
    { frein: 'mobilite', niveau_suggere: 3, justification: 'Mobilité citée en entretien', source: 'entretien' },
    { frein: 'famille', niveau_suggere: null, justification: 'Garde d\'enfants évoquée', source: 'entretien' },
    { frein: 'inventé', niveau_suggere: 5, justification: 'Hors registre', source: 'entretien' },
    { frein: 'sante', niveau_suggere: 9, justification: 'Niveau hors bornes', source: 'ailleurs' },
  ],
  competences_observees: ['Respect des consignes (mise en situation)'],
  points_vigilance_entretien: ['Aborder les horaires'],
  questions_suggerees_diagnostic: ['Comment organisez-vous vos trajets ?'],
  limites: 'Le dossier ne dit rien de la situation de logement.',
};

const repondre = (obj, stop = 'end_turn') => mockCreate.mockResolvedValue({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
  stop_reason: stop, usage: { output_tokens: 200 },
});

beforeEach(() => {
  mockCreate.mockReset();
  captured.inserts = [];
  repondre(REPONSE_MODELE);
});

describe('analyserProfilInitial — ce qui part vers le modèle', () => {
  it('ne transmet AUCUN nom réel ni coordonnée (CV et textes libres nettoyés)', async () => {
    await analyserProfilInitial(7, { generatedBy: 5 });
    const payload = mockCreate.mock.calls[0][0].messages[0].content;
    expect(payload).not.toMatch(/Berthelot/);
    expect(payload).not.toMatch(/Amina/);
    expect(payload).not.toMatch(/0612345678/);
    expect(payload).not.toMatch(/amina\.berthelot@example\.com/);
    expect(payload).toMatch(/Salarié A/);
    // Date de naissance jamais transmise — tranche d'âge seulement.
    expect(payload).not.toMatch(/1988-05-03/);
    expect(payload).toMatch(/30-39 ans/);
  });

  it("transmet bien le CV, l'entretien STRUCTURÉ et les mises en situation", async () => {
    await analyserProfilInitial(7, {});
    const payload = mockCreate.mock.calls[0][0].messages[0].content;
    expect(payload).toMatch(/blanchisserie/);             // CV exploité
    expect(payload).toMatch(/plus_1_an/);                 // entretien structuré
    expect(payload).toMatch(/craquage/);                  // mise en situation
    expect(payload).toMatch(/respect_consignes/);
  });

  it('EXCLUT risk_alert / rpsIndicators du rapport PCM (artefact statistique)', async () => {
    await analyserProfilInitial(7, {});
    const payload = mockCreate.mock.calls[0][0].messages[0].content;
    expect(payload).toMatch(/nourricier/);                 // repères de communication : transmis
    expect(payload).not.toMatch(/riskAlert/);
    expect(payload).not.toMatch(/rpsIndicators/i);
    expect(payload).not.toMatch(/alerte_risque/);
    expect(payload).not.toMatch(/indices de stress élevé/);
    expect(payload).not.toMatch(/réponses stress concordantes/);
  });

  it('porte les garde-fous déontologiques dans le PROMPT SYSTÈME (opposables)', async () => {
    await analyserProfilInitial(7, {});
    const system = mockCreate.mock.calls[0][0].system;
    expect(system).toMatch(/outil de COMMUNICATION/);
    expect(system).toMatch(/AUCUN vocabulaire clinique/);
    expect(system).toMatch(/AUCUNE prédiction/);
    expect(system).toMatch(/PROVENANCE OBLIGATOIRE/);
    expect(system).toMatch(/non évalué/);
    expect(system).toMatch(/médecine du\s+travail/);
    expect(system).toMatch(/HYPOTHÈSE/);
    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(3500);
  });
});

describe('analyserProfilInitial — sortie, sources et persistance', () => {
  it('ré-hydratate le jeton en nom réel pour le CIP', async () => {
    const out = await analyserProfilInitial(7, {});
    expect(out.note.synthese).toBe("Amina Berthelot revient à l'emploi après plus d'un an.");
  });

  it('borne les freins pressentis au registre et aux niveaux 1-5', async () => {
    const out = await analyserProfilInitial(7, {});
    const keys = out.note.freins_pressentis.map((f) => f.frein);
    expect(keys).toEqual(['mobilite', 'famille', 'sante']); // « inventé » rejeté
    expect(out.note.freins_pressentis[0].niveau_suggere).toBe(3);
    expect(out.note.freins_pressentis[1].niveau_suggere).toBeNull(); // null honnête conservé
    expect(out.note.freins_pressentis[2].niveau_suggere).toBeNull(); // 9 hors bornes → null
    expect(out.note.freins_pressentis[2].source).toBeNull();         // source hors liste → null
  });

  it("n'écrit JAMAIS dans insertion_diagnostics (les freins restent des suggestions)", async () => {
    await analyserProfilInitial(7, {});
    const ecritures = mockQuery.mock.calls
      .map(([sql]) => String(sql))
      .filter((s) => /UPDATE\s+insertion_diagnostics|INSERT\s+INTO\s+insertion_diagnostics/i.test(s));
    expect(ecritures).toHaveLength(0);
  });

  it('persiste le contenu CHIFFRÉ sur le parcours courant (UPSERT)', async () => {
    const out = await analyserProfilInitial(7, { generatedBy: 5 });
    expect(captured.inserts).toHaveLength(1);
    const { sql, params } = captured.inserts[0];
    expect(sql).toMatch(/ON CONFLICT \(employee_id, parcours_num\) DO UPDATE/);
    expect(params[0]).toBe(7);
    expect(params[1]).toBe(2);                 // parcours courant lu en base
    expect(params[5]).toBe(5);                 // generated_by
    expect(String(params[2])).toMatch(/^encv2:/); // contenu chiffré, jamais en clair
    const relu = JSON.parse(decryptField(params[2]));
    expect(relu.synthese).toMatch(/Amina Berthelot/);
    expect(out.parcours_num).toBe(2);
  });

  it('NOMME les sources manquantes plutôt que de les combler', async () => {
    const out = await analyserProfilInitial(7, {});
    expect(out.sources).toMatchObject({
      has_cv: true, has_interview_form: true, has_interview_comment: true, has_pcm: true,
    });
    expect(out.sources.has_mise_en_situation).toEqual(['craquage']);
    expect(out.sources.manques).toEqual([]);
  });

  it('liste les manques quand le dossier est incomplet', async () => {
    // Base « nue » : aucun candidat, aucun entretien, aucune mise en situation, aucun PCM.
    mockQuery.mockImplementationOnce((sql) => (String(sql).includes('LEFT JOIN teams')
      ? Promise.resolve({ rows: [{ id: 8, first_name: 'Sans', last_name: 'Dossier' }] })
      : Promise.resolve({ rows: [] })));
    const impl = mockQuery.getMockImplementation();
    mockQuery.mockImplementation((sql, params) => {
      const s = String(sql);
      if (s.includes('LEFT JOIN teams')) {
        return Promise.resolve({ rows: [{ id: 8, first_name: 'Sans', last_name: 'Dossier' }] });
      }
      if (s.includes('INSERT INTO insertion_notes_profil')) {
        captured.inserts.push({ sql: s, params });
        return Promise.resolve({ rows: [{ id: 43, parcours_num: 1 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const out = await analyserProfilInitial(8, {});
    mockQuery.mockImplementation(impl);
    expect(out.sources).toMatchObject({
      has_cv: false, has_interview_form: false, has_interview_comment: false, has_pcm: false,
    });
    expect(out.sources.has_mise_en_situation).toEqual([]);
    expect(out.sources.manques.join(' | ')).toMatch(/CV non disponible/);
    expect(out.sources.manques.join(' | ')).toMatch(/Profil PCM non disponible/);
    expect(out.sources.manques.join(' | ')).toMatch(/Aucune mise en situation/);
  });
});

describe('analyserProfilInitial — robustesse', () => {
  it('ne fabrique jamais une note structurée depuis un JSON inexploitable', async () => {
    repondre('Ceci n\'est pas du JSON.');
    const out = await analyserProfilInitial(7, {});
    expect(out.note._raw).toBe("Ceci n'est pas du JSON.");
    expect(out.note.synthese).toBeUndefined();
  });

  it('signale une réponse tronquée par max_tokens', async () => {
    repondre(REPONSE_MODELE, 'max_tokens');
    const out = await analyserProfilInitial(7, {});
    expect(out.note._tronque).toBe(true);
  });

  it('dit explicitement quand le modèle ne renvoie aucun texte', async () => {
    mockCreate.mockResolvedValue({ content: [], stop_reason: 'end_turn', usage: {} });
    const out = await analyserProfilInitial(7, {});
    expect(out.note.synthese).toMatch(/aucun contenu texte/i);
  });

  it("échoue proprement sans clé Anthropic (jamais de note vide persistée)", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    jest.resetModules();
    delete process.env.ANTHROPIC_API_KEY;
    jest.doMock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })));
    jest.doMock('../../src/config/database', () => ({ query: (...a) => mockQuery(...a), connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }) }));
    const svc = require('../../src/services/insertion-ai');
    await expect(svc.analyserProfilInitial(7, {})).rejects.toThrow(/ANTHROPIC_API_KEY/);
    process.env.ANTHROPIC_API_KEY = saved;
    jest.resetModules();
  });
});

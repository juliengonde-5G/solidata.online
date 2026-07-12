const { anonymizeEmployee, anonymizeCandidate } = require('../../../src/services/anonymization');

// Colonnes simulées par table (sous-ensemble représentatif).
const TABLE_COLUMNS = {
  employees: [
    'id', 'first_name', 'last_name', 'email', 'personal_email', 'phone', 'photo_path', 'skills',
    'birth_name', 'birth_date', 'birth_city', 'birth_country', 'birth_department', 'nationality',
    'gender', 'civility', 'address', 'city', 'postal_code', 'country',
    'disability_status', 'residence_permit_type', 'residence_permit_number', 'residence_permit_renewal',
    'visite_medicale_date', 'visite_medicale_due_date', 'visite_medicale_resultat', 'visite_medicale_notes',
    'last_medical_visit_date', 'gross_salary', 'siret', 'seniority_date', 'manager_name', 'manager_malibou_id',
    'malibou_id', 'prescripteur', 'is_active', 'updated_at',
    // colonnes conservées (agrégats)
    'contract_type', 'contract_start', 'contract_end', 'weekly_hours', 'team_id', 'position',
    'insertion_status', 'insertion_start_date', 'insertion_end_date', 'prescripteur_id', 'date_prescription', 'user_id',
  ],
  insertion_diagnostics: ['id', 'employee_id', 'contraintes_sante', 'frein_sante_detail', 'frein_mobilite', 'frein_sante', 'cip_questions'],
  insertion_milestones: ['id', 'employee_id', 'bilan_professionnel', 'bilan_social', 'sortie_commentaires', 'sortie_classification', 'sortie_type', 'milestone_type', 'status'],
  cip_action_plans: ['id', 'employee_id', 'action_label', 'notes', 'category', 'priority', 'status'],
  candidates: ['id', 'first_name', 'last_name', 'email', 'phone', 'gender', 'cv_file_path', 'cv_raw_text', 'source_email', 'comment', 'interviewer_name', 'interview_comment', 'practical_test_comment', 'appointment_location', 'updated_at'],
  candidate_skills: ['id', 'candidate_id'],
  pcm_sessions: ['id', 'candidate_id'],
  pcm_reports: ['id', 'candidate_id'],
  recruitment_interviews: ['id', 'candidate_id'],
  mise_en_situation: ['id', 'candidate_id'],
  recruitment_documents: ['id', 'candidate_id'],
  candidate_history: ['id', 'candidate_id', 'comment'],
};

function makeMockClient() {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const colMatch = /information_schema\.columns/i.test(sql);
      const tblMatch = /information_schema\.tables/i.test(sql);
      if (colMatch) {
        const table = params[0];
        return { rows: (TABLE_COLUMNS[table] || []).map((column_name) => ({ column_name })) };
      }
      if (tblMatch) {
        const table = params[0];
        return { rows: TABLE_COLUMNS[table] ? [{ x: 1 }] : [] };
      }
      return { rows: [] };
    },
  };
}

const dataSql = (calls) => calls.map((c) => c.sql).filter((s) => !/information_schema/i.test(s));

describe('anonymization — anonymizeEmployee (item 42)', () => {
  it('anonymise identité + santé/RQTH + naissance + titres de séjour, en préservant les agrégats', async () => {
    const client = makeMockClient();
    await anonymizeEmployee(client, 5);
    const empUpdate = dataSql(client.calls).find((s) => /^UPDATE employees SET/i.test(s));
    expect(empUpdate).toBeTruthy();
    // Données sensibles anonymisées
    for (const col of ['first_name', 'disability_status', 'residence_permit_number', 'birth_date', 'gross_salary', 'siret', 'gender', 'address', 'last_medical_visit_date']) {
      expect(empUpdate).toContain(col);
    }
    // Agrégats préservés (absents du SET)
    for (const kept of ['contract_type', 'insertion_status', 'insertion_start_date', 'weekly_hours', 'prescripteur_id']) {
      expect(empUpdate).not.toContain(`${kept} =`);
    }
    expect(empUpdate).toContain('is_active = false');
  });

  it('purge les verbatims d’insertion mais conserve les scores/classification (agrégats)', async () => {
    const client = makeMockClient();
    await anonymizeEmployee(client, 5);
    const sqls = dataSql(client.calls);

    const diagUpdate = sqls.find((s) => /^UPDATE insertion_diagnostics SET/i.test(s));
    expect(diagUpdate).toContain('contraintes_sante = NULL');
    expect(diagUpdate).not.toContain('frein_mobilite = NULL'); // score numérique préservé

    const msUpdate = sqls.find((s) => /^UPDATE insertion_milestones SET/i.test(s));
    expect(msUpdate).toContain('bilan_professionnel = NULL');
    expect(msUpdate).not.toContain('sortie_classification = NULL'); // agrégat DREETS préservé

    const apUpdate = sqls.find((s) => /^UPDATE cip_action_plans SET/i.test(s));
    expect(apUpdate).toContain("action_label = 'ANONYMISÉ'"); // NOT NULL → placeholder
    expect(apUpdate).toContain('notes = NULL');
  });

  it('anonymise le compte utilisateur lié', async () => {
    const client = makeMockClient();
    await anonymizeEmployee(client, 5);
    const userUpdate = dataSql(client.calls).find((s) => /^UPDATE users SET/i.test(s));
    expect(userUpdate).toBeTruthy();
  });
});

describe('anonymization — anonymizeCandidate (item 42)', () => {
  it('anonymise identité + genre et supprime PCM / entretiens / mises en situation / documents', async () => {
    const client = makeMockClient();
    await anonymizeCandidate(client, 9);
    const sqls = dataSql(client.calls);

    const candUpdate = sqls.find((s) => /^UPDATE candidates SET/i.test(s));
    expect(candUpdate).toContain('first_name');
    expect(candUpdate).toContain('gender'); // le genre était laissé en clair avant

    const deleted = sqls.filter((s) => /^DELETE FROM/i.test(s));
    for (const table of ['candidate_skills', 'pcm_sessions', 'pcm_reports', 'recruitment_interviews', 'mise_en_situation', 'recruitment_documents']) {
      expect(deleted.some((s) => s.includes(table))).toBe(true);
    }
    // candidate_history : commentaire nettoyé (pas de suppression de la ligne d'audit)
    expect(sqls.some((s) => /^UPDATE candidate_history SET comment = NULL/i.test(s))).toBe(true);
  });
});

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
    // extension 2026-07 : identifiants IAE nominatifs
    'pass_iae_number', 'pass_iae_start', 'pass_iae_end', 'france_travail_id',
    'eligibilite_criteres', 'eligibilite_justificatifs_ref',
    // colonnes conservées (agrégats)
    'contract_type', 'contract_start', 'contract_end', 'weekly_hours', 'team_id', 'position',
    'insertion_status', 'insertion_start_date', 'insertion_end_date', 'prescripteur_id', 'date_prescription', 'user_id',
  ],
  insertion_diagnostics: ['id', 'employee_id', 'contraintes_sante', 'frein_sante_detail', 'frein_mobilite', 'frein_sante', 'cip_questions',
    // extension 2026-07 : nouveaux axes + rubriques structurées + FSE+
    'frein_judiciaire', 'frein_judiciaire_detail', 'frein_logement', 'frein_logement_detail',
    'commentaire_sante', 'commentaire_budget', 'logement_statut', 'ressources', 'situation_familiale',
    'rqth', 'questionnaire_detail', 'fse_entree', 'statut_saisie', 'parcours_num'],
  insertion_milestones: ['id', 'employee_id', 'bilan_professionnel', 'bilan_social', 'sortie_commentaires', 'sortie_classification', 'sortie_type', 'milestone_type', 'status',
    // extension 2026-07 : modèle entretien élargi
    'titre', 'parcours_num', 'previous_review', 'validations', 'ia_preparation', 'renouvellement_form',
    'renouvellement_avis', 'renouvellement_duree_mois', 'sortie_documents', 'remise_salarie',
    'post_sortie_situation', 'post_sortie_commentaire', 'fse_sortie', 'locked_at'],
  insertion_milestones_history: ['id', 'milestone_id', 'snapshot', 'action', 'changed_by', 'motif'],
  cip_action_plans: ['id', 'employee_id', 'action_label', 'notes', 'category', 'priority', 'status', 'resultat', 'duree_minutes', 'partenaire_id', 'objectif_id'],
  insertion_objectifs: ['id', 'employee_id', 'titre', 'description', 'statut', 'echeance', 'date_butoir', 'origine', 'parent_id'],
  insertion_pmsmp: ['id', 'employee_id', 'entreprise', 'siret', 'objet', 'date_debut', 'date_fin', 'tuteur', 'bilan', 'convention_ref'],
  insertion_satisfaction_sortie: ['id', 'employee_id', 'reponses', 'situation_sortie', 'satisfaction_globale', 'suggestions', 'avis_transmis'],
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

  // ── Extension 2026-07 (PR1 phase B) ──────────────────────────────────────
  it('purge les nouveaux champs du diagnostic (judiciaire art. 10, santé art. 9) MAIS CONSERVE fse_entree (piste audit FSE+ ≥ 5 ans) et les catégoriels', async () => {
    const client = makeMockClient();
    await anonymizeEmployee(client, 5);
    const diagUpdate = dataSql(client.calls).find((s) => /^UPDATE insertion_diagnostics SET/i.test(s));
    expect(diagUpdate).toContain('frein_judiciaire_detail = NULL');
    expect(diagUpdate).toContain('commentaire_sante = NULL');
    expect(diagUpdate).toContain('commentaire_budget = NULL');
    expect(diagUpdate).toContain('rqth = NULL');
    expect(diagUpdate).toContain('questionnaire_detail = NULL');
    // Conservés : scores de freins, catégoriels de typologie, FSE+
    expect(diagUpdate).not.toContain('frein_judiciaire = NULL');
    expect(diagUpdate).not.toContain('fse_entree');
    expect(diagUpdate).not.toContain('logement_statut = NULL');
    expect(diagUpdate).not.toContain('ressources = NULL');
    expect(diagUpdate).not.toContain('situation_familiale = NULL');
  });

  it('purge les nouveaux JSONB des entretiens MAIS CONSERVE fse_sortie, titre et les catégoriels de renouvellement/post-sortie', async () => {
    const client = makeMockClient();
    await anonymizeEmployee(client, 5);
    const msUpdate = dataSql(client.calls).find((s) => /^UPDATE insertion_milestones SET/i.test(s));
    for (const nulled of ['previous_review', 'validations', 'ia_preparation', 'renouvellement_form', 'sortie_documents', 'remise_salarie', 'post_sortie_commentaire']) {
      expect(msUpdate).toContain(`${nulled} = NULL`);
    }
    expect(msUpdate).not.toContain('fse_sortie');
    expect(msUpdate).not.toContain('titre = NULL');
    expect(msUpdate).not.toContain('renouvellement_avis = NULL');
    expect(msUpdate).not.toContain('post_sortie_situation = NULL');
  });

  it('anonymise les objectifs (titre placeholder + description NULL) en gardant statuts/échéances', async () => {
    const client = makeMockClient();
    await anonymizeEmployee(client, 5);
    const objUpdate = dataSql(client.calls).find((s) => /^UPDATE insertion_objectifs SET/i.test(s));
    expect(objUpdate).toContain("titre = 'ANONYMISÉ'");
    expect(objUpdate).toContain('description = NULL');
    expect(objUpdate).not.toContain('statut = NULL');
  });

  it('anonymise PMSMP (entreprise placeholder, siret/tuteur/bilan NULL) et la satisfaction (verbatims + réponses vidées, note conservée)', async () => {
    const client = makeMockClient();
    await anonymizeEmployee(client, 5);
    const sqls = dataSql(client.calls);
    const pmsmpUpdate = sqls.find((s) => /^UPDATE insertion_pmsmp SET/i.test(s));
    expect(pmsmpUpdate).toContain("entreprise = 'ANONYMISÉ'");
    for (const c of ['siret = NULL', 'tuteur = NULL', 'bilan = NULL']) expect(pmsmpUpdate).toContain(c);
    const satUpdate = sqls.find((s) => /^UPDATE insertion_satisfaction_sortie SET/i.test(s));
    expect(satUpdate).toContain('suggestions = NULL');
    expect(satUpdate).toContain("reponses = '{}'::jsonb");
    expect(satUpdate).not.toContain('satisfaction_globale');
  });

  it('purge resultat des actions et les identifiants IAE nominatifs du salarié (pass_iae_number, france_travail_id)', async () => {
    const client = makeMockClient();
    await anonymizeEmployee(client, 5);
    const apUpdate = dataSql(client.calls).find((s) => /^UPDATE cip_action_plans SET/i.test(s));
    expect(apUpdate).toContain('resultat = NULL');
    const empUpdate = dataSql(client.calls).find((s) => /^UPDATE employees SET/i.test(s));
    expect(empUpdate).toContain('pass_iae_number');
    expect(empUpdate).toContain('france_travail_id');
    expect(empUpdate).toContain('eligibilite_criteres');
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

describe('anonymization — snapshots probants (revue Codex PR#73)', () => {
  it('purge insertion_milestones_history pour les entretiens du salarié anonymisé', async () => {
    const client = makeMockClient();
    await anonymizeEmployee(client, 5);
    const del = dataSql(client.calls).find((s) => /DELETE FROM insertion_milestones_history/i.test(s));
    expect(del).toBeDefined();
    expect(del).toMatch(/WHERE milestone_id IN \(SELECT id FROM insertion_milestones WHERE employee_id = \$1\)/);
  });
});

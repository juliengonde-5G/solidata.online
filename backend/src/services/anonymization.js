/**
 * Service d'anonymisation RGPD — source unique consommée par la route manuelle
 * (routes/rgpd.js) ET la purge automatique (services/scheduler.js), pour que
 * les deux couvrent EXACTEMENT le même périmètre de données personnelles.
 *
 * Principes :
 *  - transactionnel : les fonctions reçoivent un client pg DÉJÀ dans une
 *    transaction (BEGIN/COMMIT gérés par l'appelant) ;
 *  - exhaustif : identité, coordonnées, données de santé (RQTH), naissance,
 *    titres de séjour, salaire, verbatims d'insertion et de recrutement ;
 *  - non destructif des AGRÉGATS : on conserve les données non nominatives qui
 *    alimentent les KPI (type de contrat, dates, heures travaillées, scores de
 *    freins, classification de sortie…) — les tonnages/ETP/cohortes ne cassent
 *    pas ;
 *  - marqueur : first_name = 'ANONYME' (sentinelle historique utilisée par les
 *    gardes anti-retraitement des purges).
 *
 * Les noms de tables/colonnes sont des constantes internes (aucune entrée
 * utilisateur) ; les valeurs variables passent par des paramètres $n.
 */

// Colonnes réellement présentes sur une table (résilience aux bases anciennes :
// une colonne absente ne fait pas échouer toute la transaction).
async function existingColumns(client, table) {
  const r = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return new Set(r.rows.map((x) => x.column_name));
}

async function tableExists(client, table) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return r.rows.length > 0;
}

// UPDATE table SET <assignations présentes> WHERE id = $n.
// assignments : [{ col, value }] (paramétré) ou [{ col, raw }] (expression SQL
// contrôlée, ex. "NOW()", "CONCAT('EMPLOYE-', id)").
async function updateById(client, table, id, assignments) {
  const cols = await existingColumns(client, table);
  const sets = [];
  const params = [];
  for (const a of assignments) {
    if (!cols.has(a.col)) continue;
    if (a.raw !== undefined) {
      sets.push(`${a.col} = ${a.raw}`);
    } else {
      params.push(a.value);
      sets.push(`${a.col} = $${params.length}`);
    }
  }
  if (sets.length === 0) return;
  params.push(id);
  await client.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
}

// Passe à NULL les colonnes (nullable) présentes, filtrées par whereCol = val.
async function nullifyBy(client, table, whereCol, whereVal, nullCols) {
  if (!(await tableExists(client, table))) return;
  const cols = await existingColumns(client, table);
  if (!cols.has(whereCol)) return;
  const present = nullCols.filter((c) => cols.has(c));
  if (present.length === 0) return;
  const sets = present.map((c) => `${c} = NULL`).join(', ');
  await client.query(`UPDATE ${table} SET ${sets} WHERE ${whereCol} = $1`, [whereVal]);
}

async function deleteBy(client, table, whereCol, whereVal) {
  if (!(await tableExists(client, table))) return;
  const cols = await existingColumns(client, table);
  if (!cols.has(whereCol)) return;
  await client.query(`DELETE FROM ${table} WHERE ${whereCol} = $1`, [whereVal]);
}

/**
 * Anonymise un CANDIDAT (recrutement) : identité + tous les verbatims, et
 * supprime les évaluations sensibles (PCM, entretiens, mises en situation,
 * documents). Aligne la purge automatique sur la route manuelle.
 * @param {import('pg').PoolClient} client  client dans une transaction ouverte
 * @param {number|string} id
 */
async function anonymizeCandidate(client, id) {
  await updateById(client, 'candidates', id, [
    { col: 'first_name', value: 'ANONYME' },
    { col: 'last_name', raw: "CONCAT('CANDIDAT-', id)" },
    { col: 'email', value: null },
    { col: 'phone', value: null },
    { col: 'gender', value: null },
    { col: 'cv_file_path', value: null },
    { col: 'cv_raw_text', value: null },
    { col: 'source_email', value: null },
    { col: 'comment', value: null },
    { col: 'interviewer_name', value: null },
    { col: 'interview_comment', value: null },
    { col: 'practical_test_comment', value: null },
    { col: 'appointment_location', value: null },
    { col: 'updated_at', raw: 'NOW()' },
  ]);

  // Données rattachées : suppression (aucune valeur d'agrégat, contenu sensible).
  await deleteBy(client, 'candidate_skills', 'candidate_id', id);
  await deleteBy(client, 'pcm_sessions', 'candidate_id', id); // cascade answers + reports liés
  await deleteBy(client, 'pcm_reports', 'candidate_id', id);
  await deleteBy(client, 'recruitment_interviews', 'candidate_id', id); // freins/évaluations
  await deleteBy(client, 'mise_en_situation', 'candidate_id', id); // évaluations
  await deleteBy(client, 'recruitment_documents', 'candidate_id', id); // pièces personnelles
  await nullifyBy(client, 'candidate_history', 'candidate_id', id, ['comment']);
}

/**
 * Anonymise un EMPLOYÉ : identité, coordonnées, santé (RQTH), naissance,
 * titres de séjour, salaire, et purge les verbatims d'insertion (diagnostics,
 * jalons, plans d'action). Conserve les agrégats non nominatifs (type/dates de
 * contrat, scores de freins, classification de sortie, heures travaillées).
 * @param {import('pg').PoolClient} client  client dans une transaction ouverte
 * @param {number|string} id
 */
async function anonymizeEmployee(client, id) {
  await updateById(client, 'employees', id, [
    { col: 'first_name', value: 'ANONYME' },
    { col: 'last_name', raw: "CONCAT('EMPLOYE-', id)" },
    { col: 'email', value: null },
    { col: 'personal_email', value: null },
    { col: 'phone', value: null },
    { col: 'photo_path', value: null },
    { col: 'skills', raw: "'{}'" },
    // Naissance / identité
    { col: 'birth_name', value: null },
    { col: 'birth_date', value: null },
    { col: 'birth_city', value: null },
    { col: 'birth_country', value: null },
    { col: 'birth_department', value: null },
    { col: 'nationality', value: null },
    { col: 'gender', value: null },
    { col: 'civility', value: null },
    // Coordonnées
    { col: 'address', value: null },
    { col: 'city', value: null },
    { col: 'postal_code', value: null },
    { col: 'country', value: null },
    // Santé (catégorie particulière art. 9) + titres de séjour
    { col: 'disability_status', value: null },
    { col: 'residence_permit_type', value: null },
    { col: 'residence_permit_number', value: null },
    { col: 'residence_permit_renewal', value: null },
    { col: 'visite_medicale_date', value: null },
    { col: 'visite_medicale_due_date', value: null },
    { col: 'visite_medicale_resultat', value: null },
    { col: 'visite_medicale_notes', value: null },
    { col: 'last_medical_visit_date', value: null },
    // Rémunération / identifiants nominatifs
    { col: 'gross_salary', value: null },
    { col: 'siret', value: null },
    { col: 'seniority_date', value: null },
    { col: 'manager_name', value: null },
    { col: 'manager_malibou_id', value: null },
    { col: 'malibou_id', value: null },
    { col: 'prescripteur', value: null }, // texte libre (on garde prescripteur_id catégoriel)
    { col: 'is_active', raw: 'false' },
    { col: 'updated_at', raw: 'NOW()' },
  ]);

  // User applicatif éventuellement lié.
  await client.query(
    `UPDATE users SET first_name = 'ANONYME', last_name = CONCAT('USER-', id),
       email = CONCAT('anonyme-', id, '@supprime.local'), is_active = false
     WHERE id = (SELECT user_id FROM employees WHERE id = $1)`,
    [id]
  );

  // Diagnostic CIP — verbatims + détails santé/social ; on CONSERVE les scores
  // freins numériques (agrégats de cohorte).
  await nullifyBy(client, 'insertion_diagnostics', 'employee_id', id, [
    'parcours_anterieur', 'contraintes_sante', 'contraintes_mobilite', 'contraintes_familiales', 'autres_contraintes',
    'frein_mobilite_detail', 'frein_sante_detail', 'frein_finances_detail', 'frein_famille_detail',
    'frein_linguistique_detail', 'frein_administratif_detail', 'frein_numerique_detail',
    'frein_mobilite_causes', 'frein_sante_causes', 'frein_finances_causes', 'frein_famille_causes',
    'frein_linguistique_causes', 'frein_administratif_causes', 'frein_numerique_causes',
    'obs_taches_realisees', 'obs_points_forts', 'obs_difficultes', 'obs_comportement_equipe', 'obs_autonomie_ponctualite',
    'pref_aime_faire', 'pref_ne_veut_plus', 'pref_environnement_prefere', 'pref_environnement_eviter', 'pref_objectifs',
    'explorama_interets', 'explorama_rejets', 'explorama_gestes_positifs', 'explorama_gestes_negatifs',
    'explorama_environnements', 'explorama_rythme', 'cip_hypotheses_metiers', 'cip_questions',
  ]);

  // Jalons — bilans/observations/sortie nominative ; on CONSERVE
  // milestone_type/status/dates/scores freins/sortie_classification/type/durée
  // (statistiques DREETS de sortie dynamique).
  await nullifyBy(client, 'insertion_milestones', 'employee_id', id, [
    'bilan_professionnel', 'bilan_social', 'objectifs_realises', 'objectifs_prochaine_periode',
    'observations', 'actions_a_mener', 'cip_integration', 'cip_competences', 'cip_projet_pro', 'cip_socialisation',
    'sortie_commentaires', 'sortie_employeur', 'sortie_formation', 'ai_recommendations',
  ]);

  // Plans d'action — action_label est NOT NULL → placeholder ; notes → NULL.
  if (await tableExists(client, 'cip_action_plans')) {
    const cols = await existingColumns(client, 'cip_action_plans');
    if (cols.has('employee_id') && cols.has('action_label')) {
      const sets = ["action_label = 'ANONYMISÉ'"];
      if (cols.has('notes')) sets.push('notes = NULL');
      await client.query(`UPDATE cip_action_plans SET ${sets.join(', ')} WHERE employee_id = $1`, [id]);
    }
  }
}

module.exports = { anonymizeCandidate, anonymizeEmployee };

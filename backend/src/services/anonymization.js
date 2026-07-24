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
    // Identifiants IAE nominatifs (2026-07) — les DATES de Pass restent (agrégats)
    { col: 'pass_iae_number', value: null },
    { col: 'france_travail_id', value: null },
    { col: 'eligibilite_criteres', value: null },
    { col: 'eligibilite_justificatifs_ref', value: null },
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
  // freins numériques (agrégats de cohorte) et les champs CATÉGORIELS des
  // rubriques structurées (logement_statut, ressources, situation_familiale,
  // niveau_formation… — typologies non nominatives des tableaux de bord).
  // ⚠ fse_entree est VOLONTAIREMENT CONSERVÉ : piste d'audit FSE+ ≥ 5 ans
  // après dernier paiement (addendum plan 05 §6bis-1) — exclue de
  // l'anonymisation à 2 ans, inscrite au registre RGPD et à l'AIPD.
  await nullifyBy(client, 'insertion_diagnostics', 'employee_id', id, [
    'parcours_anterieur', 'contraintes_sante', 'contraintes_mobilite', 'contraintes_familiales', 'autres_contraintes',
    'frein_mobilite_detail', 'frein_sante_detail', 'frein_finances_detail', 'frein_famille_detail',
    'frein_linguistique_detail', 'frein_administratif_detail', 'frein_numerique_detail',
    'frein_mobilite_causes', 'frein_sante_causes', 'frein_finances_causes', 'frein_famille_causes',
    'frein_linguistique_causes', 'frein_administratif_causes', 'frein_numerique_causes',
    // Nouveaux axes (2026-07) : logement + judiciaire (art. 10 — détail chiffré)
    'frein_logement_detail', 'frein_logement_causes', 'frein_judiciaire_detail',
    'obs_taches_realisees', 'obs_points_forts', 'obs_difficultes', 'obs_comportement_equipe', 'obs_autonomie_ponctualite',
    'pref_aime_faire', 'pref_ne_veut_plus', 'pref_environnement_prefere', 'pref_environnement_eviter', 'pref_objectifs',
    'explorama_interets', 'explorama_rejets', 'explorama_gestes_positifs', 'explorama_gestes_negatifs',
    'explorama_environnements', 'explorama_rythme', 'cip_hypotheses_metiers', 'cip_questions',
    // Rubriques structurées 2026-07 : textes libres + santé art. 9 (booleens
    // santé compris — alignés sur employees.disability_status déjà purgé)
    'commentaire_logement', 'commentaire_droits', 'commentaire_sante', 'commentaire_budget',
    'commentaire_mobilite', 'commentaire_projet', 'commentaire_linguistique',
    'metiers_souhaites', 'projet_formation', 'emploi_vise', 'emploi_vise_rome',
    'attentes_parcours', 'difficultes_exprimees', 'objectifs_exprimes', 'aide_souhaitee',
    'mutuelle_statut', 'rqth', 'rqth_fin', 'contre_indications', 'suivi_sante',
    'piece_identite_validite', 'questionnaire_detail',
    // Lot 8 (2026-07 PR3) — co-construction : SWOT / besoins / COA + portefeuille
    // de compétences + réponses du style d'apprentissage (verbatims / JSONB
    // nominatifs). On CONSERVE style_apprentissage (catégoriel non nominatif —
    // agrégat de cohorte, même doctrine que les scores de freins).
    'swot_atouts', 'swot_faiblesses', 'swot_opportunites', 'swot_menaces',
    'besoins_exprimes', 'coa_texte', 'savoir_faire', 'savoir_etre',
    'portefeuille_interets', 'portefeuille_competences', 'style_apprentissage_reponses',
  ]);

  // Jalons — bilans/observations/sortie nominative ; on CONSERVE
  // milestone_type/titre/status/dates/scores freins/sortie_classification/type/
  // durée (statistiques DREETS de sortie dynamique), renouvellement_avis/durée
  // et post_sortie_situation (catégoriels agrégés).
  // ⚠ fse_sortie est VOLONTAIREMENT CONSERVÉ (piste d'audit FSE+ ≥ 5 ans —
  // même doctrine que fse_entree ci-dessus).
  await nullifyBy(client, 'insertion_milestones', 'employee_id', id, [
    'bilan_professionnel', 'bilan_social', 'objectifs_realises', 'objectifs_prochaine_periode',
    'observations', 'actions_a_mener', 'cip_integration', 'cip_competences', 'cip_projet_pro', 'cip_socialisation',
    'sortie_commentaires', 'sortie_employeur', 'sortie_formation', 'ai_recommendations',
    // Nouveaux JSONB / textes 2026-07 (verbatims, validations nominatives,
    // préparation IA, formulaire de renouvellement, remise tracée)
    'previous_review', 'validations', 'ia_preparation', 'renouvellement_form',
    'sortie_documents', 'remise_salarie', 'post_sortie_commentaire',
    // Lot 8 (2026-07 PR3) — formulaire de période d'essai (avis encadrant/CIP).
    // On CONSERVE periode_essai_decision (catégoriel agrégé : rupture vs confirmé).
    'periode_essai_form',
  ]);

  // Snapshots probants (insertion_milestones_history) : ils contiennent la
  // ligne complète AVANT anonymisation (verbatims inclus) → purge intégrale
  // pour ce salarié (revue Codex PR#73). Le RGPD prime sur l'audit interne ;
  // les données FSE+ survivent sur les lignes vivantes (fse_entree/fse_sortie
  // conservés ci-dessus), jamais via l'historique.
  if (await tableExists(client, 'insertion_milestones_history')) {
    await client.query(
      `DELETE FROM insertion_milestones_history
       WHERE milestone_id IN (SELECT id FROM insertion_milestones WHERE employee_id = $1)`,
      [id]
    );
  }

  // Plans d'action — action_label est NOT NULL → placeholder ; notes/resultat → NULL.
  if (await tableExists(client, 'cip_action_plans')) {
    const cols = await existingColumns(client, 'cip_action_plans');
    if (cols.has('employee_id') && cols.has('action_label')) {
      const sets = ["action_label = 'ANONYMISÉ'"];
      if (cols.has('notes')) sets.push('notes = NULL');
      if (cols.has('resultat')) sets.push('resultat = NULL');
      await client.query(`UPDATE cip_action_plans SET ${sets.join(', ')} WHERE employee_id = $1`, [id]);
    }
  }

  // Objectifs individualisés (2026-07) — titre NOT NULL → placeholder,
  // description → NULL ; statuts/échéances conservés (agrégats).
  if (await tableExists(client, 'insertion_objectifs')) {
    const cols = await existingColumns(client, 'insertion_objectifs');
    if (cols.has('employee_id') && cols.has('titre')) {
      const sets = ["titre = 'ANONYMISÉ'"];
      if (cols.has('description')) sets.push('description = NULL');
      await client.query(`UPDATE insertion_objectifs SET ${sets.join(', ')} WHERE employee_id = $1`, [id]);
    }
  }

  // PMSMP (2026-07) — entreprise NOT NULL → placeholder ; tuteur/bilan/siret →
  // NULL ; dates/objet conservés (agrégats de volumétrie).
  if (await tableExists(client, 'insertion_pmsmp')) {
    const cols = await existingColumns(client, 'insertion_pmsmp');
    if (cols.has('employee_id') && cols.has('entreprise')) {
      const sets = ["entreprise = 'ANONYMISÉ'"];
      for (const c of ['siret', 'tuteur', 'bilan', 'convention_ref']) if (cols.has(c)) sets.push(`${c} = NULL`);
      await client.query(`UPDATE insertion_pmsmp SET ${sets.join(', ')} WHERE employee_id = $1`, [id]);
    }
  }

  // Grilles de compétences (2026-07 Lot 8) — observations/objectifs libres et
  // synthèse/validations nominatives → NULL ; on CONSERVE les NOTES /10 et le
  // marqueur non_evalue (agrégats de progression, même doctrine que les freins).
  if (await tableExists(client, 'insertion_competence_evaluations')) {
    const cols = await existingColumns(client, 'insertion_competence_evaluations');
    if (cols.has('employee_id')) {
      const sets = [];
      for (const c of ['synthese', 'validations']) if (cols.has(c)) sets.push(`${c} = NULL`);
      if (sets.length > 0) {
        await client.query(`UPDATE insertion_competence_evaluations SET ${sets.join(', ')} WHERE employee_id = $1`, [id]);
      }
    }
  }
  if (await tableExists(client, 'insertion_competence_scores')) {
    const cols = await existingColumns(client, 'insertion_competence_scores');
    if (cols.has('evaluation_id') && (cols.has('observation') || cols.has('objectif'))) {
      const sets = [];
      for (const c of ['observation', 'objectif']) if (cols.has(c)) sets.push(`${c} = NULL`);
      await client.query(
        `UPDATE insertion_competence_scores SET ${sets.join(', ')}
         WHERE evaluation_id IN (SELECT id FROM insertion_competence_evaluations WHERE employee_id = $1)`,
        [id]
      );
    }
  }

  // Checklist d'embauche (2026-07 Lot 8) — les responsables (noms) vivent dans
  // le JSONB items → reset à {} (retire aussi les dates de remise, non
  // structurelles). La ligne subsiste (marqueur d'existence).
  if (await tableExists(client, 'insertion_checklist_embauche')) {
    const cols = await existingColumns(client, 'insertion_checklist_embauche');
    if (cols.has('employee_id') && cols.has('items')) {
      await client.query(`UPDATE insertion_checklist_embauche SET items = '{}'::jsonb WHERE employee_id = $1`, [id]);
    }
  }

  // Satisfaction de sortie (2026-07) — verbatims → NULL, réponses détaillées
  // vidées ; satisfaction_globale + situation_sortie conservées (agrégats qualité).
  if (await tableExists(client, 'insertion_satisfaction_sortie')) {
    const cols = await existingColumns(client, 'insertion_satisfaction_sortie');
    if (cols.has('employee_id')) {
      const sets = [];
      for (const c of ['suggestions', 'avis_transmis']) if (cols.has(c)) sets.push(`${c} = NULL`);
      if (cols.has('reponses')) sets.push(`reponses = '{}'::jsonb`);
      if (sets.length > 0) {
        await client.query(`UPDATE insertion_satisfaction_sortie SET ${sets.join(', ')} WHERE employee_id = $1`, [id]);
      }
    }
  }
}

module.exports = { anonymizeCandidate, anonymizeEmployee };

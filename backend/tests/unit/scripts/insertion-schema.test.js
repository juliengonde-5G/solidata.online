/**
 * Anti-régression Vague 3 (ITEM 3.D-2) — Unification du schéma insertion.
 *
 * Garde l'invariant : backend/src/scripts/init-db.js est la SOURCE UNIQUE des
 * tables insertion (insertion_diagnostics / insertion_milestones). L'ancienne
 * IIFE d'auto-migration divergente de routes/insertion/index.js a été retirée
 * et TOUTES les colonnes qu'elle garantissait sont couvertes de façon
 * idempotente par init-db.js.
 *
 * Test 100 % statique (lecture de fichiers) — ne touche pas la base de données.
 */
const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..'); // → backend/
const initDbSrc = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'scripts', 'init-db.js'), 'utf8');
const insertionIndexSrc = fs.readFileSync(path.join(BACKEND_ROOT, 'src', 'routes', 'insertion', 'index.js'), 'utf8');

// Colonnes écrites par PUT /diagnostic (routes/insertion/routes.js — INSERT/UPDATE).
const DIAG_COLS = [
  'created_by', 'updated_by', 'updated_at',
  'parcours_anterieur', 'contraintes_sante', 'contraintes_mobilite', 'contraintes_familiales', 'autres_contraintes',
  'frein_mobilite', 'frein_mobilite_detail', 'frein_mobilite_causes',
  'frein_sante', 'frein_sante_detail', 'frein_sante_causes',
  'frein_finances', 'frein_finances_detail', 'frein_finances_causes',
  'frein_famille', 'frein_famille_detail', 'frein_famille_causes',
  'frein_linguistique', 'frein_linguistique_detail', 'frein_linguistique_causes',
  'frein_administratif', 'frein_administratif_detail', 'frein_administratif_causes',
  'frein_numerique', 'frein_numerique_detail', 'frein_numerique_causes',
  'obs_taches_realisees', 'obs_points_forts', 'obs_difficultes', 'obs_comportement_equipe', 'obs_autonomie_ponctualite',
  'pref_aime_faire', 'pref_ne_veut_plus', 'pref_environnement_prefere', 'pref_environnement_eviter', 'pref_objectifs',
  'explorama_interets', 'explorama_rejets', 'explorama_gestes_positifs', 'explorama_gestes_negatifs',
  'explorama_environnements', 'explorama_rythme',
  'cip_hypotheses_metiers', 'cip_questions',
];

// Colonnes milestones rapatriées de l'IIFE addMsCol (ajoutées après la table
// d'origine — doivent être migrées idempotemment pour les bases anciennes).
const MS_CATCHUP_COLS = [
  'frein_numerique', 'cip_integration', 'cip_competences', 'cip_projet_pro', 'cip_socialisation',
  'sortie_classification', 'sortie_type', 'sortie_commentaires', 'sortie_employeur', 'sortie_formation',
  'ai_recommendations',
];

describe('insertion schema — IIFE retirée de routes/insertion/index.js', () => {
  test('plus aucun CREATE TABLE insertion_* dans index.js', () => {
    expect(insertionIndexSrc).not.toMatch(/CREATE TABLE IF NOT EXISTS insertion_diagnostics/);
    expect(insertionIndexSrc).not.toMatch(/CREATE TABLE IF NOT EXISTS insertion_milestones/);
    expect(insertionIndexSrc).not.toMatch(/CREATE TABLE IF NOT EXISTS cip_action_plans/);
    expect(insertionIndexSrc).not.toMatch(/CREATE TABLE IF NOT EXISTS insertion_interview_alerts/);
  });

  test('plus de logique de migration (addCol/addMsCol/pool) dans index.js', () => {
    expect(insertionIndexSrc).not.toMatch(/addMsCol/);
    expect(insertionIndexSrc).not.toMatch(/ALTER TABLE insertion_/);
    // pool n'est plus requis (la seule utilisation était la migration).
    expect(insertionIndexSrc).not.toMatch(/config\/database/);
  });

  test('le vestige « Bilan M+2 » est purgé de index.js', () => {
    expect(insertionIndexSrc).not.toMatch(/Bilan M\+2/);
  });

  test('index.js reste un pur montage de routeur (authorize + mount)', () => {
    expect(insertionIndexSrc).toMatch(/authorize\('ADMIN', 'RH', 'MANAGER'\)/);
    expect(insertionIndexSrc).toMatch(/require\('\.\/routes'\)/);
    expect(insertionIndexSrc).toMatch(/module\.exports = router/);
  });
});

describe('insertion schema — init-db.js est la source unique', () => {
  test('init-db.js définit les 4 tables insertion', () => {
    expect(initDbSrc).toMatch(/CREATE TABLE IF NOT EXISTS insertion_diagnostics/);
    expect(initDbSrc).toMatch(/CREATE TABLE IF NOT EXISTS insertion_milestones/);
    expect(initDbSrc).toMatch(/CREATE TABLE IF NOT EXISTS cip_action_plans/);
    expect(initDbSrc).toMatch(/CREATE TABLE IF NOT EXISTS insertion_interview_alerts/);
  });

  test('init-db.js migre (idempotent, ADD COLUMN IF NOT EXISTS) toutes les colonnes diagnostics du PUT', () => {
    for (const col of DIAG_COLS) {
      expect(initDbSrc).toContain(`ALTER TABLE insertion_diagnostics ADD COLUMN IF NOT EXISTS ${col} `);
    }
  });

  test('init-db.js migre (idempotent) les colonnes milestones rapatriées de l\'IIFE', () => {
    for (const col of MS_CATCHUP_COLS) {
      expect(initDbSrc).toContain(`ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS ${col} `);
    }
  });

  test('les colonnes DREETS/FSE+ sortie_employeur_siret / sortie_duree_contrat_mois sont couvertes', () => {
    expect(initDbSrc).toMatch(/sortie_employeur_siret/);
    expect(initDbSrc).toMatch(/sortie_duree_contrat_mois/);
  });

  // ADAPTÉ (extension entretiens 2026-07, PR1) : l'invariant historique
  // « un seul jalon par (employee_id, milestone_type) » est VOLONTAIREMENT
  // levé — le modèle entretiens autorise N occurrences d'un même type. Ce
  // test vérifiait l'index unique global idx_milestones_emp_type_unique ;
  // il vérifie désormais son retrait effectif (DROP + plus aucune création,
  // plus de DELETE de « doublons » devenus légitimes) et son remplacement
  // par les index uniques PARTIELS accueil/sortie par parcours.
  test('l\'anti-doublon global (employee_id, milestone_type) est remplacé par les index partiels accueil/sortie', () => {
    expect(initDbSrc).toContain('DROP INDEX IF EXISTS idx_milestones_emp_type_unique');
    expect(initDbSrc).not.toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_milestones_emp_type_unique/);
    expect(initDbSrc).not.toMatch(/DELETE FROM insertion_milestones a USING insertion_milestones b/);
    expect(initDbSrc).toMatch(/idx_milestones_accueil_unique/);
    expect(initDbSrc).toMatch(/idx_milestones_sortie_unique/);
  });

  test('les colonnes employees.insertion_* sont migrées dans init-db.js', () => {
    expect(initDbSrc).toMatch(/insertion_status VARCHAR/);
    expect(initDbSrc).toMatch(/insertion_start_date DATE/);
    expect(initDbSrc).toMatch(/insertion_end_date DATE/);
  });

  test('les migrations diagnostics sont natively idempotentes (ADD COLUMN IF NOT EXISTS)', () => {
    // Aucun ADD COLUMN insertion_diagnostics sans IF NOT EXISTS (rejouable sans erreur).
    const bad = initDbSrc.match(/ALTER TABLE insertion_diagnostics ADD COLUMN (?!IF NOT EXISTS)/g);
    expect(bad).toBeNull();
  });
});

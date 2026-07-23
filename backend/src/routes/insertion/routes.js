/**
 * Routes insertion — Diagnostics, jalons, plans d'action, analyse
 * Extrait de insertion.js monolithique pour maintenabilité
 */
const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize, resolveBaseRole } = require('../../middleware/auth');
const { body, param, query } = require('express-validator');
const { validate } = require('../../middleware/validate');
const CryptoJS = require('crypto-js');
const {
  FREINS_DEFINITIONS, CIP_QUESTIONNAIRES, MILESTONE_TYPES, MILESTONE_TYPE_LABELS,
  milestoneLabel, analyzeInsertion, buildTimeline,
  computeCddiCumulativeMonths, resyncMilestones, generateMilestones,
  LEARNING_STYLES, computeLearningStyle, competenceAverage,
} = require('./engine');
const { FREINS, freinColumns, RADAR_AXES } = require('./freins-registry');
const { SENSITIVE_DIAG_FIELDS, encryptField, decryptField } = require('../../utils/field-crypto');
const { maskInsertionRow, maskInsertionRows, MANAGER_HIDDEN_FIELDS } = require('./masking');
const { readInsertionSetting } = require('../../utils/insertion-settings');
const { autoLogActivity } = require('../../middleware/activity-logger');
const { PMSMP_MAX_JOURS_CONVENTION, PMSMP_MAX_CUMUL_12M, pmsmpDays, computeCumul12MoisGlissants } = require('./pmsmp-rules');
const { ageBracket } = require('../../utils/pii-pseudonymize');

const PCM_KEY = process.env.PCM_ENCRYPTION_KEY || process.env.JWT_SECRET;
if (!PCM_KEY) {
  console.error('[FATAL] PCM_ENCRYPTION_KEY et JWT_SECRET non définis. Arrêt immédiat.');
  process.exit(1);
}

router.use(autoLogActivity('insertion'));

// Rôle de BASE de l'utilisateur courant (les rôles custom héritent des accès
// de leur modèle — corrige au passage la non-résolution historique, 03 §6.11).
function baseRoleOf(req) {
  return resolveBaseRole(req.user?.role);
}

// Parcours courant d'un salarié (RES-05 : unicité scopée par parcours).
async function currentParcoursNum(db, employeeId) {
  const r = await db.query('SELECT COALESCE(parcours_num, 1) AS pn FROM employees WHERE id = $1', [employeeId]);
  return r.rows[0] ? Number(r.rows[0].pn) : 1;
}

// Snapshot probant d'un entretien dans insertion_milestones_history
// (RES-02 : verrouillage probant, pattern refashion_dpav_history).
async function snapshotMilestone(db, row, action, userId, motif = null) {
  await db.query(
    `INSERT INTO insertion_milestones_history (milestone_id, snapshot, action, changed_by, motif)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.id, JSON.stringify(row), action, userId || null, motif]
  );
}

// Déchiffre en place les champs sensibles d'une ligne de diagnostic
// (lecture ADMIN/RH ; un MANAGER ne les voit jamais — masking.js).
function decryptDiagRow(row) {
  if (!row) return row;
  for (const f of SENSITIVE_DIAG_FIELDS) {
    if (row[f] !== undefined) row[f] = decryptField(row[f]);
  }
  return row;
}

// Nouvelle définition unifiée des sorties dynamiques (D8/EXG-06) :
// remplace l'ancien binaire sortie_classification = 'positive'.
const DYNAMIC_SORTIE_CLASSES = ['emploi_durable', 'emploi_transition', 'sortie_positive'];
const SORTIE_CLASSES = [...DYNAMIC_SORTIE_CLASSES, 'autre'];

// GET /api/insertion — Vue d'ensemble de tous les employés actifs
// IMPORTANT: doit etre AVANT /:employeeId pour ne pas etre intercepte
router.get('/', async (req, res) => {
  try {
    // Detecter quelles tables existent pour adapter la requete
    const tablesCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('employee_contracts', 'pcm_reports', 'insertion_diagnostics')
    `);
    const existingTables = new Set(tablesCheck.rows.map(r => r.table_name));

    let subqueries = '';
    if (existingTables.has('employee_contracts')) {
      subqueries += `,
        COALESCE((SELECT COUNT(*)::int FROM employee_contracts WHERE employee_id = e.id), 0) as nb_contracts,
        (SELECT ec.contract_type FROM employee_contracts ec WHERE ec.employee_id = e.id AND ec.is_current = true LIMIT 1) as current_contract_type,
        (SELECT ec.end_date FROM employee_contracts ec WHERE ec.employee_id = e.id AND ec.is_current = true LIMIT 1) as contract_end_date`;
    } else {
      subqueries += `, 0 as nb_contracts, e.contract_type as current_contract_type, e.contract_end as contract_end_date`;
    }
    if (existingTables.has('pcm_reports')) {
      subqueries += `,
        CASE WHEN e.candidate_id IS NOT NULL THEN
          COALESCE((SELECT COUNT(*)::int FROM pcm_reports pr WHERE pr.candidate_id = e.candidate_id), 0)
        ELSE 0 END as has_pcm`;
    } else {
      subqueries += `, 0 as has_pcm`;
    }
    if (existingTables.has('insertion_diagnostics')) {
      subqueries += `,
        COALESCE((SELECT COUNT(*)::int FROM insertion_diagnostics diag WHERE diag.employee_id = e.id), 0) as has_diagnostic`;
    } else {
      subqueries += `, 0 as has_diagnostic`;
    }

    const result = await pool.query(`
      SELECT e.id, e.first_name, e.last_name, e.is_active,
        t.name as team_name, e.position, e.contract_type, e.contract_start, e.contract_end
        ${subqueries}
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      WHERE e.is_active = true
      ORDER BY e.last_name, e.first_name
    `);

    const now = new Date();
    const employees = result.rows.map(e => {
      let urgency = null;
      if (e.contract_end_date) {
        const days = Math.round((new Date(e.contract_end_date) - now) / 86400000);
        if (days <= 30) urgency = 'critique';
        else if (days <= 60) urgency = 'attention';
      }
      return { ...e, urgency, has_pcm: e.has_pcm > 0, has_diagnostic: e.has_diagnostic > 0 };
    });

    console.log(`[INSERTION] GET / → ${employees.length} salaries actifs`);
    res.json(employees);
  } catch (err) {
    console.error('[INSERTION] Erreur liste :', err.message, err.detail || '');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/freins-definitions — Référentiel des freins (pour le frontend)
router.get('/freins-definitions', (req, res) => {
  res.json(FREINS_DEFINITIONS);
});

// GET /api/insertion/diagnostic/:employeeId — Récupérer le diagnostic CIP
// (parcours courant par défaut ; ?parcours=N pour un parcours antérieur).
// ADMIN/RH : champs sensibles DÉCHIFFRÉS ; MANAGER : champs sensibles RETIRÉS.
router.get('/diagnostic/:employeeId', async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    if (Number.isNaN(empId)) return res.status(400).json({ error: 'ID employé invalide' });
    const pn = req.query.parcours
      ? parseInt(req.query.parcours, 10)
      : await currentParcoursNum(pool, empId);
    const result = await pool.query(
      'SELECT * FROM insertion_diagnostics WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2',
      [empId, pn || 1]
    );
    const row = result.rows[0] || null;
    if (!row) return res.json(null);
    const baseRole = baseRoleOf(req);
    if (baseRole === 'MANAGER') maskInsertionRow(row, baseRole);
    else decryptDiagRow(row);
    res.json(row);
  } catch (err) {
    console.error('[INSERTION] Erreur diagnostic GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Champs éditables du diagnostic (extension 2026-07 PR1) ──
// Le PUT n'écrit plus l'intégralité des colonnes : il met à jour UNIQUEMENT
// les champs PRÉSENTS dans le body (support du stepper « sauvegarde auto »
// rubrique par rubrique, statut_saisie en_cours/complet — REC-UX-01) et
// accepte explicitement null pour effacer une valeur.
const DIAG_FREIN_SCORE_FIELDS = FREINS.map((f) => f.column); // frein_mobilite … frein_judiciaire
const DIAG_TEXT_FIELDS = [
  // Historique
  'parcours_anterieur', 'contraintes_sante', 'contraintes_mobilite', 'contraintes_familiales', 'autres_contraintes',
  ...FREINS.flatMap((f) => (f.key === 'judiciaire'
    ? [`${f.column}_detail`] // pas de colonne _causes pour le judiciaire (minimisation art. 10)
    : [`${f.column}_detail`, `${f.column}_causes`])),
  'obs_taches_realisees', 'obs_points_forts', 'obs_difficultes', 'obs_comportement_equipe', 'obs_autonomie_ponctualite',
  'pref_aime_faire', 'pref_ne_veut_plus', 'pref_environnement_prefere', 'pref_environnement_eviter', 'pref_objectifs',
  'explorama_interets', 'explorama_rejets', 'explorama_gestes_positifs', 'explorama_gestes_negatifs',
  'explorama_environnements', 'explorama_rythme', 'cip_hypotheses_metiers', 'cip_questions',
  // Rubriques structurées (trame officielle)
  'commentaire_logement', 'commentaire_droits', 'commentaire_sante', 'commentaire_budget', 'commentaire_mobilite',
  'commentaire_projet', 'commentaire_linguistique',
  'metiers_souhaites', 'projet_formation', 'emploi_vise',
  'attentes_parcours', 'difficultes_exprimees', 'objectifs_exprimes', 'aide_souhaitee',
  // Lot 8 (PR3) — co-construction : SWOT / besoins / COA (EXG-28), savoir-faire
  // et savoir-être du portefeuille de compétences (EXG-32). Non sensibles.
  'swot_atouts', 'swot_faiblesses', 'swot_opportunites', 'swot_menaces',
  'besoins_exprimes', 'coa_texte', 'savoir_faire', 'savoir_etre',
];
const DIAG_ENUM_FIELDS = {
  logement_statut: ['locataire_social', 'locataire_prive', 'proprietaire', 'heberge', 'sans_abri'],
  permis_b_statut: ['oui', 'non', 'code_en_cours', 'conduite_en_cours'],
  situation_familiale: ['marie', 'celibataire', 'en_couple', 'divorce', 'veuf'],
  statut_saisie: ['en_cours', 'complet'],
  niveau_formation: null,   // nomenclature contrôlée applicativement côté front (infra3…niv6plus)
  mutuelle_statut: null,
  pret_a_se_former: null,
  cecrl_niveau: null,
  emploi_vise_rome: null,
  // Lot 8 (PR3) — style d'apprentissage Kolb (EXG-32) : 4 profils.
  style_apprentissage: LEARNING_STYLES,
};
const DIAG_BOOL_FIELDS = [
  'logement_satisfaction', 'allocataire_caf', 'rqth', 'contre_indications', 'suivi_sante',
  'difficultes_financieres', 'credits_en_cours', 'vehicule', 'autre_employeur',
  'souhait_complement_heures', 'cpf_accessible', 'enfants_a_charge',
];
const DIAG_DATE_FIELDS = ['piece_identite_validite', 'rqth_fin'];
const DIAG_NUM_FIELDS = ['autre_employeur_heures', 'nb_enfants'];
const DIAG_ARRAY_FIELDS = ['ressources', 'moyen_transport'];
const DIAG_JSONB_FIELDS = ['questionnaire_detail', 'fse_entree',
  // Lot 8 (PR3) — portefeuille de compétences (cases cochées) + réponses au
  // questionnaire 24 items du style d'apprentissage (EXG-32).
  'portefeuille_interets', 'portefeuille_competences', 'style_apprentissage_reponses'];

const ALL_DIAG_FIELDS = [
  ...DIAG_FREIN_SCORE_FIELDS, ...DIAG_TEXT_FIELDS, ...Object.keys(DIAG_ENUM_FIELDS),
  ...DIAG_BOOL_FIELDS, ...DIAG_DATE_FIELDS, ...DIAG_NUM_FIELDS, ...DIAG_ARRAY_FIELDS, ...DIAG_JSONB_FIELDS,
];

/**
 * Suggestions de niveau de frein calculées CÔTÉ SERVEUR depuis les réponses
 * structurées du diagnostic (phase D — écart 1b). Source de vérité unique :
 * le pré-calcul local du frontend (DiagnosticForm) n'est plus qu'un repli.
 * Règles simples et documentées — la CIP confirme ou corrige TOUJOURS d'un
 * clic, une suggestion n'est jamais imposée ni enregistrée d'office :
 *  - logement    : sans_abri → 5 ; heberge → 4 ; insatisfaction → 3 ; statut stable → 1
 *  - mobilite    : ni permis ni véhicule ni transports en commun → 4 ;
 *                  ni permis ni véhicule → 3 ; permis en cours (code/conduite) → 3 ;
 *                  permis + véhicule → 1
 *  - finances    : difficultés + crédits en cours (risque surendettement) → 4 ;
 *                  difficultés seules → 3 ; pas de difficulté déclarée → 1
 *  - administratif : pièce d'identité expirée → 4
 *  - linguistique : CECRL A1 → 4 ; A2 → 3 ; B1 → 2 ; B2 et + → 1
 *  - sante       : contre-indications au poste → 3
 *  - famille     : enfant(s) à charge en foyer monoparental → 3
 * Aucune suggestion sur l'axe judiciaire (art. 10 — évaluation exclusivement
 * humaine) ni sur l'axe numérique (pas de réponse structurée support).
 * @param {object} d ligne de diagnostic (valeurs structurées en clair)
 * @returns {object} { axe: niveau_suggéré } — uniquement les axes suggérables
 */
function computeSuggestionsFreins(d) {
  if (!d || typeof d !== 'object') return {};
  const s = {};
  // Logement
  if (d.logement_statut === 'sans_abri') s.logement = 5;
  else if (d.logement_statut === 'heberge') s.logement = 4;
  else if (d.logement_satisfaction === false) s.logement = 3;
  else if (d.logement_statut) s.logement = 1;
  // Mobilité
  const transports = Array.isArray(d.moyen_transport) ? d.moyen_transport : [];
  if (d.permis_b_statut === 'non' && d.vehicule === false) {
    s.mobilite = transports.includes('transports_commun') ? 3 : 4;
  } else if (['code_en_cours', 'conduite_en_cours'].includes(d.permis_b_statut)) s.mobilite = 3;
  else if (d.permis_b_statut === 'oui' && d.vehicule) s.mobilite = 1;
  // Finances
  if (d.difficultes_financieres && d.credits_en_cours) s.finances = 4;
  else if (d.difficultes_financieres) s.finances = 3;
  else if (d.difficultes_financieres === false) s.finances = 1;
  // Administratif
  if (d.piece_identite_validite && new Date(d.piece_identite_validite) < new Date()) s.administratif = 4;
  // Linguistique
  if (d.cecrl_niveau === 'A1') s.linguistique = 4;
  else if (d.cecrl_niveau === 'A2') s.linguistique = 3;
  else if (d.cecrl_niveau === 'B1') s.linguistique = 2;
  else if (['B2', 'C1', 'C2'].includes(d.cecrl_niveau)) s.linguistique = 1;
  // Santé
  if (d.contre_indications) s.sante = 3;
  // Famille
  if (d.enfants_a_charge && ['celibataire', 'divorce', 'veuf'].includes(d.situation_familiale)) s.famille = 3;
  return s;
}

// PUT /api/insertion/diagnostic/:employeeId — Sauvegarder/mettre a jour le diagnostic
// Upsert par (employee_id, parcours_num) — contrainte insertion_diagnostics_employee_parcours_key.
router.put('/diagnostic/:employeeId', [
  param('employeeId').isInt().withMessage('ID employé invalide'),
  body('statut_saisie').optional({ nullable: true }).isIn(['en_cours', 'complet']).withMessage('statut_saisie invalide (en_cours/complet)'),
  ...FREINS.map((f) => body(f.column).optional({ nullable: true }).isInt({ min: 1, max: 5 }).withMessage(`${f.column} : niveau attendu entre 1 et 5`)),
], validate, async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    const baseRole = baseRoleOf(req);
    const d = { ...req.body };

    // Un MANAGER ne peut ni lire NI écrire les champs qui lui sont masqués
    // (frein judiciaire, détails santé, commentaire budget).
    if (baseRole === 'MANAGER') {
      for (const k of Object.keys(d)) {
        if (MANAGER_HIDDEN_FIELDS.includes(k) || k.startsWith('frein_judiciaire')) delete d[k];
      }
    }

    // Lot 8 (EXG-32) — style d'apprentissage : si le front envoie seulement les
    // 24 réponses A/B (style_apprentissage_reponses) sans le résultat, on le
    // calcule côté serveur (helper pur exposé) ; le front peut aussi le fournir.
    if (('style_apprentissage_reponses' in d) && !('style_apprentissage' in d) && d.style_apprentissage_reponses) {
      const st = computeLearningStyle(d.style_apprentissage_reponses);
      if (st) d.style_apprentissage = st;
    }

    const pn = await currentParcoursNum(pool, empId);

    // Construit dynamiquement les couples colonne/valeur des champs PRÉSENTS.
    const cols = [];
    const vals = [];
    const normalize = (field, v) => {
      if (v === undefined) return undefined;
      if (v === '') v = null;
      if (v === null) return null;
      if (DIAG_BOOL_FIELDS.includes(field)) return !!v;
      if (DIAG_ARRAY_FIELDS.includes(field)) return Array.isArray(v) ? v : [String(v)];
      if (DIAG_JSONB_FIELDS.includes(field)) return JSON.stringify(v);
      if (SENSITIVE_DIAG_FIELDS.includes(field)) return encryptField(v); // chiffrement applicatif (D9)
      return v;
    };
    for (const field of ALL_DIAG_FIELDS) {
      if (!(field in d)) continue;
      const enumVals = DIAG_ENUM_FIELDS[field];
      if (enumVals && d[field] != null && d[field] !== '' && !enumVals.includes(d[field])) {
        return res.status(400).json({ error: `Valeur invalide pour ${field}`, valeurs_acceptees: enumVals });
      }
      cols.push(field);
      vals.push(normalize(field, d[field]));
    }

    // Axes de freins ABSENTS de la requête : insérés explicitement à NULL à la
    // CRÉATION de la ligne uniquement (jamais réécrits à l'update) — neutralise
    // les DEFAULT 1 hérités du schéma historique (« non évalué » = NULL, pas 1).
    const freinNullCols = FREINS.map((f) => f.column).filter((c) => !cols.includes(c));
    const insertCols = ['employee_id', 'parcours_num', 'created_by', 'updated_by', ...cols, ...freinNullCols];
    const params = [empId, pn, req.user.id, req.user.id, ...vals, ...freinNullCols.map(() => null)];
    const placeholders = insertCols.map((_, i) => `$${i + 1}`);
    const updateSets = ['updated_by = $4', 'updated_at = NOW()',
      ...cols.map((c, i) => `${c} = $${i + 5}`)];

    const result = await pool.query(`
      INSERT INTO insertion_diagnostics (${insertCols.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (employee_id, parcours_num) DO UPDATE SET ${updateSets.join(', ')}
      RETURNING *
    `, params);

    const row = result.rows[0];
    if (baseRole === 'MANAGER') maskInsertionRow(row, baseRole);
    else decryptDiagRow(row);
    // Suggestions de freins recalculées sur la ligne COMPLÈTE après upsert
    // (toutes les réponses stockées, pas seulement celles du body) — le
    // frontend les surligne, la CIP décide (écart 1b).
    res.json({ ...row, suggestions_freins: computeSuggestionsFreins(row) });
  } catch (err) {
    console.error('[INSERTION] Erreur diagnostic PUT :', err.message, err.detail || '');
    // On expose le code SQLSTATE (sans détail sensible) pour rendre l'erreur
    // diagnosticable ; 42703 = colonne manquante (base non migrée),
    // 23514 = valeur rejetée par un CHECK SQL.
    if (err.code === '23514') {
      return res.status(400).json({ error: 'Valeur rejetée par une contrainte de la base', code: err.code, constraint: err.constraint });
    }
    const hint = err.code === '42703'
      ? 'Base non à jour (colonne manquante) — un redéploiement applique la migration.'
      : undefined;
    res.status(500).json({ error: 'Erreur serveur', code: err.code, hint });
  }
});

// GET /api/insertion/:employeeId — Analyse complète
// ══════════════════════════════════════════════════════════════
// JALONS INSERTION — Diagnostic accueil, M+3, M+6, M+10, Sortie
// ══════════════════════════════════════════════════════════════

// GET /api/insertion/milestones/:employeeId — Tous les entretiens d'un salarié
// (tous parcours confondus, triés par échéance ; MANAGER : frein judiciaire retiré).
router.get('/milestones/:employeeId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT im.*, u.first_name as interviewer_first, u.last_name as interviewer_last
       FROM insertion_milestones im
       LEFT JOIN users u ON im.interviewer_id = u.id
       WHERE im.employee_id = $1
       ORDER BY im.due_date`,
      [req.params.employeeId]
    );
    res.json(maskInsertionRows(result.rows, baseRoleOf(req)));
  } catch (err) {
    console.error('[INSERTION] Erreur milestones GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Effet de clôture / réouverture du parcours au bilan de sortie (préservé de
// l'ancien PUT — vigilance 03 §6.5). Idempotent.
async function applySortieParcoursEffect(db, ms, requestedStatus) {
  if (ms.milestone_type !== 'bilan_sortie') return;
  if (ms.status === 'realise') {
    await db.query(
      `UPDATE employees
         SET insertion_status = 'termine',
             insertion_end_date = COALESCE(insertion_end_date, $2::date, contract_end, CURRENT_DATE),
             updated_at = NOW()
       WHERE id = $1 AND insertion_status <> 'termine'`,
      [ms.employee_id, ms.completed_date || null]
    );
  } else if (requestedStatus && requestedStatus !== 'realise') {
    // Retour arrière : le bilan de sortie n'est plus « réalisé » → rouvre le
    // parcours précédemment clôturé par ce jalon (ne touche pas abandon/none).
    await db.query(
      `UPDATE employees
         SET insertion_status = 'en_parcours', insertion_end_date = NULL, updated_at = NOW()
       WHERE id = $1 AND insertion_status = 'termine'`,
      [ms.employee_id]
    );
  }
}

// Effet de clôture d'un entretien de période d'essai (Lot 8, EXG-30/PROP-03).
// Décision « rompu » → clôture propre du parcours (statut abandon + date de
// sortie) au lieu du parcours fantôme historique. « confirme »/« a_revoir » →
// le parcours continue (bascule officielle vers l'accompagnement). Idempotent.
async function applyPeriodeEssaiEffect(db, ms) {
  if (ms.milestone_type !== 'periode_essai') return;
  if (ms.periode_essai_decision === 'rompu' && ms.status === 'realise') {
    await db.query(
      `UPDATE employees
         SET insertion_status = 'abandon',
             insertion_end_date = COALESCE(insertion_end_date, $2::date, CURRENT_DATE),
             updated_at = NOW()
       WHERE id = $1 AND insertion_status = 'en_parcours'`,
      [ms.employee_id, ms.completed_date || null]
    );
  }
}

// POST /api/insertion/milestones — Créer un entretien
// Types TECHNIQUES (diagnostic_accueil, bilan_intermediaire, renouvellement,
// bilan_sortie, suivi_post_sortie). bilan_intermediaire : créable à toute date,
// titre auto « Bilan n° N ». renouvellement : liable à un contrat (contract_id).
// diagnostic_accueil / bilan_sortie : uniques par parcours (upsert de l'échéance).
router.post('/milestones', [
  body('employee_id').isInt().withMessage('ID employé requis'),
  body('milestone_type').isIn(MILESTONE_TYPES).withMessage(`Type d'entretien invalide (attendu : ${MILESTONE_TYPES.join(', ')})`),
  body('due_date').optional({ nullable: true }).isISO8601().withMessage('due_date invalide (AAAA-MM-JJ)'),
  body('contract_id').optional({ nullable: true }).isInt().withMessage('contract_id invalide'),
  body('titre').optional({ nullable: true }).isLength({ max: 120 }).withMessage('titre trop long (120 max)'),
], validate, async (req, res) => {
  try {
    const { employee_id, milestone_type, due_date, contract_id, previous_milestone_id } = req.body;

    // Garde ETI (RES-10, PR 2) : un MANAGER (encadrant technique) ne crée que
    // des entretiens de RENOUVELLEMENT (son volet — écran ETI phase B) ; tout
    // autre type reste réservé ADMIN/RH.
    if (baseRoleOf(req) === 'MANAGER' && milestone_type !== 'renouvellement') {
      return res.status(403).json({
        error: "Un encadrant (MANAGER) ne peut créer que des entretiens de renouvellement.",
      });
    }

    const due = due_date || new Date().toISOString().split('T')[0];
    const pn = await currentParcoursNum(pool, employee_id);

    // Lien renouvellement ↔ contrat : le contrat doit appartenir au salarié.
    let contractId = null;
    if (contract_id != null && contract_id !== '') {
      const c = await pool.query('SELECT id FROM employee_contracts WHERE id = $1 AND employee_id = $2', [contract_id, employee_id]);
      if (c.rows.length === 0) return res.status(400).json({ error: 'contract_id : contrat introuvable pour ce salarié' });
      contractId = c.rows[0].id;
    }

    // Unicité partielle : UN diagnostic d'accueil et UN bilan de sortie par
    // parcours (index idx_milestones_accueil_unique / idx_milestones_sortie_unique)
    // → upsert de l'échéance (comportement historique conservé).
    if (milestone_type === 'diagnostic_accueil' || milestone_type === 'bilan_sortie') {
      const ex = await pool.query(
        `SELECT * FROM insertion_milestones
         WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2 AND milestone_type = $3`,
        [employee_id, pn, milestone_type]
      );
      if (ex.rows.length > 0) {
        const upd = await pool.query(
          `UPDATE insertion_milestones SET due_date = COALESCE($1, due_date), updated_at = NOW()
           WHERE id = $2 RETURNING *`,
          [due_date || null, ex.rows[0].id]
        );
        return res.status(200).json(upd.rows[0]);
      }
    }

    // Titre : fourni > auto par type.
    let titre = (req.body.titre || '').trim() || null;
    if (!titre) {
      if (milestone_type === 'bilan_intermediaire') {
        const n = await pool.query(
          `SELECT COUNT(*)::int AS n FROM insertion_milestones
           WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2 AND milestone_type = 'bilan_intermediaire'`,
          [employee_id, pn]
        );
        titre = `Bilan n° ${(n.rows[0]?.n || 0) + 1}`;
      } else if (milestone_type === 'renouvellement') {
        const moisAnnee = new Date(due).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
        titre = `Renouvellement ${moisAnnee}`;
      } else {
        titre = MILESTONE_TYPE_LABELS[milestone_type];
      }
    }

    const result = await pool.query(
      `INSERT INTO insertion_milestones
         (employee_id, parcours_num, milestone_type, titre, due_date, contract_id, previous_milestone_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [employee_id, pn, milestone_type, titre, due, contractId, previous_milestone_id || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Un entretien de ce type existe déjà pour ce parcours.' });
    }
    console.error('[INSERTION] Erreur milestones POST :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Champs éditables d'un entretien (PUT /milestones/:id) ──
// Fin du COALESCE intégral (03 §6.3) : seuls les champs PRÉSENTS dans le body
// sont écrits, et null est accepté (permet d'effacer une date, un frein…).
const MILESTONE_JSONB_FIELDS = ['previous_review', 'validations', 'renouvellement_form', 'sortie_documents', 'remise_salarie', 'fse_sortie', 'ai_recommendations', 'periode_essai_form'];
const MILESTONE_EDITABLE_FIELDS = [
  'status', 'titre', 'due_date', 'interview_date', 'interviewer_id', 'completed_date',
  ...FREINS.map((f) => f.column),
  'cip_integration', 'cip_competences', 'cip_projet_pro', 'cip_socialisation',
  'bilan_professionnel', 'bilan_social', 'objectifs_realises', 'objectifs_prochaine_periode',
  'observations', 'actions_a_mener', 'avis_global',
  'sortie_classification', 'sortie_type', 'sortie_commentaires', 'sortie_employeur',
  'sortie_formation', 'sortie_employeur_siret', 'sortie_duree_contrat_mois',
  'previous_milestone_id', 'contract_id',
  'renouvellement_avis', 'renouvellement_duree_mois',
  'post_sortie_situation', 'post_sortie_commentaire',
  'periode_essai_decision', // Lot 8 (PR3) — décision de période d'essai
  ...MILESTONE_JSONB_FIELDS,
];

// PUT /api/insertion/milestones/:id — Mettre à jour un entretien
// REFUS si l'entretien est verrouillé (locked_at — clôture probante RES-02) → 409.
// Un UPDATE sur un entretien déjà « realise » (hors clôture) est historisé
// (snapshot 'update' dans insertion_milestones_history).
router.put('/milestones/:id', [
  param('id').isInt().withMessage('ID invalide'),
  body('status').optional({ nullable: true }).isIn(['a_planifier', 'planifie', 'realise', 'reporte']).withMessage('status invalide'),
  body('sortie_classification').optional({ nullable: true }).isIn(SORTIE_CLASSES).withMessage(`sortie_classification invalide (attendu : ${SORTIE_CLASSES.join(', ')})`),
  body('renouvellement_avis').optional({ nullable: true }).isIn(['favorable', 'favorable_reserves', 'defavorable']).withMessage('renouvellement_avis invalide'),
  body('post_sortie_situation').optional({ nullable: true }).isIn(['emploi_durable', 'emploi_transition', 'formation', 'recherche_emploi', 'autre', 'injoignable']).withMessage('post_sortie_situation invalide'),
  body('periode_essai_decision').optional({ nullable: true }).isIn(['confirme', 'rompu', 'a_revoir']).withMessage('periode_essai_decision invalide (confirme, rompu, a_revoir)'),
  ...FREINS.map((f) => body(f.column).optional({ nullable: true }).isInt({ min: 1, max: 5 }).withMessage(`${f.column} : niveau attendu entre 1 et 5`)),
], validate, async (req, res) => {
  try {
    const d = req.body;

    // Garde ETI (RES-10, PR 2) : le PUT générique écrit TOUS les champs (dont
    // freins art. 9/10, bilans, sortie) → interdit à un MANAGER. Son écriture
    // passe EXCLUSIVEMENT par la route limitée
    // PUT /renouvellements/:milestoneId/formulaire (renouvellement_form + avis).
    if (baseRoleOf(req) === 'MANAGER') {
      return res.status(403).json({
        error: "Modification réservée ADMIN/RH.",
        hint: "Encadrant : utilisez le formulaire de renouvellement (PUT /api/insertion/renouvellements/:id/formulaire).",
      });
    }

    const before = await pool.query('SELECT * FROM insertion_milestones WHERE id = $1', [req.params.id]);
    if (before.rows.length === 0) return res.status(404).json({ error: 'Entretien non trouvé' });
    const prev = before.rows[0];

    if (prev.locked_at) {
      return res.status(409).json({
        error: 'Entretien clôturé et verrouillé — modification refusée.',
        hint: "Réouvrir d'abord l'entretien (POST /milestones/:id/reopen, ADMIN/RH, motif obligatoire).",
        locked_at: prev.locked_at,
      });
    }

    const sets = [];
    const vals = [];
    for (const field of MILESTONE_EDITABLE_FIELDS) {
      if (!(field in d)) continue;
      let v = d[field] === '' ? null : d[field];
      if (v != null && MILESTONE_JSONB_FIELDS.includes(field)) v = JSON.stringify(v);
      vals.push(v);
      sets.push(`${field} = $${vals.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

    // Historisation : modification d'un entretien déjà réalisé (hors clôture).
    if (prev.status === 'realise') {
      await snapshotMilestone(pool, prev, 'update', req.user.id);
    }

    vals.push(req.params.id);
    const result = await pool.query(
      `UPDATE insertion_milestones SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    const ms = result.rows[0];

    await applySortieParcoursEffect(pool, ms, d.status);

    res.json(maskInsertionRow(ms, baseRoleOf(req)));
  } catch (err) {
    if (err.code === '23514') {
      return res.status(400).json({ error: 'Valeur rejetée par une contrainte de la base', code: err.code, constraint: err.constraint });
    }
    console.error('[INSERTION] Erreur milestones PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/insertion/milestones/:id/close — CLÔTURE CONTRÔLÉE d'un entretien
// (REC-UX-02 : « Enregistrer » = PUT brouillon, « Clôturer » = contrôles + verrou).
// Contrôles : freins évalués (ou non-évaluation ASSUMÉE via assume_freins_non_evalues),
// previous_review renseignée si un entretien réalisé antérieur existe, prochain
// entretien « planifie » (existant ou créé via body.next) sauf bilan de sortie /
// suivi post-sortie, catégorie de sortie + check-list documents si bilan_sortie.
// Effets : snapshot probant 'close', status='realise' + completed_date + locked_at,
// clôture du parcours (bilan de sortie), resyncMilestones (EXG-16/22).
router.post('/milestones/:id/close', [
  param('id').isInt().withMessage('ID invalide'),
  body('completed_date').optional({ nullable: true }).isISO8601().withMessage('completed_date invalide'),
  body('next.milestone_type').optional().isIn(MILESTONE_TYPES).withMessage('next.milestone_type invalide'),
  body('next.due_date').optional().isISO8601().withMessage('next.due_date invalide'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT * FROM insertion_milestones WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Entretien non trouvé' });
    }
    const ms = cur.rows[0];
    if (ms.locked_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Entretien déjà clôturé (verrouillé).', hint: "Réouvrir d'abord (POST /milestones/:id/reopen)." });
    }

    const problems = [];

    // Lot 8 (EXG-30) — l'entretien de période d'essai a des contrôles ADAPTÉS :
    // pas d'exigence de freins (il précède le diagnostic social) ni de bilan
    // précédent (c'est le tout premier jalon), mais une DÉCISION obligatoire.
    const isPeriodeEssai = ms.milestone_type === 'periode_essai';

    // 1. Freins évalués — ou non-évaluation explicitement assumée par la CIP.
    //    (Non applicable à l'entretien de période d'essai.)
    if (!isPeriodeEssai) {
      const missing = FREINS.filter((f) => ms[f.column] == null).map((f) => f.key);
      if (missing.length > 0 && req.body.assume_freins_non_evalues !== true) {
        problems.push({
          code: 'freins_non_evalues',
          freins: missing,
          message: `Freins non évalués : ${missing.join(', ')}. Évaluez-les ou clôturez avec « assume_freins_non_evalues » (non-évaluation assumée).`,
        });
      }
    }

    // 2. Évaluation du bilan précédent (previous_review) si un entretien
    // réalisé antérieur existe sur ce parcours (REC-UX-03). Non exigée pour la
    // période d'essai (premier jalon du parcours).
    if (!isPeriodeEssai) {
      const prevRealise = await client.query(
        `SELECT id FROM insertion_milestones
         WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = COALESCE($2, 1)
           AND id <> $3 AND status = 'realise' LIMIT 1`,
        [ms.employee_id, ms.parcours_num, ms.id]
      );
      const pr = ms.previous_review;
      const prEmpty = pr == null || (Array.isArray(pr) && pr.length === 0);
      if (prevRealise.rows.length > 0 && prEmpty) {
        problems.push({
          code: 'previous_review_manquante',
          message: "Un entretien réalisé antérieur existe : l'évaluation du bilan précédent (previous_review) doit être renseignée avant la clôture.",
        });
      }
    }

    // 2bis. Période d'essai : décision obligatoire (confirme / rompu / a_revoir).
    if (isPeriodeEssai && !ms.periode_essai_decision) {
      problems.push({
        code: 'periode_essai_decision_manquante',
        message: "Décision de période d'essai obligatoire (confirme, rompu, a_revoir) avant la clôture.",
      });
    }

    // 3. Bilan de sortie : catégorie de sortie (nouvelle nomenclature) +
    // check-list des documents remis (EXG-07).
    if (ms.milestone_type === 'bilan_sortie') {
      if (!ms.sortie_classification) {
        problems.push({ code: 'sortie_classification_manquante', message: `Catégorie de sortie obligatoire (${SORTIE_CLASSES.join(', ')}).` });
      }
      if (ms.sortie_documents == null) {
        problems.push({ code: 'sortie_documents_manquants', message: 'Check-list des documents de sortie obligatoire (STC, certificat de travail, attestation France Travail).' });
      }
    }

    // 4. Prochain entretien « planifie » obligatoire (sauf sortie / post-sortie
    //    / période d'essai — pour cette dernière, le diagnostic d'accueil est
    //    déjà posé comme jalon suivant).
    let createdNext = null;
    if (!['bilan_sortie', 'suivi_post_sortie', 'periode_essai'].includes(ms.milestone_type)) {
      const nextPlanned = await client.query(
        `SELECT id FROM insertion_milestones
         WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = COALESCE($2, 1)
           AND id <> $3 AND status = 'planifie' LIMIT 1`,
        [ms.employee_id, ms.parcours_num, ms.id]
      );
      if (nextPlanned.rows.length === 0) {
        const next = req.body.next;
        if (next && next.milestone_type && next.due_date) {
          let titre = (next.titre || '').trim() || null;
          if (!titre && next.milestone_type === 'bilan_intermediaire') {
            const n = await client.query(
              `SELECT COUNT(*)::int AS n FROM insertion_milestones
               WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = COALESCE($2, 1) AND milestone_type = 'bilan_intermediaire'`,
              [ms.employee_id, ms.parcours_num]
            );
            titre = `Bilan n° ${(n.rows[0]?.n || 0) + 1}`;
          }
          if (!titre) titre = MILESTONE_TYPE_LABELS[next.milestone_type];
          const ins = await client.query(
            `INSERT INTO insertion_milestones
               (employee_id, parcours_num, milestone_type, titre, due_date, interview_date, status, previous_milestone_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'planifie', $7, $8) RETURNING *`,
            [ms.employee_id, ms.parcours_num || 1, next.milestone_type, titre, next.due_date,
              next.interview_date || null, ms.id, req.user.id]
          );
          createdNext = ins.rows[0];
        } else {
          problems.push({
            code: 'prochain_entretien_manquant',
            message: 'Planifiez le prochain entretien avant de clôturer (ou transmettez-le dans « next » : { milestone_type, due_date }).',
          });
        }
      }
    }

    if (problems.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Clôture refusée — contrôles non satisfaits.', problems });
    }

    // Clôture : réalise + verrouille (probant).
    const completedDate = req.body.completed_date || ms.completed_date || new Date().toISOString().split('T')[0];
    const closed = await client.query(
      `UPDATE insertion_milestones
         SET status = 'realise', completed_date = $1, locked_at = NOW(), updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [completedDate, ms.id]
    );
    // Snapshot de l'état VERROUILLÉ (l'état probant de référence).
    await snapshotMilestone(client, closed.rows[0], 'close', req.user.id);

    // Effet de clôture du parcours (bilan de sortie) — préservé (03 §6.5).
    await applySortieParcoursEffect(client, closed.rows[0], 'realise');
    // Effet de clôture de la période d'essai (Lot 8) : rupture → abandon.
    await applyPeriodeEssaiEffect(client, closed.rows[0]);

    await client.query('COMMIT');

    // Recalage des jalons après le bilan (EXG-16/22) — post-commit, best effort.
    let resync = null;
    try { resync = await resyncMilestones(pool, ms.employee_id, { userId: req.user.id }); }
    catch (e) { console.error('[INSERTION] resync post-clôture :', e.message); }

    res.json({ milestone: maskInsertionRow(closed.rows[0], baseRoleOf(req)), next: createdNext, resync });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[INSERTION] Erreur close milestone :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// POST /api/insertion/milestones/:id/reopen — RÉOUVERTURE tracée (ADMIN/RH)
// Motif obligatoire ; snapshot 'reopen' ; lève locked_at ; INVALIDE les
// validations (caducité — RES-02 : une réouverture rend caduques les
// validations horodatées, la trace reste dans l'historique).
router.post('/milestones/:id/reopen', authorize('ADMIN', 'RH'), [
  param('id').isInt().withMessage('ID invalide'),
  body('motif').isString().trim().notEmpty().withMessage('Motif de réouverture obligatoire'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query('SELECT * FROM insertion_milestones WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Entretien non trouvé' });
    }
    const ms = cur.rows[0];
    if (!ms.locked_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: "Cet entretien n'est pas verrouillé — rien à réouvrir." });
    }

    // Snapshot de l'état AVANT réouverture (conserve notamment les validations).
    await snapshotMilestone(client, ms, 'reopen', req.user.id, req.body.motif.trim());

    const reopened = await client.query(
      `UPDATE insertion_milestones
         SET locked_at = NULL, validations = NULL, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [ms.id]
    );
    await client.query('COMMIT');
    res.json(maskInsertionRow(reopened.rows[0], baseRoleOf(req)));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[INSERTION] Erreur reopen milestone :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// GET /api/insertion/milestones/:employeeId/radar — Données radar chart (évolution freins)
// 9 axes depuis freins-registry ; NULL HONNÊTE (un frein non évalué n'est plus
// tracé à 1 — le frontend saute les points null) ; MANAGER : axe judiciaire ABSENT.
router.get('/milestones/:employeeId/radar', async (req, res) => {
  try {
    const empId = req.params.employeeId;
    const baseRole = baseRoleOf(req);
    const regs = baseRole === 'MANAGER' ? FREINS.filter((f) => f.key !== 'judiciaire') : FREINS;
    const axeKeys = regs.map((f) => f.column);
    const axes = RADAR_AXES.filter((_, i) => baseRole !== 'MANAGER' || FREINS[i].key !== 'judiciaire');
    const colsSql = axeKeys.join(', ');

    // Diagnostic initial (parcours courant)
    const pn = await currentParcoursNum(pool, empId);
    const diagRes = await pool.query(
      `SELECT ${colsSql} FROM insertion_diagnostics WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2`,
      [empId, pn]
    );

    // Entretiens réalisés portant AU MOINS un frein évalué
    const milestonesRes = await pool.query(
      `SELECT milestone_type, titre, completed_date, ${freinColumns().join(', ')}
       FROM insertion_milestones
       WHERE employee_id = $1 AND status = 'realise'
         AND COALESCE(${freinColumns().join(', ')}) IS NOT NULL
       ORDER BY due_date`,
      [empId]
    );

    const series = [];

    // Série initiale (diagnostic)
    if (diagRes.rows.length > 0) {
      const d = diagRes.rows[0];
      series.push({
        label: 'Diagnostic initial',
        data: axeKeys.map((k) => (d[k] == null ? null : Number(d[k]))),
      });
    }

    // Séries entretiens (libellé = titre de l'entretien)
    for (const ms of milestonesRes.rows) {
      series.push({
        label: milestoneLabel(ms),
        date: ms.completed_date,
        data: axeKeys.map((k) => (ms[k] == null ? null : Number(ms[k]))),
      });
    }

    res.json({ axes, series });
  } catch (err) {
    console.error('[INSERTION] Erreur radar :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/milestones-overview — Vue d'ensemble jalons (tous les employés en parcours)
router.get('/milestones-overview', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT im.*, e.first_name, e.last_name, e.insertion_start_date,
        u.first_name as interviewer_first, u.last_name as interviewer_last
      FROM insertion_milestones im
      JOIN employees e ON im.employee_id = e.id
      LEFT JOIN users u ON im.interviewer_id = u.id
      WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
        AND COALESCE(im.parcours_num, 1) = COALESCE(e.parcours_num, 1)
      ORDER BY im.due_date
    `);
    res.json(maskInsertionRows(result.rows, baseRoleOf(req)));
  } catch (err) {
    console.error('[INSERTION] Erreur milestones overview :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/interview-template/:milestoneType — Questionnaire CIP par jalon
router.get('/interview-template/:milestoneType', (req, res) => {
  const template = CIP_QUESTIONNAIRES[req.params.milestoneType];
  if (!template) return res.status(404).json({ error: 'Type de bilan inconnu' });
  res.json(template);
});

// POST /api/insertion/milestones/:employeeId/initialize — Creer tous les jalons d'un parcours
router.post('/milestones/:employeeId/initialize', async (req, res) => {
  try {
    const empId = req.params.employeeId;
    const emp = await pool.query(
      `SELECT e.insertion_status, e.insertion_start_date, e.contract_start,
              ec.start_date AS c_start
       FROM employees e
       LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = true
       WHERE e.id = $1`,
      [empId]
    );
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Employe non trouve' });
    const e = emp.rows[0];

    // Un seul geste : démarrer le parcours ET poser les jalons.
    // insertion_start_date par défaut = début de contrat (sinon aujourd'hui).
    const startDate = e.insertion_start_date || e.c_start || e.contract_start || new Date().toISOString().split('T')[0];
    await pool.query(
      `UPDATE employees SET
         insertion_status = CASE WHEN insertion_status IN ('termine','abandon') THEN insertion_status ELSE 'en_parcours' END,
         insertion_start_date = COALESCE(insertion_start_date, $2),
         updated_at = NOW()
       WHERE id = $1`,
      [empId, startDate]
    );

    const results = await generateMilestones(pool, empId, req.user.id);
    res.status(201).json(results);
  } catch (err) {
    console.error('[INSERTION] Erreur initialize milestones :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// PLAN D'ACTION CIP
// ══════════════════════════════════════════════════════════════

// GET /api/insertion/action-plans/:employeeId — Tous les plans d'action
// (le rattachement à un entretien est désormais OPTIONNEL → LEFT JOIN)
router.get('/action-plans/:employeeId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ap.*, im.milestone_type, im.titre AS milestone_titre,
              o.titre AS objectif_titre, p.nom AS partenaire_nom
       FROM cip_action_plans ap
       LEFT JOIN insertion_milestones im ON ap.milestone_id = im.id
       LEFT JOIN insertion_objectifs o ON o.id = ap.objectif_id
       LEFT JOIN insertion_partenaires p ON p.id = ap.partenaire_id
       WHERE ap.employee_id = $1
       ORDER BY ap.priority DESC, ap.created_at`,
      [req.params.employeeId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[INSERTION] Erreur action-plans GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/insertion/action-plans — Creer une action
// milestone_id désormais OPTIONNEL (action possible hors entretien) ;
// rattachable à un objectif (objectif_id) et à un partenaire (partenaire_id) ;
// nouveaux champs : resultat, duree_minutes (RES-04 : durée des actions).
router.post('/action-plans', [
  body('milestone_id').optional({ nullable: true }).isInt().withMessage('milestone_id invalide'),
  body('employee_id').isInt().withMessage('ID employé requis'),
  body('action_label').notEmpty().withMessage('Libellé de l\'action requis'),
  body('category').isIn(['competence', 'insertion', 'socialisation', 'frein']).withMessage('Catégorie invalide'),
  body('priority').optional({ nullable: true }).isIn(['haute', 'moyenne', 'basse']).withMessage('Criticité invalide'),
  body('echeance').optional({ nullable: true }).isISO8601().withMessage('Échéance invalide'),
  body('objectif_id').optional({ nullable: true }).isInt().withMessage('objectif_id invalide'),
  body('partenaire_id').optional({ nullable: true }).isInt().withMessage('partenaire_id invalide'),
  body('duree_minutes').optional({ nullable: true }).isInt({ min: 0 }).withMessage('duree_minutes invalide'),
], validate, async (req, res) => {
  try {
    const { milestone_id, employee_id, action_label, category, frein_type, priority, echeance, notes,
      objectif_id, partenaire_id, resultat, duree_minutes } = req.body;
    const result = await pool.query(
      `INSERT INTO cip_action_plans
         (milestone_id, employee_id, action_label, category, frein_type, priority, echeance, notes,
          objectif_id, partenaire_id, resultat, duree_minutes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [milestone_id || null, employee_id, action_label, category, frein_type || null,
        priority || 'moyenne', echeance || null, notes || null,
        objectif_id || null, partenaire_id || null, resultat || null,
        duree_minutes != null && duree_minutes !== '' ? duree_minutes : null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Référence invalide (entretien, objectif ou partenaire inexistant).' });
    }
    console.error('[INSERTION] Erreur action-plans POST :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/insertion/action-plans/:id — Mettre a jour une action
// Champs PRÉSENTS uniquement (null accepté pour effacer échéance / rattachements).
router.put('/action-plans/:id', [
  param('id').isInt().withMessage('ID invalide'),
  body('status').optional({ nullable: true }).isIn(['a_faire', 'en_cours', 'realise', 'abandonne']).withMessage('Statut invalide'),
  body('priority').optional({ nullable: true }).isIn(['haute', 'moyenne', 'basse']).withMessage('Criticité invalide'),
  body('duree_minutes').optional({ nullable: true }).isInt({ min: 0 }).withMessage('duree_minutes invalide'),
], validate, async (req, res) => {
  try {
    const d = req.body;
    const editable = ['action_label', 'status', 'priority', 'echeance', 'notes',
      'category', 'frein_type', 'milestone_id', 'objectif_id', 'partenaire_id', 'resultat', 'duree_minutes'];
    const sets = [];
    const vals = [];
    for (const field of editable) {
      if (!(field in d)) continue;
      vals.push(d[field] === '' ? null : d[field]);
      sets.push(`${field} = $${vals.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });
    vals.push(req.params.id);
    const result = await pool.query(
      `UPDATE cip_action_plans SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Action non trouvee' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23503' || err.code === '23514') {
      return res.status(400).json({ error: 'Valeur ou référence invalide.', code: err.code });
    }
    console.error('[INSERTION] Erreur action-plans PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/insertion/action-plans/:id
router.delete('/action-plans/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM cip_action_plans WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[INSERTION] Erreur action-plans DELETE :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/timeline/:employeeId — Timeline du parcours
router.get('/timeline/:employeeId', async (req, res) => {
  try {
    const empId = req.params.employeeId;
    const empRes = await pool.query('SELECT e.* FROM employees e WHERE e.id = $1', [empId]);
    if (empRes.rows.length === 0) return res.status(404).json({ error: 'Employe non trouve' });

    // TOUS les contrats (vigilance 03 §6.13 : les CDDI se renouvellent —
    // fin du contrat courant seul).
    let contracts = [];
    try {
      const c = await pool.query('SELECT * FROM employee_contracts WHERE employee_id = $1 ORDER BY start_date', [empId]);
      contracts = c.rows;
    } catch (err) { /* table absente sur base ancienne */ }

    const msRes = await pool.query('SELECT * FROM insertion_milestones WHERE employee_id = $1 ORDER BY due_date', [empId]);
    let diagnostic = null;
    try {
      const diagRes = await pool.query('SELECT created_at FROM insertion_diagnostics WHERE employee_id = $1 ORDER BY parcours_num DESC LIMIT 1', [empId]);
      diagnostic = diagRes.rows[0] || null;
    } catch (err) { console.warn('[INSERTION] Timeline diagnostic:', err.message); }

    const timeline = buildTimeline(empRes.rows[0], contracts, msRes.rows, diagnostic);
    res.json(timeline);
  } catch (err) {
    console.error('[INSERTION] Erreur timeline :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// RECALAGE MANUEL DES JALONS (EXG-22) — bouton fiche (ADMIN/RH)
// Chemin à 2 segments → non capturé par GET /:employeeId.
// ══════════════════════════════════════════════════════════════
router.post('/:employeeId/resync-milestones', authorize('ADMIN', 'RH'), [
  param('employeeId').isInt().withMessage('ID employé invalide'),
], validate, async (req, res) => {
  try {
    const result = await resyncMilestones(pool, parseInt(req.params.employeeId, 10), { userId: req.user.id });
    res.json(result);
  } catch (err) {
    console.error('[INSERTION] Erreur resync-milestones :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// OBJECTIFS INDIVIDUALISÉS (Lot 3) — objectifs + sous-objectifs
// Lecture A/RH/M ; écriture A/RH. IMPORTANT : GET à 2 segments → sûr.
// ══════════════════════════════════════════════════════════════

// GET /api/insertion/objectifs/:employeeId?statut= — liste plate (parent_id
// pour l'arborescence côté front), tri parents d'abord puis ordre/échéance.
router.get('/objectifs/:employeeId', [
  param('employeeId').isInt().withMessage('ID employé invalide'),
], validate, async (req, res) => {
  try {
    const params = [req.params.employeeId];
    let filter = '';
    if (req.query.statut) { params.push(req.query.statut); filter = ` AND o.statut = $${params.length}`; }
    const result = await pool.query(
      `SELECT o.*, im.titre AS milestone_titre, im.milestone_type,
              (SELECT COUNT(*)::int FROM insertion_objectifs s WHERE s.parent_id = o.id) AS nb_sous_objectifs
       FROM insertion_objectifs o
       LEFT JOIN insertion_milestones im ON im.id = o.milestone_id
       WHERE o.employee_id = $1${filter}
       ORDER BY o.parent_id NULLS FIRST, o.ordre, o.echeance NULLS LAST, o.id`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[INSERTION] Erreur objectifs GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Garde sous-objectif : 1 seul niveau (un sous-objectif ne peut pas avoir pour
// parent un objectif qui a lui-même un parent).
async function checkObjectifParent(db, parentId, employeeId, selfId = null) {
  const p = await db.query('SELECT id, employee_id, parent_id FROM insertion_objectifs WHERE id = $1', [parentId]);
  if (p.rows.length === 0) return 'Objectif parent introuvable.';
  if (Number(p.rows[0].employee_id) !== Number(employeeId)) return 'L\'objectif parent appartient à un autre salarié.';
  if (p.rows[0].parent_id != null) return 'Un sous-objectif ne peut pas être rattaché à un autre sous-objectif (1 seul niveau).';
  if (selfId != null && Number(parentId) === Number(selfId)) return 'Un objectif ne peut pas être son propre parent.';
  return null;
}

const OBJECTIF_STATUTS = ['a_venir', 'en_cours', 'atteint', 'partiellement_atteint', 'abandonne', 'reporte'];

// POST /api/insertion/objectifs — créer un objectif ou un sous-objectif (A/RH)
router.post('/objectifs', authorize('ADMIN', 'RH'), [
  body('employee_id').isInt().withMessage('ID employé requis'),
  body('titre').isString().trim().notEmpty().isLength({ max: 200 }).withMessage('Titre requis (200 car. max)'),
  body('parent_id').optional({ nullable: true }).isInt().withMessage('parent_id invalide'),
  body('milestone_id').optional({ nullable: true }).isInt().withMessage('milestone_id invalide'),
  body('origine').optional({ nullable: true }).isIn(['salarie', 'cip']).withMessage('origine invalide (salarie/cip)'),
  body('statut').optional({ nullable: true }).isIn(OBJECTIF_STATUTS).withMessage('statut invalide'),
  body('echeance').optional({ nullable: true }).isISO8601().withMessage('echeance invalide'),
  body('date_butoir').optional({ nullable: true }).isISO8601().withMessage('date_butoir invalide'),
], validate, async (req, res) => {
  try {
    const d = req.body;
    if (d.parent_id) {
      const errMsg = await checkObjectifParent(pool, d.parent_id, d.employee_id);
      if (errMsg) return res.status(400).json({ error: errMsg });
    }
    const result = await pool.query(
      `INSERT INTO insertion_objectifs
         (employee_id, parent_id, milestone_id, titre, description, origine, echeance, date_butoir, statut, ordre, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [d.employee_id, d.parent_id || null, d.milestone_id || null, d.titre.trim(), d.description || null,
        d.origine || 'cip', d.echeance || null, d.date_butoir || null, d.statut || 'en_cours',
        Number.isInteger(d.ordre) ? d.ordre : 0, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Référence invalide (salarié, entretien ou parent inexistant).' });
    console.error('[INSERTION] Erreur objectifs POST :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/insertion/objectifs/:id — modifier (A/RH ; champs présents, null accepté)
router.put('/objectifs/:id', authorize('ADMIN', 'RH'), [
  param('id').isInt().withMessage('ID invalide'),
  body('titre').optional().isString().trim().notEmpty().isLength({ max: 200 }).withMessage('Titre invalide'),
  body('statut').optional({ nullable: true }).isIn(OBJECTIF_STATUTS).withMessage('statut invalide'),
  body('origine').optional({ nullable: true }).isIn(['salarie', 'cip']).withMessage('origine invalide'),
  body('parent_id').optional({ nullable: true }).isInt().withMessage('parent_id invalide'),
], validate, async (req, res) => {
  try {
    const d = req.body;
    const cur = await pool.query('SELECT * FROM insertion_objectifs WHERE id = $1', [req.params.id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Objectif non trouvé' });

    if (d.parent_id) {
      const errMsg = await checkObjectifParent(pool, d.parent_id, cur.rows[0].employee_id, cur.rows[0].id);
      if (errMsg) return res.status(400).json({ error: errMsg });
      // Un objectif qui a des sous-objectifs ne peut pas devenir lui-même un sous-objectif.
      const kids = await pool.query('SELECT 1 FROM insertion_objectifs WHERE parent_id = $1 LIMIT 1', [req.params.id]);
      if (kids.rows.length > 0) return res.status(400).json({ error: 'Cet objectif a des sous-objectifs : il ne peut pas devenir un sous-objectif.' });
    }

    const editable = ['titre', 'description', 'origine', 'echeance', 'date_butoir', 'statut', 'ordre', 'parent_id', 'milestone_id'];
    const sets = [];
    const vals = [];
    for (const field of editable) {
      if (!(field in d)) continue;
      vals.push(d[field] === '' ? null : d[field]);
      sets.push(`${field} = $${vals.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });
    vals.push(req.params.id);
    const result = await pool.query(
      `UPDATE insertion_objectifs SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23503' || err.code === '23514') return res.status(400).json({ error: 'Valeur ou référence invalide.', code: err.code });
    console.error('[INSERTION] Erreur objectifs PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/insertion/objectifs/:id — supprimer (A/RH ; sous-objectifs en CASCADE)
router.delete('/objectifs/:id', authorize('ADMIN', 'RH'), [
  param('id').isInt().withMessage('ID invalide'),
], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM insertion_objectifs WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Objectif non trouvé' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[INSERTION] Erreur objectifs DELETE :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// PARTENAIRES (Lot 3) — référentiel des partenaires mobilisables
// Lecture tous rôles du module ; écriture A/RH. AVANT /:employeeId.
// ══════════════════════════════════════════════════════════════

const PARTENAIRE_CATEGORIES = ['administratif', 'emploi', 'logement', 'sante', 'justice', 'formation', 'mobilite', 'autre'];

// GET /api/insertion/partenaires?actifs=1&categorie=
router.get('/partenaires', async (req, res) => {
  try {
    const params = [];
    const where = [];
    if (req.query.actifs === '1' || req.query.actifs === 'true') where.push('actif = true');
    if (req.query.categorie) { params.push(req.query.categorie); where.push(`categorie = $${params.length}`); }
    const result = await pool.query(
      `SELECT * FROM insertion_partenaires
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY actif DESC, nom`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[INSERTION] Erreur partenaires GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/insertion/partenaires — créer (A/RH)
router.post('/partenaires', authorize('ADMIN', 'RH'), [
  body('nom').isString().trim().notEmpty().isLength({ max: 150 }).withMessage('Nom requis (150 car. max)'),
  body('categorie').optional({ nullable: true }).isIn(PARTENAIRE_CATEGORIES).withMessage(`Catégorie invalide (${PARTENAIRE_CATEGORIES.join(', ')})`),
  body('contact_email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('Email invalide'),
], validate, async (req, res) => {
  try {
    const d = req.body;
    const result = await pool.query(
      `INSERT INTO insertion_partenaires (nom, categorie, contact_nom, contact_tel, contact_email, actif, notes)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, true), $7) RETURNING *`,
      [d.nom.trim(), d.categorie || null, d.contact_nom || null, d.contact_tel || null,
        d.contact_email || null, typeof d.actif === 'boolean' ? d.actif : null, d.notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un partenaire porte déjà ce nom.' });
    console.error('[INSERTION] Erreur partenaires POST :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/insertion/partenaires/:id — modifier (A/RH)
router.put('/partenaires/:id', authorize('ADMIN', 'RH'), [
  param('id').isInt().withMessage('ID invalide'),
  body('nom').optional().isString().trim().notEmpty().isLength({ max: 150 }).withMessage('Nom invalide'),
  body('categorie').optional({ nullable: true }).isIn(PARTENAIRE_CATEGORIES).withMessage('Catégorie invalide'),
  body('contact_email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('Email invalide'),
], validate, async (req, res) => {
  try {
    const d = req.body;
    const editable = ['nom', 'categorie', 'contact_nom', 'contact_tel', 'contact_email', 'actif', 'notes'];
    const sets = [];
    const vals = [];
    for (const field of editable) {
      if (!(field in d)) continue;
      vals.push(d[field] === '' ? null : d[field]);
      sets.push(`${field} = $${vals.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });
    vals.push(req.params.id);
    const result = await pool.query(
      `UPDATE insertion_partenaires SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Partenaire non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un partenaire porte déjà ce nom.' });
    console.error('[INSERTION] Erreur partenaires PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// TABLEAU TRANSVERSAL DES ACTIONS (Lot 3) — toutes-actions, tous salariés
// Filtres : employee_id / category / priority / partenaire_id / retard / mine /
// statut. Tri échéance. Pagination LIMIT/OFFSET. AVANT /:employeeId.
// ══════════════════════════════════════════════════════════════
router.get('/actions-overview', [
  query('employee_id').optional().isInt().withMessage('employee_id invalide'),
  query('partenaire_id').optional().isInt().withMessage('partenaire_id invalide'),
  query('limit').optional().isInt({ min: 1, max: 500 }).withMessage('limit invalide (1-500)'),
  query('offset').optional().isInt({ min: 0 }).withMessage('offset invalide'),
], validate, async (req, res) => {
  try {
    const params = [];
    const where = ['e.is_active = true'];
    if (req.query.employee_id) { params.push(req.query.employee_id); where.push(`a.employee_id = $${params.length}`); }
    if (req.query.category) { params.push(req.query.category); where.push(`a.category = $${params.length}`); }
    if (req.query.priority) { params.push(req.query.priority); where.push(`a.priority = $${params.length}`); }
    if (req.query.partenaire_id) { params.push(req.query.partenaire_id); where.push(`a.partenaire_id = $${params.length}`); }
    if (req.query.statut) { params.push(req.query.statut); where.push(`a.status = $${params.length}`); }
    if (req.query.retard === '1' || req.query.retard === 'true') {
      where.push(`a.echeance < CURRENT_DATE AND a.status IN ('a_faire', 'en_cours')`);
    }
    if (req.query.mine === '1' || req.query.mine === 'true') {
      params.push(req.user.id); where.push(`e.cip_referent_user_id = $${params.length}`);
    }
    const whereSql = 'WHERE ' + where.join(' AND ');

    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM cip_action_plans a JOIN employees e ON e.id = a.employee_id ${whereSql}`,
      params
    );

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    params.push(limit, offset);
    const rows = await pool.query(
      `SELECT a.*, e.first_name, e.last_name,
              im.titre AS milestone_titre, im.milestone_type,
              o.titre AS objectif_titre, p.nom AS partenaire_nom,
              (a.echeance IS NOT NULL AND a.echeance < CURRENT_DATE AND a.status IN ('a_faire', 'en_cours')) AS en_retard
       FROM cip_action_plans a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN insertion_milestones im ON im.id = a.milestone_id
       LEFT JOIN insertion_objectifs o ON o.id = a.objectif_id
       LEFT JOIN insertion_partenaires p ON p.id = a.partenaire_id
       ${whereSql}
       ORDER BY a.echeance ASC NULLS LAST, a.priority DESC, a.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ total: totalRes.rows[0]?.n || 0, limit, offset, actions: rows.rows });
  } catch (err) {
    console.error('[INSERTION] Erreur actions-overview :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// ALERTES DE LA FICHE (Lot 1) — GET /alertes/:employeeId (A/RH/M)
// Consolide : jalons en retard, prochain entretien non planifié, Pass IAE,
// cumul CDDI ≥ 22 mois, diagnostic > délai cible, actions critiques en retard,
// + les alertes récentes du scheduler (insertion_interview_alerts, enfin lues).
// Chemin à 2 segments → sûr vis-à-vis de /:employeeId.
// ══════════════════════════════════════════════════════════════
router.get('/alertes/:employeeId', [
  param('employeeId').isInt().withMessage('ID employé invalide'),
], validate, async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    const empRes = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.insertion_status, e.insertion_start_date,
              e.pass_iae_number, e.pass_iae_end, e.cddi_derogation_motif,
              COALESCE(e.parcours_num, 1) AS parcours_num
       FROM employees e WHERE e.id = $1`,
      [empId]
    );
    if (empRes.rows.length === 0) return res.status(404).json({ error: 'Salarié non trouvé' });
    const emp = empRes.rows[0];
    const alertes = [];
    const today = new Date();

    const soft = async (label, text, params = []) => {
      try { return (await pool.query(text, params)).rows; }
      catch (err) { console.error(`[INSERTION][ALERTES] « ${label} » ignorée (${err.code || '?'}) : ${err.message}`); return []; }
    };

    // 1. Jalons en retard (parcours courant, non réalisés, échéance dépassée)
    const retards = await soft('retards', `
      SELECT id, milestone_type, titre, due_date, (CURRENT_DATE - due_date) AS jours_retard
      FROM insertion_milestones
      WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2
        AND status <> 'realise' AND due_date < CURRENT_DATE
      ORDER BY due_date`, [empId, emp.parcours_num]);
    for (const r of retards) {
      alertes.push({
        type: 'jalon_en_retard', niveau: 'critique',
        message: `${r.titre || MILESTONE_TYPE_LABELS[r.milestone_type] || r.milestone_type} en retard de ${r.jours_retard} jour(s) (échéance ${new Date(r.due_date).toLocaleDateString('fr-FR')}).`,
        milestone_id: r.id, due_date: r.due_date,
      });
    }

    // 2. Prochain entretien à échéance sans date planifiée
    const aPlanifier = await soft('a_planifier', `
      SELECT id, milestone_type, titre, due_date
      FROM insertion_milestones
      WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2
        AND status = 'a_planifier' AND due_date >= CURRENT_DATE
      ORDER BY due_date LIMIT 1`, [empId, emp.parcours_num]);
    if (aPlanifier.length > 0) {
      const n = aPlanifier[0];
      alertes.push({
        type: 'entretien_a_planifier', niveau: 'attention',
        message: `Prochain entretien « ${n.titre || MILESTONE_TYPE_LABELS[n.milestone_type] || n.milestone_type} » (échéance ${new Date(n.due_date).toLocaleDateString('fr-FR')}) : pas encore de date planifiée.`,
        milestone_id: n.id, due_date: n.due_date,
      });
    }

    // 3. Pass IAE proche de l'échéance (seuil 1 paramétrable, seuil 2 = 2 mois)
    if (emp.pass_iae_end) {
      const moisAlerte = await readInsertionSetting('insertion.alerte_pass_iae_mois');
      const moisRestants = (new Date(emp.pass_iae_end) - today) / (30.44 * 86400000);
      if (moisRestants < 0) {
        alertes.push({ type: 'pass_iae_expire', niveau: 'critique', message: `Pass IAE expiré depuis le ${new Date(emp.pass_iae_end).toLocaleDateString('fr-FR')}.`, pass_iae_end: emp.pass_iae_end });
      } else if (moisRestants <= 2) {
        alertes.push({ type: 'pass_iae_bientot_expire', niveau: 'critique', message: `Pass IAE : fin le ${new Date(emp.pass_iae_end).toLocaleDateString('fr-FR')} (moins de 2 mois) — engager la demande de prolongation.`, pass_iae_end: emp.pass_iae_end });
      } else if (moisRestants <= moisAlerte) {
        alertes.push({ type: 'pass_iae_a_surveiller', niveau: 'attention', message: `Pass IAE : fin le ${new Date(emp.pass_iae_end).toLocaleDateString('fr-FR')} (moins de ${moisAlerte} mois).`, pass_iae_end: emp.pass_iae_end });
      }
    }

    // 4. Cumul CDDI proche du plafond légal 24 mois (alerte dès 22)
    const contrats = await soft('contrats', 'SELECT contract_type, start_date, end_date FROM employee_contracts WHERE employee_id = $1', [empId]);
    const cddi = computeCddiCumulativeMonths(contrats, today);
    if (cddi.months_total >= 22) {
      alertes.push({
        type: 'cddi_plafond', niveau: cddi.months_total >= 23 ? 'critique' : 'attention',
        message: `Durée cumulée en CDDI : ${cddi.months_total} mois sur 24 (plafond légal, dérogations possibles).`,
        months_total: cddi.months_total, months_elapsed: cddi.months_elapsed,
      });
    }
    // 4bis. Dérogation à régulariser (EXG-03 / RES-08, PR 2) : cumul > 24 mois
    // SANS motif de dérogation saisi — l'import paie ne bloque jamais (voie
    // Malibou), la régularisation se pilote donc ici (file visible tant que le
    // motif + la date de décision ne sont pas renseignés sur la fiche).
    if (cddi.months_total > 24 && !emp.cddi_derogation_motif) {
      alertes.push({
        type: 'cddi_derogation_requise', niveau: 'critique',
        message: `Cumul CDDI ${cddi.months_total} mois > 24 sans motif de dérogation (L.5132-15-1) — saisir le motif (formation en cours, 50 ans et plus, RQTH, CDI inclusion) et la date de décision sur la fiche.`,
        months_total: cddi.months_total,
      });
    }

    // 5. Diagnostic d'accueil au-delà du délai cible (settings, défaut 30 j)
    if (emp.insertion_status === 'en_parcours' && emp.insertion_start_date) {
      const delai = await readInsertionSetting('insertion.delai_diagnostic_jours');
      const jours = Math.floor((today - new Date(emp.insertion_start_date)) / 86400000);
      if (jours > delai) {
        const diag = await soft('diagnostic', `
          SELECT id, statut_saisie FROM insertion_diagnostics
          WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2`, [empId, emp.parcours_num]);
        if (diag.length === 0) {
          alertes.push({ type: 'diagnostic_absent', niveau: 'critique', message: `Aucun diagnostic d'accueil ${jours} jours après le début du parcours (délai cible : ${delai} j).`, jours });
        } else if (diag[0].statut_saisie === 'en_cours') {
          alertes.push({ type: 'diagnostic_incomplet', niveau: 'attention', message: `Diagnostic d'accueil commencé mais non finalisé (${jours} jours après le début du parcours).`, jours });
        }
      }
    }

    // 6. Actions critiques (criticité haute) en retard
    const actionsRetard = await soft('actions', `
      SELECT id, action_label, echeance FROM cip_action_plans
      WHERE employee_id = $1 AND priority = 'haute' AND echeance < CURRENT_DATE
        AND status IN ('a_faire', 'en_cours') ORDER BY echeance`, [empId]);
    for (const a of actionsRetard) {
      alertes.push({
        type: 'action_critique_en_retard', niveau: 'critique',
        message: `Action critique en retard : « ${a.action_label} » (échéance ${new Date(a.echeance).toLocaleDateString('fr-FR')}).`,
        action_id: a.id, echeance: a.echeance,
      });
    }

    // 7. Alertes récentes du scheduler (30 derniers jours) — la table
    // insertion_interview_alerts est enfin consommée par un écran.
    const schedulerAlerts = await soft('scheduler', `
      SELECT id, milestone_type, alert_type, target_date, created_at
      FROM insertion_interview_alerts
      WHERE employee_id = $1 AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC LIMIT 20`, [empId]);

    // 8. Acquittements journalisés (phase D — écart 1c) : une alerte dont le
    // type est acquitté (acked_until non expiré) sort de la liste active et
    // part dans `acquittees` — l'acquittement est PARTAGÉ entre utilisateurs
    // (fin du localStorage navigateur).
    const acks = await soft('acks', `
      SELECT alert_type, MAX(acked_until) AS acked_until
      FROM insertion_alert_acks
      WHERE employee_id = $1 AND acked_until > NOW()
      GROUP BY alert_type`, [empId]);
    const ackByType = new Map(acks.map((a) => [a.alert_type, a.acked_until]));
    const actives = [];
    const acquittees = [];
    for (const a of alertes) {
      const until = ackByType.get(a.type);
      if (until) acquittees.push({ ...a, acked_until: until });
      else actives.push(a);
    }

    res.json({
      employee_id: empId,
      generated_at: new Date().toISOString(),
      total: actives.length,
      alertes: actives,
      acquittees,
      alertes_scheduler: schedulerAlerts,
    });
  } catch (err) {
    console.error('[INSERTION] Erreur alertes :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/insertion/alertes/:employeeId/ack — Acquitter un TYPE d'alerte
// (« Vu — me le rappeler le … », phase D écart 1c). Body : { type, jusqu_au }.
// Journalisé en base (insertion_alert_acks : qui, quand, jusqu'à quand) et
// partagé entre les CIP — remplace l'acquittement localStorage du navigateur.
// Rôles : ceux du module (ADMIN/RH/MANAGER — router.use d'index.js).
// Chemin à 3 segments → non capturé par GET /:employeeId.
router.post('/alertes/:employeeId/ack', [
  param('employeeId').isInt().withMessage('ID employé invalide'),
  body('type').isString().trim().notEmpty().isLength({ max: 40 }).withMessage("Type d'alerte requis (40 car. max)"),
  body('jusqu_au').isISO8601().withMessage('jusqu_au invalide (date ISO attendue)'),
], validate, async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    const until = new Date(req.body.jusqu_au);
    if (!(until > new Date())) {
      return res.status(400).json({ error: "jusqu_au doit être une date future (fin de la mise en veille)." });
    }
    const emp = await pool.query('SELECT id FROM employees WHERE id = $1', [empId]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Salarié non trouvé' });
    const r = await pool.query(
      `INSERT INTO insertion_alert_acks (employee_id, alert_type, acked_by, acked_until)
       VALUES ($1, $2, $3, $4)
       RETURNING id, employee_id, alert_type, acked_by, acked_until, created_at`,
      [empId, req.body.type.trim(), req.user.id, until.toISOString()]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[INSERTION] Erreur alertes ack :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// PMSMP (EXG-05, PR 2) — périodes de mise en situation en milieu professionnel
// Écriture ADMIN/RH ; lecture module (MANAGER inclus). Bornes réglementaires :
// ≤ 31 j par convention (non forçable) ; cumul ≤ 60 j / 12 mois glissants
// (forçable avec motif tracé — assiette prudente, cf. pmsmp-rules.js RES-07).
// Chemins à ≥ 2 segments → sûrs vis-à-vis de GET /:employeeId.
// ══════════════════════════════════════════════════════════════

const PMSMP_OBJETS = ['decouvrir_metier', 'confirmer_projet', 'initier_recrutement'];
const PMSMP_RAPPEL_OUTIL = "Saisie officielle : Immersion Facilitée (art. 3.3 de la convention) — cette fiche est un suivi interne de contrôle, elle ne remplace pas la convention Cerfa ni la saisie dans l'outil officiel.";

// Contrôles communs POST/PUT. Retourne { refus:{status,body} } si blocage,
// sinon { forced, motif, cumul, jours } (forced=true quand le dépassement 60 j
// est explicitement assumé — motif obligatoire, tracé dans `bilan`).
async function checkPmsmpRules(db, { employeeId, dateDebut, dateFin, excludeId = null, autresJoursConnus = 0, force = false, motifDepassement = null }) {
  const jours = pmsmpDays(dateDebut, dateFin);
  if (jours == null) {
    return { refus: { status: 400, body: { error: 'date_fin doit être postérieure ou égale à date_debut.' } } };
  }
  if (jours > PMSMP_MAX_JOURS_CONVENTION) {
    return { refus: { status: 409, body: {
      error: `Une convention PMSMP ne peut pas dépasser ${PMSMP_MAX_JOURS_CONVENTION} jours calendaires (1 mois maximum par convention — L.5135-1 s.).`,
      code: 'pmsmp_duree', jours,
    } } };
  }
  const params = [employeeId];
  let excl = '';
  if (excludeId != null) { params.push(excludeId); excl = ' AND id <> $2'; }
  const existantes = await db.query(
    `SELECT date_debut, date_fin FROM insertion_pmsmp WHERE employee_id = $1${excl}`, params
  );
  const cumul = computeCumul12MoisGlissants(
    { date_debut: dateDebut, date_fin: dateFin }, existantes.rows, autresJoursConnus
  );
  if (cumul && cumul.depassement) {
    if (force !== true) {
      return { refus: { status: 409, body: {
        error: `Cumul PMSMP de ${cumul.total} jours sur 12 mois glissants (${cumul.fenetre_du} → ${cumul.fenetre_au}) — plafond ${PMSMP_MAX_CUMUL_12M} j.`,
        code: 'pmsmp_cumul',
        detail: `Assiette prudente toutes entreprises confondues : ${cumul.jours_enregistres} j déjà enregistrés + ${cumul.jours_nouvelle} j de cette période + ${cumul.autres_jours_connus} j déclarés hors ERP (autres employeurs). Le plafond réglementaire s'apprécie pour un même bénéficiaire chez un MÊME organisme d'accueil (Q/R DGEFP) : si le dépassement est licite (organismes différents), enregistrez avec { force: true, motif_depassement }.`,
        cumul,
      } } };
    }
    const motif = typeof motifDepassement === 'string' ? motifDepassement.trim() : '';
    if (!motif) {
      return { refus: { status: 400, body: {
        error: 'motif_depassement obligatoire pour forcer un enregistrement au-delà du cumul de 60 j / 12 mois.',
        code: 'pmsmp_motif_requis',
      } } };
    }
    return { forced: true, motif, cumul, jours };
  }
  return { forced: false, cumul, jours };
}

// Trace du forçage, ajoutée au champ `bilan` (journal probant de la fiche).
function pmsmpForceTrace(motif, cumul) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `[${stamp}] Dépassement du cumul PMSMP (${cumul.total} j / plafond ${PMSMP_MAX_CUMUL_12M} j sur 12 mois) assumé : ${motif}`;
}

// GET /api/insertion/pmsmp/:employeeId — liste + cumul courant (lecture module)
router.get('/pmsmp/:employeeId', [
  param('employeeId').isInt().withMessage('ID employé invalide'),
], validate, async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    const rows = await pool.query(
      `SELECT p.*, u.first_name AS created_by_first, u.last_name AS created_by_last
       FROM insertion_pmsmp p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.employee_id = $1
       ORDER BY p.date_debut DESC, p.id DESC`,
      [empId]
    );
    // Cumul observé sur la fenêtre de 12 mois se terminant aujourd'hui
    // (jours_enregistres seulement — la « nouvelle » période sonde est vide).
    const today = new Date().toISOString().slice(0, 10);
    const sonde = computeCumul12MoisGlissants({ date_debut: today, date_fin: today }, rows.rows, 0);
    res.json({
      employee_id: empId,
      total: rows.rows.length,
      cumul_12mois_jours: sonde ? sonde.jours_enregistres : 0,
      regles: { max_jours_convention: PMSMP_MAX_JOURS_CONVENTION, max_cumul_12mois: PMSMP_MAX_CUMUL_12M },
      pmsmp: maskInsertionRows(rows.rows.map((r) => ({ ...r, jours: pmsmpDays(r.date_debut, r.date_fin) })), baseRoleOf(req)),
    });
  } catch (err) {
    console.error('[INSERTION] Erreur pmsmp GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/insertion/pmsmp — créer (ADMIN/RH)
router.post('/pmsmp', authorize('ADMIN', 'RH'), [
  body('employee_id').isInt().withMessage('ID employé requis'),
  body('entreprise').isString().trim().notEmpty().isLength({ max: 200 }).withMessage('Entreprise requise (200 car. max)'),
  body('siret').optional({ nullable: true, checkFalsy: true }).matches(/^\d{14}$/).withMessage('SIRET invalide (14 chiffres)'),
  body('objet').isIn(PMSMP_OBJETS).withMessage(`Objet invalide (${PMSMP_OBJETS.join(', ')})`),
  body('date_debut').isISO8601().withMessage('date_debut invalide (AAAA-MM-JJ)'),
  body('date_fin').isISO8601().withMessage('date_fin invalide (AAAA-MM-JJ)'),
  body('tuteur').optional({ nullable: true }).isLength({ max: 120 }).withMessage('tuteur trop long (120 max)'),
  body('convention_ref').optional({ nullable: true }).isLength({ max: 60 }).withMessage('convention_ref trop longue (60 max)'),
  body('saisie_outil_officiel').optional({ nullable: true }).isBoolean().withMessage('saisie_outil_officiel invalide'),
  body('autres_jours_connus').optional({ nullable: true }).isInt({ min: 0, max: 366 }).withMessage('autres_jours_connus invalide (0-366)'),
  body('force').optional().isBoolean().withMessage('force invalide'),
  body('motif_depassement').optional({ nullable: true }).isLength({ max: 500 }).withMessage('motif_depassement trop long (500 max)'),
], validate, async (req, res) => {
  try {
    const d = req.body;
    const emp = await pool.query('SELECT id FROM employees WHERE id = $1', [d.employee_id]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Salarié non trouvé' });

    const check = await checkPmsmpRules(pool, {
      employeeId: d.employee_id, dateDebut: d.date_debut, dateFin: d.date_fin,
      autresJoursConnus: d.autres_jours_connus, force: d.force === true, motifDepassement: d.motif_depassement,
    });
    if (check.refus) return res.status(check.refus.status).json(check.refus.body);

    let bilan = (d.bilan != null && d.bilan !== '') ? String(d.bilan) : null;
    if (check.forced) bilan = `${bilan ? bilan + '\n' : ''}${pmsmpForceTrace(check.motif, check.cumul)}`;

    const r = await pool.query(
      `INSERT INTO insertion_pmsmp
         (employee_id, entreprise, siret, objet, date_debut, date_fin, tuteur, bilan, saisie_outil_officiel, convention_ref, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, false), $10, $11)
       RETURNING *`,
      [d.employee_id, d.entreprise.trim(), d.siret || null, d.objet, d.date_debut, d.date_fin,
        d.tuteur || null, bilan, typeof d.saisie_outil_officiel === 'boolean' ? d.saisie_outil_officiel : null,
        d.convention_ref || null, req.user.id]
    );
    const row = r.rows[0];
    const out = { ...row, jours: pmsmpDays(row.date_debut, row.date_fin) };
    if (!row.saisie_outil_officiel) out.rappel = PMSMP_RAPPEL_OUTIL;
    res.status(201).json(out);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Référence invalide (salarié inexistant).' });
    console.error('[INSERTION] Erreur pmsmp POST :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/insertion/pmsmp/:id — modifier (ADMIN/RH ; champs présents, null accepté)
router.put('/pmsmp/:id', authorize('ADMIN', 'RH'), [
  param('id').isInt().withMessage('ID invalide'),
  body('entreprise').optional().isString().trim().notEmpty().isLength({ max: 200 }).withMessage('Entreprise invalide'),
  body('siret').optional({ nullable: true, checkFalsy: true }).matches(/^\d{14}$/).withMessage('SIRET invalide (14 chiffres)'),
  body('objet').optional().isIn(PMSMP_OBJETS).withMessage(`Objet invalide (${PMSMP_OBJETS.join(', ')})`),
  body('date_debut').optional().isISO8601().withMessage('date_debut invalide'),
  body('date_fin').optional().isISO8601().withMessage('date_fin invalide'),
  body('autres_jours_connus').optional({ nullable: true }).isInt({ min: 0, max: 366 }).withMessage('autres_jours_connus invalide (0-366)'),
  body('tuteur').optional({ nullable: true }).isLength({ max: 120 }).withMessage('tuteur trop long (120 max)'),
  body('convention_ref').optional({ nullable: true }).isLength({ max: 60 }).withMessage('convention_ref trop longue (60 max)'),
  body('saisie_outil_officiel').optional({ nullable: true }).isBoolean().withMessage('saisie_outil_officiel invalide'),
  body('force').optional().isBoolean().withMessage('force invalide'),
  body('motif_depassement').optional({ nullable: true }).isLength({ max: 500 }).withMessage('motif_depassement trop long (500 max)'),
], validate, async (req, res) => {
  try {
    const d = req.body;
    const cur = await pool.query('SELECT * FROM insertion_pmsmp WHERE id = $1', [req.params.id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'PMSMP non trouvée' });
    const ex = cur.rows[0];

    // Contrôles sur les dates EFFECTIVES (fusion body + existant).
    const dateDebut = 'date_debut' in d ? d.date_debut : ex.date_debut;
    const dateFin = 'date_fin' in d ? d.date_fin : ex.date_fin;
    const check = await checkPmsmpRules(pool, {
      employeeId: ex.employee_id, dateDebut, dateFin, excludeId: ex.id,
      autresJoursConnus: d.autres_jours_connus, force: d.force === true, motifDepassement: d.motif_depassement,
    });
    if (check.refus) return res.status(check.refus.status).json(check.refus.body);

    const editable = ['entreprise', 'siret', 'objet', 'date_debut', 'date_fin', 'tuteur', 'bilan', 'saisie_outil_officiel', 'convention_ref'];
    const sets = [];
    const vals = [];
    for (const field of editable) {
      if (!(field in d)) continue;
      vals.push(d[field] === '' ? null : d[field]);
      sets.push(`${field} = $${vals.length}`);
    }
    if (check.forced) {
      // Trace du dépassement assumé dans le bilan (même si `bilan` absent du body).
      const base = ('bilan' in d ? d.bilan : ex.bilan) || '';
      const traced = `${base ? base + '\n' : ''}${pmsmpForceTrace(check.motif, check.cumul)}`;
      const idx = sets.findIndex((s) => s.startsWith('bilan ='));
      if (idx >= 0) vals[parseInt(sets[idx].split('$')[1], 10) - 1] = traced;
      else { vals.push(traced); sets.push(`bilan = $${vals.length}`); }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });
    vals.push(req.params.id);
    const r = await pool.query(
      `UPDATE insertion_pmsmp SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    const row = r.rows[0];
    const out = { ...row, jours: pmsmpDays(row.date_debut, row.date_fin) };
    if (!row.saisie_outil_officiel) out.rappel = PMSMP_RAPPEL_OUTIL;
    res.json(out);
  } catch (err) {
    if (err.code === '23514') return res.status(400).json({ error: 'Valeur rejetée par une contrainte de la base', code: err.code });
    console.error('[INSERTION] Erreur pmsmp PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/insertion/pmsmp/:id — supprimer (ADMIN/RH)
router.delete('/pmsmp/:id', authorize('ADMIN', 'RH'), [
  param('id').isInt().withMessage('ID invalide'),
], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM insertion_pmsmp WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'PMSMP non trouvée' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[INSERTION] Erreur pmsmp DELETE :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// SATISFACTION DE SORTIE (EXG-09, PR 2) — questionnaire qualité
// Saisie ADMIN/RH (upsert par employee_id + parcours_num — RES-05) ;
// restitution agrégée ANONYME ouverte au module (ADMIN/RH/MANAGER).
// ══════════════════════════════════════════════════════════════

// POST /api/insertion/satisfaction/:employeeId — saisir/ressaisir (ADMIN/RH).
// Le POST porte l'INTÉGRALITÉ du questionnaire (une ressaisie remplace la
// précédente — le questionnaire est rempli en une fois à la sortie).
router.post('/satisfaction/:employeeId', authorize('ADMIN', 'RH'), [
  param('employeeId').isInt().withMessage('ID employé invalide'),
  body('milestone_id').optional({ nullable: true }).isInt().withMessage('milestone_id invalide'),
  body('date_reponse').optional({ nullable: true }).isISO8601().withMessage('date_reponse invalide'),
  body('satisfaction_globale').optional({ nullable: true }).isInt({ min: 1, max: 4 }).withMessage('satisfaction_globale : échelle 1-4'),
  body('situation_sortie').optional({ nullable: true }).isLength({ max: 30 }).withMessage('situation_sortie trop longue (30 max)'),
], validate, async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    const emp = await pool.query('SELECT id FROM employees WHERE id = $1', [empId]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Salarié non trouvé' });
    const pn = await currentParcoursNum(pool, empId);
    const d = req.body;
    const reponses = (d.reponses != null && typeof d.reponses === 'object') ? d.reponses : {};
    const r = await pool.query(
      `INSERT INTO insertion_satisfaction_sortie
         (employee_id, parcours_num, milestone_id, date_reponse, reponses, situation_sortie, satisfaction_globale, suggestions, avis_transmis, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (employee_id, parcours_num) DO UPDATE SET
         milestone_id = EXCLUDED.milestone_id,
         date_reponse = EXCLUDED.date_reponse,
         reponses = EXCLUDED.reponses,
         situation_sortie = EXCLUDED.situation_sortie,
         satisfaction_globale = EXCLUDED.satisfaction_globale,
         suggestions = EXCLUDED.suggestions,
         avis_transmis = EXCLUDED.avis_transmis,
         created_by = EXCLUDED.created_by
       RETURNING *`,
      [empId, pn, d.milestone_id || null, d.date_reponse || null, JSON.stringify(reponses),
        d.situation_sortie || null, d.satisfaction_globale != null && d.satisfaction_globale !== '' ? d.satisfaction_globale : null,
        d.suggestions || null, d.avis_transmis || null, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Référence invalide (entretien inexistant).' });
    console.error('[INSERTION] Erreur satisfaction POST :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/satisfaction/:employeeId — réponse du parcours courant
// (?parcours=N pour un parcours antérieur). Lecture module.
router.get('/satisfaction/:employeeId', [
  param('employeeId').isInt().withMessage('ID employé invalide'),
], validate, async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    const pn = req.query.parcours ? parseInt(req.query.parcours, 10) : await currentParcoursNum(pool, empId);
    const r = await pool.query(
      'SELECT * FROM insertion_satisfaction_sortie WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2',
      [empId, pn || 1]
    );
    res.json(r.rows[0] ? maskInsertionRow(r.rows[0], baseRoleOf(req)) : null);
  } catch (err) {
    console.error('[INSERTION] Erreur satisfaction GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Agrégats ANONYMES du questionnaire (aucune donnée nominative, aucun verbatim).
// `reponses` JSONB : sections de la trame — valeur numérique 1-4 directe ou
// objet { question: note } (moyenne des notes 1-4 ; textes ignorés).
function computeSatisfactionAgregats(rows) {
  const repartition = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const situations = {};
  const sections = {}; // clé → { somme, nb }
  let sommeGlobale = 0;
  let nbGlobale = 0;
  const collect = (sectionKey, v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || n > 4) return;
    if (!sections[sectionKey]) sections[sectionKey] = { somme: 0, nb: 0 };
    sections[sectionKey].somme += n;
    sections[sectionKey].nb += 1;
  };
  for (const r of rows) {
    const g = Number(r.satisfaction_globale);
    if (Number.isFinite(g) && g >= 1 && g <= 4) {
      repartition[g] += 1;
      sommeGlobale += g;
      nbGlobale += 1;
    }
    if (r.situation_sortie) situations[r.situation_sortie] = (situations[r.situation_sortie] || 0) + 1;
    const rep = (r.reponses && typeof r.reponses === 'object') ? r.reponses : {};
    for (const [k, v] of Object.entries(rep)) {
      if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        for (const sub of Object.values(v)) collect(k, sub);
      } else {
        collect(k, v);
      }
    }
  }
  const sectionsOut = {};
  for (const [k, s] of Object.entries(sections)) {
    sectionsOut[k] = { moyenne: +(s.somme / s.nb).toFixed(2), nb: s.nb };
  }
  return {
    nb_reponses: rows.length,
    satisfaction_globale: {
      moyenne: nbGlobale ? +(sommeGlobale / nbGlobale).toFixed(2) : null,
      repartition,
    },
    situations_sortie: situations,
    sections: sectionsOut,
  };
}

// GET /api/insertion/satisfaction-stats?year= — agrégats anonymes (module).
router.get('/satisfaction-stats', [
  query('year').optional().isInt({ min: 2000, max: 2100 }).withMessage('year invalide'),
], validate, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const rows = await pool.query(
      `SELECT reponses, situation_sortie, satisfaction_globale
       FROM insertion_satisfaction_sortie
       WHERE EXTRACT(YEAR FROM COALESCE(date_reponse, created_at::date)) = $1`,
      [year]
    );
    res.json({ annee: year, ...computeSatisfactionAgregats(rows.rows) });
  } catch (err) {
    console.error('[INSERTION] Erreur satisfaction-stats :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// RENOUVELLEMENTS (EXG-04 reste, PR 2) — file des CDDI à préparer + volet ETI
// ══════════════════════════════════════════════════════════════

// GET /api/insertion/renouvellements — contrats CDDI courants finissant dans la
// fenêtre d'anticipation (settings insertion.renouvellement_anticipation_jours,
// défaut 42 j), avec l'état de l'entretien de renouvellement (existant : id,
// statut, avis, formulaire rempli — sinon `a_creer`). Lecture module (A/RH/M).
router.get('/renouvellements', async (req, res) => {
  try {
    const jours = Math.round(Number(await readInsertionSetting('insertion.renouvellement_anticipation_jours')) || 42);
    const rows = await pool.query(
      `SELECT e.id AS employee_id, e.first_name, e.last_name,
              ec.id AS contract_id, ec.end_date AS contract_end,
              (ec.end_date - CURRENT_DATE) AS jours_restants,
              m.id AS milestone_id, m.status AS milestone_status, m.titre AS milestone_titre,
              m.due_date AS milestone_due_date, m.renouvellement_avis, m.renouvellement_duree_mois,
              (m.renouvellement_form IS NOT NULL) AS formulaire_rempli,
              (m.locked_at IS NOT NULL) AS verrouille
       FROM employees e
       JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = true
       LEFT JOIN LATERAL (
         SELECT im.* FROM insertion_milestones im
         WHERE im.employee_id = e.id AND im.milestone_type = 'renouvellement'
           AND (im.contract_id = ec.id OR im.status <> 'realise')
         ORDER BY (im.contract_id = ec.id) DESC, im.due_date DESC
         LIMIT 1
       ) m ON true
       WHERE e.is_active = true AND e.insertion_status = 'en_parcours'
         AND UPPER(ec.contract_type) = 'CDDI'
         AND ec.end_date IS NOT NULL
         AND ec.end_date >= CURRENT_DATE
         AND ec.end_date < CURRENT_DATE + make_interval(days => $1)
       ORDER BY ec.end_date, e.last_name`,
      [jours]
    );
    const renouvellements = rows.rows.map((r) => ({
      employee_id: r.employee_id,
      first_name: r.first_name,
      last_name: r.last_name,
      contract_id: r.contract_id,
      contract_end: r.contract_end,
      jours_restants: r.jours_restants,
      a_creer: r.milestone_id == null,
      entretien: r.milestone_id == null ? null : {
        id: r.milestone_id,
        status: r.milestone_status,
        titre: r.milestone_titre,
        due_date: r.milestone_due_date,
        renouvellement_avis: r.renouvellement_avis,
        renouvellement_duree_mois: r.renouvellement_duree_mois,
        formulaire_rempli: r.formulaire_rempli === true,
        verrouille: r.verrouille === true,
      },
    }));
    res.json({ anticipation_jours: jours, total: renouvellements.length, renouvellements });
  } catch (err) {
    console.error('[INSERTION] Erreur renouvellements :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Champs — et SEULS champs — inscriptibles par la route « formulaire ETI ».
const RENOUVELLEMENT_FORM_FIELDS = ['renouvellement_form', 'renouvellement_avis', 'renouvellement_duree_mois'];

// PUT /api/insertion/renouvellements/:milestoneId/formulaire — volet ETI
// (ADMIN/RH/MANAGER — c'est LA voie d'écriture du MANAGER, cf. garde RES-10 du
// PUT /milestones/:id). N'écrit QUE renouvellement_form / renouvellement_avis /
// renouvellement_duree_mois + une validation « eti » horodatée (validations) ;
// tout autre champ transmis → 400. Un MANAGER ne voit jamais les champs
// masqués dans la réponse (maskInsertionRow).
router.put('/renouvellements/:milestoneId/formulaire', [
  param('milestoneId').isInt().withMessage('ID invalide'),
  body('renouvellement_avis').optional({ nullable: true }).isIn(['favorable', 'favorable_reserves', 'defavorable']).withMessage('renouvellement_avis invalide (favorable, favorable_reserves, defavorable)'),
  body('renouvellement_duree_mois').optional({ nullable: true }).isInt({ min: 1, max: 24 }).withMessage('renouvellement_duree_mois invalide (1-24)'),
], validate, async (req, res) => {
  try {
    const refuses = Object.keys(req.body).filter((k) => !RENOUVELLEMENT_FORM_FIELDS.includes(k));
    if (refuses.length > 0) {
      return res.status(400).json({
        error: 'Champs refusés sur cette route (formulaire ETI limité au bloc renouvellement).',
        champs_refuses: refuses,
        champs_acceptes: RENOUVELLEMENT_FORM_FIELDS,
      });
    }
    const present = RENOUVELLEMENT_FORM_FIELDS.filter((f) => f in req.body);
    if (present.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

    const cur = await pool.query('SELECT * FROM insertion_milestones WHERE id = $1', [req.params.milestoneId]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Entretien non trouvé' });
    const prev = cur.rows[0];
    if (prev.milestone_type !== 'renouvellement') {
      return res.status(400).json({ error: "Cette route ne s'applique qu'aux entretiens de type renouvellement." });
    }
    if (prev.locked_at) {
      return res.status(409).json({
        error: 'Entretien clôturé et verrouillé — modification refusée.',
        hint: "Réouvrir d'abord l'entretien (POST /milestones/:id/reopen, ADMIN/RH, motif obligatoire).",
        locked_at: prev.locked_at,
      });
    }

    // Historisation d'une modification sur un entretien déjà réalisé (RES-02).
    if (prev.status === 'realise') {
      await snapshotMilestone(pool, prev, 'update', req.user.id);
    }

    // Validation ETI horodatée (D7) : remplace une éventuelle validation « eti »
    // antérieure (le formulaire re-signé remplace la signature précédente ; la
    // trace historique vit dans insertion_milestones_history).
    let validations = prev.validations;
    if (typeof validations === 'string') { try { validations = JSON.parse(validations); } catch (_) { validations = null; } }
    if (!Array.isArray(validations)) validations = [];
    validations = validations.filter((v) => v && v.role !== 'eti');
    validations.push({ role: 'eti', user_id: req.user.id, at: new Date().toISOString(), mode: 'compte' });

    const sets = [];
    const vals = [];
    for (const field of present) {
      let v = req.body[field] === '' ? null : req.body[field];
      if (field === 'renouvellement_form' && v != null) v = JSON.stringify(v);
      vals.push(v);
      sets.push(`${field} = $${vals.length}`);
    }
    vals.push(JSON.stringify(validations));
    sets.push(`validations = $${vals.length}`);
    vals.push(req.params.milestoneId);
    const r = await pool.query(
      `UPDATE insertion_milestones SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    res.json(maskInsertionRow(r.rows[0], baseRoleOf(req)));
  } catch (err) {
    if (err.code === '23514') return res.status(400).json({ error: 'Valeur rejetée par une contrainte de la base', code: err.code });
    console.error('[INSERTION] Erreur renouvellement formulaire :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// BILAN DE PROLONGATION PASS IAE (EXG-02, PR 2) — JSON structuré pour le PDF
// (phase B). Destinataire externe (prescripteur habilité) → SANS axe judiciaire
// (art. 10, EXG-38) et SANS détail santé (art. 9) ; niveaux de freins seuls.
// ADMIN/RH uniquement.
// ══════════════════════════════════════════════════════════════
router.get('/pass-iae/bilan/:employeeId', authorize('ADMIN', 'RH'), [
  param('employeeId').isInt().withMessage('ID employé invalide'),
], validate, async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    const empRes = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.position, e.insertion_status,
              e.insertion_start_date, e.insertion_end_date,
              e.pass_iae_number, e.pass_iae_start, e.pass_iae_end,
              COALESCE(e.parcours_num, 1) AS parcours_num,
              po.nom AS prescripteur_nom, po.type AS prescripteur_type
       FROM employees e
       LEFT JOIN prescripteur_orgas po ON po.id = e.prescripteur_id
       WHERE e.id = $1`,
      [empId]
    );
    if (empRes.rows.length === 0) return res.status(404).json({ error: 'Salarié non trouvé' });
    const emp = empRes.rows[0];
    const pn = Number(emp.parcours_num) || 1;

    const soft = async (label, text, params = []) => {
      try { return (await pool.query(text, params)).rows; }
      catch (err) { console.error(`[INSERTION][PASS-IAE] « ${label} » ignorée (${err.code || '?'}) : ${err.message}`); return []; }
    };

    // Contrats → cumul CDDI (support du bilan de prolongation).
    const contrats = await soft('contrats', 'SELECT contract_type, start_date, end_date FROM employee_contracts WHERE employee_id = $1 ORDER BY start_date', [empId]);
    const cddi = computeCddiCumulativeMonths(contrats);

    // Entretiens du parcours courant (tous statuts — la phase B distingue).
    const entretiens = await soft('entretiens', `
      SELECT id, milestone_type, titre, status, due_date, completed_date, avis_global,
             renouvellement_avis, renouvellement_duree_mois
      FROM insertion_milestones
      WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2
      ORDER BY due_date`, [empId, pn]);

    // Freins : premier vs dernier snapshot — axes du registre SANS judiciaire
    // (destinataire externe). Diagnostic = point de départ ; dernier entretien
    // réalisé portant au moins un frein = point courant.
    const axesExternes = FREINS.filter((f) => f.key !== 'judiciaire');
    const axeCols = axesExternes.map((f) => f.column);
    const diag = await soft('diagnostic', `
      SELECT ${axeCols.join(', ')}, projet_formation, emploi_vise, niveau_formation
      FROM insertion_diagnostics
      WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2`, [empId, pn]);
    const msFreins = await soft('freins_ms', `
      SELECT ${axeCols.join(', ')}, completed_date, due_date
      FROM insertion_milestones
      WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2
        AND status = 'realise' AND COALESCE(${axeCols.join(', ')}) IS NOT NULL
      ORDER BY COALESCE(completed_date, due_date)`, [empId, pn]);
    const premierSrc = diag[0] || msFreins[0] || {};
    const dernierSrc = msFreins.length > 0 ? msFreins[msFreins.length - 1] : (diag[0] || {});
    const freins = axesExternes.map((f) => {
      const premier = premierSrc[f.column] == null ? null : Number(premierSrc[f.column]);
      const dernier = dernierSrc[f.column] == null ? null : Number(dernierSrc[f.column]);
      return {
        key: f.key, label: f.label,
        premier, dernier,
        delta: premier != null && dernier != null ? dernier - premier : null,
      };
    });

    // Objectifs (statuts) — nominatifs par nature (bilan destiné au prescripteur).
    const objectifs = await soft('objectifs', `
      SELECT titre, statut, origine, echeance, date_butoir, parent_id
      FROM insertion_objectifs WHERE employee_id = $1
      ORDER BY parent_id NULLS FIRST, ordre, id`, [empId]);
    const objectifsParStatut = {};
    for (const o of objectifs) objectifsParStatut[o.statut] = (objectifsParStatut[o.statut] || 0) + 1;

    // Actions avec partenaires (art. 5 : nature/objet/date/partenaire/résultat).
    // Minimisation destinataire externe : les actions liées au frein judiciaire
    // sont EXCLUES ; celles liées au frein santé sont comptées mais leur
    // libellé/résultat est masqué (art. 9).
    const actionsRaw = await soft('actions', `
      SELECT a.action_label, a.category, a.frein_type, a.status, a.echeance,
             a.resultat, a.duree_minutes, p.nom AS partenaire_nom
      FROM cip_action_plans a
      LEFT JOIN insertion_partenaires p ON p.id = a.partenaire_id
      WHERE a.employee_id = $1
      ORDER BY a.echeance NULLS LAST, a.created_at`, [empId]);
    const actions = [];
    const actionsParCategorie = {};
    for (const a of actionsRaw) {
      const ft = String(a.frein_type || '').toLowerCase();
      if (ft.includes('judiciaire')) continue; // jamais transmis (art. 10)
      actionsParCategorie[a.category] = (actionsParCategorie[a.category] || 0) + 1;
      if (ft.includes('sante')) {
        actions.push({ category: a.category, status: a.status, echeance: a.echeance, partenaire_nom: a.partenaire_nom, action_label: null, resultat: null, detail_masque: true });
      } else {
        actions.push({ action_label: a.action_label, category: a.category, status: a.status, echeance: a.echeance, partenaire_nom: a.partenaire_nom, resultat: a.resultat, duree_minutes: a.duree_minutes });
      }
    }

    // PMSMP réalisées / en cours.
    const pmsmp = (await soft('pmsmp', `
      SELECT entreprise, objet, date_debut, date_fin, saisie_outil_officiel
      FROM insertion_pmsmp WHERE employee_id = $1 ORDER BY date_debut`, [empId]))
      .map((p) => ({ ...p, jours: pmsmpDays(p.date_debut, p.date_fin) }));

    // Formations repérables : projet exprimé (diagnostic) + actions de montée en
    // compétences / libellés « formation ».
    const formations = {
      projet_formation: diag[0]?.projet_formation || null,
      emploi_vise: diag[0]?.emploi_vise || null,
      niveau_formation: diag[0]?.niveau_formation || null,
      actions_formation: actions.filter((a) => a.category === 'competence' || /formation/i.test(a.action_label || '')),
    };

    res.json({
      genere_le: new Date().toISOString(),
      usage: 'Bilan du parcours en appui de la demande de prolongation du Pass IAE (destinataire : prescripteur habilité).',
      mention: "Document de travail ERP — la demande officielle de prolongation se fait sur les emplois de l'inclusion, qui fait foi.",
      salarie: {
        id: emp.id, first_name: emp.first_name, last_name: emp.last_name,
        poste: emp.position, parcours_num: pn,
      },
      pass_iae: { number: emp.pass_iae_number, start: emp.pass_iae_start, end: emp.pass_iae_end },
      prescripteur: { nom: emp.prescripteur_nom, type: emp.prescripteur_type },
      parcours: {
        insertion_status: emp.insertion_status,
        insertion_start_date: emp.insertion_start_date,
        insertion_end_date: emp.insertion_end_date,
      },
      cddi,
      entretiens,
      freins,
      objectifs: { total: objectifs.length, par_statut: objectifsParStatut, liste: objectifs },
      actions: { total: actions.length, par_categorie: actionsParCategorie, liste: actions },
      pmsmp,
      formations,
    });
  } catch (err) {
    console.error('[INSERTION] Erreur bilan Pass IAE :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// CIBLES CONVENTIONNELLES (EXG-47/D12, PR 2) — settings NULLABLES
// null = « objectif non paramétré » (JAMAIS de valeur inventée — doctrine KPI
// honnêtes). Lecture module ; écriture ADMIN/RH après confirmation direction
// sur le PDF original de l'annexe financière (R-04).
// ══════════════════════════════════════════════════════════════

const INSERTION_CIBLE_KEYS = {
  cible_etp_conventionnes: 'insertion.cible_etp_conventionnes',   // ETP (ex. 24,76)
  cible_taux_dynamiques: 'insertion.cible_taux_dynamiques',       // % 0-100
  cible_taux_durable: 'insertion.cible_taux_durable',             // % 0-100
  cible_taux_transition: 'insertion.cible_taux_transition',       // % 0-100
  cible_taux_positive: 'insertion.cible_taux_positive',           // % 0-100
  effectif_reference: 'insertion.effectif_reference',             // effectif (ex. 46)
};

// Lit les 6 cibles (null si absentes / invalides). Résilient.
async function readCibles() {
  const out = {};
  for (const k of Object.keys(INSERTION_CIBLE_KEYS)) out[k] = null;
  try {
    const r = await pool.query(
      'SELECT key, value FROM settings WHERE key = ANY($1)',
      [Object.values(INSERTION_CIBLE_KEYS)]
    );
    const byKey = new Map(r.rows.map((row) => [row.key, row.value]));
    for (const [name, key] of Object.entries(INSERTION_CIBLE_KEYS)) {
      const v = byKey.get(key);
      if (v == null || v === '') continue;
      const n = parseFloat(v);
      out[name] = Number.isNaN(n) ? null : n;
    }
    // Repli : la cible « dynamiques » historique (objectif-sorties, éditée dans
    // le CohortePanel) reste honorée tant que la nouvelle clé n'est pas posée.
    if (out.cible_taux_dynamiques == null) {
      out.cible_taux_dynamiques = await readObjectifSorties();
    }
  } catch (_) { /* défauts null */ }
  return out;
}

// GET /api/insertion/cibles — lecture (tous rôles du module)
router.get('/cibles', async (req, res) => {
  try {
    res.json({
      ...(await readCibles()),
      note: "null = objectif non paramétré — saisir les valeurs conventionnelles confirmées par la direction (annexe financière), jamais de valeur estimée.",
    });
  } catch (err) {
    console.error('[INSERTION] Erreur cibles GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/insertion/cibles — édition (ADMIN/RH). Champs présents uniquement ;
// null / '' efface (retour à « objectif non paramétré »). Express-validator en
// première ligne (bornes), garde applicative conservée en défense (types).
router.put('/cibles', authorize('ADMIN', 'RH'), [
  body('cible_etp_conventionnes').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }).withMessage('cible_etp_conventionnes : nombre positif attendu (ou null pour effacer)'),
  body('cible_taux_dynamiques').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0, max: 100 }).withMessage('cible_taux_dynamiques : pourcentage 0-100 attendu'),
  body('cible_taux_durable').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0, max: 100 }).withMessage('cible_taux_durable : pourcentage 0-100 attendu'),
  body('cible_taux_transition').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0, max: 100 }).withMessage('cible_taux_transition : pourcentage 0-100 attendu'),
  body('cible_taux_positive').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0, max: 100 }).withMessage('cible_taux_positive : pourcentage 0-100 attendu'),
  body('effectif_reference').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 0 }).withMessage('effectif_reference : nombre positif attendu'),
], validate, async (req, res) => {
  try {
    const d = req.body || {};
    const updates = [];
    for (const [name, key] of Object.entries(INSERTION_CIBLE_KEYS)) {
      if (!(name in d)) continue;
      const raw = d[name];
      let num = null;
      if (raw !== null && raw !== undefined && raw !== '') {
        num = parseFloat(raw);
        if (Number.isNaN(num)) return res.status(400).json({ error: `${name} : nombre attendu (ou null pour effacer).` });
        if (name.startsWith('cible_taux') && (num < 0 || num > 100)) {
          return res.status(400).json({ error: `${name} : pourcentage attendu entre 0 et 100.` });
        }
        if (!name.startsWith('cible_taux') && num < 0) {
          return res.status(400).json({ error: `${name} : valeur positive attendue.` });
        }
      }
      updates.push({ key, value: num == null ? null : String(num) });
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Aucune cible à modifier' });
    for (const u of updates) {
      await pool.query(
        `INSERT INTO settings (key, value, category, updated_at)
         VALUES ($1, $2, 'insertion', NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [u.key, u.value]
      );
    }
    res.json(await readCibles());
  } catch (err) {
    console.error('[INSERTION] Erreur cibles PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/insertion/cohorte/stats — Tableau de bord CIP (algorithmique)
// Toujours disponible (sans dépendance IA) : retards, à-venir, risques,
// répartition des freins, taux de sorties dynamiques.
// IMPORTANT: AVANT /:employeeId.
// ══════════════════════════════════════════════════════════════
router.get('/cohorte/stats', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    // Filtre « mes salariés » (item 61b) : restreint la cohorte au référent CIP courant.
    const mine = req.query.mine === '1' || req.query.mine === 'true';
    const refId = mine ? req.user.id : null;

    // Cohorte active
    const cohorteParams = [];
    let cohorteFilter = '';
    if (mine) { cohorteParams.push(refId); cohorteFilter = ` AND e.cip_referent_user_id = $${cohorteParams.length}`; }
    const cohorte = await pool.query(`
      SELECT e.id, e.first_name, e.last_name, e.insertion_start_date,
             ec.end_date AS contract_end
      FROM employees e
      LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = true
      WHERE e.insertion_status = 'en_parcours' AND e.is_active = true${cohorteFilter}
    `, cohorteParams);

    // Jalons non réalisés des salariés en parcours
    const jalonsParams = [];
    let jalonsFilter = '';
    if (mine) { jalonsParams.push(refId); jalonsFilter = ` AND e.cip_referent_user_id = $${jalonsParams.length}`; }
    // titre / interview_date / ia_preparation_ready (phase D — écart 1a) :
    // l'agenda affiche le libellé réel de l'entretien, l'heure du rendez-vous
    // quand elle est posée, et signale qu'une note de préparation IA existe.
    const jalons = await pool.query(`
      SELECT im.id, im.employee_id, im.milestone_type, im.titre, im.due_date,
             im.interview_date, im.status,
             (im.ia_preparation IS NOT NULL) AS ia_preparation_ready,
             e.first_name, e.last_name,
             (im.due_date - CURRENT_DATE) AS days_until
      FROM insertion_milestones im
      JOIN employees e ON im.employee_id = e.id
      WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
        AND COALESCE(im.parcours_num, 1) = COALESCE(e.parcours_num, 1)
        AND im.status <> 'realise'${jalonsFilter}
      ORDER BY im.due_date
    `, jalonsParams);
    const enRetard = jalons.rows.filter((j) => j.days_until < 0);
    const aVenir7 = jalons.rows.filter((j) => j.days_until >= 0 && j.days_until <= 7);
    // Agenda « Mes prochains entretiens » : jalons non réalisés à échéance dans
    // les 30 prochains jours, triés par date (item 61a).
    const agenda30 = jalons.rows.filter((j) => j.days_until >= 0 && j.days_until <= 30);

    // Salariés à risque : fin de contrat dans 60 jours
    const now = Date.now();
    const aRisque = cohorte.rows
      .filter((c) => c.contract_end)
      .map((c) => ({ id: c.id, first_name: c.first_name, last_name: c.last_name, contract_end: c.contract_end, days: Math.round((new Date(c.contract_end) - now) / 86400000) }))
      .filter((c) => c.days <= 60)
      .sort((a, b) => a.days - b.days);

    // Répartition des freins : dernière évaluation par salarié (jalon réalisé,
    // sinon diagnostic) — 9 axes depuis le registre unique (freins-registry).
    const axes = freinColumns();
    const msCols = axes.map((c) => `im.${c}`).join(', ');
    const dgCols = axes.map((c) => `d.${c}`).join(', ');
    const coalesced = axes.map((c) => `COALESCE(lm.${c}, dg.${c}) AS ${c}`).join(', ');
    const freinsParams = [];
    let freinsFilter = '';
    if (mine) { freinsParams.push(refId); freinsFilter = ` AND e.cip_referent_user_id = $${freinsParams.length}`; }
    const freinsRows = await pool.query(`
      WITH last_ms AS (
        SELECT DISTINCT ON (im.employee_id) im.employee_id, ${msCols}
        FROM insertion_milestones im
        JOIN employees e ON e.id = im.employee_id
        WHERE e.insertion_status='en_parcours' AND e.is_active=true
          AND COALESCE(im.parcours_num, 1) = COALESCE(e.parcours_num, 1)
          AND im.status='realise' AND COALESCE(${msCols}) IS NOT NULL${freinsFilter}
        ORDER BY im.employee_id, im.due_date DESC
      ),
      diag AS (
        SELECT d.employee_id, ${dgCols}
        FROM insertion_diagnostics d
        JOIN employees e ON e.id=d.employee_id
        WHERE e.insertion_status='en_parcours' AND e.is_active=true
          AND COALESCE(d.parcours_num, 1) = COALESCE(e.parcours_num, 1)${freinsFilter}
      )
      SELECT COALESCE(lm.employee_id, dg.employee_id) AS employee_id,
        ${coalesced}
      FROM diag dg FULL OUTER JOIN last_ms lm ON lm.employee_id = dg.employee_id
    `, freinsParams);
    const freinsMoyennes = {};
    let freinDominant = null, maxMoy = 0;
    for (const axe of axes) {
      const vals = freinsRows.rows.map((r) => r[axe]).filter((v) => v != null && +v >= 1);
      const moy = vals.length ? +(vals.reduce((a, b) => a + +b, 0) / vals.length).toFixed(2) : null;
      freinsMoyennes[axe] = moy;
      if (moy && moy > maxMoy) { maxMoy = moy; freinDominant = axe; }
    }

    // Sorties de l'année — NOUVELLE NOMENCLATURE (D8/EXG-06) : une sortie est
    // dynamique si sortie_classification IN (emploi_durable, emploi_transition,
    // sortie_positive) ; taux décomposés par catégorie.
    const sorties = await pool.query(`
      SELECT sortie_classification, sortie_type, COUNT(*)::int AS n
      FROM insertion_milestones
      WHERE milestone_type = 'bilan_sortie' AND status = 'realise'
        AND sortie_classification IS NOT NULL
        AND COALESCE(completed_date, updated_at::date) BETWEEN $1 AND $2
      GROUP BY sortie_classification, sortie_type
    `, [`${year}-01-01`, `${year}-12-31`]);
    const parClassification = {};
    const parType = {};
    let nbDynamiques = 0, nbAutres = 0;
    for (const s of sorties.rows) {
      parClassification[s.sortie_classification] = (parClassification[s.sortie_classification] || 0) + s.n;
      if (DYNAMIC_SORTIE_CLASSES.includes(s.sortie_classification)) nbDynamiques += s.n; else nbAutres += s.n;
      if (s.sortie_type) parType[s.sortie_type] = (parType[s.sortie_type] || 0) + s.n;
    }
    const totalSorties = nbDynamiques + nbAutres;
    const tauxParClassification = {};
    for (const c of SORTIE_CLASSES) {
      tauxParClassification[c] = totalSorties > 0 ? Math.round(((parClassification[c] || 0) / totalSorties) * 100) : null;
    }

    // Objectif conventionné DREETS (item 61c) : taux de sorties dynamiques cible,
    // stocké en settings. Toujours structure-wide (indépendant du filtre « mine »).
    const objectifSorties = await readObjectifSorties();

    res.json({
      annee: year,
      mine,
      nb_actifs: cohorte.rows.length,
      nb_jalons_en_retard: enRetard.length,
      nb_jalons_a_venir: aVenir7.length,
      taux_retard_jalons: jalons.rows.length ? Math.round((enRetard.length / jalons.rows.length) * 100) : 0,
      jalons_en_retard: enRetard,
      jalons_a_venir_7j: aVenir7,
      agenda_30j: agenda30,
      salaries_a_risque: aRisque,
      freins_moyennes: freinsMoyennes,
      frein_dominant: freinDominant,
      objectif_sorties_dynamiques: objectifSorties,
      sorties: {
        total: totalSorties,
        dynamiques: nbDynamiques,
        autres: nbAutres,
        taux_dynamiques: totalSorties > 0 ? Math.round((nbDynamiques / totalSorties) * 100) : null,
        par_classification: parClassification,
        taux_par_classification: tauxParClassification,
        par_type: parType,
      },
    });
  } catch (err) {
    console.error('[INSERTION] Erreur cohorte stats :', err.message, err.detail || '');
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Lit l'objectif conventionné de sorties dynamiques (%) depuis settings.
// Clé : insertion.objectif_sorties_dynamiques. Résilient (retourne null si absent).
const OBJECTIF_SORTIES_KEY = 'insertion.objectif_sorties_dynamiques';
async function readObjectifSorties() {
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [OBJECTIF_SORTIES_KEY]);
    const v = r.rows[0]?.value;
    if (v == null || v === '') return null;
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  } catch (_) { return null; }
}

// GET /api/insertion/objectif-sorties — Objectif conventionné DREETS (%). IMPORTANT: avant /:employeeId.
router.get('/objectif-sorties', async (req, res) => {
  res.json({ objectif: await readObjectifSorties() });
});

// PUT /api/insertion/objectif-sorties — Éditer l'objectif (ADMIN/RH). { objectif: number|null }
router.put('/objectif-sorties', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const raw = req.body?.objectif;
    const num = (raw === null || raw === undefined || raw === '') ? null : parseFloat(raw);
    if (num != null && (Number.isNaN(num) || num < 0 || num > 100)) {
      return res.status(400).json({ error: 'Objectif invalide (attendu : un pourcentage entre 0 et 100).' });
    }
    await pool.query(
      `INSERT INTO settings (key, value, category, updated_at)
       VALUES ($1, $2, 'insertion', NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [OBJECTIF_SORTIES_KEY, num == null ? null : String(num)]
    );
    res.json({ objectif: num });
  } catch (err) {
    console.error('[INSERTION] Erreur objectif-sorties PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/parametres — Réglages du module lus avec leurs DÉFAUTS
// (REC-UX-18 : aucune valeur métier en dur côté frontend). Tous rôles du
// module (lecture seule) ; l'édition passe par la table settings (ADMIN).
// IMPORTANT: avant /:employeeId.
router.get('/parametres', async (req, res) => {
  try {
    const [echeanceActionJours, rythmeBilansMois, delaiDiagnosticJours, alertePassIaeMois, iaPreparationAuto] = await Promise.all([
      readInsertionSetting('insertion.echeance_action_defaut_jours'),
      readInsertionSetting('insertion.rythme_bilans_mois'),
      readInsertionSetting('insertion.delai_diagnostic_jours'),
      readInsertionSetting('insertion.alerte_pass_iae_mois'),
      readInsertionSetting('insertion.ia_preparation_auto'),
    ]);
    res.json({
      echeance_action_defaut_jours: echeanceActionJours,
      rythme_bilans_mois: rythmeBilansMois,
      delai_diagnostic_jours: delaiDiagnosticJours,
      alerte_pass_iae_mois: alertePassIaeMois,
      ia_preparation_auto: iaPreparationAuto,
    });
  } catch (err) {
    console.error('[INSERTION] Erreur parametres :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/insertion/cip-referents — Utilisateurs RH/ADMIN actifs (sélecteur de
// CIP référent). Résout les RÔLES CUSTOM vers leur rôle de base (un utilisateur
// au rôle dupliqué depuis RH est un référent valide — vigilance 03 §6.11).
// IMPORTANT: avant /:employeeId.
router.get('/cip-referents', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, first_name, last_name, role
       FROM users
       WHERE COALESCE(is_active, true) = true
       ORDER BY last_name NULLS LAST, first_name NULLS LAST`
    );
    res.json(r.rows.filter((u) => ['ADMIN', 'RH'].includes(resolveBaseRole(u.role))));
  } catch (err) {
    console.error('[INSERTION] Erreur cip-referents :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// AUDIT INSERTION — Synthèse de la situation d'insertion de la structure
// ══════════════════════════════════════════════════════════════

const MILESTONE_ORDER = MILESTONE_TYPES; // 5 types techniques (extension 2026-07)
const FREIN_AXES = freinColumns(); // 9 axes du registre unique

// Agrège les indicateurs chiffrés de l'audit. Résilient : chaque requête qui
// échoue (colonne absente sur base ancienne) dégrade au lieu de tout casser.
async function gatherAuditKpis(year) {
  const soft = async (label, text, params = []) => {
    try { return (await pool.query(text, params)).rows; }
    catch (err) { console.error(`[INSERTION][AUDIT] « ${label} » ignorée (${err.code || '?'}) : ${err.message}`); return []; }
  };

  // Nombre de salariés en parcours
  const enParcours = await soft('en_parcours',
    `SELECT COUNT(*)::int AS n FROM employees WHERE insertion_status = 'en_parcours' AND is_active = true`);
  const nbEnParcours = enParcours[0]?.n || 0;

  // Taux de réalisation des jalons par type (échéance)
  const msRows = await soft('milestones', `
    SELECT im.milestone_type AS type,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE im.due_date <= CURRENT_DATE)::int AS echus,
      COUNT(*) FILTER (WHERE im.status = 'realise')::int AS realises,
      COUNT(*) FILTER (WHERE im.status = 'realise' AND im.due_date <= CURRENT_DATE)::int AS realises_echus
    FROM insertion_milestones im
    JOIN employees e ON e.id = im.employee_id
    WHERE e.is_active = true
      AND COALESCE(im.parcours_num, 1) = COALESCE(e.parcours_num, 1)
    GROUP BY im.milestone_type`);
  const msByType = {};
  for (const r of msRows) msByType[r.type] = r;
  const milestonesParType = MILESTONE_ORDER.map((type) => {
    const r = msByType[type] || { total: 0, echus: 0, realises: 0, realises_echus: 0 };
    return {
      type,
      label: MILESTONE_TYPE_LABELS[type] || type,
      total: r.total, echus: r.echus, realises: r.realises, realises_echus: r.realises_echus,
      taux_echeance: r.echus ? Math.round((r.realises_echus / r.echus) * 100) : null,
    };
  });
  const g = milestonesParType.reduce((a, m) => ({
    total: a.total + m.total, echus: a.echus + m.echus,
    realises: a.realises + m.realises, realises_echus: a.realises_echus + m.realises_echus,
  }), { total: 0, echus: 0, realises: 0, realises_echus: 0 });
  const milestonesGlobal = { ...g, taux: g.echus ? Math.round((g.realises_echus / g.echus) * 100) : null };

  // Freins consolidés (dernière éval par salarié : jalon réalisé sinon
  // diagnostic) — 9 axes depuis le registre unique.
  const auditMsCols = FREIN_AXES.map((c) => `im.${c}`).join(', ');
  const auditDgCols = FREIN_AXES.map((c) => `d.${c}`).join(', ');
  const auditCoalesced = FREIN_AXES.map((c) => `COALESCE(lm.${c}, dg.${c}) AS ${c}`).join(', ');
  const freinsRows = await soft('freins', `
    WITH last_ms AS (
      SELECT DISTINCT ON (im.employee_id) im.employee_id, ${auditMsCols}
      FROM insertion_milestones im
      JOIN employees e ON e.id = im.employee_id
      WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
        AND COALESCE(im.parcours_num, 1) = COALESCE(e.parcours_num, 1)
        AND im.status = 'realise' AND COALESCE(${auditMsCols}) IS NOT NULL
      ORDER BY im.employee_id, im.due_date DESC
    ),
    diag AS (
      SELECT d.employee_id, ${auditDgCols}
      FROM insertion_diagnostics d
      JOIN employees e ON e.id = d.employee_id
      WHERE e.insertion_status = 'en_parcours' AND e.is_active = true
        AND COALESCE(d.parcours_num, 1) = COALESCE(e.parcours_num, 1)
    )
    SELECT ${auditCoalesced}
    FROM diag dg FULL OUTER JOIN last_ms lm ON lm.employee_id = dg.employee_id`);
  const freinsMoyennes = {};
  let freinDominant = null, maxMoy = 0, nbEvalues = 0;
  for (const axe of FREIN_AXES) {
    const vals = freinsRows.map((r) => r[axe]).filter((v) => v != null && +v >= 1);
    if (vals.length > nbEvalues) nbEvalues = vals.length;
    const moy = vals.length ? +(vals.reduce((a, b) => a + +b, 0) / vals.length).toFixed(2) : null;
    freinsMoyennes[axe] = moy;
    if (moy && moy > maxMoy) { maxMoy = moy; freinDominant = axe; }
  }

  // Plans d'action en cours
  const actRows = await soft('actions', `
    SELECT a.status, a.category, a.priority, COUNT(*)::int AS n
    FROM cip_action_plans a
    JOIN employees e ON e.id = a.employee_id
    WHERE e.is_active = true AND a.status IN ('a_faire', 'en_cours')
    GROUP BY a.status, a.category, a.priority`);
  const actions = { total_en_cours: 0, par_statut: {}, par_categorie: {}, par_priorite: {} };
  for (const r of actRows) {
    actions.total_en_cours += r.n;
    actions.par_statut[r.status] = (actions.par_statut[r.status] || 0) + r.n;
    if (r.category) actions.par_categorie[r.category] = (actions.par_categorie[r.category] || 0) + r.n;
    if (r.priority) actions.par_priorite[r.priority] = (actions.par_priorite[r.priority] || 0) + r.n;
  }

  // Sorties de l'année + statistiques — nouvelle nomenclature à 4 catégories
  // (dynamique = emploi_durable + emploi_transition + sortie_positive).
  const sortiesRows = await soft('sorties', `
    SELECT sortie_classification, sortie_type, COUNT(*)::int AS n
    FROM insertion_milestones
    WHERE milestone_type = 'bilan_sortie' AND status = 'realise'
      AND sortie_classification IS NOT NULL
      AND COALESCE(completed_date, updated_at::date) BETWEEN $1 AND $2
    GROUP BY sortie_classification, sortie_type`, [`${year}-01-01`, `${year}-12-31`]);
  const parClassification = {};
  const parType = {};
  let nbDynamiques = 0, nbAutres = 0;
  for (const s of sortiesRows) {
    parClassification[s.sortie_classification] = (parClassification[s.sortie_classification] || 0) + s.n;
    if (DYNAMIC_SORTIE_CLASSES.includes(s.sortie_classification)) nbDynamiques += s.n; else nbAutres += s.n;
    if (s.sortie_type) parType[s.sortie_type] = (parType[s.sortie_type] || 0) + s.n;
  }
  const totalSorties = nbDynamiques + nbAutres;
  const tauxParClassification = {};
  for (const c of SORTIE_CLASSES) {
    tauxParClassification[c] = totalSorties > 0 ? Math.round(((parClassification[c] || 0) / totalSorties) * 100) : null;
  }
  const tauxDynamiques = totalSorties > 0 ? Math.round((nbDynamiques / totalSorties) * 100) : null;

  // ── Extension PR 2 (EXG-10/14/24/47, §6bis-2) ──────────────────────────────

  // Typologies des publics — parcours COURANT (en_parcours actifs) : RQTH
  // (booléen structuré du diagnostic, repli sur le texte disability_status de
  // l'import paie), ressources perçues, niveaux de formation (nomenclature
  // officielle du diagnostic), tranches d'âge NON nominatives (ageBracket de
  // pii-pseudonymize — jamais la date de naissance en restitution).
  const typoRows = await soft('typologies', `
    SELECT e.birth_date, e.disability_status, d.rqth, d.ressources, d.niveau_formation
    FROM employees e
    LEFT JOIN insertion_diagnostics d ON d.employee_id = e.id
      AND COALESCE(d.parcours_num, 1) = COALESCE(e.parcours_num, 1)
    WHERE e.insertion_status = 'en_parcours' AND e.is_active = true`);
  const typologies = { effectif: typoRows.length, rqth: 0, ressources: {}, niveaux_formation: {}, tranches_age: {} };
  for (const r of typoRows) {
    const rqth = r.rqth === true
      || (r.rqth == null && r.disability_status != null && String(r.disability_status).trim() !== '');
    if (rqth) typologies.rqth += 1;
    if (Array.isArray(r.ressources)) {
      for (const src of r.ressources) {
        if (src) typologies.ressources[src] = (typologies.ressources[src] || 0) + 1;
      }
    }
    if (r.niveau_formation) {
      typologies.niveaux_formation[r.niveau_formation] = (typologies.niveaux_formation[r.niveau_formation] || 0) + 1;
    }
    const tranche = ageBracket(r.birth_date);
    if (tranche) typologies.tranches_age[tranche] = (typologies.tranches_age[tranche] || 0) + 1;
  }

  // Délai moyen de réalisation du diagnostic d'accueil (jours entre l'entrée en
  // parcours et la réalisation) — diagnostics réalisés dans l'année.
  const delaiRows = await soft('delai_diagnostic', `
    SELECT AVG(im.completed_date - e.insertion_start_date)::numeric AS delai_jours,
           COUNT(*)::int AS nb
    FROM insertion_milestones im
    JOIN employees e ON e.id = im.employee_id
    WHERE im.milestone_type = 'diagnostic_accueil' AND im.status = 'realise'
      AND im.completed_date IS NOT NULL AND e.insertion_start_date IS NOT NULL
      AND im.completed_date >= e.insertion_start_date
      AND im.completed_date BETWEEN $1 AND $2`, [`${year}-01-01`, `${year}-12-31`]);
  const delaiMoyenDiagnostic = delaiRows[0] && delaiRows[0].delai_jours != null
    ? Math.round(Number(delaiRows[0].delai_jours)) : null;

  // ETP réalisés APPROCHÉS — contrôle ERP uniquement (EXG-10) : somme des
  // weekly_hours/35 des CDDI actifs (contrat courant, repli fiche). La valeur
  // OFFICIELLE reste celle des états mensuels de présence ASP (base 1 820 h).
  const etpRows = await soft('etp_realises', `
    SELECT COALESCE(SUM(COALESCE(ec.weekly_hours, e.weekly_hours, 35)::numeric / 35), 0) AS etp,
           COUNT(*)::int AS nb
    FROM employees e
    LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = true
    WHERE e.is_active = true
      AND UPPER(COALESCE(ec.contract_type, e.contract_type, '')) = 'CDDI'`);
  const etpRealisesApprox = {
    valeur: etpRows[0] ? Math.round(Number(etpRows[0].etp) * 100) / 100 : null,
    nb_cddi_actifs: etpRows[0] ? etpRows[0].nb : 0,
    source: 'controle_erp',
    note: "Approximation ERP (somme heures hebdo / 35 des CDDI actifs) — saisie officielle : ASP (états mensuels de présence).",
  };

  // Compteurs PMSMP de l'année (EXG-05/10) : conventions démarrées dans l'année
  // + volume de jours calendaires.
  const pmsmpRows = await soft('pmsmp_annee', `
    SELECT COUNT(*)::int AS nb,
           COALESCE(SUM(p.date_fin - p.date_debut + 1), 0)::int AS jours,
           COUNT(DISTINCT p.employee_id)::int AS nb_salaries
    FROM insertion_pmsmp p
    WHERE p.date_debut BETWEEN $1 AND $2`, [`${year}-01-01`, `${year}-12-31`]);
  const pmsmp = pmsmpRows[0]
    ? { nb: pmsmpRows[0].nb, jours: pmsmpRows[0].jours, nb_salaries: pmsmpRows[0].nb_salaries }
    : { nb: 0, jours: 0, nb_salaries: 0 };

  // Satisfaction de sortie de l'année (EXG-09) — agrégat anonyme.
  const satRows = await soft('satisfaction_annee', `
    SELECT COUNT(*)::int AS nb,
           ROUND(AVG(satisfaction_globale)::numeric, 2) AS moyenne
    FROM insertion_satisfaction_sortie
    WHERE EXTRACT(YEAR FROM COALESCE(date_reponse, created_at::date)) = $1`, [year]);
  const satisfaction = {
    nb_reponses: satRows[0] ? satRows[0].nb : 0,
    moyenne_globale: satRows[0] && satRows[0].moyenne != null ? Number(satRows[0].moyenne) : null,
  };

  // Bloc conventionnel (EXG-47/D12) : taux réalisés vs cibles paramétrées.
  // Cible absente → null = « objectif non paramétré » (JAMAIS de valeur
  // inventée). Dénominateur documenté (RES-09) : sorties CONSTATÉES de l'année
  // = bilans de sortie réalisés portant une classification (année civile).
  const cibles = await readCibles();
  const tauxRealises = {
    dynamiques: tauxDynamiques,
    emploi_durable: tauxParClassification.emploi_durable,
    emploi_transition: tauxParClassification.emploi_transition,
    sortie_positive: tauxParClassification.sortie_positive,
  };
  const ecart = (realise, cible) => (realise != null && cible != null
    ? Math.round((realise - cible) * 10) / 10 : null);
  const conventionnel = {
    cibles,
    taux_realises: tauxRealises,
    ecarts: {
      dynamiques: ecart(tauxRealises.dynamiques, cibles.cible_taux_dynamiques),
      emploi_durable: ecart(tauxRealises.emploi_durable, cibles.cible_taux_durable),
      emploi_transition: ecart(tauxRealises.emploi_transition, cibles.cible_taux_transition),
      sortie_positive: ecart(tauxRealises.sortie_positive, cibles.cible_taux_positive),
      etp: ecart(etpRealisesApprox.valeur, cibles.cible_etp_conventionnes),
    },
    methode: "Taux calculés sur les sorties constatées de l'année civile (dénominateur = bilans de sortie réalisés portant une classification — changement de méthode 2026). Cible null = objectif non paramétré.",
  };

  return {
    annee: year,
    nb_en_parcours: nbEnParcours,
    freins_nb_evalues: nbEvalues,
    milestones: { par_type: milestonesParType, global: milestonesGlobal },
    freins_moyennes: freinsMoyennes,
    frein_dominant: freinDominant,
    actions,
    sorties: {
      total: totalSorties,
      dynamiques: nbDynamiques,
      autres: nbAutres,
      taux_dynamiques: tauxDynamiques,
      par_classification: parClassification,
      taux_par_classification: tauxParClassification,
      par_type: parType,
    },
    // ── Blocs PR 2 (EXG-10/14/24/47) ──
    conventionnel,
    typologies,
    delai_moyen_diagnostic_jours: delaiMoyenDiagnostic,
    etp_realises_approx: etpRealisesApprox,
    pmsmp,
    satisfaction,
    // Convergence (CVG, §6bis-2) : bloc réservé — le paramétrage précis attend
    // la trame de reporting CVG demandée à la direction ; les indicateurs
    // génériques (freins, sorties, actions) sont déjà couverts ci-dessus.
    cvg: { statut: 'trame_en_attente', note: 'Indicateurs CVG à paramétrer à réception de la trame de reporting Convergence (décision direction du 23/07/2026).' },
  };
}

// Collecte les verbatims (anonymisés) des CIP/agents pour le rapport IA.
async function gatherAuditVerbatims() {
  const soft = async (text) => { try { return (await pool.query(text)).rows; } catch { return []; } };
  const observations = await soft(`
    SELECT d.obs_points_forts, d.obs_difficultes, d.obs_comportement_equipe, d.parcours_anterieur
    FROM insertion_diagnostics d JOIN employees e ON e.id = d.employee_id
    WHERE e.is_active = true
      AND (d.obs_points_forts IS NOT NULL OR d.obs_difficultes IS NOT NULL OR d.obs_comportement_equipe IS NOT NULL)
    LIMIT 60`);
  const bilans = await soft(`
    SELECT im.milestone_type, im.avis_global, im.bilan_professionnel, im.bilan_social, im.observations
    FROM insertion_milestones im JOIN employees e ON e.id = im.employee_id
    WHERE e.is_active = true AND im.status = 'realise'
      AND (im.bilan_professionnel IS NOT NULL OR im.bilan_social IS NOT NULL OR im.observations IS NOT NULL)
    ORDER BY im.completed_date DESC NULLS LAST LIMIT 80`);
  const notesActions = await soft(`
    SELECT a.category, a.notes FROM cip_action_plans a JOIN employees e ON e.id = a.employee_id
    WHERE e.is_active = true AND a.notes IS NOT NULL AND a.notes <> '' LIMIT 60`);
  return { observations_diagnostics: observations, bilans_jalons: bilans, notes_actions: notesActions };
}

// GET /api/insertion/audit — Indicateurs chiffrés de l'audit (sans IA).
// IMPORTANT: AVANT /:employeeId.
router.get('/audit', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    res.json(await gatherAuditKpis(year));
  } catch (err) {
    console.error('[INSERTION][AUDIT] Erreur :', err.message);
    res.status(500).json({ error: 'Erreur serveur', detail: err.message });
  }
});

// GET /api/insertion/audit/ia — Rapport IA de situation globale (ADMIN/RH).
// Croise indicateurs chiffrés + verbatims anonymisés CIP/agents.
router.get('/audit/ia', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const [kpis, verbatims] = await Promise.all([gatherAuditKpis(year), gatherAuditVerbatims()]);
    const { auditGlobalReport } = require('../../services/insertion-ai');
    res.json(await auditGlobalReport({ kpis, verbatims }));
  } catch (err) {
    handleIaError(res, err, 'audit');
  }
});

// PUT /api/insertion/:employeeId/cip-referent — Affecter/retirer le CIP référent
// (ADMIN/RH). Body : { user_id: number|null }. Valide que l'utilisateur est un
// référent RH/ADMIN actif. Chemin à 2 segments → non capturé par GET /:employeeId.
router.put('/:employeeId/cip-referent', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    if (Number.isNaN(empId)) return res.status(400).json({ error: 'ID employé invalide' });
    const raw = req.body?.user_id;
    let userId = null;
    if (raw !== null && raw !== undefined && raw !== '') {
      userId = parseInt(raw, 10);
      if (Number.isNaN(userId)) return res.status(400).json({ error: 'user_id invalide' });
      const u = await pool.query(
        `SELECT id, role FROM users WHERE id = $1 AND COALESCE(is_active, true) = true`,
        [userId]
      );
      if (u.rows.length === 0 || !['ADMIN', 'RH'].includes(resolveBaseRole(u.rows[0].role))) {
        return res.status(400).json({ error: 'Référent invalide (doit être un utilisateur RH/ADMIN actif).' });
      }
    }
    const r = await pool.query(
      `UPDATE employees SET cip_referent_user_id = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, cip_referent_user_id`,
      [userId, empId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Salarié non trouvé' });
    let nom = null;
    if (userId) {
      const n = await pool.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
      if (n.rows[0]) nom = `${n.rows[0].first_name || ''} ${n.rows[0].last_name || ''}`.trim();
    }
    res.json({ ...r.rows[0], cip_referent_nom: nom });
  } catch (err) {
    console.error('[INSERTION] Erreur cip-referent PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// LOT 8 (PR3) — GRILLES DE COMPÉTENCES par filière (EXG-26/27) + espace ETI
// Référentiel ADMINISTRABLE (écriture ADMIN) ; évaluations saisissables par
// l'ETI (MANAGER) ET la CIP (ADMIN/RH). Les compétences ne portent AUCUNE
// donnée art. 9/10 → l'ETI y est légitime, le masking du diagnostic social
// continue de s'appliquer aux AUTRES endpoints. N/E (non_evalue) exclu des
// moyennes (competenceAverage). Chemins ≥ 2 segments ou non numériques → placés
// AVANT GET /:employeeId. NB périmètre : faute de lien schéma fiable
// encadrant→équipe (table teams sans manager_user_id), l'accès MANAGER n'est
// pas restreint par équipe — même périmètre que le formulaire de renouvellement
// (voie ETI existante).
// ══════════════════════════════════════════════════════════════

const COMPETENCE_FILIERES = ['tri', 'collecte', 'logistique', 'boutique', 'transverse'];

// GET /api/insertion/competence-referentiels?filiere=&actifs=1 — grille administrable
router.get('/competence-referentiels', [
  query('filiere').optional().isIn(COMPETENCE_FILIERES).withMessage('filiere invalide'),
], validate, async (req, res) => {
  try {
    const params = [];
    const where = [];
    if (req.query.filiere) { params.push(req.query.filiere); where.push(`filiere = $${params.length}`); }
    if (req.query.actifs === '1' || req.query.actifs === 'true') where.push('actif = true');
    const r = await pool.query(
      `SELECT * FROM insertion_competence_referentiels
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY filiere, rubrique, ordre, item`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[INSERTION] Erreur competence-referentiels GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/insertion/competence-referentiels — créer un item (ADMIN)
router.post('/competence-referentiels', authorize('ADMIN'), [
  body('filiere').isIn(COMPETENCE_FILIERES).withMessage(`filiere invalide (${COMPETENCE_FILIERES.join(', ')})`),
  body('rubrique').isString().trim().notEmpty().isLength({ max: 120 }).withMessage('rubrique requise (120 car. max)'),
  body('item').isString().trim().notEmpty().isLength({ max: 200 }).withMessage('item requis (200 car. max)'),
  body('ordre').optional({ nullable: true }).isInt().withMessage('ordre invalide'),
  body('actif').optional({ nullable: true }).isBoolean().withMessage('actif invalide'),
], validate, async (req, res) => {
  try {
    const d = req.body;
    const r = await pool.query(
      `INSERT INTO insertion_competence_referentiels (filiere, rubrique, item, ordre, actif)
       VALUES ($1, $2, $3, $4, COALESCE($5, true)) RETURNING *`,
      [d.filiere, d.rubrique.trim(), d.item.trim(), Number.isInteger(d.ordre) ? d.ordre : 0,
        typeof d.actif === 'boolean' ? d.actif : null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cet item existe déjà pour cette filière et cette rubrique.' });
    console.error('[INSERTION] Erreur competence-referentiels POST :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/insertion/competence-referentiels/:id — modifier (ADMIN)
router.put('/competence-referentiels/:id', authorize('ADMIN'), [
  param('id').isInt().withMessage('ID invalide'),
  body('filiere').optional().isIn(COMPETENCE_FILIERES).withMessage('filiere invalide'),
  body('rubrique').optional().isString().trim().notEmpty().isLength({ max: 120 }).withMessage('rubrique invalide'),
  body('item').optional().isString().trim().notEmpty().isLength({ max: 200 }).withMessage('item invalide'),
  body('ordre').optional({ nullable: true }).isInt().withMessage('ordre invalide'),
  body('actif').optional({ nullable: true }).isBoolean().withMessage('actif invalide'),
], validate, async (req, res) => {
  try {
    const d = req.body;
    const editable = ['filiere', 'rubrique', 'item', 'ordre', 'actif'];
    const sets = []; const vals = [];
    for (const f of editable) { if (!(f in d)) continue; vals.push(d[f] === '' ? null : d[f]); sets.push(`${f} = $${vals.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });
    vals.push(req.params.id);
    const r = await pool.query(`UPDATE insertion_competence_referentiels SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Item non trouvé' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cet item existe déjà pour cette filière et cette rubrique.' });
    console.error('[INSERTION] Erreur competence-referentiels PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/insertion/competence-referentiels/:id — supprimer (ADMIN)
// Les scores déjà saisis conservent leur snapshot rubrique/item (FK SET NULL).
router.delete('/competence-referentiels/:id', authorize('ADMIN'), [
  param('id').isInt().withMessage('ID invalide'),
], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM insertion_competence_referentiels WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Item non trouvé' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[INSERTION] Erreur competence-referentiels DELETE :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Insère les scores d'une évaluation. Snapshot rubrique/item depuis le
// référentiel (résiste à une suppression ultérieure de l'item). N/E =
// non_evalue===true OU note vide → note NULL. Note contrôlée 0-10.
async function insertCompetenceScores(client, evaluationId, scores) {
  if (!Array.isArray(scores) || scores.length === 0) return 0;
  const refIds = [...new Set(scores.map((s) => s && s.referentiel_id).filter((x) => x != null))];
  const refMap = new Map();
  if (refIds.length > 0) {
    const r = await client.query('SELECT id, rubrique, item FROM insertion_competence_referentiels WHERE id = ANY($1::int[])', [refIds]);
    for (const row of r.rows) refMap.set(Number(row.id), row);
  }
  let n = 0;
  for (const s of scores) {
    if (!s || typeof s !== 'object') continue;
    const ref = s.referentiel_id != null ? refMap.get(Number(s.referentiel_id)) : null;
    const nonEval = s.non_evalue === true || s.note == null || s.note === '';
    let note = null;
    if (!nonEval) {
      note = parseInt(s.note, 10);
      if (Number.isNaN(note) || note < 0 || note > 10) { const err = new Error('note hors bornes'); err.code = 'COMP_NOTE'; throw err; }
    }
    await client.query(
      `INSERT INTO insertion_competence_scores (evaluation_id, referentiel_id, rubrique, item, note, non_evalue, observation, objectif)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [evaluationId, s.referentiel_id != null ? s.referentiel_id : null,
        (s.rubrique && String(s.rubrique).trim()) || (ref ? ref.rubrique : null),
        (s.item && String(s.item).trim()) || (ref ? ref.item : null),
        note, nonEval, s.observation || null, s.objectif || null]
    );
    n++;
  }
  return n;
}

// GET /api/insertion/competences/:employeeId — évaluations + scores (module,
// MANAGER inclus). Chaque évaluation porte ses scores et sa moyenne (N/E exclu).
router.get('/competences/:employeeId', [
  param('employeeId').isInt().withMessage('ID employé invalide'),
], validate, async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    const evals = await pool.query(
      `SELECT ev.*, u.first_name AS evaluateur_first, u.last_name AS evaluateur_last
       FROM insertion_competence_evaluations ev
       LEFT JOIN users u ON u.id = ev.evaluateur_id
       WHERE ev.employee_id = $1
       ORDER BY ev.date_evaluation DESC NULLS LAST, ev.id DESC`,
      [empId]
    );
    const ids = evals.rows.map((e) => e.id);
    const scoresByEval = new Map();
    if (ids.length > 0) {
      const sc = await pool.query(
        `SELECT s.*, r.rubrique AS ref_rubrique, r.item AS ref_item, r.actif AS ref_actif
         FROM insertion_competence_scores s
         LEFT JOIN insertion_competence_referentiels r ON r.id = s.referentiel_id
         WHERE s.evaluation_id = ANY($1::int[])
         ORDER BY s.id`,
        [ids]
      );
      for (const row of sc.rows) {
        row.rubrique = row.rubrique || row.ref_rubrique;
        row.item = row.item || row.ref_item;
        if (!scoresByEval.has(row.evaluation_id)) scoresByEval.set(row.evaluation_id, []);
        scoresByEval.get(row.evaluation_id).push(row);
      }
    }
    const out = evals.rows.map((e) => {
      const scores = scoresByEval.get(e.id) || [];
      return { ...e, scores, moyenne: competenceAverage(scores).moyenne };
    });
    res.json(out);
  } catch (err) {
    console.error('[INSERTION] Erreur competences GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/insertion/competences — créer une évaluation + ses scores
// (ADMIN/RH/MANAGER — l'ETI est un évaluateur légitime). Transactionnel.
router.post('/competences', authorize('ADMIN', 'RH', 'MANAGER'), [
  body('employee_id').isInt().withMessage('ID employé requis'),
  body('filiere').optional({ nullable: true }).isIn(COMPETENCE_FILIERES).withMessage('filiere invalide'),
  body('statut').optional({ nullable: true }).isIn(['brouillon', 'valide']).withMessage('statut invalide (brouillon/valide)'),
  body('date_evaluation').optional({ nullable: true }).isISO8601().withMessage('date_evaluation invalide'),
  body('periode').optional({ nullable: true }).isLength({ max: 20 }).withMessage('periode trop longue (20 max)'),
  body('scores').optional({ nullable: true }).isArray().withMessage('scores doit être un tableau'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const d = req.body;
    const emp = await client.query('SELECT id FROM employees WHERE id = $1', [d.employee_id]);
    if (emp.rows.length === 0) { client.release(); return res.status(404).json({ error: 'Salarié non trouvé' }); }
    const pn = await currentParcoursNum(client, d.employee_id);
    await client.query('BEGIN');
    const ev = await client.query(
      `INSERT INTO insertion_competence_evaluations
         (employee_id, parcours_num, filiere, periode, date_evaluation, evaluateur_id, statut, validations, synthese, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'brouillon'), $8, $9, $10) RETURNING *`,
      [d.employee_id, pn, d.filiere || null, d.periode || null, d.date_evaluation || null,
        req.user.id, d.statut || null, d.validations != null ? JSON.stringify(d.validations) : null,
        d.synthese || null, req.user.id]
    );
    const evaluation = ev.rows[0];
    await insertCompetenceScores(client, evaluation.id, d.scores);
    await client.query('COMMIT');
    const scoresRes = await pool.query('SELECT * FROM insertion_competence_scores WHERE evaluation_id = $1 ORDER BY id', [evaluation.id]);
    res.status(201).json({ ...evaluation, scores: scoresRes.rows, moyenne: competenceAverage(scoresRes.rows).moyenne });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === 'COMP_NOTE') return res.status(400).json({ error: 'Note de compétence hors bornes (0-10) — utilisez N/E (non_evalue) pour un item non évalué.' });
    if (err.code === '23503') return res.status(400).json({ error: 'Référence invalide (salarié ou item de référentiel inexistant).' });
    console.error('[INSERTION] Erreur competences POST :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// PUT /api/insertion/competences/:id — modifier l'évaluation (statut,
// validations…) et REMPLACER ses scores si `scores` est fourni (ADMIN/RH/MANAGER).
router.put('/competences/:id', authorize('ADMIN', 'RH', 'MANAGER'), [
  param('id').isInt().withMessage('ID invalide'),
  body('statut').optional({ nullable: true }).isIn(['brouillon', 'valide']).withMessage('statut invalide'),
  body('filiere').optional({ nullable: true }).isIn(COMPETENCE_FILIERES).withMessage('filiere invalide'),
  body('date_evaluation').optional({ nullable: true }).isISO8601().withMessage('date_evaluation invalide'),
  body('periode').optional({ nullable: true }).isLength({ max: 20 }).withMessage('periode trop longue (20 max)'),
  body('scores').optional({ nullable: true }).isArray().withMessage('scores doit être un tableau'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const d = req.body;
    const cur = await client.query('SELECT id FROM insertion_competence_evaluations WHERE id = $1', [req.params.id]);
    if (cur.rows.length === 0) { client.release(); return res.status(404).json({ error: 'Évaluation non trouvée' }); }
    await client.query('BEGIN');
    const editable = ['filiere', 'periode', 'date_evaluation', 'statut', 'synthese'];
    const sets = []; const vals = [];
    for (const f of editable) { if (!(f in d)) continue; vals.push(d[f] === '' ? null : d[f]); sets.push(`${f} = $${vals.length}`); }
    if ('validations' in d) { vals.push(d.validations != null ? JSON.stringify(d.validations) : null); sets.push(`validations = $${vals.length}`); }
    if (sets.length > 0) {
      vals.push(req.params.id);
      await client.query(`UPDATE insertion_competence_evaluations SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`, vals);
    }
    if (Array.isArray(d.scores)) {
      await client.query('DELETE FROM insertion_competence_scores WHERE evaluation_id = $1', [req.params.id]);
      await insertCompetenceScores(client, req.params.id, d.scores);
    }
    await client.query('COMMIT');
    const ev = await pool.query('SELECT * FROM insertion_competence_evaluations WHERE id = $1', [req.params.id]);
    const scoresRes = await pool.query('SELECT * FROM insertion_competence_scores WHERE evaluation_id = $1 ORDER BY id', [req.params.id]);
    res.json({ ...ev.rows[0], scores: scoresRes.rows, moyenne: competenceAverage(scoresRes.rows).moyenne });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === 'COMP_NOTE') return res.status(400).json({ error: 'Note de compétence hors bornes (0-10) — utilisez N/E (non_evalue) pour un item non évalué.' });
    if (err.code === '23503') return res.status(400).json({ error: 'Référence invalide (item de référentiel inexistant).' });
    console.error('[INSERTION] Erreur competences PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// DELETE /api/insertion/competences/:id — supprimer une évaluation (ADMIN/RH ;
// scores en CASCADE).
router.delete('/competences/:id', authorize('ADMIN', 'RH'), [
  param('id').isInt().withMessage('ID invalide'),
], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM insertion_competence_evaluations WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Évaluation non trouvée' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[INSERTION] Erreur competences DELETE :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// LOT 8 (PR3) — CHECKLIST D'EMBAUCHE (EXG-30 / PROP-05)
// Une checklist par salarié, items JSONB. Écriture ADMIN/RH, lecture module
// (MANAGER inclus). Pas de moteur d'état (ERP léger). AVANT GET /:employeeId.
// ══════════════════════════════════════════════════════════════

const CHECKLIST_STEPS = ['promesse_embauche', 'contrat_signe', 'mutuelle', 'charte_insertion', 'livret_accueil', 'reglement_interieur', 'formation_poste'];

// Normalise les items stockés vers une forme complète (le front n'a pas à gérer
// les absences) : chaque step → { fait, date, responsable }.
function normalizeChecklistItems(items) {
  const src = items || {};
  const out = {};
  for (const step of CHECKLIST_STEPS) {
    const it = src[step] || {};
    out[step] = { fait: it.fait === true, date: it.date || null, responsable: it.responsable || null };
  }
  return out;
}

// GET /api/insertion/checklist-embauche/:employeeId — lecture (module)
router.get('/checklist-embauche/:employeeId', [
  param('employeeId').isInt().withMessage('ID employé invalide'),
], validate, async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    const r = await pool.query('SELECT * FROM insertion_checklist_embauche WHERE employee_id = $1', [empId]);
    res.json({
      employee_id: empId,
      exists: r.rows.length > 0,
      steps: CHECKLIST_STEPS,
      items: normalizeChecklistItems(r.rows[0]?.items),
      updated_at: r.rows[0]?.updated_at || null,
    });
  } catch (err) {
    console.error('[INSERTION] Erreur checklist-embauche GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/insertion/checklist-embauche/:employeeId — upsert idempotent (ADMIN/RH).
// Fusion : les steps absents du body conservent leur valeur enregistrée ; un
// step à null est retiré ; les steps inconnus sont ignorés.
router.put('/checklist-embauche/:employeeId', authorize('ADMIN', 'RH'), [
  param('employeeId').isInt().withMessage('ID employé invalide'),
  body('items').isObject().withMessage('items (objet) requis'),
], validate, async (req, res) => {
  try {
    const empId = parseInt(req.params.employeeId, 10);
    const emp = await pool.query('SELECT id FROM employees WHERE id = $1', [empId]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Salarié non trouvé' });

    const cur = await pool.query('SELECT items FROM insertion_checklist_embauche WHERE employee_id = $1', [empId]);
    const merged = { ...(cur.rows[0]?.items || {}) };
    for (const [step, val] of Object.entries(req.body.items || {})) {
      if (!CHECKLIST_STEPS.includes(step)) continue; // ignore les steps inconnus
      if (val == null) { delete merged[step]; continue; }
      merged[step] = {
        fait: val.fait === true,
        date: val.date || null,
        responsable: val.responsable != null && val.responsable !== '' ? String(val.responsable).slice(0, 150) : null,
      };
    }
    const r = await pool.query(
      `INSERT INTO insertion_checklist_embauche (employee_id, items, created_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (employee_id) DO UPDATE SET items = $2, updated_at = NOW()
       RETURNING *`,
      [empId, JSON.stringify(merged), req.user.id]
    );
    res.json({ ...r.rows[0], items: normalizeChecklistItems(r.rows[0].items), steps: CHECKLIST_STEPS });
  } catch (err) {
    console.error('[INSERTION] Erreur checklist-embauche PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/insertion/:employeeId — Analyse complete d'un salarié
// IMPORTANT: DOIT etre la DERNIERE route GET car /:employeeId capture tout
// ══════════════════════════════════════════════════════════════
router.get('/:employeeId', async (req, res) => {
  try {
    const empId = req.params.employeeId;

    // 1. Données employé (+ prescripteur / orienteur + CIP référent si rattaché)
    const empRes = await pool.query(`
      SELECT e.*, t.name as team_name, p.title as position_title,
             po.nom AS prescripteur_nom, po.type AS prescripteur_type,
             TRIM(CONCAT(cu.first_name, ' ', cu.last_name)) AS cip_referent_nom
      FROM employees e
      LEFT JOIN teams t ON e.team_id = t.id
      LEFT JOIN positions p ON p.title = e.position
      LEFT JOIN prescripteur_orgas po ON po.id = e.prescripteur_id
      LEFT JOIN users cu ON cu.id = e.cip_referent_user_id
      WHERE e.id = $1
    `, [empId]);
    if (empRes.rows.length === 0) return res.status(404).json({ error: 'Employé non trouvé' });
    const employee = empRes.rows[0];

    // 2. Contrats
    let contractsRes = { rows: [] };
    try {
      contractsRes = await pool.query(
        'SELECT ec.*, t.name as team_name, p.title as position_title FROM employee_contracts ec LEFT JOIN teams t ON ec.team_id = t.id LEFT JOIN positions p ON ec.position_id = p.id WHERE ec.employee_id = $1 ORDER BY ec.start_date DESC',
        [empId]
      );
    } catch (err) { /* table might not exist */ }

    // 3. Candidat (par nom ou candidate_id)
    let candidate = null;
    try {
      if (employee.candidate_id) {
        const candRes = await pool.query('SELECT * FROM candidates WHERE id = $1', [employee.candidate_id]);
        candidate = candRes.rows[0] || null;
      }
      if (!candidate) {
        const candRes = await pool.query(
          'SELECT * FROM candidates WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2) ORDER BY created_at DESC LIMIT 1',
          [employee.first_name, employee.last_name]
        );
        candidate = candRes.rows[0] || null;
      }
    } catch (err) { /* table might not exist */ }

    // 4. Rapport PCM
    let pcmReport = null;
    if (candidate) {
      try {
        const pcmRes = await pool.query(
          'SELECT encrypted_report FROM pcm_reports WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1',
          [candidate.id]
        );
        if (pcmRes.rows[0]?.encrypted_report) {
          const bytes = CryptoJS.AES.decrypt(pcmRes.rows[0].encrypted_report, PCM_KEY);
          pcmReport = bytes.toString(CryptoJS.enc.Utf8);
          if (!pcmReport && process.env.JWT_SECRET && PCM_KEY !== process.env.JWT_SECRET) {
            // Rapports historiques chiffrés avec JWT_SECRET (avant alignement clé PCM)
            const legacy = CryptoJS.AES.decrypt(pcmRes.rows[0].encrypted_report, process.env.JWT_SECRET);
            pcmReport = legacy.toString(CryptoJS.enc.Utf8);
          }
        }
      } catch (err) { /* pcm might not exist */ }
    }

    // 5. Membres de l'équipe
    let teamMembers = [];
    if (employee.team_id) {
      try {
        const teamRes = await pool.query(
          'SELECT id, first_name, last_name FROM employees WHERE team_id = $1 AND is_active = true AND id != $2',
          [employee.team_id, empId]
        );
        teamMembers = teamRes.rows;
      } catch (err) { /* ignore */ }
    }

    // 6. Position
    let position = null;
    const currentContract = contractsRes.rows.find(c => c.is_current);
    if (currentContract?.position_id) {
      try {
        const posRes = await pool.query('SELECT * FROM positions WHERE id = $1', [currentContract.position_id]);
        position = posRes.rows[0] || null;
      } catch (err) { /* ignore */ }
    }

    // 7. Diagnostic CIP (parcours courant — RES-05)
    const baseRole = baseRoleOf(req);
    let diagnostic = null;
    try {
      const diagRes = await pool.query(
        'SELECT * FROM insertion_diagnostics WHERE employee_id = $1 ORDER BY parcours_num DESC LIMIT 1', [empId]
      );
      diagnostic = diagRes.rows[0] || null;
      if (diagnostic) {
        if (baseRole === 'MANAGER') maskInsertionRow(diagnostic, baseRole);
        else decryptDiagRow(diagnostic);
      }
    } catch (err) { /* table might not exist yet */ }

    // 8. Entretiens du parcours. L'AUTO-INIT PARESSEUSE EN LECTURE A ÉTÉ
    // SUPPRIMÉE (effet de bord en GET — vigilance 03 §6.4) : l'initialisation
    // se fait aux déclencheurs explicites (liaison candidat→collaborateur,
    // import paie, bouton /milestones/:employeeId/initialize, scheduler).
    let milestones = [];
    try {
      const msRes = await pool.query(
        'SELECT * FROM insertion_milestones WHERE employee_id = $1 ORDER BY due_date', [empId]
      );
      milestones = maskInsertionRows(msRes.rows, baseRole);
    } catch (err) { console.warn('[INSERTION] Jalons :', err.message); }

    // 9. Plan d'action CIP
    let actionPlans = [];
    try {
      const apRes = await pool.query(
        'SELECT * FROM cip_action_plans WHERE employee_id = $1 ORDER BY created_at', [empId]
      );
      actionPlans = apRes.rows;
    } catch (err) { /* table might not exist yet */ }

    // 9bis. Objectifs individualisés (Lot 3)
    let objectifs = [];
    try {
      const objRes = await pool.query(
        `SELECT * FROM insertion_objectifs WHERE employee_id = $1
         ORDER BY parent_id NULLS FIRST, ordre, id`, [empId]
      );
      objectifs = objRes.rows;
    } catch (err) { /* table might not exist yet */ }

    // 9ter. PMSMP + satisfaction de sortie (PR 2 — EXG-05/09, plan 05 §2.1) :
    // agrégées à la fiche (onglet Synthèse) ; le détail/CRUD vit sur
    // /pmsmp/:employeeId et /satisfaction/:employeeId.
    let pmsmp = [];
    try {
      const pmRes = await pool.query(
        'SELECT * FROM insertion_pmsmp WHERE employee_id = $1 ORDER BY date_debut DESC, id DESC', [empId]
      );
      pmsmp = maskInsertionRows(
        pmRes.rows.map((r) => ({ ...r, jours: pmsmpDays(r.date_debut, r.date_fin) })), baseRole
      );
    } catch (err) { /* table might not exist yet */ }
    let satisfaction = null;
    try {
      const stRes = await pool.query(
        'SELECT * FROM insertion_satisfaction_sortie WHERE employee_id = $1 AND COALESCE(parcours_num, 1) = $2',
        [empId, employee.parcours_num || 1]
      );
      satisfaction = stRes.rows[0] ? maskInsertionRow(stRes.rows[0], baseRole) : null;
    } catch (err) { /* table might not exist yet */ }

    // 10. Analyse complete (le diagnostic est déjà masqué pour un MANAGER →
    // l'axe judiciaire est absent de ses freins_sociaux)
    const analysis = analyzeInsertion(
      employee, contractsRes.rows, candidate, pcmReport,
      teamMembers, position, diagnostic, milestones
    );
    if (baseRole === 'MANAGER' && analysis.freins_sociaux?.freins) {
      analysis.freins_sociaux.freins = analysis.freins_sociaux.freins.filter((f) => f.type !== 'judiciaire');
    }

    // 11. Timeline du parcours
    const timeline = buildTimeline(employee, contractsRes.rows, milestones, diagnostic);

    res.json({
      employee: {
        id: employee.id,
        first_name: employee.first_name,
        last_name: employee.last_name,
        team_name: employee.team_name,
        position: employee.position,
        is_active: employee.is_active,
        insertion_start_date: employee.insertion_start_date,
        insertion_status: employee.insertion_status,
        contract_end: employee.contract_end,
        prescripteur: employee.prescripteur || null,
        prescripteur_nom: employee.prescripteur_nom || null,
        prescripteur_type: employee.prescripteur_type || null,
        cip_referent_user_id: employee.cip_referent_user_id || null,
        cip_referent_nom: employee.cip_referent_nom || null,
        parcours_num: employee.parcours_num || 1,
        pass_iae_number: employee.pass_iae_number || null,
        pass_iae_start: employee.pass_iae_start || null,
        pass_iae_end: employee.pass_iae_end || null,
      },
      has_pcm: !!pcmReport,
      has_candidate_data: !!candidate,
      has_cv: !!candidate?.cv_raw_text,
      has_interview: !!candidate?.interview_comment,
      has_diagnostic: !!diagnostic,
      nb_contracts: contractsRes.rows.length,
      milestones,
      action_plans: actionPlans,
      objectifs,
      pmsmp,
      satisfaction,
      timeline,
      ...analysis,
    });
  } catch (err) {
    console.error('[INSERTION] Erreur analyse :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// ANALYSE IA — Endpoints utilisant Claude pour l'insertion
// ══════════════════════════════════════════════════════════════

// Traduit une erreur du service IA (SDK Anthropic) en réponse diagnosticable.
// Endpoints ADMIN/RH → on peut exposer un indice technique (modèle/clé/quota).
function handleIaError(res, err, where) {
  const status = err.status || err.statusCode;
  console.error(`[INSERTION] Erreur IA ${where} :`, status || '', err.message);
  if (err.message?.includes('ANTHROPIC_API_KEY')) {
    return res.status(503).json({ error: "Service IA non configuré — clé ANTHROPIC_API_KEY absente côté serveur." });
  }
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
  let hint;
  if (status === 404 || /not[_ ]?found|model:/i.test(err.message || '')) {
    hint = `Le modèle IA « ${model} » n'est pas disponible pour cette clé API. Définissez CLAUDE_MODEL (dans le .env serveur) sur un modèle autorisé pour votre compte Anthropic, puis redémarrez le backend.`;
  } else if (status === 401 || /authentication|invalid.*api.?key|x-api-key/i.test(err.message || '')) {
    hint = "Clé ANTHROPIC_API_KEY invalide ou révoquée.";
  } else if (status === 429 || /rate.?limit|overloaded/i.test(err.message || '')) {
    hint = "Limite de débit / quota Anthropic atteinte — réessayez dans un instant.";
  }
  return res.status(500).json({ error: 'Erreur analyse IA', detail: err.message, hint });
}

// GET /api/insertion/ia/diagnostic — Sonde isolée de l'appel Anthropic.
// Ne dépend d'AUCUN salarié : teste purement clé + modèle + connectivité réseau,
// hors de toute logique de collecte de données. ADMIN/RH uniquement
// (expose le status HTTP + message bruts du SDK pour le diagnostic).
router.get('/ia/diagnostic', authorize('ADMIN', 'RH'), async (req, res) => {
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) {
    return res.json({ configured: false, model, ok: false, message: "ANTHROPIC_API_KEY absente côté serveur (variable non transmise au conteneur backend)." });
  }
  const t0 = Date.now();
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const probe = new Anthropic({ apiKey: key });
    const r = await probe.messages.create({
      model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return res.json({
      configured: true, ok: true, model,
      key_length: key.length,
      latency_ms: Date.now() - t0,
      reply: (r.content?.[0]?.text || '').slice(0, 40),
    });
  } catch (err) {
    const status = err.status || err.statusCode || null;
    console.error('[INSERTION] Diagnostic IA échec :', status || '', err.name, err.message);
    return res.json({
      configured: true, ok: false, model,
      key_length: key.length,
      latency_ms: Date.now() - t0,
      status,
      type: err.name || null,
      message: err.message || String(err),
    });
  }
});

// GET /api/insertion/ia/profil/:employeeId — Analyse approfondie IA du profil
router.get('/ia/profil/:employeeId', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { analyseProfilComplet } = require('../../services/insertion-ai');
    res.json(await analyseProfilComplet(parseInt(req.params.employeeId)));
  } catch (err) {
    handleIaError(res, err, 'profil');
  }
});

// GET /api/insertion/ia/entretien/:employeeId — Guide d'entretien adapté PCM
// ?milestoneId=N : préparation d'un ENTRETIEN précis (tout type) — la note est
// alors PERSISTÉE sur l'entretien (ia_preparation + ia_preparation_at, historisée).
// ?type= : type technique libre (défaut bilan_intermediaire).
router.get('/ia/entretien/:employeeId', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { preparerEntretien } = require('../../services/insertion-ai');
    const employeeId = parseInt(req.params.employeeId, 10);

    let milestone = null;
    let label = req.query.type || 'bilan_intermediaire';
    if (req.query.milestoneId) {
      const m = await pool.query(
        'SELECT id, milestone_type, titre, employee_id FROM insertion_milestones WHERE id = $1 AND employee_id = $2',
        [req.query.milestoneId, employeeId]
      );
      if (m.rows.length === 0) return res.status(404).json({ error: 'Entretien non trouvé pour ce salarié' });
      milestone = m.rows[0];
      label = milestoneLabel(milestone);
    } else if (MILESTONE_TYPE_LABELS[label]) {
      label = MILESTONE_TYPE_LABELS[label];
    }

    const prep = await preparerEntretien(employeeId, label);

    if (milestone) {
      // Persistance de la note de préparation (best effort — la réponse part même si l'écriture échoue).
      try {
        await pool.query(
          'UPDATE insertion_milestones SET ia_preparation = $1, ia_preparation_at = NOW() WHERE id = $2',
          [JSON.stringify(prep), milestone.id]
        );
      } catch (e) { console.error('[INSERTION] Persistance ia_preparation :', e.message); }
    }
    res.json(prep);
  } catch (err) {
    handleIaError(res, err, 'entretien');
  }
});

// GET /api/insertion/ia/cohorte — Bilan global de la cohorte en insertion
router.get('/ia/cohorte', authorize('ADMIN', 'RH'), async (req, res) => {
  try {
    const { bilanCohorte } = require('../../services/insertion-ai');
    res.json(await bilanCohorte());
  } catch (err) {
    handleIaError(res, err, 'cohorte');
  }
});

module.exports = router;
// Réutilisé par routes/exports.js (GET /api/exports/insertion-synthese —
// EXG-14) : mêmes agrégats NON nominatifs que GET /insertion/audit, sans
// dupliquer ~150 lignes de SQL. Un router Express est une fonction : on peut
// lui attacher des propriétés sans changer son contrat.
module.exports.gatherAuditKpis = gatherAuditKpis;

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
} = require('./engine');
const { FREINS, freinColumns, RADAR_AXES } = require('./freins-registry');
const { SENSITIVE_DIAG_FIELDS, encryptField, decryptField } = require('../../utils/field-crypto');
const { maskInsertionRow, maskInsertionRows, MANAGER_HIDDEN_FIELDS } = require('./masking');
const { readInsertionSetting } = require('../../utils/insertion-settings');
const { autoLogActivity } = require('../../middleware/activity-logger');

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
};
const DIAG_BOOL_FIELDS = [
  'logement_satisfaction', 'allocataire_caf', 'rqth', 'contre_indications', 'suivi_sante',
  'difficultes_financieres', 'credits_en_cours', 'vehicule', 'autre_employeur',
  'souhait_complement_heures', 'cpf_accessible', 'enfants_a_charge',
];
const DIAG_DATE_FIELDS = ['piece_identite_validite', 'rqth_fin'];
const DIAG_NUM_FIELDS = ['autre_employeur_heures', 'nb_enfants'];
const DIAG_ARRAY_FIELDS = ['ressources', 'moyen_transport'];
const DIAG_JSONB_FIELDS = ['questionnaire_detail', 'fse_entree'];

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
const MILESTONE_JSONB_FIELDS = ['previous_review', 'validations', 'renouvellement_form', 'sortie_documents', 'remise_salarie', 'fse_sortie', 'ai_recommendations'];
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
  ...FREINS.map((f) => body(f.column).optional({ nullable: true }).isInt({ min: 1, max: 5 }).withMessage(`${f.column} : niveau attendu entre 1 et 5`)),
], validate, async (req, res) => {
  try {
    const d = req.body;
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

    // 1. Freins évalués — ou non-évaluation explicitement assumée par la CIP.
    const missing = FREINS.filter((f) => ms[f.column] == null).map((f) => f.key);
    if (missing.length > 0 && req.body.assume_freins_non_evalues !== true) {
      problems.push({
        code: 'freins_non_evalues',
        freins: missing,
        message: `Freins non évalués : ${missing.join(', ')}. Évaluez-les ou clôturez avec « assume_freins_non_evalues » (non-évaluation assumée).`,
      });
    }

    // 2. Évaluation du bilan précédent (previous_review) si un entretien
    // réalisé antérieur existe sur ce parcours (REC-UX-03).
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

    // 4. Prochain entretien « planifie » obligatoire (sauf sortie / post-sortie).
    let createdNext = null;
    if (!['bilan_sortie', 'suivi_post_sortie'].includes(ms.milestone_type)) {
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
              e.pass_iae_number, e.pass_iae_end, COALESCE(e.parcours_num, 1) AS parcours_num
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
      taux_dynamiques: totalSorties > 0 ? Math.round((nbDynamiques / totalSorties) * 100) : null,
      par_classification: parClassification,
      taux_par_classification: tauxParClassification,
      par_type: parType,
    },
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

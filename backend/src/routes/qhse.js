const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { documentFilter } = require('../utils/upload-filters');

// ══════════════════════════════════════════════════════════════════════════
// MODULE QHSE minimal — Vague 2, item 58 (arbitrage A4 : intégré à SOLIDATA)
// ──────────────────────────────────────────────────────────────────────────
// (a) Registre accidents / presqu'accidents (+ taux de fréquence TF1 et taux
//     de gravité TG calculés sur les heures travaillées)
// (b) Habilitations à échéance (CACES, SST, habilitation électrique, permis) —
//     source de vérité DATÉE synchronisée vers employees.has_caces/has_permis_b
// (c) Dotation EPI (échéances de péremption)
//
// Public : ADMIN, MANAGER et le rôle QHSE (créé par le lot acces-roles ;
// la validation du rôle est faite à l'exécution — la chaîne 'QHSE' reste
// valable même si le rôle n'existe pas encore au démarrage).
//
// RGPD : données de santé MINIMISÉES. On ne stocke AUCUN diagnostic médical —
// seulement la description factuelle des faits, le lieu et les jours d'arrêt.
// ══════════════════════════════════════════════════════════════════════════

// ── Référentiels (miroir des CHECK SQL, réutilisés pour la validation) ──
const EVENT_TYPES = ['accident_travail', 'accident_trajet', 'presqu_accident', 'soin_benin'];
const LIEUX = ['tri', 'collecte', 'boutique', 'autre'];
const GRAVITES = ['mineure', 'moderee', 'grave', 'critique'];
const EVENT_STATUTS = ['declare', 'analyse', 'clos'];
const HAB_TYPES = ['caces_1', 'caces_3', 'caces_5', 'sst', 'habilitation_electrique', 'permis', 'autre'];
const EPI_TYPES = ['chaussures', 'gants', 'gilet_hv', 'casque_antibruit', 'autre'];
// RSEI-06 — types de documents de prévention.
const DOC_TYPES = ['duerp', 'plan_prevention', 'rps', 'protocole_securite', 'consignes', 'autre'];
// Types d'évènement soumis à retour d'expérience SST (RSEI-07) : les accidents
// de travail et les presqu'accidents (le trajet et le soin bénin n'appellent pas
// systématiquement une analyse de causes en interne).
const REX_EVENT_TYPES = ['accident_travail', 'presqu_accident'];

// Types d'habilitation qui pilotent les booléens de compétence du planning.
const CACES_TYPES = ['caces_1', 'caces_3', 'caces_5'];

// ── Pièces jointes des documents de prévention (pattern Refashion / achats-fds) ──
const docsDir = path.join(__dirname, '..', '..', 'uploads', 'qhse-documents');
try { fs.mkdirSync(docsDir, { recursive: true }); } catch (e) { /* ignore */ }
const uploadDoc = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, docsDir),
    filename: (req, file, cb) => cb(null, `doc${req.params.id}-${Date.now()}${path.extname(file.originalname || '').toLowerCase()}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: documentFilter,
});

// ── Helpers de calcul (purs, exportés pour les tests) ──

/**
 * Taux de fréquence TF1 = (accidents du travail AVEC arrêt × 1 000 000)
 * / heures travaillées. Basé sur les accidents du travail (les accidents de
 * trajet sont exclus du TF, convention INRS/CNAM). Retourne null si les
 * heures sont indisponibles (division impossible).
 */
function computeTauxFrequence(nbAccidentsAvecArret, heuresTravaillees) {
  const h = Number(heuresTravaillees);
  if (!h || h <= 0) return null;
  return Math.round((Number(nbAccidentsAvecArret) * 1000000 / h) * 100) / 100;
}

/**
 * Taux de gravité TG = (journées d'arrêt × 1 000) / heures travaillées.
 * Basé sur les accidents du travail. Retourne null si heures indisponibles.
 */
function computeTauxGravite(joursArret, heuresTravaillees) {
  const h = Number(heuresTravaillees);
  if (!h || h <= 0) return null;
  return Math.round((Number(joursArret) * 1000 / h) * 100) / 100;
}

/**
 * Statut calculé d'une habilitation à partir de sa date d'expiration.
 *  - 'sans_echeance' : pas de date d'expiration (ex. permis à vie)
 *  - 'expiree'       : date dépassée (badge rouge)
 *  - 'expire_60'     : expire dans ≤ 60 jours (badge ambre)
 *  - 'expire_90'     : expire dans ≤ 90 jours (badge jaune)
 *  - 'valide'        : au-delà (badge vert)
 * `today` injectable pour les tests (défaut : aujourd'hui, minuit local).
 */
function habilitationStatut(dateExpiration, today = new Date()) {
  if (!dateExpiration) return { statut: 'sans_echeance', jours_restants: null };
  const exp = new Date(dateExpiration);
  const ref = new Date(today);
  ref.setHours(0, 0, 0, 0);
  exp.setHours(0, 0, 0, 0);
  const jours = Math.round((exp - ref) / 86400000);
  let statut;
  if (jours < 0) statut = 'expiree';
  else if (jours <= 60) statut = 'expire_60';
  else if (jours <= 90) statut = 'expire_90';
  else statut = 'valide';
  return { statut, jours_restants: jours };
}

/**
 * Recalcule employees.has_caces / has_permis_b depuis les habilitations QHSE.
 * Principe (non destructif) : on ne touche un booléen QUE si le salarié possède
 * au moins une habilitation QHSE de la catégorie concernée. Tant qu'aucune
 * habilitation CACES/permis n'a été saisie côté QHSE, la valeur issue de
 * l'import paie (Malibou) est préservée. Une fois qu'une habilitation existe,
 * la table QHSE devient la source de vérité datée : le booléen vaut vrai ssi
 * au moins une habilitation de la catégorie est encore valide (non expirée).
 * @param {object} db  pool ou client transactionnel
 * @param {number} employeeId
 */
async function syncEmployeeCertBooleans(db, employeeId) {
  if (!employeeId) return;
  // CACES
  const caces = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE date_expiration IS NULL OR date_expiration >= CURRENT_DATE)::int AS valid
     FROM qhse_habilitations
     WHERE employee_id = $1 AND type = ANY($2)`,
    [employeeId, CACES_TYPES]
  );
  if (caces.rows[0].total > 0) {
    await db.query('UPDATE employees SET has_caces = $1 WHERE id = $2', [caces.rows[0].valid > 0, employeeId]);
  }
  // Permis (assimilé permis B pour le planning)
  const permis = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE date_expiration IS NULL OR date_expiration >= CURRENT_DATE)::int AS valid
     FROM qhse_habilitations
     WHERE employee_id = $1 AND type = 'permis'`,
    [employeeId]
  );
  if (permis.rows[0].total > 0) {
    await db.query('UPDATE employees SET has_permis_b = $1 WHERE id = $2', [permis.rows[0].valid > 0, employeeId]);
  }
}

// Toutes les routes QHSE : authentifié + rôle habilité (lecture ET écriture ;
// le rôle QHSE gère son propre module — ce n'est pas un rôle en lecture seule).
router.use(authenticate);
router.use(authorize('ADMIN', 'MANAGER', 'QHSE'));

// ══════════════════════════════════════════
// Liste des salariés (minimale, non-PII) pour peupler les sélecteurs des
// formulaires QHSE — évite de dépendre de /api/employees (fermé au rôle QHSE).
// ══════════════════════════════════════════
router.get('/employees', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT e.id, e.first_name, e.last_name, e.malibou_id AS matricule,
             e.position, e.has_caces, e.has_permis_b, t.name AS equipe
      FROM employees e
      LEFT JOIN teams t ON t.id = e.team_id
      WHERE e.is_active = true
      ORDER BY e.last_name, e.first_name
    `);
    res.json(r.rows);
  } catch (err) {
    console.error('[QHSE] Erreur liste salariés :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// (a) ACCIDENTS / PRESQU'ACCIDENTS
// ══════════════════════════════════════════════════════════════════════════

// GET /api/qhse/events — liste filtrable (type, statut, lieu, employee_id, annee)
router.get('/events', async (req, res) => {
  try {
    const { type, statut, lieu, employee_id, annee } = req.query;
    const params = [];
    const where = [];
    if (type) { params.push(type); where.push(`ev.type = $${params.length}`); }
    if (statut) { params.push(statut); where.push(`ev.statut = $${params.length}`); }
    if (lieu) { params.push(lieu); where.push(`ev.lieu = $${params.length}`); }
    if (employee_id) { params.push(parseInt(employee_id, 10)); where.push(`ev.employee_id = $${params.length}`); }
    if (annee) { params.push(parseInt(annee, 10)); where.push(`EXTRACT(YEAR FROM ev.date_event) = $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const r = await pool.query(`
      SELECT ev.*,
             CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
             CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
      FROM qhse_events ev
      LEFT JOIN employees e ON e.id = ev.employee_id
      LEFT JOIN users u ON u.id = ev.created_by
      ${whereSql}
      ORDER BY ev.date_event DESC, ev.id DESC
    `, params);
    res.json(r.rows);
  } catch (err) {
    console.error('[QHSE] Erreur liste events :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/qhse/events/stats — taux de fréquence TF1 + taux de gravité TG + répartition
router.get('/events/stats', async (req, res) => {
  try {
    const annee = parseInt(req.query.annee, 10) || new Date().getFullYear();

    // Heures travaillées (normal + formation) sur l'année, depuis work_hours
    // (même définition que les KPI RH existants /employees/kpi/etp).
    const wh = await pool.query(
      `SELECT COALESCE(SUM(hours_worked) FILTER (WHERE type IN ('normal','training')), 0)::float AS heures
       FROM work_hours WHERE EXTRACT(YEAR FROM date) = $1`,
      [annee]
    );
    let heures = Number(wh.rows[0].heures) || 0;
    let heures_source = 'work_hours';
    let heures_note = null;
    if (heures <= 0) {
      // Repli : estimation base ETP × 1607 h (aucune feuille de temps saisie).
      const hc = await pool.query(`SELECT COUNT(*)::int AS n FROM employees WHERE is_active = true`);
      const n = hc.rows[0].n || 0;
      heures = n * 1607;
      heures_source = 'estimation_etp';
      heures_note = `Estimation base ETP × 1607 h : aucune heure saisie dans les feuilles de temps pour ${annee} → ${n} salarié(s) actif(s) × 1607 h.`;
    }

    const ev = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE avec_arret)::int AS total_avec_arret,
         COUNT(*) FILTER (WHERE type = 'accident_travail' AND avec_arret)::int AS at_avec_arret,
         COALESCE(SUM(jours_arret) FILTER (WHERE type = 'accident_travail'), 0)::int AS jours_arret_at
       FROM qhse_events WHERE EXTRACT(YEAR FROM date_event) = $1`,
      [annee]
    );
    const s = ev.rows[0];

    const byType = await pool.query(
      `SELECT type, COUNT(*)::int AS nb,
              COALESCE(SUM(jours_arret), 0)::int AS jours_arret
       FROM qhse_events WHERE EXTRACT(YEAR FROM date_event) = $1
       GROUP BY type`,
      [annee]
    );
    const par_type = {};
    for (const t of EVENT_TYPES) par_type[t] = { nb: 0, jours_arret: 0 };
    for (const row of byType.rows) par_type[row.type] = { nb: row.nb, jours_arret: row.jours_arret };

    res.json({
      annee,
      heures_travaillees: Math.round(heures),
      heures_source,
      heures_note,
      tf1: computeTauxFrequence(s.at_avec_arret, heures),
      tg: computeTauxGravite(s.jours_arret_at, heures),
      total_events: s.total,
      total_avec_arret: s.total_avec_arret,
      accidents_travail_avec_arret: s.at_avec_arret,
      jours_arret_accidents_travail: s.jours_arret_at,
      par_type,
    });
  } catch (err) {
    console.error('[QHSE] Erreur stats events :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/qhse/events — déclarer un accident / presqu'accident
router.post('/events', async (req, res) => {
  try {
    const {
      type, employee_id, date_event, lieu, description, gravite,
      jours_arret, avec_arret, mesures_prises, statut,
    } = req.body;

    if (!EVENT_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Type invalide', allowed: EVENT_TYPES });
    }
    if (!date_event) {
      return res.status(400).json({ error: "La date de l'évènement est obligatoire" });
    }
    const lieuVal = lieu || 'autre';
    if (!LIEUX.includes(lieuVal)) {
      return res.status(400).json({ error: 'Lieu invalide', allowed: LIEUX });
    }
    if (gravite && !GRAVITES.includes(gravite)) {
      return res.status(400).json({ error: 'Gravité invalide', allowed: GRAVITES });
    }
    const statutVal = statut || 'declare';
    if (!EVENT_STATUTS.includes(statutVal)) {
      return res.status(400).json({ error: 'Statut invalide', allowed: EVENT_STATUTS });
    }
    const jours = Math.max(0, parseInt(jours_arret, 10) || 0);
    // avec_arret : explicite si fourni, sinon déduit des jours d'arrêt.
    const arret = typeof avec_arret === 'boolean' ? avec_arret : jours > 0;

    const r = await pool.query(
      `INSERT INTO qhse_events
        (type, employee_id, date_event, lieu, description, gravite,
         jours_arret, avec_arret, mesures_prises, statut, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [type, employee_id || null, date_event, lieuVal, description || null,
       gravite || null, jours, arret, mesures_prises || null, statutVal, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[QHSE] Erreur création event :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/qhse/events/:id — mise à jour (statut, analyse, mesures, champs)
router.patch('/events/:id', async (req, res) => {
  try {
    const allowed = {
      type: (v) => EVENT_TYPES.includes(v),
      employee_id: () => true,
      date_event: (v) => !!v,
      lieu: (v) => LIEUX.includes(v),
      description: () => true,
      gravite: (v) => v === null || v === '' || GRAVITES.includes(v),
      jours_arret: () => true,
      avec_arret: () => true,
      mesures_prises: () => true,
      statut: (v) => EVENT_STATUTS.includes(v),
      // RSEI-07 — retour d'expérience SST.
      analyse_causes: () => true,
      action_corrective: () => true,
      efficacite_verifiee_le: () => true,
      efficacite_constat: () => true,
    };
    const sets = [];
    const params = [];
    for (const [key, validate] of Object.entries(allowed)) {
      if (!(key in req.body)) continue;
      let val = req.body[key];
      if (!validate(val)) {
        return res.status(400).json({ error: `Valeur invalide pour « ${key} »` });
      }
      if (key === 'employee_id') val = val || null;
      if (key === 'gravite') val = val || null;
      if (key === 'jours_arret') val = Math.max(0, parseInt(val, 10) || 0);
      if (['analyse_causes', 'action_corrective', 'efficacite_constat', 'efficacite_verifiee_le'].includes(key)) val = val || null;
      params.push(val);
      sets.push(`${key} = $${params.length}`);
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE qhse_events SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Évènement introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[QHSE] Erreur PATCH event :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// (b) HABILITATIONS À ÉCHÉANCE
// ══════════════════════════════════════════════════════════════════════════

// Enrichit une ligne d'habilitation avec son statut calculé.
function decorateHabilitation(row) {
  const { statut, jours_restants } = habilitationStatut(row.date_expiration);
  return { ...row, statut, jours_restants };
}

// GET /api/qhse/habilitations — liste (filtre type, employee_id, statut calculé)
router.get('/habilitations', async (req, res) => {
  try {
    const { type, employee_id, statut } = req.query;
    const params = [];
    const where = [];
    if (type) { params.push(type); where.push(`h.type = $${params.length}`); }
    if (employee_id) { params.push(parseInt(employee_id, 10)); where.push(`h.employee_id = $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const r = await pool.query(`
      SELECT h.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
             e.malibou_id AS matricule, t.name AS equipe
      FROM qhse_habilitations h
      JOIN employees e ON e.id = h.employee_id
      LEFT JOIN teams t ON t.id = e.team_id
      ${whereSql}
      ORDER BY h.date_expiration ASC NULLS LAST, e.last_name
    `, params);
    let rows = r.rows.map(decorateHabilitation);
    if (statut) rows = rows.filter((x) => x.statut === statut);
    res.json(rows);
  } catch (err) {
    console.error('[QHSE] Erreur liste habilitations :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/qhse/habilitations/echeances — buckets expirées / <60 j / <90 j
router.get('/habilitations/echeances', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT h.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
             e.malibou_id AS matricule, t.name AS equipe
      FROM qhse_habilitations h
      JOIN employees e ON e.id = h.employee_id
      LEFT JOIN teams t ON t.id = e.team_id
      WHERE h.date_expiration IS NOT NULL
        AND h.date_expiration <= CURRENT_DATE + INTERVAL '90 days'
      ORDER BY h.date_expiration ASC
    `);
    const rows = r.rows.map(decorateHabilitation);
    const expirees = rows.filter((x) => x.statut === 'expiree');
    const sous_60j = rows.filter((x) => x.statut === 'expire_60');
    const sous_90j = rows.filter((x) => x.statut === 'expire_90');
    res.json({
      counts: { expirees: expirees.length, sous_60j: sous_60j.length, sous_90j: sous_90j.length },
      expirees, sous_60j, sous_90j,
    });
  } catch (err) {
    console.error('[QHSE] Erreur échéances habilitations :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/qhse/habilitations — créer une habilitation (+ synchro booléen employé)
router.post('/habilitations', async (req, res) => {
  try {
    const { employee_id, type, libelle, date_obtention, date_expiration, organisme } = req.body;
    if (!employee_id) return res.status(400).json({ error: 'Salarié obligatoire' });
    if (!HAB_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Type invalide', allowed: HAB_TYPES });
    }
    const r = await pool.query(
      `INSERT INTO qhse_habilitations
        (employee_id, type, libelle, date_obtention, date_expiration, organisme, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [parseInt(employee_id, 10), type, libelle || null, date_obtention || null,
       date_expiration || null, organisme || null, req.user.id]
    );
    // Synchro non bloquante des booléens de compétence du planning.
    try { await syncEmployeeCertBooleans(pool, parseInt(employee_id, 10)); }
    catch (e) { console.error('[QHSE] Synchro booléen après création :', e.message); }
    res.status(201).json(decorateHabilitation(r.rows[0]));
  } catch (err) {
    console.error('[QHSE] Erreur création habilitation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/qhse/habilitations/:id — mise à jour (+ synchro booléen)
router.patch('/habilitations/:id', async (req, res) => {
  try {
    const allowed = {
      type: (v) => HAB_TYPES.includes(v),
      libelle: () => true,
      date_obtention: () => true,
      date_expiration: () => true,
      organisme: () => true,
    };
    const sets = [];
    const params = [];
    for (const [key, validate] of Object.entries(allowed)) {
      if (!(key in req.body)) continue;
      const val = req.body[key];
      if (!validate(val)) return res.status(400).json({ error: `Valeur invalide pour « ${key} »` });
      params.push(val === '' ? null : val);
      sets.push(`${key} = $${params.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE qhse_habilitations SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Habilitation introuvable' });
    try { await syncEmployeeCertBooleans(pool, r.rows[0].employee_id); }
    catch (e) { console.error('[QHSE] Synchro booléen après MAJ :', e.message); }
    res.json(decorateHabilitation(r.rows[0]));
  } catch (err) {
    console.error('[QHSE] Erreur PATCH habilitation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/qhse/habilitations/:id — supprimer (+ synchro booléen)
router.delete('/habilitations/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM qhse_habilitations WHERE id = $1 RETURNING employee_id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Habilitation introuvable' });
    try { await syncEmployeeCertBooleans(pool, r.rows[0].employee_id); }
    catch (e) { console.error('[QHSE] Synchro booléen après suppression :', e.message); }
    res.json({ message: 'Habilitation supprimée' });
  } catch (err) {
    console.error('[QHSE] Erreur DELETE habilitation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// (c) DOTATION EPI
// ══════════════════════════════════════════════════════════════════════════

// GET /api/qhse/epi — liste (filtre employee_id, type_epi)
router.get('/epi', async (req, res) => {
  try {
    const { employee_id, type_epi } = req.query;
    const params = [];
    const where = [];
    if (employee_id) { params.push(parseInt(employee_id, 10)); where.push(`d.employee_id = $${params.length}`); }
    if (type_epi) { params.push(type_epi); where.push(`d.type_epi = $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const r = await pool.query(`
      SELECT d.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
             e.malibou_id AS matricule, t.name AS equipe,
             CASE
               WHEN d.date_peremption IS NULL THEN 'sans_echeance'
               WHEN d.date_peremption < CURRENT_DATE THEN 'perimee'
               WHEN d.date_peremption <= CURRENT_DATE + INTERVAL '60 days' THEN 'bientot'
               ELSE 'valide'
             END AS etat_peremption
      FROM qhse_epi_dotations d
      JOIN employees e ON e.id = d.employee_id
      LEFT JOIN teams t ON t.id = e.team_id
      ${whereSql}
      ORDER BY d.date_dotation DESC, e.last_name
    `, params);
    res.json(r.rows);
  } catch (err) {
    console.error('[QHSE] Erreur liste EPI :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/qhse/epi — enregistrer une dotation
router.post('/epi', async (req, res) => {
  try {
    const { employee_id, type_epi, taille, date_dotation, date_peremption, quantite, remarque } = req.body;
    if (!employee_id) return res.status(400).json({ error: 'Salarié obligatoire' });
    if (!EPI_TYPES.includes(type_epi)) {
      return res.status(400).json({ error: 'Type EPI invalide', allowed: EPI_TYPES });
    }
    if (!date_dotation) return res.status(400).json({ error: 'Date de dotation obligatoire' });
    const qte = Math.max(1, parseInt(quantite, 10) || 1);
    const r = await pool.query(
      `INSERT INTO qhse_epi_dotations
        (employee_id, type_epi, taille, date_dotation, date_peremption, quantite, remarque, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [parseInt(employee_id, 10), type_epi, taille || null, date_dotation,
       date_peremption || null, qte, remarque || null, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[QHSE] Erreur création EPI :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/qhse/epi/:id — mise à jour
router.patch('/epi/:id', async (req, res) => {
  try {
    const allowed = {
      type_epi: (v) => EPI_TYPES.includes(v),
      taille: () => true,
      date_dotation: (v) => !!v,
      date_peremption: () => true,
      quantite: () => true,
      remarque: () => true,
    };
    const sets = [];
    const params = [];
    for (const [key, validate] of Object.entries(allowed)) {
      if (!(key in req.body)) continue;
      let val = req.body[key];
      if (!validate(val)) return res.status(400).json({ error: `Valeur invalide pour « ${key} »` });
      if (key === 'quantite') val = Math.max(1, parseInt(val, 10) || 1);
      if (key === 'date_peremption' || key === 'taille' || key === 'remarque') val = val || null;
      params.push(val);
      sets.push(`${key} = $${params.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE qhse_epi_dotations SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Dotation introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[QHSE] Erreur PATCH EPI :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/qhse/epi/:id — supprimer une dotation
router.delete('/epi/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM qhse_epi_dotations WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Dotation introuvable' });
    res.json({ message: 'Dotation supprimée' });
  } catch (err) {
    console.error('[QHSE] Erreur DELETE EPI :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// (d) DOCUMENTS DE PRÉVENTION — RSEI-06 (DUERP, plan de prévention, RPS…)
//     Critère RSEi 2.4 : preuve datée + trace de consultation des IRP/CSE +
//     échéance de révision (alerte scheduler checkQhseDocuments).
// ══════════════════════════════════════════════════════════════════════════

const DOC_REVISION_DEFAUT = 60; // jours ; alerte quand la révision approche.

/**
 * Statut de fraîcheur d'un document de prévention à partir de sa date de
 * révision prévue :
 *  - 'sans_echeance' : aucune date de révision programmée
 *  - 'a_reviser'     : date de révision dépassée (badge rouge)
 *  - 'bientot'       : révision dans ≤ seuil jours (badge ambre)
 *  - 'a_jour'        : au-delà (badge vert)
 * Pur et injectable (today, seuil) pour les tests.
 */
function documentStatut(dateRevisionPrevue, today = new Date(), seuilJours = DOC_REVISION_DEFAUT) {
  if (!dateRevisionPrevue) return { statut: 'sans_echeance', jours_restants: null };
  const rev = new Date(dateRevisionPrevue);
  const ref = new Date(today);
  ref.setHours(0, 0, 0, 0);
  rev.setHours(0, 0, 0, 0);
  const jours = Math.round((rev - ref) / 86400000);
  let statut;
  if (jours < 0) statut = 'a_reviser';
  else if (jours <= seuilJours) statut = 'bientot';
  else statut = 'a_jour';
  return { statut, jours_restants: jours };
}

function decorateDocument(row) {
  const { statut, jours_restants } = documentStatut(row.date_revision_prevue);
  return {
    ...row,
    statut_revision: statut,
    jours_avant_revision: jours_restants,
    has_fichier: !!row.fichier_path,
    // consulté par les IRP/CSE ssi une date de consultation est renseignée
    irp_consulte: !!row.irp_consultation_date,
  };
}

// GET /api/qhse/documents — registre des documents de prévention (filtre type)
router.get('/documents', async (req, res) => {
  try {
    const { type } = req.query;
    const params = [];
    let whereSql = '';
    if (type) { params.push(type); whereSql = `WHERE d.type = $${params.length}`; }
    const r = await pool.query(`
      SELECT d.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
      FROM qhse_documents d
      LEFT JOIN users u ON u.id = d.created_by
      ${whereSql}
      ORDER BY d.date_revision_prevue ASC NULLS LAST, d.date_document DESC NULLS LAST, d.id DESC
    `, params);
    res.json(r.rows.map(decorateDocument));
  } catch (err) {
    console.error('[QHSE] Erreur liste documents :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/qhse/documents/synthese — présence des documents socles + à réviser
router.get('/documents/synthese', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM qhse_documents');
    const rows = r.rows.map(decorateDocument);
    // Documents socles attendus (leur absence est un point de vigilance N1).
    const socles = ['duerp', 'plan_prevention', 'rps'];
    const presence = {};
    for (const t of socles) {
      const doc = rows
        .filter((x) => x.type === t)
        .sort((a, b) => new Date(b.date_document || 0) - new Date(a.date_document || 0))[0] || null;
      presence[t] = doc
        ? { present: true, id: doc.id, titre: doc.titre, statut_revision: doc.statut_revision, irp_consulte: doc.irp_consulte, date_maj: doc.date_maj }
        : { present: false };
    }
    const a_reviser = rows.filter((x) => x.statut_revision === 'a_reviser');
    const bientot = rows.filter((x) => x.statut_revision === 'bientot');
    const sans_consultation_irp = rows.filter((x) => !x.irp_consulte);
    res.json({
      total: rows.length,
      presence_socles: presence,
      a_reviser,
      bientot,
      sans_consultation_irp,
      counts: { a_reviser: a_reviser.length, bientot: bientot.length, sans_consultation_irp: sans_consultation_irp.length },
    });
  } catch (err) {
    console.error('[QHSE] Erreur synthèse documents :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/qhse/documents — enregistrer un document de prévention
router.post('/documents', async (req, res) => {
  try {
    const {
      type, titre, version, date_document, date_maj, date_revision_prevue,
      irp_consultation_date, irp_consultation_avis, remarque,
    } = req.body;
    if (!DOC_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Type de document invalide', allowed: DOC_TYPES });
    }
    if (!titre || !String(titre).trim()) {
      return res.status(400).json({ error: 'Le titre est obligatoire' });
    }
    const r = await pool.query(
      `INSERT INTO qhse_documents
        (type, titre, version, date_document, date_maj, date_revision_prevue,
         irp_consultation_date, irp_consultation_avis, remarque, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [type, String(titre).trim(), version || null, date_document || null, date_maj || null,
       date_revision_prevue || null, irp_consultation_date || null,
       irp_consultation_avis || null, remarque || null, req.user.id]
    );
    res.status(201).json(decorateDocument(r.rows[0]));
  } catch (err) {
    console.error('[QHSE] Erreur création document :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/qhse/documents/:id — mise à jour
router.patch('/documents/:id', async (req, res) => {
  try {
    const allowed = {
      type: (v) => DOC_TYPES.includes(v),
      titre: (v) => !!(v && String(v).trim()),
      version: () => true,
      date_document: () => true,
      date_maj: () => true,
      date_revision_prevue: () => true,
      irp_consultation_date: () => true,
      irp_consultation_avis: () => true,
      remarque: () => true,
    };
    const sets = [];
    const params = [];
    for (const [key, validate] of Object.entries(allowed)) {
      if (!(key in req.body)) continue;
      let val = req.body[key];
      if (!validate(val)) return res.status(400).json({ error: `Valeur invalide pour « ${key} »` });
      if (key !== 'titre') val = (val === '' ? null : val);
      else val = String(val).trim();
      params.push(val);
      sets.push(`${key} = $${params.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE qhse_documents SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Document introuvable' });
    res.json(decorateDocument(r.rows[0]));
  } catch (err) {
    console.error('[QHSE] Erreur PATCH document :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/qhse/documents/:id — supprimer (et sa pièce jointe)
router.delete('/documents/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM qhse_documents WHERE id = $1 RETURNING id, fichier_path', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Document introuvable' });
    if (r.rows[0].fichier_path) {
      try { fs.unlinkSync(path.join(docsDir, path.basename(r.rows[0].fichier_path))); } catch (_) { /* ignore */ }
    }
    res.json({ message: 'Document supprimé' });
  } catch (err) {
    console.error('[QHSE] Erreur DELETE document :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/qhse/documents/:id/fichier — joindre la pièce (pattern Refashion)
router.post('/documents/:id/fichier', uploadDoc.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
    const before = await pool.query('SELECT fichier_path FROM qhse_documents WHERE id = $1', [req.params.id]);
    if (before.rows.length === 0) {
      try { fs.unlinkSync(req.file.path); } catch (_) { /* ignore */ }
      return res.status(404).json({ error: 'Document introuvable' });
    }
    const ancien = before.rows[0].fichier_path;
    const rel = path.basename(req.file.path);
    let r;
    try {
      r = await pool.query(
        `UPDATE qhse_documents
           SET fichier_path = $1, fichier_original_name = $2, fichier_mime = $3, updated_at = NOW()
         WHERE id = $4 RETURNING *`,
        [rel, req.file.originalname || null, req.file.mimetype || null, req.params.id]
      );
    } catch (e) {
      // Échec DB : ne pas laisser d'orphelin sur le disque.
      try { fs.unlinkSync(req.file.path); } catch (_) { /* ignore */ }
      throw e;
    }
    // Remplacement réussi : supprime l'ancien fichier s'il différait.
    if (ancien && ancien !== rel) {
      try { fs.unlinkSync(path.join(docsDir, path.basename(ancien))); } catch (_) { /* ignore */ }
    }
    res.status(201).json(decorateDocument(r.rows[0]));
  } catch (err) {
    // Nettoyage de l'orphelin sur tout échec après l'écriture Multer (revue Codex
    // PR#78, même classe : lookup initial qui rejette, :id non entier, UPDATE en erreur).
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) { /* ignore */ } }
    console.error('[QHSE] Erreur upload fichier document :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/qhse/documents/:id/fichier — télécharger la pièce
router.get('/documents/:id/fichier', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT fichier_path, fichier_original_name, fichier_mime FROM qhse_documents WHERE id = $1',
      [req.params.id]
    );
    if (r.rowCount === 0 || !r.rows[0].fichier_path) {
      return res.status(404).json({ error: 'Aucune pièce jointe' });
    }
    const abs = path.join(docsDir, path.basename(r.rows[0].fichier_path));
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Fichier introuvable' });
    if (r.rows[0].fichier_mime) res.type(r.rows[0].fichier_mime);
    res.download(abs, r.rows[0].fichier_original_name || path.basename(abs));
  } catch (err) {
    console.error('[QHSE] Erreur download fichier document :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// (e) RETOURS D'EXPÉRIENCE SST — RSEI-07
//     Croise les accidents/presqu'accidents (boucle analyse → action corrective
//     → efficacité vérifiée) avec les incidents terrain (délai de résolution
//     déjà mesuré) pour mettre la boucle SST en récit et en revue périodique.
// ══════════════════════════════════════════════════════════════════════════

// GET /api/qhse/rex?annee= — synthèse des retours d'expérience
router.get('/rex', async (req, res) => {
  try {
    const annee = parseInt(req.query.annee, 10) || new Date().getFullYear();

    // Évènements soumis à REX sur l'année (AT + presqu'accidents).
    const ev = await pool.query(
      `SELECT ev.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name
       FROM qhse_events ev
       LEFT JOIN employees e ON e.id = ev.employee_id
       WHERE EXTRACT(YEAR FROM ev.date_event) = $1 AND ev.type = ANY($2)
       ORDER BY ev.date_event DESC, ev.id DESC`,
      [annee, REX_EVENT_TYPES]
    );
    const events = ev.rows;
    const total = events.length;
    const avec_analyse = events.filter((x) => x.analyse_causes && String(x.analyse_causes).trim());
    const avec_action = events.filter((x) => x.action_corrective && String(x.action_corrective).trim());
    const efficacite_verifiee = events.filter((x) => x.efficacite_verifiee_le);
    // À traiter en priorité : évènement soumis à REX sans analyse des causes.
    const a_analyser = events.filter((x) => !(x.analyse_causes && String(x.analyse_causes).trim()));

    // Incidents terrain de type accident (délai de résolution déjà tracé).
    const inc = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolus,
              AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 86400.0)
                FILTER (WHERE resolved_at IS NOT NULL) AS delai_moyen_jours
       FROM incidents
       WHERE type = 'accident' AND EXTRACT(YEAR FROM created_at) = $1`,
      [annee]
    );
    const i = inc.rows[0];

    res.json({
      annee,
      total_evenements_rex: total,
      taux_analyse: total ? Math.round((avec_analyse.length / total) * 100) : null,
      nb_avec_analyse: avec_analyse.length,
      nb_avec_action_corrective: avec_action.length,
      nb_efficacite_verifiee: efficacite_verifiee.length,
      a_analyser,
      evenements: events,
      incidents_terrain: {
        total: i.total,
        resolus: i.resolus,
        delai_moyen_jours: i.delai_moyen_jours != null ? Math.round(Number(i.delai_moyen_jours) * 10) / 10 : null,
      },
    });
  } catch (err) {
    console.error('[QHSE] Erreur REX :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
// Helpers exportés pour les tests unitaires + réutilisation par le scheduler.
module.exports.computeTauxFrequence = computeTauxFrequence;
module.exports.computeTauxGravite = computeTauxGravite;
module.exports.habilitationStatut = habilitationStatut;
module.exports.documentStatut = documentStatut;
module.exports.syncEmployeeCertBooleans = syncEmployeeCertBooleans;
module.exports.EVENT_TYPES = EVENT_TYPES;
module.exports.HAB_TYPES = HAB_TYPES;
module.exports.EPI_TYPES = EPI_TYPES;
module.exports.DOC_TYPES = DOC_TYPES;
module.exports.REX_EVENT_TYPES = REX_EVENT_TYPES;

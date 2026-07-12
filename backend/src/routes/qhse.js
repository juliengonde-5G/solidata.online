const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

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

// Types d'habilitation qui pilotent les booléens de compétence du planning.
const CACES_TYPES = ['caces_1', 'caces_3', 'caces_5'];

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

module.exports = router;
// Helpers exportés pour les tests unitaires + réutilisation par le scheduler.
module.exports.computeTauxFrequence = computeTauxFrequence;
module.exports.computeTauxGravite = computeTauxGravite;
module.exports.habilitationStatut = habilitationStatut;
module.exports.syncEmployeeCertBooleans = syncEmployeeCertBooleans;
module.exports.EVENT_TYPES = EVENT_TYPES;
module.exports.HAB_TYPES = HAB_TYPES;
module.exports.EPI_TYPES = EPI_TYPES;

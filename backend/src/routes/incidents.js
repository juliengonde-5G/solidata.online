const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════════════════════
// INCIDENTS — cycle de vie transverse (Vague 1, item 44)
// ──────────────────────────────────────────────────────────────────────────
// Avant : la table `incidents` (schéma complet : status open/in_progress/
// resolved/closed, resolved_at, resolved_by) n'avait AUCUNE route de mise à
// jour ni écran → un incident restait « open » à vie (inacceptable pour la
// logistique et le QHSE, cf. personas resp-logistique D2 et resp-qhse §3).
// Ici : liste transverse filtrable + transition de statut avec commentaire de
// résolution obligatoire.
// ══════════════════════════════════════════════════════════════════════════

// Transitions autorisées entre statuts. Sens principal open→in_progress→
// resolved→closed ; réouverture possible depuis resolved/closed.
const INCIDENT_TRANSITIONS = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed', 'open'],
  resolved: ['closed', 'in_progress'],
  closed: ['in_progress'],
};
// Statuts qui exigent un commentaire de résolution.
const REQUIRE_NOTE = new Set(['resolved', 'closed']);
// Statuts « actifs » (l'incident redevient à traiter → on efface la résolution).
const REOPEN_STATUSES = new Set(['open', 'in_progress']);

/**
 * Décide la validité d'une transition de statut d'incident (logique pure,
 * testable). Retourne :
 *  - { error: 'invalid_status'|'transition_forbidden'|'note_required', allowed? }
 *  - { noop: true } si le statut demandé == statut courant (idempotent)
 *  - { ok: true, resolve, reopen, note } sinon
 */
function planIncidentTransition(currentStatus, nextStatus, note) {
  if (!nextStatus || !Object.prototype.hasOwnProperty.call(INCIDENT_TRANSITIONS, nextStatus)) {
    return { error: 'invalid_status', allowed: Object.keys(INCIDENT_TRANSITIONS) };
  }
  if (nextStatus === currentStatus) return { noop: true };
  const allowed = INCIDENT_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(nextStatus)) {
    return { error: 'transition_forbidden', allowed };
  }
  const trimmed = (note || '').trim();
  if (REQUIRE_NOTE.has(nextStatus) && !trimmed) {
    return { error: 'note_required' };
  }
  return {
    ok: true,
    resolve: REQUIRE_NOTE.has(nextStatus),
    reopen: REOPEN_STATUSES.has(nextStatus),
    note: trimmed,
  };
}

router.use(authenticate);
// Vague 2 (item 54) — le rôle QHSE pilote le suivi des incidents/accidents :
// lecture (liste + stats) ET résolution (PATCH de statut). Il rejoint donc les
// ADMIN/MANAGER sur tout le routeur. NB : le délai d'intervention AGRÉGÉ et non
// nominatif destiné à l'auditeur Métropole est exposé séparément côté
// routes/metropole.js (le rôle AUTORITE n'accède jamais à la liste nominative ici).
router.use(authorize('ADMIN', 'MANAGER', 'QHSE'));

// GET /api/incidents — Liste transverse filtrable
// Filtres : status, type, tour_id, vehicle_id, cav_id, from, to (created_at)
router.get('/', async (req, res) => {
  try {
    const { status, type, tour_id, vehicle_id, cav_id, from, to } = req.query;
    const params = [];
    // Les incidents déclarés pendant une formation (mode démo) ne sont pas des
    // incidents d'exploitation : ils sont exclus par défaut de toutes les
    // lectures de ce routeur (liste et statistiques).
    const where = ['COALESCE(i.is_demo, false) = false'];

    if (status) { params.push(status); where.push(`i.status = $${params.length}`); }
    if (type) { params.push(type); where.push(`i.type = $${params.length}`); }
    if (tour_id) { params.push(parseInt(tour_id, 10)); where.push(`i.tour_id = $${params.length}`); }
    if (vehicle_id) { params.push(parseInt(vehicle_id, 10)); where.push(`i.vehicle_id = $${params.length}`); }
    if (cav_id) { params.push(parseInt(cav_id, 10)); where.push(`i.cav_id = $${params.length}`); }
    if (from) { params.push(from); where.push(`i.created_at >= $${params.length}`); }
    if (to) { params.push(to); where.push(`i.created_at <= ($${params.length}::date + INTERVAL '1 day')`); }

    const whereSql = `WHERE ${where.join(' AND ')}`; // `where` contient toujours le filtre anti-démo

    const result = await pool.query(
      `SELECT i.*,
              v.registration AS vehicle_registration, v.name AS vehicle_name,
              c.name AS cav_name, c.commune AS cav_commune,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              t.date AS tour_date,
              CONCAT(u.first_name, ' ', u.last_name) AS resolved_by_name
       -- Les incidents déclarés pendant une formation (mode démo) ne sont pas
       -- des incidents d'exploitation : ils n'apparaissent jamais ici.
       FROM incidents i
       LEFT JOIN vehicles v ON v.id = i.vehicle_id
       LEFT JOIN cav c ON c.id = i.cav_id
       LEFT JOIN employees e ON e.id = i.employee_id
       LEFT JOIN tours t ON t.id = i.tour_id
       LEFT JOIN users u ON u.id = i.resolved_by
       ${whereSql}
       ORDER BY
         CASE i.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
         i.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[INCIDENTS] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/incidents/stats — Compteurs par statut (bandeau de pilotage) +
// délai moyen d'intervention (création → résolution). Le délai (item 53c,
// persona QHSE §3 + auditeur Métropole 2.3) alimente le suivi QHSE. Il est
// mesuré sur les incidents effectivement résolus (resolved_at renseigné).
router.get('/stats', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM incidents WHERE COALESCE(is_demo, false) = false GROUP BY status`
    );
    const stats = { open: 0, in_progress: 0, resolved: 0, closed: 0, total: 0 };
    for (const row of r.rows) {
      if (stats[row.status] !== undefined) stats[row.status] = row.count;
      stats.total += row.count;
    }

    // Délai moyen d'intervention (jours) sur les incidents résolus.
    const delai = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolus,
         ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 86400.0)
               FILTER (WHERE resolved_at IS NOT NULL)::numeric, 1) AS delai_moyen_jours
       FROM incidents WHERE COALESCE(is_demo, false) = false`
    );
    stats.resolus = delai.rows[0]?.resolus || 0;
    stats.delai_moyen_jours = delai.rows[0]?.delai_moyen_jours != null
      ? Number(delai.rows[0].delai_moyen_jours) : null;

    res.json(stats);
  } catch (err) {
    console.error('[INCIDENTS] Erreur stats :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/incidents/:id — Faire évoluer le statut d'un incident
// Body : { status, resolution_notes? }
router.patch('/:id', async (req, res) => {
  try {
    const { status, resolution_notes } = req.body;

    const current = await pool.query('SELECT status FROM incidents WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Incident non trouvé' });
    }
    const currentStatus = current.rows[0].status;

    const plan = planIncidentTransition(currentStatus, status, resolution_notes);

    if (plan.error === 'invalid_status') {
      return res.status(400).json({ error: 'Statut invalide', allowed: plan.allowed });
    }
    if (plan.noop) {
      // Idempotence : demander le statut courant est un no-op → 200 sans effet.
      const unchanged = await pool.query('SELECT * FROM incidents WHERE id = $1', [req.params.id]);
      return res.json(unchanged.rows[0]);
    }
    if (plan.error === 'transition_forbidden') {
      return res.status(400).json({ error: `Transition ${currentStatus} → ${status} non autorisée`, allowed: plan.allowed });
    }
    if (plan.error === 'note_required') {
      return res.status(400).json({ error: 'Un commentaire de résolution est obligatoire pour clôturer ou résoudre un incident' });
    }

    const updates = ['status = $1'];
    const params = [status];

    if (plan.resolve) {
      // Passage en résolu/clos : tracer l'auteur, la date et le commentaire.
      params.push(req.user.id);
      updates.push(`resolved_by = $${params.length}`);
      updates.push('resolved_at = NOW()');
      params.push(plan.note);
      updates.push(`resolution_notes = $${params.length}`);
    } else if (plan.reopen) {
      // Réouverture : l'incident redevient à traiter, on efface la résolution.
      updates.push('resolved_by = NULL');
      updates.push('resolved_at = NULL');
      if (plan.note) {
        params.push(plan.note);
        updates.push(`resolution_notes = $${params.length}`);
      }
    }

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE incidents SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[INCIDENTS] Erreur PATCH :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
module.exports.planIncidentTransition = planIncidentTransition;
module.exports.INCIDENT_TRANSITIONS = INCIDENT_TRANSITIONS;

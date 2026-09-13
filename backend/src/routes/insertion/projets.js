/**
 * Projets cofinancés (FSE+) — PR A lot 2, item 2.1 du plan 07.
 * Monté par ./index.js sur `/projets`, AVANT routes.js ; hérite de
 * `authenticate + requireMfa + authorize('ADMIN','RH','MANAGER')`.
 *
 * POURQUOI LE RATTACHEMENT EST SAISI ET DATÉ. L'autorité (09 § 1.4 F1, S3)
 * exige de savoir QUI appartient à quelle opération et DEPUIS QUAND. Déduire la
 * cohorte d'un statut (« tous les BRSA sont participants ASI ») produirait une
 * liste qui change toute seule quand un statut change, donc une liste
 * indéfendable en contrôle de service fait. Ici, une ligne = une décision
 * humaine, datée, tracée.
 *
 * Habilitations : lecture ouverte au module (le MANAGER voit l'existence d'un
 * rattachement, pas les statuts sociaux qui le motivent) ; écriture ADMIN/RH.
 */
const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { body, param, query } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { journaliser } = require('../../services/fse-participants');

const TYPES = ['asi', 'ocs', 'autre'];

/** Champs éditables d'un projet — liste blanche (aucun `req.body` en vrac). */
const CHAMPS = ['code', 'nom', 'type', 'financeur', 'date_debut', 'date_fin',
  'convention_ref', 'taux_forfaitaire_pct', 'cofinancement_ue_pct', 'actif'];

const validateursProjet = [
  body('nom').optional().isString().trim().isLength({ min: 1, max: 150 }).withMessage('Nom du projet obligatoire (150 caractères max)'),
  body('type').optional().isIn(TYPES).withMessage(`Type invalide (${TYPES.join(', ')})`),
  body('code').optional().isString().trim().isLength({ min: 1, max: 30 }).withMessage('Code obligatoire (30 caractères max)'),
  body('date_debut').optional({ nullable: true }).isISO8601().withMessage('date_debut invalide'),
  body('date_fin').optional({ nullable: true }).isISO8601().withMessage('date_fin invalide'),
  body('taux_forfaitaire_pct').optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage('Taux forfaitaire attendu entre 0 et 100'),
  body('cofinancement_ue_pct').optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage('Cofinancement UE attendu entre 0 et 100'),
  body('actif').optional().isBoolean().withMessage('actif invalide'),
];

// ── GET /api/insertion/projets ─────────────────────────────────────────────
router.get('/', [
  query('actif').optional().isIn(['0', '1']).withMessage('actif invalide (0 ou 1)'),
], validate, async (req, res) => {
  try {
    const where = req.query.actif === '1' ? 'WHERE p.actif = true' : (req.query.actif === '0' ? 'WHERE p.actif = false' : '');
    const r = await pool.query(`
      SELECT p.*,
             (SELECT COUNT(*)::int FROM insertion_projet_participants pp WHERE pp.projet_id = p.id) AS nb_participants
      FROM insertion_projets p ${where}
      ORDER BY p.actif DESC, p.date_debut DESC NULLS LAST, p.code
    `);
    res.json(r.rows);
  } catch (err) {
    console.error('[INSERTION][PROJETS] GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// ── POST /api/insertion/projets ────────────────────────────────────────────
router.post('/', authorize('ADMIN', 'RH'), [
  body('code').isString().trim().isLength({ min: 1, max: 30 }).withMessage('Code obligatoire (30 caractères max)'),
  body('nom').isString().trim().isLength({ min: 1, max: 150 }).withMessage('Nom obligatoire (150 caractères max)'),
  body('type').isIn(TYPES).withMessage(`Type invalide (${TYPES.join(', ')})`),
  ...validateursProjet,
], validate, async (req, res) => {
  try {
    const cols = CHAMPS.filter((c) => c in req.body);
    const vals = cols.map((c) => (req.body[c] === '' ? null : req.body[c]));
    const r = await pool.query(
      `INSERT INTO insertion_projets (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      vals
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un projet porte déjà ce code.', code: 'CODE_DUPLIQUE' });
    console.error('[INSERTION][PROJETS] POST :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// ── PUT /api/insertion/projets/:id ─────────────────────────────────────────
router.put('/:id', authorize('ADMIN', 'RH'), [
  param('id').isInt().withMessage('ID invalide'),
  ...validateursProjet,
], validate, async (req, res) => {
  try {
    const cols = CHAMPS.filter((c) => c in req.body);
    if (cols.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });
    const vals = cols.map((c) => (req.body[c] === '' ? null : req.body[c]));
    vals.push(req.params.id);
    const r = await pool.query(
      `UPDATE insertion_projets SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Projet non trouvé' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un projet porte déjà ce code.', code: 'CODE_DUPLIQUE' });
    console.error('[INSERTION][PROJETS] PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// ── Participants ───────────────────────────────────────────────────────────

// GET /api/insertion/projets/:id/participants
router.get('/:id/participants', [param('id').isInt().withMessage('ID invalide')], validate, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT pp.id, pp.projet_id, pp.employee_id, pp.date_entree, pp.date_sortie, pp.created_at,
             e.first_name, e.last_name, e.insertion_status, e.contract_end
      FROM insertion_projet_participants pp
      JOIN employees e ON e.id = pp.employee_id
      WHERE pp.projet_id = $1
      ORDER BY e.last_name, e.first_name
    `, [req.params.id]);
    res.json(r.rows);
  } catch (err) {
    console.error('[INSERTION][PROJETS] participants GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// POST /api/insertion/projets/:id/participants
router.post('/:id/participants', authorize('ADMIN', 'RH'), [
  param('id').isInt().withMessage('ID invalide'),
  body('employee_id').isInt().withMessage('employee_id invalide'),
  body('date_entree').isISO8601().withMessage("date_entree obligatoire (date d'entrée dans l'opération)"),
  body('date_sortie').optional({ nullable: true }).isISO8601().withMessage('date_sortie invalide'),
], validate, async (req, res) => {
  try {
    const r = await pool.query(
      `INSERT INTO insertion_projet_participants (projet_id, employee_id, date_entree, date_sortie, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, req.body.employee_id, req.body.date_entree, req.body.date_sortie || null, req.user.id]
    );
    // Le rattachement à une opération cofinancée est une décision opposable :
    // elle est journalisée comme telle (qui, quand, quel projet).
    await journaliser(pool, {
      userId: req.user.id, action: 'INSERTION_PROJET_PARTICIPANT', employeeId: req.body.employee_id,
      details: { geste: 'rattachement', projet_id: parseInt(req.params.id, 10), date_entree: req.body.date_entree },
    });
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce salarié est déjà rattaché à ce projet à cette date.', code: 'RATTACHEMENT_DUPLIQUE' });
    if (err.code === '23503') return res.status(404).json({ error: 'Projet ou salarié inconnu.' });
    console.error('[INSERTION][PROJETS] participants POST :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// PUT /api/insertion/projets/:id/participants/:pid — sortie de l'opération
router.put('/:id/participants/:pid', authorize('ADMIN', 'RH'), [
  param('id').isInt().withMessage('ID invalide'),
  param('pid').isInt().withMessage('ID de rattachement invalide'),
  body('date_sortie').optional({ nullable: true }).isISO8601().withMessage('date_sortie invalide'),
  body('date_entree').optional().isISO8601().withMessage('date_entree invalide'),
], validate, async (req, res) => {
  try {
    const sets = []; const vals = [];
    for (const c of ['date_entree', 'date_sortie']) {
      if (c in req.body) { vals.push(req.body[c] === '' ? null : req.body[c]); sets.push(`${c} = $${vals.length}`); }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });
    vals.push(req.params.pid, req.params.id);
    const r = await pool.query(
      `UPDATE insertion_projet_participants SET ${sets.join(', ')}
       WHERE id = $${vals.length - 1} AND projet_id = $${vals.length} RETURNING *`,
      vals
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Rattachement non trouvé' });
    await journaliser(pool, {
      userId: req.user.id, action: 'INSERTION_PROJET_PARTICIPANT', employeeId: r.rows[0].employee_id,
      details: { geste: 'mise a jour', projet_id: parseInt(req.params.id, 10), date_sortie: r.rows[0].date_sortie },
    });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[INSERTION][PROJETS] participants PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// DELETE /api/insertion/projets/:id/participants/:pid
router.delete('/:id/participants/:pid', authorize('ADMIN', 'RH'), [
  param('id').isInt().withMessage('ID invalide'),
  param('pid').isInt().withMessage('ID de rattachement invalide'),
], validate, async (req, res) => {
  try {
    const r = await pool.query(
      'DELETE FROM insertion_projet_participants WHERE id = $1 AND projet_id = $2 RETURNING employee_id',
      [req.params.pid, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Rattachement non trouvé' });
    await journaliser(pool, {
      userId: req.user.id, action: 'INSERTION_PROJET_PARTICIPANT', employeeId: r.rows[0].employee_id,
      details: { geste: 'retrait', projet_id: parseInt(req.params.id, 10) },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[INSERTION][PROJETS] participants DELETE :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

// ── Postes affectés (OCS — amendement F2 : quotité et taux forfaitaire) ─────

// GET /api/insertion/projets/:id/postes
router.get('/:id/postes', [param('id').isInt().withMessage('ID invalide')], validate, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT pp.id, pp.projet_id, pp.user_id, pp.quotite_pct, pp.date_debut, pp.date_fin,
             u.first_name, u.last_name, u.role
      FROM insertion_projet_postes pp
      JOIN users u ON u.id = pp.user_id
      WHERE pp.projet_id = $1
      ORDER BY u.last_name, u.first_name
    `, [req.params.id]);
    res.json(r.rows);
  } catch (err) {
    console.error('[INSERTION][PROJETS] postes GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  }
});

/**
 * PUT /api/insertion/projets/:id/postes — REMPLACEMENT COMPLET de la liste.
 * Un plan de financement se lit d'un bloc : remplacer la liste entière évite
 * l'état intermédiaire où un poste retiré subsisterait dans une feuille de
 * temps déjà imputée. Transactionnel.
 */
router.put('/:id/postes', authorize('ADMIN', 'RH'), [
  param('id').isInt().withMessage('ID invalide'),
  body().isArray().withMessage('Liste de postes attendue'),
  body('*.user_id').isInt().withMessage('user_id invalide'),
  body('*.quotite_pct').isFloat({ gt: 0, max: 100 }).withMessage('Quotité attendue entre 0 (exclu) et 100'),
  body('*.date_debut').optional({ nullable: true }).isISO8601().withMessage('date_debut invalide'),
  body('*.date_fin').optional({ nullable: true }).isISO8601().withMessage('date_fin invalide'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT id FROM insertion_projets WHERE id = $1', [req.params.id]);
    if (exists.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Projet non trouvé' });
    }
    await client.query('DELETE FROM insertion_projet_postes WHERE projet_id = $1', [req.params.id]);
    for (const p of req.body) {
      await client.query(
        `INSERT INTO insertion_projet_postes (projet_id, user_id, quotite_pct, date_debut, date_fin)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.params.id, p.user_id, p.quotite_pct, p.date_debut || null, p.date_fin || null]
      );
    }
    await client.query('COMMIT');
    const r = await pool.query('SELECT * FROM insertion_projet_postes WHERE projet_id = $1 ORDER BY id', [req.params.id]);
    res.json(r.rows);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'Un même intervenant figure deux fois dans la liste.', code: 'POSTE_DUPLIQUE' });
    console.error('[INSERTION][PROJETS] postes PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur', code: err.code });
  } finally {
    client.release();
  }
});

module.exports = router;

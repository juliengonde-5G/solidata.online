const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');
const stateMachine = require('../services/state-machine');

router.use(authenticate);
router.use(autoLogActivity('boutique_commande'));

const STATUTS = ['brouillon', 'envoyee', 'ajustee', 'en_preparation', 'expediee', 'annulee'];

// V5.3 — Adoption pilote du moteur de state machine centralisé
// (cf docs/STATE_MACHINES.md). La constante TRANSITIONS locale est
// retirée ; les règles sont définies dans services/state-machines.js
// (machine 'boutique_commande'). Le moteur valide les transitions et
// écrit dans state_transitions_audit. La table boutique_commande_historique
// reste alimentée pour conserver la traçabilité métier riche
// (commentaire utilisateur, ancien/nouveau statut).

async function generateReference() {
  const year = new Date().getFullYear();
  const result = await pool.query(
    "SELECT MAX(reference) as last FROM boutique_commandes WHERE reference LIKE $1",
    [`BTQ-${year}-%`]
  );
  const last = result.rows[0].last;
  if (!last) return `BTQ-${year}-0001`;
  const num = parseInt(last.split('-')[2]) + 1;
  return `BTQ-${year}-${String(num).padStart(4, '0')}`;
}

async function logHistory(client, commandeId, ancien, nouveau, userId, commentaire = null) {
  await client.query(
    `INSERT INTO boutique_commande_historique
     (commande_id, ancien_statut, nouveau_statut, commentaire, utilisateur_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [commandeId, ancien, nouveau, commentaire, userId]
  );
}

async function checkAndTransition(commandeId, targetStatut, userId, userRole, extra = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM boutique_commandes WHERE id = $1 FOR UPDATE', [commandeId]);
    if (r.rows.length === 0) throw new Error('Commande introuvable');
    const commande = r.rows[0];

    // Validation via le moteur centralisé (V5.3) — vérifie l'enum, les
    // transitions autorisées ET le rôle utilisateur.
    const check = stateMachine.canTransition({
      machine: 'boutique_commande',
      fromState: commande.statut,
      toState: targetStatut,
      userRole,
    });
    if (!check.ok) {
      throw new Error(check.reason);
    }

    const updates = ['statut = $1', 'updated_at = NOW()'];
    const params = [targetStatut];
    let idx = 2;

    if (targetStatut === 'ajustee') {
      updates.push(`ajuste_par = $${idx++}`);
      params.push(userId);
    }
    if (targetStatut === 'expediee') {
      updates.push(`expedie_par = $${idx++}`);
      params.push(userId);
      updates.push(`date_expedition = NOW()`);
    }

    params.push(commandeId);
    await client.query(
      `UPDATE boutique_commandes SET ${updates.join(', ')} WHERE id = $${idx}`,
      params
    );

    await logHistory(client, commandeId, commande.statut, targetStatut, userId, extra.commentaire || null);

    // Si expédition : créer un mouvement de stock sortie
    if (targetStatut === 'expediee') {
      const btq = await client.query('SELECT nom FROM boutiques WHERE id = $1', [commande.boutique_id]);
      const lignes = await client.query(
        'SELECT COALESCE(poids_ajuste_kg, poids_demande_kg) AS poids FROM boutique_commande_lignes WHERE commande_id = $1',
        [commandeId]
      );
      const totalKg = lignes.rows.reduce((s, l) => s + Number(l.poids || 0), 0);
      if (totalKg > 0) {
        await client.query(`
          INSERT INTO stock_movements (type, date, poids_kg, destination, notes, created_by)
          VALUES ('sortie', NOW()::date, $1, $2, $3, $4)
        `, [
          totalKg,
          `Boutique ${btq.rows[0]?.nom || ''}`,
          `Commande ${commande.reference}`,
          userId
        ]);
        // Mise à jour des poids expédiés = poids ajusté par défaut
        await client.query(`
          UPDATE boutique_commande_lignes
          SET poids_expedie_kg = COALESCE(poids_ajuste_kg, poids_demande_kg)
          WHERE commande_id = $1
        `, [commandeId]);
      }
    }

    await client.query('COMMIT');

    // Audit centralisé state machine (post-commit, best effort).
    // L'audit métier (boutique_commande_historique) est déjà écrit dans
    // la transaction via logHistory().
    stateMachine.transition({
      machine: 'boutique_commande',
      entityType: 'boutique_commandes',
      entityId: commandeId,
      fromState: commande.statut,
      toState: targetStatut,
      userId,
      userRole,
      reason: extra.commentaire || null,
    }).catch(() => { /* best effort, déjà loggé en métier */ });

    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// GET /api/boutique-commandes
router.get('/', async (req, res) => {
  try {
    const { boutique_id, statut, date_from, date_to } = req.query;
    let query = `
      SELECT c.*,
             b.nom AS boutique_nom,
             u.first_name || ' ' || u.last_name AS created_by_name,
             ua.first_name || ' ' || ua.last_name AS ajuste_par_name,
             (SELECT COUNT(*) FROM boutique_commande_lignes WHERE commande_id = c.id)::INT AS nb_lignes
      FROM boutique_commandes c
      LEFT JOIN boutiques b ON c.boutique_id = b.id
      LEFT JOIN users u ON c.created_by = u.id
      LEFT JOIN users ua ON c.ajuste_par = ua.id
      WHERE 1=1
    `;
    const params = [];
    if (boutique_id) { params.push(boutique_id); query += ` AND c.boutique_id = $${params.length}`; }
    if (statut) { params.push(statut); query += ` AND c.statut = $${params.length}`; }
    if (date_from) { params.push(date_from); query += ` AND c.date_commande >= $${params.length}`; }
    if (date_to) { params.push(date_to); query += ` AND c.date_commande <= $${params.length}`; }
    query += ' ORDER BY c.date_commande DESC, c.id DESC LIMIT 200';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[boutique-commandes] GET /:', err);
    res.status(500).json({ error: 'Erreur chargement commandes' });
  }
});

// GET /api/boutique-commandes/stats
router.get('/stats', async (req, res) => {
  try {
    const { boutique_id } = req.query;
    let query = `
      SELECT statut,
             COUNT(*)::INT AS nb,
             COALESCE(SUM(poids_total_demande_kg), 0)::FLOAT AS poids_demande,
             COALESCE(SUM(poids_total_ajuste_kg), 0)::FLOAT AS poids_ajuste
      FROM boutique_commandes
      WHERE 1=1
    `;
    const params = [];
    if (boutique_id) { params.push(boutique_id); query += ` AND boutique_id = $${params.length}`; }
    query += ' GROUP BY statut';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur stats' });
  }
});

// GET /api/boutique-commandes/:id — détail avec lignes et historique
router.get('/:id', async (req, res) => {
  try {
    const commande = await pool.query(`
      SELECT c.*, b.nom AS boutique_nom,
             u.first_name || ' ' || u.last_name AS created_by_name,
             ua.first_name || ' ' || ua.last_name AS ajuste_par_name
      FROM boutique_commandes c
      LEFT JOIN boutiques b ON c.boutique_id = b.id
      LEFT JOIN users u ON c.created_by = u.id
      LEFT JOIN users ua ON c.ajuste_par = ua.id
      WHERE c.id = $1
    `, [req.params.id]);
    if (commande.rows.length === 0) return res.status(404).json({ error: 'Introuvable' });

    const lignes = await pool.query(
      'SELECT * FROM boutique_commande_lignes WHERE commande_id = $1 ORDER BY id',
      [req.params.id]
    );
    const historique = await pool.query(`
      SELECT h.*, u.first_name || ' ' || u.last_name AS user_name
      FROM boutique_commande_historique h
      LEFT JOIN users u ON h.utilisateur_id = u.id
      WHERE h.commande_id = $1 ORDER BY h.created_at
    `, [req.params.id]);

    res.json({
      ...commande.rows[0],
      lignes: lignes.rows,
      historique: historique.rows,
    });
  } catch (err) {
    console.error('[boutique-commandes] GET /:id:', err);
    res.status(500).json({ error: 'Erreur' });
  }
});

// POST /api/boutique-commandes — créer (RESP_BTQ, MANAGER, ADMIN)
router.post('/',
  authorize('ADMIN', 'MANAGER', 'RESP_BTQ'),
  [
    body('boutique_id').isInt(),
    body('date_commande').isISO8601(),
    body('lignes').isArray({ min: 1 }).withMessage('Au moins une ligne requise'),
  ],
  validate,
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { boutique_id, date_commande, date_livraison_souhaitee, notes, lignes } = req.body;
      const reference = await generateReference();
      const poidsTotal = lignes.reduce((s, l) => s + Number(l.poids_demande_kg || 0), 0);

      const cmdRes = await client.query(`
        INSERT INTO boutique_commandes
          (reference, boutique_id, date_commande, date_livraison_souhaitee, statut, notes, poids_total_demande_kg, created_by)
        VALUES ($1, $2, $3, $4, 'brouillon', $5, $6, $7)
        RETURNING *
      `, [reference, boutique_id, date_commande, date_livraison_souhaitee || null, notes || null, poidsTotal, req.user.id]);
      const commande = cmdRes.rows[0];

      for (const l of lignes) {
        await client.query(`
          INSERT INTO boutique_commande_lignes (commande_id, categorie, poids_demande_kg, notes)
          VALUES ($1, $2, $3, $4)
        `, [commande.id, l.categorie, l.poids_demande_kg, l.notes || null]);
      }

      await logHistory(client, commande.id, null, 'brouillon', req.user.id, 'Création');
      await client.query('COMMIT');
      res.status(201).json(commande);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[boutique-commandes] POST /:', err);
      res.status(500).json({ error: 'Erreur création' });
    } finally {
      client.release();
    }
  }
);

// PUT /api/boutique-commandes/:id — mise à jour (seulement en brouillon)
router.put('/:id',
  authorize('ADMIN', 'MANAGER', 'RESP_BTQ'),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM boutique_commandes WHERE id = $1', [req.params.id]);
      if (current.rows.length === 0) return res.status(404).json({ error: 'Introuvable' });
      if (current.rows[0].statut !== 'brouillon') {
        return res.status(400).json({ error: 'Seules les commandes en brouillon peuvent être modifiées' });
      }

      const { date_livraison_souhaitee, notes, lignes } = req.body;

      if (lignes) {
        await client.query('DELETE FROM boutique_commande_lignes WHERE commande_id = $1', [req.params.id]);
        let poidsTotal = 0;
        for (const l of lignes) {
          await client.query(`
            INSERT INTO boutique_commande_lignes (commande_id, categorie, poids_demande_kg, notes)
            VALUES ($1, $2, $3, $4)
          `, [req.params.id, l.categorie, l.poids_demande_kg, l.notes || null]);
          poidsTotal += Number(l.poids_demande_kg || 0);
        }
        await client.query(
          'UPDATE boutique_commandes SET poids_total_demande_kg = $1 WHERE id = $2',
          [poidsTotal, req.params.id]
        );
      }

      await client.query(`
        UPDATE boutique_commandes
        SET date_livraison_souhaitee = COALESCE($1, date_livraison_souhaitee),
            notes = COALESCE($2, notes),
            updated_at = NOW()
        WHERE id = $3
      `, [date_livraison_souhaitee || null, notes || null, req.params.id]);

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[boutique-commandes] PUT /:id:', err);
      res.status(500).json({ error: 'Erreur mise à jour' });
    } finally {
      client.release();
    }
  }
);

// PATCH /api/boutique-commandes/:id/envoyer (RESP_BTQ, MANAGER, ADMIN)
router.patch('/:id/envoyer', authorize('ADMIN', 'MANAGER', 'RESP_BTQ'), async (req, res) => {
  try {
    await checkAndTransition(req.params.id, 'envoyee', req.user.id, req.user.role, { commentaire: req.body?.commentaire });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PATCH /api/boutique-commandes/:id/ajuster (MANAGER, ADMIN) — ajuste les poids
router.patch('/:id/ajuster', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { ajustements } = req.body || {};

    if (Array.isArray(ajustements)) {
      let totalAjuste = 0;
      for (const a of ajustements) {
        await client.query(
          'UPDATE boutique_commande_lignes SET poids_ajuste_kg = $1 WHERE id = $2 AND commande_id = $3',
          [a.poids_ajuste_kg, a.ligne_id, req.params.id]
        );
        totalAjuste += Number(a.poids_ajuste_kg || 0);
      }
      await client.query(
        'UPDATE boutique_commandes SET poids_total_ajuste_kg = $1 WHERE id = $2',
        [totalAjuste, req.params.id]
      );
    }

    await client.query('COMMIT');
    await checkAndTransition(req.params.id, 'ajustee', req.user.id, req.user.role, { commentaire: req.body?.commentaire });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch('/:id/preparer', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    await checkAndTransition(req.params.id, 'en_preparation', req.user.id, req.user.role, { commentaire: req.body?.commentaire });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.patch('/:id/expedier', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    await checkAndTransition(req.params.id, 'expediee', req.user.id, req.user.role, { commentaire: req.body?.commentaire });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.patch('/:id/annuler', authorize('ADMIN', 'MANAGER', 'RESP_BTQ'), async (req, res) => {
  try {
    await checkAndTransition(req.params.id, 'annulee', req.user.id, req.user.role, { commentaire: req.body?.commentaire });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;

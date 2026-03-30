const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

router.use(authenticate);
router.use(autoLogActivity('tri'));

// ══════ CHAÎNES DE TRI ══════

// GET /api/tri/chaines
router.get('/chaines', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ct.*, COUNT(ot.id) as nb_operations
      FROM chaines_tri ct
      LEFT JOIN operations_tri ot ON ot.chaine_id = ct.id
      GROUP BY ct.id ORDER BY ct.nom
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[TRI] Erreur chaînes :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tri/chaines/:id — Chaîne complète avec opérations, postes et sorties
router.get('/chaines/:id', async (req, res) => {
  try {
    const chaine = await pool.query('SELECT * FROM chaines_tri WHERE id = $1', [req.params.id]);
    if (chaine.rows.length === 0) return res.status(404).json({ error: 'Chaîne non trouvée' });

    const operations = await pool.query(
      'SELECT * FROM operations_tri WHERE chaine_id = $1 ORDER BY numero',
      [req.params.id]
    );

    const result = { ...chaine.rows[0], operations: [] };

    for (const op of operations.rows) {
      const postes = await pool.query(
        'SELECT * FROM postes_operation WHERE operation_id = $1 ORDER BY code',
        [op.id]
      );
      const sorties = await pool.query(
        `SELECT so.*, cs.nom as categorie_sortante_nom, cs.famille,
         od.nom as destination_operation_nom
         FROM sorties_operation so
         LEFT JOIN categories_sortantes cs ON so.categorie_sortante_id = cs.id
         LEFT JOIN operations_tri od ON so.operation_destination_id = od.id
         WHERE so.operation_id = $1`,
        [op.id]
      );

      result.operations.push({
        ...op,
        postes: postes.rows,
        sorties: sorties.rows,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('[TRI] Erreur détail chaîne :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tri/chaines
router.post('/chaines', authorize('ADMIN'), [
  body('nom').notEmpty().withMessage('Nom requis'),
], validate, async (req, res) => {
  try {
    const { nom, description } = req.body;
    const result = await pool.query(
      'INSERT INTO chaines_tri (nom, description) VALUES ($1, $2) RETURNING *',
      [nom, description]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TRI] Erreur création chaîne :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════ OPÉRATIONS ══════

// POST /api/tri/operations
router.post('/operations', authorize('ADMIN', 'MANAGER'), [
  body('chaine_id').isInt().withMessage('ID chaîne requis'),
  body('nom').notEmpty().withMessage('Nom requis'),
], validate, async (req, res) => {
  try {
    const { chaine_id, numero, nom, code, est_obligatoire, description } = req.body;
    const result = await pool.query(
      `INSERT INTO operations_tri (chaine_id, numero, nom, code, est_obligatoire, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [chaine_id, numero, nom, code, est_obligatoire !== false, description]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TRI] Erreur création opération :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════ POSTES ══════

// POST /api/tri/postes
router.post('/postes', authorize('ADMIN', 'MANAGER'), [
  body('operation_id').isInt().withMessage('ID opération requis'),
  body('nom').notEmpty().withMessage('Nom requis'),
], validate, async (req, res) => {
  try {
    const { operation_id, nom, code, est_obligatoire, permet_doublure, competences_requises } = req.body;
    const result = await pool.query(
      `INSERT INTO postes_operation (operation_id, nom, code, est_obligatoire, permet_doublure, competences_requises)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [operation_id, nom, code, est_obligatoire !== false, permet_doublure || false, competences_requises || []]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TRI] Erreur création poste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════ SORTIES ══════

// POST /api/tri/sorties
router.post('/sorties', authorize('ADMIN', 'MANAGER'), [
  body('operation_id').isInt().withMessage('ID opération requis'),
  body('nom').notEmpty().withMessage('Nom requis'),
], validate, async (req, res) => {
  try {
    const { operation_id, nom, type_sortie, operation_destination_id, categorie_sortante_id } = req.body;
    const result = await pool.query(
      `INSERT INTO sorties_operation (operation_id, nom, type_sortie, operation_destination_id, categorie_sortante_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [operation_id, nom, type_sortie, operation_destination_id, categorie_sortante_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TRI] Erreur création sortie :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tri/categories (alias)
router.get('/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories_sortantes ORDER BY famille, nom');
    res.json(result.rows);
  } catch (err) {
    console.error('[TRI] Erreur catégories :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tri/categories-sortantes
router.get('/categories-sortantes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories_sortantes ORDER BY famille, nom');
    res.json(result.rows);
  } catch (err) {
    console.error('[TRI] Erreur catégories :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════ LOTS / BATCHES ══════

// POST /api/tri/batches — Créer un lot à trier
router.post('/batches', authorize('ADMIN', 'MANAGER'), [
  body('chaine_id').isInt().withMessage('ID chaîne requis'),
  body('poids_initial_kg').isFloat({ min: 0 }).withMessage('Poids initial requis (valeur numérique)'),
], validate, async (req, res) => {
  try {
    const { stock_movement_id, chaine_id, poids_initial_kg } = req.body;
    if (!chaine_id || !poids_initial_kg) {
      return res.status(400).json({ error: 'chaine_id et poids_initial_kg requis' });
    }
    const code = `LOT-${Date.now().toString(36).toUpperCase()}`;
    const result = await pool.query(
      `INSERT INTO batch_tracking (code, stock_movement_id, chaine_id, poids_initial_kg, poids_restant_kg, created_by)
       VALUES ($1, $2, $3, $4, $4, $5) RETURNING *`,
      [code, stock_movement_id || null, chaine_id, poids_initial_kg, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TRI] Erreur création lot :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tri/batches — Liste des lots
router.get('/batches', async (req, res) => {
  try {
    const { status, chaine_id } = req.query;
    let query = `SELECT bt.*, ct.nom as chaine_nom,
      (SELECT COUNT(*) FROM operation_executions oe WHERE oe.batch_id = bt.id) as nb_operations
      FROM batch_tracking bt
      LEFT JOIN chaines_tri ct ON bt.chaine_id = ct.id WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); query += ` AND bt.status = $${params.length}`; }
    if (chaine_id) { params.push(chaine_id); query += ` AND bt.chaine_id = $${params.length}`; }
    query += ' ORDER BY bt.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[TRI] Erreur liste lots :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tri/batches/:id — Détail d'un lot avec ses exécutions
router.get('/batches/:id', async (req, res) => {
  try {
    const batch = await pool.query(
      `SELECT bt.*, ct.nom as chaine_nom FROM batch_tracking bt
       LEFT JOIN chaines_tri ct ON bt.chaine_id = ct.id WHERE bt.id = $1`, [req.params.id]);
    if (batch.rows.length === 0) return res.status(404).json({ error: 'Lot non trouvé' });

    const executions = await pool.query(
      `SELECT oe.*, ot.nom as operation_nom, ot.code as operation_code, ot.numero
       FROM operation_executions oe
       LEFT JOIN operations_tri ot ON oe.operation_id = ot.id
       WHERE oe.batch_id = $1 ORDER BY ot.numero`, [req.params.id]);

    for (const exec of executions.rows) {
      const outputs = await pool.query(
        `SELECT oo.*, cs.nom as categorie_nom, cs.famille, so.nom as sortie_nom
         FROM operation_outputs oo
         LEFT JOIN categories_sortantes cs ON oo.categorie_sortante_id = cs.id
         LEFT JOIN sorties_operation so ON oo.sortie_id = so.id
         WHERE oo.execution_id = $1`, [exec.id]);
      exec.outputs = outputs.rows;
    }

    res.json({ ...batch.rows[0], executions: executions.rows });
  } catch (err) {
    console.error('[TRI] Erreur détail lot :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tri/batches/:id/start — Démarrer un lot
router.put('/batches/:id/start', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE batch_tracking SET status = 'en_cours', date_debut = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'en_attente' RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Lot non trouvé ou déjà démarré' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TRI] Erreur démarrage lot :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════ EXÉCUTIONS D'OPÉRATIONS ══════

// POST /api/tri/executions — Démarrer une opération sur un lot
router.post('/executions', authorize('ADMIN', 'MANAGER'), [
  body('batch_id').isInt().withMessage('ID lot requis'),
  body('operation_id').isInt().withMessage('ID opération requis'),
], validate, async (req, res) => {
  try {
    const { batch_id, operation_id, poids_entree_kg } = req.body;
    if (!batch_id || !operation_id) {
      return res.status(400).json({ error: 'batch_id et operation_id requis' });
    }
    const result = await pool.query(
      `INSERT INTO operation_executions (batch_id, operation_id, poids_entree_kg, status, started_at)
       VALUES ($1, $2, $3, 'en_cours', NOW()) RETURNING *`,
      [batch_id, operation_id, poids_entree_kg || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TRI] Erreur création exécution :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tri/executions/:id/complete — Terminer une opération
router.put('/executions/:id/complete', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { notes } = req.body;

    // Calculer le total des sorties
    const outputsTotal = await pool.query(
      'SELECT COALESCE(SUM(poids_kg), 0) as total FROM operation_outputs WHERE execution_id = $1',
      [req.params.id]
    );

    const exec = await pool.query('SELECT * FROM operation_executions WHERE id = $1', [req.params.id]);
    if (exec.rows.length === 0) return res.status(404).json({ error: 'Exécution non trouvée' });

    const poidsEntree = exec.rows[0].poids_entree_kg || 0;
    const poidsSortie = parseFloat(outputsTotal.rows[0].total);
    const perte = Math.max(0, poidsEntree - poidsSortie);

    const result = await pool.query(
      `UPDATE operation_executions SET status = 'termine', poids_sortie_total_kg = $1,
       perte_kg = $2, completed_at = NOW(), completed_by = $3, notes = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [poidsSortie, perte, req.user.id, notes, req.params.id]
    );

    // Mettre à jour le poids restant du lot
    const batchId = exec.rows[0].batch_id;
    await pool.query(
      `UPDATE batch_tracking SET poids_restant_kg = poids_restant_kg - $1, updated_at = NOW()
       WHERE id = $2`,
      [poidsSortie, batchId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TRI] Erreur complétion exécution :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tri/executions/:id/outputs — Ajouter une sortie à une opération
router.post('/executions/:id/outputs', authorize('ADMIN', 'MANAGER'), [
  body('sortie_id').isInt().withMessage('ID sortie requis'),
  body('poids_kg').isFloat({ min: 0 }).withMessage('Poids requis (valeur numérique)'),
], validate, async (req, res) => {
  try {
    const { sortie_id, poids_kg, categorie_sortante_id, notes } = req.body;
    if (!sortie_id || !poids_kg) {
      return res.status(400).json({ error: 'sortie_id et poids_kg requis' });
    }
    const result = await pool.query(
      `INSERT INTO operation_outputs (execution_id, sortie_id, poids_kg, categorie_sortante_id, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, sortie_id, poids_kg, categorie_sortante_id || null, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TRI] Erreur ajout sortie :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════ COLISAGES ══════

// POST /api/tri/colisages — Créer un colisage
router.post('/colisages', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { categorie_sortante_id, type_conteneur_id, exutoire_id } = req.body;
    const code = `COL-${Date.now().toString(36).toUpperCase()}`;
    const result = await pool.query(
      `INSERT INTO colisages (code, categorie_sortante_id, type_conteneur_id, exutoire_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [code, categorie_sortante_id || null, type_conteneur_id || null, exutoire_id || null, req.user.id]
    );

    // Logger la création
    await pool.query(
      'INSERT INTO colisage_history (colisage_id, to_status, comment, changed_by) VALUES ($1, $2, $3, $4)',
      [result.rows[0].id, 'ouvert', 'Colisage créé', req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TRI] Erreur création colisage :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tri/colisages — Liste des colisages
router.get('/colisages', async (req, res) => {
  try {
    const { status, categorie_sortante_id } = req.query;
    let query = `SELECT c.*, cs.nom as categorie_nom, cs.famille,
      tc.nom as conteneur_nom, e.nom as exutoire_nom
      FROM colisages c
      LEFT JOIN categories_sortantes cs ON c.categorie_sortante_id = cs.id
      LEFT JOIN types_conteneurs tc ON c.type_conteneur_id = tc.id
      LEFT JOIN exutoires e ON c.exutoire_id = e.id WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); query += ` AND c.status = $${params.length}`; }
    if (categorie_sortante_id) { params.push(categorie_sortante_id); query += ` AND c.categorie_sortante_id = $${params.length}`; }
    query += ' ORDER BY c.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[TRI] Erreur liste colisages :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tri/colisages/:id — Détail d'un colisage
router.get('/colisages/:id', async (req, res) => {
  try {
    const colisage = await pool.query(
      `SELECT c.*, cs.nom as categorie_nom, tc.nom as conteneur_nom, e.nom as exutoire_nom
       FROM colisages c
       LEFT JOIN categories_sortantes cs ON c.categorie_sortante_id = cs.id
       LEFT JOIN types_conteneurs tc ON c.type_conteneur_id = tc.id
       LEFT JOIN exutoires e ON c.exutoire_id = e.id
       WHERE c.id = $1`, [req.params.id]);
    if (colisage.rows.length === 0) return res.status(404).json({ error: 'Colisage non trouvé' });

    const items = await pool.query(
      'SELECT * FROM colisage_items WHERE colisage_id = $1 ORDER BY created_at', [req.params.id]);
    const history = await pool.query(
      `SELECT ch.*, u.first_name, u.last_name FROM colisage_history ch
       LEFT JOIN users u ON ch.changed_by = u.id
       WHERE ch.colisage_id = $1 ORDER BY ch.created_at`, [req.params.id]);

    res.json({ ...colisage.rows[0], items: items.rows, history: history.rows });
  } catch (err) {
    console.error('[TRI] Erreur détail colisage :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tri/colisages/:id/items — Ajouter un article au colisage
router.post('/colisages/:id/items', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { output_id, produit_fini_id, poids_kg, description } = req.body;
    const colisage = await pool.query('SELECT status FROM colisages WHERE id = $1', [req.params.id]);
    if (colisage.rows.length === 0) return res.status(404).json({ error: 'Colisage non trouvé' });
    if (colisage.rows[0].status !== 'ouvert') {
      return res.status(400).json({ error: 'Le colisage doit être ouvert pour ajouter des articles' });
    }

    const item = await pool.query(
      `INSERT INTO colisage_items (colisage_id, output_id, produit_fini_id, poids_kg, description)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, output_id || null, produit_fini_id || null, poids_kg || null, description]
    );

    // Mettre à jour les totaux du colisage
    await pool.query(
      `UPDATE colisages SET
       poids_kg = COALESCE(poids_kg, 0) + COALESCE($1, 0),
       nb_articles = nb_articles + 1, updated_at = NOW()
       WHERE id = $2`,
      [poids_kg, req.params.id]
    );

    res.status(201).json(item.rows[0]);
  } catch (err) {
    console.error('[TRI] Erreur ajout article :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tri/colisages/:id/status — Changer le statut d'un colisage
router.put('/colisages/:id/status', authorize('ADMIN', 'MANAGER'), [
  body('status').notEmpty().withMessage('Statut requis'),
], validate, async (req, res) => {
  try {
    const { status, comment } = req.body;
    const validTransitions = {
      ouvert: ['scelle'],
      scelle: ['expedie', 'ouvert'],
      expedie: ['livre'],
    };

    const current = await pool.query('SELECT status FROM colisages WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Colisage non trouvé' });

    const allowed = validTransitions[current.rows[0].status];
    if (!allowed || !allowed.includes(status)) {
      return res.status(400).json({ error: `Transition ${current.rows[0].status} → ${status} non autorisée` });
    }

    const updates = ['status = $1', 'updated_at = NOW()'];
    const params = [status];
    if (status === 'scelle') {
      updates.push(`scelle_at = NOW()`, `scelle_by = $${params.length + 1}`);
      params.push(req.user.id);
    }
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE colisages SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);

    await pool.query(
      'INSERT INTO colisage_history (colisage_id, from_status, to_status, comment, changed_by) VALUES ($1, $2, $3, $4, $5)',
      [req.params.id, current.rows[0].status, status, comment, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TRI] Erreur changement statut colisage :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tri/inventory — Inventaire en temps réel par catégorie sortante
router.get('/inventory', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        cs.id, cs.nom, cs.famille,
        COALESCE(SUM(CASE WHEN c.status = 'ouvert' THEN c.poids_kg ELSE 0 END), 0) as poids_ouvert_kg,
        COALESCE(SUM(CASE WHEN c.status = 'scelle' THEN c.poids_kg ELSE 0 END), 0) as poids_scelle_kg,
        COALESCE(SUM(CASE WHEN c.status = 'expedie' THEN c.poids_kg ELSE 0 END), 0) as poids_expedie_kg,
        COALESCE(SUM(CASE WHEN c.status = 'livre' THEN c.poids_kg ELSE 0 END), 0) as poids_livre_kg,
        COUNT(CASE WHEN c.status IN ('ouvert', 'scelle') THEN 1 END) as nb_colisages_en_stock,
        COUNT(CASE WHEN c.status = 'expedie' THEN 1 END) as nb_colisages_en_transit
      FROM categories_sortantes cs
      LEFT JOIN colisages c ON c.categorie_sortante_id = cs.id
      GROUP BY cs.id, cs.nom, cs.famille
      ORDER BY cs.famille, cs.nom
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[TRI] Erreur inventaire :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

router.use(authenticate);
router.use(autoLogActivity('tri'));

// Familles Refashion officielles (aligne le CHECK de categories_sortantes.famille_refashion,
// cf. init-db.js). Les vues DPAV/cohérence de la vague 1 en dépendent → obligatoire à la saisie.
const FAMILLES_REFASHION = ['reutilisation', 'recyclage', 'csr', 'elimination', 'retour'];

// ══════ CHAÎNES DE TRI ══════

// GET /api/tri/chaines
router.get('/chaines', async (req, res) => {
  try {
    // Fix bug O4 : ajout du count `nb_postes` (attendu par
    // frontend/src/pages/ChaineTri.jsx, sinon affichait "undefined").
    const result = await pool.query(`
      SELECT ct.*,
             COUNT(DISTINCT ot.id) as nb_operations,
             COUNT(DISTINCT po.id) as nb_postes
      FROM chaines_tri ct
      LEFT JOIN operations_tri ot ON ot.chaine_id = ct.id
      LEFT JOIN postes_operation po ON po.operation_id = ot.id
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

// PUT /api/tri/chaines/:id — édition + activation/désactivation (pas de suppression dure)
router.put('/chaines/:id', authorize('ADMIN'), [
  body('nom').notEmpty().withMessage('Nom requis'),
], validate, async (req, res) => {
  try {
    const { nom, description, is_active } = req.body;
    const result = await pool.query(
      `UPDATE chaines_tri SET nom = $1, description = $2,
              is_active = COALESCE($3, is_active)
       WHERE id = $4 RETURNING *`,
      [nom, description || null, typeof is_active === 'boolean' ? is_active : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Chaîne introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Une chaîne porte déjà ce nom' });
    console.error('[TRI] Erreur mise à jour chaîne :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════ OPÉRATIONS ══════

// GET /api/tri/operations?chaine_id= — liste des opérations (admin : inclut les inactives)
router.get('/operations', authorize('ADMIN'), async (req, res) => {
  try {
    const { chaine_id } = req.query;
    const params = [];
    let where = '';
    if (chaine_id) { params.push(chaine_id); where = 'WHERE ot.chaine_id = $1'; }
    const result = await pool.query(
      `SELECT ot.*,
              (SELECT COUNT(*) FROM postes_operation po WHERE po.operation_id = ot.id) AS nb_postes
       FROM operations_tri ot ${where} ORDER BY ot.chaine_id, ot.numero`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[TRI] Erreur liste opérations :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

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
    if (err.code === '23505') return res.status(409).json({ error: 'Numéro ou code d’opération déjà utilisé' });
    console.error('[TRI] Erreur création opération :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tri/operations/:id — édition + activation/désactivation
router.put('/operations/:id', authorize('ADMIN'), [
  body('nom').notEmpty().withMessage('Nom requis'),
], validate, async (req, res) => {
  try {
    const { numero, nom, code, est_obligatoire, description, is_active } = req.body;
    const result = await pool.query(
      `UPDATE operations_tri SET
              numero = COALESCE($1, numero), nom = $2, code = COALESCE($3, code),
              est_obligatoire = COALESCE($4, est_obligatoire),
              description = $5, is_active = COALESCE($6, is_active)
       WHERE id = $7 RETURNING *`,
      [
        (numero != null && numero !== '') ? parseInt(numero) : null,
        nom, code || null,
        typeof est_obligatoire === 'boolean' ? est_obligatoire : null,
        description || null,
        typeof is_active === 'boolean' ? is_active : null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Opération introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Numéro ou code d’opération déjà utilisé' });
    console.error('[TRI] Erreur mise à jour opération :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════ POSTES ══════

// GET /api/tri/postes?operation_id= — liste des postes (admin : inclut les inactifs)
router.get('/postes', authorize('ADMIN'), async (req, res) => {
  try {
    const { operation_id } = req.query;
    const params = [];
    let where = '';
    if (operation_id) { params.push(operation_id); where = 'WHERE operation_id = $1'; }
    const result = await pool.query(
      `SELECT * FROM postes_operation ${where} ORDER BY operation_id, code`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[TRI] Erreur liste postes :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

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
    if (err.code === '23505') return res.status(409).json({ error: 'Code de poste déjà utilisé' });
    console.error('[TRI] Erreur création poste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tri/postes/:id — édition + activation/désactivation
router.put('/postes/:id', authorize('ADMIN'), [
  body('nom').notEmpty().withMessage('Nom requis'),
], validate, async (req, res) => {
  try {
    const { nom, code, est_obligatoire, permet_doublure, competences_requises, is_active } = req.body;
    const result = await pool.query(
      `UPDATE postes_operation SET
              nom = $1, code = COALESCE($2, code),
              est_obligatoire = COALESCE($3, est_obligatoire),
              permet_doublure = COALESCE($4, permet_doublure),
              competences_requises = COALESCE($5, competences_requises),
              is_active = COALESCE($6, is_active)
       WHERE id = $7 RETURNING *`,
      [
        nom, code || null,
        typeof est_obligatoire === 'boolean' ? est_obligatoire : null,
        typeof permet_doublure === 'boolean' ? permet_doublure : null,
        Array.isArray(competences_requises) ? competences_requises : null,
        typeof is_active === 'boolean' ? is_active : null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Poste introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Code de poste déjà utilisé' });
    console.error('[TRI] Erreur mise à jour poste :', err);
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
    const result = await pool.query("SELECT * FROM categories_sortantes WHERE is_active IS DISTINCT FROM false ORDER BY famille, nom");
    res.json(result.rows);
  } catch (err) {
    console.error('[TRI] Erreur catégories :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tri/categories-sortantes
router.get('/categories-sortantes', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM categories_sortantes WHERE is_active IS DISTINCT FROM false ORDER BY famille, nom");
    res.json(result.rows);
  } catch (err) {
    console.error('[TRI] Erreur catégories :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tri/admin/categories — toutes les catégories (ADMIN, inclut les inactives, triées par ordre)
router.get('/admin/categories', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categories_sortantes ORDER BY ordre NULLS LAST, nom');
    res.json(result.rows);
  } catch (err) {
    console.error('[TRI] Erreur catégories (admin) :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tri/categories-sortantes — création (famille_refashion obligatoire)
router.post('/categories-sortantes', authorize('ADMIN'), [
  body('nom').notEmpty().withMessage('Nom requis'),
  body('famille').notEmpty().withMessage('Famille requise'),
  body('famille_refashion').isIn(FAMILLES_REFASHION).withMessage('Famille Refashion invalide'),
], validate, async (req, res) => {
  try {
    const { nom, famille, famille_refashion } = req.body;
    const ordre = (req.body.ordre != null && req.body.ordre !== '') ? parseInt(req.body.ordre) : 100;
    const result = await pool.query(
      `INSERT INTO categories_sortantes (nom, famille, famille_refashion, ordre, is_active)
       VALUES ($1, $2, $3, $4, true) RETURNING *`,
      [nom, famille, famille_refashion, Number.isNaN(ordre) ? 100 : ordre]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Une catégorie porte déjà ce nom' });
    console.error('[TRI] Erreur création catégorie :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tri/categories-sortantes/:id — édition + activation/désactivation.
// Pas de suppression dure : une catégorie peut être référencée par des mouvements
// de stock/DPAV → on désactive via is_active (les vues DPAV restent cohérentes).
router.put('/categories-sortantes/:id', authorize('ADMIN'), [
  body('nom').notEmpty().withMessage('Nom requis'),
  body('famille').notEmpty().withMessage('Famille requise'),
  body('famille_refashion').isIn(FAMILLES_REFASHION).withMessage('Famille Refashion invalide'),
], validate, async (req, res) => {
  try {
    const { nom, famille, famille_refashion, is_active } = req.body;
    const ordre = (req.body.ordre != null && req.body.ordre !== '') ? parseInt(req.body.ordre) : null;
    const result = await pool.query(
      `UPDATE categories_sortantes SET
              nom = $1, famille = $2, famille_refashion = $3,
              ordre = COALESCE($4, ordre), is_active = COALESCE($5, is_active)
       WHERE id = $6 RETURNING *`,
      [
        nom, famille, famille_refashion,
        (ordre != null && !Number.isNaN(ordre)) ? ordre : null,
        typeof is_active === 'boolean' ? is_active : null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Catégorie introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Une catégorie porte déjà ce nom' });
    console.error('[TRI] Erreur mise à jour catégorie :', err);
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

    // Écriture ATOMIQUE : création du lot + sortie de stock original associée.
    // Hors transaction, un échec du mouvement de stock laissait un lot orphelin
    // (entré en tri sans la sortie de stock correspondante, donc grand livre faussé).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO batch_tracking (code, stock_movement_id, chaine_id, poids_initial_kg, poids_restant_kg, created_by)
         VALUES ($1, $2, $3, $4, $4, $5) RETURNING *`,
        [code, stock_movement_id || null, chaine_id, poids_initial_kg, req.user.id]
      );

      // Stock Original : sortie automatique quand lot entre en tri
      if (poids_initial_kg > 0) {
        await client.query(
          `INSERT INTO stock_original_movements (type, date, poids_kg, batch_id, origine, notes, created_by)
           VALUES ('sortie', CURRENT_DATE, $1, $2, 'tri_batch', $3, $4)`,
          [poids_initial_kg, result.rows[0].id,
           `Auto: lot ${result.rows[0].code} en tri (${poids_initial_kg} kg)`, req.user.id]
        );
      }

      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
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

    // Traçabilité aval (R6) : cartons étiquetés rattachés à ce lot, avec leur
    // sortie de stock (statut + type de commande + date). Rend visible la
    // chaîne lot → carton → sortie.
    const cartons = await pool.query(
      `SELECT id, code_barre, produit, categorie_eco_org, gamme, poids_kg,
              status, sortie_commande_type, date_sortie, date_fabrication
       FROM produits_finis WHERE batch_id = $1 ORDER BY date_fabrication DESC`,
      [req.params.id]
    );

    res.json({ ...batch.rows[0], executions: executions.rows, cartons: cartons.rows });
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

// GET /api/tri/executions?date=YYYY-MM-DD — exécutions du jour (défaut : aujourd'hui).
// Alimente la page atelier « Saisie d'exécution » (liste en cours / terminées).
router.get('/executions', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const date = req.query.date || null; // null → CURRENT_DATE
    const result = await pool.query(
      `SELECT oe.id, oe.batch_id, oe.operation_id, oe.status, oe.poids_entree_kg,
              oe.poids_sortie_total_kg, oe.perte_kg, oe.started_at, oe.completed_at, oe.notes,
              bt.code AS batch_code, bt.chaine_id, ct.nom AS chaine_nom,
              ot.nom AS operation_nom, ot.code AS operation_code, ot.numero,
              COALESCE((SELECT SUM(oo.poids_kg) FROM operation_outputs oo WHERE oo.execution_id = oe.id), 0) AS poids_sortie_courant,
              (SELECT COUNT(*) FROM operation_outputs oo WHERE oo.execution_id = oe.id) AS nb_sorties
       FROM operation_executions oe
       JOIN batch_tracking bt ON bt.id = oe.batch_id
       LEFT JOIN chaines_tri ct ON ct.id = bt.chaine_id
       LEFT JOIN operations_tri ot ON ot.id = oe.operation_id
       WHERE COALESCE(oe.started_at, oe.created_at)::date = COALESCE($1::date, CURRENT_DATE)
       ORDER BY COALESCE(oe.started_at, oe.created_at) DESC, oe.id DESC`,
      [date]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[TRI] Erreur liste exécutions :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tri/executions/:id — détail d'une exécution + ses sorties (reprise atelier)
router.get('/executions/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const exec = await pool.query(
      `SELECT oe.*, bt.code AS batch_code, bt.status AS batch_status, bt.poids_restant_kg,
              bt.poids_initial_kg, bt.chaine_id, ct.nom AS chaine_nom,
              ot.nom AS operation_nom, ot.code AS operation_code, ot.numero
       FROM operation_executions oe
       JOIN batch_tracking bt ON bt.id = oe.batch_id
       LEFT JOIN chaines_tri ct ON ct.id = bt.chaine_id
       LEFT JOIN operations_tri ot ON ot.id = oe.operation_id
       WHERE oe.id = $1`,
      [req.params.id]
    );
    if (exec.rows.length === 0) return res.status(404).json({ error: 'Exécution introuvable' });
    const outputs = await pool.query(
      `SELECT oo.*, cs.nom AS categorie_nom, cs.famille, cs.famille_refashion
       FROM operation_outputs oo
       LEFT JOIN categories_sortantes cs ON cs.id = oo.categorie_sortante_id
       WHERE oo.execution_id = $1 ORDER BY oo.created_at`,
      [req.params.id]
    );
    res.json({ ...exec.rows[0], outputs: outputs.rows });
  } catch (err) {
    console.error('[TRI] Erreur détail exécution :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tri/executions — Démarrer une opération sur un lot.
// Transactionnel : verrou sur le lot, refus si lot clôturé/annulé, cohérence
// opération↔chaîne du lot, et démarrage paresseux du lot (en_attente → en_cours).
router.post('/executions', authorize('ADMIN', 'MANAGER'), [
  body('batch_id').isInt().withMessage('ID lot requis'),
  body('operation_id').isInt().withMessage('ID opération requis'),
], validate, async (req, res) => {
  const client = await pool.connect();
  try {
    const { batch_id, operation_id } = req.body;
    const rawPoids = req.body.poids_entree_kg;
    const poidsEntree = (rawPoids != null && rawPoids !== '')
      ? parseFloat(String(rawPoids).replace(',', '.')) : null;

    await client.query('BEGIN');
    const batch = await client.query(
      'SELECT id, status FROM batch_tracking WHERE id = $1 FOR UPDATE', [batch_id]);
    if (batch.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Lot introuvable' });
    }
    if (['termine', 'annule'].includes(batch.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Lot ${batch.rows[0].status} : impossible de démarrer une opération` });
    }
    // L'opération doit appartenir à la chaîne du lot (cohérence référentiel).
    const op = await client.query(
      `SELECT ot.id FROM operations_tri ot
       JOIN batch_tracking bt ON bt.chaine_id = ot.chaine_id
       WHERE ot.id = $1 AND bt.id = $2`, [operation_id, batch_id]);
    if (op.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: "L'opération ne fait pas partie de la chaîne de ce lot" });
    }
    if (batch.rows[0].status === 'en_attente') {
      await client.query(
        `UPDATE batch_tracking SET status = 'en_cours', date_debut = COALESCE(date_debut, NOW()), updated_at = NOW()
         WHERE id = $1`, [batch_id]);
    }
    const result = await client.query(
      `INSERT INTO operation_executions (batch_id, operation_id, poids_entree_kg, status, started_at)
       VALUES ($1, $2, $3, 'en_cours', NOW()) RETURNING *`,
      [batch_id, operation_id, (poidsEntree != null && !Number.isNaN(poidsEntree)) ? poidsEntree : null]
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[TRI] Erreur création exécution :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// PUT /api/tri/executions/:id/complete — Terminer une opération
// Transactionnel + idempotent : verrou FOR UPDATE et garde anti re-complétion
// (sinon poids restant du lot et stock trié seraient comptés en double). I4 :
// à la complétion, les sorties triées sont reversées en stock (une entrée par
// catégorie sortante) — auparavant le stock trié par catégorie n'était alimenté
// par RIEN (rupture R2/R5 de l'audit).
router.put('/executions/:id/complete', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { notes } = req.body;
    await client.query('BEGIN');

    const exec = await client.query(
      `SELECT oe.*, bt.code AS batch_code FROM operation_executions oe
       JOIN batch_tracking bt ON bt.id = oe.batch_id
       WHERE oe.id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (exec.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Exécution non trouvée' });
    }
    if (exec.rows[0].status === 'termine') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Opération déjà terminée' });
    }

    const outputs = await client.query(
      'SELECT id, poids_kg, categorie_sortante_id FROM operation_outputs WHERE execution_id = $1',
      [req.params.id]
    );
    const poidsEntree = exec.rows[0].poids_entree_kg || 0;
    const poidsSortie = outputs.rows.reduce((s, o) => s + parseFloat(o.poids_kg || 0), 0);
    const perte = Math.max(0, poidsEntree - poidsSortie);

    const result = await client.query(
      `UPDATE operation_executions SET status = 'termine', poids_sortie_total_kg = $1,
       perte_kg = $2, completed_at = NOW(), completed_by = $3, notes = $4
       WHERE id = $5 RETURNING *`,
      [poidsSortie, perte, req.user.id, notes || null, req.params.id]
    );

    await client.query(
      `UPDATE batch_tracking SET poids_restant_kg = poids_restant_kg - $1, updated_at = NOW()
       WHERE id = $2`,
      [poidsSortie, exec.rows[0].batch_id]
    );

    // I4 — reversement des sorties triées en stock (entrée par catégorie).
    // matiere_id référence categories_sortantes (cf. A1) → categorie_sortante_id
    // est une FK valide.
    let stockLines = 0;
    for (const o of outputs.rows) {
      if (o.categorie_sortante_id && parseFloat(o.poids_kg) > 0) {
        await client.query(
          `INSERT INTO stock_movements (type, date, poids_kg, matiere_id, origine, notes, created_by)
           VALUES ('entree', CURRENT_DATE, $1, $2, 'tri', $3, $4)`,
          [o.poids_kg, o.categorie_sortante_id, `Tri lot ${exec.rows[0].batch_code} (exécution #${req.params.id})`, req.user.id]
        );
        stockLines++;
      }
    }

    await client.query('COMMIT');
    res.json({ ...result.rows[0], stock_lines_created: stockLines });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[TRI] Erreur complétion exécution :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// POST /api/tri/executions/:id/outputs — Ajouter une sortie (pilotée par la CATÉGORIE).
// La saisie atelier est catégorie-driven : categorie_sortante_id pilote le reversement
// stock à la complétion (aucune sortie_operation n'est seedée, sortie_id reste optionnel).
router.post('/executions/:id/outputs', authorize('ADMIN', 'MANAGER'), [
  body('categorie_sortante_id').isInt().withMessage('Catégorie sortante requise'),
  body('poids_kg').isFloat({ gt: 0 }).withMessage('Poids requis (valeur numérique > 0)'),
], validate, async (req, res) => {
  try {
    const { poids_kg, categorie_sortante_id, sortie_id, notes } = req.body;
    // L'exécution doit exister et ne pas être terminée (sinon la sortie ne serait
    // jamais reversée en stock — le reversement a lieu à la complétion).
    const exec = await pool.query('SELECT status FROM operation_executions WHERE id = $1', [req.params.id]);
    if (exec.rows.length === 0) return res.status(404).json({ error: 'Exécution introuvable' });
    if (exec.rows[0].status === 'termine') {
      return res.status(409).json({ error: 'Opération déjà terminée : impossible d’ajouter une sortie' });
    }
    const result = await pool.query(
      `INSERT INTO operation_outputs (execution_id, sortie_id, poids_kg, categorie_sortante_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, sortie_id || null, poids_kg, categorie_sortante_id, notes || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TRI] Erreur ajout sortie :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/tri/executions/:id/outputs/:outputId — corriger une sortie mal saisie
// (uniquement tant que l'exécution n'est pas terminée).
router.delete('/executions/:id/outputs/:outputId', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const exec = await pool.query('SELECT status FROM operation_executions WHERE id = $1', [req.params.id]);
    if (exec.rows.length === 0) return res.status(404).json({ error: 'Exécution introuvable' });
    if (exec.rows[0].status === 'termine') {
      return res.status(409).json({ error: 'Opération terminée : les sorties sont figées' });
    }
    const del = await pool.query(
      'DELETE FROM operation_outputs WHERE id = $1 AND execution_id = $2 RETURNING id',
      [req.params.outputId, req.params.id]);
    if (del.rows.length === 0) return res.status(404).json({ error: 'Sortie introuvable' });
    res.json({ deleted: del.rows[0].id });
  } catch (err) {
    console.error('[TRI] Erreur suppression sortie :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════ COLISAGES ══════

// POST /api/tri/colisages — Créer un colisage
router.post('/colisages', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { categorie_sortante_id, type_conteneur_id, exutoire_id } = req.body;
    const code = `COL-${Date.now().toString(36).toUpperCase()}`;

    // Écriture ATOMIQUE : création du colisage + première ligne d'historique.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO colisages (code, categorie_sortante_id, type_conteneur_id, exutoire_id, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [code, categorie_sortante_id || null, type_conteneur_id || null, exutoire_id || null, req.user.id]
      );

      // Logger la création
      await client.query(
        'INSERT INTO colisage_history (colisage_id, to_status, comment, changed_by) VALUES ($1, $2, $3, $4)',
        [result.rows[0].id, 'ouvert', 'Colisage créé', req.user.id]
      );

      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
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

    // Écriture ATOMIQUE + verrou : contrôle du statut « ouvert », insertion de l'article
    // et incrément des totaux (poids + nb_articles) indivisibles. Le FOR UPDATE sérialise
    // les ajouts concurrents — auparavant `nb_articles = nb_articles + 1` sur lecture non
    // verrouillée pouvait perdre des incréments (race), et le contrôle de statut était
    // sujet au TOCTOU.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const colisage = await client.query('SELECT status FROM colisages WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (colisage.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Colisage non trouvé' });
      }
      if (colisage.rows[0].status !== 'ouvert') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Le colisage doit être ouvert pour ajouter des articles' });
      }

      const item = await client.query(
        `INSERT INTO colisage_items (colisage_id, output_id, produit_fini_id, poids_kg, description)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.params.id, output_id || null, produit_fini_id || null, poids_kg || null, description]
      );

      // Mettre à jour les totaux du colisage
      await client.query(
        `UPDATE colisages SET
         poids_kg = COALESCE(poids_kg, 0) + COALESCE($1, 0),
         nb_articles = nb_articles + 1, updated_at = NOW()
         WHERE id = $2`,
        [poids_kg, req.params.id]
      );

      await client.query('COMMIT');
      res.status(201).json(item.rows[0]);
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
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

    // Transition ATOMIQUE + verrou : lecture verrouillée du statut courant (FOR UPDATE),
    // validation de la transition, UPDATE et trace d'historique indivisibles. Corrige le
    // TOCTOU (SELECT puis UPDATE non verrouillés) et évite un historique orphelin.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT status FROM colisages WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (current.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Colisage non trouvé' });
      }

      const allowed = validTransitions[current.rows[0].status];
      if (!allowed || !allowed.includes(status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Transition ${current.rows[0].status} → ${status} non autorisée` });
      }

      const updates = ['status = $1', 'updated_at = NOW()'];
      const params = [status];
      if (status === 'scelle') {
        updates.push(`scelle_at = NOW()`, `scelle_by = $${params.length + 1}`);
        params.push(req.user.id);
      }
      params.push(req.params.id);

      const result = await client.query(
        `UPDATE colisages SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);

      await client.query(
        'INSERT INTO colisage_history (colisage_id, from_status, to_status, comment, changed_by) VALUES ($1, $2, $3, $4, $5)',
        [req.params.id, current.rows[0].status, status, comment, req.user.id]
      );

      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
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

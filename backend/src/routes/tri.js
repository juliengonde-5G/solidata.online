const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

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
router.post('/chaines', authorize('ADMIN'), async (req, res) => {
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
router.post('/operations', authorize('ADMIN', 'MANAGER'), async (req, res) => {
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
router.post('/postes', authorize('ADMIN', 'MANAGER'), async (req, res) => {
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
router.post('/sorties', authorize('ADMIN', 'MANAGER'), async (req, res) => {
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

module.exports = router;

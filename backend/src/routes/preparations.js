const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('ADMIN', 'MANAGER'));

// GET /api/preparations — List preparations with filters
router.get('/', async (req, res) => {
  try {
    const { lieu_chargement, statut_preparation, date_from, date_to } = req.query;
    let query = `
      SELECT p.*, c.reference, c.type_produit, cl.raison_sociale
      FROM preparations_expedition p
      JOIN commandes_exutoires c ON p.commande_id = c.id
      JOIN clients_exutoires cl ON c.client_id = cl.id
      WHERE 1=1`;
    const params = [];

    if (lieu_chargement) { params.push(lieu_chargement); query += ` AND p.lieu_chargement = $${params.length}`; }
    if (statut_preparation) { params.push(statut_preparation); query += ` AND p.statut_preparation = $${params.length}`; }
    if (date_from) { params.push(date_from); query += ` AND p.date_livraison_remorque >= $${params.length}`; }
    if (date_to) { params.push(date_to); query += ` AND p.date_expedition <= $${params.length}`; }

    query += ' ORDER BY p.date_livraison_remorque DESC';
    const result = await pool.query(query, params);

    // Fetch collaborators for each preparation
    const preparations = result.rows;
    for (const prep of preparations) {
      const collabResult = await pool.query(
        `SELECT e.id as employee_id, e.first_name, e.last_name
         FROM preparation_collaborateurs pc
         JOIN employees e ON pc.employee_id = e.id
         WHERE pc.preparation_id = $1`,
        [prep.id]
      );
      prep.collaborateurs = collabResult.rows;
    }

    res.json(preparations);
  } catch (err) {
    console.error('[PREPARATIONS] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/preparations/gantt — Gantt chart data
router.get('/gantt', async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    if (!date_from || !date_to) {
      return res.status(400).json({ error: 'date_from et date_to requis' });
    }

    const result = await pool.query(
      `SELECT p.id, c.reference as commande_reference, cl.raison_sociale as client,
       c.type_produit, p.lieu_chargement, p.date_livraison_remorque as date_debut,
       p.date_expedition as date_fin, p.statut_preparation as statut, p.transporteur
       FROM preparations_expedition p
       JOIN commandes_exutoires c ON p.commande_id = c.id
       JOIN clients_exutoires cl ON c.client_id = cl.id
       WHERE p.date_livraison_remorque <= $2 AND p.date_expedition >= $1
       ORDER BY p.date_livraison_remorque`,
      [date_from, date_to]
    );

    const grouped = {
      quai_chargement: [],
      garage_remorque: [],
      cours: []
    };

    for (const row of result.rows) {
      const lieu = row.lieu_chargement;
      if (grouped[lieu]) {
        grouped[lieu].push(row);
      }
    }

    res.json(grouped);
  } catch (err) {
    console.error('[PREPARATIONS] Erreur gantt :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/preparations/conflits — Check conflicts for a proposed time slot
router.get('/conflits', async (req, res) => {
  try {
    const { lieu_chargement, date_debut, date_fin, exclude_id } = req.query;
    if (!lieu_chargement || !date_debut || !date_fin) {
      return res.status(400).json({ error: 'lieu_chargement, date_debut et date_fin requis' });
    }

    let query = `
      SELECT p.*, c.reference, c.type_produit, cl.raison_sociale
      FROM preparations_expedition p
      JOIN commandes_exutoires c ON p.commande_id = c.id
      JOIN clients_exutoires cl ON c.client_id = cl.id
      WHERE p.lieu_chargement = $1
        AND p.date_livraison_remorque < $3
        AND p.date_expedition > $2`;
    const params = [lieu_chargement, date_debut, date_fin];

    if (exclude_id) {
      params.push(exclude_id);
      query += ` AND p.id != $${params.length}`;
    }

    const result = await pool.query(query, params);
    res.json({
      conflit: result.rows.length > 0,
      preparations_en_conflit: result.rows
    });
  } catch (err) {
    console.error('[PREPARATIONS] Erreur conflits :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/preparations — Create preparation
router.post('/', async (req, res) => {
  try {
    const { commande_id, transporteur, date_livraison_remorque, date_expedition, lieu_chargement, notes_preparation, collaborateurs } = req.body;

    if (!commande_id || !transporteur || !date_livraison_remorque || !date_expedition || !lieu_chargement) {
      return res.status(400).json({ error: 'commande_id, transporteur, date_livraison_remorque, date_expedition et lieu_chargement requis' });
    }

    // Check for conflicts
    const conflictResult = await pool.query(
      `SELECT p.*, c.reference, c.type_produit, cl.raison_sociale
       FROM preparations_expedition p
       JOIN commandes_exutoires c ON p.commande_id = c.id
       JOIN clients_exutoires cl ON c.client_id = cl.id
       WHERE p.lieu_chargement = $1
         AND p.date_livraison_remorque < $3
         AND p.date_expedition > $2`,
      [lieu_chargement, date_livraison_remorque, date_expedition]
    );

    if (conflictResult.rows.length > 0) {
      return res.status(409).json({
        error: 'Conflit de lieu de chargement',
        conflits: conflictResult.rows
      });
    }

    // Create preparation
    const prepResult = await pool.query(
      `INSERT INTO preparations_expedition (commande_id, transporteur, date_livraison_remorque, date_expedition, lieu_chargement, notes_preparation)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [commande_id, transporteur, date_livraison_remorque, date_expedition, lieu_chargement, notes_preparation || null]
    );
    const preparation = prepResult.rows[0];

    // Insert collaborators
    const collabs = [];
    if (collaborateurs && collaborateurs.length > 0) {
      // Fetch commande info for schedule notes
      const commandeResult = await pool.query(
        'SELECT reference, type_produit FROM commandes_exutoires WHERE id = $1',
        [commande_id]
      );
      const commande = commandeResult.rows[0];

      for (const employee_id of collaborateurs) {
        await pool.query(
          'INSERT INTO preparation_collaborateurs (preparation_id, employee_id) VALUES ($1, $2)',
          [preparation.id, employee_id]
        );
        collabs.push(employee_id);

        // Insert schedule entry
        const scheduleDate = new Date(date_expedition).toISOString().slice(0, 10);
        await pool.query(
          `INSERT INTO schedule (employee_id, date, status, shift_type, notes)
           VALUES ($1, $2, 'work', 'chargement_exutoire', $3)
           ON CONFLICT (employee_id, date) DO UPDATE SET shift_type = 'chargement_exutoire', notes = $3`,
          [employee_id, scheduleDate, `${commande.reference} - ${commande.type_produit}`]
        );
      }
    }

    // Update commande statut
    await pool.query(
      "UPDATE commandes_exutoires SET statut = 'en_preparation', updated_at = NOW() WHERE id = $1",
      [commande_id]
    );

    // Fetch collaborator details
    if (collabs.length > 0) {
      const collabResult = await pool.query(
        `SELECT e.id as employee_id, e.first_name, e.last_name
         FROM preparation_collaborateurs pc
         JOIN employees e ON pc.employee_id = e.id
         WHERE pc.preparation_id = $1`,
        [preparation.id]
      );
      preparation.collaborateurs = collabResult.rows;
    } else {
      preparation.collaborateurs = [];
    }

    res.status(201).json(preparation);
  } catch (err) {
    console.error('[PREPARATIONS] Erreur creation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/preparations/:id — Update preparation
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { commande_id, transporteur, date_livraison_remorque, date_expedition, lieu_chargement, notes_preparation, collaborateurs } = req.body;

    // Check preparation exists
    const existing = await pool.query('SELECT * FROM preparations_expedition WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Preparation non trouvee' });
    }

    const current = existing.rows[0];
    const newLieu = lieu_chargement || current.lieu_chargement;
    const newDebut = date_livraison_remorque || current.date_livraison_remorque;
    const newFin = date_expedition || current.date_expedition;

    // Check for conflicts if lieu or dates changed
    const lieuChanged = lieu_chargement && lieu_chargement !== current.lieu_chargement;
    const datesChanged = (date_livraison_remorque && date_livraison_remorque !== current.date_livraison_remorque.toISOString()) ||
                         (date_expedition && date_expedition !== current.date_expedition.toISOString());

    if (lieuChanged || datesChanged) {
      const conflictResult = await pool.query(
        `SELECT p.*, c.reference, c.type_produit, cl.raison_sociale
         FROM preparations_expedition p
         JOIN commandes_exutoires c ON p.commande_id = c.id
         JOIN clients_exutoires cl ON c.client_id = cl.id
         WHERE p.lieu_chargement = $1
           AND p.date_livraison_remorque < $3
           AND p.date_expedition > $2
           AND p.id != $4`,
        [newLieu, newDebut, newFin, id]
      );

      if (conflictResult.rows.length > 0) {
        return res.status(409).json({
          error: 'Conflit de lieu de chargement',
          conflits: conflictResult.rows
        });
      }
    }

    // Update preparation
    const updateResult = await pool.query(
      `UPDATE preparations_expedition SET
       commande_id = COALESCE($1, commande_id),
       transporteur = COALESCE($2, transporteur),
       date_livraison_remorque = COALESCE($3, date_livraison_remorque),
       date_expedition = COALESCE($4, date_expedition),
       lieu_chargement = COALESCE($5, lieu_chargement),
       notes_preparation = COALESCE($6, notes_preparation),
       updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [commande_id, transporteur, date_livraison_remorque, date_expedition, lieu_chargement, notes_preparation, id]
    );
    const preparation = updateResult.rows[0];

    // Update collaborators if provided
    if (collaborateurs) {
      // Delete old collaborators
      await pool.query('DELETE FROM preparation_collaborateurs WHERE preparation_id = $1', [id]);

      // Delete old schedule entries
      const oldScheduleDate = new Date(current.date_expedition).toISOString().slice(0, 10);
      await pool.query(
        "DELETE FROM schedule WHERE shift_type = 'chargement_exutoire' AND date = $1 AND employee_id IN (SELECT employee_id FROM preparation_collaborateurs WHERE preparation_id = $2)",
        [oldScheduleDate, id]
      );

      // Fetch commande info for schedule notes
      const commandeResult = await pool.query(
        'SELECT reference, type_produit FROM commandes_exutoires WHERE id = $1',
        [preparation.commande_id]
      );
      const commande = commandeResult.rows[0];

      // Insert new collaborators and schedule entries
      for (const employee_id of collaborateurs) {
        await pool.query(
          'INSERT INTO preparation_collaborateurs (preparation_id, employee_id) VALUES ($1, $2)',
          [id, employee_id]
        );

        const scheduleDate = new Date(preparation.date_expedition).toISOString().slice(0, 10);
        await pool.query(
          `INSERT INTO schedule (employee_id, date, status, shift_type, notes)
           VALUES ($1, $2, 'work', 'chargement_exutoire', $3)
           ON CONFLICT (employee_id, date) DO UPDATE SET shift_type = 'chargement_exutoire', notes = $3`,
          [employee_id, scheduleDate, `${commande.reference} - ${commande.type_produit}`]
        );
      }
    }

    // Fetch collaborator details
    const collabResult = await pool.query(
      `SELECT e.id as employee_id, e.first_name, e.last_name
       FROM preparation_collaborateurs pc
       JOIN employees e ON pc.employee_id = e.id
       WHERE pc.preparation_id = $1`,
      [id]
    );
    preparation.collaborateurs = collabResult.rows;

    res.json(preparation);
  } catch (err) {
    console.error('[PREPARATIONS] Erreur mise a jour :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /api/preparations/:id/statut — Change preparation status
router.patch('/:id/statut', async (req, res) => {
  try {
    const { id } = req.params;
    const { statut_preparation, pesee_interne } = req.body;

    if (!statut_preparation) {
      return res.status(400).json({ error: 'statut_preparation requis' });
    }

    // Fetch current preparation with commande info
    const existing = await pool.query(
      `SELECT p.*, c.reference, c.type_produit, cl.raison_sociale
       FROM preparations_expedition p
       JOIN commandes_exutoires c ON p.commande_id = c.id
       JOIN clients_exutoires cl ON c.client_id = cl.id
       WHERE p.id = $1`,
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Preparation non trouvee' });
    }
    const current = existing.rows[0];

    let updateFields = 'statut_preparation = $1, updated_at = NOW()';
    const params = [statut_preparation];
    let paramIndex = 1;

    if (statut_preparation === 'remorque_livree') {
      updateFields += ', heure_reception_remorque = NOW()';
    } else if (statut_preparation === 'en_chargement') {
      updateFields += ', heure_debut_chargement = NOW()';
    } else if (statut_preparation === 'prete') {
      updateFields += ', heure_fin_chargement = NOW()';
      if (pesee_interne !== undefined) {
        paramIndex++;
        params.push(pesee_interne);
        updateFields += `, pesee_interne = $${paramIndex}`;
      }
    } else if (statut_preparation === 'expediee') {
      updateFields += ', heure_depart = NOW()';
      if (pesee_interne !== undefined) {
        paramIndex++;
        params.push(pesee_interne);
        updateFields += `, pesee_interne = $${paramIndex}`;
      }
    }

    paramIndex++;
    params.push(id);
    const updateResult = await pool.query(
      `UPDATE preparations_expedition SET ${updateFields} WHERE id = $${paramIndex} RETURNING *`,
      params
    );
    const preparation = updateResult.rows[0];

    // Handle 'expediee' status: update commande + create stock movement
    if (statut_preparation === 'expediee') {
      // Update commande statut
      await pool.query(
        "UPDATE commandes_exutoires SET statut = 'expediee', updated_at = NOW() WHERE id = $1",
        [current.commande_id]
      );

      // Create stock movement (convert tonnes to kg)
      const poidsKg = (preparation.pesee_interne || 0) * 1000;
      const notes = `${current.reference} - ${current.type_produit} - ${current.raison_sociale}`;
      const codeBarre = 'EXU-' + current.reference;

      const stockResult = await pool.query(
        `INSERT INTO stock_movements (type, date, poids_kg, destination, notes, origine, created_by, code_barre)
         VALUES ('sortie', NOW(), $1, 'exutoire', $2, 'exutoire_provisoire', $3, $4) RETURNING id`,
        [poidsKg, notes, req.user.id, codeBarre]
      );

      preparation.stock_movement_id = stockResult.rows[0].id;
    }

    res.json(preparation);
  } catch (err) {
    console.error('[PREPARATIONS] Erreur changement statut :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/preparations/:id — Delete preparation
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await pool.query('SELECT * FROM preparations_expedition WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Preparation non trouvee' });
    }

    if (existing.rows[0].statut_preparation !== 'planifiee') {
      return res.status(400).json({ error: 'Seules les preparations planifiees peuvent etre supprimees' });
    }

    const current = existing.rows[0];

    // Delete schedule entries for collaborators
    const scheduleDate = new Date(current.date_expedition).toISOString().slice(0, 10);
    const collabIds = await pool.query(
      'SELECT employee_id FROM preparation_collaborateurs WHERE preparation_id = $1',
      [id]
    );
    if (collabIds.rows.length > 0) {
      const employeeIds = collabIds.rows.map(r => r.employee_id);
      await pool.query(
        `DELETE FROM schedule WHERE shift_type = 'chargement_exutoire' AND date = $1 AND employee_id = ANY($2)`,
        [scheduleDate, employeeIds]
      );
    }

    // Delete collaborators (CASCADE should handle this, but explicit for schedule cleanup above)
    await pool.query('DELETE FROM preparation_collaborateurs WHERE preparation_id = $1', [id]);

    // Delete preparation
    await pool.query('DELETE FROM preparations_expedition WHERE id = $1', [id]);

    res.json({ message: 'Preparation supprimee' });
  } catch (err) {
    console.error('[PREPARATIONS] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

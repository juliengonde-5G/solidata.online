const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');

// Upload is passed from index.js via router factory
module.exports = function createExecutionRouter(upload) {
  // GET /api/tours/my — Vehicules et tournees du jour (mobile)
  // Retourne toutes les tournees du jour (planned + in_progress) + vehicules disponibles
  // Marque is_assigned_vehicle=true si le véhicule est affecté au chauffeur connecté
  router.get('/my', async (req, res) => {
    try {
      // Récupérer l'employee_id du chauffeur connecté
      const userId = req.user.id;
      const empRes = await pool.query('SELECT id FROM employees WHERE user_id = $1', [userId]);
      const myEmployeeId = empRes.rows.length > 0 ? empRes.rows[0].id : null;

      // 1. Toutes les tournees du jour (pas de filtre par chauffeur)
      const toursResult = await pool.query(`
        SELECT t.*, v.registration, v.name as vehicle_name,
         v.assigned_driver_id,
         CONCAT(e.first_name, ' ', e.last_name) as driver_name,
         COALESCE(t.nb_cav, (SELECT COUNT(*)::int FROM tour_cav tc WHERE tc.tour_id = t.id)) as nb_cav,
         (SELECT COUNT(*)::int FROM tour_cav tc WHERE tc.tour_id = t.id AND tc.status = 'collected') as collected_count,
         false as is_free_vehicle
        FROM tours t
        LEFT JOIN vehicles v ON t.vehicle_id = v.id
        LEFT JOIN employees e ON t.driver_employee_id = e.id
        WHERE t.date = CURRENT_DATE
          AND t.status IN ('planned', 'in_progress')
        ORDER BY t.status = 'in_progress' DESC, t.date ASC, t.created_at DESC
      `);

      // Ajouter le flag is_assigned_vehicle
      const tours = toursResult.rows.map(t => ({
        ...t,
        is_assigned_vehicle: myEmployeeId && t.assigned_driver_id === myEmployeeId,
      }));

      // 2. Vehicules disponibles sans tournee du jour
      const vehicleIdsInTours = tours
        .filter(t => t.vehicle_id)
        .map(t => t.vehicle_id);

      let freeVehicles = [];
      try {
        const vParams = [];
        let vExclude = '';
        if (vehicleIdsInTours.length > 0) {
          vParams.push(vehicleIdsInTours);
          vExclude = `AND v.id != ALL($1::int[])`;
        }
        const vRes = await pool.query(`
          SELECT v.id as vehicle_id, v.registration, v.name as vehicle_name, NULL as vehicle_type,
            v.assigned_driver_id,
            NULL::int as id, 'planned' as status, CURRENT_DATE as date,
            NULL::int as driver_employee_id, NULL as driver_name,
            0 as nb_cav, 0 as collected_count, true as is_free_vehicle
          FROM vehicles v
          WHERE v.status = 'available'
            ${vExclude}
          ORDER BY v.name, v.registration
        `, vParams);
        freeVehicles = vRes.rows.map(v => ({
          ...v,
          is_assigned_vehicle: myEmployeeId && v.assigned_driver_id === myEmployeeId,
        }));
      } catch (err) {
        console.error('[TOURS] Erreur véhicules libres:', err.message);
      }

      // Trier : véhicule affecté au chauffeur en premier
      const all = [...tours, ...freeVehicles];
      all.sort((a, b) => (b.is_assigned_vehicle ? 1 : 0) - (a.is_assigned_vehicle ? 1 : 0));

      res.json(all);
    } catch (err) {
      console.error('[TOURS] Erreur /my :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // POST /api/tours/claim-vehicle — Le chauffeur prend un vehicule libre (sans tournee)
  // Cree une tournee a la volee pour ce vehicule
  router.post('/claim-vehicle', [
    body('vehicle_id').isInt().withMessage('ID véhicule requis'),
  ], validate, async (req, res) => {
    try {
      const userId = req.user.id;
      const { vehicle_id } = req.body;

      const empResult = await pool.query('SELECT id FROM employees WHERE user_id = $1', [userId]);
      if (empResult.rows.length === 0) {
        return res.status(400).json({ error: 'Aucune fiche employe liee a votre compte' });
      }
      const employeeId = empResult.rows[0].id;

      // Verifier que le vehicule n'est pas deja en tournee
      const existing = await pool.query(
        `SELECT id FROM tours WHERE vehicle_id = $1 AND date = CURRENT_DATE AND status IN ('planned', 'in_progress')`,
        [vehicle_id]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Ce vehicule est deja en tournee aujourd\'hui' });
      }

      // Creer une tournee a la volee
      const result = await pool.query(
        `INSERT INTO tours (vehicle_id, driver_employee_id, date, status, created_at, updated_at)
         VALUES ($1, $2, CURRENT_DATE, 'in_progress', NOW(), NOW())
         RETURNING *`,
        [vehicle_id, employeeId]
      );

      res.json(result.rows[0]);
    } catch (err) {
      console.error('[TOURS] Erreur claim-vehicle :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // PUT /api/tours/:id/claim — Le chauffeur prend une tournee planifiee
  // Le claim assigne le chauffeur connecte et passe la tournee en in_progress
  // Seule une tournee planned peut etre claimee -> atomique
  router.put('/:id/claim', async (req, res) => {
    try {
      const userId = req.user.id;
      const empResult = await pool.query('SELECT id FROM employees WHERE user_id = $1', [userId]);
      if (empResult.rows.length === 0) {
        return res.status(400).json({ error: 'Aucune fiche employe liee a votre compte' });
      }
      const employeeId = empResult.rows[0].id;

      // Assigner le chauffeur et passer en in_progress atomiquement
      // Seule une tournee planned peut etre claimee (empeche double claim)
      const result = await pool.query(
        `UPDATE tours SET driver_employee_id = $1, status = 'in_progress', updated_at = NOW()
         WHERE id = $2 AND status = 'planned'
         RETURNING *`,
        [employeeId, req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(409).json({ error: 'Ce véhicule a déjà été pris par un autre chauffeur' });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error('[TOURS] Erreur claim :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // PUT /api/tours/:id/status — Changer le statut
  router.put('/:id/status', [
    body('status').isIn(['planned', 'in_progress', 'paused', 'completed', 'cancelled']).withMessage('Statut invalide'),
  ], validate, async (req, res) => {
    try {
      const { status } = req.body;

      const updates = ['status = $1', 'updated_at = NOW()'];
      const params = [status];

      if (status === 'in_progress') updates.push('started_at = NOW()');
      if (status === 'completed') updates.push('completed_at = NOW()');

      // Auto-assigner le chauffeur connecté si pas encore assigné
      if (status === 'in_progress' && req.user) {
        const empRes = await pool.query('SELECT id FROM employees WHERE user_id = $1', [req.user.id]);
        if (empRes.rows.length > 0) {
          params.push(empRes.rows[0].id);
          updates.push(`driver_employee_id = COALESCE(driver_employee_id, $${params.length})`);
        }
      }

      params.push(req.params.id);
      const result = await pool.query(
        `UPDATE tours SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );

      if (result.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });

      // Actions post-tournée si terminé
      if (status === 'completed' || status === 'cancelled') {
        const tour = result.rows[0];

        // Mettre à jour le tonnage dans l'historique si complété
        if (status === 'completed' && tour.total_weight_kg > 0) {
          const cavs = await pool.query(
            "SELECT cav_id FROM tour_cav WHERE tour_id = $1 AND status = 'collected'",
            [req.params.id]
          );
          const weightPerCav = tour.total_weight_kg / (cavs.rows.length || 1);
          for (const tc of cavs.rows) {
            await pool.query(
              "INSERT INTO tonnage_history (date, cav_id, weight_kg, source) VALUES ($1, $2, $3, 'mobile')",
              [tour.date, tc.cav_id, weightPerCav]
            );
          }

          // Création automatique du mouvement de stock (entrée matière première)
          await pool.query(
            `INSERT INTO stock_movements (type, date, poids_kg, tour_id, vehicle_id, origine, notes, created_by)
             VALUES ('entree', $1, $2, $3, $4, 'collecte', $5, $6)`,
            [tour.date, tour.total_weight_kg, parseInt(req.params.id), tour.vehicle_id,
             `Auto: tournée #${req.params.id} (${cavs.rows.length} CAV collectés)`, req.user.id]
          );
        }

        // Apprentissage continu : enregistrer prédit vs observé (fill_level 0-5)
        if (status === 'completed') {
          const tourCavs = await pool.query(
            'SELECT cav_id, predicted_fill_rate, fill_level FROM tour_cav WHERE tour_id = $1 AND predicted_fill_rate IS NOT NULL AND fill_level IS NOT NULL',
            [req.params.id]
          );
          for (const tc of tourCavs.rows) {
            await pool.query(
              `INSERT INTO collection_learning_feedback (tour_id, cav_id, predicted_fill_rate, observed_fill_level)
               VALUES ($1, $2, $3, $4)`,
              [req.params.id, tc.cav_id, tc.predicted_fill_rate, tc.fill_level]
            );
          }
        }
      } else if (status === 'in_progress') {
        const tour = result.rows[0];
        await pool.query("UPDATE vehicles SET status = 'in_use' WHERE id = $1", [tour.vehicle_id]);
      }

      // Émettre l'événement Socket.io
      const io = req.app.get('io');
      if (io) io.to(`tour-${req.params.id}`).emit('tour-status-update', { tourId: req.params.id, status });

      res.json(result.rows[0]);
    } catch (err) {
      console.error('[TOURS] Erreur changement statut :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // PUT /api/tours/:tourId/cav/:cavId — Mettre à jour un CAV de tournée
  router.put('/:tourId/cav/:cavId', async (req, res) => {
    try {
      const { status, fill_level, qr_scanned, qr_unavailable, qr_unavailable_reason, notes } = req.body;

      const result = await pool.query(
        `UPDATE tour_cav SET status = COALESCE($1, status),
         fill_level = COALESCE($2, fill_level),
         qr_scanned = COALESCE($3, qr_scanned),
         qr_unavailable = COALESCE($4, qr_unavailable),
         qr_unavailable_reason = COALESCE($5, qr_unavailable_reason),
         notes = COALESCE($6, notes),
         collected_at = CASE WHEN $1 = 'collected' THEN NOW() ELSE collected_at END
         WHERE tour_id = $7 AND cav_id = $8 RETURNING *`,
        [status, fill_level, qr_scanned, qr_unavailable, qr_unavailable_reason, notes, req.params.tourId, req.params.cavId]
      );

      if (result.rows.length === 0) return res.status(404).json({ error: 'CAV de tournée non trouvé' });

      // Socket.io broadcast
      const io = req.app.get('io');
      if (io) io.to(`tour-${req.params.tourId}`).emit('cav-status-update', result.rows[0]);

      res.json(result.rows[0]);
    } catch (err) {
      console.error('[TOURS] Erreur MAJ CAV :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // POST /api/tours/:id/weigh — Enregistrer une pesée
  router.post('/:id/weigh', [
    body('weight_kg').isFloat({ min: 0 }).withMessage('Poids requis (valeur numérique)'),
  ], validate, async (req, res) => {
    try {
      const { weight_kg, employee_id } = req.body;

      const result = await pool.query(
        'INSERT INTO tour_weights (tour_id, weight_kg, recorded_by) VALUES ($1, $2, $3) RETURNING *',
        [req.params.id, weight_kg, employee_id || null]
      );

      // Mettre à jour le total de la tournée
      await pool.query(
        'UPDATE tours SET total_weight_kg = (SELECT COALESCE(SUM(weight_kg), 0) FROM tour_weights WHERE tour_id = $1) WHERE id = $1',
        [req.params.id]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('[TOURS] Erreur pesée :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // POST /api/tours/:id/checklist — Checklist véhicule
  router.post('/:id/checklist', async (req, res) => {
    try {
      const { vehicle_id, employee_id, exterior_ok, fuel_level, km_start } = req.body;

      const result = await pool.query(
        `INSERT INTO vehicle_checklists (tour_id, vehicle_id, employee_id, exterior_ok, fuel_level, km_start)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.params.id, vehicle_id, employee_id, exterior_ok, fuel_level, km_start]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('[TOURS] Erreur checklist :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // PUT /api/tours/:id/checklist/end — Finaliser checklist (km fin)
  router.put('/:id/checklist/end', async (req, res) => {
    try {
      const { km_end } = req.body;
      const result = await pool.query(
        'UPDATE vehicle_checklists SET km_end = $1 WHERE tour_id = $2 RETURNING *',
        [km_end, req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Checklist non trouvée' });

      // Mettre à jour le km du véhicule
      if (km_end) {
        await pool.query(
          'UPDATE vehicles SET current_km = $1, updated_at = NOW() WHERE id = $2',
          [km_end, result.rows[0].vehicle_id]
        );
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error('[TOURS] Erreur fin checklist :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // POST /api/tours/:id/incidents — Signaler un incident
  router.post('/:id/incidents', upload.single('photo'), [
    body('type').notEmpty().withMessage('Type d\'incident requis'),
    body('description').notEmpty().withMessage('Description requise'),
  ], validate, async (req, res) => {
    try {
      const { cav_id, employee_id, vehicle_id, type, description } = req.body;
      const photo_path = req.file ? `/uploads/incidents/${req.file.filename}` : null;

      const result = await pool.query(
        `INSERT INTO incidents (tour_id, cav_id, employee_id, vehicle_id, type, description, photo_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [req.params.id, cav_id, employee_id, vehicle_id, type, description, photo_path]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('[TOURS] Erreur incident :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // GET /api/tours/:id/gps — Positions GPS
  router.get('/:id/gps', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM gps_positions WHERE tour_id = $1 ORDER BY recorded_at',
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      console.error('[TOURS] Erreur GPS :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  return router;
};

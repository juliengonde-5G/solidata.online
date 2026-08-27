const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const { ensurePlannedPassages } = require('./planned-passage');
const { preparerProgrammeAuDemarrage } = require('./arrets');
const { applyCompletionSideEffects } = require('./completion-effects');
const { sendPushToRoles } = require('../../services/push-notifications');
const { notifierGestionnaires } = require('./notifier');
const {
  driverVehicleIdFromToken,
  resolveDriverEmployeeId,
  SQL_TODAY_PARIS,
} = require('./driver-session');

// Upload is passed from index.js via router factory
module.exports = function createExecutionRouter(upload) {
  /**
   * Réponse de GET /my pour une session chauffeur : le périmètre est le seul
   * véhicule du lien. Même contrat de sortie que la branche superviseur (liste
   * d'entrées « tournée » et/ou « véhicule libre ») pour que le mobile ne
   * distingue pas deux formats — il affiche simplement une confirmation
   * puisqu'il n'y a jamais plus d'une entrée.
   */
  async function respondDriverScope(req, res, vehicleId) {
    const vRes = await pool.query(
      `SELECT v.id, v.registration, v.name, v.status, v.assigned_driver_id
       FROM vehicles v
       WHERE v.id = $1 AND COALESCE(v.is_archived, false) = false`,
      [vehicleId]
    );
    // Véhicule archivé/supprimé après l'émission du jeton : liste vide plutôt
    // qu'une erreur — l'écran affiche « aucun véhicule », le raccourci sera
    // reparamétré par le responsable.
    if (vRes.rows.length === 0) return res.json([]);
    const vehicle = vRes.rows[0];

    // Tournée du jour de CE véhicule (jour civil Paris, aligné sur
    // GET /vehicle/:id/today qui enchaîne juste après côté mobile).
    const tRes = await pool.query(
      `SELECT t.*, v.registration, v.name as vehicle_name,
              v.assigned_driver_id, v.status as vehicle_status,
              NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '') as driver_name,
              COALESCE(t.nb_cav, (SELECT COUNT(*)::int FROM tour_cav tc WHERE tc.tour_id = t.id)) as nb_cav,
              (SELECT COUNT(*)::int FROM tour_cav tc WHERE tc.tour_id = t.id AND tc.status = 'collected') as collected_count,
              false as is_free_vehicle
       FROM tours t
       JOIN vehicles v ON v.id = t.vehicle_id
       LEFT JOIN employees e ON e.id = t.driver_employee_id
       WHERE t.vehicle_id = $1
         AND t.date = ${SQL_TODAY_PARIS}
         AND t.status IN ('planned', 'in_progress')
       ORDER BY t.status = 'in_progress' DESC, t.id DESC`,
      [vehicleId]
    );

    if (tRes.rows.length > 0) {
      return res.json(tRes.rows.map((t) => ({ ...t, is_assigned_vehicle: true })));
    }

    // Aucune tournée planifiée : le véhicule lui-même est proposé au départ
    // (une tournée sera créée à la volée par POST /claim-vehicle). On le
    // renvoie quel que soit son `status` — le mobile affiche l'état réel et
    // bloque le départ si le véhicule est immobilisé, plutôt que de faire
    // disparaître le seul véhicule du chauffeur sans explication.
    return res.json([{
      vehicle_id: vehicle.id,
      registration: vehicle.registration,
      vehicle_name: vehicle.name,
      vehicle_type: null,
      vehicle_status: vehicle.status,
      assigned_driver_id: vehicle.assigned_driver_id,
      id: null,
      status: 'planned',
      date: null,
      driver_employee_id: null,
      driver_name: null,
      nb_cav: 0,
      collected_count: 0,
      is_free_vehicle: true,
      is_assigned_vehicle: true,
    }]);
  }

  // GET /api/tours/my — Véhicule et tournée du jour (mobile)
  //
  // Session chauffeur (raccourci « 1 URL = 1 véhicule ») : le périmètre est
  // SON véhicule, et lui seul. Le parc n'est jamais listé — l'écran de
  // sélection n'est qu'une confirmation de départ. Auparavant la route
  // renvoyait TOUTES les tournées du jour + TOUS les véhicules disponibles
  // quel que soit le lien utilisé, ce qui vidait le lien véhicule de son sens
  // (et laissait un chauffeur prendre le camion d'un autre).
  //
  // Session non-chauffeur (ADMIN/MANAGER, supervision) : comportement
  // historique inchangé — toutes les tournées du jour + véhicules libres.
  router.get('/my', async (req, res) => {
    try {
      const sessionVehicleId = driverVehicleIdFromToken(req.user);
      if (sessionVehicleId != null) {
        return respondDriverScope(req, res, sessionVehicleId);
      }

      // Récupérer l'employee_id du chauffeur connecté
      const userId = req.user.id;
      const empRes = await pool.query('SELECT id FROM employees WHERE user_id = $1', [userId]);
      const myEmployeeId = empRes.rows.length > 0 ? empRes.rows[0].id : null;

      // 1. Toutes les tournees du jour (pas de filtre par chauffeur)
      const toursResult = await pool.query(`
        SELECT t.*, v.registration, v.name as vehicle_name,
         v.assigned_driver_id,
         NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '') as driver_name,
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
  // Cree une tournee a la volee pour ce vehicule.
  //
  // L'identité de la session mobile est le VÉHICULE (« 1 URL = 1 véhicule ») :
  // le chauffeur est une information de rattachement, pas une condition d'accès.
  // La route exigeait auparavant une fiche employé liée au compte utilisateur —
  // or les fiches salariés viennent de la paie et n'ont pas de compte : tout
  // départ en tournée échouait sur « Aucune fiche employé liée à votre compte ».
  router.post('/claim-vehicle', [
    body('vehicle_id').isInt().withMessage('ID véhicule requis'),
  ], validate, async (req, res) => {
    try {
      const vehicleId = parseInt(req.body.vehicle_id, 10);

      // Périmètre : une session chauffeur ne prend que SON véhicule.
      const sessionVehicleId = driverVehicleIdFromToken(req.user);
      if (sessionVehicleId != null && sessionVehicleId !== vehicleId) {
        return res.status(403).json({ error: 'Ce véhicule ne correspond pas à votre session chauffeur' });
      }

      // Chauffeur rattaché à la tournée : jeton → compte → affectation du
      // véhicule → null (tournée portée par le véhicule seul).
      const employeeId = await resolveDriverEmployeeId(pool, req.user, vehicleId);

      // Verifier que le vehicule n'est pas deja en tournee
      const existing = await pool.query(
        `SELECT id FROM tours WHERE vehicle_id = $1 AND date = ${SQL_TODAY_PARIS} AND status IN ('planned', 'in_progress')`,
        [vehicleId]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Ce vehicule est deja en tournee aujourd\'hui' });
      }

      // Creer une tournee a la volee. `is_demo` est HÉRITÉ du véhicule : c'est
      // le lien « 1 URL = 1 véhicule » qui décide si l'on est en formation, et
      // le chauffeur n'a donc rien à activer (ni à pouvoir désactiver).
      const result = await pool.query(
        `INSERT INTO tours (vehicle_id, driver_employee_id, date, status, started_at, is_demo, created_at, updated_at)
         SELECT $1, $2, ${SQL_TODAY_PARIS}, 'in_progress', NOW(), COALESCE(v.is_demo, false), NOW(), NOW()
           FROM vehicles v WHERE v.id = $1
         RETURNING *`,
        [vehicleId, employeeId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Véhicule introuvable' });
      }

      // Best-effort : calcul OSRM si la tournée est ensuite alimentée avec des CAV
      ensurePlannedPassages(result.rows[0].id).catch(() => {});

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
      const tourId = parseInt(req.params.id, 10);
      if (!Number.isInteger(tourId)) {
        return res.status(400).json({ error: 'Tournée introuvable' });
      }

      const tourRes = await pool.query('SELECT vehicle_id FROM tours WHERE id = $1', [tourId]);
      if (tourRes.rows.length === 0) {
        return res.status(404).json({ error: 'Tournée introuvable' });
      }
      const tourVehicleId = tourRes.rows[0].vehicle_id;

      // Périmètre : une session chauffeur ne prend que les tournées de SON
      // véhicule (mêmes règles que la garde des routes mobiles « -public »).
      const sessionVehicleId = driverVehicleIdFromToken(req.user);
      if (sessionVehicleId != null && tourVehicleId != null && Number(tourVehicleId) !== sessionVehicleId) {
        return res.status(403).json({ error: 'Cette tournée ne correspond pas à votre véhicule' });
      }

      // Chauffeur rattaché à la tournée (cascade honnête, null accepté — voir
      // driver-session.js). L'accès est porté par le lien véhicule, pas par
      // l'existence d'une fiche employé liée au compte.
      const employeeId = await resolveDriverEmployeeId(pool, req.user, tourVehicleId);

      // Assigner le chauffeur et passer en in_progress atomiquement
      // Seule une tournee planned peut etre claimee (empeche double claim).
      // COALESCE : un chauffeur déjà planifié par le manager n'est pas effacé
      // par une session véhicule qui ne sait pas qui conduit.
      // started_at posé ici : le parcours mobile réel est claim → checklist →
      // start-public, et start-public ne matche plus une tournée déjà passée
      // in_progress — sans cet horodatage, elapsed_min/duration_minutes et le
      // KPI de durée moyenne restaient définitivement NULL sur ce chemin.
      const result = await pool.query(
        `UPDATE tours SET driver_employee_id = COALESCE($1, driver_employee_id),
                          status = 'in_progress',
                          started_at = COALESCE(started_at, NOW()),
                          updated_at = NOW()
         WHERE id = $2 AND status = 'planned'
         RETURNING *`,
        [employeeId, tourId]
      );

      if (result.rows.length === 0) {
        return res.status(409).json({ error: 'Ce véhicule a déjà été pris par un autre chauffeur' });
      }

      // Best-effort : calcul des horaires prévisionnels dès le claim (tournée passe in_progress)
      ensurePlannedPassages(req.params.id).catch(err =>
        console.warn('[TOURS] planned-passage (claim) échec :', err.message));
      // La prise du véhicule est la PREMIÈRE bascule du parcours mobile : c'est
      // ici que le programme doit être complet, avant même la check-list.
      await preparerProgrammeAuDemarrage(pool, req.params.id);

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

      // COALESCE : une reprise (paused → in_progress) ne doit pas écraser
      // l'heure de départ réelle de la tournée.
      if (status === 'in_progress') updates.push('started_at = COALESCE(started_at, NOW())');
      if (status === 'completed') updates.push('completed_at = NOW()');

      // Auto-assigner le chauffeur connecté si pas encore assigné. Même cascade
      // que les prises de tournée : jeton chauffeur → compte utilisateur →
      // chauffeur affecté au véhicule. Sans chauffeur identifiable, la tournée
      // reste rattachée au véhicule seul (aucun rattachement inventé).
      if (status === 'in_progress' && req.user) {
        const vehRes = await pool.query('SELECT vehicle_id FROM tours WHERE id = $1', [req.params.id]);
        const tourVehicleId = vehRes.rows.length > 0 ? vehRes.rows[0].vehicle_id : null;
        const autoEmployeeId = await resolveDriverEmployeeId(pool, req.user, tourVehicleId);
        if (autoEmployeeId != null) {
          params.push(autoEmployeeId);
          updates.push(`driver_employee_id = COALESCE(driver_employee_id, $${params.length})`);
        }
      }

      params.push(req.params.id);
      // Idempotence de la clôture : une tournée déjà 'completed' ne doit pas ré-exécuter
      // les effets de bord (stock, tonnage, feedback d'apprentissage). Un double clic sur
      // « Terminer » (ou un rejeu) ne met alors à jour aucune ligne → on répond sans dupliquer.
      let whereClause = `id = $${params.length}`;
      if (status === 'completed') whereClause += " AND status <> 'completed'";
      const result = await pool.query(
        `UPDATE tours SET ${updates.join(', ')} WHERE ${whereClause} RETURNING *`,
        params
      );

      if (result.rows.length === 0) {
        // Sur une clôture, 0 ligne = tournée déjà terminée (no-op idempotent) ou inexistante.
        if (status === 'completed') {
          const existing = await pool.query('SELECT * FROM tours WHERE id = $1', [req.params.id]);
          if (existing.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });
          return res.json(existing.rows[0]); // déjà terminée : succès sans effets de bord
        }
        return res.status(404).json({ error: 'Tournée non trouvée' });
      }

      // Actions post-tournée si terminé — effets factorisés dans
      // completion-effects.js (partagés avec la route mobile status-public).
      if (status === 'completed' || status === 'cancelled') {
        const tour = result.rows[0];
        if (status === 'completed') {
          await applyCompletionSideEffects(tour, parseInt(req.params.id, 10), req.user.id);
        }
      } else if (status === 'in_progress') {
        const tour = result.rows[0];
        await pool.query("UPDATE vehicles SET status = 'in_use' WHERE id = $1", [tour.vehicle_id]);
        // Calcul OSRM des horaires prévisionnels (non bloquant, best-effort)
        ensurePlannedPassages(req.params.id).catch(err =>
          console.warn('[TOURS] planned-passage (status) échec :', err.message));
        await preparerProgrammeAuDemarrage(pool, req.params.id);
      }

      // Émettre l'événement Socket.io
      const io = req.app.get('io');
      if (io) io.to(`tour-${req.params.id}`).emit('tour-status-update', { tourId: req.params.id, status });

      // Push notification aux managers sur clôture ou annulation
      if (status === 'completed' || status === 'cancelled') {
        const tour = result.rows[0];
        const label = status === 'completed' ? 'terminée' : 'annulée';
        const detail = tour.total_weight_kg
          ? `Poids total : ${Math.round(tour.total_weight_kg)} kg`
          : 'Voir le détail de la tournée';
        sendPushToRoles(['ADMIN', 'MANAGER'], {
          title: `Tournée #${req.params.id} ${label}`,
          body: detail,
          tag: `tour-${req.params.id}-${status}`,
          data: { url: '/collections-live', tourId: parseInt(req.params.id, 10) },
        }).catch(() => {});
        // Doublage dans la messagerie interne (correctif du 27/08) : la fin de
        // tournée y manquait alors que les incidents et les anomalies de
        // checklist y arrivaient déjà. Un gestionnaire qui prend la messagerie
        // pour son canal de notifications ne voyait pas passer la clôture.
        notifierGestionnaires({
          texte: `Tournée #${req.params.id} ${label} — ${detail}`,
          source: 'tournee',
          lien: '/collections-live',
        });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error('[TOURS] Erreur changement statut :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  // PUT /api/tours/:tourId/cav/:cavId — Mettre à jour un CAV de tournée
  router.put('/:tourId/cav/:cavId', async (req, res) => {
    try {
      const { status, fill_level, qr_scanned, qr_unavailable, qr_unavailable_reason, notes, skip_reason } = req.body;
      const VALID_SKIP = ['cav_fermee', 'bouchee', 'acces_impossible', 'proprietaire_absent', 'vide', 'autre'];
      if (skip_reason && !VALID_SKIP.includes(skip_reason)) {
        return res.status(400).json({ error: 'skip_reason invalide', allowed: VALID_SKIP });
      }

      // $1::varchar : sans cast, PostgreSQL 16 déduit des types incompatibles
      // pour $1 (COALESCE avec varchar vs CASE avec text) → 42P08 (même défaut
      // que collect-public, corrigé au même moment).
      const result = await pool.query(
        `UPDATE tour_cav SET status = COALESCE($1::varchar, status),
         fill_level = COALESCE($2, fill_level),
         qr_scanned = COALESCE($3, qr_scanned),
         qr_unavailable = COALESCE($4, qr_unavailable),
         qr_unavailable_reason = COALESCE($5, qr_unavailable_reason),
         notes = COALESCE($6, notes),
         skip_reason = CASE WHEN $1::varchar = 'skipped' THEN COALESCE($7, skip_reason)
                            WHEN $1::varchar IS NOT NULL AND $1::varchar <> 'skipped' THEN NULL
                            ELSE skip_reason END,
         collected_at = CASE WHEN $1::varchar = 'collected' THEN NOW() ELSE collected_at END
         WHERE tour_id = $8 AND cav_id = $9 RETURNING *`,
        [status, fill_level, qr_scanned, qr_unavailable, qr_unavailable_reason, notes, skip_reason, req.params.tourId, req.params.cavId]
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

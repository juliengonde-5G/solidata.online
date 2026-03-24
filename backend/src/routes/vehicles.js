const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

// Auto-create vehicle_maintenance tables
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicle_maintenance (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        vehicle_type VARCHAR(50) NOT NULL DEFAULT 'generic',
        last_maintenance_date DATE,
        last_maintenance_km INTEGER,
        maintenance_interval_km INTEGER DEFAULT 20000,
        maintenance_interval_months INTEGER DEFAULT 12,
        controle_technique_date DATE,
        oil_change_km INTEGER, oil_change_date DATE,
        tire_change_km INTEGER, tire_change_date DATE,
        brake_check_km INTEGER, brake_check_date DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(vehicle_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicle_maintenance_alerts (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        alert_date DATE NOT NULL DEFAULT CURRENT_DATE,
        alerts JSONB NOT NULL DEFAULT '[]',
        is_resolved BOOLEAN DEFAULT false,
        resolved_by INTEGER REFERENCES users(id),
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(vehicle_id, alert_date)
      )
    `);
    console.log('[VEHICLES] Tables maintenance OK');
  } catch (err) {
    console.error('[VEHICLES] Migration maintenance :', err.message);
  }
})();

router.use(authenticate);
router.use(autoLogActivity('vehicle'));

// GET /api/vehicles
router.get('/', async (req, res) => {
  try {
    const { status, team_id } = req.query;
    let query = 'SELECT v.*, t.name as team_name FROM vehicles v LEFT JOIN teams t ON v.team_id = t.id WHERE 1=1';
    const params = [];

    if (status) { params.push(status); query += ` AND v.status = $${params.length}`; }
    if (team_id) { params.push(team_id); query += ` AND v.team_id = $${params.length}`; }

    query += ' ORDER BY v.name';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[VEHICLES] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/vehicles/available — Véhicules disponibles
router.get('/available', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, registration, name, max_capacity_kg, team_id, status, current_km FROM vehicles WHERE status = 'available' ORDER BY name"
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[VEHICLES] Erreur available :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/vehicles/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT v.*, t.name as team_name FROM vehicles v LEFT JOIN teams t ON v.team_id = t.id WHERE v.id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Véhicule non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[VEHICLES] Erreur détail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/vehicles
router.post('/', authorize('ADMIN', 'MANAGER'), [
  body('registration').notEmpty().withMessage('Immatriculation requise'),
], validate, async (req, res) => {
  try {
    const { registration, name, brand, model, type, max_capacity_kg, tare_weight_kg, team_id, current_km, next_maintenance, insurance_expiry } = req.body;

    const result = await pool.query(
      `INSERT INTO vehicles (registration, name, brand, model, type, max_capacity_kg, tare_weight_kg, team_id, current_km, next_maintenance, insurance_expiry)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [registration.toUpperCase(), name, brand, model, type || 'utilitaire', max_capacity_kg || 3500, tare_weight_kg, team_id, current_km || 0, next_maintenance || null, insurance_expiry || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Immatriculation déjà existante' });
    console.error('[VEHICLES] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/vehicles/:id
router.put('/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { name, brand, model, type, max_capacity_kg, tare_weight_kg, team_id, status, current_km, next_maintenance, insurance_expiry } = req.body;
    const result = await pool.query(
      `UPDATE vehicles SET
       name = COALESCE($1, name), brand = COALESCE($2, brand), model = COALESCE($3, model),
       type = COALESCE($4, type), max_capacity_kg = COALESCE($5, max_capacity_kg),
       tare_weight_kg = COALESCE($6, tare_weight_kg), team_id = COALESCE($7, team_id),
       status = COALESCE($8, status), current_km = COALESCE($9, current_km),
       next_maintenance = $10, insurance_expiry = $11, updated_at = NOW()
       WHERE id = $12 RETURNING *`,
      [name, brand, model, type, max_capacity_kg, tare_weight_kg, team_id, status, current_km, next_maintenance || null, insurance_expiry || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Véhicule non trouvé' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[VEHICLES] Erreur modification :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/vehicles/:id
router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE vehicles SET status = 'out_of_service', updated_at = NOW() WHERE id = $1 RETURNING id",
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Véhicule non trouvé' });
    res.json({ message: 'Véhicule mis hors service' });
  } catch (err) {
    console.error('[VEHICLES] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// MAINTENANCE PRÉVENTIVE
// ══════════════════════════════════════════

// Intervalles par type de véhicule (km / mois)
const MAINTENANCE_PROFILES = {
  'FIAT Ducato L3H2': {
    revision_km: 30000, revision_months: 24,
    vidange_km: 30000, vidange_months: 24,
    pneus_km: 50000, freins_km: 40000,
    controle_technique_months: 24,
    operations: [
      { label: 'Vidange moteur + filtre', intervalle_km: 30000 },
      { label: 'Filtre à air', intervalle_km: 60000 },
      { label: 'Filtre habitacle', intervalle_km: 30000 },
      { label: 'Courroie de distribution', intervalle_km: 120000 },
      { label: 'Liquide de frein', intervalle_km: 60000 },
      { label: 'Plaquettes de frein', intervalle_km: 40000 },
      { label: 'Pneumatiques', intervalle_km: 50000 },
    ],
  },
  'Renault Master eTech': {
    revision_km: 30000, revision_months: 24,
    vidange_km: 0, vidange_months: 0, // Pas de vidange moteur (électrique)
    pneus_km: 40000, freins_km: 80000, // Freins regen = usure réduite
    controle_technique_months: 24,
    operations: [
      { label: 'Contrôle batterie haute tension', intervalle_km: 30000 },
      { label: 'Liquide de refroidissement batterie', intervalle_km: 60000 },
      { label: 'Filtre habitacle', intervalle_km: 30000 },
      { label: 'Liquide de frein', intervalle_km: 60000 },
      { label: 'Plaquettes de frein', intervalle_km: 80000 },
      { label: 'Pneumatiques', intervalle_km: 40000 },
      { label: 'Contrôle système de charge', intervalle_km: 30000 },
    ],
  },
};

// GET /api/vehicles/maintenance/profiles — Profils de maintenance disponibles
router.get('/maintenance/profiles', (req, res) => {
  res.json(MAINTENANCE_PROFILES);
});

// GET /api/vehicles/maintenance/overview — Vue d'ensemble maintenance flotte
router.get('/maintenance/overview', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.id, v.name, v.registration, v.current_km, v.status,
        vm.vehicle_type, vm.last_maintenance_date, vm.last_maintenance_km,
        vm.maintenance_interval_km, vm.maintenance_interval_months,
        vm.controle_technique_date, vm.oil_change_km, vm.oil_change_date,
        vm.tire_change_km, vm.brake_check_km,
        (SELECT COUNT(*) FROM vehicle_maintenance_alerts vma
         WHERE vma.vehicle_id = v.id AND vma.is_resolved = false) as nb_alertes
      FROM vehicles v
      LEFT JOIN vehicle_maintenance vm ON vm.vehicle_id = v.id
      WHERE v.status != 'out_of_service'
      ORDER BY v.name
    `);

    const today = new Date();
    const vehicles = result.rows.map(v => {
      const alerts = [];

      // Alerte km
      if (v.maintenance_interval_km && v.last_maintenance_km) {
        const kmSince = (v.current_km || 0) - v.last_maintenance_km;
        const ratio = kmSince / v.maintenance_interval_km;
        if (ratio >= 0.9) alerts.push({ type: 'revision_km', message: `Révision: ${kmSince}/${v.maintenance_interval_km} km`, urgency: ratio >= 1 ? 'critique' : 'attention' });
      }

      // Alerte date
      if (v.maintenance_interval_months && v.last_maintenance_date) {
        const nextDate = new Date(v.last_maintenance_date);
        nextDate.setMonth(nextDate.getMonth() + v.maintenance_interval_months);
        const daysUntil = Math.round((nextDate - today) / 86400000);
        if (daysUntil <= 30) alerts.push({ type: 'revision_date', message: `Révision: dans ${daysUntil} jours`, urgency: daysUntil <= 0 ? 'critique' : 'attention' });
      }

      // Contrôle technique
      if (v.controle_technique_date) {
        const daysUntil = Math.round((new Date(v.controle_technique_date) - today) / 86400000);
        if (daysUntil <= 60) alerts.push({ type: 'ct', message: `CT: dans ${daysUntil} jours`, urgency: daysUntil <= 30 ? 'critique' : 'attention' });
      }

      return { ...v, computed_alerts: alerts };
    });

    res.json(vehicles);
  } catch (err) {
    console.error('[VEHICLES] Erreur maintenance overview :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/vehicles/:id/maintenance — Détail maintenance d'un véhicule
router.get('/:id/maintenance', async (req, res) => {
  try {
    const maint = await pool.query('SELECT id, vehicle_id, vehicle_type, last_maintenance_date, last_maintenance_km, maintenance_interval_km, maintenance_interval_months, controle_technique_date, oil_change_km, oil_change_date, tire_change_km, tire_change_date, brake_check_km, brake_check_date, notes FROM vehicle_maintenance WHERE vehicle_id = $1', [req.params.id]);
    const alerts = await pool.query(
      'SELECT * FROM vehicle_maintenance_alerts WHERE vehicle_id = $1 ORDER BY alert_date DESC LIMIT 20',
      [req.params.id]
    );
    res.json({
      maintenance: maint.rows[0] || null,
      alerts: alerts.rows,
      profiles: MAINTENANCE_PROFILES,
    });
  } catch (err) {
    console.error('[VEHICLES] Erreur maintenance detail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/vehicles/:id/maintenance — Configurer/mettre à jour la maintenance
router.put('/:id/maintenance', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const d = req.body;
    const result = await pool.query(
      `INSERT INTO vehicle_maintenance (vehicle_id, vehicle_type, last_maintenance_date, last_maintenance_km,
        maintenance_interval_km, maintenance_interval_months, controle_technique_date,
        oil_change_km, oil_change_date, tire_change_km, tire_change_date,
        brake_check_km, brake_check_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (vehicle_id) DO UPDATE SET
        vehicle_type = COALESCE($2, vehicle_maintenance.vehicle_type),
        last_maintenance_date = COALESCE($3, vehicle_maintenance.last_maintenance_date),
        last_maintenance_km = COALESCE($4, vehicle_maintenance.last_maintenance_km),
        maintenance_interval_km = COALESCE($5, vehicle_maintenance.maintenance_interval_km),
        maintenance_interval_months = COALESCE($6, vehicle_maintenance.maintenance_interval_months),
        controle_technique_date = COALESCE($7, vehicle_maintenance.controle_technique_date),
        oil_change_km = COALESCE($8, vehicle_maintenance.oil_change_km),
        oil_change_date = COALESCE($9, vehicle_maintenance.oil_change_date),
        tire_change_km = COALESCE($10, vehicle_maintenance.tire_change_km),
        tire_change_date = COALESCE($11, vehicle_maintenance.tire_change_date),
        brake_check_km = COALESCE($12, vehicle_maintenance.brake_check_km),
        brake_check_date = COALESCE($13, vehicle_maintenance.brake_check_date),
        notes = COALESCE($14, vehicle_maintenance.notes),
        updated_at = NOW()
       RETURNING *`,
      [
        req.params.id, d.vehicle_type, d.last_maintenance_date, d.last_maintenance_km,
        d.maintenance_interval_km, d.maintenance_interval_months, d.controle_technique_date,
        d.oil_change_km, d.oil_change_date, d.tire_change_km, d.tire_change_date,
        d.brake_check_km, d.brake_check_date, d.notes,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[VEHICLES] Erreur maintenance PUT :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/vehicles/:id/maintenance/resolve-alert — Résoudre une alerte
router.post('/:id/maintenance/resolve-alert', authorize('ADMIN', 'MANAGER'), [
  body('alert_id').isInt().withMessage('ID alerte requis'),
], validate, async (req, res) => {
  try {
    const { alert_id } = req.body;
    const result = await pool.query(
      `UPDATE vehicle_maintenance_alerts SET is_resolved = true, resolved_by = $1, resolved_at = NOW()
       WHERE id = $2 AND vehicle_id = $3 RETURNING *`,
      [req.user.id, alert_id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Alerte non trouvée' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[VEHICLES] Erreur resolve alert :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// ÉVÉNEMENTS / HISTORIQUE VÉHICULE
// ══════════════════════════════════════════

// GET /api/vehicles/:id/events — Historique des événements d'un véhicule
router.get('/:id/events', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ve.*, u.first_name || ' ' || u.last_name as created_by_name
       FROM vehicle_events ve
       LEFT JOIN users u ON ve.created_by = u.id
       WHERE ve.vehicle_id = $1
       ORDER BY ve.event_date DESC, ve.created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[VEHICLES] Erreur events GET :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/vehicles/:id/events — Ajouter un événement
router.post('/:id/events', authorize('ADMIN', 'MANAGER'), [
  body('event_type').notEmpty().withMessage('Type requis'),
  body('event_date').notEmpty().withMessage('Date requise'),
], validate, async (req, res) => {
  try {
    const { event_type, event_date, km_at_event, description, cost, performed_by } = req.body;
    const result = await pool.query(
      `INSERT INTO vehicle_events (vehicle_id, event_type, event_date, km_at_event, description, cost, performed_by, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.params.id, event_type, event_date, km_at_event, description, cost, performed_by, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[VEHICLES] Erreur events POST :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/vehicles/:id/events/:eventId — Supprimer un événement
router.delete('/:id/events/:eventId', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM vehicle_events WHERE id = $1 AND vehicle_id = $2 RETURNING id',
      [req.params.eventId, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Événement non trouvé' });
    res.json({ message: 'Événement supprimé' });
  } catch (err) {
    console.error('[VEHICLES] Erreur events DELETE :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/vehicles/maintenance/schedule/:id — Grille d'entretien constructeur
router.get('/maintenance/schedule/:id', async (req, res) => {
  try {
    const vehicle = await pool.query('SELECT v.*, vm.vehicle_type FROM vehicles v LEFT JOIN vehicle_maintenance vm ON vm.vehicle_id = v.id WHERE v.id = $1', [req.params.id]);
    if (vehicle.rows.length === 0) return res.status(404).json({ error: 'Véhicule non trouvé' });

    const v = vehicle.rows[0];
    const profile = MAINTENANCE_PROFILES[v.vehicle_type] || null;
    const currentKm = v.current_km || 0;

    // Charger les événements d'entretien pour calculer l'état de chaque opération
    const events = await pool.query(
      `SELECT event_type, event_date, km_at_event, description FROM vehicle_events
       WHERE vehicle_id = $1 ORDER BY event_date DESC`,
      [req.params.id]
    );

    let schedule = [];
    if (profile && profile.operations) {
      schedule = profile.operations.map(op => {
        // Chercher le dernier événement correspondant à cette opération
        const lastEvent = events.rows.find(e =>
          e.description && e.description.toLowerCase().includes(op.label.toLowerCase().split(' ')[0])
        );
        const lastKm = lastEvent ? lastEvent.km_at_event : 0;
        const lastDate = lastEvent ? lastEvent.event_date : null;
        const kmSince = currentKm - (lastKm || 0);
        const ratio = op.intervalle_km > 0 ? kmSince / op.intervalle_km : 0;
        let status = 'ok';
        if (ratio >= 1) status = 'depasse';
        else if (ratio >= 0.85) status = 'bientot';

        return {
          label: op.label,
          intervalle_km: op.intervalle_km,
          last_km: lastKm,
          last_date: lastDate,
          km_since: kmSince,
          ratio: Math.round(ratio * 100),
          status,
        };
      });
    }

    res.json({ vehicle: v, profile_name: v.vehicle_type, profile, schedule });
  } catch (err) {
    console.error('[VEHICLES] Erreur schedule :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

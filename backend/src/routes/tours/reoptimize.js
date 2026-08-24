// ══════════════════════════════════════════════════════════════
// Router de ré-optimisation (Niveau 2.6)
// ══════════════════════════════════════════════════════════════
// Les calculs sont délégués au service reoptimize-service.

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../../middleware/validate');
const {
  proposeReoptimization,
  applyReoptimization,
  rejectReoptimization,
} = require('./reoptimize-service');

// GET /api/tours/reoptimizations/pending — Propositions en attente du jour
// ─────────────────────────────────────────────────────────────────────────
// Sans cet endpoint, les propositions produites par le recalcul récurrent
// n'atteignaient personne : elles partaient dans la salle Socket.IO du
// chauffeur et dans une notification, mais l'écran « Collecte en direct » ne
// les listait pas. Le gestionnaire décide, il faut donc qu'il les voie.
router.get('/reoptimizations/pending', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const date = req.query.date || null;
    const result = await pool.query(
      `SELECT r.*, t.vehicle_id, v.registration, v.name AS vehicle_name,
              NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '') AS driver_name
         FROM tour_reoptimizations r
         JOIN tours t ON t.id = r.tour_id
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
         LEFT JOIN employees e ON e.id = t.driver_employee_id
        WHERE r.status = 'pending'
          AND t.is_demo IS NOT TRUE
          AND t.date = COALESCE($1::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date)
        ORDER BY r.triggered_at DESC`,
      [date]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[TOURS] Erreur reoptimizations/pending :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/:id/reoptimizations — Historique (20 dernières) + pending
router.get('/:id/reoptimizations', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM tour_reoptimizations
         WHERE tour_id = $1
         ORDER BY triggered_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[TOURS] Erreur reoptimizations list :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/reoptimize — Déclencher (manager)
router.post('/:id/reoptimize',
  authorize('ADMIN', 'MANAGER'),
  [
    body('current_lat').optional().isFloat(),
    body('current_lng').optional().isFloat(),
    body('reason').optional().isString(),
  ],
  validate,
  async (req, res) => {
    try {
      const io = req.app.get('io');
      const result = await proposeReoptimization({
        tourId: parseInt(req.params.id, 10),
        triggerReason: req.body.reason || 'manual',
        triggeredBy: 'manager',
        currentLat: req.body.current_lat,
        currentLng: req.body.current_lng,
        io,
      });
      res.json(result);
    } catch (err) {
      console.error('[TOURS] Erreur reoptimize :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// POST /api/tours/:id/reoptimize/:reoptId/accept — Accepter (manager)
router.post('/:id/reoptimize/:reoptId/accept',
  authorize('ADMIN', 'MANAGER'),
  async (req, res) => {
    try {
      const result = await applyReoptimization(parseInt(req.params.reoptId, 10), req.user?.id);
      if (result.error) return res.status(400).json(result);
      const io = req.app.get('io');
      if (io) io.to(`tour-${result.tour_id}`).emit('reoptimization-accepted', {
        reoptId: parseInt(req.params.reoptId, 10), tour_id: result.tour_id,
      });
      res.json(result);
    } catch (err) {
      console.error('[TOURS] Erreur accept reoptimize :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// POST /api/tours/:id/reoptimize/:reoptId/reject — Refuser (manager)
router.post('/:id/reoptimize/:reoptId/reject',
  authorize('ADMIN', 'MANAGER'),
  async (req, res) => {
    try {
      const result = await rejectReoptimization(parseInt(req.params.reoptId, 10), req.user?.id);
      if (result.error) return res.status(400).json(result);
      const io = req.app.get('io');
      if (io) io.to(`tour-${result.tour_id}`).emit('reoptimization-rejected', {
        reoptId: parseInt(req.params.reoptId, 10), tour_id: result.tour_id,
      });
      res.json(result);
    } catch (err) {
      console.error('[TOURS] Erreur reject reoptimize :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

module.exports = router;

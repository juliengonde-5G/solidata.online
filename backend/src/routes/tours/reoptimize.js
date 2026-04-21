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

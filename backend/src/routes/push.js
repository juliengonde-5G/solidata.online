// ══════════════════════════════════════════════════════════════
// Routes d'abonnement push (Web Push API + VAPID) — Niveau 2.2
// ══════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  isConfigured,
  getPublicKey,
  sendPushToUser,
} = require('../services/push-notifications');

// GET /api/push/vapid-public-key — Clé VAPID publique (public, nécessaire
// côté client avant de souscrire).
router.get('/vapid-public-key', (req, res) => {
  res.json({
    configured: isConfigured(),
    publicKey: getPublicKey(),
  });
});

// Toutes les routes ci-dessous nécessitent une authentification
router.use(authenticate);

// POST /api/push/subscribe — Enregistrer un abonnement
router.post('/subscribe',
  [
    body('endpoint').notEmpty().withMessage('endpoint requis'),
    body('keys.p256dh').notEmpty().withMessage('keys.p256dh requis'),
    body('keys.auth').notEmpty().withMessage('keys.auth requis'),
  ],
  validate,
  async (req, res) => {
    try {
      const { endpoint, keys, platform } = req.body;
      const userAgent = req.get('user-agent') || null;
      const result = await pool.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, platform)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (endpoint) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           platform = EXCLUDED.platform,
           last_used_at = NOW()
         RETURNING id`,
        [req.user.id, endpoint, keys.p256dh, keys.auth, userAgent, platform || 'web']
      );
      res.json({ ok: true, id: result.rows[0].id });
    } catch (err) {
      console.error('[PUSH] subscribe error:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// POST /api/push/unsubscribe — Désabonner un endpoint
router.post('/unsubscribe',
  [body('endpoint').notEmpty()],
  validate,
  async (req, res) => {
    try {
      await pool.query(
        'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
        [req.body.endpoint, req.user.id]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error('[PUSH] unsubscribe error:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// POST /api/push/test — Envoyer une notification test (ADMIN / MANAGER)
router.post('/test',
  authorize('ADMIN', 'MANAGER'),
  async (req, res) => {
    try {
      const results = await sendPushToUser(req.user.id, {
        title: 'SOLIDATA — Test',
        body: 'Les notifications push fonctionnent.',
        tag: 'push-test',
        data: { url: '/' },
      });
      res.json({ ok: true, results });
    } catch (err) {
      console.error('[PUSH] test error:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

module.exports = router;

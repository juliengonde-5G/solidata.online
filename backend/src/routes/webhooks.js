const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const logger = require('../config/logger');
const { processUplink } = require('../services/liveobjects-processor');

/**
 * Webhooks entrants (machine-to-machine). PAS derrière le middleware `authenticate` (JWT utilisateur).
 * L'authentification se fait via un secret partagé passé dans le header `X-Webhook-Secret`.
 * Configuré dans Orange Live Objects côté "HTTP Push connector".
 */

function requireWebhookSecret(req, res, next) {
  const expected = process.env.LIVEOBJECTS_WEBHOOK_SECRET;
  if (!expected) {
    logger.error('LIVEOBJECTS_WEBHOOK_SECRET non configuré — webhook refuse toutes les requêtes');
    return res.status(503).json({ error: 'Webhook non configuré côté serveur' });
  }
  const provided = req.header('X-Webhook-Secret') || '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    logger.warn('Webhook LiveObjects : secret invalide', {
      ip: req.ip,
      providedLength: a.length,
    });
    return res.status(401).json({ error: 'Secret invalide' });
  }
  next();
}

/**
 * POST /api/webhooks/liveobjects/uplink
 * Reçoit un `dataMessage` Orange Live Objects (format LoRaWAN) OU un payload
 * déjà aplati {sensor_reference, fill_level_percent, ...} pour simuler.
 */
router.post('/liveobjects/uplink', requireWebhookSecret, async (req, res) => {
  try {
    const io = req.app.get('io');
    const result = await processUplink(req.body, io);
    if (!result) return res.status(400).json({ error: 'Uplink non reconnu' });
    if (result.error === 'cav_not_found') {
      return res.status(404).json({ error: 'CAV introuvable pour ce devEUI / sensor_reference' });
    }
    if (result.error === 'fill_not_computable') {
      return res.status(400).json({
        error: 'Calcul fill_level impossible (distance absente ou sensor_height_cm non calibré)',
        cav_id: result.cav_id,
      });
    }
    res.json(result);
  } catch (err) {
    logger.error('Webhook LiveObjects : erreur de traitement', { error: err.message });
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * GET /api/webhooks/liveobjects/health — endpoint de health check (sans secret)
 * pour permettre à Live Objects de tester la connectivité à la création du connector.
 */
router.get('/liveobjects/health', (req, res) => {
  res.json({ status: 'ok', service: 'liveobjects-webhook' });
});

module.exports = router;

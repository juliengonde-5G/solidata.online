// ══════════════════════════════════════════════════════════════════════════
// GÉOCODAGE — une adresse en coordonnées GPS
// ══════════════════════════════════════════════════════════════════════════
// Sert les formulaires de saisie de lieux : conteneurs, points association,
// lieux d'arrêt technique. On tape une adresse, on récupère la position.
//
// Lecture seule, réservée aux profils qui saisissent des référentiels.

const express = require('express');
const router = express.Router();
const { authorize } = require('../middleware/auth');
const { chercherAdresse } = require('../services/geocodage');

const CENTRE_TRI_LAT = parseFloat(process.env.CENTRE_TRI_LAT) || 49.4231;
const CENTRE_TRI_LNG = parseFloat(process.env.CENTRE_TRI_LNG) || 1.0993;

// GET /api/geocodage/adresse?q=...
router.get('/adresse', authorize('ADMIN', 'MANAGER', 'RH', 'QHSE'), async (req, res) => {
  try {
    res.json(await chercherAdresse(req.query.q, {
      // Biais vers le territoire de collecte : « rue de la République » est
      // ambigu partout en France, pas autour du centre de tri.
      autour: { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG },
    }));
  } catch (err) {
    console.error('[GÉOCODAGE] Erreur recherche :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

// ══════════════════════════════════════════════════════════════════════════
// GÉOCODAGE — adresse ↔ coordonnées (référentiels de lieux)
// ══════════════════════════════════════════════════════════════════════════
// Sert les formulaires de saisie de lieux : conteneurs, points association,
// lieux d'arrêt technique. Saisir une adresse et obtenir les coordonnées, ou
// l'inverse — au lieu d'aller chercher une latitude sur un autre site.
//
// Lecture seule, réservée aux profils qui saisissent des référentiels.

const express = require('express');
const router = express.Router();
const { authorize } = require('../middleware/auth');
const { chercherAdresse, adresseDepuisCoordonnees } = require('../services/geocodage');

const CENTRE_TRI_LAT = parseFloat(process.env.CENTRE_TRI_LAT) || 49.4231;
const CENTRE_TRI_LNG = parseFloat(process.env.CENTRE_TRI_LNG) || 1.0993;

/** Clé TomTom (repli), lue via le service trafic — source unique. */
async function cleTomtom() {
  try {
    return await require('../services/traffic').getApiKey();
  } catch (_) { return null; }
}

// GET /api/geocodage/adresse?q=...
router.get('/adresse', authorize('ADMIN', 'MANAGER', 'RH', 'QHSE'), async (req, res) => {
  try {
    res.json(await chercherAdresse(req.query.q, {
      cleTomtom: await cleTomtom(),
      // Biais vers le territoire de collecte : « rue de la République » est
      // ambigu partout en France, pas autour du centre de tri.
      autour: { lat: CENTRE_TRI_LAT, lng: CENTRE_TRI_LNG },
    }));
  } catch (err) {
    console.error('[GÉOCODAGE] Erreur recherche :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/geocodage/inverse?lat=&lng=
router.get('/inverse', authorize('ADMIN', 'MANAGER', 'RH', 'QHSE'), async (req, res) => {
  try {
    res.json(await adresseDepuisCoordonnees(req.query.lat, req.query.lng, {
      cleTomtom: await cleTomtom(),
    }));
  } catch (err) {
    console.error('[GÉOCODAGE] Erreur inverse :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

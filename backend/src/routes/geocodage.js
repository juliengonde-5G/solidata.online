// ══════════════════════════════════════════════════════════════════════════
// GÉOCODAGE — une adresse en coordonnées GPS
// ══════════════════════════════════════════════════════════════════════════
// Sert les formulaires de saisie de lieux : conteneurs, points association,
// lieux d'arrêt technique. On tape une adresse, on récupère la position.
//
// Lecture seule, réservée aux profils qui saisissent des référentiels.
//
// CHAÎNE DE GARDE (correctif du 27/08) : ce routeur est monté DIRECTEMENT sur
// l'application (`app.use('/api/geocodage', …)` dans index.js), sans middleware
// d'authentification en amont — contrairement aux sous-routeurs de `tours/`,
// couverts par le `router.use(authenticate)` de leur routeur parent. Il lui
// manquait donc `authenticate` : `authorize` ne trouvait jamais `req.user`
// (assigné en un SEUL endroit du backend, dans `authenticate`) et répondait
// 401 « Non authentifié » à TOUT le monde, jeton ADMIN valide compris.
//
// L'exposition était nulle (échec fermé), mais la fonction était morte : le
// composant `AdresseGeocodee` ne recevait jamais de proposition. Le piège
// aurait été de « corriger au symptôme » en retirant l'`authorize` qui renvoie
// le 401 — la route serait alors devenue une surface PUBLIQUE non
// authentifiée, servant de relais sortant vers la Base Adresse Nationale.
// C'est l'authentification qui manquait, pas l'autorisation qui était de trop.

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { chercherAdresse } = require('../services/geocodage');

// Pattern du dépôt (messages.js, chaine-config.js) : l'authentification est
// posée en tête du routeur, l'autorisation reste par route.
router.use(authenticate);

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

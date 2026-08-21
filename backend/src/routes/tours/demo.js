// ══════════════════════════════════════════════════════════════
// MODE DÉMO — endpoints du FORMATEUR
// ──────────────────────────────────────────────────────────────
//   GET  /api/tours/demo/access-info  → lien à poser sur le téléphone du
//                                       stagiaire + état de la tournée d'exercice
//   POST /api/tours/demo/reset        → remet la démo à zéro entre deux stagiaires
//
// Le véhicule de démonstration et son scénario sont installés par
// `src/scripts/seed-demo-formation.js` (jamais automatiquement : une démo est
// une décision d'exploitation, pas un effet de bord du déploiement).
// Voir services/demo-mode.js pour la doctrine de neutralisation.
// ══════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { getDemoVehicle, DEMO_RESET_SETTING } = require('../../services/demo-mode');
const { resetDemoTour } = require('../../scripts/seed-demo-formation');

const MOBILE_BASE_URL = process.env.MOBILE_BASE_URL || 'https://m.solidata.online';

/** Tournée de démonstration du jour (la plus récente du véhicule de démo). */
async function getDemoTour(vehicleId) {
  const r = await pool.query(
    `SELECT t.id, t.date, t.status, t.is_demo,
            COALESCE(t.nb_cav, 0) AS nb_cav,
            (SELECT COUNT(*)::int FROM tour_cav tc
              WHERE tc.tour_id = t.id AND tc.status = 'collected') AS nb_collectes
       FROM tours t
      WHERE t.vehicle_id = $1 AND t.is_demo = true
      ORDER BY t.date DESC, t.id DESC
      LIMIT 1`,
    [vehicleId]
  );
  return r.rows[0] || null;
}

// GET /api/tours/demo/access-info — lien + état, pour l'écran du formateur
router.get('/demo/access-info', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const vehicle = await getDemoVehicle();
    if (!vehicle) {
      return res.json({
        disponible: false,
        message: 'La démo de formation n\'est pas installée. Un administrateur doit lancer '
          + '« node src/scripts/seed-demo-formation.js --apply » dans le conteneur backend.',
      });
    }
    const tour = await getDemoTour(vehicle.id);
    const reset = await pool.query('SELECT value FROM settings WHERE key = $1', [DEMO_RESET_SETTING]);
    res.json({
      disponible: true,
      url: `${MOBILE_BASE_URL}/v/${vehicle.qr_token}`,
      vehicle: { id: vehicle.id, registration: vehicle.registration, name: vehicle.name },
      tour: tour ? {
        id: tour.id, date: tour.date, status: tour.status,
        nb_cav: tour.nb_cav, nb_collectes: tour.nb_collectes,
      } : null,
      reinitialisee_le: reset.rows[0]?.value || null,
    });
  } catch (err) {
    console.error('[DEMO] Erreur access-info :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/demo/reset — remet la démo dans son état initial
router.post('/demo/reset', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const vehicle = await getDemoVehicle();
    if (!vehicle) {
      return res.status(409).json({
        error: 'La démo de formation n\'est pas installée sur cette base.',
        code: 'DEMO_ABSENTE',
      });
    }
    const result = await resetDemoTour(pool, { log: () => {} });
    res.json({
      ok: true,
      tour_id: result.tourId,
      nb_cav: result.nbCav,
      message: `Démo réinitialisée : ${result.nbCav} point(s) de collecte, tournée prête à démarrer.`,
    });
  } catch (err) {
    console.error('[DEMO] Erreur reset :', err);
    res.status(500).json({ error: err.message || 'Réinitialisation impossible' });
  }
});

module.exports = router;

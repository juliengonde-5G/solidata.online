// ══════════════════════════════════════════════════════════════
// MODE DÉMO — parcours chauffeur pour les FORMATIONS
// ──────────────────────────────────────────────────────────────
// Un véhicule dédié (`vehicles.is_demo = true`) porte son propre lien
// « 1 URL = 1 véhicule » (`/v/<qr_token>`). Toute tournée créée sur ce
// véhicule hérite de `tours.is_demo = true`, et TOUTES les écritures qui
// auraient une portée métier durable sont NEUTRALISÉES :
//
//   • effets de clôture   — tonnage_history, stock_movements,
//                           stock_original_movements, collection_learning_feedback
//   • photo de référence  — cav.photo_path / photo_taken_at / photo_source
//   • temps de collecte   — cav_collection_times (alimente les durées apprises)
//   • scans de QR         — cav_qr_scans (rattaché au CAV, survit à la purge)
//   • notifications push  — les managers ne sont jamais réveillés par un exercice
//
// Ce qui reste écrit est rattaché à la tournée de démo elle-même (points de
// passage, pesées, checklists, GPS, incidents, déclarations de fin de journée)
// et disparaît à la réinitialisation. Les lectures de production excluent
// `is_demo` (planning, tableaux de bord, KPI, carte des véhicules en direct).
//
// Doctrine : un stagiaire doit pouvoir tout essayer — y compris se tromper —
// sans qu'une seule statistique réelle bouge.
// ══════════════════════════════════════════════════════════════

const pool = require('../config/database');

/** Immatriculation réservée au véhicule de démonstration (clé d'unicité). */
const DEMO_VEHICLE_REGISTRATION = 'DEMO-FORMATION';
const DEMO_VEHICLE_NAME = 'Camion École (démo formation)';
/** Nombre de points de collecte du scénario de formation. */
const DEMO_NB_POINTS = 8;
/** Réglage horodatant la dernière remise à zéro (affiché au formateur). */
const DEMO_RESET_SETTING = 'collecte.demo_reinitialisee_le';

/**
 * Vrai si l'objet tournée fourni est une tournée de démonstration.
 * Tolérant : accepte le booléen PostgreSQL comme la chaîne 't'/'true'
 * (selon le driver et les projections, la valeur peut arriver sous
 * plusieurs formes) et considère `undefined` comme « pas une démo ».
 */
function isDemoTour(tour) {
  if (!tour) return false;
  const v = tour.is_demo;
  return v === true || v === 't' || v === 'true' || v === 1;
}

/**
 * Lit `tours.is_demo` en base pour un identifiant de tournée.
 * Renvoie `false` si la tournée n'existe pas — un appelant ne doit jamais
 * neutraliser une écriture par accident sur une tournée inconnue : c'est le
 * contrôle de périmètre habituel qui rejettera la requête.
 */
async function isDemoTourId(tourId, client = pool) {
  if (!tourId) return false;
  try {
    const r = await client.query('SELECT is_demo FROM tours WHERE id = $1', [tourId]);
    return isDemoTour(r.rows[0]);
  } catch (err) {
    // Colonne absente (base pas encore migrée) → on se comporte comme en
    // production normale plutôt que d'échouer la requête du chauffeur.
    console.warn('[DEMO] Lecture de tours.is_demo impossible :', err.message);
    return false;
  }
}

/** Véhicule de démonstration (ou null s'il n'a jamais été installé). */
async function getDemoVehicle(client = pool) {
  try {
    const r = await client.query(
      `SELECT id, registration, name, qr_token, max_capacity_kg, status
         FROM vehicles WHERE is_demo = true ORDER BY id LIMIT 1`
    );
    return r.rows[0] || null;
  } catch (err) {
    console.warn('[DEMO] Lecture du véhicule de démonstration impossible :', err.message);
    return null;
  }
}

module.exports = {
  DEMO_VEHICLE_REGISTRATION,
  DEMO_VEHICLE_NAME,
  DEMO_NB_POINTS,
  DEMO_RESET_SETTING,
  isDemoTour,
  isDemoTourId,
  getDemoVehicle,
};

/**
 * Session chauffeur « 1 URL = 1 véhicule » — helpers partagés.
 *
 * Modèle d'identité du mobile : le chauffeur ouvre le raccourci
 * `https://m.solidata.online/v/<qr_token>` de SON véhicule ; POST
 * /auth/driver-start lui délivre un JWT. **L'identité de la session est le
 * véhicule, pas la personne** — les fiches salariés viennent de la paie
 * (Malibou) et n'ont, dans le cas général, aucun compte utilisateur : le JWT
 * porte donc le plus souvent le compte générique « chauffeur ».
 *
 * Conséquences, et raison d'être de ce module :
 *   1. Toute résolution « qui conduit ? » doit partir du VÉHICULE, jamais du
 *      seul `users.id` (sinon : « Aucune fiche employé liée à votre compte »).
 *   2. Le périmètre d'une session chauffeur est son véhicule : les écrans
 *      mobiles ne doivent jamais lister le parc.
 *
 * Le véhicule est encodé dans le JWT de deux façons (rétro-compatibilité) :
 *   - `vehicle_id` (claim explicite, ajouté avec ce module) ;
 *   - `username` = « driver_<vehicleId> » (forme historique, toujours émise,
 *     sur laquelle repose la garde de périmètre de routes/tours/index.js).
 */

/**
 * Identifiant du véhicule porté par la session, ou null si ce n'est pas une
 * session chauffeur (ADMIN/MANAGER en supervision, tout autre compte web).
 * @param {object} user - req.user (payload JWT décodé)
 * @returns {number|null}
 */
function driverVehicleIdFromToken(user) {
  if (!user) return null;
  if (user.vehicle_id != null) {
    const v = parseInt(user.vehicle_id, 10);
    if (Number.isInteger(v)) return v;
  }
  const m = /^driver_(\d+)$/.exec(user.username != null ? String(user.username) : '');
  return m ? parseInt(m[1], 10) : null;
}

/** true si la requête vient d'un raccourci véhicule (mobile chauffeur). */
function isDriverSession(user) {
  return driverVehicleIdFromToken(user) != null;
}

/**
 * Résout la fiche employé à rattacher à une tournée, en cascade honnête :
 *   1. `employee_id` porté par le JWT chauffeur (émis par driver-start à partir
 *      de vehicles.assigned_driver_id) ;
 *   2. fiche employé liée au compte utilisateur (chauffeur disposant d'un
 *      compte, ou manager qui prend une tournée depuis le web) ;
 *   3. chauffeur affecté au véhicule (repli pour les jetons émis AVANT ce
 *      correctif, encore valides jusqu'à 8 h) ;
 *   4. `null` — aucun chauffeur identifiable : la tournée est rattachée au
 *      véhicule seul. C'est un cas NORMAL du modèle « 1 URL = 1 véhicule »
 *      (véhicule sans chauffeur affecté), pas une erreur : on ne bloque pas
 *      le départ en tournée pour une donnée RH manquante, et on n'invente
 *      aucun rattachement.
 *
 * @param {object} pool - pool PostgreSQL
 * @param {object} user - req.user
 * @param {number|null} vehicleId - véhicule ciblé par l'action
 * @returns {Promise<number|null>} employees.id ou null
 */
async function resolveDriverEmployeeId(pool, user, vehicleId) {
  // 1. Jeton chauffeur récent.
  if (user && user.employee_id != null) {
    const empId = parseInt(user.employee_id, 10);
    if (Number.isInteger(empId)) {
      const r = await pool.query('SELECT id FROM employees WHERE id = $1', [empId]);
      if (r.rows.length > 0) return r.rows[0].id;
    }
  }

  // 2. Compte utilisateur lié à une fiche employé.
  const uid = user ? (user.id != null ? user.id : user.userId) : null;
  if (uid != null) {
    const r = await pool.query('SELECT id FROM employees WHERE user_id = $1', [uid]);
    if (r.rows.length > 0) return r.rows[0].id;
  }

  // 3. Chauffeur affecté au véhicule.
  if (vehicleId != null) {
    const r = await pool.query(
      'SELECT assigned_driver_id FROM vehicles WHERE id = $1', [vehicleId]);
    if (r.rows.length > 0 && r.rows[0].assigned_driver_id != null) {
      return r.rows[0].assigned_driver_id;
    }
  }

  // 4. Tournée rattachée au véhicule seul.
  return null;
}

// Date du jour en heure de Paris. Le conteneur tourne en UTC : entre minuit et
// 2 h du matin (heure d'été), CURRENT_DATE renvoie la veille — une tournée
// créée là serait invisible de GET /vehicle/:id/today (déjà calé sur Paris).
const SQL_TODAY_PARIS = "(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date";

/**
 * Tournée du jour du VÉHICULE de la session — la sélection, écrite une fois.
 *
 * C'est la requête que `GET /tours/vehicle/:id/today` posait en ligne : « la
 * dernière tournée à rouler de ce véhicule, datée du jour civil de Paris ».
 * Elle est extraite ici parce qu'un second appelant en a besoin (l'assistant
 * conversationnel du chauffeur) et que recopier la règle, c'est se donner deux
 * définitions de « ma tournée d'aujourd'hui » qui finiront par diverger — le
 * choix du statut (`planned`/`in_progress`), du fuseau et du tri par id
 * décroissant n'a rien d'évident et ne doit être fait qu'à un seul endroit.
 *
 * @returns {Promise<object|null>} la ligne de tournée (avec immatriculation et
 *   nombre de points), ou `null` si le véhicule n'a rien à rouler aujourd'hui.
 */
async function tourneeDuJourPourVehicule(db, vehicleId) {
  const r = await db.query(
    `SELECT t.*, v.registration, v.name as vehicle_name,
            (SELECT COUNT(*) FROM tour_cav tc WHERE tc.tour_id = t.id) as nb_cav
       FROM tours t
       JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.vehicle_id = $1
        AND t.date = ${SQL_TODAY_PARIS}
        AND t.status IN ('planned', 'in_progress')
      ORDER BY t.id DESC LIMIT 1`,
    [vehicleId]
  );
  return r.rows.length > 0 ? r.rows[0] : null;
}

module.exports = {
  driverVehicleIdFromToken,
  isDriverSession,
  resolveDriverEmployeeId,
  tourneeDuJourPourVehicule,
  SQL_TODAY_PARIS,
};

// Rôles applicatifs — source unique.
//
// Ces libellés servaient jusqu'ici uniquement à la validation du rôle d'un
// UTILISATEUR (routes/users.js). Depuis l'introduction des clés d'API de
// service (2.45.0), une clé porte elle aussi un rôle : les deux points de
// contrôle doivent valider contre la MÊME liste, sans quoi un rôle valide d'un
// côté serait refusé de l'autre (ou pire, accepté sans exister).

const pool = require('../config/database');

// Les 6 rôles historiques + DPO (RGPD sans pleins droits ADMIN), FINANCE
// (consultation direction/CA), QHSE (incidents + véhicules + exports d'audit),
// PCM (praticien) et COMMUNICATION (chargé de communication). Ce sont des rôles
// INTÉGRÉS (pas des rôles personnalisés) car ils ouvrent des accès qu'un rôle
// dupliqué, borné aux droits de son rôle de base, ne pourrait pas accorder.
//
// COMMUNICATION est précisément dans ce cas : il lui faut ÉCRIRE la playlist de
// l'écran d'information, réservée jusqu'ici à ADMIN/RH, sans rien recevoir du
// reste de la badgeuse (pointages, feuilles de temps, badges, paramètres) ni
// des RH. Un rôle dupliqué de RH aurait ouvert tout le dossier du personnel ;
// dupliqué de COLLABORATEUR, il n'aurait rien pu publier. La matrice
// /admin/permissions ne masque que la barre latérale, jamais l'API : elle ne
// pouvait donc pas tenir ce périmètre à elle seule.
const BUILTIN_ROLES = ['ADMIN', 'MANAGER', 'RH', 'COLLABORATEUR', 'AUTORITE', 'RESP_BTQ', 'DPO', 'FINANCE', 'QHSE', 'PCM', 'COMMUNICATION'];

/** Un rôle est valide s'il est intégré ou personnalisé (table custom_roles). */
async function isValidRole(role) {
  if (BUILTIN_ROLES.includes(role)) return true;
  try {
    const r = await pool.query('SELECT 1 FROM custom_roles WHERE role_key = $1', [role]);
    return r.rows.length > 0;
  } catch (_) { return false; }
}

module.exports = { BUILTIN_ROLES, isValidRole };

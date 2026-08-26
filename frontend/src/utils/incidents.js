/**
 * Libellés des incidents — SOURCE UNIQUE.
 *
 * Les valeurs stockées (`cav_problem`, `environment`, `closed`…) sont des
 * identifiants techniques, contraints en base. Elles ne doivent jamais
 * atteindre l'écran telles quelles : un utilisateur qui lit « environment » ou
 * « closed » dans un compte rendu de tournée n'apprend rien et doute du reste.
 *
 * Ces tables vivaient en constantes locales de la page Incidents ; le compte
 * rendu de tournée, lui, affichait les valeurs brutes. D'où ce module partagé,
 * pour qu'un type ajouté au référentiel se nomme partout du même mot.
 */

/** Doit couvrir le CHECK de `incidents.type` (cf. init-db.js). */
export const INCIDENT_TYPE_LABELS = {
  cav_problem: 'CAV dégradée',
  environment: 'CAV inaccessible / environnement',
  vehicle_breakdown: 'Panne véhicule',
  accident: 'Accident',
  other: 'Autre',
};

/** Doit couvrir le CHECK de `incidents.status` (cf. init-db.js). */
export const INCIDENT_STATUS_LABELS = {
  open: 'Ouvert',
  in_progress: 'En cours',
  resolved: 'Résolu',
  closed: 'Clôturé',
};

/**
 * Repli sur la valeur brute plutôt que sur un tiret : si un type inconnu
 * apparaît un jour, mieux vaut le voir en clair — c'est le signe qu'un libellé
 * manque ici — que de le masquer derrière un « — » qu'on prendrait pour une
 * donnée absente.
 */
export const libelleTypeIncident = (type) => INCIDENT_TYPE_LABELS[type] || type || '—';
export const libelleStatutIncident = (statut) => INCIDENT_STATUS_LABELS[statut] || statut || '—';

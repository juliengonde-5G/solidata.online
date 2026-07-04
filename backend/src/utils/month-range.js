/**
 * Bornes d'un mois "YYYY-MM" pour les requêtes SQL `BETWEEN`.
 *
 * Corrige le bug historique `month + '-31'` : PostgreSQL rejette une date
 * calendaire invalide (`'2026-02-31'::date` → « date/time field value out of
 * range ») au lieu de la tronquer. Toute requête mensuelle portant sur un mois
 * de 28/29/30 jours (février, avril, juin, septembre, novembre…) renvoyait
 * donc un 500. On calcule ici le vrai dernier jour du mois (années
 * bissextiles incluses).
 *
 * @param {string} month  Mois au format "YYYY-MM"
 * @returns {[string, string]} [premier jour, dernier jour] en "YYYY-MM-DD"
 */
function monthBounds(month) {
  const [y, m] = String(month).split('-').map(Number);
  // Jour 0 du mois suivant = dernier jour du mois courant.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(lastDay).padStart(2, '0')}`];
}

module.exports = { monthBounds };

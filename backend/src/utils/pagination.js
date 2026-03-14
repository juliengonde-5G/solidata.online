/**
 * Utilitaire de pagination pour les requêtes SQL
 */

/**
 * Applique LIMIT et OFFSET à une requête SQL
 * @param {string} query - Requête SQL de base
 * @param {Array} params - Paramètres de la requête
 * @param {object} options - { limit, offset } depuis req.query
 * @returns {{ query: string, params: Array }}
 */
function applyPagination(query, params, options = {}) {
  const { limit: lim, offset: off } = options;

  if (lim) {
    params.push(parseInt(lim));
    query += ` LIMIT $${params.length}`;
  }
  if (off) {
    params.push(parseInt(off));
    query += ` OFFSET $${params.length}`;
  }

  return { query, params };
}

module.exports = { applyPagination };

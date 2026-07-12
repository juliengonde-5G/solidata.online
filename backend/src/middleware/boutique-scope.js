const pool = require('../config/database');
const { resolveBaseRole } = require('./auth');

// Rôles qui voient TOUTES les boutiques (aucun cloisonnement).
// La direction est représentée par ADMIN/MANAGER (pas de rôle « DIRECTION »
// distinct). Tout autre rôle non-RESP_BTQ conserve le comportement historique
// (accès total en lecture) — seul RESP_BTQ est cloisonné (audit item 55a).
const FULL_ACCESS_ROLES = ['ADMIN', 'MANAGER'];

/**
 * Périmètre de boutiques d'un utilisateur RESP_BTQ.
 * Union de deux sources :
 *   - affectations explicites (table user_boutiques, gérées par l'ADMIN)
 *   - lien historique boutiques.responsable_id (rétro-compat : un RESP_BTQ
 *     déjà positionné comme responsable garde l'accès sans réaffectation)
 * Retourne un tableau d'IDs entiers (peut être vide).
 */
async function loadUserBoutiqueIds(userId) {
  const r = await pool.query(
    `SELECT boutique_id FROM user_boutiques WHERE user_id = $1
     UNION
     SELECT id AS boutique_id FROM boutiques WHERE responsable_id = $1`,
    [userId]
  );
  return r.rows.map((row) => Number(row.boutique_id));
}

/**
 * Middleware : attache req.boutiqueScope.
 *   - null                → accès total (ADMIN/MANAGER et autres rôles non cloisonnés)
 *   - Set([...ids])       → périmètre restreint (RESP_BTQ) ; Set vide = aucun accès
 * À monter APRÈS authenticate.
 */
async function attachBoutiqueScope(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    const role = req.user.role;
    const base = resolveBaseRole(role);
    if (FULL_ACCESS_ROLES.includes(role) || FULL_ACCESS_ROLES.includes(base)) {
      req.boutiqueScope = null; // accès total
      return next();
    }
    if (base === 'RESP_BTQ') {
      const ids = await loadUserBoutiqueIds(req.user.id);
      req.boutiqueScope = new Set(ids);
      return next();
    }
    // Autres rôles (RH, FINANCE, AUTORITE, QHSE, DPO, COLLABORATEUR…) :
    // comportement historique inchangé (accès total en lecture).
    req.boutiqueScope = null;
    return next();
  } catch (err) {
    console.error('[boutique-scope] attach:', err);
    return res.status(500).json({ error: 'Erreur périmètre boutiques' });
  }
}

/** Un utilisateur peut-il accéder à cette boutique ? (scope null = oui) */
function canAccessBoutique(req, boutiqueId) {
  if (req.boutiqueScope === null || req.boutiqueScope === undefined) return true;
  return req.boutiqueScope.has(Number(boutiqueId));
}

/**
 * Vérifie un boutique_id explicite (query/param/body).
 * - boutique_id absent → true (le filtrage de liste s'en charge en aval)
 * - invalide           → 400 et false
 * - hors périmètre     → 403 et false
 * Retourne false si une réponse a déjà été envoyée (l'appelant doit s'arrêter).
 */
function enforceBoutiqueParam(req, res, boutiqueId) {
  if (boutiqueId === undefined || boutiqueId === null || boutiqueId === '') {
    return true;
  }
  const id = Number(boutiqueId);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'boutique_id invalide' });
    return false;
  }
  if (!canAccessBoutique(req, id)) {
    res.status(403).json({ error: 'Accès non autorisé à cette boutique' });
    return false;
  }
  return true;
}

// Tables dont on sait résoudre la boutique par l'id de l'entité (whitelist :
// jamais de nom de table issu d'une entrée utilisateur → pas d'injection).
const ENTITY_TABLES = new Set([
  'boutique_commandes',
  'boutique_import_batches',
  'boutique_objectifs',
]);

/**
 * Vérifie que l'entité <table>#<id> appartient à une boutique du périmètre.
 * - scope null (accès total) → true sans requête
 * - entité introuvable       → 404 et false
 * - hors périmètre           → 403 et false
 */
async function enforceBoutiqueForEntity(req, res, table, entityId) {
  if (req.boutiqueScope === null || req.boutiqueScope === undefined) return true;
  if (!ENTITY_TABLES.has(table)) {
    res.status(500).json({ error: 'Table non autorisée pour le contrôle de périmètre' });
    return false;
  }
  const r = await pool.query(`SELECT boutique_id FROM ${table} WHERE id = $1`, [entityId]);
  if (r.rows.length === 0) {
    res.status(404).json({ error: 'Introuvable' });
    return false;
  }
  if (!req.boutiqueScope.has(Number(r.rows[0].boutique_id))) {
    res.status(403).json({ error: 'Accès non autorisé à cette boutique' });
    return false;
  }
  return true;
}

/**
 * Fragment SQL de filtrage par périmètre, ajouté à une clause WHERE existante.
 * Pousse les IDs du périmètre dans `params` (SQL paramétré).
 *   - scope null (accès total) → '' (aucun filtre)
 *   - périmètre non vide        → ' AND <col> IN ($n,$n+1,…)'
 *   - périmètre vide            → ' AND false' (ne renvoie rien)
 */
function boutiqueScopeSql(req, column, params) {
  if (req.boutiqueScope === null || req.boutiqueScope === undefined) return '';
  const ids = [...req.boutiqueScope];
  if (ids.length === 0) return ' AND false';
  const placeholders = ids.map((id) => {
    params.push(id);
    return `$${params.length}`;
  });
  return ` AND ${column} IN (${placeholders.join(',')})`;
}

module.exports = {
  FULL_ACCESS_ROLES,
  loadUserBoutiqueIds,
  attachBoutiqueScope,
  canAccessBoutique,
  enforceBoutiqueParam,
  enforceBoutiqueForEntity,
  boutiqueScopeSql,
};

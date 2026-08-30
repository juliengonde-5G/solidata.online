// Middleware d'authentification par clé API (Niveau 3.3)
// Header attendu : X-API-Key: sol_<prefix>_<secret>
// - prefix = 8 caractères identifiant la clé en clair (lookup rapide)
// - secret = le reste (comparé au hash SHA-256)
//
// DEUX USAGES, un seul mécanisme de clé :
//   1. `apiKeyAuth([...scopes])` — API publique partenaires (routes/public-api.js).
//      Pose `req.apiKey`, PAS `req.user` : ces routes ne franchissent ni
//      `authenticate` ni `authorize`.
//   2. Identité de SERVICE (2.45.0) — une clé portant le scope `service:read`
//      ET un `service_role` vaut identité applicative en LECTURE SEULE pour
//      `authenticate` (cf. middleware/auth.js). C'est ce qui remplace le compte
//      ADMIN de service (identifiant + mot de passe + secret TOTP dans le .env
//      du serveur) utilisé jusqu'ici par le smoke test de déploiement.

const crypto = require('crypto');
const pool = require('../config/database');

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

/**
 * Scope dédié à l'identité de service. Une clé partenaire qui ne le porte pas
 * ne peut PAS devenir une identité applicative, même si un `service_role` lui
 * était renseigné par erreur : les deux conditions sont exigées ensemble.
 */
const SERVICE_SCOPE = 'service:read';

/** Méthodes HTTP qu'une identité de service a le droit d'emprunter. */
const METHODES_LECTURE = new Set(['GET', 'HEAD']);

function parseKey(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.trim().split('_');
  // Format : sol_<prefix>_<secret...>
  if (parts.length < 3 || parts[0] !== 'sol') return null;
  const prefix = parts[1];
  const secret = parts.slice(2).join('_');
  if (!prefix || !secret) return null;
  return { prefix, secret, full: raw.trim() };
}

function generateKey() {
  const prefix = crypto.randomBytes(6).toString('hex'); // 12 chars
  const secret = crypto.randomBytes(24).toString('base64url');
  const full = `sol_${prefix}_${secret}`;
  return { prefix, secret, full, hash: sha256(full) };
}

/**
 * Charge la ligne `api_keys` d'un préfixe.
 * Résilience : sur une base pas encore migrée (colonne `service_role` absente),
 * on retombe sur la projection historique plutôt que de renvoyer 500 — les clés
 * partenaires continuent de fonctionner, et l'identité de service est refusée
 * en le DISANT (aucune clé ne peut alors porter de rôle).
 */
async function chargerCle(prefix) {
  try {
    const r = await pool.query(
      `SELECT id, name, scopes, active, expires_at, key_hash, service_role
         FROM api_keys WHERE key_prefix = $1`,
      [prefix]
    );
    return r.rows[0] || null;
  } catch (err) {
    if (err && err.code === '42703') {
      console.warn('[API-KEY] Colonne service_role absente (base non migrée) — identité de service indisponible');
      const r = await pool.query(
        `SELECT id, name, scopes, active, expires_at, key_hash
           FROM api_keys WHERE key_prefix = $1`,
        [prefix]
      );
      return r.rows[0] || null;
    }
    throw err;
  }
}

/**
 * Vérifie une clé brute et renvoie un verdict exploitable par l'appelant.
 * Ne touche pas à `req` : c'est l'appelant qui décide du code HTTP et de ce
 * qu'il attache à la requête.
 *
 * @param {string} raw contenu de l'en-tête X-API-Key
 * @param {{ requiredScopes?: string[], service?: boolean }} options
 * @returns {Promise<{ ok: boolean, status?: number, error?: string, code?: string, key?: object }>}
 */
async function verifierCle(raw, { requiredScopes = [], service = false } = {}) {
  const parsed = parseKey(raw);
  if (!parsed) return { ok: false, status: 401, error: 'Clé API manquante ou mal formée' };

  const row = await chargerCle(parsed.prefix);
  if (!row || !row.active) return { ok: false, status: 401, error: 'Clé API invalide ou désactivée' };
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { ok: false, status: 401, error: 'Clé API expirée' };
  }
  // Comparaison à temps constant : le hash est de longueur fixe, mais la
  // comparaison `===` de deux chaînes s'arrête au premier octet différent.
  const attendu = Buffer.from(String(row.key_hash || ''), 'utf8');
  const fourni = Buffer.from(sha256(parsed.full), 'utf8');
  if (attendu.length !== fourni.length || !crypto.timingSafeEqual(attendu, fourni)) {
    return { ok: false, status: 401, error: 'Clé API invalide' };
  }

  const scopes = row.scopes || [];
  if (requiredScopes.length > 0 && !requiredScopes.every((s) => scopes.includes(s))) {
    return { ok: false, status: 403, error: 'Scopes insuffisants', required: requiredScopes };
  }

  if (service) {
    // Les DEUX conditions, jamais une seule : le scope dit « cette clé a le
    // droit d'être une identité applicative », le rôle dit « laquelle ».
    if (!scopes.includes(SERVICE_SCOPE)) {
      return {
        ok: false, status: 403, code: 'SERVICE_SCOPE_MANQUANT',
        error: `Cette clé d'API n'est pas une identité de service (scope « ${SERVICE_SCOPE} » requis)`,
      };
    }
    if (!row.service_role) {
      return {
        ok: false, status: 403, code: 'SERVICE_ROLE_MANQUANT',
        error: "Cette clé d'API porte le scope de service mais aucun rôle : rôle à renseigner par un ADMIN",
      };
    }
  }

  return { ok: true, key: { id: row.id, name: row.name, scopes, service_role: row.service_role || null } };
}

/** Marque l'usage d'une clé (best-effort, jamais bloquant). */
function toucherCle(id) {
  // Défensif : le pool peut être doublé dans les tests et ne pas rendre de
  // promesse. Un marquage d'usage ne doit jamais faire échouer une requête.
  try {
    const p = pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [id]);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) { /* jamais bloquant */ }
}

function apiKeyAuth(requiredScopes = []) {
  return async (req, res, next) => {
    const raw = req.get('x-api-key') || req.query.api_key;
    try {
      const verdict = await verifierCle(raw, { requiredScopes });
      if (!verdict.ok) {
        const corps = { error: verdict.error };
        if (verdict.required) corps.required = verdict.required;
        return res.status(verdict.status).json(corps);
      }
      req.apiKey = { id: verdict.key.id, name: verdict.key.name, scopes: verdict.key.scopes };
      toucherCle(verdict.key.id);
      next();
    } catch (err) {
      console.error('[API-KEY] auth error:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

module.exports = {
  apiKeyAuth,
  generateKey,
  sha256,
  verifierCle,
  toucherCle,
  SERVICE_SCOPE,
  METHODES_LECTURE,
};

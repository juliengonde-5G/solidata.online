// Middleware d'authentification par clé API (Niveau 3.3)
// Header attendu : X-API-Key: sol_<prefix>_<secret>
// - prefix = 8 caractères identifiant la clé en clair (lookup rapide)
// - secret = le reste (comparé au hash SHA-256)

const crypto = require('crypto');
const pool = require('../config/database');

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

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

function apiKeyAuth(requiredScopes = []) {
  return async (req, res, next) => {
    const raw = req.get('x-api-key') || req.query.api_key;
    const parsed = parseKey(raw);
    if (!parsed) return res.status(401).json({ error: 'Clé API manquante ou mal formée' });

    try {
      const result = await pool.query(
        `SELECT id, name, scopes, active, expires_at, key_hash
           FROM api_keys WHERE key_prefix = $1`,
        [parsed.prefix]
      );
      const row = result.rows[0];
      if (!row || !row.active) return res.status(401).json({ error: 'Clé API invalide ou désactivée' });
      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return res.status(401).json({ error: 'Clé API expirée' });
      }
      if (sha256(parsed.full) !== row.key_hash) {
        return res.status(401).json({ error: 'Clé API invalide' });
      }
      if (requiredScopes.length > 0) {
        const ok = requiredScopes.every(s => (row.scopes || []).includes(s));
        if (!ok) return res.status(403).json({ error: 'Scopes insuffisants', required: requiredScopes });
      }
      req.apiKey = { id: row.id, name: row.name, scopes: row.scopes || [] };
      // MAJ last_used_at en best-effort
      pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [row.id]).catch(() => {});
      next();
    } catch (err) {
      console.error('[API-KEY] auth error:', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  };
}

module.exports = { apiKeyAuth, generateKey, sha256 };

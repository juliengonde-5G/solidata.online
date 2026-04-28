// Routes admin pour gérer les clés API partenaires (Niveau 3.3)

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { generateKey, sha256 } = require('../middleware/api-key');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');

router.use(authenticate, authorize('ADMIN'));

// GET /api/admin/api-keys
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, key_prefix, scopes, active, expires_at, last_used_at, created_at,
              (SELECT username FROM users WHERE id = ak.created_by) AS created_by_username
         FROM api_keys ak ORDER BY created_at DESC`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[API-KEYS] list :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/api-keys — Créer. La clé en clair n'est retournée qu'ici, une seule fois.
router.post('/',
  [
    body('name').notEmpty().isLength({ max: 120 }),
    body('scopes').optional().isArray(),
    body('expires_at').optional({ nullable: true }),
  ],
  validate,
  async (req, res) => {
    try {
      const { name, scopes, expires_at } = req.body;
      const gen = generateKey();
      const r = await pool.query(
        `INSERT INTO api_keys (name, key_prefix, key_hash, scopes, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, key_prefix, scopes, active, expires_at, created_at`,
        [
          name,
          gen.prefix,
          gen.hash,
          Array.isArray(scopes) ? scopes : [],
          expires_at || null,
          req.user.id,
        ]
      );
      res.status(201).json({
        key: gen.full, // à montrer une seule fois à l'admin
        ...r.rows[0],
      });
    } catch (err) {
      console.error('[API-KEYS] create :', err);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
);

// PUT /api/admin/api-keys/:id — Activer / désactiver, renommer, scopes
router.put('/:id', async (req, res) => {
  try {
    const fields = ['name', 'scopes', 'active', 'expires_at'];
    const updates = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        params.push(req.body[f]);
        updates.push(`${f} = $${params.length}`);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Aucun champ' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE api_keys SET ${updates.join(', ')} WHERE id = $${params.length}
       RETURNING id, name, key_prefix, scopes, active, expires_at, last_used_at`,
      params
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Clé non trouvée' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[API-KEYS] update :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/admin/api-keys/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM api_keys WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[API-KEYS] delete :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

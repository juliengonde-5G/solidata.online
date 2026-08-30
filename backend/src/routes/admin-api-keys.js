// Routes admin pour gérer les clés API partenaires (Niveau 3.3)
//
// Deux familles de clés vivent dans la même table :
//   - clé PARTENAIRE : scopes de lecture de l'API publique (cav:read…),
//     `service_role` NULL — elle n'a aucune identité applicative ;
//   - clé de SERVICE (2.45.0) : scope « service:read » + `service_role`, elle
//     vaut identité en LECTURE SEULE pour `authenticate` (cf. middleware/auth.js).
//     C'est ce qui remplace le compte ADMIN + mot de passe + secret TOTP du
//     `.env` serveur utilisé par le smoke test de déploiement.
//
// Garde-fou : le rôle d'une clé est validé contre la liste réelle des rôles
// (utils/roles.js) — on ne fabrique pas un rôle inexistant, qui passerait
// silencieusement toutes les gardes `authorize` en n'en satisfaisant aucune.

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { generateKey, sha256, SERVICE_SCOPE } = require('../middleware/api-key');
const { isValidRole } = require('../utils/roles');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { logActivity } = require('../middleware/activity-logger');

router.use(authenticate, authorize('ADMIN'));

// Une identité de SERVICE ne gère pas le trousseau — même en lecture. Elle est
// déjà bornée à la lecture par `authenticate`, mais lister les clés donnerait à
// une clé volée la carte complète du trousseau (noms, rôles, échéances) : c'est
// de la reconnaissance, pas de la donnée métier. Seul un humain administre ici.
router.use((req, res, next) => {
  if (req.user && req.user.is_service) {
    return res.status(403).json({
      error: "Les clés d'API se gèrent depuis un compte administrateur humain",
      code: 'SERVICE_KEY_FORBIDDEN',
    });
  }
  return next();
});

/**
 * Valide le couple (rôle de service, scopes) d'une clé.
 * @returns {Promise<string|null>} message d'erreur, ou null si valide
 */
async function validerService(serviceRole, scopes) {
  const porteScope = (scopes || []).includes(SERVICE_SCOPE);
  if (!serviceRole) {
    // Une clé qui porte le scope de service sans rôle serait refusée à l'usage
    // (403) : mieux vaut refuser sa création que livrer une clé morte.
    if (porteScope) return `Une clé portant le scope « ${SERVICE_SCOPE} » doit indiquer son rôle (service_role)`;
    return null;
  }
  if (typeof serviceRole !== 'string' || !(await isValidRole(serviceRole))) {
    return `Rôle inconnu : ${serviceRole}`;
  }
  if (!porteScope) return `Une clé portant un rôle de service doit aussi porter le scope « ${SERVICE_SCOPE} »`;
  return null;
}

// GET /api/admin/api-keys
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, key_prefix, scopes, service_role, active, expires_at, last_used_at, created_at,
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
      const { name, scopes, expires_at, service_role } = req.body;
      const listeScopes = Array.isArray(scopes) ? scopes : [];
      const erreur = await validerService(service_role, listeScopes);
      if (erreur) return res.status(400).json({ error: erreur });
      const gen = generateKey();
      const r = await pool.query(
        `INSERT INTO api_keys (name, key_prefix, key_hash, scopes, service_role, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, key_prefix, scopes, service_role, active, expires_at, created_at`,
        [
          name,
          gen.prefix,
          gen.hash,
          listeScopes,
          service_role || null,
          expires_at || null,
          req.user.id,
        ]
      );
      // Journalisation (item 3.C-7) : création de clé API. On journalise UNIQUEMENT
      // le préfixe (identifiant public) — JAMAIS la clé en clair (gen.full).
      logActivity({
        userId: req.user.id, username: req.user.username, action: 'api_key_create',
        entityType: 'api_key', entityId: r.rows[0].id,
        details: {
          name: r.rows[0].name, key_prefix: r.rows[0].key_prefix, scopes: r.rows[0].scopes,
          service_role: r.rows[0].service_role || null,
        },
        ip: req.ip,
      });
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
    const fields = ['name', 'scopes', 'service_role', 'active', 'expires_at'];
    const updates = [];
    const params = [];
    // Le couple (rôle, scopes) se valide sur l'ÉTAT FINAL de la clé : modifier
    // les seuls scopes d'une clé de service ne doit pas pouvoir lui retirer en
    // silence ce qui la rend valide.
    if (req.body.service_role !== undefined || req.body.scopes !== undefined) {
      const avant = await pool.query('SELECT scopes, service_role FROM api_keys WHERE id = $1', [req.params.id]);
      if (avant.rows.length === 0) return res.status(404).json({ error: 'Clé non trouvée' });
      const roleFinal = req.body.service_role !== undefined ? req.body.service_role : avant.rows[0].service_role;
      const scopesFinal = req.body.scopes !== undefined
        ? (Array.isArray(req.body.scopes) ? req.body.scopes : [])
        : (avant.rows[0].scopes || []);
      const erreur = await validerService(roleFinal, scopesFinal);
      if (erreur) return res.status(400).json({ error: erreur });
    }
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        params.push(f === 'service_role' ? (req.body[f] || null) : req.body[f]);
        updates.push(`${f} = $${params.length}`);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Aucun champ' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE api_keys SET ${updates.join(', ')} WHERE id = $${params.length}
       RETURNING id, name, key_prefix, scopes, service_role, active, expires_at, last_used_at`,
      params
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Clé non trouvée' });
    // Journalisation (item 3.C-7) : modification de clé (dont activation/révocation).
    // Détails = champs modifiés (jamais de secret) + nouvel état actif si fourni.
    logActivity({
      userId: req.user.id, username: req.user.username, action: 'api_key_update',
      entityType: 'api_key', entityId: parseInt(req.params.id, 10) || null,
      details: {
        key_prefix: r.rows[0].key_prefix,
        fields: updates.map((u) => u.split(' = ')[0]),
        ...(req.body.active !== undefined ? { active: !!req.body.active } : {}),
      },
      ip: req.ip,
    });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[API-KEYS] update :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/admin/api-keys/:id
router.delete('/:id', async (req, res) => {
  try {
    // Récupère le préfixe AVANT suppression pour tracer QUELLE clé a été révoquée.
    const before = await pool.query('SELECT key_prefix, name FROM api_keys WHERE id = $1', [req.params.id]);
    await pool.query('DELETE FROM api_keys WHERE id = $1', [req.params.id]);
    // Journalisation (item 3.C-7) : révocation/suppression de clé API partenaire.
    logActivity({
      userId: req.user.id, username: req.user.username, action: 'api_key_delete',
      entityType: 'api_key', entityId: parseInt(req.params.id, 10) || null,
      details: before.rows[0] ? { name: before.rows[0].name, key_prefix: before.rows[0].key_prefix } : {},
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[API-KEYS] delete :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

/**
 * Habilitations par module — contrôle, par rôle, la visibilité des modules
 * (sections de 1er niveau de la sidebar).
 *
 * Modèle : DENY-overlay non destructif. Par défaut tout est autorisé (aucune
 * ligne = autorisé) ; l'ADMIN peut RETIRER l'accès d'un module à un rôle. Ça ne
 * peut jamais élargir les droits (le filtre par rôle du front s'applique en
 * plus), seulement restreindre — donc pas de risque d'escalade.
 *
 * L'ADMIN n'est JAMAIS restreint (anti-lockout : il garde l'accès à cette page).
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// module_key = `id` des sections de 1er niveau du NAV_TREE (frontend Layout.jsx)
const MODULE_CATALOG = [
  { key: 'accueil', label: 'Accueil' },
  { key: 'operations', label: 'Opérations (Collecte / Logistique)' },
  { key: 'tri', label: 'Tri' },
  { key: 'boutiques', label: 'Boutiques' },
  { key: 'vak', label: 'Vente au Kilo' },
  { key: 'rh', label: 'RH et Insertion' },
  { key: 'equipe', label: "Gestion d'équipe" },
  { key: 'analyse', label: 'Analyse & Finances' },
  { key: 'admin', label: 'Administration' },
];
const MODULE_KEYS = MODULE_CATALOG.map((m) => m.key);
// ADMIN volontairement absent : jamais restreignable.
const EDITABLE_ROLES = ['MANAGER', 'RH', 'COLLABORATEUR', 'AUTORITE', 'RESP_BTQ'];

router.use(authenticate);

// GET /api/permissions/my-modules — modules refusés au rôle du user courant.
// Accessible à TOUT utilisateur authentifié (la sidebar en a besoin).
router.get('/my-modules', async (req, res) => {
  try {
    if (req.user.role === 'ADMIN') return res.json({ denied: [] });
    const r = await pool.query(
      'SELECT module_key FROM role_module_access WHERE role = $1 AND allowed = false',
      [req.user.role]
    );
    res.json({ denied: r.rows.map((x) => x.module_key) });
  } catch (err) {
    console.error('[PERMISSIONS] my-modules :', err.message);
    res.json({ denied: [] }); // fail-open : ne bloque jamais la navigation
  }
});

// ── Administration de la matrice (ADMIN uniquement) ────────────────────────

router.get('/catalog', authorize('ADMIN'), (req, res) => {
  res.json({ modules: MODULE_CATALOG, roles: EDITABLE_ROLES });
});

// Matrice complète des habilitations (lignes explicitement enregistrées).
router.get('/matrix', authorize('ADMIN'), async (req, res) => {
  try {
    const r = await pool.query('SELECT role, module_key, allowed FROM role_module_access');
    res.json(r.rows);
  } catch (err) {
    console.error('[PERMISSIONS] matrix GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Upsert d'un lot de {role, module_key, allowed}.
router.put('/matrix', authorize('ADMIN'), async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries[] requis' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      if (!EDITABLE_ROLES.includes(e.role) || !MODULE_KEYS.includes(e.module_key)) continue;
      await client.query(
        `INSERT INTO role_module_access (role, module_key, allowed) VALUES ($1, $2, $3)
         ON CONFLICT (role, module_key) DO UPDATE SET allowed = $3, updated_at = NOW()`,
        [e.role, e.module_key, !!e.allowed]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Habilitations mises à jour' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[PERMISSIONS] matrix PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

module.exports = router;

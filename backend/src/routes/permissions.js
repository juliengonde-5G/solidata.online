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
const { authenticate, authorize, refreshCustomRoles, resolveBaseRole } = require('../middleware/auth');
const { logActivity } = require('../middleware/activity-logger');

// Rôles intégrés (labels affichés). ADMIN n'est jamais restreignable/duplicable.
// DPO / FINANCE / QHSE : rôles intégrés « parties prenantes » ajoutés en vague 2.
const BUILTIN_ROLES = {
  ADMIN: 'Administrateur', MANAGER: 'Manager', RH: 'Ressources Humaines',
  COLLABORATEUR: 'Collaborateur', AUTORITE: 'Autorité', RESP_BTQ: 'Responsable Boutique',
  DPO: 'Délégué à la protection des données (DPO)', FINANCE: 'Finance (consultation)', QHSE: 'QHSE',
};
// Rôles pouvant servir de base à un rôle personnalisé (jamais ADMIN → pas d'escalade).
const BASE_ROLES = ['MANAGER', 'RH', 'COLLABORATEUR', 'AUTORITE', 'RESP_BTQ', 'DPO', 'FINANCE', 'QHSE'];

// Génère une clé de rôle sûre et sans collision avec les rôles intégrés.
function slugRoleKey(label) {
  const base = 'CR_' + String(label || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return base === 'CR_' ? null : base;
}

// Liste tous les rôles assignables : intégrés + personnalisés (avec labels).
async function listAllRoles() {
  let custom = [];
  try {
    const r = await pool.query('SELECT role_key, label, base_role FROM custom_roles ORDER BY label');
    custom = r.rows.map((x) => ({ key: x.role_key, label: x.label, builtin: false, base_role: x.base_role }));
  } catch (_) { /* table absente */ }
  const builtin = Object.entries(BUILTIN_ROLES).map(([key, label]) => ({ key, label, builtin: true, base_role: key }));
  return [...builtin, ...custom];
}

// module_key = `id` des sections de 1er niveau du NAV_TREE (frontend Layout.jsx)
const MODULE_CATALOG = [
  { key: 'accueil', label: 'Accueil' },
  { key: 'operations', label: 'Opérations (Collecte / Logistique)' },
  { key: 'tri', label: 'Tri' },
  // Lot 4 : Boutiques + Vente au Kilo regroupés dans la section de 1er niveau
  // « Frip » (Layout.jsx, sous Administration). 'frip' masque les deux sous-
  // branches d'un coup ; 'boutiques'/'vak' restent au catalogue pour restreindre
  // UNE SEULE des deux sous-branches (rétrocompatibilité des lignes
  // role_module_access déjà enregistrées sur ces clés — le filtre récursif de
  // Layout.jsx honore l'id de n'importe quel nœud, plus seulement le 1er niveau).
  { key: 'frip', label: 'Frip (Boutiques & Vente au Kilo)' },
  { key: 'boutiques', label: 'Frip › Boutiques' },
  { key: 'vak', label: 'Frip › Vente au Kilo' },
  { key: 'rh', label: 'RH et Insertion' },
  { key: 'equipe', label: "Gestion d'équipe" },
  // Vague 2 : nouvelles sections de 1er niveau (Layout.jsx filtre sur section.id).
  // Présentes ici pour que la matrice d'habilitations puisse aussi les masquer
  // (DENY-overlay : absence de ligne = autorisé, donc aucun impact par défaut).
  { key: 'qhse', label: 'QHSE' },
  { key: 'audit', label: 'Audit & conformité (auditeur AUTORITE)' },
  { key: 'analyse', label: 'Analyse & Finances' },
  // RSEI-10 : module « Pilotage RSE » (28e module). Ajouté au catalogue pour que
  // /admin/permissions puisse l'accorder/masquer par rôle — notamment au rôle
  // personnalisé REF_RSE (dupliqué de MANAGER, restreint à ce module).
  { key: 'rse', label: 'Pilotage RSE' },
  // RSEI-11 : module « Énergie & GES » (29e module). Ajouté au catalogue pour que
  // /admin/permissions puisse l'accorder/masquer par rôle (notamment au référent
  // RSE et au QHSE).
  { key: 'energie', label: 'Énergie & GES' },
  // RSEI-13 : module « Enquêtes » (30e module) — moteur de questionnaires anonymes.
  // Ajouté au catalogue pour l'accorder/masquer par rôle (REF_RSE, QHSE pour QVCT).
  { key: 'enquetes', label: 'Enquêtes' },
  // RSEI-17 : module « Achats responsables » (31e module) — référentiel fournisseurs,
  // critères d'achat, registre des FDS. Accordable/masquable par rôle (REF_RSE, QHSE).
  { key: 'achats', label: 'Achats responsables' },
  // Module 33 : « Temps & Présence » (badgeuse). Clé d'habilitation propre —
  // le module 25 « Pointage » legacy garde la sienne (ADR-0003).
  { key: 'badgeuse', label: 'Temps & Présence (badgeuse)' },
  { key: 'admin', label: 'Administration' },
];
const MODULE_KEYS = MODULE_CATALOG.map((m) => m.key);

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

router.get('/catalog', authorize('ADMIN'), async (req, res) => {
  const roles = (await listAllRoles()).filter((r) => r.key !== 'ADMIN'); // ADMIN jamais restreint
  res.json({ modules: MODULE_CATALOG, roles });
});

// Tous les rôles assignables (intégrés + personnalisés) — pour les listes déroulantes.
router.get('/roles', authorize('ADMIN'), async (req, res) => {
  res.json({ roles: await listAllRoles(), baseRoles: BASE_ROLES.map((k) => ({ key: k, label: BUILTIN_ROLES[k] })) });
});

// Dupliquer un rôle : crée un rôle personnalisé qui hérite des accès du rôle
// source (son rôle de base) et copie ses habilitations module comme point de départ.
router.post('/roles', authorize('ADMIN'), async (req, res) => {
  try {
    const { label, source_role } = req.body;
    if (!label || !label.trim()) return res.status(400).json({ error: 'Nom du rôle requis' });
    if (source_role === 'ADMIN') return res.status(400).json({ error: "Le rôle Administrateur ne peut pas être dupliqué." });

    const all = await listAllRoles();
    const source = all.find((r) => r.key === source_role);
    if (!source) return res.status(400).json({ error: 'Rôle source inconnu' });

    const baseRole = source.base_role || source.key; // rôle intégré effectif
    if (!BASE_ROLES.includes(baseRole)) return res.status(400).json({ error: 'Rôle de base invalide' });

    const roleKey = slugRoleKey(label);
    if (!roleKey) return res.status(400).json({ error: 'Nom de rôle invalide' });
    if (BUILTIN_ROLES[roleKey] || all.some((r) => r.key === roleKey)) {
      return res.status(409).json({ error: 'Un rôle avec un nom équivalent existe déjà' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO custom_roles (role_key, label, base_role) VALUES ($1, $2, $3)',
        [roleKey, label.trim(), baseRole]
      );
      // Copie des habilitations module du rôle source (point de départ).
      await client.query(
        `INSERT INTO role_module_access (role, module_key, allowed)
         SELECT $1, module_key, allowed FROM role_module_access WHERE role = $2
         ON CONFLICT (role, module_key) DO NOTHING`,
        [roleKey, source_role]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    await refreshCustomRoles(); // prise en compte immédiate par authorize
    // Journalisation (item 3.C-7) : création/duplication de rôle = action sensible.
    logActivity({
      userId: req.user.id, username: req.user.username, action: 'role_create',
      entityType: 'custom_role',
      details: { role_key: roleKey, label: label.trim(), base_role: baseRole, source_role },
      ip: req.ip,
    });
    res.status(201).json({ key: roleKey, label: label.trim(), base_role: baseRole, builtin: false });
  } catch (err) {
    console.error('[PERMISSIONS] create role :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Supprimer un rôle personnalisé : les utilisateurs qui l'ont sont réaffectés à
// son rôle de base (ils gardent un accès cohérent), puis nettoyage.
router.delete('/roles/:key', authorize('ADMIN'), async (req, res) => {
  try {
    const key = req.params.key;
    const cr = await pool.query('SELECT base_role FROM custom_roles WHERE role_key = $1', [key]);
    if (cr.rows.length === 0) return res.status(404).json({ error: 'Rôle personnalisé non trouvé' });
    const baseRole = cr.rows[0].base_role;

    const client = await pool.connect();
    let reassigned = 0;
    try {
      await client.query('BEGIN');
      const r = await client.query('UPDATE users SET role = $1, updated_at = NOW() WHERE role = $2 RETURNING id', [baseRole, key]);
      reassigned = r.rows.length;
      await client.query('DELETE FROM role_module_access WHERE role = $1', [key]);
      await client.query('DELETE FROM custom_roles WHERE role_key = $1', [key]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    await refreshCustomRoles();
    // Journalisation (item 3.C-7) : suppression de rôle (+ réaffectation d'utilisateurs).
    logActivity({
      userId: req.user.id, username: req.user.username, action: 'role_delete',
      entityType: 'custom_role',
      details: { role_key: key, base_role: baseRole, reassigned },
      ip: req.ip,
    });
    res.json({ message: `Rôle supprimé.${reassigned ? ` ${reassigned} utilisateur(s) réaffecté(s) au rôle « ${BUILTIN_ROLES[baseRole] || baseRole} ».` : ''}`, reassigned });
  } catch (err) {
    console.error('[PERMISSIONS] delete role :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
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
  // Rôles restreignables = tous sauf ADMIN (intégrés + personnalisés).
  const validRoles = new Set((await listAllRoles()).filter((r) => r.key !== 'ADMIN').map((r) => r.key));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const applied = [];
    for (const e of entries) {
      if (!validRoles.has(e.role) || !MODULE_KEYS.includes(e.module_key)) continue;
      await client.query(
        `INSERT INTO role_module_access (role, module_key, allowed) VALUES ($1, $2, $3)
         ON CONFLICT (role, module_key) DO UPDATE SET allowed = $3, updated_at = NOW()`,
        [e.role, e.module_key, !!e.allowed]
      );
      applied.push({ role: e.role, module_key: e.module_key, allowed: !!e.allowed });
    }
    await client.query('COMMIT');
    // Journalisation (item 3.C-7) : modification de la matrice d'habilitations.
    logActivity({
      userId: req.user.id, username: req.user.username, action: 'permissions_matrix_update',
      entityType: 'role_module_access',
      details: { count: applied.length, roles: [...new Set(applied.map((a) => a.role))], changes: applied.slice(0, 100) },
      ip: req.ip,
    });
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

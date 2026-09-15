/**
 * Habilitations par module — contrôle, par rôle, la visibilité ET l'accès aux
 * modules (sections de la sidebar).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * MODÈLE À TROIS ÉTATS (2.56.0). Jusqu'ici la matrice était un DENY-overlay
 * pur : elle ne pouvait que RETIRER. Le retrait des profils MANAGER/QHSE/
 * FINANCE (2.52.0) a resserré 44 entrées de la barre latérale sur le seul
 * ADMIN — plus aucun profil assignable, ni aucun rôle personnalisé (borné aux
 * droits de son rôle de base), ne pouvait recevoir la Collecte, le Tri,
 * l'Analyse ou la Frip. Les donner supposait de donner ADMIN, donc aussi les
 * comptes utilisateurs, la base de données et le registre RGPD. La matrice sait
 * désormais AJOUTER un module à un rôle :
 *
 *   REFUSÉ     (allowed = false)                     retire le module au rôle
 *   PAR DÉFAUT (allowed = true,  grant_access=false) le rôle décide seul
 *   ACCORDÉ    (allowed = true,  grant_access=true)  ajoute le module au rôle
 *
 * « Par défaut » est l'état de toutes les lignes existantes : la migration
 * n'accorde rien (cf. init-db.js), le comportement au déploiement est inchangé.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * UN ACCORD OUVRE VRAIMENT LA PORTE. `authorize()` (middleware/auth.js) le
 * consulte via la carte routeur → module (utils/module-routes.js) : sans cela,
 * accorder n'aurait ajouté qu'un lien dans la barre latérale vers une API qui
 * répond 403 — une promesse d'habilitation que le serveur dément.
 *
 * DEUX BORNES. L'ADMIN n'est JAMAIS restreint (anti-lockout : il tient cette
 * page). Et l'« Administration » n'est jamais ACCORDABLE
 * (utils/module-routes.js MODULES_NON_ACCORDABLES) : elle commande les comptes,
 * la base de données et cette matrice même — l'accorder d'une case à cocher
 * fabriquerait un administrateur en silence. Elle reste refusable.
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize, refreshCustomRoles, resolveBaseRole } = require('../middleware/auth');
const { refreshModuleAccess } = require('../middleware/module-access');
const { MODULES_NON_ACCORDABLES } = require('../utils/module-routes');
const { requireMfa } = require('../middleware/mfa');
const { logActivity } = require('../middleware/activity-logger');

// Rôles intégrés (labels affichés). ADMIN n'est jamais restreignable/duplicable.
// MANAGER / QHSE / FINANCE retirés le 10/09/2026 (demande client) : ils ne sont
// plus proposés ici, donc plus assignables ni duplicables. La source unique de
// la liste reste utils/roles.js.
const BUILTIN_ROLES = {
  ADMIN: 'Administrateur', RH: 'Ressources Humaines',
  COLLABORATEUR: 'Collaborateur', AUTORITE: 'Autorité', RESP_BTQ: 'Responsable Boutique',
  DPO: 'Délégué à la protection des données (DPO)',
  // Praticien PCM : fait passer les tests de personnalité et restitue les
  // profils, SANS accès au dossier de recrutement (CV, entretiens) ni au
  // reste des RH (contrats, salaires, parcours d'insertion).
  PCM: 'Praticien PCM',
  // Chargé de communication : tableau de bord, fil d'actualité et diffusion des
  // contenus sur l'écran du poste de pointage. Aucune donnée de personnel.
  COMMUNICATION: 'Chargé de communication',
};
// Rôles pouvant servir de base à un rôle personnalisé (jamais ADMIN → pas d'escalade).
const BASE_ROLES = ['RH', 'COLLABORATEUR', 'AUTORITE', 'RESP_BTQ', 'DPO', 'PCM', 'COMMUNICATION'];

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
  // Étiquettes (demande client du 10/09/2026) : habilitation PROPRE, distincte
  // de la section « Tri » qui la contient — retirer les étiquettes à un rôle ne
  // doit pas lui retirer du même geste la feuille de production, la chaîne, le
  // configurateur et le référentiel. Même mécanique que 'boutiques'/'vak' sous
  // 'frip' : le filtre récursif de Layout.jsx honore l'id de n'importe quel
  // nœud, donc 'tri' masque toute la section et 'etiquettes' cette seule entrée.
  //
  // C'est aussi la PREMIÈRE clé du catalogue à être appliquée CÔTÉ SERVEUR
  // (middleware/module-access.js, posé sur les routes que sert l'écran) : ici,
  // décocher retire l'accès et pas seulement le lien. Les autres clés gardent
  // leur portée historique — masquage de la barre latérale — tant qu'on ne les
  // a pas instrumentées une par une.
  { key: 'etiquettes', label: 'Tri › Étiquettes' },
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
  { key: 'pcm', label: 'Tests PCM (praticien)' },
  { key: 'equipe', label: "Gestion d'équipe" },
  // Vague 2 : nouvelles sections de 1er niveau (Layout.jsx filtre sur section.id).
  // Présentes ici pour que la matrice d'habilitations puisse aussi les masquer
  // (DENY-overlay : absence de ligne = autorisé, donc aucun impact par défaut).
  { key: 'qhse', label: 'QHSE' },
  { key: 'audit', label: 'Audit & conformité (auditeur AUTORITE)' },
  { key: 'analyse', label: 'Analyse & Finances' },
  // RSEI-10 : module « Pilotage RSE » (28e module). Ajouté au catalogue pour que
  // /admin/permissions puisse l'accorder/masquer par rôle — notamment au rôle
  // personnalisé REF_RSE (à redupliquer depuis RH depuis le retrait de MANAGER).
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
  // Messagerie interne (chantier 26/08). La section existait dans Layout.jsx
  // avec l'id 'messagerie' mais MANQUAIT ici : elle était donc la SEULE de la
  // barre latérale qu'un ADMIN ne pouvait pas masquer — le garde-fou de
  // l'application ne s'y appliquait pas. Le périmètre de participation reste
  // contrôlé côté serveur (routes/messages.js) ; cette clé permet en plus de
  // retirer complètement l'accès à un rôle, comme pour tout autre module.
  { key: 'messagerie', label: 'Messagerie interne' },
  { key: 'admin', label: 'Administration' },
];
const MODULE_KEYS = MODULE_CATALOG.map((m) => m.key);

router.use(authenticate);

// GET /api/permissions/my-modules — modules refusés au rôle du user courant.
// Accessible à TOUT utilisateur authentifié (la sidebar en a besoin).
router.get('/my-modules', async (req, res) => {
  try {
    // L'ADMIN voit tout et n'a besoin d'aucun accord : la matrice ne le concerne
    // pas (anti-lockout).
    if (req.user.role === 'ADMIN') return res.json({ denied: [], granted: [] });
    // Rôle BRUT, comme la garde serveur (middleware/module-access.js règle 2) :
    // l'écran et la porte doivent répondre la même chose.
    const r = await pool.query(
      `SELECT module_key, allowed, grant_access
         FROM role_module_access
        WHERE role = $1 AND (allowed = false OR grant_access = true)`,
      [req.user.role]
    );
    const denied = r.rows.filter((x) => x.allowed === false).map((x) => x.module_key);
    // Un module refusé ne peut pas être simultanément accordé (la requête
    // n'écrit jamais les deux), mais on l'exclut explicitement : si une ligne
    // incohérente existait, le REFUS doit primer.
    const granted = r.rows
      .filter((x) => x.allowed === true && x.grant_access === true)
      .map((x) => x.module_key)
      .filter((k) => !denied.includes(k) && !MODULES_NON_ACCORDABLES.has(k));
    res.json({ denied, granted });
  } catch (err) {
    console.error('[PERMISSIONS] my-modules :', err.message);
    // Dégradation ASYMÉTRIQUE, alignée sur la garde serveur : on n'interdit
    // rien (la navigation n'est jamais bloquée par un incident de base) et on
    // n'accorde rien (un accord ne se présume pas). L'utilisateur retrouve
    // exactement les droits de son rôle.
    res.json({ denied: [], granted: [] });
  }
});

// ── Administration de la matrice (ADMIN uniquement) ────────────────────────

router.get('/catalog', authorize('ADMIN'), async (req, res) => {
  const roles = (await listAllRoles()).filter((r) => r.key !== 'ADMIN'); // ADMIN jamais restreint
  // `grantable` dit à l'écran quelles cases peuvent porter un ACCORD. Calculé
  // ici plutôt que recopié côté web : la borne est une règle de sécurité, elle
  // n'a qu'un seul propriétaire (utils/module-routes.js). L'écran s'en sert pour
  // ne pas proposer un état que le serveur refusera d'enregistrer.
  const modules = MODULE_CATALOG.map((m) => ({ ...m, grantable: !MODULES_NON_ACCORDABLES.has(m.key) }));
  res.json({ modules, roles });
});

// Double authentification (2.43.0) — à partir d'ici, l'administration de la
// matrice exige une session ayant franchi le défi TOTP (no-op hors périmètre).
//
// DÉLIBÉRÉMENT EN AVAL de `/my-modules` et `/catalog` : `/my-modules` est appelé
// par le front DÈS la connexion, avant tout enrôlement — le fermer renverrait un
// 403 en pleine ouverture de session et casserait la navigation d'un compte qui
// n'a pas encore pu s'enrôler. Ces deux routes ne renvoient d'ailleurs aucune
// donnée personnelle : des clés de modules et des libellés de rôles.
router.use(requireMfa);

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
    const r = await pool.query('SELECT role, module_key, allowed, grant_access FROM role_module_access');
    res.json(r.rows);
  } catch (err) {
    console.error('[PERMISSIONS] matrix GET :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * État d'une case de la matrice, à partir de ce qu'envoie le client.
 *
 * Accepte la forme à TROIS ÉTATS (`state`) et, en repli, l'ancienne forme
 * booléenne (`allowed`) — un client pas encore à jour continue de fonctionner,
 * et ne peut alors que refuser ou remettre par défaut, jamais accorder.
 */
function lireEtat(e) {
  const brut = typeof e.state === 'string' ? e.state : (e.allowed === false ? 'denied' : 'default');
  return ['denied', 'default', 'granted'].includes(brut) ? brut : 'default';
}

// Upsert d'un lot de {role, module_key, state} (ou {allowed} — forme héritée).
router.put('/matrix', authorize('ADMIN'), async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries[] requis' });
  // Rôles restreignables = tous sauf ADMIN (intégrés + personnalisés).
  const validRoles = new Set((await listAllRoles()).filter((r) => r.key !== 'ADMIN').map((r) => r.key));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const applied = [];
    const refuses = []; // accords impossibles, RENDUS à l'appelant (jamais tus)
    for (const e of entries) {
      if (!validRoles.has(e.role) || !MODULE_KEYS.includes(e.module_key)) continue;
      let etat = lireEtat(e);
      // Borne : l'administration du logiciel ne s'accorde pas d'une case à
      // cocher (cf. en-tête). On ne rejette pas tout le lot pour autant — la
      // case retombe « par défaut » et l'écran le DIT, plutôt que d'enregistrer
      // en silence un accord qui n'ouvrirait rien côté serveur.
      if (etat === 'granted' && MODULES_NON_ACCORDABLES.has(e.module_key)) {
        etat = 'default';
        refuses.push({ role: e.role, module_key: e.module_key, motif: 'MODULE_NON_ACCORDABLE' });
      }
      const allowed = etat !== 'denied';
      const grant = etat === 'granted';
      await client.query(
        `INSERT INTO role_module_access (role, module_key, allowed, grant_access) VALUES ($1, $2, $3, $4)
         ON CONFLICT (role, module_key) DO UPDATE SET allowed = $3, grant_access = $4, updated_at = NOW()`,
        [e.role, e.module_key, allowed, grant]
      );
      applied.push({ role: e.role, module_key: e.module_key, state: etat });
    }
    await client.query('COMMIT');
    // Prise en compte IMMÉDIATE par la garde serveur (middleware/module-access) :
    // un module retiré doit fermer la porte tout de suite, pas au prochain
    // rafraîchissement de son cache.
    refreshModuleAccess();
    // Journalisation (item 3.C-7) : modification de la matrice d'habilitations.
    logActivity({
      userId: req.user.id, username: req.user.username, action: 'permissions_matrix_update',
      entityType: 'role_module_access',
      details: {
        count: applied.length,
        roles: [...new Set(applied.map((a) => a.role))],
        // Les accords sont la nouveauté sensible du lot : on les isole dans la
        // trace pour qu'une revue puisse répondre « qui a ouvert quoi, quand »
        // sans relire tout le lot.
        accords: applied.filter((a) => a.state === 'granted'),
        refus: applied.filter((a) => a.state === 'denied'),
        accords_refuses: refuses,
        changes: applied.slice(0, 100),
      },
      ip: req.ip,
    });
    res.json({
      message: 'Habilitations mises à jour',
      refuses,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[PERMISSIONS] matrix PUT :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

module.exports = router;

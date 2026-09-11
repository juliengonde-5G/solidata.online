/**
 * Habilitation par module — garde SERVEUR de la matrice `/admin/permissions`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 *
 * La matrice d'habilitations (routes/permissions.js) est un DENY-overlay :
 * absence de ligne = autorisé, l'ADMIN y RETIRE des modules à un rôle. Jusqu'ici
 * elle ne faisait qu'une chose — masquer la barre latérale (Layout.jsx). Elle ne
 * fermait AUCUNE route d'API, et c'est écrit noir sur blanc dans l'en-tête de
 * cette page depuis la 2.4.0. Conséquence : décocher un module retirait le lien,
 * pas l'accès — l'URL tapée à la main marchait encore, et l'appel HTTP direct
 * aussi. Un exploitant qui décoche croit avoir retiré une habilitation ; il n'a
 * retiré qu'un raccourci.
 *
 * Ce middleware rend la case à cocher VRAIE pour les modules qui l'utilisent :
 * le refus est posé côté serveur, AVANT le handler, donc avant toute lecture en
 * base. Il ne se substitue pas à `authorize()` — il s'y AJOUTE : le rôle décide
 * qui peut voir le module, la matrice décide si ce rôle-là l'a encore.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TROIS RÈGLES, ET LEURS RAISONS
 *
 * 1. L'ADMIN N'EST JAMAIS RESTREINT. Même règle que la matrice elle-même
 *    (anti-lockout : c'est lui qui tient la page des habilitations ; s'il
 *    pouvait se retirer un module, il pourrait se retirer celui qui le lui
 *    rendrait).
 *
 * 2. LE RÔLE LU EST LE RÔLE BRUT, PAS SON RÔLE DE BASE. C'est délibérément
 *    différent d'`authorize()`. La matrice stocke une ligne PAR CLÉ DE RÔLE,
 *    rôles personnalisés compris (la duplication recopie les lignes du rôle
 *    source), et `GET /permissions/my-modules` — qui alimente la barre latérale —
 *    interroge lui aussi la clé brute. Résoudre vers le rôle de base ici ferait
 *    diverger l'écran et le serveur : un rôle dupliqué verrait un lien que
 *    l'API lui refuse, ou l'inverse. La barre latérale et la porte doivent
 *    répondre la même chose.
 *
 * 3. UNE PANNE DE BASE LAISSE PASSER, ET LE DIT. Le choix se discute, donc il
 *    est motivé : la matrice ne DONNE aucun droit, elle en RETIRE. Quand elle
 *    est illisible, retomber sur « rôle seul » rend exactement le comportement
 *    d'avant ce middleware — jamais plus. Fermer à la place fermerait l'atelier
 *    entier sur un incident de connexion, pour protéger une restriction de
 *    confort. L'incident est journalisé (`console.warn`), il ne passe pas sous
 *    silence.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CACHE — la table est minuscule et lue à chaque requête d'un routeur gardé :
 * une lecture par appel serait gratuite. TTL court (30 s), et surtout
 * invalidation EXPLICITE (`refreshModuleAccess`) appelée par l'enregistrement de
 * la matrice : un ADMIN qui retire une habilitation doit la voir prendre effet
 * tout de suite, pas « dans la demi-minute ».
 */
const pool = require('../config/database');

const CACHE_TTL_MS = 30 * 1000;

// Map<role, Set<module_key>> des REFUS explicites (allowed = false).
let cachedRefus = null;
let cachedAt = 0;

/** Recharge le cache au prochain appel (après enregistrement de la matrice). */
function refreshModuleAccess() {
  cachedRefus = null;
  cachedAt = 0;
}

/**
 * Refus explicites, par rôle. Lève si la base est injoignable — l'appelant
 * décide quoi en faire (cf. règle 3).
 * @returns {Promise<Map<string, Set<string>>>}
 */
async function chargerRefus() {
  if (cachedRefus && Date.now() - cachedAt < CACHE_TTL_MS) return cachedRefus;
  const r = await pool.query(
    'SELECT role, module_key FROM role_module_access WHERE allowed = false'
  );
  const map = new Map();
  for (const row of r.rows) {
    if (!map.has(row.role)) map.set(row.role, new Set());
    map.get(row.role).add(row.module_key);
  }
  cachedRefus = map;
  cachedAt = Date.now();
  return map;
}

/**
 * Middleware : refuse (403) si le module est explicitement retiré au rôle de
 * l'appelant dans la matrice d'habilitations.
 *
 * Se pose APRÈS `authenticate` et à côté d'`authorize(...)` — l'ordre entre les
 * deux n'a pas d'importance fonctionnelle (les deux refusent avant le handler),
 * mais garder `authorize` en premier donne le message d'erreur le plus juste :
 * « ce rôle n'y a pas accès » prime sur « ce rôle ne l'a plus ».
 *
 * @param {string} moduleKey clé du catalogue (routes/permissions.js)
 */
function requireModule(moduleKey) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (req.user.role === 'ADMIN') return next(); // règle 1

    try {
      const refus = await chargerRefus();
      const refusesDuRole = refus.get(req.user.role); // règle 2 : rôle BRUT
      if (refusesDuRole && refusesDuRole.has(moduleKey)) {
        return res.status(403).json({
          error: "Ce module ne fait pas partie de vos habilitations. Rapprochez-vous d'un administrateur.",
          code: 'MODULE_NON_HABILITE',
          module: moduleKey,
        });
      }
    } catch (err) {
      // Règle 3 : dégradation vers « rôle seul », jamais silencieuse.
      console.warn(`[HABILITATIONS] matrice illisible (${err.message}) — module « ${moduleKey} » laissé au contrôle de rôle`);
    }
    return next();
  };
}

module.exports = { requireModule, refreshModuleAccess };

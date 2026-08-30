/**
 * Double authentification (MFA/TOTP) — garde d'accès aux surfaces sensibles.
 * Chantier 2.43.0.
 *
 * PRINCIPE — le jeton d'accès porte un claim `mfa` (true|false) posé à
 * l'émission (routes/auth.js) :
 *   - `true`  : la session a franchi le défi TOTP, OU le rôle n'est pas soumis
 *               à la double authentification (le claim est alors posé à true
 *               d'office, pour que ce middleware et le contrôle Socket.IO
 *               restent une simple comparaison, sans cas particulier) ;
 *   - `false` : compte soumis à la double authentification mais PAS ENCORE
 *               enrôlé (il vient de se connecter, l'écran d'enrôlement le
 *               bloque côté front — mais c'est ICI que la fermeture est réelle).
 *
 * QUI EST SOUMIS — liste paramétrable dans `settings`, clé
 * « securite.mfa_roles » (tableau JSON de rôles de BASE), défaut EN CODE
 * ['ADMIN','RH','DPO'] : les rôles qui accèdent à des données personnelles
 * sensibles (parcours d'insertion, santé, judiciaire, registre RGPD,
 * sauvegarde de la base). Comme partout dans le projet, aucun seed en base :
 * la valeur par défaut vit dans le code et la table ne sert qu'à la surcharger.
 *
 * MANAGER n'est délibérément PAS soumis (encadrants de terrain, surfaces déjà
 * masquées) ; les chauffeurs (jetons `driver-start`, rôle COLLABORATEUR en dur)
 * et les jobs du scheduler ne passent jamais par ici. Le rôle PCM (Praticien)
 * a été RETIRÉ du périmètre par arbitrage client (2.43.0) : il fait passer des
 * tests, sans accès au dossier de recrutement ni au parcours d'insertion. Le
 * routeur /api/pcm reste gardé — un ADMIN ou un RH qui l'emprunte est, lui,
 * toujours soumis.
 *
 * ROLES PERSONNALISÉS : un rôle dupliqué est soumis si SON RÔLE DE BASE l'est
 * (resolveBaseRole) — sans quoi dupliquer « RH » suffirait à contourner la
 * double authentification.
 *
 * JETON HÉRITÉ (émis avant ce déploiement, donc sans claim `mfa`) d'un rôle
 * soumis → BLOQUÉ (403 MFA_REQUIRED). C'est un écart ASSUMÉ avec la doctrine de
 * dégradation douce des jetons sans `tv` : ici, laisser passer reviendrait à
 * offrir jusqu'à 8 h de contournement de la fonctionnalité qu'on installe.
 * L'utilisateur se reconnecte, et c'est tout.
 *
 * OÙ CE MIDDLEWARE EST CÂBLÉ (une ligne après le `authenticate` de chaque
 * routeur ciblé — il a besoin de `req.user`) :
 *   /api/insertion, /api/pcm, /api/employees, /api/candidates, /api/exports,
 *   /api/rgpd, /api/users, /api/permissions (administration de la matrice
 *   seulement — `/my-modules` et `/catalog` restent ouverts, le premier étant
 *   chargé par le front DÈS la connexion, avant tout enrôlement),
 *   /api/admin-db, /api/activity-log, /api/effectifs.
 * Plus le handshake Socket.IO (backend/src/index.js) : sans lui, une session
 * non enrôlée garderait le flux temps réel (messagerie) ouvert.
 *
 * Pour les rôles NON soumis, tout ceci est un no-op intégral : aucune
 * régression attendue sur MANAGER / AUTORITE / QHSE / FINANCE / RESP_BTQ…
 */
const pool = require('../config/database');
const { resolveBaseRole } = require('./auth');

// Défaut EN CODE (aucun seed en base) — cf. en-tête.
const DEFAULT_MFA_ROLES = ['ADMIN', 'RH', 'DPO'];
const SETTING_KEY = 'securite.mfa_roles';
const CACHE_TTL_MS = 60 * 1000;

/**
 * DURÉE DE VALIDITÉ D'UN SECOND FACTEUR (heures).
 *
 * Le second facteur se périme : passé ce délai, la session doit le présenter à
 * nouveau, même si son jeton de renouvellement est encore valide. Sans cela,
 * une vérification TOTP faite une fois ouvrait l'accès aux données sensibles
 * pendant TOUTE la vie de la chaîne de renouvellement — 7 jours — alors que
 * c'est précisément la fraîcheur de cette preuve qui fait sa valeur : un poste
 * laissé ouvert, un jeton dérobé, un départ de l'organisation gardaient une
 * session complète une semaine durant.
 *
 * Défaut EN CODE (aucun seed en base), surchargeable par `settings` clé
 * « securite.mfa_duree_heures ». Bornée : en dessous d'une heure la
 * fonctionnalité deviendrait une gêne permanente et pousserait à la désactiver,
 * au-delà d'une semaine elle ne renouvellerait plus rien (la chaîne de
 * renouvellement expire d'elle-même à 7 jours).
 */
const DEFAULT_MFA_DUREE_HEURES = 24;
const SETTING_DUREE = 'securite.mfa_duree_heures';
const DUREE_MIN_HEURES = 1;
const DUREE_MAX_HEURES = 168;

// Cache mémoire : la liste est lue à chaque requête authentifiée d'un routeur
// sensible, une lecture base par appel serait gratuite. 60 s = le même ordre de
// grandeur que le cache des rôles personnalisés (middleware/auth.js).
let cachedRoles = DEFAULT_MFA_ROLES.slice();
let cachedAt = 0;
let cachedDuree = DEFAULT_MFA_DUREE_HEURES;

/** Normalise une valeur de settings en liste de rôles exploitable. */
function parseRoles(raw) {
  if (raw == null || raw === '') return null;
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const roles = parsed
    .map((r) => (typeof r === 'string' ? r.trim().toUpperCase() : null))
    .filter((r) => r);
  // Une liste VIDE est une valeur légitime (« plus personne n'est soumis »),
  // mais elle désarme la fonctionnalité entière : on l'accepte, en le disant.
  if (roles.length === 0) {
    console.warn(`[MFA] Réglage ${SETTING_KEY} vide — plus aucun rôle n'est soumis à la double authentification`);
  }
  return roles;
}

/**
 * Liste des rôles de base soumis à la double authentification.
 * Résiliente : table absente, valeur illisible, panne base → défaut en code
 * (jamais de désactivation accidentelle de la sécurité par un incident base).
 * @returns {Promise<string[]>}
 */
async function getMfaRoles() {
  if (Date.now() - cachedAt < CACHE_TTL_MS) return cachedRoles;
  try {
    // Les deux réglages sont lus ENSEMBLE : ils partagent le même cache et la
    // même fenêtre de rafraîchissement, une seconde requête serait gratuite.
    const r = await pool.query('SELECT key, value FROM settings WHERE key = ANY($1)',
      [[SETTING_KEY, SETTING_DUREE]]);
    const parLigne = Object.fromEntries(r.rows.map((row) => [row.key, row.value]));
    const roles = parseRoles(parLigne[SETTING_KEY]);
    cachedRoles = roles === null ? DEFAULT_MFA_ROLES.slice() : roles;
    const duree = parseDuree(parLigne[SETTING_DUREE]);
    cachedDuree = duree === null ? DEFAULT_MFA_DUREE_HEURES : duree;
  } catch (_) {
    cachedRoles = DEFAULT_MFA_ROLES.slice();
    cachedDuree = DEFAULT_MFA_DUREE_HEURES;
  }
  cachedAt = Date.now();
  return cachedRoles;
}

/**
 * Durée de validité d'un second facteur, en heures. Fonction PURE de lecture
 * d'un réglage : une valeur illisible, absente ou hors bornes retombe sur le
 * défaut en code — jamais sur 0, qui périmerait toutes les sessions à la
 * seconde, ni sur l'infini, qui désarmerait le renouvellement en silence.
 */
function parseDuree(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  if (n < DUREE_MIN_HEURES || n > DUREE_MAX_HEURES) {
    console.warn(`[MFA] Réglage ${SETTING_DUREE} hors bornes (${n} h) — défaut ${DEFAULT_MFA_DUREE_HEURES} h appliqué`);
    return null;
  }
  return n;
}

/**
 * Durée de validité courante (heures). Même résilience que getMfaRoles :
 * un incident base ne doit pas pouvoir allonger la fenêtre.
 * @returns {Promise<number>}
 */
async function getMfaDureeHeures() {
  if (Date.now() - cachedAt < CACHE_TTL_MS) return cachedDuree;
  await getMfaRoles();          // rafraîchit le cache commun (rôles + durée)
  return cachedDuree;
}

/**
 * Le second facteur de cette session est-il PÉRIMÉ ? Fonction PURE.
 *
 * @param {number|null|undefined} mfaAt  claim `mfa_at` — instant de la
 *   vérification réelle du second facteur, en SECONDES epoch.
 * @param {number} dureeHeures  fenêtre de validité
 * @param {number} [maintenantMs]  horloge (injectée par les tests)
 * @returns {boolean}
 *
 * Un `mfa_at` ABSENT est traité comme périmé, et c'est délibéré : c'est le cas
 * d'un jeton émis avant ce déploiement, dont la vérification peut dater de six
 * jours (le claim `mfa` se propageait alors de renouvellement en
 * renouvellement). Le tenir pour frais rouvrirait, à l'installation même du
 * garde-fou, la fenêtre qu'il ferme. Les comptes concernés se reconnectent une
 * fois — même doctrine que les jetons hérités de la 2.43.0.
 *
 * Un `mfa_at` DANS LE FUTUR (horloges désynchronisées) est accepté : refuser
 * une session pour une dérive d'horloge serait une panne, pas une sécurité.
 */
function mfaExpiree(mfaAt, dureeHeures, maintenantMs = Date.now()) {
  if (mfaAt == null) return true;
  const t = Number(mfaAt);
  if (!Number.isFinite(t)) return true;
  const duree = Number.isFinite(Number(dureeHeures)) && Number(dureeHeures) > 0
    ? Number(dureeHeures) : DEFAULT_MFA_DUREE_HEURES;
  const ageMs = maintenantMs - t * 1000;
  return ageMs > duree * 3600 * 1000;
}

/**
 * Version SYNCHRONE de la péremption, sur le cache — pour les points d'appel
 * qui ne peuvent pas attendre une lecture base (handshake Socket.IO).
 * @param {object} decoded charge utile du jeton (claims `mfa` et `mfa_at`)
 */
function mfaSessionExpiree(decoded) {
  return mfaExpiree(decoded && decoded.mfa_at, cachedDuree);
}

/**
 * Version SYNCHRONE, sur le cache — pour les points d'appel qui ne peuvent pas
 * attendre une lecture base (handshake Socket.IO, composition de /auth/me).
 * Le cache est amorcé au défaut en code puis rafraîchi par getMfaRoles().
 * @param {string} role rôle brut du jeton (intégré ou personnalisé)
 * @returns {boolean}
 */
function isMfaRole(role) {
  if (!role) return false;
  const base = resolveBaseRole(role);
  return cachedRoles.includes(base);
}

// Amorce + rafraîchissement périodique du cache (même schéma que le cache des
// rôles personnalisés de middleware/auth.js). `unref` pour ne pas retenir le
// process (jobs, tests).
getMfaRoles().catch(() => { /* défaut en code déjà en place */ });
const _t = setInterval(() => { cachedAt = 0; getMfaRoles().catch(() => {}); }, CACHE_TTL_MS);
if (_t.unref) _t.unref();

/** Vide le cache — utilisé par les tests et après modification du réglage. */
function resetMfaRolesCache() {
  cachedRoles = DEFAULT_MFA_ROLES.slice();
  cachedDuree = DEFAULT_MFA_DUREE_HEURES;
  cachedAt = 0;
}

/**
 * Middleware — exige une session ayant franchi la double authentification pour
 * les rôles soumis. No-op pour les autres.
 * À monter APRÈS `authenticate` (il lit `req.user`).
 */
async function requireMfa(req, res, next) {
  // Même contrat que `authorize` : sans identité, il n'y a rien à vérifier et
  // ce middleware n'est pas là pour authentifier.
  if (!req.user) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  let roles;
  try {
    roles = await getMfaRoles();
  } catch (_) {
    roles = DEFAULT_MFA_ROLES;
  }
  const base = resolveBaseRole(req.user.role);
  if (!roles.includes(base)) return next();      // rôle hors périmètre

  // CLÉ D'API DE SERVICE (2.45.0) — hors de la fenêtre de renouvellement, et
  // c'est la suite du même raisonnement : la double authentification protège
  // des PERSONNES PHYSIQUES. Une clé n'a pas de téléphone, ne peut donc jamais
  // présenter de second facteur, et lui en réclamer un tous les jours
  // obligerait à ranger un secret TOTP à côté d'elle — exactement le défaut
  // que la 2.45.0 a corrigé en supprimant le compte ADMIN du smoke test.
  // Sa sûreté vient d'ailleurs : lecture seule STRUCTURELLE (refusée dans
  // `authenticate` lui-même), relue à chaque requête donc révocable
  // instantanément, expirable, et chaque appel tracé.
  // Sans cette sortie, le smoke test ferait échouer CHAQUE déploiement.
  if (req.user.is_service === true) return next();

  if (req.user.mfa !== true) {
    return res.status(403).json({
      error: 'Double authentification requise. Reconnectez-vous pour l\'activer.',
      code: 'MFA_REQUIRED',
    });
  }
  // Le défi a été franchi — reste à savoir QUAND. Au-delà de la fenêtre, la
  // preuve n'a plus la fraîcheur qui fait sa valeur : la session est renvoyée
  // au second facteur. Code DISTINCT de MFA_REQUIRED : ce n'est pas un compte à
  // enrôler, c'est une vérification à refaire — l'écran doit pouvoir le dire.
  let duree;
  try {
    duree = await getMfaDureeHeures();
  } catch (_) {
    duree = DEFAULT_MFA_DUREE_HEURES;
  }
  if (mfaExpiree(req.user.mfa_at, duree)) {
    return res.status(403).json({
      error: `Votre double authentification date de plus de ${duree} h. `
        + 'Reconnectez-vous pour la renouveler.',
      code: 'MFA_EXPIREE',
      duree_heures: duree,
    });
  }
  return next();
}

module.exports = {
  requireMfa,
  isMfaRole,
  getMfaRoles,
  getMfaDureeHeures,
  mfaExpiree,
  mfaSessionExpiree,
  resetMfaRolesCache,
  DEFAULT_MFA_ROLES,
  DEFAULT_MFA_DUREE_HEURES,
  SETTING_KEY,
  SETTING_DUREE,
};

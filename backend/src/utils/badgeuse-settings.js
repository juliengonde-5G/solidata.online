/**
 * Réglages du module « Temps & Présence » (badgeuse).
 *
 * DOCTRINE (ADR-0002) : AUCUNE règle de gestion RH n'est codée en dur. Toutes les
 * valeurs du §5.4 de la spec vivent dans la table `settings` (préfixe `badgeuse.`)
 * et sont éditables depuis le back-office (ADMIN/RH). Les défauts ci-dessous ne
 * sont pas des règles inventées par un agent : ce sont EXACTEMENT les
 * recommandations écrites du RH (NOTE_RH §3, colonne « Recommandation RH »).
 *
 * Tant qu'un ADMIN/RH n'a pas enregistré explicitement la grille, le marqueur
 * `badgeuse.regles_validees_le` reste vide et le back-office affiche « Règles par
 * défaut — à faire arbitrer par la Direction » : l'état non arbitré est visible,
 * jamais silencieux.
 *
 * Les durées de conservation (`badgeuse.retention_*`) ne sont PAS des règles de
 * gestion arbitrables : ce sont des exigences de conformité (NOTE_JURIDIQUE §3.7)
 * préremplies aux valeurs de la note juridique et appliquées par la purge (BO-10).
 * Les clés `badgeuse.supervision_*` ne le sont pas davantage : ce sont des
 * réglages d'EXPLOITATION (BO-09), paramétrés ici pour qu'aucun seuil ne reste
 * codé en dur (QA-11).
 *
 * PLAFOND CODÉ EN DUR ASSUMÉ : `overlay_duree_sec` est borné 3–8 s côté serveur.
 * Ce n'est pas une règle de gestion mais une EXIGENCE JURIDIQUE (NOTE_JURIDIQUE
 * §3.5 : durée d'affichage plafonnée à 8 s) — le poste re-borne de son côté
 * (double plafond). Une valeur hors bornes en base est ramenée dans les bornes.
 */
const pool = require('../config/database');

const BADGEUSE_SETTING_DEFAULTS = {
  // ── Règles de gestion RH (ADR-0002 §2 — NOTE_RH §3) ──
  'badgeuse.pointages_par_jour': 4,
  'badgeuse.arrondi_minutes': 5,
  'badgeuse.arrondi_sens': 'avantage_salarie',
  'badgeuse.tolerance_retard_minutes': 5,
  'badgeuse.badge_avant_heure_compte': false,
  'badgeuse.pause_deduite_minutes': 45,
  'badgeuse.pause_deduite_seuil_heures': 6,
  'badgeuse.journee_max_heures': 10,
  'badgeuse.plage_acceptation_debut': '05:00',
  'badgeuse.plage_acceptation_fin': '21:00',
  'badgeuse.affichage_cumul_hebdo': false,
  'badgeuse.overlay_duree_sec': 5,
  'badgeuse.anti_rebond_sec': 8,
  'badgeuse.regularisation_delai_jours': 5,
  // ── Cadences de synchronisation du poste (CONTRAT_API_DEVICE §2.3) ──
  'badgeuse.heartbeat_interval_sec': 60,
  'badgeuse.sync_badges_interval_sec': 300,
  'badgeuse.sync_playlist_interval_sec': 900,
  'badgeuse.dpms_extinction': '21:30',
  'badgeuse.dpms_allumage': '05:30',
  // ── Supervision des postes (BO-09 — EXPLOITATION, pas une règle RH) ──
  // Seuil de silence au-delà duquel un poste est déclaré hors ligne et
  // l'alerte e-mail part (QA-11 : il était codé en dur à 15 min dans le job).
  'badgeuse.supervision_silence_minutes': 15,
  // Destinataires de l'alerte, séparés par des virgules. VIDE = les
  // administrateurs actifs de SOLIDATA (repli documenté : l'exigence BO-09
  // « alerte e-mail » ne doit pas rester lettre morte faute de paramétrage).
  'badgeuse.supervision_alerte_emails': '',
  // ── Conservation (NOTE_JURIDIQUE §3.7 — conformité, non arbitrable) ──
  'badgeuse.retention_pointages_mois': 60,
  'badgeuse.retention_feuilles_mois': 60,
  'badgeuse.retention_badges_apres_restitution_jours': 90,
  'badgeuse.retention_contenus_apres_expiration_jours': 365,
  'badgeuse.retention_journal_acces_mois': 12,

  // ══ Écran d'information v2 (CDC_AFFICHAGE_V2, ADR-0004) ══
  //
  // GABARITS DE MESSAGE au badgeage. Tous portent la variable `{prenom}` — et
  // rien d'autre d'identifiant : l'écran reste au « prénom + initiale »
  // (ADR-0004 §1, exigence NOTE_JURIDIQUE §3.5 marquée Obligatoire). Le poste
  // substitue la variable localement ; le serveur ne pousse jamais de message
  // nominatif pré-assemblé.
  'badgeuse.msg_matin': 'Bonjour, {prenom} !',
  'badgeuse.msg_pause': 'Bon appétit, {prenom} !',
  'badgeuse.msg_retour': 'Bon après-midi, {prenom} !',
  'badgeuse.msg_soir': 'Bonne fin de journée, {prenom} !',
  'badgeuse.msg_premier_jour': 'Bienvenue chez Solidarité Textiles, {prenom} !',
  'badgeuse.msg_anniversaire': 'Joyeux anniversaire, {prenom} ! 🎉',
  // `{annees}` est la seule variable supplémentaire admise (entier).
  'badgeuse.msg_anniversaire_entreprise': '{annees} an(s) avec nous, {prenom} — merci ! 🎉',

  // PLAGES DES MOMENTS (heure murale Paris) — le poste choisit le gabarit
  // d'après le SENS du badgeage et l'heure. Aucune de ces bornes n'est codée
  // en dur côté poste (ADR-0002) : elles descendent par GET /config.
  'badgeuse.moment_matin_fin': '11:30',
  'badgeuse.moment_pause_debut': '11:00',
  'badgeuse.moment_pause_fin': '14:00',
  'badgeuse.moment_retour_fin': '15:00',
  'badgeuse.moment_soir_debut': '14:00',

  // VIVIER DE PHRASES DE MOTIVATION — GÉNÉRIQUES et collectives. Le lien avec
  // un profil PCM est EXCLU par conception (ADR-0004 §2 : détournement de
  // finalité + divulgation d'une inférence psychologique). Rotation
  // quotidienne déterministe côté poste (jour de l'année % taille).
  'badgeuse.phrases_motivation': [
    'Bonne journée à toute l\'équipe !',
    'Chaque geste de tri compte.',
    'Merci pour le travail d\'hier.',
    'Prenez soin de vous et des autres.',
    'Un textile collecté, c\'est une ressource sauvée.',
    'La sécurité d\'abord : gants et gestes sûrs.',
    'On avance ensemble, à notre rythme.',
    'Une question ? L\'encadrant est là pour ça.',
    'Belle journée dans l\'atelier.',
    'Merci d\'être là aujourd\'hui.',
  ],
  'badgeuse.motivation_active': true,

  // ÉCRAN FESTIF : l'interrupteur global. Il ne suffit PAS — chaque salarié
  // doit en outre avoir donné son accord individuel (ADR-0004 §4,
  // `employees.badgeuse_optin_festif`, défaut false).
  'badgeuse.festif_actif': true,

  // MÉDIAS : plafond du cache local du poste (Mo) et taille maximale d'un
  // contenu téléchargé par le SERVEUR depuis un lien partagé (Mo).
  'badgeuse.media_cache_max_mo': 500,
  'badgeuse.lien_taille_max_mo': 50,

  // RÉSEAUX SOCIAUX (ADR-0004 §6) : API officielle ou saisie manuelle, JAMAIS
  // de scraping. Désactivé par défaut ; sans jeton Meta configuré le job est
  // un no-op silencieux. Les 7 comptes de la structure sont pré-inscrits
  // INACTIFS : leur identifiant Graph (`graph_id`) doit être renseigné par un
  // ADMIN — il n'est pas devinable depuis le nom d'utilisateur, et rien n'est
  // inventé à sa place.
  'badgeuse.social_sync_actif': false,
  'badgeuse.social_comptes': [
    { reseau: 'instagram', compte: 'fripandcorouen', graph_id: null, actif: false },
    { reseau: 'instagram', compte: 'vintiz.fr', graph_id: null, actif: false },
    { reseau: 'instagram', compte: 'fripandcostreet', graph_id: null, actif: false },
    { reseau: 'instagram', compte: 'fripandcofamily', graph_id: null, actif: false },
    { reseau: 'facebook', compte: 'fripandcorouen', graph_id: null, actif: false },
    { reseau: 'facebook', compte: 'SolidariteTextiles', graph_id: null, actif: false },
    { reseau: 'facebook', compte: 'vintiz.fr', graph_id: null, actif: false },
  ],
  'badgeuse.social_posts_par_compte': 5,
  // Conservation des posts sociaux importés (jours). Comme les autres
  // `retention_*` : appliquée par la purge planifiée, PAS par le job de sync
  // (un seul endroit supprime — cf. services/scheduler.js).
  'badgeuse.retention_social_jours': 30,
};

// Bornes juridiques de la durée d'affichage de l'overlay (NOTE_JURIDIQUE §3.5).
const OVERLAY_MIN_SEC = 3;
const OVERLAY_MAX_SEC = 8;

// Clés du marqueur d'arbitrage (ADR-0002 §3). Sans défaut : « non arbitré » est
// un état réel, pas une valeur à inventer.
const REGLES_VALIDEES_LE_KEY = 'badgeuse.regles_validees_le';
const REGLES_VALIDEES_PAR_KEY = 'badgeuse.regles_validees_par';

// Secrets et état d'exploitation des réseaux sociaux. VOLONTAIREMENT hors de
// BADGEUSE_SETTING_DEFAULTS : `PUT /parametres` n'accepte que les clés du
// dictionnaire, ce qui interdit d'écrire (ou de lire) le jeton par cette voie.
// Le jeton est chiffré AES-256-GCM (pattern SumUp / clés HMAC de site).
const META_TOKEN_KEY = 'badgeuse.meta_token';
const META_TOKEN_CONFIGURE_LE_KEY = 'badgeuse.meta_token_configure_le';
const SOCIAL_DERNIER_SYNC_KEY = 'badgeuse.social_dernier_sync';

/** Clé settings de la clé HMAC d'un site (valeur chiffrée AES-256-GCM). */
const hmacKeySettingKey = (siteId) => `badgeuse.hmac_key_site_${siteId}`;

function coerce(value, def) {
  if (value == null || value === '') return def;
  // Défaut STRUCTURÉ (tableau/objet) : la valeur est stockée en JSON. Un JSON
  // illisible retombe sur le défaut documenté plutôt que de propager une
  // valeur cassée jusqu'à l'écran.
  if (def !== null && typeof def === 'object') {
    if (typeof value === 'object') return value;
    try {
      const parsed = JSON.parse(String(value));
      if (parsed !== null && typeof parsed === 'object') return parsed;
      return def;
    } catch (_) {
      return def;
    }
  }
  if (typeof def === 'number') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : def;
  }
  if (typeof def === 'boolean') {
    return ['true', '1', 'oui', 'yes'].includes(String(value).trim().toLowerCase());
  }
  return String(value);
}

// ── Validation des paramètres d'affichage (fonctions PURES, testées) ────────
//
// Ces contrôles ne sont pas des règles de gestion : ce sont les garde-fous qui
// empêchent un paramétrage de casser l'écran (gabarit sans variable, plage
// horaire illisible, vivier de phrases démesuré).

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const GABARIT_MAX = 120;
const PHRASE_MAX = 200;
const PHRASES_MAX = 30;

/** Clés de gabarit de message (toutes exigent la variable `{prenom}`). */
const GABARIT_KEYS = [
  'badgeuse.msg_matin', 'badgeuse.msg_pause', 'badgeuse.msg_retour', 'badgeuse.msg_soir',
  'badgeuse.msg_premier_jour', 'badgeuse.msg_anniversaire', 'badgeuse.msg_anniversaire_entreprise',
];

/** Clés de bornes horaires des moments (format HH:MM strict). */
const PLAGE_KEYS = [
  'badgeuse.moment_matin_fin', 'badgeuse.moment_pause_debut', 'badgeuse.moment_pause_fin',
  'badgeuse.moment_retour_fin', 'badgeuse.moment_soir_debut',
];

/**
 * RÈGLES DE GESTION RH au sens de l'ADR-0002 §2 — celles, et SEULES celles,
 * que la Direction doit arbitrer (NOTE_RH §3). Leur enregistrement explicite
 * vaut arbitrage et fait disparaître le bandeau « règles par défaut ».
 *
 * Cette liste existe pour que le bandeau reste HONNÊTE : les réglages
 * d'exploitation (cadences de sync, supervision), les durées de conservation
 * (non arbitrables) et les paramètres d'AFFICHAGE de l'écran v2 (gabarits de
 * message, phrases, réseaux sociaux) n'en font pas partie. Sans cette
 * distinction, éditer un message de bienvenue effacerait le signal
 * « grille non arbitrée » sans que personne ne l'ait décidé.
 */
const REGLES_RH_KEYS = [
  'badgeuse.pointages_par_jour',
  'badgeuse.arrondi_minutes',
  'badgeuse.arrondi_sens',
  'badgeuse.tolerance_retard_minutes',
  'badgeuse.badge_avant_heure_compte',
  'badgeuse.pause_deduite_minutes',
  'badgeuse.pause_deduite_seuil_heures',
  'badgeuse.journee_max_heures',
  'badgeuse.plage_acceptation_debut',
  'badgeuse.plage_acceptation_fin',
  'badgeuse.affichage_cumul_hebdo',
  'badgeuse.overlay_duree_sec',
  'badgeuse.anti_rebond_sec',
  'badgeuse.regularisation_delai_jours',
];

/**
 * Valide une entrée de paramètre d'affichage.
 * @param {string} key clé complète `badgeuse.*`
 * @param {*} value valeur candidate
 * @returns {string|null} message d'erreur, ou null si la valeur est acceptable
 */
function validateAffichageSetting(key, value) {
  if (GABARIT_KEYS.includes(key)) {
    const s = String(value == null ? '' : value);
    if (!s.trim()) return `${key} : le gabarit ne peut pas être vide`;
    if (s.length > GABARIT_MAX) return `${key} : gabarit limité à ${GABARIT_MAX} caractères`;
    // Le prénom EST le message : un gabarit sans `{prenom}` produirait un
    // écran impersonnel (ou pire, inciterait à écrire un nom en dur).
    if (!s.includes('{prenom}')) return `${key} : le gabarit doit contenir la variable {prenom}`;
    return null;
  }
  if (PLAGE_KEYS.includes(key)) {
    if (!HHMM.test(String(value == null ? '' : value).trim())) {
      return `${key} : heure attendue au format HH:MM (00:00 à 23:59)`;
    }
    return null;
  }
  if (key === 'badgeuse.phrases_motivation') {
    const arr = typeof value === 'string' ? safeJsonArray(value) : value;
    if (!Array.isArray(arr)) return 'badgeuse.phrases_motivation : tableau de phrases attendu';
    if (arr.length > PHRASES_MAX) return `badgeuse.phrases_motivation : ${PHRASES_MAX} phrases au maximum`;
    for (const p of arr) {
      if (typeof p !== 'string' || !p.trim()) return 'badgeuse.phrases_motivation : chaque phrase doit être un texte non vide';
      if (p.length > PHRASE_MAX) return `badgeuse.phrases_motivation : phrase limitée à ${PHRASE_MAX} caractères`;
    }
    return null;
  }
  return null;
}

/** JSON.parse tolérant qui rend `null` au lieu de lever. */
function safeJsonArray(value) {
  try {
    const p = JSON.parse(String(value));
    return Array.isArray(p) ? p : null;
  } catch (_) {
    return null;
  }
}

/**
 * Valide un lot d'entrées `[key, value]` — rend la PREMIÈRE erreur (le PUT
 * refuse alors le lot entier : un paramétrage à moitié écrit serait pire).
 */
function validateAffichageSettings(entrees) {
  for (const [key, value] of entrees || []) {
    const err = validateAffichageSetting(key, value);
    if (err) return err;
  }
  return null;
}

/**
 * Lit une clé badgeuse.* avec son défaut documenté. Résilient : toute erreur
 * (table absente, valeur invalide) retombe sur le défaut.
 * @param {string} key clé complète (ex. 'badgeuse.arrondi_minutes')
 */
async function readBadgeuseSetting(key) {
  const def = BADGEUSE_SETTING_DEFAULTS[key] ?? null;
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    return coerce(r.rows[0]?.value, def);
  } catch (_) {
    return def;
  }
}

/**
 * Lit TOUTE la grille de paramètres en une requête (les routes et le moteur en
 * ont besoin d'un bloc). Les clés absentes prennent leur défaut documenté.
 * `overlay_duree_sec` est reborné 3–8 s (exigence juridique, cf. tête de fichier).
 * @returns {Promise<object>} dictionnaire clé courte → valeur typée
 */
async function readBadgeuseParams() {
  const out = {};
  for (const [key, def] of Object.entries(BADGEUSE_SETTING_DEFAULTS)) {
    out[key.replace(/^badgeuse\./, '')] = def;
  }
  try {
    const r = await pool.query("SELECT key, value FROM settings WHERE key LIKE 'badgeuse.%'");
    for (const row of r.rows) {
      if (!Object.prototype.hasOwnProperty.call(BADGEUSE_SETTING_DEFAULTS, row.key)) continue;
      out[row.key.replace(/^badgeuse\./, '')] = coerce(row.value, BADGEUSE_SETTING_DEFAULTS[row.key]);
    }
  } catch (_) {
    // Base non migrée : la grille de défauts documentés fait office.
  }
  out.overlay_duree_sec = Math.min(OVERLAY_MAX_SEC, Math.max(OVERLAY_MIN_SEC, Number(out.overlay_duree_sec) || OVERLAY_MIN_SEC));
  return out;
}

/**
 * État d'arbitrage de la grille (ADR-0002 §3) : { validees, le, par }.
 * `validees:false` = pilote à blanc sur les défauts RH — jamais silencieux.
 */
async function readReglesValidees() {
  try {
    const r = await pool.query('SELECT key, value FROM settings WHERE key IN ($1, $2)', [
      REGLES_VALIDEES_LE_KEY, REGLES_VALIDEES_PAR_KEY,
    ]);
    const map = new Map(r.rows.map((x) => [x.key, x.value]));
    const le = map.get(REGLES_VALIDEES_LE_KEY) || null;
    const par = map.get(REGLES_VALIDEES_PAR_KEY) || null;
    return { validees: !!le, le, par: par == null ? null : (Number.isFinite(parseInt(par, 10)) ? parseInt(par, 10) : par) };
  } catch (_) {
    return { validees: false, le: null, par: null };
  }
}

/**
 * Upsert d'une clé settings (pattern du dépôt : ON CONFLICT (key) DO UPDATE).
 * Une valeur STRUCTURÉE (tableau/objet — vivier de phrases, comptes sociaux)
 * est sérialisée en JSON : `String([...])` produirait « a,b » et perdrait la
 * structure au relire.
 */
async function writeSetting(key, value, client = null) {
  const runner = client || pool;
  const serialise = value == null
    ? null
    : (typeof value === 'object' ? JSON.stringify(value) : String(value));
  await runner.query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, serialise]
  );
}

module.exports = {
  BADGEUSE_SETTING_DEFAULTS,
  OVERLAY_MIN_SEC,
  OVERLAY_MAX_SEC,
  REGLES_VALIDEES_LE_KEY,
  REGLES_VALIDEES_PAR_KEY,
  META_TOKEN_KEY,
  META_TOKEN_CONFIGURE_LE_KEY,
  SOCIAL_DERNIER_SYNC_KEY,
  GABARIT_KEYS,
  PLAGE_KEYS,
  REGLES_RH_KEYS,
  hmacKeySettingKey,
  readBadgeuseSetting,
  readBadgeuseParams,
  readReglesValidees,
  writeSetting,
  validateAffichageSetting,
  validateAffichageSettings,
};

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
  // ── Conservation (NOTE_JURIDIQUE §3.7 — conformité, non arbitrable) ──
  'badgeuse.retention_pointages_mois': 60,
  'badgeuse.retention_feuilles_mois': 60,
  'badgeuse.retention_badges_apres_restitution_jours': 90,
  'badgeuse.retention_contenus_apres_expiration_jours': 365,
  'badgeuse.retention_journal_acces_mois': 12,
};

// Bornes juridiques de la durée d'affichage de l'overlay (NOTE_JURIDIQUE §3.5).
const OVERLAY_MIN_SEC = 3;
const OVERLAY_MAX_SEC = 8;

// Clés du marqueur d'arbitrage (ADR-0002 §3). Sans défaut : « non arbitré » est
// un état réel, pas une valeur à inventer.
const REGLES_VALIDEES_LE_KEY = 'badgeuse.regles_validees_le';
const REGLES_VALIDEES_PAR_KEY = 'badgeuse.regles_validees_par';

/** Clé settings de la clé HMAC d'un site (valeur chiffrée AES-256-GCM). */
const hmacKeySettingKey = (siteId) => `badgeuse.hmac_key_site_${siteId}`;

function coerce(value, def) {
  if (value == null || value === '') return def;
  if (typeof def === 'number') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : def;
  }
  if (typeof def === 'boolean') {
    return ['true', '1', 'oui', 'yes'].includes(String(value).trim().toLowerCase());
  }
  return String(value);
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

/** Upsert d'une clé settings (pattern du dépôt : ON CONFLICT (key) DO UPDATE). */
async function writeSetting(key, value, client = null) {
  const runner = client || pool;
  await runner.query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value == null ? null : String(value)]
  );
}

module.exports = {
  BADGEUSE_SETTING_DEFAULTS,
  OVERLAY_MIN_SEC,
  OVERLAY_MAX_SEC,
  REGLES_VALIDEES_LE_KEY,
  REGLES_VALIDEES_PAR_KEY,
  hmacKeySettingKey,
  readBadgeuseSetting,
  readBadgeuseParams,
  readReglesValidees,
  writeSetting,
};

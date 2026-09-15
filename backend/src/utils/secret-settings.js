/**
 * Secrets de service rangés dans `settings`, chiffrés AES-256-GCM.
 *
 * Extrait de `services/sumup.js` (10/09/2026) au moment de brancher un second
 * service à clé (Malibou) : recopier ces trente lignes, c'est se garantir que
 * les deux implémentations divergeront un jour — sur du chiffrement, cela veut
 * dire des secrets qu'on ne sait plus relire.
 *
 * LA CASCADE DE CLÉS RESTE PROPRE À CHAQUE SERVICE, et ce n'est pas un détail :
 * SumUp chiffre avec `SUMUP_ENCRYPTION_KEY` s'il la trouve. Généraliser la
 * cascade sans ce premier cran rendrait ILLISIBLES les jetons SumUp déjà en
 * base sur une installation qui a renseigné cette variable. Le nom de la
 * variable spécifique est donc un paramètre, pas une constante.
 *
 * Format stocké : `v1:<iv base64>:<tag base64>:<chiffré base64>`. Une valeur
 * sans ce préfixe est rendue telle quelle — du clair historique se relit,
 * il ne se perd pas.
 */
const crypto = require('crypto');
const pool = require('../config/database');
const logger = require('../config/logger');

/**
 * @param {string|null} envVar  variable d'environnement PROPRE au service
 *                              (ex. 'SUMUP_ENCRYPTION_KEY'), essayée en premier
 */
function getEncryptionKey(envVar) {
  const raw = (envVar && process.env[envVar])
    || process.env.PCM_ENCRYPTION_KEY
    || process.env.JWT_SECRET;
  if (!raw) {
    throw new Error(`Aucune clé de chiffrement disponible (${envVar ? `${envVar} / ` : ''}PCM_ENCRYPTION_KEY / JWT_SECRET)`);
  }
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(plaintext, envVar) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(envVar), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(payload, envVar, libelle = 'secret') {
  if (!payload || !payload.startsWith('v1:')) return payload || null;
  try {
    const [, ivB64, tagB64, encB64] = payload.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(envVar), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    // Le message d'erreur ne porte JAMAIS la charge : un secret illisible ne
    // doit pas finir en clair dans les journaux par la porte de derrière.
    logger.error(`Déchiffrement ${libelle} impossible`, { error: err.message });
    return null;
  }
}

async function getSetting(key, db = pool) {
  const r = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
  return r.rows[0]?.value ?? null;
}

async function setSetting(key, value, db = pool) {
  await db.query(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `, [key, value == null ? null : String(value)]);
}

/** Fabrique le jeu de helpers d'un service donné. */
function secretStore({ envVar = null, libelle = 'secret' } = {}) {
  return {
    encrypt: (v) => encrypt(v, envVar),
    decrypt: (v) => decrypt(v, envVar, libelle),
    getSetting,
    setSetting,
    getEncryptedSetting: async (key, db) => decrypt(await getSetting(key, db), envVar, libelle),
    setEncryptedSetting: async (key, value, db) => setSetting(key, value == null ? null : encrypt(value, envVar), db),
  };
}

module.exports = { secretStore, getSetting, setSetting };

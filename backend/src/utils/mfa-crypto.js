/**
 * Chiffrement du secret TOTP stocké dans `users.mfa_secret` (chantier 2.43.0).
 *
 * AES-256-GCM du module `crypto` de Node — et NON crypto-js comme
 * utils/field-crypto.js. La raison est le mode : GCM est authentifié, il porte
 * une étiquette d'intégrité (tag) qui fait ÉCHOUER le déchiffrement quand la
 * clé est mauvaise ou la valeur altérée. field-crypto a dû inventer une
 * sentinelle pour compenser précisément l'absence de cette garantie en mode
 * CBC ; ici elle est native, donc pas de sentinelle et pas d'ambiguïté.
 *
 * Format stocké : `mfaenc:v1:<iv_b64>:<tag_b64>:<data_b64>`
 *   - préfixe versionné : un futur format v2 se distingue sans deviner ;
 *   - IV de 12 octets tiré au hasard À CHAQUE écriture (recommandation NIST
 *     SP 800-38D pour GCM) ; deux enrôlements du même secret ne produisent
 *     jamais la même chaîne ;
 *   - tag d'authentification de 16 octets.
 *
 * CASCADE DE CLÉ (documentée, dans cet ordre) :
 *   1. MFA_ENCRYPTION_KEY — clé DÉDIÉE, celle qu'il faut renseigner ;
 *   2. PCM_ENCRYPTION_KEY — repli sur la clé applicative existante ;
 *   3. JWT_SECRET         — dernier repli, celui de field-crypto/pcm-crypto.
 * Le repli final mélange deux registres de compromission (voler le secret de
 * signature des jetons suffirait alors à déchiffrer les secrets TOTP) : il
 * existe pour qu'un déploiement sans nouvelle variable d'environnement
 * fonctionne quand même — pas parce qu'il est souhaitable. Renseigner
 * MFA_ENCRYPTION_KEY est la bonne pratique.
 *
 * La clé de 32 octets est DÉRIVÉE par SHA-256 du secret textuel : les variables
 * d'environnement du projet sont des phrases de longueur libre, AES-256 exige
 * exactement 32 octets.
 *
 * Doctrine : ces fonctions ne LÈVENT JAMAIS. Un échec renvoie `null` et est
 * journalisé — un secret illisible doit conduire à « réinitialisez la double
 * authentification » (action ADMIN), jamais à un 500 qui verrouille la
 * connexion de tout le monde.
 */
const crypto = require('crypto');

const PREFIX = 'mfaenc:v1:';
const IV_BYTES = 12;   // GCM : 96 bits, la taille recommandée
const TAG_BYTES = 16;

/**
 * Résout la clé À L'APPEL (et non au require) : testabilité, et parité avec le
 * process.env vivant du conteneur — même choix que utils/field-crypto.js.
 * @returns {Buffer|null} clé de 32 octets, ou null si aucune source
 */
function getKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY
    || process.env.PCM_ENCRYPTION_KEY
    || process.env.JWT_SECRET
    || null;
  if (!raw) return null;
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest();
}

/** Nom de la variable réellement utilisée — pour les messages d'exploitation. */
function keySource() {
  if (process.env.MFA_ENCRYPTION_KEY) return 'MFA_ENCRYPTION_KEY';
  if (process.env.PCM_ENCRYPTION_KEY) return 'PCM_ENCRYPTION_KEY';
  if (process.env.JWT_SECRET) return 'JWT_SECRET';
  return null;
}

/**
 * Chiffre un secret TOTP (Base32) pour stockage.
 * @param {string} plain
 * @returns {string|null} `mfaenc:v1:...` ou null (clé absente / échec)
 */
function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const key = getKey();
  if (!key) {
    console.error('[MFA-CRYPTO] Aucune clé de chiffrement (MFA_ENCRYPTION_KEY / PCM_ENCRYPTION_KEY / JWT_SECRET) — secret TOTP NON stocké');
    return null;
  }
  try {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + [iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
  } catch (e) {
    console.error('[MFA-CRYPTO] Échec de chiffrement du secret TOTP :', e.message);
    return null;
  }
}

/**
 * Déchiffre une valeur lue en base.
 * Renvoie null si : valeur vide, format inconnu, clé absente, clé changée ou
 * valeur altérée (le tag GCM le détecte). Aucune valeur « en clair héritée »
 * n'est reconnue : la colonne `users.mfa_secret` est née chiffrée avec ce
 * format (2.43.0), une chaîne sans préfixe est donc anormale et ne doit
 * SURTOUT pas être prise pour un secret valide.
 * @param {string} value
 * @returns {string|null}
 */
function decryptSecret(value) {
  if (value === null || value === undefined || value === '') return null;
  const str = String(value);
  if (!str.startsWith(PREFIX)) {
    console.warn('[MFA-CRYPTO] Secret TOTP au format inattendu — ignoré (réinitialisez la double authentification de ce compte)');
    return null;
  }
  const parts = str.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    console.warn('[MFA-CRYPTO] Secret TOTP malformé — ignoré');
    return null;
  }
  const key = getKey();
  if (!key) {
    console.error('[MFA-CRYPTO] Aucune clé de chiffrement disponible — secret TOTP illisible');
    return null;
  }
  try {
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const data = Buffer.from(parts[2], 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      console.warn('[MFA-CRYPTO] Secret TOTP : IV ou étiquette de taille inattendue — ignoré');
      return null;
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]);
    return out.toString('utf8');
  } catch (e) {
    // Cas nominal d'échec : clé d'environnement changée depuis l'enrôlement.
    console.warn('[MFA-CRYPTO] Déchiffrement du secret TOTP impossible (clé changée ou valeur altérée) — réinitialisation requise');
    return null;
  }
}

/** True si la valeur porte le format de ce module. */
function isEncryptedSecret(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = { PREFIX, encryptSecret, decryptSecret, isEncryptedSecret, keySource };

const crypto = require('crypto');

/**
 * Chiffrement AES-256-CBC des AppKey LoRaWAN stockées en base.
 * Même pattern que le chiffrement Pennylane : IV aléatoire 16 octets,
 * format `iv_hex:encrypted_hex`. Clé dérivée par SHA-256.
 */

function getEncryptionKey() {
  const key = process.env.LORA_APPKEY_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!key) throw new Error('Clé de chiffrement non configurée (LORA_APPKEY_ENCRYPTION_KEY ou JWT_SECRET requis)');
  return crypto.createHash('sha256').update(key).digest();
}

function encryptAppKey(plaintext) {
  if (!plaintext) return null;
  const derivedKey = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', derivedKey, iv);
  const encrypted = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptAppKey(encrypted) {
  if (!encrypted) return null;
  const derivedKey = getEncryptionKey();
  const [ivHex, encryptedHex] = encrypted.split(':');
  if (!ivHex || !encryptedHex) throw new Error('Format de clé chiffrée invalide');
  const decipher = crypto.createDecipheriv('aes-256-cbc', derivedKey, Buffer.from(ivHex, 'hex'));
  return decipher.update(encryptedHex, 'hex', 'utf8') + decipher.final('utf8');
}

/**
 * Masque l'AppKey pour affichage : conserve 4 premiers + 4 derniers caractères.
 */
function maskAppKey(plaintext) {
  if (!plaintext) return null;
  const s = plaintext.replace(/[^0-9a-fA-F]/g, '');
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

module.exports = { encryptAppKey, decryptAppKey, maskAppKey };

/**
 * TOTP (RFC 6238) — implémentation PURE, sans aucune dépendance externe.
 *
 * Le projet est léger par design (CLAUDE.md §8, « pas de librairie externe sauf
 * nécessité ») et embarque déjà ses propres primitives cryptographiques
 * (utils/field-crypto.js, HMAC de la badgeuse). Un TOTP, c'est un HMAC-SHA1 sur
 * un compteur de pas de 30 s, suivi de la troncature dynamique de la RFC 4226 :
 * une soixantaine de lignes, et surtout un comportement VÉRIFIABLE — les
 * vecteurs officiels de la RFC 6238 (annexe B) sont rejoués dans
 * tests/unit/totp.test.js. Une librairie ne l'aurait pas rendu plus sûr, elle
 * aurait rendu l'échec plus difficile à diagnostiquer.
 *
 * Aucune E/S, aucun accès base : ce module est testable sans rien monter.
 *
 * Contenu :
 *   - base32Encode / base32Decode : RFC 4648, l'alphabet qu'attendent Google
 *     Authenticator, FreeOTP, Aegis, Bitwarden… ;
 *   - generateSecret()            : 20 octets aléatoires → Base32 ;
 *   - totp()                      : le code à un instant donné ;
 *   - verifyTotp()                : vérification avec fenêtre de tolérance et
 *     comparaison à TEMPS CONSTANT ;
 *   - generateBackupCodes() / hashBackupCode() : codes de secours à usage unique.
 */
const crypto = require('crypto');

// RFC 4648 §6 — alphabet Base32 standard (celui des applications d'authentification).
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode un Buffer en Base32 (RFC 4648), SANS remplissage '='.
 * Les applications d'authentification acceptent les deux formes ; l'absence de
 * '=' évite d'avoir à l'échapper dans l'URL otpauth://.
 * @param {Buffer|Uint8Array} buffer
 * @returns {string}
 */
function base32Encode(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/**
 * Décode une chaîne Base32 → Buffer.
 * Tolérant à la saisie humaine : espaces, tirets, minuscules et remplissage '='
 * sont acceptés (un secret recopié à la main l'est souvent par groupes de 4).
 * Un caractère hors alphabet lève une erreur — mieux vaut refuser franchement
 * qu'accepter un secret silencieusement tronqué.
 * @param {string} str
 * @returns {Buffer}
 */
function base32Decode(str) {
  if (typeof str !== 'string') throw new Error('Secret Base32 attendu (chaîne)');
  const clean = str.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (clean.length === 0) throw new Error('Secret Base32 vide');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Caractère Base32 invalide : « ${ch} »`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * Génère un secret TOTP aléatoire.
 * 20 octets = 160 bits, la taille recommandée par la RFC 4226 §4 (R6) pour
 * HMAC-SHA1 (et celle qu'utilisent les générateurs de référence).
 * @param {number} [bytes=20]
 * @returns {string} secret en Base32
 */
function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/**
 * Compteur de pas RFC 6238 : T = floor((temps_unix) / pas).
 * BigInt obligatoire : le compteur est encodé sur 8 octets et le vecteur de
 * test T=20000000000 dépasse largement les 32 bits d'un entier JavaScript
 * manipulé en bitwise (c'est l'erreur classique des implémentations maison).
 */
function counterBuffer(counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  return buf;
}

/**
 * Code TOTP à un instant donné.
 * @param {string} secretBase32 secret partagé (Base32)
 * @param {object} [opts]
 * @param {number} [opts.time=Date.now()] instant en MILLISECONDES (comme Date.now)
 * @param {number} [opts.step=30] pas de temps en secondes
 * @param {number} [opts.digits=6] longueur du code
 * @param {string} [opts.algorithm='sha1'] algorithme HMAC (RFC 6238 : sha1/sha256/sha512)
 * @returns {string} code à `digits` chiffres, complété par des zéros à gauche
 */
function totp(secretBase32, opts = {}) {
  const { time = Date.now(), step = 30, digits = 6, algorithm = 'sha1' } = opts;
  const key = base32Decode(secretBase32);
  const counter = Math.floor(Math.floor(time / 1000) / step);
  const hmac = crypto.createHmac(algorithm, key).update(counterBuffer(counter)).digest();

  // Troncature dynamique (RFC 4226 §5.3) : les 4 bits de poids faible du dernier
  // octet donnent le décalage de lecture des 4 octets du code.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);

  const code = binary % (10 ** digits);
  return String(code).padStart(digits, '0');
}

/**
 * Comparaison de deux chaînes à TEMPS CONSTANT.
 * Une comparaison naïve (===) s'arrête au premier caractère différent : sur un
 * code à 6 chiffres, la fuite temporelle est mesurable et permet de reconstruire
 * le code chiffre par chiffre. `crypto.timingSafeEqual` exige des longueurs
 * égales — la longueur, elle, n'est pas un secret (6 chiffres, format public).
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Vérifie un code TOTP avec une fenêtre de tolérance.
 * `window = 1` accepte le pas courant, le précédent et le suivant (± 30 s) :
 * c'est la recommandation de la RFC 6238 §5.2 pour absorber la dérive
 * d'horloge du téléphone et le temps de frappe de l'utilisateur.
 *
 * TOUS les pas de la fenêtre sont évalués, même après une correspondance :
 * s'arrêter au premier code juste rendrait la durée de la réponse dépendante
 * de la position du pas trouvé.
 *
 * @param {string} secretBase32
 * @param {string} code code saisi
 * @param {object} [opts] { window=1, time, step, digits, algorithm }
 * @returns {boolean}
 */
function verifyTotp(secretBase32, code, opts = {}) {
  const { window = 1, step = 30, digits = 6 } = opts;
  if (typeof code !== 'string' && typeof code !== 'number') return false;
  const clean = String(code).replace(/[\s-]/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(clean)) return false;

  const time = opts.time === undefined ? Date.now() : opts.time;
  let match = false;
  for (let i = -window; i <= window; i++) {
    let candidate;
    try {
      candidate = totp(secretBase32, { ...opts, time: time + i * step * 1000 });
    } catch (_) {
      return false; // secret illisible : jamais de crash, jamais d'acceptation
    }
    if (safeEqual(candidate, clean)) match = true;
  }
  return match;
}

// Alphabet des codes de secours : 32 caractères SANS 0/O ni 1/I — ces paires
// sont indiscernables sur un code recopié à la main ou imprimé, et un code de
// secours ne sert qu'un jour de panne, quand personne n'a le temps de deviner.
// 32 = puissance de 2 → le tirage par masque binaire est parfaitement uniforme
// (pas de biais modulo).
const BACKUP_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Génère `n` codes de secours au format XXXXX-XXXXX (10 caractères utiles,
 * soit 32^10 ≈ 2^50 combinaisons — hors de portée d'une attaque en ligne,
 * d'autant que le verrou anti-force-brute s'applique aussi à eux).
 * @param {number} [n=8]
 * @returns {string[]}
 */
function generateBackupCodes(n = 8) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const bytes = crypto.randomBytes(10);
    let raw = '';
    for (let j = 0; j < 10; j++) raw += BACKUP_ALPHABET[bytes[j] & 31];
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

/**
 * Normalise un code de secours saisi (casse, espaces) avant hachage ou
 * comparaison — l'utilisateur le recopie d'une feuille imprimée.
 */
function normalizeBackupCode(code) {
  return String(code == null ? '' : code).replace(/\s/g, '').toUpperCase();
}

/**
 * Empreinte SHA-256 (hex) d'un code de secours.
 * Les codes ne sont JAMAIS stockés en clair : seule leur empreinte l'est, et
 * ils ne sont affichés qu'une fois, à l'activation. SHA-256 (et non bcrypt)
 * suffit ici : le code est tiré aléatoirement sur 50 bits, il n'a pas la
 * faible entropie d'un mot de passe choisi par un humain — une attaque par
 * dictionnaire n'a aucune prise.
 * @param {string} code
 * @returns {string} hex 64 caractères
 */
function hashBackupCode(code) {
  return crypto.createHash('sha256').update(normalizeBackupCode(code), 'utf8').digest('hex');
}

/** Format d'un code de secours (utilisé pour aiguiller la saisie côté route). */
const BACKUP_CODE_REGEX = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/;

module.exports = {
  BASE32_ALPHABET,
  BACKUP_ALPHABET,
  BACKUP_CODE_REGEX,
  base32Encode,
  base32Decode,
  generateSecret,
  totp,
  verifyTotp,
  safeEqual,
  generateBackupCodes,
  normalizeBackupCode,
  hashBackupCode,
};

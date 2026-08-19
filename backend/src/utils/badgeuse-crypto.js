/**
 * Primitives cryptographiques du module « Temps & Présence » (badgeuse).
 *
 * Trois responsabilités, toutes PURES (aucun accès DB, aucune horloge) :
 *
 *  1. PSEUDONYMISATION DE L'UID DE BADGE (CONTRAT_HMAC.md) — exigence bloquante :
 *     l'UID d'un badge n'est JAMAIS stocké, journalisé ni transmis en clair.
 *     Seul `uid_hmac = HMAC-SHA256(cle_site, uid_normalise)` circule. Le serveur
 *     ne connaît donc pas non plus les UID : même sa base ne permet pas de
 *     cloner un badge (défense en profondeur, NOTE_JURIDIQUE §3.4).
 *
 *  2. CHAÎNE D'INTÉGRITÉ DES POINTAGES (CONTRAT_INTEGRITE.md) — chaque pointage
 *     chaîne le précédent DU MÊME POSTE : `hash_courant = SHA256(hash_precedent
 *     || canonical(pointage))`. Le vecteur de test partagé du contrat (§4) fige
 *     une ambiguïté que la notation `||` laissait ouverte : la concaténation est
 *     celle des CHAÎNES (hex du hash précédent + charge canonique en ASCII), pas
 *     celle des octets décodés. `chainHash` implémente et `badgeuse-crypto.test.js`
 *     verrouille cette lecture — le poste Python doit produire le même condensat.
 *
 *  3. CHIFFREMENT DES SECRETS au repos (clé HMAC de site en `settings`), au même
 *     format que les secrets SumUp : 'v1:<iv_b64>:<tag_b64>:<enc_b64>' AES-256-GCM.
 *
 * Aucune valeur de ce fichier n'est une règle de gestion RH : ce sont des
 * contrats techniques figés par des vecteurs de test partagés avec le poste.
 */
const crypto = require('crypto');

// Longueurs d'UID acceptées, en caractères hex : UID ISO14443A de 4, 7 ou 10
// octets (CONTRAT_HMAC §2.4). Toute autre longueur = lecture non conforme.
const UID_HEX_LENGTHS = [8, 14, 20];

// Forme canonique de l'ABSENCE de badge (pointage manuel ou import) —
// CONTRAT_INTEGRITE §2. C'est un `-` LITTÉRAL, jamais une chaîne vide : les
// deux piles (Node et Python) doivent produire le même condensat, et le
// serveur stocke `NULL` en base tout en canonisant `-` (QA-01).
const NO_BADGE = '-';

// Séparateur et noms des 7 champs de la charge canonique (ordre figé).
const CANONICAL_SEPARATOR = '|';
const CANONICAL_FIELDS = [
  'uuid', 'device_code', 'sequence_device', 'uid_hmac', 'horodatage_utc', 'sens', 'source',
];

// ── 1. Pseudonymisation de l'UID ───────────────────────────────────────────

/**
 * Normalise un UID lu par le lecteur USB HID (CONTRAT_HMAC §2) :
 *  1. retire tout caractère hors [0-9A-Fa-f] (espaces, `:`, `-`, CR du mode clavier) ;
 *  2. passe en MAJUSCULES ;
 *  3. si la chaîne est purement décimale ET de longueur 10 (lecteur configuré en
 *     décimal), la convertit en hexadécimal sur 8 caractères zéro-paddés à gauche ;
 *  4. n'accepte que les longueurs 8, 14 ou 20.
 *
 * @param {string} raw UID brut (vit en mémoire vive seulement, jamais logué)
 * @returns {string|null} UID normalisé hex MAJUSCULE, ou null si non conforme
 */
function normalizeUid(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (!cleaned) return null;

  // Étape 3 : mode décimal. Une chaîne de 10 chiffres décimaux ne peut pas être
  // un UID hex valide (10 n'est pas une longueur acceptée) — aucune ambiguïté.
  let value = cleaned;
  if (/^[0-9]{10}$/.test(cleaned)) {
    value = BigInt(cleaned).toString(16).toUpperCase().padStart(8, '0');
  }

  return UID_HEX_LENGTHS.includes(value.length) ? value : null;
}

/**
 * uid_hmac = HMAC-SHA256(cle_site, uid_normalise) → hex minuscule 64 car.
 * Point de contrat critique : la clé est décodée d'HEX VERS OCTETS avant HMAC ;
 * le message est la chaîne ASCII de l'UID normalisé (pas ses octets décodés).
 *
 * @param {string} cleHex clé de site, 64 caractères hex (256 bits)
 * @param {string} uidNormalise sortie de normalizeUid()
 * @returns {string|null} condensat hex minuscule, null si entrée non conforme
 */
function hmacUid(cleHex, uidNormalise) {
  if (!cleHex || !uidNormalise) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(String(cleHex))) return null;
  return crypto
    .createHmac('sha256', Buffer.from(String(cleHex), 'hex'))
    .update(String(uidNormalise), 'utf8')
    .digest('hex');
}

/** Génère une clé de site de 256 bits (hex minuscule 64 car.). */
function generateSiteKey() {
  return crypto.randomBytes(32).toString('hex');
}

// ── 2. Chaîne d'intégrité ──────────────────────────────────────────────────

/**
 * Horodatage au format exact du contrat : `YYYY-MM-DDTHH:MM:SS.mmmZ`.
 * La charge canonique est signée par le poste : on ne « ré-écrit » un horodatage
 * déjà conforme sous aucun prétexte (le moindre écart casserait la vérification).
 */
function isoMillisUTC(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return value;
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Charge utile canonique (CONTRAT_INTEGRITE §2) — concaténation, séparateur `|`,
 * sans espaces, dans CET ordre :
 *   uuid | device_code | sequence_device | uid_hmac | horodatage_utc_iso | sens | source
 * `uid_hmac` vaut le `-` littéral pour un pointage manuel sans badge.
 *
 * STRICTE COMME LE PYTHON (QA-08) : un champ VIDE ou contenant le séparateur
 * `|` fait LEVER une erreur, exactement comme `chain.canonical` côté poste.
 * Sans ce contrôle, deux pointages distincts pouvaient produire la même charge
 * canonique (`uuid="a|b", device_code="c"` vs `uuid="a", device_code="b|c"`),
 * ce qui affaiblissait la valeur probante de la chaîne. Les appelants traitent
 * l'exception comme un payload malformé (statut `invalid` du contrat device).
 *
 * @param {object} p { uuid, device_code, sequence_device, uid_hmac, horodatage_utc, sens, source }
 * @returns {string}
 * @throws {Error} si un champ est vide/absent ou contient `|`
 */
function canonicalPointage(p) {
  const o = p || {};
  // Entier base 10 sans zéros de tête ; une séquence illisible est un champ
  // ABSENT (et non la chaîne « NaN », qui aurait passé le contrôle de vacuité).
  const seq = parseInt(o.sequence_device, 10);
  const champs = [
    String(o.uuid == null ? '' : o.uuid),
    String(o.device_code == null ? '' : o.device_code),
    Number.isFinite(seq) ? String(seq) : '',
    o.uid_hmac ? String(o.uid_hmac).toLowerCase() : NO_BADGE,
    isoMillisUTC(o.horodatage_utc) || '',
    String(o.sens == null ? '' : o.sens),
    String(o.source == null ? '' : o.source),
  ];
  for (let i = 0; i < champs.length; i += 1) {
    if (champs[i] === '') {
      throw new Error(`canonicalPointage : champ « ${CANONICAL_FIELDS[i]} » vide ou absent`);
    }
    if (champs[i].includes(CANONICAL_SEPARATOR)) {
      throw new Error(`canonicalPointage : champ « ${CANONICAL_FIELDS[i]} » contient le séparateur « ${CANONICAL_SEPARATOR} »`);
    }
  }
  return champs.join(CANONICAL_SEPARATOR);
}

/** Genèse d'une chaîne de device : SHA256("genesis:" + device_code) → hex. */
function genesisHash(deviceCode) {
  return crypto.createHash('sha256').update(`genesis:${String(deviceCode || '')}`, 'utf8').digest('hex');
}

/**
 * hash_courant = SHA256(hash_precedent || canonical) — concaténation des CHAÎNES
 * (hex du précédent suivi de la charge canonique), figée par le vecteur du
 * CONTRAT_HMAC §4. Voir le commentaire de tête : c'est le point de contrat que
 * l'implémentation Python du poste doit reproduire à l'octet près.
 */
function chainHash(hashPrecedent, canonical) {
  return crypto
    .createHash('sha256')
    .update(`${String(hashPrecedent || '')}${String(canonical || '')}`, 'utf8')
    .digest('hex');
}

// ── 3. Clés device & secrets au repos ──────────────────────────────────────

/** Génère une clé device de 256 bits (hex 64 car.) — montrée UNE SEULE fois. */
function generateDeviceKey() {
  return crypto.randomBytes(32).toString('hex');
}

/** Hash SHA-256 hex d'une clé device — SEULE forme stockée en base. */
function hashDeviceKey(key) {
  return crypto.createHash('sha256').update(String(key == null ? '' : key), 'utf8').digest('hex');
}

/**
 * Comparaison à TEMPS CONSTANT de deux condensats hex (pattern webhooks.js).
 * Renvoie false sans fuite de timing si les longueurs diffèrent.
 */
function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(String(a == null ? '' : a));
  const bufB = Buffer.from(String(b == null ? '' : b));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── 4. Code d'appairage court d'un poste (ADR-0005) ────────────────────────

/**
 * Alphabet du code d'appairage : 30 symboles SANS AMBIGUÏTÉ DE LECTURE.
 * Sont exclus `I`, `L`, `O`, `U` et `0`, `1` — les six caractères que l'on
 * confond en dictant un code ou en le recopiant depuis un écran (I/1/L, O/0,
 * U/V). Le code est saisi à la main sur le poste, en atelier, par quelqu'un
 * qui n'est pas développeur : chaque confusion possible est une mise en
 * service ratée, c'est-à-dire précisément ce que l'ADR-0005 supprime.
 */
const APPAIRAGE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const APPAIRAGE_LENGTH = 8;

/**
 * Tire un code d'appairage de 8 caractères, UNIFORMÉMENT sur l'alphabet.
 *
 * BIAIS MODULO — le piège classique de ce tirage : `randomBytes(1)[0] % 30`
 * serait BIAISÉ, car 256 n'est pas un multiple de 30 (256 = 8 × 30 + 16). Les
 * 16 premiers symboles de l'alphabet sortiraient 9 fois sur 256 contre 8 pour
 * les 14 autres, soit ~12 % de plus : de quoi rogner l'entropie annoncée dans
 * l'analyse de risque de l'ADR. On passe donc par `crypto.randomInt(max)`, qui
 * applique un REJET D'ÉCHANTILLON (les tirages tombant dans la zone qui
 * déborde du dernier multiple complet de `max` sont jetés et retirés) et
 * garantit l'uniformité exacte sur [0, max). Aucun `%` sur un octet brut
 * n'apparaît ici, et aucun n'a le droit d'y revenir.
 *
 * @returns {string} 8 caractères de APPAIRAGE_ALPHABET, sans séparateur
 */
function generateAppairageCode() {
  let code = '';
  for (let i = 0; i < APPAIRAGE_LENGTH; i += 1) {
    code += APPAIRAGE_ALPHABET[crypto.randomInt(APPAIRAGE_ALPHABET.length)];
  }
  return code;
}

/**
 * Présentation lisible « XXXX-XXXX ». Le tiret est une AIDE À LA LECTURE, il
 * n'appartient pas au secret : `normalizeAppairageCode` le retire avant tout
 * calcul, si bien que l'installateur peut le saisir ou l'omettre.
 */
function formatAppairageCode(code) {
  const c = String(code == null ? '' : code);
  return c.length === APPAIRAGE_LENGTH ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/**
 * Normalise un code saisi : MAJUSCULES, tirets et espaces retirés.
 * @param {string} raw code tel que tapé sur le poste
 * @returns {string|null} 8 caractères de l'alphabet, ou null si non conforme
 */
function normalizeAppairageCode(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[\s-]/g, '').toUpperCase();
  if (cleaned.length !== APPAIRAGE_LENGTH) return null;
  for (const ch of cleaned) if (!APPAIRAGE_ALPHABET.includes(ch)) return null;
  return cleaned;
}

/**
 * Condensat SHA-256 hex du code NORMALISÉ — seule forme jamais stockée
 * (`badgeuse_devices.appairage_code_hash`), au même titre que la clé device.
 * @returns {string|null} condensat, ou null si le code saisi n'est pas conforme
 */
function hashAppairageCode(raw) {
  const code = normalizeAppairageCode(raw);
  return code ? crypto.createHash('sha256').update(code, 'utf8').digest('hex') : null;
}

/**
 * Clé de chiffrement des secrets du module (dérivée SHA-256 d'un secret
 * d'environnement — même cascade que sumup.js, avec une clé dédiée en tête).
 */
function getEncryptionKey() {
  const raw = process.env.BADGEUSE_ENCRYPTION_KEY
    || process.env.PCM_ENCRYPTION_KEY
    || process.env.JWT_SECRET;
  if (!raw) {
    throw new Error('Aucune clé de chiffrement disponible (BADGEUSE_ENCRYPTION_KEY / PCM_ENCRYPTION_KEY / JWT_SECRET)');
  }
  return crypto.createHash('sha256').update(raw).digest();
}

/** Chiffre un secret → 'v1:<iv_b64>:<tag_b64>:<enc_b64>' (AES-256-GCM). */
function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/** Déchiffre un secret 'v1:…'. Renvoie null si le déchiffrement échoue. */
function decryptSecret(payload) {
  if (!payload) return null;
  if (!String(payload).startsWith('v1:')) return String(payload);
  try {
    const [, ivB64, tagB64, encB64] = String(payload).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (_) {
    // Jamais de trace du secret ni du payload dans les logs.
    return null;
  }
}

module.exports = {
  UID_HEX_LENGTHS,
  NO_BADGE,
  CANONICAL_SEPARATOR,
  CANONICAL_FIELDS,
  normalizeUid,
  hmacUid,
  generateSiteKey,
  isoMillisUTC,
  canonicalPointage,
  genesisHash,
  chainHash,
  generateDeviceKey,
  hashDeviceKey,
  timingSafeEqualHex,
  APPAIRAGE_ALPHABET,
  APPAIRAGE_LENGTH,
  generateAppairageCode,
  formatAppairageCode,
  normalizeAppairageCode,
  hashAppairageCode,
  encryptSecret,
  decryptSecret,
};

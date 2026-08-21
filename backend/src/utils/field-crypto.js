/**
 * Chiffrement applicatif AES-256 des champs texte SENSIBLES (extension
 * insertion 2026-07, décision D9) — santé (art. 9 RGPD) et judiciaire
 * (art. 10 RGPD).
 *
 * Pattern aligné sur le chiffrement PCM existant (routes/pcm.js,
 * routes/insertion/routes.js, services/insertion-ai.js) : AES via crypto-js,
 * clé `PCM_ENCRYPTION_KEY` avec fallback `JWT_SECRET`, et clé de REPLI en
 * lecture `JWT_SECRET` pour les valeurs chiffrées avant le câblage de
 * PCM_ENCRYPTION_KEY (v2.0.5).
 *
 * Format stocké : 'encv2:' + ciphertext (base64 OpenSSL de crypto-js), le
 * clair étant préfixé d'une SENTINELLE avant chiffrement (voir plus bas).
 * Rétro-compatibilité : le format 'encv1:' (sans sentinelle) reste lu ; une
 * valeur sans aucun préfixe est du clair historique, retournée telle quelle.
 *
 * POURQUOI UNE SENTINELLE — un déchiffrement AES avec la MAUVAISE clé ne
 * échoue pas de façon fiable : il produit des octets aléatoires, qui forment
 * par hasard de l'UTF-8 valide dans ~0,5 % des cas (mesuré sur 5 000 tirages).
 * Sans marqueur, la chaîne de repli « clé primaire puis clé legacy » rendait
 * donc parfois du charabia (« ,\f », « K ») au lieu de basculer sur la clé
 * legacy — et un réenregistrement de la fiche aurait rechiffré ce charabia,
 * DÉTRUISANT la donnée d'origine. La sentinelle rend la vérification
 * déterministe : du bruit aléatoire ne la reproduit pas.
 *
 * Le chiffrement/déchiffrement se fait UNIQUEMENT dans la couche route
 * (jamais côté client) ; un `SELECT *` accidentel n'expose ainsi que du
 * chiffré pour ces champs.
 */
const CryptoJS = require('crypto-js');

// Préfixe du format COURANT (celui écrit aujourd'hui).
const ENC_PREFIX = 'encv2:';
// Format historique, encore LU mais plus jamais écrit (valeurs en base
// antérieures au correctif de la sentinelle).
const ENC_PREFIX_LEGACY = 'encv1:';
// Marqueur placé en tête du clair avant chiffrement : sa présence après
// déchiffrement prouve que la clé était la bonne.
const SENTINEL = 'sldt:v2:';

// Champs de insertion_diagnostics chiffrés applicativement (liste centrale,
// consommée par PUT/GET /diagnostic et par les exports en phase B).
const SENSITIVE_DIAG_FIELDS = [
  'commentaire_sante',
  'frein_sante_detail',
  'frein_sante_causes',
  'frein_judiciaire_detail',
];

// Clés résolues À L'APPEL (pas au require) : testabilité + parité avec le
// process.env vivant du conteneur. En production, routes/insertion/routes.js
// fait déjà process.exit(1) si aucune des deux clés n'existe.
function getKeys() {
  const primary = process.env.PCM_ENCRYPTION_KEY || process.env.JWT_SECRET || null;
  const legacy = process.env.JWT_SECRET || null;
  return { primary, legacy };
}

/**
 * Chiffre un texte sensible → 'encv1:<ciphertext>'.
 * - null / undefined / '' : retournés tels quels (rien à chiffrer).
 * - Valeur déjà chiffrée (encv2: ou encv1:) : retournée telle quelle (anti
 *   double chiffrement, ex. réécriture d'une ligne relue sans déchiffrement).
 * - Clé absente : retourne le clair inchangé + warn (jamais de crash — cas
 *   impossible en production, cf. garde fatale de routes.js).
 */
function encryptField(text) {
  if (text === null || text === undefined || text === '') return text;
  const value = String(text);
  if (value.startsWith(ENC_PREFIX) || value.startsWith(ENC_PREFIX_LEGACY)) return value;
  const { primary } = getKeys();
  if (!primary) {
    console.warn('[FIELD-CRYPTO] PCM_ENCRYPTION_KEY / JWT_SECRET absents — champ sensible laissé en clair');
    return value;
  }
  return ENC_PREFIX + CryptoJS.AES.encrypt(SENTINEL + value, primary).toString();
}

/**
 * Déchiffre une valeur issue de la base.
 * - null / undefined / '' : retournés tels quels.
 * - Sans préfixe connu : clair historique → retourné tel quel
 *   (rétro-compatibilité avec les données existantes non chiffrées).
 * - Échec de déchiffrement (clé changée, valeur corrompue) : retourne null
 *   et logge — ne renvoie JAMAIS un blob illisible à l'écran.
 */
function decryptField(value) {
  if (value === null || value === undefined || value === '') return value;
  const str = String(value);
  const v2 = str.startsWith(ENC_PREFIX);
  const v1 = !v2 && str.startsWith(ENC_PREFIX_LEGACY);
  if (!v2 && !v1) return value;
  const payload = str.slice((v2 ? ENC_PREFIX : ENC_PREFIX_LEGACY).length);
  const { primary, legacy } = getKeys();

  const tryKey = (key) => {
    if (!key) return null;
    let out;
    try {
      out = CryptoJS.AES.decrypt(payload, key).toString(CryptoJS.enc.Utf8);
    } catch {
      return null;
    }
    if (!out) return null;
    if (!v2) return out; // encv1 : aucune sentinelle à vérifier (voir en-tête).
    // encv2 : sans la sentinelle, la clé n'était pas la bonne — quand bien
    // même les octets déchiffrés formeraient de l'UTF-8 valide.
    return out.startsWith(SENTINEL) ? out.slice(SENTINEL.length) : null;
  };

  let text = tryKey(primary);
  if (text === null && legacy && legacy !== primary) {
    // Valeurs historiques chiffrées avec JWT_SECRET avant l'alignement de la
    // clé PCM (même repli que pcm.js / insertion-ai.js).
    text = tryKey(legacy);
  }
  if (text === null) {
    console.warn('[FIELD-CRYPTO] Échec de déchiffrement d\'un champ sensible (clé changée ou valeur corrompue) — valeur masquée (null)');
  }
  return text;
}

module.exports = {
  ENC_PREFIX,
  ENC_PREFIX_LEGACY,
  SENTINEL,
  SENSITIVE_DIAG_FIELDS,
  encryptField,
  decryptField,
};

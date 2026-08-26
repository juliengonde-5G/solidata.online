/**
 * Chiffrement des rapports PCM — source UNIQUE des clés et de leur ordre d'essai.
 *
 * Trois endroits lisaient ces rapports avec chacun sa propre logique à deux
 * clés (`routes/pcm.js`, `routes/insertion/routes.js`, `services/insertion-ai.js`).
 * Trois implémentations, trois occasions de diverger — et c'est ce qui est
 * arrivé : un rapport devenait lisible ici et pas là.
 *
 * POURQUOI PLUSIEURS CLÉS. Un rapport est chiffré avec la clé en vigueur le
 * jour du test. Cette clé a changé au moins deux fois : rotation du JWT_SECRET
 * (v2.0.2), puis mise en service d'une clé PCM dédiée (v2.0.5). Un test passé
 * avant ces bascules n'est donc plus déchiffrable avec la clé du jour — d'où
 * des profils récents qui s'ouvrent et des profils anciens qui refusent.
 *
 * Les clés historiques servent EXCLUSIVEMENT à lire. Une écriture se fait
 * toujours avec la clé du jour, et un rapport relu grâce à une ancienne clé a
 * vocation à être ré-enregistré avec elle (script `reparer-rapports-pcm.js`) —
 * sans quoi le problème reviendra à la prochaine rotation.
 */
const CryptoJS = require('crypto-js');

const ENCRYPTION_KEY = process.env.PCM_ENCRYPTION_KEY
  || process.env.JWT_SECRET
  || 'solidata-pcm-encryption-key';

/**
 * Clés acceptées en lecture, dans l'ordre d'essai. `PCM_ENCRYPTION_KEYS_LEGACY`
 * (plusieurs clés séparées par des virgules) rend lisibles des rapports
 * chiffrés avec une clé retirée depuis, quand on l'a encore sous la main.
 */
// Figées à l'import, comme ENCRYPTION_KEY. Les lire à chaque appel exposait à
// une incohérence sournoise : la clé d'écriture appartenait au démarrage du
// serveur, les clés de lecture à l'instant de la requête — deux vérités pour un
// même rapport dès que l'environnement bouge sous les pieds du processus.
const LEGACY_KEYS = [
  process.env.JWT_SECRET,
  ...String(process.env.PCM_ENCRYPTION_KEYS_LEGACY || '').split(',').map((k) => k.trim()),
  // Valeur par défaut du code tant qu'aucune clé n'était configurée : des
  // rapports des tout premiers mois en portent la marque.
  'solidata-pcm-encryption-key',
].filter((k) => k && k !== ENCRYPTION_KEY);

function clesHistoriques() {
  return [...LEGACY_KEYS];
}

function encryptReport(report) {
  return CryptoJS.AES.encrypt(JSON.stringify(report), ENCRYPTION_KEY).toString();
}

/**
 * Tente UNE clé. Renvoie l'objet, ou `null` — sans jamais lever.
 *
 * AES ne « refuse » pas une mauvaise clé : il rend des octets quelconques. Le
 * seul verdict fiable est la relecture en UTF-8 (qui échoue le plus souvent)
 * puis le JSON.parse (qui tranche le reste).
 */
function essayerCle(encrypted, cle) {
  try {
    const text = CryptoJS.AES.decrypt(String(encrypted), cle).toString(CryptoJS.enc.Utf8);
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Déchiffre avec la clé du jour, puis avec les clés historiques.
 * @returns {{report: object|null, cle: string|null}} `report` à `null` si
 *          AUCUNE clé ne convient. NE LÈVE JAMAIS : l'exception remontait
 *          jusqu'à un « Erreur serveur » générique, et l'écran, qui avalait
 *          l'erreur, ne faisait alors simplement rien.
 */
function decryptReportDetaille(encrypted) {
  if (!encrypted) return { report: null, cle: null };
  const courant = essayerCle(encrypted, ENCRYPTION_KEY);
  if (courant) return { report: courant, cle: 'courante' };
  for (let i = 0; i < LEGACY_KEYS.length; i += 1) {
    const r = essayerCle(encrypted, LEGACY_KEYS[i]);
    if (r) return { report: r, cle: `historique_${i + 1}` };
  }
  return { report: null, cle: null };
}

const decryptReport = (encrypted) => decryptReportDetaille(encrypted).report;

module.exports = {
  ENCRYPTION_KEY,
  clesHistoriques,
  encryptReport,
  essayerCle,
  decryptReport,
  decryptReportDetaille,
};

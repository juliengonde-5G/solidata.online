/**
 * Analyse STRICTE d'un PNG de signature avant de le confier à pdfkit.
 *
 * Pourquoi ce module existe (revue de sécurité 06/09/2026, constats C-01/C-02) :
 * pdfkit délègue le décodage PNG à png-js, qui (1) lève l'erreur zlib d'un flux
 * IDAT corrompu DANS un callback — hors de tout try/catch, le processus meurt —
 * et (2) alloue largeur × hauteur × 4 octets sur la seule foi de l'en-tête IHDR,
 * si bien que 74 octets forgés (20 000 × 20 000) font consommer 1,6 Go et
 * bloquer l'API pendant dix secondes. Contrôler les 4 octets magiques ne
 * protège de rien : il faut refaire ici, de façon bornée, ce que le décodeur
 * fera ensuite sans filet.
 *
 * Ce que ce module vérifie, dans l'ordre et sans jamais allouer plus que la
 * borne : signature PNG, IHDR en premier chunk, dimensions ≤ PNG_MAX_COTE et
 * pixels ≤ PNG_MAX_PIXELS, profondeur / type de couleur / méthodes connus,
 * non entrelacé (un canvas ne produit jamais d'entrelacé), chaque chunk
 * contenu dans le tampon avec un CRC32 exact, un IEND terminal, et un flux IDAT
 * qui se décompresse SANS erreur et à la taille EXACTE attendue
 * (hauteur × (1 + octets par ligne)) sous un plafond `maxOutputLength`.
 *
 * Module PUR : aucune E/S. CRC32 implémenté ici car `zlib.crc32` n'existe qu'à
 * partir de Node 22.2 et l'image de production est en Node 20.
 */

'use strict';

const zlib = require('zlib');

const PNG_MAX_COTE = 2000;          // un pad de signature fait 600 × 220
const PNG_MAX_PIXELS = 1200 * 600;  // borne sur l'allocation du décodeur
const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CANAUX_PAR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PROFONDEURS_PAR_TYPE = {
  0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16],
};

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, debut, fin) {
  let c = 0xffffffff;
  for (let i = debut; i < fin; i += 1) c = TABLE_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {Buffer} buf
 * @returns {{ok: true, largeur: number, hauteur: number} | {ok: false, motif: string}}
 */
function analyserPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 + 25 + 12) return { ok: false, motif: 'format' };
  if (!buf.subarray(0, 8).equals(SIGNATURE_PNG)) return { ok: false, motif: 'format' };

  let pos = 8;
  let ihdr = null;
  const idat = [];
  let iend = false;
  let premier = true;

  while (pos + 12 <= buf.length) {
    const longueur = buf.readUInt32BE(pos);
    if (longueur > 0x7fffffff || pos + 12 + longueur > buf.length) return { ok: false, motif: 'format' };
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const dataDebut = pos + 8;
    const dataFin = dataDebut + longueur;
    const crcAttendu = buf.readUInt32BE(dataFin);
    if (crc32(buf, pos + 4, dataFin) !== crcAttendu) return { ok: false, motif: 'crc' };

    if (premier) {
      if (type !== 'IHDR' || longueur !== 13) return { ok: false, motif: 'format' };
      premier = false;
    }
    if (type === 'IHDR') {
      if (ihdr) return { ok: false, motif: 'format' };
      const largeur = buf.readUInt32BE(dataDebut);
      const hauteur = buf.readUInt32BE(dataDebut + 4);
      const profondeur = buf[dataDebut + 8];
      const couleur = buf[dataDebut + 9];
      const compression = buf[dataDebut + 10];
      const filtre = buf[dataDebut + 11];
      const entrelace = buf[dataDebut + 12];
      if (largeur === 0 || hauteur === 0 || largeur > PNG_MAX_COTE || hauteur > PNG_MAX_COTE
        || largeur * hauteur > PNG_MAX_PIXELS) return { ok: false, motif: 'dimensions' };
      if (!(couleur in CANAUX_PAR_TYPE) || !PROFONDEURS_PAR_TYPE[couleur].includes(profondeur)) {
        return { ok: false, motif: 'format' };
      }
      if (compression !== 0 || filtre !== 0 || entrelace !== 0) return { ok: false, motif: 'format' };
      ihdr = { largeur, hauteur, profondeur, couleur };
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(dataDebut, dataFin));
    } else if (type === 'IEND') {
      iend = true;
      pos = dataFin + 4;
      break;
    }
    pos = dataFin + 4;
  }

  if (!ihdr || !iend || idat.length === 0) return { ok: false, motif: 'format' };
  if (pos !== buf.length) return { ok: false, motif: 'format' };

  const bitsParPixel = CANAUX_PAR_TYPE[ihdr.couleur] * ihdr.profondeur;
  const octetsParLigne = Math.ceil((ihdr.largeur * bitsParPixel) / 8);
  const attendu = ihdr.hauteur * (1 + octetsParLigne);

  let brut;
  try {
    brut = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: attendu });
  } catch (_) {
    return { ok: false, motif: 'idat' };
  }
  if (brut.length !== attendu) return { ok: false, motif: 'idat' };

  return { ok: true, largeur: ihdr.largeur, hauteur: ihdr.hauteur };
}

module.exports = { analyserPng, crc32, PNG_MAX_COTE, PNG_MAX_PIXELS };

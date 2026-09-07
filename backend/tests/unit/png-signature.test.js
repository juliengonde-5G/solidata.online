// ═══════════════════════════════════════════════════════════════════════════
// TESTS UNITAIRES — analyse stricte d'un PNG de signature (utils/png-signature.js)
// ───────────────────────────────────────────────────────────────────────────
// Revue de sécurité du 06/09/2026 (C-01/C-02) : un PNG dont seuls les 4 octets
// magiques sont contrôlés peut tuer le processus (IDAT corrompu → erreur zlib
// levée dans un callback de png-js) ou saturer la mémoire (IHDR 20 000 × 20 000).
// Les PNG de ces tests sont FORGÉS ici même : aucune image du dépôt n'est requise.
// ═══════════════════════════════════════════════════════════════════════════
const zlib = require('zlib');
const { analyserPng, crc32, PNG_MAX_COTE } = require('../../src/utils/png-signature');
const { genererBordereauPdf } = require('../../src/utils/bordereau-decheterie-pdf');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data, { crcFaux = false } = {}) {
  const t = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const corps = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE((crc32(corps, 0, corps.length) ^ (crcFaux ? 1 : 0)) >>> 0);
  return Buffer.concat([len, corps, crc]);
}

function ihdr(largeur, hauteur, { profondeur = 8, couleur = 6, entrelace = 0 } = {}) {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(largeur, 0); d.writeUInt32BE(hauteur, 4);
  d[8] = profondeur; d[9] = couleur; d[10] = 0; d[11] = 0; d[12] = entrelace;
  return d;
}

/** PNG RGBA valide de largeur × hauteur (pixels opaques noirs). */
function pngValide(largeur, hauteur) {
  const brut = Buffer.alloc(hauteur * (1 + largeur * 4), 0);
  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) brut[y * (1 + largeur * 4) + 1 + x * 4 + 3] = 255;
  }
  return Buffer.concat([
    SIG, chunk('IHDR', ihdr(largeur, hauteur)), chunk('IDAT', zlib.deflateSync(brut)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('analyserPng — ce qu\'il accepte', () => {
  it('un PNG RGBA valide de la taille d\'un pad de signature', () => {
    const r = analyserPng(pngValide(600, 220));
    expect(r).toEqual({ ok: true, largeur: 600, hauteur: 220 });
  });
  it('un PNG 1 × 1 (le plus petit possible)', () => {
    expect(analyserPng(pngValide(1, 1)).ok).toBe(true);
  });
  it('crc32 : vecteur connu (« 123456789 » → 0xCBF43926)', () => {
    const b = Buffer.from('123456789');
    expect(crc32(b, 0, b.length)).toBe(0xcbf43926);
  });
});

describe('analyserPng — ce qu\'il refuse (chaque cas est une attaque mesurée en revue)', () => {
  it('C-02 : IHDR 20 000 × 20 000 avec un IDAT zlib valide → refusé AVANT toute allocation', () => {
    const forge = Buffer.concat([
      SIG, chunk('IHDR', ihdr(20000, 20000)), chunk('IDAT', zlib.deflateSync(Buffer.alloc(10))), chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(forge.length).toBeLessThan(120);
    expect(analyserPng(forge)).toEqual({ ok: false, motif: 'dimensions' });
  });
  it('dimensions juste au-dessus des bornes → refusé, juste en dessous → accepté', () => {
    expect(analyserPng(pngValide(PNG_MAX_COTE + 1, 1)).ok).toBe(false);
    expect(analyserPng(pngValide(1200, 601)).ok).toBe(false); // > PNG_MAX_PIXELS
    expect(analyserPng(pngValide(1200, 600)).ok).toBe(true);
  });
  it('C-01 : IDAT corrompu (octets aléatoires) → refusé, sans lever', () => {
    const forge = Buffer.concat([
      SIG, chunk('IHDR', ihdr(4, 4)), chunk('IDAT', Buffer.from('pas du zlib du tout')), chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(analyserPng(forge)).toEqual({ ok: false, motif: 'idat' });
  });
  it('IDAT valide mais trop COURT pour les dimensions annoncées → refusé', () => {
    const forge = Buffer.concat([
      SIG, chunk('IHDR', ihdr(100, 100)), chunk('IDAT', zlib.deflateSync(Buffer.alloc(50))), chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(analyserPng(forge)).toEqual({ ok: false, motif: 'idat' });
  });
  it('IDAT valide mais trop LONG (bombe de décompression bornée par maxOutputLength) → refusé', () => {
    const forge = Buffer.concat([
      SIG, chunk('IHDR', ihdr(2, 2)), chunk('IDAT', zlib.deflateSync(Buffer.alloc(200000))), chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(analyserPng(forge)).toEqual({ ok: false, motif: 'idat' });
  });
  it('CRC d\'un chunk faux → refusé', () => {
    const forge = Buffer.concat([
      SIG, chunk('IHDR', ihdr(2, 2), { crcFaux: true }), chunk('IDAT', zlib.deflateSync(Buffer.alloc(18))), chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(analyserPng(forge)).toEqual({ ok: false, motif: 'crc' });
  });
  it('tronqué (pas d\'IEND), signature seule, entrelacé, type de couleur inconnu, données après IEND → refusés', () => {
    const ok = pngValide(4, 4);
    expect(analyserPng(ok.subarray(0, ok.length - 12)).ok).toBe(false);
    expect(analyserPng(SIG).ok).toBe(false);
    expect(analyserPng(Buffer.concat([SIG, chunk('IHDR', ihdr(4, 4, { entrelace: 1 })), chunk('IDAT', zlib.deflateSync(Buffer.alloc(68))), chunk('IEND', Buffer.alloc(0))])).ok).toBe(false);
    expect(analyserPng(Buffer.concat([SIG, chunk('IHDR', ihdr(4, 4, { couleur: 5 })), chunk('IDAT', zlib.deflateSync(Buffer.alloc(68))), chunk('IEND', Buffer.alloc(0))])).ok).toBe(false);
    expect(analyserPng(Buffer.concat([ok, Buffer.from('surplus')])).ok).toBe(false);
    expect(analyserPng(null).ok).toBe(false);
  });
});

describe('Le générateur PDF ne confie JAMAIS un PNG douteux à pdfkit', () => {
  const base = {
    date_enlevement: '2026-09-04T09:12:00Z', decheterie_code: 'cleon', tlc_kg: 10, validation: null,
  };
  it('PNG forgé 20 000 × 20 000 en signature → PDF rendu avec « Signature non recueillie », en moins d\'une seconde', async () => {
    const forge = Buffer.concat([
      SIG, chunk('IHDR', ihdr(20000, 20000)), chunk('IDAT', zlib.deflateSync(Buffer.alloc(10))), chunk('IEND', Buffer.alloc(0)),
    ]);
    const debut = Date.now();
    const buf = await genererBordereauPdf({ ...base, signature_agent: forge, signature_chauffeur: forge });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(Date.now() - debut).toBeLessThan(1000);
  });
  it('IDAT corrompu en signature → le processus survit et le PDF se génère', async () => {
    const forge = Buffer.concat([
      SIG, chunk('IHDR', ihdr(4, 4)), chunk('IDAT', Buffer.from('pas du zlib du tout')), chunk('IEND', Buffer.alloc(0)),
    ]);
    const buf = await genererBordereauPdf({ ...base, signature_agent: forge, signature_chauffeur: pngValide(50, 20) });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });
});

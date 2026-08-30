// ═══════════════════════════════════════════════════════════════════════════
// TOTP (RFC 6238) — utils/totp.js
// ───────────────────────────────────────────────────────────────────────────
// Le cœur de ce fichier, ce sont les VECTEURS OFFICIELS de la RFC 6238
// (annexe B). Écrire soi-même un algorithme cryptographique n'est acceptable
// qu'à une condition : le confronter à la référence publiée. Six instants, six
// codes attendus — si l'un d'eux tombe, l'implémentation est fausse, point.
//
// Le vecteur T=20000000000 n'est pas là pour faire nombre : son compteur
// (666 666 666) dépasse ce qu'un entier JavaScript manipulé en opérations
// bit-à-bit sait représenter. C'est le piège classique des implémentations
// maison, et c'est exactement ce que ce vecteur débusque.
//
// Module PUR : aucune base, aucun réseau, aucun mock.
// ═══════════════════════════════════════════════════════════════════════════
const totpLib = require('../../src/utils/totp');

// RFC 6238 annexe B : secret ASCII « 12345678901234567890 » (20 octets), SHA-1,
// codes à 8 chiffres.
const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET_B32 = totpLib.base32Encode(Buffer.from(RFC_SECRET_ASCII, 'ascii'));

describe('vecteurs officiels RFC 6238 (annexe B, SHA-1)', () => {
  const VECTEURS = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'], // compteur > 2^32 : le cas qui casse les entiers 32 bits
  ];

  test.each(VECTEURS)('T=%s → %s', (tSeconds, attendu) => {
    expect(totpLib.totp(RFC_SECRET_B32, { time: tSeconds * 1000, digits: 8 })).toBe(attendu);
  });

  test('le secret de la RFC se ré-encode bien en Base32 canonique', () => {
    expect(RFC_SECRET_B32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });
});

describe('Base32 (RFC 4648)', () => {
  test('aller-retour sur des tailles variées', () => {
    for (const n of [1, 2, 3, 4, 5, 7, 10, 16, 20, 32, 64]) {
      const buf = require('crypto').randomBytes(n);
      expect(totpLib.base32Decode(totpLib.base32Encode(buf)).equals(buf)).toBe(true);
    }
  });

  test('tolère la saisie humaine : minuscules, espaces, tirets, remplissage', () => {
    const canonique = totpLib.base32Decode(RFC_SECRET_B32);
    for (const variante of [
      RFC_SECRET_B32.toLowerCase(),
      'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ',
      'GEZD-GNBV-GY3T-QOJQ-GEZD-GNBV-GY3T-QOJQ',
      `${RFC_SECRET_B32}======`,
    ]) {
      expect(totpLib.base32Decode(variante).equals(canonique)).toBe(true);
    }
  });

  test('refuse franchement un caractère hors alphabet plutôt que de tronquer', () => {
    // 0, 1, 8 et 9 n'appartiennent PAS à l'alphabet Base32 : les accepter en les
    // ignorant produirait un secret silencieusement différent de celui saisi.
    expect(() => totpLib.base32Decode('ABCD0EFG')).toThrow(/invalide/i);
    expect(() => totpLib.base32Decode('')).toThrow();
    expect(() => totpLib.base32Decode(null)).toThrow();
  });
});

describe('generateSecret', () => {
  test('produit 20 octets d’entropie, en Base32 valide', () => {
    const s = totpLib.generateSecret();
    expect(totpLib.base32Decode(s)).toHaveLength(20);
    expect(s).toMatch(/^[A-Z2-7]+$/);
  });

  test('deux appels ne donnent jamais le même secret', () => {
    const lot = new Set(Array.from({ length: 50 }, () => totpLib.generateSecret()));
    expect(lot.size).toBe(50);
  });
});

describe('verifyTotp — fenêtre de tolérance', () => {
  const secret = totpLib.generateSecret();
  const T = 1700000000000; // instant de référence, en millisecondes

  test('accepte le code du pas courant', () => {
    expect(totpLib.verifyTotp(secret, totpLib.totp(secret, { time: T }), { time: T })).toBe(true);
  });

  test('accepte le pas précédent et le suivant (± 30 s)', () => {
    for (const decalage of [-30000, 30000]) {
      const code = totpLib.totp(secret, { time: T + decalage });
      expect(totpLib.verifyTotp(secret, code, { time: T })).toBe(true);
    }
  });

  test('REFUSE au-delà de la fenêtre (± 60 s et plus)', () => {
    for (const decalage of [-90000, -60000, 60000, 90000]) {
      const code = totpLib.totp(secret, { time: T + decalage });
      expect(totpLib.verifyTotp(secret, code, { time: T })).toBe(false);
    }
  });

  test('window: 0 n’accepte que le pas courant', () => {
    const precedent = totpLib.totp(secret, { time: T - 30000 });
    expect(totpLib.verifyTotp(secret, precedent, { time: T, window: 0 })).toBe(false);
  });

  test('refuse un code d’un AUTRE secret', () => {
    const autre = totpLib.generateSecret();
    expect(totpLib.verifyTotp(secret, totpLib.totp(autre, { time: T }), { time: T })).toBe(false);
  });

  test('refuse tout ce qui n’a pas la forme d’un code, sans jamais lever', () => {
    for (const saisie of ['', '12345', '1234567', 'abcdef', '12345a', null, undefined, {}, '   ']) {
      expect(totpLib.verifyTotp(secret, saisie, { time: T })).toBe(false);
    }
  });

  test('un secret illisible fait échouer la vérification, jamais planter', () => {
    expect(totpLib.verifyTotp('pas-un-secret-base32!', '123456', { time: T })).toBe(false);
  });

  test('tolère les espaces de recopie dans le code saisi', () => {
    const code = totpLib.totp(secret, { time: T });
    const espace = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(totpLib.verifyTotp(secret, espace, { time: T })).toBe(true);
  });
});

describe('safeEqual', () => {
  test('vrai sur l’égalité, faux sinon, y compris sur des longueurs différentes', () => {
    expect(totpLib.safeEqual('123456', '123456')).toBe(true);
    expect(totpLib.safeEqual('123456', '123457')).toBe(false);
    expect(totpLib.safeEqual('123456', '12345')).toBe(false);
    expect(totpLib.safeEqual('', '')).toBe(true);
  });
});

describe('codes de secours', () => {
  test('8 codes au format XXXXX-XXXXX par défaut', () => {
    const codes = totpLib.generateBackupCodes();
    expect(codes).toHaveLength(8);
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
      expect(totpLib.BACKUP_CODE_REGEX.test(c)).toBe(true);
    }
  });

  test('l’alphabet exclut les caractères ambigus 0, O, 1, I', () => {
    // Un code de secours se lit sur une feuille imprimée, un jour de panne :
    // confondre O et 0 y coûte une tentative sur huit.
    const codes = totpLib.generateBackupCodes(40).join('');
    for (const ambigu of ['0', 'O', '1', 'I']) {
      expect(codes.includes(ambigu)).toBe(false);
    }
  });

  test('aucune collision sur un lot important', () => {
    expect(new Set(totpLib.generateBackupCodes(200)).size).toBe(200);
  });

  test('hashBackupCode est stable, normalise la casse et les espaces', () => {
    const h = totpLib.hashBackupCode('ABCDE-FGHJK');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(totpLib.hashBackupCode('abcde-fghjk')).toBe(h);
    expect(totpLib.hashBackupCode(' ABCDE-FGHJK ')).toBe(h);
    expect(totpLib.hashBackupCode('ABCDE-FGHJL')).not.toBe(h);
  });

  test('l’empreinte ne laisse pas transparaître le code', () => {
    const [code] = totpLib.generateBackupCodes(1);
    expect(totpLib.hashBackupCode(code)).not.toContain(code.replace('-', ''));
  });
});

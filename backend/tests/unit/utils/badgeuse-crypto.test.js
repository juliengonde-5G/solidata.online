/**
 * Module 33 « Temps & Présence » — primitives cryptographiques.
 *
 * Ce fichier verrouille les VECTEURS DE TEST PARTAGÉS avec le poste embarqué
 * (docs/badgeuse/CONTRAT_HMAC.md §4, CONTRAT_INTEGRITE.md). Les deux piles —
 * `backend/tests/unit/utils/badgeuse-crypto.test.js` et
 * `badgeuse/agent/tests/test_hmac.py` — DOIVENT produire les mêmes condensats :
 * si l'une des deux dérive, les pointages du poste deviennent invérifiables.
 * À ce titre ces valeurs ne doivent JAMAIS être « ajustées » pour faire passer
 * un test : c'est le code qui doit se conformer au contrat.
 */
const crypto = require('crypto');
const {
  normalizeUid, hmacUid, canonicalPointage, genesisHash, chainHash,
  hashDeviceKey, timingSafeEqualHex, encryptSecret, decryptSecret,
  generateDeviceKey, generateSiteKey, isoMillisUTC,
} = require('../../../src/utils/badgeuse-crypto');

// ── Vecteurs du contrat (à ne pas modifier) ────────────────────────────────
const CLE_SITE = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const UID_LU = '04 A2 3B 1C';
const UID_NORMALISE = '04A23B1C';
const UID_HMAC = '6af79677ac212277ce9caf53668e1561c75c43aaba28c6588da17c55915551d8';
const GENESIS_LH_P1 = '07b7f5a016835efbc0fc3d021acfbae7a1e74f063531d133e2bab27b8207b1ab';
const CANONICAL_VECTEUR = `11111111-2222-4333-8444-555555555555|LH-P1|1|${UID_HMAC}|2026-08-17T06:58:12.031Z|entree|badge`;
const CHAIN_VECTEUR = '07914d17bc6248178da6c6e859fc48b8d7dfa4d04e0b61f5a081ad4d3c8ff3ed';

describe('CONTRAT_HMAC §4 — vecteur de test partagé avec le poste', () => {
  test('uid « 04 A2 3B 1C » → uid_hmac du contrat, au caractère près', () => {
    expect(normalizeUid(UID_LU)).toBe(UID_NORMALISE);
    expect(hmacUid(CLE_SITE, normalizeUid(UID_LU))).toBe(UID_HMAC);
  });

  test('la clé est décodée HEX → OCTETS avant HMAC (point de contrat critique)', () => {
    // Si l'implémentation prenait la clé comme chaîne ASCII, le condensat
    // différerait : ce test attrape précisément cette erreur classique.
    const faux = crypto.createHmac('sha256', CLE_SITE).update(UID_NORMALISE).digest('hex');
    expect(faux).not.toBe(UID_HMAC);
    expect(hmacUid(CLE_SITE, UID_NORMALISE)).toBe(UID_HMAC);
  });

  test('le message est la chaîne ASCII de l\'UID normalisé, pas ses octets décodés', () => {
    const faux = crypto.createHmac('sha256', Buffer.from(CLE_SITE, 'hex'))
      .update(Buffer.from(UID_NORMALISE, 'hex')).digest('hex');
    expect(faux).not.toBe(UID_HMAC);
  });

  test('le condensat est en hex minuscule sur 64 caractères', () => {
    expect(UID_HMAC).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacUid(CLE_SITE, UID_NORMALISE)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('normalizeUid — CONTRAT_HMAC §2', () => {
  test('retire les séparateurs et passe en majuscules', () => {
    for (const forme of ['04A23B1C', '04:a2:3b:1c', '04-A2-3B-1C', ' 04 a2 3B 1c \r\n', '04a23b1c']) {
      expect(normalizeUid(forme)).toBe(UID_NORMALISE);
    }
  });

  test('toutes les formes d\'un même badge donnent le MÊME uid_hmac', () => {
    const condensats = ['04A23B1C', '04:a2:3b:1c', '04 A2 3B 1C']
      .map((f) => hmacUid(CLE_SITE, normalizeUid(f)));
    expect(new Set(condensats).size).toBe(1);
    expect(condensats[0]).toBe(UID_HMAC);
  });

  test('lecteur en mode DÉCIMAL : 10 chiffres → hexadécimal 8 caractères zéro-paddé', () => {
    // 0x04A23B1C = 77 740 828 → zéro-paddé à 10 chiffres en sortie lecteur.
    expect(normalizeUid('0077740828')).toBe(UID_NORMALISE);
    // Le condensat doit alors être identique à celui du même badge lu en hex :
    // c'est tout l'intérêt de la normalisation (SPEC §3.6) — le même badge ne
    // doit pas devenir « inconnu » parce qu'on a reconfiguré le lecteur.
    expect(hmacUid(CLE_SITE, normalizeUid('0077740828'))).toBe(UID_HMAC);
  });

  test('décimal : le zéro-padding porte bien sur 8 caractères hex', () => {
    expect(normalizeUid('0000000255')).toBe('000000FF');
  });

  test('longueurs acceptées : 8, 14, 20 (UID 4, 7 ou 10 octets)', () => {
    expect(normalizeUid('A'.repeat(8))).toBe('A'.repeat(8));
    expect(normalizeUid('A'.repeat(14))).toBe('A'.repeat(14));
    expect(normalizeUid('A'.repeat(20))).toBe('A'.repeat(20));
  });

  test('toute autre longueur est REJETÉE (aucun enregistrement d\'une lecture non conforme)', () => {
    for (const invalide of ['A'.repeat(6), 'A'.repeat(9), 'A'.repeat(12), 'A'.repeat(16), 'A'.repeat(22)]) {
      expect(normalizeUid(invalide)).toBeNull();
    }
  });

  test('entrées vides ou non hexadécimales → null (jamais d\'exception)', () => {
    for (const vide of [null, undefined, '', '   ', 'zzzz', ':::-:::']) {
      expect(normalizeUid(vide)).toBeNull();
    }
  });

  test('hmacUid refuse une clé de site malformée plutôt que de produire un faux condensat', () => {
    expect(hmacUid('trop-court', UID_NORMALISE)).toBeNull();
    expect(hmacUid(CLE_SITE, null)).toBeNull();
    expect(hmacUid(null, UID_NORMALISE)).toBeNull();
  });
});

describe('CONTRAT_INTEGRITE — genèse, charge canonique et chaînage', () => {
  test('genesis("LH-P1") = SHA256("genesis:LH-P1") — vecteur du contrat', () => {
    expect(genesisHash('LH-P1')).toBe(GENESIS_LH_P1);
  });

  test('canonical : 7 champs, séparateur « | », dans l\'ordre du contrat', () => {
    const canonical = canonicalPointage({
      uuid: '11111111-2222-4333-8444-555555555555',
      device_code: 'LH-P1',
      sequence_device: 1,
      uid_hmac: UID_HMAC,
      horodatage_utc: '2026-08-17T06:58:12.031Z',
      sens: 'entree',
      source: 'badge',
    });
    expect(canonical).toBe(CANONICAL_VECTEUR);
    expect(canonical.split('|')).toHaveLength(7);
  });

  test('chain(genesis, canonical) = vecteur du contrat', () => {
    expect(chainHash(GENESIS_LH_P1, CANONICAL_VECTEUR)).toBe(CHAIN_VECTEUR);
  });

  test('« || » est la concaténation des CHAÎNES, pas celle des octets décodés', () => {
    // Ambiguïté que le vecteur du contrat tranche : une implémentation qui
    // concaténerait Buffer.from(hash,'hex') avec la charge produirait un autre
    // condensat, et le poste Python deviendrait invérifiable.
    const versionOctets = crypto.createHash('sha256')
      .update(Buffer.concat([Buffer.from(GENESIS_LH_P1, 'hex'), Buffer.from(CANONICAL_VECTEUR, 'utf8')]))
      .digest('hex');
    expect(versionOctets).not.toBe(CHAIN_VECTEUR);
    expect(chainHash(GENESIS_LH_P1, CANONICAL_VECTEUR)).toBe(CHAIN_VECTEUR);
  });

  test('un pointage manuel sans badge porte le « - » littéral en uid_hmac', () => {
    const canonical = canonicalPointage({
      uuid: '11111111-2222-4333-8444-555555555555',
      device_code: 'LH-P1', sequence_device: 7, uid_hmac: null,
      horodatage_utc: '2026-08-17T06:58:12.031Z', sens: 'entree', source: 'manuel',
    });
    expect(canonical.split('|')[3]).toBe('-');
  });

  test('sequence_device est en base 10 sans zéros de tête', () => {
    const canonical = canonicalPointage({
      uuid: 'u', device_code: 'D', sequence_device: '007',
      uid_hmac: UID_HMAC, horodatage_utc: '2026-08-17T06:58:12.031Z', sens: 'entree', source: 'badge',
    });
    expect(canonical.split('|')[2]).toBe('7');
  });

  test('INALTÉRABILITÉ : modifier un seul champ change le hash (détection d\'un UPDATE en base)', () => {
    const base = {
      uuid: '11111111-2222-4333-8444-555555555555', device_code: 'LH-P1', sequence_device: 1,
      uid_hmac: UID_HMAC, horodatage_utc: '2026-08-17T06:58:12.031Z', sens: 'entree', source: 'badge',
    };
    const reference = chainHash(GENESIS_LH_P1, canonicalPointage(base));
    // Horodatage falsifié d'une SEULE milliseconde.
    const falsifie = chainHash(GENESIS_LH_P1, canonicalPointage({ ...base, horodatage_utc: '2026-08-17T06:58:12.032Z' }));
    expect(falsifie).not.toBe(reference);
    // Sens inversé.
    expect(chainHash(GENESIS_LH_P1, canonicalPointage({ ...base, sens: 'sortie' }))).not.toBe(reference);
    // Maillon précédent différent → toute la suite de la chaîne diverge.
    expect(chainHash(genesisHash('LH-P2'), canonicalPointage(base))).not.toBe(reference);
  });

  test('isoMillisUTC : format YYYY-MM-DDTHH:MM:SS.mmmZ, jamais réécrit s\'il est déjà conforme', () => {
    expect(isoMillisUTC('2026-08-17T06:58:12.031Z')).toBe('2026-08-17T06:58:12.031Z');
    expect(isoMillisUTC(new Date('2026-08-17T06:58:12.031Z'))).toBe('2026-08-17T06:58:12.031Z');
    expect(isoMillisUTC('pas une date')).toBeNull();
  });
});

describe('clés device — condensat stocké et comparaison à temps constant', () => {
  test('hashDeviceKey rend le SHA-256 hex de la clé', () => {
    const key = 'a'.repeat(64);
    expect(hashDeviceKey(key)).toBe(crypto.createHash('sha256').update(key).digest('hex'));
    expect(hashDeviceKey(key)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('generateDeviceKey / generateSiteKey : 256 bits hex, jamais deux fois la même', () => {
    for (const gen of [generateDeviceKey, generateSiteKey]) {
      const a = gen();
      const b = gen();
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(a).not.toBe(b);
    }
  });

  test('timingSafeEqualHex : vrai sur l\'égalité, faux sinon, jamais d\'exception', () => {
    const h = hashDeviceKey('secret');
    expect(timingSafeEqualHex(h, h)).toBe(true);
    expect(timingSafeEqualHex(h, hashDeviceKey('autre'))).toBe(false);
    // Longueurs différentes (cas qui ferait planter crypto.timingSafeEqual nu).
    expect(timingSafeEqualHex(h, 'abc')).toBe(false);
    expect(timingSafeEqualHex(h, null)).toBe(false);
    expect(timingSafeEqualHex(null, null)).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(false);
  });
});

describe('chiffrement des secrets au repos (clé HMAC de site)', () => {
  const OLD = process.env.BADGEUSE_ENCRYPTION_KEY;
  beforeAll(() => { process.env.BADGEUSE_ENCRYPTION_KEY = 'cle-de-test-badgeuse'; });
  afterAll(() => {
    if (OLD === undefined) delete process.env.BADGEUSE_ENCRYPTION_KEY;
    else process.env.BADGEUSE_ENCRYPTION_KEY = OLD;
  });

  test('aller-retour : le secret revient intact', () => {
    const secret = generateSiteKey();
    const chiffre = encryptSecret(secret);
    expect(chiffre).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(chiffre).not.toContain(secret); // le clair n'apparaît jamais
    expect(decryptSecret(chiffre)).toBe(secret);
  });

  test('deux chiffrements du même secret diffèrent (IV aléatoire)', () => {
    expect(encryptSecret('meme-secret')).not.toBe(encryptSecret('meme-secret'));
  });

  test('un payload altéré ne se déchiffre pas (authentification GCM)', () => {
    const chiffre = encryptSecret('secret');
    const [, iv, tag, enc] = chiffre.split(':');
    const altere = `v1:${iv}:${tag}:${Buffer.from('charge falsifiee').toString('base64')}`;
    expect(decryptSecret(altere)).toBeNull();
    expect(decryptSecret(`v1:${iv}:${Buffer.from('faux-tag').toString('base64')}:${enc}`)).toBeNull();
  });

  test('valeurs vides : encrypt rend null, decrypt tolère', () => {
    expect(encryptSecret(null)).toBeNull();
    expect(encryptSecret('')).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });
});

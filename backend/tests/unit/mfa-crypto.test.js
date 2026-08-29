// ═══════════════════════════════════════════════════════════════════════════
// Chiffrement du secret TOTP — utils/mfa-crypto.js
// ───────────────────────────────────────────────────────────────────────────
// Ce que ces tests protègent :
//   1. l'aller-retour (un secret enrôlé doit rester lisible) ;
//   2. le fait qu'une MAUVAISE clé échoue VRAIMENT — c'est toute la raison
//      d'avoir choisi AES-256-GCM plutôt que le CBC de utils/field-crypto.js,
//      qui avait dû inventer une sentinelle pour compenser ;
//   3. la doctrine « jamais de crash » : toute anomalie rend null, jamais une
//      exception qui ferait tomber la connexion de tout le monde ;
//   4. la cascade de clé documentée (MFA_ → PCM_ → JWT_SECRET).
// ═══════════════════════════════════════════════════════════════════════════

// Les clés sont résolues À L'APPEL : chaque test peut donc réécrire l'environnement.
const ENV_INITIAL = { ...process.env };

function resetEnv() {
  for (const k of ['MFA_ENCRYPTION_KEY', 'PCM_ENCRYPTION_KEY', 'JWT_SECRET']) delete process.env[k];
  Object.assign(process.env, {
    MFA_ENCRYPTION_KEY: ENV_INITIAL.MFA_ENCRYPTION_KEY,
    PCM_ENCRYPTION_KEY: ENV_INITIAL.PCM_ENCRYPTION_KEY,
    JWT_SECRET: ENV_INITIAL.JWT_SECRET,
  });
  for (const k of ['MFA_ENCRYPTION_KEY', 'PCM_ENCRYPTION_KEY', 'JWT_SECRET']) {
    if (process.env[k] === undefined) delete process.env[k];
  }
}

const mfaCrypto = require('../../src/utils/mfa-crypto');

beforeEach(() => {
  resetEnv();
  process.env.MFA_ENCRYPTION_KEY = 'cle-de-test-dediee-au-mfa';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  resetEnv();
});

describe('aller-retour', () => {
  test('un secret chiffré se relit à l’identique', () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const enc = mfaCrypto.encryptSecret(secret);
    expect(enc).toMatch(/^mfaenc:v1:/);
    expect(mfaCrypto.decryptSecret(enc)).toBe(secret);
  });

  test('le chiffré ne contient jamais le clair', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    expect(mfaCrypto.encryptSecret(secret)).not.toContain(secret);
  });

  test('deux chiffrements du MÊME secret diffèrent (IV aléatoire par écriture)', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const a = mfaCrypto.encryptSecret(secret);
    const b = mfaCrypto.encryptSecret(secret);
    expect(a).not.toBe(b);
    expect(mfaCrypto.decryptSecret(a)).toBe(secret);
    expect(mfaCrypto.decryptSecret(b)).toBe(secret);
  });

  test('le format annoncé est bien mfaenc:v1:<iv>:<tag>:<data>', () => {
    const enc = mfaCrypto.encryptSecret('JBSWY3DPEHPK3PXP');
    const parts = enc.slice('mfaenc:v1:'.length).split(':');
    expect(parts).toHaveLength(3);
    expect(Buffer.from(parts[0], 'base64')).toHaveLength(12); // IV GCM
    expect(Buffer.from(parts[1], 'base64')).toHaveLength(16); // étiquette
    expect(mfaCrypto.isEncryptedSecret(enc)).toBe(true);
  });
});

describe('une mauvaise clé ÉCHOUE (raison d’être du mode GCM)', () => {
  test('changer de clé rend null, et jamais du charabia', () => {
    const enc = mfaCrypto.encryptSecret('JBSWY3DPEHPK3PXP');
    process.env.MFA_ENCRYPTION_KEY = 'une-toute-autre-cle';
    expect(mfaCrypto.decryptSecret(enc)).toBeNull();
  });

  test('une valeur altérée d’un seul octet est rejetée', () => {
    const enc = mfaCrypto.encryptSecret('JBSWY3DPEHPK3PXP');
    const parts = enc.slice('mfaenc:v1:'.length).split(':');
    const data = Buffer.from(parts[2], 'base64');
    data[0] ^= 0xff;
    const altere = `mfaenc:v1:${parts[0]}:${parts[1]}:${data.toString('base64')}`;
    expect(mfaCrypto.decryptSecret(altere)).toBeNull();
  });

  test('une étiquette d’authentification remplacée est rejetée', () => {
    const enc = mfaCrypto.encryptSecret('JBSWY3DPEHPK3PXP');
    const parts = enc.slice('mfaenc:v1:'.length).split(':');
    const faux = `mfaenc:v1:${parts[0]}:${Buffer.alloc(16, 7).toString('base64')}:${parts[2]}`;
    expect(mfaCrypto.decryptSecret(faux)).toBeNull();
  });
});

describe('jamais de crash', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['chaîne vide', ''],
    ['clair sans préfixe', 'JBSWY3DPEHPK3PXP'],
    ['préfixe seul', 'mfaenc:v1:'],
    ['nombre de segments faux', 'mfaenc:v1:aaa:bbb'],
    ['base64 illisible', 'mfaenc:v1:!!!:???:***'],
    ['IV de taille aberrante', 'mfaenc:v1:AAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA'],
  ])('decryptSecret(%s) rend null sans lever', (_libelle, valeur) => {
    expect(() => mfaCrypto.decryptSecret(valeur)).not.toThrow();
    expect(mfaCrypto.decryptSecret(valeur)).toBeNull();
  });

  test('une valeur SANS préfixe n’est jamais prise pour un secret valide', () => {
    // La colonne est née chiffrée : un clair y serait une anomalie. L'accepter
    // reviendrait à valider des codes calculés sur un secret non protégé.
    expect(mfaCrypto.decryptSecret('GEZDGNBVGY3TQOJQ')).toBeNull();
  });

  test('encryptSecret sur une entrée vide rend null sans lever', () => {
    for (const v of [null, undefined, '']) {
      expect(() => mfaCrypto.encryptSecret(v)).not.toThrow();
      expect(mfaCrypto.encryptSecret(v)).toBeNull();
    }
  });

  test('sans AUCUNE clé, on refuse de stocker plutôt que d’écrire en clair', () => {
    delete process.env.MFA_ENCRYPTION_KEY;
    delete process.env.PCM_ENCRYPTION_KEY;
    delete process.env.JWT_SECRET;
    expect(mfaCrypto.encryptSecret('JBSWY3DPEHPK3PXP')).toBeNull();
    expect(mfaCrypto.keySource()).toBeNull();
  });
});

describe('cascade de clé documentée', () => {
  test('MFA_ENCRYPTION_KEY prime sur les deux autres', () => {
    process.env.PCM_ENCRYPTION_KEY = 'pcm';
    process.env.JWT_SECRET = 'jwt';
    expect(mfaCrypto.keySource()).toBe('MFA_ENCRYPTION_KEY');
    const enc = mfaCrypto.encryptSecret('SECRET');
    delete process.env.MFA_ENCRYPTION_KEY; // on retombe sur PCM → illisible
    expect(mfaCrypto.decryptSecret(enc)).toBeNull();
  });

  test('à défaut, PCM_ENCRYPTION_KEY, puis JWT_SECRET', () => {
    delete process.env.MFA_ENCRYPTION_KEY;
    process.env.PCM_ENCRYPTION_KEY = 'pcm';
    process.env.JWT_SECRET = 'jwt';
    expect(mfaCrypto.keySource()).toBe('PCM_ENCRYPTION_KEY');
    expect(mfaCrypto.decryptSecret(mfaCrypto.encryptSecret('SECRET'))).toBe('SECRET');

    delete process.env.PCM_ENCRYPTION_KEY;
    expect(mfaCrypto.keySource()).toBe('JWT_SECRET');
    expect(mfaCrypto.decryptSecret(mfaCrypto.encryptSecret('SECRET'))).toBe('SECRET');
  });
});

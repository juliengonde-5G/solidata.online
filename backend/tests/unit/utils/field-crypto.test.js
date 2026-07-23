/**
 * Extension insertion 2026-07 (PR1) — chiffrement applicatif des champs
 * sensibles (D9 : santé art. 9, judiciaire art. 10).
 *
 * Contrat vérifié :
 * - chiffre/déchiffre en aller-retour, format 'encv1:<ciphertext>' ;
 * - passthrough du clair historique (valeur sans préfixe retournée telle
 *   quelle — rétro-compatibilité avec les données existantes) ;
 * - échec de déchiffrement (clé changée) → null, jamais un blob illisible ;
 * - repli de lecture sur la clé legacy JWT_SECRET (pattern PCM) ;
 * - résilience clé absente (aucun crash).
 *
 * Le module lit process.env À L'APPEL → on manipule l'env par test puis on
 * restaure tout.
 */
const {
  ENC_PREFIX,
  SENSITIVE_DIAG_FIELDS,
  encryptField,
  decryptField,
} = require('../../../src/utils/field-crypto');

const SAVED_ENV = {
  PCM_ENCRYPTION_KEY: process.env.PCM_ENCRYPTION_KEY,
  JWT_SECRET: process.env.JWT_SECRET,
};

function setEnv(pcmKey, jwtSecret) {
  if (pcmKey === undefined) delete process.env.PCM_ENCRYPTION_KEY;
  else process.env.PCM_ENCRYPTION_KEY = pcmKey;
  if (jwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = jwtSecret;
}

afterAll(() => {
  setEnv(SAVED_ENV.PCM_ENCRYPTION_KEY, SAVED_ENV.JWT_SECRET);
});

beforeEach(() => {
  setEnv('cle-pcm-de-test', 'jwt-secret-de-test');
});

describe('field-crypto — chiffrement/déchiffrement', () => {
  test('aller-retour : encryptField → préfixe encv1:, decryptField → texte d\'origine', () => {
    const clair = 'Suivi addictologie en cours, RDV CSAPA le mardi';
    const chiffre = encryptField(clair);
    expect(chiffre.startsWith(ENC_PREFIX)).toBe(true);
    expect(chiffre).not.toContain(clair);
    expect(decryptField(chiffre)).toBe(clair);
  });

  test('le chiffré varie (salt OpenSSL) mais déchiffre toujours', () => {
    const clair = 'donnée santé';
    const a = encryptField(clair);
    const b = encryptField(clair);
    expect(a).not.toBe(b); // salt aléatoire
    expect(decryptField(a)).toBe(clair);
    expect(decryptField(b)).toBe(clair);
  });

  test('anti double chiffrement : une valeur déjà encv1: est retournée telle quelle', () => {
    const chiffre = encryptField('texte');
    expect(encryptField(chiffre)).toBe(chiffre);
    expect(decryptField(chiffre)).toBe('texte');
  });

  test('valeurs vides : null / undefined / \'\' traversent sans modification', () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeUndefined();
    expect(encryptField('')).toBe('');
    expect(decryptField(null)).toBeNull();
    expect(decryptField(undefined)).toBeUndefined();
    expect(decryptField('')).toBe('');
  });
});

describe('field-crypto — rétro-compatibilité clair', () => {
  test('une valeur SANS préfixe encv1: (clair historique) est retournée telle quelle', () => {
    expect(decryptField('observation saisie avant le chiffrement')).toBe('observation saisie avant le chiffrement');
  });
});

describe('field-crypto — résilience', () => {
  test('déchiffrement avec une MAUVAISE clé → null (jamais un blob illisible)', () => {
    const chiffre = encryptField('secret médical');
    setEnv('autre-cle-primaire', 'autre-cle-legacy');
    expect(decryptField(chiffre)).toBeNull();
  });

  test('repli clé legacy : valeur chiffrée du temps où seul JWT_SECRET existait', () => {
    // Époque 1 : pas de PCM_ENCRYPTION_KEY → chiffrement avec JWT_SECRET.
    setEnv(undefined, 'ancien-jwt-secret');
    const chiffre = encryptField('texte historique');
    // Époque 2 : PCM_ENCRYPTION_KEY câblée — la clé primaire échoue, le
    // repli JWT_SECRET (inchangé) doit lire la valeur (pattern PCM).
    setEnv('nouvelle-cle-pcm', 'ancien-jwt-secret');
    expect(decryptField(chiffre)).toBe('texte historique');
  });

  test('clé absente : encryptField n\'explose pas et laisse le clair (garde fatale assurée par routes.js en prod)', () => {
    setEnv(undefined, undefined);
    expect(encryptField('texte sans clé')).toBe('texte sans clé');
    // Et decryptField sur un chiffré sans aucune clé → null, pas de throw.
    setEnv('une-cle', 'une-cle');
    const chiffre = encryptField('x');
    setEnv(undefined, undefined);
    expect(decryptField(chiffre)).toBeNull();
  });
});

describe('field-crypto — liste centrale des champs sensibles', () => {
  test('SENSITIVE_DIAG_FIELDS : santé (art. 9) + détail judiciaire (art. 10)', () => {
    expect(SENSITIVE_DIAG_FIELDS).toEqual([
      'commentaire_sante',
      'frein_sante_detail',
      'frein_sante_causes',
      'frein_judiciaire_detail',
    ]);
  });
});

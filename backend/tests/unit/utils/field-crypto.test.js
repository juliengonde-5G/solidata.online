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
const CryptoJS = require('crypto-js');
const {
  ENC_PREFIX,
  ENC_PREFIX_LEGACY,
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

  test('anti double chiffrement : une valeur déjà chiffrée est retournée telle quelle', () => {
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

describe('field-crypto — la mauvaise clé ne produit JAMAIS de faux texte', () => {
  // DÉFAUT CORRIGÉ (21/08/2026) : un déchiffrement AES avec la mauvaise clé
  // n'échoue pas de façon fiable — il rend des octets aléatoires qui forment
  // par hasard de l'UTF-8 valide dans ~0,5 % des cas. Sans la sentinelle, la
  // chaîne « clé primaire puis clé legacy » affichait donc parfois du charabia
  // (« ,\f », « K ») au lieu de basculer sur la clé legacy, et un
  // réenregistrement de la fiche aurait rechiffré ce charabia en DÉTRUISANT la
  // donnée. À 0,5 %, un seul essai passerait 199 fois sur 200 : la boucle est
  // le test, pas une précaution décorative.
  const ESSAIS = 400;

  test(`mauvaise clé → null, ${ESSAIS} fois sur ${ESSAIS}`, () => {
    for (let i = 0; i < ESSAIS; i++) {
      setEnv('cle-primaire', 'cle-primaire');
      const chiffre = encryptField('secret médical');
      setEnv('autre-cle-primaire', 'autre-cle-legacy');
      expect(decryptField(chiffre)).toBeNull();
    }
  });

  test(`le repli legacy aboutit ${ESSAIS} fois sur ${ESSAIS}`, () => {
    for (let i = 0; i < ESSAIS; i++) {
      setEnv(undefined, 'ancien-jwt-secret');
      const chiffre = encryptField('texte historique');
      setEnv('nouvelle-cle-pcm', 'ancien-jwt-secret');
      expect(decryptField(chiffre)).toBe('texte historique');
    }
  });
});

describe('field-crypto — lecture du format historique encv1:', () => {
  test('une valeur encv1: écrite avant le correctif reste lisible', () => {
    // Ces valeurs sont en base depuis juillet 2026 : cesser de les lire les
    // rendrait définitivement inaccessibles.
    const chiffre = ENC_PREFIX_LEGACY + CryptoJS.AES.encrypt('note santé v1', 'cle-pcm-de-test').toString();
    expect(decryptField(chiffre)).toBe('note santé v1');
  });

  test('une valeur encv1: n’est jamais re-chiffrée par-dessus', () => {
    const chiffre = ENC_PREFIX_LEGACY + CryptoJS.AES.encrypt('note santé v1', 'cle-pcm-de-test').toString();
    expect(encryptField(chiffre)).toBe(chiffre);
  });

  test('les nouvelles écritures utilisent le format encv2:', () => {
    expect(ENC_PREFIX).toBe('encv2:');
    expect(encryptField('x').startsWith('encv2:')).toBe(true);
  });
});

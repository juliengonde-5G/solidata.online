// Chiffrement des rapports PCM — les clés et l'ordre où on les essaie.
//
// Constat client du 26/08/2026 : les profils PCM récents s'ouvrent, les
// anciens non. Un rapport est chiffré avec la clé en vigueur le jour du test,
// et cette clé a changé deux fois (rotation du JWT_SECRET en v2.0.2, clé PCM
// dédiée en v2.0.5). Le point sensible testé ici : une mauvaise clé ne doit
// JAMAIS lever — l'exception remontait en « Erreur serveur », que l'écran
// avalait, et le clic sur « Voir profil » ne produisait rien du tout.
const CryptoJS = require('crypto-js');

const RAPPORT = { base: { type: 'empathique' }, phase: { type: 'promoteur' }, scores: { a: 100 } };

// Les clés sont figées à l'import du module : chaque cas recharge donc le
// module avec son propre environnement.
const ENV_INITIAL = { ...process.env };
afterEach(() => { process.env = { ...ENV_INITIAL }; });

function chargerAvec(env) {
  jest.resetModules();
  process.env = { ...ENV_INITIAL, ...env };
  return require('../../src/utils/pcm-crypto');
}

describe('decryptReportDetaille', () => {
  test('la clé du jour lit ce qu’elle a écrit', () => {
    const m = chargerAvec({ PCM_ENCRYPTION_KEY: 'cle-du-jour', JWT_SECRET: 'jwt' });
    const { report, cle } = m.decryptReportDetaille(m.encryptReport(RAPPORT));

    expect(cle).toBe('courante');
    expect(report).toEqual(RAPPORT);
  });

  test('un rapport chiffré avec l’ANCIEN JWT_SECRET reste lisible', () => {
    // Le cas des tests passés avant la mise en service de la clé PCM dédiée.
    const ancien = CryptoJS.AES.encrypt(JSON.stringify(RAPPORT), 'jwt-historique').toString();
    const m = chargerAvec({ PCM_ENCRYPTION_KEY: 'cle-du-jour', JWT_SECRET: 'jwt-historique' });
    const { report, cle } = m.decryptReportDetaille(ancien);

    expect(cle).toBe('historique_1');
    expect(report).toEqual(RAPPORT);
  });

  test('une clé retirée depuis, fournie en configuration, rouvre le rapport', () => {
    const perdu = CryptoJS.AES.encrypt(JSON.stringify(RAPPORT), 'cle-de-mars').toString();
    const m = chargerAvec({
      PCM_ENCRYPTION_KEY: 'cle-du-jour', JWT_SECRET: 'jwt',
      PCM_ENCRYPTION_KEYS_LEGACY: ' autre-cle , cle-de-mars ',
    });
    const { report } = m.decryptReportDetaille(perdu);

    expect(report).toEqual(RAPPORT);   // les espaces autour des clés sont tolérés
  });

  test('la valeur par défaut historique du code est essayée', () => {
    // Des rapports des tout premiers mois ont été chiffrés avec elle, tant
    // qu'aucune clé n'était configurée.
    const vieux = CryptoJS.AES.encrypt(JSON.stringify(RAPPORT), 'solidata-pcm-encryption-key').toString();
    const m = chargerAvec({ PCM_ENCRYPTION_KEY: 'cle-du-jour', JWT_SECRET: 'jwt' });

    expect(m.decryptReportDetaille(vieux).report).toEqual(RAPPORT);
  });

  test('AUCUNE clé ne convient → null, et surtout PAS d’exception', () => {
    // C'est le cœur du défaut : l'exception devenait un « Erreur serveur » que
    // l'écran avalait, donc un clic sans effet et sans explication.
    const inconnu = CryptoJS.AES.encrypt(JSON.stringify(RAPPORT), 'cle-jamais-vue').toString();
    const m = chargerAvec({ PCM_ENCRYPTION_KEY: 'cle-du-jour', JWT_SECRET: 'jwt' });

    let r;
    expect(() => { r = m.decryptReportDetaille(inconnu); }).not.toThrow();
    expect(r).toEqual({ report: null, cle: null });
  });

  test('contenu vide, nul ou corrompu → null sans lever', () => {
    const m = chargerAvec({ PCM_ENCRYPTION_KEY: 'cle-du-jour', JWT_SECRET: 'jwt' });

    for (const v of [null, undefined, '', 'pas-du-chiffre', 'U2FsdGVkX1+corrompu']) {
      expect(() => m.decryptReportDetaille(v)).not.toThrow();
      expect(m.decryptReportDetaille(v).report).toBeNull();
    }
  });

  test('les clés historiques ne servent JAMAIS à écrire', () => {
    const m = chargerAvec({
      PCM_ENCRYPTION_KEY: 'cle-du-jour', JWT_SECRET: 'jwt',
      PCM_ENCRYPTION_KEYS_LEGACY: 'vieille-cle',
    });
    const chiffre = m.encryptReport(RAPPORT);

    // Ce qui vient d'être écrit se relit avec la clé du jour, pas une autre :
    // sans quoi le problème se reformerait à la prochaine rotation.
    expect(m.decryptReportDetaille(chiffre).cle).toBe('courante');
    // On interroge le contrat (« cette clé ouvre-t-elle ce rapport ? ») et non
    // la chaîne brute : déchiffrer avec une mauvaise clé rend des octets
    // quelconques, qui forment PARFOIS de l'UTF-8 valide selon le sel tiré au
    // hasard à l'écriture. Assertion sur la chaîne = test qui échoue un jour
    // sur vingt sans que rien n'ait changé.
    expect(m.essayerCle(chiffre, 'vieille-cle')).toBeNull();
  });

  test('la clé du jour n’est jamais réessayée comme clé historique', () => {
    const m = chargerAvec({ PCM_ENCRYPTION_KEY: 'meme-cle', JWT_SECRET: 'meme-cle' });
    expect(m.clesHistoriques()).not.toContain('meme-cle');
  });
});

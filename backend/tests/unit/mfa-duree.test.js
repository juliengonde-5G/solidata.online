// ═══════════════════════════════════════════════════════════════════════════
// RENOUVELLEMENT DU SECOND FACTEUR — fenêtre de validité (2.46.0)
//
// Le claim `mfa` disait « ce défi a été franchi », jamais QUAND : la preuve se
// reconduisait de renouvellement en renouvellement pendant les 7 jours du
// jeton. `mfaExpiree` est la règle qui y met un terme — fonction PURE, testée
// sans base et sans horloge réelle.
// ═══════════════════════════════════════════════════════════════════════════
jest.mock('../../src/config/database', () => ({ query: jest.fn(async () => ({ rows: [] })) }));

const {
  mfaExpiree, DEFAULT_MFA_DUREE_HEURES, SETTING_DUREE,
} = require('../../src/middleware/mfa');

const H = 3600 * 1000;
const MAINTENANT = Date.UTC(2026, 7, 30, 12, 0, 0);
/** `mfa_at` (secondes epoch) correspondant à « il y a N heures ». */
const ilYA = (heures) => Math.floor((MAINTENANT - heures * H) / 1000);

describe('mfaExpiree — la fenêtre de 24 h', () => {
  it('une vérification de l’instant est valide', () => {
    expect(mfaExpiree(ilYA(0), 24, MAINTENANT)).toBe(false);
  });

  it('une vérification de 23 h 59 est encore valide', () => {
    expect(mfaExpiree(ilYA(23.98), 24, MAINTENANT)).toBe(false);
  });

  it('une vérification de 24 h 01 est PÉRIMÉE', () => {
    expect(mfaExpiree(ilYA(24.02), 24, MAINTENANT)).toBe(true);
  });

  it('une vérification de six jours — la durée de vie du jeton de renouvellement — est périmée', () => {
    expect(mfaExpiree(ilYA(24 * 6), 24, MAINTENANT)).toBe(true);
  });

  it('la fenêtre est réellement paramétrable (8 h)', () => {
    expect(mfaExpiree(ilYA(9), 8, MAINTENANT)).toBe(true);
    expect(mfaExpiree(ilYA(7), 8, MAINTENANT)).toBe(false);
  });
});

describe('mfaExpiree — les cas qui ne doivent pas ouvrir de brèche', () => {
  it.each([
    ['absent (jeton hérité d’avant le déploiement)', undefined],
    ['null (session sans second facteur réellement présenté)', null],
    ['illisible', 'hier'],
    ['NaN', NaN],
  ])('un horodatage %s est traité comme PÉRIMÉ', (_l, valeur) => {
    expect(mfaExpiree(valeur, 24, MAINTENANT)).toBe(true);
  });

  it('une durée absurde retombe sur le défaut en code, jamais sur « toujours valide »', () => {
    // 0 h périmerait tout à la seconde ; une durée illisible ne doit pas non
    // plus valoir l'infini. Dans les deux cas : 24 h.
    expect(mfaExpiree(ilYA(25), 0, MAINTENANT)).toBe(true);
    expect(mfaExpiree(ilYA(23), 0, MAINTENANT)).toBe(false);
    expect(mfaExpiree(ilYA(25), 'douze', MAINTENANT)).toBe(true);
    expect(mfaExpiree(ilYA(23), null, MAINTENANT)).toBe(false);
  });

  it('un horodatage dans le futur (horloges désynchronisées) est accepté', () => {
    // Refuser une session pour une dérive d'horloge serait une panne, pas une
    // sécurité — et la dérive ne peut de toute façon pas allonger la fenêtre
    // au-delà de la vie du jeton de renouvellement.
    expect(mfaExpiree(ilYA(-2), 24, MAINTENANT)).toBe(false);
  });
});

describe('contrat du réglage', () => {
  it('le défaut est 24 h et la clé de réglage est celle documentée', () => {
    expect(DEFAULT_MFA_DUREE_HEURES).toBe(24);
    expect(SETTING_DUREE).toBe('securite.mfa_duree_heures');
  });
});

/**
 * Tests des fonctions PURES du script de recalcul du moteur prédictif.
 */
const { parseArgs, resumer, ETAPES } = require('../../src/scripts/recalculer-predictif');

describe('parseArgs', () => {
  test('horizon par défaut de 7 jours', () => {
    expect(parseArgs([])).toEqual({ horizon: 7 });
  });

  test('--horizon=N est accepté dans les bornes', () => {
    expect(parseArgs(['--horizon=14'])).toEqual({ horizon: 14 });
  });

  test('un horizon aberrant est refusé (on ne calcule pas sur un filtre mal compris)', () => {
    for (const mauvais of ['--horizon=0', '--horizon=61', '--horizon=abc', '--horizon=1.5']) {
      expect(() => parseArgs([mauvais])).toThrow(/1 à 60/);
    }
  });
});

describe('resumer', () => {
  test('un refus de conclure est affiché comme tel, jamais comme un succès', () => {
    // Doctrine « jamais de valeur inventée » : un apprentissage qui manque de
    // données n'écrit rien — l'utilisateur doit le lire, pas voir un « OK ».
    expect(resumer({ skipped: true, raison: 'historique insuffisant' }))
      .toBe('aucune écriture — historique insuffisant');
    expect(resumer({ reason: 'moins de 60 intervalles' }))
      .toBe('aucune écriture — moins de 60 intervalles');
  });

  test('les compteurs renvoyés sont restitués', () => {
    expect(resumer({ cav: 209, predictions: 1463 })).toBe('cav=209, predictions=1463');
  });

  test('formes dégradées', () => {
    expect(resumer(null)).toMatch(/aucun détail/);
    expect(resumer(undefined)).toMatch(/aucun détail/);
    expect(resumer({})).toBe('terminé');
    expect(resumer('fait')).toBe('fait');
  });
});

describe('étapes', () => {
  test('les trois apprentissages du moteur sont couverts', () => {
    expect(ETAPES.map((e) => e.titre)).toEqual([
      'Facteurs saisonniers', 'Pondération météo', 'Prédictions de remplissage',
    ]);
    for (const e of ETAPES) expect(typeof e.run).toBe('function');
  });
});

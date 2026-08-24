/**
 * Cadence de la ré-optimisation en cours de tournée.
 *
 * Le client demande un recalcul « toutes les X minutes, ou après chaque
 * arrêt ». Ces tests portent sur la partie PURE de la décision : quelles
 * tournées recalculer maintenant.
 */
const { tourneesARecalculer } = require('../../src/services/scheduler');

describe('tourneesARecalculer', () => {
  const tournees = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const T0 = 1_700_000_000_000;

  test('une tournée jamais recalculée l’est immédiatement', () => {
    expect(tourneesARecalculer(tournees, new Map(), T0, 15)).toEqual([1, 2, 3]);
  });

  test('avant l’intervalle : on ne redérange personne', () => {
    const dernier = new Map([[1, T0 - 5 * 60_000], [2, T0 - 14 * 60_000]]);
    expect(tourneesARecalculer(tournees, dernier, T0, 15)).toEqual([3]);
  });

  test('après l’intervalle : la tournée repasse au recalcul', () => {
    const dernier = new Map([[1, T0 - 16 * 60_000], [2, T0 - 15 * 60_000]]);
    expect(tourneesARecalculer(tournees, dernier, T0, 15)).toEqual([1, 2, 3]);
  });

  test('l’intervalle est paramétrable', () => {
    const dernier = new Map([[1, T0 - 6 * 60_000]]);
    expect(tourneesARecalculer(tournees, dernier, T0, 5)).toContain(1);
    expect(tourneesARecalculer(tournees, dernier, T0, 30)).not.toContain(1);
  });

  test('intervalle absent ou absurde : repli à 15 min, jamais un recalcul en boucle', () => {
    const dernier = new Map([[1, T0 - 60_000]]);
    expect(tourneesARecalculer(tournees, dernier, T0, null)).not.toContain(1);
    expect(tourneesARecalculer(tournees, dernier, T0, 0)).toContain(1); // plancher 1 min
  });

  test('aucune tournée en cours : rien à faire', () => {
    expect(tourneesARecalculer([], new Map(), T0, 15)).toEqual([]);
    expect(tourneesARecalculer(null, new Map(), T0, 15)).toEqual([]);
  });
});

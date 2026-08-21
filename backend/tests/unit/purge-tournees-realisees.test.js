/**
 * Tests des fonctions PURES du script de purge des tournées réalisées
 * (src/scripts/purge-tournees-realisees.js).
 */
const {
  parseArgs, DETACH_EXPLICITE, DETACH_PAR_FK, CASCADE,
} = require('../../src/scripts/purge-tournees-realisees');

describe('parseArgs', () => {
  test('simulation par défaut (aucune écriture sans --apply)', () => {
    expect(parseArgs([])).toEqual({ apply: false, avant: null, planifiees: false, annulees: false });
  });

  test('--apply active l’écriture', () => {
    expect(parseArgs(['--apply'])).toEqual({ apply: true, avant: null, planifiees: false, annulees: false });
  });

  test('--avant=YYYY-MM-DD borne la purge', () => {
    expect(parseArgs(['--avant=2026-06-01', '--apply']))
      .toEqual({ apply: true, avant: '2026-06-01', planifiees: false, annulees: false });
  });

  test('date mal formée → refus (on ne purge jamais sur un filtre mal compris)', () => {
    expect(() => parseArgs(['--avant=01/06/2026'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(['--avant=2026-13-45'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(['--avant='])).toThrow(/YYYY-MM-DD/);
  });
});

describe('périmètre de la purge (garde-fous de non-régression)', () => {
  test('le stock et les incidents sont DÉTACHÉS, jamais supprimés', () => {
    for (const table of ['stock_movements', 'stock_original_movements', 'incidents']) {
      expect(DETACH_EXPLICITE).toContain(table);
      expect(CASCADE).not.toContain(table);
    }
  });

  test('seules les données d’exécution de tournée sont supprimées', () => {
    expect(CASCADE.sort()).toEqual([
      'gps_positions', 'tour_association_point', 'tour_cav',
      'tour_reoptimizations', 'tour_weights',
    ]);
  });

  test('tonnage_history n’est dans AUCUNE liste (prédictif/KPI préservés)', () => {
    const toutes = [...CASCADE, ...DETACH_EXPLICITE, ...DETACH_PAR_FK];
    expect(toutes).not.toContain('tonnage_history');
  });

  test('aucune table n’est à la fois supprimée et détachée', () => {
    const detach = [...DETACH_EXPLICITE, ...DETACH_PAR_FK];
    expect(CASCADE.filter((t) => detach.includes(t))).toEqual([]);
  });
});

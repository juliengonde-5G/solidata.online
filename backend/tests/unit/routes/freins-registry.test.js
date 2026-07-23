/**
 * Extension insertion 2026-07 (PR1) — registre unique des freins.
 *
 * Verrouille le contrat du module freins-registry : 9 axes ordonnés (les 7
 * historiques d'abord — compatibilité radar/séries existantes — puis
 * logement et judiciaire), colonnes SQL exactes, les 7 intitulés d'export du
 * CDC dans l'ordre du CDC, flags de sensibilité RGPD (art. 9 / art. 10) et
 * helpers.
 */
const {
  FREINS,
  FREIN_KEYS,
  freinColumns,
  EXPORT_FREINS,
  RADAR_AXES,
} = require('../../../src/routes/insertion/freins-registry');

describe('freins-registry — les 9 axes', () => {
  test('9 axes, dans l\'ordre : 7 historiques puis logement et judiciaire', () => {
    expect(FREINS).toHaveLength(9);
    expect(FREIN_KEYS).toEqual([
      'mobilite', 'sante', 'finances', 'famille', 'linguistique',
      'administratif', 'numerique', 'logement', 'judiciaire',
    ]);
  });

  test('flag legacy : true pour les 7 historiques, false pour les 2 nouveaux', () => {
    expect(FREINS.slice(0, 7).every((f) => f.legacy === true)).toBe(true);
    expect(FREINS.slice(7).every((f) => f.legacy === false)).toBe(true);
  });

  test('colonnes SQL = frein_<key> (dont le cas « financier » → frein_finances)', () => {
    for (const f of FREINS) {
      expect(f.column).toBe(`frein_${f.key}`);
    }
    expect(FREINS.find((f) => f.key === 'finances').column).toBe('frein_finances');
  });

  test('chaque axe a un label français', () => {
    for (const f of FREINS) {
      expect(typeof f.label).toBe('string');
      expect(f.label.length).toBeGreaterThan(0);
    }
  });

  test('sensibilité RGPD : sante=art9, judiciaire=art10, null sinon', () => {
    for (const f of FREINS) {
      if (f.key === 'sante') expect(f.sensible).toBe('art9');
      else if (f.key === 'judiciaire') expect(f.sensible).toBe('art10');
      else expect(f.sensible).toBeNull();
    }
  });
});

describe('freins-registry — export CDC', () => {
  test('exactement 7 axes exportables (labelExport non nul) ; famille et numerique hors export', () => {
    const exportables = FREINS.filter((f) => f.labelExport !== null);
    expect(exportables).toHaveLength(7);
    expect(FREINS.find((f) => f.key === 'famille').labelExport).toBeNull();
    expect(FREINS.find((f) => f.key === 'numerique').labelExport).toBeNull();
  });

  test('EXPORT_FREINS : les 7 freins du CDC, dans l\'ordre du CDC', () => {
    expect(EXPORT_FREINS.map((f) => f.key)).toEqual([
      'linguistique', 'sante', 'logement', 'administratif', 'finances', 'judiciaire', 'mobilite',
    ]);
    expect(EXPORT_FREINS.map((f) => f.labelExport)).toEqual([
      'Frein linguistique', 'Frein santé', 'Frein logement', 'Frein administratif',
      'Frein financier', 'Frein judiciaire', 'Frein mobilité',
    ]);
    // Tous résolus (aucun trou si une clé du CDC divergeait du registre).
    expect(EXPORT_FREINS.every(Boolean)).toBe(true);
  });
});

describe('freins-registry — helpers', () => {
  test('freinColumns() sans préfixe : les 9 colonnes dans l\'ordre du registre', () => {
    expect(freinColumns()).toEqual([
      'frein_mobilite', 'frein_sante', 'frein_finances', 'frein_famille',
      'frein_linguistique', 'frein_administratif', 'frein_numerique',
      'frein_logement', 'frein_judiciaire',
    ]);
  });

  test('freinColumns(prefix) préfixe chaque colonne (alias SQL)', () => {
    const cols = freinColumns('d.');
    expect(cols).toHaveLength(9);
    expect(cols[0]).toBe('d.frein_mobilite');
    expect(cols[8]).toBe('d.frein_judiciaire');
  });

  test('RADAR_AXES : 9 labels courts, les 7 premiers identiques au radar existant', () => {
    expect(RADAR_AXES).toHaveLength(9);
    // Compatibilité stricte avec les axes historiques du radar
    // (routes.js GET /milestones/:employeeId/radar).
    expect(RADAR_AXES.slice(0, 7)).toEqual([
      'Mobilite', 'Sante', 'Finances', 'Famille', 'Langue', 'Administratif', 'Numerique',
    ]);
    expect(RADAR_AXES.slice(7)).toEqual(['Logement', 'Judiciaire']);
  });
});

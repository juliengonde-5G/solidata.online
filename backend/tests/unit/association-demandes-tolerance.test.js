// ═══════════════════════════════════════════════════════════════════════════
// TOLÉRANCE DE RENDEZ-VOUS — une seule source de vérité
// ───────────────────────────────────────────────────────────────────────────
// Le chantier a livré la tolérance en DEUX exemplaires : une constante dans le
// module pur (dérivation du statut d'une demande) et un réglage d'administration
// (ancrage à la planification). Non reliés, ils produisaient deux écrans qui se
// contredisent : une tournée planifiée « tenable » à ±30 min ressortait
// « non honorée » dans la liste des demandes, jugée sur ±15.
//
// Ces tests verrouillent la règle : le réglage d'administration fait foi, la
// constante n'est plus qu'un repli.
// ═══════════════════════════════════════════════════════════════════════════

jest.mock('../../src/config/database', () => ({ query: jest.fn(), connect: jest.fn() }));

const { getScoringConfig, setScoringConfig } = require('../../src/routes/tours/predictions');
const { toleranceParDefaut } = require('../../src/routes/association-demandes');
const { TOLERANCE_RDV_DEFAUT_MIN } = require('../../src/services/association-horaires');

describe('toleranceParDefaut', () => {
  let cfg0;
  beforeEach(() => { cfg0 = { ...getScoringConfig() }; });
  afterEach(() => setScoringConfig(cfg0));

  test('le réglage d\'administration fait foi', () => {
    setScoringConfig({ ...cfg0, rdvToleranceMin: 30 });
    expect(toleranceParDefaut()).toBe(30);
    setScoringConfig({ ...cfg0, rdvToleranceMin: 5 });
    expect(toleranceParDefaut()).toBe(5);
  });

  test('une tolérance nulle est une VALEUR, pas une absence', () => {
    // 0 min = « à l'heure pile ». Un `||` l'aurait silencieusement remplacée
    // par le repli — c'est exactement le genre de défaut que la doctrine vise.
    setScoringConfig({ ...cfg0, rdvToleranceMin: 0 });
    expect(toleranceParDefaut()).toBe(0);
  });

  test('un réglage absent ou aberrant retombe sur la constante du module pur', () => {
    for (const v of [undefined, null, '', 'trente', -5, 999, NaN]) {
      setScoringConfig({ ...cfg0, rdvToleranceMin: v });
      expect(toleranceParDefaut()).toBe(TOLERANCE_RDV_DEFAUT_MIN);
    }
  });

  test('une valeur en chaîne, telle que la renvoient les réglages persistés, est acceptée', () => {
    setScoringConfig({ ...cfg0, rdvToleranceMin: '45' });
    expect(toleranceParDefaut()).toBe(45);
  });
});

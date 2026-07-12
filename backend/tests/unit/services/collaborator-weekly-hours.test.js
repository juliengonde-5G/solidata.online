const { resolveWeeklyHours } = require('../../../src/services/collaborator-import');

// v1-5 — La coercition weekly_hours → 26/35 est levée : l'import conserve la
// quotité RÉELLE, le CHECK employee_contracts_weekly_hours_check tolère 0 < h <= 48.
describe('collaborator-import — resolveWeeklyHours (v1-5, fin de la coercition 26/35)', () => {
  it('conserve les temps partiels réels (24 / 28 / 30) au lieu de les rabattre sur 35', () => {
    expect(resolveWeeklyHours(24)).toBe(24);
    expect(resolveWeeklyHours(28)).toBe(28);
    expect(resolveWeeklyHours(30)).toBe(30);
  });

  it('conserve les quotités « historiques » 26 et 35', () => {
    expect(resolveWeeklyHours(26)).toBe(26);
    expect(resolveWeeklyHours(35)).toBe(35);
  });

  it('accepte une chaîne numérique (virgule ou point déjà normalisés en amont)', () => {
    expect(resolveWeeklyHours('28')).toBe(28);
    expect(resolveWeeklyHours('35.5')).toBe(35.5);
  });

  it('accepte les bornes de la plage autorisée (juste au-dessus de 0, et 48)', () => {
    expect(resolveWeeklyHours(0.5)).toBe(0.5);
    expect(resolveWeeklyHours(48)).toBe(48);
  });

  it('repli sur 35 si la valeur est absente / non numérique', () => {
    expect(resolveWeeklyHours(null)).toBe(35);
    expect(resolveWeeklyHours(undefined)).toBe(35);
    expect(resolveWeeklyHours('')).toBe(35);
    expect(resolveWeeklyHours('temps plein')).toBe(35);
    expect(resolveWeeklyHours(NaN)).toBe(35);
  });

  it('repli sur 35 si la valeur est hors plage (<= 0 ou > 48) — évite de violer le CHECK', () => {
    expect(resolveWeeklyHours(0)).toBe(35);
    expect(resolveWeeklyHours(-5)).toBe(35);
    expect(resolveWeeklyHours(60)).toBe(35);
    expect(resolveWeeklyHours(1000)).toBe(35);
  });

  it('respecte un repli explicite fourni', () => {
    expect(resolveWeeklyHours(null, 26)).toBe(26);
    expect(resolveWeeklyHours(100, 35)).toBe(35);
  });
});

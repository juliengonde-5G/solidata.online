// Revue Codex PR#83 — précédence de normalizeGender : le SEXE DÉCLARÉ (colonne
// « Sexe »/« Genre » de l'export paie) prime sur la civilité ; la civilité n'est
// qu'un repli quand le sexe n'est pas renseigné. Sinon un « Mme » avec « Sexe = M »
// stockerait 'F' et l'indicateur F/H perdrait la déclaration explicite.
const { normalizeGender } = require('../../../src/services/collaborator-import');

describe('normalizeGender — le sexe déclaré prime sur la civilité', () => {
  test('conflit : civilité « Mme » + Sexe « M » → M (déclaré gagne)', () => {
    expect(normalizeGender('Mme', 'M')).toBe('M');
  });
  test('conflit : civilité « M. » + Sexe « F » → F (déclaré gagne)', () => {
    expect(normalizeGender('M.', 'F')).toBe('F');
  });
  test('sexe déclaré seul (variantes) → normalisé', () => {
    expect(normalizeGender('', 'Féminin')).toBe('F');
    expect(normalizeGender(null, 'HOMME')).toBe('M');
    expect(normalizeGender('', 'H')).toBe('M');
  });
  test('sexe absent → repli sur la civilité', () => {
    expect(normalizeGender('Madame', '')).toBe('F');
    expect(normalizeGender('Monsieur', null)).toBe('M');
    expect(normalizeGender('Mlle', undefined)).toBe('F');
  });
  test('ni sexe ni civilité reconnaissables → null', () => {
    expect(normalizeGender('Dr', '')).toBeNull();
    expect(normalizeGender('', 'inconnu')).toBeNull();
    expect(normalizeGender(null, null)).toBeNull();
  });
});

const {
  parseMedicalFrequencyMonths,
  computeMedicalDueDate,
} = require('../../../src/services/collaborator-import');

describe('collaborator-import — visite médicale (item 43)', () => {
  describe('parseMedicalFrequencyMonths', () => {
    it('interprète les mois', () => {
      expect(parseMedicalFrequencyMonths('24 mois')).toBe(24);
      expect(parseMedicalFrequencyMonths('60 mois')).toBe(60);
    });
    it('convertit les années en mois', () => {
      expect(parseMedicalFrequencyMonths('2 ans')).toBe(24);
      expect(parseMedicalFrequencyMonths('5 ans')).toBe(60);
      expect(parseMedicalFrequencyMonths('1 an')).toBe(12);
    });
    it('accepte un nombre nu (interprété en mois)', () => {
      expect(parseMedicalFrequencyMonths('36')).toBe(36);
    });
    it('renvoie null pour une entrée vide ou non numérique', () => {
      expect(parseMedicalFrequencyMonths('')).toBeNull();
      expect(parseMedicalFrequencyMonths(null)).toBeNull();
      expect(parseMedicalFrequencyMonths('annuelle')).toBeNull();
    });
  });

  describe('computeMedicalDueDate', () => {
    it('sans visite connue → échéance visite d’information à J+3 mois du contrat', () => {
      const due = computeMedicalDueDate({ contractStart: '2026-01-15' });
      expect(due).toBe('2026-04-15');
    });

    it('avec dernière visite + périodicité → dernière visite + périodicité', () => {
      const due = computeMedicalDueDate({
        contractStart: '2020-01-01',
        lastVisit: '2026-01-10',
        frequency: '24 mois',
      });
      expect(due).toBe('2028-01-10');
    });

    it('prend la visite la plus récente (post-embauche vs périodique)', () => {
      const due = computeMedicalDueDate({
        contractStart: '2020-01-01',
        hireVisit: '2025-03-01',
        lastVisit: '2026-02-01',
        frequency: '2 ans',
      });
      expect(due).toBe('2028-02-01');
    });

    it('visite connue mais périodicité inconnue → pas d’échéance fabriquée (null)', () => {
      const due = computeMedicalDueDate({
        contractStart: '2020-01-01',
        lastVisit: '2026-02-01',
      });
      expect(due).toBeNull();
    });

    it('aucune donnée → null', () => {
      expect(computeMedicalDueDate({})).toBeNull();
    });
  });
});

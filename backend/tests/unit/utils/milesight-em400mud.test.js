const { decode, computeFillPercent, encodeTestPayload } = require('../../../src/utils/milesight-em400mud');

describe('milesight-em400mud', () => {
  describe('decode', () => {
    it('décode battery/temperature/distance/tilt d\'un payload TLV standard', () => {
      // battery 95 %, temperature 18.5 °C, distance 715 mm, tilt false
      const hex = encodeTestPayload({ battery: 95, distance_mm: 715, temperature: 18.5, tilt: false });
      const r = decode(85, hex);
      expect(r.battery).toBe(95);
      expect(r.temperature).toBeCloseTo(18.5, 1);
      expect(r.distance_mm).toBe(715);
      expect(r.tilt_detected).toBe(false);
    });

    it('décode une température négative (int16 LE signé)', () => {
      const hex = encodeTestPayload({ temperature: -4.2, distance_mm: 300 });
      const r = decode(85, hex);
      expect(r.temperature).toBeCloseTo(-4.2, 1);
    });

    it('remonte le flag tilt', () => {
      const r = decode(85, encodeTestPayload({ tilt: true }));
      expect(r.tilt_detected).toBe(true);
    });

    it('renvoie des valeurs nulles pour un payload vide', () => {
      const r = decode(85, '');
      expect(r.distance_mm).toBeNull();
      expect(r.battery).toBeNull();
    });
  });

  describe('computeFillPercent — modèle mono-point (rétro-compatibilité)', () => {
    it('vide (distance = hauteur) → 0 %', () => {
      expect(computeFillPercent(220, 220)).toBe(0);
    });

    it('plein théorique (distance = 0) → 100 %', () => {
      expect(computeFillPercent(0, 220)).toBe(100);
    });

    it('reproduit le comportement historique (1 - d/H)', () => {
      // Données réelles LE HOULME : d≈30.9 cm, H=220 → ~86 %
      expect(computeFillPercent(30.9, 220)).toBe(86);
      expect(computeFillPercent(32.9, 220)).toBe(85);
    });

    it('renvoie null si hauteur manquante ou nulle', () => {
      expect(computeFillPercent(30, null)).toBeNull();
      expect(computeFillPercent(30, 0)).toBeNull();
      expect(computeFillPercent(null, 220)).toBeNull();
    });

    it('borne à 0–100 (distance > hauteur ne descend pas sous 0)', () => {
      expect(computeFillPercent(300, 220)).toBe(0);
    });
  });

  describe('computeFillPercent — modèle deux points (vide/plein)', () => {
    it('à la distance à plein → 100 %', () => {
      // empty=220, full=35 : un CAV dont le textile plafonne à 35 cm est bien 100 % plein
      expect(computeFillPercent(35, 220, 35)).toBe(100);
    });

    it('à la hauteur vide → 0 %', () => {
      expect(computeFillPercent(220, 220, 35)).toBe(0);
    });

    it('interpole linéairement entre plein et vide', () => {
      // milieu de la plage utile (220..35) = 127.5 cm → 50 %
      expect(computeFillPercent(127.5, 220, 35)).toBe(50);
    });

    it('un CAV réellement plein atteint 100 % (au lieu de plafonner ~86 %)', () => {
      // d≈30.9 < full=35 → dépasse le plein → borné à 100 % (vs 86 % en mono-point)
      expect(computeFillPercent(30.9, 220, 35)).toBe(100);
      expect(computeFillPercent(30.9, 220)).toBe(86); // rappel mono-point
    });

    it('ignore une distance à plein incohérente (>= hauteur vide) → repli mono-point', () => {
      expect(computeFillPercent(30.9, 220, 220)).toBe(computeFillPercent(30.9, 220));
      expect(computeFillPercent(30.9, 220, 300)).toBe(computeFillPercent(30.9, 220));
    });

    it('full = 0 équivaut au modèle mono-point', () => {
      expect(computeFillPercent(50, 200, 0)).toBe(computeFillPercent(50, 200));
    });
  });
});

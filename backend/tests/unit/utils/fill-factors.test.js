// Tests de la source unique des facteurs de remplissage (Vague 1 — items 48/49/50).
const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
}));

const fillFactors = require('../../../src/utils/fill-factors');
const {
  getCapacityKg,
  computeBaseFillPercent,
  seasonalFactorFor,
  dayFactorFor,
  jsDayToLunIndex,
  lunIndexToJsDay,
  getResolvedFactors,
  invalidateCache,
  SEASONAL_DEFAULT,
  DOW_DEFAULT,
} = fillFactors;

describe('fill-factors — fonctions pures', () => {
  describe('getCapacityKg', () => {
    it('1 conteneur = 150 kg', () => expect(getCapacityKg(1)).toBe(150));
    it('3 conteneurs = 450 kg', () => expect(getCapacityKg(3)).toBe(450));
    it('null/0/undefined → repli 1 conteneur (150 kg)', () => {
      expect(getCapacityKg(null)).toBe(150);
      expect(getCapacityKg(0)).toBe(150);
      expect(getCapacityKg(undefined)).toBe(150);
    });
    it('accepte une chaîne numérique', () => expect(getCapacityKg('2')).toBe(300));
  });

  describe('computeBaseFillPercent — normalisation par la capacité', () => {
    it('CAV 1 conteneur, cadence 7 j, 50 kg/collecte, 7 j écoulés ≈ 33 %', () => {
      const r = computeBaseFillPercent({
        daysSinceCollection: 7, avgWeightKg: 50, avgDaysBetween: 7, nbContainers: 1,
      });
      expect(r).toBeCloseTo(33.33, 1);
    });

    it('CAV 3 conteneurs, cadence 14 j, 150 kg/collecte, 14 j écoulés ≈ 33 %', () => {
      const r = computeBaseFillPercent({
        daysSinceCollection: 14, avgWeightKg: 150, avgDaysBetween: 14, nbContainers: 3,
      });
      expect(r).toBeCloseTo(33.33, 1);
    });

    it('haute saison (×1.27) augmente le remplissage', () => {
      const base = computeBaseFillPercent({ daysSinceCollection: 7, avgWeightKg: 50, avgDaysBetween: 7, nbContainers: 1 });
      const high = computeBaseFillPercent({ daysSinceCollection: 7, avgWeightKg: 50, avgDaysBetween: 7, nbContainers: 1, seasonalFactor: 1.27 });
      expect(high).toBeCloseTo(base * 1.27, 5);
      expect(high).toBeGreaterThan(base);
    });

    it('basse saison (×0.75) diminue le remplissage', () => {
      const base = computeBaseFillPercent({ daysSinceCollection: 7, avgWeightKg: 50, avgDaysBetween: 7, nbContainers: 1 });
      const low = computeBaseFillPercent({ daysSinceCollection: 7, avgWeightKg: 50, avgDaysBetween: 7, nbContainers: 1, seasonalFactor: 0.75 });
      expect(low).toBeCloseTo(base * 0.75, 5);
      expect(low).toBeLessThan(base);
    });

    it('facteur jour appliqué multiplicativement', () => {
      const r = computeBaseFillPercent({ daysSinceCollection: 7, avgWeightKg: 50, avgDaysBetween: 7, nbContainers: 1, seasonalFactor: 1, dayFactor: 0.5 });
      expect(r).toBeCloseTo(33.33 * 0.5, 1);
    });

    it('borne haute : sature à maxFill (120 par défaut), jamais de « 5000 % »', () => {
      const r = computeBaseFillPercent({ daysSinceCollection: 1000, avgWeightKg: 500, avgDaysBetween: 7, nbContainers: 1 });
      expect(r).toBe(120);
    });

    it('borne 0-100 respectée quand maxFill=100', () => {
      const r = computeBaseFillPercent({ daysSinceCollection: 1000, avgWeightKg: 500, avgDaysBetween: 7, nbContainers: 1, maxFill: 100 });
      expect(r).toBe(100);
      expect(r).toBeLessThanOrEqual(100);
      expect(r).toBeGreaterThanOrEqual(0);
    });

    it('jours négatifs → 0 (jamais négatif)', () => {
      expect(computeBaseFillPercent({ daysSinceCollection: -5, avgWeightKg: 50, avgDaysBetween: 7, nbContainers: 1 })).toBe(0);
    });

    it('poids nul → 0', () => {
      expect(computeBaseFillPercent({ daysSinceCollection: 10, avgWeightKg: 0, avgDaysBetween: 7, nbContainers: 1 })).toBe(0);
    });

    it('cadence manquante → repli 7 j (pas de division par zéro)', () => {
      const r = computeBaseFillPercent({ daysSinceCollection: 7, avgWeightKg: 50, avgDaysBetween: 0, nbContainers: 1 });
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeCloseTo(33.33, 1);
    });

    it('un CAV réellement plein atteint ~100 % (200 kg accumulés / 150 kg de capacité borné)', () => {
      // 20 j × (70 kg / 7 j) = 200 kg → 200/150 = 133 % → borné 120
      const r = computeBaseFillPercent({ daysSinceCollection: 20, avgWeightKg: 70, avgDaysBetween: 7, nbContainers: 1 });
      expect(r).toBeGreaterThan(100);
      expect(r).toBeLessThanOrEqual(120);
    });
  });

  describe('index jour/mois', () => {
    it('jsDayToLunIndex : dimanche(0)→6, lundi(1)→0, samedi(6)→5', () => {
      expect(jsDayToLunIndex(0)).toBe(6);
      expect(jsDayToLunIndex(1)).toBe(0);
      expect(jsDayToLunIndex(6)).toBe(5);
    });
    it('lunIndexToJsDay : lun(0)→1, dim(6)→0', () => {
      expect(lunIndexToJsDay(0)).toBe(1);
      expect(lunIndexToJsDay(6)).toBe(0);
    });
    it('round-trip jsDay → lun → jsDay', () => {
      for (let j = 0; j <= 6; j++) expect(lunIndexToJsDay(jsDayToLunIndex(j))).toBe(j);
    });
  });

  describe('accès facteurs résolus', () => {
    const resolved = { seasonal: SEASONAL_DEFAULT, dayOfWeek: DOW_DEFAULT };
    it('seasonalFactorFor renvoie le facteur du mois', () => {
      expect(seasonalFactorFor(resolved, 0)).toBe(SEASONAL_DEFAULT[0]);   // janvier
      expect(seasonalFactorFor(resolved, 7)).toBe(SEASONAL_DEFAULT[7]);   // août
    });
    it('dayFactorFor mappe le jsDay vers l\'index lundi-premier', () => {
      expect(dayFactorFor(resolved, 1)).toBe(DOW_DEFAULT[0]); // lundi
      expect(dayFactorFor(resolved, 0)).toBe(DOW_DEFAULT[6]); // dimanche
    });
  });
});

describe('fill-factors — résolution appris > manuel > défaut (item 49)', () => {
  afterEach(() => { mockQuery.mockReset(); invalidateCache(); });

  // Aiguille les deux requêtes internes selon leur SQL.
  function routeQueries({ configValue = null, learnedRows = [] } = {}) {
    mockQuery.mockImplementation((sql) => {
      if (/FROM settings/i.test(sql)) {
        return Promise.resolve({ rows: configValue == null ? [] : [{ value: configValue }] });
      }
      if (/predictive_seasonal_factors/i.test(sql)) {
        return Promise.resolve({ rows: learnedRows });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  it('sans config ni appris → tout en DÉFAUT', async () => {
    routeQueries({});
    const r = await getResolvedFactors();
    expect(r.seasonal).toEqual(SEASONAL_DEFAULT);
    expect(r.dayOfWeek).toEqual(DOW_DEFAULT);
    expect(r.seasonalSources.every((s) => s === 'défaut')).toBe(true);
    expect(r.dayOfWeekSources.every((s) => s === 'défaut')).toBe(true);
  });

  it('config manuelle présente → source MANUEL là où pas d\'appris', async () => {
    const manual = Array(12).fill(1.5);
    routeQueries({ configValue: JSON.stringify({ seasonalFactors: manual }) });
    const r = await getResolvedFactors();
    expect(r.seasonal).toEqual(manual);
    expect(r.seasonalSources.every((s) => s === 'manuel')).toBe(true);
  });

  it('facteur appris présent → il PRIME sur le manuel', async () => {
    const manual = Array(12).fill(1.5);
    // janvier (key=1) appris à 0.5, avec échantillon > 0
    routeQueries({
      configValue: JSON.stringify({ seasonalFactors: manual }),
      learnedRows: [{ type: 'monthly', key: 1, factor: 0.5, sample_size: 1200 }],
    });
    const r = await getResolvedFactors();
    expect(r.seasonal[0]).toBe(0.5);
    expect(r.seasonalSources[0]).toBe('appris');
    expect(r.seasonal[1]).toBe(1.5);          // février reste manuel
    expect(r.seasonalSources[1]).toBe('manuel');
    expect(r.learnedMonthlyCount).toBe(1);
  });

  it('facteur appris à échantillon nul est IGNORÉ (retombe sur manuel/défaut)', async () => {
    routeQueries({
      learnedRows: [{ type: 'monthly', key: 1, factor: 0.5, sample_size: 0 }],
    });
    const r = await getResolvedFactors();
    expect(r.seasonal[0]).toBe(SEASONAL_DEFAULT[0]);
    expect(r.seasonalSources[0]).toBe('défaut');
  });

  it('facteur appris jour-de-semaine mappé sur la bonne clé jsDay', async () => {
    // key=1 = lundi (jsDay), doit alimenter l'index lundi-premier 0
    routeQueries({
      learnedRows: [{ type: 'dow', key: 1, factor: 2.0, sample_size: 500 }],
    });
    const r = await getResolvedFactors();
    expect(r.dayOfWeek[0]).toBe(2.0);         // lundi
    expect(r.dayOfWeekSources[0]).toBe('appris');
    expect(r.dayOfWeekSources[6]).toBe('défaut'); // dimanche non appris
  });

  it('facteur appris aberrant est borné (clamp 0.3-2.5)', async () => {
    routeQueries({
      learnedRows: [{ type: 'monthly', key: 8, factor: 9.9, sample_size: 300 }],
    });
    const r = await getResolvedFactors();
    expect(r.seasonal[7]).toBe(2.5);          // août borné
  });
});

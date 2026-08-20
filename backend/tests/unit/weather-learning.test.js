// ═══════════════════════════════════════════════════════════════════════════
// TESTS UNITAIRES — apprentissage météo des dépôts (weather-learning.js)
// ───────────────────────────────────────────────────────────────────────────
// Le cœur (classification des jours, intervalles, moindres carrés) est PUR :
// on le prouve sur une vérité terrain synthétique — des collectes générées
// depuis des facteurs connus doivent permettre de RETROUVER ces facteurs.
// La lecture persistée (getLearnedWeatherRatios) est testée avec pool mocké.
// ═══════════════════════════════════════════════════════════════════════════
const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(),
}));

const wl = require('../../src/services/weather-learning');

const BEAU = { temp_max: 21, precipitation_mm: 0 };
const GRIS = { temp_max: 11, precipitation_mm: 4 };

// Calendrier synthétique déterministe : « beau » un jour sur trois (motif
// indépendant du jour de semaine → les 4 segments sont identifiables).
function buildMeteo(startIso, nbJours) {
  const meteo = new Map();
  let t = Date.parse(`${startIso}T00:00:00Z`);
  for (let i = 0; i < nbJours; i++, t += 86400000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    meteo.set(iso, i % 3 === 0 ? BEAU : GRIS);
  }
  return meteo;
}

// Génère l'historique de collecte de plusieurs CAV à partir de facteurs CONNUS.
function buildTonnage(startIso, nbJours, meteo, facteursVrais, { noise = 0 } = {}) {
  const rows = [];
  const nbCavs = 8;
  for (let c = 0; c < nbCavs; c++) {
    const rate = 4 + c * 1.5;         // kg/jour de base, propre au CAV
    const step = 6 + (c % 4);          // collecte tous les 6 à 9 jours
    let prev = Date.parse(`${startIso}T00:00:00Z`) + c * 86400000;
    let cursor = prev + step * 86400000;
    const end = Date.parse(`${startIso}T00:00:00Z`) + nbJours * 86400000;
    let k = 0;
    // Première « collecte » d'ancrage (kg symbolique, sert de borne de départ)
    rows.push({ cav_id: 100 + c, date: new Date(prev).toISOString().slice(0, 10), kg: 1 });
    while (cursor <= end) {
      let kg = 0;
      for (let t = prev + 86400000; t <= cursor; t += 86400000) {
        const iso = new Date(t).toISOString().slice(0, 10);
        const seg = wl.classifyDay(iso, meteo.get(iso));
        kg += rate * (facteursVrais[seg] ?? 1);
      }
      if (noise) kg *= 1 + (k % 2 === 0 ? noise : -noise); // bruit déterministe
      rows.push({ cav_id: 100 + c, date: new Date(cursor).toISOString().slice(0, 10), kg });
      prev = cursor;
      cursor += step * 86400000;
      k++;
    }
  }
  return rows;
}

describe('isBeauTemps / classifyDay', () => {
  it('applique les seuils par défaut (≥ 15 °C et < 1 mm)', () => {
    expect(wl.isBeauTemps(18, 0)).toBe(true);
    expect(wl.isBeauTemps(14.9, 0)).toBe(false);
    expect(wl.isBeauTemps(20, 3)).toBe(false);
    expect(wl.isBeauTemps(null, 0)).toBeNull();
    expect(wl.isBeauTemps(20, null)).toBeNull();
  });

  it('accepte des seuils personnalisés', () => {
    expect(wl.isBeauTemps(13, 0, { tempMin: 12 })).toBe(true);
    expect(wl.isBeauTemps(20, 1.5, { precipMax: 2 })).toBe(true);
  });

  it('classe week-end / semaine × beau / autre', () => {
    // 2026-08-22 = samedi, 2026-08-19 = mercredi
    expect(wl.classifyDay('2026-08-22', BEAU)).toBe('we_beau');
    expect(wl.classifyDay('2026-08-23', GRIS)).toBe('we_autre'); // dimanche
    expect(wl.classifyDay('2026-08-19', BEAU)).toBe('sem_beau');
    expect(wl.classifyDay('2026-08-19', GRIS)).toBe('sem_autre');
    expect(wl.classifyDay('2026-08-19', undefined)).toBeNull(); // météo inconnue
  });
});

describe('intervalDays / buildIntervals', () => {
  it('énumère (start, end] en UTC', () => {
    expect(wl.intervalDays('2026-08-01', '2026-08-04')).toEqual(['2026-08-02', '2026-08-03', '2026-08-04']);
  });

  it('construit les intervalles par CAV et écarte les trous trop longs', () => {
    const rows = [
      { cav_id: 1, date: '2026-06-01', kg: 10 },
      { cav_id: 1, date: '2026-06-08', kg: 50 },
      { cav_id: 1, date: '2026-09-01', kg: 60 },  // 85 j d'écart → écarté
      { cav_id: 2, date: '2026-06-03', kg: 5 },
      { cav_id: 2, date: '2026-06-10', kg: 0 },   // kg nul → ignoré
      { cav_id: 2, date: '2026-06-12', kg: 30 },  // 9 j depuis le 03
    ];
    const intervals = wl.buildIntervals(rows);
    expect(intervals).toHaveLength(2);
    expect(intervals.find((i) => i.cavId === 1)).toMatchObject({ start: '2026-06-01', end: '2026-06-08', days: 7, kg: 50 });
    expect(intervals.find((i) => i.cavId === 2)).toMatchObject({ days: 9, kg: 30 });
  });
});

describe('estimateWeatherFactors — recouvrement de la vérité terrain', () => {
  const START = '2025-09-01';
  const JOURS = 340;
  const meteo = buildMeteo(START, JOURS + 2);
  const VRAIS = { sem_autre: 1.0, sem_beau: 1.1, we_autre: 1.15, we_beau: 1.45 };

  it('retrouve les ratios appliqués (beau vs ordinaire) à ±0.04, sans bruit', () => {
    const intervals = wl.buildIntervals(buildTonnage(START, JOURS, meteo, VRAIS));
    const res = wl.estimateWeatherFactors(intervals, meteo);
    expect(res.ok).toBe(true);
    expect(res.intervalles).toBeGreaterThanOrEqual(60);
    // Les ratios sont invariants par normalisation — c'est EUX que le moteur applique.
    expect(Math.abs(res.ratios.beau_weekend - 1.45 / 1.15)).toBeLessThan(0.04);
    expect(Math.abs(res.ratios.beau_semaine - 1.1)).toBeLessThan(0.04);
    // Ordre attendu des facteurs normalisés
    expect(res.facteurs.we_beau).toBeGreaterThan(res.facteurs.we_autre);
    expect(res.facteurs.sem_beau).toBeGreaterThan(res.facteurs.sem_autre);
  });

  it('reste dans la tolérance avec un bruit déterministe de ±4 %', () => {
    const intervals = wl.buildIntervals(buildTonnage(START, JOURS, meteo, VRAIS, { noise: 0.04 }));
    const res = wl.estimateWeatherFactors(intervals, meteo);
    expect(res.ok).toBe(true);
    expect(Math.abs(res.ratios.beau_weekend - 1.45 / 1.15)).toBeLessThan(0.08);
    expect(Math.abs(res.ratios.beau_semaine - 1.1)).toBeLessThan(0.08);
  });

  it('borne les facteurs et ratios extrêmes (clamp)', () => {
    const extremes = { sem_autre: 1.0, sem_beau: 1.0, we_autre: 1.0, we_beau: 5.0 };
    const intervals = wl.buildIntervals(buildTonnage(START, JOURS, meteo, extremes));
    const res = wl.estimateWeatherFactors(intervals, meteo);
    expect(res.ok).toBe(true);
    expect(res.facteurs.we_beau).toBeLessThanOrEqual(1.6);
    expect(res.ratios.beau_weekend).toBeLessThanOrEqual(1.5);
  });

  it('refuse un échantillon trop petit (jamais de valeur inventée)', () => {
    const petit = wl.buildIntervals(buildTonnage(START, 60, meteo, VRAIS)).slice(0, 10);
    const res = wl.estimateWeatherFactors(petit, meteo);
    expect(res.ok).toBe(false);
    expect(res.raison).toMatch(/intervalles/);
  });

  it('refuse quand un segment n\'est pas assez exposé', () => {
    // Météo TOUJOURS belle → segments « autre » à zéro jour.
    const toutBeau = new Map([...meteo.keys()].map((d) => [d, BEAU]));
    const intervals = wl.buildIntervals(buildTonnage(START, JOURS, toutBeau, VRAIS));
    const res = wl.estimateWeatherFactors(intervals, toutBeau);
    expect(res.ok).toBe(false);
    expect(res.raison).toMatch(/sous-exposé/);
  });

  it('écarte les intervalles mal couverts par la météo', () => {
    // Aucune météo connue → tous les intervalles écartés → insuffisant.
    const res = wl.estimateWeatherFactors(
      wl.buildIntervals(buildTonnage(START, JOURS, meteo, VRAIS)),
      new Map()
    );
    expect(res.ok).toBe(false);
    expect(res.ecartes_meteo).toBeGreaterThan(0);
  });
});

describe('getLearnedWeatherRatios (lecture persistée, pool mocké)', () => {
  beforeEach(() => { mockQuery.mockReset(); wl.invalidateCache(); });

  it('renvoie facteurs + ratios quand les 4 segments sont en base', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { segment: 'sem_autre', factor: 0.98, jours: 900, intervalles: 300, cavs: 40, computed_at: '2026-08-01T04:00:00Z' },
        { segment: 'sem_beau', factor: 1.05, jours: 420, intervalles: 300, cavs: 40, computed_at: '2026-08-01T04:00:00Z' },
        { segment: 'we_autre', factor: 1.08, jours: 350, intervalles: 300, cavs: 40, computed_at: '2026-08-01T04:00:00Z' },
        { segment: 'we_beau', factor: 1.4, jours: 160, intervalles: 300, cavs: 40, computed_at: '2026-08-01T04:00:00Z' },
      ],
    });
    const r = await wl.getLearnedWeatherRatios();
    expect(r.ok).toBe(true);
    expect(r.ratios.beau_weekend).toBeCloseTo(1.4 / 1.08, 2);
    expect(r.ratios.beau_semaine).toBeCloseTo(1.05 / 0.98, 2);
    // Cache : un second appel ne retape pas la base
    await wl.getLearnedWeatherRatios();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('{ok:false} quand la table est vide ou absente', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect((await wl.getLearnedWeatherRatios()).ok).toBe(false);

    wl.invalidateCache();
    const err = new Error('relation "predictive_weather_factors" does not exist');
    err.code = '42P01';
    mockQuery.mockRejectedValue(err);
    expect((await wl.getLearnedWeatherRatios()).ok).toBe(false);
  });
});

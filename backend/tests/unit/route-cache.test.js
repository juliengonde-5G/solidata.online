/**
 * Cache des tronçons routiers.
 *
 * Enjeu métier : le moteur de temps demande une distance ROUTIÈRE par tronçon
 * et l'écran de création recalcule à chaque point ajouté — sans cache, une
 * seule tournée composée à la main déclenche des centaines d'appels au
 * routeur. Ces tests verrouillent les deux propriétés qui comptent :
 *   1. un tronçon déjà mesuré n'est JAMAIS redemandé ;
 *   2. un repli approché (routeur injoignable) n'est JAMAIS mémorisé — sinon
 *      l'approximation remplacerait définitivement la mesure réelle.
 */
jest.mock('../../src/config/database', () => ({ query: jest.fn() }));

const {
  roundCoord, legKey, isCacheable, cachedRouteSegment, resetMemo,
} = require('../../src/services/route-cache');

const OSRM = { distance_km: 12.4, duration_min: 21.7, source: 'osrm' };
const REPLI = { distance_km: 9.1, duration_min: 18.2, source: 'haversine' };

beforeEach(() => resetMemo());

describe('roundCoord', () => {
  test('arrondit à 5 décimales (~1 m) : le bruit de saisie ne crée pas de clé', () => {
    expect(roundCoord(49.4231234)).toBe(49.42312);
    expect(roundCoord('1.09934999')).toBe(1.09935);
  });
  test('valeur non numérique → null (jamais de clé bancale)', () => {
    expect(roundCoord(null)).toBeNull();
    expect(roundCoord('abc')).toBeNull();
    expect(roundCoord(NaN)).toBeNull();
  });
});

describe('legKey', () => {
  test('deux relevés du même tronçon partagent la clé', () => {
    expect(legKey(49.42310001, 1.0993, 49.5, 1.2))
      .toBe(legKey(49.4231, 1.0993, 49.5, 1.2));
  });
  test('le sens compte : A→B et B→A sont deux tronçons', () => {
    expect(legKey(49.4, 1.0, 49.5, 1.1)).not.toBe(legKey(49.5, 1.1, 49.4, 1.0));
  });
  test('coordonnée invalide → null', () => {
    expect(legKey(null, 1.0, 49.5, 1.1)).toBeNull();
  });
});

describe('isCacheable', () => {
  test('seule une mesure du routeur est mémorisable', () => {
    expect(isCacheable(OSRM)).toBe(true);
    expect(isCacheable(REPLI)).toBe(false);
    expect(isCacheable(null)).toBe(false);
    expect(isCacheable({ distance_km: NaN, duration_min: 1, source: 'osrm' })).toBe(false);
  });
});

describe('cachedRouteSegment', () => {
  test('1er appel : le routeur est interrogé, la mesure est écrite en base', async () => {
    const routeSegment = jest.fn().mockResolvedValue(OSRM);
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const r = await cachedRouteSegment(49.4231, 1.0993, 49.5, 1.2, { routeSegment, pool: db });
    expect(r).toMatchObject({ distance_km: 12.4, duration_min: 21.7, source: 'osrm' });
    expect(routeSegment).toHaveBeenCalledTimes(1);
    const inserts = db.query.mock.calls.filter((c) => /INSERT INTO route_legs_cache/.test(c[0]));
    expect(inserts).toHaveLength(1);
  });

  test('2e appel identique : le routeur n’est PAS rappelé', async () => {
    const routeSegment = jest.fn().mockResolvedValue(OSRM);
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await cachedRouteSegment(49.4231, 1.0993, 49.5, 1.2, { routeSegment, pool: db });
    const r2 = await cachedRouteSegment(49.4231, 1.0993, 49.5, 1.2, { routeSegment, pool: db });
    expect(routeSegment).toHaveBeenCalledTimes(1);
    expect(r2).toMatchObject({ distance_km: 12.4, duration_min: 21.7, source: 'cache' });
  });

  test('tronçon déjà en base : servi sans appel au routeur', async () => {
    const routeSegment = jest.fn().mockResolvedValue(OSRM);
    const db = {
      query: jest.fn().mockImplementation((sql) => (
        /SELECT distance_km/.test(sql)
          ? Promise.resolve({ rows: [{ distance_km: 7.5, duration_min: 13 }] })
          : Promise.resolve({ rows: [] })
      )),
    };
    const r = await cachedRouteSegment(49.4231, 1.0993, 49.5, 1.2, { routeSegment, pool: db });
    expect(routeSegment).not.toHaveBeenCalled();
    expect(r).toEqual({ distance_km: 7.5, duration_min: 13, source: 'cache' });
  });

  test('routeur injoignable : le repli est renvoyé mais JAMAIS mémorisé', async () => {
    const routeSegment = jest.fn().mockResolvedValue(REPLI);
    const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const r1 = await cachedRouteSegment(49.4231, 1.0993, 49.5, 1.2, { routeSegment, pool: db });
    expect(r1.source).toBe('haversine');
    expect(db.query.mock.calls.filter((c) => /INSERT INTO route_legs_cache/.test(c[0]))).toHaveLength(0);
    // Le tronçon est bien retenté au passage suivant (aucune approximation figée)
    await cachedRouteSegment(49.4231, 1.0993, 49.5, 1.2, { routeSegment, pool: db });
    expect(routeSegment).toHaveBeenCalledTimes(2);
  });

  test('table absente (base non migrée) : le calcul fonctionne quand même', async () => {
    const routeSegment = jest.fn().mockResolvedValue(OSRM);
    const err = new Error('relation "route_legs_cache" does not exist');
    err.code = '42P01';
    const db = { query: jest.fn().mockRejectedValue(err) };
    const r = await cachedRouteSegment(49.4231, 1.0993, 49.5, 1.2, { routeSegment, pool: db });
    expect(r).toMatchObject({ distance_km: 12.4, source: 'osrm' });
  });

  test('coordonnée invalide : passe directement au routeur, sans clé de cache', async () => {
    const routeSegment = jest.fn().mockResolvedValue(OSRM);
    const db = { query: jest.fn() };
    await cachedRouteSegment(null, 1.0993, 49.5, 1.2, { routeSegment, pool: db });
    expect(routeSegment).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });
});

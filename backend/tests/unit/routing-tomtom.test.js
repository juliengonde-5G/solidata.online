/**
 * Routage TomTom avec trafic, en mode poids lourd.
 *
 * Enjeux vérifiés :
 *   • un appel porte la SÉQUENCE ENTIÈRE (économie du forfait : jamais un
 *     appel par tronçon) ;
 *   • le camion est déclaré comme tel, avec son poids réel — un itinéraire de
 *     voiture peut passer par un pont interdit au véhicule ;
 *   • sans clé ou en cas de silence du service, on renvoie null : l'appelant
 *     retombe sur OSRM et le DIT, aucune donnée n'est fabriquée.
 */
jest.mock('../../src/config/database', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) }));

const {
  buildRouteUrl, parseRouteResponse, poidsRoulantKg, tomtomRouteSequence, MAX_WAYPOINTS,
} = require('../../src/services/routing-tomtom');

const WAYPOINTS = [
  { lat: 49.4231, lng: 1.0993 },
  { lat: 49.4400, lng: 1.1200 },
  { lat: 49.4231, lng: 1.0993 },
];

describe('poidsRoulantKg', () => {
  test('poids à vide + charge utile = hypothèse haute (camion plein)', () => {
    expect(poidsRoulantKg({ tare_weight_kg: 3500, max_capacity_kg: 2000 })).toBe(5500);
  });
  test('charge utile inconnue : le poids à vide suffit', () => {
    expect(poidsRoulantKg({ tare_weight_kg: 3500, max_capacity_kg: null })).toBe(3500);
  });
  test('poids inconnu → null : on n’invente pas un tonnage', () => {
    expect(poidsRoulantKg({ tare_weight_kg: null })).toBeNull();
    expect(poidsRoulantKg(null)).toBeNull();
  });
});

describe('buildRouteUrl', () => {
  test('la séquence entière tient dans UN appel', () => {
    const url = buildRouteUrl(WAYPOINTS, { key: 'K' });
    expect(url).toContain('49.4231,1.0993:49.44,1.12:49.4231,1.0993');
    expect((url.match(/calculateRoute/g) || [])).toHaveLength(1);
  });

  test('le véhicule est déclaré poids lourd, avec son poids', () => {
    const url = buildRouteUrl(WAYPOINTS, {
      key: 'K', vehicule: { tare_weight_kg: 3500, max_capacity_kg: 2000 },
    });
    expect(url).toContain('travelMode=truck');
    expect(url).toContain('vehicleCommercial=true');
    expect(url).toContain('vehicleWeight=5500');
  });

  test('le trafic est demandé, avec les deux durées (avec et sans)', () => {
    const url = buildRouteUrl(WAYPOINTS, { key: 'K' });
    expect(url).toContain('traffic=true');
    expect(url).toContain('computeTravelTimeFor=all');
  });

  test('poids inconnu : aucun vehicleWeight forcé', () => {
    expect(buildRouteUrl(WAYPOINTS, { key: 'K' })).not.toContain('vehicleWeight');
  });
});

describe('parseRouteResponse', () => {
  const reponse = {
    routes: [{
      summary: {
        lengthInMeters: 18420, travelTimeInSeconds: 2100,
        noTrafficTravelTimeInSeconds: 1680, trafficDelayInSeconds: 420,
      },
      legs: [
        { summary: { lengthInMeters: 9000, travelTimeInSeconds: 1000 } },
        { summary: { lengthInMeters: 9420, travelTimeInSeconds: 1100 } },
      ],
    }],
  };

  test('isole le retard de circulation (affichable tel quel)', () => {
    const r = parseRouteResponse(reponse);
    expect(r.distance_km).toBeCloseTo(18.42, 3);
    expect(r.duration_min).toBe(35);
    expect(r.duration_sans_trafic_min).toBe(28);
    expect(r.retard_trafic_min).toBe(7);
    expect(r.source).toBe('tomtom');
  });

  test('rend le détail PAR TRONÇON (un seul appel suffit à toute la séquence)', () => {
    const r = parseRouteResponse(reponse);
    expect(r.legs).toHaveLength(2);
    expect(r.legs[0].km).toBe(9);
    expect(r.legs[1].min).toBeCloseTo(18.33, 2);
  });

  test('charge utile inexploitable → null', () => {
    expect(parseRouteResponse({})).toBeNull();
    expect(parseRouteResponse({ routes: [] })).toBeNull();
    expect(parseRouteResponse({ routes: [{ summary: {} }] })).toBeNull();
  });
});

describe('tomtomRouteSequence', () => {
  test('sans clé : null, sans aucun appel réseau', async () => {
    const fetchImpl = jest.fn();
    const r = await tomtomRouteSequence(WAYPOINTS, { fetchImpl });
    expect(r).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('séquence trop courte ou trop longue : refusée sans appel', async () => {
    const fetchImpl = jest.fn();
    expect(await tomtomRouteSequence([WAYPOINTS[0]], { key: 'K', fetchImpl })).toBeNull();
    const trop = Array.from({ length: MAX_WAYPOINTS + 1 }, () => WAYPOINTS[0]);
    expect(await tomtomRouteSequence(trop, { key: 'K', fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('service en erreur : null (l’appelant retombera sur OSRM)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    expect(await tomtomRouteSequence(WAYPOINTS, { key: 'K', fetchImpl })).toBeNull();
  });

  test('réponse valide : un seul appel pour toute la séquence', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{
        summary: { lengthInMeters: 12000, travelTimeInSeconds: 1200,
          noTrafficTravelTimeInSeconds: 1000, trafficDelayInSeconds: 200 },
        legs: [{ summary: { lengthInMeters: 12000, travelTimeInSeconds: 1200 } }],
      }] }),
    });
    const r = await tomtomRouteSequence(WAYPOINTS, { key: 'K', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ distance_km: 12, duration_min: 20, retard_trafic_min: 3.3333333333333335 });
  });
});

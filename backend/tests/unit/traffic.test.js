/**
 * Événements de circulation — fonctions PURES du service trafic.
 * Doctrine : une carte sans information n'est JAMAIS présentée comme une carte
 * sans perturbation (cf. getTrafficIncidents → disponible: false).
 */
const { parseBbox, mapIncidents, CATEGORIES } = require('../../src/services/traffic');

describe('parseBbox', () => {
  test('emprise valide', () => {
    expect(parseBbox('49.3,1.0,49.5,1.2')).toEqual({ sud: 49.3, ouest: 1.0, nord: 49.5, est: 1.2 });
  });

  test('emprise absente ou mal formée → refusée', () => {
    expect(parseBbox('')).toBeNull();
    expect(parseBbox(null)).toBeNull();
    expect(parseBbox('49.3,1.0')).toBeNull();
    expect(parseBbox('a,b,c,d')).toBeNull();
  });

  test('bornes inversées → refusées (on n’interroge pas une zone impossible)', () => {
    expect(parseBbox('49.5,1.0,49.3,1.2')).toBeNull();
    expect(parseBbox('49.3,1.5,49.5,1.2')).toBeNull();
  });

  test('emprise démesurée → refusée (garde-fou de volume)', () => {
    expect(parseBbox('40,0,49.5,1.2')).toBeNull();
    expect(parseBbox('49.3,-5,49.5,1.2')).toBeNull();
  });

  test('coordonnées hors du monde → refusées', () => {
    expect(parseBbox('-91,1.0,49.5,1.2')).toBeNull();
    expect(parseBbox('49.3,1.0,91,1.2')).toBeNull();
  });
});

describe('mapIncidents', () => {
  test('LineString : le premier point sert de position', () => {
    const r = mapIncidents({ incidents: [{
      geometry: { type: 'LineString', coordinates: [[1.09, 49.44], [1.10, 49.45]] },
      properties: { id: 'a', iconCategory: 6, magnitudeOfDelay: 3, delay: 420,
        events: [{ description: 'Circulation ralentie' }] },
    }] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'a', type: 'bouchon', latitude: 49.44, longitude: 1.09, gravite: 3, retard_sec: 420 });
    expect(r[0].description).toBe('Circulation ralentie');
  });

  test('Point simple et catégorie fermeture', () => {
    const r = mapIncidents({ incidents: [{
      geometry: { type: 'Point', coordinates: [1.11, 49.43] },
      properties: { id: 'b', iconCategory: 8, events: [] },
    }] });
    expect(r[0]).toMatchObject({ type: 'fermeture', latitude: 49.43 });
    // Sans libellé d'événement, on retombe sur le nom de la catégorie.
    expect(r[0].description).toBe(CATEGORIES[8].label);
  });

  test('un incident sans position est IGNORÉ (rien d’inventé sur la carte)', () => {
    const r = mapIncidents({ incidents: [
      { properties: { id: 'sans-position', iconCategory: 1 } },
      { geometry: { coordinates: ['x', 'y'] }, properties: { id: 'illisible' } },
    ] });
    expect(r).toEqual([]);
  });

  test('catégorie inconnue → « autre », jamais un incident perdu', () => {
    const r = mapIncidents({ incidents: [{
      geometry: { type: 'Point', coordinates: [1.1, 49.4] },
      properties: { id: 'c', iconCategory: 999 },
    }] });
    expect(r[0].type).toBe('autre');
  });

  test('charge vide ou inattendue → liste vide', () => {
    expect(mapIncidents({})).toEqual([]);
    expect(mapIncidents(null)).toEqual([]);
    expect(mapIncidents({ incidents: 'pas un tableau' })).toEqual([]);
  });
});

/**
 * Facteur de circulation du jour + économie du forfait TomTom.
 *
 * Constat à l'origine : les incidents étaient AFFICHÉS sur la carte mais le
 * calcul des durées de tournée n'en tenait aucun compte
 * (collection_context.traffic_factor n'était jamais alimenté → toujours 1,
 * « circulation fluide », quelle que soit la réalité).
 */
jest.mock('../../src/config/database', () => ({ query: jest.fn() }));

const {
  facteurDepuisReleves, snapBbox, shouldMeasureTraffic, partiesParis,
  FACTEUR_MIN, FACTEUR_MAX, GRILLE_DEG,
} = require('../../src/services/traffic');

describe('facteurDepuisReleves', () => {
  const releve = (actuel, fluide) => ({ currentTravelTime: actuel, freeFlowTravelTime: fluide });

  test('moyenne des rapports « temps actuel / temps fluide »', () => {
    // 120/100 = 1,2 et 140/100 = 1,4 → 1,30
    expect(facteurDepuisReleves([releve(120, 100), releve(140, 100)])).toBe(1.3);
  });

  test('circulation fluide → facteur 1 (jamais en dessous)', () => {
    // Un trajet plus rapide que la vitesse libre n'a pas de sens pour estimer.
    expect(facteurDepuisReleves([releve(90, 100), releve(95, 100)])).toBe(FACTEUR_MIN);
  });

  test('tronçon fermé : le facteur est borné, il ne double pas la journée', () => {
    expect(facteurDepuisReleves([releve(900, 100), releve(800, 100)])).toBe(FACTEUR_MAX);
  });

  test('échantillon insuffisant → null : AUCUNE écriture plutôt qu’un chiffre bancal', () => {
    expect(facteurDepuisReleves([])).toBeNull();
    expect(facteurDepuisReleves([releve(120, 100)])).toBeNull();
    expect(facteurDepuisReleves(null)).toBeNull();
  });

  test('relevés inexploitables ignorés (division par zéro, valeurs absentes)', () => {
    const r = facteurDepuisReleves([
      releve(120, 100), releve(140, 100), releve(100, 0), releve(null, 100), {},
    ]);
    expect(r).toBe(1.3); // seuls les deux relevés valides comptent
  });
});

describe('snapBbox — économie du forfait (2 500 appels/mois)', () => {
  test('deux vues voisines partagent la même emprise arrondie', () => {
    const a = snapBbox({ sud: 49.401, ouest: 1.081, nord: 49.459, est: 1.139 });
    const b = snapBbox({ sud: 49.403, ouest: 1.083, nord: 49.457, est: 1.137 });
    expect(a).toEqual(b);
  });

  test('l’emprise arrondie CONTIENT toujours l’emprise demandée', () => {
    const dem = { sud: 49.4111, ouest: 1.0777, nord: 49.4555, est: 1.1333 };
    const z = snapBbox(dem);
    expect(z.sud).toBeLessThanOrEqual(dem.sud);
    expect(z.ouest).toBeLessThanOrEqual(dem.ouest);
    expect(z.nord).toBeGreaterThanOrEqual(dem.nord);
    expect(z.est).toBeGreaterThanOrEqual(dem.est);
  });

  test('deux zones réellement distinctes gardent des clés distinctes', () => {
    const rouen = snapBbox({ sud: 49.40, ouest: 1.08, nord: 49.46, est: 1.14 });
    const havre = snapBbox({ sud: 49.48, ouest: 0.10, nord: 49.54, est: 0.16 });
    expect(rouen).not.toEqual(havre);
    expect(GRILLE_DEG).toBeGreaterThan(0);
  });
});

describe('shouldMeasureTraffic — cadence en heure de Paris', () => {
  // Le conteneur tourne en UTC : la décision doit être prise à Paris, et le
  // changement d'heure ne doit pas décaler les relevés.
  test('heure d’hiver : 8h Paris = 07h UTC', () => {
    expect(shouldMeasureTraffic(new Date('2027-01-19T07:00:00Z'))).toBe(true); // mardi
    expect(shouldMeasureTraffic(new Date('2027-01-19T08:00:00Z'))).toBe(false); // 9h Paris
  });

  test('heure d’été : 8h Paris = 06h UTC', () => {
    expect(shouldMeasureTraffic(new Date('2027-07-13T06:00:00Z'))).toBe(true); // mardi
    expect(shouldMeasureTraffic(new Date('2027-07-13T07:00:00Z'))).toBe(false); // 9h Paris
  });

  test('les trois créneaux du jour ouvré sont retenus', () => {
    ['06:00', '09:00', '12:00'].forEach((h) => { // 8h, 11h, 14h Paris en été
      expect(shouldMeasureTraffic(new Date(`2027-07-13T${h}:00Z`))).toBe(true);
    });
  });

  test('dimanche : aucun relevé (aucune collecte, aucun appel consommé)', () => {
    expect(shouldMeasureTraffic(new Date('2027-07-11T06:00:00Z'))).toBe(false);
  });

  test('partiesParis rend bien le jour civil de Paris, pas celui du conteneur', () => {
    // 23h30 UTC un 13 juillet = 01h30 le 14 juillet à Paris (été)
    expect(partiesParis(new Date('2027-07-13T23:30:00Z')).date).toBe('2027-07-14');
  });
});

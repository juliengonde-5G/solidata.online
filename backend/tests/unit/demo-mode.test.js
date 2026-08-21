/**
 * Tests du mode DÉMO (formations chauffeur) — partie PURE.
 * La neutralisation des écritures est vérifiée côté contrat
 * (tests/contract/demo-formation-contract.test.js).
 */
const { isDemoTour, DEMO_VEHICLE_REGISTRATION, DEMO_NB_POINTS } = require('../../src/services/demo-mode');

describe('isDemoTour', () => {
  test('reconnaît le booléen PostgreSQL', () => {
    expect(isDemoTour({ is_demo: true })).toBe(true);
    expect(isDemoTour({ is_demo: false })).toBe(false);
  });

  test('tolère les formes texte renvoyées selon la projection', () => {
    expect(isDemoTour({ is_demo: 't' })).toBe(true);
    expect(isDemoTour({ is_demo: 'true' })).toBe(true);
    expect(isDemoTour({ is_demo: 1 })).toBe(true);
  });

  test('une tournée sans drapeau n’est JAMAIS traitée comme une démo', () => {
    // Garde-fou central : en cas de doute, on se comporte comme en production
    // (les effets métier s'appliquent) plutôt que de perdre des données réelles.
    expect(isDemoTour({})).toBe(false);
    expect(isDemoTour({ is_demo: null })).toBe(false);
    expect(isDemoTour({ is_demo: undefined })).toBe(false);
    expect(isDemoTour(null)).toBe(false);
    expect(isDemoTour(undefined)).toBe(false);
    expect(isDemoTour({ is_demo: 'f' })).toBe(false);
    expect(isDemoTour({ is_demo: 0 })).toBe(false);
  });
});

describe('constantes du scénario de formation', () => {
  test('immatriculation réservée et nombre de points', () => {
    expect(DEMO_VEHICLE_REGISTRATION).toBe('DEMO-FORMATION');
    expect(DEMO_NB_POINTS).toBeGreaterThanOrEqual(5);
    expect(DEMO_NB_POINTS).toBeLessThanOrEqual(15);
  });
});

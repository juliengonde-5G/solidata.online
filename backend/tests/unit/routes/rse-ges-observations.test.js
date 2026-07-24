// Revue Codex (PR#79) — garde anti-faux-zéro du volet environnement du bilan RSE.
// gesHasObservations décide si le GES annuel doit être présenté comme MESURÉ :
// vrai ssi au moins un relevé d'énergie OU un plein de carburant existe. Sans
// observation, le bilan affiche « non mesuré » (jamais 0 tCO2e inventé).
const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => next(),
  authorize: () => (req, res, next) => next(),
}));

const { gesHasObservations } = require('../../../src/routes/rse');

describe('gesHasObservations (garde anti-faux-zéro GES)', () => {
  it('est exportée', () => {
    expect(typeof gesHasObservations).toBe('function');
  });
  it('faux si ges null/undefined', () => {
    expect(gesHasObservations(null)).toBe(false);
    expect(gesHasObservations(undefined)).toBe(false);
  });
  it('faux si aucune observation (tableaux vides, totaux à 0) — cas du faux zéro', () => {
    expect(gesHasObservations({ energie: [], carburant: [], totaux: { tco2e_total: 0 } })).toBe(false);
  });
  it('vrai avec au moins un relevé d’énergie', () => {
    expect(gesHasObservations({ energie: [{ poste: 'electricite', conso: 1200 }], carburant: [] })).toBe(true);
  });
  it('vrai avec au moins un plein de carburant (énergie vide)', () => {
    expect(gesHasObservations({ energie: [], carburant: [{ poste: 'gazole', litres: 300 }] })).toBe(true);
  });
  it('robuste si les champs ne sont pas des tableaux', () => {
    expect(gesHasObservations({ energie: null, carburant: null })).toBe(false);
    expect(gesHasObservations({})).toBe(false);
  });
});

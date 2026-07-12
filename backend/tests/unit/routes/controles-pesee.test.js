// Tests du helper de réconciliation triple pesée (item 31b, Vague 1)
const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));

const { computePeseeReconciliation } = require('../../../src/routes/controles-pesee');

describe('computePeseeReconciliation (réconciliation triple pesée)', () => {
  it('calcule les 3 écarts (kg + %) et remonte le niveau global le plus sévère', () => {
    const r = computePeseeReconciliation({ pesee_interne: 24.0, pesee_client: 22.0, pesee_cartons: 23.0 });
    // interne(24) vs client(22) : +2 t → 2/22 = 9,09 % → litige
    expect(r.interne_client.ecart_t).toBeCloseTo(2.0, 3);
    expect(r.interne_client.ecart_kg).toBe(2000);
    expect(r.interne_client.ecart_pct).toBeCloseTo(9.09, 1);
    expect(r.interne_client.niveau).toBe('litige');
    // cartons(23) vs client(22) : +1 t → 4,55 % → acceptable
    expect(r.cartons_client.niveau).toBe('acceptable');
    // cartons(23) vs interne(24) : -1 t → 4,17 % → acceptable
    expect(r.cartons_interne.niveau).toBe('acceptable');
    expect(r.niveau_global).toBe('litige');
    expect(r.alerte).toBe(true);
  });

  it('classe conforme quand l\'écart est <= 2 %', () => {
    const r = computePeseeReconciliation({ pesee_interne: 20.0, pesee_client: 20.2, pesee_cartons: null });
    expect(r.interne_client.niveau).toBe('conforme'); // 0,2/20,2 = 0,99 %
    expect(r.cartons_client).toBeNull();
    expect(r.cartons_interne).toBeNull();
    expect(r.niveau_global).toBe('conforme');
    expect(r.alerte).toBe(false);
  });

  it('ignore les paires dont une masse manque', () => {
    const r = computePeseeReconciliation({ pesee_interne: null, pesee_client: 10, pesee_cartons: null });
    expect(r.interne_client).toBeNull();
    expect(r.cartons_client).toBeNull();
    expect(r.cartons_interne).toBeNull();
    expect(r.niveau_global).toBeNull();
    expect(r.alerte).toBe(false);
  });

  it('gère les 3 masses présentes toutes conformes', () => {
    const r = computePeseeReconciliation({ pesee_interne: 10.0, pesee_client: 10.1, pesee_cartons: 10.05 });
    expect(r.niveau_global).toBe('conforme');
    expect(r.pesee_cartons_t).toBe(10.05);
  });
});

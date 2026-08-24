/**
 * CO2 d'une tournée : consommation MESURÉE du véhicule × facteur ADEME.
 *
 * Doctrine vérifiée ici : tout ce qui n'est pas mesuré vaut `null`, avec un
 * motif exploitable par l'écran. Un CO2 estimé sur une consommation « moyenne
 * de la profession » serait un chiffre inventé présenté comme une mesure.
 */
jest.mock('../../src/config/database', () => ({ query: jest.fn() }));

const { emissionsVehicule } = require('../../src/services/vehicle-emissions');

/** Pool factice : aiguille chaque requête sur son motif SQL. */
function poolAvec({ pleins = [], facteurs = [] } = {}) {
  return {
    query: jest.fn().mockImplementation((sql) => {
      if (/FROM carburant_pleins/.test(sql)) return Promise.resolve({ rows: pleins });
      if (/FROM ges_facteurs/.test(sql)) return Promise.resolve({ rows: facteurs });
      return Promise.resolve({ rows: [] });
    }),
  };
}

const PLEINS = [
  { litres: 85, km_compteur: 10000, type_carburant: 'gazole' },
  { litres: 90, km_compteur: 10300, type_carburant: 'gazole' },
  { litres: 88, km_compteur: 10620, type_carburant: 'gazole' },
];
const GAZOLE = [{ facteur_kgco2e: '2.51000' }];

describe('emissionsVehicule', () => {
  test('deux pleins ou plus + facteur : mesure complète', async () => {
    const r = await emissionsVehicule(7, { pool: poolAvec({ pleins: PLEINS, facteurs: GAZOLE }) });
    expect(r.source).toBe('mesure');
    expect(r.litresPer100km).toBeGreaterThan(20);
    expect(r.kgCo2eParLitre).toBe(2.51);
    expect(r.carburant).toBe('gazole');
    expect(r.motif).toBeNull();
  });

  test('un seul plein : impossible de mesurer une consommation → null motivé', async () => {
    const r = await emissionsVehicule(7, {
      pool: poolAvec({ pleins: [PLEINS[0]], facteurs: GAZOLE }),
    });
    expect(r.litresPer100km).toBeNull();
    expect(r.kgCo2eParLitre).toBeNull();
    expect(r.motif).toBe('moins_de_deux_pleins_saisis');
  });

  test('aucun facteur d’émission pour ce carburant : conso conservée, CO2 null', async () => {
    const r = await emissionsVehicule(7, { pool: poolAvec({ pleins: PLEINS, facteurs: [] }) });
    expect(r.litresPer100km).toBeGreaterThan(0);
    expect(r.kgCo2eParLitre).toBeNull();
    expect(r.motif).toBe('facteur_emission_absent');
  });

  test('module Énergie absent de la base : la tournée continue, sans CO2', async () => {
    const pool = {
      query: jest.fn().mockRejectedValue(Object.assign(new Error('no table'), { code: '42P01' })),
    };
    const r = await emissionsVehicule(7, { pool });
    expect(r.motif).toBe('table_carburant_indisponible');
    expect(r.litresPer100km).toBeNull();
  });

  test('véhicule inconnu : refus net, sans requête', async () => {
    const pool = poolAvec();
    const r = await emissionsVehicule(null, { pool });
    expect(r.motif).toBe('vehicule_inconnu');
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('la consommation vient de la MÊME formule que le module Énergie', async () => {
    // Le calcul plein-à-plein n'est pas réécrit ici : on injecte la fonction
    // pour prouver qu'elle est bien appelée avec les pleins lus en base.
    const computeConso = jest.fn().mockReturnValue({ conso_l_100km: 31.4 });
    const r = await emissionsVehicule(7, {
      pool: poolAvec({ pleins: PLEINS, facteurs: GAZOLE }), computeConso,
    });
    expect(computeConso).toHaveBeenCalledWith(PLEINS);
    expect(r.litresPer100km).toBe(31.4);
  });
});

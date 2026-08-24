/**
 * Sélection des bornes à collecter — hiérarchie des 4 facteurs.
 *
 * Arbitrage client (août 2026), du plus au moins déterminant :
 *   remplissage > temps > distance > émissions.
 *
 * Ces tests vérifient que la hiérarchie est réellement respectée par le
 * calcul, et pas seulement documentée.
 */
const {
  scoreSelection, noteRemplissage, noteTemps, noteDistance, noteEmissions,
  POIDS_DEFAUT,
} = require('../../src/services/cav-scoring');

const CARBURANT = { litresPer100km: 28.4, kgCo2eParLitre: 2.51 };
const BASE = { fillPct: 60, daysSince: 7, nbContainers: 1, serviceMinutes: 10, detourKm: 7 };

describe('notes individuelles', () => {
  test('remplissage : les paliers de débordement sont respectés', () => {
    const n = (fillPct) => noteRemplissage({ fillPct, daysSince: 0, nbContainers: 1 });
    expect(n(110)).toBeGreaterThan(n(85));
    expect(n(85)).toBeGreaterThan(n(65));
    expect(n(65)).toBeGreaterThan(n(45));
    expect(n(45)).toBeGreaterThan(n(10));
  });

  test('remplissage : l’accumulation renforce, elle n’inverse jamais', () => {
    const recente = noteRemplissage({ fillPct: 85, daysSince: 0, nbContainers: 1 });
    const ancienne = noteRemplissage({ fillPct: 85, daysSince: 30, nbContainers: 1 });
    expect(ancienne).toBeGreaterThan(recente);
    // Une borne à moitié pleine depuis longtemps ne passe pas devant une
    // borne qui déborde aujourd'hui.
    expect(noteRemplissage({ fillPct: 45, daysSince: 60, nbContainers: 4 }))
      .toBeLessThan(noteRemplissage({ fillPct: 110, daysSince: 0, nbContainers: 1 }));
  });

  test('temps et distance : plus c’est court et proche, meilleur c’est', () => {
    expect(noteTemps({ serviceMinutes: 5 })).toBeGreaterThan(noteTemps({ serviceMinutes: 15 }));
    expect(noteDistance({ detourKm: 2 })).toBeGreaterThan(noteDistance({ detourKm: 12 }));
  });

  test('temps ou distance inconnus : note neutre, pas pénalisante', () => {
    expect(noteTemps({ serviceMinutes: null })).toBe(0.5);
    expect(noteDistance({ detourKm: null })).toBe(0.5);
  });

  test('émissions : null sans consommation mesurée — jamais estimées', () => {
    expect(noteEmissions({ detourKm: 7 }, {})).toBeNull();
    expect(noteEmissions({ detourKm: 7 }, { litresPer100km: 0, kgCo2eParLitre: 2.51 })).toBeNull();
    expect(noteEmissions({ detourKm: 7 }, CARBURANT)).toBeGreaterThan(0);
  });
});

describe('scoreSelection — hiérarchie des critères', () => {
  test('le remplissage prime sur tout le reste', () => {
    // Borne pleine mais lointaine et lente VS borne peu remplie, proche et rapide.
    const pleine = scoreSelection(
      { fillPct: 110, daysSince: 10, nbContainers: 2, serviceMinutes: 18, detourKm: 14 },
      { carburant: CARBURANT });
    const vide = scoreSelection(
      { fillPct: 20, daysSince: 1, nbContainers: 1, serviceMinutes: 3, detourKm: 1 },
      { carburant: CARBURANT });
    expect(pleine.score).toBeGreaterThan(vide.score);
  });

  test('à remplissage égal, le TEMPS départage avant la distance', () => {
    const rapideLoin = scoreSelection({ ...BASE, serviceMinutes: 3, detourKm: 14 });
    const lentProche = scoreSelection({ ...BASE, serviceMinutes: 19, detourKm: 1 });
    expect(rapideLoin.score).toBeGreaterThan(lentProche.score);
    expect(POIDS_DEFAUT.temps).toBeGreaterThan(POIDS_DEFAUT.distance);
  });

  test('à remplissage et temps égaux, la DISTANCE départage', () => {
    const proche = scoreSelection({ ...BASE, detourKm: 1 });
    const loin = scoreSelection({ ...BASE, detourKm: 14 });
    expect(proche.score).toBeGreaterThan(loin.score);
  });

  test('les émissions sont le DERNIER facteur : elles ne renversent rien', () => {
    // Une borne nettement mieux remplie reste devant, même avec un CO2 et une
    // distance défavorables.
    const mieuxRemplieLoin = scoreSelection(
      { fillPct: 85, daysSince: 7, nbContainers: 1, serviceMinutes: 10, detourKm: 13 },
      { carburant: CARBURANT });
    const moinsRempliePres = scoreSelection(
      { fillPct: 30, daysSince: 7, nbContainers: 1, serviceMinutes: 10, detourKm: 1 },
      { carburant: CARBURANT });
    expect(mieuxRemplieLoin.score).toBeGreaterThan(moinsRempliePres.score);
    expect(POIDS_DEFAUT.emissions).toBeLessThan(POIDS_DEFAUT.distance);
  });

  test('la hiérarchie est STRUCTURELLE : le remplissage pèse plus que les trois autres réunis', () => {
    // Sans cette propriété, temps + distance + émissions coalisés pourraient
    // renverser le critère premier — la hiérarchie ne serait qu'une intention.
    const secondaires = POIDS_DEFAUT.temps + POIDS_DEFAUT.distance + POIDS_DEFAUT.emissions;
    expect(POIDS_DEFAUT.remplissage).toBeGreaterThan(secondaires);
    expect(POIDS_DEFAUT.temps).toBeGreaterThan(POIDS_DEFAUT.distance);
    expect(POIDS_DEFAUT.distance).toBeGreaterThan(POIDS_DEFAUT.emissions);
  });

  test('même dans le pire cas secondaire, un écart de remplissage franc l’emporte', () => {
    // Borne pleine, lente et lointaine VS borne vide, instantanée et à côté.
    const pleine = scoreSelection(
      { fillPct: 110, daysSince: 0, nbContainers: 1, serviceMinutes: 20, detourKm: 15 },
      { carburant: CARBURANT });
    const vide = scoreSelection(
      { fillPct: 10, daysSince: 0, nbContainers: 1, serviceMinutes: 0, detourKm: 0 },
      { carburant: CARBURANT });
    expect(pleine.score).toBeGreaterThan(vide.score);
  });
});

describe('scoreSelection — honnêteté du critère émissions', () => {
  test('consommation mesurée : le critère est pris en compte et signalé', () => {
    const r = scoreSelection(BASE, { carburant: CARBURANT });
    expect(r.emissionsPrisesEnCompte).toBe(true);
    expect(r.detail.emissions).not.toBeNull();
  });

  test('sans plein saisi : critère ABSENT du score, jamais estimé à 0', () => {
    const r = scoreSelection(BASE, { carburant: {} });
    expect(r.emissionsPrisesEnCompte).toBe(false);
    expect(r.detail.emissions).toBeNull();
    // Le score reste sur [0,1] : le poids manquant n'est pas compté comme une
    // note nulle, il est retiré du dénominateur.
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  test('le classement reste cohérent quand les émissions manquent', () => {
    const avec = [
      scoreSelection({ ...BASE, detourKm: 1 }, { carburant: CARBURANT }).score,
      scoreSelection({ ...BASE, detourKm: 14 }, { carburant: CARBURANT }).score,
    ];
    const sans = [
      scoreSelection({ ...BASE, detourKm: 1 }, { carburant: {} }).score,
      scoreSelection({ ...BASE, detourKm: 14 }, { carburant: {} }).score,
    ];
    // Même ordre dans les deux cas : la borne proche devant la lointaine.
    expect(avec[0]).toBeGreaterThan(avec[1]);
    expect(sans[0]).toBeGreaterThan(sans[1]);
  });

  test('un véhicule gourmand pénalise plus la distance qu’un véhicule sobre', () => {
    const ecart = (conso) => {
      const proche = scoreSelection({ ...BASE, detourKm: 1 },
        { carburant: { litresPer100km: conso, kgCo2eParLitre: 2.51 } }).score;
      const loin = scoreSelection({ ...BASE, detourKm: 14 },
        { carburant: { litresPer100km: conso, kgCo2eParLitre: 2.51 } }).score;
      return proche - loin;
    };
    // Le critère émissions étant proportionnel à la distance, il renforce
    // l'écart ; sans consommation connue il ne joue pas du tout.
    expect(ecart(35)).toBeGreaterThan(
      scoreSelection({ ...BASE, detourKm: 1 }, { carburant: {} }).score
      - scoreSelection({ ...BASE, detourKm: 14 }, { carburant: {} }).score
    );
  });

  test('la confiance de la prédiction module le score', () => {
    const sur = scoreSelection({ ...BASE, confidence: 1 }).score;
    const incertain = scoreSelection({ ...BASE, confidence: 0.3 }).score;
    expect(incertain).toBeLessThan(sur);
  });

  test('score toujours borné, même sur des données aberrantes', () => {
    const r = scoreSelection({ fillPct: 9999, daysSince: 9999, nbContainers: 99,
      serviceMinutes: -5, detourKm: -3, confidence: 5 }, { carburant: CARBURANT });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });
});

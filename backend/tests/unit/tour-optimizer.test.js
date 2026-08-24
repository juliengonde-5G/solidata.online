/**
 * Moteur d'optimisation de tournée — CO2 & efficacité.
 *
 * Module PUR : la matrice de tronçons lui est fournie, donc ces tests portent
 * sur la DÉCISION d'ordonnancement, pas sur le fournisseur de routage.
 *
 * Propriétés vérifiées, dans l'ordre d'importance métier :
 *   1. le résultat n'est JAMAIS pire que l'ordre existant ;
 *   2. il est déterministe (une décision expliquée au chauffeur ne doit pas
 *      changer d'une exécution à l'autre) ;
 *   3. le CO2 vaut null — jamais 0 — quand il n'est pas calculable.
 */
const {
  co2Kg, coutSequence, score, optimiserOrdre, bilan,
  DEPART, ARRIVEE, OBJECTIFS,
} = require('../../src/services/tour-optimizer');

// Géométrie de test : des points sur un plan, distance euclidienne.
// La vitesse est constante SAUF sur les tronçons déclarés « encombrés », ce
// qui permet de vérifier que l'objectif « durée » diverge de « distance ».
function fabriqueLeg(points, encombres = {}) {
  return (a, b) => {
    const pa = points[a];
    const pb = points[b];
    if (!pa || !pb) return { km: 0, min: 0 };
    const km = Math.hypot(pa.x - pb.x, pa.y - pb.y);
    const facteur = encombres[`${a}>${b}`] || 1;
    return { km, min: km * 2 * facteur };
  };
}

describe('co2Kg', () => {
  test('conso mesurée × facteur ADEME × distance', () => {
    // 100 km à 30 L/100 km, gazole 2,51 kgCO2e/L → 75,3 kg
    expect(co2Kg(100, 30, 2.51)).toBe(75.3);
    expect(co2Kg(42.5, 28.4, 2.51)).toBeCloseTo(30.30, 2);
  });

  test('sans consommation mesurée → null, JAMAIS 0', () => {
    expect(co2Kg(100, null, 2.51)).toBeNull();
    expect(co2Kg(100, 0, 2.51)).toBeNull();
  });

  test('sans facteur d’émission → null', () => {
    expect(co2Kg(100, 30, null)).toBeNull();
    expect(co2Kg(100, 30, 0)).toBeNull();
  });

  test('distance nulle → 0 kg (c’est bien zéro, pas une inconnue)', () => {
    expect(co2Kg(0, 30, 2.51)).toBe(0);
  });
});

describe('coutSequence', () => {
  const points = {
    [DEPART]: { x: 0, y: 0 }, [ARRIVEE]: { x: 0, y: 0 },
    a: { x: 3, y: 0 }, b: { x: 3, y: 4 },
  };
  test('additionne départ → points → retour au centre', () => {
    const c = coutSequence(['a', 'b'], fabriqueLeg(points));
    // 3 (départ→a) + 4 (a→b) + 5 (b→arrivée) = 12
    expect(c.km).toBeCloseTo(12, 6);
    expect(c.min).toBeCloseTo(24, 6);
  });
  test('séquence vide = aller-retour à vide', () => {
    expect(coutSequence([], fabriqueLeg(points)).km).toBe(0);
  });
});

describe('optimiserOrdre', () => {
  // Carré de 10 × 10, centre au coin (0,0). L'ordre A→C→B→D croise ;
  // le tour du carré A→B→C→D ne croise pas.
  const carre = {
    [DEPART]: { x: 0, y: 0 }, [ARRIVEE]: { x: 0, y: 0 },
    A: { x: 10, y: 0 }, B: { x: 10, y: 10 }, C: { x: 0, y: 10 }, D: { x: 5, y: 15 },
  };

  test('défait un itinéraire qui se croise', () => {
    const r = optimiserOrdre(['A', 'C', 'B', 'D'], fabriqueLeg(carre));
    expect(r.ameliore).toBe(true);
    expect(r.cout.km).toBeLessThan(r.coutInitial.km);
    expect(r.gain.km).toBeGreaterThan(0);
    expect(r.gain.pct_distance).toBeGreaterThan(0);
  });

  test('le résultat n’est JAMAIS pire que l’ordre existant', () => {
    const ordres = [
      ['A', 'B', 'C', 'D'], ['D', 'C', 'B', 'A'], ['B', 'D', 'A', 'C'], ['C', 'A', 'D', 'B'],
    ];
    ordres.forEach((o) => {
      const r = optimiserOrdre(o, fabriqueLeg(carre));
      expect(r.cout.km).toBeLessThanOrEqual(r.coutInitial.km + 1e-9);
      expect(r.ordre).toHaveLength(o.length);
      expect([...r.ordre].sort()).toEqual([...o].sort()); // aucun point perdu ni dupliqué
    });
  });

  test('déterministe : deux exécutions donnent le même ordre', () => {
    const a = optimiserOrdre(['B', 'D', 'A', 'C'], fabriqueLeg(carre));
    const b = optimiserOrdre(['B', 'D', 'A', 'C'], fabriqueLeg(carre));
    expect(a.ordre).toEqual(b.ordre);
    expect(a.cout).toEqual(b.cout);
  });

  test('ordre déjà optimal : rien n’est proposé', () => {
    const r = optimiserOrdre(['A', 'B', 'C', 'D'], fabriqueLeg(carre));
    const r2 = optimiserOrdre(r.ordre, fabriqueLeg(carre));
    expect(r2.ameliore).toBe(false);
    expect(r2.gain.km).toBe(0);
  });

  test('moins de 3 points : rien à réordonner', () => {
    expect(optimiserOrdre(['A', 'B'], fabriqueLeg(carre)).ameliore).toBe(false);
    expect(optimiserOrdre([], fabriqueLeg(carre)).ameliore).toBe(false);
  });

  test('objectif « durée » : un détour est accepté s’il évite un bouchon', () => {
    // Le tronçon A→B est bloqué (×8). L'objectif distance garde A→B ;
    // l'objectif durée doit l'éviter, même au prix de kilomètres en plus.
    const leg = fabriqueLeg(carre, { 'A>B': 8, 'B>A': 8 });
    const parDistance = optimiserOrdre(['A', 'B', 'C', 'D'], leg, { objectif: 'distance' });
    const parDuree = optimiserOrdre(['A', 'B', 'C', 'D'], leg, { objectif: 'duree' });
    expect(parDuree.cout.min).toBeLessThan(parDistance.cout.min);
    expect(parDuree.ordre).not.toEqual(parDistance.ordre);
  });

  test('les trois objectifs sont acceptés, un objectif inconnu retombe sur « mixte »', () => {
    const leg = fabriqueLeg(carre);
    OBJECTIFS.forEach((o) => {
      expect(() => optimiserOrdre(['B', 'D', 'A', 'C'], leg, { objectif: o })).not.toThrow();
    });
    const cout = { km: 10, min: 20 };
    expect(score(cout, cout, { objectif: 'inconnu' })).toBe(score(cout, cout, { objectif: 'mixte' }));
  });
});

describe('bilan (CO2)', () => {
  const carre = {
    [DEPART]: { x: 0, y: 0 }, [ARRIVEE]: { x: 0, y: 0 },
    A: { x: 10, y: 0 }, B: { x: 10, y: 10 }, C: { x: 0, y: 10 }, D: { x: 5, y: 15 },
  };

  test('chiffre le CO2 évité quand la conso réelle est connue', () => {
    const r = optimiserOrdre(['A', 'C', 'B', 'D'], fabriqueLeg(carre));
    const b = bilan(r, { litresPer100km: 28.4, kgCo2eParLitre: 2.51 });
    expect(b.co2.avant_kg).toBeGreaterThan(0);
    expect(b.co2.evite_kg).toBeGreaterThan(0);
    expect(b.co2.avant_kg - b.co2.apres_kg).toBeCloseTo(b.co2.evite_kg, 3);
  });

  test('véhicule sans plein saisi : CO2 null partout, gains km/min conservés', () => {
    const r = optimiserOrdre(['A', 'C', 'B', 'D'], fabriqueLeg(carre));
    const b = bilan(r, { litresPer100km: null, kgCo2eParLitre: 2.51 });
    expect(b.co2.avant_kg).toBeNull();
    expect(b.co2.evite_kg).toBeNull();
    expect(b.gain.km).toBeGreaterThan(0); // l'optimisation reste exploitable
  });
});

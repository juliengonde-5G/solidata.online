// ═══════════════════════════════════════════════════════════════════════════
// IMPACT D'UNE MODIFICATION DE PROGRAMME — fonctions pures
// ───────────────────────────────────────────────────────────────────────────
// Le gestionnaire modifiait une tournée en cours sans jamais savoir ce que ça
// coûtait. Ces tests verrouillent la règle qui compte : un écart qu'on n'a pas
// pu calculer se DIT, il ne se remplace pas par un zéro rassurant.
// ═══════════════════════════════════════════════════════════════════════════

jest.mock('../../src/config/database', () => ({ query: jest.fn(), connect: jest.fn() }));

const { comparer, ecart, resumerImpact } = require('../../src/routes/tours/impact');

const estimation = (o = {}) => ({
  faisable: true,
  distance_km: 40,
  duree_travail_min: 300,
  duree_totale_min: 330,
  budget_travail_min: 360,
  depassement_min: 0,
  nb_points: 8,
  nb_retours_vidage: 1,
  poids_estime_kg: 900,
  heure_depart: '08:00',
  heure_fin_estimee: '13:30',
  avertissements: [],
  ...o,
});

describe('ecart', () => {
  test('différence signée arrondie au dixième', () => {
    expect(ecart(43.87, 40)).toBe(3.9);
    expect(ecart(38, 40)).toBe(-2);
  });

  test('null dès qu\'une des deux valeurs manque — jamais 0 par défaut', () => {
    expect(ecart(null, 40)).toBeNull();
    expect(ecart(40, undefined)).toBeNull();
    expect(ecart(NaN, 40)).toBeNull();
  });
});

describe('comparer', () => {
  test('nouvelle estimation absente → non calculable, avec son motif', () => {
    const r = comparer(estimation(), null);
    expect(r.calculable).toBe(false);
    expect(r.motif).toMatch(/indisponible/i);
    expect(r.ecart).toBeUndefined();
  });

  test('aucune référence avant → non calculable plutôt qu\'un écart inventé', () => {
    const r = comparer(null, estimation());
    expect(r.calculable).toBe(false);
    expect(r.apres).not.toBeNull();
    expect(r.ecart).toBeUndefined();
  });

  test('écarts calculés sur chaque grandeur', () => {
    const r = comparer(
      estimation(),
      estimation({ distance_km: 52, duree_travail_min: 340, nb_points: 9, poids_estime_kg: 1050 })
    );
    expect(r.calculable).toBe(true);
    expect(r.ecart.distance_km).toBe(12);
    expect(r.ecart.duree_travail_min).toBe(40);
    expect(r.ecart.nb_points).toBe(1);
    expect(r.ecart.poids_estime_kg).toBe(150);
  });

  test('la bascule hors budget est explicite, pas à déduire', () => {
    const r = comparer(
      estimation({ faisable: true }),
      estimation({ faisable: false, depassement_min: 25, duree_travail_min: 385 })
    );
    expect(r.budget.bascule_hors_budget).toBe(true);
    expect(r.budget.revient_dans_budget).toBe(false);
    expect(r.budget.depassement_min).toBe(25);
  });

  test('le retour dans le budget est signalé aussi', () => {
    const r = comparer(
      estimation({ faisable: false, depassement_min: 30 }),
      estimation({ faisable: true, depassement_min: 0 })
    );
    expect(r.budget.revient_dans_budget).toBe(true);
    expect(r.budget.bascule_hors_budget).toBe(false);
  });

  test('une journée déjà hors budget qui le reste ne bascule pas', () => {
    const r = comparer(
      estimation({ faisable: false, depassement_min: 10 }),
      estimation({ faisable: false, depassement_min: 40 })
    );
    expect(r.budget.bascule_hors_budget).toBe(false);
    expect(r.budget.revient_dans_budget).toBe(false);
  });

  test('l\'heure de fin précédente est conservée pour montrer le déplacement', () => {
    const r = comparer(
      estimation({ heure_fin_estimee: '13:30' }),
      estimation({ heure_fin_estimee: '14:10' })
    );
    expect(r.horaires.heure_fin_precedente).toBe('13:30');
    expect(r.horaires.heure_fin_estimee).toBe('14:10');
  });
});

describe('resumerImpact', () => {
  test('rien à raconter quand l\'impact n\'est pas calculable', () => {
    expect(resumerImpact(null)).toBeNull();
    expect(resumerImpact({ calculable: false, motif: 'x' })).toBeNull();
  });

  test('phrase courte avec les écarts signés et l\'heure de retour', () => {
    const r = resumerImpact(comparer(
      estimation(),
      estimation({ distance_km: 52, duree_travail_min: 340, heure_fin_estimee: '14:10' })
    ));
    expect(r).toMatch(/\+12 km/);
    expect(r).toMatch(/\+40 min de travail/);
    expect(r).toMatch(/14:10/);
  });

  test('un dépassement nouveau est annoncé dans la phrase', () => {
    const r = resumerImpact(comparer(
      estimation({ faisable: true }),
      estimation({ faisable: false, depassement_min: 25, distance_km: 60 })
    ));
    expect(r).toMatch(/dépasse/i);
    expect(r).toMatch(/25 min/);
  });

  test('une modification sans effet mesurable le dit, au lieu de rester muette', () => {
    const r = resumerImpact(comparer(estimation(), estimation()));
    expect(r).toMatch(/aucun effet mesurable/i);
  });
});

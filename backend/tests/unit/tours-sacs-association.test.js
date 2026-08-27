/**
 * Sacs collectés chez une association — dérivation du niveau et répartition du
 * poids pesé (demande client 08/2026).
 *
 * Ces tests portent sur le module PUR `routes/tours/sacs.js` : aucune base,
 * aucune requête. Ce qu'ils verrouillent :
 *   • la distinction `null` (non déclaré) / `0` (rien chargé), qui décide seule
 *     de la répartition du poids ;
 *   • le prorata des sacs et, surtout, les TROIS cas où il est refusé — un
 *     repli silencieux réintroduirait exactement le défaut corrigé ;
 *   • le caractère paramétrable des bornes, qui ne doivent vivre qu'ici.
 */
const {
  BORNES_DEFAUT,
  nbSacsValide,
  normaliserBornes,
  niveauDepuisSacs,
  repartirPoids,
} = require('../../src/routes/tours/sacs');

describe('nbSacsValide — « non déclaré » et « rien chargé » ne se confondent pas', () => {
  test('zéro est une DÉCLARATION, pas une absence', () => {
    expect(nbSacsValide(0)).toBe(0);
    expect(nbSacsValide('0')).toBe(0);
  });

  test('absence de valeur reste null', () => {
    expect(nbSacsValide(null)).toBeNull();
    expect(nbSacsValide(undefined)).toBeNull();
    expect(nbSacsValide('')).toBeNull();
  });

  test('valeurs entières positives acceptées, y compris en chaîne (multipart)', () => {
    expect(nbSacsValide(14)).toBe(14);
    expect(nbSacsValide('14')).toBe(14);
  });

  test('valeurs non exploitables écartées, jamais converties en 0', () => {
    expect(nbSacsValide(-1)).toBeNull();
    expect(nbSacsValide(2.5)).toBeNull();
    expect(nbSacsValide('douze')).toBeNull();
    expect(nbSacsValide(NaN)).toBeNull();
    expect(nbSacsValide(Infinity)).toBeNull();
    expect(nbSacsValide(999999)).toBeNull();   // au-delà du plafond
  });
});

describe('niveauDepuisSacs — le niveau 0-4 est CALCULÉ, plus deviné', () => {
  test('bornes par défaut [1,6,16,31] : chaque palier et ses deux bords', () => {
    expect(niveauDepuisSacs(0)).toBe(0);
    expect(niveauDepuisSacs(1)).toBe(1);
    expect(niveauDepuisSacs(5)).toBe(1);
    expect(niveauDepuisSacs(6)).toBe(2);
    expect(niveauDepuisSacs(15)).toBe(2);
    expect(niveauDepuisSacs(16)).toBe(3);
    expect(niveauDepuisSacs(30)).toBe(3);
    expect(niveauDepuisSacs(31)).toBe(4);
    expect(niveauDepuisSacs(400)).toBe(4);
  });

  test('aucun sac déclaré → aucun niveau (et surtout pas le niveau 0)', () => {
    expect(niveauDepuisSacs(null)).toBeNull();
    expect(niveauDepuisSacs(undefined)).toBeNull();
  });

  test('le niveau reste dans 0-4 : il est relu ×(1/4) par le moteur de prédiction', () => {
    for (const n of [0, 1, 3, 7, 20, 60, 5000]) {
      const niveau = niveauDepuisSacs(n);
      expect(niveau).toBeGreaterThanOrEqual(0);
      expect(niveau).toBeLessThanOrEqual(4);
    }
  });

  test('bornes PARAMÉTRABLES : le métier les ajuste sans toucher au code', () => {
    const serres = [1, 3, 6, 10];
    expect(niveauDepuisSacs(4, serres)).toBe(2);
    expect(niveauDepuisSacs(4)).toBe(1);           // contre-épreuve : défauts inchangés
    expect(niveauDepuisSacs(10, serres)).toBe(4);
  });

  test('bornes lues en base sous forme de chaîne JSON', () => {
    expect(niveauDepuisSacs(4, '[1,3,6,10]')).toBe(2);
  });
});

describe('normaliserBornes — un réglage mal saisi ne casse pas la clôture', () => {
  test('un réglage valide est retenu tel quel', () => {
    expect(normaliserBornes([2, 8, 20, 50])).toEqual([2, 8, 20, 50]);
    expect(normaliserBornes('[2,8,20,50]')).toEqual([2, 8, 20, 50]);
  });

  test.each([
    ['JSON illisible', '{pas du json'],
    ['non décroissant', [5, 5, 10, 20]],
    ['décroissant', [10, 5, 20, 30]],
    ['seuil à 0 — rendrait « rien collecté » inatteignable', [0, 6, 16, 31]],
    ['plus de 4 seuils — produirait un niveau 5 hors échelle du moteur', [1, 2, 3, 4, 5]],
    ['liste vide', []],
    ['non entier', [1, 6.5, 16, 31]],
    ['pas un tableau', 42],
  ])('%s → défauts documentés', (_libelle, valeur) => {
    expect(normaliserBornes(valeur)).toEqual(BORNES_DEFAUT);
  });
});

describe('repartirPoids — au prorata des sacs', () => {
  test('la clé observée remplace la moyenne : 2 sacs / 40 sacs sur 840 kg', () => {
    const r = repartirPoids(
      [{ point_id: 1, nb_sacs: 2 }, { point_id: 2, nb_sacs: 40 }],
      840
    );
    expect(r.mode).toBe('prorata_sacs');
    expect(r.motif).toBeNull();
    expect(r.total_sacs).toBe(42);
    expect(r.poids_par_sac_kg).toBe(20);
    expect(r.parts).toEqual([
      { point_id: 1, nb_sacs: 2, poids_kg: 40 },
      { point_id: 2, nb_sacs: 40, poids_kg: 800 },
    ]);
    // Contre-épreuve du défaut corrigé : à parts égales, les deux points
    // auraient reçu 420 kg — deux chiffres également faux.
    expect(r.parts[0].poids_kg).not.toBe(420);
  });

  test('rien ne se perd : la somme répartie égale le poids pesé', () => {
    const r = repartirPoids(
      [{ point_id: 1, nb_sacs: 3 }, { point_id: 2, nb_sacs: 7 }, { point_id: 3, nb_sacs: 11 }],
      1000
    );
    const somme = r.parts.reduce((s, p) => s + p.poids_kg, 0);
    expect(somme).toBeCloseTo(1000, 9);
  });

  test('un point à 0 sac déclaré reçoit 0 kg — il est DÉCLARÉ vide, pas oublié', () => {
    const r = repartirPoids(
      [{ point_id: 1, nb_sacs: 0 }, { point_id: 2, nb_sacs: 10 }],
      500
    );
    expect(r.mode).toBe('prorata_sacs');
    expect(r.parts[0]).toEqual({ point_id: 1, nb_sacs: 0, poids_kg: 0 });
    expect(r.parts[1].poids_kg).toBe(500);
  });

  test('les sacs arrivent en chaîne depuis PostgreSQL sans fausser le calcul', () => {
    const r = repartirPoids([{ point_id: 1, nb_sacs: '5' }, { point_id: 2, nb_sacs: '5' }], '300');
    expect(r.mode).toBe('prorata_sacs');
    expect(r.poids_par_sac_kg).toBe(30);
  });
});

describe('repartirPoids — les replis, tous NOMMÉS', () => {
  test('aucune déclaration → parts égales, comportement historique inchangé', () => {
    const r = repartirPoids([{ point_id: 1 }, { point_id: 2 }, { point_id: 3 }], 900);
    expect(r.mode).toBe('parts_egales');
    expect(r.motif).toMatch(/Aucun point ne déclare/);
    expect(r.total_sacs).toBeNull();
    expect(r.parts.map((p) => p.poids_kg)).toEqual([300, 300, 300]);
  });

  test('déclaration INCOMPLÈTE → parts égales, et le motif compte les manquants', () => {
    const r = repartirPoids(
      [{ point_id: 1, nb_sacs: 10 }, { point_id: 2, nb_sacs: null }],
      600
    );
    expect(r.mode).toBe('parts_egales');
    expect(r.motif).toMatch(/1 point\(s\) collecté\(s\) sans nombre de sacs/);
    expect(r.nb_points_sans_declaration).toBe(1);
    // Le point non déclarant garde sa part : un prorata partiel lui aurait
    // attribué ZÉRO kilo alors qu'il a bien été collecté.
    expect(r.parts[1].poids_kg).toBe(300);
    expect(r.parts[1].nb_sacs).toBeNull();
  });

  test('total des sacs à ZÉRO malgré un poids pesé → parts égales, jamais de division par zéro', () => {
    const r = repartirPoids(
      [{ point_id: 1, nb_sacs: 0 }, { point_id: 2, nb_sacs: 0 }],
      500
    );
    expect(r.mode).toBe('parts_egales');
    expect(r.motif).toMatch(/Aucun sac déclaré alors que du textile a été pesé/);
    expect(r.parts.every((p) => Number.isFinite(p.poids_kg))).toBe(true);
    expect(r.parts.map((p) => p.poids_kg)).toEqual([250, 250]);
  });

  test('aucun poids à répartir : rien n’est écrit, et ce n’est pas un défaut de déclaration', () => {
    for (const total of [0, null, undefined, NaN, 'abc']) {
      const r = repartirPoids([{ point_id: 1, nb_sacs: 5 }], total);
      expect(r.mode).toBe('aucun');
      expect(r.motif).toMatch(/Aucun poids pesé/);
      expect(r.parts).toEqual([]);
    }
  });

  test('aucun point collecté : rien à répartir', () => {
    const r = repartirPoids([], 900);
    expect(r.mode).toBe('aucun');
    expect(r.parts).toEqual([]);
  });

  test('un repli n’est JAMAIS muet : tout mode « parts_egales » porte son motif', () => {
    const cas = [
      [[{ point_id: 1 }], 100],
      [[{ point_id: 1, nb_sacs: 3 }, { point_id: 2 }], 100],
      [[{ point_id: 1, nb_sacs: 0 }], 100],
    ];
    for (const [points, total] of cas) {
      const r = repartirPoids(points, total);
      expect(r.mode).toBe('parts_egales');
      expect(typeof r.motif).toBe('string');
      expect(r.motif.length).toBeGreaterThan(10);
    }
  });

  test('tournée de BORNES (aucun sac nulle part) : comportement strictement identique à l’ancien', () => {
    const points = [{ point_id: 11 }, { point_id: 12 }, { point_id: 13 }, { point_id: 14 }];
    const total = 1230;
    const r = repartirPoids(points, total);
    const ancien = total / points.length;   // règle d'avant, reproduite ici
    expect(r.parts.every((p) => p.poids_kg === ancien)).toBe(true);
  });
});

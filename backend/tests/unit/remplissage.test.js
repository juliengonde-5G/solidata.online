// ═══════════════════════════════════════════════════════════════════════════
// LE REMPLISSAGE DÉCLARÉ, ET CE QU'IL FAUT EN AFFICHER (utils/remplissage.js)
// ───────────────────────────────────────────────────────────────────────────
// Le défaut corrigé : une borne déclarée « au-delà » (elle débordait) est
// stockée `fill_level = 4` — la même valeur qu'une borne pleine, l'échelle
// historique plafonnant à 4. Les écrans qui affichaient « 4/5 » ou « 4/4 »
// perdaient donc l'information, alors que `fill_percent = 110` était en base.
// ═══════════════════════════════════════════════════════════════════════════
const {
  PALIERS_REMPLISSAGE, remplissageEffectif, palierDepuisStockage, lirePalier,
} = require('../../src/utils/remplissage');

describe('remplissageEffectif — le débordement cesse de se confondre avec le plein', () => {
  test('« au-delà » (110 %) est NOMMÉ et marqué débordement', () => {
    const r = remplissageEffectif(4, 110);
    expect(r.pourcentage).toBe(110);
    expect(r.debordement).toBe(true);
    expect(r.libelle).toMatch(/au-delà/);
    expect(r.approche).toBe(false);
  });

  test('« plein » (100 %) porte le MÊME fill_level, et n’est PAS un débordement', () => {
    const plein = remplissageEffectif(4, 100);
    const audela = remplissageEffectif(4, 110);
    expect(plein.debordement).toBe(false);
    expect(audela.debordement).toBe(true);
    // C'est tout l'enjeu : même échelle, deux réalités.
    expect(plein.libelle).not.toBe(audela.libelle);
  });

  test('sans pourcentage, on retombe sur l’échelle et on le DIT (approché)', () => {
    const r = remplissageEffectif(4, null);
    expect(r.approche).toBe(true);
    expect(r.source).toBe('echelle');
    // Le débordement est indétectable par cette voie : on ne l'invente pas.
    expect(r.debordement).toBe(false);
  });

  test('rien de déclaré → null (≠ « vide »)', () => {
    expect(remplissageEffectif(null, null)).toBeNull();
    expect(remplissageEffectif(undefined, undefined)).toBeNull();
    expect(remplissageEffectif('', '')).toBeNull();
  });

  test('0 % est une VALEUR, pas une absence (piège Number(null) === 0)', () => {
    const r = remplissageEffectif(0, 0);
    expect(r).not.toBeNull();
    expect(r.pourcentage).toBe(0);
    expect(r.libelle).toBe('vide');
    expect(r.approche).toBe(false);
  });

  test('« un fond » (10 %) ne se confond pas avec « vide », bien que fill_level = 0', () => {
    expect(remplissageEffectif(0, 10).libelle).toBe('un fond');
    expect(remplissageEffectif(0, 0).libelle).toBe('vide');
  });

  test('un pourcentage hors table garde SA valeur — on ne le rabat pas sur un palier', () => {
    const r = remplissageEffectif(3, 63);
    expect(r.pourcentage).toBe(63);
    expect(r.code).toBeNull();
    expect(r.libelle).toBe('63 %');
  });

  test('un pourcentage au-delà de 100 est un débordement, même hors table', () => {
    expect(remplissageEffectif(4, 130).debordement).toBe(true);
    expect(remplissageEffectif(4, 100).debordement).toBe(false);
  });

  test('une valeur illisible ne fabrique pas un remplissage', () => {
    expect(remplissageEffectif('abc', 'zzz')).toBeNull();
  });
});

describe('la table des paliers reste la source unique', () => {
  test('sept paliers, du vide au débordement, pourcentages croissants', () => {
    expect(PALIERS_REMPLISSAGE).toHaveLength(7);
    const pcts = PALIERS_REMPLISSAGE.map((p) => p.fill_percent);
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts);
    expect(pcts[pcts.length - 1]).toBeGreaterThan(100);
  });

  test('lirePalier ne devine jamais', () => {
    expect(lirePalier('au_dela').fill_percent).toBe(110);
    expect(lirePalier('inconnu')).toBeNull();
    expect(lirePalier(null)).toBeNull();
  });

  test('palierDepuisStockage signale une correspondance approchée', () => {
    expect(palierDepuisStockage(4, 110)).toEqual({ palier: expect.objectContaining({ code: 'au_dela' }), exact: true });
    expect(palierDepuisStockage(4, null).exact).toBe(false);
  });
});

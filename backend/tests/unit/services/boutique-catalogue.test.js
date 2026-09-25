// Commandes boutiques en cartons (2.58.0) : validation des lignes et
// rattachement des cartons scannés — fonctions pures, sans base.
const {
  validerLignesCartons, calculerAvancement, cleCategorie, libelleCategorie, GAMMES_COMMANDABLES,
} = require('../../../src/services/boutique-catalogue');

const cat = (o) => ({ categorie_eco_org: 'Textiles', poids_moyen_kg: 12.5, stock_cartons: 3, ...o, cle: cleCategorie(o) });
const CATALOGUE = [
  cat({ gamme: 'BTQ', produit: 'Robes', genre: 'Adulte Femme', saison: 'Été' }),
  cat({ gamme: 'EXTRA', produit: 'Sacs', genre: 'Sans Genre', saison: 'Sans Saison', poids_moyen_kg: null, stock_cartons: 0 }),
];
const robes = { gamme: 'BTQ', produit: 'Robes', genre: 'Adulte Femme', saison: 'Été' };

describe('validerLignesCartons', () => {
  test('ligne valide : libellé, catégorie éco-organisme et poids estimé', () => {
    const r = validerLignesCartons([{ ...robes, nb_cartons: 4 }], CATALOGUE);
    expect(r.lignes[0]).toMatchObject({
      categorie: 'BTQ · Robes — Adulte Femme — Été', categorie_eco_org: 'Textiles', nb_cartons: 4, poids_estime_kg: 50,
    });
  });
  test('poids moyen inconnu → estimation null, jamais 0', () => {
    const r = validerLignesCartons([{ gamme: 'EXTRA', produit: 'Sacs', genre: 'Sans Genre', saison: 'Sans Saison', nb_cartons: 2 }], CATALOGUE);
    expect(r.lignes[0].poids_estime_kg).toBeNull();
  });
  test('stock nul commandable, sans maximum', () => {
    const r = validerLignesCartons([{ gamme: 'EXTRA', produit: 'Sacs', genre: 'Sans Genre', saison: 'Sans Saison', nb_cartons: 999 }], CATALOGUE);
    expect(r.lignes).toHaveLength(1);
  });
  test.each([
    [[], 'COMMANDE_VIDE'],
    [null, 'COMMANDE_VIDE'],
    [[{ ...robes, genre: 'Adulte Homme', nb_cartons: 1 }], 'CATEGORIE_INCONNUE'],
    [[{ ...robes, nb_cartons: 0 }], 'QUANTITE_INVALIDE'],
    [[{ ...robes, nb_cartons: -2 }], 'QUANTITE_INVALIDE'],
    [[{ ...robes, nb_cartons: 2.5 }], 'QUANTITE_INVALIDE'],
    [[{ ...robes, nb_cartons: 'deux' }], 'QUANTITE_INVALIDE'],
    [[{ ...robes, nb_cartons: 1 }, { ...robes, nb_cartons: 2 }], 'DOUBLON'],
  ])('refus %#', (lignes, code) => {
    expect(validerLignesCartons(lignes, CATALOGUE).code).toBe(code);
  });
  test('les valeurs envoyées ne passent pas : ce sont celles du catalogue qui sont écrites', () => {
    const r = validerLignesCartons([{ ...robes, nb_cartons: 1, categorie_eco_org: 'Inventée', poids_estime_kg: 9999 }], CATALOGUE);
    expect(r.lignes[0].categorie_eco_org).toBe('Textiles');
    expect(r.lignes[0].poids_estime_kg).toBe(12.5);
  });
});

describe('calculerAvancement', () => {
  const lignes = [
    { id: 1, ...robes, nb_cartons_demande: 3, nb_cartons_ajuste: 2 },
    { id: 2, gamme: 'EXTRA', produit: 'Sacs', genre: 'Sans Genre', saison: 'Sans Saison', nb_cartons_demande: 1, nb_cartons_ajuste: null },
  ];
  const carton = (id, o = robes, kg = 10) => ({ id, code_barre: `C${id}`, poids_kg: kg, ...o });

  test('rattache chaque carton à sa ligne, l\'ajustement prime sur la demande', () => {
    const a = calculerAvancement(lignes, [carton(10), carton(11)]);
    expect(a.lignes[0]).toMatchObject({ ligne_id: 1, voulu: 2, scannes: 2, reste: 0, depasse: false, scannes_kg: 20 });
    expect(a.lignes[1]).toMatchObject({ voulu: 1, scannes: 0, reste: 1 });
    expect(a.ligne_par_carton).toEqual({ 10: 1, 11: 1 });
  });
  test('dépassement signalé', () => {
    const a = calculerAvancement(lignes, [carton(1), carton(2), carton(3)]);
    expect(a.lignes[0].depasse).toBe(true);
  });
  test('carton d\'une autre catégorie : hors commande, compté dans le total', () => {
    const a = calculerAvancement(lignes, [carton(5, { ...robes, saison: 'Hiver' }, 8)]);
    expect(a.hors_commande).toHaveLength(1);
    expect(a.ligne_par_carton[5]).toBeNull();
    expect(a).toMatchObject({ total_scannes: 1, total_kg: 8, total_voulu: 3 });
  });
  test('ligne historique au poids : jamais rattachée, jamais comptée dans le voulu', () => {
    const a = calculerAvancement([{ id: 9, categorie: 'FEMME', poids_demande_kg: 12, nb_cartons_demande: null }], [carton(1)]);
    expect(a.lignes[0]).toMatchObject({ en_cartons: false, voulu: null, libelle: 'FEMME' });
    expect(a.hors_commande).toHaveLength(1);
    expect(a.total_voulu).toBe(0);
  });
  test('ajustement à 0 : la ligne ne sera pas servie', () => {
    const a = calculerAvancement([{ ...lignes[0], nb_cartons_ajuste: 0 }], []);
    expect(a.lignes[0]).toMatchObject({ voulu: 0, reste: 0 });
  });
});

test('utilitaires', () => {
  expect(libelleCategorie({ produit: 'Robes', genre: 'Adulte Femme', saison: null })).toBe('Robes — Adulte Femme');
  expect(GAMMES_COMMANDABLES).toEqual(['BTQ', 'EXTRA', 'VAK', 'CHIF', 'UP']);
});

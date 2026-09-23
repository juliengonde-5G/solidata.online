/**
 * Import du stock d'étiquettes (`scripts/import-stock-etiquettes.js`) — tests
 * unitaires des fonctions de décision PURES (aucune base, aucun fichier réel).
 *
 * Le fichier client réel N'EST JAMAIS versionné (données métier réelles) : la
 * preuve sur base réelle se fait à la main, hors CI, avec --file=<chemin>.
 */
const {
  resolverValeurCellule,
  estFormuleRompue,
  resolverValeurDate,
  analyserLigne,
  reperocherDoublons,
  decidercAction,
  trouverEnTete,
  lireLignes,
} = require('../../../src/scripts/import-stock-etiquettes');

// ── Fabrique de faux classeurs exceljs (assez pour trouverEnTete/lireLignes) ─
function fakeWorksheet(rows) {
  // rows: tableau de tableaux (1-based conceptuellement, on décale nous-mêmes)
  const rowCount = rows.length;
  const columnCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return {
    rowCount,
    columnCount,
    getRow(r) {
      const values = rows[r - 1] || [];
      return {
        getCell(c) {
          return { value: values[c - 1] === undefined ? null : values[c - 1] };
        },
      };
    },
  };
}

describe('resolverValeurCellule', () => {
  test('null/undefined → null', () => {
    expect(resolverValeurCellule(null)).toBeNull();
    expect(resolverValeurCellule(undefined)).toBeNull();
  });

  test('chaîne, nombre, booléen passent tels quels', () => {
    expect(resolverValeurCellule('P100MM')).toBe('P100MM');
    expect(resolverValeurCellule(42)).toBe(42);
    expect(resolverValeurCellule(true)).toBe(true);
  });

  test('Date directe passe telle quelle', () => {
    const d = new Date('2020-05-16T00:00:00.000Z');
    expect(resolverValeurCellule(d)).toBe(d);
  });

  test('texte enrichi (richText) est concaténé', () => {
    const v = { richText: [{ text: 'Bonjour ' }, { text: 'monde' }] };
    expect(resolverValeurCellule(v)).toBe('Bonjour monde');
  });

  test('hyperlien { text, hyperlink } rend le texte', () => {
    expect(resolverValeurCellule({ text: 'Voir', hyperlink: 'https://x' })).toBe('Voir');
  });

  test('formule SANS résultat mis en cache (référence rompue) → null', () => {
    // Cas réel du classeur client : #REF! jamais recalculé, pas de clé `result`.
    expect(resolverValeurCellule({ formula: 'VLOOKUP(...)' })).toBeNull();
  });

  test('formule dont le résultat est une erreur → null', () => {
    expect(resolverValeurCellule({ formula: 'A1', result: { error: '#REF!' } })).toBeNull();
  });

  test('formule dont le résultat est une date → la date', () => {
    const d = new Date('2025-07-07T00:00:00.000Z');
    expect(resolverValeurCellule({ formula: 'A1', result: d })).toBe(d);
  });

  test('formule dont le résultat est une chaîne vide → chaîne vide', () => {
    expect(resolverValeurCellule({ formula: 'A1', result: '' })).toBe('');
  });
});

describe('resolverValeurDate', () => {
  test('Date directe', () => {
    const d = new Date('2020-01-01T00:00:00.000Z');
    expect(resolverValeurDate(d)).toEqual(d);
  });

  test('chaîne ISO', () => {
    expect(resolverValeurDate('2020-01-01')).toEqual(new Date('2020-01-01'));
  });

  test('numéro de série Excel (jour 1 = 1899-12-31 UTC)', () => {
    // Excel : série 1 → 1899-12-31 (bug du 29/02/1900 compris dans l'usage
    // courant, non corrigé ici — conforme au comportement réel d'Excel).
    const d = resolverValeurDate(1);
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCFullYear()).toBe(1899);
  });

  test('valeur invalide ou absente → null', () => {
    expect(resolverValeurDate(null)).toBeNull();
    expect(resolverValeurDate('pas une date')).toBeNull();
    expect(resolverValeurDate({ formula: 'X' })).toBeNull(); // référence rompue
  });
});

describe('analyserLigne', () => {
  const ligneValide = () => ({
    id: 'P100MM',
    produit: 'Chiffons Couleurs',
    categorie: 'Chiffons',
    genre: 'Sans Genre',
    saison: 'Sans Saison',
    gamme: 'CHIF',
    poids: 10,
    dateFabrication: new Date('2020-05-16'),
    dateSortie: null,
    dateInventaire: null,
  });

  test('ligne valide, ancien code base24, sans sortie → en_stock, codification "ancien"', () => {
    const d = analyserLigne(ligneValide());
    expect(d.ok).toBe(true);
    expect(d.record.code).toBe('P100MM');
    expect(d.record.format).toBe('ancien_base24');
    expect(d.record.codification).toBe('ancien');
    expect(d.record.status).toBe('en_stock');
    expect(d.record.date_sortie).toBeNull();
    expect(d.record.poids_kg).toBe(10);
    expect(d.record.produit).toBe('Chiffons Couleurs');
  });

  test('ligne avec date de sortie → status "expedie"', () => {
    const l = ligneValide();
    l.dateSortie = new Date('2025-07-07');
    const d = analyserLigne(l);
    expect(d.ok).toBe(true);
    expect(d.record.status).toBe('expedie');
    expect(d.record.date_sortie).toEqual(new Date('2025-07-07'));
  });

  test('code horodaté ancien → format ancien_horodate, codification "ancien"', () => {
    const l = ligneValide();
    l.id = 'P1250320155908';
    const d = analyserLigne(l);
    expect(d.ok).toBe(true);
    expect(d.record.format).toBe('ancien_horodate');
    expect(d.record.codification).toBe('ancien');
  });

  test('code balance (kiosque) → codification "balance"', () => {
    const l = ligneValide();
    l.id = 'PF-123456';
    const d = analyserLigne(l);
    expect(d.ok).toBe(true);
    expect(d.record.format).toBe('balance');
    expect(d.record.codification).toBe('balance');
  });

  test('code v2 (13 hex) → codification "v2"', () => {
    const l = ligneValide();
    l.id = '312A0220000001'.slice(0, 13); // 13 caractères hex valides
    const d = analyserLigne(l);
    expect(d.ok).toBe(true);
    expect(d.record.format).toBe('v2');
    expect(d.record.codification).toBe('v2');
  });

  test('code vide → motif code_vide', () => {
    const l = ligneValide();
    l.id = null;
    expect(analyserLigne(l)).toEqual({ ok: false, motif: 'code_vide' });
  });

  test('code de format inconnu → motif format_inconnu', () => {
    const l = ligneValide();
    l.id = 'ZZZ-inconnu';
    expect(analyserLigne(l)).toEqual({ ok: false, motif: 'format_inconnu' });
  });

  test('poids non numérique → motif poids_invalide', () => {
    const l = ligneValide();
    l.poids = 'dix kilos';
    expect(analyserLigne(l)).toEqual({ ok: false, motif: 'poids_invalide' });
  });

  test('poids nul ou négatif → motif poids_invalide', () => {
    const l1 = ligneValide(); l1.poids = 0;
    const l2 = ligneValide(); l2.poids = -5;
    expect(analyserLigne(l1)).toEqual({ ok: false, motif: 'poids_invalide' });
    expect(analyserLigne(l2)).toEqual({ ok: false, motif: 'poids_invalide' });
  });

  test('date de fabrication absente/invalide → motif date_fabrication_invalide', () => {
    const l = ligneValide();
    l.dateFabrication = null;
    expect(analyserLigne(l)).toEqual({ ok: false, motif: 'date_fabrication_invalide' });
  });

  test('champs texte vides sont normalisés à null (jamais une chaîne vide)', () => {
    const l = ligneValide();
    l.genre = '   ';
    const d = analyserLigne(l);
    expect(d.record.genre).toBeNull();
  });
});

describe('reperocherDoublons', () => {
  test('code unique conservé', () => {
    const records = [{ code: 'A' }, { code: 'B' }];
    const { uniques, doublons } = reperocherDoublons(records);
    expect(uniques).toHaveLength(2);
    expect(doublons.size).toBe(0);
  });

  test("un code en double : TOUTES ses occurrences sont écartées, jamais seulement la seconde", () => {
    const records = [{ code: 'A', v: 1 }, { code: 'A', v: 2 }, { code: 'B', v: 3 }];
    const { uniques, doublons } = reperocherDoublons(records);
    expect(doublons.has('A')).toBe(true);
    expect(uniques).toEqual([{ code: 'B', v: 3 }]);
  });
});

describe('decidercAction', () => {
  const record = () => ({
    code: 'P100MM',
    produit: 'Chiffons Couleurs',
    categorie_eco_org: 'Chiffons',
    genre: 'Sans Genre',
    saison: 'Sans Saison',
    gamme: 'CHIF',
    poids_kg: 10,
    date_sortie: null,
  });

  test('absent en base → insert, aucun écart', () => {
    const d = decidercAction(null, record());
    expect(d).toEqual({ verdict: 'insert', ecarts: [] });
  });

  test('présent, aucune différence, aucune sortie ni fichier ni base → none', () => {
    const existant = { ...record() };
    const d = decidercAction(existant, record());
    expect(d.verdict).toBe('none');
    expect(d.ecarts).toEqual([]);
  });

  test('base sans sortie, fichier avec sortie → update_sortie', () => {
    const existant = { ...record(), date_sortie: null };
    const r = { ...record(), date_sortie: new Date('2025-07-07') };
    const d = decidercAction(existant, r);
    expect(d.verdict).toBe('update_sortie');
  });

  test('base a DÉJÀ une sortie : jamais effacée, jamais réécrite (même si le fichier en propose une autre)', () => {
    const existant = { ...record(), date_sortie: new Date('2024-01-01') };
    const r = { ...record(), date_sortie: new Date('2025-07-07') };
    const d = decidercAction(existant, r);
    expect(d.verdict).toBe('none');
  });

  test('base a une sortie, fichier n\'en a pas → jamais effacée (none)', () => {
    const existant = { ...record(), date_sortie: new Date('2024-01-01') };
    const r = { ...record(), date_sortie: null };
    const d = decidercAction(existant, r);
    expect(d.verdict).toBe('none');
  });

  test("écart de dimension détecté et listé, mais JAMAIS appliqué (l'action reste none/update_sortie selon la sortie)", () => {
    const existant = { ...record(), genre: 'Adulte Femme' };
    const d = decidercAction(existant, record());
    expect(d.verdict).toBe('none');
    expect(d.ecarts).toEqual([
      { code: 'P100MM', champ: 'genre', valeur_fichier: 'Sans Genre', valeur_base: 'Adulte Femme' },
    ]);
  });

  test('écart de poids détecté', () => {
    const existant = { ...record(), poids_kg: 12 };
    const d = decidercAction(existant, record());
    expect(d.ecarts.some((e) => e.champ === 'poids_kg')).toBe(true);
  });
});

describe('estFormuleRompue — formule #REF! (audit 2.57.0, classeur réel du client)', () => {
  // Constaté sur « Dashboard 2026 — saisie » : les 14 387 « Date de sortie »
  // sont `VLOOKUP(ID, #REF!, 2, FALSE)` → la table des sorties n'existe plus.
  const FORMULE = 'IF(T[Gamme]="Pvak",T[Date de fabrication],IFERROR(VLOOKUP(T[ID],#REF!,2,FALSE),""))';
  test('formule portant #REF! → rompue, avec ou sans résultat en cache', () => {
    expect(estFormuleRompue({ formula: FORMULE })).toBe(true);
    expect(estFormuleRompue({ formula: FORMULE, result: new Date('2025-07-07') })).toBe(true);
    expect(estFormuleRompue({ sharedFormula: FORMULE })).toBe(true);
  });
  test('valeur nue, date, formule saine → pas rompue', () => {
    expect(estFormuleRompue(null)).toBe(false);
    expect(estFormuleRompue('2025-07-07')).toBe(false);
    expect(estFormuleRompue(new Date())).toBe(false);
    expect(estFormuleRompue({ formula: 'A1+1', result: 2 })).toBe(false);
  });
  test('lireLignes signale la ligne SANS changer la valeur lue (résultat en cache conservé)', () => {
    const header = [null, 'ID', 'Produits', 'Catégorie Eco-org.', 'Genre', 'Saison', 'Gamme', 'Poids', 'Date de fabrication', 'Date de sortie', 'Inventaire'];
    const colonnes = { ID: 2, Produits: 3, 'Catégorie Eco-org.': 4, Genre: 5, Saison: 6, Gamme: 7, Poids: 8, 'Date de fabrication': 9, 'Date de sortie': 10, Inventaire: 11 };
    const rows = [
      header,
      [null, 'P10567', 'Pulls', 'Textiles', 'Homme', 'Hiver', 'Pvak', 10, new Date('2025-07-07'), { formula: FORMULE, result: new Date('2025-07-07') }, { formula: FORMULE }],
      [null, 'P10568', 'Pulls', 'Textiles', 'Homme', 'Hiver', 'VAK', 10, new Date('2025-07-07'), { formula: FORMULE }, { formula: FORMULE }],
    ];
    const lignes = lireLignes(fakeWorksheet(rows), colonnes, 1);
    expect(lignes[0].sortieFormuleRompue).toBe(true);
    expect(lignes[0].dateSortie).toEqual(new Date('2025-07-07')); // valeur en cache respectée
    expect(lignes[1].sortieFormuleRompue).toBe(true);
    expect(lignes[1].dateSortie).toBeNull(); // « en stock » faute de mieux — mais SIGNALÉ
    expect(lignes[1].inventaireFormuleRompue).toBe(true);
  });
});

describe('trouverEnTete', () => {
  test("repère la ligne d'en-tête n'importe où dans les 20 premières lignes et mappe les colonnes par nom", () => {
    const rows = [
      [null], [null], [null],
      [null, 'ID', 'Produits', 'Catégorie Eco-org.', 'Genre', 'Saison', 'Gamme', 'Poids', 'Date de fabrication', 'Date de sortie', 'Inventaire'],
      [null, 'P100MM', 'Chiffons Couleurs', 'Chiffons', 'Sans Genre', 'Sans Saison', 'CHIF', 10],
    ];
    const ws = fakeWorksheet(rows);
    const entete = trouverEnTete(ws);
    expect(entete).not.toBeNull();
    expect(entete.rowIndex).toBe(4);
    expect(entete.colonnes.ID).toBe(2);
    expect(entete.colonnes.Produits).toBe(3);
    expect(entete.colonnes.Gamme).toBe(7);
  });

  test('aucune ligne ID+Produits → null', () => {
    const ws = fakeWorksheet([[null, 'Autre chose'], [null, 'Rien à voir']]);
    expect(trouverEnTete(ws)).toBeNull();
  });
});

describe('lireLignes', () => {
  const header = [null, 'ID', 'Produits', 'Catégorie Eco-org.', 'Genre', 'Saison', 'Gamme', 'Poids', 'Date de fabrication', 'Date de sortie', 'Inventaire'];
  const colonnes = { ID: 2, Produits: 3, 'Catégorie Eco-org.': 4, Genre: 5, Saison: 6, Gamme: 7, Poids: 8, 'Date de fabrication': 9, 'Date de sortie': 10, Inventaire: 11 };

  test('lit les lignes de données, ignore une ligne vide et marque une ligne d\'en-tête répétée', () => {
    const rows = [
      header,
      [null, 'P100MM', 'Chiffons Couleurs', 'Chiffons', 'Sans Genre', 'Sans Saison', 'CHIF', 10, new Date('2020-05-16')],
      [null, null, null], // ligne vide → ignorée silencieusement (non comptée dans lignes)
      [null, 'ID', 'Produits'], // en-tête répétée au milieu des données
      [null, 'P100MN', 'Chiffons Couleurs', 'Chiffons', 'Sans Genre', 'Sans Saison', 'CHIF', 10, new Date('2020-05-16')],
    ];
    const ws = fakeWorksheet(rows);
    const lignes = lireLignes(ws, colonnes, 1);
    // La ligne vide n'est pas comptée du tout ; les 2 lignes de données + la
    // ligne d'en-tête répétée (comptée, mais marquée) le sont.
    expect(lignes).toHaveLength(3);
    expect(lignes[0].id).toBe('P100MM');
    expect(lignes[1].enteteRepetee).toBe(true);
    expect(lignes[2].id).toBe('P100MN');
  });
});

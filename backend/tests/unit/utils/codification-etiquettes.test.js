const {
  composerCode, decomposerCodeV2, formeLisible, normaliserScan, analyserCode, candidatsCode, LONGUEUR_V2, REFERENCE_MAX,
} = require('../../../src/utils/codification-etiquettes');

describe('codification v2 — composition', () => {
  test('exemple documenté : VAK / Textiles / 0x2A / Adulte Femme / Hiver / colis 31', () => {
    expect(composerCode({ gamme: 3, categorie: 1, produit: 42, genre: 2, saison: 2, reference: 31 }))
      .toBe('312A02200001F');
  });
  test('longueur fixe de 13 caractères hexadécimaux majuscules', () => {
    const c = composerCode({ gamme: 15, categorie: 15, produit: 255, genre: 255, saison: 15, reference: REFERENCE_MAX });
    expect(c).toBe('FFFFFFFFFFFFF');
    expect(c).toHaveLength(LONGUEUR_V2);
  });
  test('zéros de tête conservés (Sans Genre / Sans Saison)', () => {
    expect(composerCode({ gamme: 5, categorie: 9, produit: 1, genre: 0, saison: 0, reference: 1 })).toBe('5901000000001');
  });
  test.each([
    ['gamme', { gamme: 16 }], ['catégorie', { categorie: -1 }], ['produit', { produit: 256 }],
    ['genre', { genre: 1.5 }], ['saison', { saison: 16 }], ['référence', { reference: REFERENCE_MAX + 1 }],
  ])('refuse un code %s hors bornes', (_n, over) => {
    const base = { gamme: 1, categorie: 1, produit: 1, genre: 1, saison: 1, reference: 1 };
    expect(() => composerCode({ ...base, ...over })).toThrow(/hors bornes/);
  });
  test('aller-retour', () => {
    const d = { gamme: 2, categorie: 3, produit: 77, genre: 13, saison: 1, reference: 123456 };
    expect(decomposerCodeV2(composerCode(d))).toEqual(d);
  });
  test('forme lisible', () => {
    expect(formeLisible('312A02200001F')).toBe('3-1-2A-02-2-00001F');
    expect(formeLisible('P10AAH')).toBe('P10AAH');
  });
});

describe('lecture d\'un scan', () => {
  test('nettoie espaces, CR/LF et passe en majuscules', () => {
    expect(normaliserScan('  312a02200001f\r\n')).toBe('312A02200001F');
  });
  test('un code propre n\'est jamais retouché (le tiret de PF- reste)', () => {
    expect(normaliserScan('PF-1712345678901')).toBe('PF-1712345678901');
    expect(normaliserScan('P10AAH')).toBe('P10AAH');
  });
  test('douchette QWERTY sur poste AZERTY : rangée du haut et Q→A corrigés', () => {
    // « 312A02200001F » tapé en QWERTY sur un clavier AZERTY
    expect(normaliserScan('"&éQàééàààà&F')).toBe('312A02200001F');
    expect(normaliserScan('"&éqàééàààà&f')).toBe('312A02200001F');
    expect(normaliserScan('P&àQQH')).toBe('P10AAH');
  });
  test('vide / null', () => {
    expect(normaliserScan(null)).toBe('');
    expect(normaliserScan('   ')).toBe('');
  });
});

describe('analyse des formats', () => {
  test('v2', () => {
    const a = analyserCode('312A02200001F');
    expect(a.format).toBe('v2');
    expect(a.details).toEqual({ gamme: 3, categorie: 1, produit: 42, genre: 2, saison: 2, reference: 31 });
  });
  test.each(['P10AAH', 'P100MM', 'P1116F', 'P1115', 'P1399'])('ancien base 24 : %s', (c) => {
    expect(analyserCode(c).format).toBe('ancien_base24');
    expect(analyserCode(c).details.poste).toBe(1);
  });
  test('ancien horodaté : P1250320155908 → 20/03/2025 15:59:08', () => {
    const a = analyserCode('P1250320155908');
    expect(a.format).toBe('ancien_horodate');
    expect(a.details).toEqual({ poste: 1, horodatage: '2025-03-20T15:59:08' });
  });
  test('horodatage impossible → inconnu', () => {
    expect(analyserCode('P1251340155908').format).toBe('inconnu');
  });
  test('balance', () => {
    expect(analyserCode('PF-1712345678901').format).toBe('balance');
  });
  test.each(['', 'XYZ', 'P1ZZZZ', '312A0220000', '312A02200001FF', 'P1', '00001G', '0001F'])('inconnu : %s', (c) => {
    expect(analyserCode(c).format).toBe('inconnu');
  });
  test('aucun code v2 ne peut être lu comme un ancien code (et inversement)', () => {
    expect(analyserCode('P10AAH').format).not.toBe('v2');
    expect(/^P/.test(composerCode({ gamme: 15, categorie: 1, produit: 1, genre: 1, saison: 1, reference: 1 }))).toBe(false);
  });
});

describe('code vérif (référence courte imprimée sur l\'étiquette, 2.59.0)', () => {
  test('6 hex → référence courte, valeur décodée', () => {
    expect(analyserCode('00001f')).toEqual({ normalise: '00001F', format: 'reference_courte', details: { reference: 31 } });
  });
  test('aucun ancien code ne peut être lu comme une référence courte', () => {
    expect(analyserCode('P10AAH').format).toBe('ancien_base24');
  });

  const db = (rows) => ({ query: jest.fn().mockResolvedValue({ rows }) });

  test('résolue en code complet via reference_colis, avec contrôle de la fin du code', async () => {
    const d = db([{ code_barre: '312A02200001F' }]);
    const c = await candidatsCode(d, '00001f', analyserCode('00001f'));
    expect(c).toContain('312A02200001F');
    const [sql, params] = d.query.mock.calls[0];
    expect(sql).toMatch(/reference_colis = \$1/);
    expect(sql).toMatch(/codification = 'v2'/);
    expect(sql).toMatch(/RIGHT\(code_barre, \$2\) = \$3/);
    expect(params).toEqual([31, 6, '00001F']);
  });
  test('référence inconnue : aucun code inventé', async () => {
    const c = await candidatsCode(db([]), '00001F', analyserCode('00001F'));
    expect(c).toEqual(['00001F']);
  });
  test('un code complet ne déclenche aucune requête supplémentaire', async () => {
    const d = db([]);
    const c = await candidatsCode(d, ' 312a02200001f ', analyserCode(' 312a02200001f '));
    expect(d.query).not.toHaveBeenCalled();
    expect(c).toEqual(['312A02200001F', '312a02200001f']);
  });
});

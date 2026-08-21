/**
 * Tests des fonctions PURES du script de reprise des feuilles de production
 * (src/scripts/import-historique-production.js) — aucune base de données.
 */
const ExcelJS = require('exceljs');
const {
  parseArgs, parsePesees, parseObjectifPoids, parsePct, parseEntier,
  resumePostes, composerCommentaire, lireFeuilles, ecartsPesees, COL, POSTES,
} = require('../../src/scripts/import-historique-production');

describe('parseArgs', () => {
  test('--file est obligatoire, simulation par défaut', () => {
    expect(() => parseArgs([])).toThrow(/--file/);
    expect(parseArgs(['--file=/tmp/p.xlsx']))
      .toEqual({ apply: false, file: '/tmp/p.xlsx', completer: false });
  });

  test('--completer et --apply sont reconnus', () => {
    expect(parseArgs(['--file=/tmp/p.xlsx', '--completer', '--apply']))
      .toEqual({ apply: true, file: '/tmp/p.xlsx', completer: true });
  });
});

describe('parsePesees — séparateurs hétérogènes des formulaires', () => {
  test('les trois séparateurs rencontrés sont acceptés', () => {
    expect(parsePesees('248/241')).toEqual([248, 241]);
    expect(parsePesees('266.224.231.216')).toEqual([266, 224, 231, 216]);
    expect(parsePesees('247.237.247.202.203 207')).toEqual([247, 237, 247, 202, 203, 207]);
    expect(parsePesees('168/99/205/202/219.218/206')).toEqual([168, 99, 205, 202, 219, 218, 206]);
  });

  test('saisie vide ou absente → aucune pesée inventée', () => {
    for (const vide of [null, undefined, '', '   ']) expect(parsePesees(vide)).toEqual([]);
  });

  test('une pesée unique reste une pesée', () => {
    expect(parsePesees('280')).toEqual([280]);
  });
});

describe('parseObjectifPoids — tonnes et kilos mêlés dans la même colonne', () => {
  test('les formes du tableau donnent toutes des kilos', () => {
    expect(parseObjectifPoids('1,5T')).toBe(1500);
    expect(parseObjectifPoids('1,5')).toBe(1500);
    expect(parseObjectifPoids('0,9t')).toBe(900);
    expect(parseObjectifPoids('900')).toBe(900);
    expect(parseObjectifPoids('1300')).toBe(1300);
  });

  test('le seuil sépare la tonne du kilo sans ambiguïté métier', () => {
    // Un objectif quotidien d'atelier se compte en tonnes (1,5 T) ou en kilos
    // (900 kg) ; « 49 » ne peut pas être 49 kg de tri sur une journée.
    expect(parseObjectifPoids('49')).toBe(49000);
    expect(parseObjectifPoids('51')).toBe(51);
  });

  test('vide ou illisible → null, jamais un objectif inventé', () => {
    for (const v of [null, undefined, '', 'n/a', '0']) expect(parseObjectifPoids(v)).toBeNull();
  });
});

describe('parsePct / parseEntier', () => {
  test('pourcentages du tableau', () => {
    expect(parsePct('70%')).toBe(70);
    expect(parsePct('30')).toBe(30);
    expect(parsePct(null)).toBeNull();
    expect(parsePct('120%')).toBeNull(); // hors bornes → refusé
  });

  test('effectifs', () => {
    expect(parseEntier('11')).toBe(11);
    expect(parseEntier(7)).toBe(7);
    expect(parseEntier('')).toBeNull();
    expect(parseEntier(null)).toBeNull();
  });
});

describe('resumePostes — reproduire le formulaire sans trancher C1/C2', () => {
  const lire = (map) => (c) => (c in map ? map[c] : null);

  test('les postes cochés sont listés avec leurs colonnes', () => {
    // C1/C2 désigne tantôt « chaîne 1 / chaîne 2 », tantôt « matin /
    // après-midi » selon le formulaire : le résumé recopie, il n'interprète pas.
    const r = resumePostes(lire({ 15: 1, 17: 1, 18: 1 }));
    expect(r).toBe('Postes tenus : Craquage (C1) · Recyclage N°1 (C1, C2)');
  });

  test('aucun poste coché → aucun résumé', () => {
    expect(resumePostes(lire({}))).toBeNull();
  });

  test('les dix postes du formulaire sont couverts', () => {
    expect(POSTES).toHaveLength(10);
    const tout = {};
    for (const [, c1, c2] of POSTES) { tout[c1] = 1; tout[c2] = 1; }
    const r = resumePostes(lire(tout));
    for (const [libelle] of POSTES) expect(r).toContain(libelle);
  });
});

describe('composerCommentaire — traçabilité jusqu’au formulaire papier', () => {
  test('les quatre blocs sont assemblés dans l’ordre', () => {
    const c = composerCommentaire({
      commentaire: 'Craquage à fond', postes: 'Postes tenus : Craquage (C1)',
      notes: 'c1=Matin, c2=Après-midi', fichier: 'S3_1201-1601.pdf', page: 2,
    });
    expect(c.split('\n')).toEqual([
      'Craquage à fond',
      'Postes tenus : Craquage (C1)',
      'Réserve de lecture : c1=Matin, c2=Après-midi',
      'Source : S3_1201-1601.pdf, page 2',
    ]);
  });

  test('les blocs absents ne laissent pas de ligne vide', () => {
    expect(composerCommentaire({ commentaire: 'Seul' })).toBe('Seul');
    expect(composerCommentaire({})).toBeNull();
  });

  test('la source est citée même sans numéro de page', () => {
    expect(composerCommentaire({ fichier: 'S3.pdf' })).toBe('Source : S3.pdf');
  });
});

describe('lireFeuilles', () => {
  function feuille(lignes) {
    const ws = new ExcelJS.Workbook().addWorksheet('Production tri');
    ws.getRow(1).getCell(1).value = 'Date';
    lignes.forEach((l, i) => {
      const r = ws.getRow(2 + i);
      for (const [col, val] of Object.entries(l)) r.getCell(Number(col)).value = val;
    });
    return ws;
  }

  test('une ligne sans date n’est pas une journée', () => {
    const ws = feuille([
      { [COL.date]: new Date(Date.UTC(2026, 0, 12)), [COL.totalLigne]: 489 },
      { [COL.commentaire]: 'ligne de pied de tableau' },
    ]);
    expect(lireFeuilles(ws)).toHaveLength(1);
  });

  test('une journée est lue intégralement', () => {
    const ws = feuille([{
      [COL.date]: new Date(Date.UTC(2026, 0, 13)),
      [COL.encadrant]: 'Marie', [COL.effectifTri]: 11, [COL.cp]: 1,
      [COL.objEntree]: '1,5T', [COL.objRecyclage]: '70%', [COL.objCsr]: '<10%',
      [COL.saisieLigne]: '266.224.231.216', [COL.totalLigne]: 937,
      [COL.totalR3]: 1387, [COL.totalGeneral]: 2324,
    }]);
    const [f] = lireFeuilles(ws);
    expect(f.date).toBe('2026-01-13');
    expect(f.encadrant).toBe('Marie');
    expect(f.effectifTri).toBe(11);
    expect(f.objEntree).toBe(1500);
    expect(f.objRecyclage).toBe(70);
    expect(f.objCsr).toBe('<10%'); // colonne texte : la forme du formulaire est conservée
    expect(f.peseesLigne).toEqual([266, 224, 231, 216]);
    expect(f.totalKg).toBe(2324);
  });

  test('une journée sans tonnage reste une journée (feuille créée, tonnages vides)', () => {
    const ws = feuille([{ [COL.date]: new Date(Date.UTC(2026, 1, 5)), [COL.commentaire]: 'Prépa VAK' }]);
    const [f] = lireFeuilles(ws);
    expect(f.ligneKg).toBeNull();
    expect(f.totalKg).toBeNull();
    expect(f.commentaire).toContain('Prépa VAK');
  });
});

describe('ecartsPesees — signaler, jamais corriger en douce', () => {
  const base = { date: '2026-01-14', peseesLigne: [], peseesR3: [], ligneKg: null, r3Kg: null };

  test('un écart de transcription est remonté avec son signe', () => {
    const [e] = ecartsPesees([{ ...base, peseesLigne: [231, 212], ligneKg: 451 }]);
    expect(e).toEqual({ date: '2026-01-14', libelle: 'entrée ligne', somme: 443, total: 451, ecart: -8 });
  });

  test('une somme exacte ne produit aucun écart', () => {
    expect(ecartsPesees([{ ...base, peseesLigne: [248, 241], ligneKg: 489 }])).toEqual([]);
  });

  test('sans total déclaré, il n’y a rien à comparer', () => {
    expect(ecartsPesees([{ ...base, peseesLigne: [248, 241] }])).toEqual([]);
  });

  test('les deux lignes de pesée sont contrôlées séparément', () => {
    const e = ecartsPesees([{ ...base, peseesLigne: [100], ligneKg: 110, peseesR3: [200], r3Kg: 190 }]);
    expect(e.map((x) => x.libelle)).toEqual(['entrée ligne', 'recyclage N°3']);
  });
});

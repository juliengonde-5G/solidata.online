/**
 * Tests des fonctions PURES du script de reprise d'ancienneté
 * (src/scripts/import-historique-collectes.js) — aucune base de données.
 */
const ExcelJS = require('exceljs');
const {
  parseArgs, cellValue, localiserGrille, lireClasseur, rapprocher,
  grouperParJour, buildArbitrages, ARBITRAGES_CLIENT, VEHICULE,
} = require('../../src/scripts/import-historique-collectes');

/** Construit une feuille à la forme du fichier client : dates en ligne 3, PAV en colonne B. */
function feuille({ nbJours = 40, pavs = [] } = {}) {
  const ws = new ExcelJS.Workbook().addWorksheet('TournéesCAV');
  ws.getRow(3).getCell(1).value = 'Liste des tournées';
  for (let i = 0; i < nbJours; i++) {
    ws.getRow(3).getCell(53 + i).value = new Date(Date.UTC(2026, 0, 1 + i));
  }
  pavs.forEach((p, i) => {
    const r = 6 + i;
    ws.getRow(r).getCell(2).value = p.nom;
    for (const [jour, kg] of Object.entries(p.kg || {})) {
      ws.getRow(r).getCell(53 + Number(jour)).value = kg;
    }
  });
  return ws;
}

describe('parseArgs', () => {
  test('--file est obligatoire', () => {
    expect(() => parseArgs([])).toThrow(/--file/);
    expect(() => parseArgs(['--file='])).toThrow(/--file/);
  });

  test('simulation par défaut (aucune écriture sans --apply)', () => {
    expect(parseArgs(['--file=/tmp/a.xlsx']))
      .toEqual({ apply: false, file: '/tmp/a.xlsx', completer: false, supprimer: false });
  });

  test('--completer et --apply sont reconnus', () => {
    const a = parseArgs(['--file=/tmp/a.xlsx', '--completer', '--apply']);
    expect(a).toEqual({ apply: true, file: '/tmp/a.xlsx', completer: true, supprimer: false });
  });

  test('--supprimer dispense du fichier', () => {
    expect(parseArgs(['--supprimer']).supprimer).toBe(true);
  });
});

describe('cellValue — déballage des cellules exceljs', () => {
  test('les formules rendent leur résultat, pas l’objet', () => {
    // Sans ce déballage, String(valeur) donne « [object Object] » et TOUT le
    // rapprochement échoue en silence : la garde vaut d'être verrouillée.
    expect(cellValue({ value: { formula: 'A1', result: 'ROUEN - 1 rue X' } })).toBe('ROUEN - 1 rue X');
    expect(cellValue({ value: { formula: 'SUM(A1)', result: 120 } })).toBe(120);
  });

  test('le texte enrichi est recollé', () => {
    expect(cellValue({ value: { richText: [{ text: 'ROUEN' }, { text: ' - 1 rue X' }] } }))
      .toBe('ROUEN - 1 rue X');
  });

  test('valeurs simples, dates et vides', () => {
    const d = new Date(Date.UTC(2026, 0, 5));
    expect(cellValue({ value: d })).toBe(d);
    expect(cellValue({ value: 42 })).toBe(42);
    expect(cellValue({ value: null })).toBeNull();
    expect(cellValue(undefined)).toBeNull();
  });
});

describe('localiserGrille', () => {
  test('trouve la ligne des dates sans la coder en dur', () => {
    const g = localiserGrille(feuille({ nbJours: 40 }));
    expect(g.ligneDates).toBe(3);
    expect(g.colonnes).toHaveLength(40);
    expect(g.colonnes[0].date).toBe('2026-01-01');
  });

  test('refuse un fichier qui n’a pas la forme attendue', () => {
    const ws = new ExcelJS.Workbook().addWorksheet('X');
    ws.getRow(1).getCell(1).value = 'bonjour';
    expect(() => localiserGrille(ws)).toThrow(/forme attendue/);
  });
});

describe('lireClasseur', () => {
  const ws = feuille({
    pavs: [
      { nom: 'ROUEN - 1 rue A', kg: { 0: 120, 4: 80 } },
      { nom: 'ROUEN - 2 rue B', kg: { 4: 0 } },
      { nom: '', kg: {} },
    ],
  });

  test('une cellule vide est une absence de passage', () => {
    const { pavs } = lireClasseur(ws);
    expect(pavs[0].collectes).toEqual([
      { date: '2026-01-01', kg: 120 }, { date: '2026-01-05', kg: 80 },
    ]);
  });

  test('une cellule à 0 est un passage SANS collecte, pas une absence', () => {
    // La borne était vide ce jour-là : c'est une information de cadence pour le
    // moteur, la perdre biaiserait l'intervalle entre collectes.
    const { pavs } = lireClasseur(ws);
    expect(pavs[1].collectes).toEqual([{ date: '2026-01-05', kg: 0 }]);
  });

  test('les lignes sans nom sont ignorées', () => {
    expect(lireClasseur(ws).pavs).toHaveLength(2);
  });
});

describe('rapprocher', () => {
  const cavs = [
    { id: 1, name: 'ROUEN - 1 rue A' },
    { id: 2, name: 'ROUEN - 2 rue B' },
    { id: 3, name: 'DOUBLON' },
    { id: 4, name: 'DOUBLON' },
  ];
  const pav = (nom) => lireClasseur(feuille({ pavs: [{ nom, kg: { 0: 10 } }] })).pavs[0];

  test('rapproche malgré casse, accents et apostrophes typographiques', () => {
    const { ok } = rapprocher([pav('rouen -  1 RUE a')], cavs);
    expect(ok).toHaveLength(1);
    expect(ok[0].cav.id).toBe(1);
    expect(ok[0].arbitre).toBe(false);
  });

  test('un nom porté par PLUSIEURS CAV est ambigu, jamais tranché au hasard', () => {
    const { ok, ambigus } = rapprocher([pav('Doublon')], cavs);
    expect(ok).toHaveLength(0);
    expect(ambigus[0].candidats.map((c) => c.id)).toEqual([3, 4]);
  });

  test('un nom sans correspondance est signalé, aucun CAV n’est créé', () => {
    const { absents } = rapprocher([pav('COMMUNE INCONNUE - 9 rue Z')], cavs);
    expect(absents).toHaveLength(1);
  });

  test('les arbitrages validés avec le client sont appliqués et signalés', () => {
    const cible = 'SAINT-AUBIN-LÈS-ELBEUF - Rue du Docteur Villers (Entrée EHPAD)';
    const source = 'SAINT-AUBIN-LÈS-ELBEUF - 2 Rue du Docteur Villers (Entrée EHPAD)';
    const { ok } = rapprocher([pav(source)], [{ id: 133, name: cible }]);
    expect(ok).toHaveLength(1);
    expect(ok[0].cav.id).toBe(133);
    expect(ok[0].arbitre).toBe(true);
  });
});

describe('buildArbitrages', () => {
  test('hérite des arbitrages des modèles de tournées (un seul dialecte)', () => {
    // Réutiliser les décisions de v2.26.3 évite que deux imports rattachent le
    // même libellé à deux CAV différents.
    const map = buildArbitrages(
      [{ points: [{ source_label: 'A - Sente aux Mulets', cav_name: 'A - 318 rue Delamare' }] }],
      {}
    );
    expect(map.size).toBe(1);
    expect([...map.values()][0]).toContain('318 rue delamare');
  });

  test('les arbitrages du client s’ajoutent aux précédents', () => {
    const map = buildArbitrages([], ARBITRAGES_CLIENT);
    expect(map.size).toBe(2);
  });

  test('accepte les deux formes de fichier de modèles (tableau ou objet)', () => {
    const pts = [{ source_label: 'X', cav_name: 'Y' }];
    expect(buildArbitrages([{ points: pts }], {}).size).toBe(1);
    expect(buildArbitrages({ modeles: [{ points: pts }] }, {}).size).toBe(1);
  });
});

describe('grouperParJour', () => {
  const ws = feuille({
    pavs: [
      { nom: 'A', kg: { 0: 100, 1: 50 } },
      { nom: 'B', kg: { 0: 200 } },
    ],
  });
  const { pavs } = lireClasseur(ws);
  const rapproches = [
    { ...pavs[0], cav: { id: 11, name: 'A' } },
    { ...pavs[1], cav: { id: 22, name: 'B' } },
  ];

  test('une journée regroupe tous les PAV collectés ce jour-là', () => {
    const jours = grouperParJour(rapproches);
    expect(jours).toHaveLength(2);
    expect(jours[0].date).toBe('2026-01-01');
    expect(jours[0].points.map((p) => p.cavId)).toEqual([11, 22]);
    expect(jours[0].totalKg).toBe(300);
  });

  test('les journées sortent dans l’ordre chronologique', () => {
    expect(grouperParJour(rapproches).map((j) => j.date))
      .toEqual(['2026-01-01', '2026-01-02']);
  });

  test('l’ordre des points suit le fichier (aucun itinéraire inventé)', () => {
    const inverse = [rapproches[1], rapproches[0]];
    expect(grouperParJour(inverse)[0].points.map((p) => p.cavId)).toEqual([22, 11]);
  });
});

describe('véhicule support', () => {
  test('il est HORS SERVICE : jamais proposé au planning ni au dispatch', () => {
    expect(VEHICULE.status).toBe('out_of_service');
    expect(VEHICULE.registration).toBe('REPRISE-HISTORIQUE');
  });
});

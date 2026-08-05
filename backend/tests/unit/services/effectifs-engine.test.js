// ═══════════════════════════════════════════════════════════════════════════
// TESTS UNITAIRES — Moteur « Effectifs conventionnés (ETP) »
// (services/effectifs-engine.js — fonctions PURES, aucun accès DB)
//
// Règles verrouillées :
//  - semaines ISO de l'année (52/53) + pivot mois = JEUDI (semaine à cheval) ;
//  - quotité = heures/35 arrondie 2 déc. (26 → 0.74, 35 → 1) ;
//  - chaînage signé/présumé : borne pass_iae_end, borne 1er CDDI + 24 mois − 1 j,
//    min des deux, aucune borne → pas de présomption, CDI ouvert → pas de
//    présomption, hors parcours → pas de présomption ;
//  - réalisé : maladie 3 j ouvrés → ×0.4, holiday non déduit, clip [0, q],
//    plafond 5 j/semaine ;
//  - ETP mensuel = moyenne (null si aucune semaine observée).
// ═══════════════════════════════════════════════════════════════════════════
const engine = require('../../../src/services/effectifs-engine');

describe('isoWeeksOfYear — semaines ISO + pivot jeudi', () => {
  it('2026 (année commençant un jeudi) → 53 semaines, S1 = lundi 2025-12-29', () => {
    const weeks = engine.isoWeeksOfYear(2026);
    expect(weeks).toHaveLength(53);
    expect(weeks[0]).toEqual({ num: 1, lundi: '2025-12-29', jeudi: '2026-01-01', mois: 1 });
    expect(weeks[52]).toEqual({ num: 53, lundi: '2026-12-28', jeudi: '2026-12-31', mois: 12 });
  });

  it('2025 → 52 semaines, S1 = lundi 2024-12-30', () => {
    const weeks = engine.isoWeeksOfYear(2025);
    expect(weeks).toHaveLength(52);
    expect(weeks[0].lundi).toBe('2024-12-30');
    expect(weeks[0].jeudi).toBe('2025-01-02');
  });

  it('pivot jeudi : la semaine du lundi 2026-03-30 (à cheval mars/avril) est rattachée à AVRIL', () => {
    const weeks = engine.isoWeeksOfYear(2026);
    const w = weeks.find((x) => x.lundi === '2026-03-30');
    expect(w.jeudi).toBe('2026-04-02');
    expect(w.mois).toBe(4); // le jeudi tombe en avril → mois 4, pas 3
  });

  it('pivot jeudi : la semaine du lundi 2026-06-29 (jeudi 2 juillet) est rattachée à JUILLET', () => {
    const w = engine.isoWeeksOfYear(2026).find((x) => x.lundi === '2026-06-29');
    expect(w.mois).toBe(7);
  });

  it('chaque mois 1-12 possède au moins une semaine rattachée', () => {
    const moisPresents = new Set(engine.isoWeeksOfYear(2026).map((w) => w.mois));
    for (let m = 1; m <= 12; m++) expect(moisPresents.has(m)).toBe(true);
  });
});

describe('computeQuotite — heures hebdo / 35 arrondi 2 déc.', () => {
  it('26 h → 0.74 (0.742857 arrondi)', () => {
    expect(engine.computeQuotite(26)).toBe(0.74);
  });
  it('35 h → 1', () => {
    expect(engine.computeQuotite(35)).toBe(1);
  });
  it('28 h → 0.8 ; 24 h → 0.69 ; 30 h → 0.86', () => {
    expect(engine.computeQuotite(28)).toBe(0.8);
    expect(engine.computeQuotite(24)).toBe(0.69);
    expect(engine.computeQuotite(30)).toBe(0.86);
  });
  it('valeur invalide ou ≤ 0 → null (jamais de valeur inventée)', () => {
    expect(engine.computeQuotite(0)).toBeNull();
    expect(engine.computeQuotite(null)).toBeNull();
    expect(engine.computeQuotite('abc')).toBeNull();
  });
});

describe('buildSegments — chaînage signé + renouvellement présumé', () => {
  const base = {
    contrats: [
      { start: '2026-01-01', end: '2026-03-31', weeklyHours: 26 },
      { start: '2026-04-01', end: '2026-06-30', weeklyHours: 35 },
    ],
    insertionStatus: 'en_parcours',
    passIaeEnd: null,
    premierCddiDebut: '2026-01-01',
  };

  it('contrats signés → segments statut signe, fin_dernier_contrat = max des fins', () => {
    const { segments, finDernierContrat } = engine.buildSegments({ ...base, insertionStatus: 'termine' });
    expect(finDernierContrat).toBe('2026-06-30');
    expect(segments.filter((s) => s.statut === 'signe')).toHaveLength(2);
    expect(segments.find((s) => s.statut === 'presume')).toBeUndefined(); // hors parcours
  });

  it('présumé borné par pass_iae_end : commence le lendemain de la fin, même quotité que le dernier contrat', () => {
    const { segments, bornePresume } = engine.buildSegments({ ...base, passIaeEnd: '2026-09-30' });
    const presume = segments.find((s) => s.statut === 'presume');
    expect(presume).toEqual({ debut: '2026-07-01', fin: '2026-09-30', quotite: 1, statut: 'presume' });
    expect(bornePresume).toBe('2026-09-30');
  });

  it('sans pass IAE : borne = début du 1er CDDI + 24 mois − 1 jour', () => {
    const { segments } = engine.buildSegments(base);
    const presume = segments.find((s) => s.statut === 'presume');
    // 2026-01-01 + 24 mois = 2028-01-01, − 1 j = 2027-12-31
    expect(presume.fin).toBe('2027-12-31');
    expect(presume.debut).toBe('2026-07-01');
  });

  it('les deux bornes connues → min (pass IAE plus proche que +24 mois)', () => {
    const { segments } = engine.buildSegments({ ...base, passIaeEnd: '2026-10-15' });
    expect(segments.find((s) => s.statut === 'presume').fin).toBe('2026-10-15');
  });

  it('les deux bornes connues → min (+24 mois plus proche que le pass IAE)', () => {
    const { segments } = engine.buildSegments({
      ...base, passIaeEnd: '2028-06-30', premierCddiDebut: '2024-09-01',
    });
    // 2024-09-01 + 24 mois − 1 j = 2026-08-31 < 2028-06-30
    expect(segments.find((s) => s.statut === 'presume').fin).toBe('2026-08-31');
  });

  it('aucune borne connue → AUCUNE présomption (jamais de valeur inventée)', () => {
    const { segments } = engine.buildSegments({ ...base, premierCddiDebut: null });
    expect(segments.find((s) => s.statut === 'presume')).toBeUndefined();
  });

  it('borne antérieure ou égale à la fin du dernier contrat → pas de présomption', () => {
    const { segments } = engine.buildSegments({ ...base, passIaeEnd: '2026-06-30' });
    expect(segments.find((s) => s.statut === 'presume')).toBeUndefined();
  });

  it('contrat sans terme (CDI Inclusion en cours) → couverture ouverte, pas de présomption', () => {
    const { segments, finDernierContrat } = engine.buildSegments({
      contrats: [{ start: '2026-02-01', end: null, weeklyHours: 35 }],
      insertionStatus: 'en_parcours',
      passIaeEnd: '2026-12-31',
      premierCddiDebut: null,
    });
    expect(finDernierContrat).toBeNull();
    expect(segments).toHaveLength(1);
    expect(segments[0].fin).toBeNull();
  });

  it('addMonthsISO borne au dernier jour du mois cible (31/01 + 1 mois → 28/02)', () => {
    expect(engine.addMonthsISO('2026-01-31', 1)).toBe('2026-02-28');
  });
});

describe('quotiteSemaine — quotité du contrat effectif couvrant le JEUDI', () => {
  const segments = [
    { debut: '2026-01-01', fin: '2026-03-31', quotite: 0.74, statut: 'signe' },
    { debut: '2026-04-01', fin: '2026-06-30', quotite: 1, statut: 'signe' },
    { debut: '2026-07-01', fin: '2026-09-30', quotite: 1, statut: 'presume' },
  ];

  it('jeudi couvert par le 1er contrat → 0.74 signe', () => {
    expect(engine.quotiteSemaine('2026-02-05', segments)).toEqual({ q: 0.74, statut: 'signe' });
  });

  it('semaine à cheval sur le changement de contrat : le JEUDI tranche (jeudi 2026-04-02 → 2e contrat)', () => {
    // Semaine du lundi 2026-03-30 : lundi-mardi sous contrat 26 h, mais le
    // jeudi 2 avril est sous le contrat 35 h → quotité 1.
    expect(engine.quotiteSemaine('2026-04-02', segments)).toEqual({ q: 1, statut: 'signe' });
  });

  it('jeudi en zone présumée → statut presume', () => {
    expect(engine.quotiteSemaine('2026-08-06', segments)).toEqual({ q: 1, statut: 'presume' });
  });

  it('jeudi hors couverture → { q: null, statut: null }', () => {
    expect(engine.quotiteSemaine('2026-11-05', segments)).toEqual({ q: null, statut: null });
    expect(engine.quotiteSemaine('2025-12-25', segments)).toEqual({ q: null, statut: null });
  });

  it('recouvrement signé/présumé → le signé gagne', () => {
    const overlap = [
      { debut: '2026-01-01', fin: '2026-12-31', quotite: 0.5, statut: 'presume' },
      { debut: '2026-06-01', fin: '2026-06-30', quotite: 1, statut: 'signe' },
    ];
    expect(engine.quotiteSemaine('2026-06-04', overlap)).toEqual({ q: 1, statut: 'signe' });
  });
});

describe('joursOuvresAbsents + quotiteRealisee — déduction des absences', () => {
  const LUNDI = '2026-03-02'; // semaine lun 02/03 → ven 06/03

  it('maladie 3 jours ouvrés (mar→jeu) → 3 j → réalisé = q × 0.4', () => {
    const ja = engine.joursOuvresAbsents(LUNDI, [
      { type_category: 'sick', start: '2026-03-03', end: '2026-03-05' },
    ]);
    expect(ja).toBe(3);
    expect(engine.quotiteRealisee(1, ja)).toBe(0.4);
    expect(engine.quotiteRealisee(0.74, ja)).toBe(0.3); // 0.74 × 0.4 = 0.296 → 0.3
  });

  it("congés payés ('holiday') → JAMAIS déduits", () => {
    const ja = engine.joursOuvresAbsents(LUNDI, [
      { type_category: 'holiday', start: '2026-03-02', end: '2026-03-06' },
    ]);
    expect(ja).toBe(0);
    expect(engine.quotiteRealisee(0.74, ja)).toBe(0.74);
  });

  it('absence à cheval sur la semaine : seule l\'intersection lun→ven compte', () => {
    // Absence du jeudi 26/02 au mardi 03/03 → intersection = lun 02 + mar 03 = 2 j
    const ja = engine.joursOuvresAbsents(LUNDI, [
      { type_category: 'absence', start: '2026-02-26', end: '2026-03-03' },
    ]);
    expect(ja).toBe(2);
  });

  it('le week-end ne compte pas : absence sam→dim → 0 jour ouvré', () => {
    const ja = engine.joursOuvresAbsents(LUNDI, [
      { type_category: 'sick', start: '2026-03-07', end: '2026-03-08' },
    ]);
    expect(ja).toBe(0);
  });

  it('absences cumulées plafonnées à 5 j → réalisé clippé à 0', () => {
    const ja = engine.joursOuvresAbsents(LUNDI, [
      { type_category: 'sick', start: '2026-03-02', end: '2026-03-06' },
      { type_category: 'absence', start: '2026-03-02', end: '2026-03-04' }, // recouvrement
    ]);
    expect(ja).toBe(5); // 5 + 3 plafonné à 5
    expect(engine.quotiteRealisee(1, ja)).toBe(0);
  });

  it('clip [0, q] : jamais négatif, jamais au-dessus de la quotité prévue', () => {
    expect(engine.quotiteRealisee(0.74, 0)).toBe(0.74);
    expect(engine.quotiteRealisee(0.74, 5)).toBe(0);
    expect(engine.quotiteRealisee(null, 2)).toBeNull();
  });

  it('absence sans end → un seul jour', () => {
    expect(engine.joursOuvresAbsents(LUNDI, [{ type_category: 'sick', start: '2026-03-04', end: null }])).toBe(1);
  });
});

describe('moyenne2 — ETP mensuel = moyenne des semaines rattachées au mois', () => {
  it('moyenne arrondie 2 déc.', () => {
    expect(engine.moyenne2([25, 25.5, 26, 25])).toBe(25.38); // 101.5/4 = 25.375
  });
  it('liste vide → null (mois sans semaine observée : jamais 0 inventé)', () => {
    expect(engine.moyenne2([])).toBeNull();
    expect(engine.moyenne2(null)).toBeNull();
  });
  it('les null sont ignorés', () => {
    expect(engine.moyenne2([1, null, 2])).toBe(1.5);
  });
});

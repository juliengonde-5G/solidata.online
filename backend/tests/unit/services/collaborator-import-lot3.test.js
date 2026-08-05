/**
 * Lot 3 (2026-08) — Import paie Malibou : historique des contrats (chaînage des
 * avenants), planning hebdo contractuel, heures hebdomadaires, congés.
 *
 * Règles métier client testées ici :
 *  1. Un salarié a un contrat d'origine (date d'embauche UNIQUE = Date de début,
 *     répétée sur chaque ligne) puis des AVENANTS ; la « Date d'avenant » est le
 *     début du nouvel avenant → la ligne précédente (tri par date d'avenant)
 *     s'arrête LA VEILLE.
 *  2. Dans le planning horaire hebdo, colonnes VIDES = non travaillé.
 *
 * La suite « fichier réel » est conditionnelle : elle ne s'exécute que si
 * l'export client est présent (variable MALIBOU_XLSX ou chemin de session) —
 * le fichier contient des données personnelles et n'est PAS versionné.
 */

const fs = require('fs');
const {
  buildContractChain,
  normalizeContractRow,
  parseWeeklySchedule,
  pickBetterWeekRow,
  categorizeLeaveType,
  cleanTime,
  dayBeforeISO,
  toNum,
  parseWorkbookFull,
} = require('../../../src/services/collaborator-import');

// Reproduit la normalisation d'en-têtes du service (accents/casse/espaces) pour
// construire des lignes de feuille telles que sheetToObjects les produit.
const norm = (h) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const sheetRow = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [norm(k), v]));

describe('Lot 3 — helpers de dates et nombres', () => {
  test('dayBeforeISO : veille, y compris changement de mois/année', () => {
    expect(dayBeforeISO('2026-04-01')).toBe('2026-03-31');
    expect(dayBeforeISO('2026-01-01')).toBe('2025-12-31');
    expect(dayBeforeISO(null)).toBeNull();
  });

  test('cleanTime : formats string et Date, vide = null', () => {
    expect(cleanTime('08:30')).toBe('08:30');
    expect(cleanTime('8:30')).toBe('08:30');
    expect(cleanTime('08h30')).toBe('08:30');
    expect(cleanTime(new Date(Date.UTC(2026, 0, 1, 13, 20)))).toBe('13:20');
    expect(cleanTime('')).toBeNull();
    expect(cleanTime(null)).toBeNull();
  });

  test('toNum : virgule FR, vide = null', () => {
    expect(toNum('26')).toBe(26);
    expect(toNum('17,5')).toBe(17.5);
    expect(toNum('')).toBeNull();
    expect(toNum('abc')).toBeNull();
  });
});

describe('Lot 3 — chaînage des avenants (règle métier 1)', () => {
  const mk = (uid, officialStart, officialEnd, avenant) => ({
    matricule: '00001',
    contract_uid: uid,
    official_start: officialStart,
    official_end: officialEnd,
    avenant_date: avenant,
    weekly_hours: 26,
  });

  test('un contrat, 4 avenants : la ligne précédente finit la veille de la suivante', () => {
    const chain = buildContractChain([
      mk('ctr_A', '2025-08-01', '2026-11-30', '2026-07-01'),
      mk('ctr_A', '2025-08-01', '2026-11-30', '2025-08-01'),
      mk('ctr_A', '2025-08-01', '2026-11-30', '2026-07-31'),
      mk('ctr_A', '2025-08-01', '2026-11-30', '2026-04-01'),
    ]);
    expect(chain.map((r) => [r.origin, r.effective_start, r.effective_end])).toEqual([
      ['embauche', '2025-08-01', '2026-03-31'],
      ['avenant', '2026-04-01', '2026-06-30'],
      ['avenant', '2026-07-01', '2026-07-30'],
      ['avenant', '2026-07-31', '2026-11-30'], // dernier avenant → fin officielle
    ]);
    // Date d'embauche UNIQUE conservée sur chaque ligne (Date de début officielle)
    expect(chain.every((r) => r.official_start === '2025-08-01')).toBe(true);
  });

  test('deux contrats successifs : nouveau ctr_uid = renouvellement, pas d’avenant', () => {
    const chain = buildContractChain([
      mk('ctr_B', '2026-08-01', '2026-08-31', '2026-08-01'),
      mk('ctr_A', '2024-12-01', '2026-07-31', '2026-07-01'),
      mk('ctr_A', '2024-12-01', '2026-07-31', '2024-12-01'),
    ]);
    expect(chain.map((r) => r.origin)).toEqual(['embauche', 'avenant', 'renouvellement']);
    // La dernière ligne du contrat A finit à SA fin officielle (= veille du contrat B)
    expect(chain[1].effective_end).toBe('2026-07-31');
    expect(chain[2].effective_start).toBe('2026-08-01');
  });

  test('contrats disjoints : la fin effective ne dépasse jamais la fin officielle', () => {
    const chain = buildContractChain([
      mk('ctr_A', '2026-01-01', '2026-06-30', '2026-01-01'),
      mk('ctr_B', '2026-09-01', '2026-12-31', '2026-09-01'),
    ]);
    // veille du suivant = 2026-08-31, mais le contrat A s'arrête le 30/06
    expect(chain[0].effective_end).toBe('2026-06-30');
  });

  test('date d’avenant absente : la ligne vaut depuis le début officiel', () => {
    const chain = buildContractChain([mk('ctr_A', '2026-01-01', null, null)]);
    expect(chain[0].effective_start).toBe('2026-01-01');
    expect(chain[0].effective_end).toBeNull(); // CDI sans fin
    expect(chain[0].origin).toBe('embauche');
  });
});

describe('Lot 3 — planning hebdo contractuel (règle métier 2)', () => {
  test('colonnes vides = demi-journées non travaillées (absentes du JSON)', () => {
    const r = sheetRow({
      'Lundi - Matin - Heure de début': '08:30',
      'Lundi - Matin - Heure de fin': '12:15',
      'Lundi - Après-midi - Heure de début': '13:20',
      'Lundi - Après-midi - Heure de fin': '16:05',
      // mardi entièrement vide = non travaillé
      'Mercredi - Matin - Heure de début': '08:30',
      'Mercredi - Matin - Heure de fin': '12:15',
      // mercredi après-midi vide = demi-journée non travaillée
    });
    const sched = parseWeeklySchedule(r);
    expect(sched.lundi).toEqual({ matin: { debut: '08:30', fin: '12:15' }, apres_midi: { debut: '13:20', fin: '16:05' } });
    expect(sched.mardi).toBeUndefined();
    expect(sched.mercredi).toEqual({ matin: { debut: '08:30', fin: '12:15' } });
    expect(sched.samedi).toBeUndefined();
    expect(sched.dimanche).toBeUndefined();
  });

  test('aucun horaire renseigné (forfait jours) → null', () => {
    expect(parseWeeklySchedule(sheetRow({}))).toBeNull();
  });
});

describe('Lot 3 — dédoublonnage des heures hebdo', () => {
  const wk = (contract, expected, worked) => ({ hours_contract: contract, hours_expected: expected, hours_worked: worked });

  test('Malibou duplique la semaine par contrat : on retient la quotité la plus élevée, jamais de somme', () => {
    // Cas réel 00783 semaine 1/2026 : 19,5 h sur les deux lignes, contrat 26 vs 0
    expect(pickBetterWeekRow(wk(26, 19.5, 19.5), wk(0, 19.5, 19.5))).toEqual(wk(26, 19.5, 19.5));
    // Cas réel 00733 semaine 14 : avenant de quotité en cours de période
    expect(pickBetterWeekRow(wk(14, 14, 14), wk(17.5, 21, 21))).toEqual(wk(17.5, 21, 21));
    // Lignes identiques → indifférent (celle déjà retenue)
    expect(pickBetterWeekRow(wk(26, 26, 26), wk(26, 26, 26))).toEqual(wk(26, 26, 26));
  });
});

describe('Lot 3 — catégorisation des absences (alignée enum work_hours)', () => {
  test.each([
    ['Congés Payés', 'holiday'],
    ['RTT', 'holiday'],
    ['Repos compensateur (h. sup.)', 'holiday'],
    ['Maladie', 'sick'],
    ['Enfant malade', 'sick'],
    ['Absence non rémunérée non autorisée', 'absence'],
    ['Événement familial', 'absence'],
    ['Paternité', 'absence'],
    ['Autre', 'absence'],
  ])('%s → %s', (label, expected) => {
    expect(categorizeLeaveType(label)).toBe(expected);
  });
});

describe('Lot 3 — normalisation d’une ligne de contrat', () => {
  test('poste « … Cddi » sous type CDD → requalifié CDDI (objet métier insertion)', () => {
    const row = normalizeContractRow(sheetRow({
      'Matricule': '00042',
      'ID contrat': 'ctr_test',
      'Date de début': '2026-01-01',
      'Date de fin': '2026-12-31',
      "Date d'avenant": '2026-01-01',
      'Intitulé de poste': 'Operateur De Tri Cddi',
      'Type de contrat': 'CDD',
      "Nombre d'heures par semaine": '26',
    }));
    expect(row.contract_type).toBe('CDDI');
    expect(row.weekly_hours).toBe(26);
    expect(row.official_start).toBe('2026-01-01');
  });

  test('CDI encadrant : type conservé tel quel', () => {
    const row = normalizeContractRow(sheetRow({
      'Matricule': '00043',
      'ID contrat': 'ctr_test2',
      'Date de début': '2024-05-01',
      'Type de contrat': 'CDI',
      'Intitulé de poste': 'Responsable Logistique',
    }));
    expect(row.contract_type).toBe('CDI');
    expect(row.official_end).toBeNull();
  });
});

// ── Suite conditionnelle sur l'export RÉEL (données personnelles, non versionné) ──
const REAL_FILE = process.env.MALIBOU_XLSX
  || '/root/.claude/uploads/a868c512-389a-52dc-88c9-c47e42595463/f38e59e6-Export_SOLIDATA_202601__202608.xlsx';
const describeReal = fs.existsSync(REAL_FILE) ? describe : describe.skip;

describeReal('Lot 3 — export Malibou réel (si présent)', () => {
  let parsed;
  beforeAll(async () => {
    parsed = await parseWorkbookFull(fs.readFileSync(REAL_FILE));
  });

  test('périmètre : 57 salariés, 88 lignes de contrats, 1323 semaines dédoublonnées, 115 absences', () => {
    expect(parsed.collaborators.length).toBe(57);
    const nbContrats = Object.values(parsed.contractsByMatricule).reduce((s, a) => s + a.length, 0);
    const nbSemaines = Object.values(parsed.weekHoursByMatricule).reduce((s, a) => s + a.length, 0);
    const nbAbsences = Object.values(parsed.leavesByMatricule).reduce((s, a) => s + a.length, 0);
    expect(nbContrats).toBe(88);
    expect(nbSemaines).toBe(1323); // 1600 lignes brutes − 277 doublons par contrat
    expect(nbAbsences).toBe(115);
  });

  test('matricule 00819 : 4 avenants chaînés, embauche unique 2025-08-01', () => {
    const chain = parsed.contractsByMatricule['00819'];
    expect(chain.map((r) => [r.origin, r.effective_start, r.effective_end])).toEqual([
      ['embauche', '2025-08-01', '2026-03-31'],
      ['avenant', '2026-04-01', '2026-06-30'],
      ['avenant', '2026-07-01', '2026-07-30'],
      ['avenant', '2026-07-31', '2026-11-30'],
    ]);
    expect(chain.every((r) => r.official_start === '2025-08-01')).toBe(true);
  });

  test('matricule 00783 : changement d’ID contrat = renouvellement', () => {
    const chain = parsed.contractsByMatricule['00783'];
    expect(chain[chain.length - 1].origin).toBe('renouvellement');
    expect(chain[chain.length - 1].effective_start).toBe('2026-08-01');
    // la dernière ligne de l'ancien contrat s'arrête la veille
    expect(chain[chain.length - 2].effective_end).toBe('2026-07-31');
  });

  test('RGPD : NIR / IBAN / BIC jamais présents dans les objets importés', () => {
    for (const c of parsed.collaborators) {
      const keys = Object.keys(c).join(' ').toLowerCase();
      expect(keys).not.toMatch(/nir|iban|bic|securite sociale/);
    }
  });
});

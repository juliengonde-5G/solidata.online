const {
  computeMilestoneSchedule,
  computeCddiCumulativeMonths,
  resyncMilestones,
  MILESTONE_TYPES,
  MILESTONE_TYPE_LABELS,
  milestoneLabel,
  computeLearningStyle,
  competenceAverage,
  ensurePeriodeEssaiMilestone,
} = require('../../../src/routes/insertion/engine');

// ── Extension 2026-07 (PR1) : l'échéancier produit désormais des TYPES
// TECHNIQUES (CHECK SQL) + un titre d'affichage ────────────────────────────
describe('insertion/engine — computeMilestoneSchedule (types techniques 2026-07)', () => {
  it('contrat 12 mois → accueil + 3 bilans intermédiaires titrés + sortie', () => {
    const s = computeMilestoneSchedule('2026-01-01', '2027-01-01');
    expect(s.map((d) => d.type)).toEqual([
      'diagnostic_accueil', 'bilan_intermediaire', 'bilan_intermediaire', 'bilan_intermediaire', 'bilan_sortie',
    ]);
    expect(s.map((d) => d.titre)).toEqual([
      "Diagnostic d'accueil", 'Bilan M+3', 'Bilan M+6', 'Bilan M+10', 'Bilan de sortie',
    ]);
    // Tous les types produits sont acceptés par le CHECK SQL.
    for (const d of s) expect(MILESTONE_TYPES).toContain(d.type);
  });

  it('contrat 6 mois → pas de M+6/M+10 (jalons fantômes)', () => {
    const s = computeMilestoneSchedule('2026-01-01', '2026-07-01');
    expect(s.filter((d) => d.type === 'bilan_intermediaire').map((d) => d.titre)).toEqual(['Bilan M+3']);
    expect(s[s.length - 1].type).toBe('bilan_sortie');
  });

  it('milestoneLabel : titre > label du type > type brut', () => {
    expect(milestoneLabel({ milestone_type: 'bilan_intermediaire', titre: 'Bilan n° 4' })).toBe('Bilan n° 4');
    expect(milestoneLabel({ milestone_type: 'bilan_sortie' })).toBe('Bilan de sortie');
    expect(milestoneLabel({ milestone_type: 'inconnu' })).toBe('inconnu');
  });
});

describe('insertion/engine — computeCddiCumulativeMonths (item 41)', () => {
  it('somme un unique contrat CDDI de 6 mois (~6)', () => {
    const r = computeCddiCumulativeMonths(
      [{ contract_type: 'CDDI', start_date: '2026-01-01', end_date: '2026-07-01' }],
      new Date('2026-09-01')
    );
    expect(r.count).toBe(1);
    expect(r.months_total).toBeGreaterThan(5.5);
    expect(r.months_total).toBeLessThan(6.5);
  });

  it('ignore les contrats non CDDI', () => {
    const r = computeCddiCumulativeMonths([
      { contract_type: 'CDD', start_date: '2020-01-01', end_date: '2024-01-01' },
      { contract_type: 'CDI', start_date: '2020-01-01', end_date: null },
    ]);
    expect(r.count).toBe(0);
    expect(r.months_total).toBe(0);
  });

  it('fusionne les chevauchements (ne double compte pas un mois couvert deux fois)', () => {
    const r = computeCddiCumulativeMonths([
      { contract_type: 'CDDI', start_date: '2026-01-01', end_date: '2026-12-31' },
      { contract_type: 'CDDI', start_date: '2026-06-01', end_date: '2027-05-31' },
    ]);
    // Intervalle fusionné 2026-01-01 → 2027-05-31 ≈ 17 mois (et non ~24).
    expect(r.months_total).toBeGreaterThan(15);
    expect(r.months_total).toBeLessThan(19);
  });

  it('additionne deux périodes CDDI disjointes (cap 24 approché)', () => {
    const r = computeCddiCumulativeMonths([
      { contract_type: 'CDDI', start_date: '2024-01-01', end_date: '2024-12-31' },
      { contract_type: 'CDDI', start_date: '2026-01-01', end_date: '2026-12-31' },
    ]);
    expect(r.months_total).toBeGreaterThan(23);
    expect(r.months_total).toBeLessThan(25);
  });

  it('distingue durée contractuelle totale et durée déjà écoulée pour un contrat en cours', () => {
    const r = computeCddiCumulativeMonths(
      [{ contract_type: 'CDDI', start_date: '2026-01-01', end_date: '2027-12-31' }],
      new Date('2026-07-01')
    );
    expect(r.months_total).toBeGreaterThan(23); // ~24 (jusqu'à la fin contractuelle)
    expect(r.months_elapsed).toBeGreaterThan(5);
    expect(r.months_elapsed).toBeLessThan(7); // ~6 (jusqu'à asOf)
  });

  it('contrat CDDI en cours (fin nulle) → borné à asOf', () => {
    const r = computeCddiCumulativeMonths(
      [{ contract_type: 'cddi', start_date: '2026-01-01', end_date: null }],
      new Date('2026-04-01')
    );
    expect(r.months_total).toBeGreaterThan(2.5);
    expect(r.months_total).toBeLessThan(3.5);
  });
});

// ── Mock pg minimal pour resyncMilestones ────────────────────────────────────
// (extension 2026-07 : le SELECT des jalons porte aussi titre/locked_at et
// filtre le parcours courant — le matcher suit la nouvelle requête)
function makeMockDb({ employee, milestones }) {
  const calls = [];
  let insertId = 1000;
  const db = {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM employees e/i.test(sql) && /insertion_status/i.test(sql)) {
        return { rows: employee ? [employee] : [] };
      }
      if (/SELECT id, milestone_type, titre, due_date, status, locked_at/i.test(sql)) {
        return { rows: milestones || [] };
      }
      if (/UPDATE insertion_milestones SET due_date/i.test(sql)) return { rows: [] };
      if (/INSERT INTO insertion_milestones/i.test(sql)) return { rows: [{ id: ++insertId }] };
      return { rows: [] };
    },
  };
  return db;
}

describe('insertion/engine — resyncMilestones (item 41c, types techniques 2026-07)', () => {
  const START = '2026-01-01';
  const OLD_END = '2026-07-01'; // contrat 6 mois
  const NEW_END = '2027-01-01'; // prolongé à 12 mois

  it('ne fait rien si le parcours n’est pas « en_parcours »', async () => {
    const db = makeMockDb({ employee: { insertion_status: 'termine', parcours_num: 1 } });
    const r = await resyncMilestones(db, 1);
    expect(r.skipped).toBe('not_en_parcours');
    // Une seule requête (le SELECT employé), pas de lecture des jalons.
    expect(db.calls.length).toBe(1);
  });

  it('ne fait rien si le parcours n’a aucun jalon (laisse /initialize)', async () => {
    const db = makeMockDb({
      employee: { insertion_status: 'en_parcours', parcours_num: 1, insertion_start_date: START, c_end: NEW_END },
      milestones: [],
    });
    const r = await resyncMilestones(db, 1);
    expect(r.skipped).toBe('not_initialized');
  });

  it('repousse le bilan de sortie non réalisé et complète les bilans devenus applicables, sans toucher les réalisés', async () => {
    // Jalons initiaux calés sur le contrat 6 mois, seedés depuis le moteur
    // (types techniques + titres — l'appariement des bilans intermédiaires se
    // fait par titre).
    const oldSchedule = computeMilestoneSchedule(START, OLD_END);
    const milestones = oldSchedule.map((d, i) => ({
      id: i + 1,
      milestone_type: d.type,
      titre: d.titre,
      due_date: d.due,
      status: d.type === 'diagnostic_accueil' ? 'realise' : 'a_planifier',
      locked_at: null,
    }));

    const db = makeMockDb({
      employee: { insertion_status: 'en_parcours', parcours_num: 1, insertion_start_date: START, c_start: START, c_end: NEW_END },
      milestones,
    });
    const r = await resyncMilestones(db, 42, { userId: 7 });

    // Bilan de sortie déplacé sur la nouvelle échéance.
    expect(r.updated.map((u) => u.type)).toContain('bilan_sortie');
    // Bilans intermédiaires devenus applicables (contrat 6→12 mois) créés,
    // identifiés par leur TITRE (le type est partagé).
    expect(r.created.every((c) => c.type === 'bilan_intermediaire')).toBe(true);
    expect(r.created.map((c) => c.titre)).toEqual(expect.arrayContaining(['Bilan M+6', 'Bilan M+10']));
    // Le diagnostic d'accueil réalisé n’est jamais mis à jour.
    const updatedDiag = db.calls.some(
      (c) => /UPDATE insertion_milestones SET due_date/i.test(c.sql) && c.params && c.params[1] === 1
    );
    expect(updatedDiag).toBe(false);
  });

  it('ne touche jamais un entretien VERROUILLÉ (locked_at — clôture probante)', async () => {
    const schedule = computeMilestoneSchedule(START, NEW_END);
    const milestones = schedule.map((d, i) => ({
      id: i + 1, milestone_type: d.type, titre: d.titre,
      due_date: '2020-01-01', // volontairement faux → recalable
      status: 'planifie',
      locked_at: i === 0 ? '2026-02-01T10:00:00Z' : null, // 1er verrouillé
    }));
    const db = makeMockDb({
      employee: { insertion_status: 'en_parcours', parcours_num: 1, insertion_start_date: START, c_end: NEW_END },
      milestones,
    });
    const r = await resyncMilestones(db, 1);
    expect(r.updated.map((u) => u.id)).not.toContain(1);
  });

  it('est idempotent : un 2e passage sur le contrat déjà recalé ne change rien', async () => {
    const newSchedule = computeMilestoneSchedule(START, NEW_END);
    const milestones = newSchedule.map((d, i) => ({
      id: i + 1, milestone_type: d.type, titre: d.titre, due_date: d.due, status: 'a_planifier', locked_at: null,
    }));
    const db = makeMockDb({
      employee: { insertion_status: 'en_parcours', parcours_num: 1, insertion_start_date: START, c_end: NEW_END },
      milestones,
    });
    const r = await resyncMilestones(db, 1);
    expect(r.updated).toHaveLength(0);
    expect(r.created).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOT 8 (2026-07 PR3) — helpers PURS de co-construction & période d'essai
// ═══════════════════════════════════════════════════════════════════════════
describe('insertion/engine — computeLearningStyle (Kolb, EXG-32)', () => {
  const A24 = Array(24).fill('A');
  const B24 = Array(24).fill('B');

  it('les 4 profils sont produits de façon déterministe', () => {
    // 1re moitié = perception (A=CE, B=AC), 2e moitié = traitement (A=AE, B=RO)
    expect(computeLearningStyle(A24)).toBe('adaptateur');                                   // CE + AE
    expect(computeLearningStyle([...Array(12).fill('A'), ...Array(12).fill('B')])).toBe('divergeur');     // CE + RO
    expect(computeLearningStyle(B24)).toBe('assimilateur');                                  // AC + RO
    expect(computeLearningStyle([...Array(12).fill('B'), ...Array(12).fill('A')])).toBe('convergeur');    // AC + AE
  });

  it('accepte un objet indexé 1..N et normalise la casse', () => {
    const obj = {};
    for (let i = 1; i <= 24; i++) obj[i] = i <= 12 ? 'a' : 'b';
    expect(computeLearningStyle(obj)).toBe('divergeur');
  });

  it('entrée invalide → null', () => {
    expect(computeLearningStyle(null)).toBeNull();
    expect(computeLearningStyle([])).toBeNull();
    expect(computeLearningStyle(['A'])).toBeNull();
  });
});

describe('insertion/engine — competenceAverage (N/E exclu, EXG-27)', () => {
  it('exclut les N/E (non_evalue) et les notes nulles de la moyenne', () => {
    const scores = [
      { note: 7, non_evalue: false },
      { note: null, non_evalue: true },   // N/E → exclu
      { note: 9, non_evalue: false },
      { note: '', non_evalue: false },     // vide → exclu (compté N/E)
    ];
    expect(competenceAverage(scores)).toEqual({ moyenne: 8, n_notes: 2, n_ne: 2 });
  });

  it('aucune note évaluée → moyenne null', () => {
    expect(competenceAverage([{ non_evalue: true }, { note: null }])).toEqual({ moyenne: null, n_notes: 0, n_ne: 2 });
    expect(competenceAverage([])).toEqual({ moyenne: null, n_notes: 0, n_ne: 0 });
  });

  it('arrondi à 1 décimale', () => {
    expect(competenceAverage([{ note: 8 }, { note: 9 }, { note: 9 }]).moyenne).toBe(8.7);
  });
});

describe('insertion/engine — ensurePeriodeEssaiMilestone (EXG-30, idempotent)', () => {
  it('crée le jalon à start + joursEssai quand aucun n\'existe', async () => {
    const calls = [];
    const db = { query: (sql, params) => {
      calls.push({ sql: String(sql), params });
      if (/milestone_type = 'periode_essai' LIMIT 1/.test(String(sql))) return Promise.resolve({ rows: [] });
      if (/INSERT INTO insertion_milestones/.test(String(sql))) return Promise.resolve({ rows: [{ id: 7, due_date: params[3] }] });
      return Promise.resolve({ rows: [] });
    } };
    const r = await ensurePeriodeEssaiMilestone(db, 5, { parcoursNum: 1, startDate: '2026-01-01', joursEssai: 30, userId: 2 });
    expect(r.id).toBe(7);
    const ins = calls.find((c) => /INSERT INTO insertion_milestones/.test(c.sql));
    expect(ins.params[3]).toBe('2026-01-31');                    // due = start + 30 j
    expect(ins.params[2]).toBe(MILESTONE_TYPE_LABELS.periode_essai);
  });

  it('idempotent : ne recrée pas si un jalon période d\'essai existe déjà', async () => {
    const db = { query: (sql) => {
      if (/milestone_type = 'periode_essai' LIMIT 1/.test(String(sql))) return Promise.resolve({ rows: [{ id: 3 }] });
      throw new Error('INSERT ne doit pas être appelé');
    } };
    const r = await ensurePeriodeEssaiMilestone(db, 5, { startDate: '2026-01-01' });
    expect(r.id).toBe(3);
  });
});

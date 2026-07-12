const {
  computeMilestoneSchedule,
  computeCddiCumulativeMonths,
  resyncMilestones,
} = require('../../../src/routes/insertion/engine');

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
      if (/SELECT id, milestone_type, due_date, status FROM insertion_milestones/i.test(sql)) {
        return { rows: milestones || [] };
      }
      if (/UPDATE insertion_milestones SET due_date/i.test(sql)) return { rows: [] };
      if (/INSERT INTO insertion_milestones/i.test(sql)) return { rows: [{ id: ++insertId }] };
      return { rows: [] };
    },
  };
  return db;
}

describe('insertion/engine — resyncMilestones (item 41c)', () => {
  const START = '2026-01-01';
  const OLD_END = '2026-07-01'; // contrat 6 mois
  const NEW_END = '2027-01-01'; // prolongé à 12 mois

  it('ne fait rien si le parcours n’est pas « en_parcours »', async () => {
    const db = makeMockDb({ employee: { insertion_status: 'termine' } });
    const r = await resyncMilestones(db, 1);
    expect(r.skipped).toBe('not_en_parcours');
    // Une seule requête (le SELECT employé), pas de lecture des jalons.
    expect(db.calls.length).toBe(1);
  });

  it('ne fait rien si le parcours n’a aucun jalon (laisse /initialize)', async () => {
    const db = makeMockDb({
      employee: { insertion_status: 'en_parcours', insertion_start_date: START, c_end: NEW_END },
      milestones: [],
    });
    const r = await resyncMilestones(db, 1);
    expect(r.skipped).toBe('not_initialized');
  });

  it('repousse le Bilan Sortie non réalisé et complète les jalons devenus applicables, sans toucher les réalisés', async () => {
    // Jalons initiaux calés sur le contrat 6 mois, seedés depuis le moteur.
    const oldSchedule = computeMilestoneSchedule(START, OLD_END);
    const milestones = oldSchedule.map((d, i) => ({
      id: i + 1,
      milestone_type: d.type,
      due_date: d.due,
      status: d.type === 'Diagnostic accueil' ? 'realise' : 'a_planifier',
    }));

    const db = makeMockDb({
      employee: { insertion_status: 'en_parcours', insertion_start_date: START, c_start: START, c_end: NEW_END },
      milestones,
    });
    const r = await resyncMilestones(db, 42, { userId: 7 });

    // Bilan Sortie déplacé sur la nouvelle échéance.
    expect(r.updated.map((u) => u.type)).toContain('Bilan Sortie');
    // Jalons intermédiaires devenus applicables (contrat 6→12 mois) créés.
    const createdTypes = r.created.map((c) => c.type);
    expect(createdTypes).toEqual(expect.arrayContaining(['Bilan M+6', 'Bilan M+10']));
    // Le Diagnostic accueil réalisé n’est jamais mis à jour.
    const updatedDiag = db.calls.some(
      (c) => /UPDATE insertion_milestones SET due_date/i.test(c.sql) && c.params && c.params[1] === 1
    );
    expect(updatedDiag).toBe(false);
  });

  it('est idempotent : un 2e passage sur le contrat déjà recalé ne change rien', async () => {
    const newSchedule = computeMilestoneSchedule(START, NEW_END);
    const milestones = newSchedule.map((d, i) => ({
      id: i + 1, milestone_type: d.type, due_date: d.due, status: 'a_planifier',
    }));
    const db = makeMockDb({
      employee: { insertion_status: 'en_parcours', insertion_start_date: START, c_end: NEW_END },
      milestones,
    });
    const r = await resyncMilestones(db, 1);
    expect(r.updated).toHaveLength(0);
    expect(r.created).toHaveLength(0);
  });
});

// Tests QHSE (item 58, Vague 2) — taux TF1/TG, statut d'habilitation calculé,
// et synchro non destructive des booléens has_caces / has_permis_b.
const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: async () => ({ query: (...a) => mockQuery(...a), release: () => {} }),
}));
jest.mock('../../../src/middleware/auth', () => ({
  authenticate: (req, res, next) => next(),
  authorize: () => (req, res, next) => next(),
}));

const qhse = require('../../../src/routes/qhse');
const { computeTauxFrequence, computeTauxGravite, habilitationStatut, syncEmployeeCertBooleans } = qhse;

describe('computeTauxFrequence (TF1)', () => {
  it('applique (AT avec arrêt × 1 000 000) / heures travaillées', () => {
    // 2 accidents avec arrêt sur 100 000 h → TF1 = 20
    expect(computeTauxFrequence(2, 100000)).toBe(20);
  });
  it('arrondit à 2 décimales', () => {
    expect(computeTauxFrequence(1, 148000)).toBe(6.76);
  });
  it('retourne null si les heures sont indisponibles (0)', () => {
    expect(computeTauxFrequence(3, 0)).toBeNull();
  });
  it('retourne 0 en l’absence d’accident', () => {
    expect(computeTauxFrequence(0, 100000)).toBe(0);
  });
});

describe('computeTauxGravite (TG)', () => {
  it('applique (jours d’arrêt × 1 000) / heures travaillées', () => {
    // 50 jours d'arrêt sur 100 000 h → TG = 0.5
    expect(computeTauxGravite(50, 100000)).toBe(0.5);
  });
  it('retourne null si heures = 0', () => {
    expect(computeTauxGravite(50, 0)).toBeNull();
  });
});

describe('habilitationStatut (statut calculé)', () => {
  const today = new Date('2026-07-12T00:00:00');
  const plus = (d) => { const x = new Date(today); x.setDate(x.getDate() + d); return x; };

  it('sans date d’expiration → sans_echeance', () => {
    expect(habilitationStatut(null, today)).toEqual({ statut: 'sans_echeance', jours_restants: null });
  });
  it('date passée → expiree (badge rouge)', () => {
    expect(habilitationStatut(plus(-1), today)).toEqual({ statut: 'expiree', jours_restants: -1 });
  });
  it('expire aujourd’hui → expire_60 (pas encore expirée)', () => {
    expect(habilitationStatut(plus(0), today)).toEqual({ statut: 'expire_60', jours_restants: 0 });
  });
  it('borne 60 jours incluse → expire_60 (badge ambre)', () => {
    expect(habilitationStatut(plus(60), today).statut).toBe('expire_60');
  });
  it('61 à 90 jours → expire_90', () => {
    expect(habilitationStatut(plus(61), today).statut).toBe('expire_90');
    expect(habilitationStatut(plus(90), today).statut).toBe('expire_90');
  });
  it('au-delà de 90 jours → valide', () => {
    expect(habilitationStatut(plus(91), today).statut).toBe('valide');
  });
});

describe('syncEmployeeCertBooleans (synchro non destructive)', () => {
  // db factice : renvoie des lignes SELECT préprogrammées et capture les UPDATE.
  function makeDb(responses) {
    const calls = [];
    const q = jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/^\s*SELECT/i.test(sql)) return responses.shift();
      return { rows: [] };
    });
    return { query: q, calls };
  }
  const updateCalls = (db, col) => db.calls.filter((c) => /UPDATE employees/i.test(c.sql) && c.sql.includes(col));

  it('ne fait aucune requête si employeeId est absent', async () => {
    const db = makeDb([]);
    await syncEmployeeCertBooleans(db, null);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('promeut has_caces à true si une habilitation CACES est valide', async () => {
    // 1er SELECT (CACES) : total 2, valid 1 → UPDATE true ; 2e SELECT (permis) : total 0 → pas d’UPDATE
    const db = makeDb([{ rows: [{ total: 2, valid: 1 }] }, { rows: [{ total: 0, valid: 0 }] }]);
    await syncEmployeeCertBooleans(db, 42);
    const c = updateCalls(db, 'has_caces');
    expect(c).toHaveLength(1);
    expect(c[0].params).toEqual([true, 42]);
    // permis : aucune habilitation → on ne touche PAS has_permis_b (valeur import préservée)
    expect(updateCalls(db, 'has_permis_b')).toHaveLength(0);
  });

  it('rétrograde has_caces à false si toutes les habilitations CACES sont expirées', async () => {
    const db = makeDb([{ rows: [{ total: 1, valid: 0 }] }, { rows: [{ total: 0, valid: 0 }] }]);
    await syncEmployeeCertBooleans(db, 7);
    const c = updateCalls(db, 'has_caces');
    expect(c).toHaveLength(1);
    expect(c[0].params).toEqual([false, 7]);
  });

  it('ne touche aucun booléen si le salarié n’a aucune habilitation QHSE (import préservé)', async () => {
    const db = makeDb([{ rows: [{ total: 0, valid: 0 }] }, { rows: [{ total: 0, valid: 0 }] }]);
    await syncEmployeeCertBooleans(db, 9);
    expect(updateCalls(db, 'has_caces')).toHaveLength(0);
    expect(updateCalls(db, 'has_permis_b')).toHaveLength(0);
  });

  it('promeut has_permis_b à true si un permis est valide', async () => {
    const db = makeDb([{ rows: [{ total: 0, valid: 0 }] }, { rows: [{ total: 1, valid: 1 }] }]);
    await syncEmployeeCertBooleans(db, 5);
    const c = updateCalls(db, 'has_permis_b');
    expect(c).toHaveLength(1);
    expect(c[0].params).toEqual([true, 5]);
  });
});

describe('routeur QHSE', () => {
  it('expose un routeur Express montable', () => {
    expect(typeof qhse).toBe('function');
  });
  it('expose les référentiels d’enum', () => {
    expect(qhse.EVENT_TYPES).toContain('accident_travail');
    expect(qhse.HAB_TYPES).toContain('caces_3');
    expect(qhse.EPI_TYPES).toContain('gilet_hv');
  });
});

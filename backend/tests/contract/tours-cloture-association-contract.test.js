// ═══════════════════════════════════════════════════════════════════════════
// CONTRAT — effets de clôture d'une tournée ASSOCIATION.
// ───────────────────────────────────────────────────────────────────────────
// Constat L4 du 26/08/2026 : les effets de clôture ne lisaient que `tour_cav`.
// Sur une tournée d'associations, le décompte des points collectés valait donc
// toujours zéro : `tonnage_history_association` n'était JAMAIS écrite (alors
// qu'elle alimente « dernière collecte » et « poids moyen 90 j » de la carte
// des associations), et le mouvement de stock annonçait « 0 CAV collectés ».
// ═══════════════════════════════════════════════════════════════════════════
const mockQuery = jest.fn();
jest.mock('../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
  connect: jest.fn(async () => ({ query: (...a) => mockQuery(...a), release: () => {} })),
}));

const mockPredict = jest.fn();
jest.mock('../../src/routes/tours/predictions', () => ({
  predictAssociationFillRate: (...a) => mockPredict(...a),
}));

const { applyCompletionSideEffects, libelleCollectes } = require('../../src/routes/tours/completion-effects');

const TOURNEE_ASSO = {
  id: 42, date: '2026-08-26', total_weight_kg: 900, vehicle_id: 3,
  collection_type: 'association', is_demo: false,
};
const TOURNEE_PAV = { ...TOURNEE_ASSO, collection_type: 'pav' };

/** Trace normalisée des requêtes émises, dans l'ordre. */
const trace = () => mockQuery.mock.calls.map((c) => ({
  sql: String(c[0]).replace(/\s+/g, ' ').trim(), params: c[1],
}));
const indexDe = (motif) => trace().findIndex((q) => motif.test(q.sql));

function base({ collectes = [1, 2, 3], niveaux = [] } = {}) {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/SELECT association_point_id AS point_id FROM tour_association_point/.test(s)) {
      return Promise.resolve({ rows: collectes.map((id) => ({ point_id: id })) });
    }
    if (/FROM tour_cav WHERE tour_id = \$1 AND status = 'collected'/.test(s)) {
      return Promise.resolve({ rows: [{ cav_id: 11 }, { cav_id: 12 }] });
    }
    if (/fill_level IS NOT NULL AND association_point_id IS NOT NULL/.test(s)) {
      return Promise.resolve({ rows: niveaux });
    }
    if (/predicted_fill_rate IS NOT NULL/.test(s)) {
      return Promise.resolve({ rows: [{ cav_id: 11, predicted_fill_rate: 80, fill_level: 4 }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => { mockQuery.mockReset(); mockPredict.mockReset(); });

describe('tonnage des points association', () => {
  it('répartit le poids pesé sur les points RÉELLEMENT collectés', async () => {
    base({ collectes: [1, 2, 3] });
    await applyCompletionSideEffects(TOURNEE_ASSO, 42, 1);

    const inserts = trace().filter((q) => /INSERT INTO tonnage_history_association/.test(q.sql));
    expect(inserts).toHaveLength(3);
    // 900 kg / 3 points = 300 kg chacun, rattachés à la tournée (idempotence).
    expect(inserts.map((q) => q.params)).toEqual([
      [1, '2026-08-26', 300, 42],
      [2, '2026-08-26', 300, 42],
      [3, '2026-08-26', 300, 42],
    ]);
    // Aucune ligne n'est écrite dans l'historique des BORNES.
    expect(trace().some((q) => /INSERT INTO tonnage_history \(/.test(q.sql))).toBe(false);
  });

  it('un poids nul n’invente aucune ligne d’historique', async () => {
    base();
    await applyCompletionSideEffects({ ...TOURNEE_ASSO, total_weight_kg: 0 }, 42, 1);
    expect(trace().some((q) => /INSERT INTO tonnage_history_association/.test(q.sql))).toBe(false);
    expect(trace().some((q) => /INSERT INTO stock_movements/.test(q.sql))).toBe(false);
  });

  it('une tournée close sans aucun point collecté n’écrit pas de tonnage', async () => {
    base({ collectes: [] });
    await applyCompletionSideEffects(TOURNEE_ASSO, 42, 1);
    expect(trace().some((q) => /INSERT INTO tonnage_history_association/.test(q.sql))).toBe(false);
    // Le mouvement de stock reste écrit : le camion a bien été pesé.
    expect(trace().some((q) => /INSERT INTO stock_movements/.test(q.sql))).toBe(true);
  });

  it('une tournée de DÉMO n’écrit toujours rien', async () => {
    base();
    await applyCompletionSideEffects({ ...TOURNEE_ASSO, is_demo: true }, 42, 1);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('libellé du mouvement de stock', () => {
  it('dit combien de POINTS ASSOCIATION ont été collectés, plus « 0 CAV »', async () => {
    base({ collectes: [1, 2, 3] });
    await applyCompletionSideEffects(TOURNEE_ASSO, 42, 1);
    const stock = trace().find((q) => /INSERT INTO stock_movements/.test(q.sql));
    expect(stock.params[4]).toBe('Auto: tournée #42 (3 point(s) association collecté(s))');
    const original = trace().find((q) => /INSERT INTO stock_original_movements/.test(q.sql));
    expect(original.params[4]).toBe('collecte_association');
    expect(original.params[5]).toMatch(/3 point\(s\) association/);
  });

  it('non-régression : une tournée de bornes garde son libellé et son historique', async () => {
    base();
    await applyCompletionSideEffects(TOURNEE_PAV, 42, 1);
    const stock = trace().find((q) => /INSERT INTO stock_movements/.test(q.sql));
    expect(stock.params[4]).toBe('Auto: tournée #42 (2 CAV collectés)');
    expect(trace().filter((q) => /INSERT INTO tonnage_history \(/.test(q.sql))).toHaveLength(2);
    expect(trace().some((q) => /INSERT INTO collection_learning_feedback/.test(q.sql))).toBe(true);
    expect(trace().some((q) => /INSERT INTO tonnage_history_association/.test(q.sql))).toBe(false);
  });

  it('le libellé est une fonction pure, testable seule', () => {
    expect(libelleCollectes(TOURNEE_ASSO, 4)).toBe('4 point(s) association collecté(s)');
    expect(libelleCollectes(TOURNEE_PAV, 4)).toBe('4 CAV collectés');
  });
});

describe('apprentissage des points association', () => {
  it('enregistre prédit vs observé quand le moteur a un historique', async () => {
    base({ niveaux: [{ association_point_id: 2, fill_level: 4 }] });
    mockPredict.mockResolvedValue({ fill: 62.5, confidence: 0.5, method: 'historical' });
    await applyCompletionSideEffects(TOURNEE_ASSO, 42, 1);

    const fb = trace().find((q) => /INSERT INTO association_learning_feedback/.test(q.sql));
    expect(fb).toBeDefined();
    expect(fb.params).toEqual([42, 2, 62.5, 4]);
    expect(mockPredict).toHaveBeenCalledWith(2, '2026-08-26');
  });

  it('la prédiction est relevée AVANT l’écriture des tonnages de la tournée', async () => {
    base({ niveaux: [{ association_point_id: 2, fill_level: 4 }] });
    mockPredict.mockResolvedValue({ fill: 62.5, method: 'historical' });
    await applyCompletionSideEffects(TOURNEE_ASSO, 42, 1);
    // Sinon le moteur se comparerait à la collecte qu'on est en train d'écrire.
    expect(indexDe(/INSERT INTO association_learning_feedback/))
      .toBeLessThan(indexDe(/INSERT INTO tonnage_history_association/));
  });

  it('sans historique, le repli du moteur n’est PAS enregistré comme une prédiction', async () => {
    base({ niveaux: [{ association_point_id: 2, fill_level: 4 }] });
    mockPredict.mockResolvedValue({ fill: 50, confidence: 0.2, method: 'default' });
    await applyCompletionSideEffects(TOURNEE_ASSO, 42, 1);
    expect(trace().some((q) => /INSERT INTO association_learning_feedback/.test(q.sql))).toBe(false);
  });

  it('un moteur en échec ne fait jamais échouer la clôture', async () => {
    base({ niveaux: [{ association_point_id: 2, fill_level: 4 }] });
    mockPredict.mockRejectedValue(new Error('moteur indisponible'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(applyCompletionSideEffects(TOURNEE_ASSO, 42, 1)).resolves.toBeUndefined();
    expect(trace().some((q) => /INSERT INTO tonnage_history_association/.test(q.sql))).toBe(true);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/Apprentissage association non enregistré/);
    warn.mockRestore();
  });

  it('aucun niveau saisi : aucun apprentissage inventé', async () => {
    base({ niveaux: [] });
    await applyCompletionSideEffects(TOURNEE_ASSO, 42, 1);
    expect(mockPredict).not.toHaveBeenCalled();
    expect(trace().some((q) => /INSERT INTO association_learning_feedback/.test(q.sql))).toBe(false);
  });
});

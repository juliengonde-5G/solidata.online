/**
 * Tests du timer dédié « sync SumUp live » (demande client : les jours de VAK,
 * synchronisation automatique toutes les 5 minutes ; hors VAK, une seule sync
 * par 24 h — le rattrapage horaire est supprimé).
 *
 * Vérifie la logique de vakLiveSyncTick :
 *  - hors jour de VAK (date civile Paris) → no-op TOTAL (pas d'appel SumUp,
 *    aucune ligne job_runs → zéro bruit de supervision ~27 jours/mois) ;
 *  - VAK active mais SumUp non connecté → no-op (pas de sync, pas de journal) ;
 *  - VAK active + connecté → sync exécutée ET journalisée sous le nom dédié
 *    `syncVakSumUpLive` (job_runs) ;
 *  - garde de réentrance : un run encore en cours → le tick suivant est sauté
 *    (jamais d'empilement si une sync dure > 5 min).
 */

const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
}));

const mockSumup = {
  getConnectionStatus: jest.fn(),
  syncTransactionsFromApi: jest.fn(),
};
jest.mock('../../../src/services/sumup', () => mockSumup);

// Mock global fetch (Brevo & co, requis par le module scheduler)
global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({}) });

const scheduler = require('../../../src/services/scheduler');

// Renvoie les INSERT INTO job_runs capturés (journal d'instrumentation).
function jobRunInserts() {
  return mockQuery.mock.calls.filter((c) => typeof c[0] === 'string' && /INSERT INTO job_runs/.test(c[0]));
}

describe('vakLiveSyncTick — sync SumUp 5 min les jours de VAK', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockSumup.getConnectionStatus.mockReset();
    mockSumup.syncTransactionsFromApi.mockReset();
  });

  test('hors jour de VAK → no-op total (pas d\'appel SumUp, pas de job_runs)', async () => {
    // La requête « VAK active à la date civile de Paris ? » ne renvoie rien.
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const r = await scheduler.vakLiveSyncTick();

    expect(r).toEqual({ skipped: 'no_active_vak' });
    // La détection utilise bien la date civile PARIS (pas CURRENT_DATE UTC).
    expect(mockQuery.mock.calls[0][0]).toContain("AT TIME ZONE 'Europe/Paris'");
    expect(mockSumup.getConnectionStatus).not.toHaveBeenCalled();
    expect(mockSumup.syncTransactionsFromApi).not.toHaveBeenCalled();
    expect(jobRunInserts()).toHaveLength(0);
  });

  test('VAK active mais SumUp non connecté → no-op (aucune sync, aucun journal)', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM vaks/.test(sql)) return Promise.resolve({ rows: [{ '?column?': 1 }] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mockSumup.getConnectionStatus.mockResolvedValue({ connected: false });

    const r = await scheduler.vakLiveSyncTick();

    expect(r).toEqual({ skipped: 'not_connected' });
    expect(mockSumup.syncTransactionsFromApi).not.toHaveBeenCalled();
    expect(jobRunInserts()).toHaveLength(0);
  });

  test('VAK active + connecté → sync exécutée, journalisée sous `syncVakSumUpLive`', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM vaks/.test(sql)) return Promise.resolve({ rows: [{ '?column?': 1 }] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mockSumup.getConnectionStatus.mockResolvedValue({ connected: true });
    mockSumup.syncTransactionsFromApi.mockResolvedValue({ received: 3, inserted: 2, skipped: 1 });

    const r = await scheduler.vakLiveSyncTick();

    expect(r).toEqual({ ran: true });
    expect(mockSumup.syncTransactionsFromApi).toHaveBeenCalledTimes(1);
    const inserts = jobRunInserts();
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][0]).toBe('syncVakSumUpLive'); // nom de job dédié (JOB_SCHEDULE)
    expect(inserts[0][1][3]).toBe('success');
  });

  test('garde de réentrance : un run en cours → le tick suivant est sauté', async () => {
    let resolveVakQuery;
    const pending = new Promise((resolve) => { resolveVakQuery = resolve; });
    mockQuery.mockImplementation((sql) => {
      if (/FROM vaks/.test(sql)) return pending; // 1er tick bloqué sur la requête
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const tick1 = scheduler.vakLiveSyncTick();          // démarre, reste en cours
    const r2 = await scheduler.vakLiveSyncTick();       // pendant ce temps…
    expect(r2).toEqual({ skipped: 'already_running' }); // …pas d'empilement

    resolveVakQuery({ rows: [], rowCount: 0 });         // libère le 1er tick
    const r1 = await tick1;
    expect(r1).toEqual({ skipped: 'no_active_vak' });

    // Une fois le run terminé, le tick suivant repart normalement.
    const r3 = await scheduler.vakLiveSyncTick();
    expect(r3).toEqual({ skipped: 'no_active_vak' });
  });
});

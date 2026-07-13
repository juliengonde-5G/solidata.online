// Tests du wrapper d'instrumentation runInstrumented (Vague 3 — item 3.D-1 a/b) :
// journalisation job_runs, extraction du volume, capture d'erreur, timeout,
// et résilience (un échec de journalisation ne casse pas le job).
const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
jest.mock('../../../src/config/database', () => ({
  query: (...a) => mockQuery(...a),
}));
global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({}) });

const { runInstrumented } = require('../../../src/services/scheduler');

function findJobRunsInsert() {
  return mockQuery.mock.calls.find((c) => typeof c[0] === 'string' && /INSERT INTO job_runs/.test(c[0]));
}

describe('runInstrumented — journal + timeout', () => {
  afterEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('journalise un succès et déduit items_processed du retour', async () => {
    const r = await runInstrumented('jobOK', async () => ({ inserted: 5 }));
    expect(r.status).toBe('success');
    expect(r.itemsProcessed).toBe(5);

    const insert = findJobRunsInsert();
    expect(insert).toBeTruthy();
    expect(insert[1][0]).toBe('jobOK');    // job_name
    expect(insert[1][3]).toBe('success');  // status
    expect(insert[1][5]).toBe(5);          // items_processed
    expect(typeof insert[1][6]).toBe('number'); // duration_ms
  });

  it('items_processed = null quand le job ne renvoie pas de compteur', async () => {
    const r = await runInstrumented('jobNoCount', async () => undefined);
    expect(r.status).toBe('success');
    expect(r.itemsProcessed).toBeNull();
    expect(findJobRunsInsert()[1][5]).toBeNull();
  });

  it('capture une erreur (status error) sans la propager', async () => {
    const r = await runInstrumented('jobKO', async () => { throw new Error('boom SQL'); });
    expect(r.status).toBe('error');
    const insert = findJobRunsInsert();
    expect(insert[1][3]).toBe('error');
    expect(insert[1][4]).toMatch(/boom SQL/); // error_message
  });

  it('déclenche un timeout borné et journalise status=timeout', async () => {
    // fn plus lente (80 ms) que le timeout (15 ms) → la chaîne reprend la main.
    const r = await runInstrumented('jobSlow', () => new Promise((res) => setTimeout(res, 80)), 15);
    expect(r.status).toBe('timeout');
    expect(findJobRunsInsert()[1][3]).toBe('timeout');
  });

  it('résilient : un échec de journalisation job_runs ne casse pas le job', async () => {
    mockQuery.mockImplementation((sql) =>
      /INSERT INTO job_runs/.test(sql)
        ? Promise.reject(new Error('relation "job_runs" does not exist'))
        : Promise.resolve({ rows: [], rowCount: 0 })
    );
    const r = await runInstrumented('jobResil', async () => 3);
    expect(r.status).toBe('success');
    expect(r.itemsProcessed).toBe(3);
  });
});

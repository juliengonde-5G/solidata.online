const mockQuery = jest.fn();
jest.mock('../../../src/config/database', () => ({
  query: (...args) => mockQuery(...args),
}));

// Mock global fetch pour les appels Brevo
global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({}) });

describe('Scheduler', () => {
  let scheduler;

  beforeAll(() => {
    scheduler = require('../../../src/services/scheduler');
  });

  afterEach(() => {
    mockQuery.mockReset();
  });

  describe('runAllJobs', () => {
    it('should acquire lock before running jobs', async () => {
      // Mock advisory lock acquisition
      mockQuery
        .mockResolvedValueOnce({ rows: [{ acquired: true }] }) // pg_try_advisory_lock
        // Mocks for each job (they all query the DB)
        .mockResolvedValue({ rows: [], rowCount: 0 });

      await scheduler.runAllJobs();

      // First call should be the advisory lock
      expect(mockQuery.mock.calls[0][0]).toContain('pg_try_advisory_lock');
    });

    it('should skip execution if lock not acquired', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ acquired: false }] });

      await scheduler.runAllJobs();

      // Only the lock query should have been called
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });
});

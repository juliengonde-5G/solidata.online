const { applyPagination } = require('../../../src/utils/pagination');

describe('Pagination Utility', () => {
  it('should append LIMIT to query', () => {
    const result = applyPagination('SELECT * FROM users', [], { limit: 10 });
    expect(result.query).toContain('LIMIT $1');
    expect(result.params).toEqual([10]);
  });

  it('should append LIMIT and OFFSET to query', () => {
    const result = applyPagination('SELECT * FROM users', [], { limit: 10, offset: 20 });
    expect(result.query).toContain('LIMIT $1');
    expect(result.query).toContain('OFFSET $2');
    expect(result.params).toEqual([10, 20]);
  });

  it('should not modify query when no options provided', () => {
    const result = applyPagination('SELECT * FROM users', []);
    expect(result.query).toBe('SELECT * FROM users');
    expect(result.params).toEqual([]);
  });

  it('should handle existing params', () => {
    const result = applyPagination('SELECT * FROM users WHERE status = $1', ['active'], { limit: 5 });
    expect(result.query).toContain('LIMIT $2');
    expect(result.params).toEqual(['active', 5]);
  });
});

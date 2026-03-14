const { errorHandler, notFoundHandler } = require('../../../src/middleware/error-handler');

describe('Error Handler Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { method: 'GET', originalUrl: '/api/test', user: { id: 1 } };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it('should handle JSON parse errors', () => {
    const err = new Error('parse failed');
    err.type = 'entity.parse.failed';
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'JSON invalide dans le corps de la requête' }));
  });

  it('should handle file size limit errors', () => {
    const err = new Error('too large');
    err.code = 'LIMIT_FILE_SIZE';
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('should handle PostgreSQL duplicate key errors', () => {
    const err = new Error('duplicate');
    err.code = '23505';
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('should handle PostgreSQL foreign key errors', () => {
    const err = new Error('fk violation');
    err.code = '23503';
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should handle generic errors with 500 status', () => {
    const err = new Error('something went wrong');
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('should handle custom status codes', () => {
    const err = new Error('not found');
    err.statusCode = 404;
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('Not Found Handler', () => {
  it('should return 404 with path info', () => {
    const req = { originalUrl: '/api/nonexistent' };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    notFoundHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ path: '/api/nonexistent' }));
  });
});

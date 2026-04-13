'use strict';

const { notFound, errorHandler } = require('../../../middleware/error.middleware');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

jest.mock('../../../controllers/admin.controller', () => ({
  logAudit: jest.fn(),
  logError: jest.fn(),
}));

describe('error.middleware', () => {
  describe('notFound', () => {
    it('returns 404 with method and URL', () => {
      const req = mockReq({ method: 'GET', originalUrl: '/api/v1/unknown' });
      const res = mockRes();
      notFound(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res._json.message).toContain('GET');
      expect(res._json.message).toContain('/api/v1/unknown');
    });
  });

  describe('errorHandler', () => {
    it('handles Multer LIMIT_FILE_SIZE', () => {
      const multer = require('multer');
      const err = new multer.MulterError('LIMIT_FILE_SIZE');
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('tamaño');
    });

    it('handles Multer LIMIT_UNEXPECTED_FILE', () => {
      const multer = require('multer');
      const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
      err.message = 'Unexpected field';
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('handles validation errors', () => {
      const err = { type: 'validation', errors: [{ field: 'name' }] };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('handles MySQL ER_DUP_ENTRY', () => {
      const err = { code: 'ER_DUP_ENTRY', message: "Duplicate entry 'x' for key 'uq_username'" };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('handles MySQL ER_NO_REFERENCED_ROW_2', () => {
      const err = { code: 'ER_NO_REFERENCED_ROW_2', message: 'FK constraint' };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('handles generic 500 errors and logs', () => {
      const err = new Error('Something broke');
      const req = mockReq({ method: 'POST', originalUrl: '/api/test', user: { id: 1, username: 'admin', nombre: 'Admin' } });
      const res = mockRes();
      errorHandler(err, req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(500);
      const { logError } = require('../../../controllers/admin.controller');
      expect(logError).toHaveBeenCalled();
    });

    it('uses custom statusCode without calling logError for 4xx', () => {
      const err = new Error('Forbidden access');
      err.statusCode = 403;
      const req = mockReq({ method: 'GET', originalUrl: '/api/test', user: { id: 1, username: 'admin', nombre: 'Admin' } });
      const res = mockRes();
      const { logError } = require('../../../controllers/admin.controller');
      logError.mockClear();
      errorHandler(err, req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
      expect(logError).not.toHaveBeenCalled();
    });

    it('handles generic error without req.user (userId: null, userInfo: null)', () => {
      const err = new Error('Server error without user');
      const req = mockReq({ method: 'GET', originalUrl: '/api/test' }); // no user
      const res = mockRes();
      errorHandler(err, req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(500);
      const { logError } = require('../../../controllers/admin.controller');
      expect(logError).toHaveBeenCalledWith(expect.objectContaining({ userId: null, userInfo: null }));
    });

    it('falls back to campo when ER_DUP_ENTRY message has no key match', () => {
      const err = { code: 'ER_DUP_ENTRY', message: 'Duplicate entry without key pattern' };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res._json.message).toContain('campo');
    });

    it('falls back to generic message for unknown Multer error code', () => {
      const multer = require('multer');
      const err = new multer.MulterError('LIMIT_FIELD_COUNT');
      err.message = 'Too many fields';
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('Error de upload');
    });

    it('includes stack in response when NODE_ENV=development', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        const err = new Error('Dev error');
        err.stack = 'Error: Dev error\n  at test';
        const req = mockReq({ method: 'GET', originalUrl: '/api/test', user: { id: 1, username: 'admin', nombre: 'Admin' } });
        const res = mockRes();
        errorHandler(err, req, res, mockNext());
        expect(res._json.stack).toBeDefined();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});

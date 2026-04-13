'use strict';

const { mockRes } = require('../../helpers/mockReqRes');
const { success, created, error, notFound, unauthorized, forbidden, validationError, paginated } = require('../../../utils/response.utils');

describe('response.utils', () => {
  let res;
  beforeEach(() => { res = mockRes(); });

  describe('success', () => {
    it('sends 200 with data', () => {
      success(res, { id: 1 }, 'OK');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json).toEqual({ success: true, message: 'OK', data: { id: 1 } });
    });

    it('omits data when null', () => {
      success(res, null, 'Done');
      expect(res._json).toEqual({ success: true, message: 'Done' });
      expect(res._json.data).toBeUndefined();
    });
  });

  describe('created', () => {
    it('sends 201', () => {
      created(res, { id: 2 }, 'Creado');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res._json.success).toBe(true);
      expect(res._json.data).toEqual({ id: 2 });
    });
  });

  describe('error', () => {
    it('sends given status with error body', () => {
      error(res, 'Bad request', 400);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json).toEqual({ success: false, message: 'Bad request' });
    });

    it('includes errors array when provided', () => {
      error(res, 'Validation', 422, [{ field: 'name', message: 'required' }]);
      expect(res._json.errors).toHaveLength(1);
    });
  });

  describe('notFound', () => {
    it('sends 404 with resource name', () => {
      notFound(res, 'Vehículo');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res._json.message).toContain('Vehículo');
    });
  });

  describe('unauthorized', () => {
    it('sends 401', () => {
      unauthorized(res);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('forbidden', () => {
    it('sends 403', () => {
      forbidden(res, 'No acceso');
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res._json.message).toBe('No acceso');
    });
  });

  describe('validationError', () => {
    it('sends 422 with errors', () => {
      validationError(res, [{ field: 'email' }]);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res._json.errors).toHaveLength(1);
    });
  });

  describe('paginated', () => {
    it('sends 200 with pagination metadata', () => {
      paginated(res, { data: [1, 2], total: 50, page: 2, limit: 20 });
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res._json;
      expect(body.success).toBe(true);
      expect(body.data).toEqual([1, 2]);
      expect(body.pagination.total).toBe(50);
      expect(body.pagination.totalPages).toBe(3);
      expect(body.pagination.hasNext).toBe(true);
      expect(body.pagination.hasPrev).toBe(true);
    });
  });
});

'use strict';

const { query } = require('../../../config/database');
const { generateAccessToken, generateImpersonationToken } = require('../../../utils/jwt.utils');
const { contextoActual } = require('../../../utils/contextoPeticion.utils');
const { authenticate, optionalAuth } = require('../../../middleware/auth.middleware');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

describe('auth.middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  const makeToken = (overrides = {}) =>
    generateAccessToken({ id: 1, username: 'test', roles: ['tecnico'], permissions: [], ...overrides });

  describe('authenticate', () => {
    it('returns 401 when no Authorization header', async () => {
      const req = mockReq();
      const res = mockRes();
      const next = mockNext();
      await authenticate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when header has no Bearer prefix', async () => {
      const req = mockReq({ headers: { authorization: 'Basic abc' } });
      const res = mockRes();
      await authenticate(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 for invalid token', async () => {
      const req = mockReq({ headers: { authorization: 'Bearer invalid.token' } });
      const res = mockRes();
      await authenticate(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 when user not found in DB', async () => {
      const token = makeToken();
      query.mockResolvedValueOnce([[]]);
      const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
      const res = mockRes();
      await authenticate(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 when user is inactive', async () => {
      const token = makeToken();
      query.mockResolvedValueOnce([[{ id: 1, username: 'test', nombre: 'Test', apellidos: 'User', activo: 0, deleted_at: null, roles: 'tecnico' }]]);
      const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
      const res = mockRes();
      await authenticate(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 when user is deleted', async () => {
      const token = makeToken();
      query.mockResolvedValueOnce([[{ id: 1, username: 'test', nombre: 'Test', apellidos: 'User', activo: 1, deleted_at: '2024-01-01', roles: 'tecnico' }]]);
      const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
      const res = mockRes();
      await authenticate(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('sets req.user and calls next for valid token + active user', async () => {
      const token = makeToken();
      query
        .mockResolvedValueOnce([[{ id: 1, username: 'test', nombre: 'Test', apellidos: 'User', activo: 1, deleted_at: null, roles: 'tecnico' }]])
        .mockResolvedValueOnce([[{ nombre: 'manage_vehicles' }]]);
      const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
      const res = mockRes();
      const next = mockNext();
      await authenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user.id).toBe(1);
      expect(req.user.roles).toEqual(['tecnico']);
      expect(req.user.permissions).toEqual(['manage_vehicles']);
    });
  });

  describe('authenticate — impersonación', () => {
    const tecnico = [[{ id: 5, username: 'jlopez', nombre: 'J', apellidos: 'L', activo: 1, deleted_at: null, roles: 'tecnico' }]];
    const token = () => generateImpersonationToken({ id: 5, username: 'jlopez', roles: ['tecnico'] }, 1);

    beforeEach(() => query.mockReset());

    it('carga al impersonado y anota al superadmin en req.user y en el contexto', async () => {
      query
        .mockResolvedValueOnce(tecnico)
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ id: 1, username: 'findelias' }]]);
      const req = mockReq({ headers: { authorization: `Bearer ${token()}` } });
      let ctx;
      const next = jest.fn(() => { ctx = contextoActual(); });
      await authenticate(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
      expect(req.user.id).toBe(5);
      expect(req.user.roles).toEqual(['tecnico']);
      expect(req.user.impersonadoPor).toEqual({ id: 1, username: 'findelias' });
      expect(ctx.impersonadoPor).toEqual({ id: 1, username: 'findelias' });
      expect(query.mock.calls[2][0]).toContain("r.nombre = 'superadmin'");
      expect(query.mock.calls[2][1]).toEqual([1]);
    });

    it('401 si quien impersona ya no es superadmin activo', async () => {
      query
        .mockResolvedValueOnce(tecnico)
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[]]);
      const req = mockReq({ headers: { authorization: `Bearer ${token()}` } });
      const res = mockRes();
      const next = mockNext();
      await authenticate(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('un token normal no consulta al impersonador ni lo anota', async () => {
      query.mockResolvedValueOnce(tecnico).mockResolvedValueOnce([[]]);
      const req = mockReq({ headers: { authorization: `Bearer ${makeToken({ id: 5 })}` } });
      let ctx;
      await authenticate(req, mockRes(), jest.fn(() => { ctx = contextoActual(); }));
      expect(query).toHaveBeenCalledTimes(2);
      expect(req.user.impersonadoPor).toBeUndefined();
      expect(ctx.impersonadoPor).toBeNull();
    });
  });

  describe('optionalAuth', () => {
    it('calls next without req.user when no header', async () => {
      const req = mockReq();
      const next = mockNext();
      await optionalAuth(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
      expect(req.user).toBeNull();
    });

    it('sets req.user when valid header present', async () => {
      const token = makeToken();
      query
        .mockResolvedValueOnce([[{ id: 1, username: 'test', nombre: 'T', apellidos: 'U', activo: 1, deleted_at: null, roles: 'tecnico' }]])
        .mockResolvedValueOnce([[]]);
      const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
      const next = mockNext();
      await optionalAuth(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
      expect(req.user.id).toBe(1);
    });
  });
});

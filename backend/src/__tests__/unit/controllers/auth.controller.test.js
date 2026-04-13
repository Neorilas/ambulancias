'use strict';

const { query, transaction } = require('../../../config/database');
const { hashPassword } = require('../../../utils/password.utils');

jest.mock('../../../controllers/admin.controller', () => ({
  logAudit: jest.fn(),
  logError: jest.fn(),
}));

const { login, refresh, logout, me } = require('../../../controllers/auth.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

describe('auth.controller', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── login ──────────────────────────────────────────────
  describe('login', () => {
    let validHash;
    beforeAll(async () => { validHash = await hashPassword('Test1234!'); });

    const makeUser = (overrides = {}) => ({
      id: 1, username: 'admin', password_hash: validHash,
      nombre: 'Admin', apellidos: 'User', activo: 1, deleted_at: null,
      roles: 'administrador', ...overrides,
    });

    it('returns 429 when account is locked', async () => {
      // isAccountLocked → rows[0].attempts >= MAX
      query.mockResolvedValueOnce([[{ attempts: 99 }]]);
      // recordLoginAttempt (no destructuring)
      query.mockResolvedValueOnce([]);

      const req = mockReq({ body: { username: 'admin', password: 'x' }, ip: '1.1.1.1', headers: { 'user-agent': 'test' } });
      const res = mockRes();
      await login(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('returns 401 when user not found', async () => {
      query.mockResolvedValueOnce([[{ attempts: 0 }]]); // not locked
      query.mockResolvedValueOnce([[]]); // user query: empty
      query.mockResolvedValueOnce([]); // recordLoginAttempt

      const req = mockReq({ body: { username: 'ghost', password: 'x' }, ip: '1.1.1.1', headers: { 'user-agent': 'test' } });
      const res = mockRes();
      await login(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 for inactive user', async () => {
      query.mockResolvedValueOnce([[{ attempts: 0 }]]);
      query.mockResolvedValueOnce([[makeUser({ activo: 0 })]]); // inactive
      query.mockResolvedValueOnce([]); // recordLoginAttempt

      const req = mockReq({ body: { username: 'admin', password: 'Test1234!' }, ip: '1.1.1.1', headers: { 'user-agent': 'test' } });
      const res = mockRes();
      await login(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 for wrong password', async () => {
      query.mockResolvedValueOnce([[{ attempts: 0 }]]);
      query.mockResolvedValueOnce([[makeUser()]]); // user found
      query.mockResolvedValueOnce([]); // recordLoginAttempt

      const req = mockReq({ body: { username: 'admin', password: 'WrongPass1!' }, ip: '1.1.1.1', headers: { 'user-agent': 'test' } });
      const res = mockRes();
      await login(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns tokens on valid login', async () => {
      query.mockResolvedValueOnce([[{ attempts: 0 }]]); // not locked
      query.mockResolvedValueOnce([[makeUser({ password_hash: validHash })]]); // user
      query.mockResolvedValueOnce([]); // recordLoginAttempt (success)
      query.mockResolvedValueOnce([[]]); // getUserPermissions
      query.mockResolvedValueOnce([]); // insert refresh token

      const req = mockReq({ body: { username: 'admin', password: 'Test1234!' }, ip: '1.1.1.1', headers: { 'user-agent': 'test' } });
      const res = mockRes();
      await login(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data.accessToken).toBeDefined();
      expect(res._json.data.refreshToken).toBeDefined();
      expect(res._json.data.user.username).toBe('admin');
    });
  });

  // ── refresh ────────────────────────────────────────────
  describe('refresh', () => {
    it('returns 401 when no refresh token', async () => {
      const res = mockRes();
      await refresh(mockReq({ body: {} }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 when token not found in DB', async () => {
      query.mockResolvedValueOnce([[]]); // empty

      const res = mockRes();
      await refresh(mockReq({ body: { refreshToken: 'fake' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 401 when token is revoked', async () => {
      query.mockResolvedValueOnce([[{
        id: 1, user_id: 1, expires_at: new Date(Date.now() + 86400000), revoked: 1,
        username: 'admin', activo: 1, deleted_at: null, roles: 'administrador',
      }]]);

      const res = mockRes();
      await refresh(mockReq({ body: { refreshToken: 'tok' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns new tokens on valid refresh', async () => {
      query.mockResolvedValueOnce([[{
        id: 1, user_id: 1, expires_at: new Date(Date.now() + 86400000), revoked: 0,
        username: 'admin', activo: 1, deleted_at: null, roles: 'administrador',
      }]]);
      query.mockResolvedValueOnce([[]]); // getUserPermissions
      transaction.mockImplementation(async (cb) => cb({ execute: jest.fn().mockResolvedValue([]) }));

      const res = mockRes();
      await refresh(mockReq({ body: { refreshToken: 'valid' }, ip: '1.1.1.1' }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data.accessToken).toBeDefined();
    });
  });

  // ── logout ─────────────────────────────────────────────
  describe('logout', () => {
    it('returns 200 without refresh token', async () => {
      const res = mockRes();
      await logout(mockReq({ body: {} }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('revokes token and returns 200', async () => {
      query.mockResolvedValueOnce([]); // UPDATE
      const res = mockRes();
      await logout(mockReq({ body: { refreshToken: 'tok' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ── me ─────────────────────────────────────────────────
  describe('me', () => {
    it('returns user profile', async () => {
      query.mockResolvedValueOnce([[{
        id: 1, username: 'admin', email: 'a@b.com', nombre: 'Admin', apellidos: 'U',
        dni: '12345678A', telefono: '600000000', activo: 1, created_at: new Date(),
      }]]);

      const res = mockRes();
      await me(mockReq({ user: { id: 1, roles: ['administrador'] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data.username).toBe('admin');
    });

    it('returns 401 when user not found', async () => {
      query.mockResolvedValueOnce([[]]); // empty
      const res = mockRes();
      await me(mockReq({ user: { id: 999, roles: [] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});

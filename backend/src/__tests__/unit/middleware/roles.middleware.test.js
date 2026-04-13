'use strict';

const {
  hasRole, hasPermission, isSuperAdmin, isAdmin, isOperacional,
  requireRole, requirePermission, requireAnyRole,
} = require('../../../middleware/roles.middleware');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

// Mock admin.controller logAudit to prevent side effects
jest.mock('../../../controllers/admin.controller', () => ({
  logAudit: jest.fn(),
  logError: jest.fn(),
}));

describe('roles.middleware', () => {
  describe('hasRole', () => {
    it('returns true when user has role', () => {
      expect(hasRole({ roles: ['tecnico'] }, 'tecnico')).toBe(true);
    });
    it('returns false when user lacks role', () => {
      expect(hasRole({ roles: ['tecnico'] }, 'administrador')).toBe(false);
    });
    it('returns false for null user', () => {
      expect(hasRole(null, 'tecnico')).toBe(false);
    });
  });

  describe('hasPermission', () => {
    it('returns true for superadmin regardless', () => {
      expect(hasPermission({ roles: ['superadmin'], permissions: [] }, 'manage_users')).toBe(true);
    });
    it('returns true when user has permission', () => {
      expect(hasPermission({ roles: ['gestor'], permissions: ['manage_users'] }, 'manage_users')).toBe(true);
    });
    it('returns false when user lacks permission', () => {
      expect(hasPermission({ roles: ['tecnico'], permissions: [] }, 'manage_users')).toBe(false);
    });
  });

  describe('helpers', () => {
    it('isSuperAdmin', () => {
      expect(isSuperAdmin({ roles: ['superadmin'] })).toBe(true);
      expect(isSuperAdmin({ roles: ['administrador'] })).toBe(false);
    });
    it('isAdmin', () => {
      expect(isAdmin({ roles: ['administrador'] })).toBe(true);
    });
    it('isOperacional', () => {
      expect(isOperacional({ roles: ['tecnico'] })).toBe(true);
      expect(isOperacional({ roles: ['enfermero'] })).toBe(true);
      expect(isOperacional({ roles: ['medico'] })).toBe(true);
      expect(isOperacional({ roles: ['gestor'] })).toBe(false);
    });
  });

  describe('requireRole', () => {
    it('calls next for matching role', () => {
      const mw = requireRole('administrador');
      const req = mockReq({ user: { roles: ['administrador'] } });
      const next = mockNext();
      mw(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('returns 403 for non-matching role', () => {
      const mw = requireRole('administrador');
      const req = mockReq({ user: { roles: ['tecnico'] } });
      const res = mockRes();
      mw(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('allows any of multiple roles', () => {
      const mw = requireRole('administrador', 'gestor');
      const req = mockReq({ user: { roles: ['gestor'] } });
      const next = mockNext();
      mw(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('requirePermission', () => {
    it('calls next for authorized user', () => {
      const mw = requirePermission('manage_users');
      const req = mockReq({ user: { roles: ['gestor'], permissions: ['manage_users'] } });
      const next = mockNext();
      mw(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('returns 403 and audits for unauthorized user', () => {
      const mw = requirePermission('manage_users');
      const req = mockReq({ user: { id: 3, username: 'tec', roles: ['tecnico'], permissions: [] }, method: 'GET', originalUrl: '/users' });
      const res = mockRes();
      mw(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('requireAnyRole', () => {
    it('returns 403 when user has no roles', () => {
      const req = mockReq({ user: { roles: [] } });
      const res = mockRes();
      requireAnyRole(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('calls next when user has at least one role', () => {
      const req = mockReq({ user: { roles: ['tecnico'] } });
      const next = mockNext();
      requireAnyRole(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
    });
  });
});

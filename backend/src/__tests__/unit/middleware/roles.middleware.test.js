'use strict';

const {
  hasRole, hasPermission, isSuperAdmin, isAdmin, isOperacional, tieneRolDeCampo,
  requireRole, requirePermission, requireAnyRole, ocultarSalvoRoles,
} = require('../../../middleware/roles.middleware');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');
const { logAudit } = require('../../../controllers/admin.controller');

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
      expect(isOperacional({ roles: ['tes_conductor'] })).toBe(true);
      expect(isOperacional({ roles: ['gestor'] })).toBe(false);
    });
    // Un jefe de flota que ademas sale de servicio lleva los dos roles: manda
    // el de gestion, o se queda sin ver un solo vehiculo que asignar.
    it('isOperacional ignora el rol de campo si ademas hay mando', () => {
      expect(isOperacional({ roles: ['administrador', 'tecnico'] })).toBe(false);
      expect(isOperacional({ roles: ['gestor', 'enfermero'] })).toBe(false);
      expect(isOperacional({ roles: ['superadmin', 'medico'] })).toBe(false);
    });

    // El literal, en cambio, no mira el mando: se usa donde se *concede*
    // algo por llevar el vehiculo encima, no donde se recorta.
    it('tieneRolDeCampo no mira el mando', () => {
      expect(tieneRolDeCampo({ roles: ['tecnico'] })).toBe(true);
      expect(tieneRolDeCampo({ roles: ['administrador', 'tecnico'] })).toBe(true);
      expect(tieneRolDeCampo({ roles: ['administrador'] })).toBe(false);
      // El TES conductor sale de servicio como cualquier otro: si no entra
      // aqui, ownership le niega subir la evidencia de su propia asignacion.
      expect(tieneRolDeCampo({ roles: ['tes_conductor'] })).toBe(true);
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

  describe('ocultarSalvoRoles', () => {
    const mw = ocultarSalvoRoles('superadmin', 'administrador');

    it('deja pasar a quien tiene uno de los roles', () => {
      const next = mockNext();
      mw(mockReq({ user: { id: 1, roles: ['administrador', 'tecnico'] } }), mockRes(), next);
      expect(next).toHaveBeenCalled();
    });

    it('al resto le da el 404 de ruta inexistente, sin nombrar roles, y lo audita', () => {
      logAudit.mockClear();
      const res = mockRes();
      const req = mockReq({ user: { id: 9, username: 'gestor1', roles: ['gestor'] }, method: 'GET', originalUrl: '/api/v1/facturas' });
      const next = mockNext();
      mw(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
      expect(res._json).toEqual({ success: false, message: 'Ruta no encontrada: GET /api/v1/facturas' });
      expect(req._accesoDenegadoAuditado).toBe(true);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'access_denied', userId: 9, entityType: 'ruta_oculta' }));
    });

    it('sin usuario también 404, y sin auditar a nadie', () => {
      logAudit.mockClear();
      const res = mockRes();
      mw(mockReq({ method: 'GET', originalUrl: '/api/v1/facturas' }), res, mockNext());
      expect(res.statusCode).toBe(404);
      expect(logAudit).not.toHaveBeenCalled();
    });
  });
});

'use strict';

const { query } = require('../../../config/database');
const { logAudit, logError, listAuditLogs, listAuditUsers, listErrorLogs, getAdminStats, impersonar } = require('../../../controllers/admin.controller');
const { verifyAccessToken } = require('../../../utils/jwt.utils');
const { conContexto } = require('../../../utils/contextoPeticion.utils');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

describe('admin.controller', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── logAudit ───────────────────────────────────────────
  describe('logAudit', () => {
    it('inserts audit log entry', async () => {
      query.mockResolvedValueOnce([]);
      await logAudit({ userId: 1, userInfo: 'admin', action: 'login', ip: '1.1.1.1' });
      expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'), expect.any(Array));
    });

    it('does not throw on DB error', async () => {
      query.mockRejectedValueOnce(new Error('DB down'));
      await expect(logAudit({ action: 'test' })).resolves.not.toThrow();
    });

    it('impersonando, anota al superadmin en user_info y en details', async () => {
      query.mockResolvedValueOnce([]);
      await conContexto({ impersonadoPor: { id: 1, username: 'findelias' } }, () =>
        logAudit({ userId: 5, userInfo: 'jlopez', action: 'update_vehicle', details: { a: 1 } }));
      const params = query.mock.calls[0][1];
      expect(params[0]).toBe(5);
      expect(params[1]).toBe('jlopez (vía findelias)');
      expect(JSON.parse(params[5])).toEqual({ a: 1, impersonado_por: { id: 1, username: 'findelias' } });
    });

    it('acepta impersonadoPor explícito (fuera del contexto de la petición)', async () => {
      query.mockResolvedValueOnce([]);
      await logAudit({ userId: 5, userInfo: 'jlopez', action: 'access_denied', impersonadoPor: { id: 1, username: 'findelias' } });
      expect(query.mock.calls[0][1][1]).toBe('jlopez (vía findelias)');
    });

    it('no se anota a sí mismo cuando la fila ya es del superadmin', async () => {
      query.mockResolvedValueOnce([]);
      await conContexto({ impersonadoPor: { id: 1, username: 'findelias' } }, () =>
        logAudit({ userId: 1, userInfo: 'findelias', action: 'impersonate_end' }));
      expect(query.mock.calls[0][1][1]).toBe('findelias');
      expect(query.mock.calls[0][1][5]).toBeNull();
    });
  });

  // ── impersonar ─────────────────────────────────────────
  describe('impersonar', () => {
    const superadmin = { id: 1, username: 'findelias', roles: ['superadmin'] };
    const fila = (extra = {}) => [[{ id: 5, username: 'jlopez', nombre: 'J', apellidos: 'L', activo: 1, deleted_at: null, roles: 'tecnico', ...extra }]];

    beforeEach(() => query.mockReset());

    it('devuelve un token del usuario con el superadmin dentro y lo audita', async () => {
      query
        .mockResolvedValueOnce(fila())
        .mockResolvedValueOnce([[{ nombre: 'manage_vehicles' }]])
        .mockResolvedValueOnce([]);
      const req = mockReq({ params: { id: '5' }, user: superadmin });
      const res = mockRes();
      await impersonar(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      const data = res._json.data;
      expect(data.user).toMatchObject({ id: 5, roles: ['tecnico'], permissions: ['manage_vehicles'] });
      const payload = verifyAccessToken(data.accessToken);
      expect(payload).toMatchObject({ sub: 5, imp: 1, type: 'access' });
      expect(payload.exp - payload.iat).toBe(data.expiraEnMin * 60);
      expect(data.refreshToken).toBeUndefined();
      const audit = query.mock.calls[2][1];
      expect(audit[0]).toBe(1);
      expect(audit[2]).toBe('impersonate_start');
    });

    it('permite impersonar a un administrador', async () => {
      query.mockResolvedValueOnce(fila({ roles: 'administrador' })).mockResolvedValueOnce([[]]).mockResolvedValueOnce([]);
      const res = mockRes();
      await impersonar(mockReq({ params: { id: '5' }, user: superadmin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('403 con otro superadmin', async () => {
      query.mockResolvedValueOnce(fila({ roles: 'administrador,superadmin' }));
      const res = mockRes();
      await impersonar(mockReq({ params: { id: '5' }, user: superadmin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('400 a uno mismo, 404 si no existe o está borrado, 400 si está desactivado', async () => {
      let res = mockRes();
      await impersonar(mockReq({ params: { id: '1' }, user: superadmin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);

      query.mockResolvedValueOnce([[]]);
      res = mockRes();
      await impersonar(mockReq({ params: { id: '5' }, user: superadmin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);

      query.mockResolvedValueOnce(fila({ deleted_at: '2026-01-01' }));
      res = mockRes();
      await impersonar(mockReq({ params: { id: '5' }, user: superadmin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);

      query.mockResolvedValueOnce(fila({ activo: 0 }));
      res = mockRes();
      await impersonar(mockReq({ params: { id: '5' }, user: superadmin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── logError ───────────────────────────────────────────
  describe('logError', () => {
    it('inserts error log entry', async () => {
      query.mockResolvedValueOnce([]);
      await logError({ method: 'POST', url: '/api/test', statusCode: 500, errorMessage: 'fail', ip: '1.1.1.1' });
      expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO error_logs'), expect.any(Array));
    });

    it('does not throw on DB error', async () => {
      query.mockRejectedValueOnce(new Error('DB down'));
      await expect(logError({ method: 'GET', statusCode: 500, ip: '1.1.1.1' })).resolves.not.toThrow();
    });
  });

  // ── listAuditLogs ──────────────────────────────────────
  describe('listAuditLogs', () => {
    it('returns paginated audit logs', async () => {
      query.mockResolvedValueOnce([[{ total: 50 }]]); // count
      query.mockResolvedValueOnce([[
        { id: 1, action: 'login', user_info: 'admin', created_at: new Date() },
        { id: 2, action: 'create_user', user_info: 'admin', created_at: new Date() },
      ]]);

      const res = mockRes();
      await listAuditLogs(mockReq({ query: { page: 1, limit: 50 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toHaveLength(2);
    });

    it('filters by action and date range', async () => {
      query.mockResolvedValueOnce([[{ total: 10 }]]);
      query.mockResolvedValueOnce([[{ id: 1, action: 'login' }]]);

      const res = mockRes();
      await listAuditLogs(mockReq({ query: { action: 'login', desde: '2026-04-01', hasta: '2026-04-13' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ── listErrorLogs ──────────────────────────────────────
  describe('listErrorLogs', () => {
    it('returns paginated error logs', async () => {
      query.mockResolvedValueOnce([[{ total: 5 }]]);
      query.mockResolvedValueOnce([[{ id: 1, method: 'POST', url: '/api/test', status_code: 500 }]]);

      const res = mockRes();
      await listErrorLogs(mockReq({ query: {} }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ── getAdminStats ──────────────────────────────────────
  describe('getAdminStats', () => {
    it('returns all stats', async () => {
      query.mockResolvedValueOnce([[{ n: 100 }]]);  // audit total
      query.mockResolvedValueOnce([[{ n: 10 }]]);   // errors total
      query.mockResolvedValueOnce([[{ n: 2 }]]);    // errors today
      query.mockResolvedValueOnce([[{ n: 3 }]]);    // failed logins
      query.mockResolvedValueOnce([[{ action: 'login', total: 50 }]]); // top actions
      query.mockResolvedValueOnce([[{ user_info: 'admin', total: 40 }]]); // top users

      const res = mockRes();
      await getAdminStats(mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toHaveProperty('audit_total', 100);
      expect(res._json.data).toHaveProperty('errors_hoy', 2);
    });
  });

  // ── listAuditUsers ─────────────────────────────────────
  // Puebla el filtro "por usuario" del historial de auditoría.
  describe('listAuditUsers', () => {
    it('devuelve los usuarios con actividad auditada', async () => {
      const filas = [
        { user_id: 1, user_info: 'findelias (Rafael Nuño)', total: 240, last_action: new Date('2026-09-20T08:00:00Z') },
        { user_id: 67, user_info: 'fjtamayo (Francisco Javier)', total: 12, last_action: new Date('2026-09-14T10:00:00Z') },
      ];
      query.mockResolvedValueOnce([filas]);

      const res = mockRes();
      await listAuditUsers(mockReq(), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toEqual(filas);
    });

    it('agrupa por usuario y ordena por la última acción', async () => {
      query.mockResolvedValueOnce([[]]);

      await listAuditUsers(mockReq(), mockRes(), mockNext());

      const [sql] = query.mock.calls[0];
      expect(sql).toContain('GROUP BY user_id');
      expect(sql).toContain('ORDER BY last_action DESC');
    });

    it('descarta las entradas sin usuario: el filtro no puede ofrecer "nadie"', async () => {
      query.mockResolvedValueOnce([[]]);

      await listAuditUsers(mockReq(), mockRes(), mockNext());

      expect(query.mock.calls[0][0]).toContain('WHERE user_id IS NOT NULL');
    });

    it('se queda con el nombre más reciente de cada usuario', async () => {
      // Un usuario renombrado aparece con varios user_info en audit_logs; el
      // SUBSTRING_INDEX(MAX(CONCAT(created_at,...))) elige el del último apunte.
      query.mockResolvedValueOnce([[]]);

      await listAuditUsers(mockReq(), mockRes(), mockNext());

      expect(query.mock.calls[0][0]).toContain("MAX(CONCAT(created_at, '||', user_info))");
      // …pero sin las filas impersonadas («x (vía superadmin)») si hay otras
      expect(query.mock.calls[0][0]).toContain("NOT LIKE '% (vía %)'");
    });

    it('sin actividad devuelve una lista vacía', async () => {
      query.mockResolvedValueOnce([[]]);

      const res = mockRes();
      await listAuditUsers(mockReq(), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toEqual([]);
    });

    it('un fallo de BD va a next', async () => {
      query.mockRejectedValueOnce(new Error('DB down'));

      const next = mockNext();
      await listAuditUsers(mockReq(), mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── Errores de BD en los listados ──────────────────────
  describe('un fallo de BD siempre va a next(err)', () => {
    it('listAuditLogs', async () => {
      query.mockRejectedValueOnce(new Error('DB down'));

      const next = mockNext();
      await listAuditLogs(mockReq({ query: {} }), mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('listErrorLogs', async () => {
      query.mockRejectedValueOnce(new Error('DB down'));

      const next = mockNext();
      await listErrorLogs(mockReq({ query: {} }), mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('getAdminStats', async () => {
      query.mockRejectedValueOnce(new Error('DB down'));

      const next = mockNext();
      await getAdminStats(mockReq(), mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});

'use strict';

const { query } = require('../../../config/database');

jest.mock('../../../controllers/admin.controller', () => ({
  logAudit: jest.fn(),
  logError: jest.fn(),
}));

const { logAudit } = require('../../../controllers/admin.controller');
const {
  listFeatures, toggleFeature, getActiveFeatures,
} = require('../../../controllers/features.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

const admin = { id: 1, username: 'findelias', nombre: 'Rafael Nuño' };

describe('features.controller', () => {
  beforeEach(() => {
    // clearAllMocks no drena la cola de mockResolvedValueOnce: hay que resetear.
    query.mockReset();
    logAudit.mockClear();
  });

  // ── listFeatures ───────────────────────────────────────
  describe('listFeatures', () => {
    it('devuelve el catálogo completo ordenado por display_order', async () => {
      const filas = [
        { feature_key: 'menu_vehiculos', label: 'Vehículos', enabled: 1, display_order: 1 },
        { feature_key: 'menu_trabajos', label: 'Trabajos', enabled: 0, display_order: 2 },
      ];
      query.mockResolvedValueOnce([filas]);

      const res = mockRes();
      await listFeatures(mockReq({ user: admin }), res, mockNext());

      expect(query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY display_order'));
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toEqual(filas);
    });

    it('incluye las deshabilitadas: el admin tiene que poder reactivarlas', async () => {
      query.mockResolvedValueOnce([[{ feature_key: 'menu_trabajos', enabled: 0 }]]);

      const res = mockRes();
      await listFeatures(mockReq({ user: admin }), res, mockNext());

      expect(query.mock.calls[0][0]).not.toContain('WHERE');
      expect(res._json.data).toHaveLength(1);
    });

    it('un fallo de BD va a next, no revienta la petición', async () => {
      query.mockRejectedValueOnce(new Error('DB down'));

      const next = mockNext();
      await listFeatures(mockReq({ user: admin }), mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── getActiveFeatures ──────────────────────────────────
  describe('getActiveFeatures', () => {
    it('devuelve solo las claves activas, ya aplanadas', async () => {
      query.mockResolvedValueOnce([[
        { feature_key: 'menu_vehiculos' },
        { feature_key: 'menu_mis_asignaciones' },
      ]]);

      const res = mockRes();
      await getActiveFeatures(mockReq({ user: admin }), res, mockNext());

      expect(query).toHaveBeenCalledWith(expect.stringContaining('enabled = 1'));
      // El frontend espera un array de strings, no de filas.
      expect(res._json.data).toEqual(['menu_vehiculos', 'menu_mis_asignaciones']);
    });

    it('sin ninguna activa devuelve una lista vacía', async () => {
      query.mockResolvedValueOnce([[]]);

      const res = mockRes();
      await getActiveFeatures(mockReq({ user: admin }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toEqual([]);
    });

    it('un fallo de BD va a next', async () => {
      query.mockRejectedValueOnce(new Error('DB down'));

      const next = mockNext();
      await getActiveFeatures(mockReq({ user: admin }), mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── toggleFeature ──────────────────────────────────────
  describe('toggleFeature', () => {
    it('apaga un flag y lo deja auditado', async () => {
      query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = mockRes();
      await toggleFeature(
        mockReq({ user: admin, params: { key: 'menu_trabajos' }, body: { enabled: false } }),
        res, mockNext()
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE app_features'),
        [0, 'menu_trabajos']
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toEqual({ feature_key: 'menu_trabajos', enabled: false });
    });

    it('enciende un flag', async () => {
      query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = mockRes();
      await toggleFeature(
        mockReq({ user: admin, params: { key: 'menu_trabajos' }, body: { enabled: true } }),
        res, mockNext()
      );

      expect(query).toHaveBeenCalledWith(expect.any(String), [1, 'menu_trabajos']);
      expect(res._json.data).toEqual({ feature_key: 'menu_trabajos', enabled: true });
    });

    it('registra quién lo tocó, qué flag y cómo queda', async () => {
      query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await toggleFeature(
        mockReq({ user: admin, params: { key: 'menu_vehiculos' }, body: { enabled: false }, ip: '10.0.0.5' }),
        mockRes(), mockNext()
      );

      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        userId: 1,
        userInfo: 'findelias (Rafael Nuño)',
        action: 'toggle_feature',
        entityType: 'app_features',
        details: { feature_key: 'menu_vehiculos', enabled: false },
        ip: '10.0.0.5',
      }));
    });

    it('un usuario sin nombre no rompe la línea de auditoría', async () => {
      query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await toggleFeature(
        mockReq({ user: { id: 9, username: 'jlopez' }, params: { key: 'menu_vehiculos' }, body: { enabled: true } }),
        mockRes(), mockNext()
      );

      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        userInfo: 'jlopez ()',
      }));
    });

    it('una clave que no existe es 404 y no se audita', async () => {
      query.mockResolvedValueOnce([{ affectedRows: 0 }]);

      const res = mockRes();
      await toggleFeature(
        mockReq({ user: admin, params: { key: 'menu_inventado' }, body: { enabled: true } }),
        res, mockNext()
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res._json).toEqual({ success: false, message: 'Feature no encontrada' });
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('cualquier valor "verdadero" en el cuerpo se normaliza a 1/booleano', async () => {
      query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = mockRes();
      await toggleFeature(
        mockReq({ user: admin, params: { key: 'menu_trabajos' }, body: { enabled: 'si' } }),
        res, mockNext()
      );

      expect(query).toHaveBeenCalledWith(expect.any(String), [1, 'menu_trabajos']);
      expect(res._json.data.enabled).toBe(true);
    });

    it('sin `enabled` en el cuerpo se interpreta como apagar', async () => {
      query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = mockRes();
      await toggleFeature(
        mockReq({ user: admin, params: { key: 'menu_trabajos' }, body: {} }),
        res, mockNext()
      );

      expect(query).toHaveBeenCalledWith(expect.any(String), [0, 'menu_trabajos']);
      expect(res._json.data.enabled).toBe(false);
    });

    it('un fallo de BD va a next', async () => {
      query.mockRejectedValueOnce(new Error('DB down'));

      const next = mockNext();
      await toggleFeature(
        mockReq({ user: admin, params: { key: 'menu_trabajos' }, body: { enabled: true } }),
        mockRes(), next
      );

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(logAudit).not.toHaveBeenCalled();
    });
  });
});

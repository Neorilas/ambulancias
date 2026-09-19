'use strict';

const { query } = require('../../../config/database');
const {
  tieneElVehiculoAsignado,
  requireVehicleUploadAccess,
  requireTrabajoEvidenciaAccess,
} = require('../../../middleware/ownership.middleware');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

const gestor   = { id: 10, username: 'gestor',  roles: ['gestor'],   permissions: ['manage_vehicles', 'manage_trabajos'] };
const tecnico  = { id: 20, username: 'tecnico', roles: ['tecnico'],  permissions: [] };
const superadm = { id: 1,  username: 'root',    roles: ['superadmin'], permissions: [] };

describe('ownership.middleware', () => {
  beforeEach(() => { query.mockReset(); });

  describe('tieneElVehiculoAsignado', () => {
    it('true cuando hay trabajo o asignación que lo vincula', async () => {
      query.mockResolvedValueOnce([[{ ok: 1 }]]);
      await expect(tieneElVehiculoAsignado(20, 3)).resolves.toBe(true);
    });

    it('false cuando no hay ninguno', async () => {
      query.mockResolvedValueOnce([[]]);
      await expect(tieneElVehiculoAsignado(20, 3)).resolves.toBe(false);
    });
  });

  describe('requireVehicleUploadAccess (SEC-02)', () => {
    it('deja pasar a quien gestiona la flota sin consultar la BD', async () => {
      const next = mockNext();
      await requireVehicleUploadAccess(mockReq({ params: { id: '3' }, user: gestor }), mockRes(), next);
      expect(next).toHaveBeenCalledWith();
      expect(query).not.toHaveBeenCalled();
    });

    it('deja pasar al superadmin (bypassa permisos)', async () => {
      const next = mockNext();
      await requireVehicleUploadAccess(mockReq({ params: { id: '3' }, user: superadm }), mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('deja pasar al técnico que tiene el vehículo asignado', async () => {
      query.mockResolvedValueOnce([[{ ok: 1 }]]);
      const next = mockNext();
      await requireVehicleUploadAccess(mockReq({ params: { id: '3' }, user: tecnico }), mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('403 al técnico que no tiene ese vehículo', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      const next = mockNext();
      await requireVehicleUploadAccess(mockReq({ params: { id: '99' }, user: tecnico }), res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    // Aqui se concede acceso por llevar el vehiculo encima, asi que vale el rol
    // operativo a secas: el jefe de flota que ademas sale de servicio no puede
    // perder la subida de fotos por el hecho de tener mando.
    it('deja pasar al gestor que ademas es tecnico y tiene el vehiculo asignado', async () => {
      query.mockResolvedValueOnce([[{ ok: 1 }]]);
      const next = mockNext();
      await requireVehicleUploadAccess(mockReq({
        params: { id: '3' },
        user: { id: 11, roles: ['gestor', 'tecnico'], permissions: [] },
      }), mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('403 a un usuario sin roles operacionales ni permisos', async () => {
      const res = mockRes();
      const next = mockNext();
      await requireVehicleUploadAccess(
        mockReq({ params: { id: '3' }, user: { id: 30, roles: [], permissions: [] } }), res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('requireTrabajoEvidenciaAccess (SEC-03)', () => {
    it('deja pasar a quien gestiona trabajos', async () => {
      const next = mockNext();
      await requireTrabajoEvidenciaAccess(
        mockReq({ params: { id: '7' }, body: { vehicle_id: '3' }, user: gestor }), mockRes(), next);
      expect(next).toHaveBeenCalledWith();
      expect(query).not.toHaveBeenCalled();
    });

    it('deja pasar al responsable de ese vehículo en ese trabajo', async () => {
      query.mockResolvedValueOnce([[{ ok: 1 }]]);
      const next = mockNext();
      await requireTrabajoEvidenciaAccess(
        mockReq({ params: { id: '7' }, body: { vehicle_id: '3' }, user: tecnico }), mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('403 al técnico que no es responsable de ese vehículo', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      const next = mockNext();
      await requireTrabajoEvidenciaAccess(
        mockReq({ params: { id: '7' }, body: { vehicle_id: '3' }, user: tecnico }), res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('403 sin vehicle_id utilizable', async () => {
      const res = mockRes();
      await requireTrabajoEvidenciaAccess(
        mockReq({ params: { id: '7' }, body: {}, user: tecnico }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
      expect(query).not.toHaveBeenCalled();
    });

    it('propaga errores de BD al manejador de errores', async () => {
      query.mockRejectedValueOnce(new Error('boom'));
      const next = mockNext();
      await requireTrabajoEvidenciaAccess(
        mockReq({ params: { id: '7' }, body: { vehicle_id: '3' }, user: tecnico }), mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});

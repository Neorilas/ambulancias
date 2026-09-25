'use strict';

const { query } = require('../../../config/database');
const {
  tieneElVehiculoAsignado,
  requireAsignacionEvidenciaAccess,
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

    it('en la asignación libre solo cuentan los responsables, no el personal', async () => {
      query.mockResolvedValueOnce([[]]);
      await tieneElVehiculoAsignado(20, 3);
      const sql = query.mock.calls[0][0];
      expect(sql).toContain('FROM asignacion_usuarios au');
      expect(sql).toContain("au.rol = 'responsable'");
    });

    it('en el trabajo cuentan los responsables de ESE vehículo y el estado del vehículo', async () => {
      // El equipo del trabajo ve la ficha, no sube evidencia; y cada vehículo
      // tiene su propio ciclo de vida (v25), así que no vale el estado del trabajo.
      query.mockResolvedValueOnce([[]]);
      await tieneElVehiculoAsignado(20, 3);
      const sql = query.mock.calls[0][0];
      expect(sql).toContain('trabajo_vehiculo_responsables tvr');
      expect(sql).toContain("tv.estado = 'activo'");
      expect(sql).not.toContain('trabajo_usuarios');
    });

    it('false cuando no hay ninguno', async () => {
      query.mockResolvedValueOnce([[]]);
      await expect(tieneElVehiculoAsignado(20, 3)).resolves.toBe(false);
    });
  });

  describe('requireAsignacionEvidenciaAccess', () => {
    it('deja pasar a quien gestiona sin consultar la BD', async () => {
      const next = mockNext();
      await requireAsignacionEvidenciaAccess(mockReq({ params: { id: '3' }, user: gestor }), mockRes(), next);
      expect(next).toHaveBeenCalledWith();
      expect(query).not.toHaveBeenCalled();
    });

    it('deja pasar a un responsable de la asignación', async () => {
      query.mockResolvedValueOnce([[{ ok: 1 }]]);
      const next = mockNext();
      await requireAsignacionEvidenciaAccess(mockReq({ params: { id: '3' }, user: tecnico }), mockRes(), next);
      expect(next).toHaveBeenCalledWith();
      expect(query.mock.calls[0][0]).toContain("au.rol = 'responsable'");
    });

    it('403 al personal o a un ajeno, antes de guardar la foto', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      const next = mockNext();
      await requireAsignacionEvidenciaAccess(mockReq({ params: { id: '3' }, user: tecnico }), res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('un error de BD va a next(err)', async () => {
      query.mockRejectedValueOnce(new Error('db'));
      const next = mockNext();
      await requireAsignacionEvidenciaAccess(mockReq({ params: { id: '3' }, user: tecnico }), mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
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

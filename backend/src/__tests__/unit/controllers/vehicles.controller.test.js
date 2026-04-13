'use strict';

const { query } = require('../../../config/database');

jest.mock('../../../controllers/admin.controller', () => ({
  logAudit: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../../middleware/upload.middleware', () => ({
  processAndSave: jest.fn(),
  deleteFile: jest.fn(),
}));

const {
  listVehicles, getVehicle, createVehicle, updateVehicle, deleteVehicle,
  uploadImages, getVehicleImages, getVehicleHistorial,
  listIncidencias, createIncidencia, updateIncidencia,
  listRevisiones, createRevision, updateRevision, deleteRevision,
} = require('../../../controllers/vehicles.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

const { IMAGEN_TIPOS } = require('../../../config/constants');

describe('vehicles.controller', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── listVehicles ───────────────────────────────────────
  describe('listVehicles', () => {
    it('returns paginated list for admin', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'ABC1234', alias: 'AMB-1' }]]);

      const req = mockReq({ query: {}, user: { id: 1, roles: ['administrador'] } });
      const res = mockRes();
      await listVehicles(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toHaveLength(1);
    });

    it('filters for operacional (tecnico role) adds EXISTS clause', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 2, matricula: 'XYZ9999', alias: 'AMB-2' }]]);

      const req = mockReq({ query: {}, user: { id: 5, roles: ['tecnico'] } });
      const res = mockRes();
      await listVehicles(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      // Both queries should include user id (5) as operacional param
      expect(query).toHaveBeenCalledTimes(2);
      const firstCallArgs = query.mock.calls[0];
      expect(firstCallArgs[1]).toContain(5);
    });

    it('applies LIKE filter when search param provided', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'AMB1234', alias: 'AMB-1' }]]);

      const req = mockReq({ query: { search: 'AMB' }, user: { id: 1, roles: ['administrador'] } });
      const res = mockRes();
      await listVehicles(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      // LIKE param should be %AMB%
      const countParams = query.mock.calls[0][1];
      expect(countParams).toContain('%AMB%');
    });
  });

  // ── getVehicle ─────────────────────────────────────────
  describe('getVehicle', () => {
    it('returns vehicle with images', async () => {
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'ABC1234' }]]);
      query.mockResolvedValueOnce([[{ id: 10, tipo_imagen: 'frontal', image_url: '/img.jpg' }]]);

      const req = mockReq({ params: { id: '1' }, user: { id: 1, roles: ['administrador'] } });
      const res = mockRes();
      await getVehicle(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data.images).toHaveLength(1);
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await getVehicle(mockReq({ params: { id: '999' }, user: { id: 1, roles: ['administrador'] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns vehicle for operacional with access', async () => {
      // canOperacionalAccess query returns rows (has access)
      query.mockResolvedValueOnce([[{ id: 1 }]]);
      // vehicle query
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'ABC1234' }]]);
      // images query
      query.mockResolvedValueOnce([[{ id: 10, tipo_imagen: 'frontal', image_url: '/img.jpg' }]]);

      const req = mockReq({ params: { id: '1' }, user: { id: 5, roles: ['tecnico'] } });
      const res = mockRes();
      await getVehicle(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 403 for operacional without access', async () => {
      // canOperacionalAccess returns empty (no access)
      query.mockResolvedValueOnce([[]]);

      const req = mockReq({ params: { id: '1' }, user: { id: 5, roles: ['tecnico'] } });
      const res = mockRes();
      await getVehicle(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── createVehicle ──────────────────────────────────────
  describe('createVehicle', () => {
    it('creates vehicle successfully', async () => {
      query.mockResolvedValueOnce([[]]); // no duplicate
      query.mockResolvedValueOnce([{ insertId: 5 }]); // insert
      query.mockResolvedValueOnce([[{ id: 5, matricula: 'NEW1234', alias: 'AMB-5' }]]);

      const req = mockReq({
        body: { matricula: 'new1234', alias: 'AMB-5' },
        user: { id: 1, username: 'admin', nombre: 'Admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await createVehicle(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns 409 for duplicate matricula', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]);
      const res = mockRes();
      await createVehicle(mockReq({ body: { matricula: 'ABC1234' }, user: { id: 1, username: 'admin' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(409);
    });
  });

  // ── getVehicleImages (extended) ────────────────────────
  describe('getVehicleImages (extended)', () => {
    it('returns 403 for operacional without access', async () => {
      query.mockResolvedValueOnce([[]]); // canOperacionalAccess returns empty

      const req = mockReq({ params: { id: '1' }, query: {}, user: { id: 5, roles: ['tecnico'] } });
      const res = mockRes();
      await getVehicleImages(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('applies trabajo_id filter when provided', async () => {
      // admin, no operacional check; just the images query
      query.mockResolvedValueOnce([[{ id: 1, tipo_imagen: 'frontal', image_url: '/img1.jpg' }]]);

      const req = mockReq({ params: { id: '1' }, query: { trabajo_id: '5' }, user: { id: 1, roles: ['administrador'] } });
      const res = mockRes();
      await getVehicleImages(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      // SQL should include trabajo_id param
      const sqlCall = query.mock.calls[0][0];
      expect(sqlCall).toContain('trabajo_id');
      expect(query.mock.calls[0][1]).toContain(5);
    });
  });

  // ── updateVehicle ──────────────────────────────────────
  describe('updateVehicle', () => {
    it('updates vehicle fields', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // exists
      query.mockResolvedValueOnce([]); // UPDATE (no destructuring)
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'ABC1234', alias: 'Updated' }]]);

      const req = mockReq({ params: { id: '1' }, body: { alias: 'Updated' }, user: { id: 1, username: 'admin' }, ip: '1.1.1.1' });
      const res = mockRes();
      await updateVehicle(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await updateVehicle(mockReq({ params: { id: '999' }, body: { alias: 'X' }, user: { id: 1, username: 'admin' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 when no fields to update', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // exists
      const res = mockRes();
      await updateVehicle(mockReq({ params: { id: '1' }, body: {}, user: { id: 1, username: 'admin' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── deleteVehicle ──────────────────────────────────────
  describe('deleteVehicle', () => {
    it('returns 404 when vehicle not found', async () => {
      query.mockResolvedValueOnce([[]]); // not found
      const res = mockRes();
      await deleteVehicle(mockReq({ params: { id: '999' }, user: { id: 1, username: 'admin' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('soft deletes vehicle', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // exists
      query.mockResolvedValueOnce([[]]); // no active jobs
      query.mockResolvedValueOnce([]); // soft delete

      const req = mockReq({ params: { id: '1' }, user: { id: 1, username: 'admin' }, ip: '1.1.1.1' });
      const res = mockRes();
      await deleteVehicle(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 when vehicle has active jobs', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 10 }]]); // has active jobs
      const res = mockRes();
      await deleteVehicle(mockReq({ params: { id: '1' }, user: { id: 1, username: 'admin' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── uploadImages ───────────────────────────────────────
  describe('uploadImages', () => {
    it('uploads image for vehicle', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle exists
      query.mockResolvedValueOnce([{ insertId: 20 }]); // insert image

      const req = mockReq({
        params: { id: '1' },
        body: { trabajo_id: 5, tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/test.jpg' },
        user: { id: 1 },
      });
      const res = mockRes();
      await uploadImages(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns 404 when vehicle not found', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await uploadImages(mockReq({
        params: { id: '999' },
        body: { tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/test.jpg' },
        user: { id: 1 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 for invalid tipo_imagen', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle exists
      const res = mockRes();
      await uploadImages(mockReq({
        params: { id: '1' },
        body: { tipo_imagen: 'invalid_type' },
        processedFile: { url: '/uploads/test.jpg' },
        user: { id: 1 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when processedFile is missing', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle exists
      const res = mockRes();
      await uploadImages(mockReq({
        params: { id: '1' },
        body: { tipo_imagen: 'frontal' },
        // no processedFile
        user: { id: 1 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── getVehicleImages ───────────────────────────────────
  describe('getVehicleImages', () => {
    it('returns images for vehicle', async () => {
      query.mockResolvedValueOnce([[
        { id: 1, tipo_imagen: 'frontal', image_url: '/img1.jpg' },
        { id: 2, tipo_imagen: 'trasera', image_url: '/img2.jpg' },
      ]]);

      const req = mockReq({ params: { id: '1' }, query: {}, user: { id: 1, roles: ['administrador'] } });
      const res = mockRes();
      await getVehicleImages(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toHaveLength(2);
    });
  });

  // ── getVehicleHistorial ────────────────────────────────
  describe('getVehicleHistorial', () => {
    it('returns vehicle historial', async () => {
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'ABC1234', alias: 'AMB-1', kilometros_actuales: 50000 }]]);
      query.mockResolvedValueOnce([[]]); // no historial

      const res = mockRes();
      await getVehicleHistorial(mockReq({ params: { id: '1' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 404 for missing vehicle', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await getVehicleHistorial(mockReq({ params: { id: '999' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('builds trabajosMap when historial has rows with trabajo_id', async () => {
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'ABC1234', alias: 'AMB-1', kilometros_actuales: 50000 }]]);
      query.mockResolvedValueOnce([[
        {
          id: 10, tipo_imagen: 'frontal', image_url: '/img1.jpg', foto_fecha: new Date(),
          trabajo_id: 99, trabajo_referencia: 'TRB-2026-0001', trabajo_nombre: 'Test',
          trabajo_fecha_inicio: new Date(), trabajo_fecha_fin: new Date(),
          trabajo_estado: 'finalizado', trabajo_km_fin: 55000, trabajo_km_inicio: 50000,
          responsable_user_id: 2, responsable_nombre: 'Tec User',
          uploader_id: 2, uploader_nombre: 'Tec', uploader_apellidos: 'User', uploader_username: 'tec',
        },
        {
          id: 11, tipo_imagen: 'trasera', image_url: '/img2.jpg', foto_fecha: new Date(),
          trabajo_id: 99, trabajo_referencia: 'TRB-2026-0001', trabajo_nombre: 'Test',
          trabajo_fecha_inicio: new Date(), trabajo_fecha_fin: new Date(),
          trabajo_estado: 'finalizado', trabajo_km_fin: 55000, trabajo_km_inicio: 50000,
          responsable_user_id: 2, responsable_nombre: 'Tec User',
          uploader_id: 2, uploader_nombre: 'Tec', uploader_apellidos: 'User', uploader_username: 'tec',
        },
      ]]);

      const res = mockRes();
      await getVehicleHistorial(mockReq({ params: { id: '1' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      // Should have one trabajo entry with two fotos
      expect(res._json.data.trabajos).toHaveLength(1);
      expect(res._json.data.trabajos[0].fotos).toHaveLength(2);
    });
  });

  // ── listIncidencias ────────────────────────────────────
  describe('listIncidencias', () => {
    it('returns incidencias list', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle exists
      query.mockResolvedValueOnce([[{ id: 10, tipo: 'dano_exterior', descripcion: 'Rayón' }]]);

      const res = mockRes();
      await listIncidencias(mockReq({ params: { id: '1' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ── createIncidencia ───────────────────────────────────
  describe('createIncidencia', () => {
    it('returns 400 when descripcion is empty', async () => {
      const res = mockRes();
      await createIncidencia(mockReq({
        params: { id: '1' },
        body: { descripcion: '', tipo: 'dano_exterior' },
        user: { id: 1, username: 'admin' },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when vehicle not found', async () => {
      query.mockResolvedValueOnce([[]]); // vehicle not found
      const res = mockRes();
      await createIncidencia(mockReq({
        params: { id: '999' },
        body: { descripcion: 'Rayón lateral', tipo: 'dano_exterior' },
        user: { id: 1, username: 'admin' },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('creates an incidencia', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle exists
      query.mockResolvedValueOnce([{ insertId: 15 }]); // insert
      query.mockResolvedValueOnce([[{ id: 15, tipo: 'dano_exterior', descripcion: 'Rayón' }]]);

      const req = mockReq({
        params: { id: '1' },
        body: { descripcion: 'Rayón lateral', tipo: 'dano_exterior' },
        user: { id: 1, username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await createIncidencia(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  // ── updateIncidencia ───────────────────────────────────
  describe('updateIncidencia', () => {
    it('updates incidencia', async () => {
      query.mockResolvedValueOnce([[{ id: 15, estado: 'pendiente' }]]); // exists
      query.mockResolvedValueOnce([]); // UPDATE
      query.mockResolvedValueOnce([[{ id: 15, estado: 'resuelto' }]]);

      const req = mockReq({
        params: { vehicleId: '1', incId: '15' },
        body: { estado: 'resuelto' },
        user: { id: 1, username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await updateIncidencia(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await updateIncidencia(mockReq({ params: { vehicleId: '1', incId: '999' }, body: { estado: 'resuelto' }, user: { id: 1, username: 'admin' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('sets resuelto_by and resuelto_at when transitioning to resuelto', async () => {
      query.mockResolvedValueOnce([[{ id: 15, estado: 'pendiente' }]]); // exists, estado=pendiente
      query.mockResolvedValueOnce([]); // UPDATE
      query.mockResolvedValueOnce([[{ id: 15, estado: 'resuelto' }]]);

      const req = mockReq({
        params: { vehicleId: '1', incId: '15' },
        body: { estado: 'resuelto' },
        user: { id: 1, username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await updateIncidencia(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      // The UPDATE SQL should include resuelto_by and resuelto_at
      const updateSql = query.mock.calls[1][0];
      expect(updateSql).toContain('resuelto_by');
      expect(updateSql).toContain('resuelto_at');
    });

    it('returns 400 when no fields to update', async () => {
      query.mockResolvedValueOnce([[{ id: 15, estado: 'pendiente' }]]); // exists
      const res = mockRes();
      await updateIncidencia(mockReq({
        params: { vehicleId: '1', incId: '15' },
        body: {},
        user: { id: 1, username: 'admin' },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── listRevisiones ─────────────────────────────────────
  describe('listRevisiones', () => {
    it('returns revisiones', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle exists
      query.mockResolvedValueOnce([[{ id: 5, tipo: 'itv', resultado: 'realizado' }]]);

      const res = mockRes();
      await listRevisiones(mockReq({ params: { id: '1' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ── createRevision ─────────────────────────────────────
  describe('createRevision', () => {
    it('creates revision and updates vehicle date', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle exists
      query.mockResolvedValueOnce([{ insertId: 8 }]); // insert
      query.mockResolvedValueOnce([]); // update vehicle fecha_itv
      query.mockResolvedValueOnce([[{ id: 8, tipo: 'itv', resultado: 'realizado', creado_por_nombre: 'Admin' }]]);

      const req = mockReq({
        params: { id: '1' },
        body: { tipo: 'itv', fecha_revision: '2026-04-01' },
        user: { id: 1, username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await createRevision(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns 400 when tipo missing', async () => {
      const res = mockRes();
      await createRevision(mockReq({ params: { id: '1' }, body: { fecha_revision: '2026-04-01' }, user: { id: 1 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when vehicle not found', async () => {
      query.mockResolvedValueOnce([[]]); // vehicle not found
      const res = mockRes();
      await createRevision(mockReq({
        params: { id: '999' },
        body: { tipo: 'itv', fecha_revision: '2026-04-01' },
        user: { id: 1, username: 'admin' },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('creates revision with tipo=its and updates fecha_its', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle exists
      query.mockResolvedValueOnce([{ insertId: 9 }]); // insert
      query.mockResolvedValueOnce([]); // UPDATE vehicles fecha_its
      query.mockResolvedValueOnce([[{ id: 9, tipo: 'its', resultado: 'realizado', creado_por_nombre: 'Admin' }]]);

      const req = mockReq({
        params: { id: '1' },
        body: { tipo: 'its', fecha_revision: '2026-04-01' },
        user: { id: 1, username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await createRevision(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
      // Should have called UPDATE for fecha_its
      const updateCall = query.mock.calls[2][0];
      expect(updateCall).toContain('fecha_its');
    });

    it('creates revision with tipo=mantenimiento and updates fecha_ultima_revision', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle exists
      query.mockResolvedValueOnce([{ insertId: 10 }]); // insert
      query.mockResolvedValueOnce([]); // UPDATE vehicles fecha_ultima_revision
      query.mockResolvedValueOnce([[{ id: 10, tipo: 'mantenimiento', resultado: 'realizado', creado_por_nombre: 'Admin' }]]);

      const req = mockReq({
        params: { id: '1' },
        body: { tipo: 'mantenimiento', fecha_revision: '2026-04-01' },
        user: { id: 1, username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await createRevision(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
      const updateCall = query.mock.calls[2][0];
      expect(updateCall).toContain('fecha_ultima_revision');
    });
  });

  // ── updateRevision ─────────────────────────────────────
  describe('updateRevision', () => {
    it('returns 404 when revision not found', async () => {
      query.mockResolvedValueOnce([[]]); // not found
      const res = mockRes();
      await updateRevision(mockReq({
        params: { vehicleId: '1', revId: '999' },
        body: { descripcion: 'Updated' },
        user: { id: 1 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 when no fields to update', async () => {
      query.mockResolvedValueOnce([[{ id: 8 }]]); // exists
      const res = mockRes();
      await updateRevision(mockReq({
        params: { vehicleId: '1', revId: '8' },
        body: {},
        user: { id: 1 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('updates revision', async () => {
      query.mockResolvedValueOnce([[{ id: 8 }]]); // exists
      query.mockResolvedValueOnce([]); // UPDATE
      query.mockResolvedValueOnce([[{ id: 8, tipo: 'itv', creado_por_nombre: 'Admin' }]]);

      const res = mockRes();
      await updateRevision(mockReq({
        params: { vehicleId: '1', revId: '8' },
        body: { descripcion: 'Completada' },
        user: { id: 1 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ── deleteRevision ─────────────────────────────────────
  describe('deleteRevision', () => {
    it('deletes revision', async () => {
      query.mockResolvedValueOnce([[{ id: 8 }]]); // exists
      query.mockResolvedValueOnce([]); // DELETE

      const res = mockRes();
      await deleteRevision(mockReq({ params: { vehicleId: '1', revId: '8' }, user: { id: 1 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await deleteRevision(mockReq({ params: { vehicleId: '1', revId: '999' }, user: { id: 1 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });
});

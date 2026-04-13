'use strict';

const { query, transaction } = require('../../../config/database');

jest.mock('../../../controllers/admin.controller', () => ({
  logAudit: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../../middleware/upload.middleware', () => ({
  processAndSave: jest.fn(),
  deleteFile: jest.fn(),
}));

const {
  listTrabajos, listTrabajosCalendario, getTrabajo, createTrabajo,
  updateTrabajo, deleteTrabajo, finalizeTrabajo, uploadEvidencia,
  misTrab, activarTrabajo,
} = require('../../../controllers/trabajos.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');
const { IMAGEN_TIPOS_REQUERIDOS } = require('../../../config/constants');

// Helper to mock getTrabajoCompleto (4 queries, all destructured)
function mockGetTrabajoCompleto(trabajo = {}) {
  const base = {
    id: 1, identificador: 'TRB-2026-0001', nombre: 'Test', tipo: 'programado',
    estado: 'activo', fecha_inicio: new Date(), fecha_fin: new Date(Date.now() + 86400000),
    creado_por_nombre: 'Admin', creado_por_apellidos: 'U',
    ...trabajo,
  };
  query.mockResolvedValueOnce([[base]]);  // trabajo
  query.mockResolvedValueOnce([[]]);      // vehiculos
  query.mockResolvedValueOnce([[]]);      // usuarios
  query.mockResolvedValueOnce([[]]);      // evidencias
}

describe('trabajos.controller', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── listTrabajos ───────────────────────────────────────
  describe('listTrabajos', () => {
    it('returns paginated list', async () => {
      query.mockResolvedValueOnce([[{ total: 2 }]]);
      query.mockResolvedValueOnce([[
        { id: 1, identificador: 'TRB-001', nombre: 'T1', num_vehiculos: 1, num_usuarios: 2 },
        { id: 2, identificador: 'TRB-002', nombre: 'T2', num_vehiculos: 0, num_usuarios: 0 },
      ]]);

      const req = mockReq({ query: {}, user: { id: 1, roles: ['administrador'] } });
      const res = mockRes();
      await listTrabajos(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toHaveLength(2);
    });

    it('filters for operacionales', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, identificador: 'TRB-001' }]]);

      const req = mockReq({ query: {}, user: { id: 5, roles: ['tecnico'] } });
      const res = mockRes();
      await listTrabajos(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('applies all filters (estado, tipo, fecha_desde, fecha_hasta, search)', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, identificador: 'TRB-2026-0001', nombre: 'Test' }]]);

      const req = mockReq({
        query: {
          estado: 'activo',
          tipo: 'programado',
          fecha_desde: '2026-01-01',
          fecha_hasta: '2026-12-31',
          search: 'TRB',
        },
        user: { id: 1, roles: ['administrador'] },
      });
      const res = mockRes();
      await listTrabajos(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      // Verify that filter params were passed to query
      const countParams = query.mock.calls[0][1];
      expect(countParams).toContain('activo');
      expect(countParams).toContain('programado');
      expect(countParams).toContain('%TRB%');
    });
  });

  // ── listTrabajosCalendario ─────────────────────────────
  describe('listTrabajosCalendario', () => {
    it('returns trabajos for month', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'activo' }]]);

      const req = mockReq({ query: { year: '2026', month: '4' }, user: { id: 1, roles: ['administrador'] } });
      const res = mockRes();
      await listTrabajosCalendario(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('adds EXISTS clause for operacional user', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'activo' }]]);

      const req = mockReq({ query: { year: '2026', month: '4' }, user: { id: 5, roles: ['tecnico'] } });
      const res = mockRes();
      await listTrabajosCalendario(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      const sql = query.mock.calls[0][0];
      expect(sql).toContain('EXISTS');
      expect(query.mock.calls[0][1]).toContain(5);
    });

    it('wraps to next year when month=12', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'activo' }]]);

      const req = mockReq({ query: { year: '2026', month: '12' }, user: { id: 1, roles: ['administrador'] } });
      const res = mockRes();
      await listTrabajosCalendario(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      // hasta should be 2027-01-01
      const params = query.mock.calls[0][1];
      expect(params[0]).toContain('2027');
    });
  });

  // ── getTrabajo ─────────────────────────────────────────
  describe('getTrabajo', () => {
    it('returns trabajo completo', async () => {
      mockGetTrabajoCompleto();
      const req = mockReq({ params: { id: '1' }, user: { id: 1, roles: ['administrador'] } });
      const res = mockRes();
      await getTrabajo(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data.identificador).toBe('TRB-2026-0001');
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]); // getTrabajoCompleto returns null
      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '999' }, user: { id: 1, roles: ['administrador'] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 for operacional not assigned to trabajo', async () => {
      // getTrabajoCompleto — trabajo returned but usuarios list doesn't include user 5
      const base = {
        id: 1, identificador: 'TRB-2026-0001', nombre: 'Test', tipo: 'programado',
        estado: 'activo', fecha_inicio: new Date(), fecha_fin: new Date(Date.now() + 86400000),
        creado_por_nombre: 'Admin', creado_por_apellidos: 'U',
      };
      query.mockResolvedValueOnce([[base]]);    // trabajo
      query.mockResolvedValueOnce([[]]);        // vehiculos
      query.mockResolvedValueOnce([[{ user_id: 99, username: 'other' }]]); // usuarios (not user 5)
      query.mockResolvedValueOnce([[]]);        // evidencias

      const req = mockReq({ params: { id: '1' }, user: { id: 5, roles: ['tecnico'] } });
      const res = mockRes();
      await getTrabajo(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── createTrabajo ──────────────────────────────────────
  describe('createTrabajo', () => {
    it('creates trabajo', async () => {
      // generateIdentificador
      query.mockResolvedValueOnce([[]]);
      // transaction
      transaction.mockImplementation(async (cb) => {
        const conn = { execute: jest.fn().mockResolvedValue([{ insertId: 10 }]) };
        return cb(conn);
      });
      mockGetTrabajoCompleto({ id: 10 });

      const req = mockReq({
        body: {
          nombre: 'Nuevo', tipo: 'programado',
          fecha_inicio: '2026-04-15T08:00', fecha_fin: '2026-04-15T20:00',
          vehiculos: [{ vehicle_id: 1, responsable_user_id: 2 }],
          usuarios: [2],
        },
        user: { id: 1, username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await createTrabajo(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns 400 when fecha_fin <= fecha_inicio', async () => {
      const res = mockRes();
      await createTrabajo(mockReq({
        body: {
          nombre: 'Bad dates', tipo: 'programado',
          fecha_inicio: '2026-04-15T20:00', fecha_fin: '2026-04-15T08:00',
          vehiculos: [], usuarios: [],
        },
        user: { id: 1, username: 'admin' },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('increments sequence when existing identificador found', async () => {
      // generateIdentificador finds existing TRB-2026-0003
      query.mockResolvedValueOnce([[{ identificador: 'TRB-2026-0003' }]]);
      transaction.mockImplementation(async (cb) => {
        const conn = { execute: jest.fn().mockResolvedValue([{ insertId: 20 }]) };
        return cb(conn);
      });
      mockGetTrabajoCompleto({ id: 20, identificador: 'TRB-2026-0004' });

      const req = mockReq({
        body: {
          nombre: 'Seq test', tipo: 'programado',
          fecha_inicio: '2026-04-15T08:00', fecha_fin: '2026-04-15T20:00',
          vehiculos: [], usuarios: [],
        },
        user: { id: 1, username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await createTrabajo(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('creates trabajo with km_inicio (covers km update branch)', async () => {
      query.mockResolvedValueOnce([[]]);
      transaction.mockImplementation(async (cb) => {
        const conn = { execute: jest.fn().mockResolvedValue([{ insertId: 11 }]) };
        return cb(conn);
      });
      mockGetTrabajoCompleto({ id: 11 });

      const req = mockReq({
        body: {
          nombre: 'With km', tipo: 'programado',
          fecha_inicio: '2026-04-15T08:00', fecha_fin: '2026-04-15T20:00',
          vehiculos: [{ vehicle_id: 1, responsable_user_id: 2, kilometros_inicio: 10000 }],
          usuarios: [],
        },
        user: { id: 1, username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await createTrabajo(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  // ── updateTrabajo ──────────────────────────────────────
  describe('updateTrabajo', () => {
    it('updates trabajo', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'programado' }]]);
      transaction.mockImplementation(async (cb) => {
        const conn = { execute: jest.fn().mockResolvedValue([]) };
        return cb(conn);
      });
      mockGetTrabajoCompleto();

      const req = mockReq({ params: { id: '1' }, body: { nombre: 'Updated' }, user: { id: 1, username: 'admin' }, ip: '1.1.1.1' });
      const res = mockRes();
      await updateTrabajo(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 for finalizado trabajo', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'finalizado' }]]);
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: { nombre: 'X' }, user: { id: 1 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 for finalizado_anticipado trabajo', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'finalizado_anticipado' }]]);
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: { nombre: 'X' }, user: { id: 1 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('updates trabajo with vehiculos and usuarios reassignment', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'programado' }]]);
      transaction.mockImplementation(async (cb) => {
        const conn = { execute: jest.fn().mockResolvedValue([]) };
        return cb(conn);
      });
      mockGetTrabajoCompleto();

      const req = mockReq({
        params: { id: '1' },
        body: {
          nombre: 'Updated',
          vehiculos: [{ vehicle_id: 2, responsable_user_id: 3 }],
          usuarios: [3, 4],
        },
        user: { id: 1, username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await updateTrabajo(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ── deleteTrabajo ──────────────────────────────────────
  describe('deleteTrabajo', () => {
    it('soft deletes', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'programado' }]]);
      query.mockResolvedValueOnce([]); // UPDATE

      const req = mockReq({ params: { id: '1' }, user: { id: 1, username: 'admin' }, ip: '1.1.1.1' });
      const res = mockRes();
      await deleteTrabajo(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 for active trabajo', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'activo' }]]);
      const res = mockRes();
      await deleteTrabajo(mockReq({ params: { id: '1' }, user: { id: 1 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await deleteTrabajo(mockReq({ params: { id: '999' }, user: { id: 1 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── finalizeTrabajo ────────────────────────────────────
  describe('finalizeTrabajo', () => {
    it('finalizes with evidence complete', async () => {
      // existing query (trabajo + vehicles) - past fecha_fin
      query.mockResolvedValueOnce([[
        { id: 1, estado: 'activo', fecha_fin: new Date(Date.now() - 3600000), vehicle_id: 1, responsable_user_id: 2 },
      ]]);
      // evidence check for vehicle 1
      const allTipos = IMAGEN_TIPOS_REQUERIDOS.map(t => ({ tipo_imagen: t }));
      query.mockResolvedValueOnce([allTipos]);
      // transaction
      transaction.mockImplementation(async (cb) => {
        const conn = { execute: jest.fn().mockResolvedValue([]) };
        return cb(conn);
      });
      // getTrabajoCompleto
      mockGetTrabajoCompleto({ estado: 'finalizado' });

      const req = mockReq({
        params: { id: '1' },
        body: { vehiculos_km: [{ vehicle_id: 1, kilometros_fin: 50000 }] },
        user: { id: 1, roles: ['administrador'], username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await finalizeTrabajo(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await finalizeTrabajo(mockReq({ params: { id: '999' }, body: { vehiculos_km: [] }, user: { id: 1, roles: ['administrador'] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 for operacional who is not responsable', async () => {
      query.mockResolvedValueOnce([[
        { id: 1, estado: 'activo', fecha_fin: new Date(Date.now() + 86400000), vehicle_id: 1, responsable_user_id: 99 },
      ]]);
      const res = mockRes();
      await finalizeTrabajo(mockReq({
        params: { id: '1' },
        body: { vehiculos_km: [] },
        user: { id: 5, roles: ['tecnico'] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 400 when trabajo already finalizado', async () => {
      query.mockResolvedValueOnce([[
        { id: 1, estado: 'finalizado', fecha_fin: new Date(Date.now() - 3600000), vehicle_id: 1, responsable_user_id: 1 },
      ]]);
      const res = mockRes();
      await finalizeTrabajo(mockReq({
        params: { id: '1' },
        body: { vehiculos_km: [{ vehicle_id: 1, kilometros_fin: 50000 }] },
        user: { id: 1, roles: ['administrador'] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when anticipado without motivo', async () => {
      query.mockResolvedValueOnce([[
        { id: 1, estado: 'activo', fecha_fin: new Date(Date.now() + 86400000), vehicle_id: 1, responsable_user_id: 1 },
      ]]);
      const res = mockRes();
      await finalizeTrabajo(mockReq({
        params: { id: '1' },
        body: { vehiculos_km: [{ vehicle_id: 1, kilometros_fin: 50000 }] }, // no motivo
        user: { id: 1, roles: ['administrador'] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when evidence incomplete', async () => {
      query.mockResolvedValueOnce([[
        { id: 1, estado: 'activo', fecha_fin: new Date(Date.now() - 3600000), vehicle_id: 1, responsable_user_id: 1 },
      ]]);
      // evidence check for vehicle 1 returns empty (no images)
      query.mockResolvedValueOnce([[]]);

      const res = mockRes();
      await finalizeTrabajo(mockReq({
        params: { id: '1' },
        body: { vehiculos_km: [{ vehicle_id: 1, kilometros_fin: 50000 }] },
        user: { id: 1, roles: ['administrador'] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when km missing for a vehicle', async () => {
      query.mockResolvedValueOnce([[
        { id: 1, estado: 'activo', fecha_fin: new Date(Date.now() - 3600000), vehicle_id: 1, responsable_user_id: 1 },
      ]]);
      // All evidence provided
      const allTipos = IMAGEN_TIPOS_REQUERIDOS.map(t => ({ tipo_imagen: t }));
      query.mockResolvedValueOnce([allTipos]);

      const res = mockRes();
      await finalizeTrabajo(mockReq({
        params: { id: '1' },
        body: { vehiculos_km: [] }, // no km provided
        user: { id: 1, roles: ['administrador'] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('finalizes anticipado when motivo provided', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      query.mockResolvedValueOnce([[
        { id: 1, estado: 'activo', fecha_fin: futureDate, vehicle_id: 1, responsable_user_id: 1 },
      ]]);
      const allTipos = IMAGEN_TIPOS_REQUERIDOS.map(t => ({ tipo_imagen: t }));
      query.mockResolvedValueOnce([allTipos]);
      transaction.mockImplementation(async (cb) => {
        const conn = { execute: jest.fn().mockResolvedValue([]) };
        return cb(conn);
      });
      mockGetTrabajoCompleto({ estado: 'finalizado_anticipado' });

      const req = mockReq({
        params: { id: '1' },
        body: {
          vehiculos_km: [{ vehicle_id: 1, kilometros_fin: 50000 }],
          motivo_finalizacion_anticipada: 'Fin anticipado por motivo X',
        },
        user: { id: 1, roles: ['administrador'], username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await finalizeTrabajo(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ── uploadEvidencia ────────────────────────────────────
  describe('uploadEvidencia', () => {
    it('uploads evidence image', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'activo' }]]); // trabajo
      query.mockResolvedValueOnce([[{ id: 10 }]]); // vehicle assigned
      query.mockResolvedValueOnce([[]]); // no existing image
      query.mockResolvedValueOnce([{ insertId: 30 }]); // insert
      query.mockResolvedValueOnce([[{ tipo_imagen: 'frontal' }]]); // progress

      const req = mockReq({
        params: { id: '1' },
        body: { vehicle_id: '1', tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/img.jpg' },
        user: { id: 2 },
      });
      const res = mockRes();
      await uploadEvidencia(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns 400 when no file', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'activo' }]]);
      query.mockResolvedValueOnce([[{ id: 10 }]]);

      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' },
        body: { vehicle_id: '1', tipo_imagen: 'frontal' },
        user: { id: 2 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when vehicle_id missing', async () => {
      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' },
        body: { tipo_imagen: 'frontal' }, // no vehicle_id
        processedFile: { url: '/uploads/img.jpg' },
        user: { id: 2 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 for invalid tipo_imagen', async () => {
      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' },
        body: { vehicle_id: '1', tipo_imagen: 'invalid_type' },
        processedFile: { url: '/uploads/img.jpg' },
        user: { id: 2 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when trabajo already finalizado', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'finalizado' }]]);

      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' },
        body: { vehicle_id: '1', tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/img.jpg' },
        user: { id: 2 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when vehicle not assigned to trabajo', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'activo' }]]);
      query.mockResolvedValueOnce([[]]); // not assigned

      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' },
        body: { vehicle_id: '1', tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/img.jpg' },
        user: { id: 2 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('overwrites existing image (UPDATE path)', async () => {
      const { deleteFile } = require('../../../middleware/upload.middleware');

      query.mockResolvedValueOnce([[{ id: 1, estado: 'activo' }]]);       // trabajo
      query.mockResolvedValueOnce([[{ id: 10 }]]);                         // vehicle assigned
      query.mockResolvedValueOnce([[{ id: 50, image_url: '/uploads/old.jpg' }]]); // existing image
      query.mockResolvedValueOnce([]);                                      // UPDATE
      query.mockResolvedValueOnce([[{ tipo_imagen: 'frontal' }]]);          // progress

      const req = mockReq({
        params: { id: '1' },
        body: { vehicle_id: '1', tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/new.jpg' },
        user: { id: 2 },
      });
      const res = mockRes();
      await uploadEvidencia(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
      expect(deleteFile).toHaveBeenCalledWith('/uploads/old.jpg');
    });
  });

  // ── misTrab ────────────────────────────────────────────
  describe('misTrab', () => {
    it('returns user trabajos', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, identificador: 'TRB-001', estado: 'activo', soy_responsable: 1 }]]);

      const req = mockReq({ query: {}, user: { id: 5 } });
      const res = mockRes();
      await misTrab(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('paginates correctly with page=2', async () => {
      query.mockResolvedValueOnce([[{ total: 25 }]]);
      query.mockResolvedValueOnce([[{ id: 21, identificador: 'TRB-021', estado: 'activo', soy_responsable: 0 }]]);

      const req = mockReq({ query: { page: '2' }, user: { id: 5 } });
      const res = mockRes();
      await misTrab(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      // Second page offset: (2-1)*20 = 20, so the limit/offset params should reflect page 2
      const limitOffsetParams = query.mock.calls[1][1];
      expect(limitOffsetParams).toContain(20); // offset=20
    });
  });

  // ── activarTrabajo ─────────────────────────────────────
  describe('activarTrabajo', () => {
    it('activates programado trabajo', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'programado', fecha_inicio: new Date(Date.now() + 3600000) }]]);
      query.mockResolvedValueOnce([]); // UPDATE
      mockGetTrabajoCompleto({ estado: 'activo' });

      const req = mockReq({ params: { id: '1' }, user: { id: 1, roles: ['administrador'], username: 'admin' }, ip: '1.1.1.1' });
      const res = mockRes();
      await activarTrabajo(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 for non-programado', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'activo' }]]);
      const res = mockRes();
      await activarTrabajo(mockReq({ params: { id: '1' }, user: { id: 1, roles: ['administrador'] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when trabajo not found', async () => {
      query.mockResolvedValueOnce([[]]); // not found
      const res = mockRes();
      await activarTrabajo(mockReq({ params: { id: '999' }, user: { id: 1, roles: ['administrador'] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 for operacional who is not responsable', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'programado', fecha_inicio: new Date(Date.now() + 3600000) }]]);
      // responsable query returns empty (not responsable)
      query.mockResolvedValueOnce([[]]);

      const res = mockRes();
      await activarTrabajo(mockReq({
        params: { id: '1' },
        user: { id: 5, roles: ['tecnico'], username: 'tec' },
        ip: '1.1.1.1',
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 400 for operacional activating >24h before start', async () => {
      // fecha_inicio is 48h away
      query.mockResolvedValueOnce([[{ id: 1, estado: 'programado', fecha_inicio: new Date(Date.now() + 48 * 3600000) }]]);
      // operacional IS responsable
      query.mockResolvedValueOnce([[{ id: 5 }]]);

      const res = mockRes();
      await activarTrabajo(mockReq({
        params: { id: '1' },
        user: { id: 5, roles: ['tecnico'], username: 'tec' },
        ip: '1.1.1.1',
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});

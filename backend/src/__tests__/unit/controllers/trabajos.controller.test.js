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
const { IMAGEN_TIPOS_INICIO, IMAGEN_TIPOS_FIN } =
  require('../../../config/constants');

// Filas de vehicle_images que cubren TODAS las fotos requeridas de inicio y fin,
// cada una con su `momento` (lo que finalizeTrabajo usa para validar evidencias).
function evidenciaCompletaRows() {
  return [
    ...IMAGEN_TIPOS_INICIO.map(t => ({ tipo_imagen: t, momento: 'inicio' })),
    ...IMAGEN_TIPOS_FIN.map(t => ({ tipo_imagen: t, momento: 'fin' })),
  ];
}

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
  // clearAllMocks NO vacía la cola de mockResolvedValueOnce; mockReset sí.
  // Sin esto, los valores encolados y no consumidos por un test se filtran al
  // siguiente y corrompen sus resultados de `query`.
  beforeEach(() => { jest.clearAllMocks(); query.mockReset(); transaction.mockReset(); });

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
      // `hasta` es el 1 de enero de 2027 a las 00:00 de España, que en UTC
      // (que es como se guarda) son las 23:00 del 31 de diciembre.
      const params = query.mock.calls[0][1];
      expect(params[0].toISOString()).toBe('2026-12-31T23:00:00.000Z');
    });

    it('acota el mes por la medianoche española, no por la UTC', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'activo' }]]);

      const req = mockReq({ query: { year: '2026', month: '7' }, user: { id: 1, roles: ['administrador'] } });
      const res = mockRes();
      await listTrabajosCalendario(req, res, mockNext());
      const [hasta, desde] = query.mock.calls[0][1];
      // Julio: horario de verano, +02:00
      expect(desde.toISOString()).toBe('2026-06-30T22:00:00.000Z');
      expect(hasta.toISOString()).toBe('2026-07-31T22:00:00.000Z');
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
      // evidence check for vehicle 1 — evidencias completas (inicio + fin)
      query.mockResolvedValueOnce([evidenciaCompletaRows()]);
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

    // Los roles no son excluyentes: el jefe que ademas sale de servicio lleva
    // `tecnico`, y eso no puede convertirlo en un operacional cualquiera.
    it('un administrador que ademas es tecnico finaliza sin ser responsable', async () => {
      query.mockResolvedValueOnce([[
        { id: 1, estado: 'activo', fecha_fin: new Date(Date.now() - 3600000), vehicle_id: 1, responsable_user_id: 99 },
      ]]);
      query.mockResolvedValueOnce([evidenciaCompletaRows()]);
      transaction.mockImplementation(async (cb) => cb({ execute: jest.fn().mockResolvedValue([]) }));
      mockGetTrabajoCompleto({ estado: 'finalizado' });

      const res = mockRes();
      await finalizeTrabajo(mockReq({
        params: { id: '1' },
        body: { vehiculos_km: [{ vehicle_id: 1, kilometros_fin: 50000 }] },
        user: { id: 5, roles: ['administrador', 'tecnico'], username: 'jefe' },
        ip: '1.1.1.1',
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
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
      // All evidence provided → debe fallar por los km, no por las fotos
      query.mockResolvedValueOnce([evidenciaCompletaRows()]);

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
      query.mockResolvedValueOnce([evidenciaCompletaRows()]);
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

    it('un administrador que ademas es tecnico activa sin ser responsable y sin la ventana de 24h', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'programado', fecha_inicio: new Date(Date.now() + 48 * 3600000) }]]);
      query.mockResolvedValueOnce([[]]); // UPDATE; no se llega a consultar responsable_user_id
      mockGetTrabajoCompleto({ estado: 'activo' });

      const res = mockRes();
      await activarTrabajo(mockReq({
        params: { id: '1' },
        user: { id: 5, roles: ['administrador', 'tecnico'], username: 'jefe' },
        ip: '1.1.1.1',
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
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

  // ── getTrabajo: progreso de fotos por vehículo ─────────
  // Es lo que el técnico ve en la ficha para saber qué le falta por subir.
  describe('getTrabajo → progreso_fotos', () => {
    const vehiculo = (vehicle_id, extra = {}) => ({
      asignacion_id: vehicle_id, vehicle_id, responsable_user_id: 5,
      matricula: `000${vehicle_id}ABC`, vehiculo_alias: `Ambulancia ${vehicle_id}`,
      ...extra,
    });
    const foto = (vehicle_id, tipo_imagen, momento) => ({
      id: `${vehicle_id}-${momento}-${tipo_imagen}`, vehicle_id, tipo_imagen, momento,
    });

    /** Encola las 4 consultas de getTrabajoCompleto con vehículos y fotos reales. */
    function mockFicha(vehicles, images) {
      query.mockResolvedValueOnce([[{
        id: 1, identificador: 'TRB-2026-0001', nombre: 'Test', tipo: 'programado',
        estado: 'activo', fecha_inicio: new Date(), fecha_fin: new Date(Date.now() + 86400000),
        creado_por_nombre: 'Admin', creado_por_apellidos: 'U',
      }]]);
      query.mockResolvedValueOnce([vehicles]);
      query.mockResolvedValueOnce([[]]);
      query.mockResolvedValueOnce([images]);
    }

    const admin = { id: 1, roles: ['administrador'] };

    it('sin ninguna foto, el progreso arranca a cero y lista todo lo que falta', async () => {
      mockFicha([vehiculo(7)], []);

      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());

      const { progreso_fotos } = res._json.data.vehiculos[0];
      expect(progreso_fotos.inicio).toEqual({
        completado: 0,
        total: IMAGEN_TIPOS_INICIO.length,
        faltantes: IMAGEN_TIPOS_INICIO,
        completo: false,
      });
      expect(progreso_fotos.fin).toEqual({
        completado: 0,
        total: IMAGEN_TIPOS_FIN.length,
        faltantes: IMAGEN_TIPOS_FIN,
        completo: false,
      });
    });

    it('cuenta solo las fotos del momento que toca', async () => {
      // Todas las de inicio subidas; de fin, ninguna.
      mockFicha(
        [vehiculo(7)],
        IMAGEN_TIPOS_INICIO.map(t => foto(7, t, 'inicio'))
      );

      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());

      const { progreso_fotos } = res._json.data.vehiculos[0];
      expect(progreso_fotos.inicio.completo).toBe(true);
      expect(progreso_fotos.inicio.faltantes).toEqual([]);
      expect(progreso_fotos.fin.completo).toBe(false);
      expect(progreso_fotos.fin.completado).toBe(0);
    });

    it('una tanda a medias dice exactamente qué tipos faltan', async () => {
      mockFicha([vehiculo(7)], [
        foto(7, 'frontal', 'fin'),
        foto(7, 'trasera', 'fin'),
      ]);

      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());

      const { fin } = res._json.data.vehiculos[0].progreso_fotos;
      expect(fin.completado).toBe(2);
      expect(fin.faltantes).toEqual(
        IMAGEN_TIPOS_FIN.filter(t => !['frontal', 'trasera'].includes(t)));
      expect(fin.completo).toBe(false);
    });

    it('las fotos de un vehículo no cuentan para el de al lado', async () => {
      mockFicha(
        [vehiculo(7), vehiculo(8)],
        IMAGEN_TIPOS_INICIO.map(t => foto(7, t, 'inicio'))
      );

      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());

      const [v7, v8] = res._json.data.vehiculos;
      expect(v7.progreso_fotos.inicio.completo).toBe(true);
      expect(v8.progreso_fotos.inicio.completo).toBe(false);
      expect(v8.progreso_fotos.inicio.completado).toBe(0);
    });

    it('las fotos "general" (daños) no cuentan para el progreso: no bloquean', async () => {
      mockFicha([vehiculo(7)], [
        ...IMAGEN_TIPOS_FIN.map(t => foto(7, t, 'fin')),
        foto(7, 'danos', 'general'),
      ]);

      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());

      const { fin } = res._json.data.vehiculos[0].progreso_fotos;
      expect(fin.completo).toBe(true);
      expect(fin.completado).toBe(IMAGEN_TIPOS_FIN.length);
    });

    it('una foto repetida no infla el contador por encima del total', async () => {
      mockFicha([vehiculo(7)], [
        foto(7, 'frontal', 'fin'),
        { ...foto(7, 'frontal', 'fin'), id: 'repetida' },
      ]);

      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());

      const { fin } = res._json.data.vehiculos[0].progreso_fotos;
      expect(fin.completado).toBe(1);
      expect(fin.completado).toBeLessThanOrEqual(fin.total);
    });

    it('los roles del personal llegan como array, no como el GROUP_CONCAT crudo', async () => {
      query.mockResolvedValueOnce([[{
        id: 1, identificador: 'TRB-2026-0001', nombre: 'Test', tipo: 'programado',
        estado: 'activo', fecha_inicio: new Date(), fecha_fin: new Date(Date.now() + 86400000),
        creado_por_nombre: 'Admin', creado_por_apellidos: 'U',
      }]]);
      query.mockResolvedValueOnce([[]]);
      query.mockResolvedValueOnce([[
        { user_id: 5, username: 'tec', roles: 'tecnico,enfermero' },
        { user_id: 6, username: 'sinrol', roles: null },
      ]]);
      query.mockResolvedValueOnce([[]]);

      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());

      expect(res._json.data.usuarios[0].roles).toEqual(['tecnico', 'enfermero']);
      expect(res._json.data.usuarios[1].roles).toEqual([]);
    });
  });

  // ── updateTrabajo: cambio de estado ────────────────────
  describe('updateTrabajo → estado', () => {
    /** Encola el SELECT previo y captura los execute de la transacción. */
    function prepararUpdate() {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'programado' }]]);
      const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
      transaction.mockImplementation(async (cb) => cb({ execute }));
      return execute;
    }

    it('acepta volver a programado o pasar a activo', async () => {
      for (const estado of ['programado', 'activo']) {
        query.mockReset(); transaction.mockReset();
        const execute = prepararUpdate();
        mockGetTrabajoCompleto();

        await updateTrabajo(mockReq({
          params: { id: '1' }, body: { estado }, user: { id: 1, roles: ['administrador'], username: 'admin' },
        }), mockRes(), mockNext());

        const [sql, vals] = execute.mock.calls[0];
        expect(sql).toContain('estado = ?');
        expect(vals).toContain(estado);
      }
    });

    it('ignora un estado que no se puede poner a mano', async () => {
      // Finalizar tiene su propio endpoint, con las validaciones de evidencias.
      const execute = prepararUpdate();
      mockGetTrabajoCompleto();

      await updateTrabajo(mockReq({
        params: { id: '1' }, body: { estado: 'finalizado', nombre: 'Otro' },
        user: { id: 1, roles: ['administrador'], username: 'admin' },
      }), mockRes(), mockNext());

      const [sql, vals] = execute.mock.calls[0];
      expect(sql).not.toContain('estado = ?');
      expect(vals).not.toContain('finalizado');
      expect(sql).toContain('nombre = ?'); // el resto del update sí se aplica
    });
  });

  // ── finalizeTrabajo: alcance por responsable ───────────
  describe('finalizeTrabajo → qué vehículos debe documentar cada uno', () => {
    const trabajoAbierto = (vehiculos) => {
      query.mockResolvedValueOnce([vehiculos.map(v => ({
        id: 1, estado: 'activo', fecha_fin: new Date(Date.now() - 3600000), // ya pasó: no es anticipado
        ...v,
      }))]);
    };

    it('un operacional solo responde de los vehículos en los que es responsable', async () => {
      trabajoAbierto([
        { vehicle_id: 7, responsable_user_id: 5 },
        { vehicle_id: 8, responsable_user_id: 99 }, // de otro técnico
      ]);
      // Solo se comprueban las evidencias del 7: una sola consulta de fotos.
      query.mockResolvedValueOnce([evidenciaCompletaRows()]);
      const execute = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
      transaction.mockImplementation(async (cb) => cb({ execute }));
      mockGetTrabajoCompleto();

      const res = mockRes();
      await finalizeTrabajo(mockReq({
        params: { id: '1' },
        body: { vehiculos_km: [{ vehicle_id: 7, kilometros_fin: 120500 }] },
        user: { id: 5, roles: ['tecnico'], username: 'tec' },
      }), res, mockNext());

      // La comprobación de evidencias se hizo para el 7 y no para el 8.
      // (se filtra por esta consulta concreta: getTrabajoCompleto lee
      // vehicle_images otra vez al recomponer la ficha de respuesta)
      const consultasFotos = query.mock.calls.filter(
        ([sql]) => sql.includes('SELECT tipo_imagen, momento FROM vehicle_images'));
      expect(consultasFotos).toHaveLength(1);
      expect(consultasFotos[0][1]).toEqual([7, 1]);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('sin las fotos de INICIO no se puede finalizar, y lo dice', async () => {
      trabajoAbierto([{ vehicle_id: 7, responsable_user_id: 5 }]);
      // Solo hay fotos de fin: faltan todas las de inicio.
      query.mockResolvedValueOnce([IMAGEN_TIPOS_FIN.map(t => ({ tipo_imagen: t, momento: 'fin' }))]);

      const res = mockRes();
      await finalizeTrabajo(mockReq({
        params: { id: '1' },
        body: { vehiculos_km: [{ vehicle_id: 7, kilometros_fin: 120500 }] },
        user: { id: 5, roles: ['tecnico'], username: 'tec' },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('fotos de INICIO');
      expect(res._json.message).toContain('nivel_aceite'); // nombra lo que falta
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  // ── uploadEvidencia: validación de `momento` ───────────
  describe('uploadEvidencia → momento', () => {
    it('rechaza un momento que no sea inicio o fin', async () => {
      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' },
        body: { vehicle_id: '7', tipo_imagen: 'frontal', momento: 'durante' },
        user: { id: 5, roles: ['tecnico'] },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toBe('momento debe ser "inicio" o "fin"');
      expect(query).not.toHaveBeenCalled();
    });

    it('sin momento asume "fin", que es el flujo de cierre', async () => {
      // `nivel_aceite` solo vale para inicio: si el default fuera 'inicio'
      // esto pasaría, y debe fallar.
      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' },
        body: { vehicle_id: '7', tipo_imagen: 'nivel_aceite' },
        user: { id: 5, roles: ['tecnico'] },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('momento="fin"');
    });
  });

  // ── Errores de BD: todos los endpoints delegan en next ─
  // Sin esto, un fallo de la BD se convertiría en una promesa rechazada sin
  // capturar y el cliente se quedaría colgado en vez de recibir un 500.
  describe('un fallo de BD siempre va a next(err)', () => {
    const admin = { id: 1, roles: ['administrador'], username: 'admin' };

    const casos = [
      ['listTrabajos',           () => listTrabajos(mockReq({ query: {}, user: admin }), mockRes(), next)],
      ['listTrabajosCalendario', () => listTrabajosCalendario(mockReq({ query: {}, user: admin }), mockRes(), next)],
      ['getTrabajo',             () => getTrabajo(mockReq({ params: { id: '1' }, user: admin }), mockRes(), next)],
      ['createTrabajo',          () => createTrabajo(mockReq({ body: { nombre: 'T', tipo: 'programado', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-02' }, user: admin }), mockRes(), next)],
      ['updateTrabajo',          () => updateTrabajo(mockReq({ params: { id: '1' }, body: { nombre: 'T' }, user: admin }), mockRes(), next)],
      ['deleteTrabajo',          () => deleteTrabajo(mockReq({ params: { id: '1' }, user: admin }), mockRes(), next)],
      ['finalizeTrabajo',        () => finalizeTrabajo(mockReq({ params: { id: '1' }, body: {}, user: admin }), mockRes(), next)],
      ['uploadEvidencia',        () => uploadEvidencia(mockReq({ params: { id: '1' }, body: { vehicle_id: '7', tipo_imagen: 'frontal', momento: 'fin' }, user: admin }), mockRes(), next)],
      ['misTrab',                () => misTrab(mockReq({ query: {}, user: admin }), mockRes(), next)],
      ['activarTrabajo',         () => activarTrabajo(mockReq({ params: { id: '1' }, user: admin }), mockRes(), next)],
    ];

    let next;
    it.each(casos)('%s', async (_nombre, ejecutar) => {
      next = mockNext();
      query.mockRejectedValue(new Error('DB down'));
      transaction.mockRejectedValue(new Error('DB down'));

      await ejecutar();

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe('DB down');
    });
  });
});

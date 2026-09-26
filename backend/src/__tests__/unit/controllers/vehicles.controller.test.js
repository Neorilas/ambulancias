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
  listIncidencias, createIncidencia, updateIncidencia, addIncidenciaComentario,
  listRevisiones, createRevision, updateRevision, deleteRevision,
  listAlertasVehiculos, listTarjetaTransporteProximas,
} = require('../../../controllers/vehicles.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

const { IMAGEN_TIPOS } = require('../../../config/constants');

// Lo que el auth.middleware carga de role_permissions para administrador/gestor.
const ADMIN_PERMS = ['manage_vehicles', 'manage_users', 'manage_trabajos',
  'view_all_trabajos', 'manage_incidencias'];

describe('vehicles.controller', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── listVehicles ───────────────────────────────────────
  describe('listVehicles', () => {
    // SEC-10: sin rol (o con un rol creado a mano) no es «operacional», y el
    // recorte viejo colgaba de isOperacional: veía la flota entera.
    it('recorta la flota a un usuario sin ningún rol', async () => {
      query.mockResolvedValueOnce([[{ total: 0 }]]);
      query.mockResolvedValueOnce([[]]);

      const req = mockReq({ query: {}, user: { id: 42, roles: [], permissions: [] } });
      await listVehicles(req, mockRes(), mockNext());

      expect(query.mock.calls[0][0]).toMatch(/EXISTS/);
      expect(query.mock.calls[0][1]).toContain(42);
    });

    it('returns paginated list for admin', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'ABC1234', alias: 'AMB-1' }]]);

      const req = mockReq({ query: {}, user: { id: 1, roles: ['administrador'], permissions: ADMIN_PERMS } });
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

    // Un administrador que ademas sale de servicio lleva el rol `tecnico`. Si
    // se le aplica el recorte de operacional se queda sin flota: sin trabajos
    // activos la lista sale vacia y no hay nada que asignar.
    it('no recorta la flota a un administrador que ademas es tecnico', async () => {
      query.mockResolvedValueOnce([[{ total: 2 }]]);
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'ABC1234', alias: 'AMB-1' },
                                    { id: 2, matricula: 'XYZ9999', alias: 'AMB-2' }]]);

      const req = mockReq({ query: {}, user: { id: 7, roles: ['administrador', 'tecnico'], permissions: ADMIN_PERMS } });
      const res = mockRes();
      await listVehicles(req, res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toHaveLength(2);
      expect(query.mock.calls[0][0]).not.toContain('trabajo_vehiculos');
      expect(query.mock.calls[0][1]).not.toContain(7);
    });

    // Las incidencias abiertas se ven desde el listado, sin entrar en cada ficha.
    it('trae el recuento de incidencias abiertas y su gravedad para un administrador', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, alias: 'AMB-1', incidencias_abiertas: 2, incidencias_gravedad_max: 'grave' }]]);

      const req = mockReq({ query: {}, user: { id: 1, roles: ['administrador'], permissions: ADMIN_PERMS } });
      const res = mockRes();
      await listVehicles(req, res, mockNext());

      const sql = query.mock.calls[1][0];
      expect(sql).toMatch(/LEFT JOIN \(/);
      expect(sql).toMatch(/estado <> 'resuelto'/);
      // Por posición en el ENUM: MAX sobre el texto pondría 'moderado' encima de 'grave'.
      expect(sql).toMatch(/MAX\(vi\.gravedad \+ 0\)/);
      expect(sql).toMatch(/ELT\(inc\.gravedad_max, 'leve', 'moderado', 'grave'\)/);
      expect(res._json.data[0].incidencias_abiertas).toBe(2);
    });

    it('filtra a los vehículos con incidencias abiertas', async () => {
      query.mockResolvedValueOnce([[{ total: 0 }]]);
      query.mockResolvedValueOnce([[]]);

      const req = mockReq({ query: { incidencias: 'abiertas' }, user: { id: 1, roles: ['gestor'], permissions: ADMIN_PERMS } });
      await listVehicles(req, mockRes(), mockNext());

      // El filtro va en el WHERE, así que también cuenta para el total.
      expect(query.mock.calls[0][0]).toMatch(/EXISTS \(\s*SELECT 1 FROM vehicle_incidencias/);
      expect(query.mock.calls[1][0]).toMatch(/EXISTS \(\s*SELECT 1 FROM vehicle_incidencias/);
    });

    // La ficha le niega las incidencias (requireAdminOrGestor): el listado no
    // puede contárselas por la puerta de atrás.
    it('no calcula ni filtra incidencias para un técnico', async () => {
      query.mockResolvedValueOnce([[{ total: 0 }]]);
      query.mockResolvedValueOnce([[]]);

      const req = mockReq({ query: { incidencias: 'abiertas' }, user: { id: 5, roles: ['tecnico'] } });
      await listVehicles(req, mockRes(), mockNext());

      expect(query.mock.calls[0][0]).not.toContain('vehicle_incidencias');
      expect(query.mock.calls[1][0]).not.toContain('vehicle_incidencias');
    });

    // En servicio o con un servicio por delante, a la vista en el listado.
    it('trae el estado de asignación (activa gana a programada) a quien ve la flota', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, alias: 'AMB-1', asignacion_estado: 'activa' }]]);

      const req = mockReq({ query: {}, user: { id: 1, roles: ['administrador'], permissions: ADMIN_PERMS } });
      const res = mockRes();
      await listVehicles(req, res, mockNext());

      const sql = query.mock.calls[1][0];
      expect(sql).toMatch(/FROM asignaciones_libres al/);
      expect(sql).toMatch(/al\.estado IN \('programada', 'activa'\)/);
      expect(sql).toMatch(/WHEN asg\.activas > 0 THEN 'activa'\s+WHEN asg\.proxima IS NOT NULL THEN 'programada'/);
      // Un borrado lógico no cuenta como asignación.
      expect(sql).toMatch(/al\.deleted_at IS NULL/);
      // Es una columna, no un filtro: el total no cambia.
      expect(query.mock.calls[0][0]).not.toContain('asignaciones_libres');
      expect(res._json.data[0].asignacion_estado).toBe('activa');
    });

    it('no calcula el estado de asignación para un técnico', async () => {
      query.mockResolvedValueOnce([[{ total: 0 }]]);
      query.mockResolvedValueOnce([[]]);

      const req = mockReq({ query: {}, user: { id: 5, roles: ['tecnico'] } });
      await listVehicles(req, mockRes(), mockNext());

      expect(query.mock.calls[1][0]).not.toContain('asignaciones_libres');
    });

    it('applies LIKE filter when search param provided', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'AMB1234', alias: 'AMB-1' }]]);

      const req = mockReq({ query: { search: 'AMB' }, user: { id: 1, roles: ['administrador'], permissions: ADMIN_PERMS } });
      const res = mockRes();
      await listVehicles(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      // LIKE param should be %AMB%
      const countParams = query.mock.calls[0][1];
      expect(countParams).toContain('%AMB%');
    });

    // La matrícula se guarda sin separadores: buscarla tal y como está en el
    // permiso de circulación tiene que encontrarla igualmente.
    it('normaliza el término al buscar por matrícula', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, matricula: '1234BCD', alias: 'Ambulancia 1' }]]);

      const req = mockReq({ query: { search: '1234 bcd' }, user: { id: 1, roles: ['administrador'], permissions: ADMIN_PERMS } });
      const res = mockRes();
      await listVehicles(req, res, mockNext());

      expect(query.mock.calls[0][1]).toContain('%1234BCD%');
    });

    // El cliente pidió expresamente ver la flota por nombre de ambulancia,
    // y con orden natural: "Ambulancia 2" antes que "Ambulancia 10".
    it('ordena por nombre de ambulancia, con los números como números', async () => {
      query.mockResolvedValueOnce([[{ total: 0 }]]);
      query.mockResolvedValueOnce([[]]);

      await listVehicles(
        mockReq({ query: {}, user: { id: 1, roles: ['administrador'], permissions: ADMIN_PERMS } }),
        mockRes(), mockNext()
      );

      const sql = query.mock.calls[1][0];
      expect(sql).toContain('ORDER BY');
      expect(sql).toContain("REGEXP_REPLACE(v.alias, '[0-9]+', '')");
      expect(sql).toContain("CAST(REGEXP_SUBSTR(v.alias, '[0-9]+') AS UNSIGNED)");
      expect(sql).not.toContain('ORDER BY v.matricula');
    });
  });

  // ── getVehicle ─────────────────────────────────────────
  describe('getVehicle', () => {
    it('returns vehicle with images', async () => {
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'ABC1234' }]]);
      query.mockResolvedValueOnce([[{ id: 10, tipo_imagen: 'frontal', image_url: '/img.jpg' }]]);
      query.mockResolvedValueOnce([[{ total: 0 }]]);   // asignaciones historicas
      query.mockResolvedValueOnce([[]]);               // ninguna activa

      const req = mockReq({ params: { id: '1' }, user: { id: 1, roles: ['administrador'], permissions: ADMIN_PERMS } });
      const res = mockRes();
      await getVehicle(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data.images).toHaveLength(1);
    });

    // El resumen de la ficha dice cuantas veces ha salido el vehiculo y si
    // ahora mismo lo lleva alguien: son dos consultas aparte porque el
    // historial fotografico solo ve las asignaciones que tuvieron fotos.
    it('returns assignment summary (total and current)', async () => {
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'ABC1234' }]]);
      query.mockResolvedValueOnce([[]]);
      query.mockResolvedValueOnce([[{ total: 12 }]]);
      query.mockResolvedValueOnce([[{
        id: 44, fecha_inicio: '2026-09-18T06:00:00.000Z', fecha_fin: '2026-09-19T06:00:00.000Z',
        inicio_real_at: '2026-09-18T06:05:00.000Z', responsable_nombre: 'Jose Lopez',
      }]]);

      const req = mockReq({ params: { id: '1' }, user: { id: 1, roles: ['administrador'], permissions: ADMIN_PERMS } });
      const res = mockRes();
      await getVehicle(req, res, mockNext());
      expect(res._json.data.asignaciones.total).toBe(12);
      expect(res._json.data.asignaciones.activa.responsable_nombre).toBe('Jose Lopez');
    });

    it('reports no current assignment when none is active', async () => {
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'ABC1234' }]]);
      query.mockResolvedValueOnce([[]]);
      query.mockResolvedValueOnce([[{ total: 3 }]]);
      query.mockResolvedValueOnce([[]]);

      const req = mockReq({ params: { id: '1' }, user: { id: 1, roles: ['administrador'], permissions: ADMIN_PERMS } });
      const res = mockRes();
      await getVehicle(req, res, mockNext());
      expect(res._json.data.asignaciones).toEqual({ total: 3, activa: null });
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await getVehicle(mockReq({ params: { id: '999' }, user: { id: 1, roles: ['administrador'], permissions: ADMIN_PERMS } }), res, mockNext());
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

    // El resumen lleva el nombre de quien tiene el vehiculo ahora mismo y lo
    // pinta una ficha que es de admin/gestor: al operacional no se le sirve.
    it('omits the assignment summary for operacional', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]);   // canOperacionalAccess
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'ABC1234' }]]);
      query.mockResolvedValueOnce([[]]);            // images

      const req = mockReq({ params: { id: '1' }, user: { id: 5, roles: ['tecnico'] } });
      const res = mockRes();
      await getVehicle(req, res, mockNext());

      expect(res._json.data.asignaciones).toBeUndefined();
      expect(query).toHaveBeenCalledTimes(3);       // no hay consultas de asignaciones
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
      query.mockResolvedValueOnce([[{ id: 5, matricula: '1234BCD', alias: 'Ambulancia 5' }]]);

      const req = mockReq({
        body: { matricula: '1234 bcd', alias: '  Ambulancia 5 ' },
        user: { id: 1, username: 'admin', nombre: 'Admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await createVehicle(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);

      // Se guarda en forma canónica: sin espacios, en mayúsculas, y el nombre
      // sin sobrantes, para que la clave única de matrícula sirva de algo.
      const insert = query.mock.calls[1];
      expect(insert[1][0]).toBe('1234BCD');
      expect(insert[1][1]).toBe('Ambulancia 5');
    });

    it('returns 409 for duplicate matricula', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]);
      const res = mockRes();
      await createVehicle(mockReq({ body: { matricula: '1234BCD', alias: 'AMB-1' }, user: { id: 1, username: 'admin' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(409);
    });

    // El cliente dio de alta la flota con el nombre de la ambulancia en el
    // campo matrícula. Se rechaza en el alta para que no vuelva a pasar.
    it('rechaza un nombre de ambulancia en el campo matrícula', async () => {
      const res = mockRes();
      await createVehicle(mockReq({
        body: { matricula: 'Ambulancia 1', alias: '1234BCD' },
        user: { id: 1, username: 'admin' },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(query).not.toHaveBeenCalled();
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

      const req = mockReq({ params: { id: '1' }, query: { trabajo_id: '5' }, user: { id: 1, roles: ['administrador'], permissions: ADMIN_PERMS } });
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

    // Los vehículos cruzados hay que poder arreglarlos desde la ficha, así
    // que la matrícula dejó de ser inmutable.
    describe('corrección de la matrícula', () => {
      it('la actualiza en forma canónica', async () => {
        query.mockResolvedValueOnce([[{ id: 1 }]]);  // existe
        query.mockResolvedValueOnce([[]]);           // ninguna otra la usa
        query.mockResolvedValueOnce([]);             // UPDATE
        query.mockResolvedValueOnce([[{ id: 1, matricula: '1234BCD', alias: 'Ambulancia 1' }]]);

        const res = mockRes();
        await updateVehicle(mockReq({
          params: { id: '1' },
          body: { matricula: '1234-bcd', alias: 'Ambulancia 1' },
          user: { id: 1, username: 'admin' },
        }), res, mockNext());

        expect(res.status).toHaveBeenCalledWith(200);
        const update = query.mock.calls[2];
        expect(update[0]).toContain('matricula = ?');
        expect(update[1][0]).toBe('1234BCD');
      });

      it('no deja poner una matrícula que ya tiene otro vehículo', async () => {
        query.mockResolvedValueOnce([[{ id: 1 }]]);  // existe
        query.mockResolvedValueOnce([[{ id: 9 }]]);  // otro la usa

        const res = mockRes();
        await updateVehicle(mockReq({
          params: { id: '1' },
          body: { matricula: '1234BCD' },
          user: { id: 1, username: 'admin' },
        }), res, mockNext());

        expect(res.status).toHaveBeenCalledWith(409);
      });

      it('rechaza un nombre de ambulancia en el campo matrícula', async () => {
        query.mockResolvedValueOnce([[{ id: 1 }]]);  // existe

        const res = mockRes();
        await updateVehicle(mockReq({
          params: { id: '1' },
          body: { matricula: 'Ambulancia 1' },
          user: { id: 1, username: 'admin' },
        }), res, mockNext());

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
      query.mockResolvedValueOnce([[{ id: 1 }]]);      // vehicle exists
      query.mockResolvedValueOnce([[{ ok: 1 }]]);      // el trabajo es de este vehiculo
      query.mockResolvedValueOnce([[{ ok: 1 }]]);      // y es responsable en ese trabajo
      query.mockResolvedValueOnce([{ insertId: 20 }]); // insert image

      const req = mockReq({
        params: { id: '1' },
        body: { trabajo_id: 5, tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/test.jpg' },
        user: { id: 1, roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await uploadImages(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
      expect(query.mock.calls[2][1]).toEqual([5, 1, 1]);
    });

    it('403 si el trabajo lleva el vehículo pero no es suyo (SEC-11)', async () => {
      const { deleteFile } = require('../../../middleware/upload.middleware');
      query.mockResolvedValueOnce([[{ id: 1 }]]);  // vehicle exists
      query.mockResolvedValueOnce([[{ ok: 1 }]]);  // el trabajo lleva este vehiculo
      query.mockResolvedValueOnce([[]]);           // pero no es responsable en él

      const req = mockReq({
        params: { id: '1' },
        body: { trabajo_id: 5, tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/test.jpg' },
        user: { id: 9, roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await uploadImages(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
      expect(deleteFile).toHaveBeenCalledWith('/uploads/test.jpg');
      expect(query).toHaveBeenCalledTimes(3);
    });

    it('quien gestiona vehículos no necesita ser responsable del trabajo', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]);
      query.mockResolvedValueOnce([[{ ok: 1 }]]);
      query.mockResolvedValueOnce([{ insertId: 21 }]);

      const req = mockReq({
        params: { id: '1' },
        body: { trabajo_id: 5, tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/test.jpg' },
        user: { id: 1, roles: ['administrador'], permissions: ADMIN_PERMS },
      });
      const res = mockRes();
      await uploadImages(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
      expect(query).toHaveBeenCalledTimes(3);
    });

    it('returns 400 when trabajo_id belongs to another vehicle (SEC-02)', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]);  // vehicle exists
      query.mockResolvedValueOnce([[]]);           // ese trabajo no lleva este vehiculo

      const req = mockReq({
        params: { id: '1' },
        body: { trabajo_id: 999, tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/test.jpg' },
        user: { id: 1 },
      });
      const res = mockRes();
      await uploadImages(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      // no debe insertar nada
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('uploads image without trabajo_id (foto suelta)', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]);      // vehicle exists
      query.mockResolvedValueOnce([{ insertId: 21 }]); // insert image, sin comprobar trabajo

      const req = mockReq({
        params: { id: '1' },
        body: { tipo_imagen: 'danos' },
        processedFile: { url: '/uploads/test2.jpg' },
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
    it('403 a un usuario sin rol que no lleva el vehículo (SEC-10)', async () => {
      query.mockResolvedValueOnce([[]]); // canOperacionalAccess: no

      const res = mockRes();
      await getVehicleImages(
        mockReq({ params: { id: '1' }, query: {}, user: { id: 42, roles: [], permissions: [] } }),
        res, mockNext());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('returns images for vehicle', async () => {
      query.mockResolvedValueOnce([[
        { id: 1, tipo_imagen: 'frontal', image_url: '/img1.jpg' },
        { id: 2, tipo_imagen: 'trasera', image_url: '/img2.jpg' },
      ]]);

      const req = mockReq({ params: { id: '1' }, query: {}, user: { id: 1, roles: ['administrador'], permissions: ADMIN_PERMS } });
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
          trabajo_id: 99, asignacion_id: null, trabajo_referencia: 'TRB-2026-0001', trabajo_nombre: 'Test',
          trabajo_fecha_inicio: new Date(), trabajo_fecha_fin: new Date(),
          trabajo_estado: 'finalizado', trabajo_km_fin: 55000, trabajo_km_inicio: 50000,
          trabajo_responsable_id: 2, trabajo_responsable_nombre: 'Tec User',
          uploader_id: 2, uploader_nombre: 'Tec', uploader_apellidos: 'User', uploader_username: 'tec',
        },
        {
          id: 11, tipo_imagen: 'trasera', image_url: '/img2.jpg', foto_fecha: new Date(),
          trabajo_id: 99, asignacion_id: null, trabajo_referencia: 'TRB-2026-0001', trabajo_nombre: 'Test',
          trabajo_fecha_inicio: new Date(), trabajo_fecha_fin: new Date(),
          trabajo_estado: 'finalizado', trabajo_km_fin: 55000, trabajo_km_inicio: 50000,
          trabajo_responsable_id: 2, trabajo_responsable_nombre: 'Tec User',
          uploader_id: 2, uploader_nombre: 'Tec', uploader_apellidos: 'User', uploader_username: 'tec',
        },
      ]]);

      const res = mockRes();
      await getVehicleHistorial(mockReq({ params: { id: '1' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      // Should have one trabajo entry with two fotos
      expect(res._json.data.trabajos).toHaveLength(1);
      expect(res._json.data.trabajos[0].tipo).toBe('trabajo');
      expect(res._json.data.trabajos[0].fotos).toHaveLength(2);
    });

    it('groups asignación photos and sorts most-recent activity first', async () => {
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'ABC1234', alias: 'AMB-1', kilometros_actuales: 50000 }]]);
      const older  = new Date('2026-06-01T10:00:00Z');
      const newer  = new Date('2026-06-20T10:00:00Z');
      query.mockResolvedValueOnce([[
        // Trabajo antiguo
        {
          id: 10, tipo_imagen: 'frontal', image_url: '/t.jpg', foto_fecha: older,
          trabajo_id: 99, asignacion_id: null, trabajo_referencia: 'TRB-1',
          trabajo_estado: 'finalizado', trabajo_km_fin: 51000, trabajo_km_inicio: 50000,
          trabajo_responsable_id: 2, trabajo_responsable_nombre: 'Tec User',
          uploader_id: 2, uploader_nombre: 'Tec', uploader_apellidos: 'User', uploader_username: 'tec',
        },
        // Asignación libre recién finalizada (foto más nueva → debe ir arriba)
        {
          id: 20, tipo_imagen: 'cuentakilometros', image_url: '/a.jpg', foto_fecha: newer,
          trabajo_id: null, asignacion_id: 7,
          asig_fecha_inicio: older, asig_fecha_fin: newer, asig_estado: 'finalizada',
          asig_km_inicio: 60000, asig_km_fin: 60500,
          asig_responsable_id: 3, asig_responsable_nombre: 'Jose Lopez',
          uploader_id: 3, uploader_nombre: 'Jose', uploader_apellidos: 'Lopez', uploader_username: 'jlopez',
        },
      ]]);

      const res = mockRes();
      await getVehicleHistorial(mockReq({ params: { id: '1' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      const grupos = res._json.data.trabajos;
      expect(grupos).toHaveLength(2);
      // El más reciente (asignación) va primero
      expect(grupos[0].tipo).toBe('asignacion');
      expect(grupos[0].asignacion_id).toBe(7);
      expect(grupos[0].responsable_nombre).toBe('Jose Lopez');
      expect(grupos[0].estado).toBe('finalizada');
      expect(grupos[1].tipo).toBe('trabajo');
    });

    it('cada foto lleva momento y hora, y el SQL las pide en orden cronológico', async () => {
      query.mockResolvedValueOnce([[{ id: 1, matricula: 'ABC1234', alias: 'AMB-1', kilometros_actuales: 50000 }]]);
      const inicio = new Date('2026-06-01T06:10:00Z');
      const fin    = new Date('2026-06-01T17:40:00Z');
      query.mockResolvedValueOnce([[
        {
          id: 30, tipo_imagen: 'frontal', momento: 'inicio', image_url: '/i.jpg', foto_fecha: inicio,
          trabajo_id: null, asignacion_id: 7, asig_estado: 'finalizada',
          uploader_id: 3, uploader_nombre: 'Jose', uploader_apellidos: 'Lopez', uploader_username: 'jlopez',
        },
        {
          id: 31, tipo_imagen: 'frontal', momento: 'fin', image_url: '/f.jpg', foto_fecha: fin,
          trabajo_id: null, asignacion_id: 7, asig_estado: 'finalizada',
          uploader_id: 3, uploader_nombre: 'Jose', uploader_apellidos: 'Lopez', uploader_username: 'jlopez',
        },
      ]]);

      const res = mockRes();
      await getVehicleHistorial(mockReq({ params: { id: '1' } }), res, mockNext());

      const sqlFotos = query.mock.calls[1][0];
      expect(sqlFotos).toMatch(/vi\.momento/);
      expect(sqlFotos).toMatch(/ORDER BY FIELD\(vi\.momento,'inicio','fin','general'\), vi\.created_at ASC/);

      const [fotoInicio, fotoFin] = res._json.data.trabajos[0].fotos;
      // Misma foto ('frontal') dos veces: sin `momento` no se distinguirían.
      expect(fotoInicio).toMatchObject({ momento: 'inicio', fecha: inicio });
      expect(fotoFin).toMatchObject({ momento: 'fin', fecha: fin });
    });
  });

  // ── listIncidencias ────────────────────────────────────
  describe('listIncidencias', () => {
    it('returns incidencias list', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle exists
      query.mockResolvedValueOnce([[{ id: 10, tipo: 'dano_exterior', descripcion: 'Rayón' }]]);
      query.mockResolvedValueOnce([[]]); // comentarios

      const res = mockRes();
      await listIncidencias(mockReq({ params: { id: '1' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('adjunta los comentarios de cada incidencia', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle exists
      query.mockResolvedValueOnce([[{ id: 10, tipo: 'dano_exterior', descripcion: 'Rayón' }]]);
      query.mockResolvedValueOnce([[{
        id: 3, incidencia_id: 10, comentario: 'Pendiente de presupuesto', created_at: new Date(),
        autor_id: 1, autor_nombre: 'Admin', autor_apellidos: 'User',
      }]]);

      const res = mockRes();
      await listIncidencias(mockReq({ params: { id: '1' } }), res, mockNext());
      expect(res._json.data[0].comentarios).toHaveLength(1);
      expect(res._json.data[0].comentarios[0].comentario).toBe('Pendiente de presupuesto');
    });
  });

  // ── addIncidenciaComentario ────────────────────────────
  describe('addIncidenciaComentario', () => {
    const incidencia = { id: 10, reported_by: 9, responsable_user_id: 9 };

    it('el gestor comenta la incidencia del técnico en vez de duplicarla', async () => {
      query.mockResolvedValueOnce([[incidencia]]);            // incidencia existe
      query.mockResolvedValueOnce([{ insertId: 4 }]);         // INSERT comentario
      query.mockResolvedValueOnce([[{                          // SELECT del creado
        id: 4, comentario: 'Llevado a taller', created_at: new Date(),
        autor_id: 1, autor_nombre: 'Admin', autor_apellidos: 'User',
      }]]);

      const req = mockReq({
        params: { vehicleId: '3', incId: '10' },
        body:   { comentario: 'Llevado a taller' },
        user:   { id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_incidencias'] },
      });
      const res = mockRes();
      await addIncidenciaComentario(req, res, mockNext());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res._json.data.comentario).toBe('Llevado a taller');
      // No se crea ninguna incidencia nueva
      expect(query.mock.calls.some(c => /INSERT INTO vehicle_incidencias/.test(c[0]))).toBe(false);
    });

    it('el responsable de la incidencia también puede comentar', async () => {
      query.mockResolvedValueOnce([[incidencia]]);
      query.mockResolvedValueOnce([{ insertId: 5 }]);
      query.mockResolvedValueOnce([[{ id: 5, comentario: 'Ya estaba así', created_at: new Date(), autor_id: 9 }]]);

      const req = mockReq({
        params: { vehicleId: '3', incId: '10' },
        body:   { comentario: 'Ya estaba así' },
        user:   { id: 9, username: 'jlopez', roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await addIncidenciaComentario(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('403 para un tercero sin permisos', async () => {
      query.mockResolvedValueOnce([[incidencia]]);

      const req = mockReq({
        params: { vehicleId: '3', incId: '10' },
        body:   { comentario: 'Curioseando' },
        user:   { id: 77, username: 'otro', roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await addIncidenciaComentario(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('404 si la incidencia no es de ese vehículo', async () => {
      query.mockResolvedValueOnce([[]]);

      const req = mockReq({
        params: { vehicleId: '3', incId: '99' },
        body:   { comentario: 'Hola' },
        user:   { id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_incidencias'] },
      });
      const res = mockRes();
      await addIncidenciaComentario(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
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

    it('reasigna la incidencia a otro empleado', async () => {
      query.mockResolvedValueOnce([[{ id: 15, estado: 'pendiente' }]]); // exists
      query.mockResolvedValueOnce([[{ id: 42 }]]);                      // empleado destino
      query.mockResolvedValueOnce([]);                                  // UPDATE
      query.mockResolvedValueOnce([[{ id: 15, responsable_user_id: 42 }]]);

      const res = mockRes();
      await updateIncidencia(mockReq({
        params: { vehicleId: '1', incId: '15' },
        body: { responsable_user_id: 42 },
        user: { id: 1, username: 'admin' },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      const updateSql = query.mock.calls[2][0];
      expect(updateSql).toContain('responsable_user_id = ?');
      expect(query.mock.calls[2][1]).toContain(42);
    });

    it('permite dejar la incidencia sin responsable', async () => {
      query.mockResolvedValueOnce([[{ id: 15, estado: 'pendiente' }]]); // exists
      query.mockResolvedValueOnce([]);                                  // UPDATE
      query.mockResolvedValueOnce([[{ id: 15, responsable_user_id: null }]]);

      const res = mockRes();
      await updateIncidencia(mockReq({
        params: { vehicleId: '1', incId: '15' },
        body: { responsable_user_id: null },
        user: { id: 1, username: 'admin' },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(query.mock.calls[1][0]).toContain('responsable_user_id = NULL');
    });

    it('devuelve 400 si el empleado destino no existe', async () => {
      query.mockResolvedValueOnce([[{ id: 15, estado: 'pendiente' }]]); // exists
      query.mockResolvedValueOnce([[]]);                                // empleado inexistente

      const res = mockRes();
      await updateIncidencia(mockReq({
        params: { vehicleId: '1', incId: '15' },
        body: { responsable_user_id: 999 },
        user: { id: 1, username: 'admin' },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('permite reclasificar el tipo de la incidencia', async () => {
      query.mockResolvedValueOnce([[{ id: 15, estado: 'pendiente' }]]); // exists
      query.mockResolvedValueOnce([]);                                  // UPDATE
      query.mockResolvedValueOnce([[{ id: 15, tipo: 'mecanico' }]]);

      const res = mockRes();
      await updateIncidencia(mockReq({
        params: { vehicleId: '1', incId: '15' },
        body: { tipo: 'mecanico' },
        user: { id: 1, username: 'admin' },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(query.mock.calls[1][0]).toContain('tipo = ?');
      expect(query.mock.calls[1][1]).toContain('mecanico');
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

  // ── listAlertasVehiculos ───────────────────────────────
  // Las fechas se congelan: el cálculo es de calendario y sin reloj fijo
  // el test cambiaría de resultado cada día.
  describe('listAlertasVehiculos', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-09-20T10:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    const vehiculo = (extra) => ({
      id: 1, matricula: '1234ABC', alias: 'Ambulancia 1',
      fecha_matriculacion: null, fecha_itv: null, fecha_its: null,
      fecha_tarjeta_transporte: null,
      ...extra,
    });

    it('ITV de un vehículo de 5 años o más: semestral', async () => {
      query.mockResolvedValueOnce([[vehiculo({
        fecha_matriculacion: '2018-01-01', fecha_itv: '2026-04-10',
      })]]);

      const res = mockRes();
      await listAlertasVehiculos(mockReq({ query: {} }), res, mockNext());

      expect(res._json.data).toEqual([{
        vehicle_id: 1, matricula: '1234ABC', alias: 'Ambulancia 1',
        tipo: 'itv', fecha_caducidad: '2026-10-10', dias_restantes: 20,
      }]);
    });

    it('ITV de un vehículo nuevo es anual, así que aún no entra en el umbral', async () => {
      query.mockResolvedValueOnce([[vehiculo({
        fecha_matriculacion: '2024-01-01', fecha_itv: '2026-04-10',
      })]]);

      const res = mockRes();
      await listAlertasVehiculos(mockReq({ query: {} }), res, mockNext());

      expect(res._json.data).toEqual([]);
    });

    it('sin fecha de matriculación asume el intervalo anual', async () => {
      query.mockResolvedValueOnce([[vehiculo({ fecha_itv: '2025-10-05' })]]);

      const res = mockRes();
      await listAlertasVehiculos(mockReq({ query: {} }), res, mockNext());

      expect(res._json.data[0]).toMatchObject({
        tipo: 'itv', fecha_caducidad: '2026-10-05', dias_restantes: 15,
      });
    });

    it('la ITS es anual desde la última', async () => {
      query.mockResolvedValueOnce([[vehiculo({ fecha_its: '2025-10-01' })]]);

      const res = mockRes();
      await listAlertasVehiculos(mockReq({ query: {} }), res, mockNext());

      expect(res._json.data[0]).toMatchObject({
        tipo: 'its', fecha_caducidad: '2026-10-01', dias_restantes: 11,
      });
    });

    it('la fecha de la tarjeta de transporte ES la caducidad, no se le suma nada', async () => {
      query.mockResolvedValueOnce([[vehiculo({ fecha_tarjeta_transporte: '2026-10-15' })]]);

      const res = mockRes();
      await listAlertasVehiculos(mockReq({ query: {} }), res, mockNext());

      expect(res._json.data[0]).toMatchObject({
        tipo: 'tarjeta_transporte', fecha_caducidad: '2026-10-15', dias_restantes: 25,
      });
    });

    it('lo vencido sale con días negativos y va primero', async () => {
      query.mockResolvedValueOnce([[vehiculo({
        fecha_matriculacion: '2018-01-01',
        fecha_itv: '2026-04-10',              // +20 días
        fecha_its: '2025-10-01',              // +11 días
        fecha_tarjeta_transporte: '2026-09-10', // vencida hace 10
      })]]);

      const res = mockRes();
      await listAlertasVehiculos(mockReq({ query: {} }), res, mockNext());

      expect(res._json.data.map(a => [a.tipo, a.dias_restantes])).toEqual([
        ['tarjeta_transporte', -10],
        ['its', 11],
        ['itv', 20],
      ]);
    });

    it('ordena por días entre vehículos distintos, no solo dentro de uno', async () => {
      query.mockResolvedValueOnce([[
        vehiculo({ id: 1, fecha_its: '2025-10-15' }),   // +25
        vehiculo({ id: 2, fecha_its: '2025-09-25' }),   // +5
      ]]);

      const res = mockRes();
      await listAlertasVehiculos(mockReq({ query: {} }), res, mockNext());

      expect(res._json.data.map(a => a.vehicle_id)).toEqual([2, 1]);
    });

    it('lo que caduca más allá del umbral no se devuelve', async () => {
      query.mockResolvedValueOnce([[vehiculo({ fecha_its: '2026-01-01' })]]); // +103 días

      const res = mockRes();
      await listAlertasVehiculos(mockReq({ query: {} }), res, mockNext());

      expect(res._json.data).toEqual([]);
    });

    it('el umbral se puede ampliar por query', async () => {
      query.mockResolvedValueOnce([[vehiculo({ fecha_its: '2026-01-01' })]]);

      const res = mockRes();
      await listAlertasVehiculos(mockReq({ query: { dias: '120' } }), res, mockNext());

      expect(res._json.data).toHaveLength(1);
    });

    it('el umbral se recorta a 365 días como máximo', async () => {
      query.mockResolvedValueOnce([[vehiculo({ fecha_its: '2026-06-01' })]]); // +254
      const res = mockRes();
      await listAlertasVehiculos(mockReq({ query: { dias: '9999' } }), res, mockNext());
      expect(res._json.data).toHaveLength(1);

      query.mockResolvedValueOnce([[vehiculo({ fecha_its: '2026-09-25' })]]); // +370
      const res2 = mockRes();
      await listAlertasVehiculos(mockReq({ query: { dias: '9999' } }), res2, mockNext());
      expect(res2._json.data).toEqual([]);
    });

    it('un umbral basura o negativo cae en un valor seguro', async () => {
      query.mockResolvedValueOnce([[vehiculo({ fecha_its: '2025-09-25' })]]); // +5
      const res = mockRes();
      await listAlertasVehiculos(mockReq({ query: { dias: 'muchos' } }), res, mockNext());
      expect(res._json.data).toHaveLength(1); // cae al default de 60

      query.mockResolvedValueOnce([[vehiculo({ fecha_its: '2025-09-25' })]]);
      const res2 = mockRes();
      await listAlertasVehiculos(mockReq({ query: { dias: '-30' } }), res2, mockNext());
      expect(res2._json.data).toEqual([]); // se recorta a 1 día
    });

    it('una fecha corrupta en BD se ignora en vez de tumbar el listado', async () => {
      query.mockResolvedValueOnce([[vehiculo({
        fecha_its: 'no-es-una-fecha',
        fecha_tarjeta_transporte: '2026-09-25',
      })]]);

      const res = mockRes();
      await listAlertasVehiculos(mockReq({ query: {} }), res, mockNext());

      expect(res._json.data.map(a => a.tipo)).toEqual(['tarjeta_transporte']);
    });

    it('sin vehículos devuelve una lista vacía', async () => {
      query.mockResolvedValueOnce([[]]);

      const res = mockRes();
      await listAlertasVehiculos(mockReq({ query: {} }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toEqual([]);
    });

    it('un fallo de BD va a next', async () => {
      query.mockRejectedValueOnce(new Error('DB down'));

      const next = mockNext();
      await listAlertasVehiculos(mockReq({ query: {} }), mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── listTarjetaTransporteProximas ──────────────────────
  describe('listTarjetaTransporteProximas', () => {
    it('devuelve las tarjetas próximas a caducar con sus días restantes', async () => {
      const filas = [{ id: 1, matricula: '1234ABC', alias: 'A1', dias_restantes: 12 }];
      query.mockResolvedValueOnce([filas]);

      const res = mockRes();
      await listTarjetaTransporteProximas(mockReq({ query: {} }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toEqual(filas);
    });

    it('el día lo pone Node, no NOW() de MySQL', async () => {
      query.mockResolvedValueOnce([[]]);

      await listTarjetaTransporteProximas(mockReq({ query: {} }), mockRes(), mockNext());

      const [sql, params] = query.mock.calls[0];
      expect(sql).not.toMatch(/NOW\(\)|CURDATE\(\)/);
      expect(params[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(params[1]).toBe(params[0]);
      expect(params[2]).toBe(60); // ventana por defecto
    });

    it('acepta una ventana distinta', async () => {
      query.mockResolvedValueOnce([[]]);
      await listTarjetaTransporteProximas(mockReq({ query: { dias: '30' } }), mockRes(), mockNext());
      expect(query.mock.calls[0][1][2]).toBe(30);
    });

    it('recorta la ventana al rango 1..365', async () => {
      query.mockResolvedValueOnce([[]]);
      await listTarjetaTransporteProximas(mockReq({ query: { dias: '9999' } }), mockRes(), mockNext());
      expect(query.mock.calls[0][1][2]).toBe(365);

      query.mockReset();
      query.mockResolvedValueOnce([[]]);
      await listTarjetaTransporteProximas(mockReq({ query: { dias: '-10' } }), mockRes(), mockNext());
      expect(query.mock.calls[0][1][2]).toBe(1);
    });

    it('un fallo de BD va a next', async () => {
      query.mockRejectedValueOnce(new Error('DB down'));

      const next = mockNext();
      await listTarjetaTransporteProximas(mockReq({ query: {} }), mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});

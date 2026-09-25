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

// Los avisos push se disparan sin await desde el controlador. Aquí solo
// interesa SI se disparan y con qué asignación; el envío tiene sus propios
// tests en services/push.service.test.js.
jest.mock('../../../services/avisosAsignacion.service', () => ({
  avisarAsignacionActivada:   jest.fn(),
  avisarFotosInicioCompletas: jest.fn(),
  avisarAsignacionFinalizada: jest.fn(),
}));

const {
  listAsignaciones, getAsignacion, createAsignacion, updateAsignacion,
  deleteAsignacion, activarAsignacion, finalizarAsignacion, uploadEvidencia,
  crearIncidenciaDesdeAsignacion, rolEnAsignacion, leerMiembros,
} = require('../../../controllers/asignaciones.controller');
const avisos = require('../../../services/avisosAsignacion.service');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');
const { IMAGEN_TIPOS_REQUERIDOS, IMAGEN_TIPOS_INICIO, IMAGEN_TIPOS_FIN } =
  require('../../../config/constants');

// Filas de getProgreso que cubren TODAS las fotos requeridas de inicio y fin,
// cada una con su `momento` (lo que getProgreso usa para calcular `completo`).
function progresoCompletoRows() {
  return [
    ...IMAGEN_TIPOS_INICIO.map(t => ({ tipo_imagen: t, momento: 'inicio' })),
    ...IMAGEN_TIPOS_FIN.map(t => ({ tipo_imagen: t, momento: 'fin' })),
  ];
}

// Helper: mock getAsignacionCompleta (main + miembros + evidencias + incidencias + getProgreso)
// `miembros` (opcional) son las filas de asignacion_usuarios; por defecto el
// user_id de la asignación como único responsable, que es lo que deja v23.
function mockAsignacionCompleta({ miembros, evidencias, incidencias, ...overrides } = {}) {
  const base = {
    id: 1, vehicle_id: 1, user_id: 2, estado: 'activa',
    fecha_inicio: new Date(), fecha_fin: new Date(Date.now() + 86400000),
    km_inicio: 10000, km_fin: null,
    matricula: 'ABC1234', vehiculo_alias: 'AMB-1',
    responsable_nombre: 'Tec User', responsable_username: 'tec',
    creado_por_nombre: 'Admin U',
    ...overrides,
  };
  query.mockResolvedValueOnce([[base]]); // main query
  query.mockResolvedValueOnce([miembros || [{ user_id: base.user_id, rol: 'responsable', orden: 0 }]]);
  query.mockResolvedValueOnce([evidencias || []]); // evidencias
  query.mockResolvedValueOnce([incidencias || []]); // incidencias
  // getAsignacionCompleta solo pide comentarios si hay incidencias.
  if (incidencias && incidencias.length) {
    query.mockResolvedValueOnce([[]]); // comentarios de esas incidencias
  }
  query.mockResolvedValueOnce([[]]);     // getProgreso
}

describe('asignaciones.controller', () => {
  // clearAllMocks NO vacía la cola de mockResolvedValueOnce; mockReset sí.
  // Sin esto, los valores encolados y no consumidos por un test se filtran al
  // siguiente y corrompen sus resultados de `query`.
  beforeEach(() => {
    jest.clearAllMocks();
    query.mockReset();
    // finalizarAsignacion cierra la asignación y pone al día el vehículo en
    // una transacción; el conn simulado reenvía a `query` para que los tests
    // sigan viendo las sentencias en query.mock.calls.
    transaction.mockReset();
    transaction.mockImplementation(async (cb) => cb({
      execute: (sql, params) => query(sql, params),
      query:   (sql, params) => query(sql, params),
    }));
  });

  // ── listAsignaciones ───────────────────────────────────
  describe('listAsignaciones', () => {
    it('returns paginated list', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{
        id: 1, estado: 'activa', matricula: 'ABC1234',
        responsable_nombre: 'Tec User',
      }]]);

      const req = mockReq({
        query: {}, user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      const res = mockRes();
      await listAsignaciones(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toHaveLength(1);
    });

    it('adds user_id filter for operacional (no manage_trabajos permission)', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, estado: 'activa', matricula: 'ABC1234', responsable_nombre: 'Tec' }]]);

      const req = mockReq({
        query: {},
        user: { id: 5, roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await listAsignaciones(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      // user_id=5 should be in the query params
      expect(query.mock.calls[0][1]).toContain(5);
    });

    it('applies estado filter when provided', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, estado: 'activa', matricula: 'ABC1234', responsable_nombre: 'Tec' }]]);

      const req = mockReq({
        query: { estado: 'activa' },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      const res = mockRes();
      await listAsignaciones(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(query.mock.calls[0][1]).toContain('activa');
    });

    // El orden es funcionalidad, no adorno: arriba la próxima a activarse,
    // abajo las cerradas. Aquí solo se puede comprobar el SQL que sale, pero
    // eso ya protege de que alguien vuelva a dejar un `fecha_inicio DESC`
    // suelto y ponga el listado del revés sin enterarse.
    it('orders by proximity to activation, with finalizada/cancelada last', async () => {
      query.mockResolvedValueOnce([[{ total: 0 }]]);
      query.mockResolvedValueOnce([[]]);

      const req = mockReq({
        query: {}, user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      await listAsignaciones(req, mockRes(), mockNext());

      const sql = query.mock.calls[1][0].replace(/\s+/g, ' ');
      // Las cerradas al final
      expect(sql).toContain(
        "ORDER BY CASE WHEN al.estado IN ('finalizada','cancelada') THEN 1 ELSE 0 END ASC"
      );
      // Lo que está EN CURSO encabeza las abiertas. No sobra: activarAsignacion
      // no mira el reloj, así que una activada antes de hora conserva su
      // fecha_inicio futura y sin esto se hundía bajo las que no han empezado.
      expect(sql).toContain("CASE WHEN al.estado = 'activa' THEN 0 ELSE 1 END ASC");
      // Las abiertas, la más próxima primero
      expect(sql).toContain(
        "CASE WHEN al.estado IN ('finalizada','cancelada') THEN NULL ELSE al.fecha_inicio END ASC"
      );
      // Entre las cerradas, la que se cerró más tarde primero (una cancelada
      // no tiene finalizado_at: cae en fecha_fin)
      expect(sql).toContain('COALESCE(al.finalizado_at, al.fecha_fin) DESC');
      // Desempate estable para que la paginación no baile
      expect(sql).toContain('al.id DESC');
    });
  });

  // ── getAsignacion ──────────────────────────────────────
  describe('getAsignacion', () => {
    it('returns asignacion completa', async () => {
      mockAsignacionCompleta();

      const req = mockReq({ params: { id: '1' }, user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] } });
      const res = mockRes();
      await getAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]); // getAsignacionCompleta returns null
      const res = mockRes();
      await getAsignacion(mockReq({ params: { id: '999' }, user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('incluye las incidencias registradas en la asignación', async () => {
      query.mockResolvedValueOnce([[{
        id: 1, vehicle_id: 3, user_id: 9, estado: 'activa',
        matricula: '9864JSF', responsable_nombre: 'J Lopez', responsable_username: 'jlopez',
      }]]);                                // main query
      query.mockResolvedValueOnce([[{ user_id: 9, rol: 'responsable', orden: 0 }]]); // miembros
      query.mockResolvedValueOnce([[]]);   // evidencias
      query.mockResolvedValueOnce([[{     // incidencias
        id: 20, tipo: 'dano_exterior', gravedad: 'leve',
        descripcion: 'Golpe en el paragolpes', estado: 'pendiente',
        created_at: new Date(), resuelto_at: null,
        responsable_user_id: 9, responsable_nombre: 'Jose', responsable_apellidos: 'Lopez',
        reporter_id: 9, reporter_nombre: 'Jose', reporter_apellidos: 'Lopez',
        resolutor_id: null,
      }]]);
      query.mockResolvedValueOnce([[{     // comentarios de esas incidencias
        id: 5, incidencia_id: 20, comentario: 'Revisado en taller', created_at: new Date(),
        autor_id: 1, autor_nombre: 'Admin', autor_apellidos: 'User',
      }]]);
      query.mockResolvedValueOnce([[]]);   // getProgreso

      const req = mockReq({ params: { id: '1' }, user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] } });
      const res = mockRes();
      await getAsignacion(req, res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data.incidencias).toHaveLength(1);
      expect(res._json.data.incidencias[0]).toMatchObject({
        id: 20,
        descripcion: 'Golpe en el paragolpes',
        responsable:   { id: 9, nombre: 'Jose', apellidos: 'Lopez' },
        reportado_por: { id: 9, nombre: 'Jose', apellidos: 'Lopez' },
        resuelto_por:  null,
      });
      // Los comentarios evitan tener que dar de alta otra incidencia para
      // aportar la versión del administrador.
      expect(res._json.data.incidencias[0].comentarios).toEqual([
        expect.objectContaining({
          id: 5,
          comentario: 'Revisado en taller',
          autor: { id: 1, nombre: 'Admin', apellidos: 'User' },
        }),
      ]);
    });

    it('returns 403 for operacional accessing another user asignacion', async () => {
      // asig.user_id = 2, req.user.id = 5, no manage permission
      mockAsignacionCompleta({ user_id: 2 });

      const req = mockReq({
        params: { id: '1' },
        user: { id: 5, roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await getAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── createAsignacion ───────────────────────────────────
  describe('createAsignacion', () => {
    it('creates asignacion', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle exists
      query.mockResolvedValueOnce([[{ id: 2 }]]); // user exists
      query.mockResolvedValueOnce([{ insertId: 5 }]); // insert
      query.mockResolvedValueOnce([]); // DELETE miembros
      query.mockResolvedValueOnce([]); // INSERT miembros
      query.mockResolvedValueOnce([]); // UPDATE user_id principal
      mockAsignacionCompleta({ id: 5 }); // getAsignacionCompleta
      query.mockResolvedValueOnce([[]]); // solapes

      const req = mockReq({
        body: { vehicle_id: 1, user_id: 2, fecha_inicio: '2026-04-15T08:00', fecha_fin: '2026-04-15T20:00' },
        user: { id: 1 },
      });
      const res = mockRes();
      await createAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns 404 for missing vehicle', async () => {
      query.mockResolvedValueOnce([[]]); // not found
      const res = mockRes();
      await createAsignacion(mockReq({
        body: { vehicle_id: 999, user_id: 2, fecha_inicio: '2026-04-15T08:00', fecha_fin: '2026-04-15T20:00' },
        user: { id: 1 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 404 when user not found', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle found
      query.mockResolvedValueOnce([[]]); // user not found
      const res = mockRes();
      await createAsignacion(mockReq({
        body: { vehicle_id: 1, user_id: 999, fecha_inicio: '2026-04-15T08:00', fecha_fin: '2026-04-15T20:00' },
        user: { id: 1 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 when fecha_fin <= fecha_inicio', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle found
      query.mockResolvedValueOnce([[{ id: 2 }]]); // user found
      const res = mockRes();
      await createAsignacion(mockReq({
        body: { vehicle_id: 1, user_id: 2, fecha_inicio: '2026-04-15T20:00', fecha_fin: '2026-04-15T08:00' },
        user: { id: 1 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── updateAsignacion ───────────────────────────────────
  describe('updateAsignacion', () => {
    it('updates asignacion fields', async () => {
      mockAsignacionCompleta({ estado: 'programada' }); // fetch existing
      query.mockResolvedValueOnce([]); // UPDATE
      mockAsignacionCompleta({ estado: 'programada' }); // fetch updated
      query.mockResolvedValueOnce([[]]); // solapes

      const req = mockReq({
        params: { id: '1' },
        body: { notas: 'Updated' },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      const res = mockRes();
      await updateAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    // Las notas no van por COALESCE: el tercer parámetro de la sentencia es
    // la bandera "vienen notas" y el cuarto el valor.
    const paramsNotas = () => {
      const upd = query.mock.calls.find(([sql]) => sql.includes('UPDATE asignaciones_libres SET'));
      expect(upd[0]).toContain('notas        = IF(?, ?, notas)');
      return upd[1].slice(4, 6);
    };
    const ADMIN = { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] };

    it('vaciar las notas las borra (antes un null las conservaba)', async () => {
      mockAsignacionCompleta({ estado: 'activa', notas: 'viejas' });
      query.mockResolvedValueOnce([]); // UPDATE
      mockAsignacionCompleta({ estado: 'activa' }); // recarga
      query.mockResolvedValue([[]]); // solapes
      const res = mockRes();
      await updateAsignacion(mockReq({ params: { id: '1' }, body: { notas: null }, user: ADMIN }),
        res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(paramsNotas()).toEqual([1, null]);
    });

    it('unas notas solo con espacios cuentan como vacías', async () => {
      mockAsignacionCompleta({ estado: 'activa', notas: 'viejas' });
      query.mockResolvedValueOnce([]);
      mockAsignacionCompleta({ estado: 'activa' });
      query.mockResolvedValue([[]]);
      await updateAsignacion(mockReq({ params: { id: '1' }, body: { notas: '   ' }, user: ADMIN }),
        mockRes(), mockNext());
      expect(paramsNotas()).toEqual([1, null]);
    });

    it('si no vienen notas, se conservan', async () => {
      mockAsignacionCompleta({ estado: 'activa', notas: 'viejas' });
      query.mockResolvedValueOnce([]);
      mockAsignacionCompleta({ estado: 'activa' });
      query.mockResolvedValue([[]]);
      await updateAsignacion(mockReq({ params: { id: '1' }, body: { fecha_fin: '2030-01-01T10:00:00Z' }, user: ADMIN }),
        mockRes(), mockNext());
      expect(paramsNotas()).toEqual([0, null]);
    });

    it('en una activa con las fotos de inicio subidas deja cambiar responsable, personal y notas', async () => {
      mockAsignacionCompleta({
        estado: 'activa', user_id: 2, inicio_real_at: new Date(),
        evidencias: [{ id: 9, tipo_imagen: 'delantera', momento: 'inicio' }],
      });
      query.mockResolvedValueOnce([[{ id: 1 }]]);            // el vehículo existe (es el mismo)
      query.mockResolvedValueOnce([[{ id: 3 }, { id: 4 }]]); // usuariosNoValidos: 3 y 4 existen
      query.mockResolvedValueOnce([]); // UPDATE asignaciones_libres
      query.mockResolvedValueOnce([]); // DELETE asignacion_usuarios
      query.mockResolvedValueOnce([]); // INSERT asignacion_usuarios
      query.mockResolvedValueOnce([]); // UPDATE user_id (principal)
      mockAsignacionCompleta({
        estado: 'activa', user_id: 3,
        miembros: [{ user_id: 3, rol: 'responsable', orden: 0 }, { user_id: 4, rol: 'personal', orden: 0 }],
      });
      query.mockResolvedValue([[]]); // solapes
      const res = mockRes();
      await updateAsignacion(mockReq({
        params: { id: '1' },
        body: { vehicle_id: 1, responsables: [3], personal: [4], notas: 'Cambio de turno' },
        user: ADMIN,
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(paramsNotas()).toEqual([1, 'Cambio de turno']);
      const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO asignacion_usuarios'));
      expect(insert[1]).toEqual([1, 3, 'responsable', 0, 1, 4, 'personal', 0]);
    });

    it('returns 400 for finalizada', async () => {
      mockAsignacionCompleta({ estado: 'finalizada' });
      const res = mockRes();
      await updateAsignacion(mockReq({
        params: { id: '1' }, body: { notas: 'X' },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when asignacion not found', async () => {
      query.mockResolvedValueOnce([[]]); // getAsignacionCompleta returns null
      const res = mockRes();
      await updateAsignacion(mockReq({
        params: { id: '999' }, body: { notas: 'X' },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 for cancelada asignacion', async () => {
      mockAsignacionCompleta({ estado: 'cancelada' });
      const res = mockRes();
      await updateAsignacion(mockReq({
        params: { id: '1' }, body: { notas: 'X' },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 for invalid estado (finalizada via update)', async () => {
      mockAsignacionCompleta({ estado: 'activa' });
      const res = mockRes();
      await updateAsignacion(mockReq({
        params: { id: '1' }, body: { estado: 'finalizada' },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('validates vehicle_id change while programada and without evidence', async () => {
      mockAsignacionCompleta({ estado: 'programada', vehicle_id: 1 });
      query.mockResolvedValueOnce([[{ id: 2 }]]); // vehicle found
      query.mockResolvedValueOnce([]); // UPDATE
      mockAsignacionCompleta({ estado: 'programada', vehicle_id: 2 });
      query.mockResolvedValueOnce([[]]); // solapes

      const req = mockReq({
        params: { id: '1' },
        body: { vehicle_id: 2 },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      const res = mockRes();
      await updateAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    // Reasignar el vehículo una vez hay evidencia deja fotos del vehículo
    // viejo "completando" la tanda del nuevo (getProgreso cuenta por
    // asignación, no por vehículo) — así que el candado va por delante:
    // solo mientras sigue programada y sin ni una foto subida.
    it('blocks vehicle_id change once the asignación is activa', async () => {
      mockAsignacionCompleta({ estado: 'activa', vehicle_id: 1 });
      query.mockResolvedValueOnce([[{ id: 2 }]]); // vehicle found

      const req = mockReq({
        params: { id: '1' },
        body: { vehicle_id: 2 },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      const res = mockRes();
      await updateAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('blocks vehicle_id change when evidence already exists, even if programada', async () => {
      mockAsignacionCompleta({
        estado: 'programada', vehicle_id: 1,
        evidencias: [{ id: 1, tipo_imagen: 'frontal', momento: 'inicio' }],
      });
      query.mockResolvedValueOnce([[{ id: 2 }]]); // vehicle found

      const req = mockReq({
        params: { id: '1' },
        body: { vehicle_id: 2 },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      const res = mockRes();
      await updateAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('blocks vehicle_id change when there is already an incidencia, even if programada and without photos', async () => {
      mockAsignacionCompleta({
        estado: 'programada', vehicle_id: 1,
        incidencias: [{ id: 1, tipo: 'mecanico', gravedad: 'leve', descripcion: 'Ruido en el motor', estado: 'pendiente' }],
      });
      query.mockResolvedValueOnce([[{ id: 2 }]]); // vehicle found

      const req = mockReq({
        params: { id: '1' },
        body: { vehicle_id: 2 },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      const res = mockRes();
      await updateAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('allows update without changing vehicle_id regardless of estado/evidence', async () => {
      mockAsignacionCompleta({
        estado: 'activa', vehicle_id: 1,
        evidencias: [{ id: 1, tipo_imagen: 'frontal', momento: 'inicio' }],
      });
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle found (same id, still validated)
      query.mockResolvedValueOnce([]); // UPDATE
      mockAsignacionCompleta({ estado: 'activa', vehicle_id: 1 });
      query.mockResolvedValueOnce([[]]); // solapes

      const req = mockReq({
        params: { id: '1' },
        body: { vehicle_id: 1, notas: 'sin cambiar vehículo' },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      const res = mockRes();
      await updateAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('validates user_id change', async () => {
      mockAsignacionCompleta({ estado: 'activa' });
      query.mockResolvedValueOnce([[{ id: 3 }]]); // user found
      query.mockResolvedValueOnce([]); // UPDATE
      query.mockResolvedValueOnce([]); // DELETE miembros
      query.mockResolvedValueOnce([]); // INSERT miembros
      query.mockResolvedValueOnce([]); // UPDATE user_id principal
      mockAsignacionCompleta({ estado: 'activa', user_id: 3 });
      query.mockResolvedValueOnce([[]]); // solapes

      const req = mockReq({
        params: { id: '1' },
        body: { user_id: 3 },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      const res = mockRes();
      await updateAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ── deleteAsignacion ───────────────────────────────────
  describe('deleteAsignacion', () => {
    it('soft deletes', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'programada' }]]);
      query.mockResolvedValueOnce([]); // UPDATE

      const res = mockRes();
      await deleteAsignacion(mockReq({ params: { id: '1' }, user: { id: 1 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await deleteAsignacion(mockReq({ params: { id: '999' }, user: { id: 1 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── activarAsignacion ──────────────────────────────────
  describe('activarAsignacion', () => {
    it('activates programada asignacion', async () => {
      mockAsignacionCompleta({ estado: 'programada' });
      query.mockResolvedValueOnce([]); // UPDATE
      mockAsignacionCompleta({ estado: 'activa' });

      const req = mockReq({ params: { id: '1' }, user: { id: 2, roles: ['tecnico'], permissions: [] } });
      const res = mockRes();
      await activarAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('es idempotente: sella la hora aunque ya esté activa (200)', async () => {
      mockAsignacionCompleta({ estado: 'activa' });
      query.mockResolvedValueOnce([]); // UPDATE
      mockAsignacionCompleta({ estado: 'activa' });
      const res = mockRes();
      await activarAsignacion(mockReq({ params: { id: '1' }, user: { id: 2, roles: ['tecnico'], permissions: [] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 for finalizada/cancelada', async () => {
      mockAsignacionCompleta({ estado: 'finalizada' });
      const res = mockRes();
      await activarAsignacion(mockReq({ params: { id: '1' }, user: { id: 2, roles: ['tecnico'], permissions: [] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when asignacion not found', async () => {
      query.mockResolvedValueOnce([[]]); // not found
      const res = mockRes();
      await activarAsignacion(mockReq({ params: { id: '999' }, user: { id: 2, roles: ['tecnico'], permissions: [] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 for operacional accessing another user asignacion', async () => {
      // asig.user_id = 2, req.user.id = 99, no manage_trabajos
      mockAsignacionCompleta({ estado: 'programada', user_id: 2 });
      const res = mockRes();
      await activarAsignacion(mockReq({ params: { id: '1' }, user: { id: 99, roles: ['tecnico'], permissions: [] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    describe('no antes de media hora de la hora prevista', () => {
      const TECNICO = { id: 2, roles: ['tecnico'], permissions: [] };
      const enMinutos = (m) => new Date(Date.now() + m * 60000);

      it('400 si faltan más de 30 min, y no toca la fila', async () => {
        mockAsignacionCompleta({ estado: 'programada', fecha_inicio: enMinutos(31) });
        const res = mockRes();
        await activarAsignacion(mockReq({ params: { id: '1' }, user: TECNICO }), res, mockNext());
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res._json.message).toMatch(/a partir del \d{2}\/\d{2} \d{2}:\d{2}/);
        expect(query.mock.calls.some(([sql]) => /UPDATE asignaciones_libres/.test(sql))).toBe(false);
      });

      it('200 dentro de la media hora previa', async () => {
        mockAsignacionCompleta({ estado: 'programada', fecha_inicio: enMinutos(29) });
        query.mockResolvedValueOnce([]); // UPDATE
        mockAsignacionCompleta({ estado: 'activa' });
        const res = mockRes();
        await activarAsignacion(mockReq({ params: { id: '1' }, user: TECNICO }), res, mockNext());
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('también vale para gestión', async () => {
        mockAsignacionCompleta({ estado: 'programada', fecha_inicio: enMinutos(120) });
        const res = mockRes();
        const admin = { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] };
        await activarAsignacion(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());
        expect(res.status).toHaveBeenCalledWith(400);
      });

      it('con la hora real ya sellada, repetir la pulsación no da error', async () => {
        mockAsignacionCompleta({ estado: 'activa', fecha_inicio: enMinutos(120), inicio_real_at: new Date() });
        query.mockResolvedValueOnce([]); // UPDATE (COALESCE, no cambia nada)
        mockAsignacionCompleta({ estado: 'activa' });
        const res = mockRes();
        await activarAsignacion(mockReq({ params: { id: '1' }, user: TECNICO }), res, mockNext());
        expect(res.status).toHaveBeenCalledWith(200);
      });
    });
  });

  // ── finalizarAsignacion ────────────────────────────────
  describe('finalizarAsignacion', () => {
    it('finalizes with complete evidence', async () => {
      // getAsignacionCompleta (past fecha_fin)
      mockAsignacionCompleta({ estado: 'activa', fecha_fin: new Date(Date.now() - 3600000) });
      // getProgreso (called inside finalizarAsignacion) — evidencias completas
      query.mockResolvedValueOnce([progresoCompletoRows()]);
      query.mockResolvedValueOnce([]); // UPDATE asignación
      query.mockResolvedValueOnce([]); // UPDATE km del vehículo
      mockAsignacionCompleta({ estado: 'finalizada' });

      const req = mockReq({
        params: { id: '1' }, body: { km_fin: 50100, material_usado: 'Sin gasto de material' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await finalizarAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    // El kilometraje de la flota solo avanza por aquí: el producto se usa por
    // asignaciones, no por trabajos.
    it('sube los km del vehículo y la fecha de último servicio al cerrar', async () => {
      mockAsignacionCompleta({
        estado: 'activa', vehicle_id: 7, km_inicio: 50000,
        fecha_fin: new Date(Date.now() - 3600000),
      });
      query.mockResolvedValueOnce([progresoCompletoRows()]);
      query.mockResolvedValueOnce([]); // UPDATE asignaciones_libres
      query.mockResolvedValueOnce([]); // UPDATE vehicles
      mockAsignacionCompleta({ estado: 'finalizada' });

      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 50100, material_usado: '2 mascarillas' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), mockRes(), mockNext());

      const updVehiculo = query.mock.calls.find(([sql]) => sql.includes('UPDATE vehicles'));
      expect(updVehiculo).toBeDefined();
      // No deja retroceder el cuentakilómetros
      expect(updVehiculo[0]).toContain('kilometros_actuales < ?');
      const [km, fecha, vehicleId, guard] = updVehiculo[1];
      expect(km).toBe(50100);
      expect(fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);   // día español, columna DATE
      expect(vehicleId).toBe(7);
      expect(guard).toBe(50100);
    });

    it('no toca el vehículo si el técnico no anotó los km', async () => {
      mockAsignacionCompleta({
        estado: 'activa', vehicle_id: 7, km_inicio: 50000,
        fecha_fin: new Date(Date.now() - 3600000),
      });
      query.mockResolvedValueOnce([progresoCompletoRows()]);
      query.mockResolvedValueOnce([]); // UPDATE asignaciones_libres
      mockAsignacionCompleta({ estado: 'finalizada' });

      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { material_usado: 'Sin gasto de material' },   // sin km_fin
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE vehicles'))).toBe(false);
    });

    it('returns 400 for already finalizada', async () => {
      mockAsignacionCompleta({ estado: 'finalizada' });
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 50100 },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when asignacion not found', async () => {
      query.mockResolvedValueOnce([[]]); // not found
      const res = mockRes();
      await finalizarAsignacion(mockReq({ params: { id: '999' }, body: { km_fin: 50000 }, user: { id: 2, roles: ['tecnico'], permissions: [] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 for operacional accessing another user asignacion', async () => {
      // asig.user_id = 2, req.user.id = 99, no manage_trabajos
      mockAsignacionCompleta({ estado: 'activa', user_id: 2 });
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 50000 },
        user: { id: 99, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 400 for cancelada asignacion', async () => {
      mockAsignacionCompleta({ estado: 'cancelada', user_id: 2 });
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 50000 },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 for anticipada finalization without motivo', async () => {
      // fecha_fin is in the future → anticipada
      mockAsignacionCompleta({ estado: 'activa', user_id: 2, fecha_fin: new Date(Date.now() + 86400000) });
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 50100 }, // no motivo_fin
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when km_fin < km_inicio', async () => {
      mockAsignacionCompleta({ estado: 'activa', user_id: 2, km_inicio: 50000, fecha_fin: new Date(Date.now() - 3600000) });
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 49000, material_usado: 'Sin gasto de material' }, // less than km_inicio
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    // El vehículo puede haber avanzado por otra asignación desde que empezó
    // ésta: el mínimo real no es solo km_inicio, es también el km actual del
    // vehículo. Bajarlo a propósito solo se puede desde la ficha del vehículo.
    it('returns 400 when km_fin < vehiculo_km_actual, aunque supere km_inicio', async () => {
      mockAsignacionCompleta({
        estado: 'activa', user_id: 2, km_inicio: 40000, vehiculo_km_actual: 50000,
        fecha_fin: new Date(Date.now() - 3600000),
      });
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 45000, material_usado: 'Sin gasto de material' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].message).toMatch(/km actuales del vehículo/);
    });

    it('permite finalizar con km_fin igual al km actual del vehículo', async () => {
      mockAsignacionCompleta({
        estado: 'activa', vehicle_id: 7, km_inicio: 40000, vehiculo_km_actual: 50000,
        fecha_fin: new Date(Date.now() - 3600000),
      });
      query.mockResolvedValueOnce([progresoCompletoRows()]);
      query.mockResolvedValueOnce([]); // UPDATE asignaciones_libres
      query.mockResolvedValueOnce([]); // UPDATE vehicles
      mockAsignacionCompleta({ estado: 'finalizada' });

      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 50000, material_usado: 'Sin gasto de material' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('rechaza el cierre sin material utilizado', async () => {
      // El campo es obligatorio SIEMPRE, no solo en los cierres anticipados:
      // «no se gastó nada» es un dato que hay que escribir, no un silencio.
      mockAsignacionCompleta({ estado: 'activa', user_id: 2, fecha_fin: new Date(Date.now() - 3600000) });
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 50100 },   // sin material_usado
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('Sin gasto de material');
    });

    it('rechaza el material en blanco', async () => {
      // Un textarea con espacios no es una declaración de material.
      mockAsignacionCompleta({ estado: 'activa', user_id: 2, fecha_fin: new Date(Date.now() - 3600000) });
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 50100, material_usado: '   ' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('guarda el material utilizado, ya recortado', async () => {
      mockAsignacionCompleta({ estado: 'activa', user_id: 2, fecha_fin: new Date(Date.now() - 3600000) });
      query.mockResolvedValueOnce([progresoCompletoRows()]);
      query.mockResolvedValueOnce([]); // UPDATE asignaciones_libres
      mockAsignacionCompleta({ estado: 'finalizada' });

      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { material_usado: '  1 collarin cervical  ' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      const upd = query.mock.calls.find(([sql]) => sql.includes('UPDATE asignaciones_libres SET'));
      expect(upd[0]).toContain('material_usado = ?');
      expect(upd[1]).toContain('1 collarin cervical');
    });

    it('returns 400 when evidence not complete', async () => {
      // fecha_fin past
      mockAsignacionCompleta({ estado: 'activa', user_id: 2, km_inicio: 10000, fecha_fin: new Date(Date.now() - 3600000) });
      // getProgreso returns incomplete (no images uploaded)
      query.mockResolvedValueOnce([[]]); // empty getProgreso
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 50100, material_usado: 'Sin gasto de material' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── uploadEvidencia ────────────────────────────────────
  describe('uploadEvidencia', () => {
    it('uploads evidence (new image)', async () => {
      mockAsignacionCompleta({ estado: 'activa' });
      query.mockResolvedValueOnce([[]]); // no existing image
      query.mockResolvedValueOnce([{ insertId: 50 }]); // INSERT
      query.mockResolvedValueOnce([allTiposRow()]); // getProgreso

      const req = mockReq({
        params: { id: '1' }, body: { tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/img.jpg' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await uploadEvidencia(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 when no file', async () => {
      mockAsignacionCompleta({ estado: 'activa' });
      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' }, body: { tipo_imagen: 'frontal' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when asignacion not found', async () => {
      query.mockResolvedValueOnce([[]]); // not found
      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '999' }, body: { tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/img.jpg' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 for operacional accessing another user asignacion', async () => {
      mockAsignacionCompleta({ estado: 'activa', user_id: 2 });
      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' }, body: { tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/img.jpg' },
        user: { id: 99, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 400 when asignacion already finalizada', async () => {
      mockAsignacionCompleta({ estado: 'finalizada', user_id: 2 });
      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' }, body: { tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/img.jpg' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('overwrites existing image (UPDATE path + deleteFile called)', async () => {
      const { deleteFile } = require('../../../middleware/upload.middleware');

      mockAsignacionCompleta({ estado: 'activa', user_id: 2 });
      // existing image found
      query.mockResolvedValueOnce([[{ id: 50, image_url: '/uploads/old.jpg' }]]);
      query.mockResolvedValueOnce([]); // UPDATE
      // getProgreso
      query.mockResolvedValueOnce([IMAGEN_TIPOS_REQUERIDOS.map(t => ({ tipo_imagen: t }))]);

      const req = mockReq({
        params: { id: '1' }, body: { tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/new.jpg' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await uploadEvidencia(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(deleteFile).toHaveBeenCalledWith('/uploads/old.jpg');
    });

    it('sella la hora al insertar, en lugar de dejarla a la BD', async () => {
      mockAsignacionCompleta({ estado: 'activa', user_id: 2 });
      // Con momento='inicio' el controlador mide el progreso ANTES de guardar,
      // para saber si esta foto es la que completa la tanda (aviso push).
      query.mockResolvedValueOnce([[]]);                // getProgreso previo
      query.mockResolvedValueOnce([[]]);                // no hay foto previa
      query.mockResolvedValueOnce([{ insertId: 50 }]);  // INSERT
      query.mockResolvedValueOnce([allTiposRow()]);     // getProgreso

      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' }, body: { tipo_imagen: 'frontal', momento: 'inicio' },
        processedFile: { url: '/uploads/img.jpg' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());

      const insert = query.mock.calls.find(c => /INSERT INTO vehicle_images/.test(c[0]));
      expect(insert[0]).toMatch(/created_at/);
      expect(insert[1][insert[1].length - 1]).toBeInstanceOf(Date);
      expect(res.json.mock.calls[0][0].data.uploaded_at).toBeInstanceOf(Date);
    });

    it('al rehacer una foto pone la hora al día (no deja la de la primera)', async () => {
      mockAsignacionCompleta({ estado: 'activa', user_id: 2 });
      query.mockResolvedValueOnce([[]]);            // getProgreso previo (momento='inicio')
      query.mockResolvedValueOnce([[{ id: 50, image_url: '/uploads/old.jpg' }]]);
      query.mockResolvedValueOnce([]);              // UPDATE
      query.mockResolvedValueOnce([allTiposRow()]); // getProgreso

      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' }, body: { tipo_imagen: 'frontal', momento: 'inicio' },
        processedFile: { url: '/uploads/new.jpg' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());

      const update = query.mock.calls.find(c => /UPDATE vehicle_images/.test(c[0]));
      expect(update[0]).toMatch(/created_at = \?/);
      // [image_url, uploaded_by, created_at, id]
      expect(update[1][2]).toBeInstanceOf(Date);
      expect(update[1][3]).toBe(50);
    });
  });

  // ── crearIncidenciaDesdeAsignacion ─────────────────────
  describe('crearIncidenciaDesdeAsignacion', () => {
    it('vincula la incidencia al técnico responsable de esa asignación', async () => {
      mockAsignacionCompleta({ id: 7, vehicle_id: 3, user_id: 9, matricula: '9864JSF' });
      query.mockResolvedValueOnce([{ insertId: 55 }]);          // INSERT
      query.mockResolvedValueOnce([[{ id: 55, descripcion: 'Rayón' }]]); // SELECT created

      const req = mockReq({
        params: { id: '7' },
        body: { tipo: 'dano_exterior', gravedad: 'leve', descripcion: 'Rayón' },
        user: { id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_incidencias'] },
      });
      const res = mockRes();
      await crearIncidenciaDesdeAsignacion(req, res, mockNext());

      expect(res.status).toHaveBeenCalledWith(201);
      // El INSERT recibe asignacion_id=7 y responsable_user_id=9 (user_id de la asignación)
      const insertCall = query.mock.calls.find(c => /INSERT INTO vehicle_incidencias/.test(c[0]));
      expect(insertCall).toBeDefined();
      expect(insertCall[1]).toEqual([3, 7, 1, 9, 'dano_exterior', 'leve', 'Rayón']);
    });

    it('devuelve 404 si la asignación no existe', async () => {
      query.mockResolvedValueOnce([[]]); // getAsignacionCompleta → vacío
      const req = mockReq({
        params: { id: '99' }, body: { descripcion: 'X' },
        user: { id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_incidencias'] },
      });
      const res = mockRes();
      await crearIncidenciaDesdeAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('permite al responsable (sin manage_incidencias) registrar en su propia asignación', async () => {
      mockAsignacionCompleta({ id: 7, vehicle_id: 3, user_id: 9, matricula: '9864JSF' });
      query.mockResolvedValueOnce([{ insertId: 56 }]);              // INSERT
      query.mockResolvedValueOnce([[{ id: 56, descripcion: 'Golpe' }]]); // SELECT created

      const req = mockReq({
        params: { id: '7' },
        body: { descripcion: 'Golpe' },
        user: { id: 9, username: 'tec', roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await crearIncidenciaDesdeAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('devuelve 403 si no es responsable ni tiene manage_incidencias', async () => {
      mockAsignacionCompleta({ id: 7, user_id: 9 });
      const req = mockReq({
        params: { id: '7' }, body: { descripcion: 'X' },
        user: { id: 3, username: 'otro', roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await crearIncidenciaDesdeAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('un gestor puede atribuir la incidencia a otro empleado', async () => {
      mockAsignacionCompleta({ id: 7, vehicle_id: 3, user_id: 9, matricula: '9864JSF' });
      query.mockResolvedValueOnce([[{ id: 42, username: 'otro_tec' }]]); // empleado destino
      query.mockResolvedValueOnce([{ insertId: 60 }]);                   // INSERT
      query.mockResolvedValueOnce([[{ id: 60, descripcion: 'Rayón' }]]); // SELECT created

      const req = mockReq({
        params: { id: '7' },
        body: { descripcion: 'Rayón', responsable_user_id: 42 },
        user: { id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_incidencias'] },
      });
      const res = mockRes();
      await crearIncidenciaDesdeAsignacion(req, res, mockNext());

      expect(res.status).toHaveBeenCalledWith(201);
      const insertCall = query.mock.calls.find(c => /INSERT INTO vehicle_incidencias/.test(c[0]));
      expect(insertCall[1]).toEqual([3, 7, 1, 42, 'dano_exterior', 'leve', 'Rayón']);
    });

    it('devuelve 400 si el empleado destino no existe', async () => {
      mockAsignacionCompleta({ id: 7, vehicle_id: 3, user_id: 9 });
      query.mockResolvedValueOnce([[]]); // empleado inexistente

      const req = mockReq({
        params: { id: '7' },
        body: { descripcion: 'Rayón', responsable_user_id: 999 },
        user: { id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_incidencias'] },
      });
      const res = mockRes();
      await crearIncidenciaDesdeAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('el técnico no puede atribuir su incidencia a otro empleado', async () => {
      mockAsignacionCompleta({ id: 7, vehicle_id: 3, user_id: 9 });

      const req = mockReq({
        params: { id: '7' },
        body: { descripcion: 'Golpe', responsable_user_id: 42 },
        user: { id: 9, username: 'tec', roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await crearIncidenciaDesdeAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── Avisos push a los administradores ──────────────────
  //
  // Un aviso de más es peor que uno de menos: hace sonar el teléfono de todos
  // los admins por algo de lo que ya se había avisado. Por eso casi todos
  // estos tests comprueban que NO se avisa.
  describe('avisos push', () => {
    const TECNICO = { id: 2, roles: ['tecnico'], permissions: [] };

    describe('al activar', () => {
      it('avisa cuando la asignación estaba programada', async () => {
        mockAsignacionCompleta({ estado: 'programada', id: 1 });
        query.mockResolvedValueOnce([]); // UPDATE
        mockAsignacionCompleta({ estado: 'activa' });

        await activarAsignacion(mockReq({ params: { id: '1' }, user: TECNICO }), mockRes(), mockNext());

        expect(avisos.avisarAsignacionActivada).toHaveBeenCalledTimes(1);
        expect(avisos.avisarAsignacionActivada).toHaveBeenCalledWith(
          expect.objectContaining({ id: 1, estado: 'programada' })
        );
      });

      it('NO vuelve a avisar si ya estaba activa (el endpoint es idempotente)', async () => {
        mockAsignacionCompleta({ estado: 'activa' });
        query.mockResolvedValueOnce([]); // UPDATE
        mockAsignacionCompleta({ estado: 'activa' });

        await activarAsignacion(mockReq({ params: { id: '1' }, user: TECNICO }), mockRes(), mockNext());

        expect(avisos.avisarAsignacionActivada).not.toHaveBeenCalled();
      });

      it('no avisa de una asignación que no se puede activar', async () => {
        mockAsignacionCompleta({ estado: 'finalizada' });

        const res = mockRes();
        await activarAsignacion(mockReq({ params: { id: '1' }, user: TECNICO }), res, mockNext());

        expect(res.status).toHaveBeenCalledWith(400);
        expect(avisos.avisarAsignacionActivada).not.toHaveBeenCalled();
      });

      it('no avisa cuando la petición se rechaza por permisos', async () => {
        mockAsignacionCompleta({ estado: 'programada', user_id: 2 });

        const res = mockRes();
        await activarAsignacion(
          mockReq({ params: { id: '1' }, user: { id: 99, roles: ['tecnico'], permissions: [] } }),
          res, mockNext()
        );

        expect(res.status).toHaveBeenCalledWith(403);
        expect(avisos.avisarAsignacionActivada).not.toHaveBeenCalled();
      });
    });

    describe('al completar las fotos de inicio', () => {
      /** Prepara uploadEvidencia con el progreso de antes y el de después. */
      function prepararSubida({ antes, despues, hayPrevia = false }) {
        mockAsignacionCompleta({ estado: 'activa', user_id: 2 });
        query.mockResolvedValueOnce([antes]);   // getProgreso previo
        query.mockResolvedValueOnce(hayPrevia
          ? [[{ id: 50, image_url: '/uploads/old.jpg' }]]
          : [[]]);                              // ¿había foto de este tipo?
        query.mockResolvedValueOnce([{ insertId: 50 }]); // INSERT o UPDATE
        query.mockResolvedValueOnce([despues]); // getProgreso final
      }

      const filasInicio = (tipos) => tipos.map(t => ({ tipo_imagen: t, momento: 'inicio' }));
      const TODAS           = IMAGEN_TIPOS_INICIO;
      const TODAS_MENOS_UNA = IMAGEN_TIPOS_INICIO.slice(0, -1);

      it('avisa justo cuando la última foto completa la tanda', async () => {
        prepararSubida({ antes: filasInicio(TODAS_MENOS_UNA), despues: filasInicio(TODAS) });

        const res = mockRes();
        await uploadEvidencia(mockReq({
          params: { id: '1' },
          body: { tipo_imagen: TODAS[TODAS.length - 1], momento: 'inicio' },
          processedFile: { url: '/uploads/img.jpg' },
          user: TECNICO,
        }), res, mockNext());

        expect(res.status).toHaveBeenCalledWith(200);
        expect(avisos.avisarFotosInicioCompletas).toHaveBeenCalledTimes(1);
      });

      it('no avisa mientras falten fotos', async () => {
        prepararSubida({ antes: [], despues: filasInicio(TODAS_MENOS_UNA) });

        await uploadEvidencia(mockReq({
          params: { id: '1' }, body: { tipo_imagen: 'frontal', momento: 'inicio' },
          processedFile: { url: '/uploads/img.jpg' }, user: TECNICO,
        }), mockRes(), mockNext());

        expect(avisos.avisarFotosInicioCompletas).not.toHaveBeenCalled();
      });

      it('rehacer una foto con la tanda ya completa NO vuelve a avisar', async () => {
        prepararSubida({
          antes: filasInicio(TODAS), despues: filasInicio(TODAS), hayPrevia: true,
        });

        await uploadEvidencia(mockReq({
          params: { id: '1' }, body: { tipo_imagen: 'frontal', momento: 'inicio' },
          processedFile: { url: '/uploads/nueva.jpg' }, user: TECNICO,
        }), mockRes(), mockNext());

        expect(avisos.avisarFotosInicioCompletas).not.toHaveBeenCalled();
      });

      it('las fotos de fin no disparan este aviso: ya lo hace el cierre', async () => {
        mockAsignacionCompleta({ estado: 'activa', user_id: 2 });
        query.mockResolvedValueOnce([[]]);                     // ¿había foto previa?
        query.mockResolvedValueOnce([{ insertId: 51 }]);       // INSERT
        query.mockResolvedValueOnce([progresoCompletoRows()]); // getProgreso

        await uploadEvidencia(mockReq({
          params: { id: '1' }, body: { tipo_imagen: 'frontal', momento: 'fin' },
          processedFile: { url: '/uploads/img.jpg' }, user: TECNICO,
        }), mockRes(), mockNext());

        expect(avisos.avisarFotosInicioCompletas).not.toHaveBeenCalled();
      });
    });

    describe('al finalizar', () => {
      it('avisa una vez, con los km anotados', async () => {
        mockAsignacionCompleta({
          estado: 'activa', id: 4, fecha_fin: new Date(Date.now() - 3600000),
        });
        query.mockResolvedValueOnce([progresoCompletoRows()]);
        query.mockResolvedValueOnce([]); // UPDATE asignaciones_libres
        query.mockResolvedValueOnce([]); // UPDATE vehicles
        mockAsignacionCompleta({ estado: 'finalizada' });

        const res = mockRes();
        await finalizarAsignacion(mockReq({
          params: { id: '4' }, body: { km_fin: 50100, material_usado: 'Sin gasto de material' }, user: TECNICO,
        }), res, mockNext());

        expect(res.status).toHaveBeenCalledWith(200);
        expect(avisos.avisarAsignacionFinalizada).toHaveBeenCalledTimes(1);
        expect(avisos.avisarAsignacionFinalizada).toHaveBeenCalledWith(
          expect.objectContaining({ id: 4 }),
          { km_fin: 50100 }
        );
      });

      it('no avisa si el cierre se rechaza por faltar fotos', async () => {
        mockAsignacionCompleta({ estado: 'activa', fecha_fin: new Date(Date.now() - 3600000) });
        query.mockResolvedValueOnce([[]]); // getProgreso: nada subido

        const res = mockRes();
        await finalizarAsignacion(mockReq({
          params: { id: '1' }, body: { km_fin: 100 }, user: TECNICO,
        }), res, mockNext());

        expect(res.status).toHaveBeenCalledWith(400);
        expect(avisos.avisarAsignacionFinalizada).not.toHaveBeenCalled();
      });

      it('no avisa de una asignación ya finalizada', async () => {
        mockAsignacionCompleta({ estado: 'finalizada' });

        const res = mockRes();
        await finalizarAsignacion(mockReq({
          params: { id: '1' }, body: {}, user: TECNICO,
        }), res, mockNext());

        expect(res.status).toHaveBeenCalledWith(400);
        expect(avisos.avisarAsignacionFinalizada).not.toHaveBeenCalled();
      });
    });
  });

  // ── Varios responsables y personal (v23) ───────────────
  // PROVISIONAL el `personal`: se retira cuando exista Trabajos (MAPA §7).
  describe('responsables y personal', () => {
    // Asignación con dos responsables (2 y 3) y una persona de personal (7).
    const EQUIPO = [
      { user_id: 2, rol: 'responsable', orden: 0, nombre: 'Ana',  apellidos: 'Ruiz', username: 'aruiz' },
      { user_id: 3, rol: 'responsable', orden: 1, nombre: 'Luis', apellidos: 'Gil',  username: 'lgil' },
      { user_id: 7, rol: 'personal',    orden: 0, nombre: 'Eva',  apellidos: 'Paz',  username: 'epaz' },
    ];
    const personal = { id: 7, roles: ['tecnico'], permissions: [] };

    describe('leerMiembros', () => {
      it('acepta el formato nuevo', () => {
        expect(leerMiembros({ responsables: [2, 3], personal: [7] }))
          .toEqual({ responsables: [2, 3], personal: [7] });
      });
      it('el user_id suelto del frontend anterior cuenta como único responsable', () => {
        expect(leerMiembros({ user_id: 2 })).toEqual({ responsables: [2], personal: undefined });
      });
      it('rechaza repetir a alguien, también entre responsables y personal', () => {
        expect(leerMiembros({ responsables: [2, 2] }).error).toMatch(/dos veces/);
        expect(leerMiembros({ responsables: [2], personal: [2] }).error).toMatch(/dos veces/);
      });
      it('rechaza una lista de responsables vacía', () => {
        expect(leerMiembros({ responsables: [] }).error).toMatch(/al menos un responsable/);
      });
      it('el personal puede ir vacío', () => {
        expect(leerMiembros({ responsables: [2], personal: [] }).error).toBeUndefined();
      });
    });

    describe('rolEnAsignacion', () => {
      const asig = { user_id: 2, responsables: [{ id: 2 }, { id: 3 }], personal: [{ id: 7 }] };
      it('distingue responsable, personal y ajeno', () => {
        expect(rolEnAsignacion(asig, 3)).toBe('responsable');
        expect(rolEnAsignacion(asig, 7)).toBe('personal');
        expect(rolEnAsignacion(asig, 99)).toBeNull();
      });
      it('sin filas de miembros, el responsable principal sigue valiendo', () => {
        expect(rolEnAsignacion({ user_id: 2, responsables: [], personal: [] }, 2)).toBe('responsable');
      });
    });

    it('getAsignacion devuelve las dos listas', async () => {
      mockAsignacionCompleta({ miembros: EQUIPO });
      const res = mockRes();
      await getAsignacion(mockReq({ params: { id: '1' }, user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] } }), res, mockNext());
      expect(res._json.data.responsables.map(r => r.id)).toEqual([2, 3]);
      expect(res._json.data.personal).toEqual([{ id: 7, nombre: 'Eva', apellidos: 'Paz', username: 'epaz' }]);
    });

    it('el personal PUEDE ver la asignación', async () => {
      mockAsignacionCompleta({ miembros: EQUIPO });
      const res = mockRes();
      await getAsignacion(mockReq({ params: { id: '1' }, user: personal }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('el personal NO puede activarla', async () => {
      mockAsignacionCompleta({ estado: 'programada', miembros: EQUIPO });
      const res = mockRes();
      await activarAsignacion(mockReq({ params: { id: '1' }, user: personal }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
      expect(query.mock.calls.some(([sql]) => /UPDATE asignaciones_libres SET estado/.test(sql))).toBe(false);
      expect(avisos.avisarAsignacionActivada).not.toHaveBeenCalled();
    });

    it('el personal NO puede finalizarla', async () => {
      mockAsignacionCompleta({ miembros: EQUIPO });
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { material_usado: 'Sin gasto de material' }, user: personal,
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('el personal NO puede subir evidencias', async () => {
      mockAsignacionCompleta({ miembros: EQUIPO });
      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' }, body: { tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/img.jpg' }, user: personal,
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('el personal NO puede registrar incidencias', async () => {
      mockAsignacionCompleta({ miembros: EQUIPO });
      const res = mockRes();
      await crearIncidenciaDesdeAsignacion(mockReq({
        params: { id: '1' }, body: { descripcion: 'Golpe' }, user: personal,
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('el segundo responsable sí puede activarla', async () => {
      mockAsignacionCompleta({ estado: 'programada', miembros: EQUIPO });
      query.mockResolvedValueOnce([]); // UPDATE
      mockAsignacionCompleta({ estado: 'activa', miembros: EQUIPO });
      const res = mockRes();
      await activarAsignacion(mockReq({ params: { id: '1' }, user: { id: 3, roles: ['tecnico'], permissions: [] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('el listado del operacional filtra por pertenencia, no por user_id', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, mi_rol: 'personal' }]]);
      const res = mockRes();
      await listAsignaciones(mockReq({ query: {}, user: personal }), res, mockNext());
      expect(query.mock.calls[0][0]).toContain('FROM asignacion_usuarios au');
      // al.user_id queda solo como respaldo, junto a la pertenencia
      expect(query.mock.calls[0][1]).toEqual([7, 7]);
      expect(res._json.data[0].mi_rol).toBe('personal');
    });

    it('crea con varios responsables y personal; el principal es el primero', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]);                     // vehículo
      query.mockResolvedValueOnce([[{ id: 2 }, { id: 3 }, { id: 7 }]]); // usuarios
      query.mockResolvedValueOnce([{ insertId: 5 }]);                 // INSERT asignación
      query.mockResolvedValueOnce([]);                                // DELETE miembros
      query.mockResolvedValueOnce([]);                                // INSERT miembros
      query.mockResolvedValueOnce([]);                                // UPDATE principal
      mockAsignacionCompleta({ id: 5, miembros: EQUIPO });
      query.mockResolvedValueOnce([[]]);                              // solapes

      const res = mockRes();
      await createAsignacion(mockReq({
        body: { vehicle_id: 1, responsables: [2, 3], personal: [7],
                fecha_inicio: '2026-04-15T08:00', fecha_fin: '2026-04-15T20:00' },
        user: { id: 1 },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(201);
      const insertAsig = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO asignaciones_libres'));
      expect(insertAsig[1][1]).toBe(2);
      const insertMiembros = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO asignacion_usuarios'));
      expect(insertMiembros[1]).toEqual([5, 2, 'responsable', 0, 5, 3, 'responsable', 1, 5, 7, 'personal', 0]);
    });

    it('rechaza a la misma persona dos veces sin tocar la BD', async () => {
      const res = mockRes();
      await createAsignacion(mockReq({
        body: { vehicle_id: 1, responsables: [2], personal: [2],
                fecha_inicio: '2026-04-15T08:00', fecha_fin: '2026-04-15T20:00' },
        user: { id: 1 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(query).not.toHaveBeenCalled();
    });

    it('un solape de fechas se AVISA pero no bloquea', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 2 }]]);
      query.mockResolvedValueOnce([{ insertId: 5 }]);
      query.mockResolvedValueOnce([]);
      query.mockResolvedValueOnce([]);
      query.mockResolvedValueOnce([]);
      mockAsignacionCompleta({ id: 5 });
      query.mockResolvedValueOnce([[{ user_id: 2, nombre: 'Ana Ruiz', asignacion_id: 4, matricula: 'XYZ' }]]);

      const res = mockRes();
      await createAsignacion(mockReq({
        body: { vehicle_id: 1, responsables: [2],
                fecha_inicio: '2026-04-15T08:00', fecha_fin: '2026-04-15T20:00' },
        user: { id: 1 },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res._json.data.solapes).toEqual([expect.objectContaining({ user_id: 2, asignacion_id: 4 })]);
      const sqlSolape = query.mock.calls[query.mock.calls.length - 1][0];
      expect(sqlSolape).toContain("al.estado IN ('programada','activa')");
      expect(sqlSolape).toContain('al.id <> ?');
    });

    it('editar con el user_id del frontend anterior conserva el personal', async () => {
      mockAsignacionCompleta({ estado: 'programada', miembros: EQUIPO });
      query.mockResolvedValueOnce([[{ id: 9 }]]); // usuario nuevo válido
      query.mockResolvedValueOnce([]);            // UPDATE
      query.mockResolvedValueOnce([]);            // DELETE miembros
      query.mockResolvedValueOnce([]);            // INSERT miembros
      query.mockResolvedValueOnce([]);            // UPDATE principal
      mockAsignacionCompleta({ estado: 'programada', user_id: 9 });
      query.mockResolvedValueOnce([[]]);          // solapes

      const res = mockRes();
      await updateAsignacion(mockReq({
        params: { id: '1' }, body: { user_id: 9 },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      // Con el formato viejo solo cambia el principal: el segundo responsable
      // (3) y el personal (7) se conservan.
      const insertMiembros = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO asignacion_usuarios'));
      expect(insertMiembros[1]).toEqual([1, 9, 'responsable', 0, 1, 3, 'responsable', 1, 1, 7, 'personal', 0]);
    });

    it('la incidencia de un responsable secundario queda a su nombre, no al del principal', async () => {
      mockAsignacionCompleta({ miembros: EQUIPO });
      query.mockResolvedValueOnce([{ insertId: 30 }]);
      query.mockResolvedValueOnce([[{ id: 30 }]]);
      const res = mockRes();
      await crearIncidenciaDesdeAsignacion(mockReq({
        params: { id: '1' }, body: { descripcion: 'Golpe' },
        user: { id: 3, username: 'lgil', roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
      const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO vehicle_incidencias'));
      expect(insert[1][3]).toBe(3);   // responsable_user_id
    });

    it('al editar, quien ya iba en la asignación no se revalida aunque esté de baja', async () => {
      mockAsignacionCompleta({ estado: 'programada', miembros: EQUIPO });
      query.mockResolvedValueOnce([]); // UPDATE
      query.mockResolvedValueOnce([]); // DELETE
      query.mockResolvedValueOnce([]); // INSERT
      query.mockResolvedValueOnce([]); // UPDATE principal
      mockAsignacionCompleta({ estado: 'programada', miembros: EQUIPO });
      query.mockResolvedValueOnce([[]]);

      const res = mockRes();
      await updateAsignacion(mockReq({
        params: { id: '1' }, body: { responsables: [3, 2], personal: [7] },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(query.mock.calls.some(([sql]) => sql.includes('FROM users'))).toBe(false);
    });
  });
});

function allTiposRow() {
  return [{ tipo_imagen: 'frontal' }];
}

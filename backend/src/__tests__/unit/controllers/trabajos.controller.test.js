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
  updateTrabajo, deleteTrabajo, activarVehiculo, finalizeVehiculo,
  activarTrabajo, finalizeTrabajo, uploadEvidencia, misTrab,
  estadoTrabajoDesde, vistaParaUsuario, leerVehiculos,
} = require('../../../controllers/trabajos.controller');
const { logAudit } = require('../../../controllers/admin.controller');
const { deleteFile } = require('../../../middleware/upload.middleware');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');
const { IMAGEN_TIPOS_INICIO, IMAGEN_TIPOS_FIN } = require('../../../config/constants');

// ── Personas ────────────────────────────────────────────────
const admin   = { id: 1,  username: 'admin', roles: ['administrador'],
                  permissions: ['manage_trabajos', 'view_all_trabajos'] };
const resp1   = { id: 20, username: 'ana',   roles: ['tecnico'], permissions: [] };
const resp2   = { id: 21, username: 'luis',  roles: ['tecnico'], permissions: [] };
const equipo  = { id: 30, username: 'eva',   roles: ['enfermero'], permissions: [] };
const ajeno   = { id: 99, username: 'nadie', roles: ['tecnico'], permissions: [] };
// La mayoría de la plantilla no tiene rol: antes no era «operacional» y veía todo
const sinRol  = { id: 98, username: 'sinrol', roles: [], permissions: [] };

const MANANA = () => new Date(Date.now() + 86400000);
const AYER   = () => new Date(Date.now() - 86400000);

function fotos(momento, tipos) {
  return tipos.map(t => ({ tipo_imagen: t, momento }));
}
const FOTOS_COMPLETAS = [...fotos('inicio', IMAGEN_TIPOS_INICIO), ...fotos('fin', IMAGEN_TIPOS_FIN)];

/**
 * Simula `query` respondiendo POR SQL, no por orden de llamada: cada entrada
 * es [fragmento, resultado | fn(params)] y gana la primera que encaje. Lo que
 * no encaja devuelve vacío. Así un test no se rompe porque el controlador
 * añada una consulta que a él no le importa.
 */
function bd(reglas) {
  query.mockImplementation(async (sql, params) => {
    for (const [frag, res] of reglas) {
      if (sql.includes(frag)) return typeof res === 'function' ? res(params, sql) : res;
    }
    return [[]];
  });
}

/** Reglas para que getTrabajoCompleto devuelva un trabajo con dos vehículos. */
function trabajoDosVehiculos({ trabajo = {}, vehiculos, responsables, usuarios, imagenes = [] } = {}) {
  return [
    ['JOIN users u ON t.created_by = u.id', [[{
      id: 1, identificador: 'TRB-2026-0001', nombre: 'Maratón', estado: 'activo',
      descripcion: 'Cobertura de la maratón', ubicacion: 'Parque del Retiro',
      fecha_inicio: AYER(), fecha_fin: MANANA(), ...trabajo,
    }]]],
    ['JOIN vehicles v ON tv.vehicle_id = v.id', [vehiculos || [
      { trabajo_vehiculo_id: 101, vehicle_id: 7, responsable_user_id: 20, estado: 'activo',
        kilometros_inicio: 1000, kilometros_fin: null, matricula: '7777AAA', vehiculo_alias: 'UVI-1' },
      { trabajo_vehiculo_id: 102, vehicle_id: 8, responsable_user_id: 21, estado: 'programado',
        kilometros_inicio: 2000, kilometros_fin: null, matricula: '8888BBB', vehiculo_alias: 'SVB-2' },
    ]]],
    ['FROM trabajo_vehiculo_responsables tvr\n     JOIN trabajo_vehiculos', [responsables || [
      { trabajo_vehiculo_id: 101, id: 20, nombre: 'Ana' },
      { trabajo_vehiculo_id: 102, id: 21, nombre: 'Luis' },
    ]]],
    ['FROM trabajo_usuarios tu\n     JOIN users u', [usuarios || [
      { user_id: 30, nombre: 'Eva', roles: 'enfermero' },
    ]]],
    ['FROM vehicle_images vi\n     JOIN vehicles v', [imagenes]],
  ];
}

/** Conexión de transacción que registra lo que ejecuta. */
function conexion({ estados = [], insertId = 500 } = {}) {
  const ejecutadas = [];
  const conn = {
    execute: jest.fn(async (sql, params) => {
      ejecutadas.push({ sql, params });
      if (sql.includes('SELECT estado FROM trabajo_vehiculos')) {
        return [estados.map(e => ({ estado: e }))];
      }
      if (sql.startsWith('INSERT')) return [{ insertId: insertId++ }];
      return [{ affectedRows: 1 }];
    }),
  };
  transaction.mockImplementation(async (cb) => cb(conn));
  return { conn, ejecutadas };
}

describe('trabajos.controller', () => {
  // clearAllMocks NO vacía la cola de mockResolvedValueOnce; mockReset sí.
  beforeEach(() => { jest.clearAllMocks(); query.mockReset(); transaction.mockReset(); });

  // ── Estado del trabajo a partir de sus vehículos ───────────
  describe('estadoTrabajoDesde', () => {
    it.each([
      [[], null],
      [['programado', 'programado'], 'programado'],
      [['activo', 'programado'], 'activo'],
      // Uno cerrado y otro sin empezar: el trabajo está en marcha
      [['finalizado', 'programado'], 'activo'],
      [['finalizado', 'finalizado'], 'finalizado'],
      [['finalizado', 'finalizado_anticipado'], 'finalizado_anticipado'],
    ])('%j → %s', (estados, esperado) => {
      expect(estadoTrabajoDesde(estados)).toBe(esperado);
    });
  });

  describe('leerVehiculos', () => {
    it('sin campo no toca nada', () => {
      expect(leerVehiculos(undefined)).toEqual({});
    });
    it('acepta varios responsables y el formato viejo de uno suelto', () => {
      const { vehiculos } = leerVehiculos([
        { vehicle_id: 7, responsables: [20, 21], kilometros_inicio: '100' },
        { vehicle_id: '8', responsable_user_id: 22 },
      ]);
      expect(vehiculos).toEqual([
        { vehicle_id: 7, responsables: [20, 21], kilometros_inicio: 100 },
        { vehicle_id: 8, responsables: [22], kilometros_inicio: null },
      ]);
    });
    it.each([
      ['no es lista', 'x', 'lista'],
      ['vehículo sin id', [{ responsables: [1] }], 'vehicle_id'],
      ['sin responsables', [{ vehicle_id: 7, responsables: [] }], 'al menos un responsable'],
      ['responsable inválido', [{ vehicle_id: 7, responsables: ['a'] }], 'ids de usuario'],
      ['responsable repetido', [{ vehicle_id: 7, responsables: [2, 2] }], 'dos veces'],
      ['vehículo repetido', [{ vehicle_id: 7, responsables: [2] }, { vehicle_id: 7, responsables: [3] }], 'mismo vehículo'],
    ])('rechaza: %s', (_n, lista, msg) => {
      expect(leerVehiculos(lista).error).toContain(msg);
    });
  });

  // ── Visibilidad ────────────────────────────────────────────
  describe('vistaParaUsuario', () => {
    const t = {
      id: 1,
      usuarios: [{ user_id: 30 }],
      vehiculos: [
        { vehicle_id: 7, responsable_user_id: 20, responsables: [{ id: 20 }],
          kilometros_inicio: 1000, progreso_fotos: {}, vehiculo_km_actual: 1500 },
        { vehicle_id: 8, responsable_user_id: 21, responsables: [{ id: 21 }],
          kilometros_inicio: 2000, progreso_fotos: {} },
      ],
      evidencias: [{ id: 1, vehicle_id: 7 }, { id: 2, vehicle_id: 8 }],
    };

    it('gestión lo ve todo', () => {
      const v = vistaParaUsuario(t, admin);
      expect(v.mi_rol).toBe('gestion');
      expect(v.vehiculos.every(x => x.detalle)).toBe(true);
      expect(v.evidencias).toHaveLength(2);
    });

    it('un responsable ve el detalle de SU vehículo y el otro recortado', () => {
      const v = vistaParaUsuario(t, resp1);
      expect(v.mi_rol).toBe('responsable');
      const [mio, otro] = v.vehiculos;
      expect(mio).toMatchObject({ soy_responsable: true, detalle: true, kilometros_inicio: 1000 });
      expect(otro).toMatchObject({ soy_responsable: false, detalle: false });
      expect(otro).not.toHaveProperty('kilometros_inicio');
      expect(otro).not.toHaveProperty('progreso_fotos');
      expect(v.evidencias.map(e => e.id)).toEqual([1]);
    });

    it('el equipo ve la ficha y qué vehículos van, pero ninguna evidencia ni km', () => {
      const v = vistaParaUsuario(t, equipo);
      expect(v.mi_rol).toBe('equipo');
      expect(v.vehiculos.every(x => !x.detalle)).toBe(true);
      expect(v.vehiculos[0]).not.toHaveProperty('vehiculo_km_actual');
      expect(v.vehiculos[0].responsables).toEqual([{ id: 20 }]);
      expect(v.evidencias).toEqual([]);
    });

    it('un ajeno no lo ve, ni aunque no tenga ningún rol', () => {
      expect(vistaParaUsuario(t, ajeno)).toBeNull();
      expect(vistaParaUsuario(t, sinRol)).toBeNull();
    });

    it('una fila sin responsables sigue funcionando con el principal', () => {
      const viejo = { ...t, usuarios: [], vehiculos: [{ ...t.vehiculos[0], responsables: [] }] };
      expect(vistaParaUsuario(viejo, resp1).vehiculos[0].soy_responsable).toBe(true);
    });
  });

  // ── GET /trabajos/:id ──────────────────────────────────────
  describe('getTrabajo', () => {
    it('devuelve el trabajo con descripción, ubicación y responsables por vehículo', async () => {
      bd(trabajoDosVehiculos());
      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      const t = res._json.data;
      expect(t.ubicacion).toBe('Parque del Retiro');
      expect(t.descripcion).toBe('Cobertura de la maratón');
      expect(t.vehiculos[0].responsables).toEqual([{ id: 20, nombre: 'Ana' }]);
      expect(t.vehiculos[1].responsables).toEqual([{ id: 21, nombre: 'Luis' }]);
      expect(t.usuarios[0].roles).toEqual(['enfermero']);
    });

    it('404 si no existe', async () => {
      bd([]);
      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '9' }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('403 a quien no va en el trabajo', async () => {
      bd(trabajoDosVehiculos());
      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '1' }, user: ajeno }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('un responsable que NO está en el equipo entra igual', async () => {
      bd(trabajoDosVehiculos({ usuarios: [] }));
      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '1' }, user: resp2 }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data.mi_rol).toBe('responsable');
    });

    it('al equipo le llega sin las fotos de los vehículos', async () => {
      bd(trabajoDosVehiculos({ imagenes: [{ id: 1, vehicle_id: 7, momento: 'inicio', tipo_imagen: 'frontal' }] }));
      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '1' }, user: equipo }), res, mockNext());
      expect(res._json.data.evidencias).toEqual([]);
      expect(res._json.data.vehiculos[0]).not.toHaveProperty('progreso_fotos');
    });

    describe('progreso_fotos por vehículo', () => {
      const conImagenes = (imagenes) => {
        bd(trabajoDosVehiculos({ imagenes }));
        const res = mockRes();
        return getTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext())
          .then(() => res._json.data.vehiculos);
      };

      it('sin fotos arranca a cero y lista todo lo que falta', async () => {
        const [v7] = await conImagenes([]);
        expect(v7.progreso_fotos.inicio).toEqual({
          completado: 0, total: IMAGEN_TIPOS_INICIO.length,
          faltantes: IMAGEN_TIPOS_INICIO, completo: false,
        });
      });

      it('las fotos de un vehículo no cuentan para el de al lado', async () => {
        const [v7, v8] = await conImagenes(
          fotos('inicio', IMAGEN_TIPOS_INICIO).map(f => ({ ...f, vehicle_id: 7 })));
        expect(v7.progreso_fotos.inicio.completo).toBe(true);
        expect(v8.progreso_fotos.inicio.completado).toBe(0);
      });

      it('las fotos "general" y las repetidas no inflan el contador', async () => {
        const [v7] = await conImagenes([
          { vehicle_id: 7, momento: 'general', tipo_imagen: 'danos' },
          { vehicle_id: 7, momento: 'fin', tipo_imagen: 'frontal' },
          { vehicle_id: 7, momento: 'fin', tipo_imagen: 'frontal' },
        ]);
        expect(v7.progreso_fotos.fin.completado).toBe(1);
        expect(v7.progreso_fotos.inicio.completado).toBe(0);
      });
    });
  });

  // ── Listados ───────────────────────────────────────────────
  describe('listTrabajos', () => {
    it('gestión ve todos, sin filtro de pertenencia', async () => {
      bd([['COUNT(*) AS total', [[{ total: 2 }]]], ['GROUP BY t.id', [[{ id: 1 }, { id: 2 }]]]]);
      const res = mockRes();
      await listTrabajos(mockReq({ query: {}, user: admin }), res, mockNext());
      expect(res._json.data).toHaveLength(2);
      expect(query.mock.calls[0][0]).not.toContain('trabajo_vehiculo_responsables');
    });

    it.each([['un técnico', resp1], ['un usuario sin rol', sinRol]])(
      '%s solo ve los suyos: equipo o responsable de un vehículo', async (_n, user) => {
        bd([['COUNT(*) AS total', [[{ total: 0 }]]]]);
        await listTrabajos(mockReq({ query: {}, user }), mockRes(), mockNext());
        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain('trabajo_usuarios tu');
        expect(sql).toContain('trabajo_vehiculo_responsables tvr');
        expect(params).toEqual([user.id, user.id]);
      });

    it('aplica los filtros, y la búsqueda mira también la ubicación', async () => {
      bd([['COUNT(*) AS total', [[{ total: 1 }]]]]);
      await listTrabajos(mockReq({
        query: { estado: 'activo', tipo: 'traslado', fecha_desde: '2026-01-01',
                 fecha_hasta: '2026-12-31', search: 'Retiro' },
        user: admin,
      }), mockRes(), mockNext());
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('t.ubicacion LIKE ?');
      expect(params).toEqual(['activo', 'traslado', '2026-01-01', '2026-12-31 23:59:59',
        '%Retiro%', '%Retiro%', '%Retiro%']);
    });
  });

  describe('listTrabajosCalendario', () => {
    it('devuelve el mes con el título y la ubicación', async () => {
      bd([['FROM trabajos t', [[{ id: 1, nombre: 'Maratón' }]]]]);
      const res = mockRes();
      await listTrabajosCalendario(mockReq({ query: { year: '2026', month: '4' }, user: admin }), res, mockNext());
      expect(res._json.data).toEqual([{ id: 1, nombre: 'Maratón' }]);
      expect(query.mock.calls[0][0]).toContain('t.ubicacion');
    });

    it('a quien no ve todo le filtra por pertenencia', async () => {
      bd([]);
      await listTrabajosCalendario(mockReq({ query: { year: '2026', month: '4' }, user: resp1 }), mockRes(), mockNext());
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('trabajo_vehiculo_responsables');
      expect(params.slice(2)).toEqual([20, 20]);
    });

    it('diciembre pasa a enero del año siguiente', async () => {
      bd([]);
      await listTrabajosCalendario(mockReq({ query: { year: '2026', month: '12' }, user: admin }), mockRes(), mockNext());
      const [hasta] = query.mock.calls[0][1];
      expect(hasta.toISOString()).toBe('2026-12-31T23:00:00.000Z');
    });

    it('acota el mes por la medianoche española, no por la UTC', async () => {
      bd([]);
      await listTrabajosCalendario(mockReq({ query: { year: '2026', month: '7' }, user: admin }), mockRes(), mockNext());
      const [hasta, desde] = query.mock.calls[0][1];
      expect(desde.toISOString()).toBe('2026-06-30T22:00:00.000Z');
      expect(hasta.toISOString()).toBe('2026-07-31T22:00:00.000Z');
    });
  });

  describe('misTrab', () => {
    it('una fila por trabajo, suyos por equipo o por vehículo', async () => {
      bd([['COUNT(*) AS total', [[{ total: 1 }]]],
          ['vehiculos_resumen', [[{ id: 1, vehiculos_resumen: 'UVI-1, SVB-2', soy_responsable: 1 }]]]]);
      const res = mockRes();
      await misTrab(mockReq({ query: {}, user: resp1 }), res, mockNext());
      expect(res._json.data).toHaveLength(1);
      const [sql, params] = query.mock.calls[1];
      expect(sql).toContain('mis_vehiculos_pendientes');
      expect(sql).not.toContain('LEFT JOIN trabajo_vehiculos');  // multiplicaba filas
      expect(params).toEqual([20, 20, 20, 20, 20, 0]);
    });

    it('respeta el limit que se pide, con tope', async () => {
      bd([['COUNT(*) AS total', [[{ total: 0 }]]]]);
      await misTrab(mockReq({ query: { limit: '5000', page: '2' }, user: resp1 }), mockRes(), mockNext());
      const params = query.mock.calls[1][1];
      const [limit, offset] = params.slice(-2);
      expect(limit).toBeLessThan(5000);
      expect(offset).toBe(limit);
    });
  });

  // ── POST /trabajos ─────────────────────────────────────────
  describe('createTrabajo', () => {
    const body = (extra = {}) => ({
      nombre: 'Maratón', tipo: 'cobertura_evento',
      descripcion: '  Cobertura  ', ubicacion: '',
      fecha_inicio: '2026-10-15T08:00:00Z', fecha_fin: '2026-10-15T20:00:00Z',
      vehiculos: [{ vehicle_id: 7, responsables: [20, 21], kilometros_inicio: 1200 }],
      usuarios: [30],
      ...extra,
    });

    it('crea el trabajo con sus vehículos, varios responsables y el equipo', async () => {
      bd([['FROM users', (params) => [params.map(id => ({ id }))]],
          ...trabajoDosVehiculos()]);
      const { ejecutadas } = conexion({ insertId: 10 });

      const res = mockRes();
      await createTrabajo(mockReq({ body: body(), user: admin }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(201);
      const insTrab = ejecutadas.find(e => e.sql.includes('INSERT INTO trabajos'));
      // descripción recortada, ubicación en blanco → NULL
      expect(insTrab.params.slice(1, 4)).toEqual(['Maratón', 'Cobertura', null]);

      const insVeh = ejecutadas.find(e => e.sql.includes('INSERT INTO trabajo_vehiculos'));
      expect(insVeh.params).toEqual([10, 7, 20, 1200]);  // principal = primero

      const resps = ejecutadas.find(e => e.sql.includes('INSERT INTO trabajo_vehiculo_responsables'));
      expect(resps.params).toEqual([11, 20, 0, 11, 21, 1]);

      expect(ejecutadas.some(e => e.sql.includes('UPDATE vehicles SET kilometros_actuales'))).toBe(true);
      expect(ejecutadas.some(e => e.sql.includes('INSERT IGNORE INTO trabajo_usuarios'))).toBe(true);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'create_trabajo' }));
    });

    it('un trabajo sin vehículos también vale', async () => {
      bd([['FROM users', (params) => [params.map(id => ({ id }))]], ...trabajoDosVehiculos()]);
      const { ejecutadas } = conexion();
      const res = mockRes();
      await createTrabajo(mockReq({ body: body({ vehiculos: [] }), user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
      expect(ejecutadas.some(e => e.sql.includes('trabajo_vehiculos'))).toBe(false);
    });

    it('400 si las fechas van al revés', async () => {
      const res = mockRes();
      await createTrabajo(mockReq({ body: body({ fecha_fin: '2026-10-14T08:00:00Z' }), user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('400 si un vehículo no lleva responsable', async () => {
      const res = mockRes();
      await createTrabajo(mockReq({ body: body({ vehiculos: [{ vehicle_id: 7 }] }), user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('al menos un responsable');
    });

    it('400 si el equipo trae ids que no son números', async () => {
      const res = mockRes();
      await createTrabajo(mockReq({ body: body({ usuarios: ['x'] }), user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('400 si alguien no existe o está de baja', async () => {
      bd([['FROM users', [[{ id: 20 }, { id: 21 }]]]]);  // falta el 30
      const res = mockRes();
      await createTrabajo(mockReq({ body: body(), user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('30');
    });

    it('continúa la numeración del año', async () => {
      bd([['FROM users', (params) => [params.map(id => ({ id }))]],
          ['identificador LIKE', [[{ identificador: 'TRB-2026-0041' }]]],
          ...trabajoDosVehiculos()]);
      const { ejecutadas } = conexion();
      await createTrabajo(mockReq({ body: body(), user: admin }), mockRes(), mockNext());
      const insTrab = ejecutadas.find(e => e.sql.includes('INSERT INTO trabajos'));
      expect(insTrab.params[0]).toMatch(/-0042$/);
    });
  });

  // ── PUT /trabajos/:id ──────────────────────────────────────
  describe('updateTrabajo', () => {
    const existente = (estado = 'programado') =>
      ['SELECT id, estado, fecha_inicio, fecha_fin FROM trabajos',
       [[{ id: 1, estado, fecha_inicio: new Date('2026-10-15T08:00:00Z'),
           fecha_fin: new Date('2026-10-15T20:00:00Z') }]]];
    const usuariosOk = ['FROM users', (params) => [params.map(id => ({ id }))]];
    const actuales = (filas) => ['AS fotos', [filas]];

    it('404 si no existe', async () => {
      bd([]);
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: {}, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it.each(['finalizado', 'finalizado_anticipado'])('400 si el trabajo está %s', async (estado) => {
      bd([existente(estado)]);
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: { nombre: 'X' }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('400 si una sola fecha nueva deja el fin antes del inicio', async () => {
      bd([existente()]);
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' },
        body: { fecha_fin: '2026-10-15T07:00:00Z' }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    // Producción corre con TZ=Europe/Madrid. El frontend manda UTC SIN zona;
    // con new Date() ese texto se leía como hora española (2 h antes en
    // octubre) y un fin 1 h después del inicio salía "antes" del inicio.
    describe('con el proceso en hora española', () => {
      const tzOriginal = process.env.TZ;
      beforeAll(() => { process.env.TZ = 'Europe/Madrid'; });
      afterAll(() => { process.env.TZ = tzOriginal; });

      it('un fin sin zona 1 h después del inicio guardado NO se rechaza', async () => {
        bd([existente(), ...trabajoDosVehiculos()]);
        conexion();
        const res = mockRes();
        await updateTrabajo(mockReq({ params: { id: '1' },
          body: { fecha_fin: '2026-10-15T09:00' }, user: admin }), res, mockNext());
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('un fin sin zona 1 h antes del inicio guardado sí se rechaza', async () => {
        bd([existente()]);
        const res = mockRes();
        await updateTrabajo(mockReq({ params: { id: '1' },
          body: { fecha_fin: '2026-10-15T07:00' }, user: admin }), res, mockNext());
        expect(res.status).toHaveBeenCalledWith(400);
      });
    });

    it('actualiza los campos y NO acepta un estado puesto a mano', async () => {
      bd([existente(), ...trabajoDosVehiculos()]);
      const { ejecutadas } = conexion();
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' },
        body: { nombre: 'Nuevo', ubicacion: ' Ifema ', descripcion: '', estado: 'activo' },
        user: admin }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      const upd = ejecutadas.find(e => e.sql.startsWith('UPDATE trabajos SET'));
      expect(upd.sql).not.toContain('estado');
      expect(upd.params).toEqual(['Nuevo', null, 'Ifema', 1]);
    });

    it('conserva la fila de un vehículo que sigue: estado y fotos no se pierden', async () => {
      bd([existente(), usuariosOk,
          actuales([{ id: 101, vehicle_id: 7, estado: 'activo', fotos: 7, matricula: '7777AAA' }]),
          ...trabajoDosVehiculos()]);
      const { ejecutadas } = conexion({ estados: ['activo'] });
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' },
        body: { vehiculos: [{ vehicle_id: 7, responsables: [21, 20] }] }, user: admin }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(ejecutadas.some(e => e.sql.includes('DELETE FROM trabajo_vehiculos'))).toBe(false);
      const principal = ejecutadas.find(e => e.sql.includes('SET responsable_user_id'));
      expect(principal.params).toEqual([21, 101]);
      // Ya activo: el km de inicio no se reescribe
      expect(ejecutadas.some(e => e.sql.includes('SET kilometros_inicio'))).toBe(false);
    });

    it('quita un vehículo sin empezar ni fotos y añade otro nuevo', async () => {
      bd([existente(), usuariosOk,
          actuales([{ id: 101, vehicle_id: 7, estado: 'programado', fotos: 0, matricula: '7777AAA' }]),
          ...trabajoDosVehiculos()]);
      const { ejecutadas } = conexion({ estados: ['programado'] });
      await updateTrabajo(mockReq({ params: { id: '1' },
        body: { vehiculos: [{ vehicle_id: 9, responsables: [20] }] }, user: admin }), mockRes(), mockNext());

      const borrado = ejecutadas.find(e => e.sql.includes('DELETE FROM trabajo_vehiculos'));
      expect(borrado.params).toEqual([101]);
      expect(ejecutadas.find(e => e.sql.includes('INSERT INTO trabajo_vehiculos')).params)
        .toEqual([1, 9, 20, null]);
      expect(ejecutadas.some(e => e.sql.includes('SELECT estado FROM trabajo_vehiculos'))).toBe(true);
    });

    it.each([
      ['ya ha empezado', { estado: 'activo', fotos: 0 }],
      ['tiene fotos subidas', { estado: 'programado', fotos: 3 }],
    ])('400 al quitar un vehículo que %s', async (_n, fila) => {
      bd([existente(), usuariosOk,
          actuales([{ id: 101, vehicle_id: 7, matricula: '7777AAA', ...fila }])]);
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: { vehiculos: [] }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('7777AAA');
      expect(transaction).not.toHaveBeenCalled();
    });

    it('rehace el equipo', async () => {
      bd([existente(), usuariosOk, ...trabajoDosVehiculos()]);
      const { ejecutadas } = conexion();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: { usuarios: [30, 31] }, user: admin }),
        mockRes(), mockNext());
      expect(ejecutadas.some(e => e.sql.includes('DELETE FROM trabajo_usuarios'))).toBe(true);
      expect(ejecutadas.filter(e => e.sql.includes('INSERT IGNORE INTO trabajo_usuarios'))).toHaveLength(2);
    });

    it('quien ya iba no bloquea la edición aunque esté de baja', async () => {
      bd([existente(), ['UNION', [[{ user_id: 30 }]]], ['FROM users', [[]]], ...trabajoDosVehiculos()]);
      conexion();
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: { usuarios: [30] }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('400 si un vehículo viene sin responsables', async () => {
      bd([existente()]);
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' },
        body: { vehiculos: [{ vehicle_id: 7, responsables: [] }] }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('400 si un nuevo miembro no existe', async () => {
      bd([existente(), ['FROM users', [[]]]]);
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: { usuarios: [77] }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('400 si el equipo trae ids no válidos', async () => {
      bd([existente()]);
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: { usuarios: [0] }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── DELETE /trabajos/:id ───────────────────────────────────
  describe('deleteTrabajo', () => {
    it('borrado lógico', async () => {
      bd([['SELECT id, estado FROM trabajos', [[{ id: 1, estado: 'programado' }]]]]);
      const res = mockRes();
      await deleteTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(query.mock.calls[1][0]).toContain('SET deleted_at');
    });

    it('400 si está activo', async () => {
      bd([['SELECT id, estado FROM trabajos', [[{ id: 1, estado: 'activo' }]]]]);
      const res = mockRes();
      await deleteTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('404 si no existe', async () => {
      bd([]);
      const res = mockRes();
      await deleteTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── Ciclo de vida por vehículo ─────────────────────────────
  const filaVehiculo = (extra = {}) => ['FROM trabajo_vehiculos tv\n     JOIN trabajos t ON t.id = tv.trabajo_id\n     JOIN vehicles v',
    [[{ id: 101, trabajo_id: 1, vehicle_id: 7, estado: 'activo', inicio_real_at: null,
        kilometros_inicio: 1000, vehiculo_km_actual: 1100, matricula: '7777AAA',
        fecha_inicio: AYER(), fecha_fin: AYER(), ...extra }]]];
  const esResponsable = (si = true) =>
    ['FROM trabajo_vehiculo_responsables WHERE trabajo_vehiculo_id', [si ? [{ ok: 1 }] : []]];
  const reqVeh = (user, body = {}) => mockReq({ params: { id: '1', vehicleId: '7' }, body, user });

  describe('activarVehiculo', () => {
    it('404 si el vehículo no va en ese trabajo', async () => {
      bd([]);
      const res = mockRes();
      await activarVehiculo(reqVeh(admin), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('403 a quien no es responsable de ESE vehículo', async () => {
      bd([filaVehiculo({ estado: 'programado' }), esResponsable(false)]);
      const res = mockRes();
      await activarVehiculo(reqVeh(resp2), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('el responsable activa SOLO su vehículo y el trabajo pasa a activo', async () => {
      bd([filaVehiculo({ estado: 'programado', fecha_inicio: new Date(Date.now() + 3600e3) }),
          esResponsable(), ...trabajoDosVehiculos()]);
      const { ejecutadas } = conexion({ estados: ['activo', 'programado'] });
      const res = mockRes();
      await activarVehiculo(reqVeh(resp1), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      const act = ejecutadas.find(e => e.sql.includes('UPDATE trabajo_vehiculos'));
      expect(act.sql).toContain('inicio_real_at = COALESCE(inicio_real_at, ?)');
      expect(act.params[2]).toBe(101);
      const sinc = ejecutadas.find(e => e.sql.includes('UPDATE trabajos SET estado'));
      expect(sinc.params).toEqual(['activo', 1]);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'activate_trabajo_vehiculo' }));
    });

    it('si el cron ya lo activó, el responsable solo sella la hora real', async () => {
      bd([filaVehiculo({ estado: 'activo' }), esResponsable(), ...trabajoDosVehiculos()]);
      conexion({ estados: ['activo'] });
      const res = mockRes();
      await activarVehiculo(reqVeh(resp1), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('400 si ya cerró', async () => {
      bd([filaVehiculo({ estado: 'finalizado' }), esResponsable()]);
      const res = mockRes();
      await activarVehiculo(reqVeh(resp1), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('400 al responsable que se adelanta más de 24 h', async () => {
      bd([filaVehiculo({ estado: 'programado', fecha_inicio: new Date(Date.now() + 48 * 3600e3) }),
          esResponsable()]);
      const res = mockRes();
      await activarVehiculo(reqVeh(resp1), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('24 horas');
    });

    it('gestión no tiene ventana de 24 h ni necesita ser responsable', async () => {
      bd([filaVehiculo({ estado: 'programado', fecha_inicio: new Date(Date.now() + 48 * 3600e3) }),
          ...trabajoDosVehiculos()]);
      conexion({ estados: ['activo'] });
      const res = mockRes();
      await activarVehiculo(reqVeh(admin), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('finalizeVehiculo', () => {
    const conFotos = (imgs = FOTOS_COMPLETAS) =>
      ['SELECT tipo_imagen, momento FROM vehicle_images', [imgs]];

    it('403 a quien no es responsable de ESE vehículo', async () => {
      bd([filaVehiculo(), esResponsable(false)]);
      const res = mockRes();
      await finalizeVehiculo(reqVeh(resp2, { kilometros_fin: 1200 }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('404 si el vehículo no va en ese trabajo', async () => {
      bd([]);
      const res = mockRes();
      await finalizeVehiculo(reqVeh(admin, { kilometros_fin: 1200 }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('400 si ese vehículo ya cerró', async () => {
      bd([filaVehiculo({ estado: 'finalizado' }), esResponsable()]);
      const res = mockRes();
      await finalizeVehiculo(reqVeh(resp1, { kilometros_fin: 1200 }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('400 si es anticipado y no hay motivo', async () => {
      bd([filaVehiculo({ fecha_fin: MANANA() }), esResponsable()]);
      const res = mockRes();
      await finalizeVehiculo(reqVeh(resp1, { kilometros_fin: 1200 }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('motivo');
    });

    it.each([
      ['sin km', {}, 'kilómetros finales'],
      ['km por debajo del inicio', { kilometros_fin: 900 }, 'de inicio'],
      ['km por debajo del actual del vehículo', { kilometros_fin: 1050 }, 'km actuales'],
    ])('400 %s', async (_n, body, msg) => {
      bd([filaVehiculo(), esResponsable()]);
      const res = mockRes();
      await finalizeVehiculo(reqVeh(resp1, body), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain(msg);
    });

    it('400 si faltan las fotos de INICIO, y lo dice', async () => {
      bd([filaVehiculo(), esResponsable(), conFotos(fotos('fin', IMAGEN_TIPOS_FIN))]);
      const res = mockRes();
      await finalizeVehiculo(reqVeh(resp1, { kilometros_fin: 1200 }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('INICIO');
    });

    it('400 si faltan fotos de FIN', async () => {
      bd([filaVehiculo(), esResponsable(), conFotos(fotos('inicio', IMAGEN_TIPOS_INICIO))]);
      const res = mockRes();
      await finalizeVehiculo(reqVeh(resp1, { kilometros_fin: 1200 }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('FIN');
    });

    it('cierra SU vehículo; con el otro aún en marcha el trabajo sigue activo', async () => {
      bd([filaVehiculo(), esResponsable(), conFotos(), ...trabajoDosVehiculos()]);
      const { ejecutadas } = conexion({ estados: ['finalizado', 'programado'] });
      const res = mockRes();
      await finalizeVehiculo(reqVeh(resp1, { kilometros_fin: 1200 }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      const cierre = ejecutadas.find(e => e.sql.includes('UPDATE trabajo_vehiculos'));
      expect(cierre.params[0]).toBe('finalizado');
      expect(cierre.params[1]).toBe(1200);
      expect(cierre.params[4]).toBe(101);           // solo esa fila
      const sinc = ejecutadas.find(e => e.sql.includes('UPDATE trabajos SET estado'));
      expect(sinc.params).toEqual(['activo', 1]);
      expect(res._json.message).toBe('Vehículo cerrado correctamente');
    });

    it('el último vehículo en cerrar finaliza el trabajo', async () => {
      bd([filaVehiculo(), esResponsable(), conFotos(), ...trabajoDosVehiculos()]);
      conexion({ estados: ['finalizado', 'finalizado'] });
      const res = mockRes();
      await finalizeVehiculo(reqVeh(resp1, { kilometros_fin: 1200 }), res, mockNext());
      expect(res._json.message).toContain('el trabajo queda finalizado');
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'finalize_trabajo_vehiculo',
        details: expect.objectContaining({ estado_trabajo: 'finalizado' }),
      }));
    });

    it('anticipado con motivo: queda en la fila del vehículo', async () => {
      bd([filaVehiculo({ fecha_fin: MANANA() }), conFotos(), ...trabajoDosVehiculos()]);
      const { ejecutadas } = conexion({ estados: ['finalizado_anticipado'] });
      const res = mockRes();
      await finalizeVehiculo(reqVeh(admin, { kilometros_fin: 1200, motivo_finalizacion_anticipada: ' Lluvia ' }),
        res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      const cierre = ejecutadas.find(e => e.sql.includes('UPDATE trabajo_vehiculos'));
      expect(cierre.params[0]).toBe('finalizado_anticipado');
      expect(cierre.params[3]).toBe('Lluvia');
    });
  });

  // ── Trabajos sin vehículos ─────────────────────────────────
  describe('activarTrabajo / finalizeTrabajo (0 vehículos)', () => {
    const trabajo = (extra = {}) => ['AS num_vehiculos',
      [[{ id: 1, estado: 'programado', fecha_inicio: AYER(), fecha_fin: AYER(), num_vehiculos: 0, ...extra }]]];

    it('404 si no existe', async () => {
      bd([]);
      const res = mockRes();
      await activarTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it.each([['activarTrabajo', activarTrabajo], ['finalizeTrabajo', finalizeTrabajo]])(
      '%s: 400 si el trabajo tiene vehículos', async (_n, fn) => {
        bd([trabajo({ num_vehiculos: 2 })]);
        const res = mockRes();
        await fn(mockReq({ params: { id: '1' }, body: {}, user: admin }), res, mockNext());
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res._json.message).toContain('por separado');
      });

    it('activa un trabajo sin vehículos', async () => {
      bd([trabajo(), ...trabajoDosVehiculos({ vehiculos: [], responsables: [] })]);
      const res = mockRes();
      await activarTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('400 al activar lo que no está programado', async () => {
      bd([trabajo({ estado: 'activo' })]);
      const res = mockRes();
      await activarTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('finaliza; anticipado exige motivo', async () => {
      bd([trabajo({ estado: 'activo', fecha_fin: MANANA() })]);
      const res = mockRes();
      await finalizeTrabajo(mockReq({ params: { id: '1' }, body: {}, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);

      bd([trabajo({ estado: 'activo', fecha_fin: MANANA() }), ...trabajoDosVehiculos({ vehiculos: [], responsables: [] })]);
      const res2 = mockRes();
      await finalizeTrabajo(mockReq({ params: { id: '1' }, body: { motivo_finalizacion_anticipada: 'Suspendido' }, user: admin }),
        res2, mockNext());
      expect(res2.status).toHaveBeenCalledWith(200);
      const upd = query.mock.calls.find(([sql]) => sql.includes('motivo_finalizacion_anticipada = ?'));
      expect(upd[1]).toEqual(['finalizado_anticipado', 'Suspendido', 1]);
    });

    it('400 si ya está finalizado', async () => {
      bd([trabajo({ estado: 'finalizado' })]);
      const res = mockRes();
      await finalizeTrabajo(mockReq({ params: { id: '1' }, body: {}, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('404 al finalizar uno que no existe', async () => {
      bd([]);
      const res = mockRes();
      await finalizeTrabajo(mockReq({ params: { id: '1' }, body: {}, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── POST /trabajos/:id/evidencias ──────────────────────────
  describe('uploadEvidencia', () => {
    const rel = (estado = 'activo') => ['WHERE tv.trabajo_id = ? AND tv.vehicle_id = ? AND t.deleted_at IS NULL',
      [[{ id: 101, estado }]]];
    const req = (body = {}, file = { url: '/uploads/x.webp' }) => mockReq({
      params: { id: '1' },
      body: { vehicle_id: '7', tipo_imagen: 'frontal', momento: 'fin', ...body },
      user: resp1, processedFile: file,
    });

    it('sube la foto y devuelve el progreso de la tanda', async () => {
      bd([rel(), ['INSERT INTO vehicle_images', [{ insertId: 55 }]],
          ['AND tipo_imagen = ? AND momento = ?', [[]]],
          ['AND momento = ?', [[{ tipo_imagen: 'frontal' }]]]]);
      const res = mockRes();
      await uploadEvidencia(req(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res._json.data.id).toBe(55);
      expect(res._json.data.progreso.completado).toBe(1);
    });

    it('rehace una foto: borra la vieja y vuelve a sellar la hora', async () => {
      bd([rel(),
          ['AND tipo_imagen = ? AND momento = ?', [[{ id: 9, image_url: '/uploads/viejo.webp' }]]],
          ['AND momento = ?', [[{ tipo_imagen: 'frontal' }]]]]);
      const res = mockRes();
      await uploadEvidencia(req(), res, mockNext());
      expect(deleteFile).toHaveBeenCalledWith('/uploads/viejo.webp');
      expect(res._json.data.id).toBe(9);
    });

    it('400 si el vehículo de ESTE trabajo ya cerró, aunque el trabajo siga', async () => {
      bd([rel('finalizado')]);
      const res = mockRes();
      await uploadEvidencia(req(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('ya ha cerrado');
    });

    it('400 si el vehículo no va en el trabajo', async () => {
      bd([]);
      const res = mockRes();
      await uploadEvidencia(req(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('400 sin imagen', async () => {
      bd([rel()]);
      const res = mockRes();
      await uploadEvidencia(req({}, null), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it.each([
      ['sin vehicle_id', { vehicle_id: '' }],
      ['momento que no es inicio ni fin', { momento: 'general' }],
      ['tipo que no toca en ese momento', { momento: 'fin', tipo_imagen: 'nivel_aceite' }],
    ])('400 %s', async (_n, body) => {
      const res = mockRes();
      await uploadEvidencia(req(body), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('sin momento asume "fin", que es el flujo de cierre', async () => {
      bd([rel(), ['INSERT INTO vehicle_images', [{ insertId: 1 }]]]);
      const res = mockRes();
      await uploadEvidencia(req({ momento: undefined }), res, mockNext());
      expect(res._json.data.momento).toBe('fin');
    });
  });

  // ── Errores de BD: todos los endpoints delegan en next ─────
  describe('un fallo de BD siempre va a next(err)', () => {
    const casos = [
      ['listTrabajos',           () => listTrabajos(mockReq({ query: {}, user: admin }), mockRes(), next)],
      ['listTrabajosCalendario', () => listTrabajosCalendario(mockReq({ query: {}, user: admin }), mockRes(), next)],
      ['getTrabajo',             () => getTrabajo(mockReq({ params: { id: '1' }, user: admin }), mockRes(), next)],
      ['createTrabajo',          () => createTrabajo(mockReq({ body: { nombre: 'T', tipo: 'otro', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-02', usuarios: [3] }, user: admin }), mockRes(), next)],
      ['updateTrabajo',          () => updateTrabajo(mockReq({ params: { id: '1' }, body: { nombre: 'T' }, user: admin }), mockRes(), next)],
      ['deleteTrabajo',          () => deleteTrabajo(mockReq({ params: { id: '1' }, user: admin }), mockRes(), next)],
      ['activarVehiculo',        () => activarVehiculo(reqVeh(admin), mockRes(), next)],
      ['finalizeVehiculo',       () => finalizeVehiculo(reqVeh(admin, { kilometros_fin: 1 }), mockRes(), next)],
      ['activarTrabajo',         () => activarTrabajo(mockReq({ params: { id: '1' }, user: admin }), mockRes(), next)],
      ['finalizeTrabajo',        () => finalizeTrabajo(mockReq({ params: { id: '1' }, body: {}, user: admin }), mockRes(), next)],
      ['uploadEvidencia',        () => uploadEvidencia(mockReq({ params: { id: '1' }, body: { vehicle_id: '7', tipo_imagen: 'frontal', momento: 'fin' }, user: admin }), mockRes(), next)],
      ['misTrab',                () => misTrab(mockReq({ query: {}, user: admin }), mockRes(), next)],
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

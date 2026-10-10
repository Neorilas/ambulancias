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

jest.mock('../../../services/avisosAsignacion.service', () => ({
  avisarAsignacionNueva: jest.fn(),
  avisarEquipoTrabajo: jest.fn(),
  avisarCoordinadorTrabajo: jest.fn(),
  avisarTrabajoPendienteCierre: jest.fn(),
}));

const {
  listTrabajos, listTrabajosCalendario, miCalendario, getTrabajo, createTrabajo,
  updateTrabajo, deleteTrabajo, cerrarTrabajo, activarVehiculo, finalizeVehiculo,
  activarTrabajo, finalizeTrabajo, uploadEvidencia, misTrab,
  estadoTrabajoDesde, vistaParaUsuario, leerVehiculos, leerAmbulancias,
} = require('../../../controllers/trabajos.controller');
const avisos = require('../../../services/avisosAsignacion.service');
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
// Coordinador de un trabajo (v33): no hace falta que vaya en ninguna ambulancia
const coord   = { id: 50, username: 'carla', roles: [], permissions: [] };

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

/**
 * Reglas para un trabajo del modelo nuevo (v33): dos ambulancias como
 * asignaciones. A (UVI-1) la llevan Ana (responsable) y Eva (equipo); B
 * (SVB-2), Luis. Coordina Carla (50), que no va en ninguna.
 */
function trabajoConAsignaciones({ trabajo = {}, asignaciones, miembros, fotosAsig = [] } = {}) {
  return [
    ['JOIN users u ON t.created_by = u.id', [[{
      id: 1, identificador: 'TRB-2026-0002', nombre: 'Maratón', estado: 'activo',
      descripcion: 'Cobertura de la maratón', ubicacion: 'Parque del Retiro',
      coordinador_user_id: 50, coordinador_nombre: 'Carla', coordinador_apellidos: 'Ruiz',
      fecha_inicio: AYER(), fecha_fin: MANANA(), ...trabajo,
    }]]],
    ['FROM asignaciones_libres al\n     JOIN vehicles v ON v.id = al.vehicle_id', [asignaciones || [
      { id: 201, vehicle_id: 7, estado: 'activa', km_inicio: 1000, inicio_real_at: AYER(),
        fecha_inicio: AYER(), fecha_fin: MANANA(), matricula: '7777AAA', vehiculo_alias: 'UVI-1' },
      { id: 202, vehicle_id: 8, estado: 'programada', km_inicio: 2000, inicio_real_at: null,
        fecha_inicio: AYER(), fecha_fin: MANANA(), matricula: '8888BBB', vehiculo_alias: 'SVB-2' },
    ]]],
    ['FROM asignacion_usuarios au\n     JOIN asignaciones_libres al', [miembros || [
      { asignacion_id: 201, rol: 'responsable', id: 20, nombre: 'Ana' },
      { asignacion_id: 201, rol: 'personal', id: 30, nombre: 'Eva' },
      { asignacion_id: 202, rol: 'responsable', id: 21, nombre: 'Luis' },
    ]]],
    ['FROM vehicle_images vi\n     JOIN asignaciones_libres al', [fotosAsig]],
  ];
}

/** Conexión de transacción que registra lo que ejecuta. */
function conexion({ estados = [], asignaciones = [], insertId = 500 } = {}) {
  const ejecutadas = [];
  const conn = {
    execute: jest.fn(async (sql, params) => {
      ejecutadas.push({ sql, params });
      if (sql.includes('SELECT estado FROM trabajo_vehiculos')) {
        return [estados.map(e => ({ estado: e }))];
      }
      if (sql.includes('FROM asignaciones_libres WHERE trabajo_id')) {
        return [asignaciones.map(e => ({ estado: e, borrada: 0 }))];
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

  // El trabajo como padre (v33): las ambulancias son asignaciones
  describe('vistaParaUsuario con asignaciones (v33)', () => {
    const A = { id: 201, vehicle_id: 7, estado: 'activa', km_inicio: 1000, inicio_real_at: AYER(),
                fecha_inicio: AYER(), progreso_fotos: { inicio: {} }, matricula: '7777AAA', vehiculo_alias: 'UVI-1',
                responsables: [{ id: 20 }], personal: [{ id: 30 }] };
    const B = { id: 202, vehicle_id: 8, estado: 'programada', km_inicio: 2000, inicio_real_at: null,
                fecha_inicio: AYER(), progreso_fotos: { inicio: {} }, matricula: '8888BBB', vehiculo_alias: 'SVB-2',
                responsables: [{ id: 21 }], personal: [] };
    const C = { ...B, id: 203, vehicle_id: 9, estado: 'cancelada', responsables: [{ id: 22 }], personal: [{ id: 31 }] };
    const t = { id: 1, estado: 'activo', coordinador_user_id: 50, usuarios: [], vehiculos: [], evidencias: [],
                asignaciones: [A, B, C] };

    it('el responsable de A ve la suya entera; de B solo cuál es y quién va (decisión 6)', () => {
      const v = vistaParaUsuario(t, resp1);
      expect(v.mi_rol).toBe('responsable');
      const [mia, otra] = v.asignaciones;
      expect(mia).toMatchObject({ id: 201, mi_rol: 'responsable', detalle: true, km_inicio: 1000 });
      // Lista blanca: ni estado, ni km, ni fechas, ni fotos de la ajena
      expect(Object.keys(otra).sort()).toEqual(
        ['detalle', 'id', 'matricula', 'mi_rol', 'personal', 'responsables', 'vehicle_id', 'vehiculo_alias']);
      expect(otra.responsables).toEqual([{ id: 21 }]);
    });

    it('el equipo de A ve A entera, sin poder operarla, y B recortada', () => {
      const v = vistaParaUsuario(t, equipo);
      expect(v.mi_rol).toBe('equipo');
      expect(v.asignaciones[0]).toMatchObject({ mi_rol: 'equipo', detalle: true });
      expect(v.asignaciones[1].detalle).toBe(false);
    });

    it('las canceladas no se le enseñan a quien va en el trabajo, ni dan acceso a quien iba en ellas', () => {
      expect(vistaParaUsuario(t, resp1).asignaciones.map(a => a.id)).toEqual([201, 202]);
      expect(vistaParaUsuario(t, { id: 22, roles: ['tecnico'], permissions: [] })).toBeNull();
    });

    it('el coordinador ve todas con detalle aunque no vaya en ninguna (D2); gestión también', () => {
      const v = vistaParaUsuario(t, coord);
      expect(v.mi_rol).toBe('coordinador');
      expect(v.asignaciones.map(a => a.id)).toEqual([201, 202, 203]);
      expect(v.asignaciones.every(a => a.detalle)).toBe(true);
      expect(vistaParaUsuario(t, admin).asignaciones.every(a => a.detalle)).toBe(true);
    });

    it('nadie más lo ve', () => {
      expect(vistaParaUsuario(t, ajeno)).toBeNull();
      expect(vistaParaUsuario(t, sinRol)).toBeNull();
    });

    it('puede_cerrar: sin ambulancias abiertas y siendo coordinador o gestión (D3)', () => {
      const pendiente = { ...t, estado: 'pendiente_cierre',
        asignaciones: [{ ...A, estado: 'finalizada' }, { ...B, estado: 'finalizada' }, C] };
      expect(vistaParaUsuario(pendiente, coord).puede_cerrar).toBe(true);
      expect(vistaParaUsuario(pendiente, admin).puede_cerrar).toBe(true);
      expect(vistaParaUsuario(pendiente, resp1).puede_cerrar).toBe(false);
      expect(vistaParaUsuario(t, coord).puede_cerrar).toBe(false);
    });

    it('puede_cerrar sin ambulancias: solo una vez empezado (antes, se elimina)', () => {
      const sinAmb = (fecha_inicio) => ({ ...t, estado: 'programado', fecha_inicio, asignaciones: [] });
      expect(vistaParaUsuario(sinAmb(AYER()), coord).puede_cerrar).toBe(true);
      expect(vistaParaUsuario(sinAmb(MANANA()), coord).puede_cerrar).toBe(false);
    });

    it('quien está en el equipo del trabajo, sin ambulancia, lo ve como equipo y las ambulancias recortadas', () => {
      const conEquipo = { ...t, usuarios: [{ user_id: 77 }] };
      const v = vistaParaUsuario(conEquipo, { id: 77, roles: ['tecnico'], permissions: [] });
      expect(v.mi_rol).toBe('equipo');
      expect(v.asignaciones.every(a => !a.detalle)).toBe(true);
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

    it('con asignaciones: cada ambulancia con quién va y el progreso de SUS fotos, y el coordinador', async () => {
      bd(trabajoConAsignaciones({ fotosAsig: fotos('inicio', IMAGEN_TIPOS_INICIO).map(f => ({ ...f, asignacion_id: 201 })) }));
      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());

      const t = res._json.data;
      expect(t.coordinador).toEqual({ id: 50, nombre: 'Carla', apellidos: 'Ruiz' });
      expect(t).not.toHaveProperty('coordinador_nombre');
      const [a, b] = t.asignaciones;
      expect(a.responsables).toEqual([{ id: 20, nombre: 'Ana' }]);
      expect(a.personal).toEqual([{ id: 30, nombre: 'Eva' }]);
      expect(a.progreso_fotos.inicio.completo).toBe(true);
      expect(b.progreso_fotos.inicio.completado).toBe(0);
    });

    it('con asignaciones: el coordinador entra aunque no vaya; un ajeno, no', async () => {
      bd(trabajoConAsignaciones());
      const res = mockRes();
      await getTrabajo(mockReq({ params: { id: '1' }, user: coord }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data.mi_rol).toBe('coordinador');

      const res2 = mockRes();
      await getTrabajo(mockReq({ params: { id: '1' }, user: ajeno }), res2, mockNext());
      expect(res2.status).toHaveBeenCalledWith(403);
    });

    // `v25` decide qué pinta la ficha: la operación del modelo anterior
    // (TrabajoV25) o la del trabajo padre. Misma regla que cerrarTrabajo.
    describe('v25: de qué modelo es el trabajo', () => {
      const v25De = async (reglas) => {
        bd(reglas);
        const res = mockRes();
        await getTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());
        return res._json.data.v25;
      };

      it('con vehículos en trabajo_vehiculos, sí', async () => {
        expect(await v25De(trabajoDosVehiculos({ trabajo: { num_asignaciones: 0 } }))).toBe(true);
      });

      it('sin vehículos, sin coordinador y sin haber tenido asignaciones (el «sin vehículos»), sí', async () => {
        expect(await v25De(trabajoDosVehiculos({ vehiculos: [], trabajo: { num_asignaciones: 0 } }))).toBe(true);
      });

      it('con coordinador, no, aunque aún no lleve ambulancias', async () => {
        expect(await v25De(trabajoConAsignaciones({ asignaciones: [], trabajo: { num_asignaciones: 0 } }))).toBe(false);
      });

      it('sin coordinador pero con asignaciones que tuvo (aunque estén borradas), no', async () => {
        expect(await v25De(trabajoDosVehiculos({ vehiculos: [], trabajo: { num_asignaciones: 1 } }))).toBe(false);
      });

      it('la cuenta de asignaciones no sale en la respuesta', async () => {
        bd(trabajoDosVehiculos({ trabajo: { num_asignaciones: 0 } }));
        const res = mockRes();
        await getTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());
        expect(res._json.data).not.toHaveProperty('num_asignaciones');
      });
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
      bd([['COUNT(*) AS total', [[{ total: 2 }]]], ['AS num_vehiculos', [[{ id: 1 }, { id: 2 }]]]]);
      const res = mockRes();
      await listTrabajos(mockReq({ query: {}, user: admin }), res, mockNext());
      expect(res._json.data).toHaveLength(2);
      expect(query.mock.calls[0][0]).not.toContain('trabajo_vehiculo_responsables');
    });

    it.each([['un técnico', resp1], ['un usuario sin rol', sinRol]])(
      '%s solo ve los suyos: coordina, va en una ambulancia, o equipo/responsable (v25)', async (_n, user) => {
        bd([['COUNT(*) AS total', [[{ total: 0 }]]]]);
        await listTrabajos(mockReq({ query: {}, user }), mockRes(), mockNext());
        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain('t.coordinador_user_id = ?');
        expect(sql).toContain('asignacion_usuarios aup');
        // Una ambulancia cancelada ya no lleva a nadie
        expect(sql).toContain("alp.estado <> 'cancelada'");
        expect(sql).toContain('trabajo_usuarios tu');
        expect(sql).toContain('trabajo_vehiculo_responsables tvr');
        expect(params).toEqual([user.id, user.id, user.id, user.id]);
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

    // Antes era `fecha_inicio DESC` suelto: el más lejano arriba y los de hoy
    // enterrados. Solo se puede mirar el SQL, pero eso basta para que no vuelva.
    it('ordena por fecha: abiertos del más próximo al más lejano, cerrados al final', async () => {
      bd([['COUNT(*) AS total', [[{ total: 0 }]]]]);
      await listTrabajos(mockReq({ query: {}, user: admin }), mockRes(), mockNext());
      const sql = query.mock.calls[1][0].replace(/\s+/g, ' ');
      expect(sql).toContain(
        "ORDER BY CASE WHEN t.estado IN ('finalizado','finalizado_anticipado') THEN 1 ELSE 0 END ASC");
      // Lo que está en curso encabeza los abiertos
      expect(sql).toContain("CASE WHEN t.estado = 'activo' THEN 0 ELSE 1 END ASC");
      expect(sql).toContain(
        "CASE WHEN t.estado IN ('finalizado','finalizado_anticipado') THEN NULL ELSE t.fecha_inicio END ASC");
      // Entre los cerrados, el último cerrado primero; un v25 no tiene cerrado_at
      expect(sql).toContain('COALESCE(t.cerrado_at, t.fecha_fin) DESC');
      // Desempate único, o la paginación repite o pierde filas
      expect(sql).toMatch(/t\.id ASC LIMIT \? OFFSET \?/);
      expect(sql).not.toContain('ORDER BY t.fecha_inicio DESC');
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
      expect(params.slice(2)).toEqual([20, 20, 20, 20]);
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

  describe('miCalendario', () => {
    const AMBULANCIAS = 'JOIN asignacion_usuarios au ON au.asignacion_id = a.id AND au.user_id = ?';
    const SIN_AMBULANCIA = 'AS soy_coordinador';

    it('sus ambulancias con SUS fechas y los trabajos en los que está sin ambulancia, por orden', async () => {
      bd([[AMBULANCIAS, [[
            { trabajo_id: 1, nombre: 'Maratón', asignacion_id: 201, rol: 'responsable', vehiculo: 'UVI-1',
              fecha_inicio: new Date('2026-10-14T08:00:00Z'), fecha_fin: new Date('2026-10-14T14:00:00Z') },
            { trabajo_id: 2, nombre: 'Concierto', asignacion_id: 202, rol: 'personal', vehiculo: 'SVB-2',
              fecha_inicio: new Date('2026-10-03T18:00:00Z'), fecha_fin: new Date('2026-10-03T23:00:00Z') },
          ]]],
          [SIN_AMBULANCIA, [[
            { trabajo_id: 3, nombre: 'Feria', soy_coordinador: 1, en_equipo: 0,
              fecha_inicio: new Date('2026-10-10T08:00:00Z'), fecha_fin: new Date('2026-10-12T20:00:00Z') },
            { trabajo_id: 4, nombre: 'Romería', soy_coordinador: 0, en_equipo: 1,
              fecha_inicio: new Date('2026-10-20T08:00:00Z'), fecha_fin: new Date('2026-10-20T20:00:00Z') },
            { trabajo_id: 5, nombre: 'Antiguo', soy_coordinador: 0, en_equipo: 0,
              fecha_inicio: new Date('2026-10-25T08:00:00Z'), fecha_fin: new Date('2026-10-25T20:00:00Z') },
          ]]]]);
      const res = mockRes();
      await miCalendario(mockReq({ query: { year: '2026', month: '10' }, user: resp1 }), res, mockNext());

      const entradas = res._json.data;
      expect(entradas.map(e => [e.trabajo_id, e.mi_papel])).toEqual([
        [2, 'equipo'], [3, 'coordinador'], [1, 'responsable'], [4, 'equipo_trabajo'], [5, 'v25'],
      ]);
      expect(entradas[0]).toMatchObject({ asignacion_id: 202, vehiculo: 'SVB-2' });
      expect(entradas[0]).not.toHaveProperty('rol');
      expect(entradas[1]).toMatchObject({ asignacion_id: null, asignacion_estado: null, vehiculo: null });
      expect(entradas[1]).not.toHaveProperty('soy_coordinador');
    });

    it('siempre lo suyo, también a quien ve todo, y lo ya cerrado también', async () => {
      bd([]);
      await miCalendario(mockReq({ query: { year: '2026', month: '10' }, user: admin }), mockRes(), mockNext());
      const [[sqlAmb, paramsAmb], [sqlSin, paramsSin]] = query.mock.calls;
      expect(paramsAmb[0]).toBe(1);
      expect(sqlSin).toContain('trabajo_vehiculo_responsables');
      expect(paramsSin).toEqual([1, 1, expect.any(Date), expect.any(Date), 1, 1, 1, 1, 1]);
      expect(sqlAmb + sqlSin).not.toContain("t.estado IN");
      // Una ambulancia cancelada ya no lleva a nadie
      expect(sqlAmb).toContain("a.estado <> 'cancelada'");
    });

    it('acota el mes por la medianoche española y deja fuera lo que acaba justo al empezar', async () => {
      bd([]);
      await miCalendario(mockReq({ query: { year: '2026', month: '12' }, user: resp1 }), mockRes(), mockNext());
      const [sql, [, hasta, desde]] = query.mock.calls[0];
      expect(desde.toISOString()).toBe('2026-11-30T23:00:00.000Z');
      expect(hasta.toISOString()).toBe('2026-12-31T23:00:00.000Z');
      expect(sql).toContain('a.fecha_fin > ?');
    });
  });

  describe('misTrab', () => {
    it('una tarjeta por trabajo abierto (también pendiente de cierre, D11) con «tu ambulancia»', async () => {
      bd([['COUNT(*) AS total', [[{ total: 2 }]]],
          ['vehiculos_resumen', [[{ id: 1, nombre: 'Maratón', soy_coordinador: 0 },
                                  { id: 2, nombre: 'Concierto', soy_coordinador: 1 }]]],
          ['JOIN asignacion_usuarios au ON au.asignacion_id = a.id AND au.user_id = ?', [[
            { trabajo_id: 1, id: 201, estado: 'finalizada', rol: 'responsable', vehiculo_alias: 'UVI-1' },
            { trabajo_id: 1, id: 202, estado: 'activa', rol: 'personal', vehiculo_alias: 'SVB-2' },
          ]]]]);
      const res = mockRes();
      await misTrab(mockReq({ query: {}, user: resp1 }), res, mockNext());

      const [maraton, concierto] = res._json.data;
      // Va en dos: manda la que lleva como responsable, aunque ya esté finalizada
      expect(maraton.mi_asignacion).toMatchObject({ id: 201, estado: 'finalizada', mi_rol: 'responsable' });
      expect(maraton.mi_asignacion).not.toHaveProperty('trabajo_id');
      expect(maraton.soy_coordinador).toBe(false);
      // Solo lo coordina: tarjeta sin ambulancia propia
      expect(concierto).toMatchObject({ soy_coordinador: true, mi_asignacion: null });

      const [sql, params] = query.mock.calls[1];
      expect(sql).toContain("t.estado IN ('programado', 'activo', 'pendiente_cierre')");
      expect(params).toEqual([20, 20, 20, 20, 20, 20, 20, 20, 0]);
      // Modelo v25: los vehículos que lleva y no ha cerrado
      expect(sql).toContain('AS mis_vehiculos_v25');
      const [, paramsMias] = query.mock.calls[2];
      expect(paramsMias).toEqual([20, 1, 2]);
    });

    it('el equipo sale como «equipo», con los nombres de quien la lleva', async () => {
      bd([['COUNT(*) AS total', [[{ total: 1 }]]],
          ['vehiculos_resumen', [[{ id: 1 }]]],
          ['JOIN asignacion_usuarios au ON au.asignacion_id = a.id AND au.user_id = ?', [[
            { trabajo_id: 1, id: 201, rol: 'personal', responsables_nombres: 'Ana García' },
          ]]]]);
      const res = mockRes();
      await misTrab(mockReq({ query: {}, user: equipo }), res, mockNext());
      expect(res._json.data[0].mi_asignacion).toMatchObject({ mi_rol: 'equipo', responsables_nombres: 'Ana García' });
    });

    it('sin trabajos no pregunta por ambulancias', async () => {
      bd([['COUNT(*) AS total', [[{ total: 0 }]]]]);
      await misTrab(mockReq({ query: {}, user: resp1 }), mockRes(), mockNext());
      expect(query).toHaveBeenCalledTimes(2);
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
  // D6: el trabajo nace con su primera ambulancia, que es una asignación.
  describe('leerAmbulancias', () => {
    const TRAB = { fecha_inicio: '2026-10-15 08:00:00', fecha_fin: '2026-10-15 20:00:00' };
    it('ninguna vale: el trabajo puede nacer sin ambulancias (2026-10-10)', () => {
      expect(leerAmbulancias(undefined, TRAB)).toEqual({ ambulancias: [] });
      expect(leerAmbulancias([], TRAB)).toEqual({ ambulancias: [] });
    });

    it('por defecto, las fechas del trabajo; el equipo va como personal', () => {
      const { ambulancias } = leerAmbulancias([{ vehicle_id: '7', responsables: [20], personal: [30], notas: '  ' }], TRAB);
      expect(ambulancias).toEqual([{ vehicle_id: 7, responsables: [20], personal: [30],
        fecha_inicio: TRAB.fecha_inicio, fecha_fin: TRAB.fecha_fin, km_inicio: null, notas: null }]);
    });
    it.each([
      ['no es lista', 'x', 'debe ser una lista'],
      ['sin vehículo', [{ responsables: [1] }], 'vehicle_id'],
      ['sin responsable', [{ vehicle_id: 7 }], 'al menos un responsable'],
      ['persona repetida', [{ vehicle_id: 7, responsables: [2], personal: [2] }], 'dos veces'],
      ['ambulancia repetida (D5)', [{ vehicle_id: 7, responsables: [2] }, { vehicle_id: 7, responsables: [3] }], 'misma ambulancia'],
      ['fechas al revés', [{ vehicle_id: 7, responsables: [2], fecha_inicio: '2026-10-15 21:00:00' }], 'posterior'],
    ])('rechaza: %s', (_n, lista, msg) => {
      expect(leerAmbulancias(lista, TRAB).error).toContain(msg);
    });
  });

  describe('createTrabajo', () => {
    const body = (extra = {}) => ({
      nombre: 'Maratón', tipo: 'cobertura_evento',
      descripcion: '  Cobertura  ', ubicacion: '',
      fecha_inicio: '2026-10-15 08:00:00', fecha_fin: '2026-10-15 20:00:00',
      coordinador_user_id: 50,
      asignaciones: [{ vehicle_id: 7, responsables: [20, 21], personal: [30], km_inicio: 1200 }],
      ...extra,
    });
    const reglasOk = (extra = []) => [
      ...extra,
      ['SELECT id FROM vehicles WHERE id IN', (params) => [params.map(id => ({ id }))]],
      ['FROM users', (params) => [params.map(id => ({ id }))]],
      ['trabajo_coordinador_apellidos', [[{ id: 11, user_id: 20, vehicle_id: 7, trabajo_id: 10 }]]],
      ...trabajoDosVehiculos({ vehiculos: [] }),
    ];

    it('crea el trabajo con su coordinador y la primera ambulancia como asignación, en una transacción', async () => {
      bd(reglasOk());
      const { ejecutadas } = conexion({ insertId: 10, asignaciones: ['programada'] });

      const res = mockRes();
      await createTrabajo(mockReq({ body: body(), user: admin }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(201);
      const insTrab = ejecutadas.find(e => e.sql.includes('INSERT INTO trabajos'));
      // descripción recortada, ubicación en blanco → NULL; el coordinador, el 8.º
      expect(insTrab.params.slice(1, 4)).toEqual(['Maratón', 'Cobertura', null]);
      expect(insTrab.params[7]).toBe(50);

      const insAsig = ejecutadas.find(e => e.sql.includes('INSERT INTO asignaciones_libres'));
      // vehículo, principal = primer responsable, …, trabajo_id el último
      expect(insAsig.params[0]).toBe(7);
      expect(insAsig.params[1]).toBe(20);
      expect(insAsig.params[insAsig.params.length - 1]).toBe(10);
      const miembros = ejecutadas.find(e => e.sql.includes('INSERT INTO asignacion_usuarios'));
      expect(miembros.params).toEqual([11, 20, 'responsable', 0, 11, 21, 'responsable', 1, 11, 30, 'personal', 0]);
      expect(ejecutadas.find(e => e.sql.includes('UPDATE trabajos SET estado')).params[0]).toBe('programado');
      // Nada del modelo v25
      expect(ejecutadas.some(e => e.sql.includes('trabajo_vehiculos (') || e.sql.includes('trabajo_usuarios'))).toBe(false);

      expect(avisos.avisarAsignacionNueva).toHaveBeenCalledWith(
        expect.objectContaining({ id: 11 }), [20, 21, 30], { asignadoPor: 1 });
      expect(res._json.data.avisos_alta).toEqual([expect.objectContaining({
        asignacion_id: 11, vehicle_id: 7, solapes: [], vehiculo_ocupado: [], fuera_del_trabajo: false,
      })]);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'create_trabajo', details: expect.objectContaining({ coordinador_user_id: 50, ambulancias: 1 }),
      }));
    });

    it('sin ambulancias y con su equipo: se crea, y al equipo le llega «nuevo trabajo»', async () => {
      bd(reglasOk());
      const { ejecutadas } = conexion({ insertId: 10 });
      const res = mockRes();
      await createTrabajo(mockReq({ body: body({ asignaciones: undefined, usuarios: [20, 30, 30] }), user: admin }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(ejecutadas.some(e => e.sql.includes('INSERT INTO asignaciones_libres'))).toBe(false);
      const equipo = ejecutadas.filter(e => e.sql.includes('INSERT IGNORE INTO trabajo_usuarios'));
      expect(equipo.map(e => e.params)).toEqual([[10, 20], [10, 30]]);
      // Sin ambulancia que consultar, ni la consulta de vehículos (IN () es SQL inválido)
      expect(query.mock.calls.some(([sql]) => sql.includes('FROM vehicles WHERE id IN'))).toBe(false);
      expect(avisos.avisarEquipoTrabajo).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), [20, 30], { asignadoPor: 1 });
      expect(res._json.data.avisos_alta).toEqual([]);
    });

    it('a quien va en una ambulancia no le llega además «nuevo trabajo»', async () => {
      bd(reglasOk());
      conexion({ insertId: 10 });
      await createTrabajo(mockReq({ body: body({ usuarios: [20, 40] }), user: admin }), mockRes(), mockNext());
      expect(avisos.avisarEquipoTrabajo.mock.calls[0][1]).toEqual([40]);
    });

    it('al coordinador le llega el suyo, y no además «nuevo trabajo» si está en el equipo', async () => {
      bd(reglasOk());
      conexion({ insertId: 10 });
      await createTrabajo(mockReq({ body: body({ usuarios: [50, 40] }), user: admin }), mockRes(), mockNext());
      expect(avisos.avisarCoordinadorTrabajo).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 50, { asignadoPor: 1 });
      expect(avisos.avisarEquipoTrabajo.mock.calls[0][1]).toEqual([40]);
    });

    it('400 con el formato del formulario anterior (vehiculos)', async () => {
      const res = mockRes();
      await createTrabajo(mockReq({ body: body({ vehiculos: [], usuarios: [] }), user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('recárgala');
    });

    it('400 si las fechas van al revés', async () => {
      const res = mockRes();
      await createTrabajo(mockReq({ body: body({ fecha_fin: '2026-10-14 08:00:00' }), user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('400 si una ambulancia no lleva responsable', async () => {
      const res = mockRes();
      await createTrabajo(mockReq({ body: body({ asignaciones: [{ vehicle_id: 7 }] }), user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('al menos un responsable');
    });

    it('404 si una ambulancia no existe', async () => {
      bd([['SELECT id FROM vehicles WHERE id IN', [[]]]]);
      const res = mockRes();
      await createTrabajo(mockReq({ body: body(), user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('400 si alguien (también el coordinador) no existe o está de baja', async () => {
      bd([['SELECT id FROM vehicles WHERE id IN', [[{ id: 7 }]]], ['FROM users', [[{ id: 20 }, { id: 21 }, { id: 30 }]]]]);
      const res = mockRes();
      await createTrabajo(mockReq({ body: body(), user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('50');
    });

    it('fechas de la ambulancia fuera de las del trabajo: se crea, con aviso (D4)', async () => {
      bd(reglasOk());
      conexion({ insertId: 10 });
      const res = mockRes();
      await createTrabajo(mockReq({ body: body({ asignaciones: [
        { vehicle_id: 7, responsables: [20], fecha_inicio: '2026-10-15 06:30:00' },
      ] }), user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res._json.data.avisos_alta[0].fuera_del_trabajo).toBe(true);
    });

    it('continúa la numeración del año', async () => {
      bd(reglasOk([['identificador LIKE', [[{ identificador: 'TRB-2026-0041' }]]]]));
      const { ejecutadas } = conexion();
      await createTrabajo(mockReq({ body: body(), user: admin }), mockRes(), mockNext());
      const insTrab = ejecutadas.find(e => e.sql.includes('INSERT INTO trabajos'));
      expect(insTrab.params[0]).toMatch(/-0042$/);
    });
  });

  // ── PUT /trabajos/:id ──────────────────────────────────────
  describe('updateTrabajo', () => {
    const existente = (estado = 'programado', extra = {}) =>
      ['AS num_asignaciones',
       [[{ id: 1, estado, fecha_inicio: new Date('2026-10-15T08:00:00Z'),
           fecha_fin: new Date('2026-10-15T20:00:00Z'), coordinador_user_id: null,
           num_asignaciones: 0, ...extra }]]];
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

    it('cambia el coordinador, comprobando que existe y está activo', async () => {
      bd([existente('activo', { coordinador_user_id: 50, num_asignaciones: 2 }), usuariosOk, ...trabajoDosVehiculos()]);
      const { ejecutadas } = conexion();
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: { coordinador_user_id: 51 }, user: admin }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      const upd = ejecutadas.find(e => e.sql.startsWith('UPDATE trabajos SET'));
      expect(upd.sql).toContain('coordinador_user_id = ?');
      expect(upd.params).toEqual([51, 1]);
      expect(query.mock.calls.some(([sql, params]) => sql.includes('FROM users') && params.includes(51))).toBe(true);
      expect(avisos.avisarCoordinadorTrabajo).toHaveBeenCalledWith(expect.anything(), 51, { asignadoPor: 1 });
    });

    it('mandar el mismo coordinador que ya tenía no le avisa otra vez', async () => {
      bd([existente('activo', { coordinador_user_id: 50, num_asignaciones: 2 }), usuariosOk, ...trabajoDosVehiculos()]);
      conexion();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: { coordinador_user_id: 50, nombre: 'X' }, user: admin }),
        mockRes(), mockNext());
      expect(avisos.avisarCoordinadorTrabajo).not.toHaveBeenCalled();
    });

    it('el coordinador nuevo que entra a la vez en el equipo recibe solo el suyo', async () => {
      bd([existente('activo', { coordinador_user_id: 50, num_asignaciones: 2 }),
          ['UNION', [[]]], usuariosOk, ...trabajoDosVehiculos()]);
      conexion();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: { coordinador_user_id: 51, usuarios: [51, 31] }, user: admin }),
        mockRes(), mockNext());
      expect(avisos.avisarCoordinadorTrabajo).toHaveBeenCalledWith(expect.anything(), 51, { asignadoPor: 1 });
      expect(avisos.avisarEquipoTrabajo).toHaveBeenCalledWith(expect.anything(), [31], { asignadoPor: 1 });
    });

    it('un coordinador nuevo de baja → 400', async () => {
      bd([existente('activo', { coordinador_user_id: 50 }), ['FROM users', [[]]]]);
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: { coordinador_user_id: 51 }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it.each([
      ['con asignaciones', { num_asignaciones: 2 }],
      ['con coordinador y sin ambulancias', { coordinador_user_id: 50 }],
    ])('del modelo nuevo (%s) no acepta vehiculos del v25', async (_n, extra) => {
      bd([existente('activo', extra)]);
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: { vehiculos: [] }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('el equipo del trabajo se cambia, y solo avisa a quien entra', async () => {
      bd([existente('activo', { coordinador_user_id: 50, num_asignaciones: 2 }),
          ['UNION', [[{ user_id: 30 }]]], usuariosOk, ...trabajoDosVehiculos()]);
      const { ejecutadas } = conexion();
      const res = mockRes();
      await updateTrabajo(mockReq({ params: { id: '1' }, body: { usuarios: [30, 31] }, user: admin }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(ejecutadas.some(e => e.sql.includes('DELETE FROM trabajo_usuarios'))).toBe(true);
      expect(avisos.avisarEquipoTrabajo).toHaveBeenCalledWith(expect.anything(), [31], { asignadoPor: 1 });
    });
  });

  // ── DELETE /trabajos/:id ───────────────────────────────────
  describe('deleteTrabajo', () => {
    it('borrado lógico', async () => {
      bd([['SELECT id, estado FROM trabajos', [[{ id: 1, estado: 'programado' }]]]]);
      const { ejecutadas } = conexion();
      const res = mockRes();
      await deleteTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(ejecutadas[0].sql).toContain('UPDATE trabajos SET deleted_at');
      expect(ejecutadas).toHaveLength(1);
    });

    it('con ambulancias sin empezar: se borran con él', async () => {
      bd([['SELECT id, estado FROM trabajos', [[{ id: 1, estado: 'programado' }]]],
          ['SELECT estado FROM asignaciones_libres', [[{ estado: 'programada' }, { estado: 'cancelada' }]]]]);
      const { ejecutadas } = conexion();
      const res = mockRes();
      await deleteTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      const asigs = ejecutadas.find(e => e.sql.includes('UPDATE asignaciones_libres SET deleted_at'));
      expect(asigs.sql).toContain('WHERE trabajo_id = ? AND deleted_at IS NULL');
      expect(asigs.params[1]).toBe(1);
    });

    it.each(['activa', 'finalizada'])('400 si alguna ambulancia está %s: es evidencia del servicio', async (estado) => {
      bd([['SELECT id, estado FROM trabajos', [[{ id: 1, estado: 'pendiente_cierre' }]]],
          ['SELECT estado FROM asignaciones_libres', [[{ estado }]]]]);
      const res = mockRes();
      await deleteTrabajo(mockReq({ params: { id: '1' }, user: admin }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(transaction).not.toHaveBeenCalled();
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

  // ── POST /trabajos/:id/cerrar (D3) ─────────────────────────
  describe('cerrarTrabajo', () => {
    const fila = (extra = {}) => ['AS num_vehiculos_v25',
      [[{ id: 1, identificador: 'TRB-2026-0002', nombre: 'Maratón', estado: 'pendiente_cierre',
          fecha_inicio: AYER(), coordinador_user_id: 50, num_vehiculos_v25: 0, num_asignaciones: 2, ...extra }]]];
    const estados = (...lista) => ['SELECT estado FROM asignaciones_libres', [lista.map(estado => ({ estado }))]];
    const cerrado = ['SET estado = ?, cerrado_at', [{ affectedRows: 1 }]];
    const cerrar = async (user) => {
      const res = mockRes();
      await cerrarTrabajo(mockReq({ params: { id: '1' }, user }), res, mockNext());
      return res;
    };

    it('el coordinador lo cierra con todas sus ambulancias finalizadas: sella quién y cuándo, y audita', async () => {
      bd([fila(), estados('finalizada', 'cancelada'), cerrado, ...trabajoConAsignaciones({ trabajo: { estado: 'finalizado' } })]);
      const res = await cerrar(coord);

      expect(res.status).toHaveBeenCalledWith(200);
      const [sql, params] = query.mock.calls.find(([q]) => q.includes('SET estado = ?, cerrado_at'));
      expect(sql).toContain("estado NOT IN ('finalizado', 'finalizado_anticipado')");
      expect(params[0]).toBe('finalizado');
      expect(params[1]).toBeInstanceOf(Date);
      expect(params.slice(2)).toEqual([50, 1, 1]);
      // El WHERE repite «ninguna ambulancia abierta»
      expect(sql).toContain("a.estado IN ('programada', 'activa')");
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'close_trabajo', details: expect.objectContaining({ por_gestion: false }),
      }));
    });

    it('gestión también puede (y queda dicho en la auditoría)', async () => {
      bd([fila(), estados('finalizada'), cerrado, ...trabajoConAsignaciones()]);
      expect((await cerrar(admin)).status).toHaveBeenCalledWith(200);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        details: expect.objectContaining({ por_gestion: true }),
      }));
    });

    it('403 a quien no lo coordina, aunque vaya en una ambulancia', async () => {
      bd([fila(), estados('finalizada')]);
      expect((await cerrar(resp1)).status).toHaveBeenCalledWith(403);
    });

    it('400 con ambulancias sin finalizar, aunque el estado guardado diga otra cosa', async () => {
      bd([fila(), estados('finalizada', 'activa')]);
      const res = await cerrar(coord);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('queda 1 ambulancia');
      expect(query.mock.calls.some(([q]) => q.includes('cerrado_at'))).toBe(false);
    });

    it('400 si ya está cerrado; 400 si es del modelo anterior; 404 si no existe', async () => {
      bd([fila({ estado: 'finalizado' }), estados('finalizada')]);
      expect((await cerrar(coord)).status).toHaveBeenCalledWith(400);

      bd([fila({ estado: 'activo', num_vehiculos_v25: 2 }), estados()]);
      expect((await cerrar(coord)).status).toHaveBeenCalledWith(400);

      bd([]);
      expect((await cerrar(coord)).status).toHaveBeenCalledWith(404);
    });

    it('sin ambulancias: se cierra si ya ha empezado; si no, hay que eliminarlo', async () => {
      bd([fila({ estado: 'programado' }), estados('cancelada'), cerrado, ...trabajoConAsignaciones()]);
      expect((await cerrar(coord)).status).toHaveBeenCalledWith(200);

      bd([fila({ estado: 'programado', fecha_inicio: MANANA() }), estados()]);
      const res = await cerrar(coord);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('elimínalo');
    });

    it('si dos lo cierran a la vez, solo uno deja rastro', async () => {
      bd([fila(), estados('finalizada'), ['SET estado = ?, cerrado_at', [{ affectedRows: 0 }]],
          ['SELECT estado FROM trabajos WHERE id = ?', [[{ estado: 'finalizado' }]]], ...trabajoConAsignaciones()]);
      expect((await cerrar(coord)).status).toHaveBeenCalledWith(200);
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('si entra una ambulancia entre la comprobación y el cierre, no lo cierra y lo dice (409)', async () => {
      bd([fila(), estados('finalizada'), ['SET estado = ?, cerrado_at', [{ affectedRows: 0 }]],
          ['SELECT estado FROM trabajos WHERE id = ?', [[{ estado: 'activo' }]]]]);
      const res = await cerrar(coord);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('un trabajo v25 sin vehículos ni coordinador no se cierra por aquí (se saltaría el motivo)', async () => {
      bd([fila({ estado: 'activo', coordinador_user_id: null, num_asignaciones: 0 }), estados()]);
      const res = await cerrar(admin);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('modelo anterior');
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
      expect(sinc.params).toEqual(['activo', 1, 'activo']);
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

    it('400 si es anticipado y el motivo es una letra repetida', async () => {
      bd([filaVehiculo({ fecha_fin: MANANA() }), esResponsable()]);
      const res = mockRes();
      await finalizeVehiculo(reqVeh(resp1, { kilometros_fin: 1200, motivo_finalizacion_anticipada: 'aaaaa' }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toMatch(/motivo válido/);
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
      expect(sinc.params).toEqual(['activo', 1, 'activo']);
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

      bd([trabajo({ estado: 'activo', fecha_fin: MANANA() })]);
      const resCorto = mockRes();
      await finalizeTrabajo(mockReq({ params: { id: '1' }, body: { motivo_finalizacion_anticipada: ' No ' }, user: admin }),
        resCorto, mockNext());
      expect(resCorto.status).toHaveBeenCalledWith(400);
      expect(resCorto._json.message).toMatch(/al menos 5/);

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
      ['createTrabajo',          () => createTrabajo(mockReq({ body: { nombre: 'T', tipo: 'otro', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-02', coordinador_user_id: 5, asignaciones: [{ vehicle_id: 7, responsables: [3] }] }, user: admin }), mockRes(), next)],
      ['cerrarTrabajo',          () => cerrarTrabajo(mockReq({ params: { id: '1' }, user: admin }), mockRes(), next)],
      ['updateTrabajo',          () => updateTrabajo(mockReq({ params: { id: '1' }, body: { nombre: 'T' }, user: admin }), mockRes(), next)],
      ['deleteTrabajo',          () => deleteTrabajo(mockReq({ params: { id: '1' }, user: admin }), mockRes(), next)],
      ['activarVehiculo',        () => activarVehiculo(reqVeh(admin), mockRes(), next)],
      ['finalizeVehiculo',       () => finalizeVehiculo(reqVeh(admin, { kilometros_fin: 1 }), mockRes(), next)],
      ['activarTrabajo',         () => activarTrabajo(mockReq({ params: { id: '1' }, user: admin }), mockRes(), next)],
      ['finalizeTrabajo',        () => finalizeTrabajo(mockReq({ params: { id: '1' }, body: {}, user: admin }), mockRes(), next)],
      ['uploadEvidencia',        () => uploadEvidencia(mockReq({ params: { id: '1' }, body: { vehicle_id: '7', tipo_imagen: 'frontal', momento: 'fin' }, user: admin }), mockRes(), next)],
      ['misTrab',                () => misTrab(mockReq({ query: {}, user: admin }), mockRes(), next)],
      ['miCalendario',           () => miCalendario(mockReq({ query: {}, user: resp1 }), mockRes(), next)],
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

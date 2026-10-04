'use strict';

/**
 * Autorización de TODAS las rutas de la API, recorridas de verdad.
 *
 * Monta el router real (routes/index.js) con la BD simulada y llama a cada
 * ruta como dos usuarios sin ningún permiso: uno SIN ROL (la mayoría de la
 * plantilla) y un técnico. Cada ruta tiene que estar en ACCESO, con una de
 * estas clases:
 *
 *   denegada    — 403 para los dos. Lo decide un middleware de la ruta.
 *   propia      — abierta, pero el listado se filtra por el usuario: se exige
 *                 que TODAS las consultas de datos lleven su id. Así se habría
 *                 pillado SEC-10 (/vehicles devolvía la flota entera a un
 *                 usuario sin rol).
 *   controlador — la autorización depende del objeto concreto (¿es mío este
 *                 servicio?) y la decide el controlador tras cargarlo. Con la
 *                 BD vacía no se puede probar aquí: la cubren los tests
 *                 unitarios del sitio que se cita.
 *   abierta     — a propósito, para cualquier sesión (o pública); con motivo.
 *
 * Una ruta nueva sin clasificar hace fallar el test: obliga a decidir quién
 * puede usarla ANTES de que llegue a producción.
 *
 * Escalones (2026-10-04): las `denegada` tienen además un rol mínimo en NIVEL
 * (por defecto `gestion`: gestor o más). Se prueba en los dos sentidos: el
 * escalón de abajo recibe 403 y el que debe entrar NO recibe 403. Lo segundo
 * es lo que pilla una ruta mal clasificada, que si no pasaría en silencio.
 * Y un token de «Ver como» nunca abre lo del superadmin.
 */

const express = require('express');
const request = require('supertest');
const { query, transaction } = require('../../config/database');
const { generateAccessToken, generateImpersonationToken } = require('../../utils/jwt.utils');
const router = require('../../routes');

const ACCESO = {
  // ── Públicas / cualquier sesión ─────────────────────────────
  'POST /csp-report':            ['abierta', 'la manda el navegador, sin token'],
  'POST /auth/login':            ['abierta', 'pública'],
  'POST /auth/refresh':          ['abierta', 'pública (va con el refresh token)'],
  'POST /auth/logout':           ['abierta', 'cierra la sesión propia'],
  'GET /auth/me':                ['abierta', 'los datos propios'],
  'POST /auth/impersonacion/fin': ['abierta', 'sin impersonación activa responde 400; solo audita'],
  'GET /':                       ['abierta', 'nombre y versión de la API'],
  'GET /features/active':        ['abierta', 'flags para pintar el menú'],
  'GET /push/vapid-public-key':  ['abierta', 'clave pública'],
  'POST /push/estado':           ['abierta', 'solo las suscripciones propias'],
  'GET /push/estado':            ['abierta', 'obsoleta, igual que el POST'],
  'POST /push/subscribe':        ['abierta', 'da de alta el dispositivo propio'],
  'DELETE /push/subscribe':      ['abierta', 'solo borra si es suya'],
  'POST /push/test':             ['abierta', 'aviso a uno mismo'],
  'POST /errores-cliente':       ['abierta', 'con sesión: errores que vio la app, atribuidos a quien los manda'],

  // ── Listados filtrados por usuario ──────────────────────────
  'GET /vehicles/':              ['propia'],
  'GET /trabajos/':              ['propia'],
  'GET /trabajos/mis-trabajos':  ['propia'],
  'GET /trabajos/calendario':    ['propia'],
  'GET /asignaciones/':          ['propia'],

  // ── Por objeto, en el controlador o en ownership ────────────
  'GET /trabajos/:id':                                ['controlador', 'trabajos.controller (vistaParaUsuario)'],
  'POST /trabajos/:id/vehiculos/:vehicleId/activar':  ['controlador', 'trabajos.controller (responsable del vehículo)'],
  'POST /trabajos/:id/vehiculos/:vehicleId/finalize': ['controlador', 'trabajos.controller (responsable del vehículo)'],
  'POST /trabajos/:id/evidencias':                    ['controlador', 'ownership.requireTrabajoEvidenciaAccess'],
  'GET /asignaciones/:id':                            ['controlador', 'asignaciones.controller (rolEnAsignacion)'],
  'POST /asignaciones/:id/activar':                   ['controlador', 'asignaciones.controller (rolEnAsignacion)'],
  'POST /asignaciones/:id/llegada':                   ['controlador', 'asignaciones.controller (rolEnAsignacion)'],
  'POST /asignaciones/:id/fin-servicio':              ['controlador', 'asignaciones.controller (rolEnAsignacion)'],
  'POST /asignaciones/:id/finalizar':                 ['controlador', 'asignaciones.controller (rolEnAsignacion)'],
  'POST /asignaciones/:id/incidencias':               ['controlador', 'asignaciones.controller (responsable o MANAGE_INCIDENCIAS)'],
  'POST /asignaciones/:id/evidencias':                ['controlador', 'ownership.requireAsignacionEvidenciaAccess'],
  'POST /vehicles/:id/images':                        ['controlador', 'ownership.requireVehicleUploadAccess + vehicles.controller (SEC-11)'],
  'POST /vehicles/:vehicleId/incidencias/:incId/comentarios':
                                                      ['controlador', 'vehicles.controller (autor, responsable o MANAGE_INCIDENCIAS)'],

  // ── Denegadas a quien no tiene permisos ─────────────────────
  'GET /users/roles':                  ['denegada'],
  'POST /users/roles':                 ['denegada'],
  'GET /users/':                       ['denegada'],
  'GET /users/:id':                    ['denegada'],
  'POST /users/':                      ['denegada'],
  'PUT /users/:id':                    ['denegada'],
  'POST /users/:id/reset-password':    ['denegada'],
  'DELETE /users/:id':                 ['denegada'],
  'GET /vehicles/tarjeta-transporte/proximas': ['denegada'],
  'GET /vehicles/alertas':             ['denegada'],
  'GET /vehicles/:id':                 ['denegada'],
  'GET /vehicles/:id/images':          ['denegada'],
  'GET /vehicles/:id/historial':       ['denegada'],
  'POST /vehicles/':                   ['denegada'],
  'PUT /vehicles/:id':                 ['denegada'],
  'DELETE /vehicles/:id':              ['denegada'],
  'GET /vehicles/:id/incidencias':     ['denegada'],
  'POST /vehicles/:id/incidencias':    ['denegada'],
  'PATCH /vehicles/:vehicleId/incidencias/:incId':   ['denegada'],
  'GET /vehicles/:id/revisiones':      ['denegada'],
  'POST /vehicles/:id/revisiones':     ['denegada'],
  'PUT /vehicles/:vehicleId/revisiones/:revId':      ['denegada'],
  'DELETE /vehicles/:vehicleId/revisiones/:revId':   ['denegada'],
  'POST /trabajos/':                   ['denegada'],
  'PUT /trabajos/:id':                 ['denegada'],
  'DELETE /trabajos/:id':              ['denegada'],
  'POST /trabajos/:id/activar':        ['denegada'],
  'POST /trabajos/:id/finalize':       ['denegada'],
  'GET /asignaciones/alarmas':         ['denegada'],
  'POST /asignaciones/':               ['denegada'],
  'PUT /asignaciones/:id':             ['denegada'],
  'DELETE /asignaciones/:id':          ['denegada'],
  'GET /admin/stats':                  ['denegada'],
  'GET /admin/audit/users':            ['denegada'],
  'GET /admin/audit':                  ['denegada'],
  'GET /admin/errors':                 ['denegada'],
  'POST /admin/impersonar/:id':        ['denegada'],
  'GET /admin/backups':                ['denegada'],
  'POST /admin/backups/:nombre/descarga': ['denegada'],
  'GET /features/':                    ['denegada'],
  'PUT /features/:key':                ['denegada'],
  'GET /flota/ubicaciones':            ['denegada'],
  'GET /informes/mensual':             ['denegada'],
  'GET /facturas/':                    ['denegada'],
  'POST /facturas/':                   ['denegada'],
  'GET /facturas/:id/descarga':        ['denegada'],
  'DELETE /facturas/:id':              ['denegada'],
};

// Rol mínimo de las rutas `denegada` que no son de gestión (gestor o más).
const NIVEL = {
  'GET /admin/stats':                      'superadmin',
  'GET /admin/audit/users':                'superadmin',
  'GET /admin/audit':                      'superadmin',
  'GET /admin/errors':                     'superadmin',
  'POST /admin/impersonar/:id':            'superadmin',
  'GET /admin/backups':                    'superadmin',
  'POST /admin/backups/:nombre/descarga':  'superadmin',
  'GET /features/':                        'superadmin',
  'PUT /features/:key':                    'superadmin',
  'POST /users/roles':                     'administrador',
  'POST /users/:id/reset-password':        'administrador',
  'DELETE /users/:id':                     'administrador',
  'GET /vehicles/alertas':                 'administrador',
  'DELETE /vehicles/:id':                  'administrador',
  'DELETE /vehicles/:vehicleId/revisiones/:revId': 'administrador',
  'GET /informes/mensual':                 'administrador',
  'GET /facturas/':                        'administrador',
  'POST /facturas/':                       'administrador',
  'GET /facturas/:id/descarga':            'administrador',
  'DELETE /facturas/:id':                  'administrador',
  'GET /flota/ubicaciones':                'administrador',   // y con menu_flota encendido
};
const nivelDe = (ruta) => NIVEL[ruta] || 'gestion';

// Permisos de gestión que dan v4 a administrador y gestor
const PERMISOS_GESTION = ['manage_vehicles', 'manage_users', 'manage_trabajos', 'view_all_trabajos', 'manage_incidencias'];

const USUARIO_ID = 900;
const BARRA_INVERTIDA = String.fromCharCode(92);

/**
 * Prefijo de un router montado con router.use('/x', …) en Express 4: su
 * regexp.source es «^\/x\/?(?=\/|$)»; se corta entre la primera '/' y la
 * barra invertida que la sigue.
 */
function prefijoDe(capa) {
  const src = capa.regexp.source;
  const ini = src.indexOf('/') + 1;
  return '/' + src.slice(ini, src.indexOf(BARRA_INVERTIDA, ini));
}

function listarRutas(r, prefijo = '') {
  const out = [];
  for (const capa of r.stack) {
    if (capa.route) {
      for (const m of Object.keys(capa.route.methods)) out.push(`${m.toUpperCase()} ${prefijo}${capa.route.path}`);
    } else if (capa.name === 'router' && capa.handle.stack) {
      out.push(...listarRutas(capa.handle, prefijo + prefijoDe(capa)));
    }
  }
  return out;
}

const app = express();
app.use(express.json());
app.use('/api/v1', router);
const RUTAS = listarRutas(router);
const TOKEN = generateAccessToken({ id: USUARIO_ID, username: 'prueba', roles: [] });
const ES_CONSULTA_DE_SESION = /GROUP_CONCAT[\s\S]*FROM users u|FROM role_permissions rp/;

let rolesActuales = '';
let permisosActuales = [];
let flotaEncendida = false;

/** BD vacía, salvo el usuario de la sesión (con los roles y permisos del caso). */
function bdVacia() {
  query.mockReset();
  query.mockImplementation(async (sql, params = []) => {
    // Solo la fila de la sesión: si un controlador carga a OTRO usuario (el
    // objeto de la ruta, id 1), no existe y no se confunde con el de la sesión.
    if (/GROUP_CONCAT[\s\S]*FROM users u/.test(sql)) {
      if (!params.includes(USUARIO_ID)) return [[]];
      return [[{ id: USUARIO_ID, username: 'prueba', nombre: 'P', apellidos: 'P',
        activo: 1, deleted_at: null, roles: rolesActuales }]];
    }
    if (/FROM role_permissions rp/.test(sql)) return [permisosActuales.map(nombre => ({ nombre }))];
    // Quien está detrás de un token de «Ver como»: superadmin activo, sesión abierta
    if (/JOIN impersonaciones i/.test(sql)) return [[{ id: 1, username: 'super' }]];
    if (/FROM app_features WHERE feature_key/.test(sql)) return [[{ enabled: flotaEncendida ? 1 : 0 }]];
    if (/COUNT\(/i.test(sql)) return [[{ total: 0 }]];
    return [[]];
  });
  transaction.mockReset();
  transaction.mockImplementation(async (fn) =>
    fn({ execute: jest.fn().mockResolvedValue([[]]), query: jest.fn().mockResolvedValue([[]]) }));
}

function llamar(ruta, token = TOKEN) {
  const [metodo, patron] = ruta.split(' ');
  const url = '/api/v1' + patron.replace(/:[a-zA-Z]+/g, '1');
  return request(app)[metodo.toLowerCase()](url).set('Authorization', `Bearer ${token}`).send({});
}

describe('autorización de todas las rutas', () => {
  it('encuentra las rutas (si esto da 0, se ha roto la forma de listarlas)', () => {
    expect(RUTAS.length).toBeGreaterThan(50);
  });

  it('todas las rutas están clasificadas en ACCESO, y en ACCESO no sobra ninguna', () => {
    const sinClasificar = RUTAS.filter((r) => !ACCESO[r]);
    const sobran        = Object.keys(ACCESO).filter((r) => !RUTAS.includes(r));
    expect({ sinClasificar, sobran }).toEqual({ sinClasificar: [], sobran: [] });
  });

  it('NIVEL solo nombra rutas denegadas que existen', () => {
    const malas = Object.keys(NIVEL).filter((r) => ACCESO[r]?.[0] !== 'denegada');
    expect(malas).toEqual([]);
  });

  describe.each([['sin rol', ''], ['técnico sin permisos', 'tecnico']])('%s', (_nombre, roles) => {
    beforeEach(() => { rolesActuales = roles; permisosActuales = []; flotaEncendida = false; bdVacia(); });

    const denegadas = RUTAS.filter((r) => ACCESO[r]?.[0] === 'denegada');
    it.each(denegadas)('%s → 403', async (ruta) => {
      const res = await llamar(ruta);
      expect(res.status).toBe(403);
    });

    const propias = RUTAS.filter((r) => ACCESO[r]?.[0] === 'propia');
    it.each(propias)('%s → solo lo suyo', async (ruta) => {
      const res = await llamar(ruta);
      expect(res.status).toBe(200);
      const deDatos = query.mock.calls.filter(([sql]) => !ES_CONSULTA_DE_SESION.test(sql));
      expect(deDatos.length).toBeGreaterThan(0);
      const sinFiltrar = deDatos.filter(([, params]) => !(params || []).includes(USUARIO_ID));
      expect(sinFiltrar.map(([sql]) => sql.replace(/\s+/g, ' ').slice(0, 120))).toEqual([]);
    });
  });

  // ── Escalones: gestor < administrador < superadmin ─────────
  const denegadas = RUTAS.filter((r) => ACCESO[r]?.[0] === 'denegada');
  const deNivel = (...niveles) => denegadas.filter((r) => niveles.includes(nivelDe(r)));
  // «Entra» = la autorización deja pasar: ni 401 ni 403. No se exige < 500:
  // con esta BD falsa (cualquier COUNT devuelve una fila inventada) algún
  // controlador revienta después de autorizar, p. ej. finalizeTrabajo con un
  // trabajo que no existe, y eso no dice nada del control de acceso.
  const entra = (res) => {
    expect([401, 403]).not.toContain(res.status);
  };


  describe('gestor', () => {
    beforeEach(() => {
      rolesActuales = 'gestor'; permisosActuales = PERMISOS_GESTION; flotaEncendida = true; bdVacia();
    });

    it.each(deNivel('administrador', 'superadmin'))('%s → 403', async (ruta) => {
      expect((await llamar(ruta)).status).toBe(403);
    });

    it.each(deNivel('gestion'))('%s → entra', async (ruta) => {
      entra(await llamar(ruta));
    });
  });

  describe('administrador', () => {
    beforeEach(() => {
      rolesActuales = 'administrador'; permisosActuales = PERMISOS_GESTION; flotaEncendida = true; bdVacia();
    });

    it.each(deNivel('superadmin'))('%s → 403', async (ruta) => {
      expect((await llamar(ruta)).status).toBe(403);
    });

    it.each(deNivel('gestion', 'administrador'))('%s → entra', async (ruta) => {
      entra(await llamar(ruta));
    });

    it('GET /flota/ubicaciones con menu_flota apagado → 403', async () => {
      flotaEncendida = false;
      expect((await llamar('GET /flota/ubicaciones')).status).toBe(403);
    });
  });

  describe('superadmin', () => {
    beforeEach(() => {
      rolesActuales = 'superadmin'; permisosActuales = PERMISOS_GESTION; flotaEncendida = false; bdVacia();
    });

    // Sentido positivo de lo de superadmin: una ruta de gestión puesta por
    // error tras requireSuperAdmin la pillan los de arriba; esto pilla una de
    // superadmin que no deje entrar ni al superadmin.
    it.each(deNivel('superadmin'))('%s → entra', async (ruta) => {
      entra(await llamar(ruta));
    });
  });

  describe('«Ver como»: token de superadmin impersonando a un administrador', () => {
    const tokenImp = () => generateImpersonationToken({ id: USUARIO_ID, username: 'prueba', roles: ['administrador'] }, 1);
    beforeEach(() => {
      rolesActuales = 'administrador'; permisosActuales = PERMISOS_GESTION; flotaEncendida = false; bdVacia();
    });

    it.each(deNivel('superadmin'))('%s → 403', async (ruta) => {
      expect((await llamar(ruta, tokenImp())).status).toBe(403);
    });
  });
});

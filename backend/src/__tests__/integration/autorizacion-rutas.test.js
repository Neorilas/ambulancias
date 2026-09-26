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
 */

const express = require('express');
const request = require('supertest');
const { query, transaction } = require('../../config/database');
const { generateAccessToken } = require('../../utils/jwt.utils');
const router = require('../../routes');

const ACCESO = {
  // ── Públicas / cualquier sesión ─────────────────────────────
  'POST /csp-report':            ['abierta', 'la manda el navegador, sin token'],
  'POST /auth/login':            ['abierta', 'pública'],
  'POST /auth/refresh':          ['abierta', 'pública (va con el refresh token)'],
  'POST /auth/logout':           ['abierta', 'cierra la sesión propia'],
  'GET /auth/me':                ['abierta', 'los datos propios'],
  'GET /':                       ['abierta', 'nombre y versión de la API'],
  'GET /features/active':        ['abierta', 'flags para pintar el menú'],
  'GET /push/vapid-public-key':  ['abierta', 'clave pública'],
  'POST /push/estado':           ['abierta', 'solo las suscripciones propias'],
  'GET /push/estado':            ['abierta', 'obsoleta, igual que el POST'],
  'POST /push/subscribe':        ['abierta', 'da de alta el dispositivo propio'],
  'DELETE /push/subscribe':      ['abierta', 'solo borra si es suya'],
  'POST /push/test':             ['abierta', 'aviso a uno mismo'],

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
  'GET /features/':                    ['denegada'],
  'PUT /features/:key':                ['denegada'],
  'GET /flota/ubicaciones':            ['denegada'],
};

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

/** BD vacía, salvo el usuario de la sesión (con los roles del caso y sin permisos). */
function bdVacia() {
  query.mockReset();
  query.mockImplementation(async (sql) => {
    if (/GROUP_CONCAT[\s\S]*FROM users u/.test(sql)) {
      return [[{ id: USUARIO_ID, username: 'prueba', nombre: 'P', apellidos: 'P',
        activo: 1, deleted_at: null, roles: rolesActuales }]];
    }
    if (/COUNT\(/i.test(sql)) return [[{ total: 0 }]];
    return [[]];
  });
  transaction.mockReset();
  transaction.mockImplementation(async (fn) =>
    fn({ execute: jest.fn().mockResolvedValue([[]]), query: jest.fn().mockResolvedValue([[]]) }));
}

function llamar(ruta) {
  const [metodo, patron] = ruta.split(' ');
  const url = '/api/v1' + patron.replace(/:[a-zA-Z]+/g, '1');
  return request(app)[metodo.toLowerCase()](url).set('Authorization', `Bearer ${TOKEN}`).send({});
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

  describe.each([['sin rol', ''], ['técnico sin permisos', 'tecnico']])('%s', (_nombre, roles) => {
    beforeEach(() => { rolesActuales = roles; bdVacia(); });

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
});

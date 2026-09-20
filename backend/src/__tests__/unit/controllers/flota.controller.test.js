'use strict';

/**
 * Tests de controllers/flota.controller.js
 *
 * El cruce en sí ya tiene sus tests en `utils/flota.utils.test.js`. Aquí se
 * fija lo del controlador: que la asignación activa se resuelve bien aunque la
 * tabla traiga duplicados, y —lo importante— que la pantalla recibe un 200 con
 * la flota aunque Cartrack esté caído o sin configurar. Un 503 aquí dejaría al
 * administrador sin la lista de vehículos, que sí tenemos.
 */

const { query } = require('../../../config/database');

jest.mock('../../../services/cartrack.service', () => ({
  estaConfigurado: jest.fn(() => true),
  obtenerEstados: jest.fn(),
}));

const cartrack = require('../../../services/cartrack.service');
const { getUbicaciones } = require('../../../controllers/flota.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

const superadmin = { id: 1, username: 'findelias', roles: ['superadmin'] };

/** Fila tal y como sale del LEFT JOIN de vehículos + asignación activa. */
const fila = (over = {}) => ({
  id: 1,
  matricula: '1234BCD',
  alias: 'Ambulancia 1',
  kilometros_actuales: 119800,
  asignacion_id: null,
  asignacion_inicio: null,
  asignacion_fin: null,
  inicio_real_at: null,
  responsable_nombre: null,
  ...over,
});

const gps = (over = {}) => ({
  cartrackId: 'ct-1',
  matricula: '1234BCD',
  matriculaOriginal: '1234 BCD',
  lat: 40.4, lng: -3.7, ubicacion: 'Calle Mayor',
  velocidad: 54, rumbo: 90, contacto: true,
  odometroKm: 120000, conductor: null,
  actualizado: new Date().toISOString(),
  ...over,
});

/** Lo que devuelve el servicio de Cartrack cuando todo va bien. */
const estadoOk = (vehiculos = [gps()]) => ({
  vehiculos, origen: 'api', actualizado: new Date().toISOString(),
  error: null, configurado: true,
});

describe('flota.controller · getUbicaciones', () => {
  beforeEach(() => {
    // clearAllMocks no drena la cola de mockResolvedValueOnce: hay que resetear.
    query.mockReset();
    cartrack.obtenerEstados.mockReset();
  });

  it('devuelve la flota cruzada con el GPS', async () => {
    query.mockResolvedValueOnce([[fila()]]);
    cartrack.obtenerEstados.mockResolvedValueOnce(estadoOk());

    const res = mockRes();
    await getUbicaciones(mockReq({ user: superadmin }), res, mockNext());

    expect(res.status).toHaveBeenCalledWith(200);
    const { flota, resumen, fuente } = res._json.data;
    expect(flota).toHaveLength(1);
    expect(flota[0]).toMatchObject({ vehiculoId: 1, alias: 'Ambulancia 1', vinculo: 'vinculado' });
    expect(resumen.vinculados).toBe(1);
    expect(fuente).toMatchObject({ configurado: true, origen: 'api', error: null });
  });

  it('adjunta la asignación activa y su responsable, que es lo que Cartrack no sabe', async () => {
    query.mockResolvedValueOnce([[fila({
      asignacion_id: 7,
      responsable_nombre: 'Ana Ruiz',
      asignacion_inicio: '2026-09-20T06:00:00.000Z',
      inicio_real_at: '2026-09-20T06:12:00.000Z',
    })]]);
    cartrack.obtenerEstados.mockResolvedValueOnce(estadoOk());

    const res = mockRes();
    await getUbicaciones(mockReq({ user: superadmin }), res, mockNext());

    expect(res._json.data.flota[0].asignacion).toMatchObject({
      id: 7, responsable: 'Ana Ruiz', iniciada: true,
    });
  });

  it('una asignación activa sin iniciar se marca como tal', async () => {
    // El cron la puso «activa» al llegar su hora, pero nadie ha pulsado
    // «Inicio de servicio». En el mapa explica un vehículo asignado que sigue
    // en la base.
    query.mockResolvedValueOnce([[fila({ asignacion_id: 7, responsable_nombre: 'Ana Ruiz' })]]);
    cartrack.obtenerEstados.mockResolvedValueOnce(estadoOk());

    const res = mockRes();
    await getUbicaciones(mockReq({ user: superadmin }), res, mockNext());

    expect(res._json.data.flota[0].asignacion.iniciada).toBe(false);
  });

  it('con dos asignaciones activas solapadas se queda con la más reciente', async () => {
    // La app lo evita, pero la tabla manda más que las buenas intenciones: el
    // LEFT JOIN devolvería dos filas del mismo vehículo y la lista enseñaría
    // la ambulancia duplicada.
    query.mockResolvedValueOnce([[
      fila({ asignacion_id: 9, responsable_nombre: 'Ana Ruiz',  asignacion_inicio: '2026-09-20T08:00:00.000Z' }),
      fila({ asignacion_id: 4, responsable_nombre: 'Luis Gil',  asignacion_inicio: '2026-09-19T08:00:00.000Z' }),
    ]]);
    cartrack.obtenerEstados.mockResolvedValueOnce(estadoOk());

    const res = mockRes();
    await getUbicaciones(mockReq({ user: superadmin }), res, mockNext());

    const { flota } = res._json.data;
    expect(flota).toHaveLength(1);
    expect(flota[0].asignacion.id).toBe(9);
  });

  it('sin Cartrack configurado responde 200 con la flota y lo dice en `fuente`', async () => {
    // La pantalla tiene que poder distinguir «este entorno no tiene GPS» de
    // «ha fallado la petición», y para eso necesita que la petición no falle.
    query.mockResolvedValueOnce([[fila()]]);
    cartrack.obtenerEstados.mockResolvedValueOnce({
      vehiculos: [], origen: 'ninguno', actualizado: null, error: null, configurado: false,
    });

    const res = mockRes();
    await getUbicaciones(mockReq({ user: superadmin }), res, mockNext());

    expect(res.status).toHaveBeenCalledWith(200);
    const { flota, fuente } = res._json.data;
    expect(fuente.configurado).toBe(false);
    expect(flota).toHaveLength(1);
    expect(flota[0].estado).toBe('sin_gps');
  });

  it('con Cartrack caído sigue devolviendo la flota, con el error al lado', async () => {
    query.mockResolvedValueOnce([[fila()]]);
    cartrack.obtenerEstados.mockResolvedValueOnce({
      vehiculos: [], origen: 'ninguno', actualizado: null,
      error: 'Cartrack no respondió en 8000 ms', configurado: true,
    });

    const res = mockRes();
    await getUbicaciones(mockReq({ user: superadmin }), res, mockNext());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._json.data.fuente.error).toMatch(/no respondió/);
    expect(res._json.data.flota).toHaveLength(1);
  });

  it('no pide vehículos borrados', async () => {
    query.mockResolvedValueOnce([[]]);
    cartrack.obtenerEstados.mockResolvedValueOnce(estadoOk([]));

    await getUbicaciones(mockReq({ user: superadmin }), mockRes(), mockNext());

    expect(query.mock.calls[0][0]).toContain('v.deleted_at IS NULL');
    expect(query.mock.calls[0][0]).toContain("al.estado     = 'activa'");
  });

  it('un fallo de BD va a next, no revienta la petición', async () => {
    query.mockRejectedValueOnce(new Error('DB down'));
    cartrack.obtenerEstados.mockResolvedValueOnce(estadoOk());

    const next = mockNext();
    await getUbicaciones(mockReq({ user: superadmin }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

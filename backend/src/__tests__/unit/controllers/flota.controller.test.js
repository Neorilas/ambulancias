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
  obtenerRecorrido: jest.fn(),
}));

const cartrack = require('../../../services/cartrack.service');
const { getUbicaciones, getRecorrido, ventanaDelServicio } = require('../../../controllers/flota.controller');
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
    // «Inicio de la asignación». En el mapa explica un vehículo asignado que sigue
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

// ============================================================
describe('flota.controller · ventanaDelServicio', () => {
  const AHORA = new Date('2026-10-19T12:00:00Z');

  it('va del «Inicio de servicio» al finalizado', () => {
    const v = ventanaDelServicio({
      estado: 'finalizada', inicio_real_at: '2026-10-17 06:00:00', fecha_inicio: '2026-10-17 05:00:00',
      finalizado_at: '2026-10-17 20:00:00', fecha_fin: '2026-10-17 18:00:00',
    }, AHORA);
    expect(v.desde.toISOString()).toBe('2026-10-17T06:00:00.000Z');
    expect(v.hasta.toISOString()).toBe('2026-10-17T20:00:00.000Z');
    expect(v).toMatchObject({ enCurso: false, recortado: false });
  });

  it('en curso llega hasta ahora, aunque lo previsto acabe después', () => {
    const v = ventanaDelServicio({
      estado: 'activa', inicio_real_at: '2026-10-19 08:00:00', fecha_fin: '2026-10-19 20:00:00',
    }, AHORA);
    expect(v.hasta).toEqual(AHORA);
    expect(v.enCurso).toBe(true);
  });

  it('sin «Inicio de servicio» usa la hora prevista (el cron la activó igual)', () => {
    const v = ventanaDelServicio({ estado: 'activa', inicio_real_at: null, fecha_inicio: '2026-10-19 09:00:00' }, AHORA);
    expect(v.desde.toISOString()).toBe('2026-10-19T09:00:00.000Z');
  });

  it('una programada no tiene recorrido', () => {
    expect(ventanaDelServicio({ estado: 'programada', fecha_inicio: '2026-10-19 09:00:00' }, AHORA)).toBeNull();
  });

  it('más de 7 días: se enseñan los últimos 7 y se avisa', () => {
    const v = ventanaDelServicio({ estado: 'activa', inicio_real_at: '2026-10-01 08:00:00' }, AHORA);
    expect(v.recortado).toBe(true);
    expect(v.desde.toISOString()).toBe('2026-10-12T12:00:00.000Z');
  });
});

describe('flota.controller · getRecorrido', () => {
  const hace = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const asig = (over = {}) => ({
    id: 7, estado: 'finalizada', fecha_inicio: hace(10), fecha_fin: hace(2),
    inicio_real_at: hace(9), finalizado_at: hace(3), vehicle_id: 1, matricula: '7740 MZB', ...over,
  });
  const gpsReal = gps({ cartrackId: 454742160, matricula: '7740MZB', matriculaOriginal: 'UVI-3-7740MZB' });

  beforeEach(() => {
    query.mockReset();
    cartrack.obtenerEstados.mockReset();
    cartrack.obtenerRecorrido.mockReset();
  });

  const pedir = async (id = '7') => {
    const res = mockRes();
    const next = mockNext();
    await getRecorrido(mockReq({ user: superadmin, params: { asignacionId: id } }), res, next);
    return { res, next };
  };

  it('pide a Cartrack por el `registration` crudo, no por vehicle_id ni por nuestra matrícula', async () => {
    query.mockResolvedValueOnce([[asig()]]);
    cartrack.obtenerEstados.mockResolvedValueOnce(estadoOk([gpsReal]));
    cartrack.obtenerRecorrido.mockResolvedValueOnce({
      puntos: [
        { lat: 40.3, lng: -3.68, t: Date.now() - 8 * 3600e3, v: 50 },
        { lat: 40.31, lng: -3.68, t: Date.now() - 8 * 3600e3 + 60e3, v: 50 },
      ],
      error: null, configurado: true,
    });

    const { res } = await pedir();

    expect(cartrack.obtenerRecorrido).toHaveBeenCalledWith(expect.objectContaining({ registration: 'UVI-3-7740MZB' }));
    expect(res._json.data.estado).toBe('ok');
    expect(res._json.data.recorrido.tramos).toHaveLength(1);
    expect(res._json.data.recorrido.km).toBeGreaterThan(1);
  });

  it('una programada no llama a Cartrack', async () => {
    query.mockResolvedValueOnce([[asig({ estado: 'programada' })]]);
    const { res } = await pedir();
    expect(res._json.data.estado).toBe('sin_empezar');
    expect(cartrack.obtenerEstados).not.toHaveBeenCalled();
  });

  it('matrícula repetida en Cartrack: no se elige ninguna', async () => {
    query.mockResolvedValueOnce([[asig()]]);
    cartrack.obtenerEstados.mockResolvedValueOnce(estadoOk([gpsReal, { ...gpsReal, cartrackId: 2, matriculaOriginal: 'VIR-7740MZB' }]));
    const { res } = await pedir();
    expect(res._json.data.estado).toBe('sin_gps');
    expect(cartrack.obtenerRecorrido).not.toHaveBeenCalled();
  });

  it('Cartrack caído: 200 con el error contado, no un 500', async () => {
    query.mockResolvedValueOnce([[asig()]]);
    cartrack.obtenerEstados.mockResolvedValueOnce(estadoOk([gpsReal]));
    cartrack.obtenerRecorrido.mockResolvedValueOnce({ puntos: [], error: 'Cartrack no respondió a tiempo', configurado: true });
    const { res } = await pedir();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._json.data.fuente.error).toMatch(/no respondió/);
  });

  it('asignación que no existe → 404', async () => {
    query.mockResolvedValueOnce([[]]);
    const { res } = await pedir('999');
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

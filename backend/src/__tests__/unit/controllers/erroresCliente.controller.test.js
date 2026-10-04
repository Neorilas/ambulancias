'use strict';

/**
 * Tests de controllers/erroresCliente.controller.js — errores que manda la app.
 */

jest.mock('../../../controllers/admin.controller', () => ({ logError: jest.fn().mockResolvedValue(true) }));

const { query }    = require('../../../config/database');
const { logError } = require('../../../controllers/admin.controller');
const { recibirErrores, normalizar, ocurridoVerosimil, LOTE_MAX, TOPE_DIARIO } =
  require('../../../controllers/erroresCliente.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

const USER = { id: 7, username: 'jlopez', nombre: 'Juan' };
const AHORA = Date.parse('2026-10-03T12:00:00Z');

describe('erroresCliente.controller', () => {
  // Por defecto el usuario no ha mandado nada en las últimas 24 h.
  beforeEach(() => {
    jest.clearAllMocks();
    logError.mockResolvedValue(true);
    query.mockReset();
    query.mockResolvedValue([[{ hoy: 0 }]]);
  });

  describe('tope diario por usuario', () => {
    const lote = (n) => ({ errores: Array.from({ length: n }, () => ({ tipo: 'red', mensaje: 'Network Error' })) });

    it('cuenta solo lo de la app de ese usuario en las últimas 24 h', async () => {
      await recibirErrores(mockReq({ user: USER, body: lote(1) }), mockRes(), mockNext());
      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/origen = 'cliente' AND user_id = \? AND created_at >= \?/);
      expect(params[0]).toBe(7);
      expect(params[1]).toBeInstanceOf(Date);
      expect(Date.now() - params[1].getTime()).toBeGreaterThanOrEqual(24 * 3600 * 1000 - 1000);
    });

    it('con el cupo casi gastado guarda solo lo que cabe', async () => {
      query.mockResolvedValue([[{ hoy: TOPE_DIARIO - 3 }]]);
      const res = mockRes();
      await recibirErrores(mockReq({ user: USER, body: lote(10) }), res, mockNext());
      expect(logError).toHaveBeenCalledTimes(3);
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res._json.data.guardados).toBe(3);
    });

    it('pasado el tope no graba nada y contesta 202 (no 503: la app lo reintentaría sin fin)', async () => {
      query.mockResolvedValue([[{ hoy: TOPE_DIARIO + 50 }]]);
      const res = mockRes();
      await recibirErrores(mockReq({ user: USER, body: lote(5) }), res, mockNext());
      expect(logError).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('si falla el recuento, pasa el error a next', async () => {
      query.mockRejectedValue(new Error('BD caída'));
      const next = mockNext();
      await recibirErrores(mockReq({ user: USER, body: lote(1) }), mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(logError).not.toHaveBeenCalled();
    });
  });

  it('recorta el stack a 4000 caracteres', () => {
    const e = normalizar({ tipo: 'js', mensaje: 'm', stack: 'x'.repeat(9000) }, AHORA);
    expect(e.stackTrace.length).toBe(4000);
  });

  it('graba cada error con origen cliente, el usuario y el user-agent; responde 202', async () => {
    const res = mockRes();
    await recibirErrores(mockReq({
      user: USER,
      headers: { 'user-agent': 'Mozilla/5.0 (Android)' },
      body: { errores: [
        { tipo: 'timeout', mensaje: 'timeout of 120000ms exceeded', metodo: 'post',
          url: '/asignaciones/83/imagenes', pagina: '/asignaciones/83', version: 'abc1234' },
        { tipo: 'js', mensaje: 'x is undefined', stack: 'at y (app.js:1)' },
      ] },
    }), res, mockNext());

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res._json.data).toEqual({ recibidos: 2, guardados: 2 });
    expect(logError).toHaveBeenCalledTimes(2);
    const primero = logError.mock.calls[0][0];
    expect(primero).toMatchObject({
      origen: 'cliente', userId: 7, userInfo: 'jlopez (Juan)', userAgent: 'Mozilla/5.0 (Android)',
      method: 'POST', url: '/asignaciones/83/imagenes', statusCode: null,
      errorMessage: '[timeout] timeout of 120000ms exceeded',
    });
    expect(primero.stackTrace).toContain('Página: /asignaciones/83');
    expect(primero.stackTrace).toContain('Versión app: abc1234');
  });

  it('impersonando, lo anota en user_info', async () => {
    await recibirErrores(mockReq({
      user: { ...USER, impersonadoPor: { id: 1, username: 'findelias' } },
      body: { errores: [{ tipo: 'red', mensaje: 'Network Error' }] },
    }), mockRes(), mockNext());
    expect(logError.mock.calls[0][0].userInfo).toBe('jlopez (vía findelias)');
  });

  it('descarta lo que no trae tipo válido o mensaje, y corta el lote en LOTE_MAX', async () => {
    const errores = [
      { tipo: 'otro', mensaje: 'x' }, { tipo: 'js' }, null, 'texto',
      ...Array.from({ length: LOTE_MAX + 5 }, () => ({ tipo: 'red', mensaje: 'Network Error' })),
    ];
    const res = mockRes();
    await recibirErrores(mockReq({ user: USER, body: { errores } }), res, mockNext());
    expect(res._json.data.recibidos).toBe(LOTE_MAX);
    expect(logError).toHaveBeenCalledTimes(LOTE_MAX - 4);
  });

  it('si la BD no guarda ninguno, 503 para que la app conserve la cola', async () => {
    logError.mockResolvedValue(false);
    const res = mockRes();
    await recibirErrores(mockReq({ user: USER, body: { errores: [{ tipo: 'js', mensaje: 'm' }] } }), res, mockNext());
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('quita query y fragmento de la url aunque la app no lo haya hecho', () => {
    expect(normalizar({ tipo: 'red', mensaje: 'm', url: '/x?token=abc#f' }, AHORA).url).toBe('/x');
  });

  it('un cuerpo sin lote no graba nada', async () => {
    const res = mockRes();
    await recibirErrores(mockReq({ user: USER, body: {} }), res, mockNext());
    expect(res.status).toHaveBeenCalledWith(202);
    expect(logError).not.toHaveBeenCalled();
  });

  it('cuando no hay petición, la url es la página', () => {
    expect(normalizar({ tipo: 'js', mensaje: 'm', pagina: '/mis-asignaciones' }, AHORA).url).toBe('/mis-asignaciones');
  });

  it('status solo si es un código HTTP', () => {
    expect(normalizar({ tipo: 'http', mensaje: 'm', status: 502 }, AHORA).statusCode).toBe(502);
    expect(normalizar({ tipo: 'http', mensaje: 'm', status: 9999 }, AHORA).statusCode).toBeNull();
    expect(normalizar({ tipo: 'http', mensaje: 'm', status: '502' }, AHORA).statusCode).toBeNull();
  });

  describe('ocurridoVerosimil', () => {
    it('acepta un instante de los últimos días', () => {
      expect(ocurridoVerosimil('2026-10-02T08:00:00Z', AHORA)).toEqual(new Date('2026-10-02T08:00:00Z'));
    });
    it('rechaza el futuro (más allá del margen), lo muy antiguo y la basura', () => {
      expect(ocurridoVerosimil('2026-10-03T13:00:00Z', AHORA)).toBeNull();
      expect(ocurridoVerosimil('2026-09-01T00:00:00Z', AHORA)).toBeNull();
      expect(ocurridoVerosimil('ayer', AHORA)).toBeNull();
      expect(ocurridoVerosimil(12345, AHORA)).toBeNull();
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

const post = vi.fn();
vi.mock('../../../services/api.js', () => ({ default: { post: (...a) => post(...a) } }));

import { PREFIJO } from '../../../utils/sessionStorage.js';
import {
  registrarError, enviarPendientes, reportarErrorDePeticion, _reiniciar, COLA_MAX, LOTE_MAX,
} from '../../../utils/reporteErrores.js';

const cola = () => JSON.parse(localStorage.getItem(PREFIJO + 'erroresPendientes') || '[]');
const set = (k, v) => localStorage.setItem(PREFIJO + k, v);
const T0 = Date.parse('2026-10-03T10:00:00Z');

describe('utils/reporteErrores', () => {
  beforeEach(() => {
    localStorage.clear();
    _reiniciar();
    post.mockReset().mockResolvedValue({});
    set('accessToken', 'at');
    set('user', '{"id":7}');
  });

  it('apunta el error con la página, el usuario y la url sin query', () => {
    registrarError({ tipo: 'timeout', mensaje: 'timeout of 120000ms exceeded', metodo: 'post', url: '/asignaciones/83/imagenes?x=1' }, T0);
    expect(cola()).toEqual([expect.objectContaining({
      tipo: 'timeout', metodo: 'POST', url: '/asignaciones/83/imagenes', usuario_id: 7, veces: 1,
      ocurrido_at: '2026-10-03T10:00:00.000Z',
    })]);
  });

  it('el mismo error dentro de 5 min suma veces; pasado ese tiempo es otra fila', () => {
    const e = { tipo: 'red', mensaje: 'Network Error', metodo: 'POST', url: '/a' };
    registrarError(e, T0);
    registrarError(e, T0 + 60_000);
    expect(cola()).toHaveLength(1);
    expect(cola()[0].veces).toBe(2);
    registrarError(e, T0 + 6 * 60_000);
    expect(cola()).toHaveLength(2);
  });

  it('la cola no pasa de COLA_MAX y se queda con los más recientes', () => {
    for (let i = 0; i < COLA_MAX + 5; i++) registrarError({ tipo: 'js', mensaje: `e${i}` }, T0);
    expect(cola()).toHaveLength(COLA_MAX);
    expect(cola()[0].mensaje).toBe('e5');
  });

  it('manda en lotes, sin los campos internos, marca las repeticiones y vacía la cola', async () => {
    const e = { tipo: 'red', mensaje: 'Network Error', metodo: 'POST', url: '/a' };
    registrarError(e, T0); registrarError(e, T0 + 1000);
    for (let i = 0; i < LOTE_MAX; i++) registrarError({ tipo: 'js', mensaje: `e${i}` }, T0);

    await enviarPendientes();
    expect(post).toHaveBeenCalledTimes(2);
    const [url, cuerpo, config] = post.mock.calls[0];
    expect(url).toBe('/errores-cliente');
    expect(config).toEqual({ _sinReporteDeError: true });
    expect(cuerpo.errores).toHaveLength(LOTE_MAX);
    expect(cuerpo.errores[0].mensaje).toBe('Network Error (×2)');
    expect(cuerpo.errores[0]).not.toHaveProperty('usuario_id');
    expect(cuerpo.errores[0]).not.toHaveProperty('veces');
    expect(cola()).toEqual([]);
  });

  it('si el envío falla la cola se queda; sin sesión ni lo intenta', async () => {
    registrarError({ tipo: 'js', mensaje: 'x' }, T0);
    post.mockRejectedValueOnce(new Error('Network Error'));
    await enviarPendientes();
    expect(cola()).toHaveLength(1);

    localStorage.removeItem(PREFIJO + 'accessToken');
    post.mockClear();
    await enviarPendientes();
    expect(post).not.toHaveBeenCalled();
  });

  it('descarta los errores de otro usuario antes de mandar', async () => {
    registrarError({ tipo: 'js', mensaje: 'de 7' }, T0);
    set('user', '{"id":9}');
    registrarError({ tipo: 'js', mensaje: 'de 9' }, T0);
    await enviarPendientes();
    expect(post.mock.calls[0][1].errores.map((x) => x.mensaje)).toEqual(['de 9']);
  });

  describe('reportarErrorDePeticion', () => {
    const err = (extra) => ({ config: { method: 'post', url: '/asignaciones/1/finalizar' }, message: 'm', ...extra });

    it('sin respuesta: timeout o red, pero no en un GET (sondeo = ruido)', () => {
      reportarErrorDePeticion(err({ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' }));
      reportarErrorDePeticion(err({ code: 'ERR_NETWORK', message: 'Network Error' }));
      reportarErrorDePeticion(err({ config: { method: 'get', url: '/asignaciones/alarmas' }, code: 'ERR_NETWORK' }));
      expect(cola().map((x) => x.tipo)).toEqual(['timeout', 'red']);
    });

    it('502/503/504 de cualquier método; el resto de códigos no', () => {
      reportarErrorDePeticion(err({ config: { method: 'get', url: '/x' }, response: { status: 502 } }));
      reportarErrorDePeticion(err({ response: { status: 500 } }));   // ese ya lo graba el backend
      reportarErrorDePeticion(err({ response: { status: 422 } }));
      expect(cola()).toEqual([expect.objectContaining({ tipo: 'http', status: 502, metodo: 'GET' })]);
    });

    it('ni cancelaciones ni el propio envío del reporte', () => {
      reportarErrorDePeticion(err({ code: 'ERR_CANCELED' }));
      reportarErrorDePeticion(err({ config: { method: 'post', url: '/errores-cliente', _sinReporteDeError: true } }));
      expect(cola()).toEqual([]);
    });
  });
});

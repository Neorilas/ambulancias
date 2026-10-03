import { describe, it, expect, vi } from 'vitest';
import {
  esFalloDeRed, conReintentos, mensajeFalloSubida, ESPERAS_REINTENTO_MS,
} from '../../../utils/subidaFotos';

const timeout   = () => Object.assign(new Error('timeout of 120000ms exceeded'), { code: 'ECONNABORTED', request: {} });
const sinRed    = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', request: {} });
const status    = (s) => ({ response: { status: s, data: { message: `HTTP ${s}` } } });
const sinEspera = () => Promise.resolve();

describe('esFalloDeRed', () => {
  it('timeout, sin red y 502/503/504 son de red', () => {
    expect(esFalloDeRed(timeout())).toBe(true);
    expect(esFalloDeRed(sinRed())).toBe(true);
    [502, 503, 504].forEach(s => expect(esFalloDeRed(status(s))).toBe(true));
  });

  it('una respuesta real del servidor no lo es', () => {
    [400, 401, 403, 413, 429, 500].forEach(s => expect(esFalloDeRed(status(s))).toBe(false));
  });

  it('un error de programación (sin request) no lo es', () => {
    expect(esFalloDeRed(new TypeError('x is undefined'))).toBe(false);
    expect(esFalloDeRed(null)).toBe(false);
  });
});

describe('conReintentos', () => {
  it('reintenta los fallos de red y devuelve el primer éxito', async () => {
    const enviar = vi.fn()
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(sinRed())
      .mockResolvedValueOnce('ok');
    const esperar = vi.fn(sinEspera);

    await expect(conReintentos(enviar, { esperar })).resolves.toBe('ok');
    expect(enviar).toHaveBeenCalledTimes(3);
    expect(esperar.mock.calls.map(c => c[0])).toEqual(ESPERAS_REINTENTO_MS);
  });

  it('se rinde tras los reintentos y propaga el último error', async () => {
    const enviar = vi.fn().mockRejectedValue(timeout());
    await expect(conReintentos(enviar, { esperar: sinEspera })).rejects.toMatchObject({ code: 'ECONNABORTED' });
    expect(enviar).toHaveBeenCalledTimes(ESPERAS_REINTENTO_MS.length + 1);
  });

  it('no reintenta una respuesta real del servidor', async () => {
    const enviar = vi.fn().mockRejectedValue(status(400));
    await expect(conReintentos(enviar, { esperar: sinEspera })).rejects.toEqual(status(400));
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});

describe('mensajeFalloSubida', () => {
  it('dice cuántas fotos han subido y qué botón volver a pulsar', () => {
    const m = mensajeFalloSubida({ subidas: 2, total: 5, boton: 'Finalizar asignación' });
    expect(m).toContain('(2 de 5 subidas)');
    expect(m).toContain('«Finalizar asignación»');
  });

  it('con todas arriba, lo que falló es el paso siguiente', () => {
    expect(mensajeFalloSubida({ subidas: 5, total: 5, boton: 'X' }))
      .toMatch(/^Las fotos ya están subidas/);
  });
});

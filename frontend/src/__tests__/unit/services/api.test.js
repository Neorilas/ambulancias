import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock axios BEFORE importing api
vi.mock('axios', () => {
  const interceptors = {
    request: { use: vi.fn(), handlers: [] },
    response: { use: vi.fn(), handlers: [] },
  };
  // Capture handlers when use() is called
  interceptors.request.use.mockImplementation((fulfilled, rejected) => {
    interceptors.request.handlers.push({ fulfilled, rejected });
  });
  interceptors.response.use.mockImplementation((fulfilled, rejected) => {
    interceptors.response.handlers.push({ fulfilled, rejected });
  });

  const instance = vi.fn(); // callable for retry
  instance.defaults = { baseURL: '/api/v1', headers: { common: {} } };
  instance.interceptors = interceptors;

  return {
    default: {
      create: vi.fn(() => instance),
      post: vi.fn(),
    },
  };
});

import axios from 'axios';
import { PREFIJO } from '../../../utils/sessionStorage.js';

let api;
let reqFulfilled, reqRejected, resFulfilled, resRejected;

beforeEach(async () => {
  localStorage.clear();
  // Reset interceptor handlers
  const instance = axios.create();
  instance.interceptors.request.handlers = [];
  instance.interceptors.response.handlers = [];

  // Re-import api to re-register interceptors
  vi.resetModules();
  const mod = await import('../../../services/api.js');
  api = mod.default;

  const reqHandler = api.interceptors.request.handlers[0];
  reqFulfilled = reqHandler.fulfilled;
  reqRejected = reqHandler.rejected;

  const resHandler = api.interceptors.response.handlers[0];
  resFulfilled = resHandler.fulfilled;
  resRejected = resHandler.rejected;
});

afterEach(() => {
  delete window.location;
  window.location = { pathname: '/', href: '' };
});

describe('api service', () => {
  describe('request interceptor', () => {
    it('adds Authorization header when token exists', () => {
      localStorage.setItem(PREFIJO + 'accessToken', 'test-token');
      const config = { headers: {} };
      const result = reqFulfilled(config);
      expect(result.headers.Authorization).toBe('Bearer test-token');
    });

    it('does not add Authorization when no token', () => {
      const config = { headers: {} };
      const result = reqFulfilled(config);
      expect(result.headers.Authorization).toBeUndefined();
    });

    it('rejects on request error', async () => {
      const err = new Error('req error');
      await expect(reqRejected(err)).rejects.toThrow('req error');
    });
  });

  // Incidente 2026-10-03: la foto salía con el token caducado y el 401 no
  // llegaba al móvil hasta agotar el timeout de la subida.
  describe('subida con el token a punto de caducar', () => {
    const jwt = (expS) => `h.${btoa(JSON.stringify({ exp: expS })).replace(/=+$/, '')}.f`;
    const ahoraS = () => Math.floor(Date.now() / 1000);

    beforeEach(() => { axios.post.mockReset(); });
    afterEach(() => { axios.post.mockReset(); });

    it('tokenCaducaPronto: caducado o dentro del margen sí; con tiempo o ilegible, no', async () => {
      const { tokenCaducaPronto, MARGEN_CADUCIDAD_TOKEN_S } = await import('../../../services/api.js');
      expect(tokenCaducaPronto(jwt(ahoraS() - 10))).toBe(true);
      expect(tokenCaducaPronto(jwt(ahoraS() + MARGEN_CADUCIDAD_TOKEN_S - 5))).toBe(true);
      expect(tokenCaducaPronto(jwt(ahoraS() + 600))).toBe(false);
      expect(tokenCaducaPronto('no-es-un-jwt')).toBe(false);
    });

    it('refresca ANTES de mandar la foto y la manda con el token nuevo', async () => {
      localStorage.setItem(PREFIJO + 'accessToken', jwt(ahoraS() - 10));
      localStorage.setItem(PREFIJO + 'refreshToken', 'rt');
      axios.post.mockResolvedValueOnce({ data: { data: { accessToken: 'at-new', refreshToken: 'rt-new' } } });

      const config = await reqFulfilled({ headers: {}, data: new FormData() });

      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(config.headers.Authorization).toBe('Bearer at-new');
      expect(localStorage.getItem(PREFIJO + 'refreshToken')).toBe('rt-new');
    });

    it('con el token en vigor, o sin fichero, no refresca', () => {
      localStorage.setItem(PREFIJO + 'refreshToken', 'rt');
      localStorage.setItem(PREFIJO + 'accessToken', jwt(ahoraS() + 600));
      reqFulfilled({ headers: {}, data: new FormData() });
      localStorage.setItem(PREFIJO + 'accessToken', jwt(ahoraS() - 10));
      const config = reqFulfilled({ headers: {}, data: { a: 1 } });
      expect(config.headers.Authorization).toContain('Bearer h.');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('impersonando no refresca (ese token no tiene refresh)', () => {
      localStorage.setItem(PREFIJO + 'accessToken', jwt(ahoraS() - 10));
      localStorage.setItem(PREFIJO + 'refreshToken', 'rt');
      localStorage.setItem(PREFIJO + 'impersonacion', '{"id":5}');
      reqFulfilled({ headers: {}, data: new FormData() });
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('si el refresco no llega, la foto no sale y el error es de red (para que se reintente)', async () => {
      localStorage.setItem(PREFIJO + 'accessToken', jwt(ahoraS() - 10));
      localStorage.setItem(PREFIJO + 'refreshToken', 'rt');
      axios.post.mockRejectedValueOnce(
        Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED', request: {} }),
      );
      await expect(reqFulfilled({ headers: {}, data: new FormData() })).rejects.toThrow('timeout');
      expect(localStorage.getItem(PREFIJO + 'refreshToken')).toBe('rt');
    });

    it('varias fotos a la vez comparten un solo refresco', async () => {
      localStorage.setItem(PREFIJO + 'accessToken', jwt(ahoraS() - 10));
      localStorage.setItem(PREFIJO + 'refreshToken', 'rt');
      axios.post.mockResolvedValueOnce({ data: { data: { accessToken: 'at-new', refreshToken: 'rt-new' } } });
      const [a, b] = await Promise.all([
        reqFulfilled({ headers: {}, data: new FormData() }),
        reqFulfilled({ headers: {}, data: new FormData() }),
      ]);
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect([a.headers.Authorization, b.headers.Authorization]).toEqual(['Bearer at-new', 'Bearer at-new']);
    });
  });

  describe('response interceptor', () => {
    it('passes through successful responses', () => {
      const res = { data: { ok: true } };
      expect(resFulfilled(res)).toEqual(res);
    });

    it('rejects non-401 errors', async () => {
      const error = { response: { status: 500 }, config: {} };
      await expect(resRejected(error)).rejects.toEqual(error);
    });

    it('rejects 401 on /auth/login without refresh', async () => {
      const error = {
        response: { status: 401 },
        config: { url: '/auth/login', headers: {} },
      };
      await expect(resRejected(error)).rejects.toEqual(error);
    });

    it('rejects 401 on /auth/refresh without refresh', async () => {
      const error = {
        response: { status: 401 },
        config: { url: '/auth/refresh', headers: {} },
      };
      await expect(resRejected(error)).rejects.toEqual(error);
    });

    it('clears auth and rejects when no refreshToken on 401', async () => {
      localStorage.setItem(PREFIJO + 'accessToken', 'old');
      localStorage.setItem(PREFIJO + 'user', '{}');
      // No refreshToken set
      const error = {
        response: { status: 401 },
        config: { url: '/trabajos', headers: {}, _retry: false },
      };
      await expect(resRejected(error)).rejects.toEqual(error);
      expect(localStorage.getItem(PREFIJO + 'accessToken')).toBeNull();
      expect(localStorage.getItem(PREFIJO + 'user')).toBeNull();
    });

    it('impersonando, un 401 devuelve la sesión del superadmin en vez de echar al login', async () => {
      localStorage.setItem(PREFIJO + 'accessToken', 'at-imp');
      localStorage.setItem(PREFIJO + 'user', '{"id":5}');
      localStorage.setItem(PREFIJO + 'imp:accessToken', 'at-super');
      localStorage.setItem(PREFIJO + 'imp:refreshToken', 'rt-super');
      localStorage.setItem(PREFIJO + 'imp:user', '{"id":1}');
      localStorage.setItem(PREFIJO + 'impersonacion', '{"id":5}');
      const error = {
        response: { status: 401 },
        config: { url: '/vehicles', headers: {} },
      };
      await expect(resRejected(error)).rejects.toEqual(error);
      expect(axios.post).not.toHaveBeenCalled();
      expect(localStorage.getItem(PREFIJO + 'accessToken')).toBe('at-super');
      expect(localStorage.getItem(PREFIJO + 'refreshToken')).toBe('rt-super');
      expect(localStorage.getItem(PREFIJO + 'user')).toBe('{"id":1}');
      expect(localStorage.getItem(PREFIJO + 'impersonacion')).toBeNull();
      expect(localStorage.getItem(PREFIJO + 'imp:accessToken')).toBeNull();
    });

    it('un 401 de /auth/impersonacion/fin no restaura ni limpia: eso lo hace AuthContext', async () => {
      localStorage.setItem(PREFIJO + 'accessToken', 'at-imp');
      localStorage.setItem(PREFIJO + 'imp:accessToken', 'at-super');
      localStorage.setItem(PREFIJO + 'imp:refreshToken', 'rt-super');
      localStorage.setItem(PREFIJO + 'impersonacion', '{"id":5}');
      window.location = { pathname: '/perfil', href: '' };
      const error = {
        response: { status: 401 },
        config: { url: '/auth/impersonacion/fin', headers: {} },
      };
      await expect(resRejected(error)).rejects.toEqual(error);
      expect(localStorage.getItem(PREFIJO + 'accessToken')).toBe('at-imp');
      expect(localStorage.getItem(PREFIJO + 'imp:refreshToken')).toBe('rt-super');
      expect(window.location.href).toBe('');
    });

    it('clearAuth no deja la sesión apartada del superadmin', async () => {
      localStorage.setItem(PREFIJO + 'accessToken', 'old');
      localStorage.setItem(PREFIJO + 'imp:refreshToken', 'rt-super');
      const error = {
        response: { status: 401 },
        config: { url: '/trabajos', headers: {} },
      };
      await expect(resRejected(error)).rejects.toEqual(error);
      expect(localStorage.getItem(PREFIJO + 'imp:refreshToken')).toBeNull();
    });

    it('attempts refresh on 401 with refreshToken', async () => {
      localStorage.setItem(PREFIJO + 'refreshToken', 'rt-old');
      localStorage.setItem(PREFIJO + 'accessToken', 'at-old');

      axios.post.mockResolvedValueOnce({
        data: { data: { accessToken: 'at-new', refreshToken: 'rt-new' } },
      });

      // Mock api(originalRequest) retry
      api.mockResolvedValueOnce({ data: { ok: true } });

      const error = {
        response: { status: 401 },
        config: { url: '/trabajos', headers: {}, _retry: false },
      };

      const result = await resRejected(error);
      expect(result).toEqual({ data: { ok: true } });
      expect(localStorage.getItem(PREFIJO + 'accessToken')).toBe('at-new');
      expect(localStorage.getItem(PREFIJO + 'refreshToken')).toBe('rt-new');
    });

    it('clears auth when refresh fails', async () => {
      localStorage.setItem(PREFIJO + 'refreshToken', 'rt-old');
      localStorage.setItem(PREFIJO + 'accessToken', 'at-old');
      localStorage.setItem(PREFIJO + 'user', '{}');

      axios.post.mockRejectedValueOnce(
        Object.assign(new Error('refresh failed'), { response: { status: 401 } }),
      );

      const error = {
        response: { status: 401 },
        config: { url: '/trabajos', headers: {}, _retry: false },
      };

      await expect(resRejected(error)).rejects.toThrow('refresh failed');
      expect(localStorage.getItem(PREFIJO + 'accessToken')).toBeNull();
      expect(localStorage.getItem(PREFIJO + 'refreshToken')).toBeNull();
    });

    it('un 401 de /auth/logout no lanza un refresco (revivía tokens tras cerrar sesión)', async () => {
      axios.post.mockClear();
      localStorage.setItem(PREFIJO + 'refreshToken', 'rt');
      const error = { response: { status: 401 }, config: { url: '/auth/logout', headers: {} } };

      await expect(resRejected(error)).rejects.toBe(error);
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('un 5xx en el refresco (502 durante un deploy) no cierra la sesión', async () => {
      localStorage.setItem(PREFIJO + 'refreshToken', 'rt-old');
      localStorage.setItem(PREFIJO + 'accessToken', 'at-old');
      axios.post.mockRejectedValueOnce(
        Object.assign(new Error('bad gateway'), { response: { status: 502 } }),
      );

      await expect(resRejected({
        response: { status: 401 }, config: { url: '/trabajos', headers: {} },
      })).rejects.toThrow('bad gateway');
      expect(localStorage.getItem(PREFIJO + 'refreshToken')).toBe('rt-old');
    });

    it('el refresco lleva su propio timeout (sin él se colgaba sin cobertura)', async () => {
      localStorage.setItem(PREFIJO + 'refreshToken', 'rt');
      axios.post.mockResolvedValueOnce({
        data: { data: { accessToken: 'at-new', refreshToken: 'rt-new' } },
      });
      api.mockResolvedValueOnce({ data: {} });

      await resRejected({ response: { status: 401 }, config: { url: '/x', headers: {} } });

      const { REFRESH_TIMEOUT_MS } = await import('../../../services/api.js');
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/auth/refresh'),
        { refreshToken: 'rt' },
        { timeout: REFRESH_TIMEOUT_MS },
      );
    });

    it('un refresco sin respuesta (timeout, sin red) no cierra la sesión y libera la cola', async () => {
      axios.post.mockClear();
      localStorage.setItem(PREFIJO + 'refreshToken', 'rt-old');
      localStorage.setItem(PREFIJO + 'accessToken', 'at-old');
      localStorage.setItem(PREFIJO + 'user', '{}');

      axios.post.mockRejectedValueOnce(
        Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' }),
      );
      await expect(resRejected({
        response: { status: 401 }, config: { url: '/trabajos', headers: {} },
      })).rejects.toThrow('timeout');

      expect(localStorage.getItem(PREFIJO + 'accessToken')).toBe('at-old');
      expect(localStorage.getItem(PREFIJO + 'refreshToken')).toBe('rt-old');
      expect(window.location.href).toBe('');

      // El siguiente 401 vuelve a intentar el refresco en vez de encolarse
      // detrás del que falló.
      axios.post.mockResolvedValueOnce({
        data: { data: { accessToken: 'at-new', refreshToken: 'rt-new' } },
      });
      api.mockResolvedValueOnce({ data: { ok: true } });
      const res = await resRejected({
        response: { status: 401 }, config: { url: '/trabajos', headers: {} },
      });
      expect(res).toEqual({ data: { ok: true } });
      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('marca el 429 y añade la espera al mensaje', async () => {
      const error = {
        response: {
          status: 429,
          headers: { 'retry-after': '900' },
          data: { success: false, message: 'Demasiadas solicitudes en poco tiempo.' },
        },
        config: { url: '/vehicles', headers: {} },
      };

      await expect(resRejected(error)).rejects.toBe(error);
      expect(error.esLimiteDePeticiones).toBe(true);
      expect(error.response.data.message).toContain('15 minutos');
    });

    it('no cierra la sesión cuando el refresh devuelve 429', async () => {
      localStorage.setItem(PREFIJO + 'refreshToken', 'rt-old');
      localStorage.setItem(PREFIJO + 'accessToken', 'at-old');
      localStorage.setItem(PREFIJO + 'user', '{}');

      const err429 = Object.assign(new Error('rate limited'), {
        response: { status: 429, headers: {}, data: {} },
      });
      axios.post.mockRejectedValueOnce(err429);

      const error = {
        response: { status: 401 },
        config: { url: '/trabajos', headers: {}, _retry: false },
      };

      await expect(resRejected(error)).rejects.toThrow('rate limited');
      // La sesión sobrevive: el token seguía siendo válido, sólo se cortó el refresco.
      expect(localStorage.getItem(PREFIJO + 'accessToken')).toBe('at-old');
      expect(localStorage.getItem(PREFIJO + 'refreshToken')).toBe('rt-old');
    });

    it('queues requests during refresh', async () => {
      localStorage.setItem(PREFIJO + 'refreshToken', 'rt');

      // First call: triggers refresh
      let resolveRefresh;
      axios.post.mockReturnValueOnce(
        new Promise((r) => { resolveRefresh = r; })
      );

      const error1 = {
        response: { status: 401 },
        config: { url: '/a', headers: {}, _retry: false },
      };
      const error2 = {
        response: { status: 401 },
        config: { url: '/b', headers: {}, _retry: false },
      };

      const p1 = resRejected(error1);
      // Second call while refresh is in progress → queued
      const p2 = resRejected(error2);

      // Resolve the refresh
      api.mockResolvedValue({ data: { ok: true } });
      resolveRefresh({
        data: { data: { accessToken: 'new-at', refreshToken: 'new-rt' } },
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual({ data: { ok: true } });
      expect(r2).toEqual({ data: { ok: true } });
    });
  });

  describe('clearAuth', () => {
    it('does not redirect if already on /login', async () => {
      delete window.location;
      window.location = { pathname: '/login', href: '' };

      const error = {
        response: { status: 401 },
        config: { url: '/data', headers: {}, _retry: false },
      };

      await expect(resRejected(error)).rejects.toEqual(error);
      // href should not have been changed
      expect(window.location.href).toBe('');
    });
  });
});

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
      localStorage.setItem('accessToken', 'test-token');
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
      localStorage.setItem('accessToken', 'old');
      localStorage.setItem('user', '{}');
      // No refreshToken set
      const error = {
        response: { status: 401 },
        config: { url: '/trabajos', headers: {}, _retry: false },
      };
      await expect(resRejected(error)).rejects.toEqual(error);
      expect(localStorage.getItem('accessToken')).toBeNull();
      expect(localStorage.getItem('user')).toBeNull();
    });

    it('attempts refresh on 401 with refreshToken', async () => {
      localStorage.setItem('refreshToken', 'rt-old');
      localStorage.setItem('accessToken', 'at-old');

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
      expect(localStorage.getItem('accessToken')).toBe('at-new');
      expect(localStorage.getItem('refreshToken')).toBe('rt-new');
    });

    it('clears auth when refresh fails', async () => {
      localStorage.setItem('refreshToken', 'rt-old');
      localStorage.setItem('accessToken', 'at-old');
      localStorage.setItem('user', '{}');

      axios.post.mockRejectedValueOnce(new Error('refresh failed'));

      const error = {
        response: { status: 401 },
        config: { url: '/trabajos', headers: {}, _retry: false },
      };

      await expect(resRejected(error)).rejects.toThrow('refresh failed');
      expect(localStorage.getItem('accessToken')).toBeNull();
      expect(localStorage.getItem('refreshToken')).toBeNull();
    });

    it('queues requests during refresh', async () => {
      localStorage.setItem('refreshToken', 'rt');

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

'use strict';

const request = require('supertest');
const express = require('express');
const {
  apiLimiter, loginLimiter, refreshLimiter, uploadLimiter, claveCliente,
} = require('../../../middleware/rateLimiter.middleware');
const { generateAccessToken, generateRefreshToken } = require('../../../utils/jwt.utils');

const tokenDe = (id) => generateAccessToken({ id, username: `u${id}`, roles: [] });

describe('rateLimiter.middleware', () => {
  it('exports all limiters as functions', () => {
    expect(typeof apiLimiter).toBe('function');
    expect(typeof loginLimiter).toBe('function');
    expect(typeof refreshLimiter).toBe('function');
    expect(typeof uploadLimiter).toBe('function');
  });

  it('limiters have middleware signature (req, res, next)', () => {
    // Express middleware is a function with length 3
    expect(apiLimiter.length).toBeLessThanOrEqual(3);
    expect(loginLimiter.length).toBeLessThanOrEqual(3);
  });

  describe('claveCliente', () => {
    it('usa el id del usuario cuando el access token es válido', () => {
      const req = { headers: { authorization: `Bearer ${tokenDe(42)}` }, ip: '1.2.3.4' };
      expect(claveCliente(req)).toBe('u:42');
    });

    it('cae a la IP si el token no es válido', () => {
      const req = { headers: { authorization: 'Bearer basura' }, ip: '1.2.3.4' };
      expect(claveCliente(req)).toBe('ip:1.2.3.4');
    });

    it('no acepta un refresh token como identidad', () => {
      const { token } = generateRefreshToken();
      const req = { headers: { authorization: `Bearer ${token}` }, ip: '1.2.3.4' };
      expect(claveCliente(req)).toBe('ip:1.2.3.4');
    });

    it('desenvuelve las IPv4 mapeadas a IPv6', () => {
      expect(claveCliente({ headers: {}, ip: '::ffff:83.32.32.196' })).toBe('ip:83.32.32.196');
    });

    it('agrupa las IPv6 por prefijo /64', () => {
      const a = claveCliente({ headers: {}, ip: '2a02:9130:88c1:2b00:1c2b:9aff:fe12:3456' });
      const b = claveCliente({ headers: {}, ip: '2a02:9130:88c1:2b00:aaaa:bbbb:cccc:dddd' });
      expect(a).toBe(b);
      expect(a).toBe('ip:2a02:9130:88c1:2b00::/64');
    });
  });

  describe('apiLimiter', () => {
    // Dos usuarios detrás de la misma IP pública (oficina, NAT del operador):
    // el cupo de uno no puede tumbar al otro. Este era el fallo real.
    it('no mezcla el cupo de dos usuarios que comparten IP', async () => {
      const app = express();
      app.set('trust proxy', true);
      app.use(apiLimiter);
      app.get('/', (_req, res) => res.json({ ok: true }));

      const comoUsuario = (id) => request(app)
        .get('/')
        .set('Authorization', `Bearer ${tokenDe(id)}`)
        .set('X-Forwarded-For', '83.32.32.196');

      const primera  = await comoUsuario(1);
      const segunda  = await comoUsuario(1);
      const deOtro   = await comoUsuario(2);

      expect(primera.status).toBe(200);
      expect(segunda.status).toBe(200);
      expect(deOtro.status).toBe(200);
      // El segundo usuario estrena cupo en lugar de heredar el consumo del primero.
      expect(Number(segunda.headers['ratelimit-remaining']))
        .toBeLessThan(Number(primera.headers['ratelimit-remaining']));
      expect(deOtro.headers['ratelimit-remaining'])
        .toBe(primera.headers['ratelimit-remaining']);
    });

    it('da al usuario autenticado un cupo mayor que al anónimo', async () => {
      const app = express();
      app.use(apiLimiter);
      app.get('/', (_req, res) => res.json({ ok: true }));

      const auth  = await request(app).get('/').set('Authorization', `Bearer ${tokenDe(7)}`);
      const anon  = await request(app).get('/');

      expect(Number(auth.headers['ratelimit-limit']))
        .toBeGreaterThan(Number(anon.headers['ratelimit-limit']));
    });
  });
});

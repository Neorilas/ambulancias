'use strict';

const {
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  verifyAccessToken,
  decodeToken,
  refreshTokenExpiresAt,
} = require('../../../utils/jwt.utils');

describe('jwt.utils', () => {
  const payload = { id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_users'] };

  describe('generateAccessToken', () => {
    it('returns a JWT string', () => {
      const token = generateAccessToken(payload);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('contains correct payload fields', () => {
      const token = generateAccessToken(payload);
      const decoded = decodeToken(token);
      expect(decoded.sub).toBe(1);
      expect(decoded.username).toBe('admin');
      expect(decoded.roles).toEqual(['administrador']);
      expect(decoded.type).toBe('access');
      expect(decoded.jti).toBeDefined();
    });
  });

  describe('verifyAccessToken', () => {
    it('verifies a valid token', () => {
      const token = generateAccessToken(payload);
      const decoded = verifyAccessToken(token);
      expect(decoded.sub).toBe(1);
      expect(decoded.username).toBe('admin');
    });

    it('throws for invalid token', () => {
      expect(() => verifyAccessToken('invalid.token.here')).toThrow();
    });

    it('throws for tampered token', () => {
      const token = generateAccessToken(payload);
      const tampered = token.slice(0, -5) + 'XXXXX';
      expect(() => verifyAccessToken(tampered)).toThrow();
    });
  });

  describe('generateRefreshToken', () => {
    it('returns token and tokenHash', () => {
      const result = generateRefreshToken();
      expect(typeof result.token).toBe('string');
      expect(typeof result.tokenHash).toBe('string');
      expect(result.token).toContain('-');
      expect(result.tokenHash).toHaveLength(64); // SHA-256 hex
    });

    it('hash matches hashRefreshToken output', () => {
      const { token, tokenHash } = generateRefreshToken();
      expect(hashRefreshToken(token)).toBe(tokenHash);
    });
  });

  describe('hashRefreshToken', () => {
    it('produces consistent SHA-256 hash', () => {
      const input = 'test-token-value';
      const hash1 = hashRefreshToken(input);
      const hash2 = hashRefreshToken(input);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });
  });

  describe('decodeToken', () => {
    it('decodes without verification', () => {
      const token = generateAccessToken(payload);
      const decoded = decodeToken(token);
      expect(decoded.sub).toBe(1);
    });

    it('returns null for garbage input', () => {
      expect(decodeToken('not-a-token')).toBeNull();
    });
  });

  describe('refreshTokenExpiresAt', () => {
    it('returns a date in the future', () => {
      const date = refreshTokenExpiresAt();
      expect(date).toBeInstanceOf(Date);
      expect(date.getTime()).toBeGreaterThan(Date.now());
    });
  });
});

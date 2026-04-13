'use strict';

const { hashPassword, comparePassword, validatePasswordStrength } = require('../../../utils/password.utils');

describe('password.utils', () => {
  describe('hashPassword', () => {
    it('returns a bcrypt hash', async () => {
      const hash = await hashPassword('TestPass123');
      expect(typeof hash).toBe('string');
      expect(hash.startsWith('$2a$') || hash.startsWith('$2b$')).toBe(true);
    });
  });

  describe('comparePassword', () => {
    it('returns true for matching password', async () => {
      const hash = await hashPassword('MyPassword1');
      const result = await comparePassword('MyPassword1', hash);
      expect(result).toBe(true);
    });

    it('returns false for wrong password', async () => {
      const hash = await hashPassword('MyPassword1');
      const result = await comparePassword('WrongPass', hash);
      expect(result).toBe(false);
    });
  });

  describe('validatePasswordStrength', () => {
    it('returns valid for 8+ chars', () => {
      const result = validatePasswordStrength('12345678');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns invalid for short password', () => {
      const result = validatePasswordStrength('short');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns invalid for null/empty', () => {
      expect(validatePasswordStrength(null).valid).toBe(false);
      expect(validatePasswordStrength('').valid).toBe(false);
    });
  });
});

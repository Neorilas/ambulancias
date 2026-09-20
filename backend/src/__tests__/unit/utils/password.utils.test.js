'use strict';

const { hashPassword, comparePassword, validatePasswordStrength, generatePassword } = require('../../../utils/password.utils');

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
    it('returns valid for 10+ chars with two character classes', () => {
      const result = validatePasswordStrength('Contrasena1');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns invalid for short password', () => {
      const result = validatePasswordStrength('short');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns invalid for a single character class', () => {
      const result = validatePasswordStrength('aaaaaaaaaaaa');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Combina al menos dos tipos: minúsculas, mayúsculas, números o símbolos');
    });

    it('rejects a password containing the username', () => {
      const result = validatePasswordStrength('Tecnico12345', { username: 'tecnico' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No puede contener el usuario');
    });

    it('rejects a password containing the dni', () => {
      const result = validatePasswordStrength('X12345678Za', { dni: '12345678Z' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No puede contener el DNI');
    });

    it('ignores an empty context', () => {
      expect(validatePasswordStrength('Contrasena1', { username: '', dni: null }).valid).toBe(true);
    });

    it('returns invalid for null/empty', () => {
      expect(validatePasswordStrength(null).valid).toBe(false);
      expect(validatePasswordStrength('').valid).toBe(false);
    });
  });

  describe('generatePassword', () => {
    it('devuelve 12 caracteres', () => {
      expect(generatePassword()).toHaveLength(12);
    });

    it('garantiza las cuatro clases de carácter', () => {
      // Con 50 intentos, una clase que faltase por azar saldría aquí.
      for (let i = 0; i < 50; i++) {
        const pw = generatePassword();
        expect(pw).toMatch(/[A-Z]/);
        expect(pw).toMatch(/[a-z]/);
        expect(pw).toMatch(/[0-9]/);
        expect(pw).toMatch(/[!@#$%&*.]/);
      }
    });

    it('excluye los caracteres ambiguos: quien la dicta por teléfono no se equivoca', () => {
      for (let i = 0; i < 50; i++) {
        expect(generatePassword()).not.toMatch(/[0O1lI]/);
      }
    });

    it('lo que genera siempre pasa su propio validador', () => {
      for (let i = 0; i < 50; i++) {
        expect(validatePasswordStrength(generatePassword()).valid).toBe(true);
      }
    });

    it('no repite: dos llamadas seguidas dan contraseñas distintas', () => {
      const generadas = new Set(Array.from({ length: 50 }, () => generatePassword()));
      expect(generadas.size).toBe(50);
    });

    it('las clases garantizadas no quedan siempre en las mismas posiciones', () => {
      // El sort de mezcla existe justo para esto: si no barajara, las cuatro
      // primeras posiciones serían siempre mayúscula-minúscula-dígito-símbolo.
      const enOrden = Array.from({ length: 50 }, () => generatePassword())
        .filter(pw => /^[A-Z][a-z][0-9][!@#$%&*.]/.test(pw));
      expect(enOrden.length).toBeLessThan(50);
    });
  });
});

'use strict';

/**
 * Tests de utils/motivo.utils.js — regla del motivo de fin anticipado.
 * El frontend tiene su espejo (utils/motivo.js) con el mismo criterio.
 */

const { errorMotivo, MOTIVO_MIN_CARACTERES } = require('../../../utils/motivo.utils');

describe('errorMotivo', () => {
  it('acepta un motivo de verdad', () => {
    expect(errorMotivo('Paciente trasladado')).toBeNull();
    expect(errorMotivo('  Lluvia ')).toBeNull();
    expect(errorMotivo('12345')).toBeNull();
  });

  it(`pide al menos ${MOTIVO_MIN_CARACTERES} caracteres, sin contar los espacios de los extremos`, () => {
    expect(errorMotivo('Avís')).toMatch(/al menos 5/);
    expect(errorMotivo('   Avís   ')).toMatch(/al menos 5/);
    expect(errorMotivo('     ')).toMatch(/al menos 5/);
    expect(errorMotivo('')).toMatch(/al menos 5/);
  });

  it('no acepta lo que no es texto', () => {
    expect(errorMotivo(undefined)).toMatch(/al menos 5/);
    expect(errorMotivo(null)).toMatch(/al menos 5/);
    expect(errorMotivo(12345)).toMatch(/al menos 5/);
  });

  it('rechaza un mismo carácter repetido, con espacios o mayúsculas de por medio', () => {
    expect(errorMotivo('aaaaa')).toMatch(/motivo válido/);
    expect(errorMotivo('aaaaaaaaaa')).toMatch(/motivo válido/);
    expect(errorMotivo('a a a a a')).toMatch(/motivo válido/);
    expect(errorMotivo('AaAaA')).toMatch(/motivo válido/);
    expect(errorMotivo('.....')).toMatch(/motivo válido/);
  });
});

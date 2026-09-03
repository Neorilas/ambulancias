import { describe, it, expect } from 'vitest';
import { esMatricula, normalizarMatricula } from '../../../utils/matricula.js';

// Este helper existe porque la flota se dio de alta con el nombre de la
// ambulancia en el campo de matrícula. Es la comprobación que impide que el
// formulario vuelva a aceptarlo.
describe('normalizarMatricula', () => {
  it('quita separadores y pasa a mayúsculas', () => {
    expect(normalizarMatricula('1234 bcd')).toBe('1234BCD');
    expect(normalizarMatricula('1234-BCD')).toBe('1234BCD');
    expect(normalizarMatricula(' m 1234 ab ')).toBe('M1234AB');
  });

  it('tolera vacíos', () => {
    expect(normalizarMatricula(null)).toBe('');
    expect(normalizarMatricula(undefined)).toBe('');
    expect(normalizarMatricula('')).toBe('');
  });
});

describe('esMatricula', () => {
  it('acepta el formato actual, con o sin separador', () => {
    expect(esMatricula('1234BCD')).toBe(true);
    expect(esMatricula('1234 bcd')).toBe(true);
  });

  it('acepta el formato anterior a 2000', () => {
    expect(esMatricula('M1234AB')).toBe(true);
    expect(esMatricula('SE 1234 A')).toBe(true);
  });

  it('rechaza un nombre de ambulancia', () => {
    expect(esMatricula('Ambulancia 1')).toBe(false);
    expect(esMatricula('SVB 12')).toBe(false);
    expect(esMatricula('UVI MOVIL')).toBe(false);
  });

  it('rechaza vocales en el bloque de letras del formato actual', () => {
    // Las matrículas actuales no usan vocales ni Ñ ni Q.
    expect(esMatricula('1234AEI')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { parseKm } from '../../../utils/kmUtils.js';

// El "." se usa como separador de miles en español: si no se quita antes de
// parsear, `parseInt("45.000")` corta en el punto y da 45 en vez de 45000.
describe('parseKm', () => {
  it('quita el punto de miles antes de parsear', () => {
    expect(parseKm('45.000')).toBe(45000);
    expect(parseKm('1.234.567')).toBe(1234567);
  });

  it('parsea un número sin punto tal cual', () => {
    expect(parseKm('45000')).toBe(45000);
    expect(parseKm(45000)).toBe(45000);
  });

  it('vacío o nulo es "sin lectura", no cero', () => {
    expect(parseKm('')).toBeNull();
    expect(parseKm(null)).toBeNull();
    expect(parseKm(undefined)).toBeNull();
  });

  it('devuelve null si no queda nada parseable', () => {
    expect(parseKm('.')).toBeNull();
    expect(parseKm('abc')).toBeNull();
  });
});

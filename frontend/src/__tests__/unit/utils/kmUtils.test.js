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

  // No todo punto es separador de miles: un decimal mal tecleado no debe
  // colarse como otro número. "4.5" no es "45" — es un dato inválido.
  it('no confunde un decimal con un separador de miles', () => {
    expect(parseKm('4.5')).toBeNull();
    expect(parseKm('45.00')).toBe(45);   // 45.00 SÍ es entero (45), no es el caso a rechazar
    expect(parseKm('45.5')).toBeNull();
  });
});

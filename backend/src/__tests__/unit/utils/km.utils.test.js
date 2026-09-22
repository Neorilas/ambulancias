'use strict';

/**
 * Tests de utils/km.utils.js
 *
 * `limpiarMilesKm` es la defensa del backend para el "." de miles en
 * español («45.000») que puede llegar desde un cliente distinto al
 * frontend propio (API directa, futuros clientes de Trabajos, etc.); el
 * frontend tiene su espejo (`parseKm`) con el mismo criterio.
 */

const { limpiarMilesKm } = require('../../../utils/km.utils');

describe('limpiarMilesKm', () => {
  it('quita el punto cuando es separador de miles', () => {
    expect(limpiarMilesKm('45.000')).toBe('45000');
    expect(limpiarMilesKm('1.234.567')).toBe('1234567');
  });

  it('no toca un decimal mal tecleado: no es separador de miles', () => {
    expect(limpiarMilesKm('4.5')).toBe('4.5');    // isInt() lo rechazará después, no aquí
    expect(limpiarMilesKm('45.5')).toBe('45.5');
  });

  it('deja pasar lo que no sea cadena (número, null, undefined) sin tocar', () => {
    expect(limpiarMilesKm(45000)).toBe(45000);
    expect(limpiarMilesKm(null)).toBeNull();
    expect(limpiarMilesKm(undefined)).toBeUndefined();
  });
});

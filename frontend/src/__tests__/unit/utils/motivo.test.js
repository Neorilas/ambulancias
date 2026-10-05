import { describe, it, expect } from 'vitest';
import { errorMotivo } from '../../../utils/motivo.js';

// Espejo de backend utils/motivo.utils.js: mismo criterio en los dos lados.
describe('errorMotivo', () => {
  it('acepta un motivo de verdad', () => {
    expect(errorMotivo('Traslado cancelado')).toBeNull();
    expect(errorMotivo('  Lluvia ')).toBeNull();
  });

  it('pide al menos 5 caracteres, sin contar los espacios de los extremos', () => {
    expect(errorMotivo('Avís')).toMatch(/al menos 5/);
    expect(errorMotivo('     ')).toMatch(/al menos 5/);
    expect(errorMotivo(undefined)).toMatch(/al menos 5/);
  });

  it('rechaza un mismo carácter repetido', () => {
    expect(errorMotivo('aaaaa')).toMatch(/motivo válido/);
    expect(errorMotivo('a a a a a')).toMatch(/motivo válido/);
    expect(errorMotivo('AaAaA')).toMatch(/motivo válido/);
  });
});

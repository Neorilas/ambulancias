import { describe, it, expect } from 'vitest';
import { avisosInventario, cantidadEscrita, filtrarLineas, nombreAmbulancia, productoExacto } from '../../../utils/inventario.js';

const CATALOGO = [{ id: 1, nombre: 'Mascarilla laríngea 4' }, { id: 2, nombre: 'Guedel 3' }];

describe('utils/inventario', () => {
  it('productoExacto: mismo nombre sin mirar mayúsculas, tildes ni espacios', () => {
    expect(productoExacto(CATALOGO, '  mascarilla   laringea 4 ')).toEqual(CATALOGO[0]);
    expect(productoExacto(CATALOGO, 'Guedel')).toBeNull();
    expect(productoExacto(CATALOGO, '')).toBeNull();
    expect(productoExacto(null, 'Guedel 3')).toBeNull();
  });

  it('filtrarLineas: todas las palabras, sin tildes', () => {
    const lineas = [{ nombre: 'Manta térmica' }, { nombre: 'Guedel 3' }];
    expect(filtrarLineas(lineas, 'TERM manta')).toEqual([lineas[0]]);
    expect(filtrarLineas(lineas, '  ')).toBe(lineas);
  });

  it('avisosInventario: lo que está a 0 cuenta como agotado, no como caducado', () => {
    const hoy = '2026-11-19';
    expect(avisosInventario([
      { cantidad: 2, caducidad: '2026-11-01' },
      { cantidad: 1, caducidad: '2026-12-01' },
      { cantidad: 0, caducidad: '2020-01-01' },
      { cantidad: 5, caducidad: null },
      { cantidad: 5, caducidad: '2030-01-01' },
    ], hoy)).toEqual({ caducado: 1, pronto: 1, agotado: 1 });
  });

  it('cantidadEscrita: enteros desde el mínimo', () => {
    expect(cantidadEscrita(' 3 ')).toBe(3);
    expect(cantidadEscrita('0')).toBeNull();
    expect(cantidadEscrita('0', 0)).toBe(0);
    expect(cantidadEscrita('1.5')).toBeNull();
    expect(cantidadEscrita('-1', 0)).toBeNull();
    expect(cantidadEscrita('200000')).toBeNull();
  });

  it('nombreAmbulancia', () => {
    expect(nombreAmbulancia({ alias: 'UVI-03', matricula: '1234ABC' })).toBe('UVI-03 · 1234ABC');
    expect(nombreAmbulancia({ alias: null, matricula: '1234ABC' })).toBe('1234ABC');
  });
});

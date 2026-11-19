import { describe, it, expect } from 'vitest';
import {
  CADUCA_PRONTO_DIAS, bajoMinimo, cantidadConSigno, claseCaducidad, destinoMovimiento, diasHasta,
  estadoCaducidad, filtrarProductos, filtroMovimientos, hoyEnEspana, paramsMovimientos, normalizar, resumenAvisos, textoCaducidad,
} from '../../../utils/almacen.js';

const HOY = '2026-11-18';
const P = (o) => ({ id: 1, nombre: 'X', tipo: 'producto', stock: 10, stock_minimo: 0, activo: true,
  proxima_caducidad: null, lotes_negativos: 0, ...o });

describe('utils/almacen', () => {
  it('hoyEnEspana usa el día español, no el UTC', () => {
    // 23:30 UTC del 18 = 00:30 del 19 en España (invierno)
    expect(hoyEnEspana(new Date('2026-11-18T23:30:00Z'))).toBe('2026-11-19');
  });

  it('diasHasta cuenta días enteros', () => {
    expect(diasHasta('2026-11-20', HOY)).toBe(2);
    expect(diasHasta('2026-11-17', HOY)).toBe(-1);
    expect(diasHasta(null, HOY)).toBeNull();
  });

  it('estadoCaducidad y su color', () => {
    expect(estadoCaducidad('2026-11-17', HOY)).toBe('caducado');
    expect(estadoCaducidad('2026-11-18', HOY)).toBe('pronto');
    expect(estadoCaducidad(`2027-0${1}-17`, HOY)).toBe('pronto');   // 60 días justos
    expect(diasHasta('2027-01-17', HOY)).toBe(CADUCA_PRONTO_DIAS);
    expect(estadoCaducidad('2027-01-18', HOY)).toBe('ok');
    expect(estadoCaducidad(null, HOY)).toBeNull();
    expect(claseCaducidad('2026-11-17', HOY)).toContain('text-bad-600');
    expect(claseCaducidad('2026-12-01', HOY)).toContain('text-warn-700');
    expect(claseCaducidad('2030-01-01', HOY)).toBe('text-neutral-700');
  });

  it('textoCaducidad', () => {
    expect(textoCaducidad(null, HOY)).toBe('No caduca');
    expect(textoCaducidad('2026-11-17', HOY)).toBe('caducado hace 1 día');
    expect(textoCaducidad('2026-11-08', HOY)).toBe('caducado hace 10 días');
    expect(textoCaducidad('2026-11-18', HOY)).toBe('caduca hoy');
    expect(textoCaducidad('2026-11-19', HOY)).toBe('caduca en 1 día');
    expect(textoCaducidad('2026-11-28', HOY)).toBe('caduca en 10 días');
  });

  it('bajoMinimo: un mínimo 0 es «sin mínimo»', () => {
    expect(bajoMinimo(P({ stock: 4, stock_minimo: 5 }))).toBe(true);
    expect(bajoMinimo(P({ stock: 5, stock_minimo: 5 }))).toBe(false);
    expect(bajoMinimo(P({ stock: 0, stock_minimo: 0 }))).toBe(false);
  });

  it('normalizar quita tildes y mayúsculas', () => {
    expect(normalizar('Máscarilla Laríngea')).toBe('mascarilla laringea');
    expect(normalizar(null)).toBe('');
  });

  describe('filtrarProductos', () => {
    const lista = [
      P({ id: 1, nombre: 'Máscarilla laringea 4', stock: 2, stock_minimo: 5 }),
      P({ id: 2, nombre: 'Adiro', tipo: 'medicacion', proxima_caducidad: '2026-12-01' }),
      P({ id: 3, nombre: 'Guantes M', stock: 0 }),
      P({ id: 4, nombre: 'Viejo', activo: false, stock: 0, stock_minimo: 3 }),
      P({ id: 5, nombre: 'Tubo OIT 7', lotes_negativos: 1, proxima_caducidad: '2026-11-01' }),
    ];
    const ids = (f) => filtrarProductos(lista, f, HOY).map(p => p.id);

    it('busca por palabras sin tildes y esconde los retirados', () => {
      expect(ids({ q: 'mascarilla 4' })).toEqual([1]);
      expect(ids({})).toEqual([1, 2, 3, 5]);
      expect(ids({ retirados: true })).toEqual([1, 2, 3, 4, 5]);
    });
    it('por tipo y por aviso', () => {
      expect(ids({ tipo: 'medicacion' })).toEqual([2]);
      expect(ids({ estado: 'minimo', retirados: true })).toEqual([1]);   // el retirado no avisa
      expect(ids({ estado: 'caducidad' })).toEqual([2, 5]);
      expect(ids({ estado: 'agotado' })).toEqual([3]);
      expect(ids({ estado: 'descuadre' })).toEqual([5]);
    });
    it('resumenAvisos cuenta cada aviso', () => {
      expect(resumenAvisos(lista, HOY)).toEqual({ minimo: 1, caducidad: 2, agotado: 1, descuadre: 1 });
    });
  });

  it('destinoMovimiento', () => {
    expect(destinoMovimiento({ tipo: 'salida_ambulancia', vehiculo_alias: 'UVI-03' })).toBe('UVI-03');
    expect(destinoMovimiento({ tipo: 'salida_ambulancia', vehiculo_matricula: '1234ABC' })).toBe('1234ABC');
    expect(destinoMovimiento({ tipo: 'salida_ambulancia', destino: 'UVI-7' })).toBe('UVI-7');
    expect(destinoMovimiento({ tipo: 'salida_ambulancia' })).toBe('Ambulancia');
    expect(destinoMovimiento({ tipo: 'salida_otros', destino: 'Obra' })).toBe('Obra');
    expect(destinoMovimiento({ tipo: 'salida_otros' })).toBe('—');
    expect(destinoMovimiento({ tipo: 'entrada' })).toBe('');
  });

  it('cantidadConSigno', () => {
    expect(cantidadConSigno(10)).toBe('+10');
    expect(cantidadConSigno(-3)).toBe('−3');
    expect(cantidadConSigno(0)).toBe('0');
  });

  it('filtroMovimientos solo deja los filtros que cuelgan de lo elegido', () => {
    expect(filtroMovimientos({})).toEqual({ tipo: '', destino: '', ambulancia: '', buscar: '' });
    // destino sin Salida, ambulancia sin «A ambulancia», texto sin «A otro sitio»: fuera
    expect(filtroMovimientos({ tipo: 'entrada', destino: 'otros', ambulancia: '7', buscar: 'obra' }))
      .toEqual({ tipo: 'entrada', destino: '', ambulancia: '', buscar: '' });
    expect(filtroMovimientos({ tipo: 'salida', destino: 'enfermeria', ambulancia: '7', buscar: 'x' }))
      .toEqual({ tipo: 'salida', destino: 'enfermeria', ambulancia: '', buscar: '' });
    expect(filtroMovimientos({ tipo: 'salida', destino: 'ambulancia', ambulancia: '7' }).ambulancia).toBe('7');
    expect(filtroMovimientos({ tipo: 'salida', destino: 'otros', buscar: '  obra ' }).buscar).toBe('obra');
    // valores que no existen
    expect(filtroMovimientos({ tipo: 'robo' }).tipo).toBe('');
    expect(filtroMovimientos({ tipo: 'salida', destino: 'luna' }).destino).toBe('');
  });

  it('filtroMovimientos traduce los enlaces viejos con el tipo exacto', () => {
    expect(filtroMovimientos({ tipo: 'salida_ambulancia', ambulancia: '7' }))
      .toEqual({ tipo: 'salida', destino: 'ambulancia', ambulancia: '7', buscar: '' });
    expect(filtroMovimientos({ tipo: 'salida_otros' })).toMatchObject({ tipo: 'salida', destino: 'otros' });
  });

  it('paramsMovimientos pasa la ambulancia como vehicle_id', () => {
    expect(paramsMovimientos({ tipo: 'salida', destino: 'ambulancia', ambulancia: '7' }))
      .toEqual({ tipo: 'salida', destino: 'ambulancia', vehicle_id: '7', buscar: '' });
  });
});

import { describe, it, expect } from 'vitest';
import {
  buscarProductos, textoMaterial, materialCompleto, cuerpoMaterial, presentacionVisible, SIN_GASTO, MATERIAL_VACIO,
} from '../../../utils/materialGastado.js';

const CATALOGO = [
  { id: 1, nombre: 'Suero fisiológico 500 ml', presentacion: 'Unidad' },
  { id: 2, nombre: 'Mascarilla FFP2', presentacion: 'Unidad' },
  { id: 3, nombre: 'Cánula Guedel', presentacion: 'Unidad' },
  { id: 4, nombre: 'Agua para suero', presentacion: 'Ampolla' },
  ...Array.from({ length: 10 }, (_, i) => ({ id: 10 + i, nombre: `Venda ${i}`, presentacion: 'Unidad' })),
];

describe('buscarProductos', () => {
  it('no busca con menos de dos letras', () => {
    expect(buscarProductos(CATALOGO, 's')).toEqual([]);
    expect(buscarProductos(CATALOGO, '  ')).toEqual([]);
  });

  it('sin tildes y con varias palabras en cualquier orden', () => {
    expect(buscarProductos(CATALOGO, 'canula').map(p => p.id)).toEqual([3]);
    expect(buscarProductos(CATALOGO, 'ml suero').map(p => p.id)).toEqual([1]);
  });

  it('primero los que empiezan por lo buscado', () => {
    expect(buscarProductos(CATALOGO, 'suero').map(p => p.id)).toEqual([1, 4]);
  });

  it('como mucho cinco y sin los ya elegidos', () => {
    expect(buscarProductos(CATALOGO, 'venda')).toHaveLength(5);
    const elegidos = [{ producto_id: 1 }];
    expect(buscarProductos(CATALOGO, 'suero', elegidos).map(p => p.id)).toEqual([4]);
  });
});

describe('texto y cuerpo del material', () => {
  const items = [
    { producto_id: 2, nombre: 'Mascarilla FFP2', presentacion: 'Unidad', cantidad: 3 },
    { producto_id: 4, nombre: 'Agua para suero', presentacion: 'Ampolla', cantidad: 1 },
  ];

  it('«No» es «Sin gasto de material» y no manda productos', () => {
    const m = { ...MATERIAL_VACIO, gasto: 'no' };
    expect(materialCompleto(m)).toBe(true);
    expect(textoMaterial(m)).toBe(SIN_GASTO);
    expect(cuerpoMaterial(m)).toEqual({ material_usado: SIN_GASTO });
  });

  it('«Sí» necesita algún producto o algo escrito', () => {
    expect(materialCompleto(MATERIAL_VACIO)).toBe(false);
    expect(materialCompleto({ ...MATERIAL_VACIO, gasto: 'si' })).toBe(false);
    expect(materialCompleto({ ...MATERIAL_VACIO, gasto: 'si', libre: '  ' })).toBe(false);
    expect(materialCompleto({ ...MATERIAL_VACIO, gasto: 'si', libre: 'vendas' })).toBe(true);
    expect(materialCompleto({ ...MATERIAL_VACIO, gasto: 'si', items })).toBe(true);
  });

  it('una línea por producto, como el backend, y lo escrito debajo', () => {
    const m = { ...MATERIAL_VACIO, gasto: 'si', items, libre: ' manta ' };
    expect(textoMaterial(m)).toBe('3 × Mascarilla FFP2\n1 × Agua para suero (Ampolla)\nmanta');
    expect(cuerpoMaterial(m)).toEqual({
      material_usado: 'manta',
      material_items: [{ producto_id: 2, cantidad: 3 }, { producto_id: 4, cantidad: 1 }],
    });
  });

  it('la presentación «Unidad» no se enseña', () => {
    expect(presentacionVisible({ presentacion: 'unidad' })).toBe('');
    expect(presentacionVisible({ presentacion: ' Caja ' })).toBe('Caja');
    expect(presentacionVisible({})).toBe('');
  });
});

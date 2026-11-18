'use strict';

/**
 * Tests de services/importacionAlmacen.service.js: la limpieza del AppSheet
 * «AmbulanciaDB». Los casos salen de lo que tiene la hoja real (2026-11-18),
 * con datos inventados.
 */

process.env.TZ = 'Europe/Madrid';

const imp = require('../../../services/importacionAlmacen.service');

const PRODUCTOS = [
  'IDProducto,Nombre,Presentación ,Stock Mínimo,Tipo',
  'aaaa0001,Guedel 3,Unidad,20,Productos',
  'aaaa0002,Adiro,Pastillas,,Medicacion',
  ',,,,',
  'aaaa0003,Máscarilla laringea 4,Unidad,10,Productos',
  'aaaa0004,Mascarilla laringea 4,Unidad,5,Productos',
  'aaaa0001,Guedel 3 repetido,Unidad,1,Productos',
  'aaaa0005,,Unidad,1,Productos',
].join('\r\n');

const STOCK = [
  'IDStock,Producto,Caducidad,',
  'aaaa0001-10/31/2028,aaaa0001,31/10/2028,',
  // clave aleatoria: el producto sale de la columna, no del prefijo
  'f00dbabe,aaaa0002,,',
  'aaaa0002-06/01/2099,aaaa0002,01/06/2099,',
  // la clave dice 2029 y la columna 2028: manda la columna
  'aaaa0003-06/30/2029,aaaa0003,30/06/2028,',
  'bbbb9999-01/01/2027,bbbb9999,01/01/2027,',
  'aaaa0004-x,aaaa0004,31/02/2028,',
].join('\n');

const MOVS = [
  'Movimiento,Fecha ,Tipo,Lote,Cantidad,Destino,Otros,Usuario',
  'm1,01/06/2026 12:01:48,Entrada,aaaa0001-10/31/2028,30,,,Jefe@Empresa.es',
  'm2,02/06/2026,Retirada UVI,aaaa0001-10/31/2028,2,UVI-03,,otro@example.com',
  'm3,03/06/2026 09:00:00,Retirada UVI,aaaa0001-10/31/2028,1,UVI-7,,',
  'm4,03/06/2026 09:00:00,Retirada Otros,f00dbabe,6000,,"Botiquín, boxeo",jefe@empresa.es',
  'm5,03/06/2026 09:00:00,Retirada Otros,f00dbabe,1,,…,jefe@empresa.es',
  'm6,03/06/2026 09:00:00,Descarte,aaaa0003-06/30/2029,1,,,jefe@empresa.es',
  'm7,03/06/2026,Retirada UVI,,1,UVI-01,,jefe@empresa.es',
  'm8,03/06/2026,Entrada,zzzz,1,,,jefe@empresa.es',
  'm9,03/06/2026,Entrada,f00dbabe,,,,jefe@empresa.es',
  'm10,03/06/2026,Entrada,f00dbabe,-1,,,jefe@empresa.es',
  'm11,03/06/2026,Regalo,f00dbabe,1,,,jefe@empresa.es',
  'm12,ayer,Entrada,f00dbabe,1,,,jefe@empresa.es',
  // lotes borrados de Stock: se rehacen desde la clave si el producto existe
  'm13,04/06/2026,Entrada,aaaa0002-12/31/2026,2,,,jefe@empresa.es',
  'm14,04/06/2026,Entrada,aaaa0001-,5,,,jefe@empresa.es',
  'm15,04/06/2026,Entrada,bbbb9999-12/31/2026,1,,,jefe@empresa.es',
  'm16,04/06/2026,Entrada,aaaa0001-13/45/2026,1,,,jefe@empresa.es',
  'm1,04/06/2026,Entrada,f00dbabe,1,,,jefe@empresa.es',
  ',04/06/2026,Entrada,f00dbabe,1,,,jefe@empresa.es',
].join('\n');

const CONTEXTO = {
  ambulancias: [{ id: 3, alias: 'UVI 3', matricula: '1234ABC' }, { id: 9, alias: null, matricula: 'UVI-01' }],
  usuarios: [{ id: 67, email: 'jefe@empresa.es' }, { id: 70, email: null }],
};

describe('importacionAlmacen.service', () => {
  describe('parseCsv', () => {
    it('entiende comillas, comas y saltos dentro, "" y el BOM', () => {
      expect(imp.parseCsv('﻿a,"b,c","d ""e""\nf"\r\n1,2,3')).toEqual([
        ['a', 'b,c', 'd "e"\nf'],
        ['1', '2', '3'],
      ]);
    });
    it('una última fila sin salto también cuenta', () => {
      expect(imp.parseCsv('a,b\n1,')).toEqual([['a', 'b'], ['1', '']]);
    });
  });

  describe('caducidadDeHoja', () => {
    it.each([
      ['31/10/2028', '2028-10-31'], ['1/2/2027', '2027-02-01'], ['', null], ['01/06/2099', null],
      ['31/02/2028', undefined], ['2028-10-31', undefined],
    ])('%s → %s', (v, esperado) => {
      expect(imp.caducidadDeHoja(v)).toBe(esperado);
    });
  });

  describe('instanteDeHoja', () => {
    it('la hora de la hoja es española', () => {
      // 1 de junio: verano, UTC+2
      expect(imp.instanteDeHoja('01/06/2026 12:01:48').toISOString()).toBe('2026-06-01T10:01:48.000Z');
      expect(imp.instanteDeHoja('16/11/2026').toISOString()).toBe('2026-11-15T23:00:00.000Z');
    });
    it.each(['', 'ayer', '13/13/2026', '01/06/2026 25:00'])('%s no se entiende', (v) => {
      expect(imp.instanteDeHoja(v)).toBeNull();
    });
  });

  it('claveAmbulancia iguala guiones, espacios y ceros', () => {
    expect(imp.claveAmbulancia('UVI-03')).toBe('UVI3');
    expect(imp.claveAmbulancia('uvi 3')).toBe('UVI3');
    expect(imp.claveAmbulancia('UVI-10')).toBe('UVI10');
    expect(imp.claveAmbulancia(null)).toBe('');
  });

  describe('preparar', () => {
    const r = imp.preparar({ productos: PRODUCTOS, stock: STOCK, movimientos: MOVS }, CONTEXTO);
    const motivos = r.rechazos.map(x => `${x.hoja}:${x.fila}:${x.motivo}`);

    it('productos: tipo, mínimo vacío = 0 y repetidos fuera', () => {
      expect(r.productos.map(p => p.codigo)).toEqual(['aaaa0001', 'aaaa0002', 'aaaa0003', 'aaaa0004']);
      expect(r.productos[1]).toMatchObject({ tipo: 'medicacion', stock_minimo: 0, presentacion: 'Pastillas' });
      expect(motivos).toContain('Productos:7:aaaa0001 repetido');
      expect(motivos).toContain('Productos:8:aaaa0005 sin nombre');
      // «Máscarilla» y «Mascarilla»: el mismo nombre, se avisa pero entran los dos
      expect(r.avisos.nombresRepetidos).toEqual(['Mascarilla laringea 4']);
    });

    it('lotes: producto por su columna, caducidad por su columna, 2099 y vacío = no caduca', () => {
      expect(r.lotes.slice(0, 4)).toEqual([
        { codigo: 'aaaa0001-10/31/2028', producto: 'aaaa0001', caducidad: '2028-10-31' },
        { codigo: 'f00dbabe', producto: 'aaaa0002', caducidad: null },
        { codigo: 'aaaa0002-06/01/2099', producto: 'aaaa0002', caducidad: null },
        { codigo: 'aaaa0003-06/30/2029', producto: 'aaaa0003', caducidad: '2028-06-30' },
      ]);
      expect(motivos).toContain('Stock:6:bbbb9999-01/01/2027: el producto bbbb9999 no existe');
      expect(motivos.some(m => m.startsWith('Stock:7:') && m.includes('no se entiende'))).toBe(true);
    });

    it('movimientos: signo por tipo, ambulancia por alias o matrícula, usuario por email', () => {
      const porCodigo = Object.fromEntries(r.movimientos.map(m => [m.codigo, m]));
      expect(porCodigo.m1).toMatchObject({ tipo: 'entrada', cantidad: 30, user_id: 67, usuario_origen: null });
      expect(porCodigo.m2).toMatchObject({ tipo: 'salida_ambulancia', cantidad: -2, vehicle_id: 3, destino: null,
                                            user_id: null, usuario_origen: 'otro@example.com' });
      // No casa: se guarda con el texto
      expect(porCodigo.m3).toMatchObject({ vehicle_id: null, destino: 'UVI-7', usuario_origen: null });
      expect(porCodigo.m4).toMatchObject({ tipo: 'salida_otros', cantidad: -6000, destino: 'Botiquín, boxeo' });
      expect(porCodigo.m5.destino).toBe('Sin especificar');
      expect(porCodigo.m6).toMatchObject({ tipo: 'descarte', cantidad: -1 });
      expect(r.avisos.sinAmbulancia).toEqual({ 'UVI-7': 1 });
      expect(r.avisos.sinUsuario).toEqual({ 'otro@example.com': 1 });
    });

    it('rehace desde la clave los lotes borrados de Stock (producto-MM/DD/YYYY o producto-)', () => {
      expect(r.avisos.lotesReconstruidos).toEqual(['aaaa0002-12/31/2026', 'aaaa0001-']);
      expect(r.lotes.slice(-2)).toEqual([
        { codigo: 'aaaa0002-12/31/2026', producto: 'aaaa0002', caducidad: '2026-12-31' },
        { codigo: 'aaaa0001-', producto: 'aaaa0001', caducidad: null },
      ]);
    });

    it('lo que no se puede importar va al informe con su fila', () => {
      expect(r.movimientos).toHaveLength(8);
      expect(motivos.some(m => m.includes('m15: el lote bbbb9999-12/31/2026 no está en Stock'))).toBe(true);
      expect(motivos.some(m => m.includes('m16: el lote aaaa0001-13/45/2026 no está en Stock'))).toBe(true);
      for (const trozo of ['m7: sin lote', 'm8: el lote zzzz no está en Stock', 'm9: cantidad', 'm10: cantidad',
                           'm11: tipo «Regalo» desconocido', 'm12: fecha «ayer»', 'm1 repetido', 'sin id de movimiento']) {
        expect(motivos.some(m => m.startsWith('Movimientos:') && m.includes(trozo))).toBe(true);
      }
    });

    it('sin contexto no casa nada pero no falla', () => {
      const s = imp.preparar({ productos: PRODUCTOS, stock: STOCK, movimientos: MOVS });
      expect(s.movimientos.find(m => m.codigo === 'm1').user_id).toBeNull();
    });

    it('rechaza productos sin id y lotes sin IDStock o repetidos', () => {
      const s = imp.preparar({
        productos: 'IDProducto,Nombre\n,Algo\np1,Uno',
        stock: 'IDStock,Producto,Caducidad\n,p1,\nl1,p1,\nl1,p1,',
        movimientos: 'Movimiento,Fecha,Tipo,Lote,Cantidad',
      });
      expect(s.rechazos.map(x => x.motivo)).toEqual(['sin IDProducto', 'sin IDStock', 'l1 repetido']);
    });
  });

  describe('escribir', () => {
    function conn({ importadosAntes = [], negativos = [] } = {}) {
      const ejecutadas = [];
      return {
        ejecutadas,
        query: jest.fn(async (sql, params) => {
          ejecutadas.push({ sql, params });
          if (sql.startsWith('SELECT id, codigo_origen FROM material_productos')) return [[{ id: 1, codigo_origen: 'p1' }]];
          if (sql.startsWith('SELECT id, codigo_origen FROM material_lotes')) return [[{ id: 10, codigo_origen: 'l1' }]];
          if (sql.startsWith('SELECT id, codigo_origen FROM material_movimientos')) return [importadosAntes];
          if (sql.startsWith('DELETE')) return [{ affectedRows: params[0].length }];
          if (sql.includes('HAVING')) return [negativos];
          return [{ affectedRows: 1 }];
        }),
      };
    }
    const datos = {
      productos: [{ codigo: 'p1', nombre: 'Uno', presentacion: 'Unidad', tipo: 'producto', stock_minimo: 0 }],
      lotes: [{ codigo: 'l1', producto: 'p1', caducidad: null }],
      movimientos: [{ codigo: 'm1', lote: 'l1', tipo: 'entrada', cantidad: 3, vehicle_id: null, destino: null,
                      user_id: 67, usuario_origen: null, fecha: new Date('2026-06-01T10:00:00Z') }],
    };

    it('inserta o actualiza por el id del AppSheet, enlazando por los ids nuevos', async () => {
      const c = conn({ negativos: [{ nombre: 'Uno', caducidad: null, lote: 'l1', stock: '-2' }] });
      const r = await imp.escribir(c, datos, new Date('2026-11-18T10:00:00Z'));
      expect(r).toMatchObject({ productos: 1, lotes: 1, movimientos: 1, borrados: 0 });
      expect(r.negativos).toEqual([{ nombre: 'Uno', caducidad: null, lote: 'l1', stock: -2 }]);
      for (const t of ['material_productos', 'material_lotes', 'material_movimientos']) {
        expect(c.ejecutadas.find(e => e.sql.includes(`INSERT INTO ${t}`)).sql).toContain('ON DUPLICATE KEY UPDATE');
      }
      expect(c.ejecutadas.find(e => e.sql.includes('INSERT INTO material_lotes')).params[0]).toBe(1);
      expect(c.ejecutadas.find(e => e.sql.includes('INSERT INTO material_movimientos')).params[0]).toBe(10);
      expect(c.ejecutadas.some(e => e.sql.startsWith('DELETE'))).toBe(false);
    });

    it('borra solo los importados que ya no están en la hoja', async () => {
      const c = conn({ importadosAntes: [{ id: 5, codigo_origen: 'm1' }, { id: 6, codigo_origen: 'viejo' }] });
      const r = await imp.escribir(c, datos);
      expect(r.borrados).toBe(1);
      expect(c.ejecutadas.find(e => e.sql.startsWith('DELETE')).params).toEqual([[6]]);
    });
  });
});

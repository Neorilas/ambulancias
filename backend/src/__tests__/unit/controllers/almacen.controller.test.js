'use strict';

/**
 * Tests de controllers/almacen.controller.js.
 *
 * Lo que importa: que el stock salga de sumar movimientos (no hay contador),
 * que una salida nunca deje un lote en negativo, que una entrada reutilice el
 * lote del producto con la misma caducidad, que el recuento apunte solo la
 * diferencia y que todo lo que cambia el almacén quede en la auditoría.
 */

jest.mock('../../../controllers/admin.controller', () => ({ logAudit: jest.fn(), logError: jest.fn() }));

const { query, transaction } = require('../../../config/database');
const { logAudit } = require('../../../controllers/admin.controller');
const ctrl = require('../../../controllers/almacen.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

const ADMIN = { id: 67, username: 'fjtamayo', roles: ['administrador'] };

const PRODUCTO = {
  id: 5, nombre: 'Guedel 3', presentacion: 'Unidad', tipo: 'producto', stock_minimo: 20, activo: 1,
  stock: '12', proxima_caducidad: '2028-10-31', lotes_con_stock: 2, lotes_negativos: 0,
};

/**
 * Conexión de la transacción: cada consulta se responde según su SQL, en el
 * orden de `respuestas` ([fragmento, filas]). Lo que no casa devuelve [[]].
 */
function conexion(respuestas) {
  const ejecutadas = [];
  const conn = {
    query: jest.fn(async (sql, params) => {
      ejecutadas.push({ sql, params });
      const r = respuestas.find(([trozo]) => sql.includes(trozo));
      return r ? [typeof r[1] === 'function' ? r[1](params) : r[1]] : [[]];
    }),
  };
  transaction.mockReset();
  transaction.mockImplementation(async (cb) => cb(conn));
  return { conn, ejecutadas };
}

function llamar(fn, req) {
  const res = mockRes();
  const next = mockNext();
  return fn(req, res, next).then(() => ({ res, next }));
}

describe('almacen.controller', () => {
  beforeEach(() => {
    query.mockReset();
    transaction.mockReset();
    logAudit.mockReset();
  });

  describe('caducidadValida', () => {
    it('vacía es «no caduca»', () => {
      expect(ctrl.caducidadValida('')).toBeNull();
      expect(ctrl.caducidadValida(null)).toBeNull();
    });
    it('una fecha real vale', () => {
      expect(ctrl.caducidadValida('2028-02-29')).toBe('2028-02-29');
    });
    it.each(['2027-02-29', '31/12/2028', '2101-01-01', '1999-12-31', 'mañana'])('%s no vale', (v) => {
      expect(ctrl.caducidadValida(v)).toBeUndefined();
    });
  });

  describe('entero', () => {
    it('acepta texto y número dentro del rango', () => {
      expect(ctrl.entero('7', 1, 10)).toBe(7);
      expect(ctrl.entero(0, 0, 10)).toBe(0);
    });
    it.each([['0', 1, 10], ['11', 1, 10], ['2,5', 1, 10], ['', 0, 10], [undefined, 0, 10]])('%s fuera', (v, a, b) => {
      expect(ctrl.entero(v, a, b)).toBeNaN();
    });
  });

  describe('listProductos', () => {
    it('devuelve el catálogo con el stock como número y sin paginar', async () => {
      query.mockResolvedValueOnce([[PRODUCTO]]);
      const { res } = await llamar(ctrl.listProductos, mockReq({ user: ADMIN }));
      expect(res.statusCode).toBe(200);
      expect(res._json.data[0]).toMatchObject({ stock: 12, stock_minimo: 20, activo: true });
      const sql = query.mock.calls[0][0];
      // El stock se suma de los movimientos; no hay columna de stock
      expect(sql).toContain('SUM(m.cantidad)');
      expect(sql).toContain("DATE_FORMAT(MIN(CASE WHEN ls.stock > 0 THEN ls.caducidad END)");
      expect(sql).not.toContain('LIMIT');
    });

    it('un fallo de BD va a next', async () => {
      query.mockRejectedValueOnce(new Error('caída'));
      const { next } = await llamar(ctrl.listProductos, mockReq({ user: ADMIN }));
      expect(next).toHaveBeenCalled();
    });
  });

  describe('getProducto', () => {
    it('trae los lotes, los que no caducan al final', async () => {
      query
        .mockResolvedValueOnce([[PRODUCTO]])
        .mockResolvedValueOnce([[{ id: 1, caducidad: '2028-10-31', stock: '10' }, { id: 2, caducidad: null, stock: '2' }]]);
      const { res } = await llamar(ctrl.getProducto, mockReq({ user: ADMIN, params: { id: '5' } }));
      expect(res._json.data.lotes).toEqual([
        { id: 1, caducidad: '2028-10-31', stock: 10 },
        { id: 2, caducidad: null, stock: 2 },
      ]);
      expect(query.mock.calls[1][0]).toContain('ORDER BY ls.caducidad IS NULL, ls.caducidad');
    });

    it('404 si no existe o el id no es un id', async () => {
      query.mockResolvedValueOnce([[]]);
      expect((await llamar(ctrl.getProducto, mockReq({ user: ADMIN, params: { id: '9' } }))).res.statusCode).toBe(404);
      expect((await llamar(ctrl.getProducto, mockReq({ user: ADMIN, params: { id: 'x' } }))).res.statusCode).toBe(404);
    });

    it('un fallo de BD va a next', async () => {
      query.mockRejectedValueOnce(new Error('caída'));
      const { next } = await llamar(ctrl.getProducto, mockReq({ user: ADMIN, params: { id: '5' } }));
      expect(next).toHaveBeenCalled();
    });
  });

  describe('createProducto', () => {
    it('da de alta con los valores por defecto y lo audita', async () => {
      query
        .mockResolvedValueOnce([[]])                 // nombre libre
        .mockResolvedValueOnce([{ insertId: 30 }])   // INSERT
        .mockResolvedValueOnce([[{ ...PRODUCTO, id: 30, nombre: 'Gasas', stock: '0' }]]);
      const { res } = await llamar(ctrl.createProducto, mockReq({ user: ADMIN, body: { nombre: '  Gasas  ' } }));
      expect(res.statusCode).toBe(201);
      expect(query.mock.calls[1][1].slice(0, 4)).toEqual(['Gasas', 'Unidad', 'producto', 0]);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'create_material_producto', entityId: 30 }));
    });

    it('409 si ya hay uno activo con ese nombre', async () => {
      query.mockResolvedValueOnce([[{ id: 5 }]]);
      const { res } = await llamar(ctrl.createProducto, mockReq({ user: ADMIN, body: { nombre: 'Guedel 3' } }));
      expect(res.statusCode).toBe(409);
    });

    it.each([
      [{}, 'El nombre es obligatorio'],
      [{ nombre: 'x'.repeat(151) }, 'El nombre no puede pasar'],
      [{ nombre: 'A', presentacion: 'x'.repeat(31) }, 'La presentación no puede pasar'],
      [{ nombre: 'A', tipo: 'herramienta' }, 'Tipo no válido'],
      [{ nombre: 'A', stock_minimo: '-1' }, 'El stock mínimo'],
    ])('400 con %j', async (body, mensaje) => {
      const { res } = await llamar(ctrl.createProducto, mockReq({ user: ADMIN, body }));
      expect(res.statusCode).toBe(400);
      expect(res._json.message).toContain(mensaje);
      expect(query).not.toHaveBeenCalled();
    });

    it('un fallo de BD va a next', async () => {
      query.mockRejectedValueOnce(new Error('caída'));
      const { next } = await llamar(ctrl.createProducto, mockReq({ user: ADMIN, body: { nombre: 'A' } }));
      expect(next).toHaveBeenCalled();
    });
  });

  describe('updateProducto', () => {
    it('cambia solo lo que llega y audita el antes y el después', async () => {
      query
        .mockResolvedValueOnce([[PRODUCTO]])                     // antes
        .mockResolvedValueOnce([{ affectedRows: 1 }])            // UPDATE
        .mockResolvedValueOnce([[{ ...PRODUCTO, stock_minimo: 10 }]]);
      const { res } = await llamar(ctrl.updateProducto, mockReq({ user: ADMIN, params: { id: '5' }, body: { stock_minimo: 10 } }));
      expect(res.statusCode).toBe(200);
      expect(query.mock.calls[1][0]).toContain('SET stock_minimo = ?, updated_at = ?');
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'update_material_producto',
        details: { nombre: 'Guedel 3', cambios: { stock_minimo: { antes: 20, despues: 10 } } },
      }));
    });

    it('retirar del catálogo no mira si el nombre está repetido', async () => {
      query
        .mockResolvedValueOnce([[PRODUCTO]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ ...PRODUCTO, activo: 0 }]]);
      const { res } = await llamar(ctrl.updateProducto, mockReq({ user: ADMIN, params: { id: '5' }, body: { activo: false } }));
      expect(res.statusCode).toBe(200);
      expect(query.mock.calls[1][1][0]).toBe(0);
    });

    it('reactivar o renombrar choca con otro activo del mismo nombre', async () => {
      query.mockResolvedValueOnce([[{ ...PRODUCTO, activo: 0 }]]).mockResolvedValueOnce([[{ id: 8 }]]);
      const { res } = await llamar(ctrl.updateProducto, mockReq({ user: ADMIN, params: { id: '5' }, body: { activo: true } }));
      expect(res.statusCode).toBe(409);
    });

    it('sin cambios reales no audita', async () => {
      query
        .mockResolvedValueOnce([[PRODUCTO]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[PRODUCTO]]);
      await llamar(ctrl.updateProducto, mockReq({ user: ADMIN, params: { id: '5' }, body: { tipo: 'producto' } }));
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('400 si no llega nada o activo no es booleano; 404 si no existe', async () => {
      query.mockResolvedValue([[PRODUCTO]]);
      expect((await llamar(ctrl.updateProducto, mockReq({ user: ADMIN, params: { id: '5' }, body: {} }))).res.statusCode).toBe(400);
      expect((await llamar(ctrl.updateProducto, mockReq({ user: ADMIN, params: { id: '5' }, body: { activo: 'no' } }))).res.statusCode).toBe(400);
      query.mockReset();
      query.mockResolvedValueOnce([[]]);
      expect((await llamar(ctrl.updateProducto, mockReq({ user: ADMIN, params: { id: '5' }, body: { nombre: 'B' } }))).res.statusCode).toBe(404);
      expect((await llamar(ctrl.updateProducto, mockReq({ user: ADMIN, params: { id: '0' }, body: {} }))).res.statusCode).toBe(404);
    });

    it('un fallo de BD va a next', async () => {
      query.mockRejectedValueOnce(new Error('caída'));
      const { next } = await llamar(ctrl.updateProducto, mockReq({ user: ADMIN, params: { id: '5' }, body: { nombre: 'B' } }));
      expect(next).toHaveBeenCalled();
    });
  });

  describe('updateLote', () => {
    const LOTE = { id: 3, producto_id: 5, caducidad: '2029-06-30', nombre: 'Tubo OIT 7' };

    it('corrige la caducidad y lo audita', async () => {
      query
        .mockResolvedValueOnce([[LOTE]])
        .mockResolvedValueOnce([[]])                  // no hay otro igual
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
      const { res } = await llamar(ctrl.updateLote, mockReq({ user: ADMIN, params: { id: '3' }, body: { caducidad: '2028-06-30' } }));
      expect(res.statusCode).toBe(200);
      expect(query.mock.calls[2][1]).toEqual(['2028-06-30', 3]);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'update_material_lote' }));
    });

    it('pasar a «no caduca» busca otro lote sin caducidad', async () => {
      query.mockResolvedValueOnce([[LOTE]]).mockResolvedValueOnce([[{ id: 9 }]]);
      const { res } = await llamar(ctrl.updateLote, mockReq({ user: ADMIN, params: { id: '3' }, body: { caducidad: '' } }));
      expect(res.statusCode).toBe(409);
      expect(query.mock.calls[1][0]).toContain('caducidad IS NULL');
    });

    it('la misma fecha no cambia nada', async () => {
      query.mockResolvedValueOnce([[LOTE]]);
      const { res } = await llamar(ctrl.updateLote, mockReq({ user: ADMIN, params: { id: '3' }, body: { caducidad: '2029-06-30' } }));
      expect(res._json.message).toBe('Sin cambios');
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('400 con una fecha mala; 404 sin lote', async () => {
      expect((await llamar(ctrl.updateLote, mockReq({ user: ADMIN, params: { id: '3' }, body: { caducidad: '30/06/2028' } }))).res.statusCode).toBe(400);
      expect((await llamar(ctrl.updateLote, mockReq({ user: ADMIN, params: { id: 'a' }, body: {} }))).res.statusCode).toBe(404);
      query.mockResolvedValueOnce([[]]);
      expect((await llamar(ctrl.updateLote, mockReq({ user: ADMIN, params: { id: '3' }, body: { caducidad: '' } }))).res.statusCode).toBe(404);
    });

    it('un fallo de BD va a next', async () => {
      query.mockRejectedValueOnce(new Error('caída'));
      const { next } = await llamar(ctrl.updateLote, mockReq({ user: ADMIN, params: { id: '3' }, body: { caducidad: '' } }));
      expect(next).toHaveBeenCalled();
    });
  });

  describe('recuentoLote', () => {
    const LOTE = [{ id: 3, producto_id: 5, caducidad: '2026-06-02', nombre: 'Suero', activo: 1 }];

    it('apunta un ajuste por la diferencia, con el lote bloqueado', async () => {
      const { ejecutadas } = conexion([
        ['FOR UPDATE', LOTE],
        ['SUM(cantidad)', [{ stock: '-5971' }]],
        ['INSERT INTO material_movimientos', { insertId: 77 }],
      ]);
      const { res } = await llamar(ctrl.recuentoLote, mockReq({ user: ADMIN, params: { id: '3' }, body: { stock_real: '23' } }));
      expect(res.statusCode).toBe(201);
      expect(res._json.data).toMatchObject({ stock: 23, diferencia: 5994 });
      const insert = ejecutadas.find(e => e.sql.includes('INSERT'));
      expect(insert.sql).toContain("'ajuste'");
      expect(insert.params.slice(0, 3)).toEqual([3, 5994, 'Recuento']);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'recuento_material', details: expect.objectContaining({ antes: -5971, contado: 23 }),
      }));
    });

    it('si cuadra no apunta nada', async () => {
      const { ejecutadas } = conexion([['FOR UPDATE', LOTE], ['SUM(cantidad)', [{ stock: 4 }]]]);
      const { res } = await llamar(ctrl.recuentoLote, mockReq({ user: ADMIN, params: { id: '3' }, body: { stock_real: 4 } }));
      expect(res.statusCode).toBe(200);
      expect(ejecutadas.some(e => e.sql.includes('INSERT'))).toBe(false);
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('404 si el lote no existe', async () => {
      conexion([]);
      const { res } = await llamar(ctrl.recuentoLote, mockReq({ user: ADMIN, params: { id: '3' }, body: { stock_real: 4 } }));
      expect(res.statusCode).toBe(404);
    });

    it('400 con un número malo o notas largas; 404 con un id malo', async () => {
      expect((await llamar(ctrl.recuentoLote, mockReq({ user: ADMIN, params: { id: '3' }, body: { stock_real: -1 } }))).res.statusCode).toBe(400);
      expect((await llamar(ctrl.recuentoLote, mockReq({ user: ADMIN, params: { id: '3' }, body: { stock_real: 1, notas: 'x'.repeat(256) } }))).res.statusCode).toBe(400);
      expect((await llamar(ctrl.recuentoLote, mockReq({ user: ADMIN, params: { id: '-3' }, body: { stock_real: 1 } }))).res.statusCode).toBe(404);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('un fallo de BD va a next', async () => {
      transaction.mockRejectedValueOnce(new Error('caída'));
      const { next } = await llamar(ctrl.recuentoLote, mockReq({ user: ADMIN, params: { id: '3' }, body: { stock_real: 1 } }));
      expect(next).toHaveBeenCalled();
    });
  });

  describe('createMovimiento: entrada', () => {
    const body = { tipo: 'entrada', producto_id: 5, caducidad: '2028-10-31', cantidad: '10' };

    it('reutiliza el lote del producto con esa caducidad', async () => {
      const { ejecutadas } = conexion([
        ['FROM material_productos WHERE id = ? FOR UPDATE', [{ id: 5, nombre: 'Guedel 3', activo: 1 }]],
        ['SELECT id FROM material_lotes', [{ id: 4 }]],
        ['INSERT INTO material_movimientos', { insertId: 90 }],
      ]);
      query.mockResolvedValueOnce([[PRODUCTO]]);
      const { res } = await llamar(ctrl.createMovimiento, mockReq({ user: ADMIN, body }));
      expect(res.statusCode).toBe(201);
      expect(res._json.data).toMatchObject({ id: 90, lote_id: 4 });
      expect(ejecutadas.some(e => e.sql.includes('INSERT INTO material_lotes'))).toBe(false);
      expect(ejecutadas.find(e => e.sql.includes('INSERT INTO material_movimientos')).params.slice(0, 2)).toEqual([4, 10]);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'material_movimiento', details: expect.objectContaining({ tipo: 'entrada', cantidad: 10, caducidad: '2028-10-31' }),
      }));
    });

    it('crea el lote si no hay ninguno; sin caducidad busca IS NULL', async () => {
      const { ejecutadas } = conexion([
        ['FROM material_productos WHERE id = ? FOR UPDATE', [{ id: 5, nombre: 'Guantes M', activo: 1 }]],
        ['INSERT INTO material_lotes', { insertId: 12 }],
        ['INSERT INTO material_movimientos', { insertId: 91 }],
      ]);
      query.mockResolvedValueOnce([[PRODUCTO]]);
      const { res } = await llamar(ctrl.createMovimiento, mockReq({ user: ADMIN, body: { ...body, caducidad: '' } }));
      expect(res._json.data.lote_id).toBe(12);
      expect(ejecutadas.find(e => e.sql.startsWith('SELECT id FROM material_lotes')).sql).toContain('caducidad IS NULL');
      expect(ejecutadas.find(e => e.sql.includes('INSERT INTO material_lotes')).params[1]).toBeNull();
    });

    it('404 sin producto y 409 si está retirado', async () => {
      conexion([]);
      expect((await llamar(ctrl.createMovimiento, mockReq({ user: ADMIN, body }))).res.statusCode).toBe(404);
      conexion([['FOR UPDATE', [{ id: 5, nombre: 'Viejo', activo: 0 }]]]);
      const { res } = await llamar(ctrl.createMovimiento, mockReq({ user: ADMIN, body }));
      expect(res.statusCode).toBe(409);
      expect(logAudit).not.toHaveBeenCalled();
    });

    it.each([
      [{ ...body, producto_id: undefined }, 'Falta el producto'],
      [{ ...body, caducidad: '31/10/2028' }, 'Caducidad no válida'],
    ])('400 con %j', async (b, mensaje) => {
      const { res } = await llamar(ctrl.createMovimiento, mockReq({ user: ADMIN, body: b }));
      expect(res.statusCode).toBe(400);
      expect(res._json.message).toContain(mensaje);
    });
  });

  describe('createMovimiento: salidas', () => {
    const LOTE = [{ id: 4, producto_id: 5, caducidad: '2028-10-31', nombre: 'Guedel 3', activo: 1 }];

    it('a una ambulancia: resta y guarda el vehículo', async () => {
      const { ejecutadas } = conexion([
        ['FOR UPDATE', LOTE],
        ['SUM(cantidad)', [{ stock: '10' }]],
        ['FROM vehicles', [{ id: 2, alias: 'UVI-03', matricula: '1234ABC' }]],
        ['INSERT INTO material_movimientos', { insertId: 92 }],
      ]);
      query.mockResolvedValueOnce([[PRODUCTO]]);
      const { res } = await llamar(ctrl.createMovimiento, mockReq({
        user: ADMIN, body: { tipo: 'salida_ambulancia', lote_id: 4, cantidad: 3, vehicle_id: '2' },
      }));
      expect(res.statusCode).toBe(201);
      const insert = ejecutadas.find(e => e.sql.includes('INSERT INTO material_movimientos'));
      expect(insert.params.slice(0, 5)).toEqual([4, 'salida_ambulancia', -3, 2, null]);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        details: expect.objectContaining({ tipo: 'salida_ambulancia', vehiculo: 'UVI-03', cantidad: 3 }),
      }));
    });

    it('nunca deja el lote en negativo', async () => {
      const { ejecutadas } = conexion([['FOR UPDATE', LOTE], ['SUM(cantidad)', [{ stock: '2' }]]]);
      const { res } = await llamar(ctrl.createMovimiento, mockReq({
        user: ADMIN, body: { tipo: 'descarte', lote_id: 4, cantidad: 3 },
      }));
      expect(res.statusCode).toBe(409);
      expect(res._json.message).toBe('De ese lote solo quedan 2');
      expect(ejecutadas.some(e => e.sql.includes('INSERT'))).toBe(false);
    });

    it('de un lote vacío lo dice así', async () => {
      conexion([['FOR UPDATE', LOTE], ['SUM(cantidad)', [{ stock: 0 }]]]);
      const { res } = await llamar(ctrl.createMovimiento, mockReq({ user: ADMIN, body: { tipo: 'descarte', lote_id: 4, cantidad: 1 } }));
      expect(res._json.message).toBe('De ese lote no queda nada en el almacén');
    });

    it('a otro sitio guarda el destino', async () => {
      const { ejecutadas } = conexion([
        ['FOR UPDATE', LOTE], ['SUM(cantidad)', [{ stock: 5 }]], ['INSERT INTO material_movimientos', { insertId: 93 }],
      ]);
      query.mockResolvedValueOnce([[PRODUCTO]]);
      await llamar(ctrl.createMovimiento, mockReq({
        user: ADMIN, body: { tipo: 'salida_otros', lote_id: 4, cantidad: 1, destino: ' Botiquín  boxeo ' },
      }));
      expect(ejecutadas.find(e => e.sql.includes('INSERT')).params[4]).toBe('Botiquín boxeo');
    });

    it('422 si la ambulancia no existe o está de baja; 404 sin lote', async () => {
      conexion([['FOR UPDATE', LOTE], ['SUM(cantidad)', [{ stock: 5 }]]]);
      expect((await llamar(ctrl.createMovimiento, mockReq({
        user: ADMIN, body: { tipo: 'salida_ambulancia', lote_id: 4, cantidad: 1, vehicle_id: 99 },
      }))).res.statusCode).toBe(422);
      conexion([]);
      expect((await llamar(ctrl.createMovimiento, mockReq({
        user: ADMIN, body: { tipo: 'descarte', lote_id: 4, cantidad: 1 },
      }))).res.statusCode).toBe(404);
    });

    it.each([
      [{ tipo: 'ajuste', lote_id: 4, cantidad: 1 }, 'Tipo de movimiento no válido'],
      [{ tipo: 'descarte', lote_id: 4, cantidad: 0 }, 'La cantidad'],
      [{ tipo: 'descarte', lote_id: 4, cantidad: '1.5' }, 'La cantidad'],
      [{ tipo: 'descarte', cantidad: 1 }, 'Falta el lote'],
      [{ tipo: 'salida_ambulancia', lote_id: 4, cantidad: 1 }, 'Falta la ambulancia'],
      [{ tipo: 'salida_otros', lote_id: 4, cantidad: 1 }, 'Di adónde va'],
      [{ tipo: 'salida_otros', lote_id: 4, cantidad: 1, destino: 'x'.repeat(151) }, 'El destino no puede'],
      [{ tipo: 'descarte', lote_id: 4, cantidad: 1, notas: 'x'.repeat(256) }, 'Las notas no pueden'],
    ])('400 con %j', async (body, mensaje) => {
      const { res } = await llamar(ctrl.createMovimiento, mockReq({ user: ADMIN, body }));
      expect(res.statusCode).toBe(400);
      expect(res._json.message).toContain(mensaje);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('un fallo de BD va a next', async () => {
      transaction.mockRejectedValueOnce(new Error('caída'));
      const { next } = await llamar(ctrl.createMovimiento, mockReq({ user: ADMIN, body: { tipo: 'descarte', lote_id: 4, cantidad: 1 } }));
      expect(next).toHaveBeenCalled();
    });
  });

  describe('listMovimientos', () => {
    it('pagina de 50 en 50 y filtra por producto, ambulancia y tipo', async () => {
      query
        .mockResolvedValueOnce([[{ total: 120 }]])
        .mockResolvedValueOnce([[{ id: 1, tipo: 'entrada', cantidad: 4, importado: 1 }]]);
      const { res } = await llamar(ctrl.listMovimientos, mockReq({
        user: ADMIN, query: { producto_id: '5', vehicle_id: '2', tipo: 'salida_ambulancia', page: '2' },
      }));
      expect(res._json.pagination).toMatchObject({ total: 120, page: 2, limit: 50 });
      expect(res._json.data[0].importado).toBe(true);
      const [sql, params] = query.mock.calls[1];
      expect(sql).toContain('WHERE l.producto_id = ? AND m.vehicle_id = ? AND m.tipo = ?');
      expect(sql).toContain('ORDER BY m.fecha DESC, m.id DESC');
      expect(params).toEqual([5, 2, 'salida_ambulancia', 50, 50]);
    });

    it('sin filtros no lleva WHERE', async () => {
      query.mockResolvedValueOnce([[{ total: 0 }]]).mockResolvedValueOnce([[]]);
      await llamar(ctrl.listMovimientos, mockReq({ user: ADMIN, query: { tipo: ['entrada', 'x'] } }));
      expect(query.mock.calls[1][1]).toEqual(['entrada', 50, 0]);
    });

    it('400 con filtros que no valen', async () => {
      expect((await llamar(ctrl.listMovimientos, mockReq({ user: ADMIN, query: { producto_id: 'x' } }))).res.statusCode).toBe(400);
      expect((await llamar(ctrl.listMovimientos, mockReq({ user: ADMIN, query: { tipo: 'robo' } }))).res.statusCode).toBe(400);
    });

    it('un fallo de BD va a next', async () => {
      query.mockRejectedValueOnce(new Error('caída'));
      const { next } = await llamar(ctrl.listMovimientos, mockReq({ user: ADMIN, query: {} }));
      expect(next).toHaveBeenCalled();
    });
  });
});

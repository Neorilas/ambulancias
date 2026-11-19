'use strict';

/**
 * Tests de controllers/inventario.controller.js (v46).
 *
 * Lo que importa: que una línea sea un producto del almacén o un texto libre,
 * que lo mismo con la misma caducidad se sume a la línea que ya hay en vez de
 * duplicarse (con la ambulancia bloqueada), que el alta a mano NO toque el
 * almacén, y que todo cambio quede en la auditoría.
 */

jest.mock('../../../controllers/admin.controller', () => ({ logAudit: jest.fn(), logError: jest.fn() }));

const { query, transaction } = require('../../../config/database');
const { logAudit } = require('../../../controllers/admin.controller');
const ctrl = require('../../../controllers/inventario.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

const ADMIN = { id: 67, username: 'admin', roles: ['administrador'] };
const UVI = { id: 2, alias: 'UVI-03', matricula: '1234ABC' };
const LINEA = {
  id: 31, vehicle_id: 2, producto_id: 5, nombre: 'Guedel 3', presentacion: 'Unidad', tipo: 'producto',
  caducidad: '2028-10-31', cantidad: 4, notas: null, updated_at: '2026-11-19 10:00:00',
};

/** Conexión de la transacción: cada consulta según su SQL ([fragmento, filas]); lo que no casa da [[]]. */
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

describe('inventario.controller', () => {
  beforeEach(() => {
    query.mockReset();
    transaction.mockReset();
    logAudit.mockReset();
  });

  describe('listAmbulancias', () => {
    it('las vivas con su resumen, en números', async () => {
      query.mockResolvedValueOnce([[{ id: 2, alias: 'UVI-03', matricula: '1234ABC', lineas: '3', unidades: '17', proxima_caducidad: '2027-01-31' }]]);
      const { res } = await llamar(ctrl.listAmbulancias, mockReq({ user: ADMIN }));
      expect(res._json.data).toEqual([expect.objectContaining({ lineas: 3, unidades: 17, proxima_caducidad: '2027-01-31' })]);
      const [sql] = query.mock.calls[0];
      expect(sql).toContain('v.deleted_at IS NULL');
      expect(sql).toContain('LEFT JOIN vehiculo_inventario');
    });
  });

  describe('getAmbulancia', () => {
    it('la ambulancia y sus líneas, con el nombre del catálogo o el texto libre', async () => {
      query
        .mockResolvedValueOnce([[UVI]])
        .mockResolvedValueOnce([[LINEA, { ...LINEA, id: 32, producto_id: null, nombre: 'Manta térmica', presentacion: null, cantidad: '2' }]]);
      const { res } = await llamar(ctrl.getAmbulancia, mockReq({ user: ADMIN, params: { id: '2' } }));
      expect(res.statusCode).toBe(200);
      expect(res._json.data.vehiculo).toEqual(UVI);
      expect(res._json.data.lineas.map(l => [l.nombre, l.cantidad, l.del_almacen]))
        .toEqual([['Guedel 3', 4, true], ['Manta térmica', 2, false]]);
      expect(query.mock.calls[1][0]).toContain('COALESCE(p.nombre, i.nombre)');
    });

    it('404 si no existe o está de baja', async () => {
      query.mockResolvedValueOnce([[]]);
      const { res } = await llamar(ctrl.getAmbulancia, mockReq({ user: ADMIN, params: { id: '9' } }));
      expect(res.statusCode).toBe(404);
    });
  });

  describe('createLinea', () => {
    it('un producto del almacén: línea nueva, sin tocar el almacén', async () => {
      const { ejecutadas } = conexion([
        ['FROM vehicles', [UVI]],
        ['FROM material_productos', [{ id: 5, nombre: 'Guedel 3', activo: 1 }]],
        ['INSERT INTO vehiculo_inventario', { insertId: 31 }],
      ]);
      query.mockResolvedValueOnce([[LINEA]]);
      const { res } = await llamar(ctrl.createLinea, mockReq({
        user: ADMIN, params: { id: '2' }, body: { producto_id: 5, cantidad: '4', caducidad: '2028-10-31' },
      }));
      expect(res.statusCode).toBe(201);
      expect(res._json.message).toBe('Añadido al inventario');
      expect(ejecutadas[0].sql).toContain('FOR UPDATE');
      const alta = ejecutadas.find(e => e.sql.includes('INSERT INTO vehiculo_inventario'));
      expect(alta.params.slice(0, 7)).toEqual([2, 5, null, '2028-10-31', 4, null, ADMIN.id]);
      expect(ejecutadas.some(e => e.sql.includes('material_movimientos') || e.sql.includes('material_lotes'))).toBe(false);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'create_inventario_ambulancia',
        details: expect.objectContaining({ vehiculo: 'UVI-03', elemento: 'Guedel 3', cantidad: 4, caducidad: '2028-10-31' }),
      }));
    });

    it('texto libre (no está en el almacén), sin caducidad', async () => {
      const { ejecutadas } = conexion([['FROM vehicles', [UVI]], ['INSERT INTO vehiculo_inventario', { insertId: 33 }]]);
      query.mockResolvedValueOnce([[{ ...LINEA, id: 33, producto_id: null, nombre: 'Manta térmica' }]]);
      const { res } = await llamar(ctrl.createLinea, mockReq({
        user: ADMIN, params: { id: '2' }, body: { nombre: '  Manta   térmica ', cantidad: 2, notas: 'en el altillo' },
      }));
      expect(res.statusCode).toBe(201);
      const busca = ejecutadas.find(e => e.sql.includes('FROM vehiculo_inventario'));
      expect(busca.sql).toContain('producto_id IS NULL AND nombre = ?');
      expect(busca.sql).toContain('caducidad IS NULL');
      const alta = ejecutadas.find(e => e.sql.includes('INSERT INTO vehiculo_inventario'));
      expect(alta.params.slice(0, 6)).toEqual([2, null, 'Manta térmica', null, 2, 'en el altillo']);
      expect(ejecutadas.some(e => e.sql.includes('material_productos'))).toBe(false);
    });

    it('lo mismo con la misma caducidad se suma a la línea que ya hay', async () => {
      const { ejecutadas } = conexion([
        ['FROM vehicles', [UVI]],
        ['FROM material_productos', [{ id: 5, nombre: 'Guedel 3', activo: 1 }]],
        ['FROM vehiculo_inventario', [{ id: 31, cantidad: 4 }]],
      ]);
      query.mockResolvedValueOnce([[{ ...LINEA, cantidad: 6 }]]);
      const { res } = await llamar(ctrl.createLinea, mockReq({
        user: ADMIN, params: { id: '2' }, body: { producto_id: '5', cantidad: 2, caducidad: '2028-10-31' },
      }));
      expect(res._json.message).toBe('Sumado: ahora hay 6');
      expect(ejecutadas.some(e => e.sql.includes('INSERT'))).toBe(false);
      expect(ejecutadas.find(e => e.sql.includes('UPDATE vehiculo_inventario')).params).toEqual([2, expect.any(Date), 31]);
      expect(logAudit.mock.calls[0][0].details).toMatchObject({ sumado: true, queda: 6 });
    });

    it('404 si la ambulancia no existe; 422/409 si el producto no está o está retirado', async () => {
      conexion([['FROM vehicles', []]]);
      expect((await llamar(ctrl.createLinea, mockReq({ user: ADMIN, params: { id: '9' }, body: { nombre: 'x', cantidad: 1 } }))).res.statusCode).toBe(404);
      conexion([['FROM vehicles', [UVI]], ['FROM material_productos', []]]);
      expect((await llamar(ctrl.createLinea, mockReq({ user: ADMIN, params: { id: '2' }, body: { producto_id: 77, cantidad: 1 } }))).res.statusCode).toBe(422);
      conexion([['FROM vehicles', [UVI]], ['FROM material_productos', [{ id: 5, nombre: 'x', activo: 0 }]]]);
      expect((await llamar(ctrl.createLinea, mockReq({ user: ADMIN, params: { id: '2' }, body: { producto_id: 5, cantidad: 1 } }))).res.statusCode).toBe(409);
      expect(logAudit).not.toHaveBeenCalled();
    });

    it.each([
      [{ cantidad: 1 }, 'Di qué es'],
      [{ nombre: '   ', cantidad: 1 }, 'Di qué es'],
      [{ nombre: 'x'.repeat(151), cantidad: 1 }, 'El nombre no puede'],
      [{ producto_id: 'abc', cantidad: 1 }, 'Producto no válido'],
      [{ nombre: 'Manta', cantidad: 0 }, 'La cantidad'],
      [{ nombre: 'Manta', cantidad: '1.5' }, 'La cantidad'],
      [{ nombre: 'Manta', cantidad: 1, caducidad: '31/10/2028' }, 'Caducidad no válida'],
      [{ nombre: 'Manta', cantidad: 1, notas: 'x'.repeat(256) }, 'Las notas'],
    ])('400 con %j', async (body, mensaje) => {
      const { res } = await llamar(ctrl.createLinea, mockReq({ user: ADMIN, params: { id: '2' }, body }));
      expect(res.statusCode).toBe(400);
      expect(res._json.message).toContain(mensaje);
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  describe('updateLinea', () => {
    it('guarda cantidad, caducidad y notas, y audita solo lo que cambia', async () => {
      const { ejecutadas } = conexion([['WHERE i.id = ?', [LINEA]], ['FROM vehicles', [UVI]]]);
      query.mockResolvedValueOnce([[{ ...LINEA, cantidad: 0 }]]);
      const { res } = await llamar(ctrl.updateLinea, mockReq({
        user: ADMIN, params: { id: '31' }, body: { cantidad: 0, caducidad: '2028-10-31', notas: '' },
      }));
      expect(res.statusCode).toBe(200);
      const upd = ejecutadas.find(e => e.sql.startsWith('UPDATE vehiculo_inventario'));
      expect(upd.params).toEqual([0, '2028-10-31', null, expect.any(Date), 31]);
      expect(logAudit.mock.calls[0][0]).toMatchObject({
        action: 'update_inventario_ambulancia',
        details: { cambios: { cantidad: { antes: 4, despues: 0 } } },
      });
    });

    it('409 si con la caducidad nueva ya hay otra línea igual', async () => {
      const { ejecutadas } = conexion([
        ['WHERE i.id = ?', [LINEA]], ['FROM vehicles', [UVI]], ['FROM vehiculo_inventario WHERE', [{ id: 40, cantidad: 1 }]],
      ]);
      const { res } = await llamar(ctrl.updateLinea, mockReq({
        user: ADMIN, params: { id: '31' }, body: { cantidad: 4, caducidad: '2029-01-31' },
      }));
      expect(res.statusCode).toBe(409);
      const busca = ejecutadas.find(e => e.sql.includes('FROM vehiculo_inventario WHERE'));
      expect(busca.sql).toContain('id <> ?');
      expect(busca.params).toEqual([2, 5, '2029-01-31', 31]);
      expect(ejecutadas.some(e => e.sql.startsWith('UPDATE'))).toBe(false);
    });

    it('sin cambios no audita; 404 si no existe; 400 con cantidad negativa', async () => {
      conexion([['WHERE i.id = ?', [LINEA]], ['FROM vehicles', [UVI]]]);
      query.mockResolvedValueOnce([[LINEA]]);
      await llamar(ctrl.updateLinea, mockReq({ user: ADMIN, params: { id: '31' }, body: { cantidad: 4, caducidad: '2028-10-31' } }));
      expect(logAudit).not.toHaveBeenCalled();
      conexion([]);
      expect((await llamar(ctrl.updateLinea, mockReq({ user: ADMIN, params: { id: '99' }, body: { cantidad: 1 } }))).res.statusCode).toBe(404);
      expect((await llamar(ctrl.updateLinea, mockReq({ user: ADMIN, params: { id: '31' }, body: { cantidad: -1 } }))).res.statusCode).toBe(400);
    });
  });

  describe('deleteLinea', () => {
    it('la quita y deja en la auditoría lo que había', async () => {
      const { ejecutadas } = conexion([['WHERE i.id = ?', [LINEA]], ['FROM vehicles', [UVI]]]);
      const { res } = await llamar(ctrl.deleteLinea, mockReq({ user: ADMIN, params: { id: '31' } }));
      expect(res.statusCode).toBe(200);
      expect(ejecutadas.find(e => e.sql.startsWith('DELETE')).params).toEqual([31]);
      expect(logAudit.mock.calls[0][0]).toMatchObject({
        action: 'delete_inventario_ambulancia',
        details: { vehiculo: 'UVI-03', elemento: 'Guedel 3', cantidad: 4, caducidad: '2028-10-31' },
      });
    });

    it('404 si no existe', async () => {
      conexion([]);
      expect((await llamar(ctrl.deleteLinea, mockReq({ user: ADMIN, params: { id: '31' } }))).res.statusCode).toBe(404);
      expect(logAudit).not.toHaveBeenCalled();
    });
  });
});

'use strict';

/**
 * Tests de controllers/facturas.controller.js.
 *
 * Lo que importa: que solo entren PDF de verdad (por la cabecera, no por el
 * mimetype), que la misma factura no entre dos veces, que el listado no
 * arrastre los PDF (nada de SELECT *), que la descarga no se cachee y que
 * subir y borrar queden en la auditoría.
 */

jest.mock('../../../controllers/admin.controller', () => ({ logAudit: jest.fn(), logError: jest.fn() }));

const { query } = require('../../../config/database');
const { logAudit } = require('../../../controllers/admin.controller');
const ctrl = require('../../../controllers/facturas.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

const ADMIN = { id: 67, username: 'fjtamayo', roles: ['administrador'] };
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1');

function subida(campos = {}, fichero = { buffer: PDF, size: PDF.length, originalname: '5705694492.pdf' }) {
  return mockReq({
    user: ADMIN,
    file: fichero,
    body: { proveedor: 'Google Ads', numero: '5705694492', fecha_emision: '2026-09-30', importe: '65,23', ...campos },
  });
}

describe('facturas.controller', () => {
  beforeEach(() => {
    query.mockReset();
    logAudit.mockReset();
  });

  describe('importeValido', () => {
    it.each([
      ['65,23', 65.23], ['65.23', 65.23], ['1.234,56', 1234.56], ['70', 70], [' 12,5 € ', 12.5],
    ])('%s → %s', (entrada, esperado) => {
      expect(ctrl.importeValido(entrada)).toBe(esperado);
    });
    it('vacío es «no viene» (es opcional)', () => {
      expect(ctrl.importeValido('')).toBeUndefined();
      expect(ctrl.importeValido(undefined)).toBeUndefined();
    });
    it.each(['abc', '-5', '1,234', '12.345.678.901,00'])('%s no se entiende', (entrada) => {
      expect(ctrl.importeValido(entrada)).toBeNaN();
    });
  });

  describe('fechaValida', () => {
    it('acepta una fecha que existe y rechaza las que no', () => {
      expect(ctrl.fechaValida('2026-09-30')).toBe('2026-09-30');
      expect(ctrl.fechaValida('2026-02-30')).toBeNull();
      expect(ctrl.fechaValida('30/09/2026')).toBeNull();
      expect(ctrl.fechaValida('')).toBeNull();
    });
  });

  describe('esPdf y nombreDescarga', () => {
    it('mira la cabecera del fichero', () => {
      expect(ctrl.esPdf(PDF)).toBe(true);
      expect(ctrl.esPdf(Buffer.from('<html>'))).toBe(false);
      expect(ctrl.esPdf(null)).toBe(false);
    });
    it('el nombre de descarga no lleva nada que rompa la cabecera', () => {
      expect(ctrl.nombreDescarga({ id: 1, proveedor: 'Google Ads', numero: '57/05"69' }))
        .toBe('Factura_Google_Ads_57_05_69.pdf');
      expect(ctrl.nombreDescarga({ id: 9, proveedor: 'Taller Peñalara', numero: '***' }))
        .toBe('Factura_Taller_Penalara_9.pdf');
    });
  });

  describe('listFacturas', () => {
    it('no trae el PDF y devuelve el importe como número', async () => {
      query.mockResolvedValueOnce([[{ id: 1, proveedor: 'Google Ads', importe: '65.23' }, { id: 2, importe: null }]]);
      const res = mockRes();
      await ctrl.listFacturas(mockReq({ user: ADMIN }), res, mockNext());

      const [sql] = query.mock.calls[0];
      expect(sql).not.toMatch(/contenido/);
      expect(sql).not.toMatch(/SELECT \*/);
      expect(sql).toMatch(/ORDER BY f\.fecha_emision DESC/);
      expect(res._json.data.map(f => f.importe)).toEqual([65.23, null]);
    });

    it('un fallo de BD va al manejador de errores', async () => {
      query.mockRejectedValueOnce(new Error('caída'));
      const next = mockNext();
      await ctrl.listFacturas(mockReq({ user: ADMIN }), mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('createFactura', () => {
    it('guarda el PDF tal cual, la audita y devuelve la fila sin contenido', async () => {
      query
        .mockResolvedValueOnce([{ insertId: 7 }])
        .mockResolvedValueOnce([[{ id: 7, proveedor: 'Google Ads', numero: '5705694492', importe: '65.23' }]]);
      const res = mockRes();
      await ctrl.createFactura(subida(), res, mockNext());

      expect(res.statusCode).toBe(201);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO facturas/);
      expect(params.slice(0, 7)).toEqual(['Google Ads', '5705694492', '2026-09-30', 65.23, null, '5705694492.pdf', PDF.length]);
      expect(params[7]).toBe(PDF);
      expect(params[8]).toBe(ADMIN.id);
      expect(query.mock.calls[1][0]).not.toMatch(/contenido/);
      expect(res._json.data.importe).toBe(65.23);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'create_factura', entityId: 7,
        details: expect.objectContaining({ proveedor: 'Google Ads', numero: '5705694492' }),
      }));
    });

    it('sin importe guarda NULL', async () => {
      query.mockResolvedValueOnce([{ insertId: 8 }]).mockResolvedValueOnce([[{ id: 8, importe: null }]]);
      const res = mockRes();
      await ctrl.createFactura(subida({ importe: '' }), res, mockNext());
      expect(query.mock.calls[0][1][3]).toBeNull();
      expect(res._json.data.importe).toBeNull();
    });

    it('sin fichero → 400', async () => {
      const res = mockRes();
      await ctrl.createFactura(subida({}, null), res, mockNext());
      expect(res.statusCode).toBe(400);
      expect(query).not.toHaveBeenCalled();
    });

    it('un fichero que no es PDF → 400, aunque diga ser PDF', async () => {
      const res = mockRes();
      const html = Buffer.from('<html></html>');
      await ctrl.createFactura(subida({}, { buffer: html, size: html.length, originalname: 'x.pdf', mimetype: 'application/pdf' }), res, mockNext());
      expect(res.statusCode).toBe(400);
      expect(res._json.message).toMatch(/no es un PDF/);
      expect(query).not.toHaveBeenCalled();
    });

    it.each([
      [{ proveedor: '' }, 'proveedor'],
      [{ numero: '   ' }, 'numero'],
      [{ fecha_emision: '2026-13-01' }, 'fecha_emision'],
      [{ fecha_emision: '2999-01-01' }, 'fecha_emision'],
      [{ importe: 'mucho' }, 'importe'],
      [{ notas: 'x'.repeat(256) }, 'notas'],
    ])('%j → 422 en %s', async (campos, campo) => {
      const res = mockRes();
      await ctrl.createFactura(subida(campos), res, mockNext());
      expect(res.statusCode).toBe(422);
      expect(res._json.errors.map(e => e.campo)).toContain(campo);
      expect(query).not.toHaveBeenCalled();
    });

    it('la misma factura otra vez → 409 con un mensaje que se entiende', async () => {
      query.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }));
      const res = mockRes();
      await ctrl.createFactura(subida(), res, mockNext());
      expect(res.statusCode).toBe(409);
      expect(res._json.message).toBe('Ya hay una factura 5705694492 de Google Ads');
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('otro fallo de BD va al manejador de errores', async () => {
      query.mockRejectedValueOnce(new Error('caída'));
      const next = mockNext();
      await ctrl.createFactura(subida(), mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('downloadFactura', () => {
    it('manda el PDF como descarga, sin caché', async () => {
      query.mockResolvedValueOnce([[{ id: 3, proveedor: 'Google Ads', numero: '5705694492', contenido: PDF }]]);
      const res = mockRes();
      await ctrl.downloadFactura(mockReq({ user: ADMIN, params: { id: '3' } }), res, mockNext());

      const cabeceras = res.set.mock.calls[0][0];
      expect(cabeceras['Content-Type']).toBe('application/pdf');
      expect(cabeceras['Cache-Control']).toBe('no-store');
      expect(cabeceras['Content-Disposition']).toBe('attachment; filename="Factura_Google_Ads_5705694492.pdf"');
      expect(cabeceras['Content-Length']).toBe(String(PDF.length));
      expect(res.send).toHaveBeenCalledWith(PDF);
    });

    it('id que no existe → 404; id raro → 400', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await ctrl.downloadFactura(mockReq({ user: ADMIN, params: { id: '99' } }), res, mockNext());
      expect(res.statusCode).toBe(404);

      const res2 = mockRes();
      await ctrl.downloadFactura(mockReq({ user: ADMIN, params: { id: 'abc' } }), res2, mockNext());
      expect(res2.statusCode).toBe(400);
    });

    it('un fallo de BD va al manejador de errores', async () => {
      query.mockRejectedValueOnce(new Error('caída'));
      const next = mockNext();
      await ctrl.downloadFactura(mockReq({ user: ADMIN, params: { id: '3' } }), mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('deleteFactura', () => {
    it('borra y deja en la auditoría qué factura era', async () => {
      query
        .mockResolvedValueOnce([[{ id: 3, proveedor: 'Google Ads', numero: '5705694492', fecha_emision: '2026-09-30', importe: '65.23', origen: 'manual' }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);
      const res = mockRes();
      await ctrl.deleteFactura(mockReq({ user: ADMIN, params: { id: '3' } }), res, mockNext());

      expect(res.statusCode).toBe(200);
      expect(query.mock.calls[1]).toEqual(['DELETE FROM facturas WHERE id = ?', [3]]);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'delete_factura', entityId: 3,
        details: expect.objectContaining({ numero: '5705694492', importe: 65.23 }),
      }));
    });

    it('id que no existe → 404 sin borrar nada; id raro → 400', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await ctrl.deleteFactura(mockReq({ user: ADMIN, params: { id: '99' } }), res, mockNext());
      expect(res.statusCode).toBe(404);
      expect(query).toHaveBeenCalledTimes(1);

      const res2 = mockRes();
      await ctrl.deleteFactura(mockReq({ user: ADMIN, params: { id: '0' } }), res2, mockNext());
      expect(res2.statusCode).toBe(400);
    });

    it('un fallo de BD va al manejador de errores', async () => {
      query.mockRejectedValueOnce(new Error('caída'));
      const next = mockNext();
      await ctrl.deleteFactura(mockReq({ user: ADMIN, params: { id: '3' } }), mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});

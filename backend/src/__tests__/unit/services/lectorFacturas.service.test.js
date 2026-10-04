'use strict';

/**
 * Tests de services/lectorFacturas.service.js (paso 1 de la subida de facturas).
 *
 * Lo que importa: que saque bien los cuatro datos de facturas con formatos
 * distintos, y sobre todo que NO adivine: lo que no está claro se queda en
 * null (subtotales, fechas de vencimiento, fechas tomadas por números, la
 * propia empresa tomada por el proveedor). Y que un PDF que no se puede leer
 * no lance. pdf.js (unpdf) se simula: es ESM y Jest no lo carga.
 */

const mockDoc = { numPages: 1, getPage: jest.fn(), destroy: jest.fn() };
jest.mock('unpdf', () => ({ getDocumentProxy: jest.fn() }));
jest.mock('../../../controllers/admin.controller', () => ({ logAudit: jest.fn(), logError: jest.fn() }));
jest.mock('../../../utils/fecha.utils', () => ({
  ...jest.requireActual('../../../utils/fecha.utils'),
  ahora: () => new Date('2026-10-04T10:00:00Z'),
}));

const { getDocumentProxy } = require('unpdf');
const lector = require('../../../services/lectorFacturas.service');

const GOOGLE = [
  'Google Ireland Limited',
  'Gordon House, Barrow Street, Dublin 4',
  'Factura',
  'Número de factura: 5705694492',
  'Fecha de la factura: 30 sept 2026',
  'Facturar a VAPSS SL',
  'Subtotal en EUR 53,91 €',
  'IVA (21 %) 11,32 €',
  'Total en EUR 65,23 €',
  'Total pagado 0,00 €',
].join('\n');

const TALLER = [
  'TALLERES PÉREZ, S.L.',
  'CIF B11111111',
  'Cliente: VAPSS S.L.',
  'Factura nº: A-2026/0153',
  'Fecha: 03/10/2026',
  'Fecha de vencimiento: 03/11/2026',
  'Base imponible 1.000,00',
  'Total IVA 210,00',
  'TOTAL FACTURA 1.210,00 €',
].join('\n');

/** Una página de pdf.js con estos renglones (cada uno en su altura). */
function pagina(lineas, conEol = false) {
  return {
    getTextContent: jest.fn().mockResolvedValue({
      items: lineas.flatMap((l, i) => l.split(' | ').map(trozo => ({ str: trozo, transform: [1, 0, 0, 1, 50, 800 - i * 20], hasEOL: conEol }))),
    }),
  };
}

describe('lectorFacturas.service', () => {
  beforeEach(() => {
    getDocumentProxy.mockReset();
    mockDoc.getPage.mockReset();
    mockDoc.destroy.mockReset();
    mockDoc.numPages = 1;
  });

  describe('datosDelTexto', () => {
    it('factura de Google: alias «Google Ads», número, fecha en letra y el total con IVA', () => {
      expect(lector.datosDelTexto(GOOGLE)).toEqual({
        proveedor: 'Google Ads', numero: '5705694492', fecha_emision: '2026-09-30', importe: 65.23,
      });
    });

    it('factura de un taller: la sociedad, «Factura nº», «Fecha:» y no la de vencimiento, total con miles', () => {
      expect(lector.datosDelTexto(TALLER)).toEqual({
        proveedor: 'TALLERES PÉREZ, S.L.', numero: 'A-2026/0153', fecha_emision: '2026-10-03', importe: 1210,
      });
    });

    it('lo que no encuentra se queda en null, no se inventa', () => {
      expect(lector.datosDelTexto('Hola\nesto no es una factura')).toEqual({
        proveedor: null, numero: null, fecha_emision: null, importe: null,
      });
    });
  });

  describe('proveedorDe', () => {
    it('prefiere uno ya guardado que salga en el texto, escrito como está guardado', () => {
      expect(lector.proveedorDe('REPSOL COMERCIAL S.A.\nFactura', ['Repsol Comercial', 'Repsol'])).toBe('Repsol Comercial');
    });
    it('ignora conocidos de menos de 3 letras (casarían con cualquier cosa)', () => {
      expect(lector.proveedorDe('algo sin sociedad', ['al'])).toBeNull();
    });
    it('usa la etiqueta «Proveedor:» / «Emisor:»', () => {
      expect(lector.proveedorDe('Emisor: Ferretería Lola\nCliente: VAPSS')).toBe('Ferretería Lola');
    });
    it('nunca toma a la propia empresa por el proveedor', () => {
      expect(lector.proveedorDe('VAPSS S.L.\nOtra Cosa SLU')).toBe('Otra Cosa SLU');
      expect(lector.proveedorDe('Emisor: VAPSS SL')).toBeNull();
    });
  });

  describe('numeroDe', () => {
    it.each([
      ['Invoice number: INV-2026-001', 'INV-2026-001'],
      ['Nº de factura: F/26/0042.', 'F/26/0042'],
      ['FACTURA Nº 2026-17', '2026-17'],
      ['Factura: 000123', '000123'],
    ])('%s → %s', (texto, numero) => {
      expect(lector.numeroDe(texto)).toBe(numero);
    });
    it('una fecha detrás de «Fecha de factura:» no es el número', () => {
      expect(lector.numeroDe('Fecha de factura: 30/09/2026')).toBeNull();
      expect(lector.numeroDe('Factura: 30/09/2026')).toBeNull();
    });
    it('una palabra sin dígitos detrás de la etiqueta no es el número', () => {
      expect(lector.numeroDe('Factura: rectificativa')).toBeNull();
    });
    it('si el texto no lo dice, el número largo del nombre del fichero', () => {
      expect(lector.numeroDe('nada', '5705694492.pdf')).toBe('5705694492');
      expect(lector.numeroDe('nada', 'factura.pdf')).toBeNull();
    });
  });

  describe('fechaDe', () => {
    it.each([
      ['Fecha de emisión: 2026-09-30', '2026-09-30'],
      ['Fecha de expedición 30.09.26', '2026-09-30'],
      ['Invoice date: Sep 30, 2026', '2026-09-30'],
      ['Fecha factura: 1 de octubre de 2026', '2026-10-01'],
    ])('%s → %s', (texto, fecha) => {
      expect(lector.fechaDe(texto)).toBe(fecha);
    });
    it('no coge la de vencimiento ni una fecha sin etiqueta', () => {
      expect(lector.fechaDe('Fecha de vencimiento: 30/09/2026')).toBeNull();
      expect(lector.fechaDe('Periodo 01/09/2026 - 30/09/2026')).toBeNull();
    });
    it('descarta fechas imposibles o futuras', () => {
      expect(lector.fechaDe('Fecha: 31/02/2026')).toBeNull();
      expect(lector.fechaDe('Fecha: 05/10/2026')).toBeNull();
    });
  });

  describe('importeDe', () => {
    it('formato inglés y el € delante', () => {
      expect(lector.importeDe('Total due €1,234.50')).toBe(1234.5);
    });
    it('una racha enorme de dígitos tras «total» no cuelga la API (era cuadrático) ni da importe', () => {
      const t0 = Date.now();
      expect(lector.importeDe(`total ${'9'.repeat(200000)}`)).toBeNull();
      expect(lector.datosDelTexto(`total factura nº ${'1'.repeat(150000)}\n`.repeat(2)).importe).toBeNull();
      expect(Date.now() - t0).toBeLessThan(1000);
    });
    it('sin una línea de total no hay importe (la base o el IVA solos no valen)', () => {
      expect(lector.importeDe('Base imponible 100,00\nIVA 21,00')).toBeNull();
      expect(lector.importeDe('Subtotal 100,00')).toBeNull();
    });
  });

  describe('textoDePdf y leerFactura', () => {
    it('une los trozos de cada renglón y separa los renglones por su altura', async () => {
      getDocumentProxy.mockResolvedValue(mockDoc);
      mockDoc.getPage.mockResolvedValue(pagina(['Total en EUR | 65,23 €', 'Número de factura: | 123456']));
      expect(await lector.textoDePdf(Buffer.from('%PDF-'))).toBe('Total en EUR 65,23 €\nNúmero de factura: 123456');
      expect(getDocumentProxy).toHaveBeenCalledWith(expect.any(Uint8Array), { isEvalSupported: false });
      expect(mockDoc.destroy).toHaveBeenCalled();
    });

    it('respeta los fines de renglón que marca el PDF y no pasa de 5 páginas', async () => {
      getDocumentProxy.mockResolvedValue(mockDoc);
      mockDoc.numPages = 40;
      mockDoc.getPage.mockResolvedValue(pagina(['uno'], true));
      expect(await lector.textoDePdf(Buffer.from('%PDF-'))).toBe('uno\nuno\nuno\nuno\nuno');
      expect(mockDoc.getPage).toHaveBeenCalledTimes(5);
    });

    it('un PDF que no se abre da texto vacío, no un error', async () => {
      getDocumentProxy.mockRejectedValue(new Error('Invalid PDF structure'));
      expect(await lector.textoDePdf(Buffer.from('%PDF-'))).toBe('');
    });

    it('leerFactura con texto devuelve los datos', async () => {
      getDocumentProxy.mockResolvedValue(mockDoc);
      mockDoc.getPage.mockResolvedValue(pagina(GOOGLE.split('\n')));
      const r = await lector.leerFactura(Buffer.from('%PDF-'), { nombreFichero: 'x.pdf' });
      expect(r).toEqual({ con_texto: true, datos: { proveedor: 'Google Ads', numero: '5705694492', fecha_emision: '2026-09-30', importe: 65.23 } });
    });

    it('un PDF escaneado (sin texto) avisa y solo saca lo que diga el nombre del fichero', async () => {
      getDocumentProxy.mockResolvedValue(mockDoc);
      mockDoc.getPage.mockResolvedValue(pagina([]));
      const r = await lector.leerFactura(Buffer.from('%PDF-'), { nombreFichero: '5705694492.pdf' });
      expect(r).toEqual({ con_texto: false, datos: { proveedor: null, numero: '5705694492', fecha_emision: null, importe: null } });
    });
  });
});

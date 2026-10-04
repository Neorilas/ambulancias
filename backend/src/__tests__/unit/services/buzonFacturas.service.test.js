'use strict';

/**
 * Tests de services/buzonFacturas.service.js, con el IMAP y el parser simulados.
 *
 * Lo que importa: que solo entren PDF de verdad de remitentes permitidos, que
 * no se dupliquen entre pasadas, que el buzón se abra en solo lectura, que un
 * fallo (contraseña mala, servidor caído) no lance y se explique, y que dos
 * pasadas a la vez no se pisen.
 */

const mockCliente = {
  connect: jest.fn(),
  getMailboxLock: jest.fn(),
  search: jest.fn(),
  fetch: jest.fn(),
  fetchOne: jest.fn(),
  logout: jest.fn(),
  on: jest.fn(),
};
const mockRelease = jest.fn();
const mockOpciones = [];

jest.mock('imapflow', () => ({
  ImapFlow: jest.fn().mockImplementation((opts) => { mockOpciones.push(opts); return mockCliente; }),
}));
jest.mock('mailparser', () => ({ simpleParser: jest.fn() }));
jest.mock('../../../controllers/admin.controller', () => ({ logAudit: jest.fn(), logError: jest.fn() }));

const { simpleParser } = require('mailparser');
const { query } = require('../../../config/database');
const { logAudit } = require('../../../controllers/admin.controller');
const buzon = require('../../../services/buzonFacturas.service');

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1');
const ENV = {
  FACTURAS_IMAP_USUARIO: 'facturas@vapss.net',
  FACTURAS_IMAP_CONTRASENA: 'secreta',
  FACTURAS_REMITENTES: 'google.com',
};

/** Un async iterable con los mensajes que da fetch(). */
function iterable(mensajes) {
  return { async *[Symbol.asyncIterator]() { for (const m of mensajes) yield m; } };
}

const estructuraConPdf = { type: 'multipart/mixed', childNodes: [
  { type: 'text/plain' },
  { type: 'application/octet-stream', dispositionParameters: { filename: '5705694492.pdf' } },
] };

const FIRMA_GOOGLE = 'mx.hostalia.es; dkim=pass header.d=google.com header.s=20230601; spf=pass smtp.mailfrom=google.com; dmarc=pass (p=REJECT) header.from=google.com';

function correoGoogle(extra = {}) {
  return {
    headers: new Map([['authentication-results', FIRMA_GOOGLE]]),
    from: { value: [{ address: 'payments-noreply@google.com', name: 'Google Payments' }] },
    subject: 'Tu factura de Google Ads está disponible',
    text: 'Importe total: 65,23 €',
    date: new Date('2026-10-02T08:00:00Z'),
    attachments: [{ filename: '5705694492.pdf', content: PDF }],
    ...extra,
  };
}

describe('buzonFacturas.service', () => {
  const envAntes = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, ENV);
    buzon._reiniciar();
    mockOpciones.length = 0;
    Object.values(mockCliente).forEach(f => f.mockReset());
    mockRelease.mockReset();
    mockCliente.getMailboxLock.mockResolvedValue({ release: mockRelease });
    mockCliente.search.mockResolvedValue([11]);
    mockCliente.fetch.mockReturnValue(iterable([
      { uid: 11, envelope: { from: [{ address: 'payments-noreply@google.com' }] }, bodyStructure: estructuraConPdf },
    ]));
    mockCliente.fetchOne.mockResolvedValue({ source: Buffer.from('correo crudo') });
    simpleParser.mockReset();
    simpleParser.mockResolvedValue(correoGoogle());
    query.mockReset();
    query.mockImplementation(async (sql) => {
      if (/SELECT id FROM facturas/.test(sql)) return [[]];
      if (/INSERT INTO facturas/.test(sql)) return [{ insertId: 21 }];
      return [[]];
    });
    logAudit.mockReset();
  });

  afterAll(() => { process.env = envAntes; });

  describe('lo que se deduce de cada correo', () => {
    it('remitentePermitido: dominio, subdominio o dirección exacta; nada más', () => {
      expect(buzon.remitentePermitido('payments-noreply@google.com', ['google.com'])).toBe(true);
      expect(buzon.remitentePermitido('x@ads.google.com', ['google.com'])).toBe(true);
      expect(buzon.remitentePermitido('x@google.com.estafa.io', ['google.com'])).toBe(false);
      expect(buzon.remitentePermitido('x@notgoogle.com', ['google.com'])).toBe(false);
      expect(buzon.remitentePermitido('taller@pepe.es', ['taller@pepe.es'])).toBe(true);
      expect(buzon.remitentePermitido('otro@pepe.es', ['taller@pepe.es'])).toBe(false);
      expect(buzon.remitentePermitido('', ['google.com'])).toBe(false);
    });

    it('proveedorDe: Google es «Google Ads», como a mano; el resto, su nombre o dominio', () => {
      expect(buzon.proveedorDe('payments-noreply@google.com', 'Google Payments')).toBe('Google Ads');
      expect(buzon.proveedorDe('fact@taller.es', 'Taller Peñalara')).toBe('Taller Peñalara');
      expect(buzon.proveedorDe('fact@taller.es', '')).toBe('taller.es');
    });

    it('tienePdf mira el tipo y el nombre, en cualquier nivel', () => {
      expect(buzon.tienePdf(estructuraConPdf)).toBe(true);
      expect(buzon.tienePdf({ type: 'application/pdf' })).toBe(true);
      expect(buzon.tienePdf({ type: 'multipart/mixed', childNodes: [{ type: 'image/png', parameters: { name: 'a.png' } }] })).toBe(false);
      expect(buzon.tienePdf(null)).toBe(false);
    });

    it('numeroDe: el número del nombre del PDF, o el del texto, o el nombre con el día', () => {
      expect(buzon.numeroDe('5705694492.pdf', '')).toBe('5705694492');
      expect(buzon.numeroDe('factura.pdf', 'Número de factura: FA-2026-77')).toBe('FA-2026-77');
      expect(buzon.numeroDe('octubre.pdf', 'hola', '2026-10-02')).toBe('octubre-2026-10-02');
      expect(buzon.numeroDe('', '')).toBe('sin-numero');
    });

    it('numeroDe nunca pasa de 64 caracteres (la columna): si pasara, ese correo bloquearía el buzón', () => {
      expect(buzon.numeroDe(`${'9'.repeat(90)}.pdf`, '')).toHaveLength(64);
      expect(buzon.numeroDe('x.pdf', `Invoice number: ${'A'.repeat(90)}`)).toHaveLength(64);
      expect(buzon.numeroDe(`${'n'.repeat(90)}.pdf`, '', '2026-10-02')).toHaveLength(64);
      expect(buzon.numeroDe(`${'n'.repeat(90)}.pdf`, '', '2026-10-02')).toMatch(/-2026-10-02$/);
    });

    it('firmaValida: solo el primer Authentication-Results, con DKIM o DMARC del dominio permitido', () => {
      expect(buzon.firmaValida(FIRMA_GOOGLE, ['google.com'])).toBe(true);
      expect(buzon.firmaValida('mx; dkim=pass header.d=accounts.google.com', ['google.com'])).toBe(true);
      expect(buzon.firmaValida('mx; dkim=fail header.d=google.com; dmarc=fail header.from=google.com', ['google.com'])).toBe(false);
      expect(buzon.firmaValida('mx; dkim=pass header.d=estafa.io; dmarc=pass header.from=estafa.io', ['google.com'])).toBe(false);
      expect(buzon.firmaValida('mx; dkim=pass header.d=google.com.estafa.io', ['google.com'])).toBe(false);
      // Uno falso que traiga el propio correo va debajo del de nuestro servidor
      expect(buzon.firmaValida(['mx; dkim=none', FIRMA_GOOGLE], ['google.com'])).toBe(false);
      expect(buzon.firmaValida(FIRMA_GOOGLE, ['payments-noreply@google.com'])).toBe(true);
      expect(buzon.firmaValida(undefined, ['google.com'])).toBe(false);
    });

    it('importeDe: el total del texto, o null', () => {
      expect(buzon.importeDe('Importe total: 65,23 €')).toBe(65.23);
      expect(buzon.importeDe('Total: €1.234,56')).toBe(1234.56);
      expect(buzon.importeDe('Gracias por anunciarte')).toBeNull();
    });

    it('datosDeFactura: fecha en hora española del día que llegó el correo', () => {
      const d = buzon.datosDeFactura(correoGoogle({ date: new Date('2026-09-30T22:30:00Z') }), { filename: '5705694492.pdf' });
      expect(d).toMatchObject({ proveedor: 'Google Ads', numero: '5705694492', fecha: '2026-10-01', importe: 65.23 });
      const sinFecha = buzon.datosDeFactura(correoGoogle({ date: undefined }), { filename: 'f.pdf' });
      expect(sinFecha.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.notas).toMatch(/^Recibida por correo: Tu factura/);
    });
  });

  describe('revisarBuzon', () => {
    it('sin usuario o contraseña no se conecta', async () => {
      process.env.FACTURAS_IMAP_CONTRASENA = '';
      expect(buzon.configurado()).toBe(false);
      const r = await buzon.revisarBuzon();
      expect(r).toMatchObject({ ok: false, error: 'Buzón sin configurar' });
      expect(mockCliente.connect).not.toHaveBeenCalled();
    });

    it('guarda el PDF con origen correo, lo audita y abre el buzón en solo lectura por TLS', async () => {
      const r = await buzon.revisarBuzon();

      expect(r).toMatchObject({ ok: true, revisados: 1, importadas: 1, ya_estaban: 0, descartados: 0, sin_firma: 0, errores: 0 });
      // Sin este listener, un corte de red tras conectar tumbaría el proceso
      expect(mockCliente.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(() => mockCliente.on.mock.calls[0][1](Object.assign(new Error('x'), { code: 'ECONNRESET' }))).not.toThrow();
      expect(mockOpciones[0]).toMatchObject({ host: 'imap.servidor-correo.net', port: 993, secure: true,
        auth: { user: 'facturas@vapss.net', pass: 'secreta' } });
      expect(mockCliente.getMailboxLock).toHaveBeenCalledWith('INBOX', { readOnly: true });
      const insert = query.mock.calls.find(([sql]) => /INSERT INTO facturas/.test(sql));
      expect(insert[0]).toMatch(/'correo', NULL/);
      expect(insert[1].slice(0, 5)).toEqual(['Google Ads', '5705694492', '2026-10-02', 65.23, expect.stringMatching(/^Recibida por correo/)]);
      expect(insert[1][7]).toBe(PDF);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'import_factura', entityId: 21, userId: null }));
      expect(mockRelease).toHaveBeenCalled();
      expect(mockCliente.logout).toHaveBeenCalled();
      expect(buzon.estado()).toMatchObject({ configurado: true, buzon: 'facturas@vapss.net', ultima: { importadas: 1 } });
    });

    it('lo que ya está guardado no se repite', async () => {
      query.mockImplementation(async (sql) => (/SELECT id FROM facturas/.test(sql) ? [[{ id: 3 }]] : [[]]));
      const r = await buzon.revisarBuzon();
      expect(r).toMatchObject({ ok: true, importadas: 0, ya_estaban: 1 });
      expect(query.mock.calls.some(([sql]) => /INSERT/.test(sql))).toBe(false);
    });

    it('si otra pasada la mete entre medias (ER_DUP_ENTRY), cuenta como que ya estaba', async () => {
      query.mockImplementation(async (sql) => {
        if (/INSERT INTO facturas/.test(sql)) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
        return [[]];
      });
      expect(await buzon.revisarBuzon()).toMatchObject({ ok: true, importadas: 0, ya_estaban: 1 });
    });

    it('ni descarga los correos de remitentes no permitidos ni los que no traen PDF', async () => {
      mockCliente.search.mockResolvedValue([1, 2]);
      mockCliente.fetch.mockReturnValue(iterable([
        { uid: 1, envelope: { from: [{ address: 'spam@estafa.io' }] }, bodyStructure: estructuraConPdf },
        { uid: 2, envelope: { from: [{ address: 'noreply@google.com' }] }, bodyStructure: { type: 'text/html' } },
      ]));
      const r = await buzon.revisarBuzon();
      expect(r).toMatchObject({ ok: true, revisados: 2, descartados: 2, importadas: 0 });
      expect(mockCliente.fetchOne).not.toHaveBeenCalled();
    });

    it('un adjunto que dice ser PDF y no lo es se descarta; y si la cabecera parseada no es de un permitido, también', async () => {
      simpleParser.mockResolvedValueOnce(correoGoogle({ attachments: [{ filename: 'x.pdf', content: Buffer.from('<html>') }] }));
      expect(await buzon.revisarBuzon()).toMatchObject({ ok: true, importadas: 0, descartados: 1 });

      simpleParser.mockResolvedValueOnce(correoGoogle({ from: { value: [{ address: 'otro@estafa.io' }] } }));
      expect(await buzon.revisarBuzon()).toMatchObject({ ok: true, importadas: 0, descartados: 1 });
    });

    it('sin la firma de Google que puso nuestro servidor, no entra (el From se falsifica)', async () => {
      simpleParser.mockResolvedValueOnce(correoGoogle({ headers: new Map([['authentication-results', 'mx; dkim=fail header.d=google.com']]) }));
      expect(await buzon.revisarBuzon()).toMatchObject({ ok: true, importadas: 0, sin_firma: 1 });
      expect(query.mock.calls.some(([sql]) => /INSERT/.test(sql))).toBe(false);

      simpleParser.mockResolvedValueOnce(correoGoogle({ headers: new Map() }));
      expect(await buzon.revisarBuzon()).toMatchObject({ ok: true, importadas: 0, sin_firma: 1 });
    });

    it('con FACTURAS_EXIGIR_FIRMA=0 no se mira la firma', async () => {
      process.env.FACTURAS_EXIGIR_FIRMA = '0';
      simpleParser.mockResolvedValueOnce(correoGoogle({ headers: new Map() }));
      expect(await buzon.revisarBuzon()).toMatchObject({ ok: true, importadas: 1, sin_firma: 0 });
      delete process.env.FACTURAS_EXIGIR_FIRMA;
    });

    it('un adjunto que no se puede guardar no para la pasada: se cuenta y sigue con el siguiente', async () => {
      simpleParser.mockResolvedValueOnce(correoGoogle({ attachments: [
        { filename: '1111111111.pdf', content: PDF },
        { filename: '2222222222.pdf', content: PDF },
      ] }));
      let inserts = 0;
      query.mockImplementation(async (sql) => {
        if (/INSERT INTO facturas/.test(sql)) {
          inserts++;
          if (inserts === 1) throw Object.assign(new Error('Data too long'), { code: 'ER_DATA_TOO_LONG' });
          return [{ insertId: 22 }];
        }
        return [[]];
      });
      expect(await buzon.revisarBuzon()).toMatchObject({ ok: true, importadas: 1, errores: 1 });
    });

    it('un buzón sin correos recientes es una pasada buena', async () => {
      mockCliente.search.mockResolvedValue([]);
      expect(await buzon.revisarBuzon()).toMatchObject({ ok: true, revisados: 0 });
      expect(mockCliente.fetch).not.toHaveBeenCalled();
    });

    it('contraseña mala: no lanza, lo explica y no dice la contraseña', async () => {
      mockCliente.connect.mockRejectedValue(Object.assign(new Error('Command failed'), { authenticationFailed: true }));
      const r = await buzon.revisarBuzon();
      expect(r).toMatchObject({ ok: false, error: 'Usuario o contraseña del buzón incorrectos' });
      expect(JSON.stringify(r)).not.toContain('secreta');
    });

    it('servidor que no existe u otro fallo: no lanza y lo explica', async () => {
      mockCliente.connect.mockRejectedValueOnce(Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }));
      expect(await buzon.revisarBuzon()).toMatchObject({ ok: false, error: 'No se encuentra el servidor imap.servidor-correo.net' });

      mockCliente.connect.mockResolvedValue();
      mockCliente.search.mockRejectedValueOnce(Object.assign(new Error('x'), { responseText: 'Mailbox busy' }));
      expect(await buzon.revisarBuzon()).toMatchObject({ ok: false, error: 'Mailbox busy' });
      expect(mockRelease).toHaveBeenCalled();
    });

    it('dos revisiones a la vez comparten la misma pasada', async () => {
      const [a, b] = await Promise.all([buzon.revisarBuzon(), buzon.revisarBuzon()]);
      expect(a).toBe(b);
      expect(mockCliente.connect).toHaveBeenCalledTimes(1);
    });
  });
});

'use strict';

/**
 * Tests de controllers/backups.controller.js, con ficheros de verdad en una
 * carpeta temporal (BACKUPS_DIR se fija antes de cargar las constantes).
 *
 * Lo que importa: que no se pueda salir de la carpeta con el nombre, que solo
 * se listen dumps, que la descarga pida la contraseña (SEC-18), que cada una
 * quede auditada y avise a los superadmin, y que no se cachee.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { PassThrough } = require('stream');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'backups-test-'));
process.env.BACKUPS_DIR = DIR;

jest.mock('../../../controllers/admin.controller', () => ({ logAudit: jest.fn(), logError: jest.fn() }));
jest.mock('../../../services/push.service', () => ({ notificarSuperadmins: jest.fn().mockResolvedValue({}) }));

const { query } = require('../../../config/database');
const { hashPassword } = require('../../../utils/password.utils');
const push = require('../../../services/push.service');
const { logAudit } = require('../../../controllers/admin.controller');
const { listBackups, downloadBackup } = require('../../../controllers/backups.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

const SUPER = { id: 1, username: 'findelias', roles: ['superadmin'] };
const PASS  = 'Clave.De.Prueba1';
const NOMBRE = 'ambulancia_20260926_034500.sql.gz';
let HASH;

function escribir(nombre, contenido, mtime) {
  const ruta = path.join(DIR, nombre);
  fs.writeFileSync(ruta, contenido);
  if (mtime) fs.utimesSync(ruta, mtime, mtime);
}

/** Respuesta que se puede usar de destino de un pipe y guarda lo recibido. */
function resDescarga() {
  const res = new PassThrough();
  const trozos = [];
  res.on('data', c => trozos.push(c));
  res.cabeceras = {};
  res.statusCode = 200;
  res.set = jest.fn((h) => { Object.assign(res.cabeceras, h); return res; });
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((d) => { res._json = d; res.end(); return res; });
  res.cuerpo = () => new Promise(r => res.on('finish', () => r(Buffer.concat(trozos).toString())));
  return res;
}

describe('backups.controller', () => {
  beforeAll(async () => { HASH = await hashPassword(PASS); });
  beforeEach(() => {
    for (const f of fs.readdirSync(DIR)) fs.unlinkSync(path.join(DIR, f));
    logAudit.mockReset();
    push.notificarSuperadmins.mockClear();
    query.mockReset();
    query.mockResolvedValue([[{ password_hash: HASH }]]);
  });
  afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

  describe('listBackups', () => {
    it('lista solo los dumps, del más reciente al más antiguo', async () => {
      escribir('ambulancia_20260925_034500.sql.gz', 'a', new Date('2026-09-25T03:45:00Z'));
      escribir('ambulancia_20260926_034500.sql.gz', 'bb', new Date('2026-09-26T03:45:00Z'));
      escribir('ambulancia_20260926_034500.sql.gz.parcial', 'x');
      escribir('notas.txt', 'x');

      const res = mockRes();
      await listBackups(mockReq({ user: SUPER }), res, mockNext());

      const { disponible, backups } = res._json.data;
      expect(disponible).toBe(true);
      expect(backups.map(b => b.nombre)).toEqual([
        'ambulancia_20260926_034500.sql.gz',
        'ambulancia_20260925_034500.sql.gz',
      ]);
      expect(backups[0].tamano).toBe(2);
    });

    it('sin carpeta no es un error: dice que no está disponible y por qué', async () => {
      const antes = process.env.BACKUPS_DIR;
      jest.resetModules();
      process.env.BACKUPS_DIR = path.join(DIR, 'no-existe');
      jest.doMock('../../../controllers/admin.controller', () => ({ logAudit: jest.fn() }));
      const ctrl = require('../../../controllers/backups.controller');
      const res = mockRes();
      await ctrl.listBackups(mockReq({ user: SUPER }), res, mockNext());
      process.env.BACKUPS_DIR = antes;

      expect(res.statusCode).toBe(200);
      expect(res._json.data).toEqual({ disponible: false, motivo: 'ENOENT', backups: [] });
    });
  });

  describe('downloadBackup', () => {
    it('sirve el fichero sin caché y deja rastro en la auditoría', async () => {
      escribir(NOMBRE, 'DUMP');
      const res = resDescarga();
      const cuerpo = res.cuerpo();

      await downloadBackup(
        mockReq({ user: SUPER, params: { nombre: NOMBRE }, body: { password: PASS } }),
        res, mockNext()
      );

      expect(await cuerpo).toBe('DUMP');
      expect(query.mock.calls[0][1]).toEqual([1]);
      expect(push.notificarSuperadmins).toHaveBeenCalledWith(expect.objectContaining({
        url: '/admin', cuerpo: expect.stringContaining(`findelias ha descargado ${NOMBRE}`),
      }));
      expect(res.cabeceras['Cache-Control']).toBe('no-store');
      expect(res.cabeceras['Content-Disposition']).toBe('attachment; filename="ambulancia_20260926_034500.sql.gz"');
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        userId: 1, action: 'download_backup',
        details: { nombre: 'ambulancia_20260926_034500.sql.gz', tamano: 4 },
      }));
    });

    it.each([
      '../../etc/passwd',
      '..%2F..%2Fetc%2Fpasswd',
      'ambulancia_20260926_034500.sql.gz/../../x',
      'notas.txt',
    ])('rechaza un nombre que no es un dump: %s', async (nombre) => {
      const res = mockRes();
      await downloadBackup(mockReq({ user: SUPER, params: { nombre } }), res, mockNext());
      expect(res.statusCode).toBe(400);
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('404 si no existe, sin auditar', async () => {
      const res = mockRes();
      await downloadBackup(
        mockReq({ user: SUPER, params: { nombre: 'ambulancia_20200101_000000.sql.gz' }, body: { password: PASS } }),
        res, mockNext()
      );
      expect(res.statusCode).toBe(404);
      expect(logAudit).not.toHaveBeenCalled();
    });

    it.each([
      ['incorrecta', { password: 'otra-cosa' }],
      ['vacía',      { password: '' }],
      ['ausente',    {}],
      ['que no es texto', { password: ['x'] }],
    ])('con la contraseña %s: 403, sin fichero, sin auditar descarga ni avisar (SEC-18)', async (_c, body) => {
      escribir(NOMBRE, 'DUMP');
      const res = mockRes();
      await downloadBackup(mockReq({ user: SUPER, params: { nombre: NOMBRE }, body }), res, mockNext());
      expect(res.statusCode).toBe(403);
      expect(res._json.message).toBe('Contraseña incorrecta');
      expect(logAudit).not.toHaveBeenCalled();
      expect(push.notificarSuperadmins).not.toHaveBeenCalled();
    });

    it('403 si el usuario no tiene hash (no se compara contra nada)', async () => {
      query.mockResolvedValue([[]]);
      const res = mockRes();
      await downloadBackup(mockReq({ user: SUPER, params: { nombre: NOMBRE }, body: { password: PASS } }), res, mockNext());
      expect(res.statusCode).toBe(403);
    });

    it('no se descarga viendo la app como otro superadmin', async () => {
      escribir('ambulancia_20260926_034500.sql.gz', 'DUMP');
      const res = mockRes();
      await downloadBackup(
        mockReq({
          user: { ...SUPER, id: 2, impersonadoPor: { id: 1, username: 'findelias' } },
          params: { nombre: 'ambulancia_20260926_034500.sql.gz' },
        }),
        res, mockNext()
      );
      expect(res.statusCode).toBe(403);
      expect(logAudit).not.toHaveBeenCalled();
    });
  });
});

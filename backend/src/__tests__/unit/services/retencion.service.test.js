'use strict';

/**
 * Tests de services/retencion.service.js
 *
 * Lo caro aquí es borrar de más o dejar basura: que no se toque nada con la
 * retención apagada, que las fotos se borren (fila Y fichero, porque la FK es
 * SET NULL y no lo haría sola), que el contador del vehículo solo suba por las
 * que contaban, y que un fallo no deje ficheros borrados de una fila que sigue.
 *
 * Gotcha del proyecto: `clearAllMocks` no drena la cola de
 * `mockResolvedValueOnce`, así que aquí se usa `mockReset()`.
 */

jest.mock('../../../middleware/upload.middleware', () => ({ deleteFile: jest.fn() }));
jest.mock('../../../controllers/admin.controller', () => ({ logAudit: jest.fn() }));

const { query, transaction } = require('../../../config/database');
const { deleteFile } = require('../../../middleware/upload.middleware');
const { logAudit }   = require('../../../controllers/admin.controller');
const { purgarAsignacionesAntiguas, corteRetencion } = require('../../../services/retencion.service');

const AHORA = new Date('2026-09-27T10:00:00.000Z');

/**
 * Conexión falsa de la transacción: apunta lo que se ejecuta y responde según
 * el SQL. `fotosPorAsig` son las URLs de cada asignación.
 */
function conexion({ fotosPorAsig = {}, fallaEn = null } = {}) {
  const ejecutadas = [];
  const conn = {
    execute: jest.fn(async (sql, params) => {
      ejecutadas.push({ sql, params });
      if (fallaEn && sql.startsWith(fallaEn)) throw new Error('fallo simulado');
      if (sql.startsWith('SELECT image_url')) {
        return [(fotosPorAsig[params[0]] || []).map(image_url => ({ image_url }))];
      }
      if (sql.startsWith('DELETE FROM asignaciones_libres')) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    }),
  };
  transaction.mockImplementation(async (cb) => cb(conn));
  return ejecutadas;
}

describe('retencion.service', () => {
  beforeEach(() => {
    query.mockReset();
    transaction.mockReset();
    deleteFile.mockReset();
    logAudit.mockReset();
  });

  it('corteRetencion resta meses de calendario en UTC', () => {
    expect(corteRetencion(9, AHORA).toISOString()).toBe('2025-12-27T10:00:00.000Z');
  });

  it('apagada (0 meses) no consulta ni borra nada', async () => {
    const r = await purgarAsignacionesAntiguas({ meses: 0, instante: AHORA });
    expect(r.activa).toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('busca solo cerradas o borradas antes del corte, nunca abiertas', async () => {
    query.mockResolvedValueOnce([[]]);
    await purgarAsignacionesAntiguas({ meses: 9, instante: AHORA });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("estado IN ('finalizada', 'cancelada')");
    expect(sql).toContain('COALESCE(finalizado_at, updated_at) < ?');
    expect(sql).toContain('deleted_at < ?');
    expect(sql).not.toMatch(/'activa'|'programada'/);
    expect(params).toEqual([corteRetencion(9, AHORA), corteRetencion(9, AHORA)]);
  });

  it('borra fotos (fila y fichero), la asignación y suma al contador del vehículo', async () => {
    query.mockResolvedValueOnce([[{ id: 5, vehicle_id: 3, contaba: 1 }]]);
    const ejecutadas = conexion({ fotosPorAsig: { 5: ['/uploads/vehicles/a.jpg', '/uploads/vehicles/b.jpg'] } });

    const r = await purgarAsignacionesAntiguas({ meses: 9, instante: AHORA });

    const sqls = ejecutadas.map(e => e.sql);
    expect(sqls[1]).toBe('DELETE FROM vehicle_images WHERE asignacion_id = ?');
    expect(sqls[2]).toBe('DELETE FROM asignaciones_libres WHERE id = ?');
    expect(sqls[3]).toContain('asignaciones_purgadas = asignaciones_purgadas + 1');
    expect(ejecutadas[3].params).toEqual([3]);
    expect(deleteFile.mock.calls.map(c => c[0])).toEqual(['/uploads/vehicles/a.jpg', '/uploads/vehicles/b.jpg']);
    expect(r).toMatchObject({ asignaciones: 1, fotos: 2, fallidas: 0, ids: [5] });
  });

  it('una con borrado lógico se purga pero no suma al contador (ya no contaba)', async () => {
    query.mockResolvedValueOnce([[{ id: 8, vehicle_id: 3, contaba: 0 }]]);
    const ejecutadas = conexion();

    await purgarAsignacionesAntiguas({ meses: 9, instante: AHORA });

    expect(ejecutadas.some(e => e.sql.includes('asignaciones_purgadas'))).toBe(false);
    expect(ejecutadas.some(e => e.sql.startsWith('DELETE FROM asignaciones_libres'))).toBe(true);
  });

  it('si la transacción falla no borra ficheros y sigue con las demás', async () => {
    query.mockResolvedValueOnce([[
      { id: 5, vehicle_id: 3, contaba: 1 },
      { id: 6, vehicle_id: 3, contaba: 1 },
    ]]);
    const conn = { execute: jest.fn() };
    transaction
      .mockImplementationOnce(async () => { throw new Error('deadlock'); })
      .mockImplementationOnce(async (cb) => cb(conn));
    conn.execute
      .mockResolvedValueOnce([[{ image_url: '/uploads/vehicles/c.jpg' }]])
      .mockResolvedValue([{ affectedRows: 1 }]);

    const r = await purgarAsignacionesAntiguas({ meses: 9, instante: AHORA });

    expect(r).toMatchObject({ asignaciones: 1, fallidas: 1, ids: [6] });
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith('/uploads/vehicles/c.jpg');
  });

  it('pide la siguiente tanda saltando las fallidas con OFFSET', async () => {
    const tanda = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, vehicle_id: 1, contaba: 1 }));
    query.mockResolvedValueOnce([tanda]).mockResolvedValueOnce([[]]);
    let n = 0;
    transaction.mockImplementation(async (cb) => {
      n++;
      if (n === 1) throw new Error('falla la primera');
      return cb({ execute: jest.fn(async (sql) => (sql.startsWith('SELECT') ? [[]] : [{ affectedRows: 1 }])) });
    });

    const r = await purgarAsignacionesAntiguas({ meses: 9, instante: AHORA });

    expect(r).toMatchObject({ asignaciones: 99, fallidas: 1 });
    expect(query.mock.calls[1][0]).toContain('OFFSET 1');
  });

  it('deja rastro en la auditoría solo si ha purgado algo', async () => {
    query.mockResolvedValueOnce([[]]);
    await purgarAsignacionesAntiguas({ meses: 9, instante: AHORA });
    expect(logAudit).not.toHaveBeenCalled();

    query.mockResolvedValueOnce([[{ id: 5, vehicle_id: 3, contaba: 1 }]]);
    conexion();
    await purgarAsignacionesAntiguas({ meses: 9, instante: AHORA });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'purga_retencion',
      details: expect.objectContaining({ meses: 9, asignaciones: 1, ids: [5] }),
    }));
  });

  it('no cuenta la que ya no estaba (otra pasada se adelantó)', async () => {
    query.mockResolvedValueOnce([[{ id: 5, vehicle_id: 3, contaba: 1 }]]);
    transaction.mockImplementation(async (cb) => cb({
      execute: jest.fn(async (sql) => (sql.startsWith('SELECT') ? [[]] : [{ affectedRows: 0 }])),
    }));
    const r = await purgarAsignacionesAntiguas({ meses: 9, instante: AHORA });
    expect(r).toMatchObject({ asignaciones: 0, fallidas: 0, ids: [] });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('si falla la auditoría no lanza: la purga ya está hecha', async () => {
    query.mockResolvedValueOnce([[{ id: 5, vehicle_id: 3, contaba: 1 }]]);
    conexion();
    logAudit.mockRejectedValueOnce(new Error('audit_logs caída'));
    await expect(purgarAsignacionesAntiguas({ meses: 9, instante: AHORA }))
      .resolves.toMatchObject({ asignaciones: 1 });
  });

  it('no lanza si falla la consulta de candidatas', async () => {
    query.mockRejectedValueOnce(new Error('BD caída'));
    await expect(purgarAsignacionesAntiguas({ meses: 9, instante: AHORA }))
      .resolves.toMatchObject({ activa: true, asignaciones: 0 });
  });
});

'use strict';

/**
 * El contrato de fechas del proyecto (ver utils/fecha.utils.js) se apoya en dos
 * cosas de este fichero, y si alguna se cae las horas vuelven a guardarse
 * desplazadas +1h/+2h *en silencio* — es lo que pasó con las horas de
 * finalización de servicio. Estos tests las fijan.
 */

// `setup.js` mockea config/database para todo el resto de la batería; aquí hay
// que probar el módulo de verdad, así que se desmockea y se simula mysql2.
jest.unmock('../../../config/database');

// El prefijo `mock` es lo que permite a jest referenciarla desde la factoría.
const mockCreatePool = jest.fn();

jest.mock('mysql2/promise', () => ({
  createPool: (...args) => {
    mockCreatePool(...args);
    return {
      on:            jest.fn(),
      getConnection: jest.fn(),
      query:         jest.fn(),
      execute:       jest.fn(),
    };
  },
}));

jest.mock('../../../utils/logger.utils', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

describe('config/database', () => {
  let poolMock;
  let db;
  let logger;

  beforeAll(() => {
    jest.isolateModules(() => {
      db = require('../../../config/database');
      logger = require('../../../utils/logger.utils');
      poolMock = db.pool;
    });
  });

  it('un error de BD no vuelca al log el PDF de una factura (ni textos enormes)', async () => {
    const pdf = Buffer.alloc(5 * 1024 * 1024, 1);
    poolMock.query.mockRejectedValueOnce(Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' }));

    await expect(db.query('INSERT INTO facturas VALUES (?, ?, ?)', ['Google Ads', pdf, 'x'.repeat(2000)]))
      .rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });

    const [, meta] = logger.error.mock.calls[0];
    expect(meta.params[0]).toBe('Google Ads');
    expect(meta.params[1]).toBe(`[Buffer ${pdf.length} B]`);
    expect(meta.params[2]).toMatch(/\[2000 caracteres\]$/);
    expect(JSON.stringify(meta).length).toBeLessThan(1000);
  });

  it('crea el pool en UTC: mysql2 serializa las fechas sin desplazarlas', () => {
    expect(mockCreatePool).toHaveBeenCalledTimes(1);
    expect(mockCreatePool.mock.calls[0][0]).toMatchObject({ timezone: '+00:00' });
  });

  it('fija la sesión en UTC en cada conexión nueva del pool', () => {
    const [evento, handler] = poolMock.on.mock.calls[0];
    expect(evento).toBe('connection');

    // La otra mitad del contrato: sin este SET, la zona del contenedor de MySQL
    // mandaría sobre CURRENT_TIMESTAMP y sobre cómo se leen los TIMESTAMP.
    const conn = { query: jest.fn() };
    handler(conn);
    expect(conn.query).toHaveBeenCalledWith("SET time_zone = '+00:00'", expect.any(Function));
  });
});

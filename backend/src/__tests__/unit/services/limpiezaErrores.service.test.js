'use strict';

/**
 * Tests de services/limpiezaErrores.service.js — purga de error_logs.
 */

const { query } = require('../../../config/database');
const logger    = require('../../../utils/logger.utils');
const { purgarErroresAntiguos, DIAS_CLIENTE, DIAS_SERVIDOR, TANDA } =
  require('../../../services/limpiezaErrores.service');

const AHORA = new Date('2026-10-04T10:00:00.000Z');
const DIA   = 24 * 3600 * 1000;

describe('limpiezaErrores.service', () => {
  beforeEach(() => { query.mockReset(); jest.clearAllMocks(); });

  it('borra los de la app a 30 días y los del servidor a 180, cada uno con su corte', async () => {
    query.mockResolvedValue([{ affectedRows: 0 }]);
    await purgarErroresAntiguos(AHORA);

    expect(query).toHaveBeenCalledTimes(2);
    const [sqlCli, [origenCli, corteCli]] = query.mock.calls[0];
    const [, [origenSrv, corteSrv]] = query.mock.calls[1];
    expect(sqlCli).toMatch(/DELETE FROM error_logs WHERE origen = \? AND created_at < \? LIMIT \d+/);
    expect(origenCli).toBe('cliente');
    expect(AHORA - corteCli).toBe(DIAS_CLIENTE * DIA);
    expect(origenSrv).toBe('servidor');
    expect(AHORA - corteSrv).toBe(DIAS_SERVIDOR * DIA);
  });

  it('repite por tandas mientras salgan tandas llenas y devuelve el total', async () => {
    query
      .mockResolvedValueOnce([{ affectedRows: TANDA }])
      .mockResolvedValueOnce([{ affectedRows: 12 }])
      .mockResolvedValueOnce([{ affectedRows: 3 }]);
    const r = await purgarErroresAntiguos(AHORA);
    expect(r).toEqual({ cliente: TANDA + 12, servidor: 3 });
    expect(query).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalled();
  });

  it('no lanza si la BD falla: lo deja en el log', async () => {
    query.mockRejectedValue(new Error('BD caída'));
    const r = await purgarErroresAntiguos(AHORA);
    expect(r.error).toBe('BD caída');
    expect(logger.error).toHaveBeenCalled();
  });

  it('para en el tope de tandas por pasada', async () => {
    query.mockResolvedValue([{ affectedRows: TANDA }]);
    await purgarErroresAntiguos(AHORA);
    // 100 tandas por origen como mucho
    expect(query).toHaveBeenCalledTimes(200);
  });

  it('sin fecha usa el reloj actual', async () => {
    query.mockResolvedValue([{ affectedRows: 0 }]);
    await purgarErroresAntiguos();
    expect(query.mock.calls[0][1][1]).toBeInstanceOf(Date);
  });
});

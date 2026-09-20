'use strict';

/**
 * Tests de services/vigilancia.service.js
 *
 * Lo que se fija aquí es lo único que puede salir caro en producción: que el
 * aviso de «fotos de inicio pendientes» se mande UNA vez y que no se mande
 * cuando la fila no se ha podido reclamar. El texto del aviso tiene sus
 * propios tests en avisosAsignacion.service.test.js.
 *
 * Gotcha del proyecto: `clearAllMocks` no drena la cola de
 * `mockResolvedValueOnce`, así que aquí se usa `query.mockReset()`.
 */

jest.mock('../../../services/avisosAsignacion.service', () => ({
  avisarFotosInicioPendientes: jest.fn(),
}));

const { query } = require('../../../config/database');
const avisos    = require('../../../services/avisosAsignacion.service');
const { IMAGEN_TIPOS_INICIO, AVISO_FOTOS_INICIO_MINUTOS } =
  require('../../../config/constants');
const vigilancia = require('../../../services/vigilancia.service');

const TOTAL_FOTOS = IMAGEN_TIPOS_INICIO.length;

const CANDIDATA = {
  id: 12,
  user_id: 7,
  vehiculo_alias: 'Alfa 1',
  matricula: '9864JSF',
  responsable_nombre: 'Juan López',
  fotos_inicio: 2,
};

/** Encola la respuesta del SELECT de candidatas y la del UPDATE que reclama. */
function encolar({ candidatas = [CANDIDATA], affectedRows = 1 } = {}) {
  query.mockResolvedValueOnce([candidatas]);
  if (candidatas.length) {
    query.mockResolvedValueOnce([{ affectedRows }]);
  }
}

describe('vigilancia.service · fotos de inicio pendientes', () => {
  beforeEach(() => {
    query.mockReset();
    avisos.avisarFotosInicioPendientes.mockReset();
  });

  it('avisa de la asignación que lleva el rato de gracia sin completar las fotos', async () => {
    encolar();

    const resumen = await vigilancia.revisarFotosInicioPendientes();

    expect(resumen).toEqual({ candidatas: 1, avisadas: 1 });
    expect(avisos.avisarFotosInicioPendientes).toHaveBeenCalledTimes(1);
    expect(avisos.avisarFotosInicioPendientes).toHaveBeenCalledWith(
      expect.objectContaining({ id: 12 }),
      { minutos: AVISO_FOTOS_INICIO_MINUTOS, faltan: TOTAL_FOTOS - 2 }
    );
  });

  it('no avisa si el UPDATE no reclama la fila (ya avisada, cerrada o completada)', async () => {
    encolar({ affectedRows: 0 });

    const resumen = await vigilancia.revisarFotosInicioPendientes();

    expect(resumen).toEqual({ candidatas: 1, avisadas: 0 });
    expect(avisos.avisarFotosInicioPendientes).not.toHaveBeenCalled();
  });

  it('sin candidatas no toca la fila de nadie', async () => {
    encolar({ candidatas: [] });

    const resumen = await vigilancia.revisarFotosInicioPendientes();

    expect(resumen).toEqual({ candidatas: 0, avisadas: 0 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(avisos.avisarFotosInicioPendientes).not.toHaveBeenCalled();
  });

  it('el corte se calcula restando los minutos a la hora actual, no con NOW()', async () => {
    encolar();

    await vigilancia.revisarFotosInicioPendientes();

    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toMatch(/NOW\(\)|CURDATE\(\)/);
    const limite = params[0];
    expect(limite).toBeInstanceOf(Date);
    const minutosAtras = (Date.now() - limite.getTime()) / 60000;
    expect(minutosAtras).toBeCloseTo(AVISO_FOTOS_INICIO_MINUTOS, 1);
    expect(params[1]).toBe(TOTAL_FOTOS);
  });

  it('el UPDATE lleva dentro las dos condiciones que evitan el aviso de más', async () => {
    encolar();

    await vigilancia.revisarFotosInicioPendientes();

    const [sql] = query.mock.calls[1];
    expect(sql).toMatch(/aviso_fotos_pendientes_at IS NULL/);
    expect(sql).toMatch(/estado = 'activa'/);
    expect(sql).toMatch(/COUNT\(DISTINCT vi\.tipo_imagen\)/);
  });

  it('un fallo de BD no tumba el cron', async () => {
    query.mockRejectedValueOnce(new Error('ER_NO_SUCH_TABLE'));

    await expect(vigilancia.revisarFotosInicioPendientes())
      .resolves.toEqual({ candidatas: 0, avisadas: 0 });
    expect(avisos.avisarFotosInicioPendientes).not.toHaveBeenCalled();
  });
});

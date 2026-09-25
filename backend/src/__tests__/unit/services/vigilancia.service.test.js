'use strict';

/**
 * Tests de services/vigilancia.service.js
 *
 * Lo que se fija aquí es lo único que puede salir caro en producción: que el
 * aviso de «asignación sin iniciar» se mande UNA vez y que no se mande cuando
 * la fila no se ha podido reclamar. El texto del aviso tiene sus propios tests
 * en avisosAsignacion.service.test.js.
 *
 * Gotcha del proyecto: `clearAllMocks` no drena la cola de
 * `mockResolvedValueOnce`, así que aquí se usa `query.mockReset()`.
 */

jest.mock('../../../services/avisosAsignacion.service', () => ({
  avisarAsignacionSinIniciar: jest.fn(),
}));

const { query } = require('../../../config/database');
const avisos    = require('../../../services/avisosAsignacion.service');
const { AVISO_SIN_INICIAR_MINUTOS } = require('../../../config/constants');
const vigilancia = require('../../../services/vigilancia.service');

const CANDIDATA = {
  id: 12,
  user_id: 7,
  vehiculo_alias: 'Alfa 1',
  matricula: '9864JSF',
  responsable_nombre: 'Juan López',
};

/** Encola la respuesta del SELECT de candidatas y la del UPDATE que reclama. */
function encolar({ candidatas = [CANDIDATA], affectedRows = 1 } = {}) {
  query.mockResolvedValueOnce([candidatas]);
  if (candidatas.length) {
    query.mockResolvedValueOnce([{ affectedRows }]);
  }
}

describe('vigilancia.service · asignaciones sin iniciar', () => {
  beforeEach(() => {
    query.mockReset();
    avisos.avisarAsignacionSinIniciar.mockReset();
  });

  it('avisa de la asignación a la que se le pasó la hora sin que nadie la iniciara', async () => {
    encolar();

    const resumen = await vigilancia.revisarAsignacionesSinIniciar();

    expect(resumen).toEqual({ candidatas: 1, avisadas: 1 });
    expect(avisos.avisarAsignacionSinIniciar).toHaveBeenCalledTimes(1);
    expect(avisos.avisarAsignacionSinIniciar).toHaveBeenCalledWith(
      expect.objectContaining({ id: 12 }),
      { minutos: AVISO_SIN_INICIAR_MINUTOS }
    );
  });

  it('lo que cuenta como iniciada es inicio_real_at, no el estado que puso el cron', async () => {
    encolar();

    await vigilancia.revisarAsignacionesSinIniciar();

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/al\.inicio_real_at IS NULL/);
    // El estado solo descarta lo ya cerrado: una 'activa' que activó el cron
    // sigue siendo candidata mientras nadie haya pulsado el botón.
    expect(sql).toMatch(/al\.estado IN \('programada', 'activa'\)/);
  });

  it('no avisa si el UPDATE no reclama la fila (ya avisada, iniciada o cerrada)', async () => {
    encolar({ affectedRows: 0 });

    const resumen = await vigilancia.revisarAsignacionesSinIniciar();

    expect(resumen).toEqual({ candidatas: 1, avisadas: 0 });
    expect(avisos.avisarAsignacionSinIniciar).not.toHaveBeenCalled();
  });

  it('sin candidatas no toca la fila de nadie', async () => {
    encolar({ candidatas: [] });

    const resumen = await vigilancia.revisarAsignacionesSinIniciar();

    expect(resumen).toEqual({ candidatas: 0, avisadas: 0 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(avisos.avisarAsignacionSinIniciar).not.toHaveBeenCalled();
  });

  it('el corte se calcula restando los minutos a la hora actual, no con NOW()', async () => {
    encolar();

    await vigilancia.revisarAsignacionesSinIniciar();

    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toMatch(/NOW\(\)|CURDATE\(\)/);
    const limite = params[0];
    expect(limite).toBeInstanceOf(Date);
    const minutosAtras = (Date.now() - limite.getTime()) / 60000;
    expect(minutosAtras).toBeCloseTo(AVISO_SIN_INICIAR_MINUTOS, 1);
  });

  it('el UPDATE lleva dentro las condiciones que evitan el aviso de más', async () => {
    encolar();

    await vigilancia.revisarAsignacionesSinIniciar();

    const [sql] = query.mock.calls[1];
    expect(sql).toMatch(/aviso_sin_iniciar_at IS NULL/);
    expect(sql).toMatch(/inicio_real_at IS NULL/);
    // También lo borrado: en el hueco entre el SELECT y el UPDATE cabe un
    // borrado, y avisar de una asignación que ya no existe confunde igual.
    expect(sql).toMatch(/deleted_at IS NULL/);
  });

  it('un fallo de BD no tumba el cron', async () => {
    query.mockRejectedValueOnce(new Error('ER_NO_SUCH_TABLE'));

    await expect(vigilancia.revisarAsignacionesSinIniciar())
      .resolves.toEqual({ candidatas: 0, avisadas: 0 });
    expect(avisos.avisarAsignacionSinIniciar).not.toHaveBeenCalled();
  });
});

describe('vigilancia.service · alarmas sonando (listarAlarmasSinIniciar)', () => {
  beforeEach(() => query.mockReset());

  it('usa la misma marca que el push y descarta lo iniciado, cerrado o borrado', async () => {
    query.mockResolvedValueOnce([[{ id: 12 }]]);

    const filas = await vigilancia.listarAlarmasSinIniciar({ excluirUserId: 3 });

    expect(filas).toEqual([{ id: 12 }]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/aviso_sin_iniciar_at IS NOT NULL/);
    expect(sql).toMatch(/inicio_real_at IS NULL/);
    expect(sql).toMatch(/estado IN \('programada', 'activa'\)/);
    expect(sql).toMatch(/deleted_at IS NULL/);
    // Una asignación aplazada después del aviso no puede sonar.
    expect(sql).toMatch(/fecha_inicio <= \?/);
    const minutosAtras = (Date.now() - params[0].getTime()) / 60000;
    expect(minutosAtras).toBeCloseTo(AVISO_SIN_INICIAR_MINUTOS, 1);
    expect(params[1]).toBe(3);
  });

  it('sin usuario que excluir no excluye a nadie', async () => {
    query.mockResolvedValueOnce([[]]);
    await vigilancia.listarAlarmasSinIniciar();
    expect(query.mock.calls[0][1][1]).toBe(0);
  });
});

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
jest.mock('../../../services/push.service', () => ({
  notificarAdministracion: jest.fn(),
}));

const { query } = require('../../../config/database');
const avisos    = require('../../../services/avisosAsignacion.service');
const push      = require('../../../services/push.service');
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

describe('vigilancia.service · mantenimiento a 500 km (revisarMantenimientoKm)', () => {
  const VEHICULO = { id: 16, alias: 'UVI-05', matricula: '1234ABC', kilometros_actuales: 44020, km_proximo_mantenimiento: 44500 };

  beforeEach(() => {
    query.mockReset();
    push.notificarAdministracion.mockReset();
  });

  it('avisa a administración del vehículo al que le quedan 500 km o menos', async () => {
    query.mockResolvedValueOnce([[VEHICULO]]);
    query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const resumen = await vigilancia.revisarMantenimientoKm();

    expect(resumen).toEqual({ candidatos: 1, avisados: 1 });
    expect(push.notificarAdministracion).toHaveBeenCalledWith({
      titulo: 'UVI-05: mantenimiento en 480 km',
      cuerpo: 'UVI-05 (1234ABC) lleva 44.020 km y le toca el mantenimiento a los 44.500.',
      url: '/vehiculos/16?tab=revisiones',
      tag: 'veh-16-mantenimiento',
    });
    // Umbral de 500, km a 0 = sin anotar, y sin resta de UNSIGNED.
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([500]);
    expect(sql).toContain('kilometros_actuales > 0');
    expect(sql).toContain('kilometros_actuales + ? >= km_proximo_mantenimiento');
    expect(sql).toContain('aviso_mantenimiento_km <> km_proximo_mantenimiento');
  });

  it('el candado va dentro del UPDATE con la referencia que se vio en el SELECT', async () => {
    query.mockResolvedValueOnce([[VEHICULO]]);
    query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    await vigilancia.revisarMantenimientoKm();

    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('SET aviso_mantenimiento_km = km_proximo_mantenimiento');
    expect(sql).toContain('km_proximo_mantenimiento = ?');
    expect(sql).toContain('aviso_mantenimiento_km <> km_proximo_mantenimiento');
    expect(params).toEqual([16, 44500, 500]);
  });

  it('no avisa si la fila no se pudo reclamar (ya avisado o referencia movida)', async () => {
    query.mockResolvedValueOnce([[VEHICULO]]);
    query.mockResolvedValueOnce([{ affectedRows: 0 }]);

    const resumen = await vigilancia.revisarMantenimientoKm();

    expect(resumen).toEqual({ candidatos: 1, avisados: 0 });
    expect(push.notificarAdministracion).not.toHaveBeenCalled();
  });

  it('sin candidatos no hace UPDATE', async () => {
    query.mockResolvedValueOnce([[]]);
    expect(await vigilancia.revisarMantenimientoKm()).toEqual({ candidatos: 0, avisados: 0 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('no lanza si la BD falla', async () => {
    query.mockRejectedValueOnce(new Error('BD caída'));
    await expect(vigilancia.revisarMantenimientoKm()).resolves.toEqual({ candidatos: 0, avisados: 0 });
  });

  it('si el salto de km lo deja pasado, lo dice', () => {
    const aviso = vigilancia.avisoMantenimiento({ ...VEHICULO, kilometros_actuales: 45620 });
    expect(aviso.titulo).toBe('UVI-05: mantenimiento vencido');
    expect(aviso.cuerpo).toBe('UVI-05 (1234ABC) lleva 45.620 km: se ha pasado 1.120 km del mantenimiento de los 44.500.');
  });

  it('justo en la referencia dice que ya toca, y sin alias usa la matrícula', () => {
    const aviso = vigilancia.avisoMantenimiento({ ...VEHICULO, alias: null, kilometros_actuales: 44500 });
    expect(aviso.titulo).toBe('1234ABC: mantenimiento vencido');
    expect(aviso.cuerpo).toBe('1234ABC ha llegado a los 44.500 km: le toca el mantenimiento.');
  });

  it('formatKm agrupa también los de cuatro cifras', () => {
    expect(vigilancia.formatKm(5650)).toBe('5.650');
    expect(vigilancia.formatKm(480)).toBe('480');
    expect(vigilancia.formatKm(1234567)).toBe('1.234.567');
    expect(vigilancia.formatKm(null)).toBe('0');
  });
});

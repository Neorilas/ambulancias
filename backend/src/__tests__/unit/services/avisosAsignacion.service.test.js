'use strict';

/**
 * Tests de services/avisosAsignacion.service.js
 *
 * Aquí solo se comprueba QUÉ se le pide a push.service: el texto, el tag y a
 * quién se excluye. El envío en sí tiene sus propios tests.
 */

jest.mock('../../../services/push.service', () => ({
  notificarAdmins: jest.fn(),
}));

const push   = require('../../../services/push.service');
const avisos = require('../../../services/avisosAsignacion.service');

const ASIGNACION = {
  id: 12,
  user_id: 7,
  vehiculo_alias: 'Alfa 1',
  matricula: '9864JSF',
  responsable_nombre: 'Juan López',
};

describe('avisosAsignacion.service', () => {
  beforeEach(() => {
    push.notificarAdmins.mockReset();
    push.notificarAdmins.mockResolvedValue({ enviados: 1, borrados: 0, fallidos: 0 });
  });

  describe('a quién se avisa', () => {
    it.each([
      ['activada',   () => avisos.avisarAsignacionActivada(ASIGNACION)],
      ['fotos',      () => avisos.avisarFotosInicioCompletas(ASIGNACION)],
      ['sin iniciar', () => avisos.avisarAsignacionSinIniciar(ASIGNACION, { minutos: 30 })],
      ['finalizada', () => avisos.avisarAsignacionFinalizada(ASIGNACION, { km_fin: 1000 })],
    ])('el aviso de %s excluye al responsable de la asignación', async (_nombre, disparar) => {
      await disparar();
      expect(push.notificarAdmins).toHaveBeenCalledWith(
        expect.objectContaining({ excluirUserId: 7 })
      );
    });

    it('cada evento lleva su propio tag para no pisarse entre ellos', async () => {
      await avisos.avisarAsignacionActivada(ASIGNACION);
      await avisos.avisarFotosInicioCompletas(ASIGNACION);
      await avisos.avisarAsignacionSinIniciar(ASIGNACION, { minutos: 30 });
      await avisos.avisarAsignacionFinalizada(ASIGNACION);

      const tags = push.notificarAdmins.mock.calls.map(c => c[0].tag);
      expect(tags).toEqual([
        'asig-12-activada',
        'asig-12-fotos-inicio',
        'asig-12-sin-iniciar',
        'asig-12-finalizada',
      ]);
      expect(new Set(tags).size).toBe(4);
    });

    it('el aviso abre la asignación concreta, no el listado a secas', async () => {
      await avisos.avisarAsignacionActivada(ASIGNACION);
      expect(push.notificarAdmins.mock.calls[0][0].url).toBe('/asignaciones?id=12');
    });
  });

  describe('cómo se nombra al vehículo', () => {
    it('manda el alias: el personal identifica la ambulancia por su nombre', () => {
      expect(avisos.etiquetaVehiculo(ASIGNACION)).toBe('Alfa 1');
    });

    it('sin alias cae a la matrícula', () => {
      expect(avisos.etiquetaVehiculo({ matricula: '9864JSF' })).toBe('9864JSF');
    });

    it('sin ninguno de los dos no deja el aviso con un hueco', () => {
      expect(avisos.etiquetaVehiculo({})).toBe('Vehículo sin identificar');
    });
  });

  describe('texto del aviso de finalización', () => {
    it('incluye los km cuando el técnico los ha anotado', async () => {
      await avisos.avisarAsignacionFinalizada(ASIGNACION, { km_fin: 125430 });
      const { titulo, cuerpo } = push.notificarAdmins.mock.calls[0][0];
      expect(titulo).toContain('Alfa 1');
      expect(cuerpo).toContain('Juan López');
      expect(cuerpo).toMatch(/125\.430 km/);
    });

    it.each([
      ['null',      null],
      ['undefined', undefined],
      ['vacío',     ''],
    ])('no inventa «0 km» cuando km_fin viene %s', async (_caso, km_fin) => {
      await avisos.avisarAsignacionFinalizada(ASIGNACION, { km_fin });
      expect(push.notificarAdmins.mock.calls[0][0].cuerpo).not.toMatch(/km/);
    });

    it('sin segundo argumento tampoco falla', async () => {
      await avisos.avisarAsignacionFinalizada(ASIGNACION);
      expect(push.notificarAdmins).toHaveBeenCalled();
    });
  });

  describe('texto del aviso de asignación sin iniciar', () => {
    it('dice el vehículo, el responsable y cuánto se ha pasado de la hora', async () => {
      await avisos.avisarAsignacionSinIniciar(ASIGNACION, { minutos: 30 });
      const { titulo, cuerpo } = push.notificarAdmins.mock.calls[0][0];
      expect(titulo).toBe('Alfa 1 · servicio sin iniciar');
      expect(cuerpo).toBe(
        'Juan López no ha iniciado el servicio y ya han pasado 30 min de la hora prevista.'
      );
    });
  });

  describe('robustez', () => {
    it('un fallo del servicio de push no se propaga', async () => {
      push.notificarAdmins.mockRejectedValueOnce(new Error('se cayó todo'));
      await expect(avisos.avisarAsignacionActivada(ASIGNACION))
        .resolves.toMatchObject({ enviados: 0, omitido: 'error' });
    });

    it('sin nombre del responsable el aviso sigue siendo legible', async () => {
      await avisos.avisarAsignacionActivada({ id: 1, user_id: 2, matricula: 'X' });
      expect(push.notificarAdmins.mock.calls[0][0].cuerpo).toContain('Sin responsable');
    });
  });
});

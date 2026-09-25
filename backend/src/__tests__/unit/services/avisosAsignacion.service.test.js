'use strict';

/**
 * Tests de services/avisosAsignacion.service.js
 *
 * Aquí solo se comprueba QUÉ se le pide a push.service: el texto, el tag y a
 * quién se excluye. El envío en sí tiene sus propios tests.
 */

jest.mock('../../../services/push.service', () => ({
  notificarAdmins:   jest.fn(),
  notificarUsuarios: jest.fn(),
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
      expect(titulo).toBe('URGENTE · Alfa 1 sin iniciar');
      expect(cuerpo).toBe(
        'Juan López no ha iniciado el servicio y ya han pasado 30 min de la hora prevista.'
      );
    });
  });

  describe('prioridad', () => {
    it('solo el de «sin iniciar» va como urgente', async () => {
      await avisos.avisarAsignacionActivada(ASIGNACION);
      await avisos.avisarFotosInicioCompletas(ASIGNACION);
      await avisos.avisarAsignacionSinIniciar(ASIGNACION, { minutos: 15 });
      await avisos.avisarAsignacionFinalizada(ASIGNACION);

      const prioridades = push.notificarAdmins.mock.calls.map(c => c[0].prioridad);
      expect(prioridades).toEqual([undefined, undefined, 'alta', undefined]);
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

  // ── Nuevo servicio: a los miembros, no a los admins ─────
  describe('avisarAsignacionNueva', () => {
    // 2026-09-26 06:00 UTC = 08:00 en España (horario de verano).
    const EQUIPO = {
      ...ASIGNACION,
      fecha_inicio: new Date('2026-09-26T06:00:00Z'),
      responsables: [{ id: 7, nombre: 'Juan', apellidos: 'López' }, { id: 8, nombre: 'Ana', apellidos: 'Ruiz' }],
      personal:     [{ id: 9, nombre: 'Luis', apellidos: 'Gil' }],
    };

    beforeEach(() => {
      push.notificarUsuarios.mockReset();
      push.notificarUsuarios.mockResolvedValue({ enviados: 1, borrados: 0, fallidos: 0 });
    });

    it('avisa a responsables y personal por separado, cada uno con su texto', async () => {
      await avisos.avisarAsignacionNueva(EQUIPO, [7, 8, 9], { asignadoPor: 1 });

      expect(push.notificarAdmins).not.toHaveBeenCalled();
      expect(push.notificarUsuarios).toHaveBeenCalledTimes(2);
      const [[resp, avisoResp], [pers, avisoPers]] = push.notificarUsuarios.mock.calls;
      expect(resp).toEqual([7, 8]);
      expect(avisoResp).toMatchObject({
        titulo: 'Alfa 1 · nuevo servicio',
        cuerpo: 'Te han asignado un servicio como responsable. Empieza el 26/09 08:00.',
        url:    '/mis-asignaciones',
        tag:    'asig-12-asignada',
      });
      expect(pers).toEqual([9]);
      expect(avisoPers.cuerpo).toBe('Te han asignado un servicio con Juan López y Ana Ruiz. Empieza el 26/09 08:00.');
    });

    it('solo a los que se le pasan (los que entran al editar)', async () => {
      await avisos.avisarAsignacionNueva(EQUIPO, [9]);
      expect(push.notificarUsuarios).toHaveBeenCalledTimes(1);
      expect(push.notificarUsuarios.mock.calls[0][0]).toEqual([9]);
    });

    it('no avisa a quien la asigna aunque se ponga a sí mismo', async () => {
      await avisos.avisarAsignacionNueva(EQUIPO, [7, 8], { asignadoPor: 7 });
      expect(push.notificarUsuarios.mock.calls[0][0]).toEqual([8]);
    });

    it('nadie a quien avisar: no llama al servicio', async () => {
      await avisos.avisarAsignacionNueva(EQUIPO, [7], { asignadoPor: 7 });
      await avisos.avisarAsignacionNueva(EQUIPO, []);
      expect(push.notificarUsuarios).not.toHaveBeenCalled();
    });

    it('sin filas de miembros, el responsable principal cuenta como responsable', async () => {
      await avisos.avisarAsignacionNueva({ ...ASIGNACION, responsables: [], personal: [] }, [7]);
      expect(push.notificarUsuarios.mock.calls[0][0]).toEqual([7]);
      expect(push.notificarUsuarios.mock.calls[0][1].cuerpo).toMatch(/como responsable\.$/);
    });

    it('una fecha imposible no lanza: el controlador ya ha guardado', async () => {
      const rota = { ...EQUIPO, fecha_inicio: 'no-es-fecha' };
      expect(() => avisos.avisarAsignacionNueva(rota, [7])).not.toThrow();
      await expect(avisos.avisarAsignacionNueva(rota, [7])).resolves.toEqual([]);
      expect(push.notificarUsuarios).not.toHaveBeenCalled();
    });

    it('un fallo del servicio de push no se propaga', async () => {
      push.notificarUsuarios.mockRejectedValueOnce(new Error('se cayó'));
      await expect(avisos.avisarAsignacionNueva(EQUIPO, [7])).resolves.toBeDefined();
    });
  });
});

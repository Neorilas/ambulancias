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
      ['llegada',    () => avisos.avisarLlegadaEvento(ASIGNACION)],
      ['fin evento', () => avisos.avisarFinEvento(ASIGNACION)],
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
      await avisos.avisarLlegadaEvento(ASIGNACION);
      await avisos.avisarFinEvento(ASIGNACION);
      await avisos.avisarAsignacionSinIniciar(ASIGNACION, { minutos: 30 });
      await avisos.avisarAsignacionFinalizada(ASIGNACION);

      const tags = push.notificarAdmins.mock.calls.map(c => c[0].tag);
      expect(tags).toEqual([
        'asig-12-activada',
        'asig-12-fotos-inicio',
        'asig-12-llegada',
        'asig-12-fin-evento',
        'asig-12-sin-iniciar',
        'asig-12-finalizada',
      ]);
      expect(new Set(tags).size).toBe(6);
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

  describe('texto de los avisos del evento', () => {
    it('la llegada dice el vehículo y el responsable', async () => {
      await avisos.avisarLlegadaEvento(ASIGNACION);
      const { titulo, cuerpo, url } = push.notificarAdmins.mock.calls[0][0];
      expect(titulo).toBe('Alfa 1 · inicio evento/servicio');
      expect(cuerpo).toBe('Juan López ha llegado al evento/servicio.');
      expect(url).toBe('/asignaciones?id=12');
    });

    it('el fin del evento/servicio no se confunde con el cierre de la asignación', async () => {
      await avisos.avisarFinEvento(ASIGNACION);
      await avisos.avisarAsignacionFinalizada(ASIGNACION);
      const [fin, cierre] = push.notificarAdmins.mock.calls.map(c => c[0]);
      expect(fin.titulo).toBe('Alfa 1 · fin evento/servicio');
      expect(fin.cuerpo).toBe('Juan López ha terminado en el evento/servicio y vuelve a base.');
      expect(fin.titulo).not.toBe(cierre.titulo);
    });
  });

  describe('texto del aviso de asignación sin iniciar', () => {
    it('dice el vehículo, el responsable y cuánto se ha pasado de la hora', async () => {
      await avisos.avisarAsignacionSinIniciar(ASIGNACION, { minutos: 30 });
      const { titulo, cuerpo } = push.notificarAdmins.mock.calls[0][0];
      expect(titulo).toBe('URGENTE · Alfa 1 sin iniciar');
      expect(cuerpo).toBe(
        'Juan López no ha iniciado la asignación y ya han pasado 30 min de la hora prevista.'
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

  // ── Cambio de vehículo: confirma al equipo la llamada del técnico ─────
  describe('avisarCambioVehiculo', () => {
    const NUEVA    = { ...ASIGNACION, vehiculo_alias: 'Alfa 2', matricula: '1111AAA' };
    const ANTERIOR = { ...ASIGNACION };

    beforeEach(() => {
      push.notificarUsuarios.mockReset();
      push.notificarUsuarios.mockResolvedValue({ enviados: 1, borrados: 0, fallidos: 0 });
    });

    it('a los miembros, nombrando la nueva y la anterior, con el tag del «nuevo servicio»', async () => {
      await avisos.avisarCambioVehiculo(NUEVA, [7, 9], { anterior: ANTERIOR, cambiadoPor: 1 });
      expect(push.notificarAdmins).not.toHaveBeenCalled();
      expect(push.notificarUsuarios).toHaveBeenCalledWith([7, 9], {
        titulo: 'Alfa 2 · cambio de vehículo',
        cuerpo: 'Tu asignación pasa a Alfa 2 (antes Alfa 1). Las fotos de inicio se hacen a esta.',
        url:    '/mis-asignaciones',
        // El mismo tag sustituye en la bandeja el «nuevo servicio» con la ambulancia vieja.
        tag:    'asig-12-asignada',
      });
    });

    it('no avisa a quien hizo el cambio; si no queda nadie, no llama', async () => {
      await avisos.avisarCambioVehiculo(NUEVA, [7, 9], { cambiadoPor: 7 });
      expect(push.notificarUsuarios.mock.calls[0][0]).toEqual([9]);
      push.notificarUsuarios.mockClear();
      await avisos.avisarCambioVehiculo(NUEVA, [7], { cambiadoPor: 7 });
      expect(push.notificarUsuarios).not.toHaveBeenCalled();
    });

    it('un fallo del servicio de push no se propaga', async () => {
      push.notificarUsuarios.mockRejectedValueOnce(new Error('se cayó'));
      await expect(avisos.avisarCambioVehiculo(NUEVA, [7])).resolves.toBeDefined();
    });
  });

  // D10 del plan del trabajo padre: todo aviso de una ambulancia de un
  // trabajo abre el trabajo, con esa ambulancia señalada, y nombra el trabajo.
  describe('asignación dentro de un trabajo (v33)', () => {
    const EN_TRABAJO = { ...ASIGNACION, trabajo_id: 40, trabajo_nombre: 'Maratón' };
    const COMPLETA   = { ...ASIGNACION, trabajo_id: 40, trabajo: { id: 40, nombre: 'Maratón' },
                         responsables: [{ id: 7, nombre: 'Juan', apellidos: 'López' }], personal: [{ id: 8 }] };

    beforeEach(() => {
      push.notificarUsuarios.mockReset();
      push.notificarUsuarios.mockResolvedValue({ enviados: 1 });
    });

    it.each([
      ['activada',    () => avisos.avisarAsignacionActivada(EN_TRABAJO)],
      ['fotos',       () => avisos.avisarFotosInicioCompletas(EN_TRABAJO)],
      ['llegada',     () => avisos.avisarLlegadaEvento(EN_TRABAJO)],
      ['fin evento',  () => avisos.avisarFinEvento(EN_TRABAJO)],
      ['sin iniciar', () => avisos.avisarAsignacionSinIniciar(EN_TRABAJO, { minutos: 30 })],
      ['finalizada',  () => avisos.avisarAsignacionFinalizada(EN_TRABAJO)],
    ])('el aviso de %s a gestión abre el trabajo y lo nombra', async (_n, disparar) => {
      await disparar();
      const [aviso] = push.notificarAdmins.mock.calls[0];
      expect(aviso.url).toBe('/trabajos/40?asignacion=12');
      expect(aviso.cuerpo).toContain('en «Maratón»');
    });

    it('el «nuevo servicio» y el cambio de vehículo llevan al técnico al trabajo, no a /mis-asignaciones', async () => {
      await avisos.avisarAsignacionNueva(COMPLETA, [7, 8]);
      await avisos.avisarCambioVehiculo(COMPLETA, [7]);
      const urls = push.notificarUsuarios.mock.calls.map(c => c[1].url);
      expect(urls).toEqual(['/trabajos/40?asignacion=12', '/trabajos/40?asignacion=12', '/trabajos/40?asignacion=12']);
      expect(push.notificarUsuarios.mock.calls[0][1].cuerpo).toContain('en «Maratón»');
    });

    it('sin trabajo, los enlaces de siempre y sin «en …» en el texto', async () => {
      await avisos.avisarAsignacionActivada(ASIGNACION);
      expect(push.notificarAdmins.mock.calls[0][0].url).toBe('/asignaciones?id=12');
      expect(push.notificarAdmins.mock.calls[0][0].cuerpo).not.toContain('«');
      expect(avisos.urlParaMiembros(ASIGNACION)).toBe('/mis-asignaciones');
    });

    it('pendiente de cierre: solo al coordinador, con la ficha del trabajo', async () => {
      await avisos.avisarTrabajoPendienteCierre({ id: 40, nombre: 'Maratón', coordinador_user_id: 5 });
      expect(push.notificarAdmins).not.toHaveBeenCalled();
      expect(push.notificarUsuarios).toHaveBeenCalledWith([5], expect.objectContaining({
        url: '/trabajos/40', tag: 'trab-40-pendiente-cierre',
      }));
      expect(push.notificarUsuarios.mock.calls[0][1].titulo).toContain('Maratón');
    });

    it('pendiente de cierre de un trabajo sin coordinador (anterior a v33): a gestión', async () => {
      await avisos.avisarTrabajoPendienteCierre({ id: 41, nombre: 'Viejo', coordinador_user_id: null });
      expect(push.notificarUsuarios).not.toHaveBeenCalled();
      expect(push.notificarAdmins).toHaveBeenCalledWith(expect.objectContaining({ url: '/trabajos/41' }));
    });

    it('un fallo del servicio de push no se propaga', async () => {
      push.notificarUsuarios.mockRejectedValueOnce(new Error('se cayó'));
      await expect(avisos.avisarTrabajoPendienteCierre({ id: 40, nombre: 'M', coordinador_user_id: 5 }))
        .resolves.toBeDefined();
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  estaCerrado, formularioInicial, ambulanciaVacia, validarTrabajo, payloadTrabajo,
  misAmbulancias, siguientePaso, textoEstadoAmbulancia, nombresDe, nombresResponsables,
  asociadosDeTrabajo, asociadosDeFormulario, coordinadoresDe, esCoordinadorDe,
  accionesVehiculo, vehiculosConAcciones, ambulanciasDeFila, esPrevisto, faltaParaProgramado,
  pideEvento, textoEvento, finEventoPrevisto, sinCerrar,
} from '../../../utils/trabajos.js';

// Un alta completa: el trabajo, su coordinador y una ambulancia
const formValido = (extra = {}) => ({
  ...formularioInicial(null),
  nombre: 'Maratón',
  fecha_inicio: '2026-10-15T08:00',
  fecha_fin: '2026-10-15T20:00',
  coordinadores: [50],
  asignaciones: [{ ...ambulanciaVacia(), vehicle_id: '7', responsables: [20] }],
  ...extra,
});

describe('utils/trabajos', () => {
  it('estaCerrado: finalizado sí; pendiente de cierre todavía no', () => {
    expect(estaCerrado('finalizado')).toBe(true);
    expect(estaCerrado('finalizado_anticipado')).toBe(true);
    expect(estaCerrado('pendiente_cierre')).toBe(false);
    expect(estaCerrado('activo')).toBe(false);
  });

  describe('formularioInicial', () => {
    it('el alta arranca sin ambulancias ni equipo: las dos cosas son opcionales (2026-10-10)', () => {
      expect(formularioInicial(null)).toEqual({
        nombre: '', descripcion: '', ubicacion: '', ubicacion_url: '', tipo: 'traslado',
        fecha_inicio: '', fecha_fin: '', evento_desde: '', evento_hasta: '', coordinadores: [''],
        usuarios: [], horario: [], asignaciones: [], previsto: false,
      });
    });

    it('al editar un previsto (v41), el formulario lo sabe por el estado', () => {
      expect(formularioInicial({ estado: 'previsto' }).previsto).toBe(true);
      expect(formularioInicial({ estado: 'programado' }).previsto).toBe(false);
    });

    it('al editar, carga el horario por días en hora española, agrupado por día (v39)', () => {
      const f = formularioInicial({ horario: [
        { inicio: '2026-10-21T13:00:00.000Z', fin: '2026-10-21T21:00:00.000Z' },
        { inicio: '2026-10-21T08:00:00.000Z', fin: '2026-10-21T12:00:00.000Z' },
      ] });
      expect(f.horario).toEqual([{ dia: '2026-10-21', tramos: [
        { desde: '15:00', hasta: '23:00' }, { desde: '10:00', hasta: '14:00' }] }]);
    });

    it('al editar, carga el equipo del trabajo', () => {
      expect(formularioInicial({ usuarios: [{ user_id: 30 }, { user_id: 31 }] }).usuarios).toEqual([30, 31]);
    });

    it('al editar, los datos y los coordinadores; las ambulancias se cambian en la ficha', () => {
      const f = formularioInicial({
        nombre: 'M', descripcion: 'D', ubicacion: 'U', tipo: 'otro', coordinador_user_id: 50,
        coordinadores: [{ id: 50 }, { id: 51 }],
        asignaciones: [{ id: 1, vehicle_id: 7 }],
      });
      expect(f).toMatchObject({ nombre: 'M', descripcion: 'D', ubicacion: 'U', tipo: 'otro', coordinadores: [50, 51] });
      expect(f.asignaciones).toEqual([]);
    });

    it('con un backend anterior (solo el principal suelto), ese es el único coordinador', () => {
      expect(formularioInicial({ coordinador_user_id: 50, coordinador: { id: 50 } }).coordinadores).toEqual([50]);
    });
  });

  describe('validarTrabajo', () => {
    it('un alta completa no tiene errores', () => {
      expect(validarTrabajo(formValido(), { alta: true })).toEqual({});
    });

    it('al menos un coordinador, también al editar; las filas vacías no cuentan', () => {
      expect(validarTrabajo(formValido({ coordinadores: [''] })).coordinadores).toBeTruthy();
      expect(validarTrabajo(formValido({ coordinadores: [] })).coordinadores).toBeTruthy();
      expect(validarTrabajo(formValido({ coordinadores: ['', 51] })).coordinadores).toBeUndefined();
    });

    it('al editar no mira las ambulancias', () => {
      expect(validarTrabajo(formValido({ asignaciones: [] }))).toEqual({});
    });

    it('en el alta, sin ninguna ambulancia también vale', () => {
      expect(validarTrabajo(formValido({ asignaciones: [] }), { alta: true })).toEqual({});
    });

    it.each([
      ['sin vehículo', [{ ...ambulanciaVacia(), responsables: [20] }], 'el vehículo y al menos un responsable'],
      ['sin responsable', [{ ...ambulanciaVacia(), vehicle_id: '7' }], 'el vehículo y al menos un responsable'],
      ['la misma dos veces (D5)', [
        { ...ambulanciaVacia(), vehicle_id: '7', responsables: [20] },
        { ...ambulanciaVacia(), vehicle_id: '7', responsables: [21] },
      ], 'dos veces'],
      // En blanco hereda el inicio del trabajo (08:00): un fin propio antes no vale
      ['fin propio antes del inicio heredado', [
        { ...ambulanciaVacia(), vehicle_id: '7', responsables: [20], fecha_fin: '2026-10-15T07:00' },
      ], 'posterior'],
    ])('en el alta rechaza: %s', (_n, asignaciones, msg) => {
      expect(validarTrabajo(formValido({ asignaciones }), { alta: true }).asignaciones).toContain(msg);
    });

    it('las de siempre: título, fechas y ubicación', () => {
      const e = validarTrabajo(formValido({ nombre: ' ', fecha_fin: '2026-10-15T07:00', ubicacion: 'x'.repeat(256) }));
      expect(Object.keys(e).sort()).toEqual(['fecha_fin', 'nombre', 'ubicacion']);
    });

    it('el enlace de Maps es opcional, pero si se pone tiene que ser de Google Maps', () => {
      expect(validarTrabajo(formValido({ ubicacion_url: '' })).ubicacion_url).toBeUndefined();
      expect(validarTrabajo(formValido({ ubicacion_url: 'https://maps.app.goo.gl/abc' })).ubicacion_url).toBeUndefined();
      expect(validarTrabajo(formValido({ ubicacion_url: 'https://ejemplo.com/maps' })).ubicacion_url)
        .toContain('Google Maps');
    });
  });

  describe('previsto (v41)', () => {
    it('no exige coordinador: es justo lo que le falta', () => {
      const sin = formValido({ coordinadores: [''], asignaciones: [] });
      expect(validarTrabajo(sin, { alta: true })).toHaveProperty('coordinadores');
      expect(validarTrabajo({ ...sin, previsto: true }, { alta: true })).toEqual({});
    });

    it('en el alta manda previsto y, sin coordinadores, no manda la lista (vacía daría 422)', () => {
      const p = payloadTrabajo(formValido({ coordinadores: [''], asignaciones: [], previsto: true }), { alta: true });
      expect(p.previsto).toBe(true);
      expect(p).not.toHaveProperty('coordinadores');
      expect(p.asignaciones).toEqual([]);
    });

    it('un alta normal no manda previsto; al editar, nunca (lo decide el backend)', () => {
      expect(payloadTrabajo(formValido(), { alta: true })).not.toHaveProperty('previsto');
      expect(payloadTrabajo(formValido({ previsto: true }))).not.toHaveProperty('previsto');
    });

    it('faltaParaProgramado dice qué le falta, y nada si no es previsto', () => {
      expect(faltaParaProgramado({ estado: 'previsto', coordinadores: [], asignaciones: [] }))
        .toEqual(['coordinador', 'ambulancia']);
      expect(faltaParaProgramado({ estado: 'previsto', coordinadores: [{ id: 50 }],
        asignaciones: [{ estado: 'cancelada' }] })).toEqual(['ambulancia']);
      expect(faltaParaProgramado({ estado: 'previsto', coordinadores: [],
        asignaciones: [{ estado: 'programada' }] })).toEqual(['coordinador']);
      expect(faltaParaProgramado({ estado: 'programado', coordinadores: [], asignaciones: [] })).toEqual([]);
      expect(esPrevisto({ estado: 'previsto' })).toBe(true);
    });
  });

  describe('payloadTrabajo', () => {
    it('en el alta, las ambulancias como asignaciones; sin fecha propia no la manda', () => {
      const p = payloadTrabajo(formValido({
        descripcion: '  ', ubicacion: ' Retiro ',
        asignaciones: [{ ...ambulanciaVacia(), vehicle_id: '7', responsables: ['20', ''], personal: ['30'],
                         km_inicio: '1.200', notas: '  ' }],
      }), { alta: true });

      expect(p).toMatchObject({ nombre: 'Maratón', descripcion: null, ubicacion: 'Retiro', coordinadores: [50] });
      // El formato viejo ya no se manda: con `coordinadores` el backend no lo necesita
      expect(p).not.toHaveProperty('coordinador_user_id');
      expect(p.ubicacion_url).toBeNull();
      expect(payloadTrabajo(formValido({ ubicacion_url: ' https://maps.app.goo.gl/abc ' })).ubicacion_url)
        .toBe('https://maps.app.goo.gl/abc');
      expect(p.asignaciones).toEqual([{
        vehicle_id: 7, responsables: [20], personal: [30], km_inicio: 1200, notas: null,
      }]);
      expect(p.usuarios).toEqual([]);
      // Nada del modelo v25: el backend daría 400. `usuarios` sí: es el
      // equipo del trabajo
      expect(p).not.toHaveProperty('vehiculos');
    });

    it('al editar, datos, coordinadores y equipo del trabajo; sin ambulancias', () => {
      const p = payloadTrabajo(formValido({ usuarios: ['30', '', 31], coordinadores: ['51', '', 50] }));
      expect(p).not.toHaveProperty('asignaciones');
      expect(p.coordinadores).toEqual([51, 50]);
      expect(p.usuarios).toEqual([30, 31]);
    });

    it('con fecha propia la manda en UTC, como las del trabajo', () => {
      const p = payloadTrabajo(formValido({
        asignaciones: [{ ...ambulanciaVacia(), vehicle_id: '7', responsables: [20], fecha_inicio: '2026-10-15T07:00' }],
      }), { alta: true });
      expect(p.asignaciones[0].fecha_inicio).toBeTruthy();
      expect(p.asignaciones[0]).not.toHaveProperty('fecha_fin');
    });
  });

  describe('«Tu ambulancia»', () => {
    const base = { estado: 'activa', inicio_real_at: '2026-10-15T07:40:00Z', fecha_inicio: '2026-10-15T08:00:00Z',
                   progreso_fotos: { inicio: { completo: true } } };

    it('misAmbulancias: solo en las que va, primero la que lleva', () => {
      const t = { asignaciones: [{ id: 1, mi_rol: 'equipo' }, { id: 2, mi_rol: null }, { id: 3, mi_rol: 'responsable' }] };
      expect(misAmbulancias(t).map(a => a.id)).toEqual([3, 1]);
      expect(misAmbulancias(null)).toEqual([]);
    });

    it.each([
      ['sin pulsar el inicio', { inicio_real_at: null }, 'Inicio de la asignación'],
      ['sin las fotos de inicio', { progreso_fotos: { inicio: { completo: false } } }, 'Fotos de inicio'],
      ['de camino', {}, 'Inicio evento/servicio'],
      ['en el evento', { llegada_servicio_at: 'x' }, 'Fin evento/servicio'],
      ['de vuelta', { llegada_servicio_at: 'x', fin_servicio_at: 'y' }, 'Finalizar asignación'],
      // Jornadas por día (v39): en vez del evento, cada día su jornada
      ['con jornadas, ninguna en curso', { num_jornadas: 3, jornadas_hechas: 1 }, 'Inicio de jornada'],
      ['con una jornada en curso', { jornadas: [{ inicio_real_at: 'x' }] }, 'Fin de jornada'],
      ['con todas las jornadas hechas', { num_jornadas: 2, jornadas_hechas: 2 }, 'Finalizar asignación'],
      ['finalizada', { estado: 'finalizada' }, null],
      ['cancelada', { estado: 'cancelada' }, null],
    ])('siguientePaso %s → %s', (_n, extra, esperado) => {
      expect(siguientePaso({ ...base, ...extra })).toBe(esperado);
    });

    it.each([
      ['programada', { estado: 'programada' }, /^Programada · empieza/],
      ['activa por el cron', { inicio_real_at: null }, /^Sin iniciar$/],
      ['sin fotos', { progreso_fotos: { inicio: { completo: false } } }, /faltan fotos de inicio/],
      // En «Mis trabajos» no llega el progreso: no se inventa que faltan
      ['sin progreso', { progreso_fotos: undefined }, /^En camino$/],
      ['en el evento', { llegada_servicio_at: 'x' }, /^En el evento\/servicio$/],
      ['de vuelta', { llegada_servicio_at: 'x', fin_servicio_at: 'y' }, /^De vuelta a base$/],
      ['en jornada', { num_jornadas: 3, jornadas_hechas: 1, en_jornada: true }, /^En jornada · 1 de 3 hechas$/],
      ['entre jornadas', { num_jornadas: 3, jornadas_hechas: 1 }, /^Jornadas: 1 de 3 hechas$/],
      ['finalizada', { estado: 'finalizada' }, /^Finalizada$/],
    ])('textoEstadoAmbulancia %s', (_n, extra, esperado) => {
      expect(textoEstadoAmbulancia({ ...base, ...extra })).toMatch(esperado);
    });
  });

  it('nombres: nombre y apellidos, o el usuario si no hay', () => {
    expect(nombresDe([{ nombre: 'Ana', apellidos: 'Ruiz' }, { username: 'luis' }])).toBe('Ana Ruiz, luis');
    expect(nombresResponsables({ responsables: [{ nombre: 'Ana' }] })).toBe('Ana');
    expect(nombresResponsables(null)).toBe('');
  });

  // v35: varios coordinadores, todos con las mismas funciones
  describe('coordinadores', () => {
    it('la lista si viene; si no (backend anterior), el principal suelto; si no, ninguno', () => {
      expect(coordinadoresDe({ coordinadores: [{ id: 50 }, { id: 51 }], coordinador: { id: 50 } }))
        .toEqual([{ id: 50 }, { id: 51 }]);
      expect(coordinadoresDe({ coordinador: { id: 50 } })).toEqual([{ id: 50 }]);
      expect(coordinadoresDe({ coordinador: null })).toEqual([]);
      expect(coordinadoresDe(null)).toEqual([]);
    });

    it('cualquiera de ellos es coordinador, no solo el principal', () => {
      const t = { coordinadores: [{ id: 50 }, { id: 51 }] };
      expect(esCoordinadorDe(t, 51)).toBe(true);
      expect(esCoordinadorDe(t, 52)).toBe(false);
      expect(esCoordinadorDe(t, undefined)).toBe(false);
      expect(esCoordinadorDe(null, 50)).toBe(false);
    });
  });

  // Quién sale arriba, en «Asociados al trabajo», al elegir quién va en una ambulancia
  describe('asociados al trabajo', () => {
    it('de un trabajo: su equipo, sus coordinadores y quien va en sus ambulancias (no las canceladas)', () => {
      const t = {
        usuarios: [{ user_id: 30 }], coordinador_user_id: 50, coordinadores: [{ id: 50 }, { id: 51 }],
        asignaciones: [
          { estado: 'activa', responsables: [{ id: 20 }], personal: [{ id: 31 }] },
          { estado: 'cancelada', responsables: [{ id: 99 }], personal: [] },
        ],
      };
      expect([...asociadosDeTrabajo(t)].sort()).toEqual([20, 30, 31, 50, 51]);
      expect(asociadosDeTrabajo(null).size).toBe(0);
    });

    it('del formulario de alta: lo que ya se ha rellenado, sin filas vacías', () => {
      const f = { ...formValido(), usuarios: ['30', ''], coordinadores: [50, ''],
        asignaciones: [{ ...ambulanciaVacia(), responsables: [20, ''], personal: ['31'] }] };
      expect([...asociadosDeFormulario(f)].sort()).toEqual([20, 30, 31, 50]);
    });
  });

  // Modelo v25: convive hasta la fase 6 para terminar los trabajos antiguos
  describe('accionesVehiculo (v25)', () => {
    const inicio = (completo) => ({ progreso_fotos: { inicio: { completo } } });

    it('sin detalle (equipo) no hay nada que hacer', () => {
      expect(accionesVehiculo({ detalle: false, estado: 'activo' }))
        .toEqual({ activar: false, fotosInicio: false, finalizar: false });
      expect(accionesVehiculo(undefined).activar).toBe(false);
    });

    it('cerrado, tampoco', () => {
      expect(accionesVehiculo({ detalle: true, estado: 'finalizado', ...inicio(true) }).finalizar).toBe(false);
    });

    it('sin iniciar: activar y fotos de inicio', () => {
      expect(accionesVehiculo({ detalle: true, estado: 'programado', ...inicio(false) }))
        .toEqual({ activar: true, fotosInicio: true, finalizar: false });
    });

    it('activado por el cron sin pulsar: sigue ofreciendo el inicio de servicio', () => {
      expect(accionesVehiculo({ detalle: true, estado: 'activo', inicio_real_at: null, ...inicio(true) }))
        .toEqual({ activar: true, fotosInicio: false, finalizar: true });
    });

    it('iniciado y con fotos de inicio: solo cerrar', () => {
      expect(accionesVehiculo({ detalle: true, estado: 'activo', inicio_real_at: '2026-10-15', ...inicio(true) }))
        .toEqual({ activar: false, fotosInicio: false, finalizar: true });
    });
  });

  it('vehiculosConAcciones (v25) deja fuera los que no son de quien mira', () => {
    const t = { vehiculos: [
      { vehicle_id: 7, detalle: true, estado: 'activo', inicio_real_at: 'x',
        progreso_fotos: { inicio: { completo: true } } },
      { vehicle_id: 8, detalle: false, estado: 'activo' },
      { vehicle_id: 9, detalle: true, estado: 'finalizado' },
    ] };
    expect(vehiculosConAcciones(t).map(v => v.vehicle_id)).toEqual([7]);
    expect(vehiculosConAcciones(null)).toEqual([]);
  });

  it('ambulanciasDeFila: las nombra con «y», sin repetir', () => {
    expect(ambulanciasDeFila({ vehiculos_nombres: 'UVI-05' })).toBe('UVI-05');
    expect(ambulanciasDeFila({ vehiculos_nombres: 'UVI-04|UVI-03' })).toBe('UVI-04 y UVI-03');
    expect(ambulanciasDeFila({ vehiculos_nombres: 'UVI-01|UVI-02|SVB, 1' })).toBe('UVI-01, UVI-02 y SVB, 1');
    // La misma ambulancia en dos turnos sale una vez
    expect(ambulanciasDeFila({ vehiculos_nombres: 'UVI-04|UVI-03|UVI-04' })).toBe('UVI-04 y UVI-03');
    expect(ambulanciasDeFila({ vehiculos_nombres: '' })).toBe('');
    expect(ambulanciasDeFila({})).toBe('');
    expect(ambulanciasDeFila(null)).toBe('');
  });

  describe('horario por días (v39)', () => {
    const tresDias = (extra = {}) => formValido({
      fecha_inicio: '2026-10-20T08:00', fecha_fin: '2026-10-22T23:00',
      horario: [{ dia: '2026-10-20', tramos: [{ desde: '10:00', hasta: '22:00' }] }],
      ...extra,
    });

    it('el payload lleva el horario del trabajo en UTC', () => {
      expect(payloadTrabajo(tresDias()).horario).toEqual([{ inicio: '2026-10-20T08:00', fin: '2026-10-20T20:00' }]);
      expect(payloadTrabajo(tresDias(), { alta: true }).horario).toHaveLength(1);
    });

    it('una ambulancia sin horario propio no manda `horario` (hereda); con él, sí', () => {
      const amb = { ...ambulanciaVacia(), vehicle_id: '7', responsables: [20] };
      const propio = { ...amb, vehicle_id: '8', horario_propio: true,
        horario: [{ dia: '2026-10-21', tramos: [{ desde: '09:00', hasta: '13:00' }] }] };
      const p = payloadTrabajo(tresDias({ asignaciones: [amb, propio] }), { alta: true });
      expect(p.asignaciones[0]).not.toHaveProperty('horario');
      expect(p.asignaciones[1].horario).toEqual([{ inicio: '2026-10-21T07:00', fin: '2026-10-21T11:00' }]);
    });

    it('valida el horario del trabajo y el propio de cada ambulancia', () => {
      expect(validarTrabajo(tresDias())).toEqual({});
      const fuera = tresDias({ horario: [{ dia: '2026-10-23', tramos: [{ desde: '10:00', hasta: '12:00' }] }] });
      expect(validarTrabajo(fuera).horario).toContain('se sale de las fechas');

      const malPropio = { ...ambulanciaVacia(), vehicle_id: '8', responsables: [21], horario_propio: true,
        horario: [{ dia: '2026-10-21', tramos: [{ desde: '', hasta: '13:00' }] }] };
      expect(validarTrabajo(tresDias({ asignaciones: [malPropio] }), { alta: true }).asignaciones)
        .toContain('Horario propio');
    });
  });

  // v42: el trabajo va de la salida de base a la vuelta; el evento, dentro
  describe('horas del evento', () => {
    const partido = (extra = {}) => formValido({
      fecha_inicio: '2026-10-15T10:00', fecha_fin: '2026-10-15T13:00',
      evento_desde: '11:00', evento_hasta: '12:00', ...extra,
    });

    it('al editar, carga las horas del evento en hora española', () => {
      const f = formularioInicial({
        evento_inicio: '2026-10-15T09:00:00.000Z', evento_fin: '2026-10-15T10:00:00.000Z',
      });
      expect([f.evento_desde, f.evento_hasta]).toEqual(['11:00', '12:00']);
    });

    it('las manda en UTC con el día del trabajo, y sin ellas manda null para borrarlas', () => {
      expect(payloadTrabajo(partido())).toMatchObject({
        evento_inicio: '2026-10-15T09:00', evento_fin: '2026-10-15T10:00' });
      expect(payloadTrabajo(partido({ evento_desde: '', evento_hasta: '' })))
        .toMatchObject({ evento_inicio: null, evento_fin: null });
    });

    it('en un trabajo de varios días no se piden y se borran', () => {
      const varios = partido({ fecha_fin: '2026-10-17T13:00' });
      expect(pideEvento(varios)).toBe(false);
      expect(payloadTrabajo(varios)).toMatchObject({ evento_inicio: null, evento_fin: null });
      expect(validarTrabajo(varios).evento).toBeUndefined();
    });

    it.each([
      ['solo una hora', { evento_hasta: '' }, /o ninguna/],
      ['el fin antes del inicio', { evento_desde: '12:00', evento_hasta: '11:00' }, /posterior/],
      ['antes de la salida de base', { evento_desde: '09:00' }, /entre el inicio y el fin/],
      ['después de la vuelta', { evento_hasta: '14:00' }, /entre el inicio y el fin/],
    ])('valida: %s', (_caso, extra, mensaje) => {
      expect(validarTrabajo(partido(extra)).evento).toMatch(mensaje);
    });

    it('bien puestas, no da error', () => {
      expect(validarTrabajo(partido()).evento).toBeUndefined();
    });

    it('textoEvento: «11:00 – 12:00», o null sin evento', () => {
      expect(textoEvento({ evento_inicio: '2026-10-15T09:00:00.000Z', evento_fin: '2026-10-15T10:00:00.000Z' }))
        .toBe('11:00 – 12:00');
      expect(textoEvento({})).toBeNull();
    });

    it('finEventoPrevisto: el fin del evento del trabajo y, sin él, el de la ambulancia', () => {
      const asig = { fecha_fin: '2026-10-15T11:00:00.000Z' };
      expect(finEventoPrevisto(asig)).toBe('2026-10-15T11:00:00.000Z');
      expect(finEventoPrevisto({ ...asig, trabajo: { evento_fin: '2026-10-15T10:00:00.000Z' } }))
        .toBe('2026-10-15T10:00:00.000Z');
      expect(finEventoPrevisto({ ...asig, trabajo: { evento_fin: null } })).toBe('2026-10-15T11:00:00.000Z');
    });
  });
});

// «Sin cerrar» (2026-10-25): el backend decide si lo está; aquí, el texto
describe('sinCerrar', () => {
  const ahora = new Date('2026-10-25T12:00:00Z');
  const fila = (desde, ambulancias_abiertas) => ({ sin_cerrar_desde: desde, ambulancias_abiertas });

  it('null si el backend no lo marca', () => {
    expect(sinCerrar({ sin_cerrar_desde: null }, ahora)).toBeNull();
    expect(sinCerrar(null, ahora)).toBeNull();
  });

  it('cuánto hace de la vuelta a base: minutos, horas o días', () => {
    expect(sinCerrar(fila('2026-10-25T11:15:00Z', 1), ahora).hace).toBe('45 min');
    expect(sinCerrar(fila('2026-10-25T08:59:00Z', 1), ahora).hace).toBe('3 h');
    expect(sinCerrar(fila('2026-10-24T10:00:00Z', 1), ahora).hace).toBe('1 día');
    expect(sinCerrar(fila('2026-10-20T10:00:00Z', 1), ahora).hace).toBe('5 días');
  });

  it('qué lo tiene abierto: ambulancias sin finalizar o solo el cierre', () => {
    expect(sinCerrar(fila('2026-10-25T08:00:00Z', 0), ahora).texto)
      .toBe('Debía terminar hace 4 h · falta cerrar el trabajo');
    expect(sinCerrar(fila('2026-10-25T08:00:00Z', 1), ahora).falta).toBe('1 ambulancia sin finalizar');
    expect(sinCerrar(fila('2026-10-25T08:00:00Z', '3'), ahora).falta).toBe('3 ambulancias sin finalizar');
  });

  it('un programado sin ambulancias no se cierra: se alarga o se elimina', () => {
    expect(sinCerrar({ ...fila('2026-10-25T08:00:00Z', 0), estado: 'programado' }, ahora).falta)
      .toBe('sin ambulancias: alárgalo o elimínalo');
    expect(sinCerrar({ ...fila('2026-10-25T08:00:00Z', 0), estado: 'pendiente_cierre' }, ahora).falta)
      .toBe('falta cerrar el trabajo');
  });
});

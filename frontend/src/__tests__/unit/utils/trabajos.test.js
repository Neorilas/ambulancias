import { describe, it, expect } from 'vitest';
import {
  estaCerrado, formularioInicial, ambulanciaVacia, validarTrabajo, payloadTrabajo,
  misAmbulancias, siguientePaso, textoEstadoAmbulancia, nombresDe, nombresResponsables,
  asociadosDeTrabajo, asociadosDeFormulario, coordinadoresDe, esCoordinadorDe,
  accionesVehiculo, vehiculosConAcciones,
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
        fecha_inicio: '', fecha_fin: '', coordinadores: [''],
        usuarios: [], asignaciones: [],
      });
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
});

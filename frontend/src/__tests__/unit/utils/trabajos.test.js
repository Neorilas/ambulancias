import { describe, it, expect } from 'vitest';
import {
  estaCerrado, formularioInicial, vehiculoVacio, validarTrabajo, payloadTrabajo,
  accionesVehiculo, vehiculosConAcciones, nombresResponsables,
} from '../../../utils/trabajos.js';

const formValido = (extra = {}) => ({
  ...formularioInicial(null),
  nombre: 'Maratón',
  fecha_inicio: '2026-10-15T08:00',
  fecha_fin: '2026-10-15T20:00',
  ...extra,
});

describe('utils/trabajos', () => {
  it('estaCerrado', () => {
    expect(estaCerrado('finalizado')).toBe(true);
    expect(estaCerrado('finalizado_anticipado')).toBe(true);
    expect(estaCerrado('activo')).toBe(false);
  });

  describe('formularioInicial', () => {
    it('vacío para un trabajo nuevo', () => {
      expect(formularioInicial(null)).toEqual({
        nombre: '', descripcion: '', ubicacion: '', tipo: 'traslado',
        fecha_inicio: '', fecha_fin: '', vehiculos: [], usuarios: [],
      });
    });

    it('carga los responsables de cada vehículo y bloquea los que ya arrancaron', () => {
      const f = formularioInicial({
        nombre: 'M', descripcion: 'D', ubicacion: 'U', tipo: 'otro',
        vehiculos: [
          { vehicle_id: 7, estado: 'activo', kilometros_inicio: 100,
            responsables: [{ id: 20 }, { id: 21 }] },
          // Fila anterior a v25 sin responsables: su principal
          { vehicle_id: 8, estado: 'programado', responsable_user_id: 22, responsables: [] },
        ],
        usuarios: [{ user_id: 30 }],
      });
      expect(f.vehiculos).toEqual([
        { vehicle_id: 7, responsables: [20, 21], kilometros_inicio: 100, bloqueado: true },
        { vehicle_id: 8, responsables: [22], kilometros_inicio: '', bloqueado: false },
      ]);
      expect(f.usuarios).toEqual([30]);
      expect(f.descripcion).toBe('D');
    });

    it('una fila sin estado ni responsable no se bloquea', () => {
      const f = formularioInicial({ vehiculos: [{ vehicle_id: 8 }] });
      expect(f.vehiculos[0]).toMatchObject({ responsables: [''], bloqueado: false });
    });
  });

  it('vehiculoVacio arranca con un responsable por rellenar', () => {
    expect(vehiculoVacio()).toEqual(
      { vehicle_id: '', responsables: [''], kilometros_inicio: '', bloqueado: false });
  });

  describe('validarTrabajo', () => {
    it('un formulario completo no tiene errores', () => {
      expect(validarTrabajo(formValido({
        vehiculos: [{ vehicle_id: '7', responsables: ['20'] }],
      }))).toEqual({});
    });

    it('exige título y fechas en orden', () => {
      const e = validarTrabajo(formValido({ nombre: ' ', fecha_fin: '2026-10-15T07:00' }));
      expect(e.nombre).toBeTruthy();
      expect(e.fecha_fin).toBeTruthy();
      expect(validarTrabajo({ ...formValido(), fecha_inicio: '', fecha_fin: '' }))
        .toMatchObject({ fecha_inicio: expect.any(String), fecha_fin: expect.any(String) });
    });

    it('cada vehículo necesita vehículo y al menos un responsable', () => {
      expect(validarTrabajo(formValido({ vehiculos: [vehiculoVacio()] })).vehiculos)
        .toContain('al menos un responsable');
      expect(validarTrabajo(formValido({ vehiculos: [{ vehicle_id: '7', responsables: [''] }] })).vehiculos)
        .toBeTruthy();
    });

    it('el mismo vehículo no puede ir dos veces', () => {
      const e = validarTrabajo(formValido({ vehiculos: [
        { vehicle_id: '7', responsables: [20] }, { vehicle_id: 7, responsables: [21] },
      ] }));
      expect(e.vehiculos).toContain('dos veces');
    });

    it('ubicación de más de 255 caracteres', () => {
      expect(validarTrabajo(formValido({ ubicacion: 'x'.repeat(256) })).ubicacion).toBeTruthy();
    });
  });

  it('payloadTrabajo limpia textos, filas vacías y el km con puntos de miles', () => {
    const p = payloadTrabajo(formValido({
      nombre: ' Maratón ', descripcion: '  ', ubicacion: ' Retiro ',
      vehiculos: [{ vehicle_id: '7', responsables: ['20', '', 21], kilometros_inicio: '45.000' }],
      usuarios: [30, '31'],
    }));
    expect(p).toMatchObject({
      nombre: 'Maratón', descripcion: null, ubicacion: 'Retiro',
      vehiculos: [{ vehicle_id: 7, responsables: [20, 21], kilometros_inicio: 45000 }],
      usuarios: [30, 31],
    });
    // Hora española de la pantalla → UTC (en octubre, verano: -2 h)
    expect(p.fecha_inicio).toBe('2026-10-15T06:00');
  });

  describe('accionesVehiculo', () => {
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

  it('vehiculosConAcciones deja fuera los que no son de quien mira', () => {
    const t = { vehiculos: [
      { vehicle_id: 7, detalle: true, estado: 'activo', inicio_real_at: 'x',
        progreso_fotos: { inicio: { completo: true } } },
      { vehicle_id: 8, detalle: false, estado: 'activo' },
      { vehicle_id: 9, detalle: true, estado: 'finalizado' },
    ] };
    expect(vehiculosConAcciones(t).map(v => v.vehicle_id)).toEqual([7]);
    expect(vehiculosConAcciones(null)).toEqual([]);
  });

  it('nombresResponsables', () => {
    expect(nombresResponsables({ responsables: [
      { nombre: 'Ana', apellidos: 'Ruiz' }, { username: 'lgil' },
    ] })).toBe('Ana Ruiz, lgil');
    expect(nombresResponsables({})).toBe('');
  });
});

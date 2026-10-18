import { describe, it, expect } from 'vitest';
import { pasosAsignacion, estadoVisible, PASOS_ASIGNACION } from '../../../utils/pasosAsignacion.js';

const situaciones = (asig) => pasosAsignacion(asig).map(p => p.situacion);
const fotos = (completo) => ({ inicio: { completo } });

describe('utils/pasosAsignacion', () => {
  it('los pasos llevan el nombre de los botones, y los del evento son opcionales', () => {
    expect(PASOS_ASIGNACION.map(p => p.titulo)).toEqual([
      'Inicio de la asignación', 'Inicio evento/servicio', 'Fin evento/servicio', 'Finalizar asignación',
    ]);
    expect(PASOS_ASIGNACION.filter(p => p.opcional).map(p => p.clave)).toEqual(['llegada', 'fin_evento']);
  });

  describe('pasosAsignacion', () => {
    it('sin asignación o cancelada no hay pasos', () => {
      expect(pasosAsignacion(null)).toBeNull();
      expect(pasosAsignacion({ estado: 'cancelada' })).toBeNull();
    });

    it('programada o activa sin iniciar: toca el inicio', () => {
      expect(situaciones({ estado: 'programada' })).toEqual(['actual', 'pendiente', 'pendiente', 'pendiente']);
      expect(situaciones({ estado: 'activa', progreso: fotos(false) }))
        .toEqual(['actual', 'pendiente', 'pendiente', 'pendiente']);
    });

    it('iniciada con fotos a medias: sigue en el inicio, con el aviso', () => {
      const pasos = pasosAsignacion({ estado: 'activa', inicio_real_at: '2026-10-12T08:00:00Z', progreso: fotos(false) });
      expect(pasos[0]).toMatchObject({ situacion: 'actual', aviso: 'Faltan fotos', hora: null });
      expect(pasos[1].situacion).toBe('pendiente');
    });

    it('sin el aviso cuando ni siquiera se pulsó el inicio', () => {
      expect(pasosAsignacion({ estado: 'activa', progreso: fotos(false) })[0].aviso).toBeUndefined();
    });

    it('vale también con el `progreso_fotos` de la ficha de un trabajo', () => {
      const asig = { estado: 'activa', inicio_real_at: '2026-10-12T08:00:00Z', progreso_fotos: fotos(false) };
      expect(pasosAsignacion(asig)[0].aviso).toBe('Faltan fotos');
    });

    it('sin datos de fotos no se le pone pega al inicio', () => {
      expect(situaciones({ estado: 'activa', inicio_real_at: '2026-10-12T08:00:00Z' }))
        .toEqual(['hecho', 'actual', 'pendiente', 'pendiente']);
    });

    it('avanza paso a paso y cada hecho lleva su hora', () => {
      const asig = {
        estado: 'activa', progreso: fotos(true),
        inicio_real_at: '2026-10-12T08:00:00Z', llegada_servicio_at: '2026-10-12T08:40:00Z',
      };
      expect(situaciones(asig)).toEqual(['hecho', 'hecho', 'actual', 'pendiente']);
      expect(pasosAsignacion(asig).map(p => p.hora)).toEqual([
        '2026-10-12T08:00:00Z', '2026-10-12T08:40:00Z', null, null,
      ]);
      expect(situaciones({ ...asig, fin_servicio_at: '2026-10-12T12:00:00Z' }))
        .toEqual(['hecho', 'hecho', 'hecho', 'actual']);
    });

    it('cerrada sin pulsar el evento: «no consta», no pendiente (son opcionales)', () => {
      const asig = {
        estado: 'finalizada', inicio_real_at: '2026-10-12T08:00:00Z', finalizado_at: '2026-10-12T14:00:00Z',
      };
      expect(situaciones(asig)).toEqual(['hecho', 'no_consta', 'no_consta', 'hecho']);
      expect(pasosAsignacion(asig)[3].hora).toBe('2026-10-12T14:00:00Z');
    });

    it('cerrada antigua sin hora de inicio ni de cierre: hechos, sin hora', () => {
      const pasos = pasosAsignacion({ estado: 'finalizada' });
      expect(pasos[0]).toMatchObject({ situacion: 'hecho', hora: null });
      expect(pasos[3]).toMatchObject({ situacion: 'hecho', hora: null });
    });
  });

  describe('con jornadas por día (v39)', () => {
    const AHORA = new Date('2026-10-21T12:00:00Z');
    const J = (id, dia, over = {}) => ({ id, inicio: `${dia}T08:00:00Z`, fin: `${dia}T18:00:00Z`,
      inicio_real_at: null, fin_real_at: null, ...over });
    const hecha = (id, dia) => J(id, dia, { inicio_real_at: `${dia}T08:00:00Z`, fin_real_at: `${dia}T18:00:00Z` });
    const base = { estado: 'activa', inicio_real_at: '2026-10-20T06:00:00Z', progreso: fotos(true) };

    it('tres pasos: los del evento se cambian por «Jornadas», con cuántas van', () => {
      const pasos = pasosAsignacion({ ...base, jornadas: [hecha(1, '2026-10-20'), J(2, '2026-10-21'), J(3, '2026-10-22')] }, AHORA);
      expect(pasos.map(p => p.clave)).toEqual(['inicio', 'jornadas', 'cierre']);
      expect(pasos.map(p => p.situacion)).toEqual(['hecho', 'actual', 'pendiente']);
      expect(pasos[1].donde).toBe('1 de 3');
    });

    it('sin nada por fichar, las jornadas están hechas y toca finalizar', () => {
      const pasos = pasosAsignacion({ ...base, jornadas: [hecha(1, '2026-10-20'), hecha(2, '2026-10-21')] }, AHORA);
      expect(pasos.map(p => p.situacion)).toEqual(['hecho', 'hecho', 'actual']);
      expect(pasos[1].donde).toBe('2 de 2');
    });

    it('cerrada sin ninguna jornada fichada: no consta', () => {
      const pasos = pasosAsignacion({ ...base, estado: 'finalizada', jornadas: [J(1, '2026-10-20')] }, AHORA);
      expect(pasos[1].situacion).toBe('no_consta');
    });

    it('la tarjeta de «Mis trabajos» (sin la lista) también vale', () => {
      const pasos = pasosAsignacion({ ...base, num_jornadas: 2, jornadas_hechas: 2 });
      expect(pasos.map(p => p.situacion)).toEqual(['hecho', 'hecho', 'actual']);
    });
  });

  describe('estadoVisible', () => {
    it('activa se parte en «Sin iniciar» y «En curso»', () => {
      expect(estadoVisible({ estado: 'activa' })).toEqual({ texto: 'Sin iniciar', clase: 'badge-red' });
      expect(estadoVisible({ estado: 'activa', inicio_real_at: '2026-10-12T08:00:00Z' }))
        .toEqual({ texto: 'En curso', clase: 'badge-blue' });
    });

    it('el resto, con su etiqueta y color de siempre', () => {
      expect(estadoVisible({ estado: 'programada' })).toEqual({ texto: 'Programada', clase: 'badge-yellow' });
      expect(estadoVisible({ estado: 'finalizada' })).toEqual({ texto: 'Finalizada', clase: 'badge-green' });
      expect(estadoVisible({ estado: 'cancelada' })).toEqual({ texto: 'Cancelada', clase: 'badge-gray' });
    });

    it('un estado desconocido o sin asignación no rompe', () => {
      expect(estadoVisible({ estado: 'rara' })).toEqual({ texto: 'rara', clase: 'badge-gray' });
      expect(estadoVisible(null)).toEqual({ texto: '', clase: 'badge-gray' });
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  diasEntre, cruzaDias, rellenarDias, horarioDesdeApi, horarioAPayload, errorHorario,
  horarioDentro, horarioDelTrabajoPara, pasaMedianoche, etiquetaDia, textoTramos,
  situacionJornada, jornadaDelMomento, cuentaJornadas, textoJornada,
  accionJornada, inicioJornadaDesde, finJornadaAnticipado, resumenJornadas,
} from '../../../utils/jornadas.js';

const dia = (d, ...tramos) => ({ dia: d, tramos: tramos.map(([desde, hasta]) => ({ desde, hasta })) });

describe('utils/jornadas', () => {
  describe('días de un intervalo', () => {
    it('cuenta los días de calendario, con el primero y el último', () => {
      expect(diasEntre('2026-10-20T08:00', '2026-10-22T23:59')).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
      expect(cruzaDias('2026-10-20T08:00', '2026-10-22T23:59')).toBe(true);
    });

    it('lo que acaba justo a medianoche no ocupa el día siguiente', () => {
      expect(diasEntre('2026-10-20T08:00', '2026-10-21T00:00')).toEqual(['2026-10-20']);
      expect(cruzaDias('2026-10-20T08:00', '2026-10-21T00:00')).toBe(false);
    });

    it('sin fechas, o al revés, ninguno', () => {
      expect(diasEntre('', '2026-10-21T00:00')).toEqual([]);
      expect(diasEntre('2026-10-21T10:00', '2026-10-20T10:00')).toEqual([]);
    });
  });

  it('rellenarDias recorta el primer y el último día a las horas del trabajo', () => {
    const h = rellenarDias([], '2026-10-20T10:30', '2026-10-22T18:00', '09:00', '21:00');
    expect(h.map(d => d.tramos[0])).toEqual([
      { desde: '10:30', hasta: '21:00' }, { desde: '09:00', hasta: '21:00' }, { desde: '09:00', hasta: '18:00' }]);
    expect(errorHorario(h, '2026-10-20T10:30', '2026-10-22T18:00')).toBeNull();
    // un primer día que empieza después de la hora de fin no se propone
    expect(rellenarDias([], '2026-10-20T22:00', '2026-10-21T20:00', '09:00', '21:00').map(d => d.dia))
      .toEqual(['2026-10-21']);
  });

  it('rellenarDias pone un tramo por día y conserva los que ya estaban', () => {
    const previo = [dia('2026-10-21', ['10:00', '14:00'], ['15:00', '23:00'])];
    const h = rellenarDias(previo, '2026-10-20T08:00', '2026-10-22T23:00', '09:00', '21:00');
    expect(h.map(d => d.dia)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
    expect(h[0].tramos).toEqual([{ desde: '09:00', hasta: '21:00' }]);
    expect(h[1]).toBe(previo[0]);
  });

  describe('API ↔ formulario', () => {
    it('agrupa por día español y marca lo fichado', () => {
      const h = horarioDesdeApi([
        { inicio: '2026-10-20T08:00:00Z', fin: '2026-10-20T20:00:00Z', inicio_real_at: '2026-10-20T08:01:00Z' },
        // 23:30 UTC del 20 = 01:30 del 21 en España
        { inicio: '2026-10-20T23:30:00Z', fin: '2026-10-21T03:00:00Z' },
      ]);
      expect(h).toEqual([
        { dia: '2026-10-20', tramos: [{ desde: '10:00', hasta: '22:00', fichada: true }] },
        { dia: '2026-10-21', tramos: [{ desde: '01:30', hasta: '05:00' }] },
      ]);
      expect(horarioDesdeApi(undefined)).toEqual([]);
    });

    it('al mandarlo, un tramo que pasa de medianoche acaba al día siguiente', () => {
      expect(pasaMedianoche({ desde: '20:00', hasta: '02:00' })).toBe(true);
      expect(horarioAPayload([dia('2026-10-20', ['20:00', '02:00'])])).toEqual([
        { inicio: '2026-10-20T18:00', fin: '2026-10-21T00:00' }]);
    });

    it('ida y vuelta: lo que sale de la API vuelve igual', () => {
      const api = [{ inicio: '2026-10-21T08:00', fin: '2026-10-21T12:00' },
                   { inicio: '2026-10-21T13:00', fin: '2026-10-21T21:00' }];
      expect(horarioAPayload(horarioDesdeApi(api.map(t => ({ inicio: `${t.inicio}:00Z`, fin: `${t.fin}:00Z` })))))
        .toEqual(api);
    });
  });

  describe('errorHorario', () => {
    const INI = '2026-10-20T08:00';
    const FIN = '2026-10-22T23:00';
    it('un horario bueno, con turno partido', () => {
      expect(errorHorario([dia('2026-10-21', ['10:00', '14:00'], ['15:00', '23:00'])], INI, FIN)).toBeNull();
      expect(errorHorario([], INI, FIN)).toBeNull();
    });
    it('el mismo tope de tramos que el backend', () => {
      const muchos = Array.from({ length: 32 }, (_, i) =>
        dia(`2026-11-${String(i % 30 + 1).padStart(2, '0')}`, ['08:00', '12:00'], ['13:00', '20:00']));
      expect(errorHorario(muchos, '2026-11-01T00:00', '2026-12-31T00:00')).toContain('como mucho 62 tramos');
    });
    it.each([
      ['día sin tramos', [{ dia: '2026-10-21', tramos: [] }], 'ningún tramo'],
      ['hora a medias', [dia('2026-10-21', ['10:00', ''])], 'Completa las horas'],
      ['misma hora', [dia('2026-10-21', ['10:00', '10:00'])], 'misma hora'],
      ['solapados', [dia('2026-10-21', ['10:00', '15:00'], ['14:00', '20:00'])], 'se solapan'],
      ['el de medianoche pisa al día siguiente', [dia('2026-10-20', ['20:00', '11:00']), dia('2026-10-21', ['10:00', '12:00'])], 'se solapan'],
      ['fuera de las fechas', [dia('2026-10-23', ['10:00', '12:00'])], 'se sale'],
      ['antes del inicio', [dia('2026-10-20', ['07:00', '12:00'])], 'se sale'],
    ])('%s', (_, h, texto) => {
      expect(errorHorario(h, INI, FIN)).toContain(texto);
    });
  });

  it('horarioDentro deja los días que tocan las fechas de la ambulancia', () => {
    const h = [dia('2026-10-20', ['10:00', '22:00']), dia('2026-10-21', ['10:00', '22:00'])];
    expect(horarioDentro(h, '2026-10-21T06:00', '2026-10-21T23:00').map(d => d.dia)).toEqual(['2026-10-21']);
    expect(horarioDentro(h, '', '')).toEqual([]);
    expect(horarioDelTrabajoPara([{ inicio: '2026-10-20T08:00:00Z', fin: '2026-10-20T20:00:00Z' }],
      '2026-10-20T04:00:00Z', '2026-10-20T22:00:00Z')).toHaveLength(1);
  });

  it('textos: el día con su nombre y los tramos', () => {
    expect(etiquetaDia('2026-10-20')).toBe('Mar 20/10');
    expect(textoTramos([{ desde: '10:00', hasta: '14:00' }, { desde: '20:00', hasta: '02:00' }]))
      .toBe('10:00–14:00 y 20:00–02:00 (+1 día)');
    expect(textoJornada({ inicio: '2026-10-21T08:00:00Z', fin: '2026-10-21T12:00:00Z' })).toBe('Mié 21/10, 10:00–14:00');
  });

  describe('fichaje', () => {
    const AHORA = new Date('2026-10-21T10:00:00Z');
    const j = (id, inicio, fin, over = {}) => ({ id, inicio, fin, inicio_real_at: null, fin_real_at: null, ...over });
    const lista = [
      j(1, '2026-10-20T08:00:00Z', '2026-10-20T20:00:00Z', { inicio_real_at: 'x', fin_real_at: 'y' }),
      j(2, '2026-10-21T08:00:00Z', '2026-10-21T20:00:00Z'),
      j(3, '2026-10-22T08:00:00Z', '2026-10-22T20:00:00Z'),
    ];

    it('situacionJornada', () => {
      expect(situacionJornada(lista[0], AHORA)).toBe('hecha');
      expect(situacionJornada({ ...lista[0], cierre_auto: true }, AHORA)).toBe('cerrada_sola');
      expect(situacionJornada({ ...lista[1], inicio_real_at: 'x' }, AHORA)).toBe('en_curso');
      expect(situacionJornada(lista[2], AHORA)).toBe('pendiente');
      expect(situacionJornada(j(9, '2026-10-19T08:00:00Z', '2026-10-19T20:00:00Z'), AHORA)).toBe('no_consta');
    });

    it('jornadaDelMomento: la que está en curso, o la siguiente que no ha terminado', () => {
      expect(jornadaDelMomento(lista, AHORA).id).toBe(2);
      const enCurso = [lista[0], { ...lista[1], inicio_real_at: 'x' }, lista[2]];
      expect(jornadaDelMomento(enCurso, new Date('2026-10-22T09:00:00Z')).id).toBe(2);
      expect(jornadaDelMomento([lista[0]], AHORA)).toBeNull();
      expect(jornadaDelMomento(undefined)).toBeNull();
    });

    it('cuentaJornadas', () => {
      expect(cuentaJornadas(lista)).toEqual({ hechas: 1, total: 3 });
      expect(cuentaJornadas(null)).toEqual({ hechas: 0, total: 0 });
    });
  });

  describe('accionJornada y compañía (qué botón toca)', () => {
    const j = (id, inicio, fin, over = {}) => ({ id, inicio, fin, inicio_real_at: null, fin_real_at: null, ...over });
    const D21 = j(2, '2026-10-21T08:00:00Z', '2026-10-21T18:00:00Z');
    const D22 = j(3, '2026-10-22T08:00:00Z', '2026-10-22T18:00:00Z');

    it('antes de la media hora previa: esperar; dentro: inicio', () => {
      expect(accionJornada([D21], new Date('2026-10-21T07:00:00Z')).principal).toBe('esperar');
      expect(accionJornada([D21], new Date('2026-10-21T07:30:00Z')).principal).toBe('inicio');
      expect(inicioJornadaDesde(D21).toISOString()).toBe('2026-10-21T07:30:00.000Z');
    });

    it('con una en curso: fin; si la siguiente ya se puede, inicio (la abierta se cerrará sola)', () => {
      const abierta = { ...D21, inicio_real_at: '2026-10-21T08:00:00Z' };
      const tarde = accionJornada([abierta, D22], new Date('2026-10-21T17:00:00Z'));
      expect(tarde).toMatchObject({ principal: 'fin', abierta, siguiente: D22 });
      expect(accionJornada([abierta, D22], new Date('2026-10-22T07:45:00Z')).principal).toBe('inicio');
    });

    it('con una abierta aún en su horario, el principal es su fin aunque la siguiente ya se pueda iniciar', () => {
      const abierta = { ...D21, fin: '2026-10-21T14:00:00Z', inicio_real_at: '2026-10-21T08:00:00Z' };
      const tarde = { ...D21, id: 9, inicio: '2026-10-21T14:00:00Z', fin: '2026-10-21T18:00:00Z' };
      expect(accionJornada([abierta, tarde], new Date('2026-10-21T13:45:00Z')).principal).toBe('fin');
      // pasada su hora ya es un olvido: se ofrece la siguiente (y la abierta se cerrará sola)
      expect(accionJornada([abierta, tarde], new Date('2026-10-21T14:05:00Z')).principal).toBe('inicio');
    });

    it('sin nada que fichar: null', () => {
      const hecha = { ...D21, inicio_real_at: 'x', fin_real_at: 'y' };
      expect(accionJornada([hecha], new Date('2026-10-22T00:00:00Z')).principal).toBeNull();
      expect(accionJornada(undefined).principal).toBeNull();
    });

    it('el fin pide motivo solo más de 30 min antes de lo previsto', () => {
      expect(finJornadaAnticipado(D21, new Date('2026-10-21T17:00:00Z'))).toBe(true);
      expect(finJornadaAnticipado(D21, new Date('2026-10-21T17:31:00Z'))).toBe(false);
    });

    it('resumenJornadas lee la ficha o la tarjeta de «Mis trabajos»', () => {
      expect(resumenJornadas({ jornadas: [{ ...D21, inicio_real_at: 'x' }, D22] }))
        .toEqual({ total: 2, hechas: 0, enCurso: true });
      expect(resumenJornadas({ num_jornadas: 3, jornadas_hechas: 1, en_jornada: false }))
        .toEqual({ total: 3, hechas: 1, enCurso: false });
      expect(resumenJornadas(null)).toEqual({ total: 0, hechas: 0, enCurso: false });
    });
  });
});


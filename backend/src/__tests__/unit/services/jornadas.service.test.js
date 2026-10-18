'use strict';

const { query } = require('../../../config/database');
const jornadas = require('../../../services/jornadas.service');

const T = (s) => new Date(`${s}Z`);

/** Conexión de transacción que apunta lo que se ejecuta y contesta a los SELECT. */
function conexion(respuestas = {}) {
  const ejecutadas = [];
  return {
    ejecutadas,
    execute: jest.fn(async (sql, params) => {
      ejecutadas.push({ sql, params });
      for (const [trozo, filas] of Object.entries(respuestas)) {
        if (sql.includes(trozo)) return [filas];
      }
      return [{ affectedRows: 1 }];
    }),
  };
}

describe('jornadas.service', () => {
  beforeEach(() => { jest.clearAllMocks(); query.mockReset(); });

  describe('leerHorario', () => {
    const FECHAS = { fecha_inicio: '2026-10-20 06:00:00', fecha_fin: '2026-10-22 22:00:00' };

    it('sin campo no toca nada; null o vacío es «sin horario»', () => {
      expect(jornadas.leerHorario(undefined)).toEqual({ horario: undefined });
      expect(jornadas.leerHorario(null)).toEqual({ horario: [] });
      expect(jornadas.leerHorario([])).toEqual({ horario: [] });
    });

    it('ordena por inicio y admite turno partido el mismo día', () => {
      const { horario, error } = jornadas.leerHorario([
        { inicio: '2026-10-21T13:00', fin: '2026-10-21T21:00' },
        { inicio: '2026-10-21T08:00', fin: '2026-10-21T12:00' },
        { inicio: '2026-10-20T08:00', fin: '2026-10-20T20:00' },
      ], FECHAS);
      expect(error).toBeUndefined();
      expect(horario.map(t => t.inicio.toISOString())).toEqual([
        '2026-10-20T08:00:00.000Z', '2026-10-21T08:00:00.000Z', '2026-10-21T13:00:00.000Z']);
    });

    it('un tramo puede pasar de medianoche', () => {
      const { horario } = jornadas.leerHorario([{ inicio: '2026-10-20T18:00', fin: '2026-10-21T01:00' }], FECHAS);
      expect(horario).toHaveLength(1);
    });

    it('con zona, la respeta (instante UTC)', () => {
      const { horario } = jornadas.leerHorario([{ inicio: '2026-10-20T10:00:00+02:00', fin: '2026-10-20T12:00:00+02:00' }]);
      expect(horario[0].inicio.toISOString()).toBe('2026-10-20T08:00:00.000Z');
    });

    it.each([
      ['no es lista', { a: 1 }, 'debe ser una lista'],
      ['sin horas', [{ inicio: '2026-10-20T08:00' }], 'hora de inicio y de fin'],
      ['fecha inválida', [{ inicio: 'mañana', fin: '2026-10-20T10:00' }], 'hora de inicio y de fin'],
      ['fin antes que inicio', [{ inicio: '2026-10-20T10:00', fin: '2026-10-20T08:00' }], 'termina antes de empezar'],
      ['más de 24 h', [{ inicio: '2026-10-20T08:00', fin: '2026-10-21T09:00' }], 'más de 24 horas'],
      ['solapados', [{ inicio: '2026-10-20T08:00', fin: '2026-10-20T14:00' },
                     { inicio: '2026-10-20T13:00', fin: '2026-10-20T20:00' }], 'se solapan'],
      ['antes de las fechas', [{ inicio: '2026-10-20T05:00', fin: '2026-10-20T10:00' }], 'fuera de las fechas'],
      ['después de las fechas', [{ inicio: '2026-10-22T20:00', fin: '2026-10-22T23:00' }], 'fuera de las fechas'],
    ])('rechaza: %s', (_, lista, texto) => {
      expect(jornadas.leerHorario(lista, FECHAS).error).toContain(texto);
    });

    it('dos tramos que se tocan no se solapan', () => {
      const { error } = jornadas.leerHorario([
        { inicio: '2026-10-20T08:00', fin: '2026-10-20T14:00' },
        { inicio: '2026-10-20T14:00', fin: '2026-10-20T20:00' }], FECHAS);
      expect(error).toBeUndefined();
    });

    it('rechaza más del tope de tramos', () => {
      const lista = Array.from({ length: jornadas.MAX_TRAMOS + 1 }, () => ({ inicio: 'x', fin: 'y' }));
      expect(jornadas.leerHorario(lista).error).toContain('como mucho');
    });
  });

  describe('tramosDentro', () => {
    it('se queda con los tramos que tocan las fechas de la ambulancia', () => {
      const horario = [
        { inicio: T('2026-10-20T08:00'), fin: T('2026-10-20T20:00') },
        { inicio: T('2026-10-21T08:00'), fin: T('2026-10-21T20:00') },
        { inicio: T('2026-10-22T08:00'), fin: T('2026-10-22T20:00') },
      ];
      const dentro = jornadas.tramosDentro(horario, '2026-10-21 06:00:00', '2026-10-22 23:00:00');
      expect(dentro).toEqual(horario.slice(1));
      expect(jornadas.tramosDentro(undefined, '2026-10-21 06:00:00', '2026-10-22 23:00:00')).toEqual([]);
    });
  });

  describe('lecturas', () => {
    it('horarioDelTrabajo y jornadasDe leen ordenado por inicio', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]);
      expect(await jornadas.horarioDelTrabajo(5)).toEqual([{ id: 1 }]);
      expect(query.mock.calls[0][0]).toContain('ORDER BY inicio');
      expect(query.mock.calls[0][1]).toEqual([5]);

      query.mockResolvedValueOnce([[{ id: 3, cierre_auto: 1 }, { id: 4, cierre_auto: 0 }]]);
      const filas = await jornadas.jornadasDe(9);
      expect(filas.map(j => j.cierre_auto)).toEqual([true, false]);
      expect(query.mock.calls[1][1]).toEqual([9]);
    });
  });

  describe('guardarHorarioTrabajo', () => {
    it('borra la plantilla y la vuelve a escribir', async () => {
      const conn = conexion();
      await jornadas.guardarHorarioTrabajo(conn, 7, [
        { inicio: T('2026-10-20T08:00'), fin: T('2026-10-20T20:00') }]);
      expect(conn.ejecutadas[0].sql).toContain('DELETE FROM trabajo_jornadas');
      expect(conn.ejecutadas[1].sql).toContain('INSERT INTO trabajo_jornadas');
      expect(conn.ejecutadas[1].params[0]).toBe(7);
    });
  });

  describe('aplicarJornadas', () => {
    const fila = (id, ini, fin, fichada = null) =>
      ({ id, inicio: T(ini), fin: T(fin), inicio_real_at: fichada ? T(fichada) : null });

    it('lo que no cambia se queda con su id (y su candado); nunca borra una fichada', async () => {
      const conn = conexion({ 'FOR UPDATE': [
        fila(1, '2026-10-20T08:00', '2026-10-20T20:00', '2026-10-20T08:05'),   // fichada
        fila(2, '2026-10-21T08:00', '2026-10-21T20:00'),                        // igual: se queda
        fila(3, '2026-10-22T08:00', '2026-10-22T20:00'),                        // mismo inicio: cambia el fin
        fila(4, '2026-10-23T08:00', '2026-10-23T20:00'),                        // ya no está: se borra
      ] });
      const { conservadas } = await jornadas.aplicarJornadas(conn, 50, [
        { inicio: T('2026-10-20T09:00'), fin: T('2026-10-20T21:00') },   // encima de la fichada
        { inicio: T('2026-10-21T08:00'), fin: T('2026-10-21T20:00') },
        { inicio: T('2026-10-22T08:00'), fin: T('2026-10-22T14:00') },
        { inicio: T('2026-10-24T08:00'), fin: T('2026-10-24T20:00') },   // nueva
      ]);
      expect(conservadas).toBe(1);
      const ej = conn.ejecutadas;
      expect(ej.find(e => e.sql.startsWith('UPDATE asignacion_jornadas SET inicio = ?')).params[2]).toBe(1);
      expect(ej.find(e => e.sql.startsWith('UPDATE asignacion_jornadas SET fin = ?')).params[1]).toBe(3);
      expect(ej.filter(e => e.sql.includes('INSERT INTO asignacion_jornadas'))).toHaveLength(1);
      const borrar = ej.find(e => e.sql.startsWith('DELETE'));
      expect(borrar.params).toEqual([4]);
      expect(borrar.sql).toContain('inicio_real_at IS NULL');
      // Nada toca la 2: conserva id y aviso_sin_iniciar_at
      expect(ej.some(e => e.params?.includes(2) && !e.sql.includes('FOR UPDATE'))).toBe(false);
    });

    it('un tramo que pisa una fichada es esa jornada, aunque empiece donde una libre', async () => {
      const conn = conexion({ 'FOR UPDATE': [
        fila(1, '2026-10-20T08:00', '2026-10-20T12:00'),                        // libre
        fila(2, '2026-10-20T14:00', '2026-10-20T18:00', '2026-10-20T14:05'),   // fichada
      ] });
      await jornadas.aplicarJornadas(conn, 50, [{ inicio: T('2026-10-20T08:00'), fin: T('2026-10-20T16:00') }]);
      const ej = conn.ejecutadas;
      // se mueve la fichada y la libre se borra: nada queda solapado
      expect(ej.find(e => e.sql.startsWith('UPDATE asignacion_jornadas SET inicio = ?')).params[2]).toBe(2);
      expect(ej.some(e => e.sql.startsWith('UPDATE asignacion_jornadas SET fin = ?'))).toBe(false);
      expect(ej.find(e => e.sql.startsWith('DELETE')).params).toEqual([1]);
    });

    it('sin horario borra las no fichadas y deja las fichadas', async () => {
      const conn = conexion({ 'FOR UPDATE': [
        fila(1, '2026-10-20T08:00', '2026-10-20T20:00', '2026-10-20T08:05'),
        fila(2, '2026-10-21T08:00', '2026-10-21T20:00'),
      ] });
      await jornadas.aplicarJornadas(conn, 50, []);
      expect(conn.ejecutadas.filter(e => e.sql.includes('INSERT'))).toHaveLength(0);
      expect(conn.ejecutadas.find(e => e.sql.startsWith('DELETE')).params).toEqual([2]);
    });

    it('sin nada que sobre no lanza un DELETE vacío', async () => {
      const conn = conexion({ 'FOR UPDATE': [] });
      await jornadas.aplicarJornadas(conn, 50, [{ inicio: T('2026-10-20T08:00'), fin: T('2026-10-20T20:00') }]);
      expect(conn.ejecutadas.some(e => e.sql.startsWith('DELETE'))).toBe(false);
    });
  });

  describe('propagarHorarioDelTrabajo y heredarDelTrabajo', () => {
    it('lleva a cada ambulancia que sigue al trabajo los tramos de sus fechas', async () => {
      const conn = conexion({
        'horario_propio = 0': [
          { id: 60, fecha_inicio: T('2026-10-20T06:00'), fecha_fin: T('2026-10-20T23:00') },
          { id: 61, fecha_inicio: T('2026-10-21T06:00'), fecha_fin: T('2026-10-21T23:00') },
        ],
        'FOR UPDATE': [],
      });
      await jornadas.propagarHorarioDelTrabajo(conn, 7, [
        { inicio: T('2026-10-20T08:00'), fin: T('2026-10-20T20:00') },
        { inicio: T('2026-10-21T08:00'), fin: T('2026-10-21T20:00') },
      ]);
      const sel = conn.ejecutadas[0];
      expect(sel.sql).toContain("estado IN ('programada', 'activa')");
      const inserts = conn.ejecutadas.filter(e => e.sql.includes('INSERT INTO asignacion_jornadas'));
      expect(inserts.map(e => e.params[0])).toEqual([60, 61]);
    });

    it('heredarDelTrabajo lee la plantilla dentro de la transacción', async () => {
      const conn = conexion({
        'FROM trabajo_jornadas': [{ id: 1, inicio: T('2026-10-20T08:00'), fin: T('2026-10-20T20:00') }],
        'FOR UPDATE': [],
      });
      await jornadas.heredarDelTrabajo(conn, 60, 7, '2026-10-20 06:00:00', '2026-10-20 23:00:00');
      expect(conn.ejecutadas.filter(e => e.sql.includes('INSERT INTO asignacion_jornadas'))).toHaveLength(1);
      expect(query).not.toHaveBeenCalled();
    });
  });

  it('resumenHorario da el horario en hora española, comparable', () => {
    expect(jornadas.resumenHorario([{ inicio: T('2026-10-20T08:00'), fin: T('2026-10-20T20:00') }]))
      .toEqual(['20/10 10:00–20/10 22:00']);
    expect(jornadas.resumenHorario(undefined)).toEqual([]);
  });
});

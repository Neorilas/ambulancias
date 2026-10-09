'use strict';

/**
 * Tests de services/estadoTrabajo.service.js — el estado del trabajo se deriva
 * de sus ambulancias (asignaciones desde v33; trabajo_vehiculos antes).
 */

const { query } = require('../../../config/database');

jest.mock('../../../services/avisosAsignacion.service', () => ({
  avisarTrabajoPendienteCierre: jest.fn(),
}));

const avisos = require('../../../services/avisosAsignacion.service');
const {
  estadoTrabajoDesde, estadoTrabajoDesdeAsignaciones,
  sincronizarEstadoTrabajo, avisarSiPendienteCierre,
} = require('../../../services/estadoTrabajo.service');

/** Conexión que contesta por SQL y apunta lo que se ejecuta. */
function conexion({ asignaciones = [], vehiculos = [], afectadas = 1 } = {}) {
  const ejecutadas = [];
  return {
    ejecutadas,
    execute: jest.fn(async (sql, params) => {
      ejecutadas.push({ sql, params });
      if (sql.includes('FROM asignaciones_libres')) return [asignaciones.map(estado => ({ estado }))];
      if (sql.includes('FROM trabajo_vehiculos'))   return [vehiculos.map(estado => ({ estado }))];
      if (sql.startsWith('UPDATE trabajos'))        return [{ affectedRows: afectadas }];
      return [[]];
    }),
  };
}

describe('estadoTrabajo.service', () => {
  beforeEach(() => { jest.clearAllMocks(); query.mockReset(); });

  describe('estadoTrabajoDesdeAsignaciones (modelo nuevo)', () => {
    it.each([
      [[], null],
      [['programada', 'programada'], 'programado'],
      [['activa', 'programada'], 'activo'],
      // Una cerrada y otra sin empezar: el trabajo está en marcha
      [['finalizada', 'programada'], 'activo'],
      // Todas cerradas: NO se cierra solo, espera al coordinador (D3)
      [['finalizada', 'finalizada'], 'pendiente_cierre'],
      // Las canceladas no cuentan, ni para retener ni para cerrar
      [['finalizada', 'cancelada'], 'pendiente_cierre'],
      [['programada', 'cancelada'], 'programado'],
      [['cancelada'], null],
    ])('%j → %s', (estados, esperado) => {
      expect(estadoTrabajoDesdeAsignaciones(estados)).toBe(esperado);
    });
  });

  describe('estadoTrabajoDesde (modelo antiguo, v25)', () => {
    it('todos cerrados → finalizado, sin pasar por pendiente de cierre', () => {
      expect(estadoTrabajoDesde(['finalizado', 'finalizado'])).toBe('finalizado');
      expect(estadoTrabajoDesde(['finalizado', 'finalizado_anticipado'])).toBe('finalizado_anticipado');
      expect(estadoTrabajoDesde([])).toBeNull();
    });
  });

  describe('sincronizarEstadoTrabajo', () => {
    it('con asignaciones manda el modelo nuevo y no mira trabajo_vehiculos', async () => {
      const conn = conexion({ asignaciones: ['finalizada', 'finalizada'], vehiculos: ['programado'] });
      const r = await sincronizarEstadoTrabajo(conn, 40);

      expect(r).toEqual({ estado: 'pendiente_cierre', cambia: true });
      expect(conn.ejecutadas.some(e => e.sql.includes('trabajo_vehiculos'))).toBe(false);
      const upd = conn.ejecutadas.find(e => e.sql.startsWith('UPDATE trabajos'));
      expect(upd.params).toEqual(['pendiente_cierre', 40, 'pendiente_cierre']);
      // Un trabajo ya cerrado por el coordinador no lo reabre nada derivado
      expect(upd.sql).toContain("estado NOT IN ('finalizado', 'finalizado_anticipado')");
      // Y solo cuenta como cambio si el estado era otro
      expect(upd.sql).toContain('estado <> ?');
    });

    it('las asignaciones borradas no cuentan', async () => {
      const conn = conexion({ asignaciones: ['activa'] });
      await sincronizarEstadoTrabajo(conn, 40);
      expect(conn.ejecutadas[0].sql).toContain('deleted_at IS NULL');
    });

    it('sin asignaciones cae al modelo antiguo', async () => {
      const conn = conexion({ vehiculos: ['activo', 'programado'] });
      const r = await sincronizarEstadoTrabajo(conn, 7);
      expect(r).toEqual({ estado: 'activo', cambia: true });
    });

    it('si el UPDATE no toca la fila (ya estaba así, o cerrado) no hay cambio', async () => {
      const conn = conexion({ asignaciones: ['finalizada'], afectadas: 0 });
      expect(await sincronizarEstadoTrabajo(conn, 40)).toEqual({ estado: 'pendiente_cierre', cambia: false });
    });

    it('sin ninguna ambulancia no escribe nada', async () => {
      const conn = conexion();
      expect(await sincronizarEstadoTrabajo(conn, 40)).toEqual({ estado: null, cambia: false });
      expect(conn.ejecutadas.some(e => e.sql.startsWith('UPDATE'))).toBe(false);
    });
  });

  describe('avisarSiPendienteCierre', () => {
    it('avisa al coordinador solo si ESTA llamada dejó el trabajo pendiente de cierre', async () => {
      query.mockResolvedValue([[{ id: 40, nombre: 'Maratón', coordinador_user_id: 5 }]]);

      await avisarSiPendienteCierre(40, { estado: 'pendiente_cierre', cambia: true });
      expect(avisos.avisarTrabajoPendienteCierre).toHaveBeenCalledWith(
        expect.objectContaining({ id: 40, coordinador_user_id: 5 }));

      avisos.avisarTrabajoPendienteCierre.mockClear();
      await avisarSiPendienteCierre(40, { estado: 'pendiente_cierre', cambia: false });
      await avisarSiPendienteCierre(40, { estado: 'activo', cambia: true });
      await avisarSiPendienteCierre(null, { estado: 'pendiente_cierre', cambia: true });
      await avisarSiPendienteCierre(40, null);
      expect(avisos.avisarTrabajoPendienteCierre).not.toHaveBeenCalled();
    });

    it('un fallo de BD no se propaga', async () => {
      query.mockRejectedValueOnce(new Error('boom'));
      await expect(avisarSiPendienteCierre(40, { estado: 'pendiente_cierre', cambia: true }))
        .resolves.toBeUndefined();
    });
  });
});

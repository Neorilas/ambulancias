import { describe, it, expect } from 'vitest';
import {
  esDiaValido, sumarMes, cuadriculaMes, diasDeEntrada, entradasDelDia,
  situacionEntrada, textoPapel, diaInicial, diaAlCambiarDeMes, SITUACIONES,
} from '../../../utils/calendario.js';

describe('calendario', () => {
  describe('esDiaValido', () => {
    it('acepta un día que existe y rechaza el resto', () => {
      expect(esDiaValido('2026-10-14')).toBe(true);
      expect(esDiaValido('2028-02-29')).toBe(true);
      expect(esDiaValido('2026-02-29')).toBe(false);
      expect(esDiaValido('2026-13-01')).toBe(false);
      expect(esDiaValido('2026-10-1')).toBe(false);
      expect(esDiaValido('hoy')).toBe(false);
      expect(esDiaValido(null)).toBe(false);
    });
  });

  describe('sumarMes', () => {
    it('cruza el año en los dos sentidos', () => {
      expect(sumarMes('2026-10', 1)).toBe('2026-11');
      expect(sumarMes('2026-12', 1)).toBe('2027-01');
      expect(sumarMes('2026-01', -1)).toBe('2025-12');
      expect(sumarMes('2026-03', -14)).toBe('2025-01');
    });
  });

  describe('cuadriculaMes', () => {
    it('empieza en lunes: octubre de 2026 (jueves 1) lleva tres huecos', () => {
      const celdas = cuadriculaMes('2026-10');
      expect(celdas.slice(0, 4)).toEqual([null, null, null, '2026-10-01']);
      expect(celdas).toHaveLength(3 + 31);
      expect(celdas.at(-1)).toBe('2026-10-31');
    });

    it('un mes que empieza en lunes no lleva huecos, y uno en domingo lleva seis', () => {
      expect(cuadriculaMes('2026-06')[0]).toBe('2026-06-01');
      const febrero = cuadriculaMes('2026-02');
      expect(febrero.indexOf('2026-02-01')).toBe(6);
      expect(febrero.filter(Boolean)).toHaveLength(28);
    });
  });

  describe('diasDeEntrada', () => {
    it('un servicio de una mañana ocupa ese día', () => {
      expect(diasDeEntrada({ fecha_inicio: '2026-10-14T06:00:00Z', fecha_fin: '2026-10-14T12:00:00Z' }))
        .toEqual(['2026-10-14', '2026-10-14']);
    });

    it('cuenta en día español: las 00:30 del 15 en España son el 14 en UTC', () => {
      expect(diasDeEntrada({ fecha_inicio: '2026-10-14T22:30:00Z', fecha_fin: '2026-10-15T04:00:00Z' }))
        .toEqual(['2026-10-15', '2026-10-15']);
    });

    it('lo que acaba justo a medianoche no ocupa el día siguiente', () => {
      // 20:00 → 00:00 en España (verano, UTC+2)
      expect(diasDeEntrada({ fecha_inicio: '2026-10-14T18:00:00Z', fecha_fin: '2026-10-14T22:00:00Z' }))
        .toEqual(['2026-10-14', '2026-10-14']);
      // Un minuto más tarde, sí
      expect(diasDeEntrada({ fecha_inicio: '2026-10-14T18:00:00Z', fecha_fin: '2026-10-14T22:01:00Z' }))
        .toEqual(['2026-10-14', '2026-10-15']);
    });

    it('varios días, y un fin igual o anterior al inicio se queda en el día de inicio', () => {
      expect(diasDeEntrada({ fecha_inicio: '2026-10-10T08:00:00Z', fecha_fin: '2026-10-12T18:00:00Z' }))
        .toEqual(['2026-10-10', '2026-10-12']);
      expect(diasDeEntrada({ fecha_inicio: '2026-10-10T08:00:00Z', fecha_fin: '2026-10-10T08:00:00Z' }))
        .toEqual(['2026-10-10', '2026-10-10']);
      expect(diasDeEntrada({ fecha_inicio: '2026-10-10T08:00:00Z', fecha_fin: '2026-10-09T08:00:00Z' }))
        .toEqual(['2026-10-10', '2026-10-10']);
    });
  });

  describe('entradasDelDia', () => {
    const feria   = { trabajo_id: 1, fecha_inicio: '2026-10-10T08:00:00Z', fecha_fin: '2026-10-12T18:00:00Z' };
    const maraton = { trabajo_id: 2, fecha_inicio: '2026-10-12T06:00:00Z', fecha_fin: '2026-10-12T12:00:00Z' };

    it('las que pisan ese día, en el orden de llegada', () => {
      expect(entradasDelDia([feria, maraton], '2026-10-12')).toEqual([feria, maraton]);
      expect(entradasDelDia([feria, maraton], '2026-10-11')).toEqual([feria]);
      expect(entradasDelDia([feria, maraton], '2026-10-13')).toEqual([]);
    });
  });

  describe('situacionEntrada', () => {
    it('manda su ambulancia: terminada aunque el trabajo siga abierto', () => {
      expect(situacionEntrada({ asignacion_estado: 'finalizada', trabajo_estado: 'activo' })).toBe('terminado');
      expect(situacionEntrada({ asignacion_estado: 'programada', trabajo_estado: 'activo' })).toBe('programado');
      expect(situacionEntrada({ asignacion_estado: 'activa', trabajo_estado: 'activo' })).toBe('en_curso');
    });

    it('sin ambulancia, el trabajo', () => {
      expect(situacionEntrada({ asignacion_estado: null, trabajo_estado: 'programado' })).toBe('programado');
      expect(situacionEntrada({ asignacion_estado: null, trabajo_estado: 'pendiente_cierre' })).toBe('en_curso');
      expect(situacionEntrada({ asignacion_estado: null, trabajo_estado: 'finalizado_anticipado' })).toBe('terminado');
    });

    it('cada situación tiene texto y color', () => {
      for (const s of ['programado', 'en_curso', 'terminado']) {
        expect(SITUACIONES[s]).toEqual({ texto: expect.any(String), punto: expect.stringMatching(/^bg-/) });
      }
    });
  });

  describe('textoPapel', () => {
    it('dice qué pinta en cada caso', () => {
      expect(textoPapel({ mi_papel: 'responsable', vehiculo: 'UVI-1' })).toBe('Llevas UVI-1');
      expect(textoPapel({ mi_papel: 'equipo', vehiculo: 'SVB-2' })).toBe('Vas en el equipo de SVB-2');
      expect(textoPapel({ mi_papel: 'coordinador' })).toBe('Coordinas este trabajo');
      expect(textoPapel({ mi_papel: 'equipo_trabajo' })).toBe('Estás en el equipo del trabajo');
      expect(textoPapel({ mi_papel: 'v25' })).toBe('Vas en este trabajo');
    });
  });

  describe('diaInicial / diaAlCambiarDeMes', () => {
    it('el día de la URL si vale; si no, hoy', () => {
      expect(diaInicial('2026-09-03', '2026-10-11')).toBe('2026-09-03');
      expect(diaInicial('2026-09-31', '2026-10-11')).toBe('2026-10-11');
      expect(diaInicial(null, '2026-10-11')).toBe('2026-10-11');
      expect(diaInicial(null)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('al cambiar de mes: hoy si es el mes en curso, si no el día 1', () => {
      expect(diaAlCambiarDeMes('2026-10', '2026-10-11')).toBe('2026-10-11');
      expect(diaAlCambiarDeMes('2026-11', '2026-10-11')).toBe('2026-11-01');
      expect(diaAlCambiarDeMes('2026-11')).toMatch(/^2026-11-01$|^2026-11-\d{2}$/);
    });
  });
});

import { describe, it, expect } from 'vitest';
import {
  formatDate, formatDateTime, formatDateTimeShort,
  toUtcIso, toInputDatetime, toInputDate,
  isWorkActive, isOverdue, duration,
  diaEnEspana, formatFechaSola, formatDiaCalendario, sumarDias, sumarMeses, diasHasta,
} from '../../../utils/dateUtils';

describe('dateUtils', () => {
  describe('formatDate', () => {
    it('formats date correctly', () => {
      expect(formatDate('2026-04-13')).toMatch(/13\/04\/2026/);
    });
    it('returns — for null', () => {
      expect(formatDate(null)).toBe('—');
    });
    it('returns — for invalid date', () => {
      expect(formatDate('not-a-date')).toBe('—');
    });
  });

  describe('formatDateTime', () => {
    it('formats datetime', () => {
      const result = formatDateTime('2026-04-13T14:30:00');
      expect(result).toContain('13/04/2026');
      expect(result).toContain(':');
    });
  });

  describe('formatDateTimeShort', () => {
    it('formats short datetime', () => {
      const result = formatDateTimeShort('2026-04-13T14:30:00');
      expect(result).toContain('13/04');
    });
  });

  // La app se usa en España: se pinte donde se pinte, la hora que sale por
  // pantalla es la española, no la del dispositivo. Y lo que se teclea en un
  // datetime-local se interpreta también como hora española.
  describe('siempre en hora española', () => {
    it('pinta en CEST (+02:00) una fecha de verano', () => {
      expect(formatDateTime('2026-09-18T18:08:50.000Z')).toBe('18/09/2026 20:08');
    });
    it('pinta en CET (+01:00) una fecha de invierno', () => {
      expect(formatDateTime('2026-01-15T10:00:00.000Z')).toBe('15/01/2026 11:00');
    });
    it('lee el input como hora española y lo manda en UTC', () => {
      expect(toUtcIso('2026-09-18T20:08')).toBe('2026-09-18T18:08');
      expect(toUtcIso('2026-01-15T11:00')).toBe('2026-01-15T10:00');
    });
    it('toInputDatetime es el inverso exacto de toUtcIso', () => {
      expect(toInputDatetime(`${toUtcIso('2026-09-18T20:08')}:00.000Z`)).toBe('2026-09-18T20:08');
      expect(toInputDatetime(`${toUtcIso('2026-01-15T11:00')}:00.000Z`)).toBe('2026-01-15T11:00');
    });
    it('no se salta el día al cruzar la medianoche española', () => {
      // 22:30 UTC del 30 de junio son ya las 00:30 del 1 de julio en España
      expect(formatDateTime('2026-06-30T22:30:00.000Z')).toBe('01/07/2026 00:30');
    });
  });

  // Una caducidad de ITV o un día de servicio no llevan hora: no son un
  // instante, así que no se convierten de zona. Convertirlos hacía que un
  // dispositivo al oeste de UTC mostrara el día anterior.
  describe('fechas sin hora', () => {
    it('formatFechaSola lee el día tal cual', () => {
      expect(formatFechaSola('2026-09-30')).toBe('30/09/2026');
      expect(formatFechaSola('2026-09-30T00:00:00.000Z')).toBe('30/09/2026');
      expect(formatFechaSola(null)).toBe('—');
      expect(formatFechaSola('vaya')).toBe('—');
    });

    it('formatDiaCalendario da el nombre del día correcto', () => {
      expect(formatDiaCalendario('2026-09-19', 'EEE')).toBe('sáb');
      expect(formatDiaCalendario('2026-09-19')).toBe('19/09/2026');
      expect(formatDiaCalendario('nada')).toBe('—');
    });

    it('sumarDias cruza bien el fin de mes', () => {
      expect(sumarDias('2026-09-30', 2)).toBe('2026-10-02');
      expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    });

    it('sumarMeses sirve para las caducidades de ITV e ITS', () => {
      expect(sumarMeses('2026-04-12', 12)).toBe('2027-04-12');
      expect(sumarMeses('2026-04-12', 6)).toBe('2026-10-12');
    });

    // Un valor inesperado tumbaba la página entera: parseISO explota si no
    // recibe una cadena, y eso dejó el formulario de vehículo en blanco.
    it('aguanta un Date, un ISO completo o directamente basura', () => {
      const comoDate = new Date('2026-09-30T10:00:00.000Z');
      expect(formatFechaSola(comoDate)).toBe('30/09/2026');
      expect(formatDiaCalendario(comoDate)).toBe('30/09/2026');
      expect(diasHasta(comoDate, '2026-09-19')).toBe(11);

      for (const basura of [null, undefined, 42, 'basura', {}, new Date('x')]) {
        expect(formatFechaSola(basura)).toBe('—');
        expect(formatDiaCalendario(basura)).toBe('—');
        expect(diasHasta(basura, '2026-09-19')).toBeNull();
      }
    });

    it('diasHasta cuenta días de calendario, también cruzando el cambio de hora', () => {
      expect(diasHasta('2026-09-30', '2026-09-19')).toBe(11);
      expect(diasHasta('2026-09-10', '2026-09-19')).toBe(-9);   // ya vencida
      // El último domingo de octubre el día dura 25 horas: aun así son 12 días
      expect(diasHasta('2026-11-01', '2026-10-20')).toBe(12);
      expect(diasHasta('nada', '2026-09-19')).toBeNull();
    });
  });

  describe('diaEnEspana', () => {
    it('agrupa por el día español, no por el de UTC', () => {
      // 22:30 UTC del 30 de junio ya es 1 de julio en España
      expect(diaEnEspana('2026-06-30T22:30:00.000Z')).toBe('2026-07-01');
      expect(diaEnEspana('2026-09-19T06:45:59.000Z')).toBe('2026-09-19');
    });
  });

  describe('toUtcIso', () => {
    it('converts local datetime to UTC ISO', () => {
      const result = toUtcIso('2026-04-13T14:00');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });
    it('returns falsy input as-is', () => {
      expect(toUtcIso(null)).toBeNull();
      expect(toUtcIso('')).toBe('');
    });
  });

  describe('toInputDatetime', () => {
    it('converts date to input format', () => {
      const result = toInputDatetime('2026-04-13T14:30:00Z');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });
  });

  describe('toInputDate', () => {
    it('converts date to input date format', () => {
      const result = toInputDate('2026-04-13T14:30:00Z');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('isWorkActive', () => {
    it('returns true when within date range', () => {
      const trabajo = {
        fecha_inicio: new Date(Date.now() - 3600000).toISOString(),
        fecha_fin: new Date(Date.now() + 3600000).toISOString(),
      };
      expect(isWorkActive(trabajo)).toBe(true);
    });
    it('returns false when outside date range', () => {
      const trabajo = {
        fecha_inicio: new Date(Date.now() + 3600000).toISOString(),
        fecha_fin: new Date(Date.now() + 7200000).toISOString(),
      };
      expect(isWorkActive(trabajo)).toBe(false);
    });
  });

  describe('isOverdue', () => {
    it('returns true when fecha_fin has passed', () => {
      expect(isOverdue({ fecha_fin: new Date(Date.now() - 3600000).toISOString() })).toBe(true);
    });
    it('returns false when fecha_fin in future', () => {
      expect(isOverdue({ fecha_fin: new Date(Date.now() + 3600000).toISOString() })).toBe(false);
    });
  });

  describe('duration', () => {
    it('returns hours and minutes', () => {
      const inicio = '2026-04-13T08:00:00Z';
      const fin = '2026-04-13T10:30:00Z';
      const result = duration(inicio, fin);
      expect(result).toContain('2');
      expect(result).toContain('30');
    });
    it('returns only minutes for short durations', () => {
      const inicio = '2026-04-13T08:00:00Z';
      const fin = '2026-04-13T08:45:00Z';
      const result = duration(inicio, fin);
      expect(result).toContain('45');
    });
  });
});

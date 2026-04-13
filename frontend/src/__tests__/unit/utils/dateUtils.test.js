import { describe, it, expect } from 'vitest';
import {
  formatDate, formatDateTime, formatDateTimeShort,
  toUtcIso, toInputDatetime, toInputDate,
  isWorkActive, isOverdue, duration,
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

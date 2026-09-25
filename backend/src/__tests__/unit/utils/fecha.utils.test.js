'use strict';

const {
  ahora, fechaEnEspana, instanteEnEspana, inicioDelDiaEnEspana,
  diaCalendarioEnEspana, anioMesEnEspana, haceHoras, offsetEspanaMinutos,
  diaYHoraEnEspana,
  fechaApiAMysql,
} = require('../../../utils/fecha.utils');

// Estas funciones son el único sitio del backend donde se calcula la hora, así
// que se prueban contra el horario de verano y el de invierno, que es
// justamente donde fallaban las horas de inicio y fin de asignación.
describe('fecha.utils', () => {
  const VERANO   = new Date('2026-07-15T10:00:00.000Z');   // CEST, +02:00
  const INVIERNO = new Date('2026-01-15T10:00:00.000Z');   // CET,  +01:00

  describe('offsetEspanaMinutos', () => {
    it('da +120 en verano y +60 en invierno', () => {
      expect(offsetEspanaMinutos(VERANO)).toBe(120);
      expect(offsetEspanaMinutos(INVIERNO)).toBe(60);
    });

    it('cambia de hora en el fin de semana que toca, no en una fecha fija', () => {
      expect(offsetEspanaMinutos(new Date('2026-03-29T00:59:00.000Z'))).toBe(60);
      expect(offsetEspanaMinutos(new Date('2026-03-29T01:00:00.000Z'))).toBe(120);
      expect(offsetEspanaMinutos(new Date('2026-10-25T00:59:00.000Z'))).toBe(120);
      expect(offsetEspanaMinutos(new Date('2026-10-25T01:00:00.000Z'))).toBe(60);
    });
  });

  describe('ahora', () => {
    it('devuelve el instante actual', () => {
      const antes = Date.now();
      const t = ahora();
      expect(t).toBeInstanceOf(Date);
      expect(t.getTime()).toBeGreaterThanOrEqual(antes);
      expect(t.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('fechaEnEspana', () => {
    it('usa el día del calendario español, no el de UTC', () => {
      // 23:30 UTC del 31 de diciembre ya es 1 de enero en España
      expect(fechaEnEspana(new Date('2026-12-31T23:30:00.000Z'))).toBe('2027-01-01');
      expect(fechaEnEspana(VERANO)).toBe('2026-07-15');
    });
  });

  describe('instanteEnEspana', () => {
    it('convierte una hora de pared española en el instante real', () => {
      expect(instanteEnEspana(2026, 7, 15, 12).toISOString()).toBe('2026-07-15T10:00:00.000Z');
      expect(instanteEnEspana(2026, 1, 15, 11).toISOString()).toBe('2026-01-15T10:00:00.000Z');
    });

    it('acierta también el día del cambio de hora', () => {
      // La madrugada del 29 de marzo: a las 02:00 saltan a las 03:00
      expect(instanteEnEspana(2026, 3, 29, 1).toISOString()).toBe('2026-03-29T00:00:00.000Z');
      expect(instanteEnEspana(2026, 3, 29, 3).toISOString()).toBe('2026-03-29T01:00:00.000Z');
    });

    // Las dos horas raras del año. No son alcanzables desde la app (nadie
    // teclea las 02:30 del último domingo de marzo), pero conviene dejar por
    // escrito que no revientan y qué devuelven.
    it('la hora que no existe (02:30 del 29 de marzo) cae en la siguiente', () => {
      // Esa hora se la salta el reloj: se resuelve como las 03:30 CEST
      expect(instanteEnEspana(2026, 3, 29, 2, 30).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    });

    it('la hora repetida (02:30 del 25 de octubre) se resuelve a la segunda pasada', () => {
      // Ese día las 02:30 ocurren dos veces, una en CEST y otra en CET. Se
      // devuelve siempre la segunda, la de invierno. Es una elección, no una
      // casualidad: lo que importa es que sea estable y no lance.
      expect(instanteEnEspana(2026, 10, 25, 2, 30).toISOString()).toBe('2026-10-25T01:30:00.000Z');
    });
  });

  describe('inicioDelDiaEnEspana', () => {
    it('es la medianoche española, no la de UTC', () => {
      expect(inicioDelDiaEnEspana(VERANO).toISOString()).toBe('2026-07-14T22:00:00.000Z');
      expect(inicioDelDiaEnEspana(INVIERNO).toISOString()).toBe('2026-01-14T23:00:00.000Z');
    });
  });

  describe('diaCalendarioEnEspana', () => {
    it('devuelve el día español como fecha sin hora, para comparar con columnas DATE', () => {
      expect(diaCalendarioEnEspana(VERANO).toISOString()).toBe('2026-07-15T00:00:00.000Z');
      // Pasada la medianoche española el día ya ha cambiado aunque en UTC no
      expect(diaCalendarioEnEspana(new Date('2026-07-14T22:30:00.000Z')).toISOString())
        .toBe('2026-07-15T00:00:00.000Z');
    });
  });

  describe('anioMesEnEspana', () => {
    it('da el año y el mes del calendario español', () => {
      expect(anioMesEnEspana(new Date('2026-12-31T23:30:00.000Z'))).toEqual({ anio: 2027, mes: 1 });
    });
  });

  describe('haceHoras', () => {
    it('resta horas al instante dado', () => {
      expect(haceHoras(24, VERANO).toISOString()).toBe('2026-07-14T10:00:00.000Z');
    });
  });

  describe('diaYHoraEnEspana', () => {
    it('pinta día y hora españoles, no UTC', () => {
      expect(diaYHoraEnEspana(VERANO)).toBe('15/07 12:00');
      expect(diaYHoraEnEspana(INVIERNO)).toBe('15/01 11:00');
      // 23:30 UTC ya es el día siguiente en España
      expect(diaYHoraEnEspana(new Date('2026-07-14T22:30:00.000Z'))).toBe('15/07 00:30');
    });
  });

  describe('fechaApiAMysql', () => {
    it('deja tal cual lo que manda el frontend (UTC sin zona)', () => {
      expect(fechaApiAMysql('2026-09-25T12:55')).toBe('2026-09-25T12:55');
      expect(fechaApiAMysql('2026-09-25')).toBe('2026-09-25');
    });

    it('una ISO con Z pasa a DATETIME en UTC (antes daba 500 en MySQL)', () => {
      expect(fechaApiAMysql('2026-09-25T12:55:21.279Z')).toBe('2026-09-25 12:55:21');
    });

    it('un desfase horario se convierte a UTC', () => {
      expect(fechaApiAMysql('2026-09-25T14:55:00+02:00')).toBe('2026-09-25 12:55:00');
      expect(fechaApiAMysql('2026-09-25T14:55:00+0200')).toBe('2026-09-25 12:55:00');
    });

    it('lo que no es texto no se toca', () => {
      expect(fechaApiAMysql(undefined)).toBeUndefined();
      expect(fechaApiAMysql(null)).toBeNull();
    });
  });
});

'use strict';

const { siguienteMultiplo, SQL_FIJAR_PROXIMO_MANTENIMIENTO } = require('../../../utils/mantenimiento.utils');

describe('mantenimiento.utils', () => {
  describe('siguienteMultiplo', () => {
    it('el siguiente múltiplo de 15.000 por encima', () => {
      expect(siguienteMultiplo(32000)).toBe(45000);
      expect(siguienteMultiplo(1)).toBe(15000);
      expect(siguienteMultiplo('14999')).toBe(15000);
    });

    it('justo en un múltiplo, el de después: ese ya se ha pasado', () => {
      expect(siguienteMultiplo(45000)).toBe(60000);
    });

    it('sin km no hay referencia', () => {
      expect(siguienteMultiplo(0)).toBeNull();
      expect(siguienteMultiplo(null)).toBeNull();
      expect(siguienteMultiplo(undefined)).toBeNull();
      expect(siguienteMultiplo('abc')).toBeNull();
    });
  });

  it('el SQL solo rellena la referencia vacía y con km > 0', () => {
    expect(SQL_FIJAR_PROXIMO_MANTENIMIENTO).toContain('COALESCE(km_proximo_mantenimiento');
    expect(SQL_FIJAR_PROXIMO_MANTENIMIENTO).toContain('IF(kilometros_actuales > 0');
    expect(SQL_FIJAR_PROXIMO_MANTENIMIENTO).toContain('(FLOOR(kilometros_actuales / 15000) + 1) * 15000');
  });
});

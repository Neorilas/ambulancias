'use strict';

const constants = require('../../../config/constants');

describe('constants', () => {
  it('has all expected role keys', () => {
    expect(constants.ROLES.SUPERADMIN).toBe('superadmin');
    expect(constants.ROLES.ADMINISTRADOR).toBe('administrador');
    expect(constants.ROLES.GESTOR).toBe('gestor');
    expect(constants.ROLES.TECNICO).toBe('tecnico');
    expect(constants.ROLES.ENFERMERO).toBe('enfermero');
    expect(constants.ROLES.MEDICO).toBe('medico');
  });

  it('IMAGEN_TIPOS_REQUERIDOS is a non-empty subset of IMAGEN_TIPOS', () => {
    for (const tipo of constants.IMAGEN_TIPOS_REQUERIDOS) {
      expect(constants.IMAGEN_TIPOS).toContain(tipo);
    }
    expect(constants.IMAGEN_TIPOS_REQUERIDOS.length).toBeGreaterThan(0);
  });

  it('IMAGEN_TIPOS_INICIO y IMAGEN_TIPOS_FIN son subconjuntos no vacíos de IMAGEN_TIPOS', () => {
    for (const tipo of constants.IMAGEN_TIPOS_INICIO) {
      expect(constants.IMAGEN_TIPOS).toContain(tipo);
    }
    for (const tipo of constants.IMAGEN_TIPOS_FIN) {
      expect(constants.IMAGEN_TIPOS).toContain(tipo);
    }
    expect(constants.IMAGEN_TIPOS_INICIO.length).toBeGreaterThan(0);
    expect(constants.IMAGEN_TIPOS_FIN.length).toBeGreaterThan(0);
  });
});

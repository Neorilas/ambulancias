import { describe, it, expect } from 'vitest';
import {
  ROLES, PERMISSIONS, TRABAJO_ESTADOS, TRABAJO_TIPOS,
  IMAGEN_TIPOS_INICIO, IMAGEN_TIPOS_FIN, ESTADO_COLORS, ESTADO_LABELS,
  ASIGNACION_ESTADO_COLORS, ASIGNACION_ESTADO_LABELS,
} from '../../../utils/constants';

describe('constants', () => {
  it('exports ROLES with expected keys', () => {
    expect(ROLES.SUPERADMIN).toBe('superadmin');
    expect(ROLES.ADMINISTRADOR).toBe('administrador');
    expect(ROLES.TECNICO).toBe('tecnico');
  });

  it('exports PERMISSIONS', () => {
    expect(PERMISSIONS.MANAGE_VEHICLES).toBeDefined();
    expect(PERMISSIONS.MANAGE_USERS).toBeDefined();
  });

  it('exports TRABAJO_ESTADOS', () => {
    expect(TRABAJO_ESTADOS.PROGRAMADO).toBe('programado');
    expect(TRABAJO_ESTADOS.FINALIZADO).toBe('finalizado');
  });

  it('exports IMAGEN_TIPOS_INICIO with the 6 required start-photos', () => {
    expect(Array.isArray(IMAGEN_TIPOS_INICIO)).toBe(true);
    expect(IMAGEN_TIPOS_INICIO.map(t => t.key)).toEqual([
      'frontal', 'lateral_izquierdo', 'trasera', 'lateral_derecho',
      'nivel_aceite', 'nivel_liquidos_general',
    ]);
  });

  it('exports IMAGEN_TIPOS_FIN with walk-around + cuentakilómetros', () => {
    expect(Array.isArray(IMAGEN_TIPOS_FIN)).toBe(true);
    expect(IMAGEN_TIPOS_FIN.map(t => t.key)).toEqual([
      'frontal', 'lateral_izquierdo', 'trasera', 'lateral_derecho',
      'cuentakilometros',
    ]);
  });

  it('has matching ESTADO_COLORS and ESTADO_LABELS keys', () => {
    expect(Object.keys(ESTADO_COLORS)).toEqual(expect.arrayContaining(Object.values(TRABAJO_ESTADOS)));
    expect(Object.keys(ESTADO_LABELS)).toEqual(expect.arrayContaining(Object.values(TRABAJO_ESTADOS)));
  });

  it('has ASIGNACION estado maps', () => {
    expect(ASIGNACION_ESTADO_COLORS).toHaveProperty('activa');
    expect(ASIGNACION_ESTADO_LABELS).toHaveProperty('finalizada');
  });
});

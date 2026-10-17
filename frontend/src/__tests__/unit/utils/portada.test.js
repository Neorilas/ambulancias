import { describe, it, expect } from 'vitest';
import { rutaPortada } from '../../../utils/portada.js';

const con = (roles, features, { superTodo = roles.includes('superadmin') } = {}) => ({
  hasRole: (r) => roles.includes(r),
  // Como FeaturesContext: al superadmin le dice que sí a todo.
  isFeatureEnabled: (f) => superTodo || features.includes(f),
  features,
});

const ENCENDIDOS = ['menu_trabajos', 'menu_mis_trabajos'];

describe('rutaPortada', () => {
  it('el administrador entra en «Trabajos», no en «Mis trabajos»', () => {
    expect(rutaPortada(con(['administrador'], ENCENDIDOS))).toBe('/trabajos');
  });

  it('también si además es técnico: manda el rol de gestión', () => {
    expect(rutaPortada(con(['administrador', 'tecnico'], ENCENDIDOS))).toBe('/trabajos');
  });

  it('el superadmin, a «Trabajos» aunque el flag esté apagado (lo abre igual)', () => {
    expect(rutaPortada(con(['superadmin'], []))).toBe('/trabajos');
  });

  it('un administrador sin «Trabajos» encendido no va a una pantalla que lo rebotaría', () => {
    expect(rutaPortada(con(['administrador'], ['menu_mis_trabajos']))).toBe('/mis-trabajos');
    expect(rutaPortada(con(['administrador'], []))).toBe('/mis-asignaciones');
  });

  it('el técnico y el gestor siguen en «Mis trabajos»', () => {
    expect(rutaPortada(con(['tecnico'], ENCENDIDOS))).toBe('/mis-trabajos');
    expect(rutaPortada(con(['gestor'], ENCENDIDOS))).toBe('/mis-trabajos');
  });

  it('con «Mis trabajos» apagado, «Mis asignaciones»', () => {
    expect(rutaPortada(con(['tecnico'], ['menu_trabajos']))).toBe('/mis-asignaciones');
  });
});

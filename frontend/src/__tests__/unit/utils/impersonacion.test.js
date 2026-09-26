import { describe, it, expect, beforeEach } from 'vitest';
import { PREFIJO } from '../../../utils/sessionStorage.js';
import {
  impersonacionActiva, guardarYEntrarComo, restaurarSesionPropia, descartarSesionApartada,
} from '../../../utils/impersonacion.js';

const get = (k) => localStorage.getItem(PREFIJO + k);
const set = (k, v) => localStorage.setItem(PREFIJO + k, v);

describe('utils/impersonacion', () => {
  beforeEach(() => {
    localStorage.clear();
    set('accessToken', 'at-super');
    set('refreshToken', 'rt-super');
    set('user', '{"id":1}');
  });

  const entrar = () => guardarYEntrarComo({
    accessToken: 'at-imp',
    expiraEnMin: 60,
    user: { id: 5, username: 'jlopez', nombre: 'J', apellidos: 'L', roles: ['tecnico'] },
  });

  it('aparta la sesión propia y entra sin refreshToken', () => {
    entrar();
    expect(get('accessToken')).toBe('at-imp');
    expect(get('refreshToken')).toBeNull();
    expect(JSON.parse(get('user')).id).toBe(5);
    expect(get('imp:accessToken')).toBe('at-super');
    expect(get('imp:refreshToken')).toBe('rt-super');
    const imp = impersonacionActiva();
    expect(imp).toMatchObject({ id: 5, username: 'jlopez' });
    expect(imp.expira).toBeGreaterThan(Date.now() + 59 * 60000);
  });

  it('restaurar deja la sesión como estaba y limpia las claves apartadas', () => {
    entrar();
    expect(restaurarSesionPropia()).toBe(true);
    expect(get('accessToken')).toBe('at-super');
    expect(get('refreshToken')).toBe('rt-super');
    expect(get('user')).toBe('{"id":1}');
    expect(get('imp:accessToken')).toBeNull();
    expect(impersonacionActiva()).toBeNull();
  });

  it('restaurar sin impersonación no toca nada', () => {
    expect(restaurarSesionPropia()).toBe(false);
    expect(get('accessToken')).toBe('at-super');
  });

  it('no entra encima de otra impersonación (no pisa la sesión apartada)', () => {
    entrar();
    expect(() => entrar()).toThrow();
    expect(get('imp:accessToken')).toBe('at-super');
  });

  it('descartar borra la sesión apartada sin restaurarla', () => {
    entrar();
    descartarSesionApartada();
    expect(get('imp:refreshToken')).toBeNull();
    expect(impersonacionActiva()).toBeNull();
    expect(get('accessToken')).toBe('at-imp');
  });

  it('impersonacionActiva tolera basura en el storage', () => {
    set('impersonacion', '{roto');
    expect(impersonacionActiva()).toBeNull();
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CLAVE_TEMA, leerTema, aplicarTema, cambiarTema } from '../../../utils/tema.js';

describe('tema', () => {
  beforeEach(() => {
    localStorage.removeItem(CLAVE_TEMA);
    delete document.documentElement.dataset.tema;
  });
  afterEach(() => vi.restoreAllMocks());

  it('sin nada guardado es el claro', () => {
    expect(leerTema()).toBe('claro');
  });

  it('lee el oscuro guardado', () => {
    localStorage.setItem(CLAVE_TEMA, 'oscuro');
    expect(leerTema()).toBe('oscuro');
  });

  it('un valor desconocido cae al claro', () => {
    localStorage.setItem(CLAVE_TEMA, 'morado');
    expect(leerTema()).toBe('claro');
  });

  it('si localStorage revienta, claro', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('privado'); });
    expect(leerTema()).toBe('claro');
  });

  it('el oscuro marca el <html> y el claro lo desmarca', () => {
    aplicarTema('oscuro');
    expect(document.documentElement.dataset.tema).toBe('oscuro');
    aplicarTema('claro');
    expect(document.documentElement.dataset.tema).toBeUndefined();
  });

  it('cambiarTema guarda y aplica', () => {
    expect(cambiarTema('oscuro')).toBe('oscuro');
    expect(localStorage.getItem(CLAVE_TEMA)).toBe('oscuro');
    expect(document.documentElement.dataset.tema).toBe('oscuro');
  });

  it('cambiarTema con un valor raro deja el claro', () => {
    expect(cambiarTema('morado')).toBe('claro');
    expect(document.documentElement.dataset.tema).toBeUndefined();
  });

  it('cambiarTema aplica aunque no se pueda guardar', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cuota'); });
    expect(cambiarTema('oscuro')).toBe('oscuro');
    expect(document.documentElement.dataset.tema).toBe('oscuro');
  });

  it('no se borra con la limpieza de sesión del entorno', () => {
    // La clave no lleva el prefijo vapss:<env>: de sessionStorage.js
    expect(CLAVE_TEMA).not.toMatch(/^vapss:[a-z]+:/);
  });
});

import { describe, it, expect } from 'vitest';
import {
  DESTINO_POR_DEFECTO, rutaInterna, destinoTrasLogin, urlLoginVolviendo,
} from '../../../utils/destinoLogin.js';

describe('destinoLogin', () => {
  describe('rutaInterna', () => {
    it('acepta rutas de la app con query y hash', () => {
      expect(rutaInterna('/vehiculos/2?tab=revisiones#km')).toBe('/vehiculos/2?tab=revisiones#km');
    });

    it.each([
      ['otro origen protocol-relative', '//evil.example/x'],
      ['barra invertida, que el navegador lee como //', '/\\evil.example'],
      ['URL absoluta', 'https://evil.example/'],
      ['javascript:', 'javascript:alert(1)'],
      ['ruta relativa', 'vehiculos/2'],
      ['salto de línea', '/vehiculos\n/2'],
      ['el propio login', '/login?volver=%2Fx'],
      ['vacía', ''],
      ['no es texto', null],
    ])('rechaza %s', (_caso, ruta) => {
      expect(rutaInterna(ruta)).toBeNull();
    });

    it('no confunde /login-algo con el login', () => {
      expect(rutaInterna('/loginx')).toBe('/loginx');
    });
  });

  describe('destinoTrasLogin', () => {
    it('desde ProtectedRoute conserva pathname, search y hash', () => {
      const location = {
        search: '',
        state: { from: { pathname: '/vehiculos/2', search: '?tab=revisiones', hash: '#mant' } },
      };
      expect(destinoTrasLogin(location)).toBe('/vehiculos/2?tab=revisiones#mant');
    });

    it('desde la recarga de clearAuth usa ?volver=', () => {
      expect(destinoTrasLogin({ search: '?volver=%2Fvehiculos%2F2%3Ftab%3Drevisiones' }))
        .toBe('/vehiculos/2?tab=revisiones');
    });

    it('state.from manda sobre ?volver=', () => {
      expect(destinoTrasLogin({
        search: '?volver=%2Fotra',
        state: { from: { pathname: '/trabajos/7' } },
      })).toBe('/trabajos/7');
    });

    it('un ?volver= a otro origen acaba en el dashboard', () => {
      expect(destinoTrasLogin({ search: '?volver=%2F%2Fevil.example' })).toBe(DESTINO_POR_DEFECTO);
      expect(destinoTrasLogin({ search: '?volver=https%3A%2F%2Fevil.example' })).toBe(DESTINO_POR_DEFECTO);
    });

    it('sin nada, al dashboard', () => {
      expect(destinoTrasLogin({ search: '' })).toBe(DESTINO_POR_DEFECTO);
      expect(destinoTrasLogin(undefined)).toBe(DESTINO_POR_DEFECTO);
    });
  });

  describe('urlLoginVolviendo', () => {
    it('en producción quita el /app del basename y lo vuelve a poner delante del login', () => {
      expect(urlLoginVolviendo('/app/', { pathname: '/app/vehiculos/2', search: '?tab=revisiones', hash: '' }))
        .toBe('/app/login?volver=%2Fvehiculos%2F2%3Ftab%3Drevisiones');
    });

    it('en local (base /) lleva la ruta tal cual', () => {
      expect(urlLoginVolviendo('/', { pathname: '/trabajos/7', search: '', hash: '#equipo' }))
        .toBe('/login?volver=%2Ftrabajos%2F7%23equipo');
    });

    it('desde la portada no añade nada', () => {
      expect(urlLoginVolviendo('/app/', { pathname: '/app/', search: '', hash: '' })).toBe('/app/login');
      expect(urlLoginVolviendo('/', { pathname: '/' })).toBe('/login');
    });

    it('no se fía de una ruta que no sea interna', () => {
      expect(urlLoginVolviendo('/', { pathname: '//evil.example' })).toBe('/login');
    });
  });
});

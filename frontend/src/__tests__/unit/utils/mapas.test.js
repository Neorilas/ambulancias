import { describe, it, expect } from 'vitest';
import { esEnlaceGoogleMaps, enlaceBusquedaMaps, mapsDeTrabajo } from '../../../utils/mapas.js';

describe('utils/mapas', () => {
  // La misma lista que backend/src/__tests__/unit/utils/mapas.utils.test.js
  it.each([
    'https://maps.app.goo.gl/AbC123xyz',
    'https://goo.gl/maps/AbC123',
    'https://www.google.com/maps/place/Parque+del+Retiro/@40.41,-3.68,15z',
    'https://google.es/maps?q=40.4153,-3.6844',
    'https://maps.google.com/?q=Retiro',
    'https://WWW.Google.ES/maps/search/Ifema',
  ])('acepta %s', (url) => {
    expect(esEnlaceGoogleMaps(url)).toBe(true);
  });

  it.each([
    'http://maps.app.goo.gl/AbC123',
    'javascript:alert(1)',
    'https://maps.app.goo.gl.evil.com/abc',
    'https://www.google.com/search?q=retiro',
    'https://goo.gl/abc',
    'https://goo.gl/mapsEVIL',
    'https://maps.google.xyz.me/x',
    'https://google.abc.me/maps/x',
    'https://google.cc/maps',
    'https://google.com.me/maps',
    'https://maps.app.goo.gl:8443/abc',
    'Parque del Retiro',
    '',
    null,
  ])('rechaza %s', (url) => {
    expect(esEnlaceGoogleMaps(url)).toBe(false);
  });

  it('la búsqueda codifica el texto, y sin texto no hay búsqueda', () => {
    expect(enlaceBusquedaMaps(' Retiro, puerta 3 & más '))
      .toBe('https://www.google.com/maps/search/?api=1&query=Retiro%2C%20puerta%203%20%26%20m%C3%A1s');
    expect(enlaceBusquedaMaps('  ')).toBeNull();
    expect(enlaceBusquedaMaps(null)).toBeNull();
  });

  describe('mapsDeTrabajo', () => {
    it('con enlace, el enlace y exacto', () => {
      expect(mapsDeTrabajo({ ubicacion: 'Retiro', ubicacion_url: 'https://maps.app.goo.gl/abc' }))
        .toEqual({ url: 'https://maps.app.goo.gl/abc', exacto: true });
    });

    it('solo con texto, una búsqueda que no es exacta', () => {
      expect(mapsDeTrabajo({ ubicacion: 'Retiro', ubicacion_url: null }))
        .toEqual({ url: enlaceBusquedaMaps('Retiro'), exacto: false });
    });

    it('un enlace guardado que no es de Maps no se ofrece: cae a la búsqueda', () => {
      expect(mapsDeTrabajo({ ubicacion: 'Retiro', ubicacion_url: 'https://evil.com' }).exacto).toBe(false);
      expect(mapsDeTrabajo({ ubicacion: null, ubicacion_url: 'https://evil.com' })).toBeNull();
    });

    it('sin nada, nada', () => {
      expect(mapsDeTrabajo({})).toBeNull();
      expect(mapsDeTrabajo(null)).toBeNull();
    });
  });
});

'use strict';

const { esEnlaceGoogleMaps } = require('../../../utils/mapas.utils');

describe('mapas.utils · esEnlaceGoogleMaps', () => {
  it.each([
    'https://maps.app.goo.gl/AbC123xyz',
    ' https://maps.app.goo.gl/AbC123xyz ',
    'https://goo.gl/maps/AbC123',
    'https://www.google.com/maps/place/Parque+del+Retiro/@40.41,-3.68,15z',
    'https://google.es/maps?q=40.4153,-3.6844',
    'https://www.google.com/maps',
    'https://maps.google.com/?q=Retiro',
    'https://maps.google.es/maps?q=Ifema',
    'https://WWW.Google.ES/maps/search/Ifema',
  ])('acepta %s', (url) => {
    expect(esEnlaceGoogleMaps(url)).toBe(true);
  });

  it.each([
    ['http, no https', 'http://maps.app.goo.gl/AbC123'],
    ['javascript:', 'javascript:alert(1)'],
    ['otro dominio', 'https://maps.example.com/abc'],
    ['parecido pero no', 'https://maps.app.goo.gl.evil.com/abc'],
    ['google sin /maps', 'https://www.google.com/search?q=retiro'],
    ['/mapsx no es /maps', 'https://www.google.com/mapsx'],
    ['goo.gl que no es de maps', 'https://goo.gl/abc'],
    ['goo.gl/mapsX no es /maps', 'https://goo.gl/mapsEVIL'],
    // Dominios que registra cualquiera y que una regex por forma dejaba pasar
    ['maps.google bajo otro dominio', 'https://maps.google.xyz.me/x'],
    ['google bajo otro dominio', 'https://google.abc.me/maps/x'],
    ['maps.google bajo .io ajeno', 'https://maps.google.abc.io/'],
    ['google en un TLD cualquiera', 'https://google.cc/maps'],
    ['google en un TLD de 3 letras', 'https://www.google.xyz/maps'],
    ['google.com.<país> no listado', 'https://google.com.me/maps'],
    ['con usuario', 'https://user@maps.app.goo.gl/abc'],
    ['con puerto', 'https://maps.app.goo.gl:8443/abc'],
    ['texto suelto', 'Parque del Retiro'],
    ['vacío', ''],
    ['no texto', 123],
    ['demasiado largo', `https://www.google.com/maps/${'a'.repeat(500)}`],
  ])('rechaza: %s', (_n, url) => {
    expect(esEnlaceGoogleMaps(url)).toBe(false);
  });
});

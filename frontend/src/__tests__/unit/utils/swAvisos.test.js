import { describe, it, expect, vi } from 'vitest';
import { leerAviso, rutaDestino, AVISO_POR_DEFECTO } from '../../../utils/swAvisos.js';

/**
 * Las dos decisiones del service worker (src/sw.js) que se pueden probar sin
 * montar un service worker. Un push mal leído o una ruta mal compuesta no dan
 * error: simplemente dejan al admin con un aviso inútil.
 */

/** Imita el `event.data` de un PushEvent. */
const datos = (cuerpo) => ({
  json: () => JSON.parse(cuerpo),
  text: () => cuerpo,
});

describe('leerAviso', () => {
  it('usa el payload del backend tal cual', () => {
    const aviso = leerAviso(datos(JSON.stringify({
      titulo: 'Alfa 1 · servicio finalizado',
      cuerpo: 'Juan López ha finalizado el servicio con fotos.',
      url:    '/asignaciones?id=12',
      tag:    'asig-12-finalizada',
    })));

    expect(aviso).toEqual({
      titulo: 'Alfa 1 · servicio finalizado',
      cuerpo: 'Juan López ha finalizado el servicio con fotos.',
      url:    '/asignaciones?id=12',
      tag:    'asig-12-finalizada',
    });
  });

  it('completa lo que el payload no traiga', () => {
    const aviso = leerAviso(datos(JSON.stringify({ titulo: 'Solo título' })));
    expect(aviso.titulo).toBe('Solo título');
    expect(aviso.cuerpo).toBe(AVISO_POR_DEFECTO.cuerpo);
    expect(aviso.url).toBe('/');
  });

  it('un push sin datos muestra el aviso por defecto, no uno vacío', () => {
    expect(leerAviso(null)).toEqual(AVISO_POR_DEFECTO);
    expect(leerAviso(undefined)).toEqual(AVISO_POR_DEFECTO);
  });

  it('si no es JSON, enseña el texto como cuerpo', () => {
    const aviso = leerAviso({
      json: () => { throw new SyntaxError('no es JSON'); },
      text: () => 'aviso en texto plano',
    });
    expect(aviso.cuerpo).toBe('aviso en texto plano');
    expect(aviso.titulo).toBe(AVISO_POR_DEFECTO.titulo);
  });

  it('si no es JSON ni hay texto, cae al aviso por defecto', () => {
    const aviso = leerAviso({
      json: () => { throw new SyntaxError('no es JSON'); },
      text: () => '',
    });
    expect(aviso).toEqual(AVISO_POR_DEFECTO);
  });

  it('aguanta que hasta text() lance', () => {
    const aviso = leerAviso({
      json: () => { throw new Error('x'); },
      text: () => { throw new Error('y'); },
    });
    expect(aviso).toEqual(AVISO_POR_DEFECTO);
  });

  it.each([
    ['null',    'null'],
    ['un número', '42'],
    ['una cadena', '"hola"'],
    ['un array', '[1,2]'],
  ])('un JSON válido pero que no es un objeto (%s) no deja el aviso a medias', (_caso, json) => {
    // Desestructurar `null` o un número dejaría titulo y cuerpo en undefined,
    // y el aviso saldría en blanco.
    const aviso = leerAviso(datos(json));
    expect(aviso).toEqual(AVISO_POR_DEFECTO);
  });

  it('no se queda con una referencia al objeto por defecto', () => {
    const uno = leerAviso(null);
    uno.titulo = 'tocado';
    expect(AVISO_POR_DEFECTO.titulo).toBe('VAPSS');
  });
});

describe('rutaDestino', () => {
  it('antepone la carpeta de producción', () => {
    expect(rutaDestino('/app/', '/asignaciones?id=4')).toBe('/app/asignaciones?id=4');
  });

  it('antepone la de PRE', () => {
    expect(rutaDestino('/app-pre/', '/asignaciones?id=4')).toBe('/app-pre/asignaciones?id=4');
  });

  it('en local (base /) deja la ruta como estaba', () => {
    expect(rutaDestino('/', '/asignaciones?id=4')).toBe('/asignaciones?id=4');
  });

  it('acepta la ruta sin barra inicial', () => {
    expect(rutaDestino('/app/', 'asignaciones')).toBe('/app/asignaciones');
  });

  it('no duplica la barra si la ruta trae varias', () => {
    // `/app//asignaciones` no es la misma ruta para el router.
    expect(rutaDestino('/app/', '//asignaciones')).toBe('/app/asignaciones');
  });

  it.each([
    ['undefined', undefined],
    ['null',      null],
    ['vacía',     ''],
  ])('sin ruta (%s) lleva a la raíz de la app', (_caso, url) => {
    expect(rutaDestino('/app/', url)).toBe('/app/');
  });
});

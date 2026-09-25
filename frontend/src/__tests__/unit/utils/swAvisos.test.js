import { describe, it, expect, vi } from 'vitest';
import { leerAviso, rutaDestino, opcionesNotificacion, AVISO_POR_DEFECTO } from '../../../utils/swAvisos.js';

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

describe('opcionesNotificacion', () => {
  const normal  = { titulo: 't', cuerpo: 'c', url: '/asignaciones?id=1', tag: 'asig-1-activada' };
  const urgente = { ...normal, tag: 'asig-1-sin-iniciar', prioridad: 'alta' };

  it('todo aviso pide sonido y lleva la ruta en data', () => {
    const o = opcionesNotificacion(normal, '/app/');
    expect(o.silent).toBe(false);
    expect(o.body).toBe('c');
    expect(o.data).toEqual({ url: '/asignaciones?id=1' });
    expect(o.icon).toBe('/app/icons/icon-192x192.png');
  });

  it('uno normal lleva el icono de la app y sin botones', () => {
    const o = opcionesNotificacion(normal, '/app/');
    expect(o.badge).toBe('/app/icons/icon-96x96.png');
    expect(o.actions).toBeUndefined();
  });

  it('el urgente se distingue: icono de aviso, vibración más larga y botón', () => {
    const o = opcionesNotificacion(urgente, '/app/');
    const n = opcionesNotificacion(normal, '/app/');
    expect(o.badge).toBe('/app/icons/badge-urgente-96x96.png');
    expect(o.vibrate.reduce((a, b) => a + b, 0)).toBeGreaterThan(n.vibrate.reduce((a, b) => a + b, 0));
    expect(o.actions).toEqual([{ action: 'ver', title: 'Ver servicio' }]);
  });

  it('tag y renotify van juntos o no van (renotify sin tag es TypeError en Chrome)', () => {
    expect(opcionesNotificacion(normal, '/')).toMatchObject({ tag: 'asig-1-activada', renotify: true });
    const sinTag = opcionesNotificacion({ ...normal, tag: undefined }, '/');
    expect(sinTag.tag).toBeUndefined();
    expect(sinTag.renotify).toBeUndefined();
  });

  it('el aviso por defecto también se puede pintar', () => {
    expect(opcionesNotificacion(AVISO_POR_DEFECTO, '/').body).toBe(AVISO_POR_DEFECTO.cuerpo);
  });
});

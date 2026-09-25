/**
 * utils/swAvisos.js
 * Las decisiones del service worker que conviene poder probar sueltas.
 *
 * Vive fuera de `sw.js` a propósito: un service worker no se puede montar en
 * jsdom, así que todo lo que se quede dentro es código sin red. Y justo estas
 * dos piezas son las que más fácil se rompen — un payload que no viene como se
 * esperaba y una ruta mal compuesta dejan el aviso en nada, pero en silencio.
 */

/** Lo que se muestra cuando el push llega vacío o ilegible. */
export const AVISO_POR_DEFECTO = {
  titulo: 'VAPSS',
  cuerpo: 'Hay novedades en una asignación.',
  url:    '/',
  tag:    undefined,
};

/**
 * Interpreta el payload que manda el backend (`push.service.js`).
 *
 * Nunca se da por hecho que venga bien. Si esto lanzara, el navegador mostraría
 * igualmente un aviso genérico del sistema («Esta web se ha actualizado en
 * segundo plano»), que es lo peor de los dos mundos: suena, pero no dice nada.
 *
 * @param {{json: () => any, text: () => string}|null} datos  `event.data` del push
 */
export function leerAviso(datos) {
  if (!datos) return { ...AVISO_POR_DEFECTO };

  try {
    const payload = datos.json();
    // Un JSON válido pero que no es un objeto (un número, una cadena, null)
    // dejaría el aviso con las propiedades a undefined al desestructurarlo.
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ...AVISO_POR_DEFECTO };
    }
    return { ...AVISO_POR_DEFECTO, ...payload };
  } catch {
    // No era JSON: si al menos hay texto, se enseña como cuerpo.
    let texto = '';
    try { texto = datos.text(); } catch { texto = ''; }
    return texto ? { ...AVISO_POR_DEFECTO, cuerpo: texto } : { ...AVISO_POR_DEFECTO };
  }
}

/**
 * Las opciones de `showNotification` para un aviso.
 *
 * Todo aviso pide sonido y vibración (`silent: false`): el objetivo es que el
 * teléfono suene. Lo que NO se puede desde una web: elegir el tono, subir el
 * volumen o hacer que se repita — en Android lo decide el canal de
 * notificaciones del sistema, y una web no puede crear canales (§2.5 del mapa).
 *
 * Lo único que sí distingue un aviso urgente (`prioridad: 'alta'`, hoy solo el
 * de «servicio sin iniciar») de los demás: otro icono en la barra de estado
 * (`badge`, un triángulo de aviso), una vibración más larga y un botón «Ver
 * servicio». El «URGENTE» del título lo pone el backend.
 *
 * @param {object} aviso  lo que devuelve `leerAviso`
 * @param {string} base   carpeta de la app ('/app/', '/app-pre/' o '/')
 */
export function opcionesNotificacion(aviso, base) {
  const urgente = aviso?.prioridad === 'alta';
  const opciones = {
    body:  aviso?.cuerpo,
    icon:  `${base}icons/icon-192x192.png`,
    badge: urgente ? `${base}icons/badge-urgente-96x96.png` : `${base}icons/icon-96x96.png`,
    silent: false,
    // Con el móvil en el bolsillo, dos vibraciones de 200 ms pasan
    // desapercibidas; la urgente es todavía más larga.
    vibrate: urgente ? [600, 200, 600, 200, 600, 200, 600] : [300, 150, 300, 150, 300],
    // En escritorio el aviso se queda en pantalla hasta que alguien lo cierra.
    // Chrome en Android lo ignora (allí ya se quedan en la bandeja).
    requireInteraction: true,
    data: { url: aviso?.url },
  };
  // Cualquier botón abre lo mismo que tocar el aviso (`notificationclick`).
  if (urgente) opciones.actions = [{ action: 'ver', title: 'Ver servicio' }];
  // `renotify` sin `tag` es un TypeError en Chrome, así que van juntos o no
  // van. Con ambos, un aviso nuevo del mismo suceso reemplaza al anterior en
  // la bandeja y vuelve a sonar, en vez de apilar duplicados.
  if (aviso?.tag) {
    opciones.tag = aviso.tag;
    opciones.renotify = true;
  }
  return opciones;
}

/**
 * Compone la ruta que abre el aviso al tocarlo.
 *
 * Las rutas del payload son de la SPA ('/asignaciones?id=4') y no saben en qué
 * carpeta está instalada la app: en producción es '/app/', en PRE '/app-pre/'.
 * Sin anteponerla, el clic llevaría a la raíz del dominio.
 *
 * @param {string} base  '/app/', '/app-pre/' o '/'
 * @param {string} url   ruta de la SPA, con o sin barra inicial
 */
export function rutaDestino(base, url) {
  const ruta = String(url || '/').replace(/^\/+/, '');
  return `${base}${ruta}`;
}

/**
 * utils/swAvisos.js
 * Las dos decisiones del service worker que conviene poder probar sueltas.
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

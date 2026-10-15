/**
 * utils/destinoLogin.js
 * Adónde volver después de iniciar sesión.
 *
 * Un aviso push lleva a una pantalla concreta, a menudo con la pestaña en la
 * query (`/vehiculos/2?tab=revisiones`). Si la sesión ha caducado, la app pasa
 * por el login y luego tiene que dejarte DONDE IBAS, query y hash incluidos:
 * con solo el pathname se abría la ficha en el Resumen y no en Revisiones.
 *
 * Se llega al login por dos caminos y los dos acaban aquí:
 *   · `ProtectedRoute` (no hay sesión guardada): navega con `state.from`, la
 *     location entera de react-router.
 *   · `clearAuth` de `services/api.js` (había sesión, pero el refresco falla):
 *     recarga la página entera, así que no hay state que valga; el destino va
 *     en `?volver=`.
 *
 * Lo que se devuelve es SIEMPRE una ruta interna de la app (relativa al
 * `basename` del router). `?volver=` lo puede escribir cualquiera en un enlace,
 * así que no se acepta nada que el navegador pudiera leer como otro origen.
 */

export const DESTINO_POR_DEFECTO = '/dashboard';

/**
 * La ruta tal cual si es interna de la app; null si no.
 * Fuera: lo que no empieza por «/», lo protocol-relative («//otro.com», y
 * «/\otro.com», que los navegadores tratan igual), caracteres de control y el
 * propio login (volver a él después de entrar no lleva a ningún sitio).
 */
export function rutaInterna(ruta) {
  if (typeof ruta !== 'string' || !ruta.startsWith('/')) return null;
  if (ruta.startsWith('//') || ruta.startsWith('/\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(ruta)) return null;
  if (/^\/login(?:[/?#]|$)/.test(ruta)) return null;
  return ruta;
}

/**
 * Destino tras el login a partir de la location de la pantalla de login.
 * Manda `state.from` (navegación dentro de la app); si no hay, `?volver=`.
 */
export function destinoTrasLogin(location) {
  const from = location?.state?.from;
  if (from && typeof from.pathname === 'string') {
    const ruta = `${from.pathname}${from.search || ''}${from.hash || ''}`;
    return rutaInterna(ruta) || DESTINO_POR_DEFECTO;
  }
  const volver = new URLSearchParams(location?.search || '').get('volver');
  return rutaInterna(volver) || DESTINO_POR_DEFECTO;
}

/**
 * URL del login para una recarga completa (`window.location.href`) que
 * recuerde la pantalla actual. `base` es `import.meta.env.BASE_URL` ('/app/'
 * en producción, '/' en local): se le quita a la ruta, que el router la
 * vuelve a poner.
 */
export function urlLoginVolviendo(base, { pathname = '/', search = '', hash = '' } = {}) {
  const raiz = base.endsWith('/') ? base : `${base}/`;
  const prefijo = raiz.slice(0, -1);
  const relativa = prefijo && pathname.startsWith(`${prefijo}/`)
    ? pathname.slice(prefijo.length)
    : pathname;
  const destino = rutaInterna(`${relativa}${search}${hash}`);
  if (!destino || destino === '/') return `${raiz}login`;
  return `${raiz}login?volver=${encodeURIComponent(destino)}`;
}
